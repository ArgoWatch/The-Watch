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
    return {
      svg: extractSvg(meta.image || meta.image_data || ""),
      attributes: attributes,
      name: typeof meta.name === "string" ? meta.name.slice(0, 96) : "",
    };
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

    const rects = root.getElementsByTagName("rect");
    if (!rects.length) throw new Error("SVG has no rects");
    for (let i = 0; i < rects.length; i++) {
      const src = rects[i];
      const fill = attr(src, "fill");
      if (!fill || !HEX.test(fill)) continue;
      const dest = document.createElementNS(NS, "rect");
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
      clean.appendChild(dest);
    }
    if (!clean.childNodes.length) throw new Error("SVG sanitizer dropped all rects");
    return clean;
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
      out.push({ x: x, y: y, w: w, h: h, fill: fillM[1] });
    }
    return out;
  }

  function hexRgb(hex) {
    if (!HEX.test(hex)) return null;
    const h = hex.slice(1);
    const p = h.length === 3
      ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
      : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    return p.map(function (x) { return parseInt(x, 16); });
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
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(24, Math.ceil(r.x + r.w));
      const y1 = Math.min(24, Math.ceil(r.y + r.h));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * 24 + x) * 4;
          d[i] = rgb[0];
          d[i + 1] = rgb[1];
          d[i + 2] = rgb[2];
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
    svgToCanvas: svgToCanvas,
  };
})(window);
