import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { TimelineClip, Track, SubtitleClip } from '../../types/project'
import { DEFAULT_SUBTITLE_STYLE } from '../../types/project'
import { buildExportClips } from './video-editor-utils'

export type PreviewStatus = 'stale' | 'rendering' | 'ready'

export interface UseRenderedPreviewParams {
  clips: TimelineClip[]
  tracks: Track[]
  subtitles?: SubtitleClip[]
  inPoint: number | null
  outPoint: number | null
  fps: number
  width: number
  height: number
  letterbox?: { ratio: number; color: string; opacity: number } | null
  resolveClipSrc: (clip: TimelineClip) => string
}

export interface UseRenderedPreviewReturn {
  previewStatus: PreviewStatus
  renderedVideoUrl: string | null
  renderProgress: number
  forceRender: () => void
  cancelRender: () => void
}

const IDLE_TIMEOUT_MS = 3000

export function useRenderedPreview(params: UseRenderedPreviewParams): UseRenderedPreviewReturn {
  const { clips, tracks, subtitles, inPoint, outPoint, resolveClipSrc } = params

  const [status, setStatus] = useState<PreviewStatus>('stale')
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null)
  const [renderProgress, setRenderProgress] = useState(0)

  const serialRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRenderingRef = useRef(false)

  // Keep latest params in refs so triggerRender always reads fresh values
  const paramsRef = useRef(params)
  paramsRef.current = params

  // Fingerprint: only actual edit data, NOT playhead position, NOT mouse/keyboard
  const fingerprint = useMemo(() => {
    return JSON.stringify({
      clips: clips.map(c => ({
        id: c.id, startTime: c.startTime, duration: c.duration,
        trimStart: c.trimStart, speed: c.speed, reversed: c.reversed,
        trackIndex: c.trackIndex, type: c.type, volume: c.volume,
        muted: c.muted, flipH: c.flipH, flipV: c.flipV,
        opacity: c.opacity,
        resolvedUrl: resolveClipSrc(c),
        hiddenByStack: c.hiddenByStack,
      })),
      tracks: tracks.map(t => ({ enabled: t.enabled, muted: t.muted, solo: t.solo })),
      subtitles: subtitles?.map(s => ({ id: s.id, text: s.text, startTime: s.startTime, endTime: s.endTime })),
      inPoint, outPoint,
    })
  }, [clips, tracks, subtitles, inPoint, outPoint, resolveClipSrc])

  // Stable render function that reads from refs (no stale closures)
  const triggerRender = useCallback(async () => {
    if (isRenderingRef.current) {
      window.electronAPI?.previewCancel().catch(() => {})
    }

    const currentSerial = serialRef.current
    isRenderingRef.current = true
    setStatus('rendering')
    setRenderProgress(0)

    try {
      const p = paramsRef.current
      const exportClips = buildExportClips(p.clips, p.tracks, p.inPoint, p.outPoint, p.resolveClipSrc)
      if (exportClips.length === 0) {
        setStatus('stale')
        isRenderingRef.current = false
        return
      }

      // Build subtitle data
      const rangeStart = (p.inPoint != null && p.outPoint != null) ? Math.min(p.inPoint, p.outPoint) : 0
      const rangeEnd = (p.inPoint != null && p.outPoint != null) ? Math.max(p.inPoint, p.outPoint) : Infinity
      const subtitleData = p.subtitles
        ? p.subtitles
            .filter(sub => sub.endTime > rangeStart && sub.startTime < rangeEnd)
            .map(sub => {
              const track = p.tracks[sub.trackIndex]
              const style = { ...DEFAULT_SUBTITLE_STYLE, ...(track?.subtitleStyle || {}), ...sub.style }
              return {
                text: sub.text,
                startTime: Math.max(0, sub.startTime - rangeStart),
                endTime: Math.min(rangeEnd - rangeStart, sub.endTime - rangeStart),
                style,
              }
            })
        : []

      const result = await window.electronAPI?.previewRender({
        clips: exportClips,
        width: p.width,
        height: p.height,
        fps: p.fps,
        letterbox: p.letterbox || undefined,
        subtitles: subtitleData.length > 0 ? subtitleData : undefined,
      })

      // Check if timeline changed during render
      if (serialRef.current !== currentSerial) {
        if (result?.filePath) {
          window.electronAPI?.previewCleanup(result.filePath).catch(() => {})
        }
        isRenderingRef.current = false
        return
      }

      if (result?.success && result.fileUrl) {
        setRenderedVideoUrl(result.fileUrl)
        setStatus('ready')
        setRenderProgress(100)
      } else {
        console.error('[preview] Render failed:', result?.error)
        setStatus('stale')
      }
    } catch (err) {
      console.error('[preview] Render error:', err)
      if (serialRef.current === currentSerial) {
        setStatus('stale')
      }
    } finally {
      isRenderingRef.current = false
    }
  }, [])

  // When fingerprint changes → go stale, debounce 3s, then auto-render.
  // NO mousemove/keydown listeners — only actual edits trigger re-render.
  useEffect(() => {
    serialRef.current += 1

    // Cancel any active render
    if (isRenderingRef.current) {
      window.electronAPI?.previewCancel().catch(() => {})
      isRenderingRef.current = false
    }

    setStatus('stale')
    setRenderedVideoUrl(null)
    setRenderProgress(0)

    // Simple debounce: render after 3s of no further edits
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      triggerRender()
    }, IDLE_TIMEOUT_MS)

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [fingerprint, triggerRender])

  // Listen for preview progress events
  useEffect(() => {
    const cleanup = window.electronAPI?.onPreviewProgress((_event: unknown, data: { phase: string; percent: number }) => {
      if (isRenderingRef.current) {
        setRenderProgress(data.percent)
      }
    })
    return () => { cleanup?.() }
  }, [])

  const forceRender = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    triggerRender()
  }, [triggerRender])

  const cancelRender = useCallback(() => {
    if (isRenderingRef.current) {
      window.electronAPI?.previewCancel().catch(() => {})
      isRenderingRef.current = false
      setStatus('stale')
      setRenderProgress(0)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRenderingRef.current) {
        window.electronAPI?.previewCancel().catch(() => {})
      }
      window.electronAPI?.previewCleanup().catch(() => {})
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  return {
    previewStatus: status,
    renderedVideoUrl,
    renderProgress,
    forceRender,
    cancelRender,
  }
}
