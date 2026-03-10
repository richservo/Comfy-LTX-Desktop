import { useState, useRef, useEffect, useCallback } from 'react'
import type { Asset, TimelineClip, Track } from '../../types/project'
import { DEFAULT_COLOR_CORRECTION } from '../../types/project'
import { resolveOverlaps } from './video-editor-utils'

interface UseSourceMonitorParams {
  currentTime: number
  tracks: Track[]
  pushUndo: () => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
}

// Speed cycles for J/K/L shuttle
const FORWARD_SPEEDS = [1, 2, 4] as const
const REVERSE_SPEEDS = [-1, -2, -4] as const

export function useSourceMonitor({ currentTime, tracks, pushUndo, setClips }: UseSourceMonitorParams) {
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null)
  const [sourceTime, setSourceTime] = useState(0)
  const [sourceIsPlaying, setSourceIsPlaying] = useState(false)
  const [sourceIn, setSourceIn] = useState<number | null>(null)
  const [sourceOut, setSourceOut] = useState<number | null>(null)
  const [showSourceMonitor, setShowSourceMonitor] = useState(false)
  const [activePanel, setActivePanel] = useState<'source' | 'timeline'>('timeline')
  const [sourceSplitPercent, setSourceSplitPercent] = useState(50)
  // Unified playback speed: 0=stopped, >0=forward (1,2,4), <0=reverse (-1,-2,-4)
  const [sourceSpeed, setSourceSpeed] = useState(0)

  const sourceVideoRef = useRef<HTMLVideoElement>(null)
  const sourceAnimRef = useRef<number>(0)
  const sourceTimeRef = useRef(0)
  sourceTimeRef.current = sourceTime
  const sourceIsPlayingRef = useRef(false)
  sourceIsPlayingRef.current = sourceIsPlaying
  const sourceSpeedRef = useRef(0)
  sourceSpeedRef.current = sourceSpeed

  // Refs to avoid stale closures in callbacks
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const currentTimeRef = useRef(currentTime)
  currentTimeRef.current = currentTime
  const sourceAssetRef = useRef(sourceAsset)
  sourceAssetRef.current = sourceAsset
  const sourceInRef = useRef(sourceIn)
  sourceInRef.current = sourceIn
  const sourceOutRef = useRef(sourceOut)
  sourceOutRef.current = sourceOut

  // ── Web Audio: pre-decoded buffers for instant scrub + reverse audio ──
  const audioCtxRef = useRef<AudioContext | null>(null)
  const fwdBufferRef = useRef<AudioBuffer | null>(null)
  const revBufferRef = useRef<AudioBuffer | null>(null)
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const bufferedUrlRef = useRef<string>('')

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }, [])

  // Load audio into memory and decode into AudioBuffers (forward + reversed)
  const decodeAudioForAsset = useCallback(async (url: string) => {
    if (!url || bufferedUrlRef.current === url) return
    try {
      let arrayBuffer: ArrayBuffer
      if (url.startsWith('file://') && (window as any).electronAPI?.readLocalFile) {
        const { data } = await (window as any).electronAPI.readLocalFile(url)
        // base64 → ArrayBuffer
        const bin = atob(data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        arrayBuffer = bytes.buffer
      } else {
        const resp = await fetch(url)
        arrayBuffer = await resp.arrayBuffer()
      }

      const ctx = getAudioCtx()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      fwdBufferRef.current = decoded

      // Create reversed copy
      const reversed = ctx.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate)
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const fwd = decoded.getChannelData(ch)
        const rev = reversed.getChannelData(ch)
        for (let i = 0; i < fwd.length; i++) rev[i] = fwd[fwd.length - 1 - i]
      }
      revBufferRef.current = reversed
      bufferedUrlRef.current = url
    } catch {
      // Decode failed — scrub/reverse will be silent
      fwdBufferRef.current = null
      revBufferRef.current = null
    }
  }, [getAudioCtx])

  const stopActiveSource = useCallback(() => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop() } catch { /* already stopped */ }
      activeSourceRef.current = null
    }
  }, [])

  // Play a single frame of audio at a position (for scrub + arrow stepping)
  const playScrubFrame = useCallback((position: number) => {
    const buf = fwdBufferRef.current
    if (!buf) return
    const ctx = getAudioCtx()
    stopActiveSource()

    const frameDur = 1 / 24
    const offset = Math.max(0, Math.min(position, buf.duration - frameDur))
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0, offset, frameDur)
    activeSourceRef.current = src
    src.onended = () => { if (activeSourceRef.current === src) activeSourceRef.current = null }
  }, [getAudioCtx, stopActiveSource])

  const loadSourceAsset = useCallback((asset: Asset) => {
    setSourceAsset(asset)
    setSourceTime(0)
    setSourceIn(null)
    setSourceOut(null)
    setSourceIsPlaying(false)
    setSourceSpeed(0)
    setShowSourceMonitor(true)
    // Pre-decode audio into memory for instant scrub
    if (asset.url && (asset.type === 'video' || asset.type === 'audio')) {
      decodeAudioForAsset(asset.url)
    }
  }, [decodeAudioForAsset])

  // ── Forward playback engine ──
  // Uses native video.playbackRate for 1x/2x/4x. Browser handles decode natively.
  useEffect(() => {
    const vid = sourceVideoRef.current
    if (!vid) return

    if (sourceSpeed > 0) {
      vid.playbackRate = sourceSpeed
      setSourceIsPlaying(true)
      vid.play().catch(() => {})

      // rAF loop to sync sourceTime from the video element and enforce out-point
      const tick = () => {
        if (sourceSpeedRef.current <= 0) return
        const t = vid.currentTime
        setSourceTime(t)
        const sOut = sourceOutRef.current
        if (sOut !== null && t >= sOut) {
          vid.pause()
          setSourceSpeed(0)
          setSourceIsPlaying(false)
          setSourceTime(sOut)
          return
        }
        if (!vid.paused) sourceAnimRef.current = requestAnimationFrame(tick)
      }
      sourceAnimRef.current = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(sourceAnimRef.current)
    } else if (sourceSpeed === 0) {
      if (!vid.paused) vid.pause()
      setSourceIsPlaying(false)
    } else {
      // Reverse — video is paused; rAF loop handles seeking
      if (!vid.paused) vid.pause()
      setSourceIsPlaying(false)
    }
  }, [sourceSpeed])

  // ── Scrub audio: play 1 frame of audio whenever sourceTime changes while stopped ──
  const lastScrubTimeRef = useRef<number>(-1)
  useEffect(() => {
    if (sourceSpeed !== 0) return
    if (lastScrubTimeRef.current === sourceTime) return
    lastScrubTimeRef.current = sourceTime
    playScrubFrame(sourceTime)
  }, [sourceTime, sourceSpeed, playScrubFrame])

  // ── Reverse playback engine ──
  // Video: independent position tracking + seeked-gated frame-rate seeks.
  // Audio: reversed AudioBuffer played continuously via Web Audio API.
  useEffect(() => {
    if (sourceSpeed >= 0) return
    const vid = sourceVideoRef.current
    if (!vid) return

    vid.pause()
    const reverseRate = Math.abs(sourceSpeed)
    let pos = vid.currentTime
    let lastTs: number | null = null
    let rafId: number

    // Start reversed audio from current position
    const startReverseAudio = () => {
      const buf = revBufferRef.current
      if (!buf) return
      const ctx = getAudioCtx()
      stopActiveSource()
      // In reversed buffer, position 0 = end of original
      const offset = Math.max(0, Math.min(buf.duration, buf.duration - pos))
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = reverseRate
      src.connect(ctx.destination)
      src.start(0, offset)
      activeSourceRef.current = src
    }

    // Ensure audio is decoded, then start
    if (fwdBufferRef.current) {
      startReverseAudio()
    } else if (vid.src) {
      decodeAudioForAsset(vid.src).then(() => {
        if (sourceSpeedRef.current < 0) startReverseAudio()
      })
    }

    // Seek video at 24fps intervals, gated on seeked event completion
    let seekPending = false
    let lastSeekTs = 0
    const FRAME_INTERVAL_MS = 1000 / 24

    const tick = (ts: number) => {
      if (sourceSpeedRef.current >= 0) return

      if (lastTs !== null) {
        const delta = (ts - lastTs) / 1000 * reverseRate
        pos = Math.max(0, pos - delta)

        const timeSinceLastSeek = ts - lastSeekTs
        if (!seekPending && timeSinceLastSeek >= FRAME_INTERVAL_MS) {
          seekPending = true
          lastSeekTs = ts
          vid.currentTime = pos
          vid.addEventListener('seeked', () => { seekPending = false }, { once: true })
        }

        setSourceTime(pos)

        if (pos <= 0) {
          setSourceSpeed(0)
          return
        }
      }
      lastTs = ts
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      stopActiveSource()
    }
  }, [sourceSpeed, getAudioCtx, stopActiveSource, decodeAudioForAsset])

  // Clean up Web Audio on unmount
  useEffect(() => {
    return () => {
      stopActiveSource()
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
    }
  }, [stopActiveSource])

  // ── Keyboard shuttle helpers (called from useEditorKeyboard) ──
  // These are exposed via refs/setters so the keyboard handler can call them.
  // J: cycle reverse speeds. L: cycle forward speeds. K: stop.
  const shuttleForward = useCallback(() => {
    setSourceSpeed(prev => {
      if (prev < 0) return 1 // was reversing → go to 1x forward
      const idx = (FORWARD_SPEEDS as readonly number[]).indexOf(prev)
      if (idx >= 0 && idx < FORWARD_SPEEDS.length - 1) return FORWARD_SPEEDS[idx + 1]
      return FORWARD_SPEEDS[0] // wrap to 1x
    })
  }, [])

  const shuttleReverse = useCallback(() => {
    setSourceSpeed(prev => {
      if (prev > 0) return -1 // was forwarding → go to -1x reverse
      const idx = (REVERSE_SPEEDS as readonly number[]).indexOf(prev)
      if (idx >= 0 && idx < REVERSE_SPEEDS.length - 1) return REVERSE_SPEEDS[idx + 1]
      return REVERSE_SPEEDS[0] // wrap to -1x
    })
  }, [])

  const shuttleStop = useCallback(() => {
    setSourceSpeed(0)
  }, [])

  // --- Helper: build clips for insert/overwrite edits ---
  const buildEditClips = useCallback(() => {
    const asset = sourceAssetRef.current
    if (!asset) return null

    const sIn = sourceInRef.current ?? 0
    const sDuration = asset.duration || 5
    const sOut = sourceOutRef.current ?? sDuration
    const insertDuration = sOut - sIn
    if (insertDuration <= 0) return null

    const trks = tracksRef.current
    const time = currentTimeRef.current
    const isAudio = asset.type === 'audio'

    // Find target tracks: first unlocked, source-patched track of each kind
    const videoTrack = !isAudio
      ? trks.find(t => !t.locked && t.sourcePatched !== false && t.kind === 'video')
      : undefined
    const audioTrack = trks.find(t => !t.locked && t.sourcePatched !== false && t.kind === 'audio')

    // Validate we have the tracks we need
    if (!videoTrack && !audioTrack) return null
    if (isAudio && !audioTrack) return null
    if (!isAudio && !videoTrack) return null

    const videoTrackIndex = videoTrack ? trks.indexOf(videoTrack) : -1
    const audioTrackIndex = audioTrack ? trks.indexOf(audioTrack) : -1

    const videoClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const audioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).substr(2, 9)}`

    const baseClip = {
      assetId: asset.id,
      startTime: time,
      duration: insertDuration,
      trimStart: sIn,
      trimEnd: sDuration - sOut,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      asset,
      flipH: false as const,
      flipV: false as const,
      transitionIn: { type: 'none' as const, duration: 0.5 },
      transitionOut: { type: 'none' as const, duration: 0.5 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      opacity: 100,
    }

    const newClips: TimelineClip[] = []

    if (isAudio) {
      newClips.push({ ...baseClip, id: audioClipId, type: 'audio', trackIndex: audioTrackIndex })
    } else {
      const needsAudio = asset.type === 'video' && audioTrackIndex >= 0
      newClips.push({
        ...baseClip,
        id: videoClipId,
        type: asset.type === 'video' ? 'video' : 'image',
        trackIndex: videoTrackIndex,
        ...(needsAudio ? { linkedClipIds: [audioClipId] } : {}),
      })
      if (needsAudio) {
        newClips.push({
          ...baseClip,
          id: audioClipId,
          type: 'audio',
          trackIndex: audioTrackIndex,
          linkedClipIds: [videoClipId],
        })
      }
    }

    return { newClips, insertDuration, videoTrackIndex, audioTrackIndex, time }
  }, [])

  // --- 3-Point Editing: Insert Edit ---
  const handleInsertEdit = useCallback(() => {
    const result = buildEditClips()
    if (!result) return

    pushUndo()

    const { newClips, insertDuration, videoTrackIndex, audioTrackIndex, time } = result
    setClips(prev => {
      // Ripple clips on all targeted tracks
      const rippled = prev.map(c => {
        const isTargetTrack = (videoTrackIndex >= 0 && c.trackIndex === videoTrackIndex) ||
                              (audioTrackIndex >= 0 && c.trackIndex === audioTrackIndex)
        if (isTargetTrack && c.startTime >= time) {
          return { ...c, startTime: c.startTime + insertDuration }
        }
        return c
      })
      return [...rippled, ...newClips]
    })
  }, [pushUndo, buildEditClips])

  // --- 3-Point Editing: Overwrite Edit ---
  const handleOverwriteEdit = useCallback(() => {
    const result = buildEditClips()
    if (!result) return

    pushUndo()

    const { newClips } = result
    const newClipIds = new Set(newClips.map(c => c.id))
    setClips(prev => resolveOverlaps([...prev, ...newClips], newClipIds))
  }, [pushUndo, buildEditClips])

  return {
    sourceAsset, setSourceAsset,
    sourceTime, setSourceTime,
    sourceIsPlaying, setSourceIsPlaying,
    sourceIn, setSourceIn,
    sourceOut, setSourceOut,
    showSourceMonitor, setShowSourceMonitor,
    activePanel, setActivePanel,
    sourceSplitPercent, setSourceSplitPercent,
    sourceSpeed, setSourceSpeed,
    sourceVideoRef, sourceAnimRef, sourceTimeRef, sourceIsPlayingRef, sourceSpeedRef,
    loadSourceAsset,
    shuttleForward, shuttleReverse, shuttleStop,
    handleInsertEdit,
    handleOverwriteEdit,
  }
}
