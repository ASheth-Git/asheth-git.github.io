/* Tests for api/telemetry.js against an in-memory stand-in for the
   Upstash REST pipeline. Run with: npm test  (Node 18+). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler, { _resetForTests, KEYS, toCountries, redisEnv } from "../api/telemetry.js";

const SITE = "https://asheth-git.github.io";

/* ── fake Redis ─────────────────────────────────────────────────── */
let store, fail;
function run([cmd, ...args]) {
  switch (cmd) {
    case "INCR": { const v = (Number(store.get(args[0])) || 0) + 1; store.set(args[0], String(v)); return v; }
    case "EXPIRE": return 1;
    case "SET": {
      const nx = args.includes("NX");
      if (nx && store.has(args[0])) return null;
      store.set(args[0], args[1]); return "OK";
    }
    case "GET": return store.has(args[0]) ? store.get(args[0]) : null;
    case "HINCRBY": {
      const h = store.get(args[0]) || new Map(); store.set(args[0], h);
      const v = (Number(h.get(args[1])) || 0) + Number(args[2]); h.set(args[1], String(v)); return v;
    }
    case "HGETALL": {
      const h = store.get(args[0]); if (!h) return [];
      return [...h.entries()].flat();
    }
    default: throw new Error("unsupported " + cmd);
  }
}
globalThis.fetch = async (url, opts) => {
  if (fail) return { ok: false, status: 500, json: async () => ({}) };
  assert.ok(String(url).endsWith("/pipeline"), "uses the pipeline endpoint");
  const cmds = JSON.parse(opts.body);
  return { ok: true, status: 200, json: async () => cmds.map(c => ({ result: run(c) })) };
};

/* ── fake req/res ───────────────────────────────────────────────── */
function req(method, { origin = SITE, ip = "203.0.113.7", ua = "test-agent", country = "ES" } = {}) {
  const headers = { "user-agent": ua, "x-real-ip": ip, "x-vercel-ip-country": country,
    "x-vercel-ip-latitude": "41.6488226", "x-vercel-ip-longitude": "-0.8890853" };
  if (origin) headers.origin = origin;
  return { method, headers, socket: {} };
}
function res() {
  const r = { statusCode: 0, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
async function call(method, opts) { const r = res(); await handler(req(method, opts), r); return r; }

beforeEach(() => {
  store = new Map(); fail = false; _resetForTests();
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  process.env.VERCEL = "1";
  delete process.env.TELEMETRY_SALT;
});

test("preflight answers 204 with CORS for the site", async () => {
  const r = await call("OPTIONS");
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers["access-control-allow-origin"], SITE);
});

test("other methods are refused", async () => {
  const r = await call("PUT");
  assert.equal(r.statusCode, 405);
  assert.match(r.headers.allow, /GET, POST/);
});

test("writes from a foreign origin or with no origin are refused", async () => {
  assert.equal((await call("POST", { origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await call("POST", { origin: null })).statusCode, 403);
  assert.equal(store.size, 0, "nothing was written");
});

test("a first visit is counted once per day", async () => {
  const a = await call("POST");
  assert.equal(a.statusCode, 200);
  assert.equal(a.body.counted, true);
  assert.deepEqual(a.body.countries, [{ code: "ES", count: 1 }]);
  assert.equal(a.body.total, 1);
  const b = await call("POST");
  assert.equal(b.body.counted, false);
  assert.equal(b.body.total, 1, "repeat visit the same day is not counted");
  const c = await call("POST", { ip: "198.51.100.9", country: "IN" });
  assert.equal(c.body.total, 2);
  assert.deepEqual(c.body.countries.map(x => x.code).sort(), ["ES", "IN"]);
});

test("GET never increments", async () => {
  await call("GET"); await call("GET");
  assert.equal(store.get(KEYS.total), undefined);
});

test("POSTs beyond the per-minute limit get 429", async () => {
  let last;
  for (let i = 0; i < 31; i++) last = await call("POST");
  assert.equal(last.statusCode, 429);
  assert.equal(last.headers["retry-after"], "60");
});

test("no raw IP or user agent is stored", async () => {
  await call("POST", { ip: "192.0.2.55", ua: "very-identifiable-agent" });
  const dump = JSON.stringify([...store.keys()]) + JSON.stringify([...store.values()].map(v => v instanceof Map ? [...v] : v));
  assert.ok(!dump.includes("192.0.2.55"));
  assert.ok(!dump.includes("very-identifiable-agent"));
});

test("location is rounded before it is returned", async () => {
  const r = await call("GET");
  assert.deepEqual(r.body.current, { country: "ES", lat: 41.6, lon: -0.9 });
  assert.equal(r.headers["cache-control"], "private, no-store");
});

test("reads are cached between polls", async () => {
  await call("POST");
  let calls = 0; const real = globalThis.fetch;
  globalThis.fetch = async (...a) => { calls++; return real(...a); };
  await call("GET"); await call("GET");
  globalThis.fetch = real;
  assert.equal(calls, 0, "both GETs served from the cache");
});

test("database failure gives 503 with the usual shape and no internals", async () => {
  fail = true;
  const r = await call("GET");
  assert.equal(r.statusCode, 503);
  assert.deepEqual(r.body, { countries: [], total: 0, current: null, error: "unavailable" });
});

test("helpers", () => {
  assert.deepEqual(toCountries(["ES", "3", "IN", "5", "bad", "9", "FR", "0"]),
    [{ code: "IN", count: 5 }, { code: "ES", count: 3 }]);
  assert.deepEqual(redisEnv({ REDIS_URL: "rediss://default:p%40ss@host.upstash.io:6379" }),
    { url: "https://host.upstash.io", token: "p@ss" });
  assert.deepEqual(redisEnv({ X_KV_REST_API_URL: "https://u", X_KV_REST_API_TOKEN: "t" }), { url: "https://u", token: "t" });
});
