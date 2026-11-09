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
