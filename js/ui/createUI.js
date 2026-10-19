import { buildCellSummary, getAggregatedSeries, getBucketedSeries, getCommittedValueDomains, getMonthIndex, getSeriesColorDomain, isTrendMode } from '../state/selectors.js';
import {
  buildPaletteGradient,
  buildLegendMarkup,
  getModeLabel,
  getVariableLabel,
  interpolateHex,
  paletteForVariable,
  rampColor,
  RONI_PALETTE,
  formatNumber
} from '../scales/climateScales.js';
import { buildBarRects, buildBucketRingSlices, buildLinePoints, zeroLineY } from '../scales/chartRenderers.js';
import { getDisplayCell } from '../data/displayCells.js';



function formatCoordinate(value, axis) {
  if (!Number.isFinite(value)) {
    return axis === 'lat' ? '0.00°N' : '0.00°E';
  }
  const absolute = Math.abs(value).toFixed(2);
  const suffix = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${absolute}° ${suffix}`;
}

function formatLatLon(lat, lon) {
  return `${formatCoordinate(lat, 'lat')}, ${formatCoordinate(lon, 'lon')}`;
}

function buildTickFormatter(ticks, { signed = false } = {}) {
  let step = Infinity;
  for (let index = 1; index < ticks.length; index += 1) {
    const gap = Math.abs(ticks[index] - ticks[index - 1]);
    if (gap > 1e-9) step = Math.min(step, gap);
  }
  let decimals = 0;
  if (Number.isFinite(step)) {
    while (decimals < 3 && Math.abs(step * 10 ** decimals - Math.round(step * 10 ** decimals)) > 1e-6) {
      decimals += 1;
    }
    if (decimals === 3) {
      decimals = Math.max(0, Math.ceil(-Math.log10(step)));
    }
  }
  const format = (value, precision) => formatNumber(Math.abs(value) < 0.5 * 10 ** -precision ? 0 : value, precision, { signed });
  while (decimals < 3 && new Set(ticks.map((value) => format(value, decimals))).size < ticks.length) {
    decimals += 1;
  }
  return (value) => format(value, decimals);
}

function buildAxisTicks(ticks, top, trackHeight, domain, x, formatter, { textAnchor = 'end', tickDirection = 1 } = {}) {
  return ticks
    .map((value) => {
      const normalized = Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0])));
      const y = top + trackHeight - normalized * trackHeight;
      const x2 = x + 6 * tickDirection;
      const textX = x - 4 * tickDirection;
      return `
        <line x1="${x}" y1="${y.toFixed(2)}" x2="${x2}" y2="${y.toFixed(2)}" stroke="#5b6066" stroke-width="1" />
        <text x="${textX}" y="${(y + 4).toFixed(2)}" fill="#a3aab0" font-size="12" text-anchor="${textAnchor}">${formatter(value)}</text>
      `;
    })
    .join('');
}

function niceStepForSpan(span, targetTickCount = 6) {
  const safeSpan = Math.max(Math.abs(span), 1e-9);
  const roughStep = safeSpan / Math.max(2, targetTickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;

  let niceNormalized = 1;
  if (normalized <= 1) {
    niceNormalized = 1;
  } else if (normalized <= 2) {
    niceNormalized = 2;
  } else if (normalized <= 2.5) {
    niceNormalized = 2.5;
  } else if (normalized <= 5) {
    niceNormalized = 5;
  } else {
    niceNormalized = 10;
  }

  return niceNormalized * magnitude;
}

function buildNiceLinearTicks(domain, { targetTickCount = 6, includeZero = false } = {}) {
  const [rawMin, rawMax] = domain;
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return [0];
  }

  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  if (Math.abs(max - min) < 1e-9) {
    return [min];
  }

  const step = niceStepForSpan(max - min, targetTickCount);
  const ticks = [];
  const firstTick = Math.ceil(min / step) * step;
  const lastTick = Math.floor(max / step) * step;

  for (let tick = firstTick; tick <= lastTick + step * 0.25; tick += step) {
    const rounded = Math.abs(tick) < 1e-9 ? 0 : Number(tick.toFixed(6));
    ticks.push(rounded);
  }

  if (includeZero && min < 0 && max > 0 && !ticks.includes(0)) {
    ticks.push(0);
  }

  ticks.sort((a, b) => b - a);
  return ticks.length ? ticks : [max, min];
}

function filterTicksByPixelGap(ticks, domain, trackHeight, minimumGap = 28) {
  const span = domain[1] - domain[0];
  if (!Number.isFinite(span) || Math.abs(span) < 1e-9) {
    return ticks.slice(0, 1);
  }

  const accepted = [];
  const preserve = new Set();
  if (ticks.length) {
    preserve.add(ticks[0]);
    preserve.add(ticks[ticks.length - 1]);
  }
  if (domain[0] < 0 && domain[1] > 0) {
    preserve.add(0);
  }

  for (const tick of ticks) {
    const normalized = Math.max(0, Math.min(1, (tick - domain[0]) / span));
    const y = trackHeight - normalized * trackHeight;
    const tooClose = accepted.some((entry) => Math.abs(entry.y - y) < minimumGap);
    if (!tooClose || preserve.has(tick)) {
      accepted.push({ value: tick, y });
    }
  }

  accepted.sort((a, b) => b.value - a.value);
  return accepted.map((entry) => entry.value);
}

function buildAxisGuideLines(ticks, top, trackHeight, domain, left, right, { stroke = 'rgba(155, 163, 170, 0.16)', dashArray = '' } = {}) {
  return ticks
    .map((value) => {
      const normalized = Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0])));
      const y = top + trackHeight - normalized * trackHeight;
      return `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="${stroke}" stroke-width="1" ${dashArray ? `stroke-dasharray="${dashArray}"` : ''} />`;
    })
    .join('');
}

function buildAxisTitle(x, y, label, anchor = 'start') {
  return `<text x="${x}" y="${y}" fill="#b4bac0" font-size="12" text-anchor="${anchor}">${label}</text>`;
}

function buildSeriesDomain(series, { includeZero = false, minimumSpan = 1, paddingRatio = 0.08 } = {}) {
  const finite = series.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return includeZero ? [-1, 1] : [0, 1];
  }

  let min = Math.min(...finite);
  let max = Math.max(...finite);

  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }

  if (min === max) {
    const span = Math.max(minimumSpan, Math.abs(min) * 0.16 || minimumSpan);
    return [min - span, max + span];
  }

  const span = Math.max(minimumSpan, max - min);
  const padding = span * paddingRatio;
  return [min - padding, max + padding];
}

function buildMinMaxDomain(series, { includeZero = false, minimumSpan = 1 } = {}) {
  return buildSeriesDomain(series, { includeZero, minimumSpan, paddingRatio: 0 });
}

function buildRawAxisTicks(domain) {
  return buildNiceLinearTicks(domain, { targetTickCount: 6, includeZero: domain[0] <= 0 && domain[1] >= 0 });
}

function buildAnomalyAxisTicks(domain) {
  return buildNiceLinearTicks(domain, { targetTickCount: 6, includeZero: true });
}

function remapTicksToDomain(ticks, sourceDomain, targetDomain) {
  const sourceSpan = sourceDomain[1] - sourceDomain[0];
  const targetSpan = targetDomain[1] - targetDomain[0];
  if (!Number.isFinite(sourceSpan) || Math.abs(sourceSpan) < 1e-9 || !Number.isFinite(targetSpan)) {
    return buildRawAxisTicks(targetDomain);
  }
  return ticks.map((value) => {
    const normalized = (value - sourceDomain[0]) / sourceSpan;
    return targetDomain[0] + normalized * targetSpan;
  });
}

function buildCommittedChartDomains(cells, metadata, state) {
  const monthOfYear = getMonthOfYear(metadata);
  const buckets = buildRangeBuckets(metadata, state);
  const extents = new Float64Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
  const track = (slot, value) => {
    if (Number.isFinite(value)) {
      if (value < extents[slot]) extents[slot] = value;
      if (value > extents[slot + 1]) extents[slot + 1] = value;
    }
  };

  const zeroBaseline = new Float32Array(12);
  const stride = cells.length > 8000 ? 2 : 1;
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += stride) {
    const cell = cells[cellIndex];
    const temp = cell.tempSeries;
    const baseline = cell.tempBaselineMonthly ?? zeroBaseline;
    const precip = cell.precipSeries;
    const precipRaw = cell.precipRawSeries;
    for (const { startIndex, endIndex } of buckets) {
      let tempTotal = 0;
      let baselineTotal = 0;
      let precipTotal = 0;
      let precipRawTotal = 0;
      for (let index = startIndex; index <= endIndex; index += 1) {
        tempTotal += temp[index];
        baselineTotal += baseline[monthOfYear[index]];
        precipTotal += precip[index];
        precipRawTotal += precipRaw[index];
      }
      const count = endIndex - startIndex + 1;
      track(0, tempTotal / count);
      track(2, (tempTotal + baselineTotal) / count);
      track(4, (precipTotal / count) * 100);
      track(6, precipRawTotal / count);
    }
  }

  return {
    temperature: {
      anomaly: buildMinMaxDomain([extents[0], extents[1]], { includeZero: false, minimumSpan: 0.6 }),
      raw: buildMinMaxDomain([extents[2], extents[3]], { includeZero: false, minimumSpan: 2 })
    },
    precipitation: {
      anomaly: buildMinMaxDomain([extents[4], extents[5]], { includeZero: true, minimumSpan: 4 }),
      raw: buildMinMaxDomain([extents[6], extents[7]], { includeZero: true, minimumSpan: 10 })
    }
  };
}

function buildXAxisTicks(monthLabels, aIndex, bIndex, left, width, y) {
  const visibleLabels = monthLabels.slice(aIndex, bIndex + 1);
  return visibleLabels
    .map((label, index) => {
      const [year, month] = label.split('-').map(Number);
      if (month !== 1 || year % 10 !== 0) {
        return '';
      }
      const ratio = index / Math.max(1, visibleLabels.length - 1);
      const x = left + ratio * width;
      return `
        <line x1="${x.toFixed(2)}" y1="${y}" x2="${x.toFixed(2)}" y2="${y + 6}" stroke="#5b6066" stroke-width="1" />
        <text x="${x.toFixed(2)}" y="${y + 20}" fill="#a3aab0" font-size="12" text-anchor="middle">${year}</text>
      `;
    })
    .join('');
}

function buildXAxisBaseline(left, right, y) {
  return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#43484d" stroke-width="1" />`;
}

const ENSO_THRESHOLD = 0.5;
const ENSO_MIN_SEASONS = 5;
const ENSO_STRONG_PEAK = 1.5;

// ENSO episodes follow the NOAA convention: at least five consecutive overlapping seasons
// beyond +/-0.5. Only strong episodes (peak magnitude >= 1.5) are labelled.
function findStrongEnsoEpisodes(roniPoints) {
  const episodes = [];
  let run = [];
  let runSign = 0;
  const closeRun = () => {
    if (run.length >= ENSO_MIN_SEASONS) {
      const peak = run.reduce((best, point) => (Math.abs(point.anomaly) > Math.abs(best.anomaly) ? point : best));
      if (Math.abs(peak.anomaly) >= ENSO_STRONG_PEAK) {
        episodes.push({ phase: runSign > 0 ? 'el-nino' : 'la-nina', peak });
      }
    }
    run = [];
    runSign = 0;
  };

  for (const point of roniPoints) {
    const sign = point.anomaly >= ENSO_THRESHOLD ? 1 : point.anomaly <= -ENSO_THRESHOLD ? -1 : 0;
    if (sign !== runSign) {
      closeRun();
    }
    if (sign !== 0) {
      runSign = sign;
      run.push(point);
    }
  }
  closeRun();
  return episodes;
}

function buildTimelineRoniMarkup(monthLabels, roniPoints) {
  const width = 1000;
  const height = 76;
  const baselineY = 38;
  const amplitude = 28;

  const domain = [-3, 3];
  const monthIndexes = new Map(monthLabels.map((label, index) => [label, index]));
  const points = roniPoints
    .map((point) => {
      const index = monthIndexes.get(point.monthLabel);
      if (index === undefined) {
        return null;
      }
      const ratio = index / Math.max(1, monthLabels.length - 1);
      const x = ratio * width;
      const clamped = Math.max(domain[0], Math.min(domain[1], point.anomaly));
      const y = baselineY - (clamped / domain[1]) * amplitude;
      return { x, y };
    })
    .filter(Boolean);

  if (!points.length) {
    return '';
  }

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  const firstX = points[0].x.toFixed(2);
  const lastX = points[points.length - 1].x.toFixed(2);
  const areaPath = `${linePath} L${lastX},${baselineY.toFixed(2)} L${firstX},${baselineY.toFixed(2)} Z`;

  const clipAboveId = `clip-above-${monthLabels.length}`;
  const clipBelowId = `clip-below-${monthLabels.length}`;
  const areaAboveGradientId = `roni-area-above-${monthLabels.length}`;
  const areaBelowGradientId = `roni-area-below-${monthLabels.length}`;
  const roni = RONI_PALETTE;
  const positiveColor = roni[4];
  const negativeColor = roni[0];

  const monthIndexForLabel = (label) => monthIndexes.get(label);
  const eventLabels = findStrongEnsoEpisodes(roniPoints)
    .map(({ phase, peak }) => {
      const index = monthIndexForLabel(peak.monthLabel);
      if (index === undefined) {
        return '';
      }
      const percent = (index / Math.max(1, monthLabels.length - 1)) * 100;
      const clamped = Math.max(domain[0], Math.min(domain[1], peak.anomaly));
      const peakY = baselineY - (clamped / domain[1]) * amplitude;
      // La Niña labels sit below the axis tick marks.
      const y = phase === 'la-nina' ? Math.max(peakY, baselineY + 14) : peakY;
      const edge = percent < 1.5 ? ' is-start' : percent > 98.5 ? ' is-end' : '';
      const phaseName = phase === 'el-nino' ? 'El Niño' : 'La Niña';
      return `<span class="timeline-event timeline-event--${phase}${edge}" style="left:${percent.toFixed(3)}%;top:${y.toFixed(1)}px" title="${phaseName} peak ${escapeHtml(peak.monthLabel)}, RONI ${formatNumber(peak.anomaly, 1, { signed: true })}">${escapeHtml(peak.monthLabel.slice(0, 4))}</span>`;
    })
    .join('');

  return `
    <div class="timeline-events" aria-label="Strong El Niño and La Niña peaks">${eventLabels}</div>
    <svg class="timeline-axis__oni-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${areaAboveGradientId}" x1="0" y1="${baselineY}" x2="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${roni[3]}" stop-opacity="0.6" />
          <stop offset="30%" stop-color="${roni[3]}" stop-opacity="0.8" />
          <stop offset="100%" stop-color="${roni[4]}" stop-opacity="1" />
        </linearGradient>
        <linearGradient id="${areaBelowGradientId}" x1="0" y1="${baselineY}" x2="0" y2="${height}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${roni[1]}" stop-opacity="0.6" />
          <stop offset="30%" stop-color="${roni[1]}" stop-opacity="0.8" />
          <stop offset="100%" stop-color="${roni[0]}" stop-opacity="1" />
        </linearGradient>
        <clipPath id="${clipAboveId}">
          <rect x="0" y="0" width="${width}" height="${baselineY}" />
        </clipPath>
        <clipPath id="${clipBelowId}">
          <rect x="0" y="${baselineY}" width="${width}" height="${height - baselineY}" />
        </clipPath>
      </defs>
      <path d="${areaPath}" fill="url(#${areaAboveGradientId})" clip-path="url(#${clipAboveId})" />
      <path d="${areaPath}" fill="url(#${areaBelowGradientId})" clip-path="url(#${clipBelowId})" />
      <path d="${linePath}" fill="none" stroke="${positiveColor}" stroke-width="0.05" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#${clipAboveId})" />
      <path d="${linePath}" fill="none" stroke="${negativeColor}" stroke-width="0.05" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#${clipBelowId})" />
    </svg>
  `;
}

function buildRangeBuckets(metadata, state) {
  const startIndex = Math.max(0, getMonthIndex(metadata, state.rangeA.start));
  const endIndex = Math.max(startIndex, getMonthIndex(metadata, state.rangeB.start));
  const periodMonths = state.periodMonths ?? 1;
  const buckets = [];

  for (let index = startIndex; index <= endIndex; index += periodMonths) {
    const bucketEnd = Math.min(endIndex, index + periodMonths - 1);
    buckets.push({
      start: metadata.monthLabels[index],
      end: metadata.monthLabels[bucketEnd],
      startIndex: index,
      endIndex: bucketEnd
    });
  }

  return buckets;
}

function formatChartBucketLabel(bucket) {
  if (!bucket) {
    return '';
  }
  return bucket.start === bucket.end ? bucket.start : `${bucket.start} to ${bucket.end}`;
}

// Approximate width of an H3 hexagon (flat to flat) at each resolution.
const H3_CELL_WIDTH_LABELS = ['~1,900 km', '~730 km', '~270 km', '~100 km'];

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildRingMonthLabels(cx, cy, radius, startMonth = 1) {
  const safeStartMonth = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 1;
  const segmentAngle = (Math.PI * 2) / 12;
  const startOffset = -Math.PI / 2;

  return Array.from({ length: 12 }, (_, index) => {
    const monthIndex = (safeStartMonth - 1 + index) % 12;
    const angle = startOffset + (index + 0.5) * segmentAngle;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="#b4bac0" font-size="12" text-anchor="middle" dominant-baseline="middle">${MONTH_ABBREVIATIONS[monthIndex]}</text>`;
  }).join('');
}

function formatDetailHoverValue(variable, value) {
  if (variable === 'temperature') {
    return `${formatNumber(value, 2, { signed: true })} °C anomaly`;
  }
  return `${formatNumber(value, 1, { signed: true })}% anomaly`;
}

function formatDetailHoverRawValue(variable, value) {
  if (variable === 'temperature') {
    return `${formatNumber(value, 2)} °C`;
  }
  return `${formatNumber(value, 1)} mm/month`;
}

function formatDetailStatValue(variable, value) {
  if (!Number.isFinite(value)) {
    return '\u2014';
  }
  if (variable === 'temperature') {
    return `${formatNumber(value, 2, { signed: true })} °C`;
  }
  return `${formatNumber(value, 1, { signed: true })}%`;
}

function axisTitles(variable) {
  return variable === 'temperature'
    ? { raw: 'Temperature (°C)', anomaly: 'Anomaly (°C)' }
    : { raw: 'Precipitation (mm/month)', anomaly: 'Anomaly (%)' };
}

function computeSeriesStats(series) {
  const finite = series.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return {
      min: NaN,
      max: NaN,
      mean: NaN
    };
  }

  const total = finite.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
    mean: total / finite.length
  };
}

function monthNumberFromLabel(label) {
  if (!label) {
    return null;
  }
  const [, monthText] = label.split('-');
  const month = Number(monthText);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

const monthOfYearCache = new WeakMap();

function getMonthOfYear(metadata) {
  let months = monthOfYearCache.get(metadata.monthLabels);
  if (!months) {
    months = Uint8Array.from(metadata.monthLabels, (label, index) => (monthNumberFromLabel(label) ?? (index % 12) + 1) - 1);
    monthOfYearCache.set(metadata.monthLabels, months);
  }
  return months;
}

function buildTemperatureRawSeries(metadata, cell) {
  const monthOfYear = getMonthOfYear(metadata);
  return Array.from(monthOfYear, (month, index) => (cell.tempSeries[index] ?? 0) + (cell.tempBaselineMonthly?.[month] ?? 0));
}

function aggregateBucketSeries(source, buckets) {
  return buckets.map(({ startIndex, endIndex }) => {
    let total = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      total += source[index] ?? 0;
    }
    return total / (endIndex - startIndex + 1);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const DEFAULT_METADATA_SOURCES = [
  {
    label: 'Climate Data',
    text: '',
    url: 'https://cds.climate.copernicus.eu/',
    linkLabel: 'Climate Data Store (ERA5)'
  }
];

const RONI_METADATA_SOURCE = {
  label: 'ENSO',
  text: 'NOAA CPC Relative Oceanic Nino Index (RONI)',
  url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/',
  linkLabel: 'CPC'
};

const REFERENCE_METADATA_SOURCES = [
  {
    label: 'Places',
    text: 'Country borders and populated places',
    url: 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/',
    linkLabel: 'Natural Earth'
  }
];

function buildMetadataSourceLine(source) {
  if (!source || (!source.label && !source.text)) {
    return '';
  }
  const label = escapeHtml(source.label ?? '');
  const text = escapeHtml(source.text ?? '');
  const rawUrl = typeof source.url === 'string' ? source.url : '';
  const url = rawUrl ? escapeHtml(rawUrl) : '';

  let linkLabelRaw = typeof source.linkLabel === 'string' ? source.linkLabel : '';
  if (!linkLabelRaw && rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      linkLabelRaw = parsed.hostname.replace(/^www\./, '');
    } catch (e) {
      linkLabelRaw = rawUrl;
    }
  }
  const linkLabel = escapeHtml(linkLabelRaw || 'source');
  const link = url ? `<a href="${url}" target="_blank" rel="noreferrer">${linkLabel}</a>` : '';
  const value = text && link ? `${text} (${link})` : link || text;
  return label ? `${label}: ${value}` : value;
}

function buildMetadataSourcesMarkup(sources) {
  const baseSources = Array.isArray(sources) && sources.length ? sources : DEFAULT_METADATA_SOURCES;
  const creditsRoni = baseSources.some((source) => /roni/i.test(`${source?.text ?? ''} ${source?.url ?? ''}`));
  const resolvedSources = [...baseSources, ...(creditsRoni ? [] : [RONI_METADATA_SOURCE]), ...REFERENCE_METADATA_SOURCES];
  const lines = resolvedSources.map(buildMetadataSourceLine).filter(Boolean);
  return [...new Set(lines)].join('<br>');
}

function buildLinePathFromPoints(points) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
}

function buildRingHoverModel(labels, values, cx, cy, outerRadius, innerRadius, segmentsPerRing = 12) {
  const safeSegmentsPerRing = Math.max(1, Math.floor(segmentsPerRing));
  const ringCount = Math.max(1, labels.length);
  return {
    type: 'ring',
    labels,
    values,
    cx,
    cy,
    outerRadius,
    innerRadius,
    ringThickness: (outerRadius - innerRadius) / ringCount,
    segmentsPerRing: safeSegmentsPerRing
  };
}

function buildDetailChart(metadata, cell, state, valueDomains, committedChartDomains, viewportValueDomains = null, viewportChartDomains = null) {
  if (!cell) {
    return { markup: '', hoverModel: null };
  }

  const width = 428;
  const height = 388;
  const leftPad = 54;
  const rightPad = 54;
  const chartTop = 58;
  const chartHeight = 270;
  const chartBottom = chartTop + chartHeight;
  const innerWidth = width - leftPad - rightPad;
  const variable = state.variable ?? 'temperature';
  const mode = state.mode ?? 'pulse';
  const variableLabel = getVariableLabel(variable);
  const modeLabel = getModeLabel(mode);
  const aIndex = getMonthIndex(metadata, state.rangeA.start);
  const bIndex = getMonthIndex(metadata, state.rangeB.start);
  const startYear = state.rangeA.start?.split('-')[0] ?? '';
  const endYear = state.rangeB.start?.split('-')[0] ?? '';
  const chartValueScaleMode = state.chartValueScaleMode ?? 'local';
  const colorDomain = getSeriesColorDomain(cell, metadata, state, variable, valueDomains, viewportValueDomains);
  const palette = paletteForVariable(variable);
  const ringOuterRadius = 142;
  const ringInnerRadius = 26;
  const ringCx = width / 2;
  const ringCy = chartTop + 128;
  const aggregatedSeries = getAggregatedSeries(cell, metadata, state, variable);
  const bucketedSeries = getBucketedSeries(cell, metadata, state, variable);
  const rangeBuckets = buildRangeBuckets(metadata, state);
  const series = aggregatedSeries;
  const rawSource = variable === 'temperature' ? buildTemperatureRawSeries(metadata, cell) : cell.precipRawSeries;
  const rawSeries = aggregateBucketSeries(rawSource, rangeBuckets);
  const ringLabels = rangeBuckets.map(formatChartBucketLabel);
  const ringSeries = series;
  const localAnomalyDomain = buildMinMaxDomain(series, {
    includeZero: variable !== 'temperature',
    minimumSpan: variable === 'temperature' ? 0.6 : 4
  });
  const localRawDomain = buildMinMaxDomain(rawSeries, {
    includeZero: variable !== 'temperature',
    minimumSpan: variable === 'temperature' ? 2 : 10
  });
  const anomalyDomain =
    chartValueScaleMode === 'global'
      ? committedChartDomains?.[variable]?.anomaly ?? localAnomalyDomain
      : chartValueScaleMode === 'viewport'
        ? viewportChartDomains?.[variable]?.anomaly ?? localAnomalyDomain
        : localAnomalyDomain;
  const rawDomain = localRawDomain;
  const anomalyGuideTicks = buildAnomalyAxisTicks(anomalyDomain);
  const rawGuideTicks = variable === 'temperature' ? remapTicksToDomain(anomalyGuideTicks, anomalyDomain, rawDomain) : buildRawAxisTicks(rawDomain);
  const anomalyTicks = filterTicksByPixelGap(anomalyGuideTicks, anomalyDomain, chartHeight, 30);
  const rawTicks =
    variable === 'temperature'
      ? remapTicksToDomain(anomalyTicks, anomalyDomain, rawDomain)
      : filterTicksByPixelGap(rawGuideTicks, rawDomain, chartHeight, 30);
  const formatAnomalyTick = buildTickFormatter(anomalyTicks, { signed: variable === 'temperature' });
  const formatRawTick = buildTickFormatter(rawTicks);
  const useAlignedDualAxisOnly = variable === 'temperature';

  let chartMarkup = '';
  let hoverModel = null;

  if (mode === 'pulse') {
    const points = buildLinePoints(series, anomalyDomain, leftPad, chartTop, innerWidth, chartHeight);
    const path = buildLinePathFromPoints(points);
    const rawPoints = useAlignedDualAxisOnly ? null : buildLinePoints(rawSeries, rawDomain, leftPad, chartTop, innerWidth, chartHeight);
    const rawPath = rawPoints ? buildLinePathFromPoints(rawPoints) : '';
    const pointDots =
      points.length <= 180
        ? points
            .map(
              (point) =>
                `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="2.1" fill="#d9e4eb" fill-opacity="0.72" />`
            )
            .join('')
        : '';

    hoverModel = {
      type: 'cartesian-line',
      width,
      height,
      left: leftPad,
      top: chartTop,
      innerWidth,
      chartHeight,
      labels: rangeBuckets.map(formatChartBucketLabel),
      values: series,
      rawValues: rawSeries,
      points
    };

    chartMarkup = `
      ${buildAxisTitle(leftPad - 40, chartTop - 18, axisTitles(variable).raw, 'start')}
      ${buildAxisTitle(width - rightPad + 40, chartTop - 18, axisTitles(variable).anomaly, 'end')}
      ${useAlignedDualAxisOnly ? '' : buildAxisGuideLines(rawGuideTicks, chartTop, chartHeight, rawDomain, leftPad, width - rightPad, { stroke: 'rgba(128, 134, 140, 0.14)', dashArray: '4 5' })}
      ${buildAxisGuideLines(anomalyGuideTicks, chartTop, chartHeight, anomalyDomain, leftPad, width - rightPad, { stroke: 'rgba(165, 171, 177, 0.16)' })}
      <line x1="${leftPad}" y1="${zeroLineY(anomalyDomain, chartTop, chartHeight).toFixed(2)}" x2="${width - rightPad}" y2="${zeroLineY(anomalyDomain, chartTop, chartHeight).toFixed(2)}" stroke="#565c62" stroke-width="1.1" />
      ${useAlignedDualAxisOnly ? '' : `<path d="${rawPath}" fill="none" stroke="#aeb4ba" stroke-opacity="0.34" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round" />`}
      <path d="${path}" fill="none" stroke="url(#detail-gradient-${cell.id.replace(/[^a-zA-Z0-9_-]/g, '_')})" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
      ${pointDots}
      ${buildAxisTicks(rawTicks, chartTop, chartHeight, rawDomain, leftPad, formatRawTick)}
      ${buildAxisTicks(anomalyTicks, chartTop, chartHeight, anomalyDomain, width - rightPad, formatAnomalyTick, { textAnchor: 'start', tickDirection: -1 })}
      ${buildXAxisBaseline(leftPad, width - rightPad, chartBottom)}
      ${buildXAxisTicks(metadata.monthLabels, aIndex, bIndex, leftPad, innerWidth, chartBottom)}
    `;
  } else if (mode === 'shade') {
    const zeroY = zeroLineY(anomalyDomain, chartTop, chartHeight);
    const barWidth = innerWidth / Math.max(1, series.length);
    const rawPoints = useAlignedDualAxisOnly ? null : buildLinePoints(rawSeries, rawDomain, leftPad, chartTop, innerWidth, chartHeight);
    const rawPath = rawPoints ? buildLinePathFromPoints(rawPoints) : '';
    const points = series.map((value, index) => {
      const normalized = Math.max(0, Math.min(1, (value - anomalyDomain[0]) / (anomalyDomain[1] - anomalyDomain[0])));
      const y = chartTop + chartHeight - normalized * chartHeight;
      return {
        x: leftPad + index * barWidth + barWidth / 2,
        y: Math.min(y, zeroY),
        value
      };
    });

    hoverModel = {
      type: 'cartesian-bar',
      width,
      height,
      left: leftPad,
      top: chartTop,
      innerWidth,
      chartHeight,
      labels: rangeBuckets.map(formatChartBucketLabel),
      values: series,
      rawValues: rawSeries,
      points
    };

    chartMarkup = `
      ${buildAxisTitle(leftPad - 40, chartTop - 18, axisTitles(variable).raw, 'start')}
      ${buildAxisTitle(width - rightPad + 40, chartTop - 18, axisTitles(variable).anomaly, 'end')}
      ${useAlignedDualAxisOnly ? '' : buildAxisGuideLines(rawGuideTicks, chartTop, chartHeight, rawDomain, leftPad, width - rightPad, { stroke: 'rgba(128, 134, 140, 0.14)', dashArray: '4 5' })}
      ${buildAxisGuideLines(anomalyGuideTicks, chartTop, chartHeight, anomalyDomain, leftPad, width - rightPad, { stroke: 'rgba(165, 171, 177, 0.16)' })}
      <line x1="${leftPad}" y1="${zeroY.toFixed(2)}" x2="${width - rightPad}" y2="${zeroY.toFixed(2)}" stroke="#565c62" stroke-width="1.1" />
      ${buildBarRects(series, anomalyDomain, leftPad, chartTop, innerWidth, chartHeight, palette, colorDomain)}
      ${useAlignedDualAxisOnly ? '' : `<path d="${rawPath}" fill="none" stroke="#aeb4ba" stroke-opacity="0.34" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round" />`}
      ${buildAxisTicks(rawTicks, chartTop, chartHeight, rawDomain, leftPad, formatRawTick)}
      ${buildAxisTicks(anomalyTicks, chartTop, chartHeight, anomalyDomain, width - rightPad, formatAnomalyTick, { textAnchor: 'start', tickDirection: -1 })}
      ${buildXAxisBaseline(leftPad, width - rightPad, chartBottom)}
      ${buildXAxisTicks(metadata.monthLabels, aIndex, bIndex, leftPad, innerWidth, chartBottom)}
    `;
  } else {
    hoverModel = {
      width,
      height,
      ...buildRingHoverModel(ringLabels, ringSeries, ringCx, ringCy + 6, ringOuterRadius, ringInnerRadius, 12),
      rawValues: rawSeries
    };

    chartMarkup = `
      <text x="16" y="24" fill="#b4bac0" font-size="12" text-anchor="start">${escapeHtml(`${variableLabel} anomaly by month (${variable === 'temperature' ? '°C' : '%'})`)}</text>
      <g transform="translate(0, 6)">
        ${buildBucketRingSlices(bucketedSeries, anomalyDomain, ringCx, ringCy, ringOuterRadius, ringInnerRadius, palette, 12, colorDomain)}
      </g>
      ${buildRingMonthLabels(ringCx, ringCy + 6, ringOuterRadius + 18, 1)}
      <circle cx="${ringCx}" cy="${ringCy + 6}" r="${ringInnerRadius - 2}" fill="#121213" />
      <text x="${ringCx}" y="${(ringCy + 10).toFixed(2)}" fill="#e4e8ea" font-size="13" text-anchor="middle">${escapeHtml(startYear)}</text>
      <text x="${(width - 20).toFixed(2)}" y="${(ringCy + 10).toFixed(2)}" fill="#cfd3d6" font-size="13" text-anchor="end">${escapeHtml(endYear)}</text>
    `;
  }

  return {
    hoverModel,
    colorDomain,
    markup: `
      <div class="detail-chart__frame" data-detail-chart-frame>
        <svg class="detail-chart__svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${modeLabel} chart of ${variableLabel.toLowerCase()} anomalies from ${startYear} to ${endYear} for ${cell.isGlobal ? 'the global average' : formatLatLon(cell.lat, cell.lon)}`)}">
          <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#121213" />
          <defs>
            <linearGradient id="detail-gradient-${cell.id.replace(/[^a-zA-Z0-9_-]/g, '_')}" x1="0%" y1="0%" x2="100%" y2="0%">
              ${series
                .map((value, index) => {
                  const offset = (index / Math.max(1, series.length - 1)) * 100;
                  return `<stop offset="${offset}%" stop-color="${rampColor(value, colorDomain, palette)}" />`;
                })
                .join('')}
            </linearGradient>
          </defs>
          ${chartMarkup}
        </svg>
        <div class="detail-chart__legend" data-legend></div>
        <div class="detail-chart__crosshair" data-detail-chart-line hidden></div>
        <div class="detail-chart__hover" data-detail-chart-hover hidden></div>
      </div>
    `
  };
}

export function createUI(root, store, metadata, rawCells, roniPoints, globalCell = null) {
  const mapStage = root.querySelector('.map-stage');
  const mapLoading = root.querySelector('[data-map-loading]');
  const mapLoadingTitle = root.querySelector('[data-map-loading-title]');
  const mapLoadingDetail = root.querySelector('[data-map-loading-detail]');
  const metaDatasource = root.querySelector('[data-bind="meta-datasource"]');
  const metaCopyright = root.querySelector('[data-bind="meta-copyright"]');
  const detailSummary = root.querySelector('[data-detail-summary]');
  const selectionAnnouncer = root.querySelector('[data-selection-announcer]');
  const detailChart = root.querySelector('[data-detail-chart]');
  const timelineMaskBefore = root.querySelector('[data-timeline-mask="before"]');
  const timelineMaskAfter = root.querySelector('[data-timeline-mask="after"]');
  const timelineRuler = root.querySelector('[data-timeline-ruler]');
  const timelineRoni = root.querySelector('[data-timeline-oni]');
  const timelineRoniToggle = root.querySelector('[data-timeline-oni-toggle]');
  const periodSelect = root.querySelector('[data-period-select]');
  const exportMapButton = root.querySelector('[data-action="export-map"]');
  const exportChartButton = root.querySelector('[data-action="export-chart"]');
  const controlPanel = root.querySelector('[data-panel="controls"]');
  const detailPanel = root.querySelector('[data-panel="details"]');
  const appTitle = root.querySelector('[data-bind="app-title"]');
  const monthLabels = metadata.monthLabels;
  const variableButtons = [...root.querySelectorAll('[data-variable]')];
  const symbolButtons = [...root.querySelectorAll('[data-symbol-mode]')];
  const symbolSizeSlider = root.querySelector('[data-symbol-size]');
  const symbolSizeValue = root.querySelector('[data-bind="symbol-size-value"]');
  const symbolOpacitySlider = root.querySelector('[data-symbol-opacity]');
  const symbolOpacityValue = root.querySelector('[data-bind="symbol-opacity-value"]');
  const symbolStrokeSlider = root.querySelector('[data-symbol-stroke]');
  const symbolStrokeValue = root.querySelector('[data-bind="symbol-stroke-value"]');
  const showCountryBorderToggle = root.querySelector('[data-show-country-border]');
  const showCountryLabelToggle = root.querySelector('[data-show-country-label]');
  const showCityLabelToggle = root.querySelector('[data-show-city-label]');
  const symbolUnitInfo = root.querySelector('[data-bind="symbol-unit-info"]');
  const startYearSelect = root.querySelector('[data-range-select="start"]');
  const endYearSelect = root.querySelector('[data-range-select="end"]');
  const mobileToggleButtons = [...root.querySelectorAll('[data-mobile-toggle]')];
  let currentDetailChartModel = null;
  const lookupCell = (id) => (id == null ? null : getDisplayCell(id) ?? null);
  const defaultDetailCell = () => lookupCell('global') ?? globalCell;

  if (appTitle) {
    appTitle.textContent = metadata.title ?? 'Climate Change Visualized';
  }
  document.title = metadata.title ?? 'Climate Change Visualized';
  if (metaDatasource) {
    metaDatasource.innerHTML = buildMetadataSourcesMarkup(metadata.dataSources);
  }
  if (metaCopyright) {
    metaCopyright.innerHTML = '© Atlas Guo (2026), <a href="https://cartoguophy.com" target="_blank" rel="noreferrer">CartoGuophy.com</a>';
  }

  for (const button of variableButtons) {
    const scale = button.querySelector('.segmented__button-scale');
    if (scale && button.dataset.variable) {
      scale.style.setProperty('--palette-gradient', buildPaletteGradient(button.dataset.variable));
    }
    button.addEventListener('click', () => store.setVariable(button.dataset.variable));
  }

  for (const button of symbolButtons) {
    button.addEventListener('click', () => store.setSymbol(button.dataset.symbolMode, button.dataset.symbolUnit));
  }

  detailChart?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'radio') {
      return;
    }
    if (target.name === 'legend-value-scale') {
      store.setChartValueScaleMode(target.value);
    }
  });

  const colorScaleGroup = root.querySelector('[data-color-scale-group]');
  colorScaleGroup?.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === 'panel-color-scale') {
      store.setColorScaleMode(target.value);
    }
  });

  const tickItems = [];
  for (const [index, label] of monthLabels.entries()) {
    const [year, month] = label.split('-').map(Number);
    if (month === 1) {
      tickItems.push({
        year,
        label: year % 5 === 0 ? String(year) : '',
        annual: true,
        major: year % 10 === 0,
        medium: year % 5 === 0,
        ratio: index / Math.max(1, monthLabels.length)
      });
    }
  }

  timelineRuler.innerHTML = tickItems
    .map(
      (tick) =>
        `<span class="timeline-axis__tick${tick.annual ? ' is-annual' : ''}${tick.medium ? ' is-medium' : ''}${tick.major ? ' is-major' : ''}" data-year="${tick.year}" style="left:${(tick.ratio * 100).toFixed(3)}%"><i></i>${tick.label ? `<em>${tick.label}</em>` : ''}</span>`
    )
    .join('');

  timelineRoni.innerHTML = buildTimelineRoniMarkup(monthLabels, roniPoints);
  timelineRoniToggle.addEventListener('change', () => {
    timelineRoni.hidden = !timelineRoniToggle.checked;
  });
  periodSelect.addEventListener('change', () => {
    store.setPeriodMonths(Number(periodSelect.value));
  });

  const firstYear = Number(monthLabels[0].slice(0, 4));
  const lastYear = Number(monthLabels[monthLabels.length - 1].slice(0, 4));
  const yearOptions = Array.from({ length: lastYear - firstYear + 1 }, (_, offset) => firstYear + offset);
  const yearOptionsMarkup = yearOptions.map((year) => `<option value="${year}">${year}</option>`).join('');
  startYearSelect.innerHTML = yearOptionsMarkup;
  endYearSelect.innerHTML = yearOptionsMarkup;

  // The time range always spans whole years: January of the start year to December of the end year.
  function setYearRange(startYear, endYear) {
    const start = getMonthIndex(metadata, `${startYear}-01`);
    const endLabel = `${endYear}-12`;
    const end = getMonthIndex(metadata, endLabel) === -1 ? monthLabels.length - 1 : getMonthIndex(metadata, endLabel);
    if (start === -1 || end < start) {
      return;
    }
    const { rangeA, rangeB } = store.getState();
    if (rangeA.start === monthLabels[start] && rangeB.start === monthLabels[end]) {
      return;
    }
    store.setRanges(
      { start: monthLabels[start], end: monthLabels[start] },
      { start: monthLabels[end], end: monthLabels[end] }
    );
  }

  startYearSelect.addEventListener('change', () => {
    setYearRange(Number(startYearSelect.value), Number(endYearSelect.value));
  });
  endYearSelect.addEventListener('change', () => {
    setYearRange(Number(startYearSelect.value), Number(endYearSelect.value));
  });

  const timelineAxis = root.querySelector('[data-timeline-axis]');
  const timelineHandles = {
    start: root.querySelector('[data-timeline-handle="start"]'),
    end: root.querySelector('[data-timeline-handle="end"]')
  };
  // While a handle is dragged the range is previewed locally and committed on release.
  let dragPreview = null;

  function yearStartRatio(year) {
    return getMonthIndex(metadata, `${year}-01`) / monthLabels.length;
  }

  function yearEndRatio(year) {
    const index = getMonthIndex(metadata, `${year}-12`);
    return index === -1 ? 1 : (index + 1) / monthLabels.length;
  }

  // Draws the selected years on the timeline, the handles and the dropdowns.
  function paintYearRange(startYear, endYear) {
    const startRatio = yearStartRatio(startYear);
    const endRatio = yearEndRatio(endYear);
    timelineMaskBefore.style.width = `${(startRatio * 100).toFixed(3)}%`;
    timelineMaskAfter.style.left = `${(endRatio * 100).toFixed(3)}%`;
    timelineMaskBefore.hidden = startRatio <= 0;
    timelineMaskAfter.hidden = endRatio >= 1;
    for (const tick of timelineRuler.children) {
      const tickYear = Number(tick.dataset.year);
      tick.classList.toggle('is-outside', tickYear < startYear || tickYear > endYear);
    }

    for (const [key, handle] of Object.entries(timelineHandles)) {
      const year = key === 'start' ? startYear : endYear;
      handle.style.left = `${((key === 'start' ? startRatio : endRatio) * 100).toFixed(3)}%`;
      handle.querySelector('[data-handle-tag]').textContent = String(year);
      handle.setAttribute('aria-valuemin', String(key === 'start' ? firstYear : startYear));
      handle.setAttribute('aria-valuemax', String(key === 'start' ? endYear : lastYear));
      handle.setAttribute('aria-valuenow', String(year));
      handle.setAttribute('aria-valuetext', String(year));
    }
    const spanPx = (endRatio - startRatio) * timelineAxis.clientWidth;
    timelineAxis.classList.toggle('is-tight', spanPx < 96);

    startYearSelect.value = String(startYear);
    endYearSelect.value = String(endYear);
    for (const option of startYearSelect.options) {
      option.disabled = Number(option.value) > endYear;
    }
    for (const option of endYearSelect.options) {
      option.disabled = Number(option.value) < startYear;
    }
  }

  function currentYearRange() {
    const { rangeA, rangeB } = store.getState();
    return { start: Number(rangeA.start.slice(0, 4)), end: Number(rangeB.start.slice(0, 4)) };
  }

  function yearFromPointer(key, clientX, range) {
    const rect = timelineAxis.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    const boundaryYear = firstYear + Math.round((ratio * monthLabels.length) / 12);
    return key === 'start'
      ? Math.min(range.end, Math.max(firstYear, boundaryYear))
      : Math.max(range.start, Math.min(lastYear, boundaryYear - 1));
  }

  for (const [key, handle] of Object.entries(timelineHandles)) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.focus({ preventScroll: true });
      handle.classList.add('is-dragging');
      dragPreview = { key, ...currentYearRange() };
    });

    handle.addEventListener('pointermove', (event) => {
      if (!dragPreview || dragPreview.key !== key) {
        return;
      }
      const year = yearFromPointer(key, event.clientX, dragPreview);
      if (year !== dragPreview[key]) {
        dragPreview[key] = year;
        paintYearRange(dragPreview.start, dragPreview.end);
      }
    });

    const finishDrag = () => {
      if (!dragPreview || dragPreview.key !== key) {
        return;
      }
      const { start, end } = dragPreview;
      dragPreview = null;
      handle.classList.remove('is-dragging');
      setYearRange(start, end);
      paintYearRange(...Object.values(currentYearRange()));
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);

    handle.addEventListener('keydown', (event) => {
      const range = currentYearRange();
      const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 };
      let year = range[key];
      if (event.key in steps) {
        year += steps[event.key];
      } else if (event.key === 'Home') {
        year = key === 'start' ? firstYear : range.start;
      } else if (event.key === 'End') {
        year = key === 'start' ? range.end : lastYear;
      } else {
        return;
      }
      event.preventDefault();
      year = key === 'start' ? Math.min(range.end, Math.max(firstYear, year)) : Math.max(range.start, Math.min(lastYear, year));
      setYearRange(key === 'start' ? year : range.start, key === 'end' ? year : range.end);
    });
  }

  root.querySelector('[data-action="reset-ranges"]').addEventListener('click', () => store.resetRanges());
  symbolSizeSlider?.addEventListener('input', () => {
    const pct = Number(symbolSizeSlider.value);
    if (symbolSizeValue) {
      symbolSizeValue.textContent = `${pct}%`;
    }
    const scale = pct / 80;
    store.setGlyphSize(scale);
  });

  symbolOpacitySlider?.addEventListener('input', () => {
    const pct = Number(symbolOpacitySlider.value);
    if (symbolOpacityValue) symbolOpacityValue.textContent = `${pct}%`;
    store.setSymbolOpacity(pct / 100);
  });

  function commitSymbolStrokeOpacity() {
    if (!symbolStrokeSlider) {
      return;
    }
    const pct = Number(symbolStrokeSlider.value);
    if (symbolStrokeValue) symbolStrokeValue.textContent = `${pct}%`;
    store.setStrokeOpacity(pct / 100);
  }

  symbolStrokeSlider?.addEventListener('input', commitSymbolStrokeOpacity);
  symbolStrokeSlider?.addEventListener('change', commitSymbolStrokeOpacity);

  showCountryBorderToggle?.addEventListener('change', () => {
    store.setShowCountryBorder(showCountryBorderToggle.checked);
  });

  showCountryLabelToggle?.addEventListener('change', () => {
    store.setShowCountryLabel(showCountryLabelToggle.checked);
  });

  showCityLabelToggle?.addEventListener('change', () => {
    store.setShowCityLabel(showCityLabelToggle.checked);
  });

  for (const button of mobileToggleButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.mobileToggle === 'controls') {
        controlPanel?.classList.toggle('panel--open');
      } else {
        detailPanel?.classList.toggle('panel--open');
      }
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadDataUrl(dataUrl, filename) {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function buildExportFilename(prefix) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `${prefix}-${stamp}.png`;
  }

  function loadSvgImage(svg, width, height) {
    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clonedSvg.setAttribute('width', String(width));
    clonedSvg.setAttribute('height', String(height));
    clonedSvg.setAttribute('font-family', "'IBM Plex Sans', system-ui, 'Segoe UI', Roboto, sans-serif");
    const markup = new XMLSerializer().serializeToString(clonedSvg);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    }).finally(() => URL.revokeObjectURL(url));
  }

  async function downloadCanvas(canvas, prefix) {
    const blob = canvas.toBlob ? await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')) : null;
    if (blob) {
      downloadBlob(blob, buildExportFilename(prefix));
    } else {
      downloadDataUrl(canvas.toDataURL('image/png'), buildExportFilename(prefix));
    }
  }

  function getEffectiveOpacity(element, boundary) {
    let opacity = 1;
    for (let node = element; node && node !== boundary; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return 0;
      }
      opacity *= Number.parseFloat(style.opacity) || 0;
    }
    return opacity;
  }

  async function exportMapPng() {
    const mapCanvas = root.querySelector('#map canvas.maplibregl-canvas');
    if (!(mapCanvas instanceof HTMLCanvasElement) || !mapStage) {
      return;
    }
    const canvasRect = mapCanvas.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) {
      return;
    }

    const output = document.createElement('canvas');
    output.width = mapCanvas.width;
    output.height = mapCanvas.height;
    const context = output.getContext('2d');
    if (!context) {
      return;
    }
    const scale = mapCanvas.width / canvasRect.width;
    context.fillStyle = '#050607';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(mapCanvas, 0, 0);

    const glyphs = [...mapStage.querySelectorAll('.glyph-card__svg')]
      .map((svg) => ({ svg, rect: svg.getBoundingClientRect(), opacity: getEffectiveOpacity(svg, mapStage) }))
      .filter(({ rect, opacity }) => rect.width > 0 && rect.height > 0 && opacity > 0.01);
    const images = await Promise.all(
      glyphs.map(({ svg, rect }) => loadSvgImage(svg, rect.width, rect.height).catch(() => null))
    );
    glyphs.forEach(({ rect, opacity }, index) => {
      if (!images[index]) {
        return;
      }
      context.globalAlpha = Math.min(1, opacity);
      context.drawImage(
        images[index],
        (rect.left - canvasRect.left) * scale,
        (rect.top - canvasRect.top) * scale,
        rect.width * scale,
        rect.height * scale
      );
    });
    context.globalAlpha = 1;

    await downloadCanvas(output, 'climate-map');
  }

  async function exportChartPng() {
    const svg = detailChart?.querySelector('.detail-chart__svg');
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const viewBox = svg.viewBox.baseVal;
    const width = viewBox?.width ? Math.round(viewBox.width) : 428;
    const height = viewBox?.height ? Math.round(viewBox.height) : 388;
    const pixelRatio = 2;
    const image = await loadSvgImage(svg, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    await downloadCanvas(canvas, 'climate-chart');
  }

  exportMapButton?.addEventListener('click', () => {
    void exportMapPng();
  });

  exportChartButton?.addEventListener('click', () => {
    void exportChartPng();
  });

  function hideDetailChartHover() {
    if (!detailChart) {
      return;
    }
    const hover = detailChart.querySelector('[data-detail-chart-hover]');
    const line = detailChart.querySelector('[data-detail-chart-line]');
    if (hover) {
      hover.hidden = true;
    }
    if (line) {
      line.hidden = true;
    }
  }

  function resolveDetailChartHit(pointerX, pointerY) {
    if (!currentDetailChartModel || !detailChart) {
      return null;
    }

    const frame = detailChart.querySelector('[data-detail-chart-frame]');
    if (!frame) {
      return null;
    }

    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const x = ((pointerX - rect.left) / rect.width) * currentDetailChartModel.width;
    const y = ((pointerY - rect.top) / rect.height) * currentDetailChartModel.height;

    if (currentDetailChartModel.type === 'ring') {
      const dx = x - currentDetailChartModel.cx;
      const dy = y - currentDetailChartModel.cy;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius < currentDetailChartModel.innerRadius || radius > currentDetailChartModel.outerRadius) {
        return null;
      }

      const ringIndex = Math.min(
        currentDetailChartModel.labels.length - 1,
        Math.max(0, Math.floor((radius - currentDetailChartModel.innerRadius) / currentDetailChartModel.ringThickness))
      );
      const midAngle = Math.atan2(dy, dx);
      const midRadius =
        currentDetailChartModel.innerRadius + ringIndex * currentDetailChartModel.ringThickness + currentDetailChartModel.ringThickness / 2;

      return {
        anchorX: currentDetailChartModel.cx + Math.cos(midAngle) * midRadius,
        anchorY: currentDetailChartModel.cy + Math.sin(midAngle) * midRadius,
        label: currentDetailChartModel.labels[ringIndex],
        value: currentDetailChartModel.values[ringIndex],
        rawValue: currentDetailChartModel.rawValues?.[ringIndex]
      };
    }

    if (
      x < currentDetailChartModel.left ||
      x > currentDetailChartModel.left + currentDetailChartModel.innerWidth ||
      y < currentDetailChartModel.top ||
      y > currentDetailChartModel.top + currentDetailChartModel.chartHeight
    ) {
      return null;
    }

    const count = currentDetailChartModel.points.length;
    if (!count) {
      return null;
    }

    let index = 0;
    if (currentDetailChartModel.type === 'cartesian-bar') {
      const slotWidth = currentDetailChartModel.innerWidth / Math.max(1, count);
      index = Math.min(count - 1, Math.max(0, Math.floor((x - currentDetailChartModel.left) / slotWidth)));
    } else {
      const step = currentDetailChartModel.innerWidth / Math.max(1, count - 1);
      index = Math.min(count - 1, Math.max(0, Math.round((x - currentDetailChartModel.left) / step)));
    }

    const point = currentDetailChartModel.points[index];
    if (!point) {
      return null;
    }

    return {
      anchorX: point.x,
      anchorY: point.y,
      label: currentDetailChartModel.labels[index],
      value: currentDetailChartModel.values[index],
      rawValue: currentDetailChartModel.rawValues?.[index]
    };
  }

  function updateDetailChartHover(event) {
    if (!detailChart) {
      return;
    }
    const hit = resolveDetailChartHit(event.clientX, event.clientY);
    const hover = detailChart.querySelector('[data-detail-chart-hover]');
    const line = detailChart.querySelector('[data-detail-chart-line]');
    const frame = detailChart.querySelector('[data-detail-chart-frame]');
    if (!hover || !line || !frame || !hit || !currentDetailChartModel) {
      hideDetailChartHover();
      return;
    }

    const rect = frame.getBoundingClientRect();
    const anchorLeft = (hit.anchorX / currentDetailChartModel.width) * rect.width;
    const anchorTop = (hit.anchorY / currentDetailChartModel.height) * rect.height;
    const variable = store.getState().variable ?? 'temperature';

    hover.hidden = false;
    hover.style.left = `${anchorLeft}px`;
    hover.style.top = `${anchorTop}px`;
    hover.innerHTML = `
      <span>${escapeHtml(hit.label)}</span>
      <strong>${escapeHtml(formatDetailHoverValue(variable, hit.value))}</strong>
      <span>Raw: ${escapeHtml(formatDetailHoverRawValue(variable, hit.rawValue ?? 0))}</span>
    `;

    if (currentDetailChartModel.type === 'ring') {
      line.hidden = true;
      return;
    }

    const lineTop = (currentDetailChartModel.top / currentDetailChartModel.height) * rect.height;
    const lineHeight = (currentDetailChartModel.chartHeight / currentDetailChartModel.height) * rect.height;
    line.hidden = false;
    line.style.left = `${anchorLeft}px`;
    line.style.top = `${lineTop}px`;
    line.style.height = `${lineHeight}px`;
  }

  detailChart?.addEventListener('pointermove', updateDetailChartHover);
  detailChart?.addEventListener('pointerleave', hideDetailChartHover);
  detailChart?.addEventListener('pointercancel', hideDetailChartHover);

  const rightPanel = root.querySelector('.panel--right');
  let pointerOverRightPanel = false;
  rightPanel?.addEventListener('pointerenter', () => { pointerOverRightPanel = true; });
  rightPanel?.addEventListener('pointerleave', () => { pointerOverRightPanel = false; });
  let lastPreviewCellId = null;

  const globalDomainCache = { key: null, value: null, chart: null };
  const cachedTrendMode = isTrendMode(metadata, store.getState());

  function getGlobalDomains(state, kind) {
    const key = `${state.rangeA.start}|${state.rangeB.start}|${state.periodMonths ?? 1}`;
    if (globalDomainCache.key !== key) {
      globalDomainCache.key = key;
      globalDomainCache.value = null;
      globalDomainCache.chart = null;
    }
    if (!globalDomainCache[kind]) {
      globalDomainCache[kind] =
        kind === 'value'
          ? getCommittedValueDomains(rawCells, metadata, state)
          : buildCommittedChartDomains(rawCells, metadata, state);
    }
    return globalDomainCache[kind];
  }

  function isViewportScaleActive(state) {
    return state.colorScaleMode === 'viewport' || state.chartValueScaleMode === 'viewport';
  }

  function resolveViewportDomains(state) {
    const domains = state.viewportDomains;
    if (!isViewportScaleActive(state)) {
      return { value: null, chart: null };
    }
    if (!domains?.temperature || !domains?.precipitation) {
      return {
        value: state.colorScaleMode === 'viewport' ? getGlobalDomains(state, 'value') : null,
        chart: state.chartValueScaleMode === 'viewport' ? getGlobalDomains(state, 'chart') : null
      };
    }
    return {
      value: domains,
      chart: {
        temperature: { anomaly: buildMinMaxDomain(domains.temperature, { minimumSpan: 0.6 }) },
        precipitation: { anomaly: buildMinMaxDomain(domains.precipitation, { includeZero: true, minimumSpan: 4 }) }
      }
    };
  }

  return {
    setMapLoading({ active = false, title = 'Updating globe', detail = 'Rendering climate layers' } = {}) {
      const loadingVariable = store.getState().variable ?? 'temperature';
      if (mapLoadingTitle) {
        mapLoadingTitle.textContent = title;
      }
      if (mapLoadingDetail) {
        mapLoadingDetail.textContent = detail;
      }
      if (mapLoading) {
        mapLoading.hidden = !active;
        mapLoading.setAttribute('aria-hidden', String(!active));
        mapLoading.dataset.variable = loadingVariable;
      }
      mapStage?.classList.toggle('map-stage--loading', active);
      mapStage?.setAttribute('aria-busy', String(active));
    },
    render(state, previousState, changedKey) {
      if (changedKey === 'cameraState') {
        return;
      }

      if (changedKey === 'viewportDomains' && !isViewportScaleActive(state)) {
        return;
      }

      for (const button of variableButtons) {
        button.classList.toggle('is-active', button.dataset.variable === state.variable);
        button.setAttribute('aria-pressed', String(button.dataset.variable === state.variable));
      }

      const activeColorScaleRadio = colorScaleGroup?.querySelector(`input[value="${state.colorScaleMode ?? 'local'}"]`);
      if (activeColorScaleRadio && !activeColorScaleRadio.checked) {
        activeColorScaleRadio.checked = true;
      }

      if (mapLoading) {
        mapLoading.dataset.variable = state.variable ?? 'temperature';
      }

      for (const button of symbolButtons) {
        const active = button.dataset.symbolMode === state.mode && button.dataset.symbolUnit === state.unit;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        const modeIcon = button.querySelector('.symbol-button__mode');
        if (modeIcon) {
          if (active) {
            const palette = paletteForVariable(state.variable);
            const mode = button.dataset.symbolMode;
            if (mode === 'pulse') {
              const existingDefs = modeIcon.querySelector('defs.palette-defs');
              const stops = palette
                .map((c, i) => `<stop offset="${(i / (palette.length - 1) * 100).toFixed(0)}%" stop-color="${c}" />`)
                .join('');
              const gradML = `<linearGradient id="sym-grad-active" x1="0" y1="1" x2="1" y2="0">${stops}</linearGradient>`;
              if (existingDefs) {
                existingDefs.innerHTML = gradML;
              } else {
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                defs.classList.add('palette-defs');
                defs.innerHTML = gradML;
                modeIcon.prepend(defs);
              }
              const line = modeIcon.querySelector('polyline');
              if (line) line.setAttribute('stroke', 'url(#sym-grad-active)');
            } else if (mode === 'shade') {
              const rects = modeIcon.querySelectorAll('rect');
              const n = rects.length;
              rects.forEach((rect, i) => {
                const t = n > 1 ? i / (n - 1) : 0.5;
                const idx = t * (palette.length - 1);
                const lo = Math.floor(idx);
                const hi = Math.min(palette.length - 1, lo + 1);
                rect.setAttribute('fill', interpolateHex(palette[lo], palette[hi], idx - lo));
              });
            } else if (mode === 'ring') {
              const circles = modeIcon.querySelectorAll('circle');
              const n = circles.length;
              circles.forEach((circle, i) => {
                const t = n > 1 ? 1 - i / (n - 1) : 0.5;
                const idx = t * (palette.length - 1);
                const lo = Math.floor(idx);
                const hi = Math.min(palette.length - 1, lo + 1);
                circle.setAttribute('stroke', interpolateHex(palette[lo], palette[hi], idx - lo));
              });
            }
          } else {
            const defs = modeIcon.querySelector('defs.palette-defs');
            if (defs) defs.remove();
            for (const el of modeIcon.querySelectorAll('polyline[stroke]')) {
              el.setAttribute('stroke', 'currentColor');
            }
            for (const el of modeIcon.querySelectorAll('rect[fill]')) {
              el.setAttribute('fill', 'currentColor');
            }
            for (const el of modeIcon.querySelectorAll('circle[stroke]')) {
              el.setAttribute('stroke', 'currentColor');
            }
          }
        }
      }

      if (symbolUnitInfo) {
        const h3Res = state.displayedH3Resolution;
        const gridDeg = state.displayedGridDegrees;
        if (state.unit === 'grid' && gridDeg != null) {
          symbolUnitInfo.textContent = `${gridDeg}°`;
        } else if (h3Res != null) {
          symbolUnitInfo.textContent = H3_CELL_WIDTH_LABELS[h3Res] ?? '';
        } else {
          symbolUnitInfo.textContent = '';
        }
      }

      for (const option of [...periodSelect.options]) {
        const value = Number(option.value);
        option.disabled = (state.mode ?? 'pulse') === 'ring' && value < 12;
      }
      periodSelect.value = String(state.periodMonths ?? 1);

      const startYear = Number(state.rangeA.start?.split('-')[0]);
      const endYear = Number(state.rangeB.start?.split('-')[0]);

      if (dragPreview) {
        paintYearRange(dragPreview.start, dragPreview.end);
      } else {
        paintYearRange(startYear, endYear);
      }

      if (symbolSizeSlider) {
        const sizePct = Math.round((state.glyphWidthScale ?? 1) * 80);
        symbolSizeSlider.value = String(Math.max(0, Math.min(100, sizePct)));
        if (symbolSizeValue) {
          symbolSizeValue.textContent = `${Math.max(0, Math.min(100, sizePct))}%`;
        }
      }

      if (symbolOpacitySlider) {
        const opacityPct = Math.round((state.symbolOpacity ?? 0.9) * 100);
        symbolOpacitySlider.value = String(opacityPct);
        if (symbolOpacityValue) {
          symbolOpacityValue.textContent = `${opacityPct}%`;
        }
      }

      if (symbolStrokeSlider) {
        const strokePct = Math.round((state.strokeOpacity ?? 1) * 100);
        symbolStrokeSlider.value = String(strokePct);
        if (symbolStrokeValue) {
          symbolStrokeValue.textContent = `${strokePct}%`;
        }
      }

      if (showCountryBorderToggle) {
        showCountryBorderToggle.checked = Boolean(state.showCountryBorder);
      }

      if (showCountryLabelToggle) {
        showCountryLabelToggle.checked = Boolean(state.showCountryLabel);
      }

      if (showCityLabelToggle) {
        showCityLabelToggle.checked = Boolean(state.showCityLabel);
      }

      timelineRoni.hidden = !timelineRoniToggle.checked;

      const hoveredCell = lookupCell(state.hoveredCell);
      const selectedCell = lookupCell(state.selectedCell);
      const candidateCell = selectedCell ?? hoveredCell;
      if (candidateCell) {
        lastPreviewCellId = candidateCell.id;
      }
      const previewCell =
        candidateCell ?? (pointerOverRightPanel ? lookupCell(lastPreviewCellId) : null) ?? defaultDetailCell();

      if (previewCell) {
        const viewportDomains = resolveViewportDomains(state);
        const summary = buildCellSummary(previewCell, metadata, state);
        const detailSeries = getAggregatedSeries(previewCell, metadata, state, summary.variable);
        const detailStats = computeSeriesStats(detailSeries);
        const anchor = previewCell === selectedCell ? state.selectedAnchor : null;
        const locationLabel = 'Location';
        const locationValue = previewCell.isGlobal
          ? escapeHtml(previewCell.label ?? 'Global average')
          : anchor
            ? formatLatLon(anchor.lat, anchor.lon)
            : formatLatLon(previewCell.lat, previewCell.lon);
        if (detailSummary) {
          detailSummary.innerHTML = `
            <div class="detail-grid detail-grid--summary">
              <div>
                <span>${locationLabel}</span>
                <strong>${locationValue}</strong>
              </div>
              <div>
                <span>Average</span>
                <strong>${formatDetailStatValue(summary.variable, detailStats.mean)}</strong>
              </div>
              <div>
                <span>Highest</span>
                <strong>${formatDetailStatValue(summary.variable, detailStats.max)}</strong>
              </div>
              <div>
                <span>Lowest</span>
                <strong>${formatDetailStatValue(summary.variable, detailStats.min)}</strong>
              </div>
            </div>
          `;
        }

        if (selectionAnnouncer && changedKey === 'selectedCell') {
          selectionAnnouncer.textContent = previewCell === selectedCell
            ? `Selected ${previewCell.isGlobal ? 'global average' : locationValue}. Average ${formatDetailStatValue(summary.variable, detailStats.mean)}.`
            : 'Selection cleared. Showing the global average.';
        }

        if (detailChart) {
          const globalValueDomains = state.colorScaleMode === 'global' ? getGlobalDomains(state, 'value') : null;
          const globalChartDomains = state.chartValueScaleMode === 'global' ? getGlobalDomains(state, 'chart') : null;
          const chart = buildDetailChart(metadata, previewCell, state, globalValueDomains, globalChartDomains, viewportDomains.value, viewportDomains.chart);
          currentDetailChartModel = chart.hoverModel;
          detailChart.innerHTML = chart.markup;
          const legend = detailChart.querySelector('[data-legend]');
          if (legend) {
            const legendDomainOverrides =
              state.colorScaleMode === 'local'
                ? { [state.variable ?? 'temperature']: chart.colorDomain }
                : state.colorScaleMode === 'viewport'
                  ? viewportDomains.value
                  : globalValueDomains;
            // Cone charts encode values by color only, so the value-axis scale does not apply.
            const isConeChart = (state.mode ?? 'pulse') === 'ring';
            legend.innerHTML = buildLegendMarkup(
              state.variable ?? 'temperature',
              cachedTrendMode,
              legendDomainOverrides,
              !isConeChart,
              state.chartValueScaleMode ?? 'local',
              isConeChart ? 'Cone charts show values by color only. Change the range with Color scale in the left panel.' : ''
            );
          }
          hideDetailChartHover();
        } else {
          currentDetailChartModel = null;
        }
      } else {
        if (detailSummary) {
          detailSummary.innerHTML = '';
        }
        if (detailChart) {
          detailChart.innerHTML = '';
        }
        currentDetailChartModel = null;
        hideDetailChartHover();
      }

      if (exportChartButton) {
        exportChartButton.disabled = !(detailChart?.querySelector('.detail-chart__svg'));
      }
    }
  };
}
