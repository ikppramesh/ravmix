// Deck controller (main thread). Talks to the deck-processor worklet.
import { FxUnit } from './fx.js';

export const TEMPO_RANGES = [0.06, 0.1, 0.16, 1.0];
export const HOTCUE_COLORS = ['#e9264f', '#ff8a00', '#ffd400', '#2fd16b', '#19c3ff', '#3b6bff', '#a64dff', '#ff4dd2'];

export const PAD_FX1 = [
  { label: 'ROLL 1/16', roll: 1 / 16 },
  { label: 'ROLL 1/8', roll: 1 / 8 },
  { label: 'ROLL 1/4', roll: 1 / 4 },
  { label: 'ROLL 1/2', roll: 1 / 2 },
  { label: 'ECHO 1/2', fx: 'echo', frac: 1 / 2 },
  { label: 'ECHO 3/4', fx: 'echo', frac: 3 / 4 },
  { label: 'TRANS 1/4', fx: 'trans', frac: 1 / 4 },
  { label: 'REVERB', fx: 'reverb', frac: 1 },
];
export const PAD_FX2 = [
  { label: 'HPF SWEEP', fx: 'hpf', frac: 4 },
  { label: 'LPF SWEEP', fx: 'lpf', frac: 4 },
  { label: 'FLANGER', fx: 'flanger', frac: 2 },
  { label: 'PHASER', fx: 'phaser', frac: 2 },
  { label: 'SPIRAL 1/4', fx: 'spiral', frac: 1 / 4 },
  { label: 'PING PONG', fx: 'pingpong', frac: 1 / 2 },
  { label: 'BRAKE', special: 'brake' },
  { label: 'BACKSPIN', special: 'backspin' },
];
export const BEAT_JUMPS = [-1, 1, -2, 2, -4, 4, -8, 8];
export const BEAT_LOOPS = [1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32];
export const KEY_SHIFTS = [1, 2, 3, 4, -1, -2, -3, -4];
export const KEYBOARD = [0, 2, 4, 5, 7, 9, 11, 12];

export class Deck {
  constructor(engine, index) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.index = index;
    this.sr = this.ctx.sampleRate;
    this.node = new AudioWorkletNode(this.ctx, 'deck-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.padFx = new FxUnit(this.ctx);
    this.node.connect(this.padFx.input);
    this.output = this.padFx.output;

    this.track = null;
    this.listeners = new Set();
    this.rep = { pos: 0, speed: 0, playing: false, at: performance.now() };
    this.node.port.onmessage = (e) => this.onWorklet(e.data);

    // Physical control state survives track loads
    this.tempoValue = 0.5; // fader 0 (top, slower) .. 1 (bottom, faster)
    this.tempoRangeIdx = 1;
    this.keylock = false;
    this.padMode = 'hotcue';
    this.reset();
  }

  reset() {
    this.playing = false;
    this.cuePoint = 0;
    this.cuePreview = false;
    this.hotcues = new Array(8).fill(null);
    this.hotPreview = -1;
    this.loop = { in: null, out: null, active: false };
    this.keyShift = 0;
    this.synced = false;
    this.slipHolds = 0;
    this.rollSaved = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  post(m) {
    this.node.port.postMessage(m);
  }

  onWorklet(m) {
    if (m.type === 'pos') {
      this.rep = { pos: m.pos, speed: m.speed, playing: m.playing, at: performance.now() };
    } else if (m.type === 'ended') {
      this.playing = false;
      this.synced = false;
      this.emit();
    }
  }

  // ---------- Track loading ----------
  async load(track) {
    this.pause();
    const synced = this.synced;
    this.track = track;
    this.reset();
    this.synced = false;
    const b = track.buffer;
    const L = b.getChannelData(0).slice();
    const R = b.numberOfChannels > 1 ? b.getChannelData(1).slice() : null;
    this.node.port.postMessage({ type: 'load', L, R }, R ? [L.buffer, R.buffer] : [L.buffer]);
    // The worklet owns the samples now; drop the decoded buffer to save memory
    this.track = { ...track, duration: b.duration, buffer: null };
    this.cuePoint = track.firstBeat || 0;
    this.post({ type: 'seek', pos: this.cuePoint * this.sr });
    this.rep = { pos: this.cuePoint * this.sr, speed: 0, playing: false, at: performance.now() };
    this.applyRate();
    this.post({ type: 'keylock', v: this.keylock });
    this.post({ type: 'pitch', v: 1 });
    this.post({ type: 'loop', on: false, s: 0, e: 0 });
    if (synced) this.syncToggle();
    this.emit();
  }

  get loaded() {
    return !!this.track;
  }

  get duration() {
    return this.track ? this.track.duration : 0;
  }

  get bpm() {
    return this.track?.bpm || 0;
  }

  get firstBeat() {
    return this.track?.firstBeat || 0;
  }

  get beatLen() {
    return this.bpm ? 60 / this.bpm : 0.5;
  }

  get tempoRange() {
    return TEMPO_RANGES[this.tempoRangeIdx];
  }

  get rate() {
    return 1 + (this.tempoValue * 2 - 1) * this.tempoRange;
  }

  get effectiveBpm() {
    return this.bpm * this.rate;
  }

  // Current playhead position in seconds (extrapolated between worklet reports)
  get position() {
    const r = this.rep;
    let p = r.pos + r.speed * this.sr * ((performance.now() - r.at) / 1000);
    if (this.loop.active && r.speed > 0 && this.loop.out > this.loop.in) {
      const s = this.loop.in * this.sr, e = this.loop.out * this.sr;
      if (p >= e) p = s + ((p - s) % (e - s));
    }
    return Math.max(0, Math.min(this.duration, p / this.sr));
  }

  // ---------- Beat helpers ----------
  beatAt(sec) {
    return (sec - this.firstBeat) / this.beatLen;
  }

  snap(sec) {
    if (!this.bpm) return sec;
    return this.firstBeat + Math.round(this.beatAt(sec)) * this.beatLen;
  }

  maybeSnap(sec) {
    return this.engine.quantize ? this.snap(sec) : sec;
  }

  // ---------- Transport ----------
  seek(sec, opts = {}) {
    if (!this.loaded) return;
    sec = Math.max(0, Math.min(this.duration, sec));
    this.post({ type: 'seek', pos: sec * this.sr, slipToo: opts.slipToo !== false });
    this.rep = { ...this.rep, pos: sec * this.sr, at: performance.now() };
  }

  play() {
    if (!this.loaded) return;
    this.engine.resume();
    this.playing = true;
    this.cuePreview = false;
    this.hotPreview = -1;
    this.post({ type: 'play' });
    if (this.synced) this.alignPhase();
    this.emit();
  }

  pause() {
    this.playing = false;
    this.post({ type: 'pause' });
    this.emit();
  }

  togglePlay() {
    if (this.playing && !this.cuePreview && this.hotPreview < 0) this.pause();
    else this.play();
  }

  stutter() {
    this.seek(this.cuePoint);
    this.play();
  }

  cueDown() {
    if (!this.loaded) return;
    if (this.playing && !this.cuePreview) {
      this.pause();
      this.seek(this.cuePoint);
    } else {
      const pos = this.position;
      if (Math.abs(pos - this.cuePoint) > 0.01) this.cuePoint = this.maybeSnap(pos);
      this.seek(this.cuePoint);
      this.engine.resume();
      this.cuePreview = true;
      this.playing = true;
      this.post({ type: 'play' });
    }
    this.emit();
  }

  cueUp() {
    if (this.cuePreview) {
      this.cuePreview = false;
      this.pause();
      this.seek(this.cuePoint);
    }
    this.emit();
  }

  jumpToStart() {
    this.seek(0);
    this.emit();
  }

  // ---------- Tempo ----------
  setTempo(v, fromUser = true) {
    this.tempoValue = Math.max(0, Math.min(1, v));
    if (fromUser && this.synced) this.synced = false;
    this.applyRate();
    this.emit();
  }

  cycleTempoRange() {
    this.tempoRangeIdx = (this.tempoRangeIdx + 1) % TEMPO_RANGES.length;
    this.applyRate();
    this.emit();
  }

  resetTempo() {
    this.setTempo(0.5);
  }

  applyRate() {
    this.post({ type: 'rate', v: this.rate });
    this.engine.onTempoChange?.(this);
  }

  setRate(rate) {
    // Choose a fader value that produces this rate, widening the range if needed
    let idx = this.tempoRangeIdx;
    while (Math.abs(rate - 1) > TEMPO_RANGES[idx] && idx < TEMPO_RANGES.length - 1) idx++;
    this.tempoRangeIdx = idx;
    const r = TEMPO_RANGES[idx];
    this.tempoValue = Math.max(0, Math.min(1, ((rate - 1) / r + 1) / 2));
    this.applyRate();
  }

  toggleKeylock() {
    this.keylock = !this.keylock;
    this.post({ type: 'keylock', v: this.keylock });
    this.emit();
  }

  setKeyShift(st) {
    this.keyShift = st;
    this.post({ type: 'pitch', v: Math.pow(2, st / 12) });
    this.emit();
  }

  // ---------- Sync ----------
  syncToggle() {
    if (this.synced) {
      this.synced = false;
      this.emit();
      return;
    }
    const other = this.engine.otherDeck(this);
    if (!this.loaded || !other.loaded || !this.bpm || !other.bpm) {
      this.emit();
      return;
    }
    this.synced = true;
    this.followTempo();
    if (this.playing) this.alignPhase();
    this.emit();
  }

  followTempo() {
    const other = this.engine.otherDeck(this);
    if (!other.loaded || !other.bpm) return;
    let target = other.effectiveBpm;
    // half/double-time matching
    while (target / this.bpm > 1.5) target /= 2;
    while (target / this.bpm < 0.67) target *= 2;
    const rate = target / this.bpm;
    if (Math.abs(rate - this.rate) > 1e-5) this.setRate(rate);
  }

  alignPhase() {
    const other = this.engine.otherDeck(this);
    if (!other.loaded || !other.playing || !other.bpm) return;
    const phO = frac(other.beatAt(other.position));
    const phT = frac(this.beatAt(this.position));
    let d = phO - phT;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    this.seek(this.position + d * this.beatLen);
  }

  // ---------- Jog ----------
  scratchStart() {
    if (!this.loaded) return;
    this.engine.resume();
    this.post({ type: 'scratch', on: true });
  }
  scratchRate(rate) {
    this.post({ type: 'scratchRate', v: rate });
  }
  scratchEnd() {
    this.post({ type: 'scratch', on: false });
  }
  bend(amount) {
    this.post({ type: 'bend', v: amount });
  }
  search(seconds) {
    this.seek(this.position + seconds);
  }

  // ---------- Hot cues ----------
  hotcueDown(i, shift) {
    if (!this.loaded) return;
    if (shift) {
      this.hotcues[i] = null;
      this.emit();
      return;
    }
    const hc = this.hotcues[i];
    if (hc == null) {
      this.hotcues[i] = this.maybeSnap(this.position);
    } else if (this.playing && !this.cuePreview && this.hotPreview < 0) {
      let target = hc;
      if (this.engine.quantize && this.bpm) target = hc + (this.position - this.snap(this.position));
      this.seek(target);
    } else {
      this.seek(hc);
      this.engine.resume();
      this.hotPreview = i;
      this.playing = true;
      this.post({ type: 'play' });
    }
    this.emit();
  }

  hotcueUp(i) {
    if (this.hotPreview === i) {
      this.hotPreview = -1;
      this.pause();
      this.seek(this.hotcues[i]);
    }
    this.emit();
  }

  // ---------- Loops ----------
  sendLoop() {
    const { in: s, out: e, active } = this.loop;
    this.post({ type: 'loop', on: active && s != null && e != null && e > s, s: (s || 0) * this.sr, e: (e || 0) * this.sr });
  }

  loopIn() {
    if (!this.loaded) return;
    this.loop = { in: this.maybeSnap(this.position), out: null, active: false };
    this.sendLoop();
    this.emit();
  }

  loopOut() {
    if (!this.loaded || this.loop.in == null) return;
    const out = this.maybeSnap(this.position);
    if (out <= this.loop.in + 0.01) return;
    this.loop.out = out;
    this.loop.active = true;
    this.sendLoop();
    this.emit();
  }

  reloopExit() {
    if (this.loop.in == null || this.loop.out == null) return;
    if (this.loop.active) {
      this.loop.active = false;
    } else {
      this.loop.active = true;
      this.seek(this.loop.in);
    }
    this.sendLoop();
    this.emit();
  }

  beatLoop(beats) {
    if (!this.loaded) return;
    if (this.loop.active && Math.abs(this.loop.out - this.loop.in - beats * this.beatLen) < 0.001) {
      this.loop.active = false;
      this.sendLoop();
      this.emit();
      return;
    }
    const start = this.engine.quantize && this.bpm ? this.firstBeat + Math.floor(this.beatAt(this.position)) * this.beatLen : this.position;
    this.loop = { in: start, out: start + beats * this.beatLen, active: true };
    this.sendLoop();
    this.emit();
  }

  loopHalve() {
    if (this.loop.in == null || this.loop.out == null) return;
    const len = (this.loop.out - this.loop.in) / 2;
    if (len < 0.01) return;
    this.loop.out = this.loop.in + len;
    if (this.loop.active && this.position > this.loop.out) this.seek(this.loop.in + ((this.position - this.loop.in) % len));
    this.sendLoop();
    this.emit();
  }

  loopDouble() {
    if (this.loop.in == null || this.loop.out == null) return;
    this.loop.out = Math.min(this.duration, this.loop.in + (this.loop.out - this.loop.in) * 2);
    this.sendLoop();
    this.emit();
  }

  beatJump(beats) {
    if (!this.loaded) return;
    const d = beats * this.beatLen;
    if (this.loop.active && this.loop.out != null) {
      this.loop.in += d;
      this.loop.out += d;
      this.sendLoop();
    }
    this.seek(this.position + d);
    this.emit();
  }

  // ---------- Pad FX ----------
  slipOn() {
    if (this.slipHolds++ === 0) this.post({ type: 'slip', on: true });
  }
  slipOff() {
    if (--this.slipHolds <= 0) {
      this.slipHolds = 0;
      this.post({ type: 'slip', on: false });
    }
  }

  padFxDown(def) {
    if (!this.loaded) return;
    this.padFx.setBpm(this.effectiveBpm || 120);
    if (def.roll) {
      if (!this.playing) return;
      this.rollSaved = { ...this.loop };
      this.slipOn();
      const len = def.roll * this.beatLen;
      const s = this.bpm ? this.firstBeat + Math.floor((this.position - this.firstBeat) / len) * len : this.position;
      this.loop = { in: s, out: s + def.roll * this.beatLen, active: true };
      this.sendLoop();
    } else if (def.fx) {
      this.padFx.setType(def.fx);
      this.padFx.setFraction(def.frac);
      this.padFx.setLevel(0.75);
      this.padFx.setOn(true);
    } else if (def.special === 'brake') {
      if (!this.playing) return;
      this.slipOn();
      this.post({ type: 'ramp', v: 0.00004 });
      this.post({ type: 'pause' });
      this.braking = true;
    } else if (def.special === 'backspin') {
      if (!this.playing) return;
      this.slipOn();
      this.post({ type: 'scratch', on: true });
      this.post({ type: 'scratchRate', v: -3 });
      clearTimeout(this.spinT);
      this.spinT = setTimeout(() => this.post({ type: 'scratchRate', v: 0 }), 450);
      this.spinning = true;
    }
  }

  padFxUp(def) {
    if (def.roll) {
      if (!this.rollSaved) return;
      this.loop = this.rollSaved;
      this.rollSaved = null;
      this.sendLoop();
      this.slipOff();
    } else if (def.fx) {
      this.padFx.setOn(false);
    } else if (def.special === 'brake' && this.braking) {
      this.braking = false;
      this.post({ type: 'ramp', v: 0.02 });
      this.slipOff();
      if (this.playing) this.post({ type: 'play' });
    } else if (def.special === 'backspin' && this.spinning) {
      this.spinning = false;
      clearTimeout(this.spinT);
      this.post({ type: 'scratch', on: false });
      this.slipOff();
    }
    this.emit();
  }
}

function frac(x) {
  return x - Math.floor(x);
}
