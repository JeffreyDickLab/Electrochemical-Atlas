/* Unified, responsive toolbar. Works with the original live search, history,
 * PDF reader, and view controls; never clones stateful application elements. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const header = document.querySelector('body > .topbar');
  const toolbar = header?.querySelector('.layout-toolbar');
  const actions = header?.querySelector('.top-actions');
  const history = toolbar?.querySelector('.atlas-history-buttons');
  const modes = toolbar?.querySelector('.atlas-view-modes');
  const location = $('atlasLocation');
  const search = header?.querySelector(':scope > .search-wrap');
  if (!header || !toolbar || !actions || !history || !modes || !search) return;

  // A single row on desktop; two rows INSIDE the same header on small screens.
  // The search box and view buttons are moved, never copied.
  // Catalog destinations live in Menu; the optional compact list uses Shift+L.
  const searchArea = document.createElement('div');
  searchArea.className = 'atlas-toolbar-search';
  searchArea.setAttribute('role', 'search');
  searchArea.append(search);
  const right = document.createElement('div');
  right.className = 'atlas-toolbar-right';
  right.append(modes);

  // A native selector replaces (not duplicates) the desktop view toggle at
  // smaller widths; both use the same workspace methods and saved state.
  const compact = document.createElement('select');
  compact.id = 'atlasCompactMode';
  compact.className = 'atlas-compact-mode';
  compact.setAttribute('aria-label', 'Reading layout');
  compact.title = 'Reading layout';
  for (const [value, label] of [
    ['explore', 'Explore'],
    ['together', 'Together'],
    ['read', 'Read']
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    compact.append(option);
  }
  right.prepend(compact);
  compact.addEventListener('change', () =>
    modes.querySelector(`[data-atlas-mode="${compact.value}"]`)?.click()
  );
  const syncMode = () => {
    const active = modes.querySelector('[data-atlas-mode][aria-pressed="true"]');
    if (active && compact.value !== active.dataset.atlasMode)
      compact.value = active.dataset.atlasMode;
  };
  new MutationObserver(syncMode).observe(modes, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-pressed']
  });
  const syncMobileAvailability = () => {
    // Side-by-side cannot fit on phone-sized viewports. Do not offer a
    // selector choice that silently turns into PDF-only mode.
    const option = compact.querySelector('option[value="together"]');
    const unavailable = window.innerWidth < 800;
    option.disabled = unavailable;
    option.hidden = unavailable;
    syncMode();
  };
  window.addEventListener('resize', syncMobileAvailability);
  syncMobileAvailability();

  toolbar.replaceChildren(history, searchArea, right);
  if (location) toolbar.append(location);
  header.insertBefore(toolbar, actions);

  // Appearance remains accessible from the mobile menu when its compact
  // header icon is hidden.
  const nav = $('mainNav');
  const theme = $('themeToggle');
  if (nav && theme) {
    const utilities = document.createElement('div');
    utilities.className = 'atlas-mobile-nav-actions';
    const appearance = document.createElement('button');
    appearance.type = 'button';
    appearance.className = 'atlas-mobile-nav-action';
    appearance.textContent = 'Switch appearance';
    appearance.addEventListener('click', () => theme.click());
    utilities.append(appearance);
    nav.append(utilities);
  }
  document.body.classList.add('atlas-unified-toolbar');
})();
