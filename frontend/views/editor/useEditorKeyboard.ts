import { useEffect, useRef } from 'react'
import { resolveAction, type ActionId } from '../../lib/keyboard-shortcuts'
import type { TimelineClip, Track } from '../../types/project'
import { type ToolType, clampRollDelta, applyRollEdit } from './video-editor-utils'

// Frame duration at 24fps
const FRAME_DURATION = 1 / 24

const FORWARD_SPEEDS = [1, 2, 4, 8]
const REVERSE_SPEEDS = [-1, -2, -4, -8]

interface KeyboardRefs {
  kbLayoutRef: React.MutableRefObject<any>
  isKbEditorOpenRef: React.MutableRefObject<boolean>
  activePanelRef: React.MutableRefObject<'source' | 'timeline'>
  keyboardStateRef: React.MutableRefObject<{
    clips: TimelineClip[]
    selectedClipIds: Set<string>
    totalDuration: number
    selectedAssetIds: Set<string>
    currentTime: number
    inPoint: number | null
    outPoint: number | null
    selectedTrimEdge: { clipId: string; edge: 'left' | 'right'; independent?: boolean } | null
    selectedCutPoint: { leftClipId: string; rightClipId: string; time: number; trackIndex: number } | null
  }>
  clipsRef: React.MutableRefObject<TimelineClip[]>
  tracksRef: React.MutableRefObject<Track[]>
  playbackTimeRef: React.MutableRefObject<number>
  sourceVideoRef: React.MutableRefObject<HTMLVideoElement | null>
  sourceIsPlayingRef: React.MutableRefObject<boolean>
  sourceTimeRef: React.MutableRefObject<number>
  sourceSpeedRef: React.MutableRefObject<number>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  getMinZoomRef: React.MutableRefObject<() => number>
  gapGenerateModeRef: React.MutableRefObject<'text-to-video' | 'image-to-video' | 'text-to-image' | null>
  undoRef: React.MutableRefObject<() => void>
  redoRef: React.MutableRefObject<() => void>
  copyRef: React.MutableRefObject<() => void>
  pasteRef: React.MutableRefObject<() => void>
  cutRef: React.MutableRefObject<() => void>
  pushUndoRef: React.MutableRefObject<() => void>
  pushAssetUndoRef: React.MutableRefObject<() => void>
  fitToViewRef: React.MutableRefObject<() => void>
  toggleFullscreenRef: React.MutableRefObject<() => void>
  insertEditRef: React.MutableRefObject<() => void>
  overwriteEditRef: React.MutableRefObject<() => void>
  matchFrameRef: React.MutableRefObject<() => void>
}

interface KeyboardSetters {
  setActiveTool: React.Dispatch<React.SetStateAction<ToolType>>
  setLastTrimTool: React.Dispatch<React.SetStateAction<ToolType>>
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>
  setShuttleSpeed: React.Dispatch<React.SetStateAction<number>>
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  setSourceIsPlaying: (v: boolean) => void
  setSourceTime: (v: number) => void
  setSourceIn: React.Dispatch<React.SetStateAction<number | null>>
  setSourceOut: React.Dispatch<React.SetStateAction<number | null>>
  sourceShuttleForward: () => void
  sourceShuttleReverse: () => void
  sourceShuttleStop: () => void
  setInPoint: (updater: (prev: number | null) => number | null) => void
  setOutPoint: (updater: (prev: number | null) => number | null) => void
  clearInOut: () => void
  setZoom: React.Dispatch<React.SetStateAction<number>>
  setSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setGapGenerateMode: React.Dispatch<React.SetStateAction<'text-to-video' | 'image-to-video' | 'text-to-image' | null>>
  setSelectedGap: (v: any) => void
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSelectedTrimEdge: React.Dispatch<React.SetStateAction<{ clipId: string; edge: 'left' | 'right'; independent?: boolean } | null>>
  setSelectedCutPoint: React.Dispatch<React.SetStateAction<{ leftClipId: string; rightClipId: string; time: number; trackIndex: number } | null>>
}

interface KeyboardContext {
  selectedGap: { trackIndex: number; startTime: number; endTime: number } | null
  selectedSubtitleId: string | null
  editingSubtitleId: string | null
  currentProjectId: string | null
  deleteSubtitleRef: React.MutableRefObject<(id: string) => void>
  deleteAsset: (projectId: string, assetId: string) => void
  deleteGapRef: React.MutableRefObject<(gap: { trackIndex: number; startTime: number; endTime: number }) => void>
}

export interface UseEditorKeyboardParams {
  refs: KeyboardRefs
  setters: KeyboardSetters
  context: KeyboardContext
}

export function useEditorKeyboard(params: UseEditorKeyboardParams) {
  const { refs, setters, context } = params
  const kHeldRef = useRef(false)
  const contextRef = useRef(context)
  contextRef.current = context

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (refs.isKbEditorOpenRef.current) return

      const context = contextRef.current
      const { clips: c, selectedClipIds: sel, totalDuration: td, selectedAssetIds: selAssets } = refs.keyboardStateRef.current

      const action: ActionId | null = resolveAction(refs.kbLayoutRef.current, e)
      if (!action) return

      e.preventDefault()

      const { selectedTrimEdge, selectedCutPoint } = refs.keyboardStateRef.current

      switch (action) {
        // Tools
        case 'tool.select':       setters.setActiveTool('select'); break
        case 'tool.blade':        setters.setActiveTool('blade'); break
        case 'tool.ripple':       setters.setActiveTool('ripple'); setters.setLastTrimTool('ripple'); break
        case 'tool.roll':         setters.setActiveTool('roll'); setters.setLastTrimTool('roll'); break
        case 'tool.slide':        setters.setActiveTool('slide'); setters.setLastTrimTool('slide'); break
        case 'tool.slip':         setters.setActiveTool('slip'); setters.setLastTrimTool('slip'); break
        case 'tool.trackForward': setters.setActiveTool('trackForward'); break

        // Transport — panel-aware
        case 'transport.playPause':
          if (refs.activePanelRef.current === 'source') {
            // Stop timeline playback when starting source playback
            setters.setIsPlaying(false)
            setters.setShuttleSpeed(0)
            if (refs.sourceIsPlayingRef.current) {
              refs.sourceVideoRef.current?.pause()
              setters.setSourceIsPlaying(false)
            } else {
              if (refs.sourceVideoRef.current) refs.sourceVideoRef.current.play().catch(() => {})
              setters.setSourceIsPlaying(true)
            }
          } else {
            // Stop source playback when starting timeline playback
            if (refs.sourceIsPlayingRef.current) {
              refs.sourceVideoRef.current?.pause()
              setters.setSourceIsPlaying(false)
            }
            setters.setShuttleSpeed(0)
            setters.setIsPlaying(p => !p)
          }
          break

        case 'transport.shuttleReverse':
          if (refs.activePanelRef.current === 'source') {
            if (kHeldRef.current) {
              // K+J = step back one frame
              setters.sourceShuttleStop()
              if (refs.sourceVideoRef.current) {
                const kjTime = Math.max(0, refs.sourceTimeRef.current - FRAME_DURATION)
                refs.sourceTimeRef.current = kjTime
                refs.sourceVideoRef.current.currentTime = kjTime
                setters.setSourceTime(kjTime)
              }
            } else {
              setters.sourceShuttleReverse()
            }
          } else {
            if (kHeldRef.current) {
              setters.setIsPlaying(false); setters.setShuttleSpeed(0)
              setters.setCurrentTime(prev => Math.max(0, prev - FRAME_DURATION))
            } else {
              setters.setShuttleSpeed(prev => {
                if (prev > 0) return -1
                const idx = REVERSE_SPEEDS.indexOf(prev)
                const nextIdx = idx >= 0 ? Math.min(idx + 1, REVERSE_SPEEDS.length - 1) : 0
                return REVERSE_SPEEDS[nextIdx]
              })
              setters.setIsPlaying(true)
            }
          }
          break

        case 'transport.shuttleStop':
          if (refs.activePanelRef.current === 'source') {
            kHeldRef.current = true
            setters.sourceShuttleStop()
          } else {
            kHeldRef.current = true
            setters.setShuttleSpeed(0)
            setters.setIsPlaying(false)
          }
          break

        case 'transport.shuttleForward':
          if (refs.activePanelRef.current === 'source') {
            if (kHeldRef.current) {
              // K+L = step forward one frame
              setters.sourceShuttleStop()
              if (refs.sourceVideoRef.current) {
                const klTime = Math.min(refs.sourceVideoRef.current.duration || 0, refs.sourceTimeRef.current + FRAME_DURATION)
                refs.sourceTimeRef.current = klTime
                refs.sourceVideoRef.current.currentTime = klTime
                setters.setSourceTime(klTime)
              }
            } else {
              setters.sourceShuttleForward()
            }
          } else {
            if (kHeldRef.current) {
              setters.setIsPlaying(false); setters.setShuttleSpeed(0)
              setters.setCurrentTime(prev => Math.min(td, prev + FRAME_DURATION))
            } else {
              setters.setShuttleSpeed(prev => {
                if (prev < 0) return 1
                const idx = FORWARD_SPEEDS.indexOf(prev)
                const nextIdx = idx >= 0 ? Math.min(idx + 1, FORWARD_SPEEDS.length - 1) : 0
                return FORWARD_SPEEDS[nextIdx]
              })
              setters.setIsPlaying(true)
            }
          }
          break

        case 'transport.stepBackward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            // Update ref immediately so rapid key repeat works (React setState is async)
            const stepBackTime = Math.max(0, refs.sourceTimeRef.current - FRAME_DURATION)
            refs.sourceTimeRef.current = stepBackTime
            refs.sourceVideoRef.current.currentTime = stepBackTime
            setters.setSourceTime(stepBackTime)
          } else {
            setters.setCurrentTime(prev => Math.max(0, prev - FRAME_DURATION))
          }
          break

        case 'transport.stepForward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            const stepFwdTime = Math.min(refs.sourceVideoRef.current.duration || 0, refs.sourceTimeRef.current + FRAME_DURATION)
            refs.sourceTimeRef.current = stepFwdTime
            refs.sourceVideoRef.current.currentTime = stepFwdTime
            setters.setSourceTime(stepFwdTime)
          } else {
            setters.setCurrentTime(prev => Math.min(td, prev + FRAME_DURATION))
          }
          break

        case 'transport.jumpBackward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            refs.sourceVideoRef.current.currentTime = Math.max(0, refs.sourceVideoRef.current.currentTime - 1)
            setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
          } else {
            setters.setCurrentTime(prev => Math.max(0, prev - 1))
          }
          break

        case 'transport.jumpForward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            refs.sourceVideoRef.current.currentTime = Math.min(refs.sourceVideoRef.current.duration || 0, refs.sourceVideoRef.current.currentTime + 1)
            setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
          } else {
            setters.setCurrentTime(prev => Math.min(td, prev + 1))
          }
          break

        case 'transport.goToStart':
          setters.setCurrentTime(0); setters.setIsPlaying(false); setters.setShuttleSpeed(0)
          break
        case 'transport.goToEnd':
          setters.setCurrentTime(td); setters.setIsPlaying(false); setters.setShuttleSpeed(0)
          break
        case 'transport.goToIn': {
          const { inPoint, clips } = refs.keyboardStateRef.current
          const target = inPoint ?? (clips.length > 0 ? Math.min(...clips.map(c => c.startTime)) : 0)
          setters.setIsPlaying(false); setters.setShuttleSpeed(0); setters.setCurrentTime(target)
          break
        }
        case 'transport.goToOut': {
          const { outPoint, clips: clipsOut, totalDuration: tdOut } = refs.keyboardStateRef.current
          const target = outPoint ?? (clipsOut.length > 0 ? Math.max(...clipsOut.map(c => c.startTime + c.duration)) : tdOut)
          setters.setIsPlaying(false); setters.setShuttleSpeed(0); setters.setCurrentTime(target)
          break
        }

        // Editing
        case 'edit.undo':    refs.undoRef.current(); break
        case 'edit.redo':    refs.redoRef.current(); break
        case 'edit.cut':     refs.cutRef.current(); break
        case 'edit.copy':    refs.copyRef.current(); break
        case 'edit.paste':   refs.pasteRef.current(); break
        case 'edit.selectAll':
          setters.setSelectedClipIds(new Set(c.map(cl => cl.id)))
          break
        case 'edit.deselect':
          setters.setSelectedTrimEdge(null)
          setters.setSelectedCutPoint(null)
          if (refs.gapGenerateModeRef.current) {
            setters.setGapGenerateMode(null); setters.setSelectedGap(null)
          } else {
            setters.setSelectedClipIds(new Set())
          }
          break
        case 'edit.delete':
          if (sel.size > 0) {
            refs.pushUndoRef.current()
            const deleteIds = new Set<string>()
            for (const id of sel) {
              const clip = refs.clipsRef.current.find(cl => cl.id === id)
              if (clip && refs.tracksRef.current[clip.trackIndex]?.locked) continue
              deleteIds.add(id)
              if (clip?.linkedClipIds) {
                const allLinkedSelected = clip.linkedClipIds.every(lid => sel.has(lid))
                if (allLinkedSelected) clip.linkedClipIds.forEach(lid => deleteIds.add(lid))
              }
            }
            setters.setClips(prev => prev.filter(cl => !deleteIds.has(cl.id)).map(cl => {
              if (!cl.linkedClipIds) return cl
              const remaining = cl.linkedClipIds.filter(lid => !deleteIds.has(lid))
              return { ...cl, linkedClipIds: remaining.length ? remaining : undefined }
            }))
            setters.setSelectedClipIds(new Set())
          } else if (context.selectedGap) {
            refs.pushUndoRef.current(); context.deleteGapRef.current(context.selectedGap)
          } else if (context.selectedSubtitleId && !context.editingSubtitleId) {
            context.deleteSubtitleRef.current(context.selectedSubtitleId)
          } else if (selAssets.size > 0 && context.currentProjectId) {
            refs.pushAssetUndoRef.current()
            selAssets.forEach(id => context.deleteAsset(context.currentProjectId!, id))
            setters.setSelectedAssetIds(new Set())
          }
          break
        case 'edit.insertEdit':
          if (selectedCutPoint) {
            // Rolling edit: move cut point backward by 1 frame (shrink left clip, extend right clip earlier)
            refs.pushUndoRef.current()
            const dt = -FRAME_DURATION
            const independent = e.ctrlKey || e.metaKey
            setters.setClips(prev => {
              const leftCl = prev.find(cl => cl.id === selectedCutPoint.leftClipId)
              const rightCl = prev.find(cl => cl.id === selectedCutPoint.rightClipId)
              if (!leftCl || !rightCl) return prev
              const clamped = clampRollDelta(dt, leftCl, rightCl)
              if (clamped === 0) return prev
              const leftLinkedIds = independent ? new Set<string>() : new Set<string>(leftCl.linkedClipIds || [])
              const rightLinkedIds = independent ? new Set<string>() : new Set<string>(rightCl.linkedClipIds || [])
              const origLeft = { duration: leftCl.duration, trimEnd: leftCl.trimEnd, speed: leftCl.speed }
              const origRight = { startTime: rightCl.startTime, duration: rightCl.duration, trimStart: rightCl.trimStart, speed: rightCl.speed }
              return prev.map(cl => {
                const rolled = applyRollEdit(cl, selectedCutPoint.leftClipId, selectedCutPoint.rightClipId, clamped, origLeft, origRight)
                if (rolled !== cl) return rolled
                if (leftLinkedIds.has(cl.id)) return applyRollEdit(cl, cl.id, '', clamped, { duration: cl.duration, trimEnd: cl.trimEnd, speed: cl.speed }, origRight)
                if (rightLinkedIds.has(cl.id)) return applyRollEdit(cl, '', cl.id, clamped, origLeft, { startTime: cl.startTime, duration: cl.duration, trimStart: cl.trimStart, speed: cl.speed })
                return cl
              })
            })
            setters.setSelectedCutPoint(prev => prev && { ...prev, time: prev.time - FRAME_DURATION })
          } else if (selectedTrimEdge) {
            // Nudge trim edge backward by 1 frame (include linked clips unless independently selected)
            refs.pushUndoRef.current()
            const { clipId: trimId, edge: trimEdge } = selectedTrimEdge
            const trimClip = refs.clipsRef.current.find(cl => cl.id === trimId)
            const linkedIds = (selectedTrimEdge.independent || !trimClip?.linkedClipIds) ? new Set<string>() : new Set<string>(trimClip.linkedClipIds)
            setters.setClips(prev => prev.map(cl => {
              if (cl.id !== trimId && !linkedIds.has(cl.id)) return cl
              if (trimEdge === 'left') {
                const newStart = Math.max(0, cl.startTime - FRAME_DURATION)
                const delta = cl.startTime - newStart
                return { ...cl, startTime: newStart, duration: cl.duration + delta, trimStart: Math.max(0, cl.trimStart - delta * cl.speed) }
              } else {
                return { ...cl, duration: Math.max(0.5, cl.duration - FRAME_DURATION) }
              }
            }))
          } else if (sel.size > 0) {
            // Nudge selected clips (and their linked partners) backward by 1 frame
            refs.pushUndoRef.current()
            const nudgeBackIds = new Set(sel)
            for (const id of sel) {
              const clip = refs.clipsRef.current.find(cl => cl.id === id)
              clip?.linkedClipIds?.forEach(lid => nudgeBackIds.add(lid))
            }
            setters.setClips(prev => prev.map(cl =>
              nudgeBackIds.has(cl.id) ? { ...cl, startTime: Math.max(0, cl.startTime - FRAME_DURATION) } : cl
            ))
          } else {
            refs.insertEditRef.current()
          }
          break
        case 'edit.overwriteEdit':
          if (selectedCutPoint) {
            // Rolling edit: move cut point forward by 1 frame (extend left clip tail, shrink right clip head)
            refs.pushUndoRef.current()
            const dt2 = FRAME_DURATION
            const independent2 = e.ctrlKey || e.metaKey
            setters.setClips(prev => {
              const leftCl = prev.find(cl => cl.id === selectedCutPoint.leftClipId)
              const rightCl = prev.find(cl => cl.id === selectedCutPoint.rightClipId)
              if (!leftCl || !rightCl) return prev
              const clamped = clampRollDelta(dt2, leftCl, rightCl)
              if (clamped === 0) return prev
              const leftLinkedIds2 = independent2 ? new Set<string>() : new Set<string>(leftCl.linkedClipIds || [])
              const rightLinkedIds2 = independent2 ? new Set<string>() : new Set<string>(rightCl.linkedClipIds || [])
              const origLeft = { duration: leftCl.duration, trimEnd: leftCl.trimEnd, speed: leftCl.speed }
              const origRight = { startTime: rightCl.startTime, duration: rightCl.duration, trimStart: rightCl.trimStart, speed: rightCl.speed }
              return prev.map(cl => {
                const rolled = applyRollEdit(cl, selectedCutPoint.leftClipId, selectedCutPoint.rightClipId, clamped, origLeft, origRight)
                if (rolled !== cl) return rolled
                if (leftLinkedIds2.has(cl.id)) return applyRollEdit(cl, cl.id, '', clamped, { duration: cl.duration, trimEnd: cl.trimEnd, speed: cl.speed }, origRight)
                if (rightLinkedIds2.has(cl.id)) return applyRollEdit(cl, '', cl.id, clamped, origLeft, { startTime: cl.startTime, duration: cl.duration, trimStart: cl.trimStart, speed: cl.speed })
                return cl
              })
            })
            setters.setSelectedCutPoint(prev => prev && { ...prev, time: prev.time + FRAME_DURATION })
          } else if (selectedTrimEdge) {
            // Nudge trim edge forward by 1 frame (include linked clips unless independently selected)
            refs.pushUndoRef.current()
            const { clipId: trimId2, edge: trimEdge2 } = selectedTrimEdge
            const trimClip2 = refs.clipsRef.current.find(cl => cl.id === trimId2)
            const linkedIds2 = (selectedTrimEdge.independent || !trimClip2?.linkedClipIds) ? new Set<string>() : new Set<string>(trimClip2.linkedClipIds)
            setters.setClips(prev => prev.map(cl => {
              if (cl.id !== trimId2 && !linkedIds2.has(cl.id)) return cl
              if (trimEdge2 === 'left') {
                const newStart = cl.startTime + FRAME_DURATION
                const newDur = cl.duration - FRAME_DURATION
                if (newDur < 0.5) return cl
                return { ...cl, startTime: newStart, duration: newDur, trimStart: cl.trimStart + FRAME_DURATION * cl.speed }
              } else {
                return { ...cl, duration: cl.duration + FRAME_DURATION }
              }
            }))
          } else if (sel.size > 0) {
            // Nudge selected clips (and their linked partners) forward by 1 frame
            refs.pushUndoRef.current()
            const nudgeFwdIds = new Set(sel)
            for (const id of sel) {
              const clip = refs.clipsRef.current.find(cl => cl.id === id)
              clip?.linkedClipIds?.forEach(lid => nudgeFwdIds.add(lid))
            }
            setters.setClips(prev => prev.map(cl =>
              nudgeFwdIds.has(cl.id) ? { ...cl, startTime: cl.startTime + FRAME_DURATION } : cl
            ))
          } else {
            refs.overwriteEditRef.current()
          }
          break
        case 'edit.matchFrame':    refs.matchFrameRef.current(); break

        // Marking — panel-aware
        case 'mark.setIn':
          if (refs.activePanelRef.current === 'source') {
            const st = refs.sourceTimeRef.current
            setters.setSourceIn(prev => prev !== null && Math.abs(prev - st) < 0.01 ? null : st)
          } else {
            setters.setInPoint(prev => {
              const { currentTime: ct } = refs.keyboardStateRef.current
              if (prev !== null && Math.abs(prev - ct) < 0.01) return null
              return ct
            })
          }
          break
        case 'mark.setOut':
          if (refs.activePanelRef.current === 'source') {
            const st = refs.sourceTimeRef.current
            setters.setSourceOut(prev => prev !== null && Math.abs(prev - st) < 0.01 ? null : st)
          } else {
            setters.setOutPoint(prev => {
              const { currentTime: ct } = refs.keyboardStateRef.current
              if (prev !== null && Math.abs(prev - ct) < 0.01) return null
              return ct
            })
          }
          break
        case 'mark.clearIn':
          if (refs.activePanelRef.current === 'source') {
            setters.setSourceIn(null)
          } else {
            setters.setInPoint(() => null)
          }
          break
        case 'mark.clearOut':
          if (refs.activePanelRef.current === 'source') {
            setters.setSourceOut(null)
          } else {
            setters.setOutPoint(() => null)
          }
          break
        case 'mark.clearInOut':
          if (refs.activePanelRef.current === 'source') {
            setters.setSourceIn(null); setters.setSourceOut(null)
          } else {
            setters.clearInOut()
          }
          break

        // Timeline
        case 'timeline.zoomIn':
          refs.centerOnPlayheadRef.current = true
          setters.setZoom(prev => Math.min(4, +(prev + 0.25).toFixed(2)))
          break
        case 'timeline.zoomOut':
          refs.centerOnPlayheadRef.current = true
          setters.setZoom(prev => Math.max(refs.getMinZoomRef.current(), +(prev - 0.25).toFixed(2)))
          break
        case 'timeline.fitToView':
          refs.fitToViewRef.current()
          break
        case 'timeline.toggleSnap':
          setters.setSnapEnabled(prev => !prev)
          break
        case 'nav.prevEdit': {
          const editPts = new Set<number>()
          editPts.add(0)
          for (const cl of refs.clipsRef.current) {
            editPts.add(Math.round(cl.startTime * 1000) / 1000)
            editPts.add(Math.round((cl.startTime + cl.duration) * 1000) / 1000)
          }
          const sortedPrev = Array.from(editPts).sort((a, b) => a - b)
          const ct = Math.round(refs.playbackTimeRef.current * 1000) / 1000
          let prev = sortedPrev[0]
          for (const ep of sortedPrev) {
            if (ep < ct - 0.01) prev = ep
            else break
          }
          setters.setIsPlaying(false)
          setters.setCurrentTime(prev)
          break
        }
        case 'nav.nextEdit': {
          const editPts2 = new Set<number>()
          for (const cl of refs.clipsRef.current) {
            editPts2.add(Math.round(cl.startTime * 1000) / 1000)
            editPts2.add(Math.round((cl.startTime + cl.duration) * 1000) / 1000)
          }
          const sortedNext = Array.from(editPts2).sort((a, b) => a - b)
          const ct2 = Math.round(refs.playbackTimeRef.current * 1000) / 1000
          let next = sortedNext[sortedNext.length - 1]
          for (const ep of sortedNext) {
            if (ep > ct2 + 0.01) { next = ep; break }
          }
          setters.setIsPlaying(false)
          setters.setCurrentTime(next)
          break
        }
        case 'view.fullscreen':
          refs.toggleFullscreenRef.current()
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k') {
        kHeldRef.current = false
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, []) // stable - uses refs for latest state
}
