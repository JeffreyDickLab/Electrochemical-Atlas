#!/usr/bin/env python3
"""Optional end-to-end regression with a user-supplied PDF.

Requires: pip install playwright && playwright install chromium
Run: ATLAS_TEST_PDF=/path/to/original.pdf python tests/browser/smoke.py
The PDF is never included with, or copied into, the application distribution.
"""
import functools
import os
import pathlib
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

PROJECT = pathlib.Path(__file__).resolve().parents[2]
PDF = os.environ.get('ATLAS_TEST_PDF')
if not PDF or not pathlib.Path(PDF).is_file():
    raise SystemExit('Set ATLAS_TEST_PDF to the original textbook PDF for this test.')

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(PROJECT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_address[1]}/app/index.html'

try:
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        page = browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.goto(url, wait_until='domcontentloaded')
        page.locator('#sourcePdfFile').set_input_files(PDF)
        page.wait_for_function('Boolean(window.AtlasApp && window.ATLAS_CATALOG)', timeout=120000)
        assert page.locator('#pdfImport').count() == 0
        stats = page.evaluate('''() => ({ pages:window.ATLAS_CATALOG.meta.pdf_pages,
              equations:window.ATLAS_CATALOG.equations.length,
              matched:window.ATLAS_SOURCE_SHA256===window.AtlasEquationManifest.pdf_sha256,
              layout: Boolean(window.AtlasLayout),
              entries: window.ATLAS_CATALOG.sections.length})''')
        print('Imported original PDF:',stats)
        assert stats['pages'] == 1107 and stats['equations'] == 2004 and stats['matched'] and stats['layout']
        page.evaluate("window.AtlasApp.goView('equations')")
        page.wait_for_timeout(1000)
        page.wait_for_selector('.equation-catalog-preview canvas.atlas-source-equation',timeout=30000)
        assert page.locator('.equation-catalog-preview canvas').count() >= 1
        page.evaluate("window.AtlasApp.showEntity('equation', window.ATLAS_CATALOG.equations.find(e=>e.label==='1.5.1'))")
        page.wait_for_selector('#equationVisual canvas.atlas-source-equation',timeout=30000)
        assert page.locator('#equationVisual canvas.atlas-source-equation').count() == 1
        assert page.locator('text="Show automatically extracted text"').count() == 0
        page.evaluate("window.AtlasApp.goView('home')")
        assert page.locator('#content h1').count() > 0
        # Navigation controllers retain their own state; use buttons when present.
        page.screenshot(path=screenshot_path('smoke_desktop.png'), full_page=False)
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_timeout(350)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        page.screenshot(path=screenshot_path('smoke_mobile.png'), full_page=False)
        assert not errors, errors
        browser.close()
        print('Browser regression passed: home, equation library, detail, 390 px view; no JS errors.')
finally:
    server.shutdown()
    server.server_close()
