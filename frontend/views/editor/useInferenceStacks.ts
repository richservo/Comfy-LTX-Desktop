import { useState, useCallback, useEffect, useRef } from 'react'
import type { Asset, TimelineClip, InferenceStack, Track } from '../../types/project'
import type { GenerationSettings } from '../../components/SettingsPanel'
import type { GenerationInitiator } from '../../contexts/GenerationContext'
import { copyToAssetFolder } from '../../lib/asset-copy'
import { fileUrlToPath } from '../../lib/url-to-path'
import { logger } from '../../lib/logger'
import { isValidStackSelection, getStackFrameMapping, getStackDuration, getStackClips } from './video-editor-utils'

export interface UseInferenceStacksParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  inferenceStacks: InferenceStack[]
  setInferenceStacks: React.Dispatch<React.SetStateAction<InferenceStack[]>>
  tracks: Track[]
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>
  assets: Asset[]
  currentProjectId: string | null
  addAsset: (projectId: string, asset: Omit<Asset, 'id' | 'createdAt'>) => Asset
  addTakeToAsset: (projectId: string, assetId: string, take: { url: string; path: string; createdAt: number }) => void
  resolveClipSrc: (clip: TimelineClip | null) => string
  // Generation hook values
  regenGenerate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }, projectName?: string, preserveAspectRatio?: boolean, initiator?: GenerationInitiator) => Promise<void>
  regenVideoUrl: string | null
  regenVideoPath: string | null
  isRegenerating: boolean
  regenProgress: number
  regenStatusMessage: string
  regenCancel: () => void
  regenReset: () => void
  regenError: string | null
  assetSavePath: string | undefined | null
  projectName?: string
}

export function useInferenceStacks(params: UseInferenceStacksParams) {
  const {
    clips, setClips, inferenceStacks, setInferenceStacks,
    tracks, setTracks,
    assets, currentProjectId,
    addAsset, addTakeToAsset, resolveClipSrc,
    regenGenerate, regenVideoUrl, regenVideoPath,
    isRegenerating, regenProgress, regenStatusMessage,
    regenCancel, regenReset, regenError,
    assetSavePath, projectName,
  } = params

  // Which stack is currently being rendered
  const [renderingStackId, setRenderingStackId] = useState<string | null>(null)
  // Which stack's panel is open
  const [activeStackId, setActiveStackId] = useState<string | null>(null)
  // Batch render queue
  const [batchQueue, setBatchQueue] = useState<string[]>([])
  const batchQueueRef = useRef(batchQueue)
  batchQueueRef.current = batchQueue
  // Ref for inferenceStacks to avoid stale closures in callbacks
  const inferenceStacksRef = useRef(inferenceStacks)
  inferenceStacksRef.current = inferenceStacks

  const createStack = useCallback((clipIds: string[]) => {
    const selectedClips = clipIds.map(id => clips.find(c => c.id === id)).filter((c): c is TimelineClip => c != null)
    if (!isValidStackSelection(selectedClips)) return null

    const stackId = `stack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newStack: InferenceStack = {
      id: stackId,
      clipIds,
      prompt: '',
      settings: {
        model: 'fast',
        duration: 5,
        videoResolution: '540p',
        fps: 24,
        audio: true,
        cameraMotion: 'none',
        imageResolution: '1080p',
        imageAspectRatio: '16:9',
        imageSteps: 30,
      },
      strengths: { first: 1, middle: 1, last: 1 },
      renderState: 'pending',
      createdAt: Date.now(),
    }

    // Tag clips with the stack ID and link them together
    setClips(prev => {
      const otherIdsMap = new Map(clipIds.map(id => [id, clipIds.filter(oid => oid !== id)]))
      return prev.map(c => {
        if (!clipIds.includes(c.id)) return c
        const otherIds = otherIdsMap.get(c.id) || []
        const existingLinks = new Set(c.linkedClipIds || [])
        otherIds.forEach(id => existingLinks.add(id))
        return {
          ...c,
          inferenceStackId: stackId,
          linkedClipIds: [...existingLinks],
        }
      })
    })

    setInferenceStacks(prev => [...prev, newStack])
    setActiveStackId(stackId)
    return newStack
  }, [clips, setClips, setInferenceStacks])

  const updateStack = useCallback((stackId: string, updates: Partial<InferenceStack>) => {
    setInferenceStacks(prev => prev.map(s =>
      s.id === stackId ? { ...s, ...updates } : s
    ))
  }, [setInferenceStacks])

  const deleteStack = useCallback((stackId: string) => {
    const stack = inferenceStacksRef.current.find(s => s.id === stackId)
    if (!stack) return

    // Remove rendered clip, unlink and untag source clips
    setClips(prev => {
      const stackClipIds = new Set(prev.filter(c => c.inferenceStackId === stackId).map(c => c.id))
      return prev
        .filter(c => c.id !== stack.renderedClipId)
        .map(c => {
          if (!stackClipIds.has(c.id)) return c
          const remaining = (c.linkedClipIds || []).filter(lid => !stackClipIds.has(lid))
          return {
            ...c,
            inferenceStackId: undefined,
            hiddenByStack: undefined,
            linkedClipIds: remaining.length ? remaining : undefined,
          }
        })
    })

    setInferenceStacks(prev => prev.filter(s => s.id !== stackId))
    // Remove from batch queue if queued
    setBatchQueue(prev => prev.filter(id => id !== stackId))
    if (activeStackId === stackId) setActiveStackId(null)
  }, [setClips, setInferenceStacks, activeStackId])

  const removeClipFromStack = useCallback((clipId: string) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip?.inferenceStackId) return

    const stackId = clip.inferenceStackId

    // Get all other stack clip IDs (looked up by inferenceStackId)
    const otherStackClipIds = new Set(
      clips.filter(c => c.inferenceStackId === stackId && c.id !== clipId).map(c => c.id)
    )

    // Remove this clip's tag and unlink from other stack members
    setClips(prev => prev.map(c => {
      if (c.id === clipId) {
        const remaining = (c.linkedClipIds || []).filter(lid => !otherStackClipIds.has(lid))
        return { ...c, inferenceStackId: undefined, hiddenByStack: undefined, linkedClipIds: remaining.length ? remaining : undefined }
      }
      // Also remove link to this clip from other stack members
      if (otherStackClipIds.has(c.id) && c.linkedClipIds?.includes(clipId)) {
        const remaining = c.linkedClipIds.filter(lid => lid !== clipId)
        return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
      }
      return c
    }))

    if (otherStackClipIds.size === 0) {
      deleteStack(stackId)
    }
  }, [clips, setClips, deleteStack])

  // Auto-cleanup: remove stacks whose source clips have all been deleted
  useEffect(() => {
    const clipIdSet = new Set(clips.map(c => c.id))
    const orphaned = inferenceStacks.filter(stack => {
      // A stack is orphaned if no clips reference it at all (by original ID or by inferenceStackId tag)
      const hasOriginalClip = stack.clipIds.some(id => clipIdSet.has(id))
      const hasTaggedClip = clips.some(c => c.inferenceStackId === stack.id)
      return !hasOriginalClip && !hasTaggedClip
    })
    if (orphaned.length > 0) {
      setInferenceStacks(prev => prev.filter(s => !orphaned.some(o => o.id === s.id)))
    }
  }, [clips, inferenceStacks, setInferenceStacks])

  // Reconcile: if a stack is pending/error but its clips are still hidden, un-hide them
  useEffect(() => {
    const pendingStackIds = new Set(
      inferenceStacks.filter(s => s.renderState === 'pending' || s.renderState === 'error').map(s => s.id)
    )
    if (pendingStackIds.size === 0) return
    const needsFix = clips.some(c => c.hiddenByStack && c.inferenceStackId && pendingStackIds.has(c.inferenceStackId))
    if (needsFix) {
      setClips(prev => prev.map(c =>
        c.hiddenByStack && c.inferenceStackId && pendingStackIds.has(c.inferenceStackId)
          ? { ...c, hiddenByStack: false }
          : c
      ))
    }
  }, [clips, inferenceStacks, setClips])

  const renderStack = useCallback(async (stackId: string) => {
    const stack = inferenceStacks.find(s => s.id === stackId)
    if (!stack || !currentProjectId) return

    // Resolve source paths — try from clips first, fall back to stored sourcePaths
    let firstImagePath: string | null = null
    let middleImagePath: string | null = null
    let lastImagePath: string | null = null
    let audioSourcePath: string | null = null
    let hasAudioClip = false

    const frameMapping = getStackFrameMapping(stack, clips)

    if (frameMapping) {
      const imageUrl = resolveClipSrc(frameMapping.first)
      const imagePath = fileUrlToPath(imageUrl)

      if (imagePath) {
        const isSingleAsLast = !frameMapping.last && !frameMapping.middle && stack.singleFramePosition === 'last'
        firstImagePath = isSingleAsLast ? null : imagePath
        lastImagePath = isSingleAsLast ? imagePath : null

        if (frameMapping.middle) {
          middleImagePath = fileUrlToPath(resolveClipSrc(frameMapping.middle))
        }
        if (frameMapping.last) {
          lastImagePath = fileUrlToPath(resolveClipSrc(frameMapping.last))
        }
      }
    }

    // Fall back to stored sourcePaths if clips couldn't be resolved
    if (!firstImagePath && !lastImagePath && stack.sourcePaths) {
      logger.info(`[renderStack] using stored sourcePaths (clips not resolvable)`)
      firstImagePath = stack.sourcePaths.firstImage ?? null
      middleImagePath = stack.sourcePaths.middleImage ?? null
      lastImagePath = stack.sourcePaths.lastImage ?? null
    }

    // Extract audio if present
    const stackClips = getStackClips(stack, clips)
    const audioClip = stackClips.find(c => c.type === 'audio')

    let audioPath: string | null = null
    if (audioClip) {
      hasAudioClip = true
      const audioUrl = resolveClipSrc(audioClip)
      audioSourcePath = fileUrlToPath(audioUrl)
      if (audioSourcePath) {
        try {
          audioPath = await window.electronAPI.extractAudioSegment({
            sourcePath: audioSourcePath,
            startTime: audioClip.trimStart,
            duration: audioClip.duration,
          })
        } catch (err) {
          logger.error(`Stack render: audio extraction failed: ${err}`)
        }
      }
    }

    // Fall back to stored audio path
    if (!audioPath && !hasAudioClip && stack.sourcePaths?.audio) {
      audioSourcePath = stack.sourcePaths.audio
      try {
        audioPath = await window.electronAPI.extractAudioSegment({
          sourcePath: audioSourcePath,
          startTime: 0,
          duration: getStackDuration(stack, clips),
        })
      } catch (err) {
        logger.error(`Stack render: stored audio extraction failed: ${err}`)
      }
    }

    // Store resolved source paths for future re-renders
    const resolvedPaths: InferenceStack['sourcePaths'] = {
      firstImage: firstImagePath ?? stack.sourcePaths?.firstImage,
      middleImage: middleImagePath ?? stack.sourcePaths?.middleImage,
      lastImage: lastImagePath ?? stack.sourcePaths?.lastImage,
      audio: audioSourcePath ?? stack.sourcePaths?.audio,
    }

    // Compute duration
    const duration = getStackDuration(stack, clips)

    // Build settings — force temporalUpscale off when middle frame is used
    const hasMiddle = !!(middleImagePath || stack.sourcePaths?.middleImage)
    const settings: GenerationSettings = {
      ...stack.settings,
      duration: Math.min(Math.max(1, Math.round(duration)), stack.settings.model === 'pro' ? 10 : 20),
      ...(hasMiddle ? { temporalUpscale: false } : {}),
      audio: hasAudioClip ? true : stack.settings.audio,
    }

    // Mark as rendering and store source paths
    setRenderingStackId(stackId)
    updateStack(stackId, { renderState: 'rendering', errorMessage: undefined, sourcePaths: resolvedPaths })

    try {
      logger.info(`[renderStack] calling generate: firstImage=${firstImagePath} middleImage=${middleImagePath} lastImage=${lastImagePath} audio=${audioPath} prompt=${stack.prompt.substring(0, 50)}`)
      await regenGenerate(
        stack.prompt,
        firstImagePath,
        settings,
        audioPath,
        middleImagePath,
        lastImagePath,
        stack.strengths,
        projectName,
        stack.preserveAspectRatio,
        'editor',
      )
    } catch (err) {
      logger.error(`Stack render failed: ${err}`)
      updateStack(stackId, { renderState: 'error', errorMessage: String(err) })
      setRenderingStackId(null)
    }
  }, [inferenceStacks, clips, currentProjectId, resolveClipSrc, regenGenerate, updateStack, projectName])

  // Handle render completion
  useEffect(() => {
    if (!renderingStackId || isRegenerating) return
    if (!regenVideoUrl || !currentProjectId) return

    const stack = inferenceStacks.find(s => s.id === renderingStackId)
    if (!stack) { setRenderingStackId(null); return }

    ;(async () => {
      try {
        const { path: finalPath, url: finalUrl } = await copyToAssetFolder(
          regenVideoPath || regenVideoUrl, regenVideoUrl, assetSavePath
        )

        const duration = getStackDuration(stack, clips)

        // Find stack clips by inferenceStackId (survives splits)
        const currentStackClips = getStackClips(stack, clips)
        const imageClips = currentStackClips.filter(c => c.type === 'image').sort((a, b) => a.startTime - b.startTime)
        // Use first image clip for placement, or fall back to first stack clip (audio-only)
        const firstClip = imageClips[0] ?? currentStackClips.sort((a, b) => a.startTime - b.startTime)[0]
        if (!firstClip) return

        // For audio-only stacks, place the rendered video on track 0 (video track) instead of the audio track
        const isAudioOnly = imageClips.length === 0
        const videoTrackIndex = isAudioOnly ? 0 : firstClip.trackIndex

        if (stack.renderedAssetId) {
          // Re-render: add take to existing asset
          addTakeToAsset(currentProjectId, stack.renderedAssetId, {
            url: finalUrl,
            path: finalPath,
            createdAt: Date.now(),
          })

          // Update the existing rendered clip's asset reference
          setClips(prev => prev.map(c => {
            if (c.id === stack.renderedClipId) {
              const liveAsset = assets.find(a => a.id === stack.renderedAssetId)
              return {
                ...c,
                duration,
                asset: liveAsset ? { ...liveAsset, url: finalUrl, path: finalPath } : c.asset,
              }
            }
            return c
          }))

          updateStack(renderingStackId, { renderState: 'complete', errorMessage: undefined })
        } else {
          // First render: create new asset and clip
          const asset = addAsset(currentProjectId, {
            type: 'video',
            path: finalPath,
            url: finalUrl,
            prompt: stack.prompt,
            resolution: stack.settings.videoResolution,
            duration,
            generationParams: {
              mode: 'image-to-video',
              prompt: stack.prompt,
              model: stack.settings.model,
              duration: stack.settings.duration,
              resolution: stack.settings.videoResolution,
              fps: stack.settings.fps,
              audio: stack.settings.audio,
              cameraMotion: stack.settings.cameraMotion,
            },
            takes: [{ url: finalUrl, path: finalPath, createdAt: Date.now() }],
            activeTakeIndex: 0,
          })

          const renderedClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const audioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).substr(2, 9)}`

          // Check if we need to create a linked audio clip (audio was generated but no audio clip in stack)
          const stackHasAudioClip = currentStackClips.some(c => c.type === 'audio')
          const shouldCreateAudio = stack.settings.audio && !stackHasAudioClip && !isAudioOnly

          // Find or create an audio track for the linked audio clip
          let audioTrackIndex = -1
          if (shouldCreateAudio) {
            audioTrackIndex = tracks.findIndex(t => t.kind === 'audio' && !t.locked && t.sourcePatched !== false)
            if (audioTrackIndex < 0) {
              const audioTrackCount = tracks.filter(t => t.kind === 'audio').length
              const newAudioTrack: Track = {
                id: `track-${Date.now()}-audio`,
                name: `A${audioTrackCount + 1}`,
                muted: false,
                locked: false,
                kind: 'audio',
              }
              audioTrackIndex = tracks.length
              setTracks(prev => [...prev, newAudioTrack])
            }
          }

          // Add rendered video clip and hide source clips
          setClips(prev => {
            const stackMemberIds = new Set(prev.filter(c => c.inferenceStackId === stack.id).map(c => c.id))

            const newClip: TimelineClip = {
              id: renderedClipId,
              assetId: asset.id,
              type: 'video',
              startTime: firstClip.startTime,
              duration,
              trimStart: 0,
              trimEnd: 0,
              speed: 1,
              reversed: false,
              muted: false,
              volume: 1,
              trackIndex: videoTrackIndex,
              asset,
              flipH: false,
              flipV: false,
              transitionIn: { type: 'none', duration: 0 },
              transitionOut: { type: 'none', duration: 0 },
              colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
              opacity: 100,
              inferenceStackId: stack.id,
              ...(shouldCreateAudio && audioTrackIndex >= 0 ? { linkedClipIds: [audioClipId] } : {}),
            }

            const newClips: TimelineClip[] = [newClip]

            // Create linked audio clip for generated audio
            if (shouldCreateAudio && audioTrackIndex >= 0) {
              newClips.push({
                id: audioClipId,
                assetId: asset.id,
                type: 'audio',
                startTime: firstClip.startTime,
                duration,
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
                transitionIn: { type: 'none', duration: 0 },
                transitionOut: { type: 'none', duration: 0 },
                colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
                opacity: 100,
                inferenceStackId: stack.id,
                linkedClipIds: [renderedClipId],
              })
            }

            return [
              ...prev.map(c => {
                if (!stackMemberIds.has(c.id)) return c
                // Hide all stack members; for image+audio stacks keep audio visible
                if (c.type === 'audio' && !isAudioOnly) return c
                return { ...c, hiddenByStack: true }
              }),
              ...newClips,
            ]
          })

          updateStack(renderingStackId, {
            renderState: 'complete',
            renderedAssetId: asset.id,
            renderedClipId,
            errorMessage: undefined,
          })
        }

        setRenderingStackId(null)
        regenReset()

        // Continue batch if there are more stacks queued
        if (batchQueueRef.current.length > 0) {
          // Filter out any stacks that were deleted while we were rendering
          const remainingQueue = batchQueueRef.current.filter(id =>
            inferenceStacks.some(s => s.id === id)
          )
          if (remainingQueue.length > 0) {
            const [next, ...rest] = remainingQueue
            setBatchQueue(rest)
            setTimeout(() => renderStack(next), 100)
          } else {
            setBatchQueue([])
          }
        }
      } catch (err) {
        logger.error(`Stack render completion failed: ${err}`)
        updateStack(renderingStackId, { renderState: 'error', errorMessage: String(err) })
        setRenderingStackId(null)
        regenReset()
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenVideoUrl, isRegenerating])

  // Handle render error
  useEffect(() => {
    if (!renderingStackId || isRegenerating || !regenError) return
    updateStack(renderingStackId, { renderState: 'error', errorMessage: regenError })
    setRenderingStackId(null)
    setBatchQueue([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenError, renderingStackId, isRegenerating])

  const renderAllStacks = useCallback(() => {
    const pendingStacks = inferenceStacks.filter(s => s.renderState !== 'rendering')
    if (pendingStacks.length === 0) return

    const [first, ...rest] = pendingStacks
    setBatchQueue(rest.map(s => s.id))
    renderStack(first.id)
  }, [inferenceStacks, renderStack])

  const cancelRender = useCallback(() => {
    regenCancel()
    if (renderingStackId) {
      updateStack(renderingStackId, { renderState: 'pending' })
    }
    setRenderingStackId(null)
    setBatchQueue([])
  }, [regenCancel, renderingStackId, updateStack])

  // Revert a rendered stack: remove the rendered clip + linked audio, un-hide source clips, reset render state
  const revertStack = useCallback((stackId: string) => {
    // Use ref to always get the latest stack data (avoids stale closures)
    const stack = inferenceStacksRef.current.find(s => s.id === stackId)
    if (!stack) {
      logger.warn(`[revertStack] stack ${stackId} not found`)
      return
    }

    const renderedId = stack.renderedClipId
    const originalClipIds = new Set(stack.clipIds)

    setClips(prev => {
      // IDs to remove: rendered clip + any audio clips linked to it that belong to this stack
      const removeIds = new Set<string>()
      if (renderedId) removeIds.add(renderedId)
      const renderedClip = prev.find(c => c.id === renderedId)
      if (renderedClip?.linkedClipIds) {
        for (const lid of renderedClip.linkedClipIds) {
          const linked = prev.find(c => c.id === lid)
          if (linked?.inferenceStackId === stackId) removeIds.add(lid)
        }
      }

      // Un-hide ALL clips that belong to this stack (by tag or by original ID) and aren't being removed
      return prev
        .filter(c => !removeIds.has(c.id))
        .map(c => {
          if (removeIds.has(c.id)) return c
          if (c.inferenceStackId === stackId || originalClipIds.has(c.id)) {
            return { ...c, hiddenByStack: false }
          }
          return c
        })
    })

    // Reset stack state
    updateStack(stackId, {
      renderState: 'pending',
      renderedClipId: undefined,
      renderedAssetId: undefined,
    })
  }, [setClips, updateStack])

  return {
    // State
    inferenceStacks,
    activeStackId,
    setActiveStackId,
    renderingStackId,
    isRendering: renderingStackId !== null,
    renderProgress: regenProgress,
    renderStatusMessage: regenStatusMessage,
    batchQueue,
    // Actions
    createStack,
    updateStack,
    deleteStack,
    removeClipFromStack,
    revertStack,
    renderStack,
    renderAllStacks,
    cancelRender,
  }
}
