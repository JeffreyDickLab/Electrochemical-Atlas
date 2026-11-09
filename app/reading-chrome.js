/* Reader chrome visibility. The selected PDF and saved reading state are untouched. */
(() => {
  'use strict';
  const key = 'ea_top_bars_hidden_v4_3';
  const hideButton =
    document.getElementById('floatingHideBar') || document.getElementById('collapseTopBars');
  const restoreButton = document.getElementById('restoreTopBars');
  if (!hideButton || !restoreButton) return;
  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(key) === '1';
  } catch (_) {}
  function setCollapsed(next, persist = true) {
    collapsed = Boolean(next);
    document.body.classList.toggle('atlas-top-bars-hidden', collapsed);
    hideButton.setAttribute('aria-pressed', String(collapsed));
    restoreButton.hidden = !collapsed;
    if (persist) {
      try {
        window.localStorage.setItem(key, collapsed ? '1' : '0');
      } catch (_) {}
    }
    window.requestAnimationFrame(() => window.AtlasReader?.resize?.());
  }
  hideButton.addEventListener('click', () => setCollapsed(true));
  restoreButton.addEventListener('click', () => setCollapsed(false));
  document.addEventListener('keydown', event => {
    if (
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.toLowerCase() !== 'h'
    )
      return;
    if (
      event.isComposing ||
      event.repeat ||
      event.target?.closest?.('input,textarea,select,[contenteditable],dialog[open]')
    )
      return;
    if (document.querySelector('dialog[open]')) return;
    if (document.getElementById('pdfImport')) return;
    event.preventDefault();
    setCollapsed(!collapsed);
  });
  // Reset layout also restores visibility, without affecting notes or reader page.
  document.addEventListener('atlas-layout-reset', () => setCollapsed(false));
  setCollapsed(collapsed, false);
})();
