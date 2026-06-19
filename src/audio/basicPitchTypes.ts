export type TranscriptionBackend = 'webgpu' | 'wasm' | 'midi'
export type MelodyDensity = 'sparse' | 'normal' | 'busy'
export type ConversionMode = 'mono' | 'layered'

export type ConversionPhase =
  | 'idle'
  | 'decoding'
  | 'loading-model'
  | 'transcribing'
  | 'quantizing'
  | 'rendered'
  | 'error'

export type TranscribedNote = {
  start: number
  end: number
  midi: number
  velocity: number
}

export type BasicPitchAdvancedSettings = {
  noteSegmentation: number
  modelConfidence: number
  minPitchHz: number
  maxPitchHz: number
  minNoteMs: number
}

export type BasicPitchRequest = {
  type: 'transcribe'
  audio: Float32Array
  sampleRate: number
  preferWebGpu: boolean
  density: MelodyDensity
  mode: ConversionMode
  simplify: number
  advanced: BasicPitchAdvancedSettings
}

export type BasicPitchProgress = {
  type: 'progress'
  phase: ConversionPhase
  progress: number
  message: string
  backend?: TranscriptionBackend
  chunk?: number
  totalChunks?: number
}

export type BasicPitchResult = {
  type: 'result'
  backend: TranscriptionBackend
  duration: number
  notes: TranscribedNote[]
  rawNoteCount: number
  usedFallback: boolean
  estimatedBpm?: number
  tempoConfidence?: number
}

export type BasicPitchError = {
  type: 'error'
  message: string
  backend?: TranscriptionBackend
}

export type BasicPitchWorkerMessage = BasicPitchProgress | BasicPitchResult | BasicPitchError
