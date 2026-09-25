#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Classify only a main push's exact game-distribution changes."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
GAME_ROOT = 'web/games/'
GAME_META = {'web/game-catalog.json', 'web/game-assets.json',
             'SBOM.spdx.json', 'docs/GAME_LINKS.md'}
TRUSTED_BASE_FILE = ROOT / 'scripts/trusted-fastpath-base.txt'
TRUSTED_META = GAME_META | {'scripts/trusted-fastpath-base.txt'}


def game_only(paths: list[str]) -> bool:
    if not paths or not any(path.startswith(GAME_ROOT) or
                            path in {'web/game-catalog.json', 'web/game-assets.json'}
                            for path in paths):
        return False
    for path in paths:
        if path.startswith(GAME_ROOT):
            parts = path.split('/')
            if len(parts) < 5 or '..' in parts:
                return False
        elif path not in GAME_META:
            return False
    return True


def pages_game_only(paths: list[str]) -> bool:
    return game_only([path for path in paths
                      if path != 'scripts/trusted-fastpath-base.txt'])


def _diff(base: str) -> list[str] | None:
    verified = subprocess.run(['git', 'merge-base', '--is-ancestor', base, 'HEAD'],
                              cwd=ROOT, capture_output=True)
    if verified.returncode != 0:
        return None
    try:
        return subprocess.check_output(
            ['git', 'diff', '--name-only', '--diff-filter=ACMRTD', base, 'HEAD'],
            cwd=ROOT, text=True).splitlines()
    except subprocess.CalledProcessError:
        return None


def _successful_trusted_run(commit: str) -> bool:
    repository = os.environ.get('GITHUB_REPOSITORY', '')
    token = os.environ.get('GH_TOKEN', '')
    if not repository or not token:
        return False
    url = (f'https://api.github.com/repos/{repository}/actions/workflows/ci.yml/runs'
           f'?head_sha={commit}&status=success&per_page=20')
    request = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            runs = json.load(response)['workflow_runs']
    except (OSError, KeyError, ValueError):
        return False
    return any(run.get('head_sha') == commit and run.get('conclusion') == 'success'
               and run.get('head_branch') == 'main'
               and run.get('event') in ('push', 'workflow_dispatch') for run in runs)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event', required=True)
    parser.add_argument('--base', help='push.before; omission checks only HEAD^')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    selected = False
    if args.event in ('push', 'pull_request', 'pages'):
        parent = args.base
        if parent is None and args.event == 'push':
            found = subprocess.run(['git', 'rev-parse', '--verify', 'HEAD^'],
                                   cwd=ROOT, capture_output=True, text=True)
            parent = found.stdout.strip() if found.returncode == 0 else None
        trusted = TRUSTED_BASE_FILE.read_text(encoding='utf-8').strip()
        changed = _diff(parent) if parent else None
        since_trusted = _diff(trusted) if len(trusted) == 40 else None
        event_changes_are_safe = False
        if args.event in ('push', 'pull_request') and changed is not None:
            event_changes_are_safe = game_only(changed)
        elif args.event == 'pages' and since_trusted is not None:
            event_changes_are_safe = pages_game_only(since_trusted)
        if (since_trusted is not None and event_changes_are_safe
                and all(path.startswith(GAME_ROOT) or path in TRUSTED_META
                        for path in since_trusted)
                and _successful_trusted_run(trusted)):
            selected = True
    value = 'true' if selected else 'false'
    if args.output:
        with args.output.open('a', encoding='utf-8') as output:
            output.write(f'game_only={value}\n')
    print(f'game_only={value}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
