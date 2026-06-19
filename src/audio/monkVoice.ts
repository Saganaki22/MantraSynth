// Ported from the MIT-licensed MonkSynth DSP approach by Jonathan Taylor:
// https://github.com/JonET/monksynth
// This browser version keeps the FOF/formant-grain idea but uses cached
// AudioBuffers so it works inside a React/Web Audio app without native code.

export type MonkVowelId = 'aa' | 'oo' | 'ee' | 'ii'

export type MonkVoiceKnobs = {
  voice: number
  glide: number
  vowelGlide: number
  delay: number
  resonance: number
  gain: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FORMANT_FREQS = [
  [280, 450, 800, 350, 270],
  [600, 800, 1150, 2000, 2140],
  [2240, 2830, 2900, 2800, 2950],
] as const
const FORMANT_BW = [32.5, 47.5, 62.5]
export const MONK_VOWEL_POSITION: Record<MonkVowelId, number> = {
  oo: 0,
  aa: 0.5,
  ee: 0.75,
  ii: 1,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function noteNameToMidi(noteName: string) {
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/)
  if (!match) return 60

  const pitchClass = NOTE_NAMES.indexOf(match[1])
  const octave = Number(match[2])
  return (octave + 1) * 12 + pitchClass
}

function catmullRom(points: readonly number[], position: number) {
  const scaled = clamp(position, 0, 1) * 4
  const segment = Math.min(3, Math.floor(scaled))
  const t = scaled - segment
  const padded = [points[0], ...points, points[4]]
  const p0 = padded[segment]
  const p1 = padded[segment + 1]
  const p2 = padded[segment + 2]
  const p3 = padded[segment + 3]
  const t2 = t * t
  const t3 = t2 * t

  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function grainPeriod(sampleRate: number, midi: number) {
  const internal = midi - 12
  const tableIndex = Math.floor(internal * 32)
  const frequency = 2 ** (tableIndex / 384) * 8.175799
  return sampleRate / frequency
}

function amplitudeCompensation(midi: number) {
  const internal = midi - 12
  return clamp(internal * (-1 / 72) + 2, 0.1, 3)
}

export class MonkVoiceEngine {
  private readonly context: BaseAudioContext
  private readonly bus: GainNode
  private readonly dryGain: GainNode
  private readonly delay: DelayNode
  private readonly feedback: GainNode
  private readonly wetGain: GainNode
  private readonly master: GainNode
  private readonly compressor: DynamicsCompressorNode
  private readonly analyser: AnalyserNode
  private readonly meterBuffer: Float32Array<ArrayBuffer>
  private readonly cache = new Map<string, AudioBuffer>()
  private sustain: {
    source: AudioBufferSourceNode
    gain: GainNode
    key: string
    noteName: string
    vowel: MonkVowelId
    velocity: number
  } | null = null
  private transientVoices: Array<{ source: AudioBufferSourceNode; gain: GainNode; stopAt: number }> = []
  private knobs: MonkVoiceKnobs = {
    voice: 0,
    glide: 16,
    vowelGlide: 90,
    delay: 34,
    resonance: 58,
    gain: 58,
  }

  constructor(context: BaseAudioContext) {
    this.context = context
    this.bus = context.createGain()
    this.dryGain = context.createGain()
    this.delay = context.createDelay(1.2)
    this.feedback = context.createGain()
    this.wetGain = context.createGain()
    this.master = context.createGain()
    this.compressor = context.createDynamicsCompressor()
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 1024
    this.meterBuffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT))

    this.bus.connect(this.dryGain)
    this.dryGain.connect(this.master)
    this.bus.connect(this.delay)
    this.delay.connect(this.feedback)
    this.feedback.connect(this.delay)
    this.delay.connect(this.wetGain)
    this.wetGain.connect(this.master)
    this.master.connect(this.compressor)
    this.compressor.connect(this.analyser)
    this.analyser.connect(context.destination)

    this.compressor.threshold.value = -12
    this.compressor.knee.value = 9
    this.compressor.ratio.value = 14
    this.compressor.attack.value = 0.004
    this.compressor.release.value = 0.12
    this.update(this.knobs)
  }

  update(knobs: MonkVoiceKnobs) {
    const shouldRefreshSustain =
      this.sustain &&
      (Math.round(knobs.voice) !== Math.round(this.knobs.voice) ||
        Math.round(knobs.resonance / 4) !== Math.round(this.knobs.resonance / 4))

    this.knobs = knobs
    const now = this.context.currentTime
    const delaySeconds = 0.18 + knobs.delay / 260
    const delayMix = clamp(knobs.delay / 100, 0, 0.78)

    this.delay.delayTime.setTargetAtTime(delaySeconds, now, 0.025)
    this.feedback.gain.setTargetAtTime(clamp(0.18 + knobs.delay / 155, 0.16, 0.72), now, 0.025)
    this.wetGain.gain.setTargetAtTime(delayMix * 0.54, now, 0.025)
    this.dryGain.gain.setTargetAtTime(1 - delayMix * 0.18, now, 0.025)
    this.master.gain.setTargetAtTime(0.12 + knobs.gain / 165, now, 0.025)

    if (shouldRefreshSustain && this.sustain) {
      const { noteName, vowel, velocity } = this.sustain
      this.startSustain(noteName, vowel, velocity)
    }
  }

  triggerAttackRelease(noteName: string, vowel: MonkVowelId, duration: number, velocity = 1) {
    this.scheduleNote(noteName, vowel, this.context.currentTime, duration, velocity, true)
  }

  scheduleNote(noteName: string, vowel: MonkVowelId, startTime: number, duration: number, velocity = 1, trackTransientLimit = false) {
    const buffer = this.createVoiceBuffer(noteName, vowel, Math.max(0.08, duration), velocity, true)
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const now = Math.max(this.context.currentTime, startTime)
    const stopAt = now + buffer.duration + 0.02
    const softenedAttack = Math.min(0.12, 0.01 + this.knobs.vowelGlide / 1400)

    source.buffer = buffer
    if (trackTransientLimit) {
      this.pruneTransientVoices(now)
      this.enforceTransientLimit(now)
    }
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(
      clamp(velocity / Math.sqrt(trackTransientLimit ? this.transientVoices.length + 1 : 1), 0.06, 0.82),
      now + softenedAttack,
    )
    source.connect(gain)
    gain.connect(this.bus)
    source.start(now)
    source.stop(stopAt)

    if (trackTransientLimit) {
      const voice = { source, gain, stopAt }
      this.transientVoices.push(voice)
      source.onended = () => {
        this.transientVoices = this.transientVoices.filter((item) => item !== voice)
      }
    }
  }

  startSustain(noteName: string, vowel: MonkVowelId, velocity = 1) {
    const buffer = this.createVoiceBuffer(noteName, vowel, 9.6, velocity, false)
    const key = `${noteName}:${vowel}:${this.knobs.voice}:${this.knobs.resonance}`

    if (this.sustain?.key === key) return

    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const now = this.context.currentTime

    source.buffer = buffer
    source.loop = true
    gain.gain.setValueAtTime(0.0001, now)
    const glideSeconds = 0.024 + Math.max(this.knobs.glide, this.knobs.vowelGlide) / 1000
    gain.gain.exponentialRampToValueAtTime(clamp(velocity, 0.1, 0.88), now + glideSeconds)
    source.connect(gain)
    gain.connect(this.bus)
    source.start(now)

    this.fadeOutSustain(Math.max(0.06, glideSeconds * 1.15))
    this.sustain = { source, gain, key, noteName, vowel, velocity }
  }

  stopSustain(fadeSeconds = 0.14) {
    this.fadeOutSustain(fadeSeconds)
    this.sustain = null
  }

  dispose() {
    this.stopSustain(0.02)
    this.transientVoices.forEach(({ source }) => {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
    })
    this.transientVoices = []
    this.bus.disconnect()
    this.dryGain.disconnect()
    this.delay.disconnect()
    this.feedback.disconnect()
    this.wetGain.disconnect()
    this.master.disconnect()
    this.compressor.disconnect()
    this.analyser.disconnect()
  }

  getOutputLevel() {
    this.analyser.getFloatTimeDomainData(this.meterBuffer)
    let sum = 0

    for (let index = 0; index < this.meterBuffer.length; index += 1) {
      const sample = this.meterBuffer[index]
      sum += sample * sample
    }

    return clamp(Math.sqrt(sum / this.meterBuffer.length) * 2.4, 0, 1)
  }

  private fadeOutSustain(fadeSeconds: number) {
    if (!this.sustain) return

    const { source, gain } = this.sustain
    const now = this.context.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setTargetAtTime(0.0001, now, Math.max(0.01, fadeSeconds / 3))
    source.stop(now + fadeSeconds)
  }

  private pruneTransientVoices(now: number) {
    this.transientVoices = this.transientVoices.filter((voice) => voice.stopAt > now)
  }

  private enforceTransientLimit(now: number) {
    const maxTransientVoices = 4

    while (this.transientVoices.length >= maxTransientVoices) {
      const voice = this.transientVoices.shift()
      if (!voice) return

      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setTargetAtTime(0.0001, now, 0.012)
      try {
        voice.source.stop(now + 0.045)
      } catch {
        // Already stopped.
      }
    }
  }

  private createVoiceBuffer(noteName: string, vowel: MonkVowelId, duration: number, velocity: number, withEnvelope: boolean) {
    const midi = noteNameToMidi(noteName)
    const durationKey = Math.round(duration * 20) / 20
    const key = `${midi}:${vowel}:${durationKey}:${withEnvelope ? 1 : 0}:${Math.round(this.knobs.voice)}:${Math.round(this.knobs.resonance / 4)}`
    const cached = this.cache.get(key)
    if (cached) return cached

    const sampleRate = this.context.sampleRate
    const tail = withEnvelope ? 0.18 : 0
    const sampleCount = Math.max(128, Math.ceil((duration + tail) * sampleRate))
    const channel = new Float32Array(sampleCount)
    const grain = this.createGrain(vowel)
    const amp = amplitudeCompensation(midi) * clamp(velocity, 0.2, 1.2)
    const vibratoDepth = 0.18 + this.knobs.resonance / 520
    const vibratoRate = 5.2 + this.knobs.resonance / 85
    let grainPosition = 0

    while (grainPosition < sampleCount) {
      const start = Math.round(grainPosition)
      const time = start / sampleRate
      const vibrato = Math.sin(2 * Math.PI * vibratoRate * time) * vibratoDepth
      const period = grainPeriod(sampleRate, midi + vibrato)

      for (let index = 0; index < grain.length && start + index < channel.length; index += 1) {
        channel[start + index] += grain[index]
      }

      grainPosition += period
    }

    const attackSamples = Math.max(1, Math.floor(sampleRate * 0.018))
    const releaseSamples = Math.max(1, Math.floor(sampleRate * (withEnvelope ? 0.12 : 0.035)))
    const loopFade = withEnvelope ? 0 : Math.floor(sampleRate * 0.22)
    const output = this.context.createBuffer(1, sampleCount, sampleRate)
    const outputChannel = output.getChannelData(0)

    for (let index = 0; index < sampleCount; index += 1) {
      const attack = withEnvelope ? clamp(index / attackSamples, 0, 1) : 1
      const release = withEnvelope ? clamp((sampleCount - index) / releaseSamples, 0, 1) : 1
      const envelope = Math.min(attack, release)
      outputChannel[index] = Math.tanh(channel[index] * amp * 0.27) * envelope
    }

    if (loopFade > 0 && sampleCount > loopFade * 2) {
      for (let index = 0; index < loopFade; index += 1) {
        const fade = index / loopFade
        const head = outputChannel[index]
        const tailValue = outputChannel[sampleCount - loopFade + index]
        const blended = tailValue * (1 - fade) + head * fade
        outputChannel[index] = blended
        outputChannel[sampleCount - loopFade + index] = blended
      }
    }

    this.cache.set(key, output)
    const oldestKey = this.cache.keys().next().value
    if (this.cache.size > 96 && oldestKey) this.cache.delete(oldestKey)
    return output
  }

  private createGrain(vowel: MonkVowelId) {
    const sampleRate = this.context.sampleRate
    const grainLength = Math.max(64, Math.floor(sampleRate * 0.02))
    const grain = new Float32Array(grainLength)
    const vowelPosition = MONK_VOWEL_POSITION[vowel]
    const voiceNormalized = (this.knobs.voice + 24) / 48
    const formantScale = voiceNormalized * 0.5 + 0.75
    const resonance = this.knobs.resonance / 100
    const aspirationAmp = 0.16 + resonance * 0.16
    const attackLength = Math.max(1, Math.floor(sampleRate * 0.0018))
    const releaseStart = Math.floor(sampleRate * 0.013)
    const releaseLength = Math.max(1, Math.floor(sampleRate * 0.007))
    const formants = FORMANT_FREQS.map((points) => catmullRom(points, vowelPosition) * formantScale)

    for (let index = 0; index < grainLength; index += 1) {
      const time = index / sampleRate
      let window = 1

      if (index < attackLength) {
        window = 0.5 * (1 - Math.cos(Math.PI * index / attackLength))
      } else if (index >= releaseStart) {
        window = 0.5 * (1 - Math.cos(Math.PI * (releaseLength + index - releaseStart) / releaseLength))
      }

      let sample = 0
      for (let formantIndex = 0; formantIndex < formants.length; formantIndex += 1) {
        const decay = Math.exp(-Math.PI * FORMANT_BW[formantIndex] * index / sampleRate)
        sample += Math.sin(2 * Math.PI * formants[formantIndex] * time) * decay * (1.05 - formantIndex * 0.2)
      }

      const breathDecay = Math.exp(-index / (sampleRate * 0.006))
      const breath =
        (Math.sin(2 * Math.PI * 4951 * time) + Math.sin(2 * Math.PI * 3802 * time) * 0.82) *
        breathDecay *
        aspirationAmp

      grain[index] = (sample * (0.72 + resonance * 0.28) + breath) * window
    }

    return grain
  }
}
