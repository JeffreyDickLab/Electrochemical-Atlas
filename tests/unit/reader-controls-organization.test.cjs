'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = path => fs.readFileSync(require('node:path').join(root, path), 'utf8');

test('PDF reader removes the dedicated control bar and keeps only a floating Hide bar button', () => {
  const html = read('src/client/index.html');
  assert.match(
    html,
    /id="floatingHideBar"/,
    'floating hide button should be present in the book viewport'
  );
  assert.ok(html.indexOf('id="floatingHideBar"') > html.indexOf('id="bookViewport"'));
  const css = read('src/client/styles/19-workspace-organization.css');
  assert.match(
    css,
    /\.reader > \.reader-toolbar,[\s\S]*?\.reader > #readerMore \{\s*display:\s*none\s*!important;\s*\}/
  );
  assert.match(css, /\.reader \.reader-hover-controls/);
  const chrome = read('src/client/reader/chrome.js');
  assert.match(chrome, /floatingHideBar/);
  const navigation = read('src/client/navigation/controller.js');
  assert.doesNotMatch(navigation, /readerMini/);
  assert.match(navigation, /readerToolbar\.prepend\(returnAtlas\)/);
});

test('chemical drawing 1.4.15 contains all source functional groups', () => {
  const entries = JSON.parse(read('src/client/equations/source-map.json')).entries;
  const chemical = entries['1.4.15'];
  assert.equal(chemical.page, 88);
  assert.equal(chemical.preserveFullCrop, true);
  assert.equal(chemical.exactFocus, true);
  assert.ok(
    chemical.focus[1] <= 512 && chemical.focus[3] >= 591,
    'expanded crop retains labels above and below the aromatic rings'
  );
  assert.ok(chemical.focus[1] < chemical.crop[1] - 15);
  assert.ok(chemical.focus[3] > chemical.crop[3] + 15);
  const renderer = read('src/client/equations/renderer.js');
  assert.match(renderer, /if \(entry\.preserveFullCrop !== true\)/);
  assert.ok(Object.values(entries).filter(e => Array.isArray(e.anchorY)).length >= 1978);
  assert.equal(Object.keys(entries).length, 2004);
  assert.deepEqual(JSON.parse(read('app/equations/source-map.json')).entries['1.4.15'], chemical);
});
