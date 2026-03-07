import { useState, useCallback, useRef } from 'react'
import type { GenerationSettings } from '../components/SettingsPanel'

interface GenerationState {
  isGenerating: boolean
  progress: number
  statusMessage: string
  videoUrl: string | null
  videoPath: string | null  // Original file path for upscaling
  imageUrl: string | null
  imageUrls: string[]  // For multiple image variations
  error: string | null
}

interface GenerationProgress {
  status: string
  phase: string
  progress: number
  currentStep: number | null
  totalSteps: number | null
}

interface UseGenerationReturn extends GenerationState {
  generate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }) => Promise<void>
  generateImage: (prompt: string, settings: GenerationSettings) => Promise<void>
  cancel: () => void
  reset: () => void
}

// Map phase to user-friendly message
function getPhaseMessage(phase: string): string {
  switch (phase) {
    case 'inference':
      return 'Generating...'
    case 'complete':
      return 'Complete!'
    case 'error':
      return 'Error'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Generating...'
  }
}

export function useGeneration(): UseGenerationReturn {
  const [state, setState] = useState<GenerationState>({
    isGenerating: false,
    progress: 0,
    statusMessage: '',
    videoUrl: null,
    videoPath: null,
    imageUrl: null,
    imageUrls: [],
    error: null,
  })

  const cancelledRef = useRef(false)

  const generate = useCallback(async (
    prompt: string,
    imagePath: string | null,
    settings: GenerationSettings,
    audioPath?: string | null,
    middleImagePath?: string | null,
    lastImagePath?: string | null,
    strengths?: { first?: number; middle?: number; last?: number },
  ) => {
    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: 'Generating video...',
      videoUrl: null,
      videoPath: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
    })

    cancelledRef.current = false
    let progressInterval: ReturnType<typeof setInterval> | null = null

    try {
      // Poll for progress from ComfyUI via IPC
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

      // Start generation via ComfyUI IPC (async, returns when done)
      const result = await window.electronAPI.generateVideo({
        prompt,
        imagePath,
        middleImagePath,
        lastImagePath,
        audioPath,
        resolution: settings.videoResolution,
        aspectRatio: settings.aspectRatio || '16:9',
        duration: settings.duration,
        fps: settings.fps,
        cameraMotion: settings.cameraMotion,
        spatialUpscale: (settings as unknown as { spatialUpscale?: boolean }).spatialUpscale,
        temporalUpscale: (settings as unknown as { temporalUpscale?: boolean }).temporalUpscale,
        filmGrain: (settings as unknown as { filmGrain?: boolean }).filmGrain,
        filmGrainIntensity: (settings as unknown as { filmGrainIntensity?: number }).filmGrainIntensity,
        filmGrainSize: (settings as unknown as { filmGrainSize?: number }).filmGrainSize,
        firstStrength: strengths?.first,
        middleStrength: strengths?.middle,
        lastStrength: strengths?.last,
      })

      if (cancelledRef.current) return

      if (result.status === 'complete' && result.video_path) {
        // Convert path to file:// URL
        const videoPathNormalized = result.video_path.replace(/\\/g, '/')
        const fileUrl = videoPathNormalized.startsWith('/') ? `file://${videoPathNormalized}` : `file:///${videoPathNormalized}`

        setState({
          isGenerating: false,
          progress: 100,
          statusMessage: 'Complete!',
          videoUrl: fileUrl,
          videoPath: result.video_path,
          imageUrl: null,
          imageUrls: [],
          error: null,
        })
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
    _prompt: string,
    _settings: GenerationSettings
  ) => {
    // Image generation not supported in ComfyUI integration (deferred)
    setState(prev => ({
      ...prev,
      error: 'Image generation is not supported in this version. Use ComfyUI directly for image generation.',
    }))
  }, [])

  const reset = useCallback(() => {
    setState({
      isGenerating: false,
      progress: 0,
      statusMessage: '',
      videoUrl: null,
      videoPath: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
    })
  }, [])

  return {
    ...state,
    generate,
    generateImage,
    cancel,
    reset,
  }
}
