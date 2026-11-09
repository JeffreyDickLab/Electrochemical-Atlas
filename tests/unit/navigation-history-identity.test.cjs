'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../../src/client', name), 'utf8');
const navigation = read('navigation/controller.js');
const plain = value => JSON.parse(JSON.stringify(value));

function functionsBetween(start, end) {
  const first = navigation.indexOf(start);
  const last = navigation.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return navigation.slice(first, last);
}

function harness() {
  const catalog = {
    symbols: [
      { symbol: 'E', meaning: 'Potential', source_row: 'table-2-p28-y500000', pdf_page: 28 },
      { symbol: 'E', meaning: 'Energy', source_row: 'table-2-p28-y480000', pdf_page: 28 }
    ],
    index: [
      { term: 'Diffusion', parent: 'Transport', pages: ['10'], pdf_page: 190 },
      { term: 'Diffusion', parent: 'Transport', pages: ['20'], pdf_page: 191 }
    ],
    figures: [{ label: '7.1.1', title: 'Figure 7.1.1', pdf_page: 310 }]
  };
  const identities = vm.createContext({
    C: catalog,
    window: { ATLAS_SOURCE_SHA256: 'a'.repeat(64) }
  });
  vm.runInContext(
    read('application/10-state-and-layout.js') + '\n' + read('application/50-study-tools.js'),
    identities
  );
  const state = {
    collectionFilter: '',
    collectionPage: 0,
    collectionChapter: '',
    symbolTab: 'symbols',
    searchPage: 0
  };
  const calls = [],
    recents = [],
    searchCommits = [];
  const controls = { globalSearch: { value: '' }, searchScope: { value: 'all' } };
  const content = {
    scrollTop: 0,
    style: { removeProperty() {} },
    querySelector: () => ({ value: '' })
  };
  let context;
  const app = {
    state,
    entityKey: identities.entityKey,
    resolveEntityBookmark: identities.resolveEntityBookmark,
    showEntity(type, item, open, listContext) {
      calls.push({ kind: 'entity', type, item, open, context: listContext });
      context.record({ kind: 'entity', type, item, context: listContext });
    },
    runSearch(query, scope, page, options) {
      calls.push({ kind: 'search', query, scope, page, options });
      if (options?.record !== false) searchCommits.push(query);
      context.record({ kind: 'search', query, scope, page });
    },
    goView(view, saved) {
      calls.push({ kind: 'view', view, saved });
      context.record({ kind: 'view', view });
    }
  };
  context = vm.createContext({
    app,
    content,
    $: id => controls[id],
    lc: value => String(value).toLowerCase(),
    touchRecent: detail => recents.push(detail),
    updateHistory() {},
    updateHomeRecent() {},
    requestAnimationFrame: callback => callback()
  });
  vm.runInContext(
    'let trail = [], index = -1, restoring = false;\n' +
      functionsBetween('  function signature(', '\n  function locationText(') +
      functionsBetween(
        '  function record(',
        "\n  document.addEventListener('atlas-before-navigation'"
      ) +
      functionsBetween('  function restore(', '\n  // Breadcrumbs return'),
    context
  );
  return {
    catalog,
    context,
    app,
    state,
    calls,
    recents,
    searchCommits,
    content,
    trail: () => vm.runInContext('trail', context),
    index: () => vm.runInContext('index', context)
  };
}

test('Back and Forward distinguish same-name symbols and repeated index terms using the shared resolver', () => {
  const h = harness();
  const listContext = { type: 'symbol', items: h.catalog.symbols, filtered: true, view: 'symbols' };
  h.context.record({ kind: 'view', view: 'symbols' });
  h.context.record({
    kind: 'entity',
    type: 'symbol',
    item: h.catalog.symbols[0],
    context: listContext
  });
  h.context.record({
    kind: 'entity',
    type: 'symbol',
    item: h.catalog.symbols[1],
    context: listContext
  });
  h.context.record({ kind: 'entity', type: 'concept', item: h.catalog.index[0] });
  h.context.record({ kind: 'entity', type: 'concept', item: h.catalog.index[1] });
  assert.equal(h.trail().length, 5);
  assert.notEqual(h.trail()[1].detail.key, h.trail()[2].detail.key);
  assert.notEqual(h.trail()[3].detail.key, h.trail()[4].detail.key);
  h.context.navigateHistory(-1);
  assert.equal(h.calls.at(-1).item, h.catalog.index[0]);
  h.context.navigateHistory(-1);
  assert.equal(h.calls.at(-1).item, h.catalog.symbols[1]);
  assert.equal(h.calls.at(-1).context, listContext);
  assert.equal(h.calls.at(-1).open, true);
  h.context.navigateHistory(-1);
  assert.equal(h.calls.at(-1).item, h.catalog.symbols[0]);
  h.context.navigateHistory(1);
  assert.equal(h.calls.at(-1).item, h.catalog.symbols[1]);
  assert.equal(h.trail().length, 5, 'restoration does not append duplicate history entries');
});

test('search result pages have distinct history locations and restoration does not recommit the query', () => {
  const h = harness();
  h.context.record({ kind: 'search', query: 'diffusion', scope: 'all', page: 0 });
  h.content.scrollTop = 420;
  h.state.searchPage = 1; // Pagination updates state before the old page is captured.
  h.context.captureCurrent();
  assert.equal(h.trail()[0].detail.page, 0);
  h.context.record({ kind: 'search', query: 'diffusion', scope: 'all', page: 1 });
  assert.equal(h.trail().length, 2);
  h.context.navigateHistory(-1);
  assert.deepEqual(plain(h.calls.at(-1)), {
    kind: 'search',
    query: 'diffusion',
    scope: 'all',
    page: 0,
    options: { record: false }
  });
  assert.equal(h.content.scrollTop, 420);
  h.context.navigateHistory(1);
  assert.equal(h.calls.at(-1).page, 1);
  assert.deepEqual(h.searchCommits, []);
  assert.deepEqual(h.recents, []);
});

test('catalog history restores chapter, text filter, page and scroll while retaining the explicit entry context', () => {
  const h = harness();
  Object.assign(h.state, {
    collectionFilter: 'diffusion',
    collectionChapter: '7',
    collectionPage: 2
  });
  const listContext = {
    type: 'figure',
    items: h.catalog.figures,
    filtered: true,
    view: 'figures',
    collectionFilter: 'diffusion',
    collectionChapter: '7'
  };
  h.context.record({ kind: 'view', view: 'figures' });
  h.content.scrollTop = 180;
  h.context.captureCurrent();
  h.context.record({
    kind: 'entity',
    type: 'figure',
    item: h.catalog.figures[0],
    context: listContext
  });
  h.context.navigateHistory(-1);
  assert.deepEqual(plain(h.calls.at(-1).saved), {
    collectionFilter: 'diffusion',
    collectionPage: 2,
    collectionChapter: '7',
    symbolTab: 'symbols'
  });
  assert.equal(h.content.scrollTop, 180);
  h.context.navigateHistory(1);
  assert.equal(h.calls.at(-1).context, listContext);
});

test('a missing source row is never replaced by another row with the same printed symbol', () => {
  const h = harness();
  h.context.record({ kind: 'entity', type: 'symbol', item: h.catalog.symbols[0] });
  h.context.record({ kind: 'entity', type: 'symbol', item: h.catalog.symbols[1] });
  h.catalog.symbols.splice(0, 1);
  h.context.navigateHistory(-1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.index(), 1);
});
