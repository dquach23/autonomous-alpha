# ✦ Halo

**AI-powered market intelligence.** Halo automatically researches the market every weekday after the close and delivers a ranked Top 10 long-term picks, a Top 5 defensive picks/ETFs sleeve, and a Top 5 tactical (2–8 week) trades sleeve — no manual input.

Built with Claude AI (Anthropic), GitHub Actions, React, and deployable to Vercel as an iPhone-friendly PWA with a soft Apple-aesthetic UI.

---

## How It Works

```
Every weekday at 22:00 UTC (post-close, year-round)
       ↓
GitHub Actions triggers research.js
       ↓
Local quant engine (scripts/quant.js, free Yahoo Finance data):
  1y of daily closes for the whole universe + SPY →
  relative-strength momentum, trend position (50/200dma),
  RSI, distance from 52w high, realized vol, composite rank
       ↓
Claude AI runs 6 phases, grounded in the quant snapshot + live web search:
  1. Macro Climate
  2. Sector Rotation
  3. Price & Earnings Momentum  (AI ranks WITHIN the quant pre-screen)
  4. Smart Money Tracking
  5. Risk Assessment            (anchored to laggard / extended screens)
  6. Synthesis → Top 10 long-term + 5 Defensive + 5 Tactical (2–8 wk,
     with concrete entry zone / target / stop from real price levels)
       ↓
Results saved to public/picks.json
       ↓
Auto-commit pushed → Vercel redeploys → app updates
```

The quant snapshot is computed locally for free, so the AI spends its web
searches on what price data can't cover (earnings revisions, news, macro,
positioning) instead of hunting for prices — better grounding at lower cost.

The three "stable" phases (macro, sector rotation, smart money) are cached for
28 hours and only get a quick delta-update on Tue–Thu — and those delta checks
run on Claude Haiku (~3x cheaper per token than Sonnet), cutting search and
token usage by ~60% on most days. Full research phases run on Claude Sonnet
with the newer web-search tool (dynamic filtering — more signal per search).
A full refresh runs every Monday (weekend gap) and Friday (weekly report —
end of trading week).

The schedule uses 22:00 UTC so the workflow always fires after the 4 PM ET
close, year-round (avoiding DST drift on a UTC-only cron).

### Memory & continuity

Halo keeps a rolling research memory so picks accumulate context over time
rather than restarting from zero each day:

- [`public/history.json`](public/history.json) holds the last 60 days of picks
  (ticker, rank, conviction, sector, catalyst, outlook, shield score).
- The synthesis prompt receives a digest of the last 7 days. The model is
  explicitly instructed to **maintain thesis continuity** — keep names that are
  still working, only churn for a reason, and call out carry-overs in the
  summary.
- [`reports/daily/YYYY-MM-DD.md`](reports/daily/) archives every successful
  cycle as a permanent markdown brief (full thesis, catalyst, entry note, exit
  trigger, key risk, plus all 5 phase outputs across the growth book and
  defensive sleeve).

This is genuine accumulated knowledge — not just snapshots.

---

## Setup (~15 min, one time)

### 1. Push this repo to GitHub
1. Go to [github.com](https://github.com) → **New repository** → name it `halo`
2. Push these files

### 2. Add your Anthropic API key
1. [console.anthropic.com](https://console.anthropic.com) → API Keys → create
2. GitHub repo → **Settings → Secrets and variables → Actions**
3. **New repository secret** → name `ANTHROPIC_API_KEY` → paste

### 3. Deploy to Vercel
1. [vercel.com](https://vercel.com) → sign in with GitHub
2. **New Project** → import the `halo` repo → **Deploy**
3. Live at `https://halo-xxxx.vercel.app`

### 4. Add to iPhone Home Screen (real-app feel)
1. Open the Vercel URL in **Safari** (not Chrome — Safari is the only iOS browser
   that fully respects PWA manifests).
2. Tap the **Share** button (square with up-arrow at the bottom).
3. Scroll → **Add to Home Screen**.
4. Confirm the name **Halo** → **Add**.

When you launch from the home-screen icon (not the Safari bookmark), Halo runs
**full-screen, no browser chrome**, with its custom splash screen during boot.
That's a real PWA — the experience is much closer to a native app than a Safari
bookmark.

---

## Manual Trigger

GitHub repo → **Actions** → **Halo Daily Market Research** → **Run workflow**.

The workflow exposes a **`force_weekly`** input. Set it to `true` to backfill a
missed Friday weekly report on any day of the week. Results appear in the app
within ~3–5 minutes after a successful run.

---

## Customizing the Universe

Edit [`public/universe.json`](public/universe.json) — the universe is shared between
the research script and the frontend, so changes show up in both immediately.
The universe covers ~170 tickers across 12 groups. Adding tickers is close to
free: the local quant engine pre-ranks the whole universe from Yahoo Finance
data (no API key, no AI tokens) and only the top candidates flow into the AI
prompts, so prompt size — and cost — stays flat as the universe grows.

## Changing the Schedule

Edit [`.github/workflows/research.yml`](.github/workflows/research.yml):
```yaml
- cron: '0 22 * * 1-5'   # 22:00 UTC weekdays = post-close year-round
```

GitHub Actions cron is **always UTC** with no DST awareness. `0 22 * * 1-5`
guarantees the run lands after the 4 PM ET close in both EDT and EST.

---

## Project Structure

```
halo/
├── .github/
│   └── workflows/
│       └── research.yml          # GitHub Actions schedule
├── scripts/
│   ├── research.js               # AI research engine
│   ├── quant.js                  # Local quant engine (free Yahoo data)
│   └── package.json
├── src/
│   ├── App.jsx                   # React frontend (Halo UI)
│   └── main.jsx
├── public/
│   ├── picks.json                # Auto-updated daily results
│   ├── universe.json             # Stock universe (shared with research.js)
│   └── manifest.json             # PWA config
├── reports/                      # Weekly markdown reports (Fridays)
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

---

## Cost

- **GitHub Actions**: free (well within free tier)
- **Vercel**: free (static hosting)
- **Yahoo Finance quant data**: free (no API key)
- **Anthropic API**: ~$0.10–0.30 per daily run. Three levers keep it low:
  - Tue–Thu delta updates run on Claude Haiku (~3x cheaper per token)
  - The local quant snapshot replaces price-hunting web searches
  - The tactical sleeve is generated inside the existing synthesis call
    (no extra API call)

Monthly cost: **< $5**

---

## Disclaimer

Halo provides AI-generated research for **informational purposes only**. Nothing here
constitutes financial advice. Always conduct your own due diligence and consult a
licensed financial advisor before investing. Investing involves risk of loss.
