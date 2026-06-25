#!/usr/bin/env python3
"""Download archival ERA5 assets from the Copernicus Climate Data Store.

This script is intentionally conservative about file layout and resumability:

- Raw archival source for future upgrades:
  ERA5 hourly data on single levels from 1940 to present
  Variables: 2m_temperature, total_precipitation
  Format: GRIB

- Derived source for the current web app:
  ERA5 monthly averaged data on single levels from 1940 to present
  Variables: 2m_temperature, total_precipitation
  Format: NetCDF

The CDS API requires a personal access token in ~/.cdsapirc and acceptance
of each dataset's licence terms in the CDS web interface.
"""

from __future__ import annotations

import argparse
import shutil
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable


RAW_DATASET = "reanalysis-era5-single-levels"
MONTHLY_DATASET = "reanalysis-era5-single-levels-monthly-means"
VARIABLES = ["2m_temperature", "total_precipitation"]


@dataclass(frozen=True)
class MonthSpec:
    year: int
    month: int

    @property
    def label(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


def parse_month(value: str) -> MonthSpec:
    try:
        year_str, month_str = value.split("-")
        year = int(year_str)
        month = int(month_str)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid month '{value}'. Expected YYYY-MM.") from exc

    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError(f"Invalid month '{value}'. Month must be 01-12.")
    return MonthSpec(year, month)


def iter_months(start: MonthSpec, end: MonthSpec) -> Iterable[MonthSpec]:
    year = start.year
    month = start.month
    while (year, month) <= (end.year, end.month):
        yield MonthSpec(year, month)
        month += 1
        if month > 12:
            month = 1
            year += 1


def previous_month() -> MonthSpec:
    today = date.today()
    year = today.year
    month = today.month - 1
    if month == 0:
        month = 12
        year -= 1
    return MonthSpec(year, month)


def raw_target(output_root: Path, month: MonthSpec) -> Path:
    return output_root / "raw" / "hourly-single-levels" / f"{month.year:04d}" / f"era5_hourly_single_levels_{month.year:04d}_{month.month:02d}.grib"


def monthly_target(output_root: Path, month: MonthSpec) -> Path:
    return output_root / "derived" / "monthly-single-levels" / f"{month.year:04d}" / f"era5_monthly_single_levels_{month.year:04d}_{month.month:02d}.nc"


def monthly_year_zip_target(output_root: Path, year: int) -> Path:
    return output_root / "derived" / "monthly-single-levels" / f"{year:04d}" / f"era5_monthly_single_levels_{year:04d}.zip"


def monthly_year_extracted_targets(output_root: Path, year: int) -> tuple[Path, Path]:
    year_dir = output_root / "derived" / "monthly-single-levels" / f"{year:04d}"
    return (
        year_dir / f"era5_monthly_t2m_{year:04d}.nc",
        year_dir / f"era5_monthly_tp_{year:04d}.nc",
    )


def raw_request(month: MonthSpec) -> dict:
    return {
        "product_type": ["reanalysis"],
        "variable": VARIABLES,
        "year": [f"{month.year:04d}"],
        "month": [f"{month.month:02d}"],
        "day": [f"{day:02d}" for day in range(1, 32)],
        "time": [f"{hour:02d}:00" for hour in range(24)],
        "data_format": "grib",
        "download_format": "unarchived",
    }


def monthly_request(month: MonthSpec) -> dict:
    return {
        "product_type": "monthly_averaged_reanalysis",
        "variable": VARIABLES,
        "year": [f"{month.year:04d}"],
        "month": [f"{month.month:02d}"],
        "day": ["01"],
        "time": ["00:00"],
        "data_format": "netcdf",
        "download_format": "unarchived",
    }


def monthly_year_request(year: int) -> dict:
    return {
        "product_type": "monthly_averaged_reanalysis",
        "variable": VARIABLES,
        "year": [f"{year:04d}"],
        "month": [f"{month:02d}" for month in range(1, 13)],
        "day": ["01"],
        "time": ["00:00"],
        "data_format": "netcdf",
        "download_format": "zip",
    }


def extract_monthly_year_zip(zip_path: Path, output_root: Path, year: int, force: bool) -> None:
    temp_target, precip_target = monthly_year_extracted_targets(output_root, year)
    temp_target.parent.mkdir(parents=True, exist_ok=True)

    if temp_target.exists() and precip_target.exists() and not force:
        return

    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            lower = member.lower()
            if lower.endswith(".nc") and "avgua" in lower:
                with zf.open(member) as source, temp_target.open("wb") as target:
                    shutil.copyfileobj(source, target)
            elif lower.endswith(".nc") and "avgad" in lower:
                with zf.open(member) as source, precip_target.open("wb") as target:
                    shutil.copyfileobj(source, target)

    if not temp_target.exists() or not precip_target.exists():
        raise SystemExit(f"Could not extract both t2m and tp files from {zip_path}.")


def download_month(client, mode: str, output_root: Path, month: MonthSpec, force: bool) -> None:
    if mode == "raw-hourly":
        dataset = RAW_DATASET
        request = raw_request(month)
        target = raw_target(output_root, month)
    else:
        dataset = MONTHLY_DATASET
        request = monthly_request(month)
        target = monthly_target(output_root, month)

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not force:
        print(f"skip {month.label} -> {target}")
        return

    print(f"download {month.label} -> {target}")
    client.retrieve(dataset, request, str(target))


def download_monthly_year(client, output_root: Path, year: int, force: bool) -> None:
    zip_target = monthly_year_zip_target(output_root, year)
    temp_target, precip_target = monthly_year_extracted_targets(output_root, year)
    zip_target.parent.mkdir(parents=True, exist_ok=True)

    if zip_target.exists() and not force and temp_target.exists() and precip_target.exists():
        print(f"skip {year} -> {zip_target}")
        return

    print(f"download {year} -> {zip_target}")
    client.retrieve(MONTHLY_DATASET, monthly_year_request(year), str(zip_target))
    extract_monthly_year_zip(zip_target, output_root, year, force)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=["raw-hourly", "monthly-means"],
        default="raw-hourly",
        help="Choose the archival source to download.",
    )
    parser.add_argument(
        "--bundle",
        choices=["month", "year"],
        default="month",
        help="Bundle strategy. 'year' is supported for monthly-means and speeds up full-history downloads.",
    )
    parser.add_argument(
        "--start",
        type=parse_month,
        default=MonthSpec(1940, 1),
        help="First month to download, in YYYY-MM format.",
    )
    parser.add_argument(
        "--end",
        type=parse_month,
        default=previous_month(),
        help="Last month to download, in YYYY-MM format.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("data/era5"),
        help="Base directory for archived ERA5 downloads.",
    )
    parser.add_argument("--force", action="store_true", help="Redownload files even if they already exist.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if (args.start.year, args.start.month) > (args.end.year, args.end.month):
        raise SystemExit("--start must be earlier than or equal to --end.")
    if args.bundle == "year" and args.mode != "monthly-means":
        raise SystemExit("--bundle year is only supported for --mode monthly-means.")
    if args.bundle == "year" and (args.start.month != 1 or args.end.month != 12):
        print("warning: yearly bundle ignores partial months and downloads full calendar years.")

    try:
        import cdsapi
    except ImportError as exc:
        raise SystemExit(
            "cdsapi is required. Install it with 'pip install \"cdsapi>=0.7.7\"' and configure ~/.cdsapirc."
        ) from exc

    client = cdsapi.Client()
    if args.bundle == "year":
        for year in range(args.start.year, args.end.year + 1):
            download_monthly_year(client, args.output_root, year, args.force)
    else:
        for month in iter_months(args.start, args.end):
            download_month(client, args.mode, args.output_root, month, args.force)


if __name__ == "__main__":
    main()
