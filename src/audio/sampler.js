// Sampler with 8 built-in synthesized one-shots per bank (no audio assets needed).
// Users can also drop their own files onto a sampler slot.

const SR = 44100;

async function render(seconds, build) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  build(ctx, ctx.destination);
  return ctx.startRendering();
}

function noiseBuffer(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function env(g, t0, a, peak, d) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

const BUILDERS = {
  'AIR HORN': () =>
    render(1.6, (ctx, out) => {
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      g.connect(lp).connect(out);
      [0, 0.28, 0.42].forEach((start, k) => {
        const len = k === 2 ? 1.1 : 0.2;
        [466, 470, 932, 699].forEach((f) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f * 0.92, start);
          o.frequency.linearRampToValueAtTime(f, start + 0.05);
          const og = ctx.createGain();
          og.gain.setValueAtTime(0, start);
          og.gain.linearRampToValueAtTime(0.12, start + 0.02);
          og.gain.setValueAtTime(0.12, start + len - 0.05);
          og.gain.linearRampToValueAtTime(0, start + len);
          o.connect(og).connect(g);
          o.start(start);
          o.stop(start + len);
        });
      });
    }),
  KICK: () =>
    render(0.6, (ctx, out) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(160, 0);
      o.frequency.exponentialRampToValueAtTime(42, 0.12);
      env(g, 0, 0.002, 1, 0.5);
      o.connect(g).connect(out);
      o.start();
    }),
  SNARE: () =>
    render(0.4, (ctx, out) => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 0.4);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const g = ctx.createGain();
      env(g, 0, 0.001, 0.7, 0.22);
      n.connect(hp).connect(g).connect(out);
      n.start();
      const o = ctx.createOscillator();
      o.frequency.value = 190;
      const og = ctx.createGain();
      env(og, 0, 0.001, 0.6, 0.1);
      o.connect(og).connect(out);
      o.start();
    }),
  CLAP: () =>
    render(0.5, (ctx, out) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.9;
      bp.connect(out);
      [0, 0.012, 0.024, 0.04].forEach((t, i) => {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx, 0.4);
        const g = ctx.createGain();
        env(g, t, 0.001, 0.9, i === 3 ? 0.3 : 0.02);
        n.connect(g).connect(bp);
        n.start(t);
      });
    }),
  'HI-HAT': () =>
    render(0.2, (ctx, out) => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 0.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = ctx.createGain();
      env(g, 0, 0.001, 0.6, 0.07);
      n.connect(hp).connect(g).connect(out);
      n.start();
    }),
  SIREN: () =>
    render(2.4, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2.5;
      const depth = ctx.createGain();
      depth.gain.value = 300;
      lfo.connect(depth).connect(o.frequency);
      o.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.25, 0.05);
      g.gain.setValueAtTime(0.25, 2.1);
      g.gain.linearRampToValueAtTime(0, 2.4);
      o.connect(lp).connect(g).connect(out);
      o.start();
      lfo.start();
    }),
  LASER: () =>
    render(0.6, (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(3000, 0);
      o.frequency.exponentialRampToValueAtTime(80, 0.45);
      const g = ctx.createGain();
      env(g, 0, 0.005, 0.35, 0.5);
      o.connect(g).connect(out);
      o.start();
    }),
  'RISER': () =>
    render(4, (ctx, out) => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(200, 0);
      bp.frequency.exponentialRampToValueAtTime(9000, 3.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.01, 0);
      g.gain.exponentialRampToValueAtTime(0.8, 3.8);
      g.gain.linearRampToValueAtTime(0, 4);
      n.connect(bp).connect(g).connect(out);
      n.start();
    }),
};

export class Sampler {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.connect(output);
    this.slots = Object.keys(BUILDERS).map((name) => ({ name, buffer: null, voice: null }));
    this.ready = this.init();
  }

  async init() {
    const names = Object.keys(BUILDERS);
    const bufs = await Promise.all(names.map((n) => BUILDERS[n]()));
    bufs.forEach((b, i) => (this.slots[i].buffer = b));
  }

  async loadFile(index, file) {
    const ab = await file.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
    this.slots[index].buffer = buf;
    this.slots[index].name = file.name.replace(/\.[^.]+$/, '').slice(0, 10).toUpperCase();
  }

  trigger(index) {
    const slot = this.slots[index];
    if (!slot?.buffer) return;
    this.stop(index);
    const src = this.ctx.createBufferSource();
    src.buffer = slot.buffer;
    src.connect(this.output);
    src.start();
    slot.voice = src;
    src.onended = () => {
      if (slot.voice === src) slot.voice = null;
    };
  }

  stop(index) {
    const slot = this.slots[index];
    if (slot?.voice) {
      try { slot.voice.stop(); } catch {}
      slot.voice = null;
    }
  }

  isPlaying(index) {
    return !!this.slots[index]?.voice;
  }

  setVolume(v) {
    this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }
}
