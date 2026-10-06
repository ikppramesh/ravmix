// Mixer section UI: Beat FX, channel strips, master/headphones, crossfader.
import { h, knob, fader, button, register } from './controls.js';
import { FX_TYPES, BEAT_FRACTIONS, fractionLabel } from '../audio/fx.js';
import { meterLevel } from '../audio/engine.js';

const SEGMENTS = 15;

function meter(cls = '') {
  const segs = [];
  for (let i = 0; i < SEGMENTS; i++) segs.push(h('div', { class: `seg ${i >= SEGMENTS - 2 ? 'r' : i >= SEGMENTS - 5 ? 'o' : ''}` }));
  const el = h('div', { class: `meter ${cls}` }, segs.reverse());
  let hold = 0;
  return {
    el,
    set(peak) {
      const db = 20 * Math.log10(peak + 1e-9);
      const lvl = Math.max(0, Math.min(SEGMENTS, Math.round(((db + 36) / 36) * SEGMENTS)));
      hold = Math.max(lvl, hold - 0.25);
      const segsTopDown = el.children;
      for (let i = 0; i < SEGMENTS; i++) {
        const segIdx = SEGMENTS - 1 - i;
        segsTopDown[i].classList.toggle('on', segIdx < lvl || segIdx === Math.round(hold) - 1);
      }
    },
  };
}

export class MixerUI {
  constructor(engine, { onLoad, onBrowse }) {
    this.engine = engine;
    this.onLoad = onLoad;
    this.onBrowse = onBrowse;
    this.buf = new Float32Array(1024);
    this.build();
    engine.on(() => this.renderState());
    this.renderState();
  }

  build() {
    const e = this.engine;
    const fx = e.beatFx;

    // ----- Beat FX -----
    this.fxIdx = FX_TYPES.findIndex((t) => t.id === fx.type);
    this.fracIdx = BEAT_FRACTIONS.indexOf(fx.fraction);
    this.fxName = h('div', { class: 'fx-name' });
    this.fxBeat = h('div', { class: 'fx-beat' });
    this.fxBpm = h('div', { class: 'fx-bpm' });
    const fxSelect = button({
      id: 'fx.select', label: 'FX SELECT', cls: 'small',
      onDown: () => {
        this.fxIdx = (this.fxIdx + 1) % FX_TYPES.length;
        fx.setType(FX_TYPES[this.fxIdx].id);
        this.renderState();
      },
    });
    const beatL = button({ id: 'fx.beatLeft', label: '◀', cls: 'small', title: 'BEAT ◀', onDown: () => this.stepFrac(-1) });
    const beatR = button({ id: 'fx.beatRight', label: '▶', cls: 'small', title: 'BEAT ▶', onDown: () => this.stepFrac(1) });
    this.chBtns = ['ch1', 'ch2', 'master'].map((ch) =>
      button({ id: `fx.ch.${ch}`, label: ch === 'master' ? 'MST' : ch.toUpperCase().replace('CH', ''), cls: 'small chsel', onDown: () => e.setBeatFxChannel(ch) })
    );
    this.fxLevel = knob({ id: 'fx.level', label: 'LEVEL/DEPTH', value: fx.level, def: 0.5, size: 'sm', color: '#ff4dd2', onChange: (v) => fx.setLevel(v) });
    this.fxOn = button({
      id: 'fx.on', label: 'ON', cls: 'fxon',
      onDown: () => {
        fx.setBpm(e.masterBpm);
        fx.setOn(!fx.on);
        this.renderState();
      },
    });
    const fxSec = h(
      'div',
      { class: 'beatfx' },
      h('div', { class: 'sec-label' }, 'BEAT FX'),
      h('div', { class: 'fx-screen' }, this.fxName, h('div', { class: 'fx-meta' }, this.fxBeat, this.fxBpm)),
      h('div', { class: 'fx-row' }, fxSelect.el, beatL.el, beatR.el),
      h('div', { class: 'fx-row' }, h('span', { class: 'mini' }, 'CH'), this.chBtns.map((b) => b.el)),
      h('div', { class: 'fx-row' }, this.fxLevel.el, this.fxOn.el)
    );

    // ----- Channel strips -----
    this.strips = e.channels.map((ch, i) => this.buildStrip(ch, i));

    // ----- Center -----
    const st = e.state;
    this.masterKnob = knob({ id: 'master.level', label: 'MASTER', value: st.master, def: 0.8, size: 'sm', onChange: (v) => e.setMaster(v) });
    this.masterCueBtn = button({ id: 'master.cue', label: 'MASTER CUE', cls: 'small cue-btn', onDown: () => e.setMasterCue(!e.state.masterCue) });
    this.mL = meter('m');
    this.mR = meter('m');
    this.hpMix = knob({ id: 'hp.mix', label: 'HP MIX', value: st.hpMix, def: 0.5, size: 'sm', bipolar: true, onChange: (v) => e.setHpMix(v), format: () => 'CUE · MST' });
    this.hpLevel = knob({ id: 'hp.level', label: 'HP LEVEL', value: st.hpLevel, def: 0.8, size: 'sm', onChange: (v) => e.setHpLevel(v) });
    this.samplerVol = knob({ id: 'sampler.vol', label: 'SAMPLER', value: st.samplerVol, def: 0.8, size: 'sm', color: '#19c3ff', onChange: (v) => e.setSamplerVolume(v) });
    this.micLevel = knob({ id: 'mic.level', label: 'MIC', value: st.mic, def: 0.7, size: 'sm', color: '#2fd16b', onChange: (v) => e.setMicLevel(v) });
    this.micBtn = button({
      id: 'mic.on', label: 'MIC ON', cls: 'small',
      onDown: async () => {
        try {
          await e.toggleMic();
        } catch (err) {
          alert(`Microphone unavailable: ${err.message}`);
        }
      },
    });
    this.smartFader = button({ id: 'smartFader', label: 'SMART FADER', cls: 'small', title: 'Bass swap: the crossfader also cuts the bass of the outgoing deck', onDown: () => e.setSmartFader(!e.state.smartFader) });

    // Browse / load
    const browseUp = button({ id: 'browse.up', label: '▲', cls: 'small', title: 'Browse up', onDown: () => this.onBrowse(-1) });
    const browseDown = button({ id: 'browse.down', label: '▼', cls: 'small', title: 'Browse down', onDown: () => this.onBrowse(1) });
    register('browse', { type: 'rel', nudge: (d) => this.onBrowse(d > 0 ? 1 : -1) });
    const load1 = button({ id: 'load1', label: 'LOAD', sub: '◀ 1', cls: 'small load', onDown: () => this.onLoad(0) });
    const load2 = button({ id: 'load2', label: 'LOAD', sub: '2 ▶', cls: 'small load', onDown: () => this.onLoad(1) });
    const browse = h('div', { class: 'browse' }, load1.el, h('div', { class: 'browse-knob' }, browseUp.el, h('span', { class: 'mini' }, 'BROWSE'), browseDown.el), load2.el);

    const center = h(
      'div',
      { class: 'mix-center' },
      this.masterKnob.el,
      h('div', { class: 'master-meters' }, this.mL.el, this.mR.el),
      this.masterCueBtn.el,
      h('div', { class: 'knob-pair' }, this.hpMix.el, this.hpLevel.el),
      h('div', { class: 'knob-pair' }, this.samplerVol.el, this.micLevel.el),
      this.micBtn.el
    );

    // ----- Crossfader -----
    this.xf = fader({ id: 'crossfader', orient: 'h', value: st.crossfader, def: 0.5, cls: 'xfader', centerMark: true, onChange: (v) => e.setCrossfader(v) });
    this.curveBtns = [
      ['smooth', 'SMOOTH'],
      ['sharp', 'SCRATCH'],
      ['thru', 'THRU'],
    ].map(([c, l]) => button({ id: `xf.curve.${c}`, label: l, cls: 'tiny', onDown: () => e.setCurve(c) }));

    const xfRow = h(
      'div',
      { class: 'xf-row' },
      this.smartFader.el,
      h('div', { class: 'xf-wrap' }, h('div', { class: 'xf-labels' }, h('span', {}, '1'), h('span', {}, 'CROSSFADER'), h('span', {}, '2')), this.xf.el),
      h('div', { class: 'curve' }, this.curveBtns.map((b) => b.el))
    );

    this.el = h(
      'section',
      { class: 'mixer' },
      browse,
      fxSec,
      h('div', { class: 'strips' }, this.strips[0].el, center, this.strips[1].el),
      xfRow
    );
  }

  buildStrip(ch, i) {
    const e = this.engine;
    const id = `ch${i + 1}`;
    const s = ch.state;
    const k = (param, label, opts = {}) =>
      knob({ id: `${id}.${param}`, label, value: s[param], def: 0.5, size: 'sm', bipolar: true, onChange: (v) => ch.set(param, v), ...opts });
    const trim = k('trim', 'TRIM', { bipolar: false });
    const hi = k('high', 'HI', { color: '#fff' });
    const mid = k('mid', 'MID', { color: '#ffa028' });
    const low = k('low', 'LOW', { color: '#266eff' });
    const cfx = k('cfx', 'CFX', { color: '#ff4dd2', format: (v) => (v < 0.47 ? 'LPF' : v > 0.53 ? 'HPF' : 'FILTER') });
    const m = meter();
    const cue = button({
      id: `${id}.cue`, label: 'CUE', sub: '🎧', cls: 'small cue-btn',
      onDown: () => {
        ch.setCue(!ch.state.cue);
        this.renderState();
      },
    });
    const fd = fader({ id: `${id}.fader`, orient: 'v', value: 1 - s.fader, def: 0.2, ticks: 10, cls: 'chfader', onChange: (v) => ch.setFader(1 - v) });
    // fader component is top=0; channel fader is "up = loud" so we invert
    register(`${id}.fader`, { type: 'abs', el: fd.el, set: (v) => fd.set(1 - v) });
    const el = h(
      'div',
      { class: `strip strip-${i + 1}` },
      h('div', { class: 'strip-num' }, `CH ${i + 1}`),
      trim.el, hi.el, mid.el, low.el, cfx.el,
      h('div', { class: 'strip-bottom' }, m.el, h('div', { class: 'fader-col' }, cue.el, fd.el))
    );
    return { el, meter: m, cue, ch };
  }

  stepFrac(dir) {
    this.fracIdx = Math.max(0, Math.min(BEAT_FRACTIONS.length - 1, this.fracIdx + dir));
    this.engine.beatFx.setFraction(BEAT_FRACTIONS[this.fracIdx]);
    this.renderState();
  }

  renderState() {
    const e = this.engine;
    const fx = e.beatFx;
    this.fxName.textContent = FX_TYPES[this.fxIdx].name;
    this.fxBeat.textContent = `${fractionLabel(fx.fraction)} BEAT`;
    this.fxOn.setLit(fx.on);
    this.fxOn.el.classList.toggle('blink', fx.on);
    this.chBtns.forEach((b, i) => b.setLit(['ch1', 'ch2', 'master'][i] === e.beatFxSlot));
    this.strips.forEach((s) => s.cue.setLit(s.ch.state.cue));
    this.masterCueBtn.setLit(e.state.masterCue);
    this.micBtn.setLit(e.state.micOn);
    this.smartFader.setLit(e.state.smartFader);
    this.curveBtns.forEach((b, i) => b.setLit(['smooth', 'sharp', 'thru'][i] === e.state.curve));
  }

  frame() {
    const e = this.engine;
    this.strips.forEach((s) => s.meter.set(meterLevel(s.ch.meter, this.buf)));
    this.mL.set(meterLevel(e.meterL, this.buf));
    this.mR.set(meterLevel(e.meterR, this.buf));
    const bpm = e.masterBpm;
    e.beatFx.setBpm(bpm);
    this.fxBpm.textContent = `${bpm.toFixed(1)} BPM`;
  }
}
