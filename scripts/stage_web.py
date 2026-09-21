#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Stage a local website with mandatory notices. Does not publish anything."""
import argparse
import shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--backend', choices=['clang','emscripten'], required=True)
a = p.parse_args()
site = ROOT / 'build/site'
site.mkdir(parents=True, exist_ok=True)
for file in (ROOT / 'web').iterdir():
    if file.is_file(): shutil.copy2(file, site / file.name)
shutil.copy2(ROOT / 'LICENSE', site / 'LICENSE.txt')
shutil.copy2(ROOT / 'THIRD_PARTY_NOTICES.md', site / 'THIRD_PARTY_NOTICES.md')
shutil.copytree(ROOT / 'LICENSES', site / 'LICENSES', dirs_exist_ok=True)
if a.backend == 'clang':
    shutil.copy2(ROOT / 'build/wasm-smoke/jr200_codec.wasm', site / 'jr200_codec.wasm')
else:
    shutil.copy2(ROOT / 'build/emscripten/web/jr200_codec.mjs', site / 'jr200_codec.mjs')
    shutil.copy2(ROOT / 'build/emscripten/web/jr200_codec.wasm', site / 'jr200_codec.wasm')
(site / 'backend.json').write_text('{"backend":"' + a.backend + '"}\n')
print('Staged local JR-200 emulator:', site)
