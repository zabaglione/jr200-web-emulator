#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exercise the staged UI in real Chromium; no network outside localhost.

Uses a synthetic ROM to test the browser wiring. It is not evidence that a
manufacturer ROM reaches BASIC or that hardware interchange works.
"""
from __future__ import annotations
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = bytes([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1])
SPECIAL = bytearray(GOLDEN)
SPECIAL[22] = 2
SPECIAL[32] = sum(SPECIAL[:32]) & 0xff
ROM = bytearray(16384)
ROM[0] = 1
ROM[8192:8209] = bytes([
    0x86,0x2a,0xb7,0xc1,0x00,
    0x86,0x80,0xb7,0xc8,0x13,
    0x86,0x06,0xb7,0xc8,0x12,
    0x20,0xfe,
])
ROM[16382:16384] = bytes([0xe0,0x00])
FONT = bytes(index & 0xff for index in range(2048))
FONT_ALTERNATE_BYTES = bytearray(FONT)
FONT_ALTERNATE_BYTES[0x61 * 8] = 0x40
FONT_ALTERNATE = bytes(FONT_ALTERNATE_BYTES)
LONG_ROM_NAME = 'synthetic-' + ('full-hd-layout-' * 10) + '.rom'
LONG_FONT_NAME = 'synthetic-' + ('font-cache-refresh-' * 9) + '.bin'

def make_keyboard_rom() -> bytes:
    """Create a synthetic ROM that performs the documented font handshake.

    It copies the 2048 font bytes into $D000-$D7FF, scans keys through the
    normal MN1544 handshake, and writes the last observed code to $C100.
    Pressing code $61 also changes glyph $61 row zero to test cache invalidation.
    """
    code = bytearray()
    labels: dict[str, int] = {}
    fixups: list[tuple[int, str]] = []
    wait_sequence = 0

    def emit(*values: int) -> None:
        code.extend(values)

    def label(name: str) -> None:
        labels[name] = len(code)

    def branch(opcode: int, target: str) -> None:
        emit(opcode, 0)
        fixups.append((len(code) - 1, target))

    def pulse(value: int) -> None:
        control = value | 0x40
        emit(0x86, control, 0xb7, 0xc8, 0x03)  # preserve PB6 key-sound enable
        emit(0x86, 0x40, 0xb7, 0xc8, 0x03)
        emit(0x86, control, 0xb7, 0xc8, 0x03)

    def wait_for_keycode() -> None:
        nonlocal wait_sequence
        name = f'wait_{wait_sequence}'
        wait_sequence += 1
        emit(0xc6, 0x40)  # LDAB #64; more than the 100-cycle device delay
        label(name)
        emit(0x5a)        # DECB
        branch(0x26, name)  # BNE

    emit(0x8e, 0x7f, 0xff)              # LDS #$7FFF for the NMI/RTI test
    emit(0x86, 0x01, 0xb7, 0xc8, 0x1e)  # enable key IRQ
    emit(0x86, 0x43, 0xb7, 0xc8, 0x02)  # PB0/PB1/PB6 are outputs
    emit(0xce, 0xd0, 0x00)              # LDX #$D000
    pulse(0x02)
    wait_for_keycode()
    emit(0xb6, 0xc8, 0x01, 0xa7, 0x00, 0x08, 0xb6, 0xc8, 0x1c)

    label('copy_font')
    pulse(0x01)
    wait_for_keycode()
    emit(0xb6, 0xc8, 0x01, 0xa7, 0x00, 0x08, 0xb6, 0xc8, 0x1c)
    emit(0x8c, 0xd8, 0x00)  # CPX #$D800
    branch(0x26, 'copy_font')

    pulse(0x01)             # consume trailing baud byte
    wait_for_keycode()
    emit(0xb6, 0xc8, 0x01, 0xb6, 0xc8, 0x1c)

    emit(0x86, 0x02, 0xb7, 0xca, 0x7f)  # enable CRTC display
    emit(0x86, 0x07, 0xb7, 0xc5, 0x00)  # white glyph on black
    emit(0x86, 0x61, 0xb7, 0xc1, 0x00)  # show the KeyA glyph

    label('scan')
    pulse(0x02)
    wait_for_keycode()
    emit(0xb6, 0xc8, 0x01, 0x4d)              # LDAA $C801; TSTA
    branch(0x27, 'skip_glyph_change')           # keep last nonzero key
    emit(0xb7, 0xc1, 0x00, 0x81, 0x61)         # key -> $C100; CMPA #$61
    branch(0x26, 'skip_glyph_change')
    emit(0x86, 0x80, 0xb7, 0xd3, 0x08)         # glyph $61 row 0
    label('skip_glyph_change')
    emit(0xb6, 0xc8, 0x1c)
    for offset in range(2):
        pulse(0x01)
        wait_for_keycode()
        emit(0xb6, 0xc8, 0x01, 0xb7, 0xc1, 0x02 + offset,
             0xb6, 0xc8, 0x1c)
    branch(0x20, 'scan')

    for offset, target in fixups:
        delta = labels[target] - (offset + 1)
        if not -128 <= delta <= 127:
            raise AssertionError((target, delta))
        code[offset] = delta & 0xff

    rom = bytearray(16384)
    rom[0] = 1
    rom[8192:8192 + len(code)] = code
    rom[8192 + 0x100:8192 + 0x106] = bytes([
        0x86, 0x42, 0xb7, 0xc1, 0x01, 0x3b,  # NMI marker at $C101; RTI
    ])
    rom[16380:16382] = bytes([0xe1, 0x00])
    rom[16382:16384] = bytes([0xe0, 0x00])
    return bytes(rom)

KEYBOARD_ROM = make_keyboard_rom()

def contrast_ratio(foreground: str, background: str) -> float:
    def luminance(color: str) -> float:
        channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
        linear = [
            value / 12.92 if value <= 0.04045
            else ((value + 0.055) / 1.055) ** 2.4
            for value in channels
        ]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    light, dark = sorted((luminance(foreground), luminance(background)), reverse=True)
    return (light + 0.05) / (dark + 0.05)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args: object) -> None:
        pass

def main() -> None:
    from playwright.sync_api import sync_playwright, expect
    executable_candidates = (
        os.environ.get('CHROMIUM_EXECUTABLE'),
        shutil.which('chromium'),
        shutil.which('chromium-browser'),
        shutil.which('google-chrome'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    )
    executable = next((candidate for candidate in executable_candidates
                       if candidate and Path(candidate).is_file()), None)
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
                main_context = browser.new_context(
                    viewport={'width':1920,'height':960},
                    accept_downloads=True,
                )
                page = main_context.new_page()
                page.add_init_script("""
                    globalThis.__listenerAdds = 0;
                    const originalAddEventListener = EventTarget.prototype.addEventListener;
                    EventTarget.prototype.addEventListener = function(...args) {
                      globalThis.__listenerAdds += 1;
                      return originalAddEventListener.apply(this, args);
                    };
                    globalThis.__gamepads = [];
                    Object.defineProperty(Navigator.prototype, 'getGamepads', {
                      configurable: true,
                      value: () => globalThis.__gamepads,
                    });
                    globalThis.__audioContexts = [];
                    class FakeGain {
                      constructor(){ this.gain={value:1,setValueAtTime:value=>{this.gain.value=value;}}; }
                      connect(){}
                    }
                    class FakeSource {
                      constructor(context){
                        this.context=context; this.onended=null; this.endTimer=null;
                        this.playbackRate={value:1,setValueAtTime:value=>{this.playbackRate.value=value;}};
                      }
                      connect(){}
                      disconnect(){}
                      start(time){
                        this.startTime=time; this.context.sources.push(this);
                        const duration=(this.buffer?.length ?? 0) /
                          (this.buffer?.sampleRate ?? 44100) / this.playbackRate.value;
                        this.endTimer=setTimeout(
                          ()=>this.onended?.(),
                          Math.max(0,(time+duration-this.context.currentTime)*1000),
                        );
                      }
                      stop(){ clearTimeout(this.endTimer); this.onended?.(); }
                    }
                    class FakeAudioContext {
                      constructor(){
                        this.state='suspended'; this.sampleRate=48000; this.timeOrigin=performance.now();
                        this.timeOffset=1; this.destination={}; this.sources=[]; this.listeners=[];
                        globalThis.__audioContexts.push(this);
                      }
                      get currentTime(){ return this.timeOffset+(performance.now()-this.timeOrigin)/1000; }
                      set currentTime(value){ this.timeOffset=value; this.timeOrigin=performance.now(); }
                      createGain(){ this.gain=new FakeGain(); return this.gain; }
                      createBuffer(_channels,length,sampleRate){ const data=new Float32Array(length); return {length,sampleRate,data,getChannelData:()=>data}; }
                      createBufferSource(){ return new FakeSource(this); }
                      addEventListener(name,listener){ if(name==='statechange') this.listeners.push(listener); }
                      async resume(){ this.state='running'; this.listeners.forEach(listener=>listener()); }
                      async suspend(){ this.state='suspended'; this.listeners.forEach(listener=>listener()); }
                    }
                    globalThis.AudioContext = FakeAudioContext;
                """)
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

                linked = main_context.new_page()
                linked.on('pageerror', lambda error: errors.append(str(error)))
                linked.route('**/*', guard)
                linked_catalog = {
                    'schemaVersion': 1,
                    'games': [{
                        'id': 'test-game', 'title': 'TEST GAME', 'version': '1.0.0',
                        'path': 'games/test-game/1.0.0/test-game.cjr',
                        'sha256': hashlib.sha256(GOLDEN).hexdigest(),
                        'runCommand': 'A=USR($7000)',
                    }],
                }
                linked.route('**/game-catalog.json', lambda route: route.fulfill(
                    status=200, content_type='application/json',
                    body=json.dumps(linked_catalog)))
                linked.route('**/games/test-game/1.0.0/test-game.cjr',
                             lambda route: route.fulfill(
                                 status=200, content_type='application/octet-stream',
                                 body=GOLDEN))
                linked.goto(base+'/?game=test-game', wait_until='networkidle')
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    'TEST GAME 1.0.0 をカセットにセット')
                expect(linked.locator('#game-launch-instructions')).to_contain_text(
                    'MLOAD、続いて A=USR($7000)')
                expect(linked.locator('#tape-mount-state')).to_have_attribute(
                    'data-state', 'mounted')
                expect(linked.locator('#tape-status')).to_contain_text('payload 1 bytes')
                for linked_width, linked_height in [(1920, 960), (1280, 720)]:
                    linked.set_viewport_size({'width': linked_width, 'height': linked_height})
                    placement = linked.evaluate('''() => {
                      const banner = document.querySelector('#game-launch').getBoundingClientRect();
                      const workspace = document.querySelector('.workspace').getBoundingClientRect();
                      return {left: banner.left, right: banner.right, bottom: banner.bottom,
                              workspaceTop: workspace.top,
                              viewportWidth: innerWidth,
                              documentWidth: document.documentElement.scrollWidth};
                    }''')
                    assert placement['left'] >= 0, placement
                    assert placement['right'] <= linked_width, placement
                    assert placement['bottom'] <= placement['workspaceTop'], placement
                    assert placement['documentWidth'] <= linked_width, placement
                linked.locator('#rom-combined').set_input_files({
                    'name': 'synthetic.rom', 'mimeType': 'application/octet-stream',
                    'buffer': bytes(ROM),
                })
                linked.locator('#font').set_input_files({
                    'name': 'synthetic-font.bin',
                    'mimeType': 'application/octet-stream', 'buffer': FONT,
                })
                linked.locator('#start').click()
                expect(linked.locator('#machine-status')).to_contain_text('実行中')
                expect(linked.locator('#tape-mount-state')).to_have_attribute(
                    'data-state', 'mounted')
                linked.locator('#tape-cjr').set_input_files({
                    'name': 'local.cjr', 'mimeType': 'application/octet-stream',
                    'buffer': GOLDEN,
                })
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    'ローカルのCJRへ切り替え')
                expect(linked.locator('#tape-mount-state')).to_have_attribute(
                    'data-state', 'pending')
                linked.goto(base+'/?game=missing', wait_until='networkidle')
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    '公開作品が見つかりません')
                linked.goto(base+'/?game=../bad', wait_until='networkidle')
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    'ゲームIDが不正')
                linked.add_init_script('''
                    const nativeFetch = globalThis.fetch.bind(globalThis);
                    globalThis.fetch = async (...args) => {
                      const response = await nativeFetch(...args);
                      if (String(args[0]).endsWith('/games/test-game/1.0.0/test-game.cjr')) {
                        await new Promise(resolve => { globalThis.__releaseGameCjr = resolve; });
                        globalThis.__delayedGameResponseReturned = true;
                      }
                      return response;
                    };
                ''')
                linked.goto(base+'/?game=test-game', wait_until='networkidle')
                linked.wait_for_function('typeof window.__releaseGameCjr === "function"')
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    '作品CJRを確認しています')
                linked.locator('#tape-heading').click()
                linked.locator('#tape-record').click()
                expect(linked.locator('#tape-status')).to_contain_text('状態: 録音待機')
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    '手動のカセット操作を優先')
                linked.evaluate('window.__releaseGameCjr()')
                linked.wait_for_function('window.__delayedGameResponseReturned === true')
                linked.wait_for_timeout(250)
                expect(linked.locator('#tape-status')).to_contain_text('状態: 録音待機')
                expect(linked.locator('#game-launch-status')).to_contain_text(
                    '手動のカセット操作を優先')
                linked.close()

                local_rom = os.environ.get('JR200_TEST_ROM')
                local_font = os.environ.get('JR200_TEST_FONT')
                local_cjr = os.environ.get('JR200_TEST_CJR')
                if any((local_rom, local_font, local_cjr)):
                    if not all((local_rom, local_font, local_cjr)):
                        raise AssertionError('JR200_TEST_ROM, JR200_TEST_FONT and JR200_TEST_CJR must be set together')
                    cjr_bytes = Path(local_cjr).read_bytes()
                    local_catalog = {
                        'schemaVersion': 1,
                        'games': [{
                            'id': 'local-rom-test', 'title': 'LOCAL ROM TEST',
                            'version': '0.1.0',
                            'path': 'games/local-rom-test/0.1.0/local-rom-test.cjr',
                            'sha256': hashlib.sha256(cjr_bytes).hexdigest(),
                            'runCommand': 'A=USR($1000)',
                        }],
                    }
                    local_linked = main_context.new_page()
                    local_linked.on('pageerror', lambda error: errors.append(str(error)))
                    local_linked.route('**/*', guard)
                    local_linked.route('**/game-catalog.json', lambda route: route.fulfill(
                        status=200, content_type='application/json',
                        body=json.dumps(local_catalog)))
                    local_linked.route('**/games/local-rom-test/0.1.0/local-rom-test.cjr',
                                       lambda route: route.fulfill(
                                           status=200,
                                           content_type='application/octet-stream',
                                           body=cjr_bytes))
                    local_linked.goto(base+'/?game=local-rom-test', wait_until='networkidle')
                    expect(local_linked.locator('#game-launch-status')).to_contain_text(
                        'LOCAL ROM TEST 0.1.0 をカセットにセット')
                    local_linked.locator('#rom-combined').set_input_files(local_rom)
                    local_linked.locator('#font').set_input_files(local_font)
                    local_linked.locator('#start').click()
                    expect(local_linked.locator('#machine-status')).to_contain_text('実行中')
                    expect(local_linked.locator('#tape-mount-state')).to_have_attribute(
                        'data-state', 'mounted')
                    local_linked.close()
                    print('PASS local ROM/FONT: linked CJR mount persists after boot')

                real_audio_context = browser.new_context(
                    viewport={'width':1280,'height':720},
                )
                try:
                    real_audio_page = real_audio_context.new_page()
                    real_audio_page.add_init_script("""
                        const NativeAudioContext = globalThis.AudioContext ??
                          globalThis.webkitAudioContext;
                        globalThis.__nativeAudioContexts = [];
                        if (NativeAudioContext) {
                          const TrackedAudioContext = new Proxy(NativeAudioContext, {
                            construct(target, args) {
                              const context = Reflect.construct(target, args);
                              globalThis.__nativeAudioContexts.push(context);
                              return context;
                            },
                          });
                          globalThis.AudioContext = TrackedAudioContext;
                          if (globalThis.webkitAudioContext === NativeAudioContext) {
                            globalThis.webkitAudioContext = TrackedAudioContext;
                          }
                        }
                    """)
                    real_audio_page.on(
                        'pageerror', lambda error: errors.append(str(error)))
                    real_audio_page.route('**/*', guard)
                    real_audio_page.goto(base+'/', wait_until='networkidle')
                    expect(real_audio_page.locator('#audio-status')).to_contain_text(
                        '起動操作待ち')
                    assert real_audio_page.evaluate(
                        'globalThis.__nativeAudioContexts.length') == 0
                    real_audio_page.locator('#rom-combined').set_input_files({
                        'name':'real-audio.rom',
                        'mimeType':'application/octet-stream',
                        'buffer':KEYBOARD_ROM,
                    })
                    real_audio_page.locator('#font').set_input_files({
                        'name':'real-audio.bin',
                        'mimeType':'application/octet-stream',
                        'buffer':FONT,
                    })
                    real_audio_page.locator('#start').click()
                    expect(real_audio_page.locator('#audio-status')).to_contain_text(
                        'context running')
                    assert real_audio_page.evaluate(
                        'globalThis.__nativeAudioContexts.length') == 1
                    assert real_audio_page.evaluate(
                        'globalThis.__nativeAudioContexts[0].state') == 'running'
                    audio_panel = real_audio_page.locator(
                        'details.tool-panel',
                        has=real_audio_page.locator('#audio-heading'),
                    )
                    audio_panel.locator('summary').click()
                    real_audio_page.locator('#audio-disable').click()
                    expect(real_audio_page.locator('#audio-status')).to_contain_text(
                        'Web Audio: 無効 / context suspended')
                    assert real_audio_page.evaluate(
                        'globalThis.__nativeAudioContexts[0].state') == 'suspended'
                    real_audio_page.locator('#audio-enable').click()
                    expect(real_audio_page.locator('#audio-status')).to_contain_text(
                        'Web Audio: 有効 / context running')
                    assert real_audio_page.evaluate(
                        'globalThis.__nativeAudioContexts.length') == 1
                    real_audio_page.locator('#audio-disable').click()
                    expect(real_audio_page.locator('#audio-status')).to_contain_text(
                        'Web Audio: 無効 / context suspended')
                finally:
                    real_audio_context.close()

                def layout_snapshot(target):
                    return target.evaluate("""() => {
                      const root = document.documentElement;
                      const screen = document.querySelector('#screen').getBoundingClientRect();
                      const keyboardElement = document.querySelector('#keyboard-deck');
                      const keyboard = keyboardElement.getBoundingClientRect();
                      const displayElement = document.querySelector('.display-area');
                      const display = displayElement.getBoundingClientRect();
                      const rail = document.querySelector('.utility-rail');
                      const railRect = rail.getBoundingClientRect();
                      const machine = document.querySelector('.machine-stage').getBoundingClientRect();
                      const machineElement = document.querySelector('.machine-stage');
                      const keyHeights = [...document.querySelectorAll('.virtual-key')]
                        .map(key => key.getBoundingClientRect().height);
                      return {
                        innerWidth,
                        innerHeight,
                        dpr: devicePixelRatio,
                        width: root.scrollWidth,
                        height: root.scrollHeight,
                        screenWidth: screen.width,
                        screenHeight: screen.height,
                        screenLeft: screen.left,
                        screenRight: screen.right,
                        screenTop: screen.top,
                        screenBottom: screen.bottom,
                        displayLeft: display.left,
                        displayRight: display.right,
                        displayTop: display.top,
                        displayBottom: display.bottom,
                        imageRendering: getComputedStyle(document.querySelector('#screen')).imageRendering,
                        keyboardHidden: keyboardElement.hidden,
                        keyboardWidth: keyboard.width,
                        keyboardHeight: keyboard.height,
                        keyboardLeft: keyboard.left,
                        keyboardRight: keyboard.right,
                        keyboardTop: keyboard.top,
                        keyboardBottom: keyboard.bottom,
                        minKeyHeight: keyHeights.length ? Math.min(...keyHeights) : 0,
                        machineLeft: machine.left,
                        machineRight: machine.right,
                        machineClientWidth: machineElement.clientWidth,
                        machineScrollWidth: machineElement.scrollWidth,
                        machineClientHeight: machineElement.clientHeight,
                        machineScrollHeight: machineElement.scrollHeight,
                        railWidth: railRect.width,
                        railScrollWidth: rail.scrollWidth,
                        railClientWidth: rail.clientWidth,
                        railScrollHeight: rail.scrollHeight,
                        railClientHeight: rail.clientHeight,
                        overlap: machine.right > railRect.left,
                      };
                    }""")

                def assert_layout(target, width, height, scale):
                    layout = layout_snapshot(target)
                    assert layout['innerWidth'] == width, layout
                    assert layout['innerHeight'] == height, layout
                    assert layout['width'] == width, layout
                    assert layout['height'] == height, layout
                    assert layout['screenWidth'] == 320 * scale, layout
                    assert layout['screenHeight'] == 224 * scale, layout
                    assert layout['screenBottom'] <= height, layout
                    assert layout['keyboardBottom'] <= height, layout
                    assert layout['keyboardHidden'], layout
                    assert layout['keyboardHeight'] == 0, layout
                    assert layout['minKeyHeight'] == 0, layout
                    assert 320 <= layout['railWidth'] <= 400, layout
                    assert layout['railScrollWidth'] == layout['railClientWidth'], layout
                    assert not layout['overlap'], layout
                    assert layout['imageRendering'] in ('pixelated', 'crisp-edges'), layout
                    return layout

                def assert_visible_keyboard_layout(
                    target, width, height, scale, *, side_by_side, min_key_height
                ):
                    target.locator('#keyboard-toggle').click()
                    layout = layout_snapshot(target)
                    assert layout['innerWidth'] == width, layout
                    assert layout['innerHeight'] == height, layout
                    assert layout['width'] == width, layout
                    assert layout['height'] == height, layout
                    assert layout['screenWidth'] == 320 * scale, layout
                    assert layout['screenHeight'] == 224 * scale, layout
                    assert layout['screenBottom'] <= height, layout
                    assert layout['screenLeft'] >= layout['displayLeft'], layout
                    assert layout['screenRight'] <= layout['displayRight'], layout
                    assert layout['screenTop'] >= layout['displayTop'], layout
                    assert layout['screenBottom'] <= layout['displayBottom'], layout
                    assert not layout['keyboardHidden'], layout
                    assert layout['keyboardBottom'] <= height, layout
                    assert layout['machineScrollWidth'] == layout['machineClientWidth'], layout
                    assert layout['machineScrollHeight'] == layout['machineClientHeight'], layout
                    assert layout['screenLeft'] >= layout['machineLeft'], layout
                    assert layout['screenRight'] <= layout['machineRight'], layout
                    assert layout['keyboardLeft'] >= layout['machineLeft'], layout
                    assert layout['keyboardRight'] <= layout['machineRight'], layout
                    if side_by_side:
                        assert 440 <= layout['keyboardWidth'] <= 520, layout
                        assert layout['keyboardLeft'] >= layout['screenRight'], layout
                    else:
                        assert layout['keyboardWidth'] <= 620, layout
                        assert layout['keyboardTop'] >= layout['screenBottom'], layout
                    assert layout['minKeyHeight'] >= min_key_height, layout
                    target.locator('#keyboard-toggle').click()
                    return layout

                palette = page.evaluate("""() => {
                  const style = getComputedStyle(document.documentElement);
                  return Object.fromEntries([
                    'ink', 'panel', 'muted', 'shell', 'accent',
                    'button-top', 'button-bottom',
                    'button-hover-top', 'button-hover-bottom',
                    'keycap', 'key-ink', 'key-blue', 'key-control',
                    'key-control-ink',
                  ].map(name => [name, style.getPropertyValue(`--${name}`).trim()]));
                }""")
                for foreground, background in (
                    ('ink', 'panel'),
                    ('muted', 'shell'),
                    ('key-ink', 'keycap'),
                    ('key-ink', 'key-blue'),
                    ('key-control-ink', 'key-control'),
                ):
                    assert contrast_ratio(palette[foreground], palette[background]) >= 4.5, (
                        foreground,
                        background,
                        palette,
                    )
                for background in (
                    'button-top', 'button-bottom',
                    'button-hover-top', 'button-hover-bottom',
                ):
                    assert contrast_ratio('#ffffff', palette[background]) >= 4.5, (
                        'button text',
                        background,
                        palette,
                    )
                for width, height, hidden_scale, visible_scale, side_by_side, min_key_height in (
                    (1920, 960, 3, 3, True, 29),
                    (1920, 1080, 3, 3, True, 29),
                    (1700, 840, 3, 2, False, 25),
                    (1536, 768, 2, 2, False, 25),
                    (1280, 720, 2, 2, False, 23),
                    (1107, 737, 2, 2, False, 23),
                ):
                    page.set_viewport_size({'width':width, 'height':height})
                    viewport_layout = assert_layout(page, width, height, hidden_scale)
                    assert viewport_layout['dpr'] == 1, viewport_layout
                    visible_layout = assert_visible_keyboard_layout(
                        page,
                        width,
                        height,
                        visible_scale,
                        side_by_side=side_by_side,
                        min_key_height=min_key_height,
                    )
                    if width == 1107:
                        assert visible_layout['keyboardWidth'] <= 560, visible_layout
                page.set_viewport_size({'width':1920, 'height':960})

                dpr_context = browser.new_context(
                    viewport={'width':1920, 'height':1080},
                    device_scale_factor=2,
                )
                try:
                    dpr_page = dpr_context.new_page()
                    dpr_page.on('pageerror', lambda error: errors.append(str(error)))
                    dpr_page.route('**/*', guard)
                    dpr_page.goto(base+'/', wait_until='networkidle')
                    dpr_layout = assert_layout(dpr_page, 1920, 1080, 3)
                    assert dpr_layout['dpr'] == 2, dpr_layout
                    assert_visible_keyboard_layout(
                        dpr_page,
                        1920,
                        1080,
                        3,
                        side_by_side=True,
                        min_key_height=29,
                    )
                finally:
                    dpr_context.close()

                with tempfile.TemporaryDirectory() as profile:
                    persistent_options = {
                        'headless':True,
                        'viewport':{'width':1280,'height':720},
                    }
                    if executable:
                        persistent_options['executable_path'] = executable

                    persistence_context = playwright.chromium.launch_persistent_context(
                        profile, **persistent_options
                    )
                    try:
                        persistence_page = persistence_context.pages[0]
                        persistence_page.on('pageerror', lambda error: errors.append(str(error)))
                        persistence_page.route('**/*', guard)
                        persistence_page.goto(base+'/', wait_until='networkidle')
                        persistence_page.locator('#rom-combined').set_input_files({
                            'name':'remembered.rom',
                            'mimeType':'application/octet-stream',
                            'buffer':KEYBOARD_ROM,
                        })
                        persistence_page.locator('#font').set_input_files({
                            'name':'remembered.bin',
                            'mimeType':'application/octet-stream',
                            'buffer':FONT,
                        })
                        expect(persistence_page.locator('#start')).to_be_enabled()
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#behavior-heading'),
                        ).locator('summary').click()
                        expect(persistence_page.locator('#pause-on-focus-loss')).not_to_be_checked()
                        expect(persistence_page.locator('#key-click-enabled')).not_to_be_checked()
                        persistence_page.locator('#pause-on-focus-loss').check()
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#audio-heading'),
                        ).locator('summary').click()
                        persistence_page.locator('#key-click-enabled').check()
                        persistence_page.locator('#audio-mute').check()
                        persistence_page.locator('#audio-volume').evaluate(
                            "el => { el.value = '35'; el.dispatchEvent(new Event('input', {bubbles:true})); }"
                        )
                        persistence_page.locator('#audio-disable').click()
                        expect(persistence_page.locator('#audio-status')).to_contain_text(
                            'Web Audio: 無効'
                        )
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#inspect-heading'),
                        ).locator('summary').click()
                        persistence_page.locator('#wav-rate').select_option('44100')
                        persistence_page.locator('#wav-baud').select_option('600')
                        persistence_page.locator('#wav-decode-channel').select_option('right')
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#pack-heading'),
                        ).locator('summary').click()
                        persistence_page.locator('#name').fill('LASTNAME')
                        persistence_page.locator('#address').fill('A000')
                        persistence_page.locator('#kind').select_option('0')
                        persistence_page.locator('#baud').select_option('100')
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#input-assist-heading'),
                        ).locator('summary').click()
                        persistence_page.locator('#macro-slot').evaluate(
                            "el => { el.value = '3'; el.dispatchEvent(new Event('change', {bubbles:true})); }"
                        )
                        expect(persistence_page.locator('#macro-slot')).to_have_value('3')
                        persistence_page.locator('#remember-assets').check()
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '次回は自動復元します'
                        )
                        persistence_page.locator('#start').click()
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#debugger-heading'),
                        ).locator('summary').click()
                        persistence_page.locator('#debug-history-enabled').check()
                        persistence_page.locator('#headerless').check()
                        persistence_page.goto('about:blank')
                        persistence_page.go_back(wait_until='networkidle')
                        expect(persistence_page.locator('#headerless')).not_to_be_checked()
                    finally:
                        persistence_context.close()

                    persistence_context = playwright.chromium.launch_persistent_context(
                        profile, **persistent_options
                    )
                    try:
                        persistence_page = persistence_context.pages[0]
                        persistence_page.on('pageerror', lambda error: errors.append(str(error)))
                        persistence_page.route('**/*', guard)
                        persistence_page.goto(base+'/', wait_until='networkidle')
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '自動復元しました'
                        )
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            'remembered.rom（保存済み）'
                        )
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            'remembered.bin（保存済み）'
                        )
                        expect(persistence_page.locator('#remember-assets')).to_be_checked()
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#behavior-heading'),
                        ).locator('summary').click()
                        expect(persistence_page.locator('#pause-on-focus-loss')).to_be_checked()
                        expect(persistence_page.locator('#key-click-enabled')).to_be_checked()
                        expect(persistence_page.locator('#audio-mute')).to_be_checked()
                        expect(persistence_page.locator('#audio-volume')).to_have_value('35')
                        expect(persistence_page.locator('#audio-status')).to_contain_text(
                            'Web Audio: 無効'
                        )
                        expect(persistence_page.locator('#audio-status')).to_contain_text(
                            '音量: 35% / ミュート ON'
                        )
                        expect(persistence_page.locator('#wav-rate')).to_have_value('44100')
                        expect(persistence_page.locator('#wav-baud')).to_have_value('600')
                        expect(persistence_page.locator('#wav-decode-channel')).to_have_value('right')
                        expect(persistence_page.locator('#name')).to_have_value('LASTNAME')
                        expect(persistence_page.locator('#address')).to_have_value('A000')
                        expect(persistence_page.locator('#kind')).to_have_value('0')
                        expect(persistence_page.locator('#baud')).to_have_value('100')
                        stored_slot = persistence_page.evaluate(
                            "JSON.parse(localStorage.getItem('jr200-web-preferences-v1')).macroSlot"
                        )
                        assert stored_slot == 3, stored_slot
                        expect(persistence_page.locator('#macro-slot')).to_have_value('3')
                        expect(persistence_page.locator('#headerless')).not_to_be_checked()
                        expect(persistence_page.locator('#debug-history-enabled')).to_be_checked()
                        expect(persistence_page.locator('#start')).to_be_enabled()
                        expect(persistence_page.locator('#rom-combined')).to_have_value('')
                        expect(persistence_page.locator('#font')).to_have_value('')
                        expect(persistence_page.locator('#machine-status')).to_contain_text(
                            'CPUは実行していません'
                        )
                        persistence_page.locator('#start').click()
                        expect(persistence_page.locator('#debug-history-enabled')).to_be_checked()
                        expect(persistence_page.locator('#machine-status')).to_contain_text(
                            'font 初期化済み', timeout=10000
                        )
                        persistence_page.locator('#remember-assets').uncheck()
                        persistence_page.locator('#pause-on-focus-loss').uncheck()
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '保存許可を解除し'
                        )
                    finally:
                        persistence_context.close()

                    persistence_context = playwright.chromium.launch_persistent_context(
                        profile, **persistent_options
                    )
                    try:
                        persistence_page = persistence_context.pages[0]
                        persistence_page.on('pageerror', lambda error: errors.append(str(error)))
                        persistence_page.route('**/*', guard)
                        persistence_page.goto(base+'/', wait_until='networkidle')
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '結合ROM: 未選択'
                        )
                        persistence_page.locator(
                            'details.tool-panel',
                            has=persistence_page.locator('#behavior-heading'),
                        ).locator('summary').click()
                        expect(persistence_page.locator('#remember-assets')).not_to_be_checked()
                        expect(persistence_page.locator('#pause-on-focus-loss')).not_to_be_checked()
                        expect(persistence_page.locator('#start')).to_be_disabled()
                        persistence_page.evaluate("""async ([rom, font]) => {
                          const database = await new Promise((resolve, reject) => {
                            const request = indexedDB.open('jr200-web-local-assets', 1);
                            request.onsuccess = () => resolve(request.result);
                            request.onerror = () => reject(request.error);
                          });
                          await new Promise((resolve, reject) => {
                            const transaction = database.transaction('assets', 'readwrite');
                            transaction.objectStore('assets').put({
                              rom: Uint8Array.from(rom).buffer,
                              font: Uint8Array.from(font).buffer,
                            }, 'jr200');
                            transaction.oncomplete = resolve;
                            transaction.onerror = () => reject(transaction.error);
                          });
                          database.close();
                        }""", [list(KEYBOARD_ROM), list(FONT)])
                    finally:
                        persistence_context.close()

                    persistence_context = playwright.chromium.launch_persistent_context(
                        profile, **persistent_options
                    )
                    try:
                        persistence_page = persistence_context.pages[0]
                        persistence_page.on('pageerror', lambda error: errors.append(str(error)))
                        persistence_page.route('**/*', guard)
                        persistence_page.goto(base+'/', wait_until='networkidle')
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '旧保存形式・ファイル名不明（保存済み）'
                        )
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '旧保存形式にはファイル名がない'
                        )
                        expect(persistence_page.locator('#start')).to_be_enabled()
                        persistence_page.locator('#forget-assets').click()
                        expect(persistence_page.locator('#asset-status')).to_contain_text(
                            '保存済みファイルを削除しました'
                        )
                    finally:
                        persistence_context.close()

                def open_panel(heading_id: str) -> None:
                    panel = page.locator(
                        'details.tool-panel',
                        has=page.locator(f'#{heading_id}'),
                    )
                    if panel.get_attribute('open') is None:
                        panel.locator('summary').click()

                expect(page.locator('#status')).to_contain_text('WASM起動済み')
                expect(page.locator('#emulator-notice')).to_contain_text('未起動')
                expect(page.locator('#machine-status')).to_contain_text('CPUは実行していません')
                expect(page.locator('#audio-status')).to_contain_text('Web Audio: 有効')
                expect(page.locator('#audio-status')).to_contain_text('起動操作待ち')
                assert page.evaluate('globalThis.__audioContexts.length') == 0
                expect(page.locator('#virtual-keyboard')).to_have_attribute('aria-disabled', 'true')
                expect(page.locator('.virtual-key[data-key-id="KeyA"]')).to_be_disabled()
                page.locator('#rom-combined').set_input_files({
                    'name':LONG_ROM_NAME,
                    'mimeType':'application/octet-stream',
                    'buffer':KEYBOARD_ROM,
                })
                page.locator('#font').set_input_files({
                    'name':LONG_FONT_NAME,
                    'mimeType':'application/octet-stream',
                    'buffer':FONT[:1024],
                })
                expect(page.locator('#asset-status')).to_contain_text('エラー')
                error_layout = layout_snapshot(page)
                assert error_layout['width'] == 1920 and not error_layout['overlap'], error_layout
                assert error_layout['railScrollWidth'] == error_layout['railClientWidth'], error_layout
                page.locator('#font').set_input_files({
                    'name':LONG_FONT_NAME,
                    'mimeType':'application/octet-stream',
                    'buffer':FONT,
                })
                expect(page.locator('#start')).to_be_enabled()
                page.locator('#start').click()
                expect(page.locator('#emulator-notice')).to_contain_text('CPUを起動')
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                expect(page.locator('#audio-status')).to_contain_text('context running')
                assert page.evaluate('globalThis.__audioContexts.length') == 1
                expect(page.locator('#machine-status')).to_contain_text('font 初期化済み', timeout=10000)
                expect(page.locator('#machine-status')).to_contain_text(
                    re.compile(r'FPS \d+\.\d')
                )
                expect(page.locator('#glyph-status')).to_contain_text('標準文字RAM', timeout=10000)

                open_panel('behavior-heading')
                expect(page.locator('#gamepad-status')).to_contain_text('1P: 未接続')
                expect(page.locator('#gamepad-status')).to_contain_text('2P: 未接続')
                expect(page.locator('#fullscreen')).to_be_enabled()
                page.set_viewport_size({'width':1700, 'height':840})
                page.locator('#screen-scale').select_option('1')
                page.locator('#keyboard-toggle').click()
                manual_scale_screen = page.locator('#screen').bounding_box()
                assert manual_scale_screen is not None
                assert manual_scale_screen['width'] == 320, manual_scale_screen
                assert manual_scale_screen['height'] == 224, manual_scale_screen
                page.locator('#keyboard-toggle').click()
                page.locator('#screen-scale').select_option('auto')
                page.set_viewport_size({'width':1920, 'height':960})
                page.locator('#screen-scale').select_option('1')
                page.locator('#screen-aspect').select_option('video')
                page.locator('#screen-rotation').select_option('90')
                page.locator('#screen-smoothing').check()
                transformed_screen = page.locator('#screen').evaluate("""canvas => {
                  const rect = canvas.getBoundingClientRect();
                  return {
                    width: canvas.width,
                    height: canvas.height,
                    cssWidth: rect.width,
                    cssHeight: rect.height,
                    imageRendering: getComputedStyle(canvas).imageRendering,
                  };
                }""")
                assert transformed_screen['width'] == 224, transformed_screen
                assert transformed_screen['height'] == 320, transformed_screen
                assert abs(transformed_screen['cssWidth'] - 224) < 0.1, transformed_screen
                assert abs(transformed_screen['cssHeight'] - 272) < 0.1, transformed_screen
                assert transformed_screen['imageRendering'] == 'auto', transformed_screen
                page.locator('#screen-smoothing').uncheck()
                page.locator('#screen-rotation').select_option('0')
                page.locator('#screen-aspect').select_option('square')
                page.locator('#screen-scale').select_option('auto')
                restored_screen = page.locator('#screen').bounding_box()
                assert restored_screen is not None
                assert restored_screen['width'] == 960
                assert restored_screen['height'] == 672
                page.locator('#fullscreen').click()
                expect(page.locator('#fullscreen')).to_have_text('全画面を終了')
                assert page.evaluate(
                    "document.fullscreenElement === document.querySelector('#screen-shell')"
                )
                page.locator('#screen').press('Alt+Enter')
                expect(page.locator('#fullscreen')).to_have_text('全画面')
                assert page.evaluate('document.fullscreenElement === null')
                page.locator('#cpu-speed').evaluate("""input => {
                  input.value = '150';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
                expect(page.locator('#cpu-speed-value')).to_have_text('150%')
                expect(page.locator('#machine-status')).to_contain_text('CPU 150%')
                page.locator('#cpu-speed').evaluate("""input => {
                  input.value = '1000';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
                expect(page.locator('#machine-status')).to_contain_text('CPU 1000%')
                page.wait_for_timeout(1200)
                audio_timing = page.locator('#audio-status').text_content() or ''
                ahead_match = re.search(r'先行 (\d+) ms', audio_timing)
                active_match = re.search(r'active (\d+)', audio_timing)
                assert ahead_match and int(ahead_match.group(1)) <= 300, audio_timing
                assert active_match and int(active_match.group(1)) <= 30, audio_timing
                page.locator('#cpu-speed').evaluate("""input => {
                  input.value = '100';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
                page.locator('#ram-expansion-1').check()
                page.locator('#ram-init-pattern').select_option('1')
                expect(page.locator('#memory-config-status')).to_contain_text(
                    '次の起動またはリセットで反映'
                )
                page.locator('#ram-expansion-1').uncheck()
                page.locator('#ram-init-pattern').select_option('0')
                page.evaluate("""() => {
                  const makeButtons = pressed => Array.from({length:16}, (_, index) => ({
                    pressed: pressed.includes(index),
                    value: pressed.includes(index) ? 1 : 0,
                  }));
                  globalThis.__gamepads = [
                    {index:0, id:'Synthetic Standard Pad 1', connected:true,
                     mapping:'standard', axes:[-1,-1], buttons:makeButtons([0])},
                    {index:1, id:'Synthetic Standard Pad 2', connected:true,
                     mapping:'standard', axes:[0,0], buttons:makeButtons([1,13,15])},
                  ];
                  window.dispatchEvent(new Event('gamepadconnected'));
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text(
                    '1P: Synthetic Standard Pad 1 / 標準マッピング / ↑ ← A'
                )
                expect(page.locator('#gamepad-status')).to_contain_text(
                    '2P: Synthetic Standard Pad 2 / 標準マッピング / ↓ → B'
                )
                open_panel('debugger-heading')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-address').fill('C102')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: EA D5')
                page.evaluate("""() => {
                  globalThis.__gamepads = [globalThis.__gamepads[0], null];
                  window.dispatchEvent(new Event('gamepaddisconnected'));
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text('2P: 未接続')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: EA FF')
                page.evaluate("""() => {
                  const buttons = Array.from({length:16}, (_, index) => ({
                    pressed: [1,13,15].includes(index),
                    value: [1,13,15].includes(index) ? 1 : 0,
                  }));
                  globalThis.__gamepads[1] = {
                    index:1, id:'Synthetic Standard Pad 2', connected:true,
                    mapping:'standard', axes:[0,0], buttons,
                  };
                  window.dispatchEvent(new Event('gamepadconnected'));
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text('2P: Synthetic Standard Pad 2')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: EA D5')
                page.evaluate("""() => {
                  globalThis.__gamepads = [null, globalThis.__gamepads[1]];
                  window.dispatchEvent(new Event('gamepaddisconnected'));
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text('1P: Synthetic Standard Pad 2')
                expect(page.locator('#gamepad-status')).to_contain_text('2P: 未接続')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: D5 FF')
                page.evaluate("""() => {
                  globalThis.__gamepads = [];
                  window.dispatchEvent(new Event('gamepaddisconnected'));
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text('1P: 未接続')
                expect(page.locator('#gamepad-status')).to_contain_text('2P: 未接続')
                page.evaluate("""() => {
                  const makeButtons = pressed => Array.from({length:16}, (_, index) => ({
                    pressed: pressed.includes(index),
                    value: pressed.includes(index) ? 1 : 0,
                  }));
                  globalThis.__gamepads = [
                    {index:0, id:'Synthetic Standard Pad 1', connected:true,
                     mapping:'standard', axes:[-1,-1], buttons:makeButtons([0])},
                    {index:1, id:'Synthetic Standard Pad 2', connected:true,
                     mapping:'standard', axes:[0,0], buttons:makeButtons([1,13,15])},
                  ];
                  window.dispatchEvent(new Event('gamepadconnected'));
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text('1P: Synthetic Standard Pad 1')
                expect(page.locator('#gamepad-status')).to_contain_text('2P: Synthetic Standard Pad 2')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: EA D5')
                page.locator('#gamepad-one-button').check()
                page.evaluate("""() => {
                  const makeButtons = pressed => Array.from({length:16}, (_, index) => ({
                    pressed: pressed.includes(index),
                    value: pressed.includes(index) ? 1 : 0,
                  }));
                  globalThis.__gamepads[1].buttons = makeButtons([2,13,15]);
                }""")
                expect(page.locator('#gamepad-status')).to_contain_text(
                    '2P: Synthetic Standard Pad 2 / 標準マッピング / ↓ → A'
                )
                page.evaluate("""() => {
                  const makeButtons = pressed => Array.from({length:16}, (_, index) => ({
                    pressed: pressed.includes(index),
                    value: pressed.includes(index) ? 1 : 0,
                  }));
                  globalThis.__gamepads[1].buttons = makeButtons([1,13,15]);
                }""")
                page.locator('#gamepad-one-button').uncheck()
                expect(page.locator('#gamepad-status')).to_contain_text(
                    '2P: Synthetic Standard Pad 2 / 標準マッピング / ↓ → B'
                )
                page.locator('#forced-joystick').check()
                expect(page.locator('#gamepad-status')).to_contain_text(
                    '1P: 強制ジョイスティックモード'
                )
                page.wait_for_timeout(200)
                page.locator('#debug-memory-address').fill('C100')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 1E')
                page.locator('#debug-memory-address').fill('C102')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: FF D5')
                page.locator('#forced-joystick').uncheck()
                page.wait_for_timeout(150)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: EA D5')
                page.locator('#reset').click()
                expect(page.locator('#machine-status')).to_contain_text(
                    'font 初期化済み', timeout=10000
                )
                page.locator('#debug-memory-address').fill('C100')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 61')

                expect(page.locator('#keyboard-deck')).to_be_hidden()
                page.locator('#keyboard-toggle').click()
                expect(page.locator('#keyboard-deck')).to_be_visible()
                key_a = page.locator('.virtual-key[data-key-id="KeyA"]')
                expect(key_a).to_be_enabled()
                assert key_a.get_attribute('data-code') == '61'
                initial_glyph = key_a.locator('canvas').evaluate("""canvas => {
                  const data = canvas.getContext('2d').getImageData(0, 0, 8, 8).data;
                  return {left: data[3], column4: data[(4 * 4) + 3]};
                }""")
                assert initial_glyph == {'left':0, 'column4':255}, initial_glyph
                initial_screen_glyph = page.locator('#screen').evaluate("""canvas => {
                  const data = canvas.getContext('2d').getImageData(32, 16, 8, 1).data;
                  return {left: data[0], column4: data[4 * 4]};
                }""")
                assert initial_screen_glyph == {'left':0, 'column4':255}, initial_screen_glyph
                border_pixel = page.locator('#screen').evaluate("""canvas =>
                  Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data)
                """)
                assert border_pixel == [255, 0, 0, 255], border_pixel
                accessibility = key_a.evaluate("""key => {
                  return {
                    tag: key.tagName,
                    label: key.getAttribute('aria-label'),
                    pressed: key.getAttribute('aria-pressed'),
                    height: key.getBoundingClientRect().height,
                  };
                }""")
                assert accessibility['tag'] == 'BUTTON' and accessibility['label'] == 'Aキー', accessibility
                assert accessibility['pressed'] == 'false' and accessibility['height'] >= 29, accessibility
                keyboard_rows = page.locator('.keyboard-row').evaluate_all("""rows => rows.map(row =>
                  [...row.querySelectorAll('.virtual-key')].map(key => key.dataset.keyId)
                )""")
                assert keyboard_rows[0][:4] == ['Digit1', 'Digit2', 'Digit3', 'Digit4'], keyboard_rows
                assert keyboard_rows[0][-1] == 'Rubout', keyboard_rows
                assert keyboard_rows[1][-1] == 'Return', keyboard_rows
                assert keyboard_rows[2][-1] == 'RightBracket', keyboard_rows
                assert keyboard_rows[3].count('ModifierShift') == 2, keyboard_rows
                assert keyboard_rows[3][-1] == 'ModifierShift', keyboard_rows
                assert keyboard_rows[4] == ['ModeAnk', 'ModeGraph', 'Space', 'ModeKana'], keyboard_rows
                control_layout = page.locator('#keyboard-control-cluster').evaluate("""cluster => {
                  const box = id => {
                    const rect = cluster.querySelector(`[data-key-id="${id}"]`).getBoundingClientRect();
                    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                            width: rect.width, height: rect.height, center: rect.left + rect.width / 2};
                  };
                  return {
                    ids: [...cluster.querySelectorAll('.virtual-key')].map(key => key.dataset.keyId),
                    breakKey: box('Break'), insert: box('Insert'), deleteKey: box('Delete'),
                    up: box('ArrowUp'), left: box('ArrowLeft'), right: box('ArrowRight'),
                    down: box('ArrowDown'),
                  };
                }""")
                assert control_layout['ids'] == [
                    'Break', 'Insert', 'Delete', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'
                ], control_layout
                for key in ['breakKey', 'insert', 'deleteKey', 'up', 'left', 'right', 'down']:
                    assert control_layout[key]['width'] == 34, control_layout
                    assert control_layout[key]['height'] >= 29, control_layout
                assert control_layout['deleteKey']['left'] - control_layout['insert']['right'] >= 7, control_layout
                assert control_layout['right']['left'] - control_layout['left']['right'] >= 7, control_layout
                assert abs(control_layout['breakKey']['right'] - control_layout['deleteKey']['right']) < 0.5, control_layout
                for centered in ['up', 'down']:
                    pair_center = (control_layout['left']['left'] + control_layout['right']['right']) / 2
                    assert abs(control_layout[centered]['center'] - pair_center) < 0.5, control_layout
                assert control_layout['insert']['top'] - control_layout['breakKey']['bottom'] >= 4, control_layout
                assert control_layout['up']['top'] - control_layout['insert']['bottom'] >= 4, control_layout
                assert control_layout['left']['top'] - control_layout['up']['bottom'] >= 4, control_layout
                assert control_layout['down']['top'] - control_layout['left']['bottom'] >= 4, control_layout
                key_a.focus()
                page.keyboard.press('Shift+Tab')
                page.keyboard.press('Tab')
                expect(key_a).to_be_focused()
                focus_style = key_a.evaluate("""key => {
                  const style = getComputedStyle(key);
                  return {
                    outlineStyle: style.outlineStyle,
                    outlineWidth: parseFloat(style.outlineWidth),
                  };
                }""")
                assert focus_style['outlineStyle'] != 'none' and focus_style['outlineWidth'] >= 2, focus_style

                stable_before = page.evaluate("""() => {
                  globalThis.__virtualKeyNodes = [...document.querySelectorAll('.virtual-key')];
                  const keyboard = document.querySelector('#virtual-keyboard');
                  return {
                    listeners: globalThis.__listenerAdds,
                    nodes: globalThis.__virtualKeyNodes.length,
                    cacheSize: Number(keyboard.dataset.glyphCacheSize),
                    cacheToken: keyboard.dataset.glyphCacheToken,
                  };
                }""")
                page.wait_for_timeout(1200)
                stable_after = page.evaluate("""() => {
                  const nodes = [...document.querySelectorAll('.virtual-key')];
                  const keyboard = document.querySelector('#virtual-keyboard');
                  return {
                    listeners: globalThis.__listenerAdds,
                    nodes: nodes.length,
                    sameNodes: nodes.every((node, index) =>
                      node === globalThis.__virtualKeyNodes[index]),
                    cacheSize: Number(keyboard.dataset.glyphCacheSize),
                    cacheToken: keyboard.dataset.glyphCacheToken,
                  };
                }""")
                assert stable_after == {
                    **stable_before,
                    'sameNodes': True,
                }, (stable_before, stable_after)
                assert 0 < stable_after['cacheSize'] <= stable_after['nodes'], stable_after

                page.locator('#debug-memory-address').fill('C100')
                expect(page.locator('#key-click-enabled')).not_to_be_checked()
                expect(page.locator('#audio-status')).to_contain_text('キークリック: OFF')
                audio_sources_before_key = page.evaluate(
                    'globalThis.__audioContexts[0].sources.length')
                key_a.click()
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 61')
                page.wait_for_function("""start =>
                  globalThis.__audioContexts[0].sources.length > start
                """, arg=audio_sources_before_key, timeout=3000)
                assert page.evaluate("""start =>
                  globalThis.__audioContexts[0].sources.slice(start).every(
                    source => source.buffer?.data.every(sample => sample === 0)
                  )
                """, audio_sources_before_key)
                page.locator(
                    'details.tool-panel', has=page.locator('#audio-heading')
                ).locator('summary').click()
                page.locator('#key-click-enabled').check()
                expect(page.locator('#audio-status')).to_contain_text('キークリック: ON')
                audio_sources_before_key = page.evaluate(
                    'globalThis.__audioContexts[0].sources.length')
                key_a.click()
                page.wait_for_function("""start =>
                  globalThis.__audioContexts[0].sources.slice(start).some(
                    source => source.buffer?.data.some(sample => sample !== 0)
                  )
                """, arg=audio_sources_before_key, timeout=3000)
                page.wait_for_function("""() => {
                  const canvas = document.querySelector('.virtual-key[data-key-id="KeyA"] canvas');
                  const data = canvas.getContext('2d').getImageData(0, 0, 8, 8).data;
                  return data[3] === 255 && data[(4 * 4) + 3] === 0;
                }""", timeout=3000)
                page.wait_for_function("""() => {
                  const canvas = document.querySelector('#screen');
                  const data = canvas.getContext('2d').getImageData(32, 16, 8, 1).data;
                  return data[0] === 255 && data[4 * 4] === 0;
                }""", timeout=3000)

                page.locator('.virtual-key[data-key-id="ModeKana"]').click()
                expect(page.locator('#input-mode-status')).to_contain_text('カナ')
                shift_keys = page.locator('.virtual-key[data-key-id="ModifierShift"]')
                expect(shift_keys).to_have_count(2)
                shift_key = shift_keys.first
                shift_key.click()
                expect(page.locator('#input-mode-status')).to_contain_text('SHIFT保持')
                key_z = page.locator('.virtual-key[data-key-id="KeyZ"]')
                assert key_z.get_attribute('data-code') == 'AF'
                key_z.focus()
                page.keyboard.down('z')
                page.wait_for_timeout(100)
                assert 'is-pressed' in (key_z.get_attribute('class') or '')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: AF')
                page.keyboard.up('z')
                shift_key.click()
                page.locator('.virtual-key[data-key-id="ModeAnk"]').click()
                expect(page.locator('#input-mode-status')).to_contain_text('英数')

                digit_one = page.locator('.virtual-key[data-key-id="Digit1"]')
                digit_one.focus()
                page.keyboard.down('Shift')
                digit_one.click()
                page.keyboard.up('Shift')
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 21')

                page.locator('.virtual-key[data-key-id="ModeGraph"]').click()
                expect(page.locator('#input-mode-status')).to_contain_text('GRAPH')
                assert key_a.get_attribute('data-code') == '91'
                key_a.click()
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 91')
                shift_key.click()
                expect(shift_key).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#input-mode-status')).to_contain_text('SHIFT保持')
                assert key_a.get_attribute('data-code') == 'F1'
                key_a.click()
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: F1')
                shift_key.click()

                ctrl_key = page.locator('.virtual-key[data-key-id="ModifierControl"]')
                shift_key.click()
                key_c = page.locator('.virtual-key[data-key-id="KeyC"]')
                assert key_c.get_attribute('data-code') == 'E4'
                graph_shift_c_glyph = key_c.locator('canvas').evaluate('canvas => canvas.toDataURL()')
                ctrl_key.click()
                expect(ctrl_key).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#input-mode-status')).to_contain_text('CTRL待機')
                graph_bracket = page.locator('.virtual-key[data-key-id="LeftBracket"]')
                assert graph_bracket.get_attribute('data-code') == '1B'
                expect(graph_bracket).to_be_enabled()
                expect(graph_bracket.locator('canvas')).to_be_visible()
                assert key_c.get_attribute('data-code') == '03'
                expect(key_c).not_to_have_class(re.compile(r'\bis-function\b'))
                assert key_c.locator('canvas').evaluate('canvas => canvas.toDataURL()') == graph_shift_c_glyph
                key_c.focus()
                page.keyboard.down('c')
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 03')
                page.keyboard.up('c')
                expect(ctrl_key).to_have_attribute('aria-pressed', 'false')
                expect(page.locator('#input-mode-status')).not_to_contain_text('CTRL待機')
                shift_key.click()

                page.locator('#screen').focus()
                page.keyboard.down('Control')
                page.keyboard.down('c')
                page.wait_for_timeout(100)
                page.keyboard.up('c')
                page.keyboard.up('Control')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 03')

                page.locator('.virtual-key[data-key-id="ModeAnk"]').click()
                expect(page.locator('#input-mode-status')).to_contain_text('英数')
                ctrl_key.click()
                for key_id, legend in [
                    ('Digit1', 'CLS'), ('Digit3', 'SAVE'), ('KeyA', 'AUTO'),
                    ('KeyC', 'BREAK'), ('At', 'RNDM'), ('Underscore', 'PICK'),
                ]:
                    key = page.locator(f'.virtual-key[data-key-id="{key_id}"]')
                    assert key.locator('.key-function').text_content().replace('\n', '') == legend
                    expect(key.locator('.key-function')).to_be_visible()
                    expect(key.locator('canvas')).to_be_hidden()
                    dimensions = key.evaluate('''node => ({
                      scroll: node.scrollWidth, client: node.clientWidth,
                      text: node.querySelector('.key-function').getBoundingClientRect().width,
                      font: parseFloat(getComputedStyle(node.querySelector('.key-function')).fontSize),
                    })''')
                    assert dimensions['scroll'] <= dimensions['client'], (key_id, dimensions)
                    assert dimensions['font'] >= 7, (key_id, dimensions)
                ctrl_key.click()
                expect(key_a.locator('.key-function')).to_be_hidden()
                expect(key_a.locator('canvas')).to_be_visible()
                page.locator('#screen').focus()
                page.keyboard.down('Control')
                page.keyboard.down('a')
                page.keyboard.up('a')
                page.keyboard.up('Control')
                page.wait_for_timeout(400)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 20')

                expect(ctrl_key).to_have_attribute('aria-pressed', 'false')
                page.wait_for_timeout(600)
                page.locator('#screen').focus()
                page.keyboard.down('x')
                page.wait_for_timeout(100)
                page.keyboard.up('x')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 78')
                page.locator('#screen').focus()
                page.keyboard.down('Control')
                ctrl_three = page.locator('#screen').evaluate("""canvas => {
                  const down = new KeyboardEvent('keydown', {
                    bubbles:true, cancelable:true, code:'Digit3', key:'3',
                    ctrlKey:true, isComposing:true,
                  });
                  canvas.dispatchEvent(down);
                  canvas.dispatchEvent(new KeyboardEvent('keyup', {
                    bubbles:true, code:'Digit3', key:'3', ctrlKey:true,
                    isComposing:true,
                  }));
                  return {
                    isComposing: down.isComposing,
                    defaultPrevented: down.defaultPrevented,
                  };
                }""")
                page.keyboard.up('Control')
                assert ctrl_three == {
                    'isComposing': True,
                    'defaultPrevented': True,
                }, ctrl_three
                page.wait_for_timeout(400)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 20')

                page.locator('.virtual-key[data-key-id="ModeAnk"]').click()
                expect(page.locator('#input-mode-status')).to_contain_text('英数')
                right_bracket = page.locator('.virtual-key[data-key-id="RightBracket"]')
                yen_key = page.locator('.virtual-key[data-key-id="Yen"]')
                page.locator('#screen').evaluate("""canvas => canvas.dispatchEvent(
                  new KeyboardEvent('keydown', {bubbles:true, code:'Backslash', key:']'})
                )""")
                expect(right_bracket).to_have_attribute('aria-pressed', 'true')
                expect(yen_key).to_have_attribute('aria-pressed', 'false')
                page.wait_for_timeout(100)
                page.locator('#screen').evaluate("""canvas => canvas.dispatchEvent(
                  new KeyboardEvent('keyup', {bubbles:true, code:'Backslash', key:']'})
                )""")
                page.wait_for_timeout(100)
                expect(right_bracket).to_have_attribute('aria-pressed', 'false')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 5D')
                for key_id, expected_code in (
                    ('ArrowLeft', '1D'),
                    ('ArrowRight', '1C'),
                    ('Insert', '13'),
                    ('Delete', '7F'),
                ):
                    page.locator(f'.virtual-key[data-key-id="{key_id}"]').click()
                    page.wait_for_timeout(100)
                    page.locator('#debug-memory-read').click()
                    expect(page.locator('#debug-memory')).to_contain_text(
                        f'C100: {expected_code}'
                    )
                key_a.focus()
                page.keyboard.press('PageUp')
                expect(page.locator('#input-mode-status')).to_contain_text('GRAPH')
                page.keyboard.press('PageDown')
                expect(page.locator('#input-mode-status')).to_contain_text('英数')
                page.keyboard.press('End')
                expect(page.locator('#input-mode-status')).to_contain_text('カナ')
                page.locator('.virtual-key[data-key-id="ModeAnk"]').click()

                open_panel('input-assist-heading')
                page.locator('#quick-type-text').fill('AB')
                page.locator('#quick-type-start').click()
                expect(page.locator('#quick-type-status')).to_contain_text(
                    '入力が完了しました', timeout=5000
                )
                page.locator('#debug-memory-address').fill('C100')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 42')
                page.locator('#quick-type-interval').evaluate("""input => {
                  input.value = '100';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
                page.locator('#quick-type-text').fill('A' * 30)
                page.locator('#quick-type-start').click()
                page.locator('#screen').press('Escape')
                expect(page.locator('#quick-type-status')).to_contain_text('入力を停止しました')
                page.locator('#quick-type-interval').evaluate("""input => {
                  input.value = '30';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
                page.locator('#macro-text').fill('Z\\r')
                page.locator('#macro-save').click()
                expect(page.locator('#macro-status')).to_contain_text('マクロを保存')
                assert page.evaluate("""() => JSON.parse(
                  localStorage.getItem('jr200-web-preferences-v1')).macros[0]
                """) == 'Z\\r'
                page.locator('#macro-run').click()
                expect(page.locator('#quick-type-status')).to_contain_text(
                    '入力が完了しました', timeout=5000
                )
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 0D')

                page.locator('.virtual-key[data-key-id="ModeKana"]').click()
                page.locator('#romaji-kana').check()
                page.locator('#screen').focus()
                page.keyboard.press('k')
                expect(page.locator('#input-mode-status')).to_contain_text('ローマ字 K')
                page.keyboard.press('a')
                page.wait_for_timeout(300)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: B6')
                page.locator('#screen').focus()
                page.keyboard.press('k')
                expect(page.locator('#input-mode-status')).to_contain_text('ローマ字 K')
                page.keyboard.press('k')
                page.wait_for_timeout(300)
                expect(page.locator('#input-mode-status')).to_contain_text('ローマ字 K')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: AF')
                page.locator('#screen').focus()
                page.keyboard.press('a')
                page.wait_for_timeout(300)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: B6')
                page.locator('#romaji-kana').uncheck()
                page.locator('.virtual-key[data-key-id="ModeAnk"]').click()

                page.locator('#debug-memory-address').fill('C101')
                page.locator('.virtual-key[data-key-id="Break"]').click()
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C101: 42')
                expect(page.locator('#input-mode-status')).to_contain_text('英数')
                page.locator('#debug-memory-address').fill('C100')

                key_a.focus()
                page.keyboard.down('a')
                key_a.dispatch_event('pointerdown', {'pointerId':7, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.keyboard.up('a')
                page.wait_for_timeout(60)
                assert 'is-pressed' in (key_a.get_attribute('class') or '')
                key_a.dispatch_event('pointerup', {'pointerId':7, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.wait_for_function("""() => !document.querySelector('.virtual-key[data-key-id="KeyA"]').classList.contains('is-pressed')""", timeout=1000)

                key_a.dispatch_event('pointerdown', {'pointerId':10, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                key_a.dispatch_event('pointerdown', {'pointerId':11, 'pointerType':'touch', 'button':0, 'isPrimary':False})
                expect(key_a).to_have_attribute('aria-pressed', 'true')
                key_a.dispatch_event('pointerup', {'pointerId':10, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                expect(key_a).to_have_attribute('aria-pressed', 'true')
                key_a.dispatch_event('pointerup', {'pointerId':11, 'pointerType':'touch', 'button':0, 'isPrimary':False})
                page.wait_for_function("""() => document.querySelector('.virtual-key[data-key-id="KeyA"]').getAttribute('aria-pressed') === 'false'""", timeout=1000)

                key_a.dispatch_event('pointerdown', {'pointerId':12, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                key_a.dispatch_event('lostpointercapture', {'pointerId':12, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.wait_for_function("""() => !document.querySelector('.virtual-key[data-key-id="KeyA"]').classList.contains('is-pressed')""", timeout=1000)

                key_box = key_a.bounding_box()
                assert key_box is not None
                page.mouse.move(key_box['x'] + key_box['width'] / 2, key_box['y'] + key_box['height'] / 2)
                page.mouse.down()
                page.mouse.move(key_box['x'] - 30, key_box['y'] - 30)
                page.mouse.up()
                page.wait_for_function("""() => !document.querySelector('.virtual-key[data-key-id="KeyA"]').classList.contains('is-pressed')""", timeout=1000)

                key_z.dispatch_event('pointerdown', {'pointerId':8, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                assert 'is-pressed' in (key_z.get_attribute('class') or '')
                key_z.dispatch_event('pointercancel', {'pointerId':8, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.wait_for_function("""() => !document.querySelector('.virtual-key[data-key-id="KeyZ"]').classList.contains('is-pressed')""", timeout=1000)

                key_z.dispatch_event('pointerdown', {'pointerId':9, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.locator('#keyboard-toggle').click()
                expect(page.locator('#keyboard-deck')).to_be_hidden()
                assert 'is-pressed' not in (key_z.get_attribute('class') or '')
                hidden_screen = page.locator('#screen').bounding_box()
                assert hidden_screen is not None
                assert hidden_screen['width'] == 960 and hidden_screen['height'] == 672, hidden_screen
                assert hidden_screen['y'] + hidden_screen['height'] <= 960, hidden_screen
                page.locator('#keyboard-toggle').click()
                expect(page.locator('#keyboard-deck')).to_be_visible()
                visible_screen = page.locator('#screen').bounding_box()
                assert visible_screen is not None
                assert visible_screen['width'] == 960 and visible_screen['height'] == 672, visible_screen

                page.locator('#keyboard-toggle').focus()
                page.keyboard.press('Enter')
                expect(page.locator('#keyboard-deck')).to_be_hidden()
                page.keyboard.press('Enter')
                expect(page.locator('#keyboard-deck')).to_be_visible()

                shift_key.click()
                key_z.dispatch_event('pointerdown', {'pointerId':13, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                other_page = page.context.new_page()
                other_page.goto('about:blank')
                other_page.bring_to_front()
                page.wait_for_timeout(100)
                page.bring_to_front()
                # Headless Chrome does not emit a window blur when switching its
                # synthetic tabs, so exercise the same registered browser event.
                page.evaluate("window.dispatchEvent(new Event('blur'))")
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                expect(page.locator('#input-mode-status')).not_to_contain_text('SHIFT保持')
                expect(page.locator('#gamepad-status')).to_contain_text('入力をニュートラル')
                assert 'is-pressed' not in (key_z.get_attribute('class') or '')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-address').fill('C102')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: FF FF')
                page.evaluate("window.dispatchEvent(new Event('focus'))")
                expect(page.locator('#gamepad-status')).not_to_contain_text('入力をニュートラル')
                page.wait_for_timeout(150)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C102: EA D5')
                page.locator('#debug-memory-address').fill('C100')
                other_page.close()

                open_panel('behavior-heading')
                expect(page.locator('#pause-on-focus-loss')).not_to_be_checked()
                page.locator('#pause-on-focus-loss').check()
                shift_key.click()
                key_z.dispatch_event('pointerdown', {'pointerId':15, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.evaluate("window.dispatchEvent(new Event('blur'))")
                expect(page.locator('#machine-status')).to_contain_text('一時停止')
                expect(page.locator('#input-mode-status')).not_to_contain_text('SHIFT保持')
                assert 'is-pressed' not in (key_z.get_attribute('class') or '')
                page.evaluate("window.dispatchEvent(new Event('focus'))")
                page.locator('#pause').click()
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                page.locator('#pause-on-focus-loss').uncheck()

                shift_key.click()
                key_z.dispatch_event('pointerdown', {'pointerId':14, 'pointerType':'touch', 'button':0, 'isPrimary':True})
                page.locator('#reset').click()
                expect(page.locator('#machine-status')).to_contain_text('font 初期化済み', timeout=10000)
                expect(page.locator('#input-mode-status')).to_have_text('入力モード: 英数')
                assert 'is-pressed' not in (key_z.get_attribute('class') or '')
                generation_before_replace = int(re.search(
                    r'generation (\d+)',
                    page.locator('#glyph-status').inner_text(),
                ).group(1))

                page.locator('#font').set_input_files({
                    'name':LONG_FONT_NAME,
                    'mimeType':'application/octet-stream',
                    'buffer':FONT_ALTERNATE,
                })
                page.locator('#start').click()
                expect(page.locator('#glyph-status')).to_contain_text('標準文字RAM', timeout=10000)
                page.wait_for_function("""() => {
                  const canvas = document.querySelector('.virtual-key[data-key-id="KeyA"] canvas');
                  const data = canvas.getContext('2d').getImageData(0, 0, 8, 8).data;
                  return data[(1 * 4) + 3] === 255 && data[(4 * 4) + 3] === 0;
                }""", timeout=3000)
                page.wait_for_function("""() => {
                  const canvas = document.querySelector('#screen');
                  const data = canvas.getContext('2d').getImageData(32, 16, 8, 1).data;
                  return data[1 * 4] === 255 && data[4 * 4] === 0;
                }""", timeout=3000)
                generation_after_replace = int(re.search(
                    r'generation (\d+)',
                    page.locator('#glyph-status').inner_text(),
                ).group(1))
                assert generation_after_replace > generation_before_replace
                page.locator('#reset').click()
                expect(page.locator('#glyph-status')).to_contain_text('標準文字RAM', timeout=10000)
                generation_after_reset = int(re.search(
                    r'generation (\d+)',
                    page.locator('#glyph-status').inner_text(),
                ).group(1))
                assert generation_after_reset > generation_after_replace
                reset_glyph = key_a.locator('canvas').evaluate("""canvas => {
                  const data = canvas.getContext('2d').getImageData(0, 0, 8, 8).data;
                  return {column1: data[(1 * 4) + 3], column4: data[(4 * 4) + 3]};
                }""")
                assert reset_glyph == {'column1':255, 'column4':0}, reset_glyph

                page.locator('#debug-memory-address').fill('C100')
                page.locator('#debug-memory-read').click()
                memory_before_form = page.locator('#debug-memory').inner_text().splitlines()[0]
                open_panel('pack-heading')
                page.locator('#name').fill('FORM')
                page.locator('#name').focus()
                page.keyboard.press('a')
                assert page.locator('#name').input_value() == 'FORMa'
                page.keyboard.press(('Meta' if sys.platform == 'darwin' else 'Control') + '+A')
                page.keyboard.type('X')
                assert page.locator('#name').input_value() == 'X'
                page.locator('#debug-memory-read').click()
                assert page.locator('#debug-memory').inner_text().splitlines()[0] == memory_before_form

                page.locator('#rom-combined').set_input_files({'name':'synthetic.rom','mimeType':'application/octet-stream','buffer':bytes(ROM)})
                page.locator('#start').click()
                expect(page.locator('#emulator-notice')).to_contain_text('CPUを起動')
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                expect(page.locator('#audio-status')).to_contain_text('context running')
                expect(page.locator('#audio-status')).to_contain_text('core 44100 Hz / output 48000 Hz')
                expect(page.locator('#audio-status')).to_contain_text('予約済み:')
                page.wait_for_function(
                    '() => globalThis.__audioContexts[0]?.sources.length > 0',
                    timeout=2000,
                )
                assert page.evaluate('globalThis.__audioContexts[0].sources.length') > 0

                def status_integer(selector: str, pattern: str) -> int:
                    text = page.locator(selector).text_content() or ''
                    match = re.search(pattern, text)
                    if not match:
                        raise AssertionError((selector, pattern, text))
                    return int(match.group(1))

                page.wait_for_timeout(600)
                visible_start = status_integer('#machine-status', r'cycles (\d+)')
                visible_underrun_start = status_integer('#audio-status', r'underrun (\d+)')
                page.wait_for_timeout(1800)
                visible_end = status_integer('#machine-status', r'cycles (\d+)')
                visible_underrun_end = status_integer('#audio-status', r'underrun (\d+)')
                page.locator('#keyboard-toggle').click()
                expect(page.locator('#keyboard-deck')).to_be_hidden()
                hidden_start = status_integer('#machine-status', r'cycles (\d+)')
                hidden_underrun_start = status_integer('#audio-status', r'underrun (\d+)')
                page.wait_for_timeout(1800)
                hidden_end = status_integer('#machine-status', r'cycles (\d+)')
                hidden_underrun_end = status_integer('#audio-status', r'underrun (\d+)')
                page.locator('#keyboard-toggle').click()
                expect(page.locator('#keyboard-deck')).to_be_visible()
                performance = {
                    'visibleCycles': visible_end - visible_start,
                    'hiddenCycles': hidden_end - hidden_start,
                    'visibleUnderruns': visible_underrun_end - visible_underrun_start,
                    'hiddenUnderruns': hidden_underrun_end - hidden_underrun_start,
                }
                assert performance['visibleCycles'] >= 500_000, performance
                assert performance['hiddenCycles'] >= 500_000, performance
                cycle_ratio = performance['visibleCycles'] / performance['hiddenCycles']
                assert 0.5 <= cycle_ratio <= 2.0, (cycle_ratio, performance)
                assert performance['visibleUnderruns'] == 0, performance
                assert performance['hiddenUnderruns'] == 0, performance
                expect(page.locator('#audio-status')).to_contain_text('core overflow 0')
                open_panel('audio-heading')
                page.locator('#audio-mute').check()
                expect(page.locator('#audio-status')).to_contain_text('ミュート ON')
                assert page.evaluate('globalThis.__audioContexts[0].gain.gain.value') == 0
                page.locator('#audio-mute').uncheck()
                page.evaluate("window.dispatchEvent(new Event('blur'))")
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                expect(page.locator('#audio-status')).to_contain_text('context running')
                page.evaluate("window.dispatchEvent(new Event('focus'))")
                page.locator('#pause').click()
                expect(page.locator('#machine-status')).to_contain_text('一時停止')
                expect(page.locator('#audio-status')).to_contain_text('context suspended')
                page.locator('#pause').click()
                expect(page.locator('#machine-status')).to_contain_text('実行中')
                expect(page.locator('#audio-status')).to_contain_text('context running')
                page.locator('#pause').click()
                expect(page.locator('#machine-status')).to_contain_text('一時停止')
                expect(page.locator('#audio-status')).to_contain_text('context suspended')

                open_panel('debugger-heading')
                page.locator('#debug-history-enabled').check()
                page.locator('#debug-breakpoint-address').fill('E00F')
                page.locator('#debug-add-breakpoint').click()
                expect(page.locator('#debug-breakpoints')).to_contain_text('$E00F')
                page.locator('#reset').click()
                expect(page.locator('#machine-status')).to_contain_text('breakpoint')
                expect(page.locator('#debug-registers')).to_contain_text('PC $E00F')
                page.locator('#debug-memory-address').fill('C100')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 2A')
                page.locator('#debug-step').click()
                expect(page.locator('#machine-status')).to_contain_text('step')
                expect(page.locator('#debug-registers')).to_contain_text('PC $E00F')
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
                with page.expect_download() as dump_event:
                    page.locator('#debug-memory-save').click()
                dump_download = dump_event.value
                assert dump_download.suggested_filename == 'dump.bin'
                with tempfile.TemporaryDirectory() as directory:
                    dump_output = Path(directory) / 'dump.bin'
                    dump_download.save_as(dump_output)
                    assert dump_output.stat().st_size == 65536
                expect(page.locator('#debug-memory')).to_contain_text('65536バイト')
                page.locator('#audio-disable').click()
                expect(page.locator('#audio-status')).to_contain_text('Web Audio: 無効')
                expect(page.locator('#audio-status')).to_contain_text('context suspended')
                open_panel('inspect-heading')
                page.locator('#cjr').set_input_files({'name':'golden.cjr','mimeType':'application/octet-stream','buffer':GOLDEN})
                expect(page.locator('#result')).to_contain_text('payloadBytes')
                summary=json.loads(page.locator('#result').inner_text())
                assert summary['payloadBytes']==1 and summary['firstAddress']==0x7000
                assert summary['hardwareVerified'] is False and summary['nameAscii']=='X'
                with page.expect_download() as wav_event:
                    page.locator('#wav-create').click()
                wav_download=wav_event.value
                assert wav_download.suggested_filename=='golden-2400baud-48000Hz.wav'
                with tempfile.TemporaryDirectory() as directory:
                    wav_output=Path(directory)/'golden.wav'
                    wav_download.save_as(wav_output)
                    wav_bytes=wav_output.read_bytes()
                    assert len(wav_bytes)==367084
                    assert wav_bytes[:4]==b'RIFF' and wav_bytes[8:16]==b'WAVEfmt '
                    assert int.from_bytes(wav_bytes[4:8],'little')==len(wav_bytes)-8
                    assert int.from_bytes(wav_bytes[20:22],'little')==1
                    assert int.from_bytes(wav_bytes[22:24],'little')==1
                    assert int.from_bytes(wav_bytes[24:28],'little')==48000
                    assert int.from_bytes(wav_bytes[34:36],'little')==16
                expect(page.locator('#wav-status')).to_contain_text('mono 16-bit / 2400 baud')
                expect(page.locator('#wav-status')).to_contain_text('P12で未検証')
                page.locator('#wav-decode-input').set_input_files({'name':'roundtrip.wav','mimeType':'audio/wav','buffer':wav_bytes})
                expect(page.locator('#wav-decode-run')).to_be_enabled()
                page.locator('#wav-decode-run').click()
                expect(page.locator('#wav-decode-status')).to_contain_text('"verified": true')
                decode_report=json.loads(page.locator('#wav-decode-status').inner_text())
                assert decode_report['ok'] is True
                assert decode_report['diagnostics']['candidateBytes']==len(GOLDEN)
                assert decode_report['rawWavModified'] is False
                assert decode_report['candidateDownloadEnabled'] is False
                assert decode_report['hardwareProvenanceInferred'] is False
                with page.expect_download() as decoded_event:
                    page.locator('#wav-decode-save').click()
                decoded_download=decoded_event.value
                assert decoded_download.suggested_filename=='roundtrip.cjr'
                with tempfile.TemporaryDirectory() as directory:
                    decoded_output=Path(directory)/'decoded.cjr'
                    decoded_download.save_as(decoded_output)
                    assert decoded_output.read_bytes()==GOLDEN
                silent_wav=bytearray(wav_bytes)
                silent_wav[44:]=bytes(len(silent_wav)-44)
                page.locator('#wav-decode-input').set_input_files({'name':'silence.wav','mimeType':'audio/wav','buffer':bytes(silent_wav)})
                page.locator('#wav-decode-run').click()
                expect(page.locator('#wav-decode-status')).to_contain_text('"errorCode": 17')
                expect(page.locator('#wav-decode-save')).to_be_disabled()
                open_panel('tape-heading')
                expect(page.locator('#tape-monitor-enabled')).to_be_checked()
                expect(page.locator('#tape-monitor-volume-value')).to_have_text('25%')
                expect(page.locator('#tape-status')).to_contain_text('ロードモニター: ON / 25%')
                page.locator('#tape-cjr').set_input_files({'name':'golden.cjr','mimeType':'application/octet-stream','buffer':GOLDEN})
                expect(page.locator('#tape-mount-state')).to_have_attribute('data-state', 'pending')
                expect(page.locator('#tape-mount-state')).to_contain_text('golden.cjr（未マウント）')
                expect(page.locator('#tape-mount')).to_have_class(re.compile(r'\bis-pending\b'))
                expect(page.locator('#tape-status')).to_contain_text('選択検査: マシン語')
                assert page.locator('#tape-run-address').count() == 0
                assert page.locator('#tape-auto-run').count() == 0
                expect(page.locator('#tape-quick-load')).to_be_enabled()
                page.evaluate("""() => {
                  window.__quickLoadOutcome = null;
                  const status = document.querySelector('#tape-status');
                  new MutationObserver(records => {
                    for (const record of records) {
                      for (const node of record.addedNodes) {
                        const value = node.textContent || '';
                        if (value.includes('高速ロードしました')) window.__quickLoadOutcome = 'success';
                        if (value.includes('高速ロードできません')) window.__quickLoadOutcome = 'failure';
                      }
                    }
                  }).observe(status, {childList: true});
                }""")
                page.locator('#tape-quick-load').click()
                for _ in range(100):
                    if page.evaluate('window.__quickLoadOutcome') is not None:
                        break
                    page.wait_for_timeout(100)
                else:
                    raise AssertionError('Quick load produced no completion status')
                assert page.evaluate('window.__quickLoadOutcome') == 'success'
                page.locator('#debug-memory-address').fill('7000')
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('7000: AB')
                expect(page.locator('#tape-mount-state')).to_have_attribute('data-state', 'pending')
                page.locator('#tape-mount').click()
                expect(page.locator('#tape-mount-state')).to_have_attribute('data-state', 'mounted')
                expect(page.locator('#tape-mount-state')).to_contain_text('golden.cjr / マウント済み')
                expect(page.locator('#tape-status')).to_contain_text('状態: 停止')
                expect(page.locator('#tape-status')).to_contain_text('payload 1 bytes')
                expect(page.locator('#tape-status')).to_contain_text('信号位置: 0 /')
                page.locator('#tape-cjr').set_input_files({'name':'replacement.cjr','mimeType':'application/octet-stream','buffer':GOLDEN})
                expect(page.locator('#tape-mount-state')).to_have_attribute('data-state', 'pending')
                expect(page.locator('#tape-mount-state')).to_contain_text('replacement.cjr（未マウント）')
                expect(page.locator('#tape-mount-state')).to_contain_text('現在のマウント: golden.cjr')
                page.locator('#tape-mount').click()
                expect(page.locator('#tape-mount-state')).to_have_attribute('data-state', 'mounted')
                expect(page.locator('#tape-mount-state')).to_contain_text('replacement.cjr / マウント済み')
                page.locator('#tape-monitor-enabled').uncheck()
                expect(page.locator('#tape-status')).to_contain_text('ロードモニター: OFF / 25%')
                page.locator('#tape-monitor-volume').evaluate("""input => {
                  input.value = '40';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }""")
                page.locator('#tape-monitor-enabled').check()
                expect(page.locator('#tape-monitor-volume-value')).to_have_text('40%')
                expect(page.locator('#tape-status')).to_contain_text('ロードモニター: ON / 40%')
                page.locator('#tape-rewind').click()
                expect(page.locator('#tape-status')).to_contain_text('信号位置: 0 /')
                expect(page.locator('#tape-status')).not_to_contain_text('巻戻しできません')
                page.locator('#tape-eject').click()
                expect(page.locator('#tape-status')).to_contain_text('状態: 取出し済み')
                expect(page.locator('#tape-mount-state')).to_have_attribute('data-state', 'pending')
                page.locator('#tape-cjr').set_input_files({'name':'special.cjr','mimeType':'application/octet-stream','buffer':bytes(SPECIAL)})
                expect(page.locator('#tape-status')).to_contain_text('対応しないCJR')
                page.locator('#tape-mount').click()
                expect(page.locator('#tape-status')).to_contain_text('状態: エラー')
                expect(page.locator('#tape-status')).to_contain_text('only standard BASIC and machine-code CJR')
                page.locator('#tape-record').click()
                expect(page.locator('#tape-status')).to_contain_text('状態: 録音待機')
                expect(page.locator('#tape-status')).to_contain_text('SAVEまたはMSAVE')
                page.locator('#debug-refresh').click()
                expect(page.locator('#debug-history-status')).to_contain_text('命令履歴 256 / 256')
                busy_layout = layout_snapshot(page)
                assert busy_layout['width'] == 1920 and busy_layout['height'] == 960, busy_layout
                assert busy_layout['railScrollWidth'] == busy_layout['railClientWidth'], busy_layout
                assert busy_layout['railScrollHeight'] > busy_layout['railClientHeight'], busy_layout
                assert not busy_layout['overlap'], busy_layout
                page.locator('#tape-eject').click()
                for name in ['LICENSE.txt','LICENSES/VJR200.txt','LICENSES/MAME_BSD-3-Clause.txt','THIRD_PARTY_NOTICES.md']:
                    result=page.request.get(base+'/'+name)
                    assert result.ok and len(result.body())>100, name
                open_panel('pack-heading')
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
                final_layout = layout_snapshot(page)
                assert final_layout['width'] == 1920 and final_layout['height'] == 960, final_layout
                assert final_layout['railScrollWidth'] == final_layout['railClientWidth'], final_layout
                assert not final_layout['overlap'], final_layout
                assert not errors, errors
                assert not external, external
                print('PASS Chromium: Full HD/DPR and Windows-parity display settings, quick type, macros, romaji-kana, gamepad mapping/forced mode, native AudioContext lifecycle, cassette controls/quick load, memory dump, debugger, CJR/WAV tools, no external requests')
                print('Browser:',browser.version)
                print('Performance:', json.dumps(performance, sort_keys=True))
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close(); worker.join(timeout=2)

if __name__=='__main__':
    main()
