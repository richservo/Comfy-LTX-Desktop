import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { comfyClient } from '../comfyui/client'
import { logger } from '../logger'

export interface ComfyUISettings {
  comfyuiUrl: string
  comfyuiOutputDir: string
  comfyuiPath: string
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
  sampler: string
}

function getDefaultSettings(): ComfyUISettings {
  const docsDir = app.getPath('documents')
  return {
    comfyuiUrl: 'http://localhost:8188',
    comfyuiOutputDir: path.join(docsDir, 'ComfyUI', 'output'),
    comfyuiPath: '',
    seedLocked: false,
    lockedSeed: 42,
    steps: 30,
    cfg: 3,
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
    sampler: 'euler_ancestral',
  }
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'comfyui-settings.json')
}

export function getComfyUISettings(): ComfyUISettings {
  const settingsPath = getSettingsPath()
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const data = JSON.parse(raw) as Partial<ComfyUISettings>
      return { ...getDefaultSettings(), ...data }
    }
  } catch (err) {
    logger.error(`Failed to read ComfyUI settings: ${err}`)
  }
  return { ...getDefaultSettings() }
}

function saveComfyUISettings(settings: ComfyUISettings): void {
  const settingsPath = getSettingsPath()
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  } catch (err) {
    logger.error(`Failed to write ComfyUI settings: ${err}`)
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return getComfyUISettings()
  })

  ipcMain.handle(
    'settings:update',
    (_event, patch: Partial<ComfyUISettings>) => {
      const current = getComfyUISettings()
      const updated = { ...current, ...patch }
      saveComfyUISettings(updated)

      // If URL changed, update the client
      if (patch.comfyuiUrl) {
        comfyClient.setBaseUrl(updated.comfyuiUrl)
      }

      return updated
    },
  )
}
