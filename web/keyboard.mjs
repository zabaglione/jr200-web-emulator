// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
// Key conversion follows VJR-200 Mn1544.cpp at the pinned upstream revision.

export const INPUT_MODES = Object.freeze({
  ANK: 'ank',
  KANA: 'kana',
  GRAPH: 'graph',
});

export const MODE_NAMES = Object.freeze({
  [INPUT_MODES.ANK]: '英数',
  [INPUT_MODES.KANA]: 'カナ',
  [INPUT_MODES.GRAPH]: 'GRAPH',
});

const pair = (normal, shifted = null) => Object.freeze([normal, shifted]);

const COMMON_CODES = Object.freeze({
  Return: pair(0x0d, 0x0d),
  Rubout: pair(0x08, 0x08),
  Delete: pair(0x7f, 0x7f),
  ArrowUp: pair(0x1e, 0x1e),
  ArrowDown: pair(0x1f, 0x1f),
  ArrowLeft: pair(0x1d, 0x1d),
  ArrowRight: pair(0x1c, 0x1c),
  Insert: pair(0x13, 0x13),
  Home: pair(0x0b, 0x0c),
  Space: pair(0x20, 0x20),
});

const ankCodes = {
  Digit0: pair(0x30),
  Digit1: pair(0x31, 0x21), Digit2: pair(0x32, 0x22),
  Digit3: pair(0x33, 0x23), Digit4: pair(0x34, 0x24),
  Digit5: pair(0x35, 0x25), Digit6: pair(0x36, 0x26),
  Digit7: pair(0x37, 0x27), Digit8: pair(0x38, 0x28),
  Digit9: pair(0x39, 0x29),
  Colon: pair(0x3a, 0x2a), Semicolon: pair(0x3b, 0x2b),
  Comma: pair(0x2c, 0x3c), Minus: pair(0x2d, 0x3d),
  Period: pair(0x2e, 0x3e), Slash: pair(0x2f, 0x3f),
  At: pair(0x40, 0x60), LeftBracket: pair(0x5b, 0x7b),
  Yen: pair(0x5c, 0x7c), RightBracket: pair(0x5d, 0x7d),
  Caret: pair(0x5e, 0x7e), Underscore: pair(null, 0x5f),
};

for (let offset = 0; offset < 26; ++offset) {
  const letter = String.fromCharCode(65 + offset);
  ankCodes[`Key${letter}`] = pair(0x61 + offset, 0x41 + offset);
}
const ANK_CODES = Object.freeze(ankCodes);

const KANA_CODES = Object.freeze({
  Digit1: pair(0xc7), Digit2: pair(0xcc), Digit3: pair(0xb1, 0xa7),
  Digit4: pair(0xb3, 0xa9), Digit5: pair(0xb4, 0xaa),
  Digit6: pair(0xb5, 0xab), Digit7: pair(0xd4, 0xac),
  Digit8: pair(0xd5, 0xad), Digit9: pair(0xd6, 0xae),
  Digit0: pair(0xdc, 0xa6), Minus: pair(0xce), Caret: pair(0xcd),
  Yen: pair(0xb0),
  KeyQ: pair(0xc0), KeyW: pair(0xc3), KeyE: pair(0xb2, 0xa8),
  KeyR: pair(0xbd), KeyT: pair(0xb6), KeyY: pair(0xdd),
  KeyU: pair(0xc5), KeyI: pair(0xc6), KeyO: pair(0xd7),
  KeyP: pair(0xbe), At: pair(0xde), LeftBracket: pair(0xdf, 0xa2),
  KeyA: pair(0xc1), KeyS: pair(0xc4), KeyD: pair(0xbc),
  KeyF: pair(0xca), KeyG: pair(0xb7), KeyH: pair(0xb8),
  KeyJ: pair(0xcf), KeyK: pair(0xc9), KeyL: pair(0xd8),
  Semicolon: pair(0xda), Colon: pair(0xb9), RightBracket: pair(0xd1, 0xa3),
  KeyZ: pair(0xc2, 0xaf), KeyX: pair(0xbb), KeyC: pair(0xbf),
  KeyV: pair(0xcb), KeyB: pair(0xba), KeyN: pair(0xd0),
  KeyM: pair(0xd3), Comma: pair(0xc8, 0xa4),
  Period: pair(0xd9, 0xa1), Slash: pair(0xd2, 0xa5),
  Underscore: pair(0xdb),
});

const GRAPH_CODES = Object.freeze({
  Digit1: pair(0x81), Digit2: pair(0x82), Digit3: pair(0x83),
  Digit4: pair(0x84), Digit5: pair(0x85), Digit6: pair(0x86),
  Digit7: pair(0x87), Digit8: pair(0x88), Digit9: pair(0x89),
  KeyM: pair(0x8a, 0x8b), Caret: pair(0x8c),
  KeyO: pair(0x8d, 0x9d), Yen: pair(0x8e),
  KeyT: pair(0xeb, 0x8f), KeyI: pair(0x90, 0xfe),
  KeyA: pair(0x91, 0xf1), KeyS: pair(0x92, 0xf7),
  KeyD: pair(0x93, 0xe5), KeyF: pair(0x94, 0xf2),
  KeyG: pair(0x95, 0xf4), KeyH: pair(0x96, 0xf9),
  KeyJ: pair(0x97, 0xf5), KeyQ: pair(0x98, 0x9e),
  KeyE: pair(0x99, 0x9f), KeyY: pair(0x9a),
  KeyW: pair(0x9b, 0xff), KeyR: pair(0xec, 0x9c),
  KeyP: pair(0xe0, 0xfc), KeyZ: pair(0xfa, 0xe1),
  KeyB: pair(0xe2, 0xe7), KeyC: pair(0xe3, 0xe4),
  KeyV: pair(0xf6, 0xe6), KeyN: pair(0xee, 0xe8),
  KeyU: pair(0xe9), At: pair(0xea), Minus: pair(0xed),
  KeyK: pair(0xef, 0xfb), KeyL: pair(0xf0, 0xfd),
  KeyX: pair(0xf8, 0xf3),
});

const MODE_TABLES = Object.freeze({
  [INPUT_MODES.ANK]: ANK_CODES,
  [INPUT_MODES.KANA]: KANA_CODES,
  [INPUT_MODES.GRAPH]: GRAPH_CODES,
});

const MODE_KEYS = Object.freeze({
  ModeGraph: Object.freeze({mode: INPUT_MODES.GRAPH, code: 0x80}),
  ModeAnk: Object.freeze({mode: INPUT_MODES.ANK, code: 0x14}),
  ModeKana: Object.freeze({mode: INPUT_MODES.KANA, code: 0xa0}),
});

const EVENT_KEY_IDS = Object.freeze({
  Enter: 'Return', Backspace: 'Rubout', Delete: 'Delete',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Insert: 'Insert', Home: 'Home', Space: 'Space',
  PageUp: 'ModeGraph', Convert: 'ModeGraph',
  PageDown: 'ModeAnk', NonConvert: 'ModeAnk',
  End: 'ModeKana', KanaMode: 'ModeKana',
  Escape: 'Break', F11: 'Break',
  ShiftLeft: 'ModifierShift', ShiftRight: 'ModifierShift',
  ControlLeft: 'ModifierControl', ControlRight: 'ModifierControl',
  Minus: 'Minus', Equal: 'Caret', IntlYen: 'Yen',
  Backslash: 'Yen', BracketLeft: 'At', BracketRight: 'LeftBracket',
  Semicolon: 'Semicolon', Quote: 'Colon', Comma: 'Comma',
  Period: 'Period', Slash: 'Slash', IntlBackslash: 'Underscore',
  F7: 'RightBracket', F8: 'Underscore',
});

export function keyIdForKeyboardEvent(event) {
  if (!event || typeof event.code !== 'string') return null;
  if (/^(Digit[0-9]|Key[A-Z])$/.test(event.code)) return event.code;
  return EVENT_KEY_IDS[event.code] ?? null;
}

function resolvedCode(table, keyId, shifted) {
  const values = table[keyId];
  if (!values) return null;
  const code = values[shifted ? 1 : 0];
  return Number.isInteger(code) ? code : null;
}

export function resolveKey(keyId, state = {}) {
  const mode = state.mode ?? INPUT_MODES.ANK;
  const shift = Boolean(state.shift);
  const ctrl = Boolean(state.ctrl);
  if (!Object.hasOwn(MODE_TABLES, mode)) return null;
  if (keyId === 'Break') return Object.freeze({kind: 'nmi', mode: INPUT_MODES.ANK});
  if (keyId === 'ModifierShift') return Object.freeze({kind: 'modifier', modifier: 'shift'});
  if (keyId === 'ModifierControl') return Object.freeze({kind: 'modifier', modifier: 'ctrl'});
  if (Object.hasOwn(MODE_KEYS, keyId)) {
    const value = MODE_KEYS[keyId];
    return Object.freeze({kind: 'mode', mode: value.mode, code: value.code});
  }
  const common = resolvedCode(COMMON_CODES, keyId, shift);
  if (common !== null) return Object.freeze({kind: 'code', code: common});
  if (ctrl) {
    const match = /^Key([A-Z])$/.exec(keyId);
    if (match) return Object.freeze({kind: 'code', code: match[1].charCodeAt(0) - 0x40});
    if (keyId === 'LeftBracket') return Object.freeze({kind: 'code', code: 0x1b});
    return null;
  }
  const code = resolvedCode(MODE_TABLES[mode], keyId, shift);
  return code === null ? null : Object.freeze({kind: 'code', code});
}

export function displayCodeFor(keyId, state = {}) {
  const resolved = resolveKey(keyId, state);
  return resolved && (resolved.kind === 'code' || resolved.kind === 'mode')
    ? resolved.code
    : null;
}

const makeKey = (id, name, options = {}) => Object.freeze({
  id,
  name,
  width: options.width ?? 1,
  tone: options.tone ?? 'normal',
  text: options.text ?? null,
});

export const KEY_ROWS = Object.freeze([
  Object.freeze([
    makeKey('Break', 'BREAK', {text: 'BREAK', tone: 'control', width: 1.35}),
    makeKey('ModeAnk', '英数', {text: '英数', tone: 'accent', width: 1.2}),
    makeKey('ModeKana', 'カナ', {text: 'カナ', tone: 'accent', width: 1.2}),
    makeKey('ModeGraph', 'GRAPH', {text: 'GRAPH', tone: 'accent', width: 1.35}),
    ...Array.from({length: 10}, (_, index) => makeKey(`Digit${(index + 1) % 10}`, `数字キー ${(index + 1) % 10}`)),
    makeKey('Minus', 'マイナスキー'), makeKey('Caret', 'キャレットキー'),
    makeKey('Yen', '円記号キー'), makeKey('Rubout', 'RUB OUT', {text: 'RUB OUT', tone: 'accent', width: 1.55}),
  ]),
  Object.freeze([
    ...'QWERTYUIOP'.split('').map(letter => makeKey(`Key${letter}`, `${letter}キー`)),
    makeKey('At', 'アットマークキー'), makeKey('LeftBracket', '左角括弧キー'),
    makeKey('Return', 'RETURN', {text: 'RETURN', tone: 'accent', width: 1.7}),
    makeKey('Home', 'HOME / CLS', {text: 'HOME\nCLS', tone: 'accent', width: 1.2}),
  ]),
  Object.freeze([
    makeKey('ModifierControl', 'CTRL', {text: 'CTRL', tone: 'control', width: 1.35}),
    ...'ASDFGHJKL'.split('').map(letter => makeKey(`Key${letter}`, `${letter}キー`)),
    makeKey('Semicolon', 'セミコロンキー'), makeKey('Colon', 'コロンキー'),
    makeKey('RightBracket', '右角括弧キー'),
    makeKey('Insert', 'INS', {text: 'INS', tone: 'accent'}),
    makeKey('Delete', 'DEL', {text: 'DEL', tone: 'accent'}),
    makeKey('ArrowUp', '上カーソル', {text: '↑', tone: 'accent'}),
  ]),
  Object.freeze([
    makeKey('ModifierShift', 'SHIFT', {text: 'SHIFT', tone: 'control', width: 1.55}),
    ...'ZXCVBNM'.split('').map(letter => makeKey(`Key${letter}`, `${letter}キー`)),
    makeKey('Comma', 'コンマキー'), makeKey('Period', 'ピリオドキー'),
    makeKey('Slash', 'スラッシュキー'), makeKey('Underscore', '下線キー'),
    makeKey('Space', 'SPACE', {text: 'SPACE', width: 3.5}),
    makeKey('ArrowLeft', '左カーソル', {text: '←', tone: 'accent'}),
    makeKey('ArrowDown', '下カーソル', {text: '↓', tone: 'accent'}),
    makeKey('ArrowRight', '右カーソル', {text: '→', tone: 'accent'}),
  ]),
]);

export class InputController {
  constructor({sendCode, pulseNmi, onChange = () => {}, minimumHoldMs = 45} = {}) {
    if (typeof sendCode !== 'function' || typeof pulseNmi !== 'function') {
      throw new TypeError('sendCode and pulseNmi callbacks are required');
    }
    this.sendCode = sendCode;
    this.pulseNmi = pulseNmi;
    this.onChange = onChange;
    this.minimumHoldMs = minimumHoldMs;
    this.mode = INPUT_MODES.ANK;
    this.latched = {shift: false, ctrl: false};
    this.sources = new Map();
    this.codeOwners = new Map();
    this.modifierOwners = {shift: new Set(), ctrl: new Set()};
    this.pendingTimers = new Map();
  }

  snapshot() {
    const pressedKeyIds = new Set(Array.from(this.sources.values(), entry => entry.keyId));
    return Object.freeze({
      mode: this.mode,
      shift: this.latched.shift || this.modifierOwners.shift.size > 0,
      ctrl: this.latched.ctrl || this.modifierOwners.ctrl.size > 0,
      latchedShift: this.latched.shift,
      latchedCtrl: this.latched.ctrl,
      pressedKeyIds,
    });
  }

  press(keyId, source, {minimumHold = false} = {}) {
    if (!keyId || !source || this.sources.has(source)) return null;
    const state = this.snapshot();
    const resolved = resolveKey(keyId, state);
    if (!resolved) return null;
    const entry = {keyId, resolved, pressedAt: performance.now(), minimumHold};
    this.sources.set(source, entry);
    if (resolved.kind === 'modifier') {
      this.modifierOwners[resolved.modifier].add(source);
    } else if (resolved.kind === 'nmi') {
      this.mode = resolved.mode;
      this.pulseNmi();
    } else {
      if (resolved.kind === 'mode') this.mode = resolved.mode;
      let owners = this.codeOwners.get(resolved.code);
      if (!owners) {
        owners = new Set();
        this.codeOwners.set(resolved.code, owners);
      }
      if (owners.size === 0) this.sendCode(resolved.code, true);
      owners.add(source);
    }
    this.notify();
    return resolved;
  }

  release(source, {immediate = false} = {}) {
    const entry = this.sources.get(source);
    if (!entry) return false;
    const remaining = this.minimumHoldMs - (performance.now() - entry.pressedAt);
    if (!immediate && entry.minimumHold && remaining > 0) {
      if (!this.pendingTimers.has(source)) {
        this.pendingTimers.set(source, setTimeout(() => {
          this.pendingTimers.delete(source);
          this.finishRelease(source);
        }, remaining));
      }
      return true;
    }
    return this.finishRelease(source);
  }

  finishRelease(source) {
    const entry = this.sources.get(source);
    if (!entry) return false;
    this.sources.delete(source);
    if (entry.resolved.kind === 'modifier') {
      this.modifierOwners[entry.resolved.modifier].delete(source);
    } else if (entry.resolved.kind === 'code' || entry.resolved.kind === 'mode') {
      const owners = this.codeOwners.get(entry.resolved.code);
      owners?.delete(source);
      if (owners?.size === 0) {
        this.codeOwners.delete(entry.resolved.code);
        this.sendCode(entry.resolved.code, false);
      }
    }
    this.notify();
    return true;
  }

  toggleLatch(modifier) {
    if (modifier !== 'shift' && modifier !== 'ctrl') return false;
    this.latched[modifier] = !this.latched[modifier];
    this.notify();
    return this.latched[modifier];
  }

  releaseAll({clearLatches = true} = {}) {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const code of this.codeOwners.keys()) this.sendCode(code, false);
    this.sources.clear();
    this.codeOwners.clear();
    this.modifierOwners.shift.clear();
    this.modifierOwners.ctrl.clear();
    if (clearLatches) this.latched = {shift: false, ctrl: false};
    this.notify();
  }

  reset() {
    this.releaseAll();
    this.mode = INPUT_MODES.ANK;
    this.notify();
  }

  notify() {
    this.onChange(this.snapshot());
  }
}
