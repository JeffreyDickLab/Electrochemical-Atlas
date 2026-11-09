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
