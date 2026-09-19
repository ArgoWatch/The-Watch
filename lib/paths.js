(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const NAMES = ["fleet", "unclothed", "cloak", "relic", "sight", "artifact", "crown"];
  const WORN = [2, 3, 4, 5, 6];
  const SLOT_PATH = { 2: "cloak", 3: "relic", 4: "sight", 5: "artifact", 6: "crown" };

  function parse(name) {
    const s = String(name || "").toLowerCase();
    return NAMES.indexOf(s) >= 0 ? s : "fleet";
  }

  function build(bytes) {
    const lists = {
      fleet: null,
      unclothed: [],
      cloak: [],
      relic: [],
      sight: [],
      artifact: [],
      crown: [],
    };
    if (!bytes || bytes.length < 7) return lists;
    const last = Math.min(9999, Math.floor(bytes.length / 7));
    for (let id = 1; id <= last; id++) {
      const i = (id - 1) * 7;
      let worn = 0;
      let only = 0;
      for (let w = 0; w < WORN.length; w++) {
        const slot = WORN[w];
        if (bytes[i + slot]) {
          worn += 1;
          only = slot;
        }
      }
      if (worn === 0) lists.unclothed.push(id);
      else if (worn === 1) lists[SLOT_PATH[only]].push(id);
    }
    return lists;
  }

  TS.paths = { NAMES, parse, build };
})(window);
