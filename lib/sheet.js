(function (global) {
  "use strict";
  const TS = (global.TheScore = global.TheScore || {});

  // Site colors (styles.css) as PDF RGB 0-1.
  const C = {
    bg: [0.047, 0.039, 0.031],       // --bg #0c0a08
    ink: [0.902, 0.863, 0.784],      // --ink #e6dcc8
    muted: [0.549, 0.498, 0.416],    // --muted #8c7f6a
    gold: [0.776, 0.639, 0.353],     // --gold #c6a35a
    dim: [0.431, 0.353, 0.196],      // --gold-dim #6e5a32
    paper: [1, 1, 1],
    line: [0.431, 0.353, 0.196],
    lineSoft: [0.620, 0.545, 0.400],
  };

  function pdfEscape(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function hexRgb(hex) {
    const rgb = TS.decode.hexRgb(hex);
    if (!rgb) return null;
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  }

  function buildPdf(id, svgText) {
    const rects = TS.decode.rectsFromSvg(svgText || "");
    const fills = [];
    const seen = {};
    rects.forEach(function (r) {
      const k = r.fill.toLowerCase();
      if (!seen[k]) {
        seen[k] = true;
        fills.push(r.fill);
      }
    });
    const ground = fills[0] || "#111111";

    const W = 612, H = 792;
    const cell = 16;
    const n = 24;
    const grid = n * cell;
    const gx = 108;
    const gy = 300;
    const mat = 16;
    const wx = gx - mat;
    const wy = gy - mat;
    const ww = grid + mat * 2;
    const wh = grid + mat * 2;
    const lines = [];

    function fill(rgb) {
      lines.push(rgb[0].toFixed(3) + " " + rgb[1].toFixed(3) + " " + rgb[2].toFixed(3) + " rg");
    }
    function stroke(rgb, w) {
      lines.push(rgb[0].toFixed(3) + " " + rgb[1].toFixed(3) + " " + rgb[2].toFixed(3) + " RG " + w + " w");
    }
    function t(x, y, size, str, font) {
      lines.push(
        "BT /" + (font || "F1") + " " + size + " Tf " + x.toFixed(1) + " " + y.toFixed(1) + " Td (" + pdfEscape(str) + ") Tj ET"
      );
    }
    function rule(x1, y1, x2, y2) {
      lines.push(x1.toFixed(1) + " " + y1.toFixed(1) + " m " + x2.toFixed(1) + " " + y2.toFixed(1) + " l S");
    }

    fill(C.bg);
    lines.push("0 0 " + W + " " + H + " re f");

    fill(C.gold);
    t(wx, 758, 8, "THE WATCH", "F2");
    fill(C.ink);
    t(wx, 736, 16, "ARGONAUT  #" + String(id).padStart(4, "0"));
    fill(C.muted);
    t(wx, 718, 7, "24 x 24   /   one cell = one pixel on Ethereum");
    stroke(C.dim, 0.4);
    rule(wx, 708, wx + ww, 708);

    fill(C.paper);
    lines.push(wx + " " + wy + " " + ww + " " + wh + " re f");

    for (let i = 0; i <= n; i++) {
      const major = i % 6 === 0;
      stroke(major ? C.line : C.lineSoft, major ? 0.65 : 0.3);
      const p = gx + i * cell;
      const q = gy + i * cell;
      rule(gx, q, gx + grid, q);
      rule(p, gy, p, gy + grid);
    }

    fill(C.muted);
    for (let i = 0; i < n; i++) {
      const row = String(i);
      const col = String(i);
      const rowX = gx - 22 - (row.length > 1 ? 4 : 0);
      t(rowX, gy + (n - i) * cell - 11, 6, row);
      t(gx + i * cell + (i < 10 ? 5 : 2), gy - 26, 6, col);
    }

    let y = gy - 48;
    fill(C.gold);
    t(wx, y, 7, "TO THE COLORIST");
    y -= 14;
    fill(C.ink);
    const notes = [
      "Copy the reference at right, one cell at a time.",
      "The white field is 24 x 24. Fill every cell.",
      "Start with the ground (Palette): " + ground,
      "Then copy the figure from the reference.",
      "Use Draw mode on The Watch to see a pixel",
      "by pixel rendition of this Argonaut.",
    ];
    notes.forEach(function (line) {
      t(wx, y, 8, line);
      y -= 11;
    });

    fill(hexRgb(ground) || C.muted);
    lines.push((wx) + " " + (y - 2) + " 8 8 re f");
    stroke(C.dim, 0.4);
    lines.push((wx) + " " + (y - 2) + " 8 8 re S");
    fill(C.muted);
    t(wx + 12, y, 7, ground + "  ground  /  " + rects.length + " rects  /  " + fills.length + " hexes");

    const ref = 6;
    const rx = wx + ww - n * ref;
    const ry = gy - 58 - n * ref;
    fill(C.gold);
    t(rx, ry + n * ref + 10, 7, "REFERENCE");
    rects.forEach(function (r) {
      const rgb = hexRgb(r.fill);
      if (!rgb) return;
      fill(rgb);
      const x = rx + r.x * ref;
      const yb = ry + (n - r.y - r.h) * ref;
      lines.push(x.toFixed(1) + " " + yb.toFixed(1) + " " + (r.w * ref).toFixed(1) + " " + (r.h * ref).toFixed(1) + " re f");
    });
    stroke(C.dim, 0.5);
    lines.push(rx.toFixed(1) + " " + ry.toFixed(1) + " " + (n * ref) + " " + (n * ref) + " re S");

    fill(C.dim);
    const footer = "unofficial  /  art and copyright stay with ACK / Muse Facktory  /  not affiliated";
    const footerW = footer.length * 5 * 0.5;
    t(wx + (ww - footerW) / 2, 22, 5, footer);

    const stream = lines.join("\n") + "\n";
    const streamObj = "<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream";
    const objs = [
      null,
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
      streamObj,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ];
    let out = "%PDF-1.4\n";
    const xref = [0];
    for (let i = 1; i < objs.length; i++) {
      xref.push(out.length);
      out += i + " 0 obj\n" + objs[i] + "\nendobj\n";
    }
    const startxref = out.length;
    out += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
    for (let i = 1; i < objs.length; i++) {
      out += String(xref[i]).padStart(10, "0") + " 00000 n \n";
    }
    out += "trailer << /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + startxref + "\n%%EOF";
    return out;
  }

  function download(id, svgText) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > 9999) return;
    if (!svgText) return;
    const pdf = buildPdf(n, svgText);
    const blob = new Blob([pdf], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "argonaut-" + String(n).padStart(4, "0") + "-24x24.pdf";
    a.rel = "noreferrer";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  TS.sheet = { download: download, buildPdf: buildPdf };
})(window);
