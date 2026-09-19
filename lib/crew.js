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

  function logKey(lg) {
    return parseInt(lg.blockNumber, 16) * 1e6 + parseInt(lg.logIndex || lg.transactionIndex || "0x0", 16);
  }

  async function logsInRange(fromBlock, toBlock, topics) {
    return TS.chain.getLogs({
      address: COLLECTION,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
      topics: topics,
    });
  }

  async function collectLogs(addr) {
    const latest = await TS.chain.blockNumber();
    const pad = padAddr(addr);
    const inboundTopics = [TRANSFER, null, pad];
    const outboundTopics = [TRANSFER, pad];
    const all = [];
    let start = FROM_BLOCK;
    while (start <= latest) {
      const end = Math.min(start + CHUNK - 1, latest);
      let inbound = [];
      let outbound = [];
      try {
        inbound = await logsInRange(start, end, inboundTopics);
        outbound = await logsInRange(start, end, outboundTopics);
      } catch (_) {
        const mid = Math.floor((start + end) / 2);
        if (mid <= start) throw new Error("log range failed");
        inbound = (await logsInRange(start, mid, inboundTopics)).concat(
          await logsInRange(mid + 1, end, inboundTopics)
        );
        outbound = (await logsInRange(start, mid, outboundTopics)).concat(
          await logsInRange(mid + 1, end, outboundTopics)
        );
      }
      for (let i = 0; i < inbound.length; i++) all.push(inbound[i]);
      for (let j = 0; j < outbound.length; j++) all.push(outbound[j]);
      start = end + 1;
    }
    all.sort(function (a, b) {
      return logKey(a) - logKey(b);
    });
    return all;
  }

  function replay(addr, logs) {
    const held = Object.create(null);
    const firstIn = Object.create(null);
    for (let i = 0; i < logs.length; i++) {
      const lg = logs[i];
      const topics = lg.topics || [];
      if (topics.length < 4) continue;
      const from = topicAddr(topics[1]);
      const to = topicAddr(topics[2]);
      const id = topicId(topics[3]);
      if (!Number.isInteger(id) || id < 1 || id > 9999) continue;
      if (to === addr) {
        if (firstIn[id] == null) firstIn[id] = parseInt(lg.blockNumber, 16);
        held[id] = true;
      }
      if (from === addr && to !== addr) delete held[id];
    }
    return { held: held, firstIn: firstIn };
  }

  async function holdings(addresses) {
    const addrs = parseAddresses(Array.isArray(addresses) ? addresses.join(" ") : addresses);
    const ids = [];
    const firstIn = Object.create(null);
    const seen = Object.create(null);
    for (let i = 0; i < addrs.length; i++) {
      const addr = addrs[i];
      const logs = await collectLogs(addr);
      const state = replay(addr, logs);
      Object.keys(state.held).forEach(function (k) {
        const id = Number(k);
        if (seen[id]) {
          if (state.firstIn[id] != null && (firstIn[id] == null || state.firstIn[id] < firstIn[id])) {
            firstIn[id] = state.firstIn[id];
          }
          return;
        }
        seen[id] = true;
        ids.push(id);
        if (state.firstIn[id] != null) firstIn[id] = state.firstIn[id];
      });
    }
    const owned = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const owner = await TS.chain.ownerOf(id);
        if (addrs.indexOf(owner) >= 0) owned.push(id);
      } catch (_) {}
    }
    owned.sort(function (a, b) {
      return a - b;
    });
    return { addresses: addrs, ids: owned, firstIn: firstIn };
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

  function echoPick(ids, rowOf, nameOf) {
    const n = ids.length;
    if (n < 2) return null;
    const slotNames = ["Palette", "Bones", "Cloak", "Relic", "Sight", "Artifact", "Crown"];
    let best = null;
    for (let slot = 0; slot < 7; slot++) {
      const counts = Object.create(null);
      for (let i = 0; i < ids.length; i++) {
        const row = rowOf(ids[i]);
        if (!row) continue;
        const v = row[slot];
        if (slot >= 2 && !v) continue;
        const key = String(v);
        counts[key] = (counts[key] || 0) + 1;
      }
      const keys = Object.keys(counts);
      if (!keys.length) continue;
      keys.sort(function (a, b) {
        return counts[b] - counts[a];
      });
      const top = keys[0];
      const c = counts[top];
      const uniqueMode = keys.length === 1 || c > counts[keys[1]];
      const share = c / n;
      const ok = (c >= 3 && uniqueMode) || (share >= 0.4 && c >= 2);
      if (!ok) continue;
      if (!best || c > best.count || (c === best.count && slot < best.slot)) {
        const v = Number(top);
        let label = nameOf ? nameOf(slot, v) : null;
        if (!label || label === "None" || label === "Unknown") continue;
        best = { slot: slot, value: v, count: c, label: "Your " + label, slotName: slotNames[slot] };
      }
    }
    return best;
  }

  function echoIds(ids, pick, rowOf) {
    if (!pick) return [];
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const row = rowOf(ids[i]);
      if (!row) continue;
      if (row[pick.slot] === pick.value) out.push(ids[i]);
    }
    return watchSort(out, rowOf);
  }

  TS.crew = {
    parseAddresses: parseAddresses,
    holdings: holdings,
    watchSort: watchSort,
    dealtSort: dealtSort,
    arrivedSort: arrivedSort,
    echoPick: echoPick,
    echoIds: echoIds,
  };
})(window);
