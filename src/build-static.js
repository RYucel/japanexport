#!/usr/bin/env node
/**
 * Statik site üretimi (GitHub Actions / Cloudflare Pages).
 * Her model için: tara → maliyet/skor hesapla → public/data/<model>.json + rapor HTML.
 *
 * Kullanım:
 *   node src/build-static.js                    # tüm modeller, canlı tarama
 *   node src/build-static.js --models=rav4,corolla
 *   node src/build-static.js --no-refresh       # günlük önbelleği kullan
 */
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getRawScan, computeView, commitScan } from './pipeline.js';
import { getFx } from './fx.js';
import { loadModels, searchFor, listModels } from './models.js';
import { buildMeta, leanCars } from './view.js';
import { loadState } from './store.js';
import { buildReport, renderReportHtml } from './report.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const onlyArg = args.find((a) => a.startsWith('--models='));
const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;

const OUT_DATA = path.resolve('public', 'data');
const OUT_REPORTS = path.resolve('public', 'reports');
const REPORT_DIR = path.resolve('data', 'reports');

const cfg = JSON.parse(await readFile(path.resolve('config.json'), 'utf8'));
const models = await loadModels();
const keys = only || Object.keys(models);

const alertsCfg = await readFile(path.resolve('alerts.json'), 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() => ({ alerts: [] }));
const activeAlerts = (alertsCfg.alerts || []).filter((a) => a.enabled !== false);
const alertMatches = new Map(activeAlerts.map((a) => [a.name, { alert: a, cars: [] }]));

await mkdir(OUT_DATA, { recursive: true });
await mkdir(OUT_REPORTS, { recursive: true });

console.log(`\n🏗️  Statik site üretimi · ${keys.length} model`);
console.log('─'.repeat(64));

const fx = await getFx({ force: !has('--no-refresh') });
console.log(`💱  1 £ = ${fx.gbpTry.toFixed(2)} ₺ · 100 ¥ = ${(fx.jpyTry * 100).toFixed(2)} ₺`);

const built = [];
const failed = [];

for (const key of keys) {
  const model = models[key];
  const search = searchFor(cfg.search, key, model);
  const runCfg = { ...cfg, search, customs: { ...cfg.customs, vehicleType: model.vehicleType } };

  process.stdout.write(`\n🚗  ${model.label} … `);
  try {
    const raw = await getRawScan(runCfg, {
      refresh: !has('--no-refresh'),
      cacheKey: key,
      onProgress: (p) => {
        if (p.page === 1 || p.page % 5 === 0) {
          process.stdout.write(`\r🚗  ${model.label} · ${(p.label || '').replace(' Exchange', '')} sayfa ${p.page} · ${p.total} ilan   `);
        }
      }
    });

    const state = await loadState(key);
    const view = await computeView({ cfg: runCfg, raw, fx, state, params: {} });
    const { gone } = await commitScan(raw, { ...view.summary, label: model.label }, view.cars, key);

    // Alert profilleri: bu modelin uygun ilanlarını filtrele
    for (const entry of alertMatches.values()) {
      const a = entry.alert;
      if (a.models?.length && !a.models.includes(key)) continue;
      for (const c of view.cars) {
        if (!c.eligible) continue;
        if (a.maxPriceGbp > 0 && c.landed.totalGbp > a.maxPriceGbp) continue;
        if (a.minPriceGbp > 0 && c.landed.totalGbp < a.minPriceGbp) continue;
        if (a.maxKm > 0 && (c.mileageKm || 0) > a.maxKm) continue;
        if (a.minYear > 0 && (c.regYear || 0) < a.minYear) continue;
        if (a.fuel === 'hybrid' && !/HYBRID/i.test(c.fuel || '')) continue;
        if (a.fuel === 'petrol' && /HYBRID|DIESEL/i.test(c.fuel || '')) continue;
        if (a.drive && c.drive !== a.drive) continue;
        if (a.minGapPct > 0 && c.analysis.valueGap * 100 < a.minGapPct) continue;

        entry.cars.push({
          model: model.label,
          key,
          ym: `${c.regYear}/${String(c.regMonth || 1).padStart(2, '0')}`,
          grade: (c.grade || '').trim(),
          km: c.mileageKm,
          totalGbp: Math.round(c.landed.totalGbp),
          gap: Math.round(c.analysis.valueGap * 1000) / 10,
          score: c.analysis.score,
          url: c.url
        });
      }
    }

    const meta = buildMeta({ modelKey: key, model, raw, fx, opts: view.opts, cfg: runCfg, cached: raw.cached });
    await writeFile(path.join(OUT_DATA, `${key}.json`), JSON.stringify({ meta, cars: leanCars(view.cars) }), 'utf8');

    const md = buildReport({
      date: raw.date,
      cars: view.cars,
      summary: { ...view.summary, label: model.label },
      gone,
      fx,
      opts: view.opts
    });
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(path.join(REPORT_DIR, `${raw.date}-${key}.md`), md, 'utf8');
    await writeFile(
      path.join(OUT_REPORTS, `${raw.date}-${key}.html`),
      renderReportHtml(md, { title: `${model.label} · ${raw.date}` }),
      'utf8'
    );

    built.push({
      key,
      label: model.label,
      total: view.summary.total,
      eligible: view.summary.eligible,
      medianLandedGbp: Math.round(view.summary.medianLandedGbp || 0),
      top: view.cars
        .filter((c) => c.eligible)
        .slice(0, 12)
        .map((c) => ({
          ym: `${c.regYear}/${String(c.regMonth || 1).padStart(2, '0')}`,
          grade: (c.grade || '').replace(/^\d{4}(?:\/\d{1,2})?\s+/, '').trim(),
          km: c.mileageKm,
          totalGbp: Math.round(c.landed.totalGbp),
          gap: Math.round(c.analysis.valueGap * 1000) / 10,
          score: c.analysis.score,
          url: c.url
        }))
    });

    process.stdout.write(
      `\r✅  ${model.label.padEnd(22)} ${String(view.summary.eligible).padStart(4)}/${String(view.summary.total).padEnd(4)} uygun · medyan ${Math.round(view.summary.medianLandedGbp || 0)} £\n`
    );
  } catch (err) {
    failed.push({ key, error: err.message });
    process.stdout.write(`\r❌  ${model.label}: ${err.message}\n`);
  }
}

// Eski rapor dosyalarını temizle (yalnızca bugünkü)
try {
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const f of await readdir(OUT_REPORTS)) {
    if (f.endsWith('.html') && !f.startsWith(todayStr)) await unlink(path.join(OUT_REPORTS, f));
  }
} catch {
  /* yok */
}

const alertsOut = [...alertMatches.values()]
  .map((e) => ({
    name: e.alert.name,
    filters: {
      models: e.alert.models || [],
      maxPriceGbp: e.alert.maxPriceGbp || 0,
      minPriceGbp: e.alert.minPriceGbp || 0,
      maxKm: e.alert.maxKm || 0,
      minYear: e.alert.minYear || 0,
      fuel: e.alert.fuel || '',
      drive: e.alert.drive || '',
      minGapPct: e.alert.minGapPct || 0
    },
    matches: e.cars.sort((a, b) => b.score - a.score).slice(0, e.alert.topN || 5)
  }))
  .filter((a) => a.matches.length);

await writeFile(
  path.join(OUT_DATA, 'index.json'),
  JSON.stringify({ updatedAt: new Date().toISOString(), models: built, failed, alerts: alertsOut }, null, 2),
  'utf8'
);

await writeFile(
  path.join(OUT_DATA, 'alerts.json'),
  JSON.stringify(alertsCfg, null, 2),
  'utf8'
);

// Menüde yalnızca verisi üretilen modeller görünsün
const allModels = await listModels();
const builtKeys = new Set(built.map((b) => b.key));
const menuModels = allModels.filter((m) => builtKeys.has(m.key));
const defaultModel = builtKeys.has(cfg.activeModel) ? cfg.activeModel : menuModels[0]?.key || cfg.activeModel;
await writeFile(
  path.join(OUT_DATA, 'models.json'),
  JSON.stringify({ defaultModel, models: menuModels }, null, 2),
  'utf8'
);

console.log('\n' + '─'.repeat(64));
console.log(`📦  ${built.length} model yazıldı · ${failed.length} hata`);
if (failed.length) {
  for (const f of failed) console.log(`   ❌ ${f.key}: ${f.error}`);
}
console.log(`📁  Çıktı: ${OUT_DATA}\n`);
