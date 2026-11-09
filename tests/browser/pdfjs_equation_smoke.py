#!/usr/bin/env python3
"""Browser acceptance test for the actual bundled PDF.js and worker.

Creates a tiny original, public-domain test PDF in memory. No textbook page
or extracted equation asset is committed or included in the distribution.
Run after `npm install && npm run build` using Chromium and Playwright.
"""
import functools
import os
from pathlib import Path
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from _support import launch_chromium, screenshot_path

ROOT = Path(__file__).resolve().parents[2]


def fixture_pdf():
    content = b"BT /F1 25 Tf 50 65 Td (E = IR + x) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content)} >>\n".encode() + b"stream\n" + content + b"endstream",
    ]
    body = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for n, data in enumerate(objects, 1):
        offsets.append(len(body))
        body.extend(f"{n} 0 obj\n".encode() + data + b"\nendobj\n")
    xref = len(body)
    body.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        body.extend(f"{offset:010d} 00000 n \n".encode())
    body.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(body)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        return

    def do_GET(self):
        if self.path == '/__test/equation.pdf':
            data = fixture_pdf()
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == '/__test/index.html':
            html = '''<!doctype html><html><head><meta charset="utf-8"></head><body>
              <div id="equation" class="equation-catalog-preview" style="width:450px;height:100px"></div>
              <script src="/app/equation-geometry.js"></script>
              <script>
                window.ATLAS_SOURCE_SHA256='fixture';
                window.AtlasEquationManifest={pdf_sha256:'fixture',entries:{
                  'demo':{page:1,crop:[38,55,205,103]}
                }};
              </script>
              <script src="/app/equation-preview.js"></script>
              <script>
                fetch('/__test/equation.pdf').then(r=>r.blob()).then(blob=>{
                  const url=URL.createObjectURL(blob);
                  window.AtlasEquationPreview.setSource(url);
                  window.AtlasEquationPreview.mount(document.getElementById('equation'),'demo');
                });
              </script>
            </body></html>'''.encode()
            self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        return super().do_GET()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser_path = os.environ.get('ATLAS_CHROME')
            if not browser_path and Path('/usr/bin/chromium').is_file():
                browser_path = '/usr/bin/chromium'
            browser = launch_chromium(pw)
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            url = f'http://127.0.0.1:{server.server_address[1]}/__test/index.html'
            page.goto(url)
            page.locator('canvas.atlas-source-equation').wait_for(timeout=30000)
            result = page.locator('canvas.atlas-source-equation').evaluate('''canvas => {
              const ctx=canvas.getContext('2d');
              const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
              let ink=0;
              for(let i=0;i<data.length;i+=4){
                if(data[i] < 125 && data[i+1] < 125 && data[i+2] < 125)ink++;
              }
              return {width:canvas.width,height:canvas.height,ink};
            }''')
            assert result['ink'] > 60, f'PDF.js rendered a blank equation: {result}'
            assert not errors, errors
            browser.close()
            print('PDF.js browser equation rendering passed:', result)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
