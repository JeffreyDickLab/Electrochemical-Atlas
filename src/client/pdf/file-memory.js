/* Remember only a permission-scoped FileSystemFileHandle, never PDF bytes,
   extracted text, thumbnails, page images, or a document index. */
(root => {
  'use strict';
  const dbName = 'ea_pdf_handle_v1',
    store = 'references',
    key = 'currentPdf';
  const available = () =>
    typeof root.showOpenFilePicker === 'function' && typeof indexedDB !== 'undefined';
  async function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser storage is unavailable'));
      request.onblocked = () => reject(new Error('File-reference storage is blocked'));
    });
  }
  async function transaction(action, handle) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, action === 'read' ? 'readonly' : 'readwrite');
        const table = tx.objectStore(store);
        const request =
          action === 'read'
            ? table.get(key)
            : action === 'delete'
              ? table.delete(key)
              : table.put(handle, key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error || new Error('Cannot access saved file reference'));
        tx.onerror = () => reject(tx.error || new Error('File-reference storage failed'));
      });
    } finally {
      db.close();
    }
  }
  async function pick() {
    // This must be called directly by a button click (transient user gesture).
    const items = await root.showOpenFilePicker({
      id: 'atlas-original-pdf',
      multiple: false,
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }]
    });
    return items[0] || null;
  }
  async function permission(handle, request = false) {
    if (!handle) return 'denied';
    // Read-only permission; Atlas never edits the user's source PDF.
    if (typeof handle.queryPermission === 'function') {
      const status = await handle.queryPermission({ mode: 'read' });
      if (status === 'granted' || !request) return status;
    }
    if (request && typeof handle.requestPermission === 'function')
      return handle.requestPermission({ mode: 'read' });
    return 'prompt';
  }
  root.AtlasFileMemory = {
    available,
    remember: h => transaction('write', h),
    recall: () => transaction('read'),
    forget: () => transaction('delete'),
    pick,
    permission
  };
})(window);
