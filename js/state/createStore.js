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
    hoveredCell: null,
    hoveredPosition: null,
    densityLevel: 'medium',
    glyphWidthScale: 0.625,
    glyphHeightScale: 0.625,
    symbolOpacity: 0.9,
    strokeOpacity: 0.05,
    showCountryBorder: false,
    showCountryLabel: false,
    showCityLabel: false,
    cameraState: null
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
    setMode(mode) {
      patch({ mode, periodMonths: normalizePeriodMonths(state.periodMonths, mode) }, 'mode');
    },
    setUnit(unit) {
      patch({ unit }, 'unit');
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
    selectCell(cellId) {
      patch({ selectedCell: cellId }, 'selectedCell');
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
    setShowCountryBorder(showCountryBorder) {
      patch({ showCountryBorder }, 'showCountryBorder');
    },
    setShowCountryLabel(showCountryLabel) {
      patch({ showCountryLabel }, 'showCountryLabel');
    },
    setShowCityLabel(showCityLabel) {
      patch({ showCityLabel }, 'showCityLabel');
    },
    resetRanges() {
      patch({ rangeA: { ...defaultRanges.rangeA }, rangeB: { ...defaultRanges.rangeB } }, 'ranges');
    }
  };
}
