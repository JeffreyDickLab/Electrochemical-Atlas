'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const text = require('../../src/client/core/text.js');
const science = require('../../src/client/science/notation.js');

function harness() {
  const sections = [
    { id: '1', title: 'Chapter 1 Foundations' },
    { id: '2.3', title: '2.3 Example method' },
    { id: 'A.1', title: 'A.1 Mathematical example' }
  ];
  const opened = [];
  const context = vm.createContext({
    window: { AtlasScience: science },
    sectionById: new Map(sections.map(section => [section.id, section])),
    esc: text.escapeHtml,
    sci: science.html,
    regexEscape: text.regexEscape
  });
  for (const name of ['40-catalog.js', '60-entity-details.js']) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '../../src/client/application', name), 'utf8'),
      context
    );
  }
  const events = fs.readFileSync(
    path.join(__dirname, '../../src/client/application/80-events.js'),
    'utf8'
  );
  vm.runInContext(events.slice(0, events.indexOf('  window.AtlasApp =')), context);
  context.showEntity = (type, item) => opened.push({ type, item });
  return { context, opened, sections };
}

test('notation detail links resolve exact catalog references without splitting lettered suffixes', () => {
  const h = harness();
  const markup = h.context.notationSectionLinks('1; 2.3, 2.3(c,d), A.1, 4.1–4.3, Table C.2');
  const keys = [...markup.matchAll(/data-open-section="([^"]+)"/g)].map(([, key]) => key);
  assert.deepEqual(keys, ['1', '2.3', 'A.1']);
  assert.match(markup, />1 — Foundations<\/button>/);
  assert.match(markup, />2\.3 — Example method<\/button>/);
  assert.match(markup, />2\.3\(c,d\)<\/span>/);
  assert.match(markup, />4\.1–4\.3<\/span>/);
  assert.match(markup, />Table C\.2<\/span>/);
  assert.equal(h.context.notationSectionLinks('  '), '');
  assert.doesNotMatch(h.context.notationSectionLinks('<img onerror=x>'), /<img/);

  const buttons = keys.map(key => ({
    dataset: { openSection: key },
    addEventListener(name, listener) {
      this[name] = listener;
    }
  }));
  h.context.$$ = selector => (selector === '[data-open-section]' ? buttons : []);
  h.context.bindCommonActions({});
  buttons[1].click();
  assert.equal(h.opened[0].type, 'section');
  assert.equal(h.opened[0].item, h.sections[1]);
});

test('notation details preserve complete meaning groups and explicit source typography', () => {
  const h = harness();
  const item = {
    meaning: 'old aggregate',
    units: 'old units',
    sections: 'wrong',
    definitions: [
      {
        label: '(a)',
        meaning: 'first meaning with a formula',
        meaning_runs: [
          { text: 'first meaning ' },
          { text: 'E', italic: true },
          { text: '0', script: 'super' }
        ],
        units: 'm2 s−1',
        units_runs: [
          { text: 'm' },
          { text: '2', script: 'super' },
          { text: ' s' },
          { text: '−1', script: 'super' }
        ],
        sections: '2.3'
      },
      {
        label: '(b)',
        meaning: 'second meaning with an intentionally blank unit cell',
        units: '',
        sections: 'A.1'
      }
    ]
  };
  const markup = h.context.notationPresentation('symbol', item);
  assert.doesNotMatch(markup, /old aggregate|old units|wrong/);
  assert.equal((markup.match(/class="notation-definition"/g) || []).length, 2);
  assert.equal((markup.match(/Usual units:/g) || []).length, 1);
  assert.match(markup, /<sup>−1<\/sup>/);
  assert.match(markup, /notation-italic">E<\/span><sup>0<\/sup>/);
  assert.match(markup, /second meaning with an intentionally blank unit cell/);
  assert.match(markup, /data-open-section="2\.3"/);
  assert.match(markup, /data-open-section="A\.1"/);
});
