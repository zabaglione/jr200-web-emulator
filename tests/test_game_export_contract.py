# SPDX-License-Identifier: BSD-3-Clause
"""Fixture-based public game boundary checks; no manufacturer ROM is used."""
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from game_assets import GameAssetError, validate_assets, validate_immutable_history  # noqa: E402
from game_export_contract import (  # noqa: E402
    ExportContractError, MAX_CJR_BYTES, MAX_META_BYTES, validate_export)
from prepare_game_import import prepare  # noqa: E402


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def cjr():
    header = bytearray(33)
    header[:4] = b'\x02\x2a\x00\x1a'
    header[22] = 1
    header[32] = sum(header[:32]) & 255
    block = bytearray(b'\x02\x2a\x01\x01\x10\x00\x39\x00')
    block[-1] = sum(block[:-1]) & 255
    return bytes(header + block + b'\x02\x2a\xff\xff\x10\x00')


class ExportContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.web = self.root / 'web'
        self.web.mkdir()
        (self.web / 'game-catalog.json').write_bytes(encoded({'schemaVersion': 1, 'games': []}))
        (self.web / 'game-assets.json').write_bytes(encoded({'schemaVersion': 1, 'files': {}}))
        self.export = self.root / 'export'
        self.export.mkdir()
        self.prefix = 'games/test-game/1.0.0/'
        self.entry = {'id': 'test-game', 'title': 'TEST GAME', 'version': '1.0.0',
                      'path': self.prefix + 'test-game.cjr', 'sha256': digest(cjr()),
                      'runCommand': 'A=USR($1000)'}
        self.source = {'id': 'test-game', 'title': 'TEST GAME', 'version': '1.0.0',
                       'web_version': '1.0.0', 'mode': 'release',
                       'license': 'MIT', 'source_commit': 'a' * 40,
                       'cjr_sha256': digest(cjr()), 'cjr_size': len(cjr()),
                       'entry_address': '0x1000', 'run_command': 'A=USR($1000)',
                       'runner_contract': 1, 'sdk_contract': 1,
                       'minimum_runner_version': '0.2.0', 'package_sha256': 'b' * 64,
                       'hardware': 'not_run'}
        self.payloads = {self.entry['path']: cjr(),
                         self.prefix + 'LICENSE.txt': b'MIT License\nPermission granted\n',
                         self.prefix + 'THIRD_PARTY_NOTICES.md': b'SDK: BSD-3-Clause\n',
                         self.prefix + 'LICENSES/BSD-3-Clause.txt':
                             b'Redistribution and use in source and binary forms\n',
                         self.prefix + 'EXPORT.json': encoded(self.source)}
        self.write_export()

    def tearDown(self):
        self.tmp.cleanup()

    def write_export(self):
        for name, payload in self.payloads.items():
            path = self.export / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        catalog_bytes = encoded({'schemaVersion': 1, 'games': [self.entry]})
        (self.export / 'game-catalog.json').write_bytes(catalog_bytes)
        manifest = {'schema_version': 2, 'mode': self.source['mode'],
                    'catalog_action': 'add', 'entry': self.entry, 'source': self.source,
                    'base_catalog_sha256': digest((self.web / 'game-catalog.json').read_bytes()),
                    'catalog_sha256': digest(catalog_bytes),
                    'files': {name: {'size': len(payload), 'sha256': digest(payload)}
                              for name, payload in self.payloads.items()}}
        (self.export / 'export-manifest.json').write_bytes(encoded(manifest))

    def test_release_export_prepare_and_exact_asset_ledger(self):
        checked = validate_export(self.export, self.web / 'game-catalog.json')
        self.assertEqual(checked['entry'], self.entry)
        output = self.root / 'output'
        result = prepare(self.export, self.web, output, 'test-game@1.0.0')
        self.assertEqual(len(result['new_files']), 5)
        for name in result['new_files']:
            path = self.web / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((output / name).read_bytes())
        for name in ('game-catalog.json', 'game-assets.json'):
            (self.web / name).write_bytes((output / name).read_bytes())
        self.assertEqual(validate_assets(self.web)[self.entry['path']], cjr())
        with self.assertRaises(ExportContractError):
            prepare(self.export, self.web, self.root / 'stale', 'test-game@1.0.0')

    def test_preview_is_local_only(self):
        self.source['mode'] = 'preview'
        self.payloads[self.prefix + 'EXPORT.json'] = encoded(self.source)
        self.write_export()
        with self.assertRaises(ExportContractError):
            validate_export(self.export, self.web / 'game-catalog.json')
        self.assertEqual(validate_export(self.export, self.web / 'game-catalog.json',
                                         allow_preview=True)['mode'], 'preview')
        with self.assertRaises(ExportContractError):
            prepare(self.export, self.web, self.root / 'blocked', 'test-game@1.0.0')
        self.assertFalse((self.root / 'blocked').exists())

    def test_new_version_preserves_old_immutable_bytes(self):
        first = self.root / 'first'
        prepare(self.export, self.web, first, 'test-game@1.0.0')
        first_file = self.entry['path']
        for name in (*self.payloads, 'game-catalog.json', 'game-assets.json'):
            path = self.web / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((first / name).read_bytes())
        old_bytes = (self.web / first_file).read_bytes()
        self.prefix = 'games/test-game/1.1.0/'
        self.entry['version'] = '1.1.0'
        self.entry['path'] = self.prefix + 'test-game.cjr'
        self.source['version'] = self.source['web_version'] = '1.1.0'
        self.export = self.root / 'export-next'
        self.export.mkdir()
        self.payloads = {self.entry['path']: cjr(),
                         self.prefix + 'LICENSE.txt': b'MIT License\nPermission granted\n',
                         self.prefix + 'THIRD_PARTY_NOTICES.md': b'SDK: BSD-3-Clause\n',
                         self.prefix + 'LICENSES/BSD-3-Clause.txt':
                             b'Redistribution and use in source and binary forms\n',
                         self.prefix + 'EXPORT.json': encoded(self.source)}
        self.write_export()
        second = self.root / 'second'
        prepare(self.export, self.web, second, 'test-game@1.1.0')
        for name in (*self.payloads, 'game-catalog.json', 'game-assets.json'):
            path = self.web / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((second / name).read_bytes())
        assets = validate_assets(self.web)
        self.assertEqual(assets['games/test-game/1.0.0/test-game.cjr'], old_bytes)
        self.assertEqual(assets[self.entry['path']], cjr())
        self.assertEqual(json.loads((self.web / 'game-catalog.json').read_text())
                         ['games'][0]['version'], '1.1.0')

    def test_tamper_and_stale_catalog_are_rejected_without_output(self):
        (self.export / self.entry['path']).write_bytes(b'wrong')
        with self.assertRaises(ExportContractError):
            prepare(self.export, self.web, self.root / 'blocked', 'test-game@1.0.0')
        self.assertFalse((self.root / 'blocked').exists())
        self.write_export()
        (self.web / 'game-catalog.json').write_bytes(
            encoded({'schemaVersion': 1, 'games': []}) + b'\n')
        with self.assertRaises(ExportContractError):
            prepare(self.export, self.web, self.root / 'blocked', 'test-game@1.0.0')

    def test_traversal_duplicate_id_and_missing_license_are_rejected(self):
        manifest_path = self.export / 'export-manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files']['../outside'] = {'size': 1, 'sha256': 'a' * 64}
        manifest_path.write_bytes(encoded(manifest))
        with self.assertRaises(ExportContractError):
            validate_export(self.export, self.web / 'game-catalog.json')
        self.write_export()
        (self.export / (self.prefix + 'LICENSE.txt')).unlink()
        with self.assertRaises(ExportContractError):
            validate_export(self.export, self.web / 'game-catalog.json')
        self.write_export()
        duplicated = {'schemaVersion': 1, 'games': [self.entry, self.entry]}
        (self.export / 'game-catalog.json').write_bytes(encoded(duplicated))
        manifest = json.loads(manifest_path.read_text())
        manifest['catalog_sha256'] = digest(encoded(duplicated))
        manifest_path.write_bytes(encoded(manifest))
        with self.assertRaises(ExportContractError):
            validate_export(self.export, self.web / 'game-catalog.json')

    def test_asset_ledger_rejects_unlisted_cjr(self):
        path = self.web / self.entry['path']
        path.parent.mkdir(parents=True)
        path.write_bytes(cjr())
        with self.assertRaises(GameAssetError):
            validate_assets(self.web)

    def test_rejects_incompatible_runner_or_missing_sdk_license(self):
        self.source['minimum_runner_version'] = '99.0.0'
        self.payloads[self.prefix + 'EXPORT.json'] = encoded(self.source)
        self.write_export()
        with self.assertRaises(ExportContractError):
            validate_export(self.export, self.web / 'game-catalog.json')
        self.source['minimum_runner_version'] = '0.2.0'
        self.payloads.pop(self.prefix + 'LICENSES/BSD-3-Clause.txt')
        self.payloads[self.prefix + 'EXPORT.json'] = encoded(self.source)
        (self.export / (self.prefix + 'LICENSES/BSD-3-Clause.txt')).unlink()
        self.write_export()
        with self.assertRaises(ExportContractError):
            validate_export(self.export, self.web / 'game-catalog.json')

    def test_rejects_oversized_input_before_reading_it(self):
        with (self.export / self.entry['path']).open('wb') as output:
            output.truncate(MAX_CJR_BYTES + 1)
        with self.assertRaisesRegex(ExportContractError, 'size limit'):
            validate_export(self.export, self.web / 'game-catalog.json')
        self.write_export()
        with (self.web / 'game-assets.json').open('wb') as output:
            output.truncate(MAX_META_BYTES + 1)
        with self.assertRaisesRegex(GameAssetError, 'oversized'):
            validate_assets(self.web)

    def test_committed_version_paths_cannot_be_changed_or_removed(self):
        repository = self.root / 'history'
        asset = repository / 'web/games/test-game/1.0.0/test-game.cjr'
        asset.parent.mkdir(parents=True)
        asset.write_bytes(cjr())
        def git(*args):
            subprocess.run(['git', *args], cwd=repository, check=True,
                           capture_output=True, text=True)
        git('init', '-q')
        git('add', 'web/games/test-game/1.0.0/test-game.cjr')
        git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com',
            'commit', '-q', '-m', 'fixture')
        name = 'web/games/test-game/1.0.0/test-game.cjr'
        validate_immutable_history(repository, {name})
        asset.write_bytes(b'changed')
        with self.assertRaises(GameAssetError):
            validate_immutable_history(repository, {name})
        asset.unlink()
        with self.assertRaises(GameAssetError):
            validate_immutable_history(repository, set())

    def test_shallow_history_is_fetched_or_fails_closed(self):
        bare = self.root / 'bare.git'
        source = self.root / 'source'
        shallow = self.root / 'shallow'
        unavailable = self.root / 'unavailable'
        def git(where, *args):
            return subprocess.run(['git', *args], cwd=where, check=True,
                                  capture_output=True, text=True).stdout.strip()
        git(self.root, 'init', '-q', '--bare', str(bare))
        source.mkdir()
        git(source, 'init', '-q')
        name = 'web/games/test-game/1.0.0/test-game.cjr'
        asset = source / name
        asset.parent.mkdir(parents=True)
        asset.write_bytes(cjr())
        git(source, 'add', name)
        git(source, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com',
            'commit', '-q', '-m', 'fixture')
        git(source, 'remote', 'add', 'origin', str(bare))
        git(source, 'push', 'origin', 'HEAD:refs/heads/main')
        for target in (shallow, unavailable):
            git(self.root, 'clone', '-q', '--depth=1', '--branch=main',
                f'file://{bare}', str(target))
            self.assertEqual(git(target, 'rev-parse', '--is-shallow-repository'), 'true')
        validate_immutable_history(shallow, {name})
        self.assertEqual(git(shallow, 'rev-parse', '--is-shallow-repository'), 'false')
        git(unavailable, 'remote', 'remove', 'origin')
        with self.assertRaises(GameAssetError):
            validate_immutable_history(unavailable, {name})


if __name__ == '__main__':
    unittest.main()
