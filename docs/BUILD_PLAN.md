# ChantPad Build Plan

## Research Notes

- Delay Lama was a VST instrument with monophonic vocal synthesis, real-time animated 3D interface, a pitch/vowel XY pad, glide, delay mix, and voice character controls. The original documentation says the Y axis controlled vowel and the X axis controlled pitch, with MIDI pitch bend acting as a high-resolution vowel control.
- Current Delay Lama-inspired work points toward formant/FOF-style synthesis. MonkSynth describes itself as a monophonic vocal synth using formant-wave-function synthesis, with XY pitch/vowel control, stereo delay, ADSR, unison, and theming.
- Web Audio is the browser foundation for audio graphs, sources, effects, visualization, and synthesis. Tone.js gives us musical timing, transport, BPM, loop points, and scheduled events.
- For upload conversion, Spotify Basic Pitch is the practical starting point: it converts audio into MIDI using a lightweight ML model and supports polyphony and pitch bends. Full mixed songs will still need optional source separation before transcription.

Useful sources:

- https://techno-id-archives.lebibliophage.com/freewares_2005/delay_lama/delay_lama_documentation.html
- https://www.kvraudio.com/product/delay_lama_by_audionerdz
- https://github.com/JonET/monksynth
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- https://tonejs.github.io/docs/14.7.28/Transport
- https://engineering.atspotify.com/2022/6/meet-basic-pitch
- https://github.com/spotify/basic-pitch

## Product Shape

Working title: ChantPad.

Other possible names:

- Formant Forge
- Vowelmancer
- Echo Chanter
- Aahdio
- Vox Shrine
- Mouth Machine
- ChantGrid
- Delay Sage

We should avoid directly copying the Delay Lama name, monk character, Tibetan flag interface, or original artwork. The safer route is an original stylized singer/performer with a playful, mystical-synth feel.

## App Architecture

Frontend:

- React + TypeScript + Vite
- Tone.js for the first playable prototype: transport, scheduling, preview synth, feedback delay
- Web Audio API and AudioWorklet for the production synth engine
- IndexedDB for saved projects and uploaded/transcribed files
- Optional Zustand or Jotai once state gets too large for local React state

Audio engine:

1. Current engine: browser Web Audio FOF/formant-grain voice adapted from the MIT MonkSynth DSP approach.
2. Voice model: vowel morphing across AA, OO, EE, II, plus closed/idle.
3. Output chain: dry signal, feedback delay, gain control, and compressor/limiter.
4. Future engine path: move the buffer/grain renderer into an AudioWorklet if live polyphony or dense upload playback needs lower latency.
4. Controls: pitch, vowel, glide, vibrato, voice character, formant resonance, delay time, delay mix, feedback, ADSR, master gain.
5. Render/export: offline render to WAV, export MIDI, save project JSON.

Sequencer:

- 16-step MVP, then expandable piano-roll timeline.
- Per-note velocity, duration, vowel automation, pitch bends, and delay automation.
- Record modes: live keyboard input, XY pad automation, uploaded MIDI/transcription import.
- Editing: delete, duplicate, quantize, undo/redo, loop region, snap grid.

Upload conversion:

1. Upload audio.
2. Decode and preview waveform.
3. If the source is a full song, optionally run source separation on a backend to isolate vocals/leads.
4. Run transcription with the vendored Basic Pitch ONNX model in `public/models/basic-pitch/nmp.onnx`.
5. Convert notes, pitch bends, and timing into editable timeline events.
6. Infer vowel automation from spectral shape when possible, or assign a vowel pattern.
7. Render the detected notes through our formant synth engine.

Important limitation: converting any complete song into a clean synth song will never be perfect. Single instruments, vocals, and clean leads will work best. Full mixes will need source separation and manual cleanup.

## Files In This Scaffold

- `src/App.tsx`: main workstation shell and interactions.
- `src/audio/monkVoice.ts`: MonkSynth-style FOF/formant-grain Web Audio engine.
- `src/workers/basicPitch.worker.ts`: ONNX transcription worker with WebGPU/WASM fallback.
- `src/App.css`: layout, animated placeholder performer, sequencer, keyboard, knobs, upload area.
- `src/index.css`: global palette and base rendering.
- `README.md`: project quick start.
- `docs/BUILD_PLAN.md`: this plan.

## Assets To Generate With GPT Image 2

Use a consistent style guide before generating any final frames:

- Camera: front-facing 3/4 bust, same crop, same lighting, transparent background where possible.
- Style: playful 3D-rendered character, polished but not uncanny, original clothing and symbols.
- Palette: warm skin tones, red/orange accent fabric, teal/green/gold controls, parchment/off-white UI materials.
- Avoid: the original Delay Lama character, exact clothing, the Tibetan flag, original UI shapes, and any religious/person-specific likeness.

Character assets:

- Performer neutral/idle full bust, 1024px or 1536px square source.
- Mouth pose frames: closed, OO, AA, EE, II, wide singing, smile.
- Eye/brow expression frames: neutral, focused, excited.
- Optional hand pose layer if we want hands moving separately.
- Sprite sheet or layered transparent PNGs, then convert to WebP/AVIF for runtime.

Interface assets:

- App icon and favicon.
- Brand wordmark or compact mark.
- Vowel pad texture, original geometric design.
- Knob caps, 60-frame filmstrip only if CSS knobs are not enough.
- Slider/fader handles.
- Transport button surface texture, if we want a tactile skeuomorphic version.
- Empty upload illustration.
- Waveform and timeline accent textures.

Audio/demo assets:

- A short internal demo sequence.
- A few preset patches: Classic Chant, Deep Drone, Bright Lead, Echo Hook.
- Optional dry one-note renders for testing formant consistency.

Optimization:

- Keep source PNGs in `assets/source`.
- Convert runtime character frames to WebP at 1x and 2x sizes.
- Use sprite sheets for animation to avoid many network requests.
- Keep UI icons as SVG/lucide unless a bitmap texture is needed.

## What We Still Need To Decide

- Final app name and legal-safe visual identity.
- Whether upload transcription runs fully in-browser, on a local/server backend, or both.
- Whether source separation is in scope for v1.
- Whether users can export WAV, MIDI, stems, or project files.
- How project saving works: local-only IndexedDB, cloud accounts, or simple file export.
- Mobile behavior for keyboard and timeline editing.
- Accessibility for keyboard operation, screen reader labels, and reduced-motion animation.
- Privacy copy for uploaded audio.
- Copyright rules for user-uploaded commercial songs.
- Undo/redo history.
- Preset browser and patch sharing.
- Tempo/key detection for uploads.
- Quantize strength, swing, scale lock, and note cleanup tools.
- Latency calibration for recording.
- Autoplay/audio unlock handling across browsers.
- Performance budget for AudioWorklet and animated WebP frames.
