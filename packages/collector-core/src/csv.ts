import { filterOzonCollectUrls } from './ozon-urls';

const URL_HEADER = /^(url|link|商品链接|商品url|ozon.?url)$/i;

export function parseProductUrlsFromCsv(content: string): string[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const firstCells = splitCsvLine(lines[0]);
  const headerIndex = firstCells.findIndex((cell) => URL_HEADER.test(cell.trim()));
  const start = headerIndex >= 0 ? 1 : 0;
  const column = headerIndex >= 0 ? headerIndex : 0;

  const urls: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const raw = (cells[column] ?? cells[0] ?? '').trim().replace(/^"|"$/g, '');
    if (/^https?:\/\//i.test(raw)) {
      urls.push(raw);
    }
  }
  return filterOzonCollectUrls(urls);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}
