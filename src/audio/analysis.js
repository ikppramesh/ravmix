// Track analysis: 3-band waveform data + BPM / beat-grid detection.

export const WAVE_FPS = 150; // waveform points per second

export async function analyzeTrack(buffer) {
  const sr = buffer.sampleRate;
  const off = new OfflineAudioContext(3, buffer.length, sr);
  const src = off.createBufferSource();
  src.buffer = buffer;

  const lp = off.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 200;
  const bp = off.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1200;
  bp.Q.value = 0.6;
  const hp = off.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;

  const merger = off.createChannelMerger(3);
  src.connect(lp).connect(merger, 0, 0);
  src.connect(bp).connect(merger, 0, 1);
  src.connect(hp).connect(merger, 0, 2);
  merger.connect(off.destination);
  src.start();
  const bands = await off.startRendering();

  const low = bands.getChannelData(0);
  const mid = bands.getChannelData(1);
  const high = bands.getChannelData(2);
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;

  // Waveform frames
  const hop = Math.floor(sr / WAVE_FPS);
  const frames = Math.ceil(buffer.length / hop);
  const peak = new Float32Array(frames);
  const wl = new Float32Array(frames);
  const wm = new Float32Array(frames);
  const wh = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = f * hop;
    const b = Math.min(buffer.length, a + hop);
    let p = 0, sl = 0, sm = 0, sh = 0;
    for (let i = a; i < b; i++) {
      const v = Math.abs(chL[i] + chR[i]) * 0.5;
      if (v > p) p = v;
      sl += low[i] * low[i];
      sm += mid[i] * mid[i];
      sh += high[i] * high[i];
    }
    const cnt = Math.max(1, b - a);
    peak[f] = p;
    wl[f] = Math.sqrt(sl / cnt);
    wm[f] = Math.sqrt(sm / cnt);
    wh[f] = Math.sqrt(sh / cnt);
  }
  normalize(wl, 0.98);
  normalize(wm, 0.98);
  normalize(wh, 0.98);
  normalize(peak, 1);

  const { bpm, firstBeat } = detectBpm(low, sr);

  return { wave: { peak, low: wl, mid: wm, high: wh, fps: WAVE_FPS }, bpm, firstBeat };
}

function normalize(arr, pct) {
  const sorted = Float32Array.from(arr).sort();
  const ref = sorted[Math.floor(sorted.length * pct)] || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, arr[i] / ref);
}

function detectBpm(low, sr) {
  // Onset envelope at ~344 fps from low band energy
  const hop = 128;
  const fps = sr / hop;
  const n = Math.floor(low.length / hop);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const a = f * hop;
    for (let i = a; i < a + hop; i++) s += low[i] * low[i];
    env[f] = Math.sqrt(s / hop);
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);

  // Use a central chunk (up to 90 s) for the coarse autocorrelation
  const span = Math.min(n, Math.floor(fps * 90));
  const start = Math.max(0, Math.floor((n - span) / 2));
  const minBpm = 70, maxBpm = 180;
  const minLag = Math.floor((60 * fps) / maxBpm);
  const maxLag = Math.ceil((60 * fps) / minBpm);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = start; i < start + span - lag; i++) s += onset[i] * onset[i + lag];
    ac[lag] = s;
  }
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (ac[lag] > ac[bestLag]) bestLag = lag;
  // Parabolic refinement
  const y0 = ac[bestLag - 1] || 0, y1 = ac[bestLag], y2 = ac[bestLag + 1] || 0;
  const denom = y0 - 2 * y1 + y2;
  const lagF = denom !== 0 ? bestLag + (0.5 * (y0 - y2)) / denom : bestLag;
  let coarse = (60 * fps) / lagF;
  while (coarse < 85) coarse *= 2;
  while (coarse > 175) coarse /= 2;
  if (!isFinite(coarse) || n < fps * 5) return { bpm: 120, firstBeat: 0 };

  // Fine search: comb filter across the whole track
  let best = { score: -1, bpm: coarse, phase: 0 };
  for (let b = coarse - 1.5; b <= coarse + 1.5; b += 0.02) {
    const period = (60 * fps) / b;
    const phases = Math.ceil(period);
    for (let ph = 0; ph < phases; ph += 2) {
      let s = 0;
      for (let t = ph; t < n; t += period) s += onset[t | 0];
      if (s > best.score) best = { score: s, bpm: b, phase: ph };
    }
  }
  let bpm = best.bpm;
  if (Math.abs(bpm - Math.round(bpm)) < 0.08) bpm = Math.round(bpm);
  bpm = Math.round(bpm * 100) / 100;

  // Refine phase at the final bpm (1-frame resolution)
  const period = (60 * fps) / bpm;
  let bestPh = 0, bestS = -1;
  for (let ph = 0; ph < Math.ceil(period); ph++) {
    let s = 0;
    for (let t = ph; t < n; t += period) s += onset[t | 0] + 0.5 * (onset[(t | 0) + 1] || 0);
    if (s > bestS) { bestS = s; bestPh = ph; }
  }
  return { bpm, firstBeat: bestPh / fps };
}
