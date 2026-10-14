import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
interface Item { id: string; path: string; type: string; checked: boolean; reason: string }
interface Q { items: Item[]; warnings: string[]; matchedRows: number }
interface M { ready: Promise<void>; load(path: string): Promise<void>; scan(): Promise<void>; draw(): void; map: { doi: number; type: number; date: number }; queue: Q; fileDate: string; path: string; close(): void }
interface P {
 openReview(): void; modal: M; loadSettings(): Promise<void>; saveSettings(): Promise<void>;
 settings: { checked: Record<string, boolean>; maps: Record<string, unknown> };
 mark(id: string, checked: boolean): Promise<void>;
 saveMap(path: string, map: M['map']): Promise<boolean>;
 exportReport(queue: Q, source: string, date: string): Promise<string | null>;
 pro: { signOut(): void; refreshNow(): Promise<void>; opts: { http: () => Promise<unknown> } };
}
async function waitMetadata(): Promise<void> {
 await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
  const f = app.vault.getFileByPath('Refs/Study.md');
  return !!f && !!app.metadataCache.getFileCache(f)?.frontmatter && !!app.metadataCache.resolvedLinks['Manuscript.md']?.['Refs/Study.md'] && !!app.metadataCache.resolvedLinks['Welcome.md']?.['Refs/Study.md'];
 }), { timeout: 15000, timeoutMsg: 'Reference properties and native links must resolve before matching.' });
}
async function openCsv(path = 'notices.csv'): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, path) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
  p.openReview(); await p.modal.ready; await p.modal.load(path); p.modal.draw();
 }, pluginId, path);
}
async function state(): Promise<{ queue: Q; fileDate: string; map: M['map'] }> {
 return browser.executeObsidian(({ app }, id) => {
  const m = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!.modal;
  return { queue: m.queue, fileDate: m.fileDate, map: m.map };
 }, pluginId);
}
async function matchFromUi(): Promise<void> {
 const button = await browser.$('.rrq-actions button'); await button.click();
 await browser.waitUntil(async () => await (await browser.$('.rrq-count')).isExisting() && !await (await browser.$('.rrq-status')).isExisting(), { timeout: 15000 });
}
describe('local notice review in the real app', () => {
 it('loads and reloads without captured errors', async () => { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
 it('selects the paper DOI column and lists references and manuscripts', async () => {
  await waitMetadata(); await openCsv(); const before = await state(); expect(before.map).toEqual({ doi: 0, type: 2, date: 3 });
  await matchFromUi(); const { queue, fileDate } = await state();
  expect(queue.matchedRows).toBe(2); expect(queue.items).toHaveLength(8); expect(fileDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(queue.items.filter(i => i.path === 'Manuscript.md').map(i => i.reason)).toEqual(['Native link', 'Native link']);
  expect(queue.items.filter(i => i.path === 'Pandoc draft.md').map(i => i.reason)).toEqual(['Pandoc @Lee2020', 'Pandoc @Lee2020']);
  expect(queue.warnings[0]).toContain('DOI is unavailable');
  expect(queue.items.filter(i => i.path === 'Refs/Study.md').map(i => i.type)).toEqual(['Correction', 'Retraction']);
 });
 it('shows the complete supplied quoted field', async () => {
  const summary = await browser.$('.rrq-item details summary'); await summary.click();
  const dd = await browser.$('.rrq-item details dd:last-child'); expect(await dd.getText()).toContain('Cell response, revised methods\nSource notice supplied by the researcher');
 });
 it('keeps a checked state after another import and leaves note text unchanged', async () => {
  const before = await browser.executeObsidian(async ({ app }) => app.vault.read(app.vault.getFileByPath('Pandoc draft.md')!));
  const checkbox = await browser.$('.rrq-item input[type="checkbox"]'); await checkbox.click();
  await browser.waitUntil(async () => (await state()).queue.items[0]!.checked, { timeout: 10000 });
  await openCsv(); await matchFromUi(); expect((await state()).queue.items[0]!.checked).toBe(true);
  const after = await browser.executeObsidian(async ({ app }) => app.vault.read(app.vault.getFileByPath('Pandoc draft.md')!)); expect(after).toBe(before);
 });
 it('blocks Pro actions when signed out without blocking core imports', async () => {
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
   p.pro.signOut(); return { saved: await p.saveMap('notices.csv', p.modal.map), report: await p.exportReport(p.modal.queue, p.modal.path, p.modal.fileDate), count: p.modal.queue.items.length };
  }, pluginId); expect(result).toEqual({ saved: false, report: null, count: 8 });
 });
 it('saves maps and exports through a supplied GitHub Sponsors answer', async () => {
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
   p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
   app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36)); await p.pro.refreshNow();
   const saved = await p.saveMap('notices.csv', p.modal.map); const second = await p.saveMap('zero.csv', { doi: 0, type: 1, date: 2 });
   const path = await p.exportReport(p.modal.queue, p.modal.path, p.modal.fileDate);
   const file = path ? app.vault.getFileByPath(path) : null; const report = file ? JSON.parse(await app.vault.read(file)) as { source: string; items: unknown[]; created: string } : null;
   if (file) await app.vault.delete(file); p.pro.signOut();
   return { saved, second, path, report };
  }, pluginId);
  expect(result.saved).toBe(true); expect(result.second).toBe(true); expect(result.path).toMatch(/^Retraction review \d/); expect(result.report?.source).toBe('notices.csv'); expect(result.report?.items).toHaveLength(8);
 });
 it('shows zero matches and a file date without a safety claim', async () => {
  await browser.$('.rrq-source select').selectByAttribute('value', 'zero.csv');
  await browser.waitUntil(async () => browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!.modal.path === 'zero.csv', pluginId), { timeout: 10000 });
  await matchFromUi(); const s = await state(); expect(s.queue.items).toHaveLength(0); expect(s.queue.matchedRows).toBe(0); expect(s.fileDate).toMatch(/^\d{4}-/);
  expect(await browser.$('.rrq-empty').getText()).toBe('No affected notes found with this column map.');
 });
});
