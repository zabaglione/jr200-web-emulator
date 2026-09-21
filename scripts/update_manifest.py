#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Maintain an explicit allowlist of source files for initial upload."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
top_files=['README.md','LICENSE','THIRD_PARTY_NOTICES.md','AGENTS.md','CMakeLists.txt','Makefile','.gitignore','.gitattributes','.editorconfig','source-manifest.json']
files=[x for x in top_files if (root/x).is_file() or x=='source-manifest.json']
for folder in ['include','src','tests','tools','scripts','docs','LICENSES','web','.github']:
 for p in (root/folder).rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc':
   files.append(p.relative_to(root).as_posix())
(root/'source-manifest.json').write_text(json.dumps({'files':sorted(set(files))},ensure_ascii=False,indent=2)+'\n')
print(f'Updated source inventory: {len(set(files))} files. Run make check before upload.')
