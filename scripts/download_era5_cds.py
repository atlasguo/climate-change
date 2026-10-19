#!/usr/bin/env python3
"""Download archival ERA5 assets from the Copernicus Climate Data Store.

Two sources are supported:

- monthly-means (used by the web app):
  ERA5 monthly averaged data on single levels, 2m_temperature and
  total_precipitation, NetCDF. Downloaded one calendar year per request and
  extracted to the layout read by scripts/build_climate_assets.py:
    <output-root>/derived/monthly-single-levels/YYYY/era5_monthly_t2m_YYYY.nc
    <output-root>/derived/monthly-single-levels/YYYY/era5_monthly_tp_YYYY.nc

- raw-hourly (optional archive for future upgrades):
  ERA5 hourly data on single levels, same variables, GRIB, one file per month:
    <output-root>/raw/hourly-single-levels/YYYY/era5_hourly_single_levels_YYYY_MM.grib

The project period is fixed at 1940-01..2025-12. Months after 2025-12 are
refused.

The CDS API requires a personal access token in ~/.cdsapirc and acceptance
of each dataset's licence terms in the CDS web interface.
"""

from __future__ import annotations

import argparse
import shutil
import zipfile
from dataclasses import dataclass
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

    @property
    def key(self) -> tuple[int, int]:
        return (self.year, self.month)


PROJECT_START = MonthSpec(1940, 1)
PROJECT_END = MonthSpec(2025, 12)


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


def raw_target(output_root: Path, month: MonthSpec) -> Path:
    return output_root / "raw" / "hourly-single-levels" / f"{month.year:04d}" / f"era5_hourly_single_levels_{month.year:04d}_{month.month:02d}.grib"


def monthly_year_dir(output_root: Path, year: int) -> Path:
    return output_root / "derived" / "monthly-single-levels" / f"{year:04d}"


def monthly_year_zip_target(output_root: Path, year: int) -> Path:
    return monthly_year_dir(output_root, year) / f"era5_monthly_single_levels_{year:04d}.zip"


def monthly_year_extracted_targets(output_root: Path, year: int) -> tuple[Path, Path]:
    year_dir = monthly_year_dir(output_root, year)
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


def monthly_year_request(year: int) -> dict:
    # Monthly-means datasets have no "day" dimension; "time" must be 00:00.
    return {
        "product_type": ["monthly_averaged_reanalysis"],
        "variable": VARIABLES,
        "year": [f"{year:04d}"],
        "month": [f"{month:02d}" for month in range(1, 13)],
        "time": ["00:00"],
        "data_format": "netcdf",
        "download_format": "zip",
    }


def count_time_steps(path: Path) -> int | None:
    """Return the number of time steps in a NetCDF file, or None if it cannot be checked."""
    try:
        import netCDF4  # type: ignore
    except ImportError:
        netCDF4 = None

    if netCDF4 is not None:
        with netCDF4.Dataset(path) as ds:
            for name in ("valid_time", "time"):
                if name in ds.dimensions:
                    return len(ds.dimensions[name])
        return None

    try:
        import xarray as xr  # type: ignore
    except ImportError:
        return None
    with xr.open_dataset(path) as ds:
        for name in ("valid_time", "time"):
            if name in ds.sizes:
                return int(ds.sizes[name])
    return None


def year_is_complete(output_root: Path, year: int) -> bool:
    """True when both per-year files exist and each holds all 12 months."""
    paths = monthly_year_extracted_targets(output_root, year)
    if not all(path.exists() for path in paths):
        return False
    for path in paths:
        try:
            steps = count_time_steps(path)
        except Exception as exc:  # unreadable or truncated file
            print(f"warning: cannot read {path} ({exc}); it will be downloaded again.")
            return False
        if steps is None:
            print(f"warning: cannot verify the time axis of {path} (install netCDF4); assuming complete.")
            continue
        if steps != 12:
            print(f"warning: {path} holds {steps} month(s) instead of 12; it will be downloaded again.")
            return False
    return True


def extract_monthly_year_zip(zip_path: Path, output_root: Path, year: int) -> None:
    temp_target, precip_target = monthly_year_extracted_targets(output_root, year)
    temp_target.parent.mkdir(parents=True, exist_ok=True)

    # The CDS splits monthly means by step type: "avgua" (instantaneous, t2m) and
    # "avgad" (accumulated, tp).
    written = {temp_target: False, precip_target: False}
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            lower = member.lower()
            if not lower.endswith(".nc"):
                continue
            if "avgua" in lower:
                target = temp_target
            elif "avgad" in lower:
                target = precip_target
            else:
                continue
            partial = target.with_suffix(".nc.part")
            with zf.open(member) as source, partial.open("wb") as handle:
                shutil.copyfileobj(source, handle)
            partial.replace(target)
            written[target] = True

    if not all(written.values()):
        raise SystemExit(f"Could not extract both t2m and tp files from {zip_path}.")


def download_raw_month(client, output_root: Path, month: MonthSpec, force: bool) -> None:
    target = raw_target(output_root, month)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not force:
        print(f"skip {month.label} -> {target}")
        return

    print(f"download {month.label} -> {target}")
    partial = target.with_suffix(".grib.part")
    client.retrieve(RAW_DATASET, raw_request(month), str(partial))
    partial.replace(target)


def download_monthly_year(client, output_root: Path, year: int, force: bool) -> None:
    zip_target = monthly_year_zip_target(output_root, year)
    zip_target.parent.mkdir(parents=True, exist_ok=True)

    if not force and year_is_complete(output_root, year):
        print(f"skip {year} (12 months present)")
        return

    if force or not zip_target.exists():
        print(f"download {year} -> {zip_target}")
        partial = zip_target.with_suffix(".zip.part")
        client.retrieve(MONTHLY_DATASET, monthly_year_request(year), str(partial))
        partial.replace(zip_target)
    else:
        print(f"extract {year} from existing {zip_target}")

    extract_monthly_year_zip(zip_target, output_root, year)
    if not year_is_complete(output_root, year):
        if not force:
            # The cached zip may be stale (for example an older partial year); fetch it again.
            print(f"re-download {year}: extracted files are incomplete")
            zip_target.unlink(missing_ok=True)
            download_monthly_year(client, output_root, year, force=True)
            return
        raise SystemExit(f"{year}: the downloaded files do not contain all 12 months.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--mode",
        choices=["monthly-means", "raw-hourly"],
        default="monthly-means",
        help="Archival source to download (default: monthly-means, the source used by the web app).",
    )
    parser.add_argument(
        "--bundle",
        choices=["year", "month"],
        default=None,
        help="Request size. monthly-means always uses 'year'; raw-hourly always uses 'month'. "
        "Accepted for explicitness; a mismatching value is an error.",
    )
    parser.add_argument(
        "--start",
        type=parse_month,
        default=PROJECT_START,
        help=f"First month to download, YYYY-MM (default: {PROJECT_START.label}).",
    )
    parser.add_argument(
        "--end",
        type=parse_month,
        default=PROJECT_END,
        help=f"Last month to download, YYYY-MM (default and maximum: {PROJECT_END.label}).",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("data/era5"),
        help="Base directory for archived ERA5 downloads (default: data/era5).",
    )
    parser.add_argument("--force", action="store_true", help="Redownload files even if they already exist.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.start.key > args.end.key:
        raise SystemExit("--start must be earlier than or equal to --end.")
    if args.end.key > PROJECT_END.key:
        raise SystemExit(f"--end {args.end.label} is outside the project period (ends {PROJECT_END.label}).")

    expected_bundle = "year" if args.mode == "monthly-means" else "month"
    if args.bundle is not None and args.bundle != expected_bundle:
        raise SystemExit(f"--mode {args.mode} only supports --bundle {expected_bundle}.")
    if args.mode == "monthly-means" and (args.start.month != 1 or args.end.month != 12):
        print("warning: monthly-means downloads full calendar years; partial start/end months are widened.")

    try:
        import cdsapi
    except ImportError as exc:
        raise SystemExit(
            "cdsapi is required. Install it with 'pip install \"cdsapi>=0.7.7\"' and configure ~/.cdsapirc."
        ) from exc

    client = cdsapi.Client()
    if args.mode == "monthly-means":
        for year in range(args.start.year, args.end.year + 1):
            download_monthly_year(client, args.output_root, year, args.force)
    else:
        for month in iter_months(args.start, args.end):
            download_raw_month(client, args.output_root, month, args.force)


if __name__ == "__main__":
    main()
