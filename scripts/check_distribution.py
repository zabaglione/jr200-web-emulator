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
assert (ROOT/'LICENSE').exists() and (ROOT/'THIRD_PARTY_NOTICES.md').exists()
html=(ROOT/'web/index.html').read_text()
assert 'LICENSES/VJR200.txt' in html and 'THIRD_PARTY_NOTICES.md' in html
for f in ['src/tape/cjr.cpp','include/jr200/cjr.hpp']:
    t=(ROOT/f).read_text();assert 'FIND' in t and 'SPDX-License-Identifier: BSD-3-Clause' in t
manifest=ROOT/'source-manifest.json'
if manifest.exists():
    forbidden={'.rom','.bin','.wav','.cjr','.jr2','.d88','.d20','.exe','.dll','.wasm'}
    for f in json.loads(manifest.read_text())['files']:
        p=Path(f)
        assert not p.is_absolute() and '..' not in p.parts,f
        assert p.suffix.lower() not in forbidden,f
        path=ROOT/p
        assert path.is_file() and not path.is_symlink(),f
        assert path.resolve().is_relative_to(ROOT.resolve()),f
print('PASS distribution guard: exact FIND license, source notices, web links, source-only inventory')
