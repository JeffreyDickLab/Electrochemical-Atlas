'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clientRoot = path.resolve(__dirname, '../../src/client');
const read = name => fs.readFileSync(path.join(clientRoot, name), 'utf8');
const categories = ['figures', 'tables', 'equations', 'problems', 'references'];

function classList() {
  const values = new Set();
  return {
    contains: name => values.has(name),
    add: name => values.add(name),
    remove: name => values.delete(name),
    toggle(name, force = !values.has(name)) {
      if (force) values.add(name);
      else values.delete(name);
      return force;
    }
  };
}

function fire(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value });
  }
  target.dispatchEvent(event);
  return event;
}

function navigationHarness({ width = 1200, saved = {} } = {}) {
  const document = new EventTarget();
  document.activeElement = null;
  document.querySelector = () => null;

  // Only the DOM operations used by navigation are represented here. Rendering
  // and layout remain explicit boundaries; events execute the actual modules.
  function element(tagName = 'BUTTON', parent = null) {
    const attributes = new Map();
    return Object.assign(new EventTarget(), {
      tagName,
      parent,
      dataset: {},
      classList: classList(),
      hidden: false,
      value: '',
      innerHTML: '',
      textContent: '',
      scrollTop: 0,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      removeAttribute: name => attributes.delete(name),
      focus() {
        document.activeElement = this;
      },
      closest(selector) {
        const key = selector === '[data-view]' ? 'view' : 'railIndex';
        if (Object.hasOwn(this.dataset, key)) return this;
        return this.parent?.closest(selector) || null;
      }
    });
  }

  const html = read('index.html');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const get = id => {
    const result = elements.get(id);
    assert.ok(result, `The source shell must provide #${id}`);
    return result;
  };
  document.getElementById = get;
  document.body = element('BODY');
  if (width < 800) document.body.classList.add('layout-no-nav');

  // Use the actual shell destinations, including buttons outside the five
  // catalogs, so exact active/aria-current selection is checked across the menu.
  const nav = get('mainNav');
  const navStart = html.indexOf('<nav id="mainNav"');
  assert.ok(navStart >= 0, 'The source shell must contain the main navigation');
  const navHTML = html.slice(navStart, html.indexOf('</nav>', navStart));
  const buttons = [...navHTML.matchAll(/<button\b[^>]*data-view="([^"]+)"[^>]*>/g)].map(
    ([, view]) => {
      const button = element('BUTTON', nav);
      button.dataset.view = view;
      return button;
    }
  );
  const buttonFor = view => buttons.find(button => button.dataset.view === view);
  nav.querySelector = selector => buttonFor(selector.match(/data-view="([^"]+)"/)?.[1]);
  const content = get('content');
  content.querySelector = () => null;

  const catalog = Object.fromEntries(
    categories.map(type => [
      type,
      type === 'references'
        ? [
            { chapter: 2, number: 1, text: 'First reference' },
            { chapter: 2, number: 2, text: 'Second reference' }
          ]
        : [{ label: '2.1', caption: `${type} example`, context: `${type} context` }]
    ])
  );
  const state = { view: 'home', currentEntity: null, collectionPage: 0, collectionFilter: '' };
  const calls = [];
  const window = { innerWidth: width, ATLAS_CATALOG: catalog };
  const layout = {
    atlasView() {
      calls.push(['atlasView']);
      document.body.classList.remove('layout-no-atlas');
      // This is AtlasLayout's mobile contract: choosing content closes the
      // overlay. A second toggleNav call from the list would reopen it.
      if (width < 800) document.body.classList.add('layout-no-nav');
    },
    toggleNav() {
      calls.push(['toggleNav']);
      document.body.classList.toggle('layout-no-nav');
    }
  };
  window.AtlasLayout = layout;
  const stored = new Map(Object.entries(saved));
  const context = vm.createContext({
    window,
    document,
    Event,
    CustomEvent,
    state,
    content,
    searchInput: get('globalSearch'),
    searchScope: get('searchScope'),
    readerPageInput: get('readerPage'),
    $: selector => get(selector.slice(1)),
    $$: selector => {
      assert.equal(selector, '#mainNav button');
      return buttons;
    },
    requestAnimationFrame: callback => callback(),
    debounce: callback => callback,
    renderCollection: type => calls.push(['renderCollection', type]),
    renderBookMap: filter => calls.push(['renderBookMap', filter]),
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value))
    },
    MutationObserver: class {
      observe() {}
    }
  });
  vm.runInContext(read('application/10-state-and-layout.js'), context);
  // Application files are ordered fragments of one closure. Keep every event
  // function intact, but leave the unrelated whole-app startup to its own tests.
  const events = read('application/80-events.js');
  const exportStart = events.indexOf('  window.AtlasApp =');
  assert.ok(exportStart > 0, 'The event fragment must expose the application after its functions');
  vm.runInContext(events.slice(0, exportStart), context);
  context.initEvents();
  window.AtlasApp = {
    state,
    goView: context.goView,
    showEntity(type, item) {
      calls.push(['showEntity', type, item]);
      layout.atlasView();
      state.currentEntity = { type, item };
    }
  };
  vm.runInContext(read('navigation/catalog-rail.js'), context);
  return { document, window, get, buttonFor, buttons, element, catalog, state, calls, stored };
}

for (const view of categories) {
  test(`the ${view} menu button follows the catalog route and selects only itself`, () => {
    const h = navigationHarness();
    const button = h.buttonFor(view);
    assert.ok(button, `The menu needs a direct ${view} button`);
    assert.equal(h.buttons.filter(item => item.dataset.view === view).length, 1);
    // Exercise clearing previous selection, rather than only setting a fresh one.
    for (const item of h.buttons) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'page');
    }
    h.state.currentEntity = { type: 'table', item: {} };
    h.state.collectionPage = 7;
    h.state.collectionFilter = 'previous filter';
    h.get('globalSearch').value = 'previous search';
    const locations = [];
    h.document.addEventListener('atlas-location', event => {
      locations.push([event.detail.kind, event.detail.view]);
    });

    // A click on the label/icon must reach the delegated main-menu listener.
    fire(h.get('mainNav'), 'click', { target: h.element('SPAN', button) });

    assert.deepEqual(h.calls, [['atlasView'], ['renderCollection', view]]);
    assert.equal(h.state.view, view);
    assert.equal(h.state.currentEntity, null);
    assert.equal(h.state.collectionPage, 0);
    assert.equal(h.state.collectionFilter, '');
    assert.equal(h.get('globalSearch').value, '');
    assert.deepEqual(locations, [['view', view]]);
    for (const item of h.buttons) {
      assert.equal(item.classList.contains('active'), item === button);
      assert.equal(item.getAttribute('aria-current'), item === button ? 'page' : null);
    }
    assert.equal(h.get('mainNav').hidden, false);
    assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
  });
}

test('a legacy saved open-list preference cannot hide the main menu on startup', () => {
  const h = navigationHarness({ saved: { ea_list_enabled: 'true', ea_list_type: 'references' } });
  assert.equal(h.get('mainNav').hidden, false);
  assert.equal(h.get('catalogRail').hidden, true);
  assert.equal(h.document.body.classList.contains('atlas-list-active'), false);
  assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
  assert.deepEqual(h.calls, []);

  fire(h.document, 'keydown', { key: 'L', shiftKey: true });
  assert.equal(h.get('catalogRailType').value, 'references', 'the category is still remembered');
  assert.match(h.get('catalogRailList').innerHTML, /First reference/);
});

test('Chapters opens the existing book outline and selects its single sidebar destination', () => {
  const h = navigationHarness();
  const chapters = h.buttonFor('book');
  assert.ok(chapters);
  assert.equal(h.buttons.filter(button => button.dataset.view === 'book').length, 1);
  fire(h.get('mainNav'), 'click', { target: h.element('SPAN', chapters) });
  assert.deepEqual(h.calls, [['atlasView'], ['renderBookMap', '']]);
  assert.equal(h.state.view, 'book');
  assert.equal(chapters.getAttribute('aria-current'), 'page');
  assert.equal(h.buttons.filter(button => button.classList.contains('active')).length, 1);
});

test('Shift+L toggles the optional list and Menu restores focus to its current category', () => {
  const h = navigationHarness({ saved: { ea_list_type: 'equations' } });
  const shortcut = () => fire(h.document, 'keydown', { key: 'L', shiftKey: true });
  assert.equal(shortcut().defaultPrevented, true);
  assert.equal(h.window.AtlasCatalogRail.isOpen(), true);
  assert.equal(h.get('mainNav').hidden, true);
  assert.equal(h.get('catalogRailType').value, 'equations');

  h.get('catalogRailType').value = 'tables';
  fire(h.get('catalogRailType'), 'change');
  fire(h.get('closeCatalogRail'), 'click');

  assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
  assert.equal(h.get('mainNav').hidden, false);
  assert.equal(h.get('catalogRail').hidden, true);
  assert.equal(h.document.activeElement, h.buttonFor('tables'));
  assert.equal(h.stored.get('ea_list_type'), 'tables');
  assert.deepEqual(h.calls, [], 'returning to Menu must preserve the sidebar');
  shortcut();
  assert.equal(h.window.AtlasCatalogRail.isOpen(), true);
  shortcut();
  assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
});

test('Shift+L leaves text inputs and dialogs alone', () => {
  const h = navigationHarness();
  h.document.activeElement = h.element('INPUT');
  assert.equal(fire(h.document, 'keydown', { key: 'L', shiftKey: true }).defaultPrevented, false);
  assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
  h.document.activeElement = h.buttonFor('figures');
  h.document.querySelector = selector => (selector === 'dialog[open]' ? {} : null);
  assert.equal(fire(h.document, 'keydown', { key: 'L', shiftKey: true }).defaultPrevented, false);
  assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
});

for (const action of ['index', 'entity']) {
  test(`mobile list ${action} selection closes the overlay without reopening it`, () => {
    const h = navigationHarness({ width: 640, saved: { ea_list_type: 'references' } });
    h.window.AtlasCatalogRail.open(true);
    assert.equal(h.document.body.classList.contains('layout-no-nav'), false);
    h.calls.length = 0;

    if (action === 'index') {
      fire(h.get('catalogRailOpenIndex'), 'click');
      assert.deepEqual(h.calls, [['atlasView'], ['renderCollection', 'references']]);
      assert.equal(h.state.view, 'references');
    } else {
      const entry = h.element();
      entry.dataset.railIndex = '1';
      fire(h.get('catalogRailList'), 'click', { target: h.element('SPAN', entry) });
      assert.deepEqual(h.calls, [
        ['showEntity', 'reference', h.catalog.references[1]],
        ['atlasView']
      ]);
      assert.equal(h.state.currentEntity.item, h.catalog.references[1]);
    }

    assert.equal(h.document.body.classList.contains('layout-no-nav'), true);
    assert.equal(h.window.AtlasCatalogRail.isOpen(), false);
    assert.equal(h.get('catalogRail').hidden, true);
    assert.equal(h.get('mainNav').hidden, false);
  });
}
