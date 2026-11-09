#!/usr/bin/env python3
"""Exercise toolbar view modes, catalog navigation, and the Shift+L sidebar list.

Uses synthetic entries with the maintained routes, catalog renderer, menu event
binding, and layout controllers. No textbook or PDF engine is required.
"""
from pathlib import Path
import re
from playwright.sync_api import expect, sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / 'app/index.html').read_text()
CSS = (ROOT / 'app/atlas.css').read_text()
HTML = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', HTML)
HTML, stylesheet_replacements = re.subn(
    r'<link\s+rel="stylesheet"\s+href="atlas\.css"\s*/?\s*>',
    lambda match: '<style>'+CSS+'</style>', HTML
)
assert stylesheet_replacements == 1, f'Expected one Atlas stylesheet, found {stylesheet_replacements}'

# These fragments are consecutive functions in the application closure. Load
# their maintained implementations, rather than reproducing catalog routing.
STATE_SOURCE = (ROOT / 'src/client/application/10-state-and-layout.js').read_text()
ROUTES = STATE_SOURCE[
    STATE_SOURCE.index('  function signalLocation('):
    STATE_SOURCE.index('  function openPdf(')
]
DISCOVERY = (ROOT / 'src/client/application/30-discovery.js').read_text()
EVENTS = (ROOT / 'src/client/application/80-events.js').read_text()
MENU_BINDING = EVENTS[
    EVENTS.index("    $('#mainNav').addEventListener("):
    EVENTS.index("    $('#homeButton').addEventListener(")
]

STUBS = '''
window.AtlasCalcEngine={specs:[]};
window.AtlasScience={html:s=>String(s)};
const entries=Array.from({length:230},(_,i)=>({label:`${i+1}.1`,
 title:`Catalog sample ${i+1}`,pdf_page:i%2 ? 3 : 5,
 caption:`Synthetic figure or table ${i+1}`,
 description:`Catalog sample ${i+1} with a long description intended to test wrapping and vertical scrolling.`}));
window.ATLAS_CATALOG={
 figures:entries,tables:entries,equations:entries.map(e=>({...e,context:e.description})),
 problems:entries.map(e=>({...e,text:e.description})),
 references:entries.map((e,i)=>({chapter:1,number:i+1,text:e.description,pdf_page:3})),
 sections:[
  {key:'chapter-1',id:'1',kind:'chapter',title:'Chapter 1 Synthetic foundations',pdf_page:2,pdf_page_end:3},
  {key:'chapter-2',id:'2',kind:'chapter',title:'Chapter 2 A deliberately long synthetic title for narrow chapter-filter layouts',pdf_page:4,pdf_page_end:6}
 ],meta:{pdf_pages:50}
};
// A legacy open flag must not replace the new direct Menu on startup. The
// selected optional-list category is still a supported preference.
window.__savedStorage=new Map([['ea_list_enabled','true'],['ea_list_type','equations']]);
window.__storageWrites=[];
Object.defineProperty(window,'localStorage',{configurable:true,value:{
 getItem:key=>window.__savedStorage.get(key)??null,
 setItem:(key,value)=>{
   window.__storageWrites.push(key);
   window.__savedStorage.set(key,String(value));
 }
}});
window.AtlasApp={state:{readerPage:3,view:'home',collectionFilter:'',collectionPage:0,collectionChapter:''},
 user:{bookmarks:{pages:[],entities:[]}},
 sectionById:new Map(),resolveEntityBookmark:()=>null,searchAll:()=>[],
 showEntity:()=>{},openPdf:()=>{},runSearch:()=>{}};
window.AtlasEquationPreview={mount:async holder=>{holder.textContent='Synthetic equation';}};
window.AtlasFigurePreview={mount:holder=>{holder.textContent='Synthetic figure';}};
document.querySelector('#pdfImport').style.display='none';
'''

ROUTING_FIXTURE = r'''
(() => {
 const $=selector=>document.querySelector(selector);
 const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
 const C=window.ATLAS_CATALOG;
 const state=window.AtlasApp.state;
 const content=$('#content');
 const searchInput=$('#globalSearch');
 const esc=value=>String(value??'').replace(/[&<>"']/g,
   character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
 const sci=esc;
 const norm=value=>String(value??'').toLowerCase();
 const shorten=(value,limit)=>String(value??'').slice(0,limit);
 const debounce=callback=>callback;
 const pageLabel=page=>`PDF ${page}`;
 const showEntity=(...args)=>window.AtlasApp.showEntity(...args);
''' + ROUTES + DISCOVERY + MENU_BINDING + '''
 window.AtlasApp.goView=goView;
})();
'''


def snapshot(page):
    return page.evaluate('''() => {
      const get=id=>document.getElementById(id);
      const bounds=id=>get(id).getBoundingClientRect();
      const side=bounds('sidebar'), divider=bounds('navDivider'), main=bounds('atlasArea');
      const list=get('catalogRailList');
      return {
        sideW:side.width,sideX:side.x,dividerW:divider.width,dividerX:divider.x,
        mainX:main.x, listShown:getComputedStyle(get('catalogRail')).display!=='none',
        navShown:getComputedStyle(get('mainNav')).display!=='none',
        listOverflowX:getComputedStyle(list).overflowX,
        listOverflowY:getComputedStyle(list).overflowY,
        listScroll: list.scrollTop, listWidth:list.clientWidth, listContentWidth:list.scrollWidth,
        menuVisible:getComputedStyle(get('atlasMenuButton')).display!=='none',
        topListButton:!!get('toggleCatalogRail')
      };
    }''')


def same(a,b):
    for key in ('sideW','sideX','dividerW','dividerX','mainX'):
        assert abs(a[key]-b[key])<=1.1,(key,a,b)


def open_menu(page):
    if page.evaluate("document.body.classList.contains('layout-no-nav')"):
        page.locator('#atlasMenuButton').click()


def assert_catalog(page, category):
    assert page.evaluate('window.AtlasApp.state.view')==category
    assert page.locator('#content').is_visible()
    assert page.locator('#content h1').inner_text()==category.title()
    assert page.locator(f'#content [data-collection="{category}"]').count()>0
    assert page.locator(f'#mainNav [data-view="{category}"]').get_attribute('aria-current')=='page'


def assert_toolbar_modes(page, width):
    menu = page.locator('#atlasMenuButton')
    sidebar = page.locator('#sidebar')
    compact = page.locator('#atlasCompactMode')
    atlas = page.locator('#atlasArea')
    reader = page.locator('#reader')

    def button(mode):
        return page.locator(f'[data-atlas-mode="{mode}"]')

    def choose(mode):
        if compact.is_visible():
            compact.select_option(mode)
        else:
            button(mode).click()

    def assert_mode(mode, menu_open):
        expect(button(mode)).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('[data-atlas-mode][aria-pressed="true"]')).to_have_count(1)
        expect(compact).to_have_value(mode)
        expect(menu).to_have_attribute('aria-expanded', str(menu_open).lower())
        expect(sidebar).to_be_visible(visible=menu_open)
        expect(atlas).to_be_visible(visible=mode != 'read')
        expect(reader).to_be_visible(visible=mode != 'explore')

    if width >= 800:
        open_menu(page)
        for mode in ('explore', 'together', 'read'):
            choose(mode)
            assert_mode(mode, menu_open=True)
        menu.click()
        assert_mode('read', menu_open=False)
        for mode in ('explore', 'together', 'read'):
            choose(mode)
            assert_mode(mode, menu_open=False)
        menu.click()
        assert_mode('read', menu_open=True)
        page.locator('#mainNav [data-view="figures"]').click()
        assert_catalog(page, 'figures')
        assert_mode('together', menu_open=True)
    else:
        expect(compact.locator('option[value="together"]')).to_be_disabled()
        choose('read')
        assert_mode('read', menu_open=False)
        menu.click()
        assert_mode('read', menu_open=True)
        page.locator('#mainNav [data-view="figures"]').click()
        assert_catalog(page, 'figures')
        assert_mode('explore', menu_open=False)
    choose('explore')


def assert_pdf_click_away(page):
    page.evaluate("window.AtlasLayout.setPreset('study')")
    iframe = page.locator('#importedPdfFrame')
    # A separate browsing context reproduces the native PDF's event boundary.
    iframe.evaluate('''frame => {
      frame.srcdoc = `<body data-presses="0" style="margin:0; min-height:100vh">
        <script>document.addEventListener('pointerdown', () => document.body.dataset.presses++);</script>
      </body>`;
      frame.hidden = false;
    }''')
    child = page.frame_locator('#importedPdfFrame').locator('body')
    expect(child).to_have_attribute('data-presses', '0')

    search = page.locator('#globalSearch')
    palette = page.locator('#atlasCommandPalette')
    search.click()
    palette.get_by_role('button', name='Figures', exact=True).click()
    expect(palette).to_be_visible()
    expect(search).to_have_attribute('aria-expanded', 'true')

    frame_bounds = iframe.bounding_box()
    palette_bounds = palette.bounding_box()
    assert frame_bounds is not None and palette_bounds is not None
    x = frame_bounds['x'] + frame_bounds['width'] / 2
    y = frame_bounds['y'] + frame_bounds['height'] - 20
    # Click an exposed part of the reader beneath the dropdown.
    assert y > palette_bounds['y'] + palette_bounds['height']
    page.mouse.click(x, y)
    expect(palette).to_be_hidden()
    expect(search).to_have_attribute('aria-expanded', 'false')
    expect(child).to_have_attribute('data-presses', '0')

    page.mouse.click(x, y)
    expect(child).to_have_attribute('data-presses', '1')


def main():
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        for width, height in ((1440,900),(1000,740),(790,680),(390,650),(320,480)):
            ctx=browser.new_context(viewport={'width':width,'height':height})
            page=ctx.new_page()
            errors=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            page.set_content(HTML)
            page.add_script_tag(content=STUBS)
            page.add_script_tag(content=ROUTING_FIXTURE)
            for name in ('layout-controller.js','navigation.js','catalog-rail.js','toolbar.js'):
                page.add_script_tag(content=(ROOT/'app'/name).read_text())
            page.locator('#atlasMenuButton').wait_for()
            assert page.locator('#toggleCatalogRail').count()==0
            assert_toolbar_modes(page, width)
            open_menu(page)
            menu=snapshot(page)
            assert menu['navShown'] and not menu['listShown'],(width,menu)
            assert menu['menuVisible'] and not menu['topListButton']
            # The persisted legacy flag is ignored; Shift+L remains optional.
            page.keyboard.press('Shift+L')
            browse=snapshot(page)
            assert browse['listShown'] and not browse['navShown'],(width,browse)
            same(menu,browse)
            assert page.locator('#catalogRailType').input_value()=='equations'
            page.locator('#closeCatalogRail').click()
            assert page.evaluate('document.activeElement.dataset.view')=='equations'

            # All five primary destinations open the existing second-column
            # catalog, without replacing the Menu with the compact list.
            for category in ('figures','tables','equations','problems','references'):
                open_menu(page)
                page.locator(f'#mainNav [data-view="{category}"]').click()
                assert_catalog(page,category)
                assert not page.locator('#catalogRail').is_visible()
                assert page.evaluate("document.body.classList.contains('layout-no-nav')")== (width<800)

            # Chapter filtering uses the source outline's page intervals, even
            # when a label has an unrelated numeric prefix. Controls wrap within
            # the available catalog pane instead of forcing horizontal scroll.
            open_menu(page)
            page.locator('#mainNav [data-view="figures"]').click()
            page.locator('#collectionChapter').select_option('chapter-2')
            assert page.locator('#content .toolbar .badge').inner_text()=='115 results'
            page.locator('#collectionFilter').fill('229.1')
            assert page.locator('#content [data-collection="figures"]').count()==1
            assert page.locator('#content [data-collection="figures"]').get_attribute('data-index')=='228'
            assert page.locator('.collection-toolbar').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
            page.locator('#collectionFilter').fill('')
            page.locator('#collectionChapter').select_option('')
            assert page.locator('#content .toolbar .badge').inner_text()=='230 results'

            # A catalog destination also exits PDF-only Read mode through the
            # real atlasView hook, retaining the PDF beside Atlas on desktop.
            page.evaluate("window.AtlasLayout.setPreset('read')")
            assert not page.locator('#content').is_visible()
            open_menu(page)
            page.locator('#mainNav [data-view="problems"]').click()
            assert_catalog(page,'problems')
            assert page.locator('#reader').is_visible()==(width>=800)
            page.evaluate("window.AtlasLayout.setPreset('browse')")
            open_menu(page)
            menu=snapshot(page)
            page.keyboard.press('Shift+L')
            browse=snapshot(page)
            same(menu,browse)
            assert page.locator('#catalogRailType').input_value()=='problems'
            assert browse['listContentWidth'] <= browse['listWidth']+1,(width,browse)
            assert browse['listOverflowX']=='hidden' and browse['listOverflowY']=='auto'
            assert page.locator('#catalogRailList .catalog-rail-entry').count() > 0
            page.locator('#catalogRailType').select_option('equations')
            page.locator('#catalogRailFilter').fill('2.1')
            assert page.locator('#catalogRailList .catalog-rail-entry').count()==1
            page.locator('#catalogRailFilter').fill('')
            page.locator('#catalogRailList').focus()
            page.keyboard.press('PageDown')
            page.wait_for_timeout(120)
            assert snapshot(page)['listScroll']>0
            page.locator('#catalogRailOpenIndex').click()
            assert_catalog(page,'equations')
            if width<800:
                assert page.evaluate("document.body.classList.contains('layout-no-nav')")
                # Restore Menu first for subsequent checks.
                page.locator('#atlasMenuButton').click()
                assert snapshot(page)['navShown']
                # Open Browse again using Shift+L (keyboard path).
                page.keyboard.press('Shift+L')
                assert snapshot(page)['listShown']
            # Escape goes to Menu without shifting the sidebar on desktop.
            page.keyboard.press('Escape')
            back=snapshot(page)
            assert back['navShown'] and not back['listShown'],(width,back)
            if width>=800:
                same(menu,back)
                # Pointer drag persists for the whole shared sidebar, both levels.
                bounds=page.locator('#navDivider').bounding_box()
                page.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2)
                page.mouse.down()
                page.mouse.move(bounds['x']+bounds['width']/2+52,bounds['y']+bounds['height']/2,steps=4)
                page.mouse.up()
                grown=snapshot(page)
                assert grown['sideW']>menu['sideW']+20,(width,grown,menu)
                page.keyboard.press('Shift+L')
                same(grown,snapshot(page))
                page.locator('#closeCatalogRail').click()
                assert page.evaluate('document.activeElement.dataset.view')=='equations'
                same(grown,snapshot(page))
            if width == 1440:
                assert_pdf_click_away(page)
            assert not errors,(width,errors)
            if width in (1000,390):
                page.keyboard.press('Shift+L')
                page.locator('#catalogRailType').select_option('equations')
                page.locator('#catalogRailFilter').fill('')
                page.screenshot(path=screenshot_path(f'Atlas_Navigator_Browse_{width}.png'))
                page.locator('#closeCatalogRail').click()
                page.screenshot(path=screenshot_path(f'Atlas_Navigator_Menu_{width}.png'))
            assert page.evaluate("window.__savedStorage.get('ea_list_type')")=='equations'
            assert 'ea_list_enabled' not in page.evaluate('window.__storageWrites')
            print(f'{width}×{height}: toolbar modes, direct catalogs, Shift+L, filtering, focus and shared geometry OK')
            ctx.close()
        browser.close()

if __name__ == '__main__':
    main()
