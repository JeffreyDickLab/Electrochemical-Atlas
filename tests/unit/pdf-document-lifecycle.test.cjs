'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Public PDF.js 6 API: only the loading task owns destroy(). */
function documentTask() {
  const pending = deferred();
  const task = {
    promise: pending.promise,
    destroyed: 0,
    async destroy() {
      this.destroyed += 1;
    }
  };
  const pdf = { numPages: 1, loadingTask: task };
  return { task, pdf, resolve: () => pending.resolve(pdf), reject: pending.reject };
}

async function rendererHarness(t, createTask) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-document-lifecycle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const vendor = path.join(directory, 'vendor/pdfjs');
  await fs.mkdir(vendor, { recursive: true });
  const libraryFile = path.join(vendor, 'pdf.mjs');
  await fs.writeFile(
    libraryFile,
    `
    export const GlobalWorkerOptions = {};
    let createTask;
    export function configure(factory) { createTask = factory; }
    export function getDocument(options) { return createTask(options); }
  `
  );
  const library = await import(pathToFileURL(libraryFile).href);
  library.configure(createTask);
  const window = { addEventListener() {} };
  const document = {
    currentScript: { src: pathToFileURL(path.join(directory, 'equation-preview.js')).href }
  };
  const source = await fs.readFile(path.join(root, 'src/client/equations/renderer.js'), 'utf8');
  const script = new vm.Script(source, {
    filename: 'equation-preview.js',
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
  });
  script.runInNewContext({ window, document, URL, console });
  return window.AtlasEquationPreview;
}

async function settleCleanup() {
  // Cleanup is chained to the shared document promise; drain those microtasks.
  await Promise.resolve();
  await Promise.resolve();
}

test('switching or closing a source destroys its loading task, not the document proxy', async t => {
  const first = documentTask();
  const second = documentTask();
  first.resolve();
  second.resolve();
  const requested = [];
  const renderer = await rendererHarness(t, ({ url }) => {
    requested.push(url);
    return url === 'first' ? first.task : second.task;
  });
  assert.equal(first.pdf.destroy, undefined, 'match the installed PDF.js proxy API');
  renderer.setSource('first');
  assert.equal(await renderer.getDocument(), first.pdf);
  assert.equal(await renderer.getDocument(), first.pdf, 'previews share one loaded document');
  renderer.setSource('first');
  await settleCleanup();
  assert.equal(first.task.destroyed, 0, 'selecting the same source keeps it alive');

  renderer.setSource('second');
  await settleCleanup();
  assert.equal(first.task.destroyed, 1);
  assert.equal(await renderer.getDocument(), second.pdf);
  renderer.setSource(null);
  await settleCleanup();
  assert.equal(second.task.destroyed, 1);
  assert.equal(first.task.destroyed, 1);
  assert.deepEqual(requested, ['first', 'second']);
  await assert.rejects(renderer.getDocument(), /No PDF has been selected/);
});

test('an old load that completes after a source switch is released without destroying the new PDF', async t => {
  const old = documentTask();
  const current = documentTask();
  current.resolve();
  const started = deferred();
  const renderer = await rendererHarness(t, ({ url }) => {
    if (url === 'old') {
      started.resolve();
      return old.task;
    }
    return current.task;
  });
  renderer.setSource('old');
  const oldResult = renderer.getDocument();
  await started.promise;
  renderer.setSource('current');
  assert.equal(await renderer.getDocument(), current.pdf);
  old.resolve();
  assert.equal(await oldResult, old.pdf);
  await settleCleanup();
  assert.equal(old.task.destroyed, 1);
  assert.equal(current.task.destroyed, 0);
  assert.equal(await renderer.getDocument(), current.pdf);
  renderer.setSource(null);
  await settleCleanup();
});

test('a rejected old load cannot clear the new source document cache', async t => {
  const old = documentTask();
  const current = documentTask();
  current.resolve();
  const started = deferred();
  const requested = [];
  const renderer = await rendererHarness(t, ({ url }) => {
    requested.push(url);
    if (url === 'old') {
      started.resolve();
      return old.task;
    }
    return current.task;
  });
  renderer.setSource('old');
  const failedOldLoad = assert.rejects(renderer.getDocument(), /old load failed/);
  await started.promise;
  renderer.setSource('current');
  assert.equal(await renderer.getDocument(), current.pdf);
  old.reject(new Error('old load failed'));
  await failedOldLoad;
  assert.equal(await renderer.getDocument(), current.pdf);
  assert.deepEqual(requested, ['old', 'current'], 'the current document was not loaded twice');
  assert.equal(current.task.destroyed, 0);
  renderer.setSource(null);
  await settleCleanup();
});

test('a failed current load can be retried', async t => {
  const failed = documentTask();
  const retry = documentTask();
  retry.resolve();
  let attempts = 0;
  const renderer = await rendererHarness(t, () => {
    attempts += 1;
    if (attempts === 1) {
      failed.reject(new Error('load failed'));
      return failed.task;
    }
    return retry.task;
  });
  renderer.setSource('current');
  await assert.rejects(renderer.getDocument(), /load failed/);
  assert.equal(await renderer.getDocument(), retry.pdf);
  assert.equal(attempts, 2);
  renderer.setSource(null);
  await settleCleanup();
  assert.equal(retry.task.destroyed, 1);
});

test('the document loader resolves its bundled image decoder outside the native module-only route', async t => {
  const pending = documentTask();
  pending.resolve();
  let requested;
  const renderer = await rendererHarness(t, options => {
    requested = options;
    return pending.task;
  });
  renderer.setSource('blob:local-source');
  await renderer.getDocument();
  assert.equal(requested.url, 'blob:local-source');
  assert.equal(requested.enableXfa, false);
  assert.equal(requested.isEvalSupported, false);
  const codecURL = new URL(requested.wasmUrl);
  assert.equal(codecURL.protocol, 'file:', 'the test loader uses its local fixture directory');
  assert.ok(codecURL.pathname.endsWith('/vendor/pdfjs-codecs/'));
  assert.ok(
    !codecURL.pathname.includes('/vendor/pdfjs/'),
    'existing native launchers reject that subpath'
  );
  renderer.setSource(null);
  await settleCleanup();
});
