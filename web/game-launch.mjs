// SPDX-License-Identifier: BSD-3-Clause
// Published game links resolve only to fixed CJR files on this site.
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_CJR_BYTES = 1024 * 1024;
// A fingerprint only; no ROM or font bytes are shipped. Other ROM revisions use
// the manual MLOAD/USR path until their BASIC input loop is verified separately.
const SUPPORTED_ROM_SHA256 = '69a45bba3711c8d253793055373a6cb64af7a2d62728c6b8a5670aa978b8a0f7';

export async function supportsAutomaticBasic(rom) {
  if (!(rom instanceof Uint8Array) || rom.length !== 16384 || !globalThis.crypto?.subtle) {
    return false;
  }
  const digest = await crypto.subtle.digest('SHA-256', rom);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    === SUPPORTED_ROM_SHA256;
}

export function requestedGame(search) {
  const ids = new URLSearchParams(search).getAll('game');
  if (ids.length === 0) return null;
  if (ids.length !== 1 || ids[0].length > 64 || !ID.test(ids[0])) {
    throw new Error('ゲームIDが不正です。Wikiの作品リンクから開いてください。');
  }
  return ids[0];
}

export function requestedAutoLaunch(search) {
  const params = new URLSearchParams(search);
  const values = params.getAll('launch');
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== '1' || requestedGame(search) === null) {
    throw new Error('ゲーム起動指定が不正です。');
  }
  return true;
}

export function validateGameCatalog(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.games)) {
    throw new Error('作品カタログが不正です。');
  }
  const games = new Map();
  for (const game of value.games) {
    if (typeof game?.id !== 'string' || game.id.length > 64 || !ID.test(game.id)
        || typeof game.title !== 'string' || !game.title.trim() || game.title.length > 80
        || typeof game.version !== 'string' || !VERSION.test(game.version)
        || game.path !== `games/${game.id}/${game.version}/${game.id}.cjr`
        || typeof game.sha256 !== 'string' || !HASH.test(game.sha256)
        || typeof game.runCommand !== 'string'
        || !/^A=USR\(\$[0-9A-F]{4}\)$/.test(game.runCommand)
        || (game.titleMarker !== undefined && (typeof game.titleMarker !== 'string'
            || !/^[A-Z0-9 ]{6,32}$/.test(game.titleMarker)))
        || games.has(game.id)) {
      throw new Error('作品カタログの登録内容が不正です。');
    }
    games.set(game.id, game);
  }
  return games;
}

// The CJR parser must run first. This check binds the catalog's launch address
// to bytes that the normal cassette MLOAD will actually place in RAM.
export function validateLaunchImage(entry, bytes, summary) {
  if (!summary?.hasHeader || summary.fileType !== 1 || summary.dataBlocks < 1
      || summary.warnings !== 0
      || !(bytes instanceof Uint8Array)
      || typeof entry?.runCommand !== 'string') {
    throw new Error('作品は自動起動に対応するマシン語CJRではありません。');
  }
  const command = /^A=USR\(\$([0-9A-F]{4})\)$/.exec(entry.runCommand);
  if (!command) throw new Error('作品の実行コマンドが不正です。');
  const entryAddress = Number.parseInt(command[1], 16);
  let offset = 0;
  let entryIsLoaded = false;
  let blocks = 0;
  const loadBlocks = [];
  const occupied = new Uint8Array(0x8000);
  while (offset < bytes.length) {
    if (offset + 6 > bytes.length || bytes[offset] !== 0x02 || bytes[offset + 1] !== 0x2a) {
      throw new Error('作品CJRのブロック構造が不正です。');
    }
    const number = bytes[offset + 2];
    if (number === 0xff) {
      if (offset + 6 !== bytes.length || blocks !== summary.dataBlocks) {
        throw new Error('作品CJRの終端が不正です。');
      }
      if (!entryIsLoaded) throw new Error('実行開始アドレスがCJRのロード範囲外です。');
      return {entryAddress, loadBlocks};
    }
    const length = bytes[offset + 3] || 256;
    if (offset + length + 7 > bytes.length) {
      throw new Error('作品CJRのブロック長が不正です。');
    }
    if (number !== 0) {
      const address = (bytes[offset + 4] << 8) | bytes[offset + 5];
      if (address < 0x1000 || address + length > 0x8000) {
        throw new Error('自動起動できる通常RAMの範囲外です。');
      }
      for (let index = address; index < address + length; index++) {
        if (occupied[index]) throw new Error('作品CJRのロード範囲が重複しています。');
        occupied[index] = 1;
      }
      entryIsLoaded ||= address <= entryAddress && entryAddress < address + length;
      loadBlocks.push({address, bytes: bytes.subarray(offset + 6, offset + 6 + length)});
      blocks++;
    }
    offset += length + 7;
  }
  throw new Error('作品CJRに終端がありません。');
}

export function launchImageMatches(loadBlocks, peek) {
  if (!Array.isArray(loadBlocks) || loadBlocks.length === 0 || typeof peek !== 'function') {
    return false;
  }
  return loadBlocks.every(block => {
    for (let offset = 0; offset < block.bytes.length; offset++) {
      if (peek(block.address + offset) !== block.bytes[offset]) return false;
    }
    return true;
  });
}

export function readyPromptRows(peek) {
  const marker = [0x52, 0x65, 0x61, 0x64, 0x79];
  const rows = [];
  for (let row = 0; row < 24; row++) {
    const start = 0xc100 + row * 32;
    for (let col = 0; col <= 32 - marker.length; col++) {
      if (marker.every((code, index) => peek(start + col + index) === code)) {
        rows.push(row);
        break;
      }
    }
  }
  return rows;
}

export function basicInputReady(machine) {
  const registers = machine.registers();
  return registers.sp === 0x07f7 && registers.pc >= 0xe894 && registers.pc <= 0xe899
    && readyPromptRows(address => machine.peek(address)).length > 0;
}

export function titleMarkerVisible(peek, marker) {
  if (typeof marker !== 'string' || !/^[A-Z0-9 ]{6,32}$/.test(marker)) return false;
  const codes = Array.from(marker, char => char.charCodeAt(0));
  for (let row = 0; row < 24; row++) {
    const start = 0xc100 + row * 32;
    for (let col = 0; col <= 32 - codes.length; col++) {
      if (codes.every((code, index) => peek(start + col + index) === code)) return true;
    }
  }
  return false;
}

export async function fetchGame(id, baseUrl, fetcher = globalThis.fetch, timeoutMs = 10000) {
  const controller = new AbortController();
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('作品CJRの取得が時間切れになりました。'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([loadGame(id, baseUrl, fetcher, controller.signal), expired]);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadGame(id, baseUrl, fetcher, signal) {
  const origin = new URL(baseUrl);
  const catalogUrl = new URL('game-catalog.json', origin);
  const catalogResponse = await fetcher(catalogUrl.href, {
    mode: 'same-origin', credentials: 'omit', cache: 'no-cache', signal,
  });
  if (!catalogResponse.ok) throw new Error('作品カタログを取得できません。');
  const entry = validateGameCatalog(await catalogResponse.json()).get(id);
  if (!entry) throw new Error(`公開作品が見つかりません: ${id}`);
  const fileUrl = new URL(entry.path, origin);
  if (fileUrl.origin !== origin.origin) throw new Error('作品の配布先が不正です。');
  const response = await fetcher(fileUrl.href, {
    mode: 'same-origin', credentials: 'omit', cache: 'no-cache', signal,
  });
  if (!response.ok) throw new Error('作品CJRを取得できません。');
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > MAX_CJR_BYTES) {
    throw new Error('作品CJRが容量上限を超えています。');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_CJR_BYTES) {
    throw new Error('作品CJRの容量が不正です。');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('作品検証にはHTTPSまたはlocalhostが必要です。');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== entry.sha256) throw new Error('作品CJRのSHA-256が一致しません。');
  return {entry, bytes};
}
