// SPDX-License-Identifier: BSD-3-Clause
// Unit-test the browser's JS wrapper with local file-backed fetch, NOT a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadCodec} from '../web/codec.mjs';
const wasm = await fs.readFile(process.argv[2]);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async path => {
    if (path === './backend.json') return new Response(JSON.stringify({backend:'clang'}));
    if (path === './jr200_codec.wasm') return new Response(wasm);
    throw new Error(`Unexpected fetch in wrapper unit test: ${path}`);
  };
  const codec = await loadCodec();
  const packed = codec.pack(Uint8Array.of(0xab),'X',0x7000,false,0);
  const summary = codec.inspect(packed);
  assert.equal(summary.payloadBytes,1);
  assert.equal(summary.firstAddress,0x7000);
  assert.equal(summary.footerAddress,0x7001);
  assert.equal(summary.nameAscii,'X');
  assert.equal(summary.warnings,0);
  assert.equal(packed.length,47);
  const preserved = Uint8Array.from(packed);
  const external600 = codec.pack(Uint8Array.of(0x12,0x34),'SECOND',0x6000,false,100);
  assert.equal(codec.inspect(external600).baudFlag,100);
  assert.deepEqual(packed,preserved); // returned bytes must not alias wasm memory
  packed[40]^=1;
  assert.throws(()=>codec.inspect(packed),/checksum.*offset 40/);
  assert.throws(()=>codec.inspect(new Uint8Array(1024*1024+1)),/1 MiB/);
  assert.throws(()=>codec.pack(Uint8Array.of(0),'日本語',0,false,0),/ASCII/);
  assert.throws(()=>codec.pack(Uint8Array.of(0),'X',65536,false,0),/アドレス/);
  assert.throws(()=>codec.pack([1],'X',0,false,0),/Uint8Array/);
  assert.throws(()=>codec.pack(Uint8Array.of(0),'X',0,false,NaN),/ボーレート/);
  const rom = new Uint8Array(16384);
  const font = new Uint8Array(2048);
  rom.set([0x86,0x2a,0xb7,0xc1,0x00,0x20,0xfe],8192);
  rom.set([0xe0,0x00],16382);
  assert.throws(()=>codec.machine.run(1),/ROM/);
  assert.equal(codec.machine.boot(rom,font).pc,0xe000);
  assert.ok(codec.machine.run(200)>=200);
  assert.equal(codec.machine.peek(0xc100),0x2a);
  assert.deepEqual(Array.from(codec.machine.peekRange(0xc100,4)),[0x2a,0,0,0]);
  codec.machine.debugger.setHistoryEnabled(true);
  codec.machine.debugger.addBreakpoint(0xe005);
  codec.machine.reset();
  assert.ok(codec.machine.run(100)>0);
  assert.equal(codec.machine.debugger.state().stopReason,1);
  assert.equal(codec.machine.debugger.state().stopAddress,0xe005);
  assert.equal(codec.machine.run(100),0);
  assert.ok(codec.machine.debugger.instructions().length>0);
  assert.ok(codec.machine.debugger.accesses().length>0);
  codec.machine.debugger.resume();
  assert.ok(codec.machine.debugger.step()>0);
  assert.equal(codec.machine.debugger.state().stopReason,4);
  codec.machine.debugger.removeBreakpoint(0xe005);
  codec.machine.debugger.addWatchpoint(0xc100,{write:true});
  codec.machine.reset();
  assert.ok(codec.machine.run(100)>0);
  assert.equal(codec.machine.debugger.state().stopReason,3);
  assert.equal(codec.machine.debugger.state().stopValue,0x2a);
  assert.deepEqual(codec.machine.debugger.watchpoints(),[{address:0xc100,flags:2}]);
  codec.machine.debugger.clearWatchpoints();
  assert.throws(()=>codec.machine.debugger.addWatchpoint(0x1000),/読出しまたは書込み/);
  assert.throws(()=>codec.machine.peekRange(0,257),/1〜256/);
  assert.equal(codec.machine.render().length,320*224);
  assert.equal(codec.machine.reset().pc,0xe000);
  assert.throws(()=>codec.machine.boot(rom.subarray(1),font),/16384/);
  codec.machine.clear();
  assert.throws(()=>codec.machine.run(1),/ROM/);
  console.log('PASS JS wrapper (Node, local fetch stub): inspect, pack, machine boot/run/reset, bounded debugger, framebuffer, input guards');
} finally {
  globalThis.fetch=originalFetch;
}
