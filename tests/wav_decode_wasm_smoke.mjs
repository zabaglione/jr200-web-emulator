// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bytes = await fs.readFile(process.argv[2]);
const {instance} = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
e.__wasm_call_ctors();
assert.equal(e.jr200_wav_decode_api_version(), 1);
assert.equal(e.jr200_wav_decode_input_capacity(), 8 * 1024 * 1024);

const golden = Uint8Array.from([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1]);
const heap = new Uint8Array(e.memory.buffer);
heap.set(golden, e.jr200_wav_input_ptr());
assert.equal(e.jr200_wav_begin(golden.length, 48000, 2400), 0);
const totalBytes = e.jr200_wav_field(9);
const wav = new Uint8Array(totalBytes);
wav.set(heap.subarray(e.jr200_wav_header_ptr(), e.jr200_wav_header_ptr() + 44));
let offset = 44;
while (e.jr200_wav_field(13) === 0) {
  const count = e.jr200_wav_drain(e.jr200_wav_pcm_capacity());
  assert.ok(count > 0);
  const byteCount = count * 2;
  wav.set(heap.subarray(e.jr200_wav_pcm_ptr(), e.jr200_wav_pcm_ptr() + byteCount), offset);
  offset += byteCount;
}
assert.equal(offset, wav.length);

heap.set(wav, e.jr200_wav_decode_input_ptr());
assert.equal(e.jr200_wav_decode_run(wav.length, 0), 0);
assert.equal(e.jr200_wav_decode_field(0), 48000);
assert.equal(e.jr200_wav_decode_field(1), 1);
assert.equal(e.jr200_wav_decode_field(2), 16);
assert.equal(e.jr200_wav_decode_field(35), 3);
assert.equal(e.jr200_wav_decode_field(36), 2400);
assert.equal(e.jr200_wav_decode_field(37), golden.length);
assert.equal(e.jr200_wav_decode_field(39), 1);
assert.equal(e.jr200_wav_decode_output_size(), golden.length);
assert.deepEqual(
  heap.slice(
    e.jr200_wav_decode_output_ptr(),
    e.jr200_wav_decode_output_ptr() + e.jr200_wav_decode_output_size()),
  golden);

const silence = Uint8Array.from(wav);
silence.fill(0, 44);
heap.set(silence, e.jr200_wav_decode_input_ptr());
assert.equal(e.jr200_wav_decode_run(silence.length, 0), 17);
assert.equal(e.jr200_wav_decode_field(39), 0);
assert.equal(e.jr200_wav_decode_output_size(), 0);

const badRiff = Uint8Array.from(wav);
badRiff[4] ^= 1;
heap.set(badRiff, e.jr200_wav_decode_input_ptr());
assert.equal(e.jr200_wav_decode_run(badRiff.length, 0), 4);
assert.equal(e.jr200_wav_decode_output_size(), 0);

console.log('PASS WAV decode WASM: verified CJR output and candidate suppression on silence/invalid RIFF');
