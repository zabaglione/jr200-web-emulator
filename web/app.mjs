// SPDX-License-Identifier: BSD-3-Clause
import {loadCodec} from './codec.mjs';
import {WebAudioOutput} from './audio.mjs';
import {basicInputReady, fetchGame, launchImageMatches, readyPromptRows,
  requestedAutoLaunch, requestedGame, supportsAutomaticBasic, titleMarkerVisible,
  validateLaunchImage} from './game-launch.mjs';
import {folderMembers, validateLaunchPack, zipMembers} from './launch-pack.mjs';
import {
  CONTROL_KEYS,
  INPUT_MODES,
  KEY_ROWS,
  MODE_NAMES,
  GamepadController,
  InputController,
  RomajiKanaConverter,
  displayCodeFor,
  functionLegendFor,
  encodeJrText,
  forcedKeyCodeForJoystick,
  keyIdForKeyboardEvent,
  resolveKey,
} from './keyboard.mjs';

const $ = id => document.getElementById(id);
const CPU_HZ = 1_339_285;
const AUDIO_RUN_SLICE_CYCLES = Math.floor(CPU_HZ * 0.05);
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 224;
const DEBUG_STOP_NAMES = ['実行可能', 'breakpoint', 'read watchpoint', 'write watchpoint', 'step'];
const DEBUG_EVENT_NAMES = ['RESET', 'instruction', 'IRQ', 'NMI', 'waiting'];
const DEBUG_ACCESS_NAMES = ['opcode', 'operand', 'data', 'stack', 'vector'];
const TAPE_STATE_NAMES = ['取出し済み', '停止', '再生中', '録音待機', '録音中', '録音完了', '終端', 'エラー'];
const PREFERENCE_KEY = 'jr200-web-preferences-v1';
const DEFAULT_PREFERENCES = Object.freeze({
  pauseOnFocusLoss: false,
  keyClickEnabled: false,
  audioEnabled: true,
  audioVolume: 20,
  audioMuted: false,
  debugHistoryEnabled: false,
  tapeMonitorEnabled: true,
  tapeMonitorVolume: 25,
  screenScale: 'auto',
  screenAspect: 'square',
  screenRotation: 0,
  screenSmoothing: false,
  cpuSpeed: 100,
  tapeTurbo: false,
  ramExpansion1: false,
  ramExpansion2: false,
  ramInitPattern: 0,
  quickTypeInterval: 30,
  macroSlot: 0,
  wavRate: '48000',
  wavBaud: '2400',
  wavDecodeChannel: 'auto',
  packName: 'TEST',
  packAddress: '7000',
  packKind: '1',
  packBaud: '0',
  romajiKana: false,
  macros: Object.freeze(Array(10).fill('')),
  gamepadButtonA: 0,
  gamepadButtonB: 1,
  gamepadOneButton: false,
  forcedJoystick: false,
  forcedJoystickA: 0x20,
  forcedJoystickB: 0x20,
});
const preferences = loadPreferences();
const state = {
  romMode: 'combined',
  rom: null,
  rom1: null,
  rom2: null,
  font: null,
  names: {},
  origins: {},
  assetSelectionRevision: 0,
  assetReadRevisions: {},
  assetReadPending: {},
  booted: false,
  paused: true,
  lastFrame: 0,
  cycleBalance: 0,
  lastStatus: 0,
  fpsWindowStart: 0,
  fpsFrames: 0,
  measuredFps: 0,
  tapeName: '',
  tapeSelectedName: '',
  tapeSelectionRevision: 0,
  tapeMountedSelectionRevision: 0,
  tapeSelectionStatus: '',
  linkedGame: null,
  linkedLaunch: null,
  gameLinkPending: false,
  gameLinkRevision: 0,
  packImportPending: false,
  packImportRevision: 0,
  wavCjr: null,
  wavName: '',
  decodedCjr: null,
  decodedName: '',
  autoType: null,
  appliedMemoryConfig: null,
};

let codec;
let audioOutput;
let audioSettingRevision = 0;
let gamepadController;
let inputController;
const canvas = $('screen');
const context = canvas.getContext('2d', {alpha: false});
let image = context.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
const romajiConverter = new RomajiKanaConverter();
const forcedJoystickSource = 'gamepad:forced';
let forcedJoystickCode = null;
applyScreenPreferences();
new ResizeObserver(updateAutoScreenScale).observe(document.querySelector('.display-area'));
paintBlank();

const keyboardToggle = $('keyboard-toggle');
const keyboardDeck = $('keyboard-deck');
const virtualKeyboard = $('virtual-keyboard');
const virtualKeys = new Map();
const pointerSources = new Map();
let virtualSourceSequence = 0;
let glyphCacheToken = '';
const glyphCache = new Map();
buildVirtualKeyboard();
syncPreferenceControls();
$('headerless').checked = false;
let headerlessPermissionRevoked = false;
let headerlessExplicitlyAllowed = false;
function revokeHeaderlessPermission() {
  const wasEnabled = $('headerless').checked || headerlessPermissionRevoked;
  $('headerless').checked = false;
  headerlessPermissionRevoked = false;
  if (wasEnabled && codec && $('cjr').files.length) void inspectFile();
}
window.addEventListener('pagehide', () => {
  headerlessPermissionRevoked = $('headerless').checked;
  headerlessExplicitlyAllowed = false;
  $('headerless').checked = false;
});
window.addEventListener('pageshow', () => {
  headerlessExplicitlyAllowed = false;
  revokeHeaderlessPermission();
  requestAnimationFrame(revokeHeaderlessPermission);
});
keyboardToggle.addEventListener('click', () => {
  const visible = keyboardDeck.hidden;
  keyboardDeck.hidden = !visible;
  document.body.dataset.keyboardVisible = String(visible);
  keyboardToggle.setAttribute('aria-expanded', String(visible));
  keyboardToggle.textContent = visible ? '仮想キーを閉じる' : '仮想キー';
  if (!visible) releaseKeys();
});
document.body.dataset.keyboardVisible = String(!keyboardDeck.hidden);

try {
  codec = await loadCodec();
  inputController = new InputController({
    sendCode: (code, pressed) => codec.machine.setKey(code, pressed),
    pulseNmi: () => codec.machine.pulseNmi(),
    onChange: input => {
      if (input.mode !== INPUT_MODES.KANA) romajiConverter.reset();
      document.body.dataset.inputMode = input.mode;
      keyboardDeck.dataset.mode = input.mode;
      refreshVirtualKeyboard();
    },
  });
  inputController.notify();
  gamepadController = new GamepadController({
    setJoystick: (player, activeLowState) => setGamepadState(player, activeLowState),
    getMapping: () => ({
      buttonA: preferences.gamepadButtonA,
      buttonB: preferences.gamepadButtonB,
      oneButton: preferences.gamepadOneButton,
    }),
    onChange: snapshot => showGamepadStatus(snapshot),
  });
  gamepadController.update();
  audioOutput = new WebAudioOutput(codec.machine.audio, {
    initialEnabled: preferences.audioEnabled,
    initialVolume: preferences.audioVolume / 100,
    initialMuted: preferences.audioMuted,
    initialKeyClickEnabled: preferences.keyClickEnabled,
    onChange: () => showAudioStatus(),
  });
  applyTapeMonitorPreferences();
  $('status').textContent = 'WASM起動済み / 処理はローカルのみ';
  updateAssetStatus();
  await restoreSavedAssets({automatic: true});
  void prepareLinkedGame();
  for (const id of ['rom-combined', 'rom1', 'rom2', 'font', 'cjr', 'bin', 'create', 'remember-assets', 'restore-assets', 'forget-assets', 'tape-cjr', 'launch-pack-zip', 'launch-pack-folder', 'tape-mount', 'tape-record', 'tape-monitor-enabled', 'tape-monitor-volume', 'audio-enable', 'audio-volume', 'audio-mute', 'key-click-enabled', 'pause-on-focus-loss', 'wav-rate', 'wav-baud', 'wav-decode-input', 'wav-decode-channel', 'fullscreen', 'screen-scale', 'screen-aspect', 'screen-rotation', 'screen-smoothing', 'cpu-speed', 'tape-turbo', 'ram-expansion-1', 'ram-expansion-2', 'ram-init-pattern', 'quick-type-text', 'quick-type-interval', 'macro-slot', 'macro-text', 'macro-save', 'macro-delete', 'romaji-kana', 'gamepad-button-a', 'gamepad-button-b', 'gamepad-one-button', 'forced-joystick', 'forced-joystick-a', 'forced-joystick-b']) {
    $(id).disabled = false;
  }
  $('fullscreen').disabled = !document.fullscreenEnabled;
  showAutomaticInputStatus('ROM起動後に利用できます。');
  updateMacroEditor();
  showAudioStatus();
  showTapeStatus();
} catch (error) {
  $('status').textContent = `初期化エラー: ${error.message}`;
}

revokeHeaderlessPermission();
requestAnimationFrame(runFrame);

async function prepareLinkedGame() {
  let id;
  const selectionRevision = state.tapeSelectionRevision;
  const requestRevision = state.gameLinkRevision;
  try {
    id = requestedGame(location.search);
    if (id === null) return;
    const autoLaunch = requestedAutoLaunch(location.search);
    state.gameLinkPending = true;
    $('game-launch').hidden = false;
    $('game-launch-status').textContent = '作品CJRを確認しています。';
    const game = await fetchGame(id, new URL('./', location.href));
    if (state.tapeSelectionRevision !== selectionRevision
        || state.gameLinkRevision !== requestRevision) return;
    mountGameWithInput(game, {name: `${id}.cjr`, autoLaunch, requireMachine: true,
      label: `${game.entry.title} ${game.entry.version}`,
      instructions: `手元のROMとフォントで起動後、MLOAD、続いて ${game.entry.runCommand} を入力してください。CJRの自動実行や高速ロードはしていません。`});
    state.gameLinkPending = false;
  } catch (error) {
    if (state.tapeSelectionRevision !== selectionRevision
        || state.gameLinkRevision !== requestRevision) return;
    state.gameLinkPending = false;
    $('game-launch').hidden = false;
    $('game-launch-status').textContent = `作品リンクを開けません: ${error.message}`;
    $('game-launch-instructions').textContent = '手元のCJRを選んで読み込むことはできます。';
  }
}

function mountGameWithInput(game, {name, autoLaunch, requireMachine, label, instructions}) {
  const summary = codec.inspect(game.bytes);
  if (summary.dataBlocks < 1 || (requireMachine ? summary.fileType !== 1
    : summary.fileType !== 0 && summary.fileType !== 1)) {
    throw new Error('作品は標準LOAD/MLOADに対応するCJRではありません。');
  }
  const image = autoLaunch && game.entry.titleMarker
    ? validateLaunchImage(game.entry, game.bytes, summary) : null;
  codec.machine.tape.mount(game.bytes);
  $('tape-cjr').value = '';
  state.linkedGame = game;
  state.tapeSelectedName = name;
  state.tapeName = name;
  state.tapeSelectionRevision++;
  state.tapeMountedSelectionRevision = state.tapeSelectionRevision;
  state.tapeSelectionStatus = summary.fileType === 1
    ? 'マシン語 / MLOAD用です。' : 'BASIC / LOAD用です。';
  $('game-launch').hidden = false;
  $('game-launch-status').textContent = `${label} をカセットにセットしました。`;
  if (autoLaunch && game.entry.titleMarker) {
    state.linkedLaunch = {phase: 'assets', game, image,
      mountedRevision: state.tapeSelectionRevision, deadline: 0,
      sawRead: false, promptRows: []};
    $('game-launch-cancel').hidden = false;
    showLinkedLaunch('ROM/FONTを確認しています。',
      '初回は手元のROM/FONTを選択してください。保存済みなら自動で起動します。');
    void startLinkedGameFromAssets();
  } else if (autoLaunch) {
    showLinkedLaunch('この版は自動起動に未対応です。', instructions);
  } else {
    $('game-launch-instructions').textContent = instructions;
  }
  showTapeStatus();
}

function cancelPendingLinkedGame() {
  if (state.linkedLaunch && state.linkedLaunch.phase !== 'complete') {
    cancelLinkedLaunch('手動のカセット操作を優先しました。');
  }
  if (state.packImportPending) {
    state.packImportPending = false;
    state.packImportRevision++;
    $('launch-pack-cancel').hidden = true;
    $('launch-pack-status').textContent = '手動操作を優先し、パックの読込を中止しました。';
  }
  if (!state.gameLinkPending) return;
  state.gameLinkPending = false;
  state.gameLinkRevision++;
  $('game-launch-status').textContent = '手動のカセット操作を優先しました。';
  $('game-launch-instructions').textContent = '作品CJRの自動セットは中止しました。';
}

function showLinkedLaunch(status, instructions = '') {
  $('game-launch-status').textContent = status;
  $('game-launch-instructions').textContent = instructions;
}

function cancelLinkedLaunch(reason) {
  if (!state.linkedLaunch) return;
  state.linkedLaunch = null;
  if (state.autoType?.origin === 'linked-launch') stopAutomaticInput(reason);
  $('game-launch-cancel').hidden = true;
  showLinkedLaunch(reason, '手動のMLOADと作品の実行コマンドは引き続き利用できます。');
}

function failLinkedLaunch(reason) {
  cancelLinkedLaunch(`自動起動を中止しました: ${reason}`);
}

async function startLinkedGameFromAssets() {
  const launch = state.linkedLaunch;
  if (!launch || launch.phase !== 'assets' || launch.starting || !assetsReady()) return;
  const assetRevision = state.assetSelectionRevision;
  let supported;
  try {
    supported = await supportsAutomaticBasic(selectedRom());
  } catch {
    supported = false;
  }
  if (state.linkedLaunch !== launch || launch.phase !== 'assets' || launch.starting
      || state.assetSelectionRevision !== assetRevision) return;
  if (!supported) {
    failLinkedLaunch('このROM版のBASIC入力待ちは未検証です。');
    return;
  }
  launch.starting = true;
  await startMachine({automatic: true});
}

$('game-launch-cancel').addEventListener('click', () => {
  cancelLinkedLaunch('利用者が自動起動を中止しました。');
});

function applyScreenPreferences() {
  document.body.dataset.screenScale = preferences.screenScale;
  if (preferences.screenScale !== 'auto') {
    document.documentElement.style.setProperty('--screen-scale', preferences.screenScale);
  }
  document.body.dataset.screenSmoothing = String(preferences.screenSmoothing);
  document.body.dataset.screenRotation = String(preferences.screenRotation);
  document.body.dataset.screenAspect = preferences.screenAspect;

  const rotated = preferences.screenRotation === 90 || preferences.screenRotation === 270;
  const pixelWidth = rotated ? FRAME_HEIGHT : FRAME_WIDTH;
  const pixelHeight = rotated ? FRAME_WIDTH : FRAME_HEIGHT;
  const videoRatio = preferences.screenAspect === 'video' ? 0.85 : 1;
  const displayWidth = rotated ? FRAME_HEIGHT : FRAME_WIDTH * videoRatio;
  const displayHeight = rotated ? FRAME_WIDTH * videoRatio : FRAME_HEIGHT;
  document.documentElement.style.setProperty('--screen-display-width', `${displayWidth}px`);
  document.documentElement.style.setProperty('--screen-display-height', `${displayHeight}px`);
  updateAutoScreenScale();
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    image = context.createImageData(pixelWidth, pixelHeight);
  }
  updateFullscreenSize();
  if (state.booted && codec) paintMachine();
  else paintBlank();
}

function updateAutoScreenScale() {
  if (preferences.screenScale !== 'auto' || document.fullscreenElement === $('screen-shell')) return;
  const area = document.querySelector('.display-area');
  if (area.clientWidth <= 0 || area.clientHeight <= 0) return;
  const shellStyle = getComputedStyle($('screen-shell'));
  const inset = side => (parseFloat(shellStyle.getPropertyValue(`padding-${side}`)) || 0) +
    (parseFloat(shellStyle.getPropertyValue(`border-${side}-width`)) || 0);
  const width = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--screen-display-width')) || FRAME_WIDTH;
  const height = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--screen-display-height')) || FRAME_HEIGHT;
  const availableWidth = Math.max(1, area.clientWidth - inset('left') - inset('right') - 2);
  const availableHeight = Math.max(1, area.clientHeight - inset('top') - inset('bottom') - 2);
  const scale = Math.min(availableWidth / width, availableHeight / height);
  document.documentElement.style.setProperty('--screen-scale', String(scale));
}

function updateFullscreenSize() {
  const shell = $('screen-shell');
  if (document.fullscreenElement !== shell) return;
  const displayWidth = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--screen-display-width')) || FRAME_WIDTH;
  const displayHeight = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--screen-display-height')) || FRAME_HEIGHT;
  const availableWidth = Math.max(1, window.innerWidth - 40);
  const availableHeight = Math.max(1, window.innerHeight - 40);
  const scale = Math.min(availableWidth / displayWidth, availableHeight / displayHeight);
  shell.style.setProperty('--fullscreen-screen-width', `${displayWidth * scale}px`);
  shell.style.setProperty('--fullscreen-screen-height', `${displayHeight * scale}px`);
}

async function toggleFullscreen() {
  try {
    const shell = $('screen-shell');
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
    } else {
      await shell.requestFullscreen();
    }
  } catch (error) {
    setNotice('error', `全画面表示を切り替えられません: ${error.message}`);
  }
}

$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const fullscreen = document.fullscreenElement === $('screen-shell');
  $('fullscreen').textContent = fullscreen ? '全画面を終了' : '全画面';
  if (fullscreen) updateFullscreenSize();
  else {
    $('screen-shell').style.removeProperty('--fullscreen-screen-width');
    $('screen-shell').style.removeProperty('--fullscreen-screen-height');
    updateAutoScreenScale();
  }
  canvas.focus();
});
window.addEventListener('resize', () => {
  updateFullscreenSize();
  updateAutoScreenScale();
});

function paintBlank() {
  context.fillStyle = '#050806';
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function paintMachine() {
  const pixels = codec.machine.render();
  const rgba = image.data;
  const rotation = preferences.screenRotation;
  for (let sourceY = 0; sourceY < FRAME_HEIGHT; ++sourceY) {
    for (let sourceX = 0; sourceX < FRAME_WIDTH; ++sourceX) {
      let targetX = sourceX;
      let targetY = sourceY;
      if (rotation === 90) {
        targetX = FRAME_HEIGHT - 1 - sourceY;
        targetY = sourceX;
      } else if (rotation === 180) {
        targetX = FRAME_WIDTH - 1 - sourceX;
        targetY = FRAME_HEIGHT - 1 - sourceY;
      } else if (rotation === 270) {
        targetX = sourceY;
        targetY = FRAME_WIDTH - 1 - sourceX;
      }
      const color = pixels[sourceY * FRAME_WIDTH + sourceX];
      const offset = (targetY * canvas.width + targetX) * 4;
      rgba[offset] = (color >>> 16) & 0xff;
      rgba[offset + 1] = (color >>> 8) & 0xff;
      rgba[offset + 2] = color & 0xff;
      rgba[offset + 3] = 0xff;
    }
  }
  context.putImageData(image, 0, 0);
}

function runFrame(timestamp) {
  if (!headerlessExplicitlyAllowed && $('headerless').checked) {
    revokeHeaderlessPermission();
  }
  gamepadController?.update();
  if (state.booted && !state.paused) {
    // A delayed tab must not send another command byte before checking timeout.
    advanceLinkedLaunch(timestamp);
    if (state.lastFrame === 0) state.lastFrame = timestamp;
    const seconds = Math.min(Math.max((timestamp - state.lastFrame) / 1000, 0), 0.05);
    state.lastFrame = timestamp;
    const cpuPercent = effectiveCpuPercent();
    const effectiveHz = CPU_HZ * cpuPercent / 100;
    state.cycleBalance = Math.min(state.cycleBalance + seconds * effectiveHz, effectiveHz * 0.1);
    if (state.cycleBalance >= 1) {
      const autoTypeFinished = pumpAutomaticInput(timestamp);
      const cycleBudget = Math.floor(state.cycleBalance);
      let executedCycles = 0;
      let debug = codec.machine.debugger.state();
      while (executedCycles < cycleBudget && debug.stopReason === 0) {
        const slice = Math.min(cycleBudget - executedCycles, AUDIO_RUN_SLICE_CYCLES);
        const executed = codec.machine.run(slice);
        executedCycles += executed;
        debug = codec.machine.debugger.state();
        if (debug.stopReason === 0) audioOutput?.pump(cpuPercent / 100);
        if (executed <= 0) break;
      }
      state.cycleBalance -= executedCycles;
      if (debug.stopReason !== 0) {
        state.cycleBalance = 0;
        setPaused(true, describeDebugStop(debug));
      }
      if (state.autoType && autoTypeFinished) {
        finishAutomaticInput('入力が完了しました。');
      }
    }
    paintMachine();
    advanceLinkedLaunch(timestamp);
    if (state.fpsWindowStart === 0) state.fpsWindowStart = timestamp;
    ++state.fpsFrames;
    const fpsElapsed = timestamp - state.fpsWindowStart;
    if (fpsElapsed >= 500) {
      state.measuredFps = state.fpsFrames * 1000 / fpsElapsed;
      state.fpsWindowStart = timestamp;
      state.fpsFrames = 0;
    }
    if (timestamp - state.lastStatus >= 500) {
      showMachineStatus();
      showAudioStatus();
      showTapeStatus();
      refreshVirtualKeyboard();
      state.lastStatus = timestamp;
    }
  } else {
    state.lastFrame = 0;
    state.fpsWindowStart = 0;
    state.fpsFrames = 0;
  }
  requestAnimationFrame(runFrame);
}

function effectiveCpuPercent() {
  if (state.autoType) return 1000;
  if (state.linkedLaunch?.phase === 'loading') return 1000;
  if (preferences.tapeTurbo && codec && state.booted) {
    const tape = codec.machine.tape.state();
    if (tape.mode === 1 && tape.remote) return 1000;
  }
  return preferences.cpuSpeed;
}

function pumpAutomaticInput(timestamp) {
  const automatic = state.autoType;
  if (!automatic) return false;
  if (automatic.activeCode !== null) {
    // Keep the key asserted across at least one emulation slice so the
    // MN1544 scan path can observe it, then release before the next code.
    codec.machine.setKey(automatic.activeCode, false);
    automatic.activeCode = null;
    if (automatic.index >= automatic.codes.length) return true;
  }
  if (automatic.lastSent !== null &&
      timestamp - automatic.lastSent < automatic.intervalMs) return false;
  const code = automatic.codes[automatic.index++];
  codec.machine.setKey(code, true);
  automatic.activeCode = code;
  automatic.lastSent = timestamp;
  showAutomaticInputStatus();
  return false;
}

function startAutomaticInput(codes, {label, origin, intervalMs = 30} = {}) {
  if (!state.booted || state.paused) throw new Error('JR-200を起動して実行状態にしてください');
  if (!(codes instanceof Uint8Array) || codes.length === 0) {
    throw new Error('入力する文字がありません');
  }
  if (origin !== 'linked-launch' && state.linkedLaunch
      && state.linkedLaunch.phase !== 'complete') {
    cancelLinkedLaunch('手動入力を優先しました。');
  }
  if (origin !== 'linked-launch' && (state.gameLinkPending || state.packImportPending)) {
    cancelPendingLinkedGame();
  }
  stopAutomaticInput();
  releaseKeys({preserveRomaji: origin === 'romaji'});
  state.autoType = {
    codes,
    index: 0,
    intervalMs,
    lastSent: null,
    activeCode: null,
    label: label || '自動入力',
    origin: origin || 'quick-type',
  };
  state.cycleBalance = 0;
  showAutomaticInputStatus();
  refreshVirtualKeyboard();
}

function finishAutomaticInput(message) {
  const origin = state.autoType?.origin;
  if (state.autoType?.activeCode !== null) {
    codec.machine.setKey(state.autoType.activeCode, false);
  }
  state.autoType = null;
  gamepadController?.resync();
  showAutomaticInputStatus(message, origin);
  refreshVirtualKeyboard();
  if (origin === 'linked-launch' && state.linkedLaunch) {
    const launch = state.linkedLaunch;
    if (launch.phase === 'typing-mload') {
      launch.phase = 'loading';
      launch.deadline = performance.now() + 120000;
      showLinkedLaunch('通常のMLOADで読み込んでいます。');
    } else if (launch.phase === 'typing-usr') {
      launch.phase = 'title';
      launch.deadline = performance.now() + 15000;
      showLinkedLaunch('作品の起動を確認しています。');
    }
  }
}

function stopAutomaticInput(message = '') {
  if (!state.autoType) return false;
  const origin = state.autoType.origin;
  if (state.autoType.activeCode !== null) {
    codec.machine.setKey(state.autoType.activeCode, false);
  }
  state.autoType = null;
  gamepadController?.resync();
  showAutomaticInputStatus(message || '入力を停止しました。', origin);
  refreshVirtualKeyboard();
  if (origin === 'linked-launch' && state.linkedLaunch) {
    cancelLinkedLaunch('自動入力を中止したため、作品の起動支援を停止しました。');
  }
  return true;
}

function advanceLinkedLaunch(timestamp) {
  const launch = state.linkedLaunch;
  if (!launch || launch.phase === 'assets' || launch.phase === 'complete') return;
  if (!state.booted || state.paused || state.tapeSelectionRevision !== launch.mountedRevision) {
    failLinkedLaunch('実行状態またはカセットの選択が変わりました。');
    return;
  }
  if (timestamp > launch.deadline) {
    failLinkedLaunch('この段階の制限時間を超えました。');
    return;
  }
  const tape = codec.machine.tape.state();
  if (tape.error || tape.mode !== 1) {
    failLinkedLaunch('カセットが読み込み可能な状態ではありません。');
    return;
  }
  if (launch.phase === 'typing-mload' || launch.phase === 'loading') {
    launch.sawRead ||= tape.readStarted || tape.samplePosition > 0 || tape.state === 2;
  }
  if (launch.phase === 'basic') {
    if (!basicInputReady(codec.machine)) return;
    if (tape.state !== 1 || tape.remote || tape.samplePosition !== 0) {
      failLinkedLaunch('カセットが先頭の待機状態ではありません。');
      return;
    }
    launch.promptRows = readyPromptRows(address => codec.machine.peek(address));
    launch.phase = 'typing-mload';
    launch.deadline = timestamp + 10000;
    startAutomaticInput(encodeJrText('MLOAD\r'),
      {label: 'MLOAD入力', origin: 'linked-launch', intervalMs: 30});
    showLinkedLaunch('JR BASICへMLOADを入力しています。');
  } else if (launch.phase === 'loading') {
    if (!launch.sawRead || tape.state !== 6 || tape.remote
        || tape.samplePosition !== tape.totalSamples) return;
    if (!launchImageMatches(launch.image.loadBlocks,
      address => codec.machine.peek(address))) {
      failLinkedLaunch('CJRのロード結果が一致しません。');
      return;
    }
    if (!basicInputReady(codec.machine)) return;
    const rows = readyPromptRows(address => codec.machine.peek(address));
    if (!rows.some(row => !launch.promptRows.includes(row))) return;
    if (titleMarkerVisible(address => codec.machine.peek(address),
      launch.game.entry.titleMarker)) {
      failLinkedLaunch('実行前からタイトル表示が存在します。');
      return;
    }
    launch.phase = 'typing-usr';
    launch.deadline = timestamp + 15000;
    startAutomaticInput(encodeJrText(`${launch.game.entry.runCommand}\r`),
      {label: '作品起動入力', origin: 'linked-launch', intervalMs: 30});
    showLinkedLaunch('MLOAD完了を確認しました。作品の実行コマンドを入力しています。');
  } else if (launch.phase === 'title') {
    const pc = codec.machine.registers().pc;
    const inGame = launch.image.loadBlocks.some(block =>
      block.address <= pc && pc < block.address + block.bytes.length);
    if (!inGame || !titleMarkerVisible(address => codec.machine.peek(address),
      launch.game.entry.titleMarker)) return;
    launch.phase = 'complete';
    $('game-launch-cancel').hidden = true;
    showLinkedLaunch(`${launch.game.entry.title} を起動しました。`,
      '通常のMLOADと作品固有のUSRを通りました。音が出ない場合は音声を有効化してください。');
  }
}

function showAutomaticInputStatus(message = '', origin = state.autoType?.origin) {
  const automatic = state.autoType;
  const activeText = automatic
    ? `${automatic.label}: ${automatic.index} / ${automatic.codes.length} バイト`
    : message || '待機中です。';
  if (origin !== 'romaji') {
    $('quick-type-status').textContent = activeText;
  }
  $('quick-type-stop').disabled = !automatic;
  $('quick-type-start').disabled = !state.booted || state.paused || Boolean(automatic);
  $('macro-run').disabled = !state.booted || state.paused ||
    Boolean(automatic) ||
    preferences.macros[Number($('macro-slot').value)] === '';
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
  if (Object.values(state.assetReadPending).some(Boolean)) return false;
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
        lines.push(`結合ROM: 16384バイト / RESET $${hex4(validateCombinedRom(state.rom))} / ${assetDisplayName('rom')}`);
      } catch (error) {
        lines.push(`結合ROM: エラー — ${error.message}`);
      }
    } else {
      lines.push('結合ROM: 未選択');
    }
  } else {
    lines.push(`ROM1 ($A000): ${state.rom1 ? `8192バイト / ${assetDisplayName('rom1')}` : '未選択'}`);
    lines.push(`ROM2 ($E000): ${state.rom2 ? `8192バイト / ${assetDisplayName('rom2')}` : '未選択'}`);
    if (state.rom1 && state.rom2) {
      try {
        lines.push(`ROM順序: 検証済み / RESET $${hex4(validateCombinedRom(selectedRom()))}`);
      } catch (error) {
        lines.push(`ROM順序: エラー — ${error.message}`);
      }
    }
  }
  lines.push(`フォント: ${state.font ? `2048バイト / ${assetDisplayName('font')}` : '未選択'}`);
  if (message) lines.push(message);
  $('asset-status').replaceChildren(...lines.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  $('start').disabled = !codec || !assetsReady();
}

function assetDisplayName(key) {
  const name = state.names[key] || '保存データ';
  return state.origins[key] === 'indexeddb' ? `${name}（保存済み）` : name;
}

function hex4(value) {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

async function loadInput(id, key, size, label) {
  state.assetSelectionRevision++;
  const readRevision = (state.assetReadRevisions[key] ?? 0) + 1;
  state.assetReadRevisions[key] = readRevision;
  state.assetReadPending[key] = true;
  updateAssetStatus();
  try {
    const file = $(id).files[0];
    const bytes = await readExact(file, size, label);
    if (state.assetReadRevisions[key] !== readRevision) return;
    state.assetReadPending[key] = false;
    state.assetSelectionRevision++;
    state[key] = bytes;
    state.names[key] = file.name;
    state.origins[key] = 'file';
    updateAssetStatus();
  } catch (error) {
    if (state.assetReadRevisions[key] !== readRevision) return;
    state.assetReadPending[key] = false;
    state.assetSelectionRevision++;
    state[key] = null;
    state.names[key] = '';
    state.origins[key] = '';
    updateAssetStatus(`エラー: ${error.message}`);
  }
  await persistAssetsIfAllowed();
  void startLinkedGameFromAssets();
}

$('rom-combined').addEventListener('change', () => loadInput('rom-combined', 'rom', 16384, '結合ROM'));
$('rom1').addEventListener('change', () => loadInput('rom1', 'rom1', 8192, 'ROM1'));
$('rom2').addEventListener('change', () => loadInput('rom2', 'rom2', 8192, 'ROM2'));
$('font').addEventListener('change', () => loadInput('font', 'font', 2048, 'フォント'));

for (const input of document.querySelectorAll('input[name="rom-mode"]')) {
  input.addEventListener('change', async () => {
    state.assetSelectionRevision++;
    state.romMode = input.value;
    $('combined-fields').hidden = state.romMode !== 'combined';
    $('split-fields').hidden = state.romMode !== 'split';
    updateAssetStatus();
    await persistAssetsIfAllowed();
    void startLinkedGameFromAssets();
  });
}

async function startMachine({automatic = false} = {}) {
  try {
    if (!automatic && (state.gameLinkPending || state.packImportPending)) {
      cancelPendingLinkedGame();
    }
    if (!automatic && state.linkedLaunch && state.linkedLaunch.phase !== 'assets') {
      cancelLinkedLaunch('ROMを手動で再起動しました。');
    }
    const launchAtBoot = state.linkedLaunch;
    stopAutomaticInput();
    inputController.reset();
    const rom = selectedRom();
    const resetVector = validateCombinedRom(rom);
    applyMemoryConfiguration();
    codec.machine.boot(rom, state.font);
    codec.machine.debugger.setHistoryEnabled(preferences.debugHistoryEnabled);
    gamepadController?.resync();
    state.booted = true;
    state.paused = false;
    state.cycleBalance = 0;
    state.lastFrame = 0;
    state.measuredFps = 0;
    resumeAudioForRun();
    $('pause').disabled = false;
    $('reset').disabled = false;
    setDebuggerEnabled(true);
    $('pause').textContent = '一時停止';
    setNotice('running', `選択したROMとフォントでCPUを起動しました。RESET vector $${hex4(resetVector)}。画面をクリックして入力してください。`);
    await persistAssetsIfAllowed('ROMとフォントをIndexedDBへ保存しました。次回は自動復元します');
    paintMachine();
      showMachineStatus();
      showAudioStatus();
      showTapeStatus();
    refreshVirtualKeyboard(true);
    refreshDebugger();
    showAutomaticInputStatus('入力できます。');
    updateMacroEditor();
    canvas.focus();
    if (state.linkedLaunch === launchAtBoot && launchAtBoot?.phase === 'assets') {
      launchAtBoot.phase = 'basic';
      launchAtBoot.deadline = performance.now() + 15000;
      showLinkedLaunch('BASICの入力待ちを確認しています。');
    }
    return true;
  } catch (error) {
    setNotice('error', `起動できません: ${error.message}`);
    if (state.linkedLaunch) failLinkedLaunch(error.message);
    return false;
  }
}

$('start').addEventListener('click', () => {
  if (state.linkedLaunch?.phase === 'assets') void startLinkedGameFromAssets();
  else void startMachine();
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
    cancelPendingLinkedGame();
    if (state.linkedLaunch) cancelLinkedLaunch('ROMをリセットしたため自動起動を中止しました。');
    stopAutomaticInput();
    inputController.reset();
    applyMemoryConfiguration();
    codec.machine.reset();
    gamepadController?.resync();
    audioOutput?.flush();
    state.paused = false;
    state.cycleBalance = 0;
    state.lastFrame = 0;
    state.measuredFps = 0;
    resumeAudioForRun();
    $('pause').textContent = '一時停止';
    setNotice('running', 'ROMとフォントを保持してリセットしました。');
    paintMachine();
    showMachineStatus();
    showTapeStatus();
    refreshVirtualKeyboard(true);
    refreshDebugger();
    showAutomaticInputStatus('入力できます。');
    canvas.focus();
  } catch (error) {
    setNotice('error', `リセットできません: ${error.message}`);
  }
});

function setPaused(paused, reason) {
  if (paused && (state.gameLinkPending || state.packImportPending)) cancelPendingLinkedGame();
  if (paused && state.linkedLaunch && state.linkedLaunch.phase !== 'complete') {
    cancelLinkedLaunch('一時停止したため自動起動を中止しました。');
  }
  if (paused) stopAutomaticInput('一時停止したため自動入力を終了しました。');
  state.paused = paused;
  state.lastFrame = 0;
  if (paused) {
    releaseForcedJoystick();
    audioOutput?.suspend().catch(error => showAudioStatus(`音声停止エラー: ${error.message}`));
  } else {
    resumeAudioForRun();
    gamepadController?.resync();
  }
  $('pause').textContent = paused ? '再開' : '一時停止';
  setNotice(paused ? 'paused' : 'running', reason);
  showMachineStatus();
  refreshVirtualKeyboard();
  refreshDebugger();
}

function resumeAudioForRun() {
  if (!audioOutput) return;
  const audio = audioOutput.state();
  if (!audio.enabled) {
    codec.machine.audio.discard();
    showAudioStatus();
    return;
  }
  const operation = audio.contextState === 'not-created'
    ? audioOutput.enable()
    : audioOutput.resume();
  operation.catch(error => showAudioStatus(`音声開始エラー: ${error.message}`));
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
  const automatic = state.autoType ? ` / ${state.autoType.label}` : '';
  const fps = state.measuredFps > 0 ? state.measuredFps.toFixed(1) : '計測中';
  $('machine-status').textContent = `${mode}${automatic} / FPS ${fps} / CPU ${effectiveCpuPercent()}% / PC $${hex4(registers.pc)} / cycles ${machine.cycles} / font ${machine.fontInitialized ? '初期化済み' : '転送中'}`;
}

function selectedMemoryConfiguration() {
  return {
    ramExpansion1: preferences.ramExpansion1,
    ramExpansion2: preferences.ramExpansion2,
    ramInitPattern: preferences.ramInitPattern,
  };
}

function applyMemoryConfiguration() {
  state.appliedMemoryConfig = codec.machine.configureMemory(selectedMemoryConfiguration());
  showMemoryConfigurationStatus();
}

function showMemoryConfigurationStatus(pending = false) {
  const selected = selectedMemoryConfiguration();
  const parts = [
    `拡張1 ${selected.ramExpansion1 ? 'ON' : 'OFF'}`,
    `拡張2 ${selected.ramExpansion2 ? 'ON' : 'OFF'}`,
    `パターン${selected.ramInitPattern}`,
  ];
  $('memory-config-status').textContent = pending && state.booted
    ? `${parts.join(' / ')}。次の起動またはリセットで反映します。`
    : `${parts.join(' / ')}${state.appliedMemoryConfig ? ' を反映済みです。' : '。起動時に反映します。'}`;
}

function showAudioStatus(message = '') {
  if (!audioOutput) {
    $('audio-status').textContent = 'WASMの準備を待っています。';
    return;
  }
  const audio = audioOutput.state();
  const context = audio.contextState === 'not-created'
    ? audio.enabled ? '未作成（起動操作待ち）' : '未作成'
    : audio.contextState;
  const lines = [
    `Web Audio: ${audio.enabled ? '有効' : '無効'} / context ${context}`,
    `sample rate: core ${audio.coreSampleRate} Hz / output ${audio.deviceSampleRate || '未確定'} Hz`,
    `PCM queue: ${audio.queueAvailable} / ${audio.queueCapacity} / core overflow ${audio.coreDropped}`,
    `音量: ${Math.round(audio.volume * 100)}% / ミュート ${audio.muted ? 'ON' : 'OFF'}`,
    `キークリック: ${audio.keyClickEnabled ? 'ON' : 'OFF'}`,
    `予約済み: ${audio.scheduledFrames} frames / 非0 ${audio.nonzeroFrames} / peak ${audio.peakSample}`,
    `active ${audio.activeSources} / underrun ${audio.underruns} / 破棄 ${audio.discardedFrames}`,
    `再生倍率: ${audio.playbackRate.toFixed(2)}x / 先行 ${Math.round(audio.scheduledAheadSeconds * 1000)} ms / 先行上限破棄 ${audio.aheadDroppedFrames}`,
  ];
  if (audio.lastError) lines.push(`エラー: ${audio.lastError}`);
  if (message) lines.push(message);
  lines.push('本体3音、設定有効時のキークリック、有効なロードモニターを出力します。カセットWAV生成とは別です。');
  $('audio-status').textContent = lines.join('\n');
  $('audio-enable').disabled = !audio.supported ||
    (audio.enabled && audio.contextState === 'running');
  $('audio-enable').textContent = !audio.enabled
    ? '音声を有効化'
    : audio.contextState === 'not-created'
      ? '音声を開始'
      : audio.contextState === 'running' ? '音声ON' : '音声を再開';
  $('audio-disable').disabled = !audio.enabled;
  $('audio-volume').disabled = false;
  $('audio-mute').disabled = false;
  $('audio-volume-value').textContent = `${Math.round(audio.volume * 100)}%`;
}

function showGamepadStatus(snapshot = gamepadController?.snapshot()) {
  if (!snapshot) {
    $('gamepad-status').textContent = 'WASMの準備を待っています。';
    return;
  }
  if (!snapshot.supported) {
    $('gamepad-status').textContent = 'このブラウザはGamepad APIに対応していません。';
    return;
  }
  const lines = snapshot.ports.map((port, player) => {
    if (!port) return `${player + 1}P: 未接続`;
    const directions = [
      [0x01, '↑'], [0x02, '↓'], [0x04, '←'], [0x08, '→'],
      [0x10, 'A'], [0x20, 'B'],
    ].filter(([mask]) => (port.state & mask) === 0).map(([, label]) => label);
    const id = port.id.replace(/\s+/g, ' ').trim().slice(0, 80);
    const mapping = port.mapping === 'standard' ? '標準マッピング' : '汎用マッピング';
    return `${player + 1}P: ${id} / ${mapping} / ${directions.join(' ') || 'ニュートラル'}`;
  });
  if (snapshot.suspended) lines.push('フォーカス外のため入力をニュートラルにしました。');
  if (preferences.forcedJoystick) {
    lines.push('1P: 強制ジョイスティックモード（JRキー入力）');
  }
  if (snapshot.error) lines.push(`取得エラー: ${snapshot.error}`);
  $('gamepad-status').textContent = lines.join('\n');
}

function releaseForcedJoystick() {
  inputController?.release(forcedJoystickSource, {immediate: true});
  forcedJoystickCode = null;
}

function updateForcedJoystick(activeLowState) {
  const code = forcedKeyCodeForJoystick(
    activeLowState,
    preferences.forcedJoystickA,
    preferences.forcedJoystickB,
  );
  if (code === forcedJoystickCode) return;
  releaseForcedJoystick();
  if (code === null || !state.booted || state.paused || state.autoType) return;
  if (inputController?.pressCode(code, forcedJoystickSource, {keyId: `Forced${code}`})) {
    forcedJoystickCode = code;
  }
}

function setGamepadState(player, activeLowState) {
  if (!codec) return;
  if (player === 0 && preferences.forcedJoystick) {
    codec.machine.setJoystick(0, 0xff);
    updateForcedJoystick(activeLowState);
    return;
  }
  if (player === 0) releaseForcedJoystick();
  codec.machine.setJoystick(player, activeLowState);
}

$('audio-enable').addEventListener('click', async () => {
  const revision = ++audioSettingRevision;
  try {
    await audioOutput.enable();
    if (revision !== audioSettingRevision) return;
    preferences.audioEnabled = audioOutput.state().enabled;
    savePreferences();
    showAudioStatus(preferences.audioEnabled
      ? '利用者操作で音声デバイスを有効化しました。'
      : '音声デバイスは停止中です。');
    showTapeStatus();
  } catch (error) {
    if (revision === audioSettingRevision) {
      showAudioStatus(`音声を有効化できません: ${error.message}`);
    }
  }
});

$('audio-disable').addEventListener('click', async () => {
  const revision = ++audioSettingRevision;
  try {
    await audioOutput.disable();
    if (revision !== audioSettingRevision) return;
    preferences.audioEnabled = audioOutput.state().enabled;
    savePreferences();
    showAudioStatus(preferences.audioEnabled
      ? '音声デバイスは有効です。'
      : '予約済み音声とPCM queueを破棄して停止しました。');
    showTapeStatus();
  } catch (error) {
    if (revision === audioSettingRevision) {
      showAudioStatus(`音声を停止できません: ${error.message}`);
    }
  }
});

$('audio-volume').addEventListener('input', event => {
  try {
    audioOutput.setVolume(Number(event.target.value) / 100);
    preferences.audioVolume = Number(event.target.value);
    savePreferences();
    showAudioStatus();
  } catch (error) {
    showAudioStatus(`音量を変更できません: ${error.message}`);
  }
});

$('audio-mute').addEventListener('change', event => {
  try {
    audioOutput.setMuted(event.target.checked);
    preferences.audioMuted = event.target.checked;
    savePreferences();
    showAudioStatus(event.target.checked
      ? 'ミュート時の予約済み音声とPCM queueを破棄しました。'
      : 'ミュートを解除しました。');
  } catch (error) {
    showAudioStatus(`ミュートを変更できません: ${error.message}`);
  }
});

$('key-click-enabled').addEventListener('change', event => {
  preferences.keyClickEnabled = event.target.checked;
  savePreferences();
  audioOutput.setKeyClickEnabled(preferences.keyClickEnabled);
  showAudioStatus();
});

function updateTapeMountState(tape) {
  const selected = state.tapeSelectedName;
  const mounted = tape.mode === 1 ? state.tapeName : '';
  const selectedIsMounted = Boolean(
    selected && mounted &&
    state.tapeSelectionRevision === state.tapeMountedSelectionRevision,
  );
  const indicator = $('tape-mount-state');
  let visualState = 'none';
  let text = '選択中: なし / 現在のマウント: なし';
  if (selectedIsMounted) {
    visualState = 'mounted';
    text = `選択中: ${selected} / マウント済み`;
  } else if (selected) {
    visualState = 'pending';
    text = `選択中: ${selected}（未マウント） / 現在のマウント: ${mounted || 'なし'}`;
  } else if (mounted) {
    visualState = 'mounted';
    text = `選択中: なし / 現在のマウント: ${mounted}（マウント済み）`;
  }
  indicator.dataset.state = visualState;
  indicator.textContent = text;
  $('tape-mount').classList.toggle('is-pending', visualState === 'pending');
  $('tape-mount').disabled = !codec || !selected;
  $('tape-quick-load').disabled = !codec || !state.booted || !selected;
}

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
  if (tape.monitorEnabled) {
    const webAudioEnabled = audioOutput?.state().enabled;
    const activity = tape.monitorActive
      ? (webAudioEnabled ? '出力中' : '信号あり・Web Audio OFF')
      : (webAudioEnabled ? '待機中' : '待機中・本体音声が停止中');
    lines.push(`ロードモニター: ON / ${tape.monitorVolume}% / ${activity}`);
  } else {
    lines.push(`ロードモニター: OFF / ${tape.monitorVolume}%`);
  }
  if (tape.error) lines.push(`エラー: ${tape.errorMessage} (code ${tape.error}, detail ${tape.errorDetail})`);
  if (state.tapeSelectionStatus) lines.push(`選択検査: ${state.tapeSelectionStatus}`);
  if (message) lines.push(message);
  $('tape-status').textContent = lines.join('\n');
  updateTapeMountState(tape);
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
  preferences.debugHistoryEnabled = event.target.checked;
  savePreferences();
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

$('debug-memory-save').addEventListener('click', () => debugAction(() => {
  const bytes = codec.machine.dump();
  downloadBytes(bytes, 'dump.bin');
  $('debug-memory').textContent = `0000–FFFFの${bytes.length}バイトをdump.binへ保存しました。`;
}));

function createVirtualKey(key, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `virtual-key key-${key.tone}${className ? ` ${className}` : ''}`;
  button.dataset.keyId = key.id;
  button.dataset.baseLabel = key.name;
  button.style.setProperty('--key-width', String(key.width));
  button.setAttribute('aria-label', key.name);
  button.setAttribute('aria-pressed', 'false');
  button.disabled = true;
  if (key.text !== null) {
    const label = document.createElement('span');
    label.className = 'key-text';
    label.textContent = key.text;
    button.append(label);
  } else {
    const glyph = document.createElement('canvas');
    glyph.className = 'key-glyph';
    glyph.width = 8;
    glyph.height = 8;
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    const functionLabel = document.createElement('span');
    functionLabel.className = 'key-function';
    functionLabel.setAttribute('aria-hidden', 'true');
    button.append(functionLabel);
  }
  const entries = virtualKeys.get(key.id) ?? [];
  entries.push(button);
  virtualKeys.set(key.id, entries);
  button.addEventListener('pointerdown', event => {
    if (button.disabled || event.button !== 0 ||
        key.id === 'ModifierShift' || key.id === 'ModifierControl') return;
    const source = `pointer:${event.pointerId}:${++virtualSourceSequence}`;
    const resolved = pressInput(key.id, source, {minimumHold: true});
    if (!resolved) return;
    pointerSources.set(event.pointerId, source);
    try { button.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => releasePointer(event.pointerId));
  }
  button.addEventListener('click', event => {
    if (button.disabled) return;
    if (key.id === 'ModifierShift') {
      inputController.toggleLatch('shift');
      return;
    }
    if (key.id === 'ModifierControl') {
      inputController.toggleLatch('ctrl');
      return;
    }
    if (event.detail === 0) {
      const source = `accessible:${++virtualSourceSequence}`;
      if (pressInput(key.id, source, {minimumHold: true})) {
        inputController.release(source);
      }
    }
  });
  return button;
}

function keycapFunctionText(legend) {
  if (legend === null || legend.length <= 4) return legend ?? '';
  const split = Math.ceil(legend.length / 2);
  return `${legend.slice(0, split)}\n${legend.slice(split)}`;
}

function buildVirtualKeyboard() {
  const main = document.createElement('div');
  main.className = 'keyboard-main';
  for (const keys of KEY_ROWS) {
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    for (const key of keys) {
      if (key.kind === 'spacer') {
        const spacer = document.createElement('span');
        spacer.className = 'keyboard-spacer';
        spacer.style.setProperty('--key-width', String(key.width));
        spacer.setAttribute('aria-hidden', 'true');
        row.append(spacer);
        continue;
      }
      row.append(createVirtualKey(key));
    }
    main.append(row);
  }

  const controls = document.createElement('div');
  controls.id = 'keyboard-control-cluster';
  controls.className = 'keyboard-control-cluster';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '編集・カーソルキー');
  for (const key of CONTROL_KEYS) {
    const button = createVirtualKey(key, 'cluster-key');
    button.style.gridArea = key.area;
    controls.append(button);
  }
  virtualKeyboard.replaceChildren(main, controls);
}

function releasePointer(pointerId) {
  const source = pointerSources.get(pointerId);
  if (!source) return;
  pointerSources.delete(pointerId);
  inputController?.release(source);
}

function keyboardGlyphState() {
  if (!codec) return {bank: null, ready: false, generation: 0, standardReady: false};
  const standard = codec.machine.glyph(0, 'standard');
  if (standard.ready) {
    return {bank: 'standard', ready: true, generation: standard.generation, standardReady: true};
  }
  const font = codec.machine.glyph(0, 'font');
  return {bank: font.ready ? 'font' : null, ready: font.ready, generation: font.generation, standardReady: false};
}

function isKeyboardReady() {
  return Boolean(codec && state.booted && !state.paused && !state.autoType &&
    codec.machine.glyph(0, 'standard').ready);
}

function ctrlBasicMode() {
  return Boolean(codec && state.booted && (codec.machine.peek(0xc803) & 0x80) === 0);
}

function pressInput(keyId, source, {minimumHold = false} = {}) {
  const resolved = inputController?.press(keyId, source, {
    minimumHold,
    ctrlBasicMode: ctrlBasicMode(),
  });
  if (resolved && resolved.kind !== 'modifier' && state.linkedLaunch
      && state.linkedLaunch.phase !== 'complete') {
    cancelLinkedLaunch('手動キー入力を優先しました。');
  }
  if (resolved && resolved.kind !== 'modifier'
      && (state.gameLinkPending || state.packImportPending)) {
    cancelPendingLinkedGame();
  }
  if (resolved && resolved.kind !== 'modifier') inputController.clearLatch('ctrl');
  return resolved;
}

function refreshVirtualKeyboard(force = false) {
  const input = inputController?.snapshot() ?? {
    mode: INPUT_MODES.ANK,
    shift: false,
    ctrl: false,
    latchedShift: false,
    latchedCtrl: false,
    pressedKeyIds: new Set(),
  };
  const glyphState = keyboardGlyphState();
  const interactive = glyphState.standardReady && state.booted && !state.paused &&
    !state.autoType;
  const resolverState = {...input, ctrlBasicMode: ctrlBasicMode()};
  const modifiers = [
    input.latchedShift ? 'SHIFT保持' : '',
    input.latchedCtrl ? 'CTRL待機' : '',
  ].filter(Boolean);
  const romajiPending = preferences.romajiKana && input.mode === INPUT_MODES.KANA &&
      romajiConverter.pending
    ? ` / ローマ字 ${romajiConverter.pending}` : '';
  const automatic = state.autoType ? ` / ${state.autoType.label}中` : '';
  $('input-mode-status').textContent = `入力モード: ${MODE_NAMES[input.mode]}${modifiers.length ? ` / ${modifiers.join(' / ')}` : ''}${romajiPending}${automatic}`;
  $('glyph-status').textContent = !glyphState.ready
    ? 'FONT未読込 / キー操作不可'
    : glyphState.standardReady
      ? `標準文字RAM / generation ${glyphState.generation}${state.paused ? ' / 一時停止中' : ''}`
      : `FONT読込済み / 文字RAM転送待ち（字形プレビュー、キー操作不可）`;
  virtualKeyboard.setAttribute('aria-disabled', String(!interactive));

  const token = `${glyphState.bank}:${glyphState.generation}:${input.mode}:${input.shift}:${input.ctrl}:${resolverState.ctrlBasicMode}`;
  const redraw = force || token !== glyphCacheToken;
  if (redraw) {
    glyphCacheToken = token;
    glyphCache.clear();
  }
  for (const [keyId, buttons] of virtualKeys) {
    const resolved = resolveKey(keyId, resolverState);
    // JR-200取扱説明書を参照した。
    const legend = functionLegendFor(keyId, resolverState);
    const code = displayCodeFor(keyId, resolverState);
    let previewCode = displayCodeFor(keyId, input.ctrl
      ? {...resolverState, ctrl: false} : resolverState);
    if (input.ctrl && previewCode === null) {
      previewCode = displayCodeFor(keyId, {...resolverState, ctrl: false, shift: false}) ??
        displayCodeFor(keyId, {mode: INPUT_MODES.ANK, shift: false});
    }
    const pressed = input.pressedKeyIds.has(keyId);
    const isMode = (keyId === 'ModeAnk' && input.mode === INPUT_MODES.ANK) ||
      (keyId === 'ModeKana' && input.mode === INPUT_MODES.KANA) ||
      (keyId === 'ModeGraph' && input.mode === INPUT_MODES.GRAPH);
    const isModifier = keyId === 'ModifierShift' || keyId === 'ModifierControl';
    const modifierActive = keyId === 'ModifierShift' ? input.shift :
      keyId === 'ModifierControl' ? input.ctrl : false;
    const latched = keyId === 'ModifierShift' ? input.latchedShift :
      keyId === 'ModifierControl' ? input.latchedCtrl : false;
    for (const button of buttons) {
      const canvas = button.querySelector('.key-glyph');
      const available = Boolean(resolved) && (canvas ? code !== null || legend !== null : true);
      button.disabled = !interactive || !available;
      button.classList.toggle('is-pressed', pressed || modifierActive);
      button.classList.toggle('is-latched', latched || isMode);
      button.classList.toggle('is-function', legend !== null);
      button.setAttribute('aria-pressed', String(isModifier ? modifierActive : isMode || pressed));
      if (legend === null) button.setAttribute('aria-label', button.dataset.baseLabel);
      else button.setAttribute('aria-label', `${button.dataset.baseLabel} / ${legend}`);
      button.dataset.pressed = String(pressed || modifierActive);
      if (code === null) delete button.dataset.code;
      else button.dataset.code = code.toString(16).toUpperCase().padStart(2, '0');
      const functionLabel = button.querySelector('.key-function');
      if (functionLabel) functionLabel.textContent = keycapFunctionText(legend);
      if (canvas && redraw) {
        if (previewCode === null || !glyphState.ready) {
          drawGlyph(canvas, null);
        } else {
          let rows = glyphCache.get(previewCode);
          if (!rows) {
            rows = codec.machine.glyph(previewCode, glyphState.bank).rows;
            glyphCache.set(previewCode, rows);
          }
          drawGlyph(canvas, rows);
        }
      }
    }
  }
  virtualKeyboard.dataset.glyphCacheSize = String(glyphCache.size);
  virtualKeyboard.dataset.glyphCacheToken = token;
}

function drawGlyph(canvas, rows) {
  const glyphContext = canvas.getContext('2d', {alpha: true});
  glyphContext.clearRect(0, 0, 8, 8);
  if (!rows) return;
  glyphContext.fillStyle = '#ffffff';
  for (let row = 0; row < 8; ++row) {
    for (let column = 0; column < 8; ++column) {
      if ((rows[row] & (0x80 >> column)) !== 0) glyphContext.fillRect(column, row, 1, 1);
    }
  }
}

document.addEventListener('keydown', event => {
  const virtualKey = event.target.closest?.('.virtual-key');
  if (event.target !== canvas && !virtualKey) return;
  if (virtualKey && (event.code === 'Enter' || event.code === 'Space')) return;
  if (event.altKey && event.code === 'Enter' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    toggleFullscreen();
    return;
  }
  if (state.autoType && (event.code === 'Escape' || event.code === 'F11')) {
    event.preventDefault();
    stopAutomaticInput();
    return;
  }
  const keyId = keyIdForKeyboardEvent(event);
  if (keyId && (state.gameLinkPending || state.packImportPending || (state.linkedLaunch
      && state.linkedLaunch.phase !== 'complete'))) {
    cancelPendingLinkedGame();
  }
  const isControlInput = keyId === 'ModifierControl' ||
    (Boolean(keyId) && event.ctrlKey && !event.metaKey && !event.altKey);
  // macOS Japanese IME marks some CTRL shortcuts (notably CTRL+3) as
  // composing.  When the emulator owns focus, those chords belong to the
  // JR-200 keyboard; ordinary composition events must still stay with the IME.
  if (!isKeyboardReady() || (event.isComposing && !isControlInput)) return;
  const input = inputController.snapshot();
  if (preferences.romajiKana && input.mode === INPUT_MODES.KANA &&
      !event.metaKey && !event.altKey && !event.ctrlKey) {
    if (event.code === 'Backspace' && romajiConverter.backspace()) {
      event.preventDefault();
      refreshVirtualKeyboard();
      return;
    }
    const match = /^Key([A-Z])$/.exec(event.code);
    if (match) {
      event.preventDefault();
      if (event.repeat) return;
      try {
        const codes = romajiConverter.feed(match[1]);
        if (codes.length > 0) {
          startAutomaticInput(codes, {
            label: 'ローマ字カナ',
            origin: 'romaji',
            intervalMs: 10,
          });
        }
        refreshVirtualKeyboard();
      } catch (error) {
        $('quick-type-status').textContent = `ローマ字入力エラー: ${error.message}`;
      }
      return;
    }
  }
  if (!keyId || event.metaKey || event.altKey) return;
  const minimumHold = keyId !== 'ModifierShift' && keyId !== 'ModifierControl';
  const resolved = pressInput(
    keyId,
    `keyboard:${event.code}`,
    {minimumHold},
  );
  if (!resolved) return;
  // Prevent the host input method from handling owned modifier chords too.
  event.preventDefault();
}, {capture: true});

window.addEventListener('keyup', event => {
  inputController?.release(`keyboard:${event.code}`, {immediate: true});
});

function releaseKeys({preserveRomaji = false} = {}) {
  inputController?.releaseAll();
  if (!preserveRomaji) romajiConverter.reset();
  forcedJoystickCode = null;
  pointerSources.clear();
}

function loadPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || 'null');
    const integer = (candidate, minimum, maximum, fallback) =>
      Number.isInteger(candidate) && candidate >= minimum && candidate <= maximum
        ? candidate : fallback;
    const oneOf = (candidate, values, fallback) => values.includes(candidate) ? candidate : fallback;
    const macros = Array.isArray(value?.macros)
      ? Array.from({length: 10}, (_, index) =>
        typeof value.macros[index] === 'string' ? value.macros[index].slice(0, 256) : '')
      : [...DEFAULT_PREFERENCES.macros];
    return {
      pauseOnFocusLoss: typeof value?.pauseOnFocusLoss === 'boolean'
        ? value.pauseOnFocusLoss
        : DEFAULT_PREFERENCES.pauseOnFocusLoss,
      keyClickEnabled: typeof value?.keyClickEnabled === 'boolean'
        ? value.keyClickEnabled
        : DEFAULT_PREFERENCES.keyClickEnabled,
      audioEnabled: typeof value?.audioEnabled === 'boolean'
        ? value.audioEnabled : DEFAULT_PREFERENCES.audioEnabled,
      audioVolume: integer(value?.audioVolume, 0, 50, DEFAULT_PREFERENCES.audioVolume),
      audioMuted: typeof value?.audioMuted === 'boolean'
        ? value.audioMuted : DEFAULT_PREFERENCES.audioMuted,
      debugHistoryEnabled: typeof value?.debugHistoryEnabled === 'boolean'
        ? value.debugHistoryEnabled : DEFAULT_PREFERENCES.debugHistoryEnabled,
      tapeMonitorEnabled: typeof value?.tapeMonitorEnabled === 'boolean'
        ? value.tapeMonitorEnabled
        : DEFAULT_PREFERENCES.tapeMonitorEnabled,
      tapeMonitorVolume: Number.isInteger(value?.tapeMonitorVolume) &&
          value.tapeMonitorVolume >= 0 && value.tapeMonitorVolume <= 100
        ? value.tapeMonitorVolume
        : DEFAULT_PREFERENCES.tapeMonitorVolume,
      screenScale: oneOf(value?.screenScale, ['auto', '1', '2', '3', '4', '5'], DEFAULT_PREFERENCES.screenScale),
      screenAspect: oneOf(value?.screenAspect, ['square', 'video'], DEFAULT_PREFERENCES.screenAspect),
      screenRotation: oneOf(value?.screenRotation, [0, 90, 180, 270], DEFAULT_PREFERENCES.screenRotation),
      screenSmoothing: typeof value?.screenSmoothing === 'boolean'
        ? value.screenSmoothing : DEFAULT_PREFERENCES.screenSmoothing,
      cpuSpeed: integer(value?.cpuSpeed, 50, 1000, DEFAULT_PREFERENCES.cpuSpeed),
      tapeTurbo: typeof value?.tapeTurbo === 'boolean' ? value.tapeTurbo : DEFAULT_PREFERENCES.tapeTurbo,
      ramExpansion1: typeof value?.ramExpansion1 === 'boolean'
        ? value.ramExpansion1 : DEFAULT_PREFERENCES.ramExpansion1,
      ramExpansion2: typeof value?.ramExpansion2 === 'boolean'
        ? value.ramExpansion2 : DEFAULT_PREFERENCES.ramExpansion2,
      ramInitPattern: integer(value?.ramInitPattern, 0, 1, DEFAULT_PREFERENCES.ramInitPattern),
      quickTypeInterval: integer(value?.quickTypeInterval, 10, 100, DEFAULT_PREFERENCES.quickTypeInterval),
      macroSlot: integer(value?.macroSlot, 0, 9, DEFAULT_PREFERENCES.macroSlot),
      wavRate: oneOf(value?.wavRate, ['48000', '44100'], DEFAULT_PREFERENCES.wavRate),
      wavBaud: oneOf(value?.wavBaud, ['2400', '600'], DEFAULT_PREFERENCES.wavBaud),
      wavDecodeChannel: oneOf(value?.wavDecodeChannel, ['auto', 'left', 'right'], DEFAULT_PREFERENCES.wavDecodeChannel),
      packName: typeof value?.packName === 'string' && /^[\x20-\x7e]{1,16}$/.test(value.packName)
        ? value.packName : DEFAULT_PREFERENCES.packName,
      packAddress: typeof value?.packAddress === 'string' && /^[0-9a-fA-F]{1,4}$/.test(value.packAddress)
        ? value.packAddress : DEFAULT_PREFERENCES.packAddress,
      packKind: oneOf(value?.packKind, ['0', '1'], DEFAULT_PREFERENCES.packKind),
      packBaud: oneOf(value?.packBaud, ['0', '100'], DEFAULT_PREFERENCES.packBaud),
      romajiKana: typeof value?.romajiKana === 'boolean'
        ? value.romajiKana : DEFAULT_PREFERENCES.romajiKana,
      macros,
      gamepadButtonA: integer(value?.gamepadButtonA, 0, 31, DEFAULT_PREFERENCES.gamepadButtonA),
      gamepadButtonB: integer(value?.gamepadButtonB, 0, 31, DEFAULT_PREFERENCES.gamepadButtonB),
      gamepadOneButton: typeof value?.gamepadOneButton === 'boolean'
        ? value.gamepadOneButton : DEFAULT_PREFERENCES.gamepadOneButton,
      forcedJoystick: typeof value?.forcedJoystick === 'boolean'
        ? value.forcedJoystick : DEFAULT_PREFERENCES.forcedJoystick,
      forcedJoystickA: integer(value?.forcedJoystickA, 0, 255, DEFAULT_PREFERENCES.forcedJoystickA),
      forcedJoystickB: integer(value?.forcedJoystickB, 0, 255, DEFAULT_PREFERENCES.forcedJoystickB),
    };
  } catch {
    return {...DEFAULT_PREFERENCES, macros: [...DEFAULT_PREFERENCES.macros]};
  }
}

function savePreferences() {
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
  } catch {
    // The current-session setting still works when storage is unavailable.
  }
}

function syncPreferenceControls() {
  $('pause-on-focus-loss').checked = preferences.pauseOnFocusLoss;
  $('key-click-enabled').checked = preferences.keyClickEnabled;
  $('audio-volume').value = String(preferences.audioVolume);
  $('audio-volume-value').textContent = `${preferences.audioVolume}%`;
  $('audio-mute').checked = preferences.audioMuted;
  $('debug-history-enabled').checked = preferences.debugHistoryEnabled;
  $('tape-monitor-enabled').checked = preferences.tapeMonitorEnabled;
  $('tape-monitor-volume').value = String(preferences.tapeMonitorVolume);
  $('tape-monitor-volume-value').textContent = `${preferences.tapeMonitorVolume}%`;
  $('screen-scale').value = preferences.screenScale;
  $('screen-aspect').value = preferences.screenAspect;
  $('screen-rotation').value = String(preferences.screenRotation);
  $('screen-smoothing').checked = preferences.screenSmoothing;
  $('cpu-speed').value = String(preferences.cpuSpeed);
  $('cpu-speed-value').textContent = `${preferences.cpuSpeed}%`;
  $('tape-turbo').checked = preferences.tapeTurbo;
  $('ram-expansion-1').checked = preferences.ramExpansion1;
  $('ram-expansion-2').checked = preferences.ramExpansion2;
  $('ram-init-pattern').value = String(preferences.ramInitPattern);
  $('quick-type-interval').value = String(preferences.quickTypeInterval);
  $('quick-type-interval-value').textContent = `${preferences.quickTypeInterval} ms`;
  $('macro-slot').value = String(preferences.macroSlot);
  $('wav-rate').value = preferences.wavRate;
  $('wav-baud').value = preferences.wavBaud;
  $('wav-decode-channel').value = preferences.wavDecodeChannel;
  $('name').value = preferences.packName;
  $('address').value = preferences.packAddress;
  $('kind').value = preferences.packKind;
  $('baud').value = preferences.packBaud;
  $('romaji-kana').checked = preferences.romajiKana;
  $('gamepad-button-a').value = String(preferences.gamepadButtonA);
  $('gamepad-button-b').value = String(preferences.gamepadButtonB);
  $('gamepad-one-button').checked = preferences.gamepadOneButton;
  $('forced-joystick').checked = preferences.forcedJoystick;
  $('forced-joystick-a').value = preferences.forcedJoystickA.toString(16).toUpperCase().padStart(2, '0');
  $('forced-joystick-b').value = preferences.forcedJoystickB.toString(16).toUpperCase().padStart(2, '0');
  showMemoryConfigurationStatus();
  updateMacroEditor();
}

function updateMacroEditor(message = '') {
  const slot = Number($('macro-slot').value);
  const value = preferences.macros[slot] ?? '';
  $('macro-text').value = value;
  $('macro-status').textContent = message || (value
    ? `スロット${slot === 9 ? 0 : slot + 1}: ${value.length}文字を登録済みです。`
    : `スロット${slot === 9 ? 0 : slot + 1}: 未登録です。`);
  $('macro-run').disabled = !state.booted || state.paused ||
    Boolean(state.autoType) || value === '';
  $('macro-delete').disabled = value === '';
}

function updateViewPreference(name, value) {
  preferences[name] = value;
  savePreferences();
  applyScreenPreferences();
}

$('screen-scale').addEventListener('change', event => {
  updateViewPreference('screenScale', event.target.value);
});
$('screen-aspect').addEventListener('change', event => {
  updateViewPreference('screenAspect', event.target.value);
});
$('screen-rotation').addEventListener('change', event => {
  updateViewPreference('screenRotation', Number(event.target.value));
});
$('screen-smoothing').addEventListener('change', event => {
  updateViewPreference('screenSmoothing', event.target.checked);
});

$('cpu-speed').addEventListener('input', event => {
  preferences.cpuSpeed = Number(event.target.value);
  $('cpu-speed-value').textContent = `${preferences.cpuSpeed}%`;
  savePreferences();
  showMachineStatus();
});

$('tape-turbo').addEventListener('change', event => {
  preferences.tapeTurbo = event.target.checked;
  savePreferences();
  showMachineStatus();
});

for (const [id, name] of [
  ['ram-expansion-1', 'ramExpansion1'],
  ['ram-expansion-2', 'ramExpansion2'],
]) {
  $(id).addEventListener('change', event => {
    preferences[name] = event.target.checked;
    savePreferences();
    showMemoryConfigurationStatus(true);
  });
}

$('ram-init-pattern').addEventListener('change', event => {
  preferences.ramInitPattern = Number(event.target.value);
  savePreferences();
  showMemoryConfigurationStatus(true);
});

$('quick-type-interval').addEventListener('input', event => {
  preferences.quickTypeInterval = Number(event.target.value);
  $('quick-type-interval-value').textContent = `${preferences.quickTypeInterval} ms`;
  savePreferences();
});

$('quick-type-start').addEventListener('click', () => {
  try {
    const codes = encodeJrText($('quick-type-text').value);
    startAutomaticInput(codes, {
      label: 'クイックタイプ',
      origin: 'quick-type',
      intervalMs: preferences.quickTypeInterval,
    });
    canvas.focus();
  } catch (error) {
    $('quick-type-status').textContent = `開始できません: ${error.message}`;
  }
});

$('quick-type-stop').addEventListener('click', () => {
  stopAutomaticInput();
  canvas.focus();
});

$('macro-slot').addEventListener('change', event => {
  preferences.macroSlot = Number(event.target.value);
  savePreferences();
  updateMacroEditor();
});
$('macro-text').addEventListener('input', () => {
  const slot = Number($('macro-slot').value);
  const registered = preferences.macros[slot] ?? '';
  $('macro-status').textContent = $('macro-text').value === registered
    ? (registered ? '登録済みです。' : '未登録です。')
    : '未保存の変更があります。';
});
$('macro-save').addEventListener('click', () => {
  const slot = Number($('macro-slot').value);
  const value = $('macro-text').value.trimEnd();
  preferences.macros[slot] = value;
  savePreferences();
  updateMacroEditor(value ? 'マクロを保存しました。' : '空のマクロを削除しました。');
});
$('macro-delete').addEventListener('click', () => {
  const slot = Number($('macro-slot').value);
  preferences.macros[slot] = '';
  savePreferences();
  updateMacroEditor('マクロを削除しました。');
});
$('macro-run').addEventListener('click', () => {
  try {
    const slot = Number($('macro-slot').value);
    const codes = encodeJrText(preferences.macros[slot], {
      interpretEscapes: true,
      maximumBytes: 1024,
    });
    startAutomaticInput(codes, {
      label: `マクロ${slot === 9 ? 0 : slot + 1}`,
      origin: 'macro',
      intervalMs: preferences.quickTypeInterval,
    });
    canvas.focus();
  } catch (error) {
    $('macro-status').textContent = `実行できません: ${error.message}`;
  }
});

$('romaji-kana').addEventListener('change', event => {
  preferences.romajiKana = event.target.checked;
  romajiConverter.reset();
  savePreferences();
  refreshVirtualKeyboard();
});

function updateGamepadMapping(name, value) {
  preferences[name] = value;
  releaseForcedJoystick();
  savePreferences();
  gamepadController?.resync();
  showGamepadStatus();
}

for (const [id, name] of [
  ['gamepad-button-a', 'gamepadButtonA'],
  ['gamepad-button-b', 'gamepadButtonB'],
]) {
  $(id).addEventListener('change', event => {
    const value = Number(event.target.value);
    if (!Number.isInteger(value) || value < 0 || value > 31) {
      event.target.value = String(preferences[name]);
      return;
    }
    updateGamepadMapping(name, value);
  });
}

$('gamepad-one-button').addEventListener('change', event => {
  updateGamepadMapping('gamepadOneButton', event.target.checked);
});
$('forced-joystick').addEventListener('change', event => {
  updateGamepadMapping('forcedJoystick', event.target.checked);
});

for (const [id, name] of [
  ['forced-joystick-a', 'forcedJoystickA'],
  ['forced-joystick-b', 'forcedJoystickB'],
]) {
  $(id).addEventListener('change', event => {
    const text = event.target.value.trim();
    if (!/^[0-9a-fA-F]{2}$/.test(text)) {
      event.target.value = preferences[name].toString(16).toUpperCase().padStart(2, '0');
      return;
    }
    const value = parseInt(text, 16);
    event.target.value = text.toUpperCase();
    updateGamepadMapping(name, value);
  });
}

function applyTapeMonitorPreferences() {
  if (!codec) return;
  codec.machine.tape.setMonitor(
    preferences.tapeMonitorEnabled,
    preferences.tapeMonitorVolume,
  );
}

$('pause-on-focus-loss').addEventListener('change', event => {
  preferences.pauseOnFocusLoss = event.target.checked;
  savePreferences();
});

$('tape-monitor-enabled').addEventListener('change', event => {
  preferences.tapeMonitorEnabled = event.target.checked;
  savePreferences();
  try {
    applyTapeMonitorPreferences();
    showTapeStatus();
  } catch (error) {
    showTapeStatus(`モニター設定を変更できません: ${error.message}`);
  }
});

$('tape-monitor-volume').addEventListener('input', event => {
  preferences.tapeMonitorVolume = Number(event.target.value);
  $('tape-monitor-volume-value').textContent = `${preferences.tapeMonitorVolume}%`;
  savePreferences();
  try {
    applyTapeMonitorPreferences();
    showTapeStatus();
  } catch (error) {
    showTapeStatus(`モニター音量を変更できません: ${error.message}`);
  }
});

window.addEventListener('blur', () => {
  releaseKeys();
  gamepadController?.suspend();
  if (preferences.pauseOnFocusLoss && state.booted && !state.paused) {
    setPaused(true, '設定に従い、フォーカスを失ったため一時停止しました。');
  }
});

window.addEventListener('focus', () => {
  gamepadController?.resume();
});

for (const eventName of ['gamepadconnected', 'gamepaddisconnected']) {
  window.addEventListener(eventName, () => gamepadController?.update());
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseKeys();
    gamepadController?.suspend();
    if (preferences.pauseOnFocusLoss && state.booted && !state.paused) {
      setPaused(true, '設定に従い、ページが非表示になったため一時停止しました。');
    }
  } else if (document.hasFocus()) {
    gamepadController?.resume();
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
      let result;
      // A request can succeed before the transaction is committed to disk.
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB操作に失敗しました'));
      const request = operation(transaction.objectStore('assets'));
      request.onsuccess = () => { result = request.result; };
    });
  } finally {
    database.close();
  }
}

function safeStoredAssetName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name ? name.slice(0, 255) : fallback;
}

function currentRomAssetName() {
  if (state.romMode === 'combined') {
    return safeStoredAssetName(state.names.rom, '保存済み結合ROM');
  }
  return safeStoredAssetName(
    [state.names.rom1, state.names.rom2].filter(Boolean).join(' + '),
    '保存済み結合ROM',
  );
}

async function saveAssets(rom, font) {
  const value = {
    version: 2,
    rom: rom.slice().buffer,
    font: font.slice().buffer,
    names: {
      rom: currentRomAssetName(),
      font: safeStoredAssetName(state.names.font, '保存済みフォント'),
    },
  };
  await withAssetStore('readwrite', store => store.put(value, 'jr200'));
}

async function persistAssetsIfAllowed(
  message = 'ROMとフォントをIndexedDBへ保存しました。次回は自動復元します',
) {
  if (!$('remember-assets').checked || !assetsReady()) return false;
  try {
    await saveAssets(selectedRom(), state.font);
    updateAssetStatus(message);
    return true;
  } catch (error) {
    updateAssetStatus(`IndexedDBへ保存できません: ${error.message}`);
    return false;
  }
}

async function restoreSavedAssets({automatic = false} = {}) {
  try {
    const saved = await withAssetStore('readonly', store => store.get('jr200'));
    if (!saved) {
      if (!automatic) updateAssetStatus('復元エラー: 保存済みファイルはありません');
      return false;
    }
    const rom = new Uint8Array(saved.rom);
    const font = new Uint8Array(saved.font);
    const hasStoredNames = typeof saved.names?.rom === 'string' &&
      saved.names.rom.trim() !== '' && typeof saved.names?.font === 'string' &&
      saved.names.font.trim() !== '';
    validateCombinedRom(rom);
    if (font.length !== 2048 || isUniform(font)) throw new Error('保存済みフォントが不正です');
    state.assetSelectionRevision++;
    for (const key of ['rom', 'rom1', 'rom2', 'font']) {
      state.assetReadRevisions[key] = (state.assetReadRevisions[key] ?? 0) + 1;
      state.assetReadPending[key] = false;
    }
    state.romMode = 'combined';
    state.rom = rom;
    state.rom1 = null;
    state.rom2 = null;
    state.font = font;
    state.names.rom = safeStoredAssetName(saved.names?.rom, '旧保存形式・ファイル名不明');
    state.names.rom1 = '';
    state.names.rom2 = '';
    state.names.font = safeStoredAssetName(saved.names?.font, '旧保存形式・ファイル名不明');
    state.origins.rom = 'indexeddb';
    state.origins.rom1 = '';
    state.origins.rom2 = '';
    state.origins.font = 'indexeddb';
    $('remember-assets').checked = true;
    document.querySelector('input[name="rom-mode"][value="combined"]').checked = true;
    $('combined-fields').hidden = false;
    $('split-fields').hidden = true;
    const restoredMessage = automatic
      ? '保存済みROMとフォントを自動復元しました。「起動」を押してください'
      : '保存済みROMとフォントを復元しました。「起動」を押してください';
    updateAssetStatus(hasStoredNames
      ? restoredMessage
      : `${restoredMessage}。旧保存形式にはファイル名がないため、一度選び直すと次回から表示できます`);
    return true;
  } catch (error) {
    updateAssetStatus(`${automatic ? '自動復元エラー' : '復元エラー'}: ${error.message}`);
    return false;
  }
}

async function forgetSavedAssets(message = 'IndexedDBの保存済みファイルを削除しました') {
  try {
    await withAssetStore('readwrite', store => store.delete('jr200'));
    $('remember-assets').checked = false;
    for (const key of ['rom', 'rom1', 'rom2', 'font']) {
      if (state.origins[key] === 'indexeddb') state.origins[key] = 'memory';
    }
    updateAssetStatus(message);
    return true;
  } catch (error) {
    $('remember-assets').checked = true;
    updateAssetStatus(`削除エラー: ${error.message}`);
    return false;
  }
}

$('remember-assets').addEventListener('change', async event => {
  if (!event.target.checked) {
    await forgetSavedAssets('保存許可を解除し、IndexedDBの保存済みファイルを削除しました。現在の画面では引き続き使用できます');
    return;
  }
  if (!assetsReady()) {
    updateAssetStatus('ROMとフォントが揃うとIndexedDBへ保存し、次回自動復元します');
    return;
  }
  await persistAssetsIfAllowed();
});

$('restore-assets').addEventListener('click', async () => {
  await restoreSavedAssets();
});

$('forget-assets').addEventListener('click', async () => {
  await forgetSavedAssets();
});

async function readLimited(file, maximumBytes = 1024 * 1024) {
  if (!file) throw new Error('ファイルを選択してください');
  if (file.size > maximumBytes) {
    throw new Error(`上限は${maximumBytes / (1024 * 1024)} MiBです`);
  }
  return new Uint8Array(await file.arrayBuffer());
}

function downloadBytes(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importLaunchPack(kind) {
  cancelPendingLinkedGame();
  const input = $(kind === 'zip' ? 'launch-pack-zip' : 'launch-pack-folder');
  const files = Array.from(input.files);
  if (!files.length) return;
  const revision = ++state.packImportRevision;
  const tapeRevision = state.tapeSelectionRevision;
  state.packImportPending = true;
  $('launch-pack-cancel').hidden = false;
  $('launch-pack-status').textContent = '起動パックを検査しています。';
  try {
    const members = kind === 'zip'
      ? await zipMembers(await readLimited(files[0], 2 * 1024 * 1024))
      : await folderMembers(files);
    const pack = await validateLaunchPack(members);
    if (revision !== state.packImportRevision || tapeRevision !== state.tapeSelectionRevision) return;
    const autoLaunch = Boolean(pack.runCommand && pack.titleMarker);
    const game = {entry: {id: 'local-pack', title: pack.title,
      runCommand: pack.runCommand, titleMarker: pack.titleMarker}, bytes: pack.bytes};
    const instructions = pack.runCommand
      ? `CJRと入力テキストを取り込みました。ROM/FONTで起動後、MLOAD、${pack.runCommand} を手動で入力できます。`
      : 'CJRをセットし、入力テキストを入力支援欄へ取り込みました。内容を確認してから手動で入力を開始してください。';
    mountGameWithInput(game, {name: pack.fileName, autoLaunch,
      requireMachine: false, label: pack.title, instructions});
    $('quick-type-text').value = pack.text;
    $('launch-pack-status').textContent = autoLaunch
      ? `${pack.title}: CJRと入力テキストを検証しました。通常のMLOAD/USRで起動支援中です。`
      : `${pack.title}: CJRをセットし、入力テキストを取り込みました。自動起動はしません。`;
  } catch (error) {
    if (revision === state.packImportRevision) {
      $('launch-pack-status').textContent = `取り込めません: ${error.message}`;
    }
  } finally {
    if (revision === state.packImportRevision) {
      state.packImportPending = false;
      $('launch-pack-cancel').hidden = true;
    }
  }
}

$('launch-pack-zip').addEventListener('change', () => { void importLaunchPack('zip'); });
$('launch-pack-folder').addEventListener('change', () => { void importLaunchPack('folder'); });
$('launch-pack-cancel').addEventListener('click', () => {
  state.packImportRevision++;
  state.packImportPending = false;
  $('launch-pack-cancel').hidden = true;
  $('launch-pack-status').textContent = '起動パックの読込を中止しました。';
});

$('tape-cjr').addEventListener('change', async () => {
  cancelPendingLinkedGame();
  const file = $('tape-cjr').files[0];
  state.linkedGame = null;
  if (!$('game-launch').hidden) {
    $('game-launch-status').textContent = 'ローカルのCJRへ切り替えました。';
    $('game-launch-instructions').textContent = '';
  }
  state.tapeSelectedName = file?.name || '';
  const revision = ++state.tapeSelectionRevision;
  state.tapeSelectionStatus = '';
  showTapeStatus();
  if (!file) return;
  try {
    const bytes = await readLimited(file);
    const summary = codec.inspect(bytes);
    if (revision !== state.tapeSelectionRevision) return;
    if (summary.fileType === 1 && summary.dataBlocks > 0) {
      state.tapeSelectionStatus = 'マシン語 / MLOAD用です。';
    } else if (summary.fileType === 0) {
      state.tapeSelectionStatus = 'BASIC / LOAD用です。';
    } else {
      state.tapeSelectionStatus = '標準LOAD/MLOADに対応しないCJRです。';
    }
    showTapeStatus();
  } catch (error) {
    if (revision !== state.tapeSelectionRevision) return;
    state.tapeSelectionStatus = `検査できません: ${error.message}`;
    showTapeStatus();
  }
});

async function mountSelectedTape() {
  const revision = state.tapeSelectionRevision;
  const file = $('tape-cjr').files[0];
  const bytes = state.linkedGame?.bytes || await readLimited(file);
  if (revision !== state.tapeSelectionRevision) return false;
  state.tapeName = '';
  state.tapeMountedSelectionRevision = 0;
  codec.machine.tape.mount(bytes);
  state.tapeName = file?.name || state.tapeSelectedName || state.linkedGame?.entry.id + '.cjr';
  state.tapeMountedSelectionRevision = state.tapeSelectionRevision;
  return true;
}

$('tape-mount').addEventListener('click', async () => {
  cancelPendingLinkedGame();
  try {
    if (await mountSelectedTape()) {
      showTapeStatus('通常のカセット入力信号としてマウントしました。LOADまたはMLOADを実行してください。');
    }
  } catch (error) {
    showTapeStatus(`マウントできません: ${error.message}`);
  }
});

$('tape-quick-load').addEventListener('click', async () => {
  cancelPendingLinkedGame();
  try {
    const revision = state.tapeSelectionRevision;
    const file = $('tape-cjr').files[0];
    const bytes = state.linkedGame?.bytes || await readLimited(file);
    if (revision !== state.tapeSelectionRevision) return;
    const name = file?.name || state.tapeSelectedName || state.linkedGame?.entry.id + '.cjr';
    stopAutomaticInput();
    releaseKeys();
    const result = codec.machine.quickLoad(bytes);
    const kind = result.fileType === 0 ? 'BASIC' : 'マシン語';
    paintMachine();
    refreshDebugger();
    showMachineStatus();
    showTapeStatus(`${name} の${kind} ${result.injectedBytes}バイトを高速ロードしました。これはカセット信号経路を通らない便宜機能です。`);
    canvas.focus();
  } catch (error) {
    showTapeStatus(`高速ロードできません: ${error.message}`);
  }
});

$('tape-eject').addEventListener('click', () => {
  cancelPendingLinkedGame();
  codec.machine.tape.eject();
  state.tapeName = '';
  state.tapeMountedSelectionRevision = 0;
  showTapeStatus('CJRを取り出しました。');
});

$('tape-rewind').addEventListener('click', () => {
  cancelPendingLinkedGame();
  try {
    codec.machine.tape.rewind();
    showTapeStatus('CJRの信号位置を先頭へ戻しました。');
  } catch (error) {
    showTapeStatus(`巻戻しできません: ${error.message}`);
  }
});

$('tape-record').addEventListener('click', () => {
  cancelPendingLinkedGame();
  try {
    codec.machine.tape.armRecord();
    state.tapeName = '';
    state.tapeMountedSelectionRevision = 0;
    showTapeStatus('録音待機中です。JR-200側でSAVEまたはMSAVEを実行してください。REMOTE OFF後にCJRを検証します。');
  } catch (error) {
    showTapeStatus(`録音待機にできません: ${error.message}`);
  }
});

$('tape-download').addEventListener('click', () => {
  cancelPendingLinkedGame();
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
  cancelPendingLinkedGame();
  try {
    const output = codec.machine.tape.output();
    if (output.length === 0) throw new Error('再生できる録音CJRがありません');
    codec.machine.tape.mount(output);
    state.tapeName = '録音結果';
    state.tapeMountedSelectionRevision = -1;
    showTapeStatus('直前の録音CJRを通常のカセット入力信号としてマウントしました。');
  } catch (error) {
    showTapeStatus(`録音CJRをマウントできません: ${error.message}`);
  }
});

function resetWavDecode(message = 'WAVファイルを選択してください。') {
  state.decodedCjr = null;
  state.decodedName = '';
  $('wav-decode-save').disabled = true;
  $('wav-decode-status').textContent = message;
}

$('wav-decode-input').addEventListener('change', () => {
  const file = $('wav-decode-input').files[0];
  $('wav-decode-run').disabled = !codec || !file;
  resetWavDecode(file
    ? '解析を実行してください。元WAVは変更しません。'
    : 'WAVファイルを選択してください。');
});

$('wav-decode-channel').addEventListener('change', () => {
  preferences.wavDecodeChannel = $('wav-decode-channel').value;
  savePreferences();
  if ($('wav-decode-input').files.length) {
    resetWavDecode('channelを変更しました。解析を再実行してください。');
  }
});

$('wav-decode-run').addEventListener('click', async () => {
  resetWavDecode('解析中です。');
  try {
    const file = $('wav-decode-input').files[0];
    const bytes = await readLimited(file, 8 * 1024 * 1024);
    const decoded = codec.wav.decode(bytes, {channel: $('wav-decode-channel').value});
    const {cjr: _cjr, ...report} = decoded;
    const result = {
      ...report,
      rawWavModified: false,
      candidateDownloadEnabled: false,
      hardwareProvenanceInferred: false,
    };
    if (decoded.ok) {
      state.decodedCjr = decoded.cjr;
      state.decodedName = file.name.replace(/\.[^.]*$/, '') + '.cjr';
      $('wav-decode-save').disabled = false;
    }
    $('wav-decode-status').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    resetWavDecode(`エラー: ${error.message}`);
  }
});

$('wav-decode-save').addEventListener('click', () => {
  try {
    if (!state.decodedCjr) throw new Error('検証済みCJRがありません');
    const url = URL.createObjectURL(new Blob(
      [state.decodedCjr],
      {type: 'application/octet-stream'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = state.decodedName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    $('wav-decode-status').textContent = `保存エラー: ${error.message}`;
  }
});

async function inspectFile() {
  try {
    const file = $('cjr').files[0];
    const bytes = await readLimited(file);
    const summary = codec.inspect(bytes, $('headerless').checked);
    const flags = [[1, 'ヘッダーなし：形式・速度は不明'], [2, 'ブロック番号が非連続'], [4, 'アドレスが非連続：単純なBIN連結は不可'], [8, 'フッターアドレスが最終領域末尾と異なる'], [16, '未知のファイル種別'], [32, '標準と異なるヘッダーアドレス'], [64, 'データブロックなし']]
      .filter(([bit]) => summary.warnings & bit)
      .map(([, text]) => text);
    $('result').textContent = JSON.stringify({...summary, diagnostics: flags, hardwareVerified: false}, null, 2);
    state.wavCjr = summary.hasHeader && summary.fileType <= 1 ? bytes : null;
    state.wavName = state.wavCjr ? file.name : '';
    if (state.wavCjr) $('wav-baud').value = summary.baudFlag === 0 ? '2400' : '600';
    $('wav-create').disabled = !state.wavCjr;
    $('wav-status').textContent = state.wavCjr
      ? '標準CJRをWAVへ変換できます。生成しても自動再生しません。'
      : 'ヘッダー付き標準BASIC/マシン語CJRだけをWAVへ変換できます。';
  } catch (error) {
    state.wavCjr = null;
    state.wavName = '';
    $('wav-create').disabled = true;
    $('wav-status').textContent = '検証済みCJRを選択してください。';
    $('result').textContent = `エラー: ${error.message}`;
  }
}

$('cjr').addEventListener('change', inspectFile);
$('headerless').addEventListener('change', () => {
  headerlessExplicitlyAllowed = $('headerless').checked;
  if ($('cjr').files.length) inspectFile();
});

for (const [id, key] of [
  ['wav-rate', 'wavRate'], ['wav-baud', 'wavBaud'],
  ['kind', 'packKind'], ['baud', 'packBaud'],
]) {
  $(id).addEventListener('change', event => {
    preferences[key] = event.target.value;
    savePreferences();
  });
}
for (const [id, key, pattern] of [
  ['name', 'packName', /^[\x20-\x7e]{1,16}$/],
  ['address', 'packAddress', /^[0-9a-fA-F]{1,4}$/],
]) {
  $(id).addEventListener('input', event => {
    if (!pattern.test(event.target.value)) return;
    preferences[key] = event.target.value;
    savePreferences();
  });
}

$('wav-create').addEventListener('click', () => {
  try {
    if (!state.wavCjr) throw new Error('先に標準CJRを選択してください');
    const sampleRate = Number($('wav-rate').value);
    const baud = Number($('wav-baud').value);
    const rendered = codec.wav.encode(state.wavCjr, {sampleRate, baud});
    const url = URL.createObjectURL(new Blob([rendered.bytes], {type: 'audio/wav'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = state.wavName.replace(/\.[^.]*$/, '') + `-${baud}baud-${sampleRate}Hz.wav`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('wav-status').textContent = `${rendered.bytes.length}バイト / ${rendered.pcmSamples} samples / ${rendered.durationSeconds.toFixed(3)}秒 / ${sampleRate} Hz / mono 16-bit / ${rendered.baud} baud。実機互換はP12で未検証です。`;
  } catch (error) {
    $('wav-status').textContent = `エラー: ${error.message}`;
  }
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
