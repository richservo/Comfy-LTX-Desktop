import { useCallback } from 'react'
import type { Asset, TimelineClip, Track, TransitionType, SubtitleClip, ClipEffect, EffectType, TextOverlayStyle } from '../../types/project'
import { DEFAULT_COLOR_CORRECTION, DEFAULT_LETTERBOX, EFFECT_DEFINITIONS, DEFAULT_TEXT_STYLE } from '../../types/project'
import type { ParsedTimeline } from '../../lib/timeline-import'
import { exportFcp7Xml } from '../../lib/timeline-import'
import { resolveOverlaps, DEFAULT_DISSOLVE_DURATION } from './video-editor-utils'
import { splitKeyframes } from '../../lib/volume-automation'

interface UseClipOperationsParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  tracks: Track[]
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>
  subtitles: SubtitleClip[]
  setSubtitles: React.Dispatch<React.SetStateAction<SubtitleClip[]>>
  assets: Asset[]
  currentTime: number
  setCurrentTime: (time: number) => void
  currentProjectId: string | null
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSelectedSubtitleId: (id: string | null) => void
  pushUndo: (c?: any) => void
  pushTrackUndo: () => void
  addAsset: (projectId: string, data: any) => Asset
  addTimeline: (projectId: string, name: string) => any
  updateTimeline: (projectId: string, timelineId: string, data: any) => void
  setActiveTimeline: (projectId: string, timelineId: string) => void
  setOpenTimelineIds: React.Dispatch<React.SetStateAction<Set<string>>>
  activeTimeline: any
  fileInputRef: React.RefObject<HTMLInputElement>
  setHoveredCutPoint: (point: any) => void
}

export function useClipOperations(params: UseClipOperationsParams) {
  const {
    clips, setClips, tracks, setTracks, setSubtitles,
    assets, currentTime, setCurrentTime, currentProjectId,
    setSelectedClipIds, setSelectedSubtitleId,
    pushUndo, pushTrackUndo, addAsset, addTimeline, updateTimeline,
    setActiveTimeline, setOpenTimelineIds, activeTimeline,
    fileInputRef, setHoveredCutPoint,
  } = params

  // Check whether a time range is free of clips on a given track
  const isTrackFreeAt = (tIdx: number, start: number, duration: number, existingClips: TimelineClip[]): boolean => {
    const end = start + duration
    return !existingClips.some(c =>
      c.trackIndex === tIdx && c.startTime < end && c.startTime + c.duration > start
    )
  }

  // Find the next free track of a given kind.
  // Tries preferredIdx first, then searches all tracks of the same kind (ascending index).
  // Creates a new track if all existing ones are occupied.
  const findFreeTrack = (
    kind: 'video' | 'audio',
    preferredIdx: number,
    start: number,
    duration: number,
    existingClips: TimelineClip[],
    currentTracks: Track[],
  ): { trackIndex: number; newTrack?: Track } => {
    // Collect all candidate tracks of the matching kind
    const candidates = currentTracks
      .map((t, i) => ({ track: t, index: i }))
      .filter(e => e.track.kind === kind && !e.track.locked)

    // If preferred track is the right kind and free, use it
    const preferredTrack = currentTracks[preferredIdx]
    if (preferredTrack?.kind === kind && !preferredTrack.locked &&
        isTrackFreeAt(preferredIdx, start, duration, existingClips)) {
      return { trackIndex: preferredIdx }
    }

    // Search all tracks of this kind, starting from the first (lowest)
    for (const c of candidates) {
      if (isTrackFreeAt(c.index, start, duration, existingClips)) {
        return { trackIndex: c.index }
      }
    }

    // All existing tracks occupied — create a new one
    const count = candidates.length
    const prefix = kind === 'audio' ? 'A' : 'V'
    const newTrack: Track = {
      id: `track-${Date.now()}-${kind}`,
      name: `${prefix}${count + 1}`,
      muted: false,
      locked: false,
      kind,
    }
    return { trackIndex: currentTracks.length, newTrack }
  }

  const addClipToTimeline = (asset: Asset, trackIndex: number = 0, startTime?: number, overwrite?: boolean) => {
    const isAdjustment = asset.type === 'adjustment'
    const isVideoAsset = asset.type === 'video'
    const isAudioAsset = asset.type === 'audio'
    const isImageAsset = asset.type === 'image'

    const createVideoClip = isVideoAsset || isImageAsset || isAdjustment
    const createAudioClip = isVideoAsset && !isAdjustment

    if (!createVideoClip && !isAudioAsset) return

    let clipStartTime = startTime
    if (clipStartTime === undefined) {
      const trackClips = clips.filter(c => c.trackIndex === trackIndex)
      clipStartTime = trackClips.reduce((max, clip) =>
        Math.max(max, clip.startTime + clip.duration), 0
      )
    }

    const clipDuration = (asset.duration && isFinite(asset.duration) && asset.duration > 0)
      ? asset.duration : (isAdjustment ? 10 : 5)
    const videoClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const audioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).substr(2, 9)}`

    let currentTracks = [...tracks]
    const tracksToAdd: Track[] = []

    // Resolve preferred video track: use drop target if it's a video track, otherwise first video track
    const preferredVideo = (currentTracks[trackIndex]?.kind === 'video' && !currentTracks[trackIndex]?.locked)
      ? trackIndex
      : currentTracks.findIndex(t => t.kind === 'video' && !t.locked)
    // Resolve preferred audio track: first unlocked audio track
    const preferredAudio = currentTracks.findIndex(t => t.kind === 'audio' && !t.locked)

    let videoTrackIdx = preferredVideo >= 0 ? preferredVideo : 0
    let audioTrackIndex = -1

    if (overwrite) {
      // Ctrl+drop: place directly on target track, overwriting existing clips
      if (createAudioClip || isAudioAsset) {
        if (preferredAudio >= 0) {
          audioTrackIndex = preferredAudio
        } else {
          const audioTrackCount = currentTracks.filter(t => t.kind === 'audio').length
          const newAudioTrack: Track = {
            id: `track-${Date.now()}-audio`,
            name: `A${audioTrackCount + 1}`,
            muted: false,
            locked: false,
            kind: 'audio',
          }
          audioTrackIndex = currentTracks.length
          tracksToAdd.push(newAudioTrack)
          currentTracks = [...currentTracks, newAudioTrack]
        }
      }
    } else {
      // Default: find free tracks (non-destructive)
      if (createVideoClip) {
        const result = findFreeTrack('video', videoTrackIdx, clipStartTime, clipDuration, clips, currentTracks)
        videoTrackIdx = result.trackIndex
        if (result.newTrack) {
          tracksToAdd.push(result.newTrack)
          currentTracks = [...currentTracks, result.newTrack]
        }
      }

      if (createAudioClip || isAudioAsset) {
        if (preferredAudio >= 0) {
          const result = findFreeTrack('audio', preferredAudio, clipStartTime, clipDuration, clips, currentTracks)
          audioTrackIndex = result.trackIndex
          if (result.newTrack) {
            tracksToAdd.push(result.newTrack)
            currentTracks = [...currentTracks, result.newTrack]
          }
        } else {
          const audioTrackCount = currentTracks.filter(t => t.kind === 'audio').length
          const newAudioTrack: Track = {
            id: `track-${Date.now()}-audio`,
            name: `A${audioTrackCount + 1}`,
            muted: false,
            locked: false,
            kind: 'audio',
          }
          audioTrackIndex = currentTracks.length
          tracksToAdd.push(newAudioTrack)
          currentTracks = [...currentTracks, newAudioTrack]
        }
      }
    }

    if (tracksToAdd.length > 0) {
      setTracks(prev => [...prev, ...tracksToAdd])
    }

    const newClips: TimelineClip[] = []

    if (createVideoClip) {
      const newClip: TimelineClip = {
        id: videoClipId,
        assetId: asset.id,
        type: isAdjustment ? 'adjustment' : isVideoAsset ? 'video' : isAudioAsset ? 'audio' : 'image',
        startTime: clipStartTime,
        duration: clipDuration,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        reversed: false,
        muted: false,
        volume: 1,
        trackIndex: videoTrackIdx,
        asset,
        flipH: false,
        flipV: false,
        transitionIn: { type: 'none', duration: isAdjustment ? 0 : 0.5 },
        transitionOut: { type: 'none', duration: isAdjustment ? 0 : 0.5 },
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
        opacity: 100,
        ...(isAdjustment ? { letterbox: { ...DEFAULT_LETTERBOX } } : {}),
        ...(createAudioClip && audioTrackIndex >= 0 ? { linkedClipIds: [audioClipId] } : {}),
      }
      newClips.push(newClip)
    }

    if ((createAudioClip || isAudioAsset) && audioTrackIndex >= 0) {
      const audioClip: TimelineClip = {
        id: audioClipId,
        assetId: asset.id,
        type: 'audio',
        startTime: clipStartTime,
        duration: clipDuration,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        reversed: false,
        muted: false,
        volume: 1,
        trackIndex: audioTrackIndex,
        asset,
        flipH: false,
        flipV: false,
        transitionIn: { type: 'none', duration: 0.5 },
        transitionOut: { type: 'none', duration: 0.5 },
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
        opacity: 100,
        ...(createVideoClip ? { linkedClipIds: [videoClipId] } : {}),
      }
      newClips.push(audioClip)
    }

    if (newClips.length === 0) return null

    pushUndo()
    if (overwrite) {
      const newIds = new Set(newClips.map(c => c.id))
      setClips(prev => resolveOverlaps([...prev, ...newClips], newIds))
    } else {
      setClips(prev => [...prev, ...newClips])
    }

    return videoClipId
  }
  
  const importFiles = async (files: File[]) => {
    if (!currentProjectId) return

    for (const file of files) {
      const isVideo = file.type.startsWith('video/')
      const isAudio = file.type.startsWith('audio/')
      const isImage = file.type.startsWith('image/')

      if (!isVideo && !isAudio && !isImage) continue

      // In Electron, File objects have a .path property with the full filesystem path
      const electronFilePath = (file as any).path as string | undefined

      let persistentUrl: string
      let persistentPath: string

      if (electronFilePath) {
        // Reference the original file in place (no copy)
        const normalized = electronFilePath.replace(/\\/g, '/')
        persistentUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
        persistentPath = electronFilePath
        // Approve path so IPC file reads (audio decode, etc.) pass validation
        window.electronAPI?.approvePath?.(electronFilePath)
      } else {
        // Non-Electron environment: use blob URL
        persistentUrl = URL.createObjectURL(file)
        persistentPath = file.name
      }

      let duration = 5
      if (isVideo || isAudio) {
        duration = await getMediaDuration(persistentUrl, isAudio)
      }

      addAsset(currentProjectId, {
        type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
        path: persistentPath,
        url: persistentUrl,
        prompt: `Imported: ${file.name}`,
        resolution: 'imported',
        duration,
      })
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    await importFiles(Array.from(files))
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    await importFiles(Array.from(files))
  }
  
  const getMediaDuration = (url: string, isAudio = false): Promise<number> => {
    return new Promise((resolve) => {
      const media = document.createElement(isAudio ? 'audio' : 'video')
      const timeout = setTimeout(() => { media.src = ''; resolve(5) }, 10000)
      media.src = url
      media.onloadedmetadata = () => {
        clearTimeout(timeout)
        const d = media.duration
        resolve(d && isFinite(d) && d > 0 ? d : 5)
      }
      media.onerror = () => { clearTimeout(timeout); resolve(5) }
    })
  }

  const updateClip = (clipId: string, updates: Partial<TimelineClip>) => {
    pushUndo()
    setClips(clips.map(c => c.id === clipId ? { ...c, ...updates } : c))
  }

  const addEffectToClip = (clipId: string, effectType: EffectType) => {
    const def = EFFECT_DEFINITIONS[effectType]
    if (!def) return
    const newEffect: ClipEffect = {
      id: `fx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      type: effectType,
      enabled: true,
      params: { ...def.defaultParams },
    }
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    updateClip(clipId, { effects: [...(clip.effects || []), newEffect] })
  }

  const removeEffectFromClip = (clipId: string, effectId: string) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip?.effects) return
    updateClip(clipId, { effects: clip.effects.filter(fx => fx.id !== effectId) })
  }

  const updateEffectOnClip = (clipId: string, effectId: string, updates: Partial<ClipEffect>) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip?.effects) return
    updateClip(clipId, {
      effects: clip.effects.map(fx => fx.id === effectId ? { ...fx, ...updates } : fx),
    })
  }

  const duplicateClip = (clipId: string) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    pushUndo()
    
    const newClip: TimelineClip = {
      ...clip,
      id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: clip.startTime + clip.duration,
    }
    setClips([...clips, newClip])
  }
  
  const splitClipAtPlayhead = (clipId: string, atTime?: number, batchClipIds?: string[]) => {
    // Determine which clips to split: either a single clip or a batch
    const idsToSplit = batchClipIds || [clipId]
    const effectiveTime = atTime !== undefined ? atTime : currentTime
    
    // Validate at least one clip is splittable
    const splittable = idsToSplit.filter(id => {
      const c = clips.find(cl => cl.id === id)
      if (!c) return false
      if (tracks[c.trackIndex]?.locked) return false
      const sp = effectiveTime - c.startTime
      return sp > 0.1 && sp < c.duration - 0.1
    })
    if (splittable.length === 0) return
    
    pushUndo()
    
    // Track which IDs have already been split (to avoid splitting linked clips twice)
    const alreadySplit = new Set<string>()
    let newClips = [...clips]
    
    for (const splitId of splittable) {
      if (alreadySplit.has(splitId)) continue
      
      const clip = newClips.find(c => c.id === splitId)
      if (!clip) continue
      
      const splitPoint = effectiveTime - clip.startTime
      if (splitPoint <= 0.1 || splitPoint >= clip.duration - 0.1) continue
      
      alreadySplit.add(splitId)
      
      const firstHalfId = clip.id
      const secondHalfId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      // Collect all linked clips
      const linkedClips = (clip.linkedClipIds || [])
        .map(lid => newClips.find(c => c.id === lid))
        .filter((c): c is TimelineClip => !!c)
      
      // Split volume automation keyframes at the media-time split point
      const splitMediaTime = clip.trimStart + splitPoint
      const [kfBefore, kfAfter] = splitKeyframes(clip.volumeAutomation, splitMediaTime, clip.volume)

      const firstHalf: TimelineClip = {
        ...clip,
        duration: splitPoint,
        trimEnd: clip.trimEnd + (clip.duration - splitPoint),
        volumeAutomation: kfBefore,
        // Keep original transitionIn on the first half, clear transitionOut at the split point
        transitionOut: { type: 'none', duration: 0.5 },
      }

      const secondHalf: TimelineClip = {
        ...clip,
        id: secondHalfId,
        startTime: clip.startTime + splitPoint,
        duration: clip.duration - splitPoint,
        trimStart: clip.trimStart + splitPoint,
        volumeAutomation: kfAfter,
        // Keep original transitionOut on the second half, clear transitionIn at the split point
        transitionIn: { type: 'none', duration: 0.5 },
      }
      
      newClips = newClips.map(c => c.id === splitId ? firstHalf : c).concat(secondHalf)
      
      // Split each linked clip in sync and rebuild links
      const firstHalfLinkedIds: string[] = []
      const secondHalfLinkedIds: string[] = []
      
      for (const linkedClip of linkedClips) {
        alreadySplit.add(linkedClip.id)
        
        const linkedSplitPoint = effectiveTime - linkedClip.startTime
        if (linkedSplitPoint <= 0.01 || linkedSplitPoint >= linkedClip.duration - 0.01) {
          firstHalfLinkedIds.push(linkedClip.id)
          continue
        }
        
        const linkedSecondId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${linkedClip.id.slice(-4)}`
        
        firstHalfLinkedIds.push(linkedClip.id)
        secondHalfLinkedIds.push(linkedSecondId)
        
        const linkedSplitMedia = linkedClip.trimStart + linkedSplitPoint
        const [linkedKfBefore, linkedKfAfter] = splitKeyframes(linkedClip.volumeAutomation, linkedSplitMedia, linkedClip.volume)

        const linkedFirstHalf: TimelineClip = {
          ...linkedClip,
          duration: linkedSplitPoint,
          trimEnd: linkedClip.trimEnd + (linkedClip.duration - linkedSplitPoint),
          linkedClipIds: [firstHalfId],
          volumeAutomation: linkedKfBefore,
          transitionOut: { type: 'none', duration: 0.5 },
        }

        const linkedSecondHalf: TimelineClip = {
          ...linkedClip,
          id: linkedSecondId,
          startTime: linkedClip.startTime + linkedSplitPoint,
          duration: linkedClip.duration - linkedSplitPoint,
          trimStart: linkedClip.trimStart + linkedSplitPoint,
          linkedClipIds: [secondHalfId],
          volumeAutomation: linkedKfAfter,
          transitionIn: { type: 'none', duration: 0.5 },
        }
        
        newClips = newClips
          .map(c => c.id === linkedClip.id ? linkedFirstHalf : c)
          .concat(linkedSecondHalf)
      }
      
      // Update linked references on the primary halves
      firstHalf.linkedClipIds = firstHalfLinkedIds.length ? firstHalfLinkedIds : undefined
      secondHalf.linkedClipIds = secondHalfLinkedIds.length ? secondHalfLinkedIds : undefined
      
      // Re-apply the updated halves
      newClips = newClips.map(c => c.id === firstHalfId ? firstHalf : c.id === secondHalfId ? secondHalf : c)
    }
    
    setClips(newClips)
  }
  
  const removeClip = (clipId: string) => {
    // Prevent deleting clips on locked tracks
    const clip = clips.find(c => c.id === clipId)
    if (clip && tracks[clip.trackIndex]?.locked) return
    
    pushUndo()
    // Also remove all linked clips (audio ↔ video pairs)
    const removeIds = new Set([clipId])
    if (clip?.linkedClipIds) clip.linkedClipIds.forEach(lid => removeIds.add(lid))
    setClips(clips.filter(c => !removeIds.has(c.id)))
    setSelectedClipIds(prev => {
      const next = new Set(prev)
      removeIds.forEach(id => next.delete(id))
      return next
    })
  }

  // --- Cross-dissolve at cut points ---
  const addCrossDissolve = useCallback((leftClipId: string, rightClipId: string) => {
    const leftClip = clips.find(c => c.id === leftClipId)
    const rightClip = clips.find(c => c.id === rightClipId)
    if (!leftClip || !rightClip) return
    
    pushUndo()
    const dissolveDur = DEFAULT_DISSOLVE_DURATION
    
    // Set transition out on left clip and transition in on right clip
    setClips(prev => prev.map(c => {
      if (c.id === leftClipId) {
        return { ...c, transitionOut: { type: 'dissolve' as TransitionType, duration: dissolveDur } }
      }
      if (c.id === rightClipId) {
        return { ...c, transitionIn: { type: 'dissolve' as TransitionType, duration: dissolveDur } }
      }
      return c
    }))
    setHoveredCutPoint(null)
  }, [clips, pushUndo])
  
  const removeCrossDissolve = useCallback((leftClipId: string, rightClipId: string) => {
    pushUndo()
    setClips(prev => prev.map(c => {
      if (c.id === leftClipId) {
        return { ...c, transitionOut: { type: 'none' as TransitionType, duration: 0.5 } }
      }
      if (c.id === rightClipId) {
        return { ...c, transitionIn: { type: 'none' as TransitionType, duration: 0.5 } }
      }
      return c
    }))
    setHoveredCutPoint(null)
  }, [pushUndo])
  
  const addTrack = (kind: 'video' | 'audio' = 'video') => {
    pushTrackUndo()
    const sameKindCount = tracks.filter(t => t.kind === kind && t.type !== 'subtitle').length
    const newTrack: Track = {
      id: `track-${Date.now()}`,
      name: kind === 'audio' ? `A${sameKindCount + 1}` : `V${sameKindCount + 1}`,
      muted: false,
      locked: false,
      kind,
    }
    setTracks([...tracks, newTrack])
  }
  
  const deleteTrack = (idx: number) => {
    if (tracks.length <= 1) return
    pushTrackUndo()
    setClips(prev => prev
      .filter(c => c.trackIndex !== idx)
      .map(c => c.trackIndex > idx ? { ...c, trackIndex: c.trackIndex - 1 } : c)
    )
    // Also shift subtitle track indices
    setSubtitles(prev => prev
      .filter(s => s.trackIndex !== idx)
      .map(s => s.trackIndex > idx ? { ...s, trackIndex: s.trackIndex - 1 } : s)
    )
    setTracks(tracks.filter((_, i) => i !== idx))
  }
  
  // --- Adjustment layer operations ---
  // Creates an adjustment layer asset in the project asset panel.
  // The user can then drag it onto any video track like any other asset.
  const createAdjustmentLayerAsset = () => {
    if (!currentProjectId) return
    const count = assets.filter(a => a.type === 'adjustment').length
    addAsset(currentProjectId, {
      type: 'adjustment',
      path: '',
      url: '',
      prompt: count > 0 ? `Adjustment Layer ${count + 1}` : 'Adjustment Layer',
      resolution: '',
      duration: 10,
    })
  }

  const addTextClip = useCallback((styleOverride?: Partial<TextOverlayStyle>, atTime?: number, trackIdx?: number) => {
    const insertTime = atTime ?? currentTime
    // Find the first video track that has room at insertTime
    const videoTrackIndices = tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.kind === 'video' && t.type !== 'subtitle')
      .map(({ i }) => i)
    
    let targetTrack = trackIdx
    if (targetTrack === undefined) {
      // Use the highest video track (topmost layer) or the first available
      targetTrack = videoTrackIndices.length > 0 ? videoTrackIndices[videoTrackIndices.length - 1] : 0
    }
    
    const textStyle: TextOverlayStyle = { ...DEFAULT_TEXT_STYLE, ...styleOverride }
    const newClip: TimelineClip = {
      id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      assetId: null,
      type: 'text',
      startTime: insertTime,
      duration: 5, // 5 seconds default
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: targetTrack,
      asset: null,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      opacity: 100,
      textStyle,
    }
    
    pushUndo(clips)
    setClips(prev => resolveOverlaps([...prev, newClip], new Set([newClip.id])))
    setSelectedClipIds(new Set([newClip.id]))
    // Move playhead to middle of new clip so the text is immediately visible in the monitor
    setCurrentTime(insertTime + 0.1)
    return newClip.id
  }, [currentTime, tracks, clips])

  const handleImportTimeline = useCallback(async (parsed: ParsedTimeline) => {
    if (!currentProjectId) return
    
    // Build a map from media ref id → our Asset
    const mediaToAsset = new Map<string, Asset>()
    
    for (const ref of parsed.mediaRefs) {
      const filePath = ref.relinkedPath || ref.resolvedPath
      const fileName = ref.name || filePath.split(/[/\\]/).pop() || 'Unknown'
      
      let url = ''
      let assetPath = filePath
      
      // If file is found, build a file:// URL referencing the original location (no copy)
      if (ref.found && filePath) {
        const normalized = filePath.replace(/\\/g, '/')
        url = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
        assetPath = filePath
      }
      
      // Create an asset in the project
      const resolution = (ref.width && ref.height) ? `${ref.width}x${ref.height}` : 'Unknown'
      const asset = addAsset(currentProjectId, {
        type: ref.type,
        path: assetPath,
        url,
        prompt: fileName,
        resolution,
        duration: ref.duration || undefined,
        bin: 'Imported',
      })
      
      mediaToAsset.set(ref.id, asset)
    }
    
    // Build tracks with NLE naming and kind
    const totalTracks = Math.max(parsed.videoTrackCount + parsed.audioTrackCount, 1)
    const newTracks: Track[] = []
    for (let i = 0; i < totalTracks; i++) {
      const isAudio = i >= parsed.videoTrackCount
      newTracks.push({
        id: `track-${Date.now()}-${i}`,
        name: isAudio ? `A${i - parsed.videoTrackCount + 1}` : `V${i + 1}`,
        muted: false,
        locked: false,
        kind: isAudio ? 'audio' : 'video',
      })
    }
    
    // Build clips — first pass: create all clips, second pass: establish links
    const newClips: TimelineClip[] = []
    // Map from parsed clip array index → generated clip id (for linking)
    const parsedIndexToClipId = new Map<number, string>()
    
    for (let pcIdx = 0; pcIdx < parsed.clips.length; pcIdx++) {
      const pc = parsed.clips[pcIdx]
      const asset = mediaToAsset.get(pc.mediaRefId)
      if (!asset) continue
      
      const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${pcIdx}`
      parsedIndexToClipId.set(pcIdx, clipId)
      
      const clip: TimelineClip = {
        id: clipId,
        assetId: asset.id,
        type: pc.trackType === 'audio' ? 'audio' : asset.type === 'image' ? 'image' : 'video',
        startTime: pc.startTime,
        duration: pc.duration,
        trimStart: pc.sourceIn || 0,
        trimEnd: 0,
        speed: pc.speed || 1,
        reversed: pc.reversed || false,
        muted: pc.muted || false,
        volume: pc.volume !== undefined ? Math.min(1, Math.max(0, pc.volume)) : 1,
        trackIndex: Math.min(pc.trackIndex, totalTracks - 1),
        asset,
        importedName: pc.name,
        flipH: pc.flipH || false,
        flipV: pc.flipV || false,
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'none', duration: 0 },
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
        opacity: pc.opacity !== undefined ? pc.opacity : 100,
      }
      newClips.push(clip)
    }
    
    // Second pass: establish bidirectional linkedClipIds between video ↔ audio pairs
    for (let pcIdx = 0; pcIdx < parsed.clips.length; pcIdx++) {
      const pc = parsed.clips[pcIdx]
      if (pc.linkedVideoClipIndex === undefined) continue
      const audioClipId = parsedIndexToClipId.get(pcIdx)
      const videoClipId = parsedIndexToClipId.get(pc.linkedVideoClipIndex)
      if (!audioClipId || !videoClipId) continue
      
      const audioClip = newClips.find(c => c.id === audioClipId)
      const videoClip = newClips.find(c => c.id === videoClipId)
      if (audioClip && videoClip) {
        // Audio clip links back to its video
        if (!audioClip.linkedClipIds) audioClip.linkedClipIds = []
        if (!audioClip.linkedClipIds.includes(videoClipId)) audioClip.linkedClipIds.push(videoClipId)
        // Video clip collects all its audio clips
        if (!videoClip.linkedClipIds) videoClip.linkedClipIds = []
        if (!videoClip.linkedClipIds.includes(audioClipId)) videoClip.linkedClipIds.push(audioClipId)
      }
    }
    
    // Create a new timeline with these tracks and clips
    const newTimeline = addTimeline(currentProjectId, parsed.name || 'Imported Timeline')
    
    // Update with our custom tracks and clips
    updateTimeline(currentProjectId, newTimeline.id, {
      tracks: newTracks,
      clips: newClips,
    })
    
    // Switch to the new timeline and open its tab
    setActiveTimeline(currentProjectId, newTimeline.id)
    setOpenTimelineIds(prev => { const next = new Set(prev); next.add(newTimeline.id); return next })
    
    // Load locally
    setTracks(newTracks)
    setClips(newClips)
    setSubtitles([])
    setCurrentTime(0)
    setSelectedClipIds(new Set())
    setSelectedSubtitleId(null)
    
  }, [currentProjectId, addAsset, addTimeline, updateTimeline, setActiveTimeline])
  
  // --- Export timeline as FCP 7 XML ---
  const handleExportTimelineXml = useCallback(async () => {
    if (!activeTimeline) return
    
    // Build clip data for export
    const exportClips = clips
      .filter(c => c.asset && c.type !== 'adjustment')
      .map(c => {
        const asset = assets.find(a => a.id === c.assetId) || c.asset!
        // Get the active take's path
        let filePath = asset.path
        if (asset.takes && asset.takes.length > 0) {
          const idx = c.takeIndex ?? asset.activeTakeIndex ?? 0
          const take = asset.takes[Math.min(idx, asset.takes.length - 1)]
          filePath = take.path
        }
        
        // Parse resolution
        const resParts = asset.resolution?.match(/(\d+)x(\d+)/)
        const width = resParts ? parseInt(resParts[1]) : 1920
        const height = resParts ? parseInt(resParts[2]) : 1080
        
        return {
          name: c.importedName || asset.path?.split(/[/\\]/).pop() || 'clip',
          filePath,
          trackIndex: c.trackIndex,
          type: c.type as 'video' | 'image' | 'audio',
          startTime: c.startTime,
          duration: c.duration,
          trimStart: c.trimStart,
          sourceDuration: asset.duration || c.duration,
          width,
          height,
        }
      })
    
    const xmlContent = exportFcp7Xml({
      name: activeTimeline.name,
      fps: activeTimeline.fps ?? 24,
      width: activeTimeline.resolution?.width ?? 1920,
      height: activeTimeline.resolution?.height ?? 1080,
      clips: exportClips,
    })
    
    if (window.electronAPI?.showSaveDialog) {
      const filePath = await window.electronAPI.showSaveDialog({
        title: 'Export Timeline as FCP 7 XML',
        defaultPath: `${activeTimeline.name}.xml`,
        filters: [{ name: 'FCP 7 XML', extensions: ['xml'] }],
      })
      if (filePath) {
        await window.electronAPI.saveFile(filePath, xmlContent)
      }
    } else {
      const blob = new Blob([xmlContent], { type: 'text/xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeTimeline.name}.xml`
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [activeTimeline, clips, assets])

  return {
    addClipToTimeline,
    handleImportFile,
    handleDropFiles,
    getMediaDuration,
    updateClip,
    addEffectToClip,
    removeEffectFromClip,
    updateEffectOnClip,
    duplicateClip,
    splitClipAtPlayhead,
    removeClip,
    addCrossDissolve,
    removeCrossDissolve,
    addTrack,
    deleteTrack,
    createAdjustmentLayerAsset,
    addTextClip,
    handleImportTimeline,
    handleExportTimelineXml,
  }
}
