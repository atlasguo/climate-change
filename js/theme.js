// Light and dark colour themes for everything drawn from JavaScript (charts, map layers,
// glyphs). Page colours live in css/styles.css; both follow <html data-theme>.

const STORAGE_KEY = 'ccv-theme';
const DEFAULT_THEME = 'light';

const COLORS = {
  dark: {
    pageBackground: '#050607',
    chartBackground: '#121213',
    chartText: '#a3aab0',
    chartTitle: '#b4bac0',
    chartStrongText: '#e4e8ea',
    chartAxis: '#5b6066',
    chartBaseline: '#43484d',
    chartZero: '#565c62',
    chartGrid: 'rgba(165, 171, 177, 0.16)',
    chartGridRaw: 'rgba(128, 134, 140, 0.14)',
    chartRawLine: '#aeb4ba',
    chartPoint: '#d9e4eb',
    ringHole: '#121213',
    glyphZero: 'rgba(255, 255, 255, 0.4)',
    glyphHole: '#111316',
    glyphHalo: 'rgba(0, 0, 0, 0.6)',
    cellFill: '#d9dee3',
    cellLine: 'rgba(0, 0, 0, 0.85)',
    gridLine: 'rgba(0, 0, 0, 0.8)',
    cellShadow: 'rgba(255, 255, 255, 0.4)',
    hoverFill: 'rgba(233, 237, 241, 0.9)',
    hoverLine: 'rgba(248, 250, 252, 0.98)',
    selectFill: 'rgba(255, 183, 68, 0.98)',
    selectLine: 'rgba(255, 206, 122, 1)',
    statusText: '#d2d5d8',
    statusError: '#d7b4b4',
    statusBorder: 'rgba(166, 172, 178, 0.16)',
    statusErrorBorder: 'rgba(215, 118, 118, 0.24)'
  },
  light: {
    pageBackground: '#eef0f2',
    chartBackground: '#ffffff',
    chartText: '#555c63',
    chartTitle: '#40474e',
    chartStrongText: '#14171a',
    chartAxis: '#9aa1a8',
    chartBaseline: '#b8bec4',
    chartZero: '#8f969d',
    chartGrid: 'rgba(60, 66, 72, 0.12)',
    chartGridRaw: 'rgba(60, 66, 72, 0.1)',
    chartRawLine: '#6f777e',
    chartPoint: '#2b3238',
    ringHole: '#ffffff',
    glyphZero: 'rgba(20, 24, 28, 0.35)',
    glyphHole: '#ffffff',
    glyphHalo: 'rgba(255, 255, 255, 0.85)',
    cellFill: '#2b3036',
    cellLine: 'rgba(255, 255, 255, 0.95)',
    gridLine: 'rgba(255, 255, 255, 0.9)',
    cellShadow: 'rgba(0, 0, 0, 0.45)',
    hoverFill: 'rgba(30, 36, 42, 0.5)',
    hoverLine: 'rgba(16, 20, 24, 0.95)',
    selectFill: 'rgba(214, 128, 0, 0.9)',
    selectLine: 'rgba(199, 110, 0, 1)',
    statusText: '#2b3036',
    statusError: '#9b2b2b',
    statusBorder: 'rgba(60, 66, 72, 0.18)',
    statusErrorBorder: 'rgba(155, 43, 43, 0.3)'
  }
};

let current = readStoredTheme();

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function getTheme() {
  return current;
}

export function themeColor(key) {
  return COLORS[current][key] ?? COLORS.dark[key];
}

export function setTheme(theme) {
  current = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[current].pageBackground);
  try {
    window.localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // Remembering the choice is optional.
  }
  return current;
}
