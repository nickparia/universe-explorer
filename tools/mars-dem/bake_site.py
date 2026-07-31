#!/usr/bin/env python3
"""Bake the Mars Valles (Coprates Chasma) groundside site assets.

Source of truth: USGS Mars HRSC/MOLA Blended DEM Global 200m v2 (elevation)
and Mars Viking MDIM2.1 Colorized Global Mosaic 232m (albedo), both read as
remote windowed crops from the USGS/ASC S3 mirror — no bulk downloads.

Outputs (versioned; R2 media is cached immutable, so bump the version on
any change and never overwrite):
  public/locations/mars-valles/dem_v1.bin    int16 LE, row-major, north row first
  public/locations/mars-valles/albedo_v1.jpg real Viking color, same extent
  public/locations/mars-valles/site_v1.json  grid geometry + landing origin

Needs: numpy, rasterio, pillow (see README.md).
"""
import json
import os
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import Window

os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")

S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic"
DEM_URL = f"/vsicurl/{S3}/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
CLR_URL = f"/vsicurl/{S3}/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif"

M_PER_DEG = 59274.7  # Mars 2000 sphere, at the equator

# The site: eastern Coprates Chasma. Chosen by eye 2026-07-30 — full north
# wall with fluted spurs, wide floor, central inselberg ridge, Coprates
# Montes across the south. ~9.4 km of relief.
LON_C, LAT_C = -61.00, -13.20
HALF_KM = 52.0
TRIM_W = 40  # px trimmed off the west edge: HRSC seam artifact in the blend

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "locations", "mars-valles")


def window_for(ds, lon_c, lat_c, half_km):
    W, H = ds.width, ds.height
    dlon = half_km * 1000 / (M_PER_DEG * np.cos(np.radians(lat_c)))
    dlat = half_km * 1000 / M_PER_DEG
    px0 = int((lon_c - dlon + 180) / 360 * W)
    px1 = int((lon_c + dlon + 180) / 360 * W)
    py0 = int((90 - (lat_c + dlat)) / 180 * H)
    py1 = int((90 - (lat_c - dlat)) / 180 * H)
    return Window(px0, py0, px1 - px0, py1 - py0), (px0, py0, W, H)


def main():
    os.makedirs(OUT, exist_ok=True)

    print("reading DEM window …", file=sys.stderr)
    with rasterio.open(DEM_URL) as ds:
        win, (px0, py0, W, H) = window_for(ds, LON_C, LAT_C, HALF_KM)
        dem = ds.read(1, window=win).astype(np.float32)
        deg_per_px = 360 / W
        west = -180 + (px0 + TRIM_W) * deg_per_px
        north = 90 - py0 * 180 / H

    dem = dem[:, TRIM_W:]
    rows, cols = dem.shape
    assert (dem > -32000).all(), "nodata present in crop"

    m_per_px_ns = deg_per_px * M_PER_DEG
    m_per_px_ew = m_per_px_ns * np.cos(np.radians(LAT_C))

    # Landing origin: a flat spur SHELF partway up the north wall —
    # bootfall faces south over a 3.9 km drop to the canyon floor with
    # the fluted upper wall climbing 2.4 km behind. From the floor a
    # 100 km-wide canyon's walls never tower (the first bench hides
    # them); from the shelf, the whole canyon is the vista. Chosen
    # 2026-07-31 with a sightline search (no early southward block).
    gy, gx = np.gradient(dem, m_per_px_ns, m_per_px_ew)
    slope = np.hypot(gx, gy)
    y0, y1, x0, x1 = 90, 135, 250, 380
    region = slope[y0:y1, x0:x1].copy()
    # shelf band, not floor and not rim
    e = dem[y0:y1, x0:x1]
    region[(e < -2600) | (e > -900)] = 9e9

    # The vista must be REAL from eye height: reject any shelf whose
    # southward sightline is blocked early (a bench that hides the
    # floor turns the money shot into a plain).
    def south_view_open(px, py):
        e0 = dem[py, px] + 2.0
        min_ang = 90.0
        for y in range(py + 2, min(rows - 1, py + 100)):
            d = (y - py) * m_per_px_ns
            ang = np.degrees(np.arctan((dem[y, px] - e0) / d))
            if ang < min_ang:
                min_ang = ang
            elif ang > min_ang + 0.01 and dem[y, px] > e0 - 500:
                return False
        return min_ang < -10.0

    order = np.argsort(region, axis=None)
    ly = lx = None
    for flat_idx in order[:200]:
        yy, xx = np.unravel_index(flat_idx, region.shape)
        if region[yy, xx] > 1e8:
            break
        if south_view_open(xx + x0, yy + y0):
            ly, lx = yy + y0, xx + x0
            break
    assert ly is not None, "no open-vista shelf found"
    print(f"landing px ({lx},{ly}) elev {dem[ly,lx]:.0f} m slope {slope[ly,lx]*100:.1f}%",
          file=sys.stderr)

    print("reading Viking color window …", file=sys.stderr)
    with rasterio.open(CLR_URL) as ds:
        cwin, _ = window_for(ds, LON_C, LAT_C, HALF_KM)
        rgb = ds.read([1, 2, 3], window=cwin)
    rgb = np.moveaxis(rgb, 0, -1)

    # Hand-signing pass: the Viking mosaic carries baked-in bluish
    # frost/cloud on the upper walls — standing on a white patch reads
    # as snow, not Mars. Clamp every pixel's hue into the red-ochre
    # band and floor the saturation, preserving luminance/shading.
    f = rgb.astype(np.float32) / 255.0
    lum = f @ np.array([0.299, 0.587, 0.114], np.float32)
    mx, mn = f.max(-1), f.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    # target: the scene's median chromatic direction (a real Mars red)
    warm = np.array([1.0, 0.62, 0.38], np.float32)
    warm /= (warm @ np.array([0.299, 0.587, 0.114], np.float32))
    k = np.clip((0.40 - sat) / 0.40, 0, 1) * 0.95  # only desaturated pixels move
    blue_excess = np.clip(f[..., 2] - f[..., 0] * 0.75, 0, 1) * 3.0
    k = np.maximum(k, np.clip(blue_excess, 0, 1))
    # bright pale patches (frost/cloud) get pulled hardest
    k = np.maximum(k, np.clip((lum - 0.62) * 3.0, 0, 1) * np.clip((0.5 - sat) / 0.5, 0, 1))
    tinted = lum[..., None] * warm[None, None, :]
    f = f * (1 - k[..., None]) + tinted * k[..., None]
    rgb = (np.clip(f, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(rgb).resize((cols, rows), Image.LANCZOS)
    # match the DEM trim proportionally: the color window covers the
    # untrimmed extent, so crop the same western fraction before resize
    full_cols = cols + TRIM_W
    img_full = Image.fromarray(rgb).resize((full_cols, rows), Image.LANCZOS)
    img = img_full.crop((TRIM_W, 0, full_cols, rows))
    img.save(os.path.join(OUT, "albedo_v1.jpg"), quality=90)

    dem_i16 = np.round(dem).astype("<i2")
    dem_i16.tofile(os.path.join(OUT, "dem_v1.bin"))

    meta = {
        "id": "mars-valles",
        "name": "COPRATES CHASMA",
        "body": "MARS",
        "source": {
            "dem": "Mars HRSC/MOLA Blended DEM Global 200m v2 (USGS Astrogeology)",
            "albedo": "Mars Viking MDIM2.1 Colorized Global Mosaic 232m (USGS)",
        },
        "grid": {
            "cols": int(cols),
            "rows": int(rows),
            "mPerPxEW": round(float(m_per_px_ew), 2),
            "mPerPxNS": round(float(m_per_px_ns), 2),
            "elevMin": float(dem.min()),
            "elevMax": float(dem.max()),
            "westLon": round(float(west), 5),
            "northLat": round(float(north), 5),
            "latC": LAT_C,
        },
        "landing": {
            "px": [int(lx), int(ly)],
            "elev": float(dem[ly, lx]),
        },
        "files": {"dem": "dem_v1.bin", "albedo": "albedo_v1.jpg"},
    }
    with open(os.path.join(OUT, "site_v1.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"baked {cols}x{rows} grid, {cols*m_per_px_ew/1000:.1f} x {rows*m_per_px_ns/1000:.1f} km",
          file=sys.stderr)


if __name__ == "__main__":
    main()
