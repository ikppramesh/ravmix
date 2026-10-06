// Waveform displays: zoomed scrolling waveform with beat grid + full-track overview.
import { HOTCUE_COLORS } from '../audio/deck.js';

const COL_LOW = [38, 110, 255];
const COL_MID = [255, 160, 40];
const COL_HIGH = [255, 255, 255];

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const hgt = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
    return true;
  }
  return false;
}

export class ScrollingWave {
  constructor(canvas, deck, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.deck = deck;
    this.color = color;
    this.zoom = 8; // seconds visible
    this.drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!deck.loaded) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, pos: deck.position, wasPlaying: deck.playing };
      if (deck.playing) deck.pause();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const secPerPx = this.zoom / canvas.clientWidth;
      deck.seek(this.drag.pos - (e.clientX - this.drag.x) * secPerPx);
    });
    const end = () => {
      if (this.drag?.wasPlaying) deck.play();
      this.drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15));
      },
      { passive: false }
    );
  }

  setZoom(z) {
    this.zoom = Math.max(2, Math.min(32, z));
  }

  draw() {
    fitCanvas(this.canvas);
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const deck = this.deck;
    const tr = deck.track;
    const mid = H / 2;
    if (!tr) {
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.font = `${12 * (window.devicePixelRatio || 1)}px Inter, sans-serif`;
      c.textAlign = 'center';
      c.fillText(`DECK ${deck.index + 1} — load a track`, W / 2, mid + 4);
      return;
    }
    const pos = deck.position;
    const pxPerSec = W / this.zoom;
    const t0 = pos - this.zoom / 2;
    const wave = tr.wave;
    const fps = wave?.fps;

    // Loop region
    const lp = deck.loop;
    if (lp.in != null) {
      const x0 = (lp.in - t0) * pxPerSec;
      const x1 = lp.out != null ? (lp.out - t0) * pxPerSec : x0 + 2;
      c.fillStyle = lp.active ? 'rgba(255,170,0,0.22)' : 'rgba(255,170,0,0.08)';
      c.fillRect(x0, 0, Math.max(2, x1 - x0), H);
    }

    // Beat grid
    if (deck.bpm) {
      const bl = deck.beatLen;
      const b0 = Math.floor((t0 - deck.firstBeat) / bl);
      const b1 = Math.ceil((t0 + this.zoom - deck.firstBeat) / bl);
      for (let b = b0; b <= b1; b++) {
        const t = deck.firstBeat + b * bl;
        if (t < 0) continue;
        const x = Math.round((t - t0) * pxPerSec) + 0.5;
        const bar = ((b % 4) + 4) % 4 === 0;
        c.fillStyle = bar ? 'rgba(255,60,60,0.75)' : 'rgba(255,255,255,0.18)';
        c.fillRect(x, 0, bar ? 2 : 1, bar ? H : H * 0.12);
        if (!bar) c.fillRect(x, H - H * 0.12, 1, H * 0.12);
      }
    }

    // 3-band waveform (rekordbox style)
    const amp = mid * 0.92;
    if (!wave) {
      // YouTube decks: no audio access, so draw a plain timeline
      const x0 = (0 - t0) * pxPerSec, x1 = (deck.duration - t0) * pxPerSec;
      c.fillStyle = 'rgba(255,40,40,0.18)';
      c.fillRect(Math.max(0, x0), mid - 2, Math.min(W, x1) - Math.max(0, x0), 4);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.font = `${11 * (window.devicePixelRatio || 1)}px Inter, sans-serif`;
      c.textAlign = 'center';
      c.fillText('YouTube — waveform not available', W / 4, mid - 10);
      c.textAlign = 'left';
    } else {
    if (!this.cols || this.cols.length !== W * 3) this.cols = new Float32Array(W * 3);
    const cols = this.cols;
    cols.fill(0);
    for (let x = 0; x < W; x++) {
      const ta = t0 + x / pxPerSec;
      const tb = t0 + (x + 1) / pxPerSec;
      if (tb < 0 || ta > deck.duration) continue;
      const fa = Math.max(0, Math.floor(ta * fps));
      const fb = Math.max(fa + 1, Math.floor(tb * fps));
      let l = 0, m = 0, hi = 0;
      for (let f = fa; f < fb && f < wave.low.length; f++) {
        if (wave.low[f] > l) l = wave.low[f];
        if (wave.mid[f] > m) m = wave.mid[f];
        if (wave.high[f] > hi) hi = wave.high[f];
      }
      cols[x * 3] = l * amp;
      cols[x * 3 + 1] = m * amp * 0.75;
      cols[x * 3 + 2] = hi * amp * 0.45;
    }
    const half = Math.floor(W / 2);
    const bands = [[COL_LOW, 1], [COL_MID, 0.85], [COL_HIGH, 0.9]];
    bands.forEach(([rgb, a], b) => {
      for (const [from, to, dim] of [[0, half, 0.55], [half, W, 1]]) {
        c.fillStyle = `rgba(${rgb},${a * dim})`;
        for (let x = from; x < to; x++) {
          const v = cols[x * 3 + b];
          if (v > 0) c.fillRect(x, mid - v, 1, v * 2);
        }
      }
    });
    }

    // Cue + hot cue markers
    const marker = (t, color, label) => {
      const x = (t - t0) * pxPerSec;
      if (x < -20 || x > W + 20) return;
      c.fillStyle = color;
      c.fillRect(x - 1, 0, 2, H);
      const s = 7 * (window.devicePixelRatio || 1);
      c.beginPath();
      c.moveTo(x - s, 0);
      c.lineTo(x + s, 0);
      c.lineTo(x, s * 1.2);
      c.fill();
      if (label) {
        c.font = `bold ${9 * (window.devicePixelRatio || 1)}px Inter, sans-serif`;
        c.fillText(label, x + 3, H - 4);
      }
    };
    marker(deck.cuePoint, '#ff9f1a', 'CUE');
    deck.hotcues.forEach((hc, i) => hc != null && marker(hc, HOTCUE_COLORS[i], String.fromCharCode(65 + i)));

    // Playhead
    c.fillStyle = '#fff';
    c.fillRect(W / 2 - 1, 0, 2, H);
    c.fillStyle = this.color;
    c.fillRect(W / 2 - 1, 0, 2, 4);
    c.fillRect(W / 2 - 1, H - 4, 2, 4);
  }
}

export class OverviewWave {
  constructor(canvas, deck) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.deck = deck;
    this.cache = null;
    this.cacheKey = '';
    canvas.addEventListener('pointerdown', (e) => {
      if (!deck.loaded) return;
      const seek = (ev) => {
        const r = canvas.getBoundingClientRect();
        deck.seek(((ev.clientX - r.left) / r.width) * deck.duration);
      };
      seek(e);
      canvas.setPointerCapture(e.pointerId);
      canvas.onpointermove = seek;
      canvas.onpointerup = () => (canvas.onpointermove = null);
    });
  }

  buildCache(W, H) {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const c = off.getContext('2d');
    const wave = this.deck.track.wave;
    const mid = H / 2;
    if (!wave) {
      c.fillStyle = 'rgba(255,40,40,0.35)';
      c.fillRect(0, mid - 2, W, 4);
      return off;
    }
    const n = wave.low.length;
    for (let x = 0; x < W; x++) {
      const fa = Math.floor((x / W) * n);
      const fb = Math.max(fa + 1, Math.floor(((x + 1) / W) * n));
      let l = 0, m = 0, hi = 0;
      for (let f = fa; f < fb; f++) {
        if (wave.low[f] > l) l = wave.low[f];
        if (wave.mid[f] > m) m = wave.mid[f];
        if (wave.high[f] > hi) hi = wave.high[f];
      }
      c.fillStyle = `rgb(${COL_LOW})`;
      c.fillRect(x, mid - l * mid, 1, l * H);
      c.fillStyle = `rgba(${COL_MID},0.85)`;
      c.fillRect(x, mid - m * mid * 0.75, 1, m * H * 0.75);
      c.fillStyle = `rgba(${COL_HIGH},0.85)`;
      c.fillRect(x, mid - hi * mid * 0.45, 1, hi * H * 0.45);
    }
    return off;
  }

  draw() {
    fitCanvas(this.canvas);
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const deck = this.deck;
    if (!deck.track || !deck.duration) return;
    const key = `${deck.track.id}:${W}x${H}`;
    if (key !== this.cacheKey) {
      this.cache = this.buildCache(W, H);
      this.cacheKey = key;
    }
    c.drawImage(this.cache, 0, 0);
    const px = (deck.position / deck.duration) * W;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, 0, px, H);
    const lp = deck.loop;
    if (lp.in != null && lp.out != null) {
      c.fillStyle = lp.active ? 'rgba(255,170,0,0.5)' : 'rgba(255,170,0,0.2)';
      c.fillRect((lp.in / deck.duration) * W, 0, Math.max(2, ((lp.out - lp.in) / deck.duration) * W), H);
    }
    c.fillStyle = '#ff9f1a';
    c.fillRect((deck.cuePoint / deck.duration) * W - 1, 0, 2, H);
    deck.hotcues.forEach((hc, i) => {
      if (hc == null) return;
      c.fillStyle = HOTCUE_COLORS[i];
      c.fillRect((hc / deck.duration) * W - 1, 0, 2, H * 0.4);
    });
    c.fillStyle = '#fff';
    c.fillRect(px - 1, 0, 2, H);
  }
}
