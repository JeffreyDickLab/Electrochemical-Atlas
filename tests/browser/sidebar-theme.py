#!/usr/bin/env python3
"""Check Menu/Browse typography and matching Browse, search, and content scrollbars.

Uses synthetic catalog items and the real app shell and controls, without
importing or bundling any textbook pages, text, or formula graphics.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
html = (ROOT / 'app/index.html').read_text()
css = (ROOT / 'app/atlas.css').read_text()
html = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', html)
html, stylesheet_replacements = re.subn(
    r'<link\s+rel="stylesheet"\s+href="atlas\.css"\s*/?\s*>',
    lambda match: '<style>'+css+'</style>', html
)
assert stylesheet_replacements == 1, f'Expected one Atlas stylesheet, found {stylesheet_replacements}'
STUBS = '''
window.AtlasCalcEngine={specs:[]};
window.AtlasScience={html:s=>String(s)};
const entries=Array.from({length:160},(_,i)=>({label:`${i+1}.1`,
 description:`Reference entry ${i+1} with a long scientific description, γ, μ, and redox species to check wrapping and overflow.`}));
window.ATLAS_CATALOG={
 figures:entries, tables:entries, equations:entries.map(e=>({...e,context:e.description})),
 problems:entries, references:entries.map((e,i)=>({chapter:1,number:i+1,text:e.description})),
 sections:[],meta:{pdf_pages:50}
};
window.AtlasApp={state:{readerPage:3,resumePage:3},user:{bookmarks:{pages:[],entities:[]}},
 sectionById:new Map(),resolveEntityBookmark:()=>null,searchAll:()=>[],
 goView:()=>{},showEntity:()=>{},openPdf:()=>{},runSearch:()=>{}};
document.querySelector('#pdfImport').style.display='none';
// Populate the actual content scroll container with synthetic catalog rows.
document.querySelector('#content').innerHTML=
 '<header class="view-header"><h1>Figures</h1></header><div class="result-list">'+
 entries.map(e=>`<button class="collection-card"><strong>${e.label}</strong><p>${e.description}</p></button>`).join('')+
 '</div>';
'''


def get_view(page):
    return page.evaluate('''() => {
      const get=id=>document.getElementById(id);
      const nav=get('mainNav');const rail=get('catalogRail');const list=get('catalogRailList');
      const menutext=nav.querySelector('button[data-view="book"] .atlas-sidebar-text');
      const number=list.querySelector('.catalog-entry-number');
      const navstyle=getComputedStyle(menutext);
      const numberstyle=number?getComputedStyle(number):navstyle;
      const liststyle=getComputedStyle(list);
      const inputstyle=getComputedStyle(get('catalogRailFilter'));
      const selectstyle=getComputedStyle(get('catalogRailType'));
      const side=get('sidebar').getBoundingClientRect();
      const divider=get('navDivider').getBoundingClientRect();
      const content=get('content');
      const results=get('atlasCommandResults');
      const scopes=get('atlasCommandPalette').querySelector('.atlas-command-scopes');
      const scopeBounds=scopes.getBoundingClientRect();
      const scopesFit=[...scopes.querySelectorAll('button')].every(button=>{
        const bounds=button.getBoundingClientRect();
        return bounds.width>0 && bounds.height>0 &&
          bounds.top>=scopeBounds.top-1 && bounds.bottom<=scopeBounds.bottom+1 &&
          bounds.left>=scopeBounds.left-1 && bounds.right<=scopeBounds.right+1;
      });
      const scrollbarStyle=element=>{
        const style=getComputedStyle(element);
        const bar=getComputedStyle(element,'::-webkit-scrollbar');
        const track=getComputedStyle(element,'::-webkit-scrollbar-track');
        const thumb=getComputedStyle(element,'::-webkit-scrollbar-thumb');
        return {width:style.scrollbarWidth,color:style.scrollbarColor,
          webkitWidth:bar.width,track:track.backgroundColor,
          thumb:thumb.backgroundColor,radius:thumb.borderRadius};
      };
      return {
        sidebar:side.width, divider:divider.width, dividerX:divider.x,
        navFont:navstyle.fontSize, listFont:numberstyle.fontSize,
        navColor:navstyle.color, listColor:numberstyle.color,
        selectFont:selectstyle.fontSize,inputFont:inputstyle.fontSize,
        overflowX:liststyle.overflowX, overflowY:liststyle.overflowY,
        scrollbarWidth:liststyle.scrollbarWidth,
        listScrollbar:scrollbarStyle(list),contentScrollbar:scrollbarStyle(content),
        resultsScrollbar:scrollbarStyle(results),
        resultsScrollHeight:results.scrollHeight,resultsClientHeight:results.clientHeight,
        scopesFit,scopesScrollHeight:scopes.scrollHeight,scopesClientHeight:scopes.clientHeight,
        contentScrollHeight:content.scrollHeight,contentClientHeight:content.clientHeight,
        scrollWidth:list.scrollWidth,clientWidth:list.clientWidth,
        scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,
        visible:getComputedStyle(rail).display!=='none',
      };
    }''')


def main():
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        for width, height in ((1440,900), (1000,700), (790,680), (390,650), (320,480)):
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.set_content(html)
            if width==1000: page.evaluate("document.documentElement.dataset.theme='dark'")
            page.add_script_tag(content=STUBS)
            for name in ('layout-controller.js','navigation.js','catalog-rail.js','toolbar.js'):
                page.add_script_tag(content=(ROOT/'app'/name).read_text())
            page.locator('#mainNav [data-view="figures"]').wait_for(state='attached')
            if 'layout-no-nav' in page.locator('body').get_attribute('class').split():
                page.locator('#atlasMenuButton').click()
            before=get_view(page)
            page.keyboard.press('Shift+L')
            after=get_view(page)
            assert after['visible'], (width,after)
            assert abs(before['sidebar']-after['sidebar'])<1, (width,before,after)
            assert abs(before['dividerX']-after['dividerX'])<1, (width,before,after)
            assert after['navFont']==after['listFont']==after['selectFont']==after['inputFont'], (width,after)
            assert after['navColor']==after['listColor'], (width,after)
            assert after['overflowX']=='hidden' and after['overflowY']=='auto', (width,after)
            assert after['scrollbarWidth']=='thin', (width,after)
            assert after['contentScrollbar']==after['listScrollbar'], (width,after)
            assert after['contentScrollbar']['webkitWidth']=='6px', (width,after)
            assert after['contentScrollHeight']>after['contentClientHeight'], (width,after)
            assert after['scrollWidth']<=after['clientWidth']+1, (width,after)
            assert after['scrollHeight']>after['clientHeight'], (width,after)
            if width==1000:
                page.screenshot(path=screenshot_path('Atlas_Unified_List.png'))
            page.locator('#catalogRailList').focus()
            page.keyboard.press('PageDown')
            page.wait_for_timeout(80)
            scroll=page.locator('#catalogRailList').evaluate('(el)=>el.scrollTop')
            assert scroll>0,(width,scroll)
            page.locator('#atlasMenuButton').click()
            if width==1000:
                page.screenshot(path=screenshot_path('Atlas_Unified_Menu.png'))
            last=get_view(page)
            assert not last['visible'],(width,last)
            assert abs(before['sidebar']-last['sidebar'])<1,(width,before,last)
            page.locator('#globalSearch').click()
            page.locator('#atlasCommandPalette').wait_for(state='visible')
            search=get_view(page)
            assert search['scopesFit'], (width,search)
            assert search['scopesScrollHeight']<=search['scopesClientHeight']+1, (width,search)
            assert search['resultsScrollHeight']>search['resultsClientHeight']>0, (width,search)
            assert search['resultsScrollbar']==search['contentScrollbar'], (width,search)
            assert not errors,(width,errors)
            print(f'{width}×{height}: typography {after["listFont"]} / {after["listColor"]}; '
                  f'Browse, search, and content scrollbars match; search categories fit')
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
