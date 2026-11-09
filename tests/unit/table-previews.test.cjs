'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, 'src/client', name), 'utf8');
const manifest = JSON.parse(read('tables/source-map.json'));
const sources = ['pdf/source-regions.js', 'tables/renderer.js'].map(name => [name, read(name)]);

/** Only the element operations exercised by the renderer; no layout emulation. */
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.isConnected = true;
    this.clientWidth = 700;
    this.scrollTop = this.scrollLeft = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => {
        if (!this.classList.contains(name)) this.className += ` ${name}`;
      },
      remove: name => {
        this.className = this.className
          .split(/\s+/)
          .filter(item => item !== name)
          .join(' ');
      }
    };
    if (tag === 'canvas') {
      this.width = this.height = 1;
      const context = { canvas: this, fillRect() {} };
      this.getContext = () => context;
    }
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return this.text || '';
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
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.text = '';
    this.children = children;
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  trigger(name) {
    if (this.disabled) return Promise.resolve();
    return Promise.all(
      (this.listeners.get(name) || []).map(listener => listener({ target: this }))
    );
  }
}

const descendants = node => [node, ...node.children.flatMap(descendants)];
const named = (node, label) =>
  descendants(node).find(item => item.getAttribute('aria-label') === label);
const byClass = (node, name) => descendants(node).find(item => item.classList.contains(name));
const canvasOf = node => descendants(node).find(item => item.tagName === 'CANVAS');
const turn = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function holder(detail = true) {
  const node = new Element();
  node.className = detail ? 'table-detail-preview' : 'table-catalog-preview';
  return node;
}

function fakeDocument({
  delayed = new Map(),
  pageLoads = new Map(),
  rejectOnCancel = true,
  rotation = 0
} = {}) {
  const requested = [],
    renders = [];
  return {
    requested,
    renders,
    numPages: 1107,
    async getPage(pageNumber) {
      requested.push(pageNumber);
      if (pageLoads.has(pageNumber)) await pageLoads.get(pageNumber).promise;
      return {
        getViewport: ({ scale }) => ({
          width: (rotation === 90 ? 720 : 504.57) * scale,
          height: (rotation === 90 ? 504.57 : 720) * scale,
          scale,
          // A nonzero CropBox origin catches accidental viewport/PDF unit mixing.
          convertToPdfPoint: (x, y) =>
            rotation === 90 ? [54 + y / scale, 61 + x / scale] : [54 + x / scale, 781 - y / scale]
        }),
        render(options) {
          const gate = delayed.get(pageNumber);
          const record = { page: pageNumber, options, cancelled: 0 };
          renders.push(record);
          const promise = gate ? gate.promise : Promise.resolve();
          return {
            promise: promise.then(() => {
              options.canvasContext.canvas.sourcePage = pageNumber;
            }),
            cancel() {
              record.cancelled += 1;
              if (gate && rejectOnCancel) gate.reject(new Error('Rendering cancelled'));
            }
          };
        }
      };
    }
  };
}
function harness(pdf, options = {}) {
  const warnings = [],
    forbidden = [];
  const context = vm.createContext({
    AtlasTableManifest: options.manifest || manifest,
    ATLAS_SOURCE_SHA256: options.fingerprint ?? manifest.pdf_sha256,
    AtlasEquationPreview: { getDocument: options.getDocument || (() => pdf) },
    devicePixelRatio: options.devicePixelRatio || 1,
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    document: {
      createElement(tag) {
        const element = new Element(tag);
        if (options.viewportWidth) element.clientWidth = options.viewportWidth;
        return element;
      }
    }
  });
  context.window = context;
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch']) {
    Object.defineProperty(context, name, {
      get() {
        forbidden.push(name);
        throw new Error(name);
      }
    });
  }
  for (const [name, code] of sources) vm.runInContext(code, context, { filename: name });
  const preview = context.AtlasTablePreview;
  preview.setSource('memory:original');
  return {
    preview,
    context,
    warnings,
    clean() {
      assert.deepEqual(warnings, []);
      assert.deepEqual(forbidden, []);
    }
  };
}

test('catalog previews show the first table part without interactive descendants or persistence', async () => {
  const pdf = fakeDocument(),
    fixture = harness(pdf),
    node = holder(false);
  await fixture.preview.mount(node, '2', 27);
  assert.deepEqual(Object.keys(fixture.preview).sort(), ['mount', 'setSource']);
  assert.ok(Object.isFrozen(fixture.preview));
  assert.equal(canvasOf(node).sourcePage, 27);
  assert.match(canvasOf(node).getAttribute('aria-label'), /page 1 of 14, from PDF page 27/);
  assert.equal(byClass(node, 'table-preview-page-info').textContent, 'Page 1 of 14');
  assert.equal(byClass(node, 'table-preview-page-info').hidden, false);
  assert.equal(
    descendants(node).filter(item => ['BUTTON', 'SELECT', 'INPUT'].includes(item.tagName)).length,
    0
  );
  assert.equal(descendants(node).filter(item => item.tabIndex >= 0).length, 0);
  assert.equal(node.getAttribute('aria-busy'), null);
  await fixture.preview.mount(node, '2', 27);
  assert.equal(pdf.renders.length, 1, 'mounting the same card twice does not render twice');
  fixture.clean();
});

test('detail navigation reaches the first and last of all 14 parts and reports exact source locations', async () => {
  const pdf = fakeDocument(),
    fixture = harness(pdf),
    node = holder(),
    locations = [];
  await fixture.preview.mount(node, '2', 27, {
    onPageChange: value => locations.push({ ...value })
  });
  const select = named(node, 'Table page');
  assert.equal(select.children.length, 14);
  assert.equal(descendants(node).filter(item => item.tagName === 'BUTTON').length, 0);
  const firstCanvas = canvasOf(node);
  select.value = '1';
  await select.trigger('change');
  assert.equal(canvasOf(node).sourcePage, 28);
  assert.equal(firstCanvas.width, 0, 'changing pages releases the previous bitmap');
  select.value = '0';
  await select.trigger('change');
  assert.equal(canvasOf(node).sourcePage, 27);
  select.value = '13';
  await select.trigger('change');
  assert.equal(canvasOf(node).sourcePage, 40);
  assert.equal(select.value, '13');
  assert.match(byClass(node, 'table-preview-page-info').textContent, /14 of 14 · PDF 40/);
  assert.deepEqual(
    locations.filter(item => item.y === 0).map(item => item.page),
    [27, 28, 27, 40]
  );
  assert.equal(locations.at(-1).y, 781 - manifest.entries['2'].parts[13].crop[1]);
  const displayed = canvasOf(node);
  select.value = '99';
  await select.trigger('change');
  assert.equal(canvasOf(node), displayed, 'invalid selection cannot display another source page');
  fixture.clean();
});

test('previews fit the available width without scaling controls or inline dimensions', async () => {
  for (const detail of [false, true]) {
    const pdf = fakeDocument(),
      fixture = harness(pdf, { viewportWidth: 900, devicePixelRatio: 1.5 });
    const node = holder(detail);
    await fixture.preview.mount(node, '13.2.1', 606);
    const canvas = canvasOf(node);
    assert.ok(
      canvas.width >= 1349 && canvas.width <= 1350,
      'catalog and detail renders supply pixels for the available width and display density'
    );
    assert.ok(canvas.width * canvas.height <= 6_000_000);
    assert.equal(canvas.style.width, undefined, 'responsive width belongs to CSS');
    assert.equal(canvas.style.height, undefined, 'CSS preserves the intrinsic aspect ratio');
    assert.equal(
      descendants(node).filter(item => ['BUTTON', 'SELECT', 'INPUT'].includes(item.tagName)).length,
      0
    );
    assert.equal(
      byClass(node, 'table-preview-controls'),
      undefined,
      'single-page tables have no toolbar'
    );
    const info = byClass(node, 'table-preview-page-info');
    assert.equal(info.textContent, detail ? 'Table page 1 of 1 · PDF 606' : '');
    assert.equal(info.hidden, !detail);
    fixture.clean();
  }
  const css = read('styles/22-table-preview.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const declarations = selector =>
    rules.find(([, selectors]) =>
      selectors.split(',').some(value => value.trim() === selector)
    )?.[2] || '';
  for (const kind of ['catalog', 'detail']) {
    const fitted = declarations(`#content .table-${kind}-preview canvas.atlas-source-table`);
    assert.match(fitted, /(?:^|;)\s*width:\s*100%/);
    assert.match(fitted, /(?:^|;)\s*height:\s*auto/);
  }
  const catalogViewport = declarations('#content .table-catalog-preview .table-preview-viewport');
  assert.doesNotMatch(
    catalogViewport,
    /(?:^|;)\s*(?:height|max-height)\s*:/,
    'catalog previews retain their natural height rather than a fixed thumbnail window'
  );
});

test('another PDF receives an explicitly labeled full-page preview without applying reviewed coordinates', async () => {
  const pdf = fakeDocument(),
    fixture = harness(pdf, { fingerprint: 'a'.repeat(64) }),
    node = holder();
  await fixture.preview.mount(node, '2', 103);
  assert.equal(canvasOf(node).sourcePage, 103);
  assert.equal(byClass(node, 'table-preview-page-info').textContent, 'Original PDF page 103');
  assert.equal(named(node, 'Table page'), undefined);
  assert.equal(byClass(node, 'table-preview-controls'), undefined);
  assert.deepEqual(Array.from(pdf.renders[0].options.transform), [1, 0, 0, 1, -0, -0]);
  assert.ok(Math.abs(canvasOf(node).width / canvasOf(node).height - 504.57 / 720) < 0.002);
  fixture.clean();
});

test('missing reviewed entries and invalid fallback pages fail visibly without painting arbitrary content', async () => {
  const pdf = fakeDocument(),
    known = harness(pdf),
    unknown = harness(pdf, { fingerprint: 'b'.repeat(64) });
  for (const [fixture, label, page] of [
    [known, 'missing', 27],
    [unknown, '2', 0],
    [unknown, '2', 1108]
  ]) {
    const node = holder();
    await fixture.preview.mount(node, label, page);
    assert.equal(canvasOf(node), undefined);
    assert.match(node.textContent, /Table preview unavailable/);
    assert.equal(node.getAttribute('aria-busy'), null);
  }
  assert.equal(pdf.renders.length, 0);
  assert.equal(known.warnings.length, 1);
  assert.equal(unknown.warnings.length, 2);
});

test('reviewed regions outside the source page are rejected before rendering', async () => {
  const invalid = structuredClone(manifest);
  invalid.entries['1'].crop[2] = 9999;
  const pdf = fakeDocument(),
    fixture = harness(pdf, { manifest: invalid }),
    node = holder();
  await fixture.preview.mount(node, '1', 27);
  assert.equal(canvasOf(node), undefined);
  assert.equal(pdf.renders.length, 0);
  assert.match(fixture.warnings[0], /exceeds its source page/);
});

test('a slow earlier page cannot overwrite the latest page even if cancellation finishes late', async () => {
  const old = deferred(),
    pdf = fakeDocument({ delayed: new Map([[28, old]]), rejectOnCancel: false });
  const fixture = harness(pdf),
    node = holder();
  const { sourceButton, opened, ready } = bindApplicationSourceLink(fixture, node);
  await ready;
  const select = named(node, 'Table page');
  select.value = '1';
  const slow = select.trigger('change');
  await turn();
  select.value = '13';
  await select.trigger('change');
  const latest = canvasOf(node);
  assert.equal(latest.sourcePage, 40);
  old.resolve();
  await slow;
  assert.equal(canvasOf(node), latest);
  await sourceButton.trigger('click');
  assert.equal(opened.at(-1).page, 40, 'a stale completion cannot retarget Open in PDF');
  assert.equal(opened.at(-1).y, 781 - manifest.entries['2'].parts[13].crop[1]);
  assert.equal(pdf.renders.find(item => item.page === 28).cancelled, 1);
  assert.equal(pdf.renders.find(item => item.page === 28).options.canvasContext.canvas.width, 0);
  fixture.clean();
});

test('a source switch cancels active work, discards queued jobs and paints only the replacement source', async () => {
  const gates = [deferred(), deferred()];
  const old = fakeDocument({
    delayed: new Map([
      [27, gates[0]],
      [41, gates[1]]
    ])
  });
  const current = fakeDocument();
  let active = old;
  const fixture = harness(old, { getDocument: () => active });
  const nodes = [holder(), holder(), holder()];
  const jobs = [
    fixture.preview.mount(nodes[0], '1', 27),
    fixture.preview.mount(nodes[1], '3', 41),
    fixture.preview.mount(nodes[2], '5', 49)
  ];
  await turn();
  assert.equal(old.renders.length, 2, 'only two PDF renders run simultaneously');
  active = current;
  fixture.preview.setSource('memory:new');
  const fresh = fixture.preview.mount(nodes[0], 'C.2', 1066);
  await Promise.all([...jobs, fresh]);
  assert.equal(old.renders.filter(item => item.cancelled > 0).length, 2);
  assert.deepEqual(old.requested, [27, 41], 'queued old source must never request a page');
  assert.equal(canvasOf(nodes[0]).sourcePage, 1066);
  assert.equal(canvasOf(nodes[1]), undefined);
  assert.equal(canvasOf(nodes[2]), undefined);
  fixture.clean();
});

test('a late document load cannot rebuild or retarget a preview from the replacement source', async () => {
  const late = deferred(),
    pdf = fakeDocument();
  let active = late.promise;
  const fixture = harness(pdf, { getDocument: () => active }),
    node = holder(),
    pages = [];
  const old = fixture.preview.mount(node, '2', 27, {
    onPageChange: value => pages.push(value.page)
  });
  active = pdf;
  fixture.preview.setSource('memory:new');
  await fixture.preview.mount(node, 'C.2', 1066, { onPageChange: value => pages.push(value.page) });
  const displayed = canvasOf(node);
  late.resolve(pdf);
  await old;
  assert.equal(canvasOf(node), displayed);
  assert.deepEqual(pages, [1066, 1066]);
  fixture.clean();
});

test('a preview removed during rendering releases its unfinished bitmap and never displays it', async () => {
  const gate = deferred(),
    pdf = fakeDocument({ delayed: new Map([[27, gate]]) });
  const fixture = harness(pdf),
    node = holder();
  const job = fixture.preview.mount(node, '1', 27);
  await turn();
  node.isConnected = false;
  gate.resolve();
  await job;
  assert.equal(canvasOf(node), undefined);
  assert.equal(pdf.renders[0].options.canvasContext.canvas.width, 0);
  fixture.clean();
});

/** Extract named production functions without booting the entire application. */
function productionFunction(file, name) {
  const code = read(file);
  const start = code.indexOf(`  function ${name}(`);
  const end = code.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, `${file}: cannot locate ${name}`);
  return code.slice(start, end);
}

function bindApplicationSourceLink(fixture, node) {
  const sourceButton = new Element('button');
  node.dataset = { tableLabel: '2', tablePage: '27' };
  sourceButton.dataset = { openPdf: '27', targetY: '0', sourceFocus: 'false' };
  const applicationRoot = {
    querySelectorAll(selector) {
      if (selector === '.table-detail-preview[data-table-label]') return [node];
      if (selector === '[data-open-pdf]') return [sourceButton];
      return [];
    },
    querySelector(selector) {
      assert.equal(selector, '.detail-header [data-open-pdf]');
      return sourceButton;
    }
  };
  const opened = [],
    context = fixture.context;
  Object.assign(context, {
    url: 'blob:original-pdf',
    zoom: 100,
    C: { meta: { pdf_pages: 1107 } },
    AtlasReader: { yFromTop: (page, top) => context.pageHeight(page) - top },
    ATLAS_PDF_ENGINE: {
      pageObjects: Array.from({ length: 1107 }, (_, index) => index + 1),
      get: () => '/CropBox [54 61 558.57 781]'
    },
    $$: (selector, scope) => scope.querySelectorAll(selector),
    state: { currentEntity: { type: 'table', item: { label: '2' } } },
    entityTitle: () => 'Table 2',
    openPdf(page, title, { targetY: y, snap }) {
      opened.push({ page, y, snap, url: context.sourceUrl(page, y) });
    }
  });
  for (const [file, names] of [
    ['pdf/reader.js', ['pageHeight', 'usesFirefoxPdfViewer', 'sourceUrl']],
    ['application/60-entity-details.js', ['reviewedTablePart', 'sourcePdfY', 'bindSourcePreviews']],
    ['application/80-events.js', ['bindCommonActions', 'bindEntityButtons']]
  ]) {
    for (const name of names)
      vm.runInContext(productionFunction(file, name), context, { filename: file });
  }
  context.bindCommonActions(applicationRoot);
  context.bindSourcePreviews(applicationRoot);
  // The production binder starts mounting asynchronously; the same mount returns its ready promise.
  return { sourceButton, opened, context, ready: fixture.preview.mount(node, '2', 27) };
}

test('Open in PDF receives bottom-origin PDF points through the actual application and reader functions', async () => {
  const pdf = fakeDocument(),
    fixture = harness(pdf),
    node = holder();
  const { sourceButton, opened, context, ready } = bindApplicationSourceLink(fixture, node);
  await ready;
  const first = manifest.entries['2'].parts[0];
  const expectedY = 781 - first.crop[1];
  assert.equal(Number(sourceButton.dataset.targetY), expectedY);
  await sourceButton.trigger('click');
  assert.deepEqual(opened.at(-1), {
    page: 27,
    y: expectedY,
    snap: true,
    url: 'blob:original-pdf#page=27&zoom=100,0,322'
  });
  const select = named(node, 'Table page');
  select.value = '13';
  await select.trigger('change');
  await sourceButton.trigger('click');
  assert.equal(opened.at(-1).page, 40);
  assert.equal(opened.at(-1).y, 781 - manifest.entries['2'].parts[13].crop[1]);
  assert.equal(opened.at(-1).url, 'blob:original-pdf#page=40&zoom=100,0,0');
  fixture.clean();
});

test('source locations use the page viewport conversion on rotated pages', async () => {
  const pdf = fakeDocument({ rotation: 90 }),
    fixture = harness(pdf),
    node = holder();
  const locations = [];
  await fixture.preview.mount(node, '1', 27, {
    onPageChange: value => locations.push({ ...value })
  });
  assert.deepEqual(locations, [
    { page: 27, y: 0 },
    { page: 27, y: 61 + manifest.entries['1'].crop[0] }
  ]);
  fixture.clean();
});

test('Open in PDF follows a pending selection immediately and survives page loading or rendering failure', async () => {
  const loading = deferred(),
    painting = deferred(),
    rejectedPage = deferred();
  const pdf = fakeDocument({
    pageLoads: new Map([
      [28, loading],
      [29, rejectedPage]
    ]),
    delayed: new Map([[28, painting]])
  });
  const fixture = harness(pdf),
    node = holder();
  const { sourceButton, opened, ready } = bindApplicationSourceLink(fixture, node);
  await ready;
  const select = named(node, 'Table page');
  select.value = '1';
  const navigation = select.trigger('change');
  const targetY = 781 - manifest.entries['2'].parts[1].crop[1];
  assert.equal(sourceButton.dataset.openPdf, '28', 'selection updates the link synchronously');
  assert.equal(Number(sourceButton.dataset.targetY), targetY, 'reviewed geometry is immediate');
  await sourceButton.trigger('click');
  assert.equal(opened.at(-1).url, 'blob:original-pdf#page=28&zoom=100,0,0');

  loading.resolve();
  await turn();
  assert.equal(
    Number(sourceButton.dataset.targetY),
    targetY,
    'viewport refines the target before painting finishes'
  );
  assert.equal(canvasOf(node), undefined, 'the new bitmap is still pending');
  painting.reject(new Error('deliberate render failure'));
  await navigation;
  await sourceButton.trigger('click');
  assert.deepEqual(opened.at(-1), {
    page: 28,
    y: targetY,
    snap: true,
    url: 'blob:original-pdf#page=28&zoom=100,0,0'
  });
  assert.ok(node.classList.contains('table-preview-unavailable'));

  select.value = '2';
  const failedLoad = select.trigger('change');
  const top = manifest.entries['2'].parts[2].crop[1];
  assert.equal(sourceButton.dataset.openPdf, '29');
  assert.equal(Number(sourceButton.dataset.targetY), 781 - top);
  rejectedPage.reject(new Error('deliberate page loading failure'));
  await failedLoad;
  await sourceButton.trigger('click');
  assert.deepEqual(opened.at(-1), {
    page: 29,
    y: 781 - top,
    snap: true,
    url: `blob:original-pdf#page=29&zoom=100,0,${Math.max(0, Math.round(top - 115))}`
  });
  assert.equal(fixture.warnings.length, 2, 'only the two deliberately failed operations warn');
});
