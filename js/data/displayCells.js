// Display cells: every H3 hexagon / lat-lon grid cell shown on the globe, each holding the
// area-weighted mean of the 2-degree samples it contains (or the nearest sample when a
// small cell contains none). All cells are registered so any id in the store resolves.
import { cellToLatLng, getRes0Cells, cellToChildren, latLngToCell } from 'h3-js';
import { averageClimateFields } from './aggregateCells.js';

const MAX_CACHED_LEVELS = 3;

let context = null;
const registry = new Map();
const levelCache = new Map();

function normalizeLongitude(lon) {
  let value = lon;
  while (value < -180) value += 360;
  while (value >= 180) value -= 360;
  return value;
}

function buildNearestLookup(rawCells) {
  const lats = [...new Set(rawCells.map((cell) => cell.lat))].sort((a, b) => a - b);
  let step = Infinity;
  for (let index = 1; index < lats.length; index += 1) {
    step = Math.min(step, lats[index] - lats[index - 1]);
  }
  if (!Number.isFinite(step) || step <= 0) {
    step = 2;
  }
  const lonSteps = Math.round(360 / step);
  const byKey = new Map();
  for (const cell of rawCells) {
    const latKey = Math.round(cell.lat / step);
    const lonKey = ((Math.round(normalizeLongitude(cell.lon) / step) % lonSteps) + lonSteps) % lonSteps;
    byKey.set(`${latKey}|${lonKey}`, cell);
  }

  const squaredDistance = (cell, lat, lon) => {
    const dLat = cell.lat - lat;
    const dLon = normalizeLongitude(cell.lon - lon) * Math.cos((lat * Math.PI) / 180);
    return dLat * dLat + dLon * dLon;
  };

  return function findNearest(lat, lon) {
    const latKey = Math.round(lat / step);
    const lonKey = Math.round(normalizeLongitude(lon) / step);
    let best = null;
    let bestDistance = Infinity;
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLon = -1; dLon <= 1; dLon += 1) {
        const wrappedLon = (((lonKey + dLon) % lonSteps) + lonSteps) % lonSteps;
        const candidate = byKey.get(`${latKey + dLat}|${wrappedLon}`);
        if (candidate) {
          const candidateDistance = squaredDistance(candidate, lat, lon);
          if (candidateDistance < bestDistance) {
            bestDistance = candidateDistance;
            best = candidate;
          }
        }
      }
    }
    if (best) {
      return best;
    }
    for (const cell of rawCells) {
      const candidateDistance = squaredDistance(cell, lat, lon);
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        best = cell;
      }
    }
    return best;
  };
}

export function initDisplayCells({ rawCells, monthLabels, globalCell }) {
  context = { rawCells, monthLabels, findNearest: buildNearestLookup(rawCells) };
  registry.clear();
  levelCache.clear();
  for (const cell of rawCells) {
    registry.set(cell.id, cell);
  }
  if (globalCell) {
    registry.set(globalCell.id, globalCell);
  }
}

export function getDisplayCell(id) {
  return id == null ? null : registry.get(id) ?? null;
}

export function findNearestSample(lat, lon) {
  return context?.findNearest(lat, lon) ?? null;
}

function rememberLevel(key, cells) {
  levelCache.set(key, cells);
  for (const cell of cells) {
    registry.set(cell.id, cell);
  }
  while (levelCache.size > MAX_CACHED_LEVELS) {
    const [oldestKey, oldestCells] = levelCache.entries().next().value;
    levelCache.delete(oldestKey);
    for (const cell of oldestCells) {
      if (registry.get(cell.id) === cell) {
        registry.delete(cell.id);
      }
    }
  }
}

function touchLevel(key) {
  const cells = levelCache.get(key);
  if (cells) {
    levelCache.delete(key);
    levelCache.set(key, cells);
  }
  return cells;
}

function buildDisplayCell(base, members, center) {
  const fields = members.length
    ? averageClimateFields(members, context.monthLabels)
    : averageClimateFields([context.findNearest(center.lat, center.lon)], context.monthLabels);
  return {
    ...base,
    lat: center.lat,
    lon: center.lon,
    memberCount: members.length,
    ...fields
  };
}

export function getH3DisplayCells(resolution) {
  const key = `h3:${resolution}`;
  const cached = touchLevel(key);
  if (cached) {
    return cached;
  }

  const membersByHex = new Map();
  for (const sample of context.rawCells) {
    const h3Index = latLngToCell(sample.lat, sample.lon, resolution);
    if (!membersByHex.has(h3Index)) {
      membersByHex.set(h3Index, []);
    }
    membersByHex.get(h3Index).push(sample);
  }

  const indexes = resolution === 0
    ? getRes0Cells()
    : getRes0Cells().flatMap((cell) => cellToChildren(cell, resolution));
  const cells = indexes.map((h3Index, sampleRank) => {
    const [lat, lon] = cellToLatLng(h3Index);
    return buildDisplayCell(
      {
        id: h3Index,
        sourceId: h3Index,
        h3Index,
        h3Center: { lat, lon },
        sampleRank
      },
      membersByHex.get(h3Index) ?? [],
      { lat, lon }
    );
  });

  rememberLevel(key, cells);
  return cells;
}

export function getGridCellId(degrees, latIndex, lonIndex) {
  return `grid-${degrees}-${latIndex}-${lonIndex}`;
}

export function getGridIndexes(lat, lon, degrees) {
  const latCount = Math.ceil(180 / degrees);
  const lonCount = Math.ceil(360 / degrees);
  const clampedLat = Math.min(90 - 1e-9, Math.max(-90, lat));
  const normalizedLon = normalizeLongitude(lon);
  return {
    latIndex: Math.min(latCount - 1, Math.max(0, Math.floor((clampedLat + 90) / degrees))),
    lonIndex: Math.min(lonCount - 1, Math.max(0, Math.floor((normalizedLon + 180) / degrees)))
  };
}

export function getGridCellIdAt(lat, lon, degrees) {
  const { latIndex, lonIndex } = getGridIndexes(lat, lon, degrees);
  return getGridCellId(degrees, latIndex, lonIndex);
}

export function getGridDisplayCells(degrees) {
  const key = `grid:${degrees}`;
  const cached = touchLevel(key);
  if (cached) {
    return cached;
  }

  const latCount = Math.ceil(180 / degrees);
  const lonCount = Math.ceil(360 / degrees);
  const members = Array.from({ length: latCount * lonCount }, () => []);
  for (const sample of context.rawCells) {
    const { latIndex, lonIndex } = getGridIndexes(sample.lat, sample.lon, degrees);
    members[latIndex * lonCount + lonIndex].push(sample);
  }

  const cells = [];
  for (let latIndex = 0; latIndex < latCount; latIndex += 1) {
    const south = -90 + latIndex * degrees;
    const north = Math.min(90, south + degrees);
    for (let lonIndex = 0; lonIndex < lonCount; lonIndex += 1) {
      const west = -180 + lonIndex * degrees;
      const east = Math.min(180, west + degrees);
      const id = getGridCellId(degrees, latIndex, lonIndex);
      cells.push(
        buildDisplayCell(
          {
            id,
            sourceId: id,
            gridDegrees: degrees,
            gridLatIndex: latIndex,
            gridLonIndex: lonIndex,
            gridBounds: { south, north, west, east },
            sampleRank: cells.length
          },
          members[latIndex * lonCount + lonIndex],
          { lat: (south + north) / 2, lon: (west + east) / 2 }
        )
      );
    }
  }

  rememberLevel(key, cells);
  return cells;
}
