// Country / sea names on a coarse lat-lon grid, built by scripts/build_country_lookup.py.
// Optional: if the file fails to load, lookups return null and the panel shows a dash.
let places = null;

export async function loadPlaces(url) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      places = await response.json();
    }
  } catch (error) {
    places = null;
  }
}

function lookupIndex(lat, lon) {
  const { step, rows } = places;
  const row = rows[Math.min(rows.length - 1, Math.max(0, Math.floor((90 - lat) / step)))];
  const wrappedLon = ((((lon + 180) % 360) + 360) % 360);
  let column = Math.min(Math.floor(360 / step) - 1, Math.floor(wrappedLon / step));
  for (let index = 0; index < row.length; index += 2) {
    if (column < row[index + 1]) {
      return row[index];
    }
    column -= row[index + 1];
  }
  return 0;
}

// Land cells smaller than this share of a cell's samples still count as sea.
const MIN_LAND_SHARE = 0.2;

// Most common country among the sample points, or the most common sea when land is scarce.
export function dominantPlace(points) {
  if (!places || !points.length) {
    return null;
  }
  const counts = new Map();
  let landCount = 0;
  for (const { lat, lon } of points) {
    const index = lookupIndex(lat, lon);
    if (index > 0) {
      counts.set(index, (counts.get(index) ?? 0) + 1);
      if (index > places.seaCount) {
        landCount += 1;
      }
    }
  }
  const preferLand = landCount >= points.length * MIN_LAND_SHARE;
  let best = 0;
  for (const [index, count] of counts) {
    if ((index > places.seaCount) === preferLand && count > (counts.get(best) ?? 0)) {
      best = index;
    }
  }
  return places.names[best] || null;
}
