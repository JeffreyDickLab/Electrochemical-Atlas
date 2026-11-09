const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = JSON.parse(read('src/client/equations/source-map.json'));
const exceptions = [
  '2.1.34a,b',
  '3.7.15',
  '10.4.3',
  '11.4.23',
  '13.1.14',
  '13.3.6',
  '13.3.23a',
  '13.3.53',
  '13.3.64',
  '17.2.36',
  '17.2.38',
  '18.4.7'
];

test('all individually anchored previews were restored', () => {
  const entries = index.entries;
  assert.equal(Object.keys(entries).length, 2004);
  assert.equal(Object.values(entries).filter(e => Array.isArray(e.anchorY)).length, 1978);
  assert.match(read('src/client/equations/geometry.js'), /function equationReferenceWindow\(/);
  assert.match(
    read('src/client/equations/renderer.js'),
    /const referenceAnchor = geometry\.equationReferenceWindow\(/
  );
  assert.match(read('src/client/equations/renderer.js'), /referenceAnchor \|\|/);
  assert.equal(read('src/client/equations/geometry.js'), read('app/equation-geometry.js'));
  assert.equal(read('src/client/equations/renderer.js'), read('app/equation-preview.js'));
});

test('the twelve individually corrected crops remain intact', () => {
  for (const label of exceptions) {
    assert.equal(index.entries[label].exactFocus, true, label);
    assert.equal(index.entries[label].focus.length, 4, label);
  }
  assert.ok(index.entries['17.8.6'].crop[1] < 110, 'diagram correction retained');
  assert.ok(index.entries['21.4.1'].crop[1] < 505, 'diagram correction retained');
});

test('generated manifest and source metadata are identical', () => {
  assert.deepEqual(JSON.parse(read('app/equations/source-map.json')), index);
  const js = read('app/equations/source-map.js');
  assert.ok(js.startsWith('/* Equation location data only; no copyrighted source artwork. */'));
  const value = JSON.parse(
    js.replace(/^.*?window\.AtlasEquationManifest = /s, '').replace(/;\s*$/, '')
  );
  assert.deepEqual(value, index);
});

test('latest organized layout and removed captions are preserved', () => {
  const state = read('src/client/application/10-state-and-layout.js');
  const styles = read('src/client/styles/19-workspace-organization.css');
  assert.ok(styles.length > 100);
  const html = read('src/client/index.html');
  assert.doesNotMatch(html, /readingProgressBar|reading-progress-bar/);
  assert.doesNotMatch(
    read('src/client/application/60-entity-details.js'),
    /ORIGINAL FIGURE CAPTION FROM SELECTED PDF/
  );
  assert.ok(state.length > 100);
});
