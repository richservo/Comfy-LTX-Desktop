import { useState, useCallback, useEffect, useRef } from 'react'
import type { Asset, TimelineClip, InferenceStack, Track } from '../../types/project'
import type { GenerationSettings } from '../../components/SettingsPanel'
import type { GenerationInitiator } from '../../contexts/GenerationContext'
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
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  addTakeToAsset: (projectId: string, assetId: string, take: { url: string; path: string; createdAt: number }) => void
  resolveClipSrc: (clip: TimelineClip | null) => string
  // Generation hook values
  regenGenerate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }, projectName?: string, preserveAspectRatio?: boolean, initiator?: GenerationInitiator, guideVideoPath?: string, guideIndexList?: string, guideStrength?: number, stackId?: string) => Promise<void>
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
  projectGenerationSettings?: GenerationSettings
}

export function useInferenceStacks(params: UseInferenceStacksParams) {
  const {
    clips, setClips, inferenceStacks, setInferenceStacks,
    tracks, setTracks,
    assets, currentProjectId,
    addAsset, updateAsset, addTakeToAsset, resolveClipSrc,
    regenGenerate, regenVideoUrl, regenVideoPath,
    isRegenerating, regenProgress, regenStatusMessage,
    regenCancel, regenReset, regenError,
    assetSavePath, projectName, projectGenerationSettings,
  } = params

  // Which stack is currently being rendered — initialise from persisted state so we
  // reconnect after unmount/HMR/settings-panel navigation
  const [renderingStackId, setRenderingStackId] = useState<string | null>(() => {
    const rendering = inferenceStacks.find(s => s.renderState === 'rendering')
    return rendering?.id ?? null
  })
  // Which stack's panel is open
  const [activeStackId, setActiveStackId] = useState<string | null>(null)
  // Batch render queue
  const [batchQueue, setBatchQueue] = useState<string[]>([])
  const batchQueueRef = useRef(batchQueue)
  batchQueueRef.current = batchQueue
  // Refs to avoid stale closures in async callbacks
  const inferenceStacksRef = useRef(inferenceStacks)
  inferenceStacksRef.current = inferenceStacks
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  // On cold restart: if a stack is stuck in 'rendering' but the generation context
  // has no active generation and no completed result, reset it so the user can retry.
  const coldStartChecked = useRef(false)
  useEffect(() => {
    if (coldStartChecked.current) return
    coldStartChecked.current = true

    const stuckStacks = inferenceStacks.filter(s => s.renderState === 'rendering')
    if (stuckStacks.length === 0) return

    // If generation context shows no active generation AND no result waiting, the render was lost
    if (!isRegenerating && !regenVideoUrl && !regenError) {
      logger.info(`[useInferenceStacks] cold start: resetting ${stuckStacks.length} stuck rendering stack(s) to error`)
      for (const s of stuckStacks) {
        updateStack(s.id, { renderState: 'error', errorMessage: 'Render interrupted (app restarted or code reloaded)' })
      }
      setRenderingStackId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createStack = useCallback((clipIds: string[]) => {
    const selectedClips = clipIds.map(id => clips.find(c => c.id === id)).filter((c): c is TimelineClip => c != null)
    if (!isValidStackSelection(selectedClips)) return null

    const stackId = `stack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newStack: InferenceStack = {
      id: stackId,
      clipIds,
      prompt: '',
      settings: {
        ...(projectGenerationSettings ?? {
          model: 'fast',
          duration: 5,
          videoResolution: '540p',
          fps: 24,
          audio: true,
          cameraMotion: 'none',
          imageResolution: '1080p',
          imageAspectRatio: '16:9',
          imageSteps: 30,
        }),
      },
      strengths: { first: 0.7, middle: 0.7, last: 0.7 },
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
  }, [clips, setClips, setInferenceStacks, projectGenerationSettings])

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

  // Reconcile: un-hide audio clips that were incorrectly hidden, and
  // un-hide all clips from pending/error stacks
  useEffect(() => {
    const pendingStackIds = new Set(
      inferenceStacks.filter(s => s.renderState === 'pending' || s.renderState === 'error').map(s => s.id)
    )
    const needsFix = clips.some(c =>
      (c.hiddenByStack && c.type === 'audio') ||
      (c.hiddenByStack && c.inferenceStackId && pendingStackIds.has(c.inferenceStackId))
    )
    if (!needsFix) return
    setClips(prev => prev.map(c => {
      if (c.hiddenByStack && c.type === 'audio') return { ...c, hiddenByStack: false }
      if (c.hiddenByStack && c.inferenceStackId && pendingStackIds.has(c.inferenceStackId)) return { ...c, hiddenByStack: false }
      return c
    }))
  }, [clips, inferenceStacks, setClips])

  const renderStack = useCallback(async (stackId: string) => {
    const stack = inferenceStacks.find(s => s.id === stackId)
    if (!stack || !currentProjectId) return

    // Collect all image clips sorted by startTime
    const stackClips = getStackClips(stack, clips)
    const imageClips = stackClips.filter(c => c.type === 'image').sort((a, b) => a.startTime - b.startTime)
    const imageCount = imageClips.length
    const useGuideVideo = imageCount >= 3

    // Compute handle durations in seconds
    const fps = stack.settings.fps
    const headHandleFrames = stack.headHandles ?? 0
    const tailHandleFrames = stack.tailHandles ?? 0
    const headSeconds = headHandleFrames / fps
    const tailSeconds = tailHandleFrames / fps

    // Resolve source paths — try from clips first, fall back to stored sourcePaths
    let firstImagePath: string | null = null
    let middleImagePath: string | null = null
    let lastImagePath: string | null = null
    let audioSourcePath: string | null = null
    let hasAudioClip = false

    // Guide video state
    let guideVideoPath: string | undefined
    let guideIndexList: string | undefined
    let guideStrength: number | undefined

    if (useGuideVideo && imageCount >= 2) {
      // --- Guide video mode ---
      const stackStart = imageClips[0].startTime
      const duration = getStackDuration(stack, clips)
      // Total frames includes handles
      const totalFrames = Math.round((duration + headSeconds + tailSeconds) * fps) + 1

      // Resolve all image paths and compute frame indices
      const guideImages: { path: string; startFrame: number; endFrame: number }[] = []
      const frameIndices: number[] = []

      for (let i = 0; i < imageClips.length; i++) {
        const clip = imageClips[i]
        const url = resolveClipSrc(clip)
        const imgPath = fileUrlToPath(url)
        if (!imgPath) continue

        const startFrame = headHandleFrames + Math.round((clip.startTime - stackStart) * fps)
        const endFrame = i < imageClips.length - 1
          ? headHandleFrames + Math.round((imageClips[i + 1].startTime - stackStart) * fps)
          : totalFrames
        guideImages.push({ path: imgPath, startFrame, endFrame })
        frameIndices.push(startFrame)
      }

      if (guideImages.length >= 2) {
        // 'end' mode: move the last image's index to the final frame of the clip
        if (stack.guideEndMode === 'end') {
          const endFrameIdx = totalFrames - 1
          frameIndices[frameIndices.length - 1] = endFrameIdx
          guideImages[guideImages.length - 1].startFrame = endFrameIdx
        }
        guideIndexList = frameIndices.join(',')
        guideStrength = stack.guideStrength ?? 0.7

        // Render the guide video via ffmpeg or use stored path
        try {
          guideVideoPath = await window.electronAPI.renderGuideVideo({
            images: guideImages,
            fps,
            totalFrames,
            resolution: stack.settings.videoResolution,
            aspectRatio: stack.settings.aspectRatio || '16:9',
          })
        } catch (err) {
          logger.error(`Stack render: guide video creation failed: ${err}`)
        }
      }

      // Set first/middle/last image paths for formatter nodes + source dims
      firstImagePath = guideImages[0]?.path ?? null
      if (guideImages.length >= 3) {
        middleImagePath = guideImages[Math.floor(guideImages.length / 2)]?.path ?? null
      }
      lastImagePath = guideImages[guideImages.length - 1]?.path ?? null
    } else if (!useGuideVideo) {
      // --- Standard first/last/middle frame mode ---
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
    }

    // Extract audio if present — include handles, pad with silence where needed
    const audioClip = stackClips.find(c => c.type === 'audio')
    const baseStackDuration = getStackDuration(stack, clips)
    const fullDurationWithHandles = baseStackDuration + headSeconds + tailSeconds

    let audioPath: string | null = null
    if (audioClip) {
      hasAudioClip = true
      const audioUrl = resolveClipSrc(audioClip)
      audioSourcePath = fileUrlToPath(audioUrl)
      if (audioSourcePath) {
        try {
          // Extract audio including handle regions from the source if available
          const extractStart = Math.max(0, audioClip.trimStart - headSeconds)
          const extractDuration = audioClip.duration + headSeconds + tailSeconds
          const rawAudioPath = await window.electronAPI.extractAudioSegment({
            sourcePath: audioSourcePath,
            startTime: extractStart,
            duration: extractDuration,
          })
          // Pad to full duration with handles if extracted audio is shorter
          if (fullDurationWithHandles > extractDuration + 0.1) {
            audioPath = await window.electronAPI.padAudioToLength({
              sourcePath: rawAudioPath,
              targetDuration: fullDurationWithHandles,
            })
          } else {
            audioPath = await window.electronAPI.padAudioToLength({
              sourcePath: rawAudioPath,
              targetDuration: fullDurationWithHandles,
            })
          }
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
          duration: fullDurationWithHandles,
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
      guideVideo: guideVideoPath ?? stack.sourcePaths?.guideVideo,
    }

    // Compute duration (visible stack duration + handles for generation)
    const visibleDuration = getStackDuration(stack, clips)
    const duration = visibleDuration + headSeconds + tailSeconds

    // Build settings — force temporalUpscale off when middle frame is used
    const hasMiddle = !!(middleImagePath || stack.sourcePaths?.middleImage)
    const settings: GenerationSettings = {
      ...stack.settings,
      duration: Math.min(Math.max(1, Math.round(duration)), stack.settings.model === 'pro' ? 10 : 20),
      ...(hasMiddle && !useGuideVideo ? { temporalUpscale: false } : {}),
      audio: hasAudioClip ? true : stack.settings.audio,
    }

    // Mark as rendering and store source paths
    setRenderingStackId(stackId)
    updateStack(stackId, { renderState: 'rendering', errorMessage: undefined, sourcePaths: resolvedPaths })

    try {
      if (useGuideVideo && guideVideoPath) {
        logger.info(`[renderStack] calling generate (guide video): guideVideo=${guideVideoPath} guideIndexList=${guideIndexList} guideStrength=${guideStrength} prompt=${stack.prompt.substring(0, 50)}`)
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
          guideVideoPath,
          guideIndexList,
          guideStrength,
          stackId,
        )
      } else {
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
          undefined,
          undefined,
          undefined,
          stackId,
        )
      }
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

    const stack = inferenceStacksRef.current.find(s => s.id === renderingStackId)
    if (!stack) { setRenderingStackId(null); return }

    ;(async () => {
      try {
        // Use the file directly from its current location
        const videoSrc = regenVideoPath || regenVideoUrl
        const finalPath = videoSrc
        const pathNorm = videoSrc.replace(/\\/g, '/')
        const finalUrl = pathNorm.startsWith('/') ? `file://${pathNorm}` : `file:///${pathNorm}`

        const currentClips = clipsRef.current
        const currentAssets = assetsRef.current
        const visibleDuration = getStackDuration(stack, currentClips)

        // Compute handle durations
        const stackFps = stack.settings.fps
        const headSec = (stack.headHandles ?? 0) / stackFps
        const tailSec = (stack.tailHandles ?? 0) / stackFps
        const fullDuration = visibleDuration + headSec + tailSec

        // Find stack clips by inferenceStackId (survives splits)
        const currentStackClips = getStackClips(stack, currentClips)
        const imageClips = currentStackClips.filter(c => c.type === 'image').sort((a, b) => a.startTime - b.startTime)
        // Use first image clip for placement, or fall back to first stack clip (audio-only)
        const firstClip = imageClips[0] ?? currentStackClips.sort((a, b) => a.startTime - b.startTime)[0]
        if (!firstClip) return

        // For audio-only stacks, place the rendered video on track 0 (video track) instead of the audio track
        const isAudioOnly = imageClips.length === 0
        const videoTrackIndex = isAudioOnly ? 0 : firstClip.trackIndex

        // Check if rendered asset actually exists (use ref for fresh state)
        const renderedAsset = stack.renderedAssetId ? currentAssets.find(a => a.id === stack.renderedAssetId) : null
        const renderedClipExists = stack.renderedClipId ? currentClips.some(c => c.id === stack.renderedClipId) : false

        if (renderedAsset && renderedClipExists) {
          // Re-render: add take to existing asset and update stack data
          const existingTakes = renderedAsset.takes || [{
            url: renderedAsset.url, path: renderedAsset.path,
            thumbnail: renderedAsset.thumbnail, createdAt: renderedAsset.createdAt,
          }]
          const newTakeIndex = existingTakes.length
          const newTake = { url: finalUrl, path: finalPath, createdAt: Date.now() }
          addTakeToAsset(currentProjectId, renderedAsset.id, newTake)
          // Update stack data on the asset for recovery
          updateAsset(currentProjectId, renderedAsset.id, {
            inferenceStackData: {
              stackId: stack.id,
              prompt: stack.prompt,
              settings: { ...stack.settings },
              strengths: { ...stack.strengths },
              preserveAspectRatio: stack.preserveAspectRatio,
              singleFramePosition: stack.singleFramePosition,
              guideMode: stack.guideMode,
              guideStrength: stack.guideStrength,
              guideEndMode: stack.guideEndMode,
              headHandles: stack.headHandles,
              tailHandles: stack.tailHandles,
              sourcePaths: stack.sourcePaths ? { ...stack.sourcePaths } : undefined,
            },
          })

          // Build updated asset with new take so clip renders immediately
          const allTakes = [...existingTakes, newTake]
          const updatedAsset = {
            ...renderedAsset,
            url: finalUrl, path: finalPath, duration: fullDuration,
            takes: allTakes, activeTakeIndex: newTakeIndex,
          }
          setClips(prev => prev.map(c => {
            if (c.id === stack.renderedClipId) {
              return {
                ...c,
                duration: visibleDuration,
                trimStart: headSec,
                trimEnd: tailSec,
                takeIndex: newTakeIndex,
                asset: updatedAsset,
              }
            }
            return c
          }))

          updateStack(renderingStackId, { renderState: 'complete', errorMessage: undefined })
        } else {
          // First render: create new asset and clip (with full stack data for recovery)
          const asset = addAsset(currentProjectId, {
            type: 'video',
            path: finalPath,
            url: finalUrl,
            prompt: stack.prompt,
            resolution: stack.settings.videoResolution,
            duration: fullDuration,
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
            inferenceStackData: {
              stackId: stack.id,
              prompt: stack.prompt,
              settings: { ...stack.settings },
              strengths: { ...stack.strengths },
              preserveAspectRatio: stack.preserveAspectRatio,
              singleFramePosition: stack.singleFramePosition,
              guideMode: stack.guideMode,
              guideStrength: stack.guideStrength,
              guideEndMode: stack.guideEndMode,
              headHandles: stack.headHandles,
              tailHandles: stack.tailHandles,
              sourcePaths: stack.sourcePaths ? { ...stack.sourcePaths } : undefined,
            },
          })

          const renderedClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const audioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).substr(2, 9)}`

          // Check if we need to create a linked audio clip (audio was generated but no audio clip in stack)
          const stackHasAudioClip = currentStackClips.some(c => c.type === 'audio')
          const shouldCreateAudio = stack.settings.audio && !stackHasAudioClip && !isAudioOnly

          // Find or create an audio track for the linked audio clip
          let audioTrackIndex = -1
          if (shouldCreateAudio) {
            const currentTracks = tracksRef.current
            audioTrackIndex = currentTracks.findIndex(t => t.kind === 'audio' && !t.locked && t.sourcePatched !== false)
            if (audioTrackIndex < 0) {
              const audioTrackCount = currentTracks.filter(t => t.kind === 'audio').length
              const newAudioTrack: Track = {
                id: `track-${Date.now()}-audio`,
                name: `A${audioTrackCount + 1}`,
                muted: false,
                locked: false,
                kind: 'audio',
              }
              audioTrackIndex = currentTracks.length
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
              duration: visibleDuration,
              trimStart: headSec,
              trimEnd: tailSec,
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
                duration: visibleDuration,
                trimStart: headSec,
                trimEnd: tailSec,
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
                if (c.type === 'audio') return c // audio only plays from audio tracks
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
            inferenceStacksRef.current.some(s => s.id === id)
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

  // Handle render error — attempt to recover output from disk before giving up
  useEffect(() => {
    if (!renderingStackId || isRegenerating || !regenError) return
    const failedStackId = renderingStackId

    ;(async () => {
      // Try to find the completed output on disk
      if (projectName && window.electronAPI?.findStackOutput) {
        try {
          const found = await window.electronAPI.findStackOutput({ projectName, stackId: failedStackId })
          if (found?.video_path) {
            logger.info(`[useInferenceStacks] recovered output for stack ${failedStackId}: ${found.video_path}`)
            const pathNorm = found.video_path.replace(/\\/g, '/')
            const fileUrl = pathNorm.startsWith('/') ? `file://${pathNorm}` : `file:///${pathNorm}`
            // Feed it back through the completion handler by simulating regenVideoUrl
            // We do this by directly running the completion logic
            const stack = inferenceStacksRef.current.find(s => s.id === failedStackId)
            if (stack && currentProjectId) {
              const finalPath = found.video_path
              const finalUrl = fileUrl
              const recoverClips = clipsRef.current
              const recoverAssets = assetsRef.current
              const visibleDuration = getStackDuration(stack, recoverClips)
              const stackFps = stack.settings.fps
              const headSec = (stack.headHandles ?? 0) / stackFps
              const tailSec = (stack.tailHandles ?? 0) / stackFps
              const fullDuration = visibleDuration + headSec + tailSec
              const currentStackClips = getStackClips(stack, recoverClips)
              const imageClips = currentStackClips.filter(c => c.type === 'image').sort((a, b) => a.startTime - b.startTime)
              const firstClip = imageClips[0] ?? currentStackClips.sort((a, b) => a.startTime - b.startTime)[0]

              if (firstClip) {
                const isAudioOnly = imageClips.length === 0
                const videoTrackIndex = isAudioOnly ? 0 : firstClip.trackIndex

                const renderedAsset = stack.renderedAssetId ? recoverAssets.find(a => a.id === stack.renderedAssetId) : null
                const autoRecoverClipExists = renderedAsset && stack.renderedClipId && recoverClips.some(c => c.id === stack.renderedClipId)
                if (autoRecoverClipExists) {
                  const existingTakes = renderedAsset.takes || [{
                    url: renderedAsset.url, path: renderedAsset.path,
                    thumbnail: renderedAsset.thumbnail, createdAt: renderedAsset.createdAt,
                  }]
                  const newTakeIndex = existingTakes.length
                  const newTake = { url: finalUrl, path: finalPath, createdAt: Date.now() }
                  addTakeToAsset(currentProjectId, renderedAsset.id, newTake)
                  const allTakes = [...existingTakes, newTake]
                  const updatedAsset = {
                    ...renderedAsset,
                    url: finalUrl, path: finalPath, duration: fullDuration,
                    takes: allTakes, activeTakeIndex: newTakeIndex,
                  }
                  setClips(prev => prev.map(c => {
                    if (c.id === stack.renderedClipId) {
                      return { ...c, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec, takeIndex: newTakeIndex, asset: updatedAsset }
                    }
                    return c
                  }))
                  updateStack(failedStackId, { renderState: 'complete', errorMessage: undefined })
                } else {
                  const asset = addAsset(currentProjectId, {
                    type: 'video', path: finalPath, url: finalUrl,
                    prompt: stack.prompt, resolution: stack.settings.videoResolution, duration: fullDuration,
                    generationParams: { mode: 'image-to-video', prompt: stack.prompt, model: stack.settings.model, duration: stack.settings.duration, resolution: stack.settings.videoResolution, fps: stack.settings.fps, audio: stack.settings.audio, cameraMotion: stack.settings.cameraMotion },
                    takes: [{ url: finalUrl, path: finalPath, createdAt: Date.now() }],
                    activeTakeIndex: 0,
                    inferenceStackData: { stackId: stack.id, prompt: stack.prompt, settings: { ...stack.settings }, strengths: { ...stack.strengths }, preserveAspectRatio: stack.preserveAspectRatio, singleFramePosition: stack.singleFramePosition, guideMode: stack.guideMode, guideStrength: stack.guideStrength, guideEndMode: stack.guideEndMode, headHandles: stack.headHandles, tailHandles: stack.tailHandles, sourcePaths: stack.sourcePaths ? { ...stack.sourcePaths } : undefined },
                  })
                  const renderedClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                  const recAudioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).substr(2, 9)}`
                  const stackHasAudioClip = currentStackClips.some(c => c.type === 'audio')
                  const recShouldCreateAudio = stack.settings.audio && !stackHasAudioClip && !isAudioOnly

                  // Find or create an audio track
                  let recAudioTrackIndex = -1
                  if (recShouldCreateAudio) {
                    const currentTracks = tracksRef.current
                    recAudioTrackIndex = currentTracks.findIndex(t => t.kind === 'audio' && !t.locked && t.sourcePatched !== false)
                    if (recAudioTrackIndex < 0) {
                      const audioCount = currentTracks.filter(t => t.kind === 'audio').length
                      recAudioTrackIndex = currentTracks.length
                      setTracks(prev => [...prev, { id: `track-${Date.now()}-audio`, name: `A${audioCount + 1}`, muted: false, locked: false, kind: 'audio' as const }])
                    }
                  }

                  setClips(prev => {
                    const stackMemberIds = new Set(prev.filter(c => c.inferenceStackId === stack.id).map(c => c.id))
                    const newClip: TimelineClip = {
                      id: renderedClipId, assetId: asset.id, type: 'video',
                      startTime: firstClip.startTime, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec,
                      speed: 1, reversed: false, muted: false, volume: 1, trackIndex: videoTrackIndex, asset,
                      flipH: false, flipV: false,
                      transitionIn: { type: 'none', duration: 0 }, transitionOut: { type: 'none', duration: 0 },
                      colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
                      opacity: 100, inferenceStackId: stack.id,
                      ...(recShouldCreateAudio && recAudioTrackIndex >= 0 ? { linkedClipIds: [recAudioClipId] } : {}),
                    }
                    const newClips: TimelineClip[] = [newClip]
                    if (recShouldCreateAudio && recAudioTrackIndex >= 0) {
                      newClips.push({
                        id: recAudioClipId, assetId: asset.id, type: 'audio',
                        startTime: firstClip.startTime, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec,
                        speed: 1, reversed: false, muted: false, volume: 1, trackIndex: recAudioTrackIndex, asset,
                        flipH: false, flipV: false,
                        transitionIn: { type: 'none', duration: 0 }, transitionOut: { type: 'none', duration: 0 },
                        colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
                        opacity: 100, inferenceStackId: stack.id, linkedClipIds: [renderedClipId],
                      })
                    }
                    return [
                      ...prev.map(c => {
                        if (!stackMemberIds.has(c.id)) return c
                        if (c.type === 'audio') return c
                        return { ...c, hiddenByStack: true }
                      }),
                      ...newClips,
                    ]
                  })
                  updateStack(failedStackId, { renderState: 'complete', renderedAssetId: asset.id, renderedClipId, errorMessage: undefined })
                }

                setRenderingStackId(null)
                regenReset()
                logger.info(`[useInferenceStacks] stack ${failedStackId} recovered successfully`)
                return
              }
            }
          }
        } catch (err) {
          logger.warn(`[useInferenceStacks] recovery attempt failed: ${err}`)
        }
      }

      // No recovery possible — mark as error
      updateStack(failedStackId, { renderState: 'error', errorMessage: regenError })
      setRenderingStackId(null)
      setBatchQueue([])
      regenReset()
    })()
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
    const stack = inferenceStacksRef.current.find(s => s.id === stackId)
    if (!stack) {
      logger.warn(`[revertStack] stack ${stackId} not found`)
      return
    }

    // The original clips that existed when the stack was created
    const originalClipIds = new Set(stack.clipIds)

    setClips(prev => {
      // 1. Find everything to REMOVE: rendered clip + any clips created by the render
      //    (i.e. clips with this inferenceStackId that are NOT original source clips)
      const removeIds = new Set<string>()
      for (const c of prev) {
        if (c.inferenceStackId === stackId && !originalClipIds.has(c.id)) {
          removeIds.add(c.id)
        }
      }

      logger.info(`[revertStack] stack=${stackId} removing=[${[...removeIds].join(',')}] restoring=[${[...originalClipIds].join(',')}]`)

      // 2. Remove render artifacts, restore ALL original clips to visible
      return prev
        .filter(c => !removeIds.has(c.id))
        .map(c => {
          if (originalClipIds.has(c.id)) {
            return { ...c, hiddenByStack: undefined }
          }
          return c
        })
    })

    updateStack(stackId, {
      renderState: 'pending',
      renderedClipId: undefined,
      renderedAssetId: undefined,
    })
  }, [setClips, updateStack])

  // Break stack: untag all clips, remove rendered clip, remove the stack entirely
  const breakStack = useCallback((stackId: string) => {
    const stack = inferenceStacksRef.current.find(s => s.id === stackId)
    if (!stack) return

    // If rendered, revert first (removes rendered clip, un-hides sources)
    if (stack.renderedClipId) {
      revertStack(stackId)
    }

    // Untag all clips and remove inter-stack links
    setClips(prev => {
      const stackClipIds = new Set(prev.filter(c => c.inferenceStackId === stackId).map(c => c.id))
      return prev.map(c => {
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
    setBatchQueue(prev => prev.filter(id => id !== stackId))
    if (activeStackId === stackId) setActiveStackId(null)
  }, [setClips, setInferenceStacks, activeStackId, revertStack])

  // Manually relink an errored stack to a specific video file
  const relinkStackOutput = useCallback(async (stackId: string, videoPath: string) => {
    const stack = inferenceStacksRef.current.find(s => s.id === stackId)
    logger.info(`[relinkStackOutput] stackId=${stackId}, videoPath=${videoPath}, stack=${!!stack}, projectId=${currentProjectId}, assetSavePath=${assetSavePath}`)
    if (!stack || !currentProjectId) return false

    try {
      // Use the file directly from its current location — no need to copy
      const finalPath = videoPath
      const pathNorm = videoPath.replace(/\\/g, '/')
      const finalUrl = pathNorm.startsWith('/') ? `file://${pathNorm}` : `file:///${pathNorm}`
      logger.info(`[relinkStackOutput] using file directly: path=${finalPath}, url=${finalUrl}`)

      const currentClips = clipsRef.current
      const currentAssets = assetsRef.current
      const visibleDuration = getStackDuration(stack, currentClips)
      const stackFps = stack.settings.fps
      const headSec = (stack.headHandles ?? 0) / stackFps
      const tailSec = (stack.tailHandles ?? 0) / stackFps
      const fullDuration = visibleDuration + headSec + tailSec
      const currentStackClips = getStackClips(stack, currentClips)
      const imageClips = currentStackClips.filter(c => c.type === 'image').sort((a, b) => a.startTime - b.startTime)
      const firstClip = imageClips[0] ?? currentStackClips.sort((a, b) => a.startTime - b.startTime)[0]
      if (!firstClip) return false

      const isAudioOnly = imageClips.length === 0
      const videoTrackIndex = isAudioOnly ? 0 : firstClip.trackIndex

      // Only take re-render path if the rendered clip AND its asset both exist
      const renderedClip = stack.renderedClipId ? currentClips.find(c => c.id === stack.renderedClipId) : null
      const renderedAsset = stack.renderedAssetId ? currentAssets.find(a => a.id === stack.renderedAssetId) : null
      const canAddTake = !!renderedClip && !!renderedAsset
      logger.info(`[relinkStackOutput] renderedClip=${!!renderedClip}, renderedAsset=${!!renderedAsset}, canAddTake=${canAddTake}`)
      if (canAddTake) {
        // Initialize takes from the original asset if needed (same logic as addTakeToAsset in ProjectContext)
        const existingTakes = renderedAsset.takes || [{
          url: renderedAsset.url,
          path: renderedAsset.path,
          thumbnail: renderedAsset.thumbnail,
          createdAt: renderedAsset.createdAt,
        }]
        const newTakeIndex = existingTakes.length
        const newTake = { url: finalUrl, path: finalPath, createdAt: Date.now() }
        addTakeToAsset(currentProjectId, renderedAsset.id, newTake)
        // Build updated asset with the new take so the clip renders immediately
        const allTakes = [...existingTakes, newTake]
        const updatedAsset = {
          ...renderedAsset,
          url: finalUrl,
          path: finalPath,
          duration: fullDuration,
          takes: allTakes,
          activeTakeIndex: newTakeIndex,
        }
        logger.info(`[relinkStackOutput] adding take ${newTakeIndex + 1}, totalTakes=${allTakes.length}`)
        setClips(prev => prev.map(c => {
          if (c.id === stack.renderedClipId) {
            return { ...c, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec, takeIndex: newTakeIndex, asset: updatedAsset }
          }
          return c
        }))
        updateStack(stackId, { renderState: 'complete', errorMessage: undefined })
      } else {
        // If there's an existing rendered clip, preserve its video as take 1
        const oldClip = renderedClip
        const oldUrl = oldClip?.asset?.url || (oldClip?.assetId ? currentAssets.find(a => a.id === oldClip.assetId)?.url : null)
        const oldPath = oldClip?.asset?.path || (oldClip?.assetId ? currentAssets.find(a => a.id === oldClip.assetId)?.path : null)
        const takes: { url: string; path: string; createdAt: number }[] = []
        if (oldUrl && oldPath) {
          takes.push({ url: oldUrl, path: oldPath, createdAt: oldClip!.asset?.createdAt || Date.now() - 1000 })
        }
        takes.push({ url: finalUrl, path: finalPath, createdAt: Date.now() })
        const newTakeIndex = takes.length - 1

        const asset = addAsset(currentProjectId, {
          type: 'video', path: finalPath, url: finalUrl,
          prompt: stack.prompt, resolution: stack.settings.videoResolution, duration: fullDuration,
          generationParams: { mode: 'image-to-video', prompt: stack.prompt, model: stack.settings.model, duration: stack.settings.duration, resolution: stack.settings.videoResolution, fps: stack.settings.fps, audio: stack.settings.audio, cameraMotion: stack.settings.cameraMotion },
          takes,
          activeTakeIndex: newTakeIndex,
          inferenceStackData: { stackId: stack.id, prompt: stack.prompt, settings: { ...stack.settings }, strengths: { ...stack.strengths }, preserveAspectRatio: stack.preserveAspectRatio, singleFramePosition: stack.singleFramePosition, guideMode: stack.guideMode, guideStrength: stack.guideStrength, guideEndMode: stack.guideEndMode, headHandles: stack.headHandles, tailHandles: stack.tailHandles, sourcePaths: stack.sourcePaths ? { ...stack.sourcePaths } : undefined },
        })
        logger.info(`[relinkStackOutput] created asset with ${takes.length} takes (preserved old=${!!oldUrl})`)

        if (oldClip) {
          // Reuse existing rendered clip — just update its asset reference
          setClips(prev => prev.map(c => {
            if (c.id === oldClip.id) {
              return { ...c, assetId: asset.id, asset: { ...asset, takes }, takeIndex: newTakeIndex, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec }
            }
            return c
          }))
          updateStack(stackId, { renderState: 'complete', renderedAssetId: asset.id, renderedClipId: oldClip.id, errorMessage: undefined })
        } else {
          // No existing clip — create a new one
          const renderedClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const rlAudioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).substr(2, 9)}`
          const currentStackClipsRL = getStackClips(stack, currentClips)
          const rlStackHasAudio = currentStackClipsRL.some(c => c.type === 'audio')
          const rlShouldCreateAudio = stack.settings.audio && !rlStackHasAudio && imageClips.length > 0

          let rlAudioTrackIndex = -1
          if (rlShouldCreateAudio) {
            const currentTracks = tracksRef.current
            rlAudioTrackIndex = currentTracks.findIndex(t => t.kind === 'audio' && !t.locked && t.sourcePatched !== false)
            if (rlAudioTrackIndex < 0) {
              const audioCount = currentTracks.filter(t => t.kind === 'audio').length
              rlAudioTrackIndex = currentTracks.length
              setTracks(prev => [...prev, { id: `track-${Date.now()}-audio`, name: `A${audioCount + 1}`, muted: false, locked: false, kind: 'audio' as const }])
            }
          }

          setClips(prev => {
            const stackMemberIds = new Set(prev.filter(c => c.inferenceStackId === stack.id).map(c => c.id))
            const newClip: TimelineClip = {
              id: renderedClipId, assetId: asset.id, type: 'video',
              startTime: firstClip.startTime, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec,
              speed: 1, reversed: false, muted: false, volume: 1, trackIndex: videoTrackIndex, asset: { ...asset, takes },
              flipH: false, flipV: false,
              transitionIn: { type: 'none', duration: 0 }, transitionOut: { type: 'none', duration: 0 },
              colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
              opacity: 100, inferenceStackId: stack.id, takeIndex: newTakeIndex,
              ...(rlShouldCreateAudio && rlAudioTrackIndex >= 0 ? { linkedClipIds: [rlAudioClipId] } : {}),
            }
            const newClips: TimelineClip[] = [newClip]
            if (rlShouldCreateAudio && rlAudioTrackIndex >= 0) {
              newClips.push({
                id: rlAudioClipId, assetId: asset.id, type: 'audio',
                startTime: firstClip.startTime, duration: visibleDuration, trimStart: headSec, trimEnd: tailSec,
                speed: 1, reversed: false, muted: false, volume: 1, trackIndex: rlAudioTrackIndex, asset: { ...asset, takes },
                flipH: false, flipV: false,
                transitionIn: { type: 'none', duration: 0 }, transitionOut: { type: 'none', duration: 0 },
                colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
                opacity: 100, inferenceStackId: stack.id, linkedClipIds: [renderedClipId], takeIndex: newTakeIndex,
              })
            }
            return [
              ...prev.map(c => {
                if (!stackMemberIds.has(c.id)) return c
                if (c.type === 'audio') return c
                return { ...c, hiddenByStack: true }
              }),
              ...newClips,
            ]
          })
          updateStack(stackId, { renderState: 'complete', renderedAssetId: asset.id, renderedClipId, errorMessage: undefined })
        }
      }

      logger.info(`[relinkStackOutput] successfully relinked stack ${stackId}`)
      return true
    } catch (err) {
      logger.error(`[relinkStackOutput] failed: ${err}`)
      return false
    }
  }, [currentProjectId, addAsset, addTakeToAsset, updateStack, setClips])

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
    breakStack,
    revertStack,
    renderStack,
    renderAllStacks,
    cancelRender,
    relinkStackOutput,
  }
}
