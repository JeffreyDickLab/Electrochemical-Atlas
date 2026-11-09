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
