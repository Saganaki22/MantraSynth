import type { TranscribedNote } from './basicPitchTypes'

export type ParsedMidiNote = TranscribedNote & {
  channel: number
  track: number
}

export type ParsedMidiFile = {
  notes: ParsedMidiNote[]
  duration: number
  ticksPerQuarter: number
  estimatedBpm: number
  tempoSource: 'embedded' | 'default'
  tempoConfidence: number
  rawNoteCount: number
}

type TempoEvent = {
  tick: number
  microsecondsPerQuarter: number
}

type PendingNote = {
  tick: number
  velocity: number
}

type RawMidiNote = {
  startTick: number
  endTick: number
  midi: number
  velocity: number
  channel: number
  track: number
}

const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000

export function isMidiFile(file: File) {
  const lowerName = file.name.toLowerCase()
  return lowerName.endsWith('.mid') || lowerName.endsWith('.midi') || file.type === 'audio/midi' || file.type === 'audio/x-midi'
}

export async function parseMidiFile(file: File): Promise<ParsedMidiFile> {
  return parseMidiBytes(await file.arrayBuffer())
}

export function parseMidiBytes(buffer: ArrayBuffer): ParsedMidiFile {
  const view = new DataView(buffer)
  let offset = 0

  function ensure(byteCount: number) {
    if (offset + byteCount > view.byteLength) throw new Error('MIDI file is truncated')
  }

  function readString(byteCount: number) {
    ensure(byteCount)
    let text = ''
    for (let index = 0; index < byteCount; index += 1) {
      text += String.fromCharCode(view.getUint8(offset + index))
    }
    offset += byteCount
    return text
  }

  function readUint16() {
    ensure(2)
    const value = view.getUint16(offset, false)
    offset += 2
    return value
  }

  function readUint32() {
    ensure(4)
    const value = view.getUint32(offset, false)
    offset += 4
    return value
  }

  function readByte() {
    ensure(1)
    const value = view.getUint8(offset)
    offset += 1
    return value
  }

  function readVariableLength(trackEnd: number) {
    let value = 0
    for (let index = 0; index < 4; index += 1) {
      if (offset >= trackEnd) throw new Error('MIDI event delta is truncated')
      const byte = readByte()
      value = (value << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new Error('MIDI variable-length value is invalid')
  }

  if (readString(4) !== 'MThd') throw new Error('This is not a Standard MIDI file')
  const headerLength = readUint32()
  if (headerLength < 6) throw new Error('MIDI header is invalid')
  readUint16()
  const trackCount = readUint16()
  const division = readUint16()
  offset += headerLength - 6

  if (division & 0x8000) throw new Error('SMPTE MIDI timing is not supported yet')
  const ticksPerQuarter = division || 480
  const tempoEvents: TempoEvent[] = []
  const rawNotes: RawMidiNote[] = []

  for (let trackIndex = 0; trackIndex < trackCount && offset < view.byteLength; trackIndex += 1) {
    const chunkId = readString(4)
    const chunkLength = readUint32()
    const trackEnd = Math.min(view.byteLength, offset + chunkLength)
    if (chunkId !== 'MTrk') {
      offset = trackEnd
      continue
    }

    let tick = 0
    let runningStatus: number | null = null
    const pending = new Map<string, PendingNote[]>()

    while (offset < trackEnd) {
      tick += readVariableLength(trackEnd)
      if (offset >= trackEnd) break

      let status = readByte()
      let firstDataByte: number | null = null
      if (status < 0x80) {
        if (runningStatus === null) throw new Error('MIDI running status appeared before a status byte')
        firstDataByte = status
        status = runningStatus
      } else if (status < 0xf0) {
        runningStatus = status
      }

      if (status === 0xff) {
        runningStatus = null
        const metaType = readByte()
        const length = readVariableLength(trackEnd)
        if (metaType === 0x51 && length === 3) {
          ensure(3)
          tempoEvents.push({
            tick,
            microsecondsPerQuarter: (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2),
          })
        }
        offset = Math.min(trackEnd, offset + length)
        if (metaType === 0x2f) break
        continue
      }

      if (status === 0xf0 || status === 0xf7) {
        runningStatus = null
        offset = Math.min(trackEnd, offset + readVariableLength(trackEnd))
        continue
      }

      const eventType = status & 0xf0
      const channel = status & 0x0f
      const dataLength = eventType === 0xc0 || eventType === 0xd0 ? 1 : 2
      const data1 = firstDataByte ?? readByte()
      const data2 = dataLength === 2 ? readByte() : 0

      if (eventType === 0x90 && data2 > 0) {
        const key = `${channel}:${data1}`
        const notes = pending.get(key) ?? []
        notes.push({ tick, velocity: data2 / 127 })
        pending.set(key, notes)
      } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
        const key = `${channel}:${data1}`
        const notes = pending.get(key)
        const start = notes?.shift()
        if (start && tick > start.tick) {
          rawNotes.push({
            startTick: start.tick,
            endTick: tick,
            midi: data1,
            velocity: start.velocity,
            channel,
            track: trackIndex,
          })
        }
        if (notes && notes.length === 0) pending.delete(key)
      }
    }

    offset = trackEnd
  }

  const tempoMap = normalizeTempoMap(tempoEvents)
  const notes = rawNotes
    .map((note) => ({
      start: tickToSeconds(note.startTick, tempoMap, ticksPerQuarter),
      end: tickToSeconds(note.endTick, tempoMap, ticksPerQuarter),
      midi: note.midi,
      velocity: note.velocity,
      channel: note.channel,
      track: note.track,
    }))
    .sort((a, b) => a.start - b.start || b.velocity - a.velocity)

  const melodicNotes = notes.filter((note) => note.channel !== 9)
  const usableNotes = melodicNotes.length ? melodicNotes : notes
  const duration = usableNotes.reduce((max, note) => Math.max(max, note.end), 0)
  const firstTempo = tempoMap[0]?.microsecondsPerQuarter ?? DEFAULT_MICROSECONDS_PER_QUARTER

  return {
    notes: usableNotes,
    duration,
    ticksPerQuarter,
    estimatedBpm: Math.round(60_000_000 / firstTempo),
    tempoSource: tempoEvents.length ? 'embedded' : 'default',
    tempoConfidence: tempoEvents.length ? 1 : 0.55,
    rawNoteCount: rawNotes.length,
  }
}

function normalizeTempoMap(tempoEvents: TempoEvent[]) {
  const map = tempoEvents
    .filter((event) => event.microsecondsPerQuarter > 0)
    .sort((a, b) => a.tick - b.tick)

  if (!map.length || map[0].tick > 0) {
    map.unshift({ tick: 0, microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER })
  }

  return map.filter((event, index) => index === 0 || event.tick !== map[index - 1].tick)
}

function tickToSeconds(tick: number, tempoMap: TempoEvent[], ticksPerQuarter: number) {
  let seconds = 0
  let previousTick = 0
  let microsecondsPerQuarter = tempoMap[0]?.microsecondsPerQuarter ?? DEFAULT_MICROSECONDS_PER_QUARTER

  for (let index = 1; index < tempoMap.length; index += 1) {
    const event = tempoMap[index]
    if (event.tick >= tick) break
    seconds += ((event.tick - previousTick) * microsecondsPerQuarter) / ticksPerQuarter / 1_000_000
    previousTick = event.tick
    microsecondsPerQuarter = event.microsecondsPerQuarter
  }

  seconds += ((tick - previousTick) * microsecondsPerQuarter) / ticksPerQuarter / 1_000_000
  return seconds
}
