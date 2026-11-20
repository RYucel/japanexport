import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MODELS_FILE = path.resolve('models.json');

let cache = null;

export async function loadModels() {
  if (!cache) {
    cache = JSON.parse(await readFile(MODELS_FILE, 'utf8'));
  }
  return cache;
}

export async function getModel(key) {
  const models = await loadModels();
  return models[key] || null;
}

export async function listModels() {
  const models = await loadModels();
  return Object.entries(models).map(([key, m]) => ({
    key,
    label: m.label,
    make: m.make,
    bodyLabel: m.bodyLabel,
    note: m.note || null
  }));
}

/** Model tanımını kaynak tarayıcılarının beklediği `search` nesnesine çevirir. */
export function searchFor(cfgSearch, key, model) {
  return {
    ...cfgSearch,
    label: model.label,
    makeId: model.sbtMakeId,
    makeName: model.make,
    model: model.sbtModel,
    modelName: model.gnModel,
    modelFilter: model.sbtModel,
    modelKey: key
  };
}
