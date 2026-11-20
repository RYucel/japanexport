import fs from 'node:fs';
import { buildSearchUrl, fetchPage } from '../src/sbt.js';
import { loadModels, searchFor } from '../src/models.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const models = await loadModels();

const keys = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(models);

for (const k of keys) {
  const model = models[k];
  if (!model) { console.log('yok:', k); continue; }
  try {
    const s = searchFor(cfg.search, k, model);
    const html = await fetchPage(buildSearchUrl(s, 1));
    const m = /<span class="search-result__result-number">\s*([\d,]+)\s*<\/span>/.exec(html);
    console.log(String(m ? m[1] : '0').padStart(6), k.padEnd(14), model.label);
  } catch (e) {
    console.log('  HATA', k, e.message);
  }
  await new Promise((r) => setTimeout(r, 400));
}
