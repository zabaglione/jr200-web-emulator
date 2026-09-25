#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exercise every published catalog game with locally supplied ROM and FONT.

The file input is only used on a local staged site or the canonical Pages site.
The bytes are never copied into this repository or the generated report.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
PAGES = 'https://zabaglione.github.io/jr200-web-emulator/'
START_KEYS = {'side-catch': 'd', 'relic-dive': 'Enter',
              'lumen-cross': 'Enter', 'corner-crown': 'Enter',
              'circuit-works': 'Enter', 'hearth-zero': 'Enter',
              'brick-pulse': 'Enter'}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args: object) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--font', type=Path, required=True)
    parser.add_argument('--pages', action='store_true',
                        help='Use the canonical Pages URL instead of build/site')
    parser.add_argument('--only', help='Run one catalog game by ID')
    parser.add_argument('--capture-dir', type=Path)
    args = parser.parse_args()
    if not args.rom.is_file() or not args.font.is_file():
        raise SystemExit('ROM and FONT files are required')
    site = ROOT / 'build/site'
    if not args.pages and not (site / 'jr200_codec.wasm').is_file():
        raise SystemExit('Run make wasm-smoke or make wasm first')
    catalog = json.loads((ROOT / 'web/game-catalog.json').read_text(encoding='utf-8'))
    entries = catalog['games']
    if len(entries) != 7:
        raise SystemExit('Expected exactly seven published games')
    if args.only:
        entries = [entry for entry in entries if entry['id'] == args.only]
        if not entries:
            raise SystemExit('Unknown catalog game ID')

    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright

    server = None
    if args.pages:
        base = PAGES
    else:
        handler = functools.partial(QuietHandler, directory=str(site))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/'
    parsed = urlparse(base)
    if parsed.scheme not in ('http', 'https') or (args.pages and base != PAGES):
        raise SystemExit('Unsupported site origin')
    with urlopen(base + 'game-catalog.json', timeout=20) as response:
        remote_catalog = response.read(65537)
    if len(remote_catalog) > 65536 or json.loads(remote_catalog) != catalog:
        raise SystemExit('Served catalog differs from the reviewed local catalog')
    with urlopen(base + 'backend.json', timeout=20) as response:
        backend = json.load(response)
    if args.pages and backend != {'backend': 'emscripten'}:
        raise SystemExit('Pages is not serving the formal Emscripten build')
    for entry in entries:
        with urlopen(base + entry['path'], timeout=20) as response:
            payload = response.read(1024 * 1024 + 1)
        if (len(payload) > 1024 * 1024
                or hashlib.sha256(payload).hexdigest() != entry['sha256']):
            raise SystemExit(f'{entry["id"]}: served CJR hash mismatch')
    executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    try:
        with sync_playwright() as playwright:
            options = {'headless': True}
            if Path(executable).is_file():
                options['executable_path'] = executable
            browser = playwright.chromium.launch(**options)
            try:
                context = browser.new_context(viewport={'width': 1280, 'height': 800})
                try:
                    blocked = []
                    def guard(route):
                        target = urlparse(route.request.url)
                        if (target.scheme != parsed.scheme
                                or target.netloc != parsed.netloc
                                or route.request.method != 'GET'):
                            blocked.append('unexpected request')
                            route.abort()
                        else:
                            route.continue_()
                    context.route('**/*', guard)
                    for entry in entries:
                        identifier = entry['id']
                        page = context.new_page()
                        try:
                            page.goto(base + '?game=' + identifier + '&launch=1',
                                      wait_until='networkidle')
                            page.locator('#rom-combined').set_input_files(str(args.rom))
                            page.locator('#font').set_input_files(str(args.font))
                            try:
                                page.locator('#game-launch-status').filter(
                                    has_text='を起動しました').wait_for(timeout=120000)
                            except PlaywrightTimeoutError as exc:
                                status = page.locator('#game-launch-status').inner_text()
                                machine = page.locator('#machine-status').inner_text()
                                raise AssertionError(
                                    f'{identifier}: launch timed out; {status}; {machine}'
                                ) from exc
                            status = page.locator('#game-launch-status').inner_text()
                            if entry['title'] not in status:
                                raise AssertionError(f'{identifier}: unexpected launch status')
                            before = page.locator('#screen').screenshot()
                            page.locator('#screen').focus()
                            page.keyboard.press(START_KEYS[identifier])
                            changed = False
                            for _ in range(12):
                                page.wait_for_timeout(250)
                                if page.locator('#screen').screenshot() != before:
                                    changed = True
                                    break
                            if not changed:
                                raise AssertionError(
                                    f'{identifier}: start input did not change the screen')
                            if args.capture_dir:
                                args.capture_dir.mkdir(parents=True, exist_ok=True)
                                page.locator('#screen').screenshot(
                                    path=str(args.capture_dir / f'{identifier}-play.png'))
                            print(f'PASS {identifier}: catalog CJR MLOAD/USR and play input',
                                  flush=True)
                        finally:
                            page.close()
                    if blocked:
                        raise AssertionError('Browser attempted an unexpected request')
                finally:
                    context.close()
            finally:
                browser.close()
    finally:
        if server:
            server.shutdown()


if __name__ == '__main__':
    main()
