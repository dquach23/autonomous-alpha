import { useState, useEffect, createContext, useContext, useMemo, useRef } from "react";

// ─── Palettes ────────────────────────────────────────────────────────────────
// Light = "warm" from the design (refined cream + halo gold).
// Dark  = "vivid"  from the design (bold dark fintech with neon-mint accents).
const LIGHT = {
  name: "light",
  bg:       "#faf8f3",
  surface:  "#ffffff",
  surface2: "#f6f1e6",
  subtle:   "#f1ece0",
  ink:      "#1c1f2e",
  text:     "#2a2e42",
  muted:    "#7a7f93",
  faint:    "#a8acbd",
  border:   "#ece6d8",
  hairline: "#f1ece0",
  scrim:    "rgba(28,31,46,0.32)",
  headerBg: "rgba(250,248,243,0.85)",

  primary:     "#d4a574",
  primaryDeep: "#b8895a",
  primarySoft: "#f5d9b3",

  pos:    "#0f9d6c",
  neg:    "#e85a6e",
  warn:   "#e8a948",
  info:   "#5a8fd6",
  purple: "#9079d4",
  shield: "#5a8fd6",

  titleWeight: 800,
  titleTrack:  "-0.025em",
  cardRadius:  22,
};

const DARK = {
  name: "dark",
  bg:       "#0c0d10",
  surface:  "#16181f",
  surface2: "#1d2029",
  subtle:   "#1a1d27",
  ink:      "#ffffff",
  text:     "#e7e7ec",
  muted:    "#8a8e9d",
  faint:    "#5a5d6e",
  border:   "#262a36",
  hairline: "#1d2029",
  scrim:    "rgba(0,0,0,0.55)",
  headerBg: "rgba(12,13,16,0.85)",

  primary:     "#7cf396",
  primaryDeep: "#3ce06a",
  primarySoft: "#7cf39633",

  pos:    "#7cf396",
  neg:    "#ff5f7e",
  warn:   "#ffd166",
  info:   "#69b6ff",
  purple: "#c4a3ff",
  shield: "#69b6ff",

  titleWeight: 800,
  titleTrack:  "-0.03em",
  cardRadius:  18,
};

const ThemeContext = createContext({ palette: DARK, theme: "dark", setTheme: () => {} });
const usePalette = () => useContext(ThemeContext).palette;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLong(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function outlookColor(C, outlook) {
  return ({
    "Bullish":            C.pos,
    "Cautiously Bullish": C.info,
    "Neutral":            C.warn,
    "Cautious":           C.warn,
    "Bearish":            C.neg,
    "Pending":            C.faint,
  })[outlook] || C.faint;
}

// Deterministic sparkline series, biased by score.
function hashStr(s) { let h = 0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i))|0; return Math.abs(h); }
function makeSeries(ticker, score, n = 60) {
  const seed = hashStr(ticker || "");
  const out = [];
  let v = 100;
  const drift = ((score ?? 70) - 70) / 12000;
  for (let i = 0; i < n; i++) {
    const r = Math.sin(seed + i * 1.7) + Math.cos(seed * 0.3 + i * 0.7) * 0.6;
    v = v * (1 + drift + r * 0.004);
    out.push(v);
  }
  return out;
}

// ─── Halo brand mark ─────────────────────────────────────────────────────────
function HaloMark({ size = 24 }) {
  const C = usePalette();
  if (C.name === "dark") {
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, ${C.primary}, ${C.primaryDeep})`,
        boxShadow: `0 0 18px ${C.primary}66, inset 0 0 0 1px ${C.primary}`,
      }} />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <radialGradient id="halo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="50%" stopColor={C.primarySoft} stopOpacity="0" />
          <stop offset="80%" stopColor={C.primarySoft} stopOpacity="0.5" />
          <stop offset="100%" stopColor={C.primarySoft} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="halo-ring" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%"   stopColor={C.primarySoft} />
          <stop offset="40%"  stopColor={C.primary} />
          <stop offset="100%" stopColor={C.primaryDeep} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#halo-glow)" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="url(#halo-ring)" strokeWidth="2.4" />
    </svg>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────
function MoonIcon({ size = 17, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill={color} />
    </svg>
  );
}

function SunIcon({ size = 18, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
      <line x1="12" y1="2"  x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2"  y1="12" x2="4"  y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93"  y1="4.93"  x2="6.34"  y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="4.93"  y1="19.07" x2="6.34"  y2="17.66" />
      <line x1="17.66" y1="6.34"  x2="19.07" y2="4.93" />
    </svg>
  );
}

function InfoIcon({ size = 18, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="11" />
      <circle cx="12" cy="7.5" r="0.8" fill={color} stroke="none" />
    </svg>
  );
}

function CloseIcon({ size = 18, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="6" y1="6"  x2="18" y2="18" />
      <line x1="18" y1="6" x2="6"  y2="18" />
    </svg>
  );
}

function HeaderButton({ onClick, children, label }) {
  const C = usePalette();
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: 34, height: 34, borderRadius: 11,
        background: C.subtle, border: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", color: C.muted,
        WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
      }}
    >
      {children}
    </button>
  );
}

// ─── Animated shield ring (0–10) ────────────────────────────────────────────
function ShieldRing({ value = 0, size = 104, label = "Shield" }) {
  const C = usePalette();
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const dur = 900;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const pct = Math.min(animated / 10, 1);
  const offset = c * (1 - pct);
  const color = animated >= 7 ? C.pos : animated >= 4 ? C.warn : C.neg;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.subtle} strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: "stroke 0.3s" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          fontFamily: "var(--halo-sans)", fontWeight: 800,
          fontSize: size * 0.32, color: C.ink, lineHeight: 1, letterSpacing: "-0.025em",
        }}>
          {animated.toFixed(1)}
        </div>
        <div style={{
          fontFamily: "var(--halo-mono)", fontSize: 9, color: C.muted,
          letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 3,
        }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ─── Conviction dots ────────────────────────────────────────────────────────
function ConvictionDots({ conviction }) {
  const C = usePalette();
  const n = conviction === "high" ? 3 : conviction === "medium" ? 2 : conviction === "speculative" ? 1 : 0;
  const color = conviction === "high" ? C.pos : conviction === "medium" ? C.primary : C.purple;
  if (!n) return null;
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: i < n ? color : C.subtle,
          border: i < n ? "none" : `1px solid ${C.border}`,
        }} />
      ))}
    </div>
  );
}

// ─── Pick row (compact, scannable) ──────────────────────────────────────────
function PickRow({ pick, onClick, period = "day" }) {
  const C = usePalette();
  const series = useMemo(() => makeSeries(pick.ticker, pick.score), [pick.ticker, pick.score]);
  const close = series[series.length - 1];
  const lookback = period === "week" ? Math.min(5, series.length - 1) : 1;
  const prior = series[series.length - 1 - lookback];
  const change = close - prior;
  const changePct = (change / prior) * 100;
  const changeColor = change >= 0 ? C.pos : C.neg;
  const sign = change >= 0 ? "+" : "−";
  const isDefensive = pick.category === "defensive";
  const accent = isDefensive ? C.shield : C.primary;

  return (
    <button onClick={onClick} style={{
      width: "100%", display: "grid",
      gridTemplateColumns: "32px 1fr auto",
      gap: 12, alignItems: "center",
      padding: "12px 12px",
      border: `1px solid ${C.border}`, background: C.surface,
      borderRadius: 14, textAlign: "left",
      cursor: "pointer", WebkitTapHighlightColor: "transparent",
      color: "inherit",
      boxShadow: C.name === "dark"
        ? "0 1px 2px rgba(0,0,0,0.25)"
        : "0 1px 2px rgba(28,31,46,0.03), 0 4px 12px rgba(28,31,46,0.04)",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10,
        background: `${accent}1f`, border: `1px solid ${accent}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--halo-mono)", fontSize: 13, fontWeight: 700,
        color: accent,
      }}>
        {isDefensive ? "✦" : pick.rank}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: 8,
          fontSize: 17, fontWeight: 800, color: C.ink, letterSpacing: "-0.01em",
        }}>
          <span>{pick.ticker}</span>
          <ConvictionDots conviction={pick.conviction} />
          <span style={{
            fontFamily: "var(--halo-mono)", fontSize: 11, fontWeight: 700,
            color: C.muted, letterSpacing: "0.04em",
          }}>
            · {pick.score}
          </span>
        </div>
        <div style={{
          fontSize: 12, color: C.muted, marginTop: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {pick.name}{pick.sector ? <span style={{ color: C.faint }}> · {pick.sector}</span> : null}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 92 }}>
        <div style={{ fontFamily: "var(--halo-mono)", fontSize: 14, fontWeight: 700, color: C.ink }}>
          ${close.toFixed(2)}
        </div>
        <div style={{
          fontFamily: "var(--halo-mono)", fontSize: 10.5, fontWeight: 600,
          color: changeColor, marginTop: 2,
        }}>
          {sign}${Math.abs(change).toFixed(2)} · {sign}{Math.abs(changePct).toFixed(2)}%
        </div>
      </div>
    </button>
  );
}

// ─── Big chart for detail view ──────────────────────────────────────────────
function DetailChart({ ticker, score, height = 180 }) {
  const C = usePalette();
  const series = useMemo(() => makeSeries(ticker, score, 90), [ticker, score]);
  const [hoverIdx, setHoverIdx] = useState(null);
  const trend = series[series.length - 1] - series[0];
  const trendColor = trend >= 0 ? C.pos : C.neg;
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const W = 360, H = height, P = 8;
  const stepX = (W - P*2) / (series.length - 1);
  const pts = series.map((v, i) => [P + i * stepX, P + (H - P*2) - ((v - min) / span) * (H - P*2)]);
  const path = "M" + pts.map(p => p.join(",")).join(" L");
  const areaPath = path + ` L${pts[pts.length-1][0]},${H-P} L${pts[0][0]},${H-P} Z`;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) * (W / rect.width);
    const idx = Math.round((x - P) / stepX);
    if (idx >= 0 && idx < series.length) setHoverIdx(idx);
  };
  const onLeave = () => setHoverIdx(null);

  const hoverPt = hoverIdx != null ? pts[hoverIdx] : null;
  const hoverVal = hoverIdx != null ? series[hoverIdx] : series[series.length - 1];
  const startVal = series[0];
  const hoverTrend = ((hoverVal - startVal) / startVal) * 100;

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: "var(--halo-mono)", fontSize: 22, fontWeight: 800, color: C.ink }}>
            ${hoverVal.toFixed(2)}
          </div>
          <div style={{ fontFamily: "var(--halo-mono)", fontSize: 12, color: trendColor, fontWeight: 600 }}>
            {hoverTrend >= 0 ? "▲" : "▼"} {Math.abs(hoverTrend).toFixed(2)}% · 90d
          </div>
        </div>
        <div style={{ fontFamily: "var(--halo-mono)", fontSize: 10, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          modeled
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block", touchAction: "none" }}
        onMouseMove={onMove} onMouseLeave={onLeave} onTouchMove={onMove} onTouchEnd={onLeave}>
        <defs>
          <linearGradient id={`area-${ticker}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#area-${ticker})`} />
        <path d={path} fill="none" stroke={trendColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {hoverPt && (
          <>
            <line x1={hoverPt[0]} y1={P} x2={hoverPt[0]} y2={H-P} stroke={C.faint} strokeWidth="1" strokeDasharray="2,3" />
            <circle cx={hoverPt[0]} cy={hoverPt[1]} r="5" fill={C.surface} stroke={trendColor} strokeWidth="2" />
          </>
        )}
      </svg>
    </div>
  );
}

// ─── Tag, Stat, Block, SectionLabel ─────────────────────────────────────────
function Tag({ children, color, solid = false }) {
  const C = usePalette();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: solid ? color : `${color}22`,
      color: solid ? (C.name === "dark" ? "#0c0d10" : C.surface) : color,
      border: solid ? "none" : `1px solid ${color}44`,
      borderRadius: 999, padding: "3px 10px",
      fontSize: 11, fontWeight: 700, letterSpacing: "0.01em",
    }}>{children}</span>
  );
}

function Stat({ label, value, accent }) {
  const C = usePalette();
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "10px 12px",
    }}>
      <div style={{ fontFamily: "var(--halo-mono)", fontSize: 9.5, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--halo-mono)", fontSize: 18, fontWeight: 800,
        color: accent || C.ink, marginTop: 2,
      }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children, accent }) {
  const C = usePalette();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: "var(--halo-mono)", fontSize: 10.5, color: C.muted,
      fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase",
      marginBottom: 10,
    }}>
      {accent && <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />}
      <span>{children}</span>
    </div>
  );
}

function Block({ color, label, text }) {
  const C = usePalette();
  return (
    <div style={{
      background: `${color}10`, border: `1px solid ${color}33`,
      borderRadius: 12, padding: "10px 12px",
    }}>
      <div style={{
        fontFamily: "var(--halo-mono)", fontSize: 9.5, color, fontWeight: 700,
        letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.55 }}>
        {text}
      </div>
    </div>
  );
}

// ─── Detail sheet ───────────────────────────────────────────────────────────
function DetailSheet({ pick, onClose }) {
  const C = usePalette();
  useEffect(() => {
    if (!pick) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [pick]);

  if (!pick) return null;

  const isDefensive = pick.category === "defensive";
  const accent = isDefensive ? C.shield : C.primary;
  const convictionColor = pick.conviction === "high" ? C.pos : pick.conviction === "medium" ? C.primary : C.purple;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: C.scrim, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      animation: "fadeBackdrop 0.22s ease",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480, height: "92vh",
        background: C.bg,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        animation: "slideUp 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        overflow: "auto", display: "flex", flexDirection: "column",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.35)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10 }}>
          <div style={{ width: 40, height: 4.5, borderRadius: 4, background: C.border }} />
        </div>

        <div style={{ padding: "14px 20px 8px", display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14,
            background: `${accent}1f`, border: `1px solid ${accent}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, color: accent, fontSize: 16, flexShrink: 0,
          }}>
            {isDefensive ? "✦" : pick.rank}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 28, fontWeight: 800, color: C.ink,
              letterSpacing: C.titleTrack, lineHeight: 1.05,
            }}>
              {pick.ticker}
            </div>
            <div style={{ fontSize: 13.5, color: C.muted, marginTop: 3 }}>
              {pick.name}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, borderRadius: 999, border: "none",
            background: C.subtle, color: C.muted, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
          }}>
            <CloseIcon size={16} color={C.muted} />
          </button>
        </div>

        <div style={{ padding: "0 20px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {pick.sector  && <Tag color={C.muted}>{pick.sector}</Tag>}
          {pick.horizon && <Tag color={C.primary}>{pick.horizon}</Tag>}
          {pick.category && <Tag color={isDefensive ? C.shield : C.pos}>{pick.category}</Tag>}
          {pick.conviction && <Tag color={convictionColor} solid>{pick.conviction}</Tag>}
          {pick.smartMoneyBacking && <Tag color={C.purple}>✦ smart $</Tag>}
        </div>

        <div style={{
          margin: "0 20px 14px", padding: 16,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: C.cardRadius,
        }}>
          <DetailChart ticker={pick.ticker} score={pick.score} />
        </div>

        <div style={{ padding: "0 20px 14px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Stat label="Score"   value={pick.score ?? "—"} accent={accent} />
          <Stat label="Weight"  value={pick.suggestedWeight != null ? `${pick.suggestedWeight}%` : "—"} />
          <Stat label="Horizon" value={pick.horizon || "—"} />
        </div>

        {pick.rationale && (
          <div style={{ padding: "0 20px 14px" }}>
            <SectionLabel>Thesis</SectionLabel>
            <p style={{ color: C.text, fontSize: 14.5, lineHeight: 1.65, margin: 0 }}>
              {pick.rationale}
            </p>
          </div>
        )}

        {pick.catalyst && (
          <div style={{ padding: "0 20px 14px" }}>
            <Block color={C.primary}
                   label={`Catalyst${pick.catalystWindow ? " · " + pick.catalystWindow : ""}`}
                   text={pick.catalyst} />
          </div>
        )}

        <div style={{ padding: "0 20px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {pick.entryNote   && <Block color={C.pos}  label="Entry"        text={pick.entryNote} />}
          {pick.exitTrigger && <Block color={C.warn} label="Exit trigger" text={pick.exitTrigger} />}
          {pick.keyRisk     && <Block color={C.neg}  label="Key risk"     text={pick.keyRisk} />}
        </div>

        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

// ─── Hero card (Picks tab) ──────────────────────────────────────────────────
function HeroCard({ data, growthCount, defCount }) {
  const C = usePalette();
  const [showSummary, setShowSummary] = useState(false);
  const outlook = data?.macroOutlook;
  const oColor = outlookColor(C, outlook);
  const isDark = C.name === "dark";

  return (
    <div style={{
      position: "relative", overflow: "hidden",
      background: isDark
        ? `linear-gradient(135deg, ${C.surface2} 0%, #0f1116 100%)`
        : `linear-gradient(135deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      border: `1px solid ${C.border}`, borderRadius: 18,
      padding: "12px 14px", marginBottom: 14,
      boxShadow: isDark
        ? `0 6px 20px rgba(0,0,0,0.4), inset 0 1px 0 ${C.primary}22`
        : "0 4px 14px rgba(28,31,46,0.05)",
    }}>
      {isDark && (
        <div style={{
          position: "absolute", top: -30, right: -30, width: 120, height: 120,
          background: `radial-gradient(circle, ${oColor}30 0%, transparent 60%)`,
          pointerEvents: "none",
        }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
        <ShieldRing value={data?.defensiveScore ?? 0} size={64} label="Shield" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--halo-mono)", fontSize: 9, color: C.muted,
            letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 3,
          }}>
            Macro outlook
          </div>
          <div style={{
            fontSize: 16, fontWeight: 800, color: C.ink,
            letterSpacing: C.titleTrack, lineHeight: 1.1, marginBottom: 6,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {outlook || "—"}
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <div style={{
              background: `${oColor}1f`, border: `1px solid ${oColor}55`,
              color: oColor, fontFamily: "var(--halo-mono)", fontSize: 9.5,
              fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            }}>
              {growthCount} growth
            </div>
            <div style={{
              background: `${C.shield}1f`, border: `1px solid ${C.shield}55`,
              color: C.shield, fontFamily: "var(--halo-mono)", fontSize: 9.5,
              fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            }}>
              {defCount} defensive
            </div>
          </div>
        </div>
      </div>

      {data?.summary && (
        <button onClick={() => setShowSummary(!showSummary)} style={{
          width: "100%", textAlign: "left", cursor: "pointer",
          background: "transparent", border: "none", color: "inherit",
          marginTop: 10, paddingTop: 10,
          borderTop: `1px solid ${C.hairline}`,
          WebkitTapHighlightColor: "transparent",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{
              fontFamily: "var(--halo-mono)", fontSize: 9.5, color: C.primary,
              letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
            }}>
              ✦ AI Brief
            </div>
            <div style={{ color: C.muted, fontSize: 11, fontFamily: "var(--halo-mono)" }}>
              {showSummary ? "−" : "+"}
            </div>
          </div>
          {showSummary && (
            <div style={{
              marginTop: 8, fontSize: 13, lineHeight: 1.6, color: C.ink,
            }}>
              {data.summary}
            </div>
          )}
          {showSummary && data.diversificationNote && (
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: `1px solid ${C.hairline}`,
              fontSize: 12, color: C.muted, lineHeight: 1.55,
            }}>
              <span style={{ color: C.primary, fontWeight: 700 }}>diversification · </span>
              {data.diversificationNote}
            </div>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Status header (replaces brand bar) ─────────────────────────────────────
function StatusHeader({ tab, data, connected, onTheme, onAbout, theme }) {
  const C = usePalette();
  const isDark = theme === "dark";
  const oColor = connected ? outlookColor(C, data?.macroOutlook) : C.neg;

  const generated = data?.generatedAt || data?.metadata?.generatedAt;
  const fresh = generated ? relativeTime(generated) : "—";
  const dayLabel = data?.todayLabel?.replace(/'s picks?/i, "") || "today";

  const title =
    tab === "picks"    ? "Top picks" :
    tab === "weekly"   ? "Weekly report" :
    tab === "research" ? "Research" : "";

  return (
    <div style={{
      background: C.headerBg,
      backdropFilter: "saturate(180%) blur(20px)",
      WebkitBackdropFilter: "saturate(180%) blur(20px)",
      borderBottom: `1px solid ${C.hairline}`,
      padding: "env(safe-area-inset-top, 0px) 18px 14px",
      position: "sticky", top: 0, zIndex: 100,
    }}>
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 12, paddingTop: 14,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--halo-mono)", fontSize: 10, color: C.muted,
            letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4,
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          }}>
            <HaloMark size={14} />
            <span>{dayLabel} · updated {fresh}</span>
          </div>
          <div style={{
            fontSize: 28, fontWeight: 800, color: C.ink,
            letterSpacing: C.titleTrack, lineHeight: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {title}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: C.subtle, border: `1px solid ${C.border}`,
            borderRadius: 999, padding: "5px 10px 5px 8px",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", background: oColor,
              boxShadow: isDark ? `0 0 10px ${oColor}` : "none",
              animation: "pulse 2s infinite",
            }} />
            <div style={{
              fontFamily: "var(--halo-mono)", fontSize: 10, color: C.text,
              fontWeight: 700, letterSpacing: "0.04em",
            }}>
              {connected ? "live" : "off"}
            </div>
          </div>
          <HeaderButton onClick={onTheme} label={isDark ? "Light mode" : "Dark mode"}>
            {isDark ? <SunIcon size={17} color={C.primary} /> : <MoonIcon size={16} color={C.muted} />}
          </HeaderButton>
          <HeaderButton onClick={onAbout} label="About Halo">
            <InfoIcon size={17} color={C.muted} />
          </HeaderButton>
        </div>
      </div>
    </div>
  );
}

// ─── Floating glass bottom nav ──────────────────────────────────────────────
const TABS = [
  { id: "picks",    label: "Picks",    icon: "◉" },
  { id: "weekly",   label: "Weekly",   icon: "◆" },
  { id: "research", label: "Research", icon: "▦" },
];

function BottomNav({ tab, setTab }) {
  const C = usePalette();
  const isDark = C.name === "dark";
  return (
    <div style={{
      position: "fixed", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
      left: "50%", transform: "translateX(-50%)", zIndex: 200,
      background: isDark ? "rgba(22,24,31,0.78)" : "rgba(255,255,255,0.85)",
      backdropFilter: "saturate(180%) blur(24px)",
      WebkitBackdropFilter: "saturate(180%) blur(24px)",
      border: `1px solid ${isDark ? "#2a2e3a" : C.border}`,
      borderRadius: 999, padding: 5, display: "flex", gap: 4,
      boxShadow: isDark
        ? "0 8px 32px rgba(0,0,0,0.5)"
        : "0 8px 24px rgba(28,31,46,0.12)",
    }}>
      {TABS.map(t => {
        const active = tab === t.id;
        const activeColor = t.id === "weekly" ? C.shield : C.primary;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            border: "none", cursor: "pointer",
            background: active ? `${activeColor}22` : "transparent",
            color: active ? activeColor : C.muted,
            padding: "8px 14px", borderRadius: 999,
            fontSize: 12, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 6,
            WebkitTapHighlightColor: "transparent",
            transition: "all 0.18s",
          }}>
            <span style={{ fontSize: 12 }}>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonList() {
  const C = usePalette();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{
          height: 64, borderRadius: 14, border: `1px solid ${C.border}`,
          background: `linear-gradient(90deg, ${C.subtle} 0%, ${C.surface2} 50%, ${C.subtle} 100%)`,
          backgroundSize: "400px 100%",
          animation: "shimmer 1.4s infinite linear",
        }} />
      ))}
    </div>
  );
}

// ─── Phase detail (Research) ────────────────────────────────────────────────
function PhaseDetail({ id, label, color, content, open, onToggle }) {
  const C = usePalette();
  if (!content) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={onToggle} style={{
        width: "100%", textAlign: "left", cursor: "pointer", color: "inherit",
        background: C.surface, border: `1px solid ${open ? color + "55" : C.border}`,
        borderRadius: 14, padding: "12px 14px",
        display: "flex", alignItems: "center", gap: 10,
        WebkitTapHighlightColor: "transparent",
        boxShadow: open ? `0 4px 16px ${color}1a` : "none",
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", background: color,
          boxShadow: C.name === "dark" ? `0 0 8px ${color}88` : "none",
        }} />
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.ink }}>
          {label}
        </div>
        <div style={{
          color: C.faint, fontFamily: "var(--halo-mono)", fontSize: 14,
          transform: open ? "rotate(45deg)" : "rotate(0)", transition: "transform 0.2s",
        }}>+</div>
      </button>
      {open && (
        <div style={{
          padding: "12px 14px", background: C.subtle,
          border: `1px solid ${C.border}`, borderTop: "none",
          borderRadius: "0 0 14px 14px", marginTop: -1,
          fontSize: 13, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap",
        }}>
          {content.length > 1400 ? content.slice(0, 1400) + "…" : content}
        </div>
      )}
    </div>
  );
}

// ─── Universe sector group ──────────────────────────────────────────────────
function UniverseGroup({ group }) {
  const C = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", background: "transparent", border: "none",
        padding: "6px 0", cursor: "pointer", textAlign: "left",
        display: "flex", alignItems: "center", gap: 8,
        fontFamily: "var(--halo-mono)", fontSize: 10, color: C.muted, fontWeight: 700,
        letterSpacing: "0.12em", textTransform: "uppercase",
        WebkitTapHighlightColor: "transparent",
      }}>
        <span>{group.label} · {group.tickers.length}</span>
        <span style={{
          marginLeft: "auto", color: C.faint, fontSize: 10,
          transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s",
        }}>▾</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, marginBottom: 6 }}>
          {group.tickers.map(t => (
            <span key={t} style={{
              background: C.subtle, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "3px 8px",
              fontFamily: "var(--halo-mono)", fontSize: 11, fontWeight: 600,
            }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── About sheet ────────────────────────────────────────────────────────────
function AboutSheet({ open, onClose, universe }) {
  const C = usePalette();
  const universeSize = universe?.groups?.reduce((acc, g) => acc + g.tickers.length, 0) ?? null;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: C.scrim, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      animation: "fadeBackdrop 0.22s ease",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480, maxHeight: "92vh",
        background: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        animation: "slideUp 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        display: "flex", flexDirection: "column",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.45)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10 }}>
          <div style={{ width: 40, height: 4.5, borderRadius: 4, background: C.border }} />
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 18px 8px",
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: C.titleTrack }}>
            About Halo
          </div>
          <HeaderButton onClick={onClose} label="Close">
            <CloseIcon color={C.muted} />
          </HeaderButton>
        </div>

        <div style={{ overflow: "auto", padding: "8px 18px env(safe-area-inset-bottom, 24px)" }}>
          <SectionLabel accent={C.primary}>How it works</SectionLabel>
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 18, padding: "4px 16px", marginBottom: 18,
          }}>
            {[
              { icon: "✦", title: "Autonomous research",   desc: "Every weekday after the 4 PM ET close, GitHub Actions runs a 6-phase Claude research cycle with live web search." },
              { icon: "◑", title: "Six phases",             desc: "Macro climate → sector rotation → momentum → smart money → risk → final pick synthesis." },
              { icon: "▢", title: "Defensive sleeve",       desc: "Alongside the top 10 long-term picks, Halo always delivers a top 5 defensive picks/ETFs sleeve — bonds (TLT, IEF), gold (GLD/IAU), dividend/quality ETFs (SCHD, VYM), utilities, or staples — sized by the shield score." },
              { icon: "◆", title: "Daily + weekly",         desc: "Daily picks update the Picks tab. Every Friday after the close, Halo writes a formal weekly report to the Weekly tab." },
              { icon: "◐", title: "Memory",                 desc: "Halo accumulates a 60-day rolling history. The synthesis prompt receives a 7-day digest so picks compound thesis continuity rather than churn." },
              { icon: "↗", title: "Trigger manually",       desc: "GitHub repo → Actions → Halo Daily Market Research → Run workflow. Set force_weekly=true to backfill a missed Friday." },
            ].map((item, i, arr) => (
              <div key={item.title} style={{
                display: "flex", gap: 12, padding: "12px 0",
                borderBottom: i < arr.length - 1 ? `1px solid ${C.hairline}` : "none",
              }}>
                <span style={{
                  width: 30, height: 30, borderRadius: 10,
                  background: `${C.primary}1a`, color: C.primary,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, flexShrink: 0, fontWeight: 700,
                }}>
                  {item.icon}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 3 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {universe?.groups && (
            <>
              <SectionLabel accent={C.primary}>Universe · {universeSize} tickers</SectionLabel>
              <div style={{
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 18, padding: 16, marginBottom: 18,
              }}>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65, marginBottom: 10 }}>
                  Halo curates picks from this universe across all major sectors.
                </div>
                {universe.groups.map(group => (
                  <UniverseGroup key={group.key} group={group} />
                ))}
              </div>
            </>
          )}

          <SectionLabel accent={C.primary}>System</SectionLabel>
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 18, padding: "4px 16px", marginBottom: 24,
          }}>
            {[
              ["schedule",       "weekdays · 22:00 UTC (post-close)"],
              ["weekly report",  "fridays · after market close"],
              ["model",          "claude sonnet"],
              ["web search",     "live · anthropic tools"],
              ["min hold",       "1 year (ideally 3–5)"],
              ["universe",       universeSize ? `${universeSize} tickers` : "loading…"],
              ["phases",         "6 sequential"],
              ["shield score",   "1–10 auto-adjust"],
              ["memory",         "60-day rolling history"],
            ].map(([k, v], i, arr) => (
              <div key={k} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0",
                borderBottom: i < arr.length - 1 ? `1px solid ${C.hairline}` : "none",
              }}>
                <span style={{ fontFamily: "var(--halo-mono)", fontSize: 11, color: C.muted, letterSpacing: "0.04em" }}>{k}</span>
                <span style={{ fontSize: 12.5, color: C.ink, fontWeight: 600, textAlign: "right", maxWidth: "62%" }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App shell ───────────────────────────────────────────────────────────────
function HaloApp() {
  const C = usePalette();
  const { theme, setTheme } = useContext(ThemeContext);
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [tab, setTab]             = useState("picks");
  const [loading, setLoading]     = useState(true);
  const [connected, setConnected] = useState(false);
  const [universe, setUniverse]   = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activePick, setActivePick] = useState(null);
  const [openPhase, setOpenPhase] = useState(null);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [synthesisOpen, setSynthesisOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/picks.json?t=" + Date.now());
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching /picks.json`);
        const raw = await res.text();
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch (parseErr) {
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
        setData(parsed); setConnected(true); setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e.message); setConnected(false); setLoading(false);
      }
    }
    async function loadUniverse() {
      try {
        const res = await fetch("/universe.json?t=" + Date.now());
        if (!res.ok) return;
        const u = await res.json();
        if (!cancelled) setUniverse(u);
      } catch { /* non-fatal */ }
    }
    load();
    loadUniverse();
    return () => { cancelled = true; };
  }, []);

  const weeklyData = data?.weeklyReport;
  const isDark = theme === "dark";
  const growthPicks = (data?.picks || []).filter(p => p.category !== "defensive");
  const defPicks    = (data?.picks || []).filter(p => p.category === "defensive");

  const phases = [
    { id: "macro",    label: "Macro climate",             color: C.info   },
    { id: "sectors",  label: "Sector rotation",           color: C.primary },
    { id: "momentum", label: "Earnings momentum",         color: C.pos    },
    { id: "smart",    label: "Smart money tracking",      color: C.purple },
    { id: "risk",     label: "Risk assessment",           color: C.neg    },
  ];

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", color: C.text,
      fontFamily: "var(--halo-sans)",
      maxWidth: 480, margin: "0 auto",
      paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
      transition: "background 0.25s ease, color 0.25s ease",
    }}>
      <style>{`
        button { font-family: inherit; transition: transform 0.12s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease; }
        button:active { transform: scale(0.98); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
        @keyframes spin         { to{transform:rotate(360deg)} }
        @keyframes pulse        { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideUp      { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes fadeBackdrop { from{opacity:0} to{opacity:1} }
        @keyframes shimmer      { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
        @keyframes tabIn        { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
        }
      `}</style>

      <StatusHeader
        tab={tab} data={data} connected={connected} theme={theme}
        onTheme={() => setTheme(isDark ? "light" : "dark")}
        onAbout={() => setAboutOpen(true)}
      />

      <div style={{ position: "relative", padding: "18px 16px" }}>
        {/* Ambient backdrop glow (dark only) */}
        {isDark && (
          <>
            <div style={{
              position: "absolute", top: -120, right: -80, width: 320, height: 320,
              background: `radial-gradient(circle, ${C.primary}24 0%, transparent 65%)`,
              pointerEvents: "none", zIndex: 0,
            }} />
            <div style={{
              position: "absolute", top: 200, left: -100, width: 260, height: 260,
              background: `radial-gradient(circle, ${C.purple}18 0%, transparent 65%)`,
              pointerEvents: "none", zIndex: 0,
            }} />
          </>
        )}

        <div style={{ position: "relative", zIndex: 1 }}>
          {loading && <SkeletonList />}

          {error && (
            <div style={{
              background: C.surface, border: `1px solid ${C.neg}55`,
              borderRadius: 14, padding: "14px 16px", marginBottom: 14,
              boxShadow: `0 4px 20px ${C.neg}22`,
            }}>
              <div style={{ color: C.neg, fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
                load error
              </div>
              <div style={{
                color: C.muted, fontSize: 12, lineHeight: 1.6,
                whiteSpace: "pre-wrap", fontFamily: "var(--halo-mono)",
              }}>
                {error}
              </div>
            </div>
          )}

          {/* ════════ PICKS ════════ */}
          {!loading && !error && tab === "picks" && (
            <div style={{ animation: "tabIn 0.3s cubic-bezier(0.32, 0.72, 0, 1)" }}>
              <HeroCard data={data} growthCount={growthPicks.length} defCount={defPicks.length} />

              {data?.error && (
                <div style={{
                  background: `${C.neg}10`, border: `1px solid ${C.neg}33`,
                  borderRadius: 12, padding: "10px 12px", marginBottom: 14,
                }}>
                  <div style={{ fontSize: 10, color: C.neg, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 4 }}>
                    RESEARCH CYCLE NOTE
                  </div>
                  <div style={{ fontSize: 12.5, color: C.text }}>{data.error}</div>
                </div>
              )}

              {(!data?.picks || data.picks.length === 0) ? (
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 18, padding: "44px 24px", textAlign: "center",
                }}>
                  <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}><HaloMark size={48} /></div>
                  <div style={{ fontWeight: 700, color: C.ink, marginBottom: 8, fontSize: 15 }}>
                    awaiting first cycle
                  </div>
                  <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-line" }}>
                    {"Halo runs every weekday after the close.\nTrigger one manually from GitHub → Actions to see picks now."}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    padding: "4px 4px 10px",
                  }}>
                    <div style={{
                      fontFamily: "var(--halo-mono)", fontSize: 10.5, color: C.muted,
                      letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
                    }}>
                      ranked picks · {growthPicks.length}
                    </div>
                    <div style={{
                      fontFamily: "var(--halo-mono)", fontSize: 10, color: C.faint,
                      letterSpacing: "0.12em", textTransform: "uppercase",
                    }}>
                      tap for thesis →
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {growthPicks.map(p => (
                      <PickRow key={p.ticker} pick={p} onClick={() => setActivePick(p)} />
                    ))}
                  </div>

                  {defPicks.length > 0 && (
                    <div style={{ marginTop: 22 }}>
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        padding: "4px 4px 10px",
                      }}>
                        <div style={{
                          fontFamily: "var(--halo-mono)", fontSize: 10.5, color: C.muted,
                          letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.shield }} />
                          defensive sleeve · {defPicks.length}
                        </div>
                        {data?.defensiveScore != null && (
                          <div style={{
                            fontFamily: "var(--halo-mono)", fontSize: 10, color: C.shield,
                            fontWeight: 700, letterSpacing: "0.06em",
                          }}>
                            shield {data.defensiveScore}/10
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {defPicks.map(p => (
                          <PickRow key={p.ticker} pick={p} onClick={() => setActivePick(p)} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{
                    marginTop: 18, padding: "10px 14px",
                    background: C.subtle, border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    fontFamily: "var(--halo-mono)", fontSize: 10, color: C.muted, lineHeight: 1.6,
                  }}>
                    <strong style={{ color: C.text }}>Not financial advice.</strong>{" "}
                    AI-generated research for informational purposes only.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ════════ WEEKLY ════════ */}
          {!loading && !error && tab === "weekly" && (
            <div style={{ animation: "tabIn 0.3s cubic-bezier(0.32, 0.72, 0, 1)" }}>
              {weeklyData ? (
                <>
                  <div style={{
                    background: isDark
                      ? `linear-gradient(135deg, ${C.surface2} 0%, #0f1116 100%)`
                      : `linear-gradient(135deg, ${C.surface} 0%, ${C.surface2} 100%)`,
                    border: `1px solid ${C.border}`, borderRadius: 18,
                    marginBottom: 14, overflow: "hidden",
                    boxShadow: isDark
                      ? `0 6px 20px rgba(0,0,0,0.4), inset 0 1px 0 ${C.primary}22`
                      : "0 4px 14px rgba(28,31,46,0.05)",
                  }}>
                    <button onClick={() => setWeeklyOpen(!weeklyOpen)} style={{
                      width: "100%", textAlign: "left", cursor: "pointer", color: "inherit",
                      background: "transparent", border: "none",
                      padding: "12px 14px",
                      display: "flex", alignItems: "center", gap: 10,
                      WebkitTapHighlightColor: "transparent",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: "var(--halo-mono)", fontSize: 9, color: C.primary,
                          letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
                          marginBottom: 3,
                        }}>
                          ✦ week of
                        </div>
                        <div style={{
                          fontSize: 16, fontWeight: 800, color: C.ink,
                          letterSpacing: C.titleTrack, lineHeight: 1.1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {weeklyData.weekOf}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          generated {relativeTime(weeklyData.generatedAt)}
                        </div>
                      </div>
                      <div style={{
                        color: C.muted, fontFamily: "var(--halo-mono)", fontSize: 16,
                        transform: weeklyOpen ? "rotate(45deg)" : "rotate(0)",
                        transition: "transform 0.2s",
                      }}>+</div>
                    </button>

                    {weeklyOpen && (
                      <div style={{ padding: "0 14px 14px" }}>
                        {weeklyData.summary && (
                          <div style={{
                            paddingTop: 12, borderTop: `1px solid ${C.hairline}`,
                            fontSize: 13, lineHeight: 1.6, color: C.ink,
                          }}>
                            {weeklyData.summary}
                          </div>
                        )}
                        {weeklyData.diversificationNote && (
                          <div style={{
                            marginTop: 10, paddingTop: 10,
                            borderTop: `1px solid ${C.hairline}`,
                            fontSize: 12, color: C.muted, lineHeight: 1.55,
                          }}>
                            <span style={{ color: C.primary, fontWeight: 700 }}>diversification · </span>
                            {weeklyData.diversificationNote}
                          </div>
                        )}
                        {(weeklyData.macroOutlook || weeklyData.defensiveScore != null) && (
                          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {weeklyData.macroOutlook && (
                              <Tag color={outlookColor(C, weeklyData.macroOutlook)} solid>
                                {weeklyData.macroOutlook}
                              </Tag>
                            )}
                            {weeklyData.defensiveScore != null && (
                              <Tag color={C.shield}>shield {weeklyData.defensiveScore}/10</Tag>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <SectionLabel accent={C.primary}>
                    weekly top {weeklyData.picks?.length || 0}
                  </SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {weeklyData.picks?.map(p => (
                      <PickRow key={p.ticker + "-w"} pick={p} onClick={() => setActivePick(p)} period="week" />
                    ))}
                  </div>
                </>
              ) : (
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 18, padding: "44px 24px", textAlign: "center",
                }}>
                  <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}><HaloMark size={48} /></div>
                  <div style={{ fontWeight: 700, color: C.ink, marginBottom: 8, fontSize: 15 }}>
                    no weekly report yet
                  </div>
                  <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-line" }}>
                    {"Weekly reports are generated every Friday after market close.\nDaily picks live in the Picks tab."}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════ RESEARCH ════════ */}
          {!loading && !error && tab === "research" && (
            <div style={{ animation: "tabIn 0.3s cubic-bezier(0.32, 0.72, 0, 1)" }}>
              {data?.summary && (
                <div style={{
                  background: isDark
                    ? `linear-gradient(135deg, ${C.surface2} 0%, #0f1116 100%)`
                    : `linear-gradient(135deg, ${C.surface} 0%, ${C.surface2} 100%)`,
                  border: `1px solid ${C.border}`, borderRadius: 14,
                  marginBottom: 14, overflow: "hidden",
                }}>
                  <button onClick={() => setSynthesisOpen(!synthesisOpen)} style={{
                    width: "100%", textAlign: "left", cursor: "pointer", color: "inherit",
                    background: "transparent", border: "none",
                    padding: "12px 14px",
                    display: "flex", alignItems: "center", gap: 10,
                    WebkitTapHighlightColor: "transparent",
                  }}>
                    <div style={{
                      flex: 1, fontFamily: "var(--halo-mono)", fontSize: 10.5,
                      color: C.primary, letterSpacing: "0.18em",
                      textTransform: "uppercase", fontWeight: 700,
                    }}>
                      ✦ ai synthesis
                    </div>
                    <div style={{
                      color: C.muted, fontFamily: "var(--halo-mono)", fontSize: 14,
                      transform: synthesisOpen ? "rotate(45deg)" : "rotate(0)",
                      transition: "transform 0.2s",
                    }}>+</div>
                  </button>
                  {synthesisOpen && (
                    <div style={{ padding: "0 14px 14px" }}>
                      <p style={{
                        color: C.ink, fontSize: 13, lineHeight: 1.65, margin: 0,
                        paddingTop: 12, borderTop: `1px solid ${C.hairline}`,
                      }}>
                        {data.summary}
                      </p>
                      {data.diversificationNote && (
                        <div style={{
                          marginTop: 12, paddingTop: 12,
                          borderTop: `1px solid ${C.hairline}`,
                          fontSize: 12, color: C.muted, lineHeight: 1.6,
                        }}>
                          <span style={{ color: C.primary, fontWeight: 700 }}>diversification · </span>
                          {data.diversificationNote}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: 12, color: C.muted, fontSize: 13 }}>
                Six-phase research from the latest cycle.
              </div>

              {phases.map(ph => (
                <PhaseDetail
                  key={ph.id} id={ph.id} label={ph.label} color={ph.color}
                  content={data?.phaseData?.[ph.id]}
                  open={openPhase === ph.id}
                  onToggle={() => setOpenPhase(openPhase === ph.id ? null : ph.id)}
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
            </div>
          )}
        </div>
      </div>

      <BottomNav tab={tab} setTab={setTab} />
      <DetailSheet pick={activePick} onClose={() => setActivePick(null)} />
      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} universe={universe} />
    </div>
  );
}

// ─── Theme provider + persistence ────────────────────────────────────────────
export default function App() {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage?.getItem("halo-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const setTheme = (t) => {
    setThemeState(t);
    try { window.localStorage?.setItem("halo-theme", t); } catch { /* ignore */ }
  };

  useEffect(() => {
    const palette = theme === "dark" ? DARK : LIGHT;
    const tags = document.querySelectorAll('meta[name="theme-color"]');
    tags.forEach(tag => tag.setAttribute("content", palette.bg));
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = palette.bg;
    document.body.style.backgroundColor = palette.bg;
  }, [theme]);

  const value = useMemo(() => ({
    palette: theme === "dark" ? DARK : LIGHT,
    theme, setTheme,
  }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      <HaloApp />
    </ThemeContext.Provider>
  );
}
