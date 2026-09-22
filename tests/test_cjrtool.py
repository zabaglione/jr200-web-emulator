#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exercise CLI-only CJR conventions with synthetic data."""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, capture_output=True, text=True)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_cjrtool.py /path/to/cjrtool")
    tool = str(Path(sys.argv[1]).resolve())
    with tempfile.TemporaryDirectory(prefix="jr200-cjrtool-") as directory:
        root = Path(directory)
        payload = root / "payload.bin"
        output = root / "output.cjr"
        payload.write_bytes(b"\xab")
        run(tool, "pack", str(payload), str(output), "X", "7000", "--600")
        encoded = output.read_bytes()
        assert len(encoded) == 47
        assert encoded[23] == 100
        assert encoded[32] == sum(encoded[:32]) & 0xFF
        inspected = run(tool, "inspect", str(output)).stdout
        assert "baud_flag=100" in inspected
        wav_48 = root / "fast-48k.wav"
        rendered = run(tool, "wav", str(output), str(wav_48), "--rate", "48000", "--2400").stdout
        assert "48000 Hz, mono 16-bit, 2400 baud" in rendered
        with wave.open(str(wav_48), "rb") as stream:
            assert stream.getnchannels() == 1
            assert stream.getsampwidth() == 2
            assert stream.getframerate() == 48000
            assert stream.getnframes() == 183520
            assert stream.readframes(1) == b"\x00\xc0"
        assert wav_48.stat().st_size == 367084
        decoded = root / "decoded.cjr"
        decoded_report = run(tool, "wav-decode", str(wav_48), str(decoded)).stdout
        assert decoded.read_bytes() == encoded
        assert "verified CJR 47 bytes" in decoded_report
        assert "Raw WAV was not modified" in decoded_report

        silent_wav = root / "silence.wav"
        silent_bytes = bytearray(wav_48.read_bytes())
        silent_bytes[44:] = bytes(len(silent_bytes) - 44)
        silent_wav.write_bytes(silent_bytes)
        rejected = root / "candidate.cjr"
        failed = subprocess.run(
            [tool, "wav-decode", str(silent_wav), str(rejected)],
            check=False,
            capture_output=True,
            text=True,
        )
        assert failed.returncode != 0
        assert "candidate 0 bytes was not written" in failed.stderr
        assert not rejected.exists()

        wav_44 = root / "fast-44k.wav"
        run(tool, "wav", str(output), str(wav_44), "--rate", "44100", "--2400")
        with wave.open(str(wav_44), "rb") as stream:
            assert stream.getframerate() == 44100
            assert stream.getnframes() == 168609
        assert wav_44.stat().st_size == 337262

        wav_600 = root / "slow-48k.wav"
        run(tool, "wav", str(output), str(wav_600), "--rate", "48000", "--600")
        with wave.open(str(wav_600), "rb") as stream:
            assert stream.getnframes() == 193600
        assert wav_600.stat().st_size == 387244

        wav_header_baud = root / "header-baud.wav"
        inherited = run(tool, "wav", str(output), str(wav_header_baud)).stdout
        assert "48000 Hz, mono 16-bit, 600 baud" in inherited
        with wave.open(str(wav_header_baud), "rb") as stream:
            assert stream.getnframes() == 193600
    print("PASS cjrtool: CJR conventions, WAV encode/decode, and unverified candidate suppression")


if __name__ == "__main__":
    main()
