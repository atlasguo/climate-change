import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/';
const OUTPUT_PATH = new URL('../data/roni.json', import.meta.url);
const SEASONS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
const FIRST_YEAR = 1950;
const LAST_MONTH_LABEL = '2025-12'; // Project period is fixed at 1940-01..2025-12.
const MIN_POINTS = 800;
const FETCH_TIMEOUT_MS = 30000;
const USER_AGENT = 'climate-change-visualized RONI updater (static research site)';

function buildMonthLabel(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function cellText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&minus;|&#8722;|−/gi, '-')
    .trim();
}

// Returns the HTML of every candidate table, preferring the known RONI table id.
function extractTables(html) {
  const tables = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].map((match) => ({
    attrs: match[1],
    body: match[2]
  }));
  const preferred = tables.filter((table) => /roni/i.test(table.attrs));
  return preferred.length ? [...preferred, ...tables.filter((table) => !preferred.includes(table))] : tables;
}

// Parses one table into { year, values[12] } rows. A row is any <tr> whose first cell is a
// four-digit year; missing or non-numeric season cells become null.
function parseTableRows(tableHtml) {
  const rows = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tbody>|<\/table>|$)/gi)) {
    const cells = [...rowMatch[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)(?=<t[hd]\b|<\/tr>|$)/gi)].map((cell) =>
      cellText(cell[2].replace(/<\/t[hd]>\s*$/i, ''))
    );
    if (!cells.length || !/^\d{4}$/.test(cells[0])) {
      continue;
    }

    const year = Number(cells[0]);
    const values = SEASONS.map((_, index) => {
      const text = cells[index + 1];
      if (text == null || text === '') {
        return null;
      }
      const value = Number(text);
      return Number.isFinite(value) ? value : null;
    });
    if (values.some((value) => value != null)) {
      rows.push({ year, values });
    }
  }
  return rows;
}

export function parseRoniHtml(html) {
  for (const table of extractTables(html)) {
    const rows = parseTableRows(table.body).filter((row) => row.year >= FIRST_YEAR);
    if (rows.length) {
      return rows;
    }
  }
  throw new Error('Failed to locate a RONI table (rows starting with a year) in the source HTML.');
}

export function buildPoints(rows, lastMonthLabel = LAST_MONTH_LABEL) {
  const byLabel = new Map();
  for (const { year, values } of rows) {
    values.forEach((anomaly, index) => {
      if (anomaly == null) {
        return;
      }
      const monthLabel = buildMonthLabel(year, index + 1);
      if (monthLabel > lastMonthLabel) {
        return;
      }
      byLabel.set(monthLabel, { season: SEASONS[index], year, month: index + 1, monthLabel, anomaly });
    });
  }
  return [...byLabel.values()].sort((a, b) => (a.monthLabel < b.monthLabel ? -1 : 1));
}

async function main() {
  const response = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch RONI source: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const points = buildPoints(parseRoniHtml(html));
  if (points.length < MIN_POINTS) {
    throw new Error(`Parsed only ${points.length} RONI points (expected at least ${MIN_POINTS}); data/roni.json was not changed.`);
  }

  const payload = {
    source: 'NOAA CPC Relative Oceanic Nino Index (RONI)',
    url: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    points
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(payload), 'utf8');
  console.log(`Wrote ${points.length} RONI points through ${points.at(-1)?.monthLabel ?? 'n/a'}`);
}

function isEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }
  const normalize = (path) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
  return normalize(fileURLToPath(import.meta.url)) === normalize(process.argv[1]);
}

if (isEntryPoint()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
