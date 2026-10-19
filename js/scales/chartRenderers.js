import { clamp, rampColor } from './climateScales.js';

function sampleSeries(series, count) {
  if (series.length <= count) {
    return series;
  }

  const samples = [];
  const stride = (series.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    const position = index * stride;
    const left = Math.floor(position);
    const right = Math.min(series.length - 1, Math.ceil(position));
    const mix = position - left;
    samples.push(series[left] + (series[right] - series[left]) * mix);
  }
  return samples;
}

export function buildLinePoints(series, domain, x, y, width, height, maxPoints = null) {
  const plotted =
    Number.isFinite(maxPoints) && maxPoints > 0
      ? sampleSeries(series, Math.max(2, Math.floor(maxPoints)))
      : series;

  return plotted
    .map((value, index) => {
      const px = x + (index / Math.max(1, plotted.length - 1)) * width;
      const normalized = clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1);
      const py = y + height - normalized * height;
      return { x: px, y: py, value };
    })
    .filter((point) => Number.isFinite(point.y));
}

export function buildLinePath(series, domain, x, y, width, height) {
  const points = buildLinePoints(series, domain, x, y, width, height, Math.max(18, Math.floor(width)));
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
}

export function buildBarRects(series, domain, x, y, width, height, palette, colorDomain = domain) {
  const zeroY = zeroLineY(domain, y, height);
  const gap = 0;
  const barWidth = width / Math.max(1, series.length);

  return series
    .map((value, index) => {
      const normalized = clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1);
      const py = y + height - normalized * height;
      const left = x + index * (barWidth + gap);
      const top = Math.min(py, zeroY);
      const barHeight = Math.max(1.1, Math.abs(zeroY - py));
      const fill = rampColor(value, colorDomain, palette);
      return `<rect data-bar-index="${index}" x="${left.toFixed(2)}" y="${top.toFixed(2)}" width="${Math.max(0.45, barWidth).toFixed(2)}" height="${barHeight.toFixed(2)}" fill="${fill}" fill-opacity="0.95" shape-rendering="crispEdges" />`;
    })
    .join('');
}

export function zeroLineY(domain, top, height) {
  const normalized = clamp((0 - domain[0]) / (domain[1] - domain[0]), 0, 1);
  return top + height - normalized * height;
}

function polarToCartesian(cx, cy, radius, angle) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

function describeRingSlice(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M${outerStart.x.toFixed(2)},${outerStart.y.toFixed(2)}`,
    `A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(2)},${outerEnd.y.toFixed(2)}`,
    `L${innerEnd.x.toFixed(2)},${innerEnd.y.toFixed(2)}`,
    `A${innerRadius.toFixed(2)},${innerRadius.toFixed(2)} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(2)},${innerStart.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

export function buildBucketRingSlices(
  series,
  domain,
  cx,
  cy,
  outerRadius,
  innerRadius,
  palette,
  segmentsPerRing = 12,
  colorDomain = domain
) {
  if (!series.length) {
    return '';
  }

  const ringCount = Math.max(1, series.length);
  const ringThickness = (outerRadius - innerRadius) / ringCount;
  const startOffset = -Math.PI / 2;

  return series
    .map((value, index) => {
      const segmentValues = Array.isArray(value) ? value : [value];
      const segmentCount = Math.max(1, segmentValues.length);
      const ringInnerRadius = innerRadius + index * ringThickness;
      const ringOuterRadius = index === ringCount - 1 ? outerRadius : ringInnerRadius + ringThickness;

      return Array.from({ length: segmentCount }, (_, sliceIndex) => {
        const segmentValue = segmentValues[sliceIndex] ?? segmentValues[segmentValues.length - 1] ?? 0;
        if (!Number.isFinite(segmentValue)) {
          return '';
        }
        const fill = rampColor(segmentValue, colorDomain, palette);
        const segmentSliceAngle = (Math.PI * 2) / segmentCount;
        const startAngle = startOffset + sliceIndex * segmentSliceAngle;
        const endAngle = startAngle + segmentSliceAngle;
        return `<path data-ring-index="${index}" d="${describeRingSlice(cx, cy, ringInnerRadius, ringOuterRadius, startAngle, endAngle)}" fill="${fill}" />`;
      }).join('');
    })
    .join('');
}
