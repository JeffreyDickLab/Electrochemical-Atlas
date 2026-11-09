'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../../src/client/pdf/catalog-extractor.js');

function engineFor(blocks) {
  return {
    pageObjects: [1, 2, 3],
    labels: ['1', '2', '3'],
    outline: [
      { level: 1, title: 'Chapter 14', page: 1 },
      { level: 2, title: '14.9 Problems', page: 2 },
      { level: 1, title: 'Chapter 15', page: 3 }
    ],
    async pageText(page) {
      return (blocks[page - 1] || []).map(block => block.text).join('\n');
    },
    async pageBlocks(page) {
      return blocks[page - 1] || [];
    },
    async pageEquationAnchors() {
      return [];
    }
  };
}

const block = (font, text) => ({ text, runs: [{ font, text }] });

test('a printed figure number remains browsable when its diagram has no prose caption', async () => {
  const engine = engineFor([
    [block('F2', 'Chapter 14')],
    [
      block('F2', '14.9 Problems'),
      block('F3', 'Refer to Figure 14.9.1 for the earlier example.'),
      block('F12', 'x y z'),
      block('F2', 'Figure 14.9.2')
    ],
    [block('F2', 'Chapter 15')]
  ]);
  const { catalog } = await build(engine);
  assert.deepEqual(
    catalog.figures.map(figure => figure.label),
    ['14.9.2']
  );
  assert.equal(catalog.figures[0].pdf_page, 2);
  assert.equal(catalog.figures[0].caption, '');
  assert.equal(catalog.meta.counts.figures, 1);
});

test('an uncaptioned figure outside its chapter is not accepted', async () => {
  const engine = engineFor([
    [block('F2', 'Chapter 14')],
    [block('F2', 'Figure 3.1.1')],
    [block('F2', 'Chapter 15')]
  ]);
  const { catalog } = await build(engine);
  assert.equal(catalog.figures.length, 0);
});
