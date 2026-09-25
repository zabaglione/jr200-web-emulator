# SPDX-License-Identifier: BSD-3-Clause
"""Local pack creation is deterministic and never includes ROM/FONT."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from create_launch_pack import PackError, build_files, write_pack  # noqa: E402


class CreateLaunchPackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.cjr = self.root / 'game.cjr'
        self.cjr.write_bytes(b'\x02\x2a\x00\x1a' + b'\x01' * 40)
        self.launch = self.root / 'launch.txt'
        self.launch.write_text('MLOAD\nA=USR($1000)\n', encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def test_folder_and_zip_include_only_declared_files(self):
        files = build_files(self.cjr, self.launch, 'SIDE CATCH', 'SIDE CATCH')
        self.assertEqual(set(files), {'game.cjr', 'launch.txt', 'pack.json'})
        meta = json.loads(files['pack.json'])
        self.assertEqual(meta['titleMarker'], 'SIDE CATCH')
        folder = self.root / 'bundle'
        write_pack(files, folder)
        self.assertEqual({path.name for path in folder.iterdir()}, set(files))
        archive = self.root / 'bundle.zip'
        write_pack(files, archive)
        with zipfile.ZipFile(archive) as source:
            self.assertEqual(set(source.namelist()), set(files))
            self.assertEqual(source.read('game.cjr'), files['game.cjr'])
        with self.assertRaises(PackError):
            write_pack(files, archive)

    def test_rejects_unverified_auto_text_and_rom_filename(self):
        self.launch.write_text('PRINT "HELLO"\n', encoding='utf-8')
        with self.assertRaises(PackError):
            build_files(self.cjr, self.launch, 'GAME', 'TEST GAME')
        self.assertNotIn('titleMarker', json.loads(build_files(
            self.cjr, self.launch, 'GAME')['pack.json']))
        wrong = self.root / 'JR200.rom'
        wrong.write_bytes(b'X' * 100)
        with self.assertRaises(PackError):
            build_files(wrong, self.launch, 'GAME')


if __name__ == '__main__':
    unittest.main()
