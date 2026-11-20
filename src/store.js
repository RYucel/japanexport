import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');

const EMPTY = { version: 1, cars: {}, scans: [] };

const stateFile = (key) => path.join(DATA_DIR, `state-${key}.json`);

export async function loadState(key = 'default') {
  try {
    const raw = JSON.parse(await readFile(stateFile(key), 'utf8'));
    return { ...EMPTY, ...raw, cars: raw.cars || {}, scans: raw.scans || [] };
  } catch {
    // Eski tek dosyalık state'ten (RAV4) geçiş
    if (key === 'rav4') {
      try {
        const legacy = JSON.parse(await readFile(path.join(DATA_DIR, 'state.json'), 'utf8'));
        return { ...EMPTY, ...legacy, cars: legacy.cars || {}, scans: legacy.scans || [] };
      } catch {
        /* yok */
      }
    }
    return structuredClone(EMPTY);
  }
}

export async function saveState(state, key = 'default') {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(stateFile(key), JSON.stringify(state), 'utf8');
}

export async function saveSnapshot(date, payload, key = 'default') {
  await mkdir(SNAP_DIR, { recursive: true });
  await writeFile(path.join(SNAP_DIR, `${date}-${key}.json`), JSON.stringify(payload), 'utf8');
}

export async function listSnapshots(key = 'default') {
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(SNAP_DIR);
    const suffix = `-${key}.json`;
    return files
      .filter((f) => f.endsWith(suffix))
      .map((f) => f.slice(0, -suffix.length))
      .sort();
  } catch {
    return [];
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Bugünkü taramayı geçmişle karşılaştırır ve state'i günceller.
 * @returns {{history: Record<string,{isNew:boolean,prevPrice:number|null,firstSeen:string}>, gone: Array}}
 */
export function applyScan(state, cars, date = today()) {
  const seen = new Set(cars.map((c) => c.stockId));
  const history = {};

  for (const car of cars) {
    const prev = state.cars[car.stockId];
    history[car.stockId] = {
      isNew: !prev,
      prevPrice: prev?.lastPrice ?? null,
      firstSeen: prev?.firstSeen ?? date
    };
    const prices = (prev?.prices || []).filter(([d]) => d !== date);
    prices.push([date, car.priceAmount]);
    state.cars[car.stockId] = {
      title: car.title,
      firstSeen: prev?.firstSeen ?? date,
      lastSeen: date,
      lastPrice: car.priceAmount,
      minPrice: Math.min(prev?.minPrice ?? Infinity, car.priceAmount),
      maxPrice: Math.max(prev?.maxPrice ?? 0, car.priceAmount),
      prices: prices.slice(-60)
    };
  }

  const gone = [];
  for (const [stockId, rec] of Object.entries(state.cars)) {
    if (seen.has(stockId)) continue;
    if (rec.lastSeen === date) continue;
    if (rec.lastSeen && daysBetween(rec.lastSeen, date) <= 14 && daysBetween(rec.lastSeen, date) > 0) {
      gone.push({ stockId, title: rec.title, lastSeen: rec.lastSeen, lastPrice: rec.lastPrice });
    }
  }

  for (const [stockId, rec] of Object.entries(state.cars)) {
    if (rec.lastSeen && daysBetween(rec.lastSeen, date) > 120) delete state.cars[stockId];
  }

  return { history, gone };
}

export function recordScan(state, summary, date = today()) {
  state.scans = (state.scans || []).filter((s) => s.date !== date);
  state.scans.push({ date, ...summary });
  state.scans = state.scans.slice(-180);
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
