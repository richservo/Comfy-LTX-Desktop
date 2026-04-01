import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface AppSettings {
  comfyuiUrl: string
  comfyuiOutputDir: string
  seedLocked: boolean
  lockedSeed: number
  steps: number
  cfg: number
  ollamaEnabled: boolean
  ollamaUrl: string
  ollamaModel: string
  filmGrain: boolean
  filmGrainIntensity: number
  filmGrainSize: number
  checkpoint: string
  textEncoder: string
  ggufEmbeddingsConnector: string
  videoVae: string
  vaeCheckpoint: string
  spatialUpscaleModel: string
  temporalUpscaleModel: string
  upscaleLora: string
  sampler: string
  promptFormatterTextEncoder: string
  imageGenerator: string
  geminiProjectId: string
  geminiRegion: string
  geminiImageSize: string
  promptEnhanceSystemPrompt: string
  tileT: number
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  comfyuiUrl: 'http://localhost:8188',
  comfyuiOutputDir: '',
  seedLocked: false,
  lockedSeed: 42,
  steps: 20,
  cfg: 3,
  ollamaEnabled: false,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma3:12b',
  filmGrain: false,
  filmGrainIntensity: 0.05,
  filmGrainSize: 1.2,
  checkpoint: 'ltx-2.3-22b-dev-fp8.safetensors',
  textEncoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
  ggufEmbeddingsConnector: '',
  videoVae: '',
  vaeCheckpoint: '',
  spatialUpscaleModel: 'ltx-2.3-spatial-upscaler-x2-1.0.safetensors',
  temporalUpscaleModel: 'ltx-2.3-temporal-upscaler-x2-1.0.safetensors',
  upscaleLora: 'ltx-2.3-22b-distilled-lora-384.safetensors',
  sampler: 'euler_ancestral',
  promptFormatterTextEncoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
  imageGenerator: 'none',
  geminiProjectId: '',
  geminiRegion: 'global',
  geminiImageSize: '2K',
  tileT: 0,
  promptEnhanceSystemPrompt: "Expand the user's prompt into a detailed prose paragraph describing a video scene. Write in present tense. Describe what is seen and heard \u2014 the environment, lighting, textures, sounds, body language, and small physical details that make the scene feel real. If characters speak or discuss something, write the actual dialogue in quotation marks. Base everything on the user's prompt and reference images if provided \u2014 do not change the subject or setting, just flesh it out with rich, grounded detail. Output ONLY the scene description.",
}

interface AppSettingsContextValue {
  settings: AppSettings
  isLoaded: boolean
  updateSettings: (patch: Partial<AppSettings>) => void
  refreshSettings: () => Promise<void>
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)

  const refreshSettings = useCallback(async () => {
    try {
      const data = await window.electronAPI.getSettings()
      setSettings({ ...DEFAULT_APP_SETTINGS, ...data })
      setIsLoaded(true)
    } catch {
      // Use defaults on error
      setIsLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refreshSettings()
  }, [refreshSettings])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...patch }
      // Persist to disk via IPC (fire and forget)
      void window.electronAPI.updateSettings(patch)
      return updated
    })
  }, [])

  const contextValue = useMemo<AppSettingsContextValue>(
    () => ({
      settings,
      isLoaded,
      updateSettings,
      refreshSettings,
    }),
    [isLoaded, refreshSettings, settings, updateSettings],
  )

  return <AppSettingsContext.Provider value={contextValue}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return context
}
