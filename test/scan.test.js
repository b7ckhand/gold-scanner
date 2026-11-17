'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { run, dueForRefresh } = require('../scan/run.js');
const { parseSeries, TdError } = require('../scan/td.js');
const { mergeCandles } = require('../scan/store.js');
const { world } = require('./mock.js');

const TUE = Date.UTC(2026, 10, 17, 10, 7) / 1000;         // Tuesday, market open
const SAT = Date.UTC(2026, 10, 21, 12, 0) / 1000;         // Saturday, market closed
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
const env = (extra = {}) => ({ TWELVEDATAKEY: 'k', TELEGRAMTOKEN: 't', TELEGRAMCHATID: '1', GITHUB_REPOSITORY: 'Alice/gold', ...extra });
const setup = (clock, opts = {}) => { const w = world({ endT: Math.floor((clock + 2 * 86400) / 300) * 300, startClock: clock, ...opts }); return { w, dir: tmp(), out: tmp(), cfg: tmp() }; };
const go = (S, now, e = env()) => { S.w.clock = now; S.w.td.length = 0; S.w.tg.length = 0; return run({ env: e, fetchImpl: S.w.fetch, now, dir: S.dir, outDir: S.out, configDir: S.cfg }); };
const latest = S => JSON.parse(fs.readFileSync(path.join(S.out, 'latest.json'), 'utf8'));

test('parseSeries reads Twelve Data JSON, sorts oldest first and rejects errors', () => {
  const c = parseSeries({ status: 'ok', values: [{ datetime: '2026-11-17 10:05:00', open: '2', high: '3', low: '1', close: '2.5' }, { datetime: '2026-11-17 10:00:00', open: '1', high: '2', low: '0.5', close: '2' }] });
  assert.equal(c.length, 2); assert.ok(c[0].t < c[1].t); assert.equal(c[0].t, Date.UTC(2026, 10, 17, 10, 0) / 1000);
  assert.equal(parseSeries({ status: 'ok', values: [{ datetime: '2026-11-17', open: '1', high: '1', low: '1', close: '1' }] })[0].t, Date.UTC(2026, 10, 17) / 1000);
  assert.throws(() => parseSeries({ status: 'error', code: 401, message: 'apikey is incorrect' }), e => e instanceof TdError && e.kind === 'auth');
  assert.throws(() => parseSeries({ status: 'error', code: 429, message: 'run out of credits' }), e => e.kind === 'rate');
});

test('mergeCandles lets the fresh forming candle replace the old one and trims to max', () => {
  const m = mergeCandles([{ t: 1, c: 1 }, { t: 2, c: 2 }, { t: 3, c: 3 }], [{ t: 3, c: 9 }, { t: 4, c: 4 }], 3);
  assert.deepEqual(m.map(b => b.t), [2, 3, 4]); assert.equal(m[1].c, 9);
});

test('dueForRefresh fires once per new candle, and only M5 when the market is closed', () => {
  const t0 = Date.UTC(2026, 10, 17, 10, 7) / 1000;
  assert.equal(dueForRefresh('H1', t0, t0 + 300, true), false);          // 10:12, same hour
  assert.equal(dueForRefresh('H1', t0, Date.UTC(2026, 10, 17, 11, 2) / 1000, true), true);
  assert.equal(dueForRefresh('M15', t0, t0 + 300, true), false);
  assert.equal(dueForRefresh('M15', t0, Date.UTC(2026, 10, 17, 10, 16) / 1000, true), true);
  assert.equal(dueForRefresh('H1', t0, t0 + 7200, false), false);
  assert.equal(dueForRefresh('M5', t0, t0 + 300, false), false);
  assert.equal(dueForRefresh('M5', t0, t0 + 900, false), true);
});

test('first run bootstraps all five timeframes, sets the menu button, welcomes once and announces nothing else', async () => {
  const S = setup(TUE); const r = await go(S, TUE);
  assert.equal(r.status, 'ok'); assert.equal(S.w.td.length, 5);
  assert.ok(S.w.td.every(q => q.tz === 'UTC' && q.order === 'ASC'));
  const methods = S.w.tg.map(c => c.method); assert.deepEqual(methods, ['setChatMenuButton', 'sendMessage']);
  assert.equal(S.w.tg[0].body.menu_button.web_app.url, 'https://alice.github.io/gold/');
  assert.match(S.w.tg[1].body.text, /Gold scanner connected/);
  assert.equal(S.w.tg[1].body.reply_markup.inline_keyboard[0][0].web_app.url, 'https://alice.github.io/gold/');
  const L = latest(S); assert.equal(L.marketOpen, true); assert.ok(Array.isArray(L.setups)); assert.equal(L.matrix.length, 27);
  assert.equal(JSON.stringify(L).includes('"candles"'), false);
});

test('second run five minutes later fetches only M5 and does not welcome again', async () => {
  const S = setup(TUE); await go(S, TUE); await go(S, TUE + 300);
  assert.deepEqual(S.w.td.map(q => q.interval), ['5min']); assert.deepEqual(S.w.tg.filter(c => c.method === 'sendMessage' && /connected/.test(c.body.text)), []);
});

test('a day of runs stays within the Twelve Data budget and alerts every A or B setup exactly once', async () => {
  const S = setup(TUE, { drift: 3 }); let credits = 0, quiet = 0; const first = new Set(), later = new Set(); let alerts = 0; const dayStart = TUE;
  for (let k = 0; k < 288; k++) {
    const now = TUE + k * 300; const r = await go(S, now); quiet += r.suppressed || 0; credits += S.w.td.length;
    alerts += S.w.tg.filter(c => c.method === 'sendMessage' && /setup:/.test(c.body.text)).length;
    for (const s of latest(S).setups) if (s.grade === 'A' || s.grade === 'B') (k === 0 ? first : later).add(s.id);
  }
  const fresh = [...later].filter(id => !first.has(id));
  assert.ok(credits <= 520, 'credits used ' + credits);
  assert.equal(alerts + quiet, fresh.length, `alerts ${alerts} + repeats ${quiet} vs distinct new A/B setups ${fresh.length}`);
  assert.ok(alerts > 0 && quiet >= 0);
  console.log(`# one day: ${credits} requests, ${alerts} alerts, ${quiet} repeat signals held back`);
});

test('weekend: no alerts, M5 only every 15 minutes, page flag says closed', async () => {
  const S = setup(SAT); await go(S, SAT); let reqs = 0;
  for (let k = 1; k <= 12; k++) { await go(S, SAT + k * 300, env({ ALERTGRADES: 'A,B,C,X' })); reqs += S.w.td.length; assert.equal(S.w.tg.filter(c => /setup:/.test(c.body.text || '')).length, 0); }
  assert.ok(reqs <= 4, 'requests ' + reqs); assert.equal(latest(S).marketOpen, false);
});

test('rate limit keeps stored candles and still publishes; a bad key is fatal', async () => {
  const S = setup(TUE); await go(S, TUE);
  S.w.tdFail = q => ({ http: 429, body: { status: 'error', code: 429, message: 'You have run out of API credits' } });
  const r = await go(S, TUE + 3600 + 300); assert.equal(r.status, 'ok'); assert.match(latest(S).note, /rate limit/);
  S.w.tdFail = q => ({ http: 401, body: { status: 'error', code: 401, message: '**apikey** parameter is incorrect' } });
  await assert.rejects(go(S, TUE + 7200), e => e.fatal === true);
  await assert.rejects(go(S, TUE + 7200, env({ TWELVEDATAKEY: '' })), e => e.fatal === true);
});

test('Telegram failure never stops the scan, and the setup is retried next run', async () => {
  const S = setup(TUE, { drift: 3 }); await go(S, TUE, env({ ALERTGRADES: 'A,B,C,X' }));
  S.w.failTg = true; let r, k = 1, saw = false;
  for (; k < 40 && !saw; k++) { r = await go(S, TUE + k * 300, env({ ALERTGRADES: 'A,B,C,X' })); saw = S.w.tg.some(c => c.method === 'sendMessage'); }
  assert.ok(saw, 'no alert attempt in 40 runs'); assert.equal(r.status, 'ok'); assert.ok(latest(S).updated);
  S.w.failTg = false; r = await go(S, TUE + k * 300, env({ ALERTGRADES: 'A,B,C,X' }));
  assert.ok(S.w.tg.some(c => c.method === 'sendMessage' && /setup:/.test(c.body.text)), 'alert not retried');
});

test('lost cache re-bootstraps with five requests; missing Telegram secrets still scan', async () => {
  const S = setup(TUE); await go(S, TUE); fs.rmSync(S.dir, { recursive: true }); await go(S, TUE + 300); assert.equal(S.w.td.length, 5);
  const r = await go(S, TUE + 600, env({ TELEGRAMTOKEN: '', TELEGRAMCHATID: '' })); assert.equal(r.status, 'ok'); assert.equal(S.w.tg.length, 0);
});

test('an event window caps every grade at B and is shown on the page', async () => {
  const S = setup(TUE, { drift: 3 });
  fs.writeFileSync(path.join(S.cfg, 'events.json'), JSON.stringify([{ title: 'US CPI', time: new Date((TUE + 600) * 1000).toISOString(), impact: 'high' }]));
  await go(S, TUE); const L = latest(S);
  assert.equal(L.event.title, 'US CPI'); assert.ok(L.setups.every(s => s.grade !== 'A'));
});
