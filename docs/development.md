# Development

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

## Vendored libraries

Third-party code is vendored in `vendor/` and loaded through an import map in `index.html`; there are no npm runtime dependencies.

- MapLibre GL JS 5.21.1 (`vendor/maplibre-gl/`, BSD-3-Clause)
- h3-js 4.x (`vendor/h3-js/`, Apache-2.0)

## Browser requirements

Current versions of Chrome, Edge, Firefox or Safari with WebGL and `DecompressionStream` support. Desktop and phone layouts are supported.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` / `npm run serve` | Serve the site on port 4173 |
| `npm run check:era5` | Check Python packages and `~/.cdsapirc` |
| `npm run download:era5:monthly` | Download ERA5 monthly means, 1940-2025 |
| `npm run generate:data` | Build the browser data from the ERA5 archive |
| `npm run generate:data:demo` | Write synthetic demo data (overwrites the real data) |
| `npm run update:roni` | Refresh `data/roni.json` from NOAA CPC |

See [data.md](data.md) for the data formats and how to regenerate the data.
