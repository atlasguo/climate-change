import maplibregl from 'maplibre-gl';
import { cellToBoundary, cellToChildren, getRes0Cells, latLngToCell } from 'h3-js';
import { buildRenderableCells, getCommittedValueDomains, getDensityLevelForZoom } from '../state/selectors.js';
import { getDisplayCell, getGridCellIdAt, getGridDisplayCells, getGridIndexes, getH3DisplayCells } from '../data/displayCells.js';
import { createGlyphOverlay } from './createGlyphOverlay.js';

const H3_SOURCE_ID = 'climate-h3-cells';
const H3_FILL_LAYER_ID = 'climate-h3-fill';
const H3_LINE_LAYER_ID = 'climate-h3-line';
const H3_HOVERED_FILL_LAYER_ID = 'climate-h3-hovered-fill';
const H3_HOVERED_LAYER_ID = 'climate-h3-hovered';
const H3_SELECTED_FILL_LAYER_ID = 'climate-h3-selected-fill';
const H3_SELECTED_LAYER_ID = 'climate-h3-selected';
const GRID_SOURCE_ID = 'climate-grid-cells';
const GRID_LINE_SOURCE_ID = 'climate-grid-lines';
const GRID_FILL_LAYER_ID = 'climate-grid-fill';
const GRID_LINE_LAYER_ID = 'climate-grid-line';
const GRID_HOVERED_FILL_LAYER_ID = 'climate-grid-hovered-fill';
const GRID_HOVERED_LAYER_ID = 'climate-grid-hovered';
const GRID_SELECTED_FILL_LAYER_ID = 'climate-grid-selected-fill';
const GRID_SELECTED_LAYER_ID = 'climate-grid-selected';
const COUNTRY_BORDER_SOURCE_ID = 'climate-country-borders';
const COUNTRY_BORDER_LAYER_ID = 'climate-country-borders-layer';
const COUNTRY_LABEL_SOURCE_ID = 'climate-country-labels';
const COUNTRY_LABEL_LAYER_ID = 'climate-country-labels-layer';
const CITY_LABEL_SOURCE_ID = 'climate-city-labels';
const CITY_LABEL_LAYER_ID = 'climate-city-labels-layer';
const H3_FEATURE_COLLECTION_CACHE = new Map();
const GRID_FEATURE_COLLECTION_CACHE = new Map();
const GRID_LINE_FEATURE_COLLECTION_CACHE = new Map();
const H3_MIN_RESOLUTION = 0;
const GRID_DEGREE_LEVELS = [10, 5, 2];
const GRID_DEFAULT_DEGREES = 10;
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const H3_ADAPTIVE_REFERENCE_GLYPH_SCALE = {
  glyphWidthScale: 1,
  glyphHeightScale: 1
};
const MAP_STYLE_URL = new URL('../../styles/globe-dark.json', import.meta.url).href;
const COUNTRY_LABELS_URL = new URL('../../data/countries.json', import.meta.url).href;
const COUNTRY_BORDERS_URL = new URL('../../data/ne_50m_admin_0_boundary_lines_land.geojson', import.meta.url).href;
const CITY_LABELS_URL = new URL('../../data/ne_populated_places_50m.json', import.meta.url).href;
const RENDER_LOADING_COPY = {
  init: {
    title: 'Preparing globe',
    detail: 'Loading map and climate layers'
  },
  variable: {
    title: 'Updating variable',
    detail: 'Refreshing color and value encodings'
  },
  mode: {
    title: 'Switching glyph mode',
    detail: 'Redrawing symbols and detail charts'
  },
  symbol: {
    title: 'Updating symbol',
    detail: 'Switching glyph form and geometry unit'
  },
  unit: {
    title: 'Rebuilding geometry',
    detail: 'Switching between hexagons and grid cells'
  },
  colorScaleMode: {
    title: 'Rebalancing color scale',
    detail: 'Recomputing the visual range'
  },
  ranges: {
    title: 'Updating time window',
    detail: 'Refreshing aggregates for the selected span'
  },
  periodMonths: {
    title: 'Updating period',
    detail: 'Rebucketing the timeline and glyphs'
  },
  default: {
    title: 'Updating globe',
    detail: 'Rendering climate layers'
  }
};

function extractRings(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }

  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) {
      return [];
    }
    return geometry.coordinates.flat();
  }

  return [];
}

function ringCenter(ring) {
  if (!Array.isArray(ring) || !ring.length) {
    return null;
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) {
      continue;
    }
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  if (![minLon, maxLon, minLat, maxLat].every(Number.isFinite)) {
    return null;
  }

  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function buildCountryLabelFeatureCollection(countryGeoJson) {
  const features = Array.isArray(countryGeoJson?.features) ? countryGeoJson.features : [];

  return {
    type: 'FeatureCollection',
    features: features
      .map((feature, index) => {
        const properties = feature?.properties ?? {};
        const labelLon = Number(properties.LABEL_X);
        const labelLat = Number(properties.LABEL_Y);
        let center = null;

        if (Number.isFinite(labelLon) && Number.isFinite(labelLat)) {
          center = [labelLon, labelLat];
        } else {
          const rings = extractRings(feature?.geometry);
          center = ringCenter(rings[0]);
        }

        if (!Array.isArray(center)) {
          return null;
        }

        return {
          type: 'Feature',
          id: properties.ADM0_A3 ?? properties.ISO_A3 ?? properties.NAME ?? `country-${index}`,
          properties: {
            NAME: properties.NAME ?? properties.ADMIN ?? properties.NAME_LONG ?? '',
            NAME_LONG: properties.NAME_LONG ?? properties.NAME ?? properties.ADMIN ?? '',
            NAME_EN: properties.NAME_EN ?? properties.NAME ?? properties.ADMIN ?? '',
            LABELRANK: Number(properties.LABELRANK ?? properties.scalerank ?? 99),
            MIN_LABEL: Number(properties.MIN_LABEL ?? 0),
            MAX_LABEL: Number(properties.MAX_LABEL ?? 24)
          },
          geometry: {
            type: 'Point',
            coordinates: center
          }
        };
      })
      .filter(Boolean)
  };
}

function normalizeCityLabelFeatureCollection(cityGeoJson) {
  const features = Array.isArray(cityGeoJson?.features) ? cityGeoJson.features : [];

  return {
    type: 'FeatureCollection',
    features: features
      .map((feature, index) => {
        const properties = feature?.properties ?? {};
        const coordinates = feature?.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
          return null;
        }

        const lon = Number(coordinates[0]);
        const lat = Number(coordinates[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          return null;
        }

        return {
          type: 'Feature',
          id: properties.wikidataid ?? properties.NAMEASCII ?? properties.NAME ?? `city-${index}`,
          properties: {
            NAME: properties.NAME ?? properties.NAMEASCII ?? '',
            NAMEASCII: properties.NAMEASCII ?? properties.NAME ?? '',
            LABELRANK: Number(properties.LABELRANK ?? properties.labelrank ?? 99),
            SCALERANK: Number(properties.SCALERANK ?? properties.scalerank ?? 99),
            POP_MAX: Number(properties.POP_MAX ?? properties.pop_max ?? 0),
            ADM0CAP: Number(properties.ADM0CAP ?? properties.adm0cap ?? 0),
            WORLDCITY: Number(properties.WORLDCITY ?? properties.worldcity ?? 0)
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          }
        };
      })
      .filter(Boolean)
  };
}

function setLayerVisibility(map, layerId, visible) {
  if (!map.getLayer(layerId)) {
    return;
  }
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function syncLabelLayerVisibility(map, state) {
  setLayerVisibility(map, COUNTRY_BORDER_LAYER_ID, Boolean(state?.showCountryBorder));
  setLayerVisibility(map, COUNTRY_LABEL_LAYER_ID, Boolean(state?.showCountryLabel));
  setLayerVisibility(map, CITY_LABEL_LAYER_ID, Boolean(state?.showCityLabel));
}

function liftInteractiveCellLayers(map) {
  const layerIds = [
    H3_HOVERED_FILL_LAYER_ID,
    GRID_HOVERED_FILL_LAYER_ID,
    H3_SELECTED_FILL_LAYER_ID,
    GRID_SELECTED_FILL_LAYER_ID,
    H3_HOVERED_LAYER_ID,
    GRID_HOVERED_LAYER_ID,
    H3_SELECTED_LAYER_ID,
    GRID_SELECTED_LAYER_ID
  ];

  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.moveLayer(layerId);
    }
  }
}

async function addReferenceLabelLayers(map, state) {
  let countryBordersJson = null;
  let countriesJson = null;
  let citiesJson = null;

  try {
    const [countryBorderResponse, countryResponse, cityResponse] = await Promise.all([
      fetch(COUNTRY_BORDERS_URL),
      fetch(COUNTRY_LABELS_URL),
      fetch(CITY_LABELS_URL)
    ]);
    if (countryBorderResponse.ok) {
      countryBordersJson = await countryBorderResponse.json();
    }
    if (countryResponse.ok) {
      countriesJson = await countryResponse.json();
    }
    if (cityResponse.ok) {
      citiesJson = await cityResponse.json();
    }
  } catch {
    return;
  }

  if (countriesJson && !map.getSource(COUNTRY_LABEL_SOURCE_ID)) {
    if (countryBordersJson) {
      map.addSource(COUNTRY_BORDER_SOURCE_ID, {
        type: 'geojson',
        data: countryBordersJson
      });
    }

    map.addSource(COUNTRY_LABEL_SOURCE_ID, {
      type: 'geojson',
      data: buildCountryLabelFeatureCollection(countriesJson)
    });

    if (countryBordersJson) {
      map.addLayer({
        id: COUNTRY_BORDER_LAYER_ID,
        type: 'line',
        source: COUNTRY_BORDER_SOURCE_ID,
        minzoom: 1,
        maxzoom: 6,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: 'none'
        },
        paint: {
          'line-color': '#181c1f',
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            0.72,
            4,
            0.86,
            6,
            0.94
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            1.45,
            4,
            1.95,
            6,
            2.45
          ]
        }
      });
    }

    map.addLayer({
      id: COUNTRY_LABEL_LAYER_ID,
      type: 'symbol',
      source: COUNTRY_LABEL_SOURCE_ID,
      minzoom: 1,
      maxzoom: 6,
      filter: ['<=', ['coalesce', ['get', 'LABELRANK'], 99], 6],
      layout: {
        'text-field': ['upcase', ['coalesce', ['get', 'NAME_EN'], ['get', 'NAME_LONG'], ['get', 'NAME']]],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          9,
          4,
          10,
          6.2,
          11.4
        ],
        'text-font': ['Noto Sans Regular'],
        'text-letter-spacing': 0.08,
        'text-max-width': 8,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'visibility': 'none'
      },
      paint: {
        'text-color': '#cdd3d8',
        'text-halo-color': 'rgba(4, 6, 8, 0.86)',
        'text-halo-width': 1.35,
        'text-halo-blur': 0.55,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          0.72,
          4,
          0.82,
          6,
          0.9
        ]
      }
    });
  }

  if (citiesJson && !map.getSource(CITY_LABEL_SOURCE_ID)) {
    map.addSource(CITY_LABEL_SOURCE_ID, {
      type: 'geojson',
      data: normalizeCityLabelFeatureCollection(citiesJson)
    });

    map.addLayer({
      id: CITY_LABEL_LAYER_ID,
      type: 'symbol',
      source: CITY_LABEL_SOURCE_ID,
      minzoom: 2,
      maxzoom: 6.2,
      filter: [
        'all',
        ['<=', ['coalesce', ['get', 'LABELRANK'], 99], 7],
        [
          'any',
          ['>=', ['coalesce', ['get', 'POP_MAX'], 0], 250000],
          ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1],
          ['==', ['coalesce', ['get', 'WORLDCITY'], 0], 1]
        ]
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'NAMEASCII'], ['get', 'NAME']],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          9,
          4,
          10,
          6.2,
          11.4
        ],
        'text-font': ['Noto Sans Regular'],
        'text-letter-spacing': 0.02,
        'text-max-width': 6,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'visibility': 'none'
      },
      paint: {
        'text-color': [
          'case',
          ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1],
          '#eef2f5',
          '#bac2c9'
        ],
        'text-halo-color': 'rgba(4, 6, 8, 0.84)',
        'text-halo-width': 1.15,
        'text-halo-blur': 0.5,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          0.78,
          4,
          0.88,
          6.2,
          0.96
        ]
      }
    });
  }

  syncLabelLayerVisibility(map, state);
}


function buildOverlayState(rawCells, metadata, state, densityLevel, h3Resolution, gridDegrees, viewportDomains = null) {
  const isGridMode = state.unit === 'grid';
  const effectiveCells = isGridMode ? getGridDisplayCells(gridDegrees) : getH3DisplayCells(h3Resolution);
  const overlayState = {
    ...state,
    densityLevel,
    displayedSelectedCell: state.selectedCell,
    displayedH3Resolution: isGridMode ? null : h3Resolution,
    displayedGridDegrees: isGridMode ? gridDegrees : null
  };
  // "Global" color scales span every 2-degree sample so they don't shift with the zoom level.
  const valueDomains = getCommittedValueDomains(rawCells, metadata, overlayState);
  const renderableCells = buildRenderableCells(effectiveCells, metadata, overlayState, valueDomains);
  return {
    ...overlayState,
    renderableCells,
    valueDomains,
    viewportDomains: viewportDomains ?? valueDomains
  };
}

function sizeForDensity(level, state) {
  const base = level === 'low' ? 72 : level === 'medium' ? 88 : 100;
  return {
    width: Math.round(base * state.glyphWidthScale),
    height: Math.round(base * state.glyphHeightScale)
  };
}

function sizeForAdaptiveResolution(level) {
  return sizeForDensity(level, H3_ADAPTIVE_REFERENCE_GLYPH_SCALE);
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function angularDistance(a, b) {
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const cosine =
    Math.sin(lat1) * Math.sin(lat2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2);
  return Math.acos(clamp(cosine, -1, 1));
}


function getProjectedCellMetrics(map, resolution) {
  const center = map.getCenter();
  const h3Index = latLngToCell(center.lat, center.lng, resolution);
  const boundary = cellToBoundary(h3Index);
  const projected = boundary.map(([lat, lon]) => map.project([lon, lat]));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minEdge = Infinity;

  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const next = projected[(index + 1) % projected.length];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minEdge = Math.min(minEdge, distance(point, next));
  }

  return {
    bboxWidth: maxX - minX,
    bboxHeight: maxY - minY,
    minEdge
  };
}

function getAdaptiveH3Resolution(map, metadata, densityLevel) {
  if (!Number.isInteger(metadata.h3Resolution)) {
    return null;
  }
  const maxResolution = metadata.h3Resolution ?? 1;
  const { width: glyphWidth, height: glyphHeight } = sizeForAdaptiveResolution(densityLevel);
  const glyphSize = Math.max(glyphWidth, glyphHeight);

  for (let res = H3_MIN_RESOLUTION; res < maxResolution; res++) {
    const { bboxWidth, bboxHeight } = getProjectedCellMetrics(map, res);
    if (Math.min(bboxWidth, bboxHeight) <= 2 * glyphSize) {
      return res;
    }
  }
  return maxResolution;
}

function getProjectedGridCellMetrics(map, degrees) {
  const center = map.getCenter();
  const { latIndex, lonIndex } = getGridIndexes(center.lat, center.lng, degrees);
  const south = -90 + latIndex * degrees;
  const north = Math.min(90, south + degrees);
  const west = -180 + lonIndex * degrees;
  const east = Math.min(180, west + degrees);
  const projected = [
    map.project([west, south]),
    map.project([east, south]),
    map.project([east, north]),
    map.project([west, north])
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minEdge = Infinity;

  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const next = projected[(index + 1) % projected.length];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minEdge = Math.min(minEdge, distance(point, next));
  }

  return {
    bboxWidth: maxX - minX,
    bboxHeight: maxY - minY,
    minEdge
  };
}

function getAdaptiveGridDegrees(map, densityLevel) {
  const { width: glyphWidth, height: glyphHeight } = sizeForAdaptiveResolution(densityLevel);
  const glyphSize = Math.max(glyphWidth, glyphHeight);

  for (const degrees of GRID_DEGREE_LEVELS) {
    const { bboxWidth, bboxHeight } = getProjectedGridCellMetrics(map, degrees);
    if (Math.min(bboxWidth, bboxHeight) <= 2 * glyphSize) {
      return degrees;
    }
  }

  return GRID_DEGREE_LEVELS[GRID_DEGREE_LEVELS.length - 1];
}

function toGeoJsonRing(boundary) {
  const ring = [];

  boundary.forEach(([lat, lon], index) => {
    let adjustedLon = lon;
    if (index > 0) {
      const previousLon = ring[index - 1][0];
      while (adjustedLon - previousLon > 180) {
        adjustedLon -= 360;
      }
      while (adjustedLon - previousLon < -180) {
        adjustedLon += 360;
      }
    }
    ring.push([adjustedLon, lat]);
  });

  if (ring.length > 0) {
    ring.push([...ring[0]]);
  }
  return ring;
}

function getH3FeatureCollection(resolution) {
  if (!H3_FEATURE_COLLECTION_CACHE.has(resolution)) {
    const indexes = resolution === 0
      ? getRes0Cells()
      : getRes0Cells().flatMap((cell) => cellToChildren(cell, resolution));
    H3_FEATURE_COLLECTION_CACHE.set(resolution, {
      type: 'FeatureCollection',
      features: indexes.map((h3Index) => ({
        type: 'Feature',
        id: h3Index,
        properties: { id: h3Index },
        geometry: {
          type: 'Polygon',
          coordinates: [toGeoJsonRing(cellToBoundary(h3Index))]
        }
      }))
    });
  }
  return H3_FEATURE_COLLECTION_CACHE.get(resolution);
}

function toGeoJsonGridRing({ south, north, west, east }) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}

function getGridFeatureCollection(degrees) {
  if (!GRID_FEATURE_COLLECTION_CACHE.has(degrees)) {
    GRID_FEATURE_COLLECTION_CACHE.set(degrees, {
      type: 'FeatureCollection',
      features: getGridDisplayCells(degrees).map((cell) => ({
        type: 'Feature',
        id: cell.id,
        properties: { id: cell.id },
        geometry: {
          type: 'Polygon',
          coordinates: [toGeoJsonGridRing(cell.gridBounds)]
        }
      }))
    });
  }
  return GRID_FEATURE_COLLECTION_CACHE.get(degrees);
}

function getGridLineFeatureCollection(degrees) {
  if (!GRID_LINE_FEATURE_COLLECTION_CACHE.has(degrees)) {
    const step = Math.min(degrees, 5);
    const features = [];
    for (let lat = -90 + degrees; lat < 90; lat += degrees) {
      const coordinates = [];
      for (let lon = -180; lon <= 180; lon += step) {
        coordinates.push([lon, lat]);
      }
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
    }
    for (let lon = -180; lon < 180; lon += degrees) {
      const coordinates = [];
      for (let lat = -90; lat <= 90; lat += step) {
        coordinates.push([lon, lat]);
      }
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
    }
    GRID_LINE_FEATURE_COLLECTION_CACHE.set(degrees, { type: 'FeatureCollection', features });
  }
  return GRID_LINE_FEATURE_COLLECTION_CACHE.get(degrees);
}

function syncSelectedMapCell(map, selectedCell) {
  for (const layerId of [H3_SELECTED_FILL_LAYER_ID, H3_SELECTED_LAYER_ID, GRID_SELECTED_FILL_LAYER_ID, GRID_SELECTED_LAYER_ID]) {
    if (!map.getLayer(layerId)) {
      continue;
    }

    map.setFilter(
      layerId,
      selectedCell ? ['==', ['get', 'id'], selectedCell] : ['==', ['get', 'id'], '__none__']
    );
  }
}

function syncHoveredMapCell(map, hoveredCell) {
  for (const layerId of [H3_HOVERED_FILL_LAYER_ID, H3_HOVERED_LAYER_ID, GRID_HOVERED_FILL_LAYER_ID, GRID_HOVERED_LAYER_ID]) {
    if (!map.getLayer(layerId)) {
      continue;
    }

    map.setFilter(
      layerId,
      hoveredCell ? ['==', ['get', 'id'], hoveredCell] : ['==', ['get', 'id'], '__none__']
    );
  }
}

function setUnitLayerVisibility(map, unit) {
  const hexVisible = unit !== 'grid';
  const gridVisible = unit === 'grid';

  for (const [layerId, visible] of [
    [H3_FILL_LAYER_ID, hexVisible],
    [H3_LINE_LAYER_ID, hexVisible],
    [H3_HOVERED_FILL_LAYER_ID, hexVisible],
    [H3_HOVERED_LAYER_ID, hexVisible],
    [H3_SELECTED_FILL_LAYER_ID, hexVisible],
    [H3_SELECTED_LAYER_ID, hexVisible],
    [GRID_FILL_LAYER_ID, gridVisible],
    [GRID_LINE_LAYER_ID, gridVisible],
    [GRID_HOVERED_FILL_LAYER_ID, gridVisible],
    [GRID_HOVERED_LAYER_ID, gridVisible],
    [GRID_SELECTED_FILL_LAYER_ID, gridVisible],
    [GRID_SELECTED_LAYER_ID, gridVisible]
  ]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

function addGeometryLayers(map, resolution, gridDegrees) {
  const sourceData = getH3FeatureCollection(resolution);

  map.addSource(H3_SOURCE_ID, {
    type: 'geojson',
    data: sourceData
  });

  map.addLayer({
    id: H3_FILL_LAYER_ID,
    type: 'fill',
    source: H3_SOURCE_ID,
    paint: {
      'fill-color': '#d9dee3',
      'fill-opacity': 0.02
    }
  });

  map.addLayer({
    id: H3_HOVERED_FILL_LAYER_ID,
    type: 'fill',
    source: H3_SOURCE_ID,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'fill-color': 'rgba(233, 237, 241, 0.9)',
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.08,
        2.44,
        0.12,
        4,
        0.15,
        6,
        0.18
      ]
    }
  });

  map.addLayer({
    id: H3_SELECTED_FILL_LAYER_ID,
    type: 'fill',
    source: H3_SOURCE_ID,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'fill-color': 'rgba(255, 183, 68, 0.98)',
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.14,
        2.44,
        0.18,
        4,
        0.22,
        6,
        0.26
      ]
    }
  });

  map.addLayer({
    id: H3_LINE_LAYER_ID,
    type: 'line',
    source: H3_SOURCE_ID,
    paint: {
      'line-color': 'rgba(214, 222, 230, 0.74)',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1.05,
        2.44,
        1.2,
        4,
        1.4,
        6,
        1.7
      ],
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.36,
        2.44,
        0.34,
        4,
        0.32,
        6,
        0.3
      ]
    }
  });

  map.addLayer({
    id: H3_HOVERED_LAYER_ID,
    type: 'line',
    source: H3_SOURCE_ID,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'line-color': 'rgba(248, 250, 252, 0.98)',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1.35,
        2.44,
        1.7,
        4,
        2.15,
        6,
        2.7
      ],
      'line-opacity': 0.92
    }
  });

  map.addLayer({
    id: H3_SELECTED_LAYER_ID,
    type: 'line',
    source: H3_SOURCE_ID,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'line-color': 'rgba(255, 206, 122, 1)',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1.55,
        2.44,
        1.9,
        4,
        2.3,
        6,
        2.9
      ],
      'line-opacity': 0.98
    }
  });

  map.addSource(GRID_SOURCE_ID, {
    type: 'geojson',
    data: getGridFeatureCollection(gridDegrees)
  });

  map.addSource(GRID_LINE_SOURCE_ID, {
    type: 'geojson',
    data: getGridLineFeatureCollection(gridDegrees)
  });

  map.addLayer({
    id: GRID_FILL_LAYER_ID,
    type: 'fill',
    source: GRID_SOURCE_ID,
    layout: {
      visibility: 'none'
    },
    paint: {
      'fill-color': '#d9dee3',
      'fill-opacity': 0.001
    }
  });

  map.addLayer({
    id: GRID_HOVERED_FILL_LAYER_ID,
    type: 'fill',
    source: GRID_SOURCE_ID,
    layout: {
      visibility: 'none'
    },
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'fill-color': 'rgba(233, 237, 241, 0.9)',
      'fill-opacity': 0.14
    }
  });

  map.addLayer({
    id: GRID_SELECTED_FILL_LAYER_ID,
    type: 'fill',
    source: GRID_SOURCE_ID,
    layout: {
      visibility: 'none'
    },
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'fill-color': 'rgba(255, 183, 68, 0.98)',
      'fill-opacity': 0.2
    }
  });

  map.addLayer({
    id: GRID_LINE_LAYER_ID,
    type: 'line',
    source: GRID_LINE_SOURCE_ID,
    layout: {
      visibility: 'none'
    },
    paint: {
      'line-color': 'rgba(214, 222, 230, 0.7)',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.9,
        2.44,
        1.05,
        4,
        1.25,
        6,
        1.5
      ],
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.32,
        2.44,
        0.3,
        4,
        0.28,
        6,
        0.26
      ]
    }
  });

  map.addLayer({
    id: GRID_HOVERED_LAYER_ID,
    type: 'line',
    source: GRID_SOURCE_ID,
    layout: {
      visibility: 'none'
    },
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'line-color': 'rgba(248, 250, 252, 0.98)',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1.35,
        2.44,
        1.7,
        4,
        2.1,
        6,
        2.6
      ],
      'line-opacity': 0.96
    }
  });

  map.addLayer({
    id: GRID_SELECTED_LAYER_ID,
    type: 'line',
    source: GRID_SOURCE_ID,
    layout: {
      visibility: 'none'
    },
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'line-color': 'rgba(255, 206, 122, 1)',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        1.55,
        2.44,
        1.85,
        4,
        2.25,
        6,
        2.85
      ],
      'line-opacity': 0.98
    }
  });
}

function updateGeometrySources(map, h3Resolution, gridDegrees, unit) {
  if (unit === 'grid') {
    map.getSource(GRID_SOURCE_ID)?.setData(getGridFeatureCollection(gridDegrees));
    map.getSource(GRID_LINE_SOURCE_ID)?.setData(getGridLineFeatureCollection(gridDegrees));
  } else {
    map.getSource(H3_SOURCE_ID)?.setData(getH3FeatureCollection(h3Resolution));
  }
}

export async function createMapView({ container, metadata, rawCells, store, onLoadingChange = () => {} }) {
  const initialView = {
    center: [-1.53, 47.22],
    zoom: 2.44
  };
  const mapStage = container.parentElement;
  const searchForm = mapStage?.querySelector('[data-map-search-form]');
  const searchInput = mapStage?.querySelector('[data-map-search-input]');
  const searchStatus = mapStage?.querySelector('[data-map-search-status]');
  const searchSubmit = searchForm?.querySelector('[type="submit"]');
  let activeSearchSelection = null;
  const searchPinElement = document.createElement('div');
  searchPinElement.className = 'map-search-pin';
  searchPinElement.innerHTML = `
    <span class="map-search-pin__dot" aria-hidden="true"></span>
    <span class="map-search-pin__label"></span>
  `;
  const searchPinLabel = searchPinElement.querySelector('.map-search-pin__label');
  const searchPinMarker = new maplibregl.Marker({
    element: searchPinElement,
    anchor: 'bottom'
  });
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE_URL,
    center: initialView.center,
    zoom: initialView.zoom,
    minZoom: initialView.zoom,
    maxZoom: 6.2,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    maxPitch: 0,
    dragRotate: false,
    touchPitch: false,
    attributionControl: false
  });
  const whenMapLoaded = new Promise((resolve) => map.once('load', resolve));
  let activeSearchToken = 0;

  map.touchZoomRotate.disableRotation();
  map.doubleClickZoom.enable();
  map.scrollZoom.enable();
  map.keyboard.disableRotation();
  const mapCanvas = map.getCanvas();
  mapCanvas.setAttribute('aria-label', 'Interactive globe');
  mapCanvas.setAttribute('aria-describedby', 'map-keyboard-help');
  mapCanvas.setAttribute('role', 'application');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  function setSearchStatus(message = '', isError = false) {
    if (!searchStatus) {
      return;
    }

    searchStatus.hidden = !message;
    searchStatus.textContent = message;
    searchStatus.style.color = isError ? '#d7b4b4' : '#d2d5d8';
    searchStatus.style.borderColor = isError ? 'rgba(215, 118, 118, 0.24)' : 'rgba(166, 172, 178, 0.16)';
  }

  function clearSearchSelectionMarker() {
    activeSearchSelection = null;
    searchPinMarker.remove();
  }

  function showSearchSelectionMarker(lon, lat, label) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return;
    }

    if (searchPinLabel) {
      searchPinLabel.textContent = label;
    }
    searchPinMarker.setLngLat([lon, lat]).addTo(map);
  }

  function buildSearchResultLabel(result, query) {
    const preferred = result.name?.trim() || result.display_name?.split(',')[0]?.trim() || query;
    if (!preferred) {
      return 'Selected place';
    }
    return preferred.length > 48 ? `${preferred.slice(0, 45).trimEnd()}...` : preferred;
  }

  function focusSearchResult(result) {
    const lon = Number(result.lon);
    const lat = Number(result.lat);
    const bounds = Array.isArray(result.boundingbox) ? result.boundingbox.map(Number) : [];
    const [south, north, west, east] = bounds;
    const hasBounds = bounds.length === 4 && bounds.every((value) => Number.isFinite(value));
    const maxZoom = map.getMaxZoom();

    if (hasBounds) {
      map.fitBounds(
        [
          [west, south],
          [east, north]
        ],
        {
          padding: 64,
          maxZoom,
          duration: 900
        }
      );
      return;
    }

    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      map.easeTo({
        center: [lon, lat],
        zoom: maxZoom,
        duration: 900
      });
    }
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();
    const query = searchInput?.value?.trim();
    if (!query) {
      setSearchStatus('Enter a place name to search.', true);
      return;
    }

    const searchToken = ++activeSearchToken;
    clearSearchSelectionMarker();
    setSearchStatus('Searching...');
    if (searchSubmit) {
      searchSubmit.disabled = true;
    }

    try {
      if (!map.loaded()) {
        await whenMapLoaded;
      }

      const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '1',
        'accept-language': 'en'
      });
      const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout?.(15000)
      });
      if (!response.ok) {
        throw new Error(`Search failed (HTTP ${response.status}). Please try again in a moment.`);
      }

      const results = await response.json();
      if (searchToken !== activeSearchToken) {
        return;
      }
      if (!Array.isArray(results) || results.length === 0) {
        setSearchStatus(`No place found for "${query}".`, true);
        return;
      }

      const topResult = results[0];
      const lon = Number(topResult.lon);
      const lat = Number(topResult.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        setSearchStatus(`No place found for "${query}".`, true);
        return;
      }
      setSearchStatus(topResult.display_name ?? query);

      const selectedCellId = displayedCellIdAt(lat, lon);
      activeSearchSelection = {
        cellId: selectedCellId,
        label: buildSearchResultLabel(topResult, query)
      };
      showSearchSelectionMarker(lon, lat, activeSearchSelection.label);
      store.selectCell(selectedCellId, { lat, lon });
      focusSearchResult(topResult);
    } catch (error) {
      if (searchToken !== activeSearchToken) {
        return;
      }
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      setSearchStatus(timedOut ? 'Search timed out. Please try again.' : error.message || 'Search failed.', true);
    } finally {
      if (searchSubmit && searchToken === activeSearchToken) {
        searchSubmit.disabled = false;
      }
    }
  }

  searchForm?.addEventListener('submit', handleSearchSubmit);

  const iconMarkup = {
    plus: `
      <svg viewBox="0 0 24 24" aria-hidden="true" class="map-actions__icon map-actions__icon--plus">
        <path d="M12 5.25v13.5M5.25 12h13.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" />
      </svg>
    `,
    minus: `
      <svg viewBox="0 0 24 24" aria-hidden="true" class="map-actions__icon map-actions__icon--minus">
        <path d="M5.25 12h13.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" />
      </svg>
    `,
    globe: `
      <svg viewBox="0 0 24 24" aria-hidden="true" class="map-actions__icon map-actions__icon--globe">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7" />
        <path d="M4.75 12h14.5M12 4.2v15.6M9.1 4.95c-0.95 1.92-1.45 4.28-1.45 7.05s0.5 5.13 1.45 7.05M14.9 4.95c0.95 1.92 1.45 4.28 1.45 7.05s-0.5 5.13-1.45 7.05M7.15 7.35c1.38.71 3.02 1.1 4.85 1.1s3.47-.39 4.85-1.1M7.15 16.65c1.38-.71 3.02-1.1 4.85-1.1s3.47.39 4.85 1.1" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
      </svg>
    `
  };

  class GlobeControls {
    onAdd(currentMap) {
      this._map = currentMap;
      const wrapper = document.createElement('div');
      wrapper.className = 'map-actions';
      wrapper.innerHTML = `
        <button type="button" class="map-actions__button" data-map-action="zoom-in" aria-label="Zoom in">${iconMarkup.plus}</button>
        <button type="button" class="map-actions__button" data-map-action="zoom-out" aria-label="Zoom out">${iconMarkup.minus}</button>
        <button type="button" class="map-actions__button map-actions__button--reset" data-map-action="reset" aria-label="Reset globe view">${iconMarkup.globe}</button>
      `;
      wrapper.addEventListener('click', (event) => {
        const button = event.target.closest('[data-map-action]');
        if (!button) {
          return;
        }
        const action = button.dataset.mapAction;
        if (action === 'zoom-in') {
          this._map.zoomIn({ duration: 280 });
        } else if (action === 'zoom-out') {
          this._map.zoomOut({ duration: 280 });
        } else if (action === 'reset') {
          this._map.easeTo({
            zoom: initialView.zoom,
            duration: 520
          });
        }
      });
      this._container = wrapper;
      return wrapper;
    }

    onRemove() {
      this._container?.remove();
      this._map = undefined;
    }
  }

  map.addControl(new GlobeControls(), 'top-right');

  let latestVisibleCellIds = new Set();
  const glyphOverlay = createGlyphOverlay({
    map,
    host: container,
    metadata,
    store,
    onVisibleCellsChange: (visibleIds) => {
      latestVisibleCellIds = visibleIds;
    },
    onSelectCell: (cellId) => {
      const cell = getDisplayCell(cellId);
      store.selectCell(cellId, cell && Number.isFinite(cell.lat) ? { lat: cell.lat, lon: cell.lon } : null);
    }
  });

  let currentAppState = store.getState();
  let currentDensityLevel = getDensityLevelForZoom(initialView.zoom);
  let liveDensityLevel = currentDensityLevel;
  let interactionPhase = 'idle';
  let currentUnit = currentAppState.unit ?? 'hexagon';
  let currentGridDegrees = GRID_DEFAULT_DEGREES;
  let currentH3Resolution = H3_MIN_RESOLUTION;
  let currentViewportDomains = null;
  let committedOverlayState = null;
  let layoutFrame = null;
  let scheduledState = null;
  let scheduledPhase = 'idle';
  let scheduledDensityLevel = currentDensityLevel;
  let settleTimer = null;
  let contentRefreshFrame = null;
  let pendingContentRefresh = null;
  let loadingSequence = 0;
  let loadingFallbackTimer = null;
  let pointerMoveFrame = null;
  let lastPointerEvent = null;
  let displayedGeometryKey = null;

  function usesViewportScale(state = currentAppState) {
    return state.colorScaleMode === 'viewport' || state.chartValueScaleMode === 'viewport';
  }

  function displayedCellIdAt(lat, lon, unit = currentUnit) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return unit === 'grid' ? getGridCellIdAt(lat, lon, currentGridDegrees) : latLngToCell(lat, lon, currentH3Resolution);
  }

  function computeViewportDomains() {
    if (!usesViewportScale() || !latestVisibleCellIds.size) {
      return null;
    }
    const visibleCells = [...latestVisibleCellIds].map((id) => getDisplayCell(id)).filter(Boolean);
    if (!visibleCells.length) {
      return null;
    }
    return getCommittedValueDomains(visibleCells, metadata, {
      ...currentAppState,
      displayedH3Resolution: currentUnit === 'grid' ? null : currentH3Resolution,
      displayedGridDegrees: currentUnit === 'grid' ? currentGridDegrees : null
    }, { cache: false });
  }

  function domainsEqual(a, b) {
    if (!a || !b) {
      return a === b;
    }
    return ['temperature', 'precipitation'].every(
      (key) => Math.abs(a[key][0] - b[key][0]) < 1e-3 && Math.abs(a[key][1] - b[key][1]) < 1e-3
    );
  }

  function refreshViewportDomains() {
    const next = computeViewportDomains();
    if (!domainsEqual(next, currentViewportDomains)) {
      currentViewportDomains = next;
      store.setViewportDomains(next);
    }
  }

  function rebuildOverlayState() {
    committedOverlayState = buildOverlayState(
      rawCells,
      metadata,
      currentAppState,
      currentDensityLevel,
      currentH3Resolution,
      currentGridDegrees,
      currentAppState.colorScaleMode === 'viewport' ? currentViewportDomains : null
    );
    return committedOverlayState;
  }

  function clearLoadingFallbackTimer() {
    if (loadingFallbackTimer) {
      clearTimeout(loadingFallbackTimer);
      loadingFallbackTimer = null;
    }
  }

  function shouldShowRenderLoading(changedKey) {
    return (
      changedKey === 'init' ||
      changedKey === 'symbol' ||
      changedKey === 'variable' ||
      changedKey === 'colorScaleMode' ||
      changedKey === 'ranges' ||
      changedKey === 'periodMonths'
    );
  }

  function beginRenderLoading(changedKey) {
    if (!shouldShowRenderLoading(changedKey)) {
      return 0;
    }

    clearLoadingFallbackTimer();
    const sequence = ++loadingSequence;
    onLoadingChange({
      active: true,
      ...(RENDER_LOADING_COPY[changedKey] ?? RENDER_LOADING_COPY.default)
    });
    return sequence;
  }

  function finishRenderLoading(sequence) {
    if (!sequence || sequence !== loadingSequence) {
      return;
    }

    clearLoadingFallbackTimer();
    let completed = false;
    const finalize = () => {
      if (completed || sequence !== loadingSequence) {
        return;
      }
      completed = true;
      clearLoadingFallbackTimer();
      onLoadingChange({ active: false });
    };

    requestAnimationFrame(() => {
      if (sequence !== loadingSequence) {
        return;
      }

      if (!map.loaded()) {
        finalize();
        return;
      }

      map.once('idle', finalize);
      loadingFallbackTimer = setTimeout(finalize, 480);
    });
  }

  function flushScheduledContentRefresh() {
    contentRefreshFrame = null;
    const pending = pendingContentRefresh;
    pendingContentRefresh = null;
    if (!pending) {
      return;
    }

    applyDisplayedGeometry();
    finishRenderLoading(pending.loadingSequence);
  }

  function scheduleContentRefresh(changedKey) {
    cancelSettlingRefresh();
    currentDensityLevel = liveDensityLevel;
    const loadingSequenceForChange = beginRenderLoading(changedKey);
    pendingContentRefresh = {
      loadingSequence: loadingSequenceForChange || pendingContentRefresh?.loadingSequence || 0
    };
    if (contentRefreshFrame) {
      cancelAnimationFrame(contentRefreshFrame);
    }
    contentRefreshFrame = requestAnimationFrame(flushScheduledContentRefresh);
  }

  function clearMapHover(event) {
    const nextTarget = event?.originalEvent?.relatedTarget;
    if (nextTarget instanceof Element && nextTarget.closest('.glyph-card')) {
      return;
    }

    map.getCanvas().style.cursor = '';
    const currentStoreState = store.getState();
    if (currentStoreState.hoveredCell || currentStoreState.hoveredPosition) {
      store.setHoveredCell(null, null);
    }
  }

  function isPointerOnFrontHemisphere(lngLat) {
    const center = map.getCenter();
    return angularDistance(
      { lat: lngLat.lat, lon: lngLat.lng },
      { lat: center.lat, lon: center.lng }
    ) < Math.PI / 2 - 0.015;
  }

  function resolvePointerLngLat(event) {
    if (!event?.point) {
      return null;
    }
    const lngLat = event.lngLat ?? map.unproject(event.point);
    if (!Number.isFinite(lngLat?.lat) || !Number.isFinite(lngLat?.lng) || !isPointerOnFrontHemisphere(lngLat)) {
      return null;
    }
    return lngLat;
  }

  function focusSelection(state) {
    const anchor = state.selectedAnchor ?? getDisplayCell(state.selectedCell);
    if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon)) {
      return;
    }
    map.easeTo({
      center: [anchor.lon, anchor.lat],
      duration: 620
    });
  }

  function processPointerMove(event) {
    if (interactionPhase !== 'idle') {
      return;
    }

    const lngLat = resolvePointerLngLat(event);
    const hoveredCellId = lngLat ? displayedCellIdAt(lngLat.lat, lngLat.lng) : null;
    if (!hoveredCellId || !getDisplayCell(hoveredCellId)) {
      clearMapHover();
      return;
    }

    map.getCanvas().style.cursor = 'pointer';
    const nextPosition = { x: event.point.x, y: event.point.y };
    const currentStoreState = store.getState();
    if (
      currentStoreState.hoveredCell !== hoveredCellId ||
      !currentStoreState.hoveredPosition ||
      Math.abs(currentStoreState.hoveredPosition.x - nextPosition.x) > 2 ||
      Math.abs(currentStoreState.hoveredPosition.y - nextPosition.y) > 2
    ) {
      store.setHoveredCell(hoveredCellId, nextPosition);
    }
  }

  function handleMapPointerMove(event) {
    lastPointerEvent = event;
    if (pointerMoveFrame) {
      return;
    }
    pointerMoveFrame = requestAnimationFrame(() => {
      pointerMoveFrame = null;
      if (lastPointerEvent) {
        processPointerMove(lastPointerEvent);
      }
    });
  }

  function handleMapClick(event) {
    const lngLat = resolvePointerLngLat(event);
    if (!lngLat) {
      return;
    }
    const cellId = displayedCellIdAt(lngLat.lat, lngLat.lng);
    if (cellId && getDisplayCell(cellId)) {
      store.selectCell(cellId, { lat: lngLat.lat, lon: lngLat.lng });
    }
  }

  function handleMapKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      const center = map.getCenter();
      const cellId = displayedCellIdAt(center.lat, center.lng);
      if (cellId && getDisplayCell(cellId)) {
        event.preventDefault();
        store.selectCell(cellId, { lat: center.lat, lon: center.lng });
      }
    } else if (event.key === 'Escape' && currentAppState.selectedCell) {
      event.preventDefault();
      clearSearchSelectionMarker();
      store.selectCell(null);
    }
  }

  // Keeps the selection on the cell that contains the selection anchor whenever the
  // displayed level (zoom-dependent resolution or hexagon/grid unit) changes.
  function remapSelectionToDisplayedLevel() {
    const { selectedCell, selectedAnchor } = currentAppState;
    if (!selectedCell) {
      return;
    }
    const anchor = selectedAnchor ?? getDisplayCell(selectedCell);
    const nextId = anchor ? displayedCellIdAt(anchor.lat, anchor.lon) : null;
    if (nextId && nextId !== selectedCell) {
      if (activeSearchSelection?.cellId === selectedCell) {
        activeSearchSelection.cellId = nextId;
      }
      store.remapSelectedCell(nextId);
    }
  }

  function syncSelectionHighlight() {
    syncSelectedMapCell(map, currentAppState.selectedCell);
    if (committedOverlayState) {
      glyphOverlay.syncInteractionState({
        ...committedOverlayState,
        hoveredCell: currentAppState.hoveredCell,
        hoveredPosition: currentAppState.hoveredPosition,
        selectedCell: currentAppState.selectedCell,
        displayedSelectedCell: currentAppState.selectedCell
      });
    }
  }

  function applyDisplayedGeometry() {
    const geometryKey = currentUnit === 'grid' ? `grid:${currentGridDegrees}` : `h3:${currentH3Resolution}`;
    const geometryChanged = geometryKey !== displayedGeometryKey;
    displayedGeometryKey = geometryKey;
    store.setDisplayedResolution(currentUnit === 'grid' ? null : currentH3Resolution, currentUnit === 'grid' ? currentGridDegrees : null);
    if (geometryChanged) {
      updateGeometrySources(map, currentH3Resolution, currentGridDegrees, currentUnit);
      if (currentAppState.hoveredCell) {
        store.setHoveredCell(null, null);
      }
      remapSelectionToDisplayedLevel();
      latestVisibleCellIds = new Set();
    }
    syncHoveredMapCell(map, currentAppState.hoveredCell);
    refreshViewportDomains();
    rebuildOverlayState();
    glyphOverlay.renderContent(committedOverlayState);
    syncSelectionHighlight();
    scheduleLayout(committedOverlayState, interactionPhase, currentDensityLevel);
  }

  function syncGeometryResolutionForViewport() {
    const nextH3Resolution = getAdaptiveH3Resolution(map, metadata, liveDensityLevel);
    const nextGridDegrees = getAdaptiveGridDegrees(map, liveDensityLevel);
    const changed = currentUnit === 'grid' ? nextGridDegrees !== currentGridDegrees : nextH3Resolution !== currentH3Resolution;
    currentH3Resolution = nextH3Resolution;
    currentGridDegrees = nextGridDegrees;
    if (changed) {
      currentDensityLevel = liveDensityLevel;
      applyDisplayedGeometry();
    }
    return changed;
  }

  function scheduleLayout(state = committedOverlayState, phase = interactionPhase, densityLevel = liveDensityLevel) {
    if (!state) {
      return;
    }
    scheduledState = state;
    scheduledPhase = phase;
    scheduledDensityLevel = densityLevel;
    if (layoutFrame) {
      return;
    }
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      glyphOverlay.updateLayout(scheduledState, scheduledPhase, scheduledDensityLevel);
    });
  }

  function cancelSettlingRefresh() {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  function startInteraction() {
    cancelSettlingRefresh();
    if (interactionPhase !== 'moving') {
      interactionPhase = 'moving';
      glyphOverlay.setInteractionPhase('moving');
      if (store.getState().hoveredCell) {
        store.setHoveredCell(null, null);
      }
    }
  }

  function commitFullRefresh() {
    currentDensityLevel = liveDensityLevel;
    interactionPhase = 'idle';
    glyphOverlay.setInteractionPhase('idle');
    refreshViewportDomains();
    rebuildOverlayState();
    glyphOverlay.renderContent(committedOverlayState);
    syncSelectionHighlight();
    scheduleLayout(committedOverlayState, 'idle', currentDensityLevel);
  }

  function settleAfterMovement() {
    cancelSettlingRefresh();
    interactionPhase = 'settling';
    glyphOverlay.setInteractionPhase('settling');
    scheduleLayout(committedOverlayState, 'settling', liveDensityLevel);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      commitFullRefresh();
    }, 120);
  }

  map.on('load', () => {
    const initialLoadingSequence = beginRenderLoading('init');
    map.setProjection({ type: 'globe' });
    map.setBearing(0);
    currentUnit = currentAppState.unit ?? 'hexagon';
    currentH3Resolution = getAdaptiveH3Resolution(map, metadata, currentDensityLevel);
    currentGridDegrees = getAdaptiveGridDegrees(map, currentDensityLevel);
    addGeometryLayers(map, currentH3Resolution, currentGridDegrees);
    void addReferenceLabelLayers(map, currentAppState).then(() => liftInteractiveCellLayers(map));
    setUnitLayerVisibility(map, currentUnit);
    applyDisplayedGeometry();
    updateLineLayerOpacity(currentAppState.strokeOpacity ?? 1);
    map.on('mousemove', handleMapPointerMove);
    map.on('click', handleMapClick);
    map.on('mouseout', clearMapHover);
    mapCanvas.addEventListener('keydown', handleMapKeydown);
    glyphOverlay.setOpacity(store.getState().symbolOpacity ?? 0.9);
    map.once('idle', () => {
      commitFullRefresh();
    });
    finishRenderLoading(initialLoadingSequence);
  });

  map.on('movestart', () => {
    startInteraction();
    scheduleLayout(committedOverlayState, 'moving', liveDensityLevel);
  });

  map.on('move', () => {
    scheduleLayout(committedOverlayState, interactionPhase, liveDensityLevel);
  });

  map.on('moveend', () => {
    if (map.getBearing() !== 0) {
      map.setBearing(0);
    }
    syncGeometryResolutionForViewport();
    settleAfterMovement();
  });

  map.on('zoom', () => {
    liveDensityLevel = getDensityLevelForZoom(map.getZoom());
    scheduleLayout(committedOverlayState, interactionPhase === 'idle' ? 'moving' : interactionPhase, liveDensityLevel);
  });

  window.addEventListener('resize', () => {
    scheduleLayout(committedOverlayState, interactionPhase, liveDensityLevel);
  });

  function updateLineLayerOpacity(strokeOpacity = 1) {
    const numericStrokeOpacity = Number(strokeOpacity);
    const factor = Number.isFinite(numericStrokeOpacity) ? clamp(numericStrokeOpacity, 0, 1) : 1;
    const h3BaseOpacity = [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      0.72 * factor,
      2.44,
      0.68 * factor,
      4,
      0.62 * factor,
      6,
      0.56 * factor
    ];
    const gridBaseOpacity = [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      0.7 * factor,
      2.44,
      0.66 * factor,
      4,
      0.6 * factor,
      6,
      0.54 * factor
    ];

    const setPaintIfLayerExists = (layerId, property, value) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, property, value);
      }
    };
    
    // Update H3 fill layers
    setPaintIfLayerExists(H3_FILL_LAYER_ID, 'fill-opacity', 0.02 * factor);
    setPaintIfLayerExists(H3_HOVERED_FILL_LAYER_ID, 'fill-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      0.2,
      2.44,
      0.24,
      4,
      0.28,
      6,
      0.32
    ]);
    setPaintIfLayerExists(H3_SELECTED_FILL_LAYER_ID, 'fill-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      0.14 * factor,
      2.44,
      0.18 * factor,
      4,
      0.22 * factor,
      6,
      0.26 * factor
    ]);
    
    // Update H3 line layers
    setPaintIfLayerExists(H3_LINE_LAYER_ID, 'line-opacity', h3BaseOpacity);
    setPaintIfLayerExists(H3_HOVERED_LAYER_ID, 'line-opacity', 0.98);
    setPaintIfLayerExists(H3_SELECTED_LAYER_ID, 'line-opacity', 0.98);
    
    // Update Grid fill layers (already at 0 or specific values)
    setPaintIfLayerExists(GRID_FILL_LAYER_ID, 'fill-opacity', 0.001);
    setPaintIfLayerExists(GRID_HOVERED_FILL_LAYER_ID, 'fill-opacity', 0.3);
    setPaintIfLayerExists(GRID_SELECTED_FILL_LAYER_ID, 'fill-opacity', 0.22);
    
    // Update Grid line layers
    setPaintIfLayerExists(GRID_LINE_LAYER_ID, 'line-opacity', gridBaseOpacity);
    setPaintIfLayerExists(GRID_HOVERED_LAYER_ID, 'line-opacity', 0.98);
    setPaintIfLayerExists(GRID_SELECTED_LAYER_ID, 'line-opacity', 0.98);
  }

  const CONTENT_CHANGE_KEYS = new Set([
    'symbol',
    'variable',
    'colorScaleMode',
    'ranges',
    'periodMonths',
    'glyphSize'
  ]);

  return {
    handleStateChange(state, previousState, changedKey) {
      currentAppState = state;

      if (changedKey === 'strokeOpacity' || changedKey === 'init') {
        updateLineLayerOpacity(state.strokeOpacity ?? 1);
      }

      if (
        changedKey === 'showCountryBorder' ||
        changedKey === 'showCountryLabel' ||
        changedKey === 'showCityLabel' ||
        changedKey === 'init'
      ) {
        syncLabelLayerVisibility(map, state);
      }

      if (changedKey === 'symbolOpacity') {
        glyphOverlay.setOpacity(state.symbolOpacity ?? 0.9);
      }

      if (changedKey === 'hoveredCell' && previousState?.hoveredCell !== state.hoveredCell) {
        syncHoveredMapCell(map, state.hoveredCell);
        if (committedOverlayState) {
          glyphOverlay.syncInteractionState({
            ...committedOverlayState,
            hoveredCell: state.hoveredCell,
            hoveredPosition: state.hoveredPosition,
            selectedCell: state.selectedCell,
            displayedSelectedCell: state.selectedCell
          });
        }
      }

      if (changedKey === 'selectedCell' || changedKey === 'selectedCellRemap') {
        syncSelectionHighlight();
        if (activeSearchSelection && state.selectedCell !== activeSearchSelection.cellId) {
          clearSearchSelectionMarker();
        }
        const fromSearch = activeSearchSelection && state.selectedCell === activeSearchSelection.cellId;
        if (changedKey === 'selectedCell' && state.selectedCell && !fromSearch) {
          focusSelection(state);
        }
      }

      if (!map.loaded() || changedKey === 'init') {
        return;
      }

      if (changedKey === 'symbol' && state.unit !== currentUnit) {
        currentUnit = state.unit ?? 'hexagon';
        setUnitLayerVisibility(map, currentUnit);
      }

      if (changedKey === 'chartValueScaleMode') {
        refreshViewportDomains();
      }

      if (CONTENT_CHANGE_KEYS.has(changedKey)) {
        scheduleContentRefresh(changedKey);
      }
    }
  };
}
