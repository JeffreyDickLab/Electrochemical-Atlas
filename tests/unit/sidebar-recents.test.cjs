'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create: createStorage } = require('../../src/client/core/storage.js');

const root = path.resolve(__dirname, '../../src/client');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const navigation = read('navigation/controller.js');
const stateSource = read('application/10-state-and-layout.js');
const studySource = read('application/50-study-tools.js');
const factoryStart = navigation.indexOf('  function createRecentHistory(');
const factoryEnd = navigation.indexOf('\n  const recentHistory =', factoryStart);
assert.ok(factoryStart >= 0 && factoryEnd > factoryStart);
const createRecentHistory = vm.runInNewContext(`(${navigation.slice(factoryStart, factoryEnd)})`);
const plain = value => JSON.parse(JSON.stringify(value));
const keyFor = source => `ea_recent_v2:${source}`;
const legacyKeyFor = source => `ea_recent_v1:${source}`;

function catalogFixture() {
  return {
    sections: [
      { key: 'section-1.1', title: 'Introduction', pdf_page: 3 },
      { key: 'appendix-a', title: 'Appendix A', pdf_page: 1023 },
      { key: 'appendix-b', title: 'Appendix B', pdf_page: 1041 },
      { key: 'appendix-c', title: 'Appendix C', pdf_page: 1063 }
    ],
    figures: [
      { label: '1.1', title: 'Figure 1.1', caption: 'PRIVATE FIGURE CAPTION', pdf_page: 4 }
    ],
    tables: [{ label: '1.2', title: 'Table 1.2', description: 'PRIVATE TABLE TEXT', pdf_page: 5 }],
    equations: [
      { label: '1.3', title: 'Equation 1.3', context: 'PRIVATE EQUATION TEXT', pdf_page: 6 }
    ],
    problems: [{ label: '1.4', title: 'Problem 1.4', text: 'PRIVATE PROBLEM TEXT', pdf_page: 7 }],
    references: [
      { chapter: 1, number: 1, text: 'PRIVATE REFERENCE ONE', pdf_page: 8 },
      { chapter: 2, number: 1, text: 'PRIVATE REFERENCE TWO', pdf_page: 9 }
    ],
    index: [
      { term: 'Diffusion', parent: 'Transport', pages: ['10'] },
      { term: 'Diffusion', parent: 'Measurements', pages: ['20'] }
    ],
    symbols: [
      { symbol: 'D', meaning: 'Diffusion coefficient', pdf_page: 29 },
      { symbol: 'E', meaning: 'Synthetic potential definition', pdf_page: 29 },
      { symbol: 'E', meaning: 'Synthetic energy definition', pdf_page: 30 }
    ],
    abbreviations: [{ abbr: 'LSV', meaning: 'Linear sweep voltammetry' }],
    chemicals: [{ abbr: 'Fc', meaning: 'Ferrocene' }],
    entity_aliases: {}
  };
}

function storageFixture(values = new Map()) {
  const native = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  return { values, native, storage: createStorage({ localStorage: native }) };
}

function harness({
  catalog = catalogFixture(),
  source = 'source-a',
  store = storageFixture()
} = {}) {
  const context = vm.createContext({
    C: catalog,
    window: {},
    sectionByKey: new Map(catalog.sections.map(item => [item.key, item]))
  });
  // Exercise the same reference keys and resolver used by bookmarks and the app.
  vm.runInContext(stateSource + '\n' + studySource, context);
  const identities = context.createEntityIdentity(catalog, source || 'session-test');
  context.entityIdentities = () => identities;
  const history = createRecentHistory({
    storage: store.storage,
    sourceId: source,
    entityKey: context.entityKey,
    resolveEntity: context.resolveEntityBookmark
  });
  const visit = (type, item) => history.remember({ kind: 'entity', type, item });
  return { catalog, store, history, visit, source, key: context.entityKey };
}

test('the shared sidebar footer contains Recently viewed and no resume control', () => {
  const html = read('index.html');
  const css = read('styles/19-workspace-organization.css');
  const menu = html.indexOf('id="mainNav"');
  const browse = html.indexOf('id="catalogRail"');
  const footer = html.indexOf('id="atlasSidebarRecent"');
  const divider = html.indexOf('id="navDivider"');
  assert.ok(menu >= 0 && browse > menu && footer > browse && divider > footer);
  assert.match(html, /id="atlasSidebarRecentList"/);
  assert.match(html, /id="atlasSidebarRecentEmpty"/);
  assert.doesNotMatch(
    html + navigation + css,
    /atlasSidebarResume|atlas-sidebar-resume|syncResume/
  );
  assert.match(css, /\.atlas-sidebar-recent \{[\s\S]*?flex:\s*0 0 auto/);
  assert.doesNotMatch(css, /@media \(max-height:\s*970px\)/);
  assert.match(css, /@media \(max-height:\s*850px\)/);
  assert.match(css, /@media \(max-height:\s*680px\), \(max-width:\s*799px\)/);
});

test('recent activity keeps three distinct entries and moves a revisited entry to the top', () => {
  const h = harness();
  h.visit('figure', h.catalog.figures[0]);
  h.visit('table', h.catalog.tables[0]);
  h.visit('problem', h.catalog.problems[0]);
  h.visit('equation', h.catalog.equations[0]);
  assert.deepEqual(
    Array.from(h.history.entries(), entry => entry.type),
    ['equation', 'problem', 'table']
  );
  h.visit('table', h.catalog.tables[0]);
  assert.deepEqual(
    Array.from(h.history.entries(), entry => entry.type),
    ['table', 'equation', 'problem']
  );
  const saved = JSON.parse(h.store.values.get(keyFor(h.source)));
  assert.deepEqual(saved, [
    { kind: 'entity', key: h.key('table', h.catalog.tables[0]) },
    { kind: 'entity', key: h.key('equation', h.catalog.equations[0]) },
    { kind: 'entity', key: h.key('problem', h.catalog.problems[0]) }
  ]);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE|caption|context|pdf_page|item/);
});

test('reference chapter and number distinguish entries without labels or titles', () => {
  const h = harness();
  for (const item of h.catalog.references) h.visit('reference', item);
  assert.equal(h.history.entries().length, 2);
  assert.deepEqual(
    JSON.parse(h.store.values.get(keyFor(h.source))).map(entry => entry.key),
    [h.key('reference', h.catalog.references[1]), h.key('reference', h.catalog.references[0])]
  );
});

test('all appendix keys resolve through the existing section resolver and survive reload', () => {
  const first = harness();
  const appendices = first.catalog.sections.filter(item => item.key.startsWith('appendix-'));
  for (const item of appendices) assert.equal(first.visit('section', item), true);
  assert.deepEqual(
    Array.from(first.history.entries(), entry => entry.item.key),
    ['appendix-c', 'appendix-b', 'appendix-a']
  );
  const second = harness({ store: storageFixture(first.store.values) });
  for (const entry of second.history.entries()) {
    assert.equal(entry.type, 'section');
    assert.equal(
      entry.item,
      second.catalog.sections.find(item => item.key === entry.item.key)
    );
  }
  assert.equal(second.history.entries().length, 3);
});

test('duplicate printed symbols retain their exact source page across reload', () => {
  const first = harness();
  first.visit('symbol', first.catalog.symbols[1]);
  first.visit('symbol', first.catalog.symbols[2]);
  assert.deepEqual(
    Array.from(first.history.entries(), entry => entry.item.pdf_page),
    [30, 29]
  );
  assert.deepEqual(JSON.parse(first.store.values.get(keyFor(first.source))), [
    { kind: 'entity', key: first.key('symbol', first.catalog.symbols[2]) },
    { kind: 'entity', key: first.key('symbol', first.catalog.symbols[1]) }
  ]);
  const second = harness({ store: storageFixture(first.store.values) });
  assert.equal(second.history.entries()[0].item, second.catalog.symbols[2]);
  assert.equal(second.history.entries()[1].item, second.catalog.symbols[1]);
  second.visit('symbol', second.catalog.symbols[1]);
  assert.equal(second.history.entries().length, 2);
  assert.equal(second.history.entries()[0].item, second.catalog.symbols[1]);
  assert.doesNotMatch(second.store.values.get(keyFor(second.source)), /meaning|Synthetic/);
});

test('same-page symbol duplicates additionally retain their source-order occurrence', () => {
  const catalog = catalogFixture();
  catalog.symbols[2].pdf_page = 29;
  const first = harness({ catalog });
  first.visit('symbol', first.catalog.symbols[1]);
  first.visit('symbol', first.catalog.symbols[2]);
  assert.deepEqual(JSON.parse(first.store.values.get(keyFor(first.source))), [
    { kind: 'entity', key: first.key('symbol', first.catalog.symbols[2]) },
    { kind: 'entity', key: first.key('symbol', first.catalog.symbols[1]) }
  ]);
  const second = harness({ catalog: plain(catalog), store: storageFixture(first.store.values) });
  assert.equal(second.history.entries()[0].item, second.catalog.symbols[2]);
  assert.equal(second.history.entries()[1].item, second.catalog.symbols[1]);
});

test('ambiguous or missing symbol locations are skipped while unique legacy keys still load', () => {
  const saved = [
    { kind: 'entity', key: 'symbol-E' },
    { kind: 'entity', key: 'symbol-E', page: 99 },
    { kind: 'entity', key: 'symbol-E', page: 30, occurrence: -1 },
    { kind: 'entity', key: 'symbol-E', occurrence: 1 },
    { kind: 'entity', key: 'symbol-D' }
  ];
  const h = harness({
    store: storageFixture(new Map([[legacyKeyFor('source-a'), JSON.stringify(saved)]]))
  });
  assert.equal(h.history.entries().length, 1);
  assert.equal(h.history.entries()[0].item, h.catalog.symbols[0]);
  h.visit('symbol', h.catalog.symbols[0]);
  assert.deepEqual(JSON.parse(h.store.values.get(keyFor(h.source))), [
    { kind: 'entity', key: h.key('symbol', h.catalog.symbols[0]) }
  ]);
  assert.equal(h.store.values.get(legacyKeyFor(h.source)), JSON.stringify(saved));
});

test('reloading resolves references to fresh catalog objects and preserves submitted searches', () => {
  const first = harness();
  first.visit('figure', first.catalog.figures[0]);
  first.history.remember({ kind: 'search', query: '  charge   transfer  ', scope: 'equations' });
  const second = harness({ store: storageFixture(first.store.values) });
  const entries = second.history.entries();
  assert.deepEqual(plain(entries[0]), {
    kind: 'search',
    query: 'charge transfer',
    scope: 'equations'
  });
  assert.equal(entries[1].item, second.catalog.figures[0]);
  assert.notEqual(entries[1].item, first.catalog.figures[0]);
  second.history.remember({ kind: 'search', query: 'CHARGE transfer', scope: 'equations' });
  assert.equal(second.history.entries().length, 2);
  assert.equal(second.history.entries()[0].query, 'CHARGE transfer');
  second.history.remember({ kind: 'search', query: 'charge transfer', scope: 'all' });
  assert.equal(second.history.entries().length, 3, 'different search scopes remain distinct');
});

test('concept parent qualifiers preserve the correct same-named term after reload', () => {
  const first = harness();
  first.visit('concept', first.catalog.index[0]);
  first.visit('concept', first.catalog.index[1]);
  const second = harness({ store: storageFixture(first.store.values) });
  assert.deepEqual(
    Array.from(second.history.entries(), entry => entry.item.parent),
    ['Measurements', 'Transport']
  );
  assert.equal(second.history.entries()[0].item, second.catalog.index[1]);
});

test('recent searches preserve the distinct concept and notation scopes between sessions', () => {
  const first = harness();
  first.history.remember({ kind: 'search', query: 'diffusion', scope: 'concepts' });
  first.history.remember({ kind: 'search', query: 'diffusion', scope: 'symbols' });
  const second = harness({ store: storageFixture(first.store.values) });
  assert.deepEqual(plain(second.history.entries()), [
    { kind: 'search', query: 'diffusion', scope: 'symbols' },
    { kind: 'search', query: 'diffusion', scope: 'concepts' }
  ]);
});

test('source-specific storage never reopens another PDF’s entries', () => {
  const first = harness();
  first.visit('figure', first.catalog.figures[0]);
  const other = harness({ source: 'source-b', store: storageFixture(first.store.values) });
  assert.equal(other.history.entries().length, 0);
  other.history.remember({ kind: 'search', query: 'other source', scope: 'all' });
  assert.equal(
    harness({ store: storageFixture(first.store.values) }).history.entries()[0].type,
    'figure'
  );
  const unidentified = harness({ source: '', store: storageFixture(first.store.values) });
  unidentified.visit('table', unidentified.catalog.tables[0]);
  assert.equal(unidentified.history.entries().length, 1);
  assert.equal(first.store.values.size, 2, 'an unidentified source keeps only a session list');
});

test('unavailable storage and later write failures retain usable session recents', () => {
  const temporary = createStorage({
    get localStorage() {
      throw new Error('denied');
    }
  });
  const h = harness({ store: { storage: temporary } });
  h.visit('figure', h.catalog.figures[0]);
  assert.equal(temporary.isTemporary, true);
  assert.equal(h.history.entries()[0].type, 'figure');

  const failing = storageFixture();
  failing.native.setItem = () => {
    throw new Error('quota');
  };
  const later = harness({ store: failing });
  later.history.remember({ kind: 'search', query: 'diffusion', scope: 'all' });
  assert.equal(later.history.entries()[0].query, 'diffusion');
});

test('invalid saved data and missing entities are ignored without breaking valid records', () => {
  for (const raw of ['not JSON', '{}', 'null', 'x'.repeat(32769)]) {
    const h = harness({ store: storageFixture(new Map([[keyFor('source-a'), raw]])) });
    assert.equal(h.history.entries().length, 0);
  }
  const saved = [
    null,
    { kind: 'entity', key: 'figure-missing' },
    { kind: 'entity', key: 'concept-Diffusion' },
    { kind: 'search', query: 3 },
    { kind: 'search', query: ' ' },
    { kind: 'search', query: 'x'.repeat(2049) },
    { kind: 'search', query: 'Diffusion', scope: 'unknown' },
    { kind: 'search', query: 'diffusion', scope: 'all' }
  ];
  const h = harness({
    store: storageFixture(new Map([[legacyKeyFor('source-a'), JSON.stringify(saved)]]))
  });
  assert.deepEqual(plain(h.history.entries()), [
    { kind: 'search', query: 'Diffusion', scope: 'all' }
  ]);
  h.visit('figure', h.catalog.figures[0]);
  const previous = h.history.entries()[0];
  h.catalog.figures.splice(0);
  assert.equal(h.history.resolve(previous), null);
  assert.equal(h.history.entries().length, 1);
});

test('existing aliases load as canonical references and do not create duplicate recents', () => {
  const catalog = catalogFixture();
  catalog.figures[0].label = '1 (Part 1)';
  catalog.entity_aliases['figure-1'] = 'figure-1 (Part 1)';
  const saved = [{ kind: 'entity', key: 'figure-1' }];
  const h = harness({
    catalog,
    store: storageFixture(new Map([[legacyKeyFor('source-a'), JSON.stringify(saved)]]))
  });
  assert.equal(h.history.entries()[0].item, catalog.figures[0]);
  h.visit('figure', catalog.figures[0]);
  assert.deepEqual(JSON.parse(h.store.values.get(keyFor(h.source))), [
    { kind: 'entity', key: h.key('figure', catalog.figures[0]) }
  ]);
  assert.equal(h.store.values.get(legacyKeyFor(h.source)), JSON.stringify(saved));
});

test('recent clicks reopen the resolved entity or restore the submitted query and scope', () => {
  const h = harness();
  const controls = { globalSearch: { value: '' }, searchScope: { value: 'all' } };
  const calls = [];
  const start = navigation.indexOf('  function reopenRecent(');
  const end = navigation.indexOf('\n  function record(', start);
  const reopen = vm.runInNewContext(`(${navigation.slice(start, end)})`, {
    recentHistory: h.history,
    $: id => controls[id],
    app: {
      runSearch: (...args) => calls.push(['search', ...args]),
      showEntity: (...args) => calls.push(['entity', ...args])
    },
    updateSidebarRecent() {},
    updateHomeRecent() {}
  });
  reopen({ kind: 'search', query: 'charge transfer', scope: 'equations' });
  assert.deepEqual(calls[0], ['search', 'charge transfer', 'equations']);
  assert.equal(controls.globalSearch.value, 'charge transfer');
  assert.equal(controls.searchScope.value, 'equations');
  reopen({ kind: 'entity', type: 'concept', item: h.catalog.index[1] });
  assert.equal(calls[1][1], 'concept');
  assert.equal(calls[1][2], h.catalog.index[1]);
  reopen({ kind: 'entity', type: 'symbol', item: h.catalog.symbols[2] });
  assert.equal(calls[2][1], 'symbol');
  assert.equal(calls[2][2], h.catalog.symbols[2]);
});

test('only selecting an inline PDF result commits its query; structured hits use entity visits', () => {
  const start = navigation.indexOf('  function choose(');
  const end = navigation.indexOf('\n  function fullSearch(', start);
  for (const kind of ['page', 'entry', 'view', 'calculator']) {
    const remembered = [],
      actions = [];
    const choose = vm.runInNewContext(`(${navigation.slice(start, end)})`, {
      options: [{ kind, action: () => actions.push(kind) }],
      query: 'diffusion',
      scope: 'all',
      close() {},
      touchRecent: entry => remembered.push(plain(entry))
    });
    choose(0);
    assert.deepEqual(actions, [kind]);
    assert.equal(remembered.length, kind === 'page' ? 1 : 0);
  }
  assert.match(navigation, /document\.addEventListener\('atlas-search-committed'/);
  const palette = navigation.slice(
    navigation.indexOf('  function renderPalette('),
    navigation.indexOf('  function setScope(')
  );
  assert.doesNotMatch(
    palette,
    /touchRecent|\.remember\(/,
    'typing and suggestion refreshes must not create activity'
  );
});
