// YouTube as a deck source, via the official IFrame Player API.
// YouTube audio can't be routed into Web Audio (cross-origin iframe), so a YouTube deck supports
// transport, cues, loops, tempo and volume (fader / crossfader / master) — but not EQ, FX,
// scratching, waveforms or headphone cue.

let apiPromise = null;

export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player (are you offline?)'));
    };
    document.head.append(s);
  });
  return apiPromise;
}

export function parseYouTubeId(text) {
  if (!text) return null;
  text = text.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const u = new URL(text);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

/** Best-effort title lookup (falls back to the player's own metadata once loaded). */
export async function fetchYouTubeTitle(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title, artist: j.author_name };
  } catch {
    return null;
  }
}

const ERRORS = {
  2: 'Invalid YouTube link.',
  5: 'This video cannot be played in an embedded player.',
  100: 'Video not found (removed or private).',
  101: "The video's owner doesn't allow it to be played on other websites.",
  150: "The video's owner doesn't allow it to be played on other websites.",
};

export class YouTubeSource {
  constructor(host) {
    this.host = host;
    this.player = null;
    this.state = -1;
    this.onEnded = null;
    this.onError = null;
  }

  async ensurePlayer(videoId) {
    const YT = await loadYouTubeApi();
    if (this.player) return;
    const mount = document.createElement('div');
    this.host.replaceChildren(mount);
    await new Promise((resolve, reject) => {
      this.player = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => {
            this.state = e.data;
            if (e.data === YT.PlayerState.ENDED) this.onEnded?.();
          },
          onError: (e) => {
            const err = new Error(ERRORS[e.data] || `YouTube error ${e.data}`);
            this.lastError = err;
            this.onError?.(err);
            reject(err);
          },
        },
      });
    });
    this.fresh = true;
  }

  async load(videoId) {
    this.lastError = null;
    this.videoId = videoId;
    const isNew = !this.player;
    await this.ensurePlayer(videoId);
    if (!isNew) this.player.cueVideoById(videoId);
    // Duration is often unknown until playback starts: briefly play muted to read it.
    const p = this.player;
    const t0 = performance.now();
    while (!(p.getDuration() > 0)) {
      if (this.lastError) throw this.lastError;
      if (performance.now() - t0 > 1500 && this.state !== 1) {
        p.mute();
        p.playVideo();
      }
      if (performance.now() - t0 > 15000) throw new Error('YouTube video did not load.');
      await new Promise((r) => setTimeout(r, 100));
    }
    p.pauseVideo();
    p.seekTo(0, true);
    p.unMute();
    const data = p.getVideoData?.() || {};
    return { duration: p.getDuration(), title: data.title, artist: data.author };
  }

  get time() {
    return this.player?.getCurrentTime?.() || 0;
  }

  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seek(sec) { this.player?.seekTo(sec, true); }

  setRate(rate) {
    if (!this.player) return;
    // YouTube rounds to the nearest rate it supports; report what it actually uses.
    this.player.setPlaybackRate(rate);
  }

  get actualRate() {
    return this.player?.getPlaybackRate?.() || 1;
  }

  setVolume(v) {
    if (!this.player?.setVolume) return;
    const vol = Math.round(Math.max(0, Math.min(1, v)) * 100);
    if (vol !== this.lastVol) {
      this.player.setVolume(vol);
      this.lastVol = vol;
    }
  }

  stop() {
    try { this.player?.stopVideo(); } catch {}
  }
}
