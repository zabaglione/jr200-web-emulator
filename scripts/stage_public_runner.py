#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Stage the byte-pinned public ABI 10 runner without rebuilding C++."""
from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_BASE = 'https://zabaglione.github.io/jr200-web-emulator/'
CORE_SOURCE_SHA256 = '3636d9661f2eacbffa4d1697e4d2b263bf560833b51c7b4925822e41aaf6cb93'
RUNNER_FILES = {
    'jr200_codec.mjs': (17418, '7e2a79623de255f0f886d9020b4ad256ca3edf29905ab76497f850a37c115682'),
    'jr200_codec.wasm': (83756, '62dd687c1027aaecf27592af0466a7198e708acb179c48d211673ad21b2ebb9f'),
}


def core_source_sha256(root: Path = ROOT) -> str:
    paths = sorted([*root.glob('src/**/*'), *root.glob('include/**/*'),
                    root / 'CMakeLists.txt', root / '.emscripten-version',
                    root / 'Makefile', root / 'scripts/check_emscripten_version.py',
                    root / 'scripts/stage_web.py',
                    root / '.github/workflows/pages.yml'])
    digest = hashlib.sha256()
    for path in paths:
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode() + b'\0')
            digest.update(path.read_bytes() + b'\0')
    return digest.hexdigest()


def download_verified(name: str, size: int, digest: str) -> bytes:
    request = urllib.request.Request(PUBLIC_BASE + name, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.geturl() != PUBLIC_BASE + name:
            raise ValueError(f'Unexpected runner redirect: {name}')
        data = response.read(size + 1)
    if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f'Public runner mismatch: {name}')
    return data


def stage() -> None:
    if core_source_sha256() != CORE_SOURCE_SHA256:
        raise ValueError('Public runner no longer matches the audited core source set')
    files = {name: download_verified(name, *record)
             for name, record in RUNNER_FILES.items()}
    output = ROOT / 'build/emscripten/web'
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (output / name).write_bytes(data)
    subprocess.run(['node', 'tests/emscripten_smoke.mjs',
                    str(output / 'jr200_codec.mjs')], cwd=ROOT, check=True)
    subprocess.run([sys.executable, 'scripts/stage_web.py', '--backend', 'emscripten'],
                   cwd=ROOT, check=True)


if __name__ == '__main__':
    try:
        stage()
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f'Public runner staging failed: {exc}', file=sys.stderr)
        raise SystemExit(2) from None
    print('Staged byte-pinned public runner without emulator rebuild')
