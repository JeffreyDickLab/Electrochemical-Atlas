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

    const filterInput = $('#collectionFilter');
    filterInput.addEventListener(
      'input',
      debounce(() => {
        if (!filterInput.isConnected) return;
        const restoreFocus = document.activeElement === filterInput;
        const { selectionStart, selectionEnd, selectionDirection } = filterInput;
        const scroll = content.scrollTop;
        state.collectionFilter = filterInput.value;
        state.collectionPage = 0;
        renderCollection(name);
        content.scrollTop = scroll;
        if (restoreFocus) {
          // Restore the selection before the next keyboard event can run.
          const replacement = $('#collectionFilter');
          replacement.focus({ preventScroll: true });
          replacement.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
        }
      }, 120)
    );
    $('#collectionChapter').addEventListener('change', e => {
      state.collectionFilter = filterInput.value;
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
