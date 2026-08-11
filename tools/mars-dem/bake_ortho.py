#!/usr/bin/env python3
"""Bake the HiRISE orthoimage into a high-resolution site albedo (v3).

The site shipped with a 494x520 crop of the colorized Viking global
mosaic: ONE PIXEL PER 195 METERS. The heightfield beside it is HiRISE
stereo at 3 m/px, so the ground was sixty times better shaped than it
was skinned, and every screenshot came back the same flat brown sheet
no matter how much relief was actually under it.

This fixes the skin. ESP_048689_1670_RED_A_01_ORTHO is the orthorectified
image from the very stereo pair the DTM was made from — 0.2527 m/px,
pixel-aligned to the elevation we already walk on, so a shadow in the
photograph lands on the bump that casts it.

HiRISE RED is panchromatic, so this is a pan-sharpen, not a swap: the
Viking mosaic keeps the low-frequency COLOR (which is real, and which
HiRISE cannot supply) and the ortho supplies all detail above its own
blur radius. Nodata wedges fall back to Viking alone.

Reads windowed over HTTP via GDAL /vsicurl — no 225 MB download.

  .venv/bin/python bake_ortho.py                    # network
  .venv/bin/python bake_ortho.py /path/ORTHO.JP2    # local file

Outputs (never overwrite a published version — R2 serves immutable):
  public/locations/mars-valles/hialbedo_v3.webp
  public/locations/mars-valles/site_v3.json
"""
import json
import os
import sys

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "locations", "mars-valles")

PDS = ("https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_048600_048699/"
       "ESP_048689_1670_ESP_048610_1670/")
DTM = PDS + "DTEEC_048689_1670_048610_1670_A01.IMG"

# Six observations orthorectified onto the SAME DTM, in priority order.
# Each has a diagonal footprint, so no single one covers the patch: the
# primary alone leaves the ground 600 m out at 75% valid. Their diagonals
# run differently, and stacked they close each other's wedges.
#
# They were shot years apart under different sun and exposure, which would
# tile visibly if we composited raw brightness. We composite each source's
# LOCAL DETAIL RATIO instead — every source is normalised against its own
# blur before it is laid down, so exposure differences cancel exactly and
# only the texture survives.
ORTHOS = [
    "ESP_048689_1670_RED_A_01_ORTHO.JP2",   # the DTM's own left image
    "ESP_048610_1670_RED_A_01_ORTHO.JP2",   # its stereo partner
    "ESP_046197_1670_RED_A_01_ORTHO.JP2",
    "ESP_050311_1670_RED_A_01_ORTHO.JP2",
    "ESP_040461_1670_RED_A_01_ORTHO.JP2",
    "ESP_039617_1670_RED_A_01_ORTHO.JP2",
]
ORTHO = PDS + ORTHOS[0]

# Output patch. 4096 px at 1 m/px — the walk and the near vista at a
# meter, which is 195x the old albedo and still one 4k texture.
#
# Anchored to the far edge of the HiRISE footprint, not centred on the
# pad. The site measures z SOUTHWARD, and the imagery runs ~8 km NORTH of
# the landing while stopping only 124 m south of it — and north is where
# the escarpment and the canyon wall are. Centring on the ship would have
# spent half the texture on ground with no ortho coverage at all.
SIZE_PX = 4096
MPP = 1.0
CX = 36.0            # pad, site-local
SOUTH_EDGE = 118.0   # ortho's own southern limit, site-local z (+z = south)

# Detail/color split: features coarser than this stay Viking's business.
# 160 m is comfortably above the 195 m mosaic pixel, so the two layers
# never fight over the same frequency band.
SPLIT_M = 160.0
RATIO_CLAMP = (0.45, 1.95)
FEATHER_M = 45.0     # blend-in width at each source's footprint edge


def georef():
    """Ortho origin in site-local meters, tied to the DTM's own placement.

    Both products carry the same projection but their corners differ by a
    metre or so, and site_v2's x0/z0 were derived from the DTM. Deriving
    the ortho's origin RELATIVE to the DTM's inherits that derivation
    exactly instead of re-running the geodesy and hoping it agrees.
    """
    site = json.load(open(os.path.join(OUT, "site_v2.json")))
    h = site["hires"]
    with rasterio.open(DTM) as d:
        dl, dt = d.bounds.left, d.bounds.top
    with rasterio.open(ORTHO if len(sys.argv) < 2 else sys.argv[1]) as o:
        ol, ot = o.bounds.left, o.bounds.top
        res, w, hgt = o.res[0], o.width, o.height
    x0 = h["x0"] + (ol - dl)
    z0 = h["z0"] + (dt - ot)
    print(f"ortho origin site-local x0={x0:.3f} z0={z0:.3f} res={res:.6f} {w}x{hgt}",
          file=sys.stderr)
    return site, x0, z0, res, w, hgt


def main():
    site, ox0, oz0, ores, ow, oh = georef()
    src = sys.argv[1] if len(sys.argv) > 1 else ORTHO

    span = SIZE_PX * MPP
    X0, Z0 = CX - span / 2.0, SOUTH_EDGE - span
    print(f"patch site-local x {X0:.0f}..{X0+span:.0f}  z {Z0:.0f}..{Z0+span:.0f}",
          file=sys.stderr)

    c0, c1 = (X0 - ox0) / ores, (X0 + span - ox0) / ores
    r0, r1 = (Z0 - oz0) / ores, (Z0 + span - oz0) / ores
    if c0 < -0.5 or r0 < -0.5 or c1 > ow + 0.5 or r1 > oh + 0.5:
        sys.exit(f"patch escapes the ortho: cols {c0:.0f}..{c1:.0f} of {ow}, "
                 f"rows {r0:.0f}..{r1:.0f} of {oh}")

    win = rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0)
    sigma = (SPLIT_M / MPP) / 3.0
    sources = [sys.argv[1]] if len(sys.argv) > 1 else [PDS + n for n in ORTHOS]

    ratio = np.ones((SIZE_PX, SIZE_PX), np.float32)
    have = np.zeros((SIZE_PX, SIZE_PX), bool)
    for url in sources:
        name = url.rsplit("/", 1)[-1]
        if have.mean() > 0.999:
            print(f"  (skipping {name} — patch already closed)", file=sys.stderr)
            continue
        try:
            with rasterio.open(url) as ds:
                # out_shape drives GDAL to the right overview level, so this
                # is a decimated read (~16k -> 4k), not 260 Mpx over the wire.
                pan = ds.read(1, window=win, out_shape=(SIZE_PX, SIZE_PX),
                              resampling=rasterio.enums.Resampling.average
                              ).astype(np.float32)
        except Exception as e:                       # a missing sibling is
            print(f"  {name}: unreadable ({e})", file=sys.stderr)   # not fatal
            continue
        valid = pan > 0                              # HiRISE ortho nodata is 0
        if valid.mean() < 0.01:
            print(f"  {name}: no coverage here", file=sys.stderr)
            continue

        # Detail = ratio against its own low-pass, so what survives is
        # exactly the texture the Viking mosaic cannot carry. The blur runs
        # over valid pixels only (holes filled with the source mean first),
        # or the wedge edges drag a dark halo into the good data.
        filled = np.where(valid, pan, float(pan[valid].mean()))
        low = ndimage.gaussian_filter(filled, sigma=sigma, mode="nearest")
        r = np.clip(filled / np.maximum(low, 1e-3), *RATIO_CLAMP)

        # Feather each source in from its own edge. A hard footprint
        # boundary reads as a ruled diagonal across the desert — the one
        # artifact guaranteed to look synthetic on otherwise real ground.
        edge = ndimage.distance_transform_edt(valid) / (FEATHER_M / MPP)
        w = np.clip(edge, 0, 1)
        w = w * w * (3 - 2 * w) * (~have)            # only fill what's open
        ratio = ratio * (1 - w) + r * w
        have |= valid & (edge > 0.5)
        print(f"  {name}: +{valid.mean()*100:5.1f}% -> patch {have.mean()*100:5.1f}% closed",
              file=sys.stderr)

    if have.mean() < 0.25:
        sys.exit("patch is mostly nodata — wrong window?")
    print(f"detail ratio p1={np.percentile(ratio,1):.2f} "
          f"p99={np.percentile(ratio,99):.2f}", file=sys.stderr)

    # ── the color layer ─────────────────────────────────────────────────
    g = site["grid"]
    lpx, lpz = site["landing"]["px"]
    vik = np.asarray(Image.open(os.path.join(OUT, site["files"]["albedo"]))
                     .convert("RGB")).astype(np.float32)
    xs = X0 + (np.arange(SIZE_PX) + 0.5) * MPP
    zs = Z0 + (np.arange(SIZE_PX) + 0.5) * MPP
    cols = np.clip(xs / g["mPerPxEW"] + lpx, 0, vik.shape[1] - 1.001)
    rows = np.clip(zs / g["mPerPxNS"] + lpz, 0, vik.shape[0] - 1.001)
    # Bilinear so the 195 m mosaic arrives as a smooth wash, not blocks
    c_i, r_i = cols.astype(int), rows.astype(int)
    fc = (cols - c_i)[None, :, None]
    fr = (rows - r_i)[:, None, None]
    a = vik[np.ix_(r_i, c_i)]
    b = vik[np.ix_(r_i, np.minimum(c_i + 1, vik.shape[1] - 1))]
    c = vik[np.ix_(np.minimum(r_i + 1, vik.shape[0] - 1), c_i)]
    d = vik[np.ix_(np.minimum(r_i + 1, vik.shape[0] - 1),
                   np.minimum(c_i + 1, vik.shape[1] - 1))]
    color = (a * (1 - fc) + b * fc) * (1 - fr) + (c * (1 - fc) + d * fc) * fr

    rgb = np.clip(color * ratio[:, :, None], 0, 255).astype(np.uint8)

    dst = os.path.join(OUT, "hialbedo_v3.webp")
    Image.fromarray(rgb).save(dst, "WEBP", quality=90, method=5)
    mb = os.path.getsize(dst) / 1048576
    print(f"wrote {dst}  {SIZE_PX}x{SIZE_PX} @ {MPP} m/px  {mb:.2f} MB", file=sys.stderr)

    site["hiAlbedo"] = {
        "file": "hialbedo_v3.webp",
        "cols": SIZE_PX, "rows": SIZE_PX, "mpp": MPP,
        "x0": X0, "z0": Z0,
        "feather": 120.0,
        "source": "HiRISE ESP_048689_1670_RED_A_01_ORTHO (UA/NASA), "
                  "pan-sharpened over Viking MDIM2.1 color",
    }
    with open(os.path.join(OUT, "site_v3.json"), "w") as f:
        json.dump(site, f, indent=2)
    print("wrote site_v3.json", file=sys.stderr)


if __name__ == "__main__":
    main()
