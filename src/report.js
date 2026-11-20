import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const REPORT_DIR = path.resolve('data', 'reports');

const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

export function trDate(iso) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${TR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const gbp = (n) =>
  n == null ? '—' : '£' + Math.round(n).toLocaleString('tr-TR');
export const tryFmt = (n) =>
  n == null ? '—' : Math.round(n).toLocaleString('tr-TR') + ' ₺';
export const pct = (n, d = 1) =>
  n == null ? '—' : '%' + (n * 100).toFixed(d).replace('.', ',');
export const km = (n) => (n == null ? '—' : Math.round(n).toLocaleString('tr-TR') + ' km');
export const ym = (c) => (c.regYear ? `${c.regYear}/${String(c.regMonth || 1).padStart(2, '0')}` : '—');

function row(c) {
  const age = c.landed.ageMonthsAtArrival;
  const ageTxt = age == null ? '—' : `${(age / 12).toFixed(1).replace('.', ',')} yıl`;
  const label = `${ym(c)} ${c.title.replace(/^\d{4}(?:\/\d{1,2})?\s+/, '')}`;
  return `| ${label} | ${c.grade || '—'} | ${km(c.mileageKm)} | ${ageTxt} | ${gbp(c.landed.fobGbp)} | **${gbp(c.landed.totalGbp)}** | ${pct(c.analysis.valueGap)} | ${c.analysis.score} | [${SOURCE_SHORT[c.source] || c.source} ${c.stockId.replace(/^GN-/, '')}](${c.url}) |`;
}

const HEADER = `| Araç | Donanım | Km | Yaş (varışta) | FOB | KKTC gümrüklü | Piyasa farkı | Skor | İlan |
|---|---|---|---|---|---|---|---|---|`;

const SOURCE_SHORT = { sbtjapan: 'SBT', goonet: 'Goo-net' };

export function buildReport({ date, cars, summary, gone, fx, opts }) {
  const eligible = cars.filter((c) => c.eligible);
  const top = [...eligible].sort((a, b) => b.analysis.score - a.analysis.score).slice(0, 8);
  const drops = eligible.filter((c) => c.analysis.priceDrop > 0.005).sort((a, b) => b.analysis.priceDrop - a.analysis.priceDrop);
  const fresh = eligible.filter((c) => c.analysis.badges.some((b) => b.key === 'new'));

  const lines = [];
  lines.push(`# ${summary.label || 'Toyota RAV4'} — KKTC Gümrüklü Fırsat Raporu`);
  lines.push('');
  lines.push(`**${trDate(date)}** · Kaynak: SBT Japan · Kur: ${fx.source} (1 £ = ${fx.gbpTry.toFixed(2)} ₺, 100 ¥ = ${(fx.jpyTry * 100).toFixed(2)} ₺)`);
  lines.push('');
  lines.push('## Özet');
  lines.push('');
  lines.push(`- Taranan ilan: **${summary.total}** (kaynaklarda toplam ${summary.totalCount ?? '—'})`);
  if (summary.bySource) {
    const parts = Object.entries(summary.bySource).map(([k, v]) => `${SOURCE_SHORT[k] || k} ${v}`).join(' · ');
    lines.push(`- Kaynak dağılımı: ${parts}`);
  }
  lines.push(`- 5 yaş kuralına uyan: **${summary.eligible}**`);
  lines.push(`- Uygun araçların medyan gümrüklü fiyatı: **${gbp(summary.medianLandedGbp)}** (en düşük ${gbp(summary.minLandedGbp)}, en yüksek ${gbp(summary.maxLandedGbp)})`);
  lines.push(`- Ortalama vergi yükü (CIF üzerine): **${pct(summary.medianTaxRate)}**`);
  lines.push(`- Varsayımlar: navlun ${opts.method === 'container' ? 'konteyner' : 'RORO'} ${opts.port} ${opts.freightUsd} $, sigorta ${pct(opts.insuranceRate)}, komisyon ${gbp(opts.commissionGbp)}, ithalatçı: ${opts.importer === 'galeri' ? 'galeri/bayi' : 'şahıs'}, varış ${opts.arrivalDays} gün.`);
  lines.push('');

  lines.push('## Bugünün en iyi fırsatları');
  lines.push('');
  if (!top.length) {
    lines.push('_Uygun ilan bulunamadı._');
  } else {
    lines.push(HEADER);
    for (const c of top) lines.push(row(c));
    lines.push('');
    lines.push(`> Piyasa farkı: aynı yaş/km'deki emsallerine göre FOB fiyatının ne kadar altında olduğu (pozitif = ucuz).`);
  }
  lines.push('');

  if (drops.length) {
    lines.push('## Fiyatı düşenler');
    lines.push('');
    lines.push('| Araç | Eski FOB | Yeni FOB | Düşüş | KKTC gümrüklü | İlan |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of drops.slice(0, 10)) {
      lines.push(
        `| ${ym(c)} ${c.title.replace(/^\d{4}(?:\/\d{1,2})?\s+/, '')} | ${gbp((c.analysis.prevPrice * fx.jpyTry) / fx.gbpTry)} | ${gbp(c.landed.fobGbp)} | −${pct(c.analysis.priceDrop)} | **${gbp(c.landed.totalGbp)}** | [${SOURCE_SHORT[c.source] || c.source} ${c.stockId.replace(/^GN-/, '')}](${c.url}) |`
      );
    }
    lines.push('');
  }

  if (fresh.length) {
    lines.push('## Yeni ilanlar');
    lines.push('');
    if (fresh.length > 12) {
      lines.push(`Bugün **${fresh.length}** yeni uygun ilan eklendi. En iyileri:`);
      lines.push('');
    }
    lines.push(HEADER);
    for (const c of fresh.slice(0, 10)) lines.push(row(c));
    lines.push('');
  }

  const goneEligible = gone.filter((g) => g.lastPrice);
  if (goneEligible.length) {
    lines.push('## Listeden düşenler (muhtemelen satıldı)');
    lines.push('');
    for (const g of goneEligible.slice(0, 10)) {
      lines.push(`- ${g.title} — son görülme ${g.lastSeen}, son fiyat ¥${g.lastPrice.toLocaleString('tr-TR')}`);
    }
    lines.push('');
  }

  lines.push('## Nasıl hesaplanıyor?');
  lines.push('');
  lines.push('1. **FOB**: SBT Japan ilan fiyatı (¥) → TCMB satış kuruyla £.');
  lines.push('2. **CIF** = FOB + navlun + sigorta (%1,5).');
  lines.push('3. **KKTC vergileri** (CIF üzerinden): Gümrük %10 · FİF %3 (≤2000cc) / %8 (2001–3000cc) · Özel Fon %15 (şahıs) veya Stopaj %4 (galeri) · Rıhtım %4,4 · GKK %2,5 · Bandrol %0,3 + 50 ₺ · KDV %20 (matrah: CIF + tüm vergiler).');
  lines.push('4. **Komisyon**: oto galeri/aracılık ücreti (varsayılan £2.000).');
  lines.push('5. **5 yaş kuralı**: ordino tarihinde (tahmini varış = bugün + 90 gün) araç 5 yaşını doldurmamış olmalı.');
  lines.push('6. **Piyasa farkı**: aynı yaş kovası ve motor grubundaki medyan fiyata göre hesaplanır; emsal sayısı az olan modellerde fark güvene göre küçültülür (aşırı sapmalar gösterilmez).');
  lines.push('');
  lines.push('> ⚠️ Bu rapor bilgilendirme amaçlıdır. KKTC Gümrük Dairesi vergi matrahını kendi belirlediği değere göre saptar; kesin tutar için [GBS Tarife Maketi](https://giris.gbs.gov.ct.tr/tarife-maketi) veya Neveser Gümrükleme (0533 840 3834) ile teyit edin.');
  lines.push('');
  lines.push('> 🔍 Piyasa farkı büyük olan ilanlarda yüksek km, hasar kaydı, düşük donanım (X/G) veya değiştirilmiş jant/aksesuar olabilir. Satın almadan önce SBT ilanındaki kondisyon notlarını ve fotoğrafları inceleyin.');
  lines.push('');

  return lines.join('\n');
}

export async function writeReport(date, markdown) {
  await mkdir(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, `${date}.md`);
  await writeFile(file, markdown, 'utf8');
  return file;
}

export async function writeReportFile(name, content) {
  await mkdir(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, name);
  await writeFile(file, content, 'utf8');
  return file;
}

export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineMd(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}

/** Rapor markdown'unu tek dosyalık, stillendirilmiş HTML'e çevirir. */
export function renderReportHtml(markdown, { title = 'KKTC Fırsat Raporu' } = {}) {
  const lines = markdown.split('\n');
  const out = [];
  let i = 0;

  const isTableRow = (l) => /^\s*\|/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    if (isTableRow(line) && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1] || '')) {
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
      out.push('<div class="tbl"><table><thead><tr>' + head.map((h) => `<th>${inlineMd(h)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>' + r.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
      out.push('</tbody></table></div>');
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inlineMd(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^-\s+/.test(lines[i])) out.push(`<li>${inlineMd(lines[i++].replace(/^-\s+/, ''))}</li>`);
      out.push('</ul>');
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) out.push(`<li>${inlineMd(lines[i++].replace(/^\d+\.\s+/, ''))}</li>`);
      out.push('</ol>');
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inlineMd(buf.join(' '))}</blockquote>`);
      continue;
    }

    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }

  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--navy:#0e2c49;--gold:#f4a72c;--ink:#16293b;--line:#e2e9f2;--muted:#5a6c7f}
*{box-sizing:border-box}
body{margin:0;background:#f5f8fc;color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:clamp(26px,3.4vw,38px);line-height:1.15;color:var(--navy);margin:0 0 .4em}
h2{font-size:22px;color:var(--navy);margin:2em 0 .6em;padding-bottom:.35em;border-bottom:2px solid var(--line)}
h3{font-size:18px;color:var(--navy)}
a{color:#1d5f9e}
.tbl{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px -24px rgba(14,44,73,.5);margin:1em 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th{text-align:left;padding:12px 14px;background:#f0f5fb;color:var(--navy);font-weight:600;white-space:nowrap}
td{padding:11px 14px;border-top:1px solid var(--line);vertical-align:top}
tbody tr:hover{background:#fbfdff}
blockquote{margin:1.2em 0;padding:14px 18px;background:#fff8e9;border-left:4px solid var(--gold);border-radius:10px;color:#5d4a22}
ul,ol{padding-left:1.3em}
li{margin:.3em 0}
code{background:#eef3f9;padding:.1em .4em;border-radius:6px;font-size:.9em}
p{margin:.7em 0}
</style></head><body><main>${out.join('\n')}</main></body></html>`;
}
