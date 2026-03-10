import React, { useState, useEffect, useCallback } from 'react'
import { Play, Pause, Square, SkipBack, SkipForward, ChevronLeft, ChevronRight, Video, Music, X } from 'lucide-react'
import type { Asset } from '../../types/project'
import { formatTime } from './video-editor-utils'
import { Tooltip } from '../../components/ui/tooltip'

export interface SourceMonitorProps {
  sourceAsset: Asset | null
  sourceTime: number
  setSourceTime: (t: number | ((prev: number) => number)) => void
  sourceIsPlaying: boolean
  setSourceIsPlaying: (v: boolean) => void
  sourceSpeed: number
  setSourceSpeed: (v: number) => void
  sourceIn: number | null
  sourceOut: number | null
  setSourceIn: (v: number | null | ((prev: number | null) => number | null)) => void
  setSourceOut: (v: number | null | ((prev: number | null) => number | null)) => void
  setShowSourceMonitor: (v: boolean) => void
  activePanel: 'source' | 'timeline'
  setActivePanel: (p: 'source' | 'timeline') => void
  sourceSplitPercent: number
  draggingMarker: 'timelineIn' | 'timelineOut' | 'sourceIn' | 'sourceOut' | null
  setDraggingMarker: React.Dispatch<React.SetStateAction<'timelineIn' | 'timelineOut' | 'sourceIn' | 'sourceOut' | null>>
  sourceVideoRef: React.RefObject<HTMLVideoElement | null>
  onInsertEdit: () => void
  onOverwriteEdit: () => void
}

export function SourceMonitor({
  sourceAsset,
  sourceTime,
  setSourceTime,
  sourceIsPlaying: _sourceIsPlaying,
  setSourceIsPlaying: _setSourceIsPlaying,
  sourceSpeed,
  setSourceSpeed,
  sourceIn,
  sourceOut,
  setSourceIn,
  setSourceOut,
  setShowSourceMonitor,
  activePanel,
  setActivePanel,
  sourceSplitPercent,
  setDraggingMarker,
  sourceVideoRef,
  onInsertEdit,
  onOverwriteEdit,
}: SourceMonitorProps) {
  const [videoDuration, setVideoDuration] = useState<number>(0)

  // Reset video duration when asset changes
  useEffect(() => {
    setVideoDuration(0)
  }, [sourceAsset?.id])

  // Use actual video element duration, then asset metadata, then fallback
  const effectiveDuration = videoDuration || sourceAsset?.duration || 5

  // Speed label for overlay (only show when not at normal speed)
  const speedLabel = sourceSpeed === 0 || sourceSpeed === 1 ? null
    : `${sourceSpeed > 0 ? '' : ''}${sourceSpeed}x`

  const handleStop = useCallback(() => {
    setSourceSpeed(0)
  }, [setSourceSpeed])

  return (
    <div
      className={`flex flex-col ${activePanel === 'source' ? 'ring-2 ring-blue-500 ring-inset' : 'border-r border-zinc-800'}`}
      style={{ width: `${sourceSplitPercent}%` }}
      onMouseDown={() => setActivePanel('source')}
    >
      {/* Header */}
      <div className="h-7 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 flex-shrink-0">
        <span className="text-[11px] font-semibold text-zinc-400 tracking-wide">Clip Viewer</span>
        <Tooltip content="Close clip viewer" side="left">
          <button onClick={() => { setShowSourceMonitor(false); handleStop() }} className="text-zinc-500 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      {/* Video Area */}
      <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center min-h-0">
        {sourceAsset ? (
          <>
            {sourceAsset.type === 'video' ? (
              <video
                ref={sourceVideoRef as React.RefObject<HTMLVideoElement>}
                src={sourceAsset.url}
                className="max-w-full max-h-full object-contain"
                onLoadedMetadata={() => {
                  if (sourceVideoRef.current && sourceVideoRef.current.duration && isFinite(sourceVideoRef.current.duration)) {
                    setVideoDuration(sourceVideoRef.current.duration)
                  }
                }}
                onTimeUpdate={() => {
                  // Only sync from native playback (forward), not during reverse rAF
                  if (sourceVideoRef.current && sourceSpeed >= 0) {
                    setSourceTime(sourceVideoRef.current.currentTime)
                  }
                }}
                onEnded={() => setSourceSpeed(0)}
                playsInline
              />
            ) : sourceAsset.type === 'image' ? (
              <img src={sourceAsset.url} alt="" className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-center text-zinc-500">
                <Music className="h-12 w-12 mx-auto mb-2" />
                <p className="text-sm">{sourceAsset.path?.split('/').pop() || 'Audio'}</p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-zinc-600">
            <Video className="h-10 w-10 mx-auto mb-2" />
            <p className="text-xs">Double-click an asset to load it here</p>
          </div>
        )}
        {/* Speed indicator overlay */}
        {speedLabel && (
          <div className="absolute top-2 right-2 bg-black/70 px-1.5 py-0.5 rounded text-[11px] font-mono text-blue-400 pointer-events-none">
            {speedLabel}
          </div>
        )}
      </div>
      {/* Scrub bar with In/Out markers */}
      {sourceAsset && (sourceAsset.type === 'video' || sourceAsset.type === 'audio') && (
        <div className="bg-zinc-900 border-t border-zinc-800 flex-shrink-0 relative px-2 py-1">
          {/* Scrub track */}
          <div
            id="source-scrub-bar"
            className="relative h-6 cursor-pointer group"
            onMouseDown={(e) => {
              const bar = e.currentTarget
              const rect = bar.getBoundingClientRect()
              // Stop playback when scrubbing
              setSourceSpeed(0)
              const seek = (clientX: number) => {
                const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                const t = frac * effectiveDuration
                setSourceTime(t)
                if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t
              }
              seek(e.clientX)
              const onMove = (ev: MouseEvent) => seek(ev.clientX)
              const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          >
            {/* Base track line */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-zinc-700 rounded-full" />

            {/* Dimmed regions outside In/Out (darker overlay) */}
            {sourceIn !== null && (
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/50 rounded-l"
                style={{ width: `${(sourceIn / effectiveDuration) * 100}%` }}
              />
            )}
            {sourceOut !== null && (
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/50 rounded-r"
                style={{ width: `${100 - (sourceOut / effectiveDuration) * 100}%` }}
              />
            )}

            {/* Selected range highlight */}
            {(sourceIn !== null || sourceOut !== null) && (
              <div
                className="absolute top-0 bottom-0 border-t-2 border-b-2 border-blue-400/70"
                style={{
                  left: `${((sourceIn ?? 0) / effectiveDuration) * 100}%`,
                  width: `${(((sourceOut ?? effectiveDuration) - (sourceIn ?? 0)) / effectiveDuration) * 100}%`,
                }}
              >
                <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1 bg-blue-400/40 rounded-full" />
              </div>
            )}

            {/* In bracket marker — draggable */}
            {sourceIn !== null && (
              <div
                className="absolute top-0 bottom-0 flex items-center z-10 cursor-ew-resize"
                style={{ left: `calc(${(sourceIn / effectiveDuration) * 100}% - 8px)`, width: 14 }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingMarker('sourceIn') }}
              >
                <div className="w-1.5 h-full bg-blue-400 rounded-l-sm flex flex-col justify-between py-0.5 pointer-events-none ml-auto">
                  <div className="w-2.5 h-0.5 bg-blue-400 rounded-r" />
                  <div className="w-2.5 h-0.5 bg-blue-400 rounded-r" />
                </div>
              </div>
            )}

            {/* Out bracket marker — draggable */}
            {sourceOut !== null && (
              <div
                className="absolute top-0 bottom-0 flex items-center z-10 cursor-ew-resize"
                style={{ left: `${(sourceOut / effectiveDuration) * 100}%`, width: 14 }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingMarker('sourceOut') }}
              >
                <div className="w-1.5 h-full bg-blue-400 rounded-r-sm flex flex-col justify-between py-0.5 pointer-events-none">
                  <div className="w-2.5 h-0.5 bg-blue-400 rounded-l -ml-1" />
                  <div className="w-2.5 h-0.5 bg-blue-400 rounded-l -ml-1" />
                </div>
              </div>
            )}

            {/* Playhead needle */}
            <div
              className="absolute top-0 bottom-0 z-20"
              style={{ left: `${Math.min(100, (sourceTime / effectiveDuration) * 100)}%` }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-blue-400 clip-triangle" style={{ clipPath: 'polygon(50% 100%, 0% 0%, 100% 0%)' }} />
              <div className="absolute top-2 bottom-0 left-1/2 -translate-x-1/2 w-px bg-blue-400" />
            </div>
          </div>

          {/* In/Out timecode labels below scrub bar */}
          {(sourceIn !== null || sourceOut !== null) && (
            <div className="flex justify-between items-center mt-0.5 h-3.5">
              <span className="text-[9px] font-mono text-blue-400/80">
                {sourceIn !== null ? `IN ${formatTime(sourceIn)}` : ''}
              </span>
              <span className="text-[9px] font-mono text-zinc-500">
                {sourceIn !== null && sourceOut !== null
                  ? `Duration: ${formatTime(sourceOut - sourceIn)}`
                  : ''
                }
              </span>
              <span className="text-[9px] font-mono text-blue-400/80">
                {sourceOut !== null ? `OUT ${formatTime(sourceOut)}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
      {/* Status bar: timecode | transport controls | duration */}
      <div className="h-8 bg-zinc-950 border-t border-zinc-800 flex items-center px-3 flex-shrink-0 gap-2">
        {/* Left: current timecode */}
        <span className="text-[12px] font-mono font-medium text-amber-400 tabular-nums tracking-tight select-none min-w-[90px]">
          {formatTime(sourceTime)}
        </span>

        {/* Center: transport controls */}
        <div className="flex-1 flex items-center justify-center gap-0.5">
          {/* Mark In */}
          <Tooltip content={sourceIn !== null ? `In: ${formatTime(sourceIn)}` : 'Set In (I)'} side="top">
            <button
              onClick={() => setSourceIn(prev => prev !== null && Math.abs(prev - sourceTime) < 0.01 ? null : sourceTime)}
              className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${sourceIn !== null ? 'text-yellow-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7,4 4,4 4,20 7,20" />
                <line x1="10" y1="12" x2="20" y2="12" />
                <polyline points="16,8 20,12 16,16" />
              </svg>
            </button>
          </Tooltip>
          <div className="w-px h-3 bg-zinc-700" />
          <Tooltip content="Go to start" side="top">
            <button
              onClick={() => { handleStop(); const t = sourceIn ?? 0; setSourceTime(t); if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t }}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <SkipBack className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip content="Step back" side="top">
            <button
              onClick={() => {
                handleStop()
                const t = Math.max(0, sourceTime - 1 / 24)
                setSourceTime(t)
                if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t
              }}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          {/* Reverse play button: simple toggle -1x / stop */}
          <Tooltip content="Play reverse (J)" side="top">
            <button
              onClick={() => {
                if (sourceSpeed < 0) {
                  setSourceSpeed(0)
                } else {
                  setSourceSpeed(-1)
                }
              }}
              className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${sourceSpeed < 0 ? 'text-blue-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
            >
              <Play className="h-3 w-3 mr-0.5 rotate-180" />
            </button>
          </Tooltip>
          <Tooltip content="Stop (K)" side="top">
            <button
              onClick={handleStop}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <Square className="h-2.5 w-2.5" />
            </button>
          </Tooltip>
          {/* Play/Pause button: simple toggle 1x / stop */}
          <Tooltip content={sourceSpeed > 0 ? 'Pause' : 'Play (L)'} side="top">
            <button
              onClick={() => {
                if (sourceSpeed > 0) {
                  setSourceSpeed(0)
                } else {
                  // Start forward at 1x
                  if (sourceVideoRef.current && sourceIn !== null && sourceTime < sourceIn) {
                    sourceVideoRef.current.currentTime = sourceIn
                    setSourceTime(sourceIn)
                  }
                  setSourceSpeed(1)
                }
              }}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              {sourceSpeed > 0 ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
            </button>
          </Tooltip>
          <Tooltip content="Step forward" side="top">
            <button
              onClick={() => {
                handleStop()
                const t = Math.min(effectiveDuration, sourceTime + 1 / 24)
                setSourceTime(t)
                if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t
              }}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Go to end" side="top">
            <button
              onClick={() => { handleStop(); const t = sourceOut ?? effectiveDuration; setSourceTime(t); if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t }}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <SkipForward className="h-3 w-3" />
            </button>
          </Tooltip>
          <div className="w-px h-3 bg-zinc-700" />
          {/* Mark Out */}
          <Tooltip content={sourceOut !== null ? `Out: ${formatTime(sourceOut)}` : 'Set Out (O)'} side="top">
            <button
              onClick={() => setSourceOut(prev => prev !== null && Math.abs(prev - sourceTime) < 0.01 ? null : sourceTime)}
              className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${sourceOut !== null ? 'text-yellow-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17,4 20,4 20,20 17,20" />
                <line x1="14" y1="12" x2="4" y2="12" />
                <polyline points="8,8 4,12 8,16" />
              </svg>
            </button>
          </Tooltip>
          <div className="w-px h-3 bg-zinc-700 mx-0.5" />
          {/* Insert */}
          <Tooltip content="Insert Edit (,)" side="top">
            <button
              onClick={onInsertEdit}
              disabled={!sourceAsset}
              className="h-6 px-1 flex items-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </Tooltip>
          {/* Overwrite */}
          <Tooltip content="Overwrite Edit (.)" side="top">
            <button
              onClick={onOverwriteEdit}
              disabled={!sourceAsset}
              className="h-6 px-1 flex items-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 12h6" /></svg>
            </button>
          </Tooltip>
        </div>

        {/* Right: total duration */}
        <span className="text-[12px] font-mono font-medium text-zinc-400 tabular-nums tracking-tight select-none min-w-[90px] text-right">
          {formatTime(effectiveDuration)}
        </span>
      </div>
    </div>
  )
}
