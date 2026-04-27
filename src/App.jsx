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
};

const OUTLOOK_COLOR = {
  "Bullish": C.accent,
  "Cautiously Bullish": C.blue,
  "Neutral": C.gold,
  "Cautious": C.orange,
  "Bearish": C.red,
  "Pending": C.muted,
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
      {accent && <div style={{ position:"absolute", top:0, left:0, width:3, height:"100%", background: accent }} />}
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Stock Pick Card ───────────────────────────────────────────────────────────
function PickCard({ pick }) {
  const [expanded, setExpanded] = useState(false);
  const rankColor = [C.gold, "#c0c0c0", "#cd7f32", C.accent, C.blue][pick.rank - 1] || C.accent;

  return (
    <Card accent={rankColor} style={{ marginBottom: 10 }}>
      <div style={{ paddingLeft: 8 }}>
        {/* Header row */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%",
            background: `${rankColor}22`, border: `1px solid ${rankColor}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, color: rankColor, fontSize: 12, flexShrink: 0,
          }}>
            {pick.rank}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: "-0.02em" }}>{pick.ticker}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{pick.name}</span>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
            <Tag color={rankColor}>Score {pick.score}/100</Tag>
            {pick.smartMoneyBacking && <Tag color={C.purple}>Smart Money ✓</Tag>}
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
          {pick.sector && <Tag color={C.blue}>{pick.sector}</Tag>}
          {pick.horizon && <Tag color={C.gold}>{pick.horizon}</Tag>}
        </div>

        {/* Rationale */}
        <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, margin: "0 0 10px" }}>
          {pick.rationale}
        </p>

        {/* Risk (expandable) */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ background:"none", border:"none", color: C.muted, fontSize:11, cursor:"pointer", padding:0, display:"flex", alignItems:"center", gap:4 }}
        >
          {expanded ? "▲" : "▼"} {expanded ? "Hide" : "Show"} key risk
        </button>

        {expanded && (
          <div style={{ marginTop:8, background:`${C.red}10`, border:`1px solid ${C.red}20`, borderRadius:6, padding:"8px 10px" }}>
            <span style={{ fontSize:11, color:C.red, fontWeight:700 }}>⚠ KEY RISK: </span>
            <span style={{ fontSize:12, color:`${C.red}cc` }}>{pick.keyRisk}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Phase Detail ──────────────────────────────────────────────────────────────
function PhaseDetail({ label, icon, color, content }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width:"100%", background: C.card, border:`1px solid ${open ? color+"44" : C.border}`,
          borderRadius: 10, padding:"12px 14px", display:"flex", alignItems:"center",
          gap:10, cursor:"pointer", color: C.text, textAlign:"left",
        }}
      >
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ flex:1, fontSize:13, fontWeight:700, color: open ? color : C.text }}>{label}</span>
        <span style={{ color: C.muted, fontSize:12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{
          background: C.surface, border:`1px solid ${C.border}`, borderTop:"none",
          borderRadius:"0 0 10px 10px", padding:"14px 16px",
        }}>
          <p style={{ color: C.muted, fontSize:12.5, lineHeight:1.8, whiteSpace:"pre-wrap", margin:0 }}>
            {content.length > 1200 ? content.slice(0, 1200) + "…" : content}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id:"picks",    label:"🏆 Picks"    },
  { id:"research", label:"🔬 Research" },
  { id:"about",    label:"ℹ️ About"    },
];

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab]     = useState("picks");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/picks.json?t=" + Date.now())
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const outlookColor = data ? (OUTLOOK_COLOR[data.macroOutlook] || C.muted) : C.muted;

  return (
    <div style={{
      background: C.bg, minHeight:"100vh", color: C.text,
      fontFamily:"'DM Sans','Segoe UI',sans-serif",
      maxWidth: 480, margin:"0 auto",
      paddingBottom: 80,
    }}>
      <style>{`
        button { font-family:inherit; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-thumb { background:#1a2035; border-radius:2px; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        background: C.surface, borderBottom:`1px solid ${C.border}`,
        padding:"env(safe-area-inset-top, 0px) 20px 0",
        position:"sticky", top:0, zIndex:100,
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 0 0" }}>
          <div>
            <div style={{
              fontWeight:900, fontSize:19, letterSpacing:"-0.03em",
              background:`linear-gradient(90deg,${C.accent},${C.blue})`,
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            }}>
              AUTONOMOUS ALPHA
            </div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", fontWeight:600 }}>
              AI STOCK INTELLIGENCE · AUTO-UPDATED WEEKLY
            </div>
          </div>
          {data?.macroOutlook && data.macroOutlook !== "Pending" && (
            <Tag color={outlookColor}>{data.macroOutlook}</Tag>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display:"flex", marginTop:10 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, background:"transparent", border:"none",
              borderBottom:`2px solid ${tab===t.id ? C.accent : "transparent"}`,
              padding:"10px 4px", cursor:"pointer",
              color: tab===t.id ? C.accent : C.muted,
              fontWeight: tab===t.id ? 700 : 500, fontSize:13,
              transition:"all 0.2s",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding:"20px 16px", animation:"fadeIn 0.3s ease" }}>

        {loading && (
          <div style={{ textAlign:"center", padding:"60px 0" }}>
            <div style={{ width:32, height:32, border:`3px solid ${C.accent}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
            <div style={{ color:C.muted, fontSize:14 }}>Loading picks…</div>
          </div>
        )}

        {error && (
          <Card accent={C.red}>
            <div style={{ color:C.red, fontWeight:700, marginBottom:6 }}>⚠ Load Error</div>
            <div style={{ color:C.muted, fontSize:13 }}>{error}</div>
          </Card>
        )}

        {/* ── PICKS TAB ── */}
        {!loading && !error && tab === "picks" && (
          <>
            {/* Week header */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:13, color:C.muted, marginBottom:4 }}>
                {data?.metadata?.weekOf || data?.weekOf || "Awaiting first run"}
              </div>
              <div style={{ fontSize:11, color:C.muted }}>
                Generated: {formatDate(data?.metadata?.generatedAt || data?.generatedAt)}
              </div>
            </div>

            {/* Summary */}
            {data?.summary && (
              <Card style={{ marginBottom:20 }}>
                <div style={{ fontSize:11, color:C.gold, fontWeight:700, letterSpacing:"0.08em", marginBottom:8 }}>
                  AI SYNTHESIS
                </div>
                <p style={{ color:C.text, fontSize:13.5, lineHeight:1.8 }}>{data.summary}</p>
              </Card>
            )}

            {/* No picks yet */}
            {(!data?.picks || data.picks.length === 0) && (
              <Card style={{ textAlign:"center", padding:"40px 20px" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📡</div>
                <div style={{ fontWeight:700, color:C.text, marginBottom:8 }}>Awaiting First Run</div>
                <div style={{ color:C.muted, fontSize:13, lineHeight:1.7 }}>
                  The GitHub Actions workflow runs every Sunday at 8:00 AM UTC.{"\n"}
                  You can also trigger it manually from your GitHub repository's Actions tab.
                </div>
              </Card>
            )}

            {/* Pick cards */}
            <Section title={`Top ${data?.picks?.length || 0} Picks`}>
              {data?.picks?.map(p => <PickCard key={p.ticker} pick={p} />)}
            </Section>

            {/* Disclaimer */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", marginTop:8 }}>
              <div style={{ fontSize:10, color:C.muted, lineHeight:1.7 }}>
                ⚠️ <strong style={{ color:C.muted }}>Not financial advice.</strong> AI-generated research for informational purposes only. Always conduct your own due diligence. Investing involves risk of loss.
              </div>
            </div>
          </>
        )}

        {/* ── RESEARCH TAB ── */}
        {!loading && !error && tab === "research" && (
          <>
            <div style={{ marginBottom:16, color:C.muted, fontSize:13 }}>
              Full research data from the latest automated cycle:
            </div>

            {[
              { id:"macro",    label:"Macro Climate",         icon:"🌍", color:C.blue   },
              { id:"sectors",  label:"Sector Rotation",       icon:"⚙️",  color:C.gold   },
              { id:"momentum", label:"Price & Earnings Momentum", icon:"📈", color:C.accent },
              { id:"smart",    label:"Smart Money Tracking",  icon:"🧠", color:C.purple },
              { id:"risk",     label:"Risk Assessment",       icon:"🛡️",  color:C.red    },
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
              <div style={{ textAlign:"center", padding:"40px 0", color:C.muted }}>
                <div style={{ fontSize:32, marginBottom:8 }}>🔬</div>
                Research data will appear here after the first GitHub Actions run.
              </div>
            )}
          </>
        )}

        {/* ── ABOUT TAB ── */}
        {tab === "about" && (
          <>
            <Section title="How It Works">
              <Card style={{ marginBottom:10 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {[
                    { icon:"📡", title:"Autonomous Research", desc:"Every Sunday at 8 AM UTC, a GitHub Actions workflow automatically runs a 6-phase AI research cycle using Claude AI with live web search." },
                    { icon:"🔍", title:"6 Research Phases", desc:"Macro climate → Sector rotation → Price momentum → Smart money tracking → Risk assessment → Final picks synthesis." },
                    { icon:"🏆", title:"Top 5 Picks", desc:"The AI synthesizes all research to select the 5 best stocks from a 100-stock universe for a minimum 1-year hold, scored 0-100 with rationale and risk." },
                    { icon:"📱", title:"Always Fresh", desc:"This app reads from picks.json which is automatically updated in GitHub after every weekly cycle. Pull down to refresh." },
                    { icon:"⚡", title:"Manual Trigger", desc:"Don't want to wait until Sunday? Go to your GitHub repo → Actions → Weekly Stock Research → Run workflow." },
                  ].map(item => (
                    <div key={item.title} style={{ display:"flex", gap:12, paddingBottom:14, borderBottom:`1px solid ${C.border}` }}>
                      <span style={{ fontSize:20, flexShrink:0 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13, color:C.text, marginBottom:3 }}>{item.title}</div>
                        <div style={{ fontSize:12, color:C.muted, lineHeight:1.7 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            <Section title="Stock Universe">
              <Card>
                <div style={{ fontSize:12, color:C.muted, lineHeight:1.7, marginBottom:10 }}>
                  The AI researches and selects from this curated universe of 100 high-quality stocks across all major sectors:
                </div>
                {[
                  { label:"Mega-Cap Tech / AI / Semis", color:C.accent, tickers:["NVDA","MSFT","AAPL","AMZN","GOOGL","META","TSLA","AVGO","TSM","AMD","QCOM","MU","ARM","MRVL","ANET","ORCL","ADBE","INTU","NFLX","UBER"] },
                  { label:"Cybersecurity / Cloud / SaaS", color:C.blue, tickers:["PANW","CRWD","ZS","PLTR","SNOW","CRM","NOW","NET"] },
                  { label:"Healthcare / Biotech / MedTech", color:C.purple, tickers:["LLY","NVO","UNH","JNJ","ABBV","MRK","PFE","AMGN","ISRG","BSX","TMO","VRTX","REGN","GILD","ELV"] },
                  { label:"Financials / Fintech", color:C.gold, tickers:["BRK.B","JPM","BAC","GS","MS","V","MA","AXP","BLK","SPGI"] },
                  { label:"Energy / Oil & Gas / Pipelines", color:C.orange, tickers:["XOM","CVX","OXY","SLB","EOG","COP","MPC","WMB"] },
                  { label:"Industrials / Defense / Aerospace", color:C.blue, tickers:["ETN","NEE","PWR","VST","CEG","RTX","LMT","NOC","CAT","GE"] },
                  { label:"Consumer / Retail", color:C.accent, tickers:["COST","WMT","HD","TJX","SBUX","NKE","MCD","LOW","TGT","BKNG"] },
                  { label:"Materials / Diversified Industrial", color:C.muted, tickers:["EMR","HON","DE","LIN","APD","NEM","FCX","ALB","SHW"] },
                  { label:"REITs / Infrastructure", color:C.purple, tickers:["AMT","PLD","EQIX","WELL","O"] },
                  { label:"High-Growth / Emerging Leaders", color:C.red, tickers:["ALAB","ONTO","FLUT","CELH","ENPH"] },
                ].map(group => (
                  <div key={group.label} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, color:group.color, fontWeight:700, letterSpacing:"0.08em", marginBottom:6, textTransform:"uppercase" }}>{group.label}</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {group.tickers.map(t => <Tag key={t} color={group.color}>{t}</Tag>)}
                    </div>
                  </div>
                ))}
              </Card>
            </Section>

            <Section title="System Info">
              <Card>
                {[
                  ["Research schedule", "Every Sunday 8:00 AM UTC"],
                  ["AI model", "Claude Sonnet (Anthropic)"],
                  ["Web search", "Live data via Anthropic tools"],
                  ["Minimum hold", "1 year (ideally 3–5 years)"],
                  ["Universe size", "100 curated stocks"],
                  ["Research phases", "6 sequential phases"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                    <span style={{ fontSize:12, color:C.muted }}>{k}</span>
                    <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </Card>
            </Section>
          </>
        )}
      </div>

      {/* Bottom safe area */}
      <div style={{ height:"env(safe-area-inset-bottom, 20px)" }} />
    </div>
  );
}
