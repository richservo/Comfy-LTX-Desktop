import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { logger } from '../logger'
import { urlToFilePath } from './ffmpeg-utils'
import type { ExportClip } from './timeline'

const SAMPLE_RATE = 48000
const NUM_CHANNELS = 2
const BYTES_PER_SAMPLE = 2 // 16-bit signed LE
const BYTES_PER_FRAME = NUM_CHANNELS * BYTES_PER_SAMPLE // 4 bytes per stereo frame

/** Extract raw PCM from a file via ffmpeg stdout pipe */
function extractPcmBuffer(
  ffmpegPath: string,
  filePath: string, trimStart: number, trimEnd: number, speed: number, reversed: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Build audio filter chain: trim -> reset PTS -> speed -> reverse
    // Using atrim (not -ss/-t) for sample-accurate trimming
    const filters: string[] = [
      `atrim=start=${trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)}`,
      'asetpts=PTS-STARTPTS',
    ]
    if (speed !== 1) {
      // atempo only supports 0.5-100, chain multiple for extreme values
      let remaining = speed
      while (remaining > 2.0) { filters.push('atempo=2.0'); remaining /= 2.0 }
      while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5 }
      filters.push(`atempo=${remaining.toFixed(6)}`)
    }
    if (reversed) filters.push('areverse')

    const args = [
      '-i', filePath,
      '-af', filters.join(','),
      '-f', 's16le', '-ac', String(NUM_CHANNELS), '-ar', String(SAMPLE_RATE),
      'pipe:1',
    ]
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr?.on('data', () => {}) // drain stderr to prevent blocking
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`PCM extraction failed (code ${code}) for ${filePath}`))
    })
    proc.on('error', reject)
  })
}

interface VolumeKeyframe {
  time: number   // seconds, in media time (relative to trimStart)
  value: number  // 0–1
}

interface AudioSource {
  filePath: string; trimStart: number; trimEnd: number;
  timelineStart: number; speed: number; reversed: boolean; volume: number;
  volumeAutomation?: VolumeKeyframe[];
  /** Dissolve fade-in at start of clip (seconds) */
  fadeInDuration: number;
  /** Dissolve fade-out at end of clip (seconds) */
  fadeOutDuration: number;
  /** Total clip duration on timeline (seconds) */
  clipDuration: number;
}

/** Linearly interpolate volume at a given media-time position from keyframes */
function interpolateVolume(kf: VolumeKeyframe[] | undefined, mediaTime: number, fallback: number): number {
  if (!kf || kf.length === 0) return fallback
  if (kf.length === 1) return kf[0].value
  if (mediaTime <= kf[0].time) return kf[0].value
  if (mediaTime >= kf[kf.length - 1].time) return kf[kf.length - 1].value
  for (let i = 0; i < kf.length - 1; i++) {
    if (mediaTime >= kf[i].time && mediaTime <= kf[i + 1].time) {
      const t = (mediaTime - kf[i].time) / (kf[i + 1].time - kf[i].time)
      return kf[i].value + t * (kf[i + 1].value - kf[i].value)
    }
  }
  return kf[kf.length - 1].value
}

/**
 * Mix all audio from clips into a single PCM buffer.
 * Returns raw Int16LE PCM data with the sample rate and channel count.
 */
export async function mixAudioToPcm(
  clips: ExportClip[],
  totalDuration: number,
  ffmpegPath: string,
): Promise<{ pcmBuffer: Buffer; sampleRate: number; channels: number }> {
  // Collect audio sources from audio clips only
  const audioSources: AudioSource[] = []

  for (const c of clips) {
    if (c.muted || c.volume <= 0) continue
    const fp = urlToFilePath(c.url)
    if (!fp || !fs.existsSync(fp)) continue

    if (c.type === 'audio') {
      audioSources.push({
        filePath: fp,
        trimStart: c.trimStart,
        trimEnd: c.trimStart + c.duration * c.speed,
        timelineStart: c.startTime,
        speed: c.speed,
        reversed: c.reversed,
        volume: c.volume,
        volumeAutomation: c.volumeAutomation,
        fadeInDuration: (c.transitionIn?.type === 'dissolve' && c.transitionIn.duration > 0) ? c.transitionIn.duration : 0,
        fadeOutDuration: (c.transitionOut?.type === 'dissolve' && c.transitionOut.duration > 0) ? c.transitionOut.duration : 0,
        clipDuration: c.duration,
      })
    }
  }

  logger.info( `[Export] Audio: ${audioSources.length} source(s) from ${clips.length} clip(s)`)

  // Create master mix buffer (Float64 to accumulate without clipping)
  const totalFrames = Math.ceil(totalDuration * SAMPLE_RATE)
  const totalSamples = totalFrames * NUM_CHANNELS
  const mixBuffer = new Float64Array(totalSamples) // initialized to 0 (silence)

  // Extract each source and mix into the master buffer
  for (let i = 0; i < audioSources.length; i++) {
    const src = audioSources[i]
    logger.info( `[Export] Audio ${i + 1}/${audioSources.length}: ${path.basename(src.filePath)} trim=${src.trimStart.toFixed(2)}-${src.trimEnd.toFixed(2)} @${src.timelineStart.toFixed(2)}s vol=${src.volume}`)
    try {
      const pcm = await extractPcmBuffer(ffmpegPath, src.filePath, src.trimStart, src.trimEnd, src.speed, src.reversed)
      const startFrame = Math.round(src.timelineStart * SAMPLE_RATE)
      const startSample = startFrame * NUM_CHANNELS
      const numPcmSamples = Math.floor(pcm.length / BYTES_PER_SAMPLE)

      const hasAutomation = src.volumeAutomation && src.volumeAutomation.length > 0
      const fadeInFrames = Math.round(src.fadeInDuration * SAMPLE_RATE)
      const fadeOutStartFrame = Math.round((src.clipDuration - src.fadeOutDuration) * SAMPLE_RATE)
      const fadeOutFrames = Math.round(src.fadeOutDuration * SAMPLE_RATE)
      for (let s = 0; s < numPcmSamples; s++) {
        const destIdx = startSample + s
        if (destIdx < 0 || destIdx >= totalSamples) continue
        const value = pcm.readInt16LE(s * BYTES_PER_SAMPLE)
        // Compute per-sample volume: use automation keyframes if present, else flat volume
        let vol = src.volume
        if (hasAutomation) {
          // Convert sample index to media time: sample is stereo interleaved
          const frameIdx = Math.floor(s / NUM_CHANNELS)
          const mediaTime = src.trimStart + (frameIdx / SAMPLE_RATE) * src.speed
          vol = interpolateVolume(src.volumeAutomation, mediaTime, src.volume)
        }
        // Apply dissolve crossfade ramps
        const frameIdx = Math.floor(s / NUM_CHANNELS)
        if (fadeInFrames > 0 && frameIdx < fadeInFrames) {
          vol *= frameIdx / fadeInFrames
        }
        if (fadeOutFrames > 0 && frameIdx >= fadeOutStartFrame) {
          vol *= 1 - (frameIdx - fadeOutStartFrame) / fadeOutFrames
        }
        mixBuffer[destIdx] += value * vol
      }
      logger.info( `[Export] Audio ${i + 1}: mixed ${numPcmSamples} samples (${(numPcmSamples / SAMPLE_RATE / NUM_CHANNELS).toFixed(2)}s) at offset frame ${startFrame}`)
    } catch (err: any) {
      logger.warn( `[Export] Failed to extract audio from ${src.filePath}: ${err.message}`)
    }
  }

  // Convert Float64 accumulator -> Int16 PCM buffer (with clamp)
  const outputPcm = Buffer.alloc(totalFrames * BYTES_PER_FRAME)
  for (let s = 0; s < totalSamples; s++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(mixBuffer[s])))
    outputPcm.writeInt16LE(clamped, s * BYTES_PER_SAMPLE)
  }

  return { pcmBuffer: outputPcm, sampleRate: SAMPLE_RATE, channels: NUM_CHANNELS }
}
