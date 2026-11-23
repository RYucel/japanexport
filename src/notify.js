#!/usr/bin/env node
/**
 * Günlük özeti WhatsApp (CallMeBot) veya Telegram'a gönderir.
 *
 * Sağlayıcı seçimi:
 *   NOTIFY_PROVIDER=telegram | textmeflow | callmebot | webhook
 *   (boşsa: Telegram token varsa telegram, TextMeFlow anahtarı varsa textmeflow,
 *    CallMeBot anahtarı varsa callmebot)
 *
 * Telegram:
 *   TELEGRAM_TOKEN    @BotFather'dan alınan token
 *   TELEGRAM_CHAT_ID  size ait chat id (--telegram-setup ile bulunur)
 *
 * TextMeFlow (WhatsApp, ücretsiz plan 50 mesaj/ay):
 *   TEXTMEFLOW_APIKEY  panelden alınan anahtar
 *   TEXTMEFLOW_TO      alıcı numara (+90533...), boşsa WHATSAPP_PHONE
 *
 * CallMeBot (WhatsApp):
 *   WHATSAPP_PHONE    +90533xxxxxxx
 *   WHATSAPP_APIKEY   CallMeBot anahtarı
 *
 * Genel webhook (ntfy, Make, Zapier...):
 *   NOTIFY_WEBHOOK_URL  POST {"text": "..."} alan adres
 *
 * Kullanım:
 *   node src/notify.js                  # gönderir
 *   node src/notify.js --dry-run        # mesajı yazdırır
 *   node src/notify.js --telegram-setup # botunuza yazdıktan sonra chat id'yi bulur
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tgSetup = args.includes('--telegram-setup');

const SITE_URL = process.env.SITE_URL || 'https://ryucel.github.io/japanexport/';
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const WA_PHONE = process.env.WHATSAPP_PHONE;
const WA_KEY = process.env.WHATSAPP_APIKEY;
const TMF_KEY = process.env.TEXTMEFLOW_APIKEY;
const TMF_TO = process.env.TEXTMEFLOW_TO || process.env.WHATSAPP_PHONE;
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;

const SENDERS = {
  telegram: { label: 'Telegram', configured: () => !!(TG_TOKEN && TG_CHAT), send: (t) => sendTelegram(t) },
  textmeflow: { label: 'TextMeFlow', configured: () => !!(TMF_KEY && TMF_TO), send: (t) => sendTextMeFlow(t) },
  callmebot: { label: 'CallMeBot', configured: () => !!(WA_PHONE && WA_KEY), send: (t) => sendWhatsApp(t) },
  webhook: { label: 'Webhook', configured: () => !!WEBHOOK_URL, send: (t) => sendWebhook(t) }
};

/**
 * NOTIFY_PROVIDER:
 *   "telegram,textmeflow"  → ikisine birden
 *   "all"                  → yapılandırılmış tüm kanallar
 *   boş                    → otomatik (telegram > textmeflow > callmebot > webhook)
 */
function resolveProviders() {
  const raw = String(process.env.NOTIFY_PROVIDER || '').trim().toLowerCase();
  if (raw === 'all') return Object.keys(SENDERS).filter((k) => SENDERS[k].configured());
  if (raw && raw !== 'none') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((k) => SENDERS[k]);
  }
  if (raw === 'none') return [];
  const auto = ['telegram', 'textmeflow', 'callmebot', 'webhook'].find((k) => SENDERS[k].configured());
  return auto ? [auto] : [];
}

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const fmtPct = (n) => String(n).replace('.', ',');

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const trDate = (d) => `${d.getUTCDate()} ${TR_MONTHS[d.getUTCMonth()]}`;

async function telegramSetup() {
  if (!TG_TOKEN) {
    console.error('TELEGRAM_TOKEN gerekli. @BotFather ile bot oluşturup token alın.');
    process.exit(1);
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`);
  const data = await res.json();
  if (!data.ok) {
    console.error('Telegram hatası:', data.description);
    process.exit(1);
  }
  const chats = new Map();
  for (const u of data.result || []) {
    const chat = u.message?.chat || u.channel_post?.chat;
    if (chat) chats.set(chat.id, chat.username ? '@' + chat.username : chat.title || chat.first_name || '');
  }
  if (!chats.size) {
    console.log('Chat bulunamadı. Telegram’da botunuza bir mesaj gönderip tekrar deneyin.');
    return;
  }
  for (const [id, name] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
}

function alertFilterText(f = {}) {
  const bits = [];
  if (f.maxPriceGbp > 0) bits.push(`≤£${nf.format(f.maxPriceGbp)}`);
  if (f.maxKm > 0) bits.push(`≤${nf.format(f.maxKm)} km`);
  if (f.minYear > 0) bits.push(`${f.minYear}+`);
  if (f.fuel === 'hybrid') bits.push('hibrit');
  if (f.fuel === 'petrol') bits.push('benzin');
  if (f.drive) bits.push(f.drive);
  if (f.minGapPct > 0) bits.push(`piyasa ≥%${fmtPct(f.minGapPct)}`);
  return bits.join(' · ');
}

function alertSection(a) {
  const out = [];
  out.push(`🎯 ${a.name}${a.filters ? `  (${alertFilterText(a.filters)})` : ''}`);

  const list = a.matches || [];
  if (!list.length) {
    out.push('   uygun ilan yok');
  } else {
    list.slice(0, 5).forEach((d, i) => {
      const gap = d.gap >= 0 ? `−%${fmtPct(d.gap)}` : `+%${fmtPct(Math.abs(d.gap))}`;
      const grade = d.grade ? ` ${d.grade}` : '';
      out.push(`${i + 1}) ${d.model} · ${d.ym}${grade} · ${nf.format(d.km || 0)} km`);
      out.push(`   £${nf.format(d.totalGbp)} gümrüklü · piyasa ${gap}`);
      if (d.url) out.push(`   ${d.url}`);
    });
  }

  if (a.auctions?.length) {
    out.push('   🔨 Müzayede lotları (başlangıç fiyatı):');
    a.auctions.slice(0, 3).forEach((d) => {
      const year = String(d.ym).split('/')[0];
      out.push(`   • ${d.model} · ${year} · ${nf.format(d.km || 0)} km · en az £${nf.format(d.totalGbp)}`);
      if (d.url) out.push(`     ${d.url}`);
    });
  }

  out.push('');
  return out;
}

function buildMessage(index, prefs, allowAlert = () => true) {
  const models = index.models || [];
  const total = models.reduce((a, m) => a + (m.total || 0), 0);
  const eligible = models.reduce((a, m) => a + (m.eligible || 0), 0);

  const lines = [];
  lines.push(`${prefs.header || '🚗 KKTC Araç Avcısı'} · ${trDate(new Date(index.updatedAt || Date.now()))}`);
  lines.push(`${models.length} model · ${nf.format(total)} ilan tarandı, ${nf.format(eligible)} tanesi 5 yaşa uygun.`);
  lines.push('');

  // 1) alerts.json profilleri (yeni yol)
  if (Array.isArray(index.alerts)) {
    const alerts = index.alerts.filter(allowAlert);
    if (!alerts.length) {
      lines.push('Bu kanala atanmış alert yok.');
    } else {
      for (const a of alerts) lines.push(...alertSection(a));
    }
    lines.push(prefs.footer || 'Tüm liste ve maliyet dökümü:');
    lines.push(SITE_URL);
    return lines.join('\n');
  }

  // 2) Eski tek liste modu (notify.json → maxPriceGbp)
  const wanted = new Set(prefs.models || []);
  let deals = models
    .filter((m) => !wanted.size || wanted.has(m.key))
    .flatMap((m) => (m.top || []).map((t) => ({ ...t, model: m.label })));

  if (prefs.maxPriceGbp > 0) deals = deals.filter((d) => d.totalGbp <= prefs.maxPriceGbp);
  if (prefs.minGapPct > 0) deals = deals.filter((d) => d.gap >= prefs.minGapPct);
  deals = deals.sort((a, b) => b.score - a.score).slice(0, prefs.topN || 5);

  if (prefs.maxPriceGbp > 0) lines.push(`Bütçe: en fazla £${nf.format(prefs.maxPriceGbp)} gümrüklü.`);
  lines.push('');

  if (deals.length) {
    lines.push('🔥 Bugünün en iyi fırsatları:');
    deals.forEach((d, i) => {
      const gap = d.gap >= 0 ? `piyasa −%${fmtPct(d.gap)}` : `piyasa +%${fmtPct(Math.abs(d.gap))}`;
      const grade = d.grade ? ` ${d.grade}` : '';
      lines.push(`${i + 1}) ${d.model} · ${d.ym}${grade}`);
      lines.push(`   ${nf.format(d.km || 0)} km · £${nf.format(d.totalGbp)} gümrüklü · ${gap}`);
      if (d.url) lines.push(`   ${d.url}`);
    });
    lines.push('');
  } else {
    lines.push(prefs.maxPriceGbp > 0 ? `Bugün £${nf.format(prefs.maxPriceGbp)} altında uygun fırsat yok.` : 'Bugün uygun ilan bulunamadı.');
    lines.push('');
  }

  lines.push(prefs.footer || 'Tüm liste ve maliyet dökümü:');
  lines.push(SITE_URL);
  return lines.join('\n');
}

async function loadPrefs() {
  const defaults = { maxPriceGbp: 0, models: [], topN: 5, minGapPct: 0, header: '🚗 KKTC Araç Avcısı', footer: 'Tüm liste ve maliyet dökümü:' };
  try {
    const raw = JSON.parse(await readFile(path.resolve('notify.json'), 'utf8'));
    return { ...defaults, ...raw };
  } catch {
    return defaults;
  }
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) throw new Error('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID eksik');
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
}

async function sendWhatsApp(text) {
  const url =
    'https://api.callmebot.com/whatsapp.php' +
    `?phone=${encodeURIComponent(WA_PHONE)}` +
    `&text=${encodeURIComponent(text)}` +
    `&apikey=${encodeURIComponent(WA_KEY)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = (await res.text()).trim().slice(0, 200);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
}

async function sendTextMeFlow(text) {
  if (!TMF_KEY || !TMF_TO) throw new Error('TEXTMEFLOW_APIKEY / TEXTMEFLOW_TO eksik');
  const res = await fetch('https://api.textmeflow.eu/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TMF_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ to: TMF_TO, text }),
    signal: AbortSignal.timeout(25000)
  });
  const body = (await res.text()).trim();
  if (res.status === 202 || res.ok) return;
  throw new Error(`HTTP ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
}

async function sendWebhook(text) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function main() {
  if (tgSetup) return telegramSetup();

  let index;
  try {
    index = JSON.parse(await readFile(path.resolve('public', 'data', 'index.json'), 'utf8'));
  } catch {
    console.log('ℹ️  public/data/index.json yok — önce `npm run build`.');
    return;
  }

  const prefs = await loadPrefs();

  if (dryRun) {
    const text = buildMessage(index, prefs);
    console.log('\n--- MESAJ ---\n' + text + '\n--- /MESAJ ---\n');
    return;
  }

  const providers = resolveProviders();
  if (!providers.length) {
    console.log('ℹ️  Bildirim sağlayıcısı tanımlı değil (TELEGRAM_TOKEN, TEXTMEFLOW_APIKEY veya WHATSAPP_APIKEY).');
    return;
  }

  let ok = 0;
  for (const key of providers) {
    const s = SENDERS[key];
    if (!s.configured()) {
      console.log(`ℹ️  ${s.label}: yapılandırılmadı, atlandı.`);
      continue;
    }
    const allow = (a) => !a.channels?.length || a.channels.includes(key);
    if (Array.isArray(index.alerts) && !index.alerts.some(allow)) {
      console.log(`ℹ️  ${s.label}: bu kanala atanmış alert yok, atlandı.`);
      continue;
    }
    const text = buildMessage(index, prefs, allow);
    try {
      await s.send(text);
      ok++;
      console.log(`✅  ${s.label} gönderildi.`);
    } catch (err) {
      console.warn(`⚠️  ${s.label} gönderilemedi: ${err.message}`);
    }
  }
  console.log(`📬  ${ok}/${providers.length} kanal başarılı.`);
}

main();
