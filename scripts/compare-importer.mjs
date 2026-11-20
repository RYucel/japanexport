import fs from 'node:fs';
import { getFx } from '../src/fx.js';
import { computeLanded } from '../public/lib/landed.js';
import { resolveOptions } from '../src/pipeline.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const raw = JSON.parse(fs.readFileSync(new URL('../data/cache/scan-2026-11-20-rav4.json', import.meta.url), 'utf8'));
const fx = await getFx();
const car = raw.cars.find((c) => c.stockId === 'DCY7356') || raw.cars[0];

for (const importer of ['galeri', 'sahis']) {
  const runCfg = { ...cfg, customs: { ...cfg.customs, importerType: importer, vehicleType: 'suv' } };
  const opts = resolveOptions(runCfg, {});
  const L = computeLanded(car, fx, opts);
  console.log(
    importer.padEnd(7),
    'navlun', Math.round(L.freightUsd), '$',
    '| vergi', Math.round(L.taxes.totalTaxTry).toLocaleString('tr-TR'), '₺',
    '| toplam £', Math.round(L.totalGbp),
    '| vergi oranı %', (L.taxes.effectiveRate * 100).toFixed(1)
  );
}
console.log('\naraç:', car.title, '| FOB ¥', car.priceAmount);
