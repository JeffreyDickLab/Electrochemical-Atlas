#!/usr/bin/env python3
"""End-to-end figure preview coverage with in-memory synthetic PDF pages.

Checks printed-caption isolation, several figure layouts, neighboring-page
matching, responsive cards and conservative blank-page fallback.
"""
from playwright.sync_api import sync_playwright
from _support import ROOT, launch_chromium, screenshot_path

HTML = r'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/atlas.css">
<style>body{background:#e7ebed;padding:12px;font-family:Arial}#content{width:690px;max-width:100%;display:grid;grid-template-columns:1fr 1fr;gap:12px}#content>div{min-width:0}.figure-detail-preview{height:290px!important}p{font-size:12px}</style>
</head><body><main id="content">
<div><p>First figure on shared page</p><div id="first" class="figure-detail-preview"></div></div>
<div><p>Second figure on shared page</p><div id="second" class="figure-detail-preview"></div></div>
<div><p>Tall, colored figure</p><div id="tall" class="figure-detail-preview"></div></div>
<div><p>Caption above diagram</p><div id="above" class="figure-detail-preview"></div></div>
<div><p>Caption on neighboring page</p><div id="neighbor" class="figure-detail-preview"></div></div>
<div><p>Blank graphic fallback</p><div id="blank" class="figure-detail-preview"></div></div>
</main><script src="/app/figure-geometry.js"></script><script>
const text=(value,x,y,w)=>({str:value,transform:[1,0,0,12,x,780-y-12],width:w,height:12});
const configurations={
1:{items:[text('This narrative appears directly before the first figure on the page.',50,74,490),text('Figure',60,260,43),text('1.1.1',105,260,38),text('First caption',152,260,105),text('Figure',60,565,43),text('1.1.2',105,565,38),text('Second caption',152,565,115)],
 draw(ctx){ctx.strokeStyle='#1c293e';ctx.lineWidth=4;ctx.strokeRect(90,120,390,110);ctx.beginPath();ctx.moveTo(95,210);ctx.lineTo(300,135);ctx.lineTo(475,208);ctx.stroke();ctx.strokeStyle='#23ac44';ctx.lineWidth=4;ctx.strokeRect(98,369,370,158);ctx.beginPath();ctx.moveTo(110,510);ctx.lineTo(450,390);ctx.stroke();}},
2:{items:[text('Figure',55,687,43),text('2.2.1',102,687,42),text('Full-page colored scheme',150,687,180)],
 draw(ctx){ctx.fillStyle='#e4ccad';ctx.fillRect(96,72,407,575);ctx.strokeStyle='#b78b56';ctx.lineWidth=5;for(let y=125;y<610;y+=100)ctx.strokeRect(135,y,320,62);}},
3:{items:[text('Figure',55,188,43),text('3.3.1',102,188,42),text('Title above figure',150,188,175)],
 draw(ctx){ctx.strokeStyle='#172c64';ctx.lineWidth=5;ctx.strokeRect(105,271,400,225);ctx.beginPath();ctx.moveTo(110,490);ctx.lineTo(470,285);ctx.stroke();}},
4:{items:[text('Figure',60,480,43),text('4.5.1',103,480,40),text('Not actually drawn',154,480,180)],
 draw(ctx){}},
5:{items:[text('Figure',60,482,43),text('5.7.4',103,482,40),text('Moved figure',154,482,180)],
 draw(ctx){ctx.strokeStyle='#262626';ctx.lineWidth=3;ctx.strokeRect(92,209,410,242);}}
};
const pages={};
for(const [number,config] of Object.entries(configurations)){
 pages[number]={
  getViewport:({scale})=>({width:600*scale,height:780*scale,scale,
    convertToViewportPoint:(x,y)=>[x*scale,(780-y)*scale]}),
  getTextContent:async()=>({items:config.items}),
  render:({canvasContext,viewport})=>{
   const c=canvasContext;c.save();c.fillStyle='#fff';c.fillRect(0,0,viewport.width,viewport.height);
   c.scale(viewport.scale,viewport.scale);config.draw(c);c.restore();return {promise:Promise.resolve()};
  },
 };
}
window.AtlasEquationPreview={getDocument:async()=>({numPages:5,getPage:async n=>pages[n]})};
</script><script src="/app/figure-preview.js"></script><script>
window.ATLAS_SOURCE_SHA256='a'.repeat(64);
window.AtlasFigurePreview.setSource('test-document');
const entries=[['first','1.1.1',1],['second','1.1.2',1],['tall','2.2.1',2],['above','3.3.1',3],['neighbor','5.7.4',4],['blank','4.5.1',4]];
for (const [id,label,page] of entries) window.AtlasFigurePreview.mount(document.getElementById(id),label,page);
</script></body></html>'''


def main():
    html=HTML.replace('<link rel="stylesheet" href="/app/atlas.css">',
                      '<style>'+ (ROOT/'app/atlas.css').read_text()+'</style>')
    for script in ('figure-geometry.js','figure-preview.js'):
        html=html.replace('<script src="/app/'+script+'"></script>',
                          '<script>'+ (ROOT/'app'/script).read_text()+'</script>')
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        page=browser.new_page(viewport={'width':960,'height':1100})
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.set_content(html,wait_until='load')
        for name in ['first','second','tall','above','neighbor']:
            canvas=page.locator('#'+name+' canvas.atlas-source-figure')
            canvas.wait_for(timeout=25000)
            metrics=canvas.evaluate('''c=>{
                const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                let ink=0,green=0;
                for(let k=0;k<pixels.length;k+=4){
                  if(Math.min(pixels[k],pixels[k+1],pixels[k+2])<210) ink++;
                  if(pixels[k+1]>pixels[k]+30 && pixels[k+1]>pixels[k+2]+30)green++;
                }
                return {width:c.width,height:c.height,ink,green};
              }''')
            assert metrics['ink']>200,(name,metrics)
            if name=='first':assert metrics['green']<10,(name,metrics)
            if name=='second':assert metrics['green']>200,(name,metrics)
            if name=='tall':assert metrics['height']>metrics['width'],(name,metrics)
            if name=='above':assert metrics['width']>metrics['height'],(name,metrics)
        page.wait_for_function("document.querySelector('#blank').classList.contains('figure-preview-unavailable')")
        assert page.locator('#blank canvas, #blank iframe').count() == 0
        assert page.locator('.figure-crop-action, dialog.figure-crop-dialog').count() == 0
        for width in (310,510,720):
            page.locator('#content').evaluate('(n,w)=>n.style.width=w+"px"',width)
            for holder in page.locator('#content .figure-detail-preview').all():
                assert holder.evaluate('n=>n.scrollWidth<=n.clientWidth+1')
        # An unavailable renderer must not insert a whole PDF page into a figure.
        page.evaluate("""() => {
          const target=document.createElement('div'); target.id='noengine';
          document.body.append(target);
          window.AtlasEquationPreview.getDocument=()=>Promise.reject(new Error('renderer unavailable'));
          window.AtlasFigurePreview.mount(target,'1.1.5',1);
        }""")
        page.wait_for_function("document.querySelector('#noengine').classList.contains('figure-preview-unavailable')")
        assert page.locator('#noengine canvas, #noengine iframe').count() == 0
        assert not errors,errors
        print('Five diverse figures, read-only previews, unavailable states and responsive layout passed')
        browser.close()

if __name__=='__main__':main()
