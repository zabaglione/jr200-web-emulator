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
        emit(0x86, value, 0xb7, 0xc8, 0x03)  # LDAA #value; STAA $C803
        emit(0x4f, 0xb7, 0xc8, 0x03)         # CLRA; STAA $C803
        emit(0x86, value, 0xb7, 0xc8, 0x03)

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
    for _ in range(2):
        pulse(0x01)
        wait_for_keycode()
        emit(0xb6, 0xc8, 0x01, 0xb6, 0xc8, 0x1c)
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
                    globalThis.__audioContexts = [];
                    class FakeGain {
                      constructor(){ this.gain={value:1,setValueAtTime:value=>{this.gain.value=value;}}; }
                      connect(){}
                    }
                    class FakeSource {
                      constructor(context){ this.context=context; this.onended=null; }
                      connect(){}
                      disconnect(){}
                      start(time){ this.startTime=time; this.context.sources.push(this); }
                      stop(){ this.onended?.(); }
                    }
                    class FakeAudioContext {
                      constructor(){ this.state='suspended'; this.sampleRate=48000; this.currentTime=1; this.destination={}; this.sources=[]; this.listeners=[]; globalThis.__audioContexts.push(this); }
                      createGain(){ this.gain=new FakeGain(); return this.gain; }
                      createBuffer(_channels,length,sampleRate){ const data=new Float32Array(length); return {length,sampleRate,getChannelData:()=>data}; }
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

                def layout_snapshot(target):
                    return target.evaluate("""() => {
                      const root = document.documentElement;
                      const screen = document.querySelector('#screen').getBoundingClientRect();
                      const keyboard = document.querySelector('#keyboard-deck').getBoundingClientRect();
                      const rail = document.querySelector('.utility-rail');
                      const railRect = rail.getBoundingClientRect();
                      const machine = document.querySelector('.machine-stage').getBoundingClientRect();
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
                        screenBottom: screen.bottom,
                        imageRendering: getComputedStyle(document.querySelector('#screen')).imageRendering,
                        keyboardHeight: keyboard.height,
                        keyboardBottom: keyboard.bottom,
                        minKeyHeight: Math.min(...keyHeights),
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
                    assert layout['keyboardHeight'] >= 150, layout
                    assert layout['minKeyHeight'] >= 44, layout
                    assert 320 <= layout['railWidth'] <= 400, layout
                    assert layout['railScrollWidth'] == layout['railClientWidth'], layout
                    assert not layout['overlap'], layout
                    assert layout['imageRendering'] in ('pixelated', 'crisp-edges'), layout
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
                for width, height, scale in (
                    (1920, 960, 2),
                    (1920, 1080, 2),
                    (1536, 768, 1),
                    (1280, 720, 1),
                ):
                    page.set_viewport_size({'width':width, 'height':height})
                    viewport_layout = assert_layout(page, width, height, scale)
                    assert viewport_layout['dpr'] == 1, viewport_layout
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
                    dpr_layout = assert_layout(dpr_page, 1920, 1080, 2)
                    assert dpr_layout['dpr'] == 2, dpr_layout
                finally:
                    dpr_context.close()

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
                expect(page.locator('#audio-status')).to_contain_text('自動再生なし')
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
                expect(page.locator('#machine-status')).to_contain_text('font 初期化済み', timeout=10000)
                expect(page.locator('#glyph-status')).to_contain_text('標準文字RAM', timeout=10000)

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
                accessibility = key_a.evaluate("""key => {
                  return {
                    tag: key.tagName,
                    label: key.getAttribute('aria-label'),
                    pressed: key.getAttribute('aria-pressed'),
                    height: key.getBoundingClientRect().height,
                  };
                }""")
                assert accessibility['tag'] == 'BUTTON' and accessibility['label'] == 'Aキー', accessibility
                assert accessibility['pressed'] == 'false' and accessibility['height'] >= 44, accessibility
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

                open_panel('debugger-heading')
                page.locator('#debug-memory-address').fill('C100')
                key_a.click()
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 61')
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
                shift_key = page.locator('.virtual-key[data-key-id="ModifierShift"]')
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
                ctrl_key.click()
                expect(ctrl_key).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#input-mode-status')).to_contain_text('CTRL保持')
                key_c = page.locator('.virtual-key[data-key-id="KeyC"]')
                assert key_c.get_attribute('data-code') == '03'
                key_c.focus()
                page.keyboard.down('c')
                page.wait_for_timeout(100)
                page.locator('#debug-memory-read').click()
                expect(page.locator('#debug-memory')).to_contain_text('C100: 03')
                page.keyboard.up('c')
                ctrl_key.click()

                page.locator('.virtual-key[data-key-id="ModeAnk"]').click()
                expect(page.locator('#input-mode-status')).to_contain_text('英数')
                for key_id, expected_code in (
                    ('ArrowLeft', '1D'),
                    ('ArrowRight', '1C'),
                    ('Insert', '13'),
                    ('Delete', '7F'),
                    ('Home', '0B'),
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
                assert visible_screen['width'] == 640 and visible_screen['height'] == 448, visible_screen

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
                expect(page.locator('#machine-status')).to_contain_text('一時停止')
                expect(page.locator('#input-mode-status')).not_to_contain_text('SHIFT保持')
                assert 'is-pressed' not in (key_z.get_attribute('class') or '')
                other_page.close()
                page.locator('#pause').click()
                expect(page.locator('#machine-status')).to_contain_text('実行中')

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
                page.locator('#audio-enable').click()
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
                page.locator('#tape-cjr').set_input_files({'name':'golden.cjr','mimeType':'application/octet-stream','buffer':GOLDEN})
                page.locator('#tape-mount').click()
                expect(page.locator('#tape-status')).to_contain_text('状態: 停止')
                expect(page.locator('#tape-status')).to_contain_text('payload 1 bytes')
                expect(page.locator('#tape-status')).to_contain_text('通常のカセット入力信号')
                page.locator('#tape-rewind').click()
                expect(page.locator('#tape-status')).to_contain_text('信号位置を先頭')
                page.locator('#tape-eject').click()
                expect(page.locator('#tape-status')).to_contain_text('状態: 取出し済み')
                page.locator('#tape-cjr').set_input_files({'name':'special.cjr','mimeType':'application/octet-stream','buffer':bytes(SPECIAL)})
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
                print('PASS Chromium: Full HD/DPR layout, glyph keyboard/input recovery, Web Audio, cassette, debugger, CJR/WAV tools, no external requests')
                print('Browser:',browser.version)
                print('Performance:', json.dumps(performance, sort_keys=True))
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close(); worker.join(timeout=2)

if __name__=='__main__':
    main()
