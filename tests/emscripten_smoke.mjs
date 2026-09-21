// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath = pathToFileURL(process.argv[2]).href;
const { default: createJR200Codec } = await import(modulePath);
const module = await createJR200Codec();

assert.equal(module._jr200_codec_api_version(), 1);
assert.equal(module._jr200_cpu_api_version(), 1);
assert.equal(module._jr200_system_api_version(), 5);
assert.equal(module._jr200_wav_api_version(), 1);

const golden = Uint8Array.from([2,42,0,26,255,255,88,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,255,255,255,255,255,255,255,255,149,2,42,1,1,112,0,171,73,2,42,255,255,112,1]);
module.HEAPU8.set(golden, module._jr200_wav_input_ptr());
assert.equal(module._jr200_wav_begin(golden.length, 44100, 2400), 0);
assert.equal(module._jr200_wav_field(5), 168609);
assert.equal(new TextDecoder().decode(module.HEAPU8.subarray(
  module._jr200_wav_header_ptr(), module._jr200_wav_header_ptr() + 4)), 'RIFF');

module._jr200_system_clear();
assert.equal(module._jr200_system_rom_capacity(), 16384);
assert.equal(module._jr200_system_font_capacity(), 2048);
const rom = new Uint8Array(module.HEAPU8.buffer, module._jr200_system_rom_ptr(), 16384);
const font = new Uint8Array(module.HEAPU8.buffer, module._jr200_system_font_ptr(), 2048);
rom.fill(0);
font.fill(0x5a);
rom.set([0x86, 0x2a, 0xb7, 0xc1, 0x00, 0x20, 0xfe], 8192);
rom.set([0xe0, 0x00], 16382);
assert.equal(module._jr200_system_boot(rom.length, font.length), 1);
assert.equal(module._jr200_system_cpu_register(0), 0xe000);
assert.ok(module._jr200_system_run(200) >= 200);
assert.equal(module._jr200_system_peek(0xc100), 0x2a);
assert.equal(module._jr200_system_reset(), 1);
module._jr200_system_debug_set_history(1);
assert.equal(module._jr200_system_debug_add_breakpoint(0xe005), 1);
assert.equal(module._jr200_system_reset(), 1);
assert.ok(module._jr200_system_run(100) > 0);
assert.equal(module._jr200_system_debug_field(1), 1);
assert.equal(module._jr200_system_debug_field(2), 0xe005);
module._jr200_system_debug_resume();
assert.ok(module._jr200_system_debug_step() > 0);
assert.equal(module._jr200_system_debug_field(1), 4);

module._jr200_system_clear();
module._jr200_system_poke(0xfffe, 0x10);
module._jr200_system_poke(0xffff, 0x00);
module._jr200_system_poke(0x1000, 0x01);
assert.equal(module._jr200_system_cpu_reset(), 0);
assert.equal(module._jr200_system_cpu_step(), 3);
assert.equal(module._jr200_system_cpu_register(0), 0x1001);

module._jr200_system_clear();
module._jr200_system_write(0xc80f, 2);
module._jr200_system_write(0xc82e, 0x41);
module._jr200_system_tick(2);
assert.equal(module._jr200_system_field(0), 1);
assert.equal(module._jr200_system_peek(0xc80e), 0x61);
assert.equal(module._jr200_system_read(0xc80e), 0x61);
assert.equal(module._jr200_system_field(0), 0);

console.log('PASS Emscripten module: codec, CPU and system ABIs initialize; debugger, timer IRQ and peek semantics match');
