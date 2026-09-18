(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});
  const DURATION = 1000;
  const EASING = "ease-in-out";
  const HARBOR = "https://argonauts.musefacktory.com/argonaut/";
  const NONE_SLOTS = { 2: true, 3: true, 4: true, 5: true, 6: true };

  function makePlate() {
    const li = document.createElement("li");
    li.className = "plate";
    const slot = document.createElement("p");
    slot.className = "plate-slot";
    const value = document.createElement("p");
    value.className = "plate-value";
    li.appendChild(slot);
    li.appendChild(value);
    return li;
  }

  function emptyGrid() {
    const g = [];
    for (let y = 0; y < 24; y++) g.push(new Array(24).fill(null));
    return g;
  }

  function isPrintStamp(r) {
    return TS.decode.isPrintStamp(r);
  }

  function skipInk(r) {
    return isPrintStamp(r) || (TS.decode.isFaintInk && TS.decode.isFaintInk(r));
  }

  function visitCells(r, fn) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(24, Math.floor(r.x + r.w));
    const y1 = Math.min(24, Math.floor(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) fn(x, y);
    }
  }

  function gridFromSvg(svgText) {
    const g = emptyGrid();
    TS.decode.rectsFromSvg(svgText || "").forEach(function (r) {
      if (skipInk(r)) return;
      const fill = String(r.fill).toLowerCase();
      visitCells(r, function (x, y) {
        g[y][x] = fill;
      });
    });
    return g;
  }

  function hexByte(n) {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return (v < 16 ? "0" : "") + v.toString(16);
  }

  // Print pixels as seen: document order with fill-opacity. Occupancy still uses gridFromSvg.
  function compositeGrid(svgText) {
    const rgb = emptyGrid();
    TS.decode.rectsFromSvg(svgText || "").forEach(function (r) {
      if (skipInk(r)) return;
      const c = TS.decode.hexRgb(r.fill);
      if (!c) return;
      const o = r.opacity == null ? 1 : r.opacity;
      visitCells(r, function (x, y) {
        const d = rgb[y][x] || (rgb[y][x] = [0, 0, 0]);
        d[0] = c[0] * o + d[0] * (1 - o);
        d[1] = c[1] * o + d[1] * (1 - o);
        d[2] = c[2] * o + d[2] * (1 - o);
      });
    });
    const g = emptyGrid();
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const d = rgb[y][x];
        if (d) g[y][x] = "#" + hexByte(d[0]) + hexByte(d[1]) + hexByte(d[2]);
      }
    }
    return g;
  }

  const diffMemo = new Map();

  function traitDiffCells(ta, tb) {
    if (!ta || !tb || ta.length !== 7 || tb.length !== 7 || !TS.chain.renderTraits) {
      return Promise.resolve([]);
    }
    const key = Array.from(ta).join(",") + "|" + Array.from(tb).join(",");
    if (diffMemo.has(key)) return diffMemo.get(key);
    const job = Promise.all([
      TS.chain.renderTraits(Array.from(ta)),
      TS.chain.renderTraits(Array.from(tb)),
    ]).then(function (pair) {
      const a = gridFromSvg(pair[0]);
      const b = gridFromSvg(pair[1]);
      const cells = [];
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          if (a[y][x] !== b[y][x]) cells.push({ x: x, y: y });
        }
      }
      return cells;
    }).catch(function (err) {
      diffMemo.delete(key);
      throw err;
    });
    diffMemo.set(key, job);
    return job;
  }

  function hexNear(a, b, tol) {
    if (a === b) return true;
    if (!a || !b) return false;
    const pa = TS.decode.hexRgb(a);
    const pb = TS.decode.hexRgb(b);
    if (!pa || !pb) return false;
    return (
      Math.abs(pa[0] - pb[0]) <= tol &&
      Math.abs(pa[1] - pb[1]) <= tol &&
      Math.abs(pa[2] - pb[2]) <= tol
    );
  }

  function printDiffCells(svgA, svgB) {
    const a = compositeGrid(svgA || "");
    const b = compositeGrid(svgB || "");
    const cells = [];
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        if (!hexNear(a[y][x], b[y][x], 8)) cells.push({ x: x, y: y });
      }
    }
    return cells;
  }

  function gridToSvg(grid) {
    const parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" shape-rendering="crispEdges">',
    ];
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const fill = grid[y][x];
        if (fill && TS.decode.HEX.test(fill)) {
          parts.push(
            '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill + '"/>'
          );
        }
      }
    }
    parts.push("</svg>");
    return parts.join("");
  }

  function diffGrid(a, b) {
    const g = emptyGrid();
    let n = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        if (a[y][x] !== b[y][x]) {
          g[y][x] = a[y][x];
          if (a[y][x]) n += 1;
        }
      }
    }
    return n ? g : null;
  }

  function knockOutGrid(g, bg) {
    const bgc = (bg || "").toLowerCase();
    const out = emptyGrid();
    let n = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        if (g[y][x] && g[y][x] !== bgc) {
          out[y][x] = g[y][x];
          n += 1;
        }
      }
    }
    return n ? out : null;
  }

  function stampSvg(svgText) {
    const stamps = TS.decode.rectsFromSvg(svgText || "").filter(isPrintStamp);
    if (!stamps.length) return "none";
    const parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" shape-rendering="crispEdges">',
    ];
    stamps.forEach(function (r) {
      const fill = String(r.fill).toLowerCase();
      const o = r.opacity == null ? 1 : r.opacity;
      parts.push(
        '<rect x="' +
          r.x +
          '" y="' +
          r.y +
          '" width="1" height="1" fill="' +
          fill +
          '" fill-opacity="' +
          o +
          '"/>'
      );
    });
    parts.push("</svg>");
    return parts.join("");
  }

  function paletteSvg(svgText) {
    const m = /fill="(#[0-9A-Fa-f]{3,6})"/.exec(svgText || "");
    const fill = m && TS.decode.HEX.test(m[1]) ? m[1] : "#111111";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" shape-rendering="crispEdges">' +
      '<rect x="0" y="0" width="24" height="24" fill="' +
      fill +
      '"/></svg>'
    );
  }

  function bind(host) {
    let highlight = -1;
    let isolations = [];
    let lastRows = [];
    let onSelect = null;
    let chipSeq = 0;

    function comboKey(t) {
      return Array.from(t).join(",");
    }

    function isolationCombos(traits) {
      const out = [];
      const seen = Object.create(null);
      function add(t) {
        const k = comboKey(t);
        if (seen[k]) return;
        seen[k] = true;
        out.push(Array.from(t));
      }
      add([traits[0], traits[1], 0, 0, 0, 0, 0]);
      for (let s = 1; s <= 6; s++) {
        if (s >= 2 && NONE_SLOTS[s] && !traits[s]) continue;
        const worn = [traits[0], traits[1], 0, 0, 0, 0, 0];
        worn[s] = traits[s];
        add(worn);
        const noSlot = Array.from(traits);
        noSlot[s] = 0;
        add(noSlot);
      }
      return out;
    }

    function warm(traits) {
      if (!traits || !TS.chain.renderTraits) return;
      isolationCombos(traits).forEach(function (t) {
        TS.chain.renderTraits(t).catch(function () {});
      });
    }

    function rowsFrom(frame, table) {
      const slots = table.slots;
      const attrs = frame.attributes || [];
      const byType = {};
      attrs.forEach(function (a) {
        if (a && a.trait_type) byType[String(a.trait_type).toLowerCase()] = String(a.value || "");
      });
      const used = {};
      const traits = table.row && table.row(frame.id);
      const rows = slots.map(function (name, i) {
        const key = name.toLowerCase();
        used[key] = true;
        let label = Object.prototype.hasOwnProperty.call(byType, key) ? byType[key] : null;
        if (label == null && traits && table.valueName) label = table.valueName(i, traits[i]);
        if (label == null) {
          if (traits && traits[i]) label = "Unknown";
          else label = "None";
        }
        return { slot: name, value: label, index: i, inert: label === "None" };
      });
      const stamp = stampSvg(frame.svg);
      used.stamp = true;
      if (stamp === "none") {
        rows.push({ slot: "Stamp", value: "None", inert: true });
      } else {
        rows.push({ slot: "Stamp", value: "print overlay", iso: stamp });
      }
      attrs.forEach(function (a) {
        if (!a || !a.trait_type) return;
        const key = String(a.trait_type).toLowerCase();
        if (used[key]) return;
        const row = { slot: String(a.trait_type), value: String(a.value || "None") };
        if (key === "print" && frame.id) row.href = HARBOR + String(frame.id);
        else row.inert = true;
        rows.push(row);
      });
      if (frame.unminted && frame.id && !used.print) {
        rows.push({
          slot: "Print",
          value: "Harbor",
          href: HARBOR + String(frame.id),
        });
      }
      return rows;
    }

    function paint(rows) {
      lastRows = rows;
      while (host.children.length < rows.length) host.appendChild(makePlate());
      while (host.children.length > rows.length) host.removeChild(host.lastChild);
      for (let i = 0; i < rows.length; i++) {
        const li = host.children[i];
        li.classList.toggle("is-inert", !!rows[i].inert);
        li.classList.toggle("is-lit", !rows[i].inert && i === highlight);
        li.querySelector(".plate-slot").textContent = rows[i].slot;
        const oldVal = li.querySelector(".plate-value");
        if (rows[i].href) {
          const a = document.createElement("a");
          a.className = "plate-value plate-harbor";
          a.href = rows[i].href;
          a.rel = "noopener noreferrer";
          a.target = "_blank";
          a.textContent = rows[i].value;
          if (oldVal) li.replaceChild(a, oldVal);
          else li.appendChild(a);
          li.classList.add("is-harbor");
        } else {
          let p = oldVal;
          if (!p || p.tagName === "A") {
            p = document.createElement("p");
            p.className = "plate-value";
            if (oldVal) li.replaceChild(p, oldVal);
            else li.appendChild(p);
          }
          p.textContent = rows[i].value;
          li.classList.remove("is-harbor");
        }
      }
    }

    function fly(fromEl, reverse) {
      const origin = fromEl.getBoundingClientRect();
      const ox = origin.left + origin.width / 2;
      const oy = origin.top + origin.height / 2;
      host.querySelectorAll(".plate").forEach(function (plate) {
        const r = plate.getBoundingClientRect();
        const dx = ox - (r.left + r.width / 2);
        const dy = oy - (r.top + r.height / 2);
        const start = reverse
          ? { transform: "translate(0px, 0px)", opacity: 1 }
          : { transform: "translate(" + dx + "px, " + dy + "px)", opacity: 0.25 };
        const end = reverse
          ? { transform: "translate(" + dx + "px, " + dy + "px)", opacity: 0 }
          : { transform: "translate(0px, 0px)", opacity: 1 };
        plate.animate([start, end], { duration: DURATION, easing: EASING, fill: "forwards" });
      });
    }

    function emit() {
      const row = lastRows[highlight] || null;
      const iso = (row && row.iso) || isolations[highlight] || null;
      if (onSelect) onSelect(highlight, iso, row);
    }

    function isolateSlotFrom(slot, tokenG, bareG, wornSvg, noSlotSvg, bg) {
      const wornG = gridFromSvg(wornSvg);
      const noSlotG = gridFromSvg(noSlotSvg);
      const wornBgMatch = /fill="(#[0-9A-Fa-f]{3,6})"/.exec(wornSvg || "");
      const wornBg = wornBgMatch && TS.decode.HEX.test(wornBgMatch[1])
        ? wornBgMatch[1].toLowerCase()
        : String(bg || "").toLowerCase();
      const out = emptyGrid();
      let n = 0;
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          const belongs = slot === 1
            ? !!(wornG[y][x] && wornG[y][x] !== wornBg)
            : !!(bareG && wornG[y][x] !== bareG[y][x]);
          if (!belongs) continue;
          const official = tokenG[y][x];
          const behind = noSlotG[y][x];
          out[y][x] = official && official !== behind ? official : wornG[y][x];
          if (out[y][x]) n += 1;
        }
      }
      return n ? gridToSvg(out) : "none";
    }

    async function loadChips(traits, fullSvg) {
      const my = ++chipSeq;
      if (!traits || !TS.chain.renderTraits) return;
      const bgMatch = fullSvg && /fill="(#[0-9A-Fa-f]{3,6})"/.exec(fullSvg);
      const bg = bgMatch && TS.decode.HEX.test(bgMatch[1]) ? bgMatch[1] : "";
      isolations = [];
      isolations[0] = paletteSvg(fullSvg);
      const tokenG = compositeGrid(fullSvg);
      const combos = isolationCombos(traits);
      const svgs = await Promise.all(combos.map(function (t) {
        return TS.chain.renderTraits(t).catch(function () { return ""; });
      }));
      if (my !== chipSeq) return;
      const byKey = Object.create(null);
      combos.forEach(function (t, i) {
        byKey[comboKey(t)] = svgs[i] || "";
      });
      const bare = [traits[0], traits[1], 0, 0, 0, 0, 0];
      const bareG = gridFromSvg(byKey[comboKey(bare)] || "");
      for (let s = 1; s <= 6; s++) {
        if (s >= 2 && NONE_SLOTS[s] && !traits[s]) {
          isolations[s] = "none";
          continue;
        }
        const worn = [traits[0], traits[1], 0, 0, 0, 0, 0];
        worn[s] = traits[s];
        const noSlot = Array.from(traits);
        noSlot[s] = 0;
        try {
          isolations[s] = isolateSlotFrom(
            s,
            tokenG,
            bareG,
            byKey[comboKey(worn)] || "",
            byKey[comboKey(noSlot)] || "",
            bg
          );
        } catch (_) {
          isolations[s] = s === 1 ? null : "none";
        }
      }
      if (my !== chipSeq) return;
      emit();
    }

    return {
      duration: DURATION,
      paint: paint,
      rowsFrom: rowsFrom,
      loadChips: loadChips,
      warm: warm,
      setOnSelect: function (fn) {
        onSelect = fn;
      },
      flyIn: function (fromEl) {
        host.hidden = false;
        void host.offsetWidth;
        fly(fromEl, false);
      },
      flyOut: function (fromEl) {
        fly(fromEl, true);
      },
      hide: function () {
        host.hidden = true;
        highlight = -1;
        isolations = [];
      },
      getHighlight: function () {
        return highlight;
      },
      setHighlight: function (i) {
        const n = host.children.length;
        if (!n) return;
        if (host.children[i] && host.children[i].classList.contains("is-inert")) return;
        highlight = ((i % n) + n) % n;
        for (let k = 0; k < n; k++) host.children[k].classList.toggle("is-lit", k === highlight);
        emit();
      },
      moveHighlight: function (delta) {
        const n = host.children.length;
        if (!n) return;
        let i = highlight < 0 ? (delta > 0 ? -1 : 0) : highlight;
        for (let k = 0; k < n; k++) {
          i = (i + delta + n) % n;
          if (!host.children[i].classList.contains("is-inert")) {
            this.setHighlight(i);
            return;
          }
        }
      },
    };
  }

  TS.explode = {
    bind: bind,
    HARBOR: HARBOR,
    traitDiffCells: traitDiffCells,
    printDiffCells: printDiffCells,
  };
})(window);
