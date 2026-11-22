#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Measure synthetic CI or real-ROM BRICK PULSE playback on a staged site."""
from __future__ import annotations

import argparse
from collections import Counter
import functools
import http.server
import json
import math
import os
from pathlib import Path
import re
import shutil
import threading
from typing import TYPE_CHECKING

from browser_smoke import FONT, ROM

if TYPE_CHECKING:
    from playwright.sync_api import Page

BRICK_PULSE_VERSION = "0.1.1"
ROM_FILES = (("rom1", "ROM1.bin", 8192), ("rom2", "ROM2.bin", 8192), ("font", "FONT.bin", 2048))
WORKLET_PATH = "/__performance_probe_worklet.js"
# The node copies the rendered PCM to the real destination. Index the log by
# process() invocation because Chromium can reuse the previous currentFrame.
OUTPUT_WORKLET = b"""
class OutputProbe extends AudioWorkletProcessor {
  frames = new Float64Array(16384);
  rms = new Float32Array(this.frames.length);
  count = 0;
  quantum = 0;

  constructor() {
    super();
    this.port.onmessage = () => {
      const count = this.count;
      const frames = this.frames.slice(0, count);
      const rms = this.rms.slice(0, count);
      this.port.postMessage({
        count, quantum: this.quantum, frames, rms, invalidQuantum: this.invalidQuantum
      }, [frames.buffer, rms.buffer]);
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    const input = inputs[0]?.[0];
    if (input) output.set(input);
    else output.fill(0);
    this.quantum ||= output.length;
    if (output.length !== this.quantum) this.invalidQuantum = true;
    if (this.count < this.frames.length) {
      let squares = 0;
      for (const sample of output) squares += sample * sample;
      this.frames[this.count] = currentFrame;
      this.rms[this.count] = Math.sqrt(squares / output.length);
    }
    if (++this.count === 64) this.port.postMessage({ready: true});
    return true;
  }
}
registerProcessor('output-probe', OutputProbe);
"""
TRACK_NATIVE_AUDIO = """
(() => {
  const probe = globalThis.performanceProbe = {sources: []};
  const Context = globalThis.AudioContext;
  globalThis.AudioContext = new Proxy(Context, {
    construct(target, args) {
      return probe.context = Reflect.construct(target, args);
    },
  });
  const createGain = Context.prototype.createGain;
  Context.prototype.createGain = function (...args) {
    const gain = createGain.apply(this, args);
    if (this === probe.context) probe.gain ??= gain;
    return gain;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (probe.recording && this.context === probe.context && this.buffer) {
      if (this.playbackRate.value !== 1 || args.length !== 1) {
        probe.error = 'Unexpected BRICK PULSE playback rate or source start';
      }
      const data = this.buffer.getChannelData(0);
      if (data.some(sample => sample !== 0)) {
        const squares = new Float64Array(data.length + 1);
        for (let i = 0; i < data.length; ++i) {
          const sample = data[i] * probe.gain.gain.value;
          squares[i + 1] = squares[i] + sample * sample;
        }
        probe.sources.push({
          start: args[0], rate: this.buffer.sampleRate, squares
        });
      }
    }
    return start.apply(this, args);
  };
})()
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, serve_worklet: bool, **kwargs):
        self.serve_worklet = serve_worklet
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        if self.serve_worklet and self.path == WORKLET_PATH:
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(OUTPUT_WORKLET)))
            self.end_headers()
            self.wfile.write(OUTPUT_WORKLET)
            return
        super().do_GET()

    def log_message(self, *_args: object) -> None:
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--duration-ms", type=int, default=3000)
    parser.add_argument("--chrome", type=Path)
    parser.add_argument("--brick-pulse-rom-dir", type=Path, metavar="DIR",
                        help="Run BRICK PULSE with ROM1.bin, ROM2.bin and FONT.bin in DIR "
                             "using an installed, unmuted Google Chrome window")
    args = parser.parse_args()
    if not 1000 <= args.duration_ms <= 30000:
        parser.error("--duration-ms must be between 1000 and 30000")
    if args.brick_pulse_rom_dir is not None and args.duration_ms != 3000:
        parser.error("The BRICK PULSE scenario uses a 3000 ms measurement")
    return args


def status_number(text: str, pattern: str) -> int:
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError(f"Could not match {pattern!r} in {text!r}")
    return int(match.group(1))


def summarize_output(recording: dict, start: dict, end: dict, sample_rate: int) -> dict:
    quantum = recording["quantum"]
    frames = recording["frames"]
    if not quantum or recording.get("invalidQuantum") or len(frames) != recording["count"]:
        raise RuntimeError("The AudioWorklet recording overflowed or changed block size")

    # Match the invocation count to the native timeline using the stable
    # offset on both sides of the window. Duplicate raw labels stay in the log.
    offsets = [frame - i * quantum for i, frame in enumerate(frames)]
    if len(offsets) < 128:
        raise RuntimeError("The AudioWorklet recording is too short to align")
    anchors = [Counter(edge).most_common(1)[0] for edge in (offsets[:64], offsets[-64:])]
    anchor = anchors[0][0]
    if anchors[1][0] != anchor or any(count <= 32 for _, count in anchors):
        raise RuntimeError("The AudioWorklet invocation count did not match the output timeline")

    first = round(start["contextTime"] * sample_rate)
    past = round(end["contextTime"] * sample_rate)
    begin_index, first_remainder = divmod(first - anchor, quantum)
    end_index, end_remainder = divmod(past - anchor, quantum)
    if first_remainder or end_remainder or not 0 <= begin_index < end_index <= len(frames):
        raise RuntimeError("The AudioWorklet did not cover the measurement window")

    levels = recording["rms"][begin_index:end_index]
    audible_frames = [first + i * quantum for i, level in enumerate(levels) if level >= 0.001]
    if not audible_frames:
        raise RuntimeError("No BRICK PULSE sound effects were rendered in the measurement window")

    intervals = []
    for frame in audible_frames:
        if intervals and intervals[-1][1] == frame:
            intervals[-1][1] += quantum
        else:
            intervals.append([frame, frame + quantum])

    # Compare only clearly audible scheduled samples, with an edge margin for
    # fractional start times and sample rate conversion in Chrome.
    missing_sound = 0
    for i, level in enumerate(levels):
        if level >= 0.001:
            continue
        block_start = (first + i * quantum) / sample_rate
        block_end = block_start + quantum / sample_rate
        expected_squares = 0
        for source in recording["sources"]:
            rate = source["rate"]
            squares = source["squares"]
            lo = max(4, math.ceil((block_start - source["start"]) * rate) + 4)
            hi = min(len(squares) - 5, math.floor((block_end - source["start"]) * rate) - 4)
            if hi > lo:
                expected_squares += (squares[hi] - squares[lo]) * sample_rate / rate
        if expected_squares / quantum >= 0.003 ** 2:
            missing_sound += 1

    return {
        "sampleRate": sample_rate,
        "renderedBlocks": len(levels),
        "renderedFrames": len(levels) * quantum,
        "quietBlocks": len(levels) - len(audible_frames),
        "nonmatchingFrameLabels": sum(offset != anchor for offset in offsets[begin_index:end_index]),
        "missingSoundBlocks": missing_sound,
        "audibleRangesMs": [
            [round((lo - first) * 1000 / sample_rate, 1), round((hi - lo) * 1000 / sample_rate, 1)]
            for lo, hi in intervals
        ],
    }


def measure_brick_pulse(page: Page, base: str, rom_dir: Path, duration_ms: int) -> dict:
    from playwright.sync_api import expect

    page.goto(f"{base}/?game=brick-pulse&launch=1", wait_until="networkidle")
    page.bring_to_front()
    rom_panel = page.locator("details.tool-panel").filter(has=page.locator("#asset-status"))
    rom_panel.evaluate("panel => panel.open = true")
    page.locator('input[name="rom-mode"][value="split"]').check()
    for field, name, _ in ROM_FILES:
        page.locator(f"#{field}:enabled").set_input_files(rom_dir / name)
    expect(page.locator("#game-launch-status")).to_contain_text(
        "BRICK PULSE を起動しました", timeout=120000,
    )
    expect(page.locator("#machine-status")).to_contain_text("実行中")
    audio_status = page.locator("#audio-status")
    if "context running" not in (audio_status.text_content() or ""):
        page.locator("#audio-enable:enabled").click()
    expect(audio_status).to_contain_text("context running")
    expect(audio_status).to_contain_text("キークリック: OFF")

    page.evaluate("""async path => {
      const p = globalThis.performanceProbe;
      const {context, gain} = p;
      if (context.state !== 'running' || gain.gain.value <= 0) {
        throw new Error('Chrome audio output is not running');
      }
      await context.audioWorklet.addModule(path);
      const output = p.output = new AudioWorkletNode(context, 'output-probe', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1,
      });
      output.port.onmessage = event => { p.ready = event.data.ready; };
      output.onprocessorerror = () => { p.error = 'The output AudioWorklet stopped'; };
      output.connect(context.destination);
      gain.disconnect(context.destination);
      gain.connect(output);
      p.recording = true;
    }""", WORKLET_PATH)
    page.wait_for_function("() => performanceProbe.ready || performanceProbe.error", timeout=10000)
    if error := page.evaluate("() => performanceProbe.error"):
        raise RuntimeError(error)

    screen = page.locator("#screen")
    screen.click()
    title = screen.evaluate("canvas => canvas.toDataURL()")
    page.keyboard.press("Enter")
    page.wait_for_function("title => document.querySelector('#screen').toDataURL() !== title", arg=title)
    page.wait_for_timeout(400)
    page.evaluate("""duration => {
      const p = globalThis.performanceProbe;
      const snapshot = () => ({
        wall: performance.now(),
        visible: document.visibilityState === 'visible',
        state: p.context.state,
        contextTime: p.context.currentTime,
        timestamp: p.context.getOutputTimestamp().performanceTime,
        machine: document.querySelector('#machine-status').textContent,
        audio: document.querySelector('#audio-status').textContent,
      });
      p.measurement = (async () => {
        const beforeStats = p.context.playbackStats?.toJSON();
        const start = snapshot();
        await new Promise(resolve => setTimeout(resolve, duration));
        const end = snapshot();
        // Playback counters are published at most once per second in Chrome.
        await new Promise(resolve => setTimeout(resolve, 1250));
        const afterStats = p.context.playbackStats?.toJSON();
        const recorded = await new Promise((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error('The output AudioWorklet did not respond')), 4000);
          p.output.port.onmessage = event => {
            clearTimeout(deadline);
            resolve(event.data);
          };
          p.output.port.postMessage('read');
        });
        if (p.error) throw new Error(p.error);
        return {
          start, end, beforeStats, afterStats,
          sampleRate: p.context.sampleRate,
          recording: {
            ...recorded, frames: Array.from(recorded.frames), rms: Array.from(recorded.rms),
            sources: p.sources.map(source => ({...source, squares: Array.from(source.squares)})),
          },
        };
      })();
    }""", duration_ms)
    # Move the paddle through the normal game keyboard path during the window.
    page.wait_for_timeout(280)
    page.keyboard.down("d")
    page.wait_for_timeout(420)
    page.keyboard.up("d")
    page.wait_for_timeout(1350)
    page.keyboard.down("a")
    page.wait_for_timeout(170)
    page.keyboard.up("a")
    result = page.evaluate("() => globalThis.performanceProbe.measurement")
    start, end = result["start"], result["end"]
    if (any(sample["state"] != "running" or not sample["visible"] for sample in (start, end))
            or not 0 < start["timestamp"] < end["timestamp"]):
        raise RuntimeError("Chrome audio did not keep playing during the measurement window")
    if any("CPU 100%" not in sample["machine"] for sample in (start, end)):
        raise RuntimeError("The BRICK PULSE probe requires the default CPU speed")
    before_stats, after_stats = result.get("beforeStats"), result.get("afterStats")
    chrome_underruns = chrome_underrun_ms = None
    if before_stats is not None and after_stats is not None:
        if after_stats["totalDuration"] - before_stats["totalDuration"] < duration_ms / 1000:
            raise RuntimeError("Chrome playback counters did not cover the measurement window")
        chrome_underruns = after_stats["underrunEvents"] - before_stats["underrunEvents"]
        chrome_underrun_ms = round(
            1000 * (after_stats["underrunDuration"] - before_stats["underrunDuration"]), 3,
        )
    return {
        **summarize_output(result["recording"], start, end, result["sampleRate"]),
        "game": f"BRICK PULSE {BRICK_PULSE_VERSION}",
        "actualDurationMs": round(end["wall"] - start["wall"], 2),
        "cycles": status_number(end["machine"], r"cycles (\d+)") - status_number(start["machine"], r"cycles (\d+)"),
        "underruns": status_number(end["audio"], r"underrun (\d+)") - status_number(start["audio"], r"underrun (\d+)"),
        "coreOverflow": status_number(end["audio"], r"core overflow (\d+)"),
        "chromePlaybackUnderruns": chrome_underruns,
        "chromePlaybackUnderrunMs": chrome_underrun_ms,
    }


def measure_synthetic(page: Page, base: str, duration_ms: int) -> dict:
    from playwright.sync_api import expect

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
    page.goto(base + "/", wait_until="networkidle")
    page.locator("#rom-combined:enabled").set_input_files(
        {
            "name": "performance.rom",
            "mimeType": "application/octet-stream",
            "buffer": bytes(ROM),
        }
    )
    page.locator("#font:enabled").set_input_files(
        {
            "name": "performance-font.bin",
            "mimeType": "application/octet-stream",
            "buffer": FONT,
        }
    )
    page.locator("#start").click()
    expect(page.locator("#machine-status")).to_contain_text("実行中")
    # Starting the emulator also starts audio with the default settings.
    expect(page.locator("#audio-status")).to_contain_text("context running")
    page.wait_for_function("() => globalThis.__audioContexts[0]?.sources.length > 0")
    page.wait_for_timeout(1000)

    start_cycles = status_number(
        page.locator("#machine-status").text_content() or "",
        r"cycles (\d+)",
    )
    start_underruns = status_number(
        page.locator("#audio-status").text_content() or "",
        r"underrun (\d+)",
    )
    page.wait_for_timeout(duration_ms)
    end_cycles = status_number(
        page.locator("#machine-status").text_content() or "",
        r"cycles (\d+)",
    )
    audio_status = page.locator("#audio-status").text_content() or ""
    end_underruns = status_number(audio_status, r"underrun (\d+)")
    core_overflow = status_number(audio_status, r"core overflow (\d+)")
    return {
        "cycles": end_cycles - start_cycles,
        "underruns": end_underruns - start_underruns,
        "coreOverflow": core_overflow,
    }


def main() -> None:
    from playwright.sync_api import sync_playwright

    args = parse_args()
    site = args.site.resolve()
    if not (site / "jr200_codec.wasm").is_file():
        raise SystemExit(f"Staged WASM was not found under {site}")
    rom_dir = args.brick_pulse_rom_dir
    if rom_dir is not None:
        for _, name, size in ROM_FILES:
            path = rom_dir / name
            if not path.is_file() or path.stat().st_size != size:
                raise SystemExit(f"Expected {name} ({size} bytes) in the provided ROM directory")
        catalog = json.loads((site / "game-catalog.json").read_text())
        if not any(game["id"] == "brick-pulse" and game["version"] == BRICK_PULSE_VERSION
                   for game in catalog["games"]):
            raise SystemExit(f"The staged site must contain BRICK PULSE {BRICK_PULSE_VERSION}")

    handler = functools.partial(QuietHandler, directory=str(site), serve_worklet=rom_dir is not None)
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
            if executable is None and rom_dir is None:
                discovered = shutil.which("chromium")
                executable = Path(discovered) if discovered else None
            options: dict[str, object] = {"headless": rom_dir is None}
            if rom_dir is not None:
                options.update(ignore_default_args=["--mute-audio"],
                               args=["--enable-blink-features=AudioContextPlaybackStats"])
                if not executable:
                    options["channel"] = "chrome"
            if executable:
                options["executable_path"] = str(executable)
            browser = playwright.chromium.launch(**options)
            try:
                page = browser.new_page(viewport={"width": 1920, "height": 960})
                page.on("pageerror", lambda error: errors.append(str(error)))

                def guard(route) -> None:
                    if route.request.url.startswith(base + "/"):
                        route.continue_()
                    else:
                        external.append(route.request.url)
                        route.abort()

                page.route("**/*", guard)
                if rom_dir is not None:
                    page.add_init_script(TRACK_NATIVE_AUDIO)
                    metrics = measure_brick_pulse(page, base, rom_dir, args.duration_ms)
                else:
                    metrics = measure_synthetic(page, base, args.duration_ms)
                cycles = metrics["cycles"]
                if cycles <= 0:
                    raise RuntimeError("Emulator did not advance during the measurement window")
                if errors or external:
                    raise RuntimeError({"pageErrors": errors, "externalRequests": external})
                print(
                    json.dumps(
                        {
                            "browser": browser.version,
                            "viewport": [1920, 960],
                            "dpr": page.evaluate("devicePixelRatio"),
                            "durationMs": args.duration_ms,
                            **metrics,
                            "cyclesPerSecond": round(cycles * 1000 / args.duration_ms),
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
