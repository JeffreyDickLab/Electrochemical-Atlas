#!/usr/bin/env python3
"""Test real maintained Symbols card renderer and floating bar controls in Chromium.

Synthetic example records only; no textbook content is bundled.
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
const showEntity = (category, entry) => { window.__lastOpened = {category, entry}; };
const C = {
  abbreviations: [
    {abbr:'1e, 2e, …ne', meaning:'n-electron',sections:'1.1'},
    {abbr:'1D, 2D, 3D', meaning:'one-dimensional, two-dimensional, three-dimensional',sections:'16.6.2, 21.8.2'},
    {abbr:'ADC',meaning:'analog-to-digital converter',sections:'16.6'},
    {abbr:'AFM',meaning:'atomic force microscopy (microscope)',sections:'21.1.2'},
  ],
  symbols: [
    {symbol:'α',meaning:'alpha, transfer coefficient',units:'dimensionless',sections:'3.5.1, 21.8.2'},
    {symbol:'Za',meaning:'Synthetic source notation',units:'',sections:'3.5.4, 11.4',
      symbol_runs:[{text:'Z',bold:true},{text:'a',script:'sub'}],
      definitions:[
        {label:'(a)',meaning:'First synthetic quantity',units:'cm2',sections:'3.5.4',
          units_runs:[{text:'cm'},{text:'2',script:'super'}]},
        {label:'(b)',meaning:'Second synthetic quantity with a longer explanation that should wrap within this card',
          units:'s−1',sections:'11.4',units_runs:[{text:'s'},{text:'−1',script:'super'}]}
      ]},
    {symbol:'γᵢ',meaning:'activity coefficient in a liquid solution',units:'dimensionless',sections:'2.1.34'},
  ],
  chemicals: [
    {abbr:'Ag/AgCl/KCl',meaning:'silver/silver chloride reference electrode',structure_ref:'Ag | AgCl | KCl (sat’d)'},
    {abbr:'[Fe(CN)₆]³⁻',meaning:'ferricyanide complex',structure_ref:'[Fe(CN)₆]³⁻'},
    {abbr:'CoA',meaning:'coenzyme A, carrier of acyl groups',structure_ref:'R–C(=O)–S–CoA'},
  ],
};
const state = {symbolTab:'abbreviations',collectionFilter:'',collectionPage:0};
const content = $('#content');
'''


def metrics(page):
    return page.evaluate('''() => {
      const list=document.querySelector('.symbol-cards');
      const first=list.querySelector('button.symbol-card');
      const fields=[...first.querySelectorAll('.result-top, .result-snippet, .symbol-card-detail')].map(el => {
        const b=el.getBoundingClientRect();
        return {text:el.textContent, left:b.left, right:b.right, top:b.top, bottom:b.bottom, width:b.width,
          clientWidth:el.clientWidth, scrollWidth:el.scrollWidth};
      });
      return {
        pageWidth:document.documentElement.scrollWidth,
        listWidth:list.clientWidth, listScroll:list.scrollWidth,
        listRect:list.getBoundingClientRect().toJSON(),
        cardRect:first.getBoundingClientRect().toJSON(),
        cardType:first.type,
        nestedControls:first.querySelectorAll('button, a, input, select, textarea, [tabindex]').length,
        fieldLabels:[...first.querySelectorAll('.symbol-card-field-label')].map(el => el.textContent),
        fields,
      };
    }''')


def check_cards(browser):
    for width in [220, 250, 280, 320, 360, 390, 450, 510, 580, 630, 650, 680, 820, 960]:
        for theme in ('dark','light'):
            page=browser.new_page(viewport={'width':max(width + 50, 360),'height':760})
            errors=[]
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content(f'''<!doctype html><html data-theme="{theme}"><head><style>{STYLE}</style></head>
                <body style="overflow:auto; padding:0"><div style="max-width:100%; margin:12px;">
                <main id="content" class="content" style="box-sizing:border-box;padding:0;width:{width}px;max-width:100%;min-width:0;">
                </main></div></body></html>''')
            page.add_script_tag(content=(ROOT/'src/client/science/notation.js').read_text())
            page.add_script_tag(content=PREPARE+'\n'+SYMBOLS_CODE+'\nrenderSymbols();')
            for kind,category in [('abbreviations','abbreviation'),('symbols','symbol'),('chemicals','chemical')]:
                page.locator(f'[data-symbol-tab="{kind}"]').click()
                m=metrics(page)
                assert m['cardType']=='button',(width,theme,kind,m)
                assert m['nestedControls']==0,(width,theme,kind,m)
                assert m['listScroll']<=m['listWidth']+2,(width,theme,kind,m)
                assert m['cardRect']['width']<=m['listWidth']+2,(width,theme,kind,m)
                assert m['pageWidth']<=page.viewport_size['width']+2,(width,theme,kind,m)
                for field in m['fields']:
                    assert field['right']<=m['cardRect']['right']+2,(width,theme,kind,field,m)
                    assert field['left']>=m['cardRect']['left']-2,(width,theme,kind,field,m)
                    assert field['scrollWidth']<=field['clientWidth']+2,(width,theme,kind,field,m)
                expected_fields={'abbreviations':['Sections:'], 'symbols':['Usual units:', 'Sections:'], 'chemicals':['Structure / equation:']}
                assert m['fieldLabels']==expected_fields[kind],(width,theme,kind,m)
                if kind=='symbols':
                    rich=page.locator('.symbol-card[data-symbol-entry="1"]')
                    assert rich.locator('.notation-definition').count()==2
                    assert rich.locator('.notation-bold').inner_text()=='Z'
                    assert rich.locator('.symbol-card-detail sup').all_text_contents()==['2','−1']
                    assert rich.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')

                # Definitions, metadata, and empty card padding all activate the
                # same native button; Enter and Space use its browser behavior.
                card=page.locator('.symbol-cards > button.symbol-card').first
                expected_meaning=card.locator('.result-snippet').inner_text()
                for target in (card.locator('.result-snippet'), card.locator('.symbol-card-detail').first):
                    page.evaluate('window.__lastOpened=null')
                    target.click()
                    assert page.evaluate('window.__lastOpened.category')==category
                    assert page.evaluate('window.__lastOpened.entry.meaning')==expected_meaning
                page.evaluate('window.__lastOpened=null')
                card.click(position={'x':12,'y':12})
                assert page.evaluate('window.__lastOpened.category')==category
                for key in ('Enter','Space'):
                    page.evaluate('window.__lastOpened=null')
                    card.focus()
                    page.keyboard.press(key)
                    assert page.evaluate('window.__lastOpened.category')==category
                    assert page.evaluate('window.__lastOpened.entry.meaning')==expected_meaning
                if kind=='abbreviations' and theme=='dark' and width in (280,390,580,820):
                    page.screenshot(path=screenshot_path(f'Atlas_Symbols_Cards_{width}.png'))
                if kind=='symbols' and theme=='dark' and width == 390:
                    page.screenshot(path=screenshot_path('Atlas_Symbols_Greek_Narrow.png'))
                if kind=='chemicals' and theme=='dark' and width == 390:
                    page.screenshot(path=screenshot_path('Atlas_Symbols_Chemicals_Narrow.png'))
                assert not errors,(width,theme,kind,errors)
            page.close()
        print(f'{width}px: all three symbol card categories fit and activate in both themes')


def check_bar(browser):
    html = (ROOT/'src/client/index.html').read_text()
    chrome = (ROOT/'src/client/reader/chrome.js').read_text()
    bar = '''
    <div class="topbar" style="height:45px">Main toolbar</div>
    <div class="layout-toolbar" style="height:45px">Layout</div>
    <div class="workspace" style="height:calc(100dvh - 90px)">
       <aside class="reader" style="display:flex;flex-direction:column;position:relative;height:100%;width:100%">
          <div class="book-body" style="height:100%;display:flex">
             <div class="book-viewport" style="position:relative;min-width:0;flex:1">
                <div class="reader-hover-controls"><button id="floatingHideBar" type="button" aria-pressed="false" aria-keyshortcuts="Shift+H">Hide bar</button></div>
             </div>
          </div>
       </aside>
    </div>
    <button id="restoreTopBars" class="restore-top-bars" type="button" hidden>Show bar</button>
    '''
    for width in (320, 390, 740, 1200):
        page=browser.new_page(viewport={'width':width,'height':700})
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.set_content(f'<!doctype html><html><head><style>{STYLE}</style></head><body>{bar}</body></html>')
        page.add_script_tag(content=chrome)
        assert page.locator('#floatingHideBar').inner_text()=='Hide bar'
        assert page.locator('#restoreTopBars').inner_text()=='Show bar'
        before=page.locator('#floatingHideBar').evaluate('(el)=>getComputedStyle(el).fontSize')
        assert float(before.replace('px',''))<12,(width,before)
        page.locator('#floatingHideBar').click()
        assert page.locator('body').evaluate('(el)=>el.classList.contains("atlas-top-bars-hidden")')
        assert page.locator('#restoreTopBars').is_visible()
        page.locator('#restoreTopBars').click()
        assert not page.locator('body').evaluate('(el)=>el.classList.contains("atlas-top-bars-hidden")')
        assert page.locator('#restoreTopBars').is_hidden()
        page.keyboard.press('Shift+h')
        assert page.locator('#restoreTopBars').is_visible()
        page.keyboard.press('Shift+h')
        assert page.locator('#restoreTopBars').is_hidden()
        assert not errors,(width,errors)
        page.close()
        print(f'{width}px: Hide bar and Show bar function, Shift+H works')


def main():
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        check_cards(browser)
        check_bar(browser)
        browser.close()

if __name__=='__main__':
    main()
