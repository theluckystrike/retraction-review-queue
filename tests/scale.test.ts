import { describe, expect, it } from 'vitest';
import { buildQueue, parseCsv, type Note } from '../src/engine';
describe('large inputs', () => {
 it('matches 20,000 rows against 5,000 notes in less than 2 seconds', () => {
  const lines = ['DOI,Type,Date']; for (let i = 0; i < 20000; i++) lines.push(`10.1234/r${i},Retraction,2026-01-01`);
  const notes: Note[] = []; for (let i = 0; i < 5000; i++) notes.push({ path: `Refs/${i}.md`, doi: `10.1234/r${i * 4}`, citekey: `k${i}`, text: '', links: [] });
  const csv = parseCsv(lines.join('\n')); const start = performance.now();
  const queue = buildQueue(csv, { doi: 0, type: 1, date: 2 }, notes);
  expect(performance.now() - start).toBeLessThan(2000);
  expect(queue.matchedRows).toBe(5000); expect(queue.items).toHaveLength(5000);
 });
});
