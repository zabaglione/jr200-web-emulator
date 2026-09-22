// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {
  INPUT_MODES,
  InputController,
  displayCodeFor,
  keyIdForKeyboardEvent,
  resolveKey,
} from '../web/keyboard.mjs';

const code = (keyId, state = {}) => resolveKey(keyId, state)?.code ?? null;

assert.equal(code('KeyA', {mode: INPUT_MODES.ANK}), 0x61);
assert.equal(code('KeyA', {mode: INPUT_MODES.ANK, shift: true}), 0x41);
assert.equal(code('Digit1', {mode: INPUT_MODES.ANK, shift: true}), 0x21);
assert.equal(code('At', {mode: INPUT_MODES.ANK, shift: true}), 0x60);
assert.equal(code('Underscore', {mode: INPUT_MODES.ANK}), null);
assert.equal(code('Underscore', {mode: INPUT_MODES.ANK, shift: true}), 0x5f);

assert.equal(code('Digit3', {mode: INPUT_MODES.KANA}), 0xb1);
assert.equal(code('Digit3', {mode: INPUT_MODES.KANA, shift: true}), 0xa7);
assert.equal(code('KeyZ', {mode: INPUT_MODES.KANA}), 0xc2);
assert.equal(code('KeyZ', {mode: INPUT_MODES.KANA, shift: true}), 0xaf);
assert.equal(code('LeftBracket', {mode: INPUT_MODES.KANA, shift: true}), 0xa2);
assert.equal(code('Yen', {mode: INPUT_MODES.KANA}), 0xb0);

assert.equal(code('Digit1', {mode: INPUT_MODES.GRAPH}), 0x81);
assert.equal(code('KeyA', {mode: INPUT_MODES.GRAPH}), 0x91);
assert.equal(code('KeyA', {mode: INPUT_MODES.GRAPH, shift: true}), 0xf1);
assert.equal(code('KeyI', {mode: INPUT_MODES.GRAPH, shift: true}), 0xfe);
assert.equal(code('KeyM', {mode: INPUT_MODES.GRAPH, shift: true}), 0x8b);

assert.equal(code('Home', {mode: INPUT_MODES.GRAPH}), 0x0b);
assert.equal(code('Home', {mode: INPUT_MODES.GRAPH, shift: true}), 0x0c);
assert.equal(code('ArrowLeft', {mode: INPUT_MODES.ANK}), 0x1d);
assert.equal(code('ArrowRight', {mode: INPUT_MODES.KANA}), 0x1c);
assert.equal(code('Insert', {mode: INPUT_MODES.GRAPH}), 0x13);
assert.equal(code('Delete', {mode: INPUT_MODES.ANK}), 0x7f);
assert.equal(code('KeyC', {mode: INPUT_MODES.KANA, ctrl: true}), 0x03);
assert.equal(code('LeftBracket', {mode: INPUT_MODES.GRAPH, ctrl: true}), 0x1b);
assert.deepEqual(resolveKey('ModeKana'), {kind: 'mode', mode: INPUT_MODES.KANA, code: 0xa0});
assert.deepEqual(resolveKey('Break'), {kind: 'nmi', mode: INPUT_MODES.ANK});

for (const mode of Object.values(INPUT_MODES)) {
  for (const shift of [false, true]) {
    for (const keyId of ['KeyA', 'Digit3', 'Home', 'Space', 'ModeGraph']) {
      assert.equal(displayCodeFor(keyId, {mode, shift}), code(keyId, {mode, shift}));
    }
  }
}

assert.equal(keyIdForKeyboardEvent({code: 'KeyQ'}), 'KeyQ');
assert.equal(keyIdForKeyboardEvent({code: 'PageUp'}), 'ModeGraph');
assert.equal(keyIdForKeyboardEvent({code: 'Convert'}), 'ModeGraph');
assert.equal(keyIdForKeyboardEvent({code: 'PageDown'}), 'ModeAnk');
assert.equal(keyIdForKeyboardEvent({code: 'NonConvert'}), 'ModeAnk');
assert.equal(keyIdForKeyboardEvent({code: 'KanaMode'}), 'ModeKana');
assert.equal(keyIdForKeyboardEvent({code: 'End'}), 'ModeKana');
assert.equal(keyIdForKeyboardEvent({code: 'BracketLeft'}), 'At');
assert.equal(keyIdForKeyboardEvent({code: 'BracketRight'}), 'LeftBracket');
assert.equal(keyIdForKeyboardEvent({code: 'Quote'}), 'Colon');
assert.equal(keyIdForKeyboardEvent({code: 'Backslash'}), 'Yen');
assert.equal(keyIdForKeyboardEvent({code: 'IntlYen'}), 'Yen');
assert.equal(keyIdForKeyboardEvent({code: 'IntlBackslash'}), 'Underscore');
assert.equal(keyIdForKeyboardEvent({code: 'F7'}), 'RightBracket');
assert.equal(keyIdForKeyboardEvent({code: 'F8'}), 'Underscore');
assert.equal(keyIdForKeyboardEvent({code: 'MetaLeft'}), null);

const sent = [];
let nmiCount = 0;
const controller = new InputController({
  sendCode: (value, pressed) => sent.push([value, pressed]),
  pulseNmi: () => { ++nmiCount; },
  minimumHoldMs: 15,
});

controller.press('ModeKana', 'keyboard:mode');
assert.equal(controller.snapshot().mode, INPUT_MODES.KANA);
controller.release('keyboard:mode', {immediate: true});
controller.press('ModifierShift', 'keyboard:shift');
controller.press('Digit3', 'pointer:1');
assert.deepEqual(sent.slice(-1), [[0xa7, true]]);
controller.release('keyboard:shift', {immediate: true});
controller.release('pointer:1', {immediate: true});
assert.deepEqual(sent.slice(-1), [[0xa7, false]]);

controller.toggleLatch('shift');
controller.press('KeyZ', 'keyboard:z');
assert.deepEqual(sent.slice(-1), [[0xaf, true]]);
controller.press('KeyZ', 'pointer:2');
assert.equal(sent.filter(([value, pressed]) => value === 0xaf && pressed).length, 1);
controller.release('keyboard:z', {immediate: true});
assert.notDeepEqual(sent.slice(-1), [[0xaf, false]]);
controller.release('pointer:2', {immediate: true});
assert.deepEqual(sent.slice(-1), [[0xaf, false]]);

controller.toggleLatch('shift');
controller.press('KeyX', 'pointer:3');
controller.press('KeyX', 'pointer:4');
assert.equal(sent.filter(([value, pressed]) => value === 0xbb && pressed).length, 1);
controller.release('pointer:3', {immediate: true});
assert.notDeepEqual(sent.slice(-1), [[0xbb, false]]);
controller.release('pointer:4', {immediate: true});
assert.deepEqual(sent.slice(-1), [[0xbb, false]]);

controller.press('ModeGraph', 'keyboard:graph');
controller.release('keyboard:graph', {immediate: true});
controller.toggleLatch('shift');
controller.press('KeyA', 'keyboard:held');
assert.deepEqual(sent.slice(-1), [[0xf1, true]]);
controller.press('ModeAnk', 'pointer:mode');
assert.equal(controller.snapshot().mode, INPUT_MODES.ANK);
controller.release('keyboard:held', {immediate: true});
assert.deepEqual(sent.slice(-1), [[0xf1, false]]);
controller.release('pointer:mode', {immediate: true});

controller.press('Break', 'keyboard:break');
assert.equal(nmiCount, 1);
assert.equal(controller.snapshot().mode, INPUT_MODES.ANK);
controller.release('keyboard:break', {immediate: true});

controller.toggleLatch('shift');
controller.press('KeyB', 'pointer:fast', {minimumHold: true});
controller.release('pointer:fast');
assert.deepEqual(sent.slice(-1), [[0x62, true]]);
await new Promise(resolve => setTimeout(resolve, 25));
assert.deepEqual(sent.slice(-1), [[0x62, false]]);

controller.press('KeyC', 'keyboard:c');
controller.toggleLatch('ctrl');
controller.releaseAll();
assert.equal(controller.snapshot().pressedKeyIds.size, 0);
assert.equal(controller.snapshot().latchedShift, false);
assert.equal(controller.snapshot().latchedCtrl, false);

console.log('PASS keyboard resolver: ANK, KANA, GRAPH, modifiers, modes, ownership and minimum hold');
