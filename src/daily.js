#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRawScan, computeView, commitScan } from './pipeline.js';
import { getFx } from './fx.js';
import { getModel, searchFor, listModels } from './models.js';
import { buildReport, writeReportFile, renderReportHtml, gbp, pct, trDate } from './report.js';
import { loadState, today } from './store.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

const cfg = JSON.parse(await readFile(path.resolve('config.json'), 'utf8'));

// --model=corolla  /  --model corolla
let modelKey = cfg.activeModel || 'rav4';
const eqArg = args.find((a) => a.startsWith('--model='));
const flagIdx = args.indexOf('--model');
if (eqArg) modelKey = eqArg.split('=')[1];
else if (flagIdx >= 0 && args[flagIdx + 1]) modelKey = args[flagIdx + 1];

const model = await getModel(modelKey);
if (!model) {
  console.error(`\n❌  Bilinmeyen model: "${modelKey}"`);
  const all = await listModels();
  console.error('    Seçenekler: ' + all.map((m) => m.key).join(', ') + '\n');
  process.exit(1);
}

const search = searchFor(cfg.search, modelKey, model);
const runCfg = { ...cfg, search, customs: { ...cfg.customs, vehicleType: model.vehicleType } };

console.log(`\n🚗  ${model.label} · KKTC gümrüklü fiyat taraması`);
console.log('─'.repeat(64));

const fx = await getFx({ force: has('--fx-refresh') });
console.log(`💱  Kur: 1 £ = ${fx.gbpTry.toFixed(2)} ₺ · 100 ¥ = ${(fx.jpyTry * 100).toFixed(2)} ₺  (${fx.source})`);

const raw = await getRawScan(runCfg, {
  refresh: !has('--no-refresh'),
  cacheKey: modelKey,
  onProgress: (p) => {
    const label = (p.label || p.source || '').replace(' Exchange', '');
    if (p.page === 1 || p.page % 5 === 0) {
      process.stdout.write(`\r📥  ${label} · sayfa ${p.page} · ${p.total} ilan        `);
    }
  }
});
process.stdout.write('\r' + ' '.repeat(60) + '\r');
console.log(`📦  ${raw.cars.length} ilan hazır (${raw.pagesFetched} sayfa, ${raw.cached ? 'önbellek' : 'canlı'})`);
if (raw.perSource?.length) {
  console.log('    ' + raw.perSource.map((s) => `${s.label}: ${s.count}`).join(' · '));
}

const state = await loadState(modelKey);
const view = await computeView({ cfg: runCfg, raw, fx, state, params: {} });

if (has('--scan')) {
  console.log(`\n✅  ${view.summary.eligible}/${view.summary.total} ilan 5 yaş kuralına uygun · medyan ${gbp(view.summary.medianLandedGbp)}\n`);
  process.exit(0);
}

const { gone } = await commitScan(raw, { ...view.summary, label: model.label }, view.cars, modelKey);

const date = today();
const md = buildReport({
  date,
  cars: view.cars,
  summary: { ...view.summary, label: model.label },
  gone,
  fx,
  opts: view.opts
});
const mdFile = await writeReportFile(`${date}-${modelKey}.md`, md);
const htmlFile = await writeReportFile(`${date}-${modelKey}.html`, renderReportHtml(md, { title: `${model.label} · ${date}` }));

const s = view.summary;
console.log('');
console.log(`✅  5 yaş kuralına uygun: ${s.eligible}/${s.total}`);
console.log(`💰  Medyan gümrüklü fiyat: ${gbp(s.medianLandedGbp)}   (en düşük ${gbp(s.minLandedGbp)})`);
console.log(`🧾  Ortalama vergi yükü: ${pct(s.medianTaxRate)}`);
console.log('');
console.log('🏆  En iyi 5 fırsat:');
for (const c of view.cars.filter((x) => x.eligible).slice(0, 5)) {
  const gap = c.analysis.valueGap >= 0 ? `−${pct(c.analysis.valueGap)}` : `+${pct(-c.analysis.valueGap)}`;
  const label = `${c.regYear}/${String(c.regMonth || 1).padStart(2, '0')} ${c.title.replace(/^\d{4}(?:\/\d{1,2})?\s+/, '')}`;
  const src = c.source === 'goonet' ? 'GN' : 'SBT';
  console.log(
    `   ${String(c.analysis.score).padStart(3)} | ${label.slice(0, 30).padEnd(30)} | ${gbp(c.landed.totalGbp).padStart(9)} | piyasa ${gap.padStart(7)} | ${src} ${c.stockId.replace(/^GN-/, '')}`
  );
}
console.log('');
console.log(`📄  Rapor: ${mdFile}`);
console.log(`🌐  HTML : ${htmlFile}`);
console.log(`ℹ️   Tarih: ${trDate(date)}`);
console.log('');
