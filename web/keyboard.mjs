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

export function encodeJrText(text, {interpretEscapes = false, maximumBytes = 65536} = {}) {
  if (typeof text !== 'string' || !Number.isInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError('text and a positive maximumBytes value are required');
  }
  const codes = [];
  const append = code => {
    if (codes.length >= maximumBytes) throw new Error(`入力は${maximumBytes}バイト以下にしてください`);
    codes.push(code);
  };
  for (let index = 0; index < text.length; ++index) {
    const character = text[index];
    if (interpretEscapes && character === '\\') {
      const next = text[index + 1];
      if (next === 'r' || next === 'R') {
        append(0x0d);
        ++index;
        continue;
      }
      if (next === '\\') {
        append(0x5c);
        ++index;
        continue;
      }
      append(0x5c);
      continue;
    }
    if (character === '\r') {
      append(0x0d);
      if (text[index + 1] === '\n') ++index;
      continue;
    }
    if (character === '\n') {
      append(0x0d);
      continue;
    }
    const point = character.codePointAt(0);
    if (point >= 0xff61 && point <= 0xff9f) {
      append(0xa1 + point - 0xff61);
    } else if (point === 0x00a5 || point === 0xffe5) {
      append(0x5c);
    } else if ((point >= 0x20 && point <= 0x7e) || point === 0x08 || point === 0x09) {
      append(point);
    } else {
      throw new Error(`JR-200へ入力できない文字があります（位置${index + 1}）`);
    }
  }
  return Uint8Array.from(codes);
}

const ROMAJI_VOWELS = 'AIUEO';
const ROMAJI_SINGLE = Object.freeze(['ｱ', 'ｲ', 'ｳ', 'ｴ', 'ｵ']);
const ROMAJI_TWO = Object.freeze({
  K: ['ｶ', 'ｷ', 'ｸ', 'ｹ', 'ｺ'], S: ['ｻ', 'ｼ', 'ｽ', 'ｾ', 'ｿ'],
  T: ['ﾀ', 'ﾁ', 'ﾂ', 'ﾃ', 'ﾄ'], N: ['ﾅ', 'ﾆ', 'ﾇ', 'ﾈ', 'ﾉ'],
  H: ['ﾊ', 'ﾋ', 'ﾌ', 'ﾍ', 'ﾎ'], F: ['ﾌｧ', 'ﾌｨ', 'ﾌ', 'ﾌｪ', 'ﾌｫ'],
  M: ['ﾏ', 'ﾐ', 'ﾑ', 'ﾒ', 'ﾓ'], Y: ['ﾔ', '', 'ﾕ', '', 'ﾖ'],
  R: ['ﾗ', 'ﾘ', 'ﾙ', 'ﾚ', 'ﾛ'], W: ['ﾜ', '', '', '', 'ｦ'],
  G: ['ｶﾞ', 'ｷﾞ', 'ｸﾞ', 'ｹﾞ', 'ｺﾞ'], Z: ['ｻﾞ', 'ｼﾞ', 'ｽﾞ', 'ｾﾞ', 'ｿﾞ'],
  J: ['ｼﾞｬ', 'ｼﾞ', 'ｼﾞｭ', 'ｼﾞｪ', 'ｼﾞｮ'], D: ['ﾀﾞ', 'ﾁﾞ', 'ﾂﾞ', 'ﾃﾞ', 'ﾄﾞ'],
  B: ['ﾊﾞ', 'ﾋﾞ', 'ﾌﾞ', 'ﾍﾞ', 'ﾎﾞ'], P: ['ﾊﾟ', 'ﾋﾟ', 'ﾌﾟ', 'ﾍﾟ', 'ﾎﾟ'],
  V: ['ｳﾞｧ', 'ｳﾞｨ', 'ｳﾞ', 'ｳﾞｪ', 'ｳﾞｫ'],
  L: ['ｧ', 'ｨ', 'ｩ', 'ｪ', 'ｫ'], X: ['ｧ', 'ｨ', 'ｩ', 'ｪ', 'ｫ'],
});
const ROMAJI_THREE = Object.freeze({
  KY: ['ｷｬ', '', 'ｷｭ', '', 'ｷｮ'], SY: ['ｼｬ', '', 'ｼｭ', '', 'ｼｮ'],
  TY: ['ﾁｬ', '', 'ﾁｭ', '', 'ﾁｮ'], CY: ['ﾁｬ', '', 'ﾁｭ', '', 'ﾁｮ'],
  NY: ['ﾆｬ', '', 'ﾆｭ', '', 'ﾆｮ'], HY: ['ﾋｬ', '', 'ﾋｭ', '', 'ﾋｮ'],
  MY: ['ﾐｬ', '', 'ﾐｭ', '', 'ﾐｮ'], RY: ['ﾘｬ', '', 'ﾘｭ', '', 'ﾘｮ'],
  GY: ['ｷﾞｬ', '', 'ｷﾞｭ', '', 'ｷﾞｮ'], ZY: ['ｼﾞｬ', '', 'ｼﾞｭ', '', 'ｼﾞｮ'],
  DY: ['ﾁﾞｬ', '', 'ﾁﾞｭ', '', 'ﾁﾞｮ'], BY: ['ﾋﾞｬ', '', 'ﾋﾞｭ', '', 'ﾋﾞｮ'],
  PY: ['ﾋﾟｬ', '', 'ﾋﾟｭ', '', 'ﾋﾟｮ'], YX: ['', '', 'ｯ', '', ''],
  XT: ['', '', 'ｯ', '', ''], TL: ['', '', 'ｯ', '', ''],
  LT: ['', '', 'ｯ', '', ''], TT: ['', '', 'ﾂ', '', ''],
  TS: ['', '', 'ﾂ', '', ''],
  SH: ['ｼｬ', 'ｼ', 'ｼｭ', 'ｼｪ', 'ｼｮ'], CH: ['ﾁｬ', 'ﾁ', 'ﾁｭ', 'ﾁｪ', 'ﾁｮ'],
});

export class RomajiKanaConverter {
  constructor() {
    this.pending = '';
  }

  reset() {
    this.pending = '';
  }

  backspace() {
    if (this.pending.length === 0) return false;
    this.pending = this.pending.slice(0, -1);
    return true;
  }

  feed(character) {
    if (typeof character !== 'string' || !/^[A-Za-z]$/.test(character)) {
      throw new TypeError('romaji input requires one ASCII letter');
    }
    const key = character.toUpperCase();
    this.pending += key;
    const emit = text => encodeJrText(text);
    if (this.pending.length === 1) {
      const vowel = ROMAJI_VOWELS.indexOf(key);
      if (vowel >= 0) {
        this.reset();
        return emit(ROMAJI_SINGLE[vowel]);
      }
      if (key === 'Q') {
        this.reset();
        return emit('Q');
      }
      return new Uint8Array();
    }

    if (this.pending.length === 2) {
      const [first, second] = this.pending;
      if (first === second) {
        if (first === 'N') {
          this.reset();
          return emit('ﾝ');
        }
        this.pending = first;
        return emit('ｯ');
      }
      const vowel = ROMAJI_VOWELS.indexOf(second);
      if (vowel >= 0) {
        const converted = ROMAJI_TWO[first]?.[vowel] || this.pending;
        this.reset();
        return emit(converted);
      }
      if (first === 'N') {
        this.pending = second;
        return emit('ﾝ');
      }
      if (Object.hasOwn(ROMAJI_THREE, this.pending)) return new Uint8Array();
      const raw = this.pending;
      this.reset();
      return emit(raw);
    }

    const raw = this.pending;
    const vowel = ROMAJI_VOWELS.indexOf(key);
    const converted = vowel >= 0
      ? ROMAJI_THREE[this.pending.slice(0, 2)]?.[vowel] || raw
      : raw;
    this.reset();
    return emit(converted);
  }
}

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

const BASIC_CTRL_CODES = Object.freeze({
  Digit1: 0x0c,
  Digit2: 0x0b,
  KeyZ: 0x1a,
  KeyX: 0x18,
  KeyC: 0x03,
  KeyV: 0x16,
});

const BASIC_CTRL_LEGENDS = Object.freeze({
  Digit1: 'CLS', Digit2: 'HOME',
  At: 'RNDM',
  KeyZ: 'L.INS', KeyX: 'CANCEL', KeyC: 'BREAK', KeyV: 'HCOPY',
});

const macro = text => Object.freeze(Array.from(text, character => character.charCodeAt(0)));
const BASIC_CTRL_MACROS = Object.freeze({
  Digit3: macro('SAVE '), Digit4: macro('LOAD '), Digit5: macro('VERIFY '),
  Digit6: macro('OPEN '), Digit7: macro('CLOSE '), Digit8: macro('PLAY '),
  Digit9: macro('TEMPO '), Digit0: macro('BEEP '), Minus: macro('COLOR '),
  Caret: macro('CLEAR '), Yen: macro('DELETE '),
  KeyQ: macro('GOSUB '), KeyW: macro('RETURN'), KeyE: macro('END'),
  KeyR: macro('RUN '), KeyT: macro('THEN '), KeyY: macro('LOCATE '),
  KeyU: macro('IF '), KeyI: macro('INPUT '), KeyO: macro('PLOT '),
  KeyP: macro('PRINT '), At: macro('RANDOMIZE'), LeftBracket: macro('FIND '),
  KeyA: macro('AUTO '), KeyS: macro('STOP'), KeyD: macro('DIM '),
  KeyF: macro('FOR '), KeyG: macro('GOTO '), KeyH: macro('POKE '),
  KeyJ: macro('RND('), KeyK: macro('READ '), KeyL: macro('LIST '),
  Semicolon: macro('CHR$('), Colon: macro('REM '), RightBracket: macro('CONT'),
  KeyB: macro('RESTORE '), KeyN: macro('NEXT '), KeyM: macro('MON'),
  Comma: macro('DATA '), Period: macro('PEEK('), Slash: macro('HEX$('),
  Underscore: macro('PICK '),
});

const EVENT_KEY_IDS = Object.freeze({
  Enter: 'Return', NumpadEnter: 'Return', Backspace: 'Rubout', Delete: 'Delete',
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
  // On a macOS JIS keyboard, the key labelled `]` can report the US-position
  // code `Backslash`. Use the produced key only for this ambiguous position;
  // genuine US backslash and JIS yen keys keep the Yen mapping below.
  if (event.code === 'Backslash' && (event.key === ']' || event.key === '}')) {
    return 'RightBracket';
  }
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
  const ctrlBasicMode = Boolean(state.ctrlBasicMode);
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
    // The pinned Windows version switches CTRL between neutral control codes
    // and JR BASIC keyword entry according to MN1271 KSTAT. CTRL+SHIFT always
    // selects the neutral path.
    if (!ctrlBasicMode || shift) {
      const match = /^Key([A-Z])$/.exec(keyId);
      if (match) return Object.freeze({kind: 'code', code: match[1].charCodeAt(0) - 0x40});
      if (keyId === 'LeftBracket') return Object.freeze({kind: 'code', code: 0x1b});
    } else {
      const directCode = BASIC_CTRL_CODES[keyId];
      if (Number.isInteger(directCode)) return Object.freeze({kind: 'code', code: directCode});
      if (mode === INPUT_MODES.ANK) {
        const codes = BASIC_CTRL_MACROS[keyId];
        if (!codes) return null;
        return Object.freeze({
          kind: 'macro',
          codes,
          displayCode: resolvedCode(ANK_CODES, keyId, false) ??
            resolvedCode(ANK_CODES, keyId, true),
        });
      }
    }
  }
  const code = resolvedCode(MODE_TABLES[mode], keyId, shift);
  return code === null ? null : Object.freeze({kind: 'code', code});
}

export function displayCodeFor(keyId, state = {}) {
  const resolved = resolveKey(keyId, state);
  return resolved && (resolved.kind === 'code' || resolved.kind === 'mode')
    ? resolved.code
    : resolved?.kind === 'macro' ? resolved.displayCode : null;
}

export function functionLegendFor(keyId, state = {}) {
  if ((state.mode ?? INPUT_MODES.ANK) !== INPUT_MODES.ANK ||
      !state.ctrl || state.shift || !state.ctrlBasicMode) return null;
  if (Object.hasOwn(BASIC_CTRL_LEGENDS, keyId)) return BASIC_CTRL_LEGENDS[keyId];
  const codes = BASIC_CTRL_MACROS[keyId];
  return codes ? String.fromCharCode(...codes).trimEnd() : null;
}

const makeKey = (id, name, options = {}) => Object.freeze({
  kind: 'key',
  id,
  name,
  width: options.width ?? 1,
  tone: options.tone ?? 'normal',
  text: options.text ?? null,
  area: options.area ?? null,
});
const makeSpacer = (width = 1) => Object.freeze({kind: 'spacer', width});

export const KEY_ROWS = Object.freeze([
  Object.freeze([
    ...Array.from({length: 10}, (_, index) => makeKey(`Digit${(index + 1) % 10}`, `数字キー ${(index + 1) % 10}`)),
    makeKey('Minus', 'マイナスキー'), makeKey('Caret', 'キャレットキー'),
    makeKey('Yen', '円記号キー'), makeKey('Rubout', 'RUB OUT', {text: 'RUB OUT', tone: 'accent', width: 1.55}),
  ]),
  Object.freeze([
    makeSpacer(0.55),
    ...'QWERTYUIOP'.split('').map(letter => makeKey(`Key${letter}`, `${letter}キー`)),
    makeKey('At', 'アットマークキー'), makeKey('LeftBracket', '左角括弧キー'),
    makeKey('Return', 'RETURN', {text: 'RETURN', tone: 'accent', width: 1.7}),
  ]),
  Object.freeze([
    makeKey('ModifierControl', 'CTRL', {text: 'CTRL', tone: 'control', width: 1.35}),
    ...'ASDFGHJKL'.split('').map(letter => makeKey(`Key${letter}`, `${letter}キー`)),
    makeKey('Semicolon', 'セミコロンキー'), makeKey('Colon', 'コロンキー'),
    makeKey('RightBracket', '右角括弧キー'),
    makeSpacer(1.2),
  ]),
  Object.freeze([
    makeKey('ModifierShift', '左SHIFT', {text: 'SHIFT', tone: 'accent', width: 1.55}),
    ...'ZXCVBNM'.split('').map(letter => makeKey(`Key${letter}`, `${letter}キー`)),
    makeKey('Comma', 'コンマキー'), makeKey('Period', 'ピリオドキー'),
    makeKey('Slash', 'スラッシュキー'), makeKey('Underscore', '下線キー'),
    makeKey('ModifierShift', '右SHIFT', {text: 'SHIFT', tone: 'accent', width: 1.55}),
    makeSpacer(0.45),
  ]),
  Object.freeze([
    makeKey('ModeAnk', '英数', {text: '英数', tone: 'accent', width: 1.2}),
    makeKey('ModeGraph', 'GRAPH', {text: 'GRAPH', tone: 'accent', width: 1.35}),
    makeKey('Space', 'SPACE', {text: 'SPACE', width: 6}),
    makeKey('ModeKana', 'カナ', {text: 'カナ', tone: 'accent', width: 1.2}),
    makeSpacer(4.8),
  ]),
]);

export const CONTROL_KEYS = Object.freeze([
  makeKey('Break', 'BREAK', {text: 'BREAK', tone: 'control', area: 'break'}),
  makeKey('Insert', 'INS', {text: 'INS', tone: 'accent', area: 'insert'}),
  makeKey('Delete', 'DEL', {text: 'DEL', tone: 'accent', area: 'delete'}),
  makeKey('ArrowUp', '上カーソル', {text: '↑', tone: 'accent', area: 'up'}),
  makeKey('ArrowLeft', '左カーソル', {text: '←', tone: 'accent', area: 'left'}),
  makeKey('ArrowRight', '右カーソル', {text: '→', tone: 'accent', area: 'right'}),
  makeKey('ArrowDown', '下カーソル', {text: '↓', tone: 'accent', area: 'down'}),
]);

export const JOYSTICK_NEUTRAL = 0xff;
export const GAMEPAD_DEAD_ZONE = 0.4;

function gamepadButtonPressed(button) {
  if (typeof button === 'number') return button > 0.5;
  return Boolean(button?.pressed || Number(button?.value ?? 0) > 0.5);
}

export function joystickStateForGamepad(gamepad, {
  deadZone = GAMEPAD_DEAD_ZONE,
  buttonA = 0,
  buttonB = 1,
  oneButton = false,
} = {}) {
  if (!gamepad || !Number.isFinite(deadZone) || deadZone < 0 || deadZone >= 1) {
    return JOYSTICK_NEUTRAL;
  }
  if (!Number.isInteger(buttonA) || buttonA < 0 || buttonA > 31 ||
      !Number.isInteger(buttonB) || buttonB < 0 || buttonB > 31) {
    return JOYSTICK_NEUTRAL;
  }
  const axes = gamepad.axes ?? [];
  const buttons = gamepad.buttons ?? [];
  const horizontal = Number.isFinite(axes[0]) ? axes[0] : 0;
  const vertical = Number.isFinite(axes[1]) ? axes[1] : 0;
  let state = JOYSTICK_NEUTRAL;
  if (vertical < -deadZone || gamepadButtonPressed(buttons[12])) state &= ~0x01;
  if (vertical > deadZone || gamepadButtonPressed(buttons[13])) state &= ~0x02;
  if (horizontal < -deadZone || gamepadButtonPressed(buttons[14])) state &= ~0x04;
  if (horizontal > deadZone || gamepadButtonPressed(buttons[15])) state &= ~0x08;
  const aPressed = gamepadButtonPressed(buttons[buttonA]);
  const bPressed = gamepadButtonPressed(buttons[buttonB]);
  let anyActionPressed = false;
  for (let index = 0; index < buttons.length; ++index) {
    const standardDirection = gamepad.mapping === 'standard' && index >= 12 && index <= 15;
    if (!standardDirection && gamepadButtonPressed(buttons[index])) {
      anyActionPressed = true;
      break;
    }
  }
  if (oneButton ? anyActionPressed : aPressed) state &= ~0x10;
  if (!oneButton && bPressed) state &= ~0x20;
  return state;
}

export function forcedKeyCodeForJoystick(activeLowState, buttonA = 0x20, buttonB = 0x20) {
  if (!Number.isInteger(activeLowState) || activeLowState < 0 || activeLowState > 255 ||
      !Number.isInteger(buttonA) || buttonA < 0 || buttonA > 255 ||
      !Number.isInteger(buttonB) || buttonB < 0 || buttonB > 255) return null;
  let code = null;
  if ((activeLowState & 0x10) === 0) code = buttonA;
  if ((activeLowState & 0x20) === 0) code = buttonB;
  if ((activeLowState & 0x04) === 0) code = 0x1d;
  if ((activeLowState & 0x08) === 0) code = 0x1c;
  if ((activeLowState & 0x01) === 0) code = 0x1e;
  if ((activeLowState & 0x02) === 0) code = 0x1f;
  return code;
}

function defaultGamepadGetter() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  return () => navigator.getGamepads();
}

function gamepadIndex(gamepad, fallback) {
  return Number.isInteger(gamepad?.index) && gamepad.index >= 0 ? gamepad.index : fallback;
}

export class GamepadController {
  constructor({setJoystick, getGamepads, getMapping = () => ({}), onChange = () => {}} = {}) {
    if (typeof setJoystick !== 'function') throw new TypeError('setJoystick callback is required');
    if (getGamepads !== undefined && typeof getGamepads !== 'function') {
      throw new TypeError('getGamepads must be a function');
    }
    if (typeof getMapping !== 'function') throw new TypeError('getMapping must be a function');
    this.setJoystick = setJoystick;
    this.getGamepads = getGamepads ?? defaultGamepadGetter();
    this.getMapping = getMapping;
    this.onChange = onChange;
    this.assignments = [null, null];
    this.lastStates = [null, null];
    this.ports = [null, null];
    this.suspended = false;
    this.error = '';
    this.lastNotification = '';
  }

  snapshot() {
    return Object.freeze({
      supported: this.getGamepads !== null,
      suspended: this.suspended,
      error: this.error,
      ports: Object.freeze(this.ports.map(port => port ? Object.freeze({...port}) : null)),
    });
  }

  update({force = false} = {}) {
    if (this.getGamepads === null) {
      this.error = '';
      this.notify();
      return this.snapshot();
    }
    if (this.suspended) {
      this.neutralize(force);
      this.notify();
      return this.snapshot();
    }

    let rawGamepads;
    try {
      rawGamepads = this.getGamepads();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.assignments = [null, null];
      this.ports = [null, null];
      this.neutralize(force);
      this.notify();
      return this.snapshot();
    }

    this.error = '';
    const connected = Array.from(rawGamepads ?? [])
      .map((gamepad, fallback) => ({gamepad, index: gamepadIndex(gamepad, fallback)}))
      .filter(entry => entry.gamepad && entry.gamepad.connected !== false)
      .sort((left, right) => left.index - right.index);
    const byIndex = new Map(connected.map(entry => [entry.index, entry.gamepad]));
    for (let player = 0; player < this.assignments.length; ++player) {
      if (!byIndex.has(this.assignments[player])) this.assignments[player] = null;
    }
    // Browsers may retain a non-zero Gamepad index after reconnecting a device.
    // Keep a single connected controller usable as 1P regardless of that index.
    if (connected.length === 1) {
      this.assignments[0] = connected[0].index;
      this.assignments[1] = null;
    }
    const assigned = new Set(this.assignments.filter(index => index !== null));
    for (const entry of connected) {
      if (assigned.has(entry.index)) continue;
      const player = this.assignments.indexOf(null);
      if (player < 0) break;
      this.assignments[player] = entry.index;
      assigned.add(entry.index);
    }

    for (let player = 0; player < this.assignments.length; ++player) {
      const index = this.assignments[player];
      const gamepad = index === null ? null : byIndex.get(index) ?? null;
      const state = gamepad
        ? joystickStateForGamepad(gamepad, this.getMapping(player) ?? {})
        : JOYSTICK_NEUTRAL;
      this.writeState(player, state, force);
      this.ports[player] = gamepad ? {
        index,
        id: String(gamepad.id || `Gamepad ${index}`),
        mapping: gamepad.mapping === 'standard' ? 'standard' : 'generic',
        state,
      } : null;
    }
    this.notify();
    return this.snapshot();
  }

  suspend() {
    if (this.suspended) return this.snapshot();
    this.suspended = true;
    this.neutralize(true);
    this.notify();
    return this.snapshot();
  }

  resume() {
    if (!this.suspended) return this.update();
    this.suspended = false;
    this.lastStates = [null, null];
    return this.update({force: true});
  }

  resync() {
    this.lastStates = [null, null];
    return this.update({force: true});
  }

  neutralize(force = false) {
    for (let player = 0; player < this.lastStates.length; ++player) {
      this.writeState(player, JOYSTICK_NEUTRAL, force);
      if (this.ports[player]) this.ports[player] = {...this.ports[player], state: JOYSTICK_NEUTRAL};
    }
  }

  writeState(player, state, force) {
    if (!force && this.lastStates[player] === state) return;
    try {
      this.setJoystick(player, state);
      this.lastStates[player] = state;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.lastStates[player] = null;
    }
  }

  notify() {
    const snapshot = this.snapshot();
    const token = JSON.stringify(snapshot);
    if (token === this.lastNotification) return;
    this.lastNotification = token;
    this.onChange(snapshot);
  }
}

export class InputController {
  constructor({
    sendCode,
    pulseNmi,
    onChange = () => {},
    minimumHoldMs = 45,
    macroHoldMs = minimumHoldMs,
    macroGapMs = 10,
  } = {}) {
    if (typeof sendCode !== 'function' || typeof pulseNmi !== 'function') {
      throw new TypeError('sendCode and pulseNmi callbacks are required');
    }
    this.sendCode = sendCode;
    this.pulseNmi = pulseNmi;
    this.onChange = onChange;
    this.minimumHoldMs = minimumHoldMs;
    this.macroHoldMs = macroHoldMs;
    this.macroGapMs = macroGapMs;
    this.mode = INPUT_MODES.ANK;
    this.latched = {shift: false, ctrl: false};
    this.sources = new Map();
    this.codeOwners = new Map();
    this.modifierOwners = {shift: new Set(), ctrl: new Set()};
    this.pendingTimers = new Map();
    this.macroQueue = [];
    this.macroActiveCode = null;
    this.macroTimer = null;
    this.macroOwner = Symbol('macro');
  }

  snapshot() {
    const pressedKeyIds = new Set(Array.from(this.sources.values(), entry => entry.keyId));
    return Object.freeze({
      mode: this.mode,
      shift: this.latched.shift || this.modifierOwners.shift.size > 0,
      ctrl: this.latched.ctrl || this.modifierOwners.ctrl.size > 0,
      latchedShift: this.latched.shift,
      latchedCtrl: this.latched.ctrl,
      macroActive: this.macroActiveCode !== null || this.macroQueue.length > 0,
      pressedKeyIds,
    });
  }

  press(keyId, source, {minimumHold = false, ctrlBasicMode = false} = {}) {
    if (!keyId || !source || this.sources.has(source)) return null;
    const state = {...this.snapshot(), ctrlBasicMode};
    const resolved = resolveKey(keyId, state);
    if (!resolved) return null;
    if (state.macroActive && resolved.kind !== 'modifier') return null;
    const entry = {keyId, resolved, pressedAt: performance.now(), minimumHold};
    this.sources.set(source, entry);
    if (resolved.kind === 'modifier') {
      this.modifierOwners[resolved.modifier].add(source);
    } else if (resolved.kind === 'nmi') {
      this.mode = resolved.mode;
      this.pulseNmi();
    } else if (resolved.kind === 'macro') {
      this.startMacro(resolved.codes);
    } else {
      if (resolved.kind === 'mode') this.mode = resolved.mode;
      this.claimCode(resolved.code, source);
    }
    this.notify();
    return resolved;
  }

  pressCode(code, source, {minimumHold = false, keyId = null} = {}) {
    if (!Number.isInteger(code) || code < 0 || code > 255 || !source ||
        this.sources.has(source) || this.snapshot().macroActive) return null;
    const resolved = Object.freeze({kind: 'code', code});
    const entry = {
      keyId: keyId ?? `Direct${code.toString(16).padStart(2, '0')}`,
      resolved,
      pressedAt: performance.now(),
      minimumHold,
    };
    this.sources.set(source, entry);
    this.claimCode(code, source);
    this.notify();
    return resolved;
  }

  startMacro(codes) {
    this.cancelMacro();
    this.macroQueue = Array.from(codes);
    this.advanceMacro();
  }

  advanceMacro() {
    const code = this.macroQueue.shift();
    if (!Number.isInteger(code)) {
      this.macroTimer = null;
      return;
    }
    this.macroActiveCode = code;
    this.claimCode(code, this.macroOwner);
    this.macroTimer = setTimeout(() => {
      this.releaseCode(code, this.macroOwner);
      this.macroActiveCode = null;
      if (this.macroQueue.length === 0) {
        this.macroTimer = null;
        this.notify();
        return;
      }
      this.macroTimer = setTimeout(() => this.advanceMacro(), this.macroGapMs);
    }, this.macroHoldMs);
  }

  cancelMacro() {
    if (this.macroTimer !== null) clearTimeout(this.macroTimer);
    this.macroTimer = null;
    this.macroQueue = [];
    if (this.macroActiveCode !== null) {
      this.releaseCode(this.macroActiveCode, this.macroOwner);
      this.macroActiveCode = null;
    }
  }

  claimCode(code, owner) {
    let owners = this.codeOwners.get(code);
    if (!owners) {
      owners = new Set();
      this.codeOwners.set(code, owners);
    }
    if (owners.size === 0) this.sendCode(code, true);
    owners.add(owner);
  }

  releaseCode(code, owner) {
    const owners = this.codeOwners.get(code);
    if (!owners?.delete(owner)) return;
    if (owners.size === 0) {
      this.codeOwners.delete(code);
      this.sendCode(code, false);
    }
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
      this.releaseCode(entry.resolved.code, source);
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

  clearLatch(modifier) {
    if ((modifier !== 'shift' && modifier !== 'ctrl') || !this.latched[modifier]) return false;
    this.latched[modifier] = false;
    this.notify();
    return true;
  }

  releaseAll({clearLatches = true} = {}) {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    this.cancelMacro();
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
