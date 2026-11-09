'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const text = require('../../src/client/core/text.js');
const science = require('../../src/client/science/notation.js');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('src/client/application/40-catalog.js');

function catalogFixture() {
  return {
    abbreviations: [
      {
        abbr: 'EIS',
        meaning: 'electrochemical impedance spectroscopy',
        sections: '2.1.4, 3.5.1(a), A.1'
      }
    ],
    symbols: [
      {
        symbol: 'k0',
        meaning: 'standard rate constant at concentration c₀',
        units: 'cm s−1',
        sections: '3.5.4, B.1.2'
      }
    ],
    chemicals: [
      {
        abbr: '[Fe(CN)6]3−',
        meaning: 'ferricyanide complex',
        structure_ref: 'Figure 1(a)',
        sections: 'not a chemical source section'
      }
    ]
  };
}

function harness(catalog = catalogFixture()) {
  const state = { symbolTab: 'abbreviations', collectionFilter: '', collectionPage: 0 };
  const opened = [],
    formatted = [];
  let markup = '',
    tabs = [],
    cards = [],
    filter,
    pagination;
  function control(dataset = {}) {
    const listeners = new Map();
    return {
      dataset,
      value: '',
      addEventListener: (name, listener) => listeners.set(name, listener),
      trigger(name) {
        assert.ok(listeners.has(name), `The actual renderer must bind ${name}`);
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
  function buttons(attribute, field) {
    return [...markup.matchAll(new RegExp(`<button\\b[^>]*${attribute}="([^"]+)"[^>]*>`, 'g'))].map(
      ([, value]) => control({ [field]: value })
    );
  }
  const content = {
    set innerHTML(value) {
      markup = value;
      tabs = buttons('data-symbol-tab', 'symbolTab');
      cards = buttons('data-symbol-entry', 'symbolEntry');
      filter = control();
      filter.value = state.collectionFilter;
    },
    get innerHTML() {
      return markup;
    }
  };
  const context = vm.createContext({
    C: catalog,
    state,
    content,
    esc: text.escapeHtml,
    norm: text.normalize,
    sci(value, options) {
      formatted.push({ value, mode: options?.mode });
      return science.html(value, options);
    },
    $: selector => {
      assert.equal(selector, '#symbolFilter');
      return filter;
    },
    $$: (selector, host) => {
      assert.equal(host, content);
      if (selector === '[data-symbol-tab]') return tabs;
      assert.equal(selector, '[data-symbol-entry]');
      return cards;
    },
    debounce: callback => callback,
    requestAnimationFrame: callback => callback(),
    paginationHTML: () => '',
    bindPagination: (render, pages) => {
      pagination = { render, pages };
    },
    showEntity: (type, item) => opened.push({ type, item })
  });
  vm.runInContext(source, context, { filename: 'application/40-catalog.js' });
  return {
    catalog,
    state,
    context,
    opened,
    formatted,
    render: () => context.renderSymbols(),
    get markup() {
      return markup;
    },
    get cards() {
      return cards;
    },
    get tabs() {
      return tabs;
    },
    get filter() {
      return filter;
    },
    get pagination() {
      return pagination;
    }
  };
}

function assertNativeCards(markup, count) {
  const openings = [...markup.matchAll(/<button\b[^>]*>/g)];
  assert.equal(openings.length, count);
  let depth = 0;
  for (const [tag, closing, name] of markup.matchAll(/<(\/)?([a-z]+)\b[^>]*>/g)) {
    if (name === 'button') {
      if (closing) depth -= 1;
      else {
        assert.equal(depth, 0, 'a card must not contain nested buttons');
        assert.match(tag, /type="button"/);
        assert.match(tag, /class="collection-card symbol-card"/);
        depth += 1;
      }
    } else if (!closing && depth) {
      assert.ok(
        !['a', 'input', 'select', 'textarea', 'details'].includes(name),
        `interactive ${name} inside a card`
      );
      assert.doesNotMatch(tag, /\btabindex=/);
    }
  }
  assert.equal(depth, 0);
  assert.doesNotMatch(markup, /<(?:table|thead|tbody|tr|td|th)\b/);
}

test('each Symbols category renders one native collection button per complete entry', () => {
  const h = harness();
  for (const tab of ['abbreviations', 'symbols', 'chemicals']) {
    const item = h.catalog[tab][0];
    const markup = h.context.symbolCards(tab, h.catalog[tab]);
    assertNativeCards(markup, 1);
    assert.match(markup, /data-symbol-entry="0"/);
    assert.ok(markup.includes(science.html(item.meaning)));
    const identifier = item.symbol || item.abbr;
    assert.ok(markup.includes(science.html(identifier, { mode: 'identifier' })));
    assert.ok(h.formatted.some(call => call.value === identifier && call.mode === 'identifier'));
  }
});

test('cards show supplied section references and scientific units without inventing chemical sections', () => {
  const h = harness();
  const symbol = h.context.symbolCards('symbols', h.catalog.symbols);
  assert.match(symbol, /Usual units:<\/span>/);
  assert.ok(symbol.includes(science.html(h.catalog.symbols[0].units)));
  assert.match(symbol, /Sections:<\/span> 3\.5\.4, B\.1\.2/);
  assert.match(symbol, /symbol-card-detail sci-rich/);
  const abbreviation = h.context.symbolCards('abbreviations', h.catalog.abbreviations);
  assert.match(abbreviation, /Sections:<\/span> 2\.1\.4, 3\.5\.1\(a\), A\.1/);
  const chemical = h.context.symbolCards('chemicals', h.catalog.chemicals);
  assert.match(chemical, /Structure \/ equation:<\/span>/);
  assert.ok(
    chemical.includes(science.html(h.catalog.chemicals[0].structure_ref, { mode: 'identifier' }))
  );
  assert.doesNotMatch(chemical, /Sections:|not a chemical source section/);

  h.catalog.symbols[0].sections = '  ';
  h.catalog.symbols[0].units = '';
  assert.doesNotMatch(
    h.context.symbolCards('symbols', h.catalog.symbols),
    /Sections:|Usual units:/
  );
  delete h.catalog.abbreviations[0].sections;
  assert.doesNotMatch(h.context.symbolCards('abbreviations', h.catalog.abbreviations), /Sections:/);
});

test('lettered source meanings keep their own units and sections inside one clickable card', () => {
  const h = harness();
  h.context.window = { AtlasScience: science };
  const item = {
    symbol: 'Z',
    symbol_runs: [{ text: 'Z', bold: true }],
    meaning: 'aggregate should not replace source groups',
    units: '',
    sections: '1.1, 2.2',
    definitions: [
      {
        label: '(a)',
        meaning: 'first definition',
        units: 'cm2',
        units_runs: [{ text: 'cm' }, { text: '2', script: 'super' }],
        sections: '1.1'
      },
      { label: '(b)', meaning: 'second definition', units: 'None', sections: '2.2' }
    ]
  };
  h.catalog.symbols = [item];
  const markup = h.context.symbolCards('symbols', [item]);
  assertNativeCards(markup, 1);
  assert.doesNotMatch(markup, /aggregate should/);
  assert.match(markup, /notation-bold/);
  const groups = markup.split('<span class="notation-definition">').slice(1);
  assert.equal(groups.length, 2);
  assert.match(groups[0], /\(a\).*first definition/s);
  assert.match(groups[0], /cm<sup>2<\/sup>/);
  assert.match(groups[0], /Sections:<\/span> 1\.1/);
  assert.doesNotMatch(groups[0], /second definition|2\.2/);
  assert.match(groups[1], /\(b\).*second definition/s);
  assert.match(groups[1], /Usual units:<\/span>.*None/s);
  assert.match(groups[1], /Sections:<\/span> 2\.2/);
});

test('pagination and section filtering keep the original source index for a whole-card click', () => {
  const catalog = catalogFixture();
  catalog.symbols = Array.from({ length: 145 }, (_, index) => ({
    symbol: `S${index}`,
    meaning: `Symbol definition ${index}`,
    units: 'M',
    sections: index === 143 ? '17.2.3' : '1.1'
  }));
  const h = harness(catalog);
  h.state.symbolTab = 'symbols';
  h.state.collectionPage = 1;
  h.render();
  assert.equal(h.pagination.pages, 2);
  assert.deepEqual(
    h.cards.map(button => Number(button.dataset.symbolEntry)),
    [140, 141, 142, 143, 144]
  );
  h.cards[3].trigger('click');
  assert.equal(h.opened[0].type, 'symbol');
  assert.equal(h.opened[0].item, catalog.symbols[143]);

  h.filter.value = '17.2.3';
  h.filter.trigger('input');
  assert.equal(h.state.collectionFilter, '17.2.3');
  assert.equal(h.state.collectionPage, 0);
  assert.equal(h.pagination.pages, 1);
  assert.equal(h.filter.focused, true);
  assert.equal(h.cards.length, 1);
  assert.equal(h.cards[0].dataset.symbolEntry, '143');
  h.cards[0].trigger('click');
  assert.equal(h.opened[1].item, catalog.symbols[143]);

  h.filter.value = 'no matching source entry';
  h.filter.trigger('input');
  assert.equal(h.cards.length, 0);
  assert.match(h.markup, /No matching entries\./);
});

test('all three tabs reset filters and pagination and route each card through showEntity', () => {
  const h = harness();
  h.render();
  for (const [tab, type] of [
    ['symbols', 'symbol'],
    ['chemicals', 'chemical'],
    ['abbreviations', 'abbreviation']
  ]) {
    h.state.collectionFilter = 'old filter';
    h.state.collectionPage = 4;
    h.tabs.find(button => button.dataset.symbolTab === tab).trigger('click');
    assert.equal(h.state.symbolTab, tab);
    assert.equal(h.state.collectionFilter, '');
    assert.equal(h.state.collectionPage, 0);
    assert.equal(h.tabs.length, 3);
    assert.equal((h.markup.match(/aria-pressed="true"/g) || []).length, 1);
    h.cards[0].trigger('click');
    assert.equal(h.opened.at(-1).type, type);
    assert.equal(h.opened.at(-1).item, h.catalog[tab][0]);
  }
});

test('symbol cards reuse shared hover and focus styles without retaining the table component', () => {
  const css = read('src/client/styles/20-symbol-table.css');
  assert.doesNotMatch(
    source + css,
    /symbolTable|symbol-data-table|symbol-table-frame|symbol-col-|data-symbol-row/
  );
  assert.doesNotMatch(css, /:hover|:focus|table-layout|@container symbol-table/);
  assert.match(css, /\.symbol-card-detail\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(read('src/client/styles/00-foundation.css'), /\.collection-card:hover/);
  assert.match(
    read('src/client/styles/11-components-responsive.css'),
    /\.collection-card:focus-visible/
  );
});

test('reader bar controls are small, low-contrast, and use the requested labels', () => {
  const html = read('src/client/index.html');
  assert.match(html, /id="floatingHideBar"[^>]*>\s*Hide bar\s*<\/button\s*>/);
  assert.match(html, /id="restoreTopBars"[^>]*>\s*Show bar\s*<\/button\s*>/);
  assert.doesNotMatch(html, />\s*Show top bar\s*</);
  const hideStyle = read('src/client/styles/19-workspace-organization.css');
  const showStyle = read('src/client/styles/06-reader-controls.css');
  assert.match(hideStyle, /\.reader \.reader-hover-controls button \{[\s\S]*?min-height:\s*27px/);
  assert.match(hideStyle, /\.reader \.reader-hover-controls button:focus-visible/);
  assert.match(showStyle, /\.restore-top-bars \{[\s\S]*?min-height:\s*27px/);
  assert.match(showStyle, /\.restore-top-bars:focus-visible/);
  assert.match(read('src/client/reader/chrome.js'), /floatingHideBar/);
});
