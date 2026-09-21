// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bytes = await fs.readFile(process.argv[2]);
const {instance} = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
e.__wasm_call_ctors();
assert.equal(e.jr200_wav_api_version(), 1);

const golden = Uint8Array.from([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1]);
const heap = new Uint8Array(e.memory.buffer);
const input = e.jr200_wav_input_ptr();
heap.set(golden, input);

assert.equal(e.jr200_wav_begin(golden.length, 48000, 2400), 0);
assert.equal(e.jr200_wav_header_size(), 44);
assert.equal(e.jr200_wav_pcm_capacity(), 4096);
const header = heap.slice(e.jr200_wav_header_ptr(), e.jr200_wav_header_ptr() + 44);
assert.equal(new TextDecoder().decode(header.subarray(0, 4)), 'RIFF');
assert.equal(new TextDecoder().decode(header.subarray(8, 16)), 'WAVEfmt ');
assert.equal(new DataView(header.buffer, header.byteOffset).getUint32(24, true), 48000);
assert.equal(new DataView(header.buffer, header.byteOffset).getUint16(34, true), 16);
assert.equal(e.jr200_wav_field(5), 183520);
assert.equal(e.jr200_wav_field(6), 0);
assert.equal(e.jr200_wav_field(9), 367084);
assert.equal(e.jr200_wav_field(10), 0);

assert.equal(e.jr200_wav_drain(41), 41);
const first = Array.from(new Int16Array(e.memory.buffer, e.jr200_wav_pcm_ptr(), 41));
assert.deepEqual(first.slice(0, 20), Array(20).fill(-16384));
assert.deepEqual(first.slice(20, 40), Array(20).fill(16384));
assert.equal(first[40], -16384);
let emitted = 41;
while (e.jr200_wav_field(13) === 0) emitted += e.jr200_wav_drain(4096);
assert.equal(emitted, 183520);
assert.equal(e.jr200_wav_field(11), 183520);

heap.set(golden, input);
assert.equal(e.jr200_wav_begin(golden.length, 44100, 2400), 0);
assert.equal(e.jr200_wav_field(5), 168609);
heap.set(golden, input);
assert.equal(e.jr200_wav_begin(golden.length, 48000, 600), 0);
assert.equal(e.jr200_wav_field(5), 193600);
assert.notEqual(e.jr200_wav_begin(golden.length, 32000, 2400), 0);
heap.set(golden, input);
assert.equal(e.jr200_wav_begin(golden.length, 48000, 0), 0);
assert.equal(e.jr200_wav_field(1), 2400);
assert.equal(e.jr200_wav_field(5), 183520);
assert.notEqual(e.jr200_wav_begin(golden.length, 48000, 1200), 0);

console.log('PASS WAV WASM: RIFF header, streamed PCM, rational 44.1/48 kHz and 600/2400 baud');
