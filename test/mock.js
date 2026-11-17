'use strict';
const Engine = require('../scan/engine.js');
const SEC = { '5min': 300, '15min': 900, '1h': 3600, '4h': 14400, '1day': 86400 };
const pad = n => String(n).padStart(2, '0');
function dt(t, daily) { const d = new Date(t * 1000); const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; return daily ? ymd : `${ymd} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`; }

/* A fake world: one long M5 series, served up to the mock clock, plus Telegram recording. */
function world({ seed = 11, drift = 2, endT, startClock }) {
  const base = Engine.genDemo(seed, 500, 4100, endT, drift);
  const w = { clock: startClock, td: [], tg: [], failTg: false, tdFail: null, base };
  w.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://api.twelvedata.com/')) {
      const q = new URL(url).searchParams; w.td.push({ interval: q.get('interval'), size: +q.get('outputsize'), tz: q.get('timezone'), order: q.get('order'), t: w.clock });
      const f = w.tdFail && w.tdFail(q); if (f) return { ok: f.http !== 429, status: f.http || 200, json: async () => f.body };
      const sec = SEC[q.get('interval')], bucket = Math.floor(w.clock / sec) * sec;
      const cs = Engine.resample(base.filter(b => b.t <= w.clock), sec).filter(b => b.t <= bucket);
      const take = cs.slice(-(+q.get('outputsize')));
      return { ok: true, status: 200, json: async () => ({ meta: { symbol: 'XAU/USD' }, status: 'ok', values: take.map(b => ({ datetime: dt(b.t, sec === 86400), open: String(b.o), high: String(b.h), low: String(b.l), close: String(b.c), volume: '0' })) }) };
    }
    if (url.startsWith('https://api.telegram.org/')) {
      const method = url.split('/').pop(), body = JSON.parse(init.body); w.tg.push({ method, body });
      if (w.failTg && method === 'sendMessage') return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    }
    throw new Error('unexpected url ' + url);
  };
  return w;
}
module.exports = { world };
