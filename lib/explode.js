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

  function gridFromSvg(svgText) {
    const g = emptyGrid();
    const rects = TS.decode.rectsFromSvg(svgText || "");
    rects.forEach(function (r) {
      const fill = String(r.fill).toLowerCase();
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(24, Math.floor(r.x + r.w));
      const y1 = Math.min(24, Math.floor(r.y + r.h));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) g[y][x] = fill;
      }
    });
    return g;
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

    function rowsFrom(frame, table) {
      const slots = table.slots;
      const attrs = frame.attributes || [];
      const byType = {};
      attrs.forEach(function (a) {
        if (a && a.trait_type) byType[String(a.trait_type).toLowerCase()] = String(a.value || "");
      });
      const used = {};
      const rows = slots.map(function (name, i) {
        const key = name.toLowerCase();
        used[key] = true;
        const label = Object.prototype.hasOwnProperty.call(byType, key) ? byType[key] : "None";
        return { slot: name, value: label, index: i, inert: label === "None" };
      });
      attrs.forEach(function (a) {
        if (!a || !a.trait_type) return;
        const key = String(a.trait_type).toLowerCase();
        if (used[key]) return;
        const row = { slot: String(a.trait_type), value: String(a.value || "None") };
        if (key === "print" && frame.id) row.href = HARBOR + String(frame.id);
        else row.inert = true;
        rows.push(row);
      });
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
      if (onSelect) onSelect(highlight, isolations[highlight] || null, lastRows[highlight] || null);
    }

    async function isolateSlot(traits, slot, tokenG, bareG, bg) {
      const worn = [traits[0], traits[1], 0, 0, 0, 0, 0];
      worn[slot] = traits[slot];
      const noSlot = Array.from(traits);
      noSlot[slot] = 0;
      const pair = await Promise.all([
        TS.chain.renderTraits(worn),
        TS.chain.renderTraits(noSlot),
      ]);
      const wornG = gridFromSvg(pair[0]);
      const noSlotG = gridFromSvg(pair[1]);
      const out = emptyGrid();
      let n = 0;
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          const belongs = slot === 1
            ? !!(wornG[y][x] && wornG[y][x] !== bg)
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
      isolations = [];
      if (!traits || !TS.chain.renderTraits) return;
      const bgMatch = fullSvg && /fill="(#[0-9A-Fa-f]{3,6})"/.exec(fullSvg);
      const bg = bgMatch && TS.decode.HEX.test(bgMatch[1]) ? bgMatch[1] : "";
      isolations[0] = paletteSvg(fullSvg);
      const tokenG = gridFromSvg(fullSvg);
      const bare = [traits[0], traits[1], 0, 0, 0, 0, 0];
      let bareG = null;
      try {
        bareG = gridFromSvg(await TS.chain.renderTraits(bare));
      } catch (_) {
        isolations[1] = null;
      }
      const jobs = [];
      for (let s = 1; s <= 6; s++) {
        if (s >= 2 && NONE_SLOTS[s] && !traits[s]) {
          isolations[s] = "none";
          continue;
        }
        jobs.push(
          isolateSlot(traits, s, tokenG, bareG, bg).then(function (svg) {
            isolations[s] = svg;
          }).catch(function () {
            isolations[s] = s === 1 ? null : "none";
          })
        );
      }
      await Promise.all(jobs);
      emit();
    }

    return {
      duration: DURATION,
      paint: paint,
      rowsFrom: rowsFrom,
      loadChips: loadChips,
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

  TS.explode = { bind: bind, HARBOR: HARBOR };
})(window);
