// Renders Task 1 visuals (generated as JSON by Claude) into SVG/HTML, styled like an IELTS paper.
const COLORS = ["#1f4e9c", "#d9822b", "#2e8b57", "#b22222", "#6a4c93", "#008b8b", "#8b6914"];
const DASH = ["", "6 4", "2 3", "10 4 2 4", "", "6 4", ""];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-GB") : +Number(n).toFixed(2) + "");

function niceTicks(min, max, count = 6) {
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function legend(names, x, y, kind) {
  return names
    .map((n, i) => {
      const yy = y + i * 20;
      const sw =
        kind === "line"
          ? `<line x1="${x}" y1="${yy}" x2="${x + 24}" y2="${yy}" stroke="${COLORS[i % 7]}" stroke-width="2.5" stroke-dasharray="${DASH[i % 7]}"/><circle cx="${x + 12}" cy="${yy}" r="3" fill="${COLORS[i % 7]}"/>`
          : `<rect x="${x + 4}" y="${yy - 6}" width="14" height="12" fill="${COLORS[i % 7]}"/>`;
      return `${sw}<text x="${x + 30}" y="${yy + 4}" class="lg">${esc(n)}</text>`;
    })
    .join("");
}

function axes(v, kind) {
  const cats = v.categories || [];
  const series = (v.series || []).filter((s) => Array.isArray(s.values));
  const all = series.flatMap((s) => s.values).filter((n) => Number.isFinite(n));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1));
  const W = 640, H = 380, L = 64, T = 20, B = 60;
  const legendW = series.length > 1 || kind === "line" ? 150 : 0;
  const R = 20 + legendW;
  const pw = W - L - R, ph = H - T - B;
  const y = (val) => T + ph - ((val - ticks[0]) / (ticks.at(-1) - ticks[0])) * ph;
  let g = "";
  for (const t of ticks) g += `<line x1="${L}" x2="${L + pw}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${fmt(t)}</text>`;
  g += `<line x1="${L}" x2="${L}" y1="${T}" y2="${T + ph}" class="axis"/><line x1="${L}" x2="${L + pw}" y1="${y(Math.max(0, ticks[0]))}" y2="${y(Math.max(0, ticks[0]))}" class="axis"/>`;
  const n = cats.length || 1;
  const band = pw / n;
  const cx = (i) => (kind === "line" ? L + (n === 1 ? pw / 2 : (i * pw) / (n - 1)) : L + band * i + band / 2);
  const rotate = cats.some((c) => String(c).length > 9) && n > 4;
  cats.forEach((c, i) => {
    g += rotate
      ? `<text transform="translate(${cx(i)},${T + ph + 14}) rotate(-30)" class="tick" text-anchor="end">${esc(c)}</text>`
      : `<text x="${cx(i)}" y="${T + ph + 18}" class="tick" text-anchor="middle">${esc(c)}</text>`;
  });
  if (v.yLabel || v.unit) g += `<text transform="translate(16,${T + ph / 2}) rotate(-90)" class="axlabel" text-anchor="middle">${esc(v.yLabel || v.unit)}</text>`;
  if (v.xLabel) g += `<text x="${L + pw / 2}" y="${H - 8}" class="axlabel" text-anchor="middle">${esc(v.xLabel)}</text>`;

  if (kind === "line") {
    series.forEach((s, si) => {
      const pts = s.values.map((val, i) => [cx(i), y(val)]).filter((p) => Number.isFinite(p[1]));
      g += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${COLORS[si % 7]}" stroke-width="2.5" stroke-dasharray="${DASH[si % 7]}"/>`;
      g += pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${COLORS[si % 7]}"/>`).join("");
    });
  } else {
    const k = series.length || 1;
    const bw = Math.min(40, (band * 0.75) / k);
    const zero = y(Math.max(0, ticks[0]));
    series.forEach((s, si) => {
      s.values.forEach((val, i) => {
        if (!Number.isFinite(val)) return;
        const x = cx(i) - (bw * k) / 2 + si * bw;
        const top = Math.min(y(val), zero);
        g += `<rect x="${x}" y="${top}" width="${bw - 1}" height="${Math.abs(zero - y(val))}" fill="${COLORS[si % 7]}"/>`;
      });
    });
  }
  if (legendW) g += legend(series.map((s) => s.name), W - legendW + 4, T + 10, kind);
  return `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px" class="chart" role="img" aria-label="${esc(v.title)}">${g}</svg>`;
}

function pies(v) {
  const cats = v.categories || [];
  const series = v.series || [];
  const R = 95, cell = 250;
  const W = Math.max(cell * series.length, 260) + 170, H = 280;
  let g = "";
  series.forEach((s, si) => {
    const cx = cell * si + cell / 2, cy = 135;
    const total = s.values.reduce((a, b) => a + (b || 0), 0) || 1;
    let a0 = -Math.PI / 2;
    s.values.forEach((val, i) => {
      const a1 = a0 + ((val || 0) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => [cx + R * Math.cos(a), cy + R * Math.sin(a)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      g += series.length && val >= total - 1e-9
        ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${COLORS[i % 7]}"/>`
        : `<path d="M${cx},${cy} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z" fill="${COLORS[i % 7]}" stroke="#fff" stroke-width="1.5"/>`;
      const mid = (a0 + a1) / 2;
      if (val / total > 0.04)
        g += `<text x="${cx + R * 0.66 * Math.cos(mid)}" y="${cy + R * 0.66 * Math.sin(mid) + 4}" class="pielabel" text-anchor="middle">${fmt(val)}${v.unit === "%" ? "%" : ""}</text>`;
      a0 = a1;
    });
    g += `<text x="${cx}" y="${cy + R + 26}" class="axlabel" text-anchor="middle">${esc(s.name)}</text>`;
  });
  g += legend(cats, W - 165, 40, "bar");
  return `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px" class="chart" role="img" aria-label="${esc(v.title)}">${g}</svg>`;
}

function table(v) {
  const head = `<tr><th></th>${(v.categories || []).map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const body = (v.rows || []).map((r) => `<tr><th>${esc(r.label)}</th>${(r.cells || []).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table class="datatable">${head}${body}</table>${v.unit ? `<div class="unitnote">Units: ${esc(v.unit)}</div>` : ""}`;
}

function processDiagram(v) {
  const steps = v.steps || [];
  const per = 3, bw = 180, bh = 74, gx = 50, gy = 46;
  const rows = Math.ceil(steps.length / per);
  const W = per * bw + (per - 1) * gx + 20, H = rows * bh + (rows - 1) * gy + 20;
  const pos = steps.map((_, i) => {
    const r = Math.floor(i / per);
    let c = i % per;
    if (r % 2) c = per - 1 - c; // snake layout
    return [10 + c * (bw + gx), 10 + r * (bh + gy)];
  });
  let g = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>`;
  steps.forEach((s, i) => {
    const [x, y] = pos[i];
    g += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="#eef3fb" stroke="#1f4e9c"/>`;
    g += `<foreignObject x="${x + 6}" y="${y + 4}" width="${bw - 12}" height="${bh - 8}"><div xmlns="http://www.w3.org/1999/xhtml" class="stepbox"><b>${i + 1}</b> ${esc(s)}</div></foreignObject>`;
    if (i < steps.length - 1) {
      const [nx, ny] = pos[i + 1];
      if (ny === y) {
        const dir = nx > x ? 1 : -1;
        const x1 = dir > 0 ? x + bw : x, x2 = dir > 0 ? nx : nx + bw;
        g += `<line x1="${x1 + dir * 4}" y1="${y + bh / 2}" x2="${x2 - dir * 4}" y2="${y + bh / 2}" stroke="#333" stroke-width="2" marker-end="url(#arr)"/>`;
      } else g += `<line x1="${x + bw / 2}" y1="${y + bh + 4}" x2="${x + bw / 2}" y2="${ny - 4}" stroke="#333" stroke-width="2" marker-end="url(#arr)"/>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px" class="chart" role="img" aria-label="${esc(v.title)}">${g}</svg>`;
}

const KIND = { building: "#c8b49a", road: "#9e9e9e", water: "#8fc1e3", park: "#9ccc8a", field: "#e6dc9c", parking: "#d0d0d0", other: "#d8c3e6" };
function maps(v) {
  const panels = v.mapPanels || [];
  const S = 30, P = 300, gap = 30;
  const W = panels.length * P + (panels.length - 1) * gap + 20, H = P + 50;
  let g = "";
  panels.forEach((p, pi) => {
    const ox = 10 + pi * (P + gap), oy = 30;
    g += `<text x="${ox + P / 2}" y="20" class="axlabel" text-anchor="middle">${esc(p.label)}</text><rect x="${ox}" y="${oy}" width="${P}" height="${P}" fill="#fafaf6" stroke="#333"/>`;
    for (const f of p.features || []) {
      const x = ox + Math.max(0, f.x) * S, y = oy + Math.max(0, f.y) * S;
      const w = Math.max(0.3, Math.min(f.w, 10 - f.x)) * S, h = Math.max(0.3, Math.min(f.h, 10 - f.y)) * S;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${KIND[f.kind] || KIND.other}" stroke="#555" stroke-width="0.8"/>`;
      g += `<foreignObject x="${x}" y="${y}" width="${Math.max(w, 60)}" height="${Math.max(h, 24)}"><div xmlns="http://www.w3.org/1999/xhtml" class="maplabel">${esc(f.name)}</div></foreignObject>`;
    }
    g += `<text x="${ox + P - 14}" y="${oy + 18}" class="axlabel" text-anchor="middle">N</text><line x1="${ox + P - 14}" y1="${oy + 38}" x2="${ox + P - 14}" y2="${oy + 22}" stroke="#333" stroke-width="2" marker-end="url(#arrm)"/>`;
  });
  g = `<defs><marker id="arrm" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>` + g;
  return `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px" class="chart" role="img" aria-label="${esc(v.title)}">${g}</svg>`;
}

export function renderVisual(v) {
  let body = "";
  try {
    body = { line: () => axes(v, "line"), bar: () => axes(v, "bar"), pie: () => pies(v), table: () => table(v), process: () => processDiagram(v), map: () => maps(v) }[v.type]?.() ?? "";
  } catch (e) {
    body = `<p class="muted">Could not draw this visual (${esc(e.message)}).</p>`;
  }
  return `<figure class="visual"><figcaption>${esc(v.title)}</figcaption>${body}</figure>`;
}
