# Live Telemetry Setup: Deployment Guide

Your site now has **live-updating visitor telemetry** powered by Vercel KV. Here's how to deploy it.

---

## Step 1: Create Vercel KV Store

1. **Sign up for Vercel** (free) if you haven't: https://vercel.com
2. Go to **Vercel Dashboard** → **Storage** tab
3. Click **Create** → **KV** (Key-Value Store)
4. Name it: `asheth-github-io` (or any name you like)
5. Select region: Default is fine (closest to you is fastest)
6. **Create** and wait ~30 seconds

---

## Step 2: Connect Your GitHub Repo to Vercel

1. In Vercel Dashboard, click **Add New** → **Project**
2. **Import GitHub Project**
3. Find your `asheth.github.io` repo, click **Import**
4. **Framework**: Select `Other` (it's static + serverless)
5. Click **Deploy**

Vercel will automatically:
- Detect the `/api/telemetry.js` function
- Connect your KV store (environment variables auto-configured)
- Deploy both your static site and the function

---

## Step 3: Update Your Domain DNS (if needed)

If your domain currently points to GitHub Pages, update it to point to Vercel:

1. In Vercel project settings → **Domains**
2. Add your domain: `asheth.github.io` or `your-custom-domain.com`
3. Vercel shows DNS records to update
4. Update your registrar's DNS to Vercel's nameservers

**GitHub Pages users:** This is a one-time switch. Your site will now deploy via Vercel's CDN instead of GitHub's.

---

## Step 4: Add Google Analytics (Optional)

1. Go to [Google Analytics 4](https://analytics.google.com)
2. **Create** a new property for your website
3. Copy your **Measurement ID** (looks like: `G-XXXXXXXXXX`)
4. Edit `index.html`, find the GA script placeholder
5. Replace both `YOUR_GA_ID` with your actual ID:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

6. Commit and push to GitHub
7. Vercel redeploys automatically
8. Wait 24 hours for GA to show data

---

## Step 5: Test Live Telemetry

1. After deployment, visit your site
2. Open **DevTools** → **Network** tab
3. Filter for `telemetry`
4. Refresh the page
5. You should see: `GET /api/telemetry` → `200 OK`
6. Response shows: `{countries: [...], current: {lon, lat, country}}`

**Live map should now:**
- Show a cyan dot at your current location
- Show orange dots for all past visitors (scaled by visit count)
- Update every 30 seconds as new visitors arrive

---

## How It Works

```
1. Visitor loads your site
2. Browser calls: GET /api/telemetry
3. Vercel function:
   - Extracts visitor's IP
   - Calls geojs.io to get geolocation
   - Increments country counter in KV
   - Returns: {countries: [...], current: {lat, lon}}
4. Browser renders map with live data
5. Repeats every 30 seconds
```

---

## Free Tier Limits (Plenty for Personal Site)

| Service | Free Limit | Your Usage |
|---------|-----------|-----------|
| Vercel Functions | 150 invocations/month | ~2,880/month (1 every 30s) ✅ |
| Vercel KV | 1 GB storage | ~1 KB (country counts) ✅ |
| geojs.io API | Unlimited | ~1 call/visitor ✅ |
| Google Analytics | Unlimited | Standard tier ✅ |

---

## Troubleshooting

**Map shows no countries?**
- Wait a few minutes for initial data to appear
- Check browser console for errors
- Verify `/api/telemetry` returns valid JSON

**GA not showing data?**
- GA takes 24-48 hours to populate
- Verify Measurement ID is correct in `index.html`
- Check GA dashboard: **Real-time** tab shows within seconds

**Function times out?**
- geojs.io might be slow
- Vercel retries automatically
- Fallback: Returns empty map if service unavailable

---

## Next Steps

- Monitor visitor trends in **GA Dashboard**
- Check live map for geographic patterns
- Customize country colors or dot sizes in `main.js` if desired
- Optional: Add webhooks to notify on visitors from specific regions

---

**That's it!** Your site now has professional-grade live telemetry and analytics. 🚀
