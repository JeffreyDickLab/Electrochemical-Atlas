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
