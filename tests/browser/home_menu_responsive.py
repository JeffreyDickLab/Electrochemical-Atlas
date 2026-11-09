#!/usr/bin/env python3
"""Check Menu no-scroll and home header alignment across display sizes.

Uses real generated Atlas HTML/CSS and navigation controllers, with synthetic
content only. Does not import, copy, or distribute textbook PDF data.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / 'app/index.html').read_text()
CSS = (ROOT / 'app/atlas.css').read_text()
HTML = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', HTML)
HTML, stylesheet_replacements = re.subn(
    r'<link\s+rel="stylesheet"\s+href="atlas\.css"\s*/?>',
    lambda _: '<style>'+CSS+'</style>', HTML
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
HOME = '''
<section class="atlas-welcome">
  <h1>Electrochemical Atlas</h1>
  <div class="atlas-launch-grid">
    <button class="atlas-launch"><span class="atlas-launch-icon">▤</span><strong>Continue reading</strong><small>Book p. 1 · PDF 52</small></button>
    <button class="atlas-launch"><span class="atlas-launch-icon">☷</span><strong>Chapters</strong><small>Book outline</small></button>
    <button class="atlas-launch"><span class="atlas-launch-icon">→</span><strong>Study paths</strong><small>9 paths</small></button>
    <button class="atlas-launch"><span class="atlas-launch-icon">ƒx</span><strong>Calculators</strong><small>24 tools</small></button>
  </div>
</section>
<section class="atlas-suggested-paths">
  <div class="section-heading"><h2>Suggested starting points</h2><button class="text-button">All study paths</button></div>
  <div class="atlas-start-paths">
    <button class="atlas-path-shortcut"><strong>Start from zero: the electrochemical core</strong><small>12 steps</small><span>→</span></button>
    <button class="atlas-path-shortcut"><strong>Cyclic voltammetry: from first scan to mechanism</strong><small>12 steps</small><span>→</span></button>
    <button class="atlas-path-shortcut"><strong>Electrochemical impedance spectroscopy</strong><small>9 steps</small><span>→</span></button>
    <button class="atlas-path-shortcut"><strong>Extra example</strong><small>9 steps</small><span>→</span></button>
  </div>
</section>
'''


def snapshot(page):
    return page.evaluate('''() => {
      const pos=s=>document.querySelector(s)?.getBoundingClientRect();
      const nav=document.querySelector('#mainNav');
      const side=pos('#sidebar');
      const btn=[...nav.querySelectorAll('button[data-view]')];
      const navRect=nav.getBoundingClientRect();
      const overflow=btn.filter(el=>{
        const r=el.getBoundingClientRect();
        return r.bottom>navRect.bottom+1.1||r.top<navRect.top-1.1;
      }).map(el=>el.dataset.view);
      const styles=getComputedStyle(nav);
      return {
        sidebarWidth:side.width,sidebarHeight:side.height,
        menuHeight:nav.clientHeight,menuScrollHeight:nav.scrollHeight,
        overflow, overflowY:styles.overflowY,grid:styles.display,
        titleX:pos('.atlas-welcome h1').x,launchX:pos('.atlas-launch').x,
        startTitleX:pos('.atlas-suggested-paths h2').x,
        startButtonX:pos('.atlas-path-shortcut').x,
        welcomeBorder:getComputedStyle(document.querySelector('.atlas-welcome')).borderTopWidth,
        dividerWidth:pos('#navDivider').width,
      };
    }''')


def main():
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        for width,height in ((1440,900),(1440,600),(1000,700),(790,680),
                             (390,844),(390,650),(390,530),(390,490),
                             (390,460),(390,420),(390,390),(390,360),
                             (320,460),(320,400)):
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(HTML)
            page.add_script_tag(content=STUBS)
            for name in ('layout-controller.js','navigation.js','catalog-rail.js','toolbar.js'):
                page.add_script_tag(content=(ROOT/'app'/name).read_text())
            page.locator('#atlasMenuButton').wait_for()
            if 'layout-no-nav' in page.locator('body').get_attribute('class').split():
                page.locator('#atlasMenuButton').click()
            page.locator('#content').evaluate('(el,html)=>el.innerHTML=html',HOME)
            page.wait_for_timeout(50)
            state=snapshot(page)
            assert state['overflowY']=='hidden', (width,height,state)
            assert not state['overflow'], (width,height,state)
            assert state['menuScrollHeight']<=state['menuHeight']+1, (width,height,state)
            for a,b in [('titleX','startTitleX'),('launchX','startButtonX'),('titleX','launchX')]:
                assert abs(state[a]-state[b])<1.1, (width,height,a,b,state)
            assert state['welcomeBorder']=='0px',(width,height,state)
            assert not errors,(width,height,errors)
            print(f'{width}×{height}: {state["grid"]} Menu fits; heading and buttons aligned')
            if width==390 and height==844:
                page.screenshot(path=screenshot_path('atlas_home_aligned_after.png'))
                page.locator('#atlasMenuButton').click()
                page.screenshot(path=screenshot_path('atlas_home_noborder_after.png'))
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
