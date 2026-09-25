// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {folderMembers, validateLaunchPack, zipMembers} from '../web/launch-pack.mjs';

const encoder = new TextEncoder();
const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const crc = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
const write16 = (data, at, value) => { data[at] = value & 255; data[at + 1] = value >>> 8; };
const write32 = (data, at, value) => {
  write16(data, at, value & 65535); write16(data, at + 2, value >>> 16);
};

function zip(entries, compressed = false, descriptor = false, deflateOption = 0) {
  const local = [];
  const central = [];
  let position = 0;
  for (const [name, payload] of entries) {
    const nameBytes = encoder.encode(name);
    const packed = compressed ? deflateRawSync(payload) : payload;
    const header = new Uint8Array(30 + nameBytes.length + packed.length
      + (descriptor ? 16 : 0));
    write32(header, 0, 0x04034b50);
    write16(header, 6, (descriptor ? 8 : 0) | deflateOption);
    write16(header, 8, compressed ? 8 : 0);
    if (!descriptor) {
      write32(header, 14, crc(payload));
      write32(header, 18, packed.length);
      write32(header, 22, payload.length);
    }
    write16(header, 26, nameBytes.length);
    header.set(nameBytes, 30); header.set(packed, 30 + nameBytes.length);
    if (descriptor) {
      const at = 30 + nameBytes.length + packed.length;
      write32(header, at, 0x08074b50);
      write32(header, at + 4, crc(payload));
      write32(header, at + 8, packed.length);
      write32(header, at + 12, payload.length);
    }
    local.push(header);
    const item = new Uint8Array(46 + nameBytes.length);
    write32(item, 0, 0x02014b50);
    write16(item, 8, (descriptor ? 8 : 0) | deflateOption);
    write16(item, 10, compressed ? 8 : 0);
    write32(item, 16, crc(payload));
    write32(item, 20, packed.length);
    write32(item, 24, payload.length);
    write16(item, 28, nameBytes.length);
    write32(item, 42, position);
    item.set(nameBytes, 46);
    central.push(item);
    position += header.length;
  }
  const centralLength = central.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(position + centralLength + 22);
  let offset = 0;
  for (const item of [...local, ...central]) { output.set(item, offset); offset += item.length; }
  write32(output, offset, 0x06054b50);
  write16(output, offset + 8, entries.length);
  write16(output, offset + 10, entries.length);
  write32(output, offset + 12, centralLength);
  write32(output, offset + 16, position);
  return output;
}

const cjr = new Uint8Array(33 + 8 + 6);
cjr.set([2, 42, 0, 26], 0);
cjr[22] = 1;
cjr[32] = cjr.subarray(0, 32).reduce((sum, value) => sum + value, 0) & 255;
cjr.set([2, 42, 1, 1, 0x10, 0, 0x39, 0x74], 33);
cjr.set([2, 42, 255, 255, 0x10, 1], 41);
const input = encoder.encode('MLOAD\r\nA=USR($1000)\r\n');
const meta = encoder.encode(JSON.stringify({
  schemaVersion: 1, title: 'SIDE CATCH', titleMarker: 'SIDE CATCH',
  media: {file: 'game.cjr', size: cjr.length, sha256: await sha(cjr)},
  input: {file: 'launch.txt', size: input.length, sha256: await sha(input)},
}));
const entries = [['pack.json', meta], ['game.cjr', cjr], ['launch.txt', input]];
for (const compressed of [false, true]) {
  for (const descriptor of [false, true]) {
    const members = await zipMembers(zip(entries, compressed, descriptor));
    const pack = await validateLaunchPack(members);
    assert.equal(pack.runCommand, 'A=USR($1000)');
    assert.equal(pack.titleMarker, 'SIDE CATCH');
    assert.deepEqual(pack.bytes, cjr);
    const broken = zip(entries, compressed, descriptor);
    broken[40] ^= 1;
    await assert.rejects(zipMembers(broken), /CRC|展開/);
    if (descriptor) {
      const noDescriptor = zip(entries, compressed, descriptor);
      const at = 30 + encoder.encode('pack.json').length
        + (compressed ? deflateRawSync(meta).length : meta.length);
      noDescriptor[at + 4] ^= 1;
      await assert.rejects(zipMembers(noDescriptor), /descriptor/);
    }
  }
}
for (const option of [0x2, 0x4, 0x6]) {
  const members = await zipMembers(zip(entries, true, false, option));
  assert.equal((await validateLaunchPack(members)).runCommand, 'A=USR($1000)');
}
await assert.rejects(zipMembers(zip(entries, false, false, 0x2)), /未対応/);
const directoryEntries = [['pack/', new Uint8Array()],
  ...entries.map(([name, bytes]) => [`pack/${name}`, bytes])];
assert.equal((await validateLaunchPack(await zipMembers(zip(directoryEntries)))).title,
  'SIDE CATCH');
const zip64 = zip(entries);
write16(zip64, 4, 45);
await assert.rejects(zipMembers(zip64), /未対応|ローカル/);
const files = entries.map(([name, bytes]) => ({name, size: bytes.length,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)}));
assert.equal((await validateLaunchPack(await folderMembers(files))).runCommand,
  'A=USR($1000)');
const wrapped = files.map(file => ({...file, webkitRelativePath: `game/${file.name}`}));
assert.equal((await validateLaunchPack(await folderMembers(wrapped))).fileName, 'game.cjr');
await assert.rejects(folderMembers([...files, {...files[0], name: 'rom.bin'}]), /許可されない/);
await assert.rejects(folderMembers([...files, {...files[0], name: 'game.cjr'}]), /重複/);
await assert.rejects(folderMembers(files.map(file => ({...file,
  webkitRelativePath: `../${file.name}`}))), /安全でない/);
const badMeta = encoder.encode(JSON.stringify({...JSON.parse(new TextDecoder().decode(meta)),
  media: {file: 'game.cjr', size: cjr.length, sha256: '0'.repeat(64)}}));
await assert.rejects(validateLaunchPack(new Map([['pack.json', badMeta],
  ['game.cjr', cjr], ['launch.txt', input]])), /SHA-256/);
const arbitrary = encoder.encode('PRINT "HELLO"\n');
const manualMeta = encoder.encode(JSON.stringify({...JSON.parse(new TextDecoder().decode(meta)),
  input: {file: 'launch.txt', size: arbitrary.length, sha256: await sha(arbitrary)}}));
assert.equal((await validateLaunchPack(new Map([['pack.json', manualMeta],
  ['game.cjr', cjr], ['launch.txt', arbitrary]]))).runCommand, null);
console.log('PASS launch pack: folder, stored/deflate ZIP, hashes, bounds and manual fallback');
