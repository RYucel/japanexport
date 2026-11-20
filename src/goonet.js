/**
 * Goo-net Exchange (goo-net-exchange.com) tarayıcısı.
 *
 * Sayfa sunucu tarafında render edilir; filtre/pagination POST ile `form1`
 * alanlarının tekrar gönderilmesiyle yapılır (offset=20,40,...).
 * Liste sayfasında yakıt tipi ve çekiş yoktur; yakıt başlıktan çıkarılır.
 */

const BASE = 'https://www.goo-net-exchange.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(s) {
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function request(url, { method = 'GET', body, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: url,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
        },
        body,
        signal: AbortSignal.timeout(45000)
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      // 429/5xx: site agresif hız sınırlıyor, kademeli bekle
      if (attempt < retries) await sleep(12000 * (attempt + 1));
    }
  }
  throw new Error(`Goo-net sayfası alınamadı: ${lastErr?.message}`);
}

export function buildListUrl(search) {
  const make = (search.makeName || 'TOYOTA').toUpperCase();
  const model = (search.modelName || search.model || 'RAV4').toUpperCase();
  return `${BASE}/usedcars/${make}/${model}/`;
}

/** form1'in gizli alanlarını (offset hariç) çıkarır. */
export function extractForm(html) {
  const start = html.indexOf('<form name="form1"');
  if (start < 0) return [];
  const end = html.indexOf('</form>', start);
  const form = html.slice(start, end);
  const pairs = [];
  for (const m of form.matchAll(/<input[^>]*>/g)) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    if (!name || name === 'offset' || name === 'page') continue;
    const value = /value="([^"]*)"/.exec(tag)?.[1] ?? '';
    pairs.push([name, value]);
  }
  return pairs;
}

export function parseTotal(html) {
  const m = /<span>\s*([\d,]+)\s*<\/span>\s*&nbsp;\(Showing&nbsp;/i.exec(html);
  return m ? digits(m[1]) : null;
}

export function parseListings(html, { modelName = 'RAV4' } = {}) {
  const starts = [];
  const re = /<li>\s*<a class="spread_link_new_tab"\s+href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) starts.push({ index: m.index, href: m[1] });

  const cars = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = html.slice(starts[i].index, starts[i + 1]?.index ?? starts[i].index + 6000);
    const href = starts[i].href;
    const id = (/(\d{6,})\/?$/.exec(href) || [])[1];
    if (!id) continue;

    const title = clean(/<h3 class="title">([\s\S]*?)<\/h3>/.exec(chunk)?.[1] || '');
    const location = clean(/<p class="location">([\s\S]*?)<\/p>/.exec(chunk)?.[1] || '');
    const image = /data-src="([^"]+)"/.exec(chunk)?.[1] || '';
    const priceRaw = /name="currency-price"\s+value='([^']+)'/.exec(chunk)?.[1];
    if (!priceRaw) continue;

    let priceJpy = null;
    let priceUsd = null;
    try {
      const p = JSON.parse(priceRaw);
      priceJpy = digits(p.JPY);
      priceUsd = digits(p.USD);
    } catch {
      continue;
    }
    if (!priceJpy || priceJpy <= 0) continue;

    const detailBlock = /<ul class="details">([\s\S]*?)<\/ul>/.exec(chunk)?.[1] || '';
    const details = [...detailBlock.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((d) => clean(d[1]));

    const ym = /^(\d{4})[./](\d{1,2})$/.exec(details[0] || '');
    const regYear = ym ? Number(ym[1]) : null;
    const regMonth = ym ? Number(ym[2]) : null;

    const mileageKm = digits(details.find((d) => /km$/i.test(d)) || '');
    const engineCc = digits(details.find((d) => /cc$/i.test(d)) || '');
    const steeringRaw = details.find((d) => /^(right|left)$/i.test(d)) || '';
    const transmission = details.find((d) => /^(AT|MT|CVT|FAT|DCT)$/i.test(d)) || '';

    const upper = title.toUpperCase();
    const fuel = /HYBRID|PHV|PHEV/.test(upper) ? 'HYBRID(PETROL)' : 'PETROL';

    const modelIdx = upper.indexOf(modelName.toUpperCase());
    const grade = modelIdx >= 0 ? title.slice(modelIdx + modelName.length).trim() : title;

    cars.push({
      stockId: `GN-${id}`,
      title: title || `TOYOTA ${modelName}`,
      grade,
      regYear,
      regMonth,
      manufactureYear: regYear,
      priceAmount: priceJpy,
      priceUsd,
      priceCurrency: 'JPY',
      mileageKm,
      modelCode: '',
      transmission,
      fuel,
      drive: '',
      steering: steeringRaw ? (/right/i.test(steeringRaw) ? 'RHD' : 'LHD') : '',
      engineCc,
      engineCode: '',
      doors: '',
      seating: '',
      bodyType: 'SUV',
      bodyColor: details[1] || '',
      location,
      image,
      url: href.startsWith('http') ? href : `${BASE}${href}`,
      isSold: false,
      source: 'goonet'
    });
  }
  return cars;
}

/**
 * Tüm sayfaları POST/offset ile gezer.
 */
export async function scan(search, { maxPages = 35, onProgress = () => {} } = {}) {
  const listUrl = buildListUrl(search);
  let html = await request(listUrl);

  // Yanlış model yolu, sitenin "tüm marka" sayfasına düşer (on binlerce araç).
  // Böyle bir durumda veriyi modele yazmamak için H1 başlığını doğrula.
  const h1 = (/<h1[^>]*class="title-page"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] || '').trim();
  const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const modelName = search.modelName || search.model;
  const makeName = search.makeName || '';
  if (h1 && (!norm(h1).includes(norm(modelName)) || (makeName && !norm(h1).includes(norm(makeName))))) {
    console.warn(`Goo-net: ${makeName} ${modelName} doğrulanamadı ("${h1}") — atlandı.`);
    return { cars: [], totalCount: 0, pagesFetched: 0, skipped: true };
  }

  const totalCount = parseTotal(html);
  const form = extractForm(html);

  const seen = new Set();
  const cars = [];
  const push = (list) => {
    for (const car of list) {
      if (seen.has(car.stockId)) continue;
      seen.add(car.stockId);
      cars.push(car);
    }
  };

  push(parseListings(html, { modelName: search.modelName || search.model }));
  onProgress({ source: 'goonet', page: 1, total: cars.length, totalCount });

  for (let page = 2; page <= maxPages; page++) {
    if (totalCount != null && cars.length >= totalCount) break;
    await sleep(1800);

    const body = new URLSearchParams(form);
    body.set('offset', String((page - 1) * 20));

    html = await request(listUrl, { method: 'POST', body: body.toString() });
    const pageCars = parseListings(html, { modelName: search.modelName || search.model });
    if (!pageCars.length) break;
    push(pageCars);

    onProgress({ source: 'goonet', page, total: cars.length, totalCount });
  }

  return { cars, totalCount, pagesFetched: Math.min(maxPages, Math.ceil(cars.length / 20) || 1) };
}
