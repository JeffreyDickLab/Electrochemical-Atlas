#!/usr/bin/env python3
"""Responsive browser check for real Symbols & Abbreviations tab renderer.

Uses the maintained renderSymbols/symbolCards source and real built CSS, with
synthetic definitions only; no textbook pages or extracted content are needed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
STYLE = (ROOT / 'app/atlas.css').read_text()
SCRIPT = (ROOT / 'src/client/application/40-catalog.js').read_text()
START = SCRIPT.index('  function renderSymbols() {')
END = SCRIPT.index('  function renderPaths(', START)
SYMBOLS_CODE = SCRIPT[START:END]
PREPARE = r'''
const $ = selector => document.querySelector(selector);
const $$ = (query, host=document) => [...host.querySelectorAll(query)];
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const sci = value => esc(value);
const norm = value => String(value ?? '').toLowerCase();
const debounce = fn => fn;
const paginationHTML = () => '';
const bindPagination = () => {};
const showEntity = (category, entry) => { window.__lastOpened = category; };
const C = {
 abbreviations: Array.from({length:156},(_,i)=>({abbr:`AB${i}`,meaning:'Abbreviation definition',sections:'1.1'})),
 symbols: Array.from({length:217},(_,i)=>({symbol:`γ${i}`,meaning:'Symbol definition',units:'M',sections:'1.1'})),
 chemicals: Array.from({length:124},(_,i)=>({abbr:`CO${i}`,meaning:'Chemical definition',structure_ref:''})),
};
const state = {symbolTab:'abbreviations',collectionFilter:'',collectionPage:0};
const content = $('#content');
'''


def state(page):
    return page.evaluate('''() => {
      const tabs = document.querySelector('.symbol-tabs');
      const r = tabs.getBoundingClientRect();
      return {
        count: tabs.querySelectorAll('button').length,
        overflow: getComputedStyle(tabs).overflowX,
        clientWidth: tabs.clientWidth, scrollWidth: tabs.scrollWidth,
        height: r.height, tabTop: r.top, tabBottom: r.bottom,
        buttons: [...tabs.querySelectorAll('button')].map(b => {
          const br=b.getBoundingClientRect();
          const label=b.querySelector('.symbol-tab-label');
          const lr=label.getBoundingClientRect();
          const cr=b.querySelector('.symbol-tab-count').getBoundingClientRect();
          return {text:label.textContent, x:br.x, y:br.y, width:br.width,
            height:br.height, right:br.right, bottom:br.bottom,
            labelRight:lr.right, labelBottom:lr.bottom, countBottom:cr.bottom,
            scrollWidth:b.scrollWidth, clientWidth:b.clientWidth,
            scrollHeight:b.scrollHeight, clientHeight:b.clientHeight,
            pressed:b.getAttribute('aria-pressed')};
        })
      };
    }''')


def main():
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        sizes = [(width, False) for width in (270, 300, 340, 390, 480, 580, 700, 960)]
        sizes.insert(0, (270, True))
        for width, wider_labels in sizes:
            for theme in ('dark', 'light'):
                page=browser.new_page(viewport={'width':max(width+40,400),'height':740})
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.set_content(f'''<!DOCTYPE html><html data-theme="{theme}"><head>
                <style>{STYLE}</style></head><body style="overflow:auto;padding:12px">
                <main id="content" class="content" style="width:{width}px;max-width:100%;height:650px;overflow:auto;">
                </main></body></html>''')
                if wider_labels:
                    # Exercise long words that exceed one tab with a wider fallback font.
                    page.add_style_tag(content='.symbol-tab-label { font-family: monospace; }')
                page.add_script_tag(content=PREPARE + '\n' + SYMBOLS_CODE + '\nrenderSymbols();')
                initial=state(page)
                assert initial['count']==3,(width,initial)
                assert initial['scrollWidth']<=initial['clientWidth']+1,(width,initial)
                assert initial['overflow']!='auto',(width,initial)
                assert [b['text'] for b in initial['buttons']]==[
                    'Abbreviations','Roman & Greek symbols','Chemical abbreviations'
                ]
                assert max(b['y'] for b in initial['buttons'])-min(b['y'] for b in initial['buttons'])<1,(width,initial)
                left=min(b['x'] for b in initial['buttons'])
                right=max(b['right'] for b in initial['buttons'])
                assert right-left<=initial['clientWidth']+2,(width,initial)
                for b in initial['buttons']:
                    assert b['scrollWidth']<=b['clientWidth']+1,(width,b)
                    assert b['scrollHeight']<=b['clientHeight']+1,(width,b)
                    assert b['labelRight']<=b['right']+1,(width,b)
                    assert b['labelBottom']<=b['bottom']+1,(width,b)
                    assert b['countBottom']<=b['bottom']+1,(width,b)
                for tab,label in [('symbols','Roman & Greek symbols'),('chemicals','Chemical abbreviations'),('abbreviations','Abbreviations')]:
                    page.locator(f'button[data-symbol-tab="{tab}"]').click()
                    status=state(page)
                    assert status['scrollWidth']<=status['clientWidth']+1,(width,tab,status)
                    assert page.locator('button[aria-pressed="true"]').inner_text().startswith(label)
                    assert page.locator('.symbol-cards > button.collection-card[data-symbol-entry]').count()>=1
                if width in (270, 390, 580, 960) and theme=='dark' and not wider_labels:
                    page.screenshot(path=screenshot_path(f'Atlas_Symbol_Tabs_{width}.png'))
                assert not errors,(width,theme,errors)
                font = 'monospace' if wider_labels else 'system font'
                print(f'{width}px / {theme} / {font}: three tabs in one grid row, '
                      'no horizontal scrolling, labels fully visible')
                page.close()
        browser.close()

if __name__=='__main__': main()
