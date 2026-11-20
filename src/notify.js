#!/usr/bin/env node
/**
 * Günlük özeti WhatsApp (CallMeBot) veya Telegram'a gönderir.
 *
 * Sağlayıcı seçimi:
 *   NOTIFY_PROVIDER=telegram | callmebot   (boşsa: Telegram token varsa telegram, yoksa callmebot)
 *
 * Telegram:
 *   TELEGRAM_TOKEN    @BotFather'dan alınan token
 *   TELEGRAM_CHAT_ID  size ait chat id (--telegram-setup ile bulunur)
 *
 * CallMeBot (WhatsApp):
 *   WHATSAPP_PHONE    +90533xxxxxxx
 *   WHATSAPP_APIKEY   CallMeBot anahtarı
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

const provider =
  process.env.NOTIFY_PROVIDER || (TG_TOKEN ? 'telegram' : WA_KEY ? 'callmebot' : 'none');

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

function buildMessage(index) {
  const models = index.models || [];
  const deals = models
    .flatMap((m) => (m.top || []).map((t) => ({ ...t, model: m.label })))
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
      if (d.url) lines.push(`   ${d.url}`);
    });
    lines.push('');
  } else {
    lines.push('Bugün uygun ilan bulunamadı.');
    lines.push('');
  }

  lines.push('Tüm liste ve maliyet dökümü:');
  lines.push(SITE_URL);
  return lines.join('\n');
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

async function main() {
  if (tgSetup) return telegramSetup();

  let index;
  try {
    index = JSON.parse(await readFile(path.resolve('public', 'data', 'index.json'), 'utf8'));
  } catch {
    console.log('ℹ️  public/data/index.json yok — önce `npm run build`.');
    return;
  }

  const text = buildMessage(index);

  if (dryRun) {
    console.log('\n--- MESAJ ---\n' + text + '\n--- /MESAJ ---\n');
    return;
  }

  if (provider === 'telegram') {
    try {
      await sendTelegram(text);
      console.log('✅  Telegram bildirimi gönderildi.');
    } catch (err) {
      console.warn(`⚠️  Telegram gönderilemedi: ${err.message}`);
    }
    return;
  }

  if (provider === 'callmebot') {
    if (!WA_PHONE || !WA_KEY) {
      console.log('ℹ️  WHATSAPP_PHONE / WHATSAPP_APIKEY tanımlı değil — bildirim atlandı.');
      return;
    }
    try {
      await sendWhatsApp(text);
      console.log('✅  WhatsApp bildirimi gönderildi.');
    } catch (err) {
      console.warn(`⚠️  WhatsApp gönderilemedi: ${err.message}`);
    }
    return;
  }

  console.log('ℹ️  Bildirim sağlayıcısı tanımlı değil (TELEGRAM_TOKEN veya WHATSAPP_APIKEY).');
}

main();
