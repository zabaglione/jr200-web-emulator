// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {fetchGame, requestedGame, validateGameCatalog} from '../web/game-launch.mjs';

const entry = {
  id: 'side-catch', title: 'SIDE CATCH', version: '1.0.0',
  path: 'games/side-catch/1.0.0/side-catch.cjr',
  sha256: 'a'.repeat(64), runCommand: 'A=USR($1000)',
};
const catalog = game => ({schemaVersion: 1, games: [game]});
assert.equal(requestedGame(''), null);
assert.equal(requestedGame('?game=side-catch'), 'side-catch');
for (const search of ['?game=', '?game=../rom', '?game=https://example.test/a',
  '?game=side-catch&game=other', '?game=UPPER', '?game=a--b']) {
  assert.throws(() => requestedGame(search), /ゲームID/);
}
assert.equal(validateGameCatalog({schemaVersion: 1, games: []}).size, 0);
assert.equal(validateGameCatalog(catalog(entry)).get('side-catch'), entry);
for (const patch of [
  {path: '../outside.cjr'}, {path: 'https://evil.test/game.cjr'},
  {version: '../1'}, {sha256: 'bad'}, {title: ''},
  {runCommand: 'DELETE ALL'}, {id: 'other'},
]) {
  assert.throws(() => validateGameCatalog(catalog({...entry, ...patch})), /登録内容/);
}
assert.throws(() => validateGameCatalog({schemaVersion: 1, games: [entry, entry]}), /登録内容/);

const bytes = new Uint8Array([2, 42, 0, 26, 1, 2, 3, 4]);
const digest = await crypto.subtle.digest('SHA-256', bytes);
const sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
const fixed = {...entry, sha256};
const base = new URL('https://example.test/jr200/');
const requests = [];
const fetcher = async (url, options) => {
  requests.push({url, options});
  if (url.endsWith('/game-catalog.json')) return {ok: true, json: async () => catalog(fixed)};
  return {ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer};
};
const game = await fetchGame('side-catch', base, fetcher);
assert.deepEqual(game.bytes, bytes);
assert.equal(requests[0].url, 'https://example.test/jr200/game-catalog.json');
assert.equal(requests[1].url, 'https://example.test/jr200/' + fixed.path);
assert.equal(requests.every(request => request.options.mode === 'same-origin'
  && request.options.credentials === 'omit'), true);
await assert.rejects(fetchGame('missing', base, fetcher), /見つかりません/);
await assert.rejects(fetchGame('side-catch', base, async () => ({ok: false})), /カタログ/);
await assert.rejects(fetchGame('side-catch', base, async url => url.endsWith('game-catalog.json')
  ? {ok: true, json: async () => catalog(entry)}
  : {ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer}), /SHA-256/);
await assert.rejects(fetchGame('side-catch', base, async url => url.endsWith('game-catalog.json')
  ? {ok: true, json: async () => catalog(fixed)}
  : {ok: true, headers: new Headers({'content-length': '1048577'})}), /容量上限/);
await assert.rejects(fetchGame('side-catch', base, () => new Promise(() => {}), 5), /時間切れ/);
console.log('PASS game link: ID, catalog, same-origin path, SHA-256, and size guards');
