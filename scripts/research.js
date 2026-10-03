/**
 * Halo - Daily Research Engine (1x/day at market close)
 * Runs research phases using Claude + web search, grounded in a locally
 * computed factor screen (2y of real prices for the full universe:
 * volatility-adjusted 12-1M / 6-1M momentum, 52w-high proximity, trend and
 * risk flags). Each run also scores the book it previously published against
 * SPY and feeds that track record into the synthesis, so the engine learns
 * from realized results instead of only its own narrative.
 * Stable phases (macro, sectors, smart money, risk) are cached for 28h and
 * refreshed Tue–Thu by ONE combined delta call (1 search). Research runs on
 * Sonnet 5.5; the final portfolio synthesis runs on Opus 5.5 with
 * schema-constrained JSON output, then is validated and repaired in code.
 * Saves results to ../public/picks.json for the frontend to consume
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR    = path.join(__dirname, "../public");
const OUTPUT_PATH   = path.join(PUBLIC_DIR, "picks.json");
const UNIVERSE_PATH = path.join(PUBLIC_DIR, "universe.json");
const REPORTS_DIR   = path.join(__dirname, "../reports");

const CYCLE_INFO = { number: 1, label: "After-Market", timeET: "5:00 PM ET" };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Models ────────────────────────────────────────────────────────────────────
// Research phases are retrieval + summarization over web search: Sonnet 5.5 is
// both cheaper ($2/$10 per MTok) and stronger than the Sonnet 4.6 it replaces.
// The final portfolio synthesis is the one call where reasoning quality moves
// the picks, so it runs on Opus 5.5 with no web search attached. Both are
// overridable from the workflow env without a code change.
const RESEARCH_MODEL  = process.env.HALO_RESEARCH_MODEL  || "claude-sonnet-5-5";
const SYNTHESIS_MODEL = process.env.HALO_SYNTHESIS_MODEL || "claude-opus-5-5";
const WEB_SEARCH_TOOL = "web_search_20260209"; // dynamic filtering trims result tokens
// Server-side refusal fallback: a policy decline is re-run on a fallback model
// inside the same call instead of failing the phase.
const FALLBACK_BETA   = "server-side-fallback-2026-07-01";

// ── Phase caching ─────────────────────────────────────────────────────────────
// Stable phases (macro climate, sector rotation, smart money) change slowly —
// reuse yesterday's output and do a quick delta search instead of full research.
// Volatile phases (momentum, risk) always run fresh since they track daily prices.
// Full refresh every Friday (weekly report — end of trading week) and Monday (weekend gap).
const CACHE_TTL_MS  = 28 * 60 * 60 * 1000; // 28 hours
// Risk is cached too: single-name price risk is now covered daily by the
// locally computed screen (trend, volatility, drawdown), so the narrative risk
// phase only needs a full rewrite on refresh days.
const STABLE_PHASES = new Set(["macro", "sectors", "smart", "risk"]);
const UPDATE_MARKER = "\n\n--- TODAY'S UPDATE ---\n";

function isCacheValid(existingData) {
  if (!existingData?.generatedAt) return false;
  const ageMs = Date.now() - new Date(existingData.generatedAt).getTime();
  return ageMs < CACHE_TTL_MS;
}

function needsFullRefresh() {
  const day = new Date().getUTCDay();
  return day === 1 || day === 5; // Monday (weekend gap) or Friday (weekly report)
}

// Strip any prior day's appended update so cached phase text doesn't grow
// unboundedly across Tue–Thu (each day re-bases on the last full refresh).
function baseText(text = "") {
  const i = text.indexOf(UPDATE_MARKER);
  return i >= 0 ? text.slice(0, i) : text;
}

// One combined delta call replaces four separate ones on cache days: a single
// web search covering macro, sectors, smart money and cross-asset risk, with
// the answer split back into per-phase updates by section header.
const DELTA_SECTIONS = [
  { id: "macro",   label: "MACRO",       focus: "new Fed signals, a surprise inflation/jobs/GDP print, or a major market-moving event" },
  { id: "sectors", label: "SECTORS",     focus: "notable sector leadership shifts or flows" },
  { id: "smart",   label: "SMART MONEY", focus: "new 13F/13D disclosures, block trades, or public statements by major funds" },
  { id: "risk",    label: "RISK",        focus: "changes in VIX term structure, HY spreads, USD, breadth, or a new tail risk" },
];

function getCombinedDeltaPrompt(cached, today) {
  const blocks = DELTA_SECTIONS.map(s =>
    `### ${s.label} (prior analysis, excerpt)\n${baseText(cached[s.id]).slice(0, 1500)}`).join("\n\n");
  return `You are the overnight desk analyst for a long-only portfolio manager. Today is ${today}.

Below are excerpts of the most recent full research on four stable topics. Use at most 1 web search to check what changed since then. Only report genuinely new, material information; if nothing material changed for a topic, say "No material change." for it.

${blocks}

Respond with exactly these four headers, each followed by 2–4 concise sentences:
## MACRO
## SECTORS
## SMART MONEY
## RISK`;
}

function splitCombinedDelta(text) {
  const out = {};
  DELTA_SECTIONS.forEach((s, i) => {
    const start = text.indexOf(`## ${s.label}`);
    if (start < 0) return;
    const next = DELTA_SECTIONS.slice(i + 1)
      .map(n => text.indexOf(`## ${n.label}`, start + 1))
      .filter(x => x > start);
    const end = next.length ? Math.min(...next) : text.length;
    out[s.id] = text.slice(start + s.label.length + 3, end).trim();
  });
  return out;
}

function isFriday() {
  return new Date().getUTCDay() === 5;
}

function getWeekLabel() {
  const d = new Date();
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return `Week of ${start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

function getTodayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// ── Stock Universe ────────────────────────────────────────────────────────────
// Loaded from public/universe.json so the frontend and research script share
// a single source of truth.
function loadUniverseData() {
  const raw = fs.readFileSync(UNIVERSE_PATH, "utf8");
  return JSON.parse(raw);
}

function loadUniverse() {
  return loadUniverseData().groups.flatMap(g => g.tickers);
}

// Rotating spotlight: one non-defensive universe group per day gets explicit
// scrutiny in the momentum phase, so the whole universe gets fresh eyes over
// a ~2-week cycle instead of the same mega-caps being re-examined forever.
function pickSpotlightGroup(groups) {
  const eligible = groups.filter(g => g.key !== "defensive");
  if (eligible.length === 0) return null;
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return eligible[dayIndex % eligible.length];
}

// ─── Phase Definitions ────────────────────────────────────────────────────────
// Each phase is written from the perspective of a specialist who an expert
// portfolio manager would consult before making allocation decisions. Prompts
// are deliberately demanding — concrete numbers, specific levels, named
// catalysts — because vague output corrupts the synthesis.
function getPhases(collected, today, universe, historyDigest = "", extras = {}) {
  const {
    quantTable = "",       // full computed factor screen (momentum phase)
    quantCompact = "",     // leaders + laggards digest (picks synthesis)
    stalenessText = "",    // holding streaks + never-picked names
    challengers = [],      // top quant names not currently held
    spotlight = null,      // today's rotating universe group
    trackRecordText = "",  // realized performance of the published book vs SPY
    defensiveScreen = "",  // defensive candidates ranked on vol/drawdown/trend
  } = extras;
  // Cap each research input so a verbose phase can't balloon synthesis cost.
  const clip = (t, n = 4000) => !t ? "" : t.length > n ? t.slice(0, n) + "…" : t;
  return [
    {
      id: "macro",
      label: "Macro Climate",
      prompt: `You are a senior macro strategist briefing a long-only portfolio manager. Today is ${today}.

Cover the CURRENT regime for US equities with specific numbers:
- Fed policy: current funds rate, latest dot plot, market-implied path (Fed funds futures), real policy rate vs neutral
- Yield curve: 2y, 10y, 30y levels and the 2s10s / 3m10y spreads, term premium direction
- Inflation: latest CPI / Core CPI / PCE / supercore prints and the trajectory (decelerating / sticky / re-accelerating)
- Growth: latest GDPNow / Atlanta Fed nowcast, payrolls run-rate, ISM Manufacturing / Services
- Credit & liquidity: HY OAS spread level + direction, IG OAS, financial conditions index (Goldman / Chicago Fed), USD index (DXY)
- Earnings backdrop: forward S&P 500 EPS, current trailing P/E and forward P/E vs 10y average
- Geopolitical / event tape: only items that materially move risk assets in the next 1–6 months

Output 3 short paragraphs:
1. **Regime call** (one sentence: late-cycle / mid-cycle / early-cycle / contraction) and why
2. **What's working / what's breaking** — specific factors and sectors the regime favors
3. **What to watch** — the 2–3 highest-impact upcoming data points / events`,
    },
    {
      id: "sectors",
      label: "Sector Rotation",
      prompt: `You are a sector rotation strategist for a multi-billion-dollar long-only fund. Today is ${today}.

For each major sector, weigh:
- Relative strength vs SPY over 1M / 3M / 6M
- Earnings revision breadth (analysts revising estimates up vs down)
- Forward P/E vs sector's own 10-year median (cheap / fair / rich)
- Capital flows (sector ETF inflows / outflows over recent weeks)
- Where in the business cycle this sector typically leads

Sectors to rank:
- Technology / AI Infrastructure / Semis
- Communication Services
- Healthcare (split: biotech / pharma / devices / managed care)
- Financials (banks / capital markets / insurance / fintech)
- Energy (upstream / midstream / clean)
- Industrials (defense / electrification / machinery / aerospace)
- Consumer Discretionary vs Consumer Staples
- Utilities
- Materials
- REITs
- Defensive proxies: long Treasuries (TLT/IEF), gold (GLD), dividend ETFs (SCHD/VYM)

Rank top→bottom for a 1–5 year long-only investor. For each, give: relative strength tier (leader / coiling / lagging / breaking down), one valuation/flow data point, and a one-sentence "why now" or "why not".`,
    },
    {
      id: "momentum",
      label: "Price & Earnings Momentum",
      prompt: `You are a quantitative analyst running a multi-factor momentum + quality screen. Today is ${today}.

${quantTable
  ? `TODAY'S COMPUTED FACTOR SCREEN for the full universe — real price data (volatility-adjusted 12-1M / 6-1M momentum, relative strength vs SPY, volatility, drawdown, trend, risk flags). Treat these numbers as ground truth for price momentum; do NOT re-derive returns from memory:

${quantTable}`
  : `Universe: ${universe.join(", ")}\n(Computed price screen unavailable today — use web search to establish 3M/6M relative strength vs SPY.)`}

Your job — combine the price screen above with FUNDAMENTAL momentum you verify via web search (max 2 searches):
- **Earnings revisions**: analyst FY estimate revision direction last 4–13 weeks (up = good)
- **Earnings surprise rate**: % beat on last 4 quarters of EPS
- **Quality overlay**: gross margin trend, FCF yield, ROIC trajectory (penalize stocks with deteriorating fundamentals even if price is mooning)

Prioritize your searches on names the screen ranks highly that are NOT already obvious consensus picks — that is where verification adds the most value. A high price score with falling estimates is a trap; a mid score with sharply rising estimates is an opportunity.
${spotlight ? `
TODAY'S SPOTLIGHT GROUP: **${spotlight.label}** (${spotlight.tickers.join(", ")}). Give each spotlight name one line of assessment even if it doesn't make your top list — this group rotates daily so the entire universe gets a fresh look over time.
` : ""}
Output:
1. The TOP 10 names with the strongest combined price + fundamental momentum. For each: ticker, a 1-sentence rationale citing screen numbers plus fundamental data, and say whether fundamentals confirm the price trend. Treat EXTENDED-flagged names as "wait for a pullback" unless estimates are rising faster than price.
${challengers.length > 0 ? `2. CHALLENGER ASSESSMENT: for each of these high-momentum names that are NOT in the current book — ${challengers.join(", ")} — one sentence on whether today's data supports inclusion. Be honest: if one deserves a slot over an incumbent, say so plainly.` : ""}`,
    },
    {
      id: "smart",
      label: "Smart Money Tracking",
      prompt: `You are an expert tracking institutional positioning. Today is ${today}.

Cover RECENT moves (last 1–3 months) from:
- Warren Buffett / Berkshire Hathaway (latest 13F deltas + cash position)
- Stanley Druckenmiller / Duquesne
- Bill Ackman / Pershing Square
- David Tepper / Appaloosa
- Michael Burry / Scion
- Cathie Wood / ARK (especially when contrarian to the others)
- Tiger Global / Coatue / Viking Global / Lone Pine / Citadel (if disclosed)
- Notable activist 13D filings (Elliott, Trian, Starboard) on names in your universe

For each meaningful move, give: investor, name, direction (added / new position / trimmed / exited), approximate size or % of portfolio, and the most plausible thesis. Then synthesize:
- Which 2–3 themes are most concentrated across smart money right now
- What are they collectively SELLING or hedging — that's often the more important signal
- Are any moving to defensive (TLT, GLD, cash, staples)?

Focus on positions relevant for 1+ year holding periods. Ignore short-term trading flows.`,
    },
    {
      id: "risk",
      label: "Risk Assessment",
      prompt: `You are a risk officer reviewing the book before a portfolio manager rebalances. Today is ${today}.
From this universe: ${universe.join(", ")}

Cover:
1. **Single-stock blow-up risk** — 5 names in this universe with the highest probability of -25%+ drawdown over the next 6–12 months. Be specific: which ones are priced for perfection on stretched multiples? Which have deteriorating gross margins, customer concentration, regulatory overhang, or pending legal/antitrust action?

2. **Defensive opportunities** — 5 names that combine durable moat + reasonable valuation + low-correlation behavior in risk-off tape. Can include bonds (TLT, IEF), gold (GLD), dividend ETFs (SCHD, VYM), utilities, staples, and high-quality compounders trading at reasonable multiples.

3. **Macro tail risks (12 months)** — the 3 highest-impact regime-breaking risks. For each: probability tier (low / medium / elevated), what would trigger it, and which factors / sectors get hurt most.

4. **Cross-asset risk signals** — VIX term structure (contango / backwardation), HY credit spread direction, USD trajectory, breadth (% of S&P above 200dma). Flag any divergences between equity strength and credit / breadth.

Be specific. Name real risks, not generic warnings.`,
    },
    {
      id: "picks",
      label: "Daily Top 10 Picks + 5 Defensive",
      prompt: `You are an elite long-only portfolio manager running a concentrated, diversified book for a 1–5 year horizon. Your job is to beat SPY on a risk-adjusted basis — not to be busy, and not to be loyal to yesterday's list. Today is ${today}.

═══ TODAY'S RESEARCH ═══
MACRO CONTEXT:
${clip(collected.macro) || "(unavailable)"}

SECTOR ROTATION:
${clip(collected.sectors) || "(unavailable)"}

MOMENTUM & FUNDAMENTALS:
${clip(collected.momentum, 5000) || "(unavailable)"}

SMART MONEY:
${clip(collected.smart) || "(unavailable)"}

RISK ASSESSMENT:
${clip(collected.risk) || "(unavailable)"}
${quantCompact ? `\n═══ QUANT FACTOR SCREEN (computed from real prices — ground truth for any price/trend claim) ═══\n${quantCompact}\n` : ""}${defensiveScreen ? `\n${defensiveScreen}\n` : ""}${trackRecordText ? `\n═══ YOUR TRACK RECORD (realized, vs SPY) ═══\n${trackRecordText}\nLearn from this. If the book has lagged SPY, today's picks must change something that explains the lag (e.g. stop buying EXTENDED names, cut names in DOWNTREND, rely more on the factor screen) — say what in the summary.\n` : ""}${historyDigest ? `\n═══ RECENT POSITIONING (last 7 cycles) ═══\n${historyDigest}\n${stalenessText ? `\nHOLDING STALENESS:\n${stalenessText}\n` : ""}` : ""}
═══ HOW TO DECIDE ═══
1. Start from evidence, not from yesterday's list. A holding stays only if it would be bought fresh today. "It was in the book" is never a reason; any name held 15+ days needs fresh evidence cited in its rationale.
2. The factor screen surfaces candidates; fundamentals decide. The best longs sit at an intersection: strong factor score AND rising estimates/quality AND a dated catalyst. A name with a weak score needs a specific contrarian catalyst — being early without a catalyst is the same as being wrong.
3. Respect the flags. Do not initiate a position in a name flagged EXTENDED (short-term reversal risk — wait for a pullback; holding an existing position is fine). Names flagged DOWNTREND or BROKEN need an explicit catalyst-backed reason to be held or bought.
4. Sell discipline: any holding marked ⚠REVIEW is exited unless today's research gives a new, specific reason the thesis is intact.
5. Avoid crowded consensus trades where everyone already owns it and expectations are priced in; prefer under-appreciated second-order beneficiaries of a theme.
${challengers.length > 0 ? `6. Challengers (top-ranked factor names not currently held): ${challengers.join(", ")}. Evaluate each; if you keep an incumbent over a challenger, the summary must say why on today's numbers.\n` : ""}
═══ PORTFOLIO CONSTRUCTION (hard rules) ═══
- Exactly 15 picks: 10 growth-book picks (category growth/value/income), ranked 1–10, then 5 defensive picks (category defensive), ranked 1–5. Growth book first in the array.
- Growth book: max 3 per GICS sector, at least 5 sectors, no three names that are one factor bet (e.g. NVDA+AVGO+AMD).
- Defensive sleeve: re-derive daily from the current regime and the defensive ranking above. Span at least 3 of: long-duration Treasuries, gold, dividend/quality equity ETFs, utilities, staples. No doubling one exposure (TLT and IEF). Do not hold a defensive name in a DOWNTREND just because it is "defensive".
- Conviction must discriminate: at most 3 "high" in the growth book and 2 in the defensive sleeve; the rest "medium" or "speculative".
- suggestedWeight: integers 3–15 summing to ~100 across all 15. Size by conviction and inversely to volatility (high-vol names smaller). Total defensive weight should track defensiveScore (shield 3 → ~15–20%, shield 7 → ~40–50%).
- Asymmetry: upside should plausibly be ≥2x the downside over the horizon.

═══ FIELDS ═══
score 0–100 (your overall conviction score) · horizon e.g. "1-3 years" · rationale 2–3 sentences citing at least one screen number AND one fundamental/catalyst datapoint from the research · catalyst = the single most important dated upcoming event · catalystWindow · entryNote = valuation vs history and technical position (use screen numbers) · exitTrigger = the specific observable that would make you sell · keyRisk · smartMoneyBacking.
summary: 3–4 sentences — regime call; how the two sleeves express it; what changed vs yesterday and why (carry-overs vs. adds/drops, with data); the dominant risk.
diversificationNote: 1–2 sentences naming growth-book sectors, defensive exposures, and any factor concentration accepted.
macroOutlook: one of Bullish / Cautiously Bullish / Neutral / Cautious / Bearish. defensiveScore: 1 (full risk-on) – 10 (full defensive).

Universe: ${universe.join(", ")}`,
    },
  ];
}

// ─── Quote fetching (Yahoo Finance, no API key) ──────────────────────────────
// Pulls ~3 months of daily closes per ticker and derives close, prior-day
// close, and week-ago close. Failures are non-fatal — a missing ticker just
// goes out without price fields and the UI handles it.
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_UA = "Mozilla/5.0 (compatible; HaloResearch/1.0)";

function yahooSymbol(ticker) {
  // Yahoo uses "-" for class shares (BRK.B → BRK-B); universe uses "."
  return ticker.replace(/\./g, "-");
}

async function fetchTickerQuote(ticker) {
  // 2y of history: 12-1 momentum and the 200dma need >252 sessions, and the
  // extra year backs the track-record scorecard.
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(yahooSymbol(ticker))}?range=2y&interval=1d`;
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
  if (series.length < 2) throw new Error("insufficient close history");
  const c = series.map(p => p.c);
  return {
    ...computeQuoteMetrics(c),
    asOf: new Date(series[series.length - 1].t).toISOString().slice(0, 10),
    // Dated closes back the track-record scorecard (not written to picks.json).
    dates: series.map(p => new Date(p.t).toISOString().slice(0, 10)),
    closes: c,
  };
}

// Pure function of a close series so it can be unit-tested without network.
// Momentum uses the academic "12-1" / "6-1" construction (skip the most recent
// month): 1-month returns mean-revert, so chasing them buys tops — which is
// exactly what the old 1M-weighted composite did.
function computeQuoteMetrics(c) {
  const n = c.length;
  const close = c[n - 1];
  const at = (daysAgo) => (n - 1 - daysAgo >= 0 ? c[n - 1 - daysAgo] : null);
  const ret = (from, to = close) => (from && to ? Number(((to / from - 1) * 100).toFixed(1)) : null);
  const sma = (k) => (n >= k ? c.slice(-k).reduce((a, b) => a + b, 0) / k : null);
  const sma50 = sma(50), sma200 = sma(200);
  // Annualized volatility of daily returns over the last ~3 months.
  const win = c.slice(-64);
  const rets = [];
  for (let i = 1; i < win.length; i++) rets.push(Math.log(win[i] / win[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const vol = rets.length > 10 ? Number((Math.sqrt(variance * 252) * 100).toFixed(1)) : null;
  // Max drawdown over the last 6 months.
  let peak = -Infinity, mdd = 0;
  for (const x of c.slice(-126)) { peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1); }
  const high52 = Math.max(...c.slice(-252));
  return {
    close,
    prevClose: c[n - 2],
    weekAgoClose: c[Math.max(0, n - 1 - 5)],
    series: c.slice(-63), // UI sparkline stays ~3 months
    metrics: {
      r1w:  ret(at(5)),
      r1m:  ret(at(21)),
      r3m:  ret(at(63)),
      r6m:  ret(at(126)),
      r12m: ret(at(251)),
      mom12_1: ret(at(251), at(21)),
      mom6_1:  ret(at(126), at(21)),
      vol,
      maxDD6m: Number((mdd * 100).toFixed(1)),
      pctFrom52wHigh: Number(((close / high52 - 1) * 100).toFixed(1)),
      pctVs50dma:  sma50  ? Number(((close / sma50  - 1) * 100).toFixed(1)) : null,
      pctVs200dma: sma200 ? Number(((close / sma200 - 1) * 100).toFixed(1)) : null,
      above50dma:  sma50  ? close > sma50  : null,
      above200dma: sma200 ? close > sma200 : null,
    },
  };
}

async function fetchQuotes(tickers) {
  const unique = [...new Set(tickers)];
  const out = {};
  const concurrency = 5;
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(t => fetchTickerQuote(t)));
    batch.forEach((t, idx) => {
      const r = results[idx];
      if (r.status === "fulfilled") {
        out[t] = r.value;
      } else {
        console.warn(`  ⚠️  Quote fetch failed for ${t}: ${r.reason?.message || r.reason}`);
      }
    });
  }
  return out;
}

function enrichWithQuotes(picksArray, quotes) {
  if (!Array.isArray(picksArray)) return picksArray;
  return picksArray.map(p => {
    const q = quotes[p.ticker];
    if (!q) return p;
    return {
      ...p,
      close: q.close,
      prevClose: q.prevClose,
      weekAgoClose: q.weekAgoClose,
      priceAsOf: q.asOf,
      priceSeries: q.series,
    };
  });
}

// ─── Quantitative factor screen (computed locally from real price data) ──────
// Replaces the model's from-memory guesses about price momentum with ground
// truth: trailing returns, relative strength vs SPY, distance from 52w high,
// and trend. This is what changes day-to-day, so it's what drives pick churn
// when the tape actually shifts — and pick stability when it doesn't.
function fmtSigned(v) {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

function zScores(values) {
  const xs = values.filter(v => v != null && Number.isFinite(v));
  if (xs.length < 3) return values.map(() => 0);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  // Winsorize at ±3 so one parabolic name can't dominate the ranking.
  return values.map(v => (v == null || !Number.isFinite(v)) ? 0 : Math.max(-3, Math.min(3, (v - mean) / sd)));
}

// Cross-sectional, risk-adjusted factor score. Momentum is measured 12-1 and
// 6-1 (skipping the reversal-prone last month), scaled by volatility so a
// steady compounder outranks a lottery ticket with the same return, plus a
// 52-week-high proximity term (names near highs with low vol tend to persist).
// Flags mark the setups that burned the old book: buying extended spikes,
// holding names in downtrends.
function buildQuantScreen(quotes, universe) {
  const spy = quotes["SPY"]?.metrics ?? null;
  const base = [];
  for (const ticker of universe) {
    const m = quotes[ticker]?.metrics;
    if (!m) continue;
    const rel = (r, s) => (r != null && s != null) ? Number((r - s).toFixed(1)) : r;
    const volAdj = (r) => (r != null && m.vol) ? r / m.vol : null;
    base.push({
      ticker, m,
      rel3m:  rel(m.r3m, spy?.r3m),
      rel6m:  rel(m.r6m, spy?.r6m),
      rel12_1: rel(m.mom12_1, spy?.mom12_1),
      ra12: volAdj(m.mom12_1 ?? m.r6m),
      ra6:  volAdj(m.mom6_1 ?? m.r3m),
      prox: m.pctFrom52wHigh,
    });
  }
  const z12 = zScores(base.map(r => r.ra12));
  const z6  = zScores(base.map(r => r.ra6));
  const zH  = zScores(base.map(r => r.prox));
  const rows = base.map((r, i) => {
    const flags = [];
    if (r.m.above200dma === false) flags.push("DOWNTREND");
    if ((r.m.pctVs50dma ?? 0) > 15 || (r.m.r1m ?? 0) > 20) flags.push("EXTENDED");
    if ((r.m.pctFrom52wHigh ?? 0) < -25) flags.push("BROKEN");
    const score = 0.45 * z12[i] + 0.35 * z6[i] + 0.20 * zH[i];
    return { ...r, score: Number(score.toFixed(2)), flags };
  });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const line = (r) =>
    `${String(r.rank).padStart(3)}. ${r.ticker.padEnd(6)} score ${fmtSigned(r.score)}  ` +
    `12-1M ${fmtSigned(r.m.mom12_1)}%  6-1M ${fmtSigned(r.m.mom6_1)}%  1M ${fmtSigned(r.m.r1m)}%  ` +
    `vsSPY(6M) ${fmtSigned(r.rel6m)}  vol ${r.m.vol ?? "—"}%  maxDD6m ${fmtSigned(r.m.maxDD6m)}%  ` +
    `off52wHi ${fmtSigned(r.m.pctFrom52wHigh)}%  vs200dma ${fmtSigned(r.m.pctVs200dma)}%` +
    (r.flags.length ? `  [${r.flags.join(",")}]` : "");
  const header = spy
    ? `Benchmark SPY: 1M ${fmtSigned(spy.r1m)}%  3M ${fmtSigned(spy.r3m)}%  6M ${fmtSigned(spy.r6m)}%  12-1M ${fmtSigned(spy.mom12_1)}%  vol ${spy.vol ?? "—"}%\n` +
      `Score = z-scored, volatility-adjusted 12-1M and 6-1M momentum + 52w-high proximity (higher is better). ` +
      `Flags: DOWNTREND = below 200dma; EXTENDED = >15% above 50dma or +20% in 1M (short-term reversal risk); BROKEN = >25% off 52w high.\n`
    : "";
  const table = rows.length ? header + "Ranked best → worst:\n" + rows.map(line).join("\n") : "";
  const compact = rows.length
    ? header +
      "Factor leaders (top 25):\n" + rows.slice(0, 25).map(line).join("\n") +
      (rows.length > 35
        ? "\nFactor laggards (bottom 10 — avoid without a strong, catalyst-backed contrarian thesis):\n" +
          rows.slice(-10).map(line).join("\n")
        : "")
    : "";
  return { rows, table, compact };
}

// Defensive sleeve gets its own ranking: what matters there is low volatility,
// shallow drawdowns and an intact trend — not raw momentum.
function buildDefensiveScreen(quotes, defensiveTickers) {
  const rows = defensiveTickers
    .map(t => ({ ticker: t, m: quotes[t]?.metrics }))
    .filter(r => r.m);
  if (rows.length === 0) return "";
  const zMom = zScores(rows.map(r => r.m.mom6_1 ?? r.m.r6m));
  const zVol = zScores(rows.map(r => -(r.m.vol ?? 0)));
  const zDD  = zScores(rows.map(r => r.m.maxDD6m));
  rows.forEach((r, i) => { r.score = Number((0.4 * zMom[i] + 0.3 * zVol[i] + 0.3 * zDD[i]).toFixed(2)); });
  rows.sort((a, b) => b.score - a.score);
  return "Defensive candidates ranked by 6-1M momentum + low vol + shallow drawdown:\n" + rows.map(r =>
    `${r.ticker.padEnd(5)} score ${fmtSigned(r.score)}  6-1M ${fmtSigned(r.m.mom6_1)}%  3M ${fmtSigned(r.m.r3m)}%  ` +
    `vol ${r.m.vol ?? "—"}%  maxDD6m ${fmtSigned(r.m.maxDD6m)}%  ${r.m.above200dma === false ? "[DOWNTREND]" : ">200dma"}`
  ).join("\n");
}

// ─── Staleness stats: how long has each current holding been in the book? ────
// Surfaced to the synthesis prompt so continuity is a conscious, re-underwritten
// decision instead of silent anchoring on yesterday's list.
function buildStalenessStats(history, universe) {
  const entries = history?.entries ?? [];
  if (entries.length === 0) return { text: "", currentTickers: [] };
  const last = entries[entries.length - 1];
  const currentTickers = (last.picks || []).map(p => p.ticker);
  const streaks = currentTickers.map(t => {
    let n = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if ((entries[i].picks || []).some(p => p.ticker === t)) n++;
      else break;
    }
    return { ticker: t, days: n };
  }).sort((a, b) => b.days - a.days);
  const recent30 = new Set();
  for (const e of entries.slice(-30)) {
    for (const p of e.picks || []) recent30.add(p.ticker);
  }
  const neverRecent = universe.filter(t => !recent30.has(t));
  let text = `Consecutive trading days each current holding has been in the book: ` +
    streaks.map(s => `${s.ticker} ${s.days}d`).join(", ");
  if (neverRecent.length > 0) {
    text += `\nUniverse names NOT picked once in the last 30 cycles (potential blind spots): ${neverRecent.join(", ")}`;
  }
  return { text, currentTickers };
}

// ─── Track record: how have the published picks actually done? ──────────────
// Closes the loop the engine never had: every run scores the book it published
// against SPY using the same price data, and the synthesis prompt sees it.
// A pick is marked at the last close at or before its publish time (ET), so
// the numbers are what a follower could roughly have captured.
function priceDateForEntry(entry) {
  const t = new Date(entry.generatedAt || `${entry.date}T23:00:00Z`).getTime();
  return new Date(t - 5 * 3_600_000).toISOString().slice(0, 10); // ~ET
}

function closeOnOrBefore(q, date) {
  if (!q?.dates) return null;
  let lo = 0, hi = q.dates.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (q.dates[mid] <= date) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx >= 0 ? { idx, close: q.closes[idx] } : null;
}

function buildTrackRecord(history, quotes, { maxEntries = 60 } = {}) {
  const entries = (history?.entries ?? []).filter(e => !e.error).slice(-maxEntries);
  const spy = quotes["SPY"];
  if (entries.length < 2 || !spy?.dates) return { text: "", summary: null };

  const legRet = (ticker, d0, d1) => {
    const a = closeOnOrBefore(quotes[ticker], d0), b = closeOnOrBefore(quotes[ticker], d1);
    return (a && b && a.close > 0) ? b.close / a.close - 1 : null;
  };
  const mean = (xs) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null;

  // Chain each day's book over the interval until the next publish.
  let growth = 1, book = 1, bench = 1, legs = 0;
  for (let i = 0; i < entries.length; i++) {
    const d0 = priceDateForEntry(entries[i]);
    const d1 = i + 1 < entries.length ? priceDateForEntry(entries[i + 1]) : spy.dates[spy.dates.length - 1];
    if (d1 <= d0) continue;
    const picks = entries[i].picks || [];
    const g = mean(picks.filter(p => p.category !== "defensive").map(p => legRet(p.ticker, d0, d1)).filter(r => r != null));
    let wSum = 0, wRet = 0;
    for (const p of picks) {
      const r = legRet(p.ticker, d0, d1);
      const w = p.suggestedWeight || 1;
      if (r != null) { wSum += w; wRet += w * r; }
    }
    const s = legRet("SPY", d0, d1);
    if (g == null || s == null || wSum === 0) continue;
    growth *= 1 + g; book *= 1 + wRet / wSum; bench *= 1 + s; legs++;
  }

  // Hit rate: did each growth pick beat SPY over the 10 sessions after publish?
  let hits = 0, tries = 0;
  for (const e of entries) {
    const d0 = priceDateForEntry(e);
    const s0 = closeOnOrBefore(spy, d0);
    if (!s0 || s0.idx + 10 >= spy.dates.length) continue;
    const d1 = spy.dates[s0.idx + 10];
    const s = legRet("SPY", d0, d1);
    for (const p of (e.picks || []).filter(p => p.category !== "defensive")) {
      const r = legRet(p.ticker, d0, d1);
      if (r == null || s == null) continue;
      tries++; if (r > s) hits++;
    }
  }

  // Current holdings: performance since the start of their current streak.
  const last = entries[entries.length - 1];
  const holdings = (last.picks || []).map(p => {
    let start = entries.length - 1;
    while (start > 0 && (entries[start - 1].picks || []).some(x => x.ticker === p.ticker)) start--;
    const d0 = priceDateForEntry(entries[start]);
    const dNow = spy.dates[spy.dates.length - 1];
    const r = legRet(p.ticker, d0, dNow), s = legRet("SPY", d0, dNow);
    const m = quotes[p.ticker]?.metrics;
    const excess = (r != null && s != null) ? (r - s) * 100 : null;
    // Sell-discipline flag: lagging SPY by 8+ pts since entry AND trend broken.
    const review = excess != null && excess < -8 && m && (m.above50dma === false || m.above200dma === false);
    return { ticker: p.ticker, category: p.category, since: entries[start].date, days: entries.length - start,
             ret: r != null ? r * 100 : null, excess, review };
  });

  const pct = (x) => Number(((x - 1) * 100).toFixed(1));
  const summary = {
    sessions: legs,
    fromDate: entries[0].date,
    growthBookPct: pct(growth),
    fullBookPct: pct(book),
    spyPct: pct(bench),
    growthVsSpyPct: Number((pct(growth) - pct(bench)).toFixed(1)),
    hitRate10d: tries ? Number((hits / tries * 100).toFixed(0)) : null,
    hitSample: tries,
    holdings: holdings.map(h => ({ ...h,
      ret: h.ret != null ? Number(h.ret.toFixed(1)) : null,
      excess: h.excess != null ? Number(h.excess.toFixed(1)) : null })),
  };
  if (legs === 0) return { text: "", summary: null };

  const f = (v) => v == null ? "—" : fmtSigned(v);
  const text =
    `Since ${summary.fromDate} (${legs} rebalances): growth book ${f(summary.growthBookPct)}%, ` +
    `full 15-name book ${f(summary.fullBookPct)}%, SPY ${f(summary.spyPct)}% → growth book vs SPY ${f(summary.growthVsSpyPct)} pts.\n` +
    (summary.hitRate10d != null ? `10-session hit rate (growth picks beating SPY): ${summary.hitRate10d}% of ${tries} picks — 50% is a coin flip.\n` : "") +
    `Current holdings since entry (return / vs SPY): ` +
    summary.holdings.map(h => `${h.ticker} ${f(h.ret)}%/${f(h.excess)} (${h.days}d)${h.review ? " ⚠REVIEW" : ""}`).join(", ") +
    (summary.holdings.some(h => h.review)
      ? `\n⚠REVIEW = lagging SPY by 8+ pts since entry AND below its 50dma or 200dma. Exit these unless today's research gives a specific, new reason the thesis is intact.`
      : "");
  return { text, summary };
}

// ─── Retry helper with exponential backoff for transient API failures ────────
// Retries on 429 (rate limit), 5xx, and network errors. Anthropic SDK errors
// expose `status`; APIError subclasses share this shape. Non-retryable errors
// (4xx other than 429) bubble up immediately so we don't waste calls.
async function withRetry(fn, label, { attempts = 3, baseDelayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      const retryable =
        status === undefined ||           // network error, no status
        status === 429 ||                  // rate limited
        (status >= 500 && status < 600);   // server error
      if (!retryable || i === attempts - 1) throw err;
      const wait = baseDelayMs * Math.pow(2, i);
      console.warn(`  ⏳ ${label} attempt ${i + 1}/${attempts} failed (${status ?? "network"}: ${err.message}); retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ─── API call helpers ────────────────────────────────────────────────────────
function textOf(message) {
  return message.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

let usageTotals = { input: 0, output: 0, cacheRead: 0, searches: 0, calls: 0 };
function logUsage(label, message) {
  const u = message.usage || {};
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  usageTotals.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  usageTotals.cacheRead += u.cache_read_input_tokens || 0;
  usageTotals.output += u.output_tokens || 0;
  usageTotals.searches += searches;
  usageTotals.calls++;
  console.log(`     ↳ ${label}: ${message.model} in ${u.input_tokens ?? "?"} / out ${u.output_tokens ?? "?"} tok, ${searches} search(es), stop=${message.stop_reason}`);
}

// Streaming keeps long generations clear of HTTP timeouts; finalMessage()
// returns the same object a non-streaming call would.
let fallbackSupported = true;
async function callClaude(label, params) {
  let message;
  try {
    message = await withRetry(() => fallbackSupported
      ? client.beta.messages.stream({ betas: [FALLBACK_BETA], fallbacks: "default", ...params }).finalMessage()
      : client.messages.stream(params).finalMessage(), label);
  } catch (err) {
    // If the account/model rejects the fallback beta, don't lose the run over it.
    if (!(fallbackSupported && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message))) throw err;
    console.warn(`  ⚠️  Refusal-fallback beta rejected (${err.message}); continuing without it`);
    fallbackSupported = false;
    message = await withRetry(() => client.messages.stream(params).finalMessage(), label);
  }
  logUsage(label, message);
  if (message.stop_reason === "refusal") throw new Error(`${label}: model declined (refusal)`);
  return message;
}

function researchSystem(today, maxSearches) {
  return `You are an autonomous financial research AI. Today is ${today}.
Use web search to find CURRENT, REAL market data and news. Be specific and data-driven: cite actual numbers, company names, dates and recent events. Avoid vague generalities.
You have at most ${maxSearches} web search(es) — pick queries that return the most signal. Be concise: dense bullet points beat prose.`;
}

// ─── Run a single research phase with web search ──────────────────────────────
async function runPhase(phaseConfig, today, { maxTokens = 6000, maxSearches = 2 } = {}) {
  console.log(`\n  🔍 Running: ${phaseConfig.label}...`);
  const message = await callClaude(phaseConfig.label, {
    model: RESEARCH_MODEL,
    max_tokens: maxTokens,
    output_config: { effort: "medium" },
    tools: [{ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: maxSearches }],
    system: researchSystem(today, maxSearches),
    messages: [{ role: "user", content: phaseConfig.prompt }],
  });
  const text = textOf(message);
  console.log(`  ✅ ${phaseConfig.label} complete (${text.length} chars)`);
  return text;
}

// ─── Combined delta update for all cached phases — 1 call, 1 search ─────────
async function runCombinedDelta(cachedPhases, today) {
  console.log(`\n  ⚡ Delta update: ${DELTA_SECTIONS.map(s => s.label.toLowerCase()).join(", ")} (cache hit)...`);
  const message = await callClaude("Combined delta", {
    model: RESEARCH_MODEL,
    max_tokens: 3000,
    output_config: { effort: "low" },
    tools: [{ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: 1 }],
    system: researchSystem(today, 1),
    messages: [{ role: "user", content: getCombinedDeltaPrompt(cachedPhases, today) }],
  });
  const parts = splitCombinedDelta(textOf(message));
  const out = {};
  for (const s of DELTA_SECTIONS) {
    const base = baseText(cachedPhases[s.id]);
    out[s.id] = parts[s.id] ? base + UPDATE_MARKER + parts[s.id] : base;
  }
  console.log(`  ✅ Delta complete (${Object.keys(parts).length}/${DELTA_SECTIONS.length} sections updated)`);
  return out;
}

// ─── Portfolio synthesis: no web search, schema-constrained JSON ─────────────
const STR = { type: "string" };
const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rank: { type: "integer" }, ticker: STR, score: { type: "integer" }, name: STR, sector: STR, horizon: STR,
    category: { type: "string", enum: ["growth", "value", "income", "defensive"] },
    conviction: { type: "string", enum: ["high", "medium", "speculative"] },
    suggestedWeight: { type: "integer" },
    rationale: STR, catalyst: STR, catalystWindow: STR, entryNote: STR, exitTrigger: STR, keyRisk: STR,
    smartMoneyBacking: { type: "boolean" },
  },
  required: ["rank", "ticker", "score", "name", "sector", "horizon", "category", "conviction", "suggestedWeight",
             "rationale", "catalyst", "catalystWindow", "entryNote", "exitTrigger", "keyRisk", "smartMoneyBacking"],
};
const PICKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    picks: { type: "array", items: PICK_SCHEMA },
    summary: STR,
    diversificationNote: STR,
    macroOutlook: { type: "string", enum: ["Bullish", "Cautiously Bullish", "Neutral", "Cautious", "Bearish"] },
    defensiveScore: { type: "integer" },
  },
  required: ["picks", "summary", "diversificationNote", "macroOutlook", "defensiveScore"],
};

async function runSynthesis(phaseConfig) {
  console.log(`\n  🧠 Synthesis on ${SYNTHESIS_MODEL}...`);
  const message = await callClaude(phaseConfig.label, {
    model: SYNTHESIS_MODEL,
    max_tokens: 32000,
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: PICKS_SCHEMA },
    },
    system: "You are the portfolio manager. Every number you cite must come from the research and screens provided — do not invent prices, multiples or dates.",
    messages: [{ role: "user", content: phaseConfig.prompt }],
  });
  if (message.stop_reason === "max_tokens") throw new Error("synthesis truncated at max_tokens");
  return textOf(message);
}

// ─── Robust JSON extraction ───────────────────────────────────────────────────
// Strategy:
//   1. Strip ```json … ``` fences (and bare ``` fences) from anywhere in the
//      payload, plus leading/trailing whitespace.
//   2. Try a direct JSON.parse on the trimmed string.
//   3. Walk the string with a string-aware bracket-depth tracker to find every
//      balanced {…} or […] block and parse the largest one that succeeds. This
//      is more robust than first/last brace because it correctly handles braces
//      inside string literals.
//   4. On total failure, dump the raw payload to
//      reports/last-bad-response-<timestamp>.txt and throw a richer Error that
//      includes the byte offset and a 200-char window around it.
function stripFences(text) {
  let out = text.trim();
  // ```json … ```  (multi-line, with optional language tag)
  const fenced = /^```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(out);
  if (fenced) return fenced[1].trim();
  // Bare leading/trailing fence (line-anchored, more permissive)
  out = out.replace(/^\s*```(?:json|javascript|js)?\s*\r?\n?/i, "");
  out = out.replace(/\r?\n?```\s*$/i, "");
  return out.trim();
}

function findBalancedJSONCandidates(text) {
  const out = [];
  for (let start = 0; start < text.length; start++) {
    const opener = text[start];
    if (opener !== "{" && opener !== "[") continue;
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === "\\") { escape = true; continue; }
        if (c === "\"")  { inString = false; continue; }
        continue;
      }
      if (c === "\"")     { inString = true; continue; }
      else if (c === opener) depth++;
      else if (c === closer) {
        depth--;
        if (depth === 0) {
          out.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  // Try the largest candidates first
  out.sort((a, b) => b.length - a.length);
  return out;
}

function dumpBadPayload(text, errorMsg) {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dumpPath = path.join(REPORTS_DIR, `last-bad-response-${ts}.txt`);
    fs.writeFileSync(
      dumpPath,
      `// JSON parse failure at ${new Date().toISOString()}\n` +
      `// Error: ${errorMsg}\n` +
      `// Payload length: ${text.length} bytes\n` +
      `// ─────────────────────────────────────────────────────────────\n\n` +
      text
    );
    console.error(`  📝 Bad payload dumped to ${dumpPath}`);
    return dumpPath;
  } catch (err) {
    console.error("  ⚠️  Could not dump bad payload:", err.message);
    return null;
  }
}

function buildRichError(parseError, src) {
  const m = /position\s+(\d+)/i.exec(parseError.message || "");
  if (!m) return new Error(`${parseError.message} (payload length ${src.length} bytes)`);
  const pos = parseInt(m[1], 10);
  const lo = Math.max(0, pos - 100);
  const hi = Math.min(src.length, pos + 100);
  const window = src.slice(lo, hi).replace(/\n/g, "\\n");
  const arrow  = " ".repeat(pos - lo) + "^";
  return new Error(
    `${parseError.message}\n` +
    `  at byte ${pos} of ${src.length}\n` +
    `  context (±100 chars):\n  ${window}\n  ${arrow}`
  );
}

function extractJSON(text) {
  if (typeof text !== "string") {
    throw new Error(`extractJSON expected string, got ${typeof text}`);
  }

  // 1. Strip fences + trim
  const stripped = stripFences(text);

  // 2. Direct parse
  let directErr = null;
  try { return JSON.parse(stripped); }
  catch (e) { directErr = e; }

  // 3. Balanced-bracket candidates (largest first)
  const candidates = findBalancedJSONCandidates(stripped);
  let lastErr = directErr;
  for (const c of candidates) {
    try { return JSON.parse(c); }
    catch (e) { lastErr = e; }
  }

  // 4. Last-ditch: outermost {…} (legacy fallback for stubborn payloads)
  const firstBrace = stripped.indexOf("{");
  const lastBrace  = stripped.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = stripped.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); }
    catch (e) { lastErr = e; }
  }

  // Total failure — quarantine and throw richer error
  dumpBadPayload(text, lastErr?.message || "unknown");
  throw buildRichError(lastErr || new Error("No valid JSON found"), stripped);
}

// ─── Portfolio validation & repair ───────────────────────────────────────────
// The prompt states the construction rules; this enforces the ones code can
// enforce, so a sloppy generation can't ship a broken book (history has days
// with the same ticker in both sleeves and 95% of picks tagged "high").
const MAX_HIGH_GROWTH = 3;
const MAX_HIGH_DEFENSIVE = 2;

function normalizeWeights(picks) {
  const raw = picks.map(p => Math.min(15, Math.max(3, Number(p.suggestedWeight) || 5)));
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const scaled = raw.map(w => Math.round(w * 100 / total));
  const diff = 100 - scaled.reduce((a, b) => a + b, 0);
  if (diff !== 0 && scaled.length) {
    const i = scaled.indexOf(Math.max(...scaled));
    scaled[i] += diff;
  }
  return picks.map((p, i) => ({ ...p, suggestedWeight: scaled[i] }));
}

function validatePortfolio(picks) {
  const warnings = [];
  const seen = new Set();
  const unique = [];
  for (const p of picks || []) {
    const t = String(p.ticker || "").toUpperCase().trim();
    if (!t) continue;
    if (seen.has(t)) { warnings.push(`dropped duplicate ${t}`); continue; }
    seen.add(t);
    unique.push({ ...p, ticker: t });
  }
  let growth    = unique.filter(p => p.category !== "defensive");
  let defensive = unique.filter(p => p.category === "defensive");
  if (growth.length > 10)   { warnings.push(`trimmed growth book from ${growth.length} to 10`); growth = growth.slice(0, 10); }
  if (defensive.length > 5) { warnings.push(`trimmed defensive sleeve from ${defensive.length} to 5`); defensive = defensive.slice(0, 5); }
  if (growth.length < 10)   warnings.push(`growth book has only ${growth.length} names`);
  if (defensive.length < 5) warnings.push(`defensive sleeve has only ${defensive.length} names`);

  const capHigh = (list, max) => {
    let n = 0;
    return list.map(p => {
      if (p.conviction !== "high") return p;
      if (++n <= max) return p;
      warnings.push(`demoted ${p.ticker} conviction high→medium (cap ${max})`);
      return { ...p, conviction: "medium" };
    });
  };
  growth    = capHigh(growth, MAX_HIGH_GROWTH);
  defensive = capHigh(defensive, MAX_HIGH_DEFENSIVE);

  const sectorCounts = {};
  growth.forEach(p => { sectorCounts[p.sector] = (sectorCounts[p.sector] || 0) + 1; });
  Object.entries(sectorCounts).filter(([, n]) => n > 3)
    .forEach(([sec, n]) => warnings.push(`sector cap breached: ${n} names in ${sec}`));

  const ranked = [
    ...growth.map((p, i) => ({ ...p, rank: i + 1 })),
    ...defensive.map((p, i) => ({ ...p, rank: i + 1 })),
  ];
  return { picks: normalizeWeights(ranked), warnings };
}

// ─── Quarantine an unparseable picks.json ────────────────────────────────────
// Called at the start of a cycle: if the previous run left a corrupt picks.json
// behind, move it aside (rather than letting the next run silently overwrite or
// half-merge with it).
function quarantineBadPicksFile() {
  if (!fs.existsSync(OUTPUT_PATH)) return null;
  let raw;
  try { raw = fs.readFileSync(OUTPUT_PATH, "utf8"); }
  catch { return null; }
  try { JSON.parse(raw); return null; /* file is fine */ }
  catch (err) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const badPath = path.join(PUBLIC_DIR, `picks.bad.${ts}.json`);
    try {
      fs.renameSync(OUTPUT_PATH, badPath);
      console.warn(`  ⚠️  picks.json was unparseable (${err.message}); quarantined to ${badPath}`);
      return badPath;
    } catch (renameErr) {
      console.error("  ❌ Failed to quarantine bad picks.json:", renameErr.message);
      return null;
    }
  }
}

// ─── Persistent memory: rolling history of daily picks ──────────────────────
// Halo accumulates a research memory across days so the synthesis prompt can
// reason about thesis continuity ("we held NVDA top-rank for 4 days, why?")
// instead of churning picks every cycle. Capped at HISTORY_MAX entries to
// keep prompt + file size bounded.
const HISTORY_PATH = path.join(PUBLIC_DIR, "history.json");
const DAILY_DIR    = path.join(__dirname, "../reports/daily");
const HISTORY_MAX  = 60;
const HISTORY_DIGEST_DAYS = 7;

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data?.entries) ? data : { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function saveHistory(history) {
  try {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("  ⚠️ Could not save history.json:", err.message);
  }
}

function appendHistoryEntry(history, entry) {
  // Replace same-day entry if present (idempotent on re-runs); else append.
  const existingIdx = history.entries.findIndex(e => e.date === entry.date);
  if (existingIdx >= 0) history.entries[existingIdx] = entry;
  else                  history.entries.push(entry);
  history.entries.sort((a, b) => a.date.localeCompare(b.date));
  if (history.entries.length > HISTORY_MAX) {
    history.entries = history.entries.slice(-HISTORY_MAX);
  }
  return history;
}

// Compact the last N history entries into a digest the synthesis prompt can
// consume. Format keeps token cost low while preserving the signal:
//   2026-04-29 | Cautiously Bullish | shield 4 | NVDA(1,hi) MSFT(2,hi) ...
function buildHistoryDigest(history, days = HISTORY_DIGEST_DAYS) {
  const recent = history.entries.slice(-days);
  if (recent.length === 0) return "";
  const rows = recent.map(e => {
    const picks = (e.picks || []).map(p => {
      const conv = p.conviction ? `,${p.conviction.slice(0, 2)}` : "";
      return `${p.ticker}(${p.rank ?? "?"}${conv})`;
    }).join(" ");
    const outlook  = e.macroOutlook ?? "—";
    const shield   = e.defensiveScore != null ? `shield ${e.defensiveScore}` : "shield —";
    return `${e.date} | ${outlook} | ${shield} | ${picks}`;
  });
  return rows.join("\n");
}

// ─── Generate daily markdown archive (permanent record per cycle) ────────────
function generateDailyMarkdown(picks, collected, dateStr, todayLabel) {
  let md = `# Halo Daily Brief — ${todayLabel}\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Macro Outlook:** ${picks.macroOutlook} | **Shield:** ${picks.defensiveScore ?? "—"}/10\n\n`;
  if (picks.summary)            md += `## Synthesis\n\n${picks.summary}\n\n`;
  if (picks.diversificationNote) md += `**Diversification:** ${picks.diversificationNote}\n\n`;
  const allPicks = picks.picks || [];
  const growthPicks    = allPicks.filter(p => p.category !== "defensive");
  const defensivePicks = allPicks.filter(p => p.category === "defensive");
  const renderPick = (p) => {
    const badge = p.category === "defensive" ? " · 🛡 DEFENSIVE" : "";
    let out = `### ${p.rank}. ${p.ticker} — ${p.name}${badge}\n`;
    out += `**Score** ${p.score}/100 · **Sector** ${p.sector} · **Horizon** ${p.horizon} · **Category** ${p.category ?? "growth"}`;
    if (p.conviction)              out += ` · **Conviction** ${p.conviction}`;
    if (p.suggestedWeight != null) out += ` · **Weight** ${p.suggestedWeight}%`;
    out += `\n\n`;
    out += `**Thesis.** ${p.rationale}\n\n`;
    if (p.catalyst)          out += `**Catalyst.** ${p.catalyst}${p.catalystWindow ? ` _(window: ${p.catalystWindow})_` : ""}\n\n`;
    if (p.entryNote)         out += `**Entry.** ${p.entryNote}\n\n`;
    if (p.exitTrigger)       out += `**Exit trigger.** ${p.exitTrigger}\n\n`;
    if (p.keyRisk)           out += `**Key risk.** ${p.keyRisk}\n\n`;
    if (p.smartMoneyBacking) out += `_Smart-money backing._\n\n`;
    return out;
  };
  md += `---\n\n## Top 10 Picks · Growth Book\n\n`;
  growthPicks.forEach(p => { md += renderPick(p); });
  md += `---\n\n## Top 5 Defensive Picks/ETFs · Shield Sleeve\n\n`;
  defensivePicks.forEach(p => { md += renderPick(p); });
  md += `---\n\n## Research Phases\n\n`;
  [
    { id: "macro",    label: "Macro Climate" },
    { id: "sectors",  label: "Sector Rotation" },
    { id: "momentum", label: "Price & Earnings Momentum" },
    { id: "smart",    label: "Smart Money Tracking" },
    { id: "risk",     label: "Risk Assessment" },
  ].forEach(ph => {
    if (collected[ph.id]) {
      const snippet = collected[ph.id].length > 2500
        ? collected[ph.id].slice(0, 2500) + "…"
        : collected[ph.id];
      md += `### ${ph.label}\n\n${snippet}\n\n`;
    }
  });
  return md;
}

// ─── Generate weekly markdown report ─────────────────────────────────────────
function generateWeeklyMarkdown(picks, collected, weekLabel, history) {
  const date = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  let md = `# Halo Weekly Report\n`;
  md += `**${weekLabel}** · Generated ${date}\n`;
  md += `**Macro Outlook:** ${picks.macroOutlook} · **Shield:** ${picks.defensiveScore ?? "—"}/10\n\n`;
  if (picks.summary)             md += `## Synthesis\n\n${picks.summary}\n\n`;
  if (picks.diversificationNote) md += `**Diversification:** ${picks.diversificationNote}\n\n`;
  const allPicks = picks.picks || [];
  const growthPicks    = allPicks.filter(p => p.category !== "defensive");
  const defensivePicks = allPicks.filter(p => p.category === "defensive");
  const renderPick = (p) => {
    const badge = p.category === "defensive" ? " · 🛡 DEFENSIVE" : "";
    let out = `### ${p.rank}. ${p.ticker} — ${p.name}${badge}\n`;
    out += `**Score** ${p.score}/100 · **Sector** ${p.sector} · **Horizon** ${p.horizon} · **Category** ${p.category ?? "growth"}`;
    if (p.conviction)              out += ` · **Conviction** ${p.conviction}`;
    if (p.suggestedWeight != null) out += ` · **Weight** ${p.suggestedWeight}%`;
    out += `\n\n`;
    out += `**Thesis.** ${p.rationale}\n\n`;
    if (p.catalyst)          out += `**Catalyst.** ${p.catalyst}${p.catalystWindow ? ` _(window: ${p.catalystWindow})_` : ""}\n\n`;
    if (p.entryNote)         out += `**Entry.** ${p.entryNote}\n\n`;
    if (p.exitTrigger)       out += `**Exit trigger.** ${p.exitTrigger}\n\n`;
    if (p.keyRisk)           out += `**Key risk.** ${p.keyRisk}\n\n`;
    if (p.smartMoneyBacking) out += `_Smart-money backing._\n\n`;
    return out;
  };
  md += `---\n\n## Top 10 Picks · Growth Book (this week's portfolio)\n\n`;
  growthPicks.forEach(p => { md += renderPick(p); });
  md += `---\n\n## Top 5 Defensive Picks/ETFs · Shield Sleeve\n\n`;
  defensivePicks.forEach(p => { md += renderPick(p); });

  // Week-over-week thesis evolution (using history)
  if (history?.entries?.length > 1) {
    const recent = history.entries.slice(-5);
    md += `---\n\n## Week's Positioning Evolution\n\n`;
    md += `| Date | Outlook | Shield | Tickers |\n|---|---|---|---|\n`;
    recent.forEach(e => {
      const tickers = (e.picks || []).map(p => p.ticker).join(", ");
      md += `| ${e.date} | ${e.macroOutlook ?? "—"} | ${e.defensiveScore ?? "—"}/10 | ${tickers} |\n`;
    });
    md += `\n`;
  }

  md += `---\n\n## Research Phases\n\n`;
  [
    { id: "macro",    label: "Macro Climate"             },
    { id: "sectors",  label: "Sector Rotation"           },
    { id: "momentum", label: "Price & Earnings Momentum" },
    { id: "smart",    label: "Smart Money Tracking"      },
    { id: "risk",     label: "Risk Assessment"           },
  ].forEach(ph => {
    if (collected[ph.id]) {
      const snippet = collected[ph.id].length > 2500
        ? collected[ph.id].slice(0, 2500) + "…"
        : collected[ph.id];
      md += `### ${ph.label}\n\n${snippet}\n\n`;
    }
  });
  return md;
}

// ─── Main research loop ───────────────────────────────────────────────────────
async function runResearch() {
  const today        = new Date().toDateString();
  const todayDate    = new Date().toISOString().slice(0, 10);
  const forceWeekly  = process.env.FORCE_WEEKLY === "true" || process.env.FORCE_WEEKLY === "1";
  const friday       = isFriday() || forceWeekly;
  const fullRefresh  = needsFullRefresh() || forceWeekly;
  const weekLabel    = getWeekLabel();
  const universeData = loadUniverseData();
  const universe     = universeData.groups.flatMap(g => g.tickers);
  const history      = loadHistory();
  const historyDigest = buildHistoryDigest(history);

  console.log("━".repeat(60));
  console.log("🚀 HALO - Daily Research Engine");
  console.log(`📅 ${today}`);
  console.log(`🔄 ${CYCLE_INFO.label} (${CYCLE_INFO.timeET})`);
  if (forceWeekly)      console.log("📋 FORCE_WEEKLY — generating weekly report regardless of day");
  else if (isFriday())  console.log("📋 Friday — full refresh + weekly report");
  else if (needsFullRefresh()) console.log("🔄 Monday — full refresh (weekend gap)");
  else                  console.log("⚡ Tue–Thu — stable phases served from cache");
  if (history.entries.length > 0) {
    console.log(`🧠 Memory: ${history.entries.length} prior cycles loaded (digest: last ${Math.min(HISTORY_DIGEST_DAYS, history.entries.length)})`);
  }
  console.log("━".repeat(60));

  // ── Quarantine an unparseable picks.json before we go any further ──
  // (Prevents a corrupt file from shadowing a successful run, and keeps a copy
  //  for forensic inspection.)
  quarantineBadPicksFile();

  // ── Read existing picks.json to preserve weekly report + phase cache ──
  let existingData = {};
  try {
    existingData = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  } catch (err) {
    // First run, missing file, or quarantined. Either way, treat as empty.
    if (err.code !== "ENOENT") {
      console.warn(`  ⚠️  Could not read existing ${OUTPUT_PATH}: ${err.message}`);
    }
  }

  // Decide whether cached stable phases are usable
  const useCache = !fullRefresh && isCacheValid(existingData);
  const cachedPhases = existingData?.phaseData ?? {};
  const usedCachedPhases = [];
  const failedPhases = [];

  // ── Universe-wide quant screen (real price data, computed locally) ──
  // Fetched BEFORE the research phases so the momentum phase and the picks
  // synthesis reason from actual returns instead of the model's priors.
  console.log(`\n  📈 Building quant screen: fetching ${universe.length + 1} tickers (1y daily closes)...`);
  let quotes = {};
  try {
    quotes = await fetchQuotes([...universe, "SPY"]);
    console.log(`  ✅ Price data for ${Object.keys(quotes).length}/${universe.length + 1} tickers`);
  } catch (err) {
    console.error("  ⚠️ Quant screen fetch failed:", err.message);
  }
  const quant     = buildQuantScreen(quotes, universe);
  const staleness = buildStalenessStats(history, universe);
  const spotlight = pickSpotlightGroup(universeData.groups);
  const track     = buildTrackRecord(history, quotes);
  const currentSet   = new Set(staleness.currentTickers);
  const defensiveTickers = universeData.groups.find(g => g.key === "defensive")?.tickers ?? [];
  const defensiveSet = new Set(defensiveTickers);
  // Challengers skip EXTENDED names: chasing a vertical move is how the old
  // book bought MU / MRVL / FCX near short-term tops.
  const challengers  = quant.rows
    .filter(r => !currentSet.has(r.ticker) && !defensiveSet.has(r.ticker) && !r.flags.includes("EXTENDED"))
    .slice(0, 8)
    .map(r => r.ticker);
  const phaseExtras = {
    quantTable:    quant.table,
    quantCompact:  quant.compact,
    stalenessText: staleness.text,
    challengers,
    spotlight,
    trackRecordText: track.text,
    defensiveScreen: buildDefensiveScreen(quotes, defensiveTickers),
  };
  if (spotlight)          console.log(`  🔦 Spotlight group today: ${spotlight.label}`);
  if (challengers.length) console.log(`  🥊 Challengers (high-score, not held, not extended): ${challengers.join(", ")}`);
  if (track.summary)      console.log(`  📊 Track record: growth ${track.summary.growthBookPct}% vs SPY ${track.summary.spyPct}% over ${track.summary.sessions} rebalances; 10d hit rate ${track.summary.hitRate10d ?? "—"}%`);

  // ── Run research phases 1–5 ──
  const collected = {};
  const phases    = getPhases(collected, today, universe, historyDigest, phaseExtras);
  const cachedReady = useCache && [...STABLE_PHASES].every(id => cachedPhases[id]);

  if (cachedReady) {
    try {
      Object.assign(collected, await runCombinedDelta(cachedPhases, today));
      usedCachedPhases.push(...STABLE_PHASES);
    } catch (err) {
      console.error("  ❌ Combined delta failed:", err.message, "— reusing cached text as-is");
      for (const id of STABLE_PHASES) collected[id] = baseText(cachedPhases[id]);
      failedPhases.push("delta");
    }
  }

  for (const phase of phases.slice(0, 5)) {
    if (collected[phase.id] !== undefined) continue; // served by the delta
    try {
      collected[phase.id] = await runPhase(phase, today);
    } catch (err) {
      console.error(`  ❌ Phase ${phase.label} failed:`, err.message);
      failedPhases.push(phase.id);
      // Fall back to last known cached phase if we have one — better stale data
      // than an error string in the synthesis prompt.
      collected[phase.id] = cachedPhases[phase.id] ? baseText(cachedPhases[phase.id]) : "";
    }
  }

  if (usedCachedPhases.length > 0) {
    console.log(`\n  💾 Cache used for: ${usedCachedPhases.join(", ")} (1 combined delta call instead of ${usedCachedPhases.length} full phases)`);
  }

  // ── Synthesis (no web search — pure reasoning over the research) ──
  console.log("\n  🏆 Generating Top 10 Picks + 5 Defensive (synthesizing all phases)...");
  let picks = null;
  let validationWarnings = [];
  try {
    const picksPhase = getPhases(collected, today, universe, historyDigest, phaseExtras)[5];
    const picksRaw   = await runSynthesis(picksPhase);
    picks = extractJSON(picksRaw);
    // Validate we actually got picks
    if (!Array.isArray(picks.picks) || picks.picks.length === 0) {
      throw new Error("Picks array is missing or empty");
    }
    const checked = validatePortfolio(picks.picks);
    picks.picks = checked.picks;
    validationWarnings = checked.warnings;
    validationWarnings.forEach(w => console.warn(`  ⚠️  ${w}`));
    const growthTickers    = picks.picks.filter(p => p.category !== "defensive").map(p => p.ticker);
    const defensiveTickersOut = picks.picks.filter(p => p.category === "defensive").map(p => p.ticker);
    console.log(`\n  🎯 GROWTH (${growthTickers.length}): ${growthTickers.join(", ")}`);
    console.log(`  🛡  DEFENSIVE (${defensiveTickersOut.length}): ${defensiveTickersOut.join(", ")}`);
  } catch (err) {
    console.error("  ❌ Picks generation failed:", err.message);
    // Preserve previous picks rather than blanking the UI on a transient failure
    const prior = existingData?.picks?.length > 0 ? existingData.picks : [];
    picks = {
      picks: prior,
      summary: prior.length > 0
        ? "Today's research cycle failed; showing previous picks."
        : "Research cycle encountered an error generating picks.",
      macroOutlook: existingData?.macroOutlook ?? "Neutral",
      defensiveScore: existingData?.defensiveScore ?? 5,
      error: err.message,
    };
  }

  // ── Fetch live quotes for daily + weekly tickers ──
  // Yahoo Finance chart endpoint; no API key. Failures per-ticker are non-fatal.
  const dailyTickers = (picks.picks || []).map(p => p.ticker);
  const existingWeeklyPicks = existingData?.weeklyReport?.picks || [];
  // On Friday the weekly report is regenerated from today's picks, so those
  // tickers are already in dailyTickers. On other days we still want fresh
  // prices on the preserved weekly report.
  const weeklyTickers = friday ? [] : existingWeeklyPicks.map(p => p.ticker);
  const allTickers = [...new Set([...dailyTickers, ...weeklyTickers])];
  // The quant-screen fetch already covered the whole universe; only fetch
  // tickers that fell outside it (or failed earlier).
  const missingTickers = allTickers.filter(t => !quotes[t]);
  if (missingTickers.length > 0) {
    console.log(`\n  💹 Fetching quotes for ${missingTickers.length} tickers not covered by the quant screen...`);
    try {
      const extra = await fetchQuotes(missingTickers);
      quotes = { ...quotes, ...extra };
    } catch (err) {
      console.error("  ⚠️ Quote fetch step failed:", err.message);
    }
  }
  console.log(`  ✅ Quotes available for ${allTickers.filter(t => quotes[t]).length}/${allTickers.length} pick tickers`);
  if (picks.picks?.length > 0) {
    picks.picks = enrichWithQuotes(picks.picks, quotes);
  }

  // ── Cycle tracking (single daily run) ──
  const cyclesCompletedToday = 1;

  // ── Persist memory: append today's cycle to rolling history ──
  // Stored even when picks generation fails (so the failure itself is visible
  // to future runs). On a partial-recovery run that reused yesterday's picks,
  // we still re-record today's date with those picks — the digest will surface
  // continuity correctly.
  if (picks.picks?.length > 0) {
    const historyEntry = {
      date:           todayDate,
      generatedAt:    new Date().toISOString(),
      macroOutlook:   picks.macroOutlook,
      defensiveScore: picks.defensiveScore,
      summary:        picks.summary,
      diversificationNote: picks.diversificationNote,
      picks: picks.picks.map(p => ({
        rank:       p.rank,
        ticker:     p.ticker,
        name:       p.name,
        sector:     p.sector,
        category:   p.category,
        score:      p.score,
        conviction: p.conviction,
        suggestedWeight: p.suggestedWeight,
        catalyst:   p.catalyst,
      })),
      ...(picks.error ? { error: picks.error } : {}),
    };
    appendHistoryEntry(history, historyEntry);
    saveHistory(history);
    console.log(`  💾 History updated (${history.entries.length} entries on file)`);
  }

  // ── Daily archive: permanent markdown record of every successful cycle ──
  if (picks.picks?.length > 0 && !picks.error) {
    try {
      fs.mkdirSync(DAILY_DIR, { recursive: true });
      const dailyPath = path.join(DAILY_DIR, `${todayDate}.md`);
      fs.writeFileSync(dailyPath, generateDailyMarkdown(picks, collected, todayDate, getTodayLabel()));
      console.log(`  📓 Daily brief saved to ${dailyPath}`);
    } catch (err) {
      console.error("  ⚠️ Could not save daily brief:", err.message);
    }
  }

  // ── Build / preserve weekly report ──
  let weeklyReport = existingData?.weeklyReport ?? null;
  if (weeklyReport?.picks?.length > 0) {
    // Refresh prices on the preserved weekly report so the Weekly tab tracks
    // live closes between Friday regenerations.
    weeklyReport = { ...weeklyReport, picks: enrichWithQuotes(weeklyReport.picks, quotes) };
  }
  if (friday && picks.picks?.length > 0 && !picks.error) {
    weeklyReport = {
      picks:       picks.picks,
      summary:     picks.summary,
      diversificationNote: picks.diversificationNote,
      macroOutlook:picks.macroOutlook,
      defensiveScore: picks.defensiveScore,
      generatedAt: new Date().toISOString(),
      weekOf:      weekLabel,
      phaseData:   { ...collected },
    };
    // Save markdown report file
    try {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      const reportPath = path.join(REPORTS_DIR, `${todayDate}-weekly-report.md`);
      fs.writeFileSync(reportPath, generateWeeklyMarkdown(picks, collected, weekLabel, history));
      console.log(`\n  📋 Weekly report saved to ${reportPath}`);
    } catch (err) {
      console.error("  ⚠️ Could not save weekly report:", err.message);
    }
  }

  // ── Build final output ──
  const output = {
    // Daily picks (latest cycle)
    picks:        picks.picks || [],
    summary:      picks.summary,
    diversificationNote: picks.diversificationNote,
    macroOutlook: picks.macroOutlook,
    defensiveScore: picks.defensiveScore ?? 5,

    // Cycle tracking
    dailyCycleNumber:    CYCLE_INFO.number,
    dailyCycleLabel:     CYCLE_INFO.label,
    dailyCycleTimeET:    CYCLE_INFO.timeET,
    cyclesCompletedToday,
    todayDate,
    todayLabel:          getTodayLabel(),

    // Timestamps
    generatedAt: new Date().toISOString(),
    weekOf:      weekLabel,

    // Weekly report (preserved across daily runs; updated every Friday after market close)
    weeklyReport,

    // Raw phase data (for Research tab)
    phaseData: {
      macro:    collected.macro,
      sectors:  collected.sectors,
      momentum: collected.momentum,
      smart:    collected.smart,
      risk:     collected.risk,
    },

    metadata: {
      generatedAt:        new Date().toISOString(),
      weekOf:             weekLabel,
      universeSize:       universe.length,
      phasesCompleted:    Object.keys(collected).length,
      isWeeklyFriday:     friday,
      forceWeekly:        forceWeekly,
      usedCachedPhases:   usedCachedPhases,
      failedPhases:       failedPhases,
      fullRefresh:        fullRefresh || friday,
      historyEntries:     history.entries.length,
      quantScreenTickers: quant.rows.length,
      spotlightGroup:     spotlight?.key ?? null,
      challengers,
      models:             { research: RESEARCH_MODEL, synthesis: SYNTHESIS_MODEL },
      usage:              usageTotals,
      validationWarnings,
    },

    // Realized performance of the published book vs SPY (computed each run)
    trackRecord: track.summary,

    ...(picks.error ? { error: picks.error } : {}),
  };

  // ── Write to public/picks.json ──
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  const cacheNote = usedCachedPhases.length > 0
    ? ` | Cached: ${usedCachedPhases.join(", ")}`
    : " | Full refresh";
  console.log("\n" + "━".repeat(60));
  console.log(`✅ Results saved to ${OUTPUT_PATH}`);
  console.log(`📊 Macro Outlook: ${output.macroOutlook} | Defensive Score: ${output.defensiveScore}/10`);
  console.log(`🔄 ${CYCLE_INFO.label} run complete${cacheNote}`);
  console.log(`💰 ${usageTotals.calls} API calls · ${usageTotals.input} in / ${usageTotals.output} out tokens · ${usageTotals.searches} web searches`);
  console.log("━".repeat(60));

  return output;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
// Guarded so the pure helpers can be imported by tests without kicking off a
// full (API-spending) research run.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runResearch().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export {
  client,
  runResearch,
  buildQuantScreen,
  buildDefensiveScreen,
  buildTrackRecord,
  computeQuoteMetrics,
  validatePortfolio,
  splitCombinedDelta,
  baseText,
  buildStalenessStats,
  pickSpotlightGroup,
  fetchTickerQuote,
  fetchQuotes,
  getPhases,
  extractJSON,
  buildHistoryDigest,
};
