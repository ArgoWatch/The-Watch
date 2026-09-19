(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const MIN_ID = 1;
  const MAX_ID = 9999;
  const RATES = { 0.5: true, 1: true, 2: true };
  const STILL_MS_1X = 1400;

  function wrap(id) {
    const span = MAX_ID - MIN_ID + 1;
    let n = ((Number(id) - MIN_ID) % span + span) % span;
    return n + MIN_ID;
  }

  function createPlayback(opts) {
    const loadFrame = opts.loadFrame;
    const prefetch = opts.prefetch;
    const onFrame = opts.onFrame;
    const onStatus = opts.onStatus || function () {};
    const onLap = opts.onLap || function () {};
    const onPlayChange = opts.onPlayChange || function () {};

    let id = wrap(opts.id || MIN_ID);
    let rate = RATES[opts.rate] ? opts.rate : 0.5;
    let playing = false;
    let timer = 0;
    let seq = 0;
    let streak = 0;
    let holdExtra = 0;
    let pathIds = null;

    function setStatus(text) {
      onStatus(text || "");
    }

    function stepFrom(from, dir) {
      if (!pathIds || !pathIds.length) return wrap(Number(from) + (dir < 0 ? -1 : 1));
      const list = pathIds;
      const n = list.length;
      const x = Number(from);
      if (dir > 0) {
        let lo = 0;
        let hi = n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (list[mid] <= x) lo = mid + 1;
          else hi = mid;
        }
        return list[lo < n ? lo : 0];
      }
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      return list[lo > 0 ? lo - 1 : n - 1];
    }

    function schedulePrefetch() {
      const a = stepFrom(id, 1);
      const b = stepFrom(a, 1);
      prefetch([a, b]);
    }

    async function show(nextId, reason) {
      const my = ++seq;
      const prev = id;
      id = wrap(nextId);
      if (reason === "play" && rate === 0.5) streak += 1;
      else if (reason === "play" || reason === "next" || reason === "prev" || reason === "goto") streak = 0;
      if (reason === "play" && !pathIds && prev === MAX_ID && id === MIN_ID && streak >= 9998) onLap();
      schedulePrefetch();
      onFrame({ id, pending: true, reason });
      try {
        const frame = await loadFrame(id);
        if (my !== seq) return frame;
        holdExtra = opts.holdExtra ? Number(opts.holdExtra(frame)) || 0 : 0;
        onFrame(Object.assign({ pending: false, reason }, frame));
        setStatus("");
        return frame;
      } catch (err) {
        if (my !== seq) return null;
        holdExtra = 0;
        setStatus(err.message || "RPC failed");
        onFrame({ id, pending: false, error: err, reason });
        throw err;
      }
    }

    function stillMs() {
      return Math.round(STILL_MS_1X / rate);
    }

    function intervalMs() {
      return stillMs() + holdExtra;
    }

    function arm() {
      clearTimeout(timer);
      if (!playing) return;
      timer = setTimeout(tick, intervalMs());
    }

    async function tick() {
      if (!playing) return;
      try {
        await show(stepFrom(id, 1), "play");
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
      stillMs: function () {
        return stillMs();
      },
      setList: function (ids) {
        pathIds = ids && ids.length ? ids : null;
        streak = 0;
      },
      after: function (from, dir) {
        return stepFrom(from, dir);
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
        if (rate !== 0.5) streak = 0;
        if (playing) arm();
      },
      goto: function (n, opts) {
        const keep = opts && opts.keepPlay && playing;
        if (!keep) {
          this.pause();
        } else {
          clearTimeout(timer);
        }
        return show(wrap(n), "goto").then(function (frame) {
          if (keep && playing) arm();
          return frame;
        });
      },
      next: function () {
        this.pause();
        return show(stepFrom(id, 1), "next");
      },
      prev: function () {
        this.pause();
        return show(stepFrom(id, -1), "prev");
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
