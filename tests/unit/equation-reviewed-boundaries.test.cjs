'use strict';
/**
 * Regression coverage for equation boundaries manually compared with the
 * user-provided third-edition PDF. No book text/images are included here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../../src/client/equations/source-map.json');
const { cropFor } = require('../../src/client/equations/geometry.js');

const checked = Object.freeze([
  '1.6.14',
  '2.1.58',
  '2.3.31',
  '2.3.44',
  '2.3.49',
  '3.1.10',
  '3.3.5a',
  '3.3.5b',
  '3.3.6a',
  '3.3.9b',
  '3.4.5',
  '3.4.16a',
  '3.4.22a',
  '3.4.22b',
  '3.4.32',
  '3.4.34',
  '3.5.5',
  '3.5.6',
  '3.5.7',
  '3.5.9',
  '3.5.14',
  '3.5.15',
  '3.5.16',
  '3.5.17',
  '3.1.2a',
  '7.2.37',
  '7.2.41',
  '11.2.3',
  '11.2.5'
]);

test('all 29 individually compared equations use exact, finite source boundaries', () => {
  assert.equal(checked.length, 29);
  for (const id of checked) {
    const e = manifest.entries[id];
    assert.ok(e, `${id}: missing source entry`);
    assert.equal(e.exactFocus, true, `${id}: must not re-expand reviewed crop`);
    assert.ok(Array.isArray(e.focus) && e.focus.length === 4, `${id}: missing reviewed geometry`);
    const bounds = cropFor(e, 505, 720);
    assert.ok(bounds && bounds.width > 8 && bounds.height > 7, `${id}: invalid region`);
    assert.equal(bounds.y, e.focus[1], `${id}: no implicit margins`);
    assert.equal(
      bounds.y + bounds.height,
      e.focus[3],
      `${id}: preserve hand-verified lower boundary`
    );
  }
});

test('numbered pairs are separated without introducing neighboring equation content', () => {
  const map = manifest.entries;
  const top = id => map[id].focus[1];
  const end = id => map[id].focus[3];
  assert.ok(end('3.1.10') <= 412.1);
  assert.ok(end('3.3.5a') <= top('3.3.5b') + 0.01);
  assert.ok(end('3.3.6a') < 106);
  assert.ok(end('3.4.22a') < top('3.4.22b'));
  assert.ok(end('3.5.14') <= top('3.5.15'));
  assert.ok(end('3.5.16') <= top('3.5.17'));
  assert.ok(end('3.1.2a') < 478);
  assert.ok(end('7.2.37') < 316.5);
  assert.ok(end('7.2.41') < 581.5);
  assert.ok(end('11.2.5') < 211.5);
});

test('long fractions and source annotations retain their printed extents', () => {
  const e = manifest.entries;
  assert.ok(e['3.1.10'].focus[3] > 411.5, 'denominator of 3.1.10 intact');
  assert.ok(e['3.4.22a'].focus[3] >= 261, 'subscripts of 3.4.22a intact');
  assert.ok(e['3.4.22b'].focus[1] <= 261.5, 'leading bracket of 3.4.22b intact');
  assert.ok(e['3.4.32'].focus[1] < 592, 'tall fraction brackets intact');
  assert.ok(e['3.5.14'].focus[3] > 561, 'first activation-energy expression intact');
  assert.ok(e['3.5.15'].focus[3] >= 578, 'second activation-energy expression intact');
  assert.ok(
    e['3.5.5'].focus[2] > 340 && e['3.5.6'].focus[2] > 330,
    'the printed dimensional annotations are kept'
  );
  assert.ok(
    e['3.5.5'].exclude.some(mask => mask[0] > 200),
    'adjacent annotation ink must be removed without masking the equation'
  );
  assert.ok(
    e['3.5.6'].exclude.some(mask => mask[0] > 140),
    'isolated upper subscript fragment must be suppressed'
  );
});

test('source-only reviewer emits no PDF or book text in its reports', () => {
  const { readFileSync } = require('node:fs');
  const path = require('node:path');
  const report = JSON.parse(
    readFileSync(path.join(__dirname, '../../docs/EQUATION_BOUNDARY_REVIEW.json'), 'utf8')
  );
  assert.equal(report.summary.indexed_entries, 2004);
  assert.equal(report.summary.standalone_regions, 2000);
  assert.ok(report.summary.flagged_regions >= 0);
  for (const item of report.findings) {
    assert.equal(typeof item.label, 'string');
    assert.ok(Number.isInteger(item.page));
    assert.ok(Array.isArray(item.reasons));
    assert.deepEqual(Object.keys(item).sort(), ['label', 'page', 'reasons']);
  }
});
