/**
 * Autonomous Alpha - Weekly Research Engine
 * Runs 6 research phases using Claude AI + web search
 * Saves results to ../public/picks.json for the frontend to consume
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/picks.json");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STOCK_UNIVERSE = [
  "NVDA","MSFT","AAPL","AMZN","GOOGL","META","TSLA","AVGO","TSM","AMD",
  "LLY","NVO","UNH","JNJ","ABBV","MRK","PFE","AMGN",
  "BRK.B","JPM","BAC","GS","MS","V","MA",
  "XOM","CVX","OXY","SLB","EOG",
  "ETN","NEE","PWR","VST","CEG",
  "PANW","CRWD","ZS","PLTR","SNOW","CRM","NOW",
  "COST","WMT","HD","TJX","SBUX",
  "EMR","CAT","DE","HON","GE",
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

Rank sectors 1-6 most to least attractive for 1-5 year investors. Be specific about WHY each is positioned where it is. Use real current data.`,
    },
    {
      id: "momentum",
      label: "Price & Earnings Momentum",
      prompt: `You are a quantitative momentum analyst. Today is ${TODAY}.
From this universe: ${STOCK_UNIVERSE.join(", ")}

Identify the TOP 10 stocks with the strongest combination of:
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
Focus only on moves relevant to 1+ year holding periods.`,
    },
    {
      id: "risk",
      label: "Risk Assessment",
      prompt: `You are a risk management expert. Today is ${TODAY}.
From this universe: ${STOCK_UNIVERSE.join(", ")}

Identify:
1. TOP 5 HIGHEST RISK stocks right now (overvalued, weakening fundamentals, regulatory risk, etc.)
2. TOP 5 LOWEST RISK stocks right now (durable moats, reasonable valuations, defensive characteristics)
3. The 3 biggest MACRO TAIL RISKS that could hurt the market in the next 12 months

Be specific and honest. Name real risks, not generic warnings.`,
    },
    {
      id: "picks",
      label: "Weekly Top 5 Picks",
      prompt: `You are the world's best long-term stock analyst. Today is ${TODAY}.

Based on this research:
MACRO CONTEXT: ${collected.macro || "See previous analysis"}
SECTOR ROTATION: ${collected.sectors || "See previous analysis"}  
MOMENTUM: ${collected.momentum || "See previous analysis"}
SMART MONEY: ${collected.smart || "See previous analysis"}
RISK: ${collected.risk || "See previous analysis"}

From this universe: ${STOCK_UNIVERSE.join(", ")}

Generate the DEFINITIVE TOP 5 STOCKS to buy and hold for a minimum of 1 year (ideally 3-5 years).

Respond ONLY with valid JSON, no other text:
{
  "picks": [
    {
      "rank": 1,
      "ticker": "XXXX",
      "score": 94,
      "name": "Full Company Name",
      "sector": "Sector",
      "horizon": "1-3 years",
      "rationale": "2-3 sentences with specific current catalysts and why NOW is a good entry point",
      "keyRisk": "The single biggest risk to this thesis",
      "smartMoneyBacking": true
    }
  ],
  "summary": "2-3 sentence synthesis of why these 5 stocks represent the best risk-adjusted opportunities right now given the macro and sector backdrop",
  "macroOutlook": "Bullish / Cautiously Bullish / Neutral / Cautious / Bearish",
  "generatedAt": "${new Date().toISOString()}",
  "weekOf": "${getWeekLabel()}"
}`,
    },
  ];
}

function getWeekLabel() {
  const d = new Date();
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return `Week of ${start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

// ─── Run a single research phase with web search ──────────────────────────────
async function runPhase(phaseConfig) {
  console.log(`\n  🔍 Running: ${phaseConfig.label}...`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
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

// ─── Main research loop ───────────────────────────────────────────────────────
async function runResearch() {
  console.log("━".repeat(60));
  console.log("🚀 AUTONOMOUS ALPHA - Weekly Research Engine");
  console.log(`📅 ${TODAY}`);
  console.log("━".repeat(60));

  const collected = {};
  const phases = getPhases(collected);

  // Run phases 1-5 (macro → risk)
  for (const phase of phases.slice(0, 5)) {
    try {
      collected[phase.id] = await runPhase(phase);
      // Brief pause between phases to be respectful of rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ Phase ${phase.label} failed:`, err.message);
      collected[phase.id] = `Research phase encountered an error: ${err.message}`;
    }
  }

  // Run final picks phase (uses all collected data)
  console.log("\n  🏆 Generating Top 5 Picks (synthesizing all phases)...");
  let picks = null;
  try {
    const picksPhase = getPhases(collected)[5];
    const picksRaw = await runPhase(picksPhase);

    // Parse JSON from response
    const jsonMatch = picksRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      picks = JSON.parse(jsonMatch[0]);
      console.log(`\n  🎯 TOP 5: ${picks.picks.map((p) => p.ticker).join(", ")}`);
    } else {
      throw new Error("No valid JSON found in picks response");
    }
  } catch (err) {
    console.error("  ❌ Picks generation failed:", err.message);
    // Create a fallback structure
    picks = {
      picks: [],
      summary: "Research cycle encountered an error generating picks.",
      macroOutlook: "Neutral",
      generatedAt: new Date().toISOString(),
      weekOf: getWeekLabel(),
      error: err.message,
    };
  }

  // Build final output
  const output = {
    ...picks,
    phaseData: {
      macro: collected.macro,
      sectors: collected.sectors,
      momentum: collected.momentum,
      smart: collected.smart,
      risk: collected.risk,
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      weekOf: getWeekLabel(),
      universeSize: STOCK_UNIVERSE.length,
      phasesCompleted: Object.keys(collected).length,
    },
  };

  // Write to public/picks.json
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log("\n━".repeat(60));
  console.log(`✅ Results saved to ${OUTPUT_PATH}`);
  console.log(`📊 Macro Outlook: ${output.macroOutlook}`);
  console.log("━".repeat(60));

  return output;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
runResearch().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
