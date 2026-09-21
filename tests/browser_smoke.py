#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exercise the staged UI in real Chromium; no network outside localhost.

Uses a synthetic ROM to test the browser wiring. It is not evidence that a
manufacturer ROM reaches BASIC or that hardware interchange works.
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
ROM = bytearray(16384)
ROM[0] = 1
ROM[8192:8199] = bytes([0x86,0x2a,0xb7,0xc1,0x00,0x20,0xfe])
ROM[16382:16384] = bytes([0xe0,0x00])
FONT = bytes(index & 0xff for index in range(2048))

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
                expect(page.locator('#emulator-notice')).to_contain_text('未起動')
                expect(page.locator('#machine-status')).to_contain_text('CPUは実行していません')
                page.locator('#rom-combined').set_input_files({'name':'synthetic.rom','mimeType':'application/octet-stream','buffer':bytes(ROM)})
                page.locator('#font').set_input_files({'name':'synthetic-font.bin','mimeType':'application/octet-stream','buffer':FONT})
                expect(page.locator('#start')).to_be_enabled()
                page.locator('#start').click()
                expect(page.locator('#emulator-notice')).to_contain_text('CPUを起動')
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                page.locator('#pause').click()
                expect(page.locator('#machine-status')).to_contain_text('一時停止')

                page.locator('#debug-history-enabled').check()
                page.locator('#debug-breakpoint-address').fill('E005')
                page.locator('#debug-add-breakpoint').click()
                expect(page.locator('#debug-breakpoints')).to_contain_text('$E005')
                page.locator('#reset').click()
                expect(page.locator('#machine-status')).to_contain_text('breakpoint')
                expect(page.locator('#debug-registers')).to_contain_text('PC $E005')
                page.locator('#debug-memory-address').fill('C100')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 2A')
                page.locator('#debug-step').click()
                expect(page.locator('#machine-status')).to_contain_text('step')
                expect(page.locator('#debug-registers')).to_contain_text('PC $E005')
                page.locator('#debug-run').click()
                expect(page.locator('#machine-status')).to_contain_text('breakpoint')

                page.locator('#debug-clear-breakpoints').click()
                page.locator('#debug-watch-address').fill('C100')
                page.locator('#debug-watch-read').uncheck()
                page.locator('#debug-watch-write').check()
                page.locator('#debug-add-watchpoint').click()
                expect(page.locator('#debug-watchpoints')).to_contain_text('$C100 / write')
                page.locator('#reset').click()
                expect(page.locator('#machine-status')).to_contain_text('write watchpoint')
                expect(page.locator('#debug-history-status')).to_contain_text('命令履歴 2 / 256')
                expect(page.locator('#debug-instructions')).to_contain_text('$E002 instruction OP $B7')
                expect(page.locator('#debug-accesses')).to_contain_text('W $C100 = $2A (data)')
                page.locator('#debug-clear-watchpoints').click()
                page.locator('#reset').click()
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                page.locator('#cjr').set_input_files({'name':'golden.cjr','mimeType':'application/octet-stream','buffer':GOLDEN})
                expect(page.locator('#result')).to_contain_text('payloadBytes')
                summary=json.loads(page.locator('#result').inner_text())
                assert summary['payloadBytes']==1 and summary['firstAddress']==0x7000
                assert summary['hardwareVerified'] is False and summary['nameAscii']=='X'
                for name in ['LICENSE.txt','LICENSES/VJR200.txt','LICENSES/MAME_BSD-3-Clause.txt','THIRD_PARTY_NOTICES.md']:
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
                print('PASS Chromium: synthetic boot, breakpoint/resume/step/watch/peek, bounded trace UI, CJR tools, no external requests')
                print('Browser:',browser.version)
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close(); worker.join(timeout=2)

if __name__=='__main__':
    main()
