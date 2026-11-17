'use strict';
const fs = require('fs'), path = require('path');
const Engine = require('./engine.js');
const { fetchCandles, TdError } = require('./td.js');
const store = require('./store.js');
const tg = require('./telegram.js');
const { buildPublic, alertText } = require('./format.js');

/* boot: candles requested when history is missing. recent: candles requested on refresh. max: candles kept. */
const PLAN = {
  M5: { boot: 5000, recent: 300, max: 6000 },
  M15: { boot: 5000, recent: 300, max: 6000 },
  H1: { boot: 5000, recent: 300, max: 6000 },
  H4: { boot: 2500, recent: 200, max: 3000 },
  D1: { boot: 1500, recent: 100, max: 2000 },
};
const MIN_CANDLES = 260;
const CLOSED_AFTER = 5400;       // seconds without a new M5 candle before the market counts as closed
const CLOSED_M5_EVERY = 900;     // while closed, refresh M5 only this often to save requests

function loadEvents(configDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(configDir, 'events.json'), 'utf8'));
    return list.map(e => ({ title: String(e.title || 'Event'), t: Math.floor(Date.parse(e.time) / 1000), impact: e.impact || 'high' })).filter(e => isFinite(e.t));
  } catch (e) { return []; }
}
function eventHit(events, now) {
  return events.find(e => e.impact !== 'low' && now >= e.t - 1800 && now <= e.t + 3600) || null;
}

function dueForRefresh(tf, fetchedAt, now, marketOpen) {
  if (!fetchedAt) return true;
  if (tf === 'M5') return now - fetchedAt >= (marketOpen ? 240 : CLOSED_M5_EVERY);
  if (!marketOpen) return false;
  const sec = Engine.TFS.find(t => t.id === tf).sec;
  return Math.floor(now / sec) > Math.floor(fetchedAt / sec);   // a new candle has opened since the last fetch
}

async function run(o) {
  const env = o.env || {}, fetchImpl = o.fetchImpl, log = o.log || (() => { });
  const now = o.now || Math.floor(Date.now() / 1000);
  const dir = o.dir || 'cache', outDir = o.outDir || 'out', configDir = o.configDir || 'config';
  const key = env.TWELVEDATAKEY;
  if (!key) { const e = new Error('The secret TWELVEDATAKEY is not set.'); e.fatal = true; throw e; }
  const symbol = env.SYMBOL || 'XAU/USD', cost = parseFloat(env.COST) || 0.35;
  const alertGrades = (env.ALERTGRADES || 'A,B').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const token = env.TELEGRAMTOKEN, chatId = env.TELEGRAMCHATID, tgOn = !!(token && chatId);
  const repo = env.GITHUB_REPOSITORY || '';
  const miniUrl = env.MINIAPPURL || (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : '');

  const { candles, state } = store.load(dir);
  const first = !state.initialised;
  const notes = [];
  let requests = 0, rateLimited = false;

  /* ---- refresh candles, M5 first because it decides whether the market is open ---- */
  const lastM5 = () => (candles.M5 && candles.M5.length ? candles.M5[candles.M5.length - 1].t : 0);
  for (const tf of Engine.TFS.map(t => t.id)) {
    if (rateLimited) break;
    const have = (candles[tf] || []).length >= MIN_CANDLES;
    const marketOpen = lastM5() && now - lastM5() < CLOSED_AFTER;
    if (have && !dueForRefresh(tf, state.fetched[tf], now, marketOpen)) continue;
    const plan = PLAN[tf], interval = Engine.TFS.find(t => t.id === tf).td;
    try {
      requests++;
      const fresh = await fetchCandles({ symbol, interval, size: have ? plan.recent : plan.boot, key, fetchImpl });
      candles[tf] = store.mergeCandles(candles[tf] || [], fresh, plan.max);
      state.fetched[tf] = now;
    } catch (e) {
      if (e instanceof TdError && e.kind === 'auth') { e.fatal = true; throw e; }
      if (e instanceof TdError && e.kind === 'rate') { rateLimited = true; notes.push('Twelve Data rate limit reached, using stored candles.'); }
      else notes.push(`${tf} refresh failed: ${e.message}`);
      log(`warn: ${e.message}`);
    }
  }
  state.requestsToday = (state.day === new Date(now * 1000).toISOString().slice(0, 10) ? state.requestsToday || 0 : 0) + requests;
  state.day = new Date(now * 1000).toISOString().slice(0, 10);
  store.save(dir, candles, state);

  fs.mkdirSync(outDir, { recursive: true });
  const m5 = candles.M5 || [];
  if (m5.length < MIN_CANDLES) {
    fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify({ updated: now, status: 'warming', note: notes.join(' ') || 'Not enough candles yet.' }));
    return { status: 'warming', requests, notes };
  }

  /* ---- analyse ---- */
  const marketOpen = now - lastM5() < CLOSED_AFTER;
  const price = m5[m5.length - 1].c;
  const ev = eventHit(loadEvents(configDir), now);
  const data = {}; for (const id of Object.keys(PLAN)) if ((candles[id] || []).length >= MIN_CANDLES) data[id] = candles[id];
  const A = Engine.analyse(data, { forming: true, price, cost, eventBlock: !!ev });
  const pub = buildPublic(A, { now, price, marketOpen, event: ev, cost, note: notes.join(' ') });
  pub.requestsToday = state.requestsToday;
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(pub));

  /* ---- Telegram ---- */
  let sent = 0, suppressed = 0; state.lastAlert = state.lastAlert || {};
  const wanted = first ? [] : A.setups.filter(s => alertGrades.includes(s.g.grade) && !state.alerted.includes(s.id));
  if (tgOn) {
    try {
      if (miniUrl && state.menuUrl !== miniUrl) { await tg.setMenuButton({ token, url: miniUrl, fetchImpl }); state.menuUrl = miniUrl; }
      if (!state.welcomed) {
        await tg.sendMessage({ token, chatId, url: miniUrl, fetchImpl, text: `<b>Gold scanner connected</b>\nYou will get a message when a new ${tg.esc(alertGrades.join(' or '))} setup appears on XAUUSD. Setups already on the board right now are not announced.\n\nTap the button, or the menu button beside the message box, to open the desk.` });
        state.welcomed = true; sent++;
      }
      if (marketOpen) {
        for (const s of wanted) {
          const key = `${s.strat.id}-${s.tf}-${s.dir}`, last = state.lastAlert[key] || 0;
          if (now - last < Math.max(3 * s.tfSec, 900)) { state.alerted.push(s.id); suppressed++; continue; }   // same signal repeating on the next bars
          await tg.sendMessage({ token, chatId, text: alertText(s, { event: ev }), url: miniUrl, fetchImpl });
          state.alerted.push(s.id); state.lastAlert[key] = now; sent++;
        }
      }
    } catch (e) { notes.push(e.message); log('warn: ' + e.message); }
  } else wanted.forEach(s => state.alerted.push(s.id));
  if (first) A.setups.forEach(s => { if (!state.alerted.includes(s.id)) state.alerted.push(s.id); });
  state.alerted = state.alerted.slice(-300);
  state.initialised = true;
  store.save(dir, candles, state);

  return { status: 'ok', requests, sent, suppressed, setups: A.setups.length, marketOpen, notes };
}

module.exports = { run, PLAN, dueForRefresh, eventHit, MIN_CANDLES };
