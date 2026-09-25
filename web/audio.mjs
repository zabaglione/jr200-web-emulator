// SPDX-License-Identifier: BSD-3-Clause

const DEFAULT_VOLUME = 0.2;
const DEFAULT_LEAD_SECONDS = 0.04;
const DEFAULT_LATE_MARGIN_SECONDS = 0.005;
const DEFAULT_MAX_AHEAD_SECONDS = 0.25;

export class WebAudioOutput {
  constructor(machineAudio, options = {}) {
    if (!machineAudio || typeof machineAudio.drain !== 'function' ||
        typeof machineAudio.discard !== 'function' ||
        typeof machineAudio.state !== 'function') {
      throw new Error('PCM source is unavailable');
    }
    this.machineAudio = machineAudio;
    this.AudioContextClass = options.AudioContextClass ??
      globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
    this.onChange = options.onChange ?? (() => {});
    this.volume = options.initialVolume ?? DEFAULT_VOLUME;
    const initialEnabled = options.initialEnabled ?? false;
    const initialMuted = options.initialMuted ?? false;
    const initialKeyClickEnabled = options.initialKeyClickEnabled ?? false;
    this.leadSeconds = options.leadSeconds ?? DEFAULT_LEAD_SECONDS;
    this.lateMarginSeconds = options.lateMarginSeconds ?? DEFAULT_LATE_MARGIN_SECONDS;
    this.maxAheadSeconds = options.maxAheadSeconds ?? DEFAULT_MAX_AHEAD_SECONDS;
    if (typeof initialEnabled !== 'boolean') {
      throw new Error('Initial enabled state must be boolean');
    }
    if (typeof initialMuted !== 'boolean') {
      throw new Error('Initial muted state must be boolean');
    }
    if (typeof initialKeyClickEnabled !== 'boolean') {
      throw new Error('Initial key click state must be boolean');
    }
    if (!Number.isFinite(this.volume) || this.volume < 0 || this.volume > 0.5) {
      throw new Error('Initial volume must be between 0 and 0.5');
    }
    if (!Number.isFinite(this.leadSeconds) || this.leadSeconds < 0 ||
        !Number.isFinite(this.lateMarginSeconds) || this.lateMarginSeconds < 0 ||
        !Number.isFinite(this.maxAheadSeconds) ||
        this.maxAheadSeconds < this.leadSeconds) {
      throw new Error('Audio timing values must be non-negative');
    }
    this.context = null;
    this.gain = null;
    this.enabled = initialEnabled;
    this.keyClickEnabled = initialKeyClickEnabled;
    this.desiredRunning = false;
    this.muted = initialMuted;
    this.nextStartTime = 0;
    this.activeSources = new Set();
    this.underruns = 0;
    this.scheduledFrames = 0;
    this.nonzeroFrames = 0;
    this.peakSample = 0;
    this.discardedFrames = 0;
    this.aheadDroppedFrames = 0;
    this.lastPlaybackRate = 1;
    this.lastError = '';
  }

  async enable() {
    if (!this.AudioContextClass) {
      throw new Error('Web Audio is not supported by this browser');
    }
    if (!this.context) {
      this.context = new this.AudioContextClass({latencyHint: 'interactive'});
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      const changed = () => this._notify();
      if (typeof this.context.addEventListener === 'function') {
        this.context.addEventListener('statechange', changed);
      } else {
        this.context.onstatechange = changed;
      }
    }
    this.enabled = true;
    this.desiredRunning = true;
    this.lastError = '';
    this._resetTimeline();
    this._discardPending();
    this._applyGain();
    try {
      if (this.context.state !== 'running') {
        await this.context.resume();
      }
      if ((!this.desiredRunning || !this.enabled) &&
          this.context.state !== 'suspended' && this.context.state !== 'closed') {
        await this.context.suspend();
      }
    } catch (error) {
      this.enabled = false;
      this.desiredRunning = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this._setGain(0);
      this._notify();
      throw error;
    }
    this._notify();
    return this.state();
  }

  async suspend() {
    this._silence();
    this.desiredRunning = false;
    if (this.context && this.context.state !== 'suspended' &&
        this.context.state !== 'closed') {
      try {
        await this.context.suspend();
        if (this.desiredRunning && this.enabled) {
          await this.context.resume();
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    this._notify();
    return this.state();
  }

  async resume() {
    if (!this.enabled || !this.context) {
      this._discardPending();
      return this.state();
    }
    this.desiredRunning = true;
    this._resetTimeline();
    this._discardPending();
    this._applyGain();
    try {
      if (this.context.state !== 'running') {
        await this.context.resume();
      }
      if (!this.desiredRunning || !this.enabled) {
        await this.context.suspend();
      }
      this.lastError = '';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this._setGain(0);
      throw error;
    } finally {
      this._notify();
    }
    return this.state();
  }

  async disable() {
    this.enabled = false;
    this.desiredRunning = false;
    await this.suspend();
    return this.state();
  }

  flush() {
    this._silence();
    if (this.enabled && this.context?.state === 'running') {
      this._applyGain();
    }
    this._notify();
    return this.state();
  }

  setMuted(muted) {
    if (typeof muted !== 'boolean') {
      throw new Error('Muted state must be boolean');
    }
    this.muted = muted;
    if (muted) {
      this._silence();
    } else {
      this._resetTimeline();
      this._discardPending();
      this._applyGain();
    }
    this._notify();
    return this.state();
  }

  setVolume(volume) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 0.5) {
      throw new Error('Volume must be between 0 and 0.5');
    }
    this.volume = volume;
    this._applyGain();
    this._notify();
    return this.state();
  }

  setKeyClickEnabled(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new Error('Key click state must be boolean');
    }
    if (this.keyClickEnabled === enabled) return this.state();
    this.keyClickEnabled = enabled;
    return this.flush();
  }

  pump(playbackRate = 1) {
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
      throw new Error('Playback rate must be positive');
    }
    this.lastPlaybackRate = playbackRate;
    if (!this.enabled || !this.context || this.context.state !== 'running' ||
        this.muted) {
      this._resetTimeline();
      this._discardPending();
      return 0;
    }

    const pcm = this.machineAudio.drain(this.machineAudio.capacity, this.keyClickEnabled);
    if (pcm.length === 0) {
      if (this.nextStartTime !== 0 &&
          this.nextStartTime < this.context.currentTime + this.lateMarginSeconds) {
        ++this.underruns;
        this.nextStartTime = 0;
        this._notify();
      }
      return 0;
    }

    let source = null;
    let scheduledLength = pcm.length;
    try {
      const earliest = this.context.currentTime + this.leadSeconds;
      if (this.nextStartTime === 0) {
        this.nextStartTime = earliest;
      } else if (this.nextStartTime <
          this.context.currentTime + this.lateMarginSeconds) {
        ++this.underruns;
        this.nextStartTime = earliest;
      }
      const scheduledAhead = Math.max(0, this.nextStartTime - this.context.currentTime);
      const availableSeconds = Math.max(0, this.maxAheadSeconds - scheduledAhead);
      scheduledLength = Math.min(
        pcm.length,
        Math.floor(availableSeconds * this.machineAudio.sampleRate * playbackRate),
      );
      if (scheduledLength === 0) {
        this.discardedFrames += pcm.length;
        this.aheadDroppedFrames += pcm.length;
        return 0;
      }
      const aheadDropped = pcm.length - scheduledLength;
      this.discardedFrames += aheadDropped;
      this.aheadDroppedFrames += aheadDropped;
      const buffer = this.context.createBuffer(
        1,
        scheduledLength,
        this.machineAudio.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < scheduledLength; ++i) {
        channel[i] = pcm[i] / 32768;
        if (pcm[i] !== 0) ++this.nonzeroFrames;
        this.peakSample = Math.max(this.peakSample, Math.abs(pcm[i]));
      }
      source = this.context.createBufferSource();
      source.buffer = buffer;
      if (typeof source.playbackRate?.setValueAtTime === 'function') {
        source.playbackRate.setValueAtTime(playbackRate, this.nextStartTime);
      } else if (source.playbackRate) {
        source.playbackRate.value = playbackRate;
      }
      source.connect(this.gain);
      this.activeSources.add(source);
      source.onended = () => this.activeSources.delete(source);
      source.start(this.nextStartTime);
      this.nextStartTime += scheduledLength / this.machineAudio.sampleRate / playbackRate;
      this.scheduledFrames += scheduledLength;
      return scheduledLength;
    } catch (error) {
      if (source) {
        this.activeSources.delete(source);
        try {
          source.disconnect();
        } catch {
          // A source that failed before connection has nothing to disconnect.
        }
      }
      this.discardedFrames += scheduledLength;
      this.lastError = error instanceof Error ? error.message : String(error);
      this._resetTimeline();
      this._notify();
      return 0;
    }
  }

  state() {
    const core = this.machineAudio.state();
    return {
      supported: Boolean(this.AudioContextClass),
      enabled: this.enabled,
      keyClickEnabled: this.keyClickEnabled,
      muted: this.muted,
      volume: this.volume,
      contextState: this.context?.state ?? 'not-created',
      deviceSampleRate: this.context?.sampleRate ?? 0,
      coreSampleRate: this.machineAudio.sampleRate,
      queueAvailable: core.available,
      queueCapacity: core.capacity,
      coreDropped: core.dropped,
      underruns: this.underruns,
      scheduledFrames: this.scheduledFrames,
      nonzeroFrames: this.nonzeroFrames,
      peakSample: this.peakSample,
      discardedFrames: this.discardedFrames,
      aheadDroppedFrames: this.aheadDroppedFrames,
      activeSources: this.activeSources.size,
      playbackRate: this.lastPlaybackRate,
      maxAheadSeconds: this.maxAheadSeconds,
      scheduledAheadSeconds: this.context
        ? Math.max(0, this.nextStartTime - this.context.currentTime)
        : 0,
      lastError: this.lastError,
    };
  }

  _notify() {
    try {
      this.onChange(this.state());
    } catch {
      // UI reporting must never stop emulation or audio cleanup.
    }
  }

  _setGain(value) {
    if (!this.gain || !this.context) return;
    if (typeof this.gain.gain.setValueAtTime === 'function') {
      this.gain.gain.setValueAtTime(value, this.context.currentTime);
    } else {
      this.gain.gain.value = value;
    }
  }

  _applyGain() {
    this._setGain(this.enabled && !this.muted ? this.volume : 0);
  }

  _discardPending() {
    const discarded = this.machineAudio.discard();
    this.discardedFrames += discarded;
    return discarded;
  }

  _resetTimeline() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // An already ended source needs no further action.
      }
      if (typeof source.disconnect === 'function') {
        try {
          source.disconnect();
        } catch {
          // A disconnected source is already silent.
        }
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
  }

  _silence() {
    this._setGain(0);
    this._resetTimeline();
    this._discardPending();
  }
}
