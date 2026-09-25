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
TRUSTED_FULL_RUN_ID = 36147671339
TRUSTED_FULL_RUN_ATTEMPT = 1
TRUSTED_RUN_SOURCE_SHA = 'ef43ca81c3f51f01b28c6515588e7ff236652c1f'
TRUSTED_FULL_JOBS = {
    'native (ubuntu-latest)', 'native (macos-latest)',
    'sanitized', 'wasm-codec', 'browser-smoke',
}


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
            ['git', 'diff', '--no-renames', '--name-only',
             '--diff-filter=ACMTD', base, 'HEAD'],
            cwd=ROOT, text=True).splitlines()
    except subprocess.CalledProcessError:
        return None


def _successful_trusted_run() -> bool:
    repository = os.environ.get('GITHUB_REPOSITORY', '')
    token = os.environ.get('GH_TOKEN', '')
    if repository != 'zabaglione/jr200-web-emulator' or not token:
        return False
    base = f'https://api.github.com/repos/{repository}/actions/runs/{TRUSTED_FULL_RUN_ID}'
    headers = {'Authorization': f'Bearer {token}',
               'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28'}
    try:
        with urllib.request.urlopen(urllib.request.Request(base, headers=headers),
                                    timeout=10) as response:
            run = json.load(response)
        with urllib.request.urlopen(urllib.request.Request(
                base + '/jobs?filter=latest&per_page=100', headers=headers),
                timeout=10) as response:
            jobs = json.load(response)['jobs']
    except (OSError, KeyError, ValueError):
        return False
    if not (run.get('head_sha') == TRUSTED_RUN_SOURCE_SHA
            and run.get('conclusion') == 'success'
            and run.get('head_branch') == 'main' and run.get('event') == 'push'
            and run.get('run_attempt') == TRUSTED_FULL_RUN_ATTEMPT
            and run.get('path') == '.github/workflows/ci.yml'):
        return False
    names = [job.get('name') for job in jobs]
    return (set(names) == TRUSTED_FULL_JOBS and len(names) == len(TRUSTED_FULL_JOBS)
            and all(job.get('conclusion') == 'success'
                    and job.get('run_attempt') == TRUSTED_FULL_RUN_ATTEMPT
                    for job in jobs))


def _successful_base_run(commit: str) -> bool:
    """The diff anchor must itself have passed every full-build job."""
    repository = os.environ.get('GITHUB_REPOSITORY', '')
    token = os.environ.get('GH_TOKEN', '')
    if repository != 'zabaglione/jr200-web-emulator' or not token:
        return False
    headers = {'Authorization': f'Bearer {token}',
               'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28'}
    url = (f'https://api.github.com/repos/{repository}/actions/workflows/ci.yml/runs'
           f'?head_sha={commit}&per_page=20')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                    timeout=10) as response:
            runs = json.load(response)['workflow_runs']
        for run in runs:
            if not (run.get('head_sha') == commit and run.get('conclusion') == 'success'
                    and run.get('head_branch') == 'main' and run.get('event') == 'push'
                    and run.get('path') == '.github/workflows/ci.yml'
                    and isinstance(run.get('run_attempt'), int)
                    and isinstance(run.get('id'), int)):
                continue
            jobs_url = (f'https://api.github.com/repos/{repository}/actions/runs/'
                        f'{run["id"]}/jobs?filter=latest&per_page=100')
            with urllib.request.urlopen(urllib.request.Request(jobs_url, headers=headers),
                                        timeout=10) as response:
                payload = json.load(response)
            jobs = payload['jobs']
            matches = {job.get('name'): job for job in jobs
                       if job.get('name') in TRUSTED_FULL_JOBS}
            if (payload.get('total_count') == len(jobs)
                    and set(matches) == TRUSTED_FULL_JOBS
                    and len([job for job in jobs if job.get('name') in TRUSTED_FULL_JOBS])
                    == len(TRUSTED_FULL_JOBS)
                    and all(job.get('conclusion') == 'success'
                            and job.get('run_attempt') == run['run_attempt']
                            for job in matches.values())):
                return True
    except (OSError, KeyError, ValueError, TypeError):
        return False
    return False


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
                and _successful_trusted_run()
                and _successful_base_run(trusted)):
            selected = True
    value = 'true' if selected else 'false'
    if args.output:
        with args.output.open('a', encoding='utf-8') as output:
            output.write(f'game_only={value}\n')
    print(f'game_only={value}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
