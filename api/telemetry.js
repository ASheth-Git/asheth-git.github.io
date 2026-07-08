/* ================================================================
   VERCEL TELEMETRY ENDPOINT — Upstash Redis backed

   POST /api/telemetry  → count this visitor (once per session,
                          client enforces via sessionStorage) and
                          return aggregated data
   GET  /api/telemetry  → read-only: aggregated counts + caller's
                          geolocation (for the cyan "you are here"
                          dot). Safe to poll — never increments.

   Storage: Upstash Redis hash `visitors:countries` {CC: count}.
   Geolocation: Vercel edge headers (x-vercel-ip-*), with a
   geojs.io fallback for local `vercel dev`.

   Required env vars (auto-injected by the Vercel Marketplace
   Upstash integration):
     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
     (legacy names KV_REST_API_URL / KV_REST_API_TOKEN also work)
   ================================================================ */

const HASH_KEY = "visitors:countries";

const ALLOWED_ORIGINS = [
  "https://asheth.github.io",
  "https://asheth-github-io.vercel.app",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
];

function redisEnv() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return { url, token };

  /* Fallback: derive REST credentials from the TCP connection string
     (rediss://default:PASSWORD@HOST:6379). Upstash's REST endpoint is
     https://HOST and the REST token equals the default-user password. */
  if (process.env.REDIS_URL) {
    try {
      const u = new URL(process.env.REDIS_URL);
      if (u.hostname && u.password) {
        return {
          url: `https://${u.hostname}`,
          token: decodeURIComponent(u.password),
        };
      }
    } catch {
      /* malformed URL — fall through */
    }
  }
  return null;
}

/* Single-command Upstash REST call, e.g. redis(["HGETALL", key]) */
async function redis(cmd) {
  const env = redisEnv();
  if (!env) throw new Error("Redis env vars not configured");
  const res = await fetch(env.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const { result, error } = await res.json();
  if (error) throw new Error(error);
  return result;
}

/* Geolocate the caller. Prefer Vercel's edge headers (no extra
   network hop); fall back to geojs.io when absent (local dev). */
async function geolocate(req) {
  const cc = req.headers["x-vercel-ip-country"];
  if (cc && /^[A-Z]{2}$/i.test(cc)) {
    return {
      country: cc.toUpperCase(),
      lat: parseFloat(req.headers["x-vercel-ip-latitude"]) || 0,
      lon: parseFloat(req.headers["x-vercel-ip-longitude"]) || 0,
    };
  }
  try {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "";
    const r = await fetch(
      `https://get.geojs.io/v1/ip/geo.json${ip ? `?ip=${ip}` : ""}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const g = await r.json();
    const code = (g.country_code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    return {
      country: code,
      lat: parseFloat(g.latitude) || 0,
      lon: parseFloat(g.longitude) || 0,
    };
  } catch {
    return null;
  }
}

/* HGETALL returns a flat [field, value, field, value, ...] array */
function toCountries(flat) {
  const out = [];
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length; i += 2) {
      out.push({ code: flat[i], count: parseInt(flat[i + 1], 10) || 0 });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export default async function handler(req, res) {
  /* CORS — GitHub Pages and the Vercel deployment are different
     origins, so the browser blocks the response without these. */
  const origin = req.headers.origin;
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const geo = await geolocate(req);

    /* POST → register this visit (client sends it once per session) */
    if (req.method === "POST" && geo) {
      await redis(["HINCRBY", HASH_KEY, geo.country, "1"]);
    }

    const flat = await redis(["HGETALL", HASH_KEY]);

    return res.status(200).json({
      countries: toCountries(flat),
      current: geo
        ? { lon: geo.lon, lat: geo.lat, country: geo.country }
        : null,
    });
  } catch (error) {
    console.error("Telemetry error:", error);
    return res
      .status(200)
      .json({ countries: [], current: null, error: error.message });
  }
}
