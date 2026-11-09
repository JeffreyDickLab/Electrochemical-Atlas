/* Browse level of the shared navigation sidebar. It is built exclusively from
 * the current user's in-memory PDF import; nothing is prepackaged. */
(() => {
  'use strict';
  const app = window.AtlasApp,
    cat = window.ATLAS_CATALOG,
    workspace = window.AtlasLayout;
  if (!app || !cat) return;
  const $ = id => document.getElementById(id),
    rail = $('catalogRail'),
    nav = $('mainNav');
  const list = $('catalogRailList'),
    select = $('catalogRailType'),
    filter = $('catalogRailFilter'),
    counter = $('catalogRailCount'),
    more = $('catalogRailMore');
  const allowed = ['figures', 'tables', 'equations', 'problems', 'references'];
  const storage = {
    get: (k, d) => {
      try {
        return localStorage.getItem(k) ?? d;
      } catch (_) {
        return d;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, String(v));
      } catch (_) {}
    }
  };
  const clean = s =>
    String(s ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const esc = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const typeName = {
    figures: 'Figure',
    tables: 'Table',
    equations: 'Equation',
    problems: 'Problem',
    references: 'Reference'
  };
  let type = allowed.includes(storage.get('ea_list_type', ''))
    ? storage.get('ea_list_type', 'figures')
    : 'figures';
  // Start with the direct catalog buttons visible. The optional Shift+L list
  // remembers its category, but never replaces the main menu on a new session.
  let enabled = false;
  let shown = 160,
    filtered = [];
  const fullIndexButton = $('catalogRailOpenIndex');
  // Menu and Browse are two levels inside one sidebar. No second column or
  // divider: AtlasLayout owns the shared navWidth and
  // #navDivider, including pointer/keyboard resizing and persistence.
  function configureOpen(open, { keepSidebar = true } = {}) {
    const next = Boolean(open);
    if (next) {
      if (document.body.classList.contains('layout-no-atlas')) workspace?.atlasView();
      if (document.body.classList.contains('layout-no-nav')) workspace?.toggleNav();
    }
    enabled = next;
    rail.hidden = !enabled;
    nav.hidden = enabled;
    document.body.classList.toggle('atlas-list-active', enabled);
    if (enabled) render();
    else if (!keepSidebar && !document.body.classList.contains('layout-no-nav')) {
      workspace?.toggleNav();
    }
  }
  function labelOf(item) {
    return type === 'references' ? `${item.chapter}.${item.number}` : item.label;
  }
  function snippet(item) {
    return type === 'references'
      ? item.text
      : type === 'equations'
        ? item.section_title || item.context
        : type === 'problems'
          ? item.description || item.text
          : item.caption || item.description || '';
  }
  function relativeCurrent() {
    const d = app.state.currentEntity;
    if (!d) return null;
    const listName = {
      figure: 'figures',
      table: 'tables',
      equation: 'equations',
      problem: 'problems',
      reference: 'references'
    }[d.type];
    return listName === type ? d.item : null;
  }
  function recalc() {
    const q = clean(filter.value.trim());
    const arr = cat[type] || [];
    const numbered = /^(?:[a-c]\.)?\d+(?:\.\d+)*[a-z]?$/i.test(q);
    filtered = !q
      ? arr
      : arr.filter(item =>
          numbered
            ? clean(labelOf(item)).startsWith(q)
            : clean(labelOf(item) + ' ' + snippet(item)).includes(q)
        );
    shown = 160;
  }
  function render(reset = false) {
    if (!enabled) return;
    if (reset) recalc();
    const current = relativeCurrent(),
      page = filtered.slice(0, shown);
    list.innerHTML =
      page
        .map((item, i) => {
          const label = labelOf(item);
          const description = snippet(item).replace(/\s+/g, ' ').trim();
          const excerpt =
            description.length > 105 ? description.slice(0, 102).trim() + '…' : description;
          return `<button type="button" class="catalog-rail-entry${current === item ? ' current' : ''}" data-rail-index="${i}" ${current === item ? 'aria-current="true"' : ''} title="Open ${esc(typeName[type])} ${esc(label)}"><span class="catalog-entry-number">${esc(label)}</span><span class="catalog-entry-description sci-rich">${window.AtlasScience?.html(excerpt) || esc(excerpt)}</span></button>`;
        })
        .join('') || '<p class="catalog-rail-empty">No matching entries.</p>';
    counter.textContent = filtered.length.toLocaleString() + ' ' + type;
    more.hidden = shown >= filtered.length;
    more.textContent = `Show next ${Math.min(160, filtered.length - shown)} entries`;
    select.value = type;
    fullIndexButton.title = `Open the full ${type} index in Atlas`;
    fullIndexButton.setAttribute('aria-label', fullIndexButton.title);
  }
  $('closeCatalogRail').addEventListener('click', () => {
    configureOpen(false, { keepSidebar: true });
    nav.querySelector(`[data-view="${type}"]`)?.focus({ preventScroll: true });
  });
  fullIndexButton.addEventListener('click', () => {
    app.goView(type);
    if (window.innerWidth < 800) {
      configureOpen(false, { keepSidebar: true });
    }
  });
  select.addEventListener('change', () => {
    type = select.value;
    storage.set('ea_list_type', type);
    filter.value = '';
    recalc();
    list.scrollTop = 0;
    render();
  });
  filter.addEventListener('input', () => {
    recalc();
    list.scrollTop = 0;
    render();
  });
  list.addEventListener('click', e => {
    const entry = e.target.closest('[data-rail-index]');
    if (!entry) return;
    const item = filtered[Number(entry.dataset.railIndex)];
    if (!item) return;
    const singular = type === 'references' ? 'reference' : type.slice(0, -1);
    app.showEntity(singular, item);
    if (window.innerWidth < 800) {
      configureOpen(false, { keepSidebar: true });
    }
  });
  more.addEventListener('click', () => {
    const last = list.scrollTop;
    shown += 160;
    render();
    list.scrollTop = last;
  });
  document.addEventListener('atlas-location', e => {
    const d = e.detail || {};
    const next =
      d.kind === 'view'
        ? d.view
        : d.kind === 'entity'
          ? {
              figure: 'figures',
              table: 'tables',
              equation: 'equations',
              problem: 'problems',
              reference: 'references'
            }[d.type]
          : null;
    if (next && allowed.includes(next) && next !== type) {
      type = next;
      storage.set('ea_list_type', type);
      filter.value = '';
      recalc();
      list.scrollTop = 0;
      render();
    } else if (enabled && next) render();
  });
  document.addEventListener('keydown', e => {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'l') return;
    const active = document.activeElement;
    if (/INPUT|TEXTAREA|SELECT/.test(active?.tagName) || document.querySelector('dialog[open]'))
      return;
    e.preventDefault();
    configureOpen(!enabled);
  });
  // Independent layout actions that hide Atlas or the sidebar must return
  // Browse to Menu so the selected level is never an invisible pane.
  new MutationObserver(() => {
    if (
      enabled &&
      (document.body.classList.contains('layout-no-atlas') ||
        document.body.classList.contains('layout-no-nav'))
    )
      configureOpen(false, { keepSidebar: true });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !enabled || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('#globalSearch,#atlasCommandPalette,#catalogRailFilter')) return;
    // Escape returns to Menu without collapsing the shared column.
    configureOpen(false, { keepSidebar: true });
  });
  // Avoid the large 2,000-item DOM unless the user chooses Browse.
  recalc();
  configureOpen(enabled, { keepSidebar: true });
  window.AtlasCatalogRail = {
    open: configureOpen,
    isOpen: () => enabled,
    setType: t => {
      if (allowed.includes(t)) {
        type = t;
        select.value = t;
        storage.set('ea_list_type', t);
        filter.value = '';
        recalc();
        render();
      }
    }
  };
})();
