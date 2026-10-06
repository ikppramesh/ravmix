// Deck playback engine. Runs on the audio thread.
// Supports variable-rate playback (incl. reverse for scratching), loops, slip mode,
// and a granular time-stretcher used for Master Tempo (key lock) and Key Shift.

const MAX_GRAINS = 4;

class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null;
    this.R = null;
    this.len = 0;

    this.pos = 0;            // playhead in samples (float)
    this.playing = false;
    this.rate = 1;           // tempo ratio from the tempo slider
    this.bend = 0;           // temporary jog nudge added to the rate
    this.scratching = false;
    this.scratchRate = 0;
    this.speed = 0;          // smoothed actual speed
    this.ramp = 0.02;        // smoothing coefficient per sample (start/stop feel)
    this.keylock = false;
    this.pitch = 1;          // key-shift ratio (2^(semitones/12))

    this.loopOn = false;
    this.loopS = 0;
    this.loopE = 0;

    this.slip = false;
    this.slipPos = 0;

    // Granular stretcher state
    this.N = Math.round(0.07 * sampleRate) & ~1;
    this.hop = this.N / 2;
    this.hopCount = 0;
    this.hann = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    this.gStart = new Float64Array(MAX_GRAINS);
    this.gIdx = new Int32Array(MAX_GRAINS).fill(-1);

    this.reportEvery = 512;
    this.reportCount = 0;
    this.endedSent = false;

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case 'load':
        this.L = m.L;
        this.R = m.R || m.L;
        this.len = this.L.length;
        this.pos = 0;
        this.playing = false;
        this.speed = 0;
        this.loopOn = false;
        this.slip = false;
        this.endedSent = false;
        this.resetGrains();
        break;
      case 'play': this.playing = true; this.endedSent = false; break;
      case 'pause': this.playing = false; break;
      case 'seek':
        this.pos = Math.max(0, Math.min(this.len, m.pos));
        if (this.slip && m.slipToo) this.slipPos = this.pos;
        this.resetGrains();
        this.endedSent = false;
        break;
      case 'rate': this.rate = m.v; break;
      case 'bend': this.bend = m.v; break;
      case 'scratch':
        this.scratching = m.on;
        if (m.on) this.scratchRate = 0;
        break;
      case 'scratchRate': this.scratchRate = m.v; break;
      case 'keylock': this.keylock = m.v; break;
      case 'pitch': this.pitch = m.v; break;
      case 'ramp': this.ramp = m.v; break;
      case 'loop':
        this.loopOn = m.on;
        this.loopS = m.s;
        this.loopE = m.e;
        break;
      case 'slip':
        if (m.on) {
          this.slip = true;
          this.slipRun = this.playing;
          this.slipPos = this.pos;
        } else if (this.slip) {
          this.slip = false;
          this.pos = Math.max(0, Math.min(this.len, this.slipPos));
          this.resetGrains();
        }
        break;
    }
    this.report(true);
  }

  resetGrains() {
    this.gIdx.fill(-1);
    this.hopCount = 0;
  }

  report(force) {
    this.port.postMessage({
      type: 'pos',
      pos: this.pos,
      speed: this.speed,
      playing: this.playing,
      t: currentTime,
      force: !!force,
    });
  }

  read(buf, t) {
    if (t < 0 || t >= this.len - 1) return 0;
    const i = t | 0;
    const f = t - i;
    return buf[i] + (buf[i + 1] - buf[i]) * f;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;

    if (!this.L) {
      oL.fill(0);
      if (oR !== oL) oR.fill(0);
      return true;
    }

    const L = this.L, R = this.R, N = this.N, hann = this.hann;

    for (let s = 0; s < n; s++) {
      let target;
      if (this.scratching) target = this.scratchRate;
      else target = this.playing ? this.rate + this.bend : 0;
      const k = this.scratching ? 0.004 : this.ramp;
      this.speed += (target - this.speed) * k;
      if (Math.abs(this.speed) < 1e-5 && target === 0) this.speed = 0;

      const sp = this.speed;
      const pitchRatio = this.keylock ? this.pitch : sp * this.pitch;
      const granular =
        !this.scratching && sp > 0.05 && (this.keylock ? Math.abs(sp - this.pitch) > 1e-4 : this.pitch !== 1);

      let l = 0, r = 0;
      if (granular) {
        if (this.hopCount <= 0) {
          for (let g = 0; g < MAX_GRAINS; g++) {
            if (this.gIdx[g] < 0) {
              this.gIdx[g] = 0;
              this.gStart[g] = this.pos;
              break;
            }
          }
          this.hopCount = this.hop;
        }
        this.hopCount--;
        for (let g = 0; g < MAX_GRAINS; g++) {
          const gi = this.gIdx[g];
          if (gi < 0) continue;
          const t = this.gStart[g] + gi * pitchRatio;
          const w = hann[gi];
          l += this.read(L, t) * w;
          r += this.read(R, t) * w;
          this.gIdx[g] = gi + 1 >= N ? -1 : gi + 1;
        }
      } else {
        if (this.hopCount !== 0) this.resetGrains();
        l = this.read(L, this.pos);
        r = this.read(R, this.pos);
      }

      oL[s] = l;
      oR[s] = r;

      this.pos += sp;
      if (this.slip && this.slipRun) this.slipPos += this.rate;

      if (this.loopOn && sp > 0 && this.pos >= this.loopE && this.loopE > this.loopS) {
        this.pos = this.loopS + (this.pos - this.loopE);
      }
      if (this.pos < 0) this.pos = 0;
      if (this.pos >= this.len) {
        this.pos = this.len;
        if (this.playing && !this.endedSent) {
          this.playing = false;
          this.endedSent = true;
          this.port.postMessage({ type: 'ended' });
        }
      }
    }

    this.reportCount += n;
    if (this.reportCount >= this.reportEvery) {
      this.reportCount = 0;
      this.report(false);
    }
    return true;
  }
}

registerProcessor('deck-processor', DeckProcessor);
