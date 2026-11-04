/* ================================================================
   VISITOR COUNTER — Vercel function backed by Upstash Redis

   GET  /api/telemetry   aggregated counts plus the caller's own
                         approximate location. Never increments.
   POST /api/telemetry   records one visit, then returns the same
                         payload as GET.

   Counting rules
   - One visit per visitor per UTC day. A visitor is identified by a
     salted SHA-256 of (day, IP, user agent); the IP itself is never
     stored, and the hash changes every day, so visits cannot be
     linked across days.
   - POSTs are accepted only from the site's own origins and are
     rate-limited per visitor (RATE_LIMIT per minute).
   - Reads are served from a short in-memory cache, so the page's
     30-second poll does not reach the database on every request.

   Storage (Redis)
     visitors:countries      hash  {CC: count}
     visitors:total          int   all recorded visits
     visitors:seen:<day>:<h> flag  visitor already counted that day (TTL 2 days)
     rl:<h>:<minute>         int   POSTs in that minute (TTL 70 s)

   Environment
     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
       (KV_REST_API_URL / KV_REST_API_TOKEN, a prefixed pair, or
        REDIS_URL are also accepted)
     TELEMETRY_SALT (optional) secret mixed into visitor hashes;
       defaults to a value derived from the Redis token.

   Response shape (unchanged for the front end, with `total` added)
     { countries: [{code, count}], total, current: {country, lat, lon} | null }
   ================================================================ */

import { createHash } from "node:crypto";

export const KEYS = {
  countries: "visitors:countries",
  total: "visitors:total",
  seen: (day, id) => `visitors:seen:${day}:${id}`,
  rate: (id, minute) => `rl:${id}:${minute}`,
};

export const ALLOWED_ORIGINS = [
  "https://asheth-git.github.io",
  "https://asheth-github-io.vercel.app",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:8765",
  "http://127.0.0.1:5500",
];

const RATE_LIMIT = 30;          // POSTs per visitor per minute
const CACHE_MS = 30_000;        // read cache lifetime
const SEEN_TTL_S = 2 * 86_400;  // keep the daily flag past midnight UTC
const COORD_DECIMALS = 1;       // ~11 km: enough for a dot on a world map

let cache = { at: 0, countries: null, total: 0 };
export function _resetForTests() { cache = { at: 0, countries: null, total: 0 }; }

/* ── Redis over Upstash REST ─────────────────────────────────────── */
export function redisEnv(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return { url, token };

  /* Vercel's Upstash integration can prefix the variable names */
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith("KV_REST_API_URL") && value) {
      const pairedToken = env[key.slice(0, -"KV_REST_API_URL".length) + "KV_REST_API_TOKEN"];
      if (pairedToken) return { url: value, token: pairedToken };
    }
  }

  /* rediss://default:PASSWORD@HOST:6379 → REST at https://HOST, token = password */
  if (env.REDIS_URL) {
    try {
      const u = new URL(env.REDIS_URL);
      if (u.hostname && u.password) return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password) };
    } catch { /* malformed: fall through */ }
  }
  return null;
}

/* Several commands in one round trip. Returns the results in order;
   throws if the request fails or any command errors. */
async function pipeline(commands) {
  const env = redisEnv();
  if (!env) throw new Error("Redis is not configured");
  const res = await fetch(`${env.url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const out = await res.json();
  if (!Array.isArray(out)) throw new Error("Unexpected Redis response");
  return out.map((r, i) => {
    if (r && r.error) throw new Error(`Redis command ${commands[i][0]} failed: ${r.error}`);
    return r ? r.result : null;
  });
}

/* ── request facts ───────────────────────────────────────────────── */
function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v || "";
}

export function clientIp(req) {
  return (header(req, "x-real-ip") ||
          header(req, "x-forwarded-for").split(",")[0] ||
          req.socket?.remoteAddress || "").trim();
}

export function visitorId(req, day, salt) {
  return createHash("sha256")
    .update(`${salt}|${day}|${clientIp(req)}|${header(req, "user-agent")}`)
    .digest("hex")
    .slice(0, 24);
}

const round = v => {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  const k = 10 ** COORD_DECIMALS;
  return Math.round(n * k) / k;
};

/* Vercel's edge headers first; geojs.io only outside Vercel (local dev). */
export async function geolocate(req) {
  const cc = header(req, "x-vercel-ip-country").toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) {
    return { country: cc, lat: round(header(req, "x-vercel-ip-latitude")), lon: round(header(req, "x-vercel-ip-longitude")) };
  }
  if (process.env.VERCEL) return null;
  try {
    const ip = clientIp(req);
    const query = ip && !/^(127\.|::1|10\.|192\.168\.)/.test(ip) ? `?ip=${encodeURIComponent(ip)}` : "";
    const r = await fetch(`https://get.geojs.io/v1/ip/geo.json${query}`, { signal: AbortSignal.timeout(3000) });
    const g = await r.json();
    const code = String(g.country_code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    return { country: code, lat: round(g.latitude), lon: round(g.longitude) };
  } catch {
    return null;
  }
}

/* HGETALL returns [field, value, field, value, ...] */
export function toCountries(flat) {
  const out = [];
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const code = String(flat[i]);
      const count = Number.parseInt(flat[i + 1], 10) || 0;
      if (/^[A-Z]{2}$/.test(code) && count > 0) out.push({ code, count });
    }
  }
  return out.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

async function readCounts(force = false) {
  if (!force && cache.countries && Date.now() - cache.at < CACHE_MS) return cache;
  const [flat, total] = await pipeline([["HGETALL", KEYS.countries], ["GET", KEYS.total]]);
  const countries = toCountries(flat);
  const sum = countries.reduce((a, c) => a + c.count, 0);
  cache = { at: Date.now(), countries, total: Math.max(Number.parseInt(total, 10) || 0, sum) };
  return cache;
}

/* ── handler ─────────────────────────────────────────────────────── */
function send(res, status, body, extra = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  const origin = header(req, "origin");
  const allowed = ALLOWED_ORIGINS.includes(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return send(res, 405, { error: "method not allowed" }, { Allow: "GET, POST, OPTIONS" });
  }
  /* writes only from the site itself; a bare script has no Origin */
  if (req.method === "POST" && !allowed) return send(res, 403, { error: "forbidden" });
  if (origin && !allowed) return send(res, 403, { error: "forbidden" });

  try {
    const geo = await geolocate(req);
    let counted = false;

    if (req.method === "POST" && geo) {
      const env = redisEnv();
      const salt = process.env.TELEMETRY_SALT ||
        createHash("sha256").update(`telemetry|${env ? env.token : ""}`).digest("hex");
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const minute = Math.floor(now.getTime() / 60_000);
      const id = visitorId(req, day, salt);

      const [hits, , firstToday] = await pipeline([
        ["INCR", KEYS.rate(id, minute)],
        ["EXPIRE", KEYS.rate(id, minute), "70"],
        ["SET", KEYS.seen(day, id), "1", "NX", "EX", String(SEEN_TTL_S)],
      ]);
      if (Number(hits) > RATE_LIMIT) {
        return send(res, 429, { error: "too many requests" }, { "Retry-After": "60" });
      }
      if (firstToday === "OK") {
        await pipeline([["HINCRBY", KEYS.countries, geo.country, "1"], ["INCR", KEYS.total]]);
        counted = true;
      }
    }

    const { countries, total } = await readCounts(counted);
    return send(res, 200, { countries, total, current: geo, counted });
  } catch (error) {
    console.error("telemetry:", error);
    return send(res, 503, { countries: [], total: 0, current: null, error: "unavailable" });
  }
}
