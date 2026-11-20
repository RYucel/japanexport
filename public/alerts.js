const $ = (id) => document.getElementById(id);

const state = { models: [], alerts: [] };

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function filterText(a) {
  const bits = [];
  if (a.maxPriceGbp) bits.push(`≤£${a.maxPriceGbp.toLocaleString('tr-TR')}`);
  if (a.minPriceGbp) bits.push(`≥£${a.minPriceGbp.toLocaleString('tr-TR')}`);
  if (a.maxKm) bits.push(`≤${a.maxKm.toLocaleString('tr-TR')} km`);
  if (a.minYear) bits.push(`${a.minYear}+`);
  if (a.fuel) bits.push(a.fuel === 'hybrid' ? 'hibrit' : 'benzin');
  if (a.drive) bits.push(a.drive);
  if (a.minGapPct) bits.push(`≥%${a.minGapPct}`);
  if (a.models?.length) bits.push(`${a.models.length} model`);
  return bits.join(' · ') || 'filtre yok';
}

function renderModels() {
  const groups = new Map();
  for (const m of state.models) {
    if (!groups.has(m.make)) groups.set(m.make, []);
    groups.get(m.make).push(m);
  }
  $('modelsBox').innerHTML = [...groups]
    .map(
      ([make, list]) =>
        `<h4>${make}</h4>` +
        list
          .map(
            (m) =>
              `<label><input type="checkbox" value="${m.key}" data-model> ${m.label.replace(make + ' ', '')}</label>`
          )
          .join('')
    )
    .join('');
}

function renderList() {
  $('countTxt').textContent = `${state.alerts.length} alert`;
  $('alertList').innerHTML = state.alerts.length
    ? state.alerts
        .map(
          (a, i) => `
      <div class="alert-item">
        <div>
          <b>${a.name || 'İsimsiz alert'}</b>
          <span>${filterText(a)}${a.enabled === false ? ' · kapalı' : ''}</span>
        </div>
        <button class="btn ghost" data-del="${i}" type="button"
          style="color:var(--red);border-color:var(--line);background:#fff;padding:6px 12px;font-size:13px">Sil</button>
      </div>`
        )
        .join('')
    : '<p class="muted" style="margin:6px 0">Henüz alert yok. Yukarıdan ekleyin.</p>';

  for (const btn of document.querySelectorAll('[data-del]')) {
    btn.addEventListener('click', () => {
      state.alerts.splice(Number(btn.dataset.del), 1);
      renderList();
      renderJSON();
    });
  }
}

function renderJSON() {
  $('jsonOut').textContent = JSON.stringify({ alerts: state.alerts }, null, 2);
}

function readForm() {
  const models = [...document.querySelectorAll('[data-model]:checked')].map((c) => c.value);
  const a = {
    name: $('aName').value.trim() || 'Yeni alert',
    enabled: true,
    models
  };
  const maxPriceGbp = num($('aMaxPrice').value);
  const minPriceGbp = num($('aMinPrice').value);
  const maxKm = num($('aMaxKm').value);
  const minYear = num($('aMinYear').value);
  const minGapPct = num($('aGap').value);
  const topN = num($('aTopN').value) || 3;

  if (maxPriceGbp) a.maxPriceGbp = maxPriceGbp;
  if (minPriceGbp) a.minPriceGbp = minPriceGbp;
  if (maxKm) a.maxKm = maxKm;
  if (minYear) a.minYear = minYear;
  if (minGapPct) a.minGapPct = minGapPct;
  if ($('aFuel').value) a.fuel = $('aFuel').value;
  if ($('aDrive').value) a.drive = $('aDrive').value;
  a.topN = topN;
  return a;
}

function resetForm() {
  for (const id of ['aName', 'aMaxPrice', 'aMinPrice', 'aMaxKm', 'aMinYear', 'aGap']) $(id).value = '';
  $('aTopN').value = '3';
  $('aFuel').value = '';
  $('aDrive').value = '';
  for (const c of document.querySelectorAll('[data-model]')) c.checked = false;
}

async function init() {
  try {
    const m = await getJSON('./data/models.json').catch(() => getJSON('./api/models'));
    state.models = m.models || [];
    renderModels();
  } catch {
    $('modelsBox').innerHTML = '<p class="muted">Model listesi yüklenemedi.</p>';
  }

  try {
    const cfg = await getJSON('./data/alerts.json');
    state.alerts = cfg.alerts || [];
  } catch {
    state.alerts = [];
  }

  renderList();
  renderJSON();

  $('addBtn').addEventListener('click', () => {
    state.alerts.push(readForm());
    resetForm();
    renderList();
    renderJSON();
    $('jsonOut').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('resetBtn').addEventListener('click', () => {
    resetForm();
  });

  $('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('jsonOut').textContent);
      $('copyBtn').textContent = 'Kopyalandı ✓';
      setTimeout(() => ($('copyBtn').textContent = "JSON'u kopyala"), 2000);
    } catch {
      const range = document.createRange();
      range.selectNode($('jsonOut'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
}

init();
