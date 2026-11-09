const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHtml,
  normalize,
  formatNumber,
  regexEscape,
  shorten,
  debounce
} = require('../../src/client/core/text.js');

test('safe HTML escaping and null inputs', () => {
  assert.equal(
    escapeHtml(`<img src='x' onerror="alert(1)"> &`),
    '&lt;img src=&#39;x&#39; onerror=&quot;alert(1)&quot;&gt; &amp;'
  );
  assert.equal(escapeHtml(null), '');
});

test('unicode and minus signs normalize for search', () => {
  assert.equal(normalize('Électrode — CATHODIC'), 'electrode - cathodic');
  assert.equal(normalize('E−Eeq'), 'e-eeq');
});

test('regular expression literals are escaped', () => {
  const literal = 'E(1/2) + [η]*';
  assert.match(literal, new RegExp(regexEscape(literal)));
  assert.doesNotMatch('E(1/2) + η', new RegExp(regexEscape(literal)));
});

test('formatting and clipping are well-defined', () => {
  assert.equal(formatNumber(NaN), '—');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(1e-6), '1.000e-6');
  assert.equal(shorten(' ABC   DEF  ', 20), 'ABC DEF');
  assert.equal(shorten('123456789', 6), '12345…');
});

test('debounce coalesces requests using latest args', async () => {
  let calls = [];
  const invoke = debounce(n => calls.push(n), 15);
  invoke('a');
  invoke('b');
  invoke('c');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(calls, ['c']);
});

test('source-derived prose repairs joined function phrases but leaves notation untouched', () => {
  const { repairProseSpacing } = require('../../src/client/core/text.js');
  assert.equal(
    repairProseSpacing('Describe the parameter intermsof a rate constant.'),
    'Describe the parameter in terms of a rate constant.'
  );
  assert.equal(
    repairProseSpacing('in termsof andthe interface withthe reactant'),
    'in terms of and the interface with the reactant'
  );
  assert.equal(
    repairProseSpacing('The electrode isinthe solution;the reaction'),
    'The electrode is in the solution; the reaction'
  );
  assert.equal(
    repairProseSpacing('Equation15.2.8 gives K_eq and Fe(CN)6 3−.'),
    'Equation 15.2.8 gives K_eq and Fe(CN)6 3−.'
  );
  assert.equal(repairProseSpacing('m,of10−2 cm/s;is8 units.'), 'm, of 10−2 cm/s; is 8 units.');
  assert.equal(
    repairProseSpacing('Journal 10–12 and pages 155-160', { mode: 'reference' }),
    'Journal 10–12 and pages 155-160'
  );
});
