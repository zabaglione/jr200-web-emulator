// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {
  CONTROL_KEYS,
  INPUT_MODES,
  KEY_ROWS,
  GamepadController,
  InputController,
  JOYSTICK_NEUTRAL,
  RomajiKanaConverter,
  displayCodeFor,
  encodeJrText,
  forcedKeyCodeForJoystick,
  joystickStateForGamepad,
  keyIdForKeyboardEvent,
  resolveKey,
} from '../web/keyboard.mjs';

assert.deepEqual(Array.from(encodeJrText('A\\¥￥\r\nﾝ')), [0x41,0x5c,0x5c,0x5c,0x0d,0xdd]);
assert.deepEqual(Array.from(encodeJrText('RUN\\r', {interpretEscapes:true})), [0x52,0x55,0x4e,0x0d]);
assert.deepEqual(Array.from(encodeJrText('A\\\\B', {interpretEscapes:true})), [0x41,0x5c,0x42]);
assert.throws(()=>encodeJrText('漢'),/位置1/);
assert.throws(()=>encodeJrText('AB',{maximumBytes:1}),/1バイト/);

const romaji = new RomajiKanaConverter();
assert.deepEqual(Array.from(romaji.feed('a')), [0xb1]);
assert.deepEqual(Array.from(romaji.feed('k')), []);
assert.equal(romaji.pending, 'K');
assert.deepEqual(Array.from(romaji.feed('a')), [0xb6]);
assert.deepEqual(Array.from(romaji.feed('k')), []);
assert.deepEqual(Array.from(romaji.feed('y')), []);
assert.deepEqual(Array.from(romaji.feed('u')), [0xb7,0xad]);
assert.deepEqual(Array.from(romaji.feed('n')), []);
assert.deepEqual(Array.from(romaji.feed('n')), [0xdd]);
assert.deepEqual(Array.from(romaji.feed('k')), []);
assert.deepEqual(Array.from(romaji.feed('k')), [0xaf]);
assert.equal(romaji.pending, 'K');
assert.deepEqual(Array.from(romaji.feed('a')), [0xb6]);
for (const [letters, expected] of [
  ['XTU', [0xaf]],
  ['LTU', [0xaf]],
  ['TSU', [0xc2]],
]) {
  const converter = new RomajiKanaConverter();
  const emitted = [];
  for (const letter of letters) emitted.push(...converter.feed(letter));
  assert.deepEqual(emitted, expected, letters);
}
assert.deepEqual(Array.from(romaji.feed('s')), []);
assert.deepEqual(Array.from(romaji.feed('h')), []);
assert.equal(romaji.backspace(), true);
assert.equal(romaji.pending, 'S');
romaji.reset();
assert.equal(romaji.backspace(), false);

assert.deepEqual(CONTROL_KEYS.map(key => [key.id, key.area]), [
  ['Break', 'break'],
  ['Insert', 'insert'],
  ['Delete', 'delete'],
  ['ArrowUp', 'up'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['ArrowDown', 'down'],
]);
const mainKeyIds = KEY_ROWS.flat().filter(key => key.kind === 'key').map(key => key.id);
assert.equal(CONTROL_KEYS.every(key => !mainKeyIds.includes(key.id)), true);

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
assert.equal(code('Digit1', {mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: true}), 0x0c);
assert.equal(code('KeyC', {mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: true}), 0x03);
assert.equal(code('KeyA', {mode: INPUT_MODES.KANA, ctrl: true, ctrlBasicMode: true}), 0xc1);
assert.deepEqual(
  resolveKey('KeyA', {mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: true}),
  {kind: 'macro', codes: [0x41, 0x55, 0x54, 0x4f, 0x20], displayCode: 0x61},
);
assert.deepEqual(
  resolveKey('Digit3', {mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: true}),
  {kind: 'macro', codes: [0x53, 0x41, 0x56, 0x45, 0x20], displayCode: 0x33},
);
assert.equal(code('KeyA', {
  mode: INPUT_MODES.ANK, ctrl: true, shift: true, ctrlBasicMode: true,
}), 0x01);
assert.equal(code('Digit3', {
  mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: false,
}), 0x33);
assert.equal(displayCodeFor('KeyA', {
  mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: true,
}), 0x61);
assert.deepEqual(
  resolveKey('Underscore', {mode: INPUT_MODES.ANK, ctrl: true, ctrlBasicMode: true}),
  {kind: 'macro', codes: [0x50, 0x49, 0x43, 0x4b, 0x20], displayCode: 0x5f},
);
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
assert.equal(keyIdForKeyboardEvent({code: 'Backslash', key: '\\'}), 'Yen');
assert.equal(keyIdForKeyboardEvent({code: 'Backslash', key: '|'}), 'Yen');
assert.equal(keyIdForKeyboardEvent({code: 'Backslash', key: ']'}), 'RightBracket');
assert.equal(keyIdForKeyboardEvent({code: 'Backslash', key: '}'}), 'RightBracket');
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
assert.deepEqual(controller.pressCode(0x5a,'direct:test'),{kind:'code',code:0x5a});
assert.deepEqual(sent.slice(-1),[[0x5a,true]]);
controller.release('direct:test',{immediate:true});
assert.deepEqual(sent.slice(-1),[[0x5a,false]]);
assert.equal(controller.pressCode(256,'direct:invalid'),null);

const macroSent = [];
const macroController = new InputController({
  sendCode: (value, pressed) => macroSent.push([value, pressed]),
  pulseNmi: () => {},
  minimumHoldMs: 3,
  macroHoldMs: 3,
  macroGapMs: 1,
});
macroController.toggleLatch('ctrl');
const macroResolved = macroController.press('KeyA', 'keyboard:a', {ctrlBasicMode: true});
assert.equal(macroResolved.kind, 'macro');
assert.equal(macroController.snapshot().macroActive, true);
macroController.clearLatch('ctrl');
macroController.release('keyboard:a', {immediate: true});
await new Promise(resolve => setTimeout(resolve, 35));
assert.deepEqual(macroSent, [
  [0x41, true], [0x41, false],
  [0x55, true], [0x55, false],
  [0x54, true], [0x54, false],
  [0x4f, true], [0x4f, false],
  [0x20, true], [0x20, false],
]);
assert.equal(macroController.snapshot().macroActive, false);
assert.equal(macroController.snapshot().latchedCtrl, false);

macroController.press('Space', 'pointer:space');
macroController.toggleLatch('ctrl');
macroController.press('KeyA', 'keyboard:a', {ctrlBasicMode: true});
macroController.clearLatch('ctrl');
macroController.release('keyboard:a', {immediate: true});
await new Promise(resolve => setTimeout(resolve, 35));
assert.equal(macroController.snapshot().pressedKeyIds.has('Space'), true);
assert.equal(macroSent.at(-1)[0], 0x4f);
assert.deepEqual(macroSent.filter(([value]) => value === 0x20).slice(-1), [[0x20, true]]);
macroController.release('pointer:space', {immediate: true});
assert.deepEqual(macroSent.filter(([value]) => value === 0x20).slice(-2), [
  [0x20, true], [0x20, false],
]);

macroController.toggleLatch('ctrl');
macroController.press('Digit5', 'keyboard:5', {ctrlBasicMode: true});
await new Promise(resolve => setTimeout(resolve, 1));
macroController.releaseAll();
const cancelledLength = macroSent.length;
await new Promise(resolve => setTimeout(resolve, 15));
assert.equal(macroSent.length, cancelledLength);
assert.equal(macroController.snapshot().macroActive, false);

const button = pressed => ({pressed, value: pressed ? 1 : 0});
const gamepad = ({index, id, axes = [0, 0], pressed = [], mapping = 'standard'}) => ({
  index,
  id,
  axes,
  mapping,
  connected: true,
  buttons: Array.from({length: 16}, (_, buttonIndex) => button(pressed.includes(buttonIndex))),
});
const padOne = gamepad({index: 0, id: 'Pad One', axes: [-1, -1], pressed: [0]});
const padTwo = gamepad({index: 1, id: 'Pad Two', pressed: [1, 13, 15]});
assert.equal(joystickStateForGamepad(null), JOYSTICK_NEUTRAL);
assert.equal(joystickStateForGamepad(gamepad({index: 0, id: 'Neutral'})), 0xff);
assert.equal(joystickStateForGamepad(padOne), 0xea);
assert.equal(joystickStateForGamepad(padTwo), 0xd5);
assert.equal(joystickStateForGamepad(padTwo,{buttonA:1,buttonB:0}),0xe5);
assert.equal(joystickStateForGamepad(padTwo,{oneButton:true}),0xe5);
assert.equal(joystickStateForGamepad(
  gamepad({index:0,id:'Extra button',pressed:[2]}), {oneButton:true}), 0xef);
assert.equal(joystickStateForGamepad(
  gamepad({index:0,id:'Extra button',pressed:[2]})), 0xff);
assert.equal(joystickStateForGamepad(gamepad({index: 0, id: 'Dead zone', axes: [0.4, -0.4]})), 0xff);
assert.equal(joystickStateForGamepad(gamepad({index: 0, id: 'Past dead zone', axes: [0.41, -0.41]})), 0xf6);
assert.equal(forcedKeyCodeForJoystick(0xff),null);
assert.equal(forcedKeyCodeForJoystick(0xef,0x41,0x42),0x41);
assert.equal(forcedKeyCodeForJoystick(0xcf,0x41,0x42),0x42);
assert.equal(forcedKeyCodeForJoystick(0xc8,0x41,0x42),0x1f);

let gamepads = [padOne, padTwo];
const joystickWrites = [];
const gamepadController = new GamepadController({
  getGamepads: () => gamepads,
  setJoystick: (player, state) => joystickWrites.push([player, state]),
});
let gamepadSnapshot = gamepadController.update();
assert.deepEqual(gamepadSnapshot.ports.map(port => port?.id), ['Pad One', 'Pad Two']);
assert.deepEqual(joystickWrites, [[0, 0xea], [1, 0xd5]]);

gamepads = [null, padTwo];
gamepadSnapshot = gamepadController.update();
assert.deepEqual(gamepadSnapshot.ports.map(port => port?.id ?? null), ['Pad Two', null]);
assert.deepEqual(joystickWrites.slice(-2), [[0, 0xd5], [1, 0xff]]);

const padThree = gamepad({index: 2, id: 'Pad Three', axes: [1, 0]});
gamepads = [null, padTwo, padThree];
gamepadSnapshot = gamepadController.update();
assert.deepEqual(gamepadSnapshot.ports.map(port => port?.id), ['Pad Two', 'Pad Three']);
assert.deepEqual(joystickWrites.slice(-1), [[1, 0xf7]]);

gamepads = [null, null, null];
gamepadSnapshot = gamepadController.update();
assert.deepEqual(gamepadSnapshot.ports.map(port => port?.id ?? null), [null, null]);
assert.deepEqual(joystickWrites.slice(-2), [[0, 0xff], [1, 0xff]]);

gamepads = [null, padTwo];
gamepadSnapshot = gamepadController.update();
assert.deepEqual(gamepadSnapshot.ports.map(port => port?.id ?? null), ['Pad Two', null]);
assert.deepEqual(joystickWrites.slice(-1), [[0, 0xd5]]);

gamepadController.suspend();
assert.equal(gamepadController.snapshot().suspended, true);
assert.deepEqual(joystickWrites.slice(-2), [[0, 0xff], [1, 0xff]]);
const writesWhileSuspended = joystickWrites.length;
gamepadController.update();
assert.equal(joystickWrites.length, writesWhileSuspended);
gamepadController.resume();
assert.deepEqual(joystickWrites.slice(-2), [[0, 0xd5], [1, 0xff]]);
const writesBeforeResync = joystickWrites.length;
gamepadController.resync();
assert.equal(joystickWrites.length, writesBeforeResync + 2);

console.log('PASS input controllers: keyboard resolver, gamepad mapping, 1P promotion, suspend and resync');
