// Adds middle-mouse-button drag-to-pan to every Plotly graph on the page.
// Plotly has no built-in "hold the wheel button, drag to pan" mode (its
// own 'pan' dragmode only reacts to the primary/left button), so this
// reimplements it by hand: on a middle-button drag, shift each axis'
// range by the same data-distance the cursor moved, using each axis'
// current pixel width/height (gd._fullLayout._size) to convert
// pixels -> data units. Left-button dragging (zoom-select, or the
// draw-rectangle tool) is untouched.
(function () {
  // app.js ignores shapes that show up while this is true, so a stray
  // rectangle sketched by Plotly during a middle-click drag is never
  // turned into a real one (same job the server-side flag did in Dash).
  function setSuppressDraw(value) {
    window.__suppressDraw = value;
  }

  function attach(gd) {
    if (gd._middlePanAttached) return;
    gd._middlePanAttached = true;

    let panning = false;
    let startClientX = 0;
    let startClientY = 0;
    let startXRange = null;
    let startYRange = null;
    let shapesSnapshot = null;

    // Capture phase, on gd (an ancestor of the actual drag-hit rect
    // Plotly listens on): this runs before Plotly's own mousedown
    // handler ever sees the event, so stopPropagation() here reliably
    // keeps Plotly from ALSO starting a drawrect/zoom-select gesture --
    // Plotly's own drag handling doesn't check which mouse button was
    // pressed, so without this a middle-click-drag would pan AND sketch
    // an unwanted rectangle at the same time.
    gd.addEventListener("mousedown", function (e) {
      if (e.button !== 1) return;
      const xa = gd._fullLayout && gd._fullLayout.xaxis;
      const ya = gd._fullLayout && gd._fullLayout.yaxis;
      if (!xa || !ya) return;
      e.preventDefault();
      e.stopPropagation();
      panning = true;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startXRange = xa.range.slice();
      startYRange = ya.range.slice();
      // Second line of defense: if Plotly's own drawrect handling still
      // reacts to this same press somehow (e.g. it's wired up somewhere
      // this capture listener can't get ahead of), a shape it added
      // during the drag is caught and undone on mouseup below by
      // comparing against this snapshot -- not just relying on winning
      // the race above.
      shapesSnapshot = (gd.layout && gd.layout.shapes) ? gd.layout.shapes.slice() : [];
      gd.style.cursor = "grabbing";
      // Third, server-side line of defense: a client-side-only revert
      // can still lose a race against add_rectangle_from_drawing's own
      // callback request, which may already be in flight to the server
      // by the time the revert above fires. Flipping this store makes
      // the server itself refuse to add anything for as long as a
      // middle-click drag is in progress, closing that race for good.
      setSuppressDraw(true);
    }, true);

    window.addEventListener("mousemove", function (e) {
      if (!panning) return;
      e.preventDefault();
      const size = gd._fullLayout && gd._fullLayout._size;
      if (!size) return;

      const dxPx = e.clientX - startClientX;
      const dyPx = e.clientY - startClientY;

      // x: pixel 0 = range[0] (left edge), pixel w = range[1] (right edge).
      const xShift = (dxPx / size.w) * (startXRange[1] - startXRange[0]);
      // y: DOM pixels grow downward but range[0]/range[1] are bottom/top,
      // so the sign is opposite to x.
      const yShift = (dyPx / size.h) * (startYRange[1] - startYRange[0]);

      window.Plotly.relayout(gd, {
        "xaxis.range": [startXRange[0] - xShift, startXRange[1] - xShift],
        "yaxis.range": [startYRange[0] + yShift, startYRange[1] + yShift],
      });
    });

    function stopPanning(e) {
      if (e.button !== undefined && e.button !== 1) return;
      if (panning) {
        panning = false;
        gd.style.cursor = "";
        const currentShapes = (gd.layout && gd.layout.shapes) || [];
        if (shapesSnapshot && currentShapes.length > shapesSnapshot.length) {
          // Plotly slipped a shape in anyway during this middle-click
          // drag (despite the capture-phase block above) -- undo it
          // immediately, before the extra shape's own relayout event has
          // a chance to reach the server and get added as a real
          // rectangle.
          window.Plotly.relayout(gd, { shapes: shapesSnapshot });
        }
        shapesSnapshot = null;
        setSuppressDraw(false);
      }
    }
    window.addEventListener("mouseup", stopPanning);
    window.addEventListener("blur", function () {
      if (panning) {
        panning = false;
        gd.style.cursor = "";
        shapesSnapshot = null;
        setSuppressDraw(false);
      }
    });

    // Suppress the browser's own middle-click autoscroll icon/behaviour.
    gd.addEventListener("auxclick", function (e) {
      if (e.button === 1) e.preventDefault();
    });
  }

  function attachAll() {
    document.querySelectorAll(".js-plotly-plot").forEach(attach);
  }

  document.addEventListener("DOMContentLoaded", attachAll);
  new MutationObserver(attachAll).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  attachAll();
})();
