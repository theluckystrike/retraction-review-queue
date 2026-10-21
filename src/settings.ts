import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type ReviewPlugin from './main';
import type { ColumnMap } from './engine';
import { helloSettingItems } from './hello/settings';
export interface ReviewSettings { doiProperty: string; citekeyProperty: string; checked: Record<string, boolean>; maps: Record<string, ColumnMap> }
export function normalizeSettings(value: unknown): ReviewSettings {
 const s = value && typeof value === 'object' ? value as Partial<ReviewSettings> : {};
 const checked: Record<string, boolean> = {};
 if (s.checked && typeof s.checked === 'object') for (const [k, v] of Object.entries(s.checked)) if (v === true) checked[k] = true;
 const maps: Record<string, ColumnMap> = {};
 if (s.maps && typeof s.maps === 'object') for (const [k, v] of Object.entries(s.maps)) if (v && [v.doi, v.type, v.date].every(n => Number.isInteger(n) && n >= 0)) maps[k] = { doi: v.doi, type: v.type, date: v.date };
 return { doiProperty: typeof s.doiProperty === 'string' && s.doiProperty.trim() ? s.doiProperty.trim() : 'doi', citekeyProperty: typeof s.citekeyProperty === 'string' && s.citekeyProperty.trim() ? s.citekeyProperty.trim() : 'citekey', checked, maps };
}
export class ReviewSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly review: ReviewPlugin) { super(app, review); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   ...(this.review.pro ? sponsorsSettingItems(this.review.pro, PRO_UI) : []),
   { name: 'DOI property', desc: 'The reference note property with one DOI string. Case is significant in the property name.', control: { type: 'text', key: 'doiProperty', defaultValue: 'doi' } },
   { name: 'Citekey property', desc: 'The reference note property with one simple Pandoc key.', control: { type: 'text', key: 'citekeyProperty', defaultValue: 'citekey' } },
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  await super.setControlValue(key, value);
  this.review.settings = normalizeSettings(this.review.settings);
  await this.review.saveSettings();
 }
}
