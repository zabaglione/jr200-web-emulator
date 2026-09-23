// SPDX-License-Identifier: BSD-3-Clause
// Published game links resolve only to fixed CJR files on this site.
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_CJR_BYTES = 1024 * 1024;

export function requestedGame(search) {
  const ids = new URLSearchParams(search).getAll('game');
  if (ids.length === 0) return null;
  if (ids.length !== 1 || ids[0].length > 64 || !ID.test(ids[0])) {
    throw new Error('ゲームIDが不正です。Wikiの作品リンクから開いてください。');
  }
  return ids[0];
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
        || games.has(game.id)) {
      throw new Error('作品カタログの登録内容が不正です。');
    }
    games.set(game.id, game);
  }
  return games;
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
