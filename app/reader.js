/* Atlas native-PDF reader. The reader shows ONLY the PDF selected by this user.
   There are no bundled page images, text layers, OCR outputs, or source documents. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const meta = window.ATLAS_READER_META;
  const url = window.ATLAS_PDF_URL;
  let frame = $('importedPdfFrame');
  const esc = s =>
    String(s || '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  let current = Math.min(meta.pageCount, Number(window.ATLAS_IMPORT_START_PAGE) || 1),
    zoom = 100,
    loadGeneration = 0,
    jumpSequence = 0,
    lastTargetY = 0;
  // Do not repeatedly reload the native PDF viewer when the user is browsing
  // catalog entries in Explore mode. The target page is ready when Book opens.
  let pendingRender = false,
    pendingNavigation,
    renderedUrl = '';
  $('readerPage').max = String(meta.pageCount);
  const label = p => meta.labels[p - 1] || String(p);
  function pageHeight(page) {
    // The upper edge converts between PDF coordinates and displayed offsets.
    // CropBox and MediaBox can be inherited from the page tree.
    const engine = window.ATLAS_PDF_ENGINE;
    let mediaTop;
    try {
      let id = engine?.pageObjects[page - 1];
      for (let depth = 0; id && depth < 12; depth++) {
        const dict = engine.get(id) || '';
        for (const [, type, values] of dict.matchAll(/\/(CropBox|MediaBox)\s*\[([^\]]+)\]/g)) {
          const box = values.trim().split(/\s+/).map(Number);
          if (box.length !== 4 || !box.every(Number.isFinite) || box[3] <= box[1]) continue;
          if (type === 'CropBox') return box[3];
          mediaTop ??= box[3];
        }
        id = Number(dict.match(/\/Parent\s+(\d+)\s+\d+\s+R\b/)?.[1]);
      }
    } catch (_) {}
    return mediaTop ?? 781; // Default crop top for the reviewed edition.
  }
  function usesFirefoxPdfViewer() {
    return /\bFirefox\//.test(window.navigator?.userAgent || '');
  }
  function sourceUrl(page, y = 0) {
    if (Number.isFinite(y) && y > 0) {
      const pageTop = pageHeight(page);
      // Firefox PDF.js uses a PDF XYZ coordinate. Chromium uses a top offset.
      const anchor = usesFirefoxPdfViewer()
        ? Math.min(pageTop, y + 115)
        : Math.max(0, pageTop - y - 115);
      return url + '#page=' + page + '&zoom=' + zoom + ',0,' + Math.round(anchor);
    }
    return url + '#page=' + page + '&zoom=' + zoom;
  }
  function navigate(page, title, y = 0) {
    window.AtlasNavigate?.(page, title, y);
  }
  function show(page, y = 0, reveal = true, navigation) {
    current = Math.max(1, Math.min(meta.pageCount, Math.round(Number(page) || 1)));
    lastTargetY = Number.isFinite(Number(y)) && Number(y) > 0 ? Number(y) : 0;
    if ($('readerTargetBadge')) $('readerTargetBadge').hidden = !lastTargetY;
    if (reveal) window.AtlasLayout?.revealBook();
    $('readerPrinted').textContent = 'Book p. ' + label(current);
    if (document.body.classList.contains('layout-no-book')) {
      pendingRender = true;
      pendingNavigation = navigation;
      return;
    }
    pendingRender = false;
    pendingNavigation = undefined;
    $('readerFallback').hidden = true;
    $('printedJump').value = label(current);
    $('readerPage').value = current;
    if (frame) {
      const wanted = sourceUrl(current, lastTargetY);
      const hasSource = frame.hasAttribute('src');
      const snap = navigation === 'snap';
      const fastJump = hasSource && snap && usesFirefoxPdfViewer();
      const replace = hasSource && (navigation === 'retry' || (snap && !fastJump));
      const viewer = replace ? frame.cloneNode(false) : frame;
      const request = ++loadGeneration;
      viewer.onerror = () => {
        if (request !== loadGeneration) return;
        $('readerFallback').hidden = false;
        $('readerMessage').textContent =
          'The browser could not display this PDF; use Open PDF above.';
      };
      if (fastJump) {
        // Native scrolling leaves the URL alone. A new fragment retriggers
        // the destination even when the user chooses the same entry again.
        const destination = wanted + '&atlasJump=' + ++jumpSequence;
        try {
          viewer.contentWindow.location.replace(destination);
        } catch (_) {
          viewer.src = destination;
        }
      } else if (replace || renderedUrl !== wanted) {
        viewer.src = wanted;
      }
      viewer.hidden = false;
      if (replace) {
        frame.replaceWith(viewer);
        frame = viewer;
      }
      renderedUrl = wanted;
    }
    document.dispatchEvent(
      new CustomEvent('atlas-page-rendered', { detail: { page: current, links: null } })
    );
  }
  new MutationObserver(() => {
    const hidden = document.body.classList.contains('layout-no-book');
    if (!hidden && pendingRender) show(current, lastTargetY, false, pendingNavigation);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  function renderOutline(q = '') {
    const tree = $('outlineTree');
    tree.replaceChildren();
    const filter = q.trim().toLowerCase();
    const parents = [{ level: 0, container: tree }];
    meta.outline.forEach((record, i) => {
      if (filter && !record.title.toLowerCase().includes(filter)) return;
      const hasChildren = !filter && meta.outline[i + 1]?.level > record.level;
      while (parents.length > 1 && parents.at(-1).level >= record.level) parents.pop();
      const node = document.createElement('button');
      node.className = 'outline-link';
      node.innerHTML =
        '<span>' + esc(record.title) + '</span><small>' + esc(label(record.page)) + '</small>';
      node.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        navigate(record.page, record.title);
      });
      if (hasChildren) {
        const details = document.createElement('details'),
          summary = document.createElement('summary'),
          body = document.createElement('div');
        summary.appendChild(node);
        details.append(summary, body);
        parents.at(-1).container.appendChild(details);
        parents.push({ level: record.level, container: body });
      } else parents.at(-1).container.appendChild(node);
    });
    if (!tree.childElementCount) tree.textContent = 'No matching bookmark.';
  }
  function jumpPrinted() {
    const value = $('printedJump').value.trim().toLowerCase();
    const i = meta.labels.findIndex(l => String(l).toLowerCase() === value);
    if (i >= 0) {
      $('printedJump').setCustomValidity('');
      navigate(i + 1, 'Printed book page ' + value);
    } else {
      $('printedJump').setCustomValidity('This page label is not in the PDF.');
      $('printedJump').reportValidity();
    }
  }
  function expand(on) {
    window.AtlasLayout?.setPreset(on ? 'read' : 'browse');
  }
  function changeZoom(delta) {
    zoom = Math.max(50, Math.min(300, zoom + delta));
    $('zoomReadout').textContent = zoom + '%';
    show(current, lastTargetY, false);
  }
  $('outlineToggle').addEventListener('click', () => {
    let opening = $('outlinePanel').hidden;
    $('outlinePanel').hidden = !opening;
    $('outlineToggle').setAttribute('aria-expanded', String(opening));
    if (opening && !$('outlineTree').childElementCount) renderOutline();
    window.AtlasLayout?.refresh?.();
  });
  $('outlineSearch').addEventListener('input', e => renderOutline(e.target.value));
  $('zoomIn').addEventListener('click', () => changeZoom(25));
  $('zoomOut').addEventListener('click', () => changeZoom(-25));
  $('zoomFit').addEventListener('click', () => {
    zoom = 100;
    show(current, lastTargetY, false);
  });
  // Link guidance lives with the optional reading tools, not in a persistent footer.
  $('highlightLinks').addEventListener('click', () => {
    $('readerMessage').textContent =
      'The viewer uses hyperlinks already present in your PDF. Atlas does not add or alter links.';
  });
  $('expandReader').addEventListener('click', () => {
    if (window.AtlasLayout?.isReadingOnly()) window.AtlasLayout.atlasView();
    else expand(true);
  });
  $('closeReader').addEventListener('click', () => expand(false));
  $('printedGo').addEventListener('click', jumpPrinted);
  $('printedJump').addEventListener('input', () => $('printedJump').setCustomValidity(''));
  $('printedJump').addEventListener('keydown', e => {
    if (e.key === 'Enter') jumpPrinted();
  });
  $('retryPage').addEventListener('click', () => {
    show(current, lastTargetY, false, 'retry');
  });
  $('copyPageText').addEventListener('click', async () => {
    const text = window.ATLAS_PAGES.find(p => p.pdf_page === current)?.text || '';
    try {
      await navigator.clipboard.writeText(text);
      $('readerMessage').textContent = 'Page text copied.';
    } catch (e) {
      const input = document.createElement('textarea');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      input.remove();
      $('readerMessage').textContent = ok
        ? 'Page text copied.'
        : 'Select text within the PDF and use Copy.';
    }
  });
  window.AtlasReader = {
    show,
    expand,
    load: async p => ({ text: window.ATLAS_PAGES[p - 1]?.text || '' }),
    current: () => current,
    position: () => lastTargetY,
    yFromTop: (page, top) => Math.max(0, pageHeight(page) - top),
    setTargetLabel: label => {
      const badge = $('readerTargetBadge');
      if (badge && lastTargetY) {
        badge.hidden = false;
        badge.textContent = String(label || 'Source location').slice(0, 90);
        badge.title = 'Source entry position in the original PDF. Viewer support varies.';
      }
    },
    resize: () => {}
  };
})();
