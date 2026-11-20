/**
 * İstemciye gönderilecek sade araç şekli ve meta bilgisi.
 * Ağırlığı azaltmak için hesaplanmış maliyetler gönderilmez; tarayıcı
 * public/lib/*.js ile aynı formülleri kullanarak kendisi hesaplar.
 */

const CAR_FIELDS = [
  'stockId', 'title', 'grade', 'regYear', 'regMonth', 'manufactureYear',
  'priceAmount', 'priceCurrency', 'priceUsd', 'mileageKm', 'modelCode',
  'transmission', 'fuel', 'drive', 'steering', 'engineCc', 'engineCode',
  'doors', 'seating', 'bodyType', 'bodyColor', 'location', 'image', 'url',
  'isSold', 'source', 'prevPrice', 'isNew'
];

export function leanCar(car) {
  const out = {};
  for (const key of CAR_FIELDS) {
    if (car[key] !== undefined) out[key] = car[key];
  }
  return out;
}

export function leanCars(cars) {
  return cars.map(leanCar);
}

export function buildMeta({ modelKey, model, raw, fx, opts, cfg, cached }) {
  const bySource = {};
  for (const car of raw.cars) bySource[car.source] = (bySource[car.source] || 0) + 1;

  return {
    modelKey,
    label: model.label,
    note: model.note || null,
    bodyLabel: model.bodyLabel,
    vehicleType: model.vehicleType,
    scannedAt: raw.scannedAt,
    date: raw.date,
    cached: !!cached,
    counts: {
      total: raw.cars.length,
      totalCount: raw.totalCount,
      pages: raw.pagesFetched,
      bySource,
      perSource: raw.perSource || []
    },
    fx: {
      gbpTry: fx.gbpTry,
      usdTry: fx.usdTry,
      eurTry: fx.eurTry,
      jpyTry: fx.jpyTry,
      source: fx.source,
      stale: !!fx.stale
    },
    opts,
    defaults: {
      shipping: cfg.shipping,
      fees: cfg.fees,
      customs: cfg.customs,
      ui: cfg.ui
    }
  };
}
