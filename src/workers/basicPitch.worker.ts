/// <reference lib="webworker" />

import type {
  BasicPitchAdvancedSettings,
  BasicPitchRequest,
  BasicPitchWorkerMessage,
  ConversionMode,
  ConversionPhase,
  MelodyDensity,
  TranscribedNote,
  TranscriptionBackend,
} from '../audio/basicPitchTypes'

type OrtModule = typeof import('onnxruntime-web')
type OrtSession = import('onnxruntime-web').InferenceSession

const MODEL_URL = '/models/basic-pitch/nmp.onnx'
const MODEL_CACHE_NAME = 'mantrasynth-basic-pitch-v1'

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
const DEFAULT_ONSET_THRESHOLD = 0.58
const DEFAULT_NOTE_ON_THRESHOLD = 0.34
const DEFAULT_NOTE_OFF_THRESHOLD = 0.3
const DEFAULT_STRONG_NOTE_THRESHOLD = 0.88
const MIN_NOTE_SECONDS = 0.09
const ONSET_CLUSTER_SECONDS = 0.09
const OVERLAP_SECONDS = 0.035
const TEMPO_FRAME = 1024
const TEMPO_HOP = 512
const MIN_BPM = 70
const MAX_BPM = 180

let session: OrtSession | null = null
let ortModule: OrtModule | null = null
let activeBackend: TranscriptionBackend | null = null
let modelBytes: Uint8Array | null = null
let usedFallback = false

type NoteExtractionSettings = {
  onsetThreshold: number
  noteOnThreshold: number
  noteOffThreshold: number
  strongNoteThreshold: number
  minNoteFrames: number
  minMidi: number
  maxMidi: number
  minNoteSeconds: number
  clusterSeconds: number
}

function post(message: BasicPitchWorkerMessage) {
  self.postMessage(message)
}

function progress(
  phase: ConversionPhase,
  progressValue: number,
  message: string,
  extra: { backend?: TranscriptionBackend; chunk?: number; totalChunks?: number } = {},
) {
  post({
    type: 'progress',
    phase,
    progress: Math.max(0, Math.min(1, progressValue)),
    message,
    backend: activeBackend ?? undefined,
    ...extra,
  })
}

async function fetchModel() {
  if (modelBytes) return modelBytes

  progress('loading-model', 0.08, 'Loading cached Basic Pitch model')
  const cache = 'caches' in self ? await self.caches.open(MODEL_CACHE_NAME) : null
  let response = cache ? await cache.match(MODEL_URL) : undefined

  if (!response) {
    progress('loading-model', 0.08, 'Downloading Basic Pitch ONNX model')
    response = await fetch(MODEL_URL)
    if (response.ok && cache) await cache.put(MODEL_URL, response.clone())
  }

  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status} ${response.statusText}`)
  }

  modelBytes = new Uint8Array(await response.arrayBuffer())
  return modelBytes
}

function configureOrt(ort: OrtModule) {
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.max(1, Math.min(4, self.navigator.hardwareConcurrency || 1))
    : 1
}

async function createSession(preferWebGpu: boolean) {
  if (session && ortModule && activeBackend) return { ort: ortModule, session, backend: activeBackend }

  const model = await fetchModel()
  const canTryWebGpu = preferWebGpu && 'gpu' in self.navigator

  if (canTryWebGpu) {
    try {
      const ort = await import('onnxruntime-web/webgpu')
      configureOrt(ort)
      progress('loading-model', 0.14, 'Starting ONNX Runtime WebGPU')
      session = await ort.InferenceSession.create(model, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      })
      ortModule = ort
      activeBackend = 'webgpu'
      return { ort, session, backend: activeBackend }
    } catch (error) {
      usedFallback = true
      console.warn('WebGPU transcription failed, falling back to WASM.', error)
    }
  }

  const ort = await import('onnxruntime-web/wasm')
  configureOrt(ort)
  progress('loading-model', 0.18, 'Starting ONNX Runtime WASM')
  session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  ortModule = ort
  activeBackend = 'wasm'
  return { ort, session, backend: activeBackend }
}

function resampleLinear(input: Float32Array, inputRate: number) {
  if (inputRate === SAMPLE_RATE) return input

  const ratio = inputRate / SAMPLE_RATE
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

function outputValue(data: Float32Array, frame: number, pitch: number) {
  return data[frame * NOTE_BINS + pitch] ?? 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function hzToMidi(hz: number, fallback: number) {
  if (!Number.isFinite(hz) || hz <= 0) return fallback
  return Math.round(69 + 12 * Math.log2(hz / 440))
}

function buildExtractionSettings(advanced: BasicPitchAdvancedSettings): NoteExtractionSettings {
  const confidence = clamp(advanced.modelConfidence, 5, 95) / 100
  const mergeAmount = clamp(advanced.noteSegmentation, 0, 100) / 100
  const minPitchHz = clamp(advanced.minPitchHz, 0, 8000)
  const maxPitchHz = clamp(advanced.maxPitchHz, Math.max(1, minPitchHz), 12000)
  const minMidi = clamp(hzToMidi(minPitchHz, MIDI_OFFSET), MIDI_OFFSET, MIDI_OFFSET + NOTE_BINS - 1)
  const maxMidi = clamp(hzToMidi(maxPitchHz, MIDI_OFFSET + NOTE_BINS - 1), minMidi, MIDI_OFFSET + NOTE_BINS - 1)

  return {
    onsetThreshold: clamp(DEFAULT_ONSET_THRESHOLD + (confidence - 0.5) * 0.52, 0.25, 0.92),
    noteOnThreshold: clamp(DEFAULT_NOTE_ON_THRESHOLD + (confidence - 0.5) * 0.42, 0.12, 0.78),
    noteOffThreshold: clamp(DEFAULT_NOTE_OFF_THRESHOLD + (confidence - 0.5) * 0.24, 0.08, 0.62),
    strongNoteThreshold: clamp(DEFAULT_STRONG_NOTE_THRESHOLD + (confidence - 0.5) * 0.22, 0.58, 0.98),
    minNoteFrames: Math.round(clamp(2 + mergeAmount * 7, 2, 9)),
    minMidi,
    maxMidi,
    minNoteSeconds: clamp(advanced.minNoteMs, 8, 700) / 1000,
    clusterSeconds: clamp(0.035 + mergeAmount * 0.16, 0.025, 0.22),
  }
}

function extractWindowNotes(
  noteData: Float32Array,
  onsetData: Float32Array,
  windowStartSeconds: number,
  settings: NoteExtractionSettings,
) {
  const notes: TranscribedNote[] = []
  const secondsPerFrame = FFT_HOP / SAMPLE_RATE

  for (let pitch = 0; pitch < NOTE_BINS; pitch += 1) {
    const midi = MIDI_OFFSET + pitch
    if (midi < settings.minMidi || midi > settings.maxMidi) continue

    let frame = 0

    while (frame < ANNOTATION_FRAMES) {
      const note = outputValue(noteData, frame, pitch)
      const onset = outputValue(onsetData, frame, pitch)
      const previousOnset = frame > 0 ? outputValue(onsetData, frame - 1, pitch) : 0
      const nextOnset = frame < ANNOTATION_FRAMES - 1 ? outputValue(onsetData, frame + 1, pitch) : 0
      const localPeak = onset >= previousOnset && onset >= nextOnset

      if (
        (onset >= settings.onsetThreshold && note >= settings.noteOnThreshold && localPeak) ||
        note >= settings.strongNoteThreshold
      ) {
        const startFrame = frame
        let endFrame = frame + 1
        let velocitySum = note

        while (endFrame < ANNOTATION_FRAMES && outputValue(noteData, endFrame, pitch) > settings.noteOffThreshold) {
          velocitySum += outputValue(noteData, endFrame, pitch)
          endFrame += 1
        }

        if (endFrame - startFrame >= settings.minNoteFrames) {
          const averageVelocity = velocitySum / (endFrame - startFrame)
          notes.push({
            start: windowStartSeconds + startFrame * secondsPerFrame,
            end: windowStartSeconds + endFrame * secondsPerFrame,
            midi,
            velocity: Math.max(0.25, Math.min(1, averageVelocity)),
          })
        }

        frame = endFrame + 1
      } else {
        frame += 1
      }
    }
  }

  return notes
}

function dedupeNotes(notes: TranscribedNote[]) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi)
  const deduped: TranscribedNote[] = []

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

function noteScore(note: TranscribedNote) {
  return note.velocity - Math.abs(note.midi - 60) * 0.003
}

function collapseOnsetClusters(notes: TranscribedNote[]) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || noteScore(b) - noteScore(a))
  const clustered: TranscribedNote[] = []
  let cluster: TranscribedNote[] = []
  let clusterStart = 0

  function flushCluster() {
    if (!cluster.length) return
    clustered.push([...cluster].sort((a, b) => noteScore(b) - noteScore(a))[0])
    cluster = []
  }

  for (const note of sorted) {
    if (!cluster.length) {
      cluster = [note]
      clusterStart = note.start
      continue
    }

    if (note.start - clusterStart <= ONSET_CLUSTER_SECONDS) {
      cluster.push(note)
    } else {
      flushCluster()
      cluster = [note]
      clusterStart = note.start
    }
  }

  flushCluster()
  return clustered.sort((a, b) => a.start - b.start || a.midi - b.midi)
}

function enforceMonophonicLine(notes: TranscribedNote[]) {
  const line: TranscribedNote[] = []

  for (const note of collapseOnsetClusters(notes)) {
    let current: TranscribedNote | null = { ...note }

    while (current && line.length) {
      const previous = line[line.length - 1]
      const overlaps = current.start < previous.end - OVERLAP_SECONDS
      if (!overlaps) break

      if (noteScore(current) > noteScore(previous) + 0.04) {
        if (current.start - previous.start < MIN_NOTE_SECONDS) {
          line.pop()
        } else {
          previous.end = Math.max(previous.start + MIN_NOTE_SECONDS, current.start)
          break
        }
      } else {
        current = null
      }
    }

    if (current) line.push(current)
  }

  return line
}

function densitySettings(density: MelodyDensity, simplify: number, extraction: NoteExtractionSettings) {
  const simplifyAmount = Math.max(0, Math.min(1, simplify / 100))
  const base = {
    sparse: { minVelocity: 0.5, minSeconds: 0.14, maxPerSecond: 2.7, layeredVoices: 1 },
    normal: { minVelocity: 0.36, minSeconds: 0.09, maxPerSecond: 5.5, layeredVoices: 2 },
    busy: { minVelocity: 0.28, minSeconds: 0.065, maxPerSecond: 9, layeredVoices: 3 },
  }[density]

  return {
    minVelocity: base.minVelocity + simplifyAmount * 0.12,
    minSeconds: Math.max(extraction.minNoteSeconds, base.minSeconds + simplifyAmount * 0.12),
    maxPerSecond: Math.max(1.4, base.maxPerSecond * (1 - simplifyAmount * 0.62)),
    layeredVoices: Math.max(1, Math.round(base.layeredVoices - simplifyAmount)),
    clusterSeconds: extraction.clusterSeconds + simplifyAmount * 0.14,
  }
}

function collapseDenseClusters(notes: TranscribedNote[], clusterSeconds: number, keepCount: number) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || noteScore(b) - noteScore(a))
  const output: TranscribedNote[] = []
  let cluster: TranscribedNote[] = []
  let clusterStart = 0

  function flushCluster() {
    if (!cluster.length) return
    output.push(...[...cluster].sort((a, b) => noteScore(b) - noteScore(a)).slice(0, keepCount))
    cluster = []
  }

  for (const note of sorted) {
    if (!cluster.length) {
      cluster = [note]
      clusterStart = note.start
      continue
    }

    if (note.start - clusterStart <= clusterSeconds) {
      cluster.push(note)
    } else {
      flushCluster()
      cluster = [note]
      clusterStart = note.start
    }
  }

  flushCluster()
  return output.sort((a, b) => a.start - b.start || a.midi - b.midi)
}

function capNoteDensity(notes: TranscribedNote[], duration: number, maxPerSecond: number) {
  const maxNotes = Math.max(1, Math.round(duration * maxPerSecond))
  if (notes.length <= maxNotes) return notes

  const keep = new Set(
    [...notes]
      .sort((a, b) => noteScore(b) - noteScore(a))
      .slice(0, maxNotes)
      .map((note) => note),
  )

  return notes.filter((note) => keep.has(note))
}

function cleanVocalNotes(
  notes: TranscribedNote[],
  duration: number,
  density: MelodyDensity,
  mode: ConversionMode,
  simplify: number,
  extraction: NoteExtractionSettings,
) {
  const settings = densitySettings(density, simplify, extraction)
  const deduped = dedupeNotes(notes)
  const voiced =
    mode === 'mono'
      ? enforceMonophonicLine(collapseDenseClusters(deduped, settings.clusterSeconds, 1))
      : collapseDenseClusters(deduped, settings.clusterSeconds, settings.layeredVoices)

  return capNoteDensity(voiced, duration, settings.maxPerSecond)
    .filter((note) => note.start < duration)
    .filter((note) => note.end - note.start >= settings.minSeconds && note.velocity >= settings.minVelocity)
    .map((note) => ({ ...note, end: Math.min(duration, note.end) }))
}

function estimateTempo(samples: Float32Array) {
  const frameCount = Math.max(0, Math.floor((samples.length - TEMPO_FRAME) / TEMPO_HOP))
  if (frameCount < 32) return null

  const energies = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * TEMPO_HOP
    let sum = 0
    for (let index = 0; index < TEMPO_FRAME; index += 1) {
      const sample = samples[start + index]
      sum += sample * sample
    }
    energies[frame] = Math.sqrt(sum / TEMPO_FRAME)
  }

  const flux = new Float32Array(frameCount)
  let fluxPeak = 0
  for (let frame = 1; frame < frameCount; frame += 1) {
    const value = Math.max(0, energies[frame] - energies[frame - 1])
    flux[frame] = value
    fluxPeak = Math.max(fluxPeak, value)
  }

  if (fluxPeak < 0.002) return null

  for (let frame = 0; frame < frameCount; frame += 1) flux[frame] /= fluxPeak

  const mean = flux.reduce((sum, value) => sum + value, 0) / frameCount
  let variance = 0
  for (let frame = 0; frame < frameCount; frame += 1) variance += (flux[frame] - mean) ** 2
  const threshold = mean + Math.sqrt(variance / frameCount) * 0.5
  const peakFrames: number[] = []
  for (let frame = 1; frame < frameCount - 1; frame += 1) {
    if (flux[frame] >= threshold && flux[frame] >= flux[frame - 1] && flux[frame] >= flux[frame + 1]) {
      peakFrames.push(frame)
    }
  }

  const fps = SAMPLE_RATE / TEMPO_HOP
  const minLag = Math.max(1, Math.round((fps * 60) / MAX_BPM))
  const maxLag = Math.min(frameCount - 1, Math.round((fps * 60) / MIN_BPM))
  let bestLag = minLag
  let bestScore = 0
  let secondScore = 0
  let bestGridScore = 0

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let autocorrelation = 0
    for (let frame = lag; frame < frameCount; frame += 1) {
      autocorrelation += flux[frame] * flux[frame - lag]
    }
    autocorrelation /= Math.max(1, frameCount - lag)

    let gridScore = 0
    for (let phase = 0; phase < lag; phase += 1) {
      let phaseScore = 0
      let beatCount = 0
      for (let frame = phase; frame < frameCount; frame += lag) {
        const left = frame > 0 ? flux[frame - 1] * 0.45 : 0
        const center = flux[frame]
        const right = frame < frameCount - 1 ? flux[frame + 1] * 0.45 : 0
        phaseScore += Math.max(left, center, right)
        beatCount += 1
      }
      gridScore = Math.max(gridScore, phaseScore / Math.max(1, beatCount))
    }

    const peakSupport =
      peakFrames.length > 2
        ? peakFrames.filter((peak) => {
            const remainder = peak % lag
            return remainder <= 2 || lag - remainder <= 2
          }).length / peakFrames.length
        : 0
    const score = autocorrelation * 0.58 + gridScore * 0.34 + peakSupport * 0.08

    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      bestLag = lag
      bestGridScore = gridScore
    } else if (score > secondScore) {
      secondScore = score
    }
  }

  if (bestScore <= 0) return null

  let bpm = (60 * fps) / bestLag
  while (bpm < MIN_BPM) bpm *= 2
  while (bpm > MAX_BPM) bpm /= 2

  const separation = (bestScore - secondScore) / Math.max(bestScore, 0.0001)
  const gridStrength = Math.min(1, bestGridScore * 2.3)
  const peakDensity = Math.min(1, peakFrames.length / Math.max(4, frameCount / 9))
  const confidence = Math.max(0, Math.min(1, separation * 0.45 + gridStrength * 0.4 + peakDensity * 0.15))

  return {
    bpm: Math.round(bpm),
    confidence,
  }
}

async function transcribe(request: BasicPitchRequest) {
  const source = resampleLinear(request.audio, request.sampleRate)
  const duration = source.length / SAMPLE_RATE
  const tempo = estimateTempo(source)
  const extractionSettings = buildExtractionSettings(request.advanced)
  const { ort, session: runtimeSession, backend } = await createSession(request.preferWebGpu)
  const totalChunks = Math.max(1, Math.ceil(Math.max(1, source.length - WINDOW_SAMPLES) / HOP_SAMPLES) + 1)
  const allNotes: TranscribedNote[] = []

  for (let chunk = 0; chunk < totalChunks; chunk += 1) {
    const startSample = chunk * HOP_SAMPLES
    const input = new Float32Array(WINDOW_SAMPLES)
    input.set(source.subarray(startSample, Math.min(startSample + WINDOW_SAMPLES, source.length)))

    const tensor = new ort.Tensor('float32', input, [1, WINDOW_SAMPLES, 1])
    const results = await runtimeSession.run(
      { [INPUT_NAME]: tensor },
      [NOTE_OUTPUT, ONSET_OUTPUT, CONTOUR_OUTPUT],
    )

    const noteOutput = results[NOTE_OUTPUT]
    const onsetOutput = results[ONSET_OUTPUT]
    if (!(noteOutput.data instanceof Float32Array) || !(onsetOutput.data instanceof Float32Array)) {
      throw new Error('Basic Pitch returned unexpected tensor data')
    }

    allNotes.push(...extractWindowNotes(noteOutput.data, onsetOutput.data, startSample / SAMPLE_RATE, extractionSettings))

    progress(
      'transcribing',
      0.2 + ((chunk + 1) / totalChunks) * 0.7,
      `Transcribing chunk ${chunk + 1} of ${totalChunks}`,
      { backend, chunk: chunk + 1, totalChunks },
    )
  }

  progress('quantizing', 0.94, 'Cleaning and quantizing detected notes', { backend })
  post({
    type: 'result',
    backend,
    duration,
    notes: cleanVocalNotes(allNotes, duration, request.density, request.mode, request.simplify, extractionSettings),
    rawNoteCount: allNotes.length,
    usedFallback,
    estimatedBpm: tempo?.bpm,
    tempoConfidence: tempo?.confidence,
  })
}

self.onmessage = (event: MessageEvent<BasicPitchRequest>) => {
  if (event.data.type !== 'transcribe') return

  transcribe(event.data).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown transcription failure'
    post({ type: 'error', message, backend: activeBackend ?? undefined })
  })
}
