/**
 * Autonomous Alpha - Daily Research Engine (3x/day)
 * Runs 6 research phases using Claude AI + web search
 * Saves results to ../public/picks.json for the frontend to consume
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/picks.json");
const REPORTS_DIR = path.join(__dirname, "../reports");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Determine which of 3 daily cycles this is based on UTC hour ───────────────
function getCycleInfo() {
  const hour = new Date().getUTCHours();
  if (hour >= 12 && hour < 16) return { number: 1, label: "Pre-Market",   timeET: "9:00 AM ET"  };
  if (hour >= 16 && hour < 20) return { number: 2, label: "Midday",       timeET: "1:00 PM ET"  };
  return                               { number: 3, label: "After-Market", timeET: "5:00 PM ET"  };
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
Cite actual numbers, company names, and recent events. Avoid vague generalities.`,
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

// ─── Robust JSON extraction ───────────────────────────────────────────────────
function extractJSON(text) {
  // Try direct parse first (ideal case — model followed instructions)
  try { return JSON.parse(text.trim()); } catch {}

  // Strip markdown code fences if present
  const stripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
  try { return JSON.parse(stripped); } catch {}

  // Extract outermost { ... } block
  const firstBrace = text.indexOf("{");
  const lastBrace  = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch {}
  }

  throw new Error("No valid JSON found in response");
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
  const weekLabel = getWeekLabel();

  console.log("━".repeat(60));
  console.log("🚀 AUTONOMOUS ALPHA - Daily Research Engine");
  console.log(`📅 ${TODAY}`);
  console.log(`🔄 Cycle ${cycle.number}/3: ${cycle.label} (${cycle.timeET})`);
  if (sunday) console.log("📋 Sunday — weekly report will be generated");
  console.log("━".repeat(60));

  // ── Read existing picks.json to preserve weekly report ──
  let existingData = {};
  try {
    existingData = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  } catch { /* first run, no existing data */ }

  // ── Run research phases 1–5 ──
  const collected = {};
  const phases    = getPhases(collected);

  for (const phase of phases.slice(0, 5)) {
    try {
      collected[phase.id] = await runPhase(phase, 4000);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ Phase ${phase.label} failed:`, err.message);
      collected[phase.id] = `Research phase encountered an error: ${err.message}`;
    }
  }

  // ── Run picks phase with larger token budget ──
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

  // ── Calculate cycles completed today ──
  const prevDate             = existingData?.todayDate;
  const prevCyclesCompleted  = existingData?.cyclesCompletedToday || 0;
  const cyclesCompletedToday = (prevDate === todayDate)
    ? Math.max(prevCyclesCompleted, cycle.number)
    : cycle.number;

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
      generatedAt:      new Date().toISOString(),
      weekOf:           weekLabel,
      universeSize:     STOCK_UNIVERSE.length,
      phasesCompleted:  Object.keys(collected).length,
      isWeeklySunday:   sunday,
    },

    ...(picks.error ? { error: picks.error } : {}),
  };

  // ── Write to public/picks.json ──
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log("\n" + "━".repeat(60));
  console.log(`✅ Results saved to ${OUTPUT_PATH}`);
  console.log(`📊 Macro Outlook: ${output.macroOutlook} | Defensive Score: ${output.defensiveScore}/10`);
  console.log(`🔄 Cycle ${cycle.number}/3 complete | ${cyclesCompletedToday}/3 cycles today`);
  console.log("━".repeat(60));

  return output;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
runResearch().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
