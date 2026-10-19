// Basemaps. All sources are free and need no API key. Each basemap is built for the active
// colour theme; layers and sources are prefixed with "bm-" so they can be swapped as a group.

const PREFIX = 'bm-';
const NASA_GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const NASA_ATTRIBUTION = '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA EOSDIS GIBS</a>';
const TERRAIN_ATTRIBUTION = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles (Mapzen, AWS)</a>';
const VERSATILES_ATTRIBUTION = '<a href="https://versatiles.org" target="_blank" rel="noopener">VersaTiles</a> &copy; OpenStreetMap contributors';

// Colours for the shared reference layers (borders and place names) on each basemap.
const DARK_THEME = {
  border: 'rgba(196, 204, 211, 0.42)',
  country: '#d9dee3',
  state: '#9aa3ab',
  city: '#c3cad0',
  cityDot: '#c3cad0',
  water: '#7f93a3',
  halo: 'rgba(6, 8, 10, 0.92)'
};
const LIGHT_THEME = {
  border: 'rgba(60, 68, 76, 0.45)',
  country: '#2b3036',
  state: '#69727b',
  city: '#343b42',
  cityDot: '#343b42',
  water: '#4f6f86',
  halo: 'rgba(255, 255, 255, 0.92)'
};
const IMAGERY_THEME = {
  border: 'rgba(240, 243, 245, 0.55)',
  country: '#f4f6f8',
  state: '#d5dbe0',
  city: '#eef1f3',
  cityDot: '#eef1f3',
  water: '#b9cfe0',
  halo: 'rgba(0, 0, 0, 0.85)'
};
const NIGHT_THEME = {
  border: 'rgba(170, 182, 205, 0.4)',
  country: '#dfe5f0',
  state: '#9da8bd',
  city: '#f3e3b5',
  cityDot: '#f3e3b5',
  water: '#7d8fb0',
  halo: 'rgba(3, 5, 12, 0.92)'
};

const PAGE_BACKGROUND = { dark: '#050709', light: '#e9ecef' };

// A faint atmosphere outlines the globe against the page, most visible when zoomed out.
const SKY = {
  dark: {
    'sky-color': '#111417',
    'horizon-color': '#33393f',
    'fog-color': '#111417',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.85, 4, 0.5, 6, 0.2]
  },
  light: {
    'sky-color': '#e0e3e6',
    'horizon-color': '#b4babf',
    'fog-color': '#e0e3e6',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 4, 0.4, 6, 0.15]
  }
};

const water = (fill, outline) => ({
  id: 'bm-water',
  type: 'fill',
  source: 'openmaptiles',
  'source-layer': 'water',
  paint: { 'fill-color': fill, ...(outline ? { 'fill-outline-color': outline } : {}) }
});
const ice = (color, opacity) => ({
  id: 'bm-ice',
  type: 'fill',
  source: 'openmaptiles',
  'source-layer': 'landcover',
  filter: ['==', ['get', 'class'], 'ice'],
  paint: { 'fill-color': color, 'fill-opacity': opacity }
});

export const BASEMAPS = [
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Flat land and water',
    labelTheme: (theme) => (theme === 'light' ? LIGHT_THEME : DARK_THEME),
    build: (theme) => ({
      layers: theme === 'light'
        ? [
            { id: 'bm-land', type: 'background', paint: { 'background-color': '#e8ebee' } },
            { id: 'bm-ne-relief', type: 'raster', source: 'ne2-shaded', paint: { 'raster-saturation': -1, 'raster-brightness-min': 0.7, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.25, 4, 0.08] } },
            water('#d3d6d9'),
            ice('#ffffff', 0.6)
          ]
        : [
            { id: 'bm-land', type: 'background', paint: { 'background-color': '#050709' } },
            { id: 'bm-ne-relief', type: 'raster', source: 'ne2-shaded', paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.18, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.15, 4, 0.03] } },
            water('#15181b'),
            ice('#5f6266', 0.12)
          ]
    })
  },
  {
    id: 'terrain',
    label: 'Terrain',
    description: 'Grey hillshade, rivers, lakes and borders',
    labelTheme: (theme) => (theme === 'light' ? LIGHT_THEME : DARK_THEME),
    build: (theme) => {
      const light = theme === 'light';
      return {
        sources: {
          'bm-dem': {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 10,
            attribution: TERRAIN_ATTRIBUTION
          }
        },
        layers: [
          { id: 'bm-land', type: 'background', paint: { 'background-color': light ? '#e6e9ec' : '#181c20' } },
          {
            id: 'bm-ne-relief',
            type: 'raster',
            source: 'ne2-shaded',
            paint: light
              ? { 'raster-saturation': -1, 'raster-contrast': 0.1, 'raster-brightness-min': 0.55, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 5, 0.25, 6, 0.15] }
              : { 'raster-saturation': -1, 'raster-contrast': 0.2, 'raster-brightness-max': 0.42, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 5, 0.25, 6, 0.15] }
          },
          {
            id: 'bm-hillshade',
            type: 'hillshade',
            source: 'bm-dem',
            paint: light
              ? {
                  'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 1, 0.55, 6, 0.4],
                  'hillshade-shadow-color': '#4a5560',
                  'hillshade-highlight-color': 'rgba(255, 255, 255, 0.7)',
                  'hillshade-accent-color': '#6b7680',
                  'hillshade-illumination-direction': 315
                }
              : {
                  'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 1, 0.75, 6, 0.55],
                  'hillshade-shadow-color': '#000000',
                  'hillshade-highlight-color': 'rgba(220, 228, 235, 0.38)',
                  'hillshade-accent-color': '#05070a',
                  'hillshade-illumination-direction': 315
                }
          },
          light ? ice('#ffffff', 0.55) : ice('#9aa6b0', 0.14),
          light ? water('#cdd1d5', '#a9afb5') : water('#131619', '#30363c'),
          {
            id: 'bm-rivers',
            type: 'line',
            source: 'openmaptiles',
            'source-layer': 'waterway',
            filter: ['==', ['get', 'class'], 'river'],
            paint: {
              'line-color': light ? '#9fa7ae' : '#2a3036',
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 1.2]
            }
          }
        ]
      };
    }
  },
  {
    id: 'relief',
    label: 'Relief',
    description: 'NASA Blue Marble shaded relief with ocean depth',
    labelTheme: () => IMAGERY_THEME,
    build: () => ({
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
        { id: 'bm-relief', type: 'raster', source: 'bm-relief', paint: { 'raster-saturation': -0.45, 'raster-brightness-max': 0.5, 'raster-contrast': 0.05 } }
      ]
    })
  },
  {
    id: 'night',
    label: 'Night lights',
    description: 'NASA Black Marble city lights',
    labelTheme: () => NIGHT_THEME,
    build: () => ({
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
        { id: 'bm-night', type: 'raster', source: 'bm-night', paint: { 'raster-saturation': -0.3, 'raster-brightness-max': 0.85 } }
      ]
    })
  },
  {
    id: 'openfreemap',
    label: 'OpenFreeMap',
    description: 'OpenFreeMap vector style (Dark or Positron)',
    labelTheme: (theme) => (theme === 'light' ? LIGHT_THEME : DARK_THEME),
    styleUrl: { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' }
  },
  {
    id: 'versatiles',
    label: 'VersaTiles',
    description: 'VersaTiles vector style (Colorful dark or light)',
    labelTheme: (theme) => (theme === 'light' ? LIGHT_THEME : DARK_THEME),
    styleUrl: {
      dark: 'https://tiles.versatiles.org/assets/styles/colorful-dark/style.json',
      light: 'https://tiles.versatiles.org/assets/styles/colorful/style.json'
    },
    attribution: VERSATILES_ATTRIBUTION
  }
];

const externalStyleCache = new Map();

function usesSpriteOrPattern(layer) {
  const text = JSON.stringify({ paint: layer.paint ?? {}, layout: layer.layout ?? {} });
  return text.includes('pattern') || text.includes('icon-image');
}

// Keeps the fills and lines of a third-party style; drops its labels, icons and borders because
// the app draws its own reference layers with its own glyphs and no sprite sheet.
async function loadExternalBasemap(basemap, theme) {
  const url = basemap.styleUrl[theme] ?? basemap.styleUrl.dark;
  if (!externalStyleCache.has(url)) {
    externalStyleCache.set(url, (async () => {
      const response = await fetch(url);
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
        .filter((layer) => layer.type !== 'symbol' && layer['source-layer'] !== 'boundary' && !/boundary/.test(layer.id) && !usesSpriteOrPattern(layer))
        .map((layer) => ({
          ...layer,
          id: `${PREFIX}${basemap.id}-${layer.id}`,
          ...(layer.source ? { source: sourceName(layer.source) } : {})
        }));
      return { sources, layers };
    })().catch((error) => {
      externalStyleCache.delete(url);
      throw error;
    }));
  }
  return externalStyleCache.get(url);
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

let applySequence = 0;

export async function applyBasemap(map, basemapId, beforeLayerId, theme = 'dark') {
  const basemap = BASEMAPS.find((item) => item.id === basemapId) ?? BASEMAPS[0];
  const sequence = ++applySequence;
  const definition = basemap.styleUrl ? await loadExternalBasemap(basemap, theme) : basemap.build(theme);
  if (sequence !== applySequence) {
    return basemap.id;
  }

  removeCurrentBasemap(map);
  if (map.getLayer('vector-background')) {
    map.setPaintProperty('vector-background', 'background-color', PAGE_BACKGROUND[theme] ?? PAGE_BACKGROUND.dark);
  }
  map.setSky(SKY[theme] ?? SKY.dark);
  for (const [id, source] of Object.entries(definition.sources ?? {})) {
    map.addSource(id, source);
  }
  const before = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
  for (const layer of definition.layers ?? []) {
    map.addLayer(layer, before);
  }
  return basemap.id;
}

// Shared reference layers drawn above the data cells: country borders and place names from
// OpenMapTiles (OpenFreeMap), styled per basemap.
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
// Archivo glyphs are generated into assets/glyphs to match the page typeface.
const REGULAR = ['Archivo Regular'];
const BOLD = ['Archivo SemiBold'];
const ITALIC = ['Archivo Italic'];

export const REFERENCE_BORDER_LAYERS = ['ref-boundary', 'ref-boundary-disputed'];
export const REFERENCE_LABEL_LAYERS = ['ref-state', 'ref-city-dot', 'ref-city', 'ref-water-name', 'ref-country'];

// Countries too small to name at continental scale.
const MICROSTATES = ['AD', 'BH', 'LI', 'LU', 'MC', 'MT', 'SG', 'SM', 'VA'];

// More (and smaller) cities appear as the map zooms in.
const CITY_FILTER = [
  'all',
  ['==', ['get', 'class'], 'city'],
  ['<=', ['coalesce', ['get', 'rank'], 99], ['step', ['zoom'], 2, 3, 4, 4, 7, 5, 10, 6, 99]]
];

export function buildReferenceLayers(theme = DARK_THEME) {
  const halo = { 'text-halo-color': theme.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
  const borderWidth = ['interpolate', ['linear'], ['zoom'], 2, 0.6, 6, 1.3];
  // Symbol placement favours layers drawn on top, so countries come last.
  return [
    {
      id: 'ref-boundary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': theme.border, 'line-width': borderWidth }
    },
    {
      id: 'ref-boundary-disputed',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'disputed'], 1]],
      paint: { 'line-color': theme.border, 'line-width': borderWidth, 'line-dasharray': [2, 2] }
    },
    {
      id: 'ref-state',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 4.5,
      filter: ['==', ['get', 'class'], 'state'],
      layout: {
        'text-field': NAME,
        'text-font': REGULAR,
        'text-size': 10.5,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.1,
        'text-max-width': 7
      },
      paint: { 'text-color': theme.state, ...halo }
    },
    {
      id: 'ref-city-dot',
      type: 'circle',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 3,
      filter: CITY_FILTER,
      paint: {
        'circle-color': theme.cityDot,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 6, 2.6],
        'circle-stroke-color': theme.halo,
        'circle-stroke-width': 1
      }
    },
    {
      id: 'ref-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 3,
      filter: CITY_FILTER,
      layout: {
        'text-field': NAME,
        'text-font': ['case', ['==', ['get', 'capital'], 2], ['literal', BOLD], ['literal', REGULAR]],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 6, 12.5],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.55,
        'text-justify': 'auto',
        'text-max-width': 8,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99]
      },
      paint: { 'text-color': theme.city, ...halo }
    },
    {
      id: 'ref-water-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['any', ['==', ['get', 'class'], 'ocean'], ['all', ['==', ['get', 'class'], 'sea'], ['>=', ['zoom'], 3.5]]],
      layout: {
        'text-field': NAME,
        'text-font': ITALIC,
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 6, 13],
        'text-letter-spacing': 0.12,
        'text-max-width': 8
      },
      paint: { 'text-color': theme.water, ...halo }
    },
    {
      id: 'ref-country',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: [
        'all',
        ['==', ['get', 'class'], 'country'],
        ['<=', ['coalesce', ['get', 'rank'], 9], ['step', ['zoom'], 2, 3, 9]],
        ['any', ['>=', ['zoom'], 5.5], ['!', ['in', ['coalesce', ['get', 'iso_a2'], ''], ['literal', MICROSTATES]]]]
      ],
      layout: {
        'text-field': NAME,
        'text-font': BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10.5, 6, 14],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-max-width': 7,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 9]
      },
      paint: { 'text-color': theme.country, ...halo }
    }
  ];
}

export function applyReferenceTheme(map, theme = DARK_THEME) {
  for (const layer of buildReferenceLayers(theme)) {
    if (!map.getLayer(layer.id)) {
      continue;
    }
    for (const [property, value] of Object.entries(layer.paint ?? {})) {
      map.setPaintProperty(layer.id, property, value);
    }
  }
}

export function getBasemapTheme(basemapId, theme = 'dark') {
  return (BASEMAPS.find((item) => item.id === basemapId) ?? BASEMAPS[0]).labelTheme(theme);
}
