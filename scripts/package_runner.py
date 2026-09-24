#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Build the fixed, license-complete WASM runner ZIP; never publish it."""
from __future__ import annotations

import argparse
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_REVISION = 'c4c0c30f98c5878480c31af8595b6307e66b8ef0'
ASSET_NAME = 'jr200-runner-v0.3.0.zip'
FILE_RECORDS = {
    'jr200_codec.mjs': (17276, '0da8182674173af74ec529e71b29384cb530e6834269e9d4b615788a1d3fcf9c'),
    'jr200_codec.wasm': (83629, '8b0153570c4e7d0bd267ad8d3ae65eaefb1b18d51e5019a44475e58a6364ec20'),
    'LICENSE.txt': (1755, '8572fa6f2d35bbc6a33359ce203c5805df338508aef1e668b5fcdfb40c829361'),
    'THIRD_PARTY_NOTICES.md': (5114, 'c4ab6d2a74d9ba9066562112b2962d7af1bb0a3576fa9f71a759c50404fff185'),
    'SBOM.spdx.json': (8729, '8052b70dd1a53f83e58814c5ace0efade0ef58711083da493cd5bd62ba024b31'),
    'LICENSES/Emscripten-6.0.9.txt': (5091, '2fd38dc06e484cdd7a3f1e2f6577f5d53062052a2fd85131b56b89fbd673731c'),
    'LICENSES/VJR200.txt': (1445, '2b3e484a798458bd8659338080893cd7ff7d3e093e2fc0e394ffe24c554f92e5'),
    'LICENSES/MAME_BSD-3-Clause.txt': (1481, 'a27554938d3dd6569931e5e18b93214a57f47bc1bb8b75fc32fdd18abe042a07'),
    'LICENSES/libcxxabi-6.0.9.txt': (16706, 'e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c'),
}


class PackageError(ValueError):
    """Expected fixed runner packaging failure."""


def read_fixed_files(bundle: Path, root: Path,
                     records: dict[str, tuple[int, str]]) -> dict[str, bytes]:
    if (not bundle.is_dir() or bundle.is_symlink()
            or {path.name for path in bundle.iterdir()}
            != {'jr200_codec.mjs', 'jr200_codec.wasm'}):
        raise PackageError('Fixed runner bundle has an unexpected file inventory')
    files = {}
    for name, (size, digest) in records.items():
        if name == 'LICENSE.txt':
            path = root / 'LICENSE'
        elif name in ('jr200_codec.mjs', 'jr200_codec.wasm'):
            path = bundle / name
        else:
            path = root / name
        if (not path.is_file() or path.is_symlink()
                or path.parent.is_symlink() or path.stat().st_size != size):
            raise PackageError(f'Fixed runner input is missing or changed: {name}')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise PackageError(f'Fixed runner input digest changed: {name}')
        files[name] = data
    return files


def archive_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
    return buffer.getvalue()


def package(bundle: Path, root: Path, output: Path,
            records: dict[str, tuple[int, str]] = FILE_RECORDS) -> tuple[int, str]:
    if output.name != ASSET_NAME:
        raise PackageError('Runner ZIP output filename does not match fixed asset name')
    files = read_fixed_files(bundle, root, records)
    data = archive_bytes(files)
    digest = hashlib.sha256(data).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() or output.is_symlink():
        if (output.is_file() and not output.is_symlink()
                and output.stat().st_size == len(data)):
            with output.open('rb') as existing:
                if existing.read(len(data) + 1) == data:
                    return len(data), digest
        raise PackageError('Existing runner ZIP differs; refusing overwrite')
    with tempfile.NamedTemporaryFile(prefix='.runner-', suffix='.zip',
                                     dir=output.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        try:
            temporary.write(data)
            temporary.flush()
            os.fsync(temporary.fileno())
        except OSError:
            temporary_path.unlink(missing_ok=True)
            raise
    try:
        os.link(temporary_path, output)
    except FileExistsError:
        raise PackageError('Runner ZIP appeared during packaging') from None
    finally:
        temporary_path.unlink(missing_ok=True)
    return len(data), digest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        size, digest = package(args.bundle, ROOT, args.output)
    except (OSError, PackageError) as exc:
        print(f'Runner package failed: {exc}', file=sys.stderr)
        return 1
    print(f'Runner candidate: {ASSET_NAME} size={size} sha256={digest}')
    print(f'Source revision: {SOURCE_REVISION}; upload=not_run')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
