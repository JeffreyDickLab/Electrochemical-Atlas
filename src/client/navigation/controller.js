/* Navigation, history, and recent activity. Recent activity stores only local
 * source-specific references and submitted queries, never complete book entries. */
(() => {
  'use strict';
  const app = window.AtlasApp;
  const workspace = window.AtlasLayout;
  const catalog = window.ATLAS_CATALOG;
  const specs = window.AtlasCalcEngine?.specs || [];
  if (!app || !workspace || !catalog) return;
  const $ = id => document.getElementById(id);
  const elem = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const labelFor = (type, item) =>
    type === 'section'
      ? item.title
      : type === 'concept'
        ? item.parent
          ? item.parent + ' › ' + item.term
          : item.term
        : item.title ||
          item.term ||
          item.meaning ||
          item.abbr ||
          item.symbol ||
          item.label ||
          'Entry';
  const safe = text =>
    String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  const lc = text =>
    safe(text)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const trim = (v, n = 135) => {
    const s = safe(v);
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  };
  const categoryName = {
    home: 'Home',
    reader: 'Read PDF',
    book: 'Chapters',
    concepts: 'Concept index',
    symbols: 'Symbols',
    figures: 'Figures',
    tables: 'Tables',
    equations: 'Equations',
    problems: 'Problems',
    references: 'References',
    paths: 'Study paths',
    calculators: 'Calculators',
    notes: 'Saved items',
    search: 'Search',
    section: 'Chapters',
    figure: 'Figures',
    table: 'Tables',
    equation: 'Equations',
    problem: 'Problems',
    reference: 'References',
    concept: 'Concept index',
    symbol: 'Symbols',
    abbreviation: 'Symbols',
    chemical: 'Symbols'
  };
  // Sidebar destinations are static and always available in index.html.
  // At a narrow manually resized width, icons remain keyboard accessible.
  const side = $('sidebar');
  const updateCompactNav = () => {
    const width = side.getBoundingClientRect().width;
    side.classList.toggle('atlas-sidebar-compact', width > 0 && width < 160);
  };
  new ResizeObserver(updateCompactNav).observe(side);
  updateCompactNav();
  // The unified toolbar is assembled from live, existing elements.
  // No duplicate panel controls or Workspace section is created.
  const toolbar = document.querySelector('.layout-toolbar');
  toolbar.replaceChildren();
  const historyButtons = elem('div', 'atlas-history-buttons');
  const menu = elem('button', 'atlas-menu-button');
  menu.id = 'atlasMenuButton';
  menu.type = 'button';
  menu.innerHTML = '<span aria-hidden="true">☰</span><span class="atlas-menu-text">Menu</span>';
  menu.title = 'Show or hide the main navigation';
  menu.setAttribute('aria-label', 'Main navigation menu');
  menu.setAttribute('aria-controls', 'sidebar');
  // Menu is the first level of navigation. Browse is the second level
  // within that same sidebar; clicking Menu from Browse returns to Menu.
  menu.addEventListener('click', () => {
    const list = window.AtlasCatalogRail;
    if (list?.isOpen()) list.open(false, { keepSidebar: true });
    else workspace.toggleNav();
  });
  historyButtons.append(menu);
  const back = elem('button', 'atlas-history-button', '←'),
    forward = elem('button', 'atlas-history-button', '→');
  back.id = 'atlasBack';
  forward.id = 'atlasForward';
  back.title = 'Back to the previous Atlas page (Alt+Left)';
  forward.title = 'Forward in Atlas history (Alt+Right)';
  back.setAttribute('aria-label', 'Back to previous Atlas page');
  forward.setAttribute('aria-label', 'Forward to next Atlas page');
  historyButtons.append(back, forward);
  toolbar.append(historyButtons);
  const current = elem('div', 'atlas-location-text', 'Home');
  current.id = 'atlasLocation';
  current.setAttribute('aria-live', 'polite');
  current.title = 'Your current location in the encyclopedia';
  toolbar.append(current);
  const modes = elem('div', 'atlas-view-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Reading layout');
  for (const [id, name, label] of [
    ['explore', 'Explore', 'Encyclopedia only'],
    ['together', 'Together', 'Encyclopedia and book side by side'],
    ['read', 'Read', 'PDF only']
  ]) {
    const b = elem('button', 'atlas-mode', name);
    b.type = 'button';
    b.dataset.atlasMode = id;
    b.title = label;
    modes.append(b);
    b.addEventListener('click', () =>
      workspace.setPreset(id === 'explore' ? 'browse' : id === 'together' ? 'study' : 'read')
    );
  }
  toolbar.append(modes);
  const updateModes = () => {
    const sidebarVisible = !document.body.classList.contains('layout-no-nav');
    const browsingList = document.body.classList.contains('atlas-list-active');
    menu.classList.toggle('active', sidebarVisible);
    menu.setAttribute('aria-expanded', String(sidebarVisible));
    menu.setAttribute('aria-pressed', String(sidebarVisible));
    menu.title = browsingList
      ? 'Back to Menu'
      : sidebarVisible
        ? 'Hide the main navigation'
        : 'Show the main navigation';
    const isBook = !document.body.classList.contains('layout-no-book');
    const isAtlas = !document.body.classList.contains('layout-no-atlas');
    const mode = isBook && !isAtlas ? 'read' : isBook ? 'together' : 'explore';
    modes.querySelectorAll('button').forEach(b => {
      const active = b.dataset.atlasMode === mode;
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('active', active);
    });
  };
  new MutationObserver(updateModes).observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
  updateModes();
  // A mobile menu must be easy to dismiss without losing the current page.
  document.addEventListener('pointerdown', e => {
    if (window.innerWidth >= 800 || document.body.classList.contains('layout-no-nav')) return;
    if (!e.target.closest('#sidebar,#atlasMenuButton')) workspace.toggleNav();
  });
  document.addEventListener('keydown', e => {
    if (
      e.key === 'Escape' &&
      window.innerWidth < 800 &&
      !document.body.classList.contains('layout-no-nav') &&
      !document.body.classList.contains('atlas-list-active') &&
      !document.querySelector('dialog[open]')
    )
      workspace.toggleNav();
  });
  // Keep primary PDF navigation visible in the consolidated reader toolbar.
  // Only the detailed PDF-history controls live in the expandable tools panel.
  const readerToolbar = document.querySelector('.reader-toolbar');
  if (readerToolbar) {
    const returnAtlas = elem('button', 'atlas-reader-return', '← Atlas');
    returnAtlas.id = 'atlasReaderReturn';
    returnAtlas.title = 'Return to the encyclopedia';
    returnAtlas.addEventListener('click', () => workspace.setPreset('browse'));
    readerToolbar.prepend(returnAtlas);
  }
  // PDF history and Atlas history are different concepts. Keep PDF-history
  // controls grouped with the rest of the reader navigation tools.
  const historySlot = $('readerPdfHistorySlot');
  if (historySlot) {
    const pdfHistory = elem('span', 'atlas-pdf-history');
    pdfHistory.append(
      elem('span', 'atlas-pdf-history-label', 'Recent pages'),
      $('readerBack'),
      $('readerForward')
    );
    historySlot.replaceWith(pdfHistory);
  }
  // Simple browser-like navigation history for Atlas content (separate from PDF
  // page history). Entries retain their in-memory item references only.
  let trail = [],
    index = -1,
    restoring = false;
  const content = $('content');
  function recentSourceId() {
    return app.entitySourceId?.() || '';
  }

  // Recent activity and bookmarks resolve through the same source-row keys.
  // Keep the old storage value intact when migrating earlier recent records.
  function createRecentHistory({ storage, sourceId, entityKey, resolveEntity }) {
    const limit = 3;
    const storageKey = sourceId ? `ea_recent_v2:${sourceId}` : null;
    const legacyKey = sourceId ? `ea_recent_v1:${sourceId}` : null;
    const scopes = new Set([
      'all',
      'sections',
      'pages',
      'figures',
      'tables',
      'equations',
      'problems',
      'references',
      'concepts',
      'symbols',
      'glossary'
    ]);
    let migrated = false;
    function searchRecord(value) {
      if (typeof value.query !== 'string') return null;
      const query = value.query.replace(/\s+/g, ' ').trim();
      if (!query || query.length > 2048) return null;
      return { kind: 'search', query, scope: scopes.has(value.scope) ? value.scope : 'all' };
    }
    function toRecord(detail) {
      if (!detail || typeof detail !== 'object') return null;
      if (detail.kind === 'search') return searchRecord(detail);
      if (detail.kind !== 'entity' || !detail.item) return null;
      let key;
      try {
        key = entityKey(detail.type, detail.item);
      } catch (_) {
        return null;
      }
      return typeof key === 'string' && key && key.length <= 4096 ? { kind: 'entity', key } : null;
    }
    function resolveRecord(record) {
      if (!record || typeof record !== 'object') return null;
      if (record.kind === 'search') return searchRecord(record);
      if (
        record.kind !== 'entity' ||
        typeof record.key !== 'string' ||
        !record.key ||
        record.key.length > 4096
      )
        return null;
      let resolved;
      try {
        // The resolver understands the old parent/page/occurrence qualifiers
        // only when they still identify a unique source row.
        resolved = resolveEntity(record.key, record);
      } catch (_) {
        return null;
      }
      return resolved?.item ? { kind: 'entity', type: resolved.type, item: resolved.item } : null;
    }
    function identity(record) {
      return JSON.stringify(
        record.kind === 'search'
          ? ['search', record.scope, record.query.toLowerCase()]
          : ['entity', record.key]
      );
    }
    function load() {
      if (!storageKey || !storage) return [];
      try {
        let raw = storage.getItem(storageKey);
        if (raw === null) {
          raw = storage.getItem(legacyKey);
          migrated = Boolean(raw);
        }
        if (!raw || raw.length > 32768) return [];
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved)) return [];
        const entries = [],
          seen = new Set();
        for (const value of saved.slice(0, 100)) {
          const record = toRecord(resolveRecord(value));
          if (!record || seen.has(identity(record))) continue;
          seen.add(identity(record));
          entries.push(record);
          if (entries.length === limit) break;
        }
        return entries;
      } catch (_) {
        return [];
      }
    }
    let records = load();
    function persist() {
      if (!storageKey || !storage) return;
      try {
        storage.setItem(storageKey, JSON.stringify(records));
      } catch (_) {
        /* The same recent activity remains available in memory. */
      }
    }
    if (migrated) persist();
    return Object.freeze({
      entries: () => records.map(resolveRecord).filter(Boolean),
      resolve: detail => resolveRecord(toRecord(detail)),
      remember(detail) {
        const record = toRecord(resolveRecord(toRecord(detail)));
        if (!record) return false;
        records = [
          record,
          ...records.filter(value => resolveRecord(value) && identity(value) !== identity(record))
        ].slice(0, limit);
        persist();
        return true;
      }
    });
  }
  const recentHistory = createRecentHistory({
    storage: window.AtlasStorage?.create(window),
    sourceId: recentSourceId(),
    entityKey: (type, item) => app.entityKey?.(type, item),
    resolveEntity: (key, qualifier) => app.resolveEntityBookmark?.(key, qualifier)
  });

  function signature(d) {
    if (d.kind === 'view') return 'view:' + d.view;
    if (d.kind === 'search')
      return (
        'search:' +
        d.scope +
        ':' +
        lc(d.query) +
        ':' +
        (Number.isInteger(d.page) && d.page >= 0 ? d.page : 0)
      );
    if (d.kind === 'entity')
      return (
        'entity:' +
        d.type +
        ':' +
        (d.key ||
          app.entityKey?.(d.type, d.item) ||
          d.item?.key ||
          d.item?.label ||
          d.item?.term ||
          d.item?.abbr ||
          d.item?.symbol ||
          d.item?.title ||
          '')
      );
    return '';
  }
  function locationText(d) {
    if (!d) return 'Home';
    if (d.kind === 'view') return categoryName[d.view] || 'Atlas';
    if (d.kind === 'search') return 'Search › ' + trim(d.query, 65);
    if (d.kind === 'entity')
      return (categoryName[d.type] || 'Atlas') + ' › ' + trim(labelFor(d.type, d.item), 95);
    return 'Atlas';
  }
  function updateHistory() {
    back.disabled = index <= 0;
    forward.disabled = index >= trail.length - 1;
    back.title = back.disabled
      ? 'No previous Atlas page'
      : 'Back to ' + locationText(trail[index - 1]?.detail);
    forward.title = forward.disabled
      ? 'No next Atlas page'
      : 'Forward to ' + locationText(trail[index + 1]?.detail);
    const d = trail[index]?.detail;
    current.textContent = locationText(d);
    current.title = locationText(d);
  }
  function updateSidebarRecent() {
    const panel = $('atlasSidebarRecent'),
      list = $('atlasSidebarRecentList'),
      empty = $('atlasSidebarRecentEmpty');
    if (!panel || !list) return;
    const entries = recentHistory.entries();
    if (empty) empty.hidden = entries.length > 0;
    list.replaceChildren();
    for (const d of entries) {
      const button = elem('button', 'atlas-sidebar-recent-entry');
      button.type = 'button';
      button.title = recentDescription(d);
      button.setAttribute('aria-label', 'Reopen ' + recentDescription(d));
      button.append(
        elem('span', 'atlas-sidebar-recent-name', trim(recentLabel(d), 65)),
        elem('span', 'atlas-sidebar-recent-arrow', '↗')
      );
      button.addEventListener('click', () => reopenRecent(d));
      list.append(button);
    }
  }
  function touchRecent(d) {
    if (!recentHistory.remember(d)) return;
    updateSidebarRecent();
    updateHomeRecent();
  }
  function recentLabel(d) {
    if (d.kind === 'search') return `Search: ${d.query}`;
    const labels = { figure: 'Figure', table: 'Table', equation: 'Equation', problem: 'Problem' };
    if (labels[d.type] && d.item.label) return `${labels[d.type]} ${d.item.label}`;
    if (d.type === 'reference') return `Reference ${d.item.chapter}.${d.item.number}`;
    return labelFor(d.type, d.item);
  }
  function recentDescription(d) {
    if (d.kind !== 'search') return recentLabel(d);
    const names = {
      all: 'Everything',
      sections: 'Chapters',
      pages: 'Book text',
      glossary: 'Glossary'
    };
    return `Search ${names[d.scope] || categoryName[d.scope] || d.scope}: ${d.query}`;
  }
  function reopenRecent(detail) {
    const d = recentHistory.resolve(detail);
    if (!d) {
      updateSidebarRecent();
      updateHomeRecent();
      return;
    }
    if (d.kind === 'search') {
      $('globalSearch').value = d.query;
      $('searchScope').value = d.scope;
      app.runSearch(d.query, d.scope);
    } else app.showEntity(d.type, d.item);
  }
  function record(detail) {
    if (!detail) return;
    if (detail.kind === 'entity') {
      const key = app.entityKey?.(detail.type, detail.item);
      const resolved = key && app.resolveEntityBookmark?.(key);
      if (!resolved) return;
      detail = {
        ...detail,
        key: resolved.canonicalKey || key,
        type: resolved.type,
        item: resolved.item
      };
    } else if (detail.kind === 'search') {
      detail = {
        ...detail,
        page: Number.isInteger(detail.page) && detail.page >= 0 ? detail.page : 0
      };
    }
    if (detail.kind === 'entity') touchRecent(detail);
    if (restoring) return;
    const previous = trail[index];
    if (previous && signature(previous.detail) === signature(detail)) return;
    trail = trail.slice(0, index + 1);
    trail.push({ detail, scroll: 0 });
    if (trail.length > 65) trail.shift();
    index = trail.length - 1;
    updateHistory();
    updateHomeRecent();
  }
  // Save visible list state *before* it is replaced. In v5.3 this was
  // captured after the new screen had rendered, causing Back to lose both
  // the filter and the reader's scroll position.
  function captureCurrent() {
    if (restoring || index < 0) return;
    const entry = trail[index];
    entry.scroll = content.scrollTop;
    if (
      entry.detail.kind === 'view' &&
      ['figures', 'tables', 'equations', 'problems', 'references', 'concepts', 'symbols'].includes(
        entry.detail.view
      )
    ) {
      entry.saved = {
        collectionFilter: app.state.collectionFilter,
        collectionPage: app.state.collectionPage,
        collectionChapter: app.state.collectionChapter,
        symbolTab: app.state.symbolTab
      };
    } else if (entry.detail.kind === 'view' && entry.detail.view === 'book') {
      entry.saved = { bookFilter: content.querySelector('#bookFilter')?.value || '' };
    }
  }
  document.addEventListener('atlas-before-navigation', captureCurrent);
  function restore(d, saved) {
    restoring = true;
    try {
      if (d.kind === 'view') app.goView(d.view, saved);
      else if (d.kind === 'search') {
        $('globalSearch').value = d.query;
        $('searchScope').value = d.scope;
        app.runSearch(d.query, d.scope, d.page || 0, { record: false });
      } else if (d.kind === 'entity') {
        const resolved = app.resolveEntityBookmark?.(d.key || app.entityKey?.(d.type, d.item));
        if (!resolved) return false;
        app.showEntity(resolved.type, resolved.item, true, d.context || null);
      }
    } finally {
      restoring = false;
    }
  }
  function restoreScroll(value) {
    requestAnimationFrame(() => {
      // Restore the exact list position immediately; avoid animating a long
      // distance through hundreds of catalog results when pressing Back.
      content.style.scrollBehavior = 'auto';
      content.scrollTop = Number(value) || 0;
      requestAnimationFrame(() => content.style.removeProperty('scroll-behavior'));
    });
  }
  function navigateHistory(delta) {
    const next = index + delta;
    if (next < 0 || next >= trail.length) return;
    captureCurrent();
    const previous = index;
    index = next;
    if (restore(trail[index].detail, trail[index].saved) === false) {
      index = previous;
      updateHistory();
      return;
    }
    updateHistory();
    restoreScroll(trail[index].scroll);
  }
  // Breadcrumbs return to the most recent matching catalog with its query,
  // page number and scroll position, instead of resetting that catalog.
  function returnToCategory(view) {
    for (let j = index - 1; j >= 0; j--) {
      const record = trail[j];
      if (record.detail?.kind === 'view' && record.detail.view === view) {
        captureCurrent();
        index = j;
        restore(record.detail, record.saved);
        updateHistory();
        restoreScroll(record.scroll);
        return true;
      }
    }
    return false;
  }
  back.addEventListener('click', () => navigateHistory(-1));
  forward.addEventListener('click', () => navigateHistory(1));
  document.addEventListener('atlas-location', e => record(e.detail));
  document.addEventListener('atlas-search-committed', e =>
    touchRecent({ kind: 'search', query: e.detail?.query, scope: e.detail?.scope })
  );
  document.addEventListener('atlas-reader-page', e => {
    if (document.body.classList.contains('layout-no-atlas')) {
      current.textContent = 'Read PDF › page ' + e.detail.page;
    }
  });
  function updateHomeRecent() {
    const h = $('atlasRecentHome');
    if (!h) return;
    const entries = recentHistory.entries();
    if (!entries.length) {
      h.hidden = true;
      return;
    }
    h.hidden = false;
    h.replaceChildren();
    const row = elem('div', 'atlas-recent-title');
    row.append(elem('h2', '', 'Recently viewed'));
    h.append(row);
    const list = elem('div', 'atlas-recent-list');
    h.append(list);
    entries.forEach(d => {
      const b = elem('button', 'atlas-recent-button');
      b.type = 'button';
      b.append(
        elem('span', 'atlas-recent-icon', d.kind === 'search' ? '⌕' : '↗'),
        elem('span', '', trim(recentLabel(d), 105))
      );
      b.title = recentDescription(d);
      b.addEventListener('click', () => reopenRecent(d));
      list.append(b);
    });
  }
  // Inline search: all the former quick-navigation features now live directly
  // below the editable top-bar search field. No modal or secondary input.
  // Use live sidebar labels and order, with Saved items promoted and Home omitted.
  const commandScopeForView = {
    book: 'sections',
    concepts: 'concepts',
    symbols: 'symbols',
    figures: 'figures',
    tables: 'tables',
    equations: 'equations',
    problems: 'problems',
    references: 'references',
    calculators: 'calculators',
    paths: 'paths',
    notes: 'saved'
  };
  const commandDestinations = Array.from(
    $('mainNav').querySelectorAll('button[data-view]:not([data-view="home"])'),
    button => ({
      view: button.dataset.view,
      title: safe(button.querySelector('.atlas-sidebar-text')?.textContent || button.textContent),
      icon: safe(button.querySelector('.atlas-sidebar-icon')?.textContent) || '→',
      scope: commandScopeForView[button.dataset.view] || null
    })
  ).sort((a, b) => Number(b.view === 'notes') - Number(a.view === 'notes'));
  const searchBox = document.querySelector('.search-wrap');
  const headerSearch = $('globalSearch');
  headerSearch.readOnly = false;
  headerSearch.setAttribute('role', 'combobox');
  headerSearch.setAttribute('aria-haspopup', 'listbox');
  headerSearch.setAttribute('aria-controls', 'atlasCommandResults');
  headerSearch.setAttribute('aria-expanded', 'false');
  headerSearch.setAttribute('aria-autocomplete', 'list');
  headerSearch.setAttribute('aria-label', 'Search the book, references, and calculators');
  headerSearch.placeholder = 'Search Atlas or PDF…';
  const panel = elem('div', 'atlas-inline-search-panel');
  panel.id = 'atlasCommandPalette';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Search suggestions and quick navigation');
  panel.innerHTML = `<div class="atlas-command-scopes" role="group" aria-label="Browse or search Atlas"></div>
    <div class="atlas-command-results" id="atlasCommandResults" role="listbox" aria-label="Search and navigation results"></div>
    <footer class="atlas-command-footer"><span>↑ ↓ Navigate <i>·</i> Enter Open <i>·</i> Ctrl/⌘+Enter All results <i>·</i> Esc Close</span><button id="atlasFullSearch" type="button">Show all search results →</button></footer>`;
  const commandScopes = panel.querySelector('.atlas-command-scopes');
  const allScope = elem('button', 'selected', 'All');
  allScope.type = 'button';
  allScope.dataset.commandScope = 'all';
  allScope.setAttribute('aria-pressed', 'true');
  commandScopes.append(allScope);
  commandDestinations.forEach(destination => {
    const button = elem('button', '', destination.title);
    button.type = 'button';
    button.dataset.commandView = destination.view;
    if (destination.scope) {
      button.dataset.commandScope = destination.scope;
      button.setAttribute('aria-pressed', 'false');
    }
    commandScopes.append(button);
  });
  searchBox.append(panel);
  const qInput = headerSearch,
    list = $('atlasCommandResults'),
    allButton = $('atlasFullSearch');
  let options = [],
    selected = 0,
    scope = 'all',
    query = '';
  function category(type) {
    return categoryName[type] || type;
  }
  function addNavOption(view, title, detail = '', icon = '→') {
    return {
      kind: 'view',
      view,
      title,
      detail,
      icon,
      type: 'Navigation',
      action: () => app.goView(view)
    };
  }
  function destinationOption(destination) {
    return addNavOption(
      destination.view,
      'Open ' + destination.title,
      'Open the complete ' + destination.title.toLowerCase() + ' view',
      destination.icon
    );
  }
  function addSourceOption(type, item) {
    const title = labelFor(type, item);
    let detail = '';
    if (type === 'section') detail = trim(item.excerpt, 155);
    else if (type === 'figure' || type === 'table')
      detail = trim(item.description || item.caption, 165);
    else if (type === 'problem') detail = trim(item.text, 145);
    else if (type === 'equation') detail = trim(item.context, 120);
    else if (type === 'reference') detail = trim(item.text, 120);
    else if (type === 'concept') detail = trim(item.see || item.pages?.join(', '), 135);
    else detail = trim(item.meaning || item.sections, 125);
    return {
      kind: 'entry',
      type,
      title,
      detail,
      icon:
        type === 'section'
          ? '§'
          : type === 'figure'
            ? '▧'
            : type === 'table'
              ? '▦'
              : type === 'equation'
                ? '∑'
                : type === 'problem'
                  ? '?'
                  : '↗',
      action: () => app.showEntity(type, item)
    };
  }
  function addCalculatorOption(spec) {
    return {
      kind: 'calculator',
      title: spec.title,
      detail: trim(spec.description, 140),
      icon: 'ƒx',
      type: 'Calculator',
      action: () => {
        window.AtlasCalculators?.select(spec.id);
        app.goView('calculators');
      }
    };
  }
  function addStudyPathOption(path) {
    return {
      kind: 'study-path',
      title: path.title,
      detail: `${path.steps.length} steps`,
      icon: '→',
      type: 'Study path',
      action: () => app.openStudyPath(path.id)
    };
  }
  function addPageOption(page, title) {
    return {
      kind: 'page',
      title,
      detail: 'Go directly to your imported PDF',
      icon: '▤',
      type: 'Page',
      action: () => app.openPdf(page, 'Quick jump to page ' + page, { preferRead: true })
    };
  }
  function userSaved(query = '') {
    const pages = app.user.bookmarks.pages.map(page =>
      addPageOption(page, 'Bookmarked PDF page ' + page)
    );
    const entries = new Map();
    for (const key of app.user.bookmarks.entities) {
      const entry = app.resolveEntityBookmark(key);
      if (entry) entries.set(entry.canonicalKey, addSourceOption(entry.type, entry.item));
    }
    for (const [key, text] of Object.entries(app.user.notes || {})) {
      const note = safe(text);
      if (!note) continue;
      const entry = app.resolveEntityBookmark(key);
      if (!entry) continue;
      const option = entries.get(entry.canonicalKey) ?? addSourceOption(entry.type, entry.item);
      entries.set(entry.canonicalKey, { ...option, note });
    }
    return [...pages, ...entries.values()]
      .filter(
        option =>
          matches(option.title + ' ' + option.detail, query) ||
          (option.note && matches(option.note, query))
      )
      .slice(0, 16)
      .map(option => (option.note ? { ...option, detail: 'Note · ' + option.note } : option));
  }
  function matches(s, q) {
    return lc(s).includes(lc(q));
  }
  const resultSummary = r => (r.type === 'section' ? 'Chapter or section' : category(r.type));
  function obtainResults(q, cat) {
    const text = safe(q);
    if (!text) {
      const destination = commandDestinations.find(item => item.scope === cat);
      const navigation = destination ? [destinationOption(destination)] : [];
      if (cat === 'saved') return navigation.concat(userSaved());
      if (cat === 'paths') return navigation.concat(app.studyPaths.map(addStudyPathOption));
      if (cat === 'sections')
        return navigation.concat(
          catalog.sections
            .filter(x => x.kind === 'chapter' || x.kind === 'appendix')
            .slice(0, 25)
            .map(s => addSourceOption('section', s))
        );
      if (cat === 'calculators')
        return navigation.concat(specs.slice(0, 24).map(addCalculatorOption));
      if (cat === 'concepts')
        return navigation.concat(
          catalog.index.slice(0, 12).map(x => addSourceOption('concept', x))
        );
      if (cat === 'symbols')
        return navigation.concat(
          catalog.symbols.slice(0, 4).map(x => addSourceOption('symbol', x)),
          catalog.abbreviations.slice(0, 4).map(x => addSourceOption('abbreviation', x)),
          catalog.chemicals.slice(0, 4).map(x => addSourceOption('chemical', x))
        );
      if (['figures', 'tables', 'equations', 'problems', 'references'].includes(cat))
        return navigation.concat(
          catalog[cat].slice(0, 12).map(x => addSourceOption(cat.slice(0, -1), x))
        );
      const r = recentHistory.entries().map(d =>
        d.kind === 'entity'
          ? addSourceOption(d.type, d.item)
          : {
              kind: 'search',
              type: 'Search',
              title: d.query,
              detail: `Repeat search · ${d.scope}`,
              icon: '⌕',
              action: () => reopenRecent(d)
            }
      );
      return r.concat(
        addPageOption(app.state.resumePage, 'Continue reading · PDF page ' + app.state.resumePage),
        commandDestinations.map(destinationOption)
      );
    }
    if (cat === 'paths')
      return app.studyPaths
        .filter(path => matches([path.title, path.description, ...path.steps].join(' '), text))
        .slice(0, 25)
        .map(addStudyPathOption);
    const candidates = [];
    if (cat === 'all' || cat === 'sections') {
      const m = text.match(/^(?:§|section\s*)?([1-9]\d?(?:\.\d+){1,3})$/i);
      if (m && app.sectionById.has(m[1]))
        candidates.push(addSourceOption('section', app.sectionById.get(m[1])));
    }
    if (cat === 'all') {
      const match =
        text.match(/^pdf\s*(?:page\s*)?(\d{1,4})$/i) ||
        text.match(/^(?:p\.|page\s*|p\s+)(\d{1,4})$/i);
      if (match) {
        const page = Number(match[1]);
        const pdfPage = /^pdf/i.test(text)
          ? page
          : window.ATLAS_READER_META.labels.findIndex(v => String(v) === String(page)) + 1 || page;
        if (pdfPage > 0 && pdfPage <= catalog.meta.pdf_pages)
          candidates.push(
            addPageOption(
              pdfPage,
              'Open ' + (/^pdf/i.test(text) ? 'PDF' : 'book') + ' page ' + page
            )
          );
      }
      if (/^\d{1,4}$/.test(text)) {
        const printed = window.ATLAS_READER_META.labels.findIndex(v => String(v) === text) + 1;
        if (printed > 0) candidates.push(addPageOption(printed, 'Open book page ' + text));
      }
    }
    if (cat === 'calculators' || cat === 'all')
      candidates.push(
        ...specs
          .filter(s => matches(s.title + ' ' + s.description + ' ' + s.category, text))
          .slice(0, 10)
          .map(addCalculatorOption)
      );
    if (cat === 'saved') return userSaved(text);
    const mapped = cat === 'sections' ? 'sections' : cat === 'all' ? 'all' : cat;
    if (text.length >= 2) {
      const ranks = app.searchAll(text, mapped).slice(0, 40);
      for (const r of ranks) {
        if (r.entity) candidates.push(addSourceOption(r.type, r.entity));
        else if (r.page) candidates.push(addPageOption(r.page, r.title));
      }
    }
    const seen = new Set();
    return candidates
      .filter(r => {
        const key = r.kind + '\t' + r.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 25);
  }
  function displayOption(o, i) {
    const b = elem('button', 'atlas-command-result');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.id = 'atlasCommandOption' + i;
    b.dataset.optionIndex = i;
    b.setAttribute('aria-selected', String(i === selected));
    const icon = elem('span', 'atlas-command-result-icon', o.icon),
      copy = elem('span', 'atlas-command-result-copy');
    copy.append(elem('strong', '', trim(o.title, 150)));
    if (o.detail) copy.append(elem('small', '', trim(o.detail, 180)));
    const type = elem(
      'span',
      'atlas-command-result-type',
      o.type === 'Navigation' ? 'Go' : o.type || ''
    );
    b.append(icon, copy, type);
    b.addEventListener('mousemove', () => setSelection(i, false));
    b.addEventListener('click', () => choose(i));
    return b;
  }
  function setSelection(i, scroll = true) {
    if (!options.length) {
      qInput.removeAttribute('aria-activedescendant');
      return;
    }
    selected = Math.max(0, Math.min(options.length - 1, i));
    list
      .querySelectorAll('[data-option-index]')
      .forEach((b, j) => b.setAttribute('aria-selected', String(j === selected)));
    qInput.setAttribute('aria-activedescendant', 'atlasCommandOption' + selected);
    if (scroll)
      list
        .querySelector('[data-option-index="' + selected + '"]')
        ?.scrollIntoView({ block: 'nearest' });
  }
  function renderPalette() {
    query = qInput.value.trim();
    options = obtainResults(query, scope);
    selected = 0;
    list.replaceChildren();
    if (!options.length)
      list.append(
        elem(
          'p',
          'atlas-command-empty',
          query
            ? 'No matching entries. Try a broader search, such as a section number or fewer words.'
            : 'No entries to show.'
        )
      );
    else {
      const label = elem(
        'div',
        'atlas-command-caption',
        query ? 'MATCHING ENTRIES' : scope === 'all' ? 'RECENT & QUICK ACTIONS' : 'BROWSE'
      );
      list.append(label);
      options.forEach((o, i) => list.append(displayOption(o, i)));
    }
    setSelection(0, false);
    const canSearch = Boolean(query) && !['saved', 'calculators', 'paths'].includes(scope);
    allButton.hidden = !canSearch;
  }
  function setScope(next) {
    scope = next;
    panel.querySelectorAll('[data-command-scope]').forEach(b => {
      const active = b.dataset.commandScope === scope;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderPalette();
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    document.body.classList.remove('atlas-search-open');
    qInput.setAttribute('aria-expanded', 'false');
    qInput.removeAttribute('aria-activedescendant');
  }
  function choose(i) {
    const option = options[i];
    if (!option) return;
    // Structured results emit an entity visit. A full-text PDF result has no
    // entity, so remember the selected query rather than every typed character.
    if (query && option.kind === 'page') touchRecent({ kind: 'search', query, scope });
    close();
    option.action();
  }
  function fullSearch() {
    if (!query || scope === 'paths' || scope === 'saved') return;
    const text = query,
      selectedScope = scope;
    close();
    // Use the application's supported scopes, including categories added to
    // this menu, so Show all results never broadens a scoped search silently.
    const searchScope = $('searchScope');
    searchScope.value = Array.from(searchScope.options).some(
      option => option.value === selectedScope
    )
      ? selectedScope
      : 'all';
    app.runSearch(text, searchScope.value);
  }
  function open(q) {
    if (document.body.classList.contains('atlas-top-bars-hidden')) {
      $('restoreTopBars')?.click();
    }
    if (typeof q === 'string' && q !== qInput.value) qInput.value = q;
    if (panel.hidden) {
      panel.hidden = false;
      document.body.classList.add('atlas-search-open');
      qInput.setAttribute('aria-expanded', 'true');
    }
    renderPalette();
    if (document.activeElement !== qInput) qInput.focus({ preventScroll: true });
    return true;
  }
  panel.querySelectorAll('[data-command-scope]').forEach(b =>
    b.addEventListener('click', () => {
      setScope(b.dataset.commandScope);
      // Keep keyboard typing ready even after selecting a category.
      qInput.focus({ preventScroll: true });
    })
  );
  panel.querySelectorAll('[data-command-view]:not([data-command-scope])').forEach(button =>
    button.addEventListener('click', () => {
      close();
      app.goView(button.dataset.commandView);
    })
  );
  qInput.addEventListener('focus', () => open());
  qInput.addEventListener('click', () => open());
  qInput.addEventListener('input', () => open());
  qInput.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (panel.hidden) open();
      setSelection((selected + 1) % Math.max(options.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (panel.hidden) open();
      setSelection((selected - 1 + Math.max(options.length, 1)) % Math.max(options.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (panel.hidden) open();
      if (e.ctrlKey || e.metaKey) fullSearch();
      else if (options.length) choose(selected);
      else fullSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  allButton.addEventListener('click', fullSearch);
  document.addEventListener(
    'pointerdown',
    e => {
      if (!panel.hidden && !searchBox.contains(e.target)) close();
    },
    true
  );
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) {
      e.preventDefault();
      if (panel.contains(document.activeElement)) qInput.focus({ preventScroll: true });
      close();
      return;
    }
    if (e.isComposing || document.querySelector('dialog[open]') || $('pdfImport')) return;
    const typing = e.target.closest?.('input,textarea,select,[contenteditable]');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open();
      qInput.select();
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft' && !typing) {
      e.preventDefault();
      navigateHistory(-1);
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight' && !typing) {
      e.preventDefault();
      navigateHistory(1);
    }
  });
  // A lightweight escape from PDF-only view, including when v4.3's top bars
  // are hidden. This does not occupy a permanent full-width toolbar.
  const readingExit = elem('button', 'atlas-floating-exit', '← Back to Atlas');
  readingExit.id = 'atlasReadingExit';
  readingExit.type = 'button';
  readingExit.title = 'Return to the encyclopedia without losing your PDF page';
  readingExit.addEventListener('click', () => {
    workspace.setPreset('browse');
    $('restoreTopBars')?.click();
  });
  document.body.append(readingExit);
  const updateReadingExit = () => {
    readingExit.hidden = !(
      document.body.classList.contains('atlas-top-bars-hidden') &&
      !document.body.classList.contains('layout-no-book') &&
      document.body.classList.contains('layout-no-atlas')
    );
  };
  new MutationObserver(updateReadingExit).observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
  updateReadingExit();
  // Shortcuts overview is generated separately so it stays available even in
  // full-book mode where the main header is hidden.
  window.AtlasNavigation = {
    open,
    close,
    inlineSearch: true,
    back: () => navigateHistory(-1),
    forward: () => navigateHistory(1),
    returnToCategory,
    recent: () => recentHistory.entries(),
    currentLocation: () => locationText(trail[index]?.detail)
  };
  if (!trail.length) record({ kind: 'view', view: 'home' });
  updateHomeRecent();
  updateSidebarRecent();
})();
