import { useState, useCallback, useEffect, useRef } from 'react'
import type { Asset, TimelineClip, InferenceStack } from '../../types/project'
import type { GenerationSettings } from '../../components/SettingsPanel'
import { copyToAssetFolder } from '../../lib/asset-copy'
import { fileUrlToPath } from '../../lib/url-to-path'
import { logger } from '../../lib/logger'
import { isValidStackSelection, getStackFrameMapping, getStackDuration, getStackClips } from './video-editor-utils'

export interface UseInferenceStacksParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  inferenceStacks: InferenceStack[]
  setInferenceStacks: React.Dispatch<React.SetStateAction<InferenceStack[]>>
  assets: Asset[]
  currentProjectId: string | null
  addAsset: (projectId: string, asset: Omit<Asset, 'id' | 'createdAt'>) => Asset
  addTakeToAsset: (projectId: string, assetId: string, take: { url: string; path: string; createdAt: number }) => void
  resolveClipSrc: (clip: TimelineClip | null) => string
  // Generation hook values
  regenGenerate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }, projectName?: string, preserveAspectRatio?: boolean) => Promise<void>
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
    const stack = inferenceStacks.find(s => s.id === stackId)
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
  }, [inferenceStacks, setClips, setInferenceStacks, activeStackId])

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
    const clipIds = new Set(clips.map(c => c.id))
    const orphaned = inferenceStacks.filter(stack => {
      // A stack is orphaned if none of its clipIds exist in the current clips
      // (ignore the renderedClipId — that's the output, not a source)
      return !stack.clipIds.some(id => clipIds.has(id))
    })
    if (orphaned.length > 0) {
      setInferenceStacks(prev => prev.filter(s => !orphaned.some(o => o.id === s.id)))
    }
  }, [clips, inferenceStacks, setInferenceStacks])

  const renderStack = useCallback(async (stackId: string) => {
    const stack = inferenceStacks.find(s => s.id === stackId)
    if (!stack || !currentProjectId) return

    const frameMapping = getStackFrameMapping(stack, clips)
    if (!frameMapping) return

    // Extract image paths
    const imageUrl = resolveClipSrc(frameMapping.first)
    const imagePath = fileUrlToPath(imageUrl)
    if (!imagePath) {
      logger.error(`Stack render: cannot extract path from ${imageUrl}`)
      return
    }

    // Single image: respect singleFramePosition (first or last)
    const isSingleAsLast = !frameMapping.last && !frameMapping.middle && stack.singleFramePosition === 'last'
    const firstImagePath = isSingleAsLast ? null : imagePath

    let middleImagePath: string | null = null
    if (frameMapping.middle) {
      const url = resolveClipSrc(frameMapping.middle)
      middleImagePath = fileUrlToPath(url)
    }

    let lastImagePath: string | null = isSingleAsLast ? imagePath : null
    if (frameMapping.last) {
      const url = resolveClipSrc(frameMapping.last)
      lastImagePath = fileUrlToPath(url)
    }

    // Extract audio if present
    const stackClips = getStackClips(stack, clips)
    const audioClip = stackClips.find(c => c.type === 'audio')

    let audioPath: string | null = null
    if (audioClip) {
      const audioUrl = resolveClipSrc(audioClip)
      const sourcePath = fileUrlToPath(audioUrl)
      if (sourcePath) {
        try {
          const tempPath = await window.electronAPI.extractAudioSegment({
            sourcePath,
            startTime: audioClip.trimStart,
            duration: audioClip.duration,
          })
          audioPath = tempPath
        } catch (err) {
          logger.error(`Stack render: audio extraction failed: ${err}`)
        }
      }
    }

    // Compute duration
    const duration = getStackDuration(stack, clips)

    // Build settings — force temporalUpscale off when middle frame is used
    const settings: GenerationSettings = {
      ...stack.settings,
      duration: Math.min(Math.max(1, Math.round(duration)), stack.settings.model === 'pro' ? 10 : 20),
      ...(frameMapping.middle ? { temporalUpscale: false } : {}),
      // If no audio clip, still generate audio from video
      audio: audioClip ? true : stack.settings.audio,
    }

    // Mark as rendering
    setRenderingStackId(stackId)
    updateStack(stackId, { renderState: 'rendering', errorMessage: undefined })

    try {
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
        const firstClip = imageClips[0]
        if (!firstClip) return

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
              trackIndex: firstClip.trackIndex,
              asset,
              flipH: false,
              flipV: false,
              transitionIn: { type: 'none', duration: 0 },
              transitionOut: { type: 'none', duration: 0 },
              colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
              opacity: 100,
              inferenceStackId: stack.id,
            }

            return [
              ...prev.map(c =>
                stackMemberIds.has(c.id) && c.type !== 'audio'
                  ? { ...c, hiddenByStack: true }
                  : c
              ),
              newClip,
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

  // Revert a rendered stack: remove the rendered clip, un-hide source clips, reset render state
  const revertStack = useCallback((stackId: string) => {
    const stack = inferenceStacks.find(s => s.id === stackId)
    if (!stack) return

    const renderedId = stack.renderedClipId
    setClips(prev => {
      const filtered = renderedId ? prev.filter(c => c.id !== renderedId) : prev
      return filtered.map(c =>
        c.inferenceStackId === stackId
          ? { ...c, hiddenByStack: undefined }
          : c
      )
    })

    updateStack(stackId, {
      renderState: 'pending',
      renderedClipId: undefined,
      renderedAssetId: undefined,
    })
  }, [inferenceStacks, setClips, updateStack])

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
