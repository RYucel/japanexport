import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRawScan, computeView, commitScan } from './src/pipeline.js';
import { getFx } from './src/fx.js';
import { loadState, listSnapshots, today } from './src/store.js';
import { getModel, listModels, searchFor } from './src/models.js';
import { leanCars, buildMeta } from './src/view.js';
import { renderReportHtml } from './src/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4173);

const cfg = JSON.parse(await readFile(path.join(__dirname, 'config.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Model başına tek eşzamanlı tarama
const locks = new Map();
function once(key, fn) {
  if (!locks.has(key)) {
    locks.set(key, fn().finally(() => locks.delete(key)));
  }
  return locks.get(key);
}

async function resolveModel(key) {
  const modelKey = key || cfg.activeModel || 'rav4';
  const model = await getModel(modelKey);
  return model ? { key: modelKey, model } : null;
}

async function getData(searchParams) {
  const resolved = await resolveModel(searchParams.get('model'));
  if (!resolved) throw new Error('Bilinmeyen model');

  const { key: modelKey, model } = resolved;
  const refresh = searchParams.get('refresh') === '1';

  const search = searchFor(cfg.search, modelKey, model);
  const runCfg = { ...cfg, search, customs: { ...cfg.customs, vehicleType: model.vehicleType } };

  const fx = await getFx();
  const raw = await once(modelKey, () => getRawScan(runCfg, { refresh, cacheKey: modelKey }));

  const state = await loadState(modelKey);
  const view = await computeView({ cfg: runCfg, raw, fx, state, params: {} });

  if (refresh || !raw.cached) {
    try {
      await commitScan(raw, { ...view.summary, label: model.label }, view.cars, modelKey);
    } catch (err) {
      console.warn('state yazılamadı:', err.message);
    }
  }

  return {
    meta: buildMeta({ modelKey, model, raw, fx, opts: view.opts, cfg: runCfg, cached: raw.cached }),
    cars: leanCars(view.cars)
  };
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
  }
}

async function readReport(modelKey, dateParam) {
  const dates = await listSnapshots(modelKey);
  const date = dateParam || (dates.includes(today()) ? today() : dates.at(-1) || today());
  const md = await readFile(path.join(__dirname, 'data', 'reports', `${date}-${modelKey}.md`), 'utf8');
  return { date, md };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/cars') {
      const data = await getData(url.searchParams);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/models') {
      return json(res, 200, { defaultModel: cfg.activeModel, models: await listModels() });
    }

    if (url.pathname === '/api/status') {
      const resolved = await resolveModel(url.searchParams.get('model'));
      const snapshots = resolved ? await listSnapshots(resolved.key) : [];
      return json(res, 200, { ok: true, model: resolved?.key, snapshots: snapshots.slice(-10), today: today() });
    }

    if (url.pathname === '/api/report') {
      const resolved = await resolveModel(url.searchParams.get('model'));
      if (!resolved) return json(res, 404, { error: 'Bilinmeyen model' });
      try {
        const { date, md } = await readReport(resolved.key, url.searchParams.get('date'));
        return json(res, 200, { date, markdown: md });
      } catch {
        return json(res, 404, { error: 'Bu model/tarih için rapor yok. `npm run daily` çalıştırın.' });
      }
    }

    if (url.pathname === '/report') {
      const resolved = await resolveModel(url.searchParams.get('model'));
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<p>Bilinmeyen model.</p>');
      }
      try {
        const { date, md } = await readReport(resolved.key, url.searchParams.get('date'));
        const html = renderReportHtml(md, { title: `${resolved.model.label} · ${date}` });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<p>Rapor yok. Önce <code>npm run daily</code> çalıştırın.</p>');
      }
    }

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🚗  KKTC gümrüklü fiyat paneli`);
  console.log(`    http://localhost:${PORT}`);
  console.log(`    (Model başına ilk tarama 1–2 dakika sürer, sonrası önbellekten.)\n`);
});
