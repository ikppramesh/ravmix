// Jog wheel: platter top = vinyl scratch, outer ring = pitch bend (playing) / search (paused),
// SHIFT + platter = fast search. Also accepts MIDI jog ticks.
import { h, register } from './controls.js';

const REV_PER_SEC = 33.333 / 60; // 33⅓ rpm platter
const MIDI_TICKS_PER_REV = 720;

export class Jog {
  constructor(deck, id, isShift) {
    this.deck = deck;
    this.isShift = isShift;
    this.marker = h('div', { class: 'jog-marker' });
    this.platter = h('div', { class: 'jog-platter' }, this.marker, h('div', { class: 'jog-hub' }, h('span', {}, `DECK ${deck.index + 1}`)));
    this.ring = h('div', { class: 'jog-ring' });
    this.el = h('div', { class: 'jog' }, this.ring, this.platter);

    this.mode = null; // 'scratch' | 'bend' | 'search'
    this.accum = 0;
    this.lastAngle = 0;
    this.lastT = 0;
    this.midiTouch = false;

    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', () => this.up());
    this.el.addEventListener('pointercancel', () => this.up());
    this.el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });

    register(`${id}.jogTouch`, { type: 'button', el: this.platter, press: (d) => this.midiTouchSet(d) });
    register(`${id}.jogTop`, { type: 'rel', nudge: (t) => this.midiTicks(t, true) });
    register(`${id}.jogSide`, { type: 'rel', nudge: (t) => this.midiTicks(t, false) });

    this.loop = this.loop.bind(this);
  }

  angleOf(e) {
    const r = this.el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  down(e) {
    if (document.body.classList.contains('learning')) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const r = this.el.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const onPlatter = dist < (r.width / 2) * 0.8;
    const shift = this.isShift() || e.shiftKey;
    if (onPlatter && shift) this.mode = 'search';
    else if (onPlatter) this.mode = 'scratch';
    else this.mode = this.deck.playing ? 'bend' : 'search';

    this.lastAngle = this.angleOf(e);
    this.accum = 0;
    this.lastT = performance.now();
    this.el.classList.add(this.mode === 'scratch' ? 'touch' : 'turn');
    if (this.mode === 'scratch') this.deck.scratchStart();
    this.startLoop();
  }

  move(e) {
    if (!this.mode) return;
    const a = this.angleOf(e);
    let d = a - this.lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    this.lastAngle = a;
    if (this.mode === 'search') {
      this.deck.search((d / (2 * Math.PI)) * 8);
    } else {
      this.accum += d;
    }
  }

  up() {
    if (this.mode === 'scratch') this.deck.scratchEnd();
    if (this.mode === 'bend') this.deck.bend(0);
    this.mode = null;
    this.el.classList.remove('touch', 'turn');
  }

  startLoop() {
    if (this.looping) return;
    this.looping = true;
    requestAnimationFrame(this.loop);
  }

  // Converts accumulated rotation into a playback rate once per frame
  loop() {
    if (!this.mode && !this.midiTouch) {
      this.looping = false;
      return;
    }
    const now = performance.now();
    const dt = Math.max(0.001, (now - this.lastT) / 1000);
    this.lastT = now;
    const revPerSec = this.accum / (2 * Math.PI) / dt;
    this.accum = 0;
    if (this.mode === 'scratch' || this.midiTouch) {
      this.deck.scratchRate(Math.max(-12, Math.min(12, revPerSec / REV_PER_SEC)));
    } else if (this.mode === 'bend') {
      this.deck.bend(Math.max(-0.6, Math.min(0.6, revPerSec * 0.35)));
    }
    requestAnimationFrame(this.loop);
  }

  wheel(e) {
    e.preventDefault();
    if (!this.deck.loaded) return;
    if (this.deck.playing) {
      this.deck.bend(e.deltaY > 0 ? 0.08 : -0.08);
      clearTimeout(this.wheelT);
      this.wheelT = setTimeout(() => this.deck.bend(0), 140);
    } else {
      this.deck.search(Math.sign(e.deltaY) * (e.shiftKey ? 1 : 0.05));
    }
  }

  // ---- MIDI ----
  midiTouchSet(down) {
    if (down) {
      this.midiTouch = true;
      this.accum = 0;
      this.lastT = performance.now();
      this.deck.scratchStart();
      this.el.classList.add('touch');
      this.startLoop();
    } else {
      this.midiTouch = false;
      this.deck.scratchEnd();
      this.el.classList.remove('touch');
    }
  }

  midiTicks(ticks, top) {
    const rad = (ticks / MIDI_TICKS_PER_REV) * 2 * Math.PI;
    if (this.midiTouch && top) {
      this.accum += rad;
    } else if (this.isShift()) {
      this.deck.search(ticks * 0.05);
    } else if (this.deck.playing) {
      this.deck.bend(Math.max(-0.5, Math.min(0.5, ticks * 0.02)));
      clearTimeout(this.midiBendT);
      this.midiBendT = setTimeout(() => this.deck.bend(0), 60);
    } else {
      this.deck.search(ticks * 0.004);
    }
  }

  render() {
    const deg = this.deck.position * REV_PER_SEC * 360;
    this.platter.style.transform = `rotate(${deg % 360}deg)`;
  }
}
