import { computeLanded } from './lib/landed.js';
import { buildMarket, scoreCar } from './lib/score.js';

const $ = (id) => document.getElementById(id);

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

const gbp = (n) => (n == null ? '—' : '£' + nf.format(Math.round(n)));
const tryFmt = (n) => (n == null ? '—' : nf.format(Math.round(n)) + ' ₺');
const pct = (n, d = 1) => (n == null ? '—' : '%' + (n * 100).toFixed(d).replace('.', ','));
const km = (n) => (n == null ? '—' : nf.format(Math.round(n)) + ' km');

const SOURCE_LABEL = { sbtjapan: 'SBT', goonet: 'Goo-net' };

const state = {
  mode: 'api',          // api | static
  raw: null,            // sunucudan/JSON'dan gelen ham veri
  cars: [],             // hesaplanmış araçlar
  market: null,
  model: null,
  models: [],
  costInit: false,
  budgetInit: false,
  costOverrides: {},
  filters: { budget: 0, year: 0, km: 0, fuel: '', drive: '', source: '', sort: 'score', eligible: true },
  limit: 48
};

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSON beklenirken HTML geldi');
  }
}

function skeleton(n = 6) {
  $('grid').innerHTML = Array.from({ length: n })
    .map(() => `<div class="skeleton"><div class="sk-media"></div><div class="sk-line"></div><div class="sk-line"></div></div>`)
    .join('');
}

/* ---------- veri yükleme ---------- */

async function loadModels() {
  try {
    const d = await fetchJSON('./api/models');
    state.mode = 'api';
    return d;
  } catch {
    state.mode = 'static';
    return fetchJSON('./data/models.json');
  }
}

async function loadRaw({ refresh = false } = {}) {
  const q = new URLSearchParams({ model: state.model });
  if (refresh) q.set('refresh', '1');
  try {
    const d = await fetchJSON(`./api/cars?${q}`);
    state.mode = 'api';
    return d;
  } catch {
    state.mode = 'static';
    return fetchJSON(`./data/${state.model}.json`);
  }
}

function prepare(d) {
  const fx = d.meta.fx;
  const opts = { ...d.meta.opts, ...state.costOverrides };
  const dealThreshold = d.meta.defaults?.ui?.dealThreshold ?? 0.08;

  const cars = d.cars.map((car) => {
    const landed = computeLanded(car, fx, opts);
    return {
      ...car,
      landed,
      eligible: landed.eligible,
      ageRisk: landed.ageRisk,
      ageMonthsNow: landed.ageMonthsNow
    };
  });

  const market = buildMarket(cars);
  for (const car of cars) {
    car.analysis = scoreCar(
      car,
      market,
      { prevPrice: car.prevPrice ?? null, isNew: !!car.isNew },
      { dealThreshold }
    );
  }

  state.raw = d;
  state.cars = cars;
  state.market = market;
  state.opts = opts;
  return cars;
}

async function load({ refresh = false } = {}) {
  const btn = $('refreshBtn');
  btn.disabled = true;
  btn.lastChild.textContent = ' Yükleniyor…';
  skeleton();
  $('scanHint').hidden = false;

  try {
    const d = await loadRaw({ refresh });
    prepare(d);
    applyMeta(d.meta);
    resetAndRender();
  } catch (err) {
    $('grid').innerHTML = `<div class="empty"><b>Veri alınamadı</b><span>${err.message}</span></div>`;
  } finally {
    btn.disabled = false;
    btn.lastChild.textContent = state.mode === 'static' ? ' Yeniden yükle' : ' Yenile';
    $('scanHint').hidden = true;
  }
}

function autoFreight(method) {
  const meta = state.raw.meta;
  const s = meta.defaults.shipping;
  const vt = meta.vehicleType || 'suv';
  if (method === 'container') {
    const seats = s.carsPerContainer?.[vt] || 4;
    return Math.round((s.containerUsd || 11000) / seats);
  }
  const port = $('cPort').value || s.port;
  return Math.round(s.roroUsd?.[port] ?? 1350);
}

function syncFreight() {
  const method = $('cMethod').value;
  const f = autoFreight(method);
  $('cFreight').value = f;

  const s = state.raw.meta.defaults.shipping;
  const vt = state.raw.meta.vehicleType || 'suv';
  const hint =
    method === 'container'
      ? `Konteyner $${nf.format(s.containerUsd || 11000)} ÷ ${s.carsPerContainer?.[vt] || 4} araç = $${nf.format(f)}/araç.`
      : `RORO ${$('cPort').value} = $${nf.format(f)}/araç.`;
  $('freightHint').textContent = `${hint} Sigorta %1,5; vergiler CIF üzerinden hesaplanır.`;
}

function applyMeta(meta) {
  $('fxGbp').textContent = nf1.format(meta.fx.gbpTry);
  $('fxJpy').textContent = (meta.fx.jpyTry * 100).toFixed(2).replace('.', ',');
  $('fxBox').title = `${meta.fx.source}${meta.fx.stale ? ' (yedek)' : ''}`;

  $('reportLink').href =
    state.mode === 'static'
      ? `./reports/${meta.date}-${meta.modelKey}.html`
      : `/report?model=${encodeURIComponent(meta.modelKey)}`;

  const d = new Date(meta.scannedAt);
  const stamp = d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  $('stamp').textContent = `Son tarama: ${stamp}${meta.cached ? ' (önbellek)' : ''}`;

  if (!state.costInit) {
    const o = meta.opts;
    $('cPort').value = o.port;
    $('cMethod').value = o.method || 'container';
    $('cCommission').value = o.commissionGbp;
    $('cImporter').value = o.importer;
    $('cArrival').value = o.arrivalDays;
    syncFreight();
    state.costInit = true;
  }

  if (!state.budgetInit) {
    const b = meta.defaults?.ui?.defaultBudgetGbp || 0;
    if (b > 0) {
      state.filters.budget = b;
      $('fBudget').value = b;
    }
    state.budgetInit = true;
  }

  const years = [...new Set(state.cars.map((c) => c.regYear).filter(Boolean))].sort((a, b) => b - a);
  const yearSel = $('fYear');
  if (yearSel.options.length <= 1) {
    for (const y of years) {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      yearSel.appendChild(o);
    }
  }
}

/* ---------- filtre / sıralama ---------- */

function filtered() {
  if (!state.cars.length) return [];
  const f = state.filters;
  let cars = state.cars.filter((c) => {
    if (!c.priceAmount) return false;
    if (f.eligible && !c.eligible) return false;
    if (f.budget > 0 && c.landed.totalGbp > f.budget) return false;
    if (f.year > 0 && (c.regYear || 0) < f.year) return false;
    if (f.km > 0 && (c.mileageKm || 0) > f.km) return false;
    if (f.fuel) {
      const fuel = (c.fuel || '').toUpperCase();
      if (f.fuel === 'PETROL' && !fuel.includes('PETROL')) return false;
      if (f.fuel === 'HYBRID' && !fuel.includes('HYBRID')) return false;
    }
    if (f.drive && c.drive !== f.drive) return false;
    if (f.source && c.source !== f.source) return false;
    return true;
  });

  const sorters = {
    score: (a, b) => b.analysis.score - a.analysis.score,
    landed: (a, b) => a.landed.totalGbp - b.landed.totalGbp,
    fob: (a, b) => a.landed.fobGbp - b.landed.fobGbp,
    km: (a, b) => (a.mileageKm || 0) - (b.mileageKm || 0),
    year: (a, b) => (b.regYear || 0) - (a.regYear || 0),
    gap: (a, b) => b.analysis.valueGap - a.analysis.valueGap
  };
  return cars.sort(sorters[f.sort] || sorters.score);
}

function median(nums) {
  const v = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function updateStats(cars) {
  const eligible = cars.filter((c) => c.eligible);
  const landed = eligible.map((c) => c.landed.totalGbp);
  const min = eligible.reduce((best, c) => (!best || c.landed.totalGbp < best.landed.totalGbp ? c : best), null);

  $('stEligible').textContent = eligible.length;
  $('stTotal').textContent = `${cars.length} ilan (filtreli) · ${state.raw.meta.counts.total} tarandı`;
  $('stMedian').textContent = gbp(median(landed));
  $('stMin').textContent = gbp(min?.landed.totalGbp);
  $('stMinCar').textContent = min ? `${min.regYear}/${String(min.regMonth).padStart(2, '0')} · ${km(min.mileageKm)}` : '—';
  $('stTax').textContent = pct(median(eligible.map((c) => c.landed.taxes.effectiveRate)));

  $('listTitle').textContent = `${cars.length} araç`;
  const src = state.raw.meta.counts.bySource || {};
  const srcTxt = Object.entries(src)
    .map(([k, v]) => `${SOURCE_LABEL[k] || k} ${v}`)
    .join(' · ');
  $('listMeta').textContent = `${srcTxt} · gümrüklü fiyatlar ${state.opts.importer === 'galeri' ? 'galeri' : 'şahıs'} ithalatına göre · ${state.opts.port}`;

  const noteEl = $('modelNote');
  const parts = [];
  if (state.raw.meta.note) parts.push(state.raw.meta.note);
  if (state.market && state.market.reliable === false) {
    parts.push(
      `⚠️ Bu modelde emsal sayısı az (${state.market.poolSize}); piyasa farkı ihtiyatlı (güven ayarlı) gösteriliyor.`
    );
  }
  if (parts.length) {
    noteEl.textContent = parts.join(' ');
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }
}

/* ---------- kart ---------- */

function rateText(line) {
  if (line.key === 'bandrol') return '0,3% + 50₺';
  return pct(line.rate);
}

function costRows(c) {
  const fx = state.raw.meta.fx;
  const L = c.landed;
  const toGbp = (tryAmount) => tryAmount / fx.gbpTry;
  const rows = [
    ['FOB (Japonya)', gbp(L.fobGbp), 'sub'],
    [`Navlun (${state.opts.method === 'container' ? 'konteyner' : 'RORO'})`, gbp(toGbp(L.freightTry)), 'sub'],
    ['Sigorta', gbp(toGbp(L.insuranceTry)), 'sub'],
    ['CIF', gbp(L.cifGbp), 'sub']
  ];
  for (const line of L.taxes.lines) {
    rows.push([`${line.label} <span class="sub">${rateText(line)}</span>`, gbp(toGbp(line.amountTry)), '']);
  }
  rows.push(['<b>Vergi toplamı</b>', `<b>${gbp(toGbp(L.taxes.totalTaxTry))}</b>`, 'sub']);
  rows.push(['Komisyon', gbp(toGbp(L.commissionTry)), 'sub']);
  if (L.registrationTry) rows.push(['KKTC tescil/plaka', gbp(toGbp(L.registrationTry)), 'sub']);

  return (
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') +
    `<tr class="total"><td>KKTC toplam</td><td>${gbp(L.totalGbp)} · ${tryFmt(L.totalTry)}</td></tr>`
  );
}

function card(c) {
  const L = c.landed;
  const age = L.ageYearsAtArrival;
  const gap = c.analysis.valueGap;
  const gapTxt = gap >= 0 ? `piyasa −${pct(gap)}` : `piyasa +${pct(-gap)}`;
  const gapCls = gap >= 0 ? 'gap-pos' : 'gap-neg';

  const badges = c.analysis.badges.map((b) => `<span class="badge ${b.key}">${b.label}</span>`).join('');

  return `
  <article class="card">
    <div class="card-media">
      <img src="${c.image}" alt="${c.title}" loading="lazy" referrerpolicy="no-referrer"
           onerror="this.style.display='none'">
      <div class="badges">${badges}</div>
      <div class="score ${c.analysis.score >= 75 ? 'high' : ''}" title="Fırsat skoru">${c.analysis.score}</div>
    </div>
    <div class="card-body">
      <div class="card-top">
        <h3 class="card-title">${c.regYear}/${String(c.regMonth || 1).padStart(2, '0')} · ${c.title.replace(/^\d{4}(?:\/\d{1,2})?\s+/, '')}
          <span>${c.modelCode || ''}${c.modelCode ? ' · ' : ''}${c.location || ''}</span>
        </h3>
        ${c.grade ? `<span class="grade">${c.grade}</span>` : ''}
      </div>

      <div class="chips">
        <span class="chip"><b>${km(c.mileageKm)}</b></span>
        <span class="chip">${age != null ? nf1.format(age) + ' yaş (varışta)' : '—'}</span>
        <span class="chip">${c.engineCc ? nf.format(c.engineCc) + ' cc' : '—'}</span>
        <span class="chip">${c.fuel || '—'}</span>
        ${c.drive ? `<span class="chip">${c.drive}</span>` : ''}
      </div>

      <div class="price-row">
        <div class="price-main">
          <span class="k">KKTC gümrüklü</span>
          <span class="v">${gbp(L.totalGbp)}</span>
          <span class="t">${tryFmt(L.totalTry)}</span>
        </div>
        <div class="price-side">
          FOB <b>${gbp(L.fobGbp)}</b>
          <span class="${gapCls}">${gapTxt}</span>
        </div>
      </div>

      <details class="breakdown">
        <summary>Maliyet dökümü</summary>
        <table class="bd-table">${costRows(c)}</table>
      </details>

      <div class="card-foot">
        <a class="src-link" href="${c.url}" target="_blank" rel="noopener">İlanı aç ↗</a>
        <span class="stock">${SOURCE_LABEL[c.source] || c.source} · ${c.stockId.replace(/^GN-/, '')}</span>
      </div>
    </div>
  </article>`;
}

function render() {
  const cars = filtered();
  updateStats(cars);

  const shown = cars.slice(0, state.limit);
  $('empty').hidden = cars.length > 0;
  $('grid').innerHTML = shown.map(card).join('');

  const rest = cars.length - shown.length;
  $('moreWrap').innerHTML =
    rest > 0 ? `<button type="button" id="moreBtn">Daha fazla göster · kalan ${nf.format(rest)}</button>` : '';
  const btn = $('moreBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      state.limit += 48;
      render();
    });
  }
}

function resetAndRender() {
  state.limit = 48;
  render();
}

/* ---------- olaylar ---------- */

$('fBudget').addEventListener('input', (e) => {
  state.filters.budget = Number(e.target.value) || 0;
  resetAndRender();
});
for (const [id, key] of [
  ['fYear', 'year'],
  ['fKm', 'km'],
  ['fFuel', 'fuel'],
  ['fDrive', 'drive'],
  ['fSource', 'source'],
  ['fSort', 'sort']
]) {
  $(id).addEventListener('change', (e) => {
    state.filters[key] = key === 'year' || key === 'km' ? Number(e.target.value) : e.target.value;
    resetAndRender();
  });
}
$('fEligible').addEventListener('change', (e) => {
  state.filters.eligible = e.target.checked;
  resetAndRender();
});

$('cMethod').addEventListener('change', syncFreight);
$('cPort').addEventListener('change', () => {
  if ($('cMethod').value === 'roro') syncFreight();
});

$('applyCost').addEventListener('click', () => {
  state.costOverrides = {
    port: $('cPort').value,
    method: $('cMethod').value,
    freightUsd: Number($('cFreight').value) || 0,
    commissionGbp: Number($('cCommission').value) || 0,
    importer: $('cImporter').value,
    arrivalDays: Number($('cArrival').value) || 90
  };
  prepare(state.raw);
  resetAndRender();
});

$('refreshBtn').addEventListener('click', () => {
  if (state.mode === 'static') {
    load();
    return;
  }
  load({ refresh: true });
});

/* ---------- başlangıç ---------- */

async function init() {
  try {
    const { models, defaultModel } = await loadModels();
    state.models = models;

    const groups = new Map();
    for (const m of models) {
      if (!groups.has(m.make)) groups.set(m.make, []);
      groups.get(m.make).push(m);
    }
    $('fModel').innerHTML = [...groups]
      .map(
        ([make, list]) =>
          `<optgroup label="${make}">${list.map((m) => `<option value="${m.key}">${m.label}</option>`).join('')}</optgroup>`
      )
      .join('');

    const saved = localStorage.getItem('jeg:model');
    const key = models.some((m) => m.key === saved) ? saved : defaultModel;
    $('fModel').value = key;
    state.model = key;

    $('fModel').addEventListener('change', (e) => {
      state.model = e.target.value;
      localStorage.setItem('jeg:model', state.model);
      state.limit = 48;
      state.filters.year = 0;
      $('fYear').value = '0';
      load();
    });

    await load();
  } catch (err) {
    $('grid').innerHTML = `<div class="empty"><b>Model listesi alınamadı</b><span>${err.message}</span></div>`;
  }
}

init();
