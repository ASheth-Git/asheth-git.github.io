/* ═══════════════════════════════════════════════════════════════
   ALPESH SHETH — v2 section wheel
   ---------------------------------------------------------------
   The left-hand section rail as a drum: a short column of section
   names read against a fixed line, the current section held on that
   line. Dragging the drum, or the mouse wheel once it is focused,
   moves through the sections; releasing navigates to the one on the
   line. Scrolling the page moves the drum in step, so the rail is a
   readout of position as much as a control.

   The rail stays a <nav> of ordinary anchors. Every entry keeps its
   href, so the menu works with the script absent, is navigable by
   keyboard, and is announced as a list of links rather than as a
   custom widget.
   ═══════════════════════════════════════════════════════════════ */
"use strict";

(function () {
  const rail = document.getElementById("rail");
  if (!rail) return;

  const links = [...rail.querySelectorAll("a")];
  if (links.length < 2) return;

  /* ── structure: a fixed window over a padded track ───────────── */
  const drum = document.createElement("div");
  drum.className = "rail-drum";
  const track = document.createElement("div");
  track.className = "rail-track";
  links.forEach(a => track.appendChild(a));
  drum.appendChild(track);
  const mark = document.createElement("span");
  mark.className = "rail-mark";
  mark.setAttribute("aria-hidden", "true");
  const fadeT = document.createElement("span");
  fadeT.className = "rail-fade t";
  fadeT.setAttribute("aria-hidden", "true");
  const fadeB = document.createElement("span");
  fadeB.className = "rail-fade b";
  fadeB.setAttribute("aria-hidden", "true");
  rail.append(drum, fadeT, fadeB, mark);

  /* one item's height drives every measurement; read it back from the
     rendered result rather than assuming the stylesheet's value */
  let step = 26, lastPad = -1;
  function measure() {
    const r = links[0].getBoundingClientRect();
    if (r.height > 4) step = r.height;
    const pad = Math.max(0, Math.round((drum.clientHeight - step) / 2));
    /* only write when the value actually changes: this runs inside a
       ResizeObserver, and an unconditional write would re-trigger it */
    if (pad === lastPad) return;
    lastPad = pad;
    track.style.paddingTop = pad + "px";
    track.style.paddingBottom = pad + "px";
  }

  const clamp = i => Math.min(links.length - 1, Math.max(0, i));
  let current = 0, settle = 0, fromPage = false;

  function centre(i, smooth) {
    const target = clamp(i) * step;
    if (Math.abs(drum.scrollTop - target) < 0.5) return;
    fromPage = true;
    if (smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      drum.scrollTo({ top: target, behavior: "smooth" });
    else drum.scrollTop = target;
    /* release the guard after the resulting scroll events have landed */
    clearTimeout(settle);
    settle = setTimeout(() => { fromPage = false; }, smooth ? 380 : 60);
  }

  function mark_active(i) {
    links.forEach((a, k) => a.classList.toggle("on", k === clamp(i)));
  }

  /* ── the page is the source of truth ─────────────────────────
     initChrome() already toggles .on as sections pass the reading
     line. The drum follows that, so the two can never disagree. */
  const observer = new MutationObserver(() => {
    const i = links.findIndex(a => a.classList.contains("on"));
    if (i < 0 || i === current) return;
    current = i;
    if (!dragging) centre(i, true);
  });
  links.forEach(a => observer.observe(a, { attributes: true, attributeFilter: ["class"] }));

  /* ── drag and wheel move the selection ──────────────────────── */
  let dragging = false, lastY = 0, moved = 0;

  const nudge = px => {
    drum.scrollTop = Math.min((links.length - 1) * step,
      Math.max(0, drum.scrollTop + px));
    mark_active(Math.round(drum.scrollTop / step));
  };

  const go = () => {
    const i = clamp(Math.round(drum.scrollTop / step));
    centre(i, true);
    mark_active(i);
    if (i !== current) links[i].click();
  };

  /* Pointer capture is taken only once the gesture has proved itself a
     drag. Capturing on pointerdown retargets the compatibility mouse
     events — including click — to the drum, so the anchor underneath
     never receives its own click and the rail becomes unclickable.
     Deferring capture past the movement threshold leaves a plain tap to
     resolve natively as a link activation, which is also what keeps the
     rail working with the script disabled. */
  let captured = 0;
  drum.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true; moved = 0; lastY = e.clientY; captured = 0;
    drum.dataset.live = "1";
  });
  drum.addEventListener("pointermove", e => {
    if (!dragging) return;
    const dy = lastY - e.clientY;
    moved += Math.abs(dy);
    nudge(dy);
    lastY = e.clientY;
    /* past a few pixels this is a drag, not a click on a link */
    if (moved > 4) {
      if (!captured) {
        try { drum.setPointerCapture(e.pointerId); captured = e.pointerId; } catch (err) { /* gone */ }
      }
      e.preventDefault();
    }
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    delete drum.dataset.live;
    if (captured) {
      try { drum.releasePointerCapture(captured); } catch (err) { /* already released */ }
      captured = 0;
    }
    if (moved > 4) go();
  };
  drum.addEventListener("pointerup", endDrag);
  drum.addEventListener("pointercancel", endDrag);

  /* a drag that ended on a link must not also follow it */
  links.forEach(a => a.addEventListener("click", e => {
    if (moved > 4) { e.preventDefault(); moved = 0; }
  }));

  /* the wheel acts on the drum only while the pointer is over it, and
     the page keeps the gesture otherwise */
  let wheelSettle = 0;
  drum.addEventListener("wheel", e => {
    e.preventDefault();
    nudge(e.deltaY * 0.5);
    clearTimeout(wheelSettle);
    wheelSettle = setTimeout(go, 140);
  }, { passive: false });

  /* keyboard: the anchors are already tabbable, so arrow keys only need
     to move between them */
  rail.addEventListener("keydown", e => {
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = links[clamp(i + d)];
    next.focus();
    centre(clamp(i + d), true);
  });

  new ResizeObserver(measure).observe(rail);
  measure();
  const i0 = Math.max(0, links.findIndex(a => a.classList.contains("on")));
  current = i0;
  centre(i0, false);
  mark_active(i0);

  /* ── compact menu for widths where the drum is not shown ───────
     The drum needs a gutter wide enough for its labels, which not every
     laptop has. Rather than leave those screens with no way to jump
     between eleven sections, the top bar carries a native select built
     from these same links — one source of section names, and a control
     that is already keyboard- and screen-reader-accessible. */
  const bar = document.querySelector(".top .right");
  if (bar) {
    const sel = document.createElement("select");
    sel.className = "navsel";
    sel.setAttribute("aria-label", "Jump to section");
    links.forEach((a, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      const no = a.querySelector(".no"), nm = a.querySelector(".nm");
      o.textContent = (no ? no.textContent + " " : "") + (nm ? nm.textContent : a.textContent);
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      const i = clamp(parseInt(sel.value, 10));
      links[i].click();
    });
    bar.insertBefore(sel, bar.firstChild);
    /* the menu tracks position the same way the drum does */
    const syncSel = () => {
      const i = links.findIndex(a => a.classList.contains("on"));
      if (i >= 0 && sel.value !== String(i)) sel.value = String(i);
    };
    links.forEach(a => new MutationObserver(syncSel)
      .observe(a, { attributes: true, attributeFilter: ["class"] }));
    syncSel();
  }
})();
