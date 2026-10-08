(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});
  const MAX_ABI = 524288;
  const MAX_RECTS = 2048;
  const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const NUM = /^-?\d+(\.\d+)?$/;

  function hexToBytes(hex) {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (h.length % 2) throw new Error("odd hex");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function bytesToUtf8(bytes) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function decodeAbiString(hex) {
    if (!hex || hex === "0x") throw new Error("empty eth_call");
    const bytes = hexToBytes(hex);
    if (bytes.length < 64) throw new Error("short ABI string");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function readWord(offset) {
      if (offset + 32 > bytes.length) throw new Error("ABI overflow");
      for (let i = 0; i < 24; i++) {
        if (view.getUint8(offset + i) !== 0) throw new Error("ABI offset too large");
      }
      let n = 0;
      for (let i = 24; i < 32; i++) {
        n = n * 256 + view.getUint8(offset + i);
      }
      return n;
    }
    const offset = readWord(0);
    const length = readWord(offset);
    if (length > MAX_ABI) throw new Error("ABI string too large");
    const start = offset + 32;
    if (start + length > bytes.length) throw new Error("ABI string truncated");
    return bytesToUtf8(bytes.subarray(start, start + length));
  }

  function decodeDataUri(uri) {
    const m = /^data:([^,]*?),(.*)$/s.exec(uri);
    if (!m) return null;
    const meta = m[1];
    const payload = m[2];
    const isB64 = /;base64/i.test(meta);
    if (isB64) {
      try {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { meta, text: bytesToUtf8(bytes) };
      } catch (_) {
        return null;
      }
    }
    try {
      return { meta, text: decodeURIComponent(payload) };
    } catch (_) {
      return null;
    }
  }

  function extractSvg(image) {
    if (typeof image !== "string" || !image) {
      throw new Error("tokenURI image missing");
    }
    if (image.startsWith("data:")) {
      const decoded = decodeDataUri(image);
      if (!decoded) throw new Error("bad image data URI");
      if (!/<svg[\s>]/i.test(decoded.text)) {
        throw new Error("image data URI is not SVG");
      }
      return decoded.text;
    }
    if (/<svg[\s>]/i.test(image)) return image;
    throw new Error("unsupported image field");
  }

  function readImage(image) {
    const empty = { kind: "empty", svg: "", imageUri: "", animated: false };
    if (typeof image !== "string" || !image) return empty;
    if (image.startsWith("data:")) {
      const decoded = decodeDataUri(image);
      if (!decoded) return empty;
      const mime = String(decoded.meta || "");
      if (/image\/gif/i.test(mime)) {
        return { kind: "gif", svg: "", imageUri: image, animated: true };
      }
      if (/image\/(png|webp|jpe?g)/i.test(mime)) {
        return { kind: "raster", svg: "", imageUri: image, animated: false };
      }
      if (/svg/i.test(mime) || /<svg[\s>]/i.test(decoded.text)) {
        return {
          kind: "svg",
          svg: decoded.text,
          imageUri: "",
          animated: /<animate/i.test(decoded.text),
        };
      }
      return empty;
    }
    if (/<svg[\s>]/i.test(image)) {
      return {
        kind: "svg",
        svg: image,
        imageUri: "",
        animated: /<animate/i.test(image),
      };
    }
    return empty;
  }

  function metaFromTokenURI(uri) {
    let jsonText = uri;
    if (uri.startsWith("data:")) {
      const decoded = decodeDataUri(uri);
      if (!decoded) throw new Error("bad tokenURI data URI");
      jsonText = decoded.text;
    }
    if (jsonText.length > MAX_ABI) throw new Error("tokenURI too large");
    let meta;
    try {
      meta = JSON.parse(jsonText);
    } catch (_) {
      throw new Error("tokenURI JSON parse failed");
    }
    const attributes = [];
    if (Array.isArray(meta.attributes)) {
      meta.attributes.slice(0, 24).forEach(function (a) {
        if (!a || typeof a !== "object") return;
        const trait_type = typeof a.trait_type === "string" ? a.trait_type.slice(0, 64) : "";
        const value = a.value == null ? "" : String(a.value).slice(0, 96);
        if (trait_type) attributes.push({ trait_type: trait_type, value: value });
      });
    }
    const img = readImage(meta.image || meta.image_data || "");
    if (img.kind === "empty") throw new Error("tokenURI image missing");
    const fleece = parseFleeceBreath(meta.animation_url, attributes, img.svg);
    const html = playerHtml(meta.animation_url);
    return {
      svg: img.svg,
      imageUri: img.imageUri,
      kind: img.kind,
      animated: !!img.animated || !!(fleece && fleece.mask) || !!html,
      attributes: attributes,
      name: typeof meta.name === "string" ? meta.name.slice(0, 96) : "",
      fleece: fleece,
      html: html,
    };
  }

  function decodeDataHtml(uri) {
    if (typeof uri !== "string" || uri.indexOf("data:text/html") !== 0) return "";
    const decoded = decodeDataUri(uri);
    if (!decoded || !decoded.text) return "";
    if (decoded.text.length > 65536) return "";
    return decoded.text;
  }

  function playerHtml(uri) {
    if (typeof uri !== "string") return "";
    if (/^https?:/i.test(uri)) return "";
    if (uri.indexOf("data:text/html") !== 0) return "";
    const decoded = decodeDataUri(uri);
    if (!decoded || !decoded.text) return "";
    if (decoded.text.length > MAX_ABI) return "";
    return decoded.text;
  }

  function fleeceCrownName(attributes) {
    let crown = "";
    (attributes || []).forEach(function (a) {
      if (a && /^crown$/i.test(a.trait_type)) crown = String(a.value || "");
    });
    return crown;
  }

  function parseFleeceBreath(animationUrl, attributes, svgText) {
    const crown = fleeceCrownName(attributes);
    const html = decodeDataHtml(animationUrl);
    if (html && html.indexOf("FLEECE") >= 0) {
      const m = /var FLEECE = \[([0-9,\s]+)\]/.exec(html);
      if (m) {
        const mask = [];
        String(m[1]).split(/[,\s]+/).forEach(function (s) {
          if (!s) return;
          const n = Number(s);
          if (Number.isInteger(n) && n >= 0 && n < 576) mask.push(n);
        });
        if (mask.length >= 8) return { kind: "fleece", mask: mask, crown: crown };
      }
    }
    if (!/fleece/i.test(crown)) return null;
    const mask = parseFleeceMaskFromSvg(svgText);
    if (!mask) return null;
    return { kind: "fleece", mask: mask, crown: crown };
  }

  function svgFromTokenURI(uri) {
    return metaFromTokenURI(uri).svg;
  }

  const NS = "http://www.w3.org/2000/svg";

  function attr(el, name) {
    return el.getAttribute(name);
  }

  function copyNum(src, dest, name, max) {
    const v = attr(src, name);
    if (v == null || !NUM.test(v)) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) return;
    dest.setAttribute(name, String(n));
  }

  const ANIM_ATTR = [
    "attributeName",
    "attributeType",
    "values",
    "dur",
    "begin",
    "end",
    "repeatCount",
    "repeatDur",
    "calcMode",
    "keyTimes",
    "keySplines",
    "from",
    "to",
    "by",
    "type",
    "additive",
    "accumulate",
    "fill",
    "restart",
  ];
  const TRANSLATE = /^translate\(\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*\)$/;
  const PATH_PIECE = /M(-?\d+) (-?\d+)h(-?\d+)v(-?\d+)h(-?\d+)z/g;
  const PATH_SAFE = /^[Mhvz0-9\s-]+$/;

  function tagName(el) {
    return String(el && el.tagName || "").toLowerCase();
  }

  function safeId(v) {
    return v && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v) ? v : null;
  }

  function copyId(src, dest) {
    const id = safeId(attr(src, "id"));
    if (id) dest.setAttribute("id", id);
  }

  function copyOpacity(src, dest) {
    const opacity = attr(src, "opacity");
    if (opacity && NUM.test(opacity)) {
      const o = Number(opacity);
      if (o >= 0 && o <= 1) dest.setAttribute("opacity", String(o));
    }
  }

  function inheritedFill(el) {
    let n = el;
    while (n) {
      const fill = attr(n, "fill");
      if (fill && HEX.test(fill)) return fill;
      n = n.parentElement;
    }
    return null;
  }

  function copyAnimAttrs(src, dest) {
    copyId(src, dest);
    for (let k = 0; k < ANIM_ATTR.length; k++) {
      const name = ANIM_ATTR[k];
      const v = src.getAttribute(name);
      if (v == null || v === "") continue;
      if (/url\s*\(|javascript:/i.test(v)) continue;
      dest.setAttribute(name, v);
    }
    if (!dest.getAttribute("attributeType") && dest.getAttribute("attributeName")) {
      dest.setAttribute("attributeType", "XML");
    }
  }

  function copyAnim(src, dest) {
    const kids = src.children;
    if (!kids || !kids.length) return;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      const tag = tagName(kid);
      if (tag !== "animate" && tag !== "animatetransform") continue;
      const a = document.createElementNS(NS, tag === "animatetransform" ? "animateTransform" : "animate");
      copyAnimAttrs(kid, a);
      if (a.getAttribute("attributeName")) dest.appendChild(a);
    }
  }

  function copySet(src, destParent) {
    const a = document.createElementNS(NS, "set");
    copyAnimAttrs(src, a);
    if (a.getAttribute("attributeName")) destParent.appendChild(a);
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
      out.push({ x: x, y: y, w: w, h: h });
      if (out.length > 576) return null;
    }
    if (!out.length || last !== d.length) return null;
    return out;
  }

  function parseFleeceMaskFromSvg(svgText) {
    if (!svgText) return null;
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
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        for (let y = 0; y < c.h; y++) {
          for (let x = 0; x < c.w; x++) addCell(c.x + x, c.y + y);
        }
      }
    }
    const pathRe = /<path\b([^>]*)>/g;
    let m;
    while ((m = pathRe.exec(svgText))) {
      const a = m[1];
      if (!/#ffdc78/i.test(a)) continue;
      const d = /\bd="([^"]+)"/.exec(a);
      if (d) addRects(pixelRectsFromD(d[1]));
    }
    const rectRe = /<rect\b([^>]*)>/g;
    while ((m = rectRe.exec(svgText))) {
      const a = m[1];
      if (!/#ffdc78/i.test(a)) continue;
      const x = attrNum(a, "x");
      const y = attrNum(a, "y");
      const w = attrNum(a, "width");
      const h = attrNum(a, "height");
      if (x == null || y == null || w == null || h == null) continue;
      addRects([{ x: x, y: y, w: w, h: h }]);
    }
    return mask.length >= 8 ? mask : null;
  }

  function localHref(v) {
    const m = /^#([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(String(v || ""));
    return m ? m[1] : null;
  }

  function hrefOf(el) {
    return attr(el, "href") || (el.getAttributeNS && el.getAttributeNS("http://www.w3.org/1999/xlink", "href")) || "";
  }

  function emitRects(cells, destParent, opts) {
    if (!cells || !cells.length) return;
    const fill = opts && opts.fill;
    const fo = opts && opts.fo;
    const id = opts && opts.id;
    const animSrc = opts && opts.animSrc;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const dest = document.createElementNS(NS, "rect");
      if (i === 0 && id) dest.setAttribute("id", id);
      dest.setAttribute("x", String(c.x));
      dest.setAttribute("y", String(c.y));
      dest.setAttribute("width", String(c.w));
      dest.setAttribute("height", String(c.h));
      const cellFill = c.fill || fill;
      const cellFo = c.fo != null && c.fo !== "" ? c.fo : fo;
      if (cellFill) dest.setAttribute("fill", cellFill);
      if (cellFo) dest.setAttribute("fill-opacity", cellFo);
      if (i === 0 && animSrc) copyAnim(animSrc, dest);
      destParent.appendChild(dest);
    }
  }

  function cellsFromDefGroup(el) {
    const inherit = HEX.test(attr(el, "fill")) ? attr(el, "fill") : "";
    const out = [];
    const kids = el.children;
    if (!kids) return out;
    for (let k = 0; k < kids.length; k++) {
      const kid = kids[k];
      const kt = tagName(kid);
      let piece = null;
      if (kt === "path") {
        piece = pixelRectsFromD(attr(kid, "d") || "");
      } else if (kt === "rect") {
        const x = Number(attr(kid, "x"));
        const y = Number(attr(kid, "y"));
        const w = Number(attr(kid, "width"));
        const h = Number(attr(kid, "height"));
        if ([x, y, w, h].every(function (n) { return Number.isFinite(n) && n >= 0; }) && w >= 1 && h >= 1 && x + w <= 24 && y + h <= 24) {
          piece = [{ x: x, y: y, w: w, h: h }];
        }
      }
      if (!piece) continue;
      const fill = HEX.test(attr(kid, "fill")) ? attr(kid, "fill") : inherit;
      let fo = null;
      const opacity = attr(kid, "fill-opacity");
      if (opacity && NUM.test(opacity)) {
        const o = Number(opacity);
        if (o >= 0 && o <= 1) fo = String(o);
      }
      for (let p = 0; p < piece.length; p++) {
        out.push({ x: piece[p].x, y: piece[p].y, w: piece[p].w, h: piece[p].h, fill: fill || null, fo: fo });
      }
    }
    return out;
  }

  function indexDefs(root) {
    const map = Object.create(null);
    const bags = root.getElementsByTagName("defs");
    for (let b = 0; b < bags.length; b++) {
      const kids = bags[b].children;
      if (!kids) continue;
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        const id = safeId(attr(el, "id"));
        if (!id) continue;
        const t = tagName(el);
        if (t === "path") {
          const cells = pixelRectsFromD(attr(el, "d") || "");
          if (cells) map[id] = cells;
        } else if (t === "rect") {
          const x = Number(attr(el, "x"));
          const y = Number(attr(el, "y"));
          const w = Number(attr(el, "width"));
          const h = Number(attr(el, "height"));
          if ([x, y, w, h].every(function (n) { return Number.isFinite(n) && n >= 0; }) && w >= 1 && h >= 1 && x + w <= 24 && y + h <= 24) {
            map[id] = [{ x: x, y: y, w: w, h: h }];
          }
        } else if (t === "g") {
          const cells = cellsFromDefGroup(el);
          if (cells && cells.length) map[id] = cells;
        }
      }
    }
    return map;
  }

  function parseCssAnims(root) {
    const frames = Object.create(null);
    const klass = Object.create(null);
    const sheets = root.getElementsByTagName("style");
    for (let s = 0; s < sheets.length; s++) {
      const css = String(sheets[s].textContent || "");
      if (!css || /url\s*\(|javascript:|@import|expression\s*\(/i.test(css)) continue;
      const kfRe = /@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)\s*\{/g;
      let m;
      while ((m = kfRe.exec(css))) {
        const name = m[1];
        let i = kfRe.lastIndex;
        let depth = 1;
        while (i < css.length && depth) {
          if (css[i] === "{") depth += 1;
          else if (css[i] === "}") depth -= 1;
          i += 1;
        }
        const body = css.slice(kfRe.lastIndex, i - 1);
        kfRe.lastIndex = i;
        const stops = [];
        const stopRe = /([\d.]+)%\s*\{([^}]*)\}/g;
        let sm;
        while ((sm = stopRe.exec(body))) {
          const pct = Number(sm[1]);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
          const block = sm[2];
          const opM = /opacity\s*:\s*([\d.]+)/.exec(block);
          const trM = /translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)/.exec(block);
          const stop = { pct: pct };
          if (opM) {
            const op = Number(opM[1]);
            if (!Number.isFinite(op) || op < 0 || op > 1) continue;
            stop.op = op;
          }
          if (trM) {
            stop.tx = Number(trM[1]);
            stop.ty = Number(trM[2]);
            if (!Number.isFinite(stop.tx) || !Number.isFinite(stop.ty)) continue;
          }
          if (stop.op == null && stop.tx == null) continue;
          stops.push(stop);
        }
        if (stops.length >= 2 && stops.length <= 80) {
          stops.sort(function (a, b) { return a.pct - b.pct; });
          frames[name] = stops;
        }
      }
      const classRe = /\.([A-Za-z_][A-Za-z0-9_-]*)\s*\{([^}]+)\}/g;
      let cm;
      while ((cm = classRe.exec(css))) {
        const body = cm[2];
        if (/url\s*\(|javascript:/i.test(body)) continue;
        const spec = klass[cm[1]] || (klass[cm[1]] = {});
        const nameM = /animation-name\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(body);
        if (nameM) spec.name = nameM[1];
        const shortM = /animation\s*:\s*(?:([A-Za-z_][A-Za-z0-9_-]*)\s+)?([\d.]+)s\s+(step-end|step-start|linear)\s+infinite/.exec(body);
        if (shortM) {
          if (shortM[1]) spec.name = shortM[1];
          spec.dur = shortM[2] + "s";
          spec.calcMode = shortM[3] === "linear" ? "linear" : "discrete";
        }
        const opM = /(?:^|;)\s*opacity\s*:\s*([\d.]+)/.exec(";" + body);
        if (opM) {
          const op = Number(opM[1]);
          if (Number.isFinite(op) && op >= 0 && op <= 1) spec.restOp = op;
        }
      }
    }
    return { frames: frames, klass: klass };
  }

  function cssKeyTimes(stops) {
    const times = [];
    const ops = [];
    const txs = [];
    const tys = [];
    let hasT = false;
    let lastOp = 0;
    let lastTx = 0;
    let lastTy = 0;
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      let t = st.pct / 100;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      if (times.length && t <= times[times.length - 1]) continue;
      if (st.op != null) lastOp = st.op;
      if (st.tx != null) {
        lastTx = st.tx;
        lastTy = st.ty;
        hasT = true;
      }
      times.push(t);
      ops.push(lastOp);
      txs.push(lastTx);
      tys.push(lastTy);
    }
    if (!times.length) return null;
    if (times[0] !== 0) {
      times.unshift(0);
      ops.unshift(0);
      txs.unshift(txs[0]);
      tys.unshift(tys[0]);
    }
    if (times[times.length - 1] < 1) {
      times.push(1);
      ops.push(lastOp);
      txs.push(lastTx);
      tys.push(lastTy);
    }
    if (ops.length < 2) return null;
    return { times: times, ops: ops, txs: txs, tys: tys, hasT: hasT };
  }

  function attachCssAnim(src, dest, ctx) {
    if (!ctx || !ctx.css || !ctx.css.klass) return;
    const classes = String(attr(src, "class") || "").split(/\s+/).filter(Boolean);
    if (!classes.length) return;
    const merged = {};
    for (let i = 0; i < classes.length; i++) {
      const spec = ctx.css.klass[classes[i]];
      if (!spec) continue;
      if (spec.name) merged.name = spec.name;
      if (spec.dur) merged.dur = spec.dur;
      if (spec.calcMode) merged.calcMode = spec.calcMode;
      if (spec.restOp != null) merged.restOp = spec.restOp;
    }
    const stops = merged.name && ctx.css.frames[merged.name];
    if (!stops || !merged.dur) return;
    const pack = cssKeyTimes(stops);
    if (!pack) return;
    let begin = null;
    const st = attr(src, "style") || "";
    if (st && !/url\s*\(|javascript:/i.test(st)) {
      const dm = /animation-delay\s*:\s*(-?\d+(?:\.\d+)?)s/.exec(st);
      if (dm) begin = dm[1] + "s";
    }
    if (merged.restOp != null) dest.setAttribute("opacity", String(merged.restOp));
    const times = pack.times.map(function (t) { return String(Number(t.toFixed(6))); }).join(";");
    const a = document.createElementNS(NS, "animate");
    a.setAttribute("attributeName", "opacity");
    a.setAttribute("attributeType", "XML");
    a.setAttribute("values", pack.ops.join(";"));
    a.setAttribute("keyTimes", times);
    a.setAttribute("dur", merged.dur);
    a.setAttribute("calcMode", merged.calcMode || "discrete");
    a.setAttribute("repeatCount", "indefinite");
    if (begin) a.setAttribute("begin", begin);
    dest.appendChild(a);
    if (pack.hasT) {
      const tr = document.createElementNS(NS, "animateTransform");
      tr.setAttribute("attributeName", "transform");
      tr.setAttribute("type", "translate");
      tr.setAttribute("values", pack.txs.map(function (x, i) { return x + " " + pack.tys[i]; }).join(";"));
      tr.setAttribute("keyTimes", times);
      tr.setAttribute("dur", merged.dur);
      tr.setAttribute("calcMode", merged.calcMode || "discrete");
      tr.setAttribute("additive", "sum");
      tr.setAttribute("repeatCount", "indefinite");
      if (begin) tr.setAttribute("begin", begin);
      dest.appendChild(tr);
    }
  }

  function copyClipPath(src, destParent) {
    const id = safeId(attr(src, "id"));
    if (!id) return;
    const cp = document.createElementNS(NS, "clipPath");
    cp.setAttribute("id", id);
    const kids = src.children;
    if (kids) {
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        const t = tagName(el);
        if (t === "path") {
          const cells = pixelRectsFromD(attr(el, "d") || "");
          if (cells) emitRects(cells, cp, {});
        } else if (t === "rect") {
          const x = Number(attr(el, "x"));
          const y = Number(attr(el, "y"));
          const w = Number(attr(el, "width"));
          const h = Number(attr(el, "height"));
          if ([x, y, w, h].every(function (n) { return Number.isFinite(n) && n >= 0; }) && w >= 1 && h >= 1) {
            emitRects([{ x: x, y: y, w: w, h: h }], cp, {});
          }
        }
      }
    }
    if (cp.childNodes.length) destParent.appendChild(cp);
  }

  function copyUse(src, destParent, ctx) {
    if (!ctx || !ctx.defs) return;
    const href = localHref(hrefOf(src));
    if (!href || !ctx.defs[href]) return;
    const cells = ctx.defs[href];
    const fill = inheritedFill(src);
    let anyFill = !!fill;
    if (!anyFill) {
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].fill) {
          anyFill = true;
          break;
        }
      }
    }
    if (!anyFill) return;
    const wrap = document.createElementNS(NS, "g");
    attachCssAnim(src, wrap, ctx);
    if (wrap.childNodes.length) {
      emitRects(cells, wrap, { fill: fill });
      destParent.appendChild(wrap);
      return;
    }
    emitRects(cells, destParent, { fill: fill, animSrc: src });
  }

  function copyPath(src, destParent) {
    const fill = inheritedFill(src);
    if (!fill) return;
    if (attr(src, "transform") || attr(src, "clip-path") || attr(src, "href") || attr(src, "xlink:href")) return;
    const cells = pixelRectsFromD(attr(src, "d") || "");
    if (!cells) return;
    const opacity = attr(src, "fill-opacity");
    let fo = null;
    if (opacity && NUM.test(opacity)) {
      const o = Number(opacity);
      if (o >= 0 && o <= 1) fo = String(o);
    }
    emitRects(cells, destParent, {
      fill: fill,
      fo: fo,
      id: safeId(attr(src, "id")),
      animSrc: src,
    });
  }

  function copyRect(src, destParent) {
    const fill = inheritedFill(src);
    if (!fill) return;
    const dest = document.createElementNS(NS, "rect");
    copyId(src, dest);
    copyNum(src, dest, "x", 24);
    copyNum(src, dest, "y", 24);
    copyNum(src, dest, "width", 24);
    copyNum(src, dest, "height", 24);
    dest.setAttribute("fill", fill);
    const opacity = attr(src, "fill-opacity");
    if (opacity && NUM.test(opacity)) {
      const o = Number(opacity);
      if (o >= 0 && o <= 1) dest.setAttribute("fill-opacity", String(o));
    }
    copyAnim(src, dest);
    destParent.appendChild(dest);
  }

  function copyG(src, destParent, ctx) {
    const g = document.createElementNS(NS, "g");
    copyId(src, g);
    copyOpacity(src, g);
    const tr = attr(src, "transform");
    if (tr && TRANSLATE.test(tr)) g.setAttribute("transform", tr);
    const clip = attr(src, "clip-path");
    if (clip) {
      const cm = /^url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)$/.exec(clip);
      if (cm) g.setAttribute("clip-path", "url(#" + cm[1] + ")");
    }
    copyAnim(src, g);
    attachCssAnim(src, g, ctx);
    walkKids(src, g, ctx);
    if (g.childNodes.length) destParent.appendChild(g);
  }

  function walkKids(src, destParent, ctx) {
    const kids = src.children;
    if (!kids || !kids.length) return;
    for (let i = 0; i < kids.length; i++) {
      const tag = tagName(kids[i]);
      if (tag === "animate" || tag === "animatetransform") continue;
      walkNode(kids[i], destParent, ctx);
    }
  }

  function walkNode(src, destParent, ctx) {
    const tag = tagName(src);
    if (tag === "rect") copyRect(src, destParent);
    else if (tag === "path") copyPath(src, destParent);
    else if (tag === "set") copySet(src, destParent);
    else if (tag === "g") copyG(src, destParent, ctx);
    else if (tag === "use") copyUse(src, destParent, ctx);
    else if (tag === "clippath") copyClipPath(src, destParent);
    else if (tag === "svg") walkKids(src, destParent, ctx);
  }

  function sanitizeSvg(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
      throw new Error("SVG parse failed");
    }
    const clean = document.createElementNS(NS, "svg");
    clean.setAttribute("xmlns", NS);
    clean.setAttribute("viewBox", "0 0 24 24");
    clean.setAttribute("width", "24");
    clean.setAttribute("height", "24");
    clean.setAttribute("shape-rendering", "crispEdges");
    const ctx = { defs: indexDefs(root), css: parseCssAnims(root) };
    walkNode(root, clean, ctx);
    if (!clean.getElementsByTagName("rect").length) throw new Error("SVG sanitizer dropped all rects");
    const xml = new XMLSerializer().serializeToString(clean);
    const again = new DOMParser().parseFromString(xml, "image/svg+xml");
    const out = again.documentElement;
    if (!out || out.nodeName.toLowerCase() !== "svg" || again.querySelector("parsererror")) {
      return clean;
    }
    return out;
  }

  function attrNum(attrs, name) {
    const m = new RegExp("(?:^|\\s)" + name + "=\"([^\"]+)\"").exec(attrs);
    if (!m || !NUM.test(m[1])) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  function rectsFromSvg(svgText) {
    const out = [];
    const re = /<rect\b([^>]*)>/g;
    let m;
    while ((m = re.exec(svgText || "")) && out.length < MAX_RECTS) {
      const attrs = m[1];
      const fillM = /\bfill="(#[0-9A-Fa-f]{3,6})"/.exec(attrs);
      if (!fillM || !HEX.test(fillM[1])) continue;
      const x = attrNum(attrs, "x");
      const y = attrNum(attrs, "y");
      const w = attrNum(attrs, "width");
      const h = attrNum(attrs, "height");
      if (x == null || y == null || w == null || h == null) continue;
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x >= 24 || y >= 24) continue;
      if (x + w > 24 || y + h > 24) continue;
      const op = attrNum(attrs, "fill-opacity");
      out.push({
        x: x,
        y: y,
        w: w,
        h: h,
        fill: fillM[1],
        opacity: op == null ? 1 : Math.max(0, Math.min(1, op)),
      });
    }
    return out;
  }

  function isBwDot(r) {
    if (!r || r.w !== 1 || r.h !== 1) return false;
    const fill = String(r.fill).toLowerCase();
    return fill === "#000000" || fill === "#ffffff" || fill === "#000" || fill === "#fff";
  }

  function isPrintStamp(r) {
    const o = r.opacity == null ? 1 : r.opacity;
    // Fleet watermark is 1×1 black/white at ~0.11–0.14. Fainter #000 cells are paint (e.g. Fleece wool).
    if (o < 0.1 || o > 0.16) return false;
    return isBwDot(r);
  }

  function isFaintInk(r) {
    const o = r.opacity == null ? 1 : r.opacity;
    if (o >= 0.1) return false;
    return isBwDot(r);
  }

  function frameIsFate(frame) {
    if (!frame) return false;
    if (frame.kind === "gif") return true;
    const attrs = frame.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      const t = String(attrs[i] && attrs[i].trait_type || "");
      const v = String(attrs[i] && attrs[i].value || "");
      if (/^fate$/i.test(t) && /burn/i.test(v)) return true;
    }
    return false;
  }

  function hexRgb(hex) {
    if (!HEX.test(hex)) return null;
    const h = hex.slice(1);
    const p = h.length === 3
      ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
      : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    return p.map(function (x) { return parseInt(x, 16); });
  }

  function needsPaperWell(svgText) {
    const rects = rectsFromSvg(svgText || "");
    let n = 0;
    let sum = 0;
    for (let i = 0; i < rects.length; i++) {
      const rgb = hexRgb(rects[i].fill);
      if (!rgb) continue;
      const cells = Math.max(1, Math.floor(rects[i].w) * Math.floor(rects[i].h));
      sum += (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) * cells;
      n += cells;
    }
    if (!n) return false;
    return sum / (n * 255) < 0.22;
  }

  const WELL = Object.create(null);
  const PAPER_NAME = /death|corsair|eye\s*patch|void|black|woodpipe|wood\s*pipe|\bpipe\b|shadow|obsidian|fleece/;

  function wellIsPaper(slot, value, svgText) {
    const v = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    const s = String(slot || "").toLowerCase();
    const key = s + ":" + v;
    if (Object.prototype.hasOwnProperty.call(WELL, key)) return WELL[key];
    const paper = PAPER_NAME.test(v) || needsPaperWell(svgText);
    WELL[key] = paper;
    return paper;
  }

  function svgToCanvas(svgText) {
    const c = document.createElement("canvas");
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(24, 24);
    const d = img.data;
    rectsFromSvg(svgText).forEach(function (r) {
      const rgb = hexRgb(r.fill);
      if (!rgb) return;
      const o = r.opacity == null ? 1 : r.opacity;
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(24, Math.ceil(r.x + r.w));
      const y1 = Math.min(24, Math.ceil(r.y + r.h));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * 24 + x) * 4;
          d[i] = Math.round(rgb[0] * o + d[i] * (1 - o));
          d[i + 1] = Math.round(rgb[1] * o + d[i + 1] * (1 - o));
          d[i + 2] = Math.round(rgb[2] * o + d[i + 2] * (1 - o));
          d[i + 3] = 255;
        }
      }
    });
    ctx.putImageData(img, 0, 0);
    return c;
  }

  TS.decode = {
    HEX: HEX,
    decodeAbiString: decodeAbiString,
    svgFromTokenURI: svgFromTokenURI,
    metaFromTokenURI: metaFromTokenURI,
    sanitizeSvg: sanitizeSvg,
    rectsFromSvg: rectsFromSvg,
    hexRgb: hexRgb,
    needsPaperWell: needsPaperWell,
    wellIsPaper: wellIsPaper,
    svgToCanvas: svgToCanvas,
    isPrintStamp: isPrintStamp,
    isFaintInk: isFaintInk,
    frameIsFate: frameIsFate,
    parseFleeceBreath: parseFleeceBreath,
  };
})(window);
