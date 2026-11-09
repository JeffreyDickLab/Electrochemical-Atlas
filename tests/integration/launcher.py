#!/usr/bin/env python3
"""Exercise the compiled Linux portable launcher without opening a GUI.

Runs a temporary user-config directory and a fake xdg-open command. The server
must serve the app and stop after the last simulated Atlas tab closes.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import time
import urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[2]
EXPECTED_VERSION=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
EXECUTABLE=ROOT/'runtime/atlas-linux-amd64'
if not EXECUTABLE.exists():
    raise SystemExit('Build the Linux launcher first (npm run release).')

with tempfile.TemporaryDirectory(prefix='atlas-launcher-test-') as folder:
    temp=pathlib.Path(folder)
    stub=temp/'xdg-open'
    stub.write_text('#!/bin/sh\nexit 0\n')
    stub.chmod(0o755)
    env={**os.environ,'XDG_CONFIG_HOME':str(temp/'settings'), 'PATH':str(temp)+os.pathsep+os.environ.get('PATH','')}
    process=subprocess.Popen([str(EXECUTABLE)],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    url='http://127.0.0.1:43119'
    def request(endpoint, payload=None, **headers):
        data=None if payload is None else json.dumps(payload).encode('utf-8')
        if data is not None:headers={'X-Atlas-Request':'same-origin','Content-Type':'application/json',**headers}
        req=urllib.request.Request(url+endpoint,data=data,headers=headers)
        return urllib.request.urlopen(req,timeout=4)
    try:
        for _ in range(40):
            try:
                with request('/__atlas/status') as response:
                    assert response.headers['X-Atlas-Build']==EXPECTED_VERSION
                    assert json.load(response)['portable']
                    break
            except Exception:
                if process.poll() is not None:raise RuntimeError('Launcher exited before accepting requests')
                time.sleep(.15)
        else:raise RuntimeError('Server did not start')
        with request('/atlas/app/index.html') as response:
            page=response.read().decode('utf-8')
            assert '<title>Electrochemical Atlas</title>' in page and 'atlas-build-chip' not in page
        with request('/app/atlas.css') as response:
            assert len(response.read())>10000
        with request('/app/equations/source-map.json') as response:
            assert len(json.load(response)['entries'])==2004
        # New preview modules and maps must also work with the already-built
        # native launcher, under both supported application URL prefixes.
        for prefix in ('/app/', '/atlas/app/'):
            for asset in ('source-regions.js', 'table-preview.js', 'tables/source-map.js'):
                with request(prefix + asset) as response:
                    assert response.read() == (ROOT / 'app' / asset).read_bytes(), asset
            with request(prefix + 'tables/source-map.json') as response:
                assert len(json.load(response)['entries']) == 52
        # Decoder assets use the ordinary static route. The legacy native
        # renderer route allows only its two JavaScript module filenames.
        codec_dir = ROOT / 'app/vendor/pdfjs-codecs'
        if codec_dir.exists():
            codec_names = (
                'jbig2.wasm', 'jbig2_nowasm_fallback.js',
                'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2',
            )
            for prefix in ('/app/', '/atlas/app/'):
                for name in codec_names:
                    endpoint = prefix + 'vendor/pdfjs-codecs/' + name
                    with request(endpoint) as response:
                        assert response.read() == (codec_dir / name).read_bytes(), endpoint
                        if name.endswith('.wasm'):
                            assert response.headers['Content-Type'] == 'application/wasm'
        tab_a='atlas_test_session_111111'
        tab_b='atlas_test_session_222222'
        with request('/__atlas/session',{'id':tab_a,'event':'open'}) as r:assert json.load(r)['ok']
        with request('/__atlas/session',{'id':tab_b,'event':'open'}) as r:assert json.load(r)['ok']
        with request('/__atlas/session',{'id':tab_a,'event':'close'}) as r:assert json.load(r)['ok']
        assert process.poll() is None,'Shut down with another tab open'
        with request('/__atlas/session',{'id':tab_b,'event':'close'}) as r:assert json.load(r)['ok']
        try:process.wait(timeout=9)
        except subprocess.TimeoutExpired:raise RuntimeError('Launcher stayed open after final tab closed')
        assert process.returncode == 0
        print('Compiled launcher integration passed: served local assets, 2 tabs, clean server exit.')
    finally:
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=3)
            except subprocess.TimeoutExpired:process.kill()
