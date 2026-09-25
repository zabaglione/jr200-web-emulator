#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Create a local JR-200 CJR/input folder or ZIP. Does not publish it."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

MAX_CJR = 1024 * 1024
MAX_TEXT = 16384
MARKER = re.compile(r'[A-Z0-9 ]{6,32}\Z')
AUTO_TEXT = re.compile(r'MLOAD\nA=USR\(\$[0-9A-F]{4}\)\n?\Z')


class PackError(ValueError):
    """Reject an invalid or unsafe local pack without publishing it."""


def read_source(path: Path, limit: int, suffix: str | None = None) -> bytes:
    if path.is_symlink() or not path.is_file() or (suffix and path.suffix.lower() != suffix):
        raise PackError(f'Invalid input file: {path}')
    if not 0 < path.stat().st_size <= limit:
        raise PackError(f'Input size is out of range: {path}')
    return path.read_bytes()


def build_files(program: Path, input_text: Path, title: str,
                marker: str | None = None, license_file: Path | None = None,
                notice_file: Path | None = None) -> dict[str, bytes]:
    if not title.strip() or len(title) > 80:
        raise PackError('Title must contain 1-80 characters')
    cjr = read_source(program, MAX_CJR, '.cjr')
    text = read_source(input_text, MAX_TEXT, '.txt')
    try:
        normalized = text.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
    except UnicodeError as exc:
        raise PackError('Input text must be UTF-8') from exc
    if marker is not None and (not MARKER.fullmatch(marker)
                               or not AUTO_TEXT.fullmatch(normalized)):
        raise PackError('Auto-launch requires an ASCII title marker and MLOAD/USR text')
    files = {'game.cjr': cjr, 'launch.txt': text}
    for name, path in [('LICENSE.txt', license_file),
                       ('THIRD_PARTY_NOTICES.md', notice_file)]:
        if path is not None:
            files[name] = read_source(path, 65536)
    meta = {'schemaVersion': 1, 'title': title,
            'media': {'file': 'game.cjr', 'size': len(cjr),
                      'sha256': hashlib.sha256(cjr).hexdigest()},
            'input': {'file': 'launch.txt', 'size': len(text),
                      'sha256': hashlib.sha256(text).hexdigest()}}
    if marker is not None:
        meta['titleMarker'] = marker
    files['pack.json'] = (json.dumps(meta, ensure_ascii=False, indent=2) + '\n').encode()
    return files


def write_pack(files: dict[str, bytes], output: Path) -> None:
    if output.exists() or output.is_symlink():
        raise PackError(f'Output already exists: {output}')
    if output.suffix.lower() == '.zip':
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                archive.writestr(name, data)
    elif not output.suffix:
        output.mkdir()
        for name, data in files.items():
            (output / name).write_bytes(data)
    else:
        raise PackError('Output must be a new directory or a .zip file')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--program', required=True, type=Path, help='CJR file')
    parser.add_argument('--input', required=True, type=Path, help='UTF-8 input text')
    parser.add_argument('--title', required=True)
    parser.add_argument('--title-marker', help='observed on the title screen with owned ROM/FONT')
    parser.add_argument('--license', type=Path)
    parser.add_argument('--notice', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        files = build_files(args.program, args.input, args.title,
                            args.title_marker, args.license, args.notice)
        write_pack(files, args.output)
    except (OSError, PackError) as exc:
        print(f'Launch pack failed: {exc}', file=sys.stderr)
        return 2
    print(f'Created local launch pack: {args.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
