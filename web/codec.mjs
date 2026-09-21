// SPDX-License-Identifier: BSD-3-Clause
export async function loadCodec() {
  const config = await (await fetch('./backend.json')).json();
  let e, memory;
  if (config.backend === 'emscripten') {
    const { default: createModule } = await import('./jr200_codec.mjs');
    const m = await createModule();
    e = new Proxy({}, {get: (_, key) => m[`_${String(key)}`]});
    memory = () => m.HEAPU8;
  } else {
    const response = await fetch('./jr200_codec.wasm');
    if (!response.ok) throw new Error(`WASM取得失敗: ${response.status}`);
    const {instance} = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    e = instance.exports;
    if (e.__wasm_call_ctors) e.__wasm_call_ctors();
    memory = () => new Uint8Array(e.memory.buffer);
  }
  if (e.jr200_codec_api_version() !== 1) throw new Error('C ABIのバージョンが一致しません');
  if (e.jr200_system_api_version() !== 4) throw new Error('システムABIのバージョンが一致しません');
  const text = new TextDecoder();
  const readCString = start => {
    const heap = memory();
    let end = start;
    while (end < heap.length && end - start < 512 && heap[end]) ++end;
    return text.decode(heap.subarray(start, end));
  };
  const checked = code => {
    if (code) {
      throw new Error(`${readCString(e.jr200_error_message())} (offset ${e.jr200_error_offset()})`);
    }
  };
  const checkedTape = code => {
    if (code) throw new Error(readCString(e.jr200_system_tape_error_message()));
  };
  let machineBooted = false;
  const checkedAddress = address => {
    if (!Number.isInteger(address) || address < 0 || address > 65535) {
      throw new Error('アドレスが範囲外です');
    }
    return address;
  };
  const uint64 = (low, high) => low + high * 0x100000000;
  const checkedLimit = (limit, capacity) => {
    if (!Number.isInteger(limit) || limit < 0 || limit > capacity) {
      throw new Error(`取得件数は0〜${capacity}で指定してください`);
    }
    return limit;
  };
  const machine = {
    boot(rom, font) {
      if (!(rom instanceof Uint8Array) || rom.length !== e.jr200_system_rom_capacity()) {
        throw new Error('結合ROMは16384バイト（ROM1、ROM2の順）が必要です');
      }
      if (!(font instanceof Uint8Array) || font.length !== e.jr200_system_font_capacity()) {
        throw new Error('フォントは2048バイトが必要です');
      }
      const heap = memory();
      heap.set(rom, e.jr200_system_rom_ptr());
      heap.set(font, e.jr200_system_font_ptr());
      if (e.jr200_system_boot(rom.length, font.length) !== 1) {
        machineBooted = false;
        throw new Error('ROMとフォントをシステムへ読み込めませんでした');
      }
      machineBooted = true;
      return this.registers();
    },
    clear() {
      e.jr200_system_clear();
      machineBooted = false;
    },
    reset() {
      if (e.jr200_system_reset() !== 1) {
        machineBooted = false;
        throw new Error('先にROMとフォントを読み込んでください');
      }
      return this.registers();
    },
    run(cycles) {
      if (!machineBooted) throw new Error('先にROMとフォントを読み込んでください');
      if (!Number.isInteger(cycles) || cycles < 0 || cycles > 10_000_000) {
        throw new Error('実行cycle数が範囲外です');
      }
      return e.jr200_system_run(cycles);
    },
    setKey(code, pressed) {
      if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error('キーコードが範囲外です');
      e.jr200_system_set_key(code, pressed ? 1 : 0);
    },
    pulseNmi() {
      e.jr200_system_pulse_nmi();
    },
    render() {
      e.jr200_system_render();
      return new Uint32Array(memory().buffer, e.jr200_system_framebuffer_ptr(), 320 * 224);
    },
    peek(address) {
      return e.jr200_system_peek(checkedAddress(address));
    },
    peekRange(address, length = 256) {
      checkedAddress(address);
      if (!Number.isInteger(length) || length < 1 || length > 256 || address + length > 65536) {
        throw new Error('メモリ表示はアドレス範囲内の1〜256バイトで指定してください');
      }
      return Uint8Array.from({length}, (_, offset) => e.jr200_system_peek(address + offset));
    },
    registers() {
      const names = ['pc', 'sp', 'x', 'a', 'b', 'cc', 'waiting'];
      return Object.fromEntries(names.map((name, field) => [name, e.jr200_system_cpu_register(field)]));
    },
    state() {
      return {
        irq: e.jr200_system_field(0) !== 0,
        cassetteRemote: e.jr200_system_field(1) !== 0,
        cycles: e.jr200_system_field(2),
        fontInitialized: e.jr200_system_field(5) !== 0,
        frameGeneration: e.jr200_system_field(7),
      };
    },
  };
  machine.debugger = {
    setHistoryEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('履歴指定はbooleanが必要です');
      e.jr200_system_debug_set_history(enabled ? 1 : 0);
    },
    clearHistory() {
      e.jr200_system_debug_clear_history();
    },
    addBreakpoint(address) {
      checkedAddress(address);
      if (e.jr200_system_debug_add_breakpoint(address) !== 1) {
        throw new Error('ブレークポイント上限は16件です');
      }
    },
    removeBreakpoint(address) {
      checkedAddress(address);
      return e.jr200_system_debug_remove_breakpoint(address) === 1;
    },
    clearBreakpoints() {
      e.jr200_system_debug_clear_breakpoints();
    },
    breakpoints() {
      const count = e.jr200_system_debug_field(8);
      return Array.from({length: count}, (_, index) => e.jr200_system_debug_breakpoint(index));
    },
    addWatchpoint(address, {read = false, write = false} = {}) {
      checkedAddress(address);
      if (typeof read !== 'boolean' || typeof write !== 'boolean' || (!read && !write)) {
        throw new Error('watchpointは読出しまたは書込みを選択してください');
      }
      const flags = (read ? 1 : 0) | (write ? 2 : 0);
      if (e.jr200_system_debug_add_watchpoint(address, flags) !== 1) {
        throw new Error('watchpoint上限は16件です');
      }
    },
    removeWatchpoint(address) {
      checkedAddress(address);
      return e.jr200_system_debug_remove_watchpoint(address) === 1;
    },
    clearWatchpoints() {
      e.jr200_system_debug_clear_watchpoints();
    },
    watchpoints() {
      const count = e.jr200_system_debug_field(9);
      return Array.from({length: count}, (_, index) => ({
        address: e.jr200_system_debug_watchpoint_field(index, 0),
        flags: e.jr200_system_debug_watchpoint_field(index, 1),
      }));
    },
    resume() {
      if (!machineBooted) throw new Error('先にROMとフォントを読み込んでください');
      e.jr200_system_debug_resume();
    },
    step() {
      if (!machineBooted) throw new Error('先にROMとフォントを読み込んでください');
      return e.jr200_system_debug_step();
    },
    state() {
      return {
        historyEnabled: e.jr200_system_debug_field(0) !== 0,
        stopReason: e.jr200_system_debug_field(1),
        stopAddress: e.jr200_system_debug_field(2),
        stopValue: e.jr200_system_debug_field(3),
        stopAccess: e.jr200_system_debug_field(4),
        stopOperation: e.jr200_system_debug_field(5),
        stopCycle: uint64(e.jr200_system_debug_field(6), e.jr200_system_debug_field(7)),
        breakpointCount: e.jr200_system_debug_field(8),
        watchpointCount: e.jr200_system_debug_field(9),
        instructionCount: e.jr200_system_debug_field(10),
        instructionDropped: uint64(e.jr200_system_debug_field(11), e.jr200_system_debug_field(12)),
        accessCount: e.jr200_system_debug_field(13),
        accessDropped: uint64(e.jr200_system_debug_field(14), e.jr200_system_debug_field(15)),
        instructionCapacity: e.jr200_system_debug_field(16),
        accessCapacity: e.jr200_system_debug_field(17),
      };
    },
    instructions(limit = 32) {
      const state = this.state();
      checkedLimit(limit, state.instructionCapacity);
      const start = Math.max(0, state.instructionCount - limit);
      return Array.from({length: state.instructionCount - start}, (_, offset) => {
        const index = start + offset;
        const field = value => e.jr200_system_debug_instruction_field(index, value);
        return {
          sequence: uint64(field(0), field(1)),
          cycle: uint64(field(2), field(3)),
          event: field(4),
          opcode: field(5),
          baseCycles: field(6),
          waitCycles: field(7),
          totalCycles: field(8),
          before: {pc: field(9), sp: field(11), x: field(13), a: field(15), b: field(17), cc: field(19)},
          after: {pc: field(10), sp: field(12), x: field(14), a: field(16), b: field(18), cc: field(20)},
        };
      });
    },
    accesses(limit = 64) {
      const state = this.state();
      checkedLimit(limit, state.accessCapacity);
      const start = Math.max(0, state.accessCount - limit);
      return Array.from({length: state.accessCount - start}, (_, offset) => {
        const index = start + offset;
        const field = value => e.jr200_system_debug_access_field(index, value);
        return {
          sequence: uint64(field(0), field(1)),
          cycle: uint64(field(2), field(3)),
          address: field(4),
          value: field(5),
          access: field(6),
          operation: field(7),
        };
      });
    },
  };
  machine.tape = {
    mount(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error('CJR入力はUint8Arrayで指定してください');
      if (bytes.length === 0 || bytes.length > e.jr200_system_tape_capacity()) {
        throw new Error('CJR入力は1バイト以上1 MiB以下で指定してください');
      }
      memory().set(bytes, e.jr200_system_tape_input_ptr());
      checkedTape(e.jr200_system_tape_mount(bytes.length));
      return this.state();
    },
    eject() {
      e.jr200_system_tape_eject();
      return this.state();
    },
    rewind() {
      if (e.jr200_system_tape_rewind() !== 1) throw new Error('再生用CJRがマウントされていません');
      return this.state();
    },
    armRecord() {
      checkedTape(e.jr200_system_tape_arm_record());
      return this.state();
    },
    output() {
      const size = e.jr200_system_tape_output_size();
      return memory().slice(e.jr200_system_tape_output_ptr(), e.jr200_system_tape_output_ptr() + size);
    },
    state() {
      return {
        state: e.jr200_system_tape_field(0),
        mode: e.jr200_system_tape_field(1),
        remote: e.jr200_system_tape_field(2) !== 0,
        samplePosition: uint64(e.jr200_system_tape_field(3), e.jr200_system_tape_field(4)),
        totalSamples: uint64(e.jr200_system_tape_field(5), e.jr200_system_tape_field(6)),
        captureBytes: e.jr200_system_tape_field(7),
        outputBytes: e.jr200_system_tape_field(8),
        error: e.jr200_system_tape_field(9),
        fileType: e.jr200_system_tape_field(10),
        baudFlag: e.jr200_system_tape_field(11),
        readStarted: e.jr200_system_tape_field(12) !== 0,
        errorDetail: e.jr200_system_tape_field(13),
        payloadBytes: e.jr200_system_tape_field(14),
        firstAddress: e.jr200_system_tape_field(15),
        footerAddress: e.jr200_system_tape_field(16),
        errorMessage: readCString(e.jr200_system_tape_error_message()),
      };
    },
  };
  return {
    machine,
    inspect(bytes, allowHeaderless=false) {
      if (!(bytes instanceof Uint8Array) || bytes.length > e.jr200_capacity()) throw new Error('入力上限は1 MiBです');
      memory().set(bytes,e.jr200_input_ptr());
      checked(e.jr200_inspect(bytes.length,allowHeaderless?1:0));
      const names=['hasHeader','fileType','baudFlag','dataBlocks','payloadBytes','firstAddress','footerAddress','lastEndExclusive','warnings'];
      const summary=Object.fromEntries(names.map((n,i)=>[n,e.jr200_summary_field(i)]));
      const name=memory().slice(e.jr200_name_ptr(),e.jr200_name_ptr()+16);
      summary.nameHex=Array.from(name,v=>v.toString(16).padStart(2,'0')).join(' ');
      summary.nameAscii=Array.from(name).filter(v=>v!==0).map(v=>v>=32&&v<127?String.fromCharCode(v):'·').join('');
      return summary;
    },
    pack(bytes,name,address,basic,baudFlag) {
      if (!(bytes instanceof Uint8Array)) throw new Error('入力はUint8Arrayで指定してください');
      if (typeof basic !== 'boolean') throw new Error('BASIC指定はbooleanが必要です');
      if (!Number.isInteger(baudFlag)||baudFlag<0||baudFlag>255) throw new Error('ボーレート指定は0〜255の整数です');
      if (!/^[\x20-\x7e]{1,16}$/.test(name)) throw new Error('ファイル名は半角ASCII 1〜16文字を指定してください');
      if (!Number.isInteger(address)||address<0||address>65535) throw new Error('アドレスは0000〜FFFFです');
      if (bytes.length > e.jr200_capacity()-16) throw new Error('入力が大きすぎます');
      const heap=memory(), p=e.jr200_input_ptr();
      heap.fill(0,p,p+16); heap.set(new TextEncoder().encode(name),p); heap.set(bytes,p+16);
      checked(e.jr200_encode(bytes.length,name.length,address,basic?1:0,baudFlag));
      return memory().slice(e.jr200_output_ptr(),e.jr200_output_ptr()+e.jr200_output_size());
    }
  };
}
