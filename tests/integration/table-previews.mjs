/**
 * Verify the maintained table renderer against the developer's original PDF.
 *
 * npm ci --include=optional
 * npm run build
 * ATLAS_TEST_PDF=/path/to/original.pdf node tests/integration/table-previews.mjs
 *
 * PDF.js uses its supported Node (legacy) build and real @napi-rs/canvas.
 * Only the DOM is a stand-in; this does not verify browser layout or scrolling.
 * All 81 reviewed parts, catalog coverage, page selection, automatic sizing, source fallback,
 * and cancellation of real RenderTasks are checked. No artwork is written.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const client = join(root, 'src/client');
const require = createRequire(import.meta.url);
const pdfPath = process.env.ATLAS_TEST_PDF;
const expectedTables = 52;
const expectedParts = 81;

async function evaluate(context, names) {
  for (const name of names) {
    runInContext(await readFile(join(client, name), 'utf8'), context, { filename: name });
  }
}

async function importTables(bytes) {
  const context = createContext({ Blob, File, Response, DecompressionStream, setTimeout, console });
  context.window = context;
  await evaluate(context, ['core/text.js', 'pdf/pdf-core.js', 'pdf/catalog-extractor.js']);
  const file = new File([bytes], 'original.pdf', { type: 'application/pdf' });
  const engine = await new context.AtlasPDFCore.PDFLite(file).init(() => {});
  const { catalog } = await context.AtlasRuntimeCatalog.build(engine, () => {});
  assert.equal(catalog.meta.counts.tables, expectedTables);
  return Array.from(catalog.tables, ({ label, pdf_page }) => ({ label, pdf_page }));
}

function attributes(node, tag) {
  const values = new Map();
  node.tagName = tag.toUpperCase();
  node.className = '';
  node.style = {};
  node.setAttribute = (name, value) => values.set(name, String(value));
  node.getAttribute = name => values.get(name) ?? null;
  node.removeAttribute = name => values.delete(name);
  node.classList = {
    contains: name => node.className.split(/\s+/).includes(name),
    add: name => {
      if (!node.classList.contains(name)) node.className += ` ${name}`;
    },
    remove: name => {
      node.className = node.className
        .split(/\s+/)
        .filter(item => item !== name)
        .join(' ');
    }
  };
  return node;
}

/** Just the DOM methods used by the renderer, with awaitable user actions. */
class Element {
  constructor(tag = 'div') {
    attributes(this, tag);
    this.children = [];
    this.listeners = new Map();
    this.isConnected = true;
    this.clientWidth = 700;
    this.scrollTop = this.scrollLeft = 0;
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return this.text || '';
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
const descendants = node => [node, ...(node.children || []).flatMap(descendants)];
const named = (node, label) =>
  descendants(node).find(item => item.getAttribute('aria-label') === label);
const byClass = (node, name) => descendants(node).find(item => item.classList.contains(name));
const canvasOf = node => descendants(node).find(item => item.tagName === 'CANVAS');
function makeHolder(detail = true) {
  const holder = new Element();
  holder.className = detail ? 'table-detail-preview' : 'table-catalog-preview';
  return holder;
}
function release(holder) {
  for (const canvas of descendants(holder).filter(item => item.tagName === 'CANVAS')) {
    canvas.width = 0;
    canvas.height = 0;
  }
  holder.replaceChildren();
  holder.isConnected = false;
}

async function createFixture(canvasBackend, manifest, fingerprint, getDocument) {
  const warnings = [],
    forbidden = [];
  const context = createContext({
    AtlasTableManifest: manifest,
    ATLAS_SOURCE_SHA256: fingerprint,
    AtlasEquationPreview: { getDocument },
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    document: {
      createElement(tag) {
        if (tag === 'canvas') return attributes(canvasBackend.createCanvas(1, 1), tag);
        assert.ok(['div', 'span', 'select', 'option'].includes(tag));
        return new Element(tag);
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
  await evaluate(context, ['pdf/source-regions.js', 'tables/renderer.js']);
  const preview = context.AtlasTablePreview;
  assert.deepEqual(Object.keys(preview).sort(), ['mount', 'setSource']);
  assert.ok(Object.isFrozen(preview));
  return {
    preview,
    regions: context.AtlasSourceRegions,
    assertClean() {
      assert.deepEqual(warnings, [], 'Table renderer reported a failure');
      assert.deepEqual(
        forbidden,
        [],
        'Rendering must not store artwork or use independent networking'
      );
    }
  };
}

function assertInk(canvas, label) {
  assert.ok(canvas?.width > 0 && canvas?.height > 0, `${label}: missing canvas`);
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0,
    paper = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (!data[offset + 3]) continue;
    const brightness = data[offset] + data[offset + 1] + data[offset + 2];
    if (brightness < 720) ink += 1;
    if (brightness > 750) paper += 1;
  }
  assert.ok(ink >= 64, `${label}: no meaningful source ink`);
  assert.ok(paper >= 64, `${label}: no visible paper or margin`);
}

async function deadline(promise, label, milliseconds = 30_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function capturePDFWarnings() {
  const warnings = [],
    original = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
    original(...args);
  };
  return {
    assertClean() {
      assert.deepEqual(warnings, [], 'PDF.js could not decode source content');
    },
    restore() {
      console.warn = original;
    }
  };
}

async function renderAll(pdf, tables, fixture, manifest) {
  assert.equal(new Set(tables.map(item => item.label)).size, expectedTables);
  assert.deepEqual(tables.map(item => item.label).sort(), Object.keys(manifest.entries).sort());
  let checked = 0;
  fixture.preview.setSource('memory:original');
  for (const { label, pdf_page } of tables) {
    const parts = fixture.regions.findParts(manifest, label);
    assert.ok(parts, `${label}: valid reviewed parts required`);
    assert.equal(parts[0].page, pdf_page, `${label}: catalog must open the first printed page`);
    const holder = makeHolder(),
      locations = [];
    await fixture.preview.mount(holder, label, pdf_page, {
      onPageChange: value => locations.push({ ...value })
    });
    for (let index = 0; index < parts.length; index++) {
      if (index) {
        const select = named(holder, 'Table page');
        select.value = String(index);
        await select.trigger('change');
      }
      const part = parts[index],
        canvas = canvasOf(holder),
        name = `Table ${label}, part ${index + 1}`;
      assert.equal(holder.getAttribute('aria-busy'), null, `${name}: still busy`);
      assert.equal(holder.classList.contains('table-preview-unavailable'), false);
      assert.equal(canvas?.getAttribute('role'), 'img');
      assert.equal(
        canvas?.getAttribute('aria-label'),
        `Table ${label}, page ${index + 1} of ${parts.length}, from PDF page ${part.page}`
      );
      assertInk(canvas, name);
      const width = part.crop[2] - part.crop[0],
        height = part.crop[3] - part.crop[1];
      const aspectError = Math.abs(canvas.width / canvas.height / (width / height) - 1);
      assert.ok(aspectError < 0.01, `${name}: original aspect ratio must be preserved`);
      assert.ok(canvas.width * canvas.height <= 6_000_000, `${name}: canvas budget exceeded`);
      const base = (await pdf.getPage(part.page)).getViewport({ scale: 1 });
      assert.deepEqual(
        locations.slice(index * 2, index * 2 + 2),
        [
          { page: part.page, y: 0 },
          { page: part.page, y: base.convertToPdfPoint(part.crop[0], part.crop[1])[1] }
        ],
        `${name}: publish selection, then refine its PDF-point target`
      );
      assert.equal(descendants(holder).filter(item => item.tagName === 'BUTTON').length, 0);
      assert.equal(canvas.style.width, undefined, `${name}: CSS controls responsive width`);
      assert.equal(canvas.style.height, undefined, `${name}: CSS preserves the aspect ratio`);
      const selector = named(holder, 'Table page');
      if (parts.length > 1) {
        assert.equal(selector.children.length, parts.length);
        assert.equal(selector.value, String(index));
      } else {
        assert.equal(selector, undefined);
        assert.equal(byClass(holder, 'table-preview-controls'), undefined);
      }
      checked += 1;
      if (checked % 10 === 0)
        console.log(`Rendered and checked ${checked}/${expectedParts} table parts.`);
      (await pdf.getPage(part.page)).cleanup();
    }
    assert.equal(
      locations.length,
      parts.length * 2,
      `${label}: selection and precise target are each published once per part`
    );
    release(holder);
  }
  assert.equal(checked, expectedParts);
  fixture.assertClean();
  console.log(`Rendered and checked ${checked}/${expectedParts} table parts.`);
}

async function checkCardSizingAndFallback(pdf, makeFixture) {
  const fixture = await makeFixture(() => pdf),
    card = makeHolder(false);
  fixture.preview.setSource('memory:original');
  await fixture.preview.mount(card, '2', 27);
  assertInk(canvasOf(card), 'Table 2 catalog card');
  assert.equal(
    descendants(card).filter(item => ['BUTTON', 'SELECT', 'INPUT'].includes(item.tagName)).length,
    0
  );
  assert.match(canvasOf(card).getAttribute('aria-label'), /from PDF page 27$/);
  assert.equal(byClass(card, 'table-preview-page-info').textContent, 'Page 1 of 14');
  assert.equal(canvasOf(card).style.width, undefined);
  release(card);

  const detail = makeHolder();
  await fixture.preview.mount(detail, '13.2.1', 606);
  assertInk(canvasOf(detail), 'Mathematical table at automatic width');
  assert.equal(canvasOf(detail).style.width, undefined);
  assert.equal(canvasOf(detail).style.height, undefined);
  assert.equal(named(detail, 'Table page'), undefined);
  assert.equal(byClass(detail, 'table-preview-controls'), undefined);
  release(detail);
  fixture.assertClean();

  const fallback = await makeFixture(() => pdf, 'a'.repeat(64)),
    other = makeHolder();
  fallback.preview.setSource('memory:other-source');
  await fallback.preview.mount(other, '2', 125);
  assertInk(canvasOf(other), 'Explicit source-page fallback');
  assert.equal(byClass(other, 'table-preview-page-info').textContent, 'Original PDF page 125');
  const base = (await pdf.getPage(125)).getViewport({ scale: 1 });
  assert.ok(
    Math.abs(canvasOf(other).width / canvasOf(other).height - base.width / base.height) < 0.002
  );
  assert.equal(named(other, 'Table page'), undefined);
  assert.equal(byClass(other, 'table-preview-controls'), undefined);
  release(other);
  fallback.assertClean();
}

async function checkRealCancellation(pdf, makeFixture) {
  let resumeCheck,
    pausedCount = 0;
  const paused = new Promise(resolve => {
    resumeCheck = resolve;
  });
  const requested = [],
    cancelled = new Set();
  const old = {
    numPages: pdf.numPages,
    async getPage(number) {
      requested.push(number);
      const page = await pdf.getPage(number);
      return {
        getViewport: options => page.getViewport(options),
        render(options) {
          const task = page.render(options);
          // PDF.js's public hook pauses real RenderTasks until cancellation.
          task.onContinue = () => {
            if (++pausedCount === 2) resumeCheck();
          };
          return {
            promise: task.promise,
            cancel() {
              cancelled.add(task);
              task.cancel();
            }
          };
        }
      };
    }
  };
  let current = old;
  const fixture = await makeFixture(() => current),
    holders = [makeHolder(), makeHolder(), makeHolder()];
  fixture.preview.setSource('memory:old');
  const jobs = [
    fixture.preview.mount(holders[0], '1', 27),
    fixture.preview.mount(holders[1], '3', 41),
    fixture.preview.mount(holders[2], 'C.2', 1066)
  ];
  await deadline(paused, 'two real RenderTasks to pause');
  assert.deepEqual(requested, [27, 41]);
  current = pdf;
  fixture.preview.setSource('memory:new');
  const fresh = fixture.preview.mount(holders[0], 'C.4', 1068);
  await deadline(Promise.all([...jobs, fresh]), 'source replacement');
  assert.equal(cancelled.size, 2, 'both real active RenderTasks must be cancelled');
  assert.deepEqual(requested, [27, 41], 'the queued old source must never request a page');
  assert.match(canvasOf(holders[0]).getAttribute('aria-label'), /PDF page 1068$/);
  assertInk(canvasOf(holders[0]), 'Replacement source table');
  assert.equal(canvasOf(holders[1]), undefined);
  assert.equal(canvasOf(holders[2]), undefined);
  fixture.assertClean();
  holders.forEach(release);
}

async function main() {
  let canvasBackend;
  try {
    canvasBackend = require('@napi-rs/canvas');
  } catch (cause) {
    throw new Error('Install PDF.js optional dependencies with npm ci --include=optional.', {
      cause
    });
  }
  const manifest = JSON.parse(await readFile(join(client, 'tables/source-map.json'), 'utf8'));
  const bytes = await readFile(resolve(pdfPath));
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    fingerprint,
    manifest.pdf_sha256,
    'Use the original PDF matching the reviewed table map'
  );
  console.log('Importing the real table catalog from the supplied PDF…');
  const tables = await importTables(bytes);
  const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfjs = await import(pathToFileURL(join(packageRoot, 'legacy/build/pdf.mjs')).href);
  const packageJSON = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pdfjs.version, packageJSON.dependencies['pdfjs-dist']);
  const codecDirectory = join(root, 'app/vendor/pdfjs-codecs');
  const assets = JSON.parse(await readFile(join(root, 'tools/pdfjs-assets.json'), 'utf8'));
  await Promise.all(assets.codecs.map(name => access(join(codecDirectory, name))));
  const warnings = capturePDFWarnings();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    isEvalSupported: false,
    // Same resources as the application loader; Node reads them from disk.
    wasmUrl: codecDirectory.replaceAll('\\', '/') + '/'
  });
  try {
    const pdf = await loadingTask.promise;
    assert.equal(pdf.numPages, manifest.pdf_pages);
    const makeFixture = (provider, sourceFingerprint = fingerprint) =>
      createFixture(canvasBackend, manifest, sourceFingerprint, provider);
    const fixture = await makeFixture(() => pdf);
    await deadline(
      renderAll(pdf, tables, fixture, manifest),
      'all original table regions',
      180_000
    );
    await checkCardSizingAndFallback(pdf, makeFixture);
    await checkRealCancellation(pdf, makeFixture);
    warnings.assertClean();
    console.log(
      `PASS: ${expectedTables} tables / ${expectedParts} original PDF regions; exact catalog coverage; source locations; aspect ratios; readable pixels; page selection; automatic sizing; fallback; real RenderTask cancellation. PDF.js ${pdfjs.version}, native canvas ${require('@napi-rs/canvas/package.json').version}.`
    );
  } finally {
    await loadingTask.destroy().finally(() => warnings.restore());
  }
}

if (pdfPath) await main();
else console.log('SKIP: set ATLAS_TEST_PDF to the original PDF to verify table previews.');
