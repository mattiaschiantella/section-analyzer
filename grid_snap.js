// Live grid-snap for the rectangle-draw tool: while a rectangle is being
// drawn, the cursor's position is rounded to the nearest currently-visible
// MINOR gridline (the finer, lighter sub-grid, not the sparser major one)
// BEFORE Plotly ever sees it, exactly like AutoCAD's OSNAP (which likewise
// snaps the on-screen crosshair/preview, not the physical mouse -- a web
// page has no way to move the OS cursor either).
//
// Plotly has no public "shape is being drawn" event to hook (only the
// final 'plotly_relayout' fires once, on mouseup -- 'plotly_relayouting'
// is never emitted for shape drawing, only for axis pan/zoom drags), so
// the only way to get a live, snapped rubber-band is to intercept the raw
// mousedown/mousemove/mouseup in the capture phase, replace their
// coordinates with grid-snapped ones, and replay corrected synthetic
// events for Plotly's own handlers to consume instead.
//
// The snap step is recomputed fresh on every move from the axis' CURRENT
// visible range, using the same "nice" 1/2/5 * 10^n rule Plotly itself
// uses for its own auto tick spacing -- Plotly only fills in a resolved
// xaxis.dtick/yaxis.dtick AFTER the first zoom/pan relayout (it's absent
// on the very first draw, right after page load), so re-deriving it here
// from the range is what makes the snap reliably follow the on-screen
// grid at every zoom level, including that first draw.
(function () {
  function getGd(el) {
    return el && el.closest ? el.closest(".js-plotly-plot") : null;
  }

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

  // Plotly's minor gridlines (see build_geometry_figure's minor=dict(...))
  // split each major interval into exactly 5 equal parts -- confirmed by
  // reading the rendered <g class="minor-gridlayer"> tick positions, since
  // minor.dtick itself is never exposed on the axis object. The user wants
  // snapping to follow THAT finer grid, not the sparser major one.
  const MINOR_PER_MAJOR = 5;
  function niceMinorStep(span, targetTicks) {
    return niceStep(span, targetTicks) / MINOR_PER_MAJOR;
  }
  window.__gridSnapNiceStep = niceMinorStep;

  function snapValue(v, step) {
    if (!step || !isFinite(step) || step <= 0) return v;
    return Math.round(v / step) * step;
  }

  function snapClientPoint(gd, clientX, clientY) {
    const fl = gd._fullLayout;
    if (!fl || !fl.xaxis || !fl.yaxis || !fl._size) return null;
    const gdRect = gd.getBoundingClientRect();
    const size = fl._size;
    const xa = fl.xaxis;
    const ya = fl.yaxis;

    const px = clientX - gdRect.left - size.l;
    const py = clientY - gdRect.top - size.t;

    const xVal = xa.range[0] + (px / size.w) * (xa.range[1] - xa.range[0]);
    const yVal = ya.range[0] + ((size.h - py) / size.h) * (ya.range[1] - ya.range[0]);

    const xStep = niceMinorStep(Math.abs(xa.range[1] - xa.range[0]));
    const yStep = niceMinorStep(Math.abs(ya.range[1] - ya.range[0]));
    const xSnap = snapValue(xVal, xStep);
    const ySnap = snapValue(yVal, yStep);

    const pxSnap = ((xSnap - xa.range[0]) / (xa.range[1] - xa.range[0])) * size.w;
    const pySnap = size.h - ((ySnap - ya.range[0]) / (ya.range[1] - ya.range[0])) * size.h;

    // clientX/clientY are truncated to whole CSS pixels by the browser
    // (true for real mouse events too, not just synthetic ones), so
    // round here rather than let that truncation silently bias the snap.
    return {
      clientX: Math.round(gdRect.left + size.l + pxSnap),
      clientY: Math.round(gdRect.top + size.t + pySnap),
    };
  }

  let dragging = false;
  let dragGd = null;

  function replay(type, target, clientX, clientY, e) {
    const ev = new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: clientX, clientY: clientY,
      button: e.button, buttons: e.buttons,
    });
    ev.__gridSnapSynthetic = true;
    target.dispatchEvent(ev);
  }

  function onMouseDown(e) {
    if (e.__gridSnapSynthetic) return;
    if (e.button !== 0) return;
    const gd = getGd(e.target);
    if (!gd || !gd._fullLayout || gd._fullLayout.dragmode !== "drawrect") return;
    if (!e.target.classList || !e.target.classList.contains("nsewdrag")) return;

    const snapped = snapClientPoint(gd, e.clientX, e.clientY);
    if (!snapped) return;

    dragging = true;
    dragGd = gd;
    e.stopImmediatePropagation();
    e.preventDefault();
    replay("mousedown", e.target, snapped.clientX, snapped.clientY, e);
  }

  function onMouseMove(e) {
    if (e.__gridSnapSynthetic) return;
    if (!dragging || !dragGd) return;
    const snapped = snapClientPoint(dragGd, e.clientX, e.clientY);
    if (!snapped) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    replay("mousemove", dragGd, snapped.clientX, snapped.clientY, e);
  }

  function onMouseUp(e) {
    if (e.__gridSnapSynthetic) return;
    if (!dragging || !dragGd) return;
    const gd = dragGd;
    const snapped = snapClientPoint(gd, e.clientX, e.clientY);
    dragging = false;
    dragGd = null;
    if (!snapped) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    replay("mouseup", gd, snapped.clientX, snapped.clientY, e);
  }

  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
})();
