(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  const COLLECTION = "0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C";
  const SELECTORS = {
    tokenURI: "0xc87b56dd",
    renderer: "0x8ada6b0f",
    traitsOf: "0x5efab6e4",
    render: "0xfdd55a48",
  };
  const RPC_URLS = [
    "https://cloudflare-eth.com",
    "https://ethereum.publicnode.com",
    "https://ethereum-rpc.publicnode.com",
    "https://1rpc.io/eth",
    "https://rpc.mevblocker.io",
    "https://eth.drpc.org",
    "https://rpc.flashbots.net",
  ];
  const DB_NAME = "the-score";
  const STORE = "svgs";
  const DB_VERSION = 3;
  const GAS = "0x1c9c380"; // 30_000_000
  const MAX_CACHE_MS = 5 * 60 * 1000;

  let rpcIndex = 0;
  let rendererAddress = null;
  let rendererPromise = null;
  let dbPromise = null;
  const inflight = new Map();

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

  async function rpcPost(url, method, params) {
    if (RPC_URLS.indexOf(url) === -1) throw new Error("RPC not allowlisted");
    if (method !== "eth_call") throw new Error("only eth_call is allowed");
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      referrerPolicy: "no-referrer",
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
  }

  function allowedTo(to) {
    const x = String(to).toLowerCase();
    if (x === COLLECTION.toLowerCase()) return true;
    if (rendererAddress && x === rendererAddress) return true;
    return false;
  }

  async function ethCall(to, data, { gas } = {}) {
    if (!allowedTo(to)) throw new Error("eth_call target not allowlisted");
    const payload = { to: to, data, value: "0x0" };
    if (gas) payload.gas = gas;
    const start = rpcIndex;
    let lastErr = null;
    for (let i = 0; i < RPC_URLS.length; i++) {
      const idx = (start + i) % RPC_URLS.length;
      const url = RPC_URLS[idx];
      try {
        const result = await rpcPost(url, "eth_call", [payload, "latest"]);
        rpcIndex = idx;
        if (!result || result === "0x") {
          const err = new Error("execution reverted");
          throw err;
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (isRevert(err)) throw err;
      }
    }
    throw lastErr || new Error("All RPCs failed");
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
    return dbPromise;
  }

  async function cacheGet(key) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
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
      await new Promise((resolve, reject) => {
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
    if (rendererAddress) return rendererAddress;
    if (rendererPromise) return rendererPromise;
    rendererPromise = (async function () {
      const hex = await ethCall(COLLECTION, SELECTORS.renderer);
      if (!hex || hex === "0x") throw new Error("renderer() empty");
      const addr = "0x" + hex.slice(-40).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr) || addr === "0x0000000000000000000000000000000000000000") {
        throw new Error("bad renderer address");
      }
      rendererAddress = addr;
      return rendererAddress;
    })();
    try {
      return await rendererPromise;
    } catch (err) {
      rendererPromise = null;
      throw err;
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

  function cacheKey(renderer, id) {
    return String(renderer || "unknown") + ":" + String(id);
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
      const key = cacheKey(renderer, keyId);
      const cached = !fresh ? await cacheGet(key) : null;
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
          unminted: false,
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
          unminted: false,
          fromCache: false,
        };
        await cachePut(key, {
          renderer,
          id: keyId,
          svg: frame.svg,
          imageUri: frame.imageUri,
          kind: frame.kind,
          animated: frame.animated,
          attributes: meta.attributes,
          unminted: false,
          fetchedAt: Date.now(),
        });
        return frame;
      } catch (err) {
        if (isRevert(err)) {
          const frame = {
            id: keyId,
            renderer,
            svg: "",
            imageUri: "",
            kind: "empty",
            animated: false,
            attributes: [],
            unminted: true,
            fromCache: false,
          };
          return frame;
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

  const renderMemo = new Map();

  async function renderTraits(traits) {
    if (!traits || traits.length !== 7) throw new Error("need 7 traits");
    const renderer = await getRenderer();
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

  TS.chain = {
    COLLECTION,
    RPC_URLS,
    loadFrame,
    getRenderer,
    traitsOf,
    renderTraits,
    prefetch: function (ids) {
      ids.forEach(function (id) {
        loadFrame(id).catch(function () {});
      });
    },
  };
})(window);
