(function () {
  "use strict";
  const { chain, decode, playback, explode, draw, sheet, family } = window.TheScore;

  const salon = document.querySelector(".salon");
  const stage = document.getElementById("stage");
  const pixel = document.getElementById("pixel");
  const unmintedEl = document.getElementById("unminted");
  const veil = document.getElementById("veil");
  const caption = document.getElementById("caption");
  const status = document.getElementById("status");
  const idInput = document.getElementById("id-input");
  const toggleBtn = document.getElementById("btn-toggle");
  const prevBtn = document.getElementById("btn-prev");
  const nextBtn = document.getElementById("btn-next");
  const modeWatch = document.getElementById("mode-watch");
  const modeApart = document.getElementById("mode-apart");
  const modeDraw = document.getElementById("mode-draw");
  const resetBtn = document.getElementById("btn-reset");
  const sheetBtn = document.getElementById("btn-sheet");
  const platesHost = document.getElementById("plates");
  const plotter = draw.createDraw();
  plotter.setOnDone(function () {
    syncToggle();
    setModeButtons();
  });
  plotter.setOnPlayChange(function () {
    syncToggle();
    setModeButtons();
  });
  const traitStage = document.getElementById("trait-stage");
  const traitPixel = document.getElementById("trait-pixel");
  const traitEmpty = document.getElementById("trait-empty");
  const plates = explode.bind(platesHost);

  const CELL = 24;
  const PRINT_IN = 4;
  const DETAIL_IN = 2;
  const MIN_SCALE = 8;
  const MIN_DETAIL = 4;
  const MAX_SCALE = 40;

  const table = {
    slots: ["Palette", "Bones", "Cloak", "Relic", "Sight", "Artifact", "Crown"],
    bytes: null,
    stale: false,
    row: function (id) {
      if (!this.bytes) return null;
      const i = (id - 1) * 7;
      if (i < 0 || i + 7 > this.bytes.length) return null;
      return Array.from(this.bytes.slice(i, i + 7));
    },
  };

  let mode = "watch";
  let lastFrame = { id: 1, attributes: [], unminted: true };
  let canaryId = 0;
  let twins = Object.create(null);
  let twinKind = Object.create(null);
  let twinCells = null;
  let twinSeq = 0;
  let twinInvite = false;
  let twinPress = 0;
  let films = Object.create(null);
  let filmSeq = 0;
  let filmPlaying = false;
  let filmLive = false;
  let filmStartedAt = 0;
  let filmTimer = 0;
  const FILM_FRAME_MS = 800;
  const FILM_STEM_MS = 1100;
  const FILM_CODA_MS = 1600;
  const FILM_CLICK_GRACE_MS = 800;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function pad4(n) {
    return String(n).padStart(4, "0");
  }

  function parseDeepId() {
    const q = new URLSearchParams(location.search).get("id");
    if (q && /^\d{1,4}$/.test(q)) {
      const n = Number(q);
      if (n >= 1 && n <= 9999) return n;
    }
    const h = String(location.hash || "").replace(/^#/, "");
    const m = /^(?:id=)?(\d{1,4})$/.exec(h);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 9999) return n;
    }
    return 1;
  }

  function syncUrl(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > 9999) return;
    const url = new URL(location.href);
    url.searchParams.set("id", String(n));
    url.hash = "";
    const next = url.pathname + url.search;
    if (next === location.pathname + location.search && !location.hash) return;
    history.replaceState({ id: n }, "", next);
  }

  function syncColophon(addr) {
    const shortEl = document.getElementById("renderer-mark");
    const fullEl = document.getElementById("renderer-full");
    const btn = document.getElementById("renderer-colophon");
    if (!shortEl || !fullEl) return;
    const hex = String(addr || "").replace(/^0x/i, "").toLowerCase();
    if (hex.length < 6) {
      shortEl.textContent = "";
      fullEl.textContent = "";
      if (btn) btn.setAttribute("aria-label", "Renderer");
      return;
    }
    const full = "0x" + hex;
    shortEl.textContent = hex.slice(-6);
    fullEl.textContent = "renderer(" + full + ")";
    if (btn) btn.setAttribute("aria-label", "renderer(" + full + ")");
  }

  function assumedDiagonalInches(sw, sh) {
    const laptop = typeof navigator.getBattery === "function";
    const key = sw + "x" + sh;
    const known = {
      "1280x800": 13.3,
      "1366x768": 15.6,
      "1440x900": 13.3,
      "1536x864": 14,
      "1600x900": 15.6,
      "1680x1050": 22,
      "1920x1080": laptop ? 15.6 : 24,
      "1920x1200": 16,
      "2048x1280": 13.3,
      "2240x1400": 13.5,
      "2256x1504": 13.5,
      "2560x1440": laptop ? 16 : 27,
      "2560x1600": 16,
      "2880x1800": 16,
      "3000x2000": 14,
      "3072x1920": 16,
      "3200x2000": 16,
      "3440x1440": 34,
      "3456x2234": 16,
      "3840x2160": laptop ? 16 : 27,
      "3840x2400": 16,
      "5120x1440": 49,
    };
    if (known[key]) return known[key];
    if (laptop && Math.max(sw, sh) <= 2560) return 15.6;
    if (Math.max(sw, sh) >= 3000) return 27;
    if (Math.max(sw, sh) >= 2500) return 27;
    return 24;
  }

  function cssPxForInches(inches) {
    const sw = window.screen.width;
    const sh = window.screen.height;
    const diag = assumedDiagonalInches(sw, sh);
    return (inches * Math.hypot(sw, sh)) / diag;
  }

  function scaleFor(want, cap, minScale) {
    const lo = minScale == null ? MIN_SCALE : minScale;
    let scale = Math.round(want / CELL);
    scale = Math.max(lo, Math.min(MAX_SCALE, scale));
    while (scale * CELL > cap && scale > lo) scale -= 1;
    return scale;
  }

  function setScaleClass(el, scale) {
    const keep = [];
    el.classList.forEach(function (c) {
      if (!/^scale-\d+$/.test(c)) keep.push(c);
    });
    keep.push("scale-" + scale);
    el.className = keep.join(" ");
    el.dataset.scale = String(scale);
  }

  function fitPrint() {
    const reserveY = 220;
    const apart = salon.classList.contains("take-apart");
    const two = salon.classList.contains("has-trait");
    const narrow = window.innerWidth < 720;
    const platesW = apart ? (narrow ? 132 : 200) : 0;
    const gap = two && !narrow ? 48 : 0;
    const want4 = cssPxForInches(PRINT_IN);
    const want2 = cssPxForInches(DETAIL_IN);
    const heightCap = window.innerHeight - reserveY;
    const widthCap = window.innerWidth - 32 - (narrow ? 0 : platesW) - gap;
    const mainCap = Math.min(heightCap, two && !narrow ? widthCap - want2 : widthCap);
    const mainScale = scaleFor(want4, mainCap);
    setScaleClass(stage, mainScale);
    salon.style.setProperty("--plate-px", (mainScale * CELL + 2) + "px");
    if (traitStage) {
      const halfPx = Math.round(mainScale / 2) * CELL;
      const isoCap = narrow
        ? Math.max(MIN_DETAIL * CELL, window.innerWidth - 48 - platesW)
        : Math.min(heightCap, Math.max(MIN_SCALE * CELL, widthCap - mainScale * CELL));
      const detailScale = scaleFor(narrow ? halfPx : want2, isoCap, narrow ? MIN_DETAIL : MIN_SCALE);
      setScaleClass(traitStage, detailScale);
    }
  }

  function hideTraitWell() {
    salon.classList.remove("has-trait");
    traitStage.classList.remove("is-paper", "is-stamp");
    traitStage.hidden = true;
    traitPixel.replaceChildren();
    traitEmpty.hidden = true;
  }

  function showTraitWell(iso, row) {
    if (!iso || iso === "harbor" || iso === "none") {
      hideTraitWell();
      fitPrint();
      return;
    }
    traitStage.hidden = false;
    salon.classList.add("has-trait");
    const stamp = row && String(row.slot || "").toLowerCase() === "stamp";
    traitStage.classList.toggle("is-stamp", stamp);
    traitStage.classList.toggle("is-paper", !stamp && decode.wellIsPaper(row && row.slot, row && row.value, iso));
    traitEmpty.hidden = true;
    try {
      traitPixel.replaceChildren(decode.sanitizeSvg(iso));
    } catch (_) {
      hideTraitWell();
      fitPrint();
      return;
    }
    fitPrint();
  }

  function twinOf(id) {
    const n = Number(id);
    if (!twins[n]) return 0;
    if (lastFrame && decode.frameIsFate(lastFrame)) return 0;
    return twins[n];
  }

  function setCaption(id) {
    const twin = twinOf(id);
    caption.replaceChildren();
    caption.appendChild(document.createTextNode("ARGONAUT #"));
    if (twin) {
      const a = document.createElement("a");
      a.className = "caption-id" + (id < twin ? " is-lo" : " is-hi");
      a.href = "?id=" + twin;
      a.textContent = pad4(id);
      a.setAttribute("aria-label", "Argonaut " + pad4(id) + ", corresponding print");
      a.addEventListener("click", function (ev) {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        goTwin(twin);
      });
      caption.appendChild(a);
    } else {
      caption.appendChild(document.createTextNode(pad4(id)));
    }
    if (document.activeElement !== idInput) {
      idInput.value = String(id);
    }
  }

  function syncToggle() {
    if (mode === "draw") {
      toggleBtn.textContent = "Play";
      toggleBtn.setAttribute("aria-pressed", "false");
      return;
    }
    const on = player.isPlaying();
    toggleBtn.textContent = on ? "Pause" : "Play";
    toggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function refreshPlates() {
    const rows = plates.rowsFrom(lastFrame, table);
    plates.paint(rows);
  }

  function setModeButtons() {
    const playing = player.isPlaying();
    modeWatch.textContent = playing ? "Pause" : "Play";
    modeWatch.classList.toggle("is-on", mode === "watch");
    modeWatch.classList.toggle("is-playing", mode === "watch" && playing);
    modeWatch.setAttribute("aria-pressed", playing ? "true" : "false");
    modeApart.classList.toggle("is-on", mode === "apart");
    modeApart.setAttribute("aria-pressed", mode === "apart" ? "true" : "false");
    const drawing = mode === "draw" && plotter.isPlaying();
    modeDraw.textContent = drawing ? "Pause" : "Draw";
    modeDraw.classList.toggle("is-on", mode === "draw");
    modeDraw.classList.toggle("is-playing", drawing);
    modeDraw.setAttribute("aria-pressed", drawing ? "true" : "false");
  }

  function reassemble() {
    if (mode !== "apart") return;
    hideTraitWell();
    plates.flyOut(stage);
    window.setTimeout(function () {
      plates.hide();
      salon.classList.remove("take-apart");
      fitPrint();
    }, plates.duration);
    mode = "watch";
    setModeButtons();
    syncStemClass();
  }

  let stampTimer = 0;
  let stampRaf = 0;
  let stampRestore = null;

  function clearStampLamp() {
    window.clearTimeout(stampTimer);
    stampTimer = 0;
    if (stampRaf) {
      window.cancelAnimationFrame(stampRaf);
      stampRaf = 0;
    }
    if (stampRestore) {
      stampRestore();
      stampRestore = null;
    }
  }

  function stampMarks(svgEl) {
    const out = [];
    if (!svgEl || !svgEl.getElementsByTagName) return out;
    const rects = svgEl.getElementsByTagName("rect");
    for (let i = 0; i < rects.length; i++) {
      const el = rects[i];
      const fill = String(el.getAttribute("fill") || "").toLowerCase();
      const w = Number(el.getAttribute("width"));
      const h = Number(el.getAttribute("height"));
      const raw = el.getAttribute("fill-opacity");
      const o = raw == null || raw === "" ? 1 : Number(raw);
      if (!decode.isPrintStamp({ fill: fill, w: w, h: h, opacity: o })) continue;
      out.push({ el: el, op: raw, base: o });
    }
    return out;
  }

  function setStampOp(marks, t) {
    marks.forEach(function (m) {
      const v = m.base + (1 - m.base) * t;
      m.el.setAttribute("fill-opacity", String(v));
    });
  }

  function fadeStamps(marks, from, to, ms, done) {
    const t0 = performance.now();
    function step(now) {
      const u = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
      const e = u * u * (3 - 2 * u);
      setStampOp(marks, from + (to - from) * e);
      if (u < 1) {
        stampRaf = window.requestAnimationFrame(step);
        return;
      }
      stampRaf = 0;
      if (done) done();
    }
    stampRaf = window.requestAnimationFrame(step);
  }

  function scheduleStampLamp(svgEl) {
    clearStampLamp();
    if (mode !== "watch") return;
    if (!player || !player.isPlaying()) return;
    if (decode.frameIsFate(lastFrame)) return;
    const marks = stampMarks(svgEl);
    if (!marks.length) return;
    const hold = player.stillMs ? player.stillMs() : Math.round(1400 / (player.getRate() || 0.5));
    const rest = Math.round(hold * (1000 / 2800));
    const fade = Math.round(hold * (700 / 2800));
    const peak = Math.max(0, hold - rest - fade * 2);
    if (fade < 80) return;
    stampRestore = function () {
      marks.forEach(function (m) {
        if (m.op == null || m.op === "") m.el.removeAttribute("fill-opacity");
        else m.el.setAttribute("fill-opacity", m.op);
      });
      stampRestore = null;
    };
    stampTimer = window.setTimeout(function () {
      fadeStamps(marks, 0, 1, fade, function () {
        stampTimer = window.setTimeout(function () {
          fadeStamps(marks, 1, 0, fade, function () {
            if (stampRestore) stampRestore();
            stampTimer = 0;
          });
        }, peak);
      });
    }, rest);
  }

  function clearTwinProof() {
    twinCells = null;
    twinSeq += 1;
    window.clearTimeout(twinPress);
    twinPress = 0;
    const old = pixel.querySelector(".twin-proof");
    if (old) old.remove();
    pixel.classList.remove("twin-arrive");
  }

  function placeTwinProof(cells, invite) {
    const old = pixel.querySelector(".twin-proof");
    if (old) old.remove();
    if (!cells || !cells.length) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "twin-proof" + (invite ? " is-invite" : ""));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    cells.forEach(function (c) {
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(c.x));
      r.setAttribute("y", String(c.y));
      r.setAttribute("width", "1");
      r.setAttribute("height", "1");
      r.setAttribute("class", "twin-cell");
      r.setAttribute("fill", "#ffffff");
      svg.appendChild(r);
    });
    pixel.appendChild(svg);
    if (invite) {
      window.setTimeout(function () {
        svg.classList.remove("is-invite");
      }, 2200);
    }
  }

  function bindTwinProof(frame) {
    clearTwinProof();
    if (!frame || mode !== "watch") return;
    if (player && player.isPlaying()) return;
    if (decode.frameIsFate(frame)) return;
    const twin = twins[frame.id];
    if (!twin) return;
    const traits = table.row(frame.id);
    const other = table.row(twin);
    if (!traits || !other || !explode.traitDiffCells) return;
    const seq = ++twinSeq;
    const invite = twinInvite;
    twinInvite = false;
    explode.traitDiffCells(traits, other).then(function (cells) {
      if (seq !== twinSeq || !lastFrame || lastFrame.id !== frame.id) return;
      twinCells = cells || [];
      placeTwinProof(twinCells, invite);
    }).catch(function () {});
  }

  function goTwin(id) {
    twinInvite = true;
    pixel.classList.remove("twin-arrive");
    void pixel.offsetWidth;
    pixel.classList.add("twin-arrive");
    player.goto(id).catch(function () {
      twinInvite = false;
    });
  }

  function twinCellAt(ev) {
    if (!twinCells || !twinCells.length) return null;
    const box = pixel.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const x = Math.floor(((ev.clientX - box.left) / box.width) * 24);
    const y = Math.floor(((ev.clientY - box.top) / box.height) * 24);
    for (let i = 0; i < twinCells.length; i++) {
      if (twinCells[i].x === x && twinCells[i].y === y) return twinCells[i];
    }
    return null;
  }

  function setTwinHot(on) {
    const proof = pixel.querySelector(".twin-proof");
    if (!proof) return;
    proof.classList.toggle("is-hot", !!on);
  }

  function stemFilmOf(id) {
    const film = films[Number(id)];
    return film && film.ids && film.ids.length > 1 ? film : null;
  }

  function syncStemClass() {
    const on =
      mode === "watch" &&
      !filmPlaying &&
      !(player && player.isPlaying()) &&
      lastFrame &&
      !lastFrame.unminted &&
      !decode.frameIsFate(lastFrame) &&
      !!stemFilmOf(lastFrame.id);
    stage.classList.toggle("is-stem", on);
    if (!on) stage.classList.remove("is-invite", "is-ready");
  }

  function inviteStem() {
    if (!stage.classList.contains("is-stem") || filmPlaying) return;
    stage.classList.add("is-ready");
    if (reduceMotion.matches) {
      stage.classList.add("is-invite");
      return;
    }
    stage.classList.remove("is-invite");
    void stage.offsetWidth;
    stage.classList.add("is-invite");
  }

  function abortFilm() {
    filmSeq += 1;
    filmPlaying = false;
    filmLive = false;
    filmStartedAt = 0;
    window.clearTimeout(filmTimer);
    filmTimer = 0;
    stage.classList.remove("is-film");
  }

  function filmCanStop() {
    return filmPlaying && filmLive && performance.now() - filmStartedAt >= FILM_CLICK_GRACE_MS;
  }

  function pointerInStage(ev) {
    const r = stage.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }

  function stopFilmIfPointerLeft(ev) {
    if (!filmPlaying) return;
    if (ev && ev.pointerType === "touch") return;
    if (performance.now() - filmStartedAt < 120) return;
    if (ev && pointerInStage(ev)) return;
    stopFilm();
  }

  function stopFilm() {
    const was = filmPlaying;
    abortFilm();
    if (was && lastFrame) mountArt(lastFrame);
    syncStemClass();
    if (stage.classList.contains("is-stem") && stage.matches(":hover")) inviteStem();
  }

  function filmWait(ms, seq) {
    return new Promise(function (resolve) {
      window.clearTimeout(filmTimer);
      filmTimer = window.setTimeout(function () {
        filmTimer = 0;
        resolve(seq === filmSeq);
      }, ms);
    });
  }

  function paintFilmFrame(frame) {
    clearStampLamp();
    clearTwinProof();
    if (!frame || frame.unminted || frame.error) return false;
    if (decode.frameIsFate(frame)) return false;
    if (frame.kind === "gif" || frame.kind === "raster") return false;
    if (!frame.svg) return false;
    try {
      pixel.replaceChildren(decode.sanitizeSvg(frame.svg));
      unmintedEl.hidden = true;
      stage.classList.remove("is-empty");
      return true;
    } catch (_) {
      return false;
    }
  }

  function releaseIdBox() {
    if (document.activeElement === idInput) idInput.blur();
  }

  async function startFilm(stemId) {
    const film = stemFilmOf(stemId);
    if (!film) return;
    if (mode !== "watch" || (player && player.isPlaying())) return;
    releaseIdBox();

    filmSeq += 1;
    const seq = filmSeq;
    window.clearTimeout(filmTimer);
    filmPlaying = true;
    filmLive = false;
    filmStartedAt = performance.now();
    stage.classList.add("is-film");
    stage.classList.remove("is-invite", "is-ready", "is-stem");
    chain.prefetch(film.ids);

    for (let i = 1; i < film.ids.length; i++) {
      if (seq !== filmSeq) return;
      try {
        const frame = await chain.loadFrame(film.ids[i]);
        if (seq !== filmSeq) return;
        if (!paintFilmFrame(frame)) continue;
        filmLive = true;
      } catch (_) {
        continue;
      }
      const last = i === film.ids.length - 1;
      if (!(await filmWait(last ? FILM_CODA_MS : FILM_FRAME_MS, seq))) return;
    }

    if (seq !== filmSeq) return;
    try {
      const home = await chain.loadFrame(film.ids[0]);
      if (seq !== filmSeq) return;
      paintFilmFrame(home);
    } catch (_) {}
    if (!(await filmWait(FILM_STEM_MS, seq))) return;
    if (seq !== filmSeq) return;
    stopFilm();
  }

  function mountArt(frame) {
    clearStampLamp();
    if (!frame || frame.unminted) {
      pixel.replaceChildren();
      unmintedEl.hidden = false;
      stage.classList.add("is-empty");
      return;
    }
    if (frame.kind === "gif" || frame.kind === "raster") {
      if (!frame.imageUri) return;
      const img = document.createElement("img");
      img.src = frame.imageUri;
      img.width = 24;
      img.height = 24;
      img.alt = "";
      img.draggable = false;
      pixel.replaceChildren(img);
      unmintedEl.hidden = true;
      stage.classList.remove("is-empty");
      return;
    }
    if (!frame.svg) return;
    try {
      const svg = decode.sanitizeSvg(frame.svg);
      pixel.replaceChildren(svg);
      unmintedEl.hidden = true;
      stage.classList.remove("is-empty");
      scheduleStampLamp(svg);
      bindTwinProof(frame);
    } catch (err) {
      status.textContent = err.message || "SVG failed";
    }
  }

  function restoreSvg() {
    if (!lastFrame) return;
    mountArt(lastFrame);
  }

  function stopDraw() {
    plotter.pause();
    salon.classList.remove("draw-mode");
  }

  function leaveDraw() {
    if (mode !== "draw") return;
    stopDraw();
    mode = "watch";
    restoreSvg();
    setModeButtons();
    syncStemClass();
  }

  function enterDraw() {
    if (lastFrame && (lastFrame.kind === "gif" || lastFrame.kind === "raster")) return;
    if (filmPlaying) stopFilm();
    player.pause();
    if (mode === "apart") {
      hideTraitWell();
      plates.hide();
      salon.classList.remove("take-apart");
    }
    mode = "draw";
    salon.classList.add("draw-mode");
    syncStemClass();
    fitPrint();
    pixel.replaceChildren(plotter.canvas);
    unmintedEl.hidden = true;
    plotter.load(lastFrame.unminted ? "" : lastFrame.svg || "");
    plotter.setMs(30 / (player.getRate() || 1));
    plotter.play();
    syncToggle();
    setModeButtons();
  }

  function onWatchClick() {
    releaseIdBox();
    if (mode === "apart") {
      reassemble();
      return;
    }
    if (mode === "draw") {
      leaveDraw();
      player.play();
      syncToggle();
      setModeButtons();
      return;
    }
    if (filmPlaying) stopFilm();
    player.toggle();
    syncToggle();
    setModeButtons();
  }

  function onDrawClick() {
    if (mode === "draw") {
      plotter.toggle();
      syncToggle();
      setModeButtons();
      return;
    }
    enterDraw();
  }

  function loadIsolation(id, svg) {
    function paintChips(traits) {
      if (!traits || mode !== "apart") return;
      plates.loadChips(Array.from(traits), svg || "").catch(function () {});
    }
    const snap = table.row(id);
    if (snap) paintChips(snap);
    chain.traitsOf(id).then(function (live) {
      paintChips(live);
    }).catch(function () {});
  }

  function enterApart() {
    if (filmPlaying) stopFilm();
    if (mode === "draw") {
      stopDraw();
      restoreSvg();
    }
    player.pause();
    syncToggle();
    mode = "apart";
    salon.classList.add("take-apart");
    setModeButtons();
    syncStemClass();
    fitPrint();
    refreshPlates();
    window.requestAnimationFrame(function () {
      plates.flyIn(stage);
    });
    loadIsolation(lastFrame.id, lastFrame.svg);
    canary(lastFrame.id);
    chain.loadFrame(lastFrame.id, { fresh: true }).then(function (frame) {
      if (mode !== "apart") return;
      lastFrame = frame;
      refreshPlates();
      loadIsolation(frame.id, frame.svg);
    }).catch(function () {});
  }

  function onApartClick() {
    if (mode === "apart") reassemble();
    else enterApart();
  }

  function sameTraits(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function canary(id) {
    if (!table.bytes || id === canaryId) return;
    canaryId = id;
    chain.traitsOf(id).then(function (live) {
      const snap = table.row(id);
      if (snap && !sameTraits(live, snap)) {
        table.stale = true;
        status.textContent = "trait table changed on chain — run node scripts/fetch-traits.mjs";
      }
    }).catch(function () {});
  }

  function paint(frame) {
    if (filmPlaying) abortFilm();
    veil.hidden = !frame.pending;
    if (frame.pending) {
      clearStampLamp();
      return;
    }
    lastFrame = frame;
    setCaption(frame.id);
    syncUrl(frame.id);
    syncColophon(frame.renderer);
    if (mode === "draw") {
      plotter.load(frame.unminted ? "" : frame.svg || "");
      plotter.play();
      syncStemClass();
      return;
    }
    if (mode === "apart") {
      refreshPlates();
      loadIsolation(frame.id, frame.svg);
    }

    if (frame.error) {
      syncStemClass();
      return;
    }

    mountArt(frame);
    syncStemClass();
  }

  const player = playback.createPlayback({
    id: parseDeepId(),
    rate: 0.5,
    loadFrame: chain.loadFrame,
    prefetch: chain.prefetch,
    holdExtra: function (frame) {
      return decode.frameIsFate(frame) ? 800 : 0;
    },
    onPlayChange: function (on) {
      if (on && filmPlaying) abortFilm();
      syncToggle();
      setModeButtons();
      syncStemClass();
      if (!on) {
        clearStampLamp();
        if (lastFrame) bindTwinProof(lastFrame);
        return;
      }
      clearTwinProof();
      if (mode !== "watch") return;
      const svg = pixel.querySelector("svg");
      if (svg) scheduleStampLamp(svg);
    },
    onFrame: paint,
    onStatus: function (text) {
      if (table.stale) return;
      status.textContent = text;
    },
    onLap: function () {
      if (table.stale) return;
      status.textContent = "There is only serve the Muse";
      window.setTimeout(function () {
        if (status.textContent === "There is only serve the Muse") status.textContent = "";
      }, 8000);
    },
  });

  toggleBtn.addEventListener("click", function () {
    releaseIdBox();
    if (filmPlaying) stopFilm();
    if (mode === "draw") {
      leaveDraw();
      player.play();
    } else {
      player.toggle();
    }
    syncToggle();
    setModeButtons();
  });
  resetBtn.addEventListener("click", function () {
    if (mode !== "draw") return;
    plotter.reset();
    plotter.play();
    setModeButtons();
  });
  sheetBtn.addEventListener("click", function () {
    if (mode !== "draw") return;
    if (!lastFrame || lastFrame.unminted || !lastFrame.svg) return;
    try {
      sheet.download(lastFrame.id, lastFrame.svg);
    } catch (_) {
      status.textContent = "sheet failed";
    }
  });
  prevBtn.addEventListener("click", function () {
    if (filmPlaying) stopFilm();
    player.prev().catch(function () {});
  });
  nextBtn.addEventListener("click", function () {
    if (filmPlaying) stopFilm();
    player.next().catch(function () {});
  });

  plates.setOnSelect(function (_i, iso, row) {
    if (mode !== "apart") return;
    showTraitWell(iso, row);
  });

  modeWatch.addEventListener("click", onWatchClick);
  modeApart.addEventListener("click", onApartClick);
  modeDraw.addEventListener("click", onDrawClick);
  platesHost.addEventListener("click", function (ev) {
    if (ev.target.closest("a")) return;
    const li = ev.target.closest(".plate");
    if (!li || mode !== "apart" || li.classList.contains("is-inert")) return;
    const i = Array.prototype.indexOf.call(platesHost.children, li);
    if (i >= 0) plates.setHighlight(i);
  });

  document.querySelectorAll(".speed-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const rate = Number(btn.getAttribute("data-rate"));
      player.setRate(rate);
      plotter.setMs(30 / (rate || 1));
      document.querySelectorAll(".speed-btn").forEach(function (b) {
        b.classList.toggle("is-on", b === btn);
      });
    });
  });

  function readIdBox() {
    const raw = idInput.value.replace(/\D/g, "");
    if (!raw) return;
    const n = player.wrap(Number(raw));
    idInput.value = String(n);
    if (player.getId() === n && lastFrame && lastFrame.id === n) return;
    player.goto(n).catch(function () {});
  }

  (function () {
    const btn = document.getElementById("renderer-colophon");
    if (!btn) return;
    let fadeTimer = 0;
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (finePointer.matches) return;
      btn.classList.remove("is-fade");
      btn.classList.add("is-open");
      window.clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(function () {
        btn.classList.add("is-fade");
        fadeTimer = window.setTimeout(function () {
          btn.classList.remove("is-open", "is-fade");
        }, 500);
      }, 3000);
    });
  })();

  pixel.addEventListener("pointermove", function (ev) {
    if (player.isPlaying() || filmPlaying || mode !== "watch") return;
    const hit = !!twinCellAt(ev);
    setTwinHot(hit);
    pixel.style.cursor = hit ? "pointer" : "";
  });
  pixel.addEventListener("pointerleave", function () {
    setTwinHot(false);
    pixel.style.cursor = "";
    window.clearTimeout(twinPress);
    twinPress = 0;
  });
  pixel.addEventListener("pointerdown", function (ev) {
    if (player.isPlaying() || filmPlaying || mode !== "watch") return;
    if (!twinCellAt(ev)) return;
    window.clearTimeout(twinPress);
    twinPress = window.setTimeout(function () {
      setTwinHot(true);
      twinPress = 0;
    }, 420);
  });
  pixel.addEventListener("pointerup", function () {
    window.clearTimeout(twinPress);
    twinPress = 0;
  });
  function onPlatePointerDown(ev) {
    if (ev.button !== 0) return;
    if (player.isPlaying() || mode !== "watch") return;
    if (filmPlaying) return;
    if (twinCellAt(ev)) return;
    if (lastFrame && stemFilmOf(lastFrame.id)) {
      releaseIdBox();
      ev.preventDefault();
      startFilm(lastFrame.id);
    }
  }

  function onPlateClick(ev) {
    if (player.isPlaying() || mode !== "watch") return;
    if (filmPlaying) {
      ev.preventDefault();
      if (filmCanStop()) stopFilm();
      return;
    }
    if (twinCellAt(ev) && lastFrame) {
      const twin = twinOf(lastFrame.id);
      if (twin) {
        ev.preventDefault();
        goTwin(twin);
        return;
      }
    }
    if (lastFrame && stemFilmOf(lastFrame.id)) {
      ev.preventDefault();
      startFilm(lastFrame.id);
    }
  }

  pixel.addEventListener("click", onPlateClick);
  stage.addEventListener("click", function (ev) {
    if (ev.target === pixel || pixel.contains(ev.target)) return;
    onPlateClick(ev);
  });
  stage.addEventListener("pointerdown", onPlatePointerDown);

  stage.addEventListener("pointerenter", function () {
    if (!stage.classList.contains("is-stem") || filmPlaying) return;
    const film = lastFrame && stemFilmOf(lastFrame.id);
    if (film) chain.prefetch(film.ids);
    inviteStem();
  });
  stage.addEventListener("pointerleave", function (ev) {
    stage.classList.remove("is-invite", "is-ready");
    stopFilmIfPointerLeft(ev);
  });
  document.addEventListener("pointermove", function (ev) {
    if (!filmPlaying) return;
    stopFilmIfPointerLeft(ev);
  }, { passive: true });
  stage.addEventListener("animationend", function (ev) {
    if (ev.animationName !== "stem-edge") return;
    if (stage.classList.contains("is-stem") && !filmPlaying) {
      stage.classList.add("is-ready");
    }
  });

  const touchChrome = window.matchMedia("(hover: none)").matches;
  let chromeTimer = 0;

  function showChrome() {
    salon.classList.add("chrome-on");
    window.clearTimeout(chromeTimer);
    chromeTimer = window.setTimeout(function () {
      if (document.activeElement === idInput) return;
      salon.classList.remove("chrome-on");
    }, 3000);
  }

  if (touchChrome) {
    document.addEventListener("pointerdown", function (ev) {
      const t = ev.target;
      if (t.closest("button, a, input, label, .controls, .modes, .plate, #btn-sheet")) {
        if (salon.classList.contains("chrome-on") || t.closest(".modes, #btn-sheet")) showChrome();
        return;
      }
      showChrome();
    });
  }

  idInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      readIdBox();
      idInput.blur();
    }
  });
  idInput.addEventListener("focus", function () {
    if (touchChrome) {
      window.clearTimeout(chromeTimer);
      salon.classList.add("chrome-on");
    }
  });
  idInput.addEventListener("blur", function () {
    readIdBox();
    if (touchChrome) showChrome();
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.target === idInput) return;
    if (ev.key === "e" || ev.key === "E") {
      ev.preventDefault();
      onApartClick();
      return;
    }
    if (ev.key === "d" || ev.key === "D") {
      ev.preventDefault();
      onDrawClick();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (filmPlaying) {
        stopFilm();
        return;
      }
      if (mode === "draw") leaveDraw();
      else reassemble();
      return;
    }
    if (mode === "apart" && (ev.key === "ArrowUp" || ev.key === "ArrowDown" || ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
      ev.preventDefault();
      const delta = ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 1;
      plates.moveHighlight(delta);
      return;
    }
    if (ev.key === " " || ev.code === "Space") {
      ev.preventDefault();
      if (filmPlaying) {
        stopFilm();
        return;
      }
      if (mode === "apart") {
        reassemble();
        return;
      }
      if (mode === "draw") {
        leaveDraw();
        player.play();
      } else {
        player.toggle();
      }
      syncToggle();
      setModeButtons();
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      if (filmPlaying) stopFilm();
      player.next().catch(function () {});
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (filmPlaying) stopFilm();
      player.prev().catch(function () {});
    }
  });

  Promise.all([
    fetch("data/traits.bin").then(function (r) {
      if (!r.ok) throw new Error("traits.bin missing");
      return r.arrayBuffer();
    }),
    fetch("data/labels.json").then(function (r) {
      if (!r.ok) throw new Error("labels.json missing");
      return r.json();
    }),
  ]).then(function (pair) {
    table.bytes = new Uint8Array(pair[0]);
    films = family && family.build ? family.build(table.bytes) : Object.create(null);
    twins = (function (bytes) {
      const map = Object.create(null);
      const kind = Object.create(null);
      function pairSlot(slot, allowed, tag) {
        const groups = Object.create(null);
        for (let id = 1; id <= 9999; id++) {
          const i = (id - 1) * 7;
          if (i + 6 >= bytes.length) break;
          if (allowed && allowed.indexOf(bytes[i + slot]) === -1) continue;
          const parts = [];
          for (let k = 0; k < 7; k++) if (k !== slot) parts.push(bytes[i + k]);
          const key = parts.join(",");
          if (!groups[key]) groups[key] = [];
          groups[key].push(id);
        }
        Object.keys(groups).forEach(function (k) {
          const g = groups[k];
          if (g.length !== 2) return;
          const a = bytes[(g[0] - 1) * 7 + slot];
          const b = bytes[(g[1] - 1) * 7 + slot];
          if (a === b) return;
          if (allowed && (allowed.indexOf(a) === -1 || allowed.indexOf(b) === -1)) return;
          if (map[g[0]] || map[g[1]]) return;
          map[g[0]] = g[1];
          map[g[1]] = g[0];
          kind[g[0]] = tag;
          kind[g[1]] = tag;
        });
      }
      pairSlot(4, [7, 9], "sight");
      pairSlot(4, [1, 3], "sight");
      pairSlot(4, [10, 11], "sight");
      twinKind = kind;
      return map;
    })(table.bytes);
    if (lastFrame && lastFrame.id) {
      setCaption(lastFrame.id);
      if (mode === "watch" && !player.isPlaying()) bindTwinProof(lastFrame);
      syncStemClass();
      if (stage.classList.contains("is-stem") && stage.matches(":hover")) inviteStem();
    }
    if (pair[1] && Array.isArray(pair[1].slots)) {
      table.slots = pair[1].slots.map(function (s) {
        return typeof s === "string" ? s : s.name;
      });
    }
  }).catch(function () {
    status.textContent = "trait snapshot missing — run node scripts/fetch-traits.mjs";
  });

  window.addEventListener("hashchange", function () {
    const n = parseDeepId();
    if (n !== player.getId()) player.goto(n).catch(function () {});
  });
  window.addEventListener("popstate", function () {
    const n = parseDeepId();
    if (n !== player.getId()) player.goto(n).catch(function () {});
  });

  fitPrint();
  window.addEventListener("resize", fitPrint);
  syncToggle();
  setModeButtons();
  status.textContent = "reading chain…";
  player.start().then(function (frame) {
    if (frame) canary(frame.id);
  }).catch(function (err) {
    status.textContent = err.message || "Could not reach Ethereum";
  });
})();
