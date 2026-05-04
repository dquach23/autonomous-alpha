import { useState, useEffect } from "react";

// ── Palette: warm cream light theme with halo gold + soft pastels ─────────────
const C = {
  bg:       "#faf8f3",
  surface:  "#ffffff",
  subtle:   "#f3efe6",
  ink:      "#1c1f2e",
  text:     "#2a2e42",
  muted:    "#7a7f93",
  faint:    "#a8acbd",
  border:   "#ece6d8",
  hairline: "#f1ece0",

  halo:     "#d4a574",   // warm gold — primary accent
  haloDeep: "#b8895a",
  haloSoft: "#f5d9b3",

  mint:     "#34d399",   // growth / bullish
  sky:      "#7dd3fc",   // defensive / info
  coral:    "#fb7185",   // risk / bearish
  lavender: "#a78bfa",   // smart money
  butter:   "#fcd34d",   // value / neutral
  peach:    "#fb923c",   // caution
  shield:   "#60a5fa",   // defensive accent (cooler blue)
};

const OUTLOOK_COLOR = {
  "Bullish":            C.mint,
  "Cautiously Bullish": C.sky,
  "Neutral":            C.butter,
  "Cautious":           C.peach,
  "Bearish":            C.coral,
  "Pending":            C.faint,
};

const CATEGORY_COLOR = {
  growth:    C.mint,
  defensive: C.shield,
  value:     C.butter,
  income:    C.lavender,
};

const RANK_COLORS = ["#e8b86b", "#c0c0cc", "#d4a574", C.mint, C.sky];

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60)         return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)         return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)         return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)          return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function staleness(iso) {
  if (!iso) return { label: "no data", tone: "muted" };
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 30)  return { label: "fresh",  tone: "fresh"  };
  if (hours < 80)  return { label: "recent", tone: "recent" };
  return { label: "stale", tone: "stale" };
}

function formatLong(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// ── Atoms ─────────────────────────────────────────────────────────────────────
function Pill({ color = C.muted, children, soft = true, style = {} }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: soft ? `${color}1f` : color,
      color: soft ? color : "#fff",
      border: soft ? `1px solid ${color}33` : "none",
      borderRadius: 999, padding: "3px 10px",
      fontSize: 11, fontWeight: 600, letterSpacing: "0.01em",
      whiteSpace: "nowrap",
      ...style,
    }}>
      {children}
    </span>
  );
}

function Card({ children, accent, style = {}, padded = true }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      padding: padded ? "16px 18px" : 0,
      position: "relative",
      overflow: "hidden",
      boxShadow: "0 1px 2px rgba(28,31,46,0.03), 0 4px 16px rgba(28,31,46,0.04)",
      ...style,
    }}>
      {accent && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${accent}, ${accent}66)`,
        }} />
      )}
      {children}
    </div>
  );
}

function SectionTitle({ children, accent }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 11, color: C.muted, fontWeight: 700,
      letterSpacing: "0.14em", textTransform: "uppercase",
      marginBottom: 12,
    }}>
      {accent && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: accent,
        }} />
      )}
      <span>{children}</span>
    </div>
  );
}

// ── Halo brand mark (SVG ring with soft glow) ─────────────────────────────────
function HaloMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <radialGradient id="halo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor={C.haloSoft} stopOpacity="0" />
          <stop offset="80%" stopColor={C.haloSoft} stopOpacity="0.55" />
          <stop offset="100%" stopColor={C.haloSoft} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="halo-ring" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"  stopColor={C.haloDeep} />
          <stop offset="60%" stopColor={C.halo} />
          <stop offset="100%" stopColor={C.haloSoft} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#halo-glow)" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="url(#halo-ring)" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="2.2" fill={C.halo} />
    </svg>
  );
}

// ── Status row: freshness + cycle phase ───────────────────────────────────────
function StatusRow({ data, connected }) {
  if (!connected) {
    return (
      <div style={{ padding: "8px 0 12px" }}>
        <Pill color={C.coral}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", background: C.coral,
          }} />
          offline
        </Pill>
      </div>
    );
  }

  const generated = data?.generatedAt || data?.metadata?.generatedAt;
  const fresh = staleness(generated);
  const tone =
    fresh.tone === "fresh"  ? C.mint :
    fresh.tone === "recent" ? C.butter :
                              C.faint;

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 0 12px", flexWrap: "wrap" }}>
      <Pill color={tone}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: tone,
          animation: fresh.tone === "fresh" ? "pulse 2.4s infinite" : "none",
        }} />
        updated {relativeTime(generated)}
      </Pill>

      {data?.dailyCycleLabel && (
        <Pill color={C.halo}>
          {data.dailyCycleLabel} · {data.dailyCycleTimeET}
        </Pill>
      )}

      {data?.defensiveScore != null && (
        <Pill color={C.shield}>
          shield {data.defensiveScore}/10
        </Pill>
      )}
    </div>
  );
}

// ── Pick card ─────────────────────────────────────────────────────────────────
const CONVICTION_COLOR = {
  high:        "#0f9d6c",
  medium:      "#d4a574",
  speculative: "#a78bfa",
};

function PickCard({ pick }) {
  const [expanded, setExpanded] = useState(false);
  const isDefensive = pick.category === "defensive";
  const accent = isDefensive ? C.shield : (RANK_COLORS[pick.rank - 1] || C.halo);
  const catColor = CATEGORY_COLOR[pick.category] || C.muted;
  const convictionColor = CONVICTION_COLOR[pick.conviction] || C.muted;
  const hasDetails = pick.catalyst || pick.entryNote || pick.exitTrigger || pick.keyRisk;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 22,
      padding: "18px 18px 16px",
      marginBottom: 12,
      boxShadow: "0 1px 2px rgba(28,31,46,0.03), 0 6px 20px rgba(28,31,46,0.05)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Soft accent corner glow */}
      <div style={{
        position: "absolute", top: -40, right: -40, width: 120, height: 120,
        background: `radial-gradient(circle, ${accent}26 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 14,
          background: `linear-gradient(135deg, ${accent}33, ${accent}15)`,
          border: `1px solid ${accent}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, color: accent, fontSize: 15, flexShrink: 0,
        }}>
          {isDefensive ? "✦" : pick.rank}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 24, fontWeight: 800, color: C.ink,
            letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: 2,
          }}>
            {pick.ticker}
          </div>
          <div style={{
            fontSize: 12.5, color: C.muted, lineHeight: 1.4,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {pick.name}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
          <Pill color={accent} soft={false} style={{ fontWeight: 700 }}>
            {pick.score}
          </Pill>
          {pick.suggestedWeight != null && (
            <Pill color={C.halo}>{pick.suggestedWeight}%</Pill>
          )}
        </div>
      </div>

      {/* Meta chips */}
      <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
        {pick.sector && <Pill color={C.muted}>{pick.sector}</Pill>}
        {pick.horizon && <Pill color={C.halo}>{pick.horizon}</Pill>}
        {pick.category && <Pill color={catColor}>{pick.category}</Pill>}
        {pick.conviction && (
          <Pill color={convictionColor} soft={false} style={{ fontWeight: 700 }}>
            {pick.conviction}
          </Pill>
        )}
        {pick.smartMoneyBacking && <Pill color={C.lavender}>✦ smart $</Pill>}
      </div>

      {/* Rationale */}
      <p style={{
        color: C.text, fontSize: 13.5, lineHeight: 1.65, margin: "0 0 10px",
      }}>
        {pick.rationale}
      </p>

      {/* Inline catalyst preview (always visible — most important field for timing) */}
      {pick.catalyst && (
        <div style={{
          background: `${C.halo}0f`, border: `1px solid ${C.halo}33`,
          borderRadius: 12, padding: "8px 11px", marginBottom: 10,
        }}>
          <div style={{ fontSize: 9.5, color: C.haloDeep, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 3 }}>
            ✦ CATALYST{pick.catalystWindow ? ` · ${pick.catalystWindow}` : ""}
          </div>
          <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.5 }}>
            {pick.catalyst}
          </div>
        </div>
      )}

      {/* Details disclosure — entry, exit, risk */}
      {hasDetails && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: C.subtle, border: "none", color: C.muted,
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              padding: "6px 11px", borderRadius: 999,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}
          >
            {expanded ? "hide" : "show"} thesis details
          </button>
          {expanded && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {pick.entryNote && (
                <DetailBlock color={C.mint}     label="ENTRY"   text={pick.entryNote} />
              )}
              {pick.exitTrigger && (
                <DetailBlock color={C.peach}    label="EXIT TRIGGER" text={pick.exitTrigger} />
              )}
              {pick.keyRisk && (
                <DetailBlock color={C.coral}    label="KEY RISK"     text={pick.keyRisk} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailBlock({ color, label, text }) {
  return (
    <div style={{
      background: `${color}10`, border: `1px solid ${color}25`,
      borderRadius: 12, padding: "9px 11px",
    }}>
      <div style={{ fontSize: 9.5, color, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.55 }}>
        {text}
      </div>
    </div>
  );
}

// ── Phase detail (Research tab) ───────────────────────────────────────────────
function PhaseDetail({ label, icon, color, content }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", background: C.surface,
          border: `1px solid ${open ? color + "55" : C.border}`,
          borderRadius: 16, padding: "13px 15px",
          display: "flex", alignItems: "center", gap: 11,
          cursor: "pointer", color: C.text, textAlign: "left",
          boxShadow: open ? `0 4px 16px ${color}1a` : "0 1px 2px rgba(28,31,46,0.02)",
          transition: "all 0.18s ease",
        }}
      >
        <span style={{
          width: 30, height: 30, borderRadius: 10,
          background: `${color}1f`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, flexShrink: 0,
        }}>
          {icon}
        </span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: open ? color : C.ink }}>
          {label}
        </span>
        <span style={{ color: C.faint, fontSize: 12 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{
          background: C.subtle, border: `1px solid ${C.border}`,
          borderTop: "none", borderRadius: "0 0 16px 16px",
          padding: "14px 16px",
          marginTop: -8, paddingTop: 18,
        }}>
          <p style={{
            color: C.text, fontSize: 12.5, lineHeight: 1.75,
            whiteSpace: "pre-wrap", margin: 0,
          }}>
            {content.length > 1400 ? content.slice(0, 1400) + "…" : content}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "picks",    label: "picks"    },
  { id: "weekly",   label: "weekly"   },
  { id: "research", label: "research" },
  { id: "about",    label: "about"    },
];

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [tab, setTab]             = useState("picks");
  const [loading, setLoading]     = useState(true);
  const [connected, setConnected] = useState(false);
  const [universe, setUniverse]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/picks.json?t=" + Date.now());
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching /picks.json`);
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
            detail += `\n…${raw.slice(lo, hi).replace(/\s+/g, " ")}…`;
          }
          setError(`Cached picks unparseable\n${detail}`);
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
    async function loadUniverse() {
      try {
        const res = await fetch("/universe.json?t=" + Date.now());
        if (!res.ok) return;
        const u = await res.json();
        if (!cancelled) setUniverse(u);
      } catch { /* non-fatal — About tab will hide universe */ }
    }
    load();
    loadUniverse();
    return () => { cancelled = true; };
  }, []);

  const outlookColor = data ? (OUTLOOK_COLOR[data.macroOutlook] || C.faint) : C.faint;
  const weeklyData   = data?.weeklyReport;
  const universeSize = universe?.groups?.reduce((acc, g) => acc + g.tickers.length, 0) ?? null;

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", color: C.text,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'DM Sans', system-ui, sans-serif",
      maxWidth: 480, margin: "0 auto",
      paddingBottom: 80,
    }}>
      <style>{`
        button { font-family: inherit; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes pulse   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.85)} }
        @keyframes haloFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      `}</style>

      {/* ── Sticky Header ── */}
      <div style={{
        background: `${C.bg}d9`,
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: `1px solid ${C.hairline}`,
        padding: "env(safe-area-inset-top, 0px) 22px 0",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ animation: "haloFloat 4s ease-in-out infinite" }}>
              <HaloMark size={30} />
            </div>
            <div>
              <div style={{
                fontSize: 22, fontWeight: 800, color: C.ink,
                letterSpacing: "-0.04em", lineHeight: 1,
              }}>
                halo
              </div>
              <div style={{
                fontSize: 9.5, color: C.muted, letterSpacing: "0.18em",
                fontWeight: 600, marginTop: 3, textTransform: "uppercase",
              }}>
                ai market intelligence
              </div>
            </div>
          </div>
          {data?.macroOutlook && data.macroOutlook !== "Pending" && (
            <Pill color={outlookColor} soft={false} style={{ padding: "4px 12px" }}>
              {data.macroOutlook}
            </Pill>
          )}
        </div>

        <StatusRow data={data} connected={connected} />

        {/* Pill tab bar (segmented control style) */}
        <div style={{
          display: "flex", gap: 4, padding: 4, marginBottom: 10,
          background: C.subtle,
          borderRadius: 14,
        }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex: 1,
                background: active ? C.surface : "transparent",
                border: "none",
                borderRadius: 11,
                padding: "8px 4px",
                cursor: "pointer",
                color: active ? C.ink : C.muted,
                fontWeight: active ? 700 : 500,
                fontSize: 12.5,
                boxShadow: active ? "0 1px 3px rgba(28,31,46,0.08)" : "none",
                transition: "all 0.18s ease",
                letterSpacing: "0.01em",
              }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: "18px 16px", animation: "fadeIn 0.3s ease" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{
              width: 30, height: 30, border: `2.5px solid ${C.halo}`,
              borderTopColor: "transparent", borderRadius: "50%",
              animation: "spin 0.8s linear infinite", margin: "0 auto 14px",
            }} />
            <div style={{ color: C.muted, fontSize: 13 }}>fetching picks…</div>
          </div>
        )}

        {error && (
          <Card accent={C.coral}>
            <div style={{ color: C.coral, fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
              load error
            </div>
            <div style={{
              color: C.muted, fontSize: 12, lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}>
              {error}
            </div>
          </Card>
        )}

        {/* ════════════ PICKS TAB ════════════ */}
        {!loading && !error && tab === "picks" && (
          <>
            <div style={{ marginBottom: 22 }}>
              <div style={{
                fontSize: 17, color: C.ink, fontWeight: 700,
                marginBottom: 4, letterSpacing: "-0.01em",
              }}>
                {data?.todayLabel || "today's picks"}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>
                last refreshed {formatLong(data?.generatedAt || data?.metadata?.generatedAt)}
              </div>
            </div>

            {data?.error && (
              <Card accent={C.coral} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.coral, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
                  RESEARCH CYCLE NOTE
                </div>
                <div style={{ fontSize: 12.5, color: C.text }}>{data.error}</div>
              </Card>
            )}

            {data?.summary && (
              <Card style={{ marginBottom: 22, background: `linear-gradient(135deg, ${C.surface}, ${C.haloSoft}15)` }}>
                <div style={{
                  fontSize: 10.5, color: C.haloDeep, fontWeight: 700,
                  letterSpacing: "0.16em", marginBottom: 8, textTransform: "uppercase",
                }}>
                  ✦ ai synthesis
                </div>
                <p style={{ color: C.ink, fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                  {data.summary}
                </p>
                {data.diversificationNote && (
                  <div style={{
                    marginTop: 12, paddingTop: 12,
                    borderTop: `1px solid ${C.hairline}`,
                    fontSize: 12, color: C.muted, lineHeight: 1.6,
                  }}>
                    <span style={{ color: C.haloDeep, fontWeight: 700 }}>diversification · </span>
                    {data.diversificationNote}
                  </div>
                )}
              </Card>
            )}

            {(!data?.picks || data.picks.length === 0) && (
              <Card style={{ textAlign: "center", padding: "44px 24px" }}>
                <div style={{ marginBottom: 14 }}>
                  <HaloMark size={48} />
                </div>
                <div style={{ fontWeight: 700, color: C.ink, marginBottom: 8, fontSize: 15 }}>
                  awaiting first cycle
                </div>
                <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
                  Halo runs every weekday after the close.{"\n"}
                  Trigger one manually from GitHub → Actions to see picks now.
                </div>
              </Card>
            )}

            {/* Growth/value picks */}
            {data?.picks?.filter(p => p.category !== "defensive").length > 0 && (
              <>
                <SectionTitle accent={C.halo}>
                  top picks · {data.picks.filter(p => p.category !== "defensive").length}
                </SectionTitle>
                {data.picks
                  .filter(p => p.category !== "defensive")
                  .map(p => <PickCard key={p.ticker} pick={p} />)}
              </>
            )}

            {/* Defensive picks */}
            {data?.picks?.filter(p => p.category === "defensive").length > 0 && (
              <div style={{ marginTop: 18 }}>
                <SectionTitle accent={C.shield}>
                  defensive picks
                </SectionTitle>
                <Card accent={C.shield} style={{ marginBottom: 12, padding: "12px 16px" }}>
                  <p style={{ fontSize: 12, color: C.text, margin: 0, lineHeight: 1.6 }}>
                    Shield score {data.defensiveScore}/10 — capital preservation positions for this environment.
                  </p>
                </Card>
                {data.picks
                  .filter(p => p.category === "defensive")
                  .map(p => <PickCard key={p.ticker} pick={p} />)}
              </div>
            )}

            <div style={{
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderRadius: 14, padding: "12px 14px", marginTop: 14,
            }}>
              <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.7 }}>
                <strong style={{ color: C.text }}>Not financial advice.</strong>{" "}
                AI-generated research for informational purposes only. Always do your own due diligence.
              </div>
            </div>
          </>
        )}

        {/* ════════════ WEEKLY TAB ════════════ */}
        {!loading && !error && tab === "weekly" && (
          <>
            {weeklyData ? (
              <>
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 17, color: C.ink, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.01em" }}>
                    {weeklyData.weekOf}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    generated {relativeTime(weeklyData.generatedAt)}
                  </div>
                </div>

                {weeklyData.summary && (
                  <Card style={{ marginBottom: 22, background: `linear-gradient(135deg, ${C.surface}, ${C.haloSoft}15)` }}>
                    <div style={{
                      fontSize: 10.5, color: C.haloDeep, fontWeight: 700,
                      letterSpacing: "0.16em", marginBottom: 8, textTransform: "uppercase",
                    }}>
                      ✦ weekly synthesis
                    </div>
                    <p style={{ color: C.ink, fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                      {weeklyData.summary}
                    </p>
                    {weeklyData.diversificationNote && (
                      <div style={{
                        marginTop: 12, paddingTop: 12,
                        borderTop: `1px solid ${C.hairline}`,
                        fontSize: 12, color: C.muted, lineHeight: 1.6,
                      }}>
                        <span style={{ color: C.haloDeep, fontWeight: 700 }}>diversification · </span>
                        {weeklyData.diversificationNote}
                      </div>
                    )}
                  </Card>
                )}

                <SectionTitle accent={C.halo}>
                  weekly top {weeklyData.picks?.length || 0} picks
                </SectionTitle>
                {weeklyData.picks?.map(p => <PickCard key={p.ticker + "-w"} pick={p} />)}

                {weeklyData.macroOutlook && (
                  <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Pill color={OUTLOOK_COLOR[weeklyData.macroOutlook] || C.faint} soft={false}>
                      {weeklyData.macroOutlook}
                    </Pill>
                    {weeklyData.defensiveScore != null && (
                      <Pill color={C.shield}>shield {weeklyData.defensiveScore}/10</Pill>
                    )}
                  </div>
                )}
              </>
            ) : (
              <Card style={{ textAlign: "center", padding: "44px 24px" }}>
                <div style={{ marginBottom: 14 }}><HaloMark size={48} /></div>
                <div style={{ fontWeight: 700, color: C.ink, marginBottom: 8, fontSize: 15 }}>
                  no weekly report yet
                </div>
                <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
                  Weekly reports are generated every Friday after market close.{"\n"}
                  Daily picks live in the Picks tab.
                </div>
              </Card>
            )}
          </>
        )}

        {/* ════════════ RESEARCH TAB ════════════ */}
        {!loading && !error && tab === "research" && (
          <>
            <div style={{ marginBottom: 18, color: C.muted, fontSize: 13 }}>
              Full research data from the latest cycle.
            </div>
            {[
              { id: "macro",    label: "macro climate",             icon: "🌤", color: C.sky      },
              { id: "sectors",  label: "sector rotation",           icon: "✦",  color: C.halo     },
              { id: "momentum", label: "price & earnings momentum", icon: "↗",  color: C.mint     },
              { id: "smart",    label: "smart money tracking",      icon: "◆",  color: C.lavender },
              { id: "risk",     label: "risk assessment",           icon: "▲",  color: C.coral    },
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
                <HaloMark size={40} />
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  Research data appears here after the first cycle.
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════ ABOUT TAB ════════════ */}
        {tab === "about" && (
          <>
            <SectionTitle accent={C.halo}>how it works</SectionTitle>
            <Card style={{ marginBottom: 16 }}>
              {[
                { icon: "✦", title: "Autonomous research",   desc: "Every weekday after the 4 PM ET close, GitHub Actions runs a 6-phase Claude research cycle with live web search." },
                { icon: "◑", title: "Six phases",             desc: "Macro climate → sector rotation → momentum → smart money → risk → final pick synthesis." },
                { icon: "▢", title: "Defensive layer",        desc: "Halo evaluates whether the macro warrants capital preservation — picks may include bonds (TLT, IEF), gold (GLD), dividend ETFs, utilities, or staples." },
                { icon: "◆", title: "Daily + weekly",         desc: "Daily picks update the Picks tab. Every Friday after the close, Halo writes a formal weekly report to the Weekly tab." },
                { icon: "↗", title: "Trigger manually",       desc: "GitHub repo → Actions → Halo Daily Market Research → Run workflow." },
              ].map((item, i, arr) => (
                <div key={item.title} style={{
                  display: "flex", gap: 12, padding: "12px 0",
                  borderBottom: i < arr.length - 1 ? `1px solid ${C.hairline}` : "none",
                }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: 10,
                    background: `${C.halo}1a`, color: C.haloDeep,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0, fontWeight: 700,
                  }}>
                    {item.icon}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 3 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.65 }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              ))}
            </Card>

            {universe?.groups && (
              <>
                <SectionTitle accent={C.halo}>
                  universe · {universeSize} tickers
                </SectionTitle>
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65, marginBottom: 14 }}>
                    Halo curates picks from this universe across all major sectors.
                  </div>
                  {universe.groups.map(group => (
                    <div key={group.key} style={{ marginBottom: 14 }}>
                      <div style={{
                        fontSize: 10, color: C.muted, fontWeight: 700,
                        letterSpacing: "0.12em", marginBottom: 7, textTransform: "uppercase",
                      }}>
                        {group.label} · {group.tickers.length}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {group.tickers.map(t => (
                          <span key={t} style={{
                            background: C.subtle,
                            color: C.text,
                            border: `1px solid ${C.border}`,
                            borderRadius: 8, padding: "3px 8px",
                            fontSize: 11, fontWeight: 600,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </Card>
              </>
            )}

            <SectionTitle accent={C.halo}>system</SectionTitle>
            <Card>
              {[
                ["schedule",       "weekdays · 22:00 UTC (post-close, year-round)"],
                ["weekly report",  "fridays · after market close"],
                ["model",          "claude sonnet"],
                ["web search",     "live · anthropic tools"],
                ["min hold",       "1 year (ideally 3–5)"],
                ["universe",       universeSize ? `${universeSize} tickers` : "loading…"],
                ["phases",         "6 sequential"],
                ["shield score",   "1–10 auto-adjust"],
              ].map(([k, v], i, arr) => (
                <div key={k} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 0",
                  borderBottom: i < arr.length - 1 ? `1px solid ${C.hairline}` : "none",
                }}>
                  <span style={{ fontSize: 12, color: C.muted }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: C.ink, fontWeight: 600, textAlign: "right", maxWidth: "62%" }}>
                    {v}
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}
      </div>

      <div style={{ height: "env(safe-area-inset-bottom, 20px)" }} />
    </div>
  );
}
