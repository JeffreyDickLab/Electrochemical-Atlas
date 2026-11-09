'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../../src/client', name), 'utf8');
const navigation = read('navigation/controller.js');
const html = read('index.html');
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

function sourceBetween(start, end) {
  const first = navigation.indexOf(start);
  const last = navigation.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Controller section exists: ${start}`);
  return navigation.slice(first, last);
}

const inlineSource =
  sourceBetween('  const elem =', '  // Sidebar destinations are static') +
  sourceBetween('  // Inline search:', '  // A lightweight escape from PDF-only view');
const sidebarMarkup = html.match(/<nav\b[^>]*id="mainNav"[^>]*>([\s\S]*?)<\/nav>/)[1];
const sidebar = Array.from(
  sidebarMarkup.matchAll(/<button\b([^>]*data-view="([^"]+)"[^>]*)>([\s\S]*?)<\/button\s*>/g),
  match => ({
    view: match[2],
    title: decode(match[3].match(/class="atlas-sidebar-text">([^<]+)<\/span/)[1]),
    icon: decode(match[3].match(/class="atlas-sidebar-icon">([^<]+)<\/span/)[1])
  })
);
const dropdownDestinations = [
  sidebar.find(destination => destination.view === 'notes'),
  ...sidebar.filter(destination => !['home', 'notes'].includes(destination.view))
];
const searchScopes = Array.from(
  html
    .match(/<select\b[^>]*id="searchScope"[^>]*>([\s\S]*?)<\/select>/)[1]
    .matchAll(/<option\b[^>]*value="([^"]+)"/g),
  match => match[1]
);

// Only the element operations used by this controller section are modeled.
// In particular, select.value must reject an unsupported option as a browser does.
function documentFixture() {
  const ids = new Map();
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.hidden = false;
      this._text = '';
      this._value = '';
      const classes = new Set();
      this.classList = {
        add: value => classes.add(value),
        contains: value => classes.has(value),
        remove: value => classes.delete(value),
        toggle(value, force = !classes.has(value)) {
          if (force) classes.add(value);
          else classes.delete(value);
          return force;
        },
        set: value => {
          classes.clear();
          value
            .split(/\s+/)
            .filter(Boolean)
            .forEach(item => classes.add(item));
        }
      };
    }
    set id(value) {
      this._id = value;
      ids.set(value, this);
    }
    get id() {
      return this._id || '';
    }
    set className(value) {
      this.classList.set(value);
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map(child => child.textContent).join('');
    }
    set value(value) {
      this._value =
        this.tagName !== 'SELECT' || this.options.some(option => option.value === value)
          ? value
          : '';
    }
    get value() {
      return this._value;
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
    append(...children) {
      children.forEach(child => {
        child.parentElement = this;
        this.children.push(child);
      });
    }
    replaceChildren(...children) {
      this.children = [];
      this._text = '';
      this.append(...children);
    }
    contains(target) {
      return this === target || this.children.some(child => child.contains(target));
    }
    matches(selector) {
      const not = selector.match(/:not\(([^)]+)\)$/);
      if (not && this.matches(not[1])) return false;
      selector = selector.replace(/:not\([^)]+\)$/, '');
      const data = selector.match(/\[data-([\w-]+)(?:="([^"]*)")?\]/);
      if (data) {
        const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (!(key in this.dataset) || (data[2] != null && String(this.dataset[key]) !== data[2]))
          return false;
        selector = selector.replace(data[0], '');
      }
      if (!selector) return true;
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    fire(type, fields = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...fields };
      (this.listeners.get(type) || []).forEach(callback => callback(event));
    }
    click() {
      this.fire('click');
    }
    focus() {
      if (document.activeElement === this) return;
      document.activeElement = this;
      this.fire('focus');
    }
    scrollIntoView() {}
    select() {}
    set innerHTML(markup) {
      // The real panel has static shells; its destination and result buttons
      // are created by the controller, not recreated by this fixture.
      this.replaceChildren();
      const stack = [this];
      for (const match of markup.matchAll(/<\/?([a-z]+)\b([^>]*)>|([^<]+)/g)) {
        if (match[3]) {
          stack.at(-1)._text += decode(match[3]);
          continue;
        }
        if (match[0].startsWith('</')) {
          stack.pop();
          continue;
        }
        const child = new Element(match[1]);
        for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
          if (attr[1] === 'id') child.id = attr[2];
          else if (attr[1] === 'class') child.className = attr[2];
          else child.setAttribute(attr[1], attr[2]);
        }
        stack.at(-1).append(child);
        stack.push(child);
      }
    }
  }
  const body = new Element('body');
  document = {
    body,
    activeElement: body,
    createElement: tag => new Element(tag),
    getElementById: id => ids.get(id) || null,
    querySelector: selector => body.querySelector(selector),
    addEventListener: (type, callback) => body.addEventListener(type, callback)
  };
  return document;
}

function harness(extraDestination) {
  const document = documentFixture();
  const make = (tag, id, parent = document.body) => {
    const element = document.createElement(tag);
    if (id) element.id = id;
    parent.append(element);
    return element;
  };
  const nav = make('nav', 'mainNav');
  const destinations = sidebar.concat(extraDestination || []);
  destinations.forEach(destination => {
    const button = make('button', '', nav);
    button.dataset.view = destination.view;
    for (const [className, text] of [
      ['atlas-sidebar-icon', destination.icon],
      ['atlas-sidebar-text', destination.title]
    ]) {
      const span = make('span', '', button);
      span.className = className;
      span.textContent = text;
    }
  });
  const searchBox = make('div');
  searchBox.className = 'search-wrap';
  const input = make('input', 'globalSearch', searchBox);
  const scopeSelect = make('select', 'searchScope', searchBox);
  scopeSelect.options = searchScopes.map(value => ({ value }));
  scopeSelect.value = 'all';
  const catalog = {
    meta: { pdf_pages: 100 },
    sections: [
      { kind: 'chapter', title: 'Fixture chapter', excerpt: 'Chapter excerpt' },
      { kind: 'section', title: 'Fixture subsection', excerpt: 'Subsection excerpt' },
      { kind: 'appendix', title: 'Fixture appendix', excerpt: 'Appendix excerpt' }
    ],
    figures: [{ title: 'Fixture figure', caption: 'Figure caption' }],
    tables: [{ title: 'Fixture table', description: 'Table description' }],
    equations: [{ title: 'Fixture equation', context: 'Equation context' }],
    problems: [{ title: 'Fixture problem', text: 'Problem text' }],
    references: [{ title: 'Fixture reference', text: 'Reference text' }],
    index: [{ term: 'Fixture concept', pages: ['8'] }],
    symbols: [{ symbol: 'x', meaning: 'Fixture symbol' }],
    abbreviations: [{ abbr: 'EX', meaning: 'Fixture abbreviation' }],
    chemicals: [{ abbr: 'Q', meaning: 'Fixture chemical' }]
  };
  const specs = [{ id: 'example', title: 'Fixture calculator', description: 'Example calculator' }];
  const recents = [
    { kind: 'entity', type: 'figure', item: catalog.figures[0] },
    { kind: 'search', query: 'Earlier search', scope: 'tables' },
    { kind: 'entity', type: 'table', item: catalog.tables[0] }
  ];
  const calls = [];
  const searchResults = [];
  const user = { bookmarks: { pages: [7], entities: ['figure-fixture'] }, notes: {} };
  const savedEntries = new Map([
    ['figure-fixture', { canonicalKey: 'figure-fixture', type: 'figure', item: catalog.figures[0] }]
  ]);
  const app = {
    state: { readerPage: 8, resumePage: 9 },
    user,
    sectionById: new Map(),
    studyPaths: [
      { id: 'cv', title: 'Cyclic voltammetry', description: 'Scan rates', steps: ['7.1'] },
      { id: 'secm', title: 'SECM', description: 'Probe feedback', steps: ['18.1', '18.2'] }
    ],
    resolveEntityBookmark: key => savedEntries.get(key) || null,
    goView: view => calls.push({ kind: 'view', view }),
    openStudyPath: id => calls.push({ kind: 'study-path', id }),
    showEntity: (type, item) => calls.push({ kind: 'entity', type, item }),
    openPdf: (page, message, { preferRead }) => calls.push({ kind: 'page', page, preferRead }),
    runSearch: (query, scope) => calls.push({ kind: 'search', query, scope }),
    searchAll: (query, scope) => {
      calls.push({ kind: 'preview-search', query, scope });
      return searchResults;
    }
  };
  vm.runInNewContext(
    inlineSource,
    {
      app,
      catalog,
      specs,
      document,
      $: id => document.getElementById(id),
      window: {
        ATLAS_READER_META: { labels: Array.from({ length: 100 }, (_, i) => String(i + 1)) },
        AtlasCalculators: { select: id => calls.push({ kind: 'calculator', id }) }
      },
      recentHistory: { entries: () => recents },
      reopenRecent: recent => calls.push({ kind: 'recent', recent }),
      touchRecent: recent => calls.push({ kind: 'remember', recent }),
      navigateHistory() {}
    },
    { filename: 'controller-inline-search.js' }
  );
  const panel = document.getElementById('atlasCommandPalette');
  const resultButtons = () => panel.querySelectorAll('[data-option-index]');
  return {
    document,
    input,
    panel,
    scopeSelect,
    calls,
    catalog,
    destinations,
    recents,
    searchResults,
    user,
    savedEntries,
    chips: () => panel.querySelectorAll('[data-command-view]'),
    chip: view =>
      panel
        .querySelectorAll('[data-command-view]')
        .find(button => button.dataset.commandView === view),
    scopeChip: scope =>
      panel
        .querySelectorAll('[data-command-scope]')
        .find(button => button.dataset.commandScope === scope),
    resultButtons,
    titles: () => resultButtons().map(button => button.querySelector('strong').textContent),
    fullSearch: document.getElementById('atlasFullSearch')
  };
}

test('focused search puts Saved items after All and keeps Home in the sidebar', () => {
  const h = harness();
  assert.equal(sidebar.length, 12);
  assert.equal(sidebar.find(destination => destination.view === 'book').title, 'Chapters');
  assert.equal(h.panel.hidden, true);
  h.input.focus();
  assert.equal(h.panel.hidden, false);
  assert.equal(h.input.getAttribute('aria-expanded'), 'true');
  assert.equal(h.scopeChip('all').textContent, 'All');
  assert.equal(h.scopeChip('all').parentElement.children[1], h.chip('notes'));
  const home = h.document.getElementById('mainNav').querySelector('[data-view="home"]');
  assert.equal(home.querySelector('.atlas-sidebar-text').textContent, 'Home');
  assert.deepEqual(
    h.chips().map(button => ({ view: button.dataset.commandView, title: button.textContent })),
    dropdownDestinations.map(({ view, title }) => ({ view, title }))
  );
  assert.equal(h.scopeChip('all').getAttribute('aria-pressed'), 'true');
  for (const button of h.chips()) {
    assert.equal(button.getAttribute('aria-pressed'), button.dataset.commandScope ? 'false' : null);
  }
  assert.ok(h.input.getAttribute('aria-activedescendant'));
  h.input.value = 'unmatched query';
  h.input.fire('input');
  assert.deepEqual(h.resultButtons(), []);
  assert.equal(h.input.getAttribute('aria-activedescendant'), null);
  h.searchResults.push({ type: 'table', entity: h.catalog.tables[0] });
  h.input.value = 'matching query';
  h.input.fire('input');
  assert.deepEqual(h.titles(), ['Fixture table']);
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.resultButtons()[0].id);

  // A new sidebar route should appear without another hardcoded menu inventory.
  const added = { view: 'fixture-extra', title: 'Extra destination', icon: '+' };
  const extended = harness(added);
  extended.input.focus();
  assert.equal(extended.chips().at(-1).textContent, added.title);
  extended.chip(added.view).click();
  assert.deepEqual(extended.calls.at(-1), { kind: 'view', view: added.view });
});

test('empty All retains recents, Continue PDF and dropdown destinations beyond twelve results', () => {
  const h = harness();
  h.input.focus();
  const titles = h.titles();
  assert.deepEqual(titles.slice(0, 4), [
    'Fixture figure',
    'Earlier search',
    'Fixture table',
    'Continue reading · PDF page 9'
  ]);
  assert.deepEqual(
    titles.slice(4),
    dropdownDestinations.map(destination => 'Open ' + destination.title)
  );
  assert.equal(titles.length, dropdownDestinations.length + h.recents.length + 1);
  assert.ok(titles.length > 12);
  assert.equal(h.fullSearch.hidden, true);
  h.resultButtons()[3].click();
  assert.deepEqual(h.calls.at(-1), { kind: 'page', page: 9, preferRead: true });
  h.input.click();
  h.resultButtons().at(-1).click();
  assert.deepEqual(h.calls.at(-1), { kind: 'view', view: dropdownDestinations.at(-1).view });
  assert.equal(h.panel.hidden, true);
});

test('Study paths filters existing routes and opens the selected path from the dropdown', () => {
  const h = harness();
  h.input.focus();
  h.chip('paths').click();
  assert.equal(h.panel.hidden, false);
  assert.equal(h.scopeChip('paths').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(h.titles(), ['Open Study paths', 'Cyclic voltammetry', 'SECM']);
  h.input.value = 'probe feedback';
  h.input.fire('input');
  assert.deepEqual(h.titles(), ['SECM']);
  assert.equal(h.fullSearch.hidden, true);
  h.input.fire('keydown', { key: 'Enter', ctrlKey: true });
  h.input.fire('keydown', { key: 'Enter', metaKey: true });
  h.fullSearch.click();
  assert.deepEqual(h.calls, []);
  h.input.value = 'no path matches';
  h.input.fire('input');
  h.input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(h.calls, []);
  assert.equal(h.panel.hidden, false);
  h.input.value = '18.2';
  h.input.fire('input');
  h.input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(h.calls, [{ kind: 'study-path', id: 'secm' }]);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.input.getAttribute('aria-expanded'), 'false');
});

test('pointer interaction outside the search control dismisses the dropdown', () => {
  const h = harness();
  const body = h.document.body;
  h.input.focus();
  assert.equal(body.classList.contains('atlas-search-open'), true);
  body.fire('pointerdown', { target: h.chip('paths') });
  assert.equal(h.panel.hidden, false);
  body.fire('pointerdown');
  assert.equal(h.panel.hidden, true);
  assert.equal(body.classList.contains('atlas-search-open'), false);
  assert.equal(h.input.getAttribute('aria-expanded'), 'false');
  h.input.click();
  assert.equal(body.classList.contains('atlas-search-open'), true);
  h.input.fire('keydown', { key: 'Escape' });
  assert.equal(h.panel.hidden, true);
  assert.equal(body.classList.contains('atlas-search-open'), false);
});

test('each searchable category offers Open first, followed by its existing source previews', () => {
  const expected = {
    book: ['sections', ['Fixture chapter', 'Fixture appendix']],
    calculators: ['calculators', ['Fixture calculator']],
    paths: ['paths', ['Cyclic voltammetry', 'SECM']],
    notes: ['saved', ['Bookmarked PDF page 7', 'Fixture figure']],
    concepts: ['concepts', ['Fixture concept']],
    symbols: ['symbols', ['Fixture symbol', 'Fixture abbreviation', 'Fixture chemical']],
    figures: ['figures', ['Fixture figure']],
    tables: ['tables', ['Fixture table']],
    equations: ['equations', ['Fixture equation']],
    problems: ['problems', ['Fixture problem']],
    references: ['references', ['Fixture reference']]
  };
  for (const [view, [scope, previews]] of Object.entries(expected)) {
    const h = harness();
    h.input.focus();
    const chip = h.chip(view);
    assert.equal(chip.dataset.commandScope, scope);
    chip.click();
    assert.equal(h.panel.hidden, false);
    assert.deepEqual(h.calls, [], 'choosing a scope must not navigate before choosing an option');
    assert.deepEqual(h.titles(), ['Open ' + chip.textContent, ...previews]);
    for (const button of h.panel.querySelectorAll('[data-command-scope]')) {
      assert.equal(button.getAttribute('aria-pressed'), String(button === chip));
      assert.equal(button.classList.contains('selected'), button === chip);
    }
    assert.equal(h.resultButtons()[0].getAttribute('aria-selected'), 'true');
    assert.equal(h.input.getAttribute('aria-activedescendant'), h.resultButtons()[0].id);
    h.input.fire('keydown', { key: 'Enter' });
    assert.deepEqual(h.calls.at(-1), { kind: 'view', view });
    assert.equal(h.panel.hidden, true);
  }
});

test('PDF page searches and bookmarks use the shared reader jump', () => {
  for (const [scope, query, page] of [
    ['all', 'pdf 12', 12],
    ['saved', 'bookmarked', 7]
  ]) {
    const h = harness();
    h.input.focus();
    h.scopeChip(scope).click();
    h.input.value = query;
    h.input.fire('input');
    h.input.fire('keydown', { key: 'Enter' });
    assert.deepEqual(h.calls.at(-1), { kind: 'page', page, preferRead: true });
  }
});

test('preview selection opens the actual source entry, including all three notation types', () => {
  const h = harness();
  for (const [index, type, item] of [
    [1, 'symbol', h.catalog.symbols[0]],
    [2, 'abbreviation', h.catalog.abbreviations[0]],
    [3, 'chemical', h.catalog.chemicals[0]]
  ]) {
    h.input.click();
    h.chip('symbols').click();
    for (let step = 0; step < index; step++) h.input.fire('keydown', { key: 'ArrowDown' });
    assert.equal(h.resultButtons()[index].getAttribute('aria-selected'), 'true');
    h.input.fire('keydown', { key: 'Enter' });
    assert.deepEqual(h.calls.at(-1), { kind: 'entity', type, item });
  }
});

test('Saved items finds full note text and opens its linked entry', () => {
  const h = harness();
  const figure = h.catalog.figures[0];
  const otherFigure = { ...figure, caption: 'Second figure caption' };
  h.savedEntries.set('old-figure-key', h.savedEntries.get('figure-fixture'));
  h.savedEntries.set('other-figure', {
    canonicalKey: 'other-figure',
    type: 'figure',
    item: otherFigure
  });
  h.user.notes['old-figure-key'] = 'Compare with the repeated label';
  h.user.notes['other-figure'] = 'Long note. '.repeat(20) + 'Observe the diffusion tail';
  h.user.notes['unresolved-key'] = 'Unresolved note text';
  h.input.focus();
  h.chip('notes').click();
  assert.deepEqual(h.titles(), [
    'Open Saved items',
    'Bookmarked PDF page 7',
    'Fixture figure',
    'Fixture figure'
  ]);

  h.input.value = 'repeated label';
  h.input.fire('input');
  assert.deepEqual(h.titles(), ['Fixture figure']);
  assert.equal(
    h.resultButtons()[0].querySelector('small').textContent,
    'Note · Compare with the repeated label'
  );

  h.input.value = 'unresolved note';
  h.input.fire('input');
  assert.deepEqual(h.titles(), []);
  h.input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(h.calls, [], 'an unmatched note search stays in Saved items');

  h.input.value = 'diffusion tail';
  h.input.fire('input');
  assert.deepEqual(h.titles(), ['Fixture figure']);
  h.input.fire('keydown', { key: 'Enter' });
  assert.equal(h.calls.at(-1).kind, 'entity');
  assert.equal(h.calls.at(-1).item, otherFigure);
});

test('full-results button and Ctrl/Meta Enter retain each supported scope from the real select', () => {
  const views = [
    'book',
    'concepts',
    'symbols',
    'figures',
    'tables',
    'equations',
    'problems',
    'references'
  ];
  for (const view of views) {
    for (const submit of ['button', 'control', 'meta']) {
      const h = harness();
      h.input.focus();
      const chip = h.chip(view);
      chip.click();
      const scope = chip.dataset.commandScope;
      assert.ok(searchScopes.includes(scope), `${view} must have a real full-search option`);
      h.input.value = 'fixture query';
      h.input.fire('input');
      assert.deepEqual(h.calls.at(-1), { kind: 'preview-search', query: 'fixture query', scope });
      assert.equal(h.fullSearch.hidden, false);
      if (submit === 'button') h.fullSearch.click();
      else
        h.input.fire('keydown', {
          key: 'Enter',
          ctrlKey: submit === 'control',
          metaKey: submit === 'meta'
        });
      assert.deepEqual(h.calls.at(-1), { kind: 'search', query: 'fixture query', scope });
      assert.equal(h.scopeSelect.value, scope);
      assert.equal(h.panel.hidden, true);
    }
  }
  const h = harness();
  h.input.focus();
  h.chip('symbols').click();
  h.scopeChip('all').click();
  assert.equal(h.scopeChip('all').getAttribute('aria-pressed'), 'true');
  assert.equal(h.chip('symbols').getAttribute('aria-pressed'), 'false');
  h.input.value = 'fixture query';
  h.input.fire('input');
  h.fullSearch.click();
  assert.deepEqual(h.calls.at(-1), { kind: 'search', query: 'fixture query', scope: 'all' });
});
