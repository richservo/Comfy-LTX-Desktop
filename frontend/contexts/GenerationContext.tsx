import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { GenerationSettings } from '../components/SettingsPanel'

interface GenerationState {
  isGenerating: boolean
  progress: number
  statusMessage: string
  videoUrl: string | null
  videoPath: string | null
  imageUrl: string | null
  imageUrls: string[]
  error: string | null
}

interface GenerationProgress {
  status: string
  phase: string
  progress: number
  currentStep: number | null
  totalSteps: number | null
}

export interface GenerationContextType extends GenerationState {
  generate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }) => Promise<void>
  generateImage: (prompt: string, settings: GenerationSettings, imagePath?: string | null, strength?: number) => Promise<void>
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
  imageUrl: null,
  imageUrls: [],
  error: null,
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
        middleImagePath,
        lastImagePath,
        audioPath,
        resolution: settings.videoResolution,
        aspectRatio: settings.aspectRatio || '16:9',
        duration: settings.duration,
        fps: settings.fps,
        cameraMotion: settings.cameraMotion,
        spatialUpscale: (settings as unknown as { spatialUpscale?: boolean }).spatialUpscale,
        upscaleDenoise: (settings as unknown as { upscaleDenoise?: number }).upscaleDenoise,
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
    prompt: string,
    settings: GenerationSettings,
    imagePath?: string | null,
    strength?: number,
  ) => {
    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: 'Generating image...',
      videoUrl: null,
      videoPath: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
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
      })

      if (cancelledRef.current) return

      if (result.status === 'complete' && result.image_path) {
        const normalized = result.image_path.replace(/\\/g, '/')
        const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`

        setState({
          isGenerating: false,
          progress: 100,
          statusMessage: 'Complete!',
          videoUrl: null,
          videoPath: null,
          imageUrl: fileUrl,
          imageUrls: [fileUrl],
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
