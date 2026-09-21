#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exercise the staged CJR inspector in real Chromium; no network outside localhost.
Requires Playwright and a Chromium binary. Does not test emulator/ROM/hardware.
"""
from __future__ import annotations
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = bytes([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1])

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args: object) -> None:
        pass

def main() -> None:
    from playwright.sync_api import sync_playwright, expect
    executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
    site = ROOT / 'build/site'
    if not (site/'jr200_codec.wasm').is_file():
        raise SystemExit('Run make wasm-smoke (or make wasm) before this test.')
    handler = functools.partial(QuietHandler, directory=str(site))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    base = f'http://127.0.0.1:{server.server_port}'
    errors: list[str] = []
    external: list[str] = []
    try:
        with sync_playwright() as playwright:
            opts = {'headless': True}
            if executable:
                opts['executable_path'] = executable
            browser = playwright.chromium.launch(**opts)
            try:
                page = browser.new_page(viewport={'width':1180,'height':1100}, accept_downloads=True)
                page.on('pageerror', lambda error: errors.append(str(error)))
                def guard(route):
                    url=route.request.url
                    if not url.startswith(base+'/'):
                        external.append(url)
                        route.abort()
                    else:
                        route.continue_()
                page.route('**/*',guard)
                page.goto(base+'/',wait_until='networkidle')
                expect(page.locator('#status')).to_contain_text('WASM起動済み')
                assert '未実装' in page.locator('.notice').inner_text()
                page.locator('#cjr').set_input_files({'name':'golden.cjr','mimeType':'application/octet-stream','buffer':GOLDEN})
                expect(page.locator('#result')).to_contain_text('payloadBytes')
                summary=json.loads(page.locator('#result').inner_text())
                assert summary['payloadBytes']==1 and summary['firstAddress']==0x7000
                assert summary['hardwareVerified'] is False and summary['nameAscii']=='X'
                for name in ['LICENSE.txt','LICENSES/VJR200.txt','THIRD_PARTY_NOTICES.md']:
                    result=page.request.get(base+'/'+name)
                    assert result.ok and len(result.body())>100, name
                page.locator('#bin').set_input_files({'name':'sample.bin','mimeType':'application/octet-stream','buffer':bytes([0xab])})
                page.locator('#name').fill('X')
                with page.expect_download() as event:
                    page.locator('#create').click()
                download=event.value
                assert download.suggested_filename=='sample.cjr'
                with tempfile.TemporaryDirectory() as directory:
                    output=Path(directory)/'sample.cjr'
                    download.save_as(output)
                    assert output.read_bytes()==GOLDEN
                expect(page.locator('#pack-status')).to_contain_text('47バイト')
                screenshot=os.environ.get('JR200_SCREENSHOT')
                if screenshot:
                    page.screenshot(path=screenshot, full_page=True)
                broken=bytearray(GOLDEN); broken[40]^=1
                page.locator('#cjr').set_input_files({'name':'broken.cjr','mimeType':'application/octet-stream','buffer':bytes(broken)})
                expect(page.locator('#result')).to_contain_text('エラー')
                assert '40' in page.locator('#result').inner_text()
                assert not errors, errors
                assert not external, external
                print('PASS Chromium: WASM startup, CJR inspect, exact BIN->CJR download, corrupt input, license links, no external requests')
                print('Browser:',browser.version)
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close(); worker.join(timeout=2)

if __name__=='__main__':
    main()
