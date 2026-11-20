/**
 * SBT Japan (sbtjapan.com) arama sayfası tarayıcısı.
 * Sayfa HTML'i sunucu tarafında render edilir; ilanlar `data-stock-id` blokları
 * halinde gelir. Harici bir HTML parser bağımlılığı kullanmamak için kartlar
 * regex ile, bilinen ve stabil sınıf adları üzerinden çözümlenir.
 */

const BASE = 'https://www.sbtjapan.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
};

function clean(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function attr(chunk, name) {
  return new RegExp(`${name}="([^"]*)"`).exec(chunk)?.[1] ?? '';
}

export function buildSearchUrl(search, page = 1) {
  const yearFrom = new Date().getFullYear() - (search.yearFromBack ?? 6);
  const params = new URLSearchParams();
  params.set('make_id', String(search.makeId));
  params.set('model[0]', search.model);
  if (search.steering) params.set('steering', search.steering);
  if (search.sort) params.set('s', search.sort);
  params.set('year__from', String(search.yearFrom ?? yearFrom));
  params.set('page', String(page));
  return `${BASE}/used-cars/search?${params.toString()}`;
}

export async function fetchPage(url, { retries = 2, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw new Error(`SBT sayfası alınamadı (${url}): ${lastErr?.message}`);
}

export function parseListings(html, { modelFilter = 'RAV4', includeSold = false } = {}) {
  const starts = [];
  const marker = 'data-stock-id="';
  let idx = html.indexOf(marker);
  while (idx !== -1) {
    starts.push(idx);
    idx = html.indexOf(marker, idx + marker.length);
  }

  const cars = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = html.slice(starts[i], starts[i + 1] ?? starts[i] + 90000);
    const stockId = attr(chunk, 'data-stock-id');
    if (!stockId) continue;

    const isSold = attr(chunk, 'data-is-sold') === '1';
    if (isSold && !includeSold) continue;

    const title = clean(/<h2[^>]*class="[^"]*vehicle-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/.exec(chunk)?.[1] || '');
    const priceCurrency = (/card-product__price-currency">\s*([A-Z]{3})/.exec(chunk)?.[1] || 'JPY').toUpperCase();
    const priceAmount = num(/<span class="card-product__price">\s*([\d,]+)\s*<\/span>/.exec(chunk)?.[1]);

    const attributes = {};
    const attrRe = /<div class="vehicle-attribute[^"]*">\s*<span class="dark-grey-primary">([\s\S]*?)<\/span>\s*<span class="light-grey-primary">([\s\S]*?)<\/span>/g;
    for (const m of chunk.matchAll(attrRe)) {
      attributes[clean(m[2]).toLowerCase()] = clean(m[1]);
    }

    const specs = {};
    const specRe = /<h5[^>]*>\s*([^<]+?)\s*:?\s*<\/h5>\s*<h6>\s*([\s\S]*?)<\/h6>/g;
    for (const m of chunk.matchAll(specRe)) {
      specs[clean(m[1]).toLowerCase().replace(/:$/, '')] = clean(m[2]);
    }

    const titleMatch = /^(\d{4})\s*\/\s*(\d{1,2})\s+(.*)$/.exec(title);
    const regYear = num(titleMatch?.[1]) ?? num((specs['registration'] || '').replace(/\s/g, '').slice(0, 4));
    const regMonth = num(titleMatch?.[2]) ?? num((specs['registration'] || '').replace(/\s/g, '').slice(4, 6));
    const rest = titleMatch?.[3] || title;
    const modelIdx = rest.toUpperCase().indexOf(String(modelFilter).toUpperCase());
    const grade = modelIdx >= 0 ? rest.slice(modelIdx + String(modelFilter).length).trim() : rest;

    const engineCc = num(attributes['engine']);
    const mileageKm = num(attributes['mileage']);
    const detailUrl = attr(chunk, 'data-detail-url');

    cars.push({
      stockId,
      title,
      grade,
      regYear,
      regMonth,
      manufactureYear: num(specs['manufacture']) ?? null,
      priceAmount,
      priceCurrency,
      mileageKm,
      modelCode: attributes['model code'] || '',
      transmission: attributes['transmission'] || '',
      fuel: attributes['fuel type'] || '',
      drive: attributes['drive'] || '',
      steering: attributes['steering'] || '',
      engineCc,
      engineCode: attributes['engine code'] || '',
      doors: attributes['doors'] || '',
      seating: attributes['seating'] || '',
      bodyType: specs['body type'] || '',
      bodyColor: specs['body color'] || '',
      location: specs['inventory location'] || '',
      image: (attr(chunk, 'data-main-image') || '').replace(/&amp;/g, '&'),
      url: detailUrl ? `${BASE}${detailUrl}` : `${BASE}/used-cars`,
      isSold,
      source: 'sbtjapan'
    });
  }
  return cars;
}

function parseTotalCount(html) {
  const m = /<span class="search-result__result-number">\s*([\d,]+)\s*<\/span>/.exec(html) || /([\d,]{2,})\s*Results/.exec(html);
  return m ? num(m[1]) : null;
}

/**
 * Tüm sonuç sayfalarını (veya maxPages kadarını) tarar.
 */
export async function scan(search, { onProgress = () => {}, maxPages = 30, includeSold = false } = {}) {
  const cars = [];
  const seen = new Set();
  let totalCount = null;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildSearchUrl(search, page);
    const html = await fetchPage(url);
    if (page === 1) totalCount = parseTotalCount(html);

    const pageCars = parseListings(html, { modelFilter: search.modelFilter || search.model, includeSold });
    pagesFetched++;

    for (const car of pageCars) {
      if (seen.has(car.stockId)) continue;
      seen.add(car.stockId);
      cars.push(car);
    }

    onProgress({ page, pageCars: pageCars.length, total: cars.length, totalCount });

    if (pageCars.length === 0) break;
    if (totalCount != null && cars.length >= totalCount) break;
    // Nazik tarama: istekler arasında kısa bekleme
    await new Promise((r) => setTimeout(r, 250));
  }

  return { cars, totalCount, pagesFetched, scannedAt: new Date().toISOString() };
}
