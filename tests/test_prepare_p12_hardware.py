#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def generate(tool: Path, output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/prepare_p12_hardware.py"),
            "--tool",
            str(tool),
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_prepare_p12_hardware.py /path/to/cjrtool")
    tool = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix="jr200-p12-test-") as directory:
        root = Path(directory)
        first = root / "first"
        second = root / "second"
        result = generate(tool, first)
        assert result.returncode == 0, result.stderr
        assert result.stdout.startswith("PASS P12 kit: 7 synthetic cases")

        manifest = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["schemaVersion"] == 1
        assert manifest["privateArtifactsMustNotBeCommitted"] is True
        assert manifest["hardwareVerified"] is False
        cases = manifest["cases"]
        assert len(cases) == 7
        assert [case["payloadBytes"] for case in cases] == [1, 4, 255, 256, 257, 257, 512]
        assert [case["byteSum"] for case in cases] == [171, 510, 32385, 32640, 32640, 32640, 65280]
        assert all(case["localRoundTripVerified"] for case in cases)
        assert all(case["hardwareResult"] == "pending" for case in cases)
        for case in cases:
            for key in ("payload", "cjr", "wav"):
                path = first / "send" / case[key]
                assert path.is_file() and path.stat().st_size > 0
                assert len(case["sha256"][key]) == 64

        card = (first / "TEST_CARD.md").read_text(encoding="utf-8")
        assert "receive/basic-a.wav" in card
        assert "receive/basic-b.wav" in card
        assert "pending" in card

        repeat = generate(tool, first)
        assert repeat.returncode != 0
        assert "not empty" in repeat.stderr

        result = generate(tool, second)
        assert result.returncode == 0, result.stderr
        first_manifest = (first / "manifest.json").read_bytes()
        second_manifest = (second / "manifest.json").read_bytes()
        assert first_manifest == second_manifest
        for case in cases:
            for key in ("payload", "cjr", "wav"):
                assert (first / "send" / case[key]).read_bytes() == (second / "send" / case[key]).read_bytes()

    print("PASS P12 hardware-kit generator: deterministic output, safe rerun refusal, pending hardware boundary")


if __name__ == "__main__":
    main()
