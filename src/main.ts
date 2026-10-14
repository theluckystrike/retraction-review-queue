import { Notice, Plugin } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, resetPro, isPro } from './pro';
import { buildQueue, parseCsv, MAX_BYTES, localReport, type Csv, type ColumnMap, type Note, type Queue } from './engine';
import { normalizeSettings, ReviewSettingTab, type ReviewSettings } from './settings';
import { ReviewModal } from './view';
export default class ReviewPlugin extends Plugin {
 settings: ReviewSettings = normalizeSettings(null);
 pro: SponsorsManager | null = null;
 modal: ReviewModal | null = null;
 async onload(): Promise<void> {
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  const tab = new ReviewSettingTab(this.app, this); this.addSettingTab(tab);
  this.register(pro.onChange(() => { tab.update(); this.modal?.draw(); }));
  this.addCommand({ id: 'open-review', name: 'Open review queue', callback: () => this.openReview() });
  this.app.workspace.onLayoutReady(() => { void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000)); });
 }
 onunload(): void { this.modal?.close(); resetPro(); }
 openReview(): void { this.modal?.close(); this.modal = new ReviewModal(this); this.modal.open(); }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 async csvPaths(): Promise<string[]> {
  const files: string[] = []; const folders = ['']; let count = 0;
  while (folders.length && count < 2000) {
   const path = folders.shift()!; const list = await this.app.vault.adapter.list(path); count++;
   files.push(...list.files.filter(f => /\.csv$/i.test(f)));
   folders.push(...list.folders.filter(f => !f.split('/').some(p => p.startsWith('.'))));
  }
  return files.sort();
 }
 async readCsv(path: string): Promise<{ csv: Csv; fileDate: string }> {
  if (!/\.csv$/i.test(path) || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.split('/').some(p => !p || p === '..' || p.startsWith('.'))) throw new Error('Choose a CSV file inside this vault.');
  const stat = await this.app.vault.adapter.stat(path);
  if (!stat || stat.type !== 'file') throw new Error('CSV file was not found.');
  if (stat.size > MAX_BYTES) throw new Error('CSV exceeds the 20 MB limit.');
  return { csv: parseCsv(await this.app.vault.adapter.read(path)), fileDate: new Date(stat.mtime).toISOString() };
 }
 async match(csv: Csv, map: ColumnMap): Promise<Queue> {
  const notes: Note[] = [];
  for (const file of this.app.vault.getMarkdownFiles()) {
   const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
   notes.push({ path: file.path, doi: fm?.[this.settings.doiProperty], citekey: fm?.[this.settings.citekeyProperty], text: await this.app.vault.cachedRead(file), links: Object.keys(this.app.metadataCache.resolvedLinks[file.path] ?? {}) });
  }
  return buildQueue(csv, map, notes, this.settings.checked);
 }
 async mark(id: string, checked: boolean): Promise<void> {
  const previous = this.settings.checked[id];
  if (checked) this.settings.checked[id] = true; else delete this.settings.checked[id];
  try { await this.saveSettings(); } catch (error) { if (previous) this.settings.checked[id] = previous; else delete this.settings.checked[id]; throw error; }
 }
 async saveMap(path: string, map: ColumnMap): Promise<boolean> {
  if (!isPro()) { new Notice('Saved column maps need pro. Free imports work without pro.'); return false; }
  this.settings.maps[path] = { ...map }; await this.saveSettings(); return true;
 }
 async exportReport(queue: Queue, source: string, fileDate: string): Promise<string | null> {
  if (!isPro()) { new Notice('Local report export needs pro. The review queue is free.'); return null; }
  const now = new Date().toISOString(); const stamp = now.replace(/[:.]/g, '-');
  const file = await this.app.vault.create(`Retraction review ${stamp}.json`, localReport(queue, source, fileDate, now));
  new Notice(`Report saved to ${file.path}`); return file.path;
 }
}
