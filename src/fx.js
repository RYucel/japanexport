import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const DATA_DIR = path.resolve('data');
const FX_CACHE = path.join(DATA_DIR, 'fx.json');

// TCMB bugün yayınlamadıysa (hafta sonu/tatil) kullanılan yedek kurlar.
// Değerler: 1 birim = ? TRY (JPY için 1 JPY).
const FALLBACK = {
  USD: 50.47,
  GBP: 66.5,
  EUR: 55.46,
  JPY: 0.3166
};

function parseTcmb(xml) {
  const rates = {};
  const blocks = xml.match(/<Currency[\s\S]*?<\/Currency>/g) || [];
  for (const block of blocks) {
    const code = /CurrencyCode="([A-Z]{3})"/.exec(block)?.[1];
    if (!code) continue;
    const unit = Number(/<Unit>(\d+)<\/Unit>/.exec(block)?.[1] || 1);
    const selling = Number(/<ForexSelling>([\d.,]+)<\/ForexSelling>/.exec(block)?.[1]?.replace(',', '.'));
    if (!code || !Number.isFinite(selling) || selling <= 0) continue;
    rates[code] = selling / unit;
  }
  return rates;
}

/**
 * TCMB döviz satış kurlarını döndürür. Değerler: 1 birim = ? TRY.
 * @returns {Promise<{base:string, date:string, source:string, rates:Record<string,number>, usdTry:number, gbpTry:number, jpyTry:number, eurTry:number}>}
 */
export async function getFx({ force = false } = {}) {
  let cached = null;
  try {
    cached = JSON.parse(await readFile(FX_CACHE, 'utf8'));
  } catch {
    /* yok */
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!force && cached?.date === today && cached?.rates) return cached;

  try {
    const res = await fetch(TCMB_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JapanExportGuide/1.0)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = parseTcmb(xml);
    if (!parsed.USD || !parsed.GBP || !parsed.JPY) throw new Error('TCMB: eksik kur');

    const out = {
      base: 'TRY',
      date: today,
      source: 'TCMB (döviz satış)',
      rates: parsed,
      usdTry: parsed.USD,
      gbpTry: parsed.GBP,
      eurTry: parsed.EUR,
      jpyTry: parsed.JPY
    };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(FX_CACHE, JSON.stringify(out, null, 2), 'utf8');
    return out;
  } catch (err) {
    // Son bilinen kuru kullan, yoksa sabit yedek.
    const rates = cached?.rates || FALLBACK;
    return {
      base: 'TRY',
      date: cached?.date || today,
      source: `yedek kur (${cached ? 'son kayıt' : 'varsayılan'}) — TCMB erişilemedi: ${err.message}`,
      rates,
      usdTry: rates.USD,
      gbpTry: rates.GBP,
      eurTry: rates.EUR,
      jpyTry: rates.JPY,
      stale: true
    };
  }
}

export function jpyToGbp(jpy, fx) {
  return (jpy * fx.jpyTry) / fx.gbpTry;
}
export function jpyToTry(jpy, fx) {
  return jpy * fx.jpyTry;
}
export function usdToTry(usd, fx) {
  return usd * fx.usdTry;
}
export function tryToGbp(tryAmount, fx) {
  return tryAmount / fx.gbpTry;
}
