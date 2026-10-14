import { Modal, Notice } from 'obsidian';
import type ReviewPlugin from './main';
import { defaultMap, type Csv, type ColumnMap, type Queue } from './engine';
import { isPro } from './pro';
function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
 const node = createEl(tag); node.textContent = text; if (cls) node.className = cls; parent.appendChild(node); return node;
}
export class ReviewModal extends Modal {
 path = ''; fileDate = ''; csv: Csv | null = null; map: ColumnMap = { doi: -1, type: -1, date: -1 }; queue: Queue | null = null;
 reportPath = ''; reportText = ''; paths: string[] = []; error = ''; busy = false; ready: Promise<void> = Promise.resolve();
 constructor(readonly plugin: ReviewPlugin) { super(plugin.app); }
 async onOpen(): Promise<void> {
  this.modalEl.classList.add('rrq-modal'); this.titleEl.textContent = 'Retraction review queue'; this.draw();
  this.ready = this.run(async () => { this.paths = await this.plugin.csvPaths(); }); await this.ready;
 }
 onClose(): void { if (this.plugin.modal === this) this.plugin.modal = null; }
 async run(action: () => Promise<void>): Promise<void> {
  if (this.busy) return; this.busy = true; this.error = ''; this.draw();
  try { await action(); } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  finally { this.busy = false; this.draw(); }
 }
 button(parent: HTMLElement, name: string, action: () => Promise<void>): HTMLButtonElement {
  const button = el(parent, 'button', name); button.disabled = this.busy;
  button.addEventListener('click', () => void this.run(action)); return button;
 }
 async load(path: string): Promise<void> {
  const { csv, fileDate } = await this.plugin.readCsv(path);
  this.path = path; this.csv = csv; this.fileDate = fileDate; this.queue = null; this.reportPath = ''; this.reportText = '';
  this.map = { ...(isPro() ? this.plugin.settings.maps[path] ?? defaultMap(csv.headers) : defaultMap(csv.headers)) };
 }
 async scan(): Promise<void> { if (this.csv) this.queue = await this.plugin.match(this.csv, this.map); }
 draw(): void {
  const root = this.contentEl; root.replaceChildren();
  el(root, 'p', 'Compare a local notice list with reference notes. A match is a review prompt, not a finding about the paper.', 'rrq-intro');
  if (isPro()) el(root, 'p', 'Pro is active. Saved column maps and local report export are available.', 'rrq-pro');
  const source = el(root, 'div', '', 'rrq-source');
  const label = el(source, 'label', 'Notice CSV in this vault');
  const select = el(label, 'select'); select.setAttribute('aria-label', 'Notice CSV'); select.disabled = this.busy;
  el(select, 'option', 'Select a CSV file').value = '';
  for (const path of this.paths) el(select, 'option', path).value = path;
  select.value = this.path;
  select.addEventListener('change', () => { if (select.value) void this.run(() => this.load(select.value)); });
  const direct = el(source, 'input'); direct.placeholder = 'Folder/notices.csv'; direct.setAttribute('aria-label', 'CSV path'); direct.value = this.path;
  this.button(source, 'Load CSV', () => this.load(direct.value.trim()));
  el(root, 'p', 'CSV limit: 20 MB. The picker searches up to 2,000 folders. You can enter a vault path.', 'rrq-muted');
  if (this.error) el(root, 'p', this.error, 'rrq-error');
  if (this.csv) {
   el(root, 'p', `${this.path} · File date ${this.fileDate} · ${this.csv.rows.length} supplied rows`, 'rrq-file');
   if (isPro() && this.plugin.settings.maps[this.path]) el(root, 'p', 'A column map is saved for this notice list.', 'rrq-saved-map');
   const maps = el(root, 'div', '', 'rrq-maps');
   for (const [key, name] of [['doi', 'Paper DOI'], ['type', 'Notice type'], ['date', 'Notice date']] as const) {
    const l = el(maps, 'label', name); const s = el(l, 'select'); s.setAttribute('aria-label', name); s.disabled = this.busy;
    el(s, 'option', 'Select a column').value = '-1';
    this.csv.headers.forEach((h, i) => { el(s, 'option', h).value = String(i); }); s.value = String(this.map[key]);
    s.addEventListener('change', () => { this.map[key] = Number(s.value); this.queue = null; this.draw(); });
   }
   const actions = el(root, 'div', '', 'rrq-actions');
   this.button(actions, 'Match notes', () => this.scan());
   this.button(actions, 'Save column map (Pro)', async () => { if (await this.plugin.saveMap(this.path, this.map)) new Notice('Column map saved for this list.'); });
   if (this.queue) this.button(actions, 'Export local report (Pro)', async () => { if (this.queue) { const path = await this.plugin.exportReport(this.queue, this.path, this.fileDate); if (path) { this.reportPath = path; this.reportText = await this.app.vault.adapter.read(path); } } });
  }
  if (this.busy) el(root, 'p', 'Reading local files…', 'rrq-status');
  if (this.reportPath) { const report = el(root, 'details', '', 'rrq-report'); report.open = true; el(report, 'summary', `Saved local report: ${this.reportPath}`); el(report, 'pre', this.reportText); }
  const q = this.queue;
  if (!q) return;
  el(root, 'h3', `${q.matchedRows} matched notice rows · ${q.items.length} review items`, 'rrq-count');
  el(root, 'p', 'The list can be incomplete or old. Zero matches do not establish paper safety or list currency.', 'rrq-muted');
  for (const warning of q.warnings) el(root, 'p', warning, 'rrq-warning');
  if (!q.items.length) el(root, 'p', 'No affected notes found with this column map.', 'rrq-empty');
  const list = el(root, 'div', '', 'rrq-list');
  for (const item of q.items.slice(0, 500)) {
   const card = el(list, 'article', '', 'rrq-item'); const head = el(card, 'div', '', 'rrq-item-head');
   const label = el(head, 'label'); const check = el(label, 'input'); check.type = 'checkbox'; check.checked = item.checked; check.disabled = this.busy; check.setAttribute('aria-label', `Checked ${item.path}`); label.appendChild(document.createTextNode(' Checked'));
   check.addEventListener('change', () => void this.run(async () => { await this.plugin.mark(item.id, check.checked); for (const i of q.items) if (i.id === item.id) i.checked = check.checked; }));
   const link = el(head, 'a', item.path, 'internal-link'); link.href = item.path;
   link.addEventListener('click', e => { e.preventDefault(); void this.run(async () => { await this.app.workspace.openLinkText(item.path, '', true); }); });
   el(card, 'p', `${item.type || '(No type)'} · ${item.date || '(No date)'} · ${item.reason}`);
   el(card, 'p', `Reference: ${item.reference} · DOI ${item.doi}`, 'rrq-muted');
   const details = el(card, 'details'); el(details, 'summary', `Supplied notice row ${item.line}`);
   const dl = el(details, 'dl'); item.row.forEach((value, i) => { el(dl, 'dt', this.csv?.headers[i] ?? String(i)); el(dl, 'dd', value); });
  }
  if (q.items.length > 500) el(root, 'p', 'The view shows the first 500 items. A Pro report includes the complete result.');
 }
}
