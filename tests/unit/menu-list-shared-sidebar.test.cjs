'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Menu and List occupy one sidebar with one drag separator', () => {
  const html = read('src/client/index.html');
  const sidebarStart = html.indexOf('<aside class="sidebar" id="sidebar">');
  const navStart = html.indexOf('<nav id="mainNav"', sidebarStart);
  const listStart = html.search(/<aside\s+class="catalog-rail"\s+id="catalogRail"/);
  const navDivider = html.indexOf('id="navDivider"', listStart);
  const atlasArea = html.indexOf('id="atlasArea"', navDivider);
  assert.ok(
    sidebarStart >= 0 && navStart > sidebarStart && listStart > navStart,
    'List must live in the existing Menu sidebar'
  );
  assert.ok(
    navDivider > listStart && atlasArea > navDivider,
    'one divider separates the shared sidebar from the Atlas workspace'
  );
  assert.doesNotMatch(html, /id="catalogRailDivider"/);
  assert.equal((html.match(/id="navDivider"/g) || []).length, 1);
});

test('Recently viewed occupies the same sidebar footer in both levels', () => {
  const html = read('src/client/index.html');
  const style = read('src/client/styles/19-workspace-organization.css');
  const sidebarStart = html.indexOf('<aside class="sidebar" id="sidebar">');
  const menu = html.indexOf('id="mainNav"', sidebarStart);
  const browse = html.indexOf('id="catalogRail"', menu);
  const footer = html.indexOf('id="atlasSidebarRecent"', browse);
  const divider = html.indexOf('id="navDivider"', footer);
  assert.ok(
    sidebarStart >= 0 && menu > sidebarStart && browse > menu && footer > browse && divider > footer
  );
  assert.ok(html.indexOf('id="atlasSidebarRecentList"', footer) > footer);
  assert.equal((html.match(/id="atlasSidebarRecent"/g) || []).length, 1);
  assert.doesNotMatch(style, /body\.atlas-list-active \.atlas-sidebar-recent/);
  assert.match(style, /\.atlas-sidebar-recent \{[\s\S]*?flex:\s*0 0 auto/);
});

test('List uses the Menu column width and divider, without a second width state', () => {
  const list = read('src/client/navigation/catalog-rail.js');
  const css = read('src/client/styles/08-reference-rail.css');
  const layout = read('src/client/layout/controller.js');
  const nav = read('src/client/navigation/controller.js');
  assert.match(css, /\.sidebar > \.catalog-rail\s*\{/);
  assert.match(css, /width:\s*100%/);
  assert.doesNotMatch(css, /--catalog-rail-width|\.catalog-rail-divider/);
  assert.doesNotMatch(list, /ea_list_width|catalogRailDivider|pointerdown|dragging|railBounds/);
  assert.match(list, /nav\.hidden\s*=\s*enabled/);
  assert.match(list, /rail\.hidden\s*=\s*!enabled/);
  assert.match(list, /document\.body\.classList\.toggle\('atlas-list-active',\s*enabled\)/);
  assert.match(nav, /list\.open\(false,\s*\{\s*keepSidebar:\s*true\s*\}\)/);
  assert.match(nav, /!document\.body\.classList\.contains\('atlas-list-active'\)/);
  assert.match(layout, /splitter\(\s*'navDivider'/);
  assert.match(layout, /state\.navWidth/);
});

test('catalog buttons target Atlas while the optional compact list stays in the sidebar', () => {
  const html = read('src/client/index.html');
  const rail = read('src/client/navigation/catalog-rail.js');
  const header = read('src/client/navigation/toolbar.js');
  const events = read('src/client/application/80-events.js');
  const menu = read('src/client/navigation/controller.js');
  const css = read('src/client/styles/08-reference-rail.css');
  for (const category of ['figures', 'tables', 'equations', 'problems', 'references']) {
    assert.match(html, new RegExp(`data-view="${category}"[^>]*aria-controls="content"`));
  }
  assert.doesNotMatch(html, /id="browseReferences"|data-view="browse"/);
  assert.match(html, /id="closeCatalogRail"[^>]*aria-label="Back to Menu"/);
  assert.match(html, /id="catalogRailOpenIndex"/);
  assert.match(events, /goView\(btn\.dataset\.view\)/);
  assert.doesNotMatch(events, /btn\.dataset\.view === 'browse'/);
  assert.match(rail, /app\.goView\(type\)/, 'full source indexes remain accessible');
  assert.match(rail, /configureOpen\(false,\s*\{\s*keepSidebar:\s*true\s*\}\)/);
  assert.doesNotMatch(header, /getElementById\('toggleCatalogRail'\)/);
  assert.doesNotMatch(rail, /button\.id\s*=\s*'toggleCatalogRail'/);
  assert.match(menu, /list\.open\(false,\s*\{\s*keepSidebar:\s*true\s*\}\)/);
  assert.match(css, /\.catalog-rail-heading button:focus-visible/);
});
