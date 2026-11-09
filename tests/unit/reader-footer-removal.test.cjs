'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('PDF reader has no persistent bottom status bar in source or generated UI', () => {
  for (const file of ['src/client/index.html', 'app/index.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /class=["']book-status["']/);
    assert.doesNotMatch(html, /id=["']renderStatus["']/);
    assert.doesNotMatch(html, /id=["']sourceAuditButton["']/);
    assert.equal((html.match(/id="copyPageText"/g) || []).length, 1);
    const more = html.indexOf('id="readerMore"'),
      body = html.indexOf('class="book-body"');
    const copy = html.indexOf('id="copyPageText"');
    assert.ok(
      more >= 0 && copy > more && copy < body,
      'Copy page text belongs inside optional Reading tools'
    );
    assert.match(html, /id="readerMessage"[^>]*role="status"/);
    assert.match(html, /id="openCurrentExternal"/, 'top reader PDF action retained');
  }
});

test('reader and source checks have no dead bottom-footer references', () => {
  for (const filename of ['src/client/pdf/reader.js', 'app/reader.js']) {
    const code = read(filename);
    assert.doesNotMatch(code, /renderStatus/);
    assert.match(code, /\$\('readerMessage'\)\.textContent\s*=\s*'Page text copied\.'/);
    assert.match(code, /\$\('copyPageText'\)\.addEventListener/);
  }
  for (const filename of ['src/client/pdf/source-audit.js', 'app/source-audit.js']) {
    const code = read(filename);
    assert.doesNotMatch(code, /sourceAuditButton/);
    assert.match(code, /const dialog\s*=\s*\$\('sourceAuditDialog'\)/);
  }
  const checks = read('src/client/application/20-home-and-book-map.js');
  assert.match(checks, /data-source-audit/, 'diagnostic report remains available from home');
  for (const filename of [
    'src/client/styles/00-foundation.css',
    'src/client/styles/01-layout.css',
    'src/client/styles/11-components-responsive.css',
    'src/client/styles/13-equation-layout.css',
    'src/client/styles/19-workspace-organization.css',
    'app/atlas.css'
  ]) {
    assert.doesNotMatch(read(filename), /\.book-status|\.source-audit-button|#renderStatus/);
  }
});
