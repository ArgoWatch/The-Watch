#!/usr/bin/env node
// Compare a sample of live traitsOf() against data/traits.bin.
// Exit 1 if the snapshot is stale. Do not commit RPC keys.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "data/traits.bin");
const META = join(ROOT, "data/meta.json");

const CONTRACT = "0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C";
const TRAITS_OF = "5efab6e4";
const RENDERER = "8ada6b0f";
const SLOTS = 7;
const LAST_ID = 9999;

const RPCS = (process.env.RPC_URL || process.env.RPC_URLS || [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.flashbots.net",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const word = (n) => BigInt(n).toString(16).padStart(64, "0");

async function rpcCall(method, params) {
  let last = "unknown";
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "the-instrument-check/1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await res.json();
      if (j.result !== undefined) return j.result;
      last = JSON.stringify(j.error);
    } catch (e) {
      last = e.message;
    }
  }
  throw new Error("RPC failed: " + last);
}

function decodeTraits(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = [];
  for (let i = 0; i < SLOTS; i++) out.push(parseInt(h.slice(i * 64, i * 64 + 64), 16));
  return out;
}

const bin = readFileSync(BIN);
if (bin.length !== LAST_ID * SLOTS) throw new Error("traits.bin size " + bin.length);
const meta = JSON.parse(readFileSync(META, "utf8"));

const rendererHex = await rpcCall("eth_call", [{ to: CONTRACT, data: "0x" + RENDERER }, "latest"]);
const renderer = "0x" + rendererHex.slice(-40).toLowerCase();
console.log("renderer", renderer);
console.log("snapshot block", meta.block, "at", meta.fetchedAt);

const ids = [1, 6664, 9900, 9999];
for (let i = 0; i < 36; i++) ids.push(1 + Math.floor(Math.random() * LAST_ID));
const unique = [...new Set(ids)];

let drift = 0;
for (const id of unique) {
  const hex = await rpcCall("eth_call", [{
    to: CONTRACT,
    data: "0x" + TRAITS_OF + word(id),
  }, "latest"]);
  const live = decodeTraits(hex);
  const off = (id - 1) * SLOTS;
  const snap = [...bin.subarray(off, off + SLOTS)];
  const same = live.every((v, i) => v === snap[i]);
  if (!same) {
    drift += 1;
    console.log("DRIFT id", id, "snap", snap.join(","), "live", live.join(","));
  }
}

if (drift) {
  console.error("stale snapshot: " + drift + " / " + unique.length + " sampled ids differ. Re-run: node scripts/fetch-traits.mjs");
  process.exit(1);
}
console.log("ok: " + unique.length + " ids match traits.bin");
