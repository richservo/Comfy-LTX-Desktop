import { app } from 'electron'
import path from 'path'

function normalizeComfyUiUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '')
  if (!trimmed) return 'http://localhost:8188'
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

export function getEnvComfyUiPath(): string | null {
  const value = process.env.LTX_DESKTOP_COMFYUI_PATH?.trim()
  return value ? path.resolve(value) : null
}

export function getDefaultComfyUiPath(): string {
  return getEnvComfyUiPath() || path.join(app.getPath('documents'), 'ComfyUI')
}

export function getDefaultComfyUiUrl(): string {
  return normalizeComfyUiUrl(process.env.LTX_DESKTOP_COMFYUI_URL || 'http://localhost:8188')
}

export function getDefaultComfyUiOutputDir(): string {
  const comfyPath = getEnvComfyUiPath()
  return comfyPath
    ? path.join(comfyPath, 'output')
    : path.join(app.getPath('documents'), 'ComfyUI', 'output')
}
