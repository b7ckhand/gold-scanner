'use strict';
/* Twelve Data REST client: time series only. */
const BASE = 'https://api.twelvedata.com/time_series';

class TdError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; this.fatal = kind === 'auth'; }
}

function parseDatetime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000;
}

/* Returns candles oldest first: [{t,o,h,l,c,v}] with t in UTC seconds. */
function parseSeries(body) {
  if (!body || typeof body !== 'object') throw new TdError('Unreadable Twelve Data response', 'other');
  if (body.status === 'error' || body.code >= 400) {
    const code = Number(body.code) || 0, msg = String(body.message || 'Twelve Data error');
    const kind = code === 401 || code === 403 || /api ?key/i.test(msg) ? 'auth' : code === 429 ? 'rate' : 'other';
    throw new TdError(`Twelve Data ${code}: ${msg}`, kind);
  }
  if (!Array.isArray(body.values)) throw new TdError('Twelve Data returned no values', 'other');
  const out = [];
  for (const v of body.values) {
    const t = parseDatetime(v.datetime), o = parseFloat(v.open), h = parseFloat(v.high), l = parseFloat(v.low), c = parseFloat(v.close);
    if (!isFinite(t) || [o, h, l, c].some(isNaN)) continue;
    out.push({ t, o, h, l, c, v: parseFloat(v.volume) || 0 });
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((b, i) => i === 0 || b.t !== out[i - 1].t);
}

async function fetchCandles({ symbol, interval, size, key, fetchImpl }) {
  const q = new URLSearchParams({ symbol, interval, outputsize: String(size), timezone: 'UTC', order: 'ASC', format: 'JSON', apikey: key });
  let res, body;
  try {
    res = await fetchImpl(`${BASE}?${q}`, { signal: AbortSignal.timeout(20000) });
    body = await res.json();
  } catch (e) { throw new TdError('Twelve Data request failed: ' + e.message, 'other'); }
  if (!res.ok && !(body && body.status === 'error')) throw new TdError('Twelve Data HTTP ' + res.status, res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : 'other');
  return parseSeries(body);
}

module.exports = { fetchCandles, parseSeries, parseDatetime, TdError };
