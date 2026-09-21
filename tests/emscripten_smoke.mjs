// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath = pathToFileURL(process.argv[2]).href;
const { default: createJR200Codec } = await import(modulePath);
const module = await createJR200Codec();

assert.equal(module._jr200_codec_api_version(), 1);
assert.equal(module._jr200_cpu_api_version(), 1);
assert.equal(module._jr200_system_api_version(), 1);

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

console.log('PASS Emscripten module: codec, CPU and system ABIs initialize; timer IRQ and peek semantics match');
