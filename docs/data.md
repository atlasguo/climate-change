# Data Notes

## Period and grid

- Time range: `1940-01` through `2025-12` (1,032 months). The period is fixed; later months are not used.
- Baseline (climatology): `1991-01` through `2020-12`, computed per cell and per calendar month.
- Spatial sampling: every 8th point of the 0.25-degree ERA5 grid (`--stride 8`), i.e. a 2-degree grid. The repeated samples on the `+90` and `-90` latitude rows are collapsed to a single point per pole.

## Runtime files

Everything the browser loads is served as static files from the repository:

| File | Purpose |
| --- | --- |
| `data/metadata.json` | Time axis (`monthLabels`), baseline period, units, data-source credits, cell count and the layout of the binary series. |
| `data/cells.json` | Per-cell coordinates, monthly baselines and trends (see below). |
| `data/temperature.bin.gz` | Monthly temperature anomalies, gzip-compressed binary. |
| `data/precipitation.bin.gz` | Monthly precipitation totals, gzip-compressed binary. |
| `data/roni.json` | NOAA CPC Relative Oceanic Nino Index for the ENSO overlay. |
| `config/visual-palettes.json` | Colour palettes for the temperature and precipitation scales. |
| `styles/globe-dark.json` | MapLibre style for the basemap (tiles are fetched from OpenFreeMap). |

A missing or outdated file shows a startup error instead of a blank page.

## `cells.json`

Column-oriented JSON. For `N` cells:

- `lat`, `lon`: arrays of length `N` (degrees, longitude in `-180..180`).
- `tempBaselineMonthly`: length `N * 12`, cell-major, degC, 1991-2020 mean for January..December.
- `precipBaselineMonthly`: length `N * 12`, cell-major, mm/month, 1991-2020 mean for January..December.
- `tempTrendPerDecade`: length `N`, least-squares trend of the temperature anomaly over the full period, degC per decade.
- `precipTrendPerDecade`: length `N`, trend of the relative precipitation anomaly, percentage points per decade.

## Binary series

Both files are gzip-compressed, little-endian and **cell-major**: all months of cell 0, then all months of cell 1, and so on. Value index = `cell * monthCount + month`, where `monthCount = metadata.monthLabels.length` and cells follow the order of `cells.json`. Each file holds exactly `N * monthCount` values; the browser rejects files whose size does not match `metadata.json`.

| File | Type | Encoding | Decode |
| --- | --- | --- | --- |
| `temperature.bin.gz` | `Int16` | linear, `scale = 0.01` | `anomaly_degC = value * 0.01` |
| `precipitation.bin.gz` | `Uint16` | square root, `scale = 400` | `precip_mm_per_month = (value / 400) ** 2` |

- Temperature values are already anomalies against the 1991-2020 monthly baseline.
- Precipitation values are absolute monthly totals in mm/month. The square-root encoding keeps relative precision for small totals while covering up to about 26,800 mm/month.
- The browser derives the relative precipitation anomaly as `raw / baseline - 1`, using the cell's baseline for that calendar month; when the baseline is `0` the anomaly is `0`.
- `metadata.series` records the file names, types, encodings, scales and compressed sizes; the browser reads the scales from there.
- Files are decompressed in the browser with `DecompressionStream('gzip')`. If a host serves them already decoded (`Content-Encoding: gzip`), the raw bytes are used directly.

## Display values

- The 2-degree samples are grouped into the H3 hexagons or grid squares shown at the current zoom. Each displayed cell shows the **area-weighted mean** (weight `cos(latitude)`) of the samples inside it. Temperature anomalies and raw precipitation are averaged; the relative precipitation anomaly is then recomputed against the averaged baseline. Cells too small to contain a sample (mostly the finest hexagon level) show the nearest sample.
- The default detail view (no cell selected) shows the area-weighted global mean over all samples.

## Sources

- **Climate:** ERA5 monthly averaged data on single levels (`reanalysis-era5-single-levels-monthly-means`), variables `2m_temperature` and `total_precipitation`, from the Copernicus Climate Change Service Climate Data Store. ERA5 `tp` monthly means are metres per day; the build converts them to mm/month using the number of days in each month.
- **ENSO:** NOAA CPC Relative Oceanic Nino Index (RONI), 1950 onwards, clamped to `2025-12`.
- **Reference geography:** country borders and place names come from OpenStreetMap (OpenMapTiles vector tiles served by OpenFreeMap); the basemap shaded relief is Natural Earth.

## Regenerating

### 1. Check the environment

```bash
pip install "cdsapi>=0.7.7" numpy xarray netCDF4
npm run check:era5
```

`~/.cdsapirc` must contain `url: https://cds.climate.copernicus.eu/api` and your personal `key`. The ERA5 licence must be accepted once in the CDS web interface.

### 2. Download the ERA5 archive

```bash
npm run download:era5:monthly
```

This runs `scripts/download_era5_cds.py --mode monthly-means --bundle year --start 1940-01 --end 2025-12 --output-root data/era5`. Each year is requested as one zip and extracted to:

```text
data/era5/derived/monthly-single-levels/
  YYYY/
    era5_monthly_single_levels_YYYY.zip
    era5_monthly_t2m_YYYY.nc
    era5_monthly_tp_YYYY.nc
```

Existing years are skipped only when both NetCDF files contain all 12 months; incomplete years are downloaded again. `--end` cannot be later than `2025-12`. Use `--force` to re-download everything.

`npm run download:era5:raw` optionally archives the hourly GRIB source (one file per month under `data/era5/raw/`). It is very large and is not used by the web app.

### 3. Build the browser assets

```bash
npm run generate:data
```

This runs `scripts/build_climate_assets.py --monthly-dir data/era5/derived/monthly-single-levels --stride 8 --output-dir data` and writes `metadata.json`, `cells.json`, `temperature.bin.gz` and `precipitation.bin.gz`. Defaults are `--start-month 1940-01`, `--end-month 2025-12` and `--stride 8`. The build stops with an error if any month in the range is missing from the archive or if the temperature and precipitation time axes differ.

### Demo data

```bash
npm run generate:data:demo
```

Writes synthetic data on a 4-degree grid for UI work without ERA5. **Warning:** this overwrites the real `data/metadata.json`, `data/cells.json` and binary files. Rebuild with `npm run generate:data` (or restore them from git) afterwards.

### RONI

```bash
npm run update:roni
```

Fetches the CPC RONI page, parses the seasonal table and rewrites `data/roni.json` as `{ source, url, updatedAt, points: [{ season, year, month, monthLabel, anomaly }] }`. Points are clamped to `2025-12`. The file is left unchanged if fewer than 800 points are parsed.

## Tracked and ignored files

- Tracked in git (and therefore deployed): all runtime files listed above, including the binary series.
- Ignored: `data/era5/` (the raw ERA5 archive, several GB).
