'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const css = name => fs.readFileSync(path.join(root, 'src/client/styles', name), 'utf8');
const html = () => fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8');

test('Menu and List use the same sidebar typography and semantic theme colors', () => {
  const navigation = css('07-navigation.css');
  const menu = css('19-workspace-organization.css');
  const list = css('08-reference-rail.css');
  for (const token of [
    '--atlas-side-primary',
    '--atlas-side-secondary',
    '--atlas-side-heading',
    '--atlas-side-text-size',
    '--atlas-side-detail-size',
    '--atlas-side-heading-size',
    '--atlas-side-radius'
  ]) {
    assert.match(navigation, new RegExp(token + ':'));
  }
  assert.match(
    menu,
    /#mainNav > button\[data-view\][^}]*font-size:\s*var\(--atlas-side-text-size\)/
  );
  assert.match(
    menu,
    /#mainNav > button\[data-view\] \.atlas-sidebar-text[^}]*color:\s*var\(--atlas-side-primary\)/
  );
  assert.match(
    list,
    /\.catalog-entry-number[^}]*color:\s*var\(--atlas-side-primary\)[^}]*font-size:\s*var\(--atlas-side-text-size\)/
  );
  assert.match(
    list,
    /\.catalog-entry-description[^}]*color:\s*var\(--atlas-side-secondary\)[^}]*font-size:\s*var\(--atlas-side-detail-size\)/
  );
  assert.match(
    list,
    /\.catalog-rail-heading strong[^}]*color:\s*var\(--atlas-side-heading\)[^}]*font-size:\s*var\(--atlas-side-heading-size\)/
  );
  assert.match(list, /#catalogRailType[^}]*font-size:\s*var\(--atlas-side-text-size\)/);
  assert.match(
    list,
    /\.catalog-rail-search-label input[^}]*font-size:\s*var\(--atlas-side-text-size\)/
  );
  assert.match(html(), /id="catalogRail"/);
  assert.match(html(), /id="navDivider"/);
});

test('Atlas, Browse, and search results share slim scrollbars', () => {
  const list = css('08-reference-rail.css');
  const responsive = css('11-components-responsive.css');
  assert.match(list, /\.catalog-rail-list\s*\{[^}]*overflow-y:\s*auto;\s*overflow-x:\s*hidden/);
  assert.match(list, /body \.atlas-area \.content\s*\{[^}]*overflow:\s*auto/);
  assert.match(
    list,
    /#atlasCommandResults,\s*#content,\s*\.catalog-rail-list\s*\{[^}]*scrollbar-width:\s*thin;/
  );
  assert.match(
    list,
    /#atlasCommandResults::-webkit-scrollbar,\s*#content::-webkit-scrollbar,\s*\.catalog-rail-list::-webkit-scrollbar\s*\{[^}]*width:\s*6px;/
  );
  assert.match(list, /\.catalog-rail-list::-webkit-scrollbar\s*\{\s*height:\s*0/);
  assert.match(
    list,
    /#atlasCommandResults::-webkit-scrollbar-thumb,\s*#content::-webkit-scrollbar-thumb,\s*\.catalog-rail-list::-webkit-scrollbar-thumb\s*\{[^}]*background:/
  );
  assert.match(list, /\.catalog-rail-entry\s*\{[^}]*overflow:\s*hidden/);
  assert.match(list, /\.catalog-entry-description\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(responsive, /\.catalog-rail-list\s*\{scrollbar-gutter:\s*stable\}/);
  assert.doesNotMatch(list, /\.catalog-rail-list::-webkit-scrollbar[^{}]*\{[^}]*display:\s*none/);
  assert.match(
    css('19-workspace-organization.css'),
    /body \.workspace #mainNav\s*\{[^}]*overflow:\s*hidden/
  );
  assert.doesNotMatch(list, /overflow-y:\s*hidden/);
});

test('search categories wrap at their natural height and only the results scroll', () => {
  const inline = css('12-inline-navigation.css');
  const scopes = inline.match(/#atlasCommandPalette \.atlas-command-scopes\s*\{([^}]*)\}/)[1];
  assert.match(scopes, /flex:\s*0 0 auto;/);
  assert.match(scopes, /flex-wrap:\s*wrap;/);
  assert.match(scopes, /overflow:\s*visible;/);
  assert.doesNotMatch(scopes, /max-height|overflow-[xy]/);
  assert.match(
    inline,
    /#atlasCommandPalette \.atlas-command-results\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/
  );
});
