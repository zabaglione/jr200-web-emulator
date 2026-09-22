#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Measure one fixed browser scenario against an already staged site.

This probe uses only the synthetic ROM/font fixtures.  It reports browser
cycle throughput and Web Audio underruns; it is not a hardware benchmark.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import threading

from browser_smoke import FONT, ROM


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args: object) -> None:
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--duration-ms", type=int, default=3000)
    parser.add_argument("--chrome", type=Path)
    return parser.parse_args()


def status_number(text: str, pattern: str) -> int:
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError(f"Could not match {pattern!r} in {text!r}")
    return int(match.group(1))


def main() -> None:
    from playwright.sync_api import sync_playwright, expect

    args = parse_args()
    site = args.site.resolve()
    if not (site / "jr200_codec.wasm").is_file():
        raise SystemExit(f"Staged WASM was not found under {site}")
    if args.duration_ms < 1000 or args.duration_ms > 30000:
        raise SystemExit("--duration-ms must be between 1000 and 30000")

    handler = functools.partial(QuietHandler, directory=str(site))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    base = f"http://127.0.0.1:{server.server_port}"
    external: list[str] = []
    errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            executable = args.chrome or (
                Path(os.environ["CHROMIUM_EXECUTABLE"])
                if os.environ.get("CHROMIUM_EXECUTABLE")
                else None
            )
            if executable is None:
                discovered = shutil.which("chromium")
                executable = Path(discovered) if discovered else None
            options: dict[str, object] = {"headless": True}
            if executable:
                options["executable_path"] = str(executable)
            browser = playwright.chromium.launch(**options)
            try:
                page = browser.new_page(viewport={"width": 1920, "height": 960})
                page.add_init_script(
                    """
                    globalThis.__audioContexts = [];
                    class FakeGain {
                      constructor() {
                        this.gain = {value: 1, setValueAtTime: value => {
                          this.gain.value = value;
                        }};
                      }
                      connect() {}
                    }
                    class FakeSource {
                      constructor(context) {
                        this.context = context;
                        this.buffer = null;
                        this.onended = null;
                        this.timer = 0;
                      }
                      connect() {}
                      disconnect() {}
                      start(time) {
                        const duration = this.buffer
                          ? this.buffer.length / this.buffer.sampleRate
                          : 0;
                        const delay = Math.max(0, time + duration - this.context.currentTime);
                        this.timer = setTimeout(() => this.onended?.(), delay * 1000);
                        this.context.sources.push(this);
                      }
                      stop() {
                        clearTimeout(this.timer);
                        this.onended?.();
                      }
                    }
                    class FakeAudioContext {
                      constructor() {
                        this.state = 'suspended';
                        this.sampleRate = 48000;
                        this.startedAt = performance.now();
                        this.destination = {};
                        this.sources = [];
                        this.listeners = [];
                        globalThis.__audioContexts.push(this);
                      }
                      get currentTime() {
                        return (performance.now() - this.startedAt) / 1000;
                      }
                      createGain() { this.gain = new FakeGain(); return this.gain; }
                      createBuffer(_channels, length, sampleRate) {
                        const data = new Float32Array(length);
                        return {length, sampleRate, getChannelData: () => data};
                      }
                      createBufferSource() { return new FakeSource(this); }
                      addEventListener(name, listener) {
                        if (name === 'statechange') this.listeners.push(listener);
                      }
                      async resume() {
                        this.state = 'running';
                        this.listeners.forEach(listener => listener());
                      }
                      async suspend() {
                        this.state = 'suspended';
                        this.listeners.forEach(listener => listener());
                      }
                    }
                    globalThis.AudioContext = FakeAudioContext;
                    """
                )
                page.on("pageerror", lambda error: errors.append(str(error)))

                def guard(route) -> None:
                    if route.request.url.startswith(base + "/"):
                        route.continue_()
                    else:
                        external.append(route.request.url)
                        route.abort()

                page.route("**/*", guard)
                page.goto(base + "/", wait_until="networkidle")
                page.locator("#rom-combined").set_input_files(
                    {
                        "name": "performance.rom",
                        "mimeType": "application/octet-stream",
                        "buffer": bytes(ROM),
                    }
                )
                page.locator("#font").set_input_files(
                    {
                        "name": "performance-font.bin",
                        "mimeType": "application/octet-stream",
                        "buffer": FONT,
                    }
                )
                page.locator("#start").click()
                expect(page.locator("#machine-status")).to_contain_text("実行中")
                page.locator("#audio-enable").click()
                expect(page.locator("#audio-status")).to_contain_text("context running")
                page.wait_for_timeout(1000)

                start_cycles = status_number(
                    page.locator("#machine-status").text_content() or "",
                    r"cycles (\d+)",
                )
                start_underruns = status_number(
                    page.locator("#audio-status").text_content() or "",
                    r"underrun (\d+)",
                )
                page.wait_for_timeout(args.duration_ms)
                end_cycles = status_number(
                    page.locator("#machine-status").text_content() or "",
                    r"cycles (\d+)",
                )
                audio_status = page.locator("#audio-status").text_content() or ""
                end_underruns = status_number(audio_status, r"underrun (\d+)")
                core_overflow = status_number(audio_status, r"core overflow (\d+)")
                if errors or external:
                    raise RuntimeError({"pageErrors": errors, "externalRequests": external})
                print(
                    json.dumps(
                        {
                            "browser": browser.version,
                            "viewport": [1920, 960],
                            "dpr": page.evaluate("devicePixelRatio"),
                            "durationMs": args.duration_ms,
                            "cycles": end_cycles - start_cycles,
                            "cyclesPerSecond": round(
                                (end_cycles - start_cycles) * 1000 / args.duration_ms
                            ),
                            "underruns": end_underruns - start_underruns,
                            "coreOverflow": core_overflow,
                            "externalRequests": len(external),
                        },
                        sort_keys=True,
                    )
                )
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
