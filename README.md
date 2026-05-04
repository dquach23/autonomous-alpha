# ✦ Halo

**AI-powered market intelligence.** Halo automatically researches the market every weekday after the close and delivers a ranked Top 5 long-term picks — no manual input.

Built with Claude AI (Anthropic), GitHub Actions, React, and deployable to Vercel as an iPhone-friendly PWA with a soft Apple-aesthetic UI.

---

## How It Works

```
Every weekday at 22:00 UTC (post-close, year-round)
       ↓
GitHub Actions triggers research.js
       ↓
Claude AI runs 6 phases with live web search:
  1. Macro Climate
  2. Sector Rotation
  3. Price & Earnings Momentum
  4. Smart Money Tracking
  5. Risk Assessment
  6. Top 5 Picks Synthesis
       ↓
Results saved to public/picks.json
       ↓
Auto-commit pushed → Vercel redeploys → app updates
```

The three "stable" phases (macro, sector rotation, smart money) are cached for
28 hours and only get a quick delta-update on Tue–Thu, cutting search and token
usage by ~60% on most days. A full refresh runs every Monday (weekend gap) and
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
  trigger, key risk, plus all 5 phase outputs).

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
- **Anthropic API**: ~$0.10–0.30 per daily run; phase caching cuts cost on Tue–Thu

Monthly cost: **< $5**

---

## Disclaimer

Halo provides AI-generated research for **informational purposes only**. Nothing here
constitutes financial advice. Always conduct your own due diligence and consult a
licensed financial advisor before investing. Investing involves risk of loss.
