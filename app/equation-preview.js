/**
 * Source-at-runtime equation renderer.
 *
 * No equation graphics, text, or PDF pages are distributed, stored, or sent
 * remotely. When a reader opens the matching, locally selected PDF, PDF.js
 * renders just the marked region directly into an in-memory canvas. The
 * user-supplied source file remains the sole authority for glyph appearance.
 */
(root => {
  'use strict';
  const script = document.currentScript;
  const moduleURL = new URL('vendor/pdfjs/pdf.mjs', script?.src || document.baseURI);
  const workerURL = new URL('vendor/pdfjs/pdf.worker.mjs', script?.src || document.baseURI);
  // Keep decoder files outside the launcher's module-only /vendor/pdfjs/ route.
  const wasmURL = new URL('vendor/pdfjs-codecs/', script?.src || document.baseURI);
  const geometry = root.AtlasEquationGeometry;
  const manifest = root.AtlasEquationManifest;
  const MAX_CONCURRENT = 2;
  const MAX_PIXELS = 7_000_000;
  // The image box is the mathematical ink (plus a small glyph-safe margin),
  // NOT the often oversized source PDF rectangle. These limits prevent tall
  // systems and narrow phones from developing clipped internal scroll areas.
  const MAX_ZOOM = Object.freeze({ catalog: 3.9, detail: 5 });
  const previewLayouts = new WeakMap();
  const activePreviews = new Set();
  const detachedCleanup =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          for (const holder of activePreviews)
            if (!holder.isConnected) {
              resizeObserver?.unobserve(holder);
              previewLayouts.delete(holder);
              activePreviews.delete(holder);
            }
          if (activePreviews.size === 0) {
            detachedCleanup.disconnect();
            cleanupWatching = false;
          }
        })
      : null;
  let cleanupWatching = false;
  function watchPreview(holder) {
    activePreviews.add(holder);
    resizeObserver?.observe(holder);
    if (!cleanupWatching && detachedCleanup && document.body) {
      detachedCleanup.observe(document.body, { subtree: true, childList: true });
      cleanupWatching = true;
    }
  }
  window.addEventListener('resize', () => {
    for (const holder of activePreviews) {
      const layout = previewLayouts.get(holder);
      if (layout) fitPreview(holder, layout);
    }
  });
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(records => {
          for (const record of records) {
            const layout = previewLayouts.get(record.target);
            if (layout) fitPreview(record.target, layout);
            else resizeObserver.unobserve(record.target);
          }
        })
      : null;
  let sourceURL = null;
  let generation = 0;
  let libraryPromise = null;
  let documentPromise = null;
  let inProgress = 0;
  const queue = [];

  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          entries => {
            for (const event of entries) {
              if (!event.isIntersecting) continue;
              observer.unobserve(event.target);
              const start = event.target.__atlasEquationStart;
              delete event.target.__atlasEquationStart;
              if (typeof start === 'function') start();
            }
          },
          { rootMargin: '400px 0px' }
        )
      : null;

  function showStatus(holder, message) {
    if (!holder.isConnected) return;
    const status = document.createElement('span');
    status.className = 'formula-status';
    status.textContent = message;
    holder.replaceChildren(status);
    holder.classList.add('equation-unavailable');
    holder.classList.remove('equation-vector-ready');
    holder.removeAttribute('aria-busy');
    holder.style.removeProperty('background-color');
    previewLayouts.delete(holder);
    activePreviews.delete(holder);
    resizeObserver?.unobserve(holder);
  }

  function enqueue(job) {
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      drain();
    });
  }
  function drain() {
    while (inProgress < MAX_CONCURRENT && queue.length) {
      const item = queue.shift();
      inProgress++;
      Promise.resolve()
        .then(item.job)
        .then(item.resolve, item.reject)
        .finally(() => {
          inProgress--;
          drain();
        });
    }
  }

  function setSource(url) {
    // A blob URL points at the user's file in their current browser session.
    if (sourceURL === url) return;
    sourceURL = url || null;
    generation++;
    const previous = documentPromise;
    documentPromise = null;
    // PDF.js 6 owns document resources through its loading task, including
    // the worker. PDFDocumentProxy itself no longer provides destroy().
    if (previous) previous.then(pdf => pdf.loadingTask.destroy()).catch(() => {});
  }

  async function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = import(moduleURL.href)
        .then(lib => {
          if (!lib.GlobalWorkerOptions || typeof lib.getDocument !== 'function')
            throw new Error('The installed PDF renderer is incomplete');
          lib.GlobalWorkerOptions.workerSrc = workerURL.href;
          return lib;
        })
        .catch(error => {
          // A missing PDF.js module must not be reported as bad mathematical
          // source data. The portable launcher can install the engine once
          // from the pinned upstream distribution; built releases ship it.
          libraryPromise = null;
          const wrapped = new Error(
            'The offline PDF equation engine is missing or could not load. Restart Atlas while online to install it once, or use the complete GitHub release ZIP.'
          );
          wrapped.code = 'PDFJS_UNAVAILABLE';
          wrapped.cause = error;
          throw wrapped;
        });
    }
    return libraryPromise;
  }

  async function getPDF() {
    if (!sourceURL) throw new Error('No PDF has been selected');
    if (!documentPromise) {
      const url = sourceURL;
      const loading = loadLibrary()
        .then(
          lib =>
            lib.getDocument({
              url,
              enableXfa: false,
              isEvalSupported: false,
              wasmUrl: wasmURL.href
            }).promise
        )
        .catch(error => {
          // A rejected old document must not evict a newer source's cache.
          if (documentPromise === loading) documentPromise = null;
          throw error;
        });
      documentPromise = loading;
    }
    return documentPromise;
  }

  function fitPreview(holder, layout) {
    if (!holder.isConnected) return;
    // Every catalog and detail preview has a fixed CSS frame. Measure its
    // *actual* inner area rather than using the old content-dependent maximum
    // height; otherwise tall equations or multipart sets can be clipped by
    // the frame even when each canvas was individually "fitted".
    const css = getComputedStyle(holder);
    const horizontalPadding =
      (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0);
    const verticalPadding =
      (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0);
    const availableWidth = holder.clientWidth - horizontalPadding;
    const availableHeight = holder.clientHeight - verticalPadding;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const parts = holder.querySelector('.atlas-equation-parts');
    const gap =
      parts && layout.canvases.length > 1
        ? Math.max(0, parseFloat(getComputedStyle(parts).rowGap) || 0)
        : 0;
    const sizes = layout.canvases.map(canvas => ({
      // Dimensions are measured from all source ink AFTER safe cropping.
      width: Number(canvas.dataset.pdfWidth),
      height: Number(canvas.dataset.pdfHeight)
    }));
    const fitted = geometry.fitEquationGroup(
      sizes,
      availableWidth,
      availableHeight,
      gap,
      layout.detail ? MAX_ZOOM.detail : MAX_ZOOM.catalog
    );
    if (!fitted) return;
    for (let i = 0; i < layout.canvases.length; i++) {
      const canvas = layout.canvases[i];
      // Setting only the width lets the browser preserve the exact natural
      // canvas aspect ratio; never set object-fit:cover or clip its contents.
      // Round DOWN slightly, so CSS-pixel rounding cannot exceed the frame.
      canvas.style.width = `${Math.floor(fitted.parts[i].width * 100) / 100}px`;
      canvas.style.height = 'auto';
    }
  }

  async function paintOne(entry, detail, currentGeneration) {
    if (generation !== currentGeneration) return null;
    const pdf = await getPDF();
    if (generation !== currentGeneration) return null;
    const pageNo = Number(entry.page);
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pdf.numPages)
      throw new Error('Equation page out of range');
    const page = await pdf.getPage(pageNo);
    const unitViewport = page.getViewport({ scale: 1, rotation: 0 });
    const indexedCrop = geometry.cropFor(entry, unitViewport.width, unitViewport.height);
    const peerEntries = Object.values(manifest.entries).filter(
      candidate => candidate.page === pageNo
    );
    const crop = geometry.guardVerticalCrop(indexedCrop, entry, peerEntries, unitViewport.height);
    if (!crop || crop.width <= 0 || crop.height <= 0)
      throw new Error('Missing equation coordinates');
    // Higher resolution than CSS presentation prevents blur when we enlarge a
    // very short or narrow expression. The cap keeps the browser responsive.
    const preferred = detail ? 5 : 4.2;
    const scale = Math.max(
      1,
      Math.min(preferred, Math.sqrt(MAX_PIXELS / (crop.width * crop.height)))
    );
    const width = Math.ceil(crop.width * scale);
    const height = Math.ceil(crop.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Canvas rendering is unsupported');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    // The original PDF is rasterized locally; the original characters,
    // punctuation, superscripts, and fraction bars are never retypeset.
    const viewport = page.getViewport({ scale, rotation: 0 });
    await page.render({
      canvasContext: context,
      viewport,
      transform: [1, 0, 0, 1, -crop.x * scale, -crop.y * scale],
      background: '#fff'
    }).promise;
    if (generation !== currentGeneration) return null;

    const paper = geometry.paperColor(context, width, height);
    // Only verified source-specific interference and publisher frame strokes
    // are removed. DO NOT use the old generic peripheral-rule deletion here:
    // it can mistake a long fraction bar, bracket, or overbar for a border.
    geometry.removeSourceInterference(context, crop, scale, entry, paper);
    geometry.removeSourceFrames(context, crop, scale, entry, paper);
    // Capture slightly more source vertically, then strip unrelated rows above
    // and below the equation itself. The anchor remains the originally indexed
    // crop, so detached limits and subscripts can be preserved without showing
    // surrounding prose.
    if (entry.preserveFullCrop !== true) {
      const referenceAnchor = geometry.equationReferenceWindow(entry, peerEntries, crop, scale);
      geometry.removeVerticalEncroachment(
        context,
        width,
        height,
        referenceAnchor || {
          top: (indexedCrop.y - crop.y) * scale,
          bottom: (indexedCrop.y - crop.y + indexedCrop.height) * scale,
          left: (indexedCrop.x - crop.x) * scale,
          right: (indexedCrop.x - crop.x + indexedCrop.width) * scale
        },
        paper
      );
    }
    // Tight but glyph-safe visible margins around the cleaned equation ink.
    const bounds = geometry.inkBounds(
      context,
      width,
      height,
      {
        x: Math.max(4, Math.ceil(scale * 2.1)),
        y: Math.max(2, Math.ceil(scale * 0.65))
      },
      paper
    );
    if (!bounds) throw new Error('Equation region contained no mathematical ink');

    const output = document.createElement('canvas');
    output.width = bounds.width;
    output.height = bounds.height;
    output.className = 'atlas-source-equation';
    output.setAttribute('role', 'img');
    output.setAttribute('aria-label', `Equation ${entry.label} from your selected PDF`);
    const target = output.getContext('2d', { alpha: false });
    if (!target) throw new Error('Canvas display is unsupported');
    target.fillStyle = paper;
    target.fillRect(0, 0, bounds.width, bounds.height);
    target.drawImage(
      canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );
    // Natural PDF coordinates keep the final display sizing independent of
    // canvas resolution, browser DPR, and PDF whitespace.
    output.dataset.pdfWidth = (bounds.width / scale).toFixed(4);
    output.dataset.pdfHeight = (bounds.height / scale).toFixed(4);
    output.dataset.paperColor = paper;
    return output;
  }

  async function render(holder, label, startedGeneration) {
    if (!holder.isConnected || startedGeneration !== generation) return;
    if (root.ATLAS_SOURCE_SHA256 !== manifest?.pdf_sha256) {
      showStatus(holder, 'This equation is available in the matching source PDF. Use Open in PDF.');
      return;
    }
    const entries = geometry.entriesFor(manifest, label);
    if (!entries.length) {
      showStatus(holder, 'Use Open in PDF to view this source reference.');
      return;
    }
    try {
      const canvases = [];
      for (const entry of entries) {
        const canvas = await enqueue(() =>
          paintOne(entry, holder.classList.contains('equation-detail-preview'), startedGeneration)
        );
        if (!canvas || !holder.isConnected || startedGeneration !== generation) return;
        canvases.push(canvas);
      }
      const node =
        canvases.length === 1
          ? canvases[0]
          : Object.assign(document.createElement('div'), { className: 'atlas-equation-parts' });
      if (canvases.length > 1) node.append(...canvases);
      holder.replaceChildren(node);
      holder.style.backgroundColor = canvases[0].dataset.paperColor || '#fff';
      const layout = { canvases, detail: holder.classList.contains('equation-detail-preview') };
      previewLayouts.set(holder, layout);
      fitPreview(holder, layout);
      watchPreview(holder);
      holder.classList.add('equation-vector-ready');
      holder.classList.remove('equation-unavailable');
      holder.removeAttribute('aria-busy');
      holder.dataset.actualSourcePage = entries[0].page;
    } catch (error) {
      console.warn('Local equation rendering failed', label, error);
      if (startedGeneration === generation)
        showStatus(
          holder,
          error.code === 'PDFJS_UNAVAILABLE'
            ? 'Equation renderer missing. Reopen Atlas with internet once to install it, or use a complete release ZIP.'
            : 'Unable to render this source equation. Open in PDF to inspect the original.'
        );
    }
  }

  function mount(holder, label) {
    if (!holder) return Promise.resolve();
    label = String(label || '').trim();
    holder.setAttribute('aria-label', `Equation (${label})`);
    holder.setAttribute('aria-busy', 'true');
    const localGeneration = generation;
    if (observer) {
      holder.__atlasEquationStart = () => render(holder, label, localGeneration);
      observer.observe(holder);
      return Promise.resolve();
    }
    return render(holder, label, localGeneration);
  }
  root.AtlasEquationPreview = {
    mount,
    setSource,
    getDocument: getPDF,
    catalog: () => Promise.resolve(manifest)
  };
})(window);
