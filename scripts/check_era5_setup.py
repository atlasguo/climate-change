#!/usr/bin/env python3
"""Check whether the local environment is ready for ERA5 downloads and processing."""

from __future__ import annotations

import importlib
import re
from pathlib import Path

EXPECTED_CDS_URL = "https://cds.climate.copernicus.eu/api"

# (module, purpose)
MODULES = [
    ("cdsapi", "download from the Climate Data Store"),
    ("numpy", "build the browser data assets"),
    ("xarray", "read ERA5 NetCDF files"),
    ("netCDF4", "open NetCDF files (xarray engine and download check)"),
]


def check_module(name: str) -> tuple[bool, str]:
    try:
        module = importlib.import_module(name)
    except Exception as exc:  # ImportError or a broken installation
        return False, f"{type(exc).__name__}: {exc}"
    return True, str(getattr(module, "__version__", "installed"))


def check_cdsapirc(path: Path) -> list[str]:
    """Return a list of problems with ~/.cdsapirc. Never prints the key."""
    if not path.exists():
        return [f"{path} not found. Create it with 'url: {EXPECTED_CDS_URL}' and 'key: <your token>'."]

    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"{path} could not be read ({exc})."]

    problems: list[str] = []
    url_match = re.search(r"^\s*url\s*:\s*(\S+)", text, re.MULTILINE)
    key_match = re.search(r"^\s*key\s*:\s*(\S+)", text, re.MULTILINE)
    if not url_match:
        problems.append(f"no 'url:' line; expected 'url: {EXPECTED_CDS_URL}'.")
    elif url_match.group(1).rstrip("/") != EXPECTED_CDS_URL:
        problems.append(f"url is '{url_match.group(1)}'; expected '{EXPECTED_CDS_URL}' (the current CDS API).")
    if not key_match:
        problems.append("no 'key:' line.")
    return problems


def main() -> None:
    home = Path.home()
    cdsapirc = home / ".cdsapirc"
    ready = True

    print("ERA5 setup check")
    print(f"home: {home}")

    problems = check_cdsapirc(cdsapirc)
    if problems:
        ready = False
        for problem in problems:
            print(f".cdsapirc: WARNING {problem}")
    else:
        print(f".cdsapirc: ok (url {EXPECTED_CDS_URL}, key present)")

    for name, purpose in MODULES:
        ok, detail = check_module(name)
        ready = ready and ok
        if ok:
            print(f"{name}: ok ({detail})")
        else:
            print(f"{name}: MISSING - needed to {purpose} ({detail})")

    print("ready" if ready else "not ready: fix the items marked above")


if __name__ == "__main__":
    main()
