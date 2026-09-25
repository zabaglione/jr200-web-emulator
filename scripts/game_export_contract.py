#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Validate one local jr200-dev game export before it enters a Web site.

This module is deliberately read-only. Validation is not publication approval.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

ID = re.compile(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z')
VERSION = re.compile(r'\d+\.\d+\.\d+\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')
RUN = re.compile(r'A=USR\(\$([0-9A-F]{4})\)\Z')
TITLE_MARKER = re.compile(r'[A-Z0-9 ]{6,32}\Z')
MAX_CJR_BYTES = 1024 * 1024
MAX_META_BYTES = 256 * 1024
RUNNER_VERSION = (0, 3, 0)
ALLOWED_SUFFIXES = frozenset({
    'LICENSE.txt', 'THIRD_PARTY_NOTICES.md',
    'LICENSES/BSD-3-Clause.txt', 'EXPORT.json',
})


class ExportContractError(ValueError):
    """An export must be rejected without changing the destination."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json(path: Path) -> dict:
    try:
        value = json.loads(_safe_file(path.parent, path.name).decode('utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ExportContractError(f'Invalid JSON: {path.name}') from exc
    if not isinstance(value, dict):
        raise ExportContractError(f'Invalid JSON object: {path.name}')
    return value


def _safe_file(root: Path, relative: str) -> bytes:
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or path.as_posix() != relative:
        raise ExportContractError(f'Unsafe path: {relative}')
    target = root / path
    if not target.is_file() or target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise ExportContractError(f'Missing or unsafe file: {relative}')
    limit = MAX_CJR_BYTES if target.suffix.lower() == '.cjr' else MAX_META_BYTES
    if target.stat().st_size > limit:
        raise ExportContractError(f'File exceeds size limit: {relative}')
    with target.open('rb') as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ExportContractError(f'File exceeds size limit: {relative}')
    return data


def _cjr_contains_entry(data: bytes, address: int) -> bool:
    if (len(data) < 39 or data[:4] != b'\x02\x2a\x00\x1a'
            or sum(data[:32]) & 255 != data[32] or data[22] != 1):
        return False
    pos, number, contains = 33, 1, False
    while pos + 6 <= len(data) and data[pos:pos + 2] == b'\x02\x2a':
        current, size_field = data[pos + 2], data[pos + 3]
        if current == 255:
            return size_field == 255 and pos + 6 == len(data) and contains
        size = size_field or 256
        end = pos + 7 + size
        if current != number or end > len(data):
            return False
        if sum(data[pos:end - 1]) & 255 != data[end - 1]:
            return False
        start = (data[pos + 4] << 8) | data[pos + 5]
        if start + size > 65536:
            return False
        contains |= start <= address < start + size
        pos, number = end, number + 1
        if number == 255:
            return False
    return False


def validate_export(root: Path, base_catalog: Path, *,
                    allow_preview: bool = False) -> dict:
    """Return validated bytes/metadata. Candidate exports require local preview mode."""
    if root.is_symlink() or not root.is_dir():
        raise ExportContractError('Export directory is missing or a symlink')
    manifest = _json(root / 'export-manifest.json')
    if manifest.get('schema_version') != 2 or manifest.get('mode') not in ('release', 'preview'):
        raise ExportContractError('Unsupported export schema or mode')
    if manifest['mode'] == 'preview' and not allow_preview:
        raise ExportContractError('Candidate preview cannot enter a release site')
    entry = manifest.get('entry')
    entry_fields = {'id', 'title', 'version', 'path', 'sha256', 'runCommand'}
    if (not isinstance(entry, dict) or not entry_fields.issubset(entry)
            or not set(entry).issubset(entry_fields | {'titleMarker'})):
        raise ExportContractError('Invalid catalog entry')
    ident, version = entry['id'], entry['version']
    if (not isinstance(ident, str) or len(ident) > 64 or not ID.fullmatch(ident)
            or not isinstance(version, str) or not VERSION.fullmatch(version)
            or not isinstance(entry['title'], str) or not entry['title'].strip()
            or len(entry['title']) > 80 or not isinstance(entry['sha256'], str)
            or not HASH.fullmatch(entry['sha256'])
            or not isinstance(entry['runCommand'], str) or not RUN.fullmatch(entry['runCommand'])
            or ('titleMarker' in entry and
                (not isinstance(entry['titleMarker'], str) or
                 not TITLE_MARKER.fullmatch(entry['titleMarker'])))):
        raise ExportContractError('Invalid catalog entry fields')
    prefix = f'games/{ident}/{version}/'
    if entry['path'] != prefix + f'{ident}.cjr':
        raise ExportContractError('CJR path is not fixed to ID and version')
    source = manifest.get('source')
    if (not isinstance(source, dict) or source.get('mode') != manifest['mode']
            or source.get('id') != ident or source.get('web_version') != version
            or source.get('cjr_sha256') != entry['sha256']
            or source.get('run_command') != entry['runCommand']
            or source.get('title_marker') != entry.get('titleMarker')
            or source.get('license') not in ('MIT', 'BSD-3-Clause')
            or source.get('title') != entry['title']
            or not isinstance(source.get('version'), str)
            or not source['version']
            or (manifest['mode'] == 'release' and source['version'] != version)
            or (manifest['mode'] == 'preview' and
                version != (source['version'] if VERSION.fullmatch(source['version']) else '0.0.0'))
            or not isinstance(source.get('source_commit'), str)
            or not COMMIT.fullmatch(source['source_commit'])
            or not isinstance(source.get('cjr_size'), int)
            or not isinstance(source.get('entry_address'), str)
            or source['entry_address'] != '0x' + RUN.fullmatch(entry['runCommand']).group(1)
            or source.get('runner_contract') != 1 or source.get('sdk_contract') != 1
            or not isinstance(source.get('minimum_runner_version'), str)
            or not VERSION.fullmatch(source['minimum_runner_version'])
            or tuple(map(int, source['minimum_runner_version'].split('.'))) > RUNNER_VERSION
            or source.get('hardware') != 'not_run'
            or not isinstance(source.get('package_sha256'), str)
            or not HASH.fullmatch(source['package_sha256'])):
        raise ExportContractError('Source metadata does not match the catalog')
    try:
        base_bytes = _safe_file(base_catalog.parent, base_catalog.name)
        old_catalog = json.loads(base_bytes)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ExportContractError('Invalid base catalog') from exc
    if _sha(base_bytes) != manifest.get('base_catalog_sha256'):
        raise ExportContractError('Base catalog changed since export')
    catalog_bytes = _safe_file(root, 'game-catalog.json')
    if _sha(catalog_bytes) != manifest.get('catalog_sha256'):
        raise ExportContractError('Export catalog hash mismatch')
    try:
        catalog = json.loads(catalog_bytes)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ExportContractError('Invalid export catalog') from exc
    for value in (old_catalog, catalog):
        if (not isinstance(value, dict) or set(value) != {'schemaVersion', 'games'}
                or value['schemaVersion'] != 1 or not isinstance(value['games'], list)):
            raise ExportContractError('Invalid Web catalog schema')
        ids = [game.get('id') for game in value['games'] if isinstance(game, dict)]
        if len(ids) != len(value['games']) or len(ids) != len(set(ids)):
            raise ExportContractError('Duplicate or malformed Web catalog entry')
    before = {game['id']: game for game in old_catalog['games']}
    after = {game['id']: game for game in catalog['games']}
    if after.get(ident) != entry or any(after.get(key) != value for key, value in before.items()
                                        if key != ident) or set(after) != set(before) | {ident}:
        raise ExportContractError('Export changed another game or omitted the selected one')
    files = manifest.get('files')
    if not isinstance(files, dict) or not files:
        raise ExportContractError('Missing export file inventory')
    permitted = {prefix + f'{ident}.cjr'} | {prefix + name for name in ALLOWED_SUFFIXES}
    required = {entry['path'], prefix + 'LICENSE.txt', prefix + 'EXPORT.json'}
    if not required.issubset(files) or not set(files).issubset(permitted):
        raise ExportContractError('Missing or unexpected export file')
    if source['license'] == 'MIT' and not {
            prefix + 'THIRD_PARTY_NOTICES.md',
            prefix + 'LICENSES/BSD-3-Clause.txt'}.issubset(files):
        raise ExportContractError('MIT game using the SDK lacks BSD notices or license')
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    if actual != set(files) | {'game-catalog.json', 'export-manifest.json'}:
        raise ExportContractError('Export directory has an unlisted file')
    payloads = {}
    for name, record in files.items():
        if (not isinstance(record, dict) or set(record) != {'size', 'sha256'}
                or not isinstance(record['size'], int) or record['size'] < 1
                or not isinstance(record['sha256'], str) or not HASH.fullmatch(record['sha256'])):
            raise ExportContractError('Invalid file inventory')
        payload = _safe_file(root, name)
        if len(payload) != record['size'] or _sha(payload) != record['sha256']:
            raise ExportContractError(f'Export file mismatch: {name}')
        payloads[name] = payload
    cjr = payloads[entry['path']]
    if (not 0 < len(cjr) <= MAX_CJR_BYTES or len(cjr) != source['cjr_size']
            or _sha(cjr) != entry['sha256']
            or not _cjr_contains_entry(cjr, int(source['entry_address'], 16))):
        raise ExportContractError('CJR content or entry is invalid')
    license_text = payloads[prefix + 'LICENSE.txt'].decode('utf-8', errors='replace')
    if (not license_text.strip() or
            (source['license'] == 'MIT' and 'MIT License' not in license_text) or
            (source['license'] == 'BSD-3-Clause' and
             'Redistribution and use in source and binary forms' not in license_text)):
        raise ExportContractError('Empty license')
    if source['license'] == 'MIT':
        if (b'BSD-3-Clause' not in payloads[prefix + 'THIRD_PARTY_NOTICES.md']
                or b'Redistribution and use in source and binary forms' not in
                payloads[prefix + 'LICENSES/BSD-3-Clause.txt']):
            raise ExportContractError('SDK BSD attribution is incomplete')
    if json.loads(payloads[prefix + 'EXPORT.json']) != source:
        raise ExportContractError('Export notice does not match source metadata')
    return {'entry': entry, 'source': source, 'catalog': catalog,
            'catalog_bytes': catalog_bytes, 'files': payloads,
            'mode': manifest['mode']}
