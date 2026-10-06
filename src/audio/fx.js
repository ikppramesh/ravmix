// Beat-synced effects unit. One instance = one insert slot with dry/wet handling.
// Send-type effects (delay/echo/reverb...) keep their tails after switching off.

export const FX_TYPES = [
  { id: 'delay', name: 'DELAY', kind: 'send' },
  { id: 'echo', name: 'ECHO', kind: 'send' },
  { id: 'pingpong', name: 'PING PONG', kind: 'send' },
  { id: 'spiral', name: 'SPIRAL', kind: 'send' },
  { id: 'reverb', name: 'REVERB', kind: 'send' },
  { id: 'trans', name: 'TRANS', kind: 'insert' },
  { id: 'filter', name: 'FILTER', kind: 'insert' },
  { id: 'flanger', name: 'FLANGER', kind: 'insert' },
  { id: 'phaser', name: 'PHASER', kind: 'insert' },
  { id: 'hpf', name: 'HPF SWEEP', kind: 'insert' },
  { id: 'lpf', name: 'LPF SWEEP', kind: 'insert' },
];

export const BEAT_FRACTIONS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16];

export function fractionLabel(f) {
  const map = { 0.0625: '1/16', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };
  return map[f] || String(f);
}

let reverbIR = null;
function getReverbIR(ctx) {
  if (reverbIR && reverbIR.sampleRate === ctx.sampleRate) return reverbIR;
  const len = Math.floor(ctx.sampleRate * 3.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  reverbIR = ir;
  return ir;
}

export class FxUnit {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.wet = ctx.createGain();
    this.send.gain.value = 0;
    this.wet.gain.value = 0;
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.send);
    this.wet.connect(this.output);

    this.type = 'echo';
    this.on = false;
    this.level = 0.5;
    this.fraction = 0.5;
    this.bpm = 120;
    this.nodes = [];
    this.build();
  }

  get beatSec() {
    return 60 / Math.max(40, this.bpm);
  }

  get time() {
    return Math.min(8, this.beatSec * this.fraction);
  }

  get kind() {
    return FX_TYPES.find((t) => t.id === this.type)?.kind || 'send';
  }

  teardown() {
    for (const n of this.nodes) {
      try { n.stop?.(); } catch {}
      try { n.disconnect(); } catch {}
    }
    this.nodes = [];
    try { this.send.disconnect(); } catch {}
  }

  build() {
    const ctx = this.ctx;
    this.teardown();
    const keep = (...ns) => (this.nodes.push(...ns), ns[0]);
    const t = this.time;
    this.params = {};

    switch (this.type) {
      case 'delay':
      case 'echo':
      case 'spiral': {
        const d = keep(ctx.createDelay(10));
        const fb = keep(ctx.createGain());
        const tone = keep(ctx.createBiquadFilter());
        d.delayTime.value = t;
        tone.type = 'lowpass';
        tone.frequency.value = this.type === 'delay' ? 16000 : 3500;
        fb.gain.value = this.type === 'delay' ? 0.25 : this.type === 'echo' ? 0.6 : 0.72;
        this.send.connect(d);
        d.connect(tone).connect(fb).connect(d);
        tone.connect(this.wet);
        this.params.delay = d;
        break;
      }
      case 'pingpong': {
        const dl = keep(ctx.createDelay(10));
        const dr = keep(ctx.createDelay(10));
        const fb = keep(ctx.createGain());
        const split = keep(ctx.createGain());
        const merger = keep(ctx.createChannelMerger(2));
        dl.delayTime.value = t;
        dr.delayTime.value = t;
        fb.gain.value = 0.55;
        split.channelCount = 1;
        split.channelCountMode = 'explicit';
        this.send.connect(split).connect(dl);
        dl.connect(dr);
        dr.connect(fb).connect(dl);
        dl.connect(merger, 0, 0);
        dr.connect(merger, 0, 1);
        merger.connect(this.wet);
        this.params.delays = [dl, dr];
        break;
      }
      case 'reverb': {
        const conv = keep(ctx.createConvolver());
        conv.buffer = getReverbIR(ctx);
        const pre = keep(ctx.createDelay(1));
        pre.delayTime.value = Math.min(0.25, t / 8);
        this.send.connect(pre).connect(conv).connect(this.wet);
        break;
      }
      case 'trans': {
        const vca = keep(ctx.createGain());
        vca.gain.value = 0.5;
        const lfo = keep(ctx.createOscillator());
        lfo.type = 'square';
        lfo.frequency.value = 1 / t;
        const depth = keep(ctx.createGain());
        depth.gain.value = 0.5;
        lfo.connect(depth).connect(vca.gain);
        lfo.start();
        this.send.connect(vca).connect(this.wet);
        this.params.lfo = lfo;
        break;
      }
      case 'filter':
      case 'hpf':
      case 'lpf': {
        const f = keep(ctx.createBiquadFilter());
        f.type = this.type === 'hpf' ? 'highpass' : this.type === 'lpf' ? 'lowpass' : 'bandpass';
        f.Q.value = this.type === 'filter' ? 2.5 : 6;
        f.frequency.value = this.type === 'hpf' ? 300 : this.type === 'lpf' ? 2500 : 1200;
        const lfo = keep(ctx.createOscillator());
        lfo.type = this.type === 'filter' ? 'sine' : 'sawtooth';
        lfo.frequency.value = 1 / Math.max(t, 0.05);
        const depth = keep(ctx.createGain());
        depth.gain.value = this.type === 'hpf' ? 0 : this.type === 'lpf' ? 0 : 1000;
        // HPF / LPF sweeps: use detune in cents for a log sweep
        if (this.type !== 'filter') {
          depth.gain.value = 2400;
          lfo.connect(depth).connect(f.detune);
        } else {
          lfo.connect(depth).connect(f.frequency);
        }
        lfo.start();
        this.send.connect(f).connect(this.wet);
        this.params.lfo = lfo;
        break;
      }
      case 'flanger': {
        const d = keep(ctx.createDelay(0.05));
        d.delayTime.value = 0.004;
        const fb = keep(ctx.createGain());
        fb.gain.value = 0.6;
        const lfo = keep(ctx.createOscillator());
        lfo.frequency.value = 1 / Math.max(t * 4, 0.1);
        const depth = keep(ctx.createGain());
        depth.gain.value = 0.003;
        lfo.connect(depth).connect(d.delayTime);
        lfo.start();
        const mix = keep(ctx.createGain());
        this.send.connect(mix);
        this.send.connect(d);
        d.connect(fb).connect(d);
        d.connect(mix);
        mix.gain.value = 0.6;
        mix.connect(this.wet);
        this.params.lfo = lfo;
        this.params.lfoScale = 4;
        break;
      }
      case 'phaser': {
        const mix = keep(ctx.createGain());
        mix.gain.value = 0.6;
        const lfo = keep(ctx.createOscillator());
        lfo.frequency.value = 1 / Math.max(t * 4, 0.1);
        const depth = keep(ctx.createGain());
        depth.gain.value = 1200;
        lfo.connect(depth);
        lfo.start();
        let prev = this.send;
        for (let i = 0; i < 6; i++) {
          const ap = keep(ctx.createBiquadFilter());
          ap.type = 'allpass';
          ap.frequency.value = 600 + i * 350;
          depth.connect(ap.frequency);
          prev.connect(ap);
          prev = ap;
        }
        this.send.connect(mix);
        prev.connect(mix);
        mix.connect(this.wet);
        this.params.lfo = lfo;
        this.params.lfoScale = 4;
        break;
      }
    }
    this.apply();
  }

  setType(type) {
    if (type === this.type) return;
    this.type = type;
    this.build();
  }

  setBpm(bpm) {
    if (!bpm || Math.abs(bpm - this.bpm) < 0.01) return;
    this.bpm = bpm;
    this.updateTime();
  }

  setFraction(f) {
    this.fraction = f;
    this.updateTime();
  }

  updateTime() {
    const now = this.ctx.currentTime;
    const t = this.time;
    const p = this.params || {};
    if (p.delay) p.delay.delayTime.setTargetAtTime(t, now, 0.05);
    if (p.delays) p.delays.forEach((d) => d.delayTime.setTargetAtTime(t, now, 0.05));
    if (p.lfo) p.lfo.frequency.setTargetAtTime(1 / Math.max(t * (p.lfoScale || 1), 0.05), now, 0.02);
  }

  setLevel(v) {
    this.level = v;
    this.apply();
  }

  setOn(on) {
    this.on = on;
    this.apply();
  }

  apply() {
    const now = this.ctx.currentTime;
    const ins = this.kind === 'insert';
    const dry = this.on && ins ? 1 - this.level : 1;
    const send = this.on ? 1 : 0;
    const wet = ins ? (this.on ? this.level : 0) : this.level;
    this.dry.gain.setTargetAtTime(dry, now, 0.01);
    this.send.gain.setTargetAtTime(send, now, 0.01);
    this.wet.gain.setTargetAtTime(wet, now, 0.01);
  }
}
