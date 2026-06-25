# Climate Change Visualized

A globe-first climate visualization built with traditional static HTML, CSS, JavaScript, MapLibre GL, and ERA5-derived monthly assets.

## What it shows

- Global temperature anomaly and precipitation anomaly views
- Hexagon and grid-based map units
- Pulse, column, and cone glyph modes
- A dual-handle timeline with optional RONI overlay

## Local development

```bash
npm install
npm run dev
```

This starts a plain static file server on `http://127.0.0.1:4173/`.

Build:

```bash
npm run build
```

Preview locally:

```bash
npm run preview
```

## Data assets

The app expects browser-ready files in `data/`:

- `metadata.json`
- `cells-medium.json`
- `roni.json`

Generate demo assets:

```bash
npm run generate:data:demo
```

Regenerate real assets from a local ERA5 monthly archive:

```bash
npm run generate:data
```

More detail is in [docs/data.md](docs/data.md).

## Project structure

- `index.html`: static page entry
- `css/`: application styles
- `js/`: browser JavaScript modules
- `vendor/`: browser-loaded third-party libraries
- `data/`: browser-ready climate assets
- `scripts/`: data preparation utilities
- `docs/`: project notes

## Release notes for v0.1

- Public-facing project metadata and README added
- Unused renderer/helpers removed
- Test-only and generated clutter cleaned up
- Startup failure state added for missing data assets
