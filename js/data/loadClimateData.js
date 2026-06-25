import { cellToBoundary, cellToLatLng, latLngToCell } from 'h3-js';

const H3_RESOLUTION = 3;

function toGeoJsonRing(boundary) {
  const ring = boundary.map(([lat, lon]) => [lon, lat]);
  if (ring.length > 0) {
    ring.push([...ring[0]]);
  }
  return ring;
}


function aggregateToH3Cells(rawCells) {
  const grouped = new Map();

  for (const cell of rawCells) {
    const h3Index = latLngToCell(cell.lat, cell.lon, H3_RESOLUTION);
    if (!grouped.has(h3Index)) {
      grouped.set(h3Index, []);
    }
    grouped.get(h3Index).push(cell);
  }

  return [...grouped.entries()]
    .map(([h3Index, members]) => {
      const [centerLat, centerLon] = cellToLatLng(h3Index);
      const nearest = members.reduce((best, cell) => {
        const d = (cell.lat - centerLat) ** 2 + (cell.lon - centerLon) ** 2;
        const bd = (best.lat - centerLat) ** 2 + (best.lon - centerLon) ** 2;
        return d < bd ? cell : best;
      });

      return {
        id: h3Index,
        lat: nearest.lat,
        lon: nearest.lon,
        h3Index,
        h3Center: { lat: centerLat, lon: centerLon },
        h3Boundary: toGeoJsonRing(cellToBoundary(h3Index)),
        memberCount: members.length,
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
}

export async function loadClimateData() {
  const metadataUrl = new URL('../../data/metadata.json', import.meta.url);
  const cellsUrl = new URL('../../data/cells-medium.json', import.meta.url);
  const roniUrl = new URL('../../data/roni.json', import.meta.url);
  const [metadataResponse, cellsResponse, roniResponse] = await Promise.all([
    fetch(metadataUrl),
    fetch(cellsUrl),
    fetch(roniUrl)
  ]);

  if (!metadataResponse.ok || !cellsResponse.ok || !roniResponse.ok) {
    throw new Error('Failed to load climate assets.');
  }

  const metadata = await metadataResponse.json();
  const cellsPayload = await cellsResponse.json();
  const roniPayload = await roniResponse.json();
  const rawCells = cellsPayload.cells;
  const cells = aggregateToH3Cells(rawCells);

  return {
    metadata: {
      ...metadata,
      h3Resolution: H3_RESOLUTION,
      sourceCellCount: rawCells.length,
      aggregatedCellCount: cells.length
    },
    cells,
    rawCells,
    roni: roniPayload.points
  };
}
