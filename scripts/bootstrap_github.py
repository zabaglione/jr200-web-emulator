#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Create PRIVATE repo, create ordered issues, then push ONLY the source manifest.
Default is dry-run. Needs locally authenticated GitHub CLI; no token is requested.
Never publishes a site, never changes visibility, never force-pushes or closes issues.
"""
from __future__ import annotations
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTION = 'Private JR-200 C++/WASM port; upstream attribution retained; ROMs excluded'
STATE = ROOT / '.github-bootstrap-state.json'

class BootstrapError(RuntimeError):
    pass

class CommandError(BootstrapError):
    def __init__(self, args: list[str], result: subprocess.CompletedProcess[str]):
        self.args_list, self.result = args, result
        super().__init__(f"Command failed ({result.returncode}): {' '.join(args)}\n{result.stderr.strip()}")

def run(args: list[str], *, cwd: Path = ROOT) -> str:
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)
    if result.returncode:
        raise CommandError(args, result)
    return result.stdout.strip()

def validate_name(repo: str) -> tuple[str, str]:
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repo):
        raise BootstrapError('Use an explicit OWNER/REPO name.')
    owner, name = repo.split('/')
    return owner, name

def validate_private(meta: dict[str, Any], repo: str) -> None:
    if meta.get('full_name', '').lower() != repo.lower():
        raise BootstrapError('Repository identity does not match the requested target.')
    if meta.get('private') is not True or meta.get('visibility', 'private') != 'private':
        raise BootstrapError('Refusing writes: target is not private. Visibility will not be changed.')
    if meta.get('fork') is True:
        raise BootstrapError('This bootstrap expects an independent repository, not a fork.')

def load_plan(root: Path = ROOT) -> list[dict[str, Any]]:
    rows = json.loads((root / 'docs/issues/manifest.json').read_text())
    seen: set[str] = set()
    for row in rows:
        key = row['id']
        if key in seen or not re.fullmatch(r'P\d{2}', key):
            raise BootstrapError('Duplicate or invalid plan id.')
        if any(dep not in seen for dep in row['depends_on']):
            raise BootstrapError(f'{key}: dependency is missing or out of order.')
        body = (root / row['file']).read_text()
        if f'<!-- jr200-plan:{key} -->' not in body:
            raise BootstrapError(f'{key}: stable issue marker is missing.')
        seen.add(key)
    return rows

def source_inventory(root: Path = ROOT) -> list[str]:
    files = json.loads((root / 'source-manifest.json').read_text())['files']
    forbidden = {'.rom','.bin','.wav','.cjr','.jr2','.d20','.d88','.wasm','.zip','.exe','.dll'}
    for item in files:
        path = Path(item)
        if path.is_absolute() or '..' in path.parts or path.suffix.lower() in forbidden:
            raise BootstrapError(f'Unsafe source path: {item}')
        candidate = root / path
        if candidate.is_symlink() or not candidate.is_file() or not candidate.resolve().is_relative_to(root.resolve()):
            raise BootstrapError(f'Missing or unsafe source file: {item}')
    if len(files) != len(set(files)):
        raise BootstrapError('Duplicate paths in source manifest.')
    return files

def repository_meta(repo: str) -> dict[str, Any] | None:
    try:
        return json.loads(run(['gh','api',f'repos/{repo}']))
    except CommandError as exc:
        # Authentication/network errors MUST NOT be misinterpreted as absence.
        if 'HTTP 404' in exc.result.stderr:
            return None
        raise

def write_state(state: dict[str, Any]) -> None:
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
    tmp.replace(STATE)

def render_body(body: str, mapping: dict[str, int]) -> str:
    for key, number in mapping.items():
        body = body.replace('{{'+key+'}}', f'#{number}')
    if re.search(r'\{\{P\d{2}\}\}', body):
        raise BootstrapError('Unresolved issue dependency.')
    return body

def execute(repo: str, resume: bool, rows: list[dict[str, Any]], files: list[str]) -> dict[str, Any]:
    owner, _ = validate_name(repo)
    for command in ['gh','git']:
        if not shutil.which(command):
            raise BootstrapError(f'{command} is required. Install/authenticate it locally before execution.')
    actor = json.loads(run(['gh','api','user']))
    if actor.get('login', '').lower() != owner.lower():
        raise BootstrapError(f'Authenticated owner is {actor.get("login")!r}, not {owner!r}; no changes made.')
    for key in ['user.name','user.email']:
        if not run(['git','config','--get',key]):
            raise BootstrapError(f'Set git config {key} before running this script.')
    # Validate locally before the first remote write.
    run([sys.executable, str(ROOT/'scripts/check_distribution.py')])
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if (ROOT/'.git').exists() and not state:
        raise BootstrapError('Existing local .git is not managed by this bootstrap; refusing to alter it.')
    meta = repository_meta(repo)
    if meta is not None:
        validate_private(meta,repo)
        if not resume or state.get('repo') != repo or state.get('repository_id') != meta.get('id'):
            raise BootstrapError('Target already exists. Resume only a recorded run with --resume; no adoption or overwrite.')
    else:
        if state and state.get('repo') != repo:
            raise BootstrapError('Local bootstrap state belongs to a different repository.')
        run(['gh','repo','create',repo,'--private','--description',DESCRIPTION])
        meta = repository_meta(repo)
        if meta is None:
            raise BootstrapError('Creation returned but repository could not be verified. No issues or code were uploaded.')
        validate_private(meta,repo)
        state = {'repo':repo,'repository_id':meta['id'],'issues':{},'uploaded':False}
        write_state(state)
    if state.get('uploaded') is True:
        raise BootstrapError('Initial upload is already complete; this script is not a general push tool.')
    current = json.loads(run(['gh','issue','list','--repo',repo,'--state','all','--limit','1000','--json','number,title,body,url']))
    mapping: dict[str,int] = {}
    for row in rows:
        key = row['id']; marker = f'<!-- jr200-plan:{key} -->'
        matches = [issue for issue in current if marker in (issue.get('body') or '')]
        if len(matches) > 1:
            raise BootstrapError(f'Multiple issues have the same plan marker: {key}')
        if matches:
            number, url = matches[0]['number'], matches[0]['url']
        else:
            if any(issue['title'] == row['title'] for issue in current):
                raise BootstrapError(f'Title collision without stable marker: {row["title"]}')
            body = render_body((ROOT/row['file']).read_text(),mapping)
            validate_private(repository_meta(repo) or {},repo)
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp)/'body.md'; path.write_text(body)
                url = run(['gh','issue','create','--repo',repo,'--title',row['title'],'--body-file',str(path)])
            match = re.fullmatch(r'https://github\.com/[^/]+/[^/]+/issues/(\d+)',url)
            if not match:
                raise BootstrapError('Unexpected issue-create output; stopping rather than guessing the issue number.')
            number = int(match.group(1))
        mapping[key]=number
        state['issues'][key]={'number':number,'url':url}
        write_state(state)
        print(f'{key}: {url}')
    # All issues are registered before pushing the local implementation.
    if not (ROOT/'.git').exists():
        run(['git','init','-b','main'])
    run(['git','add','--',*files])
    staged = run(['git','diff','--cached','--name-only']).splitlines()
    if any(path not in files for path in staged):
        raise BootstrapError('Unexpected staged file; refusing to commit or push.')
    if staged:
        run(['git','commit','-m','feat: add audited CJR foundation, tests and ordered development plan'])
    remotes = run(['git','remote']).splitlines()
    expected_remote = f'https://github.com/{repo}.git'
    if 'origin' in remotes:
        if run(['git','remote','get-url','origin']) != expected_remote:
            raise BootstrapError('origin does not match the intended repository.')
    else:
        run(['git','remote','add','origin',expected_remote])
    # A resume must not smuggle previously committed files outside the allowlist.
    if run(['git','branch','--show-current']) != 'main':
        raise BootstrapError('Expected the main branch; refusing to push a different branch.')
    for commit in run(['git','rev-list','main']).splitlines():
        tracked = run(['git','ls-tree','-r','--name-only',commit]).splitlines()
        if any(path not in files for path in tracked):
            raise BootstrapError('A committed file is outside the source inventory; refusing to push history.')
    validate_private(repository_meta(repo) or {},repo)
    # gh installs its Git credential helper for this invocation only, not globally.
    run(['git','-c','credential.https://github.com.helper=!gh auth git-credential','push','-u','origin','main'])
    state['uploaded']=True
    state['commit']=run(['git','rev-parse','HEAD'])
    write_state(state)
    return state

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',default='zabaglione/jr200-web-emulator')
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--resume',action='store_true')
    args=parser.parse_args()
    try:
        validate_name(args.repo); rows=load_plan(); files=source_inventory()
        if not args.execute:
            print(f'DRY RUN: create PRIVATE {args.repo}; create {len(rows)} ordered issues; push {len(files)} source files.')
            for row in rows: print(row['title'])
            print('No remote changes. Run again with --execute to perform these operations.')
            return 0
        state=execute(args.repo,args.resume,rows,files)
        print(json.dumps(state,ensure_ascii=False,indent=2))
        return 0
    except (BootstrapError,OSError,ValueError,KeyError) as exc:
        print(f'error: {exc}',file=sys.stderr); return 1
if __name__=='__main__':
    raise SystemExit(main())
