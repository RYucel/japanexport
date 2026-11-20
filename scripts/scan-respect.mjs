import { scanModel } from '../src/respect.js';

const [make = 'TOYOTA', model = 'RAV4', yearFrom = '2022'] = process.argv.slice(2);
const r = await scanModel(
  { make, model, yearFrom: Number(yearFrom) || undefined },
  { maxPages: 3, onProgress: (p) => console.log('sayfa', p.page, 'lot', p.total) }
);
console.log('toplam ilan:', r.total, '| sayfa:', r.pages, '| alınan lot:', r.lots.length);
console.log(r.lots.slice(0, 4).map((l) => `${l.title} | ${l.mileageKm} km | ¥${l.startJpy || '—'} | ${l.auction}`));
