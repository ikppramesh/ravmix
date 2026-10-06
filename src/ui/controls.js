// Reusable controller widgets (knob, fader, button) + a registry so every control
// can be driven by the keyboard and by MIDI (incl. MIDI Learn).

export const registry = new Map();

/** type: 'button' (press(down)), 'abs' (set(0..1)), 'rel' (nudge(delta)) */
export function register(id, def) {
  registry.set(id, { id, ...def });
  if (def.el) def.el.dataset.ctl = id;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function knob({ id, label, value = 0.5, def = 0.5, bipolar = false, size = 'md', color, onChange, format }) {
  let v = value;
  const A0 = (-225 * Math.PI) / 180;
  const A1 = (45 * Math.PI) / 180;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('d', arcPath(24, 24, 21, A0, A1));
  track.setAttribute('class', 'knob-track');
  const val = document.createElementNS(svgNS, 'path');
  val.setAttribute('class', 'knob-val');
  if (color) val.style.stroke = color;
  svg.append(track, val);
  const cap = h('div', { class: 'knob-cap' }, h('div', { class: 'knob-line' }));
  const body = h('div', { class: 'knob-body' }, svg, cap);
  const readout = h('div', { class: 'knob-readout' });
  const el = h('div', { class: `knob knob-${size}`, title: `${label || ''} — drag, scroll, double-click to reset` }, body, label ? h('div', { class: 'knob-label' }, label) : null, readout);

  function render() {
    const a = A0 + (A1 - A0) * v;
    cap.style.transform = `rotate(${(a * 180) / Math.PI + 90}deg)`;
    const mid = A0 + (A1 - A0) * 0.5;
    if (bipolar) {
      if (Math.abs(v - 0.5) < 0.004) val.setAttribute('d', '');
      else val.setAttribute('d', v > 0.5 ? arcPath(24, 24, 21, mid, a) : arcPath(24, 24, 21, a, mid));
    } else {
      val.setAttribute('d', v < 0.004 ? '' : arcPath(24, 24, 21, A0, a));
    }
    readout.textContent = format ? format(v) : '';
  }

  function set(nv, fire = true) {
    nv = clamp01(nv);
    if (bipolar && Math.abs(nv - 0.5) < 0.012) nv = 0.5; // centre detent
    if (nv === v && fire) return;
    v = nv;
    render();
    if (fire) onChange?.(v);
  }

  let drag = null;
  body.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('learning')) return;
    e.preventDefault();
    body.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v };
    el.classList.add('active');
  });
  body.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sens = e.shiftKey ? 800 : 180;
    set(drag.v + (drag.y - e.clientY) / sens);
  });
  const end = () => {
    drag = null;
    el.classList.remove('active');
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  body.addEventListener('dblclick', () => set(def));
  body.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      set(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03));
    },
    { passive: false }
  );
  render();
  const api = { el, set, get: () => v };
  if (id) register(id, { type: 'abs', el, set: (x) => set(x), get: () => v });
  return api;
}

export function fader({ id, orient = 'v', value = 0, def, label, cls = '', ticks = 0, onChange, centerMark = false }) {
  let v = value;
  const cap = h('div', { class: 'fader-cap' });
  const slot = h('div', { class: 'fader-slot' });
  const tickEls = [];
  for (let i = 0; i <= ticks; i++) tickEls.push(h('div', { class: 'fader-tick', style: { [orient === 'v' ? 'top' : 'left']: `${(i / ticks) * 100}%` } }));
  const trackEl = h('div', { class: 'fader-track' }, slot, ...(ticks ? tickEls : []), centerMark ? h('div', { class: 'fader-center' }) : null, cap);
  const el = h('div', { class: `fader fader-${orient} ${cls}` }, trackEl, label ? h('div', { class: 'fader-label' }, label) : null);

  function render() {
    const pct = v * 100;
    if (orient === 'v') cap.style.top = `${pct}%`;
    else cap.style.left = `${pct}%`;
  }
  function set(nv, fire = true) {
    nv = clamp01(nv);
    if (nv === v && fire) return;
    v = nv;
    render();
    if (fire) onChange?.(v);
  }
  function posToValue(e) {
    const r = trackEl.getBoundingClientRect();
    return orient === 'v' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  }
  let drag = null;
  trackEl.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('learning')) return;
    e.preventDefault();
    trackEl.setPointerCapture(e.pointerId);
    if (e.target === cap) drag = { start: posToValue(e), v, fine: e.shiftKey };
    else {
      set(posToValue(e));
      drag = { start: posToValue(e), v, fine: false };
    }
    el.classList.add('active');
  });
  trackEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = posToValue(e) - drag.start;
    set(drag.v + d * (e.shiftKey ? 0.15 : 1));
  });
  const end = () => {
    drag = null;
    el.classList.remove('active');
  };
  trackEl.addEventListener('pointerup', end);
  trackEl.addEventListener('pointercancel', end);
  if (def != null) trackEl.addEventListener('dblclick', () => set(def));
  trackEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = (orient === 'v' ? e.deltaY : e.deltaX || e.deltaY) > 0 ? 1 : -1;
      set(v + d * (e.shiftKey ? 0.003 : 0.02));
    },
    { passive: false }
  );
  render();
  const api = { el, set, get: () => v };
  if (id) register(id, { type: 'abs', el, set: (x) => set(x), get: () => v });
  return api;
}

/** Momentary/toggle button. onDown/onUp receive the pointer event (or null from MIDI/keyboard). */
export function button({ id, label, sub, cls = '', onDown, onUp, title }) {
  const el = h(
    'button',
    { class: `btn ${cls}`, type: 'button', title: title || label },
    h('span', { class: 'btn-label' }, label),
    sub ? h('span', { class: 'btn-sub' }, sub) : null
  );
  let down = false;
  const press = (isDown, e) => {
    if (isDown === down) return;
    down = isDown;
    el.classList.toggle('pressed', isDown);
    if (isDown) onDown?.(e);
    else onUp?.(e);
  };
  el.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('learning')) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    press(true, e);
  });
  el.addEventListener('pointerup', (e) => press(false, e));
  el.addEventListener('pointercancel', (e) => press(false, e));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  if (id) register(id, { type: 'button', el, press: (d) => press(d, null) });
  return { el, press, setLit: (on, cls2 = 'lit') => el.classList.toggle(cls2, !!on), setLabel: (t) => (el.querySelector('.btn-label').textContent = t) };
}
