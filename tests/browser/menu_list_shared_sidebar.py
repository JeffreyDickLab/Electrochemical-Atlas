#!/usr/bin/env python3
"""Verify Menu and the optional Browse list share one sidebar and drag handle.

No textbook, PDF import, or network required. Uses application HTML/CSS, the
real layout, navigation and catalog-rail controllers, and a minimal in-memory
catalog to isolate this behavior.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
from _support import launch_chromium

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT/'app/index.html').read_text()
CSS = (ROOT/'app/atlas.css').read_text()
HTML = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', HTML)
HTML, stylesheet_replacements = re.subn(
    r'<link\s+rel="stylesheet"\s+href="atlas\.css"\s*/?\s*>',
    lambda match: '<style>'+CSS+'</style>', HTML
)
assert stylesheet_replacements == 1, f'Expected one Atlas stylesheet, found {stylesheet_replacements}'

STUBS = '''
window.AtlasCalcEngine={specs:[]};
window.AtlasScience={html:s=>String(s)};
window.ATLAS_CATALOG={
  figures:[{label:'1.1',caption:'Example figure'}],
  tables:[{label:'1.1',caption:'Example table'}],
  equations:[{label:'1.1.1',context:'Example formula'}],
  problems:[{label:'1.1',description:'Example problem'}],
  references:[{chapter:1,number:1,text:'Example paper'}],
  sections:[],meta:{pdf_pages:50}
};
window.AtlasApp={state:{readerPage:3},user:{bookmarks:{pages:[],entities:[]}},
  sectionById:new Map(),resolveEntityBookmark:()=>null,searchAll:()=>[],
  goView:()=>{},showEntity:()=>{},openPdf:()=>{},runSearch:()=>{}};
document.querySelector('#pdfImport').style.display='none';
'''


def snapshot(page):
    return page.evaluate('''() => {
      const byId=id=>document.getElementById(id).getBoundingClientRect();
      const side=byId('sidebar'), divider=byId('navDivider'), atlas=byId('atlasArea');
      const list=document.getElementById('catalogRail');
      const nav=document.getElementById('mainNav');
      const active=getComputedStyle(list).display!=='none';
      const visible=getComputedStyle(nav).display!=='none';
      return {sideX:side.x, sideW:side.width,sideEnd:side.right,
        dividerX:divider.x,dividerW:divider.width,dividerEnd:divider.right,
        atlasX:atlas.x,atlasW:atlas.width,
        listW:list.getBoundingClientRect().width,
        navW:nav.getBoundingClientRect().width,
        active, visible,
        menuPress:document.getElementById('atlasMenuButton').getAttribute('aria-pressed'),
        bodyClass:document.body.className,
        sidebarStyle:getComputedStyle(document.getElementById('sidebar')).display,
      };
    }''')


def same_geometry(a,b):
    for k in ['sideX','sideW','dividerX','dividerW','atlasX','atlasW']:
        assert abs(a[k]-b[k])<1.01,(k,a,b)
    assert min(abs(a['dividerW']-10),abs(a['dividerW']))<1, a


def main():
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        for width in (1440, 1000, 790, 390):
            page=browser.new_page(viewport={'width':width,'height':850})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(HTML)
            page.add_script_tag(content=STUBS)
            page.add_script_tag(content=(ROOT/'app/layout-controller.js').read_text())
            page.add_script_tag(content=(ROOT/'app/navigation.js').read_text())
            page.add_script_tag(content=(ROOT/'app/catalog-rail.js').read_text())
            page.add_script_tag(content=(ROOT/'app/toolbar.js').read_text())
            page.locator('#atlasMenuButton').wait_for()
            # The first mobile layout defaults to a closed menu.
            if page.locator('body').evaluate("b=>b.classList.contains('layout-no-nav')"):
                page.locator('#atlasMenuButton').click()
            base=snapshot(page)
            assert base['visible'] and not base['active'],(width,base)
            page.keyboard.press('Shift+L')
            on=snapshot(page)
            same_geometry(base,on)
            assert on['active'] and not on['visible'],(width,on)
            assert on['menuPress']=='true',(width,on)
            # Returning to Menu must switch contents without moving the divider.
            page.locator('#atlasMenuButton').click()
            back=snapshot(page)
            same_geometry(base,back)
            assert back['visible'] and not back['active'],(width,back)
            assert back['menuPress']=='true',(width,back)
            if width>=800:
                # Resizing with the REAL native pointer divider must be shared.
                divider=page.locator('#navDivider').bounding_box()
                x=divider['x']+divider['width']/2
                y=divider['y']+divider['height']/2
                page.mouse.move(x,y)
                page.mouse.down()
                page.mouse.move(x+65,y,steps=5)
                page.mouse.up()
                afterDrag=snapshot(page)
                assert afterDrag['sideW']>base['sideW']+20,(width,afterDrag,base)
                page.keyboard.press('Shift+L')
                afterList=snapshot(page)
                same_geometry(afterDrag,afterList)
                page.locator('#atlasMenuButton').click()
                afterMenu=snapshot(page)
                same_geometry(afterDrag,afterMenu)
                # React to keyboard resizing and keep identical geometry.
                page.locator('#navDivider').focus()
                page.keyboard.press('ArrowRight')
                keyboard=snapshot(page)
                assert keyboard['sideW']>=afterDrag['sideW']+8,(width,keyboard,afterDrag)
                page.keyboard.press('Shift+L')
                same_geometry(keyboard,snapshot(page))
                category=page.locator('#catalogRailType').input_value()
                page.locator('#closeCatalogRail').click()
                assert page.evaluate('document.activeElement.dataset.view')==category
            assert not errors,(width,errors)
            print(f'{width}px: Menu/Browse share {base["sideW"]:.0f}px sidebar and {base["dividerW"]:.0f}px splitter; checks passed')
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
