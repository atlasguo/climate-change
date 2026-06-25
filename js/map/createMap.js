import maplibregl from 'maplibre-gl';
import { cellToBoundary, cellToChildren, cellToLatLng, cellToParent, getRes0Cells, getResolution, isValidCell, latLngToCell } from 'h3-js';
import { buildCellSummary, buildRenderableCells, getCommittedValueDomains, getDensityLevelForZoom } from '../state/selectors.js';
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
const H3_CENTER_DOT_SOURCE_ID = 'climate-h3-center-dots';
const H3_CENTER_DOT_LAYER_ID = 'climate-h3-center-dots-layer';
const COUNTRY_BORDER_SOURCE_ID = 'climate-country-borders';
const COUNTRY_BORDER_LAYER_ID = 'climate-country-borders-layer';
const COUNTRY_LABEL_SOURCE_ID = 'climate-country-labels';
const COUNTRY_LABEL_LAYER_ID = 'climate-country-labels-layer';
const CITY_LABEL_SOURCE_ID = 'climate-city-labels';
const CITY_LABEL_LAYER_ID = 'climate-city-labels-layer';
const H3_FEATURE_COLLECTION_CACHE = new Map();
const GRID_FEATURE_COLLECTION_CACHE = new Map();
const GRID_LINE_FEATURE_COLLECTION_CACHE = new Map();
const GRID_LAYOUT_CACHE = new Map();
const H3_CELL_AGGREGATION_CACHE = new Map();
const H3_BOUNDARY_CACHE = new Map();
const H3_CENTER_CACHE = new Map();
const H3_MIN_RESOLUTION = 0;
const GLYPHS_ENABLED = true;
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
          'line-color': '#141719',
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
        'text-font': ['Noto Sans Regular', 'Open Sans Regular', 'Arial Unicode MS Regular'],
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
        'text-font': ['Noto Sans Regular', 'Open Sans Regular', 'Arial Unicode MS Regular'],
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


function aggregateCellsToH3Resolution(cells, resolution, baseResolution) {
  if (resolution >= baseResolution) {
    return cells.map((cell) => ({
      ...cell,
      sourceId: cell.sourceId ?? cell.id
    }));
  }

  const cacheKey = `${baseResolution}->${resolution}`;
  if (H3_CELL_AGGREGATION_CACHE.has(cacheKey)) {
    return H3_CELL_AGGREGATION_CACHE.get(cacheKey);
  }

  const grouped = new Map();

  for (const cell of cells) {
    const parentIndex = cellToParent(cell.h3Index, resolution);
    if (!grouped.has(parentIndex)) {
      grouped.set(parentIndex, []);
    }
    grouped.get(parentIndex).push(cell);
  }

  const aggregated = [...grouped.entries()]
    .map(([h3Index, members]) => {
      const [lat, lon] = cellToLatLng(h3Index);

      const nearest = members.reduce((best, cell) => {
        const d = (cell.lat - lat) ** 2 + (cell.lon - lon) ** 2;
        const bd = (best.lat - lat) ** 2 + (best.lon - lon) ** 2;
        return d < bd ? cell : best;
      });

      return {
        id: h3Index,
        sourceId: nearest.sourceId ?? nearest.id,
        lat: nearest.lat,
        lon: nearest.lon,
        h3Index,
        h3Center: { lat, lon },
        tempSeries: nearest.tempSeries,
        precipSeries: nearest.precipSeries,
        precipRawSeries: nearest.precipRawSeries,
        tempBaselineMonthly: nearest.tempBaselineMonthly,
        precipBaselineMonthly: nearest.precipBaselineMonthly,
        tempTrendPerDecade: nearest.tempTrendPerDecade,
        precipTrendPerDecade: nearest.precipTrendPerDecade
      };
    })
    .sort((a, b) => {
      if (Math.abs(a.lat - b.lat) > 0.01) {
        return b.lat - a.lat;
      }
      return a.lon - b.lon;
    })
    .map((cell, index) => ({
      ...cell,
      sampleRank: index
    }));

  H3_CELL_AGGREGATION_CACHE.set(cacheKey, aggregated);
  return aggregated;
}

function buildGlobalH3Indexes(resolution) {
  if (resolution === 0) {
    return getRes0Cells();
  }

  return getRes0Cells().flatMap((cell) => cellToChildren(cell, resolution));
}

function resolveDisplayedCellId(cellId, displayedResolution) {
  if (!cellId) {
    return null;
  }

  if (!isValidCell(cellId) || displayedResolution == null) {
    return cellId;
  }

  const cellResolution = getResolution(cellId);
  if (cellResolution === -1) {
    return null;
  }

  if (displayedResolution >= cellResolution) {
    return cellId;
  }

  return cellToParent(cellId, displayedResolution);
}

function buildOverlayState(cells, rawCells, metadata, state, densityLevel, h3Resolution) {
  const isGridMode = state.unit === 'grid';
  const usesH3Aggregation = !isGridMode && Number.isInteger(metadata.h3Resolution);
  const effectiveCells = isGridMode
    ? rawCells
    : usesH3Aggregation && Number.isInteger(h3Resolution)
      ? aggregateCellsToH3Resolution(cells, h3Resolution, metadata.h3Resolution)
      : cells;
  const displayedSelectedCell = usesH3Aggregation
    ? resolveDisplayedCellId(state.selectedCell, h3Resolution)
    : state.selectedCell;
  const overlayState = {
    ...state,
    densityLevel,
    displayedSelectedCell,
    displayedH3Resolution: usesH3Aggregation ? h3Resolution : null
  };
  const valueDomains = getCommittedValueDomains(effectiveCells, metadata, overlayState);
  const renderableCells = buildRenderableCells(effectiveCells, metadata, overlayState, valueDomains);
  return {
    ...overlayState,
    renderableCells,
    valueDomains
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


function getCellBoundary(h3Index) {
  if (!H3_BOUNDARY_CACHE.has(h3Index)) {
    H3_BOUNDARY_CACHE.set(h3Index, cellToBoundary(h3Index));
  }
  return H3_BOUNDARY_CACHE.get(h3Index);
}

function getCellCenter(h3Index) {
  if (!H3_CENTER_CACHE.has(h3Index)) {
    const [lat, lon] = cellToLatLng(h3Index);
    H3_CENTER_CACHE.set(h3Index, { lat, lon });
  }
  return H3_CENTER_CACHE.get(h3Index);
}

function isPointInViewport(map, lat, lon, centerAnchor, viewportWidth, viewportHeight) {
  if (angularDistance({ lat, lon }, centerAnchor) >= Math.PI / 2 - 0.02) {
    return false;
  }
  const projected = map.project([lon, lat]);
  return (
    projected.x >= 0 &&
    projected.x <= viewportWidth &&
    projected.y >= 0 &&
    projected.y <= viewportHeight
  );
}

function isCellFullyVisible(map, h3Index, centerAnchor, viewportWidth, viewportHeight) {
  for (const [lat, lon] of getCellBoundary(h3Index)) {
    if (!isPointInViewport(map, lat, lon, centerAnchor, viewportWidth, viewportHeight)) {
      return false;
    }
  }
  return true;
}

function buildVisibleCenterDotFeatureCollection(map, resolution) {
  if (!Number.isInteger(resolution)) {
    return {
      type: 'FeatureCollection',
      features: []
    };
  }
  const viewportWidth = map.getContainer().clientWidth;
  const viewportHeight = map.getContainer().clientHeight;
  const center = map.getCenter();
  const centerAnchor = { lat: center.lat, lon: center.lng };
  const source = map.getSource(H3_SOURCE_ID);
  const sourceFeatures = source?._data?.features ?? [];
  const features = [];

  for (const feature of sourceFeatures) {
    const h3Index = feature.properties?.id ?? feature.id;
    if (!h3Index) {
      continue;
    }
    if (!isCellFullyVisible(map, h3Index, centerAnchor, viewportWidth, viewportHeight)) {
      continue;
    }
    const anchor = getCellCenter(h3Index);

    features.push({
      type: 'Feature',
      id: h3Index,
      properties: {
        id: h3Index
      },
      geometry: {
        type: 'Point',
        coordinates: [anchor.lon, anchor.lat]
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
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

function getRequiredCellMetrics(state, densityLevel) {
  const { width, height } = sizeForAdaptiveResolution(densityLevel);
  return {
    minWidth: width * 1.02,
    minHeight: height * 1.02,
    minEdge: Math.max(8, width * 0.18, height * 0.14)
  };
}

function canUseResolution(map, resolution, state, densityLevel, factor = 1) {
  const metrics = getProjectedCellMetrics(map, resolution);
  const required = getRequiredCellMetrics(state, densityLevel);

  return (
    metrics.bboxWidth >= required.minWidth * factor &&
    metrics.bboxHeight >= required.minHeight * factor &&
    metrics.minEdge >= required.minEdge * factor
  );
}

function getAdaptiveH3Resolution(map, metadata, state, densityLevel, currentResolution) {
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

function buildH3FeatureCollection(cells, resolution, baseResolution) {
  const displayCells = aggregateCellsToH3Resolution(cells, resolution, baseResolution);
  const sourceIdByH3Index = new Map(displayCells.map((cell) => [cell.id, cell.sourceId ?? cell.id]));
  const h3Indexes = buildGlobalH3Indexes(resolution);

  return {
    type: 'FeatureCollection',
    features: h3Indexes.map((h3Index) => ({
      type: 'Feature',
      id: h3Index,
      properties: {
        id: h3Index,
        h3Index,
        sourceId: sourceIdByH3Index.get(h3Index) ?? null
      },
      geometry: {
        type: 'Polygon',
        coordinates: [toGeoJsonRing(cellToBoundary(h3Index))]
      }
    }))
  };
}

function getCachedH3FeatureCollection(cells, resolution, baseResolution) {
  const cacheKey = `${resolution}|${baseResolution}|${cells.length}`;
  if (!H3_FEATURE_COLLECTION_CACHE.has(cacheKey)) {
    H3_FEATURE_COLLECTION_CACHE.set(cacheKey, buildH3FeatureCollection(cells, resolution, baseResolution));
  }
  return H3_FEATURE_COLLECTION_CACHE.get(cacheKey);
}

function getH3FeatureCollectionForResolution(cells, metadata, resolution) {
  return Number.isInteger(resolution)
    ? getCachedH3FeatureCollection(cells, resolution, metadata.h3Resolution)
    : {
        type: 'FeatureCollection',
        features: []
      };
}

function coordinateValueKey(value) {
  return Number(value).toFixed(6);
}

function buildGridLayout(cells) {
  if (!Array.isArray(cells) || cells.length === 0) {
    return {
      latEdges: [],
      lonEdges: [],
      cellBoundsById: new Map(),
      cellIdByCoordinate: new Map()
    };
  }

  const latitudes = [...new Set(cells.map((cell) => cell.lat).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const longitudes = [...new Set(cells.map((cell) => cell.lon).filter(Number.isFinite))]
    .sort((a, b) => a - b);

  const latEdges = latitudes.map((lat, index) => {
    if (index === 0) {
      return -90;
    }
    return (latitudes[index - 1] + lat) / 2;
  });
  latEdges.push(90);

  const lonEdges = longitudes.map((lon, index) => {
    if (index === 0) {
      const previousWrappedLon = longitudes[longitudes.length - 1] - 360;
      return (previousWrappedLon + lon) / 2;
    }
    return (longitudes[index - 1] + lon) / 2;
  });
  lonEdges.push(lonEdges[0] + 360);

  const latIndexByValue = new Map(latitudes.map((lat, index) => [coordinateValueKey(lat), index]));
  const lonIndexByValue = new Map(longitudes.map((lon, index) => [coordinateValueKey(lon), index]));
  const cellBoundsById = new Map();
  const cellIdByCoordinate = new Map();

  for (const cell of cells) {
    const latIndex = latIndexByValue.get(coordinateValueKey(cell.lat));
    const lonIndex = lonIndexByValue.get(coordinateValueKey(cell.lon));
    if (latIndex == null || lonIndex == null) {
      continue;
    }

    cellBoundsById.set(cell.id, {
      south: latEdges[latIndex],
      north: latEdges[latIndex + 1],
      west: lonEdges[lonIndex],
      east: lonEdges[lonIndex + 1],
      latIndex,
      lonIndex
    });
    cellIdByCoordinate.set(`${latIndex}|${lonIndex}`, cell.id);
  }

  return {
    latEdges,
    lonEdges,
    cellBoundsById,
    cellIdByCoordinate
  };
}

function getCachedGridLayout(cells, cacheKey = 'rawGrid') {
  const key = `${cacheKey}|${Array.isArray(cells) ? cells.length : 0}`;
  if (!GRID_LAYOUT_CACHE.has(key)) {
    GRID_LAYOUT_CACHE.set(key, buildGridLayout(cells));
  }
  return GRID_LAYOUT_CACHE.get(key);
}

function normalizeLongitudeForRing(lon, previousLon) {
  let adjustedLon = lon;
  while (adjustedLon - previousLon > 180) {
    adjustedLon -= 360;
  }
  while (adjustedLon - previousLon < -180) {
    adjustedLon += 360;
  }
  return adjustedLon;
}

function toGeoJsonGridRingFromBounds(bounds) {
  const ring = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north]
  ];

  const adjustedRing = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [cornerLon, cornerLat] = ring[index];
    const previousLon = adjustedRing[index - 1]?.[0] ?? cornerLon;
    adjustedRing.push([index === 0 ? cornerLon : normalizeLongitudeForRing(cornerLon, previousLon), cornerLat]);
  }

  adjustedRing.push([...adjustedRing[0]]);
  return adjustedRing;
}

function buildGridFeatureCollection(cells, metadata, resolution = 'rawGrid') {
  const layout = getCachedGridLayout(cells, resolution);

  return {
    type: 'FeatureCollection',
    features: cells
      .map((cell) => {
        const bounds = layout.cellBoundsById.get(cell.id);
        if (!bounds) {
          return null;
        }

        return {
          type: 'Feature',
          id: cell.id,
          properties: {
            id: cell.id
          },
          geometry: {
            type: 'Polygon',
            coordinates: [toGeoJsonGridRingFromBounds(bounds)]
          }
        };
      })
      .filter(Boolean)
  };
}

function roundedCoordinateKey(value) {
  return value.toFixed(6);
}

function coordinateKey(coordinate) {
  return `${roundedCoordinateKey(coordinate[0])},${roundedCoordinateKey(coordinate[1])}`;
}

function edgeKey(start, end) {
  const startKey = coordinateKey(start);
  const endKey = coordinateKey(end);
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function buildGridLineFeatureCollection(cells, metadata, resolution = 'rawGrid') {
  if (!Array.isArray(cells) || cells.length === 0) {
    return {
      type: 'FeatureCollection',
      features: []
    };
  }

  const layout = getCachedGridLayout(cells, resolution);
  const edgeMap = new Map();

  cells.forEach((cell) => {
    const bounds = layout.cellBoundsById.get(cell.id);
    if (!bounds) {
      return;
    }
    const ring = toGeoJsonGridRingFromBounds(bounds);
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      edgeMap.set(edgeKey(start, end), [start, end]);
    }
  });

  return {
    type: 'FeatureCollection',
    features: [...edgeMap.values()].map((coordinates, index) => ({
      type: 'Feature',
      id: `grid-edge-${index}`,
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates
      }
    }))
  };
}

function getCachedGridFeatureCollection(cells, metadata, resolution) {
  if (!GRID_FEATURE_COLLECTION_CACHE.has(resolution)) {
    GRID_FEATURE_COLLECTION_CACHE.set(resolution, buildGridFeatureCollection(cells, metadata, resolution));
  }
  return GRID_FEATURE_COLLECTION_CACHE.get(resolution);
}

function getCachedGridLineFeatureCollection(cells, metadata, resolution) {
  if (!GRID_LINE_FEATURE_COLLECTION_CACHE.has(resolution)) {
    GRID_LINE_FEATURE_COLLECTION_CACHE.set(resolution, buildGridLineFeatureCollection(cells, metadata, resolution));
  }
  return GRID_LINE_FEATURE_COLLECTION_CACHE.get(resolution);
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

function addGeometryLayers(map, resolution, metadata, cells, rawCells) {
  const sourceData = getH3FeatureCollectionForResolution(cells, metadata, resolution);

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
    data: getCachedGridFeatureCollection(rawCells, metadata, 'rawGrid')
  });

  map.addSource(GRID_LINE_SOURCE_ID, {
    type: 'geojson',
    data: getCachedGridLineFeatureCollection(rawCells, metadata, 'rawGrid')
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

  map.addSource(H3_CENTER_DOT_SOURCE_ID, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addLayer({
    id: H3_CENTER_DOT_LAYER_ID,
    type: 'circle',
    source: H3_CENTER_DOT_SOURCE_ID,
    layout: {
      visibility: GLYPHS_ENABLED ? 'none' : 'visible'
    },
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        2.44,
        1.1,
        4,
        1.35,
        6,
        1.7
      ],
      'circle-opacity': 0.96
    }
  });
}

function updateGeometrySources(map, cells, rawCells, metadata, resolution) {
  const h3FeatureCollection = getH3FeatureCollectionForResolution(cells, metadata, resolution);
  const h3Source = map.getSource(H3_SOURCE_ID);
  if (h3Source) {
    h3Source.setData(h3FeatureCollection);
  }

  const gridSource = map.getSource(GRID_SOURCE_ID);
  if (gridSource) {
    gridSource.setData(getCachedGridFeatureCollection(rawCells, metadata, 'rawGrid'));
  }

  const gridLineSource = map.getSource(GRID_LINE_SOURCE_ID);
  if (gridLineSource) {
    gridLineSource.setData(getCachedGridLineFeatureCollection(rawCells, metadata, 'rawGrid'));
  }

  map.triggerRepaint();
  return h3FeatureCollection;
}

function updateVisibleCenterDots(map, resolution, onUpdated) {
  const source = map.getSource(H3_CENTER_DOT_SOURCE_ID);
  if (!source) {
    return;
  }
  const featureCollection = buildVisibleCenterDotFeatureCollection(map, resolution);
  source.setData(featureCollection);
  if (typeof onUpdated === 'function') {
    onUpdated(featureCollection.features);
  }
  map.triggerRepaint();
}

export async function createMapView({ container, metadata, cells, rawCells, store, onLoadingChange = () => {} }) {
  const initialView = {
    center: [-1.53, 47.22],
    zoom: 2.44
  };
  const mapStage = container.parentElement;
  const debugLabel = container.parentElement?.querySelector('[data-map-debug]');
  const searchForm = mapStage?.querySelector('[data-map-search-form]');
  const searchInput = mapStage?.querySelector('[data-map-search-input]');
  const searchStatus = mapStage?.querySelector('[data-map-search-status]');
  const searchSubmit = searchForm?.querySelector('[type="submit"]');
  let latestCenterDotFeatures = [];
  let latestGlyphCount = 0;
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
    preserveDrawingBuffer: true,
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

  function findNearestRawCellId(lat, lon) {
    let bestCell = rawCells[0] ?? null;
    let bestDistance = Infinity;
    for (const cell of rawCells) {
      const distanceToCell = (cell.lat - lat) ** 2 + (cell.lon - lon) ** 2;
      if (distanceToCell < bestDistance) {
        bestDistance = distanceToCell;
        bestCell = cell;
      }
    }
    return bestCell?.id ?? null;
  }

  function findGridEdgeIndex(edges, value) {
    if (!Array.isArray(edges) || edges.length < 2 || !Number.isFinite(value)) {
      return -1;
    }

    if (value <= edges[0]) {
      return 0;
    }
    if (value >= edges[edges.length - 1]) {
      return edges.length - 2;
    }

    let low = 0;
    let high = edges.length - 2;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (value < edges[mid]) {
        high = mid - 1;
      } else if (value >= edges[mid + 1]) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return -1;
  }

  function normalizeGridLongitude(lon, lonEdges) {
    if (!Number.isFinite(lon) || !Array.isArray(lonEdges) || lonEdges.length < 2) {
      return lon;
    }

    let normalized = lon;
    const minLon = lonEdges[0];
    const maxLon = lonEdges[lonEdges.length - 1];
    while (normalized < minLon) {
      normalized += 360;
    }
    while (normalized >= maxLon) {
      normalized -= 360;
    }
    return normalized;
  }

  function findGridCellIdAt(lat, lon) {
    const layout = getCachedGridLayout(rawCells, 'rawGrid');
    const latIndex = findGridEdgeIndex(layout.latEdges, clamp(lat, -90, 90));
    const lonIndex = findGridEdgeIndex(layout.lonEdges, normalizeGridLongitude(lon, layout.lonEdges));
    return layout.cellIdByCoordinate.get(`${latIndex}|${lonIndex}`) ?? null;
  }

  function findNearestRenderableCellId(lat, lon) {
    let bestCell = cells[0] ?? null;
    let bestDistance = Infinity;
    for (const cell of cells) {
      const distanceToCell = (cell.lat - lat) ** 2 + (cell.lon - lon) ** 2;
      if (distanceToCell < bestDistance) {
        bestDistance = distanceToCell;
        bestCell = cell;
      }
    }
    return bestCell?.id ?? null;
  }

  function resolveSearchSelectionCellId(lat, lon, state) {
    if (state?.unit === 'grid') {
      return findNearestRawCellId(lat, lon);
    }

    return findNearestRenderableCellId(lat, lon);
  }

  function focusSearchResult(result) {
    const lon = Number(result.lon);
    const lat = Number(result.lat);
    const bounds = Array.isArray(result.boundingbox) ? result.boundingbox.map(Number) : [];
    const [south, north, west, east] = bounds;
    const hasBounds = bounds.length === 4 && bounds.every((value) => Number.isFinite(value));

    if (hasBounds) {
      map.fitBounds(
        [
          [west, south],
          [east, north]
        ],
        {
          padding: 64,
          maxZoom: 10.5,
          duration: 900
        }
      );
      return;
    }

    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      map.easeTo({
        center: [lon, lat],
        zoom: 8.8,
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
        limit: '5'
      });
      const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Search failed with ${response.status}`);
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
      focusSearchResult(topResult);
      setSearchStatus(topResult.display_name ?? query);

      const selectedCellId = resolveSearchSelectionCellId(lat, lon, currentAppState);
      if (selectedCellId && Number.isFinite(lon) && Number.isFinite(lat)) {
        activeSearchSelection = {
          cellId: selectedCellId,
          lon,
          lat,
          unit: currentAppState.unit ?? 'hexagon',
          label: buildSearchResultLabel(topResult, query)
        };
        showSearchSelectionMarker(lon, lat, activeSearchSelection.label);
        store.selectCell(selectedCellId);
      }
    } catch (error) {
      setSearchStatus(error.message ?? 'Search failed.', true);
    } finally {
      if (searchSubmit) {
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
            center: initialView.center,
            zoom: initialView.zoom,
            bearing: 0,
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

  const glyphOverlay = GLYPHS_ENABLED
    ? createGlyphOverlay({
        map,
        host: container,
        h3SourceId: H3_SOURCE_ID,
        getH3SourceFeatures: () => currentH3FeatureCollection.features,
        metadata,
        cells,
        rawCells,
        store,
        getVisibleCenterDotFeatures: () => latestCenterDotFeatures,
        onGlyphCountChange: (glyphCount) => {
          latestGlyphCount = glyphCount;
          updateDebugLabel();
        },
        onSelectCell: (cellId) => focusSelectedCell(cellId)
      })
    : {
        renderContent() {},
        updateLayout() {},
        setInteractionPhase() {}
      };

  const usesH3Aggregation = Number.isInteger(metadata.h3Resolution);
  let currentAppState = store.getState();
  let currentDensityLevel = getDensityLevelForZoom(initialView.zoom);
  let liveDensityLevel = currentDensityLevel;
  let interactionPhase = 'idle';
  let currentUnit = currentAppState.unit ?? 'hexagon';
  let committedOverlayState = GLYPHS_ENABLED
    ? buildOverlayState(cells, rawCells, metadata, currentAppState, currentDensityLevel, usesH3Aggregation ? metadata.h3Resolution : null)
    : null;
  let layoutFrame = null;
  let scheduledState = committedOverlayState;
  let scheduledPhase = 'idle';
  let scheduledDensityLevel = currentDensityLevel;
  let settleTimer = null;
  let contentRefreshFrame = null;
  let pendingContentRefresh = null;
  let loadingSequence = 0;
  let loadingFallbackTimer = null;
  let currentH3Resolution = usesH3Aggregation ? H3_MIN_RESOLUTION : null;
  let centerDotFrame = null;
  let pointerMoveFrame = null;
  let lastPointerEvent = null;
  let currentDisplayedCellSourceMap = new Map(cells.map((cell) => [cell.id, cell.sourceId ?? cell.id]));
  let currentH3FeatureCollection = getH3FeatureCollectionForResolution(cells, metadata, currentH3Resolution);

  function clearLoadingFallbackTimer() {
    if (loadingFallbackTimer) {
      clearTimeout(loadingFallbackTimer);
      loadingFallbackTimer = null;
    }
  }

  function shouldShowRenderLoading(changedKey) {
    return (
      changedKey === 'init' ||
      changedKey === 'mode' ||
      changedKey === 'symbol' ||
      changedKey === 'unit' ||
      changedKey === 'variable' ||
      changedKey === 'colorScaleMode' ||
      changedKey === 'ranges' ||
      changedKey === 'periodMonths'
    );
  }

  function getRenderLoadingCopy(changedKey) {
    return RENDER_LOADING_COPY[changedKey] ?? RENDER_LOADING_COPY.default;
  }

  function beginRenderLoading(changedKey) {
    if (!shouldShowRenderLoading(changedKey)) {
      return 0;
    }

    clearLoadingFallbackTimer();
    const sequence = ++loadingSequence;
    onLoadingChange({
      active: true,
      ...getRenderLoadingCopy(changedKey)
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

    applyDisplayedGeometryResolution(pending.resolution, pending.state, pending.densityLevel);
    finishRenderLoading(pending.loadingSequence);
  }

  function scheduleContentRefresh(state, changedKey) {
    cancelSettlingRefresh();
    currentDensityLevel = liveDensityLevel;
    pendingContentRefresh = {
      state,
      changedKey,
      densityLevel: currentDensityLevel,
      resolution: currentH3Resolution,
      loadingSequence: beginRenderLoading(changedKey)
    };
    if (contentRefreshFrame) {
      cancelAnimationFrame(contentRefreshFrame);
    }
    contentRefreshFrame = requestAnimationFrame(flushScheduledContentRefresh);
  }

  function resolveDisplayedHoverCellId(cellId, unit = currentUnit) {
    if (!cellId) {
      return null;
    }

    return unit === 'grid' ? cellId : resolveDisplayedCellId(cellId, currentH3Resolution);
  }

  function updateHoveredGeometryFromState(state = currentAppState) {
    syncHoveredMapCell(map, resolveDisplayedHoverCellId(state.hoveredCell, state.unit ?? currentUnit));
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
    updateHoveredGeometryFromState({
      ...currentAppState,
      hoveredCell: null
    });
  }

  function resolveInteractiveFeatureCellId(featureId, unit = currentUnit) {
    if (!featureId) {
      return null;
    }

    if (unit === 'grid') {
      return featureId;
    }

    return currentDisplayedCellSourceMap.get(featureId) ?? null;
  }

  function isPointerOnFrontHemisphere(event) {
    const center = map.getCenter();
    const lngLat = event.lngLat ?? map.unproject(event.point);
    return angularDistance(
      { lat: lngLat.lat, lon: lngLat.lng },
      { lat: center.lat, lon: center.lng }
    ) < Math.PI / 2 - 0.015;
  }

  function resolvePointerCellId(event, { allowNearestGrid = false } = {}) {
    if (!event?.point || !isPointerOnFrontHemisphere(event)) {
      return null;
    }

    const lngLat = event.lngLat ?? map.unproject(event.point);
    if (!Number.isFinite(lngLat.lat) || !Number.isFinite(lngLat.lng)) {
      return null;
    }

    if (currentUnit === 'grid') {
      return findGridCellIdAt(lngLat.lat, lngLat.lng) ?? (allowNearestGrid ? findNearestRawCellId(lngLat.lat, lngLat.lng) : null);
    }

    if (!Number.isInteger(currentH3Resolution)) {
      return null;
    }

    const displayedCellId = latLngToCell(lngLat.lat, lngLat.lng, currentH3Resolution);
    return currentDisplayedCellSourceMap.get(displayedCellId) ?? null;
  }

  function getSelectedCellCenter(cellId) {
    if (!cellId) {
      return null;
    }

    if (isValidCell(cellId)) {
      const [lat, lon] = cellToLatLng(cellId);
      return { lat, lon };
    }

    const found = rawCells.find((cell) => cell.id === cellId) ?? cells.find((cell) => cell.id === cellId);
    if (!found) {
      return null;
    }

    const center = found.h3Center ?? found;
    return { lat: center.lat, lon: center.lon };
  }

  function focusSelectedCell(cellId) {
    const center = getSelectedCellCenter(cellId);
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
      return;
    }

    map.easeTo({
      center: [center.lon, center.lat],
      duration: 620
    });
  }

  function processPointerMove(event) {
    if (interactionPhase !== 'idle') {
      return;
    }

    const hoveredCellId = resolvePointerCellId(event);
    if (!hoveredCellId) {
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
    const hoveredCellId = store.getState().hoveredCell;
    const selectedCellId = hoveredCellId ?? resolvePointerCellId(event, { allowNearestGrid: true });
    if (selectedCellId) {
      store.selectCell(selectedCellId);
      focusSelectedCell(selectedCellId);
    }
  }

  function scheduleCenterDotRefresh() {
    if (!Number.isInteger(currentH3Resolution)) {
      latestCenterDotFeatures = [];
      return;
    }
    if (centerDotFrame) {
      return;
    }
    centerDotFrame = requestAnimationFrame(() => {
      centerDotFrame = null;
      updateVisibleCenterDots(map, currentH3Resolution, (features) => {
        latestCenterDotFeatures = features;
      });
    });
  }

  function updateDebugLabel() {
    if (debugLabel) {
      const zoom = map.getZoom();
      const pendingResolution = getAdaptiveH3Resolution(
        map,
        metadata,
        currentAppState,
        liveDensityLevel,
        currentH3Resolution
      );
      const resolutionLabel = currentUnit === 'grid'
        ? 'Grid'
        : Number.isInteger(currentH3Resolution)
          ? pendingResolution === currentH3Resolution
            ? `H3 L${currentH3Resolution}`
            : `H3 L${currentH3Resolution} -> L${pendingResolution}`
          : 'No H3';
      debugLabel.textContent = `Zoom ${zoom.toFixed(2)} | ${resolutionLabel} | Glyphs ${latestGlyphCount}`;
    }
  }

  function applyDisplayedGeometryResolution(nextResolution, state = currentAppState, densityLevel = liveDensityLevel) {
    currentH3Resolution = nextResolution;
    currentH3FeatureCollection = updateGeometrySources(map, cells, rawCells, metadata, currentH3Resolution);
    scheduleCenterDotRefresh();
    updateHoveredGeometryFromState(state);
    syncSelectedMapCell(map, resolveDisplayedCellId(state.selectedCell, currentH3Resolution));
    if (GLYPHS_ENABLED) {
      committedOverlayState = buildOverlayState(cells, rawCells, metadata, state, densityLevel, currentH3Resolution);
      currentDisplayedCellSourceMap = new Map(
        committedOverlayState.renderableCells.map((cell) => [cell.id, cell.sourceId ?? cell.id])
      );
      glyphOverlay.renderContent(committedOverlayState);
      scheduleLayout(committedOverlayState, interactionPhase, densityLevel);
    }
    updateDebugLabel();
  }

  function syncH3ResolutionForViewport() {
    const nextResolution = getAdaptiveH3Resolution(
      map,
      metadata,
      currentAppState,
      liveDensityLevel,
      currentH3Resolution
    );
    if (nextResolution === currentH3Resolution) {
      return;
    }
    applyDisplayedGeometryResolution(nextResolution, currentAppState, liveDensityLevel);
  }

  function scheduleLayout(state = committedOverlayState, phase = interactionPhase, densityLevel = liveDensityLevel) {
    if (!GLYPHS_ENABLED) {
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
      if (GLYPHS_ENABLED && store.getState().hoveredCell) {
        store.setHoveredCell(null, null);
      }
    }
  }

  function commitFullRefresh() {
    currentDensityLevel = liveDensityLevel;
    if (GLYPHS_ENABLED) {
      committedOverlayState = buildOverlayState(cells, rawCells, metadata, currentAppState, currentDensityLevel, currentH3Resolution);
      glyphOverlay.renderContent(committedOverlayState);
    }
    interactionPhase = 'idle';
    glyphOverlay.setInteractionPhase('idle');
    if (GLYPHS_ENABLED) {
      scheduleLayout(committedOverlayState, 'idle', currentDensityLevel);
    }
  }

  function settleAfterMovement() {
    cancelSettlingRefresh();
    interactionPhase = 'settling';
    glyphOverlay.setInteractionPhase('settling');
    if (GLYPHS_ENABLED) {
      scheduleLayout(committedOverlayState, 'settling', liveDensityLevel);
    }
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
    currentH3Resolution = getAdaptiveH3Resolution(
      map,
      metadata,
      currentAppState,
      currentDensityLevel,
      currentH3Resolution
    );
    if (GLYPHS_ENABLED) {
      committedOverlayState = buildOverlayState(cells, rawCells, metadata, currentAppState, currentDensityLevel, currentH3Resolution);
    }
    updateDebugLabel();
    if (typeof map.setFog === 'function') {
      map.setFog({
        color: '#031017',
        'high-color': '#081c27',
        'horizon-blend': 0.16,
        'space-color': '#01060a',
        'star-intensity': 0.15
      });
    }
    addGeometryLayers(map, currentH3Resolution, metadata, cells, rawCells);
    void addReferenceLabelLayers(map, currentAppState).then(() => liftInteractiveCellLayers(map));
    setUnitLayerVisibility(map, currentUnit);
    applyDisplayedGeometryResolution(currentH3Resolution, currentAppState, currentDensityLevel);
    updateLineLayerOpacity(currentAppState.strokeOpacity ?? 1);
    map.on('mousemove', handleMapPointerMove);
    map.on('click', handleMapClick);
    map.on('mouseout', clearMapHover);
    scheduleCenterDotRefresh();
    if (GLYPHS_ENABLED) {
      glyphOverlay.setOpacity(store.getState().symbolOpacity ?? 0.2);
      requestAnimationFrame(() => {
        scheduleLayout(committedOverlayState, 'idle', currentDensityLevel);
      });
    }
    finishRenderLoading(initialLoadingSequence);
  });

  if (GLYPHS_ENABLED) {
    map.once('idle', () => {
      scheduleLayout(committedOverlayState, 'idle', currentDensityLevel);
    });
  }

  map.on('move', () => {
    scheduleCenterDotRefresh();
  });

  map.on('movestart', () => {
    startInteraction();
    if (GLYPHS_ENABLED) {
      scheduleLayout(committedOverlayState, 'moving', liveDensityLevel);
    }
  });

  if (GLYPHS_ENABLED) {
    map.on('move', () => {
      scheduleLayout(committedOverlayState, interactionPhase, liveDensityLevel);
    });
  }

  map.on('moveend', () => {
    if (map.getBearing() !== 0) {
      map.setBearing(0);
    }
    syncH3ResolutionForViewport();
    updateDebugLabel();
    settleAfterMovement();
  });

  map.on('zoom', () => {
    liveDensityLevel = getDensityLevelForZoom(map.getZoom());
    updateDebugLabel();
    scheduleCenterDotRefresh();
    if (GLYPHS_ENABLED) {
      scheduleLayout(committedOverlayState, interactionPhase === 'idle' ? 'moving' : interactionPhase, liveDensityLevel);
    }
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

      if (changedKey === 'hoveredCell' || changedKey === 'init') {
        updateHoveredGeometryFromState(state);
      }

      if (changedKey === 'selectedCell' || changedKey === 'init') {
        syncSelectedMapCell(
          map,
          currentUnit === 'grid' ? state.selectedCell : resolveDisplayedCellId(state.selectedCell, currentH3Resolution)
        );
      }

      if (!map.loaded()) {
        return;
      }

      const contentChange =
        changedKey === 'init' ||
        changedKey === 'mode' ||
        changedKey === 'symbol' ||
        changedKey === 'unit' ||
        changedKey === 'variable' ||
        changedKey === 'colorScaleMode' ||
        changedKey === 'ranges' ||
        changedKey === 'periodMonths' ||
        changedKey === 'glyphSize' ||
        changedKey === 'selectedCell';

      if (changedKey === 'unit' || changedKey === 'symbol') {
        currentUnit = state.unit ?? 'hexagon';
        setUnitLayerVisibility(map, currentUnit);
        updateHoveredGeometryFromState(state);

        if (activeSearchSelection) {
          const nextSelectedCellId = resolveSearchSelectionCellId(activeSearchSelection.lat, activeSearchSelection.lon, state);
          if (nextSelectedCellId && nextSelectedCellId !== state.selectedCell) {
            activeSearchSelection = {
              ...activeSearchSelection,
              cellId: nextSelectedCellId,
              unit: currentUnit
            };
            store.selectCell(nextSelectedCellId);
            return;
          }
          activeSearchSelection = {
            ...activeSearchSelection,
            cellId: nextSelectedCellId,
            unit: currentUnit
          };
        }
      }

      if (contentChange) {
        scheduleContentRefresh(state, changedKey);
      }

      if (GLYPHS_ENABLED && changedKey === 'hoveredCell' && state.hoveredCell && !state.hoveredPosition && interactionPhase === 'idle') {
        scheduleLayout(committedOverlayState, 'idle', currentDensityLevel);
      }

      if (changedKey === 'unit' || changedKey === 'symbol' || changedKey === 'init') {
        updateHoveredGeometryFromState(state);
      } else if (changedKey === 'hoveredCell' && previousState?.hoveredCell !== state.hoveredCell) {
        updateHoveredGeometryFromState(state);
      }

      if (
        GLYPHS_ENABLED &&
        (
          changedKey === 'init' ||
          changedKey === 'unit' ||
          changedKey === 'symbol' ||
          changedKey === 'selectedCell' ||
          (changedKey === 'hoveredCell' && previousState?.hoveredCell !== state.hoveredCell)
        )
      ) {
        glyphOverlay.syncInteractionState({
          ...(committedOverlayState ?? state),
          hoveredCell: state.hoveredCell,
          hoveredPosition: state.hoveredPosition,
          selectedCell: state.selectedCell,
          displayedSelectedCell: currentUnit === 'grid' ? state.selectedCell : resolveDisplayedCellId(state.selectedCell, currentH3Resolution),
          displayedH3Resolution: currentH3Resolution
        });
      }

      if (GLYPHS_ENABLED && changedKey === 'symbolOpacity') {
        glyphOverlay.setOpacity(state.symbolOpacity ?? 0.2);
      }

      if (changedKey === 'selectedCell' && state.selectedCell === null && previousState?.selectedCell) {
        applyDisplayedGeometryResolution(currentH3Resolution, state, currentDensityLevel);
      }

      if (changedKey === 'selectedCell' && state.selectedCell && state.selectedCell !== previousState?.selectedCell) {
        focusSelectedCell(state.selectedCell);
      }

      if (activeSearchSelection && state.selectedCell !== activeSearchSelection.cellId) {
        clearSearchSelectionMarker();
      }
    }
  };
}
