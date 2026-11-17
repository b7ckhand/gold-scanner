'use strict';
/* ====================== GOLD ENGINE (pure, no DOM) ====================== */
const Engine = (() => {
  const TFS = [
    { id: 'M5', sec: 300, label: '5m', td: '5min' },
    { id: 'M15', sec: 900, label: '15m', td: '15min' },
    { id: 'H1', sec: 3600, label: '1H', td: '1h' },
    { id: 'H4', sec: 14400, label: '4H', td: '4h' },
    { id: 'D1', sec: 86400, label: '1D', td: '1day' },
  ];

  /* ---------- helpers ---------- */
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /* ---------- indicators ---------- */
  function ema(v, n) { const k = 2 / (n + 1), o = new Array(v.length); let p = v[0]; for (let i = 0; i < v.length; i++) { p = i === 0 ? v[0] : v[i] * k + p * (1 - k); o[i] = i < n - 1 ? NaN : p; } return o; }
  function sma(v, n) { const o = new Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
  function rsi(c, n = 14) {
    const o = new Array(c.length).fill(NaN); let ag = 0, al = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
      if (i <= n) { ag += g / n; al += l / n; if (i === n) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
      else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    } return o;
  }
  function trueRange(cs) { return cs.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - cs[i - 1].c), Math.abs(b.l - cs[i - 1].c))); }
  function rma(v, n) { const o = new Array(v.length).fill(NaN); let p = 0; for (let i = 0; i < v.length; i++) { if (i < n) { p += v[i] / n; if (i === n - 1) o[i] = p; } else { p = (p * (n - 1) + v[i]) / n; o[i] = p; } } return o; }
  function atr(cs, n = 14) { return rma(trueRange(cs), n); }
  function bb(c, n = 20, k = 2) {
    const m = sma(c, n), up = new Array(c.length).fill(NaN), lo = up.slice(), w = up.slice();
    for (let i = n - 1; i < c.length; i++) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - m[i]) ** 2; const sd = Math.sqrt(s / n); up[i] = m[i] + k * sd; lo[i] = m[i] - k * sd; w[i] = (up[i] - lo[i]) / m[i]; }
    return { mid: m, up, lo, w };
  }
  function adx(cs, n = 14) {
    const L = cs.length, pdm = [0], mdm = [0];
    for (let i = 1; i < L; i++) { const up = cs[i].h - cs[i - 1].h, dn = cs[i - 1].l - cs[i].l; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
    const tr = rma(trueRange(cs), n), sp = rma(pdm, n), sm = rma(mdm, n), dx = new Array(L).fill(NaN);
    for (let i = 0; i < L; i++) { if (tr[i] > 0) { const pdi = 100 * sp[i] / tr[i], mdi = 100 * sm[i] / tr[i]; dx[i] = pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi); } }
    const clean = dx.map(x => isNaN(x) ? 0 : x); const a = rma(clean, n);
    for (let i = 0; i < L; i++) if (isNaN(dx[i]) || i < 2 * n) a[i] = NaN; return a;
  }
  function macd(c) { const f = ema(c, 12), s = ema(c, 26), m = c.map((_, i) => f[i] - s[i]); const sig = ema(m.map(x => isNaN(x) ? 0 : x), 9); return { m, sig, h: m.map((x, i) => x - sig[i]) }; }
  function rollMax(v, n, off = 1) { const o = new Array(v.length).fill(NaN); for (let i = n + off - 1; i < v.length; i++) { let m = -Infinity; for (let j = i - n - off + 1; j <= i - off; j++) if (v[j] > m) m = v[j]; o[i] = m; } return o; }
  function rollMin(v, n, off = 1) { const o = new Array(v.length).fill(NaN); for (let i = n + off - 1; i < v.length; i++) { let m = Infinity; for (let j = i - n - off + 1; j <= i - off; j++) if (v[j] < m) m = v[j]; o[i] = m; } return o; }

  function indicators(cs) {
    const c = cs.map(b => b.c), h = cs.map(b => b.h), l = cs.map(b => b.l);
    const B = bb(c, 20, 2);
    const ind = { c, ema20: ema(c, 20), ema50: ema(c, 50), ema200: ema(c, 200), rsi: rsi(c, 14), atr: atr(cs, 14), bb: B, adx: adx(cs, 14), macd: macd(c), dh20: rollMax(h, 20), dl20: rollMin(l, 20), wmin: rollMin(B.w.map(x => isNaN(x) ? 9 : x), 60) };
    ind.atrAvg = sma(ind.atr.map(x => isNaN(x) ? 0 : x), 20);
    // day / session helpers
    const n = cs.length, dayKey = new Array(n), hr = new Array(n), pdh = new Array(n).fill(NaN), pdl = new Array(n).fill(NaN), ash = new Array(n).fill(NaN), asl = new Array(n).fill(NaN);
    let curDay = -1, dH = -Infinity, dL = Infinity, pH = NaN, pL = NaN, aH = NaN, aL = NaN;
    for (let i = 0; i < n; i++) {
      const t = cs[i].t, d = Math.floor(t / 86400), hh = (t % 86400) / 3600; dayKey[i] = d; hr[i] = hh;
      if (d !== curDay) { if (curDay !== -1) { pH = dH; pL = dL; } curDay = d; dH = -Infinity; dL = Infinity; aH = NaN; aL = NaN; }
      dH = Math.max(dH, cs[i].h); dL = Math.min(dL, cs[i].l);
      if (hh < 7) { aH = isNaN(aH) ? cs[i].h : Math.max(aH, cs[i].h); aL = isNaN(aL) ? cs[i].l : Math.min(aL, cs[i].l); }
      pdh[i] = pH; pdl[i] = pL; ash[i] = aH; asl[i] = aL;
    }
    Object.assign(ind, { dayKey, hr, pdh, pdl, ash, asl }); return ind;
  }

  /* ---------- strategies ---------- */
  const STRATS = [
    { id: 'pullback', name: 'Trend Pullback', kind: 'trend', sl: 1.5, tp: 3.0, max: 40,
      blurb: 'Buys dips and sells rallies inside a clear EMA 50/200 trend once price reclaims the 20 EMA.',
      signal(cs, I, i) {
        const c = I.c[i]; if (isNaN(I.ema200[i]) || isNaN(I.rsi[i])) return 0;
        const up = I.ema50[i] > I.ema200[i] && c > I.ema200[i], dn = I.ema50[i] < I.ema200[i] && c < I.ema200[i];
        const touchedUp = Math.min(cs[i].l, cs[i - 1].l, cs[i - 2].l) <= I.ema50[i] + 0.3 * I.atr[i];
        const touchedDn = Math.max(cs[i].h, cs[i - 1].h, cs[i - 2].h) >= I.ema50[i] - 0.3 * I.atr[i];
        if (up && touchedUp && c > I.ema20[i] && I.c[i - 1] <= I.ema20[i - 1] && I.rsi[i] > 45) return 1;
        if (dn && touchedDn && c < I.ema20[i] && I.c[i - 1] >= I.ema20[i - 1] && I.rsi[i] < 55) return -1; return 0;
      } },
    { id: 'breakout', name: 'Donchian Breakout', kind: 'trend', sl: 1.5, tp: 3.0, max: 30,
      blurb: 'Trades a close beyond the 20-bar range while volatility is expanding and price is on the right side of the 200 EMA.',
      signal(cs, I, i) {
        if (isNaN(I.dh20[i]) || isNaN(I.ema200[i])) return 0; const c = I.c[i], expand = I.atr[i] > I.atrAvg[i];
        if (c > I.dh20[i] && I.c[i - 1] <= I.dh20[i - 1] && expand && c > I.ema200[i]) return 1;
        if (c < I.dl20[i] && I.c[i - 1] >= I.dl20[i - 1] && expand && c < I.ema200[i]) return -1; return 0;
      } },
    { id: 'reversion', name: 'Band Reversion', kind: 'range', sl: 1.5, tp: 1.5, max: 20,
      blurb: 'Fades closes outside the 2σ Bollinger Band with RSI exhaustion, only when ADX says the market is ranging.',
      signal(cs, I, i) {
        if (isNaN(I.bb.up[i]) || isNaN(I.adx[i]) || isNaN(I.rsi[i])) return 0; const c = I.c[i];
        if (I.adx[i] < 22 && c < I.bb.lo[i] && I.rsi[i] < 30) return 1;
        if (I.adx[i] < 22 && c > I.bb.up[i] && I.rsi[i] > 70) return -1; return 0;
      } },
    { id: 'squeeze', name: 'Volatility Squeeze', kind: 'trend', sl: 1.5, tp: 3.0, max: 30,
      blurb: 'Waits for Bollinger width to compress to a 60-bar low, then trades the first decisive close outside the band.',
      signal(cs, I, i) {
        if (isNaN(I.wmin[i - 1]) || isNaN(I.bb.up[i])) return 0; const sq = I.bb.w[i - 1] <= I.wmin[i - 1] * 1.15, c = I.c[i];
        if (sq && c > I.bb.up[i] && c > cs[i].o) return 1; if (sq && c < I.bb.lo[i] && c < cs[i].o) return -1; return 0;
      } },
    { id: 'session', name: 'Asia Range Breakout', kind: 'trend', sl: 1.2, tp: 2.4, max: 30, maxTfSec: 3600,
      blurb: 'First close beyond the 00:00–07:00 UTC Asian range during the London window (07:00–13:00 UTC).',
      signal(cs, I, i) {
        const h = I.hr[i], a = I.ash[i], b = I.asl[i]; if (h < 7 || h >= 13 || isNaN(a)) return 0;
        for (let j = i - 1; j >= 0 && I.dayKey[j] === I.dayKey[i]; j--) { if (I.hr[j] >= 7 && (I.c[j] > a || I.c[j] < b)) return 0; }
        if (I.c[i] > a) return 1; if (I.c[i] < b) return -1; return 0;
      } },
    { id: 'sweep', name: 'Prior-Day Sweep', kind: 'range', sl: 1.2, tp: 2.4, max: 30, maxTfSec: 14400,
      blurb: 'Fades a wick through yesterday’s high or low that closes back inside, a classic liquidity grab.',
      signal(cs, I, i) {
        const H = I.pdh[i], L = I.pdl[i]; if (isNaN(H)) return 0; const b = cs[i];
        if (b.h > H && b.c < H && b.c < b.o) return -1; if (b.l < L && b.c > L && b.c > b.o) return 1; return 0;
      } },
  ];

  /* ---------- backtest ---------- */
  function backtest(cs, I, S, tfSec, opt = {}) {
    const cost = opt.cost ?? 0.35, n = cs.length, trades = [];
    if (S.maxTfSec && tfSec > S.maxTfSec) return trades;
    let i = Math.max(210, opt.from || 0);
    while (i < n - 2) {
      const sig = S.signal(cs, I, i); const a = I.atr[i];
      if (!sig || !(a > 0)) { i++; continue; }
      const eb = i + 1, entry = cs[eb].o, risk = S.sl * a, sl = entry - sig * risk, tp = entry + sig * S.tp * a;
      let R = null, reason = '', j = eb;
      for (; j < n && j <= eb + S.max; j++) {
        const b = cs[j], hSL = sig > 0 ? b.l <= sl : b.h >= sl, hTP = sig > 0 ? b.h >= tp : b.l <= tp;
        if (hSL) { R = -1; reason = 'SL'; break; } if (hTP) { R = S.tp / S.sl; reason = 'TP'; break; }
      }
      if (R === null) { if (j >= n) break; j = Math.min(j, n - 1); R = sig * (cs[j].c - entry) / risk; reason = 'TIME'; }
      R -= cost / risk;
      trades.push({ i: eb, j, dir: sig, entry, sl, tp, R, reason, t: cs[eb].t });
      i = j + 1;
    }
    return trades;
  }

  function wilson(w, n, z = 1.96) { if (!n) return [0, 0]; const p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
  function stats(trades, splitBar) {
    const f = a => { const n = a.length, w = a.filter(t => t.R > 0).length, sum = a.reduce((s, t) => s + t.R, 0), gw = a.filter(t => t.R > 0).reduce((s, t) => s + t.R, 0), gl = -a.filter(t => t.R <= 0).reduce((s, t) => s + t.R, 0);
      let eq = 0, pk = 0, dd = 0; const curve = [0]; for (const t of a) { eq += t.R; curve.push(eq); pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
      const [lo, hi] = wilson(w, n); return { n, wins: w, wr: n ? w / n : 0, lo, hi, exp: n ? sum / n : 0, sum, pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), dd, curve }; };
    const all = f(trades), is = f(trades.filter(t => t.i < splitBar)), oos = f(trades.filter(t => t.i >= splitBar));
    return { all, is, oos };
  }

  /* ---------- market context ---------- */
  function trendScore(I, i) { if (isNaN(I.ema200[i])) return 0; let s = 0; s += I.ema20[i] > I.ema50[i] ? 1 : -1; s += I.ema50[i] > I.ema200[i] ? 1 : -1; s += I.c[i] > I.ema20[i] ? 1 : -1; s += I.macd.h[i] > 0 ? 1 : -1; return s / 4; }

  /* ---------- grading ---------- */
  function grade(st, S, ctx) {
    const rr = S.tp / S.sl, be = 1 / (1 + rr), K = 20, a = st.all, o = st.oos, ins = st.is;
    const pWin = (a.wins + be * K) / (a.n + K);
    const evR = a.sum / (a.n + K);
    const parts = {
      edge: clamp(evR / 0.35, 0, 1) * 35,
      prob: clamp((pWin - be) / 0.15, 0, 1) * 20,
      sample: clamp(a.n / 60, 0, 1) * 15,
      oos: (o.n >= 8 ? clamp(o.exp / 0.25, 0, 1) * 7.5 : 0) + (ins.n >= 8 ? clamp(ins.exp / 0.25, 0, 1) * 7.5 : 0),
      mtf: clamp(ctx.mtf, 0, 1) * 10,
      regime: ctx.regime * 5,
    };
    let score = Object.values(parts).reduce((s, x) => s + x, 0);
    const notes = [];
    if (ctx.event) { score = Math.min(score, 54); notes.push('Inside an event window, so the grade is capped at B.'); }
    let g = score >= 72 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'X';
    if (g === 'A' && (a.n < 30 || o.exp <= 0 || o.n < 8)) { g = 'B'; notes.push('Held at B: needs 30+ trades and a positive out-of-sample result for an A.'); }
    if (a.n < 12 && g !== 'X') { g = 'C'; notes.push('Fewer than 12 historical trades, so the evidence is thin.'); }
    return { score: Math.round(score), grade: g, pWin, evR, be, rr, parts, notes };
  }

  /* ---------- full analysis of a dataset: { M5:[...], M15:[...], ... } ---------- */
  function analyse(data, opt = {}) {
    const out = { tf: {}, matrix: {}, setups: [], mtf: {} };
    for (const tf of TFS) {
      const cs = data[tf.id]; if (!cs || cs.length < 260) continue; const I = indicators(cs);
      const forming = !!opt.forming; const last = cs.length - 1 - (forming ? 1 : 0);
      out.tf[tf.id] = { cs, I, last }; out.mtf[tf.id] = trendScore(I, last);
    }
    const tfIds = TFS.map(t => t.id).filter(id => out.tf[id]);
    for (const tf of TFS) {
      const T = out.tf[tf.id]; if (!T) continue; const { cs, I } = T; const split = Math.floor(cs.length * 0.7);
      for (const S of STRATS) {
        if (S.maxTfSec && tf.sec > S.maxTfSec) continue;
        const trades = backtest(cs, I, S, tf.sec, { cost: opt.cost }); const st = stats(trades, split);
        const cell = { tf: tf.id, strat: S.id, trades, st, split };
        // active signal?
        const fresh = tf.sec <= 3600 ? 2 : 1; let sig = 0, sigAt = -1;
        for (let k = 0; k < fresh; k++) { const idx = T.last - k; if (idx < 210) break; const s = S.signal(cs, I, idx); if (s) { sig = s; sigAt = idx; break; } }
        const higher = tfIds.filter(id => TFS.find(t => t.id === id).sec > tf.sec); const pool = higher.length ? higher : [tf.id];
        const mtfAlign = sig ? pool.reduce((s, id) => s + sig * out.mtf[id], 0) / pool.length : 0;
        const adxv = I.adx[T.last]; const regime = S.kind === 'trend' ? (adxv > 20 ? 1 : 0.3) : (adxv < 22 ? 1 : 0.3);
        const ev = opt.eventBlock && sig ? true : false;
        const g = grade(st, S, { mtf: mtfAlign, regime: isNaN(adxv) ? 0.5 : regime, event: ev });
        cell.g = g; cell.sig = sig; cell.sigAt = sigAt; cell.mtfAlign = mtfAlign;
        out.matrix[tf.id + ':' + S.id] = cell;
        if (sig) {
          const px = opt.price || cs[T.last].c, a = I.atr[sigAt]; const risk = S.sl * a;
          out.setups.push({ id: `${S.id}-${tf.id}-${sig}-${cs[sigAt].t}`, tf: tf.id, tfSec: tf.sec, strat: S, dir: sig, entry: px, sl: px - sig * risk, tp: px + sig * S.tp * a, risk, atr: a, rr: S.tp / S.sl, g, st, mtfAlign, barT: cs[sigAt].t, age: T.last - sigAt, adx: adxv, rsi: I.rsi[T.last] });
        }
      }
    }
    const rank = { A: 3, B: 2, C: 1, X: 0 };
    out.setups.sort((x, y) => rank[y.g.grade] - rank[x.g.grade] || y.g.score - x.g.score);
    return out;
  }

  /* ---------- data utilities ---------- */
  function resample(cs, sec) {
    const out = []; let cur = null;
    for (const b of cs) { const k = Math.floor(b.t / sec) * sec; if (!cur || cur.t !== k) { cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }; out.push(cur); } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v || 0; } }
    return out;
  }
  function buildFromBase(base, baseSec) { const d = {}; for (const tf of TFS) { if (tf.sec < baseSec) continue; d[tf.id] = tf.sec === baseSec ? base.slice() : resample(base, tf.sec); } return d; }

  function genDemo(seed = 7, days = 300, start = 4100, endT = Math.floor(Date.now() / 300000) * 300, driftScale = 0.3) {
    const r = rng(seed), n = days * 288, out = []; let p = start, drift = 0, left = 0, t = endT - n * 300; const vm = h => 0.55 + 0.9 * Math.exp(-((h - 8.5) ** 2) / 8) + 1.3 * Math.exp(-((h - 14) ** 2) / 6);
    for (let i = 0; i < n; i++, t += 300) {
      const d = new Date(t * 1000), dow = d.getUTCDay(), hh = d.getUTCHours() + d.getUTCMinutes() / 60;
      if (dow === 6 || (dow === 5 && hh >= 22) || (dow === 0 && hh < 23)) continue;
      if (left-- <= 0) { drift = (r() - 0.5) * 0.000045 * driftScale * (r() < 0.45 ? 2.2 : 0.3); left = 200 + Math.floor(r() * 900); }
      const sd = 0.00058 * vm(hh), o = p; let h = o, l = o, c = o; const steps = 6;
      for (let k = 0; k < steps; k++) { c = c * (1 + drift + sd / Math.sqrt(steps) * gauss(r)); h = Math.max(h, c); l = Math.min(l, c); }
      p = c; out.push({ t, o, h: h * (1 + 0.00004 * r()), l: l * (1 - 0.00004 * r()), c, v: Math.round(200 + 800 * r() * vm(hh)) });
    }
    return out;
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(x => x.trim()); if (lines.length < 50) throw new Error('The file has too few rows. Export at least a few hundred candles.');
    const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    let head = lines[0].split(delim).map(s => s.replace(/[<>"]/g, '').trim().toLowerCase()), hasHead = isNaN(parseFloat(head[0]) ) && !/^\d{4}[.\-\/]\d{2}/.test(head[0]);
    const rows = lines.slice(hasHead ? 1 : 0).map(l => l.split(delim).map(s => s.replace(/"/g, '').trim()));
    let iD = 0, iT = -1, iO, iH, iL, iC, iV = -1;
    if (hasHead) {
      const ix = n => head.findIndex(h => h === n || h.startsWith(n));
      iD = Math.max(0, ix('date') >= 0 ? ix('date') : ix('time') >= 0 ? ix('time') : 0); iT = ix('time') > iD ? ix('time') : -1;
      iO = ix('open'); iH = ix('high'); iL = ix('low'); iC = ix('close'); iV = Math.max(ix('tick'), ix('vol'));
      if ([iO, iH, iL, iC].some(x => x < 0)) throw new Error('Could not find Open, High, Low and Close columns in the header.');
    } else { const second = rows[0][1] || ''; const two = /:/.test(second) && !/^\d+(\.\d+)?$/.test(second); iT = two ? 1 : -1; const b = two ? 2 : 1; iO = b; iH = b + 1; iL = b + 2; iC = b + 3; iV = b + 4; }
    const out = [];
    for (const r of rows) {
      let ds = r[iD] || ''; if (iT >= 0) ds += ' ' + (r[iT] || '00:00'); let t;
      if (/^\d{9,13}$/.test(ds)) { t = +ds; if (t > 1e12) t = Math.floor(t / 1000); }
      else { const m = ds.trim().match(/^(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/); if (!m) continue; t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000; }
      const o = parseFloat(r[iO]), h = parseFloat(r[iH]), l = parseFloat(r[iL]), c = parseFloat(r[iC]);
      if ([o, h, l, c].some(isNaN)) continue; out.push({ t, o, h, l, c, v: iV >= 0 ? parseFloat(r[iV]) || 0 : 0 });
    }
    out.sort((a, b) => a.t - b.t); const ded = out.filter((b, i) => i === 0 || b.t !== out[i - 1].t);
    if (ded.length < 300) throw new Error('Only ' + ded.length + ' valid candles were read. Check the column order and date format.');
    const diffs = []; for (let i = 1; i < Math.min(ded.length, 2000); i++) diffs.push(ded[i].t - ded[i - 1].t); diffs.sort((a, b) => a - b);
    const med = diffs[Math.floor(diffs.length / 2)]; const sec = [60, 300, 900, 3600, 14400, 86400].reduce((a, b) => Math.abs(b - med) < Math.abs(a - med) ? b : a);
    return { candles: ded, sec };
  }

  function sessionOf(t) { const h = new Date(t * 1000).getUTCHours() + new Date(t * 1000).getUTCMinutes() / 60; const s = []; if (h >= 0 && h < 9) s.push('Asia'); if (h >= 7 && h < 16) s.push('London'); if (h >= 12.5 && h < 21) s.push('New York'); return s; }

  function levels(cs, I) {
    const i = cs.length - 1, out = []; const H = I.pdh[i], L = I.pdl[i];
    // previous day close
    let pc = NaN; for (let j = i; j >= 0; j--) if (I.dayKey[j] !== I.dayKey[i]) { pc = cs[j].c; break; }
    if (!isNaN(H)) { out.push({ n: 'Prev-day high', v: H }); out.push({ n: 'Prev-day low', v: L }); const P = (H + L + pc) / 3; out.push({ n: 'Pivot', v: P }, { n: 'R1', v: 2 * P - L }, { n: 'S1', v: 2 * P - H }); }
    if (!isNaN(I.ash[i])) { out.push({ n: 'Asia high', v: I.ash[i] }, { n: 'Asia low', v: I.asl[i] }); }
    let o = null; for (let j = i; j >= 0 && I.dayKey[j] === I.dayKey[i]; j--) o = cs[j].o; if (o) out.push({ n: 'Day open', v: o });
    const px = cs[i].c; out.push({ n: 'Round 50', v: Math.round(px / 50) * 50 }, { n: 'Round 10', v: Math.round(px / 10) * 10 });
    return out.sort((a, b) => b.v - a.v);
  }
  function hourlyRange(cs) { const sum = new Array(24).fill(0), cnt = new Array(24).fill(0); for (const b of cs) { const h = new Date(b.t * 1000).getUTCHours(); sum[h] += b.h - b.l; cnt[h]++; } return sum.map((s, i) => cnt[i] ? s / cnt[i] : 0); }

  return { TFS, STRATS, indicators, backtest, stats, grade, analyse, resample, buildFromBase, genDemo, parseCSV, sessionOf, levels, hourlyRange, trendScore, wilson, ema, clamp };
})();
if (typeof module !== 'undefined') module.exports = Engine;
