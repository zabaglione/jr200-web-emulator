#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Run a local, opt-in real-ROM smoke test through a W3C WebDriver server.

The ROM and font paths are paths visible to the remote browser (for example,
read-only Docker bind-mount paths).  This script never reads or copies them.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, urljoin, urlsplit


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
    parser.add_argument("--game", help="published catalog game ID to launch")
    parser.add_argument("--start-key", choices=("return", "numpad-enter"),
                        default="return")
    return parser.parse_args()


def game_smoke(driver: WebDriver, args: argparse.Namespace) -> None:
    if args.game != "brick-pulse":
        raise RuntimeError("Only brick-pulse has a defined start-input assertion")
    query = parse_qs(urlsplit(args.url).query)
    if query != {"game": [args.game], "launch": ["1"]}:
        raise RuntimeError("The game URL must select exactly one automatic launch")
    base = args.url.split("?", 1)[0]
    with urlopen(urljoin(base, "game-catalog.json"), timeout=20) as response:
        catalog = json.load(response)
    matches = [entry for entry in catalog["games"] if entry["id"] == args.game]
    if len(matches) != 1:
        raise RuntimeError("The published game is not unique in the catalog")
    entry = matches[0]
    if entry.get("path") != f"games/{args.game}/{entry.get('version')}/{args.game}.cjr":
        raise RuntimeError("The published game path is not fixed to its ID and version")
    with urlopen(urljoin(base, entry["path"]), timeout=20) as response:
        cjr = response.read(1024 * 1024 + 1)
    if len(cjr) > 1024 * 1024 or hashlib.sha256(cjr).hexdigest() != entry["sha256"]:
        raise RuntimeError("Published CJR hash mismatch")
    driver.wait_text("#game-launch-status", "ROM/FONT", timeout=30)
    driver.upload("#rom-combined", args.rom)
    driver.upload("#font", args.font)
    driver.wait_text("#game-launch-status", "を起動しました", timeout=120)
    status = driver.text("#game-launch-status")
    if entry["title"] not in status:
        raise RuntimeError("The wrong game reached the title screen")
    before = driver.execute("return document.querySelector('#screen').toDataURL()")
    driver.execute("window.__smokeKeys=[]; addEventListener('keydown', e => "
                   "window.__smokeKeys.push({key:e.key,code:e.code}))")
    driver.type_keys("#screen", "\ue006" if args.start_key == "return" else "\ue007",
                     delay_ms=75)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if driver.execute("return document.querySelector('#screen').toDataURL()") != before:
            break
        time.sleep(0.2)
    else:
        if args.screenshot:
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            args.screenshot.write_bytes(base64.b64decode(driver.call("GET", "/screenshot")))
        focus = driver.execute("return document.activeElement?.id || ''")
        keys = driver.execute("return window.__smokeKeys")
        raise RuntimeError("Start input did not change the game screen; "
                           f"focus={focus}; keys={keys}; machine={driver.text('#machine-status')}")
    if args.screenshot:
        args.screenshot.parent.mkdir(parents=True, exist_ok=True)
        args.screenshot.write_bytes(base64.b64decode(driver.call("GET", "/screenshot")))
    print(json.dumps({"status": "passed", "browser": driver.capabilities.get("browserName"),
                      "browserVersion": driver.capabilities.get("browserVersion"),
                      "game": args.game, "version": entry["version"],
                      "startKey": args.start_key,
                      "cjrSha256": entry["sha256"]}, sort_keys=True))


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

        if args.game:
            game_smoke(driver, args)
            return

        driver.upload("#rom-combined", args.rom)
        driver.upload("#font", args.font)
        driver.click("#start")
        boot_status = driver.wait_text("#machine-status", "font 初期化済み")
        glyph_status = driver.wait_text("#glyph-status", "標準文字RAM")
        driver.wait_cycles(4_000_000)
        driver.click("#keyboard-toggle")

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
        if layout["minKeyHeight"] < 29:
            raise RuntimeError(f"Virtual key was shorter than 29px: {layout}")
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
        focus_status = driver.wait_text("#machine-status", "実行中")

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
                    "focusLossStatus": focus_status,
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
