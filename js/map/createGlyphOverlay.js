import { cellToBoundary, isValidCell } from 'h3-js';
import { getAggregatedSeries, getBucketedSeries, getSeriesColorDomain } from '../state/selectors.js';
import { paletteForVariable, rampColor } from '../scales/climateScales.js';
import { buildBarRects as buildBarRectsSvg, buildBucketRingSlices, buildLinePath, zeroLineY as chartZeroLineY } from '../scales/chartRenderers.js';
import { getTheme, themeColor } from '../theme.js';

const GLYPH_VERTICAL_EDGE_INSET_RATIO = 0.18;
const MIN_HEX_GLYPH_AREA_PX = 900;
const GLYPH_MARKUP_CACHE_LIMIT = 6000;
// Glyphs fade out between these angular distances from the view center (fraction of 90 degrees).
const EDGE_FADE_START = 0.72;
const FRONT_HEMISPHERE_LIMIT = Math.PI / 2 - 0.02;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
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

function buildGradientStops(series, colorDomain, palette) {
  const sampled = sampleSeries(series, 24);
  return sampled
    .map((value, index) => {
      const offset = (index / Math.max(1, sampled.length - 1)) * 100;
      return `<stop offset="${offset}%" stop-color="${rampColor(value, colorDomain, palette)}" />`;
    })
    .join('');
}

function buildGlyphMarkup(record, metadata, state, glyphWidth, glyphHeight, valueDomains, viewportDomains) {
  const mode = state.mode ?? 'pulse';
  const variable = state.variable ?? 'temperature';
  const padX = Math.max(7, glyphWidth * 0.16);
  const padY = Math.max(6, glyphHeight * 0.12);
  const innerWidth = glyphWidth - padX * 2;
  const trackHeight = Math.max(8, glyphHeight - padY * 2 - 6);
  const chartTop = padY + 3;
  const visibleSeries = getAggregatedSeries(record, metadata, state, variable);
  const gradientId = `${variable}-${record.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const geometryDomain = valueDomains[variable];
  const colorDomain = getSeriesColorDomain(record, metadata, state, variable, valueDomains, viewportDomains);
  const palette = paletteForVariable(variable);
  const parts = [];
  let defs = '';

  if (mode === 'pulse') {
    const path = buildLinePath(visibleSeries, geometryDomain, padX, chartTop, innerWidth, trackHeight);
    const zeroY = chartZeroLineY(geometryDomain, chartTop, trackHeight);
    defs = `
      <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
        ${buildGradientStops(visibleSeries, colorDomain, palette)}
      </linearGradient>
    `;
    parts.push(`
      <line x1="${padX}" y1="${zeroY.toFixed(2)}" x2="${(glyphWidth - padX).toFixed(2)}" y2="${zeroY.toFixed(2)}" stroke="${themeColor('glyphZero')}" stroke-width="0.3" />
      <path d="${path}" fill="none" stroke="${themeColor('glyphHalo')}" stroke-width="7" stroke-opacity="0.45" stroke-linejoin="round" stroke-linecap="round" />
      <path d="${path}" fill="none" stroke="url(#${gradientId})" stroke-width="1.92" stroke-linejoin="round" stroke-linecap="round" />
    `);
  } else if (mode === 'shade') {
    const shadeZeroY = chartZeroLineY(geometryDomain, chartTop, trackHeight);
    const shadeGapHalf = 0.5;
    const shadeClipId = `clip-shade-${gradientId}`;
    defs = `
      <clipPath id="${shadeClipId}">
        <rect x="0" y="0" width="${glyphWidth}" height="${Math.max(0, shadeZeroY - shadeGapHalf).toFixed(2)}" />
        <rect x="0" y="${(shadeZeroY + shadeGapHalf).toFixed(2)}" width="${glyphWidth}" height="${Math.max(0, glyphHeight - shadeZeroY - shadeGapHalf).toFixed(2)}" />
      </clipPath>
    `;
    const bars = buildBarRectsSvg(visibleSeries, geometryDomain, padX, chartTop, innerWidth, trackHeight, palette, colorDomain);
    // The halo is the same bars drawn wider in the theme's halo colour, underneath.
    const halo = bars.replace(/fill="[^"]*"/g, `fill="${themeColor('glyphHalo')}" stroke="${themeColor('glyphHalo')}" stroke-width="3" opacity="0.4"`);
    parts.push(`
      <g>${halo}</g>
      <g clip-path="url(#${shadeClipId})">${bars}</g>
    `);
  } else {
    const bucketedSeries = getBucketedSeries(record, metadata, state, variable);
    const ringRadius = Math.min(innerWidth, trackHeight) * 0.46;
    const ringInnerRadius = Math.max(2, ringRadius * 0.08);
    const centerX = glyphWidth / 2;
    const centerY = glyphHeight / 2 + 1;
    parts.push(`
      <circle cx="${centerX}" cy="${centerY}" r="${(ringRadius + 3.4).toFixed(2)}" fill="${themeColor('glyphHalo')}" fill-opacity="0.45" />
      ${buildBucketRingSlices(bucketedSeries, geometryDomain, centerX, centerY, ringRadius, ringInnerRadius, palette, 12, colorDomain)}
      <circle cx="${centerX}" cy="${centerY}" r="${Math.max(4, ringInnerRadius - 2).toFixed(2)}" fill="${themeColor('glyphHole')}" />
    `);
  }

  return `
    <svg viewBox="0 0 ${glyphWidth} ${glyphHeight}" class="glyph-card__svg" aria-hidden="true">
      <defs>${defs}</defs>
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

export function createGlyphOverlay({
  map,
  host,
  metadata,
  store,
  onVisibleCellsChange = null,
  onSelectCell = null
}) {
  const overlay = document.createElement('div');
  overlay.className = 'glyph-overlay';
  // Glyphs mirror the map for pointer users; keyboard and screen reader users select cells
  // through the map canvas and search instead.
  overlay.setAttribute('aria-hidden', 'true');
  host.appendChild(overlay);

  const markerMap = new Map();
  const boundaryCache = new Map();
  const glyphMarkupCache = new Map();
  let currentState = null;
  let currentRecords = [];
  let currentInteractionPhase = 'idle';
  let dragIntent = null;
  let suppressClickUntil = 0;
  let forwardingSyntheticEvent = false;
  let lastSyncedHoveredId = null;
  let lastSyncedSelectedId = null;

  function getAnchor(record) {
    return record.h3Center ?? { lat: record.lat, lon: record.lon };
  }

  function getProjectedHexArea(record) {
    const key = record.h3Index;
    if (!key || !isValidCell(key)) {
      return Infinity;
    }
    if (!boundaryCache.has(key)) {
      if (boundaryCache.size > 50000) {
        boundaryCache.clear();
      }
      boundaryCache.set(key, cellToBoundary(key));
    }
    const projected = boundaryCache.get(key).map(([lat, lon]) => map.project([lon, lat]));
    let area2 = 0;
    for (let index = 0; index < projected.length; index += 1) {
      const current = projected[index];
      const next = projected[(index + 1) % projected.length];
      area2 += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area2) * 0.5;
  }

  function mapCanvasTarget() {
    return host.querySelector('.maplibregl-canvas') ?? host;
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
    dragIntent = null;
    requestAnimationFrame(() => {
      overlay.style.pointerEvents = 'none';
    });
  }

  function buildGlyphCacheKey(record, state, valueDomains, width, height) {
    const colorScaleMode = state.colorScaleMode ?? 'local';
    const vpd = colorScaleMode === 'viewport' ? state.viewportDomains : null;
    return [
      record.id,
      getTheme(),
      state.variable,
      colorScaleMode,
      state.mode,
      state.rangeA.start,
      state.rangeB.start,
      state.periodMonths ?? 1,
      width,
      height,
      valueDomains.temperature[0].toFixed(3),
      valueDomains.temperature[1].toFixed(3),
      valueDomains.precipitation[0].toFixed(3),
      valueDomains.precipitation[1].toFixed(3),
      vpd ? `${vpd.temperature[0].toFixed(3)},${vpd.temperature[1].toFixed(3)},${vpd.precipitation[0].toFixed(3)},${vpd.precipitation[1].toFixed(3)}` : ''
    ].join('|');
  }

  function getPointerPosition(event) {
    const hostRect = host.getBoundingClientRect();
    return {
      x: event.clientX - hostRect.left,
      y: event.clientY - hostRect.top
    };
  }

  function buildMarker(record) {
    const marker = document.createElement('div');
    marker.className = 'glyph-card';
    marker.dataset.id = record.id;

    const setMarkerHover = (event) => {
      if (currentInteractionPhase !== 'idle') {
        return;
      }
      store.setHoveredCell(marker.dataset.id, getPointerPosition(event));
    };

    marker.addEventListener('pointerenter', setMarkerHover);
    marker.addEventListener('pointermove', setMarkerHover);

    marker.addEventListener('pointerleave', () => {
      if (currentInteractionPhase !== 'idle') {
        return;
      }
      if (store.getState().hoveredCell === marker.dataset.id) {
        store.setHoveredCell(null, null);
      }
    });

    marker.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragIntent = {
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
      onSelectCell?.(marker.dataset.id);
    });

    return marker;
  }

  function syncInteractionState(state = currentState) {
    if (!state) {
      return;
    }

    const selectedId = state.displayedSelectedCell ?? state.selectedCell ?? null;
    const hoveredId = state.hoveredCell ?? null;
    const hoveredChanged = hoveredId !== lastSyncedHoveredId;
    const selectedChanged = selectedId !== lastSyncedSelectedId;
    if (!hoveredChanged && !selectedChanged) {
      return;
    }

    for (const [id, marker] of markerMap) {
      if (hoveredChanged) {
        marker.classList.toggle('is-hovered', id === hoveredId);
      }
      if (selectedChanged) {
        marker.classList.toggle('is-selected', id === selectedId);
      }
    }

    lastSyncedHoveredId = hoveredId;
    lastSyncedSelectedId = selectedId;
  }

  function updateMarkerContent(marker, record, state, valueDomains) {
    const { width, height } = sizeForDensity(state.densityLevel, state);
    const glyphKey = buildGlyphCacheKey(record, state, valueDomains, width, height);
    marker.style.width = `${width}px`;
    marker.style.height = `${height}px`;

    if (marker.dataset.glyphKey === glyphKey) {
      return;
    }

    let markup = glyphMarkupCache.get(glyphKey);
    if (!markup) {
      if (glyphMarkupCache.size >= GLYPH_MARKUP_CACHE_LIMIT) {
        glyphMarkupCache.clear();
      }
      markup = buildGlyphMarkup(record, metadata, state, width, height, valueDomains, state.viewportDomains);
      glyphMarkupCache.set(glyphKey, markup);
    }

    marker.dataset.glyphKey = glyphKey;
    marker.innerHTML = markup;
    marker.classList.toggle('is-hovered', record.id === (state.hoveredCell ?? lastSyncedHoveredId));
    marker.classList.toggle('is-selected', record.id === (state.displayedSelectedCell ?? state.selectedCell));
  }

  function setInteractionPhase(nextPhase) {
    currentInteractionPhase = nextPhase;
  }

  function collectVisibleRecords(state, densityLevel) {
    const viewportWidth = host.clientWidth;
    const viewportHeight = host.clientHeight;
    const { width: markerWidth, height: markerHeight } = sizeForDensity(densityLevel, state);
    const verticalEdgeInset = markerHeight * GLYPH_VERTICAL_EDGE_INSET_RATIO;
    const center = map.getCenter();
    const centerAnchor = { lat: center.lat, lon: center.lng };
    const isHexagon = state.unit !== 'grid';
    const visible = [];

    for (const record of currentRecords) {
      const anchor = getAnchor(record);
      const angle = angularDistance(anchor, centerAnchor);
      if (angle >= FRONT_HEMISPHERE_LIMIT) {
        continue;
      }

      const projected = map.project([anchor.lon, anchor.lat]);
      if (
        projected.x < markerWidth / 2 ||
        projected.x > viewportWidth - markerWidth / 2 ||
        projected.y < verticalEdgeInset ||
        projected.y > viewportHeight - verticalEdgeInset
      ) {
        continue;
      }

      if (isHexagon && getProjectedHexArea(record) < MIN_HEX_GLYPH_AREA_PX) {
        continue;
      }

      visible.push({ record, x: projected.x, y: projected.y, angle });
    }

    return visible;
  }

  function renderContent(state) {
    currentState = state;
    currentRecords = state.renderableCells ?? [];
    syncInteractionState(state);
  }

  function updateLayout(state = currentState, interactionPhase = currentInteractionPhase, densityLevelOverride = null) {
    if (!state) {
      return;
    }

    try {
      currentState = state;
      currentInteractionPhase = interactionPhase;
      const densityLevel = densityLevelOverride ?? state.densityLevel;
      const layoutState = densityLevel === state.densityLevel ? state : { ...state, densityLevel };
      const { width: markerWidth, height: markerHeight } = sizeForDensity(densityLevel, state);
      const visibleIds = new Set();

      for (const { record, x, y, angle } of collectVisibleRecords(state, densityLevel)) {
        let marker = markerMap.get(record.id);
        if (!marker) {
          marker = buildMarker(record);
          markerMap.set(record.id, marker);
          overlay.appendChild(marker);
        }
        updateMarkerContent(marker, record, layoutState, state.valueDomains);
        marker.style.display = 'block';
        marker.style.transform = `translate(${x - markerWidth / 2}px, ${y - markerHeight / 2}px)`;

        const edgeRatio = angle / (Math.PI / 2);
        const edgeFade = clamp((edgeRatio - EDGE_FADE_START) / (1 - EDGE_FADE_START), 0, 1);
        marker.style.opacity = edgeFade > 0 ? String(1 - edgeFade * 0.99) : '1';
        visibleIds.add(record.id);
      }

      for (const [id, marker] of markerMap) {
        if (!visibleIds.has(id)) {
          marker.remove();
          markerMap.delete(id);
        }
      }

      onVisibleCellsChange?.(visibleIds);

      if (currentInteractionPhase !== 'idle' && store.getState().hoveredCell) {
        store.setHoveredCell(null, null);
      }
      lastSyncedHoveredId = undefined;
      lastSyncedSelectedId = undefined;
      syncInteractionState(state);
    } catch (error) {
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
