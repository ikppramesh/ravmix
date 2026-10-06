// Audio engine: two decks, 2-channel mixer, master/headphone routing, Beat FX, sampler, mic, recorder.
import { Deck } from './deck.js';
import { FxUnit } from './fx.js';
import { Sampler } from './sampler.js';

const dbToGain = (db) => Math.pow(10, db / 20);

function eqDb(v) {
  // knob 0..1, 0.5 = 0dB, 0 = kill (-40dB), 1 = +6dB
  if (v >= 0.5) return (v - 0.5) * 2 * 6;
  return -Math.pow((0.5 - v) * 2, 0.8) * 40;
}

function trimGain(v) {
  if (v >= 0.5) return dbToGain((v - 0.5) * 2 * 9);
  return Math.pow(v * 2, 2);
}

class Channel {
  constructor(engine, deck) {
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.engine = engine;
    this.input = ctx.createGain();
    this.trim = ctx.createGain();
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 180;
    this.smartLow = ctx.createBiquadFilter();
    this.smartLow.type = 'lowshelf';
    this.smartLow.frequency.value = 180;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.7;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 4000;
    this.cfxLp = ctx.createBiquadFilter();
    this.cfxLp.type = 'lowpass';
    this.cfxLp.frequency.value = 22000;
    this.cfxLp.Q.value = 1.2;
    this.cfxHp = ctx.createBiquadFilter();
    this.cfxHp.type = 'highpass';
    this.cfxHp.frequency.value = 10;
    this.cfxHp.Q.value = 1.2;
    this.fxIn = ctx.createGain();
    this.fxOut = ctx.createGain();
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.cue = ctx.createGain();
    this.cue.gain.value = 0;
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;

    deck.output.connect(this.input);
    this.input
      .connect(this.trim)
      .connect(this.low)
      .connect(this.smartLow)
      .connect(this.mid)
      .connect(this.high)
      .connect(this.cfxLp)
      .connect(this.cfxHp)
      .connect(this.fxIn);
    this.fxIn.connect(this.fxOut);
    this.fxOut.connect(this.fader).connect(this.xf).connect(engine.masterBus);
    this.fxOut.connect(this.meter);
    this.fxOut.connect(this.cue).connect(engine.cueBus);

    this.state = { trim: 0.5, high: 0.5, mid: 0.5, low: 0.5, cfx: 0.5, fader: 0.8, cue: false };
    this.setFader(0.8);
  }

  set(param, v, now = this.ctx.currentTime) {
    this.state[param] = v;
    const tc = 0.01;
    switch (param) {
      case 'trim': this.trim.gain.setTargetAtTime(trimGain(v), now, tc); break;
      case 'high': this.high.gain.setTargetAtTime(eqDb(v), now, tc); break;
      case 'mid': this.mid.gain.setTargetAtTime(eqDb(v), now, tc); break;
      case 'low': this.low.gain.setTargetAtTime(eqDb(v), now, tc); break;
      case 'cfx': this.setCfx(v); break;
      case 'fader': this.setFader(v); break;
    }
  }

  setCfx(v) {
    const now = this.ctx.currentTime;
    const dz = 0.03;
    let lp = 22000, hp = 10;
    if (v < 0.5 - dz) {
      const t = (0.5 - dz - v) / (0.5 - dz); // 0..1
      lp = 22000 * Math.pow(80 / 22000, t);
    } else if (v > 0.5 + dz) {
      const t = (v - 0.5 - dz) / (0.5 - dz);
      hp = 10 * Math.pow(9000 / 10, t);
    }
    this.cfxLp.frequency.setTargetAtTime(lp, now, 0.015);
    this.cfxHp.frequency.setTargetAtTime(hp, now, 0.015);
  }

  setFader(v) {
    this.state.fader = v;
    this.fader.gain.setTargetAtTime(Math.pow(v, 1.6), this.ctx.currentTime, 0.008);
  }

  setCue(on) {
    this.state.cue = on;
    this.cue.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
  }
}

export class Engine {
  constructor() {
    this.quantize = true;
    this.listeners = new Set();
  }

  async init() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/deck-processor.js`);

    this.masterBus = ctx.createGain();
    this.cueBus = ctx.createGain();

    // Master chain
    this.masterFxIn = ctx.createGain();
    this.masterFxOut = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.masterOut = ctx.createGain();
    this.masterBus.connect(this.masterFxIn);
    this.masterFxIn.connect(this.masterFxOut);
    this.masterFxOut.connect(this.masterGain).connect(this.limiter).connect(this.masterOut);

    const split = ctx.createChannelSplitter(2);
    this.meterL = ctx.createAnalyser();
    this.meterR = ctx.createAnalyser();
    this.meterL.fftSize = this.meterR.fftSize = 1024;
    this.masterOut.connect(split);
    split.connect(this.meterL, 0);
    split.connect(this.meterR, 1);

    // Headphones: cue/master blend
    this.hpCue = ctx.createGain();
    this.hpMaster = ctx.createGain();
    this.hpLevel = ctx.createGain();
    this.masterCue = ctx.createGain();
    this.masterCue.gain.value = 0;
    this.masterOut.connect(this.masterCue).connect(this.cueBus);
    this.cueBus.connect(this.hpCue).connect(this.hpLevel);
    this.masterOut.connect(this.hpMaster).connect(this.hpLevel);
    this.hpOut = this.hpLevel;

    // Sampler + mic go straight to the master bus
    this.sampler = new Sampler(ctx, this.masterBus);
    this.micGain = ctx.createGain();
    this.micGain.gain.value = 0.7;
    this.micGain.connect(this.masterBus);

    // Decks + channels
    this.decks = [new Deck(this, 0), new Deck(this, 1)];
    this.channels = this.decks.map((d) => new Channel(this, d));

    // Beat FX
    this.beatFx = new FxUnit(ctx);
    this.beatFxSlot = null;
    this.setBeatFxChannel('master');

    this.state = {
      crossfader: 0.5,
      curve: 'smooth',
      smartFader: false,
      master: 0.8,
      hpMix: 0.3,
      hpLevel: 0.8,
      masterCue: false,
      micOn: false,
      mic: 0.7,
      samplerVol: 0.8,
      hpMode: 'off',
    };
    this.setCrossfader(0.5);
    this.setMaster(0.8);
    this.setHpMix(0.3);
    this.setHpLevel(0.8);
    this.sampler.setVolume(0.8);
    await this.setHeadphoneMode('off');
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (this.hpCtx && this.hpCtx.state !== 'running') this.hpCtx.resume();
  }

  otherDeck(deck) {
    return this.decks[1 - deck.index];
  }

  onTempoChange(deck) {
    const other = this.otherDeck(deck);
    if (other?.synced) other.followTempo();
  }

  // The deck whose tempo drives Beat FX: the louder playing deck
  get masterDeck() {
    const audible = this.decks.map((d, i) => (d.playing ? this.channels[i].state.fader * this.xfGains[i] : 0));
    if (audible[0] === 0 && audible[1] === 0) return this.decks.find((d) => d.loaded) || this.decks[0];
    return audible[0] >= audible[1] ? this.decks[0] : this.decks[1];
  }

  get masterBpm() {
    const d = this.masterDeck;
    return d.loaded && d.bpm ? d.effectiveBpm : 120;
  }

  // YouTube decks bypass Web Audio, so mirror trim × fader × crossfader × master onto the player volume
  syncExternalVolumes() {
    this.decks.forEach((d, i) => {
      if (!d.isYT || !d.yt) return;
      const st = this.channels[i].state;
      const trim = st.trim >= 0.5 ? 1 : Math.pow(st.trim * 2, 2);
      const v = trim * Math.pow(st.fader, 1.6) * this.xfGains[i] * Math.min(1, Math.pow(this.state.master, 1.6) * 1.2);
      d.yt.setVolume(v);
    });
  }

  // ---------- Mixer ----------
  setCrossfader(x) {
    this.state.crossfader = x;
    let a, b;
    if (this.state.curve === 'thru') {
      a = b = 1;
    } else if (this.state.curve === 'sharp') {
      a = x > 0.96 ? Math.max(0, (1 - x) / 0.04) : 1;
      b = x < 0.04 ? Math.max(0, x / 0.04) : 1;
    } else {
      a = Math.cos((x * Math.PI) / 2);
      b = Math.sin((x * Math.PI) / 2);
      const norm = 1 / Math.SQRT1_2; // unity at centre
      a = Math.min(1, a * norm);
      b = Math.min(1, b * norm);
    }
    this.xfGains = [a, b];
    const now = this.ctx.currentTime;
    this.channels[0].xf.gain.setTargetAtTime(a, now, 0.005);
    this.channels[1].xf.gain.setTargetAtTime(b, now, 0.005);
    this.applySmartFader();
  }

  setCurve(c) {
    this.state.curve = c;
    this.setCrossfader(this.state.crossfader);
    this.emit();
  }

  setSmartFader(on) {
    this.state.smartFader = on;
    this.applySmartFader();
    this.emit();
  }

  applySmartFader() {
    // Smart Fader: bass swap following the crossfader so the two kick drums never stack
    const x = this.state.crossfader;
    const now = this.ctx.currentTime;
    const on = this.state.smartFader;
    const cut0 = on && x > 0.5 ? -30 * Math.min(1, (x - 0.5) * 2.5) : 0;
    const cut1 = on && x < 0.5 ? -30 * Math.min(1, (0.5 - x) * 2.5) : 0;
    this.channels[0].smartLow.gain.setTargetAtTime(cut0, now, 0.02);
    this.channels[1].smartLow.gain.setTargetAtTime(cut1, now, 0.02);
  }

  setMaster(v) {
    this.state.master = v;
    this.masterGain.gain.setTargetAtTime(Math.pow(v, 1.6) * 1.2, this.ctx.currentTime, 0.01);
  }

  setHpMix(v) {
    this.state.hpMix = v;
    const now = this.ctx.currentTime;
    this.hpCue.gain.setTargetAtTime(Math.cos((v * Math.PI) / 2), now, 0.01);
    this.hpMaster.gain.setTargetAtTime(Math.sin((v * Math.PI) / 2), now, 0.01);
  }

  setHpLevel(v) {
    this.state.hpLevel = v;
    this.hpLevel.gain.setTargetAtTime(Math.pow(v, 1.6), this.ctx.currentTime, 0.01);
  }

  setMasterCue(on) {
    this.state.masterCue = on;
    this.masterCue.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
    this.emit();
  }

  setSamplerVolume(v) {
    this.state.samplerVol = v;
    this.sampler.setVolume(v);
  }

  setMicLevel(v) {
    this.state.mic = v;
    this.micGain.gain.setTargetAtTime(Math.pow(v, 1.6) * 1.5, this.ctx.currentTime, 0.01);
  }

  async toggleMic() {
    if (this.state.micOn) {
      this.micStream?.getTracks().forEach((t) => t.stop());
      try { this.micSrc?.disconnect(); } catch {}
      this.micStream = this.micSrc = null;
      this.state.micOn = false;
    } else {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.micSrc = this.ctx.createMediaStreamSource(this.micStream);
      this.micSrc.connect(this.micGain);
      this.state.micOn = true;
    }
    this.emit();
  }

  // ---------- Beat FX ----------
  slotFor(ch) {
    if (ch === 'master') return [this.masterFxIn, this.masterFxOut];
    const c = this.channels[ch === 'ch1' ? 0 : 1];
    return [c.fxIn, c.fxOut];
  }

  setBeatFxChannel(ch) {
    if (this.beatFxSlot) {
      const [i, o] = this.slotFor(this.beatFxSlot);
      try { i.disconnect(this.beatFx.input); } catch {}
      try { this.beatFx.output.disconnect(o); } catch {}
      i.connect(o);
    }
    const [i, o] = this.slotFor(ch);
    try { i.disconnect(o); } catch {}
    i.connect(this.beatFx.input);
    this.beatFx.output.connect(o);
    this.beatFxSlot = ch;
    this.emit();
  }

  // ---------- Output routing ----------
  // Modes: 'off' (master only), 'split' (L = cue mono, R = master mono),
  //        'ch34' (4-channel device: 1/2 master, 3/4 headphones — e.g. a DDJ-FLX4 sound card),
  //        'device' (headphones to a second output device)
  async setHeadphoneMode(mode, deviceId) {
    const ctx = this.ctx;
    for (const n of this.routeNodes || []) {
      try { this.masterOut.disconnect(n); } catch {}
      try { this.hpOut.disconnect(n); } catch {}
      try { n.disconnect(); } catch {}
    }
    try { this.masterOut.disconnect(ctx.destination); } catch {}
    if (this.hpStreamDest) {
      try { this.hpOut.disconnect(this.hpStreamDest); } catch {}
    }
    this.routeNodes = [];
    if (this.hpCtx && mode !== 'device') {
      this.hpCtx.close();
      this.hpCtx = null;
    }

    const dest = ctx.destination;
    if (mode === 'split') {
      dest.channelCount = 2;
      const mono = (src) => {
        const g = ctx.createGain();
        g.channelCount = 1;
        g.channelCountMode = 'explicit';
        g.channelInterpretation = 'speakers';
        src.connect(g);
        this.routeNodes.push(g);
        return g;
      };
      const merger = ctx.createChannelMerger(2);
      mono(this.hpOut).connect(merger, 0, 0);
      mono(this.masterOut).connect(merger, 0, 1);
      merger.connect(dest);
      this.routeNodes.push(merger);
    } else if (mode === 'ch34' && dest.maxChannelCount >= 4) {
      dest.channelCount = 4;
      dest.channelCountMode = 'explicit';
      dest.channelInterpretation = 'discrete';
      const merger = ctx.createChannelMerger(4);
      const sm = ctx.createChannelSplitter(2);
      const sh = ctx.createChannelSplitter(2);
      this.masterOut.connect(sm);
      this.hpOut.connect(sh);
      sm.connect(merger, 0, 0);
      sm.connect(merger, 1, 1);
      sh.connect(merger, 0, 2);
      sh.connect(merger, 1, 3);
      merger.connect(dest);
      this.routeNodes.push(merger, sm, sh);
    } else {
      dest.channelCount = 2;
      dest.channelInterpretation = 'speakers';
      this.masterOut.connect(dest);
      if (mode === 'device') {
        if (!this.hpCtx) {
          this.hpStreamDest = ctx.createMediaStreamDestination();
          this.hpCtx = new AudioContext({ latencyHint: 'interactive' });
          this.hpCtx.createMediaStreamSource(this.hpStreamDest.stream).connect(this.hpCtx.destination);
        }
        this.hpOut.connect(this.hpStreamDest);
        if (deviceId && this.hpCtx.setSinkId) await this.hpCtx.setSinkId(deviceId);
      }
    }
    this.state.hpMode = mode === 'ch34' && dest.maxChannelCount < 4 ? 'off' : mode;
    this.emit();
  }

  async setMasterDevice(deviceId) {
    if (!this.ctx.setSinkId) throw new Error('This browser cannot choose an output device (use Chrome or Edge).');
    await this.ctx.setSinkId(deviceId);
    await this.setHeadphoneMode(this.state.hpMode);
  }

  // ---------- Recording ----------
  startRecording() {
    if (this.recorder) return;
    const dest = this.ctx.createMediaStreamDestination();
    this.masterOut.connect(dest);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.masterOut.disconnect(dest);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `raVmiX-mix-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    rec.start(1000);
    this.recorder = rec;
    this.recStart = performance.now();
    this.emit();
  }

  stopRecording() {
    this.recorder?.stop();
    this.recorder = null;
    this.emit();
  }
}

export function meterLevel(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > p) p = v;
  }
  return p;
}
