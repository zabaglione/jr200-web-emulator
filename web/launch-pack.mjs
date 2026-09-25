// SPDX-License-Identifier: BSD-3-Clause
// Local, self-contained CJR/input packs. No archive member is used as a URL.
const MAX_ARCHIVE = 2 * 1024 * 1024;
const MAX_TOTAL = 1200 * 1024;
const MAX_FILES = 8;
const MAX_FILE = 1024 * 1024;
const NAME = /^(?:pack\.json|launch\.txt|[a-zA-Z0-9_-]+\.cjr|LICENSE(?:\.txt)?|README(?:\.md|\.txt)|THIRD_PARTY_NOTICES\.md)$/;
const HASH = /^[0-9a-f]{64}$/;
const MARKER = /^[A-Z0-9 ]{6,32}$/;
const RUN = /^MLOAD\n(A=USR\(\$[0-9A-F]{4}\))\n?$/;
const decoder = new TextDecoder('utf-8', {fatal: true});

function fail(message) { throw new Error(`起動パック: ${message}`); }
function u16(data, offset) { return data[offset] | (data[offset + 1] << 8); }
function u32(data, offset) { return (data[offset] | (data[offset + 1] << 8)
  | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0; }

function memberLimit(name) {
  if (name === 'pack.json') return 8192;
  if (name === 'launch.txt') return 16384;
  if (name.endsWith('.cjr')) return MAX_FILE;
  return 65536;
}

function normalizedNames(names) {
  if (names.length < 3 || names.length > MAX_FILES) fail('ファイル数が範囲外です。');
  if (names.some(name => !name || name.includes('\\') || name.startsWith('/')
      || name.includes('\0') || name.split('/').some(part => part === '..' || part === '.'))) {
    fail('安全でないファイル名があります。');
  }
  const parts = names.map(name => name.split('/'));
  const wrapped = parts.every(part => part.length === 2 && part[0] === parts[0][0]);
  if (parts.some(part => part.length > (wrapped ? 2 : 1))) fail('階層は1つの外側フォルダーまでです。');
  const clean = parts.map(part => wrapped ? part[1] : part[0]);
  if (clean.some(name => !NAME.test(name)) || new Set(clean).size !== clean.length) {
    fail('許可されないファイル名または重複があります。');
  }
  return clean;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function hasZip64Extra(data, start, length) {
  let cursor = start;
  const end = start + length;
  while (cursor + 4 <= end) {
    const size = u16(data, cursor + 2);
    if (cursor + 4 + size > end) fail('ZIPの拡張情報が不正です。');
    if (u16(data, cursor) === 1) return true;
    cursor += 4 + size;
  }
  if (cursor !== end) fail('ZIPの拡張情報が不正です。');
  return false;
}

async function inflated(bytes, expected) {
  if (typeof DecompressionStream !== 'function') fail('このブラウザはZIP展開に対応していません。');
  let stream;
  try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
  catch { fail('このブラウザはZIPのdeflate-rawに対応していません。'); }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > expected || total > MAX_TOTAL) fail('展開後サイズが上限を超えました。');
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    fail('ZIPの展開に失敗しました。');
  }
  if (total !== expected) fail('展開後サイズがZIPの目録と一致しません。');
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function zipMembers(data) {
  if (!(data instanceof Uint8Array) || data.length > MAX_ARCHIVE || data.length < 22) {
    fail('ZIPのサイズが範囲外です。');
  }
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (u32(data, offset) === 0x06054b50 && offset + 22 + u16(data, offset + 20) === data.length) {
      end = offset; break;
    }
  }
  if (end < 0 || u16(data, end + 4) !== 0 || u16(data, end + 6) !== 0
      || u16(data, end + 8) !== u16(data, end + 10)
      || u16(data, end + 10) < 3 || u16(data, end + 10) > MAX_FILES + 1) {
    fail('ZIPの中央目録が不正です。');
  }
  const cdStart = u32(data, end + 16);
  const cdEnd = cdStart + u32(data, end + 12);
  if (cdEnd !== end || cdStart >= end) fail('ZIPの中央目録位置が不正です。');
  const records = [];
  let cursor = cdStart;
  let total = 0;
  for (let index = 0; index < u16(data, end + 10); index++) {
    if (cursor + 46 > cdEnd || u32(data, cursor) !== 0x02014b50) fail('ZIPの登録内容が不正です。');
    const flags = u16(data, cursor + 8);
    const method = u16(data, cursor + 10);
    const packed = u32(data, cursor + 20);
    const size = u32(data, cursor + 24);
    const nameLength = u16(data, cursor + 28);
    const extra = u16(data, cursor + 30);
    const comment = u16(data, cursor + 32);
    const next = cursor + 46 + nameLength + extra + comment;
    const allowedFlags = 8 | 0x800 | (method === 8 ? 0x6 : 0);
    if (next > cdEnd || (flags & ~allowedFlags) || ![0, 8].includes(method)
        || u16(data, cursor + 6) >= 45 || u16(data, cursor + 34) !== 0
        || packed === 0xffffffff || size === 0xffffffff
        || u32(data, cursor + 42) === 0xffffffff
        || hasZip64Extra(data, cursor + 46 + nameLength, extra)
        || size > MAX_FILE || packed > MAX_ARCHIVE) fail('ZIPの方式または容量が未対応です。');
    let name;
    try { name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { fail('ZIPのファイル名がUTF-8ではありません。'); }
    total += size;
    if (total > MAX_TOTAL) fail('ZIPの展開後合計が上限を超えました。');
    records.push({name, flags, method, packed, size, crc: u32(data, cursor + 16),
      local: u32(data, cursor + 42), external: u32(data, cursor + 38)});
    cursor = next;
  }
  if (cursor !== cdEnd) fail('ZIPの中央目録に余分なデータがあります。');
  const directories = records.filter(record => record.name.endsWith('/'));
  if (directories.length > 1 || (directories.length === 1
      && (!/^[a-zA-Z0-9_-]+\/$/.test(directories[0].name)
        || directories[0].size !== 0 || directories[0].packed !== 0
        || directories[0].method !== 0
        || records.some(record => record !== directories[0]
          && !record.name.startsWith(directories[0].name))))) {
    fail('ZIPの外側フォルダーが不正です。');
  }
  const files = records.filter(record => !record.name.endsWith('/'));
  const names = normalizedNames(files.map(record => record.name));
  const members = new Map();
  const spans = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const isDirectory = record.name.endsWith('/');
    const name = isDirectory ? record.name : names[files.indexOf(record)];
    if ((!isDirectory && record.size > memberLimit(name)) || record.local + 30 > cdStart
        || u32(data, record.local) !== 0x04034b50
        || u16(data, record.local + 4) >= 45
        || u16(data, record.local + 6) !== record.flags
        || u16(data, record.local + 8) !== record.method) fail('ZIPのローカル見出しが不正です。');
    const localNameLength = u16(data, record.local + 26);
    const localNameStart = record.local + 30;
    const localExtraLength = u16(data, record.local + 28);
    if (localNameStart + localNameLength + localExtraLength > cdStart
        || u32(data, record.local + 18) === 0xffffffff
        || u32(data, record.local + 22) === 0xffffffff
        || hasZip64Extra(data, localNameStart + localNameLength, localExtraLength)) {
      fail('ZIPのローカル拡張情報が不正です。');
    }
    let localName;
    try { localName = decoder.decode(data.subarray(localNameStart, localNameStart + localNameLength)); }
    catch { fail('ZIPのローカル名がUTF-8ではありません。'); }
    const start = localNameStart + localNameLength + localExtraLength;
    const finish = start + record.packed;
    if (localName !== record.name || finish > cdStart || (record.external >>> 16 & 0xf000) === 0xa000
        || ((record.flags & 8) && (
          ![0, record.crc].includes(u32(data, record.local + 14))
          || ![0, record.packed].includes(u32(data, record.local + 18))
          || ![0, record.size].includes(u32(data, record.local + 22))))
        || (!(record.flags & 8) && (u32(data, record.local + 14) !== record.crc
          || u32(data, record.local + 18) !== record.packed
          || u32(data, record.local + 22) !== record.size))) {
      fail('ZIPの見出しと中央目録が一致しません。');
    }
    let spanEnd = finish;
    if (record.flags & 8) {
      const signature = finish + 4 <= cdStart && u32(data, finish) === 0x08074b50;
      const descriptor = finish + (signature ? 4 : 0);
      spanEnd = descriptor + 12;
      if (spanEnd > cdStart || u32(data, descriptor) !== record.crc
          || u32(data, descriptor + 4) !== record.packed
          || u32(data, descriptor + 8) !== record.size) {
        fail('ZIPのdata descriptorが不正です。');
      }
    }
    spans.push([record.local, spanEnd]);
    const payload = record.method === 0 ? data.slice(start, finish)
      : await inflated(data.subarray(start, finish), record.size);
    if (payload.length !== record.size || crc32(payload) !== record.crc) {
      fail('ZIPの展開結果またはCRCが一致しません。');
    }
    if (!isDirectory) members.set(name, payload);
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans[0][0] !== 0 || spans.at(-1)[1] !== cdStart
      || spans.some((span, index) => index > 0 && span[0] !== spans[index - 1][1])) {
    fail('ZIP内のファイル領域に重複または余分なデータがあります。');
  }
  return members;
}

export async function folderMembers(files) {
  const selected = Array.from(files);
  const names = normalizedNames(selected.map(file => file.webkitRelativePath || file.name));
  let total = 0;
  const members = new Map();
  for (let index = 0; index < selected.length; index++) {
    const file = selected[index];
    if (file.size > memberLimit(names[index])) fail('ファイルが上限を超えました。');
    total += file.size;
    if (total > MAX_TOTAL) fail('フォルダーの合計が上限を超えました。');
    members.set(names[index], new Uint8Array(await file.arrayBuffer()));
  }
  return members;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) fail('SHA-256が利用できません。');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateLaunchPack(members) {
  if (!(members instanceof Map) || !members.has('pack.json') || !members.has('launch.txt')) {
    fail('pack.jsonとlaunch.txtが必要です。');
  }
  let meta;
  try { meta = JSON.parse(decoder.decode(members.get('pack.json'))); }
  catch { fail('pack.jsonがUTF-8 JSONではありません。'); }
  const fields = ['schemaVersion', 'title', 'media', 'input'];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)
      || fields.some(key => !(key in meta))
      || Object.keys(meta).some(key => ![...fields, 'titleMarker'].includes(key))
      || meta.schemaVersion !== 1 || typeof meta.title !== 'string'
      || !meta.title.trim() || meta.title.length > 80
      || (meta.titleMarker !== undefined && (typeof meta.titleMarker !== 'string'
        || !MARKER.test(meta.titleMarker)))) fail('pack.jsonの形式が不正です。');
  const validReference = (record, kind) => record && typeof record === 'object'
    && !Array.isArray(record) && Object.keys(record).length === 3
    && ['file', 'size', 'sha256'].every(key => key in record)
    && typeof record.file === 'string' && (kind === 'input'
      ? record.file === 'launch.txt' : /^[a-zA-Z0-9_-]+\.cjr$/.test(record.file))
    && Number.isSafeInteger(record.size) && record.size > 0
    && record.size <= memberLimit(record.file)
    && typeof record.sha256 === 'string' && HASH.test(record.sha256);
  if (!validReference(meta.media, 'media') || !validReference(meta.input, 'input')) {
    fail('CJRと入力テキストの目録が不正です。');
  }
  if ([...members.keys()].filter(name => name.endsWith('.cjr')).length !== 1) {
    fail('CJRは1つだけ指定してください。');
  }
  for (const record of [meta.media, meta.input]) {
    const bytes = members.get(record.file);
    if (!bytes || bytes.length !== record.size || await sha256(bytes) !== record.sha256) {
      fail(`${record.file}のサイズまたはSHA-256が一致しません。`);
    }
  }
  let text;
  try { text = decoder.decode(members.get('launch.txt')); }
  catch { fail('launch.txtがUTF-8ではありません。'); }
  const normalized = text.replace(/\r\n?/g, '\n');
  const runCommand = RUN.exec(normalized)?.[1] || null;
  return {title: meta.title, bytes: members.get(meta.media.file),
    fileName: meta.media.file, text, runCommand,
    titleMarker: runCommand ? meta.titleMarker || null : null};
}
