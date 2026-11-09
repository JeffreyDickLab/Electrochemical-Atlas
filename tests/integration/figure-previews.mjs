/**
 * Exercise the maintained figure renderer with the developer's original PDF.
 *
 * ATLAS_TEST_PDF=/path/to/original.pdf node tests/integration/figure-previews.mjs
 *
 * First run npm ci --include=optional and npm run build. The test uses the
 * bundled decoder files and PDF.js's optional @napi-rs/canvas package.
 * Uses the pinned PDF.js distribution's supported Node (legacy) build. Only the
 * DOM is a stand-in: page parsing, graphics, fonts, clipping, and cancellation
 * use real PDF.js and native canvas. This does not test browser layout.
 *
 * No source text, PDF bytes, or rendered artwork are written to disk.
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
const expectedPrintedFigureCount = 564;
const expectedPreviewCount = 565;
const pdfPath = process.env.ATLAS_TEST_PDF;

async function loadSources(names) {
  return Promise.all(
    names.map(async name => ({ name, code: await readFile(join(client, name), 'utf8') }))
  );
}

function evaluateSources(context, sources) {
  for (const { name, code } of sources) runInContext(code, context, { filename: name });
}

async function importFigureCatalog(bytes, manifest, fingerprint) {
  const context = createContext({ Blob, File, Response, DecompressionStream, setTimeout, console });
  context.window = context;
  evaluateSources(
    context,
    await loadSources([
      'core/text.js',
      'pdf/pdf-core.js',
      'pdf/catalog-extractor.js',
      'pdf/source-regions.js',
      'figures/reviewed-crops.js'
    ])
  );
  const file = new File([bytes], 'original.pdf', { type: 'application/pdf' });
  const engine = await new context.AtlasPDFCore.PDFLite(file).init(() => {});
  const result = await context.AtlasRuntimeCatalog.build(engine, () => {});
  const { catalog } = result;
  assert.equal(catalog.meta.counts.figures, expectedPrintedFigureCount);
  const originalCaption = catalog.figures.find(figure => figure.label === '1').description;
  assert.equal(context.AtlasReviewedFigureCrops.reconcile(result, manifest, fingerprint), true);
  assert.equal(catalog.meta.counts.figures, expectedPreviewCount);
  const intro = Array.from(catalog.figures).filter(figure => figure.source_label === '1');
  assert.deepEqual(
    intro.map(({ label, title, pdf_page, printed_page }) => ({
      label,
      title,
      pdf_page,
      printed_page
    })),
    [
      { label: '1 (Part 1)', title: 'Figure 1 (Part 1)', pdf_page: 52, printed_page: 'l' },
      { label: '1 (Part 2)', title: 'Figure 1 (Part 2)', pdf_page: 53, printed_page: 'li' }
    ]
  );
  for (const part of intro) assert.equal(part.description, originalCaption);
  assert.equal(catalog.entity_aliases['figure-1'], 'figure-1 (Part 1)');
  return Array.from(catalog.figures, ({ label, pdf_page, source_label }) => ({
    label,
    pdf_page,
    source_label
  }));
}

/** Just the DOM operations used by the preview renderer; no HTML parser needed. */
function addElementAttributes(node, tagName) {
  const attributes = new Map();
  node.tagName = tagName.toUpperCase();
  node.className = '';
  node.setAttribute = (name, value) => attributes.set(name, String(value));
  node.getAttribute = name => attributes.get(name) ?? null;
  node.removeAttribute = name => attributes.delete(name);
  node.classList = {
    contains: name => node.className.split(/\s+/).includes(name),
    add: (...names) => {
      node.className = [...new Set([...node.className.split(/\s+/), ...names])]
        .filter(Boolean)
        .join(' ');
    },
    remove: (...names) => {
      node.className = node.className
        .split(/\s+/)
        .filter(name => name && !names.includes(name))
        .join(' ');
    }
  };
  node.addEventListener = () => {
    assert.fail('Read-only previews must not attach crop-editor interaction handlers');
  };
  return node;
}

class Element {
  #text = '';

  constructor() {
    addElementAttributes(this, 'div');
    this.children = [];
    this.isConnected = true;
    this.replacementCount = 0;
  }

  set textContent(value) {
    this.#text = String(value);
    this.children = [];
  }

  get textContent() {
    return this.#text;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.#text = '';
    this.children = children;
    this.replacementCount += 1;
  }
}

function createRenderer(sources, canvasBackend, manifest, fingerprint, getDocument) {
  const warnings = [];
  const forbiddenAccesses = [];
  const context = createContext({
    AtlasFigureManifest: manifest,
    ATLAS_SOURCE_SHA256: fingerprint,
    AtlasEquationPreview: { getDocument },
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    document: {
      createElement(tagName) {
        if (tagName === 'canvas')
          return addElementAttributes(canvasBackend.createCanvas(1, 1), 'canvas');
        assert.equal(tagName, 'div', 'Previews must not create crop controls or dialogs');
        return new Element();
      }
    }
  });
  context.window = context;
  // Old saved crop settings must neither affect rendering nor be read/written.
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch']) {
    Object.defineProperty(context, name, {
      get() {
        forbiddenAccesses.push(name);
        throw new Error(`Unexpected preview access to ${name}`);
      }
    });
  }
  evaluateSources(context, sources);
  const preview = context.AtlasFigurePreview;
  assert.deepEqual(Object.keys(preview).sort(), ['mount', 'setSource']);
  assert.ok(Object.isFrozen(preview), 'Only the read-only preview API is exposed');
  return {
    preview,
    reviewed: context.AtlasReviewedFigureCrops,
    assertClean() {
      assert.deepEqual(warnings, [], 'The renderer reported a preview failure');
      assert.deepEqual(forbiddenAccesses, [], 'Previews must not use storage or networking');
    }
  };
}

function makeHolder(detail = false) {
  const holder = new Element();
  holder.className = detail ? 'figure-detail-preview' : 'figure-catalog-preview';
  return holder;
}

function displayedCanvas(holder, label) {
  assert.equal(holder.getAttribute('aria-busy'), null, `${label}: render did not finish`);
  assert.ok(
    !holder.classList.contains('figure-preview-unavailable'),
    `${label}: ${holder.textContent}`
  );
  assert.equal(holder.children.length, 1, `${label}: missing preview frame`);
  const frame = holder.children[0];
  assert.equal(frame.className, 'figure-preview-frame');
  assert.equal(frame.children.length, 1, 'A preview contains one canvas and no crop controls');
  const canvas = frame.children[0];
  assert.equal(canvas.tagName, 'CANVAS');
  assert.equal(canvas.getAttribute('role'), 'img');
  assert.ok(canvas.getAttribute('aria-label').startsWith(`Figure ${label} from your selected PDF`));
  assert.ok(canvas.width > 0 && canvas.height > 0, `${label}: empty canvas dimensions`);
  return canvas;
}

function assertNonblank(canvas, label) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  let paper = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const brightness = data[offset] + data[offset + 1] + data[offset + 2];
    if (brightness < 720) ink += 1;
    if (brightness > 750) paper += 1;
  }
  assert.ok(ink >= 64, `${label}: PDF.js produced no meaningful figure ink (${ink} pixels)`);
  assert.ok(paper >= 64, `${label}: PDF.js produced a solid image without a white margin`);
}

/** Inspect each real page render before multipart canvases are combined. */
function observeRenderedParts(pdf) {
  let completed = 0;
  const failures = [];
  return {
    document: {
      numPages: pdf.numPages,
      async getPage(number) {
        const page = await pdf.getPage(number);
        return {
          getViewport: options => page.getViewport(options),
          render(options) {
            const task = page.render(options);
            task.promise.then(
              () => {
                completed += 1;
                try {
                  assertNonblank(options.canvasContext.canvas, `Source part on page ${number}`);
                } catch (error) {
                  failures.push(error.message);
                }
              },
              error => failures.push(`Source part on page ${number}: ${error.message}`)
            );
            return task;
          }
        };
      }
    },
    assertComplete(expectedCount) {
      assert.equal(completed, expectedCount, 'Every reviewed part must be rendered by PDF.js');
      assert.deepEqual(failures, [], 'One or more source parts rendered blank');
    }
  };
}

function releaseHolder(holder) {
  for (const frame of holder.children) {
    for (const canvas of frame.children || []) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  holder.replaceChildren();
  holder.isConnected = false;
}

function deferred() {
  let resolvePromise;
  const promise = new Promise(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function withDeadline(promise, description, milliseconds = 30_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function capturePDFWarnings() {
  const warnings = [];
  const originalWarn = console.warn;
  // PDF.js reports recoverable image-decoder errors as warnings.
  // Reject them: axis labels alone can make a damaged preview look nonblank.
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
    originalWarn(...args);
  };
  return {
    assertClean() {
      assert.deepEqual(warnings, [], 'PDF.js skipped or could not decode source content');
    },
    restore() {
      console.warn = originalWarn;
    }
  };
}

async function renderEveryFigure(pdf, figures, manifest, fixture) {
  const { preview, reviewed } = fixture;
  const catalogLabels = figures.map(figure => reviewed.normalizeLabel(figure.label)).sort();
  const manifestLabels = Object.keys(manifest.entries).map(reviewed.normalizeLabel).sort();
  const sourceLabels = [
    ...new Set(figures.map(figure => reviewed.normalizeLabel(figure.source_label || figure.label)))
  ].sort();
  assert.equal(new Set(catalogLabels).size, expectedPreviewCount, 'Duplicate catalog labels');
  assert.equal(
    new Set(manifestLabels).size,
    expectedPrintedFigureCount,
    'Duplicate/missing reviewed labels'
  );
  assert.deepEqual(
    manifestLabels,
    sourceLabels,
    'Every original reviewed figure must remain represented in the catalog'
  );
  assert.ok(catalogLabels.includes('1 (part 1)'), 'Introductory Part 1 must be included');
  assert.ok(catalogLabels.includes('1 (part 2)'), 'Introductory Part 2 must be included');
  assert.ok(!catalogLabels.includes('1'), 'The unreadable combined introductory card is replaced');
  assert.ok(
    catalogLabels.includes('14.9.2'),
    'The figure without a prose caption must be included'
  );

  const remainingPageUses = new Map();
  for (const { label } of figures) {
    const parts = reviewed.findParts(manifest, label);
    assert.ok(parts, `${label}: invalid reviewed coordinates`);
    assert.equal(
      parts.length,
      1,
      `${label}: a catalog card must show one independently readable region`
    );
    for (const { page } of parts)
      remainingPageUses.set(page, (remainingPageUses.get(page) || 0) + 1);
  }
  const failures = [];
  let completed = 0;
  preview.setSource('memory:reviewed-source');
  await withDeadline(
    Promise.all(
      figures.map(async ({ label, pdf_page: page }, index) => {
        // Both public preview sizes are exercised, including narrow/tall figures.
        const holder = makeHolder(index % 2 === 1);
        try {
          await preview.mount(holder, label, page);
          const canvas = displayedCanvas(holder, label);
          assertNonblank(canvas, label);
          if (figures[index].source_label === '1') {
            const [part] = reviewed.findParts(manifest, label);
            const ratio = (part.crop[2] - part.crop[0]) / (part.crop[3] - part.crop[1]);
            assert.ok(
              Math.abs(canvas.width / canvas.height - ratio) < 0.005,
              `${label}: render only this part, with its original aspect ratio`
            );
            assert.equal(part.page, page, `${label}: source navigation must use this part's page`);
          }
        } catch (error) {
          failures.push(`${label}: ${error.message}`);
        } finally {
          releaseHolder(holder);
          for (const part of reviewed.findParts(manifest, label)) {
            const remaining = remainingPageUses.get(part.page) - 1;
            remainingPageUses.set(part.page, remaining);
            if (remaining === 0) (await pdf.getPage(part.page)).cleanup();
          }
          completed += 1;
          if (completed % 50 === 0 || completed === figures.length)
            console.log(`Rendered and checked ${completed}/${figures.length} figure previews.`);
        }
      })
    ),
    'rendering all figure previews',
    600_000
  );
  assert.deepEqual(failures, [], 'One or more real PDF.js previews failed');
  fixture.assertClean();

  const missing = makeHolder();
  await preview.mount(missing, 'missing-reviewed-figure', 1);
  assert.equal(
    missing.children.length,
    0,
    'Missing coordinates must not show an arbitrary page crop'
  );
  assert.match(missing.textContent, /No reviewed preview/);
}

async function checkSourceChangeDuringRendering(pdf, figures, createFixture) {
  const paused = deferred();
  let pausedCount = 0;
  let cancelledCount = 0;
  let oldPageRequests = 0;
  let currentSource = 'old';
  const oldDocument = {
    numPages: pdf.numPages,
    async getPage(number) {
      oldPageRequests += 1;
      const page = await pdf.getPage(number);
      return {
        getViewport: options => page.getViewport(options),
        render(options) {
          const task = page.render(options);
          // PDF.js's public continuation hook pauses two actual RenderTasks.
          task.onContinue = () => {
            pausedCount += 1;
            if (pausedCount === 2) paused.resolve();
          };
          return {
            promise: task.promise,
            cancel() {
              cancelledCount += 1;
              task.cancel();
            }
          };
        }
      };
    }
  };
  const fixture = createFixture(() => (currentSource === 'old' ? oldDocument : pdf));
  fixture.preview.setSource('memory:old-source');
  const holders = figures.slice(0, 3).map(() => makeHolder());
  const oldJobs = holders.map((holder, index) =>
    fixture.preview.mount(holder, figures[index].label, figures[index].pdf_page)
  );
  await withDeadline(paused.promise, 'two active PDF.js renders');
  assert.equal(oldPageRequests, 2, 'The third job should still be queued');

  currentSource = 'new';
  fixture.preview.setSource('memory:new-source');
  const replacement = figures[3];
  const newJob = fixture.preview.mount(holders[0], replacement.label, replacement.pdf_page);
  await withDeadline(Promise.all([...oldJobs, newJob]), 'source switch and replacement preview');
  assert.equal(cancelledCount, 2, 'Both active PDF.js tasks must be cancelled');
  assert.equal(oldPageRequests, 2, 'The queued old-source job must be discarded');
  assert.equal(holders[0].replacementCount, 1, 'Only the new source may install a preview');
  assertNonblank(displayedCanvas(holders[0], replacement.label), replacement.label);
  assert.equal(holders[1].children.length, 0, 'A cancelled render must not display stale content');
  assert.equal(
    holders[2].children.length,
    0,
    'A discarded queued job must not display stale content'
  );
  fixture.assertClean();
  holders.forEach(releaseHolder);
}

async function checkSourceChangeDuringLoading(pdf, figures, createFixture) {
  const oldDocument = deferred();
  const requested = deferred();
  let currentSource = 'old';
  const fixture = createFixture(() => {
    if (currentSource === 'new') return pdf;
    requested.resolve();
    return oldDocument.promise;
  });
  const holder = makeHolder();
  fixture.preview.setSource('memory:loading-source');
  const oldJob = fixture.preview.mount(holder, figures[0].label, figures[0].pdf_page);
  await withDeadline(requested.promise, 'old document request');
  currentSource = 'new';
  fixture.preview.setSource('memory:replacement-source');
  const replacement = figures[1];
  await withDeadline(
    fixture.preview.mount(holder, replacement.label, replacement.pdf_page),
    'new document preview'
  );
  const canvas = displayedCanvas(holder, replacement.label);
  oldDocument.resolve(pdf);
  await withDeadline(oldJob, 'obsolete document resolution');
  assert.equal(
    displayedCanvas(holder, replacement.label),
    canvas,
    'Late document loading must not overwrite the new preview'
  );
  assert.equal(holder.replacementCount, 1);
  fixture.assertClean();
  releaseHolder(holder);
}

async function main() {
  let canvasBackend;
  try {
    canvasBackend = require('@napi-rs/canvas');
  } catch (cause) {
    throw new Error(
      'Install PDF.js optional dependencies with npm ci --include=optional before running this test.',
      { cause }
    );
  }
  const manifest = JSON.parse(await readFile(join(client, 'figures/source-map.json'), 'utf8'));
  const bytes = await readFile(resolve(pdfPath));
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    fingerprint,
    manifest.pdf_sha256,
    'Use the original PDF matching the reviewed figure map'
  );
  console.log('Importing the real figure catalog from the supplied PDF…');
  const figures = await importFigureCatalog(bytes, manifest, fingerprint);
  const sources = await loadSources([
    'pdf/source-regions.js',
    'figures/geometry.js',
    'figures/reviewed-crops.js',
    'figures/renderer.js'
  ]);
  const createFixture = provider =>
    createRenderer(sources, canvasBackend, manifest, fingerprint, provider);

  const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfjs = await import(pathToFileURL(join(packageRoot, 'legacy/build/pdf.mjs')).href);
  const packageJSON = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(
    pdfjs.version,
    packageJSON.dependencies['pdfjs-dist'],
    'Use the exact pinned PDF.js version'
  );
  const codecDirectory = join(root, 'app/vendor/pdfjs-codecs');
  const assets = JSON.parse(await readFile(join(root, 'tools/pdfjs-assets.json'), 'utf8'));
  try {
    await Promise.all(assets.codecs.map(name => access(join(codecDirectory, name))));
  } catch (cause) {
    throw new Error('Run npm run build to include the PDF.js decoder files and licenses.', {
      cause
    });
  }
  const pdfWarnings = capturePDFWarnings();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    isEvalSupported: false,
    // Same directory and only extra resource setting as the application loader.
    // Node reads it from disk; the native launcher serves it over local HTTP.
    wasmUrl: codecDirectory.replaceAll('\\', '/') + '/'
  });
  try {
    const pdf = await loadingTask.promise;
    assert.equal(pdf.numPages, manifest.pdf_pages);
    const parts = observeRenderedParts(pdf);
    const fixture = createFixture(() => parts.document);
    assert.ok(fixture.reviewed.matchesDocument(manifest, fingerprint, pdf.numPages));
    await renderEveryFigure(pdf, figures, manifest, fixture);
    const partCount = Object.values(manifest.entries).reduce(
      (total, entry) => total + (entry.parts?.length || 1),
      0
    );
    parts.assertComplete(partCount);
    pdfWarnings.assertClean();
    await checkSourceChangeDuringRendering(pdf, figures, createFixture);
    await checkSourceChangeDuringLoading(pdf, figures, createFixture);
    pdfWarnings.assertClean();
    console.log(
      `PASS: ${figures.length} previews / ${expectedPrintedFigureCount} printed figures / ${partCount} source regions; exact catalog coverage; read-only previews; stale-source cancellation. PDF.js ${pdfjs.version}, native canvas ${require('@napi-rs/canvas/package.json').version}.`
    );
  } finally {
    await loadingTask.destroy().finally(() => pdfWarnings.restore());
  }
}

if (pdfPath) await main();
else console.log('SKIP: set ATLAS_TEST_PDF to the original PDF to verify figure previews.');
