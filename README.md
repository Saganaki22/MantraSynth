# MantraSynth

MantraSynth is a browser-based vocal/formant synth workstation with an animated vowel avatar, XY vowel pad, step sequencer, synth keys, audio/MIDI import, Basic Pitch ONNX conversion, WAV/MIDI/JSON export, and starter groove presets.

Repository: https://github.com/Saganaki22/MantraSynth

License: Apache-2.0

## Features

- Animated vowel performer with I/E/A/O controls
- 64-step sequencer with per-step vowel labels and accent dynamics
- Hold-to-sustain C3-C4 keyboard
- Starter groove presets with BPM, voice, gate, vowels, and accents
- Gate, voice, glide, vowel glide, delay, formant, gain, and output meter
- Audio upload to Basic Pitch ONNX with WebGPU attempt and WASM fallback
- MIDI upload with tempo import when available
- WAV, MIDI, and project JSON export/import

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Run Locally

### Windows PowerShell

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

### macOS / Linux

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Build

### Windows PowerShell

```powershell
npm run build
npm run preview
```

### macOS / Linux

```bash
npm run build
npm run preview
```

The production files are written to `dist/`.

## Checks

```bash
npm run lint
npm run build
npm run test:basic-pitch
```

## Notes

- The Basic Pitch model must exist at `public/models/basic-pitch/nmp.onnx`.
- WebGPU is used when available; otherwise conversion falls back to ONNX Runtime WASM.
- Long audio imports are trimmed to the first supported grid section.
- MIDI import skips ONNX and maps notes directly into the MantraSynth grid.
