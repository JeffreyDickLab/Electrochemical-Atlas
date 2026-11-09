'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const source = p => fs.readFileSync(path.join(root, 'src/client', p), 'utf8');
const built = p => fs.readFileSync(path.join(root, 'app', p), 'utf8');

function workspaceFixture() {
  const window = Object.assign(new EventTarget(), { innerWidth: 1440 });
  const element = () => {
    const classes = new Set();
    return Object.assign(new EventTarget(), {
      clientWidth: 600,
      hidden: true,
      classList: {
        contains: name => classes.has(name),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        toggle(name, visible) {
          if (visible) classes.add(name);
          else classes.delete(name);
        }
      },
      closest: () => ({ clientWidth: window.innerWidth }),
      setAttribute() {}
    });
  };
  const elements = new Map();
  const document = Object.assign(new EventTarget(), {
    body: element(),
    documentElement: { style: { setProperty() {} } },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelector: element,
    querySelectorAll: () => []
  });
  const storage = new Map();
  const context = vm.createContext({
    window,
    document,
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value)
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame() {}
  });
  vm.runInContext(source('layout/controller.js'), context);
  return {
    context,
    layout: window.AtlasLayout,
    resize(width) {
      window.innerWidth = width;
      window.dispatchEvent(new Event('resize'));
    },
    panes: () =>
      ['nav', 'atlas', 'book'].filter(
        pane => !document.body.classList.contains('layout-no-' + pane)
      )
  };
}

function readerFixture(resumeSourceId, values = new Map()) {
  const fixture = workspaceFixture();
  const { context } = fixture;
  const jumps = [];
  const resumeLabel = {};
  const state = { readerPage: 1, readerHistory: [], readerHistoryIndex: -1 };
  const resumeStorageKey = resumeSourceId ? `ea_resume_page_v6:${resumeSourceId}` : '';
  Object.assign(context.window, {
    ATLAS_IMPORT_START_PAGE: 3,
    AtlasReader: {
      current: () => jumps.at(-1)?.page,
      position: () => jumps.at(-1)?.targetY ?? 0,
      show: (page, targetY, reveal, navigation) => jumps.push({ page, targetY, reveal, navigation })
    }
  });
  Object.assign(context, {
    state,
    resumeSourceId,
    resumeStorageKey,
    booting: true,
    C: { meta: { pdf_pages: 100 } },
    content: { querySelector: () => resumeLabel },
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    user: { bookmarks: { pages: [] } },
    readerPageInput: {},
    readerPrinted: {},
    readerMessage: {},
    pageByNumber: new Map(),
    $: selector => context.document.getElementById(selector),
    CustomEvent
  });
  vm.runInContext(source('application/10-state-and-layout.js'), context);
  state.resumePage = context.loadResumePage();
  context.openPdf(state.resumePage, 'Your imported PDF');
  context.booting = false;
  return { ...fixture, state, jumps, resumeLabel, resumeStorageKey };
}

test('desktop Menu visibility is independent of Explore, Together and Read', () => {
  const { layout, panes } = workspaceFixture();
  for (const menu of [['nav'], []]) {
    for (const [preset, content] of [
      ['browse', ['atlas']],
      ['study', ['atlas', 'book']],
      ['read', ['book']]
    ]) {
      layout.setPreset(preset);
      assert.deepEqual(panes(), [...menu, ...content]);
    }
    layout.toggleNav();
    assert.deepEqual(panes(), menu.length ? ['book'] : ['nav', 'book']);
  }
});

test('a narrow viewport shows Read and restores Together and Menu on return', () => {
  for (const menuOpen of [true, false]) {
    const { layout, panes, resize } = workspaceFixture();
    if (!menuOpen) layout.toggleNav();
    layout.setPreset('study');
    resize(600);
    assert.deepEqual(panes(), ['book']);
    layout.toggleNav();
    assert.deepEqual(panes(), ['nav', 'book']);
    resize(1440);
    assert.deepEqual(panes(), menuOpen ? ['nav', 'atlas', 'book'] : ['atlas', 'book']);
    resize(600);
    assert.deepEqual(panes(), ['book']);
    layout.setPreset('read');
    resize(1440);
    assert.deepEqual(panes(), menuOpen ? ['nav', 'book'] : ['book']);
  }
});

test('an equation source link keeps Together open and preserves the PDF target', () => {
  const { context, layout, panes, state, jumps } = readerFixture('a'.repeat(64));
  const sourceButton = Object.assign(new EventTarget(), {
    dataset: { openPdf: '27', sourceFocus: 'true', targetY: '410' }
  });
  state.currentEntity = { type: 'equation', item: { label: '1.6.1' } };
  Object.assign(context, {
    $$: selector => (selector === '[data-open-pdf]' ? [sourceButton] : []),
    entityTitle: () => 'Equation 1.6.1'
  });
  const events = source('application/80-events.js');
  vm.runInContext(events.slice(0, events.indexOf('  function initEvents(')), context);
  context.bindCommonActions({});

  layout.setPreset('study');
  sourceButton.dispatchEvent(new Event('click'));
  assert.deepEqual(panes(), ['nav', 'atlas', 'book']);
  assert.deepEqual(jumps.at(-1), { page: 27, targetY: 410, reveal: true, navigation: 'snap' });

  layout.setPreset('browse');
  sourceButton.dispatchEvent(new Event('click'));
  assert.deepEqual(panes(), ['nav', 'book']);
  assert.deepEqual(jumps.at(-1), { page: 27, targetY: 410, reveal: true, navigation: 'snap' });
});

test('Continue reading is scoped to the PDF and ignores automatic catalog previews', () => {
  const values = new Map([['ea_resume_page_v5', '17']]);
  const firstSource = 'a'.repeat(64);
  const secondSource = 'b'.repeat(64);
  const first = readerFixture(firstSource, values);
  assert.equal(first.state.resumePage, 17);
  first.context.openPdf(42, 'Deliberate PDF jump');
  assert.equal(first.resumeLabel.textContent, 'PDF 42');
  assert.equal(values.get(first.resumeStorageKey), '42');

  first.context.openPdf(63, 'Hidden catalog preview', { reveal: false, remember: false });
  first.context.openPdf(75, 'Visible catalog preview', { remember: false });
  assert.equal(first.state.readerPage, 75);
  assert.equal(first.state.resumePage, 42);
  assert.equal(first.resumeLabel.textContent, 'PDF 42');
  assert.equal(values.get(first.resumeStorageKey), '42');

  const second = readerFixture(secondSource, values);
  assert.equal(second.state.resumePage, 3);
  second.context.openPdf(26, 'Second PDF reading');
  assert.equal(readerFixture(firstSource, values).state.readerPage, 42);
  assert.equal(readerFixture(secondSource, values).state.readerPage, 26);
  assert.equal(values.get('ea_resume_page_v5'), '17');
});

test('a legacy resume page is used only when its source can be claimed', () => {
  const values = new Map([['ea_resume_page_v5', '17']]);
  values.set = () => {
    throw new Error('Storage is read-only');
  };
  assert.equal(readerFixture('a'.repeat(64), values).state.resumePage, 3);
});

test('sidebar reading meter and its DOM update logic are removed', () => {
  const html = source('index.html');
  assert.doesNotMatch(html, /id="progressText"|id="progressBar"|class="progress-label"/);
  assert.match(html, /id="importProgressBar"/, 'PDF import progress remains');
  assert.doesNotMatch(
    source('application/10-state-and-layout.js'),
    /updateProgress\(|#progressText|#progressBar/
  );
  assert.doesNotMatch(source('application/80-events.js'), /updateProgress\(/);
  assert.match(
    source('application/40-catalog.js'),
    /\$\{pct\}% complete/,
    'study-path completion is preserved'
  );
  assert.match(
    source('application/50-study-tools.js'),
    /clearProgress/,
    'saved read history remains editable'
  );
});

test('navigation has three deliberate groups and each destination exactly once', () => {
  const html = source('index.html');
  const groups = [
    ...html.matchAll(
      /class="atlas-nav-label[^\"]*"\s+role="heading"\s+aria-level="2"\s*>\s*([^<]+)<\/div\s*>/g
    )
  ].map(m => m[1].trim().toLowerCase());
  assert.deepEqual(groups, ['explore', 'workspace', 'reference library']);
  const dest = [...html.matchAll(/<button[^>]*data-view="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(dest, [
    'home',
    'book',
    'paths',
    'calculators',
    'notes',
    'concepts',
    'symbols',
    'figures',
    'tables',
    'equations',
    'problems',
    'references'
  ]);
  assert.equal(new Set(dest).size, 12);
  assert.match(
    html,
    /data-view="book"[^>]*title="Chapters"[\s\S]*?class="atlas-sidebar-text">Chapters<\/span>/,
    'the existing chapter-outline destination has the same label as search'
  );
  assert.doesNotMatch(html, /id="browseReferences"|data-view="browse"/);
  assert.match(source('application/80-events.js'), /goView\(btn\.dataset\.view\)/);
  assert.doesNotMatch(html, /id="openBookExternal"|class="sidebar-footer"/);
  assert.match(
    html,
    /id="openCurrentExternal"/,
    'the primary PDF reader still supports opening the source separately'
  );
  assert.doesNotMatch(source('application/80-events.js'), /openBookExternal/);
});

test('single responsive header preserves the Atlas controls and command search', () => {
  const js = source('navigation/toolbar.js');
  const css = source('styles/18-toolbar.css');
  assert.match(js, /searchArea\.append\(search\)/);
  assert.match(js, /toolbar\.replaceChildren\(history,\s*searchArea,\s*right\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(170px,\s*215px\)/);
  assert.match(css, /@media \(max-width:\s*740px\)/);
  assert.match(css, /\.atlas-compact-mode/);
  assert.match(css, /\.atlas-mobile-nav-actions/);
  assert.match(js, /syncMobileAvailability/);
});

test('pane mode visibility wins over general flex-pane rules', () => {
  const css = source('styles/19-workspace-organization.css');
  assert.match(css, /body\.layout-no-nav \.workspace \.sidebar/);
  assert.match(css, /body\.layout-no-book \.workspace \.reader/);
  assert.match(css, /body\.layout-no-atlas \.workspace \.atlas-area/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /@container \(max-width:\s*690px\)/);
  assert.match(css, /@media \(max-width:\s*799px\)/);
});

test('shipped runtime has the same shell, layout logic and CSS as maintained source', () => {
  assert.equal(built('index.html'), source('index.html'));
  assert.equal(built('layout-controller.js'), source('layout/controller.js'));
  assert.equal(built('navigation.js'), source('navigation/controller.js'));
  assert.equal(built('toolbar.js'), source('navigation/toolbar.js'));
  const files = fs
    .readdirSync(path.join(root, 'src/client/styles'))
    .filter(x => x.endsWith('.css'))
    .sort();
  const compiled = files
    .map(x => '/* ' + x + ' */\n' + source('styles/' + x).trimEnd() + '\n')
    .join('\n');
  assert.equal(built('atlas.css'), compiled);
  assert.match(built('app.js'), /function markSectionRead\(/);
  assert.doesNotMatch(built('app.js'), /updateProgress\(/);
});

test('no floating PDF-link banner obscures the lower-right reader', () => {
  assert.doesNotMatch(source('index.html'), /id="pdfLinkInfo"|class="pdf-link-info"/);
  assert.doesNotMatch(source('styles/04-pdf-import.css'), /\.pdf-link-info/);
  assert.doesNotMatch(source('pdf/reader.js'), /pdfLinkInfo|visibleLinks/);
  assert.match(source('pdf/reader.js'), /highlightLinks/, 'PDF link help remains available');
});
