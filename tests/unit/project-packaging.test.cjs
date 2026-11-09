const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('application chrome and local URL do not expose build versions', () => {
  const html = read('app/index.html');
  const starter = read('START_HERE.html');
  const launcher = read('src/launcher/main.go');
  assert.match(html, /<title>Electrochemical Atlas<\/title>/);
  assert.doesNotMatch(html, /v[0-9]+\.[0-9]+|atlas-build-chip|data-atlas-build|atlas-version/i);
  assert.doesNotMatch(starter, /Version\s+[0-9]+|v[0-9]+\.[0-9]+/i);
  assert.match(launcher, /const appEntry = "\/atlas\/app\/index\.html"/);
  assert.doesNotMatch(launcher, /\?release=v/);
});

test('repository includes license, mandatory attribution, and third-party notes', () => {
  for (const file of [
    'LICENSE',
    'NOTICE.txt',
    'COPYRIGHT_HOLDERS.md',
    'THIRD_PARTY_NOTICES.md',
    '.github/workflows/ci.yml'
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  }
  const notice = read('NOTICE.txt');
  assert.match(notice, /Copyright © 2026 Azaria A\. Wagner and Jeffrey E\. Dick/);
  assert.match(
    notice,
    /Electrochemical Atlas project authors: Azaria A\. Wagner and Jeffrey E\. Dick/
  );
  assert.doesNotMatch(notice, /current members|Dick Lab|PolyForm|Noncommercial/i);
  assert.doesNotMatch(read('COPYRIGHT_HOLDERS.md'), /Dick Lab|PolyForm|Noncommercial/i);
  const license = read('LICENSE');
  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 Azaria A\. Wagner and Jeffrey E\. Dick/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.equal(JSON.parse(read('package.json')).license, 'MIT');
  assert.doesNotMatch(
    read('README.md'),
    /PolyForm|source-available|commercial use requires separate permission/i
  );
});

test('source launcher can install missing PDF.js and supplies a specific error', () => {
  const server = read('src/launcher/renderer.go');
  const preview = read('src/client/equations/renderer.js');
  assert.match(server, /preparePDFRenderer/);
  assert.match(server, /pdfjs-.*pdfjsVersion/);
  assert.match(server, /rendererDirComplete/);
  assert.match(preview, /PDFJS_UNAVAILABLE/);
  assert.match(preview, /Reopen Atlas with internet/);
});
