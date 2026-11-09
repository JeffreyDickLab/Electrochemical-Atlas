/**
 * Table previews use the same local PDF document as figures and equations.
 * Each reviewed table page is rendered separately, preserving its printed
 * columns, notation and footnotes. No cell transcription or image storage.
 */
(root => {
  'use strict';

  const regions = root.AtlasSourceRegions;
  const MAX_CONCURRENT = 2;
  const MAX_PIXELS = 6_000_000;
  const mounts = new WeakMap();
  const tasks = new Set();
  const queue = [];
  let sourceURL = null;
  let generation = 0;
  let running = 0;

  function setSource(url) {
    if (sourceURL === url) return;
    sourceURL = url || null;
    generation += 1;
    for (const task of tasks) task.cancel?.();
    while (queue.length) queue.shift().resolve();
  }

  function enqueue(job) {
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      drain();
    });
  }

  function drain() {
    while (running < MAX_CONCURRENT && queue.length) {
      const next = queue.shift();
      running += 1;
      Promise.resolve()
        .then(next.job)
        .then(next.resolve, next.reject)
        .finally(() => {
          running -= 1;
          drain();
        });
    }
  }

  function isCurrent(state, request = state.request) {
    return (
      state.holder.isConnected &&
      state.generation === generation &&
      mounts.get(state.holder) === state &&
      state.request === request
    );
  }

  function publishSourceLocation(state, request, y) {
    if (!isCurrent(state, request)) return;
    const page = state.parts[state.index].page;
    if (state.sourceLocation?.page === page && state.sourceLocation.y === y) return;
    state.sourceLocation = { page, y };
    state.onPageChange?.({ page, y });
  }

  function element(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  function showError(state, message) {
    if (!isCurrent(state)) return;
    releaseCanvas(state.canvas);
    state.canvas = null;
    (state.viewport || state.holder).textContent = message;
    state.holder.classList.add('table-preview-unavailable');
    state.holder.removeAttribute('aria-busy');
  }

  function updatePageInfo(state) {
    const part = state.parts[state.index];
    state.pageInfo.textContent = state.fallback
      ? `Original PDF page ${part.page}`
      : state.detail
        ? `Table page ${state.index + 1} of ${state.parts.length} · PDF ${part.page}`
        : state.parts.length > 1
          ? `Page 1 of ${state.parts.length}`
          : '';
    state.pageInfo.hidden = !state.pageInfo.textContent;
    if (state.pageSelect) state.pageSelect.value = String(state.index);
  }

  function changePage(state, index) {
    if (!isCurrent(state) || !Number.isInteger(index) || !state.parts[index])
      return Promise.resolve();
    if (state.index === index) return Promise.resolve();
    state.index = index;
    state.sourceLocation = null;
    releaseCanvas(state.canvas);
    state.canvas = null;
    state.viewport.textContent = 'Loading table page…';
    state.viewport.scrollTop = 0;
    state.viewport.scrollLeft = 0;
    updatePageInfo(state);
    return renderCurrent(state);
  }

  function buildView(state) {
    const { holder } = state;
    state.viewport = element('div', 'table-preview-viewport');
    state.pageInfo = element('span', 'table-preview-page-info');
    if (state.detail) {
      state.viewport.tabIndex = 0;
      state.viewport.setAttribute('role', 'region');
      state.viewport.setAttribute('aria-label', `Table ${state.label} preview. Scroll to read.`);
      state.pageInfo.setAttribute('aria-live', 'polite');
      const children = [];
      if (state.parts.length > 1) {
        const controls = element('div', 'table-preview-controls');
        state.pageSelect = element('select', 'table-preview-page-select');
        state.pageSelect.setAttribute('aria-label', 'Table page');
        state.parts.forEach((part, index) => {
          const option = element('option', '', `${index + 1} of ${state.parts.length}`);
          option.value = String(index);
          state.pageSelect.append(option);
        });
        state.pageSelect.addEventListener('change', () =>
          changePage(state, Number(state.pageSelect.value))
        );
        controls.append(state.pageSelect);
        children.push(controls);
      }
      holder.replaceChildren(...children, state.pageInfo, state.viewport);
    } else {
      // A catalog preview lives inside the existing collection button, so it
      // contains no nested buttons, select controls or keyboard focus targets.
      holder.replaceChildren(state.viewport, state.pageInfo);
    }
    updatePageInfo(state);
  }

  async function paint(state, request) {
    if (!isCurrent(state, request)) return;
    const part = state.parts[state.index];
    const page = await state.pdf.getPage(part.page);
    if (!isCurrent(state, request)) return;
    const base = page.getViewport({ scale: 1 });
    if (!regions.fitsPage(part, base)) throw new Error('Table region exceeds its source page');
    const [left, top, right, bottom] = part.crop;
    // The reader accepts bottom-origin PDF points. Publish the precise target
    // before painting so Open in PDF still works if rendering fails.
    const [, targetY] = base.convertToPdfPoint(left, top);
    publishSourceLocation(state, request, targetY);
    const width = right - left;
    const height = bottom - top;
    // CSS fits both catalog and detail canvases to the live pane width. Render
    // enough pixels for that width while retaining the existing memory bounds.
    const targetWidth = Math.max(
      state.detail ? 1100 : 730,
      state.viewport.clientWidth * Math.min(root.devicePixelRatio || 1, 2)
    );
    const scale = Math.min(4, targetWidth / width, Math.sqrt(MAX_PIXELS / (width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    let displayed = false;
    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Browser canvas is unavailable');
      const task = page.render({
        canvasContext: context,
        viewport: page.getViewport({ scale }),
        transform: [1, 0, 0, 1, -left * scale, -top * scale],
        background: '#fff'
      });
      tasks.add(task);
      state.task = task;
      try {
        await task.promise;
      } finally {
        tasks.delete(task);
        if (state.task === task) state.task = null;
      }
      if (!isCurrent(state, request)) return;
      context.fillStyle = '#fff';
      for (const [x0, y0, x1, y1] of part.exclude) {
        context.fillRect(
          (x0 - left) * scale,
          (y0 - top) * scale,
          (x1 - x0) * scale,
          (y1 - y0) * scale
        );
      }
      canvas.className = 'atlas-source-table';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute(
        'aria-label',
        `Table ${state.label}, page ${state.index + 1} of ${state.parts.length}, from PDF page ${part.page}`
      );
      const scroll = { top: state.viewport.scrollTop, left: state.viewport.scrollLeft };
      state.viewport.replaceChildren(canvas);
      state.viewport.scrollTop = scroll.top;
      state.viewport.scrollLeft = scroll.left;
      releaseCanvas(state.canvas);
      state.canvas = canvas;
      displayed = true;
      state.holder.classList.remove('table-preview-unavailable');
      state.holder.removeAttribute('aria-busy');
    } finally {
      if (!displayed) releaseCanvas(canvas);
    }
  }

  function renderCurrent(state) {
    if (!isCurrent(state)) return Promise.resolve();
    const request = ++state.request;
    state.task?.cancel?.();
    // Navigation is useful even while a page is queued or fails to load.
    if (!state.sourceLocation) publishSourceLocation(state, request, 0);
    state.holder.setAttribute('aria-busy', 'true');
    return enqueue(async () => {
      try {
        await paint(state, request);
      } catch (error) {
        if (!isCurrent(state, request)) return;
        console.warn('Table preview unavailable', state.label, error);
        showError(state, 'Table preview unavailable · Open in PDF');
      }
    });
  }

  async function prepare(state) {
    try {
      if (!sourceURL) return showError(state, 'Choose a PDF to display tables');
      if (!regions || !root.AtlasEquationPreview?.getDocument)
        throw new Error('PDF renderer is unavailable');
      state.pdf = await root.AtlasEquationPreview.getDocument();
      if (!isCurrent(state)) return;
      const manifest = root.AtlasTableManifest;
      if (regions.matchesDocument(manifest, root.ATLAS_SOURCE_SHA256, state.pdf.numPages)) {
        state.parts = regions.findParts(manifest, state.label);
        if (!state.parts) throw new Error('No reviewed regions for this table');
      } else {
        if (
          !Number.isInteger(state.pageNumber) ||
          state.pageNumber < 1 ||
          state.pageNumber > state.pdf.numPages
        )
          throw new Error('Invalid source page');
        const page = await state.pdf.getPage(state.pageNumber);
        if (!isCurrent(state)) return;
        const viewport = page.getViewport({ scale: 1 });
        // Other editions have no reviewed bounds. Show the actual source page
        // explicitly, without guessing which rows belong to the table.
        state.parts = [
          { page: state.pageNumber, crop: [0, 0, viewport.width, viewport.height], exclude: [] }
        ];
        state.fallback = true;
      }
      buildView(state);
      return renderCurrent(state);
    } catch (error) {
      if (!isCurrent(state)) return;
      console.warn('Table preview unavailable', state.label, error);
      showError(state, 'Table preview unavailable · Open in PDF');
    }
  }

  function mount(holder, label, pageNumber, { onPageChange } = {}) {
    if (!holder) return Promise.resolve();
    const previous = mounts.get(holder);
    if (
      previous?.generation === generation &&
      previous.label === String(label) &&
      previous.pageNumber === Number(pageNumber)
    )
      return previous.ready;
    previous?.task?.cancel?.();
    releaseCanvas(previous?.canvas);
    const state = {
      holder,
      label: String(label || ''),
      pageNumber: Number(pageNumber),
      detail: holder.classList.contains('table-detail-preview'),
      generation,
      request: 0,
      index: 0,
      parts: [],
      task: null,
      canvas: null,
      fallback: false,
      sourceLocation: null,
      onPageChange
    };
    mounts.set(holder, state);
    holder.setAttribute('aria-busy', 'true');
    state.ready = prepare(state);
    return state.ready;
  }

  root.AtlasTablePreview = Object.freeze({ mount, setSource });
})(window);
