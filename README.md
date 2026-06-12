# Reddit Signal Scanner

Reddit mention velocity scanner with Claude AI regulatory analysis. No API keys required
for scanning — only an Anthropic key for the AI analysis layer.

## Project structure

```
reddit-signal-scanner/
├── index.html        ← The full scanner (single-page app, all logic here)
├── netlify.toml      ← Netlify build config — never needs editing
├── package.json      ← Node version declaration — never needs editing
└── README.md         ← This file — never needs editing
```

**Only `index.html` ever changes.** All future updates are pencil-edit on that one file.

---

## Initial deploy (one-time GitHub + Netlify setup)

### Step 1 — Create a GitHub repo

1. Go to github.com on Safari (desktop mode: tap aA → Request Desktop Website)
2. Tap **+** (top right) → **New repository**
3. Name it `reddit-signal-scanner` (or anything)
4. Set to **Public**, no template, no README checkbox
5. Tap **Create repository**

### Step 2 — Add the four files

For each file, tap **Add file → Create new file**, paste the content, commit.

**File 1: `netlify.toml`** — paste the contents of the netlify.toml from this zip

**File 2: `package.json`** — paste the contents of package.json

**File 3: `README.md`** — paste this file

**File 4: `index.html`** — paste the full index.html (the scanner app)

After all four files are committed, your repo root should show:
```
index.html
netlify.toml
package.json
README.md
```

No subfolders needed — this scanner has no serverless functions.

### Step 3 — Connect Netlify

1. Go to app.netlify.com → **Add new site → Import an existing project → GitHub**
2. Authorize Netlify, select your repo
3. Build settings auto-fill from netlify.toml — don't change anything
4. Tap **Deploy**
5. ~30 seconds → Published with a green dot and a URL

To rename the URL: **Site configuration → Change site name**

---

## Updating the scanner

All future updates = one step:

1. Open your GitHub repo in Safari desktop mode
2. Tap `index.html` → pencil icon (top right of file view)
3. Select all → delete → paste new version
4. Tap **Commit changes** (green button, bottom)
5. Netlify auto-deploys in ~30 seconds

---

## Usage

### Scanning
- Select a **Feed** (All Stocks, WSB, r/stocks, r/investing, r/options, SPACs)
- Set **Min Mentions** threshold (default 3)
- Filter by **Signal type** (All / Spike / Rising / New)
- Tap **▶ SCAN** or press `R`

### Signal types
| Signal | Meaning |
|--------|---------|
| ⚡ SPIKE | Mentions up 200%+ — potential momentum catalyst |
| ↗ RISING | Mentions up 50%+ — building interest |
| ★ NEW | First appearance in data — early detection |
| ◉ WATCH | Active, stable mention rate |
| ↘ FADE | Declining interest |

### AI Analysis
1. Select any ticker from the table
2. Paste your Anthropic API key in the field (stored in your browser only)
3. Tap **▶ Analyse**
4. Claude returns: signal read, regulatory/legal flags, structural risks, INVESTIGATE/WATCH/PASS verdict

### Watchlist
- Type a ticker in the WATCH field + Enter (or tap +)
- Watchlisted tickers are highlighted in the table across scans
- Data persists in browser localStorage

### Keyboard shortcuts
| Key | Action |
|-----|--------|
| R | Run scan |
| ↑ / ↓ | Navigate table rows |
| Escape | Deselect ticker |

---

## Data sources

| Source | What it provides | Cost |
|--------|-----------------|------|
| ApeWisdom API | Ticker mentions, upvotes, 24h change across 50+ subreddits | Free, no key |
| Reddit public JSON | Recent post titles for AI context | Free, no key |
| Anthropic Claude API | AI signal analysis with regulatory framing | Your API key, ~$0.01/analysis |

---

## Notes

- Mention history is stored in localStorage and builds up over time as you run scans
  — the velocity pulse strips get more useful the longer you use the scanner
- Pinned tickers persist across sessions
- The scanner never sends your API key anywhere except Anthropic's API directly
- ApeWisdom refreshes approximately every 30–60 minutes; running scans more
  frequently than that won't produce materially different data

---

*Not financial advice. Educational tool only.*
