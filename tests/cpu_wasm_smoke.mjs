// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bytes = await fs.readFile(process.argv[2]);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
e.__wasm_call_ctors();
assert.equal(e.jr200_cpu_api_version(), 1);

e.jr200_cpu_clear_memory();
const heap = new Uint8Array(e.memory.buffer);
const base = e.jr200_cpu_memory_ptr();
const write = (address, values) => heap.set(values, base + address);
write(0xfffe, [0x20, 0x00]);
write(0xfffc, [0x22, 0x00]);
write(0x2000, [
  0x8e, 0x01, 0xff, 0xce, 0x12, 0x34,
  0x86, 0x7f, 0x8b, 0x01, 0x97, 0x10,
  0x26, 0x02, 0x86, 0x00, 0xbd, 0x21,
  0x00, 0x3e,
]);
write(0x2100, [0x7c, 0x00, 0x10, 0x39]);
write(0x2200, [0x3b]);

assert.equal(e.jr200_cpu_reset(), 0);
assert.equal(e.jr200_cpu_trace_field(0), 0);
assert.equal(e.jr200_cpu_register(0), 0x2000);
assert.equal(e.jr200_cpu_register(5), 0xd0);

const expected = [
  [0x8e, 0x2003, 0x01ff, 0x0000, 0x00, 0x00, 0xd0, 3],
  [0xce, 0x2006, 0x01ff, 0x1234, 0x00, 0x00, 0xd0, 3],
  [0x86, 0x2008, 0x01ff, 0x1234, 0x7f, 0x00, 0xd0, 2],
  [0x8b, 0x200a, 0x01ff, 0x1234, 0x80, 0x00, 0xfa, 2],
  [0x97, 0x200c, 0x01ff, 0x1234, 0x80, 0x00, 0xf8, 4],
  [0x26, 0x2010, 0x01ff, 0x1234, 0x80, 0x00, 0xf8, 4],
  [0xbd, 0x2100, 0x01fd, 0x1234, 0x80, 0x00, 0xf8, 9],
  [0x7c, 0x2103, 0x01fd, 0x1234, 0x80, 0x00, 0xf8, 6],
  [0x39, 0x2013, 0x01ff, 0x1234, 0x80, 0x00, 0xf8, 5],
  [0x3e, 0x2014, 0x01f8, 0x1234, 0x80, 0x00, 0xf8, 9],
];

for (const row of expected) {
  assert.equal(e.jr200_cpu_step(), row[7]);
  assert.deepEqual([
    e.jr200_cpu_trace_field(1),
    e.jr200_cpu_register(0),
    e.jr200_cpu_register(1),
    e.jr200_cpu_register(2),
    e.jr200_cpu_register(3),
    e.jr200_cpu_register(4),
    e.jr200_cpu_register(5),
    e.jr200_cpu_trace_field(2),
  ], row);
  assert.equal(e.jr200_cpu_trace_field(0), 1);
  assert.equal(e.jr200_cpu_trace_field(3), 0);
}
assert.equal(heap[base + 0x0010], 0x81);
assert.equal(e.jr200_cpu_register(6), 1);

e.jr200_cpu_pulse_nmi();
assert.equal(e.jr200_cpu_step(), 4);
assert.equal(e.jr200_cpu_trace_field(0), 3);
assert.equal(e.jr200_cpu_register(0), 0x2200);
assert.equal(e.jr200_cpu_register(1), 0x01f8);
assert.equal(e.jr200_cpu_register(6), 0);
assert.equal(e.jr200_cpu_step(), 10);
assert.equal(e.jr200_cpu_register(0), 0x2014);
assert.equal(e.jr200_cpu_register(1), 0x01ff);

e.jr200_cpu_set_registers(0x3000, 0x01ff, 0, 0, 0, 0xc0);
write(0x3000, [0x96, 0x10]);
write(0x0010, [0x80]);
for (let access = 0; access < 5; ++access) {
  e.jr200_cpu_set_wait(access, access + 1);
}
assert.equal(e.jr200_cpu_step(), 9);
assert.equal(e.jr200_cpu_trace_field(2), 3);
assert.equal(e.jr200_cpu_trace_field(3), 6);
assert.equal(e.jr200_cpu_register(3), 0x80);

console.log('PASS CPU WASM: native trace fixture, registers, memory, cycles, NMI/WAI, wait states');
