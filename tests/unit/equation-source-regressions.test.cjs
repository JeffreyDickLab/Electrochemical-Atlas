'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '../..');
const data = JSON.parse(readFileSync(join(root, 'src/client/equations/source-map.json'), 'utf8'));
const expectations = {
  '1.6.1': [404, 422.8],
  '2.1.27': [162.5, 196.7],
  '2.1.36': [576.9, 606.6],
  '2.1.52': [274.8, 300.5],
  '2.2.7': [164.1, 204.2],
  '2.2.8': [232, 272.5],
  '2.2.37': [181.9, 213]
};
for (const [label, [start, end]] of Object.entries(expectations)) {
  test(`${label} uses verified source bounds`, () => {
    const entry = data.entries[label];
    assert.equal(entry.exactFocus, true);
    assert.equal(entry.focus[1], start);
    assert.equal(entry.focus[3], end);
    assert.ok(entry.focus[2] > entry.focus[0]);
  });
}
