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
