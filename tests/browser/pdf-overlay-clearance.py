#!/usr/bin/env python3
"""Verify floating reader buttons stay below the native PDF control strip.

Uses synthetic PDF viewport chrome, not copied book pages.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
CSS = (ROOT / 'app/atlas.css').read_text()
CHROME = (ROOT / 'src/client/reader/chrome.js').read_text()
MOCK = '''
<div class="topbar" style="height:46px">Atlas navigation</div>
<div class="layout-toolbar" style="height:44px">Layout selector</div>
<div class="workspace" style="height:calc(100dvh - 90px);display:flex;min-height:0">
<aside class="reader" id="reader" style="display:flex; flex-direction:column; flex:1; min-width:0; min-height:0">
<div class="book-body" style="display:flex;flex:1;min-height:0">
  <div id="bookViewport" class="book-viewport" style="flex:1; min-height:0;position:relative; padding:0">
    <div id="nativeToolbar" style="height:56px;position:absolute;top:0;left:0;right:0;background:#222a24;color:white;display:flex;align-items:center;padding:12px">PDF's native controls (56px)</div>
    <div class="reader-hover-controls"><button id="floatingHideBar" type="button">Hide bar</button></div>
  </div>
</div>
</aside>
</div>
<button id="restoreTopBars" class="restore-top-bars" type="button" hidden>Show bar</button>
'''

with sync_playwright() as playwright:
    browser = launch_chromium(playwright)
    for width in [320, 390, 740, 1000, 1440]:
        page = browser.new_page(viewport={'width':width,'height':750})
        errors = []
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.set_content(f'<!doctype html><html><head><style>{CSS}</style></head><body>{MOCK}</body></html>')
        page.add_script_tag(content=CHROME)
        viewport = page.locator('#bookViewport').bounding_box()
        native = page.locator('#nativeToolbar').bounding_box()
        hide = page.locator('#floatingHideBar').bounding_box()
        assert hide['y'] >= native['y']+native['height']+10, (width,'hide over native controls',hide,native)
        assert hide['x'] + hide['width'] <= viewport['x'] + viewport['width']-34, (width, 'hide overlaps PDF scrollbar')
        page.locator('#floatingHideBar').click()
        assert page.locator('#restoreTopBars').is_visible()
        show = page.locator('#restoreTopBars').bounding_box()
        native_hidden = page.locator('#nativeToolbar').bounding_box()
        assert show['y'] >= native_hidden['y']+native_hidden['height']+10, (width,'show over native controls',show,native_hidden)
        assert show['x'] + show['width'] <= width-34, (width,'show overlaps PDF scrollbar')
        assert not errors, errors
        page.locator('#restoreTopBars').click()
        assert page.locator('#restoreTopBars').is_hidden()
        if width in (390,1000):
            page.screenshot(path=screenshot_path(f'Atlas_PDF_Button_Below_Controls_{width}px.png'))
        print(f'{width}px: Hide bar and Show bar clear 56px native PDF toolbar')
        page.close()
    browser.close()
