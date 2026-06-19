import { readFile } from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

const SAMPLE_RATE = 22050
const FFT_HOP = 256
const WINDOW_SAMPLES = 43844
const ANNOTATION_FRAMES = 172
const NOTE_BINS = 88
const MIDI_OFFSET = 21
const OVERLAP_FRAMES = 30
const HOP_SAMPLES = WINDOW_SAMPLES - OVERLAP_FRAMES * FFT_HOP
const INPUT_NAME = 'serving_default_input_2:0'
const NOTE_OUTPUT = 'StatefulPartitionedCall:1'
const ONSET_OUTPUT = 'StatefulPartitionedCall:2'
const CONTOUR_OUTPUT = 'StatefulPartitionedCall:0'

function synthTestAudio() {
  const duration = 5
  const output = new Float32Array(duration * SAMPLE_RATE)
  const notes = [
    { start: 0.25, end: 1.05, frequency: 220 },
    { start: 1.15, end: 1.9, frequency: 261.625565 },
    { start: 2.05, end: 2.8, frequency: 329.627557 },
    { start: 2.95, end: 3.75, frequency: 391.995436 },
    { start: 3.9, end: 4.65, frequency: 440 },
  ]

  for (const note of notes) {
    const start = Math.floor(note.start * SAMPLE_RATE)
    const end = Math.floor(note.end * SAMPLE_RATE)
    for (let index = start; index < end; index += 1) {
      const t = (index - start) / SAMPLE_RATE
      const age = index - start
      const remaining = end - index
      const attack = Math.min(1, age / (SAMPLE_RATE * 0.02))
      const release = Math.min(1, remaining / (SAMPLE_RATE * 0.08))
      const envelope = Math.min(attack, release)
      const phase = 2 * Math.PI * note.frequency * t
      output[index] +=
        envelope *
        0.32 *
        (Math.sin(phase) + Math.sin(phase * 2) * 0.36 + Math.sin(phase * 3) * 0.18)
    }
  }

  return output
}

function outputValue(data, frame, pitch) {
  return data[frame * NOTE_BINS + pitch] ?? 0
}

function extractNotes(noteData, onsetData, windowStartSeconds) {
  const notes = []
  const secondsPerFrame = FFT_HOP / SAMPLE_RATE

  for (let pitch = 0; pitch < NOTE_BINS; pitch += 1) {
    let frame = 0
    while (frame < ANNOTATION_FRAMES) {
      const note = outputValue(noteData, frame, pitch)
      const onset = outputValue(onsetData, frame, pitch)
      const previousOnset = frame > 0 ? outputValue(onsetData, frame - 1, pitch) : 0
      const nextOnset = frame < ANNOTATION_FRAMES - 1 ? outputValue(onsetData, frame + 1, pitch) : 0
      const localPeak = onset >= previousOnset && onset >= nextOnset

      if ((onset >= 0.48 && note >= 0.22 && localPeak) || note >= 0.78) {
        const startFrame = frame
        let endFrame = frame + 1
        let velocitySum = note

        while (endFrame < ANNOTATION_FRAMES && outputValue(noteData, endFrame, pitch) > 0.22) {
          velocitySum += outputValue(noteData, endFrame, pitch)
          endFrame += 1
        }

        if (endFrame - startFrame >= 4) {
          notes.push({
            start: windowStartSeconds + startFrame * secondsPerFrame,
            end: windowStartSeconds + endFrame * secondsPerFrame,
            midi: MIDI_OFFSET + pitch,
            velocity: Math.max(0.25, Math.min(1, velocitySum / (endFrame - startFrame))),
          })
        }

        frame = endFrame + 1
      } else {
        frame += 1
      }
    }
  }

  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi)
}

function dedupeNotes(notes) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi)
  const deduped = []

  for (const note of sorted) {
    const duplicateIndex = deduped.findLastIndex(
      (previous) =>
        previous.midi === note.midi &&
        note.start <= previous.end + 0.08 &&
        note.end >= previous.start - 0.08,
    )

    if (duplicateIndex < 0) {
      deduped.push(note)
    } else {
      const previous = deduped[duplicateIndex]
      deduped[duplicateIndex] = {
        ...previous,
        start: Math.min(previous.start, note.start),
        end: Math.max(previous.end, note.end),
        velocity: Math.max(previous.velocity, note.velocity),
      }
    }
  }

  return deduped
}

ort.env.wasm.numThreads = 1

const model = new Uint8Array(await readFile('public/models/basic-pitch/nmp.onnx'))
const session = await ort.InferenceSession.create(model, {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})

const audio = synthTestAudio()
const totalChunks = Math.max(1, Math.ceil(Math.max(1, audio.length - WINDOW_SAMPLES) / HOP_SAMPLES) + 1)
let outputShapes = null
const allNotes = []

for (let chunk = 0; chunk < totalChunks; chunk += 1) {
  const startSample = chunk * HOP_SAMPLES
  const input = new Float32Array(WINDOW_SAMPLES)
  input.set(audio.subarray(startSample, Math.min(startSample + WINDOW_SAMPLES, audio.length)))

  const results = await session.run(
    { [INPUT_NAME]: new ort.Tensor('float32', input, [1, WINDOW_SAMPLES, 1]) },
    [NOTE_OUTPUT, ONSET_OUTPUT, CONTOUR_OUTPUT],
  )

  outputShapes ??= Object.fromEntries(Object.entries(results).map(([name, tensor]) => [name, tensor.dims]))

  const noteOutput = results[NOTE_OUTPUT]
  const onsetOutput = results[ONSET_OUTPUT]
  allNotes.push(...extractNotes(noteOutput.data, onsetOutput.data, startSample / SAMPLE_RATE))
}

const notes = dedupeNotes(allNotes).filter((note) => note.start < audio.length / SAMPLE_RATE)

console.log(
  JSON.stringify(
    {
      chunks: totalChunks,
      outputShapes,
      noteCount: notes.length,
      firstNotes: notes.slice(0, 12),
    },
    null,
    2,
  ),
)
