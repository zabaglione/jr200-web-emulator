# SPDX-License-Identifier: BSD-3-Clause
"""The game-only runner path must reject changed source and corrupt downloads."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import stage_public_runner  # noqa: E402


class PublicRunnerTests(unittest.TestCase):
    def test_source_change_fails_before_download(self):
        with (patch.object(stage_public_runner, 'core_source_sha256', return_value='0' * 64),
              patch.object(stage_public_runner, 'download_verified') as download):
            with self.assertRaisesRegex(ValueError, 'core source set'):
                stage_public_runner.stage()
            download.assert_not_called()

    def test_exact_size_and_hash_are_required(self):
        class Response:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def geturl(self):
                return stage_public_runner.PUBLIC_BASE + 'test.wasm'

            def read(self, length):
                return self.payload[:length]

        for payload in (b'abc', b'abcd', b'xabcd'):
            with (self.subTest(payload=payload),
                  patch.object(stage_public_runner.urllib.request, 'urlopen',
                               return_value=Response(payload))):
                with self.assertRaisesRegex(ValueError, 'mismatch'):
                    stage_public_runner.download_verified('test.wasm', 5, '0' * 64)

    def test_source_fingerprint_changes_with_core_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'src').mkdir()
            (root / 'src/core.cpp').write_bytes(b'a')
            first = stage_public_runner.core_source_sha256(root)
            (root / 'src/core.cpp').write_bytes(b'b')
            self.assertNotEqual(first, stage_public_runner.core_source_sha256(root))


if __name__ == '__main__':
    unittest.main()
