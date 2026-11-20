/**
 * Piyasa modeli ve fırsat skoru.
 *
 *   1) Aşırı uç fiyatlar (aynı yaş kovası medyanının 0,5–2,0 katı dışı) ayıklanır.
 *   2) Temiz havuzdan 6 aylık yaş kovalarına göre medyan fiyat eğrisi çıkarılır.
 *   3) Her yakıt/motor grubu için eğriye göre katsayı (ör. 2.5 hibrit = 1,15) hesaplanır.
 *   4) Araç fiyatı, kendi yaş kovası × grup katsayısı × km düzeltmesi ile karşılaştırılır.
 *
 * Örneklem küçükse fark, güvene göre küçültülür (shrinkage) — böylece 80 ilanlık
 * bir modelde "piyasanın %60 altında" gibi yanıltıcı sonuçlar çıkmaz.
 */

function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function groupKey(car) {
  const fuel = (car.fuel || '').toUpperCase().includes('HYBRID')
    ? 'HYBRID'
    : (car.fuel || '').toUpperCase().includes('DIESEL')
      ? 'DIESEL'
      : 'PETROL';
  const cc = car.engineCc || 0;
  const ccBucket = cc <= 1600 ? '<=1.6' : cc <= 2000 ? '1.6-2.0' : cc <= 2500 ? '2.0-2.5' : '>2.5';
  return `${fuel}|${ccBucket}`;
}

// GR Corolla "RZ", GR Yaris, Golf GTI, Nismo, STI gibi performans donanımları
// aynı model adı altında 2 kat fiyatla listelenir; emsal hesabına karışmamalı.
const PERF_RE = /\b(RZ|GR|GRMN|MORIZO|NISMO|STI|TYPE[- ]?R|GTI|GTS)\b/;

export function isPerformance(car) {
  const text = `${car.grade || ''} ${car.title || ''}`.toUpperCase();
  return PERF_RE.test(text);
}

const KM_COEF = 0.012; // her 10.000 km fazlası ~ %1,2 daha ucuz

export function buildMarket(cars) {
  const withPrice = cars.filter((c) => c.priceAmount > 0 && !isPerformance(c));
  const eligible = withPrice.filter((c) => c.eligible);
  const pool = eligible.length >= 30 ? eligible : withPrice;

  const ageKeyOf = (ageMonths) => Math.max(0, Math.round((ageMonths || 0) / 6) * 6);

  // 1. ham yaş medyanları
  const rawByAge = new Map();
  for (const car of pool) {
    const a = ageKeyOf(car.ageMonthsNow);
    if (!rawByAge.has(a)) rawByAge.set(a, []);
    rawByAge.get(a).push(car.priceAmount);
  }
  const rawAgeMedian = new Map();
  for (const [a, prices] of rawByAge) rawAgeMedian.set(a, median(prices));

  // 2. uç fiyatları ayıkla (GR Corolla, özel donanım, hatalı fiyat vb.)
  const clean = pool.filter((car) => {
    const a = ageKeyOf(car.ageMonthsNow);
    const base = rawAgeMedian.get(a);
    if (!base || (rawByAge.get(a)?.length || 0) < 5) return true;
    const r = car.priceAmount / base;
    return r >= 0.5 && r <= 2.0;
  });

  const byAge = new Map();
  const kmByAge = new Map();
  const allPrices = [];
  const allKms = [];
  for (const car of clean) {
    const a = ageKeyOf(car.ageMonthsNow);
    if (!byAge.has(a)) {
      byAge.set(a, []);
      kmByAge.set(a, []);
    }
    byAge.get(a).push(car.priceAmount);
    kmByAge.get(a).push(car.mileageKm || 0);
    allPrices.push(car.priceAmount);
    allKms.push(car.mileageKm || 0);
  }

  const ageMedian = new Map();
  for (const [a, prices] of byAge) ageMedian.set(a, median(prices));
  const ageKmMedian = new Map();
  for (const [a, kms] of kmByAge) ageKmMedian.set(a, median(kms));

  const globalMedian = median(allPrices);
  const globalKm = median(allKms);

  // 3. grup katsayısı: fiyat / kendi yaş kovasının medyanı
  const residuals = new Map();
  for (const car of clean) {
    const a = ageKeyOf(car.ageMonthsNow);
    const base = ageMedian.get(a) || globalMedian;
    if (!base) continue;
    const g = groupKey(car);
    if (!residuals.has(g)) residuals.set(g, []);
    residuals.get(g).push(car.priceAmount / base);
  }
  const groupFactor = new Map();
  for (const [g, list] of residuals) {
    const f = median(list);
    if (f) groupFactor.set(g, Math.max(0.65, Math.min(1.6, f)));
  }

  function baseFor(ageMonths) {
    const a = ageKeyOf(ageMonths);
    if (ageMedian.has(a)) return { base: ageMedian.get(a), km: ageKmMedian.get(a) ?? globalKm };
    for (const d of [6, -6, 12, -12, 18, -18, 24, -24]) {
      if (ageMedian.has(a + d)) return { base: ageMedian.get(a + d), km: ageKmMedian.get(a + d) ?? globalKm };
    }
    return { base: globalMedian, km: globalKm };
  }

  return {
    poolSize: pool.length,
    cleanSize: clean.length,
    reliable: clean.length >= 120,
    globalMedian,
    ageMedian,
    groupFactor,
    predict(car) {
      const { base, km } = baseFor(car.ageMonthsNow);
      if (!base) return car.priceAmount;
      const f = groupFactor.get(groupKey(car)) || 1;
      const diff = ((car.mileageKm || 0) - km) / 10000;
      const kmAdj = Math.max(0.8, Math.min(1.2, 1 - KM_COEF * diff));
      return base * f * kmAdj;
    },
    medianByAge() {
      return [...ageMedian.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([ageBucket, med]) => ({ ageBucket, median: med, n: byAge.get(ageBucket)?.length || 0 }));
    }
  };
}

/**
 * @param {object} car       landed maliyetleri eklenmiş ilan
 * @param {object} market    buildMarket() çıktısı
 * @param {object} history   store'dan gelen araç geçmişi (opsiyonel)
 * @param {object} opts      { dealThreshold }
 */
export function scoreCar(car, market, history, { dealThreshold = 0.08 } = {}) {
  const predicted = market.predict(car) || car.priceAmount;
  const rawGap = predicted > 0 ? (predicted - car.priceAmount) / predicted : 0;

  if (isPerformance(car)) {
    return {
      predictedPrice: predicted,
      valueGap: 0,
      rawGap: 0,
      confidence: 0,
      priceDrop: 0,
      prevPrice: history?.prevPrice || null,
      score: 50,
      badges: [
        { key: 'perf', label: 'ℹ️ Performans modeli (emsal dışı)' },
        ...(history?.isNew ? [{ key: 'new', label: '🆕 Yeni ilan' }] : []),
        ...(car.eligible ? [] : [{ key: 'ineligible', label: '⛔ 5 yaş kuralına uymuyor' }])
      ]
    };
  }

  // Örneklem küçüldükçe farkı güvene göre küçült; uç sapmaları kırp.
  const conf = Math.max(0.35, Math.min(1, (market.cleanSize || 0) / 250));
  const gap = Math.max(-0.45, Math.min(0.45, rawGap)) * conf;

  const prevPrice = history?.prevPrice;
  const drop = prevPrice > 0 && car.priceAmount < prevPrice ? (prevPrice - car.priceAmount) / prevPrice : 0;

  const expectedKm = car.ageMonthsNow != null ? (car.ageMonthsNow / 12) * 10000 : null;
  const lowKm = expectedKm != null && car.mileageKm < expectedKm * 0.75;

  let score = 50 + 150 * Math.max(-0.3, Math.min(0.3, gap)) + 150 * Math.min(0.3, drop);
  if (lowKm) score += 5;
  if (car.ageRisk) score -= 4;
  if (!car.eligible) score -= 25;

  score = Math.max(0, Math.min(100, score));

  const badges = [];
  if (gap >= 0.15) badges.push({ key: 'hot', label: '🔥 Kaçmaz fırsat' });
  else if (gap >= dealThreshold) badges.push({ key: 'deal', label: '✅ İyi fırsat' });
  if (drop >= 0.01) badges.push({ key: 'drop', label: `📉 Fiyat düştü −%${(drop * 100).toFixed(1)}` });
  if (history?.isNew) badges.push({ key: 'new', label: '🆕 Yeni ilan' });
  if (car.ageRisk) badges.push({ key: 'age', label: '⚠️ 5 yaş sınırına yakın' });
  if (!car.eligible) badges.push({ key: 'ineligible', label: '⛔ 5 yaş kuralına uymuyor' });
  if (lowKm) badges.push({ key: 'lowkm', label: '🧭 Düşük km' });

  return {
    predictedPrice: predicted,
    valueGap: gap,
    rawGap,
    confidence: conf,
    priceDrop: drop,
    prevPrice: prevPrice || null,
    score: Math.round(score),
    badges
  };
}

export function summarize(cars) {
  const eligible = cars.filter((c) => c.eligible);
  const landed = eligible.map((c) => c.landed.totalGbp).sort((a, b) => a - b);
  const fobs = eligible.map((c) => c.landed.fobGbp).sort((a, b) => a - b);
  return {
    total: cars.length,
    eligible: eligible.length,
    medianLandedGbp: median(landed),
    minLandedGbp: landed[0] ?? null,
    maxLandedGbp: landed[landed.length - 1] ?? null,
    medianFobGbp: median(fobs),
    medianTaxRate: median(eligible.map((c) => c.landed.taxes.effectiveRate)),
    avgAgeYears: median(eligible.map((c) => c.landed.ageYearsAtArrival)),
    avgMileageKm: median(eligible.map((c) => c.mileageKm))
  };
}
