#!/usr/bin/env node
/**
 * Respect Motors açık artırma lotlarını toplar → public/data/auctions.json
 *
 * Not: gösterilen fiyat **başlangıç fiyatıdır** (¥). Kesin satış fiyatı ihalede
 * oluşur ve Respect'te login gerektirir. Bu yüzden tutar "en az" olarak sunulur.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { scanModel } from './respect.js';
import { getFx } from './fx.js';
import { loadModels } from './models.js';
import { resolveOptions } from './pipeline.js';

const cfg = JSON.parse(await readFile(path.resolve('config.json'), 'utf8'));
const auc = cfg.auctions || {};
if (auc.enabled === false) {
  console.log('ℹ️  auctions.enabled=false — atlandı.');
  process.exit(0);
}

const models = await loadModels();
const keys = auc.models || ['rav4'];
const maxPages = auc.maxPages || 5;
const extraFeesJpy = auc.extraFeesJpy ?? 120000;
const yearFrom = new Date().getFullYear() - (cfg.customs?.maxAgeMonths ? Math.ceil(cfg.customs.maxAgeMonths / 12) : 5);

const fx = await getFx();
const out = [];

console.log(`\n🔨 Müzayede lotları · ${keys.length} model · ${yearFrom}+`);
console.log('─'.repeat(64));

for (const key of keys) {
  const model = models[key];
  if (!model) continue;

  process.stdout.write(`🚗  ${model.label} … `);
  try {
    const r = await scanModel(
      { make: model.make, model: model.sbtModel },
      {
        maxPages,
        onProgress: (p) => {
          if (p.page === 1 || p.page % 5 === 0) {
            process.stdout.write(`\r🚗  ${model.label} · sayfa ${p.page} · ${p.total} lot        `);
          }
        }
      }
    );

    const lots = r.lots
      .filter((l) => (l.regYear || 0) >= yearFrom && l.startJpy > 0)
      .map((l) => ({
        ...l,
        fuel: /HYBRID|PHV|PHEV/i.test(l.title) ? 'HYBRID' : 'PETROL',
        totalJpy: l.startJpy + extraFeesJpy
      }))
      .sort((a, b) => (b.regYear || 0) - (a.regYear || 0) || a.mileageKm - b.mileageKm);

    out.push({ key, label: model.label, scanned: r.lots.length, lots });

    process.stdout.write(
      `\r✅  ${model.label.padEnd(22)} ${String(lots.length).padStart(3)} uygun lot / ${r.lots.length} tarandı\n`
    );
  } catch (err) {
    process.stdout.write(`\r❌  ${model.label}: ${err.message}\n`);
  }
}

await mkdir(path.resolve('public', 'data'), { recursive: true });
await writeFile(
  path.resolve('public', 'data', 'auctions.json'),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      yearFrom,
      extraFeesJpy,
      fx: { jpyTry: fx.jpyTry, gbpTry: fx.gbpTry, usdTry: fx.usdTry, source: fx.source },
      opts: resolveOptions({ ...cfg, customs: { ...cfg.customs, vehicleType: 'suv' } }, {}),
      models: out
    },
    null,
    2
  ),
  'utf8'
);

const totalLots = out.reduce((a, m) => a + m.lots.length, 0);
console.log(`\n📦  ${totalLots} lot yazıldı · public/data/auctions.json\n`);
