# Mars DEM bake pipeline

Turns real NASA/USGS Mars elevation + color into the groundside site assets
under `public/locations/mars-valles/` (served from R2 in production — the
`locations/` prefix is already in `public/.assetsignore` and routed by the
worker; upload the baked files to the `solace-media` bucket on deploy).

Per Pillar 5 of `docs/LOOP.md`: real places, hand-signed. The macro terrain
is genuine HRSC/MOLA elevation; only sub-200m micro-detail is synthesized
at runtime (the render and the walk collision share one height function).

## Run

```sh
python3 -m venv .venv && .venv/bin/pip install numpy rasterio pillow
.venv/bin/python bake_site.py
```

Reads two windowed crops (a few MB) over HTTP range requests from the USGS
Astrogeology S3 mirror — no bulk downloads. Re-running is deterministic.

## Versioning

R2 media is served `immutable`. Never overwrite `*_v1.*` — bump the
version in `bake_site.py` outputs and in the site loader together.

## The site

Eastern Coprates Chasma, Valles Marineris, centered (-61.00 E, -13.20 N),
~96 × 104 km, ~9.4 km relief. Chosen by eye 2026-07-30: full fluted north
wall, wide floor with a central inselberg ridge, Coprates Montes south.
The west edge of the raw crop has an HRSC seam artifact; `TRIM_W` cuts it.
