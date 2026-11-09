/**
 * Read-only figure previews from the locally selected PDF.
 *
 * The supported edition uses individually reviewed coordinates. Other PDFs
 * may use conservative caption/graphics detection. The renderer never stores
 * artwork or user crop settings, and it never substitutes a complete PDF page
 * for a figure. Source loading is shared with the equation renderer.
 */
(root => {
  'use strict';

  const geometry = root.AtlasFigureGeometry;
  const reviewed = root.AtlasReviewedFigureCrops;
  const MAX_CONCURRENT_RENDERS = 2;
  const MAX_SOURCE_PIXELS = 3_000_000;
  const MAX_PREVIEW_PIXELS = 3_000_000;
  const COMPOSITE_GAP_POINTS = 10;
  const queue = [];
  const activeMounts = new WeakMap();
  const renderTasks = new Set();
  let running = 0;
  let generation = 0;
  let sourceURL = null;

  function setSource(url) {
    if (sourceURL === url) return;
    sourceURL = url || null;
    generation += 1;
    for (const task of renderTasks) task.cancel?.();
    while (queue.length) queue.shift().resolve();
  }

  function enqueue(job) {
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      runQueuedJobs();
    });
  }

  function runQueuedJobs() {
    while (running < MAX_CONCURRENT_RENDERS && queue.length) {
      const next = queue.shift();
      running += 1;
      Promise.resolve()
        .then(next.job)
        .then(next.resolve, next.reject)
        .finally(() => {
          running -= 1;
          runQueuedJobs();
        });
    }
  }

  function isCurrent(holder, token) {
    return (
      holder.isConnected && token.generation === generation && activeMounts.get(holder) === token
    );
  }

  function showStatus(holder, message) {
    holder.textContent = message;
    holder.classList.add('figure-preview-unavailable');
    holder.removeAttribute('aria-busy');
  }

  function createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
  }

  function canvasContext(canvas, options = {}) {
    const context = canvas.getContext('2d', { alpha: false, ...options });
    if (!context) throw new Error('Browser canvas is unavailable');
    return context;
  }

  function clearCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }

  async function paintPage(page, options) {
    const task = page.render({ ...options, background: '#fff' });
    renderTasks.add(task);
    try {
      await task.promise;
    } finally {
      renderTasks.delete(task);
    }
  }

  function previewWidth(holder) {
    return holder.classList.contains('figure-detail-preview') ? 1100 : 730;
  }

  /** Render only the reviewed rectangle instead of allocating a whole page. */
  async function renderReviewedPart(pdf, part, scale, holder, token) {
    const page = await pdf.getPage(part.page);
    if (!isCurrent(holder, token)) return null;
    const base = page.getViewport({ scale: 1 });
    if (!reviewed.fitsPage(part, base))
      throw new Error('Figure coordinates exceed the source page');
    const [left, top, right, bottom] = part.crop;
    const canvas = createCanvas((right - left) * scale, (bottom - top) * scale);
    try {
      const context = canvasContext(canvas);
      await paintPage(page, {
        canvasContext: context,
        viewport: page.getViewport({ scale }),
        transform: [1, 0, 0, 1, -left * scale, -top * scale]
      });
      if (!isCurrent(holder, token)) {
        clearCanvas(canvas);
        return null;
      }
      // An exclusion is maintained alongside the reviewed rectangle. It can
      // remove adjacent caption fragments without trimming a nearby panel.
      context.fillStyle = '#fff';
      for (const [x0, y0, x1, y1] of part.exclude) {
        context.fillRect(
          (x0 - left) * scale,
          (y0 - top) * scale,
          (x1 - x0) * scale,
          (y1 - y0) * scale
        );
      }
      return canvas;
    } catch (error) {
      clearCanvas(canvas);
      throw error;
    }
  }

  async function renderReviewedFigure(pdf, parts, holder, token) {
    const width = Math.max(...parts.map(part => part.crop[2] - part.crop[0]));
    const height =
      parts.reduce((total, part) => total + part.crop[3] - part.crop[1], 0) +
      COMPOSITE_GAP_POINTS * (parts.length - 1);
    const scale = Math.min(
      3,
      previewWidth(holder) / width,
      Math.sqrt(MAX_PREVIEW_PIXELS / (width * height))
    );
    const panels = [];
    try {
      for (const part of parts) {
        const canvas = await renderReviewedPart(pdf, part, scale, holder, token);
        if (!canvas) return null;
        panels.push(canvas);
      }
      if (panels.length === 1) return panels.pop();
      const gap = Math.ceil(COMPOSITE_GAP_POINTS * scale);
      const result = createCanvas(
        Math.max(...panels.map(panel => panel.width)),
        panels.reduce((sum, panel) => sum + panel.height, 0) + gap * (panels.length - 1)
      );
      const context = canvasContext(result);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, result.width, result.height);
      let y = 0;
      for (const panel of panels) {
        context.drawImage(panel, (result.width - panel.width) / 2, y);
        y += panel.height + gap;
      }
      return result;
    } finally {
      panels.forEach(clearCanvas);
    }
  }

  function findMatchingCaption(captions, label) {
    const requested = String(label)
      .trim()
      .replace(/\s*\.\s*/g, '.')
      .toLowerCase();
    return captions.find(caption => caption.label === requested) || null;
  }

  /** Best-effort support for documents without a reviewed coordinate map. */
  async function renderDetectedFigure(pdf, label, pageNumber, holder, token) {
    const page = await pdf.getPage(pageNumber);
    if (!isCurrent(holder, token)) return null;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.75, Math.sqrt(MAX_SOURCE_PIXELS / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const text = await page.getTextContent({ disableNormalization: false });
    const boxes = geometry.textBoxes(text.items, viewport);
    const captions = geometry.findCaptions(boxes);
    const caption = findMatchingCaption(captions, label);
    if (!caption || !isCurrent(holder, token)) return null;

    const source = createCanvas(viewport.width, viewport.height);
    try {
      const context = canvasContext(source, { willReadFrequently: true });
      await paintPage(page, { canvasContext: context, viewport });
      if (!isCurrent(holder, token)) return null;
      const preceding = captions.filter(item => item.top < caption.top - 3);
      const following = captions.filter(item => item.top > caption.top + 3);
      const sample = {
        data: context.getImageData(0, 0, source.width, source.height).data,
        width: source.width,
        height: source.height,
        boxes,
        caption,
        previousCaptionBottom: preceding.length
          ? Math.max(...preceding.map(item => item.bottom))
          : 0,
        nextCaptionTop: following.length
          ? Math.min(...following.map(item => item.top))
          : source.height
      };
      const boundary =
        geometry.detectCrop(sample) || geometry.detectCrop({ ...sample, orientation: 'below' });
      if (!boundary) return null;
      const result = createCanvas(boundary.width, boundary.height);
      canvasContext(result).drawImage(
        source,
        boundary.x,
        boundary.y,
        boundary.width,
        boundary.height,
        0,
        0,
        result.width,
        result.height
      );
      return result;
    } finally {
      clearCanvas(source);
    }
  }

  function display(holder, label, canvas, pages) {
    canvas.className = 'atlas-source-figure';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `Figure ${label} from your selected PDF, page ${pages.join(', ')}`
    );
    const frame = document.createElement('div');
    frame.className = 'figure-preview-frame';
    frame.append(canvas);
    holder.replaceChildren(frame);
    holder.classList.remove('figure-preview-unavailable');
    holder.removeAttribute('aria-busy');
  }

  async function render(holder, label, pageNumber, token) {
    if (!isCurrent(holder, token)) return;
    try {
      if (!sourceURL) return showStatus(holder, 'Choose a PDF to display figures');
      if (!root.AtlasEquationPreview?.getDocument) throw new Error('PDF renderer is unavailable');
      const pdf = await root.AtlasEquationPreview.getDocument();
      if (!isCurrent(holder, token)) return;
      const manifest = root.AtlasFigureManifest;
      if (reviewed?.matchesDocument(manifest, root.ATLAS_SOURCE_SHA256, pdf.numPages)) {
        const parts = reviewed.findParts(manifest, label);
        if (!parts) return showStatus(holder, 'No reviewed preview for this figure · Open in PDF');
        const canvas = await renderReviewedFigure(pdf, parts, holder, token);
        if (canvas) {
          if (isCurrent(holder, token))
            display(
              holder,
              label,
              canvas,
              parts.map(part => part.page)
            );
          else clearCanvas(canvas);
        }
        return;
      }
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
        return showStatus(holder, 'Invalid source page for this figure');
      }
      const candidatePages = [pageNumber, pageNumber - 1, pageNumber + 1].filter(
        page => page >= 1 && page <= pdf.numPages
      );
      for (const page of candidatePages) {
        const canvas = await renderDetectedFigure(pdf, label, page, holder, token);
        if (!isCurrent(holder, token)) {
          if (canvas) clearCanvas(canvas);
          return;
        }
        if (canvas) return display(holder, label, canvas, [page]);
      }
      showStatus(holder, 'Preview unavailable for this PDF · Open in PDF');
    } catch (error) {
      if (!isCurrent(holder, token)) return;
      console.warn('Figure preview unavailable', label, error);
      showStatus(holder, 'Preview unavailable · Open in PDF');
    }
  }

  function mount(holder, label, pageNumber) {
    if (!holder) return Promise.resolve();
    if (!label) {
      showStatus(holder, 'No source location for this figure');
      return Promise.resolve();
    }
    const previous = activeMounts.get(holder);
    if (
      previous?.generation === generation &&
      previous.label === label &&
      previous.page === Number(pageNumber)
    )
      return Promise.resolve();
    const token = { generation, label, page: Number(pageNumber) };
    activeMounts.set(holder, token);
    holder.setAttribute('aria-busy', 'true');
    holder.textContent = 'Loading figure…';
    return enqueue(() => render(holder, String(label), Number(pageNumber), token));
  }

  root.AtlasFigurePreview = Object.freeze({ setSource, mount });
})(window);
