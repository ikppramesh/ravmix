// Deck section UI modelled on the DDJ-FLX4 deck layout.
import { h, knob, fader, button, register } from './controls.js';
import { Jog } from './jog.js';
import { ui } from './state.js';
import {
  HOTCUE_COLORS, PAD_FX1, PAD_FX2, BEAT_JUMPS, BEAT_LOOPS, KEY_SHIFTS, KEYBOARD, TEMPO_RANGES,
} from '../audio/deck.js';

const PAD_MODES = [
  { id: 'hotcue', label: 'HOT CUE', shiftId: 'keyboard', shiftLabel: 'KEYBOARD' },
  { id: 'padfx1', label: 'PAD FX1', shiftId: 'padfx2', shiftLabel: 'PAD FX2' },
  { id: 'beatjump', label: 'BEAT JUMP', shiftId: 'beatloop', shiftLabel: 'BEAT LOOP' },
  { id: 'sampler', label: 'SAMPLER', shiftId: 'keyshift', shiftLabel: 'KEY SHIFT' },
];

export function fmtTime(sec, neg = false) {
  if (!isFinite(sec)) sec = 0;
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}

function beatLabel(b) {
  const map = { 0.25: '1/4', 0.5: '1/2', 0.0625: '1/16', 0.125: '1/8' };
  return map[b] || String(b);
}

export class DeckUI {
  constructor(engine, deck, side) {
    this.engine = engine;
    this.deck = deck;
    this.i = deck.index;
    this.id = `d${deck.index + 1}`;
    this.side = side;
    this.showRemain = true;
    this.padDown = new Set();
    this.build();
    deck.on(() => this.renderState());
    ui.listeners.add(() => this.renderState());
    this.renderState();
  }

  shift() {
    return ui.isShift(this.i);
  }

  btn(key, opts) {
    return button({ id: `${this.id}.${key}`, ...opts });
  }

  build() {
    const d = this.deck;
    const id = this.id;

    // ----- Display -----
    this.title = h('div', { class: 'disp-title' }, 'No track loaded');
    this.sub = h('div', { class: 'disp-sub' }, 'Drop a song here or use LOAD');
    this.time = h('div', { class: 'disp-time', title: 'Click to toggle elapsed / remaining' }, '00:00.0');
    this.time.addEventListener('click', () => (this.showRemain = !this.showRemain));
    this.bpmEl = h('div', { class: 'disp-bpm' }, '---.--');
    this.bpmEl.title = 'Double-click to edit BPM';
    this.bpmEl.addEventListener('dblclick', () => this.editBpm());
    this.tempoEl = h('div', { class: 'disp-tempo' }, '0.00%');
    this.flags = h('div', { class: 'disp-flags' });
    this.overview = h('canvas', { class: 'overview' });
    this.ytBox = h('div', { class: 'yt-box' });
    this.deck.ytHost = this.ytBox;
    this.ytNote = h('div', { class: 'yt-note' }, 'YouTube deck: volume, crossfader, cues, loops & tempo work. EQ, FX, scratch, waveform and headphone cue are not available for YouTube audio. Double-click the BPM to set it for SYNC.');
    this.display = h(
      'div',
      { class: 'deck-display' },
      h('div', { class: 'disp-row' }, h('div', { class: 'deck-num' }, String(this.i + 1)), h('div', { class: 'disp-text' }, this.title, this.sub)),
      h('div', { class: 'disp-row disp-nums' }, this.time, h('div', { class: 'disp-bpm-wrap' }, this.bpmEl, h('span', { class: 'unit' }, 'BPM')), this.tempoEl, this.flags),
      this.overview,
      this.ytBox,
      this.ytNote
    );
    this.display.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.display.classList.add('drop');
    });
    this.display.addEventListener('dragleave', () => this.display.classList.remove('drop'));
    this.display.addEventListener('drop', (e) => {
      e.preventDefault();
      this.display.classList.remove('drop');
      const trackId = e.dataTransfer.getData('text/ravmix-track');
      if (trackId) this.onLoadRequest?.(trackId);
      else if (e.dataTransfer.files[0]) this.onFileDrop?.(e.dataTransfer.files[0]);
      else {
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url) this.onLinkDrop?.(url);
      }
    });

    // ----- Loop section -----
    this.bIn = this.btn('loopIn', {
      label: 'IN', sub: '4 BEAT', cls: 'small loop',
      onDown: () => {
        if (this.shift()) d.beatLoop(4);
        else d.loopIn();
        ui.consume(this.i);
      },
    });
    this.bOut = this.btn('loopOut', { label: 'OUT', cls: 'small loop', onDown: () => d.loopOut() });
    this.bExit = this.btn('reloop', { label: 'RELOOP', sub: 'EXIT', cls: 'small loop', onDown: () => d.reloopExit() });
    this.bHalf = this.btn('loopHalf', {
      label: '◀ ½X', sub: 'CUE/LOOP CALL', cls: 'small',
      onDown: () => (d.loop.in != null && d.loop.out != null ? d.loopHalve() : d.beatJump(-4)),
    });
    this.bDouble = this.btn('loopDouble', {
      label: '2X ▶', sub: 'CUE/LOOP CALL', cls: 'small',
      onDown: () => (d.loop.in != null && d.loop.out != null ? d.loopDouble() : d.beatJump(4)),
    });
    const loopSec = h('div', { class: 'loop-sec' }, h('div', { class: 'sec-label' }, 'LOOP'), h('div', { class: 'row' }, this.bIn.el, this.bOut.el, this.bExit.el), h('div', { class: 'row' }, this.bHalf.el, this.bDouble.el));

    // ----- Sync / tempo -----
    this.bSync = this.btn('sync', {
      label: 'BEAT SYNC', sub: 'TEMPO RANGE', cls: 'small sync',
      onDown: () => {
        if (this.shift()) d.cycleTempoRange();
        else d.syncToggle();
        ui.consume(this.i);
      },
    });
    this.bMT = this.btn('masterTempo', { label: 'MASTER TEMPO', cls: 'small mt', title: 'Key lock — tempo changes keep the original key', onDown: () => d.toggleKeylock() });
    this.tempo = fader({
      id: `${id}.tempo`, orient: 'v', value: d.tempoValue, def: 0.5, ticks: 10, centerMark: true, cls: 'tempo',
      onChange: (v) => d.setTempo(v),
    });
    this.tempoRangeEl = h('div', { class: 'tempo-range' }, '±10%');
    const tempoSec = h('div', { class: 'tempo-sec' }, h('div', { class: 'tempo-labels' }, h('span', {}, 'TEMPO'), h('span', {}, '−')), this.tempo.el, h('div', { class: 'tempo-labels' }, h('span', {}, '+')), this.tempoRangeEl);

    // ----- Jog -----
    this.jog = new Jog(d, id, () => this.shift());

    // ----- Pads -----
    this.modeBtns = PAD_MODES.map((m) =>
      this.btn(`mode.${m.id}`, {
        label: m.label, sub: m.shiftLabel, cls: 'mode',
        onDown: () => {
          d.padMode = this.shift() ? m.shiftId : m.id;
          ui.consume(this.i);
          d.emit();
        },
      })
    );
    this.pads = [];
    for (let p = 0; p < 8; p++) {
      const pad = this.btn(`pad${p + 1}`, {
        label: '', cls: 'pad',
        onDown: () => this.padPress(p, true),
        onUp: () => this.padPress(p, false),
      });
      this.pads.push(pad);
    }
    const padSec = h('div', { class: 'pad-sec' }, h('div', { class: 'mode-row' }, this.modeBtns.map((b) => b.el)), h('div', { class: 'pad-grid' }, this.pads.map((p) => p.el)));

    // ----- Transport -----
    this.bShift = button({
      id: `${id}.shift`, label: 'SHIFT', cls: 'round shift',
      onDown: (e) => {
        if (e) {
          ui.latch[this.i] = !ui.latch[this.i];
          ui.emit();
        } else {
          ui.midiShift[this.i] = true;
          ui.emit();
        }
      },
      onUp: (e) => {
        if (!e) {
          ui.midiShift[this.i] = false;
          ui.emit();
        }
      },
    });
    this.bCue = this.btn('cue', {
      label: 'CUE', cls: 'round cue',
      onDown: () => {
        if (this.shift()) d.jumpToStart();
        else d.cueDown();
        ui.consume(this.i);
      },
      onUp: () => d.cueUp(),
    });
    this.bPlay = this.btn('play', {
      label: '▶ ❚❚', sub: 'STUTTER', cls: 'round play',
      onDown: () => {
        if (this.shift()) d.stutter();
        else d.togglePlay();
        ui.consume(this.i);
      },
    });
    const transport = h('div', { class: 'transport' }, this.bShift.el, this.bCue.el, this.bPlay.el);

    const jogCol = h('div', { class: 'jog-col' }, this.jog.el);
    const sideCol = h('div', { class: 'side-col' }, this.bSync.el, this.bMT.el, tempoSec);
    const top = h('div', { class: 'deck-top' }, loopSec);
    const middle = h('div', { class: 'deck-middle' }, this.side === 'left' ? [sideCol, jogCol] : [jogCol, sideCol]);
    this.el = h('section', { class: `deck deck-${this.side}`, 'data-deck': this.i + 1 }, this.display, top, middle, padSec, transport);
  }

  editBpm() {
    const d = this.deck;
    if (!d.loaded) return;
    const v = prompt('Set BPM for this track (use half/double if detection is off):', d.bpm);
    const n = parseFloat(v);
    if (n > 40 && n < 300) {
      d.track.bpm = n;
      d.applyRate();
      d.emit();
    }
  }

  padPress(p, down) {
    const d = this.deck;
    const sh = this.shift();
    const mode = d.padMode;
    if (down) this.padDown.add(p);
    else this.padDown.delete(p);
    switch (mode) {
      case 'hotcue':
        if (down) d.hotcueDown(p, sh);
        else d.hotcueUp(p);
        break;
      case 'keyboard': {
        if (!down) break;
        const st = KEYBOARD[p];
        d.setKeyShift(st);
        const hc = d.hotcues[0] ?? d.cuePoint;
        d.seek(hc);
        if (!d.playing) d.play();
        break;
      }
      case 'padfx1':
        if (down) d.padFxDown(PAD_FX1[p]);
        else d.padFxUp(PAD_FX1[p]);
        break;
      case 'padfx2':
        if (down) d.padFxDown(PAD_FX2[p]);
        else d.padFxUp(PAD_FX2[p]);
        break;
      case 'beatjump':
        if (down) d.beatJump(BEAT_JUMPS[p] * (sh ? 4 : 1));
        break;
      case 'beatloop':
        if (down) d.beatLoop(BEAT_LOOPS[p]);
        break;
      case 'sampler': {
        if (!down) break;
        const s = this.engine.sampler;
        const slot = (this.i * 8 + p) % 8;
        if (sh || s.isPlaying(slot)) s.stop(slot);
        else s.trigger(slot);
        break;
      }
      case 'keyshift':
        if (down) d.setKeyShift(d.keyShift === KEY_SHIFTS[p] || sh ? 0 : KEY_SHIFTS[p]);
        break;
    }
    if (down) ui.consume(this.i);
    this.renderPads();
  }

  padLabel(p) {
    const d = this.deck;
    switch (d.padMode) {
      case 'hotcue': return String.fromCharCode(65 + p);
      case 'keyboard': return `${KEYBOARD[p] >= 0 ? '+' : ''}${KEYBOARD[p]}`;
      case 'padfx1': return PAD_FX1[p].label;
      case 'padfx2': return PAD_FX2[p].label;
      case 'beatjump': return `${BEAT_JUMPS[p] > 0 ? '▶ ' : '◀ '}${Math.abs(BEAT_JUMPS[p])}`;
      case 'beatloop': return beatLabel(BEAT_LOOPS[p]);
      case 'sampler': return this.engine.sampler.slots[(this.i * 8 + p) % 8].name;
      case 'keyshift': return `${KEY_SHIFTS[p] > 0 ? '+' : ''}${KEY_SHIFTS[p]}`;
    }
    return '';
  }

  renderPads() {
    const d = this.deck;
    this.pads.forEach((pad, p) => {
      pad.setLabel(this.padLabel(p));
      let color = '';
      let lit = this.padDown.has(p);
      switch (d.padMode) {
        case 'hotcue':
          if (d.hotcues[p] != null) {
            color = HOTCUE_COLORS[p];
            lit = true;
          }
          break;
        case 'beatloop':
          if (d.loop.active && Math.abs(d.loop.out - d.loop.in - BEAT_LOOPS[p] * d.beatLen) < 0.001) lit = true;
          color = '#2fd16b';
          break;
        case 'keyshift':
        case 'keyboard':
          color = '#a64dff';
          if (d.keyShift === (d.padMode === 'keyshift' ? KEY_SHIFTS[p] : KEYBOARD[p]) && d.keyShift !== 0) lit = true;
          break;
        case 'sampler':
          color = '#19c3ff';
          if (this.engine.sampler.isPlaying((this.i * 8 + p) % 8)) lit = true;
          break;
        case 'padfx1':
        case 'padfx2':
          color = '#ff4dd2';
          break;
        case 'beatjump':
          color = '#ffd400';
          break;
      }
      pad.el.style.setProperty('--pad', color || '#e9264f');
      pad.el.classList.toggle('lit', lit);
      pad.el.classList.toggle('dim', !!color && !lit);
    });
  }

  renderState() {
    const d = this.deck;
    const sh = this.shift();
    this.el.classList.toggle('shifted', sh);
    this.bShift.setLit(sh);
    this.bPlay.setLit(d.playing && !d.cuePreview && d.hotPreview < 0);
    this.bPlay.el.classList.toggle('blink', d.loaded && !d.playing);
    this.bCue.setLit(d.loaded && (d.cuePreview || !d.playing));
    this.bSync.setLit(d.synced);
    this.bMT.setLit(d.keylock);
    this.bIn.setLit(d.loop.in != null && !d.loop.active);
    this.bOut.setLit(d.loop.active);
    this.bExit.setLit(d.loop.active);
    this.modeBtns.forEach((b, k) => {
      const m = PAD_MODES[k];
      b.setLit(d.padMode === m.id || d.padMode === m.shiftId);
      b.el.classList.toggle('alt', d.padMode === m.shiftId);
    });
    this.tempo.set(d.tempoValue, false);
    this.tempoRangeEl.textContent = TEMPO_RANGES[d.tempoRangeIdx] >= 1 ? 'WIDE' : `±${Math.round(TEMPO_RANGES[d.tempoRangeIdx] * 100)}%`;
    this.display.classList.toggle('is-yt', d.isYT);
    if (d.track?.loading) {
      this.title.textContent = `Loading ${d.track.title}…`;
    } else if (d.track) {
      this.title.textContent = d.track.title;
      this.sub.textContent = d.track.artist || d.track.fileName;
    }
    const flags = [];
    if (d.keylock) flags.push('<b class="f-mt">MT</b>');
    if (d.keyShift) flags.push(`<b class="f-key">KEY ${d.keyShift > 0 ? '+' : ''}${d.keyShift}</b>`);
    if (d.synced) flags.push('<b class="f-sync">SYNC</b>');
    if (d.loop.active) flags.push('<b class="f-loop">LOOP</b>');
    if (d.isYT) flags.push('<b class="f-yt">YOUTUBE</b>');
    if (this.engine.quantize) flags.push('<b class="f-q">Q</b>');
    this.flags.innerHTML = flags.join('');
    this.renderPads();
  }

  frame() {
    const d = this.deck;
    this.jog.render();
    if (!d.loaded) return;
    const pos = d.position;
    this.time.textContent = this.showRemain ? fmtTime(d.duration - pos, true) : fmtTime(pos);
    this.time.classList.toggle('warn', d.duration - pos < 30 && d.playing);
    this.bpmEl.textContent = d.bpm ? d.effectiveBpm.toFixed(2) : '---.--';
    d.tick();
    const pct = ((d.isYT ? d.yt.actualRate : d.rate) - 1) * 100;
    this.tempoEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    if (d.synced) this.tempo.set(d.tempoValue, false);
    if (d.padMode === 'sampler') this.renderPads();
  }
}

