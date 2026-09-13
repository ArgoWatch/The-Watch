(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  // Cheapest visual add first: eyes, object, gold, cloth, crown.
  const ADD = [4, 5, 3, 2, 6];
  const TWIN_SIGHT = { 7: 9, 9: 7, 1: 3, 3: 1, 10: 11, 11: 10 };
  const PLAY_ALL_MAX = 36;

  function popcount(mask) {
    let n = 0;
    for (let m = mask; m; m &= m - 1) n += 1;
    return n;
  }

  function sightGroup(v) {
    const p = TWIN_SIGHT[v];
    return p ? Math.min(v, p) : v;
  }

  function maskBits(mask) {
    const bits = [];
    for (let i = 0; i < 5; i++) if (mask & (1 << i)) bits.push(i);
    return bits;
  }

  function maskLexCmp(a, b) {
    const aa = maskBits(a);
    const bb = maskBits(b);
    const n = Math.min(aa.length, bb.length);
    for (let i = 0; i < n; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return aa.length - bb.length;
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
      for (let s = 0; s < 7; s++) {
        supply[s][t[s]] = (supply[s][t[s]] || 0) + 1;
      }
      let mask = 0;
      for (let b = 0; b < 5; b++) if (t[ADD[b]]) mask |= 1 << b;
      const key = t[0] + "," + t[1];
      if (!fams[key]) fams[key] = [];
      fams[key].push({ id: id, t: t, mask: mask, pop: popcount(mask) });
    }

    function valueCmp(a, b) {
      const bits = maskBits(a.mask);
      const newest = bits.length ? bits[bits.length - 1] : -1;
      const slots = [];
      if (newest >= 0) slots.push(ADD[newest]);
      for (let i = 0; i < bits.length; i++) {
        if (bits[i] !== newest) slots.push(ADD[bits[i]]);
      }
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const av = a.t[slot];
        const bv = b.t[slot];
        if (av === bv) continue;
        if (slot === 4) {
          const ag = sightGroup(av);
          const bg = sightGroup(bv);
          if (ag !== bg) {
            const as = (supply[4][ag] || 0) + (TWIN_SIGHT[ag] ? supply[4][TWIN_SIGHT[ag]] || 0 : 0);
            const bs = (supply[4][bg] || 0) + (TWIN_SIGHT[bg] ? supply[4][TWIN_SIGHT[bg]] || 0 : 0);
            if (as !== bs) return bs - as;
            return ag - bg;
          }
          const as = supply[4][av] || 0;
          const bs = supply[4][bv] || 0;
          if (as !== bs) return bs - as;
          return av - bv;
        }
        const as = supply[slot][av] || 0;
        const bs = supply[slot][bv] || 0;
        if (as !== bs) return bs - as;
        return av - bv;
      }
      return a.id - b.id;
    }

    Object.keys(fams).forEach(function (key) {
      const members = fams[key];
      let stem = 0;
      for (let i = 0; i < members.length; i++) {
        if (members[i].pop === 0) {
          stem = members[i].id;
          break;
        }
      }
      if (!stem || members.length < 2) return;

      members.sort(function (a, b) {
        if (a.pop !== b.pop) return a.pop - b.pop;
        if (a.mask !== b.mask) return maskLexCmp(a.mask, b.mask);
        return valueCmp(a, b);
      });

      const all = members.map(function (m) {
        return m.id;
      });
      let ids = all;
      let capped = false;
      if (all.length > PLAY_ALL_MAX) {
        capped = true;
        const used = Object.create(null);
        ids = [stem];
        used[stem] = true;
        for (let b = 0; b < 5; b++) {
          const want = 1 << b;
          for (let i = 0; i < members.length; i++) {
            const m = members[i];
            if (m.pop === 1 && m.mask === want && !used[m.id]) {
              ids.push(m.id);
              used[m.id] = true;
              break;
            }
          }
        }
        const coda = members[members.length - 1];
        if (coda && !used[coda.id]) ids.push(coda.id);
      }

      films[stem] = { ids: ids, n: all.length, capped: capped };
    });

    return films;
  }

  TS.family = {
    ADD: ADD,
    PLAY_ALL_MAX: PLAY_ALL_MAX,
    build: build,
  };
})(window);
