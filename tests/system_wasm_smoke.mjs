// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bytes = await fs.readFile(process.argv[2]);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
e.__wasm_call_ctors();

assert.equal(e.jr200_system_api_version(), 4);
e.jr200_system_clear();

const golden = Uint8Array.from([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1]);
assert.equal(e.jr200_system_tape_capacity(), 1024 * 1024);
assert.equal(e.jr200_system_tape_mount(e.jr200_system_tape_capacity() + 1), 2);
assert.equal(e.jr200_system_tape_field(0), 7);
new Uint8Array(e.memory.buffer, e.jr200_system_tape_input_ptr(), golden.length).set(golden);
e.jr200_system_write(0xc806, 0x40);
e.jr200_system_write(0xc807, 0x40);
assert.equal(e.jr200_system_tape_mount(golden.length), 0);
assert.equal(e.jr200_system_tape_field(0), 1);
assert.equal(e.jr200_system_tape_field(1), 1);
assert.equal(e.jr200_system_tape_field(2), 1);
assert.equal(e.jr200_system_tape_field(14), 1);
assert.equal(e.jr200_system_read(0xc807), 0x40);
e.jr200_system_tick(280);
assert.equal(e.jr200_system_tape_field(3), 1);
e.jr200_system_write(0xc807, 0);
assert.equal(e.jr200_system_tape_rewind(), 1);
assert.equal(e.jr200_system_tape_field(3), 0);
e.jr200_system_tape_eject();
assert.equal(e.jr200_system_tape_field(0), 0);

assert.equal(e.jr200_system_rom_capacity(), 16384);
assert.equal(e.jr200_system_font_capacity(), 2048);
const rom = new Uint8Array(e.memory.buffer, e.jr200_system_rom_ptr(), 16384);
const font = new Uint8Array(e.memory.buffer, e.jr200_system_font_ptr(), 2048);
rom.fill(0);
font.fill(0x5a);
rom.set([0x86, 0x2a, 0xb7, 0xc1, 0x00, 0x20, 0xfe], 8192);
rom[16382] = 0xe0;
rom[16383] = 0x00;
assert.equal(e.jr200_system_boot(rom.length, font.length), 1);
assert.equal(e.jr200_system_cpu_register(0), 0xe000);
assert.ok(e.jr200_system_run(200) >= 200);
assert.equal(e.jr200_system_peek(0xc100), 0x2a);
assert.equal(e.jr200_system_reset(), 1);
assert.equal(e.jr200_system_cpu_register(0), 0xe000);

e.jr200_system_debug_set_history(1);
assert.equal(e.jr200_system_debug_add_breakpoint(0xe005), 1);
assert.equal(e.jr200_system_reset(), 1);
assert.ok(e.jr200_system_run(100) > 0);
assert.equal(e.jr200_system_debug_field(1), 1);
assert.equal(e.jr200_system_debug_field(2), 0xe005);
assert.equal(e.jr200_system_cpu_register(0), 0xe005);
assert.equal(e.jr200_system_run(100), 0);
assert.ok(e.jr200_system_debug_field(10) > 0);
assert.ok(e.jr200_system_debug_field(13) > 0);
const accessesBeforePeek = e.jr200_system_debug_field(13);
assert.equal(e.jr200_system_peek(0xc100), 0x2a);
assert.equal(e.jr200_system_debug_field(13), accessesBeforePeek);
e.jr200_system_debug_resume();
assert.ok(e.jr200_system_run(1) > 0);
assert.equal(e.jr200_system_debug_field(1), 0);
assert.equal(e.jr200_system_run(100), 0);
assert.equal(e.jr200_system_debug_field(1), 1);
assert.equal(e.jr200_system_debug_remove_breakpoint(0xe005), 1);

e.jr200_system_debug_resume();
e.jr200_system_debug_clear_history();
assert.equal(e.jr200_system_debug_add_watchpoint(0xc100, 2), 1);
assert.equal(e.jr200_system_debug_watchpoint_field(0, 0), 0xc100);
assert.equal(e.jr200_system_debug_watchpoint_field(0, 1), 2);
assert.equal(e.jr200_system_reset(), 1);
assert.ok(e.jr200_system_run(100) > 0);
assert.equal(e.jr200_system_debug_field(1), 3);
assert.equal(e.jr200_system_debug_field(2), 0xc100);
assert.equal(e.jr200_system_debug_field(3), 0x2a);
assert.equal(e.jr200_system_debug_field(5), 1);
assert.equal(e.jr200_system_debug_access_field(e.jr200_system_debug_field(13) - 1, 4), 0xc100);
assert.equal(e.jr200_system_debug_remove_watchpoint(0xc100), 1);
e.jr200_system_debug_resume();
assert.ok(e.jr200_system_debug_step() > 0);
assert.equal(e.jr200_system_debug_field(1), 4);
assert.equal(e.jr200_system_debug_field(16), 256);
assert.equal(e.jr200_system_debug_field(17), 512);
e.jr200_system_clear();
assert.equal(e.jr200_system_boot(16383, font.length), 0);
assert.equal(e.jr200_system_reset(), 0);

e.jr200_system_poke(0xfffe, 0x10);
e.jr200_system_poke(0xffff, 0x00);
e.jr200_system_poke(0x1000, 0x01);
assert.equal(e.jr200_system_cpu_reset(), 0);
assert.equal(e.jr200_system_cpu_register(0), 0x1000);
assert.equal(e.jr200_system_cpu_step(), 3);
assert.equal(e.jr200_system_cpu_trace_field(1), 0x01);
assert.equal(e.jr200_system_cpu_trace_field(2), 2);
assert.equal(e.jr200_system_cpu_trace_field(3), 1);

e.jr200_system_clear();

e.jr200_system_write(0xc80f, 2);
e.jr200_system_write(0xc82e, 0x41);
e.jr200_system_tick(1);
assert.equal(e.jr200_system_field(0), 0);
e.jr200_system_tick(1);
assert.equal(e.jr200_system_field(0), 1);
assert.equal(e.jr200_system_peek(0xc80e), 0x61);
assert.equal(e.jr200_system_peek(0xc80e), 0x61);
assert.equal(e.jr200_system_read(0xc80e), 0x61);
assert.equal(e.jr200_system_field(0), 0);

e.jr200_system_clear();
e.jr200_system_write(0xc81e, 1);
e.jr200_system_set_key(0x41, 1);
e.jr200_system_tick(99);
assert.equal(e.jr200_system_field(0), 0);
e.jr200_system_tick(1);
assert.equal(e.jr200_system_peek(0xc801), 0x41);
assert.equal(e.jr200_system_field(0), 1);
assert.equal(e.jr200_system_read(0xc81c), 0x81);

e.jr200_system_write(0xc806, 0x40);
e.jr200_system_write(0xc807, 0x40);
e.jr200_system_write(0xc80d, 0x55);
assert.equal(e.jr200_system_field(1), 1);
assert.equal(e.jr200_system_cassette_pop(), 0x155);

e.jr200_system_clear();
e.jr200_system_write(0xc813, 0x80);
e.jr200_system_write(0xc812, 0x06);
e.jr200_system_tick(304);
assert.equal(e.jr200_system_field(4), 10);
assert.equal(e.jr200_system_pcm_pop(), 1);
assert.equal(e.jr200_system_pcm_sample(0), 7000);
assert.equal(e.jr200_system_pcm_sample(1), 0);

e.jr200_system_write(0xca7f, 2);
e.jr200_system_poke(0xc100, 0);
e.jr200_system_poke(0xc500, 7);
e.jr200_system_poke(0xd000, 0x80);
e.jr200_system_render();
const pixels = new Uint32Array(e.memory.buffer, e.jr200_system_framebuffer_ptr(), 320 * 224);
assert.equal(pixels[0], 0xffff0000);
assert.equal(pixels[32 + 16 * 320], 0xffffffff);
assert.equal(pixels[33 + 16 * 320], 0xff000000);

assert.ok(e.jr200_system_field(3) > 0);
console.log('PASS system WASM: peripherals, cassette transport, bounded debugger, breakpoint/watch/step, side-effect-free peek');
