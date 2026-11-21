/* Section Analyzer -- JavaScript port of compute.py.
 *
 * Same maths, same conventions: x positive to the LEFT, y positive
 * DOWNWARD (the plot axes use reversed ranges), a rectangle is
 * [x0, y0, base, height] with (x0, y0) its top-right vertex, so it spans
 * x in [x0, x0+b] and y in [y0, y0+h] in data coordinates.
 *
 * Figures are returned as plain {data, layout} objects for Plotly.js.
 * Everything lives on window.SectionCompute.
 */
(function (global) {
  "use strict";

  // =====================================================================
  // small numeric helpers (numpy / Python behaviours the port relies on)
  // =====================================================================

  function linspace(a, b, n) {
    const out = new Array(n);
    if (n === 1) { out[0] = a; return out; }
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) out[i] = a + step * i;
    out[n - 1] = b;
    return out;
  }

  // Python's round(): halves go to the nearest EVEN integer.
  function pyRound(x) {
    const f = Math.floor(x);
    if (x - f === 0.5) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }

  function mod(a, m) { return ((a % m) + m) % m; }

  function median(arr) {
    const s = arr.slice().sort((p, q) => p - q);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function argmax(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
  }

  function sumOf(arr) { let t = 0; for (const v of arr) t += v; return t; }
  function absMax(arr) { let m = 0; for (const v of arr) m = Math.max(m, Math.abs(v)); return m; }
  function minOf(arr) { let m = Infinity; for (const v of arr) if (v < m) m = v; return m; }
  function maxOf(arr) { let m = -Infinity; for (const v of arr) if (v > m) m = v; return m; }
  function hypot(a, b) { return Math.sqrt(a * a + b * b); }

  const keyOf = (r) => r[0] + "," + r[1] + "," + r[2] + "," + r[3];
  const sameRect = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3];
  const withKey = (set, rect) => { const s = new Set(set); s.add(keyOf(rect)); return s; };

  // =====================================================================
  // geometry
  // =====================================================================

  function rectsOverlap(r1, r2) {
    const [x01, y01, b1, h1] = r1;
    const [x02, y02, b2, h2] = r2;
    const x11 = x01 + b1, y11 = y01 + h1;
    const x12 = x02 + b2, y12 = y02 + h2;
    if (x11 <= x02 || x12 <= x01) return false;
    if (y11 <= y02 || y12 <= y01) return false;
    return true;
  }

  /** `rect` minus the area already covered by `existing`: a list of disjoint
   *  rectangles [x0, y0, b, h] (empty if rect is fully covered). Each existing
   *  rectangle cuts every remaining piece into at most 4 rectangles; of the
   *  two possible ways of cutting (vertical strips first / horizontal strips
   *  first) the one giving fewer pieces is used. */
  function subtractRects(rect, existing) {
    const EPS = 1e-9;
    const clean = (v) => Number(v.toPrecision(12));
    const mk = (xl, xr, yt, yb) => (xr - xl > EPS && yb - yt > EPS)
      ? [clean(xl), clean(yt), clean(xr - xl), clean(yb - yt)] : null;
    let pieces = [rect.slice()];
    for (const e of existing) {
      const next = [];
      for (const p of pieces) {
        if (!rectsOverlap(p, e)) { next.push(p); continue; }
        const pl = p[0], pr = p[0] + p[2], pt = p[1], pb = p[1] + p[3];
        const il = Math.max(pl, e[0]), ir = Math.min(pr, e[0] + e[2]);
        const it = Math.max(pt, e[1]), ib = Math.min(pb, e[1] + e[3]);
        const vertical = [mk(pl, il, pt, pb), mk(ir, pr, pt, pb), mk(il, ir, pt, it), mk(il, ir, ib, pb)];
        const horizontal = [mk(pl, pr, pt, it), mk(pl, pr, ib, pb), mk(pl, il, it, ib), mk(ir, pr, it, ib)];
        const a = vertical.filter(Boolean), b = horizontal.filter(Boolean);
        for (const q of (b.length < a.length ? b : a)) next.push(q);
      }
      pieces = next;
    }
    return pieces;
  }

  function computeGeometry(rects) {
    let A_tot = 0, x_num = 0, y_num = 0;
    for (const [x0, y0, b, h] of rects) {
      const A = b * h;
      A_tot += A;
      x_num += A * (x0 + b / 2);
      y_num += A * (y0 + h / 2);
    }
    const x_bar = x_num / A_tot;
    const y_bar = y_num / A_tot;

    let Ix = 0, Iy = 0, Ixy = 0;
    for (const [x0, y0, b, h] of rects) {
      const A = b * h;
      const dx = x0 + b / 2 - x_bar;
      const dy = y0 + h / 2 - y_bar;
      Ix += (b * Math.pow(h, 3)) / 12 + A * dy * dy;
      Iy += (h * Math.pow(b, 3)) / 12 + A * dx * dx;
      Ixy += A * dx * dy;
    }

    let theta_p;
    if (Math.abs(Ix - Iy) < 1e-9 && Math.abs(Ixy) < 1e-9) {
      theta_p = 0;
    } else {
      theta_p = 0.5 * Math.atan2(-2 * Ixy, Ix - Iy);
      if (Ix < Iy) theta_p += Math.PI / 2;
      theta_p = mod(theta_p + Math.PI / 2, Math.PI) - Math.PI / 2;
    }

    const R = Math.sqrt(Math.pow((Ix - Iy) / 2, 2) + Ixy * Ixy);
    const I_mean = (Ix + Iy) / 2;
    return { A_tot, x_bar, y_bar, Ix, Iy, Ixy, theta_p, I1: I_mean + R, I2: I_mean - R };
  }

  function formatGeometryOutput(g) {
    return [
      `Total area = ${g.A_tot.toFixed(4)} mm²`,
      "",
      "Centroid coordinates",
      ` x' = ${g.x_bar.toFixed(4)} mm`,
      ` y' = ${g.y_bar.toFixed(4)} mm`,
      "",
      "Centroidal moments of inertia:",
      `Ix'x'  = ${g.Ix.toFixed(4)} mm⁴`,
      `Iy'y'  = ${g.Iy.toFixed(4)} mm⁴`,
      `Ix'y' = ${g.Ixy.toFixed(4)} mm⁴`,
      "",
      "Principal axes of inertia (x, y):",
      `θx' (counter-clockwise if positive) = ${(g.theta_p * 180 / Math.PI).toFixed(4)} deg`,
      `I1 (max) = ${g.I1.toFixed(4)} mm⁴`,
      `I2 (min) = ${g.I2.toFixed(4)} mm⁴`,
    ];
  }

  // =====================================================================
  // normal stresses
  // =====================================================================

  function sigmaBendingAt(x, y, Mx, My, g) {
    const Delta = g.Ix * g.Iy - g.Ixy * g.Ixy;
    const xc = x - g.x_bar;
    const yc = y - g.y_bar;
    return ((g.Iy * Mx + g.Ixy * My) * yc - (g.Ix * My + g.Ixy * Mx) * xc) / Delta;
  }

  function sigmaTotalAt(x, y, Mx, My, N, g) {
    return N / g.A_tot + sigmaBendingAt(x, y, Mx, My, g);
  }

  /** Neutral axis (sigma = 0) in the CENTROIDAL axes x, y:
   *      k2 x + k3 y + N/A = 0   ->   y = m x + theta,   m = tan(beta)
   *  delta (returned as `theta`) = intercept with the y axis [mm]; beta = angle with the x axis
   *  (counter-clockwise if positive, same convention as the principal axes).
   *  Mx, My in N*mm, N in N. */
  function neutralAxis(Mx, My, N, g) {
    const Delta = g.Ix * g.Iy - g.Ixy * g.Ixy;
    const k2 = -(g.Ix * My + g.Ixy * Mx) / Delta;
    const k3 = (g.Iy * Mx + g.Ixy * My) / Delta;
    const nA = N / g.A_tot;
    if (Math.abs(k2) <= 1e-12 && Math.abs(k3) <= 1e-12) {
      return { defined: false, reason: Math.abs(nA) > 1e-12 ? "axial force only (uniform stress)" : "no internal action" };
    }
    if (Math.abs(k3) <= 1e-9 * Math.abs(k2)) {
      return { defined: true, vertical: true, xIntercept: -nA / k2, betaDeg: 90, k2, k3 };
    }
    const m = -k2 / k3, theta = -nA / k3;
    return { defined: true, vertical: false, m, theta, betaDeg: Math.atan(m) * 180 / Math.PI, k2, k3 };
  }

  function computeStressExtremes(rects, Mx, My, N, g) {
    let sigmaMax = -Infinity, sigmaMin = Infinity, locMax = null, locMin = null;
    for (const [x0, y0, b, h] of rects) {
      const corners = [[x0, y0], [x0 + b, y0], [x0, y0 + h], [x0 + b, y0 + h]];
      for (const [x, y] of corners) {
        const s = sigmaTotalAt(x, y, Mx, My, N, g);
        if (s > sigmaMax) { sigmaMax = s; locMax = [x, y]; }
        if (s < sigmaMin) { sigmaMin = s; locMin = [x, y]; }
      }
    }
    return { sigmaMax, locMax, sigmaMin, locMin };
  }

  // =====================================================================
  // plot helpers
  // =====================================================================

  /** Navier / Scienza delle Costruzioni convention: x increasing to the
   *  LEFT, y increasing DOWNWARD (reversed ranges). */
  function viewRange(xmin, xmax, ymin, ymax, marginFraction) {
    if (marginFraction === undefined) marginFraction = 0.2;
    const mx = marginFraction * Math.max(xmax - xmin, 1e-6);
    const my = marginFraction * Math.max(ymax - ymin, 1e-6);
    return [[xmax + mx, xmin - mx], [ymax + my, ymin - my]];
  }

  function rectShapes(rects, fillcolor, opacity, lineColor) {
    if (fillcolor === undefined) fillcolor = "lightgray";
    if (opacity === undefined) opacity = 0.6;
    if (lineColor === undefined) lineColor = "black";
    return rects.map(([x0, y0, b, h]) => ({
      type: "rect", x0, y0, x1: x0 + b, y1: y0 + h,
      line: { color: lineColor, width: 1 }, fillcolor, opacity, layer: "above",
    }));
  }

  /** One unlabeled arrow plus one separate text label per axis. */
  function axesAnnotations(origin, angle, labelX, labelY, scale, color) {
    if (color === undefined) color = "black";
    const [x0, y0] = origin;
    const dx = scale * Math.cos(angle);
    const dy = scale * Math.sin(angle);
    const arrow = (xt, yt) => ({
      x: xt, y: yt, ax: x0, ay: y0, axref: "x", ayref: "y", xref: "x", yref: "y",
      showarrow: true, arrowhead: 2, arrowsize: 1, arrowwidth: 1.5,
      arrowcolor: color, text: "", standoff: 0,
    });
    const label = (xt, yt, text) => ({
      x: xt, y: yt, xref: "x", yref: "y", showarrow: false,
      text, font: { size: 13, color }, xanchor: "center", yanchor: "middle",
    });
    const reach = 1.25;
    return [
      arrow(x0 + dx, y0 + dy),
      label(x0 + dx * reach, y0 + dy * reach, labelX),
      arrow(x0 - dy, y0 + dx),
      label(x0 - dy * reach, y0 + dx * reach, labelY),
    ];
  }

  function infiniteLinePoints(point, direction, xr, yr) {
    const [x0, y0] = point;
    let [dx, dy] = direction;
    const norm = hypot(dx, dy);
    if (norm < 1e-12) return null;
    dx /= norm; dy /= norm;
    const span = 2 * Math.max(Math.abs(xr[1] - xr[0]), Math.abs(yr[1] - yr[0]), 1);
    return [[x0 - span * dx, x0 + span * dx], [y0 - span * dy, y0 + span * dy]];
  }

  /** Moment vector: a shaft ending in two consecutive arrowheads. */
  function momentArrow(center, phi, length, color) {
    const dirx = Math.cos(phi), diry = Math.sin(phi);
    const base = [center[0] - length / 2 * dirx, center[1] - length / 2 * diry];
    const tip = [center[0] + length / 2 * dirx, center[1] + length / 2 * diry];
    const chevron = 0.22 * length;
    const p1 = [tip[0] - chevron * dirx, tip[1] - chevron * diry];
    const p2 = [tip[0] - 2 * chevron * dirx, tip[1] - 2 * chevron * diry];

    const trace = {
      type: "scatter", x: [base[0], p2[0]], y: [base[1], p2[1]], mode: "lines",
      line: { color, width: 3 }, hoverinfo: "skip", showlegend: false,
    };
    const annotations = [];
    for (const [start, end] of [[p2, p1], [p1, tip]]) {
      annotations.push({
        x: end[0], y: end[1], ax: start[0], ay: start[1], axref: "x", ayref: "y",
        xref: "x", yref: "y", showarrow: true, arrowhead: 2, arrowsize: 1.2,
        arrowwidth: 2.5, arrowcolor: color, text: "",
      });
    }
    annotations.push({
      x: tip[0], y: tip[1], text: "M", showarrow: false, xref: "x", yref: "y",
      font: { size: 13, color, family: "Arial Black" },
      xanchor: "left", yanchor: "middle",
    });
    return { trace, annotations };
  }

  /** Classic Navier linear diagram as a ribbon polygon, offset sideways
   *  from the section, or null if there is no bending. */
  function sigmaDiagramRibbon(rects, g, Mx, My, N, sigmaMin, sigmaMax) {
    const Delta = g.Ix * g.Iy - g.Ixy * g.Ixy;
    const k2 = -(g.Ix * My + g.Ixy * Mx) / Delta;
    const k3 = (g.Iy * Mx + g.Ixy * My) / Delta;
    const norm = hypot(k2, k3);
    if (norm < 1e-9) return null;

    const n_hat = [k2 / norm, k3 / norm];
    const t_hat = [-n_hat[1], n_hat[0]];

    const corners = [];
    for (const [x0, y0, b, h] of rects) {
      corners.push([x0, y0], [x0 + b, y0], [x0, y0 + h], [x0 + b, y0 + h]);
    }
    const projN = corners.map((c) => c[0] * n_hat[0] + c[1] * n_hat[1]);
    const projT = corners.map((c) => c[0] * t_hat[0] + c[1] * t_hat[1]);
    const nMin = minOf(projN), nMax = maxOf(projN);
    const tMax = maxOf(projT);

    const tBar = g.x_bar * t_hat[0] + g.y_bar * t_hat[1];
    const s = linspace(nMin, nMax, 60);
    const pts = s.map((si) => [si * n_hat[0] + tBar * t_hat[0], si * n_hat[1] + tBar * t_hat[1]]);
    const sigma = pts.map(([x, y]) => sigmaTotalAt(x, y, Mx, My, N, g));

    const spanN = Math.max(nMax - nMin, 1e-6);
    const vmax = Math.max(Math.abs(sigmaMin), Math.abs(sigmaMax), 1e-9);
    const scale = 0.22 * spanN / vmax;
    const gap = 0.06 * spanN;

    const clearance = (tMax - tBar) + gap + scale * vmax;
    const baselineT = tBar + clearance;

    const outer = s.map((si, i) => {
      const ot = baselineT + scale * sigma[i];
      return [si * n_hat[0] + ot * t_hat[0], si * n_hat[1] + ot * t_hat[1]];
    });
    const base = s.map((si) => [si * n_hat[0] + baselineT * t_hat[0], si * n_hat[1] + baselineT * t_hat[1]]);
    return { s, sigma, outer, base, n_hat, t_hat };
  }

  /** Splits the ribbon at the zero crossing so tension and compression
   *  get different colors. Returns {traces, annotations}. */
  function sigmaRibbonTraces(ribbon) {
    const { sigma, outer, base } = ribbon;
    const len = sigma.length;
    const sign = sigma.map(Math.sign);
    const splits = [0];
    for (let i = 0; i < len - 1; i++) if (sign[i + 1] - sign[i] !== 0) splits.push(i + 1);
    splits.push(len);

    const traces = [];
    for (let k = 0; k < splits.length - 1; k++) {
      const i0 = splits[k], i1 = splits[k + 1];
      if (i1 - i0 < 2) continue;
      const seg = sigma.slice(i0, i1);
      const mean = sumOf(seg) / seg.length;
      const color = mean >= 0 ? "rgba(200,30,30,0.28)" : "rgba(30,60,200,0.28)";
      const lineColor = mean >= 0 ? "rgba(150,20,20,0.8)" : "rgba(20,40,150,0.8)";
      const px = outer.slice(i0, i1).map((p) => p[0]).concat(base.slice(i0, i1).map((p) => p[0]).reverse());
      const py = outer.slice(i0, i1).map((p) => p[1]).concat(base.slice(i0, i1).map((p) => p[1]).reverse());
      traces.push({
        type: "scatter", x: px, y: py, mode: "lines", fill: "toself",
        line: { color: lineColor, width: 1.5 }, fillcolor: color,
        hoverinfo: "skip", showlegend: false,
      });
    }
    traces.push({
      type: "scatter", x: [outer[0][0], outer[len - 1][0]], y: [outer[0][1], outer[len - 1][1]],
      mode: "markers", marker: { color: "black", size: 4 }, showlegend: false, hoverinfo: "skip",
    });
    const annotations = [
      { x: outer[0][0], y: outer[0][1], text: `${sigma[0].toFixed(1)} MPa`, showarrow: false,
        font: { size: 10 }, xshift: -6, yshift: -6 },
      { x: outer[len - 1][0], y: outer[len - 1][1], text: `${sigma[len - 1].toFixed(1)} MPa`, showarrow: false,
        font: { size: 10 }, xshift: 6, yshift: 6 },
    ];
    return { traces, annotations };
  }

  /** Look of plotly.py's default template, for the figures that relied
   *  on it (grey-blue plot area, white grid). */
  function templateLook(layout) {
    layout.paper_bgcolor = "white";
    layout.plot_bgcolor = "#E5ECF6";
    layout.font = { color: "#2a3f5f" };
    for (const k of ["xaxis", "yaxis"]) {
      layout[k] = Object.assign({ gridcolor: "white", linecolor: "white" }, layout[k]);
    }
    return layout;
  }

  function sectionBounds(rects) {
    return {
      xmin: minOf(rects.map((r) => r[0])), xmax: maxOf(rects.map((r) => r[0] + r[2])),
      ymin: minOf(rects.map((r) => r[1])), ymax: maxOf(rects.map((r) => r[1] + r[3])),
    };
  }

  // =====================================================================
  // figure: geometry
  // =====================================================================

  const GRID_AXIS = (range, title, extra) => Object.assign({
    range, title: { text: title }, zeroline: false,
    showgrid: true, gridcolor: "#8c8c8c", gridwidth: 1,
    minor: { showgrid: true, gridcolor: "#d8d8d8" },
  }, extra || {});

  const NEWSHAPE = { line: { color: "crimson", width: 2 }, fillcolor: "rgba(220,20,60,0.15)" };

  function buildGeometryFigure(rects, g) {
    if (!rects.length) {
      // Empty canvas: a real, gridded, correctly-oriented coordinate
      // system so the first rectangle can be sketched straight away.
      const [xr, yr] = viewRange(0, 300, 0, 300, 0);
      return {
        data: [],
        layout: {
          xaxis: GRID_AXIS(xr, "x [mm]"),
          yaxis: GRID_AXIS(yr, "y [mm]", { scaleanchor: "x", scaleratio: 1 }),
          plot_bgcolor: "white", height: 520, margin: { l: 50, r: 30, t: 30, b: 50 },
          newshape: NEWSHAPE, dragmode: "drawrect", showlegend: false,
        },
      };
    }

    const { xmin, xmax, ymin, ymax } = sectionBounds(rects);
    // The view always includes the origin O', otherwise a section away
    // from (0,0) would push the O'/x'/y' markers off screen.
    const vxmin = Math.min(xmin, 0), vxmax = Math.max(xmax, 0);
    const vymin = Math.min(ymin, 0), vymax = Math.max(ymax, 0);
    const axisScale = 0.12 * Math.max(vxmax - vxmin, vymax - vymin, 1);

    const data = [];
    const shapes = rectShapes(rects);
    let annotations = axesAnnotations([0, 0], 0, "x'", "y'", axisScale);
    annotations.push({
      x: 0, y: 0, text: "O'", showarrow: false, font: { size: 13, color: "black" },
      xanchor: "right", yanchor: "top", xshift: -4, yshift: 4,
    });

    if (g) {
      data.push({
        type: "scatter", x: [g.x_bar], y: [g.y_bar], mode: "markers",
        marker: { color: "red", size: 9 }, showlegend: false,
        hovertemplate: "centroid<br>x=%{x:.2f} mm, y=%{y:.2f} mm<extra></extra>",
      });
      annotations = annotations.concat(axesAnnotations([g.x_bar, g.y_bar], g.theta_p, "x", "y", axisScale));
      annotations.push({
        x: g.x_bar, y: g.y_bar, text: "O", showarrow: false, font: { size: 13, color: "red" },
        xanchor: "right", yanchor: "top", xshift: -4, yshift: 4,
      });
    }

    const [xr, yr] = viewRange(vxmin, vxmax, vymin, vymax);
    return {
      data,
      layout: {
        shapes, annotations,
        xaxis: GRID_AXIS(xr, "x [mm]"),
        yaxis: GRID_AXIS(yr, "y [mm]", { scaleanchor: "x", scaleratio: 1 }),
        newshape: NEWSHAPE, plot_bgcolor: "white",
        margin: { l: 50, r: 30, t: 30, b: 50 }, height: 520, showlegend: false,
        // once the geometry is computed, default to panning so an
        // accidental drag can't sketch a rectangle on a finished section
        dragmode: g ? "pan" : "drawrect",
      },
    };
  }

  // =====================================================================
  // figure: normal stresses
  // =====================================================================

  function buildStressFigure(rects, g, Mx, My, N) {
    const ext = computeStressExtremes(rects, Mx, My, N, g);
    const { sigmaMax, locMax, sigmaMin, locMin } = ext;
    const { xmin, xmax, ymin, ymax } = sectionBounds(rects);

    const nx = 220, ny = 220;
    const X = linspace(xmin, xmax, nx);
    const Y = linspace(ymin, ymax, ny);
    const Z = [];
    for (let i = 0; i < ny; i++) {
      const row = new Array(nx);
      for (let j = 0; j < nx; j++) {
        let inside = false;
        for (const [x0, y0, b, h] of rects) {
          if (X[j] >= x0 && X[j] <= x0 + b && Y[i] >= y0 && Y[i] <= y0 + h) { inside = true; break; }
        }
        row[j] = inside ? sigmaTotalAt(X[j], Y[i], Mx, My, N, g) : null;
      }
      Z.push(row);
    }
    const vmax = Math.max(Math.abs(sigmaMax), Math.abs(sigmaMin), 1e-9);

    const data = [{
      type: "heatmap", x: X, y: Y, z: Z,
      colorscale: "RdBu", reversescale: true, zmid: 0, zmin: -vmax, zmax: vmax,
      colorbar: { title: { text: "σ [MPa]" } },
      hovertemplate: "x=%{x:.2f} mm<br>y=%{y:.2f} mm<br>σ=%{z:.2f} MPa<extra></extra>",
    }];

    const shapes = rectShapes(rects, "rgba(0,0,0,0)", 1.0);
    let annotations = [];

    const Delta = g.Ix * g.Iy - g.Ixy * g.Ixy;
    const k2 = -(g.Ix * My + g.Ixy * Mx) / Delta;
    const k3 = (g.Iy * Mx + g.Ixy * My) / Delta;
    const hasBending = Math.abs(k2) > 1e-12 || Math.abs(k3) > 1e-12;

    const ribbon = hasBending ? sigmaDiagramRibbon(rects, g, Mx, My, N, sigmaMin, sigmaMax) : null;

    let vxmin = xmin, vxmax = xmax, vymin = ymin, vymax = ymax;
    if (ribbon) {
      for (const p of ribbon.outer.concat(ribbon.base)) {
        vxmin = Math.min(vxmin, p[0]); vxmax = Math.max(vxmax, p[0]);
        vymin = Math.min(vymin, p[1]); vymax = Math.max(vymax, p[1]);
      }
    }
    const [xr, yr] = viewRange(vxmin, vxmax, vymin, vymax);

    if (hasBending) {
      const a = k2, bCoef = k3;
      const c = -N / g.A_tot + k2 * g.x_bar + k3 * g.y_bar;
      let xp, yp;
      if (Math.abs(bCoef) > Math.abs(a)) {
        xp = g.x_bar;
        yp = (c - a * xp) / bCoef;
      } else {
        yp = g.y_bar;
        xp = (c - bCoef * yp) / a;
      }
      let pts = infiniteLinePoints([xp, yp], [-bCoef, a], xr, yr);
      if (pts) {
        data.push({
          type: "scatter", x: pts[0], y: pts[1], mode: "lines",
          line: { color: "green", dash: "dash", width: 2 }, name: "Neutral axis", hoverinfo: "skip",
        });
      }
      const phi = Math.atan2(My, Mx);
      pts = infiniteLinePoints([g.x_bar, g.y_bar], [Math.cos(phi), Math.sin(phi)], xr, yr);
      if (pts) {
        data.push({
          type: "scatter", x: pts[0], y: pts[1], mode: "lines",
          line: { color: "darkorange", dash: "dashdot", width: 2 },
          name: "Bending moment direction", hoverinfo: "skip",
        });
      }
      const Lref = 0.18 * Math.max(xmax - xmin, ymax - ymin, 1);
      const m = momentArrow([g.x_bar, g.y_bar], phi, Lref, "purple");
      data.push(m.trace);
      annotations = annotations.concat(m.annotations);

      // angle beta between the centroidal x axis and the neutral axis: an arc
      // with an arrowhead, drawn where the neutral axis crosses the x axis
      // when that point is on screen (otherwise at the centroid, against a
      // dotted line through the centroid parallel to the neutral axis)
      const na = neutralAxis(Mx, My, N, g);
      if (na.defined) {
        const beta = na.betaDeg * Math.PI / 180;
        // radius larger than the moment arrow (0.18 of the span) so they do not hide each other
        const R = 0.26 * Math.max(xmax - xmin, ymax - ymin, 1);
        const xlo = Math.min(xr[0], xr[1]), xhi = Math.max(xr[0], xr[1]);
        const ylo = Math.min(yr[0], yr[1]), yhi = Math.max(yr[0], yr[1]);
        const inView = (px, py) => px - R >= xlo && px + 1.6 * R <= xhi && py - R >= ylo && py + R <= yhi;
        let cx = g.x_bar, cy = g.y_bar, parallelHelper = true;
        const xCross = na.vertical ? na.xIntercept : (Math.abs(na.m) > 1e-9 ? -na.theta / na.m : null);
        if (xCross !== null && inView(g.x_bar + xCross, g.y_bar)) {
          cx = g.x_bar + xCross; cy = g.y_bar; parallelHelper = false;
        }
        const green = "green";
        // start of the angle: the x axis
        data.push({
          type: "scatter", x: [cx, cx + 1.3 * R], y: [cy, cy], mode: "lines",
          line: { color: "rgba(0,100,0,0.6)", dash: "dot", width: 1.5 }, hoverinfo: "skip", showlegend: false,
        });
        const label = `β = ${(Math.abs(na.betaDeg) < 5e-5 ? 0 : na.betaDeg).toFixed(2)}°`;
        if (Math.abs(beta) < 1e-6) {
          annotations.push({
            x: cx + 1.35 * R, y: cy, text: label, showarrow: false, font: { size: 13, color: green },
            bgcolor: "rgba(255,255,255,0.85)", xanchor: "left", xshift: 4, yshift: 14,
          });
        } else {
          if (parallelHelper) {
            const hp = infiniteLinePoints([cx, cy], [Math.cos(beta), Math.sin(beta)], xr, yr);
            if (hp) {
              data.push({
                type: "scatter", x: hp[0], y: hp[1], mode: "lines",
                line: { color: "rgba(0,100,0,0.6)", dash: "dot", width: 1.5 }, hoverinfo: "skip", showlegend: false,
              });
            }
          }
          const arcX = [], arcY = [];
          for (let i = 0; i <= 40; i++) {
            const ph = beta * i / 40;
            arcX.push(cx + R * Math.cos(ph)); arcY.push(cy + R * Math.sin(ph));
          }
          data.push({
            type: "scatter", x: arcX, y: arcY, mode: "lines",
            line: { color: green, width: 2.5 }, hoverinfo: "skip", showlegend: false,
          });
          const pe = beta, pt = beta * 0.88;         // arrowhead at the end of the arc, along its tangent
          annotations.push({
            x: cx + R * Math.cos(pe), y: cy + R * Math.sin(pe),
            ax: cx + R * Math.cos(pt), ay: cy + R * Math.sin(pt), axref: "x", ayref: "y", xref: "x", yref: "y",
            showarrow: true, arrowhead: 2, arrowsize: 1.3, arrowwidth: 2.5, arrowcolor: green, text: "",
          });
          const pm = beta / 2;
          // small angles: push the label away from the two lines it sits between
          const away = Math.abs(na.betaDeg) < 25 ? (beta >= 0 ? 14 : -14) : 0;
          annotations.push({
            x: cx + 1.25 * R * Math.cos(pm), y: cy + 1.25 * R * Math.sin(pm), text: label, showarrow: false,
            font: { size: 13, color: green }, bgcolor: "rgba(255,255,255,0.85)", yshift: away,
          });
        }
      }

      if (ribbon) {
        const r = sigmaRibbonTraces(ribbon);
        for (const t of r.traces) data.push(t);
        annotations = annotations.concat(r.annotations);
      }
    }

    data.push({
      type: "scatter", x: [g.x_bar], y: [g.y_bar], mode: "markers",
      marker: { color: "black", size: 7 }, showlegend: false, hovertemplate: "centroid<extra></extra>",
    });

    data.push({
      type: "scatter", x: [locMax[0]], y: [locMax[1]], mode: "markers",
      marker: { symbol: "triangle-up", color: "white", size: 11, line: { color: "black", width: 1.5 } },
      showlegend: false, hovertemplate: `max = ${sigmaMax.toFixed(1)} MPa<extra></extra>`,
    });
    annotations.push({
      x: locMax[0], y: locMax[1], text: `max = ${sigmaMax.toFixed(1)} MPa`,
      showarrow: false, font: { size: 11, color: "black" },
      bgcolor: "white", bordercolor: "black", borderwidth: 1,
      xanchor: "left", yanchor: "bottom", xshift: 10, yshift: 10,
    });

    data.push({
      type: "scatter", x: [locMin[0]], y: [locMin[1]], mode: "markers",
      marker: { symbol: "triangle-down", color: "white", size: 11, line: { color: "black", width: 1.5 } },
      showlegend: false, hovertemplate: `min = ${sigmaMin.toFixed(1)} MPa<extra></extra>`,
    });
    annotations.push({
      x: locMin[0], y: locMin[1], text: `min = ${sigmaMin.toFixed(1)} MPa`,
      showarrow: false, font: { size: 11, color: "black" },
      bgcolor: "white", bordercolor: "black", borderwidth: 1,
      xanchor: "left", yanchor: "top", xshift: 10, yshift: -10,
    });

    const layout = templateLook({
      shapes, annotations,
      xaxis: { range: xr, title: { text: "x [mm]" }, zeroline: false },
      yaxis: { range: yr, title: { text: "y [mm]" }, zeroline: false, scaleanchor: "x", scaleratio: 1 },
      margin: { l: 50, r: 30, t: 30, b: 50 }, height: 560,
      legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
      dragmode: "pan",
    });
    return { fig: { data, layout }, sigmaMax, locMax, sigmaMin, locMin };
  }

  // =====================================================================
  // shear: per-rectangle, connectivity-aware Jourawski analysis
  //
  // A piece swept along its own length is either a SPINE for the shear
  // direction (its long axis matches V: the arm varies along the sweep,
  // giving the classic parabola) or a FLANGE (long axis perpendicular to
  // V: constant arm, linear "tent"). Which role a piece plays flips
  // between Vx and Vy. Each piece only ever accumulates the material
  // that genuinely precedes the cut along its own connected branch --
  // never unrelated, disconnected siblings that merely share a coordinate.
  // =====================================================================

  const longAxis = (r) => (r[2] >= r[3] ? "x" : "y");

  function isSpineRole(rect, direction) {
    const axis = longAxis(rect);
    return (axis === "y" && direction === "Vy") || (axis === "x" && direction === "Vx");
  }

  /** Merged sub-intervals along rect's own span where a PERPENDICULAR
   *  neighbour's tip touches it (also used by the torsion constant). */
  function excludedIntervals(rect, rects) {
    const [x0, y0, b, h] = rect;
    const ownAxis = longAxis(rect);
    const intervals = [];
    for (const o of rects) {
      if (sameRect(o, rect)) continue;
      const [ox0, oy0, ob, oh] = o;
      if (longAxis(o) === ownAxis) continue;
      if (ownAxis === "x") {
        const touches = Math.abs(oy0 + oh - y0) < 1e-6 || Math.abs(oy0 - (y0 + h)) < 1e-6;
        if (touches) {
          const a = Math.max(x0, ox0), bnd = Math.min(x0 + b, ox0 + ob);
          if (bnd > a) intervals.push([a, bnd]);
        }
      } else {
        const touches = Math.abs(ox0 + ob - x0) < 1e-6 || Math.abs(ox0 - (x0 + b)) < 1e-6;
        if (touches) {
          const a = Math.max(y0, oy0), bnd = Math.min(y0 + h, oy0 + oh);
          if (bnd > a) intervals.push([a, bnd]);
        }
      }
    }
    intervals.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const merged = [];
    for (const [a, bnd] of intervals) {
      if (merged.length && a <= merged[merged.length - 1][1] + 1e-9) {
        merged[merged.length - 1] = [merged[merged.length - 1][0], Math.max(merged[merged.length - 1][1], bnd)];
      } else {
        merged.push([a, bnd]);
      }
    }
    return merged;
  }

  function rectsTouch(r1, r2, tol) {
    if (tol === undefined) tol = 1e-6;
    const [x0, y0, b, h] = r1;
    const [ox0, oy0, ob, oh] = r2;
    const x1 = x0 + b, y1 = y0 + h, ox1 = ox0 + ob, oy1 = oy0 + oh;
    if (Math.abs(x1 - ox0) < tol || Math.abs(ox1 - x0) < tol) {
      if (Math.min(y1, oy1) - Math.max(y0, oy0) > tol) return true;
    }
    if (Math.abs(y1 - oy0) < tol || Math.abs(oy1 - y0) < tol) {
      if (Math.min(x1, ox1) - Math.max(x0, ox0) > tol) return true;
    }
    return false;
  }

  /** Other rectangles continuing from rect's own `end` ('s0' or 's1'). */
  function endNeighbors(rect, rects, ownAxis, end) {
    const [x0, y0, b, h] = rect;
    const [s0, s1] = ownAxis === "x" ? [x0, x0 + b] : [y0, y0 + h];
    const target = end === "s0" ? s0 : s1;
    const out = [];
    for (const other of rects) {
      if (sameRect(other, rect)) continue;
      const [ox0, oy0, ob, oh] = other;
      const [os0, os1] = ownAxis === "x" ? [ox0, ox0 + ob] : [oy0, oy0 + oh];
      if ((Math.abs(os1 - target) < 1e-6 || Math.abs(os0 - target) < 1e-6) && rectsTouch(rect, other)) {
        if (isStacked(rect, other)) continue;   // a parallel layer, not a continuation
        out.push(other);
      }
    }
    return out;
  }

  /** True when `other` is a PARALLEL layer of `rect`: same long axis and
   *  the two touch along their long edge (a stepped / thickened flange
   *  drawn as two rectangles). A collinear piece placed end to end touches
   *  along the short edge, with no overlap along the sweep. */
  function isStacked(rect, other) {
    const ownAxis = longAxis(rect);
    if (sameRect(other, rect) || longAxis(other) !== ownAxis || !rectsTouch(rect, other)) return false;
    const [x0, y0, b, h] = rect;
    const [ox0, oy0, ob, oh] = other;
    const overlap = ownAxis === "x"
      ? Math.min(x0 + b, ox0 + ob) - Math.max(x0, ox0)
      : Math.min(y0 + h, oy0 + oh) - Math.max(y0, oy0);
    return overlap > 1e-6;
  }

  function stackNeighbors(rect, rects) {
    return rects.filter((o) => isStacked(rect, o));
  }

  /** [s0, s1] minus the excluded sub-intervals:
   *  [segStart, segEnd, startIsTip, endIsTip] */
  function freeSegments(s0, s1, excluded) {
    const segs = [];
    let cursor = s0;
    const bounds = excluded.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (const [a, b] of bounds) {
      if (a > cursor) segs.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < s1) segs.push([cursor, s1]);
    return segs.map(([a, b]) => [a, b, Math.abs(a - s0) < 1e-6, Math.abs(b - s1) < 1e-6]);
  }

  /** Local first-moment profile of a constant-arm piece (the "tent"). */
  function tentProfile(s0, s1, thickness, armConst, excluded, s0Free, s1Free,
                       qAtS0, qAtS1, gapContributions, n) {
    if (n === undefined) n = 40;
    gapContributions = gapContributions || [];
    let segments = freeSegments(s0, s1, excluded).filter((sg) => sg[1] - sg[0] > 1e-9);
    if (!segments.length) return { s: [], Q: [] };

    const nFor = (a, b) => Math.max(pyRound(n * (b - a) / Math.max(s1 - s0, 1e-9)), 4);
    const gapValue = (g0, g1) => {
      let t = 0;
      for (const [a, b, v] of gapContributions) if (a >= g0 - 1e-6 && b <= g1 + 1e-6) t += v;
      return t;
    };

    let allS = [], allQ = [];

    if (s0Free && s1Free) {
      // both ends genuinely free -> classical symmetric tent for segments
      // touching a real tip; a segment trapped BETWEEN two mid-span
      // T-junctions (e.g. the flange of a pi-shaped section between its two
      // webs) has no tip of its own: anchor it forward from s0, carrying
      // the running total through the gaps.
      let running = 0;
      let prevSegEnd = null;
      for (const [segStart, segEnd, tipStart, tipEnd] of segments) {
        if (prevSegEnd !== null) running += gapValue(prevSegEnd, segStart);
        const segS = linspace(segStart, segEnd, nFor(segStart, segEnd));
        let Q;
        if (tipStart && !tipEnd) Q = segS.map((v) => thickness * (v - segStart) * armConst);
        else if (tipEnd && !tipStart) Q = segS.map((v) => thickness * (segEnd - v) * armConst);
        else if (tipStart && tipEnd) Q = segS.map((v) => thickness * Math.min(v - segStart, segEnd - v) * armConst);
        else { const r0 = running; Q = segS.map((v) => r0 + thickness * (v - segStart) * armConst); }
        allS.push(segS);
        allQ.push(Q);
        running += thickness * (segEnd - segStart) * armConst;
        prevSegEnd = segEnd;
      }
    } else if (!s0Free && s1Free) {
      // only s1 is a genuine free tip -> anchor backward from s1
      let running = qAtS1;
      let prevSegStart = null;
      const revS = [], revQ = [];
      for (let k = segments.length - 1; k >= 0; k--) {
        const [segStart, segEnd] = segments[k];
        if (prevSegStart !== null) running += gapValue(segEnd, prevSegStart);
        const segS = linspace(segStart, segEnd, nFor(segStart, segEnd));
        revS.push(segS);
        revQ.push(segS.map((v) => running + thickness * (segEnd - v) * armConst));
        running += thickness * (segEnd - segStart) * armConst;
        prevSegStart = segStart;
      }
      allS = revS.reverse();
      allQ = revQ.reverse();
    } else {
      // s0 free, or neither end free -> anchor forward from s0
      let running = qAtS0;
      let prevSegEnd = null;
      for (const [segStart, segEnd] of segments) {
        if (prevSegEnd !== null) running += gapValue(prevSegEnd, segStart);
        const segS = linspace(segStart, segEnd, nFor(segStart, segEnd));
        const r0 = running;
        allS.push(segS);
        allQ.push(segS.map((v) => r0 + thickness * (v - segStart) * armConst));
        running += thickness * (segEnd - segStart) * armConst;
        prevSegEnd = segEnd;
      }
    }
    return { s: [].concat(...allS), Q: [].concat(...allQ) };
  }

  /** Sign (+1/-1) relating the physical coordinate to the direction in
   *  which the cut advances; mirrors the anchoring in tentProfile. */
  function branchDirection(s0, s1, excluded, s0Free, s1Free, sSamples) {
    if (!s0Free && s1Free) return sSamples.map(() => -1);
    if (!(s0Free && s1Free)) return sSamples.map(() => 1);
    const sign = sSamples.map(() => 1);
    for (const [segStart, segEnd, tipStart, tipEnd] of freeSegments(s0, s1, excluded)) {
      for (let i = 0; i < sSamples.length; i++) {
        const v = sSamples[i];
        if (!(v >= segStart - 1e-9 && v <= segEnd + 1e-9)) continue;
        if (tipStart && !tipEnd) sign[i] = 1;
        else if (tipEnd && !tipStart) sign[i] = -1;
        else if (tipStart && tipEnd) { const mid = (segStart + segEnd) / 2; sign[i] = v <= mid ? 1 : -1; }
        else sign[i] = 1;   // between two mid-span junctions: anchored forward
      }
    }
    return sign;
  }

  /** Perpendicular neighbours touching rect's side WITHIN its span (a
   *  genuine mid-span T-junction) as [a, b, neighbour]. A neighbour
   *  reaching rect's own s0/s1 is a corner, found by endNeighbors. */
  function sideAttachments(rect, rects) {
    const [x0, y0, b, h] = rect;
    const ownAxis = longAxis(rect);
    const [s0, s1] = ownAxis === "x" ? [x0, x0 + b] : [y0, y0 + h];
    const out = [];
    for (const other of rects) {
      if (sameRect(other, rect) || longAxis(other) === ownAxis) continue;
      const [ox0, oy0, ob, oh] = other;
      let touches, a, bnd;
      if (ownAxis === "x") {
        touches = Math.abs(oy0 + oh - y0) < 1e-6 || Math.abs(oy0 - (y0 + h)) < 1e-6;
        a = Math.max(x0, ox0); bnd = Math.min(x0 + b, ox0 + ob);
      } else {
        touches = Math.abs(ox0 + ob - x0) < 1e-6 || Math.abs(ox0 - (x0 + b)) < 1e-6;
        a = Math.max(y0, oy0); bnd = Math.min(y0 + h, oy0 + oh);
      }
      if (touches && bnd > a && Math.abs(a - s0) > 1e-6 && Math.abs(bnd - s1) > 1e-6) out.push([a, bnd, other]);
    }
    return out;
  }

  /** Total first moment (area * constant arm) of a flange-role piece plus
   *  its whole branch: whatever continues from its own ends, and whatever
   *  hangs off its side mid-span (a rib, a second web under the same
   *  plate). `exclude` is the chain already visited -- it keeps the walk
   *  from going back where it came from (and from looping forever on a
   *  closed ring such as an I-beam under Vx). */
  function flangeTotalMoment(rect, rects, g, direction, exclude) {
    if (exclude.has(keyOf(rect))) return 0;
    const [x0, y0, b, h] = rect;
    const ownAxis = longAxis(rect);
    const ref = direction === "Vy" ? g.y_bar : g.x_bar;
    const arm = ownAxis === "x" ? y0 + h / 2 - ref : x0 + b / 2 - ref;
    let total = b * h * arm;
    const newExclude = withKey(exclude, rect);
    for (const end of ["s0", "s1"]) {
      for (const nb of endNeighbors(rect, rects, ownAxis, end)) {
        total += neighborContribution(rect, nb, rects, g, direction, newExclude);
      }
    }
    for (const [, , other] of sideAttachments(rect, rects)) {
      total += neighborContribution(rect, other, rects, g, direction, newExclude);
    }
    // parallel layers (stepped / thickened plate) belong to the same branch
    for (const other of stackNeighbors(rect, rects)) {
      total += neighborContribution(rect, other, rects, g, direction, newExclude);
    }
    return total;
  }

  function spineEvents(rect, rects, g, direction, exclude) {
    const [x0, y0, b, h] = rect;
    const ownAxis = longAxis(rect);
    const [s0, s1] = ownAxis === "x" ? [x0, x0 + b] : [y0, y0 + h];
    const thickness = ownAxis === "x" ? h : b;
    const ref = direction === "Vy" ? g.y_bar : g.x_bar;
    const attachments = [];
    // the visited chain MUST be carried into each attached flange's total
    const chain = withKey(exclude, rect);
    for (const [a, bnd, other] of sideAttachments(rect, rects)) {
      const contributed = flangeTotalMoment(other, rects, g, direction, chain);
      attachments.push([a, bnd, contributed, other]);
    }
    attachments.sort((p, q) => p[0] - q[0]);
    return { ownAxis, s0, s1, thickness, ref, attachments };
  }

  /** Cumulative Q just before `position` along a spine's own sweep: its
   *  smooth quadratic material, plus every attachment fully passed (and
   *  this spine's own material inside each attachment's stretch, once per
   *  distinct interval -- or equilibrium would break). */
  function spineBaselineAt(s0, ref, thickness, attachments, position) {
    let running = 0;
    let cursor = s0;
    for (const [a, bnd, contributed] of attachments) {
      if (a >= position) break;
      const segEnd = Math.min(a, position);
      if (segEnd > cursor) running += thickness * (Math.pow(segEnd - ref, 2) - Math.pow(cursor - ref, 2)) / 2;
      if (bnd <= position) {
        running += contributed;
        // own material inside [a, bnd], counted ONCE even when attachments
        // overlap only partially (stepped flanges on the two sides)
        const lo = Math.max(a, cursor);
        if (bnd > lo) running += thickness * (Math.pow(bnd - ref, 2) - Math.pow(lo - ref, 2)) / 2;
        cursor = Math.max(cursor, bnd);
      } else {
        cursor = position;
        break;
      }
    }
    if (cursor < position) running += thickness * (Math.pow(position - ref, 2) - Math.pow(cursor - ref, 2)) / 2;
    return running;
  }

  function spineAnchoring(rect, rects, g, direction, exclude) {
    const ev = spineEvents(rect, rects, g, direction, exclude);
    const nbS0 = endNeighbors(rect, rects, ev.ownAxis, "s0");
    const nbS1 = endNeighbors(rect, rects, ev.ownAxis, "s1");
    const newExclude = withKey(exclude, rect);
    const qAtS0 = sumOf(nbS0.map((nb) => neighborContribution(rect, nb, rects, g, direction, newExclude)));
    const qAtS1 = sumOf(nbS1.map((nb) => neighborContribution(rect, nb, rects, g, direction, newExclude)));
    return Object.assign({}, ev, { s0Free: !nbS0.length, s1Free: !nbS1.length, qAtS0, qAtS1 });
  }

  /** Total first moment of the whole branch hanging off a spine: its own
   *  material over its FULL span, every flange attached along it (each
   *  with its own sub-branch) and whatever continues from its ends --
   *  everything reachable without going back through `exclude`. A
   *  neighbour joining this spine needs exactly this as its starting
   *  value (the cut separates "its own free-tip side" from "everything
   *  else"), NOT just the stretch up to the junction, which is only right
   *  when the junction sits at the spine's own end: mid-span, a web
   *  hanging from the middle of a flange gets the flange's full moment
   *  (zero for a symmetric flange), not the half on one side of it. */
  function spineComponentTotal(rect, rects, g, direction, exclude) {
    const ev = spineEvents(rect, rects, g, direction, exclude);
    let total = ev.thickness * (Math.pow(ev.s1 - ev.ref, 2) - Math.pow(ev.s0 - ev.ref, 2)) / 2;
    for (const att of ev.attachments) total += att[2];
    const newExclude = withKey(exclude, rect);
    for (const end of ["s0", "s1"]) {
      for (const nb of endNeighbors(rect, rects, ev.ownAxis, end)) {
        total += neighborContribution(rect, nb, rects, g, direction, newExclude);
      }
    }
    for (const other of stackNeighbors(rect, rects)) {
      total += neighborContribution(rect, other, rects, g, direction, newExclude);
    }
    return total;
  }

  /** Q(s) of a piece in the SPINE role (varying arm -> parabola). */
  function spineProfile(rect, rects, g, direction, n) {
    if (n === undefined) n = 60;
    const a = spineAnchoring(rect, rects, g, direction, new Set());
    const isXSweep = a.ownAxis === "x";
    const { s0, s1, thickness, ref, attachments } = a;

    const excluded = attachments.map(([lo, hi]) => [lo, hi]);
    const segments = freeSegments(s0, s1, excluded).filter((sg) => sg[1] - sg[0] > 1e-9);
    if (!segments.length) return { s: [], Q: [], thickness, isXSweep };

    const segIntegral = (lo, sv) => thickness * (Math.pow(sv - ref, 2) - Math.pow(lo - ref, 2)) / 2;
    const allS = [], allQ = [];

    if (!a.s0Free && a.s1Free) {
      // anchor backward from s1, the only genuine free tip
      const fullTotal = spineBaselineAt(s0, ref, thickness, attachments, s1);
      for (const [segStart, segEnd] of segments) {
        const npts = Math.max(pyRound(n * (segEnd - segStart) / Math.max(s1 - s0, 1e-9)), 4);
        const segS = linspace(segStart, segEnd, npts);
        const baseAtStart = spineBaselineAt(s0, ref, thickness, attachments, segStart);
        allS.push(segS);
        // Q_B (s1-side material) = -Q_A: flip so every piece uses the same
        // sign convention and arrows / hover signs agree between pieces
        allQ.push(segS.map((v) => -(a.qAtS1 + (fullTotal - (baseAtStart + segIntegral(segStart, v))))));
      }
    } else {
      for (const [segStart, segEnd] of segments) {
        const npts = Math.max(pyRound(n * (segEnd - segStart) / Math.max(s1 - s0, 1e-9)), 4);
        const segS = linspace(segStart, segEnd, npts);
        const baseAtStart = a.qAtS0 + spineBaselineAt(s0, ref, thickness, attachments, segStart);
        allS.push(segS);
        allQ.push(segS.map((v) => baseAtStart + segIntegral(segStart, v)));
      }
    }
    return { s: [].concat(...allS), Q: [].concat(...allQ), thickness, isXSweep };
  }

  /** Contribution to rect's Q baseline from a connected neighbour (at an
   *  end, or crossing mid-span): the first moment of the WHOLE branch on
   *  the neighbour's side of the cut, whichever role it plays. */
  function neighborContribution(rect, nb, rects, g, direction, exclude) {
    if (exclude.has(keyOf(nb))) return 0;
    const newExclude = withKey(exclude, rect);
    if (isSpineRole(nb, direction)) return spineComponentTotal(nb, rects, g, direction, newExclude);
    return flangeTotalMoment(nb, rects, g, direction, newExclude);
  }

  /** Q(s) of a piece in the FLANGE role (constant arm -> linear tent). */
  function perpendicularPieceProfile(rect, rects, g, direction) {
    const [x0, y0, b, h] = rect;
    let ownAxis, s0, s1, thickness, armConst, isXSweep;
    if (direction === "Vy") {
      ownAxis = "x"; s0 = x0; s1 = x0 + b; thickness = h;
      armConst = y0 + h / 2 - g.y_bar; isXSweep = true;
    } else {
      ownAxis = "y"; s0 = y0; s1 = y0 + h; thickness = b;
      armConst = x0 + b / 2 - g.x_bar; isXSweep = false;
    }

    // Mid-span crossings: skip the local material (thin-wall hypothesis
    // breaks down there) but still fold the crossing branch's total -- and
    // this piece's own material inside the stretch -- into the running
    // total, or the sign flip downstream of the crossing would vanish and
    // equilibrium would break.
    const crossings = sideAttachments(rect, rects);
    const excluded = crossings.map(([a, bnd]) => [a, bnd]);
    const gapContributions = crossings.map(([a, bnd, other]) =>
      [a, bnd, neighborContribution(rect, other, rects, g, direction, new Set([keyOf(rect)]))]);
    const uniqueGaps = [];
    for (const [a, bnd] of excluded.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
      if (uniqueGaps.length && a <= uniqueGaps[uniqueGaps.length - 1][1] + 1e-6) {
        uniqueGaps[uniqueGaps.length - 1] = [uniqueGaps[uniqueGaps.length - 1][0],
          Math.max(uniqueGaps[uniqueGaps.length - 1][1], bnd)];
      } else {
        uniqueGaps.push([a, bnd]);
      }
    }
    for (const [a, bnd] of uniqueGaps) gapContributions.push([a, bnd, thickness * armConst * (bnd - a)]);

    const nbS0 = endNeighbors(rect, rects, ownAxis, "s0");
    const nbS1 = endNeighbors(rect, rects, ownAxis, "s1");
    const s0Free = !nbS0.length, s1Free = !nbS1.length;
    const seed = new Set([keyOf(rect)]);
    const qAtS0 = sumOf(nbS0.map((nb) => neighborContribution(rect, nb, rects, g, direction, seed)));
    const qAtS1 = sumOf(nbS1.map((nb) => neighborContribution(rect, nb, rects, g, direction, seed)));

    const prof = tentProfile(s0, s1, thickness, armConst, excluded, s0Free, s1Free, qAtS0, qAtS1, gapContributions);
    return { s: prof.s, Q: prof.Q, thickness, isXSweep, s0Free, s1Free };
  }

  /** +1/-1: which side of the piece has more real clearance. */
  function chooseOffsetSign(rect, rects, axis) {
    const [x0, y0, b, h] = rect;
    const others = rects.filter((r) => !sameRect(r, rect));
    if (axis === "y") {
      const up = [], down = [];
      for (const [ox0, oy0, ob, oh] of others) {
        const overlapX = ox0 < x0 + b && ox0 + ob > x0;
        if (overlapX && oy0 + oh <= y0 + 1e-9) up.push(oy0 + oh);
        if (overlapX && oy0 >= y0 + h - 1e-9) down.push(oy0);
      }
      const clUp = up.length ? y0 - maxOf(up) : Infinity;
      const clDown = down.length ? minOf(down) - (y0 + h) : Infinity;
      return clUp >= clDown ? -1 : 1;
    }
    const left = [], right = [];
    for (const [ox0, oy0, ob, oh] of others) {
      const overlapY = oy0 < y0 + h && oy0 + oh > y0;
      if (overlapY && ox0 + ob <= x0 + 1e-9) left.push(ox0 + ob);
      if (overlapY && ox0 >= x0 + b - 1e-9) right.push(ox0);
    }
    const clLeft = left.length ? x0 - maxOf(left) : Infinity;
    const clRight = right.length ? minOf(right) - (x0 + b) : Infinity;
    return clLeft >= clRight ? -1 : 1;
  }

  /** Index ranges [i0, i1) of contiguous runs (excluded gaps skipped). */
  function splitAtGaps(s) {
    if (s.length < 2) return [[0, s.length]];
    const diffs = [];
    for (let i = 0; i < s.length - 1; i++) diffs.push(s[i + 1] - s[i]);
    const pos = diffs.filter((d) => d > 0);
    const step = pos.length ? median(pos) : 1;
    const bounds = [0];
    for (let i = 0; i < diffs.length; i++) if (diffs[i] > 3 * step) bounds.push(i + 1);
    bounds.push(s.length);
    const out = [];
    for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] > bounds[i]) out.push([bounds[i], bounds[i + 1]]);
    return out;
  }

  // =====================================================================
  // closed single-cell sections
  //
  // The open-section Jourawski logic needs a free tip to start from. A
  // closed cell has none, so the loop is CUT (a hairline gap in one wall)
  // to get an open tree, the open flow is computed on it, and a constant
  // flow q0 is added around the loop so that the cell does not twist:
  //     closed-integral( q / b ds ) = 0   ->   q0 = -oint(q_open/b) / oint(1/b)
  // This is the shear flow of a force acting through the shear center.
  // =====================================================================

  function uniqSorted(vals) {
    const v = vals.slice().sort((a, b) => a - b);
    const out = [];
    for (const x of v) if (!out.length || x - out[out.length - 1] > 1e-9) out.push(x);
    return out;
  }

  /** Enclosed voids of the union of rectangles: connected components of
   *  uncovered grid cells that cannot reach the outside. */
  function findHoles(rects) {
    const xs = uniqSorted(rects.flatMap((r) => [r[0], r[0] + r[2]]));
    const ys = uniqSorted(rects.flatMap((r) => [r[1], r[1] + r[3]]));
    const nx = xs.length - 1, ny = ys.length - 1;
    if (nx < 1 || ny < 1) return [];
    const W = nx + 2, H = ny + 2;
    const covered = new Array(W * H).fill(false);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
        if (rects.some((r) => cx > r[0] && cx < r[0] + r[2] && cy > r[1] && cy < r[1] + r[3])) {
          covered[(j + 1) * W + (i + 1)] = true;
        }
      }
    }
    const seen = new Array(W * H).fill(false);
    const cellArea = (idx) => {
      const i = (idx % W) - 1, j = Math.floor(idx / W) - 1;
      return (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    };
    const flood = (start) => {
      let area = 0;
      const stack = [start];
      seen[start] = true;
      while (stack.length) {
        const c = stack.pop();
        const i = c % W, j = Math.floor(c / W);
        if (i >= 1 && i <= nx && j >= 1 && j <= ny) area += cellArea(c);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const k = jj * W + ii;
          if (!seen[k] && !covered[k]) { seen[k] = true; stack.push(k); }
        }
      }
      return area;
    };
    flood(0);                       // the outside
    const holes = [];
    for (let k = 0; k < W * H; k++) if (!seen[k] && !covered[k]) holes.push({ area: flood(k) });
    return holes;
  }

  const thicknessOf = (r) => Math.min(r[2], r[3]);

  /** null when the section has no hole. Otherwise
   *  { supported, cells, note, cutRects, loop (Map cutRects index -> {sigma,R0,R1,b}),
   *    walls [{rect, thickness, length, sigma}], omega, orient }.
   *  opts (tests only): { cutPiece, cutFrac } */
  function closedSectionAnalysis(rects, opts) {
    opts = opts || {};
    const holes = findHoles(rects);
    if (!holes.length) return null;
    if (holes.length > 1) {
      return { supported: false, cells: holes.length,
        note: `closed section with ${holes.length} cells: multi-cell sections are not supported yet, shear/torsion results are NOT reliable` };
    }
    const fail = (why) => ({ supported: false, cells: 1,
      note: `closed single-cell section not supported (${why}): shear/torsion results are NOT reliable` });

    const sb = sectionBounds(rects);
    const spanRef = Math.max(sb.xmax - sb.xmin, sb.ymax - sb.ymin, 1);
    const eps = 1e-4 * spanRef;
    const frac = opts.cutFrac === undefined ? 0.5 : opts.cutFrac;

    const cands = [];
    rects.forEach((r, i) => {
      if (opts.cutPiece !== undefined && opts.cutPiece !== i) return;
      const ax = longAxis(r);
      const [s0, s1] = ax === "x" ? [r[0], r[0] + r[2]] : [r[1], r[1] + r[3]];
      const th = thicknessOf(r);
      for (const [a, b] of freeSegments(s0, s1, excludedIntervals(r, rects)).map((sg) => [sg[0], sg[1]])) {
        const sc = a + frac * (b - a);
        if (sc - s0 > 1.05 * th && s1 - sc > 1.05 * th) cands.push({ i, ax, s0, s1, sc, len: b - a });
      }
    });
    cands.sort((p, q) => q.len - p.len);

    let sawParallel = false;
    for (const c of cands) {
      const r = rects[c.i];
      const lo = c.ax === "x" ? [r[0], r[1], c.sc - eps / 2 - r[0], r[3]] : [r[0], r[1], r[2], c.sc - eps / 2 - r[1]];
      const hi = c.ax === "x"
        ? [c.sc + eps / 2, r[1], r[0] + r[2] - c.sc - eps / 2, r[3]]
        : [r[0], c.sc + eps / 2, r[2], r[1] + r[3] - c.sc - eps / 2];
      const cut = rects.slice();
      cut[c.i] = lo;
      cut.push(hi);
      if (findHoles(cut).length !== 0) continue;            // this wall is not on the loop
      const iLo = c.i, iHi = cut.length - 1, n = cut.length;

      // shortest path hi -> lo in the touching graph (a tree: it is THE loop)
      const parent = new Array(n).fill(-2);
      parent[iHi] = -1;
      const queue = [iHi];
      while (queue.length) {
        const u = queue.shift();
        for (let v = 0; v < n; v++) {
          if (parent[v] === -2 && v !== u && rectsTouch(cut[u], cut[v])) { parent[v] = u; queue.push(v); }
        }
      }
      if (parent[iLo] === -2) continue;
      const path = [];
      for (let v = iLo; v !== -1; v = parent[v]) path.push(v);
      path.reverse();                                       // [hi, p1, ..., p_{k-1}, lo]
      const k = path.length - 1;
      if (k < 4) continue;

      let ok = true;
      for (let j = 0; j < k; j++) if (longAxis(cut[path[j]]) === longAxis(cut[path[j + 1]])) ok = false;
      if (!ok) { sawParallel = true; continue; }

      const mid = (q) => [q[0] + q[2] / 2, q[1] + q[3] / 2];
      const vertex = (A, B) => {
        const [ax, ay] = mid(A), [bx, by] = mid(B);
        return longAxis(A) === "x" ? [bx, ay] : [ax, by];
      };
      const vs = [vertex(cut[path[0]], cut[path[1]])];
      for (let j = 1; j <= k - 1; j++) vs.push(vertex(cut[path[j]], cut[path[j + 1]]));
      // vs[j] joins path[j] and path[j+1] (vs[0]: P/p1 ... vs[k-1]: p_{k-1}/P)

      let area2 = 0;
      for (let j = 0; j < k; j++) {
        const [xa, ya] = vs[j], [xb, yb] = vs[(j + 1) % k];
        area2 += xa * yb - xb * ya;
      }
      const omega = Math.abs(area2) / 2;
      const orient = area2 > 0 ? 1 : -1;                    // +1: counterclockwise on screen
      const coord = (v, ax) => (ax === "x" ? v[0] : v[1]);

      const loop = new Map();
      const walls = [];
      const axP = c.ax;
      const sigmaP = Math.sign(coord(vs[0], axP) - coord(vs[k - 1], axP));
      if (sigmaP === 0 || omega <= 0) { ok = false; }
      if (!ok) continue;
      const thP = thicknessOf(r);
      const scLo = c.sc - eps / 2, scHi = c.sc + eps / 2;
      const c0 = coord(vs[0], axP), cK = coord(vs[k - 1], axP);
      loop.set(iLo, { sigma: sigmaP, R0: Math.min(cK, scLo), R1: Math.max(cK, scLo), b: thP });
      loop.set(iHi, { sigma: sigmaP, R0: Math.min(scHi, c0), R1: Math.max(scHi, c0), b: thP });
      walls.push({ rect: r, thickness: thP, length: Math.abs(c0 - cK), sigma: sigmaP });
      for (let j = 1; j <= k - 1; j++) {
        const w = cut[path[j]], ax = longAxis(w);
        const sIn = coord(vs[j - 1], ax), sOut = coord(vs[j], ax);
        const sg = Math.sign(sOut - sIn);
        if (sg === 0) { ok = false; break; }
        loop.set(path[j], { sigma: sg, R0: Math.min(sIn, sOut), R1: Math.max(sIn, sOut), b: thicknessOf(w) });
        walls.push({ rect: w, thickness: thicknessOf(w), length: Math.abs(sOut - sIn), sigma: sg });
      }
      if (!ok) continue;
      return { supported: true, cells: 1, cutRects: cut, loop, walls, omega, orient };
    }
    return fail(sawParallel ? "walls of the loop are offset from each other" : "could not open the loop");
  }

  /** Integral of a piecewise-linear q(s) (constant outside the samples). */
  function integratePiecewise(s, q, R0, R1) {
    const f = (x) => {
      if (x <= s[0]) return q[0];
      if (x >= s[s.length - 1]) return q[q.length - 1];
      let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= x) lo = m; else hi = m; }
      const d = s[hi] - s[lo];
      return d < 1e-12 ? q[hi] : q[lo] + (q[hi] - q[lo]) * (x - s[lo]) / d;
    };
    const pts = [R0, R1];
    for (const v of s) if (v > R0 && v < R1) pts.push(v);
    pts.sort((a, b) => a - b);
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += (f(pts[i]) + f(pts[i + 1])) / 2 * (pts[i + 1] - pts[i]);
    return total;
  }

  function shearRibbonsForDirection(rects, g, V, direction, bbox, color, lineColor, closed) {
    const [sxmin, sxmax, symin, symax] = bbox;
    const spanRef = Math.max(sxmax - sxmin, symax - symin, 1);
    const gap = 0.05 * spanRef;

    const traces = [];
    let tauMax = 0;
    let locMax = [g.x_bar, g.y_bar];
    let vxmin = sxmin, vxmax = sxmax, vymin = symin, vymax = symax;

    const perPiece = [];
    const allAbs = [];
    const I = direction === "Vy" ? g.Ix : g.Iy;

    // pass 1: open-section profiles (on the cut section for a closed cell)
    const prof = [];
    for (const rect of rects) {
      const perpendicular = !isSpineRole(rect, direction);
      let s, Q, thickness, isXSweep, s0Free = null, s1Free = null, kappa;
      if (perpendicular) {
        const p = perpendicularPieceProfile(rect, rects, g, direction);
        s = p.s; Q = p.Q; thickness = p.thickness; isXSweep = p.isXSweep; s0Free = p.s0Free; s1Free = p.s1Free;
        kappa = s.length
          ? branchDirection(s[0], s[s.length - 1], sideAttachments(rect, rects).map(([a, bnd]) => [a, bnd]), s0Free, s1Free, s)
          : [];
      } else {
        const p = spineProfile(rect, rects, g, direction);
        s = p.s; Q = p.Q; thickness = p.thickness; isXSweep = p.isXSweep;
        kappa = s.map(() => 1);
      }
      prof.push({ rect, s, Q, thickness, isXSweep, perpendicular, s0Free, s1Free, kappa });
    }

    // pass 2: closed cell -> constant flow q0 around the loop (zero twist).
    // Signed flow along +s of a piece: q_s = -kappa * V * Q / I.
    let q0 = 0;
    if (closed && closed.supported) {
      let num = 0, den = 0;
      prof.forEach((p, i) => {
        const info = closed.loop.get(i);
        if (!info) return;
        den += (info.R1 - info.R0) / info.b;
        if (!p.s.length) return;
        const qLoop = p.Q.map((q, k) => info.sigma * (-p.kappa[k] * V * q / I));
        num += integratePiecewise(p.s, qLoop, info.R0, info.R1) / info.b;
      });
      q0 = den > 0 ? -num / den : 0;
      prof.forEach((p, i) => {
        const info = closed.loop.get(i);
        if (!info || !p.s.length) return;
        p.Q = p.Q.map((q, k) => q - info.sigma * q0 * I / (p.kappa[k] * V));
      });
    }

    for (const p of prof) {
      const { rect, s, Q, thickness, isXSweep, perpendicular, s0Free, s1Free } = p;
      const tau = Q.map((q) => V * q / (I * thickness));
      perPiece.push({ rect, s, tau, isXSweep, perpendicular, s0Free, s1Free, kappa: p.kappa });
      allAbs.push(tau.length ? absMax(tau) : 0);
    }

    const vmax = Math.max(allAbs.length ? maxOf(allAbs) : 0, 1e-9);
    const scale = 0.22 * spanRef / vmax;

    const perPieceAnnotations = [];
    const flowAnnotations = [];

    for (const piece of perPiece) {
      const { rect, s, tau, isXSweep, perpendicular, s0Free, s1Free } = piece;
      if (!s.length) continue;
      const [x0, y0, b, h] = rect;
      const tauAbs = tau.map(Math.abs);
      const pieceMax = maxOf(tauAbs);
      const iPeak = argmax(tauAbs);

      if (pieceMax > tauMax) {
        tauMax = pieceMax;
        locMax = isXSweep ? [s[iPeak], y0 + h / 2] : [x0 + b / 2, s[iPeak]];
      }

      let sign, peakX, peakY, hoverX, hoverY, segments, dirSign, flowPoints = [];
      const gaps = splitAtGaps(s);
      const nIdx = Array.from(linspace(2, s.length - 3, 4), Math.trunc);

      if (isXSweep) {
        // ribbon runs along x (s = x), bulges in y
        sign = chooseOffsetSign(rect, rects, "y");
        const baseY = sign < 0 ? y0 - gap : y0 + h + gap;
        const outerY = tauAbs.map((t) => baseY + sign * scale * t);
        vymin = Math.min(vymin, minOf(outerY)); vymax = Math.max(vymax, maxOf(outerY));
        peakX = s[iPeak]; peakY = outerY[iPeak];
        hoverX = s; hoverY = outerY;
        const midY = y0 + h / 2;
        segments = gaps.map(([i0, i1]) => [
          s.slice(i0, i1).concat(s.slice(i0, i1).reverse()),
          outerY.slice(i0, i1).concat(new Array(i1 - i0).fill(baseY)),
        ]);
        dirSign = perpendicular
          ? branchDirection(s[0], s[s.length - 1], sideAttachments(rect, rects).map(([a, bnd]) => [a, bnd]), s0Free, s1Free, s)
          : null;
        for (const i of nIdx) {
          if (i < 0 || i >= s.length || Math.abs(tau[i]) < 1e-9) continue;
          const dx = perpendicular ? dirSign[i] * (tau[i] < 0 ? 1 : -1) : (tau[i] >= 0 ? -1 : 1);
          flowPoints.push([s[i], midY, [dx, 0]]);
        }
      } else {
        // ribbon runs along y (s = y), bulges in x
        sign = chooseOffsetSign(rect, rects, "x");
        const baseX = sign < 0 ? x0 - gap : x0 + b + gap;
        const outerX = tauAbs.map((t) => baseX + sign * scale * t);
        vxmin = Math.min(vxmin, minOf(outerX)); vxmax = Math.max(vxmax, maxOf(outerX));
        peakX = outerX[iPeak]; peakY = s[iPeak];
        hoverX = outerX; hoverY = s;
        const midX = x0 + b / 2;
        segments = gaps.map(([i0, i1]) => [
          outerX.slice(i0, i1).concat(new Array(i1 - i0).fill(baseX)),
          s.slice(i0, i1).concat(s.slice(i0, i1).reverse()),
        ]);
        dirSign = perpendicular
          ? branchDirection(s[0], s[s.length - 1], sideAttachments(rect, rects).map(([a, bnd]) => [a, bnd]), s0Free, s1Free, s)
          : null;
        for (const i of nIdx) {
          if (i < 0 || i >= s.length || Math.abs(tau[i]) < 1e-9) continue;
          const dy = perpendicular ? dirSign[i] * (tau[i] < 0 ? 1 : -1) : (tau[i] >= 0 ? -1 : 1);
          flowPoints.push([midX, s[i], [0, dy]]);
        }
      }

      const arrowLen = 0.10 * spanRef;
      for (const [px, py, [dx, dy]] of flowPoints) {
        flowAnnotations.push({
          x: px + arrowLen / 2 * dx, y: py + arrowLen / 2 * dy,
          ax: px - arrowLen / 2 * dx, ay: py - arrowLen / 2 * dy,
          axref: "x", ayref: "y", xref: "x", yref: "y",
          showarrow: true, arrowhead: 2, arrowsize: 1, arrowwidth: 1.8,
          arrowcolor: lineColor, text: "",
        });
      }

      for (const [px, py] of segments) {
        traces.push({
          type: "scatter", x: px, y: py, mode: "lines", fill: "toself",
          line: { color: lineColor, width: 1.5 }, fillcolor: color,
          hoverinfo: "skip", showlegend: false,
        });
      }

      // thin line along the outer edge, only to enable hovering tau
      for (const [i0, i1] of gaps) {
        traces.push({
          type: "scatter", x: hoverX.slice(i0, i1), y: hoverY.slice(i0, i1), mode: "lines",
          line: { color: lineColor, width: 0.5 },
          customdata: tau.slice(i0, i1),
          hovertemplate: `${direction.replace("V", "T")}<br>τ=%{customdata:.2f} MPa<extra></extra>`,
          showlegend: false,
        });
      }

      if (pieceMax > 1e-6) {
        perPieceAnnotations.push({
          x: peakX, y: peakY, text: pieceMax.toFixed(1),
          showarrow: false, font: { size: 9, color: lineColor },
          xanchor: isXSweep ? "center" : "left",
          yanchor: isXSweep ? (sign < 0 ? "top" : "bottom") : "middle",
          xshift: isXSweep ? 0 : 4,
        });
      }
    }

    const globalAnnotation = tauMax > 1e-9 ? [{
      x: locMax[0], y: locMax[1], text: `${direction.replace("V", "T")}: max ≈ ${tauMax.toFixed(1)} MPa`,
      showarrow: false, font: { size: 10, color: "black" },
      bgcolor: "white", bordercolor: lineColor, borderwidth: 1,
      xanchor: "left", yanchor: "bottom", xshift: 8, yshift: 8,
    }] : [];

    return {
      traces, annotations: flowAnnotations.concat(perPieceAnnotations, globalAnnotation),
      tauMax, locMax, view: [vxmin, vxmax, vymin, vymax],
      debug: { perPiece, q0 },
    };
  }

  /** Per-rectangle Jourawski analysis drawn in the same plot as the
   *  section. Vx, Vy already in N. */
  function buildShearFigure(rects, g, Vx, Vy, opts) {
    const { xmin, xmax, ymin, ymax } = sectionBounds(rects);
    const bbox = [xmin, xmax, ymin, ymax];

    const shapes = rectShapes(rects, "lightgray", 0.5);
    // closed single-cell section: analyse the loop-opened copy of the section
    const closed = closedSectionAnalysis(rects, opts);
    const work = closed && closed.supported ? closed.cutRects : rects;
    let traces = [], annotations = [];
    let tauMaxVy = 0, tauMaxVx = 0;
    let locVy = [g.x_bar, g.y_bar], locVx = [g.x_bar, g.y_bar];
    let vxmin = xmin, vxmax = xmax, vymin = ymin, vymax = ymax;

    const merge = (r) => {
      traces = traces.concat(r.traces);
      annotations = annotations.concat(r.annotations);
      vxmin = Math.min(vxmin, r.view[0]); vxmax = Math.max(vxmax, r.view[1]);
      vymin = Math.min(vymin, r.view[2]); vymax = Math.max(vymax, r.view[3]);
    };
    if (Math.abs(Vy) > 1e-9) {
      const r = shearRibbonsForDirection(work, g, Vy, "Vy", bbox, "rgba(0,100,0,0.30)", "darkgreen", closed);
      tauMaxVy = r.tauMax; locVy = r.locMax; merge(r);
    }
    if (Math.abs(Vx) > 1e-9) {
      const r = shearRibbonsForDirection(work, g, Vx, "Vx", bbox, "rgba(255,140,0,0.30)", "darkorange", closed);
      tauMaxVx = r.tauMax; locVx = r.locMax; merge(r);
    }

    traces.push({
      type: "scatter", x: [g.x_bar], y: [g.y_bar], mode: "markers",
      marker: { color: "black", size: 7 }, showlegend: false, hovertemplate: "centroid<extra></extra>",
    });

    const tauMax = Math.max(tauMaxVy, tauMaxVx);
    const locMax = tauMaxVy >= tauMaxVx ? locVy : locVx;
    const [xr, yr] = viewRange(vxmin, vxmax, vymin, vymax);

    const layout = templateLook({
      shapes, annotations,
      xaxis: { range: xr, title: { text: "x [mm]" }, zeroline: false },
      yaxis: { range: yr, title: { text: "y [mm]" }, zeroline: false, scaleanchor: "x", scaleratio: 1 },
      margin: { l: 50, r: 30, t: 30, b: 50 }, height: 560, showlegend: false, dragmode: "pan",
    });
    return { fig: { data: traces, layout }, tauMax, locMax,
      closed: closed ? { supported: closed.supported, cells: closed.cells, note: closed.note || null } : null };
  }

  // =====================================================================
  // torsion of open thin-walled sections (Saint-Venant)
  //   J = (1/3) sum(L_i t_i^3),  tau(n) = 2 T n / J,  tau_max,i = T t_i / J
  // Positive T = counterclockwise.
  // =====================================================================

  function torsionEffectiveSpan(rect, rects) {
    const [x0, y0, b, h] = rect;
    const ownAxis = longAxis(rect);
    const [s0, s1] = ownAxis === "x" ? [x0, x0 + b] : [y0, y0 + h];
    return { s0, s1, thickness: Math.min(b, h), excluded: excludedIntervals(rect, rects) };
  }

  function computeTorsionConstant(rects) {
    let J = 0;
    for (const rect of rects) {
      const { s0, s1, thickness, excluded } = torsionEffectiveSpan(rect, rects);
      let length = s1 - s0;
      for (const [a, b] of excluded) length -= b - a;
      J += Math.max(length, 0) * Math.pow(thickness, 3) / 3;
    }
    return J;
  }

  /** Torsion constant. Open sections: Saint-Venant, J = sum(L b^3 / 3).
   *  Single closed cell (Bredt): Jc = 4 Omega^2 / oint(ds/b), plus the
   *  Saint-Venant term of every wall NOT in the loop (fins, outstands); the
   *  twisting moment splits in proportion to J (same twist rate). */
  function torsionModel(rects) {
    const closed = closedSectionAnalysis(rects);
    if (!closed || !closed.supported) return { J: computeTorsionConstant(rects), closed };
    const loopKeys = new Set(closed.walls.map((w) => keyOf(w.rect)));
    let sumLb = 0;
    for (const w of closed.walls) sumLb += w.length / w.thickness;
    const Jc = 4 * closed.omega * closed.omega / sumLb;
    let Jo = 0;
    for (const rect of rects) {
      if (loopKeys.has(keyOf(rect))) continue;
      const { s0, s1, thickness, excluded } = torsionEffectiveSpan(rect, rects);
      let length = s1 - s0;
      for (const [a, b] of excluded) length -= b - a;
      Jo += Math.max(length, 0) * Math.pow(thickness, 3) / 3;
    }
    return { J: Jc + Jo, Jc, Jo, closed };
  }

  /** For every grid point, the signed distance n from its own
   *  rectangle's mid-thickness line (NaN outside / in shared corners). */
  function torsionNField(rects, X, Y) {
    const ny = Y.length, nx = X.length;
    const field = [];
    for (let i = 0; i < ny; i++) field.push(new Array(nx).fill(NaN));
    for (const rect of rects) {
      const [x0, y0, b, h] = rect;
      const { excluded } = torsionEffectiveSpan(rect, rects);
      for (let i = 0; i < ny; i++) {
        for (let j = 0; j < nx; j++) {
          const x = X[j], y = Y[i];
          if (!(x >= x0 && x <= x0 + b && y >= y0 && y <= y0 + h)) continue;
          if (b >= h) {
            if (excluded.some(([a, bnd]) => x >= a && x <= bnd)) continue;
            field[i][j] = -(y - (y0 + h / 2));
          } else {
            if (excluded.some(([a, bnd]) => y >= a && y <= bnd)) continue;
            field[i][j] = x - (x0 + b / 2);
          }
        }
      }
    }
    return field;
  }

  function buildTorsionFigure(rects, g, T) {
    const model = torsionModel(rects);
    const J = model.J;
    const { xmin, xmax, ymin, ymax } = sectionBounds(rects);

    // closed cell: uniform tau = q / b around the loop, q = Mz (Jc/J) / (2 Omega),
    // signed along +s of each wall (+x horizontal, +y vertical)
    // loopTau: value shown / colour (circulation sign: same sign on the whole
    // loop, positive = counterclockwise like Mz); loopDir: +1/-1 direction of
    // the flow along +s of each wall, only used for the arrows
    const loopTau = new Map();
    const loopDir = new Map();
    if (model.closed && model.closed.supported && J > 0) {
      const q = T * (model.Jc / J) / (2 * model.closed.omega);
      for (const w of model.closed.walls) {
        loopTau.set(keyOf(w.rect), q / w.thickness);
        loopDir.set(keyOf(w.rect), (q >= 0 ? 1 : -1) * model.closed.orient * w.sigma);
      }
    }

    const nx = 260, ny = 260;
    const X = linspace(xmin, xmax, nx);
    const Y = linspace(ymin, ymax, ny);
    const nField = torsionNField(rects, X, Y);
    const tauField = nField.map((row) => row.map((n) => (Number.isNaN(n) ? null : (J > 0 ? 2 * T * n / J : 0))));
    for (const rect of rects) {
      const tl = loopTau.get(keyOf(rect));
      if (tl === undefined) continue;
      const [x0, y0, b, h] = rect;
      for (let i = 0; i < ny; i++) {
        for (let j = 0; j < nx; j++) {
          if (tauField[i][j] !== null && X[j] >= x0 && X[j] <= x0 + b && Y[i] >= y0 && Y[i] <= y0 + h) tauField[i][j] = tl;
        }
      }
    }

    let tauMax = 0;
    let locMax = [g.x_bar, g.y_bar];
    const perSegAnnotations = [];
    const flowAnnotations = [];
    for (const [x0, y0, b, h] of rects) {
      const thickness = Math.min(b, h);
      const tlSeg = loopTau.get(keyOf([x0, y0, b, h]));
      const segTauMax = tlSeg !== undefined ? Math.abs(tlSeg) : (J > 0 ? Math.abs(T) * thickness / J : 0);
      if (segTauMax > tauMax) { tauMax = segTauMax; locMax = [x0 + b / 2, y0 + h / 2]; }
      if (segTauMax > 1e-6) {
        perSegAnnotations.push({
          x: x0 + b / 2, y: y0 + h / 2, text: segTauMax.toFixed(1),
          showarrow: false, font: { size: 9, color: "black" },
        });
      }
    }
    const vmax = Math.max(tauMax, 1e-9);

    const data = [{
      type: "heatmap", x: X, y: Y, z: tauField,
      colorscale: "RdBu", reversescale: true, zmid: 0, zmin: -vmax, zmax: vmax,
      colorbar: { title: { text: "τ_t [MPa]" } },
      hovertemplate: "x=%{x:.2f} mm<br>y=%{y:.2f} mm<br>τ=%{z:.2f} MPa<extra></extra>",
    }];
    const shapes = rectShapes(rects, "rgba(0,0,0,0)", 1.0);

    const spanRef = Math.max(xmax - xmin, ymax - ymin, 1);
    const gap = 0.05 * spanRef;
    const scale = 0.20 * spanRef / vmax;
    const clearance = gap + scale * vmax;
    let vxmin = xmin, vxmax = xmax, vymin = ymin, vymax = ymax;

    const arrow = (x, y, ax, ay) => ({
      x, y, ax, ay, axref: "x", ayref: "y", xref: "x", yref: "y",
      showarrow: true, arrowhead: 2, arrowsize: 1, arrowwidth: 1.6, arrowcolor: "black", text: "",
    });

    for (const rect of rects) {
      const [x0, y0, b, h] = rect;
      const tlRect = loopTau.get(keyOf(rect));
      let s, tauS, base, outer, hoverX, hoverY;
      if (b >= h) {
        s = linspace(y0, y0 + h, 20);
        const nvals = s.map((v) => -(v - (y0 + h / 2)));
        tauS = nvals.map((n) => (tlRect !== undefined ? tlRect : (J > 0 ? 2 * T * n / J : 0)));
        const sign = chooseOffsetSign(rect, rects, "x");
        base = sign < 0 ? x0 - clearance : x0 + b + clearance;
        outer = tauS.map((t) => base + sign * scale * t);
        hoverX = outer; hoverY = s;
        vxmin = Math.min(vxmin, minOf(outer)); vxmax = Math.max(vxmax, maxOf(outer));
      } else {
        s = linspace(x0, x0 + b, 20);
        const nvals = s.map((v) => v - (x0 + b / 2));
        tauS = nvals.map((n) => (tlRect !== undefined ? tlRect : (J > 0 ? 2 * T * n / J : 0)));
        const sign = chooseOffsetSign(rect, rects, "y");
        base = sign < 0 ? y0 - clearance : y0 + h + clearance;
        outer = tauS.map((t) => base + sign * scale * t);
        hoverX = s; hoverY = outer;
        vymin = Math.min(vymin, minOf(outer)); vymax = Math.max(vymax, maxOf(outer));
      }

      const arrowLen = 0.08 * spanRef;
      const Tsign = T >= 0 ? 1 : -1;
      const span = torsionEffectiveSpan(rect, rects);
      if (Math.abs(T) > 1e-9 && J > 0) {
        const freeSegs = freeSegments(span.s0, span.s1, span.excluded)
          .filter((sg) => sg[1] - sg[0] > 1e-6).map((sg) => [sg[0], sg[1]]);
        for (const [segA, segB] of freeSegs) {
          const pts = linspace(segA + 0.1 * (segB - segA), segB - 0.1 * (segB - segA), 3);
          for (const p of pts) {
            if (tlRect !== undefined) {
              // closed loop: one arrow on the midline, along the circulation
              const sg = loopDir.get(keyOf(rect));
              if (b >= h) flowAnnotations.push(arrow(p + arrowLen / 2 * sg, y0 + h / 2, p - arrowLen / 2 * sg, y0 + h / 2));
              else flowAnnotations.push(arrow(x0 + b / 2, p + arrowLen / 2 * sg, x0 + b / 2, p - arrowLen / 2 * sg));
            } else if (b >= h) {
              // top edge (y0): tau sign = +Tsign ; bottom edge (y0+h): -Tsign
              flowAnnotations.push(arrow(p + arrowLen / 2 * Tsign, y0, p - arrowLen / 2 * Tsign, y0));
              flowAnnotations.push(arrow(p - arrowLen / 2 * Tsign, y0 + h, p + arrowLen / 2 * Tsign, y0 + h));
            } else {
              // right edge (x0+b): +Tsign ; left edge (x0): -Tsign
              flowAnnotations.push(arrow(x0 + b, p + arrowLen / 2 * Tsign, x0 + b, p - arrowLen / 2 * Tsign));
              flowAnnotations.push(arrow(x0, p - arrowLen / 2 * Tsign, x0, p + arrowLen / 2 * Tsign));
            }
          }
        }
      }

      const mid = Math.floor(s.length / 2);
      const halves = tlRect !== undefined
        // closed loop: uniform stress across the thickness, one colour (blue = positive)
        ? [[0, s.length, tlRect >= 0 ? "rgba(30,60,200,0.28)" : "rgba(200,30,30,0.28)",
            tlRect >= 0 ? "rgba(20,40,150,0.8)" : "rgba(150,20,20,0.8)"]]
        : [
          [0, mid + 1, "rgba(30,60,200,0.28)", "rgba(20,40,150,0.8)"],
          [mid, s.length, "rgba(200,30,30,0.28)", "rgba(150,20,20,0.8)"],
        ];
      for (const [i0, i1, col, lcol] of halves) {
        let px, py;
        if (b >= h) {
          px = outer.slice(i0, i1).concat(new Array(i1 - i0).fill(base));
          py = s.slice(i0, i1).concat(s.slice(i0, i1).reverse());
        } else {
          px = s.slice(i0, i1).concat(s.slice(i0, i1).reverse());
          py = outer.slice(i0, i1).concat(new Array(i1 - i0).fill(base));
        }
        data.push({
          type: "scatter", x: px, y: py, mode: "lines", fill: "toself",
          line: { color: lcol, width: 1.2 }, fillcolor: col, hoverinfo: "skip", showlegend: false,
        });
      }
      data.push({
        type: "scatter", x: hoverX, y: hoverY, mode: "lines",
        line: { color: "rgba(0,0,0,0.4)", width: 0.5 },
        customdata: tauS, hovertemplate: "τ=%{customdata:.2f} MPa<extra></extra>", showlegend: false,
      });
    }

    data.push({
      type: "scatter", x: [g.x_bar], y: [g.y_bar], mode: "markers",
      marker: { color: "black", size: 7 }, showlegend: false, hovertemplate: "centroid<extra></extra>",
    });

    let annotations = flowAnnotations.concat(perSegAnnotations);
    if (tauMax > 1e-9) {
      annotations = annotations.concat([{
        x: locMax[0], y: locMax[1], text: `max ≈ ${tauMax.toFixed(2)} MPa`,
        showarrow: false, font: { size: 11, color: "black" },
        bgcolor: "white", bordercolor: "black", borderwidth: 1,
        xanchor: "left", yanchor: "bottom", xshift: 8, yshift: 8,
      }]);
    }

    const [xr, yr] = viewRange(vxmin, vxmax, vymin, vymax);
    const layout = templateLook({
      shapes, annotations,
      xaxis: { range: xr, title: { text: "x [mm]" }, zeroline: false },
      yaxis: { range: yr, title: { text: "y [mm]" }, zeroline: false, scaleanchor: "x", scaleratio: 1 },
      margin: { l: 50, r: 30, t: 30, b: 50 }, height: 560, showlegend: false, dragmode: "pan",
    });
    return { fig: { data, layout }, tauMax, locMax, J,
      closed: model.closed ? { supported: model.closed.supported, cells: model.closed.cells,
        note: model.closed.note || null, Jc: model.Jc, omega: model.closed.omega } : null };
  }

  // =====================================================================
  // grid step used by the draw tool's snap (also by assets-style helpers)
  // =====================================================================

  /** Round span/targetTicks to a "nice" 1/2/5 * 10^n step. */
  function niceStep(span, targetTicks) {
    targetTicks = targetTicks || 8;
    if (!(span > 0)) return 1;
    const raw = span / targetTicks;
    const exponent = Math.floor(Math.log10(raw));
    const fraction = raw / Math.pow(10, exponent);
    let nice;
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exponent);
  }

  // Plotly's minor gridlines split each major interval in exactly 5.
  const MINOR_PER_MAJOR = 5;
  function niceMinorStep(span, targetTicks) {
    return niceStep(span, targetTicks) / MINOR_PER_MAJOR;
  }

  global.SectionCompute = {
    rectsOverlap, subtractRects, neutralAxis, computeGeometry, formatGeometryOutput,
    computeStressExtremes, buildGeometryFigure, buildStressFigure,
    buildShearFigure, buildTorsionFigure, computeTorsionConstant,
    niceStep, niceMinorStep,
    _internal: { torsionModel, shearRibbonsForDirection, spineProfile, perpendicularPieceProfile, excludedIntervals, sideAttachments,
      endNeighbors, longAxis, isSpineRole, flangeTotalMoment, closedSectionAnalysis, findHoles },
  };
})(typeof window !== "undefined" ? window : globalThis);
