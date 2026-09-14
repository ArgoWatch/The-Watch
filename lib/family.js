(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const INNER = [4, 5, 3];
  const SLOT_CLOAK = 2;
  const SLOT_CROWN = 6;

  function popcount(t) {
    let n = 0;
    for (let s = 2; s <= 6; s++) if (t[s]) n += 1;
    return n;
  }

  function optKey(t) {
    return t[2] + "," + t[3] + "," + t[4] + "," + t[5] + "," + t[6];
  }

  function innerOf(t) {
    return [t[4], t[5], t[3]];
  }

  function better(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
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

    function pickInner(members) {
      const groups = Object.create(null);
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (m.pop === 0) continue;
        const k = innerOf(m.t).join(",");
        if (!groups[k]) groups[k] = { inner: innerOf(m.t), crowned: 0, cloaked: 0, n: 0 };
        groups[k].n += 1;
        if (m.t[SLOT_CLOAK]) groups[k].cloaked += 1;
        else if (m.t[SLOT_CROWN]) groups[k].crowned += 1;
      }
      let best = null;
      let bestScore = null;
      Object.keys(groups).forEach(function (k) {
        const g = groups[k];
        const filled = (g.inner[0] ? 1 : 0) + (g.inner[1] ? 1 : 0) + (g.inner[2] ? 1 : 0);
        const score = [
          g.crowned && g.cloaked ? 1 : 0,
          g.cloaked ? 1 : 0,
          g.crowned ? 1 : 0,
          filled,
          g.n,
        ];
        if (!bestScore || better(score, bestScore)) {
          best = g.inner;
          bestScore = score;
        }
      });
      return best || [0, 0, 0];
    }

    function bestMate(list, inn) {
      let pick = list[0];
      let bestScore = null;
      for (let i = 0; i < list.length; i++) {
        const t = list[i].t;
        const got = innerOf(t);
        let match = 0;
        let miss = 0;
        let extra = 0;
        for (let j = 0; j < 3; j++) {
          if (inn[j] && got[j] === inn[j]) match += 1;
          else if (inn[j] && got[j] && got[j] !== inn[j]) miss += 1;
          else if (got[j] && !inn[j]) extra += 1;
        }
        const score = [-miss, match, -extra, list[i].pop, commonness(t), -list[i].id];
        if (!bestScore || better(score, bestScore)) {
          pick = list[i];
          bestScore = score;
        }
      }
      return pick;
    }

    function spine(byKey, used, pal, bones, goal, slots) {
      const out = [];
      const s = [pal, bones, 0, 0, 0, 0, 0];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!goal[slot]) continue;
        s[slot] = goal[slot];
        const hit = byKey[optKey(s)];
        if (hit && !used[hit.id]) {
          out.push(hit);
          used[hit.id] = true;
        }
      }
      return out;
    }

    Object.keys(fams).forEach(function (key) {
      const members = fams[key];
      let stem = null;
      const byKey = Object.create(null);
      const crowned = [];
      const cloaked = [];
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const k = optKey(m.t);
        if (!byKey[k]) byKey[k] = m;
        if (m.pop === 0) stem = m;
        if (m.t[SLOT_CLOAK] && !m.t[SLOT_CROWN]) cloaked.push(m);
        else if (m.t[SLOT_CROWN] && !m.t[SLOT_CLOAK]) crowned.push(m);
      }
      if (!stem || members.length < 2) return;

      const inn = pickInner(members);
      const pal = stem.t[0];
      const bones = stem.t[1];
      const used = Object.create(null);
      used[stem.id] = true;
      const ids = [stem.id];

      const innerGoal = [pal, bones, 0, inn[2], inn[0], inn[1], 0];
      spine(byKey, used, pal, bones, innerGoal, INNER).forEach(function (m) {
        ids.push(m.id);
      });

      if (crowned.length) {
        const cg = bestMate(crowned, inn);
        spine(byKey, used, pal, bones, cg.t, INNER.concat([SLOT_CROWN])).forEach(function (m) {
          ids.push(m.id);
        });
        if (!used[cg.id]) {
          ids.push(cg.id);
          used[cg.id] = true;
        }
      }

      if (cloaked.length) {
        const kg = bestMate(cloaked, inn);
        spine(byKey, used, pal, bones, kg.t, INNER.concat([SLOT_CLOAK])).forEach(function (m) {
          ids.push(m.id);
        });
        if (!used[kg.id]) {
          ids.push(kg.id);
          used[kg.id] = true;
        }
      }

      if (ids.length < 2) return;
      const apex = ids[ids.length - 1];
      if (apex === stem.id) return;
      const reverse = ids.slice().reverse();
      const rec = { ids: ids, reverse: reverse, n: members.length, stem: stem.id, apex: apex };
      films[stem.id] = rec;
      films[apex] = rec;
    });

    return films;
  }

  TS.family = {
    INNER: INNER,
    build: build,
  };
})(window);
