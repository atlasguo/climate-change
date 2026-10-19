# Build the country / sea lookup grid used by the details panel:
#   python scripts/build_country_lookup.py <ne_50m_admin_0_countries.geojson> <ne_50m_geography_marine_polys.geojson> data/places.json
# Inputs are Natural Earth GeoJSON (github.com/nvkelso/natural-earth-vector/tree/master/geojson). Requires shapely>=2, numpy.
# Output: names list (seas first, `seaCount` of them) plus one run-length encoded row per latitude band, [nameIndex, runLength, ...]; index 0 means unnamed.
import json, sys, numpy as np, shapely
from shapely.geometry import shape

STEP = 0.25
countries_path, marine_path, out_path = sys.argv[1:4]
lons = -180 + STEP * (np.arange(int(360 / STEP)) + 0.5)
lats = 90 - STEP * (np.arange(int(180 / STEP)) + 0.5)
grid_lon, grid_lat = np.meshgrid(lons, lats)
grid = np.zeros(grid_lon.shape, dtype=np.int32)
names = ['']

def paint(features, label):
    # Larger polygons first so seas nested in oceans keep their own name.
    shapes = sorted(((shape(f['geometry']), label(f['properties'])) for f in features if f['geometry']), key=lambda s: -s[0].area)
    for geom, name in shapes:
        if not name:
            continue
        if name not in names:
            names.append(name)
        minx, miny, maxx, maxy = geom.bounds
        box = (grid_lon >= minx) & (grid_lon <= maxx) & (grid_lat >= miny) & (grid_lat <= maxy)
        rows, cols = np.nonzero(box)
        inside = shapely.contains_xy(geom, grid_lon[rows, cols], grid_lat[rows, cols])
        grid[rows[inside], cols[inside]] = names.index(name)

def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)['features']

marine = [f for f in load(marine_path) if f['properties'].get('featurecla') in ('ocean', 'sea', 'gulf', 'bay', 'strait', 'channel', 'sound')]
paint(marine, lambda p: p.get('name_en') or p.get('name'))
sea_count = len(names) - 1
paint(load(countries_path), lambda p: p.get('NAME') or p.get('NAME_EN'))

rows = []
for row in grid:
    runs, start = [], 0
    for index in range(1, len(row) + 1):
        if index == len(row) or row[index] != row[start]:
            runs += [int(row[start]), index - start]
            start = index
    rows.append(runs)

with open(out_path, 'w', encoding='utf-8') as handle:
    json.dump({'step': STEP, 'seaCount': sea_count, 'names': names, 'rows': rows}, handle, ensure_ascii=False, separators=(',', ':'))
print(f'{len(names) - 1} names, {sum(len(r) for r in rows) // 2} runs -> {out_path}')
