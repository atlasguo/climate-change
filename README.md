# Climate Change Visualized

Interactive 3D globe of monthly temperature and precipitation anomalies, 1940 to 2025.

Each hexagon or grid cell carries a small chart glyph showing how its climate has changed against the 1991-2020 baseline. A timeline lets you compare periods, with El Niño and La Niña years marked for context. The map works in dark and light modes, on desktop and on phones.

## Features

- Temperature and precipitation anomalies for every month from 1940 to 2025
- Hexagon or grid cells, each showing a small chart glyph in one of three styles: pulse, column or cone
- Click any cell, or search for a place, to see its full climate record in a detailed chart
- Draggable timeline for comparing two periods, with strong El Niño and La Niña years marked
- Consistent colour meanings: blue colder and red warmer, brown drier and green wetter
- Six basemaps, from terrain relief to night lights, with optional place names
- Dark and light modes
- Export the map and charts as images
- Works on desktop and on phones

## Data sources

- ERA5 monthly averaged data, Copernicus Climate Change Service (C3S): temperature and precipitation
  <https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels-monthly-means>
  Contains modified Copernicus Climate Change Service information [2026]. Neither the European Commission nor ECMWF is responsible for any use of this information.
- NOAA CPC Relative Oceanic Niño Index (RONI): El Niño and La Niña context
  <https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt>
- Basemaps: OpenFreeMap (© OpenMapTiles, © OpenStreetMap contributors), Terrain Tiles (Mapzen, AWS Open Data), NASA EOSDIS GIBS, VersaTiles, Natural Earth

Development notes are in [docs/development.md](docs/development.md).

## Credits

Design by Atlas Guo (2026)
© CartoGuophy: <https://cartoguophy.com/>
