import { computeCustoms } from './customs.js';

const CURRENCY_TO_TRY = {
  JPY: (fx) => fx.jpyTry,
  USD: (fx) => fx.usdTry,
  GBP: (fx) => fx.gbpTry,
  EUR: (fx) => fx.eurTry,
  TRY: () => 1
};

export function round(n, d = 0) {
  const p = 10 ** d;
  return Math.round((Number(n) || 0) * p) / p;
}

/** İki tarih arasındaki tam ay sayısı (gün bazlı, kaba ama yeterli). */
export function monthsBetween(from, to) {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
}

export function registrationDate(car) {
  if (!car.regYear) return null;
  return new Date(Date.UTC(car.regYear, (car.regMonth || 1) - 1, 1));
}

/**
 * Bir ilanın KKTC'ye gümrüklü (plakalı) toplam maliyetini hesaplar.
 *
 * @param {object} car  sbt.js çıktısı
 * @param {object} fx   fx.js çıktısı
 * @param {object} opts { port, method, freightUsd, commissionGbp, insuranceRate,
 *                        importer, arrivalDays, maxAgeMonths, origin, vehicleType, mode, registrationTry }
 */
/**
 * Araç başına navlun (USD).
 *  · method 'container': konteyner ücreti / konteynere sığan araç sayısı (paylaşımlı)
 *  · method 'roro': limana göre araç başı RORO ücreti
 *  · freightUsd verilmişse (kullanıcı elle girdiyse) o kullanılır.
 */
export function freightFor(opts = {}, vehicleType = 'suv') {
  if (opts.freightUsd != null && opts.freightUsd !== '') return Number(opts.freightUsd);

  if (opts.method === 'container') {
    const seats = Number(opts.carsPerContainer?.[vehicleType] || 4);
    return Number(opts.containerUsd ?? 11000) / seats;
  }
  return Number(opts.roroUsd?.[opts.port] ?? opts.freightUsdByPort?.[opts.port] ?? 1350);
}

export function computeLanded(car, fx, opts = {}) {
  const {
    port = 'FAMAGUSTA',
    method = 'container',
    commissionGbp = 2000,
    insuranceRate = 0.015,
    importer = 'sahis',
    arrivalDays = 90,
    maxAgeMonths = 60,
    origin = 'japonya',
    vehicleType = 'suv',
    mode = 'sea',
    registrationTry = 0
  } = opts;

  const currency = String(car.priceCurrency || 'JPY').toUpperCase();
  const toTry = CURRENCY_TO_TRY[currency] || CURRENCY_TO_TRY.JPY;
  const fobTry = (car.priceAmount || 0) * toTry(fx);
  const fobGbp = fobTry / fx.gbpTry;

  const freight = freightFor(opts, vehicleType);
  const freightTry = freight * fx.usdTry;

  const insuranceTry = fobTry * insuranceRate;
  const cifTry = fobTry + freightTry + insuranceTry;
  const cifGbp = cifTry / fx.gbpTry;

  const taxes = computeCustoms({
    cifTry,
    vehicleType,
    fuel: normalizeFuel(car.fuel),
    cc: car.engineCc || 2000,
    origin,
    ageIdx: 0,
    importer,
    mode
  });

  const commissionTry = commissionGbp * fx.gbpTry;
  const totalTry = cifTry + taxes.totalTaxTry + commissionTry + registrationTry;
  const totalGbp = totalTry / fx.gbpTry;

  const reg = registrationDate(car);
  const arrival = new Date(Date.now() + arrivalDays * 86400000);
  const ageMonthsAtArrival = reg ? monthsBetween(reg, arrival) : null;
  const ageMonthsNow = reg ? monthsBetween(reg, new Date()) : null;

  const eligible = ageMonthsAtArrival == null ? false : ageMonthsAtArrival < maxAgeMonths;
  const ageRisk = ageMonthsAtArrival != null && eligible && ageMonthsAtArrival >= maxAgeMonths - 3;

  return {
    fobTry,
    fobGbp,
    freightUsd: freight,
    freightTry,
    insuranceTry,
    cifTry,
    cifGbp,
    taxes,
    commissionTry,
    registrationTry,
    totalTry,
    totalGbp,
    totalUsd: totalTry / fx.usdTry,
    ageMonthsAtArrival,
    ageMonthsNow,
    ageYearsAtArrival: ageMonthsAtArrival != null ? ageMonthsAtArrival / 12 : null,
    eligible,
    ageRisk,
    taxShare: totalTry > 0 ? taxes.totalTaxTry / totalTry : 0
  };
}

export function normalizeFuel(fuel = '') {
  const f = String(fuel).toUpperCase();
  if (f.includes('DIESEL')) return 'dizel';
  if (f.includes('ELECTRIC')) return 'elektrik';
  return 'benzin';
}

/** Piyasa karşılaştırması için yaş (ay) bazlı gruplama anahtarı. */
export function ageBucket(ageMonths) {
  if (ageMonths == null) return 'unknown';
  return Math.floor(ageMonths / 6) * 6;
}
