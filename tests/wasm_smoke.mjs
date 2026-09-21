// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const bytes = await fs.readFile(process.argv[2]);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
assert.equal(e.jr200_codec_api_version(), 1);
const heap = new Uint8Array(e.memory.buffer);
const input = e.jr200_input_ptr();
const golden = Uint8Array.from([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1]);
heap.set(golden, input);
assert.equal(e.jr200_inspect(golden.length, 0), 0);
assert.equal(e.jr200_summary_field(4), 1);
assert.equal(e.jr200_summary_field(5), 0x7000);
heap[input] = 88; heap[input + 16] = 171;
assert.equal(e.jr200_encode(1, 1, 0x7000, 0, 0), 0);
assert.deepEqual(heap.slice(e.jr200_output_ptr(), e.jr200_output_ptr() + e.jr200_output_size()), golden);
for (const n of [1,255,256,257,511,512,513,65024]) {
  heap[input] = 88;
  for (let i = 0; i < n; ++i) heap[input + 16 + i] = i & 255;
  assert.equal(e.jr200_encode(n,1,0,0,0),0);
  const encoded = heap.slice(e.jr200_output_ptr(), e.jr200_output_ptr() + e.jr200_output_size());
  heap.set(encoded,input);
  assert.equal(e.jr200_inspect(encoded.length,0),0);
  assert.equal(e.jr200_summary_field(4),n);
}
heap.set(golden,input); heap[input + 40] ^= 1;
assert.notEqual(e.jr200_inspect(golden.length,0),0);
assert.equal(e.jr200_error_offset(),40);
assert.notEqual(e.jr200_inspect(e.jr200_capacity()+1,0),0);
assert.notEqual(e.jr200_encode(1,1,65536,0,0),0);
console.log('PASS WASM: golden, 8 boundary lengths, checksum rejection, capacity guard, ABI argument guard');
