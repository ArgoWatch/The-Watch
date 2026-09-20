(function () {
  "use strict";
  const { chain, decode, playback, explode, draw, sheet, family, paths, crew } = window.TheScore;

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
    live: Object.create(null),
    names: Object.create(null),
    row: function (id) {
      if (this.live[id]) return this.live[id];
      if (!this.bytes) return null;
      const i = (id - 1) * 7;
      if (i < 0 || i + 7 > this.bytes.length) return null;
      return Array.from(this.bytes.slice(i, i + 7));
    },
    valueName: function (slot, value) {
      const named = this.names[slot + ":" + value];
      if (named) return named;
      if (slot >= 2 && !value) return "None";
      return null;
    },
  };

  let mode = "watch";
  let activePath = "fleet";
  let pathLists = null;
  let pathTimer = 0;
  let crewIds = null;
  let crewAddresses = null;
  let crewLists = null;
  let echoPicksList = [];
  let echoCursor = 0;
  let echoIdle = true;
  let crewFolded = false;
  let stripPick = null;
  let arrangedList = null;
  let crewFirstIn = null;
  let crewOmit = [];
  let crewGen = 0;
  let crewBusy = false;
  let crewEditing = false;
  const OSSEN_CREW = "0x6033f255b56ebdcb7f5a408d62628733e945bb1b";
  let lastCrew = null;
  let paintCrewFields = function () {};
  const CREW_MAX = 4;
  let lastFrame = { id: 1, attributes: [], unminted: true };
  let canaryId = 0;
  let canarySampled = false;
  let revealTimer = 0;
  let twins = Object.create(null);
  let twinOk = Object.create(null);
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
  let trip = null;
  let tripSeq = 0;
  let tripTimer = 0;
  const deadSinceAt = Object.create(null);
  let ageTimer = 0;
  let ageOpen = false;
  const FILM_BEAT_MS = 1600;
  const FILM_FRAME_MS = FILM_BEAT_MS;
  const FILM_STEM_MS = FILM_BEAT_MS;
  const FILM_CODA_MS = FILM_BEAT_MS;
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

  function parseCrewFromUrl() {
    const q = new URLSearchParams(location.search);
    const raw = q.get("crew");
    if (!raw || !crew || !crew.parseAddresses) return [];
    return crew.parseAddresses(raw.replace(/[.+]/g, " "));
  }

  function parseIdList(raw) {
    const out = [];
    String(raw || "").split(/[.,]/).forEach(function (s) {
      const n = Number(s);
      if (Number.isInteger(n) && n >= 1 && n <= 9999) out.push(n);
    });
    return out;
  }

  function parseOrderFromUrl() {
    const q = new URLSearchParams(location.search).get("order");
    const out = parseIdList(q);
    return out.length ? out : null;
  }

  function parseOmitFromUrl() {
    const q = new URLSearchParams(location.search).get("omit");
    const out = parseIdList(q);
    return out.length ? out : [];
  }

  function parsePathFromUrl() {
    const q = new URLSearchParams(location.search);
    const raw = q.get("path");
    if (crewIds) {
      const s = String(raw || "watch").toLowerCase();
      if (s === "fleet") return "fleet";
      if (s === "minted") return "dealt";
      if (s === "dealt" || s === "arrived" || s === "arranged" || s === "watch") return s;
      if (s === "echo" || s.indexOf("echo:") === 0) return s;
      return "watch";
    }
    if (raw) return paths.parse(raw);
    if (q.get("bones") === "1") return "unclothed";
    return "fleet";
  }

  function pathSearch(id) {
    const p = new URLSearchParams();
    p.set("id", String(id));
    if (crewAddresses && crewAddresses.length) {
      p.set("crew", crewAddresses.join(","));
      if (activePath && activePath !== "watch") p.set("path", activePath);
      else p.set("path", "watch");
      if (arrangedList && arrangedList.length) p.set("order", arrangedList.join("."));
      if (crewOmit && crewOmit.length) p.set("omit", crewOmit.join("."));
    } else if (activePath && activePath !== "fleet") {
      p.set("path", activePath);
    }
    return "?" + p.toString();
  }

  function syncUrl(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > 9999) return;
    const url = new URL(location.href);
    url.search = pathSearch(n).slice(1);
    url.hash = "";
    const next = url.pathname + url.search;
    if (next === location.pathname + location.search && !location.hash) return;
    history.replaceState({ id: n, path: activePath }, "", next);
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
    if (twinOk[n] !== 1) return 0;
    if (lastFrame && decode.frameIsFate(lastFrame)) return 0;
    return twins[n];
  }

  function deadSinceOf(id) {
    const t = deadSinceAt[Number(id)];
    return t > 0 ? t : 0;
  }

  function formatAge(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    function z(n) {
      return String(n).padStart(2, "0");
    }
    return d + "d " + z(h) + "h " + z(m) + "m " + z(r) + "s";
  }

  function isAgeTarget(frame) {
    if (!frame || frame.unminted || frame.source === "render") return false;
    return decode.frameIsFate(frame);
  }

  function canOpenAge(frame) {
    if (!isAgeTarget(frame)) return false;
    if (filmPlaying) return false;
    if (mode !== "watch") return false;
    if (player && player.isPlaying()) return false;
    return true;
  }

  function requestAge() {
    if (mode !== "watch" || filmPlaying) return false;
    if (!isAgeTarget(lastFrame)) return false;
    if (player && player.isPlaying()) {
      player.pause();
      syncToggle();
      setModeButtons();
    }
    openAge();
    return true;
  }

  function showAgeTick(id) {
    const n = Number(id);
    if (!ageOpen) return false;
    if (!lastFrame || lastFrame.id !== n) return false;
    if (!canOpenAge(lastFrame)) return false;
    return deadSinceOf(n) > 0;
  }

  function stopAgeTick() {
    if (!ageTimer) return;
    window.clearInterval(ageTimer);
    ageTimer = 0;
  }

  function startAgeTick() {
    if (ageTimer) return;
    ageTimer = window.setInterval(function () {
      const el = caption.querySelector(".caption-age");
      if (!el || !lastFrame || !showAgeTick(lastFrame.id)) {
        stopAgeTick();
        if (lastFrame) setCaption(lastFrame.id);
        return;
      }
      el.textContent = formatAge(Math.floor(Date.now() / 1000) - deadSinceOf(lastFrame.id));
    }, 1000);
  }

  function dismissAge() {
    if (!ageOpen) return;
    ageOpen = false;
    stopAgeTick();
    if (lastFrame) setCaption(lastFrame.id);
  }

  function openAge() {
    if (!canOpenAge(lastFrame)) return;
    ageOpen = true;
    releaseIdBox();
    pullDeadSince(lastFrame.id);
    setCaption(lastFrame.id);
  }

  function pullDeadSince(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > 9999) return;
    if (!chain.deadSince) return;
    chain.deadSince(n).then(function (t) {
      deadSinceAt[n] = Number(t) || 0;
      if (lastFrame && lastFrame.id === n) setCaption(n);
    }).catch(function () {});
  }

  function isDoor(id) {
    const n = Number(id);
    if (lastFrame && lastFrame.id === n) {
      if (lastFrame.unminted || lastFrame.source === "render") return false;
      if (decode.frameIsFate(lastFrame)) return deadSinceOf(n) > 0;
    }
    if (filmDoorOf(n)) return true;
    return !!(twins[n] && twinOk[n] === 1);
  }

  function setCaption(id) {
    const twin = filmPlaying ? 0 : twinOf(id);
    caption.replaceChildren();
    caption.appendChild(document.createTextNode("ARGONAUT "));
    const hash = document.createElement("span");
    hash.className = "caption-hash" + (isDoor(id) ? " is-door" : "");
    hash.textContent = "#";
    if (lastFrame && lastFrame.id === Number(id) && isAgeTarget(lastFrame)) {
      hash.setAttribute("role", "button");
      hash.setAttribute("aria-label", "Show how long this Argonaut has been dead");
      hash.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        requestAge();
      });
    }
    caption.appendChild(hash);
    if (twin) {
      const a = document.createElement("a");
      a.className = "caption-id" + (id < twin ? " is-lo" : " is-hi");
      a.href = pathSearch(twin);
      a.textContent = pad4(id);
      a.setAttribute("aria-label", "Argonaut " + pad4(id) + ", corresponding print");
      a.addEventListener("click", function (ev) {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        openTwin(twin);
      });
      caption.appendChild(a);
    } else {
      caption.appendChild(document.createTextNode(pad4(id)));
    }
    if (showAgeTick(id)) {
      const age = document.createElement("span");
      age.className = "caption-age";
      age.textContent = formatAge(Math.floor(Date.now() / 1000) - deadSinceOf(id));
      caption.appendChild(document.createTextNode(" "));
      caption.appendChild(age);
      startAgeTick();
    } else {
      stopAgeTick();
    }
    if (document.activeElement !== idInput) {
      idInput.value = String(id);
    }
  }

  function syncToggle() {
    if (mode === "draw") {
      toggleBtn.textContent = "▶";
      toggleBtn.setAttribute("aria-label", "Play");
      toggleBtn.setAttribute("aria-pressed", "false");
      return;
    }
    const on = walkIsOn();
    toggleBtn.textContent = on ? "❚❚" : "▶";
    toggleBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    toggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function refreshPlates() {
    const rows = plates.rowsFrom(lastFrame, table);
    plates.paint(rows);
  }

  function setModeButtons() {
    const playing = walkIsOn();
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
    const crewBtn = document.getElementById("btn-crew");
    if (crewBtn) {
      const on = !!(crewIds || crewBusy || crewEditing);
      crewBtn.classList.toggle("is-on", on);
      crewBtn.classList.toggle("is-loading", crewBusy);
      crewBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    syncCrewChrome();
    if (mode !== "watch") {
      salon.classList.remove("paths-on");
      window.clearTimeout(pathTimer);
    }
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
      if (el.getAttribute("data-stamp-lamp") != null) continue;
      const fill = String(el.getAttribute("fill") || "").toLowerCase();
      const w = Number(el.getAttribute("width"));
      const h = Number(el.getAttribute("height"));
      const raw = el.getAttribute("fill-opacity");
      const o = raw == null || raw === "" ? 1 : Number(raw);
      if (!decode.isPrintStamp({ fill: fill, w: w, h: h, opacity: o })) continue;
      out.push({ el: el, fill: fill });
    }
    return out;
  }

  function stampLuma(hex) {
    const rgb = decode.hexRgb(hex);
    if (!rgb) return 0;
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  }

  function grayHex(luma) {
    const v = Math.max(0, Math.min(255, Math.round(luma * 255)));
    const h = (v < 16 ? "0" : "") + v.toString(16);
    return "#" + h + h + h;
  }

  function stampCover(svgEl, x, y, ground) {
    const rects = svgEl.getElementsByTagName("rect");
    let cover = ground;
    for (let i = 0; i < rects.length; i++) {
      const el = rects[i];
      if (el.getAttribute("data-stamp-lamp") != null) continue;
      const fill = String(el.getAttribute("fill") || "").toLowerCase();
      const w = Number(el.getAttribute("width"));
      const h = Number(el.getAttribute("height"));
      const rx = Number(el.getAttribute("x"));
      const ry = Number(el.getAttribute("y"));
      const raw = el.getAttribute("fill-opacity");
      const o = raw == null || raw === "" ? 1 : Number(raw);
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
      if (x < rx || y < ry || x >= rx + w || y >= ry + h) continue;
      if (decode.isPrintStamp({ fill: fill, w: w, h: h, opacity: o })) continue;
      if (o < 0.5) continue;
      cover = fill;
    }
    return cover;
  }

  function stampPeakFill(fill, cover) {
    const black = stampLuma(fill) < 0.5;
    const c = stampLuma(cover);
    if (black) {
      if (c >= 0.3) return fill;
      return grayHex(Math.min(0.46, c + 0.32));
    }
    if (1 - c >= 0.3) return fill;
    return grayHex(Math.max(0.62, c - 0.32));
  }

  function setStampOp(marks, t) {
    marks.forEach(function (m) {
      m.el.setAttribute("fill-opacity", String(t));
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
    if (lastFrame && (lastFrame.unminted || lastFrame.source === "render")) return;
    if (decode.frameIsFate(lastFrame)) return;
    const marks = stampMarks(svgEl);
    if (!marks.length) return;
    const hold = player.stillMs ? player.stillMs() : Math.round(1400 / (player.getRate() || 0.5));
    const tail = Math.round(hold * (800 / 2800));
    const inner = Math.max(0, hold - tail);
    const rest = Math.round(inner * (500 / 2000));
    const fade = Math.round(inner * (500 / 2000));
    const peak = Math.max(0, inner - rest - fade * 2);
    if (fade < 80) return;
    const groundEl = svgEl.querySelector("rect:not([data-stamp-lamp])");
    const ground = groundEl ? String(groundEl.getAttribute("fill") || "") : "#000000";
    const NS = "http://www.w3.org/2000/svg";
    const lamps = marks.map(function (m) {
      const x = Number(m.el.getAttribute("x"));
      const y = Number(m.el.getAttribute("y"));
      const cover = stampCover(svgEl, x, y, ground);
      const c = svgEl.ownerDocument.createElementNS(NS, "rect");
      c.setAttribute("x", m.el.getAttribute("x"));
      c.setAttribute("y", m.el.getAttribute("y"));
      c.setAttribute("width", "1");
      c.setAttribute("height", "1");
      c.setAttribute("fill", stampPeakFill(m.fill, cover));
      c.setAttribute("fill-opacity", "0");
      c.setAttribute("data-stamp-lamp", "");
      svgEl.appendChild(c);
      return { el: c };
    });
    stampRestore = function () {
      lamps.forEach(function (m) {
        if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
      });
      stampRestore = null;
    };
    stampTimer = window.setTimeout(function () {
      fadeStamps(lamps, 0, 1, fade, function () {
        stampTimer = window.setTimeout(function () {
          fadeStamps(lamps, 1, 0, fade, function () {
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
    if (decode.frameIsFate(frame)) return;
    if (frame.unminted || frame.source === "render") return;
    const cand = twins[frame.id];
    if (!cand) return;
    const traits = table.row(frame.id);
    const other = table.row(cand);
    if (!traits || !other || !explode.traitDiffCells) return;
    const show = !(player && player.isPlaying()) && !trip;
    const seq = ++twinSeq;
    const invite = twinInvite;
    twinInvite = false;
    Promise.all([
      explode.traitDiffCells(traits, other),
      loadArt(cand),
    ]).then(function (pair) {
      if (seq !== twinSeq || !lastFrame || lastFrame.id !== frame.id) return;
      const cells = pair[0] || [];
      const mate = pair[1];
      if (!mate || !mate.svg || mate.unminted || !frame.svg || !explode.printDiffCells) {
        twinOk[frame.id] = 1;
        twinOk[cand] = 1;
        if (show) {
          twinCells = cells;
          placeTwinProof(twinCells, invite);
        }
        setCaption(frame.id);
        return;
      }
      const sight = Object.create(null);
      cells.forEach(function (c) {
        sight[c.x + "," + c.y] = true;
      });
      const extras = explode.printDiffCells(frame.svg, mate.svg).filter(function (c) {
        return !sight[c.x + "," + c.y];
      });
      if (extras.length) {
        twinOk[frame.id] = -1;
        twinOk[cand] = -1;
        setCaption(frame.id);
        return;
      }
      twinOk[frame.id] = 1;
      twinOk[cand] = 1;
      if (show) {
        twinCells = cells;
        placeTwinProof(twinCells, invite);
      }
      setCaption(frame.id);
    }).catch(function () {});
  }

  function goTwin(id) {
    twinInvite = true;
    pixel.classList.remove("twin-arrive");
    void pixel.offsetWidth;
    pixel.classList.add("twin-arrive");
    return player.goto(id).catch(function () {
      twinInvite = false;
    });
  }

  function walkIsOn() {
    return !!(player && player.isPlaying()) || !!(trip && trip.resume);
  }

  function beginTrip(kind, home, resume) {
    abandonTrip();
    tripSeq += 1;
    trip = { kind: kind, home: Number(home), resume: !!resume, seq: tripSeq };
    if (resume && player && player.isPlaying()) {
      player.pause();
      syncToggle();
      setModeButtons();
    }
    dismissAge();
    return trip;
  }

  function cancelTrip() {
    window.clearTimeout(tripTimer);
    tripTimer = 0;
    tripSeq += 1;
    const t = trip;
    trip = null;
    if (filmPlaying) stopFilm();
    syncToggle();
    setModeButtons();
    return t;
  }

  function abandonTrip() {
    const t = cancelTrip();
    if (!t) return null;
    if (t.kind === "twin" && player.getId() !== t.home) {
      player.goto(t.home).catch(function () {});
    }
    return t;
  }

  function openTwin(twinId) {
    if (mode !== "watch" || filmPlaying) return;
    if (!lastFrame) return;
    const home = Number(lastFrame.id);
    const resume = !!(player && player.isPlaying());
    beginTrip("twin", home, resume);
    const seq = trip.seq;
    Promise.resolve(goTwin(twinId)).then(function () {
      if (seq !== tripSeq) return;
      tripTimer = window.setTimeout(function () {
        if (seq !== tripSeq || !trip || trip.kind !== "twin") return;
        player.goto(home).then(function () {
          if (seq !== tripSeq) return;
          trip = null;
          if (resume && mode === "watch") player.play();
          syncToggle();
          setModeButtons();
        }).catch(function () {
          trip = null;
          syncToggle();
          setModeButtons();
        });
      }, FILM_BEAT_MS);
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

  function filmDoorOf(id) {
    const film = films[Number(id)];
    if (!film || !film.ids || film.ids.length < 2) return null;
    if (film.stem !== Number(id) && film.apex !== Number(id)) return null;
    return film;
  }

  function syncStemClass() {
    const on =
      mode === "watch" &&
      !filmPlaying &&
      !(player && player.isPlaying()) &&
      lastFrame &&
      lastFrame.source !== "render" &&
      !lastFrame.unminted &&
      !decode.frameIsFate(lastFrame) &&
      !!filmDoorOf(lastFrame.id);
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
    if (trip && trip.resume) return;
    if (ev && ev.pointerType === "touch") return;
    if (performance.now() - filmStartedAt < 120) return;
    if (ev && pointerInStage(ev)) return;
    abandonTrip();
  }

  function stopFilm() {
    const was = filmPlaying;
    abortFilm();
    if (was && lastFrame) {
      mountArt(lastFrame);
      setCaption(lastFrame.id);
      syncUrl(lastFrame.id);
    }
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
    if (!frame || frame.unminted || frame.source === "render" || frame.error) return false;
    if (decode.frameIsFate(frame)) return false;
    if (frame.kind === "gif" || frame.kind === "raster") return false;
    if (!frame.svg) return false;
    try {
      pixel.replaceChildren(decode.sanitizeSvg(frame.svg));
      unmintedEl.hidden = true;
      stage.classList.remove("is-empty");
      setCaption(frame.id);
      syncUrl(frame.id);
      return true;
    } catch (_) {
      return false;
    }
  }

  function releaseIdBox() {
    if (document.activeElement === idInput) idInput.blur();
  }

  async function startFilm(doorId) {
    const film = filmDoorOf(doorId);
    if (!film) return;
    if (mode !== "watch") return;
    if (trip && trip.kind === "twin") return;
    const home = Number(doorId);
    const resume = !!(player && player.isPlaying());
    beginTrip("film", home, resume);
    const tripAt = trip.seq;
    releaseIdBox();

    const forward = Number(doorId) === film.stem;
    const ids = forward ? film.ids : film.reverse;
    filmSeq += 1;
    const seq = filmSeq;
    window.clearTimeout(filmTimer);
    filmPlaying = true;
    filmLive = false;
    filmStartedAt = performance.now();
    stage.classList.add("is-film");
    stage.classList.remove("is-invite", "is-ready", "is-stem");
    ids.forEach(function (id) {
      loadArt(id).catch(function () {});
    });

    if (lastFrame && lastFrame.svg) paintFilmFrame(lastFrame);

    for (let i = 1; i < ids.length; i++) {
      if (seq !== filmSeq) return;
      try {
        const frame = await loadArt(ids[i]);
        if (seq !== filmSeq) return;
        if (!paintFilmFrame(frame)) continue;
        filmLive = true;
      } catch (_) {
        continue;
      }
      const last = i === ids.length - 1;
      if (!(await filmWait(last ? FILM_CODA_MS : FILM_FRAME_MS, seq))) return;
    }

    if (seq !== filmSeq) return;
    try {
      const home = await loadArt(ids[0]);
      if (seq !== filmSeq) return;
      paintFilmFrame(home);
    } catch (_) {}
    if (!(await filmWait(FILM_STEM_MS, seq))) return;
    if (seq !== filmSeq) return;
    stopFilm();
    if (tripAt !== tripSeq || !trip || trip.kind !== "film") return;
    const should = trip.resume;
    trip = null;
    syncToggle();
    setModeButtons();
    if (should && mode === "watch") player.play();
  }

  function clearRevealWell() {
    stage.style.removeProperty("background");
    unmintedEl.classList.remove("is-fade", "is-label", "is-light", "is-dark");
  }

  function paletteHex(svgText) {
    const m = /fill="(#[0-9A-Fa-f]{3,6})"/.exec(svgText || "");
    return m && decode.HEX.test(m[1]) ? m[1] : "";
  }

  function labelOnPalette(hex) {
    const rgb = decode.hexRgb(hex);
    if (!rgb) return "is-light";
    const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return luma >= 0.5 ? "is-dark" : "is-light";
  }

  function mountArt(frame) {
    clearStampLamp();
    window.clearTimeout(revealTimer);
    revealTimer = 0;
    clearRevealWell();
    if (!frame) return;
    if (frame.unminted && !frame.svg) {
      pixel.replaceChildren();
      unmintedEl.hidden = false;
      stage.classList.add("is-empty");
      return;
    }
    if (frame.unminted && frame.svg) {
      let svg;
      try {
        svg = decode.sanitizeSvg(frame.svg);
      } catch (_) {
        pixel.replaceChildren();
        unmintedEl.hidden = false;
        stage.classList.add("is-empty");
        return;
      }
      const pal = paletteHex(frame.svg);
      if (pal) stage.style.background = pal;
      svg.classList.add("is-waiting");
      pixel.replaceChildren(svg);
      unmintedEl.classList.add("is-label", pal ? labelOnPalette(pal) : "is-light");
      unmintedEl.classList.remove("is-fade");
      unmintedEl.hidden = false;
      stage.classList.add("is-empty");
      const still = player && player.stillMs ? player.stillMs() : 2800;
      const hold = reduceMotion.matches ? 0 : Math.min(900, Math.max(600, Math.round(still * (700 / 2800))));
      const fade = reduceMotion.matches ? 0 : 700;
      revealTimer = window.setTimeout(function () {
        if (!lastFrame || lastFrame.id !== frame.id) return;
        stage.classList.remove("is-empty");
        svg.classList.add("is-reveal");
        void svg.getBoundingClientRect();
        svg.classList.remove("is-waiting");
        unmintedEl.classList.add("is-fade");
        revealTimer = window.setTimeout(function () {
          revealTimer = 0;
          if (!lastFrame || lastFrame.id !== frame.id) return;
          unmintedEl.hidden = true;
          unmintedEl.classList.remove("is-fade", "is-label", "is-light", "is-dark");
          stage.style.removeProperty("background");
        }, fade);
      }, hold);
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
      if (frame.source !== "render") {
        scheduleStampLamp(svg);
        bindTwinProof(frame);
      }
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
    if (lastFrame && (lastFrame.unminted || lastFrame.source === "render")) return;
    abandonTrip();
    if (filmPlaying) stopFilm();
    dismissAge();
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

  function leaveModeAndPlay() {
    abandonTrip();
    if (mode === "apart") reassemble();
    else if (mode === "draw") leaveDraw();
    player.play();
    syncToggle();
    setModeButtons();
  }

  function toggleWalk() {
    if (trip) {
      const t = trip;
      abandonTrip();
      if (!t.resume) {
        player.goto(t.home).then(function () {
          player.play();
          syncToggle();
          setModeButtons();
        }).catch(function () {});
      }
      return;
    }
    if (filmPlaying) stopFilm();
    player.toggle();
    syncToggle();
    setModeButtons();
  }

  function onWatchClick() {
    releaseIdBox();
    if (mode === "apart" || mode === "draw") {
      leaveModeAndPlay();
      showPaths();
      return;
    }
    toggleWalk();
    showPaths();
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
    if (snap) {
      paintChips(snap);
      return;
    }
    chain.traitsOf(id).then(function (live) {
      paintChips(live);
    }).catch(function () {});
  }

  function enterApart() {
    abandonTrip();
    if (filmPlaying) stopFilm();
    if (mode === "draw") {
      stopDraw();
      restoreSvg();
    }
    dismissAge();
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
    loadArt(lastFrame.id, { fresh: true }).then(function (frame) {
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

  function probeTraits(id) {
    chain.traitsOf(id).then(function (live) {
      const snap = table.row(id);
      if (snap && !sameTraits(live, snap)) {
        table.stale = true;
        table.live[id] = Array.from(live);
        if (!table.staleNoted) {
          table.staleNoted = true;
          status.textContent = "trait table changed on chain — run node scripts/fetch-traits.mjs";
        }
      }
    }).catch(function () {});
  }

  function canary(id) {
    if (!table.bytes) return;
    if (id !== canaryId) {
      canaryId = id;
      probeTraits(id);
    }
    if (canarySampled) return;
    canarySampled = true;
    probeTraits(player.wrap(id + 97));
    probeTraits(player.wrap(id + 333));
  }

  function rememberAttrs(id, attrs) {
    const t = table.row(id);
    if (!t || !attrs) return;
    attrs.forEach(function (a) {
      const name = String(a && a.trait_type || "").toLowerCase();
      const slot = table.slots.findIndex(function (s) {
        return s.toLowerCase() === name;
      });
      if (slot < 0) return;
      if (slot >= 2 && !t[slot]) return;
      const val = String(a.value || "");
      if (!val || val === "None" || val === "Unknown") return;
      table.names[slot + ":" + t[slot]] = val;
    });
  }

  function attributesFor(id, traits) {
    const t = traits || table.row(id);
    if (!t) return [];
    return table.slots.map(function (name, i) {
      const v = t[i];
      const named = table.valueName(i, v);
      return { trait_type: name, value: v ? named || "Unknown" : "None" };
    });
  }

  function loadArt(id, opts) {
    const traits = table.row(id);
    return chain.loadFrame(id, Object.assign({
      traits: traits,
      attributes: attributesFor(id, traits),
    }, opts || {})).then(function (frame) {
      if (frame && frame.attributes && frame.source !== "render") {
        rememberAttrs(frame.id, frame.attributes);
      }
      return frame;
    });
  }

  function paint(frame) {
    if (filmPlaying) abortFilm();
    if (frame.pending) {
      if (frame.id && lastFrame && frame.id !== lastFrame.id) dismissAge();
      if (!pixel.querySelector("svg, canvas, img")) veil.hidden = false;
      return;
    }
    veil.hidden = true;
    if (lastFrame && frame.id !== lastFrame.id) ageOpen = false;
    lastFrame = frame;
    if (decode.frameIsFate(frame) && !frame.unminted && frame.source !== "render") {
      pullDeadSince(frame.id);
    }
    setCaption(frame.id);
    syncUrl(frame.id);
    markStripCurrent();
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
      if (plates.warm && table.row) {
        const n = Number(frame.id);
        [player.after(n, -1), player.after(n, 1)].forEach(function (id) {
          const t = table.row(id);
          if (t) plates.warm(t);
        });
      }
    }

    if (frame.error) {
      syncStemClass();
      return;
    }

    mountArt(frame);
    syncStemClass();
    if (mode === "watch" && !filmPlaying) bindTwinProof(frame);
  }

  const player = playback.createPlayback({
    id: parseDeepId(),
    rate: 0.5,
    loadFrame: loadArt,
    prefetch: chain.prefetch,
    holdExtra: function (frame) {
      if (decode.frameIsFate(frame)) return 800;
      if (frame && frame.unminted && frame.svg) return 400;
      return 0;
    },
    onPlayChange: function (on) {
      if (on && filmPlaying) abortFilm();
      syncToggle();
      setModeButtons();
      syncStemClass();
      if (on) dismissAge();
      else if (lastFrame) setCaption(lastFrame.id);
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

  const pathsEl = document.getElementById("paths");

  function listForPath(name) {
    if (crewIds && crewLists) {
      if (name === "fleet") return null;
      const list = crewLists[name];
      return list && list.length ? list : null;
    }
    if (!name || name === "fleet") return null;
    if (!pathLists) return null;
    const list = pathLists[name];
    return list && list.length ? list : null;
  }

  function markPathButtons() {
    if (!pathsEl) return;
    pathsEl.querySelectorAll("[data-path]").forEach(function (btn) {
      if (btn.classList.contains("is-leave") || btn.classList.contains("is-fold")) {
        btn.classList.remove("is-on");
        btn.removeAttribute("aria-current");
        return;
      }
      const on = btn.getAttribute("data-path") === activePath;
      btn.classList.toggle("is-on", on);
      if (on) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });
  }

  function adoptPath(name, opts) {
    let next = crewIds ? String(name || "watch").toLowerCase() : paths.parse(name);
    if (crewIds && next === "fleet") return false;
    const list = listForPath(next);
    if (next !== "fleet" && !list) return false;
    if (next === activePath && !(opts && opts.force)) return false;
    activePath = next;
    const idle = String(next).indexOf("echo:") !== 0;
    const idleChanged = idle !== echoIdle;
    echoIdle = idle;
    player.setList(list);
    if (crewIds && idleChanged) rebuildPathNav();
    else markPathButtons();
    paintStrip();
    return true;
  }

  function walkPath(name) {
    if ((crewIds || crewBusy) && String(name) === "fold") {
      foldCrewChrome();
      return;
    }
    if ((crewIds || crewBusy) && String(name) === "fleet") {
      stashAndLeave();
      return;
    }
    const next = crewIds ? String(name || "watch").toLowerCase() : paths.parse(name);
    if (next === activePath) {
      abandonTrip();
      const dest = startOfPath();
      syncUrl(dest);
      player.goto(dest, { keepPlay: true }).then(function () {
        player.play();
        syncToggle();
        setModeButtons();
      }).catch(function () {});
      return;
    }
    abandonTrip();
    if (!adoptPath(next)) return;
    const dest = startOfPath();
    syncUrl(dest);
    player.goto(dest, { keepPlay: true }).then(function () {
      player.play();
      syncToggle();
      setModeButtons();
    }).catch(function () {});
  }

  function startOfPath() {
    if (!crewIds && activePath === "fleet") return 1;
    const list = listForPath(activePath);
    if (list && list.length) return list[0];
    if (crewIds && crewIds.length) return crewIds[0];
    return 1;
  }

  function slotNameOf(slot, v) {
    const named = table.names[slot + ":" + v];
    if (named) return named;
    if (slot >= 2 && !v) return "None";
    return table.valueName(slot, v);
  }

  function currentEcho() {
    if (!echoPicksList.length) return null;
    if (echoCursor < 0 || echoCursor >= echoPicksList.length) echoCursor = 0;
    return echoPicksList[echoCursor];
  }

  function cycleEcho(dir) {
    if (!echoPicksList.length) return;
    const n = echoPicksList.length;
    if (echoIdle) {
      echoIdle = false;
      echoCursor = dir < 0 ? n - 1 : 0;
    } else {
      echoCursor = ((echoCursor + Number(dir) % n) + n) % n;
    }
    const pick = currentEcho();
    rebuildPathNav();
    showPaths();
    if (pick) walkPath(pick.id);
  }

  function makeEchoDeck() {
    const wrap = document.createElement("span");
    wrap.className = "echo-deck";
    const pick = currentEcho();
    const idle = echoIdle || !pick;
    const many = echoPicksList.length > 1;
    if (many) {
      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "echo-step";
      prev.setAttribute("data-echo-step", "-1");
      prev.setAttribute("aria-label", "Previous theme");
      prev.textContent = "‹";
      wrap.appendChild(prev);
    }
    const name = document.createElement("button");
    name.type = "button";
    if (idle) {
      name.setAttribute("data-echo-step", "1");
      name.textContent = "Themes";
    } else {
      name.setAttribute("data-path", pick.id);
      name.textContent = pick.label;
    }
    wrap.appendChild(name);
    if (many) {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "echo-step";
      next.setAttribute("data-echo-step", "1");
      next.setAttribute("aria-label", "Next theme");
      next.textContent = "›";
      wrap.appendChild(next);
    }
    return wrap;
  }

  function rebuildPathNav() {
    if (!pathsEl) return;
    pathsEl.replaceChildren();
    const items = [];
    if (crewIds && !crewBusy) {
      items.push({ id: "fold", label: "_", fold: true });
      items.push({ id: "fleet", label: "×", leave: true });
      items.push({ id: "watch", label: "Suit Up" });
      if (echoPicksList.length) items.push({ deck: true });
      items.push({ id: "dealt", label: "As Minted" });
      if (crewLists && crewLists.arrived && crewLists.arrived.length) {
        items.push({ id: "arrived", label: "As Received" });
      }
      if (arrangedList && arrangedList.length) {
        items.push({ id: "arranged", label: "As Arranged" });
      }
    } else if (crewBusy) {
      items.push({ id: "fold", label: "_", fold: true });
      items.push({ id: "fleet", label: "×", leave: true });
    } else if (!crewEditing) {
      items.push({ id: "fleet", label: "Fleet" });
      items.push({ id: "unclothed", label: "Unclothed" });
      items.push({ id: "cloak", label: "Cloak" });
      items.push({ id: "relic", label: "Relic" });
      items.push({ id: "sight", label: "Sight" });
      items.push({ id: "artifact", label: "Artifact" });
      items.push({ id: "crown", label: "Crown" });
    }
    items.forEach(function (item) {
      if (item.deck) {
        pathsEl.appendChild(makeEchoDeck());
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-path", item.id);
      btn.textContent = item.label;
      if (item.fold) {
        btn.classList.add("is-fold");
        btn.setAttribute("aria-label", "Hide crew");
      }
      if (item.leave) {
        btn.classList.add("is-leave");
        btn.setAttribute("aria-label", "Leave crew");
      }
      pathsEl.appendChild(btn);
    });
    markPathButtons();
    setModeButtons();
    syncCrewChrome();
  }

  function buildCrewLists(ids, firstIn) {
    const rowOf = function (id) {
      return table.row(id);
    };
    const watch = crew.watchSort(ids, rowOf);
    const dealt = crew.dealtSort(ids);
    const arrived = crew.arrivedSort(ids, firstIn);
    const keepEcho = echoPicksList[echoCursor] ? echoPicksList[echoCursor].id : "";
    echoPicksList = crew.echoPicks ? crew.echoPicks(ids, rowOf, slotNameOf) : [];
    echoCursor = 0;
    if (keepEcho) {
      const i = echoPicksList.findIndex(function (p) {
        return p.id === keepEcho;
      });
      if (i >= 0) echoCursor = i;
    }
    if (String(activePath || "").indexOf("echo:") === 0) {
      const j = echoPicksList.findIndex(function (p) {
        return p.id === activePath;
      });
      if (j >= 0) echoCursor = j;
    }
    crewLists = {
      watch: watch,
      dealt: dealt,
      arrived: arrived,
      arranged: arrangedList,
    };
    echoPicksList.forEach(function (pick) {
      crewLists[pick.id] = pick.ids;
    });
  }

  const stripArtWait = [];
  let stripArtLive = 0;
  const STRIP_ART_N = 4;

  function fillStripWell(cell, well, id) {
    function run() {
      if (stripArtLive >= STRIP_ART_N) {
        stripArtWait.push(run);
        return;
      }
      stripArtLive += 1;
      loadArt(id).then(function (frame) {
        if (!cell.isConnected) return;
        well.classList.remove("is-wait");
        if (!frame || !frame.svg) return;
        try {
          well.replaceChildren(decode.sanitizeSvg(frame.svg));
        } catch (_) {}
      }).catch(function () {
        if (cell.isConnected) well.classList.remove("is-wait");
      }).then(function () {
        stripArtLive -= 1;
        const next = stripArtWait.shift();
        if (next) next();
      });
    }
    run();
  }

  function makeStripCell(id) {
    const cell = document.createElement("span");
    cell.className = "strip-cell";
    cell.setAttribute("data-id", String(id));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "strip-go";
    btn.setAttribute("aria-label", "Argonaut " + pad4(id));
    const well = document.createElement("div");
    well.className = "pixel is-wait";
    btn.appendChild(well);
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "strip-drop";
    drop.setAttribute("aria-label", "Leave this Argonaut");
    drop.textContent = "×";
    cell.appendChild(btn);
    cell.appendChild(drop);
    fillStripWell(cell, well, id);
    return cell;
  }

  function paintStrip() {
    const host = document.getElementById("path-strip");
    if (!host) return;
    if (!crewIds || !crewIds.length) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const list = (crewBusy ? crewIds : (listForPath(activePath) || crewIds)).slice();
    host.hidden = false;
    const byId = Object.create(null);
    Array.prototype.forEach.call(host.children, function (el) {
      const id = Number(el.getAttribute("data-id"));
      if (id) byId[id] = el;
    });
    const keep = Object.create(null);
    const frag = document.createDocumentFragment();
    const cur = player.getId();
    list.forEach(function (id) {
      keep[id] = true;
      let cell = byId[id];
      if (!cell) cell = makeStripCell(id);
      cell.classList.toggle("is-on", id === cur);
      cell.classList.toggle("is-pick", stripPick === id);
      frag.appendChild(cell);
    });
    host.replaceChildren();
    host.appendChild(frag);
  }

  function markStripCurrent() {
    const host = document.getElementById("path-strip");
    if (!host || host.hidden) return;
    const id = player.getId();
    host.querySelectorAll("[data-id]").forEach(function (btn) {
      btn.classList.toggle("is-on", Number(btn.getAttribute("data-id")) === id);
    });
  }

  function applyArranged(ids) {
    arrangedList = ids.slice();
    if (!crewLists) crewLists = {};
    crewLists.arranged = arrangedList;
    rebuildPathNav();
    abandonTrip();
    adoptPath("arranged", { force: true });
    snapshotCrew();
    syncUrl(player.getId());
  }

  function copyFirstIn(src) {
    const out = Object.create(null);
    if (!src) return out;
    Object.keys(src).forEach(function (k) {
      out[k] = src[k];
    });
    return out;
  }

  function snapshotCrew() {
    if (!crewAddresses || !crewAddresses.length || !crewIds || !crewIds.length) return;
    lastCrew = {
      addresses: crewAddresses.slice(),
      ids: crewIds.slice(),
      firstIn: copyFirstIn(crewFirstIn),
      omit: crewOmit.slice(),
      arranged: arrangedList ? arrangedList.slice() : null,
      path: activePath,
      echoCursor: echoCursor,
      id: player.getId(),
    };
  }

  function parkLiveCrew() {
    abandonTrip();
    crewGen += 1;
    crewIds = null;
    crewAddresses = null;
    crewLists = null;
    echoPicksList = [];
    echoCursor = 0;
    arrangedList = null;
    crewFirstIn = null;
    crewOmit = [];
    crewBusy = false;
    crewFolded = false;
    echoIdle = true;
    stripPick = null;
    salon.classList.remove("crew-busy");
    paintStrip();
  }

  function inCrew() {
    return !!(crewIds || crewBusy || crewEditing);
  }

  function foldCrewChrome() {
    if (!inCrew()) return;
    crewFolded = true;
    salon.classList.remove("paths-on");
    syncCrewChrome();
  }

  function crewChromeOpen() {
    if (!inCrew()) return false;
    if (crewBusy && !crewFolded) return true;
    if (crewFolded) return false;
    return true;
  }

  function syncCrewChrome() {
    const root = document.getElementById("crew");
    salon.classList.toggle("crew-live", crewChromeOpen());
    if (!root) return;
    root.classList.toggle("is-edit", crewChromeOpen());
    if (idInput) idInput.tabIndex = crewEditing ? -1 : 0;
  }

  function stashAndLeave() {
    snapshotCrew();
    crewEditing = false;
    const crewRoot = document.getElementById("crew");
    if (crewRoot) crewRoot.classList.remove("is-edit");
    parkLiveCrew();
    rebuildPathNav();
    adoptPath("fleet", { force: true });
    syncUrl(player.getId());
    setModeButtons();
  }

  function restoreLastCrew() {
    if (!lastCrew || !lastCrew.ids || !lastCrew.ids.length) return false;
    crewAddresses = lastCrew.addresses.slice();
    crewOmit = (lastCrew.omit || []).slice();
    arrangedList = lastCrew.arranged ? lastCrew.arranged.slice() : null;
    echoCursor = lastCrew.echoCursor || 0;
    crewFirstIn = copyFirstIn(lastCrew.firstIn);
    crewIds = lastCrew.ids.slice();
    crewBusy = false;
    crewEditing = false;
    crewFolded = false;
    salon.classList.remove("crew-busy");
    const crewRoot = document.getElementById("crew");
    if (crewRoot) crewRoot.classList.remove("is-edit");
    buildCrewLists(crewIds, crewFirstIn);
    const want = resolveCrewPath(lastCrew.path || "watch");
    adoptPath(want, { force: true });
    rebuildPathNav();
    const list = listForPath(want) || crewIds;
    let dest = Number(lastCrew.id);
    if (!dest || list.indexOf(dest) < 0) dest = list[0];
    showPaths();
    setModeButtons();
    paintCrewFields();
    player.goto(dest).then(function () {
      syncUrl(dest);
    }).catch(function () {});
    return true;
  }

  function clearCrew() {
    lastCrew = null;
    crewEditing = false;
    const crewRoot = document.getElementById("crew");
    if (crewRoot) crewRoot.classList.remove("is-edit");
    parkLiveCrew();
    rebuildPathNav();
    adoptPath("fleet", { force: true });
    syncUrl(player.getId());
    setModeButtons();
  }

  function idsWithoutOmit(ids) {
    if (!crewOmit || !crewOmit.length) return ids.slice();
    const skip = Object.create(null);
    crewOmit.forEach(function (id) {
      skip[id] = true;
    });
    return ids.filter(function (id) {
      return !skip[id];
    });
  }

  function resolveCrewPath(want) {
    const s = String(want || "watch").toLowerCase();
    if (s === "minted") return "dealt";
    if (s === "echo") {
      return echoPicksList.length ? echoPicksList[0].id : "watch";
    }
    if (s.indexOf("echo:") === 0) {
      if (crewLists && crewLists[s] && crewLists[s].length) return s;
      return echoPicksList.length ? echoPicksList[0].id : "watch";
    }
    if (s === "arrived" && !(crewLists && crewLists.arrived && crewLists.arrived.length)) return "watch";
    if (s === "arranged" && !(arrangedList && arrangedList.length)) return "watch";
    if (s === "dealt" || s === "watch" || s === "arranged" || s === "arrived") return s;
    return "watch";
  }

  function applyCrewHoldings(got, opts, live) {
    if (!got || !got.ids || !got.ids.length) return false;
    crewAddresses = got.addresses || crewAddresses;
    crewFirstIn = got.firstIn || crewFirstIn;
    crewIds = idsWithoutOmit(got.ids);
    if (!crewIds.length) return false;
    if (opts && opts.order && opts.order.length && !live) {
      const allow = Object.create(null);
      crewIds.forEach(function (id) {
        allow[id] = true;
      });
      arrangedList = opts.order.filter(function (id) {
        return allow[id];
      });
      crewIds.forEach(function (id) {
        if (arrangedList.indexOf(id) < 0) arrangedList.push(id);
      });
    }
    buildCrewLists(crewIds, crewFirstIn);
    paintStrip();
    return true;
  }

  function finishCrew(got, opts) {
    opts = opts || {};
    crewBusy = false;
    salon.classList.remove("crew-busy");
    if (!applyCrewHoldings(got, opts, false)) {
      rebuildPathNav();
      setModeButtons();
      return Promise.resolve();
    }
    const want = resolveCrewPath(opts.path || "watch");
    adoptPath(want, { force: true });
    rebuildPathNav();
    const list = listForPath(want) || crewIds;
    let dest = Number(opts.id);
    if (!dest || list.indexOf(dest) < 0) dest = list[0];
    showPaths();
    setModeButtons();
    snapshotCrew();
    paintCrewFields();
    return player.goto(dest, { keepPlay: opts.keepPlay }).then(function () {
      syncUrl(dest);
    });
  }

  function removeCrewId(id) {
    id = Number(id);
    if (!crewIds || crewIds.indexOf(id) < 0) return;
    crewIds = crewIds.filter(function (n) {
      return n !== id;
    });
    if (arrangedList) {
      arrangedList = arrangedList.filter(function (n) {
        return n !== id;
      });
    }
    if (crewOmit.indexOf(id) < 0) crewOmit.push(id);
    if (!crewIds.length) {
      clearCrew();
      return;
    }
    abandonTrip();
    buildCrewLists(crewIds, crewFirstIn);
    let next = activePath;
    if (!listForPath(next)) next = "watch";
    adoptPath(next, { force: true });
    rebuildPathNav();
    paintStrip();
    snapshotCrew();
    if (player.getId() === id) {
      const dest = startOfPath();
      syncUrl(dest);
      player.goto(dest).catch(function () {});
    } else {
      syncUrl(player.getId());
    }
  }

  function loadCrew(text, opts) {
    opts = opts || {};
    if (!crew || !crew.holdings) return Promise.resolve();
    const addrs = crew.parseAddresses(text);
    if (!addrs.length) {
      if (!opts.fromUrl) clearCrew();
      return Promise.resolve();
    }
    const job = ++crewGen;
    if (opts.fromUrl && opts.omit) crewOmit = opts.omit.slice();
    crewBusy = true;
    salon.classList.add("crew-busy");
    rebuildPathNav();
    showPaths();
    setModeButtons();
    return crew.holdings(addrs, {
      aborted: function () {
        return job !== crewGen;
      },
      onProgress: function (got) {
        if (job !== crewGen) return;
        applyCrewHoldings(got, opts, true);
        rebuildPathNav();
      },
    }).then(function (got) {
      if (job !== crewGen) return;
      return finishCrew(got, opts);
    }).catch(function () {
      /* quiet */
    }).then(function () {
      if (job !== crewGen) return;
      crewBusy = false;
      salon.classList.remove("crew-busy");
      rebuildPathNav();
      setModeButtons();
      showPaths();
    });
  }

  function restartShow() {
    const keep = walkIsOn();
    abandonTrip();
    const dest = startOfPath();
    if (player.getId() === dest && lastFrame && lastFrame.id === dest) {
      if (keep) player.play();
      return;
    }
    player.goto(dest, { keepPlay: keep }).then(function () {
      if (keep) player.play();
    }).catch(function () {});
  }

  toggleBtn.addEventListener("click", function () {
    releaseIdBox();
    if (mode === "draw" || mode === "apart") {
      leaveModeAndPlay();
      return;
    }
    toggleWalk();
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
    abandonTrip();
    player.prev().catch(function () {});
  });
  nextBtn.addEventListener("click", function () {
    abandonTrip();
    player.next().catch(function () {});
  });
  if (pathsEl) {
    pathsEl.addEventListener("click", function (ev) {
      const step = ev.target.closest("[data-echo-step]");
      if (step && mode === "watch") {
        ev.preventDefault();
        cycleEcho(Number(step.getAttribute("data-echo-step")));
        return;
      }
      const btn = ev.target.closest("[data-path]");
      if (!btn || mode !== "watch") return;
      walkPath(btn.getAttribute("data-path"));
    });
    pathsEl.addEventListener("focusin", function () {
      if (mode === "watch") showPaths();
    });
  }

  (function bindCrew() {
    const crewRoot = document.getElementById("crew");
    const crewBtn = document.getElementById("btn-crew");
    const fields = document.getElementById("crew-fields");
    if (!crewRoot || !crewBtn || !fields) return;

    function rows() {
      return fields.querySelectorAll(".crew-addr");
    }

    function addRow(value) {
      if (rows().length >= CREW_MAX) return;
      const row = document.createElement("div");
      row.className = "crew-row";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "crew-addr";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("autocorrect", "off");
      input.setAttribute("enterkeyhint", "go");
      input.setAttribute("aria-label", "Crew address");
      if (value) input.value = value;
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "crew-drop";
      drop.textContent = "×";
      drop.setAttribute("aria-label", "Remove this address");
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "crew-add";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Another address");
      row.appendChild(input);
      row.appendChild(drop);
      row.appendChild(plus);
      fields.appendChild(row);
      plus.addEventListener("click", function () {
        addRow("");
        refreshRowChrome();
        const next = rows()[rows().length - 1];
        if (next) next.focus();
      });
      drop.addEventListener("click", function () {
        removeAddressRow(row);
      });
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitCrew();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          closeEditor();
        }
      });
      input.addEventListener("focus", function () {
        showPaths();
      });
      refreshRowChrome();
      return input;
    }

    function refreshRowChrome() {
      const pluses = fields.querySelectorAll(".crew-add");
      pluses.forEach(function (p, i) {
        p.hidden = i !== pluses.length - 1 || pluses.length >= CREW_MAX;
      });
    }

    function removeAddressRow(row) {
      if (!row || !row.parentNode) return;
      row.parentNode.removeChild(row);
      const left = crew.parseAddresses(collected());
      if (!left.length) {
        lastCrew = null;
        parkLiveCrew();
        crewEditing = true;
        crewRoot.classList.add("is-edit");
        fields.replaceChildren();
        const input = addRow(OSSEN_CREW);
        rebuildPathNav();
        showPaths();
        setModeButtons();
        syncUrl(player.getId());
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      refreshRowChrome();
      loadCrew(left.join(" "), { id: player.getId() }).catch(function () {});
    }

    function fillCrewFields() {
      const from = crewAddresses && crewAddresses.length
        ? crewAddresses
        : (lastCrew && lastCrew.addresses && lastCrew.addresses.length ? lastCrew.addresses : null);
      fields.replaceChildren();
      if (from) {
        from.forEach(function (a) {
          addRow(a);
        });
      } else {
        addRow(OSSEN_CREW);
      }
    }

    function collected() {
      const bits = [];
      rows().forEach(function (input) {
        bits.push(input.value);
      });
      return bits.join(" ");
    }

    function openEditor() {
      crewEditing = true;
      crewRoot.classList.add("is-edit");
      fillCrewFields();
      rebuildPathNav();
      showPaths();
      setModeButtons();
      const first = rows()[0];
      if (first) {
        first.focus();
        first.select();
      }
    }

    function closeEditor() {
      if (crewIds) {
        crewEditing = false;
        setModeButtons();
        return;
      }
      crewEditing = false;
      crewRoot.classList.remove("is-edit");
      rebuildPathNav();
      setModeButtons();
      if (lastCrew) restoreLastCrew();
    }

    function submitCrew() {
      const text = collected();
      crewEditing = false;
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      loadCrew(text, { id: player.getId() }).catch(function () {});
    }

    crewRoot.addEventListener("submit", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      submitCrew();
    });

    paintCrewFields = fillCrewFields;

    crewBtn.addEventListener("click", function () {
      if (crewBusy) return;
      if (mode === "apart") reassemble();
      else if (mode === "draw") leaveDraw();
      if (crewIds) {
        crewFolded = !crewFolded;
        if (crewFolded) salon.classList.remove("paths-on");
        else showPaths();
        syncCrewChrome();
        return;
      }
      if (crewEditing) {
        closeEditor();
        return;
      }
      if (lastCrew) {
        restoreLastCrew();
        return;
      }
      openEditor();
    });
  })();

  (function bindStrip() {
    const host = document.getElementById("path-strip");
    if (!host) return;
    let drag = null;
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)");

    function markPick() {
      host.querySelectorAll("[data-id]").forEach(function (el) {
        el.classList.toggle("is-pick", Number(el.getAttribute("data-id")) === stripPick);
      });
    }

    function movePickTo(id) {
      const order = [];
      host.querySelectorAll("[data-id]").forEach(function (el) {
        order.push(Number(el.getAttribute("data-id")));
      });
      const from = order.indexOf(stripPick);
      if (from < 0) return;
      order.splice(from, 1);
      const dest = order.indexOf(id);
      if (dest < 0) return;
      order.splice(dest, 0, stripPick);
      stripPick = null;
      markPick();
      applyArranged(order);
    }

    host.addEventListener("click", function (ev) {
      const drop = ev.target.closest(".strip-drop");
      if (drop) {
        if (!crewIds || crewBusy) return;
        ev.preventDefault();
        ev.stopPropagation();
        const cell = drop.closest("[data-id]");
        if (!cell) return;
        stripPick = null;
        removeCrewId(Number(cell.getAttribute("data-id")));
        return;
      }
      if (!coarse.matches || !crewIds || crewBusy) return;
      const cell = ev.target.closest("#path-strip [data-id]");
      if (!cell) return;
      ev.preventDefault();
      const id = Number(cell.getAttribute("data-id"));
      if (walkIsOn()) {
        player.pause();
        stripPick = null;
        markPick();
        abandonTrip();
        player.goto(id).then(function () {
          syncToggle();
          setModeButtons();
        }).catch(function () {});
        return;
      }
      if (stripPick == null) {
        stripPick = id;
        markPick();
        abandonTrip();
        player.goto(id).catch(function () {});
        return;
      }
      if (stripPick === id) {
        stripPick = null;
        markPick();
        abandonTrip();
        player.goto(id).catch(function () {});
        return;
      }
      movePickTo(id);
    });

    host.addEventListener("pointerdown", function (ev) {
      if (coarse.matches) return;
      if (ev.target.closest(".strip-drop")) return;
      const cell = ev.target.closest("#path-strip [data-id]");
      if (!cell || !crewIds) return;
      drag = {
        id: Number(cell.getAttribute("data-id")),
        x: ev.clientX,
        y: ev.clientY,
        moved: false,
        el: cell,
      };
      try {
        cell.setPointerCapture(ev.pointerId);
      } catch (_) {}
    });
    host.addEventListener("pointermove", function (ev) {
      if (!drag || coarse.matches) return;
      if (Math.abs(ev.clientX - drag.x) < 7 && Math.abs(ev.clientY - drag.y) < 7) return;
      drag.moved = true;
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const other = over && over.closest && over.closest("#path-strip [data-id]");
      if (!other || other === drag.el) return;
      const parent = drag.el.parentNode;
      if (!parent) return;
      const kids = Array.prototype.slice.call(parent.children);
      const i = kids.indexOf(drag.el);
      const j = kids.indexOf(other);
      if (i < 0 || j < 0 || i === j) return;
      if (i < j) parent.insertBefore(drag.el, other.nextSibling);
      else parent.insertBefore(drag.el, other);
    });
    function endDrag() {
      if (!drag) return;
      const moved = drag.moved;
      const id = drag.id;
      drag = null;
      if (coarse.matches) return;
      if (!moved) {
        abandonTrip();
        player.goto(id).catch(function () {});
        return;
      }
      const order = [];
      host.querySelectorAll("[data-id]").forEach(function (el) {
        order.push(Number(el.getAttribute("data-id")));
      });
      if (order.length) applyArranged(order);
    }
    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", function () {
      drag = null;
    });
  })();

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
    abandonTrip();
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
    if (filmPlaying || trip) return;
    if (twinCellAt(ev)) return;
    if (lastFrame && filmDoorOf(lastFrame.id)) {
      releaseIdBox();
      ev.preventDefault();
      startFilm(lastFrame.id);
    }
  }

  function onPlateClick(ev) {
    if (mode !== "watch") return;
    if (filmPlaying) {
      ev.preventDefault();
      if (filmCanStop()) abandonTrip();
      return;
    }
    if (trip) return;
    if (!lastFrame) return;
    if (isAgeTarget(lastFrame)) {
      if (requestAge()) ev.preventDefault();
      return;
    }
    if (player.isPlaying()) {
      if (twins[lastFrame.id] && twinOk[lastFrame.id] === 1) {
        ev.preventDefault();
        openTwin(twins[lastFrame.id]);
        return;
      }
      if (filmDoorOf(lastFrame.id)) {
        ev.preventDefault();
        startFilm(lastFrame.id);
      }
      return;
    }
    if (twinCellAt(ev)) {
      const twin = twinOf(lastFrame.id);
      if (twin) {
        ev.preventDefault();
        openTwin(twin);
        return;
      }
    }
    if (filmDoorOf(lastFrame.id)) {
      ev.preventDefault();
      startFilm(lastFrame.id);
      return;
    }
    if (canOpenAge(lastFrame)) {
      ev.preventDefault();
      openAge();
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
    const film = lastFrame && filmDoorOf(lastFrame.id);
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

  let chromeTimer = 0;
  const CHROME_MS = 4000;
  const controlsEl = salon.querySelector(".controls");
  const wordmarkEl = salon.querySelector(".wordmark");
  const playNavEl = salon.querySelector(".play-nav");

  function hideChrome() {
    if (document.activeElement === idInput) return;
    const mouseHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (mouseHover && controlsEl && controlsEl.matches(":hover")) {
      chromeTimer = window.setTimeout(hideChrome, CHROME_MS);
      return;
    }
    salon.classList.remove("chrome-on");
  }

  function showChrome() {
    salon.classList.add("chrome-on");
    window.clearTimeout(chromeTimer);
    chromeTimer = window.setTimeout(hideChrome, CHROME_MS);
  }

  function hidePaths() {
    if (crewChromeOpen()) return;
    if (document.activeElement && document.activeElement.classList.contains("crew-addr")) return;
    const mouseHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (mouseHover && playNavEl && playNavEl.matches(":hover")) {
      pathTimer = window.setTimeout(hidePaths, CHROME_MS);
      return;
    }
    salon.classList.remove("paths-on");
  }

  function showPaths() {
    if (mode !== "watch") return;
    if (inCrew() && !crewChromeOpen()) return;
    salon.classList.add("paths-on");
    window.clearTimeout(pathTimer);
    if (crewChromeOpen()) return;
    pathTimer = window.setTimeout(hidePaths, CHROME_MS);
  }

  document.addEventListener("pointerdown", function (ev) {
    const t = ev.target;
    if (t.closest(".wordmark")) return;
    if (t.closest(".paths")) {
      showPaths();
      return;
    }
    if (t.closest("button, a, input, label, .controls, .modes, .plate, #btn-sheet")) {
      if (salon.classList.contains("chrome-on") || t.closest(".modes, #btn-sheet, .controls")) showChrome();
      return;
    }
    showChrome();
  });
  document.addEventListener("pointermove", function (ev) {
    if (ev.pointerType === "touch") return;
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest(".controls")) {
      showChrome();
      return;
    }
    if (salon.classList.contains("chrome-on")) return;
    const wrap = document.getElementById("stage-wrap");
    if (wrap && wrap.contains(t)) showChrome();
  }, { passive: true });
  if (playNavEl) {
    playNavEl.addEventListener("pointerenter", function (ev) {
      if (ev.pointerType === "touch") return;
      showPaths();
    });
    playNavEl.addEventListener("pointerleave", function (ev) {
      if (ev.pointerType === "touch") return;
      showPaths();
    });
  }
  if (wordmarkEl) {
    wordmarkEl.addEventListener("click", function (ev) {
      ev.preventDefault();
      restartShow();
    });
  }

  (function bindPullReload() {
    const PULL_MIN = 48;
    let arm = null;

    function abovePlate(y) {
      const st = document.getElementById("stage");
      if (!st) return y < 140;
      return y < st.getBoundingClientRect().top;
    }

    function hitPlate(target) {
      return !!(target && target.closest && target.closest("#stage, .plates, #trait-stage"));
    }

    function hitControl(target) {
      return !!(target && target.closest && target.closest("button, a, input, label, .controls, .colophon, .crew, .path-strip"));
    }

    function begin(x, y, key, target) {
      if (window.scrollY > 2) return;
      if (hitPlate(target) || !abovePlate(y)) return;
      arm = { key: key, x: x, y: y, dy: 0, control: hitControl(target) };
      salon.style.transition = "none";
    }

    function move(x, y, ev) {
      if (!arm) return;
      const dy = y - arm.y;
      const dx = Math.abs(x - arm.x);
      if (Math.abs(dy) < 8 && dx < 8) return;
      if (dx > Math.abs(dy) && arm.dy < 10) {
        finish(false);
        return;
      }
      if (arm.control && dy < 24) return;
      arm.control = false;
      if (dy <= 0) {
        arm.dy = 0;
        salon.style.transform = "";
        return;
      }
      arm.dy = dy;
      salon.style.transform = "translateY(" + Math.min(64, dy * 0.45) + "px)";
      if (ev && ev.cancelable && dy > 8) ev.preventDefault();
    }

    function finish(reloadIfEnough) {
      if (!arm) return;
      const dy = arm.dy;
      arm = null;
      if (reloadIfEnough && dy >= PULL_MIN) {
        salon.style.transition = "transform 0.12s ease";
        salon.style.transform = "translateY(36px)";
        window.location.reload();
        return;
      }
      salon.style.transition = "transform 0.22s ease";
      salon.style.transform = "";
      window.setTimeout(function () {
        if (!arm) salon.style.transition = "";
      }, 240);
    }

    document.addEventListener("touchstart", function (ev) {
      if (ev.touches.length !== 1) return;
      const t = ev.touches[0];
      begin(t.clientX, t.clientY, "touch", ev.target);
    }, { passive: true });
    document.addEventListener("touchmove", function (ev) {
      if (!arm || arm.key !== "touch" || ev.touches.length !== 1) return;
      const t = ev.touches[0];
      move(t.clientX, t.clientY, ev);
    }, { passive: false });
    document.addEventListener("touchend", function () { finish(true); });
    document.addEventListener("touchcancel", function () { finish(false); });
  })();

  idInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      readIdBox();
      idInput.blur();
    }
  });
  idInput.addEventListener("focus", function () {
    window.clearTimeout(chromeTimer);
    salon.classList.add("chrome-on");
  });
  idInput.addEventListener("blur", function () {
    readIdBox();
    showChrome();
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.target === idInput || (ev.target && ev.target.classList && ev.target.classList.contains("crew-addr"))) return;
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
      if (trip || filmPlaying) {
        abandonTrip();
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
      if (mode === "apart" || mode === "draw") {
        leaveModeAndPlay();
        return;
      }
      toggleWalk();
      syncToggle();
      setModeButtons();
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      abandonTrip();
      player.next().catch(function () {});
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      abandonTrip();
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
    pathLists = paths.build(table.bytes);
    rebuildPathNav();
    (function applyBootPath() {
      const crewQ = parseCrewFromUrl();
      if (crewQ.length) {
        const q = new URLSearchParams(location.search);
        loadCrew(crewQ.join(","), {
          fromUrl: true,
          id: parseDeepId(),
          path: q.get("path") || "watch",
          order: parseOrderFromUrl(),
          omit: parseOmitFromUrl(),
          keepPlay: player.isPlaying(),
        }).catch(function () {});
        return;
      }
      const wanted = parsePathFromUrl();
      const from = player.getId();
      const name = (wanted === "fleet" || listForPath(wanted)) ? wanted : "fleet";
      adoptPath(name, { force: true });
      const list = listForPath(name);
      if (list && list.indexOf(from) < 0) {
        player.goto(player.after(from, 1), { keepPlay: player.isPlaying() }).catch(function () {});
      } else {
        syncUrl(from);
      }
    })();
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

  function applyLocation() {
    const crewQ = parseCrewFromUrl();
    if (crewQ.length) {
      const same = crewAddresses && crewQ.join(",") === crewAddresses.join(",");
      const q = new URLSearchParams(location.search);
      if (!same) {
        loadCrew(crewQ.join(","), {
          fromUrl: true,
          id: parseDeepId(),
          path: q.get("path") || "watch",
          order: parseOrderFromUrl(),
          omit: parseOmitFromUrl(),
        }).catch(function () {});
        return;
      }
    } else if (crewIds) {
      stashAndLeave();
    }
    const n = parseDeepId();
    const wanted = parsePathFromUrl();
    const name = crewIds
      ? ((wanted === "fleet" || listForPath(wanted)) ? wanted : "watch")
      : ((wanted === "fleet" || listForPath(wanted)) ? wanted : "fleet");
    adoptPath(name, { force: true });
    if (n !== player.getId()) player.goto(n).catch(function () {});
    else syncUrl(n);
  }
  window.addEventListener("hashchange", applyLocation);
  window.addEventListener("popstate", applyLocation);

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
