/* ═══════════════════════════════════════════════════════════════
   ALPESH SHETH — v2 engine
   ---------------------------------------------------------------
   ambient   Brillouin zone of RNiO₂ by absorption through A(k,0)
   plate I   two-band fermiology, draggable E_F, marching squares
   plate II  Lindhard χ₀(q), progressive row-by-row evaluation
   plate III Ising portfolio annealer, graded against enumeration
   plate IV  moiré superlattice, exact primitive cell
   plate V   2D Ising model, checkerboard Metropolis on the GPU
   record    publications / timeline / education / talks
   footer    dot-matrix visitor map (Vercel KV)
   ---------------------------------------------------------------
   Every init is guarded on its own DOM, so index.html and
   app_v2.html share this file and each gets only what it holds.
   ═══════════════════════════════════════════════════════════════ */
"use strict";

/* mulberry32: 32-bit state, uniform on [0,1), no dependence on
   Math.random's implementation-defined sequence */
function makeRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* stable hash of a parameter tuple → a seed, so "same inputs,
   same output" holds across reloads, browsers and machines */
const seedOf = (...parts) => {
  let h = 2166136261 >>> 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const el = id => document.getElementById(id);
const PI = Math.PI;
const fmt = (x, n = 3) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(n);
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SHELL = document.body.classList.contains("app");
const MOBILE = SHELL || matchMedia("(max-width:880px)").matches;
const MONO = n => `${n}px "JetBrains Mono", ui-monospace, monospace`;

/* ══ theme palette, read from the stylesheet so CSS stays the
      single source of truth for colour ══════════════════════════ */
const P = {};
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  ["paper", "panel", "ink", "soft", "hair", "hair-2", "b1", "b2"].forEach(k => {
    P[k === "hair-2" ? "hair2" : k] = cs.getPropertyValue("--" + k).trim();
  });
  P.rgbPaper = toRGB(P.paper);
  P.rgbInk = toRGB(P.ink);
  P.rgbB1 = toRGB(P.b1);
  P.rgbB2 = toRGB(P.b2);
}
function toRGB(c) {
  c = c.trim();
  if (c[0] === "#") {
    const h = c.length === 4
      ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
      : c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0], +m[1], +m[2]];
}
const rgbStr = a => `rgb(${a[0]|0},${a[1]|0},${a[2]|0})`;
const lerpRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
readPalette();

/* redraw hooks registered by each plate; fired on resize + theme flip */
const REDRAW = [];
const redrawAll = () => REDRAW.forEach(f => { try { f(); } catch (e) { console.warn("redraw", e); } });
/* the mobile shell shows one view at a time; hidden canvases measure 0,
   so it re-fires this after a tab change */
window.redrawAll = redrawAll;

/* Root fix for "pane is blank until you resize": every canvas watches
   its own container. Whoever reveals a view — a tab, the carousel, an
   orientation change — the observer fires once the box has a real size,
   so no caller has to know which frame layout lands in. */
const sizeWatch = (() => {
  if (typeof ResizeObserver === "undefined") return () => {};
  const seen = new WeakMap();
  let pending = 0;
  const ro = new ResizeObserver(entries => {
    let dirty = false;
    for (const e of entries) {
      const w = Math.round(e.contentRect.width);
      if (w < 2 || seen.get(e.target) === w) continue;
      seen.set(e.target, w);
      dirty = true;
    }
    /* redrawing sets canvas heights, which resizes the observed box — do
       it on the next frame so the write never lands inside the same
       observation pass that triggered it */
    if (dirty && !pending) pending = requestAnimationFrame(() => { pending = 0; redrawAll(); });
  });
  return node => { if (node) ro.observe(node); };
})();

/* ══ theme toggle ═════════════════════════════════════════════ */

/* The portfolio window is an iframe, i.e. its own document with its own
   <html>, so it hears nothing when this page changes scheme. It is told
   directly. Kept next to the toggle rather than inside initAppLaunch so
   that the two places a scheme can change — the button, and the frame
   asking on arrival — read from one function. */
function publishTheme() {
  const frame = el("appFrame");
  if (!frame || !frame.contentWindow || !frame.getAttribute("src")) return;
  try {
    frame.contentWindow.postMessage(
      { type: "as-theme", theme: document.documentElement.dataset.theme },
      window.location.origin === "null" ? "*" : window.location.origin);
  } catch (e) { /* not loaded yet; it reads localStorage at boot anyway */ }
}
addEventListener("message", e => {
  const f = el("appFrame");
  if (!f || !f.contentWindow || e.source !== f.contentWindow) return;
  if (e.data && e.data.type === "as-theme-request") publishTheme();
});

function initTheme() {
  const btn = el("themeBtn");
  const label = () => {
    if (!btn) return;
    const dark = document.documentElement.dataset.theme === "dark";
    btn.textContent = dark ? "Light" : "Dark";
  };
  label();
  if (!btn) return;
  btn.addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";

    /* A theme flip touches three things that otherwise land at three
       different times: the page background (no transition, snaps), the
       chrome (180ms colour transitions), and the canvases (repainted
       from JS). Left alone they tear — the paper goes dark while the
       plates are still light and the buttons crossfade behind both.
       Suppressing transitions for the duration collapses all three into
       a single paint, which reads as an instant, deliberate switch. */
    root.classList.add("theme-swap");
    root.dataset.theme = next;
    try { localStorage.setItem("as-theme", next); } catch (e) {}
    label();
    readPalette();
    /* synchronous, not rAF: the canvases must carry the new palette in
       the same frame the CSS variables change in */
    redrawAll();
    /* force the style flush while transitions are still off, then hand
       them back a frame later so ordinary hover states keep animating */
    void root.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.remove("theme-swap");
    }));
    publishTheme();
  });
}

/* ══ loader: spin glyphs resolving into the full name ══════════ */
function initLoader() {
  const box = el("loadName");
  if (!box) return;
  const name = "ALPESH SHETH, PhD", glyphs = "↑↓↑↓↕⇅", tick = el("loadTick");
  const cells = [...name].map(ch => {
    const s = document.createElement("span");
    if (ch === " ") s.className = "sp";
    else if (ch === ",") s.className = "pn";
    s.textContent = ch === " " ? "\u00A0" : ch;
    box.appendChild(s);
    return { s, ch };
  });
  if (REDUCE) { el("load").classList.add("done"); return; }
  const rnd = makeRNG(seedOf("loader"));
  /* Driven by elapsed time, not by a tick count: a throttled or
     coalesced timer would otherwise stretch the splash indefinitely and
     hold the page hostage. Progress is a fraction of a fixed 950ms
     budget, and each cell resolves at a fraction of that run — so the
     reveal reads the same on a fast machine and a throttled tab, and
     works for a name of any length. */
  const DUR = 950, N = Math.max(cells.length - 1, 1);
  const settle = () => { cells.forEach(o => { o.s.textContent = o.ch === " " ? "\u00A0" : o.ch; }); };
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min(1, (now - t0) / DUR);
    cells.forEach((o, i) => {
      if (o.ch === " ") return;
      const at = 0.26 + 0.60 * i / N;
      o.s.textContent = p > at ? o.ch : glyphs[(rnd() * glyphs.length) | 0];
    });
    if (tick) tick.innerHTML = "annealing · T/T<sub>c</sub> = " + (3.6 - 2.7 * p).toFixed(2);
    if (p < 1) { requestAnimationFrame(step); return; }
    settle();
    el("load").classList.add("done");
  })(t0);
  /* last resort: if rAF never runs (background tab on open), the splash
     still clears rather than covering the page forever */
  setTimeout(() => {
    if (el("load").classList.contains("done")) return;
    settle();
    el("load").classList.add("done");
  }, DUR + 1200);
}

/* ══ flow animation ═══════════════════════════════════════════ */
function initReveal() {
  /* Scripting is available, so the hidden pre-reveal state may be applied.
     The stylesheet gates it on this class, which means a blocked or broken
     script leaves the page fully legible instead of blank. */
  document.documentElement.classList.add("js");
  document.querySelectorAll(".split").forEach(e => {
    const words = e.textContent.split(" ").filter(w => w.length);
    e.textContent = "";
    words.forEach((word, wi) => {
      const wrap = document.createElement("span");
      wrap.className = "wd";
      for (const c of word) {
        const s = document.createElement("span");
        s.className = "ch";
        s.textContent = c;
        wrap.appendChild(s);
      }
      e.appendChild(wrap);
      if (wi < words.length - 1) {
        const sp = document.createElement("span");
        sp.className = "ch sp";
        sp.innerHTML = "&nbsp;";
        e.appendChild(sp);
      }
    });
    [...e.querySelectorAll(".ch")].forEach((c, i) => c.style.transitionDelay = (i * 22) + "ms");
  });
  const targets = [...document.querySelectorAll(".split,.rise,hr.rule")];
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: .15, rootMargin: "0px 0px -6% 0px" });
  targets.forEach(e => io.observe(e));

  /* Failsafe, the same reasoning as the loader's: if frames are never
     delivered — a background tab, a headless capture, an environment that
     starves rAF — the observer may not report, and the page would stay
     invisible. Anything still unrevealed after a short delay is shown. */
  setTimeout(() => {
    targets.forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.top < innerHeight * 1.2) e.classList.add("in");
    });
  }, 1600);
  /* and before any print, everything is revealed outright */
  const revealAll = () => targets.forEach(e => e.classList.add("in"));
  if (typeof matchMedia === "function") {
    const mq = matchMedia("print");
    if (mq.addEventListener) mq.addEventListener("change", e => { if (e.matches) revealAll(); });
  }
  addEventListener("beforeprint", revealAll);
}

/* ═══════════════════════════════════════════════════════════════
   MODEL — two-band tight binding, t = 0.40 eV
     ε₁ = −2t(cx+cy) + 4t′t·cx·cy         Ni d(x²−y²)
     ε₂ = −1.10t(cx+cy+cz) + 2.45t        rare-earth / d(z²)
     E± = ½(ε₁+ε₂) ± √[¼(ε₁−ε₂)² + V²]
   ε₁(π,0) = −4t′t is a saddle → Lifshitz threshold.
   ε₂(Γ) at kz=0 = −0.34 eV → the pocket opens.
   ═══════════════════════════════════════════════════════════════ */
const T_HOP = 0.40;
const eps2D = (kx, ky, tp) => {
  const cx = Math.cos(kx), cy = Math.cos(ky);
  return [T_HOP * (-2 * (cx + cy) + 4 * tp * cx * cy), T_HOP * (-1.10 * (cx + cy + 1) + 2.45)];
};
function branch2D(kx, ky, tp, V) {
  const [e1, e2] = eps2D(kx, ky, tp);
  const h = .5 * (e1 - e2), m = .5 * (e1 + e2), r = Math.hypot(h, V);
  return [m + r, m - r, .5 + .5 * h / Math.max(r, 1e-9)];
}
const vanHove = tp => T_HOP * (-4 * tp);
const gammaE2 = () => T_HOP * (-1.10 * 3 + 2.45);

function fit(cv, ar) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(260, cv.parentElement.clientWidth);
  /* Height is the stylesheet's to decide: .pane canvas sets it from
     --pane-h so every plate is the same size regardless of which grid
     column it occupies. Read the rendered result rather than recompute
     it, so the clamp() resolves once, in CSS. The aspect ratio survives
     only as a fallback for a canvas the stylesheet does not cover. */
  let h = Math.round(cv.getBoundingClientRect().height);
  if (h < 40) {
    /* Either the stylesheet does not cover this canvas, or the view it
       sits in is display:none and measures zero — in the phone shell
       that is the normal state for four views out of five. The aspect
       ratio sizes the bitmap either way, but an inline height is only
       written when the element is genuinely laid out: writing one while
       hidden would outrank --pane-h permanently and strand the plate at
       the fallback size once its tab is finally opened. */
    h = Math.round(w * ar);
    if (MOBILE) h = Math.min(h, Math.round(innerHeight * 0.42));
    if (cv.parentElement.clientWidth > 0) cv.style.height = h + "px";
  }
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

/* ═══ AMBIENT — absorption rendering of A(k,0) over the 3D BZ ═══
   Beer–Lambert on paper: colour = paper · exp(−∫ Σ_b ρ_b σ_b ds).
   Each band removes a different part of the spectrum, so the d
   sheet reads blue and the rare-earth pocket reads vermilion.
   Order-independent, so no depth-sorting artefacts.
   ══════════════════════════════════════════════════════════════ */
const BZ_VS = `#version 300 es
in vec2 p; void main(){gl_Position=vec4(p,0.,1.);}`;
const BZ_FS = `#version 300 es
precision highp float;
out vec4 frag;
uniform vec2 uRes; uniform vec3 uPaper;
uniform float uMu,uV,uTp,uRot,uEl,uShift,uFade; uniform int uSteps;
const float PI=3.14159265;
vec2 bands(vec3 k){
  float cx=cos(k.x),cy=cos(k.y),cz=cos(k.z);
  float e1=-2.0*(cx+cy)+4.0*uTp*cx*cy-0.16*cz-uMu;
  float e2=-1.10*(cx+cy+cz)+2.45-uMu;
  return vec2(e1,e2);
}
void main(){
  vec2 q=(gl_FragCoord.xy*2.0-uRes)/uRes.y; q.x-=uShift;
  float R=8.7;
  vec3 eye=vec3(sin(uRot)*cos(uEl),sin(uEl),cos(uRot)*cos(uEl))*R;
  vec3 fw=normalize(-eye), rt=normalize(cross(vec3(0.,1.,0.),fw)), up=cross(fw,rt);
  vec3 rd=normalize(fw*2.05+rt*q.x+up*q.y);
  vec3 inv=1.0/rd, t1=(vec3(-PI)-eye)*inv, t2=(vec3(PI)-eye)*inv;
  vec3 lo=min(t1,t2), hi=max(t1,t2);
  float tn=max(max(max(lo.x,lo.y),lo.z),0.0), tf=min(min(hi.x,hi.y),hi.z);
  if(tf<=tn){ frag=vec4(uPaper,1.0); return; }
  float ds=(tf-tn)/float(uSteps);
  float jit=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  float t=tn+ds*jit;
  vec3 SIG_D=vec3(1.00,0.62,0.05);   /* leaves blue      */
  vec3 SIG_R=vec3(0.06,0.55,1.00);   /* leaves vermilion */
  vec3 SIG_W=vec3(0.85,0.85,0.85);   /* neutral wireframe */
  const float eta=0.055;
  vec3 tau=vec3(0.0);
  for(int i=0;i<128;i++){
    if(i>=uSteps) break;
    vec3 k=eye+rd*t;
    vec2 e=bands(k);
    float h=0.5*(e.x-e.y), m=0.5*(e.x+e.y), r=sqrt(h*h+uV*uV);
    float w=0.5+0.5*h/max(r,1e-4);
    float ap=eta*eta/((m+r)*(m+r)+eta*eta);
    float am=eta*eta/((m-r)*(m-r)+eta*eta);
    float rho_d=ap*w+am*(1.0-w);
    float rho_r=ap*(1.0-w)+am*w;
    vec3 d3=vec3(PI)-abs(k);
    float mn=min(d3.x,min(d3.y,d3.z)), mx=max(d3.x,max(d3.y,d3.z));
    float mid=d3.x+d3.y+d3.z-mn-mx;
    float ln=exp(-mid*mid/0.0016);
    tau += (rho_d*SIG_D*2.6 + rho_r*SIG_R*2.6 + ln*SIG_W*0.55)*ds;
    t+=ds;
  }
  /* One spectral model, two schemes. exp(-tau) is the transmitted
     spectrum: on paper it is what remains after absorption, on ink it
     is what the zone emits. Deriving the dark branch from tau directly
     brightened whichever channels absorbed MOST, inverting the hue —
     a blue d-sheet came out olive. Brightness now comes from total
     absorption, hue from what survives, so both schemes agree. */
  float lum = dot(uPaper, vec3(0.299,0.587,0.114));
  vec3 trans = exp(-tau*uFade);
  float opacity = 1.0 - dot(trans, vec3(0.33333));
  vec3 col = lum > 0.5
    ? uPaper*trans
    : uPaper + opacity*trans*vec3(1.75);
  frag=vec4(col,1.0);
}`;

function initAmbient() {
  const cv = el("bz");
  if (!cv) return;
  const gl = cv.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) { cv.style.display = "none"; return; }
  const mk = (t, s) => {
    const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o));
    return o;
  };
  const pr = gl.createProgram();
  gl.attachShader(pr, mk(gl.VERTEX_SHADER, BZ_VS));
  gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, BZ_FS));
  gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const L = gl.getAttribLocation(pr, "p");
  gl.enableVertexAttribArray(L);
  gl.vertexAttribPointer(L, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(pr, n);
  const u = { res: U("uRes"), paper: U("uPaper"), mu: U("uMu"), V: U("uV"), tp: U("uTp"),
              rot: U("uRot"), el: U("uEl"), shift: U("uShift"), fade: U("uFade"), steps: U("uSteps") };

  const SCALE = MOBILE ? 0.44 : 0.58, HI = MOBILE ? 38 : 62, LO = MOBILE ? 22 : 32;
  let steps = HI, MU = -1.10, VH = 0.0, FADE = 1, rot = 0, moving = 0, active = true;
  function size() {
    const w = Math.round(innerWidth * SCALE), h = Math.round(innerHeight * SCALE);
    cv.width = w; cv.height = h; gl.viewport(0, 0, w, h);
  }
  addEventListener("resize", size); size();

  const sm = (a, z, x) => { const t = Math.min(1, Math.max(0, (x - a) / (z - a))); return t * t * (3 - 2 * t); };
  function onScroll() {
    const y = scrollY, vh = innerHeight;
    const f = Math.min(1, y / (vh * 3.1));
    MU = -1.10 + 0.80 * sm(0.10, 0.45, f);
    VH = 0.00 + 0.14 * sm(0.38, 0.68, f);
    FADE = 1.00 - 0.90 * sm(0.66, 1.00, f);
    active = y < vh * 3.6;
    steps = LO; moving = performance.now();
  }
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!active || document.hidden) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!REDUCE) rot += dt * 0.075;
    if (now - moving > 150) steps = HI;
    const pp = P.rgbPaper;
    gl.uniform2f(u.res, cv.width, cv.height);
    gl.uniform3f(u.paper, pp[0] / 255, pp[1] / 255, pp[2] / 255);
    gl.uniform1f(u.mu, MU); gl.uniform1f(u.V, VH); gl.uniform1f(u.tp, 0.25);
    gl.uniform1f(u.rot, rot); gl.uniform1f(u.el, 0.40 + 0.09 * Math.sin(rot * 0.5));
    gl.uniform1f(u.shift, MOBILE ? 0.0 : 0.44); gl.uniform1f(u.fade, Math.max(FADE, 0));
    gl.uniform1i(u.steps, steps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
}

/* No figure is ever left as empty axes. The work starts on first sight
   if the reader scrolls to it, and otherwise on an idle callback shortly
   after load — so the state never depends on the path taken through the
   page (a rail link, a URL hash, or a jump past the figure). */
let autoStartN = 0;
function autoStart(fn, node) {
  let started = false;
  const go = () => { if (started) return; started = true; fn(); };
  if (node && typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver(en => {
      if (!en[0].isIntersecting) return;
      io.disconnect(); go();
    }, { threshold: 0.15, rootMargin: "200px 0px" });
    io.observe(node);
  }
  /* The fallback exists only so a figure that is never scrolled past is
     not left as empty axes. It must not compete with first paint or with
     the other figures, so the jobs are staggered well clear of load and
     of each other; scrolling to a figure still starts it immediately. */
  const idle = window.requestIdleCallback || (f => setTimeout(f, 1));
  const slot = 3200 + 3200 * autoStartN++;
  setTimeout(() => idle(go, { timeout: 4000 }), slot);
}

/* ═══ PLATE I — fermiology ═════════════════════════════════════ */
const PATHK = [[0, 0], [PI, 0], [PI, PI], [0, 0]], PLAB = ["Γ", "X", "M", "Γ"], NP = 150;
const ELO = -1.55, EHI = 2.45, INS = { t: 26, b: 26, l: 44, r: 14 }, NG = 170;

function initFermi() {
  const ef = el("ef"), vv = el("vv"), tp = el("tp");
  if (!ef || !el("band")) return;

  function drawBand() {
    const { c, w, h } = fit(el("band"), MOBILE ? 0.62 : 0.52);
    const EF = +ef.value, V = +vv.value, TP = +tp.value;
    const PW = w - INS.l - INS.r, PH = h - INS.t - INS.b;
    const Y = e => INS.t + PH * (1 - (e - ELO) / (EHI - ELO)), X = i => INS.l + PW * i / 3;
    c.lineWidth = 1; c.strokeStyle = P.hair; c.strokeRect(INS.l, INS.t, PW, PH);
    c.font = MONO(9); c.fillStyle = P.soft; c.textAlign = "right"; c.textBaseline = "middle";
    for (let e = -1.5; e <= 2.5; e += .5) {
      const y = Y(e); if (y < INS.t - 1 || y > INS.t + PH + 1) continue;
      c.strokeStyle = P.hair2; c.beginPath(); c.moveTo(INS.l, y); c.lineTo(INS.l + PW, y); c.stroke();
      c.fillText(e.toFixed(1), INS.l - 7, y);
    }
    c.save(); c.translate(11, INS.t + PH / 2); c.rotate(-PI / 2); c.textAlign = "center";
    c.fillText("E (eV)", 0, 0); c.restore();
    c.textAlign = "center"; c.textBaseline = "top";
    for (let i = 0; i < 4; i++) {
      const x = X(i);
      c.strokeStyle = P.hair; c.beginPath(); c.moveTo(x, INS.t); c.lineTo(x, INS.t + PH); c.stroke();
      c.font = MONO(10); c.fillStyle = P.ink; c.fillText(PLAB[i], x, INS.t + PH + 7);
    }
    const seg = [];
    for (let s = 0; s < 3; s++) {
      const a = PATHK[s], b = PATHK[s + 1];
      for (let n = 0; n <= NP; n++) {
        const t2 = n / NP;
        const B = branch2D(a[0] + (b[0] - a[0]) * t2, a[1] + (b[1] - a[1]) * t2, TP, V);
        seg.push([X(s + t2), B[0], B[1], B[2]]);
      }
    }
    const mix = w1 => rgbStr(lerpRGB(P.rgbB2, P.rgbB1, w1));
    c.lineWidth = 1.6; c.lineCap = "round";
    for (let br = 0; br < 2; br++) for (let i = 1; i < seg.length; i++) {
      const p = seg[i - 1], q2 = seg[i];
      c.strokeStyle = mix(br ? 1 - q2[3] : q2[3]);
      c.beginPath(); c.moveTo(p[0], Y(br ? p[2] : p[1])); c.lineTo(q2[0], Y(br ? q2[2] : q2[1])); c.stroke();
    }
    const yF = Y(EF);
    c.setLineDash([5, 4]); c.lineWidth = 1; c.strokeStyle = P.ink;
    c.beginPath(); c.moveTo(INS.l, yF); c.lineTo(INS.l + PW, yF); c.stroke(); c.setLineDash([]);
    c.fillStyle = P.ink;
    for (let br = 0; br < 2; br++) for (let i = 1; i < seg.length; i++) {
      const a = br ? seg[i - 1][2] : seg[i - 1][1], b = br ? seg[i][2] : seg[i][1];
      if ((a - EF) * (b - EF) < 0) {
        const t3 = (EF - a) / (b - a);
        c.beginPath(); c.arc(seg[i - 1][0] + (seg[i][0] - seg[i - 1][0]) * t3, yF, 2.6, 0, 7); c.fill();
      }
    }
    const yv = Y(vanHove(TP));
    c.strokeStyle = P.b2; c.globalAlpha = .55; c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(X(1) - 26, yv); c.lineTo(X(1) + 26, yv); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
    c.font = MONO(9); c.fillStyle = P.b2; c.textAlign = "left"; c.textBaseline = "bottom";
    c.fillText("van Hove  " + fmt(vanHove(TP)) + " eV", X(1) + 6, yv - 3);
  }

  function drawFS() {
    const { c, w, h } = fit(el("fs"), MOBILE ? 0.98 : 0.92);
    const EF = +ef.value, V = +vv.value, TP = +tp.value;
    const S = Math.min(w, h) - 58, ox = (w - S) / 2, oy = (h - S) / 2;
    const px = k => ox + S * (k + PI) / (2 * PI), py = k => oy + S * (1 - (k + PI) / (2 * PI));
    c.lineWidth = 1; c.strokeStyle = P.hair; c.strokeRect(ox, oy, S, S);
    c.strokeStyle = P.hair2; c.beginPath();
    c.moveTo(ox + S / 2, oy); c.lineTo(ox + S / 2, oy + S);
    c.moveTo(ox, oy + S / 2); c.lineTo(ox + S, oy + S / 2); c.stroke();
    c.font = MONO(10); c.fillStyle = P.ink; c.textAlign = "left"; c.textBaseline = "top";
    c.fillText("Γ", ox + S / 2 + 5, oy + S / 2 + 4);
    c.fillText("X", ox + S - 14, oy + S / 2 + 4);
    c.fillText("M", ox + S - 14, oy + 6);
    const g = new Float32Array((NG + 1) * (NG + 1)), dk = 2 * PI / NG;
    for (let br = 0; br < 2; br++) {
      for (let j = 0; j <= NG; j++) {
        const ky = -PI + dk * j;
        for (let i = 0; i <= NG; i++) {
          const B = branch2D(-PI + dk * i, ky, TP, V);
          g[j * (NG + 1) + i] = (br ? B[1] : B[0]) - EF;
        }
      }
      c.strokeStyle = br ? P.b2 : P.b1; c.lineWidth = 1.5; c.beginPath();
      for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
        const a = g[j * (NG + 1) + i], b = g[j * (NG + 1) + i + 1],
              d = g[(j + 1) * (NG + 1) + i + 1], e = g[(j + 1) * (NG + 1) + i];
        const kx0 = -PI + dk * i, ky0 = -PI + dk * j, Q = [];
        if ((a > 0) !== (b > 0)) Q.push([kx0 + dk * a / (a - b), ky0]);
        if ((b > 0) !== (d > 0)) Q.push([kx0 + dk, ky0 + dk * b / (b - d)]);
        if ((e > 0) !== (d > 0)) Q.push([kx0 + dk * e / (e - d), ky0 + dk]);
        if ((a > 0) !== (e > 0)) Q.push([kx0, ky0 + dk * a / (a - e)]);
        for (let m = 0; m + 1 < Q.length; m += 2) {
          c.moveTo(px(Q[m][0]), py(Q[m][1])); c.lineTo(px(Q[m + 1][0]), py(Q[m + 1][1]));
        }
      }
      c.stroke();
    }
  }

  function readout() {
    const EF = +ef.value, TP = +tp.value, vh = vanHove(TP);
    el("efO").textContent = fmt(EF) + " eV";
    el("vvO").textContent = fmt(+vv.value) + " eV";
    el("tpO").textContent = (+tp.value).toFixed(3) + " t";
    el("tagE").innerHTML = "E<sub>F</sub> = " + fmt(EF) + " eV";
    el("sTop").textContent = EF < vh ? "electron pocket at Γ" : "hole barrel at M";
    const open = EF > gammaE2();
    el("sPk").textContent = open ? "open" : "closed";
    el("sPk").style.color = open ? P.b2 : "";
    el("flag1").classList.toggle("on", Math.abs(EF - vh) < 0.022);
  }

  let q = false;
  const paint = () => {
    if (q) return;
    q = true;
    requestAnimationFrame(() => {
      try { drawBand(); drawFS(); readout(); } finally { q = false; }
    });
  };
  [ef, vv, tp].forEach(i => i.addEventListener("input", paint));

  const pane = el("bandPane");
  if (pane) {
    let down = false;
    const set = e => {
      const r = pane.getBoundingClientRect(), PH = r.height - INS.t - INS.b;
      ef.value = (ELO + (EHI - ELO) * (1 - Math.min(1, Math.max(0, (e.clientY - r.top - INS.t) / PH)))).toFixed(3);
      paint();
    };
    pane.addEventListener("pointerdown", e => { down = true; pane.setPointerCapture(e.pointerId); set(e); });
    pane.addEventListener("pointermove", e => { if (down) set(e); });
    pane.addEventListener("pointerup", () => down = false);
    pane.addEventListener("pointercancel", () => down = false);
  }
  REDRAW.push(paint);
  sizeWatch(el("band").parentElement);
  sizeWatch(el("fs").parentElement);
  paint();
}

/* ═══ PLATE II — Lindhard susceptibility ═══════════════════════
   χ₀(q) = N⁻¹ Σ_k [f(E_k) − f(E_{k+q})]/(E_{k+q} − E_k)
   Same mesh for k and q (q on stride 2) so the shift is an
   integer index — no trigonometry in the inner loop, and (π,π)
   is exactly representable.
   ═════════════════════════════════════════════════════════════ */
const NK = 64, QS = 2, NQ = NK / QS + 1;

function initChi() {
  if (!el("chi")) return;
  const tpRef = () => +(el("tp") ? el("tp").value : 0.25);
  const vvRef = () => +(el("vv") ? el("vv").value : 0.04);
  let chiMap = null, chiRow = 0, chiJob = null, chiPeak = null;

  function buildBands(EF, kT) {
    const E = [new Float32Array(NK * NK), new Float32Array(NK * NK)],
          F = [new Float32Array(NK * NK), new Float32Array(NK * NK)];
    for (let j = 0; j < NK; j++) {
      const ky = -PI + 2 * PI * j / NK;
      for (let i = 0; i < NK; i++) {
        const B = branch2D(-PI + 2 * PI * i / NK, ky, tpRef(), vvRef()), n = j * NK + i;
        for (let b = 0; b < 2; b++) { const e = B[b]; E[b][n] = e; F[b][n] = 1 / (1 + Math.exp((e - EF) / kT)); }
      }
    }
    return { E, F };
  }
  function chiColor(v) {
    const t = Math.max(0, Math.min(1, v));
    return rgbStr(t < 0.5
      ? lerpRGB(P.rgbB1, P.rgbPaper, t * 2)
      : lerpRGB(P.rgbPaper, P.rgbB2, (t - 0.5) * 2));
  }
  function drawChi() {
    const { c, w, h } = fit(el("chi"), MOBILE ? 1.0 : 0.94);
    const S = Math.min(w, h) - 56, ox = (w - S) / 2, oy = (h - S) / 2;
    c.strokeStyle = P.hair; c.lineWidth = 1; c.strokeRect(ox, oy, S, S);
    if (!chiMap) return;
    let lo = 1e9, hi = -1e9;
    for (let n = 0; n < chiRow * NQ; n++) { const v = chiMap[n]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi <= lo) hi = lo + 1;
    const cell = S / (NQ - 1);
    for (let j = 0; j < chiRow; j++) for (let i = 0; i < NQ; i++) {
      c.fillStyle = chiColor((chiMap[j * NQ + i] - lo) / (hi - lo));
      c.fillRect(ox + (i - .5) * cell, oy + S - (j + .5) * cell, cell + 1, cell + 1);
    }
    c.strokeStyle = P.hair; c.strokeRect(ox, oy, S, S);
    /* The mesh spans 0 → 2π on both axes: Γ sits at the corners, X at the
       edge midpoints and M at the centre. The labels previously assumed a
       −π → π mesh, which placed every one of them a full π out. */
    c.strokeStyle = P.hair2; c.beginPath();
    c.moveTo(ox + S / 2, oy); c.lineTo(ox + S / 2, oy + S);
    c.moveTo(ox, oy + S / 2); c.lineTo(ox + S, oy + S / 2); c.stroke();
    c.font = MONO(10); c.fillStyle = P.ink;
    c.textAlign = "left"; c.textBaseline = "bottom";
    c.fillText("Γ", ox + 4, oy + S - 4);
    c.textAlign = "center";
    c.fillText("X (π,0)", ox + S / 2, oy + S - 4);
    c.textBaseline = "middle";
    c.fillText("M (π,π)", ox + S / 2, oy + S / 2 - 9);
    c.textAlign = "right"; c.textBaseline = "top";
    c.fillText("2π", ox + S - 4, oy + 4);
    if (chiPeak) {
      const x = ox + chiPeak.i * cell, y = oy + S - chiPeak.j * cell;
      c.strokeStyle = P.ink; c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, 7, 0, 7);
      c.moveTo(x - 11, y); c.lineTo(x - 7, y);
      c.moveTo(x + 7, y); c.lineTo(x + 11, y); c.stroke();
    }
  }
  function drawChiCut() {
    const { c, w, h } = fit(el("chicut"), MOBILE ? 0.8 : 0.62);
    if (!chiMap || chiRow < NQ) return;
    const L = 44, R = 12, TT = 24, B = 26, PW = w - L - R, PH = h - TT - B, M = NQ - 1;
    const at = (i, j) => chiMap[j * NQ + i], c0 = M / 2, path = [];
    /* The q-mesh runs 0 → 2π, so index 0 is Γ, index c0 is π and index M
       is 2π ≡ Γ. The high-symmetry path is therefore
       Γ(0,0) → X(c0,0) → M(c0,c0) → Γ(0,0), not a walk from the centre. */
    for (let n = 0; n <= c0; n++) path.push(at(n, 0));
    for (let n = 1; n <= c0; n++) path.push(at(c0, n));
    for (let n = 1; n <= c0; n++) path.push(at(c0 - n, c0 - n));
    let lo = Math.min(...path), hi = Math.max(...path);
    const pad = (hi - lo) * .1 + 1e-9; lo -= pad; hi += pad;
    const Y = v => TT + PH * (1 - (v - lo) / (hi - lo)), X = i => L + PW * i / (path.length - 1);
    c.strokeStyle = P.hair; c.lineWidth = 1; c.strokeRect(L, TT, PW, PH);
    c.font = MONO(9); c.fillStyle = P.soft; c.textAlign = "right"; c.textBaseline = "middle";
    for (let n = 0; n <= 3; n++) {
      const v = lo + (hi - lo) * n / 3, y = Y(v);
      c.strokeStyle = P.hair2; c.beginPath(); c.moveTo(L, y); c.lineTo(L + PW, y); c.stroke();
      c.fillText(v.toFixed(3), L - 6, y);
    }
    c.save(); c.translate(11, TT + PH / 2); c.rotate(-PI / 2); c.textAlign = "center";
    c.fillText("χ₀(q)", 0, 0); c.restore();
    const marks = [0, c0, 2 * c0, path.length - 1], lbl = ["Γ", "(π,0)", "(π,π)", "Γ"];
    c.textAlign = "center"; c.textBaseline = "top";
    marks.forEach((m, i) => {
      const x = X(m);
      c.strokeStyle = P.hair; c.beginPath(); c.moveTo(x, TT); c.lineTo(x, TT + PH); c.stroke();
      c.font = MONO(9); c.fillStyle = P.ink; c.fillText(lbl[i], x, TT + PH + 7);
    });
    c.strokeStyle = P.b1; c.lineWidth = 1.5; c.beginPath();
    path.forEach((v, i) => { i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); });
    c.stroke();
    const pk = path.indexOf(Math.max(...path));
    c.fillStyle = P.b2; c.beginPath(); c.arc(X(pk), Y(path[pk]), 3, 0, 7); c.fill();
  }
  function chiStart() {
    const EF = +el("xef").value, kT = +el("xkt").value;
    const { E, F } = buildBands(EF, kT);
    chiMap = new Float32Array(NQ * NQ); chiRow = 0; chiPeak = null;
    el("tagX").textContent = "computing";
    const runBtn = el("xrun");
    if (runBtn) { runBtn.classList.add("busy"); runBtn.setAttribute("aria-busy", "true"); }
    if (chiJob) cancelAnimationFrame(chiJob);
    const beta = 1 / kT;
    const step = () => {
      const t0 = performance.now();
      while (chiRow < NQ && performance.now() - t0 < 9) {
        const qj = chiRow * QS;
        for (let qi2 = 0; qi2 < NQ; qi2++) {
          const qi = qi2 * QS; let s = 0;
          for (let b = 0; b < 2; b++) {
            const Eb = E[b], Fb = F[b];
            for (let j = 0; j < NK; j++) {
              const jj = ((j + qj) & (NK - 1)) * NK, j0 = j * NK;
              for (let i = 0; i < NK; i++) {
                const n = j0 + i, m = jj + ((i + qi) & (NK - 1));
                const den = Eb[m] - Eb[n];
                s += (Math.abs(den) < 1e-7) ? beta * Fb[n] * (1 - Fb[n]) : (Fb[n] - Fb[m]) / den;
              }
            }
          }
          chiMap[chiRow * NQ + qi2] = s / (NK * NK);
        }
        chiRow++;
      }
      el("xbar").style.width = (100 * chiRow / NQ) + "%";
      drawChi();
      if (chiRow < NQ) { chiJob = requestAnimationFrame(step); return; }
      chiJob = null;
      if (runBtn) { runBtn.classList.remove("busy"); runBtn.removeAttribute("aria-busy"); }
      /* index → wavevector, in units of π: the mesh spans 0 → 2π, so
         index i carries q = 2π i /(NQ−1). Values past π are folded back
         into the first zone for reporting. */
      const M = NQ - 1, c0 = M / 2;
      const qOf = i => { const u = 2 * i / M; return u > 1 ? u - 2 : u; };
      /* With intraband terms and unit matrix elements, χ₀ tends to the
         density of states at E_F as q → 0, so Γ can hold the global
         maximum while the nesting feature is a separate, finite-q one.
         The readout therefore reports the largest maximum away from a
         small-|q| neighbourhood, which is the quantity the model makes
         a claim about. */
      let best = -1e9, bi = c0, bj = 0;
      for (let j = 0; j < NQ; j++) for (let i = 0; i < NQ; i++) {
        const qx = qOf(i), qy = qOf(j);
        if (Math.hypot(qx, qy) < 0.35) continue;
        const v = chiMap[j * NQ + i];
        if (v > best) { best = v; bi = i; bj = j; }
      }
      chiPeak = { i: bi, j: bj, v: best };
      const qx = qOf(bi), qy = qOf(bj);
      const chiM = chiMap[c0 * NQ + c0];
      el("sQ").textContent = "(" + fmt(qx, 2) + "\u03c0, " + fmt(qy, 2) + "\u03c0)";
      el("sX").textContent = best.toFixed(4);
      el("sM") && (el("sM").textContent = chiM.toFixed(4));
      el("tagX").textContent = "done · " + (NQ * NQ * NK * NK * 2 / 1e6).toFixed(1) + "M terms";
      el("tagX2").textContent = "max " + best.toFixed(3);
      el("flag2").classList.toggle("on",
        Math.abs(Math.abs(qx) - 1) < 0.16 && Math.abs(Math.abs(qy) - 1) < 0.16);
      drawChi(); drawChiCut();
    };
    chiJob = requestAnimationFrame(step);
  }
  el("xrun").addEventListener("click", chiStart);
  el("xclear").addEventListener("click", () => {
    if (chiJob) cancelAnimationFrame(chiJob);
    chiJob = null;
    const rb = el("xrun");
    if (rb) { rb.classList.remove("busy"); rb.removeAttribute("aria-busy"); } chiMap = null; chiPeak = null; chiRow = 0;
    el("xbar").style.width = "0";
    el("tagX").textContent = "idle"; el("tagX2").textContent = "—";
    el("sQ").textContent = "—"; el("sX").textContent = "—";
    el("sM") && (el("sM").textContent = "—");
    el("flag2").classList.remove("on");
    drawChi(); fit(el("chicut"), MOBILE ? 0.8 : 0.62);
  });
  ["xef", "xkt"].forEach(id => el(id).addEventListener("input", () => {
    el("xefO").textContent = fmt(+el("xef").value) + " eV";
    el("xktO").textContent = fmt(+el("xkt").value) + " eV";
  }));
  REDRAW.push(() => { drawChi(); drawChiCut(); });
  sizeWatch(el("chi").parentElement);
  sizeWatch(el("chicut").parentElement);
  drawChi();
  autoStart(chiStart, el("chi"));
}

/* ═══ PLATE III — Ising portfolio, graded by enumeration ═══════ */
const NA = 10, A_PEN = 6.0;
const H_RET = [.42, .31, .55, .18, .47, .26, .63, .22, .38, .50];
const SIG = (() => {
  const rnd = makeRNG(seedOf("covariance", NA));
  const J = [...Array(NA)].map(() => Array(NA).fill(0));
  for (let i = 0; i < NA; i++) for (let j = i + 1; j < NA; j++) { const v = .10 + .55 * rnd(); J[i][j] = J[j][i] = v; }
  for (let i = 0; i < NA; i++) J[i][i] = .55 + .35 * rnd();
  return J;
})();
const pEnergy = (x, lam, K) => {
  let e = 0, n = 0;
  for (let i = 0; i < NA; i++) if (x[i]) { e -= H_RET[i]; n++; for (let j = i + 1; j < NA; j++) if (x[j]) e += lam * SIG[i][j]; }
  return e + A_PEN * (n - K) * (n - K);
};
function exactMin(lam, K) {
  let best = Infinity, bx = null;
  for (let m = 0; m < (1 << NA); m++) {
    const x = []; for (let i = 0; i < NA; i++) x.push((m >> i) & 1);
    const e = pEnergy(x, lam, K); if (e < best) { best = e; bx = x; }
  }
  return { E: best, x: bx };
}
function pStats(x) {
  let n = 0; for (let i = 0; i < NA; i++) n += x[i];
  if (!n) return { ret: 0, vol: 0 };
  const w = 1 / n; let r = 0, v = 0;
  for (let i = 0; i < NA; i++) if (x[i]) { r += w * H_RET[i]; for (let j = 0; j < NA; j++) if (x[j]) v += w * w * SIG[i][j]; }
  return { ret: r, vol: Math.sqrt(Math.max(v, 0)) };
}

function initAnneal() {
  if (!el("anneal")) return;
  let trace = [], temps = [], exact = null, running = false, raf = null;

  function drawChips(x) {
    const box = el("chips"); if (!box) return;
    box.innerHTML = "";
    for (let i = 0; i < NA; i++) {
      const s = document.createElement("span");
      s.className = "chip" + (x && x[i] ? " on" : "");
      s.textContent = "A" + (i + 1);
      box.appendChild(s);
    }
  }
  function draw() {
    const { c, w, h } = fit(el("anneal"), MOBILE ? 0.6 : 0.34);
    const SW = +el("swp").value, L = 48, R = 46, TT = 22, B = 26, PW = w - L - R, PH = h - TT - B;
    let lo = exact ? exact.E : 0, hi = lo + 1;
    if (trace.length) { lo = Math.min(lo, ...trace); hi = Math.max(hi, ...trace); }
    const pad = (hi - lo) * .12 + 1e-6; lo -= pad; hi += pad;
    const Y = e => TT + PH * (1 - (e - lo) / (hi - lo)), X = i => L + PW * i / Math.max(SW - 1, 1);
    c.lineWidth = 1; c.strokeStyle = P.hair; c.strokeRect(L, TT, PW, PH);
    c.font = MONO(9); c.fillStyle = P.soft; c.textAlign = "right"; c.textBaseline = "middle";
    for (let n = 0; n <= 4; n++) {
      const e = lo + (hi - lo) * n / 4, y = Y(e);
      c.strokeStyle = P.hair2; c.beginPath(); c.moveTo(L, y); c.lineTo(L + PW, y); c.stroke();
      c.fillText(e.toFixed(2), L - 7, y);
    }
    c.save(); c.translate(12, TT + PH / 2); c.rotate(-PI / 2); c.textAlign = "center";
    c.fillText("E", 0, 0); c.restore();
    c.textAlign = "center"; c.textBaseline = "top"; c.fillText("sweep", L + PW / 2, TT + PH + 8);
    c.textAlign = "left"; c.fillText("0", L, TT + PH + 8);
    c.textAlign = "right"; c.fillText(String(SW), L + PW, TT + PH + 8);
    if (temps.length) {
      const tl = Math.log10(.01), th = Math.log10(3);
      c.strokeStyle = P.soft; c.globalAlpha = .55; c.setLineDash([3, 3]); c.beginPath();
      temps.forEach((t, i) => {
        const y = TT + PH * (1 - (Math.log10(t) - tl) / (th - tl));
        i ? c.lineTo(X(i), y) : c.moveTo(X(i), y);
      });
      c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText("T = 3", L + PW + 6, TT + 2); c.fillText("T = 0.01", L + PW + 6, TT + PH - 2);
    }
    if (exact) {
      const y = Y(exact.E);
      c.strokeStyle = P.b2; c.setLineDash([6, 4]);
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + PW, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = P.b2; c.textAlign = "left"; c.textBaseline = "bottom";
      c.fillText("E* = " + exact.E.toFixed(3), L + 4, y - 3);
    }
    if (trace.length) {
      c.strokeStyle = P.b1; c.lineWidth = 1.4; c.beginPath();
      trace.forEach((e, i) => { i ? c.lineTo(X(i), Y(e)) : c.moveTo(X(i), Y(e)); });
      c.stroke();
    }
  }
  function reset() {
    running = false; if (raf) cancelAnimationFrame(raf); raf = null; trace = []; temps = [];
    exact = exactMin(+el("lam").value, +el("kk").value);
    el("tagA").textContent = "idle"; el("sEA").textContent = "—"; el("sGap").textContent = "—";
    el("sSh").textContent = "—"; el("sEX").textContent = exact.E.toFixed(3);
    el("flag3").classList.remove("on"); drawChips(null); draw();
  }
  function run() {
    const lam = +el("lam").value, K = +el("kk").value, SW = +el("swp").value;
    exact = exactMin(lam, K); el("sEX").textContent = exact.E.toFixed(3);
    const rnd = makeRNG(seedOf("anneal", lam.toFixed(2), K, SW));
    let x = [...Array(NA)].map(() => rnd() < K / NA ? 1 : 0), E = pEnergy(x, lam, K);
    let best = [...x], bestE = E, k = 0;
    const T0 = 3.0, Tf = .01;
    trace = []; temps = []; running = true; el("tagA").textContent = "running";
    const runBtn = el("run");
    if (runBtn) { runBtn.classList.add("busy"); runBtn.setAttribute("aria-busy", "true"); }
    const step = () => {
      for (let s = 0; s < 4 && k < SW; s++, k++) {
        const Tc = T0 * Math.pow(Tf / T0, k / Math.max(SW - 1, 1));
        for (let f = 0; f < NA; f++) {
          const i = (rnd() * NA) | 0; x[i] ^= 1;
          const E2 = pEnergy(x, lam, K), dE = E2 - E;
          if (dE <= 0 || rnd() < Math.exp(-dE / Tc)) { E = E2; if (E < bestE) { bestE = E; best = [...x]; } }
          else x[i] ^= 1;
        }
        trace.push(E); temps.push(Tc);
      }
      draw();
      if (k < SW) { raf = requestAnimationFrame(step); return; }
      running = false;
      if (runBtn) { runBtn.classList.remove("busy"); runBtn.removeAttribute("aria-busy"); }
      const gap = bestE - exact.E, st = pStats(best);
      el("tagA").textContent = "converged · " + SW + " sweeps";
      el("sEA").textContent = bestE.toFixed(3);
      el("sGap").textContent = (Math.abs(gap) < 1e-9 ? "0.000" : fmt(gap)) +
        (Math.abs(exact.E) > 1e-9 ? "  (" + (100 * Math.abs(gap / exact.E)).toFixed(2) + "%)" : "");
      el("sSh").textContent = st.ret.toFixed(3) + " / " + st.vol.toFixed(3);
      el("flag3").classList.toggle("on", Math.abs(gap) < 1e-9);
      drawChips(best);
    };
    step();
  }
  el("run").addEventListener("click", () => { if (!running) run(); });
  el("reset").addEventListener("click", reset);
  ["kk", "lam", "swp"].forEach(id => el(id).addEventListener("input", () => {
    el("kkO").textContent = el("kk").value;
    el("lamO").textContent = (+el("lam").value).toFixed(2);
    el("swpO").textContent = el("swp").value;
    reset();
  }));
  REDRAW.push(draw);
  sizeWatch(el("anneal").parentElement);
  reset();
  autoStart(run, el("anneal"));
}

/* ═══ PLATE IV — moiré ═════════════════════════════════════════ */
const A1 = [1, 0], A2 = [.5, Math.sqrt(3) / 2], BAS = [[0, 0], [1.5 / 3, (Math.sqrt(3) / 2) / 3]];
function moireVecs(d) {
  const t = d * PI / 180, c = Math.cos(t), s = Math.sin(t), det = 2 - 2 * c;
  const M = [[(c - 1) / det, s / det], [-s / det, (c - 1) / det]];
  const ap = v => [M[0][0] * v[0] + M[0][1] * v[1], M[1][0] * v[0] + M[1][1] * v[1]];
  return [ap(A1), ap(A2)];
}
function initMoire() {
  if (!el("moire")) return;
  function draw() {
    const { c, w, h } = fit(el("moire"), MOBILE ? 0.92 : 0.58);
    const th = +el("th").value, a_nm = +el("aa").value;
    const [L1, L2] = moireVecs(th), lam = Math.hypot(L1[0], L1[1]);
    /* show about one and a half superlattice periods, bounded so the dot
       count stays in the hundreds and each atom remains resolvable */
    const HALF = Math.min(Math.max(0.80 * lam, 6), 22);
    const S = Math.min(w, h) - 40, ox = w / 2, oy = h / 2, sc = S / (2 * HALF);
    const cs = Math.cos(th * PI / 180), sn = Math.sin(th * PI / 180), R = Math.ceil(HALF * 1.6);
    const rad = Math.max(1.1, sc * 0.16);
    c.save(); c.beginPath(); c.rect((w - S) / 2, (h - S) / 2, S, S); c.clip();
    for (let layer = 0; layer < 2; layer++) {
      /* fixed layer filled, twisted layer outlined: the two sublattices
         stay distinguishable where they overlap */
      c.fillStyle = layer ? P.b2 : P.b1;
      c.strokeStyle = P.b2; c.lineWidth = Math.max(0.8, rad * 0.5);
      c.globalAlpha = layer ? .92 : .62;
      for (let n = -R; n <= R; n++) for (let m = -R; m <= R; m++) for (const b of BAS) {
        let x = n * A1[0] + m * A2[0] + b[0], y = n * A1[1] + m * A2[1] + b[1];
        if (layer) { const X = x * cs - y * sn, Y = x * sn + y * cs; x = X; y = Y; }
        if (Math.abs(x) > HALF || Math.abs(y) > HALF) continue;
        c.beginPath(); c.arc(ox + x * sc, oy - y * sc, rad, 0, 6.2832);
        if (layer) c.stroke(); else c.fill();
      }
    }
    c.globalAlpha = 1; c.restore();
    const cen = [(L1[0] + L2[0]) / 2, (L1[1] + L2[1]) / 2];
    c.lineWidth = 1.2; c.strokeStyle = P.ink; c.beginPath();
    [[0, 0], L1, [L1[0] + L2[0], L1[1] + L2[1]], L2].forEach((v, i) => {
      const X = ox + (v[0] - cen[0]) * sc, Y = oy - (v[1] - cen[1]) * sc;
      i ? c.lineTo(X, Y) : c.moveTo(X, Y);
    });
    c.closePath(); c.stroke();
    const x0 = (w - S) / 2 + 16, y0 = (h + S) / 2 - 16;
    const bar = (y, len, label, col) => {
      c.strokeStyle = col; c.lineWidth = 1; c.beginPath();
      c.moveTo(x0, y); c.lineTo(x0 + len, y);
      c.moveTo(x0, y - 4); c.lineTo(x0, y + 4);
      c.moveTo(x0 + len, y - 4); c.lineTo(x0 + len, y + 4); c.stroke();
      c.font = MONO(9); c.fillStyle = col; c.textAlign = "left"; c.textBaseline = "bottom";
      c.fillText(label, x0, y - 5);
    };
    /* the 1 nm bar is set by the lattice constant alone, so moving a
       rescales the figure against a fixed physical length */
    bar(y0 - 17, Math.min((1 / a_nm) * sc, S - 32), "1 nm", P.soft);
    bar(y0, Math.min(lam * sc, S - 32),
        "λ = " + lam.toFixed(1) + " a = " + (lam * a_nm).toFixed(2) + " nm", P.ink);
    c.strokeStyle = P.hair; c.strokeRect((w - S) / 2, (h - S) / 2, S, S);
    el("thO").textContent = th.toFixed(2) + "°";
    el("tagM").textContent = "θ = " + th.toFixed(2) + "°";
    el("aaO").textContent = a_nm.toFixed(3) + " nm";
    el("sLa").textContent = lam.toFixed(1);
    el("sLnm").textContent = (lam * a_nm).toFixed(1) + " nm";
    el("sNat").textContent = Math.round(4 * lam * lam).toLocaleString();
    el("flag4").classList.toggle("on", Math.abs(th - 1.1) < 0.06);
  }
  let q = false;
  const paint = () => {
    if (q) return;
    q = true;
    /* the latch is released in a finally, so one bad frame cannot leave
       the figure permanently unresponsive to its controls */
    requestAnimationFrame(() => { try { draw(); } finally { q = false; } });
  };
  ["th", "aa"].forEach(id => el(id).addEventListener("input", paint));
  REDRAW.push(paint);
  sizeWatch(el("moire").parentElement);
  paint();
}

/* ═══ PLATE V — 2D Ising, checkerboard Metropolis on the GPU ═══
   H = −J Σ s_i s_j − Σ h_i s_i, J = 1. T_c = 2/ln(1+√2) ≈ 2.269.
   Held below T_c the system coarsens: a few large domains with
   smooth, slowly moving walls, rather than critical noise. The
   parity split means an updating site's neighbours are frozen,
   so detailed balance survives the parallelism.
   ═════════════════════════════════════════════════════════════ */
const TC = 2.0 / Math.log(1.0 + Math.SQRT2);
const IS_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;
const IS_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uState; uniform ivec2 uGrid; uniform float uT;
uniform vec2 uMouse; uniform float uHMouse, uSigma; uniform int uPass, uParity;
out vec4 fragColor;
uint hash(uint x){ x^=x>>16u; x*=0x7feb352du; x^=x>>15u; x*=0x846ca68bu; x^=x>>16u; return x; }
float rnd(ivec2 p,int f){ uint h=hash(uint(p.x)+hash(uint(p.y)+hash(uint(f)))); return float(h)*(1.0/4294967296.0); }
float spinAt(ivec2 p){ p=ivec2(mod(vec2(p),vec2(uGrid))); return texelFetch(uState,p,0).r>0.5?1.0:-1.0; }
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);
  float s=spinAt(p);
  if(((p.x+p.y)&1)==uParity){
    float nn=spinAt(p+ivec2(1,0))+spinAt(p+ivec2(-1,0))+spinAt(p+ivec2(0,1))+spinAt(p+ivec2(0,-1));
    vec2 d=vec2(p)-uMouse;
    float h=uHMouse*exp(-dot(d,d)/(2.0*uSigma*uSigma));
    float dE=2.0*s*(nn+h);
    if(dE<=0.0||rnd(p,uPass)<exp(-dE/max(uT,1e-4))) s=-s;
  }
  fragColor=vec4(s*0.5+0.5,0.0,0.0,1.0);
}`;
const IS_DRAW = `#version 300 es
precision highp float;
uniform sampler2D uState; uniform vec2 uRes, uMouseCss;
uniform vec3 uDn, uUp, uAcc;
out vec4 fragColor;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float m=texture(uState,uv).r;
  float wall=4.0*m*(1.0-m);
  float dCur=distance(gl_FragCoord.xy,uMouseCss);
  float halo=exp(-dCur*dCur/(2.0*110.0*110.0));
  vec3 col=mix(uDn,uUp,m)+ (uAcc-mix(uDn,uUp,m))*pow(wall,2.0)*(0.55+0.35*halo);
  fragColor=vec4(col,1.0);
}`;

function initIsing() {
  const canvas = el("isingCanvas");
  if (!canvas) return;
  const pane = canvas.closest(".pane") || canvas.parentElement;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) {
    const plate = canvas.closest("section") || pane;
    if (plate) plate.style.display = "none";
    return;
  }
  const compile = (type, src) => {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const link = fsSrc => {
    const pr = gl.createProgram();
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, IS_VS));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  };
  let simProg, drawProg;
  try { simProg = link(IS_FS); drawProg = link(IS_DRAW); }
  catch (e) { console.error("Ising shader compile failed:", e); pane.style.display = "none"; return; }

  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const GRID_H = 270;
  let seedIndex = 0;
  let gridW = 0, gridH = 0, texA = null, texB = null, fboA = null, fboB = null, src = null, dst = null;
  const makeStateTex = (w, h, data) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  };
  const makeFbo = tex => {
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return f;
  };
  function allocate() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = Math.max(260, pane.clientWidth);
    /* same uniform height as every other plate — see .pane canvas, and
       the same hidden-view caveat as fit() */
    let cssH = Math.round(canvas.getBoundingClientRect().height);
    if (cssH < 40) {
      cssH = Math.round(cssW * (MOBILE ? 0.78 : 0.42));
      if (pane.clientWidth > 0) canvas.style.height = cssH + "px";
    }
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const aspect = canvas.width / Math.max(canvas.height, 1);
    gridH = GRID_H;
    gridW = 2 * Math.max(32, Math.round(gridH * aspect / 2));
    /* seed with large blocks, not noise — the plate opens onto calm,
       already-formed domains instead of a chaotic quench */
    const BLOCK = 34;
    const cw = Math.ceil(gridW / BLOCK), ch = Math.ceil(gridH / BLOCK);
    const coarse = new Uint8Array(cw * ch);
    const rnd = makeRNG(seedOf("ising", seedIndex, cw, ch));
    for (let i = 0; i < coarse.length; i++) coarse[i] = rnd() < 0.5 ? 0 : 255;
    const seed = new Uint8Array(gridW * gridH * 4);
    for (let y = 0; y < gridH; y++) for (let x = 0; x < gridW; x++) {
      const v = coarse[Math.floor(y / BLOCK) * cw + Math.floor(x / BLOCK)];
      const k = (y * gridW + x) * 4;
      seed[k] = v; seed[k + 3] = 255;
    }
    if (texA) {
      gl.deleteTexture(texA); gl.deleteTexture(texB);
      gl.deleteFramebuffer(fboA); gl.deleteFramebuffer(fboB);
    }
    texA = makeStateTex(gridW, gridH, seed);
    texB = makeStateTex(gridW, gridH, null);
    fboA = makeFbo(texA); fboB = makeFbo(texB);
    src = { tex: texA, fbo: fboA }; dst = { tex: texB, fbo: fboB };
  }
  allocate();

  const mouse = { gx: -1e4, gy: -1e4, cx: -1e4, cy: -1e4, sign: +1 };
  const rectToGrid = e => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    mouse.gx = x * gridW; mouse.gy = (1 - y) * gridH;
    mouse.cx = x * canvas.width; mouse.cy = (1 - y) * canvas.height;
  };
  const clearField = () => { mouse.gx = mouse.gy = mouse.cx = mouse.cy = -1e4; };
  let touchTimer = null;
  canvas.addEventListener("pointermove", rectToGrid);
  canvas.addEventListener("pointerleave", clearField);
  canvas.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") mouse.sign *= -1;
    rectToGrid(e);
    if (e.pointerType !== "mouse") { clearTimeout(touchTimer); touchTimer = setTimeout(clearField, 900); }
  });
  canvas.addEventListener("pointercancel", clearField);

  const tempSlider = el("tempSlider"), tempOut = el("tempOut"), magOut = el("magOut");
  let T = parseFloat(tempSlider.value) * TC;
  const syncTemp = () => {
    const r = parseFloat(tempSlider.value);
    T = r * TC;
    tempOut.textContent = r.toFixed(3);
    if (el("tagI")) el("tagI").innerHTML = "T/T<sub>c</sub> = " + r.toFixed(3);
    if (el("sReg")) el("sReg").textContent = r < 0.97 ? "ordered" : r > 1.03 ? "disordered" : "critical";
    if (el("flag5")) el("flag5").classList.toggle("on", Math.abs(r - 1) <= 0.03);
  };
  syncTemp();
  tempSlider.addEventListener("input", syncTemp);
  if (el("isingSeed")) el("isingSeed").addEventListener("click", () => {
    seedIndex++; passCount = 0; tick = 0; allocate();
  });

  const uS = {
    state: gl.getUniformLocation(simProg, "uState"), grid: gl.getUniformLocation(simProg, "uGrid"),
    T: gl.getUniformLocation(simProg, "uT"), mouse: gl.getUniformLocation(simProg, "uMouse"),
    hMouse: gl.getUniformLocation(simProg, "uHMouse"), sigma: gl.getUniformLocation(simProg, "uSigma"),
    pass: gl.getUniformLocation(simProg, "uPass"), parity: gl.getUniformLocation(simProg, "uParity"),
  };
  const uD = {
    state: gl.getUniformLocation(drawProg, "uState"), res: gl.getUniformLocation(drawProg, "uRes"),
    mouseCss: gl.getUniformLocation(drawProg, "uMouseCss"), dn: gl.getUniformLocation(drawProg, "uDn"),
    up: gl.getUniformLocation(drawProg, "uUp"), acc: gl.getUniformLocation(drawProg, "uAcc"),
  };

  let passCount = 0, frameCount = 0, tick = 0, visible = true;
  const resetTrajectory = () => { passCount = 0; tick = 0; };
  /* One Metropolis pass per nine frames (~6.7 passes/s at 60 Hz). Fast
     enough to equilibrate while the caption is read, slow enough that an
     individual domain wall can be followed by eye. */
  const FRAMES_PER_PASS = 9;
  const READ_EVERY = matchMedia("(pointer: coarse)").matches ? 90 : 30;
  let pixels = new Uint8Array(0);

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || document.hidden ||
        document.body.classList.contains("app-open") ||
        document.body.classList.contains("sim-paused")) return;
    if (++tick % FRAMES_PER_PASS === 0) {
      gl.useProgram(simProg); gl.bindVertexArray(vao);
      gl.viewport(0, 0, gridW, gridH);
      gl.uniform2i(uS.grid, gridW, gridH);
      gl.uniform1f(uS.T, T);
      gl.uniform1f(uS.hMouse, mouse.gx > -1e3 ? 5.0 * mouse.sign : 0.0);
      gl.uniform1f(uS.sigma, gridH * 0.055);
      gl.uniform2f(uS.mouse, mouse.gx, mouse.gy);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(uS.state, 0); gl.uniform1i(uS.pass, passCount);
      gl.uniform1i(uS.parity, passCount & 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [src, dst] = [dst, src]; passCount++;
    }
    if (++frameCount % READ_EVERY === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
      if (pixels.length !== gridW * gridH * 4) pixels = new Uint8Array(gridW * gridH * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0, cnt = 0;
      for (let i = 0; i < pixels.length; i += 24) { sum += pixels[i] > 127 ? 1 : -1; cnt++; }
      const m = sum / cnt;
      magOut.textContent = (m >= 0 ? "+" : "−") + Math.abs(m).toFixed(2);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(drawProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(uD.state, 0);
    gl.uniform2f(uD.res, canvas.width, canvas.height);
    gl.uniform2f(uD.mouseCss, mouse.cx, mouse.cy);
    /* spin down white, spin up vermilion, walls a deepened vermilion —
       maximum separation between the two phases at a glance */
    const dn = [255, 255, 255], up = P.rgbB2, acc = lerpRGB(P.rgbB2, P.rgbInk, 0.45);
    gl.uniform3f(uD.dn, dn[0] / 255, dn[1] / 255, dn[2] / 255);
    gl.uniform3f(uD.up, up[0] / 255, up[1] / 255, up[2] / 255);
    gl.uniform3f(uD.acc, acc[0] / 255, acc[1] / 255, acc[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  new IntersectionObserver(en => { visible = en[0].isIntersecting; }, { threshold: 0.02 }).observe(canvas);
  let resizeTimer;
  const refit = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(allocate, 200); };
  addEventListener("resize", refit);
  /* the lattice reallocates when its container gets a size, so the plate
     is never left at the placeholder 300×150 after a view switch */
  REDRAW.push(() => { if (pane.clientWidth > 2 && Math.abs(pane.clientWidth * Math.min(devicePixelRatio || 1, 2) - canvas.width) > 8) allocate(); });
  sizeWatch(pane);
  requestAnimationFrame(frame);

  const pauseBtn = el("heroPause");
  if (pauseBtn) pauseBtn.addEventListener("click", () => {
    const paused = document.body.classList.toggle("sim-paused");
    pauseBtn.setAttribute("aria-pressed", String(paused));
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  });
}

/* ═══ RECORD — publications / timeline ════════════════════════ */
const PROFILE = {
  publications: [
    { key: "2025 · Peer-reviewed",
      title: "Emergence and tunability of Fermi-pocket and electronic instabilities in layered Nickelates",
      authors: "A. Sheth, C. Lacroix, S. Burdin",
      venue: "Journal of Physics: Condensed Matter 37, 125703 (2025)",
      links: [
        { label: "doi:10.1088/1361-648X/ada908", url: "https://doi.org/10.1088/1361-648X/ada908" },
        { label: "arXiv:2407.16042", url: "https://arxiv.org/abs/2407.16042" }] },
    { key: "2025 · Doctoral thesis",
      title: "Theoretical modelling of infinite-layer nickelates",
      authors: "A. Sheth",
      venue: "PhD thesis, Université de Bordeaux (2025)",
      links: [{ label: "theses.hal.science/tel-05502836", url: "https://theses.hal.science/tel-05502836" }] },
    { key: "2021 · Preprint",
      title: "Background for the Self Consistent Renormalisation (SCR) Theory",
      authors: "B. Devanarayanan, A. Sharma, A. Sheth, et al.",
      venue: "arXiv:2108.12683 [cond-mat.str-el]",
      links: [{ label: "arXiv:2108.12683", url: "https://arxiv.org/abs/2108.12683" }] },
  ],
  timeline: [
    { key: "2021 – 2025",
      title: "Doctoral Researcher, Laboratoire Ondes et Matière d'Aquitaine (UMR 5798, CNRS), Université de Bordeaux",
      points: [
        "Constructed effective multi-orbital models separating infinite-layer nickelate physics from the cuprate paradigm",
        "Identified antiferromagnetic and charge-order instabilities driven by Fermi-surface nesting",
        "Developed Python and Fortran simulation modules with automated high-performance computing workflows, cutting compute time by ~35%"] },
    { key: "2022",
      title: "Research Intern in Data Science, Uresearcher, Berlin",
      points: [
        "Automated data-extraction pipelines built on public interfaces, removing ~70% of manual pre-processing",
        "Applied predictive machine-learning models to drug-design datasets, improving hit prediction by ~15%"] },
    { key: "2020 – 2021",
      title: "Research Fellow, The Maharaja Sayajirao University of Baroda",
      points: [
        "Performed density functional theory and molecular dynamics simulations of boron-based nanomaterials for radiation shielding",
        "Designed modular HPC workflows over 20+ structural parameter sets, accelerating design cycles by ~50%",
        "Presented a density-functional study of twisted graphene / hexagonal boron nitride moiré heterostructures at ICAFMOD 2020"] },
    { key: "2018 – 2021",
      title: "Research Intern, Physical Research Laboratory",
      points: [
        "Computed the non-linear alternating-current admittance of materials",
        "Analysed transport properties using second-order perturbation theory and the Kubo formalism",
        "Determined critical size thresholds for superconducting nanoparticles used in magnetic sensor design"] },
  ],
};
function esc(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
function initRecord() {
  /* Each crest is a drawn placeholder with the real image stacked over
     it. A PNG with any transparency let the placeholder's lettering read
     through as stray text, so the placeholder is removed the moment the
     image is known to have loaded (and kept if it never does). */
  document.querySelectorAll(".edu-crest img").forEach(img => {
    const drop = () => { const svg = img.parentElement.querySelector("svg"); if (svg) svg.remove(); };
    if (img.complete && img.naturalWidth > 0) drop();
    else img.addEventListener("load", drop, { once: true });
  });
  const pub = el("pubList"), tl = el("timelineList");
  if (pub) pub.innerHTML = PROFILE.publications.map(p => `
    <div class="entry">
      <span class="entry-key">${esc(p.key)}</span>
      <span class="entry-title">${esc(p.title)}</span>
      <span class="entry-sub">${esc(p.authors)} — <em>${esc(p.venue)}</em><br>
        ${p.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}
      </span>
    </div>`).join("");
  if (tl) tl.innerHTML = PROFILE.timeline.map(t => `
    <div class="entry">
      <span class="entry-key">${esc(t.key)}</span>
      <span class="entry-title">${esc(t.title)}</span>
      <ul>${t.points.map(pt => `<li>${esc(pt)}</li>`).join("")}</ul>
    </div>`).join("");

  document.querySelectorAll(".cvtabs").forEach(bar => {
    const cv = bar.parentElement;
    const btns = [...bar.querySelectorAll("button[data-tab]")];
    btns.forEach((b, i) => {
      const on = b.classList.contains("on");
      b.setAttribute("aria-selected", String(on));
      b.setAttribute("aria-controls", "pane-" + b.dataset.tab);
      b.tabIndex = on ? 0 : -1;
      const pane = cv.querySelector("#pane-" + b.dataset.tab);
      if (pane) { pane.setAttribute("aria-labelledby", "tab-" + b.dataset.tab); pane.hidden = !on; }
      b.id = "tab-" + b.dataset.tab;
    });
    /* arrow keys move between tabs, as the tablist pattern requires */
    bar.addEventListener("keydown", e => {
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = btns[(i + d + btns.length) % btns.length];
      next.focus(); next.click();
    });
    bar.addEventListener("click", e => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      bar.querySelectorAll("button").forEach(b => {
        const on = b === btn;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      cv.querySelectorAll(".cvpane").forEach(p => {
        const on = p.id === "pane-" + btn.dataset.tab;
        p.classList.toggle("on", on);
        p.hidden = !on;
      });
    });
  });
}

/* ═══ hover/tap definitions ═══════════════════════════════════
   Hover and keyboard focus are handled in CSS. Touch has neither,
   so a tap toggles the tooltip and any outside tap closes it.
   ═════════════════════════════════════════════════════════════ */
function initTerms() {
  document.addEventListener("click", e => {
    const t = e.target.closest(".term");
    document.querySelectorAll(".term.open").forEach(o => { if (o !== t) o.classList.remove("open"); });
    if (t) t.classList.toggle("open");
  });
}

/* ═══ TELEMETRY — dot-matrix visitor map (Vercel KV backend) ═══
   Land mask: 128×56 equirectangular grid, lat +72 → −56,
   precomputed from a public land dataset and packed as hex.
   ═════════════════════════════════════════════════════════════ */
const TELEMETRY_ENDPOINT = "https://asheth-github-io.vercel.app/api/telemetry";
const LAND_HEX = "00C003E2FC03FF00000010FBFFFDFD8087FFFE61A707FC0007F90FEFFFFFFFFF65FFFFFF83C7F00007F5FFFFFFFFFFFF01FFFFFF6383C0C00EFBFFFFFFFFFFFF07FFFFFE0C0180003CFFFFFFFFFFFF7C0383FFFC0E0000003E7FFFFFFFFFFA4000407FFF07C000021E7FFFFFFFFF80C004007FFFEFE0000701FFFFFFFFFF01C000003FFFEFF00005BFFFFFFFFFFFE00000001FFFFFE000007FFFFFFFFFFFC000000007FFFF180003FFFFFFFFFFFFC00000000FFFFFE00000FFE7FFFFFFFF800000000FFFFE0000058BC3FFFFFFFF300000000FFFFC00000785F9FFFFFFFC000000000FFFF8000007813FFFFFFFCC0000000007FFF80000007037FFFFFFE44000000003FFF0000003F007FFFFFFE08000000003FFE0000007F98FFFFFFFE20000000000FF2000000FFFFFBFFFFFE00000000001780000001FFFF79FFFFFE00000000000F80000001FFFF7C0FFFFC00000000000383000003FFFFBF87FFF800000000000188000003FFFFBF83E7C0000000000001D8A80003FFFFDF03C3C000000000000050000003FFFFDE0385C00000000000000C000003FFFFF80181E100000000000004100003FFFFE0010061800000000000035C0001FFFFFC01814000000000000000FE0000FFFFFC008104800000000000007FC00043FFF800028400000000000000FFC00001FFF000018C00000000000010FFC00001FFE000019C00000000000001FFF00001FFC000009A0C000000000001FFFE0000FFC00000400F000000000000FFFF00007FC000007007000000000000FFFE00007FC000000082800000000000FFFE00007FC0000000202000000000007FFC0000FFC4000000320000000000003FFC0000FFCC000000FB0100000000001FFC0000FF8C000001FF0000000000001FFC00007F08000003FF8200000000001FF800007F9800000FFFC000000000001FE000007F0800000FFFE000000000001FE000007F00000007FFC000000000001FC000003E00000007FFE000000000001FC000001C00000007DFC000000000003F800000100000000407C000000000003F0000000000000000038000000000003E0000000000000000000020000000003C000000000000000001806000000000380000000000000000000080000000007000000000000000000001800000000078000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000018000000000000000000000";
const MAP_W = 128, MAP_H = 56, LAT_TOP = 72, LAT_BOT = -56;
function landAt(i, j) {
  const bit = j * MAP_W + i, nib = parseInt(LAND_HEX[bit >> 2], 16);
  return (nib >> (3 - (bit & 3))) & 1;
}
const lonLatToXY = (lon, lat, w, h) =>
  [((lon + 180) / 360) * w, ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * h];
const COUNTRY_POS = {
  US: [-98, 39], CA: [-106, 56], MX: [-102, 23], BR: [-52, -10], AR: [-64, -34],
  CL: [-71, -33], CO: [-73, 4], PE: [-76, -10], GB: [-2, 54], IE: [-8, 53],
  FR: [2, 46], DE: [10, 51], NL: [5, 52], BE: [4.5, 50.8], CH: [8, 47],
  AT: [14, 47.5], ES: [-4, 40], PT: [-8, 39.5], IT: [12.5, 42], SE: [15, 62],
  NO: [9, 61], DK: [10, 56], FI: [26, 62], PL: [19, 52], CZ: [15.5, 49.8],
  GR: [22, 39], TR: [35, 39], RU: [44, 56], UA: [32, 49], RO: [25, 46],
  HU: [19, 47], IN: [78, 22], CN: [110, 32], JP: [138, 36], KR: [128, 36.5],
  SG: [103.8, 1.35], MY: [102, 3.5], TH: [101, 15], VN: [107, 16],
  ID: [113, -2], PH: [122, 12], AU: [134, -25], NZ: [173, -41],
  ZA: [25, -29], NG: [8, 9], EG: [30, 26], KE: [37.8, 0.5], MA: [-6, 32],
  SA: [45, 24], AE: [54, 24], IL: [35, 31.5], PK: [70, 30], BD: [90, 24],
  LK: [80.7, 7.5], TW: [121, 23.7], HK: [114.2, 22.3],
};
function initTelemetry() {
  const canvas = el("mapCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let visitor = null, countries = [], W = 0, H = 0;
  const base = document.createElement("canvas");

  function buildBase() {
    /* in the mobile shell the contact view is display:none until its tab
       is chosen, so the parent measures zero. Building a 0×0 base and
       then drawing it throws, so measurement is the gate: bail out and
       let the tab switch (which fires redrawAll) build it for real. */
    const cssW = Math.min(canvas.parentElement.clientWidth, 860);
    if (cssW < 2) { W = H = 0; return false; }
    W = Math.floor(cssW * dpr);
    H = Math.floor(W * (MAP_H / MAP_W));
    canvas.width = W; canvas.height = H;
    canvas.style.height = H / dpr + "px";
    base.width = W; base.height = H;
    const b = base.getContext("2d");
    const sx = W / MAP_W, sy = H / MAP_H, r = Math.max(0.8, sx * 0.22);
    b.clearRect(0, 0, W, H);
    b.fillStyle = P.soft; b.globalAlpha = .5;
    for (let j = 0; j < MAP_H; j++) for (let i = 0; i < MAP_W; i++) if (landAt(i, j)) {
      b.beginPath(); b.arc((i + 0.5) * sx, (j + 0.5) * sy, r, 0, 6.2832); b.fill();
    }
    b.globalAlpha = 1;
    /* every country that has ever visited: a badge whose radius grows
       ~log(count) so 1 and 500 both read. Drawn into the static base
       so the animation loop stays cheap. */
    for (const { code, count } of countries) {
      const pos = COUNTRY_POS[code];
      if (!pos) continue;
      const [cx, cy] = lonLatToXY(pos[0], pos[1], W, H);
      const label = count > 999 ? "1k+" : String(count);
      const br = sx * (1.15 + 0.45 * Math.log10(1 + count));
      b.fillStyle = P.paper;
      b.beginPath(); b.arc(cx, cy, br, 0, 6.2832); b.fill();
      b.strokeStyle = P.b2; b.lineWidth = Math.max(1, 0.14 * br);
      b.beginPath(); b.arc(cx, cy, br, 0, 6.2832); b.stroke();
      const fs = br * (label.length > 2 ? 0.85 : 1.1);
      b.font = `500 ${fs}px "JetBrains Mono", monospace`;
      b.textAlign = "center"; b.textBaseline = "middle";
      b.fillStyle = P.b2;
      b.fillText(label, cx, cy + 0.05 * fs);
    }
    return true;
  }
  let t0 = performance.now(), visible = false, rafId = null;
  function drawFrame(now) {
    if (!W || !H) { rafId = null; return; }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    if (visitor) {
      const [vx, vy] = visitor;
      const phase = REDUCE ? 0.5 : ((now - t0) / 1800) % 1;
      ctx.strokeStyle = P.b1; ctx.globalAlpha = 0.7 * (1 - phase);
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(vx, vy, (3 + 11 * phase) * dpr * 0.6, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = P.b1;
      ctx.beginPath(); ctx.arc(vx, vy, 2.2 * dpr * 0.7, 0, 6.2832); ctx.fill();
    }
    if (visible && !REDUCE && visitor) rafId = requestAnimationFrame(drawFrame);
    else rafId = null;
  }
  const kick = () => { if (!rafId) rafId = requestAnimationFrame(drawFrame); };
  const relocate = geo => {
    if (geo && Number.isFinite(geo.lon) && Number.isFinite(geo.lat) && W)
      visitor = lonLatToXY(geo.lon, geo.lat, W, H);
  };
  new IntersectionObserver(en => { visible = en[0].isIntersecting; if (visible) kick(); },
    { threshold: 0.1 }).observe(canvas);
  /* geo is stored as lon/lat and only projected at draw time, so a
     resize or a late first measurement re-places the pulse correctly */
  let lastGeo = null;
  buildBase(); kick();
  sizeWatch(canvas.parentElement);
  addEventListener("resize", () => { if (buildBase()) { relocate(lastGeo); kick(); } });
  REDRAW.push(() => { if (buildBase()) { relocate(lastGeo); kick(); } });

  /* First call POSTs to register this visit — exactly once per browser
     session (sessionStorage guard), so reloads and polls never inflate
     counts. Subsequent GETs are read-only. */
  async function fetchTelemetry(registerHit = false) {
    try {
      const res = await fetch(TELEMETRY_ENDPOINT, { method: registerHit ? "POST" : "GET" });
      const data = await res.json();
      if (data.countries && Array.isArray(data.countries)) { countries = data.countries; buildBase(); kick(); }
      if (data.current) { lastGeo = data.current; relocate(lastGeo); kick(); }
    } catch (e) {
      /* The endpoint being down is an operational detail, not something
         to report to a reader. The map is drawn from the local land
         mask and stands on its own, so a failed fetch simply leaves the
         badges unpopulated and says nothing. */
    }
  }
  const HIT_KEY = "telemetry-hit";
  const already = sessionStorage.getItem(HIT_KEY) === "1";
  if (!already) sessionStorage.setItem(HIT_KEY, "1");
  fetchTelemetry(!already);
  /* poll only while the tab is visible; refresh immediately on return */
  setInterval(() => { if (!document.hidden) fetchTelemetry(false); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchTelemetry(false); });
}

/* ═══ QUANTUM PORTFOLIO — in-place launch ═════════════════════ */
function initAppLaunch() {
  const overlay = el("appOverlay"), frame = el("appFrame");
  const openBtn = el("launchAppBtn"), linkBtn = el("launchAppLink"), closeBtn = el("appCloseBtn");
  if (!overlay || !openBtn) return;
  let lastFocus = null;
  const trap = e => {
    if (e.key !== "Tab" || overlay.hidden) return;
    const f = [...overlay.querySelectorAll("button,iframe,[href],input,select,textarea")]
      .filter(n => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const open = () => {
    if (!frame.getAttribute("src")) {
      /* deferred until first open so the instrument's own scripts and
         canvases cost nothing to a visitor who never launches it */
      frame.src = "portfolio.html";
    }
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add("app-open");
    closeBtn.focus();
    document.addEventListener("keydown", trap);
  };
  const close = () => {
    overlay.hidden = true;
    document.body.classList.remove("app-open");
    document.removeEventListener("keydown", trap);
    (lastFocus || openBtn).focus();
  };
  openBtn.addEventListener("click", open);
  if (linkBtn) linkBtn.addEventListener("click", e => { e.preventDefault(); open(); });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) close(); });
}

/* ═══ chrome — progress, rail, section counter ════════════════ */
function initChrome() {
  const pct = el("pct"), cnt = el("secCount");
  const links = [...document.querySelectorAll(".rail a")];
  if (!links.length && !pct) return;
  const secs = links.map(a => document.querySelector(a.getAttribute("href")));
  const total = String(links.length).padStart(2, "0");
  function up() {
    const f = scrollY / (document.body.scrollHeight - innerHeight || 1);
    if (pct) pct.textContent = String(Math.round(Math.min(1, Math.max(0, f)) * 100)).padStart(3, "0") + "%";
    let cur = 0;
    secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * .45) cur = i; });
    links.forEach((a, i) => a.classList.toggle("on", i === cur));
    if (cnt) cnt.textContent = String(cur + 1).padStart(2, "0") + " / " + total;
  }
  addEventListener("scroll", up, { passive: true });
  up();
}

/* ═══ slider a11y — announce the formatted value, not the raw one ═ */
function initSliderA11y() {
  document.querySelectorAll('input[type="range"]').forEach(input => {
    /* WebKit has no ::-moz-range-progress equivalent, so the filled
       portion of the track is a gradient stop driven from here. Firefox
       paints its own progress pseudo-element and ignores --fill. */
    const paint = () => {
      const min = +input.min || 0;
      const max = input.max === "" ? 100 : +input.max;
      const span = max - min;
      input.style.setProperty("--fill", span ? ((+input.value - min) / span).toFixed(4) : 0);
    };
    paint();
    input.addEventListener("input", paint);

    const out = input.parentElement.querySelector("output");
    if (!out) return;
    const sync = () => input.setAttribute("aria-valuetext", out.textContent.trim());
    sync();
    input.addEventListener("input", () => requestAnimationFrame(sync));
  });
}

/* ══ boot ═════════════════════════════════════════════════════ */
function boot() {
  if (el("year")) el("year").textContent = new Date().getFullYear();
  initTheme();
  initLoader();
  initReveal();
  initAmbient();
  initFermi();
  initChi();
  initAnneal();
  initMoire();
  initIsing();
  initRecord();
  initTerms();
  initTelemetry();
  initAppLaunch();
  initChrome();
  initSliderA11y();
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(redrawAll, 180); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
