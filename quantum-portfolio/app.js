/* ================================================================
   QUANTUM PORTFOLIO — front-end engine
   ----------------------------------------------------------------
   Two modes, one interface:

   DEMO (default, free-hostable):
     Bundled snapshot data and a textbook single-flip simulated
     annealer, so the interface is fully functional in public.
     The demo solver is intentionally generic; it is NOT the
     production algorithm.

   PRODUCTION (private):
     Set CONFIG.backendURL to your solver's endpoint. The GUI then
     POSTs the problem and renders your engine's results and trace.
     Contract (see README.md):
       POST {backendURL}/solve
         body: { tickers, dateFrom, dateTo, params:{K, maxSector, lambda, epochs} }
         resp: { selection:[tickers], trace:[energyPerStep],
                 metrics:{return, vol, sharpe, hhi, maxSector} }
   No calculation code from the production engine lives here.
   ================================================================ */
"use strict";

const CONFIG = {
  backendURL: null,          // e.g. "http://127.0.0.1:8000" for production mode
};

/* ================================================================
   DEMO SNAPSHOT — static, illustrative data (annualized return
   proxies and sector labels). Clearly synthetic: for showcasing
   the interface, not for investment decisions.
   ================================================================ */
const SNAPSHOT = {
  AAPL: { name: "Apple Inc.",             sector: "Technology",        ret: 0.339 },
  TSLA: { name: "Tesla, Inc.",            sector: "Consumer Cyclical", ret: 0.721 },
  MSFT: { name: "Microsoft Corporation",  sector: "Technology",        ret: 0.164 },
  PFE:  { name: "Pfizer, Inc.",           sector: "Healthcare",        ret: -0.032 },
  XOM:  { name: "Exxon Mobil Corporation",sector: "Energy",            ret: 0.085 },
  V:    { name: "Visa Inc.",              sector: "Financial Services",ret: 0.221 },
  JNJ:  { name: "Johnson & Johnson",      sector: "Healthcare",        ret: 0.078 },
  AMZN: { name: "Amazon.com, Inc.",       sector: "Consumer Cyclical", ret: 0.432 },
  JPM:  { name: "JP Morgan Chase & Co.",  sector: "Financial Services",ret: 0.384 },
  NVDA: { name: "Nvidia Corporation",     sector: "Technology",        ret: 0.902 },
};

const PRESETS = {
  balanced:     { K: 5, maxSector: 40,  lambda: 0.5,  epochs: 1000 },
  growth:       { K: 6, maxSector: 60,  lambda: 0.2,  epochs: 1000 },
  conservative: { K: 5, maxSector: 40,  lambda: 0.85, epochs: 1500 },
};

/* deterministic RNG so the demo covariance is reproducible */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* synthetic covariance: sector-block correlation on top of
   individual volatilities scaled with |return| */
function buildCov(tickers) {
  const rng = mulberry32(20240101);
  const n = tickers.length;
  const vol = tickers.map(t => 0.18 + 0.35 * Math.abs(SNAPSHOT[t].ret) + 0.05 * rng());
  const cov = [];
  for (let i = 0; i < n; i++) {
    cov.push(new Array(n));
    for (let j = 0; j < n; j++) {
      if (i === j) { cov[i][j] = vol[i] * vol[i]; continue; }
      const sameSector = SNAPSHOT[tickers[i]].sector === SNAPSHOT[tickers[j]].sector;
      const rho = (sameSector ? 0.55 : 0.22) + 0.1 * (rng() - 0.5);
      cov[i][j] = rho * vol[i] * vol[j];
    }
  }
  /* symmetrize (rng calls above break symmetry) */
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (cov[i][j] + cov[j][i]);
      cov[i][j] = cov[j][i] = v;
    }
  return cov;
}

/* ================================================================
   DEMO SOLVER — textbook simulated annealing on the QUBO
     E(x) = −Σ h_i x_i + λ Σ J_ij x_i x_j
            + A (Σ x_i − K)² + B Σ_sectors max(0, n_s − cap_s)²
   Single-flip Metropolis, geometric cooling. Generic by design.
   ================================================================ */
function demoAnneal(tickers, params, onStep, onDone) {
  const n = tickers.length;
  const cov = buildCov(tickers);
  const h = tickers.map(t => SNAPSHOT[t].ret);
  const { K, lambda, epochs } = params;
  const capCount = Math.max(1, Math.floor((params.maxSector / 100) * K + 1e-9));
  const sectors = tickers.map(t => SNAPSHOT[t].sector);
  const sectorNames = [...new Set(sectors)];
  const A = 0.8, B = 0.8;                    // constraint penalty weights (demo)
  const RISK_SCALE = 5;                      // sets the units of the risk term so
                                             // that lambda spans a visible range
  const rng = mulberry32(Date.now() & 0xffffffff);

  let x = new Array(n).fill(0);
  /* start from a random feasible-ish state: K random picks */
  const order = [...Array(n).keys()].sort(() => rng() - 0.5);
  for (let i = 0; i < Math.min(K, n); i++) x[order[i]] = 1;

  function energy(state) {
    let e = 0, count = 0;
    const perSector = Object.fromEntries(sectorNames.map(s => [s, 0]));
    for (let i = 0; i < n; i++) {
      if (!state[i]) continue;
      count++; perSector[sectors[i]]++;
      e -= h[i];
      for (let j = i + 1; j < n; j++)
        if (state[j]) e += RISK_SCALE * lambda * cov[i][j];
      e += 0.5 * RISK_SCALE * lambda * cov[i][i];
    }
    e += A * (count - K) * (count - K);
    for (const s of sectorNames) {
      const over = perSector[s] - capCount;
      if (over > 0) e += B * over * over;
    }
    return e;
  }

  let E = energy(x);
  let best = { E, x: [...x] };
  let T = 1.0;
  const Tend = 0.005;
  const cool = Math.pow(Tend / T, 1 / epochs);
  let step = 0;
  const trace = [];

  function tick() {
    /* a handful of Metropolis steps per frame keeps the animation legible */
    const perFrame = Math.max(1, Math.round(epochs / 240));
    for (let r = 0; r < perFrame && step < epochs; r++, step++) {
      const i = (rng() * n) | 0;
      x[i] ^= 1;
      const Enew = energy(x);
      const dE = Enew - E;
      if (dE <= 0 || rng() < Math.exp(-dE / T)) {
        E = Enew;
        if (E < best.E) best = { E, x: [...x] };
      } else {
        x[i] ^= 1;                            // reject: undo flip
      }
      T *= cool;
      trace.push(E);
    }
    onStep({ step, epochs, T, E, bestE: best.E, trace });
    if (step < epochs) requestAnimationFrame(tick);
    else onDone({ selection: tickers.filter((_, i) => best.x[i]), trace, cov, tickers });
  }
  requestAnimationFrame(tick);
}

/* ================================================================
   METRICS — equal-weight portfolio over the selected assets
   ================================================================ */
function computeMetrics(selection, cov, tickers) {
  const k = selection.length;
  if (!k) return null;
  const idx = selection.map(t => tickers.indexOf(t));
  const w = 1 / k;
  const ret = selection.reduce((s, t) => s + SNAPSHOT[t].ret, 0) / k;
  let varp = 0;
  for (const i of idx) for (const j of idx) varp += w * w * cov[i][j];
  const vol = Math.sqrt(Math.max(varp, 0));
  const perSector = {};
  for (const t of selection)
    perSector[SNAPSHOT[t].sector] = (perSector[SNAPSHOT[t].sector] || 0) + w;
  const hhi = Object.values(perSector).reduce((s, v) => s + v * v, 0);
  const maxSector = Math.max(...Object.values(perSector));
  return { ret, vol, sharpe: vol > 0 ? ret / vol : 0, hhi, maxSector, perSector };
}

/* ================================================================
   UI
   ================================================================ */
const $ = id => document.getElementById(id);

const ui = {
  kSlider: $("kSlider"), kOut: $("kOut"),
  sectorSlider: $("sectorSlider"), sectorOut: $("sectorOut"),
  lambdaSlider: $("lambdaSlider"), lambdaOut: $("lambdaOut"),
  epochSlider: $("epochSlider"), epochOut: $("epochOut"),
  solveBtn: $("solveBtn"), resetBtn: $("resetBtn"),
  universe: $("universeInput"),
  statusDot: $("statusDot"), statusText: $("statusText"),
  modeBadge: $("modeBadge"), universeNote: $("universeNote"),
  stepOut: $("stepOut"), tempOut: $("tempOut"),
  energyOut: $("energyOut"), bestOut: $("bestOut"),
  scheduleFill: $("scheduleFill"),
  trace: $("traceCanvas"),
  cards: {
    sel: $("mSelected"), ret: $("mReturn"), vol: $("mVol"),
    sharpe: $("mSharpe"), hhi: $("mHHI"), sector: $("mSector"),
  },
  sectorBars: $("sectorBars"), assetRows: $("assetRows"),
};

function bindSlider(slider, out, fmt) {
  const update = () => { out.textContent = fmt(slider.value); };
  slider.addEventListener("input", () => { update(); markCustom(); });
  update();
}
let suppressCustom = false;
function markCustom() {
  if (suppressCustom) return;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  document.querySelector('[data-preset="custom"]').classList.add("active");
}
bindSlider(ui.kSlider, ui.kOut, v => v);
bindSlider(ui.sectorSlider, ui.sectorOut, v => v + "%");
bindSlider(ui.lambdaSlider, ui.lambdaOut, v => parseFloat(v).toFixed(2));
bindSlider(ui.epochSlider, ui.epochOut, v => v);

document.querySelectorAll(".chip").forEach(chip =>
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    const p = PRESETS[chip.dataset.preset];
    if (!p) return;
    suppressCustom = true;
    ui.kSlider.value = p.K;
    ui.sectorSlider.value = p.maxSector;
    ui.lambdaSlider.value = p.lambda;
    ui.epochSlider.value = p.epochs;
    [ui.kSlider, ui.sectorSlider, ui.lambdaSlider, ui.epochSlider]
      .forEach(s => s.dispatchEvent(new Event("input")));
    suppressCustom = false;
  })
);

function setStatus(state, text) {
  ui.statusDot.className = "status-dot" + (state ? " " + state : "");
  ui.statusText.textContent = text;
}

function readParams() {
  return {
    K: parseInt(ui.kSlider.value, 10),
    maxSector: parseInt(ui.sectorSlider.value, 10),
    lambda: parseFloat(ui.lambdaSlider.value),
    epochs: parseInt(ui.epochSlider.value, 10),
  };
}
function readUniverse() {
  return ui.universe.value.split(/[\s,;]+/)
    .map(t => t.trim().toUpperCase())
    .filter(t => t && SNAPSHOT[t]);
}

/* ---------------- trace canvas ---------------- */
function drawTrace(trace) {
  const c = ui.trace, ctx = c.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth * dpr, hgt = c.clientHeight * dpr;
  if (c.width !== w) { c.width = w; c.height = hgt; }
  ctx.clearRect(0, 0, w, hgt);
  if (trace.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const e of trace) { if (e < lo) lo = e; if (e > hi) hi = e; }
  if (hi - lo < 1e-9) hi = lo + 1e-9;
  const pad = 8 * dpr;
  ctx.beginPath();
  const stride = Math.max(1, Math.floor(trace.length / (w / dpr)));
  for (let i = 0, px = 0; i < trace.length; i += stride, px++) {
    const xp = pad + (i / (trace.length - 1)) * (w - 2 * pad);
    const yp = pad + (1 - (trace[i] - lo) / (hi - lo)) * (hgt - 2 * pad);
    i === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
  }
  ctx.strokeStyle = "#2fb8ab";
  ctx.lineWidth = 1.3 * dpr;
  ctx.stroke();
}

/* ---------------- results rendering ---------------- */
function esc(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}
const pct = v => (v * 100).toFixed(2) + "%";

function renderResults(selection, cov, tickers, params) {
  const m = computeMetrics(selection, cov, tickers);
  if (!m) return;
  ui.cards.sel.textContent = selection.length + " / " + tickers.length;
  ui.cards.ret.textContent = pct(m.ret);
  ui.cards.vol.textContent = pct(m.vol);
  ui.cards.sharpe.textContent = m.sharpe.toFixed(2);
  ui.cards.hhi.textContent = (1 - m.hhi).toFixed(2);
  ui.cards.sector.textContent = pct(m.maxSector);
  ui.cards.sector.classList.toggle("warn", m.maxSector * 100 > params.maxSector + 1e-6);

  /* sector bars */
  ui.sectorBars.innerHTML = Object.entries(m.perSector)
    .sort((a, b) => b[1] - a[1])
    .map(([s, wgt]) => `
      <div class="bar-row">
        <div class="bar-label"><b>${esc(s)}</b><span>${pct(wgt)}</span></div>
        <div class="bar-track"><div class="bar-fill${wgt * 100 > params.maxSector + 1e-6 ? " over" : ""}"
             style="width:${Math.min(100, wgt * 100).toFixed(1)}%"></div></div>
      </div>`).join("");

  /* asset table, sorted by return */
  const w = 1 / selection.length;
  ui.assetRows.innerHTML = [...selection]
    .sort((a, b) => SNAPSHOT[b].ret - SNAPSHOT[a].ret)
    .map(t => `
      <tr>
        <td>${esc(t)}</td>
        <td>${esc(SNAPSHOT[t].name)}</td>
        <td><span class="sector-tag">${esc(SNAPSHOT[t].sector)}</span></td>
        <td class="num${SNAPSHOT[t].ret < 0 ? " neg" : ""}">${pct(SNAPSHOT[t].ret)}</td>
        <td class="num">${pct(w)}</td>
      </tr>`).join("");
}

/* ---------------- solve orchestration ---------------- */
let running = false;

async function solve() {
  if (running) return;
  const tickers = readUniverse();
  const params = readParams();
  if (tickers.length < 2) {
    setStatus("", "need at least two known tickers");
    return;
  }
  if (params.K > tickers.length) params.K = tickers.length;

  running = true;
  ui.solveBtn.disabled = true;
  setStatus("running", "annealing");

  if (CONFIG.backendURL) {
    /* PRODUCTION MODE — the GUI only renders; the engine computes */
    try {
      const res = await fetch(CONFIG.backendURL.replace(/\/$/, "") + "/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers,
          dateFrom: $("dateFrom").value,
          dateTo: $("dateTo").value,
          params,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const out = await res.json();
      drawTrace(out.trace || []);
      const cov = buildCov(tickers);      // display-only fallback for metrics
      renderResults(out.selection, cov, tickers, params);
      ui.bestOut.textContent = out.trace ? out.trace[out.trace.length - 1].toFixed(4) : "–";
      ui.scheduleFill.style.width = "100%";
      ui.stepOut.textContent = `${(out.trace || []).length} / ${(out.trace || []).length}`;
      setStatus("done", "ground state optimised");
    } catch (e) {
      setStatus("", "engine unreachable: " + e.message);
    }
    ui.solveBtn.disabled = false;
    running = false;
    return;
  }

  /* DEMO MODE */
  demoAnneal(tickers, params,
    ({ step, epochs, T, E, bestE, trace }) => {
      ui.stepOut.textContent = `${step} / ${epochs}`;
      ui.scheduleFill.style.width = (100 * step / epochs).toFixed(1) + "%";
      ui.tempOut.textContent = T.toFixed(4);
      ui.energyOut.textContent = (E / Math.max(1, params.K)).toFixed(4);
      ui.bestOut.textContent = bestE.toFixed(4);
      drawTrace(trace);
    },
    ({ selection, trace, cov, tickers: tk }) => {
      renderResults(selection, cov, tk, params);
      setStatus("done", "ground state optimised");
      ui.solveBtn.disabled = false;
      running = false;
    });
}

function reset() {
  if (running) return;
  ["sel", "ret", "vol", "sharpe", "hhi", "sector"].forEach(k => { ui.cards[k].textContent = "–"; });
  ui.cards.sector.classList.remove("warn");
  ui.sectorBars.innerHTML = '<p class="empty mono">awaiting solve</p>';
  ui.assetRows.innerHTML = '<tr><td colspan="5" class="empty">awaiting solve</td></tr>';
  ui.scheduleFill.style.width = "0%";
  ui.stepOut.textContent = "0 / 0";
  ui.tempOut.textContent = "–";
  ui.energyOut.textContent = "–";
  ui.bestOut.textContent = "–";
  const ctx = ui.trace.getContext("2d");
  ctx.clearRect(0, 0, ui.trace.width, ui.trace.height);
  setStatus("", "idle");
}

ui.solveBtn.addEventListener("click", solve);
ui.resetBtn.addEventListener("click", reset);

/* mode badge */
if (CONFIG.backendURL) {
  ui.modeBadge.textContent = "production engine";
  ui.modeBadge.classList.add("live");
  ui.universeNote.textContent = "market data resolved by the production engine";
}
setStatus("", "idle");
