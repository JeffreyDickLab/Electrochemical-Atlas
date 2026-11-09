'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { html, highlight, runsHtml } = require('../../src/client/science/notation.js');
const read = location => fs.readFileSync(path.join(__dirname, '../..', location), 'utf8');

test('Unicode superscripts and subscripts render reliably with their original meaning', () => {
  assert.equal(html('C₆H₁₂O₆'), 'C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>');
  assert.equal(html('Fe³⁺ and SO₄²⁻'), 'Fe<sup>3+</sup> and SO<sub>4</sub><sup>2−</sup>');
  assert.equal(
    html('aᵢ = γᵢ Cᵢ / C⁰'),
    'a<sub>i</sub> = γ<sub>i</sub> C<sub>i</sub> / C<sup>0</sup>'
  );
  assert.equal(
    html('D = 1 × 10−⁶ cm² s⁻¹'),
    'D = 1 × 10<sup>−6</sup> cm<sup>2</sup> s<sup>−1</sup>'
  );
});

test('source-positioned typography retains explicit scripts, font distinctions and overbars', () => {
  const result = runsHtml('source fallback', [
    { text: 'E', italic: true },
    { text: 'A', script: 'sub' },
    { text: '0′', script: 'super' },
    { text: ' G', bold: true, overbar: true },
    { text: ' ℰ', scriptFont: true },
    { text: 'dc', scripts: ['super', 'sub'] }
  ]);
  assert.ok(result.includes('<span class="notation-italic">E</span>'));
  assert.ok(result.includes('<sub>A</sub><sup>0′</sup>'));
  assert.ok(result.includes('<span class="notation-bold notation-overbar"> G</span>'));
  assert.ok(result.includes('<span class="notation-script"> ℰ</span>'));
  assert.ok(result.includes('<sup><sub>dc</sub></sup>'));
  assert.equal(runsHtml('Eeq', null, { mode: 'identifier' }), html('Eeq', { mode: 'identifier' }));
});

test('source runs only render whitelisted markup and always escape PDF text', () => {
  const result = runsHtml('fallback', [
    { text: '<img src=x onerror=alert(1)>', script: 'script', bold: 'onclick', style: 'color:red' },
    { text: '& <b>', scripts: ['super', 'img'], overbar: true }
  ]);
  assert.ok(result.includes('&lt;img'));
  assert.ok(result.includes('&amp; &lt;b&gt;'));
  assert.doesNotMatch(result, /<img|<b>|<script|onclick=|style=/);
  assert.equal(runsHtml('<unsafe>', [{ text: null }]), '&lt;unsafe&gt;');
});

test('Greek, math, physical units and special characters are preserved', () => {
  const sample = 'ΔG° = −RT ln K; α β γ η θ φ π Ω µA μA °C ± ∑ ∂ √ → ⇌ ≤ ≥';
  const rendered = html(sample);
  for (const glyph of [
    'Δ',
    '−',
    'α',
    'β',
    'γ',
    'η',
    'θ',
    'φ',
    'π',
    'Ω',
    'µ',
    'μ',
    '°',
    '±',
    '∑',
    '∂',
    '√',
    '→',
    '⇌',
    '≤',
    '≥'
  ]) {
    assert.ok(rendered.includes(glyph), `missing ${glyph}`);
  }
  assert.equal(html('H₂O + 2e⁻ → H₂'), 'H<sub>2</sub>O + 2e<sup>−</sup> → H<sub>2</sub>');
});

test('unambiguously written compounds and scientific notation are formatted', () => {
  assert.equal(html('Fe(CN)6 3−'), 'Fe(CN)<sub>6</sub><sup>3−</sup>');
  assert.equal(html('[Fe(CN)6]3−'), '[Fe(CN)<sub>6</sub>]<sup>3−</sup>');
  assert.equal(html('CO2'), 'CO<sub>2</sub>');
  assert.equal(
    html('1.5 × 10-6 mol cm-2'),
    '1.5 × 10<sup>−6</sup> mol <span class="sci-unit">cm<sup>−2</sup></span>'
  );
});

test('ambiguous flattened notation and bibliographic ranges are never guessed', () => {
  assert.equal(html('SO42−'), 'SO42−', 'ambiguous charge/subscript must be left alone');
  assert.equal(html('pages 10-12'), 'pages 10-12');
  assert.equal(html('pages 10–12'), 'pages 10–12');
  assert.equal(html('10−12', { mode: 'reference' }), '10−12');
  assert.equal(html('3.0 × 10−6', { mode: 'reference' }), '3.0 × 10<sup>−6</sup>');
  assert.equal(html('Eeq and Epa', { mode: 'reference' }), 'Eeq and Epa');
  assert.equal(html('Nature 10–12 (2014)', { mode: 'reference' }), 'Nature 10–12 (2014)');
});

test('scientific formatting and highlighted search results never trust source HTML', () => {
  assert.equal(html('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  const markup = highlight('Fe(CN)6 3− and H₂O & Co', 'Fe');
  assert.equal(markup, '<mark>Fe</mark>(CN)<sub>6</sub><sup>3−</sup> and H<sub>2</sub>O &amp; Co');
  assert.equal(
    highlight('CO₂ and Fe³⁺', 'CO₂'),
    'CO<sub>2</sub> and Fe<sup>3+</sup>',
    'whole search terms crossing markup may be left unmarked but notation is intact'
  );
  const untrusted = highlight('<svg onload=alert(1)>Fe³⁺</svg>', 'Fe');
  assert.ok(untrusted.includes('&lt;svg'));
  assert.ok(!untrusted.includes('<svg'));
  assert.ok(!untrusted.includes('<img'));
});

test('the PDF text decoder can preserve mapped Greek and Unicode script glyphs', () => {
  const { PDFLite } = require('../../src/client/pdf/pdf-core.js');
  const decoder = new PDFLite({});
  const font = {
    length: 1,
    map: new Map([
      [65, 'α'],
      [66, 'Ω'],
      [67, '₂'],
      [68, '⁺'],
      [69, 'µ']
    ])
  };
  assert.equal(decoder.decodeText('ABCDE', font), 'αΩ₂⁺µ');
  assert.equal(html(decoder.decodeText('ABCDE', font)), 'αΩ<sub>2</sub><sup>+</sup>µ');
});

test('all major source-derived entry types use the shared formatter', () => {
  const details = read('src/client/application/60-entity-details.js');
  assert.match(details, /function sourceTextPresentation\(type, source\)/);
  assert.match(details, /source-text--\$\{kind\}/);
  assert.match(details, /type === 'reference' \? 'reference'/);
  assert.match(details, /problemPresentation\(text\)/);
  const collections = read('src/client/application/30-discovery.js');
  assert.match(collections, /sci\(shorten\(text,\s*300\),\s*\{\s*mode:/);
  const search = read('src/client/application/70-search.js');
  assert.match(search, /window\.AtlasScience\.highlight\(text,\s*query,\s*\{\s*mode\s*\}\)/);
  const calculator = read('src/client/calculators/ui.js');
  assert.match(calculator, /\$\{modelHtml\(spec\.formula\)\}/);
});

test('broken PDF scientific notation and concentration spacing are repaired at display time', () => {
  // Synthetic values reproduce the family of font-span errors, not book content.
  const value = '5.7 × 10–4 MCo3+ and 8.1 × 10 −2 MFe2+ at 22 °C; k,of10 –3 cm/s.';
  const result = html(value);
  assert.ok(result.includes('5.7 × 10<sup>−4</sup> M Co<sup>3+</sup>'), result);
  assert.ok(result.includes('8.1 × 10<sup>−2</sup> M Fe<sup>2+</sup>'), result);
  assert.ok(result.includes('k, of 10<sup>−3</sup> cm/s'), result);
  assert.ok(result.includes('22 °C'), result);
  assert.equal(
    html('A. Author, pp. 10–12 (2020)', { mode: 'reference' }),
    'A. Author, pp. 10–12 (2020)'
  );
  assert.equal(html('m,of10–2 cm/s'), 'm, of 10<sup>−2</sup> cm/s');
});

test('PDF font-boundary reflow preserves words before numeric expressions', () => {
  const code = read('src/client/pdf/catalog-extractor.js');
  assert.match(code, /Ordinary words followed by a number still require a separating space/);
  assert.match(code, /join\s*=\s*inline\s*\?\s*''\s*:\s*' ';/);
});

test('existing imported text is repaired during display without altering scientific identifiers', () => {
  const source = 'A derivation is written intermsof a ratio, andthe current is used.';
  const output = html(source);
  assert.equal(output, 'A derivation is written in terms of a ratio, and the current is used.');
  assert.match(
    html('The potential in termsof Eeq and Rct.'),
    /in terms of E<sub>eq<\/sub> and R<sub>ct<\/sub>/
  );
  assert.equal(html('H₂ + 2e⁻ → 2H⁻'), 'H<sub>2</sub> + 2e<sup>−</sup> → 2H<sup>−</sup>');
  assert.equal(html('Journal 10–12, 500–520', { mode: 'reference' }), 'Journal 10–12, 500–520');
});

test('figure descriptions benefit from the shared prose-spacing repair', () => {
  const rendered = html(
    'The parameter γ is C×electrolyte/C×redox, and the curve lies tothewaveheightatexcesselectrolyte(γ→∞).'
  );
  assert.match(rendered, /C × electrolyte\/C × redox/);
  assert.match(rendered, /to the wave height at excess electrolyte\(γ→∞\)/);
});
