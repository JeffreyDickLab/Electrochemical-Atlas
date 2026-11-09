/* src/client/application/00-context.js */
(() => {
  'use strict';

  const storage = window.AtlasStorage.create(window);
  window.ATLAS_TEMP_STORAGE = storage.isTemporary;
  const {
    escapeHtml: esc,
    normalize: norm,
    formatNumber: fmt,
    debounce,
    regexEscape,
    shorten
  } = window.AtlasText;
  const C = window.ATLAS_CATALOG;
  const PAGES = window.ATLAS_PAGES;
  const PDF_URL = window.ATLAS_PDF_URL;
  const F = 96485.33212;
  const R = 8.314462618;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const content = $('#content');
  const searchInput = $('#globalSearch');
  const searchScope = $('#searchScope');
  let booting = true;
  const readerPageInput = $('#readerPage');
  const readerPrinted = $('#readerPrinted');
  const readerMessage = $('#readerMessage');
  const resumeSourceId = entitySourceId();
  const resumeStorageKey = resumeSourceId ? `ea_resume_page_v6:${resumeSourceId}` : '';

  const state = {
    view: 'home',
    collectionPage: 0,
    collectionFilter: '',
    collectionChapter: '',
    symbolTab: 'abbreviations',
    searchPage: 0,
    readerPage: 57,
    resumePage: 1,
    readerHistory: [],
    readerHistoryIndex: -1,
    currentEntity: null,
    entryContext: null,
    guideMode: false,
    searchTimer: null
  };

  const user = {
    bookmarks: loadJSON('ea_bookmarks', { pages: [], entities: [] }),
    notes: loadJSON('ea_notes', {}),
    read: loadJSON('ea_read', {}),
    theme: storage.getItem('ea_theme') || 'light',
    guide: storage.getItem('ea_guide') === 'true'
  };

  const sectionByKey = new Map(C.sections.map(x => [x.key, x]));
  const sectionById = new Map(C.sections.filter(x => x.id).map(x => [String(x.id), x]));
  const pageByNumber = new Map(PAGES.map(x => [x.pdf_page, x]));

  const STUDY_PATHS = [
    {
      id: 'foundations',
      title: 'Start from zero: the electrochemical core',
      description:
        'A sequenced route through cells, potential, current, thermodynamics, kinetics, mass transport, steady-state methods, transients, and cyclic voltammetry.',
      steps: [
        '1',
        '1.1.3',
        '1.1.5',
        '1.1.9',
        '1.3.1',
        '1.5.3',
        '2.1',
        '3.3',
        '4.4',
        '5.1',
        '6.1',
        '7.2.2'
      ]
    },
    {
      id: 'cv',
      title: 'Cyclic voltammetry: from first scan to mechanism',
      description:
        'Build the physical foundation before moving into reversible, quasireversible, irreversible, coupled-reaction, fast-scan, and adsorbed-layer CV.',
      steps: [
        '1.6.4',
        '3.4.6',
        '4.5',
        '6.1',
        '7.1',
        '7.2.2',
        '7.3.2',
        '7.4.2',
        '7.9',
        '13.2',
        '13.3',
        '17.2'
      ]
    },
    {
      id: 'eis',
      title: 'Electrochemical impedance spectroscopy',
      description:
        'Start with capacitance, cell resistance, and ac circuits; then proceed through equivalent circuits, EIS measurement, interpretation, and instrumentation.',
      steps: ['1.5', '1.6', '11.1', '11.2', '11.3', '11.4', '11.8', '16.7', '17.3.3']
    },
    {
      id: 'ume-secm',
      title: 'Ultramicroelectrodes, SECM, and single entities',
      description:
        'A route from radial diffusion and UME steady state to scanning probe feedback, kinetic measurements, particle collisions, and single-molecule electrochemistry.',
      steps: [
        '4.4',
        '5.1',
        '5.2',
        '5.3',
        '5.9',
        '18.1',
        '18.2',
        '18.3',
        '18.4',
        '18.8',
        '19.2',
        '19.4',
        '19.6'
      ]
    },
    {
      id: 'electrocatalysis',
      title: 'Electrocatalysis and inner-sphere reactions',
      description:
        'Connect Butler–Volmer kinetics, double-layer effects, transport diagnostics, and surface chemistry to HER, ORR, CO₂ reduction, deposition, and gas evolution.',
      steps: ['3.3', '3.4', '10.2.5', '14.7', '15.1', '15.2', '15.3', '15.4', '15.5', '15.6']
    },
    {
      id: 'interfaces',
      title: 'Interfaces, adsorption, films, and modified electrodes',
      description:
        'Follow charge and capacitance into detailed double-layer models, adsorption, monolayers, thick films, blocking layers, sensors, and bioelectrocatalysis.',
      steps: [
        '1.6',
        '14.1',
        '14.2',
        '14.3',
        '14.5',
        '14.7',
        '17.1',
        '17.2',
        '17.4',
        '17.5',
        '17.6',
        '17.8'
      ]
    },
    {
      id: 'practical',
      title: 'Practical electrochemistry and troubleshooting',
      description:
        'The book’s laboratory notes and instrumentation chapters assembled into one experimental route.',
      steps: ['1.9', '2.5', '5.9', '6.8', '7.9', '12.1.3', '16.4', '16.7', '16.8', '16.10']
    },
    {
      id: 'ecl',
      title: 'Photoelectrochemistry and ECL',
      description:
        'A focused route through semiconductor energetics, photoeffects, sensitization, radical-ion annihilation, coreactants, quantum dots, and analytical ECL.',
      steps: [
        '2.2.5',
        '3.5',
        '20.1',
        '20.2',
        '20.3',
        '20.5.1',
        '20.5.2',
        '20.5.3',
        '20.5.4',
        '20.5.5'
      ]
    },
    {
      id: 'simulation',
      title: 'Digital simulation and mathematical support',
      description:
        'Review the mathematical tools and then use the book’s simulation appendix alongside the methods chapters where numerical modeling is most useful.',
      steps: ['A.1', 'A.3', 'A.5', 'B.1', 'B.2', 'B.3', 'B.4', '5.1', '6.1', '7.2', '13.2.5']
    }
  ];

/* src/client/application/10-state-and-layout.js */
  function loadJSON(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveUser() {
    let persisted = false;
    try {
      const sourceId = entitySourceId();
      if (sourceId) {
        storage.setItem(
          `ea_study_v2:${sourceId}`,
          JSON.stringify({
            version: 2,
            sourceId,
            bookmarks: user.bookmarks,
            notes: user.notes,
            read: user.read,
            unassigned: user.unassigned || []
          })
        );
        persisted = true;
      } else window.ATLAS_TEMP_STORAGE = true;
    } catch (error) {
      window.ATLAS_TEMP_STORAGE = true;
      if (!saveUser.warned) {
        saveUser.warned = true;
        window.AtlasLayout?.notify(
          'Browser storage is full or unavailable. Export a backup before closing Atlas.'
        );
        console.warn('Atlas could not persist study data. Export a backup.', error);
      }
    }
    updateReaderBookmark();
    return persisted;
  }

  const sci = (v, options) => (window.AtlasScience ? window.AtlasScience.html(v, options) : esc(v));

  function firstNumericPage(ref) {
    const m = String(ref || '').match(/\d{1,4}/);
    return m ? Number(m[0]) : null;
  }

  function pdfFromPrinted(page) {
    const target = String(page || '')
      .trim()
      .toLowerCase();
    const labels = window.ATLAS_READER_META?.labels || [];
    const exact = labels.findIndex(label => String(label).toLowerCase() === target);
    if (exact >= 0) return exact + 1;
    const fallback = Number(page);
    return Number.isFinite(fallback) ? Math.max(1, Math.min(C.meta.pdf_pages, fallback)) : 1;
  }

  function pageLabel(pdfPage) {
    const p = pageByNumber.get(Number(pdfPage));
    if (!p) return `PDF ${pdfPage}`;
    return p.printed_page ? `Book p. ${p.printed_page} · PDF ${pdfPage}` : `PDF ${pdfPage}`;
  }

  function entitySourceId() {
    const hash = String(window.ATLAS_SOURCE_SHA256 || '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(hash)) return hash;
    const signature = String(window.ATLAS_SOURCE_REPORT?.signature || '').toLowerCase();
    return /^[a-f0-9]{20}$/.test(signature) ? `source-${signature}` : '';
  }

  function legacyEntityKey(type, item) {
    if (type === 'section') return item.key;
    if (type === 'reference') return `reference-${item.chapter}-${item.number}`;
    const id = item.label || item.abbr || item.symbol || item.term || item.pdf_page || item.title;
    return `${type}-${id}`;
  }

  // A printed label is not an identity: the book reuses symbols and index
  // terms. All saved-entry consumers use this one source-qualified registry.
  function createEntityIdentity(catalog, sourceId) {
    const prefix = 'ea-entry-v2:';
    const listNames = {
      section: 'sections',
      figure: 'figures',
      table: 'tables',
      equation: 'equations',
      problem: 'problems',
      reference: 'references',
      concept: 'index',
      symbol: 'symbols',
      abbreviation: 'abbreviations',
      chemical: 'chemicals'
    };
    const byKey = new Map();
    const byItem = new Map();
    const legacy = new Map();
    const clean = value =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const pageOf = item =>
      Number.isInteger(Number(item.pdf_page)) && Number(item.pdf_page) > 0
        ? Number(item.pdf_page)
        : null;
    function sourceParts(type, item) {
      if (typeof item.source_row === 'string' && item.source_row) return ['row', item.source_row];
      if (type === 'section') return ['section', item.key];
      if (type === 'reference') return ['reference', String(item.chapter), String(item.number)];
      if (type === 'concept')
        return ['index', pageOf(item), clean(item.parent), clean(item.term), item.pages || []];
      if (['symbol', 'abbreviation', 'chemical'].includes(type))
        return ['notation', pageOf(item), item.symbol || item.abbr || ''];
      return item.label ? ['label', item.label] : ['page', pageOf(item), item.title || ''];
    }
    function addLegacy(key, record) {
      if (typeof key !== 'string' || !key || key.length > 4096) return;
      const entries = legacy.get(key) || [];
      if (!entries.includes(record)) entries.push(record);
      legacy.set(key, entries);
    }
    for (const [type, name] of Object.entries(listNames)) {
      const list = catalog[name] || [];
      const counts = new Map();
      for (const item of list) {
        const base = JSON.stringify(sourceParts(type, item));
        counts.set(base, (counts.get(base) || 0) + 1);
      }
      const occurrences = new Map();
      const itemKeys = new WeakMap();
      byItem.set(type, itemKeys);
      for (const item of list) {
        const parts = sourceParts(type, item);
        const base = JSON.stringify(parts);
        const occurrence = occurrences.get(base) || 0;
        occurrences.set(base, occurrence + 1);
        // The source-row IDs supplied by the parser are unique. The fallback
        // also distinguishes repeated records from older catalog versions.
        if (counts.get(base) > 1) parts.push(['occurrence', occurrence]);
        const key = prefix + JSON.stringify([sourceId, type, parts]);
        const record = { key, type, item };
        byKey.set(key, record);
        itemKeys.set(item, key);
        // An explicit empty list means this is a newly recovered source row.
        // A corrected new label must never claim another row's old notes.
        const aliases = Array.isArray(item.legacy_keys)
          ? item.legacy_keys
          : [legacyEntityKey(type, item)];
        for (const alias of aliases) addLegacy(alias, record);
      }
    }
    const active = record =>
      Boolean(record && (catalog[listNames[record.type]] || []).includes(record.item));
    function candidates(key, visited = new Set()) {
      if (visited.has(key)) return [];
      visited.add(key);
      const direct = byKey.get(key);
      if (direct) return active(direct) ? [direct] : [];
      const matches = (legacy.get(key) || []).filter(active);
      const alias = catalog.entity_aliases?.[key];
      if (typeof alias === 'string') matches.push(...candidates(alias, visited));
      return [...new Set(matches)];
    }
    function inspect(key, qualifier = {}) {
      if (typeof key !== 'string' || !key || key.length > 4096)
        return { status: 'missing', candidates: [] };
      if (key.startsWith(prefix)) {
        try {
          const stored = JSON.parse(key.slice(prefix.length));
          if (!Array.isArray(stored) || stored.length !== 3)
            return { status: 'missing', candidates: [] };
          if (stored[0] !== sourceId) return { status: 'different-source', candidates: [] };
        } catch (_) {
          return { status: 'missing', candidates: [] };
        }
      }
      let matches = candidates(key);
      if (!key.startsWith(prefix)) {
        if (Object.hasOwn(qualifier, 'parent')) {
          if (typeof qualifier.parent !== 'string') matches = [];
          else
            matches = matches.filter(
              record =>
                record.type === 'concept' && clean(record.item.parent) === clean(qualifier.parent)
            );
        }
        if (Object.hasOwn(qualifier, 'page')) {
          if (qualifier.page !== null && (!Number.isInteger(qualifier.page) || qualifier.page < 1))
            matches = [];
          else matches = matches.filter(record => pageOf(record.item) === qualifier.page);
        }
        if (Object.hasOwn(qualifier, 'occurrence')) {
          if (
            !Object.hasOwn(qualifier, 'page') ||
            !Number.isInteger(qualifier.occurrence) ||
            qualifier.occurrence < 0
          )
            matches = [];
          else
            matches = matches.filter(record => {
              if (Array.isArray(record.item.legacy_refs))
                return record.item.legacy_refs.some(
                  ref =>
                    ref.key === key &&
                    ref.page === qualifier.page &&
                    ref.occurrence === qualifier.occurrence
                );
              // Legacy occurrence numbers are safe only for an unchanged old
              // catalog, never against the expanded source-row extraction.
              if (record.item.source_row) return false;
              return (
                candidates(key)
                  .filter(other => pageOf(other.item) === qualifier.page)
                  .indexOf(record) === qualifier.occurrence
              );
            });
        }
      }
      return {
        status: matches.length === 1 ? 'resolved' : matches.length ? 'ambiguous' : 'missing',
        candidates: matches
      };
    }
    return Object.freeze({
      key(type, item) {
        const key = item && byItem.get(type)?.get(item);
        return key && active(byKey.get(key)) ? key : '';
      },
      inspect,
      resolve(key, qualifier) {
        const result = inspect(key, qualifier);
        return result.status === 'resolved' ? result.candidates[0] : null;
      },
      entries(type) {
        return [...byKey.values()].filter(
          record => active(record) && (!type || record.type === type)
        );
      }
    });
  }

  let entityIdentity = null;
  function entityIdentities() {
    if (!entityIdentity) {
      const source =
        entitySourceId() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      entityIdentity = createEntityIdentity(C, source);
    }
    return entityIdentity;
  }

  function entityKey(type, item) {
    return entityIdentities().key(type, item);
  }

  function noteKey(type, item) {
    const key = entityKey(type, item);
    if (user.notes[key]) return key;
    return (
      Object.keys(user.notes).find(saved => entityIdentities().resolve(saved)?.key === key) || key
    );
  }

  function isEntityBookmarked(type, item) {
    const key = entityKey(type, item);
    return user.bookmarks.entities.some(saved => entityIdentities().resolve(saved)?.key === key);
  }

  function toggleEntityBookmark(type, item) {
    const key = entityKey(type, item);
    if (!key) return;
    if (isEntityBookmarked(type, item))
      user.bookmarks.entities = user.bookmarks.entities.filter(
        saved => entityIdentities().resolve(saved)?.key !== key
      );
    else user.bookmarks.entities.push(key);
    saveUser();
    showEntity(type, item, false);
  }

  function togglePageBookmark(page = state.readerPage) {
    page = Number(page);
    const idx = user.bookmarks.pages.indexOf(page);
    if (idx >= 0) user.bookmarks.pages.splice(idx, 1);
    else user.bookmarks.pages.push(page);
    user.bookmarks.pages.sort((a, b) => a - b);
    saveUser();
  }

  function updateReaderBookmark() {
    $('#bookmarkPage').textContent = user.bookmarks.pages.includes(state.readerPage) ? '★' : '☆';
  }

  function markSectionRead(section, value = !user.read[section.key]) {
    if (value) user.read[section.key] = true;
    else delete user.read[section.key];
    saveUser();
    showEntity('section', section, false);
  }

  function applyTheme(theme) {
    user.theme = theme;
    document.documentElement.dataset.theme = theme;
    storage.setItem('ea_theme', theme);
  }

  function toggleGuide() {
    window.AtlasLayout?.showGuide();
  }

  function signalLocation(detail) {
    document.dispatchEvent(new CustomEvent('atlas-location', { detail }));
  }

  function setActiveNav(view) {
    $$('#mainNav button').forEach(btn => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  function focusViewHeading() {
    requestAnimationFrame(() => {
      const heading = content.querySelector('h1');
      if (!heading || !content.contains(heading)) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
  }

  function goView(view, restored = null) {
    if (view !== 'reader') document.dispatchEvent(new Event('atlas-before-navigation'));
    if (view === 'reader') {
      window.AtlasReader.expand(true);
      return;
    }
    window.AtlasLayout?.atlasView();
    state.view = view;
    state.collectionPage =
      restored && Number.isInteger(restored.collectionPage) ? restored.collectionPage : 0;
    state.collectionFilter =
      restored && typeof restored.collectionFilter === 'string' ? restored.collectionFilter : '';
    state.collectionChapter =
      restored && typeof restored.collectionChapter === 'string' ? restored.collectionChapter : '';
    if (restored && ['symbols', 'abbreviations', 'chemicals'].includes(restored.symbolTab))
      state.symbolTab = restored.symbolTab;
    state.currentEntity = null;
    state.entryContext = null;
    setActiveNav(view);
    searchInput.value = '';
    switch (view) {
      case 'home':
        renderHome();
        break;
      case 'book':
        renderBookMap(restored?.bookFilter || '');
        break;
      case 'concepts':
        renderConcepts();
        break;
      case 'symbols':
        renderSymbols();
        break;
      case 'figures':
        renderCollection('figures');
        break;
      case 'tables':
        renderCollection('tables');
        break;
      case 'equations':
        renderCollection('equations');
        break;
      case 'problems':
        renderCollection('problems');
        break;
      case 'references':
        renderCollection('references');
        break;
      case 'paths':
        renderPaths();
        break;
      case 'calculators':
        renderCalculators();
        break;
      case 'notes':
        renderNotes();
        break;
      default:
        renderHome();
    }
    content.scrollTop = 0;
    signalLocation({ kind: 'view', view });
    focusViewHeading();
  }

  function loadResumePage() {
    const startPage = Number(window.ATLAS_IMPORT_START_PAGE) || 1;
    if (!resumeStorageKey) return startPage;
    const valid = page => Number.isInteger(page) && page >= 1 && page <= C.meta.pdf_pages;
    const savedPage = loadJSON(resumeStorageKey, null);
    if (valid(savedPage)) return savedPage;

    const legacyPage = loadJSON('ea_resume_page_v5', null);
    if (!valid(legacyPage)) return startPage;
    // The old page has no PDF identity. Claim it for the first eligible source only.
    const ownerKey = 'ea_resume_page_v5_source';
    try {
      const owner = storage.getItem(ownerKey);
      if (owner && owner !== resumeSourceId) return startPage;
      if (!owner) storage.setItem(ownerKey, resumeSourceId);
    } catch (_) {
      return startPage;
    }
    try {
      storage.setItem(resumeStorageKey, String(legacyPage));
    } catch (_) {}
    return legacyPage;
  }

  function rememberResumePage(page) {
    state.resumePage = page;
    const label = content.querySelector('[data-atlas-read] small');
    if (label) label.textContent = pageLabel(page);
    if (resumeStorageKey) {
      try {
        storage.setItem(resumeStorageKey, String(page));
      } catch (_) {}
    }
  }

  function openPdf(
    page,
    message = '',
    {
      push = true,
      targetY = 0,
      reveal = true,
      remember = true,
      preferRead = false,
      snap = false
    } = {}
  ) {
    const layout = window.AtlasLayout;
    if (preferRead && layout && !layout.isTogether()) layout.setPreset('read');
    const leaving = state.readerHistory[state.readerHistoryIndex];
    if (push && leaving && leaving.page === window.AtlasReader.current())
      leaving.y = window.AtlasReader.position();
    page = Math.max(1, Math.min(C.meta.pdf_pages, Math.round(Number(page) || 1)));
    state.readerPage = page;
    readerPageInput.value = page;
    readerPrinted.textContent = pageLabel(page);
    readerMessage.textContent = message || 'Your original, locally imported PDF';
    window.AtlasReader.show(page, targetY, !booting && reveal, snap ? 'snap' : undefined);
    window.AtlasReader.setTargetLabel?.(message);
    if (push) {
      const current = state.readerHistory[state.readerHistoryIndex];
      if (!current || current.page !== page || Math.abs(current.y - targetY) > 10) {
        state.readerHistory = state.readerHistory.slice(0, state.readerHistoryIndex + 1);
        state.readerHistory.push({ page, y: targetY });
        state.readerHistoryIndex = state.readerHistory.length - 1;
      }
    }
    $('#readerBack').disabled = state.readerHistoryIndex <= 0;
    $('#readerForward').disabled = state.readerHistoryIndex >= state.readerHistory.length - 1;
    updateReaderBookmark();
    if (!booting) {
      if (remember) rememberResumePage(page);
      document.dispatchEvent(new CustomEvent('atlas-reader-page', { detail: { page } }));
    }
  }
  window.AtlasNavigate = (page, label, targetY = 0) => openPdf(page, label, { targetY });

  function openExternal(page = state.readerPage) {
    window.open(`${PDF_URL}#page=${Number(page) || 1}&zoom=page-width`, '_blank', 'noopener');
  }

  function readerHistory(delta) {
    const leaving = state.readerHistory[state.readerHistoryIndex];
    if (leaving && leaving.page === window.AtlasReader.current())
      leaving.y = window.AtlasReader.position();
    const next = state.readerHistoryIndex + delta;
    if (next < 0 || next >= state.readerHistory.length) return;
    state.readerHistoryIndex = next;
    const { page, y: targetY } = state.readerHistory[next];
    openPdf(page, 'Reader history', { push: false, targetY });
  }

/* src/client/application/20-home-and-book-map.js */
  function renderHome() {
    const m = C.meta.counts;
    content.innerHTML = `
      <section class="atlas-welcome">
        
        <h1>Electrochemical Atlas</h1>
        
        <div class="atlas-launch-grid">
          <button class="atlas-launch" data-atlas-read>
            <span class="atlas-launch-icon" aria-hidden="true">▤</span><strong>Continue reading</strong><small>${esc(pageLabel(state.resumePage))}</small>
          </button>
          <button class="atlas-launch" data-view-target="book">
            <span class="atlas-launch-icon" aria-hidden="true">☷</span><strong>Chapters</strong><small>Book outline</small>
          </button>
          <button class="atlas-launch" data-view-target="paths">
            <span class="atlas-launch-icon" aria-hidden="true">→</span><strong>Study paths</strong><small>9 paths</small>
          </button>
          <button class="atlas-launch" data-view-target="calculators">
            <span class="atlas-launch-icon" aria-hidden="true">ƒx</span><strong>Calculators</strong><small>24 tools</small>
          </button>
        </div>
      </section>
      <section id="atlasRecentHome" class="atlas-recent-home" hidden aria-label="Recently visited entries"></section>
      <section class="atlas-suggested-paths">
        <div class="section-heading"><h2>Suggested starting points</h2><button class="text-button" data-view-target="paths">All study paths</button></div>
        <div class="atlas-start-paths">
          ${STUDY_PATHS.slice(0, 4)
            .map(
              path =>
                `<button class="atlas-path-shortcut" data-open-path="${esc(path.id)}"><strong>${esc(path.title)}</strong><small>${path.steps.length} steps</small><span aria-hidden="true">→</span></button>`
            )
            .join('')}
        </div>
      </section>
      <details class="atlas-more-home">
        <summary>Reference tools</summary>
        <div class="source-home-row"><div><strong>Source check</strong></div><button type="button" class="secondary" data-source-audit>Review source check</button></div>
        <div class="stat-grid">
          <div class="stat-card"><strong>${m.sections.toLocaleString()}</strong><span>chapters and sections</span></div>
          <div class="stat-card"><strong>${m.equations.toLocaleString()}</strong><span>equations</span></div>
          <div class="stat-card"><strong>${m.figures.toLocaleString()}</strong><span>figures</span></div>
          <div class="stat-card"><strong>${m.problems.toLocaleString()}</strong><span>problems</span></div>
          <div class="stat-card"><strong>${m.references.toLocaleString()}</strong><span>references</span></div>
          <div class="stat-card"><strong>${m.index_entries.toLocaleString()}</strong><span>index terms</span></div>
        </div>
        <div class="card-grid">
          <div class="info-card"><h3>Symbols and abbreviations</h3><p>Look up notation and units from the book.</p><button class="secondary" data-view-target="symbols">Open symbol lookup</button></div>
          <div class="info-card"><h3>Figures and equations</h3><p>Browse equations and figures.</p><button class="secondary" data-view-target="equations">Open equation catalog</button></div>
          <div class="info-card"><h3>Problems and references</h3><p>Browse exercises.</p><button class="secondary" data-view-target="problems">Browse problems</button></div>
          <div class="info-card"><h3>Bookmarks and notes</h3><p>Manage saved items.</p><button class="secondary" data-view-target="notes">Open saved items</button></div>
        </div>
      </details>`;
    bindCommonActions(content);
    $$('[data-atlas-command]', content).forEach(b =>
      b.addEventListener('click', () => window.AtlasNavigation?.open())
    );
    $$('[data-atlas-read]', content).forEach(b =>
      b.addEventListener('click', () =>
        openPdf(state.resumePage, 'Continue reading', { preferRead: true })
      )
    );
    $$('[data-source-audit]', content).forEach(b =>
      b.addEventListener('click', () => window.AtlasSourceTrust?.show())
    );
  }

  function orientationCard(title, text, id) {
    return `<div class="info-card"><h3>${esc(title)}</h3><p>${esc(text)}</p><button class="secondary" data-open-section="${esc(id)}">Open §${esc(id)}</button></div>`;
  }

  function pathPreview(path) {
    const done = path.steps.filter(id => {
      const s = sectionById.get(id);
      return s && user.read[s.key];
    }).length;
    return `<div class="info-card"><h3>${esc(path.title)}</h3><p>${esc(path.description)}</p><span class="page-label">${done}/${path.steps.length} steps completed</span><br><button class="secondary" data-open-path="${esc(path.id)}">Open path</button></div>`;
  }

  function renderBookMap(initialFilter = '') {
    const chapters = C.sections.filter(x => x.kind === 'chapter' || x.kind === 'appendix');
    content.innerHTML = `
      <header class="view-header"><div class="eyebrow">Structural map</div><h1>Book map</h1></header>
      <div class="toolbar"><input id="bookFilter" type="search" value="${esc(initialFilter)}" placeholder="Filter chapter and section titles…"><button class="secondary" id="expandAll">Expand all</button><button class="secondary" id="collapseAll">Collapse all</button></div>
      <div id="bookTree"></div>`;

    const renderTree = (query = '') => {
      const q = norm(query);
      $('#bookTree').innerHTML =
        chapters
          .map(ch => {
            const descendants = C.sections.filter(
              x => x.parent === ch.key || (x.id && ch.id && String(x.id).startsWith(`${ch.id}.`))
            );
            const matched =
              !q || norm(ch.title).includes(q) || descendants.some(x => norm(x.title).includes(q));
            if (!matched) return '';
            const children = C.sections.filter(x => x.parent === ch.key);
            const inner = [];
            children.forEach(s => {
              inner.push(tocButton(s));
              C.sections.filter(x => x.parent === s.key).forEach(sub => inner.push(tocButton(sub)));
            });
            return `<details class="toc-chapter" ${q ? 'open' : ''}><summary><span>${esc(ch.title)}</span><span class="page-label">${pageLabel(ch.pdf_page)}</span></summary><div class="toc-children">${inner.join('')}</div></details>`;
          })
          .join('') || '<div class="empty">No chapter or section title matches that filter.</div>';
      bindEntityButtons($('#bookTree'));
    };
    renderTree(initialFilter);
    $('#bookFilter').addEventListener(
      'input',
      debounce(e => renderTree(e.target.value), 100)
    );
    $('#expandAll').addEventListener('click', () =>
      $$('.toc-chapter', content).forEach(x => (x.open = true))
    );
    $('#collapseAll').addEventListener('click', () =>
      $$('.toc-chapter', content).forEach(x => (x.open = false))
    );
  }

  function tocButton(s) {
    return `<button class="toc-link level-${s.level}" data-entity-type="section" data-entity-key="${esc(s.key)}"><span>${esc(s.title)}</span><span class="page-label">${esc(s.printed_page || '')}</span></button>`;
  }

/* src/client/application/30-discovery.js */
  function renderCollection(name) {
    const config = {
      figures: {
        title: 'Figures',
        singular: 'figure',
        subtitle: 'Search figure labels and captions.'
      },
      tables: { title: 'Tables', singular: 'table', subtitle: 'Search table labels and titles.' },
      equations: {
        title: 'Equations',
        singular: 'equation',
        subtitle: 'Browse the book’s numbered equations.'
      },
      problems: {
        title: 'Problems',
        singular: 'problem',
        subtitle:
          'Search problem numbers and statements extracted from your selected PDF. Open the source for original mathematical formatting.'
      },
      references: {
        title: 'References',
        singular: 'reference',
        subtitle: 'Search the chapter bibliographies.'
      }
    }[name];
    const filtered = filteredCollection(name, state.collectionFilter, state.collectionChapter);
    const pageSize = name === 'references' ? 60 : 80;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.collectionPage = Math.min(state.collectionPage, pages - 1);
    const slice = filtered.slice(
      state.collectionPage * pageSize,
      (state.collectionPage + 1) * pageSize
    );

    content.innerHTML = `
      <header class="view-header"><div class="eyebrow">Structured catalog</div><h1>${config.title}</h1><p>${config.subtitle} Every result opens the relevant location in the linked PDF.</p></header>
      <div class="toolbar collection-toolbar"><input id="collectionFilter" type="search" value="${esc(state.collectionFilter)}" placeholder="Filter ${config.title.toLowerCase()}…">${chapterFilterHTML(state.collectionChapter)}<span class="badge">${filtered.length.toLocaleString()} results</span></div>
      <div class="result-list">${slice.map((item, i) => collectionCard(name, item, C[name].indexOf(item))).join('') || '<div class="empty">No matching entries.</div>'}</div>
      ${paginationHTML(state.collectionPage, pages)}`;

    $('#collectionFilter').addEventListener(
      'input',
      debounce(e => {
        // Re-render the filtered list without stealing the cursor or jumping
        // back to the top after every character.
        const position = e.target.selectionStart;
        const scroll = content.scrollTop;
        state.collectionFilter = e.target.value;
        state.collectionPage = 0;
        renderCollection(name);
        content.scrollTop = scroll;
        requestAnimationFrame(() => {
          const el = $('#collectionFilter');
          if (!el) return;
          el.focus();
          el.setSelectionRange(
            Math.min(position, el.value.length),
            Math.min(position, el.value.length)
          );
        });
      }, 120)
    );
    $('#collectionChapter').addEventListener('change', e => {
      state.collectionChapter = e.target.value;
      state.collectionPage = 0;
      renderCollection(name);
      content.scrollTop = 0;
      $('#collectionChapter').focus();
    });
    bindCollectionCards(name, filtered);
    // Render visible source-rendered equations automatically, but never pre-render the
    // whole book: this stays responsive on slower computers.
    if (name === 'equations') attachVisibleEquationPreviews(content);
    if (name === 'figures') attachVisibleFigurePreviews(content);
    if (name === 'tables') attachVisibleTablePreviews(content);
    bindPagination(() => renderCollection(name), pages);
  }

  // Chapter boundaries come from the imported outline, not a numeric prefix
  // guessed from a figure/table label. This also covers appendices correctly.
  function catalogChapters() {
    return C.sections
      .filter(
        section =>
          ['chapter', 'appendix'].includes(section.kind) &&
          Number.isFinite(Number(section.pdf_page))
      )
      .sort((a, b) => Number(a.pdf_page) - Number(b.pdf_page));
  }

  function chapterFilterHTML(selected = '') {
    const chapters = catalogChapters();
    return `<select id="collectionChapter" aria-label="Filter by chapter or appendix">
      <option value="">All chapters &amp; appendices</option>
      <option value="front" ${selected === 'front' ? 'selected' : ''}>Front matter</option>
      ${chapters.map(section => `<option value="${esc(section.key)}" ${selected === section.key ? 'selected' : ''}>${esc(section.title)}</option>`).join('')}
    </select>`;
  }

  function filteredCollection(name, query = '', chapterKey = '') {
    const q = norm(query);
    const chapters = catalogChapters();
    const chapter = chapters.find(section => section.key === chapterKey);
    const frontEnd = chapters.length ? Number(chapters[0].pdf_page) - 1 : 0;
    return C[name].filter(item => {
      if (q && !norm(collectionText(name, item)).includes(q)) return false;
      if (chapterKey === 'front') return Number(item.pdf_page) <= frontEnd;
      if (!chapter) return true;
      return (
        Number(item.pdf_page) >= Number(chapter.pdf_page) &&
        Number(item.pdf_page) <= Number(chapter.pdf_page_end)
      );
    });
  }

  function collectionText(name, item) {
    if (name === 'figures' || name === 'tables') return `${item.label} ${item.caption}`;
    if (name === 'equations') return `${item.label} ${item.context}`;
    if (name === 'problems') return `${item.label} ${item.text}`;
    if (name === 'references') return `${item.chapter} ${item.number} ${item.text}`;
    return JSON.stringify(item);
  }

  function collectionCard(name, item, index) {
    let title, text, badge;
    if (name === 'references') {
      title = `Chapter ${item.chapter}, reference ${item.number}`;
      text = item.text;
      badge = 'Reference';
    } else {
      title = item.title;
      text = item.description || item.caption || item.context || item.text || '';
      badge = name.slice(0, -1);
    }
    const inlineEquation =
      name === 'equations'
        ? `<div class="equation-catalog-preview" data-equation-label="${esc(item.label)}" role="status"><span class="formula-status">Rendering equation…</span></div>`
        : '';
    const inlineFigure =
      name === 'figures'
        ? `<div class="figure-catalog-preview${item.source_part ? ' figure-part-preview' : ''}" data-figure-label="${esc(item.label)}" data-figure-page="${Number(item.pdf_page) || 0}" role="status">Locating figure…</div>`
        : '';
    const inlineTable =
      name === 'tables'
        ? `<div class="table-catalog-preview" data-table-label="${esc(item.label)}" data-table-page="${Number(item.pdf_page) || 0}" role="status">Loading table…</div>`
        : '';
    // Figures show their original graphic, not a reflowed transcription of
    // the caption. The caption is displayed separately on the detail page.
    const snippet =
      name === 'figures' || name === 'equations'
        ? ''
        : `<div class="result-snippet sci-rich">${sci(shorten(text, 300), { mode: name === 'references' ? 'reference' : 'prose' })}</div>`;
    return `<button class="collection-card" data-collection="${name}" data-index="${index}"><div class="result-top"><span class="result-title sci-rich">${sci(title, { mode: name === 'references' ? 'reference' : 'prose' })}</span><span class="page-label">${esc(pageLabel(item.pdf_page))}</span></div>${inlineEquation}${inlineFigure}${inlineTable}${snippet}<span class="badge">${esc(badge)}</span></button>`;
  }

  // Render the actual equation directly from the local source PDF in the Atlas instead of
  // presenting an image, cropped PDF page or approximate font transcription.
  async function fillEquationPreview(holder, label) {
    if (!holder || holder.dataset.loaded === '1') return;
    holder.dataset.loaded = '1';
    try {
      await window.AtlasEquationPreview.mount(holder, label);
    } catch (error) {
      console.warn('Could not mount original PDF equation', label, error);
      if (holder.isConnected) {
        holder.classList.add('equation-unavailable');
        holder.textContent = 'Open the original equation in the main PDF reader.';
      }
    }
  }
  function attachVisibleEquationPreviews(root) {
    attachVisiblePreviews(
      root,
      '[data-equation-label]',
      el => fillEquationPreview(el, el.dataset.equationLabel),
      6
    );
  }

  function attachVisibleFigurePreviews(root) {
    if (!window.AtlasFigurePreview) return;
    attachVisiblePreviews(root, '[data-figure-label][data-figure-page]', el =>
      window.AtlasFigurePreview.mount(el, el.dataset.figureLabel, el.dataset.figurePage)
    );
  }

  function attachVisibleTablePreviews(root) {
    if (!window.AtlasTablePreview) return;
    attachVisiblePreviews(root, '[data-table-label][data-table-page]', el =>
      window.AtlasTablePreview.mount(el, el.dataset.tableLabel, el.dataset.tablePage)
    );
  }

  // All catalog previews share the existing lazy-load behavior. Only nearby
  // cards enter their renderer's queue, even for a long imported catalog.
  function attachVisiblePreviews(root, selector, mount, fallbackLimit = 8) {
    const nodes = $$(selector, root);
    if (typeof IntersectionObserver !== 'function') {
      nodes.slice(0, fallbackLimit).forEach(mount);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            mount(entry.target);
          }
      },
      { root: content, rootMargin: '250px 0px' }
    );
    nodes.forEach(node => observer.observe(node));
  }

  function paginationHTML(page, pages) {
    if (pages <= 1) return '';
    return `<div class="pagination"><button data-page="${page - 1}" ${page <= 0 ? 'disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages}</span><button data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Next</button></div>`;
  }

  function bindPagination(rerender, pages, stateKey = 'collectionPage') {
    $$('.pagination button', content).forEach(btn =>
      btn.addEventListener('click', () => {
        state[stateKey] = Math.max(0, Math.min(pages - 1, Number(btn.dataset.page)));
        rerender();
        content.scrollTop = 0;
      })
    );
  }

  function bindCollectionCards(name, items = C[name]) {
    $$('[data-collection]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const item = C[name][Number(btn.dataset.index)];
        const type = name === 'references' ? 'reference' : name.slice(0, -1);
        showEntity(type, item, true, {
          type,
          items,
          filtered: Boolean(state.collectionFilter || state.collectionChapter),
          view: name,
          collectionFilter: state.collectionFilter,
          collectionChapter: state.collectionChapter
        });
      })
    );
  }

/* src/client/application/40-catalog.js */
  function renderConcepts() {
    const q = norm(state.collectionFilter);
    const all = q
      ? C.index.filter(x => norm(`${x.term} ${x.parent || ''} ${x.see || ''}`).includes(q))
      : C.index;
    const pageSize = 100;
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    state.collectionPage = Math.min(state.collectionPage, pages - 1);
    const slice = all.slice(state.collectionPage * pageSize, (state.collectionPage + 1) * pageSize);
    content.innerHTML = `
      <header class="view-header"><div class="eyebrow">The book’s back-of-volume index, made interactive</div><h1>Concept index</h1><p>Search the editorial index and open any cited book page. Subentries retain their parent term.</p></header>
      <div class="toolbar"><input id="conceptFilter" type="search" value="${esc(state.collectionFilter)}" placeholder="Filter index terms…"><span class="badge">${all.length.toLocaleString()} terms</span></div>
      <div class="result-list">${slice.map(x => indexCard(x, C.index.indexOf(x))).join('') || '<div class="empty">No matching index terms.</div>'}</div>
      ${paginationHTML(state.collectionPage, pages)}`;
    $('#conceptFilter').addEventListener(
      'input',
      debounce(e => {
        state.collectionFilter = e.target.value;
        state.collectionPage = 0;
        renderConcepts();
        requestAnimationFrame(() => {
          const el = $('#conceptFilter');
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        });
      }, 120)
    );
    $$('[data-index-entry]', content).forEach(btn =>
      btn.addEventListener('click', () =>
        showEntity('concept', C.index[Number(btn.dataset.indexEntry)])
      )
    );
    $$('[data-print-page]', content).forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openPdf(pdfFromPrinted(btn.dataset.printPage), `Index: ${btn.dataset.term}`);
      })
    );
    bindPagination(renderConcepts, pages);
  }

  function indexCard(x, index) {
    const refs = x.pages
      .slice(0, 12)
      .map(ref => {
        const n = firstNumericPage(ref);
        return n
          ? `<button class="page-ref" data-print-page="${n}" data-term="${esc(x.term)}">${esc(ref)}</button>`
          : '';
      })
      .join(' ');
    return `<div class="collection-card" data-index-entry="${index}"><div class="result-top"><span class="result-title">${x.parent ? `<span class="muted">${esc(x.parent)} › </span>` : ''}${esc(x.term)}</span><span class="badge">Index</span></div>${x.see ? `<div class="result-snippet sci-rich">${sci(x.see)}</div>` : ''}<div class="related-row">${refs || '<span class="muted">Cross-reference entry</span>'}</div></div>`;
  }

  function renderSymbols() {
    const tabs = [
      ['abbreviations', 'Abbreviations', C.abbreviations],
      ['symbols', 'Roman & Greek symbols', C.symbols],
      ['chemicals', 'Chemical abbreviations', C.chemicals]
    ];
    const current = tabs.find(x => x[0] === state.symbolTab) || tabs[0];
    const q = norm(state.collectionFilter);
    const entries = q
      ? current[2].filter(x => norm(notationSearchText(x)).includes(q))
      : current[2];
    const pageSize = 140;
    const pages = Math.max(1, Math.ceil(entries.length / pageSize));
    state.collectionPage = Math.min(state.collectionPage, pages - 1);
    const slice = entries.slice(
      state.collectionPage * pageSize,
      (state.collectionPage + 1) * pageSize
    );
    content.innerHTML = `
      <header class="view-header"><div class="eyebrow">Book notation decoded</div><h1>Symbols & abbreviations</h1><p>Definitions, usual units, and source references from the book’s notation tables.</p></header>
      <div class="symbol-tabs" role="group" aria-label="Symbols and abbreviations categories">${tabs.map(t => `<button type="button" data-symbol-tab="${t[0]}" class="${t[0] === state.symbolTab ? 'active' : ''}" aria-pressed="${t[0] === state.symbolTab}"><span class="symbol-tab-label">${t[1]}</span><small class="symbol-tab-count">${t[2].length}</small></button>`).join('')}</div>
      <div class="toolbar"><input id="symbolFilter" type="search" value="${esc(state.collectionFilter)}" placeholder="Filter ${current[1].toLowerCase()}…"><span class="badge">${entries.length} results</span></div>
      <div class="result-list symbol-cards">${symbolCards(current[0], slice)}</div>
      ${paginationHTML(state.collectionPage, pages)}`;
    $$('[data-symbol-tab]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        state.symbolTab = btn.dataset.symbolTab;
        state.collectionFilter = '';
        state.collectionPage = 0;
        renderSymbols();
      })
    );
    $('#symbolFilter').addEventListener(
      'input',
      debounce(e => {
        state.collectionFilter = e.target.value;
        state.collectionPage = 0;
        renderSymbols();
        requestAnimationFrame(() => {
          const el = $('#symbolFilter');
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        });
      }, 120)
    );
    $$('[data-symbol-entry]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const type =
          current[0] === 'symbols'
            ? 'symbol'
            : current[0] === 'chemicals'
              ? 'chemical'
              : 'abbreviation';
        const item = current[2][Number(btn.dataset.symbolEntry)];
        if (item)
          showEntity(type, item, true, {
            type,
            items: entries,
            filtered: Boolean(state.collectionFilter),
            view: 'symbols',
            collectionFilter: state.collectionFilter,
            symbolTab: current[0]
          });
      })
    );
    bindPagination(renderSymbols, pages);
  }

  function symbolCardField(label, value, format = sci) {
    if (!String(value ?? '').trim()) return '';
    return `<span class="symbol-card-detail sci-rich"><span class="symbol-card-field-label">${esc(label)}:</span> ${format(value)}</span>`;
  }

  function notationValue(value, runs, mode = 'prose') {
    return typeof window !== 'undefined' && window.AtlasScience?.runsHtml
      ? window.AtlasScience.runsHtml(value, runs, { mode })
      : sci(value, { mode });
  }

  function notationDefinitions(item) {
    return Array.isArray(item.definitions) && item.definitions.length
      ? item.definitions
      : [{ meaning: item.meaning, units: item.units, sections: item.sections }];
  }

  function notationDefinitionText(item) {
    return notationDefinitions(item)
      .map(definition =>
        [definition.meaning, definition.units, definition.sections].filter(Boolean).join(' ')
      )
      .join(' ');
  }

  function notationSearchText(item) {
    return [item.symbol, item.abbr, item.structure_ref, notationDefinitionText(item)]
      .filter(Boolean)
      .join(' ');
  }

  function notationCardDefinitions(tab, item) {
    return notationDefinitions(item)
      .map(definition => {
        const label = definition.label
          ? `<span class="notation-definition-label">${esc(definition.label)}</span> `
          : '';
        const meaning = notationValue(definition.meaning, definition.meaning_runs);
        const units =
          tab === 'symbols'
            ? symbolCardField('Usual units', definition.units, value =>
                notationValue(value, definition.units_runs)
              )
            : '';
        return `<span class="notation-definition"><span class="result-snippet sci-rich">${label}${meaning}</span>${units}${symbolCardField('Sections', definition.sections, esc)}</span>`;
      })
      .join('');
  }

  function symbolCards(tab, entries) {
    const original = C[tab];
    const category =
      tab === 'symbols' ? 'Symbol' : tab === 'chemicals' ? 'Chemical' : 'Abbreviation';
    // One native button owns the complete entry. Identifiers, meanings, units,
    // and source references share the same click, hover, and keyboard target.
    return (
      entries
        .map(x => {
          const label = tab === 'symbols' ? x.symbol : x.abbr;
          const identifier = notationValue(label, x.symbol_runs || x.abbr_runs, 'identifier');
          const definition =
            tab === 'chemicals'
              ? `<span class="result-snippet sci-rich">${sci(x.meaning)}</span>${symbolCardField('Structure / equation', x.structure_ref, value => sci(value, { mode: 'identifier' }))}`
              : notationCardDefinitions(tab, x);
          return `<button type="button" class="collection-card symbol-card" data-symbol-entry="${original.indexOf(x)}">
          <span class="result-top"><span class="result-title sci-rich">${identifier}</span><span class="badge">${category}</span></span>
          ${definition}
        </button>`;
        })
        .join('') || '<div class="empty">No matching entries.</div>'
    );
  }

  function renderPaths(focusId = null) {
    content.innerHTML = `<header class="view-header"><div class="eyebrow">Suggested routes through a nonlinear subject</div><h1>Study paths</h1><p>Each route combines prerequisites and applications. Mark sections read from their detail page; progress updates here automatically.</p></header>${STUDY_PATHS.map(path => pathCard(path, focusId === path.id)).join('')}`;
    bindCommonActions(content);
    if (focusId)
      requestAnimationFrame(() =>
        document
          .getElementById(`path-${focusId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
  }

  // Display-only cleanup: remove an exact, leading copy of a section heading.
  // The original book pages and saved notes are never altered by preview cleanup.
  function sectionPreview(section, limit = 170) {
    let text = String(section.excerpt || '').trim();
    const title = String(section.title || '').trim();
    const candidates = [
      ...new Set([
        title,
        title.replace(/^(?:Chapter|Appendix)\s+[\dA-Z]+\s+/i, ''),
        title.replace(/^(?:\d+|[A-Z])(?:\.\d+)*\s+/, '')
      ])
    ]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      const heading = new RegExp(
        '^' + candidate.split(/\s+/).map(regexEscape).join('\\s+') + '(?=\\s|$)',
        'i'
      );
      if (heading.test(text)) {
        text = text.replace(heading, '').trim();
        break;
      }
    }
    return shorten(text || 'Open this section in the book.', limit);
  }

  function pathStep(section, pathId, index) {
    const done = Boolean(user.read[section.key]);
    const id = `path-${pathId}-step-${index + 1}`;
    return `<button type="button" class="path-step ${done ? 'done' : ''}" data-entity-type="section" data-entity-key="${esc(section.key)}" aria-labelledby="${esc(id)}-title" aria-describedby="${esc(id)}-description">
      <span class="path-step-index" aria-hidden="true">${done ? '✓' : index + 1}</span>
      <span class="path-step-copy">
        <strong class="path-step-title" id="${esc(id)}-title">${esc(section.title)}</strong>
        <small class="path-step-description muted sci-rich" id="${esc(id)}-description">${sci(sectionPreview(section))}</small>
      </span>
      <span class="page-label" aria-label="Book page ${esc(section.printed_page)}">p. ${esc(section.printed_page)}</span>
    </button>`;
  }

  function pathCard(path, open = false) {
    const resolved = path.steps.map(id => sectionById.get(id)).filter(Boolean);
    const done = resolved.filter(s => user.read[s.key]).length;
    const pct = resolved.length ? Math.round((done / resolved.length) * 100) : 0;
    return `<section class="path-card" id="path-${esc(path.id)}"><div class="path-head"><div><h2>${esc(path.title)}</h2><p>${esc(path.description)}</p></div><span class="badge">${pct}% complete</span></div><div class="progress-track"><div style="width:${pct}%"></div></div><div class="path-steps">${resolved.map((s, i) => pathStep(s, path.id, i)).join('')}</div></section>`;
  }

/* src/client/application/50-study-tools.js */
  function renderCalculators() {
    window.AtlasCalculators.mount(content, { openSection, goView });
  }

  function renderNotes() {
    const entityRows = user.bookmarks.entities.map(resolveEntityBookmark).filter(Boolean);
    const noteEntries = Object.entries(user.notes).filter(([, v]) => String(v).trim());
    content.innerHTML = `
      <header class="view-header"><div class="eyebrow">Your private layer</div><h1>Bookmarks & notes</h1><p>Stored locally in this browser. Export a backup before moving the Atlas folder or clearing browser data.</p></header>
      <div class="button-row"><button class="primary" id="exportNotes">Export backup</button><button class="secondary" id="importNotes">Import backup</button><button class="secondary" id="clearProgress">Clear reading progress</button></div>
      <section class="section-block"><div class="section-heading"><h2>Bookmarked pages</h2><span class="badge">${user.bookmarks.pages.length}</span></div>${user.bookmarks.pages.map(p => `<div class="bookmark-row"><button class="toc-link" data-open-pdf="${p}"><span>${esc(pageLabel(p))}</span></button><button data-remove-page="${p}">Remove</button></div>`).join('') || '<div class="empty">No bookmarked pages yet. Use the star in the reader toolbar.</div>'}</section>
      <section class="section-block"><div class="section-heading"><h2>Bookmarked entries</h2><span class="badge">${entityRows.length}</span></div>${entityRows.map(x => `<div class="bookmark-row"><button class="toc-link" data-bookmark-entity="${esc(x.key)}"><span>${esc(x.title)}</span><span class="page-label">${esc(x.page ? pageLabel(x.page) : '')}</span></button><button data-remove-entity="${esc(x.key)}">Remove</button></div>`).join('') || '<div class="empty">No bookmarked encyclopedia entries yet.</div>'}</section>
      <section class="section-block"><div class="section-heading"><h2>Saved notes</h2><span class="badge">${noteEntries.length}</span></div>${noteEntries.map(([key, note]) => `<div class="detail-card"><strong>${esc(resolveTitleFromKey(key) || key)}</strong><p>${esc(note)}</p></div>`).join('') || '<div class="empty">Notes added from an entry detail page appear here.</div>'}</section>
      ${unassignedSavedItemsHTML()}`;
    $$('[data-open-pdf]', content).forEach(btn =>
      btn.addEventListener('click', () => openPdf(Number(btn.dataset.openPdf), 'Bookmarked page'))
    );
    $$('[data-remove-page]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        togglePageBookmark(Number(btn.dataset.removePage));
        renderNotes();
      })
    );
    $$('[data-remove-entity]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const i = user.bookmarks.entities.indexOf(btn.dataset.removeEntity);
        if (i >= 0) user.bookmarks.entities.splice(i, 1);
        saveUser();
        renderNotes();
      })
    );
    $$('[data-bookmark-entity]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const x = resolveEntityBookmark(btn.dataset.bookmarkEntity);
        if (x) showEntity(x.type, x.item);
      })
    );
    $$('[data-assign-saved]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.assignSaved);
        const selected = content.querySelector(`[data-unassigned-target="${index}"]`);
        if (assignSavedEntry(index, selected?.value)) renderNotes();
        else window.AtlasLayout?.notify('Choose the entry this saved item belongs to.');
      })
    );
    $('#exportNotes').addEventListener('click', exportUserData);
    $('#importNotes').addEventListener('click', () => $('#importNotesFile').click());
    $('#clearProgress').addEventListener('click', () => {
      if (confirm('Clear all section reading progress? Bookmarks and notes will remain.')) {
        user.read = {};
        saveUser();
        renderNotes();
      }
    });
  }

  function resolveEntityBookmark(key, qualifier = {}) {
    const record = entityIdentities().resolve(key, qualifier);
    if (!record) return null;
    return {
      ...record,
      key,
      canonicalKey: record.key,
      title: savedEntryTitle(record.type, record.item),
      page: record.item.pdf_page
    };
  }

  function savedEntryTitle(type, item) {
    if (type === 'concept') return item.parent ? `${item.parent} › ${item.term}` : item.term;
    if (type === 'symbol') return `${item.symbol} — ${item.meaning}`;
    if (type === 'abbreviation' || type === 'chemical') return `${item.abbr} — ${item.meaning}`;
    if (type === 'reference') return item.title || `Reference ${item.chapter}.${item.number}`;
    return item.title || item.label || 'Saved entry';
  }

  function savedKeyType(key) {
    if (String(key).startsWith('ea-entry-v2:')) {
      try {
        return JSON.parse(key.slice('ea-entry-v2:'.length))[1] || '';
      } catch (_) {
        return '';
      }
    }
    if (/^(?:chapter|section|appendix)-/.test(key)) return 'section';
    return String(key).split('-')[0];
  }

  function unassignedCandidates(item) {
    const sourceId = entitySourceId();
    if (item.sourceId && item.sourceId !== sourceId) return [];
    const match = entityIdentities().inspect(item.key);
    if (match.status === 'different-source') return [];
    const type = savedKeyType(item.key);
    return match.candidates.length
      ? match.candidates
      : type
        ? entityIdentities().entries(type)
        : [];
  }

  function unassignedSavedItemsHTML() {
    const items = user.unassigned || [];
    if (!items.length) return '';
    const reasons = {
      ambiguous:
        'More than one source entry matches this older saved item. Choose its destination.',
      missing: 'The original entry could not be matched. Its saved content has been kept.',
      'different-source':
        'This saved item belongs to a different PDF. It has not been attached here.',
      conflict: 'This entry already has a different note. Both versions have been kept.'
    };
    return `<section class="section-block unassigned-saved-items"><div class="section-heading"><h2>Unassigned saved items</h2><span class="badge">${items.length}</span></div><p>These items are included in your backup. Choose an entry to attach one; an existing note will be kept alongside the attached text.</p>${items
      .map((item, index) => {
        const candidates = unassignedCandidates(item);
        const title =
          resolveEntityBookmark(item.key)?.title ||
          (item.key.startsWith('ea-entry-v2:')
            ? `Saved ${savedKeyType(item.key) || 'entry'}`
            : item.key.replace('-', ' '));
        return `<section class="detail-card"><h3>${item.kind === 'note' ? 'Note' : 'Bookmark'}: ${esc(title)}</h3><p class="muted">${reasons[item.reason] || reasons.missing}</p>${item.kind === 'note' ? `<p>${esc(item.value)}</p>` : ''}${candidates.length ? `<div class="button-row"><select data-unassigned-target="${index}" aria-label="Choose an entry for this ${item.kind}"><option value="">Choose an entry…</option>${candidates.map(candidate => `<option value="${esc(candidate.key)}">${esc(shorten(savedEntryTitle(candidate.type, candidate.item), 150))}${candidate.item.pdf_page ? ` · PDF ${candidate.item.pdf_page}` : ''}</option>`).join('')}</select><button type="button" data-assign-saved="${index}">Attach ${item.kind}</button></div>` : ''}</section>`;
      })
      .join('')}</section>`;
  }

  function assignSavedEntry(index, key) {
    const item = user.unassigned?.[index];
    const resolved = entityIdentities().resolve(key);
    if (
      !item ||
      !resolved ||
      !unassignedCandidates(item).some(candidate => candidate.key === resolved.key)
    )
      return false;
    if (item.kind === 'bookmark') {
      if (!user.bookmarks.entities.includes(resolved.key))
        user.bookmarks.entities.push(resolved.key);
    } else {
      const current = user.notes[resolved.key];
      user.notes[resolved.key] =
        current && current !== item.value ? `${current}\n\n${item.value}` : item.value;
    }
    user.unassigned.splice(index, 1);
    saveUser();
    return true;
  }

  function resolveTitleFromKey(key) {
    return (
      resolveEntityBookmark(key)?.title ||
      (key.startsWith('page-') ? pageLabel(Number(key.slice(5))) : 'Saved note')
    );
  }

  function exportUserData() {
    const src = window.ATLAS_SOURCE_REPORT;
    const data = {
      version: 4,
      source: src
        ? {
            sourceId: entitySourceId(),
            fileName: src.fileName,
            pageCount: src.pageCount,
            fingerprint: src.signature
          }
        : null,
      layout: window.AtlasLayout?.exportState(),
      calculators: window.AtlasCalculators?.exportState(),
      exported: new Date().toISOString(),
      bookmarks: user.bookmarks,
      notes: user.notes,
      read: user.read,
      unassigned: user.unassigned || [],
      theme: user.theme,
      guide: user.guide
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Electrochemical_Atlas_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function backupMatchesSource(source) {
    if (!source) return true; // Early backups have no source metadata.
    const current = window.ATLAS_SOURCE_REPORT;
    if (source.sourceId && source.sourceId !== entitySourceId()) return false;
    if (source.fingerprint && current?.signature && source.fingerprint !== current.signature)
      return false;
    return !(Number.isInteger(source.pageCount) && source.pageCount !== C.meta.pdf_pages);
  }

  function importUserData(file) {
    if (file.size > 5 * 1024 * 1024) {
      alert('That backup is unusually large. Select a valid Atlas JSON backup (up to 5 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (
          !data ||
          typeof data !== 'object' ||
          !Number.isInteger(data.version) ||
          data.version < 1 ||
          data.version > 4 ||
          !('bookmarks' in data || 'notes' in data || 'read' in data)
        )
          throw new Error('This is not a supported Atlas backup.');
        if (!backupMatchesSource(data.source))
          throw new Error(
            'This backup belongs to a different PDF. Open that PDF before importing it. Your current saved items have not changed.'
          );
        const incoming = normalizeSavedEntries(data, C.meta.pdf_pages);
        const merged = mergeSavedEntryData(user, incoming, entityIdentities(), entitySourceId());
        Object.assign(user, merged);
        if (['light', 'dark'].includes(data.theme)) applyTheme(data.theme);
        user.guide = Boolean(data.guide);
        state.guideMode = user.guide;
        document.body.classList.toggle('guide-mode', state.guideMode);
        if (data.layout) window.AtlasLayout?.importState(data.layout);
        if (data.calculators) window.AtlasCalculators?.importState(data.calculators);
        saveUser();
        renderNotes();
        window.AtlasLayout?.notify(
          user.unassigned.length
            ? `Study backup merged. ${user.unassigned.length} saved items need a match in Saved items.`
            : 'Study backup merged. Your notes and bookmarks are available.'
        );
      } catch (err) {
        alert(`Could not import that backup: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  // Saved study data belongs to one source PDF. Preserve legacy values and
  // conflicting notes whenever their destination cannot be determined safely.
  function emptySavedEntries() {
    return {
      bookmarks: { pages: [], entities: [] },
      notes: Object.create(null),
      read: Object.create(null),
      unassigned: []
    };
  }

  function validSavedKey(key) {
    return (
      typeof key === 'string' &&
      key.length > 0 &&
      key.length <= 4096 &&
      !['__proto__', 'constructor', 'prototype'].includes(key)
    );
  }

  function normalizeSavedEntries(data, pageCount = Infinity) {
    const result = emptySavedEntries();
    const bookmarks = data?.bookmarks;
    if (Array.isArray(bookmarks?.pages))
      result.bookmarks.pages = [
        ...new Set(
          bookmarks.pages.filter(page => Number.isInteger(page) && page > 0 && page <= pageCount)
        )
      ];
    if (Array.isArray(bookmarks?.entities))
      result.bookmarks.entities = [...new Set(bookmarks.entities.filter(validSavedKey))];
    if (data?.notes && typeof data.notes === 'object' && !Array.isArray(data.notes))
      for (const [key, value] of Object.entries(data.notes))
        if (validSavedKey(key) && typeof value === 'string') result.notes[key] = value;
    if (data?.read && typeof data.read === 'object' && !Array.isArray(data.read))
      for (const [key, value] of Object.entries(data.read))
        if (validSavedKey(key) && typeof value === 'boolean') result.read[key] = value;
    if (Array.isArray(data?.unassigned))
      for (const item of data.unassigned) {
        if (!item || !['bookmark', 'note'].includes(item.kind) || !validSavedKey(item.key))
          continue;
        if (item.kind === 'note' && typeof item.value !== 'string') continue;
        result.unassigned.push({
          kind: item.kind,
          key: item.key,
          ...(item.kind === 'note' ? { value: item.value } : {}),
          reason: ['ambiguous', 'missing', 'different-source', 'conflict'].includes(item.reason)
            ? item.reason
            : 'missing',
          sourceId: typeof item.sourceId === 'string' ? item.sourceId.slice(0, 128) : ''
        });
      }
    return result;
  }

  function keepUnassigned(list, item) {
    if (
      !list.some(
        existing =>
          existing.kind === item.kind &&
          existing.key === item.key &&
          existing.value === item.value &&
          existing.sourceId === item.sourceId
      )
    )
      list.push(item);
  }

  // Migrate only a unique source match. A legacy label shared by two rows is
  // evidence of ambiguity, not permission to select the first row in the book.
  function migrateSavedEntryData(data, identities, sourceId) {
    const result = normalizeSavedEntries(data);
    const oldBookmarks = result.bookmarks.entities;
    const oldNotes = result.notes;
    result.bookmarks.entities = [];
    result.notes = Object.create(null);
    for (const key of oldBookmarks) {
      const match = identities.inspect(key);
      if (match.status === 'resolved') result.bookmarks.entities.push(match.candidates[0].key);
      else
        keepUnassigned(result.unassigned, {
          kind: 'bookmark',
          key,
          reason: match.status,
          sourceId
        });
    }
    result.bookmarks.entities = [...new Set(result.bookmarks.entities)];
    // An already canonical note wins over an old alias. Conflicting text is
    // preserved separately, including conflicts between two former fragments.
    const notes = Object.entries(oldNotes).sort(
      ([a], [b]) =>
        Number(Boolean(identities.resolve(b)?.key === b)) -
        Number(Boolean(identities.resolve(a)?.key === a))
    );
    for (const [key, value] of notes) {
      const match = identities.inspect(key);
      if (match.status !== 'resolved') {
        keepUnassigned(result.unassigned, {
          kind: 'note',
          key,
          value,
          reason: match.status,
          sourceId
        });
        continue;
      }
      const target = match.candidates[0].key;
      if (!Object.hasOwn(result.notes, target)) result.notes[target] = value;
      else if (result.notes[target] !== value)
        keepUnassigned(result.unassigned, {
          kind: 'note',
          key,
          value,
          reason: 'conflict',
          sourceId
        });
    }
    return result;
  }

  function mergeSavedEntryData(current, incoming, identities, sourceId) {
    const result = migrateSavedEntryData(current, identities, sourceId);
    const added = migrateSavedEntryData(incoming, identities, sourceId);
    result.bookmarks.pages = [
      ...new Set([...result.bookmarks.pages, ...added.bookmarks.pages])
    ].sort((a, b) => a - b);
    result.bookmarks.entities = [
      ...new Set([...result.bookmarks.entities, ...added.bookmarks.entities])
    ];
    for (const [key, value] of Object.entries(added.notes)) {
      if (!Object.hasOwn(result.notes, key)) result.notes[key] = value;
      else if (result.notes[key] !== value)
        keepUnassigned(result.unassigned, {
          kind: 'note',
          key,
          value,
          reason: 'conflict',
          sourceId
        });
    }
    for (const [key, value] of Object.entries(added.read))
      result.read[key] = Boolean(result.read[key] || value);
    for (const item of added.unassigned) keepUnassigned(result.unassigned, item);
    return result;
  }

  function initializeSavedEntries() {
    const sourceId = entitySourceId();
    const storageKey = sourceId ? `ea_study_v2:${sourceId}` : '';
    const saved = storageKey ? loadJSON(storageKey, null) : null;
    const ownerKey = 'ea_study_v2_legacy_source';
    const owner = storage.getItem(ownerKey);
    let initial = emptySavedEntries();
    if (saved?.version === 2 && saved.sourceId === sourceId) initial = saved;
    else if (!owner || owner === sourceId) {
      initial = user;
      // Claim the old, unscoped data once. The original values are retained
      // verbatim as a migration backup and are never rewritten by saveUser.
      if (sourceId && !owner) {
        try {
          storage.setItem(ownerKey, sourceId);
        } catch (_) {
          window.ATLAS_TEMP_STORAGE = true;
        }
      }
    }
    const clean = normalizeSavedEntries(initial, C.meta?.pdf_pages || Infinity);
    Object.assign(user, migrateSavedEntryData(clean, entityIdentities(), sourceId));
    saveUser();
  }

/* src/client/application/60-entity-details.js */
  function problemPresentation(raw) {
    const value = String(raw ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n *\n+ */g, '\n\n')
      .replace(/(?<!\n)\n(?!\n)/g, ' ')
      .trim();
    if (!value) return '<p>No problem statement was extracted; open the original page.</p>';
    const subpartRE = /(?:^|\s)(?:\(([a-h])\)|([a-h])\))(?=\s|[A-Z(]|$)/g;
    const parts = [...value.matchAll(subpartRE)];
    const intro = parts.length >= 2 ? value.slice(0, parts[0].index).trim() : value;
    const introduction = intro
      .split(
        /\n\n+|(?<=[.?!])\s+(?=(?:Given|Assume|Calculate|Determine|Find|Next|Then|Finally|Consider|What|How|Use|Suppose)\b)/g
      )
      .filter(Boolean);
    let html =
      '<div class="problem-statement sci-rich">' +
      introduction.map(x => `<p>${sci(x)}</p>`).join('');
    if (parts.length >= 2) {
      html += '<ol class="problem-parts">';
      for (let i = 0; i < parts.length; i++) {
        const m = parts[i],
          from = m.index + m[0].length,
          to = i + 1 < parts.length ? parts[i + 1].index : value.length;
        const label = m[1] || m[2],
          t = value.slice(from, to).trim();
        html += `<li value="${label.charCodeAt(0) - 96}"><div>${sci(t)}</div></li>`;
      }
      html += '</ol>';
    }
    return html + '</div>';
  }

  // Captions, bibliographies and section excerpts are plaintext extracted
  // from the selected PDF. Render any actual paragraph boundaries, but never
  // interpret the source as HTML or manufacture equation markup from a guess.
  function sourceTextPresentation(type, source) {
    const value = String(source ?? '').trim();
    if (!value) return '<p>Open the original PDF page for this entry.</p>';
    const mode = type === 'reference' ? 'reference' : 'prose';
    const kind = ['figure', 'table', 'reference'].includes(type) ? type : 'prose';
    const paragraphs = value
      .split(/\n[\t ]*\n+/)
      .map(part => part.replace(/[\t ]*\n[\t ]*/g, ' ').trim())
      .filter(Boolean);
    return `<div class="detail-text sci-rich source-text source-text--${kind}">${paragraphs.map(part => `<p>${sci(part, { mode })}</p>`).join('')}</div>`;
  }

  function notationSectionLinks(value) {
    if (!String(value || '').trim()) return '';
    // Commas inside a printed suffix, such as (c,d), belong to that reference.
    const references = [];
    let start = 0,
      depth = 0;
    const text = String(value);
    for (let i = 0; i <= text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth = Math.max(0, depth - 1);
      if (i === text.length || ((text[i] === ',' || text[i] === ';') && depth === 0)) {
        const reference = text.slice(start, i).trim();
        if (reference) references.push(reference);
        start = i + 1;
      }
    }
    const links = references
      .map(reference => {
        const section = sectionById.get(reference);
        // Only exact indexed destinations become links. Ranges, table citations,
        // and unindexed suffixes retain the source text without a guessed target.
        if (!section) return `<span class="notation-source-reference">${esc(reference)}</span>`;
        const prefix = new RegExp(
          '^(?:(?:Chapter|Appendix)\\s+)?' + regexEscape(reference) + '(?=\\s|$)\\s*',
          'i'
        );
        const title = String(section.title || '').replace(prefix, '');
        const label = title ? `${reference} — ${title}` : reference;
        return `<button type="button" class="page-ref" data-open-section="${esc(reference)}" title="${esc(section.title || reference)}">${esc(label)}</button>`;
      })
      .join(' ');
    return `<div class="notation-section-links"><strong>Sections:</strong> ${links}</div>`;
  }

  function notationPresentation(type, item) {
    const definitions = notationDefinitions(item)
      .map(definition => {
        const label = definition.label
          ? `<strong class="notation-definition-label">${esc(definition.label)}</strong> `
          : '';
        const units =
          type === 'symbol' && String(definition.units || '').trim()
            ? `<p><strong>Usual units:</strong> ${notationValue(definition.units, definition.units_runs)}</p>`
            : '';
        return `<section class="notation-definition"><p>${label}${notationValue(definition.meaning, definition.meaning_runs)}</p>${units}${notationSectionLinks(definition.sections)}</section>`;
      })
      .join('');
    return `<div class="detail-text sci-rich notation-detail">${definitions}</div>`;
  }

  // There is one source reader: the primary PDF pane. Never instantiate a
  // second iframe inside a figure, equation or problem detail card.
  function sourcePreviews(type, page) {
    // Equation pages are already shown in the header and linked by Open in PDF.
    // Avoid a redundant source panel directly beneath the formula.
    if (!page || ['concept', 'symbol', 'abbreviation', 'chemical', 'equation'].includes(type))
      return '';
    return `<div class="source-inline-reference" role="note">PDF source · page ${page}</div>`;
  }

  function reviewedTablePart(label, page) {
    const regions = window.AtlasSourceRegions;
    const manifest = window.AtlasTableManifest;
    if (!regions?.matchesDocument(manifest, window.ATLAS_SOURCE_SHA256, C.meta.pdf_pages))
      return null;
    const parts = regions.findParts(manifest, label);
    return page == null ? parts?.[0] : parts?.find(part => part.page === page);
  }

  function sourcePdfY(page, top, fallback = 0) {
    if (Number.isFinite(top) && window.AtlasReader?.yFromTop)
      return window.AtlasReader.yFromTop(page, top);
    return Number(fallback) || 0;
  }

  function bindSourcePreviews(root) {
    root.querySelectorAll('.equation-detail-preview[data-equation-label]').forEach(holder => {
      fillEquationPreview(holder, holder.dataset.equationLabel);
    });
    root.querySelectorAll('.figure-detail-preview[data-figure-label]').forEach(holder => {
      window.AtlasFigurePreview?.mount(
        holder,
        holder.dataset.figureLabel,
        holder.dataset.figurePage
      );
    });
    root.querySelectorAll('.table-detail-preview[data-table-label]').forEach(holder => {
      window.AtlasTablePreview?.mount(holder, holder.dataset.tableLabel, holder.dataset.tablePage, {
        onPageChange: ({ page, y }) => {
          const sourceButton = root.querySelector('.detail-header [data-open-pdf]');
          if (!sourceButton) return;
          sourceButton.dataset.openPdf = String(page);
          const top = y ? undefined : reviewedTablePart(holder.dataset.tableLabel, page)?.crop[1];
          sourceButton.dataset.targetY = String(sourcePdfY(page, top, y));
          sourceButton.title = `Open this table page in PDF · page ${page}`;
        }
      });
    });
  }

  function showEntity(type, item, open = true, listContext = null) {
    document.dispatchEvent(new Event('atlas-before-navigation'));
    window.AtlasLayout?.atlasView();
    // Redrawing the same entry after bookmarking/note changes retains its list.
    // Every new navigation otherwise receives an explicit context or none.
    const context =
      !open && state.currentEntity?.type === type && state.currentEntity.item === item
        ? listContext || state.entryContext
        : listContext;
    state.entryContext =
      context?.type === type && Array.isArray(context.items) && context.items.includes(item)
        ? context
        : null;
    state.currentEntity = { type, item };
    const title = entityTitle(type, item);
    const categoryView = {
      section: 'book',
      figure: 'figures',
      table: 'tables',
      equation: 'equations',
      problem: 'problems',
      reference: 'references',
      concept: 'concepts',
      symbol: 'symbols',
      chemical: 'symbols',
      abbreviation: 'symbols'
    }[type];
    setActiveNav(categoryView || '');
    const categoryName =
      {
        section: 'Chapters',
        figure: 'Figures',
        table: 'Tables',
        equation: 'Equations',
        problem: 'Problems',
        reference: 'References',
        concept: 'Index',
        symbol: 'Symbols',
        chemical: 'Chemical species',
        abbreviation: 'Abbreviations'
      }[type] || 'Atlas';
    const text = entityText(type, item);
    const tablePart = type === 'table' ? reviewedTablePart(item.label) : null;
    const page = tablePart?.page || entityPage(type, item);
    const targetY = sourcePdfY(page, tablePart?.crop[1] ?? item.sourceTop, item.y);
    const sourceHTML = sourcePreviews(type, page);
    const key = noteKey(type, item);
    const note = user.notes[key] || '';
    const isBookmarked = isEntityBookmarked(type, item);
    let extras = '';

    if (type === 'section') {
      const children = (item.children || []).map(k => sectionByKey.get(k)).filter(Boolean);
      const relatedFigures = C.figures
        .filter(x => x.pdf_page >= item.pdf_page && x.pdf_page <= item.pdf_page_end)
        .slice(0, 10);
      const relatedEquations = C.equations
        .filter(x => x.pdf_page >= item.pdf_page && x.pdf_page <= item.pdf_page_end)
        .slice(0, 12);
      extras = `${children.length ? `<section class="section-block"><h3>Subsections</h3><div class="related-row">${children.map(s => `<button class="chip" data-entity-type="section" data-entity-key="${esc(s.key)}">${esc(s.title)}</button>`).join('')}</div></section>` : ''}
        ${relatedFigures.length ? `<section class="section-block"><h3>Figures in this span</h3><div class="related-row">${relatedFigures.map(x => `<button class="chip" data-related="figure" data-label="${esc(x.label)}">Fig. ${esc(x.label)}</button>`).join('')}</div></section>` : ''}
        ${relatedEquations.length ? `<section class="section-block"><h3>Equations in this span</h3><div class="related-row">${relatedEquations.map(x => `<button class="chip" data-related="equation" data-label="${esc(x.label)}">(${esc(x.label)})</button>`).join('')}</div></section>` : ''}`;
      const glossary = (C.abbreviations || [])
        .filter(a => {
          if (
            !a.abbr ||
            a.abbr.length < 2 ||
            a.abbr.length > 15 ||
            !a.meaning ||
            !a.sections ||
            !item.id
          )
            return false;
          const refs = String(a.sections).match(/(?:\d{1,2}|[A-C])\.\d+(?:\.\d+)?/g) || [];
          return refs.includes(String(item.id));
        })
        .slice(0, 10);
      if (glossary.length)
        extras += `<details class="source-glossary"><summary>Abbreviations referenced by this section <small>${glossary.length} from the imported book’s abbreviation tables</small></summary><dl>${glossary.map(a => `<div><dt>${esc(a.abbr)}</dt><dd>${sci(a.meaning)}</dd></div>`).join('')}</dl><p class="source-note">This is not an exhaustive list of symbols used by the section. Definitions come from your selected PDF.</p></details>`;
    } else if (type === 'concept') {
      const refs = item.pages
        .map(ref => {
          const n = firstNumericPage(ref);
          return n ? `<button class="page-ref" data-print-page="${n}">${esc(ref)}</button>` : '';
        })
        .join(' ');
      extras = `<section class="section-block"><h3>Indexed book pages</h3><div class="related-row">${refs || '<span class="muted">This is a cross-reference entry.</span>'}</div></section>`;
    }

    if (type === 'problem') {
      // Numbered equations printed as part of a problem are especially prone
      // to losing their fraction layout in text extraction. Reconstruct only
      // the formulas actually located on the problem's source page(s).
      const embedded = C.equations
        .filter(
          eq =>
            eq.pdf_page >= item.pdf_page &&
            eq.pdf_page <= item.pdf_page + 2 &&
            new RegExp('\\(' + regexEscape(eq.label) + '\\)').test(text)
        )
        .slice(0, 3);
      if (embedded.length)
        extras += `<section class="section-block problem-equations"><h3>Equations as printed in this problem</h3>
        ${embedded.map(eq => `<div class="problem-formula"><strong>(${esc(eq.label)})</strong> · Original PDF page ${eq.pdf_page}</div>`).join('')}
        <p class="source-note">Use View in main reader above for the original problem equations and mathematical formatting.</p></section>`;
    }

    const idxInfo = neighborInfo(type, item);
    const contextualSection =
      type === 'section'
        ? null
        : C.sections
            .filter(
              s =>
                s.kind === 'section' && Number(s.pdf_page) <= page && Number(s.pdf_page_end) >= page
            )
            .sort((a, b) => b.level - a.level)[0] || null;
    const contextualCrumb = contextualSection
      ? `<button type="button" class="context-section-crumb" data-entity-type="section" data-entity-key="${esc(contextualSection.key)}" title="Go to the containing book section">${esc(shorten(contextualSection.title, 42))}</button><span aria-hidden="true">›</span>`
      : '';
    const descriptionHTML =
      type === 'problem'
        ? problemPresentation(text)
        : type === 'equation'
          ? `<div id="equationVisual" class="equation-detail-preview" data-equation-label="${esc(item.label)}" role="status"><span class="formula-status">Rendering equation…</span></div>`
          : type === 'figure'
            ? `<div class="figure-detail-preview${item.source_part ? ' figure-part-preview' : ''}" data-figure-label="${esc(item.label)}" data-figure-page="${Number(item.pdf_page) || 0}" role="status">Locating figure…</div>${sourceTextPresentation(type, text)}`
            : type === 'table'
              ? `<div class="table-detail-preview" data-table-label="${esc(item.label)}" data-table-page="${Number(item.pdf_page) || 0}" role="region" aria-label="Table preview">Loading table…</div>${sourceTextPresentation(type, text)}`
              : ['symbol', 'abbreviation'].includes(type)
                ? notationPresentation(type, item)
                : sourceTextPresentation(
                    type,
                    text ||
                      'This heading introduces the subsections below. Open the linked book page for the full treatment.'
                  );
    content.innerHTML = `
      <article>
        <header class="detail-header">
          <nav class="atlas-detail-crumb" aria-label="Current section">${categoryView ? `<button type="button" data-return-catalog="${categoryView}" title="Return to ${categoryName}, preserving its filter when possible">${categoryName}</button><span aria-hidden="true">›</span>` : ''}${contextualCrumb}<span class="sci-rich">${sci(shorten(title, 88), { mode: type === 'reference' ? 'reference' : 'prose' })}</span></nav>
          <h1 class="sci-rich">${['symbol', 'abbreviation', 'chemical'].includes(type) ? notationValue(item.symbol || item.abbr, item.symbol_runs || item.abbr_runs, 'identifier') : sci(title, { mode: type === 'reference' ? 'reference' : 'prose' })}</h1>
          <div class="detail-meta">${page ? `<span>${esc(pageLabel(page))}</span>` : ''}${type === 'section' && item.pdf_page_end > item.pdf_page ? `<span>through PDF ${item.pdf_page_end}</span>` : ''}</div>
          <div class="button-row">${page ? `<button class="primary" data-open-pdf="${page}" data-source-focus="${type === 'equation' ? 'true' : 'false'}" data-target-y="${targetY}">Open in PDF</button>` : ''}<button class="secondary" id="bookmarkEntity">${isBookmarked ? '★ Bookmarked' : '☆ Bookmark'}</button>${type === 'section' ? `<button class="secondary" id="markRead">${user.read[item.key] ? '✓ Read' : 'Mark read'}</button>` : ''}</div>
        </header>
        ${idxInfo.total > 1 ? `<nav class="atlas-entry-pager" aria-label="Browse ${categoryName.toLowerCase()}"><button type="button" id="prevEntity" ${idxInfo.prev ? `title="${esc(entityTitle(type, idxInfo.prev))}"` : 'disabled'}>← Previous</button><span class="atlas-entry-position">${idxInfo.position.toLocaleString()} of ${idxInfo.total.toLocaleString()}${idxInfo.filtered ? ` matching ${categoryName.toLowerCase()}` : ''}</span><button type="button" id="nextEntity" ${idxInfo.next ? `title="${esc(entityTitle(type, idxInfo.next))}"` : 'disabled'}>Next →</button></nav>` : ''}
        <section class="detail-card">${descriptionHTML}${sourceHTML}${extras}<div class="note-box"><strong>Your note</strong><textarea id="entityNote" placeholder="Add a private note about this entry…" aria-describedby="noteSaveStatus">${esc(note)}</textarea><small id="noteSaveStatus" role="status">${window.ATLAS_TEMP_STORAGE ? 'Saved for this session only. Export a backup before closing.' : 'Automatically saved on this device as you type.'}</small></div></section>
      </article>`;

    // Keep Explore/Read/Together modes stable while browsing entries.
    // Synchronize the PDF if it is already visible; Open in book explicitly
    // brings it forward instead of unexpectedly changing the user's layout.
    if (open && page)
      openPdf(page, title, {
        targetY,
        reveal: !document.body.classList.contains('layout-no-book'),
        remember: false
      });
    if (window.innerWidth < 800) window.AtlasLayout?.atlasView();
    bindCommonActions(content);
    const returnCatalog = content.querySelector('[data-return-catalog]');
    returnCatalog?.addEventListener('click', () => {
      const view = returnCatalog.dataset.returnCatalog;
      if (!window.AtlasNavigation?.returnToCategory?.(view)) goView(view);
    });
    bindSourcePreviews(content);
    // Source-derived equations load automatically. The publisher PDF remains authoritative.
    $('#bookmarkEntity').addEventListener('click', () => toggleEntityBookmark(type, item));
    if ($('#markRead')) $('#markRead').addEventListener('click', () => markSectionRead(item));
    $('#entityNote').addEventListener('input', () => {
      const v = $('#entityNote').value;
      if (v.trim()) user.notes[key] = v;
      else delete user.notes[key];
      saveUser();
      $('#noteSaveStatus').textContent = window.ATLAS_TEMP_STORAGE
        ? 'Session only — export a backup before closing.'
        : 'Saved automatically';
    });
    if ($('#prevEntity'))
      $('#prevEntity').addEventListener('click', () =>
        showEntity(type, idxInfo.prev, true, state.entryContext)
      );
    if ($('#nextEntity'))
      $('#nextEntity').addEventListener('click', () =>
        showEntity(type, idxInfo.next, true, state.entryContext)
      );
    $$('[data-related]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const list = btn.dataset.related === 'figure' ? C.figures : C.equations;
        const found = list.find(x => x.label === btn.dataset.label);
        if (found) showEntity(btn.dataset.related, found);
      })
    );
    $$('[data-print-page]', content).forEach(btn =>
      btn.addEventListener('click', () => openPdf(pdfFromPrinted(btn.dataset.printPage), title))
    );
    content.scrollTop = 0;
    signalLocation({ kind: 'entity', type, item, context: state.entryContext });
    if (open) focusViewHeading();
  }

  function entityTitle(type, item) {
    if (type === 'section') return item.title;
    if (type === 'reference') return item.title;
    if (type === 'concept') return item.parent ? `${item.parent} › ${item.term}` : item.term;
    if (type === 'symbol') return `${item.symbol} — ${item.meaning}`;
    if (type === 'abbreviation' || type === 'chemical') return `${item.abbr} — ${item.meaning}`;
    return item.title || item.label || item.term || 'Entry';
  }

  function entityText(type, item) {
    if (type === 'section') return item.excerpt;
    if (type === 'figure' || type === 'table') return item.description || item.caption;
    if (type === 'equation') return item.context;
    if (type === 'problem')
      return String(item.text || '').replace(
        new RegExp('^' + regexEscape(item.label) + '\\s+'),
        ''
      );
    if (type === 'reference') return item.text;
    if (type === 'concept')
      return (
        item.see ||
        `Editorial index entry${item.pages.length ? ` with page references ${item.pages.join(', ')}` : ''}.`
      );
    if (type === 'symbol')
      return `${item.meaning}${item.units ? `\n\nUsual units: ${item.units}` : ''}${item.sections ? `\n\nSections: ${item.sections}` : ''}`;
    if (type === 'abbreviation')
      return `${item.meaning}${item.sections ? `\n\nSections: ${item.sections}` : ''}`;
    if (type === 'chemical')
      return `${item.meaning}${item.structure_ref ? `\n\nStructure reference: ${item.structure_ref}` : ''}`;
    return '';
  }

  function entityPage(type, item) {
    if (type === 'concept')
      return item.pages.length ? pdfFromPrinted(firstNumericPage(item.pages[0])) : item.pdf_page;
    return item.sourcePage || item.pdf_page || null;
  }

  function neighborInfo(type, item, context = state.entryContext) {
    let list = [];
    if (type === 'section') list = C.sections;
    else if (type === 'figure') list = C.figures;
    else if (type === 'table') list = C.tables;
    else if (type === 'equation') list = C.equations;
    else if (type === 'problem') list = C.problems;
    else if (type === 'reference') list = C.references;
    else if (type === 'concept') list = C.index;
    else if (type === 'symbol') list = C.symbols;
    else if (type === 'abbreviation') list = C.abbreviations;
    else if (type === 'chemical') list = C.chemicals;
    const contextual =
      context?.type === type && Array.isArray(context.items) && context.items.includes(item);
    if (contextual) list = context.items;
    const idx = list.indexOf(item);
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
      position: idx >= 0 ? idx + 1 : 0,
      total: list.length,
      filtered: Boolean(contextual && context.filtered)
    };
  }

  function openSection(id) {
    const item = sectionById.get(String(id).replace(/^§/, ''));
    if (item) showEntity('section', item);
    else {
      searchInput.value = id;
      runSearch(id, 'sections');
    }
  }

/* src/client/application/70-search.js */
  function runSearch(query = searchInput.value, scope = searchScope.value, page = 0, options = {}) {
    query = query.trim();
    if (!query) {
      goView('home');
      return;
    }
    // Paging and history restoration keep the same submitted query; they must
    // not replace a user's newer Recently Viewed entries with that old search.
    if (options.record !== false)
      document.dispatchEvent(
        new CustomEvent('atlas-search-committed', { detail: { query, scope } })
      );
    searchInput.value = query;
    searchScope.value = scope;
    const command = parseSearchCommand(query);
    if (command) {
      // A page command changes the PDF pane while the current Atlas detail
      // remains visible, including its filtered Previous/Next context.
      if (command.type === 'pdf') openPdf(command.page, `Direct page command: ${query}`);
      else if (command.type === 'section') showEntity('section', command.item);
      return;
    }
    document.dispatchEvent(new Event('atlas-before-navigation'));
    state.view = 'search';
    state.currentEntity = null;
    state.entryContext = null;
    window.AtlasLayout?.atlasView();
    setActiveNav('');

    const results = searchAll(query, scope);
    const pageSize = 50;
    const pages = Math.max(1, Math.ceil(results.length / pageSize));
    state.searchPage = Math.max(0, Math.min(pages - 1, Number.isInteger(page) ? page : 0));
    const start = state.searchPage * pageSize;
    const shown = results.slice(start, start + pageSize);
    const range = results.length
      ? `${(start + 1).toLocaleString()}–${(start + shown.length).toLocaleString()} of ${results.length.toLocaleString()} results`
      : '0 results';
    content.innerHTML = `
      <header class="view-header"><div class="eyebrow">Global search</div><h1>Results for “${esc(query)}”</h1><p>Ranked across structured entries and the full book text.</p></header>
      <div class="search-summary" role="status">${range} · scope: ${esc(scope)}</div>
      <div class="result-list">${shown.map((r, i) => searchResultCard(r, query, start + i)).join('') || '<div class="empty">No results. Try fewer words, a section number such as 7.2.2, an equation number, or a broader search scope.</div>'}</div>
      ${paginationHTML(state.searchPage, pages)}`;
    $$('[data-search-index]', content).forEach(btn =>
      btn.addEventListener('click', () => {
        const r = results[Number(btn.dataset.searchIndex)];
        if (r.entity) showEntity(r.type, r.entity);
        else openPdf(r.page, r.title);
      })
    );
    bindPagination(
      () => runSearch(query, scope, state.searchPage, { record: false }),
      pages,
      'searchPage'
    );
    content.scrollTop = 0;
    signalLocation({ kind: 'search', query, scope, page: state.searchPage });
  }

  function parseSearchCommand(q) {
    let m = q.match(/^pdf\s*(?:page)?\s*(\d{1,4})$/i);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= C.meta.pdf_pages)
      return { type: 'pdf', page: Number(m[1]) };
    const roman = q.match(/^(?:book\s*)?p(?:age)?\.?\s*([ivxlcdm]+)$/i);
    if (roman) {
      const ix = window.ATLAS_READER_META.labels.findIndex(
        l => String(l).toLowerCase() === roman[1].toLowerCase()
      );
      if (ix >= 0) return { type: 'pdf', page: ix + 1 };
    }
    m = q.match(/^(?:book\s*)?(?:p(?:age)?\.?\s*)?(\d{1,4})$/i);
    if (m && window.ATLAS_READER_META?.labels?.includes(String(Number(m[1]))))
      return { type: 'pdf', page: pdfFromPrinted(Number(m[1])) };
    const clean = q.replace(/^(?:section|§)\s*/i, '').trim();
    if (sectionById.has(clean)) return { type: 'section', item: sectionById.get(clean) };
    return null;
  }

  function searchAll(query, scope) {
    const qn = norm(query);
    const terms = qn.split(/\s+/).filter(Boolean);
    const results = [];
    const addStructured = (type, list, titleFn, textFn) => {
      list.forEach(item => {
        const title = titleFn(item);
        const text = textFn(item) || '';
        const hayTitle = norm(title),
          hay = norm(`${title} ${text}`);
        if (!terms.every(t => hay.includes(t))) return;
        let score = 50;
        if (hayTitle === qn) score += 120;
        else if (hayTitle.startsWith(qn)) score += 75;
        else if (hayTitle.includes(qn)) score += 45;
        score += terms.reduce((s, t) => s + Math.min(20, countOccurrences(hay, t) * 3), 0);
        results.push({ type, entity: item, title, text, page: entityPage(type, item), score });
      });
    };

    if (scope === 'all' || scope === 'sections')
      addStructured(
        'section',
        C.sections,
        x => x.title,
        x => x.excerpt
      );
    if (scope === 'all' || scope === 'figures')
      addStructured(
        'figure',
        C.figures,
        x => x.title,
        x => x.caption
      );
    if (scope === 'all' || scope === 'tables')
      addStructured(
        'table',
        C.tables,
        x => x.title,
        x => x.caption
      );
    if (scope === 'all' || scope === 'equations')
      addStructured(
        'equation',
        C.equations,
        x => x.title,
        x => x.context
      );
    if (scope === 'all' || scope === 'problems')
      addStructured(
        'problem',
        C.problems,
        x => x.title,
        x => x.text
      );
    if (scope === 'all' || scope === 'references')
      addStructured(
        'reference',
        C.references,
        x => x.title,
        x => x.text
      );
    if (scope === 'all' || scope === 'glossary' || scope === 'concepts')
      addStructured(
        'concept',
        C.index,
        x => (x.parent ? `${x.parent} › ${x.term}` : x.term),
        x => `${x.see} ${x.pages.join(' ')}`
      );
    if (scope === 'all' || scope === 'glossary' || scope === 'symbols') {
      addStructured('abbreviation', C.abbreviations, x => x.abbr, notationDefinitionText);
      addStructured(
        'chemical',
        C.chemicals,
        x => x.abbr,
        x => `${x.meaning} ${x.structure_ref}`
      );
      addStructured('symbol', C.symbols, x => x.symbol, notationDefinitionText);
    }
    if (scope === 'all' || scope === 'pages') {
      PAGES.forEach(page => {
        const hay = page._norm || (page._norm = norm(page.text));
        if (!terms.every(t => hay.includes(t))) return;
        const occurrences = terms.reduce((s, t) => s + countOccurrences(hay, t), 0);
        results.push({
          type: 'page',
          entity: null,
          title: `${pageLabel(page.pdf_page)}${page.section ? ` · §${page.section}` : ''}`,
          text: snippet(page.text, terms),
          page: page.pdf_page,
          score: 30 + Math.min(60, occurrences * 4)
        });
      });
    }
    // The full results view paginates this complete list. Inline suggestions
    // apply their own small display limit in navigation/controller.js.
    return results.sort((a, b) => b.score - a.score || (a.page || 9999) - (b.page || 9999));
  }

  function countOccurrences(hay, needle) {
    if (!needle) return 0;
    let count = 0,
      pos = 0;
    while ((pos = hay.indexOf(needle, pos)) >= 0 && count < 20) {
      count++;
      pos += needle.length;
    }
    return count;
  }

  function snippet(text, terms, length = 330) {
    if (!text) return '';
    const n = norm(text);
    let idx = Infinity;
    terms.forEach(t => {
      const p = n.indexOf(t);
      if (p >= 0) idx = Math.min(idx, p);
    });
    if (!Number.isFinite(idx)) idx = 0;
    const start = Math.max(0, idx - 90);
    return `${start ? '…' : ''}${text.slice(start, start + length)}${start + length < text.length ? '…' : ''}`;
  }

  function searchResultCard(r, query, index) {
    const preview =
      r.type === 'section' && r.entity
        ? sectionPreview(r.entity, 420)
        : shorten(
            (r.type === 'figure' || r.type === 'table') && r.entity
              ? r.entity.description || r.text
              : r.text,
            420
          );
    return `<button class="result-card" data-search-index="${index}"><div class="result-top"><span class="result-title">${highlight(r.title, query, r.type === 'reference' ? 'reference' : 'prose')}</span><span class="page-label">${r.page ? esc(pageLabel(r.page)) : ''}</span></div><div class="result-snippet sci-rich">${highlight(preview, query, r.type === 'reference' ? 'reference' : 'prose')}</div><span class="badge">${esc(r.type)}</span></button>`;
  }

  function highlight(text, query, mode = 'prose') {
    // The formula must be formatted as a whole BEFORE search hits are marked.
    // Formatting each highlighted substring separately used to cut chemical
    // formulas across <mark> tags, losing their subscripts and charges.
    if (window.AtlasScience?.highlight) return window.AtlasScience.highlight(text, query, { mode });
    return sci(text, { mode });
  }

/* src/client/application/80-events.js */
  function openStudyPath(id) {
    goView('paths');
    renderPaths(id);
  }

  function bindCommonActions(root) {
    $$('[data-view-target]', root).forEach(btn =>
      btn.addEventListener('click', () => goView(btn.dataset.viewTarget))
    );
    $$('[data-open-section]', root).forEach(btn =>
      btn.addEventListener('click', () => openSection(btn.dataset.openSection))
    );
    $$('[data-open-path]', root).forEach(btn =>
      btn.addEventListener('click', () => openStudyPath(btn.dataset.openPath))
    );
    $$('[data-open-pdf]', root).forEach(btn =>
      btn.addEventListener('click', () =>
        openPdf(
          Number(btn.dataset.openPdf),
          state.currentEntity
            ? entityTitle(state.currentEntity.type, state.currentEntity.item)
            : 'Book page',
          {
            targetY:
              btn.dataset.targetY != null
                ? Number(btn.dataset.targetY)
                : state.currentEntity?.item?.y || 0,
            preferRead: btn.dataset.sourceFocus === 'true',
            snap: true
          }
        )
      )
    );
    bindEntityButtons(root);
  }

  function bindEntityButtons(root) {
    $$('[data-entity-type="section"]', root).forEach(btn =>
      btn.addEventListener('click', () => {
        const item = sectionByKey.get(btn.dataset.entityKey);
        if (item) showEntity('section', item);
      })
    );
  }

  function initEvents() {
    $('#mainNav').addEventListener('click', e => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      goView(btn.dataset.view);
    });
    $('#homeButton').addEventListener('click', () => goView('home'));
    searchInput.addEventListener('focus', () => {
      if (!window.AtlasNavigation?.inlineSearch) window.AtlasNavigation?.open(searchInput.value);
    });
    searchInput.addEventListener(
      'input',
      debounce(() => {
        if (window.AtlasNavigation?.inlineSearch) return;
        if (window.AtlasNavigation) window.AtlasNavigation.open(searchInput.value);
        else runSearch();
      }, 220)
    );
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !window.AtlasNavigation?.inlineSearch) {
        e.preventDefault();
        runSearch();
      }
    });
    searchScope.addEventListener('change', () => {
      if (searchInput.value.trim()) runSearch();
    });
    $('#themeToggle').addEventListener('click', () =>
      applyTheme(user.theme === 'dark' ? 'light' : 'dark')
    );
    $('#beginnerToggle').addEventListener('click', toggleGuide);
    $('#openCurrentExternal').addEventListener('click', () => openExternal());
    $('#fallbackOpen').addEventListener('click', () => openExternal());
    $('#readerPrev').addEventListener('click', () =>
      openPdf(state.readerPage - 1, 'Previous PDF page')
    );
    $('#readerNext').addEventListener('click', () =>
      openPdf(state.readerPage + 1, 'Next PDF page')
    );
    $('#readerBack').addEventListener('click', () => readerHistory(-1));
    $('#readerForward').addEventListener('click', () => readerHistory(1));
    readerPageInput.addEventListener('change', () =>
      openPdf(Number(readerPageInput.value), 'Direct PDF page')
    );
    readerPageInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') openPdf(Number(readerPageInput.value), 'Direct PDF page');
    });
    $('#bookmarkPage').addEventListener('click', () => togglePageBookmark());
    $('#importNotesFile').addEventListener('change', e => {
      if (e.target.files[0]) importUserData(e.target.files[0]);
      e.target.value = '';
    });
    document.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]')) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        window.AtlasNavigation ? window.AtlasNavigation.open() : searchInput.focus();
      } else if (e.key === '[' && !typing) openPdf(state.readerPage - 1, 'Previous PDF page');
      else if (e.key === ']' && !typing) openPdf(state.readerPage + 1, 'Next PDF page');
      else if ((e.key === 'b' || e.key === 'B') && !typing) togglePageBookmark();
      else if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.blur();
      }
    });
    // No page URL hashing is required: the user's PDF is held in memory only.
  }

  function init() {
    initializeSavedEntries();
    applyTheme(user.theme);
    state.guideMode = user.guide;
    document.body.classList.toggle('guide-mode', state.guideMode);
    $('#beginnerToggle').classList.remove('active');
    initEvents();
    state.resumePage = loadResumePage();
    renderHome();
    openPdf(state.resumePage, 'Your imported PDF');
    booting = false;
    signalLocation({ kind: 'view', view: 'home' });
    if (window.ATLAS_TEMP_STORAGE) {
      const notice = document.createElement('p');
      notice.className = 'info-card';
      notice.textContent =
        'This browser has disabled local saving. Reading and search still work. Export your notes before closing the app.';
      $('#sidebar').appendChild(notice);
    }
  }

  window.AtlasApp = {
    goView,
    openSection,
    showEntity,
    runSearch,
    searchAll,
    openPdf,
    entityKey,
    entitySourceId,
    resolveEntityBookmark,
    parseSearchCommand,
    sectionById,
    studyPaths: STUDY_PATHS,
    openStudyPath,
    state,
    user
  };
  init();
})();
