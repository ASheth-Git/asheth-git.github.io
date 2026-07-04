/* ================================================================
   ALPESH SHETH — interactive scientific instrument
   ----------------------------------------------------------------
   [1] HERO      GPU 2D Ising model — Metropolis–Hastings in a
                 WebGL2 fragment shader, checkerboard update,
                 held near T_c. Cursor = localized magnetic field.
   [2] MODULES   Nickelate fermiology · spin-glass annealer ·
                 moiré interferometer (all real numerics, CPU).
   [3] DATA HUB  publications / timeline / live GitHub feed.
   Zero dependencies.
   ================================================================ */
"use strict";

/* ================================================================
   DATA_SOURCES — plug your endpoints here.
   - publications: replace `inline` with a URL to a JSON file or a
     SerpAPI/Scholarly proxy for Google Scholar and it will be fetched.
   - github: public REST API, fetched live client-side.
   - timeline: edit inline, or point to /data/timeline.json.
   ================================================================ */
const DATA_SOURCES = {
  githubUser: "asheth-git",
  publicationsURL: null,   // e.g. "data/publications.json"
  timelineURL: null,       // e.g. "data/timeline.json"
};

const PROFILE = {
  publications: [
    {
      key: "JPCM · 2025 · PEER-REVIEWED",
      title: "Emergence and tunability of Fermi-pocket and electronic instabilities in layered Nickelates",
      authors: "A. Sheth, et al.",
      venue: "Journal of Physics: Condensed Matter 37, 125703 (2025)",
      links: [
        { label: "doi:10.1088/1361-648X/ada908", url: "https://doi.org/10.1088/1361-648X/ada908" },
        { label: "arXiv:2407.16042", url: "https://arxiv.org/abs/2407.16042" },
      ],
    },
    {
      key: "ARXIV · 2021 · PREPRINT",
      title: "Background for the Self Consistent Renormalisation (SCR) Theory",
      authors: "B. Devanarayanan, A. Sharma, A. Sheth, et al.",
      venue: "arXiv:2108.12683 [cond-mat.str-el]",
      links: [{ label: "arXiv:2108.12683", url: "https://arxiv.org/abs/2108.12683" }],
    },
    {
      key: "PROCEEDINGS · 2020",
      title: "Electronic properties of graphene–hBN twisted heterostructures: Moiré pattern effects (DFT)",
      authors: "A. Sheth, et al.",
      venue: "Presented at ICAFMOD-2020",
      links: [],
    },
  ],
  timeline: [
    {
      key: "2021 — 2025 · BORDEAUX, FR",
      title: "PhD Researcher — LOMA UMR-5798, CNRS / Université de Bordeaux",
      points: [
        "Effective multi-orbital models separating infinite-layer nickelate (RNiO₂) physics from high-T_c cuprates",
        "Identified robust AFM / charge-order tendencies driven by Fermi-surface nesting",
        "Python/Fortran simulation modules on HPC; automation cut compute time ≈35%",
      ],
    },
    {
      key: "2022 · BERLIN, DE",
      title: "Research Intern, Data Science — Uresearcher",
      points: [
        "Automated API data-extraction pipelines (−70% manual pre-processing)",
        "Predictive ML on drug-design datasets (+15% hit-prediction accuracy)",
      ],
    },
    {
      key: "2020 — 2021 · GUJARAT, IN",
      title: "Research Fellow — The M.S. University of Baroda",
      points: [
        "DFT + MD on boron-based nanomaterials for radiation shielding",
        "Modular HPC workflows across 20+ structural parameter sets (−50% design-cycle time)",
      ],
    },
    {
      key: "2018 — 2021 · GUJARAT, IN",
      title: "Research Intern — Physical Research Laboratory",
      points: [
        "Non-linear AC admittance of materials (+40% predictive reliability)",
        "Transport via second-order perturbation theory & Kubo formalism",
        "Critical size thresholds for superconducting nanoparticles → magnetic sensor design",
      ],
    },
    {
      key: "EDUCATION",
      title: "PhD Material Science, U. Bordeaux (2021–25) · MSc Condensed Matter Physics (2018–20) · BSc Physics (2015–18), MSU Baroda",
      points: [],
    },
  ],
};

/* ================================================================
   [1] HERO — GPU ISING MODEL
   Physics: H = −J Σ s_i s_j − Σ h_i s_i,  J = 1.
   T_c = 2 / ln(1 + √2) ≈ 2.269 (Onsager). Slider is T / T_c.
   Update: checkerboard-parallel Metropolis. Each fragment owns one
   spin; half the lattice updates per pass (neighbors are frozen on
   the opposite sublattice, so detailed balance survives the
   parallelism). 8 passes/frame ⇒ 4 Monte-Carlo sweeps per frame.
   Cursor injects a Gaussian local field h(r) — a magnetic "brush".
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
uniform float uT;          // temperature (J = k_B = 1)
uniform vec2  uMouse;      // grid coords; (-1e4) when off-canvas
uniform float uHMouse;     // cursor field strength (signed)
uniform float uSigma;      // cursor field width
uniform int   uPass;       // global pass counter (RNG decorrelation)
uniform int   uParity;     // 0/1 — which sublattice updates
out vec4 fragColor;

/* PCG-style integer hash → uniform float in [0,1) */
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
  p = ivec2(mod(vec2(p), vec2(uGrid)));            // periodic BCs
  return texelFetch(uState, p, 0).r > 0.5 ? 1.0 : -1.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float s = spinAt(p);
  if (((p.x + p.y) & 1) == uParity) {              // this sublattice updates
    float nn = spinAt(p + ivec2( 1, 0)) + spinAt(p + ivec2(-1, 0))
             + spinAt(p + ivec2( 0, 1)) + spinAt(p + ivec2( 0,-1));
    vec2 d = vec2(p) - uMouse;
    float h = uHMouse * exp(-dot(d, d) / (2.0 * uSigma * uSigma));
    float dE = 2.0 * s * (nn + h);                 // ΔE of single flip
    if (dE <= 0.0 || rnd(p, uPass) < exp(-dE / max(uT, 1e-4))) s = -s;
  }
  fragColor = vec4(s * 0.5 + 0.5, 0.0, 0.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;    // LINEAR-filtered ⇒ smooth magnetization field
uniform vec2  uRes;
uniform vec2  uMouseCss;     // cursor in canvas px (y-up); (-1e4) off-canvas
uniform float uHSign;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float m = texture(uState, uv).r;                 // 0..1 smooth spin field
  float wall = 4.0 * m * (1.0 - m);                // peaks on domain walls

  vec3 colDn  = vec3(0.010, 0.022, 0.040);         // spin-down sea
  vec3 colUp  = vec3(0.016, 0.075, 0.088);         // spin-up domains
  vec3 cyan   = vec3(0.13, 0.90, 0.84);
  vec3 orange = vec3(1.00, 0.55, 0.16);

  float dCur  = distance(gl_FragCoord.xy, uMouseCss);
  float halo  = exp(-dCur * dCur / (2.0 * 90.0 * 90.0));

  vec3 wallCol = mix(cyan, orange, clamp(halo * 1.6, 0.0, 1.0) * (uHSign * 0.5 + 0.5));
  vec3 col = mix(colDn, colUp, m)
           + wallCol * pow(wall, 1.6) * (0.16 + 0.55 * halo)
           + cyan * halo * 0.020;

  /* gentle vignette so hero text sits comfortably */
  vec2 q = uv - 0.5;
  col *= 1.0 - 0.55 * dot(q, q);
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

  /* fullscreen triangle */
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  /* lattice sizing — even dims keep checkerboard parity consistent
     across the periodic wrap */
  const GRID_H = 270;
  let gridW = 0, gridH = 0;
  let texA = null, texB = null, fboA = null, fboB = null;
  let src = null, dst = null;   // ping-pong handles, rebound on (re)allocate

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
    gridW = 2 * Math.max(32, Math.round(gridH * aspect / 2));  // even
    const n = gridW * gridH * 4;
    const seed = new Uint8Array(n);
    for (let i = 0; i < n; i += 4) {
      seed[i] = Math.random() < 0.5 ? 0 : 255;
      seed[i + 3] = 255;
    }
    if (texA) { gl.deleteTexture(texA); gl.deleteTexture(texB);
                gl.deleteFramebuffer(fboA); gl.deleteFramebuffer(fboB); }
    texA = makeStateTex(gridW, gridH, seed);
    texB = makeStateTex(gridW, gridH, null);
    fboA = makeFbo(texA);
    fboB = makeFbo(texB);
    src = { tex: texA, fbo: fboA };   // rebind so the render loop never
    dst = { tex: texB, fbo: fboB };   // holds deleted GL objects
  }
  allocate();

  /* interaction state */
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
  canvas.addEventListener("pointermove", rectToGrid);
  canvas.addEventListener("pointerleave", () => {
    mouse.gx = mouse.gy = mouse.cx = mouse.cy = -1e4;
  });
  canvas.addEventListener("pointerdown", (e) => {
    mouse.sign *= -1;
    document.getElementById("fieldOut").textContent = mouse.sign > 0 ? "+B" : "−B";
    rectToGrid(e);
  });

  /* HUD */
  const tempSlider = document.getElementById("tempSlider");
  const tempOut = document.getElementById("tempOut");
  const magOut  = document.getElementById("magOut");
  const stepOut = document.getElementById("stepOut");
  let T = parseFloat(tempSlider.value) * TC;
  tempSlider.addEventListener("input", () => {
    T = parseFloat(tempSlider.value) * TC;
    tempOut.textContent = parseFloat(tempSlider.value).toFixed(3);
  });

  /* uniform locations */
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
    hSign:    gl.getUniformLocation(drawProg, "uHSign"),
  };

  let passCount = 0, sweeps = 0, running = true, heroVisible = true;
  const PASSES_PER_FRAME = 8;                       // 4 full MC sweeps
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const readBuf = () => new Uint8Array(gridW * gridH * 4);
  let pixels = readBuf();

  function frame() {
    if (!running || !heroVisible || document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    /* --- Metropolis passes --- */
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
    sweeps = passCount >> 1;

    /* --- magnetization readback (2 Hz-ish) --- */
    if ((passCount / PASSES_PER_FRAME) % 24 === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
      if (pixels.length !== gridW * gridH * 4) pixels = readBuf();
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0, cnt = 0;
      for (let i = 0; i < pixels.length; i += 24) { sum += pixels[i] > 127 ? 1 : -1; cnt++; }
      const m = sum / cnt;
      magOut.textContent = (m >= 0 ? "+" : "−") + Math.abs(m).toFixed(2);
      stepOut.textContent = sweeps.toLocaleString() + " MCS";
    }

    /* --- render pass --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(drawProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(uD.state, 0);
    gl.uniform2f(uD.res, canvas.width, canvas.height);
    gl.uniform2f(uD.mouseCss, mouse.cx, mouse.cy);
    gl.uniform1f(uD.hSign, mouse.sign);
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
    /* single settled frame for reduced-motion users */
    for (let i = 0; i < 40; i++) requestAnimationFrame(frame);
  }
}

/* ================================================================
   [2a] MODULE 01 — NICKELATE FERMIOLOGY
   Two-band tight-binding model on the square lattice:
     ε₁(k) = −2t(cos kx + cos ky) + 4t′ cos kx cos ky − μ     (dx²−y²)
     ε₂(k) = Δz − 0.8(cos kx + cos ky) − μ                    (interlayer)
     E±(k) = ½(ε₁+ε₂) ± √(¼(ε₁−ε₂)² + V²)
   Plotted: A(k, ω=0) = Σ± Γ² / (E±² + Γ²)  — Lorentzian spectral
   weight at the Fermi level. V > 0 hybridizes the bands and pulls a
   second pocket through E_F at Γ (cf. JPCM 37, 125703).
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
        d[p]     = Math.round(255 * (0.10 * A + 0.90 * hot));   // R: white-hot cores
        d[p + 1] = Math.round(255 * (0.88 * A));                // G: cyan body
        d[p + 2] = Math.round(255 * (0.82 * A + 0.06));         // B
        d[p + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }
  [muS, tpS, vS].forEach(s => s.addEventListener("input", render));
  render();
}

/* ================================================================
   [2b] MODULE 02 — SPIN-GLASS ANNEALER
   Edwards–Anderson-type model: H = −Σ J_ij s_i s_j on a 48×48
   lattice, J_ij ~ N(1, Δ²) (Δ > 0 ⇒ frustration). Simulated
   annealing with geometric schedule T ← τT. The energy trace shows
   the quench: fast cooling arrests the system in a glassy state,
   slow cooling finds deeper minima. Same machinery as my
   quantum-inspired portfolio optimizer (assets ↔ spins).
   ================================================================ */
function initAnnealer() {
  const canvas = document.getElementById("annealCanvas");
  const ctx = canvas.getContext("2d");
  const eCanvas = document.getElementById("energyCanvas");
  const eCtx = eCanvas.getContext("2d");
  const N = 48, CELL = canvas.width / N;

  const dS = document.getElementById("disorderSlider");
  const cS = document.getElementById("coolSlider");
  const dO = document.getElementById("disorderOut");
  const cO = document.getElementById("coolOut");
  const btn = document.getElementById("annealBtn");
  const status = document.getElementById("annealStatus");

  let s = new Int8Array(N * N);
  let Jh = new Float32Array(N * N);   // bond (i,j)-(i,j+1)
  let Jv = new Float32Array(N * N);   // bond (i,j)-(i+1,j)
  let T = 0, hist = [], raf = null;

  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const idx = (i, j) => ((i + N) % N) * N + ((j + N) % N);

  function reset() {
    const delta = parseFloat(dS.value);
    for (let k = 0; k < N * N; k++) {
      s[k] = Math.random() < 0.5 ? 1 : -1;
      Jh[k] = 1 + delta * gauss();
      Jv[k] = 1 + delta * gauss();
    }
    hist = [];
  }
  function energyPerSpin() {
    let E = 0;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const k = i * N + j;
        E -= s[k] * (Jh[k] * s[idx(i, j + 1)] + Jv[k] * s[idx(i + 1, j)]);
      }
    return E / (N * N);
  }
  function sweep() {
    for (let n = 0; n < N * N; n++) {
      const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
      const k = i * N + j;
      const nb = Jh[k] * s[idx(i, j + 1)] + Jh[idx(i, j - 1)] * s[idx(i, j - 1)]
               + Jv[k] * s[idx(i + 1, j)] + Jv[idx(i - 1, j)] * s[idx(i - 1, j)];
      const dE = 2 * s[k] * nb;
      if (dE <= 0 || Math.random() < Math.exp(-dE / T)) s[k] = -s[k];
    }
  }
  function draw() {
    ctx.fillStyle = "#030509";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        if (s[i * N + j] > 0) {
          ctx.fillStyle = "#0f6e66";
          ctx.fillRect(j * CELL, i * CELL, CELL - 0.5, CELL - 0.5);
        }
      }
  }
  function drawTrace() {
    eCtx.fillStyle = "#060a12";
    eCtx.fillRect(0, 0, eCanvas.width, eCanvas.height);
    if (hist.length < 2) return;
    const lo = -2.2, hi = 0.2;
    eCtx.beginPath();
    hist.forEach((E, i) => {
      const x = (i / (hist.length - 1)) * eCanvas.width;
      const y = eCanvas.height * (1 - (E - lo) / (hi - lo));
      i === 0 ? eCtx.moveTo(x, y) : eCtx.lineTo(x, y);
    });
    eCtx.strokeStyle = "#ff9a3c";
    eCtx.lineWidth = 1.5;
    eCtx.stroke();
    eCtx.fillStyle = "#7d93a8";
    eCtx.font = "10px JetBrains Mono, monospace";
    eCtx.fillText("E/N = " + hist[hist.length - 1].toFixed(4), 8, 14);
  }
  function step() {
    const tau = parseFloat(cS.value);
    for (let r = 0; r < 3; r++) sweep();
    T *= Math.pow(tau, 3);
    hist.push(energyPerSpin());
    draw(); drawTrace();
    status.textContent = "● ANNEALING  T=" + T.toFixed(3);
    if (T > 0.02) raf = requestAnimationFrame(step);
    else {
      status.textContent = "● GROUND STATE  E/N=" + hist[hist.length - 1].toFixed(4);
      raf = null;
    }
  }
  function start() {
    if (raf) cancelAnimationFrame(raf);
    reset();
    T = 4.0;
    raf = requestAnimationFrame(step);
  }
  dS.addEventListener("input", () => { dO.textContent = parseFloat(dS.value).toFixed(2); });
  cS.addEventListener("input", () => { cO.textContent = parseFloat(cS.value).toFixed(4); });
  btn.addEventListener("click", start);
  reset(); draw(); drawTrace();
}

/* ================================================================
   [2c] MODULE 03 — MOIRÉ INTERFEROMETER
   Two honeycomb lattices, layer 2 rotated by θ about the origin.
   Moiré period λ = a / (2 sin(θ/2)); for graphene a = 0.246 nm.
   Rendered with additive blending so the beat pattern emerges from
   the physics, not from any drawn overlay.
   ================================================================ */
function initMoire() {
  const canvas = document.getElementById("moireCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const a = 9;                         // lattice constant in px
  const slider = document.getElementById("twistSlider");
  const out = document.getElementById("twistOut");
  const lam = document.getElementById("lambdaOut");

  /* honeycomb sites: Bravais (a1, a2) + 2-site basis */
  const pts = [];
  const R = Math.hypot(W, H) * 0.62;
  const a1 = [a, 0], a2 = [a * 0.5, a * 0.8660254];           // a·(1/2, √3/2)
  const basis = [[0, 0], [a * 0.5, a * 0.2887]];              // a·(1/2, 1/(2√3))
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
    const lamA = 1 / (2 * Math.sin(th / 2));            // in units of a
    lam.textContent = lamA.toFixed(1) + " a ≈ " + (lamA * 0.246).toFixed(1) + " nm";
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#030509";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    drawLayer(-th / 2, "rgba(33, 230, 214, 0.50)");
    drawLayer(+th / 2, "rgba(255, 154, 60, 0.50)");
  }
  slider.addEventListener("input", render);
  render();
}

/* ================================================================
   [3] DATA INGESTION HUB
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
        ${p.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">↗ ${esc(l.label)}</a>`).join(" · ")}
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
  /* publications & timeline: remote if configured, else inline */
  let pubs = PROFILE.publications, tl = PROFILE.timeline;
  try {
    if (DATA_SOURCES.publicationsURL)
      pubs = (await (await fetch(DATA_SOURCES.publicationsURL)).json()).entries;
    if (DATA_SOURCES.timelineURL)
      tl = (await (await fetch(DATA_SOURCES.timelineURL)).json()).positions;
  } catch (e) { console.warn("Remote data source failed, using inline:", e); }
  renderPublications(pubs);
  renderTimeline(tl);

  /* live GitHub feed */
  const el = document.getElementById("repoList");
  try {
    const res = await fetch(
      `https://api.github.com/users/${DATA_SOURCES.githubUser}/repos?sort=updated&per_page=8`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const repos = await res.json();
    el.innerHTML = repos.length
      ? repos.map(r => `
        <div class="entry">
          <div class="entry-key">${esc(r.language || "REPO")} · ★ ${r.stargazers_count} · ${esc((r.updated_at || "").slice(0, 10))}</div>
          <div class="entry-title"><a href="${esc(r.html_url)}" target="_blank" rel="noopener">${esc(r.name)}</a></div>
          <div class="entry-sub">${esc(r.description || "no description")}</div>
        </div>`).join("")
      : `<p class="tdim">// no public repositories yet — this feed goes live the moment you push.</p>`;
  } catch (e) {
    el.innerHTML = `<p class="tdim">// GitHub API unreachable (${esc(e.message)}). Feed will retry on next visit.</p>`;
  }
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
   SCROLL REVEAL + BOOT
   ================================================================ */
function initReveal() {
  const targets = document.querySelectorAll(".module, .abstract-grid, .terminal, .footer-grid, .section-head");
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
  initAnnealer();
  initMoire();
  initTabs();
  initReveal();
  loadHub();
});
