#!/usr/bin/env python3
"""Visual regression for source-derived scientific typography (synthetic samples).

Covers the actual shared formatter, Figure/Table/Reference detail wrappers,
problem subparts, and collection previews at narrow and wide content sizes.
No publisher PDF content or pre-extracted data is included in these fixtures.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]
STYLE = (ROOT / 'app/atlas.css').read_text()
SCIENCE = (ROOT / 'app/science-format.js').read_text()
TEXT_UTILS = (ROOT / 'app/text-utils.js').read_text()
DETAILS = (ROOT / 'src/client/application/60-entity-details.js').read_text()
DISCOVERY = (ROOT / 'src/client/application/30-discovery.js').read_text()
DETAIL_HELPERS = DETAILS[:DETAILS.index('  // There is one source reader:')]
COLLECTION_FUNCTION = DISCOVERY[
    DISCOVERY.index('  function collectionCard(name, item, index) {'):
    DISCOVERY.index('  // Render the actual equation directly', DISCOVERY.index('  function collectionCard(name, item, index) {'))
]
PRELUDE = r'''
const sci=(text, options)=>window.AtlasScience.html(text,options);
const esc=text=>window.AtlasScience.escape(text);
const pageLabel=p=>'PDF '+p;
const shorten=(v,max)=>String(v).slice(0,max);
'''
SCENARIOS = [
    ('figure', 'Figure 4.6: Fe³⁺ + e⁻ ⇌ Fe²⁺; ΔG° and 10−⁶ mol cm⁻².'),
    ('table', 'Table 2.4: CO₂ and H₂O at 25 °C; values in µA cm⁻².'),
    ('reference', 'A. Example and B. Example, Journal of Electrochemistry 12 (2024), 10–12. CO₂ chemistry.'),
    ('problem-circuit', 'Two amplifiers I2 and Z2 provide a voltage e2−e1 to the noninverting inputofCF2.WhatistheoutputofCF2?'),
    ('problem-scanned', 'A solution contains 5.7 × 10–4 MCo3+ and 8.1 × 10 −2 MFe2+; k,of10 –3 cm/s. The value is explained intermsof a rate, andthe response is measured.'),
]


def main():
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        for width in (260, 350, 520, 900):
            page=browser.new_page(viewport={'width':max(390,width+40),'height':850})
            errors=[]
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content(f'''<!doctype html><html data-theme="dark"><head><style>{STYLE}</style></head>
              <body style="margin:0;overflow:auto"><main id="content" class="content" style="box-sizing:border-box;width:{width}px;max-width:100%;padding:12px;min-width:0">
                <h2>Scientific text rendering examples</h2><div id="fixtures"></div></main></body></html>''')
            page.add_script_tag(content=TEXT_UTILS)
            page.add_script_tag(content=SCIENCE)
            page.add_script_tag(content=PRELUDE+DETAIL_HELPERS+'\n'+COLLECTION_FUNCTION)
            page.evaluate('''scenarios => {
                const root=document.getElementById('fixtures');
                for(const [type, text] of scenarios){
                  const group=document.createElement('section');
                  group.className='detail-card';
                  group.innerHTML='<h3>'+type+'</h3>'+sourceTextPresentation(type,text);
                  root.append(group);
                }
                const problem=document.createElement('section');
                problem.className='detail-card';
                problem.innerHTML='<h3>Problem</h3>'+problemPresentation(
                  'Calculate the concentration of CO₂ at 25 °C. (a) Find the amount of Fe³⁺. '+
                  '(b) Calculate D = 1 × 10−⁶ cm² s⁻¹.');
                root.append(problem);
                const preview=document.createElement('section');
                preview.className='detail-card';
                preview.innerHTML=collectionCard('figures',{
                  title:'Figure 4.6', description:'H₂O and Fe³⁺; α, β, γ, ΔG°',pdf_page:52},0)
                  +collectionCard('references',{
                  chapter:'4',number:6,text:'Journal 10–12 (2024). CO₂ work.',pdf_page:52},1);
                root.append(preview);
            }''',SCENARIOS)
            assert not errors,(width,errors)
            assert page.locator('.source-text--figure sup').count()>=2,width
            assert page.locator('.source-text--table sub').count()>=2,width
            assert page.locator('.source-text--reference').count()==1,width
            circuit=page.locator('.source-text--prose').first
            assert 'noninverting input of CF2. What is the output of CF2?' in circuit.inner_text(),width
            assert circuit.locator('sub').count() >= 5,width
            assert 'inputof' not in circuit.inner_text(),width
            assert 'M Co' in page.locator('.source-text--prose').last.inner_text(),width
            assert 'k, of' in page.locator('.source-text--prose').last.inner_text(),width
            assert 'in terms of a rate, and the response' in page.locator('.source-text--prose').last.inner_text(),width
            assert page.locator('.source-text--prose').last.locator('sup').count() >= 3,width
            assert page.locator('.problem-parts li').count()==2,width
            assert page.locator('.collection-card .sci-rich sub').count()>=1,width
            assert '10–12' in page.locator('.source-text--reference').inner_text(),width
            assert page.locator('.source-text--reference').evaluate('(el)=>getComputedStyle(el.querySelector("p")).textIndent') != '0px'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+2'),width
            if width in (350,900):
                page.screenshot(path=screenshot_path(f'Atlas_Scientific_Typography_{width}.png'),full_page=True)
            page.close()
            print(f'{width}px: figures/tables/problems/references and special glyphs render without horizontal overflow')
        browser.close()


if __name__=='__main__':
    main()
