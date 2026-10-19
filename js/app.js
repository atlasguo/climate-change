import { createMapView } from './map/createMap.js';
import { createStore } from './state/createStore.js';
import { loadClimateData } from './data/loadClimateData.js';
import { createUI } from './ui/createUI.js';

const SYMBOL_OPTIONS = [
  { mode: 'pulse', unit: 'grid', label: 'Pulse', meta: 'Grid', icon: 'pulse' },
  { mode: 'shade', unit: 'grid', label: 'Column', meta: 'Grid', icon: 'shade' },
  { mode: 'ring', unit: 'grid', label: 'Cone', meta: 'Grid', icon: 'ring' },
  { mode: 'pulse', unit: 'hexagon', label: 'Pulse', meta: 'Hexagon', icon: 'pulse' },
  { mode: 'shade', unit: 'hexagon', label: 'Column', meta: 'Hexagon', icon: 'shade' },
  { mode: 'ring', unit: 'hexagon', label: 'Cone', meta: 'Hexagon', icon: 'ring' }
];

function buildSymbolMatrixMarkup(unit) {
  const cellCount = unit === 'hexagon' ? 7 : 9;
  return `
    <span class="symbol-button__matrix symbol-button__matrix--${unit}" aria-hidden="true">
      ${new Array(cellCount).fill('<span class="symbol-button__cell"></span>').join('')}
    </span>
  `;
}

function buildSymbolIconMarkup(icon) {
  if (icon === 'pulse') {
    return `
      <svg class="symbol-button__mode symbol-button__mode--pulse" viewBox="0 0 48 36" aria-hidden="true">
        <polyline points="4,26 14,21 23,24 33,14 44,10" fill="none" stroke="currentColor" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }
  if (icon === 'shade') {
    return `
      <svg class="symbol-button__mode symbol-button__mode--shade" viewBox="0 0 48 36" aria-hidden="true">
        <rect x="5" y="18" width="7" height="12" rx="1.5" fill="currentColor" />
        <rect x="16" y="13" width="7" height="17" rx="1.5" fill="currentColor" />
        <rect x="27" y="9" width="7" height="21" rx="1.5" fill="currentColor" />
        <rect x="38" y="5" width="7" height="25" rx="1.5" fill="currentColor" />
      </svg>
    `;
  }
  return `
    <svg class="symbol-button__mode symbol-button__mode--ring" viewBox="0 0 48 36" aria-hidden="true">
      <circle cx="24" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2.6" />
      <circle cx="24" cy="18" r="7" fill="none" stroke="currentColor" stroke-width="2.6" opacity="0.88" />
      <circle cx="24" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2.6" opacity="0.76" />
    </svg>
  `;
}

function buildSymbolOptionsMarkup(unit) {
  return SYMBOL_OPTIONS.filter((o) => o.unit === unit).map(
    (option) => `
      <button
        type="button"
        class="segmented__button symbol-button"
        data-symbol-mode="${option.mode}"
        data-symbol-unit="${option.unit}"
        title="${option.label} / ${option.meta}"
        aria-label="${option.label} symbol, ${option.meta.toLowerCase()} unit"
        aria-pressed="false"
      >
        <span class="symbol-button__preview symbol-button__preview--${option.unit}">
          ${buildSymbolMatrixMarkup(option.unit)}
          ${buildSymbolIconMarkup(option.icon)}
        </span>
      </button>
    `
  ).join('');
}

const SHELL = `
  <div class="app-shell">
    <div class="app-shell__backdrop" aria-hidden="true"></div>
    <aside class="panel panel--left" data-panel="controls" aria-label="Controls">
      <section class="panel-section panel-section--title">
        <div class="title-block">
          <h1 class="panel-title" data-bind="app-title">Climate Change Visualized</h1>
        </div>
      </section>

      <section class="panel-section">
        <div class="section-head">
          <h2 class="panel-label">Variable</h2>
        </div>
        <div class="segmented">
          <button class="segmented__button segmented__button--with-scale" data-variable="temperature">
            <span class="segmented__button-head">
              <svg class="segmented__button-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6.2 3.1a1.8 1.8 0 1 1 3.6 0v5.3a3.3 3.3 0 1 1-3.6 0Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="8" cy="11.3" r="1.7" fill="currentColor" />
              </svg>
              <span class="segmented__button-label">Temperature</span>
            </span>
            <span class="segmented__button-scale-row">
              <span class="segmented__button-sign">&minus;</span>
              <span class="segmented__button-scale segmented__button-scale--temperature" aria-hidden="true"></span>
              <span class="segmented__button-sign">+</span>
            </span>
            <span class="segmented__button-meta">Anomaly</span>
          </button>
          <button class="segmented__button segmented__button--with-scale" data-variable="precipitation">
            <span class="segmented__button-head">
              <svg class="segmented__button-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2.2c1.9 2.4 4.1 4.8 4.1 7.1a4.1 4.1 0 1 1-8.2 0C3.9 7 6.1 4.6 8 2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span class="segmented__button-label">Precipitation</span>
            </span>
            <span class="segmented__button-scale-row">
              <span class="segmented__button-sign">&minus;</span>
              <span class="segmented__button-scale segmented__button-scale--precipitation" aria-hidden="true"></span>
              <span class="segmented__button-sign">+</span>
            </span>
            <span class="segmented__button-meta">Anomaly</span>
          </button>
        </div>
        <fieldset class="legend__radio-group legend__radio-group--panel" data-color-scale-group>
          <legend class="legend__radio-group-label">Color scale</legend>
          <div class="legend__radio-options">
            <label class="legend__radio"><input type="radio" name="panel-color-scale" value="local" checked /><span>Per cell</span></label>
            <label class="legend__radio"><input type="radio" name="panel-color-scale" value="viewport" /><span>In view</span></label>
            <label class="legend__radio"><input type="radio" name="panel-color-scale" value="global" /><span>Global</span></label>
          </div>
        </fieldset>
      </section>

      <section class="panel-section">
        <div class="section-head">
          <h2 class="panel-label">Symbol</h2>
        </div>
        <div class="symbol-grid">
          <span class="symbol-grid__unit-info"><span class="symbol-grid__unit-label">Cell size</span><span data-bind="symbol-unit-info"></span></span>
          <span class="symbol-grid__col-header">Pulse</span>
          <span class="symbol-grid__col-header">Column</span>
          <span class="symbol-grid__col-header">Cone</span>
          <span class="symbol-grid__freq">By period</span>
          <span class="symbol-grid__freq">By period</span>
          <span class="symbol-grid__freq">By month</span>
          <span class="symbol-grid__row-header">Grid</span>
          ${buildSymbolOptionsMarkup('grid')}
          <span class="symbol-grid__row-header">Hexagon</span>
          ${buildSymbolOptionsMarkup('hexagon')}
        </div>
        <div class="symbol-adjustments">
          <div class="opacity-control">
            <label class="opacity-control__label" for="symbol-size-slider">
              <span id="symbol-size-label">Size</span>
              <span data-bind="symbol-size-value">40%</span>
            </label>
            <input class="opacity-control__slider" type="range" min="0" max="100" step="1" value="40" id="symbol-size-slider" aria-labelledby="symbol-size-label" data-symbol-size />
          </div>
          <div class="opacity-control">
            <label class="opacity-control__label" for="symbol-opacity-slider">
              <span id="symbol-opacity-label">Opacity</span>
              <span data-bind="symbol-opacity-value">90%</span>
            </label>
            <input class="opacity-control__slider" type="range" min="0" max="100" step="5" value="90" id="symbol-opacity-slider" aria-labelledby="symbol-opacity-label" data-symbol-opacity />
          </div>
          <div class="opacity-control">
            <label class="opacity-control__label" for="symbol-stroke-slider">
              <span id="symbol-stroke-label">Cell outline</span>
              <span data-bind="symbol-stroke-value">10%</span>
            </label>
            <input class="opacity-control__slider" type="range" min="0" max="100" step="5" value="10" id="symbol-stroke-slider" aria-labelledby="symbol-stroke-label" data-symbol-stroke />
          </div>
        </div>
      </section>

      <section class="panel-section panel-section--meta">
        <div class="metadata-list">
          <div class="metadata-list__row"><h2 class="metadata-list__label">Data sources</h2><div class="metadata-list__value" data-bind="meta-datasource"></div></div>
          <div class="metadata-list__row"><h2 class="metadata-list__label">Copyright</h2><div class="metadata-list__value" data-bind="meta-copyright"></div></div>
        </div>
      </section>
    </aside>

    <main class="map-stage">
      <form class="map-search" data-map-search-form>
        <input
          class="map-search__input"
          data-map-search-input
          type="search"
          placeholder="Search for a place"
          aria-label="Search for a place"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="map-search__submit" type="submit" aria-label="Search">
          <svg class="map-search__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="5.75" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M15.4 15.4 19 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
        <div class="map-search__status" data-map-search-status role="status" aria-live="polite" hidden></div>
        <div class="map-search__filters" role="group" aria-label="Map labels">
          <label class="map-search__filter-item">
            <input type="checkbox" data-show-country-border class="map-search__checkbox" />
            <span class="map-search__filter-label">Country borders</span>
          </label>
          <label class="map-search__filter-item">
            <input type="checkbox" data-show-country-label class="map-search__checkbox" />
            <span class="map-search__filter-label">Country names</span>
          </label>
          <label class="map-search__filter-item">
            <input type="checkbox" data-show-city-label class="map-search__checkbox" />
            <span class="map-search__filter-label">City names</span>
          </label>
        </div>
      </form>
      <div id="map" class="map-canvas"></div>
      <p class="sr-only" id="map-keyboard-help">Use the arrow keys to pan and the plus and minus keys to zoom. Press Enter to select the cell at the center of the map and Escape to clear the selection.</p>
      <div class="map-crosshair" aria-hidden="true"></div>
      <div class="map-loading" data-map-loading hidden aria-hidden="true">
        <div class="map-loading__card" role="status" aria-live="polite" aria-atomic="true">
          <div class="map-loading__halo" aria-hidden="true"></div>
          <div class="map-loading__copy">
            <strong class="map-loading__title" data-map-loading-title>Updating globe</strong>
            <span class="map-loading__detail" data-map-loading-detail>Rendering climate layers</span>
          </div>
        </div>
      </div>


      <button class="mobile-toggle mobile-toggle--controls" data-mobile-toggle="controls">Controls</button>
      <button class="mobile-toggle mobile-toggle--details" data-mobile-toggle="details">Details</button>
    </main>

    <aside class="panel panel--right" data-panel="details" aria-label="Details">
      <section class="panel-section">
        <div class="section-head">
          <h2 class="panel-label">Details</h2>
        </div>
        <div data-detail-summary class="detail-summary"></div>
        <p class="sr-only" data-selection-announcer aria-live="polite" aria-atomic="true"></p>
      </section>

      <section class="panel-section">
        <div class="section-head">
          <h2 class="panel-label">Chart</h2>
        </div>
        <div data-detail-chart class="detail-chart"></div>
        <div class="detail-export-actions">
          <button class="ghost-button" type="button" data-action="export-map">Export map</button>
          <button class="ghost-button" type="button" data-action="export-chart">Export chart</button>
        </div>
      </section>
    </aside>

    <section class="timeline-dock" aria-labelledby="timeline-heading">
      <div class="timeline-dock__header">
        <h2 class="panel-label" id="timeline-heading">Timeline</h2>
        <div class="timeline-dock__actions">
          <div class="timeline-editor">
            <label class="timeline-editor__group">
              <span>Start year</span>
              <select class="timeline-period__select timeline-editor__select" data-range-select="start"></select>
            </label>
            <label class="timeline-editor__group">
              <span>End year</span>
              <select class="timeline-period__select timeline-editor__select" data-range-select="end"></select>
            </label>
          </div>
          <label class="timeline-period">
            <span>Period</span>
            <select class="timeline-period__select" data-period-select>
              <option value="120">10 years</option>
              <option value="60">5 years</option>
              <option value="24">2 years</option>
              <option value="12">1 year</option>
              <option value="6">6 months</option>
              <option value="1">1 month</option>
            </select>
          </label>
          <button class="ghost-button" type="button" data-action="reset-ranges">Reset time range</button>
          <div class="timeline-toggle timeline-toggle--roni">
            <label class="timeline-toggle__control">
              <input type="checkbox" data-timeline-oni-toggle checked />
              <span class="timeline-toggle__label">RONI: <span class="timeline-toggle__elnino">El Niño</span> and <span class="timeline-toggle__lanina">La Niña</span> <span data-bind="roni-range"></span></span>
            </label>
            <a class="timeline-toggle__help" href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/" target="_blank" rel="noopener noreferrer" title="What is RONI?" aria-label="What is RONI?">?</a>
          </div>
        </div>
      </div>

      <div class="timeline-grid timeline-grid--single">
        <section class="timeline-block">
          <div class="timeline-axis" data-timeline-axis>
            <div class="timeline-axis__line" aria-hidden="true"></div>
            <div class="timeline-axis__oni" data-timeline-oni aria-hidden="true"></div>
            <div class="timeline-axis__ticks" data-timeline-ruler aria-hidden="true"></div>
            <div class="timeline-axis__mask timeline-axis__mask--before" data-timeline-mask="before" aria-hidden="true"></div>
            <div class="timeline-axis__mask timeline-axis__mask--after" data-timeline-mask="after" aria-hidden="true"></div>
            <div class="timeline-handle timeline-handle--start" data-timeline-handle="start" role="slider" tabindex="0" aria-label="Start year" aria-orientation="horizontal">
              <span class="timeline-handle__tag" data-handle-tag></span>
              <span class="timeline-handle__grip" aria-hidden="true"></span>
            </div>
            <div class="timeline-handle timeline-handle--end" data-timeline-handle="end" role="slider" tabindex="0" aria-label="End year" aria-orientation="horizontal">
              <span class="timeline-handle__tag" data-handle-tag></span>
              <span class="timeline-handle__grip" aria-hidden="true"></span>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
`;

export async function initApp(root) {
  root.innerHTML = SHELL;

  const loading = root.querySelector('[data-map-loading]');
  const showStartupProgress = ({ title, detail }) => {
    loading.hidden = false;
    loading.setAttribute('aria-hidden', 'false');
    root.querySelector('[data-map-loading-title]').textContent = title;
    root.querySelector('[data-map-loading-detail]').textContent = detail;
  };
  const climateData = await loadClimateData({ onProgress: showStartupProgress });
  const roniPoints = climateData.roni;
  if (roniPoints.length) {
    const firstYear = roniPoints[0].monthLabel?.slice(0, 4) ?? roniPoints[0].year;
    const lastYear = roniPoints[roniPoints.length - 1].monthLabel?.slice(0, 4) ?? roniPoints[roniPoints.length - 1].year;
    root.querySelector('[data-bind="roni-range"]').textContent = `(${firstYear}–${lastYear})`;
  }
  const store = createStore(climateData.metadata);
  const ui = createUI(root, store, climateData.metadata, climateData.rawCells, climateData.roni, climateData.globalCell);
  ui.setMapLoading({
    active: true,
    title: 'Preparing globe',
    detail: 'Loading map and climate layers'
  });
  const mapView = await createMapView({
    container: root.querySelector('#map'),
    metadata: climateData.metadata,
    rawCells: climateData.rawCells,
    store,
    onLoadingChange: ui.setMapLoading
  });

  store.subscribe((state, previousState, changedKey) => {
    ui.render(state, previousState, changedKey);
    mapView.handleStateChange(state, previousState, changedKey);
  });

  ui.render(store.getState(), null, 'init');
  mapView.handleStateChange(store.getState(), null, 'init');
}
