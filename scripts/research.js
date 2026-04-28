/**
 * Autonomous Alpha - Daily Research Engine (1x/day at market close)
 * Runs 6 research phases using Claude AI + web search
 * Stable phases (macro, sectors, smart money) are cached for 28h and only
 * delta-updated on Tue–Sat, cutting searches and tokens by ~60% on most days.
 * Saves results to ../public/picks.json for the frontend to consume
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR  = path.join(__dirname, "../public");
const OUTPUT_PATH = path.join(PUBLIC_DIR, "picks.json");
const REPORTS_DIR = path.join(__dirname, "../reports");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Single daily run at market close ─────────────────────────────────────────
function getCycleInfo() {
  return { number: 1, label: "After-Market", timeET: "5:00 PM ET" };
}

// ── Phase caching ─────────────────────────────────────────────────────────────
// Stable phases (macro climate, sector rotation, smart money) change slowly —
// reuse yesterday's output and do a quick delta search instead of full research.
// Volatile phases (momentum, risk) always run fresh since they track daily prices.
// Full refresh every Sunday (weekly report) and Monday (weekend gap).
const CACHE_TTL_MS  = 28 * 60 * 60 * 1000; // 28 hours
const STABLE_PHASES = new Set(["macro", "sectors", "smart"]);

function isCacheValid(existingData) {
  if (!existingData?.generatedAt) return false;
  const ageMs = Date.now() - new Date(existingData.generatedAt).getTime();
  return ageMs < CACHE_TTL_MS;
}

function needsFullRefresh() {
  const day = new Date().getUTCDay();
  return day === 0 || day === 1; // Sunday (weekly report) or Monday (weekend gap)
}

// Delta prompts: pass cached context, ask for targeted 1-search update
function getDeltaPrompt(phaseId, cachedText) {
  const snippet = cachedText.slice(0, 2000);
  const map = {
    macro: `You are an expert macro economist. Today is ${TODAY}.
Yesterday's macro analysis:
---
${snippet}
---
Do at most 1 web search to check for significant macro developments since yesterday (new Fed signals, a surprise inflation/GDP print, or a major market-moving event). If nothing material has changed, briefly confirm the prior analysis still holds and note any minor updates. Keep your response concise — 2–3 short paragraphs.`,

    sectors: `You are a sector rotation strategist. Today is ${TODAY}.
Yesterday's sector rotation analysis:
---
${snippet}
---
Do at most 1 web search to check for notable sector leadership shifts since yesterday. Update the ranking only if materially new information has emerged; otherwise confirm it holds. Keep your response concise.`,

    smart: `You are an expert tracker of institutional investors. Today is ${TODAY}.
Recent smart money tracking data (past 1–2 days):
---
${snippet}
---
Do at most 1 web search for new 13F disclosures, block trades, or public statements by major hedge funds or billionaire investors since this analysis. Smart money moves are stable short-term — only surface genuinely new information. Keep your response concise.`,
  };
  return map[phaseId];
}

function isSunday() {
  return new Date().getUTCDay() === 0;
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
const STOCK_UNIVERSE = [
  // ── Mega-Cap Tech / AI / Semiconductors (20) ──
  "NVDA","MSFT","AAPL","AMZN","GOOGL","META","TSLA","AVGO","TSM","AMD",
  "QCOM","MU","ARM","MRVL","ANET","ORCL","ADBE","INTU","NFLX","UBER",

  // ── Cybersecurity / Cloud / Enterprise SaaS (8) ──
  "PANW","CRWD","ZS","PLTR","SNOW","CRM","NOW","NET",

  // ── Healthcare / Biotech / MedTech (15) ──
  "LLY","NVO","UNH","JNJ","ABBV","MRK","PFE","AMGN",
  "ISRG","BSX","TMO","VRTX","REGN","GILD","ELV",

  // ── Financials / Fintech (10) ──
  "BRK.B","JPM","BAC","GS","MS","V","MA","AXP","BLK","SPGI",

  // ── Energy / Oil & Gas / Pipelines (8) ──
  "XOM","CVX","OXY","SLB","EOG","COP","MPC","WMB",

  // ── Industrials / Defense / Aerospace (10) ──
  "ETN","NEE","PWR","VST","CEG","RTX","LMT","NOC","CAT","GE",

  // ── Consumer Discretionary / Staples / Retail (10) ──
  "COST","WMT","HD","TJX","SBUX","NKE","MCD","LOW","TGT","BKNG",

  // ── Materials / Diversified Industrial (9) ──
  "EMR","HON","DE","LIN","APD","NEM","FCX","ALB","SHW",

  // ── REITs / Infrastructure (5) ──
  "AMT","PLD","EQIX","WELL","O",

  // ── High-Growth / Emerging Leaders (5) ──
  "ALAB","ONTO","FLUT","CELH","ENPH",

  // ── Defensive / Bonds / Safe Haven (15) ──
  // Consumer Staples: KO, PG, PEP, CL
  // High-Dividend: PM, VZ, T
  // Utilities: D, SO, DUK
  // Bond ETFs: TLT (long-term treasury), IEF (intermediate treasury)
  // Commodities: GLD (gold ETF)
  // Dividend ETFs: SCHD, VYM
  "KO","PG","PEP","CL","PM","VZ","T","D","SO","DUK",
  "TLT","IEF","GLD","SCHD","VYM",
];

const TODAY = new Date().toDateString();

// ─── Phase Definitions ────────────────────────────────────────────────────────
function getPhases(collected) {
  return [
    {
      id: "macro",
      label: "Macro Climate",
      prompt: `You are an expert macro economist. Today is ${TODAY}.
Research and analyze the CURRENT macroeconomic environment for US equities:
- Federal Reserve interest rate stance and likely next moves
- Current inflation trends (CPI, PCE latest readings)
- GDP growth trajectory and recession probability
- Credit market conditions and yield curve shape
- Dollar strength and global liquidity conditions
- Key geopolitical risks affecting markets RIGHT NOW

Provide a sharp 3-paragraph summary. Be specific with numbers and data. Reference actual current conditions.`,
    },
    {
      id: "sectors",
      label: "Sector Rotation",
      prompt: `You are a sector rotation strategist. Today is ${TODAY}.
Analyze which US stock market sectors are leading and lagging RIGHT NOW:
- Technology (AI infrastructure, semiconductors, software)
- Healthcare (biotech, GLP-1 drugs, medical devices)
- Financials (banks, fintech, insurance)
- Energy (oil, gas, clean energy transition)
- Industrials (defense, infrastructure, reshoring)
- Consumer (discretionary vs staples dynamics)
- Defensive (utilities, consumer staples, bond ETFs like TLT/IEF, gold ETF GLD, dividend ETFs like SCHD/VYM)

Rank sectors 1-7 most to least attractive for 1-5 year investors. Be specific about WHY each is positioned where it is. Use real current data.`,
    },
    {
      id: "momentum",
      label: "Price & Earnings Momentum",
      prompt: `You are a quantitative momentum analyst. Today is ${TODAY}.
From this universe: ${STOCK_UNIVERSE.join(", ")}

Identify the TOP 10 stocks/ETFs with the strongest combination of:
- Accelerating earnings/revenue growth (most recent quarters)
- Upward analyst estimate revisions
- Institutional accumulation signals
- Multi-year price uptrend strength

List your top 10 with a 1-sentence rationale each. Use current real data.`,
    },
    {
      id: "smart",
      label: "Smart Money Tracking",
      prompt: `You are an expert tracker of institutional and "smart money" investors. Today is ${TODAY}.
Research RECENT moves (last 1-3 months) by top investors:
- Warren Buffett / Berkshire Hathaway
- Stanley Druckenmiller
- Bill Ackman / Pershing Square
- David Tepper / Appaloosa
- Michael Burry / Scion
- Major hedge funds (Tiger Global, Coatue, Viking, etc.)

What specific stocks are they buying? What themes are they concentrated in? What are they selling?
Are any moving to defensive positions (bonds, gold, staples)?
Focus only on moves relevant to 1+ year holding periods.`,
    },
    {
      id: "risk",
      label: "Risk Assessment",
      prompt: `You are a risk management expert. Today is ${TODAY}.
From this universe: ${STOCK_UNIVERSE.join(", ")}

Identify:
1. TOP 5 HIGHEST RISK stocks right now (overvalued, weakening fundamentals, regulatory risk, etc.)
2. TOP 5 LOWEST RISK / MOST DEFENSIVE picks right now (durable moats, reasonable valuations, defensive characteristics — this can include bond ETFs like TLT/IEF, gold ETF GLD, dividend ETFs like SCHD/VYM, or utility stocks)
3. The 3 biggest MACRO TAIL RISKS that could hurt the market in the next 12 months

Be specific and honest. Name real risks, not generic warnings.`,
    },
    {
      id: "picks",
      label: "Daily Top 5 Picks",
      prompt: `You are the world's best long-term stock analyst. Today is ${TODAY}.

Based on this research:
MACRO CONTEXT: ${collected.macro || "See previous analysis"}
SECTOR ROTATION: ${collected.sectors || "See previous analysis"}
MOMENTUM: ${collected.momentum || "See previous analysis"}
SMART MONEY: ${collected.smart || "See previous analysis"}
RISK: ${collected.risk || "See previous analysis"}

From this universe: ${STOCK_UNIVERSE.join(", ")}

Generate the DEFINITIVE TOP 5 PICKS to buy and hold for a minimum of 1 year (ideally 3-5 years).
The macro environment will guide the mix — if conditions are risky, include 1-2 defensive picks (bond ETFs like TLT/IEF, gold GLD, dividend ETFs SCHD/VYM, or utility/staples stocks).

CRITICAL: You MUST respond with ONLY a single valid JSON object. No markdown fences, no explanation text before or after. Your entire response must be valid JSON starting with { and ending with }.

{
  "picks": [
    {
      "rank": 1,
      "ticker": "XXXX",
      "score": 94,
      "name": "Full Company Name",
      "sector": "Sector",
      "horizon": "1-3 years",
      "category": "growth",
      "rationale": "2-3 sentences with specific current catalysts and why NOW is a good entry point",
      "keyRisk": "The single biggest risk to this thesis",
      "smartMoneyBacking": true
    },
    {
      "rank": 2,
      "ticker": "YYYY",
      "score": 89,
      "name": "Full Company Name",
      "sector": "Sector",
      "horizon": "1-3 years",
      "category": "defensive",
      "rationale": "2-3 sentences explaining defensive value",
      "keyRisk": "Key risk",
      "smartMoneyBacking": false
    }
  ],
  "summary": "2-3 sentence synthesis of why these 5 picks represent the best risk-adjusted opportunities right now given the macro and sector backdrop",
  "macroOutlook": "Cautiously Bullish",
  "defensiveScore": 4
}

Rules:
- category must be exactly one of: "growth", "defensive", "value", "income"
- macroOutlook must be exactly one of: "Bullish", "Cautiously Bullish", "Neutral", "Cautious", "Bearish"
- defensiveScore is 1-10 (1=full risk-on, 10=full defensive) reflecting how defensive the environment warrants
- Include exactly 5 picks in the array`,
    },
  ];
}

// ─── Run a single research phase with web search ──────────────────────────────
async function runPhase(phaseConfig, maxTokens = 4000) {
  console.log(`\n  🔍 Running: ${phaseConfig.label}...`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are an autonomous financial research AI. Today is ${TODAY}.
Use web search to find CURRENT, REAL market data and news. Be specific and data-driven.
Cite actual numbers, company names, and recent events. Avoid vague generalities.
SEARCH LIMIT: Use at most 2 web searches per phase. Choose your queries carefully to get the most signal per search.`,
    messages: [{ role: "user", content: phaseConfig.prompt }],
  });

  // Extract text from all content blocks
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log(`  ✅ ${phaseConfig.label} complete (${text.length} chars)`);
  return text;
}

// ─── Run a delta (cached) phase — 1 search, smaller token budget ─────────────
async function runDeltaPhase(phaseId, phaseLabel, cachedText) {
  console.log(`\n  ⚡ Delta update: ${phaseLabel} (cache hit)...`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are an autonomous financial research AI. Today is ${TODAY}.
Use web search sparingly — at most 1 search. Only search if you need to verify a specific recent development since yesterday.`,
    messages: [{ role: "user", content: getDeltaPrompt(phaseId, cachedText) }],
  });

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

// ─── Generate weekly markdown report ─────────────────────────────────────────
function generateWeeklyMarkdown(picks, collected, weekLabel) {
  const date = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  let md = `# Autonomous Alpha Weekly Report\n`;
  md += `**${weekLabel}** | Generated: ${date}\n`;
  md += `**Macro Outlook:** ${picks.macroOutlook} | **Defensive Score:** ${picks.defensiveScore ?? "—"}/10\n\n---\n\n`;
  md += `## Top 5 Picks\n\n`;
  if (picks.picks) {
    picks.picks.forEach(p => {
      const badge = p.category === "defensive" ? " 🛡️ DEFENSIVE" : "";
      md += `### ${p.rank}. ${p.ticker} — ${p.name}${badge}\n`;
      md += `**Score:** ${p.score}/100 | **Sector:** ${p.sector} | **Horizon:** ${p.horizon} | **Category:** ${p.category ?? "growth"}\n\n`;
      md += `**Rationale:** ${p.rationale}\n\n`;
      md += `**Key Risk:** ${p.keyRisk}\n\n`;
    });
  }
  md += `---\n\n## AI Synthesis\n\n${picks.summary}\n\n---\n\n## Research Phases\n\n`;
  [
    { id: "macro",    label: "Macro Climate"             },
    { id: "sectors",  label: "Sector Rotation"           },
    { id: "momentum", label: "Price & Earnings Momentum" },
    { id: "smart",    label: "Smart Money Tracking"      },
    { id: "risk",     label: "Risk Assessment"           },
  ].forEach(ph => {
    if (collected[ph.id]) {
      const snippet = collected[ph.id].length > 2000
        ? collected[ph.id].slice(0, 2000) + "…"
        : collected[ph.id];
      md += `### ${ph.label}\n\n${snippet}\n\n`;
    }
  });
  return md;
}

// ─── Main research loop ───────────────────────────────────────────────────────
async function runResearch() {
  const cycle     = getCycleInfo();
  const todayDate = new Date().toISOString().slice(0, 10);
  const sunday    = isSunday();
  const fullRefresh = needsFullRefresh();
  const weekLabel = getWeekLabel();

  console.log("━".repeat(60));
  console.log("🚀 AUTONOMOUS ALPHA - Daily Research Engine");
  console.log(`📅 ${TODAY}`);
  console.log(`🔄 ${cycle.label} (${cycle.timeET})`);
  if (sunday)      console.log("📋 Sunday — full refresh + weekly report");
  else if (fullRefresh) console.log("🔄 Monday — full refresh (weekend gap)");
  else             console.log("⚡ Tue–Fri — stable phases served from cache");
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

  // ── Run research phases 1–5 ──
  const collected = {};
  const phases    = getPhases(collected);

  for (const phase of phases.slice(0, 5)) {
    try {
      if (useCache && STABLE_PHASES.has(phase.id) && cachedPhases[phase.id]) {
        // Delta update: pass cache + do ≤1 search for what changed
        collected[phase.id] = await runDeltaPhase(phase.id, phase.label, cachedPhases[phase.id]);
        usedCachedPhases.push(phase.id);
      } else {
        // Full fresh research with ≤2 searches
        collected[phase.id] = await runPhase(phase, 4000);
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ Phase ${phase.label} failed:`, err.message);
      collected[phase.id] = `Research phase encountered an error: ${err.message}`;
    }
  }

  if (useCache && usedCachedPhases.length > 0) {
    console.log(`\n  💾 Cache used for: ${usedCachedPhases.join(", ")} (saved ${usedCachedPhases.length * 2} searches)`);
  }

  // ── Run picks phase with larger token budget (no web search — pure synthesis) ──
  console.log("\n  🏆 Generating Top 5 Picks (synthesizing all phases)...");
  let picks = null;
  try {
    const picksPhase = getPhases(collected)[5];
    const picksRaw   = await runPhase(picksPhase, 8000);
    picks = extractJSON(picksRaw);
    // Validate we actually got picks
    if (!Array.isArray(picks.picks) || picks.picks.length === 0) {
      throw new Error("Picks array is missing or empty");
    }
    console.log(`\n  🎯 TOP 5: ${picks.picks.map(p => p.ticker).join(", ")}`);
  } catch (err) {
    console.error("  ❌ Picks generation failed:", err.message);
    picks = {
      picks: [],
      summary: "Research cycle encountered an error generating picks.",
      macroOutlook: "Neutral",
      defensiveScore: 5,
      error: err.message,
    };
  }

  // ── Cycle tracking (single daily run) ──
  const cyclesCompletedToday = 1;

  // ── Build / preserve weekly report ──
  let weeklyReport = existingData?.weeklyReport ?? null;
  if (sunday && picks.picks?.length > 0) {
    weeklyReport = {
      picks:       picks.picks,
      summary:     picks.summary,
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
      fs.writeFileSync(reportPath, generateWeeklyMarkdown(picks, collected, weekLabel));
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
    macroOutlook: picks.macroOutlook,
    defensiveScore: picks.defensiveScore ?? 5,

    // Cycle tracking
    dailyCycleNumber:    cycle.number,
    dailyCycleLabel:     cycle.label,
    dailyCycleTimeET:    cycle.timeET,
    cyclesCompletedToday,
    todayDate,
    todayLabel:          getTodayLabel(),

    // Timestamps
    generatedAt: new Date().toISOString(),
    weekOf:      weekLabel,

    // Weekly report (preserved across daily runs; updated every Sunday)
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
      universeSize:       STOCK_UNIVERSE.length,
      phasesCompleted:    Object.keys(collected).length,
      isWeeklySunday:     sunday,
      usedCachedPhases:   usedCachedPhases,
      fullRefresh:        fullRefresh || sunday,
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
  console.log(`🔄 ${cycle.label} run complete${cacheNote}`);
  console.log("━".repeat(60));

  return output;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
runResearch().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
