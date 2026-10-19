// Area-weighted (cos latitude) aggregation of 2-degree sample cells into larger display cells.

function areaWeight(lat) {
  return Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
}

function monthOfYearIndex(monthLabels) {
  return Uint8Array.from(monthLabels, (label) => Number(label.slice(5, 7)) - 1);
}

const monthIndexCache = new WeakMap();

function getMonthOfYear(monthLabels) {
  let index = monthIndexCache.get(monthLabels);
  if (!index) {
    index = monthOfYearIndex(monthLabels);
    monthIndexCache.set(monthLabels, index);
  }
  return index;
}

// Returns the climate fields of a cell that represents the weighted mean of `members`.
// Temperature anomalies and raw precipitation are averaged; the relative precipitation
// anomaly is recomputed against the averaged baseline so dry samples don't dominate.
export function averageClimateFields(members, monthLabels) {
  if (members.length === 1) {
    const [only] = members;
    return {
      tempSeries: only.tempSeries,
      precipSeries: only.precipSeries,
      precipRawSeries: only.precipRawSeries,
      tempBaselineMonthly: only.tempBaselineMonthly,
      precipBaselineMonthly: only.precipBaselineMonthly,
      tempTrendPerDecade: only.tempTrendPerDecade,
      precipTrendPerDecade: only.precipTrendPerDecade
    };
  }

  const monthCount = monthLabels.length;
  const monthOfYear = getMonthOfYear(monthLabels);
  const tempSeries = new Float32Array(monthCount);
  const precipRawSeries = new Float32Array(monthCount);
  const precipSeries = new Float32Array(monthCount);
  const tempBaselineMonthly = new Array(12).fill(0);
  const precipBaselineMonthly = new Array(12).fill(0);
  let tempTrendPerDecade = 0;
  let precipTrendPerDecade = 0;
  let totalWeight = 0;

  for (const member of members) {
    const weight = areaWeight(member.lat);
    totalWeight += weight;
    const temp = member.tempSeries;
    const precip = member.precipRawSeries;
    for (let month = 0; month < monthCount; month += 1) {
      tempSeries[month] += temp[month] * weight;
      precipRawSeries[month] += precip[month] * weight;
    }
    for (let month = 0; month < 12; month += 1) {
      tempBaselineMonthly[month] += member.tempBaselineMonthly[month] * weight;
      precipBaselineMonthly[month] += member.precipBaselineMonthly[month] * weight;
    }
    tempTrendPerDecade += (member.tempTrendPerDecade ?? 0) * weight;
    precipTrendPerDecade += (member.precipTrendPerDecade ?? 0) * weight;
  }

  for (let month = 0; month < monthCount; month += 1) {
    tempSeries[month] /= totalWeight;
    precipRawSeries[month] /= totalWeight;
  }
  for (let month = 0; month < 12; month += 1) {
    tempBaselineMonthly[month] /= totalWeight;
    precipBaselineMonthly[month] /= totalWeight;
  }
  for (let month = 0; month < monthCount; month += 1) {
    const expected = precipBaselineMonthly[monthOfYear[month]];
    precipSeries[month] = expected > 0 ? precipRawSeries[month] / expected - 1 : 0;
  }

  return {
    tempSeries,
    precipSeries,
    precipRawSeries,
    tempBaselineMonthly,
    precipBaselineMonthly,
    tempTrendPerDecade: tempTrendPerDecade / totalWeight,
    precipTrendPerDecade: precipTrendPerDecade / totalWeight
  };
}
