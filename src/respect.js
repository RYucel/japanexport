/**
 * Respect Motors açık artırma tarayıcısı (respectmotors.com/en/auctions/).
 *
 * Sayfa POST formu ile çalışır: marka + model + yıl/km aralığı gönderilir,
 * sonuçlar 10'ar lot halinde döner. Fiyat olarak **başlangıç fiyatı** (JPY)
 * gösterilir; kesin satış fiyatı ve ortalama login gerektirir.
 */

const BASE = 'https://respectmotors.com';
const LIST_URL = `${BASE}/en/auctions/`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(s) {
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function post(form, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(LIST_URL, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
          Referer: LIST_URL
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error(`Respect Motors isteği başarısız: ${lastErr?.message}`);
}

export function parseLots(html) {
  const chunks = html.split('class="aucblock"').slice(1);
  const lots = [];

  for (const chunk of chunks) {
    const href = /<a href="(\/en\/auctions\/[^"]+)" class="aucpic"/.exec(chunk)?.[1];
    if (!href) continue;

    const lotMatch = /Lot:\s*<span[^>]*>([^<]+)<\/span>,\s*<span[^>]*>([^<]+)<\/span>/.exec(chunk);
    const titleMatch = /<b>(\d{4})\s+([^<]+)<\/b>/.exec(chunk);
    const titleText = titleMatch ? clean(titleMatch[2]) : '';
    const titleParts = titleText.split(/\s+/);
    const details = clean(/<\/b>\s*<br>\s*([^<]+)/.exec(chunk)?.[1] || '');
    const startJpy = digits(/title="Start:\s*[^0-9]*([\d\s.,]+)"/.exec(chunk)?.[1] || '');
    const image =
      /background:url\('([^']+)'\)/.exec(chunk)?.[1] || '';

    const parts = details.split(',').map((s) => s.trim());
    const cc = digits(parts.find((p) => /^\d{3,4}\s*cc$/i.test(p)) || '');
    const km = digits(parts.find((p) => /^\d[\d,]*\s*km$/i.test(p)) || '');
    const transmission = parts.find((p) => /^(AT|MT|CVT|FAT|DAT)$/i.test(p)) || '';

    lots.push({
      lotId: href.split('/').filter(Boolean).pop(),
      lotNo: lotMatch ? clean(lotMatch[1]) : '',
      auction: lotMatch ? clean(lotMatch[2]) : '',
      regYear: titleMatch ? Number(titleMatch[1]) : null,
      title: titleMatch ? `${titleMatch[1]} ${titleText}`.trim() : '',
      make: titleParts[0] || '',
      model: titleParts.slice(1).join(' '),
      chassis: titleParts.length > 1 ? titleParts[titleParts.length - 1] : '',
      engineCc: cc,
      mileageKm: km,
      transmission,
      startJpy,
      startUsd: digits(/Start:\s*\$\s*<b>([\d,]+)<\/b>/.exec(chunk)?.[1] || ''),
      image,
      url: `${BASE}${href}`,
      details
    });
  }
  return lots;
}

export function parsePages(html) {
  const nums = [...html.matchAll(/pbut\((\d+)\)/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 1;
}

export function parseTotal(html) {
  return digits(/on sale\s*<b>([\d,]+)<\/b>/.exec(html)?.[1] || '');
}

/**
 * Belirli bir marka/model için lotları toplar.
 * @param {{make:string, model:string, yearFrom?:number, yearTo?:number}} s
 */
export async function scanModel(s, { maxPages = 4, onProgress = () => {} } = {}) {
  const form = {
    page: 1,
    sel_block_name: '',
    marka_name: s.make,
    model_name: s.model,
    year1: s.yearFrom || '',
    year2: s.yearTo || '',
    mil1: '',
    mil2: '',
    ssearch: '1'
  };

  let html = await post(form);
  const totalPages = Math.min(parsePages(html), maxPages);
  const total = parseTotal(html);
  const seen = new Set();
  const lots = [];

  const push = (list) => {
    for (const lot of list) {
      if (seen.has(lot.lotId)) continue;
      seen.add(lot.lotId);
      lots.push(lot);
    }
  };

  push(parseLots(html));
  onProgress({ page: 1, total: lots.length });

  for (let page = 2; page <= totalPages; page++) {
    await sleep(1200);
    html = await post({ ...form, page });
    const pageLots = parseLots(html);
    if (!pageLots.length) break;
    push(pageLots);
    onProgress({ page, total: lots.length });
  }

  return { lots, total, pages: totalPages };
}
