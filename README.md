# 📈 Autonomous Alpha

An AI-powered stock intelligence system that **automatically researches the market every week** and delivers a ranked Top 5 long-term stock picks — all without any manual input.

Built with Claude AI (Anthropic), GitHub Actions, React, and deployable to Vercel for iPhone access as a PWA.

---

## How It Works

```
Every Sunday 8AM UTC
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

Don't want to wait until Sunday?

1. Go to your GitHub repo
2. Click **Actions** tab
3. Click **Weekly Stock Research**
4. Click **Run workflow** → **Run workflow**

Results appear in the app within ~3-5 minutes.

---

## Customizing the Stock Universe

Edit `scripts/research.js` — find the `STOCK_UNIVERSE` array and add/remove tickers as you like.

## Changing the Schedule

Edit `.github/workflows/weekly-research.yml`:
```yaml
- cron: '0 8 * * 0'   # Every Sunday at 8:00 AM UTC
```
Cron format: `minute hour day month weekday`

---

## Project Structure

```
autonomous-alpha/
├── .github/
│   └── workflows/
│       └── weekly-research.yml   # GitHub Actions schedule
├── scripts/
│   ├── research.js               # AI research engine (runs in Actions)
│   └── package.json
├── src/
│   ├── App.jsx                   # React frontend
│   └── main.jsx
├── public/
│   ├── picks.json                # Auto-updated weekly results
│   └── manifest.json             # PWA config for iPhone
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

---

## Cost Estimate

- **GitHub Actions**: Free (well within free tier — runs once/week, ~5 min)
- **Vercel**: Free (static site hosting)
- **Anthropic API**: ~$0.10–0.30 per weekly run (6 phases with web search)

Monthly cost: **< $2**

---

## Disclaimer

This system provides AI-generated research for **informational purposes only**. Nothing here constitutes financial advice or a buy/sell recommendation. Always conduct your own due diligence and consult a licensed financial advisor before investing. Investing involves risk of loss.
