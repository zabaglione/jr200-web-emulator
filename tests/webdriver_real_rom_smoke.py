#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Run a local, opt-in real-ROM smoke test through a W3C WebDriver server.

The ROM and font paths are paths visible to the remote browser (for example,
read-only Docker bind-mount paths).  This script never reads or copies them.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"


class WebDriver:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.session_id = ""
        self.capabilities: dict[str, Any] = {}

    def request(self, method: str, path: str, body: Any | None = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            f"{self.endpoint}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"WebDriver HTTP {error.code}: {detail}") from error
        value = payload.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(f"WebDriver {value['error']}: {value.get('message', '')}")
        return value

    def start(self, browser_name: str) -> None:
        value = self.request(
            "POST",
            "/session",
            {"capabilities": {"alwaysMatch": {"browserName": browser_name}}},
        )
        self.session_id = value["sessionId"]
        self.capabilities = value["capabilities"]

    def close(self) -> None:
        if self.session_id:
            self.request("DELETE", f"/session/{self.session_id}")
            self.session_id = ""

    def call(self, method: str, suffix: str, body: Any | None = None) -> Any:
        return self.request(method, f"/session/{self.session_id}{suffix}", body)

    def find(self, selector: str) -> str:
        value = self.call(
            "POST", "/element", {"using": "css selector", "value": selector}
        )
        return value[ELEMENT_KEY]

    def text(self, selector: str) -> str:
        element = self.find(selector)
        return self.call("GET", f"/element/{element}/text")

    def click(self, selector: str) -> None:
        element = self.find(selector)
        self.call("POST", f"/element/{element}/click", {})

    def attribute(self, selector: str, name: str) -> str | None:
        element = self.find(selector)
        return self.call("GET", f"/element/{element}/attribute/{name}")

    def execute(self, script: str, *args: Any) -> Any:
        return self.call(
            "POST",
            "/execute/sync",
            {"script": script, "args": list(args)},
        )

    def upload(self, selector: str, remote_path: str) -> None:
        element = self.find(selector)
        self.call(
            "POST",
            f"/element/{element}/value",
            {"text": remote_path, "value": list(remote_path)},
        )

    def wait_text(self, selector: str, expected: str, timeout: float = 20) -> str:
        deadline = time.monotonic() + timeout
        last = ""
        while time.monotonic() < deadline:
            last = self.text(selector)
            if expected in last:
                return last
            time.sleep(0.1)
        raise RuntimeError(
            f"Timed out waiting for {expected!r} in {selector}; last text: {last!r}"
        )

    def wait_cycles(self, minimum: int, timeout: float = 30) -> str:
        deadline = time.monotonic() + timeout
        last = ""
        while time.monotonic() < deadline:
            last = self.text("#machine-status")
            match = re.search(r"\bcycles (\d+)\b", last)
            if match and int(match.group(1)) >= minimum:
                return last
            time.sleep(0.1)
        raise RuntimeError(
            f"Timed out waiting for {minimum} cycles; last text: {last!r}"
        )

    def type_keys(self, selector: str, text: str, delay_ms: int) -> None:
        self.click(selector)
        actions: list[dict[str, Any]] = []
        for character in text:
            value = "\ue007" if character == "\n" else character
            actions.extend(
                [
                    {"type": "keyDown", "value": value},
                    {"type": "pause", "duration": delay_ms},
                    {"type": "keyUp", "value": value},
                    {"type": "pause", "duration": delay_ms},
                ]
            )
        self.call(
            "POST",
            "/actions",
            {"actions": [{"type": "key", "id": "keyboard", "actions": actions}]},
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--webdriver", default="http://127.0.0.1:4444")
    parser.add_argument("--browser", choices=("firefox", "safari"), default="firefox")
    parser.add_argument("--url", required=True)
    parser.add_argument("--rom", required=True, help="ROM path visible to WebDriver")
    parser.add_argument("--font", required=True, help="font path visible to WebDriver")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--screenshot", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    driver = WebDriver(args.webdriver)
    try:
        driver.start(args.browser)
        driver.call(
            "POST",
            "/window/rect",
            {"x": 0, "y": 0, "width": args.width, "height": args.height},
        )
        driver.call("POST", "/url", {"url": args.url})
        driver.wait_text("#status", "WASM起動済み")
        if "CPUは実行していません" not in driver.text("#machine-status"):
            raise RuntimeError("No-ROM boundary did not remain stopped")

        driver.upload("#rom-combined", args.rom)
        driver.upload("#font", args.font)
        driver.click("#start")
        boot_status = driver.wait_text("#machine-status", "font 初期化済み")
        glyph_status = driver.wait_text("#glyph-status", "標準文字RAM")
        driver.wait_cycles(4_000_000)

        layout = driver.execute(
            """
                const screen = document.querySelector('#screen').getBoundingClientRect();
                const rail = document.querySelector('.utility-rail').getBoundingClientRect();
                const keys = [...document.querySelectorAll('.virtual-key')];
                const keyA = document.querySelector('.virtual-key[data-key-id="KeyA"]');
                const canvas = keyA.querySelector('canvas');
                const pixels = canvas.getContext('2d').getImageData(
                  0, 0, canvas.width, canvas.height
                ).data;
                let glyphPixels = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                  if (pixels[i + 3]) glyphPixels += 1;
                }
                return {
                  innerWidth,
                  innerHeight,
                  devicePixelRatio,
                  pageWidth: document.documentElement.scrollWidth,
                  pageHeight: document.documentElement.scrollHeight,
                  screenWidth: screen.width,
                  screenHeight: screen.height,
                  screenBottom: screen.bottom,
                  railWidth: rail.width,
                  keyboardBottom: document.querySelector('#virtual-keyboard')
                    .getBoundingClientRect().bottom,
                  minKeyHeight: Math.min(...keys.map(key =>
                    key.getBoundingClientRect().height)),
                  keyACode: keyA.dataset.code,
                  glyphPixels,
                };
            """
        )
        if layout["pageWidth"] > layout["innerWidth"]:
            raise RuntimeError(f"Page overflowed horizontally: {layout}")
        if layout["pageHeight"] > layout["innerHeight"]:
            raise RuntimeError(f"Page overflowed vertically: {layout}")
        if not 320 <= layout["railWidth"] <= 400:
            raise RuntimeError(f"Utility rail width was outside 320-400px: {layout}")
        if layout["screenBottom"] > layout["innerHeight"]:
            raise RuntimeError(f"Screen was clipped: {layout}")
        if layout["keyboardBottom"] > layout["innerHeight"]:
            raise RuntimeError(f"Virtual keyboard was clipped: {layout}")
        if layout["minKeyHeight"] < 44:
            raise RuntimeError(f"Virtual key was shorter than 44px: {layout}")
        if layout["keyACode"] != "61" or layout["glyphPixels"] == 0:
            raise RuntimeError(f"Real-font KeyA glyph was not rendered: {layout}")

        driver.click('.virtual-key[data-key-id="ModeKana"]')
        driver.wait_text("#input-mode-status", "カナ")
        driver.click('.virtual-key[data-key-id="ModeAnk"]')
        mode_status = driver.wait_text("#input-mode-status", "英数")

        original = driver.call("GET", "/window")
        new_tab = driver.call("POST", "/window/new", {"type": "tab"})["handle"]
        driver.call("POST", "/window", {"handle": new_tab})
        driver.call("POST", "/window", {"handle": original})
        paused_status = driver.wait_text("#machine-status", "一時停止")
        driver.click("#pause")
        driver.wait_text("#machine-status", "実行中")

        driver.type_keys(
            "#screen", "10 PRINT 5\n20 END\nLIST\nRUN\n", delay_ms=100
        )
        time.sleep(0.5)
        final_status = driver.text("#machine-status")
        notice = driver.text("#emulator-notice")
        lit_pixels = driver.execute(
            """
                    const context = document.querySelector('#screen').getContext('2d');
                    const pixels = context.getImageData(0, 0, 320, 224).data;
                    let lit = 0;
                    for (let i = 0; i < pixels.length; i += 4) {
                      if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit += 1;
                    }
                    return lit;
            """
        )
        if lit_pixels < 100:
            raise RuntimeError(f"Canvas remained blank: {lit_pixels} lit pixels")

        if args.screenshot:
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            encoded = driver.call("GET", "/screenshot")
            args.screenshot.write_bytes(base64.b64decode(encoded))

        print(
            json.dumps(
                {
                    "browserName": driver.capabilities.get("browserName"),
                    "browserVersion": driver.capabilities.get("browserVersion"),
                    "platformName": driver.capabilities.get("platformName"),
                    "bootStatus": boot_status,
                    "glyphStatus": glyph_status,
                    "modeStatus": mode_status,
                    "layout": layout,
                    "focusLossStatus": paused_status,
                    "finalStatus": final_status,
                    "notice": notice,
                    "litPixels": lit_pixels,
                    "screenshot": str(args.screenshot) if args.screenshot else None,
                },
                ensure_ascii=True,
                indent=2,
            )
        )
    finally:
        driver.close()


if __name__ == "__main__":
    main()
