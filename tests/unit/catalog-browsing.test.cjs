'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const text = require('../../src/client/core/text.js');
const science = require('../../src/client/science/notation.js');

// A small event boundary for the actual renderers. It does not emulate layout,
// browser focus traversal, native PDF viewing or canvas rendering.
function harness(overrides = {}, pages = []) {
  const C = {
    meta: { pdf_pages: 1200 },
    sections: [],
    figures: [],
    tables: [],
    equations: [],
    problems: [],
    references: [],
    symbols: [],
    abbreviations: [],
    chemicals: [],
    index: [],
    ...overrides
  };
  const state = {
    collectionPage: 0,
    collectionFilter: '',
    collectionChapter: '',
    searchPage: 0,
    currentEntity: null,
    entryContext: null
  };
  const document = new EventTarget();
  document.body = { classList: { contains: () => false } };
  const locations = [],
    pdf = [],
    committed = [];
  document.addEventListener('atlas-search-committed', event => committed.push(event.detail));
  let markup = '',
    controls = new Map(),
    buttons = [];
  function control(attributes) {
    const listeners = new Map();
    const dataset = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith('data-'))
        dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return {
      attributes,
      dataset,
      value: attributes.value || '',
      selectionStart: 0,
      textContent: '',
      disabled: Object.hasOwn(attributes, 'disabled'),
      addEventListener: (name, listener) => listeners.set(name, listener),
      fire(name) {
        assert.ok(listeners.has(name), `The renderer did not bind ${name}`);
        if (name === 'click' && this.disabled) return;
        listeners.get(name)({ target: this });
      },
      focus() {
        this.focused = true;
      },
      setSelectionRange(start, end) {
        this.selection = [start, end];
      }
    };
  }
  function query(selector) {
    if (selector.startsWith('#')) return controls.get(selector.slice(1)) || null;
    const key = selector
      .match(/\[data-([a-z-]+)/)?.[1]
      ?.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return key ? buttons.find(button => Object.hasOwn(button.dataset, key)) || null : null;
  }
  function queryAll(selector) {
    if (selector === '.pagination button')
      return buttons.filter(button => Object.hasOwn(button.dataset, 'page'));
    const key = selector
      .match(/^\[data-([a-z-]+)/)?.[1]
      ?.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return key ? buttons.filter(button => Object.hasOwn(button.dataset, key)) : [];
  }
  const content = {
    scrollTop: 0,
    set innerHTML(value) {
      markup = value;
      controls = new Map();
      buttons = [];
      for (const [tag, kind] of markup.matchAll(/<(button|input|select|textarea)\b[^>]*>/g)) {
        const attributes = Object.fromEntries(
          [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, v]) => [name, v])
        );
        if (/\sdisabled(?:\s|>)/.test(tag)) attributes.disabled = '';
        const node = control(attributes);
        if (attributes.id) controls.set(attributes.id, node);
        if (kind === 'button') buttons.push(node);
      }
    },
    get innerHTML() {
      return markup;
    },
    querySelector: query,
    querySelectorAll: queryAll
  };
  const context = vm.createContext({
    C,
    PAGES: pages,
    state,
    document,
    Event,
    CustomEvent,
    content,
    window: {
      innerWidth: 1200,
      AtlasScience: science,
      AtlasLayout: { atlasView() {} },
      ATLAS_READER_META: { labels: [] }
    },
    user: { notes: {}, read: {} },
    searchInput: { value: '' },
    searchScope: { value: 'all' },
    sectionById: new Map(C.sections.map(section => [String(section.id), section])),
    sectionByKey: new Map(C.sections.map(section => [section.key, section])),
    esc: text.escapeHtml,
    norm: text.normalize,
    regexEscape: text.regexEscape,
    shorten: text.shorten,
    sci: science.html,
    $: query,
    $$: queryAll,
    debounce: callback => callback,
    requestAnimationFrame: callback => callback(),
    setActiveNav() {},
    focusViewHeading() {},
    goView() {},
    noteKey: (type, item) => type + '-' + item.label,
    isEntityBookmarked: () => false,
    toggleEntityBookmark() {},
    bindCommonActions() {},
    saveUser() {},
    pageLabel: number => `PDF ${number}`,
    firstNumericPage: Number,
    pdfFromPrinted: Number,
    openPdf: (...args) => pdf.push(args),
    signalLocation: detail => locations.push(detail)
  });
  for (const name of ['30-discovery.js', '40-catalog.js', '60-entity-details.js', '70-search.js']) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '../../src/client/application', name), 'utf8'),
      context,
      { filename: name }
    );
  }
  return {
    context,
    state,
    C,
    content,
    committed,
    locations,
    pdf,
    get buttons() {
      return buttons;
    },
    get controls() {
      return controls;
    },
    get markup() {
      return markup;
    }
  };
}

test('full search exposes every match across pages, with correct original result destinations', () => {
  const pages = Array.from({ length: 221 }, (_, i) => ({
    pdf_page: i + 1,
    text: 'needle example'
  }));
  const h = harness({}, pages);
  assert.equal(h.context.searchAll('needle', 'pages').length, 221);
  h.context.runSearch('needle', 'pages');
  assert.match(h.markup, /1–50 of 221 results/);
  assert.equal(h.buttons.filter(button => 'searchIndex' in button.dataset).length, 50);
  assert.equal(h.committed.length, 1);
  h.buttons.find(button => button.dataset.page === '1').fire('click');
  assert.equal(h.state.searchPage, 1);
  assert.match(h.markup, /51–100 of 221 results/);
  assert.equal(h.committed.length, 1, 'paging must not record another recent search');
  assert.equal(h.locations.at(-1).page, 1);

  const seen = new Set();
  for (let page = 0; page < 5; page++) {
    h.context.runSearch('needle', 'pages', page, { record: false });
    for (const button of h.buttons.filter(button => 'searchIndex' in button.dataset)) {
      const index = Number(button.dataset.searchIndex);
      assert.ok(!seen.has(index), `result ${index} appears on two pages`);
      seen.add(index);
    }
  }
  assert.equal(seen.size, 221);
  assert.match(h.markup, /201–221 of 221 results/);
  h.buttons.find(button => button.dataset.searchIndex === '217').fire('click');
  assert.equal(h.pdf.at(-1)[0], 218);
  assert.equal(h.committed.length, 1);
});

test('search keeps scope and ranking, and safely clamps stale result pages', () => {
  const h = harness({
    figures: [
      { label: '1', title: 'Needle', caption: 'entry', pdf_page: 50 },
      { label: '2', title: 'A needle example', caption: 'entry', pdf_page: 10 }
    ],
    tables: [{ label: '1', title: 'Needle', caption: '', pdf_page: 5 }]
  });
  const found = h.context.searchAll('needle', 'figures');
  assert.equal(found.length, 2);
  assert.equal(found[0].entity, h.C.figures[0], 'exact title ranks before an earlier page');
  h.context.runSearch('needle', 'figures', 99, { record: false });
  assert.equal(h.state.searchPage, 0);
  assert.match(h.markup, /1–2 of 2 results/);
  h.context.runSearch('missing', 'figures', 4, { record: false });
  assert.equal(h.state.searchPage, 0);
  assert.match(h.markup, /0 results/);
  assert.equal(h.buttons.filter(button => 'page' in button.dataset).length, 0);
});

test('global search includes the units and sections of every lettered definition', () => {
  const symbol = {
    symbol: 'Z',
    meaning: 'several meanings',
    units: '',
    sections: '1.1, 2.2',
    definitions: [
      { label: '(a)', meaning: 'first quantity', units: 'cm²', sections: '1.1' },
      { label: '(b)', meaning: 'second quantity', units: 's−1', sections: '2.2' }
    ]
  };
  const h = harness({ symbols: [symbol] });
  assert.equal(h.context.searchAll('cm2', 'glossary')[0].entity, symbol);
  assert.equal(h.context.searchAll('s-1', 'all')[0].entity, symbol);
  assert.equal(h.context.searchAll('second 2.2', 'all')[0].entity, symbol);
  assert.equal(h.context.searchAll('source_row', 'all').length, 0);
});

test('concept and notation searches keep their categories while legacy glossary searches combine them', () => {
  const concept = { term: 'needle concept', pages: [1], see: '', pdf_page: 1 };
  const symbol = { symbol: 'N', meaning: 'needle symbol', pdf_page: 2 };
  const abbreviation = { abbr: 'NAB', meaning: 'needle abbreviation', pdf_page: 3 };
  const chemical = { abbr: 'NC', meaning: 'needle chemical', structure_ref: '', pdf_page: 4 };
  const h = harness({
    index: [concept],
    symbols: [symbol],
    abbreviations: [abbreviation],
    chemicals: [chemical],
    tables: [{ title: 'Needle table', caption: 'needle', pdf_page: 5 }]
  });
  const matches = scope =>
    Array.from(h.context.searchAll('needle', scope), result => result.entity);
  assert.deepEqual(matches('concepts'), [concept]);
  assert.deepEqual(matches('symbols'), [symbol, abbreviation, chemical]);
  assert.deepEqual(
    new Set(matches('glossary')),
    new Set([concept, symbol, abbreviation, chemical])
  );
  assert.equal(matches('all').length, 5, 'global search still includes the other catalogs');
});

function chapters() {
  return [
    {
      key: 'chapter-1',
      id: '1',
      kind: 'chapter',
      title: 'Chapter 1 First',
      pdf_page: 10,
      pdf_page_end: 19
    },
    {
      key: 'chapter-2',
      id: '2',
      kind: 'chapter',
      title: 'Chapter 2 Second',
      pdf_page: 20,
      pdf_page_end: 29
    },
    {
      key: 'appendix-A',
      id: 'A',
      kind: 'appendix',
      title: 'Appendix A Methods',
      pdf_page: 30,
      pdf_page_end: 39
    }
  ];
}

test('chapter filtering uses outline page boundaries, including front matter and appendices', () => {
  const figures = [
    { label: '1', title: 'Opening plate', caption: 'intro', pdf_page: 2 },
    { label: '2.1', title: 'Different label prefix', caption: 'redox', pdf_page: 19 },
    { label: '1.1', title: 'Chapter two example', caption: 'redox', pdf_page: 20 },
    { label: '1.2', title: 'End of chapter two', caption: 'transport', pdf_page: 29 },
    { label: 'A.1', title: 'Appendix example', caption: 'redox', pdf_page: 30 }
  ];
  const h = harness({ sections: chapters(), figures });
  const selected = (query, key) =>
    Array.from(h.context.filteredCollection('figures', query, key), item => item.pdf_page);
  assert.deepEqual(selected('', 'chapter-1'), [19]);
  assert.deepEqual(selected('', 'chapter-2'), [20, 29]);
  assert.deepEqual(selected('redox', 'chapter-2'), [20]);
  assert.deepEqual(selected('', 'front'), [2]);
  assert.deepEqual(selected('', 'appendix-A'), [30]);
  assert.equal(selected('', '').length, 5);

  h.state.collectionPage = 3;
  h.context.renderCollection('figures');
  assert.match(h.markup, /Filter by chapter or appendix/);
  assert.match(h.markup, /Appendix A Methods/);
  const chapter = h.controls.get('collectionChapter');
  chapter.value = 'chapter-2';
  chapter.fire('change');
  assert.equal(h.state.collectionPage, 0);
  assert.equal(h.state.collectionChapter, 'chapter-2');
  assert.equal(h.controls.get('collectionChapter').focused, true);
  const buttons = h.buttons.filter(button => 'collection' in button.dataset);
  assert.deepEqual(
    buttons.map(button => Number(button.dataset.index)),
    [2, 3]
  );
});

test('detail Previous/Next follows all filtered matches across catalog pages', () => {
  const figures = Array.from({ length: 260 }, (_, i) => ({
    label: String(i + 1),
    title: `Figure ${i + 1}`,
    caption: i % 2 ? 'other' : 'match',
    pdf_page: 14
  }));
  const h = harness({ figures, sections: chapters() });
  h.state.collectionFilter = 'match';
  h.state.collectionChapter = 'chapter-1';
  h.state.collectionPage = 1;
  h.context.renderCollection('figures');
  const firstCard = h.buttons.find(button => 'collection' in button.dataset);
  assert.equal(firstCard.dataset.index, '160');
  firstCard.fire('click');
  assert.equal(h.state.currentEntity.item, figures[160]);
  assert.equal(h.state.entryContext.items.length, 130);
  assert.match(h.markup, /81 of 130 matching figures/);
  assert.equal(h.context.neighborInfo('figure', figures[160]).prev, figures[158]);
  h.controls.get('nextEntity').fire('click');
  assert.equal(h.state.currentEntity.item, figures[162]);
  assert.match(h.markup, /82 of 130 matching figures/);
  assert.equal(h.locations.at(-1).context, h.state.entryContext);

  const context = h.state.entryContext;
  h.context.showEntity('figure', figures[162], false);
  assert.equal(h.state.entryContext, context, 'bookmark redraw retains its list');
  const detailMarkup = h.markup;
  h.context.runSearch('pdf 10', 'all');
  assert.equal(
    h.state.entryContext,
    context,
    'a PDF-only command retains the visible detail context'
  );
  assert.equal(h.state.currentEntity.item, figures[162]);
  assert.equal(h.markup, detailMarkup);
  assert.equal(h.pdf.at(-1)[0], 10);
  h.context.showEntity('figure', figures[1]);
  assert.equal(h.state.entryContext, null, 'direct navigation must not reuse another list');
  assert.equal(
    h.pdf.at(-1)[2].remember,
    false,
    'catalog previews must not replace Continue reading'
  );
  assert.equal(h.context.neighborInfo('figure', figures[1]).next, figures[2]);
  h.context.showEntity('figure', figures[160], true, context);
  assert.equal(h.context.neighborInfo('figure', figures[160]).next, figures[162]);
});

test('a reviewed figure detail uses the verified PDF page and crop position', () => {
  const figure = { label: '3', pdf_page: 14, sourcePage: 15, sourceTop: 280 };
  const h = harness({ figures: [figure] });
  h.context.window.AtlasReader = {
    yFromTop(page, top) {
      assert.equal(page, 15);
      assert.equal(top, 280);
      return 501;
    }
  };
  h.context.showEntity('figure', figure);
  assert.match(h.markup, /data-open-pdf="15"[^>]*data-target-y="501"/);
  assert.equal(h.pdf.at(-1)[0], 15);
  assert.equal(h.pdf.at(-1)[2].targetY, 501);
});
