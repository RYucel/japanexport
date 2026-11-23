const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const gbp = (n) => '£' + nf.format(Math.round(n));

function spark(points, { w = 280, h = 90, pad = 6 } = {}) {
  const vals = points.map((p) => p.median).filter((v) => v > 0);
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  const x = (i) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);

  const coords = points.map((p, i) => [x(i), y(p.median)]);
  const line = coords.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - pad} L${pad},${h - pad} Z`;

  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
    <line class="grid" x1="0" y1="${h - pad}" x2="${w}" y2="${h - pad}"></line>
    <path class="area" d="${area}"></path>
    <path class="line" d="${line}"></path>
    ${coords.map(([px, py]) => `<circle class="dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.6"></circle>`).join('')}
  </svg>`;
}

async function init() {
  const grid = document.getElementById('grid');
  let data;
  try {
    const res = await fetch('./data/history.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    grid.innerHTML = '<div class="empty-trend">Trend verisi henüz yok. İlk günlük taramadan sonra oluşur.</div>';
    return;
  }

  const d = new Date(data.updatedAt);
  document.getElementById('stamp').textContent = 'Son güncelleme: ' + d.toLocaleString('tr-TR', { dateStyle: 'medium' });

  const cards = (data.models || [])
    .filter((m) => (m.points || []).length)
    .map((m) => {
      const pts = m.points;
      const last = pts[pts.length - 1];
      const first = pts[0];
      const delta = first.median > 0 ? (last.median - first.median) / first.median : 0;
      const deltaTxt =
        pts.length < 2
          ? 'tek gün'
          : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1).replace('.', ',')}% (${pts.length} gün)`;
      const cls = delta > 0 ? 'up' : 'down';

      return `<article class="trend-card">
        <div class="trend-head">
          <h2>${m.label}</h2>
          <span class="now">${gbp(last.median)}</span>
        </div>
        <div class="trend-sub">
          en düşük ${gbp(last.min)} · ${nf.format(last.eligible)} uygun · <span class="delta ${cls}">${deltaTxt}</span>
        </div>
        ${spark(pts)}
      </article>`;
    })
    .join('');

  grid.innerHTML = cards || '<div class="empty-trend">Veri yok.</div>';
}

init();
