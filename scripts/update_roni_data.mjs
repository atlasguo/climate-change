const SOURCE_URL = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/';
const OUTPUT_PATH = new URL('../data/roni.json', import.meta.url);
const SEASONS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];

function buildMonthLabel(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function extractTableBody(html) {
  const tableMatch = html.match(/<table id="roni-v5-table2"[\s\S]*?<tbody>([\s\S]*?)<\/tbody><\/table>/i);
  if (!tableMatch) {
    throw new Error('Failed to locate the RONI table in the source HTML.');
  }
  return tableMatch[1];
}

function parseCellValues(rowHtml) {
  return [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>/gi)]
    .slice(0, SEASONS.length)
    .map((cellMatch) => {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim();
      if (!text) {
        return null;
      }

      const value = Number(text);
      return Number.isFinite(value) ? value : null;
    });
}

function parseRows(html) {
  const tableBody = extractTableBody(html);
  const rows = [...tableBody.matchAll(/<tr>\s*<th scope="row"><p>(\d{4})<\/p><\/th>([\s\S]*?)<\/tr>/gi)];
  return rows
    .map((match) => {
      const year = Number(match[1]);
      const values = parseCellValues(match[2]);
      return { year, values };
    })
    .filter((row) => row.year >= 1950 && row.values.length === SEASONS.length && row.values.some((value) => value != null));
}

function buildPoints(rows) {
  return rows.flatMap(({ year, values }) =>
    values
      .map((anomaly, index) => {
        if (anomaly == null) {
          return null;
        }

        return {
          season: SEASONS[index],
          year,
          month: index + 1,
          monthLabel: buildMonthLabel(year, index + 1),
          anomaly
        };
      })
      .filter(Boolean)
  );
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch RONI source: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const rows = parseRows(html);
  const points = buildPoints(rows);
  if (!points.length) {
    throw new Error('Parsed zero RONI points from the CPC source.');
  }

  const payload = {
    source: 'NOAA CPC Relative Oceanic Nino Index (RONI)',
    url: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    points
  };

  await import('node:fs/promises').then((fs) =>
    fs.writeFile(OUTPUT_PATH, JSON.stringify(payload), 'utf8')
  );

  console.log(`Wrote ${points.length} RONI points through ${points.at(-1)?.monthLabel ?? 'n/a'}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
