'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../../src/client/pdf/catalog-extractor.js');
// Synthetic PDF text-show blocks reproduce the interleaved order of a problem,
// graph labels, its caption, and a next-page continuation. No source book text
// or graphics are distributed with these tests.
const b = (font, text) => ({ text, runs: [{ font, text }] });
function createEngine(pageBlocks, outline) {
  return {
    pageObjects: pageBlocks.map((_, i) => i + 1),
    labels: pageBlocks.map((_, i) => String(i + 1)),
    outline,
    async pageText(pg) {
      return pageBlocks[pg - 1].map(block => block.text).join('\n');
    },
    async pageBlocks(pg) {
      return pageBlocks[pg - 1];
    },
    async pageEquationAnchors() {
      return [];
    }
  };
}
test('problem spans a page break and skips an inserted figure, graph labels and a running header', async () => {
  const engine = createEngine(
    [
      [b('F2', 'Chapter 14')],
      [
        b('F2', '14.9 Problems'),
        ...Array.from({ length: 9 }, (_, i) => [
          b('F2', `\n14.${i + 1}\n`),
          b('F3', `Earlier problem number ${i + 1} with its own statement.`)
        ]).flat()
      ],
      [
        b('F2', '14.9 Problems 649'),
        b('F2', '\n14.10\n'),
        b('F3', 'An adsorbate has a stated saturation value.'),
        b('F3', 'Sketch the'),
        b('F12', '440'),
        b('F12', '0.0 −0.4 −0.8 −1.2 −1.6'),
        b('F12', 'Na2SO4'),
        b('F12', 'E/V vs. NCE'),
        b('F12', '(a) (b)'),
        b('F8', 'Figure 14.9.1 (a) Experimental traces. (b) Related traces.')
      ],
      [
        b('F3', '650 14 Double-Layer Structure and Adsorption'),
        b(
          'F3',
          'adsorption isotherm of X. For which concentration range is the approximation valid?'
        ),
        b('F2', '\n14.11\n'),
        b('F3', 'A second problem with its own statement.')
      ],
      [b('F2', 'Chapter 15')]
    ],
    [
      { level: 1, title: 'Chapter 14', page: 1 },
      { level: 2, title: '14.9 Problems', page: 2 },
      { level: 1, title: 'Chapter 15', page: 5 }
    ]
  );
  const { catalog } = await build(engine);
  const first = catalog.problems.find(p => p.label === '14.10');
  const second = catalog.problems.find(p => p.label === '14.11');
  assert.ok(first, 'problem begins before the figure');
  assert.ok(second, 'next problem must still have its own entry');
  assert.match(first.text, /Sketch the adsorption isotherm of X\./);
  assert.match(first.text, /approximation valid\?/);
  assert.equal(first.pdf_page, 3);
  assert.equal(first.pdf_page_end, 4, 'continuation is traced through the next PDF page');
  assert.doesNotMatch(first.text, /Figure|440|0\.0|NCE|Na2SO4|Double-Layer/);
  assert.doesNotMatch(first.text, /second problem/i);
  assert.match(second.text, /second problem/);
});
test('caption before tabular rows is skipped and same-page problem prose resumes', async () => {
  const engine = createEngine(
    [
      [b('F2', 'Chapter 3')],
      [
        b('F2', '3.11 Problems'),
        b('F2', '\n3.1\n'),
        b('F3', 'Compare the observations and the following data.'),
        b('F8', 'Table 3.7.2 Sample measurements at three concentrations.'),
        b('F9', '1.2 3.4 5.6 7.8'),
        b('F9', '0.0 0.1 0.2 0.3'),
        b('F3', 'Explain why the two limiting cases differ.'),
        b('F2', '\n3.2\n'),
        b('F3', 'Compute the value for the second case.')
      ],
      [b('F2', 'Chapter 4')]
    ],
    [
      { level: 1, title: 'Chapter 3', page: 1 },
      { level: 2, title: '3.11 Problems', page: 2 },
      { level: 1, title: 'Chapter 4', page: 3 }
    ]
  );
  const { catalog } = await build(engine);
  const first = catalog.problems.find(p => p.label === '3.1');
  assert.ok(first);
  assert.match(first.text, /following data\. Explain why/);
  assert.doesNotMatch(first.text, /Table 3\.7\.2|1\.2 3\.4|0\.0 0\.1/);
  assert.match(catalog.problems.find(p => p.label === '3.2').text, /second case/);
});
test('a problem without figures keeps standalone mathematics and scientific symbols', async () => {
  const engine = createEngine(
    [
      [b('F2', 'Chapter 2')],
      [
        b('F2', '2.12 Problems'),
        b('F2', '\n2.1\n'),
        b('F3', 'Calculate the result using the following relationship:'),
        b('F6', 'i = nFAD¹ᐟ²C'),
        b('F3', 'where C is the bulk concentration.')
      ],
      [b('F2', 'Chapter 3')]
    ],
    [
      { level: 1, title: 'Chapter 2', page: 1 },
      { level: 2, title: '2.12 Problems', page: 2 },
      { level: 1, title: 'Chapter 3', page: 3 }
    ]
  );
  const { catalog } = await build(engine);
  const value = catalog.problems.find(p => p.label === '2.1')?.text || '';
  assert.match(value, /i = nFAD¹ᐟ²C/);
  assert.match(value, /bulk concentration/);
});
