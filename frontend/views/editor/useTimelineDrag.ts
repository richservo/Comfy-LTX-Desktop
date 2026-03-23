import { useState, useRef, useEffect, useCallback } from 'react'
import type { Asset, TimelineClip, Track, TimelineMarker } from '../../types/project'
import { resolveOverlaps, migrateClip, type ToolType, clampRollDelta, applyRollEdit, SNAP_THRESHOLD, getSnapTargets, snapToTargets } from './video-editor-utils'

export interface DraggingClipState {
  clipId: string
  startX: number
  startY: number
  originalStartTime: number
  originalTrackIndex: number
  originalPositions: Record<string, { startTime: number; trackIndex: number }>
  isDuplicate?: boolean
  altHeld?: boolean
}

export interface ResizingClipState {
  clipId: string
  edge: 'left' | 'right'
  startX: number
  originalStartTime: number
  originalDuration: number
  originalTrimStart: number
  originalTrimEnd: number
  tool: ToolType
  adjacentClipId?: string
  adjacentOrigDuration?: number
  adjacentOrigTrimStart?: number
  adjacentOrigTrimEnd?: number
  adjacentOrigStartTime?: number
  independentResize?: boolean
  linkedOriginals?: Map<string, { startTime: number; duration: number; trimStart: number; speed: number }>
}

export interface SlipSlideClipState {
  clipId: string
  tool: 'slip' | 'slide'
  startX: number
  originalTrimStart: number
  originalTrimEnd: number
  originalStartTime: number
  originalDuration: number
  prevClipId?: string
  prevOrigDuration?: number
  nextClipId?: string
  nextOrigStartTime?: number
  nextOrigDuration?: number
  nextOrigTrimStart?: number
  independentResize?: boolean
  linkedOriginals?: Map<string, { trimStart: number; trimEnd: number; duration: number; speed: number; assetDuration: number | null }>
}

interface UseTimelineDragParams {
  activeTool: ToolType
  setActiveTool: (tool: ToolType) => void
  lastTrimTool: ToolType
  setLastTrimTool: (tool: ToolType) => void
  pixelsPerSecond: number
  totalDuration: number
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  tracks: Track[]
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  currentTime: number
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  snapEnabled: boolean
  pushUndo: (c?: any) => void
  resolveClipSrc: (clip: TimelineClip | null) => string
  getMaxClipDuration: (clip: TimelineClip) => number
  addClipToTimeline: (asset: Asset, trackIndex: number, startTime?: number, overwrite?: boolean) => void
  assets: Asset[]
  timelines: any[]
  activeTimeline: any
  currentProjectId: string | null
  timelineRef: React.RefObject<HTMLDivElement>
  trackContainerRef: React.RefObject<HTMLDivElement>
  orderedTracks: { track: Track; realIndex: number; displayRow: number }[]
  trackDisplayRow: Map<number, number>
  getTrackHeight: (trackIndex: number) => number
  trackTopPx: (realTrackIndex: number, padding?: number) => number
  cutPoints: any[]
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  setSelectedSubtitleId: (id: string | null) => void
  setSelectedGap: (gap: any) => void
  audioTrackHeight: number
  videoTrackHeight: number
  subtitleTrackHeight: number
  markers: TimelineMarker[]
}

export function useTimelineDrag(params: UseTimelineDragParams) {
  const {
    activeTool,
    pixelsPerSecond, totalDuration,
    clips, setClips, tracks,
    selectedClipIds, setSelectedClipIds,
    currentTime, setCurrentTime, setIsPlaying,
    snapEnabled, pushUndo, getMaxClipDuration, addClipToTimeline,
    assets, timelines, activeTimeline,
    timelineRef, trackContainerRef,
    orderedTracks, trackDisplayRow, getTrackHeight, trackTopPx,
    splitClipAtPlayhead, setSelectedSubtitleId, setSelectedGap,
    audioTrackHeight, videoTrackHeight, subtitleTrackHeight,
    markers,
  } = params

  const [draggingClip, setDraggingClip] = useState<DraggingClipState | null>(null)
  const [resizingClip, setResizingClip] = useState<ResizingClipState | null>(null)
  const [slipSlideClip, setSlipSlideClip] = useState<SlipSlideClipState | null>(null)
  const [selectedTrimEdge, setSelectedTrimEdge] = useState<{ clipId: string; edge: 'left' | 'right'; independent?: boolean } | null>(null)
  const [lassoRect, setLassoRect] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const lassoOriginRef = useRef<{ scrollLeft: number; containerLeft: number; containerTop: number } | null>(null)

  // --- Ruler scrub: click + drag to scrub playhead ---
  

  const isScrubbing = useRef(false)
  const scrubFromEvent = useCallback((clientX: number) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    let time = x / pixelsPerSecond
    // Snap playhead to clip edges when snapping is enabled
    if (snapEnabled) {
      time = snapToTargets(time, getSnapTargets(clips, undefined, markers))
    }
    setCurrentTime(Math.max(0, Math.min(time, totalDuration)))
  }, [pixelsPerSecond, totalDuration, snapEnabled, clips, markers])

  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return // only left button
    e.preventDefault() // prevent text selection
    isScrubbing.current = true
    setIsPlaying(false) // pause playback while scrubbing
    scrubFromEvent(e.clientX)
    
    const onMove = (ev: MouseEvent) => {
      if (!isScrubbing.current) return
      ev.preventDefault()
      scrubFromEvent(ev.clientX)
    }
    const onUp = () => {
      isScrubbing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [activeTool, scrubFromEvent])
  
  
  
  // Helper: expand a set of clip IDs to include their linked counterparts (audio ↔ video)
  // Uses transitive expansion so all members of a linked group are found,
  // e.g. clicking A2 → finds Video → finds A1, selecting all three.
  const expandWithLinkedClips = useCallback((ids: Set<string>): Set<string> => {
    const expanded = new Set(ids)
    const queue = [...ids]
    while (queue.length > 0) {
      const id = queue.pop()!
      const c = clips.find(cl => cl.id === id)
      if (c?.linkedClipIds) {
        for (const lid of c.linkedClipIds) {
          if (!expanded.has(lid) && clips.some(cl => cl.id === lid)) {
            expanded.add(lid)
            queue.push(lid)
          }
        }
      }
    }
    return expanded
  }, [clips])
  
  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip) => {
    e.stopPropagation()
    setSelectedTrimEdge(null)

    // Prevent all interactions on locked tracks (except selection)
    const clipTrack = tracks[clip.trackIndex]
    if (clipTrack?.locked) {
      // Still allow selecting the clip visually
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
      return
    }
    
    if (activeTool === 'blade') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const clickX = e.clientX - rect.left
      let clickTime = clip.startTime + (clickX / rect.width) * clip.duration
      // Snap blade to clip edges and playhead
      if (snapEnabled) {
        const targets = [...getSnapTargets(clips, new Set([clip.id]), markers), currentTime]
        clickTime = snapToTargets(clickTime, targets)
      }

      setCurrentTime(clickTime)
      
      if (e.shiftKey) {
        // Shift+blade: cut ALL clips at this time across all unlocked tracks
        const clipIds = clips
          .filter(c =>
            clickTime > c.startTime + 0.1 &&
            clickTime < c.startTime + c.duration - 0.1 &&
            !tracks[c.trackIndex]?.locked
          )
          .map(c => c.id)
        if (clipIds.length > 0) {
          splitClipAtPlayhead(clipIds[0], clickTime, clipIds)
        }
      } else {
        // Normal blade: cut only the clicked clip
        splitClipAtPlayhead(clip.id, clickTime)
      }
      return
    }
    
    // --- Slip tool: shift source content within clip ---
    if (activeTool === 'slip') {
      const independent = e.ctrlKey || e.metaKey
      setSelectedClipIds(independent ? new Set([clip.id]) : expandWithLinkedClips(new Set([clip.id])))
      pushUndo()
      const linkedIds = independent ? [] : (clip.linkedClipIds || [])
      setSlipSlideClip({
        clipId: clip.id,
        tool: 'slip',
        startX: e.clientX,
        originalTrimStart: clip.trimStart,
        originalTrimEnd: clip.trimEnd,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        independentResize: independent,
        linkedOriginals: linkedIds.length > 0 ? new Map(
          linkedIds.map(lid => {
            const lc = clips.find(c => c.id === lid)
            return [lid, {
              trimStart: lc?.trimStart ?? 0,
              trimEnd: lc?.trimEnd ?? 0,
              duration: lc?.duration ?? 0,
              speed: lc?.speed ?? 1,
              assetDuration: lc?.asset?.duration ?? null,
            }] as const
          })
        ) : undefined,
      })
      return
    }
    
    // --- Slide tool: move clip, adjust neighbors ---
    if (activeTool === 'slide') {
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
      pushUndo()
      
      // Find the previous and next clips on the same track
      const sameTrack = clips
        .filter(c => c.trackIndex === clip.trackIndex && c.id !== clip.id)
        .sort((a, b) => a.startTime - b.startTime)
      const prevClip = sameTrack.filter(c => c.startTime + c.duration <= clip.startTime + 0.05).pop()
      const nextClip = sameTrack.find(c => c.startTime >= clip.startTime + clip.duration - 0.05)
      
      setSlipSlideClip({
        clipId: clip.id,
        tool: 'slide',
        startX: e.clientX,
        originalTrimStart: clip.trimStart,
        originalTrimEnd: clip.trimEnd,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        prevClipId: prevClip?.id,
        prevOrigDuration: prevClip?.duration,
        nextClipId: nextClip?.id,
        nextOrigStartTime: nextClip?.startTime,
        nextOrigDuration: nextClip?.duration,
        nextOrigTrimStart: nextClip?.trimStart,
      })
      return
    }
    
    // --- Track Select Forward: select this clip + all clips to the right ---
    if (activeTool === 'trackForward') {
      const forwardClips = clips.filter(c => {
        if (e.shiftKey) {
          // Shift held: select forward on SAME track only
          return c.trackIndex === clip.trackIndex && c.startTime >= clip.startTime
        } else {
          // Default: select forward on ALL tracks (like Premiere)
          return c.startTime >= clip.startTime
        }
      })
      const forwardIds = expandWithLinkedClips(new Set(forwardClips.map(c => c.id)))
      setSelectedClipIds(forwardIds)
      setSelectedSubtitleId(null)
      setSelectedGap(null)
      
      // Start drag so the user can slide the whole forward selection
      pushUndo()
      const originalPositions: Record<string, { startTime: number; trackIndex: number }> = {}
      clips.filter(c => forwardIds.has(c.id)).forEach(c => {
        originalPositions[c.id] = { startTime: c.startTime, trackIndex: c.trackIndex }
      })
      setDraggingClip({
        clipId: clip.id,
        startX: e.clientX,
        startY: e.clientY,
        originalStartTime: clip.startTime,
        originalTrackIndex: clip.trackIndex,
        originalPositions,
      })
      return
    }
    
    if (activeTool === 'select' || activeTool === 'ripple' || activeTool === 'roll') {
      // Compute the effective selection BEFORE React processes the state update
      let effectiveSelection: Set<string>

      // Right-click on an already-selected clip: preserve the current selection
      // so multi-select context menus work without losing the selection
      if (e.button === 2 && selectedClipIds.has(clip.id)) {
        effectiveSelection = selectedClipIds
      } else if (e.shiftKey) {
        // Shift+click: toggle clip in/out of multi-selection (toggle linked group together)
        effectiveSelection = new Set(selectedClipIds)
        if (effectiveSelection.has(clip.id)) {
          effectiveSelection.delete(clip.id)
          if (!e.altKey && clip.linkedClipIds) clip.linkedClipIds.forEach(lid => effectiveSelection.delete(lid))
        } else {
          effectiveSelection.add(clip.id)
          if (!e.altKey && clip.linkedClipIds) clip.linkedClipIds.forEach(lid => {
            if (clips.some(c => c.id === lid)) effectiveSelection.add(lid)
          })
        }
        setSelectedClipIds(effectiveSelection)
      } else if (e.altKey || (e.ctrlKey && clip.linkedClipIds?.length)) {
        // Alt+click or Ctrl+click on linked clip: select ONLY this clip, ignoring linked clips
        // Ctrl+click allows moving one half of a linked pair independently (creates drift)
        if (selectedClipIds.has(clip.id)) {
          effectiveSelection = selectedClipIds
        } else {
          effectiveSelection = new Set([clip.id])
          setSelectedClipIds(effectiveSelection)
        }
      } else {
        // Normal click: select this clip + its linked clips
        effectiveSelection = expandWithLinkedClips(new Set([clip.id]))
        setSelectedClipIds(effectiveSelection)
      }
      
      // Don't start a drag on right-click (context menu)
      if (e.button === 2) return

      // Record undo before drag begins
      pushUndo()
      // Only drag clips that are in the effective (visual) selection.
      // This allows moving just the video or audio part of a linked clip
      // when only that part is selected (e.g. via Alt+lasso). Links are preserved.
      const originalPositions: Record<string, { startTime: number; trackIndex: number }> = {}
      for (const c of clips) {
        if (effectiveSelection.has(c.id)) {
          originalPositions[c.id] = { startTime: c.startTime, trackIndex: c.trackIndex }
        }
      }
      // Always ensure the clicked clip is in the group
      if (!originalPositions[clip.id]) {
        originalPositions[clip.id] = { startTime: clip.startTime, trackIndex: clip.trackIndex }
      }

      // Set up dragging. Alt+drag duplication is deferred to first mouseMove
      // so that Alt+click (no drag) only changes selection without creating duplicates.
      setDraggingClip({
        clipId: clip.id,
        startX: e.clientX,
        startY: e.clientY,
        originalStartTime: clip.startTime,
        originalTrackIndex: clip.trackIndex,
        originalPositions,
        altHeld: e.altKey || undefined,
      })
    }
  }
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Handle lasso dragging
    if (lassoRect) {
      setLassoRect(prev => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null)
      return
    }
    
    if (!draggingClip || !trackContainerRef.current) return

    // Alt+drag: create duplicates on first significant movement (deferred from mouseDown)
    if (draggingClip.altHeld && !draggingClip.isDuplicate) {
      const dx = e.clientX - draggingClip.startX
      const dy = e.clientY - draggingClip.startY
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return

      const idMap = new Map<string, string>()
      const duplicateClips: TimelineClip[] = []
      for (const c of clips) {
        if (!draggingClip.originalPositions[c.id]) continue
        const newId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        idMap.set(c.id, newId)
        duplicateClips.push({ ...c, id: newId, isRegenerating: false })
      }
      setClips(prev => [...prev, ...duplicateClips])

      const dupOrigPositions: Record<string, { startTime: number; trackIndex: number }> = {}
      for (const [oldId, pos] of Object.entries(draggingClip.originalPositions)) {
        const newId = idMap.get(oldId)
        if (newId) dupOrigPositions[newId] = { ...pos }
      }
      const newPrimaryId = idMap.get(draggingClip.clipId) || draggingClip.clipId
      setSelectedClipIds(new Set(Object.keys(dupOrigPositions)))
      setDraggingClip({
        ...draggingClip,
        clipId: newPrimaryId,
        originalPositions: dupOrigPositions,
        isDuplicate: true,
        altHeld: false,
      })
      return
    }
    
    const primaryClip = clips.find(c => c.id === draggingClip.clipId)
    if (!primaryClip) return
    
    const deltaX = e.clientX - draggingClip.startX
    const deltaY = e.clientY - draggingClip.startY
    
    // Compute the primary clip's new position
    let newStartTime = draggingClip.originalStartTime + deltaX / pixelsPerSecond
    newStartTime = Math.max(0, newStartTime)
    
    // Snap the primary clip (skip other clips in the drag group for snapping)
    const origPositions = draggingClip.originalPositions
    if (snapEnabled) {
      const snapThreshold = SNAP_THRESHOLD
      for (const otherClip of clips) {
        if (origPositions[otherClip.id]) continue // skip clips in the drag group
        
        if (Math.abs(newStartTime - otherClip.startTime) < snapThreshold) {
          newStartTime = otherClip.startTime
        }
        const otherEnd = otherClip.startTime + otherClip.duration
        if (Math.abs(newStartTime - otherEnd) < snapThreshold) {
          newStartTime = otherEnd
        }
        const clipEnd = newStartTime + primaryClip.duration
        if (Math.abs(clipEnd - otherClip.startTime) < snapThreshold) {
          newStartTime = otherClip.startTime - primaryClip.duration
        }
      }
      if (Math.abs(newStartTime - currentTime) < snapThreshold) {
        newStartTime = currentTime
      }
      if (Math.abs(newStartTime + primaryClip.duration - currentTime) < snapThreshold) {
        newStartTime = currentTime - primaryClip.duration
      }
      // Snap to markers
      for (const m of markers) {
        if (Math.abs(newStartTime - m.time) < snapThreshold) newStartTime = m.time
        const clipEnd = newStartTime + primaryClip.duration
        if (Math.abs(clipEnd - m.time) < snapThreshold) newStartTime = m.time - primaryClip.duration
      }
    }

    // Use average track height for drag delta computation
    const avgTrackH = orderedTracks.length > 0
      ? orderedTracks.reduce((s, e) => s + (e.track.type === 'subtitle' ? subtitleTrackHeight : e.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight), 0) / orderedTracks.length
      : 56
    const rawDisplayDelta = Math.round(deltaY / avgTrackH)
    
    // Convert display-row delta to real-trackIndex delta for the primary clip.
    // orderedTracks maps displayRow → realIndex, so we find the primary clip's
    // current display row, offset it by the Y-delta, and look up the real index.
    const primaryRealIndex = draggingClip.originalTrackIndex
    // (primaryDisplayRow, targetDisplayRow, targetRealIndex used for debugging; trackIndexDelta removed — per-clip resolution below)
    
    
    // Compute raw deltas relative to primary clip's original position
    let timeDelta = newStartTime - draggingClip.originalStartTime
    
    // Clamp time delta so no clip goes before time 0
    for (const orig of Object.values(origPositions)) {
      if (orig.startTime + timeDelta < 0) {
        timeDelta = -orig.startTime
      }
    }
    
    // Premiere-style linked clip movement (mirrored around divider):
    //
    // Display layout (orderedTracks):
    //   row 0: V3  (top)       ← away from divider
    //   row 1: V2
    //   row 2: V1              ← nearest to divider
    //   --- divider ---
    //   row 3: A1              ← nearest to divider
    //   row 4: A2
    //   row 5: A3  (bottom)    ← away from divider
    //
    // The video and audio sections MIRROR around the divider. When you drag a
    // video clip "down" (toward divider), the linked audio should move "up"
    // (also toward divider). When you drag "up" (away from divider), audio
    // moves "down" (also away from divider). They move symmetrically relative
    // to the divider, not in the same screen direction.
    //
    // Implementation: the primary clip (being dragged) uses rawDisplayDelta.
    // Linked clips of the OPPOSITE kind get the delta INVERTED.
    // Each clip is independently clamped within its kind — if one hits its
    // boundary the other can still move.
    
    const primaryTrack = tracks[primaryRealIndex]
    const primaryKind = primaryTrack?.kind || 'video'
    
    // Build per-kind ordered lists (in display order)
    const videoDisplayRows = orderedTracks
      .filter(e => e.track.kind === 'video' && e.track.type !== 'subtitle')
      .map(e => ({ displayRow: e.displayRow, realIndex: e.realIndex }))
    const audioDisplayRows = orderedTracks
      .filter(e => e.track.kind === 'audio')
      .map(e => ({ displayRow: e.displayRow, realIndex: e.realIndex }))
    
    // Helper: resolve a clip's target track within its own kind
    const resolveTrackForClip = (origTrackIndex: number): number => {
      if (rawDisplayDelta === 0) return origTrackIndex
      
      const origTrack = tracks[origTrackIndex]
      const clipKind = origTrack?.kind || 'video'
      const kindRows = clipKind === 'audio' ? audioDisplayRows : videoDisplayRows
      
      // Find this clip's position within its kind's ordered list
      const posInKind = kindRows.findIndex(r => r.realIndex === origTrackIndex)
      if (posInKind === -1) return origTrackIndex
      
      // Primary kind follows the drag direction; opposite kind mirrors (inverted delta)
      const effectiveDelta = clipKind === primaryKind ? rawDisplayDelta : -rawDisplayDelta
      
      const newPosInKind = Math.max(0, Math.min(kindRows.length - 1, posInKind + effectiveDelta))
      const newTrackIndex = kindRows[newPosInKind].realIndex
      
      // Check if target track is locked
      if (tracks[newTrackIndex]?.locked) return origTrackIndex
      
      return newTrackIndex
    }
    
    setClips(prev => prev.map(c => {
      const orig = origPositions[c.id]
      if (!orig) return c
      
      const newTrackIndex = resolveTrackForClip(orig.trackIndex)
      
      return {
        ...c,
        startTime: orig.startTime + timeDelta,
        trackIndex: newTrackIndex,
      }
    }))
  }, [draggingClip, clips, pixelsPerSecond, snapEnabled, tracks, currentTime, lassoRect, trackDisplayRow, orderedTracks])
  
  const handleMouseUp = useCallback((e?: MouseEvent | Event) => {
    // Finalize lasso selection
    if (lassoRect && trackContainerRef.current) {
      const origin = lassoOriginRef.current
      if (origin) {
        const container = trackContainerRef.current
        const scrollLeft = container.scrollLeft
        const scrollTop = container.scrollTop
        
        // Compute lasso rectangle in timeline-local coordinates
        const lx1 = Math.min(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
        const lx2 = Math.max(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
        const ly1 = Math.min(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
        const ly2 = Math.max(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
        
        // Convert to time/track
        const timeStart = lx1 / pixelsPerSecond
        const timeEnd = lx2 / pixelsPerSecond
        const newSelection = new Set<string>()
        for (const clip of clips) {
          const clipLeft = clip.startTime
          const clipRight = clip.startTime + clip.duration
          const th = getTrackHeight(clip.trackIndex)
          const clipTop = trackTopPx(clip.trackIndex) + 4
          const clipBottom = clipTop + (th - 8) // clip height = trackHeight - 8px padding
          
          // Check overlap between lasso rect and clip rect
          if (clipRight > timeStart && clipLeft < timeEnd && clipBottom > ly1 && clipTop < ly2) {
            newSelection.add(clip.id)
          }
        }
        // Alt/Option held: select only what's in the lasso (skip linked clips)
        const altHeld = e instanceof MouseEvent && e.altKey
        setSelectedClipIds(altHeld ? newSelection : expandWithLinkedClips(newSelection))
      }
      setLassoRect(null)
      lassoOriginRef.current = null
    }
    
    // Resolve overlaps after drag or resize completes.
    // Skip if it was an Alt+click with no actual drag (altHeld still true = duplicates never created).
    if (draggingClip && !draggingClip.altHeld) {
      const movedIds = new Set(Object.keys(draggingClip.originalPositions))
      setClips(prev => resolveOverlaps(prev, movedIds))
    }
    if (resizingClip) {
      setClips(prev => resolveOverlaps(prev, new Set([resizingClip.clipId])))
    }
    
    setDraggingClip(null)
    setResizingClip(null)
  }, [lassoRect, clips, pixelsPerSecond, draggingClip, resizingClip])
  
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingClip) return
    
    const clip = clips.find(c => c.id === resizingClip.clipId)
    if (!clip) return
    
    const deltaX = e.clientX - resizingClip.startX
    const deltaTime = deltaX / pixelsPerSecond
    const tool = resizingClip.tool
    
    // --- ROLL TRIM: move the edit point between two adjacent clips (any tool when clips touch) ---
    if (resizingClip.adjacentClipId) {
      const adjClip = clips.find(c => c.id === resizingClip.adjacentClipId)
      if (!adjClip) return

      const linkedIds = resizingClip.independentResize ? new Set<string>() : new Set<string>(clip.linkedClipIds || [])
      const adjLinkedIds = resizingClip.independentResize ? new Set<string>() : new Set<string>(adjClip.linkedClipIds || [])

      // Determine left/right based on edge
      const isRight = resizingClip.edge === 'right'
      const leftClipId = isRight ? clip.id : resizingClip.adjacentClipId
      const rightClipId = isRight ? resizingClip.adjacentClipId : clip.id
      const origLeft = {
        duration: isRight ? resizingClip.originalDuration : (resizingClip.adjacentOrigDuration ?? adjClip.duration),
        trimEnd: isRight ? resizingClip.originalTrimEnd : (resizingClip.adjacentOrigTrimEnd ?? adjClip.trimEnd),
        speed: isRight ? clip.speed : adjClip.speed,
        type: isRight ? clip.type : adjClip.type,
      }
      const origRight = {
        startTime: isRight ? (resizingClip.adjacentOrigStartTime ?? adjClip.startTime) : resizingClip.originalStartTime,
        duration: isRight ? (resizingClip.adjacentOrigDuration ?? adjClip.duration) : resizingClip.originalDuration,
        trimStart: isRight ? (resizingClip.adjacentOrigTrimStart ?? adjClip.trimStart) : resizingClip.originalTrimStart,
        speed: isRight ? adjClip.speed : clip.speed,
        type: isRight ? adjClip.type : clip.type,
      }

      let dt = clampRollDelta(deltaTime, origLeft, origRight)

      setClips(prev => prev.map(c => {
        const rolled = applyRollEdit(c, leftClipId, rightClipId, dt, origLeft, origRight)
        if (rolled !== c) return rolled
        // Linked clips of the left side
        if ((isRight ? linkedIds : adjLinkedIds).has(c.id)) {
          const orig = resizingClip.linkedOriginals?.get(c.id)
          if (orig) return applyRollEdit(c, c.id, '', dt, { duration: orig.duration, trimEnd: c.trimEnd, speed: orig.speed }, origRight)
        }
        // Linked clips of the right side
        if ((isRight ? adjLinkedIds : linkedIds).has(c.id)) {
          const orig = resizingClip.linkedOriginals?.get(c.id)
          if (orig) return applyRollEdit(c, '', c.id, dt, origLeft, { startTime: orig.startTime, duration: orig.duration, trimStart: orig.trimStart, speed: orig.speed })
        }
        return c
      }))
      return
    }
    
    // --- RIPPLE TRIM: trim edge and shift all subsequent clips ---
    if (tool === 'ripple') {
      const linkedIds = resizingClip.independentResize ? new Set<string>() : new Set<string>(clip.linkedClipIds || [])
      if (resizingClip.edge === 'left') {
        let newStartTime = resizingClip.originalStartTime + deltaTime
        let newDuration = resizingClip.originalDuration - deltaTime
        
        if (newDuration < 0.5) { newDuration = 0.5; newStartTime = resizingClip.originalStartTime + resizingClip.originalDuration - 0.5 }
        if (newStartTime < 0) { newDuration = resizingClip.originalDuration + resizingClip.originalStartTime; newStartTime = 0 }
        
        const newTrimStart = resizingClip.originalTrimStart + (newStartTime - resizingClip.originalStartTime)
        const maxDur = getMaxClipDuration({ ...clip, trimStart: Math.max(0, newTrimStart) })
        newDuration = Math.min(newDuration, maxDur)
        
        const rippleDelta = newStartTime - resizingClip.originalStartTime
        const finalDuration = Math.max(0.5, newDuration)
        const finalTrimStart = Math.max(0, newTrimStart)
        
        setClips(prev => prev.map(c => {
          if (c.id === clip.id) {
            return { ...c, startTime: newStartTime, duration: finalDuration, trimStart: finalTrimStart }
          }
          if (linkedIds.has(c.id)) {
            const orig = resizingClip.linkedOriginals?.get(c.id)
            if (orig) {
              const lTrimStart = Math.max(0, orig.trimStart + rippleDelta * orig.speed)
              const lMaxDur = getMaxClipDuration({ ...c, trimStart: lTrimStart })
              const lDur = Math.min(lMaxDur, Math.max(0.5, orig.duration - rippleDelta))
              const lStart = orig.startTime + (orig.duration - lDur)
              return { ...c, startTime: lStart, duration: lDur, trimStart: lTrimStart }
            }
            return c
          }
          if (c.trackIndex === clip.trackIndex && c.id !== clip.id && c.startTime < resizingClip.originalStartTime) {
            return { ...c, startTime: Math.max(0, c.startTime + rippleDelta) }
          }
          return c
        }))
      } else {
        let newDuration = resizingClip.originalDuration + deltaTime
        newDuration = Math.max(0.5, newDuration)
        const maxDur = getMaxClipDuration(clip)
        newDuration = Math.min(newDuration, maxDur)
        
        const originalEnd = resizingClip.originalStartTime + resizingClip.originalDuration
        const newEnd = resizingClip.originalStartTime + newDuration
        const rippleDelta = newEnd - originalEnd
        const finalDuration = Math.max(0.5, newDuration)
        
        setClips(prev => prev.map(c => {
          if (c.id === clip.id) {
            return { ...c, duration: finalDuration }
          }
          if (linkedIds.has(c.id)) {
            const orig = resizingClip.linkedOriginals?.get(c.id)
            if (orig) {
              const lMaxDur = getMaxClipDuration(c)
              return { ...c, duration: Math.min(lMaxDur, Math.max(0.5, orig.duration + rippleDelta)) }
            }
            return c
          }
          if (c.trackIndex === clip.trackIndex && c.id !== clip.id && c.startTime >= originalEnd - 0.01) {
            return { ...c, startTime: Math.max(0, c.startTime + rippleDelta) }
          }
          return c
        }))
      }
      return
    }
    
    // --- NORMAL TRIM (select tool or any tool without special handling) ---
    if (resizingClip.edge === 'left') {
      let newStartTime = resizingClip.originalStartTime + deltaTime
      let newDuration = resizingClip.originalDuration - deltaTime
      
      if (newDuration < 0.5) {
        newDuration = 0.5
        newStartTime = resizingClip.originalStartTime + resizingClip.originalDuration - 0.5
      }
      
      if (newStartTime < 0) {
        newDuration = resizingClip.originalDuration + resizingClip.originalStartTime
        newStartTime = 0
      }
      
      if (snapEnabled) {
        const snapThreshold = SNAP_THRESHOLD
        if (Math.abs(newStartTime - currentTime) < snapThreshold) {
          const adjustment = currentTime - newStartTime
          newStartTime = currentTime
          newDuration -= adjustment
        }
        for (const otherClip of clips) {
          if (otherClip.id === clip.id) continue
          const otherEnd = otherClip.startTime + otherClip.duration
          if (Math.abs(newStartTime - otherEnd) < snapThreshold) {
            const adjustment = otherEnd - newStartTime
            newStartTime = otherEnd
            newDuration -= adjustment
          }
          if (Math.abs(newStartTime - otherClip.startTime) < snapThreshold) {
            const adjustment = otherClip.startTime - newStartTime
            newStartTime = otherClip.startTime
            newDuration -= adjustment
          }
        }
        for (const m of markers) {
          if (Math.abs(newStartTime - m.time) < snapThreshold) {
            const adjustment = m.time - newStartTime
            newStartTime = m.time
            newDuration -= adjustment
          }
        }
      }

      const newTrimStart = resizingClip.originalTrimStart + (newStartTime - resizingClip.originalStartTime)
      const maxDur = getMaxClipDuration({ ...clip, trimStart: Math.max(0, newTrimStart) })
      newDuration = Math.min(newDuration, maxDur)

      // Build set of linked clip IDs to also trim (skip if Ctrl-resizing independently)
      const linkedIds = resizingClip.independentResize ? new Set<string>() : new Set<string>(clip.linkedClipIds || [])
      const finalDuration = Math.max(0.5, newDuration)
      const finalTrimStart = Math.max(0, newTrimStart)

      const trimDelta = newStartTime - resizingClip.originalStartTime

      setClips(prev => prev.map(c => {
        if (c.id === clip.id) {
          return { ...c, startTime: newStartTime, duration: finalDuration, trimStart: finalTrimStart }
        }
        if (linkedIds.has(c.id)) {
          // Apply same delta to linked clip's original values to preserve trim offset
          const orig = resizingClip.linkedOriginals?.get(c.id)
          if (orig) {
            const lTrimStart = Math.max(0, orig.trimStart + trimDelta * orig.speed)
            const lMaxDur = getMaxClipDuration({ ...c, trimStart: lTrimStart })
            const lDur = Math.min(lMaxDur, Math.max(0.5, orig.duration - trimDelta))
            const lStart = orig.startTime + (orig.duration - lDur)
            return { ...c, startTime: lStart, duration: lDur, trimStart: lTrimStart }
          }
          return c
        }
        return c
      }))
    } else {
      let newDuration = resizingClip.originalDuration + deltaTime
      newDuration = Math.max(0.5, newDuration)
      
      if (snapEnabled) {
        const snapThreshold = SNAP_THRESHOLD
        const newEndTime = clip.startTime + newDuration
        
        if (Math.abs(newEndTime - currentTime) < snapThreshold) {
          newDuration = currentTime - clip.startTime
        }
        for (const otherClip of clips) {
          if (otherClip.id === clip.id) continue
          if (Math.abs(newEndTime - otherClip.startTime) < snapThreshold) {
            newDuration = otherClip.startTime - clip.startTime
          }
          const otherEnd = otherClip.startTime + otherClip.duration
          if (Math.abs(newEndTime - otherEnd) < snapThreshold) {
            newDuration = otherEnd - clip.startTime
          }
        }
        for (const m of markers) {
          if (Math.abs(newEndTime - m.time) < snapThreshold) {
            newDuration = m.time - clip.startTime
          }
        }
      }

      // For right-edge trim, allow extending into trimEnd (revealing hidden frames)
      const maxDur = clip.type === 'image' ? Infinity : getMaxClipDuration({ ...clip, trimEnd: 0 })
      newDuration = Math.min(newDuration, maxDur)

      // Build set of linked clip IDs to also trim (skip if Ctrl-resizing independently)
      const linkedIds = resizingClip.independentResize ? new Set<string>() : new Set<string>(clip.linkedClipIds || [])
      const finalDuration = Math.max(0.5, newDuration)

      const durDelta = finalDuration - resizingClip.originalDuration
      // Adjust trimEnd: extending decreases trimEnd, shrinking increases it
      const finalTrimEnd = Math.max(0, resizingClip.originalTrimEnd - durDelta * clip.speed)

      setClips(prev => prev.map(c => {
        if (c.id === clip.id) return { ...c, duration: finalDuration, trimEnd: finalTrimEnd }
        if (linkedIds.has(c.id)) {
          // Apply same delta to linked clip's original duration to preserve trim offset
          const orig = resizingClip.linkedOriginals?.get(c.id)
          if (orig) {
            const lMaxDur = getMaxClipDuration({ ...c, trimEnd: 0 })
            const lDur = Math.min(lMaxDur, Math.max(0.5, orig.duration + durDelta))
            const lTrimEnd = Math.max(0, (c.trimEnd ?? 0) - durDelta * (orig.speed ?? c.speed))
            return { ...c, duration: lDur, trimEnd: lTrimEnd }
          }
          return c
        }
        return c
      }))
    }
  }, [resizingClip, clips, pixelsPerSecond, snapEnabled, currentTime, getMaxClipDuration])
  
  const handleResizeStart = (e: React.MouseEvent, clip: TimelineClip, edge: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()
    
    // Prevent resizing clips on locked tracks
    if (tracks[clip.trackIndex]?.locked) return
    
    const independentTrim = e.ctrlKey || e.metaKey
    setSelectedClipIds(independentTrim ? new Set([clip.id]) : expandWithLinkedClips(new Set([clip.id])))
    setSelectedTrimEdge({ clipId: clip.id, edge, independent: independentTrim })

    // Find adjacent clip at the edit point — auto-roll when two clips touch (any tool)
    let adjacentClip: TimelineClip | undefined
    const clipEnd = clip.startTime + clip.duration
    if (edge === 'right') {
      adjacentClip = clips.find(c => c.id !== clip.id && c.trackIndex === clip.trackIndex && !c.hiddenByStack && Math.abs(c.startTime - clipEnd) < 0.05)
    } else {
      adjacentClip = clips.find(c => c.id !== clip.id && c.trackIndex === clip.trackIndex && !c.hiddenByStack && Math.abs((c.startTime + c.duration) - clip.startTime) < 0.05)
    }

    
    setResizingClip({
      clipId: clip.id,
      edge,
      startX: e.clientX,
      originalStartTime: clip.startTime,
      originalDuration: clip.duration,
      originalTrimStart: clip.trimStart,
      originalTrimEnd: clip.trimEnd,
      tool: activeTool,
      adjacentClipId: adjacentClip?.id,
      adjacentOrigDuration: adjacentClip?.duration,
      adjacentOrigTrimStart: adjacentClip?.trimStart,
      adjacentOrigTrimEnd: adjacentClip?.trimEnd,
      adjacentOrigStartTime: adjacentClip?.startTime,
      independentResize: e.ctrlKey || e.metaKey,
      linkedOriginals: (() => {
        const allLinkedIds = new Set<string>(clip.linkedClipIds || [])
        if (adjacentClip?.linkedClipIds) {
          for (const lid of adjacentClip.linkedClipIds) allLinkedIds.add(lid)
        }
        if (allLinkedIds.size === 0) return undefined
        return new Map(
          [...allLinkedIds].map(lid => {
            const lc = clips.find(c => c.id === lid)
            return [lid, { startTime: lc?.startTime ?? 0, duration: lc?.duration ?? 0, trimStart: lc?.trimStart ?? 0, speed: lc?.speed ?? 1 }] as const
          })
        )
      })(),
    })
  }
  
  useEffect(() => {
    if (draggingClip || lassoRect) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [draggingClip, lassoRect, handleMouseMove, handleMouseUp])
  
  useEffect(() => {
    if (resizingClip) {
      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleResizeMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [resizingClip, handleResizeMove, handleMouseUp])
  
  // --- Slip/Slide mouse move handler ---
  const handleSlipSlideMove = useCallback((e: MouseEvent) => {
    if (!slipSlideClip) return
    
    const clip = clips.find(c => c.id === slipSlideClip.clipId)
    if (!clip) return
    
    const deltaX = e.clientX - slipSlideClip.startX
    const deltaTime = deltaX / pixelsPerSecond
    
    if (slipSlideClip.tool === 'slip') {
      // SLIP: shift source content within the clip (change trimStart/trimEnd, keep position)
      // Moving right = shift source earlier = increase trimStart, decrease trimEnd
      if (clip.type !== 'video' || !clip.asset?.duration) return

      const mediaDuration = clip.asset.duration
      const shiftAmount = deltaTime * clip.speed // convert to media time

      let newTrimStart = slipSlideClip.originalTrimStart + shiftAmount
      let newTrimEnd = slipSlideClip.originalTrimEnd - shiftAmount

      // Clamp so neither goes negative
      if (newTrimStart < 0) {
        newTrimEnd += newTrimStart
        newTrimStart = 0
      }
      if (newTrimEnd < 0) {
        newTrimStart += newTrimEnd
        newTrimEnd = 0
      }

      // Ensure trimStart + trimEnd + visible media ≤ total media duration
      const visibleMedia = clip.duration * clip.speed
      if (newTrimStart + visibleMedia + newTrimEnd > mediaDuration) {
        return // Can't slip further
      }

      const linkedMap = slipSlideClip.linkedOriginals
      setClips(prev => prev.map(c => {
        if (c.id === clip.id) {
          return { ...c, trimStart: Math.max(0, newTrimStart), trimEnd: Math.max(0, newTrimEnd) }
        }
        if (linkedMap?.has(c.id)) {
          const orig = linkedMap.get(c.id)!
          if (c.type !== 'video' || !orig.assetDuration) return c
          const lShift = deltaTime * orig.speed
          let lTrimStart = orig.trimStart + lShift
          let lTrimEnd = orig.trimEnd - lShift
          if (lTrimStart < 0) { lTrimEnd += lTrimStart; lTrimStart = 0 }
          if (lTrimEnd < 0) { lTrimStart += lTrimEnd; lTrimEnd = 0 }
          const lVisible = orig.duration * orig.speed
          if (lTrimStart + lVisible + lTrimEnd > orig.assetDuration) return c
          return { ...c, trimStart: Math.max(0, lTrimStart), trimEnd: Math.max(0, lTrimEnd) }
        }
        return c
      }))
    } else {
      // SLIDE: move clip in time, adjust neighbor durations to fill the space
      let newStartTime = slipSlideClip.originalStartTime + deltaTime
      
      // Clamp: can't go before prevClip's start (or 0)
      const minStart = slipSlideClip.prevClipId
        ? clips.find(c => c.id === slipSlideClip.prevClipId)?.startTime ?? 0
        : 0
      // Clamp: can't go past nextClip's end (or infinity)
      const nextEnd = slipSlideClip.nextClipId
        ? (slipSlideClip.nextOrigStartTime ?? 0) + (slipSlideClip.nextOrigDuration ?? 0)
        : Infinity
      newStartTime = Math.max(minStart, Math.min(nextEnd - clip.duration, newStartTime))
      
      const actualDelta = newStartTime - slipSlideClip.originalStartTime
      
      setClips(prev => prev.map(c => {
        if (c.id === clip.id) {
          return { ...c, startTime: newStartTime }
        }
        // Adjust previous clip: extend its duration
        if (slipSlideClip.prevClipId && c.id === slipSlideClip.prevClipId) {
          const newDur = (slipSlideClip.prevOrigDuration ?? c.duration) + actualDelta
          return { ...c, duration: Math.max(0.5, newDur) }
        }
        // Adjust next clip: shift start and extend duration
        if (slipSlideClip.nextClipId && c.id === slipSlideClip.nextClipId) {
          const newStart = (slipSlideClip.nextOrigStartTime ?? c.startTime) + actualDelta
          const newDur = (slipSlideClip.nextOrigDuration ?? c.duration) - actualDelta
          const newTrimStart = (slipSlideClip.nextOrigTrimStart ?? c.trimStart) + actualDelta * c.speed
          return { ...c, startTime: newStart, duration: Math.max(0.5, newDur), trimStart: Math.max(0, newTrimStart) }
        }
        return c
      }))
    }
  }, [slipSlideClip, clips, pixelsPerSecond])
  
  const handleSlipSlideUp = useCallback(() => {
    setSlipSlideClip(null)
  }, [])
  
  useEffect(() => {
    if (slipSlideClip) {
      window.addEventListener('mousemove', handleSlipSlideMove)
      window.addEventListener('mouseup', handleSlipSlideUp)
      return () => {
        window.removeEventListener('mousemove', handleSlipSlideMove)
        window.removeEventListener('mouseup', handleSlipSlideUp)
      }
    }
  }, [slipSlideClip, handleSlipSlideMove, handleSlipSlideUp])
  
  const handleTrackDrop = (e: React.DragEvent, trackIndex: number) => {
    e.preventDefault()
    
    // Check if it's a timeline being dropped (flatten on drop)
    const timelineData = e.dataTransfer.getData('timeline')
    if (timelineData && trackContainerRef.current) {
      const droppedTimeline = JSON.parse(timelineData) as { id: string; name: string }
      const sourceTimeline = timelines.find(t => t.id === droppedTimeline.id)
      if (!sourceTimeline || sourceTimeline.id === activeTimeline?.id) return
      if (sourceTimeline.clips.length === 0) return
      
      const rect = trackContainerRef.current.getBoundingClientRect()
      const scrollLeft = trackContainerRef.current.scrollLeft
      const x = e.clientX - rect.left + scrollLeft
      const dropTime = Math.max(0, x / pixelsPerSecond)
      
      // Flatten: copy all clips from the source timeline, offset to drop position
      // Find the earliest clip start in the source to compute relative offsets
      const earliestStart = sourceTimeline.clips.reduce(
        (min: number, c: any) => Math.min(min, c.startTime), Infinity
      )
      
      const newClips = sourceTimeline.clips.map((srcClip: any) => migrateClip({
        ...srcClip,
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        startTime: dropTime + (srcClip.startTime - earliestStart),
        // Remap trackIndex: offset by the drop track, but keep relative spacing
        trackIndex: Math.min(trackIndex + srcClip.trackIndex, tracks.length - 1),
      }))
      
      pushUndo()
      setClips(prev => [...prev, ...newClips])
      return
    }
    
    // Multi-asset drop (from multi-select drag) — add sequentially using addClipToTimeline
    const assetIdsJson = e.dataTransfer.getData('assetIds')
    if (assetIdsJson && trackContainerRef.current) {
      try {
        const ids: string[] = JSON.parse(assetIdsJson)
        const droppedAssets = ids.map(id => assets.find(a => a.id === id)).filter(Boolean) as Asset[]
        if (droppedAssets.length > 0) {
          const rect = trackContainerRef.current.getBoundingClientRect()
          const scrollLeft = trackContainerRef.current.scrollLeft
          const x = e.clientX - rect.left + scrollLeft
          let nextStart = Math.max(0, x / pixelsPerSecond)
          const ctrlHeld = e.ctrlKey || e.metaKey
          for (const a of droppedAssets) {
            addClipToTimeline(a, trackIndex, nextStart, ctrlHeld)
            nextStart += a.duration || 5
          }
          return
        }
      } catch { /* ignore parse errors */ }
    }
    
    // Single asset drop
    const assetId = e.dataTransfer.getData('assetId')
    const assetData = e.dataTransfer.getData('asset')
    
    let asset: Asset | undefined
    if (assetData) {
      asset = JSON.parse(assetData)
    } else if (assetId) {
      asset = assets.find(a => a.id === assetId)
    }
    
    if (asset && trackContainerRef.current) {
      const rect = trackContainerRef.current.getBoundingClientRect()
      const scrollLeft = trackContainerRef.current.scrollLeft
      const x = e.clientX - rect.left + scrollLeft
      const startTime = Math.max(0, x / pixelsPerSecond)
      addClipToTimeline(asset, trackIndex, startTime, e.ctrlKey || e.metaKey)
    }
  }
  

  return {
    draggingClip, setDraggingClip,
    resizingClip, setResizingClip,
    slipSlideClip, setSlipSlideClip,
    selectedTrimEdge, setSelectedTrimEdge,
    lassoRect, setLassoRect,
    isScrubbing,
    scrubFromEvent,
    handleRulerMouseDown,
    expandWithLinkedClips,
    handleClipMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleResizeMove,
    handleResizeStart,
    handleSlipSlideMove,
    handleSlipSlideUp,
    handleTrackDrop,
    lassoOriginRef,
  }
}
