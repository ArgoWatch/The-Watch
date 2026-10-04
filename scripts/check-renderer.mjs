#!/usr/bin/env node
// On-demand census when ACK ships a renderer. Zero dependencies.
// Reads renderer(), samples traitsOf, pulls a small tokenURI set.
// Prints what The Watch would drop. Does not eval HTML. Do not commit RPC keys.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "data", "traits.bin");
const SNAP = join(ROOT, "data", "renderer-check.json");

const CONTRACT = "0x387C41B0B2F1128dE44dB1Bcf8baad085f26392C";
const TOKEN_URI = "c87b56dd";
const TRAITS_OF = "5efab6e4";
const RENDERER = "8ada6b0f";
const BASE = "5001f3b5";
const SLOTS = 7;
const LAST_ID = 9999;
const GAS = "0x1c9c380";
const UA = "the-watch-renderer-check/1";

const KEEP_TAGS = {
  svg: 1,
  rect: 1,
  g: 1,
  path: 1,
  set: 1,
  animate: 1,
  animatetransform: 1,
};

const PATH_PIECE = /M(-?\d+) (-?\d+)h(-?\d+)v(-?\d+)h(-?\d+)z/g;
const PATH_SAFE = /^[Mhvz0-9\s-]+$/;

const KNOWN_HTML_ONLY = { 17: "Petrified — HTML motion, still SVG on The Watch" };

const TWIN_LOOK = [1];

const RPCS = (process.env.RPC_URL || process.env.RPC_URLS || [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.flashbots.net",
  "https://ethereum.publicnode.com",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortAddr = (a) => String(a || "").toLowerCase();

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
          "user-agent": UA,
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

function decodeAbiString(hex) {
  if (!hex || hex === "0x") throw new Error("empty eth_call");
  const buf = Buffer.from(hex.startsWith("0x") ? hex.slice(2) : hex, "hex");
  if (buf.length < 64) throw new Error("short ABI string");
  const word64 = (off) => {
    if (off + 32 > buf.length) throw new Error("ABI overflow");
    return Number(buf.readBigUInt64BE(off + 24));
  };
  const offset = word64(0);
  const length = word64(offset);
  if (length > 524288) throw new Error("ABI string too large");
  const start = offset + 32;
  if (start + length > buf.length) throw new Error("ABI string truncated");
  return buf.slice(start, start + length).toString("utf8");
}

function decodeAddr(hex) {
  return ("0x" + String(hex || "").slice(-40)).toLowerCase();
}

function decodeTraits(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = [];
  for (let i = 0; i < SLOTS; i++) out.push(parseInt(h.slice(i * 64, i * 64 + 64), 16));
  return out;
}

function decodeDataUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith("data:")) return null;
  const m = /^data:([^,]*?),(.*)$/s.exec(uri);
  if (!m) return null;
  const meta = m[1];
  const payload = m[2];
  const isB64 = /;base64/i.test(meta);
  try {
    const text = isB64
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return { meta, text };
  } catch (_) {
    return null;
  }
}

function pixelRectsFromD(d) {
  if (!d || !PATH_SAFE.test(d)) return null;
  const out = [];
  PATH_PIECE.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = PATH_PIECE.exec(d))) {
    if (m.index !== last) return null;
    last = PATH_PIECE.lastIndex;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const w = Number(m[3]);
    const h = Number(m[4]);
    const back = Number(m[5]);
    if (w < 1 || h < 1 || w > 24 || h > 24 || back !== -w) return null;
    if (x < 0 || y < 0 || x + w > 24 || y + h > 24) return null;
    out.push({ x, y, w, h });
    if (out.length > 576) return null;
  }
  if (!out.length || last !== d.length) return null;
  return out;
}

function goldCells(svg) {
  const seen = Object.create(null);
  const mask = [];
  function addCell(x, y) {
    if (x < 0 || y < 0 || x > 23 || y > 23) return;
    const i = y * 24 + x;
    if (seen[i]) return;
    seen[i] = 1;
    mask.push(i);
  }
  function addRects(cells) {
    if (!cells) return;
    for (const c of cells) {
      for (let y = 0; y < c.h; y++) {
        for (let x = 0; x < c.w; x++) addCell(c.x + x, c.y + y);
      }
    }
  }
  const pathRe = /<path\b([^>]*)>/g;
  let m;
  while ((m = pathRe.exec(svg || ""))) {
    const a = m[1];
    if (!/#ffdc78/i.test(a)) continue;
    const d = /\bd="([^"]+)"/.exec(a);
    if (d) addRects(pixelRectsFromD(d[1]));
  }
  const rectRe = /<rect\b([^>]*)>/g;
  while ((m = rectRe.exec(svg || ""))) {
    const a = m[1];
    if (!/#ffdc78/i.test(a)) continue;
    const x = Number((/\bx="([^"]+)"/.exec(a) || [])[1]);
    const y = Number((/\by="([^"]+)"/.exec(a) || [])[1]);
    const w = Number((/\bwidth="([^"]+)"/.exec(a) || [])[1]);
    const h = Number((/\bheight="([^"]+)"/.exec(a) || [])[1]);
    if ([x, y, w, h].every(Number.isFinite)) addRects([{ x, y, w, h }]);
  }
  return mask;
}

function svgTags(svg) {
  const tags = Object.create(null);
  const re = /<\/?([A-Za-z][A-Za-z0-9]*)\b/g;
  let m;
  while ((m = re.exec(svg || ""))) tags[m[1].toLowerCase()] = (tags[m[1].toLowerCase()] || 0) + 1;
  return tags;
}

function droppedPaths(svg) {
  const bad = [];
  const re = /<path\b([^>]*)>/g;
  let m;
  while ((m = re.exec(svg || ""))) {
    const d = /\bd="([^"]*)"/.exec(m[1]);
    if (!d) {
      bad.push("(no d)");
      continue;
    }
    if (!pixelRectsFromD(d[1])) bad.push(d[1].slice(0, 48));
  }
  return bad;
}

function htmlNames(html) {
  const names = new Set();
  if (!html) return [];
  const add = (s) => {
    if (s) names.add(s);
  };
  let m;
  const aRe = /\bA\.([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = aRe.exec(html))) add("A." + m[1]);
  const varRe = /\bvar\s+([A-Z][A-Z0-9_]*)\b/g;
  while ((m = varRe.exec(html))) add("var " + m[1]);
  const imgRe = /([\w.-]+\.(?:png|gif|jpg|jpeg|webp|svg))/gi;
  while ((m = imgRe.exec(html))) add("img " + m[1].toLowerCase());
  if (/FLEECE/.test(html)) add("FLEECE");
  return [...names].sort();
}

function htmlFlags(html) {
  const h = html || "";
  return {
    fleece: /var FLEECE\s*=/.test(h) || (h.indexOf("FLEECE") >= 0 && /FLEECE/.test(h)),
    radio: /\bA\.radio\b/.test(h),
    red: /\bA\.red\b/.test(h),
    gf: /gf\.png/i.test(h),
    canvas: /<canvas|\.getContext\s*\(/i.test(h),
  };
}

function attrMap(attributes) {
  const out = {};
  (attributes || []).forEach((a) => {
    if (!a || !a.trait_type) return;
    out[String(a.trait_type)] = String(a.value == null ? "" : a.value);
  });
  return out;
}

function firstId(bin, slot, value) {
  for (let id = 1; id <= LAST_ID; id++) {
    if (bin[(id - 1) * SLOTS + slot] === value) return id;
  }
  return null;
}

function pickCanaries(bin) {
  const fixed = new Set([
    1, 17, 23, 174, 228, 5266, 7135, 7481, 7920, 8292, 8393, 9067,
  ]);
  const add = (set, id) => {
    if (Number.isInteger(id) && id >= 1 && id <= LAST_ID) set.add(id);
  };
  add(fixed, firstId(bin, 4, 5));
  add(fixed, firstId(bin, 6, 6));
  add(fixed, firstId(bin, 4, 3));
  add(fixed, firstId(bin, 0, 17));
  const bones8393 = bin[(8393 - 1) * SLOTS + 1];
  add(fixed, firstId(bin, 1, bones8393));
  const extra = new Set();
  for (let n = 0; n < 3; n++) {
    let id = 1 + Math.floor(Math.random() * LAST_ID);
    if (!fixed.has(id)) extra.add(id);
  }
  return {
    fixed: [...fixed].sort((a, b) => a - b),
    extra: [...extra].sort((a, b) => a - b),
    all: [...new Set([...fixed, ...extra])].sort((a, b) => a - b),
  };
}

function parseMeta(uri) {
  let jsonText = uri;
  if (uri.startsWith("data:")) {
    const decoded = decodeDataUri(uri);
    if (!decoded) throw new Error("bad tokenURI data URI");
    jsonText = decoded.text;
  }
  const meta = JSON.parse(jsonText);
  const attributes = [];
  if (Array.isArray(meta.attributes)) {
    meta.attributes.slice(0, 24).forEach((a) => {
      if (!a || typeof a !== "object") return;
      const trait_type = typeof a.trait_type === "string" ? a.trait_type.slice(0, 64) : "";
      const value = a.value == null ? "" : String(a.value).slice(0, 96);
      if (trait_type) attributes.push({ trait_type, value });
    });
  }
  let svg = "";
  let kind = "empty";
  const image = meta.image || meta.image_data || "";
  if (typeof image === "string" && image) {
    if (image.startsWith("data:")) {
      const decoded = decodeDataUri(image);
      if (decoded) {
        const mime = String(decoded.meta || "");
        if (/image\/gif/i.test(mime)) kind = "gif";
        else if (/svg/i.test(mime) || /<svg[\s>]/i.test(decoded.text)) {
          kind = "svg";
          svg = decoded.text;
        } else kind = "raster";
      }
    } else if (/<svg[\s>]/i.test(image)) {
      kind = "svg";
      svg = image;
    }
  }
  let html = "";
  let htmlKind = "none";
  const au = meta.animation_url || "";
  if (typeof au === "string" && au) {
    if (/^https?:/i.test(au)) htmlKind = "https";
    else if (au.indexOf("data:text/html") === 0) {
      const decoded = decodeDataUri(au);
      html = decoded && decoded.text ? decoded.text.slice(0, 65536) : "";
      htmlKind = html ? "html" : "empty";
    } else htmlKind = "other";
  }
  return { attributes, svg, kind, html, htmlKind, name: typeof meta.name === "string" ? meta.name : "" };
}

async function loadUri(id) {
  const hex = await rpcCall("eth_call", [{
    to: CONTRACT,
    data: "0x" + TOKEN_URI + word(id),
    gas: GAS,
  }, "latest"]);
  const uri = decodeAbiString(hex);
  return parseMeta(uri);
}

function censusOne(id, meta) {
  const tags = svgTags(meta.svg);
  const droppedTag = Object.keys(tags).filter((t) => !KEEP_TAGS[t]).sort();
  const badPaths = droppedPaths(meta.svg);
  const gold = goldCells(meta.svg);
  const names = htmlNames(meta.html);
  const flags = htmlFlags(meta.html);
  const smil = /<animate/i.test(meta.svg) || /<set\b/i.test(meta.svg);
  const htmlOnly = meta.htmlKind === "html"
    && meta.html.length >= 200
    && !smil
    && meta.kind === "svg";
  return {
    id,
    kind: meta.kind,
    htmlKind: meta.htmlKind,
    name: meta.name,
    attrs: attrMap(meta.attributes),
    tags,
    droppedTag,
    droppedPathCount: badPaths.length,
    droppedPathSample: badPaths.slice(0, 3),
    gold: gold.length,
    smil,
    animate: (meta.svg.match(/<animate\b/gi) || []).length,
    rect: (meta.svg.match(/<rect\b/gi) || []).length,
    path: (meta.svg.match(/<path\b/gi) || []).length,
    green: (meta.svg.match(/#78ff4c/gi) || []).length,
    htmlNames: names,
    htmlFlags: flags,
    htmlOnly,
  };
}

function loadSnap() {
  if (!existsSync(SNAP)) return null;
  try {
    return JSON.parse(readFileSync(SNAP, "utf8"));
  } catch (_) {
    return null;
  }
}

const bin = readFileSync(BIN);
if (bin.length !== LAST_ID * SLOTS) throw new Error("traits.bin size " + bin.length);

const prev = loadSnap();
const canaries = pickCanaries(bin);
const fixedSet = new Set(canaries.fixed);

console.log("The Watch renderer check");
console.log("========================");

const rendererHex = await rpcCall("eth_call", [{ to: CONTRACT, data: "0x" + RENDERER }, "latest"]);
const renderer = decodeAddr(rendererHex);
let base = "";
try {
  const baseHex = await rpcCall("eth_call", [{ to: renderer, data: "0x" + BASE }, "latest"]);
  base = decodeAddr(baseHex);
} catch (_) {
  base = "";
}

const rendererState = prev && prev.renderer
  ? (shortAddr(prev.renderer) === renderer ? "same as last" : "NEW")
  : "baseline";
console.log("RENDERER  " + rendererState + "  " + renderer + "  (" + renderer.slice(-6) + ")");
if (base) console.log("BASE      " + base);

const traitIds = [...new Set([
  1, 17, 23, 174, 228, 5266, 7135, 7481, 7920, 8292, 8393, 9067, 6664, 9900, 9999,
  ...canaries.all,
])];
for (let i = 0; i < 24; i++) traitIds.push(1 + Math.floor(Math.random() * LAST_ID));
const uniqueTraits = [...new Set(traitIds)].sort((a, b) => a - b);

let drift = 0;
const driftIds = [];
for (const id of uniqueTraits) {
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
    driftIds.push(id);
  }
}
console.log("TRAITS    " + drift + " / " + uniqueTraits.length + " sampled differ"
  + (drift ? " — run node scripts/fetch-traits.mjs" : ""));
if (driftIds.length) console.log("          e.g. " + driftIds.slice(0, 8).join(", "));

const plates = [];
for (const id of canaries.all) {
  process.stdout.write("  tokenURI #" + id + " …\r");
  try {
    const meta = await loadUri(id);
    const row = censusOne(id, meta);
    row.fixed = fixedSet.has(id);
    plates.push(row);
  } catch (e) {
    plates.push({
      id,
      fixed: fixedSet.has(id),
      error: String(e.message || e).slice(0, 160),
      droppedTag: [],
      droppedPathCount: 0,
      htmlNames: [],
      htmlOnly: false,
      gold: 0,
      attrs: {},
    });
  }
}
process.stdout.write(" ".repeat(40) + "\r");

const allDropped = [];
const allHtml = new Set();
let smilPlates = 0;
let htmlPlates = 0;
for (const p of plates) {
  if (p.error) {
    console.log("SVG       #" + p.id + "  ERROR  " + p.error);
    continue;
  }
  if (p.smil) smilPlates += 1;
  if (p.htmlKind === "html") htmlPlates += 1;
  (p.htmlNames || []).forEach((n) => allHtml.add(n));
  if (p.droppedTag.length || p.droppedPathCount) {
    allDropped.push(p);
    console.log(
      "SVG       #" + p.id
      + (p.droppedTag.length ? "  would drop <" + p.droppedTag.join("> <") + ">" : "")
      + (p.droppedPathCount ? "  " + p.droppedPathCount + " non-square path(s)" : "")
    );
  }
}
if (!allDropped.length) {
  console.log("SVG       Watch keeps all tags/paths on " + plates.filter((p) => !p.error).length + " plates  (" + smilPlates + " with SMIL)");
} else {
  const types = [...new Set(allDropped.flatMap((p) => p.droppedTag || []))].sort();
  console.log("SVG       " + smilPlates + " plates with SMIL; dropped tag types: <" + types.join("> <") + ">");
}

const prevHtml = new Set((prev && prev.htmlNames) || []);
const newHtml = [...allHtml].filter((n) => prevHtml.size && !prevHtml.has(n));
const htmlList = [...allHtml];
const flagBits = [];
if (htmlList.some((n) => n === "FLEECE" || n === "var FLEECE")) flagBits.push("FLEECE");
if (htmlList.some((n) => n === "A.radio")) flagBits.push("A.radio");
if (htmlList.some((n) => n === "A.red")) flagBits.push("A.red");
if (htmlList.some((n) => n === "img gf.png")) flagBits.push("gf.png");
console.log("HTML      " + htmlPlates + " html players; names: " + (flagBits.join(", ") || "(none of FLEECE / A.radio / A.red / gf.png)"));
if (newHtml.length) {
  console.log("          NEW names: " + newHtml.slice(0, 24).join(", "));
}

const fleece = plates.find((p) => p.id === 5266) || plates.find((p) => /fleece/i.test((p.attrs && p.attrs.Crown) || ""));
if (fleece && !fleece.error) {
  const ok = fleece.gold >= 8;
  console.log(
    "FLEECE    #" + fleece.id + "  " + fleece.gold + " gold cells, "
    + fleece.animate + " <animate>  "
    + (fleece.htmlFlags && fleece.htmlFlags.fleece ? "HTML FLEECE present" : "HTML FLEECE absent")
    + (ok ? " — overlay should still run" : " — overlay would no-op")
  );
}

console.log("TWINS     your eyes:");
TWIN_LOOK.forEach((id) => {
  console.log("          https://argowatch.github.io/The-Watch/?id=" + id);
});

const prevById = Object.create(null);
((prev && prev.canaries) || []).forEach((p) => { prevById[p.id] = p; });
const prevTagTypes = new Set((prev && prev.droppedTagTypes) || []);
if (!prevTagTypes.size) {
  ((prev && prev.canaries) || []).forEach((p) => {
    (p.droppedTag || []).forEach((t) => prevTagTypes.add(t));
  });
}
const curTagTypes = new Set();
allDropped.forEach((p) => (p.droppedTag || []).forEach((t) => curTagTypes.add(t)));
const newTagTypes = [...curTagTypes].filter((t) => prev && prevTagTypes.size && !prevTagTypes.has(t));

const need = [];
if (drift) need.push("trait table drifted — run node scripts/fetch-traits.mjs then git push data/traits.bin");
for (const p of plates) {
  if (p.error) need.push("#" + p.id + " tokenURI failed — " + p.error);
  const before = prevById[p.id];
  if (p.fixed && prev) {
    const was = (before && before.droppedTag || []).join(",");
    const now = (p.droppedTag || []).join(",");
    if (now && now !== was) {
      need.push("#" + p.id + " SVG dropped tags changed: <" + (p.droppedTag || []).join("> <") + ">");
    }
    const wasPaths = before ? before.droppedPathCount || 0 : 0;
    if ((p.droppedPathCount || 0) > wasPaths) {
      need.push("#" + p.id + " SVG has " + p.droppedPathCount + " new non-square path(s) Watch would drop");
    }
    if (p.htmlOnly && !(before && before.htmlOnly) && !KNOWN_HTML_ONLY[p.id]) {
      need.push("#" + p.id + " HTML-only motion (still SVG on Watch) — new overlay?");
    }
  } else if (!prev && p.htmlOnly && !KNOWN_HTML_ONLY[p.id]) {
    need.push("#" + p.id + " HTML-only motion (still SVG on Watch) — new overlay?");
  }
}
if (newTagTypes.length) {
  need.push("new dropped SVG tag types: <" + newTagTypes.join("> <") + ">");
}
if (fleece && !fleece.error && fleece.gold < 8) {
  need.push("#" + fleece.id + " Fleece gold cells missing — overlay would no-op");
}
if (newHtml.length) {
  need.push("new HTML names vs last census: " + newHtml.slice(0, 12).join(", "));
}

const knownNotes = [];
for (const p of plates) {
  if (KNOWN_HTML_ONLY[p.id] && p.htmlOnly) knownNotes.push("#" + p.id + "  " + KNOWN_HTML_ONLY[p.id]);
}
if (allDropped.length) {
  knownNotes.push("Watch still drops clipPath/defs/use (Shades/Digital visor smoke) until the sanitizer keeps them");
}
if (rendererState === "NEW" && !need.length) {
  knownNotes.push("renderer address changed; pictures using squares / pixel-paths follow on their own");
}
if (!prev) knownNotes.push("first census written as baseline");

console.log("");
console.log("NEED A PERSON");
if (!need.length) console.log("  (none from this sample)");
else need.forEach((line) => console.log("  " + line));
if (knownNotes.length) {
  console.log("KNOWN");
  knownNotes.forEach((line) => console.log("  " + line));
}

const snap = {
  renderer,
  base,
  fetchedAt: new Date().toISOString(),
  canaries: plates.map((p) => ({
    id: p.id,
    fixed: !!p.fixed,
    kind: p.kind,
    htmlKind: p.htmlKind,
    droppedTag: p.droppedTag || [],
    droppedPathCount: p.droppedPathCount || 0,
    gold: p.gold || 0,
    smil: !!p.smil,
    htmlOnly: !!p.htmlOnly,
    htmlFlags: p.htmlFlags || {},
    attrs: p.attrs || {},
    error: p.error || "",
  })),
  droppedTagTypes: [...curTagTypes].sort(),
  htmlNames: [...allHtml].sort(),
  traitSample: uniqueTraits.length,
  traitDrift: drift,
};

writeFileSync(SNAP, JSON.stringify(snap, null, 2) + "\n");
console.log("");
console.log("wrote " + SNAP);

if (need.length) process.exit(1);
console.log("ok");
