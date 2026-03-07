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
  vaeCheckpoint: string
  spatialUpscaleModel: string
  temporalUpscaleModel: string
  upscaleLora: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  comfyuiUrl: 'http://localhost:8188',
  comfyuiOutputDir: '',
  seedLocked: false,
  lockedSeed: 42,
  steps: 8,
  cfg: 1.0,
  ollamaEnabled: true,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma3:12b',
  filmGrain: false,
  filmGrainIntensity: 0.05,
  filmGrainSize: 1.2,
  checkpoint: 'ltx-2.3-22b-dev-fp8.safetensors',
  textEncoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
  vaeCheckpoint: 'ltx-2.3-22b-dev-fp8.safetensors',
  spatialUpscaleModel: 'ltx-2.3-spatial-upscaler-x2-1.0.safetensors',
  temporalUpscaleModel: 'ltx-2.3-temporal-upscaler-x2-1.0.safetensors',
  upscaleLora: 'ltx-2.3-22b-distilled-lora-384.safetensors',
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
