#!/usr/bin/env python3
"""Exercise PDF page navigation without the obsolete page-opening popup.

Uses a synthetic iframe target and no textbook PDF or page assets.
"""
from playwright.sync_api import expect, sync_playwright
from _support import launch_chromium
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
READER_SCRIPT = (ROOT / 'app/reader.js').read_text(encoding='utf-8')
MARKUP = '''
<!doctype html><html><body>
  <label>PDF page <input id="readerPage" type="number"></label>
  <span id="readerPrinted"></span><span id="readerTargetBadge" hidden></span>
  <div id="bookViewport"><iframe id="importedPdfFrame" hidden></iframe>
  <div id="readerFallback" hidden>PDF display unavailable</div></div>
  <div id="readerMessage"></div>
  <input id="printedJump"><button id="printedGo">Go</button>
  <section id="outlinePanel" hidden><div id="outlineTree"></div></section>
  <button id="outlineToggle">Bookmarks</button><input id="outlineSearch">
  <button id="zoomIn">+</button><button id="zoomOut">-</button>
  <button id="zoomFit">Fit</button><output id="zoomReadout">Fit</output>
  <button id="highlightLinks">Links</button><button id="expandReader">Expand</button>
  <button id="closeReader">Close</button><button id="retryPage">Retry</button>
  <button id="copyPageText">Copy</button>
</body></html>
'''
INIT = '''window.ATLAS_READER_META={pageCount:4,labels:['i','ii','1','2'],outline:[]};
window.ATLAS_IMPORT_START_PAGE=1;
window.ATLAS_PDF_URL='data:text/html,<html>Test viewer</html>';
window.ATLAS_PAGES=[{pdf_page:1,text:'page one'}];
window.AtlasLayout={revealBook(){},setPreset(){},refresh(){},atlasView(){},isReadingOnly(){return false}};
window.AtlasNavigate=()=>{};
'''

with sync_playwright() as pw:
    browser = launch_chromium(pw)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(MARKUP)
    page.add_script_tag(content=INIT)
    page.add_script_tag(content=READER_SCRIPT)
    assert page.locator('#bookLoading').count() == 0

    for page_number in (1, 2, 3):
        page.evaluate('(p) => window.AtlasReader.show(p,0,false)', page_number)
        assert page.locator('#readerPage').input_value() == str(page_number)
        assert page.locator('#importedPdfFrame').get_attribute('src').endswith(
            f'#page={page_number}&zoom=100'
        )
        assert page.locator('#bookLoading').count() == 0
        assert not page.locator('#bookViewport').inner_text().startswith('Opening')

    # A source jump must replace the browsing context even when the original
    # URL is already the target and the user has since moved inside it.
    first_viewer = page.locator('#importedPdfFrame').element_handle()
    page.evaluate('window.AtlasReader.show(2,350,false,"snap")')
    destination = page.locator('#importedPdfFrame').get_attribute('src')
    assert destination.endswith('#page=2&zoom=100,0,316')
    assert not first_viewer.evaluate('(frame) => frame.isConnected')
    anchored_viewer = page.locator('#importedPdfFrame').element_handle()
    viewer_text = page.frame_locator('#importedPdfFrame').get_by_text('Test viewer', exact=True)
    viewer_text.evaluate('(body) => body.dataset.nativePosition = "page 4"')
    page.evaluate('window.AtlasReader.show(2,350,false,"snap")')
    assert not anchored_viewer.evaluate('(frame) => frame.isConnected')
    assert viewer_text.get_attribute('data-native-position') is None
    assert page.locator('#importedPdfFrame').get_attribute('src') == destination
    repeated_viewer = page.locator('#importedPdfFrame').element_handle()

    # The fallback is retained and Retry reopens the same anchored target.
    page.evaluate('document.getElementById("importedPdfFrame").onerror(new Event("error"))')
    assert page.locator('#readerFallback').is_visible()
    page.locator('#retryPage').click()
    assert page.locator('#readerFallback').is_hidden()
    assert not repeated_viewer.evaluate('(frame) => frame.isConnected')
    assert page.locator('#importedPdfFrame').get_attribute('src') == destination
    assert not errors, errors

    # Exercise the Firefox branch with a synthetic viewer that records hash
    # changes. The iframe document and its state must survive both jumps.
    firefox = browser.new_page(user_agent='Mozilla/5.0 Firefox/159.0')
    firefox.set_content(MARKUP)
    firefox.add_script_tag(content=INIT)
    firefox.evaluate('''() => {
      const html = `<!doctype html><body>Test viewer<script>
        function recordHash() { document.body.dataset.destination = location.hash; }
        addEventListener('hashchange', recordHash);
        recordHash();
      </script>`;
      window.ATLAS_PDF_URL = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    }''')
    firefox.add_script_tag(content=READER_SCRIPT)
    firefox.evaluate('window.AtlasReader.show(4,0,false)')
    firefox_frame = firefox.locator('#importedPdfFrame')
    viewer_body = firefox.frame_locator('#importedPdfFrame').locator('body')
    expect(viewer_body).to_have_attribute('data-destination', '#page=4&zoom=100')
    firefox_viewer = firefox_frame.element_handle()
    viewer_body.evaluate('(body) => body.dataset.nativeState = "retained"')
    initial_history = viewer_body.evaluate('() => history.length')
    for jump in (1, 2):
        firefox.evaluate('window.AtlasReader.show(2,350,false,"snap")')
        expect(viewer_body).to_have_attribute(
            'data-destination', f'#page=2&zoom=100,0,465&atlasJump={jump}'
        )
        expect(viewer_body).to_have_attribute('data-native-state', 'retained')
        assert firefox_viewer.evaluate('(frame) => frame.isConnected')
        assert viewer_body.evaluate('() => history.length') == initial_history

    browser.close()
    print('Synthetic PDF navigation: fast Firefox jumps, anchored Retry, and no transient toast.')
