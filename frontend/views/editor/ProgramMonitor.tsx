import React from 'react'
import {
  Layers, Video, ChevronDown,
  ChevronLeft, ChevronRight, Pause, Play, Repeat,
  Expand, Shrink,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Tooltip } from '../../components/ui/tooltip'
import { DEFAULT_SUBTITLE_STYLE } from '../../types/project'
import type { TimelineClip, Track, SubtitleClip } from '../../types/project'
import { getClipEffectStyles, getTransitionBgColor, formatTime, getShortcutLabel, tooltipLabel, getMaskedEffectOverlays } from './video-editor-utils'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'

export interface ProgramMonitorProps {
  // Layout
  showSourceMonitor: boolean
  activePanel: 'source' | 'timeline'
  sourceSplitPercent: number
  setActivePanel: (panel: 'source' | 'timeline') => void

  // Refs (parent owns these for playback/effects logic)
  previewContainerRef: React.RefObject<HTMLDivElement | null>
  previewVideoRef: React.RefObject<HTMLVideoElement | null>
  previewImageRef: React.RefObject<HTMLImageElement | null>
  dissolveOutVideoRef: React.RefObject<HTMLVideoElement | null>
  previewPanRef: React.MutableRefObject<{ dragging: boolean; startX: number; startY: number; startPanX: number; startPanY: number }>

  // Playback state
  currentTime: number
  totalDuration: number
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>

  // Clips & effects data
  clips: TimelineClip[]
  tracks: Track[]
  activeClip: TimelineClip | undefined
  monitorClip: TimelineClip | undefined
  clipPlaybackOffset: number
  crossDissolveState: { outgoing: TimelineClip; incoming: TimelineClip; progress: number } | null
  activeSubtitles: SubtitleClip[]
  activeTextClips: TimelineClip[]
  activeLetterbox: { ratio: number; color: string; opacity: number } | null
  activeAdjustmentEffects: Array<{
    clip: TimelineClip
    filterStyle: React.CSSProperties
    hasVignette: boolean
    vignetteAmount: number
    hasGrain: boolean
    grainAmount: number
  }>

  // Compositing (clips underneath active clip when it has opacity < 100%)
  compositingStack: TimelineClip[]

  // Helpers
  getClipUrl: (clip: TimelineClip) => string | null

  // Text overlay interaction
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  showPropertiesPanel: boolean
  setShowPropertiesPanel: (v: boolean) => void

  // In/Out & transport
  inPoint: number | null
  outPoint: number | null
  setInPoint: (updater: (prev: number | null) => number | null) => void
  setOutPoint: (updater: (prev: number | null) => number | null) => void
  setDraggingMarker: React.Dispatch<React.SetStateAction<'timelineIn' | 'timelineOut' | 'sourceIn' | 'sourceOut' | null>>
  playingInOut: boolean
  setPlayingInOut: (v: boolean) => void
  shuttleSpeed: number
  setShuttleSpeed: (v: number | ((prev: number) => number)) => void

  // Preview zoom/pan
  previewZoom: number | 'fit'
  setPreviewZoom: React.Dispatch<React.SetStateAction<number | 'fit'>>
  previewPan: { x: number; y: number }
  setPreviewPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  previewZoomOpen: boolean
  setPreviewZoomOpen: React.Dispatch<React.SetStateAction<boolean>>
  videoFrameSize: { width: number; height: number }
  playbackResolution: 1 | 0.5 | 0.25
  setPlaybackResolution: (v: 1 | 0.5 | 0.25) => void
  playbackResOpen: boolean
  setPlaybackResOpen: React.Dispatch<React.SetStateAction<boolean>>
  isFullscreen: boolean
  toggleFullscreen: () => void

  // Keyboard shortcuts
  kbLayout: KeyboardLayout
}

export function ProgramMonitor({
  showSourceMonitor,
  activePanel,
  sourceSplitPercent,
  setActivePanel,
  previewContainerRef,
  previewVideoRef,
  previewImageRef,
  previewPanRef,
  currentTime,
  totalDuration,
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  clips,
  tracks,
  activeClip,
  monitorClip,
  clipPlaybackOffset,
  crossDissolveState,
  activeSubtitles,
  activeTextClips,
  activeLetterbox,
  activeAdjustmentEffects,
  compositingStack,
  getClipUrl,
  selectedClipIds,
  setSelectedClipIds,
  setClips,
  showPropertiesPanel,
  setShowPropertiesPanel,
  inPoint,
  outPoint,
  setInPoint,
  setOutPoint,
  setDraggingMarker,
  playingInOut,
  setPlayingInOut,
  setShuttleSpeed,
  previewZoom,
  setPreviewZoom,
  previewPan,
  setPreviewPan,
  previewZoomOpen,
  setPreviewZoomOpen,
  videoFrameSize,
  playbackResolution,
  setPlaybackResolution,
  playbackResOpen,
  setPlaybackResOpen,
  isFullscreen,
  toggleFullscreen,
  kbLayout,
}: ProgramMonitorProps) {
  // Flag to prevent the video frame wrapper's onClick from clearing selection
  // when the user clicked on a text overlay (mousedown fires first on the overlay,
  // but click may bubble up to the wrapper if the mouse moved slightly).
  const clickedTextOverlayRef = React.useRef(false)

  // Sync mask video elements to the pool video's currentTime on every time update
  React.useEffect(() => {
    if (!activeClip || activeClip.asset?.type !== 'video') return
    const overlays = getMaskedEffectOverlays(activeClip)
    if (overlays.length === 0) return
    const poolVideo = document.getElementById('video-pool-container')?.querySelector('video') as HTMLVideoElement | null
    if (!poolVideo) return
    for (const overlay of overlays) {
      const maskVideo = document.getElementById(`mask-video-${overlay.effectId}`) as HTMLVideoElement | null
      if (maskVideo && Math.abs(maskVideo.currentTime - poolVideo.currentTime) > 0.04) {
        maskVideo.currentTime = poolVideo.currentTime
      }
    }
  }, [currentTime, activeClip])

  // Compositing stack video sync is handled by ref callbacks on each <video> element above

  return (
    <div
        className={`flex flex-col ${showSourceMonitor ? '' : 'flex-1'} min-w-0 min-h-0 ${showSourceMonitor && activePanel === 'timeline' ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
        style={showSourceMonitor ? { width: `${100 - sourceSplitPercent}%` } : undefined}
        onMouseDown={() => setActivePanel('timeline')}
      >
        {/* Header (only when split view) */}
        {showSourceMonitor && (
          <div className="h-7 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 flex-shrink-0">
            <span className="text-[11px] font-semibold text-zinc-400 tracking-wide">Timeline Viewer</span>
          </div>
        )}
        {/* Preview (existing) */}
        <div
          ref={previewContainerRef as React.RefObject<HTMLDivElement>}
          className={`flex-1 relative overflow-hidden min-h-0 min-w-0 ${isFullscreen ? 'bg-black' : ''}`}
          style={{ backgroundColor: isFullscreen ? '#000' : '#333', ...(previewZoom !== 'fit' ? { cursor: 'grab' } : {}) }}
          onMouseDown={(e) => {
            if (previewZoom === 'fit') return
            if (e.button !== 0 && e.button !== 1) return
            previewPanRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: previewPan.x, startPanY: previewPan.y }
          }}
          onMouseMove={(e) => {
            if (!previewPanRef.current.dragging) return
            setPreviewPan({
              x: previewPanRef.current.startPanX + (e.clientX - previewPanRef.current.startX),
              y: previewPanRef.current.startPanY + (e.clientY - previewPanRef.current.startY),
            })
          }}
          onMouseUp={() => { previewPanRef.current.dragging = false }}
          onMouseLeave={() => { previewPanRef.current.dragging = false }}
        >
          {clips.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-48 h-28 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center mb-4 mx-auto">
                  <Layers className="h-8 w-8 text-zinc-600 mb-2" />
                  <p className="text-zinc-500 text-xs">Drop clips here</p>
                </div>
                <p className="text-zinc-600 text-xs">Click assets or drag them to the timeline</p>
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={previewZoom !== 'fit' ? {
                transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${(previewZoom as number) / 100})`,
                transformOrigin: 'center center',
              } : undefined}
            >
              {/* Video frame wrapper — black bg with exact 16:9 dimensions */}
              <div
                className="relative bg-black overflow-hidden"
                style={videoFrameSize.width > 0 ? { width: videoFrameSize.width, height: videoFrameSize.height } : { width: '100%', aspectRatio: '16/9' }}
                onClick={() => {
                  if (clickedTextOverlayRef.current) {
                    return
                  }
                  setSelectedClipIds(new Set())
                }}
              >
              {(() => {
                // Always render the normal clip path — the pool handles the outgoing/active clip.
                // During dissolve, overlay the incoming clip on top with fading opacity.
                const dissolveOutOpacity = crossDissolveState
                  ? (1 - crossDissolveState.progress) * ((crossDissolveState.outgoing.opacity ?? 100) / 100)
                  : undefined
                return (
                <>
                  {/* Compositing: render clips from lower tracks underneath the active clip */}
                  {compositingStack.map(lowerClip => {
                    const lowerOffset = currentTime - lowerClip.startTime
                    const lowerStyles = getClipEffectStyles(lowerClip, lowerOffset)
                    const lowerSrc = getClipUrl(lowerClip) || lowerClip.asset?.url || lowerClip.importedUrl || ''
                    if (lowerClip.asset?.type === 'image' || lowerClip.type === 'image') {
                      return (
                        <img
                          key={`comp-${lowerClip.id}`}
                          src={lowerSrc}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
                          style={lowerStyles}
                        />
                      )
                    }
                    // Video clip on a lower track — use ref to force frame decoding
                    const timeInClip = Math.max(0, currentTime - lowerClip.startTime)
                    return (
                      <video
                        key={`comp-${lowerClip.id}`}
                        id={`comp-video-${lowerClip.id}`}
                        src={lowerSrc}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
                        style={lowerStyles}
                        muted
                        playsInline
                        preload="auto"
                        ref={(el) => {
                          if (!el) return
                          el.muted = true
                          const seekToFrame = () => {
                            if (!el.duration || isNaN(el.duration)) return
                            const vd = el.duration
                            const usable = vd - (lowerClip.trimStart || 0) - (lowerClip.trimEnd || 0)
                            const target = lowerClip.reversed
                              ? Math.max(0, Math.min(vd, (lowerClip.trimStart || 0) + usable - timeInClip * (lowerClip.speed || 1)))
                              : Math.max(0, Math.min(vd, (lowerClip.trimStart || 0) + timeInClip * (lowerClip.speed || 1)))
                            if (Math.abs(el.currentTime - target) > 0.04) {
                              el.currentTime = target
                            }
                          }
                          if (el.readyState >= 2) {
                            seekToFrame()
                          } else {
                            el.addEventListener('loadeddata', () => {
                              seekToFrame()
                            }, { once: true })
                          }
                        }}
                      />
                    )
                  })}

                  {/* Transition background overlay */}
                  {activeClip && (() => {
                    const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
                    const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
                    const bg = tInBg || tOutBg
                    if (!bg) return null
                    const effectStyles = getClipEffectStyles(activeClip, clipPlaybackOffset)
                    const overlayOpacity = effectStyles.opacity !== undefined ? 1 - (effectStyles.opacity as number) : 0
                    return overlayOpacity > 0 ? (
                      <div className="absolute inset-0 z-10 pointer-events-none" style={{ backgroundColor: bg, opacity: overlayOpacity }} />
                    ) : null
                  })()}
                  {/* Video pool container — during dissolve, fade out with progress */}
                  <div
                    id="video-pool-container"
                    className={`absolute inset-0 w-full h-full pointer-events-none z-[2] ${!isPlaying && monitorClip?.asset?.type !== 'video' ? 'hidden' : ''}`}
                    style={monitorClip?.asset?.type === 'video' ? {
                      ...getClipEffectStyles(monitorClip, clipPlaybackOffset),
                      ...(dissolveOutOpacity !== undefined ? { opacity: dissolveOutOpacity } : {}),
                    } : undefined}
                  />

                  {activeClip?.asset?.type === 'image' && (
                    <img
                      ref={previewImageRef as React.RefObject<HTMLImageElement>}
                      src={getClipUrl(activeClip) || activeClip.asset.url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-contain z-[2]"
                      style={{
                        ...getClipEffectStyles(activeClip, clipPlaybackOffset),
                        ...(dissolveOutOpacity !== undefined ? { opacity: dissolveOutOpacity } : {}),
                      }}
                    />
                  )}

                  {/* Cross-dissolve incoming clip overlay */}
                  {crossDissolveState && (() => {
                    const { incoming, progress } = crossDissolveState
                    const inOffset = currentTime - incoming.startTime
                    const inOpacity = progress * ((incoming.opacity ?? 100) / 100)
                    const inStyle = { ...getClipEffectStyles(incoming, inOffset), opacity: inOpacity }
                    const inSrc = getClipUrl(incoming) || incoming.asset?.url || ''
                    if (incoming.asset?.type === 'video') {
                      return (
                        <video
                          ref={previewVideoRef as React.RefObject<HTMLVideoElement>}
                          key={`dissolve-in-${incoming.id}`}
                          src={inSrc}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                          style={inStyle}
                          playsInline
                          muted
                          preload="auto"
                        />
                      )
                    }
                    if (incoming.asset?.type === 'image') {
                      return (
                        <img
                          key={`dissolve-in-${incoming.id}`}
                          src={inSrc}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                          style={inStyle}
                        />
                      )
                    }
                    return null
                  })()}

                  {/* EFFECTS HIDDEN - masked effect overlays, vignette, and grain hidden because effects are not applied during export */}

                  {/* Black screen when no video/image clip is visible (audio-only or empty) */}
                  {!monitorClip && (
                    <div className="absolute inset-0 bg-black">
                      {!isPlaying && !clips.some(c =>
                        c.type === 'audio' &&
                        currentTime >= c.startTime &&
                        currentTime < c.startTime + c.duration
                      ) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                            <Video className="h-8 w-8 text-zinc-600" />
                          </div>
                          <p className="text-zinc-500 text-sm">No clip at playhead</p>
                          <p className="text-zinc-600 text-xs mt-1">Move playhead over a clip to preview</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
                )
              })()}

              {/* Adjustment layer effects */}
              {activeAdjustmentEffects.map(({ clip: adjClip, filterStyle, hasVignette, vignetteAmount, hasGrain, grainAmount }) => {
                const backdropFilter = filterStyle.filter && filterStyle.filter !== 'none' ? String(filterStyle.filter) : undefined
                return (
                  <React.Fragment key={`adj-fx-${adjClip.id}`}>
                    {backdropFilter && (
                      <div
                        className="absolute inset-0 z-[22] pointer-events-none"
                        style={{ backdropFilter, WebkitBackdropFilter: backdropFilter }}
                      />
                    )}
                    {hasVignette && (
                      <div
                        className="absolute inset-0 z-[22] pointer-events-none"
                        style={{
                          background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${vignetteAmount}) 100%)`,
                        }}
                      />
                    )}
                    {hasGrain && (
                      <canvas
                        ref={(canvas) => {
                          if (!canvas) return
                          const ctx = canvas.getContext('2d')
                          if (!ctx) return
                          const w = canvas.width = 256
                          const h = canvas.height = 256
                          const imageData = ctx.createImageData(w, h)
                          for (let i = 0; i < imageData.data.length; i += 4) {
                            const v = Math.random() * 255
                            imageData.data[i] = v
                            imageData.data[i + 1] = v
                            imageData.data[i + 2] = v
                            imageData.data[i + 3] = (grainAmount / 100) * 80
                          }
                          ctx.putImageData(imageData, 0, 0)
                        }}
                        className="absolute inset-0 z-[22] pointer-events-none w-full h-full"
                        style={{ mixBlendMode: 'overlay', imageRendering: 'pixelated' }}
                      />
                    )}
                  </React.Fragment>
                )
              })}

              {/* Text overlay clips */}
              {activeTextClips.map(tc => {
                const ts = tc.textStyle!
                const isSelected = selectedClipIds.has(tc.id)
                return (
                  <div
                    key={`text-${tc.id}`}
                    className={`absolute z-[24] ${isSelected ? 'ring-2 ring-cyan-400/60 ring-offset-1 ring-offset-transparent' : ''}`}
                    style={{
                      left: `${ts.positionX}%`,
                      top: `${ts.positionY}%`,
                      transform: 'translate(-50%, -50%)',
                      maxWidth: ts.maxWidth > 0 ? `${ts.maxWidth}%` : undefined,
                      opacity: ts.opacity / 100,
                      pointerEvents: 'auto',
                      cursor: 'move',
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      clickedTextOverlayRef.current = true
                      setSelectedClipIds(new Set([tc.id]))
                      // Capture panel state at mousedown time so we can restore it after any
                      // spurious onClick handlers that might close it
                      const wasOpen = showPropertiesPanel
                      const clipId = tc.id
                      const container = (e.currentTarget.parentElement as HTMLElement)
                      if (!container) return
                      const rect = container.getBoundingClientRect()
                      const onMove = (ev: MouseEvent) => {
                        const px = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100))
                        const py = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100))
                        setClips(prev => prev.map(c =>
                          c.id === tc.id && c.textStyle
                            ? { ...c, textStyle: { ...c.textStyle, positionX: Math.round(px * 10) / 10, positionY: Math.round(py * 10) / 10 } }
                            : c
                        ))
                      }
                      const onUp = () => {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                        // Reset the ref and restore state after all click events have fired
                        requestAnimationFrame(() => {
                          clickedTextOverlayRef.current = false
                          setSelectedClipIds(new Set([clipId]))
                          if (wasOpen) setShowPropertiesPanel(true)
                        })
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setSelectedClipIds(new Set([tc.id]))
                      setShowPropertiesPanel(true)
                    }}
                  >
                    <div
                      style={{
                        fontFamily: ts.fontFamily,
                        fontSize: `${ts.fontSize * 0.05}vh`,
                        fontWeight: ts.fontWeight,
                        fontStyle: ts.fontStyle,
                        color: ts.color,
                        backgroundColor: ts.backgroundColor,
                        textAlign: ts.textAlign,
                        padding: ts.padding > 0 ? `${ts.padding * 0.04}vh` : undefined,
                        borderRadius: ts.borderRadius > 0 ? `${ts.borderRadius}px` : undefined,
                        letterSpacing: ts.letterSpacing !== 0 ? `${ts.letterSpacing}px` : undefined,
                        lineHeight: ts.lineHeight,
                        textShadow: ts.shadowBlur > 0 || ts.shadowOffsetX !== 0 || ts.shadowOffsetY !== 0
                          ? `${ts.shadowOffsetX}px ${ts.shadowOffsetY}px ${ts.shadowBlur}px ${ts.shadowColor}`
                          : undefined,
                        WebkitTextStroke: ts.strokeWidth > 0 && ts.strokeColor !== 'transparent'
                          ? `${ts.strokeWidth}px ${ts.strokeColor}`
                          : undefined,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        userSelect: 'none',
                      }}
                    >
                      {ts.text}
                    </div>
                  </div>
                )
              })}

              {/* Subtitle overlay */}
              {activeSubtitles.length > 0 && (
                <div className="absolute inset-0 z-[25] pointer-events-none flex flex-col justify-end">
                  {activeSubtitles.map(sub => {
                    const track = tracks[sub.trackIndex]
                    const style = { ...DEFAULT_SUBTITLE_STYLE, ...(track?.subtitleStyle || {}), ...sub.style }
                    return (
                      <div
                        key={sub.id}
                        className={`w-full flex ${
                          style.position === 'top' ? 'self-start' : style.position === 'center' ? 'self-center absolute inset-0 items-center justify-center' : 'self-end'
                        }`}
                        style={style.position !== 'center' ? { padding: style.position === 'top' ? '12px 16px 0' : '0 16px 12px' } : undefined}
                      >
                        <span
                          className="inline-block max-w-[90%] text-center mx-auto rounded px-3 py-1.5 leading-snug whitespace-pre-wrap"
                          style={{
                            fontSize: `${style.fontSize}px`,
                            fontFamily: style.fontFamily,
                            fontWeight: style.fontWeight,
                            fontStyle: style.italic ? 'italic' : 'normal',
                            color: style.color,
                            backgroundColor: style.backgroundColor,
                            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                          }}
                        >
                          {sub.text}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Letterbox overlay from adjustment layers */}
              {activeLetterbox && (() => {
                const containerRatio = 16 / 9
                const targetRatio = activeLetterbox.ratio
                if (targetRatio >= containerRatio) {
                  const barPct = ((1 - containerRatio / targetRatio) / 2) * 100
                  return barPct > 0 ? (
                    <>
                      <div
                        className="absolute left-0 right-0 top-0 z-[18] pointer-events-none"
                        style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                      <div
                        className="absolute left-0 right-0 bottom-0 z-[18] pointer-events-none"
                        style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                    </>
                  ) : null
                } else {
                  const barPct = ((1 - targetRatio / containerRatio) / 2) * 100
                  return barPct > 0 ? (
                    <>
                      <div
                        className="absolute top-0 bottom-0 left-0 z-[18] pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                      <div
                        className="absolute top-0 bottom-0 right-0 z-[18] pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                    </>
                  ) : null
                }
              })()}
              {/* EFFECTS HIDDEN - mask shape visual overlay hidden because effects are not applied during export */}
              </div>{/* end video frame wrapper */}

              {/* Transparent overlay to prevent video element default interactions */}
              <div
                className="absolute inset-0 z-20 pointer-events-none"
              />
            </div>
          )}

          {/* Timecode + clip info moved to bottom status bar */}
        </div>

        {/* Program monitor mini scrub bar with IN/OUT markers */}
        {clips.length > 0 && (
          <div className="bg-zinc-900 border-t border-zinc-800 flex-shrink-0 relative px-2 py-1">
            <div
              id="program-scrub-bar"
              className="relative h-5 cursor-pointer group"
              onMouseDown={(e) => {
                const bar = e.currentTarget
                const rect = bar.getBoundingClientRect()
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                const t = pct * totalDuration
                setIsPlaying(false)
                setCurrentTime(t)
                const onMove = (ev: MouseEvent) => {
                  const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                  setCurrentTime(p * totalDuration)
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            >
              {/* Base track */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-zinc-700 rounded-full" />
              {/* Progress fill */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-zinc-500 rounded-full"
                style={{ width: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%' }}
              />
              {/* Dimmed region BEFORE In */}
              {inPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-black/50 rounded-l"
                  style={{ width: `${(inPoint / totalDuration) * 100}%` }}
                />
              )}
              {/* Dimmed region AFTER Out */}
              {outPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 right-0 bg-black/50 rounded-r"
                  style={{ width: `${100 - (outPoint / totalDuration) * 100}%` }}
                />
              )}
              {/* In/Out range highlight */}
              {(inPoint !== null || outPoint !== null) && (
                <div
                  className="absolute top-0 bottom-0 border-t-2 border-b-2 border-blue-400/70 pointer-events-none"
                  style={{
                    left: `${((inPoint ?? 0) / totalDuration) * 100}%`,
                    width: `${(((outPoint ?? totalDuration) - (inPoint ?? 0)) / totalDuration) * 100}%`,
                  }}
                >
                  <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1 bg-blue-400/30 rounded-full" />
                </div>
              )}
              {/* In bracket — draggable */}
              {inPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 flex items-center z-10 cursor-ew-resize"
                  style={{ left: `calc(${(inPoint / totalDuration) * 100}% - 6px)`, width: 12 }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingMarker('timelineIn') }}
                >
                  <div className="w-1 h-full bg-blue-400 rounded-l-sm flex flex-col justify-between py-0.5 pointer-events-none ml-auto">
                    <div className="w-2 h-0.5 bg-blue-400 rounded-r" />
                    <div className="w-2 h-0.5 bg-blue-400 rounded-r" />
                  </div>
                </div>
              )}
              {/* Out bracket — draggable */}
              {outPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 flex items-center z-10 cursor-ew-resize"
                  style={{ left: `${(outPoint / totalDuration) * 100}%`, width: 12 }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingMarker('timelineOut') }}
                >
                  <div className="w-1 h-full bg-blue-400 rounded-r-sm flex flex-col justify-between py-0.5 pointer-events-none">
                    <div className="w-2 h-0.5 bg-blue-400 rounded-l -ml-1" />
                    <div className="w-2 h-0.5 bg-blue-400 rounded-l -ml-1" />
                  </div>
                </div>
              )}
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 z-20 pointer-events-none"
                style={{ left: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%' }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full" />
                <div className="absolute top-1.5 bottom-0 left-1/2 -translate-x-1/2 w-px bg-white" />
              </div>
            </div>
            {/* Timecode labels */}
            {(inPoint !== null || outPoint !== null) && (
              <div className="flex justify-between items-center mt-0.5 h-3">
                <span className="text-[9px] font-mono text-blue-400/80">
                  {inPoint !== null ? `IN ${formatTime(inPoint)}` : ''}
                </span>
                <span className="text-[9px] font-mono text-zinc-500">
                  {inPoint !== null && outPoint !== null ? `Duration: ${formatTime(outPoint - inPoint)}` : ''}
                </span>
                <span className="text-[9px] font-mono text-blue-400/80">
                  {outPoint !== null ? `OUT ${formatTime(outPoint)}` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status bar: timecode | Fit | transport controls | resolution | duration */}
        <div className="h-8 bg-zinc-950 border-t border-zinc-800 flex items-center px-3 flex-shrink-0 gap-2">
          {/* Left: current timecode */}
          <span className="text-[12px] font-mono font-medium text-amber-400 tabular-nums tracking-tight select-none flex-shrink-0">
            {formatTime(currentTime)}
          </span>

          {/* Fit / Zoom dropdown */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewZoomOpen(prev => !prev) }}
              className={`h-6 px-2 rounded text-[11px] font-medium tabular-nums flex items-center gap-1 transition-colors border ${
                previewZoomOpen
                  ? 'bg-zinc-700 text-white border-zinc-600'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {previewZoom === 'fit' ? 'Fit' : `${previewZoom}%`}
              <ChevronDown className="h-3 w-3" />
            </button>
            {previewZoomOpen && (
              <div className="absolute bottom-full left-0 mb-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-[100px] z-50">
                {[
                  { label: 'Fit', value: 'fit' as const },
                  { label: '10%', value: 10 },
                  { label: '25%', value: 25 },
                  { label: '50%', value: 50 },
                  { label: '75%', value: 75 },
                  { label: '100%', value: 100 },
                  { label: '150%', value: 150 },
                  { label: '200%', value: 200 },
                  { label: '400%', value: 400 },
                  { label: '800%', value: 800 },
                ].map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => { setPreviewZoom(opt.value); setPreviewZoomOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                      previewZoom === opt.value
                        ? 'text-blue-300 bg-blue-600/20'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {previewZoom === opt.value && <span className="text-blue-400">&#10003;</span>}
                    <span className={previewZoom === opt.value ? '' : 'ml-5'}>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Center: transport controls — Premiere-style 5-button strip */}
          <div className="flex-1 flex items-center justify-center gap-0.5">
            {/* Set In */}
            <Tooltip content={`${inPoint !== null ? `In: ${formatTime(inPoint)} — ` : ''}${tooltipLabel('Set In point', getShortcutLabel(kbLayout, 'mark.setIn'))}`} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${inPoint !== null ? 'text-yellow-400' : 'text-zinc-500'}`}
                onClick={() => setInPoint(prev => prev !== null && Math.abs(prev - currentTime) < 0.01 ? null : currentTime)}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="7,4 4,4 4,20 7,20" />
                  <line x1="10" y1="12" x2="20" y2="12" />
                  <polyline points="16,8 20,12 16,16" />
                </svg>
              </Button>
            </Tooltip>
            <div className="w-px h-3 bg-zinc-700" />
            {/* Go to In */}
            <Tooltip content={tooltipLabel('Go to In Point', getShortcutLabel(kbLayout, 'transport.goToIn'))} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${inPoint !== null ? 'text-zinc-400' : 'text-zinc-500'}`}
                onClick={() => {
                  const target = inPoint ?? (clips.length > 0 ? Math.min(...clips.map(c => c.startTime)) : 0)
                  setIsPlaying(false); setShuttleSpeed(0); setCurrentTime(target)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="4" x2="4" y2="20" />
                  <line x1="8" y1="12" x2="20" y2="12" />
                  <polyline points="14,7 8,12 14,17" />
                </svg>
              </Button>
            </Tooltip>
            {/* Step Back */}
            <Tooltip content={tooltipLabel('Step Back', getShortcutLabel(kbLayout, 'transport.stepBackward'))} side="top">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-zinc-500"
                onClick={() => { setShuttleSpeed(0); setIsPlaying(false); setCurrentTime(t => Math.max(0, t - 1/24)) }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            {/* Play/Pause toggle */}
            <Tooltip content={isPlaying ? tooltipLabel('Pause', getShortcutLabel(kbLayout, 'transport.playPause')) : tooltipLabel('Play', getShortcutLabel(kbLayout, 'transport.playPause'))} side="top">
              <Button
                variant="ghost" size="icon"
                onClick={() => { setShuttleSpeed(0); setIsPlaying(!isPlaying) }}
                className="h-6 w-6 text-zinc-400"
              >
                {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
              </Button>
            </Tooltip>
            {/* Step Forward */}
            <Tooltip content={tooltipLabel('Step Forward', getShortcutLabel(kbLayout, 'transport.stepForward'))} side="top">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-zinc-500"
                onClick={() => { setShuttleSpeed(0); setIsPlaying(false); setCurrentTime(t => Math.min(totalDuration, t + 1/24)) }}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            {/* Go to Out */}
            <Tooltip content={tooltipLabel('Go to Out Point', getShortcutLabel(kbLayout, 'transport.goToOut'))} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${outPoint !== null ? 'text-zinc-400' : 'text-zinc-500'}`}
                onClick={() => {
                  const target = outPoint ?? (clips.length > 0 ? Math.max(...clips.map(c => c.startTime + c.duration)) : totalDuration)
                  setIsPlaying(false); setShuttleSpeed(0); setCurrentTime(target)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="20" y1="4" x2="20" y2="20" />
                  <line x1="16" y1="12" x2="4" y2="12" />
                  <polyline points="10,7 16,12 10,17" />
                </svg>
              </Button>
            </Tooltip>
            <div className="w-px h-3 bg-zinc-700" />
            {/* Set Out */}
            <Tooltip content={`${outPoint !== null ? `Out: ${formatTime(outPoint)} — ` : ''}${tooltipLabel('Set Out point', getShortcutLabel(kbLayout, 'mark.setOut'))}`} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${outPoint !== null ? 'text-yellow-400' : 'text-zinc-500'}`}
                onClick={() => setOutPoint(prev => prev !== null && Math.abs(prev - currentTime) < 0.01 ? null : currentTime)}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17,4 20,4 20,20 17,20" />
                  <line x1="14" y1="12" x2="4" y2="12" />
                  <polyline points="8,8 4,12 8,16" />
                </svg>
              </Button>
            </Tooltip>
            {/* Loop In/Out */}
            <Tooltip content="Loop In/Out" side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${playingInOut ? 'text-yellow-400 bg-yellow-400/10' : 'text-zinc-500'} ${inPoint === null || outPoint === null ? 'opacity-30 cursor-not-allowed' : ''}`}
                disabled={inPoint === null || outPoint === null}
                onClick={() => {
                  if (inPoint === null || outPoint === null) return
                  if (playingInOut) { setPlayingInOut(false); setIsPlaying(false) } else { setCurrentTime(inPoint); setPlayingInOut(true); setIsPlaying(true) }
                }}
              >
                <Repeat className="h-3 w-3" />
              </Button>
            </Tooltip>
          </div>

          {/* Resolution dropdown */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setPlaybackResOpen(prev => !prev) }}
              className={`h-6 px-2 rounded text-[11px] font-medium flex items-center gap-1 transition-colors border ${
                playbackResolution === 1
                  ? 'bg-zinc-900 text-green-400 border-zinc-700 hover:border-zinc-600'
                  : playbackResolution === 0.5
                  ? 'bg-zinc-900 text-yellow-400 border-zinc-700 hover:border-zinc-600'
                  : 'bg-zinc-900 text-orange-400 border-zinc-700 hover:border-zinc-600'
              }`}
              title="Playback resolution"
            >
              {playbackResolution === 1 ? 'Full' : playbackResolution === 0.5 ? '1/2' : '1/4'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {playbackResOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-[120px] z-50">
                {([
                  { label: 'Full (1:1)', value: 1 as const, desc: 'Highest quality' },
                  { label: 'Half (1/2)', value: 0.5 as const, desc: 'Balanced' },
                  { label: 'Quarter (1/4)', value: 0.25 as const, desc: 'Smoothest' },
                ] as const).map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => { setPlaybackResolution(opt.value); setPlaybackResOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex flex-col gap-0 transition-colors ${
                      playbackResolution === opt.value
                        ? 'text-blue-300 bg-blue-600/20'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {playbackResolution === opt.value && <span className="text-blue-400">&#10003;</span>}
                      <span className={playbackResolution === opt.value ? '' : 'ml-5'}>{opt.label}</span>
                    </div>
                    <span className={`text-[10px] ${playbackResolution === opt.value ? 'text-blue-400/60' : 'text-zinc-500'} ml-5`}>{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <Tooltip content={isFullscreen ? tooltipLabel('Exit fullscreen', getShortcutLabel(kbLayout, 'view.fullscreen')) : tooltipLabel('Fullscreen', getShortcutLabel(kbLayout, 'view.fullscreen'))} side="top">
            <button
              onClick={toggleFullscreen}
              className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
            >
              {isFullscreen
                ? <Shrink className="h-3.5 w-3.5" />
                : <Expand className="h-3.5 w-3.5" />
              }
            </button>
          </Tooltip>

          {/* Right: total duration */}
          <span className="text-[12px] font-mono font-medium text-zinc-400 tabular-nums tracking-tight select-none flex-shrink-0 text-right">
            {formatTime(totalDuration)}
          </span>
        </div>
      </div>
  )
}
