// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {WebAudioOutput} from '../web/audio.mjs';

class FakeGain {
  constructor() {
    this.gain = {
      value: 1,
      setValueAtTime: value => { this.gain.value = value; },
    };
  }
  connect() {}
}

class FakeBuffer {
  constructor(length, sampleRate) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = new Float32Array(length);
  }
  getChannelData(channel) {
    assert.equal(channel, 0);
    return this.data;
  }
}

class FakeSource {
  constructor(context) {
    this.context = context;
    this.buffer = null;
    this.onended = null;
    this.stopped = false;
    this.playbackRate = {
      value: 1,
      setValueAtTime: value => { this.playbackRate.value = value; },
    };
  }
  connect() {}
  disconnect() {}
  start(time) {
    this.startTime = time;
    this.context.sources.push(this);
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}

class FakeAudioContext {
  static created = 0;
  constructor() {
    ++FakeAudioContext.created;
    this.state = 'suspended';
    this.sampleRate = 48000;
    this.currentTime = 1;
    this.destination = {};
    this.sources = [];
    this.listeners = [];
  }
  createGain() {
    this.gain = new FakeGain();
    return this.gain;
  }
  createBuffer(_channels, length, sampleRate) {
    return new FakeBuffer(length, sampleRate);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  addEventListener(name, listener) {
    if (name === 'statechange') this.listeners.push(listener);
  }
  async resume() {
    this.state = 'running';
    for (const listener of this.listeners) listener();
  }
  async suspend() {
    this.state = 'suspended';
    for (const listener of this.listeners) listener();
  }
}

class DeferredResumeAudioContext extends FakeAudioContext {
  async resume() {
    await new Promise(resolve => {
      this.finishResume = () => {
        this.state = 'running';
        for (const listener of this.listeners) listener();
        resolve();
      };
    });
  }
}

class FakeMachineAudio {
  constructor() {
    this.sampleRate = 44100;
    this.capacity = 4096;
    this.samples = [];
    this.dropped = 0;
  }
  drain(maximum) {
    return Int16Array.from(this.samples.splice(0, maximum));
  }
  discard() {
    const count = this.samples.length;
    this.samples.length = 0;
    return count;
  }
  state() {
    return {
      available: this.samples.length,
      capacity: this.capacity,
      sampleRate: this.sampleRate,
      dropped: this.dropped,
    };
  }
}

const machine = new FakeMachineAudio();
const output = new WebAudioOutput(machine, {
  AudioContextClass: FakeAudioContext,
  initialVolume: 0.2,
  leadSeconds: 0.04,
  lateMarginSeconds: 0.005,
});

assert.equal(FakeAudioContext.created, 0, 'construction must not claim an audio device');
machine.samples.push(1, 2, 3);
assert.equal(output.pump(), 0);
assert.equal(output.state().discardedFrames, 3);
assert.equal(FakeAudioContext.created, 0, 'PCM is discarded until explicit enable');

await output.enable();
assert.equal(FakeAudioContext.created, 1);
assert.equal(output.state().contextState, 'running');
assert.equal(output.context.gain.gain.value, 0.2);

machine.samples.push(32767, -32768, 7000);
assert.equal(output.pump(), 3);
assert.equal(output.context.sources.length, 1);
assert.equal(output.context.sources[0].startTime, 1.04);
assert.equal(output.context.sources[0].buffer.sampleRate, 44100);
assert.equal(output.context.sources[0].playbackRate.value, 1);
assert.ok(Math.abs(output.context.sources[0].buffer.data[0] - 32767 / 32768) < 1e-7);
assert.equal(output.context.sources[0].buffer.data[1], -1);
assert.equal(output.state().nonzeroFrames, 3);
assert.equal(output.state().peakSample, 32768);

output.context.currentTime = 1.03;
machine.samples.push(1000, 2000);
assert.equal(output.pump(10), 2);
assert.equal(output.context.sources[1].playbackRate.value, 10);
assert.ok(output.state().scheduledAheadSeconds < 0.011);

output.context.currentTime = 2;
machine.samples.push(1000);
assert.equal(output.pump(), 1);
assert.equal(output.state().underruns, 1);
assert.equal(output.context.sources[2].startTime, 2.04);

output.setMuted(true);
machine.samples.push(4, 5);
assert.equal(output.pump(), 0);
assert.equal(output.context.gain.gain.value, 0);
assert.equal(output.state().discardedFrames, 5);
output.setVolume(0.1);
output.setMuted(false);
assert.equal(output.context.gain.gain.value, 0.1);
assert.throws(() => output.setVolume(0.51), /between 0 and 0.5/);
assert.throws(() => output.pump(0), /positive/);

machine.samples.push(6, 7);
await output.suspend();
assert.equal(output.state().contextState, 'suspended');
assert.equal(output.state().activeSources, 0);
assert.equal(output.state().queueAvailable, 0);
await output.resume();
assert.equal(output.state().contextState, 'running');
await Promise.all([output.suspend(), output.resume()]);
assert.equal(output.state().contextState, 'running');
await output.disable();
assert.equal(output.state().enabled, false);
assert.equal(output.state().contextState, 'suspended');
assert.equal(output.context.gain.gain.value, 0);

const armedMachine = new FakeMachineAudio();
const armed = new WebAudioOutput(armedMachine, {
  AudioContextClass: FakeAudioContext,
  initialEnabled: true,
});
assert.equal(armed.state().enabled, true);
assert.equal(armed.state().contextState, 'not-created');
assert.equal(FakeAudioContext.created, 1, 'armed output must wait for a user gesture');
await armed.enable();
assert.equal(FakeAudioContext.created, 2);
assert.equal(armed.state().contextState, 'running');
assert.throws(() => new WebAudioOutput(new FakeMachineAudio(), {
  AudioContextClass: FakeAudioContext,
  initialEnabled: 'yes',
}), /must be boolean/);

const racing = new WebAudioOutput(new FakeMachineAudio(), {
  AudioContextClass: DeferredResumeAudioContext,
  initialEnabled: true,
});
const enabling = racing.enable();
assert.equal(typeof racing.context.finishResume, 'function');
const disabling = racing.disable();
racing.context.finishResume();
await Promise.all([enabling, disabling]);
assert.equal(racing.state().enabled, false);
assert.equal(racing.state().contextState, 'suspended');

const boundedMachine = new FakeMachineAudio();
const bounded = new WebAudioOutput(boundedMachine, {
  AudioContextClass: FakeAudioContext,
  initialEnabled: true,
  leadSeconds: 0.04,
  maxAheadSeconds: 0.1,
});
await bounded.enable();
for (let index = 0; index < 100; ++index) {
  boundedMachine.samples.push(...new Int16Array(4096).fill(index + 1));
  bounded.pump(10);
}
assert.ok(bounded.state().scheduledAheadSeconds <= 0.100001);
assert.ok(bounded.state().activeSources < 10);
assert.ok(bounded.state().aheadDroppedFrames > 0);

console.log('PASS Web Audio scheduler: armed default, explicit start, rate tracking, bounded look-ahead, 44.1 kHz buffers, resampling context, underrun, mute, pause and queue flush');
