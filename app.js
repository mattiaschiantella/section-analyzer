/* Section Analyzer -- UI logic (JavaScript port of app.py).
 *
 * All state lives in the browser; nothing is sent to a server.
 * Rectangles are [x0, y0, base, height] in mm, (x0, y0) = top-right vertex.
 */
(function () {
  "use strict";

  const C = window.SectionCompute;
  const $ = (id) => document.getElementById(id);

  const state = {
    rects: [],        // defined rectangles
    geom: null,       // result of "Compute geometry" (null = invalidated)
    stress: null,     // [Mx, My, N, Vx, Vy, T] in kN / kN*m of the last "Compute stresses"
    outputLines: [],  // text shown in the Results box
  };

  const CONFIG = { displaylogo: false, scrollZoom: true, responsive: true };
  const CONFIG_GEOM = Object.assign({}, CONFIG, { modeBarButtonsToAdd: ["drawrect", "eraseshape"] });

  const OVERLAP_MESSAGE =
    "The current rectangle is overlapping the previous ones. " +
    "If you continue, the shared part will be counted twice " +
    "in the area, centroid and moment of inertia calculations. " +
    "Press OK to add it anyway, or Cancel to discard it.";

  // ---------------------------------------------------------------------
  // author banner
  // ---------------------------------------------------------------------
  // (the author banner is now a footer card in index.html)

  // ---------------------------------------------------------------------
  // graphs + tabs
  // ---------------------------------------------------------------------
  const GRAPHS = {
    geom: $("geom-graph"), stress: $("stress-graph"),
    shear: $("shear-graph"), torsion: $("torsion-graph"),
  };
  let activeTab = "geom";
  const dirty = { geom: true, stress: true, shear: true, torsion: true };
  let relayoutHooked = false;

  const BLANK_LAYOUT = {
    xaxis: { visible: false }, yaxis: { visible: false },
    height: 560, margin: { l: 20, r: 20, t: 20, b: 20 },
  };

  function inputsOrNull() {
    if (!state.stress || !state.geom || !state.rects.length) return null;
    const [Mx, My, N, Vx, Vy, T] = state.stress;
    return { Mx: Mx * 1e6, My: My * 1e6, N: N * 1e3, Vx: Vx * 1e3, Vy: Vy * 1e3, T: T * 1e6 };
  }

  function draw(which) {
    dirty[which] = false;
    const div = GRAPHS[which];
    let fig = null;
    if (which === "geom") {
      fig = C.buildGeometryFigure(state.rects, state.geom);
      Plotly.react(div, fig.data, fig.layout, CONFIG_GEOM);
      if (!relayoutHooked) {
        relayoutHooked = true;
        div.on("plotly_relayout", onRelayout);
      }
      return;
    }
    const inp = inputsOrNull();
    if (inp) {
      if (which === "stress") fig = C.buildStressFigure(state.rects, state.geom, inp.Mx, inp.My, inp.N).fig;
      else if (which === "shear") fig = C.buildShearFigure(state.rects, state.geom, inp.Vx, inp.Vy).fig;
      else fig = C.buildTorsionFigure(state.rects, state.geom, inp.T).fig;
    }
    if (fig) Plotly.react(div, fig.data, fig.layout, CONFIG);
    else Plotly.react(div, [], BLANK_LAYOUT, CONFIG);
  }

  function render(which) {
    dirty[which] = true;
    if (activeTab === which) draw(which);
  }

  function renderAll() {
    for (const k of Object.keys(GRAPHS)) render(k);
  }

  function selectTab(which) {
    activeTab = which;
    for (const btn of document.querySelectorAll(".tab-btn")) {
      btn.classList.toggle("active", btn.dataset.tab === which);
    }
    for (const k of Object.keys(GRAPHS)) {
      $("panel-" + k).style.display = k === which ? "block" : "none";
    }
    if (dirty[which]) draw(which);
    else Plotly.Plots.resize(GRAPHS[which]);
  }

  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  }

  // ---------------------------------------------------------------------
  // rectangle list
  // ---------------------------------------------------------------------
  function renderRectList() {
    const box = $("rect-list-div");
    const dd = $("del-dropdown");
    dd.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select to delete";
    dd.appendChild(placeholder);

    if (!state.rects.length) {
      box.innerHTML = "<p>No rectangles yet.</p>";
      return;
    }
    let html = "<table><tr><th>#</th><th>x0</th><th>y0</th><th>base</th><th>height</th></tr>";
    state.rects.forEach((r, i) => {
      html += `<tr><td>${i}</td><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${i}: x0=${r[0]}, y0=${r[1]}, b=${r[2]}, h=${r[3]}`;
      dd.appendChild(opt);
    });
    html += "</table>";
    box.innerHTML = html;
  }

  function renderOutput() {
    $("output-text").textContent = state.outputLines.join("\n");
  }

  /** Adding / removing a rectangle invalidates the computed geometry and
   *  stresses (the Results text is left as it was, like the Dash app). */
  function rectsChanged() {
    state.geom = null;
    state.stress = null;
    renderRectList();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // add: numeric input
  // ---------------------------------------------------------------------
  function readNumber(id) {
    const raw = $(id).value.trim();
    if (raw === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  /** Overlap check + native confirm, then append. Returns true if added. */
  function tryAddRect(rect) {
    if (state.rects.some((r) => C.rectsOverlap(rect, r)) && !window.confirm(OVERLAP_MESSAGE)) {
      return false;
    }
    state.rects.push(rect);
    rectsChanged();
    return true;
  }

  $("btn-add").addEventListener("click", () => {
    const x0 = readNumber("in-x0"), y0 = readNumber("in-y0");
    const b = readNumber("in-b"), h = readNumber("in-h");
    const err = $("form-error");
    if ([x0, y0, b, h].some((v) => v === null)) { err.textContent = "Invalid input values"; return; }
    if (b <= 0 || h <= 0) { err.textContent = "Base and height must be positive"; return; }
    err.textContent = "";
    tryAddRect([x0, y0, b, h]);
  });

  // ---------------------------------------------------------------------
  // add: rectangle sketched on the graph (snapped to the visible grid)
  // ---------------------------------------------------------------------
  function onRelayout(ev) {
    if (window.__suppressDraw) return;          // middle-click pan in progress
    if (!ev || !Array.isArray(ev.shapes)) return;
    const shapes = ev.shapes;
    if (shapes.length < state.rects.length) { render("geom"); return; }  // a committed shape was erased: re-sync
    if (shapes.length === state.rects.length) return;

    const sh = shapes[shapes.length - 1];
    const vals = [sh.x0, sh.x1, sh.y0, sh.y1];
    if (vals.some((v) => typeof v !== "number")) { render("geom"); return; }

    // Snap to the minor grid on screen at draw time (it follows the zoom).
    const fl = GRAPHS.geom._fullLayout;
    const xStep = C.niceMinorStep(Math.abs(fl.xaxis.range[1] - fl.xaxis.range[0]));
    const yStep = C.niceMinorStep(Math.abs(fl.yaxis.range[1] - fl.yaxis.range[0]));
    const snap = (v, step) => Number((Math.round(v / step) * step).toPrecision(12));

    const [x0, x1] = [snap(sh.x0, xStep), snap(sh.x1, xStep)].sort((p, q) => p - q);
    const [y0, y1] = [snap(sh.y0, yStep), snap(sh.y1, yStep)].sort((p, q) => p - q);
    const b = Number((x1 - x0).toPrecision(12)), h = Number((y1 - y0).toPrecision(12));
    if (b <= 0 || h <= 0) { render("geom"); return; }

    $("form-error").textContent = "";
    if (!tryAddRect([x0, y0, b, h])) render("geom");   // cancelled: drop the sketched shape
  }

  // ---------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------
  $("btn-delete").addEventListener("click", () => {
    const v = $("del-dropdown").value;
    if (v === "") return;
    const idx = Number(v);
    if (!(idx >= 0 && idx < state.rects.length)) return;
    state.rects.splice(idx, 1);
    rectsChanged();
  });

  $("btn-delete-all").addEventListener("click", () => {
    if (!state.rects.length) return;
    state.rects = [];
    rectsChanged();
  });

  // ---------------------------------------------------------------------
  // compute geometry
  // ---------------------------------------------------------------------
  $("btn-compute-geom").addEventListener("click", () => {
    if (!state.rects.length) return;
    state.geom = C.computeGeometry(state.rects);
    state.outputLines = C.formatGeometryOutput(state.geom);
    state.stress = null;
    renderOutput();
    renderAll();
  });

  // ---------------------------------------------------------------------
  // compute stresses
  // ---------------------------------------------------------------------
  const num = (id) => { const v = readNumber(id); return v === null ? 0 : v; };

  $("btn-compute-stress").addEventListener("click", () => {
    const msg = $("stress-error");
    if (!state.rects.length || !state.geom) {
      msg.textContent = "Compute the geometry first.";
      return;
    }
    msg.textContent = "";

    const Mx_kNm = num("in-Mx"), My_kNm = num("in-My"), N_kN = num("in-N");
    const Vx_kN = num("in-Vx"), Vy_kN = num("in-Vy"), T_kNm = num("in-T");
    const Mx = Mx_kNm * 1e6, My = My_kNm * 1e6, N = N_kN * 1e3;
    const Vx = Vx_kN * 1e3, Vy = Vy_kN * 1e3, T = T_kNm * 1e6;
    const g = state.geom;

    const ext = C.computeStressExtremes(state.rects, Mx, My, N, g);
    const f4 = (v) => v.toFixed(4), f3 = (v) => v.toFixed(3);
    const lines = C.formatGeometryOutput(g).concat([
      "",
      "---- Normal stresses (biaxial bending + axial force) ----",
      `Mx = ${f4(Mx_kNm)} kN·m, My = ${f4(My_kNm)} kN·m, N = ${f4(N_kN)} kN`,
      `Sigma max (tension)     = ${f4(ext.sigmaMax)} MPa  at (x=${f3(ext.locMax[0])}, y=${f3(ext.locMax[1])}) mm`,
      `Sigma min (compression) = ${f4(ext.sigmaMin)} MPa  at (x=${f3(ext.locMin[0])}, y=${f3(ext.locMin[1])}) mm`,
    ]);

    if (Vx !== 0 || Vy !== 0) {
      const sh = C.buildShearFigure(state.rects, g, Vx, Vy);
      lines.push(
        "",
        "---- Shear stresses (approximate Jourawski method) ----",
        `Tx = ${f4(Vx_kN)} kN, Ty = ${f4(Vy_kN)} kN`,
        `Tau max (approx, numeric) = ${f4(sh.tauMax)} MPa  at (x=${f3(sh.locMax[0])}, y=${f3(sh.locMax[1])}) mm`,
      );
    }
    if (T !== 0) {
      const to = C.buildTorsionFigure(state.rects, g, T);
      lines.push(
        "",
        "---- Torsional shear stress (open thin-walled section) ----",
        `Mz = ${f4(T_kNm)} kN·m (positive = counterclockwise)`,
        `J = ${f4(to.J)} mm⁴`,
        `Tau_t max = ${f4(to.tauMax)} MPa  at (x=${f3(to.locMax[0])}, y=${f3(to.locMax[1])}) mm`,
      );
    }

    state.stress = [Mx_kNm, My_kNm, N_kN, Vx_kN, Vy_kN, T_kNm];
    state.outputLines = lines;
    renderOutput();
    renderAll();
  });

  // ---------------------------------------------------------------------
  // go
  // ---------------------------------------------------------------------
  renderRectList();
  renderOutput();
  selectTab("geom");
})();
