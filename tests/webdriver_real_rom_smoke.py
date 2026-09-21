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

    def start(self) -> None:
        value = self.request(
            "POST",
            "/session",
            {"capabilities": {"alwaysMatch": {"browserName": "firefox"}}},
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
    parser.add_argument("--url", required=True)
    parser.add_argument("--rom", required=True, help="ROM path visible to WebDriver")
    parser.add_argument("--font", required=True, help="font path visible to WebDriver")
    parser.add_argument("--screenshot", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    driver = WebDriver(args.webdriver)
    try:
        driver.start()
        driver.call("POST", "/url", {"url": args.url})
        driver.wait_text("#status", "WASM起動済み")
        if "CPUは実行していません" not in driver.text("#machine-status"):
            raise RuntimeError("No-ROM boundary did not remain stopped")

        driver.upload("#rom-combined", args.rom)
        driver.upload("#font", args.font)
        driver.click("#start")
        boot_status = driver.wait_text("#machine-status", "font 初期化済み")
        driver.wait_cycles(4_000_000)

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
        lit_pixels = driver.call(
            "POST",
            "/execute/sync",
            {
                "script": """
                    const context = document.querySelector('#screen').getContext('2d');
                    const pixels = context.getImageData(0, 0, 320, 224).data;
                    let lit = 0;
                    for (let i = 0; i < pixels.length; i += 4) {
                      if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit += 1;
                    }
                    return lit;
                """,
                "args": [],
            },
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
