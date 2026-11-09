'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcile } = require('../../src/client/equations/catalog.js');

const manifest = require('../../src/client/equations/source-map.json');
test('full equation catalog including composite references is importable', () => {
  const result = {
    pages: Array.from({ length: manifest.pdf_pages }, (_, index) => ({
      printed_page: String(index + 1)
    })),
    catalog: {
      sections: [{ pdf_page: 1, pdf_page_end: manifest.pdf_pages, level: 1, title: 'Book' }],
      equations: [
        { label: '1.3.1', pdf_page: 80, y: 570 },
        { label: '1.1.1', pdf_page: 57, y: 200 }
      ],
      meta: { counts: { equations: 0 } }
    }
  };
  assert.equal(reconcile(result, manifest, manifest.pdf_sha256), true);
  assert.equal(result.catalog.equations.length, 2004);
  const composite = result.catalog.equations.find(e => e.label === '3.1.13');
  assert.equal(composite.pdf_page, 181);
  const firstPart = manifest.entries['3.1.13a'];
  assert.equal(composite.sourceTop, (firstPart.focus || firstPart.crop)[1]);
  assert.equal(composite.y, 0);
  const focused = result.catalog.equations.find(e => e.label === '1.3.1');
  assert.equal(focused.sourceTop, manifest.entries['1.3.1'].focus[1]);
  assert.equal(focused.y, 570);
  const correctedPage = result.catalog.equations.find(e => e.label === '1.1.1');
  assert.equal(correctedPage.sourceTop, manifest.entries['1.1.1'].crop[1]);
  assert.equal(correctedPage.y, 0, 'a position on the old page is not a fallback');
});
