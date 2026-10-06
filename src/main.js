import './styles.css';
import { Engine } from './audio/engine.js';
import { h, registry } from './ui/controls.js';
import { DeckUI, fmtTime } from './ui/deck-ui.js';
import { MixerUI } from './ui/mixer-ui.js';
import { Library } from './ui/library.js';
import { ScrollingWave, OverviewWave } from './ui/waveform.js';
import { ui } from './ui/state.js';
import { Midi } from './midi.js';

const app = document.getElementById('app');
const engine = new Engine();

// ---------- Power on (browsers need a click before audio can start) ----------
const power = h(
  'div',
  { class: 'power' },
  h('div', { class: 'power-card' },
    h('div', { class: 'logo big' }, 'ra', h('span', {}, 'V'), 'miX'),
    h('div', { class: 'power-sub' }, '2-DECK DJ CONTROLLER · DDJ-FLX4 LAYOUT'),
    h('button', { class: 'power-btn', type: 'button' }, '⏻'),
    h('div', { class: 'mini' }, 'Press to power on')
  )
);
app.append(power);
power.querySelector('.power-btn').addEventListener('click', async () => {
  power.classList.add('booting');
  try {
    await engine.init();
    await engine.ctx.resume();
    start();
    power.remove();
  } catch (err) {
    console.error(err);
    power.querySelector('.mini').textContent = `Audio failed to start: ${err.message}`;
  }
});

function start() {
  // ---------- Decks, mixer, library ----------
  const deckUIs = [new DeckUI(engine, engine.decks[0], 'left'), new DeckUI(engine, engine.decks[1], 'right')];

  const library = new Library(engine, { onLoadTrack: (d, t) => loadToDeck(d, t) });

  async function loadToDeck(d, t) {
    if (!t) return;
    const deck = engine.decks[d];
    if (deck.playing && engine.channels[d].state.fader > 0.05 && !confirm(`Deck ${d + 1} is playing. Load "${t.title}" anyway?`)) return;
    const dui = deckUIs[d];
    dui.title.textContent = `Loading ${t.title}…`;
    try {
      const prepared = await library.prepare(t);
      await deck.load(prepared);
      library.markLoaded(d, t.id);
    } catch (err) {
      alert(err.message);
      dui.title.textContent = 'Load failed';
    }
  }

  deckUIs.forEach((dui, d) => {
    dui.onLoadRequest = (id) => loadToDeck(d, library.find(id));
    dui.onFileDrop = (file) => {
      const [t] = library.addFiles([file]);
      if (t) loadToDeck(d, t);
    };
  });

  const mixer = new MixerUI(engine, {
    onLoad: (d) => loadToDeck(d, library.selectedTrack),
    onBrowse: (dir) => library.browse(dir),
  });

  // ---------- Waveforms ----------
  const waveCanvases = [h('canvas', { class: 'wave' }), h('canvas', { class: 'wave' })];
  const waves = waveCanvases.map((c, i) => new ScrollingWave(c, engine.decks[i], i === 0 ? '#19c3ff' : '#ff9f1a'));
  const overviews = deckUIs.map((dui) => new OverviewWave(dui.overview, dui.deck));
  const zoom = (f) => waves.forEach((w) => w.setZoom(w.zoom * f));
  const waveArea = h(
    'section',
    { class: 'waves' },
    h('div', { class: 'wave-row w1' }, h('span', { class: 'wave-tag' }, '1'), waveCanvases[0]),
    h('div', { class: 'wave-row w2' }, h('span', { class: 'wave-tag' }, '2'), waveCanvases[1]),
    h('div', { class: 'zoom' }, h('button', { class: 'btn tiny', type: 'button', title: 'Zoom in', onClick: () => zoom(1 / 1.4) }, '+'), h('button', { class: 'btn tiny', type: 'button', title: 'Zoom out', onClick: () => zoom(1.4) }, '−'))
  );

  // ---------- Top bar ----------
  const qBtn = h('button', { class: 'btn small', type: 'button', title: 'Quantize: snap cues, loops and jumps to the beat grid' }, 'QUANTIZE');
  qBtn.addEventListener('click', () => {
    engine.quantize = !engine.quantize;
    qBtn.classList.toggle('lit', engine.quantize);
    engine.decks.forEach((d) => d.emit());
  });
  qBtn.classList.toggle('lit', engine.quantize);

  const recTime = h('span', { class: 'rec-time' }, '');
  const recBtn = h('button', { class: 'btn small rec', type: 'button', title: 'Record the master output and download it' }, h('span', { class: 'rec-dot' }), 'REC', recTime);
  recBtn.addEventListener('click', () => (engine.recorder ? engine.stopRecording() : engine.startRecording()));
  engine.on(() => recBtn.classList.toggle('lit', !!engine.recorder));

  const midiStatus = h('span', { class: 'midi-status' }, 'MIDI: off');
  const midi = new Midi({
    deckUIs,
    onStatus: (text, ok) => {
      midiStatus.textContent = text;
      midiStatus.classList.toggle('ok', !!ok);
    },
  });
  const midiBtn = h('button', { class: 'btn small', type: 'button', title: 'Connect a MIDI controller (e.g. your DDJ-FLX4 over USB)' }, 'CONNECT MIDI');
  midiBtn.addEventListener('click', async () => {
    try {
      await midi.connect();
      midiBtn.classList.add('lit');
    } catch (err) {
      alert(err.message);
    }
  });
  const learnBtn = h('button', { class: 'btn small', type: 'button', title: 'Click an on-screen control, then move the hardware control' }, 'MIDI LEARN');
  learnBtn.addEventListener('click', () => {
    if (!midi.access) return alert('Connect MIDI first.');
    midi.setLearning(!midi.learning);
    learnBtn.classList.toggle('lit', midi.learning);
    if (!midi.learning) midi.bind();
  });

  const settingsBtn = h('button', { class: 'btn small', type: 'button' }, '⚙ AUDIO');
  settingsBtn.addEventListener('click', () => openSettings());
  const helpBtn = h('button', { class: 'btn small', type: 'button' }, '? KEYS');
  helpBtn.addEventListener('click', () => toggleHelp());

  const topbar = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'logo' }, 'ra', h('span', {}, 'V'), 'miX'),
    h('div', { class: 'model' }, 'DDJ-FLX4 · WEB'),
    h('div', { class: 'spacer' }),
    qBtn, recBtn, midiStatus, midiBtn, learnBtn, settingsBtn, helpBtn
  );

  const controller = h('main', { class: 'controller' }, deckUIs[0].el, mixer.el, deckUIs[1].el);
  app.append(topbar, waveArea, library.el, controller);

  // ---------- Settings (audio outputs) ----------
  async function openSettings() {
    const devices = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) || [];
    const outs = devices.filter((d) => d.kind === 'audiooutput');
    const opts = () => outs.map((d, i) => h('option', { value: d.deviceId }, d.label || `Output ${i + 1}`));
    const masterSel = h('select', {}, opts());
    const hpMode = h(
      'select',
      {},
      h('option', { value: 'off' }, 'Off (master only)'),
      h('option', { value: 'split' }, 'Split cable — Left: cue, Right: master'),
      h('option', { value: 'ch34' }, 'Controller sound card — outputs 3/4 (DDJ-FLX4 headphones)'),
      h('option', { value: 'device' }, 'Second output device')
    );
    hpMode.value = engine.state.hpMode;
    const hpSel = h('select', {}, opts());
    const note = h('div', { class: 'mini' });
    const canSink = !!engine.ctx.setSinkId;
    const modal = h(
      'div',
      { class: 'modal' },
      h('div', { class: 'modal-card' },
        h('h3', {}, 'Audio outputs'),
        h('label', {}, 'Master output', masterSel),
        h('label', {}, 'Headphones (CUE)', hpMode),
        h('label', { class: 'hp-dev' }, 'Headphone device', hpSel),
        note,
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onClick: async () => {
            try {
              const s = await navigator.mediaDevices.getUserMedia({ audio: true });
              s.getTracks().forEach((t) => t.stop());
              modal.remove();
              openSettings();
            } catch (err) { note.textContent = err.message; }
          } }, 'Show device names'),
          h('button', { class: 'btn small', type: 'button', onClick: () => { midi.resetMap(); note.textContent = 'MIDI map reset to DDJ-FLX4 defaults.'; } }, 'Reset MIDI map'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn small lit', type: 'button', onClick: () => modal.remove() }, 'Done')
        )
      )
    );
    const refresh = () => {
      modal.querySelector('.hp-dev').style.display = hpMode.value === 'device' ? '' : 'none';
      note.textContent = !canSink
        ? 'This browser cannot pick output devices — use Chrome or Edge for headphone cueing.'
        : `Output channels available: ${engine.ctx.destination.maxChannelCount}. Pick your DDJ-FLX4 as master output, then “outputs 3/4” to cue in its headphone jack.`;
    };
    masterSel.addEventListener('change', async () => {
      try { await engine.setMasterDevice(masterSel.value); refresh(); } catch (err) { note.textContent = err.message; }
    });
    const applyHp = async () => {
      try {
        await engine.setHeadphoneMode(hpMode.value, hpSel.value);
        if (hpMode.value === 'ch34' && engine.state.hpMode !== 'ch34') {
          note.textContent = 'The selected master device has only 2 outputs — choose your controller as the master output first.';
          hpMode.value = 'off';
        }
      } catch (err) { note.textContent = err.message; }
      refresh();
    };
    hpMode.addEventListener('change', applyHp);
    hpSel.addEventListener('change', applyHp);
    modal.addEventListener('pointerdown', (e) => e.target === modal && modal.remove());
    document.body.append(modal);
    refresh();
  }

  // ---------- Keyboard ----------
  const KEYMAP = {
    KeyZ: 'd1.cue', KeyX: 'd1.play', KeyC: 'd1.sync', KeyV: 'd1.masterTempo',
    KeyA: 'd1.loopIn', KeyS: 'd1.loopOut', KeyD: 'd1.reloop',
    Digit1: 'd1.pad1', Digit2: 'd1.pad2', Digit3: 'd1.pad3', Digit4: 'd1.pad4',
    KeyQ: 'd1.pad5', KeyW: 'd1.pad6', KeyE: 'd1.pad7', KeyR: 'd1.pad8',
    KeyM: 'd2.cue', Comma: 'd2.play', Period: 'd2.sync', Slash: 'd2.masterTempo',
    KeyJ: 'd2.loopIn', KeyK: 'd2.loopOut', KeyL: 'd2.reloop',
    Digit7: 'd2.pad1', Digit8: 'd2.pad2', Digit9: 'd2.pad3', Digit0: 'd2.pad4',
    KeyU: 'd2.pad5', KeyI: 'd2.pad6', KeyO: 'd2.pad7', KeyP: 'd2.pad8',
    KeyF: 'fx.on', BracketLeft: 'load1', BracketRight: 'load2',
  };
  const held = new Set();
  const typing = (e) => /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey) return;
    if (e.key === 'Shift') {
      ui.keyShift = true;
      ui.emit();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const xf = registry.get('crossfader');
      const dir = e.code === 'ArrowLeft' ? -1 : 1;
      xf.set(e.shiftKey ? (dir < 0 ? 0 : 1) : xf.get() + dir * 0.05);
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      library.browse(e.code === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.code === 'KeyH') return toggleHelp();
    const id = KEYMAP[e.code];
    if (!id || held.has(e.code)) return;
    e.preventDefault();
    held.add(e.code);
    registry.get(id)?.press(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      ui.keyShift = false;
      ui.emit();
      return;
    }
    const id = KEYMAP[e.code];
    if (!id || !held.has(e.code)) return;
    held.delete(e.code);
    registry.get(id)?.press(false);
  });
  window.addEventListener('blur', () => {
    ui.keyShift = false;
    held.forEach((code) => registry.get(KEYMAP[code])?.press(false));
    held.clear();
    ui.emit();
  });

  let helpEl = null;
  function toggleHelp() {
    if (helpEl) {
      helpEl.remove();
      helpEl = null;
      return;
    }
    const row = (k, v) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v));
    helpEl = h(
      'div',
      { class: 'modal' },
      h('div', { class: 'modal-card wide' },
        h('h3', {}, 'Keyboard shortcuts'),
        h('div', { class: 'help-cols' },
          h('table', {}, h('caption', {}, 'DECK 1'), row('Z', 'CUE (hold to preview)'), row('X', 'PLAY / PAUSE'), row('C', 'BEAT SYNC'), row('V', 'MASTER TEMPO'), row('A / S / D', 'LOOP IN / OUT / RELOOP'), row('1-4, Q-R', 'Pads 1-8')),
          h('table', {}, h('caption', {}, 'DECK 2'), row('M', 'CUE'), row(',', 'PLAY / PAUSE'), row('.', 'BEAT SYNC'), row('/', 'MASTER TEMPO'), row('J / K / L', 'LOOP IN / OUT / RELOOP'), row('7-0, U-P', 'Pads 1-8')),
          h('table', {}, h('caption', {}, 'GLOBAL'), row('Shift', 'SHIFT (hold)'), row('← →', 'Crossfader (+Shift: snap)'), row('↑ ↓', 'Browse collection'), row('[ / ]', 'Load to deck 1 / 2'), row('F', 'Beat FX on/off'), row('H', 'This help'))
        ),
        h('p', { class: 'mini' }, 'Mouse: drag knobs/faders vertically (Shift = fine), double-click to reset, scroll wheel works too. Jog: drag the platter to scratch, the outer ring to nudge, Shift+drag to search. Click the on-screen SHIFT to latch it for one action.'),
        h('div', { class: 'row' }, h('div', { class: 'spacer' }), h('button', { class: 'btn small lit', type: 'button', onClick: () => toggleHelp() }, 'Close'))
      )
    );
    helpEl.addEventListener('pointerdown', (e) => e.target === helpEl && toggleHelp());
    document.body.append(helpEl);
  }

  // ---------- Render loop ----------
  function frame() {
    deckUIs.forEach((d) => d.frame());
    waves.forEach((w) => w.draw());
    overviews.forEach((o) => o.draw());
    mixer.frame();
    midi.syncLeds();
    recTime.textContent = engine.recorder ? ` ${fmtTime((performance.now() - engine.recStart) / 1000).slice(0, 5)}` : '';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.ravmix = { engine, library, deckUIs, midi }; // handy for debugging in the console
}
