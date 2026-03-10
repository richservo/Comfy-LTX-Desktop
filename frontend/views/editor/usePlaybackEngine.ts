import { useEffect, useMemo, useRef } from 'react'
import type { TimelineClip, Track, Asset } from '../../types/project'

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

export function usePlaybackEngine(params: UsePlaybackEngineParams) {
  const {
    isPlaying, setIsPlaying, shuttleSpeed, setShuttleSpeed,
    currentTime, setCurrentTime, pixelsPerSecond,
    clips, tracks, assets, activeClip, crossDissolveState,
    playbackResolution, playingInOut, setPlayingInOut,
    resolveClipSrc,
    videoPoolRef, playbackTimeRef, isPlayingRef, activePoolSrcRef,
    previewVideoRef, trackContainerRef, rulerScrollRef,
    centerOnPlayheadRef, clipsRef, tracksRef, assetsRef,
    playheadOverlayRef, playheadRulerRef, lastStateUpdateRef,
    preSeekDoneRef, rafActiveClipIdRef, setPlaybackActiveClipId,
    inPoint, outPoint, totalDuration, zoom,
  } = params

  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const scrubAudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrubTimeRef = useRef<number>(-1)

  // ─── Unified playback engine (rAF) ───────────────────────────────────
  // During playback this loop is the SINGLE authority for:
  //   • advancing time (via playbackTimeRef — NOT React state every frame)
  //   • switching / seeking pool video elements (instant, no useEffect delay)
  //   • pre-seeking the NEXT clip so its first frame is already decoded
  //   • auto-scrolling the timeline
  //   • updating playhead position via direct DOM mutation
  // React state (currentTime) is synced at a throttled rate (~24 fps) for UI.
  // This eliminates the old pipeline: rAF→setState→render→useEffect→sync.
  useEffect(() => {
    if (!isPlaying) return
    
    const effectiveSpeed = shuttleSpeed !== 0 ? shuttleSpeed : 1
    let lastTimestamp: number | null = null
    let animFrameId: number
    
    // Inline helpers that read refs (no React dependency)
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
      // Higher trackIndex = higher visual track = takes priority (NLE rule)
      clipsAtTime.sort((a: any, b: any) => {
        if (a.clip.trackIndex !== b.clip.trackIndex) return b.clip.trackIndex - a.clip.trackIndex
        return b.arrayIndex - a.arrayIndex
      })
      return clipsAtTime[0].clip
    }
    
    // Find the next video clip AFTER a given clip (for pre-seeking)
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
    
    // Detect dissolve region at a given time (inline, no React dependency)
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
    
    const STATE_UPDATE_INTERVAL = 250 // ~4fps for React state updates (playhead/video/audio are smooth via rAF+DOM, this is only for timecode display)
    const DISSOLVE_STATE_UPDATE_INTERVAL = 33 // ~30fps during dissolves for smooth crossfade
    lastStateUpdateRef.current = 0
    
    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp
        lastStateUpdateRef.current = timestamp
        // Fall through with deltaMs = 0 so video sync still runs on the first frame
      }
      
      const deltaMs = timestamp - lastTimestamp
      lastTimestamp = timestamp
      const deltaSec = (deltaMs / 1000) * effectiveSpeed
      
      // ── 1. Advance time ──
      let next = playbackTimeRef.current + deltaSec
      let stopped = false
      
      // In/Out loop
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
        return // don't schedule next frame
      }
      
      // ── 2. Find active clip & sync video directly ──
      const pool = videoPoolRef.current
      const syncClip = getClipAtTimeRef(next)
      
      // Track which clip the rAF is actively displaying (for audio dedup)
      rafActiveClipIdRef.current = syncClip?.id ?? null
      
      // Check if we're in a dissolve region
      const dissolveInfo = getDissolveAtTime(next)
      
      // Show/hide the video pool container via DOM to avoid React dependency on throttled activeClip
      const poolContainer = document.getElementById('video-pool-container')
      
      if (dissolveInfo) {
        // During dissolve: the pool continues showing the OUTGOING clip (with fading opacity via React).
        // We keep the pool visible and let it play normally for the outgoing clip.
        if (poolContainer) poolContainer.classList.remove('hidden')
        
        // Ensure pool video for outgoing clip is playing and in sync
        const outClip = dissolveInfo.outgoing
        const outSrc = resolveClipSrcRef(outClip)
        if (outSrc) {
          let outVid = pool.get(outSrc)
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
              outVid.playbackRate = outClip.reversed ? 1 : outClip.speed
              const timeInClip = next - outClip.startTime
              const vd = outVid.duration
              if (!isNaN(vd)) {
                const usable = vd - outClip.trimStart - outClip.trimEnd
                const tt = outClip.reversed
                  ? Math.max(0, Math.min(vd, outClip.trimStart + usable - timeInClip * outClip.speed))
                  : Math.max(0, Math.min(vd, outClip.trimStart + timeInClip * outClip.speed))
                if (outClip.reversed) {
                  if (!outVid.paused) outVid.pause()
                  // seeked-event gated seeking for dissolve reverse
                  if (!isNaN(tt) && Math.abs(outVid.currentTime - tt) > 0.04) {
                    if (!(outVid as any).__reverseSeekPending) {
                      (outVid as any).__reverseSeekPending = true
                      outVid.currentTime = tt
                      const onSeeked = () => {
                        outVid.removeEventListener('seeked', onSeeked)
                        ;(outVid as any).__reverseSeekPending = false
                      }
                      outVid.addEventListener('seeked', onSeeked)
                    }
                  }
                } else {
                  if (!isNaN(tt) && Math.abs(outVid.currentTime - tt) > 0.3) outVid.currentTime = tt
                  if (outVid.paused) outVid.play().catch(() => {})
                }
              }
            }
          }
        }
        
        // Seek the incoming video overlay (rendered as JSX by ProgramMonitor)
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
        
        // Pre-load the incoming clip's video in the pool for seamless transition when dissolve ends
        if (dissolveInfo.incoming.asset?.type === 'video') {
          const inSrc = resolveClipSrcRef(dissolveInfo.incoming)
          if (inSrc && !pool.has(inSrc)) {
            const v = document.createElement('video')
            v.preload = 'auto'
            v.playsInline = true
            v.muted = true
            v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:0;'
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
          
          // Ensure video is in the DOM
          if (video) {
            const container = document.getElementById('video-pool-container')
            if (container && !video.parentElement) container.appendChild(video)
          }
          
          // Switch visibility instantly if clip source changed
          if (clipSrc !== activePoolSrcRef.current) {
            const oldVid = pool.get(activePoolSrcRef.current)
            if (oldVid) {
              oldVid.style.opacity = '0'
              oldVid.style.zIndex = '0'
              oldVid.pause()
            }
            activePoolSrcRef.current = clipSrc
            preSeekDoneRef.current = null // reset pre-seek tracker on clip change
          }
          // Always ensure the current video is visible — handles edge case where
          // the scrub sync couldn't fully initialize before playback took over
          if (video) {
            video.style.opacity = '1'
            video.style.zIndex = '1'
          }
          
          // Seek / play the video
          if (video) {
            const seekAndPlay = (v: HTMLVideoElement) => {
              const timeInClip = next - syncClip.startTime
              const videoDuration = v.duration
              if (!isNaN(videoDuration)) {
                const usableMedia = videoDuration - syncClip.trimStart - syncClip.trimEnd
                const targetTime = syncClip.reversed
                  ? Math.max(0, Math.min(videoDuration, syncClip.trimStart + usableMedia - timeInClip * syncClip.speed))
                  : Math.max(0, Math.min(videoDuration, syncClip.trimStart + timeInClip * syncClip.speed))
                
                if (syncClip.reversed) {
                  if (!v.paused) v.pause()
                  v.playbackRate = 1
                  // seeked-event gated seeking: only seek when the previous seek has completed
                  if (!isNaN(targetTime) && Math.abs(v.currentTime - targetTime) > 0.04) {
                    if (!(v as any).__reverseSeekPending) {
                      (v as any).__reverseSeekPending = true
                      v.currentTime = targetTime
                      const onSeeked = () => {
                        v.removeEventListener('seeked', onSeeked)
                        ;(v as any).__reverseSeekPending = false
                      }
                      v.addEventListener('seeked', onSeeked)
                    }
                  }
                } else {
                  v.playbackRate = syncClip.speed
                  if (!isNaN(targetTime) && Math.abs(v.currentTime - targetTime) > 0.3) {
                    if (typeof (v as any).fastSeek === 'function') (v as any).fastSeek(targetTime)
                    else v.currentTime = targetTime
                  }
                  if (v.paused) v.play().catch(() => {})
                }
                
                // Always mute video elements — audio comes exclusively from audio tracks
                v.muted = true
                v.volume = 0
              }
            }
            
            if (video.readyState >= 2) {
              seekAndPlay(video)
            } else if (!(video as any).__pendingCanplay) {
              // Video not decoded yet — seek & play as soon as it's ready (one listener only)
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
          
          // Update previewVideoRef for other code that reads it
          ;(previewVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = video || null
          
          // ── 3. Pre-seek the NEXT clip so its first frame is decoded ──
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
        // No video clip at this time — pause current pool video (keep last frame), hide pool
        if (poolContainer) poolContainer.classList.add('hidden')
        const curVid = pool.get(activePoolSrcRef.current)
        if (curVid && !curVid.paused) curVid.pause()
      }
      
      // ── 3b. Sync hidden audio elements directly (no React dependency) ──
      // Audio plays via hidden <audio> elements for both audio-track AND video-track
      // clips. Video <video> elements stay muted to avoid double playback.
      // KEY PRINCIPLES:
      //   1. Once audio is playing at the correct speed, DON'T touch it.
      //   2. Never set playbackRate unless it actually changed (avoids re-buffer).
      //   3. Don't spam play() on auto-paused elements — use backoff.
      //   4. Keep audio elements alive (just pause) so buffers are preserved.
      {
        const audioMap = audioElementsRef.current
        const allClips = clipsRef.current
        const trks = tracksRef.current
        const activeAudioIds = new Set<string>()
        const anySoloed = trks.some(t => t.solo)
        
        for (const c of allClips) {
          if (c.type === 'adjustment' || c.type === 'text' || c.type === 'image') continue
          if (next < c.startTime || next >= c.startTime + c.duration) continue
          if (trks[c.trackIndex]?.enabled === false) continue
          // For video clips: only play audio if there's a linked audio clip on the timeline.
          // If the video was added without a linked audio clip (e.g. audio tracks were unpatched),
          // its embedded audio should not play.
          if (c.type === 'video' && (!c.linkedClipIds || !c.linkedClipIds.some(lid => allClips.some(ac => ac.id === lid && ac.type === 'audio')))) continue
          activeAudioIds.add(c.id)
        }
        
        // Pause clips no longer active (but keep the element for fast resume)
        for (const [id, el] of audioMap) {
          if (!activeAudioIds.has(id)) {
            if (!el.paused) el.pause()
            ;(el as any).__audioPlaying = false
          }
        }
        
        // Sync active audio clips
        for (const c of allClips) {
          if (!activeAudioIds.has(c.id)) continue
          
          const url = resolveClipSrcRef(c)
          if (!url) continue
          
          let el = audioMap.get(c.id)
          let isNew = false
          if (!el) {
            el = document.createElement('audio')
            el.src = url
            ;(el as any).__intendedSrc = url
            el.preload = 'auto'
            audioMap.set(c.id, el)
            isNew = true
          } else if ((el as any).__intendedSrc !== url && url) {
            el.src = url
            ;(el as any).__intendedSrc = url
            ;(el as any).__audioPlaying = false
            isNew = true
          }
          
          const trackObj = trks[c.trackIndex]
          const isSoloMuted = anySoloed && !trackObj?.solo
          el.muted = c.muted || trackObj?.muted || isSoloMuted || false
          el.volume = c.volume
          
          const computeTarget = (audioEl: HTMLAudioElement, atTime: number) => {
            const assetDur = audioEl.duration || c.duration
            const timeInClip = atTime - c.startTime
            return c.reversed
              ? Math.max(0, assetDur - c.trimEnd - timeInClip * c.speed)
              : Math.max(0, c.trimStart + timeInClip * c.speed)
          }
          
          const desiredRate = c.reversed ? 1 : c.speed
          
          if (el.readyState >= 2) {
            if (!(el as any).__audioPlaying || isNew) {
              // First sync: seek to correct position, set speed, and start playing
              const target = computeTarget(el, next)
              el.currentTime = target
              el.playbackRate = desiredRate
              if (!c.reversed) {
                el.play().catch(() => {})
                ;(el as any).__audioPlaying = true
                ;(el as any).__lastPlayRetry = 0
              }
            } else {
              // Already playing — minimal intervention
              if (el.playbackRate !== desiredRate) el.playbackRate = desiredRate
              if (c.reversed) {
                if (!el.paused) el.pause()
              } else {
                const target = computeTarget(el, next)
                const drift = Math.abs(el.currentTime - target)
                if (drift > 1.5) {
                  el.currentTime = target
                }
                // Resume if browser auto-paused — but with backoff to avoid choppiness
                if (el.paused) {
                  const now = timestamp
                  const lastRetry = (el as any).__lastPlayRetry || 0
                  if (now - lastRetry > 500) {
                    ;(el as any).__lastPlayRetry = now
                    el.play().catch(() => {})
                  }
                }
              }
            }
          } else if (!(el as any).__awaitingCanplay) {
            (el as any).__awaitingCanplay = true
            const onCanPlay = () => {
              el!.removeEventListener('canplay', onCanPlay)
              ;(el as any).__awaitingCanplay = false
              if (!isPlayingRef.current) return
              const freshTime = playbackTimeRef.current
              const target = computeTarget(el!, freshTime)
              el!.currentTime = target
              el!.playbackRate = desiredRate
              if (!c.reversed) {
                el!.play().catch(() => {})
                ;(el as any).__audioPlaying = true
                ;(el as any).__lastPlayRetry = 0
              }
            }
            el.addEventListener('canplay', onCanPlay)
          }
        }
      }
      
      // ── 4. Direct DOM updates for playhead (no React re-render) ──
      const pps = zoom * 100 // pixelsPerSecond
      const px = `${next * pps}px`
      if (playheadRulerRef.current) playheadRulerRef.current.style.left = px
      // Update the overlay playhead (scroll-adjusted, positioned on the wrapper)
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
      
      // ── 6. Throttled React state sync for UI ──
      // During dissolves, update React state much more frequently (~30fps) so the
      // crossDissolveState opacity crossfade is smooth. Otherwise use ~4fps.
      const updateInterval = dissolveInfo ? DISSOLVE_STATE_UPDATE_INTERVAL : STATE_UPDATE_INTERVAL
      if (timestamp - lastStateUpdateRef.current >= updateInterval) {
        lastStateUpdateRef.current = timestamp
        setCurrentTime(next)
        // Push active clip id to React so the monitor visibility stays correct
        setPlaybackActiveClipId(rafActiveClipIdRef.current)
      }
      
      animFrameId = requestAnimationFrame(tick)
    }
    
    // Sync the ref to where the user last scrubbed/seeked so first tick starts there
    playbackTimeRef.current = currentTime

    // Pre-seek all active audio elements to the correct starting position
    {
      const allClips = clipsRef.current
      const trks = tracksRef.current
      for (const c of allClips) {
        if (c.type === 'adjustment' || c.type === 'text' || c.type === 'image') continue
        if (currentTime < c.startTime || currentTime >= c.startTime + c.duration) continue
        if (trks[c.trackIndex]?.enabled === false) continue
        if (c.type === 'video' && (!c.linkedClipIds || !c.linkedClipIds.some(lid => allClips.some(ac => ac.id === lid && ac.type === 'audio')))) continue

        const el = audioElementsRef.current.get(c.id)
        if (el && el.readyState >= 2) {
          const assetDur = el.duration || c.duration
          const timeInClip = currentTime - c.startTime
          const target = c.reversed
            ? Math.max(0, assetDur - c.trimEnd - timeInClip * c.speed)
            : Math.max(0, c.trimStart + timeInClip * c.speed)
          el.currentTime = target
        }
      }
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
      // Final sync: push authoritative time to React state
      setCurrentTime(playbackTimeRef.current)
      setPlaybackActiveClipId(null) // reset so React falls back to activeClip
      rafActiveClipIdRef.current = null
      // Pause all hidden audio elements and reset sync flags
      for (const [, el] of audioElementsRef.current) {
        if (!el.paused) el.pause()
        ;(el as any).__audioPlaying = false
      }
    }
  }, [isPlaying, totalDuration, shuttleSpeed, playingInOut, inPoint, outPoint, zoom])
  
  // Clear In/Out loop mode when playback stops
  useEffect(() => {
    if (!isPlaying && playingInOut) {
      setPlayingInOut(false)
    }
  }, [isPlaying, playingInOut])
  
  // Auto-scroll timeline to keep playhead visible during playback
  // NOTE: During playback the rAF engine handles auto-scroll directly (faster).
  // This effect only handles non-playing scrub/seek scenarios.
  useEffect(() => {
    if (isPlaying) return // rAF engine handles this
    const container = trackContainerRef.current
    if (!container) return
    
    // no-op when not scrubbing (avoid jittery scroll when idle)
  }, [isPlaying, currentTime, pixelsPerSecond])
  
  // Center view on playhead after zoom change (triggered by +/- keys)
  useEffect(() => {
    if (!centerOnPlayheadRef.current) return
    centerOnPlayheadRef.current = false
    
    const container = trackContainerRef.current
    if (!container) return
    
    const playheadX = currentTime * pixelsPerSecond
    const centerScroll = playheadX - container.clientWidth / 2
    container.scrollLeft = Math.max(0, centerScroll)
    
    // Sync ruler
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
  }, [pixelsPerSecond, currentTime])
  
  // Helper: resolve the playback URL for a clip (inline, safe to call in effects)
  // --- Video pool management for gapless playback ---
  // Collect all unique video source URLs used in the timeline
  const timelineVideoSources = useMemo(() => {
    const srcSet = new Set<string>()
    for (const clip of clips) {
      if (clip.type === 'audio' || clip.asset?.type !== 'video') continue
      const src = resolveClipSrc(clip)
      if (src) srcSet.add(src)
    }
    return srcSet
  }, [clips, resolveClipSrc])
  
  // Maintain the video pool: create/remove <video> elements as sources change
  // Eagerly attach ALL pool videos to the DOM so they begin buffering immediately.
  useEffect(() => {
    const pool = videoPoolRef.current
    const container = document.getElementById('video-pool-container')
    
    // Add new sources
    for (const src of timelineVideoSources) {
      if (!pool.has(src)) {
        const video = document.createElement('video')
        video.preload = 'auto'
        video.playsInline = true
        video.muted = true // will be unmuted when active
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:0;pointer-events:none;'
        video.src = src
        video.load()
        pool.set(src, video)
        // Eagerly attach to DOM so the browser starts decoding
        if (container) container.appendChild(video)
      }
    }
    
    // Remove sources no longer in timeline (keep pool clean)
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
  
  // Apply playback resolution to pool video elements
  // CSS trick: shrink the video element's rendered size so the browser decodes at lower res
  useEffect(() => {
    const pool = videoPoolRef.current
    for (const [, video] of pool) {
      if (playbackResolution < 1) {
        // Scale the video element down, then scale the container up via CSS transform
        // This reduces actual pixel decode work
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
  }, [playbackResolution, timelineVideoSources]) // re-apply when pool changes
  
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
  
  // Sync preview video with timeline using the video pool
  // NOTE: During playback the rAF engine handles video sync directly for zero-latency.
  // This useEffect only runs when NOT playing (scrubbing, seeking, clip changes).
  useEffect(() => {
    if (isPlaying) return // rAF engine handles sync during playback
    
    // During cross-dissolve, sync the incoming video overlay (previewVideoRef).
    // The outgoing clip continues to be handled by the pool below.
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
      // Don't return — fall through to sync the outgoing clip via the pool
    }
    
    const pool = videoPoolRef.current
    
    // Determine which clip to sync
    const syncClip = activeClip
    if (!syncClip || syncClip.asset?.type !== 'video') {
      // No video clip — pause the current pool video but keep last frame
      const curVid = pool.get(activePoolSrcRef.current)
      if (curVid && !curVid.paused) curVid.pause()
      return
    }
    
    const clipSrc = resolveClipSrc(syncClip)
    if (!clipSrc) return
    
    // Get or create the video element for this source
    let video = pool.get(clipSrc)
    if (!video) {
      video = document.createElement('video')
      video.preload = 'auto'
      video.playsInline = true
      video.muted = true
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:0;'
      video.src = clipSrc
      video.load()
      pool.set(clipSrc, video)
    }
    
    // Attach to the container if not already
    const container = document.getElementById('video-pool-container')
    if (container && !video.parentElement) {
      container.appendChild(video)
    }
    
    // Switch visibility: hide previous, show current
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
    
    // During dissolve, previewVideoRef points to the incoming JSX video — don't overwrite it
    if (!crossDissolveState) {
      ;(previewVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = video
    }
    
    const timeInClip = currentTime - syncClip.startTime
    
    const syncVideo = (forceSeek: boolean) => {
      if (!video) return
      
      // Always mute video elements — audio comes exclusively from audio tracks
      video.muted = true
      video.volume = 0
      
      // If duration isn't available yet, force a brief play/pause to render the first frame
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
          // Nudge by a tiny amount when at the exact same position to force Chromium to decode the frame
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
      // Always force seek when video just loaded — ensures first frame renders
      const onLoaded = () => syncVideo(true)
      video.addEventListener('loadeddata', onLoaded, { once: true })
      if (container) {
        for (const [, v] of pool) {
          if (!v.parentElement) container.appendChild(v)
        }
      }
      // Store ref for cleanup
      ;(video as any).__syncOnLoad = onLoaded
    }
    
    return () => {
      if (video && (video as any).__syncOnLoad) {
        video.removeEventListener('loadeddata', (video as any).__syncOnLoad)
        delete (video as any).__syncOnLoad
      }
    }
  }, [currentTime, isPlaying, activeClip, crossDissolveState, tracks, resolveClipSrc])
  
  // Outgoing dissolve clip is handled by the video pool — no separate sync needed.
  
  // Sync audio for ALL layers: audio clips + video clips with audio content.
  // All audio plays through hidden <audio> elements (video <video> elements stay muted).
  // This effect only handles scrubbing / seeking (when NOT playing).
  
  useEffect(() => {
    // During playback, the rAF loop handles audio sync directly for zero-latency.
    // This effect only handles scrubbing / seeking (when NOT playing).
    if (isPlaying) return

    // Reset sync flags so the rAF loop does a fresh seek+play on next playback start.
    for (const [, el] of audioElementsRef.current) {
      ;(el as any).__audioPlaying = false
    }

    // Helper to get the live URL for a clip (from project context, respecting takes)
    const getAudioClipUrl = (clip: TimelineClip): string | null => {
      if (clip.assetId) {
        const liveAsset = assets.find(a => a.id === clip.assetId)
        if (liveAsset) {
          if (liveAsset.takes && liveAsset.takes.length > 0 && clip.takeIndex !== undefined) {
            const idx = Math.max(0, Math.min(clip.takeIndex, liveAsset.takes.length - 1))
            return liveAsset.takes[idx].url
          }
          return liveAsset.url
        }
      }
      return clip.asset?.url || clip.importedUrl || null
    }

    // Pre-create audio elements for audio clips and video clips that have linked audio.
    // Video clips without a linked audio clip (e.g. added with audio tracks unpatched)
    // should not produce any audio output.
    const allAudioClips = clips.filter(c => {
      if (c.type === 'adjustment' || c.type === 'text' || c.type === 'image') return false
      if (!getAudioClipUrl(c)) return false
      if (c.type === 'video' && (!c.linkedClipIds || !c.linkedClipIds.some(lid => clips.some(ac => ac.id === lid && ac.type === 'audio')))) return false
      return true
    })
    const allAudioClipIds = new Set(allAudioClips.map(c => c.id))

    // Remove elements for clips that no longer exist on the timeline
    for (const [id, el] of audioElementsRef.current) {
      if (!allAudioClipIds.has(id)) {
        el.pause()
        el.src = ''
        audioElementsRef.current.delete(id)
      }
    }

    // Track which clip IDs are at the playhead for selective pause
    const atPlayheadIds = new Set<string>()

    // Pre-create / seek audio elements
    for (const clip of allAudioClips) {
      const clipUrl = getAudioClipUrl(clip)!
      let el = audioElementsRef.current.get(clip.id)

      if (!el) {
        el = document.createElement('audio')
        el.src = clipUrl
        ;(el as any).__intendedSrc = clipUrl
        el.preload = 'auto'
        audioElementsRef.current.set(clip.id, el)
      } else if ((el as any).__intendedSrc !== clipUrl && clipUrl) {
        el.src = clipUrl
        ;(el as any).__intendedSrc = clipUrl
      }

      const isAtPlayhead = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
      if (!isAtPlayhead) continue
      atPlayheadIds.add(clip.id)

      const liveAsset = clip.assetId ? assets.find(a => a.id === clip.assetId) : null
      const assetDuration = liveAsset?.duration || clip.asset?.duration || clip.duration
      const timeInClip = currentTime - clip.startTime
      const targetTime = clip.reversed
        ? Math.max(0, assetDuration - clip.trimEnd - timeInClip * clip.speed)
        : Math.max(0, clip.trimStart + timeInClip * clip.speed)

      const anySoloedScrub = tracks.some(t => t.solo)
      const scrubTrack = tracks[clip.trackIndex]
      const isSoloMutedScrub = anySoloedScrub && !scrubTrack?.solo
      el.muted = clip.muted || scrubTrack?.muted || isSoloMutedScrub || false
      el.volume = clip.volume

      // Audio scrubbing: seek and play a short snippet at the current position.
      // Only trigger when the playhead actually moved (not on re-renders with same time).
      if (el.readyState >= 2 && lastScrubTimeRef.current !== currentTime) {
        el.currentTime = targetTime
        el.play().catch(() => {})
        // Clear any previous scrub timeout and set a new one
        if (scrubAudioTimerRef.current) clearTimeout(scrubAudioTimerRef.current)
        scrubAudioTimerRef.current = setTimeout(() => {
          // Don't pause if playback started mid-scrub
          if (!isPlayingRef.current && !el.paused) el.pause()
          scrubAudioTimerRef.current = null
        }, 80)
      } else if (el.readyState >= 2 && Math.abs(el.currentTime - targetTime) > 0.05) {
        // Just seek without playing (same position re-render)
        el.currentTime = targetTime
      }
    }

    // Pause elements NOT at playhead (don't touch scrubbing ones at playhead)
    for (const [id, el] of audioElementsRef.current) {
      if (!atPlayheadIds.has(id) && !el.paused) {
        el.pause()
      }
    }

    lastScrubTimeRef.current = currentTime
  }, [currentTime, isPlaying, clips, tracks, assets])
  
  // Clean up all audio elements and scrub timer on unmount
  useEffect(() => {
    return () => {
      if (scrubAudioTimerRef.current) clearTimeout(scrubAudioTimerRef.current)
      for (const [, el] of audioElementsRef.current) {
        el.pause()
        el.src = ''
      }
      audioElementsRef.current.clear()
    }
  }, [])

  return { audioElementsRef }
}
