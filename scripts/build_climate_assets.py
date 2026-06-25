#!/usr/bin/env python3
"""Generate climate visualization assets from ERA5-style monthly grids or demo data."""

from __future__ import annotations

import argparse
import calendar
import json
import math
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence


BASELINE_START = "1991-01"
BASELINE_END = "2020-12"
START_MONTH = "1940-01"
LATEST_MONTH = "2025-12"


@dataclass
class CellRecord:
    cell_id: str
    lat: float
    lon: float
    temp_series: List[float]
    precip_series: List[float]
    precip_raw_series: List[float]
    temp_baseline_monthly: List[float]
    precip_baseline_monthly: List[float]
    temp_trend_per_decade: float
    precip_trend_per_decade: float

    def to_dict(self) -> dict:
        return {
            "id": self.cell_id,
            "lat": self.lat,
            "lon": self.lon,
            "tempSeries": self.temp_series,
            "precipSeries": self.precip_series,
            "precipRawSeries": self.precip_raw_series,
            "tempBaselineMonthly": self.temp_baseline_monthly,
            "precipBaselineMonthly": self.precip_baseline_monthly,
            "tempTrendPerDecade": self.temp_trend_per_decade,
            "precipTrendPerDecade": self.precip_trend_per_decade,
        }


def month_labels(start: str, end: str) -> List[str]:
    labels: List[str] = []
    year, month = map(int, start.split("-"))
    end_year, end_month = map(int, end.split("-"))
    while (year, month) <= (end_year, end_month):
      labels.append(f"{year:04d}-{month:02d}")
      month += 1
      if month > 12:
          month = 1
          year += 1
    return labels


MONTHS = month_labels(START_MONTH, LATEST_MONTH)


def month_in_range(label: str, start_month: str, end_month: str) -> bool:
    return start_month <= label <= end_month


def baseline_index_range(months: Sequence[str]) -> tuple[int, int]:
    if BASELINE_START in months and BASELINE_END in months:
        return months.index(BASELINE_START), months.index(BASELINE_END) + 1

    overlap = [
        index
        for index, label in enumerate(months)
        if BASELINE_START <= label <= BASELINE_END
    ]
    if overlap:
        return overlap[0], overlap[-1] + 1

    return 0, len(months)


def round_series(values: Iterable[float], digits: int = 3) -> List[float]:
    return [round(float(value), digits) for value in values]


def linear_trend_per_decade(values: Sequence[float]) -> float:
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    numerator = sum((idx - x_mean) * (value - y_mean) for idx, value in enumerate(values))
    denominator = sum((idx - x_mean) ** 2 for idx in range(n)) or 1
    slope_per_month = numerator / denominator
    return round(slope_per_month * 120, 3)


def monthly_climatology(series: Sequence[float], start: int, end: int) -> List[float]:
    values: List[List[float]] = [[] for _ in range(12)]
    for idx in range(start, end):
        values[idx % 12].append(series[idx])
    return [sum(month_values) / len(month_values) for month_values in values]


def deterministic_noise(seed: float) -> float:
    return math.sin(seed * 12.9898) * 43758.5453 % 1.0


def generate_demo_cells() -> List[CellRecord]:
    baseline_start_idx, baseline_end_idx = baseline_index_range(MONTHS)
    cells: List[CellRecord] = []
    latitudes = [lat for lat in range(-80, 81, 4)]
    longitudes = [lon for lon in range(-180, 180, 4)]

    for lat in latitudes:
        for lon in longitudes:
            lat_factor = abs(lat) / 72
            oceanicity = 0.6 + 0.4 * math.sin(math.radians(lon * 1.7))
            temp_values: List[float] = []
            precip_raw: List[float] = []

            for idx, month_label in enumerate(MONTHS):
                year = int(month_label[:4])
                month = int(month_label[5:7]) - 1
                years_since_start = idx / 12
                warming_rate = 0.012 + lat_factor * 0.012 + (1 - oceanicity) * 0.004
                low_freq = 0.25 * math.sin(years_since_start / 4.7 + lon * 0.03)
                interannual = 0.15 * math.cos(years_since_start / 2.1 + lat * 0.04)
                monthly_noise = (deterministic_noise(idx * 0.13 + lat * 0.17 + lon * 0.19) - 0.5) * 0.11
                temp_value = (
                    -0.35
                    + warming_rate * years_since_start
                    + low_freq
                    + interannual
                    + monthly_noise
                )
                temp_values.append(temp_value)

                baseline_precip = (
                    28
                    + (1 - abs(lat) / 90) * 175
                    + 28 * math.sin(math.radians(lon * 2.4))
                    + 12 * math.cos(math.radians(lat * 1.6))
                )
                seasonal_phase = lon / 180 * math.pi
                seasonal_strength = 0.18 + (1 - lat_factor) * 0.42
                seasonal_cycle = 1 + seasonal_strength * math.sin((month / 12) * math.tau + seasonal_phase)
                precip_trend = 1 + ((lat / 90) * 0.0018 + (1 - lat_factor) * 0.0012) * idx
                precip_variability = 1 + 0.12 * math.sin(years_since_start / 3.8 + lat * 0.09)
                precip_noise = 0.88 + deterministic_noise(idx * 0.21 + lon * 0.31 + lat * 0.11) * 0.26
                precip_raw.append(
                    max(4.0, baseline_precip * seasonal_cycle * precip_trend * precip_variability * precip_noise)
                )

            temp_baseline = monthly_climatology(temp_values, baseline_start_idx, baseline_end_idx)
            precip_baseline = monthly_climatology(precip_raw, baseline_start_idx, baseline_end_idx)

            temp_series = [
                temp_values[idx] - temp_baseline[idx % 12]
                for idx in range(len(MONTHS))
            ]
            precip_series = [
                ((precip_raw[idx] - precip_baseline[idx % 12]) / precip_baseline[idx % 12])
                for idx in range(len(MONTHS))
            ]

            cells.append(
                CellRecord(
                    cell_id=f"{lat:+03d}_{lon:+04d}",
                    lat=round(lat + (deterministic_noise(lat * 0.7 + lon) - 0.5) * 1.1, 3),
                    lon=round(lon + (deterministic_noise(lon * 0.4 + lat) - 0.5) * 1.6, 3),
                    temp_series=round_series(temp_series),
                    precip_series=round_series(precip_series),
                    precip_raw_series=round_series(precip_raw),
                    temp_baseline_monthly=round_series(temp_baseline),
                    precip_baseline_monthly=round_series(precip_baseline),
                    temp_trend_per_decade=linear_trend_per_decade(temp_series),
                    precip_trend_per_decade=linear_trend_per_decade([value * 100 for value in precip_series]),
                )
            )

    return cells


def maybe_load_real_data(
    temp_path: Path | None,
    precip_path: Path | None,
    stride: int,
    start_month: str,
    end_month: str,
) -> List[CellRecord]:
    if not temp_path or not precip_path:
        return []

    try:
        import numpy as np
        import xarray as xr
    except ImportError as exc:
        raise SystemExit(
            "Reading ERA5 NetCDF files requires xarray and numpy. Install them or run with --demo."
        ) from exc

    ds_temp = xr.open_dataset(temp_path)
    ds_precip = xr.open_dataset(precip_path)

    temp_var = next((name for name in ds_temp.data_vars if ds_temp[name].ndim >= 3), None)
    precip_var = next((name for name in ds_precip.data_vars if ds_precip[name].ndim >= 3), None)
    if not temp_var or not precip_var:
        raise SystemExit("Could not find 3D monthly variables in the provided NetCDF datasets.")

    lat_name = "latitude" if "latitude" in ds_temp.coords else "lat"
    lon_name = "longitude" if "longitude" in ds_temp.coords else "lon"
    time_name = "time"

    target_stride = max(1, int(stride))
    temp = ds_temp[temp_var].isel({lat_name: slice(None, None, target_stride), lon_name: slice(None, None, target_stride)})
    precip = ds_precip[precip_var].isel({lat_name: slice(None, None, target_stride), lon_name: slice(None, None, target_stride)})

    temp_times = [str(value)[:7] for value in temp[time_name].values]
    selected_time_indices = [
        index for index, label in enumerate(temp_times) if month_in_range(label, start_month, end_month)
    ]
    if not selected_time_indices:
        return []

    filtered_times = [temp_times[index] for index in selected_time_indices]
    baseline_start_idx, baseline_end_idx = baseline_index_range(filtered_times)
    cells: List[CellRecord] = []

    lat_values = temp[lat_name].values.tolist()
    lon_values = temp[lon_name].values.tolist()
    temp_np = temp.values
    precip_np = precip.values

    for lat_idx, lat in enumerate(lat_values):
        for lon_idx, lon in enumerate(lon_values):
            temp_raw = temp_np[selected_time_indices, lat_idx, lon_idx]
            precip_raw = precip_np[selected_time_indices, lat_idx, lon_idx]
            if np.isnan(temp_raw).all() or np.isnan(precip_raw).all():
                continue

            temp_raw = np.nan_to_num(temp_raw, nan=float(np.nanmean(temp_raw)))
            precip_raw = np.nan_to_num(precip_raw, nan=float(np.nanmean(precip_raw)))
            temp_baseline = monthly_climatology(temp_raw.tolist(), baseline_start_idx, baseline_end_idx)
            precip_baseline = monthly_climatology(precip_raw.tolist(), baseline_start_idx, baseline_end_idx)
            temp_series = [float(temp_raw[idx] - temp_baseline[idx % 12]) for idx in range(len(filtered_times))]
            precip_series = [
                float((precip_raw[idx] - precip_baseline[idx % 12]) / precip_baseline[idx % 12])
                for idx in range(len(filtered_times))
            ]

            cells.append(
                CellRecord(
                    cell_id=f"{float(lat):+.2f}_{float(lon):+.2f}",
                    lat=round(float(lat), 3),
                    lon=round(float(lon), 3),
                    temp_series=round_series(temp_series),
                    precip_series=round_series(precip_series),
                    precip_raw_series=round_series(precip_raw.tolist()),
                    temp_baseline_monthly=round_series(temp_baseline),
                    precip_baseline_monthly=round_series(precip_baseline),
                    temp_trend_per_decade=linear_trend_per_decade(temp_series),
                    precip_trend_per_decade=linear_trend_per_decade([value * 100 for value in precip_series]),
                )
            )

    global MONTHS
    MONTHS = filtered_times
    return cells


def normalize_longitude(lon: float) -> float:
    normalized = ((lon + 180.0) % 360.0) - 180.0
    return 180.0 if normalized == -180.0 else normalized


def maybe_open_dataset(path: Path):
    import xarray as xr

    if zipfile.is_zipfile(path):
        temp_dir = Path(tempfile.mkdtemp(prefix="era5_monthly_"))
        with zipfile.ZipFile(path) as zf:
            zf.extractall(temp_dir)
        extracted = sorted(temp_dir.glob("*.nc"))
        if not extracted:
            raise SystemExit(f"No NetCDF file found inside {path}")
        dataset = xr.open_dataset(extracted[0], engine="netcdf4")
        return dataset, temp_dir

    dataset = xr.open_dataset(path, engine="netcdf4")
    return dataset, None


def maybe_load_real_monthly_dir(
    monthly_dir: Path | None,
    stride: int,
    start_month: str,
    end_month: str,
) -> List[CellRecord]:
    if not monthly_dir:
        return []

    try:
        import numpy as np
        import xarray as xr
    except ImportError as exc:
        raise SystemExit(
            "Reading ERA5 NetCDF files requires xarray and numpy. Install them or run with --demo."
        ) from exc

    temp_files = sorted(monthly_dir.rglob("era5_monthly_t2m_*.nc"))
    precip_files = sorted(monthly_dir.rglob("era5_monthly_tp_*.nc"))
    if not temp_files or not precip_files:
        return []

    precip_map = {path.stem.replace("era5_monthly_tp_", ""): path for path in precip_files}
    target_stride = max(1, int(stride))
    temp_series_map: dict[tuple[int, int], List[float]] = {}
    precip_raw_map: dict[tuple[int, int], List[float]] = {}
    sampled_lats: list[float] | None = None
    sampled_lons: list[float] | None = None
    month_labels_local: list[str] = []

    for temp_path in temp_files:
        year_token = temp_path.stem.replace("era5_monthly_t2m_", "")
        precip_path = precip_map.get(year_token)
        if not precip_path:
            continue

        ds_temp = xr.open_dataset(temp_path, engine="netcdf4")
        ds_precip = xr.open_dataset(precip_path, engine="netcdf4")
        try:
            lat_values = ds_temp["latitude"].values[::target_stride]
            lon_values = ds_temp["longitude"].values[::target_stride]

            if sampled_lats is None:
                sampled_lats = [float(value) for value in lat_values]
                sampled_lons = [normalize_longitude(float(value)) for value in lon_values]
                for lat_index in range(len(sampled_lats)):
                    for lon_index in range(len(sampled_lons)):
                        temp_series_map[(lat_index, lon_index)] = []
                        precip_raw_map[(lat_index, lon_index)] = []

            time_coord = "valid_time" if "valid_time" in ds_temp.coords else "time"
            temp_data = ds_temp["t2m"][:, ::target_stride, ::target_stride].values
            precip_data = ds_precip["tp"][:, ::target_stride, ::target_stride].values

            for time_index, raw_time in enumerate(ds_temp[time_coord].values):
                timestamp = str(raw_time)[:7]
                if not month_in_range(timestamp, start_month, end_month):
                    continue
                month_labels_local.append(timestamp)
                year = int(timestamp[:4])
                month = int(timestamp[5:7])
                days_in_month = calendar.monthrange(year, month)[1]

                temp_slice = temp_data[time_index].astype("float64") - 273.15
                precip_slice = precip_data[time_index].astype("float64") * 1000.0 * days_in_month

                for lat_index in range(len(sampled_lats)):
                    for lon_index in range(len(sampled_lons)):
                        key = (lat_index, lon_index)
                        temp_series_map[key].append(float(temp_slice[lat_index, lon_index]))
                        precip_raw_map[key].append(float(precip_slice[lat_index, lon_index]))
        finally:
            ds_temp.close()
            ds_precip.close()

    if not month_labels_local or sampled_lats is None or sampled_lons is None:
        return []

    global MONTHS
    MONTHS = month_labels_local
    baseline_start_idx, baseline_end_idx = baseline_index_range(MONTHS)
    cells: List[CellRecord] = []

    for lat_index, lat in enumerate(sampled_lats):
        for lon_index, lon in enumerate(sampled_lons):
            key = (lat_index, lon_index)
            temp_raw = temp_series_map[key]
            precip_raw = precip_raw_map[key]
            temp_baseline = monthly_climatology(temp_raw, baseline_start_idx, baseline_end_idx)
            precip_baseline = monthly_climatology(precip_raw, baseline_start_idx, baseline_end_idx)
            temp_series = [temp_raw[idx] - temp_baseline[idx % 12] for idx in range(len(MONTHS))]
            precip_series = [
                (precip_raw[idx] - precip_baseline[idx % 12]) / precip_baseline[idx % 12]
                if precip_baseline[idx % 12] != 0
                else 0.0
                for idx in range(len(MONTHS))
            ]

            cells.append(
                CellRecord(
                    cell_id=f"{float(lat):+.2f}_{float(lon):+.2f}",
                    lat=round(float(lat), 3),
                    lon=round(float(lon), 3),
                    temp_series=round_series(temp_series),
                    precip_series=round_series(precip_series),
                    precip_raw_series=round_series(precip_raw),
                    temp_baseline_monthly=round_series(temp_baseline),
                    precip_baseline_monthly=round_series(precip_baseline),
                    temp_trend_per_decade=linear_trend_per_decade(temp_series),
                    precip_trend_per_decade=linear_trend_per_decade([value * 100 for value in precip_series]),
                )
            )

    return cells


def write_assets(output_dir: Path, cells: List[CellRecord], source_name: str, resolution_label: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata = {
        "title": "Climate Change Visualized",
        "startMonth": MONTHS[0],
        "latestMonth": MONTHS[-1],
        "baselineStart": BASELINE_START,
        "baselineEnd": BASELINE_END,
        "source": source_name,
        "resolution": resolution_label,
        "units": {
            "temperature": "℃ anomaly",
            "precipitation": "relative anomaly",
            "precipitationRaw": "mm/month"
        },
        "basemaps": [
            {"id": "vector", "label": "Minimal Vector"}
        ],
        "monthLabels": MONTHS,
        "cellCount": len(cells)
    }

    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_dir / "cells-medium.json").write_text(
        json.dumps({"cells": [cell.to_dict() for cell in cells]}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true", help="Generate synthetic demo data.")
    parser.add_argument("--temp-file", type=Path, help="Path to a monthly temperature NetCDF file.")
    parser.add_argument("--precip-file", type=Path, help="Path to a monthly precipitation NetCDF file.")
    parser.add_argument("--monthly-dir", type=Path, help="Directory containing extracted annual ERA5 monthly t2m/tp files.")
    parser.add_argument("--start-month", default=START_MONTH, help="First month to include, in YYYY-MM format.")
    parser.add_argument("--end-month", default=LATEST_MONTH, help="Last month to include, in YYYY-MM format.")
    parser.add_argument("--stride", type=int, default=1, help="Spatial stride for real-data grid sampling. Use 1 for maximum density.")
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.start_month > args.end_month:
        raise SystemExit("--start-month must be earlier than or equal to --end-month.")

    cells = maybe_load_real_monthly_dir(args.monthly_dir, args.stride, args.start_month, args.end_month)
    if not cells:
        cells = maybe_load_real_data(
            args.temp_file,
            args.precip_file,
            args.stride,
            args.start_month,
            args.end_month,
        )
    if not cells:
        cells = generate_demo_cells()
        source_name = "synthetic-demo"
        resolution_label = "ultra-dense-demo-grid"
    else:
        source_name = "era5-monthly-single-levels"
        resolution_label = f"era5-monthly-grid-stride-{max(1, int(args.stride))}"
    write_assets(args.output_dir, cells, source_name, resolution_label)
    print(f"Wrote {len(cells)} cells to {args.output_dir}")


if __name__ == "__main__":
    main()
