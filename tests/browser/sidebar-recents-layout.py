#!/usr/bin/env python3
"""Check the shared recent-activity footer, its layout, and restored actions.

Uses the actual storage/navigation modules and entity resolver with synthetic
catalog entries. No textbook, PDF import, or network is required.
"""
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / 'app/index.html').read_text()
CSS = (ROOT / 'app/atlas.css').read_text()
HTML = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', HTML)
HTML, stylesheet_replacements = re.subn(
    r'<link\s+rel="stylesheet"\s+href="atlas\.css"\s*/?\s*>',
    lambda match: '<style>' + CSS + '</style>', HTML
)
assert stylesheet_replacements == 1, f'Expected one Atlas stylesheet, found {stylesheet_replacements}'

STATE_SOURCE = (ROOT / 'src/client/application/10-state-and-layout.js').read_text()
STUDY_SOURCE = (ROOT / 'src/client/application/50-study-tools.js').read_text()
ENTITY_KEY = STATE_SOURCE[
    STATE_SOURCE.index('  function entitySourceId('):STATE_SOURCE.index('  function noteKey(')
]
RESOLVER = STUDY_SOURCE[
    STUDY_SOURCE.index('  function resolveEntityBookmark('):
    STUDY_SOURCE.index('  function savedKeyType(')
]
REFERENCE_FIXTURE = '''
(() => {
  const C = window.ATLAS_CATALOG;
''' + ENTITY_KEY + RESOLVER + '''
  window.AtlasApp.entitySourceId = entitySourceId;
  window.AtlasApp.entityKey = entityKey;
  window.AtlasApp.resolveEntityBookmark = resolveEntityBookmark;
})();
'''

STUBS = '''
window.AtlasCalcEngine = {specs: []};
window.AtlasScience = {html: value => String(value)};
window.ATLAS_SOURCE_SHA256 = 'a'.repeat(64);
window.ATLAS_CATALOG = {
  figures: [{label: '1.1', title: 'Figure 1.1', caption: 'PRIVATE FIGURE CAPTION'}],
  tables: [{label: '1.2', title: 'Table 1.2', description: 'PRIVATE TABLE TEXT'}],
  equations: [{label: '1.3', title: 'Equation 1.3', context: 'Synthetic formula'}],
  problems: [{label: '1.4', title: 'Problem 1.4', description: 'Synthetic problem'}],
  references: [{chapter: 1, number: 1, text: 'Synthetic reference'}],
  index: [], symbols: [], abbreviations: [], chemicals: [], sections: [],
  meta: {pdf_pages: 50}
};
// Keep a deterministic backing store even on the fixture's opaque origin.
// AtlasStorage itself still performs its native-storage probe and all access.
window.__stored = new Map(Object.entries(__SAVED_STORAGE__));
Object.defineProperty(window, 'localStorage', {configurable: true, value: {
  getItem: key => window.__stored.get(key) ?? null,
  setItem: (key, value) => window.__stored.set(key, String(value)),
  removeItem: key => window.__stored.delete(key)
}});
window.__opened = [];
window.__searches = [];
window.AtlasApp = {
  state: {readerPage: 3}, user: {bookmarks: {pages: [], entities: []}},
  sectionById: new Map(), searchAll: () => [],
  goView: () => window.AtlasLayout.atlasView(), openPdf: () => {},
  showEntity(type, item) {
    window.__opened.push([type, this.entityKey(type, item)]);
    this.state.currentEntity = {type, item};
    window.AtlasLayout.atlasView();
    document.dispatchEvent(new CustomEvent('atlas-location', {detail: {kind: 'entity', type, item}}));
  },
  runSearch(query, scope) {
    window.__searches.push([query, scope]);
    window.AtlasLayout.atlasView();
    document.dispatchEvent(new CustomEvent('atlas-search-committed', {detail: {query, scope}}));
    document.dispatchEvent(new CustomEvent('atlas-location', {detail: {kind: 'search', query, scope}}));
  }
};
document.querySelector('#pdfImport').style.display = 'none';
document.querySelector('#content').innerHTML = '<section id="atlasRecentHome"></section>';
'''


def prepare(page, saved=None):
    page.set_content(HTML)
    page.add_script_tag(content=STUBS.replace('__SAVED_STORAGE__', json.dumps(saved or {})))
    page.add_script_tag(content=REFERENCE_FIXTURE)
    for name in ('storage.js', 'layout-controller.js', 'navigation.js', 'catalog-rail.js', 'toolbar.js'):
        page.add_script_tag(content=(ROOT / 'app' / name).read_text())
    page.locator('#atlasMenuButton').wait_for()
    open_menu(page)


def open_menu(page):
    if page.evaluate("document.body.classList.contains('layout-no-nav')"):
        page.locator('#atlasMenuButton').click()


def recent_labels(page):
    return page.locator('#atlasSidebarRecentList .atlas-sidebar-recent-name').all_text_contents()


def layout_state(page):
    return page.evaluate('''() => {
      const get = id => document.getElementById(id);
      const nav = get('mainNav'), footer = get('atlasSidebarRecent');
      const navBox = nav.getBoundingClientRect(), footerBox = footer.getBoundingClientRect();
      const displayed = getComputedStyle(footer).display !== 'none';
      const buttons = [...nav.querySelectorAll('button[data-view]')];
      const recentButtons = [...footer.querySelectorAll('button')];
      return {
        menuOverflow: getComputedStyle(nav).overflowY,
        menuScroll: nav.scrollHeight > nav.clientHeight + 1,
        clippedButtons: buttons.filter(button => button.getBoundingClientRect().bottom > navBox.bottom + 1)
          .map(button => button.dataset.view),
        destinations: buttons.map(button => button.dataset.view),
        footerVisible: displayed,
        footerFits: !displayed || footerBox.bottom <= get('sidebar').getBoundingClientRect().bottom + 1,
        recentCount: recentButtons.length,
        clippedRecents: displayed && recentButtons.some(button =>
          button.getBoundingClientRect().bottom > footerBox.bottom + 1),
        dividerWidth: get('navDivider').getBoundingClientRect().width
      };
    }''')


def main():
    sizes = [
        (1440, 1000), (1280, 900), (1000, 850), (1000, 780), (1000, 761),
        (1000, 681), (1000, 680), (790, 690), (390, 844), (390, 640),
        (390, 486), (390, 485), (390, 431), (390, 430), (390, 420), (320, 360)
    ]
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        for width, height in sizes:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            prepare(page)
            assert page.locator('#atlasSidebarResumeButton').count() == 0
            assert not page.locator('#atlasSidebarRecentEmpty').evaluate('(element) => element.hidden')
            page.evaluate('''() => {
              AtlasApp.showEntity('figure', ATLAS_CATALOG.figures[0]);
              AtlasApp.runSearch('diffusion', 'all');
              AtlasApp.showEntity('table', ATLAS_CATALOG.tables[0]);
            }''')
            open_menu(page)
            expected = ['Table 1.2', 'Search: diffusion', 'Figure 1.1']
            assert recent_labels(page) == expected
            state = layout_state(page)
            assert state['menuOverflow'] == 'hidden' and not state['menuScroll'], (width, height, state)
            assert not state['clippedButtons'] and state['footerFits'], (width, height, state)
            assert state['recentCount'] == 3 and not state['clippedRecents'], (width, height, state)
            assert state['footerVisible'] == (height > 680 and width >= 800), (width, height, state)
            assert all(category in state['destinations'] for category in
                       ('figures', 'tables', 'equations', 'problems', 'references'))
            if state['footerVisible']:
                for button in page.locator('#atlasSidebarRecentList button').all():
                    assert button.is_visible()

            if width == 1280:
                # Suggestions must leave the activity list unchanged until submitted.
                search = page.locator('#globalSearch')
                search.fill('charge transfer')
                assert recent_labels(page) == expected
                search.press('Control+Enter')
                expected = ['Search: charge transfer', 'Table 1.2', 'Search: diffusion']
                assert recent_labels(page) == expected
                assert 'Search: charge transfer' in page.locator('#atlasRecentHome').inner_text()
                search.fill('')
                first_suggestion = page.locator('#atlasCommandResults .atlas-command-result').first
                assert first_suggestion.locator('strong').inner_text() == 'charge transfer'
                first_suggestion.click()
                assert page.evaluate('window.__searches.at(-1)') == ['charge transfer', 'all']

                page.locator('#mainNav [data-view="tables"]').focus()
                page.keyboard.press('Shift+L')
                browse_position = page.locator('#atlasSidebarRecent').bounding_box()
                page.locator('#closeCatalogRail').click()
                back_position = page.locator('#atlasSidebarRecent').bounding_box()
                assert abs(back_position['y'] - browse_position['y']) < 1.1

                for theme in ('dark', 'light'):
                    page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
                    page.screenshot(path=screenshot_path(f'Atlas_Recent_Activity_{theme}.png'))

                saved = page.evaluate('Object.fromEntries(window.__stored)')
                assert 'PRIVATE' not in json.dumps(saved)
                restored = browser.new_page(viewport={'width': width, 'height': height})
                restored.on('pageerror', lambda error: errors.append(str(error)))
                prepare(restored, saved)
                assert recent_labels(restored) == expected
                restored.locator('#atlasSidebarRecentList button').nth(1).click()
                expected_key = restored.evaluate("AtlasApp.entityKey('table', ATLAS_CATALOG.tables[0])")
                assert restored.evaluate('window.__opened.at(-1)') == ['table', expected_key]
                assert recent_labels(restored)[0] == 'Table 1.2'
                restored.close()

            assert not errors, (width, height, errors)
            print(f'{width}×{height}: Menu fits; three recent items; footer visible={state["footerVisible"]}')
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
