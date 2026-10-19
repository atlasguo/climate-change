export const TEMP_TREND_DOMAIN = [-1.4, 1.4];
export const PRECIP_TREND_DOMAIN = [-15, 15];
export const TEMP_COMPARE_DOMAIN = [-3, 3];
export const PRECIP_COMPARE_DOMAIN = [-28, 28];

export const VARIABLE_LABELS = {
  temperature: 'Temperature',
  precipitation: 'Precipitation'
};

export const MODE_LABELS = {
  pulse: 'Pulse',
  shade: 'Column',
  ring: 'Cone'
};

// Filled from config/visual-palettes.json at startup via applyPaletteConfig().
export const TEMP_LINE_PALETTE = [];
export const PRECIP_LINE_PALETTE = [];
export const RONI_PALETTE = [];

export function applyPaletteConfig(config) {
  const entries = [
    [TEMP_LINE_PALETTE, config?.temperature],
    [PRECIP_LINE_PALETTE, config?.precipitation],
    [RONI_PALETTE, config?.roni]
  ];
  for (const [target, colors] of entries) {
    if (!Array.isArray(colors) || colors.length !== 5 || !colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))) {
      throw new Error('Invalid palette configuration: each palette needs five #RRGGBB colors.');
    }
    target.splice(0, target.length, ...colors);
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function emphasizeMidrange(normalized, exponent = 0.62) {
  if (normalized <= 0 || normalized >= 1) {
    return normalized;
  }
  if (normalized < 0.5) {
    return 0.5 * Math.pow(normalized / 0.5, exponent);
  }
  return 1 - 0.5 * Math.pow((1 - normalized) / 0.5, exponent);
}

export function interpolateHex(a, b, t) {
  const parse = (value) => value.match(/\w\w/g).map((part) => Number.parseInt(part, 16));
  const [ar, ag, ab] = parse(a.replace('#', ''));
  const [br, bg, bb] = parse(b.replace('#', ''));
  const mix = (start, end) => Math.round(start + (end - start) * t).toString(16).padStart(2, '0');
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

const MINUS = '\u2212';

// Formats a number with a typographic minus sign (and a plus sign when `signed`).
export function formatNumber(value, digits = 1, { signed = false } = {}) {
  if (!Number.isFinite(value)) {
    return '\u2014';
  }
  const rounded = Number(value.toFixed(digits));
  const text = Math.abs(rounded).toFixed(digits);
  if (rounded < 0) {
    return `${MINUS}${text}`;
  }
  return signed && rounded > 0 ? `+${text}` : text;
}

export function getVariableLabel(variable) {
  return VARIABLE_LABELS[variable] ?? variable;
}

export function getModeLabel(mode) {
  return MODE_LABELS[mode] ?? mode;
}

export function paletteForVariable(variable) {
  return variable === 'temperature' ? TEMP_LINE_PALETTE : PRECIP_LINE_PALETTE;
}

export function buildPaletteGradient(variable) {
  return `linear-gradient(90deg, ${paletteForVariable(variable).join(', ')})`;
}

export function domainForVariable(variable, trendMode, domainOverrides = {}) {
  return variable === 'temperature'
    ? domainOverrides.temperature ?? (trendMode ? TEMP_TREND_DOMAIN : TEMP_COMPARE_DOMAIN)
    : domainOverrides.precipitation ?? (trendMode ? PRECIP_TREND_DOMAIN : PRECIP_COMPARE_DOMAIN);
}

export function colorForVariable(variable, value, domain) {
  const palette = paletteForVariable(variable);
  const normalized = emphasizeMidrange(clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1));
  const scaled = normalized * (palette.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(palette.length - 1, left + 1);
  return interpolateHex(palette[left], palette[right], scaled - left);
}

export function rampColor(value, domain, palette) {
  const normalized = emphasizeMidrange(clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1));
  const scaled = normalized * (palette.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(palette.length - 1, left + 1);
  return interpolateHex(palette[left], palette[right], scaled - left);
}

export function summarizeValue(mode, value, trendMode) {
  if (mode === 'temperature') {
    return trendMode ? `${formatNumber(value, 2, { signed: true })} °C per decade` : `${formatNumber(value, 1, { signed: true })} °C anomaly`;
  }
  return `${formatNumber(value, 1, { signed: true })}${trendMode ? '% per decade' : '%'}`;
}

export function buildLegendMarkup(
  variable,
  trendMode,
  domainOverrides = {},
  showValueScaleToggle = false,
  chartValueScaleMode = 'local'
) {
  const palette = paletteForVariable(variable);
  const domain = domainForVariable(variable, trendMode, domainOverrides);
  const left = formatNumber(domain[0], 1, { signed: true });
  const right = formatNumber(domain[1], 1, { signed: true });
  const unit = variable === 'temperature' ? (trendMode ? ' °C per decade' : ' °C') : trendMode ? '% per decade' : '%';

  return `
    <div class="legend legend--single">
      <div class="legend__bar">
        <span class="legend__bar-fill" style="background:linear-gradient(90deg, ${palette.join(',')})"></span>
      </div>
      <div class="legend__axis">
        <span>${left}${unit}</span>
        <span>${right}${unit}</span>
      </div>
      ${showValueScaleToggle ? `
        <div class="legend__controls">
          <fieldset class="legend__radio-group" data-scale-group="value">
            <legend class="legend__radio-group-label">Value scale</legend>
            <div class="legend__radio-options">
              <label class="legend__radio"><input type="radio" name="legend-value-scale" value="local" ${chartValueScaleMode === 'local' ? 'checked' : ''} /><span>Per cell</span></label>
              <label class="legend__radio"><input type="radio" name="legend-value-scale" value="viewport" ${chartValueScaleMode === 'viewport' ? 'checked' : ''} /><span>In view</span></label>
              <label class="legend__radio"><input type="radio" name="legend-value-scale" value="global" ${chartValueScaleMode === 'global' ? 'checked' : ''} /><span>Global</span></label>
            </div>
          </fieldset>
        </div>
      ` : ''}
    </div>
  `;
}
