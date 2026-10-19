import {
  colorForVariable,
  domainForVariable,
  summarizeValue
} from '../scales/climateScales.js';

const aggregatedSeriesCache = new Map();
const bucketedSeriesCache = new Map();
const visibleDomainCache = new Map();
const cellSummaryCache = new Map();
const renderableCellsCache = new Map();
const seriesDomainCache = new Map();
const CACHE_LIMIT = 60000;

// Summaries and renderable cells store colours; drop them when the palette changes.
export function clearColorCaches() {
  cellSummaryCache.clear();
  renderableCellsCache.clear();
}

// Caches are keyed by the full view state; when one grows past the limit it is reset
// rather than evicted entry by entry.
function cacheSet(cache, key, value, limit = CACHE_LIMIT) {
  if (cache.size >= limit) {
    cache.clear();
  }
  cache.set(key, value);
  return value;
}

function buildDomainCacheKey(domainOverrides = {}) {
  const temp = domainOverrides.temperature ?? [];
  const precip = domainOverrides.precipitation ?? [];
  return [
    Number.isFinite(temp[0]) ? temp[0].toFixed(3) : 'na',
    Number.isFinite(temp[1]) ? temp[1].toFixed(3) : 'na',
    Number.isFinite(precip[0]) ? precip[0].toFixed(3) : 'na',
    Number.isFinite(precip[1]) ? precip[1].toFixed(3) : 'na'
  ].join('|');
}

const monthIndexLookup = new WeakMap();
const monthOfYearLookup = new WeakMap();

function getMonthOfYear(metadata) {
  let months = monthOfYearLookup.get(metadata.monthLabels);
  if (!months) {
    months = Uint8Array.from(metadata.monthLabels, (label) => Number(label.slice(5, 7)) - 1);
    monthOfYearLookup.set(metadata.monthLabels, months);
  }
  return months;
}

export function getMonthIndex(metadata, monthLabel) {
  let lookup = monthIndexLookup.get(metadata.monthLabels);
  if (!lookup) {
    lookup = new Map(metadata.monthLabels.map((label, index) => [label, index]));
    monthIndexLookup.set(metadata.monthLabels, lookup);
  }
  return lookup.get(monthLabel) ?? -1;
}

export function getRangeIndices(metadata, range) {
  const startIndex = Math.max(0, getMonthIndex(metadata, range.start));
  const endIndex = Math.max(startIndex, getMonthIndex(metadata, range.end));
  return { startIndex, endIndex };
}

export function isTrendMode(metadata, state) {
  return false;
}

export function getWindowStateKey(metadata, state) {
  return [
    state.rangeA.start,
    state.rangeB.start,
    state.periodMonths ?? 1,
    state.unit ?? '',
    state.displayedH3Resolution ?? '',
    state.displayedGridDegrees ?? ''
  ].join('|');
}

export function getDensityLevelForZoom(zoom) {
  if (zoom < 1.05) return 'low';
  if (zoom < 1.8) return 'medium';
  return 'high';
}

export function aggregateSeriesWindow(values, startIndex, endIndex, periodMonths) {
  const points = [];
  const safeEndIndex = Math.max(startIndex, endIndex);
  for (let index = startIndex; index <= safeEndIndex; index += periodMonths) {
    const bucketEnd = Math.min(safeEndIndex, index + periodMonths - 1);
    let total = 0;
    let count = 0;
    for (let cursor = index; cursor <= bucketEnd; cursor += 1) {
      total += values[cursor];
      count += 1;
    }
    points.push(count ? total / count : 0);
  }
  return points;
}

export function bucketSeriesWindow(values, startIndex, endIndex, periodMonths) {
  const buckets = [];
  const safeEndIndex = Math.max(startIndex, endIndex);
  for (let index = startIndex; index <= safeEndIndex; index += periodMonths) {
    const bucketEnd = Math.min(safeEndIndex, index + periodMonths - 1);
    buckets.push(values.slice(index, bucketEnd + 1));
  }
  return buckets;
}

function getVariableSeries(cell, variable) {
  return variable === 'temperature' ? cell.tempSeries : cell.precipSeries;
}

export function getAggregatedSeries(cell, metadata, state, variable) {
  const key = `${getWindowStateKey(metadata, state)}|${cell.id}|${variable}`;
  if (aggregatedSeriesCache.has(key)) {
    return aggregatedSeriesCache.get(key);
  }

  const startIndex = getMonthIndex(metadata, state.rangeA.start);
  const endIndex = getMonthIndex(metadata, state.rangeB.start);
  const periodMonths = state.periodMonths ?? 1;
  const source = getVariableSeries(cell, variable);
  const values = aggregateSeriesWindow(source, startIndex, endIndex, periodMonths);
  const normalized = variable === 'temperature' ? values : values.map((value) => value * 100);
  cacheSet(aggregatedSeriesCache, key, normalized);
  return normalized;
}

export function getBucketedSeries(cell, metadata, state, variable) {
  const key = `${getWindowStateKey(metadata, state)}|${cell.id}|${variable}|buckets`;
  if (bucketedSeriesCache.has(key)) {
    return bucketedSeriesCache.get(key);
  }

  const startIndex = getMonthIndex(metadata, state.rangeA.start);
  const endIndex = getMonthIndex(metadata, state.rangeB.start);
  const source = getVariableSeries(cell, variable);
  const buckets = [];
  const periodMonths = Math.max(12, state.periodMonths ?? 12);

  const monthOfYear = getMonthOfYear(metadata);

  // Each ring segment is a calendar month (Jan..Dec) averaged over the years in the bucket.
  for (let bucketStart = startIndex; bucketStart <= endIndex; bucketStart += periodMonths) {
    const bucketEnd = Math.min(endIndex, bucketStart + periodMonths - 1);
    const totals = new Array(12).fill(0);
    const counts = new Array(12).fill(0);

    for (let index = bucketStart; index <= bucketEnd; index += 1) {
      const month = monthOfYear[index];
      totals[month] += variable === 'temperature' ? source[index] : source[index] * 100;
      counts[month] += 1;
    }

    buckets.push(totals.map((total, month) => (counts[month] ? total / counts[month] : null)));
  }

  const normalized = buckets;
  cacheSet(bucketedSeriesCache, key, normalized);
  return normalized;
}

function toSafeDomain(minValue, maxValue, fallback) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return fallback;
  }
  if (Math.abs(maxValue - minValue) < 1e-6) {
    const padding = Math.max(Math.abs(maxValue) * 0.2, fallback[1] * 0.15, 0.1);
    return [minValue - padding, maxValue + padding];
  }
  const padding = Math.max((maxValue - minValue) * 0.04, 0.05);
  return [minValue - padding, maxValue + padding];
}

function toExactSeriesDomain(values, fallback) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return fallback;
  }

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const value of finiteValues) {
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
  }

  if (Math.abs(maxValue - minValue) < 1e-6) {
    const padding = Math.max(Math.abs(maxValue) * 0.15, Math.abs(fallback[1] - fallback[0]) * 0.08, 0.1);
    return [minValue - padding, maxValue + padding];
  }

  return [minValue, maxValue];
}

function quantile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return null;
  }
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const index = (sortedValues.length - 1) * clampedRatio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const mix = index - lower;
  return sortedValues[lower] * (1 - mix) + sortedValues[upper] * mix;
}

function toRobustPrecipDomain(values, fallback) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);

  if (!sorted.length) {
    return fallback;
  }

  const lower = quantile(sorted, 0.01);
  const upper = quantile(sorted, 0.99);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    return fallback;
  }

  const clippedLower = Math.max(-100, lower);
  const clippedUpper = Math.max(40, upper);
  return toSafeDomain(clippedLower, clippedUpper, fallback);
}

export function getCommittedValueDomains(cells, metadata, state, { cache = true } = {}) {
  const key = `${getWindowStateKey(metadata, state)}|${cells.length}|${cells[0]?.id ?? ''}|${cells[cells.length - 1]?.id ?? ''}`;
  if (cache && visibleDomainCache.has(key)) {
    return visibleDomainCache.get(key);
  }

  let tempMin = Infinity;
  let tempMax = -Infinity;
  const precipValues = [];
  // Precipitation uses robust quantiles; a strided sample keeps the sort cheap for large views.
  const windowStart = getMonthIndex(metadata, state.rangeA.start);
  const windowLength = Math.max(windowStart, getMonthIndex(metadata, state.rangeB.start)) - windowStart + 1;
  const pointsPerCell = Math.ceil(windowLength / (state.periodMonths ?? 1));
  const precipStride = Math.max(1, Math.ceil((cells.length * pointsPerCell) / 200000));
  let precipCursor = 0;

  // Aggregates are computed inline (not through the per-cell series cache) because this
  // runs over every sample whenever the time window changes.
  const startIndex = getMonthIndex(metadata, state.rangeA.start);
  const endIndex = Math.max(startIndex, getMonthIndex(metadata, state.rangeB.start));
  const periodMonths = state.periodMonths ?? 1;

  for (const cell of cells) {
    const temp = cell.tempSeries;
    const precip = cell.precipSeries;
    for (let index = startIndex; index <= endIndex; index += periodMonths) {
      const bucketEnd = Math.min(endIndex, index + periodMonths - 1);
      let tempTotal = 0;
      let precipTotal = 0;
      for (let cursor = index; cursor <= bucketEnd; cursor += 1) {
        tempTotal += temp[cursor];
        precipTotal += precip[cursor];
      }
      const count = bucketEnd - index + 1;
      const tempValue = tempTotal / count;
      if (tempValue < tempMin) tempMin = tempValue;
      if (tempValue > tempMax) tempMax = tempValue;
      if (precipCursor % precipStride === 0) {
        precipValues.push((precipTotal / count) * 100);
      }
      precipCursor += 1;
    }
  }

  const domains = {
    temperature: toSafeDomain(tempMin, tempMax, [-3, 3]),
    precipitation: toRobustPrecipDomain(precipValues, [-90, 90])
  };
  if (cache) {
    cacheSet(visibleDomainCache, key, domains, 64);
  }
  return domains;
}

export function getSeriesColorDomain(cell, metadata, state, variable, globalDomains = null, viewportDomains = null) {
  const mode = state.colorScaleMode ?? 'local';
  const vpSuffix = mode === 'viewport' && viewportDomains?.[variable]
    ? `|vp:${viewportDomains[variable][0].toFixed(3)},${viewportDomains[variable][1].toFixed(3)}`
    : '';
  const key = `${mode}|${getWindowStateKey(metadata, state)}|${cell.id}|${variable}${vpSuffix}`;
  if (seriesDomainCache.has(key)) {
    return seriesDomainCache.get(key);
  }

  const fallbackDomains = globalDomains ?? getCommittedValueDomains([cell], metadata, state);
  const fallback = fallbackDomains[variable];

  if (mode === 'global') {
    cacheSet(seriesDomainCache, key, fallback);
    return fallback;
  }

  if (mode === 'viewport') {
    const vpDomain = viewportDomains?.[variable] ?? fallback;
    cacheSet(seriesDomainCache, key, vpDomain);
    return vpDomain;
  }

  const series = getAggregatedSeries(cell, metadata, state, variable);
  const domain = toExactSeriesDomain(series, fallback);
  cacheSet(seriesDomainCache, key, domain);
  return domain;
}

function mean(values, startIndex, endIndex) {
  let total = 0;
  let count = 0;
  for (let idx = startIndex; idx <= endIndex; idx += 1) {
    total += values[idx];
    count += 1;
  }
  return count ? total / count : 0;
}

export function buildCellSummary(cell, metadata, state, domainOverrides = {}) {
  const cacheKey = `${state.mode}|${state.variable}|${getWindowStateKey(metadata, state)}|${buildDomainCacheKey(domainOverrides)}|${cell.id}`;
  if (cellSummaryCache.has(cacheKey)) {
    return cellSummaryCache.get(cacheKey);
  }

  const trendMode = isTrendMode(metadata, state);
  const aStartIndex = getMonthIndex(metadata, state.rangeA.start);
  const bStartIndex = getMonthIndex(metadata, state.rangeB.start);
  const periodMonths = state.periodMonths ?? 1;
  const aEndIndex = Math.min(metadata.monthLabels.length - 1, aStartIndex + periodMonths - 1);
  const bEndIndex = Math.min(metadata.monthLabels.length - 1, bStartIndex + periodMonths - 1);

  const tempA = mean(cell.tempSeries, aStartIndex, aEndIndex);
  const tempB = mean(cell.tempSeries, bStartIndex, bEndIndex);
  const precipA = mean(cell.precipSeries, aStartIndex, aEndIndex) * 100;
  const precipB = mean(cell.precipSeries, bStartIndex, bEndIndex) * 100;

  const temperatureValue = trendMode ? cell.tempTrendPerDecade : tempB;
  const precipitationValue = trendMode ? cell.precipTrendPerDecade : precipB;
  const variable = state.variable ?? 'temperature';
  const selectedValue = variable === 'temperature' ? temperatureValue : precipitationValue;
  const selectedDomain = domainForVariable(variable, trendMode, domainOverrides);
  const color = colorForVariable(variable, selectedValue, selectedDomain);
  const headline = summarizeValue(variable, selectedValue, trendMode);

  const summary = {
    id: cell.id,
    lat: (cell.h3Center ?? cell).lat,
    lon: (cell.h3Center ?? cell).lon,
    color,
    variable,
    trendMode,
    temperatureValue,
    precipitationValue,
    tempA,
    tempB,
    precipA,
    precipB,
    selectedValue,
    selectedDomain,
    headline
  };
  cacheSet(cellSummaryCache, cacheKey, summary);
  return summary;
}

export function buildRenderableCells(cells, metadata, state, domainOverrides = {}) {
  const cacheKey = `${state.mode}|${state.variable}|${getWindowStateKey(metadata, state)}|${buildDomainCacheKey(domainOverrides)}|${cells.length}|${cells[0]?.id ?? ''}`;
  if (renderableCellsCache.has(cacheKey)) {
    return renderableCellsCache.get(cacheKey);
  }

  const renderable = cells.map((cell) => ({
    ...cell,
    summary: buildCellSummary(cell, metadata, state, domainOverrides)
  }));
  cacheSet(renderableCellsCache, cacheKey, renderable, 64);
  return renderable;
}
