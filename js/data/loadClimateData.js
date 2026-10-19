import { applyPaletteConfig } from '../scales/climateScales.js';
import { averageClimateFields } from './aggregateCells.js';
import { initDisplayCells } from './displayCells.js';

const H3_RESOLUTION = 3;
const DATA_ROOT = new URL('../../data/', import.meta.url);
const PALETTE_URL = new URL('../../config/visual-palettes.json', import.meta.url);

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not reach ${label} (${url.pathname}).`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  }
  return response.json();
}

// Downloads a binary file, reporting received bytes. Files are stored gzip-compressed;
// if a host already decoded them (Content-Encoding), the gzip magic bytes are absent and
// the payload is used as-is.
async function fetchBinary(url, label, onBytes) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not reach ${label} (${url.pathname}).`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  }

  let bytes;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onBytes(received);
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.byteLength);
  }

  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot decompress the dataset. Please use a current version of Chrome, Edge, Firefox or Safari.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return bytes.buffer;
}

function decodeSeries(metadata, cellsPayload, temperatureBuffer, precipitationBuffer) {
  const cellCount = cellsPayload.lat.length;
  const monthCount = metadata.monthLabels.length;
  const valueCount = cellCount * monthCount;
  const { temperature: tempSpec, precipitation: precipSpec } = metadata.series;

  if (temperatureBuffer.byteLength !== valueCount * 2 || precipitationBuffer.byteLength !== valueCount * 2) {
    throw new Error('Climate data files do not match metadata.json. Rebuild the data assets.');
  }

  const tempQ = new Int16Array(temperatureBuffer);
  const precipQ = new Uint16Array(precipitationBuffer);
  const tempValues = new Float32Array(valueCount);
  const precipRawValues = new Float32Array(valueCount);
  const precipRelValues = new Float32Array(valueCount);
  const monthOfYear = metadata.monthLabels.map((label) => Number(label.slice(5, 7)) - 1);

  for (let index = 0; index < valueCount; index += 1) {
    tempValues[index] = tempQ[index] * tempSpec.scale;
    const root = precipQ[index] / precipSpec.scale;
    precipRawValues[index] = root * root;
  }

  const rawCells = new Array(cellCount);
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const offset = cellIndex * monthCount;
    const tempBaselineMonthly = cellsPayload.tempBaselineMonthly.slice(cellIndex * 12, cellIndex * 12 + 12);
    const precipBaselineMonthly = cellsPayload.precipBaselineMonthly.slice(cellIndex * 12, cellIndex * 12 + 12);

    for (let month = 0; month < monthCount; month += 1) {
      const expected = precipBaselineMonthly[monthOfYear[month]];
      precipRelValues[offset + month] = expected > 0 ? precipRawValues[offset + month] / expected - 1 : 0;
    }

    const lat = cellsPayload.lat[cellIndex];
    const lon = cellsPayload.lon[cellIndex];
    rawCells[cellIndex] = {
      id: `${lat >= 0 ? '+' : '-'}${Math.abs(lat).toFixed(2)}_${lon >= 0 ? '+' : '-'}${Math.abs(lon).toFixed(2)}`,
      lat,
      lon,
      tempSeries: tempValues.subarray(offset, offset + monthCount),
      precipSeries: precipRelValues.subarray(offset, offset + monthCount),
      precipRawSeries: precipRawValues.subarray(offset, offset + monthCount),
      tempBaselineMonthly,
      precipBaselineMonthly,
      tempTrendPerDecade: cellsPayload.tempTrendPerDecade[cellIndex],
      precipTrendPerDecade: cellsPayload.precipTrendPerDecade[cellIndex]
    };
  }
  return rawCells;
}

export async function loadClimateData({ onProgress = () => {} } = {}) {
  onProgress({ title: 'Loading climate data', detail: 'Reading dataset description' });
  const [metadata, paletteConfig] = await Promise.all([
    fetchJson(new URL('metadata.json', DATA_ROOT), 'metadata.json'),
    fetchJson(PALETTE_URL, 'color palettes')
  ]);
  applyPaletteConfig(paletteConfig);

  if (!metadata?.series?.temperature || !metadata?.series?.precipitation || !Array.isArray(metadata.monthLabels)) {
    throw new Error('metadata.json is outdated. Rebuild the data assets with scripts/build_climate_assets.py.');
  }

  const totalBytes = (metadata.series.temperature.bytes ?? 0) + (metadata.series.precipitation.bytes ?? 0);
  const received = { temperature: 0, precipitation: 0 };
  const reportBytes = (key) => (bytes) => {
    received[key] = bytes;
    const loaded = received.temperature + received.precipitation;
    const loadedMb = (loaded / 1048576).toFixed(0);
    const detail = totalBytes
      ? `${loadedMb} of ${(totalBytes / 1048576).toFixed(0)} MB (${Math.min(100, Math.round((loaded / totalBytes) * 100))}%)`
      : `${loadedMb} MB received`;
    onProgress({ title: 'Downloading climate data', detail });
  };

  const [cellsPayload, roniPayload, temperatureBuffer, precipitationBuffer] = await Promise.all([
    fetchJson(new URL('cells.json', DATA_ROOT), 'cells.json'),
    fetchJson(new URL('roni.json', DATA_ROOT), 'roni.json'),
    fetchBinary(new URL(metadata.series.temperature.file, DATA_ROOT), 'temperature data', reportBytes('temperature')),
    fetchBinary(new URL(metadata.series.precipitation.file, DATA_ROOT), 'precipitation data', reportBytes('precipitation'))
  ]);

  onProgress({ title: 'Preparing climate data', detail: 'Decoding monthly series' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rawCells = decodeSeries(metadata, cellsPayload, temperatureBuffer, precipitationBuffer);
  const globalCell = {
    id: 'global',
    isGlobal: true,
    label: 'Global average',
    lat: null,
    lon: null,
    memberCount: rawCells.length,
    ...averageClimateFields(rawCells, metadata.monthLabels)
  };
  initDisplayCells({ rawCells, monthLabels: metadata.monthLabels, globalCell });
  const latestMonth = metadata.latestMonth;
  const roni = (roniPayload.points ?? []).filter((point) => !latestMonth || !point.monthLabel || point.monthLabel <= latestMonth);

  return {
    metadata: {
      ...metadata,
      h3Resolution: H3_RESOLUTION,
      sourceCellCount: rawCells.length
    },
    rawCells,
    globalCell,
    roni
  };
}
