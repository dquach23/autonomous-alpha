/**
 * Halo - Local Quant Engine
 * Computes a deterministic factor snapshot for the whole universe from free
 * Yahoo Finance daily-close data (no API key, no AI tokens):
 *   - 1M / 3M / 6M total returns, absolute and relative to SPY
 *   - distance from 52-week high, position vs 50dma / 200dma
 *   - RSI(14), 20-day realized volatility (annualized)
 *   - cross-sectional momentum composite (0-100 percentile blend)
 *
 * The snapshot serves two purposes:
 *   1. Grounds the AI research phases in real numbers (injected into prompts),
 *      which improves pick quality AND cuts the web searches needed.
 *   2. Doubles as the quote source for the frontend (close / prevClose /
 *      weekAgoClose / 90d price series), replacing a second round of fetches.
 */

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_UA = "Mozilla/5.0 (compatible; HaloResearch/1.0)";
const BENCHMARK = "SPY";

function yahooSymbol(ticker) {
  // Yahoo uses "-" for class shares (BRK.B → BRK-B); universe uses "."
  return ticker.replace(/\./g, "-");
}

async function fetchDailyCloses(ticker, range = "1y") {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(yahooSymbol(ticker))}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("no result block");
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] == null) continue;
    series.push({ t: timestamps[i] * 1000, c: Number(closes[i].toFixed(4)) });
  }
  if (series.length < 30) throw new Error(`insufficient history (${series.length} closes)`);
  return series;
}

// ── Indicator math ────────────────────────────────────────────────────────────
function pctReturn(closes, lookback) {
  if (closes.length <= lookback) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - lookback];
  return ((now - then) / then) * 100;
}

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi14(closes, period = 14) {
  if (closes.length < period + 1) return null;
  // Wilder smoothing over the available window
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function realizedVol20(closes) {
  if (closes.length < 21) return null;
  const rets = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// ── Snapshot builder ─────────────────────────────────────────────────────────
async function fetchAllSeries(tickers, concurrency = 6) {
  const unique = [...new Set(tickers)];
  const out = {};
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(t => fetchDailyCloses(t)));
    batch.forEach((t, idx) => {
      const r = results[idx];
      if (r.status === "fulfilled") out[t] = r.value;
      else console.warn(`  ⚠️  Quant fetch failed for ${t}: ${r.reason?.message || r.reason}`);
    });
  }
  return out;
}

/**
 * Builds the full quant snapshot for a universe.
 * Returns { asOf, tickers: { [ticker]: metrics }, benchmark: metrics|null }.
 * Individual ticker failures are non-fatal (they simply drop out of the table).
 */
export async function buildQuantSnapshot(universeTickers) {
  const seriesMap = await fetchAllSeries([BENCHMARK, ...universeTickers]);
  const spy = seriesMap[BENCHMARK];
  const spyCloses = spy ? spy.map(p => p.c) : null;
  const spyRet = {
    m1: spyCloses ? pctReturn(spyCloses, 21)  : null,
    m3: spyCloses ? pctReturn(spyCloses, 63)  : null,
    m6: spyCloses ? pctReturn(spyCloses, 126) : null,
  };

  const tickers = {};
  for (const t of universeTickers) {
    const series = seriesMap[t];
    if (!series) continue;
    const closes = series.map(p => p.c);
    const close = closes[closes.length - 1];
    const hi52 = Math.max(...closes);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const ret = {
      m1: pctReturn(closes, 21),
      m3: pctReturn(closes, 63),
      m6: pctReturn(closes, 126),
    };
    tickers[t] = {
      close,
      prevClose: closes[closes.length - 2],
      weekAgoClose: closes[Math.max(0, closes.length - 6)],
      asOf: new Date(series[series.length - 1].t).toISOString().slice(0, 10),
      priceSeries: closes.slice(-63).map(c => Number(c.toFixed(2))),
      ret1M: ret.m1, ret3M: ret.m3, ret6M: ret.m6,
      rel1M: ret.m1 != null && spyRet.m1 != null ? ret.m1 - spyRet.m1 : null,
      rel3M: ret.m3 != null && spyRet.m3 != null ? ret.m3 - spyRet.m3 : null,
      rel6M: ret.m6 != null && spyRet.m6 != null ? ret.m6 - spyRet.m6 : null,
      pctFrom52wHigh: ((close - hi52) / hi52) * 100,
      pctVs50dma: sma50 ? ((close - sma50) / sma50) * 100 : null,
      pctVs200dma: sma200 ? ((close - sma200) / sma200) * 100 : null,
      rsi14: rsi14(closes),
      vol20: realizedVol20(closes),
    };
  }

  // Cross-sectional momentum composite: percentile-rank blend of relative
  // strength (1M 20%, 3M 40%, 6M 40%). Missing legs fall back to what exists.
  const entries = Object.entries(tickers);
  const rank = (key) => {
    const vals = entries.filter(([, m]) => m[key] != null).map(([t, m]) => [t, m[key]]);
    vals.sort((a, b) => a[1] - b[1]);
    const pct = {};
    vals.forEach(([t], i) => { pct[t] = vals.length > 1 ? (i / (vals.length - 1)) * 100 : 50; });
    return pct;
  };
  const r1 = rank("rel1M"), r3 = rank("rel3M"), r6 = rank("rel6M");
  for (const [t, m] of entries) {
    const parts = [];
    if (r1[t] != null) parts.push([r1[t], 0.2]);
    if (r3[t] != null) parts.push([r3[t], 0.4]);
    if (r6[t] != null) parts.push([r6[t], 0.4]);
    const wSum = parts.reduce((a, [, w]) => a + w, 0);
    m.momentumScore = wSum > 0
      ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / wSum)
      : null;
  }

  return {
    asOf: new Date().toISOString().slice(0, 10),
    benchmark: spyCloses ? { ret1M: spyRet.m1, ret3M: spyRet.m3, ret6M: spyRet.m6 } : null,
    tickers,
  };
}

// ── Prompt table rendering ───────────────────────────────────────────────────
const fmt = (v, digits = 1) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`);

function tickerLine(t, m) {
  const rsi = m.rsi14 != null ? Math.round(m.rsi14) : "n/a";
  const vol = m.vol20 != null ? Math.round(m.vol20) : "n/a";
  return `${t}: mom ${m.momentumScore ?? "n/a"}/100 | rel-SPY 1M ${fmt(m.rel1M)} 3M ${fmt(m.rel3M)} 6M ${fmt(m.rel6M)} | 52wHi ${fmt(m.pctFrom52wHigh)} | 50d ${fmt(m.pctVs50dma)} 200d ${fmt(m.pctVs200dma)} | RSI ${rsi} | vol ${vol}%`;
}

function sortedByMomentum(snapshot) {
  return Object.entries(snapshot.tickers)
    .filter(([, m]) => m.momentumScore != null)
    .sort((a, b) => b[1].momentumScore - a[1].momentumScore);
}

/**
 * Momentum-phase table: the top N names by composite momentum, plus the
 * benchmark line. This is the pre-screen — the AI ranks WITHIN these
 * candidates instead of searching prices for the whole universe.
 */
export function renderMomentumTable(snapshot, topN = 45) {
  const rows = sortedByMomentum(snapshot).slice(0, topN);
  const bench = snapshot.benchmark
    ? `SPY benchmark: 1M ${fmt(snapshot.benchmark.ret1M)} 3M ${fmt(snapshot.benchmark.ret3M)} 6M ${fmt(snapshot.benchmark.ret6M)}\n`
    : "";
  return bench + rows.map(([t, m]) => tickerLine(t, m)).join("\n");
}

/**
 * Risk-phase table: momentum laggards (potential falling knives / breakdowns)
 * and the most extended names (RSI-hot and far above trend — late-stage risk).
 */
export function renderRiskTable(snapshot, n = 15) {
  const sorted = sortedByMomentum(snapshot);
  const laggards = sorted.slice(-n);
  const extended = [...sorted]
    .filter(([, m]) => m.rsi14 != null && m.pctVs200dma != null)
    .sort((a, b) => (b[1].rsi14 + b[1].pctVs200dma) - (a[1].rsi14 + a[1].pctVs200dma))
    .slice(0, n);
  let out = "MOMENTUM LAGGARDS (weakest relative strength — falling-knife screen):\n";
  out += laggards.map(([t, m]) => tickerLine(t, m)).join("\n");
  out += "\n\nMOST EXTENDED (hot RSI + far above 200dma — blow-off / mean-reversion risk):\n";
  out += extended.map(([t, m]) => tickerLine(t, m)).join("\n");
  return out;
}

/**
 * Synthesis table: top candidates plus a set of always-included tickers
 * (defensive sleeve names) so the portfolio construction sees real data for
 * everything it is allowed to pick.
 */
export function renderSynthesisTable(snapshot, alwaysInclude = [], topN = 45) {
  const top = sortedByMomentum(snapshot).slice(0, topN);
  const seen = new Set(top.map(([t]) => t));
  const extra = alwaysInclude
    .filter(t => !seen.has(t) && snapshot.tickers[t])
    .map(t => [t, snapshot.tickers[t]]);
  const bench = snapshot.benchmark
    ? `SPY benchmark: 1M ${fmt(snapshot.benchmark.ret1M)} 3M ${fmt(snapshot.benchmark.ret3M)} 6M ${fmt(snapshot.benchmark.ret6M)}\n`
    : "";
  return bench
    + top.map(([t, m]) => tickerLine(t, m)).join("\n")
    + (extra.length ? "\n--- defensive / income candidates ---\n" + extra.map(([t, m]) => tickerLine(t, m)).join("\n") : "");
}

/**
 * Quote lookup shim — same shape the old per-pick Yahoo fetcher produced, so
 * enrichment code keeps working but no second network round-trip is needed.
 */
export function quoteFromSnapshot(snapshot, ticker) {
  const m = snapshot?.tickers?.[ticker];
  if (!m) return null;
  return {
    close: m.close,
    prevClose: m.prevClose,
    weekAgoClose: m.weekAgoClose,
    asOf: m.asOf,
    series: m.priceSeries,
  };
}
