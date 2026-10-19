// Basemap candidates. All sources are free and need no API key.
// Layers and sources added here are prefixed with "bm-" so they can be swapped as a group;
// the "vector-" layers in styles/globe-dark.json form the Minimal basemap.

const PREFIX = 'bm-';
const NASA_GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const NASA_ATTRIBUTION = '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA EOSDIS GIBS</a>';

const boundaryLayer = (color, opacity) => ({
  id: 'bm-boundary',
  type: 'line',
  source: 'openmaptiles',
  'source-layer': 'boundary',
  filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
  paint: {
    'line-color': color,
    'line-opacity': opacity,
    'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.2]
  }
});

export const BASEMAPS = [
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Current flat dark style'
  },
  {
    id: 'terrain',
    label: 'Terrain',
    description: 'Grey hillshade, rivers, lakes and borders',
    sources: {
      'bm-dem': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 10,
        attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles (Mapzen, AWS)</a>'
      }
    },
    layers: [
      { id: 'bm-land', type: 'background', paint: { 'background-color': '#181c20' } },
      {
        id: 'bm-ne-relief',
        type: 'raster',
        source: 'ne2-shaded',
        paint: {
          'raster-saturation': -1,
          'raster-contrast': 0.2,
          'raster-brightness-max': 0.42,
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 5, 0.25, 6, 0.15]
        }
      },
      {
        id: 'bm-hillshade',
        type: 'hillshade',
        source: 'bm-dem',
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 1, 0.75, 6, 0.55],
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': 'rgba(220, 228, 235, 0.38)',
          'hillshade-accent-color': '#05070a',
          'hillshade-illumination-direction': 315
        }
      },
      {
        id: 'bm-ice',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'ice'],
        paint: { 'fill-color': '#9aa6b0', 'fill-opacity': 0.14 }
      },
      {
        id: 'bm-water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#06090c', 'fill-outline-color': '#323a42' }
      },
      {
        id: 'bm-rivers',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        filter: ['==', ['get', 'class'], 'river'],
        paint: {
          'line-color': '#253744',
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 1.2]
        }
      },
      boundaryLayer('#5b646c', 0.7)
    ]
  },
  {
    id: 'relief',
    label: 'Relief',
    description: 'NASA Blue Marble shaded relief with ocean depth',
    sources: {
      'bm-relief': {
        type: 'raster',
        tiles: [`${NASA_GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
        tileSize: 256,
        maxzoom: 8,
        attribution: NASA_ATTRIBUTION
      }
    },
    layers: [
      {
        id: 'bm-relief',
        type: 'raster',
        source: 'bm-relief',
        paint: { 'raster-saturation': -0.45, 'raster-brightness-max': 0.5, 'raster-contrast': 0.05 }
      },
      boundaryLayer('#c9d0d6', 0.35)
    ]
  },
  {
    id: 'night',
    label: 'Night lights',
    description: 'NASA Black Marble city lights',
    sources: {
      'bm-night': {
        type: 'raster',
        tiles: [`${NASA_GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
        tileSize: 256,
        maxzoom: 8,
        attribution: NASA_ATTRIBUTION
      }
    },
    layers: [
      {
        id: 'bm-night',
        type: 'raster',
        source: 'bm-night',
        paint: { 'raster-saturation': -0.3, 'raster-brightness-max': 0.85 }
      },
      boundaryLayer('#8a949c', 0.4)
    ]
  },
  {
    id: 'openfreemap-dark',
    label: 'OpenFreeMap Dark',
    description: 'OpenFreeMap dark vector style',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark'
  },
  {
    id: 'versatiles-dark',
    label: 'VersaTiles Dark',
    description: 'VersaTiles colorful-dark vector style',
    styleUrl: 'https://tiles.versatiles.org/assets/styles/colorful-dark/style.json',
    attribution: '<a href="https://versatiles.org" target="_blank" rel="noopener">VersaTiles</a> &copy; OpenStreetMap contributors'
  }
];

const MINIMAL_LAYER_PREFIX = 'vector-';
const externalStyleCache = new Map();

function usesSpriteOrPattern(layer) {
  const text = JSON.stringify({ paint: layer.paint ?? {}, layout: layer.layout ?? {} });
  return text.includes('pattern') || text.includes('icon-image');
}

// Keeps the fills and lines of a third-party style; drops its labels and icons because the
// app draws its own labels with a different glyph server and no sprite sheet.
async function loadExternalBasemap(basemap) {
  if (!externalStyleCache.has(basemap.id)) {
    externalStyleCache.set(basemap.id, (async () => {
      const response = await fetch(basemap.styleUrl);
      if (!response.ok) {
        throw new Error(`Basemap style failed to load (HTTP ${response.status}).`);
      }
      const style = await response.json();
      const sourceName = (name) => `${PREFIX}${basemap.id}-${name}`;
      const sources = {};
      for (const [name, source] of Object.entries(style.sources ?? {})) {
        sources[sourceName(name)] = {
          ...source,
          ...(basemap.attribution && !source.attribution ? { attribution: basemap.attribution } : {})
        };
      }
      const layers = (style.layers ?? [])
        .filter((layer) => layer.type !== 'symbol' && !usesSpriteOrPattern(layer))
        .map((layer) => ({
          ...layer,
          id: `${PREFIX}${basemap.id}-${layer.id}`,
          ...(layer.source ? { source: sourceName(layer.source) } : {})
        }));
      return { sources, layers };
    })());
  }
  return externalStyleCache.get(basemap.id);
}

function removeCurrentBasemap(map) {
  const style = map.getStyle();
  for (const layer of style.layers) {
    if (layer.id.startsWith(PREFIX)) {
      map.removeLayer(layer.id);
    }
  }
  for (const sourceId of Object.keys(style.sources)) {
    if (sourceId.startsWith(PREFIX)) {
      map.removeSource(sourceId);
    }
  }
}

function setMinimalVisibility(map, visible) {
  for (const layer of map.getStyle().layers) {
    if (layer.id.startsWith(MINIMAL_LAYER_PREFIX)) {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

let applySequence = 0;

export async function applyBasemap(map, basemapId, beforeLayerId) {
  const basemap = BASEMAPS.find((item) => item.id === basemapId) ?? BASEMAPS[0];
  const sequence = ++applySequence;
  const definition = basemap.styleUrl ? await loadExternalBasemap(basemap) : basemap;
  if (sequence !== applySequence) {
    return basemap.id;
  }

  removeCurrentBasemap(map);
  setMinimalVisibility(map, basemap.id === 'minimal');
  for (const [id, source] of Object.entries(definition.sources ?? {})) {
    map.addSource(id, source);
  }
  const before = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
  for (const layer of definition.layers ?? []) {
    map.addLayer(layer, before);
  }
  return basemap.id;
}
