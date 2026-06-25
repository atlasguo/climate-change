import { cellToBoundary, cellToCenterChild, cellToLatLng, cellToParent, getResolution, isValidCell } from 'h3-js';
import { getAggregatedSeries, getBucketedSeries, getSeriesColorDomain } from '../state/selectors.js';
import { paletteForVariable, rampColor } from '../scales/climateScales.js';
import { buildBarRects as buildBarRectsSvg, buildBucketRingSlices, buildLinePath, zeroLineY as chartZeroLineY } from '../scales/chartRenderers.js';

const TEMP_PLOT_DOMAIN = [-2.6, 2.6];
const PRECIP_PLOT_DOMAIN = [-90, 90];
const RENDER_CENTER_DOTS_ONLY = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function latLonToCartesian(lat, lon) {
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);
  const cosLat = Math.cos(latRad);
  return {
    x: cosLat * Math.cos(lonRad),
    y: cosLat * Math.sin(lonRad),
    z: Math.sin(latRad)
  };
}

function cartesianToLatLon(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  const x = vector.x / length;
  const y = vector.y / length;
  const z = vector.z / length;
  return {
    lat: toDegrees(Math.asin(clamp(z, -1, 1))),
    lon: toDegrees(Math.atan2(y, x))
  };
}

function sampleSphericalEdge(start, end, segments = 8) {
  const a = latLonToCartesian(start.lat, start.lon);
  const b = latLonToCartesian(end.lat, end.lon);
  const omega = Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1));
  const sinOmega = Math.sin(omega);
  const samples = [];

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    if (sinOmega < 1e-6) {
      samples.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lon: interpolateLongitude(start.lon, end.lon, t)
      });
      continue;
    }

    const weightA = Math.sin((1 - t) * omega) / sinOmega;
    const weightB = Math.sin(t * omega) / sinOmega;
    samples.push(
      cartesianToLatLon({
        x: a.x * weightA + b.x * weightB,
        y: a.y * weightA + b.y * weightB,
        z: a.z * weightA + b.z * weightB
      })
    );
  }

  return samples;
}

function angularDistance(a, b) {
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const cosine =
    Math.sin(lat1) * Math.sin(lat2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2);
  return Math.acos(clamp(cosine, -1, 1));
}

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

function buildPolylinePoints(series, domain, x, y, width, height) {
  const sampled = sampleSeries(series, Math.max(18, Math.floor(width)));
  return sampled
    .map((value, index) => {
      const px = x + (index / Math.max(1, sampled.length - 1)) * width;
      const normalized = clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1);
      const py = y + height - normalized * height;
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ');
}

function buildGradientStops(series, colorDomain, palette) {
  const sampled = sampleSeries(series, 24);
  return sampled
    .map((value, index) => {
      const offset = (index / Math.max(1, sampled.length - 1)) * 100;
      return `<stop offset="${offset}%" stop-color="${rampColor(value, colorDomain, palette)}" />`;
    })
    .join('');
}

function buildGlyphMarkup(record, metadata, state, glyphWidth, glyphHeight, valueDomains) {
  const mode = state.mode ?? 'pulse';
  const variable = state.variable ?? 'temperature';
  const padX = Math.max(7, glyphWidth * 0.16);
  const padY = Math.max(6, glyphHeight * 0.12);
  const innerWidth = glyphWidth - padX * 2;
  const trackHeight = Math.max(8, glyphHeight - padY * 2 - 6);
  const chartTop = padY + 3;
  const visibleSeries = getAggregatedSeries(record, metadata, state, variable);
  const bucketedSeries = getBucketedSeries(record, metadata, state, variable);
  const gradientId = `${variable}-${record.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const geometryDomain = valueDomains[variable];
  const colorDomain = getSeriesColorDomain(record, metadata, state, variable, valueDomains);
  const palette = paletteForVariable(variable);
  const ringRadius = Math.min(innerWidth, trackHeight) * 0.46;
  const ringInnerRadius = Math.max(2, ringRadius * 0.08);
  const parts = [];

  if (mode === 'pulse') {
    const path = buildLinePath(visibleSeries, geometryDomain, padX, chartTop, innerWidth, trackHeight);
    parts.push(`
      <line
        x1="${padX}"
        x2="${glyphWidth - padX}"
        y1="${chartZeroLineY(geometryDomain, chartTop, trackHeight).toFixed(2)}"
        y2="${chartZeroLineY(geometryDomain, chartTop, trackHeight).toFixed(2)}"
        stroke="#6d7278"
        stroke-width="0.75"
        stroke-opacity="0.55"
      />
      <path d="${path}" fill="none" stroke="url(#${gradientId})" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    `);
  } else if (mode === 'shade') {
    parts.push(`
      <line
        x1="${padX}"
        x2="${glyphWidth - padX}"
        y1="${chartZeroLineY(geometryDomain, chartTop, trackHeight).toFixed(2)}"
        y2="${chartZeroLineY(geometryDomain, chartTop, trackHeight).toFixed(2)}"
        stroke="#6d7278"
        stroke-width="0.75"
        stroke-opacity="0.55"
      />
      ${buildBarRectsSvg(visibleSeries, geometryDomain, padX, chartTop, innerWidth, trackHeight, palette, colorDomain)}
    `);
  } else {
    const centerX = glyphWidth / 2;
    const centerY = glyphHeight / 2 + 1;
    parts.push(`
      ${buildBucketRingSlices(bucketedSeries, geometryDomain, centerX, centerY, ringRadius, ringInnerRadius, palette, 12, colorDomain)}
      <circle cx="${centerX}" cy="${centerY}" r="${Math.max(4, ringInnerRadius - 2).toFixed(2)}" fill="#111316" />
    `);
  }

  return `
    <svg viewBox="0 0 ${glyphWidth} ${glyphHeight}" class="glyph-card__svg" aria-hidden="true">
      <defs>
        <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
          ${buildGradientStops(visibleSeries, colorDomain, palette)}
        </linearGradient>
      </defs>
      ${parts.join('')}
    </svg>
  `;
}

function sizeForDensity(level, state) {
  const base = level === 'low' ? 72 : level === 'medium' ? 88 : 100;
  return {
    width: Math.round(base * state.glyphWidthScale),
    height: Math.round(base * state.glyphHeightScale)
  };
}

function getCandidateLimit(level, interactionPhase) {
  return Infinity;
}

function buildLayoutKey(width, height, glyphWidth, glyphHeight, densityLevel, interactionPhase) {
  return [width, height, glyphWidth, glyphHeight, densityLevel, interactionPhase].join('|');
}

function buildRowOrder(rowCount) {
  const center = (rowCount - 1) / 2;
  return Array.from({ length: rowCount }, (_, index) => index).sort((a, b) => {
    const distanceA = Math.abs(a - center);
    const distanceB = Math.abs(b - center);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }
    return a - b;
  });
}

function createGridSlots(viewportWidth, viewportHeight, glyphWidth, glyphHeight, densityLevel, interactionPhase) {
  const gapX =
    interactionPhase === 'idle'
      ? Math.max(16, Math.round(glyphWidth * (densityLevel === 'high' ? 0.34 : 0.42)))
      : Math.max(14, Math.round(glyphWidth * (densityLevel === 'high' ? 0.28 : 0.36)));
  const gapY =
    interactionPhase === 'idle'
      ? Math.max(14, Math.round(glyphHeight * (densityLevel === 'high' ? 0.2 : 0.24)))
      : Math.max(12, Math.round(glyphHeight * (densityLevel === 'high' ? 0.16 : 0.2)));
  const stepX = glyphWidth + gapX;
  const stepY = glyphHeight + gapY;
  const columns = Math.max(1, Math.floor((viewportWidth - glyphWidth) / stepX) + 1);
  const rows = Math.max(1, Math.floor((viewportHeight - glyphHeight) / stepY) + 1);
  const usedWidth = (columns - 1) * stepX + glyphWidth;
  const usedHeight = (rows - 1) * stepY + glyphHeight;
  const offsetX = Math.max(0, (viewportWidth - usedWidth) / 2);
  const offsetY = Math.max(0, (viewportHeight - usedHeight) / 2);
  const rowOrder = buildRowOrder(rows);
  const slots = [];

  rowOrder.forEach((row) => {
    for (let column = 0; column < columns; column += 1) {
      const x = offsetX + glyphWidth / 2 + column * stepX;
      const y = offsetY + glyphHeight / 2 + row * stepY;
      slots.push({ x, y, row, column, stepX, stepY });
    }
  });

  return { slots, stepX, stepY };
}

function distance2(aX, aY, bX, bY) {
  const dx = aX - bX;
  const dy = aY - bY;
  return dx * dx + dy * dy;
}

function parseAnchorFromId(record) {
  if (record.h3Center) {
    return {
      lat: record.h3Center.lat,
      lon: record.h3Center.lon
    };
  }

  const match = /^([+-]?\d+(?:\.\d+)?)_([+-]?\d+(?:\.\d+)?)$/.exec(record.id);
  if (match) {
    return {
      lat: Number(match[1]),
      lon: Number(match[2])
    };
  }

  return {
    lat: Math.round(record.lat),
    lon: Math.round(record.lon)
  };
}

function normalizeLongitude(lon) {
  return ((lon + 180) % 360 + 360) % 360;
}

function midpointLongitude(aLon, bLon) {
  let delta = bLon - aLon;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return normalizeLongitude(aLon + delta / 2) - 180;
}

function interpolateLongitude(aLon, bLon, t) {
  let delta = bLon - aLon;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return normalizeLongitude(aLon + delta * t) - 180;
}

function intersects(a, b, buffer) {
  return !(
    a.right + buffer <= b.left ||
    a.left >= b.right + buffer ||
    a.bottom + buffer <= b.top ||
    a.top >= b.bottom + buffer
  );
}

function buildHexBounds(candidate, glyphWidth, glyphHeight) {
  const halfWidth = glyphWidth / 2;
  const halfHeight = glyphHeight / 2;
  const sideInset = glyphWidth * 0.22;
  const verticalInset = glyphHeight * 0.08;

  return {
    left: candidate.projectedX - halfWidth + sideInset,
    right: candidate.projectedX + halfWidth - sideInset,
    top: candidate.projectedY - halfHeight + verticalInset,
    bottom: candidate.projectedY + halfHeight - verticalInset
  };
}

const GLYPH_VERTICAL_EDGE_INSET_RATIO = 0.18;
const MIN_HEX_GLYPH_AREA_PX = 900;

export function createGlyphOverlay({
  map,
  host,
  h3SourceId,
  getH3SourceFeatures = null,
  metadata,
  cells,
  rawCells = [],
  store,
  getVisibleCenterDotFeatures = null,
  onGlyphCountChange = null,
  onSelectCell = null
}) {
  const overlay = document.createElement('div');
  overlay.className = 'glyph-overlay';
  host.appendChild(overlay);
  const debugCounter = document.createElement('div');
  debugCounter.className = 'glyph-debug';
  overlay.appendChild(debugCounter);

  const nearestRawCache = new Map();
  function getNearestRaw(lat, lon) {
    let best = rawCells[0];
    let bestDist = Infinity;
    for (const raw of rawCells) {
      const d = (raw.lat - lat) ** 2 + (raw.lon - lon) ** 2;
      if (d < bestDist) { bestDist = d; best = raw; }
    }
    return best;
  }

  function isH3Record(record) {
    return Boolean(record?.h3Index && isValidCell(record.h3Index)) || isValidCell(record?.id ?? '');
  }

  function getH3GeometryCenter(record) {
    if (record?.h3Center) {
      return { lat: record.h3Center.lat, lon: record.h3Center.lon };
    }

    if (record?.h3Index && isValidCell(record.h3Index)) {
      const [lat, lon] = cellToLatLng(record.h3Index);
      return { lat, lon };
    }

    if (record?.id && isValidCell(record.id)) {
      const [lat, lon] = cellToLatLng(record.id);
      return { lat, lon };
    }

    if (Number.isFinite(record?.lat) && Number.isFinite(record?.lon)) {
      return { lat: record.lat, lon: record.lon };
    }

    return parseAnchorFromId(record);
  }

  function getCellCenter(h3Index) {
    const [lat, lon] = cellToLatLng(h3Index);
    return { lat, lon };
  }

  const markerMap = new Map();
  const boundaryCache = new Map();
  const glyphMarkupCache = new Map();
  const gridCache = new Map();
  const anchorMap = new Map(cells.map((cell) => [cell.id, parseAnchorFromId(cell)]));
  const nearestDisplayRecordCache = new Map();
  let currentState = null;
  let currentRecordMap = new Map();
  let currentInteractionPhase = 'idle';
  let dragIntent = null;
  let suppressClickUntil = 0;
  let forwardingSyntheticEvent = false;
  let lastOverlayError = '';

  function getProjectedPolygonArea(boundary) {
    if (!Array.isArray(boundary) || boundary.length < 3) {
      return 0;
    }

    const projected = boundary.map(([lat, lon]) => map.project([lon, lat]));
    let area2 = 0;
    for (let index = 0; index < projected.length; index += 1) {
      const current = projected[index];
      const next = projected[(index + 1) % projected.length];
      area2 += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area2) * 0.5;
  }

  function getProjectedHexArea(record) {
    const boundary = getBoundary(record);
    if (!boundary) {
      return 0;
    }
    return getProjectedPolygonArea(boundary);
  }

  function updateDebugCounter(stats) {
    const levelLabel = stats.level == null ? 'L?' : `L${stats.level}`;
    const summary =
      `${levelLabel} full ${stats.full} | glyph ${stats.glyph} | front ${stats.front} | viewport ${stats.viewport} | disk ${stats.disk}`;
    debugCounter.dataset.error = lastOverlayError ? 'true' : 'false';
    debugCounter.textContent = lastOverlayError ? `${summary} | error ${lastOverlayError}` : summary;
  }

  function toCanonicalCellId(cellId) {
    if (!cellId) {
      return null;
    }

    if (!isValidCell(cellId)) {
      return cellId;
    }

    const cellResolution = getResolution(cellId);
    const targetResolution = metadata.h3Resolution ?? cellResolution;
    if (cellResolution === -1 || cellResolution >= targetResolution) {
      return cellId;
    }

    return cellToCenterChild(cellId, targetResolution);
  }

  function toDisplayedCellId(cellId, displayedResolution) {
    if (!cellId) {
      return null;
    }

    if (!isValidCell(cellId)) {
      return cellId;
    }

    const cellResolution = getResolution(cellId);
    if (cellResolution === -1 || displayedResolution == null) {
      return null;
    }

    if (cellResolution <= displayedResolution) {
      return cellId;
    }

    return cellToParent(cellId, displayedResolution);
  }

  function mapCanvasTarget() {
    return host.querySelector('.maplibregl-canvas') ?? host;
  }

  function getBoundary(record) {
    const boundaryKey = record.h3Index ?? record.id;
    if (!isValidCell(boundaryKey)) {
      return null;
    }
    if (!boundaryCache.has(boundaryKey)) {
      boundaryCache.set(boundaryKey, cellToBoundary(boundaryKey));
    }
    return boundaryCache.get(boundaryKey);
  }

  function getCurrentLevelRecords() {
    return [...currentRecordMap.values()];
  }

  function getNearestDisplayRecord(h3Index, anchor, state) {
    const cacheKey = `${state.displayedH3Resolution ?? 'raw'}|${h3Index}`;
    if (nearestDisplayRecordCache.has(cacheKey)) {
      return nearestDisplayRecordCache.get(cacheKey);
    }

    const currentLevelRecords = getCurrentLevelRecords();
    let bestRecord = currentLevelRecords[0] ?? null;
    let bestDistance = Infinity;

    for (const record of currentLevelRecords) {
      const recordAnchor = getH3GeometryCenter(record);
      const distanceToRecord = (recordAnchor.lat - anchor.lat) ** 2 + (recordAnchor.lon - anchor.lon) ** 2;
      if (distanceToRecord < bestDistance) {
        bestDistance = distanceToRecord;
        bestRecord = record;
      }
    }

    nearestDisplayRecordCache.set(cacheKey, bestRecord);
    return bestRecord;
  }

  function getFeatureSamples(record) {
    const boundary = getBoundary(record);
    if (!boundary) {
      const anchor = getH3GeometryCenter(record);
      return [anchor];
    }
    const samples = [];

    for (let index = 0; index < boundary.length; index += 1) {
      const [startLat, startLon] = boundary[index];
      const [endLat, endLon] = boundary[(index + 1) % boundary.length];
      const edgeSamples = sampleSphericalEdge(
        { lat: startLat, lon: startLon },
        { lat: endLat, lon: endLon }
      );

      if (index > 0) {
        edgeSamples.shift();
      }
      samples.push(...edgeSamples);
    }

    return samples;
  }

function isPointFullyVisible(
  lat,
  lon,
  centerAnchor,
  viewportWidth,
  viewportHeight,
  viewportCenterX,
  viewportCenterY,
  globeRadius
) {
    if (angularDistance({ lat, lon }, centerAnchor) >= Math.PI / 2 - 0.02) {
      return false;
    }

    const projected = map.project([lon, lat]);
    const inViewport =
      projected.x >= 0 &&
      projected.x <= viewportWidth &&
      projected.y >= 0 &&
      projected.y <= viewportHeight;
    return inViewport;
  }

  function isPolygonFullyVisible(
    record,
    centerAnchor,
    viewportWidth,
    viewportHeight,
    viewportCenterX,
    viewportCenterY,
    globeRadius
  ) {
    const samples = getFeatureSamples(record);
    for (const sample of samples) {
      if (
        !isPointFullyVisible(
          sample.lat,
          sample.lon,
          centerAnchor,
          viewportWidth,
          viewportHeight,
          viewportCenterX,
          viewportCenterY,
          globeRadius
        )
      ) {
        return false;
      }
    }
    return true;
  }

  function forwardMouseEvent(type, sourceEvent) {
    forwardingSyntheticEvent = true;
    try {
      mapCanvasTarget().dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: sourceEvent.clientX,
          clientY: sourceEvent.clientY,
          screenX: sourceEvent.screenX,
          screenY: sourceEvent.screenY,
          button: sourceEvent.button,
          buttons: sourceEvent.buttons,
          ctrlKey: sourceEvent.ctrlKey,
          shiftKey: sourceEvent.shiftKey,
          altKey: sourceEvent.altKey,
          metaKey: sourceEvent.metaKey
        })
      );
    } finally {
      forwardingSyntheticEvent = false;
    }
  }

  function forwardWheelEvent(sourceEvent) {
    forwardingSyntheticEvent = true;
    try {
      mapCanvasTarget().dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: sourceEvent.clientX,
          clientY: sourceEvent.clientY,
          screenX: sourceEvent.screenX,
          screenY: sourceEvent.screenY,
          deltaX: sourceEvent.deltaX,
          deltaY: sourceEvent.deltaY,
          deltaZ: sourceEvent.deltaZ,
          deltaMode: sourceEvent.deltaMode,
          ctrlKey: sourceEvent.ctrlKey,
          shiftKey: sourceEvent.shiftKey,
          altKey: sourceEvent.altKey,
          metaKey: sourceEvent.metaKey
        })
      );
    } finally {
      forwardingSyntheticEvent = false;
    }
  }

  function releaseDragIntent() {
    if (!dragIntent) {
      return;
    }
    if (dragIntent.forwarding) {
      overlay.style.pointerEvents = 'none';
    }
    dragIntent = null;
    requestAnimationFrame(() => {
      overlay.style.pointerEvents = 'none';
    });
  }

  function buildGlyphCacheKey(record, state, valueDomains, width, height) {
    return [
      record.id,
      record.sourceId ?? record.id,
      state.variable,
      state.colorScaleMode ?? 'local',
      state.mode,
      state.rangeA.start,
      state.rangeB.start,
      state.periodMonths ?? 1,
      width,
      height,
      valueDomains.temperature[0].toFixed(3),
      valueDomains.temperature[1].toFixed(3),
      valueDomains.precipitation[0].toFixed(3),
      valueDomains.precipitation[1].toFixed(3)
    ].join('|');
  }

  function getInteractionCellId(record) {
    return toCanonicalCellId(record.id);
  }

  function buildMarker(record) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'glyph-card';
    marker.dataset.id = record.id;
    marker.dataset.interactionId = getInteractionCellId(record) ?? '';

    function getPointerPosition(event) {
      const hostRect = host.getBoundingClientRect();
      return {
        x: event.clientX - hostRect.left,
        y: event.clientY - hostRect.top
      };
    }

    function setMarkerHover(event) {
      if (currentInteractionPhase !== 'idle') {
        return;
      }
      const interactionCellId = getInteractionCellId(record);
      if (!interactionCellId) {
        return;
      }
      store.setHoveredCell(interactionCellId, getPointerPosition(event));
    }

    marker.addEventListener('pointerenter', (event) => {
      setMarkerHover(event);
    });

    marker.addEventListener('pointermove', (event) => {
      setMarkerHover(event);
    });

    marker.addEventListener('pointerleave', () => {
      if (currentInteractionPhase !== 'idle') {
        return;
      }
      const currentStoreState = store.getState();
      if (currentStoreState.hoveredCell === getInteractionCellId(record)) {
        store.setHoveredCell(null, null);
      }
    });

    marker.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragIntent = {
        id: record.id,
        startX: event.clientX,
        startY: event.clientY,
        startEvent: event,
        forwarding: false
      };
    });

    marker.addEventListener('click', () => {
      if (Date.now() < suppressClickUntil) {
        return;
      }
      const interactionCellId = marker.dataset.interactionId || getInteractionCellId(record);
      if (interactionCellId) {
        store.selectCell(interactionCellId);
        onSelectCell?.(interactionCellId);
      }
    });

    return marker;
  }

  function syncMarkerInteractivity(marker, record) {
    const interactive = Boolean(getInteractionCellId(record));
    marker.disabled = !interactive;
    marker.style.pointerEvents = interactive ? 'auto' : 'none';
    marker.style.opacity = '1';
  }

  let lastSyncedHoveredId = null;
  let lastSyncedSelectedId = null;

  function syncInteractionState(state = currentState) {
    if (!state) {
      return;
    }

    const displayedSelectedId = state.displayedSelectedCell ?? state.selectedCell;
    const displayedHoveredId = toDisplayedCellId(state.hoveredCell, state.displayedH3Resolution);

    const hoveredChanged = displayedHoveredId !== lastSyncedHoveredId;
    const selectedChanged = displayedSelectedId !== lastSyncedSelectedId;

    if (!hoveredChanged && !selectedChanged) {
      return;
    }

    for (const [id, marker] of markerMap) {
      const interactionId = marker.dataset.interactionId || null;
      if (hoveredChanged) {
        const wasHovered = id === lastSyncedHoveredId || interactionId === lastSyncedHoveredId;
        const isHovered = id === displayedHoveredId || interactionId === state.hoveredCell;
        if (wasHovered !== isHovered) {
          marker.classList.toggle('is-hovered', isHovered);
        }
      }
      if (selectedChanged) {
        const wasSelected = id === lastSyncedSelectedId || interactionId === lastSyncedSelectedId;
        const isSelected = id === displayedSelectedId || interactionId === state.selectedCell;
        if (wasSelected !== isSelected) {
          marker.classList.toggle('is-selected', isSelected);
        }
      }
    }

    lastSyncedHoveredId = displayedHoveredId;
    lastSyncedSelectedId = displayedSelectedId;
  }

  function updateMarkerContent(marker, record, state, valueDomains) {
    if (RENDER_CENTER_DOTS_ONLY) {
      marker.classList.add('glyph-card--dot');
      marker.style.width = '14px';
      marker.style.height = '14px';
      if (marker.dataset.glyphKey === 'center-dot') {
        return;
      }
      marker.dataset.glyphKey = 'center-dot';
      marker.innerHTML = '<span class="glyph-center-dot" aria-hidden="true"></span>';
      return;
    }

    const { width, height } = sizeForDensity(state.densityLevel, state);
    const glyphKey = buildGlyphCacheKey(record, state, valueDomains, width, height);
    syncMarkerInteractivity(marker, record);
    marker.dataset.interactionId = getInteractionCellId(record) ?? '';
    marker.classList.remove('glyph-card--dot');
    marker.style.width = `${width}px`;
    marker.style.height = `${height}px`;

    if (marker.dataset.glyphKey === glyphKey) {
      syncInteractionState(state);
      return;
    }

    if (!glyphMarkupCache.has(glyphKey)) {
      glyphMarkupCache.set(glyphKey, buildGlyphMarkup(record, metadata, state, width, height, valueDomains));
    }

    marker.dataset.glyphKey = glyphKey;
    marker.innerHTML = glyphMarkupCache.get(glyphKey);
    syncInteractionState(state);
  }

  function setInteractionPhase(nextPhase) {
    currentInteractionPhase = nextPhase;
  }

  function getGridSlots(viewportWidth, viewportHeight, glyphWidth, glyphHeight, densityLevel, interactionPhase) {
    const key = buildLayoutKey(viewportWidth, viewportHeight, glyphWidth, glyphHeight, densityLevel, interactionPhase);
    if (!gridCache.has(key)) {
      gridCache.set(
        key,
        createGridSlots(viewportWidth, viewportHeight, glyphWidth, glyphHeight, densityLevel, interactionPhase)
      );
    }
    return gridCache.get(key);
  }

  function getVisibleCandidatePool(state, densityLevel, center, interactionPhase) {
    const viewportWidth = host.clientWidth;
    const viewportHeight = host.clientHeight;
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;
    const globeRadius = Math.min(viewportWidth, viewportHeight) * 0.5;
    const markerWidth = RENDER_CENTER_DOTS_ONLY ? 14 : sizeForDensity(densityLevel, state).width;
    const markerHeight = RENDER_CENTER_DOTS_ONLY ? 14 : sizeForDensity(densityLevel, state).height;
    const verticalEdgeInset = markerHeight * GLYPH_VERTICAL_EDGE_INSET_RATIO;
    const markerRadius = Math.hypot(markerWidth, markerHeight) / 2;
    const centerAnchor = { lat: center.lat, lon: center.lng };

    const visible = [];
    const seenH3 = new Set();
    const h3SourceFeatures =
      state.unit === 'grid' || state.displayedH3Resolution == null
        ? getCurrentLevelRecords().map((cell) => ({ id: cell.id, record: cell }))
        : ((typeof getH3SourceFeatures === 'function' ? getH3SourceFeatures() : []) ?? []).map((feature) => ({
            id: feature.properties?.id ?? feature.id,
            record: currentRecordMap.get(feature.properties?.id ?? feature.id) ?? null
          }));

    for (const featureEntry of h3SourceFeatures) {
      const cell = featureEntry.record ?? null;
      const h3Key = featureEntry.id ?? cell?.h3Index ?? cell?.id;
      if (seenH3.has(h3Key)) {
        continue;
      }
      seenH3.add(h3Key);

      if (!h3Key) {
        continue;
      }

      const anchor = cell ? getH3GeometryCenter(cell) : getCellCenter(h3Key);
      if (
        !isPointFullyVisible(
          anchor.lat,
          anchor.lon,
          centerAnchor,
          viewportWidth,
          viewportHeight,
          viewportCenterX,
          viewportCenterY,
          globeRadius
        )
      ) {
        continue;
      }

      const projected = map.project([anchor.lon, anchor.lat]);
      const radialDistance = Math.hypot(projected.x - viewportCenterX, projected.y - viewportCenterY);

      const inViewport =
        projected.x >= markerWidth / 2 &&
        projected.x <= viewportWidth - markerWidth / 2 &&
        projected.y >= verticalEdgeInset &&
        projected.y <= viewportHeight - verticalEdgeInset;
      if (!inViewport) {
        continue;
      }

      const viewportBounds = buildHexBounds(
        {
          projectedX: projected.x,
          projectedY: projected.y
        },
        markerWidth,
        markerHeight
      );
      if (
        viewportBounds.right <= 0 ||
        viewportBounds.left >= viewportWidth ||
        viewportBounds.bottom <= 0 ||
        viewportBounds.top >= viewportHeight
      ) {
        continue;
      }

      if (state.unit !== 'grid') {
        const projectedHexArea = getProjectedHexArea(cell ?? { h3Index: h3Key, id: h3Key });
        if (projectedHexArea < MIN_HEX_GLYPH_AREA_PX) {
          continue;
        }
      }

      const sourceRecord = cell ?? getNearestDisplayRecord(h3Key, anchor, state);
      if (!sourceRecord) {
        continue;
      }

      let nearestRaw = null;
      if (rawCells.length > 0 && isH3Record(sourceRecord)) {
        const rawCacheKey = sourceRecord.h3Index ?? sourceRecord.id;
        if (!nearestRawCache.has(rawCacheKey)) {
          nearestRawCache.set(rawCacheKey, getNearestRaw(anchor.lat, anchor.lon));
        }
        nearestRaw = nearestRawCache.get(rawCacheKey);
      }

      const glyphRecord = nearestRaw
        ? {
            ...sourceRecord,
            ...nearestRaw,
            id: h3Key,
            h3Index: h3Key,
            lat: anchor.lat,
            lon: anchor.lon,
            h3Center: { lat: anchor.lat, lon: anchor.lon },
            sourceId: nearestRaw.id,
            anchorLat: anchor.lat,
            anchorLon: anchor.lon,
            isPlaceholderData: !cell
          }
        : {
            ...sourceRecord,
            id: h3Key,
            h3Index: h3Key,
            lat: anchor.lat,
            lon: anchor.lon,
            h3Center: { lat: anchor.lat, lon: anchor.lon },
            sourceId: sourceRecord.id,
            anchorLat: anchor.lat,
            anchorLon: anchor.lon,
            isPlaceholderData: !cell
          };

      visible.push({
        ...glyphRecord,
        projectedX: projected.x,
        projectedY: projected.y,
        centerDistance2: distance2(projected.x, projected.y, viewportCenterX, viewportCenterY),
        radialDistance
      });
    }

    visible.sort((a, b) => {
      if (Math.abs(a.projectedY - b.projectedY) > 0.5) {
        return a.projectedY - b.projectedY;
      }
      if (Math.abs(a.projectedX - b.projectedX) > 0.5) {
        return a.projectedX - b.projectedX;
      }
      if (Math.abs(a.anchorLat - b.anchorLat) > 0.01) {
        return b.anchorLat - a.anchorLat;
      }
      if (Math.abs(a.anchorLon - b.anchorLon) > 0.01) {
        return normalizeLongitude(a.anchorLon) - normalizeLongitude(b.anchorLon);
      }
      return a.sampleRank - b.sampleRank;
    });

    return visible;
  }

  function filterVisibleCandidates(candidatePool, glyphWidth, glyphHeight, densityLevel, interactionPhase) {
    return candidatePool;
  }

  function renderContent(state) {
    try {
      lastOverlayError = '';
      currentState = state;
      currentRecordMap = new Map(state.renderableCells.map((record) => [record.id, record]));
      syncInteractionState(state);
    } catch (error) {
      lastOverlayError = String(error.message ?? error);
      updateDebugCounter({
        level: state?.displayedH3Resolution ?? null,
        full: 0,
        front: 0,
        viewport: 0,
        disk: 0,
        glyph: 0
      });
      console.error('Glyph overlay renderContent failed:', error);
    }
  }

  function updateLayout(state = currentState, interactionPhase = currentInteractionPhase, densityLevelOverride = null) {
    if (!state) {
      return;
    }

    try {
      lastOverlayError = '';
      currentState = state;
      currentInteractionPhase = interactionPhase;
      const center = map.getCenter();
      const densityLevel = densityLevelOverride ?? state.densityLevel;
      const markerWidth = RENDER_CENTER_DOTS_ONLY ? 14 : sizeForDensity(densityLevel, state).width;
      const markerHeight = RENDER_CENTER_DOTS_ONLY ? 14 : sizeForDensity(densityLevel, state).height;
      const viewportWidth = host.clientWidth;
      const viewportHeight = host.clientHeight;
      const viewportCenterX = viewportWidth / 2;
      const viewportCenterY = viewportHeight / 2;
      const globeRadius = Math.min(viewportWidth, viewportHeight) * 0.5;
      const centerAnchor = { lat: center.lat, lon: center.lng };
      const stats = {
        level: state.displayedH3Resolution,
        full: 0,
        front: 0,
        viewport: 0,
        disk: 0,
        glyph: 0
      };
      const candidatePool = getVisibleCandidatePool(state, densityLevel, center, interactionPhase);
      const currentLevelRecords = getCurrentLevelRecords();
      const visibleIds = new Set();
      const assignedPositions = new Map();
      const visibleCandidates = filterVisibleCandidates(
        candidatePool,
        markerWidth,
        markerHeight,
        densityLevel,
        interactionPhase
      );

      stats.full = candidatePool.length;

      for (const cell of currentLevelRecords) {
        const anchor = getH3GeometryCenter(cell);
        const projected = map.project([anchor.lon, anchor.lat]);
        const frontHemisphere = angularDistance(anchor, centerAnchor) < Math.PI / 2 - 0.015;
        if (!frontHemisphere) {
          continue;
        }
        stats.front += 1;

        const isInViewport =
          projected.x >= -markerWidth &&
          projected.x <= viewportWidth + markerWidth &&
          projected.y >= -markerHeight &&
          projected.y <= viewportHeight + markerHeight;
        if (!isInViewport) {
          continue;
        }
        stats.viewport += 1;

        stats.disk += 1;

      }

      visibleCandidates.forEach((record) => {
        const left = record.projectedX - markerWidth / 2;
        const top = record.projectedY - markerHeight / 2;

        let marker = markerMap.get(record.id);
        if (!marker) {
          marker = buildMarker(record);
          markerMap.set(record.id, marker);
          overlay.appendChild(marker);
        }
        updateMarkerContent(marker, record, state, state.valueDomains);
        marker.style.display = 'block';
        marker.style.transform = `translate(${left}px, ${top}px)`;
        visibleIds.add(record.id);
        assignedPositions.set(record.id, { x: record.projectedX, y: record.projectedY });
      });

      stats.glyph = visibleIds.size;
      updateDebugCounter(stats);
      if (typeof onGlyphCountChange === 'function') {
        onGlyphCountChange(stats.glyph);
      }

      for (const [id, marker] of markerMap) {
        if (!visibleIds.has(id)) {
          marker.remove();
          markerMap.delete(id);
        }
      }

      const currentStoreState = store.getState();
      const hoveredDisplayedId = toDisplayedCellId(
        currentStoreState.hoveredCell,
        state.displayedH3Resolution
      );

      if (currentInteractionPhase === 'idle' && hoveredDisplayedId && visibleIds.has(hoveredDisplayedId)) {
        const assignedPosition = assignedPositions.get(hoveredDisplayedId);
        if (assignedPosition) {
          const previousPosition = currentStoreState.hoveredPosition;
          if (
            !previousPosition ||
            Math.abs(previousPosition.x - assignedPosition.x) > 0.5 ||
            Math.abs(previousPosition.y - assignedPosition.y) > 0.5
          ) {
            store.setHoveredCell(hoveredDisplayedId, assignedPosition);
          }
        }
      } else if (currentStoreState.hoveredCell && currentInteractionPhase !== 'idle') {
        store.setHoveredCell(null, null);
      }
      syncInteractionState(state);
      } catch (error) {
        lastOverlayError = String(error.message ?? error);
        updateDebugCounter({
          level: state.displayedH3Resolution,
          full: 0,
          front: 0,
          viewport: 0,
          disk: 0,
          glyph: 0
        });
      console.error('Glyph overlay update failed:', error);
    }
  }

  window.addEventListener('mousemove', (event) => {
    if (forwardingSyntheticEvent || !dragIntent) {
      return;
    }
    const moved = Math.hypot(event.clientX - dragIntent.startX, event.clientY - dragIntent.startY);
    if (!dragIntent.forwarding && moved > 3) {
      dragIntent.forwarding = true;
      overlay.style.pointerEvents = 'none';
      forwardMouseEvent('mousedown', dragIntent.startEvent);
    }
    if (dragIntent.forwarding) {
      forwardMouseEvent('mousemove', event);
    }
  });

  window.addEventListener('mouseup', (event) => {
    if (forwardingSyntheticEvent || !dragIntent) {
      return;
    }
    if (dragIntent.forwarding) {
      forwardMouseEvent('mouseup', event);
      suppressClickUntil = Date.now() + 120;
    }
    releaseDragIntent();
  });

  overlay.addEventListener(
    'wheel',
    (event) => {
      if (!event.target.closest('.glyph-card')) {
        return;
      }
      event.preventDefault();
      forwardWheelEvent(event);
    },
    { passive: false }
  );

  return {
    renderContent,
    updateLayout,
    setInteractionPhase,
    syncInteractionState,
    setOpacity(value) {
      overlay.style.opacity = String(value);
    }
  };
}
