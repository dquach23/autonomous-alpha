# ✦ Halo

**AI-powered market intelligence.** Halo automatically researches the market every weekday after the close and delivers a ranked Top 10 long-term picks plus a Top 5 defensive picks/ETFs sleeve — no manual input.

Built with Claude AI (Anthropic), GitHub Actions, React, and deployable to Vercel as an iPhone-friendly PWA with a soft Apple-aesthetic UI.

---

## How It Works

```
Every weekday at 22:00 UTC (post-close, year-round)
       ↓
GitHub Actions triggers research.js
       ↓
Factor screen computed locally from real price data (Yahoo Finance, 2y daily):
  volatility-adjusted 12-1M / 6-1M momentum, 52w-high proximity,
  volatility, drawdown, 50/200dma trend + EXTENDED / DOWNTREND / BROKEN flags
       ↓
Track record: the previously published books are scored vs SPY
  (cumulative return, 10-day hit rate, per-holding since-entry return)
       ↓
Research phases (Claude Sonnet 5.5 + live web search, hard search caps):
  1. Macro Climate  2. Sector Rotation  3. Price & Earnings Momentum
  4. Smart Money    5. Risk Assessment
       ↓
Synthesis (Claude Opus 5.5, no web search, schema-constrained JSON):
  Top 10 growth book + 5 defensive, reading the screen + track record
       ↓
Code-level validation: dedupe, 10 + 5 sleeves, conviction caps,
  weights normalized to 100%, sector-cap warnings
       ↓
Results saved to public/picks.json
       ↓
Auto-commit pushed → Vercel redeploys → app updates
```

### Pick quality mechanics

- **Better momentum math.** Momentum is measured 12-1 and 6-1 months (the most
  recent month is skipped because 1-month returns tend to reverse) and divided by
  volatility, so a steady compounder outranks a spike with the same return.
- **Risk flags.** `EXTENDED` (>15% above 50dma or +20% in a month) names are not
  initiated and are excluded from the challenger list; `DOWNTREND` (below 200dma) and
  `BROKEN` (>25% off high) names need an explicit catalyst to be held.
- **Feedback loop.** Every run computes how the published book actually did vs
  SPY. Holdings lagging SPY by 8+ points since entry *and* below their 50/200dma
  are marked ⚠REVIEW and must be exited unless there's new evidence. The track
  record is shown on the Research tab.
- **Calibrated conviction.** At most 3 "high" names in the growth book and 2 in the
  defensive sleeve. Weights are sized by conviction and inverse volatility.
- **Defensive sleeve on data.** Defensive candidates are ranked on momentum, low
  volatility and shallow drawdowns, so the sleeve rotates with the regime instead
  of holding the same five names indefinitely.

### Freshness mechanics (anti-staleness)

Three signals are computed each run and injected into the analysis so picks
respond to the market instead of anchoring on yesterday's list:

- **Quant screen** — real trailing returns and relative strength for every
  universe name, ranked by composite momentum. The momentum phase treats it as
  ground truth instead of re-deriving prices from memory.
- **Holding staleness** — consecutive days each current holding has been in the
  book, plus universe names never picked in the last 30 cycles. Any name held
  15+ days must be re-underwritten with fresh evidence or replaced, and the
  defensive sleeve is re-derived from the current regime daily.
- **Challengers & spotlight** — the highest-momentum names *not* currently held
  must be explicitly evaluated each day (rejections require a data-based
  reason), and a rotating universe group gets extra scrutiny so the whole
  universe is re-examined roughly every two weeks.

The four "stable" phases (macro, sector rotation, smart money, risk) are cached
for 28 hours. On Tue–Thu they are refreshed by **one** combined delta call with a
single web search, so those days make 3 API calls instead of 6. A full refresh runs every Monday (weekend gap) and
Friday (weekly report — end of trading week).

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
- **Anthropic API**: research on Claude Sonnet 5.5 ($2/$10 per MTok, a third
  cheaper than Sonnet 4.6), synthesis on Claude Opus 5.5. Tue–Thu runs make 3 calls
  (1 combined delta, momentum, synthesis); Mon/Fri make 6. Web searches are capped
  per call with `max_uses` and use the dynamic-filtering search tool, which trims
  the tokens search results add. Each run logs its token and search totals,
  which are saved under `metadata.usage` in `picks.json`.
- Models are overridable with the `HALO_RESEARCH_MODEL` / `HALO_SYNTHESIS_MODEL`
  env vars (e.g. set the synthesis to `claude-sonnet-5-5` for the cheapest setup).

Monthly cost: **< $5**

---

## Disclaimer

Halo provides AI-generated research for **informational purposes only**. Nothing here
constitutes financial advice. Always conduct your own due diligence and consult a
licensed financial advisor before investing. Investing involves risk of loss.
