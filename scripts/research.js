/**
 * Halo - Daily Research Engine (1x/day at market close)
 * Runs 6 research phases using Claude AI + web search
 * Stable phases (macro, sectors, smart money) are cached for 28h and only
 * delta-updated on Tue–Thu, cutting searches and tokens by ~60% on most days.
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

// ── Phase caching ─────────────────────────────────────────────────────────────
// Stable phases (macro climate, sector rotation, smart money) change slowly —
// reuse yesterday's output and do a quick delta search instead of full research.
// Volatile phases (momentum, risk) always run fresh since they track daily prices.
// Full refresh every Friday (weekly report — end of trading week) and Monday (weekend gap).
const CACHE_TTL_MS  = 28 * 60 * 60 * 1000; // 28 hours
const STABLE_PHASES = new Set(["macro", "sectors", "smart"]);

function isCacheValid(existingData) {
  if (!existingData?.generatedAt) return false;
  const ageMs = Date.now() - new Date(existingData.generatedAt).getTime();
  return ageMs < CACHE_TTL_MS;
}

function needsFullRefresh() {
  const day = new Date().getUTCDay();
  return day === 1 || day === 5; // Monday (weekend gap) or Friday (weekly report)
}

// Delta prompts: pass cached context, ask for targeted 1-search update
function getDeltaPrompt(phaseId, cachedText, today) {
  const snippet = cachedText.slice(0, 2000);
  const map = {
    macro: `You are an expert macro economist. Today is ${today}.
Yesterday's macro analysis:
---
${snippet}
---
Do at most 1 web search to check for significant macro developments since yesterday (new Fed signals, a surprise inflation/GDP print, or a major market-moving event). If nothing material has changed, briefly confirm the prior analysis still holds and note any minor updates. Keep your response concise — 2–3 short paragraphs.`,

    sectors: `You are a sector rotation strategist. Today is ${today}.
Yesterday's sector rotation analysis:
---
${snippet}
---
Do at most 1 web search to check for notable sector leadership shifts since yesterday. Update the ranking only if materially new information has emerged; otherwise confirm it holds. Keep your response concise.`,

    smart: `You are an expert tracker of institutional investors. Today is ${today}.
Recent smart money tracking data (past 1–2 days):
---
${snippet}
---
Do at most 1 web search for new 13F disclosures, block trades, or public statements by major hedge funds or billionaire investors since this analysis. Smart money moves are stable short-term — only surface genuinely new information. Keep your response concise.`,
  };
  return map[phaseId];
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
function loadUniverse() {
  const raw = fs.readFileSync(UNIVERSE_PATH, "utf8");
  const data = JSON.parse(raw);
  return data.groups.flatMap(g => g.tickers);
}

// ─── Phase Definitions ────────────────────────────────────────────────────────
// Each phase is written from the perspective of a specialist who an expert
// portfolio manager would consult before making allocation decisions. Prompts
// are deliberately demanding — concrete numbers, specific levels, named
// catalysts — because vague output corrupts the synthesis.
function getPhases(collected, today, universe, historyDigest = "") {
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
From this universe: ${universe.join(", ")}

Score each candidate on:
- **Price momentum**: 3M / 6M / 12M total return vs SPY (relative, not absolute)
- **Earnings revisions**: analyst FY estimate revision direction last 4–13 weeks (up = good)
- **Earnings surprise rate**: % beat on last 4 quarters of EPS
- **Accumulation**: rising on-balance volume / institutional accumulation signals
- **Quality overlay**: gross margin trend, FCF yield, ROIC trajectory (penalize stocks with deteriorating fundamentals even if price is mooning)

Identify the TOP 10 names with the strongest combined factor scores. For each, give: ticker, a 1-sentence rationale citing specific recent data (last earnings beat %, est revision direction, RSI vs SPY), and flag any "extended" names (ones whose price momentum is dangerously ahead of fundamentals — common warning sign of late-stage rallies).`,
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
      label: "Daily Top 5 Picks",
      prompt: `You are an elite long-only portfolio manager building a high-conviction, well-diversified concentrated book. Today is ${today}.

You have access to today's research:

MACRO CONTEXT:
${collected.macro || "(no macro context available)"}

SECTOR ROTATION:
${collected.sectors || "(no sector context available)"}

MOMENTUM SCREEN:
${collected.momentum || "(no momentum screen available)"}

SMART MONEY:
${collected.smart || "(no smart money data available)"}

RISK ASSESSMENT:
${collected.risk || "(no risk data available)"}
${historyDigest ? `\nYOUR RECENT POSITIONING (last 7 trading days):\n${historyDigest}\n\nIMPORTANT: Maintain thesis continuity. If a name was top-ranked recently and the thesis is still intact, KEEP IT — name churn destroys returns. Only drop a name if the thesis broke or a clearly better opportunity emerged. In the summary, briefly note carry-overs vs. changes and why.\n` : ""}

Universe: ${universe.join(", ")}

YOUR JOB: produce the 5 highest risk-adjusted long ideas for a 1–5 year hold horizon, AS A PORTFOLIO. This is not a popularity contest — these 5 must function together.

PORTFOLIO CONSTRUCTION RULES (HARD CONSTRAINTS):
1. **Diversification**: at most 2 picks from the same GICS sector. The 5 picks must collectively span at least 3 distinct sectors. No exceptions.
2. **Defensive sleeve**: if defensiveScore is 5 or higher, at least 1 pick MUST be a defensive (TLT/IEF/GLD/SCHD/VYM/utilities/staples). At score 7+, include 2 defensive picks.
3. **Correlation awareness**: do not pick 3 names that all sell into the same end market (e.g. NVDA + AVGO + AMD is one factor exposure, not three). Pick complementary exposures.
4. **Conviction bar**: only "high" conviction names should get suggestedWeight ≥ 25%. Most picks should be 15–25%. Avoid concentrated single-name risk above 30%.
5. **Asymmetry**: each pick's upside should plausibly be 2x or more vs its downside risk over the horizon. If you can't articulate that, it doesn't belong in a Top 5.
6. **No yield traps, no falling knives, no crowded shorts** as longs.

For each pick, return ALL of the following fields. Be concrete and quantitative.

CRITICAL: Respond with ONLY a single valid JSON object. No markdown fences, no prose before or after. Start with { and end with }.

{
  "picks": [
    {
      "rank": 1,
      "ticker": "XXXX",
      "score": 94,
      "name": "Full Company Name",
      "sector": "GICS sector",
      "horizon": "1-3 years",
      "category": "growth",
      "conviction": "high",
      "suggestedWeight": 25,
      "rationale": "2-3 sentences. Cite specific catalysts (earnings beat, product cycle, regulatory event) and why NOW is a reasonable entry. Reference at least one piece of evidence from the macro / sector / momentum / smart money research above.",
      "catalyst": "The single most important upcoming catalyst (e.g. 'Q1 earnings April 24 with guidance reset', 'GLP-1 Phase 3 readout June')",
      "catalystWindow": "Specific timeframe (e.g. 'next 4 weeks', 'June–August', 'next 2 quarters')",
      "entryNote": "Pricing/timing context — current valuation vs history, technical level (e.g. 'trading at 22x fwd EPS vs 5y avg of 27x; consolidating above 50dma')",
      "exitTrigger": "What would invalidate the thesis and force you to sell (e.g. 'gross margin compression below 70%', 'loss of hyperscaler design wins')",
      "keyRisk": "The single biggest risk to this thesis, named specifically",
      "smartMoneyBacking": true
    }
  ],
  "summary": "3-4 sentences. Open with the macro/regime call. State how the 5 picks express that view as a portfolio. Note carry-overs from prior days and any new additions. Close with the dominant risk you're underwriting.",
  "diversificationNote": "1-2 sentences explicitly naming the sectors covered and any factor concentration you accepted (e.g. 'two AI-infrastructure names — NVDA, AVGO — share secular exposure but different points in the value chain').",
  "macroOutlook": "Cautiously Bullish",
  "defensiveScore": 4
}

Rules:
- category must be exactly one of: "growth", "defensive", "value", "income"
- conviction must be exactly one of: "high", "medium", "speculative"
- suggestedWeight is an integer 5–35 representing % of the equity allocation; the 5 weights should sum to roughly 100
- macroOutlook must be exactly one of: "Bullish", "Cautiously Bullish", "Neutral", "Cautious", "Bearish"
- defensiveScore is 1-10 (1 = full risk-on, 10 = full defensive)
- Include exactly 5 picks
- All string fields are required and must be substantive (no "TBD", no empty strings)`,
    },
  ];
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

// ─── Run a single research phase with web search ──────────────────────────────
async function runPhase(phaseConfig, today, maxTokens = 4000) {
  console.log(`\n  🔍 Running: ${phaseConfig.label}...`);

  const response = await withRetry(() => client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are an autonomous financial research AI. Today is ${today}.
Use web search to find CURRENT, REAL market data and news. Be specific and data-driven.
Cite actual numbers, company names, and recent events. Avoid vague generalities.
SEARCH LIMIT: Use at most 2 web searches per phase. Choose your queries carefully to get the most signal per search.`,
    messages: [{ role: "user", content: phaseConfig.prompt }],
  }), phaseConfig.label);

  // Extract text from all content blocks
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log(`  ✅ ${phaseConfig.label} complete (${text.length} chars)`);
  return text;
}

// ─── Run a delta (cached) phase — 1 search, smaller token budget ─────────────
async function runDeltaPhase(phaseId, phaseLabel, cachedText, today) {
  console.log(`\n  ⚡ Delta update: ${phaseLabel} (cache hit)...`);

  const response = await withRetry(() => client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are an autonomous financial research AI. Today is ${today}.
Use web search sparingly — at most 1 search. Only search if you need to verify a specific recent development since yesterday.`,
    messages: [{ role: "user", content: getDeltaPrompt(phaseId, cachedText, today) }],
  }), `${phaseLabel} delta`);

  const updateText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log(`  ✅ ${phaseLabel} delta complete (${updateText.length} chars)`);
  // Merge: keep cached context visible to picks synthesis, append today's update
  return cachedText + "\n\n--- TODAY'S UPDATE ---\n" + updateText;
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
  md += `---\n\n## Top 5 Picks\n\n`;
  (picks.picks || []).forEach(p => {
    const badge = p.category === "defensive" ? " · 🛡 DEFENSIVE" : "";
    md += `### ${p.rank}. ${p.ticker} — ${p.name}${badge}\n`;
    md += `**Score** ${p.score}/100 · **Sector** ${p.sector} · **Horizon** ${p.horizon} · **Category** ${p.category ?? "growth"}`;
    if (p.conviction)       md += ` · **Conviction** ${p.conviction}`;
    if (p.suggestedWeight != null) md += ` · **Weight** ${p.suggestedWeight}%`;
    md += `\n\n`;
    md += `**Thesis.** ${p.rationale}\n\n`;
    if (p.catalyst)        md += `**Catalyst.** ${p.catalyst}${p.catalystWindow ? ` _(window: ${p.catalystWindow})_` : ""}\n\n`;
    if (p.entryNote)       md += `**Entry.** ${p.entryNote}\n\n`;
    if (p.exitTrigger)     md += `**Exit trigger.** ${p.exitTrigger}\n\n`;
    if (p.keyRisk)         md += `**Key risk.** ${p.keyRisk}\n\n`;
    if (p.smartMoneyBacking) md += `_Smart-money backing._\n\n`;
  });
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
  md += `---\n\n## Top 5 Picks (this week's portfolio)\n\n`;
  (picks.picks || []).forEach(p => {
    const badge = p.category === "defensive" ? " · 🛡 DEFENSIVE" : "";
    md += `### ${p.rank}. ${p.ticker} — ${p.name}${badge}\n`;
    md += `**Score** ${p.score}/100 · **Sector** ${p.sector} · **Horizon** ${p.horizon} · **Category** ${p.category ?? "growth"}`;
    if (p.conviction)       md += ` · **Conviction** ${p.conviction}`;
    if (p.suggestedWeight != null) md += ` · **Weight** ${p.suggestedWeight}%`;
    md += `\n\n`;
    md += `**Thesis.** ${p.rationale}\n\n`;
    if (p.catalyst)        md += `**Catalyst.** ${p.catalyst}${p.catalystWindow ? ` _(window: ${p.catalystWindow})_` : ""}\n\n`;
    if (p.entryNote)       md += `**Entry.** ${p.entryNote}\n\n`;
    if (p.exitTrigger)     md += `**Exit trigger.** ${p.exitTrigger}\n\n`;
    if (p.keyRisk)         md += `**Key risk.** ${p.keyRisk}\n\n`;
    if (p.smartMoneyBacking) md += `_Smart-money backing._\n\n`;
  });

  // Week-over-week thesis evolution (using history)
  if (history?.entries?.length > 1) {
    const recent = history.entries.slice(-5);
    md += `---\n\n## Week's Positioning Evolution\n\n`;
    md += `| Date | Outlook | Shield | Top 5 |\n|---|---|---|---|\n`;
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
  const universe     = loadUniverse();
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

  // ── Run research phases 1–5 ──
  const collected = {};
  const phases    = getPhases(collected, today, universe, historyDigest);

  for (const phase of phases.slice(0, 5)) {
    try {
      if (useCache && STABLE_PHASES.has(phase.id) && cachedPhases[phase.id]) {
        // Delta update: pass cache + do ≤1 search for what changed
        collected[phase.id] = await runDeltaPhase(phase.id, phase.label, cachedPhases[phase.id], today);
        usedCachedPhases.push(phase.id);
      } else {
        // Full fresh research with ≤2 searches
        collected[phase.id] = await runPhase(phase, today, 4000);
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ Phase ${phase.label} failed:`, err.message);
      failedPhases.push(phase.id);
      // Fall back to last known cached phase if we have one — better stale data
      // than an error string in the synthesis prompt.
      if (cachedPhases[phase.id]) {
        console.warn(`     ↪ falling back to cached ${phase.label}`);
        collected[phase.id] = cachedPhases[phase.id];
      } else {
        collected[phase.id] = ""; // Empty string is benign in synthesis prompt
      }
    }
  }

  if (useCache && usedCachedPhases.length > 0) {
    console.log(`\n  💾 Cache used for: ${usedCachedPhases.join(", ")} (saved ${usedCachedPhases.length * 2} searches)`);
  }

  // ── Run picks phase with larger token budget (no web search — pure synthesis) ──
  console.log("\n  🏆 Generating Top 5 Picks (synthesizing all phases)...");
  let picks = null;
  try {
    const picksPhase = getPhases(collected, today, universe, historyDigest)[5];
    const picksRaw   = await runPhase(picksPhase, today, 8000);
    picks = extractJSON(picksRaw);
    // Validate we actually got picks
    if (!Array.isArray(picks.picks) || picks.picks.length === 0) {
      throw new Error("Picks array is missing or empty");
    }
    console.log(`\n  🎯 TOP 5: ${picks.picks.map(p => p.ticker).join(", ")}`);
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
    },

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
  console.log("━".repeat(60));

  return output;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
runResearch().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
