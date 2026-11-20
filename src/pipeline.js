import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { scan as sbtScan } from './sbt.js';
import { scan as goonetScan } from './goonet.js';
import { getFx } from './fx.js';
import { computeLanded, freightFor } from '../public/lib/landed.js';
import { buildMarket, scoreCar, summarize } from '../public/lib/score.js';
import { loadState, saveState, saveSnapshot, applyScan, recordScan, today } from './store.js';

const CACHE_DIR = path.resolve('data', 'cache');

const SOURCE_LABELS = { sbt: 'SBT Japan', goonet: 'Goo-net Exchange' };

/** Ham ilanları günlük olarak önbellekten veya kaynak sitelerden alır. */
export async function getRawScan(cfg, { refresh = false, onProgress, cacheKey = 'default' } = {}) {
  const date = today();
  const file = path.join(CACHE_DIR, `scan-${date}-${cacheKey}.json`);

  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      if (cached?.cars?.length) return { ...cached, cached: true };
    } catch {
      /* önbellek yok */
    }
  }

  const sources = cfg.sources || { sbt: { enabled: true } };
  const perSource = [];
  const cars = [];
  const seen = new Set();
  const startedAt = new Date().toISOString();

  if (sources.sbt?.enabled !== false) {
    try {
      const r = await sbtScan(cfg.search, {
        maxPages: cfg.search.maxPages ?? 30,
        includeSold: cfg.search.includeSold ?? false,
        onProgress: (p) => onProgress?.({ ...p, source: 'sbt', label: SOURCE_LABELS.sbt })
      });
      for (const car of r.cars) {
        if (seen.has(car.stockId)) continue;
        seen.add(car.stockId);
        cars.push(car);
      }
      perSource.push({ id: 'sbt', label: SOURCE_LABELS.sbt, count: r.cars.length, totalCount: r.totalCount, pages: r.pagesFetched });
    } catch (err) {
      console.warn('SBT taraması başarısız:', err.message);
      perSource.push({ id: 'sbt', label: SOURCE_LABELS.sbt, count: 0, error: err.message });
    }
  }

  if (sources.goonet?.enabled) {
    try {
      const r = await goonetScan(cfg.search, {
        maxPages: sources.goonet.maxPages ?? 35,
        onProgress: (p) => onProgress?.({ ...p, label: SOURCE_LABELS.goonet })
      });
      for (const car of r.cars) {
        if (seen.has(car.stockId)) continue;
        seen.add(car.stockId);
        cars.push(car);
      }
      perSource.push({ id: 'goonet', label: SOURCE_LABELS.goonet, count: r.cars.length, totalCount: r.totalCount, pages: r.pagesFetched });
    } catch (err) {
      console.warn('Goo-net taraması başarısız:', err.message);
      perSource.push({ id: 'goonet', label: SOURCE_LABELS.goonet, count: 0, error: err.message });
    }
  }

  const payload = {
    date,
    cars,
    perSource,
    totalCount: perSource.reduce((a, s) => a + (s.totalCount || 0), 0),
    pagesFetched: perSource.reduce((a, s) => a + (s.pages || 0), 0),
    scannedAt: startedAt
  };

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(payload), 'utf8');
  return { ...payload, cached: false };
}

export function resolveOptions(cfg, params = {}) {
  const port = params.port || cfg.shipping.port;
  const method = params.method || cfg.shipping.method || 'container';
  const vehicleType = cfg.customs.vehicleType;
  const commissionGbp = params.commission != null ? Number(params.commission) : cfg.fees.commissionGbp;

  const roroUsd = cfg.shipping.roroUsd || cfg.shipping.freightUsd || {};
  const containerUsd = cfg.shipping.containerUsd ?? 11000;
  const carsPerContainer = cfg.shipping.carsPerContainer || { suv: 4, otomobil: 5, ticari: 3 };

  const freightUsd =
    params.freight != null && params.freight !== ''
      ? Number(params.freight)
      : freightFor({ method, port, roroUsd, containerUsd, carsPerContainer }, vehicleType);

  return {
    port,
    method,
    commissionGbp,
    freightUsd,
    roroUsd,
    containerUsd,
    carsPerContainer,
    insuranceRate: cfg.shipping.insuranceRate,
    importer: params.importer || cfg.customs.importerType,
    arrivalDays: params.arrivalDays != null ? Number(params.arrivalDays) : cfg.customs.arrivalDays,
    maxAgeMonths: params.maxAgeMonths != null ? Number(params.maxAgeMonths) : cfg.customs.maxAgeMonths,
    origin: cfg.customs.origin,
    vehicleType,
    mode: cfg.customs.mode,
    registrationTry: cfg.fees.kktcRegistrationTry
  };
}

/**
 * Ham ilanları maliyet + piyasa + skor ile zenginleştirir.
 */
export async function computeView({ cfg, raw, fx, params = {}, state = null }) {
  const opts = resolveOptions(cfg, params);
  const todayStr = today();

  const cars = raw.cars
    .filter((c) => c.priceAmount > 0 && c.regYear)
    .map((car) => {
      const landed = computeLanded(car, fx, opts);
      return {
        ...car,
        ageMonthsNow: landed.ageMonthsNow,
        eligible: landed.eligible,
        ageRisk: landed.ageRisk,
        landed
      };
    });

  const market = buildMarket(cars);

  for (const car of cars) {
    const rec = state?.cars?.[car.stockId];
    const history =
      rec && rec.lastSeen !== todayStr
        ? { prevPrice: rec.lastPrice, isNew: false }
        : rec
          ? { prevPrice: null, isNew: false }
          : { prevPrice: null, isNew: true };
    car.prevPrice = history.prevPrice ?? null;
    car.isNew = history.isNew;
    car.analysis = scoreCar(car, market, history, {
      dealThreshold: params.dealThreshold != null ? Number(params.dealThreshold) : cfg.ui.dealThreshold
    });
  }

  cars.sort((a, b) => b.analysis.score - a.analysis.score);

  const bySource = {};
  for (const car of cars) bySource[car.source] = (bySource[car.source] || 0) + 1;

  const summary = {
    ...summarize(cars),
    scannedAt: raw.scannedAt,
    totalCount: raw.totalCount,
    pagesFetched: raw.pagesFetched,
    cached: !!raw.cached,
    bySource,
    perSource: raw.perSource || [],
    marketPool: market.poolSize,
    marketReliable: market.reliable
  };

  return { cars, market, summary, opts };
}

/** Günlük taramayı state'e işler, snapshot yazar. */
export async function commitScan(raw, summary, cars, key = 'default') {
  const state = await loadState(key);
  const date = today();
  const { history, gone } = applyScan(state, raw.cars, date);
  recordScan(state, {
    total: summary.total,
    eligible: summary.eligible,
    medianLandedGbp: summary.medianLandedGbp,
    minLandedGbp: summary.minLandedGbp
  }, date);
  await saveState(state, key);
  await saveSnapshot(date, {
    date,
    summary,
    cars: cars.map((c) => ({
      stockId: c.stockId,
      title: c.title,
      priceAmount: c.priceAmount,
      mileageKm: c.mileageKm,
      regYear: c.regYear,
      regMonth: c.regMonth,
      landedGbp: Math.round(c.landed.totalGbp),
      eligible: c.eligible,
      score: c.analysis.score
    }))
  });
  return { state, history, gone };
}

export { getFx };
