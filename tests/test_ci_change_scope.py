# SPDX-License-Identifier: BSD-3-Clause
"""Game-only CI must fail closed for any emulator/source change."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
import io
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import ci_change_scope  # noqa: E402
from ci_change_scope import game_only, pages_game_only  # noqa: E402


class ChangeScopeTests(unittest.TestCase):
    def test_trusted_anchor_requires_exact_full_success(self):
        commit = ci_change_scope.TRUSTED_RUN_SOURCE_SHA
        run = {'head_sha': commit, 'conclusion': 'success', 'head_branch': 'main',
               'event': 'push', 'run_attempt': 1, 'path': '.github/workflows/ci.yml'}
        jobs = {'jobs': [{'name': name, 'conclusion': 'success', 'run_attempt': 1}
                         for name in sorted(ci_change_scope.TRUSTED_FULL_JOBS)]}

        def verify(run_value, jobs_value):
            responses = [io.BytesIO(json.dumps(value).encode())
                         for value in (run_value, jobs_value)]
            with (patch.dict(ci_change_scope.os.environ, {
                    'GITHUB_REPOSITORY': 'zabaglione/jr200-web-emulator',
                    'GH_TOKEN': 'test-token'}),
                  patch.object(ci_change_scope.urllib.request, 'urlopen',
                               side_effect=responses)):
                return ci_change_scope._successful_trusted_run()

        self.assertTrue(verify(run, jobs))
        self.assertFalse(verify({**run, 'run_attempt': 2}, jobs))
        self.assertFalse(verify(run, {'jobs': jobs['jobs'][:-1]}))
        self.assertFalse(verify(run, {'jobs': [*jobs['jobs'][:-1],
            {**jobs['jobs'][-1], 'conclusion': 'skipped'}]}))

    def test_diff_anchor_cannot_be_promoted_from_a_skipped_full_run(self):
        commit = 'b' * 40
        run = {'id': 123, 'head_sha': commit, 'conclusion': 'success',
               'head_branch': 'main', 'event': 'push', 'run_attempt': 1,
               'path': '.github/workflows/ci.yml'}
        jobs = [{'name': name, 'conclusion': 'success', 'run_attempt': 1}
                for name in sorted(ci_change_scope.TRUSTED_FULL_JOBS)]

        def verify(job_values):
            responses = [io.BytesIO(json.dumps({'workflow_runs': [run]}).encode()),
                         io.BytesIO(json.dumps({'total_count': len(job_values),
                                                'jobs': job_values}).encode())]
            with (patch.dict(ci_change_scope.os.environ, {
                    'GITHUB_REPOSITORY': 'zabaglione/jr200-web-emulator',
                    'GH_TOKEN': 'test-token'}),
                  patch.object(ci_change_scope.urllib.request, 'urlopen',
                               side_effect=responses)):
                return ci_change_scope._successful_base_run(commit)

        self.assertTrue(verify(jobs))
        self.assertFalse(verify(jobs[:-1]))
        self.assertFalse(verify([*jobs[:-1], {**jobs[-1], 'conclusion': 'skipped'}]))

    def test_exact_game_distribution_changes(self):
        self.assertTrue(game_only(['web/games/side-catch/0.1.0/side-catch.cjr',
                                   'web/game-catalog.json', 'web/game-assets.json',
                                   'SBOM.spdx.json']))

    def test_source_and_unrelated_changes_require_full_build(self):
        for changes in ([], ['docs/GAME_LINKS.md'], ['src/core/system.cpp'],
                        ['web/game-catalog.json', 'src/core/system.cpp'],
                        ['web/games/../private.cjr', 'web/game-assets.json'],
                        ['web/game-catalog.json', '.github/workflows/pages.yml']):
            with self.subTest(changes=changes):
                self.assertFalse(game_only(changes))

    def test_pages_can_reuse_the_runner_after_a_trusted_anchor_update(self):
        self.assertTrue(pages_game_only([
            'scripts/trusted-fastpath-base.txt', 'web/game-catalog.json',
            'web/games/side-catch/0.1.0/side-catch.cjr']))
        self.assertFalse(pages_game_only([
            'scripts/trusted-fastpath-base.txt', 'web/app.mjs',
            'web/game-catalog.json']))

    def test_main_fails_closed_for_missing_success_multi_commit_and_prior_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            base_file = Path(directory) / 'base.txt'
            base_file.write_text('a' * 40 + '\n')
            def classify(event, changes, since_trusted, successful):
                def diff(base):
                    return changes if base == 'b' * 40 else since_trusted
                with (patch.object(ci_change_scope, 'TRUSTED_BASE_FILE', base_file),
                      patch.object(ci_change_scope, '_diff', side_effect=diff),
                      patch.object(ci_change_scope, '_successful_trusted_run',
                                   return_value=successful),
                      patch.object(ci_change_scope, '_successful_base_run',
                                   return_value=successful),
                      patch.object(sys, 'argv', ['scope', '--event', event,
                                                '--base', 'b' * 40]),
                      redirect_stdout(StringIO()) as output):
                    self.assertEqual(ci_change_scope.main(), 0)
                    return output.getvalue().strip()
            game = ['web/game-catalog.json',
                    'web/games/side-catch/0.1.0/side-catch.cjr']
            self.assertEqual(classify('push', game, game, False), 'game_only=false')
            self.assertEqual(classify('push', ['web/app.mjs', *game], game, True),
                             'game_only=false')
            self.assertEqual(classify('push', game, ['web/app.mjs', *game], True),
                             'game_only=false')
            self.assertEqual(classify('push', game, game, True), 'game_only=true')
            self.assertEqual(classify('pages', ['docs/GAME_LINKS.md'],
                                      ['scripts/trusted-fastpath-base.txt', *game], True),
                             'game_only=true')


if __name__ == '__main__':
    unittest.main()
