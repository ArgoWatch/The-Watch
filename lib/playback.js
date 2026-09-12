(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const MIN_ID = 1;
  const MAX_ID = 9999;
  const RATES = { 0.5: true, 1: true, 2: true };
  const BASE_FPS = 1;

  function wrap(id) {
    const span = MAX_ID - MIN_ID + 1;
    let n = ((Number(id) - MIN_ID) % span + span) % span;
    return n + MIN_ID;
  }

  function neighbors(id) {
    return [wrap(id - 1), wrap(id), wrap(id + 1), wrap(id + 2)];
  }

  function createPlayback(opts) {
    const loadFrame = opts.loadFrame;
    const prefetch = opts.prefetch;
    const onFrame = opts.onFrame;
    const onStatus = opts.onStatus || function () {};
    const onLap = opts.onLap || function () {};
    const onPlayChange = opts.onPlayChange || function () {};

    let id = wrap(opts.id || MIN_ID);
    let rate = RATES[opts.rate] ? opts.rate : 1;
    let playing = false;
    let timer = 0;
    let seq = 0;
    let streak = 0;

    function setStatus(text) {
      onStatus(text || "");
    }

    function schedulePrefetch() {
      prefetch(neighbors(id));
    }

    async function show(nextId, reason) {
      const my = ++seq;
      const prev = id;
      id = wrap(nextId);
      if (reason === "play") streak += 1;
      else if (reason === "next" || reason === "prev" || reason === "goto") streak = 0;
      if (reason === "play" && prev === MAX_ID && id === MIN_ID && streak >= 9998) onLap();
      schedulePrefetch();
      onFrame({ id, pending: true, reason });
      try {
        const frame = await loadFrame(id);
        if (my !== seq) return frame;
        onFrame(Object.assign({ pending: false, reason }, frame));
        setStatus("");
        return frame;
      } catch (err) {
        if (my !== seq) return null;
        setStatus(err.message || "RPC failed");
        onFrame({ id, pending: false, error: err, reason });
        throw err;
      }
    }

    function intervalMs() {
      return Math.round(1000 / (BASE_FPS * rate));
    }

    function arm() {
      clearTimeout(timer);
      if (!playing) return;
      timer = setTimeout(tick, intervalMs());
    }

    async function tick() {
      if (!playing) return;
      try {
        await show(id + 1, "play");
      } catch (_) {
        /* status already set; keep playing */
      } finally {
        arm();
      }
    }

    return {
      MIN_ID,
      MAX_ID,
      wrap,
      getId: function () {
        return id;
      },
      isPlaying: function () {
        return playing;
      },
      getRate: function () {
        return rate;
      },
      play: function () {
        if (playing) return;
        playing = true;
        setStatus("");
        schedulePrefetch();
        arm();
        onPlayChange(true);
      },
      pause: function () {
        const was = playing;
        playing = false;
        clearTimeout(timer);
        if (was) onPlayChange(false);
      },
      toggle: function () {
        if (playing) this.pause();
        else this.play();
      },
      setRate: function (n) {
        const next = Number(n);
        if (!RATES[next]) return;
        rate = next;
        if (playing) arm();
      },
      goto: function (n) {
        this.pause();
        return show(wrap(n), "goto");
      },
      next: function () {
        this.pause();
        return show(id + 1, "next");
      },
      prev: function () {
        this.pause();
        return show(id - 1, "prev");
      },
      start: function () {
        return show(id, "start");
      },
    };
  }

  TS.playback = {
    MIN_ID,
    MAX_ID,
    wrap,
    createPlayback,
  };
})(window);
