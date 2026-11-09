'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Menu never scrolls and adapts its density to shorter screens; List still scrolls', () => {
  const css = read('src/client/styles/19-workspace-organization.css');
  const menu = css.match(/body \.workspace #mainNav \{([^}]+)\}/);
  assert.ok(menu, 'Menu CSS rule must exist');
  assert.match(menu[1], /overflow:\s*hidden/, 'Menu must never become a scroll container');
  assert.doesNotMatch(menu[1], /overflow-y:\s*auto|overflow-y:\s*scroll/);
  assert.match(css, /@media \(max-height:\s*760px\)/);
  assert.match(css, /@media \(max-height:\s*485px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const list = read('src/client/styles/08-reference-rail.css');
  assert.match(list, /\.catalog-rail-list\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(read('src/client/index.html'), /id="navDivider"/);
});

test('Home launch buttons and starting points have the same aligned content width', () => {
  const css = read('src/client/styles/19-workspace-organization.css');
  assert.match(css, /#content \.atlas-welcome,\s*#content \.atlas-suggested-paths/);
  assert.match(
    css,
    /#content \.atlas-welcome \{[^}]*padding:\s*0;\s*border:\s*0;\s*border-radius:\s*0;/
  );
  assert.match(css, /#content \.atlas-launch-grid\s*\{\s*margin-top:\s*0;/);
  assert.match(read('src/client/application/20-home-and-book-map.js'), /class="atlas-welcome"/);
});
