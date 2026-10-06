// Track library: upload / drag-drop songs, analyse BPM + waveform, browse and load to decks.
// Everything stays in the browser — no files are uploaded to any server.
import { h } from './controls.js';
import { analyzeTrack } from '../audio/analysis.js';
import { fmtTime } from './deck-ui.js';
import { parseYouTubeId, fetchYouTubeTitle } from '../audio/youtube.js';

let nextId = 1;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm|aiff?|mp4)$/i;

function parseName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const m = base.split(/\s+[-–]\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  return { artist: '', title: base.trim() };
}

export class Library {
  constructor(engine, { onLoadTrack }) {
    this.engine = engine;
    this.onLoadTrack = onLoadTrack;
    this.tracks = [];
    this.selected = -1;
    this.queue = Promise.resolve();
    this.build();
  }

  build() {
    this.input = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
    this.input.addEventListener('change', () => {
      this.addFiles([...this.input.files]);
      this.input.value = '';
    });
    this.tbody = h('tbody');
    this.empty = h(
      'div',
      { class: 'lib-empty' },
      h('div', { class: 'lib-empty-icon' }, '♫'),
      h('div', {}, 'Drop songs here, click ', h('b', {}, '+ ADD SONGS'), ' or paste a YouTube link'),
      h('div', { class: 'mini' }, 'MP3 · WAV · M4A · FLAC · OGG — files never leave your computer')
    );
    const addBtn = h('button', { class: 'btn small add', type: 'button', onClick: () => this.input.click() }, '+ ADD SONGS');
    this.ytInput = h('input', { class: 'yt-input', type: 'url', placeholder: 'Paste a YouTube link…', 'aria-label': 'YouTube link' });
    const ytAdd = () => {
      const t = this.addYouTube(this.ytInput.value);
      if (t) this.ytInput.value = '';
      else this.ytInput.classList.add('bad');
    };
    this.ytInput.addEventListener('keydown', (e) => e.key === 'Enter' && ytAdd());
    this.ytInput.addEventListener('input', () => this.ytInput.classList.remove('bad'));
    const ytBtn = h('button', { class: 'btn small yt-add', type: 'button', onClick: ytAdd }, '▶ ADD YOUTUBE');
    const ytForm = h('div', { class: 'yt-form' }, this.ytInput, ytBtn);
    this.el = h(
      'section',
      { class: 'library' },
      h('div', { class: 'lib-head' }, h('div', { class: 'sec-label' }, 'COLLECTION'), ytForm, addBtn, this.input),
      h(
        'div',
        { class: 'lib-scroll' },
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'TITLE'), h('th', {}, 'ARTIST'), h('th', {}, 'BPM'), h('th', {}, 'TIME'), h('th', {}, 'LOAD'))), this.tbody),
        this.empty
      )
    );
    this.el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        this.el.classList.add('drop');
      }
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('drop');
      this.addFiles([...e.dataTransfer.files]);
    });
  }

  addFiles(files) {
    const added = [];
    for (const file of files) {
      if (!file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) continue;
      const { artist, title } = parseName(file.name);
      const t = { id: nextId++, file, fileName: file.name, title, artist, bpm: 0, firstBeat: 0, wave: null, duration: 0, status: 'queued' };
      this.tracks.push(t);
      added.push(t);
      this.queue = this.queue.then(() => this.analyze(t));
    }
    if (this.selected < 0 && this.tracks.length) this.selected = 0;
    this.render();
    return added;
  }

  /** Adds a YouTube link as a track. Returns the track, or null if the link isn't a YouTube video. */
  addYouTube(url) {
    const videoId = parseYouTubeId(url);
    if (!videoId) return null;
    const t = {
      id: nextId++, kind: 'youtube', videoId, fileName: url.trim(), title: `YouTube · ${videoId}`, artist: 'YouTube',
      bpm: 0, firstBeat: 0, wave: null, duration: 0, status: 'ready',
    };
    this.tracks.push(t);
    if (this.selected < 0) this.selected = 0;
    this.render();
    fetchYouTubeTitle(videoId).then((meta) => {
      if (!meta) return;
      t.title = meta.title;
      t.artist = meta.artist || 'YouTube';
      this.render();
    });
    return t;
  }

  async decode(t) {
    const ab = await t.file.arrayBuffer();
    return this.engine.ctx.decodeAudioData(ab);
  }

  async analyze(t) {
    try {
      t.status = 'analyzing';
      this.render();
      const buffer = await this.decode(t);
      const res = await analyzeTrack(buffer);
      t.wave = res.wave;
      t.bpm = res.bpm;
      t.firstBeat = res.firstBeat;
      t.duration = buffer.duration;
      t.status = 'ready';
    } catch (err) {
      console.error(err);
      t.status = 'error';
    }
    this.render();
    this.waiters?.get(t.id)?.forEach((fn) => fn());
    this.waiters?.delete(t.id);
  }

  waitReady(t) {
    if (t.status === 'ready' || t.status === 'error') return Promise.resolve();
    this.waiters ??= new Map();
    return new Promise((res) => {
      const list = this.waiters.get(t.id) || [];
      list.push(res);
      this.waiters.set(t.id, list);
    });
  }

  /** Decodes the track again (only loaded decks keep audio in memory) */
  async prepare(t) {
    if (t.kind === 'youtube') return t;
    await this.waitReady(t);
    if (t.status === 'error') throw new Error(`Could not decode ${t.fileName}`);
    const buffer = await this.decode(t);
    return { ...t, buffer };
  }

  find(id) {
    return this.tracks.find((t) => String(t.id) === String(id));
  }

  browse(dir) {
    if (!this.tracks.length) return;
    this.selected = Math.max(0, Math.min(this.tracks.length - 1, this.selected + dir));
    this.render();
    this.tbody.children[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  get selectedTrack() {
    return this.tracks[this.selected];
  }

  markLoaded(deckIdx, trackId) {
    this.loaded ??= [null, null];
    this.loaded[deckIdx] = trackId;
    this.render();
  }

  render() {
    this.empty.style.display = this.tracks.length ? 'none' : '';
    this.tbody.replaceChildren(
      ...this.tracks.map((t, i) => {
        const status =
          t.kind === 'youtube' && !t.bpm ? h('span', { class: 'yt-badge' }, 'YT')
          : t.status === 'ready' ? (t.bpm ? t.bpm.toFixed(2) : '—') : t.status === 'error' ? h('span', { class: 'err' }, 'error') : h('span', { class: 'spin' }, 'analysing…');
        const onDeck = (this.loaded || []).map((id, d) => (id === t.id ? d + 1 : null)).filter(Boolean);
        const tr = h(
          'tr',
          { class: `${i === this.selected ? 'sel' : ''} ${onDeck.length ? 'on-deck' : ''}`, draggable: 'true' },
          h('td', { class: 'num' }, onDeck.length ? h('span', { class: 'deck-badge' }, onDeck.join('·')) : String(i + 1)),
          h('td', { class: 'title' }, t.title),
          h('td', { class: 'artist' }, t.artist),
          h('td', { class: 'bpm' }, status),
          h('td', { class: 'time' }, t.duration ? fmtTime(t.duration).slice(0, 5) : ''),
          h(
            'td',
            { class: 'load' },
            h('button', { class: 'btn tiny', type: 'button', onClick: (e) => (e.stopPropagation(), this.onLoadTrack(0, t)) }, '1'),
            h('button', { class: 'btn tiny', type: 'button', onClick: (e) => (e.stopPropagation(), this.onLoadTrack(1, t)) }, '2')
          )
        );
        tr.addEventListener('click', () => {
          this.selected = i;
          this.render();
        });
        tr.addEventListener('dblclick', () => this.onLoadTrack(this.engine.decks[0].playing ? 1 : 0, t));
        tr.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/ravmix-track', String(t.id)));
        return tr;
      })
    );
  }
}
