# raVmiX — browser DJ controller (DDJ-FLX4 layout)

A two-deck DJ mixer that runs entirely in the browser (Web Audio API). Upload two (or more) songs, load one on each deck and mix. No server is needed — audio files never leave your computer.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Press the power button, click **+ ADD SONGS** (or drag files onto the collection / a deck display), then use the **1 / 2** buttons to load tracks. Use Chrome or Edge for the full feature set (MIDI, output-device selection).

## Controls (all on-screen, mirroring the DDJ-FLX4)

| Section | Controls |
|---|---|
| Deck | PLAY/PAUSE (Shift: stutter), CUE (Pioneer cue behaviour, Shift: to start), SHIFT, BEAT SYNC (Shift: tempo range ±6/10/16%/WIDE), MASTER TEMPO (key lock), tempo fader, jog wheel (scratch / pitch bend / Shift-search) |
| Loop | IN (Shift: 4-beat loop), OUT, RELOOP/EXIT, ½X / 2X (beat jump ±4 when no loop) |
| Pads (8 modes) | HOT CUE, PAD FX1 (rolls, echo, trans, reverb), BEAT JUMP, SAMPLER, and with Shift: KEYBOARD, PAD FX2 (sweeps, flanger, phaser, brake, backspin), BEAT LOOP, KEY SHIFT |
| Mixer | TRIM, HI/MID/LOW EQ (full kill), CFX filter, channel CUE (headphones), channel faders, level meters, crossfader (smooth/scratch/thru curves), SMART FADER (bass swap) |
| Master | MASTER level + stereo meter, MASTER CUE, HP MIX, HP LEVEL, SAMPLER volume, MIC level/on |
| Beat FX | Delay, Echo, Ping Pong, Spiral, Reverb, Trans, Filter, Flanger, Phaser, HPF/LPF sweep — beat-synced, BEAT ◀ ▶, channel 1/2/Master, LEVEL/DEPTH, ON |
| Extras | Automatic BPM + beat grid, 3-band scrolling waveforms, Quantize, mix recording (REC → downloads file), keyboard shortcuts (press **H**) |

### YouTube links
Paste a YouTube link into **Paste a YouTube link… → ▶ ADD YOUTUBE** (or drag a link onto a deck) and load it like any song. It plays through YouTube's official embedded player, so the audio can't enter the mixer. On a YouTube deck you get play/cue, hot cues, loops, beat jump, tempo (YouTube rounds to 5% steps and keeps the key), and volume via trim/fader/crossfader/master. EQ, CFX, FX, scratching, waveform, BPM detection and headphone cue are not available. Double-click the BPM to enter it for BEAT SYNC. Videos whose owners disable embedding won't play. The player runs in privacy-enhanced mode (youtube-nocookie.com), so it doesn't use your signed-in YouTube account — two YouTube decks won't trigger Premium/Family "too many devices streaming" limits, but YouTube may show ads.

### Headphone cueing
⚙ AUDIO → Headphones: *split cable* (L = cue, R = master), *controller outputs 3/4* (a real DDJ-FLX4 used as the sound card), or a *second output device*.

### Real DDJ-FLX4 over USB
Click **CONNECT MIDI**. A default FLX4 map is built in; if any control doesn't respond, click **MIDI LEARN**, click the on-screen control, then move the hardware control. Mappings are saved in the browser.

## Deploy to Vercel

```bash
git init && git add . && git commit -m "raVmiX DJ controller"
gh repo create ravmix --private --source=. --push     # or create the repo on github.com and push
```

In Vercel: **Add New → Project → import the repo**. It auto-detects Vite (build `npm run build`, output `dist`). No environment variables are needed.

## Project layout

```
public/worklets/deck-processor.js  audio-thread playback: tempo, key lock (granular time-stretch), scratch, loops, slip
src/audio/   engine (mixer/routing/recording), deck, fx, sampler, analysis (BPM/waveform)
src/ui/      knobs/faders/buttons, jog, waveforms, deck/mixer panels, library
src/midi.js  Web MIDI + MIDI Learn
```
