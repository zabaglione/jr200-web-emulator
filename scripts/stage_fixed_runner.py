#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Stage Web assets using the pinned public runner ZIP, with no C++ rebuild."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
import zipfile

from package_runner import ASSET_NAME, FILE_RECORDS

ROOT = Path(__file__).resolve().parents[1]
RUNNER_SHA256 = '860f99be69037a78c6dea557cd28994b83ba7fe05709d512d8e86cb44b6c77b0'
RUNNER_SIZE = 142300
CORE_SOURCE_SHA256 = '728f2a07e90635bda62c20e4519a20e35e147972951017d4ec4925a54d5ae23f'


def core_source_sha256() -> str:
    paths = sorted([*ROOT.glob('src/**/*'), *ROOT.glob('include/**/*'),
                    ROOT / 'CMakeLists.txt', ROOT / '.emscripten-version'])
    digest = hashlib.sha256()
    for path in paths:
        if path.is_file():
            digest.update(path.relative_to(ROOT).as_posix().encode() + b'\0')
            digest.update(path.read_bytes() + b'\0')
    return digest.hexdigest()


def stage(archive_path: Path) -> None:
    if core_source_sha256() != CORE_SOURCE_SHA256:
        raise ValueError('Fixed runner no longer matches the audited core source set')
    if (archive_path.name != ASSET_NAME or archive_path.is_symlink()
            or not archive_path.is_file() or archive_path.stat().st_size != RUNNER_SIZE):
        raise ValueError('Fixed runner ZIP is missing or unsafe')
    with archive_path.open('rb') as source:
        archive_bytes = source.read(RUNNER_SIZE + 1)
    if len(archive_bytes) != RUNNER_SIZE or hashlib.sha256(archive_bytes).hexdigest() != RUNNER_SHA256:
        raise ValueError('Fixed runner ZIP SHA-256 mismatch')
    with zipfile.ZipFile(archive_path) as archive:
        if set(archive.namelist()) != set(FILE_RECORDS):
            raise ValueError('Fixed runner ZIP file inventory differs')
        for info in archive.infolist():
            if info.is_dir() or info.flag_bits & 1 or info.file_size > 1024 * 1024:
                raise ValueError('Unsafe fixed runner member')
            data = archive.read(info)
            size, digest = FILE_RECORDS[info.filename]
            if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f'Fixed runner member mismatch: {info.filename}')
            if info.filename in ('jr200_codec.mjs', 'jr200_codec.wasm'):
                output = ROOT / 'build/emscripten/web' / info.filename
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(data)
    subprocess.run([sys.executable, str(ROOT / 'scripts/stage_web.py'),
                    '--backend', 'emscripten'], cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', type=Path, required=True)
    args = parser.parse_args()
    try:
        stage(args.zip)
    except (OSError, ValueError, zipfile.BadZipFile, subprocess.CalledProcessError) as exc:
        print(f'Fixed runner staging failed: {exc}', file=sys.stderr)
        return 2
    print('Staged pinned runner without emulator rebuild')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
