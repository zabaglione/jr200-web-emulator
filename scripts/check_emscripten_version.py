#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Require the repository-pinned Emscripten release before a formal build."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = (ROOT / ".emscripten-version").read_text(encoding="ascii").strip()

completed = subprocess.run(
    ["emcc", "--version"],
    check=True,
    capture_output=True,
    text=True,
)
match = re.search(r"\b(\d+\.\d+\.\d+)(?:-git)?\b", completed.stdout)
if not match:
    raise SystemExit("Unable to parse emcc --version")
actual = match.group(1)
if actual != EXPECTED:
    raise SystemExit(f"Emscripten {EXPECTED} is required; found {actual}")
print(f"PASS Emscripten version: {actual}")
