// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {basicInputReady, fetchGame, launchImageMatches, readyPromptRows,
  requestedAutoLaunch, requestedGame, supportsAutomaticBasic, validateGameCatalog,
  validateLaunchImage, titleMarkerVisible} from '../web/game-launch.mjs';

const entry = {
  id: 'side-catch', title: 'SIDE CATCH', version: '1.0.0',
  path: 'games/side-catch/1.0.0/side-catch.cjr',
  sha256: 'a'.repeat(64), runCommand: 'A=USR($1000)', titleMarker: 'SIDE CATCH',
};
const catalog = game => ({schemaVersion: 1, games: [game]});
assert.equal(requestedGame(''), null);
assert.equal(requestedGame('?game=side-catch'), 'side-catch');
assert.equal(requestedAutoLaunch('?game=side-catch'), false);
assert.equal(requestedAutoLaunch('?game=side-catch&launch=1'), true);
for (const search of ['?launch=1', '?game=side-catch&launch=true',
  '?game=side-catch&launch=1&launch=1']) {
  assert.throws(() => requestedAutoLaunch(search), /起動指定/);
}
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
  {titleMarker: 'READY\nDELETE'},
]) {
  assert.throws(() => validateGameCatalog(catalog({...entry, ...patch})), /登録内容/);
}
assert.throws(() => validateGameCatalog({schemaVersion: 1, games: [entry, entry]}), /登録内容/);

const image = new Uint8Array(33 + 8 + 6);
image.set([2, 42, 0, 26], 0);
image[22] = 1;
image.set([2, 42, 1, 1, 0x10, 0, 0x39], 33);
image.set([2, 42, 255, 255, 0x10, 1], 41);
const imageSummary = {hasHeader: 1, fileType: 1, dataBlocks: 1, warnings: 0};
const launchImage = validateLaunchImage(entry, image, imageSummary);
assert.equal(launchImage.entryAddress, 0x1000);
assert.equal(launchImage.loadBlocks.length, 1);
const loaded = new Uint8Array(65536);
loaded[0x1000] = 0x39;
assert.equal(launchImageMatches(launchImage.loadBlocks, address => loaded[address]), true);
loaded[0x1000] = 0;
assert.equal(launchImageMatches(launchImage.loadBlocks, address => loaded[address]), false);
const screen = new Uint8Array(65536);
screen.set(new TextEncoder().encode('Ready'), 0xc100 + 4 * 32);
assert.deepEqual(readyPromptRows(address => screen[address]), [4]);
screen.set(new TextEncoder().encode('Ready'), 0xc100 + 8 * 32);
assert.deepEqual(readyPromptRows(address => screen[address]), [4, 8]);
const machine = {
  registers: () => ({pc: 0xe896, sp: 0x07f7}),
  peek: address => screen[address],
};
assert.equal(basicInputReady(machine), true);
assert.equal(basicInputReady({...machine, registers: () => ({pc: 0xe3fb, sp: 0x07ed})}), false);
assert.equal(titleMarkerVisible(address => screen[address], 'SIDE CATCH'), false);
screen.set(new TextEncoder().encode('SIDE CATCH'), 0xc100 + 10 * 32);
assert.equal(titleMarkerVisible(address => screen[address], 'SIDE CATCH'), true);
assert.equal(await supportsAutomaticBasic(new Uint8Array(16384)), false);
assert.throws(() => validateLaunchImage({...entry, runCommand: 'A=USR($1001)'}, image,
  imageSummary), /ロード範囲外/);
assert.throws(() => validateLaunchImage(entry, image, {...imageSummary, fileType: 0}),
  /マシン語CJR/);
assert.throws(() => validateLaunchImage(entry, image, {...imageSummary, warnings: 1}),
  /マシン語CJR/);
assert.throws(() => validateLaunchImage(entry, image.subarray(0, 42), imageSummary),
  /ブロック長|ブロック構造|終端/);
const outside = Uint8Array.from(image);
outside[37] = 0xc1;
assert.throws(() => validateLaunchImage({...entry, runCommand: 'A=USR($C100)'},
  outside, imageSummary), /通常RAM/);
const overlap = new Uint8Array(33 + 8 + 8 + 6);
overlap.set(image.subarray(0, 41));
overlap.set([2, 42, 2, 1, 0x10, 0, 0x39, 0], 41);
overlap.set(image.subarray(41), 49);
assert.throws(() => validateLaunchImage(entry, overlap,
  {...imageSummary, dataBlocks: 2}), /重複/);

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
