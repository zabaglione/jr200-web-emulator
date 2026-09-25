#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Prepare, but never publish, one exact game export for review.

The output is a patch-like directory. A separate, explicit release decision is
required before any of its files may be copied into the public repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from game_assets import MAX_META_BYTES, _read_bounded, validate_assets
from game_export_contract import ExportContractError, validate_export

ROOT = Path(__file__).resolve().parents[1]


def prepare(export_root: Path, web: Path, output: Path, selected: str,
            *, local_preview: bool = False) -> dict:
    current = validate_assets(web)
    result = validate_export(export_root, web / 'game-catalog.json',
                             allow_preview=local_preview)
    entry = result['entry']
    if selected != f'{entry["id"]}@{result["source"]["version"]}':
        raise ExportContractError('Explicit game selection does not match export')
    if (not local_preview and result['mode'] != 'release'):
        raise ExportContractError('Preview is never a release import')
    if output.is_symlink() or (output.exists() and
                               (not output.is_dir() or any(output.iterdir()))):
        raise ExportContractError('Output must be a new or empty real directory')
    for name, payload in result['files'].items():
        if name in current and current[name] != payload:
            raise ExportContractError(f'Immutable game path changed: {name}')
    ledger = json.loads(_read_bounded(web / 'game-assets.json', MAX_META_BYTES))
    for name, payload in result['files'].items():
        ledger['files'][name] = {'size': len(payload),
                                 'sha256': hashlib.sha256(payload).hexdigest()}
    # Every check above precedes all writes. This output is local and isolated.
    output.mkdir(parents=True, exist_ok=True)
    for name, payload in result['files'].items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    (output / 'game-catalog.json').write_bytes(result['catalog_bytes'])
    (output / 'game-assets.json').write_text(
        json.dumps(ledger, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'game': selected, 'mode': result['mode'],
            'new_files': sorted(set(result['files']) - set(current)),
            'unchanged_files': sorted(set(result['files']) & set(current))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, required=True)
    parser.add_argument('--web', type=Path, default=ROOT / 'web')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--game', required=True, help='selection guard: id@version')
    parser.add_argument('--local-preview', action='store_true',
                        help='allow candidate input only in isolated local output')
    args = parser.parse_args()
    try:
        summary = prepare(args.export, args.web, args.output, args.game,
                          local_preview=args.local_preview)
    except (ExportContractError, OSError, ValueError) as exc:
        print(f'Game import refused: {exc}', file=sys.stderr)
        return 2
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
