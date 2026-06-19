import {
  Circle,
  Download,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type SVGProps } from 'react'
import * as Tone from 'tone'
import type {
  BasicPitchAdvancedSettings,
  BasicPitchWorkerMessage,
  ConversionMode,
  ConversionPhase,
  MelodyDensity,
  TranscribedNote,
  TranscriptionBackend,
} from './audio/basicPitchTypes'
import { isMidiFile, parseMidiFile } from './audio/midiFile'
import { MONK_VOWEL_POSITION, MonkVoiceEngine, type MonkVowelId } from './audio/monkVoice'
import './App.css'

const VOWELS = [
  { id: 'oo', label: 'OO', position: MONK_VOWEL_POSITION.oo, color: '#2f7d92' },
  { id: 'aa', label: 'AA', position: MONK_VOWEL_POSITION.aa, color: '#d85f3c' },
  { id: 'ee', label: 'EE', position: MONK_VOWEL_POSITION.ee, color: '#d1a328' },
  { id: 'ii', label: 'II', position: MONK_VOWEL_POSITION.ii, color: '#6c7f36' },
] as const

const VOWEL_BUTTONS = [
  { id: 'ii', label: 'I' },
  { id: 'ee', label: 'E' },
  { id: 'aa', label: 'A' },
  { id: 'oo', label: 'O' },
] as const

const NOTES = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']
const DEFAULT_BPM = 122
const DEFAULT_STEP_COUNT = 64
const MIN_STEP_COUNT = 16
const MAX_STEP_COUNT = 64
const BASIC_PITCH_SAMPLE_RATE = 22050
const APP_NAME = 'MantraSynth'
const DEFAULT_UPLOAD_NAME = 'No audio or MIDI loaded'
const MAX_UPLOAD_SECONDS = 90
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const DEFAULT_ADVANCED_CONVERSION: BasicPitchAdvancedSettings = {
  noteSegmentation: 70,
  modelConfidence: 50,
  minPitchHz: 0,
  maxPitchHz: 3000,
  minNoteMs: 90,
}
const DEFAULT_MIDI_FALLBACK_BPM = 120

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" focusable="false" {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.53-1.34-1.29-1.69-1.29-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.11-.75.41-1.26.74-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .98-.31 3.18 1.18A11.12 11.12 0 0 1 12 6.04c.98 0 1.96.13 2.88.39 2.2-1.49 3.17-1.18 3.17-1.18.64 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.07.79 2.16v3.17c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

type VowelId = (typeof VOWELS)[number]['id']
type NoteName = (typeof NOTES)[number]
type StepEntry = NoteName | NoteName[] | null

type KnobState = {
  voice: number
  glide: number
  vowelGlide: number
  delay: number
  resonance: number
  gain: number
}

const DEFAULT_KNOBS: KnobState = {
  voice: 0,
  glide: 22,
  vowelGlide: 145,
  delay: 30,
  resonance: 52,
  gain: 56,
}

type VoicePresetId = 'soft' | 'deep' | 'bright' | 'nasal' | 'chant'

const VOICE_PRESETS: Array<{ id: VoicePresetId; label: string; knobs: KnobState }> = [
  { id: 'soft', label: 'Soft', knobs: { voice: -4, glide: 32, vowelGlide: 170, delay: 24, resonance: 38, gain: 50 } },
  { id: 'deep', label: 'Deep', knobs: { voice: -18, glide: 38, vowelGlide: 180, delay: 28, resonance: 54, gain: 58 } },
  { id: 'bright', label: 'Bright', knobs: { voice: 8, glide: 18, vowelGlide: 120, delay: 22, resonance: 68, gain: 50 } },
  { id: 'nasal', label: 'Nasal', knobs: { voice: 3, glide: 20, vowelGlide: 130, delay: 18, resonance: 82, gain: 46 } },
  { id: 'chant', label: 'Chant', knobs: DEFAULT_KNOBS },
]

function getVoicePreset(presetId: VoicePresetId) {
  return VOICE_PRESETS.find((option) => option.id === presetId) ?? VOICE_PRESETS[VOICE_PRESETS.length - 1]
}

type VocalNote = TranscribedNote & {
  vowel?: VowelId
}

type VocalClip = {
  name: string
  duration: number
  notes: VocalNote[]
}

type DemoPresetId = 'neonCircuit' | 'templeHouse' | 'mirrorChant' | 'pulseLotus' | 'deepMantra' | 'solarRobot'

type DemoPreset = {
  id: DemoPresetId
  label: string
  bpm: number
  gate: number
  voicePreset: VoicePresetId
  pattern: readonly StepEntry[]
  vowels: readonly VowelId[]
  accents: readonly number[]
}

type ChantPadProject = {
  app: typeof APP_NAME
  version: 1
  savedAt: string
  bpm: number
  stepCount: number
  loop: boolean
  vowel: VowelId
  voicePreset: VoicePresetId
  expression: {
    pitch: number
    openness: number
  }
  knobs: KnobState
  gate: number
  sequence: boolean[][]
  stepVowels: VowelId[]
  stepAccents: number[]
}

type ProjectSnapshot = Pick<
  ChantPadProject,
  'bpm' | 'expression' | 'gate' | 'knobs' | 'loop' | 'sequence' | 'stepAccents' | 'stepCount' | 'stepVowels' | 'voicePreset' | 'vowel'
>

const createSteps = (count: number) => Array.from({ length: count }, (_, index) => index)

const createEmptySequence = (stepCount: number) => NOTES.map(() => createSteps(stepCount).map(() => false))

const DEFAULT_VOWEL_PHRASE: readonly VowelId[] = ['ii', 'ii', 'ee', 'ee', 'aa', 'aa', 'oo', 'oo', 'ii', 'ee', 'aa', 'oo', 'aa', 'ee', 'ii', 'oo']
const HOUSE_ACCENTS = [1, 0.62, 0.78, 0.68, 0.94, 0.66, 0.84, 0.7, 1, 0.64, 0.82, 0.74, 0.92, 0.7, 0.86, 0.76] as const
const SPARK_ACCENTS = [1, 0.58, 0.72, 0.92, 0.68, 0.84, 0.62, 0.78, 1, 0.6, 0.88, 0.66, 0.76, 0.94, 0.64, 0.82] as const
const DEEP_ACCENTS = [1, 0.52, 0.64, 0.58, 0.9, 0.55, 0.7, 0.62, 1, 0.54, 0.68, 0.6, 0.86, 0.56, 0.72, 0.64] as const

const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: 'neonCircuit',
    label: 'Neon Circuit',
    bpm: 122,
    gate: 72,
    voicePreset: 'bright',
    vowels: DEFAULT_VOWEL_PHRASE,
    accents: HOUSE_ACCENTS,
    pattern: [
      ['C3', 'G3'],
      null,
      ['E3', 'C4'],
      'G3',
      ['C3', 'A3'],
      'B3',
      'G3',
      'E3',
      ['E3', 'A3'],
      'G3',
      ['B3', 'C4'],
      'A3',
      ['G3', 'B3'],
      'A3',
      'E3',
      'G3',
      ['A3', 'C4'],
      'E3',
      'C4',
      'B3',
      ['G3', 'A3'],
      'D3',
      ['F3', 'A3'],
      'B3',
      ['D3', 'C4'],
      'F3',
      'A3',
      'C4',
      ['E3', 'G3'],
      'A3',
      'B3',
      'G3',
      ['C3', 'E3', 'G3'],
      null,
      'A3',
      'C4',
      ['C3', 'F3'],
      'A3',
      ['B3', 'C4'],
      'G3',
      ['E3', 'A3'],
      'C4',
      'B3',
      'A3',
      ['D3', 'F3'],
      'G3',
      'A3',
      'C4',
      ['F3', 'A3', 'C4'],
      null,
      'C4',
      'B3',
      ['E3', 'G3'],
      'A3',
      'G3',
      'E3',
      ['C3', 'G3'],
      'D3',
      ['E3', 'A3'],
      'G3',
      ['A3', 'C4'],
      'B3',
      'G3',
      'C4',
    ],
  },
  {
    id: 'templeHouse',
    label: 'Temple House',
    bpm: 124,
    gate: 58,
    voicePreset: 'chant',
    vowels: ['aa', 'aa', 'ee', 'aa', 'oo', 'oo', 'ee', 'ii'],
    accents: HOUSE_ACCENTS,
    pattern: [
      ['C3', 'E3'],
      'G3',
      null,
      'A3',
      ['C3', 'G3'],
      'B3',
      'A3',
      'G3',
      ['D3', 'F3'],
      'A3',
      null,
      'C4',
      ['E3', 'G3'],
      'B3',
      'A3',
      'G3',
      ['C3', 'G3'],
      'E3',
      'A3',
      'C4',
      ['F3', 'A3'],
      'C4',
      'B3',
      'A3',
      ['D3', 'A3'],
      'F3',
      'G3',
      'B3',
      ['E3', 'G3'],
      'A3',
      'C4',
      'B3',
    ],
  },
  {
    id: 'mirrorChant',
    label: 'Mirror Chant',
    bpm: 116,
    gate: 86,
    voicePreset: 'soft',
    vowels: ['ii', 'ee', 'aa', 'oo', 'oo', 'aa', 'ee', 'ii'],
    accents: SPARK_ACCENTS,
    pattern: [
      ['C3', 'C4'],
      null,
      'B3',
      'G3',
      'A3',
      'E3',
      'G3',
      null,
      ['D3', 'A3'],
      'F3',
      'G3',
      'C4',
      'B3',
      'A3',
      'G3',
      'E3',
      ['E3', 'B3'],
      null,
      'C4',
      'A3',
      'G3',
      'E3',
      'F3',
      'A3',
      ['C3', 'G3'],
      'D3',
      'E3',
      'G3',
      'A3',
      'B3',
      'C4',
      null,
    ],
  },
  {
    id: 'pulseLotus',
    label: 'Pulse Lotus',
    bpm: 132,
    gate: 46,
    voicePreset: 'nasal',
    vowels: ['ee', 'ii', 'ee', 'aa', 'ee', 'ii', 'oo', 'aa'],
    accents: SPARK_ACCENTS,
    pattern: [
      ['C3', 'G3'],
      'C4',
      'G3',
      'A3',
      ['C3', 'E3'],
      'B3',
      'G3',
      'E3',
      ['D3', 'A3'],
      'C4',
      'A3',
      'F3',
      ['E3', 'B3'],
      'C4',
      'B3',
      'G3',
    ],
  },
  {
    id: 'deepMantra',
    label: 'Deep Mantra',
    bpm: 98,
    gate: 108,
    voicePreset: 'deep',
    vowels: ['oo', 'oo', 'aa', 'oo', 'ee', 'aa', 'oo', 'aa'],
    accents: DEEP_ACCENTS,
    pattern: [
      ['C3', 'E3'],
      null,
      'G3',
      null,
      ['C3', 'A3'],
      null,
      'G3',
      'E3',
      ['D3', 'F3'],
      null,
      'A3',
      null,
      ['E3', 'G3'],
      null,
      'B3',
      'A3',
    ],
  },
  {
    id: 'solarRobot',
    label: 'Solar Robot',
    bpm: 128,
    gate: 64,
    voicePreset: 'bright',
    vowels: ['ii', 'ee', 'ii', 'aa', 'oo', 'aa', 'ee', 'ii'],
    accents: HOUSE_ACCENTS,
    pattern: [
      ['C3', 'A3'],
      'C4',
      'B3',
      'G3',
      ['E3', 'G3'],
      'A3',
      'C4',
      'B3',
      ['D3', 'F3'],
      'A3',
      'G3',
      'F3',
      ['E3', 'B3'],
      'C4',
      'A3',
      'G3',
      ['C3', 'G3'],
      'B3',
      'C4',
      'A3',
      ['F3', 'A3'],
      'C4',
      'B3',
      'A3',
      ['D3', 'A3'],
      'F3',
      'G3',
      'B3',
      ['E3', 'G3'],
      'A3',
      'G3',
      'C4',
    ],
  },
] as const

const DEFAULT_DEMO_PRESET = DEMO_PRESETS[0]

function getDemoPreset(presetId: DemoPresetId) {
  return DEMO_PRESETS.find((preset) => preset.id === presetId) ?? DEFAULT_DEMO_PRESET
}

function createPresetVowels(preset: DemoPreset, stepCount = DEFAULT_STEP_COUNT) {
  return createSteps(stepCount).map((step) => preset.vowels[step % preset.vowels.length] ?? 'aa')
}

const createDefaultStepVowels = (stepCount: number) => createPresetVowels(DEFAULT_DEMO_PRESET, stepCount)

function createPresetAccents(preset: DemoPreset, stepCount = DEFAULT_STEP_COUNT) {
  return createSteps(stepCount).map((step) => preset.accents[step % preset.accents.length] ?? 0.82)
}

const createDefaultStepAccents = (stepCount: number) => createPresetAccents(DEFAULT_DEMO_PRESET, stepCount)

const seedSequence = (stepCount = DEFAULT_STEP_COUNT, preset = DEFAULT_DEMO_PRESET) => {
  const sequence = createEmptySequence(stepCount)

  createSteps(stepCount).forEach((step) => {
    const entry = preset.pattern[step % preset.pattern.length]
    const notes = Array.isArray(entry) ? entry : entry ? [entry] : []

    notes.forEach((note) => {
      const rowIndex = NOTES.indexOf(note)
      if (rowIndex >= 0) sequence[rowIndex][step] = true
    })
  })

  return sequence
}

function getVowel(vowelId: VowelId) {
  return VOWELS.find((vowel) => vowel.id === vowelId) ?? VOWELS[1]
}

function getVowelFromPadPosition(position: number) {
  return VOWELS.reduce((closest, option) =>
    Math.abs(option.position - position) < Math.abs(closest.position - position) ? option : closest,
  )
}

function noteNameToMidi(noteName: string) {
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/)
  if (!match) return 60

  const pitchClass = NOTE_NAMES.indexOf(match[1])
  const octave = Number(match[2])
  return (octave + 1) * 12 + pitchClass
}

const NOTE_MIDI_VALUES = NOTES.map(noteNameToMidi)

function hzToMidi(hz: number, fallback: number) {
  if (!Number.isFinite(hz) || hz <= 0) return fallback
  return Math.round(69 + 12 * Math.log2(hz / 440))
}

function midiToNoteName(midi: number) {
  const rounded = Math.round(midi)
  const pitchClass = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return `${NOTE_NAMES[pitchClass]}${octave}`
}

function foldMidiToVocalRange(midi: number) {
  let folded = Math.round(midi)
  while (folded > 60) folded -= 12
  while (folded < 48) folded += 12
  return folded
}

function nearestNoteRow(midi: number) {
  const folded = foldMidiToVocalRange(midi)
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  NOTE_MIDI_VALUES.forEach((noteMidi, index) => {
    const distance = Math.abs(noteMidi - folded)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return nearestIndex
}

function noteToVowel(note: Pick<TranscribedNote, 'midi' | 'velocity'>) {
  const folded = foldMidiToVocalRange(note.midi)
  const brightness = (folded - 48) / 12 + note.velocity * 0.12
  return getVowelFromPadPosition(Math.max(0, Math.min(1, brightness))).id
}

function getVowelStepLabel(vowelId: VowelId) {
  return VOWEL_BUTTONS.find((option) => option.id === vowelId)?.label ?? getVowel(vowelId).label.slice(0, 1)
}

type SequenceQuantizeOptions = {
  density?: MelodyDensity
  mode?: ConversionMode
  simplify?: number
  advanced?: BasicPitchAdvancedSettings
}

function sequenceQuantizeSettings(options: SequenceQuantizeOptions = {}) {
  const density = options.density ?? 'normal'
  const mode = options.mode ?? 'mono'
  const simplify = Math.max(0, Math.min(1, (options.simplify ?? 35) / 100))
  const baseVelocity = density === 'sparse' ? 0.16 : density === 'normal' ? 0.07 : 0.015
  const minVelocity = Math.min(0.62, baseVelocity + simplify * 0.18)
  const baseVoices = mode === 'mono' ? 1 : density === 'busy' ? 4 : density === 'normal' ? 2 : 1
  const maxVoices = simplify > 0.72 ? Math.min(baseVoices, 1) : simplify > 0.45 ? Math.min(baseVoices, 2) : baseVoices

  return {
    maxVoices,
    minDuration: 0.025 + simplify * 0.035,
    minVelocity,
  }
}

function notesToSequence(notes: TranscribedNote[], bpm: number, stepCount: number, options: SequenceQuantizeOptions = {}) {
  const nextSequence = createEmptySequence(stepCount)
  const nextVowels = createDefaultStepVowels(stepCount)
  const nextAccents = createDefaultStepAccents(stepCount)
  const secondsPerStep = (60 / bpm) / 4
  const settings = sequenceQuantizeSettings(options)
  const minMidi = hzToMidi(options.advanced?.minPitchHz ?? DEFAULT_ADVANCED_CONVERSION.minPitchHz, NOTE_MIDI_VALUES[0])
  const maxMidi = hzToMidi(options.advanced?.maxPitchHz ?? DEFAULT_ADVANCED_CONVERSION.maxPitchHz, NOTE_MIDI_VALUES[NOTE_MIDI_VALUES.length - 1])
  const minNoteSeconds = (options.advanced?.minNoteMs ?? DEFAULT_ADVANCED_CONVERSION.minNoteMs) / 1000
  const buckets = new Map<
    number,
    Array<{
      row: number
      note: TranscribedNote
      score: number
      vowel: VowelId
    }>
  >()

  notes.forEach((note) => {
    const step = Math.round(note.start / secondsPerStep)
    if (step < 0 || step >= stepCount) return
    if (note.midi < minMidi || note.midi > maxMidi) return
    if (note.velocity < settings.minVelocity || note.end - note.start < Math.max(settings.minDuration, minNoteSeconds)) return

    const row = nearestNoteRow(note.midi)
    const durationScore = Math.min(1, (note.end - note.start) / secondsPerStep) * 0.24
    const score = note.velocity * 0.76 + durationScore
    const bucket = buckets.get(step) ?? []
    bucket.push({ row, note, score, vowel: noteToVowel(note) })
    buckets.set(step, bucket)
  })

  buckets.forEach((bucket, step) => {
    const usedRows = new Set<number>()
    const selected = bucket
      .sort((a, b) => b.score - a.score || Math.abs(b.note.midi - 60) - Math.abs(a.note.midi - 60))
      .filter((entry) => {
        if (usedRows.has(entry.row)) return false
        usedRows.add(entry.row)
        return true
      })
      .slice(0, settings.maxVoices)

    selected.forEach((entry, index) => {
      nextSequence[entry.row][step] = true
      if (index === 0) nextVowels[step] = entry.vowel
    })
    nextAccents[step] = Math.max(0.48, Math.min(1, selected[0]?.note.velocity ?? selected[0]?.score ?? 0.82))
  })

  return { sequence: nextSequence, vowels: nextVowels, accents: nextAccents }
}

function phaseAtLeast(phase: ConversionPhase, target: ConversionPhase) {
  const order: Record<ConversionPhase, number> = {
    idle: 0,
    decoding: 1,
    'loading-model': 2,
    transcribing: 3,
    quantizing: 4,
    rendered: 5,
    error: 0,
  }

  return order[phase] >= order[target]
}

function normalizeClipNotes(notes: TranscribedNote[], duration: number) {
  return notes
    .map((note) => ({
      ...note,
      start: Math.max(0, Math.min(duration, note.start)),
      end: Math.max(note.start + 0.06, Math.min(duration, note.end)),
      midi: foldMidiToVocalRange(note.midi),
      velocity: Math.max(0.35, Math.min(1, note.velocity)),
    }))
    .filter((note) => note.start < duration && note.end > note.start)
}

function normalizeAudio(samples: Float32Array) {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (peak <= 1) return samples

  const output = new Float32Array(samples.length)
  const gain = 0.98 / peak
  for (let index = 0; index < samples.length; index += 1) output[index] = samples[index] * gain
  return output
}

function clampStepCount(value: number) {
  const rounded = Math.round(value / 4) * 4
  return Math.max(MIN_STEP_COUNT, Math.min(MAX_STEP_COUNT, rounded || DEFAULT_STEP_COUNT))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function isVowelId(value: unknown): value is VowelId {
  return typeof value === 'string' && VOWELS.some((vowelOption) => vowelOption.id === value)
}

function normalizeProjectSequence(value: unknown, stepCount: number) {
  if (!Array.isArray(value)) return createEmptySequence(stepCount)

  return NOTES.map((_, rowIndex) => {
    const row = Array.isArray(value[rowIndex]) ? value[rowIndex] : []
    return createSteps(stepCount).map((step) => Boolean(row[step]))
  })
}

function normalizeProjectVowels(value: unknown, stepCount: number) {
  const fallback = createDefaultStepVowels(stepCount)
  if (!Array.isArray(value)) return fallback

  return createSteps(stepCount).map((step) => {
    const savedVowel = value[step]
    return isVowelId(savedVowel) ? savedVowel : fallback[step]
  })
}

function normalizeProjectAccents(value: unknown, stepCount: number) {
  const fallback = createDefaultStepAccents(stepCount)
  if (!Array.isArray(value)) return fallback

  return createSteps(stepCount).map((step) => clampNumber(value[step], 0.35, 1, fallback[step] ?? 0.82))
}

function normalizeProjectKnobs(value: unknown): KnobState {
  const source = value && typeof value === 'object' ? (value as Partial<Record<keyof KnobState, unknown>>) : {}

  return {
    voice: Math.round(clampNumber(source.voice, -24, 24, DEFAULT_KNOBS.voice)),
    glide: Math.round(clampNumber(source.glide, 0, 80, DEFAULT_KNOBS.glide)),
    vowelGlide: Math.round(clampNumber(source.vowelGlide, 0, 260, DEFAULT_KNOBS.vowelGlide)),
    delay: Math.round(clampNumber(source.delay, 0, 86, DEFAULT_KNOBS.delay)),
    resonance: Math.round(clampNumber(source.resonance, 20, 90, DEFAULT_KNOBS.resonance)),
    gain: Math.round(clampNumber(source.gain, 0, 100, DEFAULT_KNOBS.gain)),
  }
}

function normalizeProjectExpression(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Partial<Record<'pitch' | 'openness', unknown>>) : {}

  return {
    pitch: Math.round(clampNumber(source.pitch, 0, 100, 50)),
    openness: Math.round(clampNumber(source.openness, 0, 100, 62)),
  }
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input

  const ratio = inputRate / outputRate
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)))
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * ratio
    const leftIndex = Math.floor(sourcePosition)
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const fraction = sourcePosition - leftIndex
    output[index] = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction
  }

  return output
}

async function decodeAudioFile(file: File) {
  const AudioContextConstructor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextConstructor) {
    throw new Error('This browser does not expose AudioContext')
  }

  const context = new AudioContextConstructor({ sampleRate: BASIC_PITCH_SAMPLE_RATE })
  const arrayBuffer = await file.arrayBuffer()
  const decoded = await context.decodeAudioData(arrayBuffer)
  const mono = new Float32Array(decoded.length)

  for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
    const channel = decoded.getChannelData(channelIndex)
    for (let sampleIndex = 0; sampleIndex < decoded.length; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex] / decoded.numberOfChannels
    }
  }

  await context.close()

  return normalizeAudio(resampleLinear(mono, decoded.sampleRate, BASIC_PITCH_SAMPLE_RATE))
}

async function unlockToneContext() {
  await Promise.race([
    Tone.start(),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 650)
    }),
  ])

  const context = Tone.getContext()
  if (context.state !== 'running') {
    void context.resume().catch((error: unknown) => {
      console.warn('Audio context resume failed', error)
    })
  }
}

function App() {
  const [vowel, setVowel] = useState<VowelId>('aa')
  const [expression, setExpression] = useState({ pitch: 50, openness: 62 })
  const [stepCount, setStepCount] = useState(DEFAULT_STEP_COUNT)
  const steps = createSteps(stepCount)
  const [sequence, setSequence] = useState(() => seedSequence(DEFAULT_STEP_COUNT))
  const [stepVowels, setStepVowels] = useState<VowelId[]>(() => createDefaultStepVowels(DEFAULT_STEP_COUNT))
  const [stepAccents, setStepAccents] = useState<number[]>(() => createDefaultStepAccents(DEFAULT_STEP_COUNT))
  const [activeStep, setActiveStep] = useState(-1)
  const [activeKeyboardNote, setActiveKeyboardNote] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [loop, setLoop] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [bpm, setBpm] = useState(DEFAULT_BPM)
  const [gate, setGate] = useState(DEFAULT_DEMO_PRESET.gate)
  const [selectedDemoPreset, setSelectedDemoPreset] = useState<DemoPresetId>(DEFAULT_DEMO_PRESET.id)
  const [uploadName, setUploadName] = useState(DEFAULT_UPLOAD_NAME)
  const [conversionStatus, setConversionStatus] = useState('Awaiting source')
  const [conversionPhase, setConversionPhase] = useState<ConversionPhase>('idle')
  const [conversionProgress, setConversionProgress] = useState(0)
  const [conversionBackend, setConversionBackend] = useState<TranscriptionBackend | null>(null)
  const [convertedNoteCount, setConvertedNoteCount] = useState(0)
  const [convertedClip, setConvertedClip] = useState<VocalClip | null>(null)
  const [mouthPulse, setMouthPulse] = useState(false)
  const [isRenderingWav, setIsRenderingWav] = useState(false)
  const [knobs, setKnobs] = useState<KnobState>(() => getVoicePreset(DEFAULT_DEMO_PRESET.voicePreset).knobs)
  const [voicePreset, setVoicePreset] = useState<VoicePresetId>(DEFAULT_DEMO_PRESET.voicePreset)
  const [outputLevel, setOutputLevel] = useState(0)
  const [melodyDensity, setMelodyDensity] = useState<MelodyDensity>('normal')
  const [conversionMode, setConversionMode] = useState<ConversionMode>('mono')
  const [simplifyNotes, setSimplifyNotes] = useState(35)
  const [advancedConversion, setAdvancedConversion] = useState<BasicPitchAdvancedSettings>(DEFAULT_ADVANCED_CONVERSION)
  const [midiFallbackBpm, setMidiFallbackBpm] = useState(DEFAULT_MIDI_FALLBACK_BPM)
  const [advancedUploadOpen, setAdvancedUploadOpen] = useState(false)
  const [uploadPanelCollapsed, setUploadPanelCollapsed] = useState(false)
  const [tempoConfidence, setTempoConfidence] = useState<number | null>(null)
  const [originalAudioUrl, setOriginalAudioUrl] = useState<string | null>(null)

  const voiceEngineRef = useRef<MonkVoiceEngine | null>(null)
  const scheduleIdsRef = useRef<number[]>([])
  const stepRef = useRef(0)
  const mouthTimerRef = useRef<number | null>(null)
  const meterFrameRef = useRef<number | null>(null)
  const sequenceRef = useRef(sequence)
  const stepVowelsRef = useRef(stepVowels)
  const stepAccentsRef = useRef(stepAccents)
  const stepCountRef = useRef(stepCount)
  const gateRef = useRef(gate)
  const convertedClipRef = useRef(convertedClip)
  const vowelRef = useRef<VowelId>(vowel)
  const knobsRef = useRef(knobs)
  const voicePresetRef = useRef(voicePreset)
  const undoStackRef = useRef<ProjectSnapshot[]>([])
  const redoStackRef = useRef<ProjectSnapshot[]>([])
  const padHoldingRef = useRef(false)
  const stepPaintRef = useRef<{ active: boolean; mode: 'add' | 'remove'; lastKey: string | null }>({
    active: false,
    mode: 'add',
    lastKey: null,
  })
  const [padSustain, setPadSustain] = useState(false)
  const [padLatched, setPadLatched] = useState(false)
  const heldPadNoteRef = useRef<string | null>(null)
  const heldKeyboardNoteRef = useRef<string | null>(null)
  const basicPitchWorkerRef = useRef<Worker | null>(null)
  const projectInputRef = useRef<HTMLInputElement | null>(null)
  const originalAudioRef = useRef<HTMLAudioElement | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)

  const currentVowel = getVowel(vowel)
  const hasSequenceNotes = sequence.some((row) => row.some(Boolean))
  const hasDownloadableNotes = hasSequenceNotes || Boolean(convertedClip?.notes.length)
  const hasUploadedSource = uploadName !== DEFAULT_UPLOAD_NAME || conversionPhase !== 'idle' || Boolean(originalAudioUrl)

  function applyVoice() {
    voiceEngineRef.current?.update(knobsRef.current)
  }

  function clearScheduledEvents() {
    scheduleIdsRef.current.forEach((id) => {
      window.clearTimeout(id)
      window.clearInterval(id)
    })
    scheduleIdsRef.current = []
  }

  function pauseOriginalPreview(reset = false) {
    const audio = originalAudioRef.current
    if (!audio) return

    audio.pause()
    if (reset) audio.currentTime = 0
  }

  function stopPlaybackForSourceChange() {
    stopTransport()
    pauseOriginalPreview(true)
    voiceEngineRef.current?.stopSustain()
    heldPadNoteRef.current = null
    padHoldingRef.current = false
    setPadLatched(false)
    releaseMouth()
  }

  function terminateTranscriptionWorker() {
    basicPitchWorkerRef.current?.terminate()
    basicPitchWorkerRef.current = null
  }

  function clearUploadSource() {
    stopPlaybackForSourceChange()
    terminateTranscriptionWorker()
    setOriginalAudioUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      return null
    })
    setUploadName(DEFAULT_UPLOAD_NAME)
    setConversionStatus('Source removed')
    setConversionPhase('idle')
    setConversionProgress(0)
    setConversionBackend(null)
    setConvertedNoteCount(0)
    setConvertedClip(null)
    setTempoConfidence(null)
  }

  function updateAdvancedConversion<Key extends keyof BasicPitchAdvancedSettings>(
    key: Key,
    value: BasicPitchAdvancedSettings[Key],
  ) {
    setAdvancedConversion((current) => ({ ...current, [key]: value }))
  }

  function createProjectSnapshot(): ProjectSnapshot {
    return {
      bpm,
      expression: { ...expression },
      gate: gateRef.current,
      knobs: { ...knobsRef.current },
      loop,
      sequence: sequenceRef.current.map((row) => [...row]),
      stepAccents: [...stepAccentsRef.current],
      stepCount: stepCountRef.current,
      stepVowels: [...stepVowelsRef.current],
      voicePreset: voicePresetRef.current,
      vowel: vowelRef.current,
    }
  }

  function restoreProjectSnapshot(snapshot: ProjectSnapshot) {
    Tone.Transport.stop()
    clearScheduledEvents()
    setIsPlaying(false)
    stepCountRef.current = snapshot.stepCount
    sequenceRef.current = snapshot.sequence.map((row) => [...row])
    stepVowelsRef.current = [...snapshot.stepVowels]
    stepAccentsRef.current = [...snapshot.stepAccents]
    gateRef.current = snapshot.gate
    knobsRef.current = { ...snapshot.knobs }
    voicePresetRef.current = snapshot.voicePreset
    vowelRef.current = snapshot.vowel

    setBpm(snapshot.bpm)
    setExpression({ ...snapshot.expression })
    setGate(snapshot.gate)
    setKnobs({ ...snapshot.knobs })
    setLoop(snapshot.loop)
    setSequence(snapshot.sequence.map((row) => [...row]))
    setStepCount(snapshot.stepCount)
    setStepVowels([...snapshot.stepVowels])
    setStepAccents([...snapshot.stepAccents])
    setVoicePreset(snapshot.voicePreset)
    setVowel(snapshot.vowel)
    setConvertedClip(null)
    setActiveStep(-1)
  }

  function pushHistory() {
    undoStackRef.current.push(createProjectSnapshot())
    if (undoStackRef.current.length > 80) undoStackRef.current.shift()
    redoStackRef.current = []
  }

  function undoProject() {
    const previous = undoStackRef.current.pop()
    if (!previous) return

    redoStackRef.current.push(createProjectSnapshot())
    restoreProjectSnapshot(previous)
    setConversionStatus('Undo')
  }

  function redoProject() {
    const next = redoStackRef.current.pop()
    if (!next) return

    undoStackRef.current.push(createProjectSnapshot())
    restoreProjectSnapshot(next)
    setConversionStatus('Redo')
  }

  useEffect(() => {
    sequenceRef.current = sequence
  }, [sequence])

  useEffect(() => {
    stepVowelsRef.current = stepVowels
  }, [stepVowels])

  useEffect(() => {
    stepAccentsRef.current = stepAccents
  }, [stepAccents])

  useEffect(() => {
    stepCountRef.current = stepCount
  }, [stepCount])

  useEffect(() => {
    gateRef.current = gate
  }, [gate])

  useEffect(() => {
    convertedClipRef.current = convertedClip
  }, [convertedClip])

  useEffect(() => {
    vowelRef.current = vowel
    applyVoice()
  }, [vowel])

  useEffect(() => {
    knobsRef.current = knobs
    applyVoice()
  }, [knobs])

  useEffect(() => {
    voicePresetRef.current = voicePreset
  }, [voicePreset])

  useEffect(() => {
    if (!autoScroll) return
    if (activeStep < 0) return
    const timeline = timelineRef.current
    if (!timeline) return

    const stepElement = timeline.querySelector<HTMLElement>(`.step[data-step-index="${activeStep}"]`)
    if (!stepElement) return

    const timelineRect = timeline.getBoundingClientRect()
    const stepRect = stepElement.getBoundingClientRect()
    const targetLeft = timeline.scrollLeft + (stepRect.left - timelineRect.left) - timeline.clientWidth / 2 + stepRect.width / 2
    timeline.scrollTo({ left: Math.max(0, targetLeft), behavior: isPlaying ? 'smooth' : 'auto' })
  }, [activeStep, autoScroll, isPlaying])

  useEffect(() => {
    Tone.Transport.bpm.value = bpm
  }, [bpm])

  useEffect(() => {
    Tone.Transport.loop = loop
  }, [loop])

  useEffect(() => {
    return () => {
      clearScheduledEvents()
      Tone.Transport.stop()
      basicPitchWorkerRef.current?.terminate()
      voiceEngineRef.current?.dispose()
      if (meterFrameRef.current !== null) window.cancelAnimationFrame(meterFrameRef.current)
      if (mouthTimerRef.current !== null) window.clearTimeout(mouthTimerRef.current)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (originalAudioUrl) URL.revokeObjectURL(originalAudioUrl)
    }
  }, [originalAudioUrl])

  useEffect(() => {
    const tick = () => {
      const engineLevel = voiceEngineRef.current?.getOutputLevel() ?? 0
      setOutputLevel((current) => Math.max(engineLevel, current * 0.82))
      meterFrameRef.current = window.requestAnimationFrame(tick)
    }

    meterFrameRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (meterFrameRef.current !== null) window.cancelAnimationFrame(meterFrameRef.current)
    }
  }, [])

  useEffect(() => {
    const stopStepPaint = () => {
      stepPaintRef.current.active = false
      stepPaintRef.current.lastKey = null
    }

    window.addEventListener('pointerup', stopStepPaint)
    window.addEventListener('pointercancel', stopStepPaint)

    return () => {
      window.removeEventListener('pointerup', stopStepPaint)
      window.removeEventListener('pointercancel', stopStepPaint)
    }
  }, [])

  async function ensureAudio() {
    await unlockToneContext()

    if (!voiceEngineRef.current) {
      const rawContext = Tone.getContext().rawContext as AudioContext
      voiceEngineRef.current = new MonkVoiceEngine(rawContext)
      applyVoice()
    }
  }

  function pulseMouth() {
    setMouthPulse(true)
    if (mouthTimerRef.current !== null) window.clearTimeout(mouthTimerRef.current)
    mouthTimerRef.current = window.setTimeout(() => {
      if (!padHoldingRef.current) setMouthPulse(false)
    }, 170)
  }

  function holdMouthOpen() {
    if (mouthTimerRef.current !== null) window.clearTimeout(mouthTimerRef.current)
    setMouthPulse(true)
  }

  function releaseMouth() {
    if (mouthTimerRef.current !== null) window.clearTimeout(mouthTimerRef.current)
    mouthTimerRef.current = window.setTimeout(() => setMouthPulse(false), 120)
  }

  function triggerNote(note: string, duration = 0.28, velocity = 0.96) {
    applyVoice()
    voiceEngineRef.current?.triggerAttackRelease(note, vowelRef.current as MonkVowelId, duration, velocity)
    pulseMouth()
  }

  async function pressKeyboardNote(event: PointerEvent<HTMLButtonElement>, note: string) {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (heldKeyboardNoteRef.current === note) return

    await ensureAudio()
    applyVoice()
    if (heldKeyboardNoteRef.current) voiceEngineRef.current?.stopSustain(0.02)
    heldKeyboardNoteRef.current = note
    setActiveKeyboardNote(note)
    voiceEngineRef.current?.startSustain(note, vowelRef.current as MonkVowelId, 0.94)
    holdMouthOpen()

    if (isRecording) {
      const targetStep = activeStep >= 0 ? activeStep : 0
      const rowIndex = NOTES.indexOf(note)
      if (rowIndex >= 0) {
        setSequence((previous) =>
          previous.map((row, noteIndex) =>
            row.map((isActive, stepIndex) =>
              noteIndex === rowIndex && stepIndex === targetStep ? true : isActive,
            ),
          ),
        )
        setStepVowels((previous) => {
          const next = previous.map((savedVowel, stepIndex) => (stepIndex === targetStep ? vowelRef.current : savedVowel))
          stepVowelsRef.current = next
          return next
        })
        setStepAccents((previous) => {
          const next = previous.map((accent, stepIndex) => (stepIndex === targetStep ? Math.max(accent, 0.92) : accent))
          stepAccentsRef.current = next
          return next
        })
      }
    }
  }

  function releaseKeyboardNote(event: PointerEvent<HTMLButtonElement>, note: string) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (heldKeyboardNoteRef.current === note) {
      heldKeyboardNoteRef.current = null
      voiceEngineRef.current?.stopSustain()
      releaseMouth()
    }
    setActiveKeyboardNote((current) => (current === note ? null : current))
  }

  async function startTransport() {
    try {
      await ensureAudio()
    } catch (error) {
      console.error(error)
      setIsPlaying(false)
      return
    }

    pauseOriginalPreview()
    Tone.Transport.stop()
    clearScheduledEvents()

    stepRef.current = 0

    const secondsPerStep = (60 / bpm) / 4
    const runStep = () => {
      const stepCountNow = stepCountRef.current
      const step = stepRef.current % stepCountNow
      setActiveStep(step)

      const activeRows = sequenceRef.current
        .map((row, rowIndex) => (row[step] ? rowIndex : -1))
        .filter((rowIndex) => rowIndex >= 0)

      if (activeRows.length) {
        const nextVowel = stepVowelsRef.current[step]
        const stepVelocity = Math.max(0.42, Math.min(1, stepAccentsRef.current[step] ?? 0.82))
        const stepDuration = secondsPerStep * Math.max(0.18, Math.min(1.42, gateRef.current / 100))
        vowelRef.current = nextVowel
        setVowel(nextVowel)
        applyVoice()
        activeRows.forEach((rowIndex) => triggerNote(NOTES[rowIndex], stepDuration, stepVelocity))
      }

      stepRef.current += 1

      if (!loop && stepRef.current >= stepCountNow) {
        stopTransport()
      }
    }

    runStep()
    if (loop || stepRef.current < stepCountRef.current) {
      const repeatId = window.setInterval(runStep, secondsPerStep * 1000)
      scheduleIdsRef.current.push(repeatId)
    }
    setIsPlaying(true)
  }

  function pauseTransport() {
    Tone.Transport.pause()
    clearScheduledEvents()
    setIsPlaying(false)
  }

  function stopTransport(resetStep = true) {
    Tone.Transport.stop()
    clearScheduledEvents()
    if (resetStep) {
      setActiveStep(-1)
      stepRef.current = 0
    }
    setIsPlaying(false)
  }

  function paintStep(rowIndex: number, stepIndex: number, mode: 'add' | 'remove') {
    const key = `${rowIndex}:${stepIndex}`
    if (stepPaintRef.current.active && stepPaintRef.current.lastKey === key) return
    stepPaintRef.current.lastKey = key
    setConvertedClip(null)
    if (mode === 'add') {
      setStepVowels((previous) => {
        const next = previous.map((savedVowel, currentStep) => (currentStep === stepIndex ? vowelRef.current : savedVowel))
        stepVowelsRef.current = next
        return next
      })
      setStepAccents((previous) => {
        const next = previous.map((accent, currentStep) => (currentStep === stepIndex ? Math.max(accent, 0.86) : accent))
        stepAccentsRef.current = next
        return next
      })
    }
    setSequence((previous) =>
      previous.map((row, noteIndex) =>
        row.map((isActive, currentStep) =>
          noteIndex === rowIndex && currentStep === stepIndex ? mode === 'add' : isActive,
        ),
      ),
    )
  }

  function startStepPaint(event: PointerEvent<HTMLButtonElement>, rowIndex: number, stepIndex: number) {
    event.preventDefault()
    const mode = event.button === 2 ? 'remove' : 'add'
    pushHistory()
    stepPaintRef.current = { active: true, mode, lastKey: null }
    paintStep(rowIndex, stepIndex, mode)
  }

  function continueStepPaint(rowIndex: number, stepIndex: number) {
    const paint = stepPaintRef.current
    if (!paint.active) return

    paintStep(rowIndex, stepIndex, paint.mode)
  }

  function continueStepPaintFromPointer(event: PointerEvent<HTMLDivElement>) {
    const paint = stepPaintRef.current
    if (!paint.active) return

    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.step')
    const rowIndex = Number(element?.dataset.rowIndex)
    const stepIndex = Number(element?.dataset.stepIndex)
    if (!Number.isInteger(rowIndex) || !Number.isInteger(stepIndex)) return

    paintStep(rowIndex, stepIndex, paint.mode)
  }

  function resizeStepCount(nextCount: number) {
    const safeCount = clampStepCount(nextCount)
    if (safeCount === stepCountRef.current) return

    const nextSequence = sequenceRef.current.map((row) => createSteps(safeCount).map((step) => row[step] ?? false))
    const nextVowels = createSteps(safeCount).map((step) => stepVowelsRef.current[step] ?? VOWELS[step % VOWELS.length].id)
    const nextAccents = createSteps(safeCount).map((step) => stepAccentsRef.current[step] ?? 0.82)

    stepCountRef.current = safeCount
    sequenceRef.current = nextSequence
    stepVowelsRef.current = nextVowels
    stepAccentsRef.current = nextAccents
    setStepCount(safeCount)
    setSequence(nextSequence)
    setStepVowels(nextVowels)
    setStepAccents(nextAccents)
    setConvertedClip(null)
    setActiveStep((current) => (current >= safeCount ? -1 : current))
    if (stepRef.current >= safeCount) stepRef.current = 0
  }

  function clearSequence() {
    pushHistory()
    const nextSequence = createEmptySequence(stepCountRef.current)
    const nextVowels = createDefaultStepVowels(stepCountRef.current)
    const nextAccents = createDefaultStepAccents(stepCountRef.current)
    sequenceRef.current = nextSequence
    stepVowelsRef.current = nextVowels
    stepAccentsRef.current = nextAccents
    setSequence(nextSequence)
    setStepVowels(nextVowels)
    setStepAccents(nextAccents)
    setConvertedClip(null)
    setConvertedNoteCount(0)
    setConversionStatus('Sequence cleared')
    setConversionPhase('idle')
    setConversionProgress(0)
    setActiveStep(-1)
  }

  function resetProject() {
    pushHistory()
    stopTransport()
    const preset = DEFAULT_DEMO_PRESET
    const nextSequence = seedSequence(DEFAULT_STEP_COUNT, preset)
    const nextVowels = createPresetVowels(preset, DEFAULT_STEP_COUNT)
    const nextAccents = createPresetAccents(preset, DEFAULT_STEP_COUNT)
    stepCountRef.current = DEFAULT_STEP_COUNT
    sequenceRef.current = nextSequence
    stepVowelsRef.current = nextVowels
    stepAccentsRef.current = nextAccents
    gateRef.current = preset.gate
    setBpm(preset.bpm)
    setGate(preset.gate)
    setSelectedDemoPreset(preset.id)
    applyVoicePreset(preset.voicePreset)
    setLoop(true)
    setStepCount(DEFAULT_STEP_COUNT)
    setSequence(nextSequence)
    setStepVowels(nextVowels)
    setStepAccents(nextAccents)
    setConvertedClip(null)
    setConvertedNoteCount(0)
    setConversionStatus('Project reset')
    setConversionPhase('idle')
    setConversionProgress(0)
    setTempoConfidence(null)
    setActiveStep(-1)
  }

  function duplicatePattern() {
    pushHistory()
    const currentCount = stepCountRef.current
    const nextCount = Math.min(MAX_STEP_COUNT, currentCount * 2)
    const nextSequence = sequenceRef.current.map((row) =>
      createSteps(nextCount).map((step) => row[step % currentCount] ?? false),
    )
    const nextVowels = createSteps(nextCount).map((step) => stepVowelsRef.current[step % currentCount] ?? 'aa')
    const nextAccents = createSteps(nextCount).map((step) => stepAccentsRef.current[step % currentCount] ?? 0.82)
    stepCountRef.current = nextCount
    sequenceRef.current = nextSequence
    stepVowelsRef.current = nextVowels
    stepAccentsRef.current = nextAccents
    setStepCount(nextCount)
    setSequence(nextSequence)
    setStepVowels(nextVowels)
    setStepAccents(nextAccents)
    setConvertedClip(null)
    setConversionStatus(nextCount === currentCount ? 'Pattern already at 64 steps' : `Pattern duplicated to ${nextCount} steps`)
  }

  function loadDemoPreset(presetId: DemoPresetId) {
    const preset = getDemoPreset(presetId)
    const nextStepCount = DEFAULT_STEP_COUNT
    const nextSequence = seedSequence(nextStepCount, preset)
    const nextVowels = createPresetVowels(preset, nextStepCount)
    const nextAccents = createPresetAccents(preset, nextStepCount)

    pushHistory()
    stopTransport()
    setSelectedDemoPreset(preset.id)
    stepCountRef.current = nextStepCount
    sequenceRef.current = nextSequence
    stepVowelsRef.current = nextVowels
    stepAccentsRef.current = nextAccents
    gateRef.current = preset.gate
    setBpm(preset.bpm)
    setGate(preset.gate)
    setLoop(true)
    setStepCount(nextStepCount)
    setSequence(nextSequence)
    setStepVowels(nextVowels)
    setStepAccents(nextAccents)
    setConvertedClip(null)
    setConvertedNoteCount(0)
    setActiveStep(-1)
    applyVoicePreset(preset.voicePreset)
    setConversionStatus(`Loaded ${preset.label}`)
    setConversionPhase('idle')
    setConversionProgress(0)
  }

  function resetSynthControls() {
    voiceEngineRef.current?.stopSustain()
    heldPadNoteRef.current = null
    heldKeyboardNoteRef.current = null
    padHoldingRef.current = false
    setPadLatched(false)
    setPadSustain(false)
    const preset = getVoicePreset(DEFAULT_DEMO_PRESET.voicePreset)
    knobsRef.current = preset.knobs
    voicePresetRef.current = preset.id
    setKnobs(preset.knobs)
    gateRef.current = DEFAULT_DEMO_PRESET.gate
    setGate(DEFAULT_DEMO_PRESET.gate)
    setVoicePreset(preset.id)
    setVowel('aa')
    setExpression({ pitch: 50, openness: 62 })
    releaseMouth()
  }

  function applyVoicePreset(presetId: VoicePresetId) {
    const preset = getVoicePreset(presetId)
    setVoicePreset(preset.id)
    voicePresetRef.current = preset.id
    setKnobs(preset.knobs)
    knobsRef.current = preset.knobs
    applyVoice()
  }

  function togglePadSustain() {
    const nextSustain = !padSustain
    setPadSustain(nextSustain)

    if (!nextSustain) {
      voiceEngineRef.current?.stopSustain()
      setPadLatched(false)
      heldPadNoteRef.current = null
      releaseMouth()
    }
  }

  function updatePad(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    const vowelPosition = 1 - y
    const note = NOTES[Math.min(NOTES.length - 1, Math.floor(x * NOTES.length))]
    const nextVowel = getVowelFromPadPosition(vowelPosition).id

    setExpression({
      pitch: Math.round(x * 100),
      openness: Math.round((1 - y) * 100),
    })
    vowelRef.current = nextVowel
    setVowel(nextVowel)

    return note
  }

  async function startPadVoice(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    padHoldingRef.current = true
    holdMouthOpen()

    const note = updatePad(event)
    heldPadNoteRef.current = note

    await ensureAudio()
    if (!padHoldingRef.current && !padSustain) return

    const currentNote = heldPadNoteRef.current ?? note
    applyVoice()
    voiceEngineRef.current?.startSustain(currentNote, vowelRef.current as MonkVowelId, 0.96)
    setPadLatched(true)
  }

  function movePadVoice(event: PointerEvent<HTMLButtonElement>) {
    if (!padHoldingRef.current) return

    const note = updatePad(event)

    if (heldPadNoteRef.current !== note) {
      heldPadNoteRef.current = note
    }
    applyVoice()
    voiceEngineRef.current?.startSustain(note, vowelRef.current as MonkVowelId, 0.96)
    setPadLatched(true)
    holdMouthOpen()
  }

  function stopPadVoice(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    padHoldingRef.current = false
    if (padSustain) {
      holdMouthOpen()
      return
    }

    heldPadNoteRef.current = null
    voiceEngineRef.current?.stopSustain()
    setPadLatched(false)
    releaseMouth()
  }

  function startTranscriptionWorker(samples: Float32Array, fileName: string) {
    terminateTranscriptionWorker()

    const worker = new Worker(new URL('./workers/basicPitch.worker.ts', import.meta.url), { type: 'module' })
    basicPitchWorkerRef.current = worker

    worker.onmessage = (event: MessageEvent<BasicPitchWorkerMessage>) => {
      const message = event.data

      if (message.type === 'progress') {
        setConversionPhase(message.phase)
        setConversionProgress(message.progress)
        setConversionStatus(message.message)
        if (message.backend) setConversionBackend(message.backend)
        return
      }

      if (message.type === 'result') {
        const notes = normalizeClipNotes(message.notes, message.duration)
        const autoBpm =
          message.estimatedBpm && (message.tempoConfidence ?? 0) >= 0.22
            ? Math.max(60, Math.min(190, message.estimatedBpm))
            : bpm
        const secondsPerStep = (60 / autoBpm) / 4
        const nextStepCount = clampStepCount(Math.min(MAX_STEP_COUNT, Math.ceil(message.duration / secondsPerStep)))
        const gridDuration = nextStepCount * secondsPerStep
        const gridNotes = notes.filter((note) => note.start < gridDuration)
        const quantized = notesToSequence(gridNotes, autoBpm, nextStepCount, {
          density: melodyDensity,
          mode: conversionMode,
          simplify: simplifyNotes,
          advanced: advancedConversion,
        })
        const wasTrimmed = message.duration > gridDuration + secondsPerStep

        pushHistory()
        if (autoBpm !== bpm) setBpm(autoBpm)
        setStepCount(nextStepCount)
        stepCountRef.current = nextStepCount
        setSequence(quantized.sequence)
        sequenceRef.current = quantized.sequence
        setStepVowels(quantized.vowels)
        stepVowelsRef.current = quantized.vowels
        setStepAccents(quantized.accents)
        stepAccentsRef.current = quantized.accents
        setConvertedClip({ name: fileName, duration: message.duration, notes })
        setConvertedNoteCount(gridNotes.length)
        setConversionBackend(message.backend)
        setConversionPhase('rendered')
        setConversionProgress(1)
        setTempoConfidence(message.tempoConfidence ?? null)
        setConversionStatus(
          gridNotes.length
            ? `Converted ${gridNotes.length} grid notes with ${message.backend.toUpperCase()}${message.usedFallback ? ' fallback' : ''}${
                message.estimatedBpm ? ` / ${autoBpm} BPM` : ''
              }${wasTrimmed ? ` / first ${gridDuration.toFixed(1)}s only` : ''}${
                message.rawNoteCount > gridNotes.length * 3 ? ' / dense source simplified' : ''
              }`
            : `No strong notes found with ${message.backend.toUpperCase()}`,
        )
        worker.terminate()
        if (basicPitchWorkerRef.current === worker) basicPitchWorkerRef.current = null
        return
      }

      setConversionPhase('error')
      setConversionProgress(0)
      setConversionStatus(message.message)
      if (message.backend) setConversionBackend(message.backend)
      worker.terminate()
      if (basicPitchWorkerRef.current === worker) basicPitchWorkerRef.current = null
    }

    worker.onerror = (error) => {
      setConversionPhase('error')
      setConversionProgress(0)
      setConversionStatus(error.message || 'Transcription worker failed')
      worker.terminate()
      if (basicPitchWorkerRef.current === worker) basicPitchWorkerRef.current = null
    }

    worker.postMessage(
      {
        type: 'transcribe',
        audio: samples,
        sampleRate: BASIC_PITCH_SAMPLE_RATE,
        preferWebGpu: true,
        density: melodyDensity,
        mode: conversionMode,
        simplify: simplifyNotes,
        advanced: advancedConversion,
      },
      [samples.buffer],
    )
  }

  async function processAudioFile(file: File) {
    stopPlaybackForSourceChange()
    terminateTranscriptionWorker()

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadName(file.name)
      setConversionStatus('File is too large. Use a shorter audio file under 80 MB.')
      setConversionPhase('error')
      setConversionProgress(0)
      return
    }

    setOriginalAudioUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      return URL.createObjectURL(file)
    })
    setUploadName(file.name)
    setConversionStatus('Decoding audio')
    setConversionPhase('decoding')
    setConversionProgress(0.04)
    setConversionBackend(null)
    setConvertedNoteCount(0)
    setConvertedClip(null)
    setTempoConfidence(null)

    try {
      const decodedSamples = await decodeAudioFile(file)
      const decodedDuration = decodedSamples.length / BASIC_PITCH_SAMPLE_RATE
      const maxSamples = Math.floor(MAX_UPLOAD_SECONDS * BASIC_PITCH_SAMPLE_RATE)
      const samples =
        decodedSamples.length > maxSamples ? decodedSamples.slice(0, maxSamples) : decodedSamples
      setConversionStatus(
        decodedDuration > MAX_UPLOAD_SECONDS
          ? `Audio is ${decodedDuration.toFixed(1)}s; transcribing first ${MAX_UPLOAD_SECONDS}s`
          : 'Audio decoded, starting transcription',
      )
      setConversionPhase('loading-model')
      setConversionProgress(0.08)
      startTranscriptionWorker(samples, file.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audio decode failed'
      setConversionStatus(message)
      setConversionPhase('error')
      setConversionProgress(0)
    }
  }

  async function processMidiUpload(file: File) {
    stopPlaybackForSourceChange()
    terminateTranscriptionWorker()

    setOriginalAudioUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      return null
    })
    setUploadName(file.name)
    setConversionStatus('Reading MIDI')
    setConversionPhase('decoding')
    setConversionProgress(0.12)
    setConversionBackend('midi')
    setConvertedNoteCount(0)
    setConvertedClip(null)
    setTempoConfidence(null)

    try {
      const parsed = await parseMidiFile(file)
      const sourceBpm = parsed.tempoSource === 'default' ? midiFallbackBpm : parsed.estimatedBpm
      const tempoScale = parsed.tempoSource === 'default' ? DEFAULT_MIDI_FALLBACK_BPM / sourceBpm : 1
      const autoBpm = Math.max(60, Math.min(190, sourceBpm))
      const sourceDuration = parsed.duration * tempoScale
      const sourceNotes = parsed.notes.map((note) => ({
        ...note,
        start: note.start * tempoScale,
        end: note.end * tempoScale,
      }))
      const notes = normalizeClipNotes(sourceNotes, sourceDuration)

      if (!notes.length) throw new Error('No playable MIDI notes found')

      setConversionStatus('Quantizing MIDI to the step grid')
      setConversionPhase('quantizing')
      setConversionProgress(0.72)

      const secondsPerStep = (60 / autoBpm) / 4
      const nextStepCount = clampStepCount(Math.min(MAX_STEP_COUNT, Math.ceil(sourceDuration / secondsPerStep)))
      const gridDuration = nextStepCount * secondsPerStep
      const gridNotes = notes.filter((note) => note.start < gridDuration)
      const quantized = notesToSequence(gridNotes, autoBpm, nextStepCount, {
        density: melodyDensity,
        mode: conversionMode,
        simplify: simplifyNotes,
        advanced: advancedConversion,
      })
      const selectedCount = quantized.sequence.reduce((total, row) => total + row.filter(Boolean).length, 0)
      const wasTrimmed = sourceDuration > gridDuration + secondsPerStep

      pushHistory()
      if (autoBpm !== bpm) setBpm(autoBpm)
      setStepCount(nextStepCount)
      stepCountRef.current = nextStepCount
      setSequence(quantized.sequence)
      sequenceRef.current = quantized.sequence
      setStepVowels(quantized.vowels)
      stepVowelsRef.current = quantized.vowels
      setStepAccents(quantized.accents)
      stepAccentsRef.current = quantized.accents
      setConvertedClip({ name: file.name, duration: sourceDuration, notes })
      setConvertedNoteCount(selectedCount)
      setConversionPhase('rendered')
      setConversionProgress(1)
      setTempoConfidence(parsed.tempoConfidence)
      setConversionStatus(
        selectedCount
          ? `Imported ${selectedCount} MIDI grid notes / ${autoBpm} BPM${
              parsed.tempoSource === 'default' ? ' default tempo' : ''
            }${wasTrimmed ? ` / first ${gridDuration.toFixed(1)}s only` : ''}${
              parsed.rawNoteCount > selectedCount * 3 ? ' / simplified dense MIDI' : ''
            }`
          : 'MIDI parsed, but Simplify removed every note',
      )
    } catch (error) {
      setConversionStatus(error instanceof Error ? error.message : 'MIDI import failed')
      setConversionPhase('error')
      setConversionProgress(0)
      setConversionBackend('midi')
    }
  }

  async function processUploadedFile(file: File) {
    if (isMidiFile(file)) {
      await processMidiUpload(file)
      return
    }

    await processAudioFile(file)
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    void processUploadedFile(file)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    handleFiles(event.dataTransfer.files)
  }

  function downloadCurrentMidi() {
    const clip = getCurrentExportClip()

    exportMidi(clip, bpm)
  }

  function getCurrentExportClip() {
    return sequenceToClip(sequenceRef.current, bpm, stepCountRef.current, stepVowelsRef.current, stepAccentsRef.current, gateRef.current)
  }

  async function downloadCurrentWav() {
    const clip = getCurrentExportClip()
    if (!clip.notes.length || isRenderingWav) return

    setIsRenderingWav(true)
    try {
      const wavBlob = await renderClipToWav(clip, knobsRef.current)
      downloadBlob(wavBlob, `${safeDownloadBaseName(clip.name)}.wav`)
    } catch (error) {
      console.error(error)
      setConversionStatus(error instanceof Error ? error.message : 'WAV render failed')
    } finally {
      setIsRenderingWav(false)
    }
  }

  function buildProjectFile(): ChantPadProject {
    return {
      app: APP_NAME,
      version: 1,
      savedAt: new Date().toISOString(),
      bpm,
      stepCount,
      loop,
      vowel,
      voicePreset,
      expression,
      knobs,
      gate,
      sequence: sequence.map((row) => row.slice(0, stepCount)),
      stepVowels: stepVowels.slice(0, stepCount),
      stepAccents: stepAccents.slice(0, stepCount),
    }
  }

  function downloadProjectJson() {
    const project = buildProjectFile()
    const json = JSON.stringify(project, null, 2)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadBlob(new Blob([json], { type: 'application/json' }), `mantrasynth-project-${stamp}.json`)
  }

  async function loadProjectJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ChantPadProject>
      const nextStepCount = clampStepCount(clampNumber(parsed.stepCount, MIN_STEP_COUNT, MAX_STEP_COUNT, DEFAULT_STEP_COUNT))
      const nextSequence = normalizeProjectSequence(parsed.sequence, nextStepCount)
      const nextVowels = normalizeProjectVowels(parsed.stepVowels, nextStepCount)
      const nextAccents = normalizeProjectAccents(parsed.stepAccents, nextStepCount)
      const nextKnobs = normalizeProjectKnobs(parsed.knobs)
      const nextExpression = normalizeProjectExpression(parsed.expression)
      const nextVowel = isVowelId(parsed.vowel) ? parsed.vowel : nextVowels[0] ?? 'aa'
      const nextVoicePreset = (
        VOICE_PRESETS.some((option) => option.id === parsed.voicePreset) ? parsed.voicePreset : 'chant'
      ) as VoicePresetId
      const nextBpm = Math.round(clampNumber(parsed.bpm, 60, 190, DEFAULT_BPM))

      stopTransport()
      voiceEngineRef.current?.stopSustain()
      heldPadNoteRef.current = null
      heldKeyboardNoteRef.current = null
      padHoldingRef.current = false
      stepCountRef.current = nextStepCount
      sequenceRef.current = nextSequence
      stepVowelsRef.current = nextVowels
      vowelRef.current = nextVowel
      knobsRef.current = nextKnobs
      voicePresetRef.current = nextVoicePreset
      stepAccentsRef.current = nextAccents
      gateRef.current = Math.round(clampNumber(parsed.gate, 18, 142, DEFAULT_DEMO_PRESET.gate))

      setBpm(nextBpm)
      setGate(gateRef.current)
      setLoop(parsed.loop ?? true)
      setStepCount(nextStepCount)
      setSequence(nextSequence)
      setStepVowels(nextVowels)
      setStepAccents(nextAccents)
      setVowel(nextVowel)
      setExpression(nextExpression)
      setKnobs(nextKnobs)
      setVoicePreset(nextVoicePreset)
      setConvertedClip(null)
      setConvertedNoteCount(0)
      setConversionBackend(null)
      setConversionPhase('idle')
      setConversionProgress(0)
      setConversionStatus(`Loaded ${file.name}`)
      setActiveStep(-1)
      setPadLatched(false)
      releaseMouth()
    } catch (error) {
      console.error(error)
      setConversionPhase('error')
      setConversionProgress(0)
      setConversionStatus('Project JSON could not be loaded')
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = ''
    }
  }

  function handleProjectFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    void loadProjectJson(file)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
      if (isTyping) return

      if (event.code === 'Space') {
        event.preventDefault()
        if (isPlaying) pauseTransport()
        else void startTransport()
      } else if (event.code === 'Escape') {
        event.preventDefault()
        stopTransport()
      } else if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        setIsRecording((value) => !value)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoProject()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redoProject()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicatePattern()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        downloadProjectJson()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        projectInputRef.current?.click()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const faceIntensity = expression.pitch / 100
  const steppedFaceIntensity = Math.min(1, Math.floor(faceIntensity * 4) / 3)
  const performerStyle = {
    '--vowel-color': currentVowel.color,
    '--mouth-scale': (0.72 + faceIntensity * 0.48).toFixed(2),
    '--mouth-sing-scale': (0.82 + faceIntensity * 0.56).toFixed(2),
    '--brow-lift': `${Math.round(-1 - faceIntensity * 5)}px`,
    '--eye-scale': (1 + steppedFaceIntensity * 0.3).toFixed(2),
    '--aura-opacity': (0.14 + steppedFaceIntensity * 0.78).toFixed(2),
    '--aura-scale': (0.86 + steppedFaceIntensity * 0.36).toFixed(2),
  } as CSSProperties

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label={APP_NAME}>
          <span className="brand-mark">
            <Music2 size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Formant workstation</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>
        <div className="session-strip">
          <a
            className="github-link"
            href="https://github.com/Saganaki22/MantraSynth"
            target="_blank"
            rel="noreferrer"
            title="Open MantraSynth on GitHub"
            aria-label="Open MantraSynth on GitHub"
          >
            <GitHubMark width={16} height={16} aria-hidden="true" />
            GitHub
          </a>
          <span>Apache-2.0</span>
          <span>{bpm} BPM</span>
          <span>{currentVowel.label}</span>
          <span>{isPlaying ? 'Playing' : isRecording ? 'Recording' : 'Idle'}</span>
        </div>
      </header>

      <section className={`workspace-grid ${uploadPanelCollapsed ? 'is-upload-collapsed' : ''}`}>
        <aside className="panel performer-panel" aria-label="Animated voice performer">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Performer</p>
              <h2>Vowel Avatar</h2>
            </div>
            <span className="live-chip" style={{ '--vowel-color': currentVowel.color } as CSSProperties}>
              {currentVowel.label}
            </span>
          </div>

          <div className="vowel-selector" aria-label="Step vowel">
            {VOWEL_BUTTONS.map((option) => {
              const optionVowel = getVowel(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  className={vowel === option.id ? 'is-active' : ''}
                  style={{ '--vowel-color': optionVowel.color } as CSSProperties}
                  onClick={() => {
                    vowelRef.current = option.id
                    setVowel(option.id)
                  }}
                  title={`Paint new steps with ${option.label}`}
                  aria-pressed={vowel === option.id}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className={`performer ${mouthPulse ? 'is-singing' : ''}`} style={performerStyle}>
            <div className="halo" />
            <div className="torso">
              <div className="neck" />
              <div className="robe left" />
              <div className="robe right" />
            </div>
            <div className="head">
              <span className="ear left" />
              <span className="ear right" />
              <span className="brow left" />
              <span className="brow right" />
              <span className="eye left" />
              <span className="eye right" />
              <span className={`mouth mouth-${vowel}`} />
            </div>
          </div>

          <button
            type="button"
            className="xy-pad"
            onPointerDown={(event) => void startPadVoice(event)}
            onPointerMove={movePadVoice}
            onPointerUp={stopPadVoice}
            onPointerCancel={stopPadVoice}
            onPointerLeave={(event) => {
              if (padHoldingRef.current) stopPadVoice(event)
            }}
          >
            <span className="pad-gradient" />
            <span className="pad-cursor" style={{ left: `${expression.pitch}%`, top: `${100 - expression.openness}%` }} />
            <span className="pad-axis x">Pitch</span>
            <span className="pad-axis y">Vowel</span>
          </button>

          <button
            type="button"
            className={`sustain-toggle ${padSustain ? 'is-active' : ''} ${padLatched ? 'is-latched' : ''}`}
            onClick={togglePadSustain}
            aria-pressed={padSustain}
          >
            <Repeat2 size={16} aria-hidden="true" />
            Sustain
          </button>

          <div className="readout-grid">
            <Meter label="Pitch" value={expression.pitch} />
            <Meter label="Open" value={expression.openness} />
          </div>
        </aside>

        <section className="panel composer-panel" aria-label="Song timeline and keyboard">
          <div className="transport-row">
            <div className="transport-buttons">
              <button
                type="button"
                className={`icon-button primary ${isPlaying ? 'is-playing' : ''}`}
                onClick={() => void startTransport()}
                title={isPlaying ? 'Playing' : 'Play'}
                aria-label="Play"
                aria-pressed={isPlaying}
              >
                <Play size={18} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={pauseTransport} title="Pause" aria-label="Pause">
                <Pause size={18} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={() => stopTransport()} title="Stop" aria-label="Stop">
                <Square size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`icon-button ${isRecording ? 'is-armed' : ''}`}
                onClick={() => setIsRecording((value) => !value)}
                title="Record"
                aria-label="Record"
              >
                <Circle size={17} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={clearSequence} title="Delete sequence" aria-label="Delete sequence">
                <Trash2 size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="export-button"
                onClick={downloadCurrentMidi}
                title="Download MIDI"
                aria-label="Download MIDI"
                disabled={!hasDownloadableNotes}
              >
                <Download size={17} aria-hidden="true" />
                MIDI
              </button>
              <button
                type="button"
                className="export-button"
                onClick={() => void downloadCurrentWav()}
                title="Download WAV"
                aria-label="Download WAV"
                disabled={!hasDownloadableNotes || isRenderingWav}
              >
                <Download size={17} aria-hidden="true" />
                {isRenderingWav ? 'WAV...' : 'WAV'}
              </button>
              <button
                type="button"
                className={`export-button ${autoScroll ? 'is-active' : ''}`}
                onClick={() => setAutoScroll((value) => !value)}
                title="Toggle timeline auto-scroll"
                aria-label="Toggle timeline auto-scroll"
                aria-pressed={autoScroll}
              >
                Auto-scroll
              </button>
            </div>

            <div className="tempo-tools">
              <label>
                BPM
                <input type="number" min="60" max="190" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
              </label>
              <label>
                Steps
                <input
                  type="number"
                  min={MIN_STEP_COUNT}
                  max={MAX_STEP_COUNT}
                  step="4"
                  value={stepCount}
                  onChange={(event) => resizeStepCount(Number(event.target.value))}
                />
              </label>
              <button type="button" className="icon-button" onClick={() => resizeStepCount(stepCount - 16)} title="Remove 16 steps" aria-label="Remove 16 steps" disabled={stepCount <= MIN_STEP_COUNT}>
                <Minus size={17} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={() => resizeStepCount(stepCount + 16)} title="Add 16 steps" aria-label="Add 16 steps" disabled={stepCount >= MAX_STEP_COUNT}>
                <Plus size={17} aria-hidden="true" />
              </button>
              <button type="button" className={`loop-button ${loop ? 'is-active' : ''}`} onClick={() => setLoop((value) => !value)}>
                <Repeat2 size={16} aria-hidden="true" />
                Loop
              </button>
            </div>
          </div>

          <div className="demo-strip" aria-label="Starter patterns">
            <div>
              <p className="eyebrow">Presets</p>
              <h2>Starter Grooves</h2>
            </div>
            <div className="demo-buttons">
              {DEMO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={selectedDemoPreset === preset.id ? 'is-active' : ''}
                  onClick={() => loadDemoPreset(preset.id)}
                  title={`Load ${preset.label}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div
            ref={timelineRef}
            className="timeline"
            role="grid"
            aria-label="Sequencer"
            onPointerMove={continueStepPaintFromPointer}
            style={
              {
                '--step-count': stepCount,
                '--timeline-min-width': `${52 + stepCount * 32}px`,
              } as CSSProperties
            }
          >
            <div className="timeline-header">
              <span />
              {steps.map((step) => (
                <span key={step} className={activeStep === step ? 'is-current' : ''}>
                  {step + 1}
                </span>
              ))}
            </div>
            {NOTES.map((note, rowIndex) => (
              <div className="timeline-row" role="row" key={note}>
                <span className="note-label">{note}</span>
                {steps.map((step) => (
                  <button
                    key={`${note}-${step}`}
                    type="button"
                    data-row-index={rowIndex}
                    data-step-index={step}
                    className={`step ${sequence[rowIndex][step] ? 'is-on' : ''} ${activeStep === step ? 'is-current' : ''}`}
                    style={{ '--step-accent': stepAccents[step] ?? 0.82 } as CSSProperties}
                    onPointerDown={(event) => startStepPaint(event, rowIndex, step)}
                    onPointerEnter={() => continueStepPaint(rowIndex, step)}
                    onContextMenu={(event) => event.preventDefault()}
                    aria-label={`${note} step ${step + 1}${sequence[rowIndex][step] ? ` ${getVowelStepLabel(stepVowels[step] ?? 'aa')}` : ''}`}
                  >
                    {sequence[rowIndex][step] ? <span>{getVowelStepLabel(stepVowels[step] ?? 'aa')}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="keyboard" aria-label="Synth keyboard">
            {NOTES.map((note, index) => (
              <button
                key={note}
                type="button"
                className={`key ${index % 3 === 1 ? 'is-raised' : ''} ${activeKeyboardNote === note ? 'is-pressed' : ''}`}
                onPointerDown={(event) => pressKeyboardNote(event, note)}
                onPointerUp={(event) => releaseKeyboardNote(event, note)}
                onPointerCancel={(event) => releaseKeyboardNote(event, note)}
                onPointerLeave={(event) => {
                  if (activeKeyboardNote === note) releaseKeyboardNote(event, note)
                }}
                aria-pressed={activeKeyboardNote === note}
              >
                <span>{note}</span>
              </button>
            ))}
          </div>

          <div className="shortcut-strip" aria-label="Keyboard shortcuts">
            <span>Space Play</span>
            <span>Esc Stop</span>
            <span>R Record</span>
            <span>Ctrl+Z Undo</span>
            <span>Ctrl+D Duplicate</span>
          </div>

          <div className="synth-rack-inline" aria-label="Synth effects">
            <div className="rack-heading">
              <div>
                <p className="eyebrow">Effects</p>
                <h2>Voice Rack</h2>
              </div>
              <button type="button" className="icon-button" onClick={resetSynthControls} title="Reset controls" aria-label="Reset controls">
                <RotateCcw size={17} aria-hidden="true" />
              </button>
            </div>
            <div className="knob-grid">
              <div className="voice-presets" aria-label="Voice presets">
                {VOICE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={voicePreset === preset.id ? 'is-active' : ''}
                    onClick={() => applyVoicePreset(preset.id)}
                    title={`${preset.label} voice preset`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="output-meter" aria-label="Output level">
                <span>Output</span>
                <div>
                  <i style={{ width: `${Math.round(outputLevel * 100)}%` }} />
                </div>
                <strong>{Math.round(outputLevel * 100)}%</strong>
              </div>
              <RangeControl
                label="Gate"
                value={gate}
                min={18}
                max={142}
                unit="%"
                minText="Short"
                maxText="Long"
                onChange={setGate}
              />
              <Knob label="Voice" min={-24} max={24} value={knobs.voice} unit="" onChange={(value) => setKnobs((current) => ({ ...current, voice: value }))} />
              <Knob label="Glide" min={0} max={80} value={knobs.glide} unit="ms" onChange={(value) => setKnobs((current) => ({ ...current, glide: value }))} />
              <Knob
                label="Vowel Glide"
                min={0}
                max={260}
                value={knobs.vowelGlide}
                unit="ms"
                onChange={(value) => setKnobs((current) => ({ ...current, vowelGlide: value }))}
              />
              <Knob label="Delay" min={0} max={86} value={knobs.delay} unit="%" onChange={(value) => setKnobs((current) => ({ ...current, delay: value }))} />
              <Knob
                label="Formant"
                min={20}
                max={90}
                value={knobs.resonance}
                unit="%"
                onChange={(value) => setKnobs((current) => ({ ...current, resonance: value }))}
              />
              <Knob label="Gain" min={0} max={100} value={knobs.gain} unit="%" onChange={(value) => setKnobs((current) => ({ ...current, gain: value }))} />
            </div>
          </div>

          <div className="project-strip" aria-label="Project file">
            <input
              ref={projectInputRef}
              className="project-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => handleProjectFiles(event.target.files)}
            />
            <div>
              <p className="eyebrow">Project</p>
              <h2>Pattern File</h2>
            </div>
            <div className="project-summary">
              <span>{stepCount} steps</span>
              <span>{bpm} BPM</span>
              <span>{hasSequenceNotes ? 'Pattern ready' : 'Empty pattern'}</span>
            </div>
            <div className="project-actions">
              <button type="button" className="export-button" onClick={undoProject} title="Undo last pattern edit" aria-label="Undo last pattern edit">
                Undo
              </button>
              <button type="button" className="export-button" onClick={redoProject} title="Redo last pattern edit" aria-label="Redo last pattern edit">
                Redo
              </button>
              <button type="button" className="export-button" onClick={duplicatePattern} title="Duplicate pattern length" aria-label="Duplicate pattern length">
                Duplicate
              </button>
              <button type="button" className="export-button" onClick={resetProject} title="Reset project" aria-label="Reset project">
                Reset
              </button>
              <button type="button" className="export-button" onClick={downloadProjectJson} title="Download project JSON" aria-label="Download project JSON">
                <Download size={17} aria-hidden="true" />
                JSON
              </button>
              <button
                type="button"
                className="export-button"
                onClick={() => projectInputRef.current?.click()}
                title="Upload project JSON"
                aria-label="Upload project JSON"
              >
                <UploadCloud size={17} aria-hidden="true" />
                Load
              </button>
            </div>
          </div>
        </section>

        <aside className={`panel control-panel ${uploadPanelCollapsed ? 'is-collapsed' : ''}`} aria-label="Import audio or MIDI">
          <div className="panel-heading upload-heading">
            <div>
              <p className="eyebrow">Import</p>
              <h2>Audio or MIDI</h2>
            </div>
            <div className="heading-actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => setUploadPanelCollapsed((value) => !value)}
                title={uploadPanelCollapsed ? 'Expand import panel' : 'Minimize import panel'}
                aria-label={uploadPanelCollapsed ? 'Expand import panel' : 'Minimize import panel'}
                aria-expanded={!uploadPanelCollapsed}
              >
                {uploadPanelCollapsed ? <Plus size={17} aria-hidden="true" /> : <Minus size={17} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {uploadPanelCollapsed ? (
            <button type="button" className="collapsed-upload-summary" onClick={() => setUploadPanelCollapsed(false)} aria-label="Expand import panel">
              <UploadCloud size={18} aria-hidden="true" />
              <span>Import</span>
            </button>
          ) : (
            <div className="upload-panel-body">
              <div className="conversion-controls" aria-label="Upload conversion controls">
                <label>
                  Density
                  <select value={melodyDensity} onChange={(event) => setMelodyDensity(event.target.value as MelodyDensity)}>
                    <option value="sparse">Sparse</option>
                    <option value="normal">Normal</option>
                    <option value="busy">Busy</option>
                  </select>
                </label>
                <label>
                  Voices
                  <select value={conversionMode} onChange={(event) => setConversionMode(event.target.value as ConversionMode)}>
                    <option value="mono">Mono</option>
                    <option value="layered">Layered</option>
                  </select>
                </label>
                <label>
                  Simplify
                  <input type="range" min="0" max="100" value={simplifyNotes} onChange={(event) => setSimplifyNotes(Number(event.target.value))} />
                  <strong>{simplifyNotes}%</strong>
                </label>
              </div>

              <button
                type="button"
                className="advanced-toggle"
                onClick={() => setAdvancedUploadOpen((value) => !value)}
                aria-expanded={advancedUploadOpen}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                Advanced Basic Pitch
              </button>

              {advancedUploadOpen ? (
                <div className="advanced-conversion" aria-label="Advanced upload conversion">
                  <RangeControl
                    label="Note Segmentation"
                    value={advancedConversion.noteSegmentation}
                    min={0}
                    max={100}
                    unit="%"
                    minText="Split"
                    maxText="Merge"
                    onChange={(value) => updateAdvancedConversion('noteSegmentation', value)}
                  />
                  <RangeControl
                    label="Model Confidence"
                    value={advancedConversion.modelConfidence}
                    min={5}
                    max={95}
                    unit="%"
                    minText="More notes"
                    maxText="Fewer"
                    onChange={(value) => updateAdvancedConversion('modelConfidence', value)}
                  />
                  <RangeControl
                    label="Min Pitch"
                    value={advancedConversion.minPitchHz}
                    min={0}
                    max={3000}
                    step={10}
                    unit="Hz"
                    minText="Low"
                    maxText="High"
                    onChange={(value) => updateAdvancedConversion('minPitchHz', value)}
                  />
                  <RangeControl
                    label="Max Pitch"
                    value={advancedConversion.maxPitchHz}
                    min={80}
                    max={5000}
                    step={10}
                    unit="Hz"
                    minText="Low"
                    maxText="High"
                    onChange={(value) => updateAdvancedConversion('maxPitchHz', value)}
                  />
                  <RangeControl
                    label="Min Note"
                    value={advancedConversion.minNoteMs}
                    min={8}
                    max={400}
                    unit="ms"
                    minText="Short"
                    maxText="Long"
                    onChange={(value) => updateAdvancedConversion('minNoteMs', value)}
                  />
                  <RangeControl
                    label="MIDI Fallback BPM"
                    value={midiFallbackBpm}
                    min={60}
                    max={190}
                    unit="BPM"
                    minText="Slow"
                    maxText="Fast"
                    onChange={setMidiFallbackBpm}
                  />
                </div>
              ) : null}

              <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                <input type="file" accept="audio/*,.mid,.midi,audio/midi,audio/x-midi" onChange={(event) => handleFiles(event.target.files)} />
                <UploadCloud size={24} aria-hidden="true" />
                <span>{uploadName}</span>
                <small>Drop or choose audio, instrumental, .mid, or .midi</small>
                <small>{conversionStatus}</small>
                <span className="upload-progress" aria-hidden="true">
                  <i style={{ width: `${Math.round(conversionProgress * 100)}%` }} />
                </span>
                <span className="upload-meta">
                  {conversionBackend ? conversionBackend.toUpperCase() : 'AUTO'}
                  {convertedNoteCount ? ` / ${convertedNoteCount} notes` : ''}
                  {tempoConfidence !== null ? ` / tempo ${Math.round(tempoConfidence * 100)}%` : ''}
                </span>
              </label>

              <div className="preview-panel" aria-label="Preview controls">
                {originalAudioUrl ? (
                  <audio
                    ref={originalAudioRef}
                    controls
                    src={originalAudioUrl}
                    onPlay={() => {
                      stopTransport()
                      voiceEngineRef.current?.stopSustain()
                    }}
                  />
                ) : (
                  <span>No original preview loaded</span>
                )}
                <button type="button" className="export-button" onClick={() => void startTransport()} disabled={!hasSequenceNotes} title="Preview converted grid" aria-label="Preview converted grid">
                  <Play size={15} aria-hidden="true" />
                  Converted
                </button>
                <button type="button" className="export-button" onClick={clearUploadSource} disabled={!hasUploadedSource} title="Remove uploaded source" aria-label="Remove uploaded source">
                  <Trash2 size={15} aria-hidden="true" />
                  Remove
                </button>
              </div>

              <div className="upload-tips">
                <strong>Upload tips</strong>
                <span>Audio uses Basic Pitch ONNX, then snaps to this grid. MIDI skips ONNX and imports tempo when the file has it. Use Sparse or higher Simplify when the source is too busy.</span>
              </div>

              <div className="pipeline-list" aria-label="Conversion pipeline">
                <PipelineStep label="Decode" active={phaseAtLeast(conversionPhase, 'decoding')} />
                <PipelineStep label="Transcribe" active={phaseAtLeast(conversionPhase, 'transcribing')} />
                <PipelineStep label="Quantize" active={phaseAtLeast(conversionPhase, 'quantizing')} />
                <PipelineStep label="Render" active={phaseAtLeast(conversionPhase, 'rendered')} />
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  )
}

function encodeVariableLength(value: number) {
  let buffer = value & 0x7f
  const bytes: number[] = []

  while ((value >>= 7)) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
  }

  for (;;) {
    bytes.push(buffer & 0xff)
    if (buffer & 0x80) buffer >>= 8
    else break
  }

  return bytes
}

function pushText(bytes: number[], text: string) {
  for (const character of text) bytes.push(character.charCodeAt(0))
}

function safeDownloadBaseName(name: string) {
  return (name.replace(/\.[^.]+$/, '') || 'mantrasynth').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'mantrasynth'
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function sequenceToClip(
  sequence: boolean[][],
  bpm: number,
  stepCount: number,
  stepVowels: VowelId[] = createDefaultStepVowels(stepCount),
  stepAccents: number[] = createDefaultStepAccents(stepCount),
  gate = DEFAULT_DEMO_PRESET.gate,
): VocalClip {
  const secondsPerStep = (60 / bpm) / 4
  const gateRatio = Math.max(0.18, Math.min(1.42, gate / 100))
  const notes = sequence.flatMap((row, rowIndex) =>
    row.flatMap((isActive, step) =>
      isActive
        ? [
            {
              start: step * secondsPerStep,
              end: Math.min((step + gateRatio) * secondsPerStep, stepCount * secondsPerStep),
              midi: NOTE_MIDI_VALUES[rowIndex],
              velocity: Math.max(0.42, Math.min(1, stepAccents[step] ?? 0.82)),
              vowel: stepVowels[step] ?? 'aa',
            },
          ]
        : [],
    ),
  )

  return {
    name: 'mantrasynth-sequence',
    duration: stepCount * secondsPerStep,
    notes,
  }
}

function exportMidi(clip: VocalClip | null, bpm: number) {
  if (!clip?.notes.length) return

  const ticksPerQuarter = 480
  const ticksPerSecond = (ticksPerQuarter * bpm) / 60
  const microsecondsPerQuarter = Math.round(60_000_000 / bpm)
  const events = clip.notes.flatMap((note) => [
    { tick: Math.round(note.start * ticksPerSecond), bytes: [0x90, note.midi, Math.round(note.velocity * 104)] },
    { tick: Math.round(note.end * ticksPerSecond), bytes: [0x80, note.midi, 0x40] },
  ])

  events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0])

  const track: number[] = [
    0x00,
    0xff,
    0x51,
    0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  ]
  let lastTick = 0

  events.forEach((event) => {
    track.push(...encodeVariableLength(Math.max(0, event.tick - lastTick)), ...event.bytes)
    lastTick = event.tick
  })

  track.push(0x00, 0xff, 0x2f, 0x00)

  const bytes: number[] = []
  pushText(bytes, 'MThd')
  bytes.push(0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, ticksPerQuarter >> 8, ticksPerQuarter & 0xff)
  pushText(bytes, 'MTrk')
  bytes.push((track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff, ...track)

  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'audio/midi' }), `${safeDownloadBaseName(clip.name)}.mid`)
}

async function renderClipToWav(clip: VocalClip, knobs: KnobState) {
  if (!clip.notes.length) throw new Error('There are no notes to render')
  if (!window.OfflineAudioContext) throw new Error('This browser cannot render WAV offline')

  const sampleRate = 44100
  const renderDuration = Math.max(1, clip.duration + 1.8)
  const offlineContext = new OfflineAudioContext(1, Math.ceil(renderDuration * sampleRate), sampleRate)
  const engine = new MonkVoiceEngine(offlineContext)
  engine.update(knobs)

  clip.notes.forEach((note) => {
    engine.scheduleNote(
      midiToNoteName(note.midi),
      (note.vowel ?? noteToVowel(note)) as MonkVowelId,
      note.start,
      Math.max(0.08, note.end - note.start),
      note.velocity,
    )
  })

  const buffer = await offlineContext.startRendering()
  engine.dispose()
  return audioBufferToWavBlob(buffer)
}

function audioBufferToWavBlob(buffer: AudioBuffer) {
  const channel = buffer.getChannelData(0)
  const headerBytes = 44
  const bytesPerSample = 2
  const dataBytes = channel.length * bytesPerSample
  const arrayBuffer = new ArrayBuffer(headerBytes + dataBytes)
  const view = new DataView(arrayBuffer)

  function writeString(offset: number, text: string) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = headerBytes
  for (let index = 0; index < channel.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, channel[index]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

type MeterProps = {
  label: string
  value: number
}

function Meter({ label, value }: MeterProps) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div>
        <i style={{ width: `${value}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  )
}

type KnobProps = {
  label: string
  min: number
  max: number
  value: number
  unit: string
  onChange: (value: number) => void
}

function Knob({ label, min, max, value, unit, onChange }: KnobProps) {
  const angle = ((value - min) / (max - min)) * 270 - 135

  return (
    <label className="knob-control">
      <span className="knob" style={{ '--knob-angle': `${angle}deg` } as CSSProperties}>
        <i />
      </span>
      <span>{label}</span>
      <strong>
        {value}
        {unit}
      </strong>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

type RangeControlProps = {
  label: string
  value: number
  min: number
  max: number
  unit: string
  minText: string
  maxText: string
  step?: number
  onChange: (value: number) => void
}

function RangeControl({ label, value, min, max, unit, minText, maxText, step = 1, onChange }: RangeControlProps) {
  return (
    <label className="range-control">
      <span>
        <strong>{label}</strong>
        <em>
          {Math.round(value)}
          {unit}
        </em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <small>
        <b>{minText}</b>
        <b>{maxText}</b>
      </small>
    </label>
  )
}

type PipelineStepProps = {
  label: string
  active: boolean
}

function PipelineStep({ label, active }: PipelineStepProps) {
  return (
    <span className={active ? 'is-active' : ''}>
      <i />
      {label}
    </span>
  )
}

export default App
