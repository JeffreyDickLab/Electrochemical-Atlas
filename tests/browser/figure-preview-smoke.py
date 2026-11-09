#!/usr/bin/env python3
"""End-to-end UI smoke test using a synthetic drawing, not a textbook figure.

Exercises figure mounting, caption exclusion, responsive frames, and failure
fallback. This does not claim full-PDF coverage or require publication assets.
"""
from playwright.sync_api import sync_playwright
from _support import ROOT, launch_chromium

TEST_HTML = '''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/atlas.css">
<style>body{padding:16px}#content{width:560px;max-width:100%}#sample{width:100%;}button{display:block;width:100%}</style>
</head><body><main id="content">
 <div id="sample" class="figure-catalog-preview" data-figure-label="5.7.4" data-figure-page="1">Locating figure…</div>
 <div id="other" class="figure-detail-preview" data-figure-label="5.7.5" data-figure-page="2">Locating figure…</div>
</main>
<script src="/app/figure-geometry.js"></script>
<script>
const drawChart=ctx=>{
 ctx.fillStyle='#fff';ctx.fillRect(0,0,600,780);
 ctx.strokeStyle='#111';ctx.lineWidth=1.2;
 ctx.beginPath();ctx.moveTo(110,155);ctx.lineTo(110,345);ctx.lineTo(450,345);ctx.stroke();
 ctx.beginPath();ctx.moveTo(110,155);ctx.lineTo(450,155);ctx.stroke();
 ctx.beginPath();for(let x=110;x<=450;x++) {const y=250+60*Math.sin((x-110)*Math.PI*2/340);if(x===110)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
};
const getItems=()=>[
 {str:'Text above the graphic',transform:[1,0,0,10,60,696],width:170,height:11},
 {str:'C/μF',transform:[1,0,0,10,70,560],width:30,height:10},
 {str:'Figure',transform:[1,0,0,10,110,418],width:33,height:11},
 {str:'5.7.4',transform:[1,0,0,10,147,418],width:25,height:11},
 {str:'Caption below the graphic',transform:[1,0,0,10,177,418],width:190,height:11},
 {str:'Text below caption',transform:[1,0,0,10,60,387],width:200,height:10},
];
const viewport={width:600,height:780,scale:1,convertToViewportPoint:(x,y)=>[x,780-y]};
const pages = {
  1:{getViewport:()=>viewport,getTextContent:async()=>({items:getItems()}),
    render:({canvasContext})=>{drawChart(canvasContext);return {promise:Promise.resolve()};}},
  2:{getViewport:()=>viewport,getTextContent:async()=>({items:getItems()}),
    render:({canvasContext})=>{canvasContext.fillStyle='#fff';canvasContext.fillRect(0,0,600,780);return {promise:Promise.resolve()};}}
};
window.AtlasEquationPreview={getDocument:async()=>({numPages:2,getPage:async n=>pages[n]})};
</script>
<script src="/app/figure-preview.js"></script>
<script>
  window.AtlasFigurePreview.setSource('fixture');
  window.AtlasFigurePreview.mount(document.getElementById('sample'),'5.7.4',1);
  window.AtlasFigurePreview.mount(document.getElementById('other'),'5.7.5',2);
</script>
</body></html>'''.encode()

def main():
    # Inline assets so this regression works even where localhost browsing is
    # restricted by enterprise browser policies.
    html=TEST_HTML.decode()
    html=html.replace('<link rel="stylesheet" href="/app/atlas.css">',
                      '<style>'+ (ROOT/'app/atlas.css').read_text()+'</style>')
    for name in ('figure-geometry.js','figure-preview.js'):
        html=html.replace('<script src="/app/'+name+'"></script>',
                          '<script>'+ (ROOT/'app'/name).read_text()+'</script>')
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        page=browser.new_page(viewport={'width':750,'height':850})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load')
        page.locator('#sample canvas.atlas-source-figure').wait_for(timeout=25000)
        canvas=page.locator('#sample canvas.atlas-source-figure')
        result=canvas.evaluate('''node=>{
          const a=node.getContext('2d').getImageData(0,0,node.width,node.height).data;
          let ink=0;for(let i=0;i<a.length;i+=4)if(a[i]<180)ink++;
          return {width:node.width,height:node.height,ink};
        }''')
        assert result['ink']>100, result
        page.wait_for_function("document.querySelector('#other').classList.contains('figure-preview-unavailable')")
        assert page.locator('#other canvas, #other iframe, .figure-crop-action').count() == 0
        assert 'Open in PDF' in page.locator('#other').inner_text()
        for size in [290,410,650]:
            page.locator('#content').evaluate('(node,w)=>node.style.width=w+"px"', size)
            assert page.locator('#sample').evaluate('node=>node.scrollWidth<=node.clientWidth+1')
            assert page.locator('#other').evaluate('node=>node.scrollWidth<=node.clientWidth+1')
        assert not errors, errors
        print('Synthetic figure preview and fallback passed:',result)
        browser.close()

if __name__=='__main__':main()
