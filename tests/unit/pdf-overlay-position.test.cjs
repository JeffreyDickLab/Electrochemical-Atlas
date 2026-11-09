'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Hide bar and Show bar sit below native PDF chrome instead of over its buttons', () => {
  const readerStyles = read('src/client/styles/06-reader-controls.css');
  const viewerStyles = read('src/client/styles/19-workspace-organization.css');
  assert.match(readerStyles, /--atlas-pdf-overlay-top:\s*66px;/);
  assert.match(
    readerStyles,
    /\.restore-top-bars\s*\{[\s\S]*?top:\s*var\(--atlas-pdf-overlay-top\);/
  );
  assert.match(readerStyles, /--atlas-pdf-overlay-right:\s*44px;/);
  assert.match(
    readerStyles,
    /\.restore-top-bars\s*\{[\s\S]*?right:\s*var\(--atlas-pdf-overlay-right\);/
  );
  assert.match(
    viewerStyles,
    /\.reader \.reader-hover-controls\s*\{[\s\S]*?right:\s*var\(--atlas-pdf-overlay-right\);/
  );
  assert.match(
    viewerStyles,
    /\.reader \.reader-hover-controls\s*\{[\s\S]*?top:\s*var\(--atlas-pdf-overlay-top\);/
  );
  assert.match(
    readerStyles,
    /\.restore-top-bars\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/
  );
  assert.match(
    viewerStyles,
    /body\.atlas-top-bars-hidden \.reader \.reader-hover-controls\s*\{\s*display:\s*none;\s*\}/
  );
  const html = read('src/client/index.html');
  assert.match(html, /id="floatingHideBar"[^>]*>\s*Hide bar\s*<\/button\s*>/);
  assert.match(html, /id="restoreTopBars"[^>]*>\s*Show bar\s*<\/button\s*>/);
});
