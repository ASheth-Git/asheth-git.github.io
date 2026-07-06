/* ================================================================
   ALPESH SHETH — site engine
   ----------------------------------------------------------------
   hero      2D Ising model (Metropolis, GPU), sub-critical: large
             domains coarsening slowly. Cursor = local field.
   modules   nickelate fermiology · spin-glass annealer · moiré
   data      publications / timeline / live GitHub feed
   telemetry dot-matrix world map + visit counter
   ================================================================ */
"use strict";

/* ================================================================
   DATA_SOURCES — plug endpoints here.
   publicationsURL / timelineURL : JSON files or API proxies; when
     null the inline PROFILE below is used.
   counterNamespace : namespace for the anonymous per-country visit
     counters that feed the telemetry map (abacus.jasoncameron.dev).
   ================================================================ */
const DATA_SOURCES = {
  publicationsURL: null,
  timelineURL: null,
  counterNamespace: "asheth-github-io",
};

const PROFILE = {
  publications: [
    {
      key: "2025 · Peer-reviewed",
      title: "Emergence and tunability of Fermi-pocket and electronic instabilities in layered Nickelates",
      authors: "A. Sheth, et al.",
      venue: "Journal of Physics: Condensed Matter 37, 125703 (2025)",
      links: [
        { label: "doi:10.1088/1361-648X/ada908", url: "https://doi.org/10.1088/1361-648X/ada908" },
        { label: "arXiv:2407.16042", url: "https://arxiv.org/abs/2407.16042" },
      ],
    },
    {
      key: "2025 · Doctoral Thesis",
      title: "Theoretical modelling of infinite-layer nickelates",
      authors: "A. Sheth",
      venue: "PhD thesis, Université de Bordeaux (2025)",
      links: [
        { label: "theses.hal.science/tel-05502836", url: "https://theses.hal.science/tel-05502836" },
      ],
    },
    {
      key: "2021 · Preprint",
      title: "Background for the Self Consistent Renormalisation (SCR) Theory",
      authors: "B. Devanarayanan, A. Sharma, A. Sheth, et al.",
      venue: "arXiv:2108.12683 [cond-mat.str-el]",
      links: [{ label: "arXiv:2108.12683", url: "https://arxiv.org/abs/2108.12683" }],
    },
  ],
  timeline: [
    {
      key: "2021 – 2025",
      title: "Doctoral Researcher, Laboratoire Ondes et Matière d'Aquitaine (UMR 5798, CNRS), Université de Bordeaux",
      points: [
        "Constructed effective multi-orbital models separating infinite-layer nickelate physics from the cuprate paradigm",
        "Identified antiferromagnetic and charge-order instabilities driven by Fermi-surface nesting",
        "Developed Python and Fortran simulation modules with automated high-performance computing workflows",
      ],
    },
    {
      key: "2022",
      title: "Research Intern in Data Science, Uresearcher",
      points: [
        "Automated data-extraction pipelines built on public interfaces",
        "Applied predictive machine-learning models to drug-design datasets",
      ],
    },
    {
      key: "2020 – 2021",
      title: "Research Fellow, The Maharaja Sayajirao University of Baroda",
      points: [
        "Performed density functional theory and molecular dynamics simulations of boron-based nanomaterials for radiation shielding",
        "Presented a density-functional study of twisted graphene and hexagonal boron nitride moiré heterostructures at ICAFMOD 2020",
      ],
    },
    {
      key: "2018 – 2021",
      title: "Research Intern, Physical Research Laboratory",
      points: [
        "Computed the non-linear alternating-current admittance of materials",
        "Analyzed transport properties using second-order perturbation theory and the Kubo formalism",
        "Determined critical size thresholds for superconducting nanoparticles used in magnetic sensor design",
      ],
    },
  ],
};

/* ================================================================
   HERO — GPU ISING MODEL
   H = −J Σ s_i s_j − Σ h_i s_i, J = 1.  T_c = 2/ln(1+√2) ≈ 2.269.
   Held below T_c by default (T = 0.86 T_c): the system coarsens —
   a few large domains with smooth, slowly moving walls — instead of
   critical noise. One Monte-Carlo sweep per frame keeps the motion
   deliberate. Checkerboard-parallel Metropolis preserves detailed
   balance (neighbors of an updating site are always frozen).
   ================================================================ */
const TC = 2.0 / Math.log(1.0 + Math.SQRT2);

const SIM_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SIM_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform ivec2 uGrid;
uniform float uT;
uniform vec2  uMouse;      // grid coords; -1e4 when off-canvas
uniform float uHMouse;     // cursor field strength (signed)
uniform float uSigma;
uniform int   uPass;
uniform int   uParity;
out vec4 fragColor;

uint hash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u; return x;
}
float rnd(ivec2 p, int f) {
  uint h = hash(uint(p.x) + hash(uint(p.y) + hash(uint(f))));
  return float(h) * (1.0 / 4294967296.0);
}
float spinAt(ivec2 p) {
  p = ivec2(mod(vec2(p), vec2(uGrid)));
  return texelFetch(uState, p, 0).r > 0.5 ? 1.0 : -1.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float s = spinAt(p);
  if (((p.x + p.y) & 1) == uParity) {
    float nn = spinAt(p + ivec2( 1, 0)) + spinAt(p + ivec2(-1, 0))
             + spinAt(p + ivec2( 0, 1)) + spinAt(p + ivec2( 0,-1));
    vec2 d = vec2(p) - uMouse;
    float h = uHMouse * exp(-dot(d, d) / (2.0 * uSigma * uSigma));
    float dE = 2.0 * s * (nn + h);
    if (dE <= 0.0 || rnd(p, uPass) < exp(-dE / max(uT, 1e-4))) s = -s;
  }
  fragColor = vec4(s * 0.5 + 0.5, 0.0, 0.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;    // LINEAR-filtered: smooth magnetization field
uniform vec2  uRes;
uniform vec2  uMouseCss;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float m = texture(uState, uv).r;
  float wall = 4.0 * m * (1.0 - m);        // peaks on domain walls

  vec3 colDn = vec3(0.010, 0.022, 0.040);
  vec3 colUp = vec3(0.014, 0.058, 0.070);
  vec3 cyan  = vec3(0.13, 0.90, 0.84);

  float dCur = distance(gl_FragCoord.xy, uMouseCss);
  float halo = exp(-dCur * dCur / (2.0 * 110.0 * 110.0));

  vec3 col = mix(colDn, colUp, m)
           + cyan * pow(wall, 2.0) * (0.07 + 0.25 * halo);

  vec2 q = uv - 0.5;
  col *= 1.0 - 0.5 * dot(q, q);
  fragColor = vec4(col, 1.0);
}`;

function initIsing() {
  const canvas = document.getElementById("isingCanvas");
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) {
    document.getElementById("heroFallback").hidden = false;
    document.getElementById("hud").style.display = "none";
    canvas.style.display = "none";
    return;
  }

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const link = (fsSrc) => {
    const pr = gl.createProgram();
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, SIM_VS));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  };

  let simProg, drawProg;
  try { simProg = link(SIM_FS); drawProg = link(DRAW_FS); }
  catch (e) {
    console.error("Shader compile failed:", e);
    document.getElementById("heroFallback").hidden = false;
    return;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const GRID_H = 270;
  let gridW = 0, gridH = 0;
  let texA = null, texB = null, fboA = null, fboB = null;
  let src = null, dst = null;

  const makeStateTex = (w, h, data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  };
  const makeFbo = (tex) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return f;
  };

  function allocate() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    const aspect = canvas.width / Math.max(canvas.height, 1);
    gridH = GRID_H;
    gridW = 2 * Math.max(32, Math.round(gridH * aspect / 2));  // even dims

    /* seed with large blocks, not noise — the page opens onto calm,
       already-formed domains instead of a chaotic quench */
    const BLOCK = 34;
    const cw = Math.ceil(gridW / BLOCK), ch = Math.ceil(gridH / BLOCK);
    const coarse = new Uint8Array(cw * ch);
    for (let i = 0; i < coarse.length; i++) coarse[i] = Math.random() < 0.5 ? 0 : 255;
    const n = gridW * gridH * 4;
    const seed = new Uint8Array(n);
    for (let y = 0; y < gridH; y++)
      for (let x = 0; x < gridW; x++) {
        const v = coarse[Math.floor(y / BLOCK) * cw + Math.floor(x / BLOCK)];
        const k = (y * gridW + x) * 4;
        seed[k] = v; seed[k + 3] = 255;
      }

    if (texA) { gl.deleteTexture(texA); gl.deleteTexture(texB);
                gl.deleteFramebuffer(fboA); gl.deleteFramebuffer(fboB); }
    texA = makeStateTex(gridW, gridH, seed);
    texB = makeStateTex(gridW, gridH, null);
    fboA = makeFbo(texA);
    fboB = makeFbo(texB);
    src = { tex: texA, fbo: fboA };
    dst = { tex: texB, fbo: fboB };
  }
  allocate();

  const mouse = { gx: -1e4, gy: -1e4, cx: -1e4, cy: -1e4, sign: +1 };
  const rectToGrid = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    mouse.gx = x * gridW;
    mouse.gy = (1 - y) * gridH;
    mouse.cx = x * canvas.width;
    mouse.cy = (1 - y) * canvas.height;
  };
  const clearField = () => {
    mouse.gx = mouse.gy = mouse.cx = mouse.cy = -1e4;
  };
  let touchTimer = null;
  canvas.addEventListener("pointermove", rectToGrid);
  canvas.addEventListener("pointerleave", clearField);
  canvas.addEventListener("pointerdown", (e) => {
    /* mouse: click reverses the field sign. touch: a tap plants the field
       and lets it linger briefly, magnetizing a spot that then relaxes */
    if (e.pointerType === "mouse") mouse.sign *= -1;
    rectToGrid(e);
    if (e.pointerType !== "mouse") {
      clearTimeout(touchTimer);
      touchTimer = setTimeout(clearField, 900);
    }
  });
  canvas.addEventListener("pointercancel", clearField);

  const tempSlider = document.getElementById("tempSlider");
  const tempOut = document.getElementById("tempOut");
  const magOut  = document.getElementById("magOut");
  let T = parseFloat(tempSlider.value) * TC;
  tempOut.textContent = parseFloat(tempSlider.value).toFixed(3);
  tempSlider.addEventListener("input", () => {
    T = parseFloat(tempSlider.value) * TC;
    tempOut.textContent = parseFloat(tempSlider.value).toFixed(3);
  });

  const uS = {
    state:  gl.getUniformLocation(simProg, "uState"),
    grid:   gl.getUniformLocation(simProg, "uGrid"),
    T:      gl.getUniformLocation(simProg, "uT"),
    mouse:  gl.getUniformLocation(simProg, "uMouse"),
    hMouse: gl.getUniformLocation(simProg, "uHMouse"),
    sigma:  gl.getUniformLocation(simProg, "uSigma"),
    pass:   gl.getUniformLocation(simProg, "uPass"),
    parity: gl.getUniformLocation(simProg, "uParity"),
  };
  const uD = {
    state:    gl.getUniformLocation(drawProg, "uState"),
    res:      gl.getUniformLocation(drawProg, "uRes"),
    mouseCss: gl.getUniformLocation(drawProg, "uMouseCss"),
  };

  let passCount = 0, frameCount = 0, heroVisible = true;
  const PASSES_PER_FRAME = 2;                 // one MC sweep per frame
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* GPU readback stalls the pipeline; on touch devices poll magnetization
     less often to keep the simulation smooth */
  const READ_EVERY = matchMedia("(pointer: coarse)").matches ? 90 : 30;
  let pixels = new Uint8Array(0);

  function frame() {
    if (!heroVisible || document.hidden || document.body.classList.contains("app-open")) {
      requestAnimationFrame(frame);
      return;
    }
    gl.useProgram(simProg);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, gridW, gridH);
    gl.uniform2i(uS.grid, gridW, gridH);
    gl.uniform1f(uS.T, T);
    gl.uniform1f(uS.hMouse, mouse.gx > -1e3 ? 5.0 * mouse.sign : 0.0);
    gl.uniform1f(uS.sigma, gridH * 0.055);
    gl.uniform2f(uS.mouse, mouse.gx, mouse.gy);
    for (let i = 0; i < PASSES_PER_FRAME; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(uS.state, 0);
      gl.uniform1i(uS.pass, passCount);
      gl.uniform1i(uS.parity, passCount & 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [src, dst] = [dst, src];
      passCount++;
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(uD.state, 0);
    gl.uniform2f(uD.res, canvas.width, canvas.height);
    gl.uniform2f(uD.mouseCss, mouse.cx, mouse.cy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!reduceMotion) requestAnimationFrame(frame);
  }

  new IntersectionObserver(
    (en) => { heroVisible = en[0].isIntersecting; },
    { threshold: 0.02 }
  ).observe(canvas);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(allocate, 200);
  });

  requestAnimationFrame(frame);
  if (reduceMotion) {
    for (let i = 0; i < 40; i++) requestAnimationFrame(frame);
  }
}

/* ================================================================
   MODULE — NICKELATE FERMIOLOGY
   ε₁(k) = −2t(cos kx + cos ky) + 4t′ cos kx cos ky − μ
   ε₂(k) = Δz − 0.8(cos kx + cos ky) − μ
   E±(k) = ½(ε₁+ε₂) ± √(¼(ε₁−ε₂)² + V²)
   Plotted: A(k, ω=0) = Σ± Γ²/(E±² + Γ²).
   ================================================================ */
function initFermi() {
  const canvas = document.getElementById("fermiCanvas");
  const ctx = canvas.getContext("2d");
  const N = 180;
  const img = ctx.createImageData(N, N);
  const off = document.createElement("canvas");
  off.width = off.height = N;
  const offCtx = off.getContext("2d");

  const muS = document.getElementById("muSlider");
  const tpS = document.getElementById("tpSlider");
  const vS  = document.getElementById("vSlider");
  const muO = document.getElementById("muOut");
  const tpO = document.getElementById("tpOut");
  const vO  = document.getElementById("vOut");

  function render() {
    const mu = parseFloat(muS.value);
    const tp = parseFloat(tpS.value);
    const V  = parseFloat(vS.value);
    muO.textContent = (mu < 0 ? "−" : "+") + Math.abs(mu).toFixed(2);
    tpO.textContent = tp.toFixed(3);
    vO.textContent  = V.toFixed(3);

    const G = 0.07, G2 = G * G, V2 = V * V, dz = 1.35;
    const d = img.data;
    for (let j = 0; j < N; j++) {
      const ky = -Math.PI + (2 * Math.PI * j) / (N - 1);
      const cy = Math.cos(ky);
      for (let i = 0; i < N; i++) {
        const kx = -Math.PI + (2 * Math.PI * i) / (N - 1);
        const cx = Math.cos(kx);
        const e1 = -2 * (cx + cy) + 4 * tp * cx * cy - mu;
        const e2 = dz - 0.8 * (cx + cy) - mu;
        const avg = 0.5 * (e1 + e2);
        const hlf = 0.5 * (e1 - e2);
        const rt  = Math.sqrt(hlf * hlf + V2);
        const Ep = avg + rt, Em = avg - rt;
        let A = G2 / (Ep * Ep + G2) + G2 / (Em * Em + G2);
        if (A > 1) A = 1;
        const p = 4 * (j * N + i);
        const hot = A * A * A;
        d[p]     = Math.round(255 * (0.10 * A + 0.90 * hot));
        d[p + 1] = Math.round(255 * (0.88 * A));
        d[p + 2] = Math.round(255 * (0.82 * A + 0.06));
        d[p + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    /* --- overlay: zone frame, axes, high-symmetry points --- */
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.strokeStyle = "rgba(43, 66, 88, 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.font = "12px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(160, 180, 198, 0.95)";
    /* kx axis, bottom (left edge kx = −π, right edge +π) */
    ctx.fillText("−π", 6, H - 8);
    ctx.fillText("kx", W / 2 - 8, H - 8);
    ctx.fillText("+π", W - 26, H - 8);
    /* ky axis, left (top row ky = −π, bottom +π) */
    ctx.fillText("−π", 6, 16);
    ctx.save();
    ctx.translate(14, H / 2 + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ky", 0, 0);
    ctx.restore();
    /* high-symmetry points: Γ (0,0) center · X (π,0) right mid · M (π,π) corner */
    const mark = (x, y, label, dx, dy) => {
      ctx.fillStyle = "rgba(255, 154, 60, 0.9)";
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(215, 227, 238, 0.9)";
      ctx.fillText(label, x + dx, y + dy);
    };
    mark(W / 2, H / 2, "Γ", 7, -6);
    mark(W - 2, H / 2, "X", -16, -7);
    mark(W - 2, H - 2, "M", -16, -20);   /* raised clear of the +π tick */
    ctx.restore();
  }
  [muS, tpS, vS].forEach(s => s.addEventListener("input", render));
  render();
}

/* ================================================================
   MODULE — QUANTUM-INSPIRED PORTFOLIO OPTIMIZER (widget)
   E(x) = −Σ h_i x_i + λ Σ J_ij x_i x_j + A(Σx − K)²
   Textbook single-flip simulated annealing on a bundled ten-asset
   demonstration snapshot. The full application (launched below)
   adds sector constraints and telemetry; its production constraint
   encoding is proprietary and does not live in this repository.
   ================================================================ */
const WIDGET_ASSETS = {
  AAPL: 0.339, TSLA: 0.721, MSFT: 0.164, PFE: -0.032, XOM: 0.085,
  V: 0.221, JNJ: 0.078, AMZN: 0.432, JPM: 0.384, NVDA: 0.902,
};

function initPortfolio() {
  const ring = document.getElementById("spinRing");
  const rctx = ring.getContext("2d");
  const eCanvas = document.getElementById("energyCanvas");
  const eCtx = eCanvas.getContext("2d");
  const metricsEl = document.getElementById("miniMetrics");
  const btn = document.getElementById("annealBtn");
  const status = document.getElementById("annealStatus");
  const kS = document.getElementById("pkSlider"), kO = document.getElementById("pkOut");
  const lS = document.getElementById("plSlider"), lO = document.getElementById("plOut");

  const tickers = Object.keys(WIDGET_ASSETS);
  const n = tickers.length;
  const h = tickers.map(t => WIDGET_ASSETS[t]);

  /* deterministic synthetic covariance (illustrative, labeled demo) */
  const rand = (seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  })(20240101);
  const vol = h.map(r => 0.18 + 0.35 * Math.abs(r) + 0.05 * rand());
  const cov = [];
  for (let i = 0; i < n; i++) {
    cov.push(new Array(n));
    for (let j = 0; j < n; j++)
      cov[i][j] = i === j ? vol[i] * vol[i] : 0.3 * vol[i] * vol[j];
  }
  let maxJ = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) if (cov[i][j] > maxJ) maxJ = cov[i][j];

  /* ----- ring geometry (supersampled 2x for crisp retina text) ----- */
  const SS = 2, CW = 440, CH = 380;
  ring.width = CW * SS; ring.height = CH * SS;
  const cx = CW / 2, cy = CH / 2, R = 118, NR = 15;
  const angleOf = i => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const phase = tickers.map((_, i) => i * 2.399963);
  const speed = tickers.map((_, i) => 0.8 + 0.37 * ((i * 7) % 5));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----- shared solver state (ring loop reads it live) ----- */
  let x = new Array(n).fill(0);
  let flash = new Float32Array(n);
  let T = 0, running = false, converged = false;

  /* idle preview: an arbitrary basket, explicitly unconverged */
  { const ord = [...Array(n).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 5; i++) x[ord[i]] = 1; }

  const RISK_SCALE = 5, A = 0.8;
  function energy(state, K, lambda) {
    let e = 0, count = 0;
    for (let i = 0; i < n; i++) {
      if (!state[i]) continue;
      count++;
      e -= h[i];
      e += 0.5 * RISK_SCALE * lambda * cov[i][i];
      for (let j = i + 1; j < n; j++)
        if (state[j]) e += RISK_SCALE * lambda * cov[i][j];
    }
    return e + A * (count - K) * (count - K);
  }

  /* ----- ring renderer ----- */
  function drawRing(now) {
    rctx.setTransform(SS, 0, 0, SS, 0, 0);
    rctx.clearRect(0, 0, CW, CH);

    /* node positions with thermal jitter: amplitude tracks temperature,
       so the graph visibly crystallizes as the anneal cools */
    const amp = running ? 5.5 * Math.min(T, 1) : (reduceMotion ? 0 : 0.7);
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = angleOf(i);
      const jx = amp * Math.sin(now * 0.0016 * speed[i] + phase[i]);
      const jy = amp * Math.cos(now * 0.0013 * speed[i] + phase[i] * 1.7);
      pos.push([cx + Math.cos(a) * R + jx, cy + Math.sin(a) * R + jy, a]);
    }

    /* coupling arcs, bowed away from center so the readout stays clear */
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const w = cov[i][j] / maxJ;
        const held = x[i] && x[j];
        rctx.strokeStyle = held
          ? `rgba(255, 154, 60, ${0.12 + 0.30 * w})`
          : `rgba(70, 96, 122, ${0.05 + 0.15 * w})`;
        rctx.lineWidth = held ? 1.4 : 0.8;
        const mx = (pos[i][0] + pos[j][0]) / 2, my = (pos[i][1] + pos[j][1]) / 2;
        const bx = mx + (mx - cx) * 0.18, by = my + (my - cy) * 0.18;
        rctx.beginPath();
        rctx.moveTo(pos[i][0], pos[i][1]);
        rctx.quadraticCurveTo(bx, by, pos[j][0], pos[j][1]);
        rctx.stroke();
      }

    /* nodes */
    rctx.font = "600 9px JetBrains Mono, monospace";
    rctx.textAlign = "center";
    for (let i = 0; i < n; i++) {
      flash[i] *= 0.90;
      const [px, py, a] = pos[i];
      const r = NR * (1 + 0.35 * flash[i]);
      if (x[i]) {
        const glow = rctx.createRadialGradient(px, py, r * 0.4, px, py, r * 2.6);
        const pulse = reduceMotion ? 0.22 : 0.18 + 0.08 * Math.sin(now * 0.002 + phase[i]);
        glow.addColorStop(0, `rgba(33, 230, 214, ${pulse + 0.25 * flash[i]})`);
        glow.addColorStop(1, "rgba(33, 230, 214, 0)");
        rctx.fillStyle = glow;
        rctx.beginPath(); rctx.arc(px, py, r * 2.6, 0, 6.2832); rctx.fill();
        const disc = rctx.createRadialGradient(px - 4, py - 5, 2, px, py, r);
        disc.addColorStop(0, "#4df0e2");
        disc.addColorStop(1, "#0e8a80");
        rctx.fillStyle = disc;
      } else {
        rctx.fillStyle = "#0d1521";
      }
      rctx.beginPath(); rctx.arc(px, py, r, 0, 6.2832); rctx.fill();
      rctx.strokeStyle = x[i] ? "#21e6d6" : "#2b4258";
      rctx.lineWidth = 1;
      rctx.stroke();
      /* ticker inside the disc */
      rctx.fillStyle = x[i] ? "#04140f" : "#7d93a8";
      rctx.fillText(tickers[i], px, py + 3);
      /* return proxy just outside, aligned along the radius */
      const lx = cx + Math.cos(a) * (R + 30), ly = cy + Math.sin(a) * (R + 30);
      rctx.fillStyle = h[i] >= 0 ? "rgba(125, 178, 168, 0.9)" : "rgba(255, 95, 87, 0.85)";
      rctx.font = "9px JetBrains Mono, monospace";
      rctx.fillText((h[i] >= 0 ? "+" : "−") + Math.abs(h[i] * 100).toFixed(0) + "%", lx, ly + 3);
      rctx.font = "600 9px JetBrains Mono, monospace";
    }

    /* center readout, kept clear by the bowed arcs */
    rctx.font = "11px JetBrains Mono, monospace";
    rctx.fillStyle = "rgba(125, 147, 168, 0.9)";
    if (running) rctx.fillText("T = " + T.toFixed(3), cx, cy + 4);
    else if (converged) {
      rctx.fillStyle = "rgba(33, 230, 214, 0.85)";
      rctx.fillText("ground state", cx, cy + 4);
    } else rctx.fillText("awaiting solve", cx, cy + 4);
    rctx.textAlign = "left";
  }

  /* ring animation loop: draws only while on screen */
  let ringVisible = true;
  new IntersectionObserver(en => { ringVisible = en[0].isIntersecting; }, { threshold: 0.05 })
    .observe(ring);
  (function ringLoop(now) {
    if (ringVisible && !document.hidden) drawRing(now || performance.now());
    if (!reduceMotion || running) requestAnimationFrame(ringLoop);
  })(performance.now());

  /* ----- energy trace ----- */
  function drawTrace(hist, bestE) {
    const W = eCanvas.width, H = eCanvas.height;
    eCtx.fillStyle = "#060a12";
    eCtx.fillRect(0, 0, W, H);
    eCtx.font = "10px JetBrains Mono, monospace";
    if (hist.length < 2) {
      eCtx.fillStyle = "#46607a";
      eCtx.fillText("energy trace — press Optimize", 8, 14);
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const e of hist) { if (e < lo) lo = e; if (e > hi) hi = e; }
    if (hi - lo < 1e-9) hi = lo + 1e-9;
    const X = i => (i / (hist.length - 1)) * W;
    const Y = E => 8 + (1 - (E - lo) / (hi - lo)) * (H - 20);

    /* gradient fill under the curve */
    const grad = eCtx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(255, 154, 60, 0.25)");
    grad.addColorStop(1, "rgba(255, 154, 60, 0)");
    eCtx.beginPath();
    hist.forEach((E, i) => { i === 0 ? eCtx.moveTo(X(i), Y(E)) : eCtx.lineTo(X(i), Y(E)); });
    eCtx.lineTo(W, H); eCtx.lineTo(0, H); eCtx.closePath();
    eCtx.fillStyle = grad;
    eCtx.fill();

    /* curve */
    eCtx.beginPath();
    hist.forEach((E, i) => { i === 0 ? eCtx.moveTo(X(i), Y(E)) : eCtx.lineTo(X(i), Y(E)); });
    eCtx.strokeStyle = "#ff9a3c";
    eCtx.lineWidth = 1.4;
    eCtx.stroke();

    /* best-energy marker */
    if (bestE !== undefined) {
      const by = Math.max(Y(bestE), 24);
      eCtx.setLineDash([3, 4]);
      eCtx.strokeStyle = "rgba(33, 230, 214, 0.55)";
      eCtx.lineWidth = 1;
      eCtx.beginPath(); eCtx.moveTo(0, by); eCtx.lineTo(W, by); eCtx.stroke();
      eCtx.setLineDash([]);
      eCtx.fillStyle = "rgba(33, 230, 214, 0.85)";
      eCtx.fillText("best " + bestE.toFixed(3), W - 86, by - 5);
    }
    /* current-point dot + labels at fixed, non-colliding corners */
    eCtx.fillStyle = "#ff9a3c";
    eCtx.beginPath();
    eCtx.arc(W - 2, Y(hist[hist.length - 1]), 2.5, 0, 6.2832);
    eCtx.fill();
    eCtx.fillStyle = "#7d93a8";
    eCtx.fillText("E = " + hist[hist.length - 1].toFixed(4), 8, 14);
  }

  function metrics(state) {
    const idx = [];
    for (let i = 0; i < n; i++) if (state[i]) idx.push(i);
    const k = idx.length;
    if (!k) return "empty selection";
    const w = 1 / k;
    const ret = idx.reduce((s, i) => s + h[i], 0) / k;
    let varp = 0;
    for (const i of idx) for (const j of idx) varp += w * w * cov[i][j];
    const volp = Math.sqrt(Math.max(varp, 0));
    return `<b>${idx.map(i => tickers[i]).join(" ")}</b> · return ${(ret * 100).toFixed(1)}%` +
           ` · vol ${(volp * 100).toFixed(1)}% · Sharpe ${(volp > 0 ? ret / volp : 0).toFixed(2)}`;
  }

  /* ----- annealing driver ----- */
  let raf = null;
  function start() {
    if (raf) cancelAnimationFrame(raf);
    const K = parseInt(kS.value, 10);
    const lambda = parseFloat(lS.value);
    const epochs = 900;
    x = new Array(n).fill(0);
    const order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < K; i++) x[order[i]] = 1;
    let E = energy(x, K, lambda);
    let best = { E, x: [...x] };
    T = 1.0;
    running = true; converged = false;
    const cool = Math.pow(0.004, 1 / epochs);
    let step = 0;
    const hist = [];
    metricsEl.textContent = "optimizing";

    function tick() {
      for (let r = 0; r < 5 && step < epochs; r++, step++) {
        const i = (Math.random() * n) | 0;
        x[i] ^= 1;
        const Enew = energy(x, K, lambda);
        if (Enew - E <= 0 || Math.random() < Math.exp(-(Enew - E) / T)) {
          E = Enew;
          flash[i] = 1;
          if (E < best.E) best = { E, x: [...x] };
        } else x[i] ^= 1;
        T *= cool;
        hist.push(E);
      }
      drawTrace(hist, best.E);
      status.textContent = `annealing · T = ${T.toFixed(3)}`;
      if (reduceMotion) drawRing(performance.now());
      if (step < epochs) raf = requestAnimationFrame(tick);
      else {
        x = [...best.x];
        running = false; converged = true;
        status.textContent = "ground state · E = " + best.E.toFixed(4);
        metricsEl.innerHTML = metrics(best.x);
        if (reduceMotion) drawRing(performance.now());
        raf = null;
      }
    }
    raf = requestAnimationFrame(tick);
  }

  kS.addEventListener("input", () => { kO.textContent = kS.value; });
  lS.addEventListener("input", () => { lO.textContent = parseFloat(lS.value).toFixed(2); });
  btn.addEventListener("click", start);
  drawTrace([]);
  if (reduceMotion) drawRing(performance.now());
}

/* ================================================================
   MODULE — MOIRÉ INTERFEROMETER
   λ = a / (2 sin(θ/2)); graphene a = 0.246 nm.
   ================================================================ */
function initMoire() {
  const canvas = document.getElementById("moireCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const a = 9;
  const slider = document.getElementById("twistSlider");
  const out = document.getElementById("twistOut");
  const lam = document.getElementById("lambdaOut");

  const pts = [];
  const R = Math.hypot(W, H) * 0.62;
  const a1 = [a, 0], a2 = [a * 0.5, a * 0.8660254];
  const basis = [[0, 0], [a * 0.5, a * 0.2886751]];
  const nMax = Math.ceil(R / a) + 2;
  for (let n = -nMax; n <= nMax; n++)
    for (let m = -nMax; m <= nMax; m++)
      for (const b of basis) {
        const x = n * a1[0] + m * a2[0] + b[0];
        const y = n * a1[1] + m * a2[1] + b[1];
        if (x * x + y * y < R * R) pts.push([x, y]);
      }

  function drawLayer(theta, color) {
    const c = Math.cos(theta), s = Math.sin(theta);
    ctx.fillStyle = color;
    for (const [x, y] of pts) {
      const px = W / 2 + x * c - y * s;
      const py = H / 2 + x * s + y * c;
      if (px < -2 || px > W + 2 || py < -2 || py > H + 2) continue;
      ctx.fillRect(px - 0.9, py - 0.9, 1.8, 1.8);
    }
  }
  function render() {
    const deg = parseFloat(slider.value);
    const th = (deg * Math.PI) / 180;
    out.textContent = deg.toFixed(2) + "°";
    const lamA = 1 / (2 * Math.sin(th / 2));
    lam.textContent = lamA.toFixed(1) + " a ≈ " + (lamA * 0.246).toFixed(1) + " nm";
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#030509";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    drawLayer(-th / 2, "rgba(33, 230, 214, 0.50)");
    drawLayer(+th / 2, "rgba(255, 154, 60, 0.50)");

    /* --- overlay: moiré-period scale bar --- */
    ctx.globalCompositeOperation = "source-over";
    const lamPx = lamA * a;
    ctx.font = "12px JetBrains Mono, monospace";
    if (lamPx <= W - 40) {
      const y = H - 20, x1 = W - 18 - lamPx, x2 = W - 18;
      ctx.strokeStyle = "rgba(215, 227, 238, 0.85)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x1, y); ctx.lineTo(x2, y);
      ctx.moveTo(x1, y - 5); ctx.lineTo(x1, y + 5);
      ctx.moveTo(x2, y - 5); ctx.lineTo(x2, y + 5);
      ctx.stroke();
      ctx.fillStyle = "rgba(215, 227, 238, 0.85)";
      ctx.fillText("λ", (x1 + x2) / 2 - 4, y - 9);
    } else {
      ctx.fillStyle = "rgba(160, 180, 198, 0.85)";
      ctx.fillText("λ exceeds frame", W - 148, H - 14);
    }
  }
  slider.addEventListener("input", render);
  render();
}

/* ================================================================
   DATA HUB
   ================================================================ */
function esc(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}
function renderPublications(pubs) {
  document.getElementById("pubList").innerHTML = pubs.map(p => `
    <div class="entry">
      <div class="entry-key">${esc(p.key)}</div>
      <div class="entry-title">${esc(p.title)}</div>
      <div class="entry-sub">${esc(p.authors)} — <em>${esc(p.venue)}</em><br>
        ${p.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}
      </div>
    </div>`).join("");
}
function renderTimeline(tl) {
  document.getElementById("timelineList").innerHTML = tl.map(t => `
    <div class="entry">
      <div class="entry-key">${esc(t.key)}</div>
      <div class="entry-title">${esc(t.title)}</div>
      <ul>${t.points.map(pt => `<li>${esc(pt)}</li>`).join("")}</ul>
    </div>`).join("");
}
async function loadHub() {
  let pubs = PROFILE.publications, tl = PROFILE.timeline;
  try {
    if (DATA_SOURCES.publicationsURL)
      pubs = (await (await fetch(DATA_SOURCES.publicationsURL)).json()).entries;
    if (DATA_SOURCES.timelineURL)
      tl = (await (await fetch(DATA_SOURCES.timelineURL)).json()).positions;
  } catch (e) { console.warn("Remote data source failed, using inline:", e); }
  renderPublications(pubs);
  renderTimeline(tl);
}
function initTabs() {
  const tabs = document.querySelectorAll(".ttab");
  tabs.forEach(tab =>
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tpane").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("pane-" + tab.dataset.tab).classList.add("active");
    })
  );
}

/* ================================================================
   TELEMETRY — dot-matrix visitor map
   Land mask: 128×56 grid, equirectangular, lat +72 → −56,
   precomputed from a public land dataset and packed as hex.

   Persistence across visitors on a static host: each visit
   increments one key-value counter per country (free, anonymous,
   no cookies). On load, all country counters are read back and
   every country that has ever visited is drawn as an orange point,
   scaled by its visit count. The current visitor appears as the
   single cyan point at coarse IP-level position.
   ================================================================ */
const LAND_HEX = "00C003E2FC03FF00000010FBFFFDFD8087FFFE61A707FC0007F90FEFFFFFFFFF65FFFFFF83C7F00007F5FFFFFFFFFFFF01FFFFFF6383C0C00EFBFFFFFFFFFFFF07FFFFFE0C0180003CFFFFFFFFFFFF7C0383FFFC0E0000003E7FFFFFFFFFFA4000407FFF07C000021E7FFFFFFFFF80C004007FFFEFE0000701FFFFFFFFFF01C000003FFFEFF00005BFFFFFFFFFFFE00000001FFFFFE000007FFFFFFFFFFFC000000007FFFF180003FFFFFFFFFFFFC00000000FFFFFE00000FFE7FFFFFFFF800000000FFFFE0000058BC3FFFFFFFF300000000FFFFC00000785F9FFFFFFFC000000000FFFF8000007813FFFFFFFCC0000000007FFF80000007037FFFFFFE44000000003FFF0000003F007FFFFFFE08000000003FFE0000007F98FFFFFFFE20000000000FF2000000FFFFFBFFFFFE00000000001780000001FFFF79FFFFFE00000000000F80000001FFFF7C0FFFFC00000000000383000003FFFFBF87FFF800000000000188000003FFFFBF83E7C0000000000001D8A80003FFFFDF03C3C000000000000050000003FFFFDE0385C00000000000000C000003FFFFF80181E100000000000004100003FFFFE0010061800000000000035C0001FFFFFC01814000000000000000FE0000FFFFFC008104800000000000007FC00043FFF800028400000000000000FFC00001FFF000018C00000000000010FFC00001FFE000019C00000000000001FFF00001FFC000009A0C000000000001FFFE0000FFC00000400F000000000000FFFF00007FC000007007000000000000FFFE00007FC000000082800000000000FFFE00007FC0000000202000000000007FFC0000FFC4000000320000000000003FFC0000FFCC000000FB0100000000001FFC0000FF8C000001FF0000000000001FFC00007F08000003FF8200000000001FF800007F9800000FFFC000000000001FE000007F0800000FFFE000000000001FE000007F00000007FFC000000000001FC000003E00000007FFE000000000001FC000001C00000007DFC000000000003F800000100000000407C000000000003F0000000000000000038000000000003E0000000000000000000020000000003C000000000000000001806000000000380000000000000000000080000000007000000000000000000001800000000078000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000018000000000000000000000";
const MAP_W = 128, MAP_H = 56, LAT_TOP = 72, LAT_BOT = -56;

function landAt(i, j) {
  const bit = j * MAP_W + i;
  const nib = parseInt(LAND_HEX[bit >> 2], 16);
  return (nib >> (3 - (bit & 3))) & 1;
}
function lonLatToXY(lon, lat, w, h) {
  return [
    ((lon + 180) / 360) * w,
    ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * h,
  ];
}

/* country centroids [lon, lat], coarse but sufficient at map scale */
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
const COUNTER_API = "https://abacus.jasoncameron.dev";

/* leading centres of condensed matter research, marked as static rings
   on the telemetry map [lon, lat]; city-level points for precision */
const RESEARCH_HUBS = [
  [-71.09, 42.36],   // Boston–Cambridge, United States
  [11.58, 48.14],    // Munich, Germany
  [0.12, 52.21],     // Cambridge, United Kingdom
  [2.35, 48.85],     // Paris, France
  [8.55, 47.37],     // Zurich, Switzerland
  [4.36, 52.01],     // Delft, Netherlands
  [139.77, 35.68],   // Tokyo, Japan
  [116.40, 39.90],   // Beijing, China
  [126.98, 37.57],   // Seoul, South Korea
  [72.88, 19.08],    // Mumbai, India
];

function initTelemetry() {
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let visitor = null;                 // current visitor [x, y] in map px
  let countries = [];                 // [{code, count}] for all past visitors
  let geo = null;
  let W = 0, H = 0;

  const base = document.createElement("canvas");

  function buildBase() {
    const cssW = Math.min(canvas.parentElement.clientWidth, 860);
    W = Math.floor(cssW * dpr);
    H = Math.floor(W * (MAP_H / MAP_W));
    canvas.width = W; canvas.height = H;
    canvas.style.height = H / dpr + "px";
    base.width = W; base.height = H;
    const bctx = base.getContext("2d");
    const sx = W / MAP_W, sy = H / MAP_H;
    const r = Math.max(0.8, sx * 0.22);
    bctx.clearRect(0, 0, W, H);
    bctx.fillStyle = "rgba(70, 96, 122, 0.55)";
    for (let j = 0; j < MAP_H; j++)
      for (let i = 0; i < MAP_W; i++)
        if (landAt(i, j)) {
          bctx.beginPath();
          bctx.arc((i + 0.5) * sx, (j + 0.5) * sy, r, 0, 6.2832);
          bctx.fill();
        }
    /* research hubs: static cyan rings */
    for (const [lon, lat] of RESEARCH_HUBS) {
      const [hx, hy] = lonLatToXY(lon, lat, W, H);
      bctx.strokeStyle = "rgba(33, 230, 214, 0.55)";
      bctx.lineWidth = dpr;
      bctx.beginPath();
      bctx.arc(hx, hy, r * 1.7, 0, 6.2832);
      bctx.stroke();
      bctx.fillStyle = "rgba(33, 230, 214, 0.8)";
      bctx.beginPath();
      bctx.arc(hx, hy, Math.max(1, 0.35 * r), 0, 6.2832);
      bctx.fill();
    }
    /* every country that has ever visited: orange, scaled by count */
    for (const { code, count } of countries) {
      const pos = COUNTRY_POS[code];
      if (!pos) continue;
      const [cx, cy] = lonLatToXY(pos[0], pos[1], W, H);
      const rr = r * (1.3 + 0.8 * Math.log10(1 + count));
      bctx.fillStyle = "rgba(255, 154, 60, 0.55)";
      bctx.beginPath();
      bctx.arc(cx, cy, rr, 0, 6.2832);
      bctx.fill();
      bctx.strokeStyle = "rgba(255, 154, 60, 0.25)";
      bctx.lineWidth = dpr;
      bctx.beginPath();
      bctx.arc(cx, cy, rr + 2.5 * dpr, 0, 6.2832);
      bctx.stroke();
    }
  }

  let t0 = performance.now(), visible = false, rafId = null;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function drawFrame(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    if (visitor) {
      const [vx, vy] = visitor;
      const phase = reduceMotion ? 0.5 : ((now - t0) / 1800) % 1;
      ctx.strokeStyle = `rgba(33, 230, 214, ${0.6 * (1 - phase)})`;
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.arc(vx, vy, (3 + 11 * phase) * dpr * 0.6, 0, 6.2832);
      ctx.stroke();
      ctx.fillStyle = "#21e6d6";
      ctx.beginPath();
      ctx.arc(vx, vy, 2.2 * dpr * 0.7, 0, 6.2832);
      ctx.fill();
    }
    if (visible && !reduceMotion && visitor) rafId = requestAnimationFrame(drawFrame);
    else rafId = null;
  }
  function kick() {
    if (!rafId) rafId = requestAnimationFrame(drawFrame);
  }
  function relocate() {
    if (geo) visitor = lonLatToXY(geo.lon, geo.lat, W, H);
  }

  new IntersectionObserver((en) => {
    visible = en[0].isIntersecting;
    if (visible) kick();
  }, { threshold: 0.1 }).observe(canvas);

  buildBase();
  kick();
  window.addEventListener("resize", () => {
    buildBase();
    relocate();
    kick();
  });

  /* read back all country counters, so earlier visitors stay visible.
     Reads are throttled in small batches: a single burst of ~57 parallel
     requests trips the counter service's rate limiter and silently kills
     the read-back, which is why dots failed to appear. Results render
     progressively and are cached locally for instant display next visit. */
  function loadCountries() {
    const CACHE_KEY = "telemetry-countries-v1";
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.t < 6 * 3600 * 1000 && Array.isArray(cached.c)) {
        countries = cached.c;
        buildBase();
        kick();
      }
    } catch (e) { /* private mode etc. */ }

    const codes = Object.keys(COUNTRY_POS);
    const found = [];
    const BATCH = 6, GAP_MS = 350;
    let idx = 0;

    function next() {
      if (idx >= codes.length) {
        countries = found.slice();
        buildBase();
        kick();
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), c: found }));
        } catch (e) {}
        return;
      }
      const batch = codes.slice(idx, idx + BATCH);
      idx += BATCH;
      Promise.allSettled(
        batch.map(c =>
          fetch(`${COUNTER_API}/get/${DATA_SOURCES.counterNamespace}/c-${c}`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (d && d.value > 0) found.push({ code: c, count: d.value }); })
            .catch(() => {})
        )
      ).then(() => {
        countries = found.slice();   /* progressive: dots appear batch by batch */
        buildBase();
        kick();
        setTimeout(next, GAP_MS);
      });
    }
    next();
  }

  /* current visitor: coarse IP-level location, no cookies */
  fetch("https://get.geojs.io/v1/ip/geo.json")
    .then(r => r.json())
    .then(g => {
      geo = { lon: parseFloat(g.longitude), lat: parseFloat(g.latitude) };
      if (Number.isFinite(geo.lon) && Number.isFinite(geo.lat)) {
        relocate();
        kick();
      }
      const cc = (g.country_code || "").toUpperCase();
      if (/^[A-Z]{2}$/.test(cc)) {
        /* register this country, then load the full set */
        fetch(`${COUNTER_API}/hit/${DATA_SOURCES.counterNamespace}/c-${cc}`)
          .catch(() => {})
          .finally(loadCountries);
      } else {
        loadCountries();
      }
    })
    .catch(loadCountries);
}

/* ================================================================
   QUANTUM PORTFOLIO — in-place launch
   The application loads lazily: the iframe gets its src on first
   launch only, so casual visitors never pay for it.
   ================================================================ */
function initAppLaunch() {
  const overlay = document.getElementById("appOverlay");
  const frame = document.getElementById("appFrame");
  const openBtn = document.getElementById("launchAppBtn");
  const linkBtn = document.getElementById("launchAppLink");
  const closeBtn = document.getElementById("appCloseBtn");
  if (!overlay || !openBtn) return;

  function open() {
    /* explicit file path: works on static hosts and on file:// alike */
    if (!frame.getAttribute("src")) frame.src = "quantum-portfolio/index.html";
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    document.body.classList.add("app-open");   // pauses the hero GPU simulation
    closeBtn.focus();
  }
  function close() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    document.body.classList.remove("app-open");
    openBtn.focus();
  }
  openBtn.addEventListener("click", open);
  if (linkBtn) linkBtn.addEventListener("click", (e) => { e.preventDefault(); open(); });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
}

/* ================================================================
   SCROLL REVEAL + BOOT
   ================================================================ */
function initReveal() {
  const targets = document.querySelectorAll(".module, .abstract-grid, .terminal, .footer-grid, .telemetry, .explore-card, .section-head");
  targets.forEach(t => t.classList.add("reveal"));
  const io = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }),
    { threshold: 0.12 }
  );
  targets.forEach(t => io.observe(t));
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();
  initIsing();
  initFermi();
  initPortfolio();
  initMoire();
  initTabs();
  initReveal();
  loadHub();
  initTelemetry();
  initAppLaunch();
});
