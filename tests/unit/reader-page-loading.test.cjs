'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function readerFixture(userAgent = 'Chromium') {
  const elements = new Map();
  const replacedLocations = [];
  const makeFrame = attributes => ({
    ...attributes,
    contentWindow: {
      location: { replace: destination => replacedLocations.push(destination) }
    },
    hasAttribute(name) {
      return Object.hasOwn(this, name);
    },
    cloneNode() {
      return makeFrame({ id: this.id, title: this.title, src: this.src, hidden: this.hidden });
    },
    replaceWith(viewer) {
      elements.set(this.id, viewer);
    }
  });
  const id = 'importedPdfFrame';
  elements.set(id, makeFrame({ id, title: 'Local PDF', hidden: true }));
  let hidden = false;
  let onLayoutChange;
  const document = Object.assign(new EventTarget(), {
    body: { classList: { contains: name => name === 'layout-no-book' && hidden } },
    getElementById(name) {
      if (!elements.has(name)) elements.set(name, new EventTarget());
      return elements.get(name);
    }
  });
  const window = {
    navigator: { userAgent },
    ATLAS_READER_META: { pageCount: 4, labels: ['i', 'ii', '1', '2'], outline: [] },
    ATLAS_PDF_URL: 'blob:local-pdf',
    ATLAS_PDF_ENGINE: {
      pageObjects: [1, 2, 3, 4],
      get: id => (id === 5 ? '/CropBox [0 0 600 820]' : '/Parent 5 0 R /MediaBox [0 0 612 850]')
    }
  };
  vm.runInNewContext(read('src/client/pdf/reader.js'), {
    document,
    window,
    CustomEvent,
    MutationObserver: class {
      constructor(callback) {
        onLayoutChange = callback;
      }
      observe() {}
    }
  });
  return {
    reader: window.AtlasReader,
    viewer: () => elements.get(id),
    control: name => document.getElementById(name),
    replacedLocations,
    setHidden(value) {
      hidden = value;
      onLayoutChange();
    }
  };
}

test('PDF page navigation never displays a transient Opening page popup', () => {
  for (const file of ['src/client/pdf/reader.js', 'app/reader.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /bookLoading|Opening ['"`]|lastLoaded|2400/);
  }
  for (const file of ['src/client/index.html', 'app/index.html']) {
    assert.doesNotMatch(read(file), /id="bookLoading"/);
    assert.match(read(file), /id="readerFallback"/);
  }
  for (const file of ['src/client/styles/04-pdf-import.css', 'app/atlas.css']) {
    assert.doesNotMatch(read(file), /#bookLoading/);
  }
});

test('explicit PDF jumps reopen the requested entry from a different page and on repeat', () => {
  const { reader, viewer } = readerFixture();
  reader.show(4, 0, false);
  const previous = viewer();
  assert.equal(previous.src, 'blob:local-pdf#page=4&zoom=100');

  reader.show(2, 350, false, 'snap');
  const destination = viewer();
  assert.notEqual(destination, previous);
  assert.equal(destination.src, 'blob:local-pdf#page=2&zoom=100,0,355');
  assert.equal(destination.title, 'Local PDF');
  assert.equal(destination.hidden, false);

  reader.show(2, 350, false);
  assert.equal(viewer(), destination, 'automatic navigation should reuse the existing viewer');
  reader.show(2, 350, false, 'snap');
  assert.notEqual(viewer(), destination, 'the native viewer can scroll without changing its URL');
  assert.equal(viewer().src, destination.src);
});

test('Firefox reuses the viewer for first and repeated jumps to an already-open PDF', () => {
  const { reader, viewer, control, setHidden, replacedLocations } = readerFixture(
    'Mozilla/5.0 Firefox/159.0'
  );
  reader.show(4, 0, false, 'snap');
  const previous = viewer();
  assert.equal(previous.src, 'blob:local-pdf#page=4&zoom=100');
  assert.deepEqual(replacedLocations, [], 'the first PDF load uses src');

  setHidden(true);
  reader.show(2, 350, false, 'snap');
  assert.equal(viewer(), previous);
  assert.deepEqual(replacedLocations, [], 'the hidden reader defers navigation');
  setHidden(false);
  assert.equal(viewer(), previous);

  const target = 'blob:local-pdf#page=2&zoom=100,0,465';
  assert.deepEqual(replacedLocations, [target + '&atlasJump=1']);
  reader.show(2, 350, false);
  assert.deepEqual(replacedLocations, [target + '&atlasJump=1']);
  reader.show(2, 350, false, 'snap');
  assert.equal(viewer(), previous);
  assert.deepEqual(replacedLocations, [target + '&atlasJump=1', target + '&atlasJump=2']);

  previous.onerror();
  assert.equal(control('readerFallback').hidden, false);
  control('retryPage').dispatchEvent(new Event('click'));
  assert.notEqual(viewer(), previous);
  assert.equal(viewer().src, target);
  assert.equal(control('readerFallback').hidden, true);
  previous.onerror();
  assert.equal(control('readerFallback').hidden, true, 'stale frame errors are ignored');
});

test('Firefox falls back to the iframe src when location replacement is blocked', () => {
  const { reader, viewer } = readerFixture('Mozilla/5.0 Firefox/159.0');
  reader.show(4, 0, false);
  const previous = viewer();
  previous.contentWindow.location.replace = () => {
    throw new DOMException('Navigation was blocked', 'SecurityError');
  };
  reader.show(2, 350, false, 'snap');
  assert.equal(viewer(), previous);
  assert.equal(previous.src, 'blob:local-pdf#page=2&zoom=100,0,465&atlasJump=1');
});
