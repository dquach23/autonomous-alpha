import { useState, useEffect } from "react";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:      "#070910",
  surface: "#0d1018",
  card:    "#111520",
  border:  "#1a2035",
  text:    "#e2e8f8",
  muted:   "#4a5580",
  accent:  "#00d4aa",
  gold:    "#ffd700",
  blue:    "#4da6ff",
  purple:  "#c084fc",
  red:     "#ff4d6d",
  orange:  "#ff8c42",
  green:   "#22c55e",
  shield:  "#60a5fa",
};

const OUTLOOK_COLOR = {
  "Bullish":           C.accent,
  "Cautiously Bullish":C.blue,
  "Neutral":           C.gold,
  "Cautious":          C.orange,
  "Bearish":           C.red,
  "Pending":           C.muted,
};

const CATEGORY_COLOR = {
  growth:    C.accent,
  defensive: C.shield,
  value:     C.gold,
  income:    C.purple,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function Tag({ color = C.muted, children }) {
  return (
    <span style={{
      background: `${color}18`, color, border: `1px solid ${color}30`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.05em", whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function Card({ children, accent, style = {} }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${accent ? accent + "33" : C.border}`,
      borderRadius: 14,
      padding: "16px 18px",
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      {accent && (
        <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: accent }} />
      )}
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, color: C.muted, fontWeight: 700,
        letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Connection + Cycle Status Bar ─────────────────────────────────────────────
function StatusBar({ data, connected }) {
  if (!connected) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0 10px" }}>
        <span style={{
          display: "flex", alignItems: "center", gap: 5,
          background: `${C.red}18`, border: `1px solid ${C.red}30`,
          borderRadius: 20, padding: "4px 10px",
          fontSize: 11, fontWeight: 700, color: C.red,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red }} />
          DISCONNECTED
        </span>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const isToday     = data?.todayDate === today;
  const cycles      = data?.cyclesCompletedToday || 0;
  const allDone     = cycles >= 1; // schedule is now once-daily
  const cycleLabel  = data?.dailyCycleLabel || "";
  const statusColor = isToday ? (allDone ? C.accent : C.gold) : C.muted;

  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center", padding: "6px 0 10px", flexWrap: "wrap" }}>
      {/* Live / Cached badge */}
      <span style={{
        display: "flex", alignItems: "center", gap: 5,
        background: `${statusColor}18`, border: `1px solid ${statusColor}30`,
        borderRadius: 20, padding: "4px 10px",
        fontSize: 11, fontWeight: 700, color: statusColor,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: statusColor,
          animation: isToday ? "pulse 2s infinite" : "none",
        }} />
        {isToday ? "LIVE" : "CACHED"}
      </span>

      {/* Cycle count badge */}
      {data && (
        <span style={{
          display: "flex", alignItems: "center", gap: 5,
          background: `${allDone ? C.accent : C.gold}18`,
          border: `1px solid ${allDone ? C.accent : C.gold}30`,
          borderRadius: 20, padding: "4px 10px",
          fontSize: 11, fontWeight: 700,
          color: allDone ? C.accent : C.gold,
        }}>
          {allDone ? "✓" : "🔄"} {cycles}/1 daily cycle
          {cycleLabel ? ` · ${cycleLabel}` : ""}
        </span>
      )}

      {/* Defensive score badge */}
      {data?.defensiveScore != null && (
        <span style={{
          background: `${C.shield}18`, border: `1px solid ${C.shield}30`,
          borderRadius: 20, padding: "4px 10px",
          fontSize: 11, fontWeight: 700, color: C.shield,
        }}>
          🛡 Defense {data.defensiveScore}/10
        </span>
      )}
    </div>
  );
}

// ── Stock Pick Card ───────────────────────────────────────────────────────────
function PickCard({ pick, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const rankColor = [C.gold, "#c0c0c0", "#cd7f32", C.accent, C.blue][pick.rank - 1] || C.accent;
  const isDefensive = pick.category === "defensive";

  return (
    <Card accent={isDefensive ? C.shield : rankColor} style={{ marginBottom: 10 }}>
      <div style={{ paddingLeft: 8 }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%",
            background: `${isDefensive ? C.shield : rankColor}22`,
            border: `1px solid ${isDefensive ? C.shield : rankColor}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, color: isDefensive ? C.shield : rankColor, fontSize: 12, flexShrink: 0,
          }}>
            {isDefensive ? "🛡" : pick.rank}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: "-0.02em" }}>
                {pick.ticker}
              </span>
              <span style={{ fontSize: 12, color: C.muted }}>{pick.name}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <Tag color={isDefensive ? C.shield : rankColor}>Score {pick.score}/100</Tag>
            {pick.smartMoneyBacking && <Tag color={C.purple}>Smart Money ✓</Tag>}
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {pick.sector    && <Tag color={C.blue}>{pick.sector}</Tag>}
          {pick.horizon   && <Tag color={C.gold}>{pick.horizon}</Tag>}
          {pick.category  && (
            <Tag color={CATEGORY_COLOR[pick.category] || C.muted}>
              {pick.category.toUpperCase()}
            </Tag>
          )}
        </div>

        {/* Rationale */}
        {!compact && (
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, margin: "0 0 10px" }}>
            {pick.rationale}
          </p>
        )}

        {/* Risk (expandable) */}
        {!compact && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                background: "none", border: "none", color: C.muted,
                fontSize: 11, cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {expanded ? "▲" : "▼"} {expanded ? "Hide" : "Show"} key risk
            </button>
            {expanded && (
              <div style={{
                marginTop: 8, background: `${C.red}10`,
                border: `1px solid ${C.red}20`, borderRadius: 6, padding: "8px 10px",
              }}>
                <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>⚠ KEY RISK: </span>
                <span style={{ fontSize: 12, color: `${C.red}cc` }}>{pick.keyRisk}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ── Phase Detail (Research tab) ───────────────────────────────────────────────
function PhaseDetail({ label, icon, color, content }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", background: C.card,
          border: `1px solid ${open ? color + "44" : C.border}`,
          borderRadius: 10, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", color: C.text, textAlign: "left",
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: open ? color : C.text }}>
          {label}
        </span>
        <span style={{ color: C.muted, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderTop: "none", borderRadius: "0 0 10px 10px", padding: "14px 16px",
        }}>
          <p style={{
            color: C.muted, fontSize: 12.5, lineHeight: 1.8,
            whiteSpace: "pre-wrap", margin: 0,
          }}>
            {content.length > 1200 ? content.slice(0, 1200) + "…" : content}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "picks",    label: "🏆 Picks"    },
  { id: "weekly",   label: "📋 Weekly"   },
  { id: "research", label: "🔬 Research" },
  { id: "about",    label: "ℹ️ About"    },
];

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]         = useState(null);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState("picks");
  const [loading, setLoading]   = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/picks.json?t=" + Date.now());
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} fetching /picks.json`);
        }
        // Read as text first so we can surface a useful parse error if the
        // cached file is malformed (rather than the generic
        // "Research Cycle Error" the data path would render).
        const raw = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (parseErr) {
          if (cancelled) return;
          const m = /position\s+(\d+)/i.exec(parseErr.message || "");
          const pos = m ? parseInt(m[1], 10) : null;
          let detail = parseErr.message;
          if (pos != null) {
            detail += ` (byte ${pos} of ${raw.length})`;
            const lo = Math.max(0, pos - 60);
            const hi = Math.min(raw.length, pos + 60);
            const ctx = raw.slice(lo, hi).replace(/\s+/g, " ");
            detail += `\n…${ctx}…`;
          }
          setError(`Cached picks unparseable — see error below\n${detail}`);
          // We did connect to the file — it's the file itself that's bad.
          setConnected(true);
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setData(parsed);
        setConnected(true);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e.message);
        setConnected(false);
        setLoading(false);
      }
    }
    load();
    // No interval polling: data refreshes once daily on the server, so
    // re-fetching aggressively wastes bandwidth. A page reload is enough.
    return () => { cancelled = true; };
  }, []);

  const outlookColor = data ? (OUTLOOK_COLOR[data.macroOutlook] || C.muted) : C.muted;
  const weeklyData   = data?.weeklyReport;

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", color: C.text,
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
      maxWidth: 480, margin: "0 auto",
      paddingBottom: 80,
    }}>
      <style>{`
        button { font-family: inherit; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1a2035; border-radius: 2px; }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      {/* ── Sticky Header ── */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "env(safe-area-inset-top, 0px) 20px 0",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0 0" }}>
          <div>
            <div style={{
              fontWeight: 900, fontSize: 19, letterSpacing: "-0.03em",
              background: `linear-gradient(90deg,${C.accent},${C.blue})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              AUTONOMOUS ALPHA
            </div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.1em", fontWeight: 600 }}>
              AI STOCK INTELLIGENCE · DAILY RESEARCH
            </div>
          </div>
          {data?.macroOutlook && data.macroOutlook !== "Pending" && (
            <Tag color={outlookColor}>{data.macroOutlook}</Tag>
          )}
        </div>

        {/* Connection + Cycle Status */}
        <StatusBar data={data} connected={connected} />

        {/* Tab bar */}
        <div style={{ display: "flex", marginTop: 2 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
              padding: "10px 2px", cursor: "pointer",
              color: tab === t.id ? C.accent : C.muted,
              fontWeight: tab === t.id ? 700 : 500, fontSize: 12,
              transition: "all 0.2s",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: "20px 16px", animation: "fadeIn 0.3s ease" }}>

        {/* Loading spinner */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{
              width: 32, height: 32, border: `3px solid ${C.accent}`,
              borderTopColor: "transparent", borderRadius: "50%",
              animation: "spin 0.8s linear infinite", margin: "0 auto 16px",
            }} />
            <div style={{ color: C.muted, fontSize: 14 }}>Loading picks…</div>
          </div>
        )}

        {/* Load error */}
        {error && (
          <Card accent={C.red}>
            <div style={{ color: C.red, fontWeight: 700, marginBottom: 6 }}>⚠ Load Error</div>
            <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{error}</div>
          </Card>
        )}

        {/* ════════════ PICKS TAB ════════════ */}
        {!loading && !error && tab === "picks" && (
          <>
            {/* Cycle header */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 700, marginBottom: 2 }}>
                {data?.todayLabel || data?.metadata?.weekOf || "Daily Research"}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                {data?.dailyCycleLabel && (
                  <Tag color={C.blue}>{data.dailyCycleLabel} ({data.dailyCycleTimeET})</Tag>
                )}
                {data?.dailyCycleNumber && (
                  <Tag color={C.accent}>Cycle {data.dailyCycleNumber}/1</Tag>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Updated: {formatDate(data?.generatedAt || data?.metadata?.generatedAt)}
              </div>
            </div>

            {/* Research cycle error banner */}
            {data?.error && (
              <Card accent={C.red} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.red, fontWeight: 700, marginBottom: 4 }}>
                  ⚠ Research Cycle Error
                </div>
                <div style={{ fontSize: 12, color: `${C.red}cc` }}>{data.error}</div>
              </Card>
            )}

            {/* AI Synthesis */}
            {data?.summary && (
              <Card style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
                  AI SYNTHESIS
                </div>
                <p style={{ color: C.text, fontSize: 13.5, lineHeight: 1.8 }}>{data.summary}</p>
              </Card>
            )}

            {/* No picks yet */}
            {(!data?.picks || data.picks.length === 0) && (
              <Card style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
                <div style={{ fontWeight: 700, color: C.text, marginBottom: 8 }}>Awaiting Research Cycle</div>
                <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
                  Runs automatically once daily on weekdays:{"\n"}
                  5 PM ET (after market close){"\n\n"}
                  Or trigger manually from GitHub → Actions.
                </div>
              </Card>
            )}

            {/* Pick cards — growth picks */}
            {data?.picks?.filter(p => p.category !== "defensive").length > 0 && (
              <Section title={`Top Picks · ${data.picks.filter(p => p.category !== "defensive").length} Growth/Value`}>
                {data.picks
                  .filter(p => p.category !== "defensive")
                  .map(p => <PickCard key={p.ticker} pick={p} />)}
              </Section>
            )}

            {/* Defensive picks section */}
            {data?.picks?.filter(p => p.category === "defensive").length > 0 && (
              <Section title={`🛡 Defensive Picks`}>
                <Card accent={C.shield} style={{ marginBottom: 12, padding: "10px 14px" }}>
                  <p style={{ fontSize: 12, color: `${C.shield}cc`, margin: 0, lineHeight: 1.6 }}>
                    Defensive Score {data.defensiveScore}/10 — AI has recommended capital preservation positions for this environment.
                  </p>
                </Card>
                {data.picks
                  .filter(p => p.category === "defensive")
                  .map(p => <PickCard key={p.ticker} pick={p} />)}
              </Section>
            )}

            {/* Disclaimer */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "12px 14px", marginTop: 8,
            }}>
              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.7 }}>
                ⚠️ <strong style={{ color: C.muted }}>Not financial advice.</strong>{" "}
                AI-generated research for informational purposes only. Always conduct your own due diligence. Investing involves risk of loss.
              </div>
            </div>
          </>
        )}

        {/* ════════════ WEEKLY TAB ════════════ */}
        {!loading && !error && tab === "weekly" && (
          <>
            {weeklyData ? (
              <>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, color: C.text, fontWeight: 700, marginBottom: 4 }}>
                    {weeklyData.weekOf}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>
                    Generated: {formatDate(weeklyData.generatedAt)}
                  </div>
                </div>

                {weeklyData.summary && (
                  <Card style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
                      WEEKLY AI SYNTHESIS
                    </div>
                    <p style={{ color: C.text, fontSize: 13.5, lineHeight: 1.8 }}>{weeklyData.summary}</p>
                  </Card>
                )}

                <Section title={`Weekly Top ${weeklyData.picks?.length || 0} Picks`}>
                  {weeklyData.picks?.map(p => <PickCard key={p.ticker + "-weekly"} pick={p} />)}
                </Section>

                {/* Weekly macro outlook */}
                {weeklyData.macroOutlook && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>WEEKLY MACRO OUTLOOK</div>
                    <Tag color={OUTLOOK_COLOR[weeklyData.macroOutlook] || C.muted}>
                      {weeklyData.macroOutlook}
                    </Tag>
                    {weeklyData.defensiveScore != null && (
                      <span style={{ marginLeft: 8 }}>
                        <Tag color={C.shield}>Defensive Score {weeklyData.defensiveScore}/10</Tag>
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <Card style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 700, color: C.text, marginBottom: 8 }}>No Weekly Report Yet</div>
                <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
                  Weekly reports are generated every Sunday and saved here.{"\n"}
                  Daily picks appear in the Picks tab.
                </div>
              </Card>
            )}
          </>
        )}

        {/* ════════════ RESEARCH TAB ════════════ */}
        {!loading && !error && tab === "research" && (
          <>
            <div style={{ marginBottom: 16, color: C.muted, fontSize: 13 }}>
              Full research data from the latest automated cycle:
            </div>

            {[
              { id: "macro",    label: "Macro Climate",             icon: "🌍", color: C.blue   },
              { id: "sectors",  label: "Sector Rotation",           icon: "⚙️",  color: C.gold   },
              { id: "momentum", label: "Price & Earnings Momentum", icon: "📈", color: C.accent },
              { id: "smart",    label: "Smart Money Tracking",      icon: "🧠", color: C.purple },
              { id: "risk",     label: "Risk Assessment",           icon: "🛡️",  color: C.red    },
            ].map(ph => (
              <PhaseDetail
                key={ph.id}
                label={ph.label}
                icon={ph.icon}
                color={ph.color}
                content={data?.phaseData?.[ph.id]}
              />
            ))}

            {!data?.phaseData?.macro && (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔬</div>
                Research data will appear here after the first cycle runs.
              </div>
            )}
          </>
        )}

        {/* ════════════ ABOUT TAB ════════════ */}
        {tab === "about" && (
          <>
            <Section title="How It Works">
              <Card style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[
                    { icon: "📡", title: "Autonomous Daily Research", desc: "Once every weekday at 5 PM ET (after market close), GitHub Actions automatically runs a 6-phase AI research cycle using Claude AI with live web search." },
                    { icon: "🔍", title: "6 Research Phases", desc: "Macro climate → Sector rotation → Price momentum → Smart money tracking → Risk assessment → Final picks synthesis." },
                    { icon: "🛡", title: "Defensive Category", desc: "The AI evaluates whether the macro environment warrants defensive positioning — it can pick bond ETFs (TLT, IEF), gold (GLD), dividend ETFs (SCHD, VYM), utilities, or staples alongside growth stocks." },
                    { icon: "🏆", title: "Daily + Weekly Picks", desc: "The daily cycle updates the Picks tab after market close. Every Sunday the AI generates a formal weekly report saved to the Weekly tab." },
                    { icon: "📱", title: "Live Status", desc: "The header shows LIVE status once today's daily cycle has completed. Green = fresh data today." },
                    { icon: "⚡", title: "Manual Trigger", desc: "Go to GitHub repo → Actions → Daily Market Research → Run workflow to trigger a cycle immediately." },
                  ].map(item => (
                    <div key={item.title} style={{
                      display: "flex", gap: 12, paddingBottom: 14,
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 3 }}>{item.title}</div>
                        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            <Section title="Stock Universe (115 tickers)">
              <Card>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginBottom: 10 }}>
                  The AI researches and selects from this curated universe of 115 tickers across all major sectors — including a new Defensive category:
                </div>
                {[
                  { label: "Mega-Cap Tech / AI / Semis",           color: C.accent, tickers: ["NVDA","MSFT","AAPL","AMZN","GOOGL","META","TSLA","AVGO","TSM","AMD","QCOM","MU","ARM","MRVL","ANET","ORCL","ADBE","INTU","NFLX","UBER"] },
                  { label: "Cybersecurity / Cloud / SaaS",         color: C.blue,   tickers: ["PANW","CRWD","ZS","PLTR","SNOW","CRM","NOW","NET"] },
                  { label: "Healthcare / Biotech / MedTech",       color: C.purple, tickers: ["LLY","NVO","UNH","JNJ","ABBV","MRK","PFE","AMGN","ISRG","BSX","TMO","VRTX","REGN","GILD","ELV"] },
                  { label: "Financials / Fintech",                 color: C.gold,   tickers: ["BRK.B","JPM","BAC","GS","MS","V","MA","AXP","BLK","SPGI"] },
                  { label: "Energy / Oil & Gas / Pipelines",       color: C.orange, tickers: ["XOM","CVX","OXY","SLB","EOG","COP","MPC","WMB"] },
                  { label: "Industrials / Defense / Aerospace",    color: C.blue,   tickers: ["ETN","NEE","PWR","VST","CEG","RTX","LMT","NOC","CAT","GE"] },
                  { label: "Consumer / Retail",                    color: C.accent, tickers: ["COST","WMT","HD","TJX","SBUX","NKE","MCD","LOW","TGT","BKNG"] },
                  { label: "Materials / Diversified Industrial",   color: C.muted,  tickers: ["EMR","HON","DE","LIN","APD","NEM","FCX","ALB","SHW"] },
                  { label: "REITs / Infrastructure",               color: C.purple, tickers: ["AMT","PLD","EQIX","WELL","O"] },
                  { label: "High-Growth / Emerging Leaders",       color: C.red,    tickers: ["ALAB","ONTO","FLUT","CELH","ENPH"] },
                  { label: "🛡 Defensive / Bonds / Safe Haven",    color: C.shield, tickers: ["KO","PG","PEP","CL","PM","VZ","T","D","SO","DUK","TLT","IEF","GLD","SCHD","VYM"] },
                ].map(group => (
                  <div key={group.label} style={{ marginBottom: 12 }}>
                    <div style={{
                      fontSize: 10, color: group.color, fontWeight: 700,
                      letterSpacing: "0.08em", marginBottom: 6, textTransform: "uppercase",
                    }}>
                      {group.label}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {group.tickers.map(t => <Tag key={t} color={group.color}>{t}</Tag>)}
                    </div>
                  </div>
                ))}
              </Card>
            </Section>

            <Section title="System Info">
              <Card>
                {[
                  ["Research schedule",  "Once daily weekdays (5 PM ET, after market close)"],
                  ["Weekly reports",     "Every Sunday — saved to Weekly tab"],
                  ["AI model",           "Claude Sonnet (Anthropic)"],
                  ["Web search",         "Live data via Anthropic tools"],
                  ["Minimum hold",       "1 year (ideally 3–5 years)"],
                  ["Universe size",      "115 tickers (incl. defensive)"],
                  ["Research phases",    "6 sequential phases"],
                  ["Defensive scoring",  "1–10 scale auto-adjusts picks"],
                ].map(([k, v]) => (
                  <div key={k} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{ fontSize: 12, color: C.muted }}>{k}</span>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{v}</span>
                  </div>
                ))}
              </Card>
            </Section>
          </>
        )}
      </div>

      {/* Bottom safe area */}
      <div style={{ height: "env(safe-area-inset-bottom, 20px)" }} />
    </div>
  );
}
