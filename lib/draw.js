(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  function createDraw() {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    canvas.className = "draw-canvas";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.imageSmoothingEnabled = false;

    let rects = [];
    let i = 0;
    let timer = 0;
    let playing = false;
    let ms = 30;
    let onDone = null;
    let onPlayChange = null;

    function setPlaying(on) {
      playing = !!on;
      if (onPlayChange) onPlayChange(playing);
    }

    function clear() {
      ctx.clearRect(0, 0, 24, 24);
      i = 0;
    }

    function step() {
      if (!ctx || i >= rects.length) {
        setPlaying(false);
        clearTimeout(timer);
        if (onDone) onDone();
        return;
      }
      const r = rects[i++];
      if (!TS.decode.HEX.test(r.fill)) return;
      ctx.fillStyle = r.fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    function arm() {
      clearTimeout(timer);
      if (!playing) return;
      timer = setTimeout(tick, ms);
    }

    function tick() {
      if (!playing) return;
      step();
      if (playing) arm();
    }

    return {
      canvas: canvas,
      load: function (svgText) {
        rects = TS.decode.rectsFromSvg(svgText || "");
        clear();
      },
      play: function () {
        if (playing) return;
        if (i >= rects.length) clear();
        setPlaying(true);
        arm();
      },
      pause: function () {
        if (!playing) return;
        setPlaying(false);
        clearTimeout(timer);
      },
      toggle: function () {
        if (playing) this.pause();
        else this.play();
      },
      reset: function () {
        this.pause();
        clear();
      },
      isPlaying: function () {
        return playing;
      },
      setMs: function (n) {
        ms = Math.max(8, Number(n) || 30);
        if (playing) arm();
      },
      setOnDone: function (fn) {
        onDone = fn;
      },
      setOnPlayChange: function (fn) {
        onPlayChange = fn;
      },
      remaining: function () {
        return Math.max(0, rects.length - i);
      },
    };
  }

  TS.draw = { createDraw: createDraw };
})(window);
