#!/usr/bin/env node
/**
 * Günlük özeti WhatsApp'a gönderir (CallMeBot — ücretsiz, kişisel kullanım).
 *
 * Gerekli ortam değişkenleri:
 *   WHATSAPP_PHONE   +90533xxxxxxx  (ülke kodlu)
 *   WHATSAPP_APIKEY  CallMeBot'un verdiği anahtar
 *   SITE_URL         (opsiyonel) varsayılan https://ryucel.github.io/japanexport/
 *
 * Kullanım:
 *   node src/notify.js            # gönderir (anahtar yoksa sessizce atlar)
 *   node src/notify.js --dry-run  # sadece mesajı yazdırır
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const SITE_URL = process.env.SITE_URL || 'https://ryucel.github.io/japanexport/';
const phone = process.env.WHATSAPP_PHONE;
const apiKey = process.env.WHATSAPP_APIKEY;

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const fmtPct = (n) => String(n).replace('.', ',');

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function trDate(d) {
  return `${d.getUTCDate()} ${TR_MONTHS[d.getUTCMonth()]}`;
}

async function main() {
  const file = path.resolve('public', 'data', 'index.json');
  let index;
  try {
    index = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    console.log('ℹ️  public/data/index.json yok — önce `npm run build`.');
    return;
  }

  const models = index.models || [];
  const deals = models
    .flatMap((m) => (m.top || []).map((t) => ({ ...t, model: m.label, key: m.key })))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const total = models.reduce((a, m) => a + (m.total || 0), 0);
  const eligible = models.reduce((a, m) => a + (m.eligible || 0), 0);

  const lines = [];
  lines.push(`🚗 KKTC Araç Avcısı · ${trDate(new Date(index.updatedAt || Date.now()))}`);
  lines.push(`${models.length} model · ${nf.format(total)} ilan tarandı, ${nf.format(eligible)} tanesi 5 yaşa uygun.`);
  lines.push('');

  if (deals.length) {
    lines.push('🔥 Bugünün en iyi fırsatları:');
    deals.forEach((d, i) => {
      const gap = d.gap >= 0 ? `piyasa −%${fmtPct(d.gap)}` : `piyasa +%${fmtPct(Math.abs(d.gap))}`;
      const grade = d.grade ? ` ${d.grade}` : '';
      lines.push(`${i + 1}) ${d.model} · ${d.ym}${grade}`);
      lines.push(`   ${nf.format(d.km || 0)} km · £${nf.format(d.totalGbp)} gümrüklü · ${gap}`);
    });
    lines.push('');
  } else {
    lines.push('Bugün uygun ilan bulunamadı.');
    lines.push('');
  }

  lines.push('Tüm liste ve maliyet dökümü:');
  lines.push(SITE_URL);

  const text = lines.join('\n');

  if (dryRun) {
    console.log('\n--- MESAJ ---\n' + text + '\n--- /MESAJ ---\n');
    return;
  }

  if (!phone || !apiKey) {
    console.log('ℹ️  WHATSAPP_PHONE / WHATSAPP_APIKEY tanımlı değil — bildirim atlandı.');
    console.log('   Kurulum: README → “WhatsApp bildirimi”.');
    return;
  }

  const url =
    'https://api.callmebot.com/whatsapp.php' +
    `?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(text)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = (await res.text()).trim().slice(0, 200);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
    console.log(`✅  WhatsApp bildirimi gönderildi (${deals.length} fırsat).`);
  } catch (err) {
    // Bildirim hatası iş akışını durdurmasın
    console.warn(`⚠️  WhatsApp gönderilemedi: ${err.message}`);
  }
}

main();
