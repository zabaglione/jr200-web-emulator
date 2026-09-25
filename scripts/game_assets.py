#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Exact allow-list for approved game bytes in the public Web distribution."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import subprocess

from game_export_contract import RUNNER_VERSION, _cjr_contains_entry

ID = re.compile(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z')
VERSION = re.compile(r'\d+\.\d+\.\d+\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')
RUN = re.compile(r'A=USR\(\$([0-9A-F]{4})\)\Z')
MAX_CJR_BYTES = 1024 * 1024
MAX_META_BYTES = 256 * 1024
SUFFIXES = {'EXPORT.json', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md',
            'LICENSES/BSD-3-Clause.txt'}


class GameAssetError(ValueError):
    pass


def validate_immutable_history(root: Path, current_paths: set[str]) -> None:
    """Reject deletion or byte changes to any game path already committed."""
    shallow = subprocess.check_output(['git', 'rev-parse', '--is-shallow-repository'],
                                      cwd=root, text=True).strip()
    if shallow != 'false':
        raise GameAssetError('Full Git history is required for immutable games')
    historic = set(subprocess.check_output(
        ['git', 'log', '--format=', '--name-only', 'HEAD', '--', 'web/games'],
        cwd=root, text=True).splitlines())
    if not historic.issubset(current_paths):
        raise GameAssetError('An immutable game path was removed')
    for name in historic:
        commits = subprocess.check_output(
            ['git', 'log', '--diff-filter=A', '--reverse', '--format=%H',
             'HEAD', '--', name], cwd=root, text=True).splitlines()
        if not commits:
            raise GameAssetError(f'Cannot locate first game version: {name}')
        original = subprocess.check_output(
            ['git', 'rev-parse', f'{commits[0]}:{name}'], cwd=root, text=True).strip()
        current = subprocess.check_output(
            ['git', 'hash-object', '--', name], cwd=root, text=True).strip()
        if original != current:
            raise GameAssetError(f'Immutable game version changed: {name}')


def _read_bounded(path: Path, limit: int) -> bytes:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise GameAssetError(f'Missing, unsafe, or oversized game file: {path.name}')
    with path.open('rb') as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise GameAssetError(f'Oversized game file: {path.name}')
    return data


def validate_assets(web: Path) -> dict[str, bytes]:
    ledger = json.loads(_read_bounded(web / 'game-assets.json', MAX_META_BYTES))
    catalog = json.loads(_read_bounded(web / 'game-catalog.json', MAX_META_BYTES))
    if (set(ledger) != {'schemaVersion', 'files'} or ledger['schemaVersion'] != 1
            or not isinstance(ledger['files'], dict)
            or set(catalog) != {'schemaVersion', 'games'} or catalog['schemaVersion'] != 1
            or not isinstance(catalog['games'], list)):
        raise GameAssetError('Invalid game asset ledger or catalog schema')
    files = ledger['files']
    actual = {p.relative_to(web).as_posix() for p in (web / 'games').rglob('*')
              if p.is_file() or p.is_symlink()} if (web / 'games').exists() else set()
    if set(files) != actual:
        raise GameAssetError('Game bytes differ from the exact approved ledger')
    if (web / 'games').is_symlink():
        raise GameAssetError('Game directory cannot be a symlink')
    result = {}
    for name, record in files.items():
        path = Path(name)
        if (path.is_absolute() or '..' in path.parts or len(path.parts) < 4
                or path.parts[0] != 'games' or not ID.fullmatch(path.parts[1])
                or not VERSION.fullmatch(path.parts[2])
                or name != path.as_posix()
                or path.parts[3:] not in ((f'{path.parts[1]}.cjr',),
                                         ('LICENSE.txt',), ('EXPORT.json',),
                                         ('THIRD_PARTY_NOTICES.md',),
                                         ('LICENSES', 'BSD-3-Clause.txt'))):
            raise GameAssetError(f'Unexpected game asset path: {name}')
        target = web / path
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(web.resolve()):
            raise GameAssetError(f'Unsafe game asset: {name}')
        payload = _read_bounded(target, MAX_CJR_BYTES if target.suffix.lower() == '.cjr'
                                else MAX_META_BYTES)
        if (not isinstance(record, dict) or set(record) != {'size', 'sha256'}
                or not isinstance(record['size'], int) or record['size'] != len(payload)
                or not isinstance(record['sha256'], str) or not HASH.fullmatch(record['sha256'])
                or hashlib.sha256(payload).hexdigest() != record['sha256']):
            raise GameAssetError(f'Game asset hash or size mismatch: {name}')
        result[name] = payload
    versions = {(Path(name).parts[1], Path(name).parts[2]) for name in result}
    for ident, version in versions:
        prefix = f'games/{ident}/{version}/'
        cjr_name = prefix + f'{ident}.cjr'
        license_name = prefix + 'LICENSE.txt'
        notice_name = prefix + 'EXPORT.json'
        if not {cjr_name, license_name, notice_name}.issubset(result):
            raise GameAssetError('Published version lacks CJR, license, or notice')
        try:
            notice = json.loads(result[notice_name])
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise GameAssetError('Invalid game export notice') from exc
        cjr = result[cjr_name]
        license_text = result[license_name].decode('utf-8', errors='replace')
        if (not isinstance(notice, dict) or notice.get('mode') != 'release'
                or notice.get('id') != ident or notice.get('version') != version
                or notice.get('web_version') != version
                or notice.get('license') not in ('MIT', 'BSD-3-Clause')
                or notice.get('cjr_sha256') != hashlib.sha256(cjr).hexdigest()
                or notice.get('cjr_size') != len(cjr)
                or not isinstance(notice.get('run_command'), str)
                or not RUN.fullmatch(notice['run_command'])
                or notice.get('entry_address') != '0x' + RUN.fullmatch(notice['run_command']).group(1)
                or notice.get('runner_contract') != 1 or notice.get('sdk_contract') != 1
                or not isinstance(notice.get('minimum_runner_version'), str)
                or not VERSION.fullmatch(notice['minimum_runner_version'])
                or tuple(map(int, notice['minimum_runner_version'].split('.'))) > RUNNER_VERSION
                or not 0 < len(cjr) <= MAX_CJR_BYTES
                or not _cjr_contains_entry(cjr, int(notice['entry_address'], 16))
                or (notice['license'] == 'MIT' and 'MIT License' not in license_text)
                or (notice['license'] == 'BSD-3-Clause' and
                    'Redistribution and use in source and binary forms' not in license_text)):
            raise GameAssetError('Published game notice or license is inconsistent')
        if notice['license'] == 'MIT':
            third_party = result.get(prefix + 'THIRD_PARTY_NOTICES.md', b'')
            sdk_license = result.get(prefix + 'LICENSES/BSD-3-Clause.txt', b'')
            if (b'BSD-3-Clause' not in third_party or
                    b'Redistribution and use in source and binary forms' not in sdk_license):
                raise GameAssetError('MIT game lacks complete SDK BSD attribution')
    seen = set()
    for entry in catalog['games']:
        if not isinstance(entry, dict) or set(entry) != {
                'id', 'title', 'version', 'path', 'sha256', 'runCommand'}:
            raise GameAssetError('Invalid game catalog entry')
        ident, version = entry['id'], entry['version']
        if (not isinstance(ident, str) or len(ident) > 64 or not ID.fullmatch(ident)
                or ident in seen or not isinstance(version, str) or not VERSION.fullmatch(version)
                or not isinstance(entry['title'], str) or not entry['title'].strip()
                or len(entry['title']) > 80 or not isinstance(entry['sha256'], str)
                or not HASH.fullmatch(entry['sha256'])
                or not isinstance(entry['runCommand'], str) or not RUN.fullmatch(entry['runCommand'])):
            raise GameAssetError('Invalid game catalog entry fields')
        seen.add(ident)
        prefix = f'games/{ident}/{version}/'
        cjr = prefix + f'{ident}.cjr'
        if entry['path'] != cjr or cjr not in result or prefix + 'LICENSE.txt' not in result:
            raise GameAssetError('Recommended game is missing its immutable CJR or license')
        notice = json.loads(result[prefix + 'EXPORT.json'])
        if notice['title'] != entry['title'] or notice['run_command'] != entry['runCommand']:
            raise GameAssetError('Recommended entry differs from approved notice')
        if (hashlib.sha256(result[cjr]).hexdigest() != entry['sha256']
                or not 0 < len(result[cjr]) <= MAX_CJR_BYTES
                or not _cjr_contains_entry(result[cjr],
                                           int(RUN.fullmatch(entry['runCommand']).group(1), 16))):
            raise GameAssetError('Recommended CJR is invalid')
    if files and not catalog['games']:
        raise GameAssetError('Unreferenced game assets are not allowed')
    return result
