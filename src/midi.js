// Web MIDI: drive the app from a real DDJ-FLX4 (or any controller) + MIDI Learn.
// The default map follows Pioneer's published DDJ-FLX4 / DDJ-400 MIDI layout; anything that
// doesn't match your unit can be re-assigned with MIDI LEARN (saved in this browser).
import { registry } from './ui/controls.js';
import { ui } from './ui/state.js';

const STORE = 'ravmix.midi.v1';
const hex = (n) => n.toString(16).padStart(2, '0');
const keyOf = (status, d1) => `${hex(status)}:${hex(d1)}`;

function defaultMap() {
  const m = {};
  for (const d of [0, 1]) {
    const id = `d${d + 1}`;
    const ch = `ch${d + 1}`;
    const note = 0x90 + d;
    const cc = 0xb0 + d;
    Object.assign(m, {
      [keyOf(note, 0x0b)]: `${id}.play`,
      [keyOf(note, 0x0c)]: `${id}.cue`,
      [keyOf(note, 0x58)]: `${id}.sync`,
      [keyOf(note, 0x3f)]: `${id}.shift`,
      [keyOf(note, 0x10)]: `${id}.loopIn`,
      [keyOf(note, 0x11)]: `${id}.loopOut`,
      [keyOf(note, 0x4d)]: `${id}.reloop`,
      [keyOf(note, 0x51)]: `${id}.loopHalf`,
      [keyOf(note, 0x53)]: `${id}.loopDouble`,
      [keyOf(note, 0x54)]: `${ch}.cue`,
      [keyOf(note, 0x36)]: `${id}.jogTouch`,
      [keyOf(note, 0x1b)]: `${id}.mode.hotcue`,
      [keyOf(note, 0x1e)]: `${id}.mode.padfx1`,
      [keyOf(note, 0x20)]: `${id}.mode.beatjump`,
      [keyOf(note, 0x22)]: `${id}.mode.sampler`,
      [keyOf(cc, 0x00)]: `${id}.tempo`,
      [keyOf(cc, 0x21)]: `${id}.jogTop`,
      [keyOf(cc, 0x22)]: `${id}.jogSide`,
      [keyOf(cc, 0x23)]: `${id}.jogSide`,
      [keyOf(cc, 0x04)]: `${ch}.trim`,
      [keyOf(cc, 0x07)]: `${ch}.high`,
      [keyOf(cc, 0x0b)]: `${ch}.mid`,
      [keyOf(cc, 0x0f)]: `${ch}.low`,
      [keyOf(cc, 0x13)]: `${ch}.fader`,
    });
  }
  Object.assign(m, {
    [keyOf(0xb6, 0x17)]: 'ch1.cfx',
    [keyOf(0xb6, 0x18)]: 'ch2.cfx',
    [keyOf(0xb6, 0x1f)]: 'crossfader',
    [keyOf(0xb6, 0x40)]: 'browse',
    [keyOf(0x96, 0x46)]: 'load1',
    [keyOf(0x96, 0x47)]: 'load2',
    [keyOf(0x96, 0x63)]: 'master.cue',
    [keyOf(0x94, 0x47)]: 'fx.on',
    [keyOf(0x94, 0x4a)]: 'fx.beatLeft',
    [keyOf(0x94, 0x4b)]: 'fx.beatRight',
    [keyOf(0xb4, 0x02)]: 'fx.level',
  });
  return m;
}

// FLX4 pads: status 0x97/0x98 (deck 1 / shifted) and 0x99/0x9A (deck 2 / shifted);
// note high nibble = pad mode, low 3 bits = pad number.
const PAD_MODE_BY_NIBBLE = ['hotcue', 'padfx1', 'beatjump', 'sampler', 'keyboard', 'padfx2', 'beatloop', 'keyshift'];

export class Midi {
  constructor({ deckUIs, onStatus }) {
    this.deckUIs = deckUIs;
    this.onStatus = onStatus;
    this.learning = false;
    this.learnTarget = null;
    this.inputs = [];
    this.outputs = [];
    try {
      this.map = { ...defaultMap(), ...JSON.parse(localStorage.getItem(STORE) || '{}') };
    } catch {
      this.map = defaultMap();
    }
    this.onDocClick = this.onDocClick.bind(this);
  }

  get supported() {
    return !!navigator.requestMIDIAccess;
  }

  async connect() {
    if (!this.supported) throw new Error('Web MIDI is not supported in this browser — use Chrome or Edge.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.bind();
    this.bind();
  }

  bind() {
    this.inputs = [...this.access.inputs.values()];
    this.outputs = [...this.access.outputs.values()];
    this.inputs.forEach((i) => (i.onmidimessage = (e) => this.onMessage(e.data)));
    const names = this.inputs.map((i) => i.name).join(', ');
    this.onStatus?.(this.inputs.length ? `MIDI: ${names}` : 'MIDI: no device', this.inputs.length > 0);
  }

  // ---------- Learn ----------
  setLearning(on) {
    this.learning = on;
    this.learnTarget = null;
    document.body.classList.toggle('learning', on);
    document.querySelectorAll('.learn-target').forEach((el) => el.classList.remove('learn-target'));
    if (on) document.addEventListener('pointerdown', this.onDocClick, true);
    else document.removeEventListener('pointerdown', this.onDocClick, true);
  }

  onDocClick(e) {
    const el = e.target.closest('[data-ctl]');
    if (!el || e.target.closest('.topbar')) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.learn-target').forEach((x) => x.classList.remove('learn-target'));
    el.classList.add('learn-target');
    this.learnTarget = el.dataset.ctl;
    this.onStatus?.(`LEARN: move a control for "${this.learnTarget}"`, true);
  }

  assign(key) {
    for (const k of Object.keys(this.map)) if (this.map[k] === this.learnTarget && k !== key) delete this.map[k];
    this.map[key] = this.learnTarget;
    const custom = JSON.parse(localStorage.getItem(STORE) || '{}');
    custom[key] = this.learnTarget;
    localStorage.setItem(STORE, JSON.stringify(custom));
    this.onStatus?.(`Mapped ${key} → ${this.learnTarget}`, true);
    document.querySelector('.learn-target')?.classList.remove('learn-target');
    this.learnTarget = null;
  }

  resetMap() {
    localStorage.removeItem(STORE);
    this.map = defaultMap();
  }

  // ---------- Input ----------
  onMessage(data) {
    const [status, d1, d2 = 0] = data;
    const type = status & 0xf0;
    if (type !== 0x90 && type !== 0x80 && type !== 0xb0) return;
    const isNote = type === 0x90 || type === 0x80;
    const noteStatus = isNote ? 0x90 | (status & 0x0f) : status;
    const key = keyOf(noteStatus, d1);

    if (this.learning && this.learnTarget) {
      if (!isNote || d2 > 0) this.assign(key);
      return;
    }

    const id = this.map[key];
    if (id) return this.dispatch(id, isNote, type === 0x90 && d2 > 0, d2);

    // Performance pads by note range
    if (isNote && noteStatus >= 0x97 && noteStatus <= 0x9a) {
      const deckIdx = (noteStatus - 0x97) >> 1;
      const shifted = ((noteStatus - 0x97) & 1) === 1;
      const mode = PAD_MODE_BY_NIBBLE[d1 >> 4];
      const pad = d1 & 0x07;
      const dui = this.deckUIs[deckIdx];
      if (!dui || !mode) return;
      const down = type === 0x90 && d2 > 0;
      if (down) dui.deck.padMode = mode;
      // Shifted pads arrive on their own status byte; mirror that into the deck's SHIFT state
      const prev = ui.midiShift[deckIdx];
      ui.midiShift[deckIdx] = shifted || prev;
      dui.padPress(pad, down);
      ui.midiShift[deckIdx] = prev;
      return;
    }
  }

  dispatch(id, isNote, down, value) {
    const c = registry.get(id);
    if (!c) return;
    if (c.type === 'button') c.press(isNote ? down : value > 63);
    else if (c.type === 'abs') c.set(value / 127);
    else if (c.type === 'rel') {
      // Supports both centre-64 (jog: 0x40 ± n) and two's-complement (browse: 1 / 127) encoders
      c.nudge(value > 96 ? value - 128 : value < 32 ? value : value - 64);
    }
  }

  // ---------- LED feedback ----------
  led(status, note, on) {
    for (const o of this.outputs) {
      try { o.send([status, note, on ? 0x7f : 0x00]); } catch {}
    }
  }

  syncLeds() {
    if (!this.outputs.length) return;
    this.deckUIs.forEach((dui, d) => {
      const deck = dui.deck;
      const st = this.lastLeds?.[d] || {};
      const next = {
        play: deck.playing,
        cue: deck.loaded && !deck.playing,
        sync: deck.synced,
        hc: deck.hotcues.map((x) => x != null).join(''),
      };
      if (next.play !== st.play) this.led(0x90 + d, 0x0b, next.play);
      if (next.cue !== st.cue) this.led(0x90 + d, 0x0c, next.cue);
      if (next.sync !== st.sync) this.led(0x90 + d, 0x58, next.sync);
      if (next.hc !== st.hc) deck.hotcues.forEach((x, p) => this.led(0x97 + d * 2, p, x != null));
      this.lastLeds ??= [];
      this.lastLeds[d] = next;
    });
  }
}
