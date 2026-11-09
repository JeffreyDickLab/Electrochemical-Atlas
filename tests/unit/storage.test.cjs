const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../../src/client/core/storage.js');

test('persistent storage uses browser storage and retains keys', () => {
  const values = new Map();
  const native = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const store = create({ localStorage: native });
  assert.equal(store.isTemporary, false);
  store.setItem('ea_notes', '{"one":"note"}');
  assert.equal(store.getItem('ea_notes'), '{"one":"note"}');
  store.removeItem('ea_notes');
  assert.equal(store.getItem('ea_notes'), null);
  assert.equal(values.has('__atlas_storage_probe__'), false);
});

test('private browsing falls back to session memory without throwing', () => {
  const store = create({
    get localStorage() {
      throw new Error('denied');
    }
  });
  assert.equal(store.isTemporary, true);
  store.setItem('page', 17);
  assert.equal(store.getItem('page'), '17');
  store.removeItem('page');
  assert.equal(store.getItem('page'), null);
});
