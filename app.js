(function () {
  "use strict";
  const { chain, decode, playback, explode, draw, sheet } = window.TheScore;

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

  function pad4(n) {
    return String(n).padStart(4, "0");
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
    traitStage.hidden = true;
    traitPixel.replaceChildren();
    traitEmpty.hidden = true;
  }

  function showTraitWell(iso) {
    if (!iso || iso === "harbor" || iso === "none") {
      hideTraitWell();
      fitPrint();
      return;
    }
    traitStage.hidden = false;
    salon.classList.add("has-trait");
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

  function setCaption(id) {
    caption.textContent = "ARGONAUT #" + pad4(id);
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
    modeDraw.classList.toggle("is-on", mode === "draw");
    modeDraw.classList.toggle("is-playing", mode === "draw" && plotter.isPlaying());
    modeDraw.setAttribute("aria-pressed", mode === "draw" && plotter.isPlaying() ? "true" : "false");
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
  }

  function restoreSvg() {
    if (!lastFrame || lastFrame.unminted || !lastFrame.svg) return;
    try {
      pixel.replaceChildren(decode.sanitizeSvg(lastFrame.svg));
      unmintedEl.hidden = true;
      stage.classList.remove("is-empty");
    } catch (_) {}
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
  }

  function enterDraw() {
    player.pause();
    if (mode === "apart") {
      hideTraitWell();
      plates.hide();
      salon.classList.remove("take-apart");
    }
    mode = "draw";
    salon.classList.add("draw-mode");
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
    if (mode === "draw") {
      stopDraw();
      restoreSvg();
    }
    player.pause();
    syncToggle();
    mode = "apart";
    salon.classList.add("take-apart");
    setModeButtons();
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
    veil.hidden = !frame.pending;
    if (frame.pending) return;
    lastFrame = frame;
    setCaption(frame.id);
    if (mode === "draw") {
      plotter.load(frame.unminted ? "" : frame.svg || "");
      plotter.play();
      return;
    }
    if (mode === "apart") {
      refreshPlates();
      loadIsolation(frame.id, frame.svg);
    }

    if (frame.error) {
      return;
    }

    if (frame.unminted) {
      pixel.replaceChildren();
      unmintedEl.hidden = false;
      stage.classList.add("is-empty");
      return;
    }

    if (!frame.svg) return;

    try {
      const svg = decode.sanitizeSvg(frame.svg);
      pixel.replaceChildren(svg);
      unmintedEl.hidden = true;
      stage.classList.remove("is-empty");
    } catch (err) {
      status.textContent = err.message || "SVG failed";
    }
  }

  const player = playback.createPlayback({
    id: 1,
    rate: 0.5,
    loadFrame: chain.loadFrame,
    prefetch: chain.prefetch,
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
    onPlayChange: function () {
      syncToggle();
      setModeButtons();
    },
  });

  toggleBtn.addEventListener("click", function () {
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
    player.prev().catch(function () {});
  });
  nextBtn.addEventListener("click", function () {
    player.next().catch(function () {});
  });

  plates.setOnSelect(function (_i, iso) {
    if (mode !== "apart") return;
    showTraitWell(iso);
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
    player.goto(n).catch(function () {});
  }

  idInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      readIdBox();
    }
  });
  idInput.addEventListener("blur", readIdBox);

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
      player.next().catch(function () {});
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      player.prev().catch(function () {});
    }
  });

  if (window.matchMedia("(hover: none)").matches) {
    stage.addEventListener("click", function () {
      salon.classList.toggle("chrome-on");
    });
  }

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
    if (pair[1] && Array.isArray(pair[1].slots)) {
      table.slots = pair[1].slots.map(function (s) {
        return typeof s === "string" ? s : s.name;
      });
    }
  }).catch(function () {
    status.textContent = "trait snapshot missing — run node scripts/fetch-traits.mjs";
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
