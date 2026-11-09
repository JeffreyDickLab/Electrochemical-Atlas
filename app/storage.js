/** Local user preferences and saved study data. Never persists PDF contents. */
((root, factory) => {
  'use strict';
  const api = factory();
  if (root) root.AtlasStorage = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, () => {
  'use strict';
  function create(host) {
    try {
      const native = host.localStorage;
      const key = '__atlas_storage_probe__';
      native.setItem(key, '1');
      native.removeItem(key);
      return Object.freeze({
        getItem: key => native.getItem(key),
        setItem: (key, value) => native.setItem(key, String(value)),
        removeItem: key => native.removeItem(key),
        isTemporary: false
      });
    } catch {
      const values = new Map();
      return Object.freeze({
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        isTemporary: true
      });
    }
  }
  return Object.freeze({ create });
});
