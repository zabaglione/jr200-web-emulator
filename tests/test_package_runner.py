# SPDX-License-Identifier: BSD-3-Clause
"""Synthetic packaging tests; no manufacturer assets or Emscripten build needed."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from package_runner import ASSET_NAME, PackageError, package


class RunnerPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        self.output = self.root / 'output' / ASSET_NAME
        self.data = {
            'jr200_codec.mjs': b'export default function() {}',
            'jr200_codec.wasm': b'\x00asm\x01\x00\x00\x00',
            'LICENSE.txt': b'license',
            'THIRD_PARTY_NOTICES.md': b'notices',
            'SBOM.spdx.json': b'{}',
            'LICENSES/Emscripten-6.0.9.txt': b'emscripten',
            'LICENSES/VJR200.txt': b'vjr200',
            'LICENSES/MAME_BSD-3-Clause.txt': b'mame',
            'LICENSES/libcxxabi-6.0.9.txt': b'libcxxabi',
        }
        for name, content in self.data.items():
            if name == 'LICENSE.txt':
                path = self.root / 'LICENSE'
            elif name.startswith('jr200_codec.'):
                path = self.bundle / name
            else:
                path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        self.records = {
            name: (len(content), hashlib.sha256(content).hexdigest())
            for name, content in self.data.items()
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_deterministic_license_complete_archive(self):
        size, digest = package(self.bundle, self.root, self.output, self.records)
        self.assertEqual((size, digest), package(
            self.bundle, self.root, self.output, self.records))
        self.assertEqual(self.output.stat().st_size, size)
        self.assertEqual(hashlib.sha256(self.output.read_bytes()).hexdigest(), digest)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.namelist(), sorted(self.data))
            for name, data in self.data.items():
                self.assertEqual(archive.read(name), data)
                self.assertEqual(archive.getinfo(name).external_attr >> 16, 0o100644)

    def test_changed_module_or_notice_is_rejected_without_output(self):
        (self.bundle / 'jr200_codec.wasm').write_bytes(b'changed')
        with self.assertRaises(PackageError):
            package(self.bundle, self.root, self.output, self.records)
        self.assertFalse(self.output.exists())
        (self.bundle / 'jr200_codec.wasm').write_bytes(self.data['jr200_codec.wasm'])
        (self.root / 'LICENSE').write_bytes(b'changed')
        with self.assertRaises(PackageError):
            package(self.bundle, self.root, self.output, self.records)
        self.assertFalse(self.output.exists())

    def test_extra_rom_and_existing_output_are_rejected(self):
        (self.bundle / 'unlisted.rom').write_bytes(b'not for distribution')
        with self.assertRaisesRegex(PackageError, 'inventory'):
            package(self.bundle, self.root, self.output, self.records)
        (self.bundle / 'unlisted.rom').unlink()
        self.output.parent.mkdir(parents=True)
        self.output.write_bytes(b'existing')
        with self.assertRaisesRegex(PackageError, 'refusing overwrite'):
            package(self.bundle, self.root, self.output, self.records)
        self.assertEqual(self.output.read_bytes(), b'existing')

    def test_oversized_existing_output_is_rejected_without_reading_it(self):
        self.output.parent.mkdir(parents=True)
        with self.output.open('wb') as existing:
            existing.truncate(8 * 1024 * 1024 * 1024)
        with self.assertRaisesRegex(PackageError, 'refusing overwrite'):
            package(self.bundle, self.root, self.output, self.records)
        self.assertEqual(self.output.stat().st_size, 8 * 1024 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
