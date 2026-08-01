#!/usr/bin/env python3
"""Bake the HiRISE 1 m layer into the Mars Valles site (v2).

Input: DTEEC_048689_1670_048610_1670_A01.IMG (HiRISE stereo DTM,
1.01 m/px, eastern Coprates north-wall foot) — pass its local path as
argv[1]. The global 200 m site (dem_v1/albedo_v1) is reused untouched.

Outputs:
  public/locations/mars-valles/hidem_v2.bin  int16 decimeters rel. elevBase
  public/locations/mars-valles/site_v2.json  v1 grid + hires block + new
                                             landing ON the 1 m ground

The nodata wedges of the diagonal footprint are pre-blended with the
200 m DEM here, so the runtime treats the rectangle as fully valid and
only feathers the rectangle edge.
"""
import json
import os
import sys

import numpy as np
import rasterio
from scipy import ndimage

M = 59274.7
HIRES_MPP = 3.0     # resample target, m/px

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "locations", "mars-valles")


def main(img_path):
    site = json.load(open(os.path.join(OUT, "site_v1.json")))
    g = site["grid"]
    dem_lo = np.fromfile(os.path.join(OUT, "dem_v1.bin"), dtype="<i2").astype(np.float32)
    dem_lo = dem_lo.reshape(g["rows"], g["cols"])

    with rasterio.open(img_path) as ds:
        hi = ds.read(1).astype(np.float32)
        crs = ds.crs.to_dict()
        b = ds.bounds
        clon, lat_ts = crs.get("lon_0", 0), crs.get("lat_ts", 0)
    nod = hi < -1e30
    print(f"hi {hi.shape}, valid {(~nod).mean()*100:.0f}%", file=sys.stderr)

    # Geographic placement → site-grid meters (x east of west edge,
    # z south of north edge)
    lon_l = clon + b.left / (M * np.cos(np.radians(lat_ts)))
    lon_l = lon_l - 360 if lon_l > 180 else lon_l
    lat_top = b.top / M
    gx0 = (lon_l - g["westLon"]) * np.cos(np.radians(g["latC"])) * M
    gz0 = (g["northLat"] - lat_top) * M
    print(f"patch at site meters x {gx0:.0f}, z {gz0:.0f}", file=sys.stderr)

    # Resample to HIRES_MPP by block-averaging (nodata-aware)
    f = int(round(HIRES_MPP / 1.0108))
    H, W = hi.shape
    H2, W2 = H // f, W // f
    hic = hi[:H2 * f, :W2 * f].reshape(H2, f, W2, f)
    nodc = nod[:H2 * f, :W2 * f].reshape(H2, f, W2, f)
    w = (~nodc).sum(axis=(1, 3))
    s = np.where(nodc, 0, hic).sum(axis=(1, 3))
    hi3 = np.where(w > 0, s / np.maximum(w, 1), np.nan)
    mpp = 1.0108 * f
    print(f"resampled {hi3.shape} at {mpp:.2f} m/px", file=sys.stderr)

    # Lo DEM sampled onto the hi grid (bilinear via map_coordinates)
    zz = (gz0 + (np.arange(H2) + 0.5) * mpp) / g["mPerPxNS"]
    xx = (gx0 + (np.arange(W2) + 0.5) * mpp) / g["mPerPxEW"]
    ZZ, XX = np.meshgrid(zz, xx, indexing="ij")
    lo_on_hi = ndimage.map_coordinates(dem_lo, [ZZ, XX], order=1, mode="nearest")

    # Vertical co-registration: HiRISE DTMs are MOLA-controlled but a
    # constant offset of a few meters is common — remove the median
    # difference over valid ground.
    valid = ~np.isnan(hi3)
    off = np.nanmedian((hi3 - lo_on_hi)[valid])
    hi3 -= off
    print(f"vertical offset removed: {off:.1f} m", file=sys.stderr)

    # Pre-blend the nodata wedges: weight = blurred, eroded validity
    wmask = ndimage.binary_erosion(valid, iterations=8).astype(np.float32)
    wmask = ndimage.gaussian_filter(wmask, 12)
    hi_final = np.where(valid, hi3, lo_on_hi) * wmask + lo_on_hi * (1 - wmask)
    hi_final = np.where(np.isnan(hi_final), lo_on_hi, hi_final)

    # Landing: flat 1 m ground with an open southward vista. Slope from
    # the real hi data; view checked on the lo grid (far field).
    gy, gx = np.gradient(hi_final, mpp)
    slope = np.hypot(gx, gy)
    slope_s = ndimage.uniform_filter(slope, 5)
    best, best_px = None, None
    step = max(1, int(20 / mpp))
    # Real 1 m ground is rough everywhere — relax the flatness gate in
    # stages until a stance exists.
    for slope_max in (0.05, 0.09, 0.14):
        for r in range(int(H2 * 0.25), int(H2 * 0.95), step):
            for c in range(int(W2 * 0.2), int(W2 * 0.8), step):
                if not wmask[r, c] > 0.95 or slope_s[r, c] > slope_max:
                    continue
                e0 = hi_final[r, c]
                # NEAR clearance at eye height: the first 400 m south
                # must not rise above the gaze — a vista scored on the
                # far grid alone spawned the boots facing a hillside.
                eye = e0 + 1.65
                blocked = False
                for dm in range(12, 400, 12):
                    rr = r + int(dm / mpp)
                    if rr >= H2: break
                    if (hi_final[rr, c] - eye) / dm > 0.02:
                        blocked = True
                        break
                if blocked:
                    continue
                # southward drop on the lo grid over 6 km
                zpx = (gz0 + r * mpp) / g["mPerPxNS"]
                xpx = (gx0 + c * mpp) / g["mPerPxEW"]
                z6 = min(g["rows"] - 1, int(zpx + 6000 / g["mPerPxNS"]))
                drop = e0 - dem_lo[z6, int(xpx)]
                # northward wall rise over 8 km
                z8 = max(0, int(zpx - 8000 / g["mPerPxNS"]))
                rise = dem_lo[z8, int(xpx)] - e0
                score = drop * 1.0 + rise * 0.5 - slope_s[r, c] * 20000
                if drop > 500 and (best is None or score > best):
                    best, best_px = score, (r, c)
        if best_px:
            print(f"landing found at slope gate {slope_max}", file=sys.stderr)
            break
    assert best_px, "no landing found on the hi patch"
    lr, lc = best_px
    land_elev = float(hi_final[lr, lc])
    land_gx = gx0 + lc * mpp
    land_gz = gz0 + lr * mpp
    land_col = land_gx / g["mPerPxEW"]
    land_row = land_gz / g["mPerPxNS"]
    print(f"landing: hi px ({lc},{lr}) site px ({land_col:.1f},{land_row:.1f}) "
          f"elev {land_elev:.0f}", file=sys.stderr)

    # Store relative decimeters (int16 range ±3276 m around elevBase)
    elev_base = float(np.round(np.nanmean(hi_final)))
    enc = np.clip(np.round((hi_final - elev_base) * 10), -32700, 32700).astype("<i2")
    enc.tofile(os.path.join(OUT, "hidem_v2.bin"))

    meta = dict(site)
    meta["landing"] = {
        "px": [round(land_col, 2), round(land_row, 2)],
        "elev": land_elev,
        "yaw": 3.1416 + 0.25,
        "pitch": -0.15,
    }
    meta["files"] = dict(site["files"])
    meta["files"]["hidem"] = "hidem_v2.bin"
    meta["hires"] = {
        "cols": int(W2), "rows": int(H2), "mPerPx": round(float(mpp), 4),
        "elevBase": elev_base,
        # local-frame origin of the patch (relative to the NEW landing)
        "x0": round(float(gx0 - land_gx), 2),
        "z0": round(float(gz0 - land_gz), 2),
        "source": "HiRISE DTEEC_048689_1670_048610_1670_A01 (UA/NASA)",
    }
    meta["source"]["hidem"] = meta["hires"]["source"]
    with open(os.path.join(OUT, "site_v2.json"), "w") as f2:
        json.dump(meta, f2, indent=1)
    print(f"baked hidem_v2.bin ({enc.nbytes/1e6:.1f} MB) + site_v2.json", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
