#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""A targeted source/notice guard, not a claim of a complete legal audit."""
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
raw=(ROOT/'LICENSES/VJR200.txt').read_bytes()
blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
assert blob=='8cad34867bad988f97fc237a9259e338f0bedf99','Upstream license bytes changed'
mame=(ROOT/'LICENSES/MAME_BSD-3-Clause.txt').read_bytes()
mame_blob=hashlib.sha1(b'blob '+str(len(mame)).encode()+b'\0'+mame).hexdigest()
assert mame_blob=='cc9ab753198e41128dc651e0adb4f5e8c1be932a','MAME BSD license bytes changed'
assert (ROOT/'LICENSE').exists() and (ROOT/'THIRD_PARTY_NOTICES.md').exists()
assert (ROOT/'.emscripten-version').read_text().strip()=='6.0.9'
html=(ROOT/'web/index.html').read_text()
assert 'LICENSES/VJR200.txt' in html and 'LICENSES/MAME_BSD-3-Clause.txt' in html
assert 'THIRD_PARTY_NOTICES.md' in html
assert 'value="100">600（フラグ100）' in html
for f in ['src/tape/cjr.cpp','include/jr200/cjr.hpp',
          'src/tape/cassette.cpp','include/jr200/cassette.hpp']:
    t=(ROOT/f).read_text();assert 'FIND' in t and 'SPDX-License-Identifier: BSD-3-Clause' in t
    assert not any(token in t for token in ['stdafx.h','cereal::','TCHAR','DirectSound',
                                            'Direct2D','windows.h','fopen(','ofstream'])
for f in ['src/core/m6800.cpp','src/core/6800ops.hxx','src/core/6800tbl.hxx','include/jr200/m6800.hpp']:
    t=(ROOT/f).read_text();assert 'Aaron Giles' in t and 'SPDX-License-Identifier: BSD-3-Clause' in t
    assert not any(token in t for token in ['JRSystem','stdafx.h','cereal::','TCHAR','DirectSound','Direct2D'])
for f in ['include/jr200/peripherals.hpp','src/core/peripherals.cpp','src/core/system.cpp']:
    t=(ROOT/f).read_text();assert 'FIND' in t and 'SPDX-License-Identifier: BSD-3-Clause' in t
    assert not any(token in t for token in ['stdafx.h','cereal::','TCHAR','DirectSound','Direct2D','MMSystem.h','windows.h'])
for f in ['include/jr200/peripherals.hpp','include/jr200/system.hpp','src/core/peripherals.cpp','src/core/system.cpp']:
    t=(ROOT/f).read_text()
    assert not any(token in t for token in ['system_clock','steady_clock','high_resolution_clock','requestAnimationFrame'])
manifest=ROOT/'source-manifest.json'
if manifest.exists():
    forbidden={'.rom','.bin','.wav','.cjr','.jr2','.d88','.d20','.exe','.dll','.wasm'}
    files=json.loads(manifest.read_text())['files']
    required={'include/jr200/m6800.hpp','src/core/m6800.cpp','src/core/6800ops.hxx',
              'src/core/6800tbl.hxx','src/wasm/cpu_api.cpp','tests/test_m6800.cpp',
              'tests/cpu_wasm_smoke.mjs','LICENSES/MAME_BSD-3-Clause.txt',
              'include/jr200/peripherals.hpp','include/jr200/system.hpp',
              'include/jr200/debugger.hpp','src/core/debugger.cpp',
              'include/jr200/cassette.hpp','src/tape/cassette.cpp',
              'src/core/peripherals.cpp','src/core/system.cpp','src/wasm/system_api.cpp',
              'src/wasm/freestanding_memory.cpp',
              'tests/test_system.cpp','tests/test_cassette.cpp','tests/system_wasm_smoke.mjs',
              'tests/emscripten_smoke.mjs','tests/webdriver_real_rom_smoke.py',
              'docs/P05_PERIPHERAL_AUDIT.md','docs/P06_BROWSER_ACCEPTANCE.md',
              'docs/P07_DEBUGGER_ACCEPTANCE.md','docs/P08_CASSETTE_ACCEPTANCE.md',
              '.emscripten-version','scripts/check_emscripten_version.py'}
    assert required.issubset(files),'CPU source or license missing from source inventory'
    for f in files:
        p=Path(f)
        assert not p.is_absolute() and '..' not in p.parts,f
        assert p.suffix.lower() not in forbidden,f
        path=ROOT/p
        assert path.is_file() and not path.is_symlink(),f
        assert path.resolve().is_relative_to(ROOT.resolve()),f
print('PASS distribution guard: exact FIND/MAME licenses, source notices, web links, source-only inventory')
