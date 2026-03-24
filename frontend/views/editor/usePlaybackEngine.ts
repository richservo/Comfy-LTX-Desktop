import { useEffect, useMemo, useRef, useCallback } from 'react'
import type { TimelineClip, Track, Asset } from '../../types/project'
import { fetchAudioBuffer } from '../../lib/audio-decode'

export interface UsePlaybackEngineParams {
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  shuttleSpeed: number
  setShuttleSpeed: React.Dispatch<React.SetStateAction<number>>
  currentTime: number
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>
  duration: number
  pixelsPerSecond: number
  clips: TimelineClip[]
  tracks: Track[]
  assets: Asset[]
  activeClip: TimelineClip | null
  crossDissolveState: any
  playbackResolution: number
  playingInOut: boolean
  setPlayingInOut: (v: boolean) => void
  resolveClipSrc: (clip: TimelineClip) => string
  // Refs
  videoPoolRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  playbackTimeRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  activePoolSrcRef: React.MutableRefObject<string>
  previewVideoRef: React.RefObject<HTMLVideoElement | null>
  dissolveOutVideoRef: React.RefObject<HTMLVideoElement | null>
  trackContainerRef: React.RefObject<HTMLDivElement>
  rulerScrollRef: React.RefObject<HTMLDivElement>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  clipsRef: React.MutableRefObject<TimelineClip[]>
  tracksRef: React.MutableRefObject<Track[]>
  assetsRef: React.MutableRefObject<Asset[]>
  playheadOverlayRef: React.RefObject<HTMLDivElement>
  playheadRulerRef: React.RefObject<HTMLDivElement>
  lastStateUpdateRef: React.MutableRefObject<number>
  preSeekDoneRef: React.MutableRefObject<string | null>
  rafActiveClipIdRef: React.MutableRefObject<string | null>
  inPoint: number | null
  outPoint: number | null
  totalDuration: number
  zoom: number
  setPlaybackActiveClipId: React.Dispatch<React.SetStateAction<string | null>>
}

// ── Web Audio: pre-decoded buffer cache keyed by URL ──
interface DecodedAudio {
  fwd: AudioBuffer
  rev: AudioBuffer
}

export function usePlaybackEngine(params: UsePlaybackEngineParams) {
  const {
    isPlaying, setIsPlaying, shuttleSpeed, setShuttleSpeed,
    currentTime, setCurrentTime, pixelsPerSecond,
    clips, tracks, activeClip, crossDissolveState,
    playbackResolution, playingInOut, setPlayingInOut,
    resolveClipSrc,
    videoPoolRef, playbackTimeRef, activePoolSrcRef,
    previewVideoRef, trackContainerRef, rulerScrollRef,
    centerOnPlayheadRef, clipsRef, tracksRef, assetsRef,
    playheadOverlayRef, playheadRulerRef, lastStateUpdateRef,
    preSeekDoneRef, rafActiveClipIdRef, setPlaybackActiveClipId,
    inPoint, outPoint, totalDuration, zoom,
  } = params

  // ── Web Audio refs (same pattern as source monitor) ──
  const audioCtxRef = useRef<AudioContext | null>(null)
  const decodedCacheRef = useRef<Map<string, DecodedAudio>>(new Map())
  const decodingUrlsRef = useRef<Set<string>>(new Set())
  // Active audio sources during playback (clip id → source node)
  const activeAudioSourcesRef = useRef<Map<string, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map())
  // Single source for scrub audio
  const scrubSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const lastScrubTimeRef = useRef<number>(-1)

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }, [])

  // Decode audio for a URL into forward + reversed AudioBuffers (cached by URL)
  const decodeAudioForUrl = useCallback(async (url: string) => {
    if (!url) return
    if (decodedCacheRef.current.has(url)) return
    if (decodingUrlsRef.current.has(url)) return
    decodingUrlsRef.current.add(url)

    try {
      console.log('[audio] decoding', url)
      const arrayBuffer = await fetchAudioBuffer(url)
      console.log('[audio] got buffer', url, 'size:', arrayBuffer.byteLength)

      const ctx = getAudioCtx()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      console.log('[audio] decoded', url, 'duration:', decoded.duration, 'channels:', decoded.numberOfChannels)

      // Create reversed copy
      const reversed = ctx.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate)
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const fwd = decoded.getChannelData(ch)
        const rev = reversed.getChannelData(ch)
        for (let i = 0; i < fwd.length; i++) rev[i] = fwd[fwd.length - 1 - i]
      }

      decodedCacheRef.current.set(url, { fwd: decoded, rev: reversed })
      console.log('[audio] cached', url)
    } catch (err) {
      console.error('[audio] decode FAILED for', url, err)
    } finally {
      decodingUrlsRef.current.delete(url)
    }
  }, [getAudioCtx])

  // Kill ALL audio by closing the AudioContext. This is the only 100% reliable
  // way to guarantee silence — stop()/disconnect() can race with context resume.
  // A fresh AudioContext is created on next use via getAudioCtx().
  const killAudioCtx = useCallback(() => {
    // Stop tracked sources first (belt & suspenders)
    for (const [, entry] of activeAudioSourcesRef.current) {
      try { entry.source.stop() } catch { /* ok */ }
    }
    activeAudioSourcesRef.current.clear()
    if (scrubSourceRef.current) {
      try { scrubSourceRef.current.stop() } catch { /* ok */ }
      scrubSourceRef.current = null
    }
    // Close the entire context — kills all audio immediately
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [])

  const stopScrubSource = useCallback(() => {
    if (scrubSourceRef.current) {
      try { scrubSourceRef.current.stop() } catch { /* already stopped */ }
      try { scrubSourceRef.current.disconnect() } catch { /* ok */ }
      scrubSourceRef.current = null
    }
  }, [])

  // Play a single frame of audio at a position for a given clip (scrub)
  const playScrubFrame = useCallback((_clip: TimelineClip, clipUrl: string, mediaTime: number, volume: number, muted: boolean) => {
    const cached = decodedCacheRef.current.get(clipUrl)
    if (!cached || muted) return
    const ctx = getAudioCtx()
    stopScrubSource()

    const buf = cached.fwd
    const frameDur = 1 / 24
    const offset = Math.max(0, Math.min(mediaTime, buf.duration - frameDur))
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain).connect(ctx.destination)
    src.start(0, offset, frameDur)
    scrubSourceRef.current = src
    src.onended = () => { if (scrubSourceRef.current === src) scrubSourceRef.current = null }
  }, [getAudioCtx, stopScrubSource])

  // ── Pre-decode audio for all clips on the timeline ──
  useEffect(() => {
    const urls = new Set<string>()
    for (const clip of clips) {
      if (clip.type === 'adjustment' || clip.type === 'text' || clip.type === 'image') continue
      const url = resolveClipSrc(clip)
      if (url) urls.add(url)
    }
    for (const url of urls) {
      decodeAudioForUrl(url)
    }
  }, [clips, resolveClipSrc, decodeAudioForUrl])

  // Inline helper: resolve clip URL from refs (no React dependency)
  const resolveClipSrcRef = (clip: TimelineClip): string => {
    if (!clip) return ''
    let src = clip.asset?.url || ''
    if (clip.assetId) {
      const liveAsset = assetsRef.current.find((a: any) => a.id === clip.assetId)
      if (liveAsset) {
        if (liveAsset.takes && liveAsset.takes.length > 0 && clip.takeIndex !== undefined) {
          const idx = Math.max(0, Math.min(clip.takeIndex, liveAsset.takes.length - 1))
          src = liveAsset.takes[idx].url
        } else {
          src = liveAsset.url
        }
      }
    }
    return src || clip.importedUrl || ''
  }

  // ─── Unified playback engine (rAF) ───────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return

    const effectiveSpeed = shuttleSpeed !== 0 ? shuttleSpeed : 1
    let lastTimestamp: number | null = null
    let animFrameId: number

    const getClipAtTimeRef = (time: number): TimelineClip | null => {
      const all = clipsRef.current
      const trks = tracksRef.current
      const clipsAtTime = all
        .map((clip: TimelineClip, arrayIndex: number) => ({ clip, arrayIndex }))
        .filter(({ clip }: { clip: TimelineClip }) =>
          clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text' &&
          (trks[clip.trackIndex]?.enabled !== false) &&
          time >= clip.startTime && time < clip.startTime + clip.duration
        )
      if (clipsAtTime.length === 0) return null
      clipsAtTime.sort((a: any, b: any) => {
        if (a.clip.trackIndex !== b.clip.trackIndex) return b.clip.trackIndex - a.clip.trackIndex
        return b.arrayIndex - a.arrayIndex
      })
      return clipsAtTime[0].clip
    }

    const getNextVideoClip = (afterClip: TimelineClip): TimelineClip | null => {
      const all = clipsRef.current
      const endTime = afterClip.startTime + afterClip.duration
      let best: TimelineClip | null = null
      for (const c of all) {
        if (c.type === 'audio' || c.type === 'adjustment' || c.type === 'text') continue
        if (c.asset?.type !== 'video') continue
        if (c.startTime >= endTime - 0.01) {
          if (!best || c.startTime < best.startTime) best = c
        }
      }
      return best
    }

    const getDissolveAtTime = (time: number): { outgoing: TimelineClip; incoming: TimelineClip; progress: number } | null => {
      const all = clipsRef.current
      for (const clipA of all) {
        if (clipA.transitionOut?.type !== 'dissolve' || clipA.transitionOut.duration <= 0) continue
        const clipAEnd = clipA.startTime + clipA.duration
        const dissolveStart = clipAEnd - clipA.transitionOut.duration
        if (time < dissolveStart || time >= clipAEnd) continue
        const clipB = all.find((c: TimelineClip) =>
          c.id !== clipA.id &&
          c.trackIndex === clipA.trackIndex &&
          c.transitionIn?.type === 'dissolve' &&
          Math.abs(c.startTime - clipAEnd) < 0.05
        )
        if (!clipB) continue
        const dissolveDuration = clipA.transitionOut.duration
        const timeIntoDissolve = time - dissolveStart
        const progress = Math.max(0, Math.min(1, timeIntoDissolve / dissolveDuration))
        return { outgoing: clipA, incoming: clipB, progress }
      }
      return null
    }

    const STATE_UPDATE_INTERVAL = 250
    const DISSOLVE_STATE_UPDATE_INTERVAL = 33
    lastStateUpdateRef.current = 0

    // ── Web Audio: start continuous audio for active clips ──
    const ctx = getAudioCtx()
    const startedClipIds = new Set<string>()

    const startAudioForClip = (clip: TimelineClip, mediaTime: number) => {
      if (startedClipIds.has(clip.id)) return
      const url = resolveClipSrcRef(clip)
      const cached = decodedCacheRef.current.get(url)
      if (!cached) return

      const trks = tracksRef.current
      const trackObj = trks[clip.trackIndex]
      const anySoloed = trks.some(t => t.solo)
      const isSoloMuted = anySoloed && !trackObj?.solo
      const isMuted = clip.muted || trackObj?.muted || isSoloMuted || false

      const gain = ctx.createGain()
      gain.gain.value = isMuted ? 0 : clip.volume
      gain.connect(ctx.destination)

      const isReverse = effectiveSpeed < 0
      const buf = isReverse ? cached.rev : cached.fwd
      const rate = Math.abs(effectiveSpeed) * clip.speed
      const offset = isReverse
        ? Math.max(0, Math.min(buf.duration, buf.duration - mediaTime))
        : Math.max(0, Math.min(mediaTime, buf.duration))

      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = rate
      src.connect(gain)
      src.start(0, offset)

      activeAudioSourcesRef.current.set(clip.id, { source: src, gain })
      startedClipIds.add(clip.id)
      src.onended = () => {
        activeAudioSourcesRef.current.delete(clip.id)
        startedClipIds.delete(clip.id)
      }
    }

    const stopAudioForClip = (clipId: string) => {
      const entry = activeAudioSourcesRef.current.get(clipId)
      if (entry) {
        try { entry.source.stop() } catch { /* already stopped */ }
        try { entry.source.disconnect() } catch { /* ok */ }
        try { entry.gain.disconnect() } catch { /* ok */ }
        activeAudioSourcesRef.current.delete(clipId)
      }
      startedClipIds.delete(clipId)
    }

    // Compute media time for a clip at a given timeline time
    const getMediaTime = (clip: TimelineClip, time: number, audioDuration?: number): number => {
      const timeInClip = time - clip.startTime
      const dur = audioDuration || clip.duration
      // For audio elements we don't have video duration, use the decoded buffer duration
      const url = resolveClipSrcRef(clip)
      const cached = decodedCacheRef.current.get(url)
      const assetDur = cached ? cached.fwd.duration : dur
      return clip.reversed
        ? Math.max(0, assetDur - clip.trimEnd - timeInClip * clip.speed)
        : Math.max(0, clip.trimStart + timeInClip * clip.speed)
    }

    // Start audio for all clips at the initial playhead position
    const allClips = clipsRef.current
    const trks = tracksRef.current
    for (const c of allClips) {
      if (c.type === 'adjustment' || c.type === 'text' || c.type === 'image') continue
      if (currentTime < c.startTime || currentTime >= c.startTime + c.duration) continue
      if (trks[c.trackIndex]?.enabled === false) continue
      // Skip video clips that have no audio (no linked audio clip = no embedded audio to play)
      if (c.type === 'video' && (!c.linkedClipIds || !c.linkedClipIds.some(lid => allClips.some(ac => ac.id === lid && ac.type === 'audio')))) continue
      // Skip audio clips that are linked to a video clip — the video clip plays the audio
      if (c.type === 'audio' && c.linkedClipIds?.some(lid => allClips.some(vc => vc.id === lid && vc.type === 'video'))) continue
      const mt = getMediaTime(c, currentTime)
      startAudioForClip(c, mt)
    }

    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp
        lastStateUpdateRef.current = timestamp
      }

      const deltaMs = timestamp - lastTimestamp
      lastTimestamp = timestamp
      const deltaSec = (deltaMs / 1000) * effectiveSpeed

      // ── 1. Advance time ──
      let next = playbackTimeRef.current + deltaSec
      let stopped = false

      if (playingInOut && inPoint !== null && outPoint !== null) {
        const loopStart = Math.min(inPoint, outPoint)
        const loopEnd = Math.max(inPoint, outPoint)
        if (next >= loopEnd) next = loopStart
        else if (next <= loopStart) next = loopEnd
      } else {
        if (next >= totalDuration) { next = 0; stopped = true }
        else if (next < 0) { next = 0; stopped = true }
      }

      playbackTimeRef.current = next

      if (stopped) {
        setIsPlaying(false)
        setShuttleSpeed(0)
        setCurrentTime(next)
        return
      }

      // ── 2. Find active clip & sync video directly ──
      const pool = videoPoolRef.current
      const syncClip = getClipAtTimeRef(next)

      rafActiveClipIdRef.current = syncClip?.id ?? null

      const dissolveInfo = getDissolveAtTime(next)

      const poolContainer = document.getElementById('video-pool-container')

      if (dissolveInfo) {
        if (poolContainer) poolContainer.classList.remove('hidden')

        const outClip = dissolveInfo.outgoing
        const outSrc = resolveClipSrcRef(outClip)
        if (outSrc) {
          const outVid = pool.get(outSrc)
          if (outVid) {
            const container = document.getElementById('video-pool-container')
            if (container && !outVid.parentElement) container.appendChild(outVid)
            if (outSrc !== activePoolSrcRef.current) {
              const oldVid = pool.get(activePoolSrcRef.current)
              if (oldVid) { oldVid.style.opacity = '0'; oldVid.style.zIndex = '0'; oldVid.pause() }
              activePoolSrcRef.current = outSrc
            }
            outVid.style.opacity = '1'
            outVid.style.zIndex = '1'
            outVid.muted = true
            outVid.volume = 0
            if (outVid.readyState >= 2) {
              const timeInClip = next - outClip.startTime
              const vd = outVid.duration
              if (!isNaN(vd)) {
                const usable = vd - outClip.trimStart - outClip.trimEnd
                const tt = outClip.reversed
                  ? Math.max(0, Math.min(vd, outClip.trimStart + usable - timeInClip * outClip.speed))
                  : Math.max(0, Math.min(vd, outClip.trimStart + timeInClip * outClip.speed))
                if (outClip.reversed || effectiveSpeed < 0) {
                  if (!outVid.paused) outVid.pause()
                  if (!isNaN(tt) && Math.abs(outVid.currentTime - tt) > 0.04) {
                    if (!(outVid as any).__reverseSeekPending) {
                      (outVid as any).__reverseSeekPending = true
                      outVid.currentTime = tt
                      outVid.addEventListener('seeked', () => { (outVid as any).__reverseSeekPending = false }, { once: true })
                    }
                  }
                } else {
                  outVid.playbackRate = outClip.speed * Math.abs(effectiveSpeed)
                  if (!isNaN(tt) && Math.abs(outVid.currentTime - tt) > 0.3) outVid.currentTime = tt
                  if (outVid.paused) outVid.play().catch(() => {})
                }
              }
            }
          }
        }

        const inVid = previewVideoRef.current
        if (inVid && dissolveInfo.incoming.asset?.type === 'video') {
          inVid.muted = true
          inVid.volume = 0
          if (inVid.duration && !isNaN(inVid.duration)) {
            const clip = dissolveInfo.incoming
            const videoDuration = inVid.duration
            const usableMedia = videoDuration - clip.trimStart - clip.trimEnd
            const timeInClip = Math.max(0, next - clip.startTime)
            const targetTime = clip.reversed
              ? Math.max(0, Math.min(videoDuration, clip.trimStart + usableMedia - timeInClip * clip.speed))
              : Math.max(0, Math.min(videoDuration, clip.trimStart + timeInClip * clip.speed))
            if (!inVid.paused) inVid.pause()
            if (!isNaN(targetTime) && Math.abs(inVid.currentTime - targetTime) > 0.04) {
              inVid.currentTime = targetTime
            }
          }
        }

        if (dissolveInfo.incoming.asset?.type === 'video') {
          const inSrc = resolveClipSrcRef(dissolveInfo.incoming)
          if (inSrc && !pool.has(inSrc)) {
            const v = document.createElement('video')
            v.preload = 'auto'
            v.playsInline = true
            v.muted = true
            v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;z-index:0;'
            v.src = inSrc
            v.load()
            pool.set(inSrc, v)
            const container = document.getElementById('video-pool-container')
            if (container) container.appendChild(v)
          }
        }

      } else if (syncClip && syncClip.asset?.type === 'video') {
        if (poolContainer) poolContainer.classList.remove('hidden')
        const clipSrc = resolveClipSrcRef(syncClip)
        if (clipSrc) {
          let video = pool.get(clipSrc)

          if (video) {
            const container = document.getElementById('video-pool-container')
            if (container && !video.parentElement) container.appendChild(video)
          }

          if (clipSrc !== activePoolSrcRef.current) {
            const oldVid = pool.get(activePoolSrcRef.current)
            if (oldVid) {
              oldVid.style.opacity = '0'
              oldVid.style.zIndex = '0'
              oldVid.pause()
            }
            activePoolSrcRef.current = clipSrc
            preSeekDoneRef.current = null
          }
          if (video) {
            video.style.opacity = '1'
            video.style.zIndex = '1'
          }

          if (video) {
            const seekAndPlay = (v: HTMLVideoElement) => {
              const timeInClip = next - syncClip.startTime
              const videoDuration = v.duration
              if (!isNaN(videoDuration)) {
                const usableMedia = videoDuration - syncClip.trimStart - syncClip.trimEnd
                const targetTime = syncClip.reversed
                  ? Math.max(0, Math.min(videoDuration, syncClip.trimStart + usableMedia - timeInClip * syncClip.speed))
                  : Math.max(0, Math.min(videoDuration, syncClip.trimStart + timeInClip * syncClip.speed))

                if (syncClip.reversed || effectiveSpeed < 0) {
                  // Reverse: pause video, seek with gating
                  if (!v.paused) v.pause()
                  v.playbackRate = 1
                  if (!isNaN(targetTime) && Math.abs(v.currentTime - targetTime) > 0.04) {
                    if (!(v as any).__reverseSeekPending) {
                      (v as any).__reverseSeekPending = true
                      v.currentTime = targetTime
                      v.addEventListener('seeked', () => { (v as any).__reverseSeekPending = false }, { once: true })
                    }
                  }
                } else {
                  // Forward: native playbackRate
                  v.playbackRate = syncClip.speed * Math.abs(effectiveSpeed)
                  if (!isNaN(targetTime) && Math.abs(v.currentTime - targetTime) > 0.3) {
                    if (typeof (v as any).fastSeek === 'function') (v as any).fastSeek(targetTime)
                    else v.currentTime = targetTime
                  }
                  if (v.paused) v.play().catch(() => {})
                }

                v.muted = true
                v.volume = 0
              }
            }

            if (video.readyState >= 2) {
              seekAndPlay(video)
            } else if (!(video as any).__pendingCanplay) {
              (video as any).__pendingCanplay = true
              const onReady = () => {
                video.removeEventListener('canplay', onReady)
                ;(video as any).__pendingCanplay = false
                video.style.opacity = '1'
                video.style.zIndex = '1'
                seekAndPlay(video)
              }
              video.addEventListener('canplay', onReady)
            }
          }

          ;(previewVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = video || null

          // Pre-seek next clip
          const nextClip = getNextVideoClip(syncClip)
          if (nextClip && nextClip.id !== preSeekDoneRef.current) {
            const remainingInCurrent = (syncClip.startTime + syncClip.duration) - next
            if (remainingInCurrent < 1.5 && remainingInCurrent > 0) {
              const nextSrc = resolveClipSrcRef(nextClip)
              const nextVideo = nextSrc ? pool.get(nextSrc) : null
              if (nextVideo && nextVideo.readyState >= 1) {
                const nextTargetTime = nextClip.reversed
                  ? nextClip.trimStart + (nextVideo.duration || 0) - nextClip.trimStart - nextClip.trimEnd
                  : nextClip.trimStart
                if (!isNaN(nextTargetTime)) {
                  if (typeof (nextVideo as any).fastSeek === 'function') (nextVideo as any).fastSeek(nextTargetTime)
                  else nextVideo.currentTime = nextTargetTime
                }
                preSeekDoneRef.current = nextClip.id
              }
            }
          }
        }
      } else {
        if (poolContainer) poolContainer.classList.add('hidden')
        const curVid = pool.get(activePoolSrcRef.current)
        if (curVid && !curVid.paused) curVid.pause()
      }

      // ── 3. Sync Web Audio: start/stop sources as clips enter/exit range ──
      {
        const allClips = clipsRef.current
        const trks = tracksRef.current
        const activeAudioIds = new Set<string>()
        const anySoloed = trks.some(t => t.solo)

        for (const c of allClips) {
          if (c.type === 'adjustment' || c.type === 'text' || c.type === 'image') continue
          if (next < c.startTime || next >= c.startTime + c.duration) continue
          if (trks[c.trackIndex]?.enabled === false) continue
          if (c.type === 'video' && (!c.linkedClipIds || !c.linkedClipIds.some(lid => allClips.some(ac => ac.id === lid && ac.type === 'audio')))) continue
          // Skip audio clips that are linked to a video clip — the video clip plays the audio
          if (c.type === 'audio' && c.linkedClipIds?.some(lid => allClips.some(vc => vc.id === lid && vc.type === 'video'))) continue
          activeAudioIds.add(c.id)
        }

        // Stop clips no longer active
        for (const clipId of startedClipIds) {
          if (!activeAudioIds.has(clipId)) {
            stopAudioForClip(clipId)
          }
        }

        // Start newly active clips
        for (const c of allClips) {
          if (!activeAudioIds.has(c.id)) continue
          if (startedClipIds.has(c.id)) {
            // Update gain for mute/solo changes
            const entry = activeAudioSourcesRef.current.get(c.id)
            if (entry) {
              const trackObj = trks[c.trackIndex]
              const isSoloMuted = anySoloed && !trackObj?.solo
              const isMuted = c.muted || trackObj?.muted || isSoloMuted || false
              entry.gain.gain.value = isMuted ? 0 : c.volume
            }
            continue
          }
          const mt = getMediaTime(c, next)
          startAudioForClip(c, mt)
        }
      }

      // ── 4. Direct DOM updates for playhead ──
      const pps = zoom * 100
      const px = `${next * pps}px`
      if (playheadRulerRef.current) playheadRulerRef.current.style.left = px
      if (playheadOverlayRef.current) {
        const scrollX = trackContainerRef.current?.scrollLeft || 0
        playheadOverlayRef.current.style.left = `${next * pps - scrollX}px`
      }

      // ── 5. Auto-scroll timeline ──
      const container = trackContainerRef.current
      if (container) {
        const playheadX = next * pps
        const { scrollLeft, clientWidth } = container
        const margin = 80
        if (playheadX > scrollLeft + clientWidth - margin) {
          container.scrollLeft = playheadX - clientWidth + margin
        } else if (playheadX < scrollLeft + margin) {
          container.scrollLeft = Math.max(0, playheadX - margin)
        }
        if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = container.scrollLeft
      }

      // ── 6. Throttled React state sync ──
      const updateInterval = dissolveInfo ? DISSOLVE_STATE_UPDATE_INTERVAL : STATE_UPDATE_INTERVAL
      if (timestamp - lastStateUpdateRef.current >= updateInterval) {
        lastStateUpdateRef.current = timestamp
        setCurrentTime(next)
        setPlaybackActiveClipId(rafActiveClipIdRef.current)
      }

      animFrameId = requestAnimationFrame(tick)
    }

    // Sync the ref to where the user last scrubbed/seeked
    playbackTimeRef.current = currentTime

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
      setCurrentTime(playbackTimeRef.current)
      setPlaybackActiveClipId(null)
      rafActiveClipIdRef.current = null
      // Kill the AudioContext entirely to guarantee silence
      killAudioCtx()
    }
  }, [isPlaying, totalDuration, shuttleSpeed, playingInOut, inPoint, outPoint, zoom])

  // Clear In/Out loop mode when playback stops
  useEffect(() => {
    if (!isPlaying && playingInOut) {
      setPlayingInOut(false)
    }
  }, [isPlaying, playingInOut])

  // Auto-scroll for non-playing scrub
  useEffect(() => {
    if (isPlaying) return
  }, [isPlaying, currentTime, pixelsPerSecond])

  // Center view on playhead after zoom change
  useEffect(() => {
    if (!centerOnPlayheadRef.current) return
    centerOnPlayheadRef.current = false

    const container = trackContainerRef.current
    if (!container) return

    const playheadX = currentTime * pixelsPerSecond
    const centerScroll = playheadX - container.clientWidth / 2
    container.scrollLeft = Math.max(0, centerScroll)

    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
  }, [pixelsPerSecond, currentTime])

  // --- Video pool management ---
  const timelineVideoSources = useMemo(() => {
    const srcSet = new Set<string>()
    for (const clip of clips) {
      if (clip.type === 'audio' || clip.asset?.type !== 'video') continue
      const src = resolveClipSrc(clip)
      if (src) srcSet.add(src)
    }
    return srcSet
  }, [clips, resolveClipSrc])

  useEffect(() => {
    const pool = videoPoolRef.current
    const container = document.getElementById('video-pool-container')

    for (const src of timelineVideoSources) {
      if (!pool.has(src)) {
        const video = document.createElement('video')
        video.preload = 'auto'
        video.playsInline = true
        video.muted = true
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;z-index:0;pointer-events:none;'
        video.src = src
        video.load()
        pool.set(src, video)
        if (container) container.appendChild(video)
      }
    }

    for (const [src, video] of pool) {
      if (!timelineVideoSources.has(src)) {
        video.pause()
        video.removeAttribute('src')
        video.load()
        if (video.parentElement) video.parentElement.removeChild(video)
        pool.delete(src)
      }
    }
  }, [timelineVideoSources])

  // Apply playback resolution
  useEffect(() => {
    const pool = videoPoolRef.current
    for (const [, video] of pool) {
      if (playbackResolution < 1) {
        video.style.width = `${playbackResolution * 100}%`
        video.style.height = `${playbackResolution * 100}%`
        video.style.transform = `scale(${1 / playbackResolution})`
        video.style.transformOrigin = 'top left'
      } else {
        video.style.width = '100%'
        video.style.height = '100%'
        video.style.transform = ''
        video.style.transformOrigin = ''
      }
    }
  }, [playbackResolution, timelineVideoSources])

  // Cleanup pool on unmount
  useEffect(() => {
    return () => {
      for (const [, video] of videoPoolRef.current) {
        video.pause()
        video.removeAttribute('src')
        video.load()
        if (video.parentElement) video.parentElement.removeChild(video)
      }
      videoPoolRef.current.clear()
    }
  }, [])

  // Sync preview video with timeline (scrubbing only — rAF handles playback)
  useEffect(() => {
    if (isPlaying) return

    if (crossDissolveState) {
      const { incoming } = crossDissolveState
      if (incoming.asset?.type === 'video') {
        const video = previewVideoRef.current
        if (video) {
          const incomingSrc = resolveClipSrc(incoming)
          if (incomingSrc && video.src !== incomingSrc && !video.src.endsWith(incomingSrc)) {
            video.src = incomingSrc
            video.load()
          }

          const timeInClip = Math.max(0, currentTime - incoming.startTime)

          const syncIncoming = () => {
            if (!video || !video.duration || isNaN(video.duration)) return
            const videoDuration = video.duration
            const usableMedia = videoDuration - incoming.trimStart - incoming.trimEnd
            const targetTime = incoming.reversed
              ? Math.max(0, Math.min(videoDuration, incoming.trimStart + usableMedia - timeInClip * incoming.speed))
              : Math.max(0, Math.min(videoDuration, incoming.trimStart + timeInClip * incoming.speed))

            if (!video.paused) video.pause()
            video.muted = true
            if (!isNaN(targetTime) && Math.abs(video.currentTime - targetTime) > 0.04) {
              video.currentTime = targetTime
            }
          }

          if (video.readyState >= 2) {
            syncIncoming()
          } else {
            video.addEventListener('loadeddata', () => syncIncoming(), { once: true })
          }
        }
      }
    }

    const pool = videoPoolRef.current

    const syncClip = activeClip
    if (!syncClip || syncClip.asset?.type !== 'video') {
      const curVid = pool.get(activePoolSrcRef.current)
      if (curVid && !curVid.paused) curVid.pause()
      return
    }

    const clipSrc = resolveClipSrc(syncClip)
    if (!clipSrc) return

    let video = pool.get(clipSrc)
    if (!video) {
      video = document.createElement('video')
      video.preload = 'auto'
      video.playsInline = true
      video.muted = true
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;z-index:0;'
      video.src = clipSrc
      video.load()
      pool.set(clipSrc, video)
    }

    const container = document.getElementById('video-pool-container')
    if (container && !video.parentElement) {
      container.appendChild(video)
    }

    const isNewSource = clipSrc !== activePoolSrcRef.current
    if (isNewSource) {
      const oldVid = pool.get(activePoolSrcRef.current)
      if (oldVid) {
        oldVid.style.opacity = '0'
        oldVid.style.zIndex = '0'
        oldVid.pause()
      }
      video.style.opacity = '1'
      video.style.zIndex = '1'
      activePoolSrcRef.current = clipSrc
    }

    if (!crossDissolveState) {
      ;(previewVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = video
    }

    const timeInClip = currentTime - syncClip.startTime

    const syncVideo = (forceSeek: boolean) => {
      if (!video) return

      video.muted = true
      video.volume = 0

      if (!video.duration || isNaN(video.duration)) {
        if (forceSeek) {
          video.play().then(() => { video.pause() }).catch(() => {})
        }
        return
      }

      const videoDuration = video.duration
      const usableMediaDuration = videoDuration - syncClip.trimStart - syncClip.trimEnd

      const targetTime = syncClip.reversed
        ? Math.max(0, Math.min(videoDuration, syncClip.trimStart + usableMediaDuration - timeInClip * syncClip.speed))
        : Math.max(0, Math.min(videoDuration, syncClip.trimStart + timeInClip * syncClip.speed))

      if (syncClip.reversed) {
        if (!video.paused) video.pause()
        video.playbackRate = 1
        if (!isNaN(targetTime) && (forceSeek || Math.abs(video.currentTime - targetTime) > 0.04)) {
          if (forceSeek && Math.abs(video.currentTime - targetTime) < 0.001) {
            video.currentTime = targetTime + 0.001
          }
          video.currentTime = targetTime
        }
      } else {
        video.playbackRate = syncClip.speed
        if (!isNaN(targetTime) && (forceSeek || Math.abs(video.currentTime - targetTime) > 0.3)) {
          if (forceSeek && Math.abs(video.currentTime - targetTime) < 0.001) {
            video.currentTime = targetTime + 0.001
          }
          video.currentTime = targetTime
        }
        if (!video.paused) video.pause()
      }
    }

    if (video.readyState >= 2) {
      syncVideo(isNewSource)
    } else {
      const onLoaded = () => syncVideo(true)
      video.addEventListener('loadeddata', onLoaded, { once: true })
      if (container) {
        for (const [, v] of pool) {
          if (!v.parentElement) container.appendChild(v)
        }
      }
      ;(video as any).__syncOnLoad = onLoaded
    }

    return () => {
      if (video && (video as any).__syncOnLoad) {
        video.removeEventListener('loadeddata', (video as any).__syncOnLoad)
        delete (video as any).__syncOnLoad
      }
    }
  }, [currentTime, isPlaying, activeClip, crossDissolveState, tracks, resolveClipSrc])

  // ── Scrub audio: play 1 frame of audio whenever currentTime changes while stopped ──
  useEffect(() => {
    if (isPlaying) return
    if (lastScrubTimeRef.current === currentTime) return
    lastScrubTimeRef.current = currentTime

    // Find audio clips at the playhead and play a scrub frame for each
    const trks = tracks
    const anySoloed = trks.some(t => t.solo)
    let played = false

    for (const clip of clips) {
      if (clip.type === 'adjustment' || clip.type === 'text' || clip.type === 'image') continue
      if (currentTime < clip.startTime || currentTime >= clip.startTime + clip.duration) continue
      if (trks[clip.trackIndex]?.enabled === false) continue
      if (clip.type === 'video' && (!clip.linkedClipIds || !clip.linkedClipIds.some(lid => clips.some(ac => ac.id === lid && ac.type === 'audio')))) continue
      // Skip audio clips that are linked to a video clip — the video clip plays the audio
      if (clip.type === 'audio' && clip.linkedClipIds?.some(lid => clips.some(vc => vc.id === lid && vc.type === 'video'))) continue

      const trackObj = trks[clip.trackIndex]
      const isSoloMuted = anySoloed && !trackObj?.solo
      const isMuted = clip.muted || trackObj?.muted || isSoloMuted || false

      const url = resolveClipSrc(clip)
      if (!url) continue

      const cached = decodedCacheRef.current.get(url)
      if (!cached) continue

      const timeInClip = currentTime - clip.startTime
      const mediaTime = clip.reversed
        ? Math.max(0, cached.fwd.duration - clip.trimEnd - timeInClip * clip.speed)
        : Math.max(0, clip.trimStart + timeInClip * clip.speed)

      if (!played) {
        // Play scrub audio for the first active audio clip
        playScrubFrame(clip, url, mediaTime, clip.volume, isMuted)
        played = true
      }
    }

    if (!played) {
      stopScrubSource()
    }
  }, [currentTime, isPlaying, clips, tracks, resolveClipSrc, playScrubFrame, stopScrubSource])

  // Clean up Web Audio on unmount
  useEffect(() => {
    return () => {
      killAudioCtx()
    }
  }, [killAudioCtx])

  return {}
}
