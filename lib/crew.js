(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const COLLECTION = "0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C";
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  // First mint observed 2026-08-26. Scan from here; not a sales tape.
  const FROM_BLOCK = 25837531;
  const CHUNK = 8000;
  const MAX_WALLETS = 4;
  const WORN = [2, 3, 4, 5, 6];
  const SLOT_CLOAK = 2;
  const ADDR = /^0x[0-9a-fA-F]{40}$/;

  function padAddr(addr) {
    return "0x" + String(addr).slice(2).toLowerCase().padStart(64, "0");
  }

  function parseAddresses(text) {
    const raw = String(text || "").split(/[\s,;]+/);
    const out = [];
    const seen = Object.create(null);
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i].trim();
      if (!s) continue;
      if (!ADDR.test(s)) continue;
      const a = s.toLowerCase();
      if (seen[a]) continue;
      seen[a] = true;
      out.push(a);
      if (out.length >= MAX_WALLETS) break;
    }
    return out;
  }

  function topicAddr(topic) {
    return "0x" + String(topic || "").slice(-40).toLowerCase();
  }

  function topicId(topic) {
    return parseInt(String(topic || "0x0"), 16);
  }

  async function logsInRange(fromBlock, toBlock, topics) {
    return TS.chain.getLogs({
      address: COLLECTION,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
      topics: topics,
    });
  }

  async function inboundChunk(addr, start, end) {
    const topics = [TRANSFER, null, padAddr(addr)];
    try {
      const logs = await logsInRange(start, end, topics);
      return { logs: logs || [], gaps: [] };
    } catch (_) {
      const mid = Math.floor((start + end) / 2);
      if (mid <= start) return { logs: [], gaps: [[start, end]] };
      const a = await inboundChunk(addr, start, mid);
      const b = await inboundChunk(addr, mid + 1, end);
      return {
        logs: a.logs.concat(b.logs),
        gaps: a.gaps.concat(b.gaps),
      };
    }
  }

  const HOLD_MS = 30 * 60 * 1000;
  const memHold = Object.create(null);

  function holdKey(addr) {
    return "crew-hold:" + addr;
  }

  function reviveHold(raw) {
    if (!raw || !Array.isArray(raw.ids)) return null;
    const firstIn = Object.create(null);
    const src = raw.firstIn || {};
    Object.keys(src).forEach(function (k) {
      const id = Number(k);
      const b = Number(src[k]);
      if (Number.isInteger(id) && id >= 1 && id <= 9999 && Number.isFinite(b)) firstIn[id] = b;
    });
    const ids = raw.ids.filter(function (id) {
      return Number.isInteger(id) && id >= 1 && id <= 9999;
    });
    return {
      ids: ids,
      firstIn: firstIn,
      toBlock: Number(raw.toBlock) || 0,
      fetchedAt: Number(raw.fetchedAt) || 0,
      complete: raw.complete === true,
      want: Number.isInteger(raw.want) ? raw.want : null,
    };
  }

  async function readHold(addr) {
    if (memHold[addr]) return memHold[addr];
    if (!TS.chain.cacheGet) return null;
    try {
      const raw = await TS.chain.cacheGet(holdKey(addr));
      const got = reviveHold(raw);
      if (got) memHold[addr] = got;
      return got;
    } catch (_) {
      return null;
    }
  }

  async function writeHold(addr, rec) {
    if (!rec || rec.complete !== true) return;
    memHold[addr] = rec;
    if (!TS.chain.cachePut) return;
    try {
      await TS.chain.cachePut(holdKey(addr), {
        ids: rec.ids,
        firstIn: rec.firstIn,
        toBlock: rec.toBlock,
        fetchedAt: rec.fetchedAt,
        complete: true,
        want: rec.want,
      });
    } catch (_) {}
  }

  function parseHoldIds(list) {
    const out = [];
    const seen = Object.create(null);
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const id = Number(src[i]);
      if (!Number.isInteger(id) || id < 1 || id > 9999) continue;
      if (seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  function firstInComplete(rec) {
    if (!rec || !rec.ids || !rec.ids.length) return false;
    const src = rec.firstIn || {};
    for (let i = 0; i < rec.ids.length; i++) {
      if (src[rec.ids[i]] == null) return false;
    }
    return true;
  }

  function isFreshHold(rec, want, latest) {
    if (!rec || rec.complete !== true) return false;
    if (HOLD_MS && Date.now() - rec.fetchedAt > HOLD_MS) return false;
    if (latest && rec.toBlock && latest - rec.toBlock > 40) return false;
    if (want != null && rec.ids.length !== want) return false;
    if (want != null && rec.want != null && rec.want !== want) return false;
    if (want == null && rec.want != null && rec.ids.length !== rec.want) return false;
    if (!firstInComplete(rec)) return false;
    return true;
  }

  function unionHolds(recs) {
    const ids = [];
    const firstIn = Object.create(null);
    const seen = Object.create(null);
    recs.forEach(function (rec) {
      if (!rec) return;
      rec.ids.forEach(function (id) {
        if (seen[id]) {
          if (rec.firstIn[id] != null && (firstIn[id] == null || rec.firstIn[id] < firstIn[id])) {
            firstIn[id] = rec.firstIn[id];
          }
          return;
        }
        seen[id] = true;
        ids.push(id);
        if (rec.firstIn[id] != null) firstIn[id] = rec.firstIn[id];
      });
    });
    ids.sort(function (a, b) {
      return a - b;
    });
    return { ids: ids, firstIn: firstIn };
  }

  function poolRun(limit) {
    const q = [];
    let n = 0;
    let wait = null;
    function pump() {
      while (n < limit && q.length) {
        const job = q.shift();
        n += 1;
        Promise.resolve()
          .then(job.fn)
          .then(job.resolve, function () {
            job.resolve(null);
          })
          .then(function () {
            n -= 1;
            pump();
            if (!q.length && n === 0 && wait) {
              const done = wait;
              wait = null;
              done();
            }
          });
      }
    }
    return {
      add: function (fn) {
        return new Promise(function (resolve) {
          q.push({ fn: fn, resolve: resolve });
          pump();
        });
      },
      drain: function () {
        if (!q.length && n === 0) return Promise.resolve();
        return new Promise(function (resolve) {
          wait = resolve;
        });
      },
    };
  }

  async function holdings(addresses, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const aborted = typeof opts.aborted === "function" ? opts.aborted : function () { return false; };
    const addrs = parseAddresses(Array.isArray(addresses) ? addresses.join(" ") : addresses);
    const seed = parseHoldIds(opts.seed);
    const seedIn = Object.create(null);
    if (opts.seedFirstIn) {
      Object.keys(opts.seedFirstIn).forEach(function (k) {
        const id = Number(k);
        const b = Number(opts.seedFirstIn[k]);
        if (Number.isInteger(id) && id >= 1 && id <= 9999 && Number.isFinite(b) && b > 0) seedIn[id] = b;
      });
    }
    if (!addrs.length) return { addresses: [], ids: [], firstIn: Object.create(null), complete: true };

    let latest = 0;
    try {
      latest = await TS.chain.blockNumber();
    } catch (_) {
      latest = 0;
    }
    if (aborted()) return { addresses: addrs, ids: [], firstIn: Object.create(null), complete: false };

    const cached = [];
    const wants = [];
    let allFresh = addrs.length > 0;
    for (let i = 0; i < addrs.length; i++) {
      const rec = await readHold(addrs[i]);
      cached[i] = rec;
      let want = null;
      try {
        if (TS.chain.balanceOf) want = await TS.chain.balanceOf(addrs[i]);
      } catch (_) {
        want = null;
      }
      wants[i] = want;
      if (!isFreshHold(rec, want, latest)) allFresh = false;
    }
    if (allFresh) {
      const u = unionHolds(cached);
      if (onProgress) onProgress({ addresses: addrs, ids: u.ids, firstIn: u.firstIn, pending: false, fromCache: true });
      return { addresses: addrs, ids: u.ids, firstIn: u.firstIn, fromCache: true, complete: true };
    }
    const owned = [];
    const seen = Object.create(null);
    const ownerOfId = Object.create(null);
    const firstIn = Object.create(null);
    const verified = Object.create(null);
    const found = Object.create(null);
    const pool = poolRun(4);

    function absorb(addr, rec, lock) {
      if (!rec) return;
      rec.ids.forEach(function (id) {
        found[id] = true;
        if (lock) {
          verified[id] = true;
          ownerOfId[id] = addr;
        }
        if (!seen[id]) {
          seen[id] = true;
          owned.push(id);
        }
        if (rec.firstIn && rec.firstIn[id] != null && (firstIn[id] == null || rec.firstIn[id] < firstIn[id])) {
          firstIn[id] = rec.firstIn[id];
        }
      });
    }

    let idsReadyFlag = false;

    function emit(pending) {
      if (!onProgress) return;
      onProgress({
        addresses: addrs,
        ids: owned.slice(),
        firstIn: firstIn,
        pending: pending,
        idsReady: idsReadyFlag,
      });
    }

    function allIdsReady() {
      for (let i = 0; i < addrs.length; i++) {
        if (wants[i] === 0) continue;
        if (wants[i] == null) {
          if (!countMine(addrs[i])) return false;
          continue;
        }
        if (countMine(addrs[i]) < wants[i]) return false;
      }
      return true;
    }

    function noteIdsReady() {
      if (idsReadyFlag || !allIdsReady()) return;
      idsReadyFlag = true;
      emit(true);
    }

    function dropId(id) {
      if (!seen[id]) return;
      delete seen[id];
      delete verified[id];
      delete ownerOfId[id];
      const i = owned.indexOf(id);
      if (i >= 0) owned.splice(i, 1);
    }

    function countMine(addr) {
      let n = 0;
      owned.forEach(function (id) {
        if (ownerOfId[id] === addr) n += 1;
      });
      return n;
    }

    function missingFirstIn(addr) {
      let n = 0;
      owned.forEach(function (id) {
        if (ownerOfId[id] === addr && firstIn[id] == null) n += 1;
      });
      return n;
    }

    function consider(id) {
      if (verified[id] || aborted()) return Promise.resolve();
      verified[id] = true;
      found[id] = true;
      return pool.add(function () {
        if (aborted()) return null;
        return TS.chain.ownerOf(id).then(function (owner) {
          if (aborted()) return;
          if (addrs.indexOf(owner) < 0) {
            dropId(id);
            delete ownerOfId[id];
            emit(true);
            return;
          }
          ownerOfId[id] = owner;
          if (!seen[id]) {
            seen[id] = true;
            owned.push(id);
            emit(true);
          }
        }).catch(function () {
          verified[id] = false;
        });
      });
    }

    function takeLogs(pack) {
      const logs = (pack && pack.logs) || [];
      for (let i = 0; i < logs.length; i++) {
        const lg = logs[i];
        const topics = (lg.topics || []).map(function (t) {
          return typeof t === "string" ? t : String(t || "");
        });
        if (topics.length < 4) continue;
        const to = topicAddr(topics[2]);
        const id = topicId(topics[3]);
        if (!Number.isInteger(id) || id < 1 || id > 9999) continue;
        if (addrs.indexOf(to) < 0) continue;
        const raw = lg.blockNumber;
        const block = typeof raw === "number" && Number.isFinite(raw)
          ? raw
          : parseInt(String(raw || "0x0"), 16);
        if (Number.isFinite(block) && block > 0 && (firstIn[id] == null || block < firstIn[id])) {
          firstIn[id] = block;
        }
        consider(id);
      }
      return (pack && pack.gaps) || [];
    }

    async function scanBothEnds(addr, want, chunk) {
      const top = latest || FROM_BLOCK;
      let lo = FROM_BLOCK;
      let hi = top;
      let gaps = [];
      while (lo <= hi) {
        if (aborted()) break;
        const loEnd = Math.min(lo + chunk - 1, hi);
        const hiStart = Math.max(hi - chunk + 1, loEnd + 1);
        const jobs = [inboundChunk(addr, lo, loEnd)];
        if (hiStart <= hi) jobs.push(inboundChunk(addr, hiStart, hi));
        const batches = await Promise.all(jobs);
        for (let b = 0; b < batches.length; b++) {
          const more = takeLogs(batches[b]);
          for (let g = 0; g < more.length; g++) gaps.push(more[g]);
        }
        lo = loEnd + 1;
        hi = hiStart - 1;
        await pool.drain();
        noteIdsReady();
        if (want != null && countMine(addr) >= want && missingFirstIn(addr) === 0) {
          gaps = [];
          break;
        }
      }
      if (gaps.length) await scanGaps(addr, gaps, want);
      noteIdsReady();
    }

    async function scanGaps(addr, gaps, want) {
      let missed = gaps.slice();
      let tries = 0;
      while (missed.length && tries < 3 && !aborted()) {
        tries += 1;
        const again = missed;
        missed = [];
        for (let m = 0; m < again.length; m++) {
          if (aborted()) break;
          const pack = await inboundChunk(addr, again[m][0], again[m][1]);
          const more = takeLogs(pack);
          for (let g = 0; g < more.length; g++) missed.push(more[g]);
        }
        await pool.drain();
        if (want != null && countMine(addr) >= want && missingFirstIn(addr) === 0) return [];
      }
      return missed;
    }

    if (seed.length) {
      seed.forEach(function (id) {
        if (seedIn[id] != null) firstIn[id] = seedIn[id];
        consider(id);
      });
      emit(true);
      await pool.drain();
      noteIdsReady();
    }

    for (let a = 0; a < addrs.length; a++) {
      if (aborted()) break;
      const addr = addrs[a];
      const rec = cached[a];
      const want = wants[a];
      if (isFreshHold(rec, want, latest)) {
        absorb(addr, rec, true);
        emit(true);
        noteIdsReady();
        continue;
      }
      if (rec) {
        absorb(addr, rec, false);
        emit(true);
        rec.ids.forEach(function (id) {
          if (!ownerOfId[id]) consider(id);
        });
      }
      if (want === 0) {
        owned.slice().forEach(function (id) {
          if (ownerOfId[id] === addr) dropId(id);
        });
        continue;
      }
      await pool.drain();
      noteIdsReady();
      if (want != null && countMine(addr) >= want && missingFirstIn(addr) === 0) continue;
      await scanBothEnds(addr, want, CHUNK);
      if (want != null && countMine(addr) < want) {
        await scanBothEnds(addr, want, Math.max(1000, Math.floor(CHUNK / 4)));
      }
    }
    await pool.drain();
    if (!aborted()) {
      let retry = 0;
      while (retry < 3 && !aborted()) {
        retry += 1;
        let pending = 0;
        Object.keys(found).forEach(function (k) {
          const id = Number(k);
          if (ownerOfId[id]) return;
          verified[id] = false;
          pending += 1;
          consider(id);
        });
        if (!pending) break;
        await pool.drain();
      }
      noteIdsReady();
    }
    if (aborted()) return { addresses: addrs, ids: owned.slice(), firstIn: firstIn, complete: false };

    owned.sort(function (a, b) {
      return a - b;
    });
    const fetchedAt = Date.now();
    let complete = true;
    for (let i = 0; i < addrs.length; i++) {
      const addr = addrs[i];
      const want = wants[i];
      const mine = [];
      const mineFirst = Object.create(null);
      owned.forEach(function (id) {
        if (ownerOfId[id] !== addr) return;
        mine.push(id);
        if (firstIn[id] != null) mineFirst[id] = firstIn[id];
      });
      const ok = want != null && mine.length === want;
      if (!ok) complete = false;
      if (ok) {
        await writeHold(addr, {
          ids: mine,
          firstIn: mineFirst,
          toBlock: latest,
          fetchedAt: fetchedAt,
          complete: true,
          want: want,
        });
      } else {
        delete memHold[addr];
      }
    }
    emit(false);
    return { addresses: addrs, ids: owned, firstIn: firstIn, complete: complete };
  }

  function cloakWorn(row) {
    if (!row) return 0;
    return row[SLOT_CLOAK] ? 1 : 0;
  }

  function wornCount(row) {
    if (!row) return 0;
    let n = 0;
    for (let i = 0; i < WORN.length; i++) if (row[WORN[i]]) n += 1;
    return n;
  }

  function watchSort(ids, rowOf) {
    return ids.slice().sort(function (a, b) {
      const ra = rowOf(a);
      const rb = rowOf(b);
      const ca = cloakWorn(ra);
      const cb = cloakWorn(rb);
      if (ca !== cb) return ca - cb;
      const da = wornCount(ra);
      const db = wornCount(rb);
      if (da !== db) return da - db;
      return a - b;
    });
  }

  function dealtSort(ids) {
    return ids.slice().sort(function (a, b) {
      return a - b;
    });
  }

  function arrivedSort(ids, firstIn) {
    if (!firstIn) return null;
    let known = 0;
    for (let i = 0; i < ids.length; i++) if (firstIn[ids[i]] != null) known += 1;
    if (!known) return null;
    return ids.slice().sort(function (a, b) {
      const fa = firstIn[a];
      const fb = firstIn[b];
      if (fa == null && fb == null) return a - b;
      if (fa == null) return 1;
      if (fb == null) return -1;
      if (fa !== fb) return fa - fb;
      return a - b;
    });
  }

  function echoOk(c, n) {
    if (c < 2) return false;
    if (n < 10) return true;
    return c >= 3 || c / n >= 0.12;
  }

  function echoPicks(ids, rowOf, nameOf) {
    const n = ids.length;
    const out = [];
    if (n < 2) return out;
    const bare = [];
    for (let i = 0; i < ids.length; i++) {
      const row = rowOf(ids[i]);
      if (row && wornCount(row) === 0) bare.push(ids[i]);
    }
    if (echoOk(bare.length, n)) {
      out.push({
        id: "echo:bare",
        label: "Bare Bones",
        ids: watchSort(bare, rowOf),
        count: bare.length,
        slot: -1,
        rank: 0,
      });
    }
    const slotNames = ["Palette", "Bones", "Cloak", "Relic", "Sight", "Artifact", "Crown"];
    for (let slot = 0; slot < 7; slot++) {
      const groups = Object.create(null);
      const worn = [];
      for (let i = 0; i < ids.length; i++) {
        const row = rowOf(ids[i]);
        if (!row) continue;
        const v = row[slot];
        if (slot >= 2 && !v) continue;
        if (slot >= 2) worn.push(ids[i]);
        const key = String(v);
        if (!groups[key]) groups[key] = [];
        groups[key].push(ids[i]);
      }
      const distinct = Object.keys(groups).length;
      if (slot >= 2 && echoOk(worn.length, n)) {
        out.push({
          id: "echo:" + slot + ":any",
          label: slotNames[slot],
          ids: watchSort(worn, rowOf),
          count: worn.length,
          slot: slot,
          rank: 1,
        });
      }
      Object.keys(groups).forEach(function (key) {
        if (slot >= 2 && distinct < 2) return;
        const list = groups[key];
        if (!echoOk(list.length, n)) return;
        const v = Number(key);
        let label = nameOf ? nameOf(slot, v) : null;
        if (!label || label === "None" || label === "Unknown") return;
        out.push({
          id: "echo:" + slot + ":" + v,
          label: label,
          ids: watchSort(list, rowOf),
          count: list.length,
          slot: slot,
          rank: slot >= 2 ? 2 : slot === 1 ? 3 : 4,
        });
      });
    }
    out.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.count !== b.count) return b.count - a.count;
      if (a.slot !== b.slot) return a.slot - b.slot;
      return String(a.label).localeCompare(String(b.label));
    });
    return out.slice(0, 10);
  }

  TS.crew = {
    parseAddresses: parseAddresses,
    parseHoldIds: parseHoldIds,
    holdings: holdings,
    watchSort: watchSort,
    dealtSort: dealtSort,
    arrivedSort: arrivedSort,
    echoPicks: echoPicks,
  };
})(window);
