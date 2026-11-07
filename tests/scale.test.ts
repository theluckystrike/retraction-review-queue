import { describe, expect, it } from 'vitest';
import { buildQueue, parseCsv, type Note } from '../src/engine';
import { GROWTH_LIMIT, growth } from './growth';
describe('large inputs', () => {
 it('matches 20,000 rows against 5,000 notes in time that grows linearly with the input', () => {
  const inputOf = (rows: number) => {
   const lines = ['DOI,Type,Date']; for (let i = 0; i < rows; i++) lines.push(`10.1234/r${i},Retraction,2026-01-01`);
   const notes: Note[] = []; for (let i = 0; i < rows / 4; i++) notes.push({ path: `Refs/${i}.md`, doi: `10.1234/r${i * 4}`, citekey: `k${i}`, text: '', links: [] });
   return { csv: parseCsv(lines.join('\n')), notes };
  };
  const { csv, notes } = inputOf(20000);
  const queue = buildQueue(csv, { doi: 0, type: 1, date: 2 }, notes);
  // Growth guard (s1101): 20,000 rows and 5,000 notes against 2,000 rows and 500 notes, timed in this test.
  const g = growth((rows) => { const x = inputOf(rows); return () => buildQueue(x.csv, { doi: 0, type: 1, date: 2 }, x.notes); }, 20000);
  expect(g.ratio, g.text).toBeLessThan(GROWTH_LIMIT);
  expect(queue.matchedRows).toBe(5000); expect(queue.items).toHaveLength(5000);
 });
});
