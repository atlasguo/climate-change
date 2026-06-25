import { buildCellSummary, getAggregatedSeries, getBucketedSeries, getCommittedValueDomains, getSeriesColorDomain, isTrendMode } from '../state/selectors.js';
import {
  buildPaletteGradient,
  buildLegendMarkup,
  getModeLabel,
  getVariableLabel,
  paletteForVariable,
  rampColor,
  RONI_PALETTE,
  summarizeValue
} from '../scales/climateScales.js';
import { buildBarRects, buildBucketRingSlices, buildLinePoints, zeroLineY } from '../scales/chartRenderers.js';



function formatCoordinate(value, axis) {
  if (!Number.isFinite(value)) {
    return axis === 'lat' ? '0.00°N' : '0.00°E';
  }
  const absolute = Math.abs(value).toFixed(2);
  const suffix = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${absolute}°${suffix}`;
}

function formatLatLon(lat, lon) {
  return `${formatCoordinate(lat, 'lat')}, ${formatCoordinate(lon, 'lon')}`;
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
        <text x="${textX}" y="${(y + 3).toFixed(2)}" fill="#8d9399" font-size="10" text-anchor="${textAnchor}">${formatter(value)}</text>
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
  return `<text x="${x}" y="${y}" fill="#8f969c" font-size="9" letter-spacing="0.12em" text-anchor="${anchor}">${label}</text>`;
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
  const rangeBuckets = buildRangeBuckets(metadata, state);
  const domains = {
    temperature: {
      anomaly: [Infinity, -Infinity],
      raw: [Infinity, -Infinity]
    },
    precipitation: {
      anomaly: [Infinity, -Infinity],
      raw: [Infinity, -Infinity]
    }
  };

  for (const cell of cells) {
    for (const variable of ['temperature', 'precipitation']) {
      const anomalySeries = getAggregatedSeries(cell, metadata, state, variable);
      const rawSource = variable === 'temperature' ? buildTemperatureRawSeries(metadata, cell) : cell.precipRawSeries;
      const rawSeries = aggregateBucketSeries(rawSource, metadata, rangeBuckets);

      for (const value of anomalySeries) {
        if (Number.isFinite(value)) {
          domains[variable].anomaly[0] = Math.min(domains[variable].anomaly[0], value);
          domains[variable].anomaly[1] = Math.max(domains[variable].anomaly[1], value);
        }
      }

      for (const value of rawSeries) {
        if (Number.isFinite(value)) {
          domains[variable].raw[0] = Math.min(domains[variable].raw[0], value);
          domains[variable].raw[1] = Math.max(domains[variable].raw[1], value);
        }
      }
    }
  }

  return {
    temperature: {
      anomaly: buildMinMaxDomain(domains.temperature.anomaly, { includeZero: false, minimumSpan: 0.6 }),
      raw: buildMinMaxDomain(domains.temperature.raw, { includeZero: false, minimumSpan: 2 })
    },
    precipitation: {
      anomaly: buildMinMaxDomain(domains.precipitation.anomaly, { includeZero: true, minimumSpan: 4 }),
      raw: buildMinMaxDomain(domains.precipitation.raw, { includeZero: true, minimumSpan: 10 })
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
        <text x="${x.toFixed(2)}" y="${y + 18}" fill="#8d9399" font-size="10" text-anchor="middle">${year}</text>
      `;
    })
    .join('');
}

function buildXAxisBaseline(left, right, y) {
  return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#43484d" stroke-width="1" />`;
}

function buildTimelineRoniMarkup(monthLabels, roniPoints) {
  const width = 1000;
  const height = 76;
  const baselineY = 38;
  const amplitude = 28;

  const domain = [-3, 3];
  const points = roniPoints
    .map((point) => {
      const index = monthLabels.indexOf(point.monthLabel);
      if (index === -1) {
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
  const positiveColor = '#ffe43b';
  const negativeColor = '#b15bff';

  return `
    <svg class="timeline-axis__oni-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="RONI index chart">
      <defs>
        <linearGradient id="${areaAboveGradientId}" x1="0" y1="${baselineY}" x2="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.5" />
          <stop offset="18%" stop-color="#7e6a18" stop-opacity="0.42" />
          <stop offset="100%" stop-color="#fff04a" stop-opacity="1" />
        </linearGradient>
        <linearGradient id="${areaBelowGradientId}" x1="0" y1="${baselineY}" x2="0" y2="${height}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.5" />
          <stop offset="18%" stop-color="#4d2e77" stop-opacity="0.44" />
          <stop offset="100%" stop-color="#d65cff" stop-opacity="1" />
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
  const startIndex = Math.max(0, metadata.monthLabels.indexOf(state.rangeA.start));
  const endIndex = Math.max(startIndex, metadata.monthLabels.indexOf(state.rangeB.start));
  const periodMonths = state.periodMonths ?? 1;
  const buckets = [];

  for (let index = startIndex; index <= endIndex; index += periodMonths) {
    const bucketEnd = Math.min(endIndex, index + periodMonths - 1);
    buckets.push({
      start: metadata.monthLabels[index],
      end: metadata.monthLabels[bucketEnd]
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
    return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="#b0b6bc" font-size="10" text-anchor="middle" dominant-baseline="middle">${MONTH_ABBREVIATIONS[monthIndex]}</text>`;
  }).join('');
}

function formatDetailHoverValue(variable, value) {
  if (variable === 'temperature') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)} ℃ anomaly`;
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`;
}

function formatDetailHoverRawValue(variable, value) {
  if (variable === 'temperature') {
    return `${value.toFixed(2)} ℃`;
  }
  return `${value.toFixed(1)} mm/month`;
}

function formatDetailStatValue(variable, value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (variable === 'temperature') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)} ℃`;
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`;
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

function buildTemperatureRawSeries(metadata, cell) {
  return metadata.monthLabels.map((label, index) => {
    const month = monthNumberFromLabel(label);
    const baselineIndex = month == null ? index % 12 : month - 1;
    const baseline = cell.tempBaselineMonthly?.[baselineIndex] ?? 0;
    return (cell.tempSeries[index] ?? 0) + baseline;
  });
}

function aggregateBucketSeries(source, metadata, buckets) {
  return buckets.map((bucket) => {
    const startIndex = Math.max(0, metadata.monthLabels.indexOf(bucket.start));
    const endIndex = Math.max(startIndex, metadata.monthLabels.indexOf(bucket.end));
    let total = 0;
    let count = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      total += source[index] ?? 0;
      count += 1;
    }
    return count ? total / count : 0;
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
    label: 'Climate',
    text: 'ERA5, via Climate Data Store',
    url: 'https://cds.climate.copernicus.eu/',
    linkLabel: 'CDS'
  }
];

const REFERENCE_METADATA_SOURCES = [
  {
    label: 'Reference Map',
    text: 'Global Countries and Cities',
    url: 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/',
    linkLabel: 'Natural Earth'
  }
];

function buildMetadataSourceLine(source) {
  if (!source || (!source.label && !source.text)) {
    return '';
  }
  const text = escapeHtml(source.text ?? '');
  const rawUrl = typeof source.url === 'string' ? source.url : '';
  const url = rawUrl ? escapeHtml(rawUrl) : '';

  try {
    if (rawUrl.includes('cds.climate.copernicus.eu')) {
      return `ERA5 (Monthly) - <a href="${url}" target="_blank" rel="noreferrer">Climate Data Store</a>`;
    }
    if (rawUrl.includes('cpc.ncep.noaa.gov')) {
      return `Relative Oceanic Nino Index - <a href="${url}" target="_blank" rel="noreferrer">NOAA CPC</a>`;
    }
  } catch (e) {
    // fall through to default handling
  }

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
  const valueMarkup = url ? `${text} - <a href="${url}" target="_blank" rel="noreferrer">${linkLabel}</a>` : text;
  return valueMarkup;
}

function buildMetadataSourcesMarkup(sources) {
  const baseSources = Array.isArray(sources) && sources.length ? sources : DEFAULT_METADATA_SOURCES;
  const resolvedSources = [...baseSources, ...REFERENCE_METADATA_SOURCES];
  return resolvedSources.map(buildMetadataSourceLine).filter(Boolean).join('<br>');
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

function buildDetailChart(metadata, cell, state, valueDomains, committedChartDomains) {
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
  const aIndex = metadata.monthLabels.indexOf(state.rangeA.start);
  const bIndex = metadata.monthLabels.indexOf(state.rangeB.start);
  const startYear = state.rangeA.start?.split('-')[0] ?? '';
  const endYear = state.rangeB.start?.split('-')[0] ?? '';
  const chartValueScaleMode = state.chartValueScaleMode ?? 'local';
  const colorDomain = getSeriesColorDomain(cell, metadata, state, variable, valueDomains);
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
  const rawSeries = aggregateBucketSeries(rawSource, metadata, rangeBuckets);
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
      : localAnomalyDomain;
  const rawDomain = localRawDomain;
  const anomalyGuideTicks = buildAnomalyAxisTicks(anomalyDomain);
  const rawGuideTicks = variable === 'temperature' ? remapTicksToDomain(anomalyGuideTicks, anomalyDomain, rawDomain) : buildRawAxisTicks(rawDomain);
  const anomalyTicks = filterTicksByPixelGap(anomalyGuideTicks, anomalyDomain, chartHeight, 30);
  const rawTicks =
    variable === 'temperature'
      ? remapTicksToDomain(anomalyTicks, anomalyDomain, rawDomain)
      : filterTicksByPixelGap(rawGuideTicks, rawDomain, chartHeight, 30);
  const formatAnomalyTick = (value) => (variable === 'temperature' ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}` : `${Math.round(value)}`);
  const formatRawTick = (value) => (variable === 'temperature' ? `${value.toFixed(0)}` : `${Math.round(value)}`);
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
      ${buildAxisTitle(leftPad, chartTop - 14, variableLabel.toUpperCase(), 'start')}
      ${buildAxisTitle(width - rightPad, chartTop - 14, 'ANOMALY', 'end')}
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
      ${buildAxisTitle(leftPad, chartTop - 14, variableLabel.toUpperCase(), 'start')}
      ${buildAxisTitle(width - rightPad, chartTop - 14, 'ANOMALY', 'end')}
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
    const firstBucketStartMonth = monthNumberFromLabel(rangeBuckets[0]?.start) ?? 1;
    hoverModel = {
      width,
      height,
      ...buildRingHoverModel(ringLabels, ringSeries, ringCx, ringCy + 6, ringOuterRadius, ringInnerRadius, 12),
      rawValues: rawSeries
    };

    chartMarkup = `
      <text x="16" y="22" fill="#9fa6ad" font-size="10" letter-spacing="0.08em" text-anchor="start">${escapeHtml(variableLabel.toUpperCase())}</text>
      <g transform="translate(0, 6)">
        ${buildBucketRingSlices(bucketedSeries, anomalyDomain, ringCx, ringCy, ringOuterRadius, ringInnerRadius, palette, 12, colorDomain)}
      </g>
      ${buildRingMonthLabels(ringCx, ringCy + 6, ringOuterRadius + 18, firstBucketStartMonth)}
      <circle cx="${ringCx}" cy="${ringCy + 6}" r="${ringInnerRadius - 2}" fill="#121213" />
      <text x="${ringCx}" y="${(ringCy + 10).toFixed(2)}" fill="#e4e8ea" font-size="12" text-anchor="middle">${escapeHtml(startYear)}</text>
      <text x="${(width - 20).toFixed(2)}" y="${(ringCy + 10).toFixed(2)}" fill="#cfd3d6" font-size="12" text-anchor="end">${escapeHtml(endYear)}</text>
    `;
  }

  return {
    hoverModel,
    colorDomain,
    markup: `
      <div class="detail-chart__frame" data-detail-chart-frame>
        <svg class="detail-chart__svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Expanded ${modeLabel} chart">
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

export function createUI(root, store, metadata, cells, rawCells, roniPoints) {
  const mapStage = root.querySelector('.map-stage');
  const mapLoading = root.querySelector('[data-map-loading]');
  const mapLoadingTitle = root.querySelector('[data-map-loading-title]');
  const mapLoadingDetail = root.querySelector('[data-map-loading-detail]');
  const baselineRange = root.querySelector('[data-bind="baseline-range"]');
  const metaDatasource = root.querySelector('[data-bind="meta-datasource"]');
  const metaCopyright = root.querySelector('[data-bind="meta-copyright"]');
  const selectionState = root.querySelector('[data-bind="selection-state"]');
  const detailSummary = root.querySelector('[data-detail-summary]');
  const detailChart = root.querySelector('[data-detail-chart]');
  const timelineSelection = root.querySelector('[data-timeline-selection]');
  const timelineRuler = root.querySelector('[data-timeline-ruler]');
  const timelineRoni = root.querySelector('[data-timeline-oni]');
  const timelineRoniToggle = root.querySelector('[data-timeline-oni-toggle]');
  const periodSelect = root.querySelector('[data-period-select]');
  const tooltip = root.querySelector('[data-tooltip]');
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
  const rangeSliders = [...root.querySelectorAll('[data-range]')];
  const rangeStepButtons = [...root.querySelectorAll('[data-range-step]')];
  const mobileToggleButtons = [...root.querySelectorAll('[data-mobile-toggle]')];
  const rangeInputs = {
    a: { year: root.querySelector('[data-range-input="a-year"]') },
    b: { year: root.querySelector('[data-range-input="b-year"]') }
  };
  let currentDetailChartModel = null;
  const detailCellLookup = new Map([...cells, ...rawCells].map((cell) => [cell.id, cell]));

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
  if (baselineRange) {
    baselineRange.textContent = `${metadata.baselineStart} to ${metadata.baselineEnd}`;
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
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.matches('[data-legend-color-scale]')) {
      store.setColorScaleMode(target.checked ? 'global' : 'local');
      return;
    }
    if (target.matches('[data-chart-value-scale]')) {
      store.setChartValueScaleMode(target.checked ? 'global' : 'local');
    }
  });

  const tickItems = [];
  for (const label of monthLabels) {
    const [year, month] = label.split('-').map(Number);
    if (month === 1) {
      tickItems.push({
        label: year % 5 === 0 ? String(year) : '',
        annual: true,
        major: year % 10 === 0,
        medium: year % 5 === 0,
        ratio: monthLabels.indexOf(label) / Math.max(1, monthLabels.length)
      });
    }
  }

  timelineRuler.innerHTML = tickItems
    .map(
      (tick) =>
        `<span class="timeline-axis__tick${tick.annual ? ' is-annual' : ''}${tick.medium ? ' is-medium' : ''}${tick.major ? ' is-major' : ''}" style="left:${(tick.ratio * 100).toFixed(3)}%"><i></i>${tick.label ? `<em>${tick.label}</em>` : ''}</span>`
    )
    .join('');

  timelineRoni.innerHTML = buildTimelineRoniMarkup(monthLabels, roniPoints);
  timelineRoniToggle.addEventListener('change', () => {
    timelineRoni.hidden = !timelineRoniToggle.checked;
  });
  periodSelect.addEventListener('change', () => {
    store.setPeriodMonths(Number(periodSelect.value));
  });

  for (const input of rangeSliders) {
    input.min = 0;
    input.max = monthLabels.length;
    input.step = 12;
    input.addEventListener('pointerdown', () => {
      for (const slider of rangeSliders) {
        slider.classList.toggle('is-active', slider === input);
      }
    });
    input.addEventListener('input', () => {
      const currentState = store.getState();
      let aValue = monthLabels.indexOf(currentState.rangeA.start);
      let bValue = monthLabels.indexOf(currentState.rangeB.start) + 1;

      if (input.dataset.range === 'a-point') {
        aValue = Number(input.value);
      }
      if (input.dataset.range === 'b-point') {
        bValue = Number(input.value);
      }

      let aIndex = aValue;
      let bIndex = bValue - 1;

      aIndex = Math.min(aIndex, bIndex - 1);
      bIndex = Math.max(bIndex, aIndex + 1);

      store.setRanges(
        { start: monthLabels[aIndex], end: monthLabels[aIndex] },
        { start: monthLabels[bIndex], end: monthLabels[bIndex] }
      );
    });
  }

  function setRangeIndexes(aIndex, bIndex) {
    const nextA = Math.max(0, Math.min(aIndex, monthLabels.length - 2));
    const nextB = Math.min(monthLabels.length - 1, Math.max(bIndex, nextA + 1));
    store.setRanges(
      { start: monthLabels[nextA], end: monthLabels[nextA] },
      { start: monthLabels[nextB], end: monthLabels[nextB] }
    );
  }

  for (const [key, fields] of Object.entries(rangeInputs)) {
    const commit = () => {
      const currentState = store.getState();
      const currentLabel = key === 'a' ? currentState.rangeA.start : currentState.rangeB.start;
      const currentMonth = currentLabel.split('-')[1] ?? '01';
      const yearNum = Number(fields.year.value?.trim());
      if (!Number.isInteger(yearNum)) {
        fields.year.value = currentLabel.split('-')[0];
        return;
      }
      const candidate = `${yearNum}-${currentMonth}`;
      const parsedIndex = monthLabels.indexOf(candidate);
      if (parsedIndex === -1) {
        fields.year.value = currentLabel.split('-')[0];
        return;
      }
      const aIndex = monthLabels.indexOf(currentState.rangeA.start);
      const bIndex = monthLabels.indexOf(currentState.rangeB.start);
      setRangeIndexes(key === 'a' ? parsedIndex : aIndex, key === 'b' ? parsedIndex : bIndex);
    };

    const commitOnInput = () => {
      const currentState = store.getState();
      const currentLabel = key === 'a' ? currentState.rangeA.start : currentState.rangeB.start;
      const currentMonth = currentLabel.split('-')[1] ?? '01';
      const yearNum = Number(fields.year.value?.trim());
      if (!Number.isInteger(yearNum)) {
        return;
      }
      const candidate = `${yearNum}-${currentMonth}`;
      const parsedIndex = monthLabels.indexOf(candidate);
      if (parsedIndex === -1) {
        return;
      }
      const aIndex = monthLabels.indexOf(currentState.rangeA.start);
      const bIndex = monthLabels.indexOf(currentState.rangeB.start);
      setRangeIndexes(key === 'a' ? parsedIndex : aIndex, key === 'b' ? parsedIndex : bIndex);
    };

    fields.year.addEventListener('input', commitOnInput);

    fields.year.addEventListener('blur', commit);
    fields.year.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        fields.year.blur();
      }
    });
  }

  for (const button of rangeStepButtons) {
    button.addEventListener('click', () => {
      const [target, rawDelta] = button.dataset.rangeStep.split(':');
      const delta = Number(rawDelta);
      const [rangeKey, unit] = target.split('-');
      const currentState = store.getState();
      const aIndex = monthLabels.indexOf(currentState.rangeA.start);
      const bIndex = monthLabels.indexOf(currentState.rangeB.start);
      const step = unit === 'year' ? delta * 12 : delta;
      setRangeIndexes(rangeKey === 'a' ? aIndex + step : aIndex, rangeKey === 'b' ? bIndex + step : bIndex);
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
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

  async function exportMapPng() {
    const canvas = root.querySelector('#map canvas.maplibregl-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    if (canvas.toBlob) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        downloadBlob(blob, buildExportFilename('climate-map'));
        return;
      }
    }

    downloadDataUrl(canvas.toDataURL('image/png'), buildExportFilename('climate-map'));
  }

  async function exportChartPng() {
    const svg = detailChart?.querySelector('.detail-chart__svg');
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const serializer = new XMLSerializer();
    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const svgBlob = new Blob([serializer.serializeToString(clonedSvg)], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = svgUrl;
      });

      const viewBox = svg.viewBox.baseVal;
      const width = viewBox?.width ? Math.round(viewBox.width) : 428;
      const height = viewBox?.height ? Math.round(viewBox.height) : 388;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }
      context.drawImage(image, 0, 0, width, height);

      if (canvas.toBlob) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          downloadBlob(blob, buildExportFilename('climate-chart'));
          return;
        }
      }

      downloadDataUrl(canvas.toDataURL('image/png'), buildExportFilename('climate-chart'));
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  exportMapButton?.addEventListener('click', () => {
    void exportMapPng();
  });

  exportChartButton?.addEventListener('click', () => {
    void exportChartPng();
  });

  let tooltipCellId = null;

  function renderTooltip(state, forceContentRebuild = false) {
    if (!state.hoveredCell || !state.hoveredPosition) {
      tooltip.hidden = true;
      tooltipCellId = null;
      return;
    }

    const hoveredCell = detailCellLookup.get(state.hoveredCell);
    if (!hoveredCell) {
      tooltip.hidden = true;
      tooltipCellId = null;
      return;
    }

    tooltip.hidden = false;
    tooltip.style.transform = `translate(${state.hoveredPosition.x + 12}px, ${state.hoveredPosition.y + 12}px)`;

    if (!forceContentRebuild && tooltipCellId === state.hoveredCell) {
      return;
    }
    tooltipCellId = state.hoveredCell;

    const summary = buildCellSummary(hoveredCell, metadata, state, cachedValueDomains);
    const variableLabel = getVariableLabel(state.variable ?? 'temperature');
    tooltip.innerHTML = `
      <strong>${formatLatLon(summary.lat, summary.lon)}</strong>
      <span>${variableLabel} A: ${summarizeValue(state.variable ?? 'temperature', summary.variable === 'temperature' ? summary.tempA : summary.precipA, false)}</span>
      <span>${variableLabel} B: ${summarizeValue(state.variable ?? 'temperature', summary.variable === 'temperature' ? summary.tempB : summary.precipB, false)}</span>
    `;
  }

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

  let cachedValueDomains = getCommittedValueDomains(cells, metadata, store.getState());
  let cachedChartValueDomains = buildCommittedChartDomains(cells, metadata, store.getState());
  let cachedTrendMode = isTrendMode(metadata, store.getState());

  function refreshCommittedMetrics(state) {
    cachedValueDomains = getCommittedValueDomains(cells, metadata, state);
    cachedChartValueDomains = buildCommittedChartDomains(cells, metadata, state);
    cachedTrendMode = isTrendMode(metadata, state);
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

      if (
        changedKey === 'init' ||
        changedKey === 'mode' ||
        changedKey === 'symbol' ||
        changedKey === 'variable' ||
        changedKey === 'ranges' ||
        changedKey === 'periodMonths'
      ) {
        refreshCommittedMetrics(state);
      }

      for (const button of variableButtons) {
        button.classList.toggle('is-active', button.dataset.variable === state.variable);
      }

      if (mapLoading) {
        mapLoading.dataset.variable = state.variable ?? 'temperature';
      }

      for (const button of symbolButtons) {
        button.classList.toggle(
          'is-active',
          button.dataset.symbolMode === state.mode && button.dataset.symbolUnit === state.unit
        );
      }

      for (const option of [...periodSelect.options]) {
        const value = Number(option.value);
        option.disabled = (state.mode ?? 'pulse') === 'ring' && value < 12;
      }
      periodSelect.value = String(state.periodMonths ?? 1);

      const minYear = 1940;
      const maxYear = 2025;
      const startYear = Number(state.rangeA.start?.split('-')[0]);
      const endYear = Number(state.rangeB.start?.split('-')[0]);

      for (const button of rangeStepButtons) {
        const [target, rawDelta] = button.dataset.rangeStep.split(':');
        const delta = Number(rawDelta);
        const [rangeKey, unit] = target.split('-');
        const isYearStep = unit === 'year';

        let disabled = false;
        if (isYearStep && rangeKey === 'a') {
          disabled = delta < 0 ? startYear <= minYear : startYear + 1 >= endYear;
        } else if (isYearStep && rangeKey === 'b') {
          disabled = delta < 0 ? endYear - 1 <= startYear : endYear >= maxYear;
        }

        button.disabled = disabled;
        button.classList.toggle('is-disabled', disabled);
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

      rangeInputs.a.year.value = state.rangeA.start.split('-')[0];
      rangeInputs.b.year.value = state.rangeB.start.split('-')[0];

      const inputState = {
        'a-point': monthLabels.indexOf(state.rangeA.start),
        'b-point': monthLabels.indexOf(state.rangeB.start) + 1
      };
      const aRatio = inputState['a-point'] / Math.max(1, monthLabels.length);
      const bRatio = inputState['b-point'] / Math.max(1, monthLabels.length);
      timelineSelection.style.left = `${(aRatio * 100).toFixed(3)}%`;
      timelineSelection.style.width = `${Math.max(0, (bRatio - aRatio) * 100).toFixed(3)}%`;
      timelineRoni.hidden = !timelineRoniToggle.checked;
      const midpoint = ((aRatio + bRatio) / 2) * 100;

      for (const input of rangeSliders) {
        input.value = inputState[input.dataset.range];
        const isStart = input.dataset.range === 'a-point';
        const shouldRaise = isStart
          ? inputState['a-point'] >= inputState['b-point'] - 24
          : inputState['b-point'] <= inputState['a-point'] + 24;
        input.classList.toggle('is-priority', shouldRaise);
        input.style.clipPath = isStart
          ? `inset(0 ${Math.max(0, 100 - midpoint).toFixed(3)}% 0 0)`
          : `inset(0 0 0 ${Math.max(0, midpoint).toFixed(3)}%)`;
      }

      const hoveredCell = detailCellLookup.get(state.hoveredCell) ?? null;
      const selectedCell = detailCellLookup.get(state.selectedCell) ?? null;
      const locked = Boolean(selectedCell);
      const previewCell = selectedCell ?? hoveredCell ?? cells[0] ?? null;

      if (previewCell) {
        const summary = buildCellSummary(previewCell, metadata, state, cachedValueDomains);
        const detailSeries = getAggregatedSeries(previewCell, metadata, state, summary.variable);
        const detailStats = computeSeriesStats(detailSeries);
        if (selectionState) {
          selectionState.textContent = locked
            ? `Locked / ${formatLatLon(summary.lat, summary.lon)}`
            : hoveredCell
              ? `Hover / ${formatLatLon(summary.lat, summary.lon)}`
              : `Preview / ${formatLatLon(summary.lat, summary.lon)}`;
        }
        if (detailSummary) {
          detailSummary.innerHTML = `
            <div class="detail-grid detail-grid--summary">
              <div>
                <span>Center Coordinates</span>
                <strong>${formatLatLon(summary.lat, summary.lon)}</strong>
              </div>
              <div>
                <span>Average</span>
                <strong>${formatDetailStatValue(summary.variable, detailStats.mean)}</strong>
              </div>
              <div>
                <span>Highest Value</span>
                <strong>${formatDetailStatValue(summary.variable, detailStats.max)}</strong>
              </div>
              <div>
                <span>Lowest Value</span>
                <strong>${formatDetailStatValue(summary.variable, detailStats.min)}</strong>
              </div>
            </div>
          `;
        }

        if (detailChart) {
          const chart = buildDetailChart(metadata, previewCell, state, cachedValueDomains, cachedChartValueDomains);
          currentDetailChartModel = chart.hoverModel;
          detailChart.innerHTML = chart.markup;
          const legend = detailChart.querySelector('[data-legend]');
          if (legend) {
            const legendDomainOverrides =
              state.colorScaleMode === 'local'
                ? { [state.variable ?? 'temperature']: chart.colorDomain }
                : cachedValueDomains;
            legend.innerHTML = buildLegendMarkup(
              state.variable ?? 'temperature',
              cachedTrendMode,
              legendDomainOverrides,
              state.colorScaleMode ?? 'local',
              true,
              state.chartValueScaleMode ?? 'local'
            );
          }
          hideDetailChartHover();
        } else {
          currentDetailChartModel = null;
        }
      } else {
        if (selectionState) {
          selectionState.textContent = '';
        }
        if (detailSummary) {
          detailSummary.innerHTML = '';
        }
        if (detailChart) {
          detailChart.innerHTML = '';
        }
        currentDetailChartModel = null;
        hideDetailChartHover();
      }

      renderTooltip(state);

      if (exportChartButton) {
        exportChartButton.disabled = !(detailChart?.querySelector('.detail-chart__svg'));
      }
    }
  };
}
