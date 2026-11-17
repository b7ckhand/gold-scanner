'use strict';
const Engine = require('./engine.js');
const { esc } = require('./telegram.js');

const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = x => Math.round(x * 100) + '%';
const signed = x => (x >= 0 ? '+' : '') + x.toFixed(2);

function setupJson(s) {
  return {
    id: s.id, stratId: s.strat.id, strat: s.strat.name, kind: s.strat.kind, tf: s.tf, dir: s.dir,
    grade: s.g.grade, score: s.g.score, pWin: r3(s.g.pWin), be: r3(s.g.be), evR: r3(s.g.evR), rr: r2(s.rr),
    entry: r2(s.entry), sl: r2(s.sl), tp: r2(s.tp), atr: r2(s.atr), barT: s.barT, age: s.age,
    n: s.st.all.n, wr: r3(s.st.all.wr), lo: r3(s.st.all.lo), hi: r3(s.st.all.hi), exp: r3(s.st.all.exp), pf: r2(s.st.all.pf),
    isN: s.st.is.n, isExp: r3(s.st.is.exp), oosN: s.st.oos.n, oosExp: r3(s.st.oos.exp),
    mtf: r2(s.mtfAlign), adx: r2(s.adx), rsi: r2(s.rsi),
    parts: Object.fromEntries(Object.entries(s.g.parts).map(([k, v]) => [k, r2(v)])), notes: s.g.notes,
  };
}

/* Everything the Mini App shows. Derived results only: no candle history is published. */
function buildPublic(A, ctx) {
  const tfs = {};
  for (const id of Object.keys(A.tf)) {
    const T = A.tf[id], i = T.last, I = T.I;
    tfs[id] = { trend: r2(A.mtf[id]), rsi: r2(I.rsi[i]), adx: r2(I.adx[i]), atr: r2(I.atr[i]) };
  }
  const matrix = Object.values(A.matrix).map(c => ({
    tf: c.tf, strat: c.strat, grade: c.g.grade, score: c.g.score, n: c.st.all.n, wr: r3(c.st.all.wr), exp: r3(c.st.all.exp),
    oosN: c.st.oos.n, oosExp: r3(c.st.oos.exp), pWin: r3(c.g.pWin), sig: c.sig,
  }));
  let levels = [];
  const ref = A.tf.M15 || A.tf.H1;
  if (ref) levels = Engine.levels(ref.cs.slice(0, ref.last + 1), ref.I).map(l => ({ n: l.n, v: r2(l.v) }));
  const cnt = { A: 0, B: 0, C: 0, X: 0 }; A.setups.forEach(s => cnt[s.g.grade]++);
  return {
    updated: ctx.now, price: r2(ctx.price), marketOpen: ctx.marketOpen, sessions: Engine.sessionOf(ctx.now),
    event: ctx.event ? { title: ctx.event.title, t: ctx.event.t } : null, cost: ctx.cost,
    strategies: Engine.STRATS.map(s => ({ id: s.id, name: s.name, kind: s.kind, sl: s.sl, tp: s.tp })),
    tfLabels: Object.fromEntries(Engine.TFS.map(t => [t.id, t.label])),
    counts: cnt, setups: A.setups.map(setupJson), matrix, tfs, levels, note: ctx.note || '',
  };
}

function alertText(s, ctx) {
  const side = s.dir > 0 ? 'BUY' : 'SELL', lab = (Engine.TFS.find(t => t.id === s.tf) || {}).label || s.tf;
  const lines = [
    `<b>${esc(s.g.grade)} setup: XAUUSD ${side}</b>`,
    `${esc(s.strat.name)} on ${esc(lab)}`,
    '',
    `Entry ${money(s.entry)}`,
    `Stop ${money(s.sl)}`,
    `Target ${money(s.tp)}  (reward to risk ${s.rr.toFixed(1)})`,
    '',
    `Win probability ${pct(s.g.pWin)} against ${pct(s.g.be)} needed to break even`,
    `Expectancy ${signed(s.g.evR)}R per trade, score ${s.g.score} out of 100`,
    `History: ${s.st.all.n} trades, ${pct(s.st.all.wr)} won. Out of sample: ${s.st.oos.n} trades, ${signed(s.st.oos.exp)}R`,
  ];
  if (s.g.notes && s.g.notes.length) lines.push('', esc(s.g.notes[0]));
  if (ctx && ctx.event) lines.push('', `Event window: ${esc(ctx.event.title)}`);
  lines.push('', 'Backtested signal, not advice. Check spread and news before you trade.');
  return lines.join('\n');
}

module.exports = { buildPublic, alertText, setupJson };
