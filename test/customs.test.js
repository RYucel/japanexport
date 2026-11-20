import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCustoms, customsRate, fifRate, vatRate } from '../public/lib/customs.js';

const CIF = 1_000_000; // 1.000.000 ₺

test('Japonya menşeli 2.0 benzinli SUV: gümrük %10, FİF %3, KDV %20', () => {
  const r = computeCustoms({ cifTry: CIF, vehicleType: 'suv', fuel: 'benzin', cc: 2000, origin: 'japonya' });
  assert.equal(r.rates.customs, 0.1);
  assert.equal(r.rates.fif, 0.03);
  assert.equal(r.rates.vat, 0.2);
});

test('2.5 litrelik hibrit SUV FİF dilimi %8', () => {
  assert.equal(fifRate({ vehicleType: 'suv', fuel: 'benzin', cc: 2500, originGroup: 'other' }), 0.08);
});

test('Avrupa menşeli benzinli binek 2000cc altı gümrükten muaf', () => {
  assert.equal(customsRate({ vehicleType: 'suv', fuel: 'benzin', cc: 1998, originGroup: 'avrupa' }), 0);
});

test('şahıs ithalatında %15 özel fon var, stopaj yok', () => {
  const r = computeCustoms({ cifTry: CIF, importer: 'sahis', cc: 2000 });
  assert.equal(r.rates.ozelFon, 0.15);
  assert.equal(r.rates.stopaj, 0);
  assert.equal(r.lines.find((l) => l.key === 'ozelFon').amountTry, CIF * 0.15);
});

test('galeri ithalatında stopaj %4 var, özel fon yok', () => {
  const r = computeCustoms({ cifTry: CIF, importer: 'galeri', cc: 2000 });
  assert.equal(r.rates.ozelFon, 0);
  assert.equal(r.rates.stopaj, 0.04);
});

test('KDV matrahı stopaj hariç tüm vergileri içerir', () => {
  const r = computeCustoms({ cifTry: CIF, importer: 'galeri', cc: 2000 });
  const expectedBase =
    CIF + r.lines.find((l) => l.key === 'customs').amountTry +
    r.lines.find((l) => l.key === 'fif').amountTry +
    r.lines.find((l) => l.key === 'wharf').amountTry +
    r.lines.find((l) => l.key === 'gkk').amountTry +
    r.lines.find((l) => l.key === 'bandrol').amountTry;
  assert.ok(Math.abs(r.vatBaseTry - expectedBase) < 0.01);
});

test('elektrikli araçta KDV %5, FİF %5', () => {
  const r = computeCustoms({ cifTry: CIF, fuel: 'elektrik', cc: 0 });
  assert.equal(vatRate({ fuel: 'elektrik' }), 0.05);
  assert.equal(r.rates.fif, 0.05);
  assert.equal(r.rates.vat, 0.05);
});

test('Ercan (hava) girişinde rıhtım harcı alınmaz', () => {
  const r = computeCustoms({ cifTry: CIF, mode: 'ercan' });
  assert.equal(r.rates.wharf, 0);
  assert.equal(r.lines.find((l) => l.key === 'wharf').amountTry, 0);
});

test('toplam vergi = satırların toplamı, genel toplam = CIF + vergi', () => {
  const r = computeCustoms({ cifTry: CIF, cc: 2500 });
  const sum = r.lines.reduce((a, l) => a + l.amountTry, 0);
  assert.ok(Math.abs(sum - r.totalTaxTry) < 0.01);
  assert.ok(Math.abs(r.grandTotalTry - (CIF + r.totalTaxTry)) < 0.01);
});
