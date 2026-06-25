# Data Notes

## Runtime inputs

The web app loads three browser-ready files from `data/`:

- `metadata.json`
- `cells-medium.json`
- `roni.json`

These are the only data files required to run the client application.

## Source datasets

Primary climate source:

- ERA5 monthly averaged single-level data
- Variables: `2m_temperature`, `total_precipitation`
- Coverage used by this project: `1940-01` through `2025-12`

ENSO overlay source:

- NOAA CPC Relative Oceanic Nino Index (RONI)

## Asset generation

Generate demo assets for UI development:

```bash
npm run generate:data:demo
```

Generate real browser assets from a local ERA5 monthly archive:

```bash
npm run generate:data
```

Update the RONI file:

```bash
npm run update:roni
```

## Expected local layout

```text
data/
  metadata.json
  cells-medium.json
  roni.json

scripts/
  build_climate_assets.py
  update_roni_data.mjs
```

## Notes

- `data/` is treated as local working storage and is ignored by git.
- The shipped site reads from `data/` only.
- Missing files in `data/` now surface a friendly startup error instead of a blank page.
