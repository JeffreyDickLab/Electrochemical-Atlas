#!/usr/bin/env python3
"""Exercise reviewed figure pixels, edition guards and removed crop controls.

Synthetic pages make the expected bounds exact. No textbook art is required.
"""
from playwright.sync_api import sync_playwright
from _support import ROOT, launch_chromium

HTML = '''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/atlas.css">
<style>body{padding:20px}#content{width:700px;max-width:100%;display:grid;grid-template-columns:1fr 1fr;gap:10px}</style>
</head><body><main id="content">
<div id="single" class="figure-detail-preview"></div>
<div id="multiple" class="figure-detail-preview"></div>
<div id="missing" class="figure-detail-preview"></div>
<div id="wrong" class="figure-detail-preview"></div>
<div id="stale" class="figure-detail-preview"></div>
</main>
<script src="/app/figure-geometry.js"></script>
<script src="/app/source-regions.js"></script>
<script src="/app/figure-reviewed-crops.js"></script>
<script>
const fingerprint='c8f275c377e9fa981b6b4e69a63aa20b675acb846fe516531837cef93a96fb44';
window.ATLAS_SOURCE_SHA256=fingerprint;
window.AtlasFigureManifest={
  pdf_sha256:fingerprint,pdf_pages:2,coordinate_system:'pdf-points-top-left',
  entries:{
    '1.1':{page:1,crop:[90,190,510,460],exclude:[[450,240,490,270]]},
    '1':{parts:[{page:1,crop:[90,190,510,460],exclude:[[450,240,490,270]]},
                {page:2,crop:[100,100,500,300]}]},
  }
};
// Legacy saved rectangles must neither override the new map nor be read.
window.storageReads=0;
const originalGetItem=Storage.prototype.getItem;
Storage.prototype.getItem=function(key){
  if(String(key).startsWith('ea_figure_crops_v1_')){
    storageReads++;
    return JSON.stringify({'1.1':{page:1,x:0,y:0,width:1,height:1}});
  }
  return originalGetItem.call(this,key);
};
let detectedPages=0;
const draw=(ctx,number)=>{
  ctx.fillStyle='#fff';ctx.fillRect(0,0,600,780);
  ctx.fillStyle='#ff0000';ctx.fillRect(10,10,560,30); // prose outside figure
  ctx.fillRect(20,600,550,50); // caption outside figure
  if(number===1){
    ctx.fillStyle='#008000';ctx.fillRect(100,200,300,230);
    ctx.fillStyle='#111';ctx.font='14px Arial';ctx.fillText('(a) Potential / V',120,448);
    ctx.fillStyle='#ff0000';ctx.fillRect(455,245,30,20); // reviewed exclusion
  }else{
    ctx.fillStyle='#0000ff';ctx.fillRect(110,110,380,180);
  }
};
const getPage=async number=>({
  getViewport:({scale})=>({width:600*scale,height:780*scale,scale,
    convertToViewportPoint:(x,y)=>[x*scale,(780-y)*scale]}),
  getTextContent:async()=>{detectedPages++;return {items:[]};},
  render:({canvasContext:ctx,viewport,transform})=>{
    ctx.save();
    if(transform)ctx.transform(...transform);
    ctx.scale(viewport.scale,viewport.scale);draw(ctx,number);ctx.restore();
    return {promise:Promise.resolve(),cancel(){}};
  },
});
window.AtlasEquationPreview={getDocument:async()=>({numPages:2,getPage})};
window.detectionCount=()=>detectedPages;
</script>
<script src="/app/figure-preview.js"></script>
<script>
window.AtlasFigurePreview.setSource('reviewed-fixture');
window.firstMounts=Promise.all([
  window.AtlasFigurePreview.mount(document.getElementById('single'),'1.1',1),
  window.AtlasFigurePreview.mount(document.getElementById('multiple'),'1',1),
  window.AtlasFigurePreview.mount(document.getElementById('missing'),'9.9',1),
]);
</script></body></html>'''


def main():
    html = HTML.replace('<link rel="stylesheet" href="/app/atlas.css">',
                        '<style>' + (ROOT / 'app/atlas.css').read_text() + '</style>')
    for name in ('figure-geometry.js', 'source-regions.js', 'figure-reviewed-crops.js', 'figure-preview.js'):
        html = html.replace('<script src="/app/' + name + '"></script>',
                            '<script>' + (ROOT / 'app' / name).read_text() + '</script>')
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        page = browser.new_page(viewport={'width': 950, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(html, wait_until='load')
        page.evaluate('firstMounts')
        inspect = '''canvas=>{
          const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          let red=0,green=0,blue=0,dark=0;
          for(let i=0;i<pixels.length;i+=4){
            if(pixels[i]>200 && pixels[i+1]<50 && pixels[i+2]<50)red++;
            if(pixels[i]<50 && pixels[i+1]>60 && pixels[i+1]<180 && pixels[i+2]<50)green++;
            if(pixels[i]<50 && pixels[i+1]<50 && pixels[i+2]>200)blue++;
            if(Math.max(pixels[i],pixels[i+1],pixels[i+2])<100)dark++;
          }
          return {width:canvas.width,height:canvas.height,red,green,blue,dark};
        }'''
        single = page.locator('#single canvas').evaluate(inspect)
        multiple = page.locator('#multiple canvas').evaluate(inspect)
        assert single['red'] == 0, single
        assert single['green'] > 10000 and single['dark'] > 100, single
        assert abs(single['width'] / single['height'] - 420 / 270) < .01, single
        assert multiple['red'] == 0, multiple
        assert multiple['green'] > 10000 and multiple['blue'] > 10000, multiple
        assert multiple['height'] > single['height'], (single, multiple)
        assert page.locator('#missing canvas, #missing iframe').count() == 0
        assert 'No reviewed preview' in page.locator('#missing').inner_text()
        assert page.evaluate('storageReads') == 0
        assert page.evaluate('detectionCount()') == 0
        assert page.locator('.figure-crop-action, .figure-crop-dialog').count() == 0
        assert page.evaluate('Object.keys(AtlasFigurePreview).sort()') == ['mount', 'setSource']

        # A wrong fingerprint must not apply coordinates from this edition.
        page.evaluate('''async()=>{
          ATLAS_SOURCE_SHA256='a'.repeat(64);
          await AtlasFigurePreview.mount(document.getElementById('wrong'),'1.1',1);
        }''')
        assert page.locator('#wrong canvas, #wrong iframe').count() == 0
        assert page.evaluate('detectionCount()') > 0

        # Changing the selected PDF invalidates a pending old-document mount.
        page.evaluate('''async()=>{
          ATLAS_SOURCE_SHA256=fingerprint;
          let finish;
          AtlasEquationPreview.getDocument=()=>new Promise(resolve=>{finish=resolve;});
          const mounting=AtlasFigurePreview.mount(document.getElementById('stale'),'1.1',1);
          await Promise.resolve();await Promise.resolve();
          AtlasFigurePreview.setSource('replacement-fixture');
          finish({numPages:2,getPage});
          await mounting;
        }''')
        assert page.locator('#stale canvas').count() == 0
        for width in (310, 510, 700):
            page.locator('#content').evaluate('(element,width)=>element.style.width=width+"px"', width)
            for holder in page.locator('#content .figure-detail-preview').all():
                assert holder.evaluate('element=>element.scrollWidth<=element.clientWidth+1')
        assert not errors, errors
        print('Reviewed crops, labels, masks, multipage panels, edition guard, cancellation and read-only UI passed')
        browser.close()


if __name__ == '__main__':
    main()
