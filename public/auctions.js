import { computeLanded } from './lib/landed.js';

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const gbp = (n) => '£' + nf.format(Math.round(n));
const jpy = (n) => '¥' + nf.format(Math.round(n));
const km = (n) => (n == null ? '—' : nf.format(n) + ' km');

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function lotCard(lot, ctx) {
  const car = {
    priceAmount: lot.totalJpy,
    priceCurrency: 'JPY',
    regYear: lot.regYear,
    regMonth: 1,
    engineCc: lot.engineCc || 2000,
    fuel: lot.fuel,
    mileageKm: lot.mileageKm || 0
  };
  const landed = computeLanded(car, ctx.fx, { ...ctx.opts, vehicleType: 'suv' });

  return `
  <article class="lot">
    <div class="lot-media">
      ${lot.image ? `<img src="${lot.image}" alt="${lot.title}" loading="lazy" referrerpolicy="no-referrer">` : ''}
    </div>
    <div class="lot-body">
      <h3 class="lot-title">${lot.title}</h3>
      <div class="lot-sub">Lot ${lot.lotNo || '—'} · ${lot.auction || '—'}</div>
      <div class="chips">
        <span class="chip">${km(lot.mileageKm)}</span>
        <span class="chip">${lot.engineCc ? nf.format(lot.engineCc) + ' cc' : '—'}</span>
        <span class="chip">${lot.fuel === 'HYBRID' ? 'Hibrit' : 'Benzin'}</span>
      </div>
      <div class="lot-price">
        <div>
          <div class="k">Başlangıç</div>
          <div class="v">${lot.startJpy ? jpy(lot.startJpy) : '—'}</div>
          <div class="lot-sub">${lot.startJpy ? gbp((lot.startJpy * ctx.fx.jpyTry) / ctx.fx.gbpTry) : ''}</div>
        </div>
        <div class="side">
          en az gümrüklü
          <b>${gbp(landed.totalGbp)}</b>
          <span>+ ihaleye hazırlık ${gbp((ctx.extraFeesJpy * ctx.fx.jpyTry) / ctx.fx.gbpTry)}</span>
        </div>
      </div>
      <a class="src-link" href="${lot.url}" target="_blank" rel="noopener">Lotu aç ↗</a>
    </div>
  </article>`;
}

async function init() {
  const root = document.getElementById('content');
  let data;
  try {
    data = await getJSON('./data/auctions.json');
  } catch (err) {
    root.innerHTML = `<p class="empty-lots">Müzayede verisi yok. Önce <code>npm run auctions</code> çalıştırın.</p>`;
    return;
  }

  document.getElementById('feesTxt').textContent = nf.format(data.extraFeesJpy || 0);
  const d = new Date(data.updatedAt);
  document.getElementById('stamp').textContent =
    'Son tarama: ' + d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

  const ctx = { fx: data.fx, opts: data.opts, extraFeesJpy: data.extraFeesJpy || 0 };

  const html = (data.models || [])
    .map((m) => {
      const lots = (m.lots || []).slice().sort((a, b) => (b.regYear || 0) - (a.regYear || 0));
      return `
      <section>
        <div class="model-head">
          <h2>${m.label}</h2>
          <span class="muted">${lots.length} uygun lot · ${m.scanned} tarandı</span>
        </div>
        ${lots.length ? `<div class="lot-grid">${lots.map((l) => lotCard(l, ctx)).join('')}</div>` : '<p class="empty-lots">Uygun lot yok.</p>'}
      </section>`;
    })
    .join('');

  root.innerHTML = html || '<p class="empty-lots">Kayıt yok.</p>';
}

init();
