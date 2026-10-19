#!/usr/bin/env python3
"""Build the browser data assets from ERA5 monthly grids (or synthetic demo data).

Outputs (all in --output-dir):
  metadata.json            Time axis, baseline, units, sources and binary layout.
  cells.json               Per-cell coordinates, monthly baselines and trends.
  temperature.bin.gz       Int16 little-endian, cell-major, value = anomaly (degC) / 0.01.
  precipitation.bin.gz     Uint16 little-endian, cell-major, value = sqrt(mm/month) * 400.
"""

from __future__ import annotations

import argparse
import calendar
import gzip
import json
import math
from pathlib import Path

import numpy as np

BASELINE_START = "1991-01"
BASELINE_END = "2020-12"
START_MONTH = "1940-01"
LATEST_MONTH = "2025-12"

TEMP_SCALE = 0.01
PRECIP_SQRT_SCALE = 400.0

DATA_SOURCES = [
    {
        "label": "Climate",
        "text": "ERA5 monthly averaged reanalysis (Copernicus Climate Change Service)",
        "url": "https://cds.climate.copernicus.eu/",
        "linkLabel": "CDS",
    },
    {
        "label": "ENSO",
        "text": "NOAA CPC Relative Oceanic Nino Index (RONI)",
        "url": "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/",
        "linkLabel": "CPC",
    },
]


def month_labels(start: str, end: str) -> list[str]:
    labels: list[str] = []
    year, month = map(int, start.split("-"))
    end_year, end_month = map(int, end.split("-"))
    while (year, month) <= (end_year, end_month):
        labels.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            month = 1
            year += 1
    return labels


def normalize_longitude(lon: float) -> float:
    normalized = ((lon + 180.0) % 360.0) - 180.0
    return 180.0 if normalized == -180.0 else normalized


def load_monthly_dir(monthly_dir: Path, stride: int, start_month: str, end_month: str):
    """Return (lats[N], lons[N], months[T], temp_c[N,T], precip_mm[N,T])."""
    import xarray as xr

    temp_files = sorted(monthly_dir.rglob("era5_monthly_t2m_*.nc"))
    precip_files = {p.stem.replace("era5_monthly_tp_", ""): p for p in monthly_dir.rglob("era5_monthly_tp_*.nc")}
    if not temp_files:
        raise SystemExit(f"No era5_monthly_t2m_*.nc files found under {monthly_dir}")

    stride = max(1, int(stride))
    grid_lats = grid_lons = None
    temp_by_month: dict[str, np.ndarray] = {}
    precip_by_month: dict[str, np.ndarray] = {}

    for temp_path in temp_files:
        token = temp_path.stem.replace("era5_monthly_t2m_", "")
        precip_path = precip_files.get(token)
        if not precip_path:
            raise SystemExit(f"Missing precipitation file for {temp_path.name}")

        with xr.open_dataset(temp_path, engine="netcdf4") as ds_temp, xr.open_dataset(precip_path, engine="netcdf4") as ds_precip:
            lats = ds_temp["latitude"].values[::stride].astype("float64")
            lons = ds_temp["longitude"].values[::stride].astype("float64")
            if grid_lats is None:
                grid_lats, grid_lons = lats, lons
            elif not (np.array_equal(lats, grid_lats) and np.array_equal(lons, grid_lons)):
                raise SystemExit(f"Grid in {temp_path.name} does not match earlier files")

            time_coord = "valid_time" if "valid_time" in ds_temp.coords else "time"
            p_time_coord = "valid_time" if "valid_time" in ds_precip.coords else "time"
            temp_times = [str(v)[:7] for v in ds_temp[time_coord].values]
            precip_times = [str(v)[:7] for v in ds_precip[p_time_coord].values]
            if temp_times != precip_times:
                raise SystemExit(f"Time axes differ between {temp_path.name} and {precip_path.name}")

            temp_data = ds_temp["t2m"][:, ::stride, ::stride].values
            precip_data = ds_precip["tp"][:, ::stride, ::stride].values

        for index, label in enumerate(temp_times):
            if not (start_month <= label <= end_month):
                continue
            year, month = int(label[:4]), int(label[5:7])
            days = calendar.monthrange(year, month)[1]
            temp_by_month[label] = temp_data[index].astype("float64") - 273.15
            # ERA5 monthly means of tp are metres per day.
            precip_by_month[label] = np.maximum(precip_data[index].astype("float64"), 0.0) * 1000.0 * days

    months = month_labels(start_month, end_month)
    missing = [label for label in months if label not in temp_by_month]
    if missing:
        raise SystemExit(f"Missing {len(missing)} month(s) in the archive, e.g. {missing[:5]}")

    lat_grid, lon_grid = np.meshgrid(grid_lats, [normalize_longitude(v) for v in grid_lons], indexing="ij")
    temp = np.stack([temp_by_month[m].ravel() for m in months], axis=1)
    precip = np.stack([precip_by_month[m].ravel() for m in months], axis=1)
    return lat_grid.ravel(), lon_grid.ravel(), months, temp, precip


def generate_demo(start_month: str, end_month: str):
    months = month_labels(start_month, end_month)
    lats, lons = np.meshgrid(np.arange(-80, 81, 4, dtype="float64"), np.arange(-180, 180, 4, dtype="float64"), indexing="ij")
    lats, lons = lats.ravel(), lons.ravel()
    t = np.arange(len(months), dtype="float64")
    month_of_year = np.array([int(m[5:7]) - 1 for m in months], dtype="float64")
    rng = np.random.default_rng(42)

    lat_factor = np.abs(lats)[:, None] / 72
    seasonal = 12 * np.cos(month_of_year[None, :] / 12 * math.tau) * np.sign(lats + 0.1)[:, None] * lat_factor
    warming = (0.012 + lat_factor * 0.012) * t[None, :] / 12
    temp = 15 - 25 * lat_factor + seasonal + warming + rng.normal(0, 0.6, (lats.size, t.size))

    base = 28 + (1 - np.abs(lats) / 90)[:, None] * 175
    cycle = 1 + 0.4 * np.sin(month_of_year[None, :] / 12 * math.tau + lons[:, None] / 180 * math.pi)
    precip = np.maximum(1.0, base * cycle * rng.uniform(0.6, 1.4, (lats.size, t.size)))
    return lats, lons, months, temp, precip


def drop_duplicate_pole_points(lats, lons, temp, precip):
    """Keep only one sample at each pole (lat = +/-90 rows repeat the same value)."""
    keep = np.ones(lats.size, dtype=bool)
    for pole in (90.0, -90.0):
        rows = np.flatnonzero(np.isclose(lats, pole))
        if rows.size > 1:
            keep[rows[1:]] = False
            lons = lons.copy()
            lons[rows[0]] = 0.0
    return lats[keep], lons[keep], temp[keep], precip[keep]


def trend_per_decade(series: np.ndarray) -> np.ndarray:
    t = np.arange(series.shape[1], dtype="float64")
    t -= t.mean()
    slope = (series - series.mean(axis=1, keepdims=True)) @ t / (t @ t)
    return slope * 120


def build_assets(lats, lons, months, temp, precip):
    if BASELINE_START not in months or BASELINE_END not in months:
        raise SystemExit(f"Time range must include the {BASELINE_START}..{BASELINE_END} baseline.")
    month_of_year = np.array([int(m[5:7]) - 1 for m in months])
    in_baseline = np.array([BASELINE_START <= m <= BASELINE_END for m in months])

    temp_baseline = np.stack([temp[:, in_baseline & (month_of_year == k)].mean(axis=1) for k in range(12)], axis=1)
    precip_baseline = np.stack([precip[:, in_baseline & (month_of_year == k)].mean(axis=1) for k in range(12)], axis=1)

    temp_anomaly = temp - temp_baseline[:, month_of_year]
    precip_q = np.clip(np.rint(np.sqrt(precip) * PRECIP_SQRT_SCALE), 0, 65535).astype("<u2")
    precip_decoded = (precip_q.astype("float64") / PRECIP_SQRT_SCALE) ** 2
    expected = precip_baseline[:, month_of_year]
    precip_relative = np.where(expected > 0, precip_decoded / np.where(expected > 0, expected, 1) - 1, 0.0)

    temp_q = np.clip(np.rint(temp_anomaly / TEMP_SCALE), -32768, 32767).astype("<i2")
    if np.abs(temp_anomaly).max() / TEMP_SCALE > 32767:
        raise SystemExit("Temperature anomaly exceeds the Int16 encoding range.")

    cells = {
        "lat": np.round(lats, 3).tolist(),
        "lon": np.round(lons, 3).tolist(),
        "tempBaselineMonthly": np.round(temp_baseline, 2).ravel().tolist(),
        "precipBaselineMonthly": np.round(precip_baseline, 3).ravel().tolist(),
        "tempTrendPerDecade": np.round(trend_per_decade(temp_anomaly), 3).tolist(),
        "precipTrendPerDecade": np.round(trend_per_decade(precip_relative * 100), 3).tolist(),
    }
    return cells, temp_q, precip_q


def write_assets(output_dir: Path, months, cells, temp_q, precip_q, source_name: str, resolution_label: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    cell_count, month_count = temp_q.shape
    metadata = {
        "title": "Climate Change Visualized",
        "startMonth": months[0],
        "latestMonth": months[-1],
        "baselineStart": BASELINE_START,
        "baselineEnd": BASELINE_END,
        "source": source_name,
        "resolution": resolution_label,
        "units": {
            "temperature": "℃ anomaly",
            "precipitation": "relative anomaly",
            "precipitationRaw": "mm/month",
        },
        "dataSources": DATA_SOURCES,
        "monthLabels": months,
        "cellCount": cell_count,
        "series": {
            "layout": "cell-major",
            "temperature": {"file": "temperature.bin.gz", "type": "int16", "encoding": "linear", "scale": TEMP_SCALE},
            "precipitation": {"file": "precipitation.bin.gz", "type": "uint16", "encoding": "sqrt", "scale": PRECIP_SQRT_SCALE},
        },
    }
    assert month_count == len(months)

    for key, array in (("temperature", temp_q), ("precipitation", precip_q)):
        path = output_dir / metadata["series"][key]["file"]
        with gzip.GzipFile(path, "wb", compresslevel=9, mtime=0) as handle:
            handle.write(np.ascontiguousarray(array).tobytes())
        metadata["series"][key]["bytes"] = path.stat().st_size

    (output_dir / "cells.json").write_text(json.dumps(cells, separators=(",", ":")), encoding="utf-8")
    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--monthly-dir", type=Path, help="Directory containing era5_monthly_t2m_YYYY.nc / era5_monthly_tp_YYYY.nc files.")
    source.add_argument("--demo", action="store_true", help="Generate synthetic demo data instead of reading ERA5.")
    parser.add_argument("--start-month", default=START_MONTH, help="First month to include (YYYY-MM).")
    parser.add_argument("--end-month", default=LATEST_MONTH, help="Last month to include (YYYY-MM).")
    parser.add_argument("--stride", type=int, default=8, help="Spatial stride on the 0.25 degree ERA5 grid (8 = 2 degrees).")
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.start_month > args.end_month:
        raise SystemExit("--start-month must be earlier than or equal to --end-month.")

    if args.demo:
        lats, lons, months, temp, precip = generate_demo(args.start_month, args.end_month)
        source_name, resolution_label = "synthetic-demo", "demo-grid-4deg"
    else:
        lats, lons, months, temp, precip = load_monthly_dir(args.monthly_dir, args.stride, args.start_month, args.end_month)
        lats, lons, temp, precip = drop_duplicate_pole_points(lats, lons, temp, precip)
        source_name = "era5-monthly-single-levels"
        resolution_label = f"era5-monthly-grid-stride-{max(1, args.stride)}"

    cells, temp_q, precip_q = build_assets(lats, lons, months, temp, precip)
    write_assets(args.output_dir, months, cells, temp_q, precip_q, source_name, resolution_label)
    print(f"Wrote {temp_q.shape[0]} cells x {temp_q.shape[1]} months to {args.output_dir}")


if __name__ == "__main__":
    main()
