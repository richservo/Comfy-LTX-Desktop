import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { GenerationSettings } from '../components/SettingsPanel'

export type GenerationInitiator = 'genspace' | 'editor' | null

interface GenerationState {
  isGenerating: boolean
  progress: number
  statusMessage: string
  videoUrl: string | null
  videoPath: string | null
  enhancedPrompt: string | null
  imageUrl: string | null
  imageUrls: string[]
  error: string | null
  iterationCurrent: number
  iterationTotal: number
  initiator: GenerationInitiator
  lastSeed: number | null
}

interface GenerationProgress {
  status: string
  phase: string
  progress: number
  currentStep: number | null
  totalSteps: number | null
}

export interface GenerationContextType extends GenerationState {
  generate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }, projectName?: string, preserveAspectRatio?: boolean, initiator?: GenerationInitiator, guideVideoPath?: string, guideIndexList?: string, guideStrength?: number, stackId?: string, seed?: number) => Promise<void>
  generateImage: (prompt: string, settings: GenerationSettings, imagePath?: string | null, strength?: number, projectName?: string, referenceImagePaths?: string[], initiator?: GenerationInitiator) => Promise<void>
  cancel: () => void
  reset: () => void
}

const GenerationContext = createContext<GenerationContextType | null>(null)

function getPhaseMessage(phase: string): string {
  switch (phase) {
    case 'complete':
      return 'Complete!'
    case 'error':
      return 'Error'
    case 'cancelled':
      return 'Cancelled'
    default:
      return phase || 'Generating...'
  }
}

const INITIAL_STATE: GenerationState = {
  isGenerating: false,
  progress: 0,
  statusMessage: '',
  videoUrl: null,
  videoPath: null,
  enhancedPrompt: null,
  imageUrl: null,
  imageUrls: [],
  error: null,
  iterationCurrent: 0,
  iterationTotal: 0,
  initiator: null,
  lastSeed: null,
}

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GenerationState>(INITIAL_STATE)
  const cancelledRef = useRef(false)

  const generate = useCallback(async (
    prompt: string,
    imagePath: string | null,
    settings: GenerationSettings,
    audioPath?: string | null,
    middleImagePath?: string | null,
    lastImagePath?: string | null,
    strengths?: { first?: number; middle?: number; last?: number },
    projectName?: string,
    preserveAspectRatio?: boolean,
    initiator?: GenerationInitiator,
    guideVideoPath?: string,
    guideIndexList?: string,
    guideStrength?: number,
    stackId?: string,
    seed?: number,
  ) => {
    const iterations = settings.iterations || 1

    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: iterations > 1 ? `Generating video (1/${iterations})...` : 'Generating video...',
      videoUrl: null,
      videoPath: null,
      enhancedPrompt: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
      iterationCurrent: 1,
      iterationTotal: iterations,
      lastSeed: null,
      initiator: initiator ?? null,
    })

    cancelledRef.current = false
    let progressInterval: ReturnType<typeof setInterval> | null = null

    try {
      const iterPrefix = (i: number) => iterations > 1 ? `(${i}/${iterations}) ` : ''

      const pollProgress = (iteration: number) => async () => {
        if (cancelledRef.current) return
        try {
          const data: GenerationProgress = await window.electronAPI.getGenerationProgress()
          if (cancelledRef.current) return
          setState(prev => ({
            ...prev,
            progress: data.progress,
            statusMessage: iterPrefix(iteration) + getPhaseMessage(data.phase),
          }))
        } catch {
          // Ignore polling errors
        }
      }

      const is4K = settings.videoResolution === '4K'
      const generateParams = {
        prompt,
        imagePath,
        middleImagePath,
        lastImagePath,
        audioPath,
        resolution: is4K ? '1080p' : settings.videoResolution,
        aspectRatio: settings.aspectRatio || '16:9',
        duration: settings.duration,
        fps: settings.fps,
        cameraMotion: settings.cameraMotion,
        spatialUpscale: settings.spatialUpscale,
        upscaleDenoise: settings.upscaleDenoise,
        temporalUpscale: settings.temporalUpscale,
        promptEnhance: settings.promptEnhance,
        filmGrain: settings.filmGrain,
        filmGrainIntensity: settings.filmGrainIntensity,
        filmGrainSize: settings.filmGrainSize,
        stgScale: settings.stgScale,
        crf: settings.crf,
        negativePrompt: settings.negativePrompt,
        maskMode: settings.maskMode,
        maskPrompt: settings.maskPrompt,
        maskDilation: settings.maskDilation,
        rediffusionMaskStrength: settings.rediffusionMaskStrength,
        paintedMaskDataUrl: settings.paintedMaskDataUrl,
        firstStrength: strengths?.first,
        middleStrength: strengths?.middle,
        lastStrength: strengths?.last,
        rtxSuperRes: is4K,
        preserveAspectRatio,
        projectName,
        guideVideoPath,
        guideIndexList,
        guideStrength,
        loras: settings.loras,
        stackId,
        seed,
      }

      for (let i = 1; i <= iterations; i++) {
        if (cancelledRef.current) return

        setState(prev => ({
          ...prev,
          iterationCurrent: i,
          statusMessage: iterPrefix(i) + 'Generating video...',
          progress: 0,
        }))

        progressInterval = setInterval(pollProgress(i), 500)

        const result = await window.electronAPI.generateVideo(generateParams)

        if (progressInterval) {
          clearInterval(progressInterval)
          progressInterval = null
        }

        if (cancelledRef.current) return

        if (result.status === 'complete' && result.video_path) {
          const videoPathNormalized = result.video_path.replace(/\\/g, '/')
          const fileUrl = videoPathNormalized.startsWith('/') ? `file://${videoPathNormalized}` : `file:///${videoPathNormalized}`

          const isLast = i === iterations
          setState(prev => ({
            ...prev,
            isGenerating: !isLast,
            progress: 100,
            statusMessage: isLast ? 'Complete!' : iterPrefix(i) + 'Complete!',
            videoUrl: fileUrl,
            videoPath: result.video_path ?? null,
            enhancedPrompt: result.enhanced_prompt ?? null,
            imageUrl: null,
            imageUrls: [],
            error: null,
            iterationCurrent: i,
            iterationTotal: iterations,
            lastSeed: result.seed ?? null,
          }))

          // Brief pause between iterations to let archive effects process
          if (!isLast) {
            await new Promise(r => setTimeout(r, 100))
          }
        } else if (result.status === 'cancelled') {
          setState(prev => ({
            ...prev,
            isGenerating: false,
            statusMessage: 'Cancelled',
          }))
          return
        } else if (result.error) {
          throw new Error(result.error)
        }
      }

    } catch (error) {
      if (cancelledRef.current) {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          statusMessage: 'Cancelled',
        }))
      } else {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
      }
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
    }
  }, [])

  const cancel = useCallback(async () => {
    cancelledRef.current = true

    try {
      await window.electronAPI.cancelGeneration()
    } catch {
      // Ignore errors from cancel request
    }

    setState(prev => ({
      ...prev,
      isGenerating: false,
      statusMessage: 'Cancelled',
    }))
  }, [])

  const generateImage = useCallback(async (
    prompt: string,
    settings: GenerationSettings,
    imagePath?: string | null,
    strength?: number,
    projectName?: string,
    referenceImagePaths?: string[],
    initiator?: GenerationInitiator,
  ) => {
    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: 'Generating image...',
      videoUrl: null,
      videoPath: null,
      enhancedPrompt: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
      iterationCurrent: 0,
      iterationTotal: 0,
      initiator: initiator ?? null,
      lastSeed: null,
    })

    cancelledRef.current = false
    let progressInterval: ReturnType<typeof setInterval> | null = null

    try {
      const pollProgress = async () => {
        if (cancelledRef.current) return
        try {
          const data: GenerationProgress = await window.electronAPI.getGenerationProgress()
          if (cancelledRef.current) return
          setState(prev => ({
            ...prev,
            progress: data.progress,
            statusMessage: getPhaseMessage(data.phase),
          }))
        } catch {
          // Ignore polling errors
        }
      }

      progressInterval = setInterval(pollProgress, 500)

      const result = await window.electronAPI.generateVideo({
        prompt,
        imagePath,
        resolution: '1080p',
        aspectRatio: settings.imageAspectRatio || settings.aspectRatio || '16:9',
        duration: 0,
        fps: 24,
        firstStrength: strength,
        imageMode: true,
        imageSteps: settings.imageSteps,
        imageGenerator: settings.imageGenerator,
        projectName,
        referenceImagePaths,
      })

      if (cancelledRef.current) return

      if (result.status === 'complete' && result.image_path) {
        const normalized = result.image_path.replace(/\\/g, '/')
        const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`

        setState(prev => ({
          ...prev,
          isGenerating: false,
          progress: 100,
          statusMessage: 'Complete!',
          videoUrl: null,
          videoPath: null,
          enhancedPrompt: null,
          imageUrl: fileUrl,
          imageUrls: [fileUrl],
          error: null,
          iterationCurrent: 0,
          iterationTotal: 0,
        }))
      } else if (result.status === 'cancelled') {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          statusMessage: 'Cancelled',
        }))
      } else if (result.error) {
        throw new Error(result.error)
      }
    } catch (error) {
      if (cancelledRef.current) {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          statusMessage: 'Cancelled',
        }))
      } else {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
      }
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
    }
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return (
    <GenerationContext.Provider value={{
      ...state,
      generate,
      generateImage,
      cancel,
      reset,
    }}>
      {children}
    </GenerationContext.Provider>
  )
}

export function useGeneration(): GenerationContextType {
  const ctx = useContext(GenerationContext)
  if (!ctx) throw new Error('useGeneration must be used within GenerationProvider')
  return ctx
}
