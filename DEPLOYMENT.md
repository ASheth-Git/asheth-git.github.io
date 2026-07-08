# Deployment Guide — Live Telemetry + SEO

The site is split across two hosts by design:

```
GitHub Pages  →  static site (index.html, main.js, style.css, assets)
Vercel        →  /api/telemetry serverless function
Upstash Redis →  persistent visitor counts (via Vercel Marketplace)
```

GitHub Pages cannot run server code or persist data — that is why the
map never updated on Pages alone. The frontend polls the Vercel
endpoint (`TELEMETRY_ENDPOINT` in `main.js`) cross-origin; the endpoint
sets CORS headers to allow `https://asheth-git.github.io`.

---

## Step 1: Connect the repo to Vercel

1. https://vercel.com → **Add New → Project** → import `asheth-git.github.io`
2. Framework preset: **Other**. Deploy.
3. Confirm the deployment URL is `https://asheth-github-io.vercel.app`.
   If Vercel assigns a different URL, update `TELEMETRY_ENDPOINT` in
   `main.js` (line ~912) and `ALLOWED_ORIGINS` in `api/telemetry.js`.

## Step 2: Add Redis storage (Upstash, free tier)

Vercel KV was folded into the Vercel Marketplace — storage is now
provisioned through Upstash:

1. Vercel Dashboard → your project → **Storage** tab
2. **Create Database → Upstash → Redis** (free plan)
3. Connect it to the project. Vercel auto-injects
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
   (the code also accepts legacy `KV_REST_API_*` names).
4. **Redeploy** so the function picks up the env vars.

## Step 3: Verify

- Open `https://asheth-github-io.vercel.app/api/telemetry` — you should
  see JSON with `countries` and `current`.
- Open `https://asheth-git.github.io` with DevTools → Network: the
  `telemetry` request must return 200 with
  `access-control-allow-origin: https://asheth-git.github.io`.
- One `POST` fires per browser session; `GET` polls every 30 s and
  never increments (open a private window to register a fresh hit).

## Step 4: SEO — one-time registration

1. **Google Search Console**: https://search.google.com/search-console
   → add property `asheth-git.github.io` → verify (HTML tag method) →
   submit `https://asheth-git.github.io/sitemap.xml`.
2. **Bing Webmaster Tools** (optional): can import from Search Console.
3. Ranking beyond your own name is driven by content and inbound links
   (publications, ORCID, Google Scholar profile, university page
   linking here) — meta tags are necessary, not sufficient.

## What's already wired

- Google Analytics (`G-48Y9CGCCEE`) in `index.html`
- Canonical URL, Open Graph + Twitter cards, `og-banner.png`
- JSON-LD `Person` structured data
- `sitemap.xml` + `robots.txt` (old `/v1/`, `/v2/` copies excluded to
  avoid duplicate-content dilution)

## Free-tier headroom

- Vercel Hobby: 100k function invocations/month — polling every 30 s
  costs ~2 invocations/min per active visitor; fine at portfolio scale.
- Upstash free: 10k commands/day — same conclusion.
