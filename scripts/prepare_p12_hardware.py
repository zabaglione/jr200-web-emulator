#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Create deterministic, ROM-free P12 cassette test media.

The generated files belong under local-assets/ and must not be committed.  This
script proves only that the test media can be encoded and decoded locally; the
JR-200 observations are recorded separately by the operator.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str]) -> str:
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def cases() -> list[dict[str, object]]:
    sequence_255 = bytes(range(255))
    sequence_256 = bytes(range(256))
    sequence_257 = sequence_256 + b"\x00"
    return [
        {"id": "m001-600-48k", "name": "P12M001", "data": b"\xab", "baud": 600, "rate": 48000},
        {"id": "pattern-600-48k", "name": "P12PAT4", "data": bytes([0x00, 0xFF, 0x55, 0xAA]), "baud": 600, "rate": 48000},
        {"id": "m255-2400-48k", "name": "P12M255", "data": sequence_255, "baud": 2400, "rate": 48000},
        {"id": "m256-2400-48k", "name": "P12M256", "data": sequence_256, "baud": 2400, "rate": 48000},
        {"id": "m257-2400-48k", "name": "P12M257", "data": sequence_257, "baud": 2400, "rate": 48000},
        {"id": "m257-2400-44k", "name": "P12M257", "data": sequence_257, "baud": 2400, "rate": 44100},
        {"id": "m512-2400-48k", "name": "P12M512", "data": sequence_256 * 2, "baud": 2400, "rate": 48000},
    ]


def test_card(entries: list[dict[str, object]]) -> str:
    lines = [
        "# P12 JR-200 hardware test card",
        "",
        "These files contain synthetic byte patterns only. Do not commit this directory.",
        "",
        "## Equipment record (complete before testing)",
        "",
        "- JR-200 unit / serial or label:",
        "- Power supply and machine condition:",
        "- Playback computer / OS:",
        "- Playback software and version:",
        "- Playback interface / output:",
        "- Cable and JR-200 input connector:",
        "- Recording interface / input:",
        "- Recording software and version:",
        "- Playback level:",
        "- Recording level:",
        "",
        "Use the JR-200 cassette input specified by its manual. Do not connect an amplified speaker output directly to an input.",
        "Start at a conservative playback level and record every level change.",
        "",
        "## Send: generated WAV to JR-200",
        "",
        "For each row, clear the target range, enter MLOAD, then start the listed WAV during the leader.",
        "After MLOAD completes, calculate the byte sum with:",
        "",
        "S=0:FOR I=0 TO <length-1>:S=S+PEEK(28672+I):NEXT I:PRINT S",
        "",
        "Record READY/error text, elapsed time, playback level, printed sum, first byte, and last byte.",
        "",
        "| Case | WAV | Baud | Rate | Length | Expected sum | First | Last | Hardware result |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for entry in entries:
        lines.append(
            "| {id} | send/{wav} | {baud} | {rate} | {payloadBytes} | {byteSum} | {firstByte} | {lastByte} | pending |".format(
                **entry
            )
        )
    lines.extend(
        [
            "",
            "For pattern-600-48k, also verify the four values are 0, 255, 85, and 170.",
            "The two m257 cases isolate the 48 kHz versus 44.1 kHz sample-rate condition.",
            "",
            "## Receive: JR-200 to two independent recordings",
            "",
            "### BASIC",
            "",
            "1. Enter `10 PRINT 42` and `20 END`, then confirm LIST and RUN.",
            "2. Start a new recording and execute `SAVE \"P12B\"`; store it as receive/basic-a.wav.",
            "3. Stop and create a second recording from a second SAVE operation; store it as receive/basic-b.wav.",
            "4. Do not duplicate or edit the first recording to make the second file.",
            "",
            "### Machine code data",
            "",
            "1. Put 0, 255, 85, and 170 at addresses 28672 through 28675 and verify them with PEEK.",
            "2. Create independent recordings from two separate `MSAVE \"P12M\",28672,28675` operations.",
            "3. Store them as receive/machine-a.wav and receive/machine-b.wav.",
            "",
            "Keep raw WAV files unchanged. Decoding and comparison happen only after both recordings exist.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tool", type=Path, default=ROOT / "build/native/cjrtool")
    parser.add_argument("--output", type=Path, default=ROOT / "local-assets/p12-kit")
    args = parser.parse_args()

    tool = args.tool.resolve()
    output = args.output.resolve()
    if not tool.is_file():
        raise SystemExit(f"cjrtool not found: {tool}")
    if output.exists() and any(output.iterdir()):
        raise SystemExit(f"output directory is not empty: {output}")
    send = output / "send"
    receive = output / "receive"
    send.mkdir(parents=True, exist_ok=True)
    receive.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="jr200-p12-") as temporary:
        temp = Path(temporary)
        for case in cases():
            case_id = str(case["id"])
            payload = bytes(case["data"])
            baud = int(case["baud"])
            rate = int(case["rate"])
            payload_path = send / f"{case_id}.bin"
            cjr_path = send / f"{case_id}.cjr"
            wav_path = send / f"{case_id}.wav"
            decoded_path = temp / f"{case_id}.cjr"
            payload_path.write_bytes(payload)

            pack = [str(tool), "pack", str(payload_path), str(cjr_path), str(case["name"]), "7000"]
            if baud == 600:
                pack.append("--600")
            run(pack)
            run([str(tool), "wav", str(cjr_path), str(wav_path), "--rate", str(rate), f"--{baud}"])
            run([str(tool), "wav-decode", str(wav_path), str(decoded_path)])
            if decoded_path.read_bytes() != cjr_path.read_bytes():
                raise RuntimeError(f"round-trip mismatch: {case_id}")
            inspect = run([str(tool), "inspect", str(cjr_path)])
            entry = {
                "id": case_id,
                "name": case["name"],
                "startAddress": "7000",
                "payloadBytes": len(payload),
                "byteSum": sum(payload),
                "firstByte": payload[0],
                "lastByte": payload[-1],
                "baud": baud,
                "rate": rate,
                "inspect": inspect,
                "payload": payload_path.name,
                "cjr": cjr_path.name,
                "wav": wav_path.name,
                "sha256": {
                    "payload": sha256(payload_path),
                    "cjr": sha256(cjr_path),
                    "wav": sha256(wav_path),
                },
                "localRoundTripVerified": True,
                "hardwareResult": "pending",
            }
            entries.append(entry)

    manifest = {
        "schemaVersion": 1,
        "generator": "scripts/prepare_p12_hardware.py",
        "privateArtifactsMustNotBeCommitted": True,
        "hardwareVerified": False,
        "cases": entries,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (output / "TEST_CARD.md").write_text(test_card(entries), encoding="utf-8")
    print(f"PASS P12 kit: {len(entries)} synthetic cases; local encode/decode verified")
    print(f"Output: {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
