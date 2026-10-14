import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vectors from './vectors.json';
import * as engine from '../src/engine';
const monoPath = resolve(__dirname, '../../../packages/spec/vectors/retraction-review-queue.json');
describe('golden cases', () => {
 it.skipIf(!existsSync(monoPath))('matches the factory vectors', () => { expect(JSON.parse(readFileSync(monoPath, 'utf8'))).toEqual(vectors); });
 for (const c of vectors.cases) it(c.name, () => { const fn = engine[c.function as keyof typeof engine] as (...args: unknown[]) => unknown; expect(fn(...c.args)).toEqual(c.expected); });
 it('has at least 20 cases', () => { expect(vectors.cases.length).toBeGreaterThanOrEqual(20); });
 it('rejects a file above the byte limit', () => { expect(() => engine.parseCsv('x'.repeat(engine.MAX_BYTES + 1))).toThrow('20 MB'); });
 it('checks UTF-8 bytes rather than character count', () => { expect(() => engine.parseCsv('é'.repeat(engine.MAX_BYTES / 2 + 1))).toThrow('20 MB'); });
 it('rejects duplicate column names', () => { expect(() => engine.parseCsv('DOI,DOI\n')).toThrow('unique'); });
 it('drops trailing punctuation from a Pandoc key', () => { expect(engine.citationKeys('[see @Lee2020.] [@Kim:2019a:, p. 3] [@a.b-c/d]')).toEqual(['Lee2020', 'Kim:2019a', 'a.b-c/d']); });
 it('preserves manuscript text', () => { const n = { path: 'm.md', doi: '', citekey: '', text: '[@Lee2020, 4]', links: [] }; const before = JSON.stringify(n); engine.buildQueue(engine.parseCsv('DOI,Type,Date\n10.1234/abc,Correction,2026'), { doi: 0, type: 1, date: 2 }, [n]); expect(JSON.stringify(n)).toBe(before); });
});
