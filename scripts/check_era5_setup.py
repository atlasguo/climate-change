#!/usr/bin/env python3
"""Check whether the local environment is ready for ERA5 downloads and processing."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def main() -> None:
    home = Path.home()
    cdsapirc = home / ".cdsapirc"

    print("ERA5 setup check")
    print(f"home: {home}")
    print(f".cdsapirc: {'yes' if cdsapirc.exists() else 'no'}")
    print(f"cdsapi: {'yes' if has_module('cdsapi') else 'no'}")
    print(f"xarray: {'yes' if has_module('xarray') else 'no'}")
    print(f"numpy: {'yes' if has_module('numpy') else 'no'}")


if __name__ == "__main__":
    main()
