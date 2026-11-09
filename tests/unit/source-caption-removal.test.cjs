'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('source-location and check-source badges are fully removed from details and styles', () => {
  const detail = read('src/client/application/60-entity-details.js');
  const app = read('app/app.js');
  const sourceCSS = read('src/client/styles/13-equation-layout.css');
  const buildCSS = read('app/atlas.css');
  for (const content of [detail, app]) {
    assert.doesNotMatch(
      content,
      /source-confidence|confidence-point|confidenceHTML|AtlasSourceTrust\?\.classify/
    );
    assert.doesNotMatch(content, /Source located|Check source/);
    assert.doesNotMatch(
      content,
      /source-label|sourceLabel/,
      'redundant source headings are removed'
    );
    assert.match(
      content,
      /<section class=\"detail-card\">\$\{descriptionHTML\}\$\{sourceHTML\}/,
      'content begins the detail card without a provenance heading'
    );
  }
  for (const content of [sourceCSS, buildCSS]) {
    assert.doesNotMatch(content, /source-confidence|confidence-point/);
  }
  for (const file of [
    'src/client/styles/03-responsive-base.css',
    'src/client/styles/05-reader.css',
    'src/client/styles/11-components-responsive.css',
    'app/atlas.css'
  ]) {
    assert.doesNotMatch(read(file), /\.source-label\b/, 'old label style leaves no empty margin');
  }
});

test('source diagnostic report is retained without badge explanations or orphaned classifier', async () => {
  const source = read('src/client/pdf/source-audit.js');
  assert.equal(source, read('app/source-audit.js'));
  assert.doesNotMatch(
    source,
    /How to interpret the catalogs|Source located|Check source|function classify\(/i
  );
  const dialogBody = { innerHTML: '' };
  const dialog = {
    querySelector: s => (s === '.source-audit-body' ? dialogBody : { addEventListener() {} }),
    showModal() {
      this.open = true;
    }
  };
  const status = { textContent: '', title: '', addEventListener() {} };
  const window = {};
  const document = {
    getElementById: id =>
      id === 'sourceAuditDialog' ? dialog : id === 'sourceAuditButton' ? status : null
  };
  vm.runInNewContext(source, { window, document, console });
  assert.equal('classify' in window.AtlasSourceTrust, false);
  const file = { name: 'test.pdf', size: 1 };
  const catalog = {
    sections: [{ kind: 'chapter' }, { kind: 'appendix' }],
    equations: [
      { source_kind: 'Printed equation number', pdf_page: 1 },
      { source_kind: 'Inferred from PDF text', pdf_page: 2 }
    ],
    figures: [{}],
    tables: [{}],
    problems: [{}],
    meta: { counts: { figures: 1, tables: 1, problems: 1, references: 0 } }
  };
  const result = { catalog, pages: [{ text: 'Sample text '.repeat(12) }] };
  const report = await window.AtlasSourceTrust.build({ outline: [] }, result, file);
  assert.equal(report.directEq, 1);
  assert.equal(report.flaggedEq, 1);
  window.AtlasSourceTrust.show();
  assert.ok(dialog.open);
  assert.match(dialogBody.innerHTML, /Equations \(direct label \/ inferred\)/);
  assert.doesNotMatch(
    dialogBody.innerHTML,
    /Check source|Source located|How to interpret the catalogs/
  );
});

test('redundant PDF provenance captions disappear without dropping the imported entry content', () => {
  const detail = read('src/client/application/60-entity-details.js');
  const runtime = read('app/app.js');
  for (const source of [detail, runtime]) {
    assert.doesNotMatch(source, /sourceLabel|class=[\"']source-label/);
    assert.match(source, /type === 'problem'\s*\?\s*problemPresentation\(text\)/);
    assert.match(source, /class=\"detail-text sci-rich source-text source-text--\$\{kind\}\"/);
    assert.match(source, /\$\{descriptionHTML\}\$\{sourceHTML\}\$\{extras\}/);
    assert.match(source, /id=\"entityNote\"/);
    assert.match(source, /data-open-pdf/);
  }
  // The importer still records provenance for diagnostics, but the detail
  // viewer no longer renders source_kind as a distracting visual heading.
  const importer = read('src/client/pdf/catalog-extractor.js');
  for (const phrase of [
    'Standard abbreviations table in selected PDF',
    'Original problem statement from selected PDF',
    'Original bibliography entry from selected PDF'
  ])
    assert.ok(importer.includes(phrase));
  assert.match(
    importer,
    /'Original '\s*\+\s*kind\.toLowerCase\(\)\s*\+\s*' caption from selected PDF'/
  );
});
