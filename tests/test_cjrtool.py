#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exercise CLI-only CJR conventions with synthetic data."""
import subprocess
import sys
import tempfile
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
    print("PASS cjrtool: --600 emits JR2Rescue-compatible raw flag 100")


if __name__ == "__main__":
    main()
