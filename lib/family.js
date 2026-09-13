(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  // Dress first, cloak last. Crown and cloak never co-occur on one token;
  // the finale still puts the cloak on as if it could hide the crown.
  const BUILD = [4, 5, 3, 6];
  const SLOT_CLOAK = 2;

  function popcount(t) {
    let n = 0;
    for (let s = 2; s <= 6; s++) if (t[s]) n += 1;
    return n;
  }

  function optKey(t) {
    return t[2] + "," + t[3] + "," + t[4] + "," + t[5] + "," + t[6];
  }

  function stateKey(s) {
    return s[2] + "," + s[3] + "," + s[4] + "," + s[5] + "," + s[6];
  }

  function build(bytes) {
    const films = Object.create(null);
    if (!bytes || !bytes.length) return films;

    const supply = [{}, {}, {}, {}, {}, {}, {}];
    const fams = Object.create(null);
    const n = Math.min(9999, Math.floor(bytes.length / 7));

    for (let id = 1; id <= n; id++) {
      const i = (id - 1) * 7;
      const t = [
        bytes[i],
        bytes[i + 1],
        bytes[i + 2],
        bytes[i + 3],
        bytes[i + 4],
        bytes[i + 5],
        bytes[i + 6],
      ];
      for (let s = 0; s < 7; s++) supply[s][t[s]] = (supply[s][t[s]] || 0) + 1;
      const key = t[0] + "," + t[1];
      if (!fams[key]) fams[key] = [];
      fams[key].push({ id: id, t: t, pop: popcount(t) });
    }

    function commonness(t) {
      let n = 0;
      for (let s = 2; s <= 6; s++) if (t[s]) n += supply[s][t[s]] || 0;
      return n;
    }

    Object.keys(fams).forEach(function (key) {
      const members = fams[key];
      let stem = 0;
      const byKey = Object.create(null);
      const cloaked = [];
      const bodies = [];
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const k = optKey(m.t);
        if (!byKey[k]) byKey[k] = m;
        if (m.pop === 0) stem = m.id;
        if (m.t[SLOT_CLOAK]) cloaked.push(m);
        else if (m.pop > 0) bodies.push(m);
      }
      if (!stem || members.length < 2) return;

      function prefixes(t, slots) {
        const s = [0, 0, 0, 0, 0, 0, 0];
        let n = 1;
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (!t[slot]) continue;
          s[slot] = t[slot];
          if (byKey[stateKey(s)]) n += 1;
        }
        return n;
      }

      let body = null;
      if (bodies.length) {
        body = bodies[0];
        let best = null;
        for (let i = 0; i < bodies.length; i++) {
          const m = bodies[i];
          const score = [
            m.t[6] ? 1 : 0,
            prefixes(m.t, BUILD),
            m.pop,
            commonness(m.t),
            -m.id,
          ];
          if (!best) {
            body = m;
            best = score;
            continue;
          }
          let better = false;
          for (let k = 0; k < score.length; k++) {
            if (score[k] !== best[k]) {
              better = score[k] > best[k];
              break;
            }
          }
          if (better) {
            body = m;
            best = score;
          }
        }
      }

      const ids = [stem];
      const used = Object.create(null);
      used[stem] = true;
      const s = [0, 0, 0, 0, 0, 0, 0];
      if (body) {
        for (let i = 0; i < BUILD.length; i++) {
          const slot = BUILD[i];
          if (!body.t[slot]) continue;
          s[slot] = body.t[slot];
          const hit = byKey[stateKey(s)];
          if (hit && !used[hit.id]) {
            ids.push(hit.id);
            used[hit.id] = true;
          }
        }
        if (!used[body.id]) {
          ids.push(body.id);
          used[body.id] = true;
        }
      }

      if (cloaked.length) {
        const b = body ? body.t : [0, 0, 0, 0, 0, 0, 0];
        let finale = cloaked[0];
        let best = null;
        for (let i = 0; i < cloaked.length; i++) {
          const m = cloaked[i];
          const t = m.t;
          let match = 0;
          let mismatch = 0;
          let extra = 0;
          const slots = [4, 5, 3];
          for (let j = 0; j < slots.length; j++) {
            const slot = slots[j];
            if (b[slot] && t[slot] === b[slot]) match += 1;
            else if (b[slot] && t[slot] && t[slot] !== b[slot]) mismatch += 1;
            else if (t[slot] && !b[slot]) extra += 1;
          }
          const score = [-mismatch, match, -extra, commonness(t), -m.id];
          if (!best) {
            finale = m;
            best = score;
            continue;
          }
          let better = false;
          for (let k = 0; k < score.length; k++) {
            if (score[k] !== best[k]) {
              better = score[k] > best[k];
              break;
            }
          }
          if (better) {
            finale = m;
            best = score;
          }
        }
        if (finale && !used[finale.id]) ids.push(finale.id);
      }

      if (ids.length < 2) return;
      films[stem] = { ids: ids, n: members.length, capped: ids.length < members.length };
    });

    return films;
  }

  TS.family = {
    BUILD: BUILD,
    build: build,
  };
})(window);
