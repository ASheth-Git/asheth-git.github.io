# Live Telemetry System: What Changed

## Overview

Your website now has **real-time live telemetry** powered by Vercel's serverless backend and KV storage. The visitor map updates every 30 seconds with live data.

---

## Files Added

### 1. **`api/telemetry.js`** (New Serverless Function)
- Vercel endpoint that handles all telemetry logic
- Gets visitor IP from request headers
- Calls geojs.io to fetch geolocation (country, coordinates)
- Increments country counter in Vercel KV
- Returns aggregated visitor data to frontend

**Why this approach:**
- Serverless = no server to manage, scales automatically
- KV persistence = data survives across page loads
- geojs.io = free, no API key required
- Fast response times for live map updates

### 2. **`vercel.json`** (New Config File)
- Configures Vercel to serve static site + serverless function
- Maps environment variables for KV store
- Tells Vercel runtime details for the function

### 3. **`package.json`** (New Dependencies)
- Added `@vercel/kv` package (Vercel KV client)
- Minimal dependencies for static site hosting

### 4. **`DEPLOYMENT.md`** (New Guide)
- Step-by-step deployment instructions
- KV store setup
- Domain configuration
- Google Analytics integration
- Troubleshooting guide

---

## Files Modified

### **`main.js`** (Updated Telemetry Function)

**Before:**
- Used external counter API (abacus.jasoncameron.dev)
- Batched reads with rate limiting
- Cached data in localStorage
- Only fetched on page load

**After:**
```javascript
// Simpler, single endpoint call
async function fetchTelemetry() {
  const res = await fetch("/api/telemetry");
  const data = await res.json();
  // Update map with fresh country counts + current visitor location
  countries = data.countries;
  relocate(data.current);
}

// Poll every 30 seconds for live updates
setInterval(fetchTelemetry, 30000);
```

**Benefits:**
- ✅ Eliminates external API dependency
- ✅ Real-time updates every 30 seconds
- ✅ Single fetch per update (simpler)
- ✅ Data persists across visitors in KV

---

### **`index.html`** (Added Google Analytics)

Added GA tracking script in `<head>`:
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=YOUR_GA_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'YOUR_GA_ID');
</script>
```

**Note:** Replace `YOUR_GA_ID` with your actual GA Measurement ID (see DEPLOYMENT.md Step 4)

---

## Architecture

```
GitHub Pages (Static Files)
    ├── index.html
    ├── main.js (updated)
    ├── style.css
    └── assets/

Vercel Serverless (Live Telemetry)
    ├── api/telemetry.js (new)
    │   └── Calls geojs.io for IP geolocation
    │   └── Stores/retrieves counts from KV
    │
    └── Vercel KV Store (Persistence)
        └── telemetry:c-US: 15
        └── telemetry:c-IN: 8
        └── telemetry:c-FR: 3
        └── ...

Google Analytics (Optional)
    └── Separate analytics dashboard
    └── Pageviews, user behavior, geography
```

---

## Key Changes Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Backend** | External API (abacus.jasoncameron.dev) | Vercel Serverless |
| **Storage** | localStorage + rate-limited API reads | Vercel KV (persistent) |
| **Updates** | One-time on page load | Every 30 seconds (live) |
| **Dependencies** | None (external API only) | @vercel/kv |
| **Analytics** | Custom telemetry map only | Map + Google Analytics |

---

## What You Need to Do

1. **Read** `DEPLOYMENT.md` for step-by-step setup
2. **Create KV store** in Vercel (5 minutes)
3. **Connect your GitHub repo** to Vercel (2 minutes)
4. **Add your GA ID** to index.html (1 minute)
5. **Deploy** and test (automatic)

**Total setup time: ~15 minutes**

---

## Free Tier Status ✅

All services used are on free tiers:
- ✅ Vercel Functions (150 invocations/month, you'll use ~2,880)
- ✅ Vercel KV (1 GB, you'll use <1 MB)
- ✅ geojs.io (Unlimited)
- ✅ Google Analytics (Unlimited)

**No credit card charges will occur.**

---

## Next Steps

1. Follow `DEPLOYMENT.md` to deploy
2. Once live, you'll see:
   - Cyan dot at your location on the visitor map
   - Orange dots growing for each country that visits
   - Real-time updates every 30 seconds
   - Full analytics dashboard in Google Analytics

3. Share your site and watch the map fill up in real-time! 🌍
