// SPDX-License-Identifier: BSD-3-Clause
import {loadCodec} from './codec.mjs';

const $ = id => document.getElementById(id);
const CPU_HZ = 1_339_285;
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 224;
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
};

let codec;
const canvas = $('screen');
const context = canvas.getContext('2d', {alpha: false});
const image = context.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
paintBlank();

try {
  codec = await loadCodec();
  $('status').textContent = 'WASM起動済み / 処理はローカルのみ';
  for (const id of ['rom-combined', 'rom1', 'rom2', 'font', 'cjr', 'bin', 'create', 'restore-assets', 'forget-assets']) {
    $(id).disabled = false;
  }
  updateAssetStatus();
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
    }
    paintMachine();
    if (timestamp - state.lastStatus >= 500) {
      showMachineStatus();
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
    $('pause').disabled = false;
    $('reset').disabled = false;
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
    canvas.focus();
  } catch (error) {
    setNotice('error', `起動できません: ${error.message}`);
  }
});

$('pause').addEventListener('click', () => {
  if (!state.booted) return;
  releaseKeys();
  setPaused(!state.paused, state.paused ? '再開しました' : '手動で一時停止しました');
  canvas.focus();
});

$('reset').addEventListener('click', () => {
  try {
    releaseKeys();
    codec.machine.reset();
    state.paused = false;
    state.cycleBalance = 0;
    state.lastFrame = 0;
    $('pause').textContent = '一時停止';
    setNotice('running', 'ROMとフォントを保持してリセットしました。');
    paintMachine();
    showMachineStatus();
    canvas.focus();
  } catch (error) {
    setNotice('error', `リセットできません: ${error.message}`);
  }
});

function setPaused(paused, reason) {
  state.paused = paused;
  state.lastFrame = 0;
  $('pause').textContent = paused ? '再開' : '一時停止';
  setNotice(paused ? 'paused' : 'running', reason);
  showMachineStatus();
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
  const mode = state.paused ? '一時停止' : '実行中';
  $('machine-status').textContent = `${mode} / PC $${hex4(registers.pc)} / cycles ${machine.cycles} / font ${machine.fontInitialized ? '初期化済み' : '転送中'}`;
}

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
