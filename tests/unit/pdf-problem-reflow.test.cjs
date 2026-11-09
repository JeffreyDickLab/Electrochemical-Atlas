'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../../src/client/pdf/catalog-extractor.js');
const { html } = require('../../src/client/science/notation.js');

// All sample text is synthetic. The real source PDF is not distributed.
function syntheticEngine() {
  const pages = ['Chapter 1', '1.11 Problems', '', 'Chapter 2'];
  return {
    pageObjects: pages.map((_, i) => i + 1),
    labels: pages.map((_, i) => String(i + 1)),
    outline: [
      { level: 1, title: 'Chapter 1', page: 1 },
      { level: 2, title: '1.11 Problems', page: 2 },
      { level: 1, title: 'Chapter 2', page: 4 }
    ],
    async pageText(page) {
      return pages[page - 1] || '';
    },
    async pageBlocks(page) {
      if (page !== 2) return [];
      return [
        { text: '1.11 Problems', runs: [{ font: 'F2', text: '1.11 Problems' }] },
        {
          text: '1.1',
          runs: [
            { font: 'F2', text: '\n1.1\n' },
            { font: 'F3', text: 'A sample contains 6.7 × 10' },
            { font: 'F6', text: '−4' },
            { font: 'F3', text: ' M' },
            { font: 'F5', text: 'Co3+' },
            { font: 'F3', text: '; coefficient k, of' },
            { font: 'F6', text: '10−2' },
            { font: 'F3', text: ' cm/s.' }
          ]
        }
      ];
    },
    async pageEquationAnchors() {
      return [];
    }
  };
}

test('PDF font boundaries reflow concentration, ionic charges, and separated exponents', async () => {
  const { catalog } = await build(syntheticEngine());
  const problem = catalog.problems.find(p => p.label === '1.1');
  assert.ok(problem, 'valid labels must survive a next-chapter heading with an empty subtitle');
  assert.match(problem.text, /6\.7 × 10−4 M Co3\+/);
  assert.match(problem.text, /k, of 10−2 cm\/s/);
  assert.doesNotMatch(problem.text, /of10|MCo/);
  const rendered = html(problem.text);
  assert.match(rendered, /10<sup>−4<\/sup> M Co<sup>3\+<\/sup>/);
  assert.match(rendered, /of 10<sup>−2<\/sup> cm\/s/);
});

test('PDF problem source reflow repairs run-on prose after font spans', async () => {
  const engine = syntheticEngine();
  const getBlocks = engine.pageBlocks;
  engine.pageBlocks = async pg => {
    const blocks = await getBlocks(pg);
    if (pg !== 2) return blocks;
    const statement = blocks[1].runs;
    statement.push({
      font: 'F3',
      text: 'A term is defined intermsof a parameter, andthe rate is measured.'
    });
    return blocks;
  };
  const { catalog } = await build(engine);
  const result = catalog.problems.find(x => x.label === '1.1');
  assert.ok(result);
  assert.match(result.text, /in terms of a parameter, and the rate is measured/);
});

test('joined amplifier terminology is repaired when an imported PDF block is reflowed', async () => {
  const engine = syntheticEngine();
  const getBlocks = engine.pageBlocks;
  engine.pageBlocks = async page => {
    const blocks = await getBlocks(page);
    if (page === 2)
      blocks[1].runs.push({
        font: 'F3',
        text: 'A circuit is connected to the noninverting inputofCF2.WhatistheoutputofCF2?'
      });
    return blocks;
  };
  const { catalog } = await build(engine);
  const text = catalog.problems.find(x => x.label === '1.1')?.text || '';
  assert.match(text, /noninverting input of CF2\. What is the output of CF2\?/);
  assert.doesNotMatch(text, /inputof|Whatisthe|outputof/);
});
