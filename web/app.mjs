// SPDX-License-Identifier: BSD-3-Clause
import {loadCodec} from './codec.mjs';
import {WebAudioOutput} from './audio.mjs';

const $ = id => document.getElementById(id);
const CPU_HZ = 1_339_285;
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 224;
const DEBUG_STOP_NAMES = ['実行可能', 'breakpoint', 'read watchpoint', 'write watchpoint', 'step'];
const DEBUG_EVENT_NAMES = ['RESET', 'instruction', 'IRQ', 'NMI', 'waiting'];
const DEBUG_ACCESS_NAMES = ['opcode', 'operand', 'data', 'stack', 'vector'];
const TAPE_STATE_NAMES = ['取出し済み', '停止', '再生中', '録音待機', '録音中', '録音完了', '終端', 'エラー'];
const state = {
  romMode: 'combined',
  rom: null,
  rom1: null,
  rom2: null,
  font: null,
  names: {},
  booted: false,
  paused: true,
  lastFrame: 0,
  cycleBalance: 0,
  lastStatus: 0,
  activeKeys: new Map(),
  tapeName: '',
};

let codec;
let audioOutput;
const canvas = $('screen');
const context = canvas.getContext('2d', {alpha: false});
const image = context.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
paintBlank();

try {
  codec = await loadCodec();
  audioOutput = new WebAudioOutput(codec.machine.audio, {onChange: () => showAudioStatus()});
  $('status').textContent = 'WASM起動済み / 処理はローカルのみ';
  for (const id of ['rom-combined', 'rom1', 'rom2', 'font', 'cjr', 'bin', 'create', 'restore-assets', 'forget-assets', 'tape-cjr', 'tape-mount', 'tape-record', 'audio-enable', 'audio-volume', 'audio-mute']) {
    $(id).disabled = false;
  }
  updateAssetStatus();
  showAudioStatus();
  showTapeStatus();
} catch (error) {
  $('status').textContent = `初期化エラー: ${error.message}`;
}

requestAnimationFrame(runFrame);

function paintBlank() {
  context.fillStyle = '#050806';
  context.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
}

function paintMachine() {
  const pixels = codec.machine.render();
  const rgba = image.data;
  for (let i = 0; i < pixels.length; ++i) {
    const color = pixels[i];
    const offset = i * 4;
    rgba[offset] = (color >>> 16) & 0xff;
    rgba[offset + 1] = (color >>> 8) & 0xff;
    rgba[offset + 2] = color & 0xff;
    rgba[offset + 3] = 0xff;
  }
  context.putImageData(image, 0, 0);
}

function runFrame(timestamp) {
  if (state.booted && !state.paused) {
    if (state.lastFrame === 0) state.lastFrame = timestamp;
    const seconds = Math.min(Math.max((timestamp - state.lastFrame) / 1000, 0), 0.05);
    state.lastFrame = timestamp;
    state.cycleBalance = Math.min(state.cycleBalance + seconds * CPU_HZ, CPU_HZ * 0.1);
    if (state.cycleBalance >= 1) {
      state.cycleBalance -= codec.machine.run(Math.floor(state.cycleBalance));
      const debug = codec.machine.debugger.state();
      if (debug.stopReason !== 0) {
        state.cycleBalance = 0;
        setPaused(true, describeDebugStop(debug));
      } else {
        audioOutput?.pump();
      }
    }
    paintMachine();
    if (timestamp - state.lastStatus >= 500) {
      showMachineStatus();
      showAudioStatus();
      showTapeStatus();
      state.lastStatus = timestamp;
    }
  } else {
    state.lastFrame = 0;
  }
  requestAnimationFrame(runFrame);
}

async function readExact(file, size, label) {
  if (!file) throw new Error(`${label}を選択してください`);
  if (file.size !== size) throw new Error(`${label}は${size}バイトである必要があります（選択: ${file.size}バイト）`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isUniform(bytes)) throw new Error(`${label}の内容が全バイト同一です`);
  return bytes;
}

function isUniform(bytes) {
  return bytes.length === 0 || bytes.every(value => value === bytes[0]);
}

function validateCombinedRom(rom) {
  if (!(rom instanceof Uint8Array) || rom.length !== 16384) throw new Error('結合ROMは16384バイト必要です');
  if (isUniform(rom.subarray(0, 8192)) || isUniform(rom.subarray(8192))) {
    throw new Error('ROM1またはROM2の内容が全バイト同一です');
  }
  const resetVector = (rom[16382] << 8) | rom[16383];
  const inRom = (resetVector >= 0xa000 && resetVector < 0xc000) || resetVector >= 0xe000;
  if (!inRom) throw new Error(`ROM2末尾のRESET vector ($${hex4(resetVector)}) がROM領域を指していません。ROM順序を確認してください`);
  return resetVector;
}

function selectedRom() {
  if (state.romMode === 'combined') {
    validateCombinedRom(state.rom);
    return state.rom;
  }
  if (!(state.rom1 instanceof Uint8Array) || !(state.rom2 instanceof Uint8Array)) {
    throw new Error('ROM1とROM2を両方選択してください');
  }
  const rom = new Uint8Array(16384);
  rom.set(state.rom1, 0);
  rom.set(state.rom2, 8192);
  validateCombinedRom(rom);
  return rom;
}

function assetsReady() {
  try {
    selectedRom();
    return state.font instanceof Uint8Array && state.font.length === 2048 && !isUniform(state.font);
  } catch {
    return false;
  }
}

function updateAssetStatus(message = '') {
  const lines = [];
  if (state.romMode === 'combined') {
    if (state.rom) {
      try {
        lines.push(`結合ROM: 16384バイト / RESET $${hex4(validateCombinedRom(state.rom))} / ${state.names.rom || '保存データ'}`);
      } catch (error) {
        lines.push(`結合ROM: エラー — ${error.message}`);
      }
    } else {
      lines.push('結合ROM: 未選択');
    }
  } else {
    lines.push(`ROM1 ($A000): ${state.rom1 ? `8192バイト / ${state.names.rom1}` : '未選択'}`);
    lines.push(`ROM2 ($E000): ${state.rom2 ? `8192バイト / ${state.names.rom2}` : '未選択'}`);
    if (state.rom1 && state.rom2) {
      try {
        lines.push(`ROM順序: 検証済み / RESET $${hex4(validateCombinedRom(selectedRom()))}`);
      } catch (error) {
        lines.push(`ROM順序: エラー — ${error.message}`);
      }
    }
  }
  lines.push(`フォント: ${state.font ? `2048バイト / ${state.names.font || '保存データ'}` : '未選択'}`);
  if (message) lines.push(message);
  $('asset-status').replaceChildren(...lines.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  $('start').disabled = !codec || !assetsReady();
}

function hex4(value) {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

async function loadInput(id, key, size, label) {
  try {
    const file = $(id).files[0];
    state[key] = await readExact(file, size, label);
    state.names[key] = file.name;
    updateAssetStatus();
  } catch (error) {
    state[key] = null;
    state.names[key] = '';
    updateAssetStatus(`エラー: ${error.message}`);
  }
}

$('rom-combined').addEventListener('change', () => loadInput('rom-combined', 'rom', 16384, '結合ROM'));
$('rom1').addEventListener('change', () => loadInput('rom1', 'rom1', 8192, 'ROM1'));
$('rom2').addEventListener('change', () => loadInput('rom2', 'rom2', 8192, 'ROM2'));
$('font').addEventListener('change', () => loadInput('font', 'font', 2048, 'フォント'));

for (const input of document.querySelectorAll('input[name="rom-mode"]')) {
  input.addEventListener('change', () => {
    state.romMode = input.value;
    $('combined-fields').hidden = state.romMode !== 'combined';
    $('split-fields').hidden = state.romMode !== 'split';
    updateAssetStatus();
  });
}

$('start').addEventListener('click', async () => {
  try {
    const rom = selectedRom();
    const resetVector = validateCombinedRom(rom);
    codec.machine.boot(rom, state.font);
    state.booted = true;
    state.paused = false;
    state.cycleBalance = 0;
    state.lastFrame = 0;
    resumeAudioForRun();
    $('pause').disabled = false;
    $('reset').disabled = false;
    setDebuggerEnabled(true);
    $('pause').textContent = '一時停止';
    setNotice('running', `選択したROMとフォントでCPUを起動しました。RESET vector $${hex4(resetVector)}。画面をクリックして入力してください。`);
    if ($('remember-assets').checked) {
      try {
        await saveAssets(rom, state.font);
        updateAssetStatus('明示許可により、このブラウザのIndexedDBへ保存しました');
      } catch (error) {
        updateAssetStatus(`CPUは起動しましたが、IndexedDBへ保存できません: ${error.message}`);
      }
    }
    paintMachine();
    showMachineStatus();
    refreshDebugger();
    canvas.focus();
  } catch (error) {
    setNotice('error', `起動できません: ${error.message}`);
  }
});

$('pause').addEventListener('click', () => {
  if (!state.booted) return;
  releaseKeys();
  if (state.paused) codec.machine.debugger.resume();
  setPaused(!state.paused, state.paused ? '再開しました' : '手動で一時停止しました');
  canvas.focus();
});

$('reset').addEventListener('click', () => {
  try {
    releaseKeys();
    codec.machine.reset();
    audioOutput?.flush();
    state.paused = false;
    state.cycleBalance = 0;
    state.lastFrame = 0;
    resumeAudioForRun();
    $('pause').textContent = '一時停止';
    setNotice('running', 'ROMとフォントを保持してリセットしました。');
    paintMachine();
    showMachineStatus();
    refreshDebugger();
    canvas.focus();
  } catch (error) {
    setNotice('error', `リセットできません: ${error.message}`);
  }
});

function setPaused(paused, reason) {
  state.paused = paused;
  state.lastFrame = 0;
  if (paused) {
    audioOutput?.suspend().catch(error => showAudioStatus(`音声停止エラー: ${error.message}`));
  } else {
    resumeAudioForRun();
  }
  $('pause').textContent = paused ? '再開' : '一時停止';
  setNotice(paused ? 'paused' : 'running', reason);
  showMachineStatus();
  refreshDebugger();
}

function resumeAudioForRun() {
  if (!audioOutput) return;
  if (!audioOutput.state().enabled) {
    codec.machine.audio.discard();
    showAudioStatus();
    return;
  }
  audioOutput.resume().catch(error => showAudioStatus(`音声再開エラー: ${error.message}`));
}

function setNotice(kind, text) {
  $('emulator-notice').dataset.state = kind;
  $('emulator-notice').textContent = text;
}

function showMachineStatus() {
  if (!state.booted) {
    $('machine-status').textContent = 'ROM未提供のためCPUは実行していません。';
    return;
  }
  const registers = codec.machine.registers();
  const machine = codec.machine.state();
  const debug = codec.machine.debugger.state();
  const mode = debug.stopReason !== 0 ? `デバッガ停止 (${DEBUG_STOP_NAMES[debug.stopReason]})` : state.paused ? '一時停止' : '実行中';
  $('machine-status').textContent = `${mode} / PC $${hex4(registers.pc)} / cycles ${machine.cycles} / font ${machine.fontInitialized ? '初期化済み' : '転送中'}`;
}

function showAudioStatus(message = '') {
  if (!audioOutput) {
    $('audio-status').textContent = 'WASMの準備を待っています。';
    return;
  }
  const audio = audioOutput.state();
  const context = audio.contextState === 'not-created'
    ? '未作成（自動再生なし）'
    : audio.contextState;
  const lines = [
    `Web Audio: ${audio.enabled ? '有効' : '無効'} / context ${context}`,
    `sample rate: core ${audio.coreSampleRate} Hz / output ${audio.deviceSampleRate || '未確定'} Hz`,
    `PCM queue: ${audio.queueAvailable} / ${audio.queueCapacity} / core overflow ${audio.coreDropped}`,
    `音量: ${Math.round(audio.volume * 100)}% / ミュート ${audio.muted ? 'ON' : 'OFF'}`,
    `予約済み: ${audio.scheduledFrames} frames / 非0 ${audio.nonzeroFrames} / peak ${audio.peakSample}`,
    `active ${audio.activeSources} / underrun ${audio.underruns} / 破棄 ${audio.discardedFrames}`,
  ];
  if (audio.lastError) lines.push(`エラー: ${audio.lastError}`);
  if (message) lines.push(message);
  lines.push('この出力はエミュレータ音声です。カセットWAV生成ではありません。');
  $('audio-status').textContent = lines.join('\n');
  $('audio-enable').disabled = !audio.supported ||
    (audio.enabled && audio.contextState === 'running');
  $('audio-enable').textContent = audio.enabled ? '音声を再開' : '音声を有効化';
  $('audio-disable').disabled = !audio.enabled;
  $('audio-volume').disabled = false;
  $('audio-mute').disabled = false;
  $('audio-volume-value').textContent = `${Math.round(audio.volume * 100)}%`;
}

$('audio-enable').addEventListener('click', async () => {
  try {
    await audioOutput.enable();
    showAudioStatus('利用者操作で音声デバイスを有効化しました。');
  } catch (error) {
    showAudioStatus(`音声を有効化できません: ${error.message}`);
  }
});

$('audio-disable').addEventListener('click', async () => {
  try {
    await audioOutput.disable();
    showAudioStatus('予約済み音声とPCM queueを破棄して停止しました。');
  } catch (error) {
    showAudioStatus(`音声を停止できません: ${error.message}`);
  }
});

$('audio-volume').addEventListener('input', event => {
  try {
    audioOutput.setVolume(Number(event.target.value) / 100);
    showAudioStatus();
  } catch (error) {
    showAudioStatus(`音量を変更できません: ${error.message}`);
  }
});

$('audio-mute').addEventListener('change', event => {
  try {
    audioOutput.setMuted(event.target.checked);
    showAudioStatus(event.target.checked
      ? 'ミュート時の予約済み音声とPCM queueを破棄しました。'
      : 'ミュートを解除しました。');
  } catch (error) {
    showAudioStatus(`ミュートを変更できません: ${error.message}`);
  }
});

function showTapeStatus(message = '') {
  if (!codec) return;
  const tape = codec.machine.tape.state();
  const lines = [`状態: ${TAPE_STATE_NAMES[tape.state] || `不明(${tape.state})`} / REMOTE ${tape.remote ? 'ON' : 'OFF'}`];
  if (tape.mode === 1) {
    const kind = tape.fileType === 0 ? 'BASIC' : 'マシン語';
    const baud = tape.baudFlag === 0 ? '2400 baud' : '600 baud';
    lines.push(`媒体: ${state.tapeName || 'CJR'} / ${kind} / ${baud} / payload ${tape.payloadBytes} bytes`);
    lines.push(`信号位置: ${tape.samplePosition} / ${tape.totalSamples} samples`);
  } else if (tape.mode === 2) {
    lines.push(`波形記録: ${tape.captureBytes} bytes / CJR出力: ${tape.outputBytes} bytes`);
    if (tape.outputBytes > 0) {
      lines.push(`論理領域: $${hex4(tape.firstAddress)} → $${hex4(tape.footerAddress)} / payload ${tape.payloadBytes} bytes`);
    }
  } else {
    lines.push('媒体: なし');
  }
  if (tape.error) lines.push(`エラー: ${tape.errorMessage} (code ${tape.error}, detail ${tape.errorDetail})`);
  if (message) lines.push(message);
  $('tape-status').textContent = lines.join('\n');
  $('tape-eject').disabled = tape.state === 0;
  $('tape-rewind').disabled = tape.mode !== 1;
  $('tape-download').disabled = tape.state !== 5 || tape.outputBytes === 0;
  $('tape-replay-output').disabled = tape.state !== 5 || tape.outputBytes === 0;
}

function setDebuggerEnabled(enabled) {
  for (const control of document.querySelectorAll('.debug-control')) control.disabled = !enabled;
}

function parseDebugAddress(id) {
  const value = $(id).value.trim();
  if (!/^[0-9a-fA-F]{1,4}$/.test(value)) throw new Error('アドレスは0000〜FFFFの16進数で指定してください');
  return parseInt(value, 16);
}

function describeDebugStop(debug) {
  if (debug.stopReason === 1) return `breakpoint $${hex4(debug.stopAddress)} で命令実行前に停止しました。`;
  if (debug.stopReason === 2) return `CPU読出し watchpoint $${hex4(debug.stopAddress)} = $${debug.stopValue.toString(16).toUpperCase().padStart(2, '0')} で命令完了後に停止しました。`;
  if (debug.stopReason === 3) return `CPU書込み watchpoint $${hex4(debug.stopAddress)} = $${debug.stopValue.toString(16).toUpperCase().padStart(2, '0')} で命令完了後に停止しました。`;
  if (debug.stopReason === 4) return `1命令step後、$${hex4(debug.stopAddress)} で停止しました。`;
  return '実行可能です。';
}

function replaceDebugList(id, items, render) {
  const list = $(id);
  if (items.length === 0) {
    const item = document.createElement('li');
    item.textContent = '未設定';
    list.replaceChildren(item);
    return;
  }
  list.replaceChildren(...items.map(render));
}

function refreshDebugger() {
  if (!codec || !state.booted) return;
  const registers = codec.machine.registers();
  const debug = codec.machine.debugger.state();
  $('debug-history-enabled').checked = debug.historyEnabled;
  $('debug-registers').textContent = [
    `状態  ${DEBUG_STOP_NAMES[debug.stopReason] || 'unknown'}${debug.stopReason ? ` / address $${hex4(debug.stopAddress)} / cycle ${debug.stopCycle}` : ''}`,
    `PC $${hex4(registers.pc)}  SP $${hex4(registers.sp)}  X $${hex4(registers.x)}`,
    `A  $${registers.a.toString(16).toUpperCase().padStart(2, '0')}    B  $${registers.b.toString(16).toUpperCase().padStart(2, '0')}    CC $${registers.cc.toString(16).toUpperCase().padStart(2, '0')}    WAI ${registers.waiting}`,
  ].join('\n');

  replaceDebugList('debug-breakpoints', codec.machine.debugger.breakpoints(), address => {
    const item = document.createElement('li');
    item.append(`$${hex4(address)}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '解除';
    remove.addEventListener('click', () => {
      codec.machine.debugger.removeBreakpoint(address);
      refreshDebugger();
    });
    item.append(remove);
    return item;
  });

  replaceDebugList('debug-watchpoints', codec.machine.debugger.watchpoints(), watchpoint => {
    const modes = [];
    if (watchpoint.flags & 1) modes.push('read');
    if (watchpoint.flags & 2) modes.push('write');
    const item = document.createElement('li');
    item.append(`$${hex4(watchpoint.address)} / ${modes.join('+')}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '解除';
    remove.addEventListener('click', () => {
      codec.machine.debugger.removeWatchpoint(watchpoint.address);
      refreshDebugger();
    });
    item.append(remove);
    return item;
  });

  $('debug-history-status').textContent = `命令履歴 ${debug.instructionCount} / ${debug.instructionCapacity}（破棄 ${debug.instructionDropped}）、CPUアクセス履歴 ${debug.accessCount} / ${debug.accessCapacity}（破棄 ${debug.accessDropped}）。`;
  const instructions = codec.machine.debugger.instructions(32).reverse();
  $('debug-instructions').textContent = instructions.length === 0
    ? debug.historyEnabled ? '記録はまだありません。' : '履歴記録は無効です。'
    : instructions.map(entry => {
        const event = DEBUG_EVENT_NAMES[entry.event] || `event-${entry.event}`;
        return `#${entry.sequence} C${entry.cycle} $${hex4(entry.before.pc)} ${event} OP $${entry.opcode.toString(16).toUpperCase().padStart(2, '0')} -> $${hex4(entry.after.pc)} +${entry.totalCycles} (wait ${entry.waitCycles})`;
      }).join('\n');
  const accesses = codec.machine.debugger.accesses(64).reverse();
  $('debug-accesses').textContent = accesses.length === 0
    ? debug.historyEnabled ? '記録はまだありません。' : '履歴記録は無効です。'
    : accesses.map(entry => {
        const operation = entry.operation === 0 ? 'R' : 'W';
        const access = DEBUG_ACCESS_NAMES[entry.access] || `type-${entry.access}`;
        return `#${entry.sequence} C${entry.cycle} ${operation} $${hex4(entry.address)} = $${entry.value.toString(16).toUpperCase().padStart(2, '0')} (${access})`;
      }).join('\n');
}

function debugAction(action) {
  try {
    action();
    refreshDebugger();
  } catch (error) {
    setNotice('error', `デバッガ操作エラー: ${error.message}`);
  }
}

$('debug-run').addEventListener('click', () => debugAction(() => {
  releaseKeys();
  codec.machine.debugger.resume();
  state.cycleBalance = 0;
  setPaused(false, 'デバッガから実行を再開しました。');
  canvas.focus();
}));

$('debug-pause').addEventListener('click', () => debugAction(() => {
  releaseKeys();
  setPaused(true, 'デバッガで一時停止しました。');
}));

$('debug-step').addEventListener('click', () => debugAction(() => {
  releaseKeys();
  state.paused = true;
  state.cycleBalance = 0;
  codec.machine.debugger.step();
  paintMachine();
  setPaused(true, describeDebugStop(codec.machine.debugger.state()));
}));

$('debug-refresh').addEventListener('click', refreshDebugger);
$('debug-history-enabled').addEventListener('change', event => debugAction(() => {
  codec.machine.debugger.setHistoryEnabled(event.target.checked);
}));
$('debug-clear-history').addEventListener('click', () => debugAction(() => {
  codec.machine.debugger.clearHistory();
}));
$('debug-add-breakpoint').addEventListener('click', () => debugAction(() => {
  codec.machine.debugger.addBreakpoint(parseDebugAddress('debug-breakpoint-address'));
}));
$('debug-clear-breakpoints').addEventListener('click', () => debugAction(() => {
  codec.machine.debugger.clearBreakpoints();
}));
$('debug-add-watchpoint').addEventListener('click', () => debugAction(() => {
  codec.machine.debugger.addWatchpoint(parseDebugAddress('debug-watch-address'), {
    read: $('debug-watch-read').checked,
    write: $('debug-watch-write').checked,
  });
}));
$('debug-clear-watchpoints').addEventListener('click', () => debugAction(() => {
  codec.machine.debugger.clearWatchpoints();
}));
$('debug-memory-read').addEventListener('click', () => debugAction(() => {
  const start = parseDebugAddress('debug-memory-address');
  const bytes = codec.machine.peekRange(start, Math.min(256, 65536 - start));
  const rows = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const values = Array.from(bytes.subarray(offset, offset + 16), value => value.toString(16).toUpperCase().padStart(2, '0'));
    rows.push(`${hex4(start + offset)}: ${values.join(' ')}`);
  }
  $('debug-memory').textContent = rows.join('\n');
}));

function keyCodeFor(event) {
  const special = {
    Enter: 0x0d,
    Backspace: 0x08,
    Delete: 0x7f,
    ArrowUp: 0x1e,
    ArrowDown: 0x1f,
    ArrowLeft: 0x1d,
    ArrowRight: 0x1c,
    Insert: 0x13,
  };
  if (event.key === 'Home') return event.shiftKey ? 0x0c : 0x0b;
  if (Object.hasOwn(special, event.key)) return special[event.key];
  if (event.key.length === 1) {
    const code = event.key.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e ? code : null;
  }
  return null;
}

canvas.addEventListener('keydown', event => {
  if (!state.booted || state.paused || event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Escape') {
    if (!event.repeat) codec.machine.pulseNmi();
    event.preventDefault();
    return;
  }
  const code = keyCodeFor(event);
  if (code === null) return;
  event.preventDefault();
  if (state.activeKeys.has(event.code)) return;
  state.activeKeys.set(event.code, code);
  codec.machine.setKey(code, true);
});

window.addEventListener('keyup', event => {
  const code = state.activeKeys.get(event.code);
  if (code === undefined || !codec) return;
  codec.machine.setKey(code, false);
  state.activeKeys.delete(event.code);
});

function releaseKeys() {
  if (codec) {
    for (const code of state.activeKeys.values()) codec.machine.setKey(code, false);
  }
  state.activeKeys.clear();
}

window.addEventListener('blur', () => {
  releaseKeys();
  if (state.booted && !state.paused) setPaused(true, 'フォーカスを失ったため一時停止しました。');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseKeys();
    if (state.booted && !state.paused) setPaused(true, 'ページが非表示になったため一時停止しました。');
  }
});

function openAssetDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('このブラウザはIndexedDBを利用できません'));
      return;
    }
    const request = indexedDB.open('jr200-web-local-assets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDBを開けません'));
  });
}

async function withAssetStore(mode, operation) {
  const database = await openAssetDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('assets', mode);
      const request = operation(transaction.objectStore('assets'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB操作に失敗しました'));
    });
  } finally {
    database.close();
  }
}

async function saveAssets(rom, font) {
  const value = {rom: rom.slice().buffer, font: font.slice().buffer};
  await withAssetStore('readwrite', store => store.put(value, 'jr200'));
}

$('restore-assets').addEventListener('click', async () => {
  try {
    const saved = await withAssetStore('readonly', store => store.get('jr200'));
    if (!saved) throw new Error('保存済みファイルはありません');
    const rom = new Uint8Array(saved.rom);
    const font = new Uint8Array(saved.font);
    validateCombinedRom(rom);
    if (font.length !== 2048 || isUniform(font)) throw new Error('保存済みフォントが不正です');
    state.romMode = 'combined';
    state.rom = rom;
    state.font = font;
    state.names.rom = 'IndexedDB';
    state.names.font = 'IndexedDB';
    document.querySelector('input[name="rom-mode"][value="combined"]').checked = true;
    $('combined-fields').hidden = false;
    $('split-fields').hidden = true;
    updateAssetStatus('保存済みファイルを明示操作で復元しました');
  } catch (error) {
    updateAssetStatus(`復元エラー: ${error.message}`);
  }
});

$('forget-assets').addEventListener('click', async () => {
  try {
    await withAssetStore('readwrite', store => store.delete('jr200'));
    updateAssetStatus('IndexedDBの保存済みファイルを削除しました');
  } catch (error) {
    updateAssetStatus(`削除エラー: ${error.message}`);
  }
});

async function readLimited(file) {
  if (!file) throw new Error('ファイルを選択してください');
  if (file.size > 1024 * 1024) throw new Error('上限は1 MiBです');
  return new Uint8Array(await file.arrayBuffer());
}

$('tape-mount').addEventListener('click', async () => {
  try {
    const file = $('tape-cjr').files[0];
    const bytes = await readLimited(file);
    codec.machine.tape.mount(bytes);
    state.tapeName = file.name;
    showTapeStatus('通常のカセット入力信号としてマウントしました。LOADまたはMLOADを実行してください。');
  } catch (error) {
    showTapeStatus(`マウントできません: ${error.message}`);
  }
});

$('tape-eject').addEventListener('click', () => {
  codec.machine.tape.eject();
  state.tapeName = '';
  showTapeStatus('CJRを取り出しました。');
});

$('tape-rewind').addEventListener('click', () => {
  try {
    codec.machine.tape.rewind();
    showTapeStatus('CJRの信号位置を先頭へ戻しました。');
  } catch (error) {
    showTapeStatus(`巻戻しできません: ${error.message}`);
  }
});

$('tape-record').addEventListener('click', () => {
  try {
    codec.machine.tape.armRecord();
    state.tapeName = '';
    showTapeStatus('録音待機中です。JR-200側でSAVEまたはMSAVEを実行してください。REMOTE OFF後にCJRを検証します。');
  } catch (error) {
    showTapeStatus(`録音待機にできません: ${error.message}`);
  }
});

$('tape-download').addEventListener('click', () => {
  try {
    const output = codec.machine.tape.output();
    if (output.length === 0) throw new Error('保存できる録音CJRがありません');
    const url = URL.createObjectURL(new Blob([output], {type: 'application/octet-stream'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jr200-save.cjr';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showTapeStatus(`${output.length}バイトの検証済みCJRを保存しました。`);
  } catch (error) {
    showTapeStatus(`録音CJRを保存できません: ${error.message}`);
  }
});

$('tape-replay-output').addEventListener('click', () => {
  try {
    const output = codec.machine.tape.output();
    if (output.length === 0) throw new Error('再生できる録音CJRがありません');
    codec.machine.tape.mount(output);
    state.tapeName = '録音結果';
    showTapeStatus('直前の録音CJRを通常のカセット入力信号としてマウントしました。');
  } catch (error) {
    showTapeStatus(`録音CJRをマウントできません: ${error.message}`);
  }
});

async function inspectFile() {
  try {
    const summary = codec.inspect(await readLimited($('cjr').files[0]), $('headerless').checked);
    const flags = [[1, 'ヘッダーなし：形式・速度は不明'], [2, 'ブロック番号が非連続'], [4, 'アドレスが非連続：単純なBIN連結は不可'], [8, 'フッターアドレスが最終領域末尾と異なる'], [16, '未知のファイル種別'], [32, '標準と異なるヘッダーアドレス'], [64, 'データブロックなし']]
      .filter(([bit]) => summary.warnings & bit)
      .map(([, text]) => text);
    $('result').textContent = JSON.stringify({...summary, diagnostics: flags, hardwareVerified: false}, null, 2);
  } catch (error) {
    $('result').textContent = `エラー: ${error.message}`;
  }
}

$('cjr').addEventListener('change', inspectFile);
$('headerless').addEventListener('change', () => {
  if ($('cjr').files.length) inspectFile();
});

$('pack').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const file = $('bin').files[0];
    const data = await readLimited(file);
    const output = codec.pack(data, $('name').value, parseInt($('address').value, 16), $('kind').value === '0', Number($('baud').value));
    const url = URL.createObjectURL(new Blob([output], {type: 'application/octet-stream'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name.replace(/\.[^.]*$/, '') + '.cjr';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('pack-status').textContent = `${output.length}バイトを書き出しました。実機互換は未検証です。`;
  } catch (error) {
    $('pack-status').textContent = `エラー: ${error.message}`;
  }
});
