#!/usr/bin/env node
// Batch-call traitsOf(1..9999). Zero dependencies. Do not commit RPC keys.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const OUT_BIN = join(DATA, "traits.bin");
const OUT_LABELS = join(DATA, "labels.json");
const OUT_META = join(DATA, "meta.json");
const CKPT = join(DATA, "checkpoint.json");

const CONTRACT = "0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const TRAITS_OF = "5efab6e4";
const AGGREGATE3 = "82ad56cb";
const FIRST_ID = 1;
const LAST_ID = 9999;
const SLOTS = 7;
const MAX_REQUESTS = 25;

const SLOTS_NAMED = ["Palette", "Bones", "Cloak", "Relic", "Sight", "Artifact", "Crown"];

const RPCS = (process.env.RPC_URL || process.env.RPC_URLS || [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.flashbots.net",
  "https://ethereum.publicnode.com",
  "https://1rpc.io/eth",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rpcIdx = 0;
function nextRpc() {
  return RPCS[rpcIdx++ % RPCS.length];
}

async function rpcCall(method, params, tries = 6) {
  let last = "unknown";
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = nextRpc();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "the-score-traits/1",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) last = "HTTP " + res.status + " from " + url;
      else {
        const j = await res.json();
        if (j.result !== undefined) return j.result;
        last = url + ": " + JSON.stringify(j.error);
      }
    } catch (e) {
      last = url + ": " + e.message;
    }
    await sleep(250 * 2 ** attempt);
  }
  throw new Error("RPC failed after " + tries + " tries — " + last);
}

function encodeBatch(ids) {
  const n = ids.length;
  const TUPLE = 192;
  const target = "0".repeat(24) + CONTRACT.slice(2).toLowerCase();
  let heads = "";
  let tails = "";
  for (let k = 0; k < n; k++) {
    heads += word(n * 32 + k * TUPLE);
    tails += target + word(0) + word(0x60) + word(36) + (TRAITS_OF + word(ids[k])).padEnd(128, "0");
  }
  return "0x" + AGGREGATE3 + word(0x20) + word(n) + heads + tails;
}

function decodeBatch(hex, n) {
  const b = hex.startsWith("0x") ? hex.slice(2) : hex;
  const at = (byteOff) => b.slice(byteOff * 2, byteOff * 2 + 64);
  const num = (byteOff) => parseInt(at(byteOff), 16);
  const arrayAt = num(0);
  const len = num(arrayAt);
  if (len !== n) throw new Error("expected " + n + " results, got " + len);
  const base = arrayAt + 32;
  const out = [];
  for (let k = 0; k < n; k++) {
    const rec = base + num(base + k * 32);
    const success = num(rec) === 1;
    const dataAt = rec + num(rec + 32);
    const dataLen = num(dataAt);
    if (!success) {
      out.push(null);
      continue;
    }
    if (dataLen !== SLOTS * 32) {
      throw new Error("result " + k + ": expected " + SLOTS * 32 + " bytes, got " + dataLen);
    }
    const traits = new Uint8Array(SLOTS);
    for (let s = 0; s < SLOTS; s++) {
      const v = num(dataAt + 32 + s * 32);
      if (v > 255) throw new Error("result " + k + " slot " + s + " exceeds uint8");
      traits[s] = v;
    }
    out.push(traits);
  }
  return out;
}

mkdirSync(DATA, { recursive: true });

const TOTAL = LAST_ID - FIRST_ID + 1;
let traits = new Uint8Array(TOTAL * SLOTS);
let done = new Uint8Array(TOTAL);
let block = process.env.BLOCK || null;

if (existsSync(CKPT)) {
  const c = JSON.parse(readFileSync(CKPT, "utf8"));
  traits = Uint8Array.from(Buffer.from(c.traits, "base64"));
  done = Uint8Array.from(Buffer.from(c.done, "base64"));
  block = c.block;
  console.log("resuming checkpoint: " + done.reduce((a, b) => a + b, 0) + "/" + TOTAL);
}

if (!block) {
  block = await rpcCall("eth_blockNumber", []);
  console.log("pinned to block " + parseInt(block, 16));
}

function saveCkpt() {
  writeFileSync(CKPT, JSON.stringify({
    block,
    traits: Buffer.from(traits).toString("base64"),
    done: Buffer.from(done).toString("base64"),
  }));
}

const t0 = Date.now();
const batchSize = Math.ceil(TOTAL / MAX_REQUESTS);
let requests = 0;

for (let start = FIRST_ID; start <= LAST_ID; ) {
  const size = Math.min(batchSize, LAST_ID - start + 1);
  const ids = [];
  for (let i = 0; i < size; i++) {
    if (!done[start + i - FIRST_ID]) ids.push(start + i);
  }
  if (ids.length === 0) {
    start += size;
    continue;
  }
  if (requests >= MAX_REQUESTS) {
    throw new Error("would exceed " + MAX_REQUESTS + " eth_calls");
  }
  const raw = await rpcCall("eth_call", [{ to: MULTICALL3, data: encodeBatch(ids) }, block]);
  requests += 1;
  const results = decodeBatch(raw, ids.length);
  results.forEach((tr, k) => {
    if (!tr) {
      console.warn("  traitsOf(" + ids[k] + ") reverted");
      return;
    }
    const idx = ids[k] - FIRST_ID;
    traits.set(tr, idx * SLOTS);
    done[idx] = 1;
  });
  start += size;
  const got = done.reduce((a, b) => a + b, 0);
  process.stdout.write("\r  " + got + "/" + TOTAL + "  (" + requests + " requests, " + ((Date.now() - t0) / 1000).toFixed(1) + "s)   ");
  if (requests % 5 === 0) saveCkpt();
}

const missing = [];
for (let i = 0; i < TOTAL; i++) if (!done[i]) missing.push(i + FIRST_ID);
if (missing.length) {
  saveCkpt();
  throw new Error("incomplete: " + missing.length + " ids missing, e.g. " + missing.slice(0, 5));
}

writeFileSync(OUT_BIN, Buffer.from(traits));
writeFileSync(OUT_LABELS, JSON.stringify({
  slots: SLOTS_NAMED.map((name, index) => ({ index, name })),
}, null, 2) + "\n");
writeFileSync(OUT_META, JSON.stringify({
  contract: CONTRACT,
  block: parseInt(block, 16),
  firstId: FIRST_ID,
  lastId: LAST_ID,
  slots: SLOTS,
  count: TOTAL,
  bytes: TOTAL * SLOTS,
  requests,
  fetchedAt: new Date().toISOString(),
}, null, 2) + "\n");

if (existsSync(CKPT)) {
  try { writeFileSync(CKPT, ""); } catch (_) {}
}

console.log("\ndone in " + ((Date.now() - t0) / 1000).toFixed(1) + "s over " + requests + " requests");
console.log("wrote " + OUT_BIN + " (" + TOTAL * SLOTS + " bytes)");
console.log("wrote " + OUT_LABELS);
console.log("wrote " + OUT_META);
