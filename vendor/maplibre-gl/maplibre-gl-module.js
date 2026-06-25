import './maplibre-gl.js';

const maplibregl = globalThis.maplibregl;

if (!maplibregl) {
  throw new Error('MapLibre GL failed to initialize from the bundled UMD build.');
}

export default maplibregl;
