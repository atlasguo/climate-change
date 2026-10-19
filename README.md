# Climate Change Visualized

A globe-first visualization for exploring monthly temperature and precipitation anomalies across the planet from 1940 to 2025.

ERA5-derived climate data is shown on an interactive 3D globe with H3 hexagon or grid cells, small chart glyphs in every cell, a dual-handle timeline for comparing periods, and an optional RONI overlay for ENSO context.

By Atlas Guo.

## Highlights

- Temperature and precipitation anomalies against the 1991-2020 baseline, 1940-01 to 2025-12
- Hexagon (H3) and grid spatial units, area-weighted from a 2-degree sample grid
- Pulse, column and cone glyph modes
- Dual-handle timeline for comparing climate periods
- RONI overlay for ENSO-related context

## Run locally

The site is plain HTML, CSS and ES modules with no build step.

```bash
python -m http.server 4173
```

Then open <http://localhost:4173>. (`npm run dev` runs the same command.) Opening `index.html` directly from disk does not work because the data is loaded with `fetch`.

## Deploy on GitHub Pages

1. In the repository settings, open **Pages** and choose **Deploy from a branch**.
2. Select branch `main` and folder `/ (root)`.
3. Keep the empty `.nojekyll` file at the repository root so the files are served as-is.

All runtime data, including the gzip-compressed binary series (about 50 MB), is committed under `data/`. Only the raw ERA5 archive (`data/era5/`) is ignored.

## Data

See [docs/data.md](docs/data.md) for the file formats and how to regenerate the data.

| Source | Use | Licence / attribution |
| --- | --- | --- |
| ERA5 monthly averaged data on single levels, Copernicus Climate Change Service (C3S) | Temperature and precipitation | Copernicus licence. "Contains modified Copernicus Climate Change Service information [2026]." Neither the European Commission nor ECMWF is responsible for any use of this information. |
| NOAA CPC Relative Oceanic Nino Index (RONI) | ENSO overlay | US Government work, public domain |
| Natural Earth | Shaded relief in the basemap | Public domain |
| OpenFreeMap basemap tiles | Basemap, borders and place names | © OpenMapTiles, © OpenStreetMap contributors (ODbL) |
| Terrain Tiles (Mapzen, AWS Open Data) | Terrain basemap hillshade | Open data, attribution required |
| NASA EOSDIS GIBS (Blue Marble, Black Marble) | Relief and Night lights basemaps | Public domain, attribution requested |
| VersaTiles | VersaTiles Dark basemap | CC0 style, © OpenStreetMap contributors |

Place search uses the OpenStreetMap Nominatim service.

## Vendored libraries

Third-party code is vendored in `vendor/` and loaded through an import map in `index.html`; there are no npm runtime dependencies.

- MapLibre GL JS 5.21.1 (`vendor/maplibre-gl/`, BSD-3-Clause)
- h3-js 4.x (`vendor/h3-js/`, Apache-2.0)

## Browser requirements

Current versions of Chrome, Edge, Firefox or Safari with WebGL and `DecompressionStream` support. The layout currently targets desktop screens; a mobile layout is planned.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` / `npm run serve` | Serve the site on port 4173 |
| `npm run check:era5` | Check Python packages and `~/.cdsapirc` |
| `npm run download:era5:monthly` | Download ERA5 monthly means, 1940-2025 |
| `npm run generate:data` | Build the browser data from the ERA5 archive |
| `npm run generate:data:demo` | Write synthetic demo data (overwrites the real data) |
| `npm run update:roni` | Refresh `data/roni.json` from NOAA CPC |

## Status

Version 0.2 - work in progress.
