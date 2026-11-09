#!/usr/bin/env python3
"""No-network browser test of the two-axis equation preview renderer.

A tiny, entirely original canvas drawing stands in for a source PDF; the real
PDF.js module is separately tested by pdfjs_equation_smoke.py after install.
"""
from __future__ import annotations

import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]

MOCK_PDFJS = r'''export const GlobalWorkerOptions = {};
export function getDocument(_options) {
 const page = {
  getViewport: ({scale}) => ({width:500*scale,height:720*scale,scale}),
  render({canvasContext:ctx,viewport:v,transform}) {
   const s=v.scale;
   ctx.save();
   ctx.fillStyle='#f8f4ec';
   ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);
   ctx.translate(transform[4],transform[5]);
   ctx.scale(s,s);
   ctx.fillStyle='#161a1a';
   ctx.font='16px Arial';
   ctx.fillText('a + b = c',84,138);
   ctx.beginPath();ctx.lineWidth=.55;ctx.moveTo(87,118);ctx.lineTo(150,118);ctx.stroke();
   ctx.font='13px Arial';
   for(let row=0;row<9;row++)ctx.fillText(`x${row} + y${row} = ${row+1}`,84,197+row*13);
   ctx.font='13px monospace';
   ctx.fillText('long_expression = a + b + c + d + e + f + g + h',45,391);
   ctx.restore();
   return {promise:Promise.resolve()};
  }
 };
 return {promise:Promise.resolve({numPages:1,getPage:async()=>page,destroy:async()=>{}})};
}'''

HTML = r'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/atlas.css">
<style>body{background:#efefef;margin:25px;font:14px sans-serif}
.preview{width:340px;margin:12px;border:1px solid #aaa}
</style></head><body>
<div id="narrow" class="preview equation-catalog-preview" data-equation-label="narrow"></div>
<div id="wide" class="preview equation-catalog-preview" data-equation-label="wide"></div>
<div id="tall" class="preview equation-catalog-preview" data-equation-label="tall"></div>
<div id="pair" class="preview equation-detail-preview" data-equation-label="pair"></div>
<script src="/app/equation-geometry.js"></script>
<script>window.ATLAS_SOURCE_SHA256='fixture';
window.AtlasEquationManifest={pdf_sha256:'fixture',entries:{
 narrow:{page:1,crop:[80,115,174,145]},
 wide:{page:1,crop:[42,361,466,403]},
 tall:{page:1,crop:[81,182,168,312]},
 pair:{page:1,parts:['narrow','tall']}
}};
</script><script src="/app/equation-preview.js"></script>
<script>window.AtlasEquationPreview.setSource('blob:fixture');
for(const holder of document.querySelectorAll('.preview'))
 window.AtlasEquationPreview.mount(holder,holder.dataset.equationLabel);
</script></body></html>'''



def main():
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        page=browser.new_page(viewport={'width':1000,'height':750})
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        # The CI sandbox can forbid loopback requests. Install the real
        # renderer scripts into a blank browser page and intercept only
        # the fake PDF.js module: no local/network HTTP is needed.
        page.route('https://atlas-preview.invalid/app/vendor/pdfjs/pdf.mjs',
            lambda route: route.fulfill(status=200,body=MOCK_PDFJS,
              headers={'Content-Type':'application/javascript',
                       'Access-Control-Allow-Origin':'*'}))
        html_head=HTML.split('<script src="/app/equation-geometry.js">')[0]
        html_head=html_head.replace('<link rel="stylesheet" href="/app/atlas.css">',
            '<base href="https://atlas-preview.invalid/app/">'
            +'<style>'+ (ROOT/'app/atlas.css').read_text()+'</style>')
        page.set_content(html_head+'</body></html>')
        page.add_script_tag(content=(ROOT/'app/equation-geometry.js').read_text())
        page.add_script_tag(content="window.ATLAS_SOURCE_SHA256='fixture';"+
             "window.AtlasEquationManifest={pdf_sha256:'fixture',entries:{"
             "narrow:{page:1,crop:[80,115,174,145]},"
             "wide:{page:1,crop:[42,361,466,403]},"
             "tall:{page:1,crop:[81,182,168,312]},"
             "pair:{page:1,parts:['narrow','tall']}}};")
        page.add_script_tag(content=(ROOT/'app/equation-preview.js').read_text())
        page.add_script_tag(content="window.AtlasEquationPreview.setSource('blob:fixture');"
            + "for(const holder of document.querySelectorAll('.preview'))"
            + " window.AtlasEquationPreview.mount(holder,holder.dataset.equationLabel);")
        page.locator('#pair canvas.atlas-source-equation').nth(1).wait_for(timeout=10000)
        frame_dimensions=[]
        for label in ('narrow','wide','tall','pair'):
            result=page.locator('#'+label).evaluate('''holder=>{
              const rect=holder.getBoundingClientRect();
              const images=[...holder.querySelectorAll('canvas')];
              const result=images.map(canvas=>{
                const box=canvas.getBoundingClientRect();
                const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
                let dark=0;for(let n=0;n<pixels.length;n+=4)if(pixels[n]<90)dark++;
                return {left:box.left-rect.left,right:rect.right-box.right,
                  top:box.top-rect.top,bottom:rect.bottom-box.bottom,
                  width:box.width,height:box.height,sourceWidth:canvas.width,
                  dark};
              });
              return {viewerW:rect.width,viewerH:rect.height,
                paper:getComputedStyle(holder).backgroundColor, images:result,
                scrollW:holder.scrollWidth,clientW:holder.clientWidth,
                scrollH:holder.scrollHeight,clientH:holder.clientHeight};
            }''')
            assert result['paper']=='rgb(248, 244, 236)',(label,result)
            frame_dimensions.append((result['viewerW'],result['viewerH']))
            assert result['scrollW']<=result['clientW']+1,(label,result)
            assert result['scrollH']<=result['clientH']+1,(label,result)
            assert result['images'] and all(x['dark']>40 for x in result['images']),(label,result)
            assert all(x['left']>=-1 and x['right']>=-1 and x['top']>=-1
                       and x['bottom']>=-1 for x in result['images']),(label,result)
            print(label,result)
        assert len(set(frame_dimensions))==1,frame_dimensions
        assert frame_dimensions[0] == (340,184),frame_dimensions
        # Responsive height changes uniformly across all equations, including
        # the continued two-part derivation. No visible ink touches a frame edge.
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_function('''() =>
          [...document.querySelectorAll('.preview')].every(e =>
            Math.round(e.getBoundingClientRect().height) === 156)''')
        for label in ('narrow','wide','tall','pair'):
            assert page.locator('#'+label).evaluate('''e => {
              const holder=e.getBoundingClientRect();
              return [...e.querySelectorAll('canvas')].every(c=>{
                const rect=c.getBoundingClientRect();
                return rect.left>=holder.left+3 && rect.right<=holder.right-3 &&
                  rect.top>=holder.top+2 && rect.bottom<=holder.bottom-2;
              }) && e.scrollHeight <= e.clientHeight + 1;
            }'''),label
        page.set_viewport_size({'width':1000,'height':750})
        old=page.locator('#narrow canvas').evaluate('(e)=>e.getBoundingClientRect().width')
        page.locator('#narrow').evaluate("holder => holder.style.width='150px'")
        page.wait_for_function('''old => {
          const e=document.querySelector('#narrow canvas');
          return e&&e.getBoundingClientRect().width<old-5;
        }''',arg=old)
        new=page.locator('#narrow canvas').evaluate('(e)=>e.getBoundingClientRect().width')
        assert new<old,(old,new)
        page.locator('#narrow').evaluate("holder => holder.style.removeProperty('width')")
        page.wait_for_function('''() =>
          [...document.querySelectorAll('.preview')].every(e =>
            Math.round(e.getBoundingClientRect().width) === 340)''')
        if os.environ.get('ATLAS_SCREENSHOT'):
            page.screenshot(path=os.environ['ATLAS_SCREENSHOT'],full_page=True)
        assert not errors,errors
        browser.close()
        print('Two-axis equation preview browser acceptance passed.')


if __name__=='__main__':
    main()
