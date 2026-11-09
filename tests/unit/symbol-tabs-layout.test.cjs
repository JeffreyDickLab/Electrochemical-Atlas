'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Symbols and Abbreviations uses three always-visible tabs without a horizontal scrollbar', () => {
  const source = read('src/client/application/40-catalog.js');
  const css = read('src/client/styles/00-foundation.css');
  assert.match(source, /class="symbol-tabs"/);
  assert.match(source, /'Abbreviations'/);
  assert.match(source, /'Roman & Greek symbols'/);
  assert.match(source, /'Chemical abbreviations'/);
  assert.match(source, /aria-pressed="\$\{t\[0\] === state\.symbolTab\}"/);
  assert.match(css, /\.symbol-tabs\s*\{[^}]*display: grid;/s);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.symbol-tabs button\s*\{[^}]*white-space: normal;/s);
  assert.match(css, /\.symbol-tab-count/);
  assert.doesNotMatch(css, /\.tab-row\s*\{[^}]*overflow-x:\s*auto/s);
  assert.doesNotMatch(source, /class="tab-row"/);
  const output = read('app/app.js');
  assert.match(output, /class="symbol-tabs"/);
  assert.match(read('app/atlas.css'), /\.symbol-tabs/);
});
