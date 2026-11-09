'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  matchesDocument,
  findParts,
  fitsPage
} = require('../../src/client/figures/reviewed-crops.js');

const fingerprint = 'c8f275c377e9fa981b6b4e69a63aa20b675acb846fe516531837cef93a96fb44';
const sourceMap = require('../../src/client/figures/source-map.json');
const manifest = {
  pdf_sha256: fingerprint,
  pdf_pages: 1107,
  coordinate_system: 'pdf-points-top-left',
  entries: {
    '1.1.1': { page: 58, crop: [10, 20, 200, 300], exclude: [[12, 22, 25, 30]] },
    1: {
      parts: [
        { page: 52, crop: [10, 10, 200, 400] },
        { page: 53, crop: [20, 20, 300, 600] }
      ]
    }
  }
};

test('reviewed coordinates require the exact fingerprint, page count and coordinate system', () => {
  assert.equal(matchesDocument(manifest, fingerprint, 1107), true);
  assert.equal(matchesDocument(manifest, fingerprint.toUpperCase(), 1107), true);
  for (const wrong of ['', undefined, 'a'.repeat(64), fingerprint + '0']) {
    assert.equal(matchesDocument(manifest, wrong, 1107), false);
  }
  assert.equal(matchesDocument(manifest, fingerprint, 1106), false);
  assert.equal(
    matchesDocument({ ...manifest, coordinate_system: 'normalized' }, fingerprint, 1107),
    false
  );
});

test('exact figure lookup preserves every panel and exclusion without sharing mutable arrays', () => {
  const parts = findParts(manifest, ' 1 . 1 . 1 ');
  assert.deepEqual(parts, [{ page: 58, crop: [10, 20, 200, 300], exclude: [[12, 22, 25, 30]] }]);
  parts[0].crop[0] = 999;
  parts[0].exclude[0][0] = 999;
  assert.equal(manifest.entries['1.1.1'].crop[0], 10);
  assert.equal(manifest.entries['1.1.1'].exclude[0][0], 12);
  assert.equal(
    findParts(manifest, '1.1.1a'),
    null,
    'do not confuse a whole figure with a panel suffix'
  );
  assert.deepEqual(
    findParts(manifest, '1').map(part => part.page),
    [52, 53]
  );
});

test('explicit figure part labels select one original region without changing the source map', () => {
  const first = findParts(manifest, ' 1 (Part 1) ');
  const second = findParts(manifest, '1 (part 2)');
  assert.deepEqual(first, [{ page: 52, crop: [10, 10, 200, 400], exclude: [] }]);
  assert.deepEqual(second, [{ page: 53, crop: [20, 20, 300, 600], exclude: [] }]);
  first[0].crop[0] = 999;
  assert.equal(manifest.entries['1'].parts[0].crop[0], 10);
  for (const label of [
    '1 (Part 0)',
    '1 (Part 3)',
    '1 (Part 01)',
    '1 (Part -1)',
    '1 (Part 1a)',
    '1 (Part 1) extra',
    '1.1.1 (Part 1)'
  ])
    assert.equal(findParts(manifest, label), null, `Reject invalid part label: ${label}`);
});

test('an exact reviewed label takes precedence over the generated part-label convention', () => {
  const literal = {
    ...manifest,
    entries: { ...manifest.entries, '1 (Part 2)': { page: 60, crop: [1, 2, 30, 40] } }
  };
  assert.deepEqual(findParts(literal, '1 (Part 2)'), [
    { page: 60, crop: [1, 2, 30, 40], exclude: [] }
  ]);
  literal.entries['1 (Part 2)'].crop = [0, 0, 0, 0];
  assert.equal(findParts(literal, '1 (Part 2)'), null, 'invalid exact geometry must fail closed');
});

test('invalid or out-of-page coordinates fail closed', () => {
  const base = { page: 3, crop: [10, 20, 200, 300] };
  assert.equal(fitsPage(base, { width: 600, height: 780 }), true);
  assert.equal(fitsPage(base, { width: 190, height: 780 }), false);
  for (const bad of [
    { ...base, page: 0 },
    { ...base, crop: [0, 0, 0, 20] },
    { ...base, crop: [-1, 0, 20, 20] },
    { ...base, crop: [0, NaN, 20, 20] },
    { ...base, exclude: [[0, 0, 1]] },
    { parts: [] },
    { parts: [base, { ...base, page: 1108 }] }
  ]) {
    assert.equal(findParts({ ...manifest, entries: { bad } }, 'bad'), null);
  }
});

test('the reviewed edition retains all 564 figures and both introductory panels', () => {
  const counts = {};
  let partCount = 0;
  for (const label of Object.keys(sourceMap.entries)) {
    const chapter = label === '1' ? 'frontmatter' : label.split('.')[0];
    counts[chapter] = (counts[chapter] || 0) + 1;
    const parts = findParts(sourceMap, label);
    assert.ok(parts, `Invalid reviewed coordinates for Figure ${label}`);
    partCount += parts.length;
  }
  // Counts were checked against the printed figure labels in the supplied PDF.
  // This protects complete coverage even when the original PDF is unavailable.
  assert.deepEqual(counts, {
    frontmatter: 1,
    1: 39,
    2: 21,
    3: 27,
    4: 10,
    5: 29,
    6: 22,
    7: 26,
    8: 20,
    9: 15,
    10: 24,
    11: 37,
    12: 28,
    13: 34,
    14: 30,
    15: 33,
    16: 26,
    17: 36,
    18: 20,
    19: 23,
    20: 30,
    21: 19,
    A: 7,
    B: 7
  });
  assert.equal(Object.keys(sourceMap.entries).length, 564);
  assert.equal(partCount, 565);
  assert.deepEqual(
    findParts(sourceMap, '1').map(part => part.page),
    [52, 53]
  );
  assert.equal(sourceMap.entries['14.9.2'].page, 707);
});
