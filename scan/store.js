'use strict';
/* Candle history and scanner state, persisted as small JSON files in the cache folder. */
const fs = require('fs'), path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

/* Merge fresh candles over old ones (fresh wins on equal t), keep the newest max. */
function mergeCandles(old, fresh, max) {
  const map = new Map();
  for (const b of old) map.set(b.t, b);
  for (const b of fresh) map.set(b.t, b);
  const all = [...map.values()].sort((a, b) => a.t - b.t);
  return all.length > max ? all.slice(all.length - max) : all;
}

function load(dir) {
  const raw = readJson(path.join(dir, 'candles.json'), {});
  const candles = {};
  for (const id of Object.keys(raw)) candles[id] = (raw[id] || []).map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 }));
  const state = readJson(path.join(dir, 'state.json'), {});
  state.fetched = state.fetched || {}; state.alerted = state.alerted || [];
  return { candles, state };
}

function save(dir, candles, state) {
  fs.mkdirSync(dir, { recursive: true });
  const raw = {};
  for (const id of Object.keys(candles)) raw[id] = candles[id].map(b => [b.t, b.o, b.h, b.l, b.c, b.v]);
  fs.writeFileSync(path.join(dir, 'candles.json'), JSON.stringify(raw));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
}

module.exports = { mergeCandles, load, save };
