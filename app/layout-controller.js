/* Pane layout controller, guide and resize state (offline). */
(() => {
  'use strict';
  const $ = id => document.getElementById(id),
    root = document.documentElement;
  const defaults = {
    version: 3,
    nav: true,
    atlas: true,
    book: false,
    navWidth: 232,
    bookRatio: 0.55,
    outlineWidth: 250,
    tools: false,
    folds: {},
    heights: {}
  };
  const copy = x => JSON.parse(JSON.stringify(x));
  const safeRead = key => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  // Readable minimums for dragged panels. A view can still be hidden entirely.
  // Preferred dimensions are kept if the window shrinks, and restored later.
  const limits = Object.freeze({
    navMin: 205,
    navMax: 850,
    bookMin: 395,
    atlasMin: 375,
    ratioMin: 0.04,
    ratioMax: 0.96,
    outlineMin: 215,
    outlineMax: 950,
    bookViewMin: 270,
    divider: 10
  });
  let effectiveNavWidth = defaults.navWidth,
    navOverlay = false;
  const workspaceWidth = () => $('content').closest('.workspace')?.clientWidth || window.innerWidth;
  function navShouldOverlay() {
    return (
      state.nav &&
      !mobile &&
      state.atlas &&
      state.book &&
      workspaceWidth() < limits.navMin + limits.bookMin + limits.atlasMin + 2 * limits.divider
    );
  }
  function navBounds() {
    if (navOverlay)
      return [limits.navMin, Math.max(limits.navMin, Math.min(450, workspaceWidth() - 45))];
    const contentMin =
      atlasVisible() && state.book
        ? limits.bookMin + limits.atlasMin + 2 * limits.divider
        : (state.book ? limits.bookMin : limits.atlasMin) + limits.divider;
    return [
      limits.navMin,
      Math.max(limits.navMin, Math.min(limits.navMax, workspaceWidth() - contentMin))
    ];
  }
  function availableSplitWidth() {
    const v = state.nav && !mobile && !navOverlay ? effectiveNavWidth + limits.divider : 0;
    return Math.max(1, workspaceWidth() - v - (atlasVisible() && state.book ? limits.divider : 0));
  }
  function bookWidthBounds(available) {
    if (!atlasVisible()) return [available, available];
    // When both panes are visible, neither side can be dragged below the
    // width at which text, inputs, and the PDF toolbar remain readable.
    if (available < limits.bookMin + limits.atlasMin) {
      const mid = (available * limits.bookMin) / (limits.bookMin + limits.atlasMin);
      return [mid, mid];
    }
    return [limits.bookMin, available - limits.atlasMin];
  }
  function outlineIsOverlay() {
    return $('reader').clientWidth < limits.outlineMin + limits.bookViewMin + limits.divider;
  }
  function outlineBounds() {
    const room = $('reader')?.clientWidth || window.innerWidth;
    const overlay = outlineIsOverlay();
    const max = Math.min(
      limits.outlineMax,
      Math.max(limits.outlineMin, overlay ? room - 38 : room - limits.bookViewMin - limits.divider)
    );
    return [Math.min(limits.outlineMin, max), max];
  }
  function clean(value) {
    const s = copy(defaults);
    if (!value || typeof value !== 'object') return s;
    ['nav', 'atlas', 'book', 'tools'].forEach(k => {
      if (typeof value[k] === 'boolean') s[k] = value[k];
    });
    [
      ['navWidth', limits.navMin, limits.navMax],
      ['bookRatio', limits.ratioMin, limits.ratioMax],
      ['outlineWidth', limits.outlineMin, limits.outlineMax]
    ].forEach(([k, a, b]) => {
      if (Number.isFinite(value[k])) s[k] = clamp(value[k], a, b);
    });
    ['folds', 'heights'].forEach(k => {
      if (value[k] && typeof value[k] === 'object')
        for (const [key, v] of Object.entries(value[k]).slice(0, 1000))
          if (
            key !== '__proto__' &&
            key !== 'constructor' &&
            (typeof v === 'boolean' || (Number.isFinite(v) && v >= 45 && v <= 12000))
          )
            s[k][key] = v;
    });
    if (!s.atlas && !s.book) s.atlas = true;
    return s;
  }
  let state = clean(safeRead('ea_layout_v3')),
    noticeTimer;
  let mobile = window.innerWidth < 800,
    mobileNav = false;
  // Keep the desktop layout when a narrow window temporarily shows one pane.
  const navVisible = () => (mobile ? mobileNav : state.nav);
  const atlasVisible = () => state.atlas && !(mobile && state.book);
  const isReadingOnly = () => state.book && !atlasVisible();
  function save() {
    try {
      localStorage.setItem('ea_layout_v3', JSON.stringify(state));
    } catch (_) {}
  }
  function notify(text) {
    $('layoutNotice').textContent = text;
    $('layoutNotice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => ($('layoutNotice').hidden = true), 3000);
  }
  function apply(persist = true) {
    if (!state.atlas && !state.book) state.atlas = true;
    document.body.classList.remove('reader-expanded', 'reader-open', 'compact-reader');
    document.body.classList.toggle('layout-no-nav', !navVisible());
    document.body.classList.toggle('layout-no-atlas', !atlasVisible());
    document.body.classList.toggle('layout-no-book', !state.book);
    navOverlay = navShouldOverlay();
    document.body.classList.toggle('layout-nav-overlay', navOverlay);
    effectiveNavWidth =
      state.nav && !mobile ? clamp(state.navWidth, ...navBounds()) : state.navWidth;
    root.style.setProperty('--nav-width', effectiveNavWidth + 'px');
    const available = availableSplitWidth();
    const [minBook, maxBook] = bookWidthBounds(available);
    const actualBookWidth = clamp(available * state.bookRatio, minBook, maxBook);
    root.style.setProperty('--book-width', actualBookWidth + 'px');
    const outlineOverlay = outlineIsOverlay();
    $('reader').classList.toggle(
      'reader-outline-overlay',
      outlineOverlay && !$('outlinePanel').hidden
    );
    const effectiveOutline = clamp(state.outlineWidth, ...outlineBounds());
    root.style.setProperty('--outline-width', effectiveOutline + 'px');
    $('readerMore').hidden = !state.tools;
    $('readerToolsToggle').setAttribute('aria-expanded', String(state.tools));
    $('readerToolsToggle').textContent = state.tools ? 'Tools ▴' : 'Tools ▾';
    const expandReader = $('expandReader');
    const readerAction = isReadingOnly()
      ? mobile
        ? 'Back to Atlas'
        : 'Side by side'
      : 'Focus book';
    expandReader.textContent = readerAction;
    expandReader.title = readerAction;
    $('navDivider').setAttribute('aria-valuemin', String(limits.navMin));
    $('navDivider').setAttribute('aria-valuemax', String(Math.round(navBounds()[1])));
    $('navDivider').setAttribute('aria-valuenow', String(Math.round(effectiveNavWidth)));
    $('navDivider').setAttribute(
      'aria-valuetext',
      Math.round(effectiveNavWidth) + ' pixels, Menu or List column'
    );
    $('bookDivider').setAttribute('aria-valuemin', String(Math.round(minBook)));
    $('bookDivider').setAttribute('aria-valuemax', String(Math.round(maxBook)));
    $('bookDivider').setAttribute('aria-valuenow', String(Math.round(actualBookWidth)));
    $('bookDivider').setAttribute(
      'aria-valuetext',
      Math.round((100 * actualBookWidth) / available) + '% of main workspace for book'
    );
    $('outlineDivider').setAttribute('aria-valuemin', String(Math.round(outlineBounds()[0])));
    $('outlineDivider').setAttribute('aria-valuemax', String(Math.round(outlineBounds()[1])));
    $('outlineDivider').setAttribute(
      'aria-valuenow',
      String(Math.round(clamp(state.outlineWidth, ...outlineBounds())))
    );
    $('outlineDivider').hidden = $('outlinePanel').hidden || outlineOverlay;
    if (persist) save();
    requestAnimationFrame(() => window.AtlasReader?.resize());
  }
  function setPreset(name) {
    if (!['browse', 'study', 'read', 'focus'].includes(name)) return;
    state.atlas = name !== 'read';
    state.book = name === 'study' || name === 'read';
    if (name === 'focus' && !mobile) state.nav = false;
    mobileNav = false;
    apply();
  }
  function atlasView() {
    state.atlas = true;
    if (mobile) {
      state.book = false;
      mobileNav = false;
    }
    apply();
  }
  function revealBook() {
    if (mobile && !state.book) state.atlas = false;
    state.book = true;
    mobileNav = false;
    apply();
  }
  function toggleNav() {
    if (mobile) mobileNav = !mobileNav;
    else state.nav = !state.nav;
    apply(!mobile);
  }
  function toggle(k) {
    state[k] = !(k === 'atlas' ? atlasVisible() : state[k]);
    if (k === 'book' && state.book && mobile) state.atlas = false;
    if (k === 'atlas' && state.atlas && mobile) state.book = false;
    if (!state.book && !state.atlas) state[k === 'book' ? 'atlas' : 'book'] = true;
    apply();
  }
  $('readerToolsToggle').addEventListener('click', () => {
    state.tools = !state.tools;
    apply();
  });
  function resetLayout() {
    state = copy(defaults);
    mobileNav = false;
    document.querySelectorAll('.fold-panel').forEach(el => {
      el.open = el.dataset.defaultOpen === 'true';
      const body = el.querySelector('.fold-body');
      if (body) body.style.height = '';
    });
    apply();
    document.dispatchEvent(new CustomEvent('atlas-layout-reset'));
    notify('Layout reset. Notes, bookmarks, and calculator inputs are unchanged.');
  }
  function toggleSections() {
    const list = [...$('content').querySelectorAll('.fold-panel,details.calc-fold')];
    const opening = !list.some(el => el.open);
    list.forEach(el => (el.open = opening));
    return opening;
  }
  function splitter(id, get, set, keyboardStep = 10, extremes = null) {
    const el = $(id);
    let startX = 0,
      start = 0,
      pointerId = null;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || pointerId !== null) return;
      e.preventDefault();
      startX = e.clientX;
      start = get();
      pointerId = e.pointerId;
      el.setPointerCapture(pointerId);
      document.body.classList.add('resizing');
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== pointerId || !el.hasPointerCapture(pointerId)) return;
      set(start, e.clientX - startX);
      apply(false);
    });
    const finish = e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      document.body.classList.remove('resizing');
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      save();
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', () => {
      if (pointerId === null) return;
      pointerId = null;
      document.body.classList.remove('resizing');
      save();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        set(get(), (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 45 : keyboardStep));
        apply();
      } else if (extremes && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        extremes(e.key === 'End');
        apply();
      }
    });
  }
  splitter(
    'navDivider',
    () => effectiveNavWidth,
    (start, dx) => {
      state.navWidth = clamp(start + dx, ...navBounds());
    },
    10,
    far => {
      state.navWidth = far ? navBounds()[1] : limits.navMin;
    }
  );
  splitter(
    'bookDivider',
    () => $('reader').getBoundingClientRect().width,
    (start, dx) => {
      const space = availableSplitWidth();
      const [min, max] = bookWidthBounds(space);
      state.bookRatio = clamp(
        clamp(start - dx, min, max) / space,
        limits.ratioMin,
        limits.ratioMax
      );
    },
    10,
    far => {
      // End moves the divider to the right; Home moves it left.
      const [min, max] = bookWidthBounds(availableSplitWidth());
      state.bookRatio = (far ? min : max) / availableSplitWidth();
    }
  );
  splitter(
    'outlineDivider',
    () => clamp(state.outlineWidth, ...outlineBounds()),
    (start, dx) => {
      state.outlineWidth = clamp(start + dx, ...outlineBounds());
    },
    10,
    far => {
      state.outlineWidth = far ? outlineBounds()[1] : limits.outlineMin;
    }
  );
  $('navDivider').addEventListener('dblclick', () => {
    state.navWidth = defaults.navWidth;
    apply();
  });
  $('bookDivider').addEventListener('dblclick', () => {
    state.bookRatio = defaults.bookRatio;
    apply();
  });
  $('outlineDivider').addEventListener('dblclick', () => {
    state.outlineWidth = defaults.outlineWidth;
    apply();
  });
  new MutationObserver(() => {
    $('outlineDivider').hidden = $('outlinePanel').hidden;
  }).observe($('outlinePanel'), { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => {
    const now = window.innerWidth < 800;
    if (now !== mobile) {
      mobile = now;
      mobileNav = false;
    }
    apply(false);
  });
  // On phones, selecting a destination closes the overlay without changing views.
  $('mainNav').addEventListener('click', e => {
    if (mobile && mobileNav && e.target.closest('[data-view]')) {
      mobileNav = false;
      apply(false);
    }
  });
  // Fold the large supporting sections, but never hide an entry's main text.
  const slug = s =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 130);
  function decorate() {
    const context = slug($('content').querySelector('h1')?.textContent || 'atlas');
    const candidates = [
      ...$('content').querySelectorAll('.section-block,.stat-grid,.path-card,.note-box')
    ];
    candidates.forEach((el, i) => {
      if (el.closest('.fold-panel') || el.closest('.guide-only')) return;
      const heading = el.querySelector('h2,h3,strong');
      const label = el.classList.contains('stat-grid')
        ? 'Book coverage'
        : el.classList.contains('note-box')
          ? 'Your note'
          : heading?.textContent || 'Details';
      const key = context + '/' + slug(label),
        d = document.createElement('details');
      d.className = 'fold-panel';
      d.dataset.foldKey = key;
      const initiallyOpen = el.classList.contains('path-card')
        ? i === 0
        : !/coverage|reference tools|figures in|equations in|your note/i.test(label);
      d.dataset.defaultOpen = String(initiallyOpen);
      d.open = state.folds[key] ?? initiallyOpen;
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.className = 'fold-summary-title';
      title.textContent = label;
      summary.append(title);
      const tip = document.createElement('small');
      tip.textContent = 'expand / collapse';
      summary.append(tip);
      const body = document.createElement('div');
      body.className = 'fold-body';
      if (state.heights[key]) body.style.height = state.heights[key] + 'px';
      el.before(d);
      body.append(el);
      d.append(summary, body);
      d.addEventListener('toggle', () => {
        state.folds[key] = d.open;
        save();
      });
      body.addEventListener('pointerup', () => {
        if (body.style.height) {
          state.heights[key] = parseFloat(body.style.height);
          save();
        }
      });
    });
  }
  let decorating = false;
  new MutationObserver(() => {
    if (decorating) return;
    decorating = true;
    queueMicrotask(() => {
      decorate();
      decorating = false;
    });
  }).observe($('content'), { childList: true, subtree: true });
  const topics = {
    start: `<h3>Everything is one jump away</h3><div class="guide-step"><strong>1. Find anything.</strong> Click the search field (Ctrl/⌘+K). Type a concept, section number such as 7.2.2, or a page command such as “p 311”. Pick a result with ↑/↓ and Enter.</div><div class="guide-step"><strong>2. Get back easily.</strong> The ← and → buttons on the top bar are Atlas history. After opening a search result, use ← to return to your results. Your PDF has separate page and history controls under Tools.</div><div class="guide-step"><strong>3. Choose your view.</strong> <em>Explore</em> gives the encyclopedia room. <em>Read</em> focuses the original PDF. <em>Together</em> displays both side by side. Use <em>Menu</em> to toggle navigation, or open <em>Guide → Layout</em> for additional layout actions.</div><div class="guide-step"><strong>4. Learn or calculate.</strong> Study paths guide you through a topic. The 24 calculators remain linked to their source sections. Saved items hold your bookmarks and notes.</div><div class="button-row"><button class="primary" data-go="book">Explore chapters</button><button class="secondary" data-go="paths">Study paths</button><button class="secondary" data-go="calculators">Calculators</button></div><p>The entire interface works offline. The textbook content is constructed from the PDF you import, and the distributed program includes none of the book's pages or extracted indexes.</p>`,
    layout: `<h3>Choose how you work</h3><p>The top bar has <strong>Explore</strong> (encyclopedia), <strong>Together</strong> (encyclopedia and book), and <strong>Read</strong> (PDF only). This handles most use cases.</p><p>Drag the dividers to resize panes. On small screens, the book and encyclopedia use separate views. The actions below include Atlas-only focus, section folding, layout reset, and shortcuts.</p><p>Choose <strong>Figures</strong>, <strong>Tables</strong>, <strong>Equations</strong>, <strong>Problems</strong>, or <strong>References</strong> in Menu to open that catalog in the second column. The catalog opens even from Read mode; on phones, it replaces the PDF view and closes the menu. Press <strong>Shift+L</strong> for the optional compact list in the first column, <strong>← Menu</strong> to return to the category buttons, or <strong>Index ↗</strong> to open its full catalog. Menu and the compact list share one width and resize handle. Use <strong>Hide bar</strong> in the PDF viewer’s top-right corner to maximize reading space, or press <strong>Shift+H</strong>. The unobtrusive <strong>Show bar</strong> control restores it. In book-only mode, a floating <strong>Back to Atlas</strong> control also returns to the encyclopedia.</p><p><strong>Remember:</strong> the left and right arrow buttons on the top bar go backward and forward through Atlas pages. The arrows inside the PDF pane go through PDF page history.</p><div class="button-row"><button class="secondary" data-layout="browse">Explore</button><button class="secondary" data-layout="study">Together</button><button class="secondary" data-layout="read">Read</button></div><div class="button-row atlas-guide-layout-actions"><button class="secondary" data-layout="focus">Focus Atlas</button><button class="secondary" data-layout-action="fold">Collapse / expand sections</button><button class="secondary" data-layout-action="reset">Reset layout</button><button class="secondary" data-layout-action="shortcuts">Keyboard shortcuts</button></div>`,
    read: `<h3>Read your original PDF offline</h3><p>For dependable one-time source selection, start Atlas using the included Windows, macOS, or Linux portable launcher and choose your PDF once. Later launches automatically reopen the same path without storing any PDF content. If you start the HTML file directly, browser security may require permission again or another file selection. The reader uses your browser’s built-in PDF viewer; nothing is sent online, and the book and page extracts are not included in the app folder.</p><p>Use the main PDF toolbar for page navigation, recent-page history, bookmarks, and opening the source PDF. Open the <strong>Tools</strong> panel for printed-page jumps, zoom, layout, link help, and page-text copying. The native viewer handles any hyperlinks that are already in your original document, without modifying it. The top-bar Back and Forward arrows navigate Atlas screens, not PDF pages.</p><p>Original, unmodified PDFs may not contain the additional links of a hyperlinked edition. The <strong>Links</strong> button explains this behavior inside the <strong>Tools</strong> menu, without drawing an overlay.</p><p>Your notes, progress, and calculator preferences remain local. Text selection and browser PDF controls depend on the browser. In an equation, figure, table, or problem detail, choose <strong>View in main reader</strong> to jump into this PDF pane; the browser may honor an approximate vertical equation-position hint. No small secondary PDF viewer appears. If your browser blocks embedded local PDF display, select <strong>Open PDF ↗</strong> above the reader. The PDF-only view also has a direct <strong>← Atlas</strong> return button.</p><div class="guide-shortcuts"><kbd>[ / ]</kbd><span>Previous / next PDF page</span><kbd>B</kbd><span>Bookmark the current page</span><kbd>/ or Ctrl K</kbd><span>Open quick navigation</span><kbd>G</kbd><span>Open this guide</span><kbd>Esc</kbd><span>Close this window</span></div>`,
    calc: `<h3>24 tools, one clear workspace</h3><p>Use the new searchable tool library on the left and filter it by scientific area. On narrow screens the library folds above the selected workbench. Only the selected calculator is expanded. Input labels show units; changing a unit converts the displayed value rather than changing the physical quantity.</p><p>Open <strong>Model & sources</strong> for the governing equations, assumptions, restrictions, and book links. Red messages reject invalid inputs; amber messages warn when an approximation or physical regime needs attention.</p><p>Some tools offer inverse calculations. Others include an illustrative curve and CSV export. These are model evaluations, not fitted experimental data. EIS includes an ideal RC circuit or a semi-infinite Warburg branch, with Nyquist and Bode views.</p><p>Current magnitudes are explicitly labeled. Signed tools let you choose the book's cathodic-positive convention or anodic-positive convention. Tafel and Butler–Volmer tools deliberately use a one-step, one-electron model rather than assigning an arbitrary overall electron count.</p><p>Inputs are remembered in this browser. <strong>Reset</strong> resets only the selected tool. <strong>Copy results</strong> copies formatted output, and <strong>Export</strong> records inputs, units, assumptions, and output. The mathematical checks do not establish that a model is appropriate for a particular experiment.</p><button class="primary" data-go="calculators">Open calculators</button>`,
    data: `<h3>Your private study layer</h3><p>Bookmarks, section notes, reading progress, layout settings, and calculator inputs stay in this browser. Notes save automatically as you type. No content or usage is uploaded. External source links are optional and need internet only when you click them.</p><p>In <strong>Bookmarks & notes</strong>, use <strong>Export backup</strong> before changing computers, moving the app, or clearing browser data. The current backup format includes layout and calculator settings and still accepts earlier note backups.</p><p>Keep the same folder path and browser when updating from an older version, to maximize continuity. Browser local-file storage behavior varies; an exported backup is the dependable way to move your data.</p><button class="primary" data-go="notes">Open bookmarks & notes</button>`
  };
  function showTopic(name) {
    if (!topics[name]) name = 'start';
    $('guideContent').innerHTML = topics[name];
    $('guideContent').setAttribute('aria-labelledby', 'guide-tab-' + name);
    document.querySelectorAll('[data-guide]').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.guide === name));
      b.tabIndex = b.dataset.guide === name ? 0 : -1;
    });
    $('guideContent')
      .querySelectorAll('[data-go]')
      .forEach(b =>
        b.addEventListener('click', () => {
          $('guideDialog').close();
          window.AtlasApp?.goView(b.dataset.go);
        })
      );
    $('guideContent')
      .querySelectorAll('[data-layout]')
      .forEach(b =>
        b.addEventListener('click', () => {
          $('guideDialog').close();
          setPreset(b.dataset.layout);
        })
      );
    $('guideContent')
      .querySelectorAll('[data-layout-action]')
      .forEach(b =>
        b.addEventListener('click', () => {
          const action = b.dataset.layoutAction;
          $('guideDialog').close();
          if (action === 'fold') toggleSections();
          else if (action === 'reset') resetLayout();
          else if (action === 'shortcuts') $('helpDialog').showModal();
        })
      );
    $('guideContent').scrollTop = 0;
  }
  function showGuide(name = 'start') {
    showTopic(name);
    if (!$('guideDialog').open) $('guideDialog').showModal();
  }
  $('closeGuide').addEventListener('click', () => $('guideDialog').close());
  document
    .querySelectorAll('[data-guide]')
    .forEach(b => b.addEventListener('click', () => showTopic(b.dataset.guide)));
  document.querySelector('.guide-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...document.querySelectorAll('[data-guide]')],
      i = tabs.indexOf(document.activeElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    showTopic(tabs[next].dataset.guide);
  });
  document.addEventListener('keydown', e => {
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      e.key.toLowerCase() === 'g' &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) &&
      !document.querySelector('dialog[open]')
    ) {
      e.preventDefault();
      showGuide();
    }
  });
  window.AtlasLayout = {
    setPreset,
    atlasView,
    revealBook,
    toggleNav,
    toggleAtlas: () => toggle('atlas'),
    toggleBook: () => toggle('book'),
    toggleSections,
    resetLayout,
    refresh: () => apply(false),
    showGuide,
    isTogether: () => state.book && atlasVisible(),
    isReadingOnly,
    exportState: () => copy(state),
    importState: value => {
      state = clean(value);
      mobileNav = false;
      apply();
    },
    notify
  };
  apply(false);
})();
