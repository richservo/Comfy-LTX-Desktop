import { app } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'

export const COMFYUI_URL = 'http://localhost:8188'
export const isDev = !app.isPackaged

// Get directory - works in both CJS and ESM contexts
export function getCurrentDir(): string {
  // In bundled output, use app.getAppPath()
  if (!isDev) {
    return path.dirname(app.getPath('exe'))
  }
  // In development, use process.cwd() which is the project root
  return process.cwd()
}

function getComfyUIOutputDir(): string {
  const settingsPath = path.join(app.getPath('userData'), 'comfyui-settings.json')
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const data = JSON.parse(raw)
      if (data.comfyuiOutputDir) return data.comfyuiOutputDir
    }
  } catch { /* use default */ }
  return path.join(app.getPath('documents'), 'ComfyUI', 'output')
}

export function getAllowedRoots(): string[] {
  const roots = [
    getCurrentDir(),
    app.getPath('userData'),
    app.getPath('downloads'),
    os.tmpdir(),
    getComfyUIOutputDir(),
  ]
  if (!isDev && process.resourcesPath) {
    roots.push(process.resourcesPath)
  }
  return roots
}
