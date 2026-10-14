export const MAX_BYTES = 20 * 1024 * 1024;
export interface ColumnMap { doi: number; type: number; date: number }
export interface CsvRow { cells: string[]; line: number; warning: string }
export interface Csv { headers: string[]; rows: CsvRow[] }
export interface Note { path: string; doi: unknown; citekey: unknown; text: string; links: string[] }
export interface ReviewItem { id: string; path: string; reference: string; doi: string; type: string; date: string; row: string[]; line: number; reason: string; checked: boolean }
export interface Queue { items: ReviewItem[]; warnings: string[]; matchedRows: number }
export function normalizeDoi(value: unknown): string {
 if (typeof value !== 'string') return '';
 const doi = value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
 return /^10\.\d{4,9}\/[^\s]+$/.test(doi) ? doi : '';
}
/** Parse comma-separated text. Retain quoted commas, newlines, and escaped quotes. */
export function parseCsv(input: string): Csv {
 if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error('CSV exceeds the 20 MB limit.');
 const text = input.replace(/^\uFEFF/, '');
 const records: CsvRow[] = []; let cells: string[] = []; let cell = ''; let quoted = false; let closed = false; let warning = ''; let line = 1; let start = 1;
 const finishCell = () => { cells.push(cell); cell = ''; closed = false; };
 const finishRow = () => { finishCell(); if (cells.some(x => x !== '') || warning) records.push({ cells, line: start, warning }); cells = []; warning = ''; start = line + 1; };
 for (let i = 0; i < text.length; i++) {
  const ch = text[i]!;
  if (quoted) {
   if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
   else { cell += ch; if (ch === '\n') line++; }
  } else if (ch === ',') finishCell();
  else if (ch === '\n' || ch === '\r') { finishRow(); if (ch === '\r' && text[i + 1] === '\n') i++; line++; }
  else if (ch === '"' && cell === '' && !closed) quoted = true;
  else { if (closed || ch === '"') warning = 'Invalid quote placement'; cell += ch; }
 }
 if (quoted) warning = 'Unclosed quoted field';
 if (cell || cells.length || warning) finishRow();
 const header = records.shift(); const headers = header?.cells ?? [];
 if (header?.warning) throw new Error('Invalid CSV header.');
 if (headers.length === 0 || new Set(headers).size !== headers.length || headers.some(h => !h.trim())) throw new Error('CSV needs unique nonempty column names.');
 return { headers, rows: records.map(r => ({ ...r, warning: r.warning || (r.cells.length !== headers.length ? 'Column count differs from header' : '') })) };
}
export function defaultMap(headers: string[]): ColumnMap {
 const find = (names: string[]) => headers.findIndex(h => names.includes(h.trim().toLowerCase()));
 return { doi: find(['originalpaperdoi']) >= 0 ? find(['originalpaperdoi']) : find(['doi']), type: find(['noticetype', 'notice type', 'type', 'retractionnature']), date: find(['noticedate', 'notice date', 'date', 'retractiondate']) };
}
export function reviewId(path: string, doi: string, type: string, date: string): string { return JSON.stringify([path, doi, type.trim(), date.trim()]); }
/** Only bracketed simple Pandoc keys. Punctuation is internal only. Leave source text unchanged. */
export function citationKeys(text: string): string[] {
 const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
 const keys = new Set<string>();
 for (const bracket of body.matchAll(/\[([^\]\n]+)\]/g)) for (const m of bracket[1]!.matchAll(/(?:^|[\s;])-?@([A-Za-z0-9_](?:[A-Za-z0-9_]|[:./-](?=[A-Za-z0-9_]))*)/g)) keys.add(m[1]!);
 return [...keys];
}
export function buildQueue(csv: Csv, map: ColumnMap, notes: Note[], checked: Record<string, boolean> = {}): Queue {
 const items: ReviewItem[] = []; const warnings: string[] = []; let matchedRows = 0;
 if (![map.doi, map.type, map.date].every(i => Number.isInteger(i) && i >= 0 && i < csv.headers.length)) return { items, warnings: ['Map the DOI, notice type, and date columns.'], matchedRows };
 const keyOwners = new Map<string, Note[]>();
 for (const n of notes) if (typeof n.citekey === 'string' && n.citekey.trim()) { const k = n.citekey.trim(); const owners = keyOwners.get(k); if (owners) owners.push(n); else keyOwners.set(k, [n]); }
 const citations = new Map(notes.map(n => [n.path, citationKeys(n.text)]));
 // Indexes keep matching near linear for large lists and vaults. Items keep the note order.
 const byDoi = new Map<string, number[]>(); const linkers = new Map<string, number[]>(); const citers = new Map<string, number[]>();
 const add = <T>(m: Map<string, T[]>, k: string, v: T) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
 notes.forEach((n, i) => { const d = normalizeDoi(n.doi); if (d) add(byDoi, d, i); for (const l of new Set(n.links)) add(linkers, l, i); for (const k of citations.get(n.path)!) add(citers, k, i); });
 for (const row of csv.rows) {
  const doi = normalizeDoi(row.cells[map.doi]);
  if (row.warning || !doi) { warnings.push(`Row ${row.line}: ${row.warning || 'DOI is unavailable or invalid'}.`); continue; }
  const refs = byDoi.get(doi) ?? [];
  if (refs.length) matchedRows++;
  for (const r of refs) {
   const ref = notes[r]!;
   const key = typeof ref.citekey === 'string' ? ref.citekey.trim() : '';
   const ambiguous = key !== '' && (keyOwners.get(key)?.length ?? 0) > 1;
   if (ambiguous) warnings.push(`Row ${row.line}: citekey ${key} has several reference notes; citation matches are excluded.`);
   const candidates = new Set([r, ...(linkers.get(ref.path) ?? []), ...(key && !ambiguous ? citers.get(key) ?? [] : [])]);
   for (const note of [...candidates].sort((a, b) => a - b).map(i => notes[i]!)) {
    const reason = note.path === ref.path ? 'Reference DOI' : note.links.includes(ref.path) ? 'Native link' : key && !ambiguous && citations.get(note.path)?.includes(key) ? `Pandoc @${key}` : '';
    if (!reason) continue;
    const type = row.cells[map.type]!.trim(); const date = row.cells[map.date]!.trim();
    const id = reviewId(note.path, doi, type, date);
    items.push({ id, path: note.path, reference: ref.path, doi, type, date, row: [...row.cells], line: row.line, reason, checked: checked[id] === true });
   }
  }
 }
 return { items, warnings: [...new Set(warnings)], matchedRows };
}
export function localReport(queue: Queue, source: string, fileDate: string, now: string): string {
 return JSON.stringify({ created: now, source, fileDate, matchedRows: queue.matchedRows, warnings: queue.warnings, items: queue.items }, null, 2) + '\n';
}
