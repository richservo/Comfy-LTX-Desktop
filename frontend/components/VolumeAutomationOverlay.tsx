import React, { useCallback, useRef, useState } from 'react'
import type { VolumeKeyframe } from '../types/project'
import { interpolateVolume } from '../lib/volume-automation'

interface Props {
  clipDuration: number
  trimStart: number
  volume: number
  keyframes: VolumeKeyframe[] | undefined
  widthPx: number
  heightPx: number
  onUpdate: (keyframes: VolumeKeyframe[] | undefined) => void
  onVolumeChange: (volume: number) => void
  onBeforeEdit?: () => void
  muted?: boolean
}

const POINT_RADIUS = 5
const HIT_WIDTH = 14
const LINE_WIDTH = 2
const LINE_COLOR = 'rgba(255, 220, 80, 0.9)'
const LINE_COLOR_MUTED = 'rgba(239, 68, 68, 0.5)'
const POINT_COLOR = 'rgba(255, 220, 80, 1)'
const POINT_ACTIVE_COLOR = '#fff'
const PADDING_TOP = 4
const PADDING_BOTTOM = 4
const MAX_VOLUME = 2.0

export function VolumeAutomationOverlay({
  clipDuration, trimStart, volume, keyframes, widthPx, heightPx,
  onUpdate, onVolumeChange, onBeforeEdit, muted,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [draggingLine, setDraggingLine] = useState(false)
  const [dragKf, setDragKf] = useState<VolumeKeyframe[] | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)
  const undoPushed = useRef(false)

  const mediaStart = trimStart
  const mediaEnd = trimStart + clipDuration
  const drawH = heightPx - PADDING_TOP - PADDING_BOTTOM

  const timeToPx = useCallback((t: number) => {
    return ((t - mediaStart) / (mediaEnd - mediaStart)) * widthPx
  }, [mediaStart, mediaEnd, widthPx])

  const pxToTime = useCallback((px: number) => {
    return mediaStart + (px / widthPx) * (mediaEnd - mediaStart)
  }, [mediaStart, mediaEnd, widthPx])

  const valueToPx = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(MAX_VOLUME, v))
    return PADDING_TOP + (1 - clamped / MAX_VOLUME) * drawH
  }, [drawH])

  const pxToValue = useCallback((py: number) => {
    return Math.max(0, Math.min(MAX_VOLUME, (1 - (py - PADDING_TOP) / drawH) * MAX_VOLUME))
  }, [drawH])

  const activeKf = dragKf ?? keyframes
  const activeVol = dragVolume ?? volume
  const lineColor = muted ? LINE_COLOR_MUTED : LINE_COLOR
  const hasKeyframes = activeKf && activeKf.length > 0

  // Show points when hovered OR dragging — but don't hide mid-drag
  const showPoints = hovered || draggingIdx !== null || draggingLine

  const buildPoints = (): string => {
    if (!hasKeyframes) {
      const y = valueToPx(activeVol)
      return `0,${y} ${widthPx},${y}`
    }
    const pts: string[] = []
    const firstVol = interpolateVolume(activeKf, mediaStart, activeVol)
    pts.push(`0,${valueToPx(firstVol)}`)
    for (const kf of activeKf) {
      if (kf.time >= mediaStart - 0.001 && kf.time <= mediaEnd + 0.001) {
        pts.push(`${timeToPx(kf.time)},${valueToPx(kf.value)}`)
      }
    }
    const lastVol = interpolateVolume(activeKf, mediaEnd, activeVol)
    pts.push(`${widthPx},${valueToPx(lastVol)}`)
    return pts.join(' ')
  }

  const visibleKeyframes: { idx: number; kf: VolumeKeyframe; x: number; y: number }[] = []
  if (activeKf) {
    for (let i = 0; i < activeKf.length; i++) {
      const kf = activeKf[i]
      if (kf.time >= mediaStart - 0.001 && kf.time <= mediaEnd + 0.001) {
        visibleKeyframes.push({ idx: i, kf, x: timeToPx(kf.time), y: valueToPx(kf.value) })
      }
    }
  }

  // Double-click on line segment: reset that segment to 100%
  // With keyframes: set the two surrounding keyframes to 1.0
  // Without keyframes: reset the flat line volume to 1.0
  const handleLineDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    if (onBeforeEdit) onBeforeEdit()

    if (!hasKeyframes) {
      onVolumeChange(1.0)
      return
    }

    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const clickTime = pxToTime(e.clientX - rect.left)

    const kfs = [...(keyframes || [])]
    // Find the two keyframes that bracket the click time
    let leftIdx = -1
    let rightIdx = -1
    for (let i = 0; i < kfs.length; i++) {
      if (kfs[i].time <= clickTime) leftIdx = i
    }
    for (let i = kfs.length - 1; i >= 0; i--) {
      if (kfs[i].time >= clickTime) { rightIdx = i; break }
    }

    if (leftIdx >= 0) kfs[leftIdx] = { ...kfs[leftIdx], value: 1.0 }
    if (rightIdx >= 0 && rightIdx !== leftIdx) kfs[rightIdx] = { ...kfs[rightIdx], value: 1.0 }

    onUpdate(kfs)
  }, [hasKeyframes, keyframes, pxToTime, onUpdate, onVolumeChange, onBeforeEdit])

  // MouseDown on the hit-area polyline
  const handleLineMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    // Alt+click = add keyframe
    if (e.altKey) {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const time = pxToTime(x)
      const value = pxToValue(y)

      if (onBeforeEdit) onBeforeEdit()
      const updated = [...(keyframes || [])]
      if (updated.length === 0) {
        updated.push({ time: mediaStart, value: volume })
        updated.push({ time: mediaEnd, value: volume })
      }
      updated.push({ time, value })
      updated.sort((a, b) => a.time - b.time)
      onUpdate(updated)
      return
    }

    // No keyframes: drag the flat line to adjust volume
    if (!hasKeyframes) {
      undoPushed.current = false
      setDraggingLine(true)
      setDragVolume(volume)

      const handleMove = (me: MouseEvent) => {
        if (!undoPushed.current) {
          if (onBeforeEdit) onBeforeEdit()
          undoPushed.current = true
        }
        const rect = svgRef.current?.getBoundingClientRect()
        if (!rect) return
        const newY = me.clientY - rect.top
        setDragVolume(pxToValue(newY))
      }

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        setDraggingLine(false)
        setDragVolume(cur => {
          if (cur !== null) {
            setTimeout(() => onVolumeChange(cur), 0)
          }
          return null
        })
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    }
  }, [hasKeyframes, keyframes, volume, mediaStart, mediaEnd, pxToTime, pxToValue, onUpdate, onVolumeChange, onBeforeEdit])

  // Drag a keyframe point
  const handlePointMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    e.preventDefault()

    if (e.button === 2) {
      if (onBeforeEdit) onBeforeEdit()
      const updated = [...(keyframes || [])].filter((_, i) => i !== idx)
      onUpdate(updated.length > 0 ? updated : undefined)
      return
    }

    undoPushed.current = false
    setDraggingIdx(idx)
    setDragKf(keyframes ? [...keyframes] : null)

    const startKf = keyframes?.[idx]
    if (!startKf) return

    const handleMove = (me: MouseEvent) => {
      if (!undoPushed.current) {
        if (onBeforeEdit) onBeforeEdit()
        undoPushed.current = true
      }
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      const newX = me.clientX - rect.left
      const newY = me.clientY - rect.top
      const newTime = Math.max(mediaStart, Math.min(mediaEnd, pxToTime(newX)))
      const newValue = pxToValue(newY)

      setDragKf(prev => {
        if (!prev) return prev
        const updated = [...prev]
        updated[idx] = { time: newTime, value: newValue }
        return updated
      })
    }

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      setDraggingIdx(null)
      setDragKf(cur => {
        if (cur) {
          const sorted = [...cur].sort((a, b) => a.time - b.time)
          setTimeout(() => onUpdate(sorted), 0)
        }
        return null
      })
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [keyframes, mediaStart, mediaEnd, pxToTime, pxToValue, onUpdate, onBeforeEdit])

  if (widthPx < 20 || heightPx < 10) return null

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0"
      width={widthPx}
      height={heightPx}
      style={{ overflow: 'visible', pointerEvents: 'none', zIndex: 15 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (draggingIdx === null && !draggingLine) setHovered(false) }}
    >
      {/* Wide invisible hit area — pointer-events on stroke only, sits above clip content */}
      <polyline
        points={buildPoints()}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_WIDTH}
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: hasKeyframes ? 'crosshair' : 'ns-resize' }}
        onMouseDown={handleLineMouseDown}
        onDoubleClick={handleLineDoubleClick}
      />

      {/* Visible volume line */}
      <polyline
        points={buildPoints()}
        fill="none"
        stroke={lineColor}
        strokeWidth={LINE_WIDTH}
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />

      {/* Keyframe point handles — shown on hover or drag */}
      {showPoints && visibleKeyframes.map(({ idx, x, y }) => (
        <circle
          key={`kf-${activeKf?.[idx]?.time.toFixed(4)}`}
          cx={x}
          cy={y}
          r={draggingIdx === idx ? POINT_RADIUS + 1 : POINT_RADIUS}
          fill={draggingIdx === idx ? POINT_ACTIVE_COLOR : POINT_COLOR}
          stroke="rgba(0,0,0,0.6)"
          strokeWidth={1}
          style={{ pointerEvents: 'auto', cursor: 'grab' }}
          onMouseDown={(e) => handlePointMouseDown(e, idx)}
          onContextMenu={(e) => { e.preventDefault(); handlePointMouseDown(e, idx) }}
        />
      ))}

      {/* Volume percentage label while dragging */}
      {(draggingLine || draggingIdx !== null) && (() => {
        const displayVol = draggingLine
          ? (dragVolume ?? volume)
          : draggingIdx !== null && dragKf
            ? dragKf[draggingIdx]?.value ?? volume
            : volume
        const y = valueToPx(displayVol)
        return (
          <text
            x={widthPx / 2}
            y={Math.max(12, y - 8)}
            textAnchor="middle"
            fill="#fff"
            fontSize={10}
            fontFamily="system-ui, sans-serif"
            style={{ pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          >
            {Math.round(displayVol * 100)}%
          </text>
        )
      })()}
    </svg>
  )
}
