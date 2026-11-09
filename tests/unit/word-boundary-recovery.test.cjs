'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { repairProseSpacing } = require('../../src/client/core/text.js');
const { html } = require('../../src/client/science/notation.js');

test('rejoins word boundaries in a multiword PDF text-show run', () => {
  assert.equal(
    repairProseSpacing('Connect the circuit at the noninverting inputofCF2.WhatistheoutputofCF2?'),
    'Connect the circuit at the noninverting input of CF2. What is the output of CF2?'
  );
  assert.equal(
    repairProseSpacing('Theelectrode is coupled withtheamplifier. Find theoutputofCF2.'),
    'The electrode is coupled with the amplifier. Find the output of CF2.'
  );
  assert.equal(
    repairProseSpacing('A current is measured attheelectrodewiththevoltageof10−3 M Fe3+.'),
    'A current is measured at the electrode with the voltage of 10−3 M Fe3+.'
  );
  assert.equal(
    repairProseSpacing('Figure16.4.6 gives theoutputof'),
    'Figure 16.4.6 gives the output of'
  );
});

test('the repair is repeatable and deliberately does not divide valid terms', () => {
  const original =
    'WhatistheoutputofCF2? Voltage e2−e1 is measured at the noninverting inputofCF2.';
  const repaired = repairProseSpacing(original);
  assert.equal(repairProseSpacing(repaired), repaired);
  for (const intact of [
    'noninverting',
    'thermodynamics',
    'electrochemistry',
    'isotherm',
    'interfacial',
    'hereinafter',
    'herewith',
    'Welland',
    'CosmosDB',
    'PowerPC',
    'Fe(CN)6 3−',
    'H2O',
    'e2−e1',
    'CF2',
    'Na2SO4',
    '10–12',
    '155-160'
  ]) {
    assert.equal(repairProseSpacing(intact), intact, `must preserve ${intact}`);
  }
  assert.equal(
    repairProseSpacing('WhatistheoutputofCF2?', { mode: 'reference' }),
    'WhatistheoutputofCF2?',
    'bibliographic titles should not be lexically rewritten'
  );
});

test('existing cached entries display correct spaces and circuit indices', () => {
  const displayed = html(
    'Amplifiers I2 and Z2 produce e2−e1 at the noninverting inputofCF2.WhatistheoutputofCF2?'
  );
  assert.match(displayed, /I<sub>2<\/sub>/);
  assert.match(displayed, /Z<sub>2<\/sub>/);
  assert.match(displayed, /e<sub>2<\/sub>−e<sub>1<\/sub>/);
  assert.match(displayed, /input of CF<sub>2<\/sub>\. What is the output of CF<sub>2<\/sub>\?/);
  assert.doesNotMatch(displayed, /inputof|Whatisthe|outputof/);
});

test('figure and table captions recover omitted prose spaces and signed values', () => {
  assert.equal(
    repairProseSpacing(
      'The parameter γ is C×electrolyte/C×redox, and i(γ)/i(γ→∞) is the ratio of the SSV wave height at a given γ tothewaveheightatexcesselectrolyte(γ→∞).'
    ),
    'The parameter γ is C × electrolyte/C × redox, and i(γ)/i(γ→∞) is the ratio of the SSV wave height at a given γ to the wave height at excess electrolyte(γ→∞).'
  );
  assert.equal(
    repairProseSpacing(
      'The curves for charge values of−3and−2 are not labeled but are seen between those for−4and−1.'
    ),
    'The curves for charge values of −3 and −2 are not labeled but are seen between those for −4 and −1.'
  );
});
