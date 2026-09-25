#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Stage a local website with mandatory notices. Does not publish anything."""
import argparse
import shutil
from pathlib import Path
from game_assets import validate_assets
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--backend', choices=['clang','emscripten'], required=True)
a = p.parse_args()
game_files = validate_assets(ROOT / 'web')
site = ROOT / 'build/site'
if site.exists():
    shutil.rmtree(site)
site.mkdir(parents=True, exist_ok=True)
for file in (ROOT / 'web').iterdir():
    if file.is_file(): shutil.copy2(file, site / file.name)
for name, payload in game_files.items():
    target = site / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
shutil.copy2(ROOT / 'LICENSE', site / 'LICENSE.txt')
shutil.copy2(ROOT / 'THIRD_PARTY_NOTICES.md', site / 'THIRD_PARTY_NOTICES.md')
shutil.copy2(ROOT / 'SBOM.spdx.json', site / 'SBOM.spdx.json')
shutil.copytree(ROOT / 'LICENSES', site / 'LICENSES', dirs_exist_ok=True)
if a.backend == 'clang':
    shutil.copy2(ROOT / 'build/wasm-smoke/jr200_codec.wasm', site / 'jr200_codec.wasm')
else:
    shutil.copy2(ROOT / 'build/emscripten/web/jr200_codec.mjs', site / 'jr200_codec.mjs')
    shutil.copy2(ROOT / 'build/emscripten/web/jr200_codec.wasm', site / 'jr200_codec.wasm')
(site / 'backend.json').write_text('{"backend":"' + a.backend + '"}\n')
expected = {
    'LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'SBOM.spdx.json', 'LICENSES',
    'app.mjs', 'audio.mjs', 'codec.mjs', 'keyboard.mjs', 'game-launch.mjs',
    'game-catalog.json', 'game-assets.json', 'index.html', 'style.css',
    'jr200_codec.wasm', 'backend.json',
}
if a.backend == 'emscripten':
    expected.add('jr200_codec.mjs')
if game_files:
    expected.add('games')
actual = {path.name for path in site.iterdir()}
if actual != expected:
    raise SystemExit(f'Unexpected staged site entries: {sorted(actual ^ expected)}')
print('Staged local JR-200 emulator:', site)
