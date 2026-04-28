# 📈 Autonomous Alpha

An AI-powered stock intelligence system that **automatically researches the market every weekday after market close** and delivers a ranked Top 5 long-term stock picks — all without any manual input.

Built with Claude AI (Anthropic), GitHub Actions, React, and deployable to Vercel for iPhone access as a PWA.

---

## How It Works

```
Every weekday at 21:00 UTC (5 PM ET, after market close)
       ↓
GitHub Actions triggers research.js
       ↓
Claude AI runs 6 research phases with live web search:
  1. 🌍 Macro Climate Analysis
  2. ⚙️  Sector Rotation
  3. 📈 Price & Earnings Momentum
  4. 🧠 Smart Money Tracking
  5. 🛡️  Risk Assessment
  6. 🏆 Top 5 Picks Synthesis
       ↓
Results saved to public/picks.json
       ↓
Git commit pushed automatically
       ↓
Vercel redeploys → iPhone app updates
```

The three "stable" phases (macro, sector rotation, smart money) are cached for
28 hours and only get a quick delta-update on Tue–Fri, cutting search and token
usage by ~60% on most days. A full refresh runs every Sunday (weekly report) and
Monday (weekend gap).

---

## Setup (One Time, ~15 minutes)

### Step 1: Fork / Clone this repo to GitHub

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `autonomous-alpha`
3. Upload all these files (or clone and push)

### Step 2: Add your Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key
2. In your GitHub repo → **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: your API key (starts with `sk-ant-...`)
6. Click **Add secret**

### Step 3: Deploy frontend to Vercel (free)

1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Click **New Project** → Import your `autonomous-alpha` repo
3. Vercel auto-detects Vite → click **Deploy**
4. Your app is live at `https://autonomous-alpha-xxxx.vercel.app`

### Step 4: Add to iPhone Home Screen

1. Open your Vercel URL in **Safari on iPhone**
2. Tap the **Share** button (box with arrow)
3. Scroll down → tap **Add to Home Screen**
4. Name it "Alpha" → tap **Add**

Done! It now lives on your iPhone like a native app. 🎉

---

## Triggering a Manual Run

Don't want to wait for the next market close?

1. Go to your GitHub repo
2. Click **Actions** tab
3. Click **Daily Market Research**
4. Click **Run workflow** → **Run workflow**

Results appear in the app within ~3-5 minutes.

---

## Customizing the Stock Universe

Edit `scripts/research.js` — find the `STOCK_UNIVERSE` array and add/remove tickers as you like.

## Changing the Schedule

Edit `.github/workflows/research.yml`:
```yaml
- cron: '0 21 * * 1-5'   # 21:00 UTC = 5 PM ET, weekdays only
```
Cron format: `minute hour day month weekday`

The pull is once per day. Multiple runs per day waste API credit and create
inconsistent state in `picks.json` if two cycles overlap.

---

## Project Structure

```
autonomous-alpha/
├── .github/
│   └── workflows/
│       └── research.yml          # GitHub Actions schedule (daily)
├── scripts/
│   ├── research.js               # AI research engine (runs in Actions)
│   └── package.json
├── src/
│   ├── App.jsx                   # React frontend
│   └── main.jsx
├── public/
│   ├── picks.json                # Auto-updated daily results
│   └── manifest.json             # PWA config for iPhone
├── reports/                      # Sunday weekly markdown reports
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

---

## Cost Estimate

- **GitHub Actions**: Free (well within free tier — runs once per weekday, ~5 min)
- **Vercel**: Free (static site hosting)
- **Anthropic API**: ~$0.10–0.30 per daily run (6 phases with web search; phase caching cuts cost on Tue–Fri)

Monthly cost: **< $5**

---

## Disclaimer

This system provides AI-generated research for **informational purposes only**. Nothing here constitutes financial advice or a buy/sell recommendation. Always conduct your own due diligence and consult a licensed financial advisor before investing. Investing involves risk of loss.
