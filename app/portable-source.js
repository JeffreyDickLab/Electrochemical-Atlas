/* Optional companion for the included portable desktop launcher.
   Remember a filesystem path, never PDF bytes or extracted book content.
   The plain HTML version continues to work without this companion. */
(root => {
  'use strict';
  const base = '/__atlas/';
  const plausible =
    location.protocol === 'http:' && /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname);
  async function call(endpoint, body, signal) {
    const method = body === undefined ? 'GET' : 'POST';
    const response = await fetch(base + endpoint, {
      method,
      headers:
        method === 'POST'
          ? { 'Content-Type': 'application/json', 'X-Atlas-Request': 'same-origin' }
          : {},
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
      signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || 'The portable launcher could not access the source file.');
    return data;
  }
  let tabSession = null;
  function trackBrowserLifetime() {
    if (tabSession || !plausible) return;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    let closed = false,
      live = null,
      pulse = null;
    const post = (event, keepalive = false) =>
      fetch(base + 'session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Atlas-Request': 'same-origin' },
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive,
        body: JSON.stringify({ id, event })
      }).catch(() => {});
    const ensurePulse = () => {
      if (!pulse) {
        pulse = setInterval(() => post('ping'), 4000);
      }
    };
    post('open');
    ensurePulse();
    // The local server owns this connection. When the user exits the browser,
    // its socket closes and the server receives an immediate disconnect even
    // if the unload keepalive request never reaches the launcher.
    if (typeof EventSource === 'function') {
      live = new EventSource(base + 'live?id=' + encodeURIComponent(id));
      live.onerror = () => {
        if (closed) return;
        // Keep POST heartbeats active for browsers that block or drop SSE.
        ensurePulse();
      };
    }
    const close = () => {
      if (closed) return;
      closed = true;
      if (live) {
        live.close();
        live = null;
      }
      if (pulse) {
        clearInterval(pulse);
        pulse = null;
      }
      tabSession = null;
      post('close', true);
    };
    tabSession = { id, close };
    window.addEventListener('pagehide', close, { once: true });
    window.addEventListener('pageshow', event => {
      // Pages restored from the back/forward cache need a fresh live socket.
      if (event.persisted && !tabSession) trackBrowserLifetime();
    });
    document.addEventListener('visibilitychange', () => {
      if (!closed && document.visibilityState === 'visible' && !live) post('ping');
    });
  }
  async function detect() {
    if (!plausible) return null;
    try {
      const response = await fetch(base + 'status', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (response.headers.get('X-Atlas-Launcher') !== 'Electrochemical-Atlas-Portable-v1')
        return null;
      const data = await response.json();
      if (data?.portable) {
        trackBrowserLifetime();
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }
  async function readFile(name) {
    const response = await fetch(base + 'pdf', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      const d = await response.json().catch(() => ({}));
      throw new Error(d.error || 'Could not reopen the original PDF.');
    }
    const blob = await response.blob();
    // The browser holds a temporary session File. It is never written to
    // storage or to the application directory.
    return new File([blob], name || 'original.pdf', { type: 'application/pdf' });
  }
  root.AtlasPortable = {
    detect,
    status: () => call('status'),
    choose: signal => call('select', {}, signal),
    rememberPath: path => call('path', { path }),
    forget: () => call('forget', {}),
    readFile
  };
})(window);
