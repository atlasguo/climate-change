export function createStore(metadata) {
  const monthLabels = metadata.monthLabels;
  const defaultRanges = {
    rangeA: {
      start: monthLabels[0],
      end: monthLabels[0]
    },
    rangeB: {
      start: monthLabels[monthLabels.length - 1],
      end: monthLabels[monthLabels.length - 1]
    }
  };
  const state = {
    mode: 'pulse',
    variable: 'temperature',
    unit: 'hexagon',
    colorScaleMode: 'local',
    chartValueScaleMode: 'local',
    rangeA: { ...defaultRanges.rangeA },
    rangeB: { ...defaultRanges.rangeB },
    periodMonths: 60,
    selectedCell: null,
    selectedAnchor: null,
    hoveredCell: null,
    hoveredPosition: null,
    densityLevel: 'medium',
    glyphWidthScale: 0.625,
    glyphHeightScale: 0.625,
    symbolOpacity: 0.85,
    strokeOpacity: 0.85,
    showLabels: true,
    theme: 'dark',
    cameraState: null,
    viewportDomains: null,
    displayedH3Resolution: null,
    displayedGridDegrees: null
  };

  const listeners = new Set();

  function normalizePeriodMonths(periodMonths, mode = state.mode) {
    const numeric = Number(periodMonths);
    if (!Number.isFinite(numeric)) {
      return mode === 'ring' ? Math.max(12, state.periodMonths ?? 12) : state.periodMonths;
    }
    if (mode === 'ring' && numeric < 12) {
      return 12;
    }
    return numeric;
  }

  function emit(previousState, changedKey) {
    for (const listener of listeners) {
      listener({ ...state }, previousState, changedKey);
    }
  }

  function patch(partialState, changedKey) {
    const previousState = { ...state };
    Object.assign(state, partialState);
    emit(previousState, changedKey);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return { ...state };
    },
    setVariable(variable) {
      patch({ variable }, 'variable');
    },
    setSymbol(mode, unit) {
      if (state.mode === mode && state.unit === unit) {
        return;
      }
      patch({ mode, unit, periodMonths: normalizePeriodMonths(state.periodMonths, mode) }, 'symbol');
    },
    setColorScaleMode(colorScaleMode) {
      patch({ colorScaleMode }, 'colorScaleMode');
    },
    setChartValueScaleMode(chartValueScaleMode) {
      patch({ chartValueScaleMode }, 'chartValueScaleMode');
    },
    setRanges(rangeA, rangeB) {
      patch({ rangeA, rangeB }, 'ranges');
    },
    setPeriodMonths(periodMonths) {
      patch({ periodMonths: normalizePeriodMonths(periodMonths) }, 'periodMonths');
    },
    selectCell(cellId, anchor = null) {
      patch({ selectedCell: cellId, selectedAnchor: cellId ? anchor : null }, 'selectedCell');
    },
    remapSelectedCell(cellId) {
      if (cellId !== state.selectedCell) {
        patch({ selectedCell: cellId }, 'selectedCellRemap');
      }
    },
    setHoveredCell(cellId, position = null) {
      patch({ hoveredCell: cellId, hoveredPosition: position }, 'hoveredCell');
    },
    setDensityLevel(densityLevel) {
      if (densityLevel !== state.densityLevel) {
        patch({ densityLevel }, 'densityLevel');
      }
    },
    setCameraState(cameraState) {
      patch({ cameraState }, 'cameraState');
    },
    setViewportDomains(viewportDomains) {
      patch({ viewportDomains }, 'viewportDomains');
    },
    setGlyphSize(glyphWidthScale, glyphHeightScale = glyphWidthScale) {
      if (glyphWidthScale === state.glyphWidthScale && glyphHeightScale === state.glyphHeightScale) {
        return;
      }
      patch({ glyphWidthScale, glyphHeightScale }, 'glyphSize');
    },
    setSymbolOpacity(symbolOpacity) {
      patch({ symbolOpacity }, 'symbolOpacity');
    },
    setStrokeOpacity(strokeOpacity) {
      patch({ strokeOpacity }, 'strokeOpacity');
    },
    setTheme(theme) {
      patch({ theme }, 'theme');
    },
    setShowLabels(showLabels) {
      patch({ showLabels }, 'showLabels');
    },
    setDisplayedResolution(displayedH3Resolution, displayedGridDegrees) {
      if (state.displayedH3Resolution === displayedH3Resolution && state.displayedGridDegrees === displayedGridDegrees) {
        return;
      }
      patch({ displayedH3Resolution, displayedGridDegrees }, 'displayedResolution');
    },
    resetRanges() {
      patch({ rangeA: { ...defaultRanges.rangeA }, rangeB: { ...defaultRanges.rangeB } }, 'ranges');
    }
  };
}
