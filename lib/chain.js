(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const COLLECTION = "0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C";
  const DEAD_CLOCK = "0x322E5aa6E76De8272cB39E5fa0cE02F48abaCf21";
  const SELECTORS = {
    tokenURI: "0xc87b56dd",
    renderer: "0x8ada6b0f",
    traitsOf: "0x5efab6e4",
    render: "0xfdd55a48",
    base: "0x5001f3b5",
    deadSince: "0xb3ad0356",
    ownerOf: "0x6352211e",
    balanceOf: "0x70a08231",
  };
  const RPC_METHODS = { eth_call: true, eth_getLogs: true, eth_blockNumber: true };
  // Full fetch URLs. CSP connect-src lists origins only (https://1rpc.io covers /eth).
  const RPC_URLS = [
    "https://ethereum.publicnode.com",
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.mevblocker.io",
    "https://eth.drpc.org",
    "https://rpc.flashbots.net",
    "https://1rpc.io/eth",
    "https://cloudflare-eth.com",
  ];
  // 1rpc (50-block) and cloudflare (800-block) return empty or error on Crew windows.
  // Keep them for eth_call; do not stick getLogs on them.
  const LOG_RPC_URLS = [
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.mevblocker.io",
    "https://rpc.flashbots.net",
    "https://ethereum.publicnode.com",
    "https://eth.drpc.org",
  ];
  const DB_NAME = "the-score";
  const STORE = "svgs";
  const DB_VERSION = 4;
  const GAS = "0x1c9c380"; // 30_000_000
  const MAX_CACHE_MS = 5 * 60 * 1000;
  const RPC_MS = 5000;
  const LOGS_MS = 5000;
  const IDB_MS = 1500;

  let rpcIndex = 0;
  let logRpcIndex = 0;
  let rendererAddress = null;
  let renderBase = null;
  let rendererPromise = null;
  let lastRenderer = null;
  let dbPromise = null;
  const inflight = new Map();
  const renderMemo = new Map();
  const deadSinceMemo = new Map();
  const deadSinceInflight = new Map();

  function assertId(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      throw new Error("id out of range");
    }
    return n;
  }

  function pad32(n) {
    return BigInt(n).toString(16).padStart(64, "0");
  }

  function isRevert(error) {
    if (!error) return false;
    const msg = String(error.message || error);
    const data = String(error.data || "");
    return (
      /revert|execution reverted|NotMinted|ERC721NonexistentToken/i.test(msg) ||
      /revert/i.test(data)
    );
  }

  async function rpcPost(url, method, params, ms) {
    if (RPC_URLS.indexOf(url) === -1) throw new Error("RPC not allowlisted");
    if (!RPC_METHODS[method]) throw new Error("RPC method not allowlisted");
    const ac = new AbortController();
    const budget = Number(ms) > 0 ? Number(ms) : RPC_MS;
    const timer = setTimeout(function () { ac.abort(); }, budget);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        referrerPolicy: "no-referrer",
        credentials: "omit",
        cache: "no-store",
        signal: ac.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) {
        throw new Error("RPC HTTP " + res.status + " " + url);
      }
      const body = await res.json();
      if (body.error) {
        const err = new Error(body.error.message || "RPC error");
        err.data = body.error.data;
        err.code = body.error.code;
        throw err;
      }
      return body.result;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("RPC timeout " + url);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function allowedTo(to) {
    const x = String(to).toLowerCase();
    if (x === COLLECTION.toLowerCase()) return true;
    if (x === DEAD_CLOCK.toLowerCase()) return true;
    if (rendererAddress && x === rendererAddress) return true;
    if (renderBase && x === renderBase) return true;
    return false;
  }

  function rpcList(method) {
    return method === "eth_getLogs" ? LOG_RPC_URLS : RPC_URLS;
  }

  function rpcCursor(method) {
    return method === "eth_getLogs" ? logRpcIndex : rpcIndex;
  }

  function setRpcCursor(method, idx) {
    if (method === "eth_getLogs") logRpcIndex = idx;
    else rpcIndex = idx;
  }

  async function rpcWalk(method, params, ms) {
    const list = rpcList(method);
    const start = rpcCursor(method);
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const idx = (start + i) % list.length;
      const url = list[idx];
      try {
        const result = await rpcPost(url, method, params, ms);
        setRpcCursor(method, idx);
        return result;
      } catch (err) {
        lastErr = err;
        if (method === "eth_call" && isRevert(err)) throw err;
      }
    }
    throw lastErr || new Error("All RPCs failed");
  }

  async function rpcMethod(method, params, ms) {
    return rpcWalk(method, params, ms);
  }

  async function ethCall(to, data, { gas } = {}) {
    if (!allowedTo(to)) throw new Error("eth_call target not allowlisted");
    const payload = { to: to, data, value: "0x0" };
    if (gas) payload.gas = gas;
    const result = await rpcWalk("eth_call", [payload, "latest"], RPC_MS);
    if (!result || result === "0x") {
      throw new Error("execution reverted");
    }
    return result;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const fail = setTimeout(function () {
        reject(new Error("idb timeout"));
      }, IDB_MS);
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
          db.createObjectStore(STORE);
        };
        req.onsuccess = function () {
          clearTimeout(fail);
          resolve(req.result);
        };
        req.onerror = function () {
          clearTimeout(fail);
          reject(req.error);
        };
        req.onblocked = function () {
          clearTimeout(fail);
          reject(new Error("idb blocked"));
        };
      } catch (err) {
        clearTimeout(fail);
        reject(err);
      }
    }).catch(function () {
      return null;
    });
    return dbPromise;
  }

  async function cacheGet(key) {
    try {
      const db = await openDb();
      if (!db) return null;
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () {
          resolve(req.result || null);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    } catch (_) {
      return null;
    }
  }

  async function cachePut(key, value) {
    try {
      const db = await openDb();
      if (!db) return;
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    } catch (_) {
      /* private mode / quota: still play from memory */
    }
  }

  async function getRenderer() {
    if (rendererPromise) return rendererPromise;
    rendererPromise = (async function () {
      const hex = await ethCall(COLLECTION, SELECTORS.renderer);
      if (!hex || hex === "0x") throw new Error("renderer() empty");
      const addr = "0x" + hex.slice(-40).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr) || addr === "0x0000000000000000000000000000000000000000") {
        throw new Error("bad renderer address");
      }
      rendererAddress = addr;
      renderBase = null;
      return addr;
    })();
    try {
      return await rendererPromise;
    } catch (err) {
      if (rendererAddress) return rendererAddress;
      throw err;
    } finally {
      rendererPromise = null;
    }
  }

  async function fetchTokenURI(id) {
    const data = SELECTORS.tokenURI + pad32(id);
    return ethCall(COLLECTION, data, { gas: GAS });
  }

  function decodeUint8Array(hex, n) {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (h.length < n * 64) throw new Error("short traitsOf");
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = parseInt(h.slice(i * 64, i * 64 + 64), 16);
      if (v > 255) throw new Error("traitsOf slot exceeds uint8");
      out[i] = v;
    }
    return out;
  }

  async function traitsOf(id) {
    const keyId = assertId(id);
    const hex = await ethCall(COLLECTION, SELECTORS.traitsOf + pad32(keyId));
    return decodeUint8Array(hex, 7);
  }

  function cacheKey(renderer, id, source) {
    return String(renderer || "unknown") + ":" + String(id) + ":" + (source || "uri");
  }

  async function purgeOtherRenderers(addr) {
    renderMemo.clear();
    const prefix = String(addr || "");
    if (!prefix) return;
    try {
      const db = await openDb();
      if (!db) return;
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.openCursor();
        req.onsuccess = function () {
          const cursor = req.result;
          if (!cursor) return;
          if (String(cursor.key).indexOf(prefix) !== 0) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    } catch (_) {
      /* private mode */
    }
  }

  async function loadRenderFrame(keyId, renderer, opts) {
    const rKey = cacheKey(renderer, keyId, "render");
    const cached = await cacheGet(rKey);
    const cacheAge = cached && cached.fetchedAt ? Date.now() - cached.fetchedAt : Infinity;
    const want = opts && opts.traits;
    const traitsMatch = function (a, b) {
      if (!a || !b || a.length !== b.length) return !want;
      for (let i = 0; i < a.length; i++) if (Number(a[i]) !== Number(b[i])) return false;
      return true;
    };
    if (cached && cacheAge < MAX_CACHE_MS && cached.svg && traitsMatch(cached.traits, want)) {
      return {
        id: keyId,
        renderer,
        svg: cached.svg,
        imageUri: "",
        kind: "svg",
        animated: false,
        attributes: cached.attributes || (opts && opts.attributes) || [],
        traits: cached.traits || (opts && opts.traits) || null,
        unminted: true,
        source: "render",
        fromCache: true,
      };
    }
    let traits = opts && opts.traits;
    if (!traits || traits.length !== 7) traits = await traitsOf(keyId);
    const svg = await renderTraits(Array.from(traits));
    const attributes = (opts && opts.attributes) || [];
    await cachePut(rKey, {
      renderer,
      id: keyId,
      svg: svg,
      traits: Array.from(traits),
      attributes: attributes,
      unminted: true,
      source: "render",
      fetchedAt: Date.now(),
    });
    return {
      id: keyId,
      renderer,
      svg: svg,
      imageUri: "",
      kind: "svg",
      animated: false,
      attributes: attributes,
      traits: Array.from(traits),
      unminted: true,
      source: "render",
      fromCache: false,
    };
  }

  async function loadFrame(id, opts) {
    const keyId = assertId(id);
    const fresh = !!(opts && opts.fresh);
    if (!fresh && inflight.has(keyId)) return inflight.get(keyId);

    const job = (async function () {
      let renderer = "unknown";
      try {
        renderer = await getRenderer();
      } catch (_) {
        renderer = "unknown";
      }
      if (renderer !== "unknown" && lastRenderer && lastRenderer !== renderer) {
        await purgeOtherRenderers(renderer);
      }
      if (renderer !== "unknown") lastRenderer = renderer;

      const uriKey = cacheKey(renderer, keyId, "uri");
      const cached = !fresh ? await cacheGet(uriKey) : null;
      const cacheAge = cached && cached.fetchedAt ? Date.now() - cached.fetchedAt : Infinity;
      if (cached && !cached.unminted && cacheAge < MAX_CACHE_MS && (cached.svg || cached.imageUri)) {
        return {
          id: keyId,
          renderer,
          svg: cached.svg || "",
          imageUri: cached.imageUri || "",
          kind: cached.kind || (cached.svg ? "svg" : "gif"),
          animated: !!cached.animated,
          attributes: cached.attributes || [],
          fleece: cached.fleece || null,
          unminted: false,
          source: "uri",
          fromCache: true,
        };
      }

      try {
        const hex = await fetchTokenURI(keyId);
        const uri = TS.decode.decodeAbiString(hex);
        const meta = TS.decode.metaFromTokenURI(uri);
        const frame = {
          id: keyId,
          renderer,
          svg: meta.svg || "",
          imageUri: meta.imageUri || "",
          kind: meta.kind || "svg",
          animated: !!meta.animated,
          attributes: meta.attributes,
          fleece: meta.fleece || null,
          unminted: false,
          source: "uri",
          fromCache: false,
        };
        await cachePut(uriKey, {
          renderer,
          id: keyId,
          svg: frame.svg,
          imageUri: frame.imageUri,
          kind: frame.kind,
          animated: frame.animated,
          attributes: meta.attributes,
          fleece: meta.fleece || null,
          unminted: false,
          source: "uri",
          fetchedAt: Date.now(),
        });
        return frame;
      } catch (err) {
        if (isRevert(err)) {
          try {
            return await loadRenderFrame(keyId, renderer, opts);
          } catch (_) {
            return {
              id: keyId,
              renderer,
              svg: "",
              imageUri: "",
              kind: "empty",
              animated: false,
              attributes: [],
              unminted: true,
              source: "empty",
              fromCache: false,
            };
          }
        }
        throw err;
      }
    })();

    inflight.set(keyId, job);
    try {
      return await job;
    } finally {
      inflight.delete(keyId);
    }
  }

  async function getRenderTarget() {
    const r = await getRenderer();
    if (renderBase) return renderBase;
    try {
      const hex = await ethCall(r, SELECTORS.base);
      const addr = "0x" + String(hex).slice(-40).toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(addr) && addr !== "0x0000000000000000000000000000000000000000") {
        renderBase = addr;
        return renderBase;
      }
    } catch (_) {}
    return r;
  }

  async function renderTraits(traits) {
    if (!traits || traits.length !== 7) throw new Error("need 7 traits");
    const renderer = await getRenderTarget();
    const key = renderer + ":" + Array.from(traits).join(",");
    if (renderMemo.has(key)) return renderMemo.get(key);
    const job = (async function () {
      const data = SELECTORS.render + Array.from(traits).map(pad32).join("");
      const hex = await ethCall(renderer, data, { gas: GAS });
      return TS.decode.decodeAbiString(hex);
    })();
    renderMemo.set(key, job);
    try {
      return await job;
    } catch (err) {
      renderMemo.delete(key);
      throw err;
    }
  }

  async function deadSince(id) {
    const n = assertId(id);
    const hit = deadSinceMemo.get(n);
    if (hit && (hit.value > 0 || Date.now() - hit.fetchedAt < MAX_CACHE_MS)) {
      return hit.value;
    }
    if (deadSinceInflight.has(n)) return deadSinceInflight.get(n);
    const job = (async function () {
      try {
        const hex = await ethCall(DEAD_CLOCK, SELECTORS.deadSince + pad32(n));
        const t = Number(BigInt(hex));
        const value = Number.isFinite(t) && t > 0 ? t : 0;
        deadSinceMemo.set(n, { value: value, fetchedAt: Date.now() });
        return value;
      } catch (_) {
        deadSinceMemo.set(n, { value: 0, fetchedAt: Date.now() });
        return 0;
      }
    })();
    deadSinceInflight.set(n, job);
    try {
      return await job;
    } finally {
      deadSinceInflight.delete(n);
    }
  }

  async function ownerOf(id) {
    const n = assertId(id);
    const hex = await ethCall(COLLECTION, SELECTORS.ownerOf + pad32(n));
    return "0x" + String(hex).slice(-40).toLowerCase();
  }

  async function balanceOf(addr) {
    const a = String(addr || "").toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(a)) throw new Error("bad address");
    const hex = await ethCall(COLLECTION, SELECTORS.balanceOf + a.padStart(64, "0"));
    return parseInt(hex, 16);
  }

  async function getLogs(filter) {
    const addr = String(filter && filter.address || "").toLowerCase();
    if (addr !== COLLECTION.toLowerCase()) throw new Error("eth_getLogs address not allowlisted");
    const payload = {
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      address: COLLECTION,
      topics: filter.topics,
    };
    const result = await rpcMethod("eth_getLogs", [payload], LOGS_MS);
    return Array.isArray(result) ? result : [];
  }

  async function blockNumber() {
    const hex = await rpcMethod("eth_blockNumber", []);
    return parseInt(hex, 16);
  }

  TS.chain = {
    COLLECTION,
    DEAD_CLOCK,
    RPC_URLS,
    LOG_RPC_URLS,
    loadFrame,
    getRenderer,
    traitsOf,
    renderTraits,
    deadSince,
    ownerOf,
    balanceOf,
    getLogs,
    blockNumber,
    cacheGet: cacheGet,
    cachePut: cachePut,
    prefetch: function (ids) {
      ids.forEach(function (id) {
        loadFrame(id).catch(function () {});
      });
    },
  };
})(window);
