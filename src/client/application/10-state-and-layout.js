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
