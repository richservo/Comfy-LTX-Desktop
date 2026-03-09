import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { getComfyUISettings } from './settings-handlers'
import { installRsNodes } from '../comfyui/rs-nodes-installer'
import { logger } from '../logger'
import { getMainWindow } from '../window'

interface NodeRepoStatus {
  name: string
  hasUpdate: boolean
  error?: string
}

interface NodeCheckResult {
  results: NodeRepoStatus[]
  hasAnyUpdates: boolean
}

interface AppUpdateStatus {
  updateAvailable: boolean
  currentVersion: string
  latestVersion?: string
}

// Tracked state from electron-updater events
let appUpdateAvailable = false
let appLatestVersion: string | undefined

const REPOS = [
  { name: 'rs-nodes', dir: 'rs-nodes' },
  { name: 'RES4LYF', dir: 'RES4LYF' },
  { name: 'VideoHelperSuite', dir: 'ComfyUI-VideoHelperSuite' },
]

function execPromise(cmd: string, args: string[], options: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...options, maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${stderr || err.message}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

async function checkSingleNodeRepo(comfyPath: string, repo: { name: string; dir: string }): Promise<NodeRepoStatus> {
  const nodeDir = path.join(comfyPath, 'custom_nodes', repo.dir)

  if (!fs.existsSync(nodeDir)) {
    return { name: repo.name, hasUpdate: true, error: 'Not installed' }
  }

  if (!fs.existsSync(path.join(nodeDir, '.git'))) {
    // Directory exists but not a git repo (e.g. installed via ComfyUI Manager)
    return { name: repo.name, hasUpdate: false }
  }

  try {
    await execPromise('git', ['fetch', 'origin'], { cwd: nodeDir })

    const localHead = await execPromise('git', ['rev-parse', 'HEAD'], { cwd: nodeDir })

    let remoteHead: string
    try {
      remoteHead = await execPromise('git', ['rev-parse', 'origin/main'], { cwd: nodeDir })
    } catch {
      remoteHead = await execPromise('git', ['rev-parse', 'origin/master'], { cwd: nodeDir })
    }

    return { name: repo.name, hasUpdate: localHead !== remoteHead }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`Update check failed for ${repo.name}: ${message}`)
    return { name: repo.name, hasUpdate: false, error: message }
  }
}

export function initAppUpdateTracking(): void {
  autoUpdater.on('update-available', (info) => {
    appUpdateAvailable = true
    appLatestVersion = info.version
    logger.info(`[updater] Update available: ${info.version}`)
  })

  autoUpdater.on('update-not-available', () => {
    appUpdateAvailable = false
    appLatestVersion = undefined
  })
}

export function registerUpdateHandlers(): void {
  ipcMain.handle('updates:check-nodes', async (): Promise<NodeCheckResult> => {
    const settings = getComfyUISettings()
    const comfyPath = settings.comfyuiPath || ''
    if (!comfyPath) {
      return { results: [], hasAnyUpdates: false }
    }

    const results = await Promise.all(
      REPOS.map((repo) => checkSingleNodeRepo(comfyPath, repo))
    )

    return {
      results,
      hasAnyUpdates: results.some((r) => r.hasUpdate),
    }
  })

  ipcMain.handle('updates:update-nodes', async (): Promise<{ success: boolean; error?: string }> => {
    const settings = getComfyUISettings()
    const comfyPath = settings.comfyuiPath || ''
    if (!comfyPath) {
      return { success: false, error: 'ComfyUI path not configured' }
    }

    try {
      const win = getMainWindow()
      await installRsNodes(comfyPath, (progress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('updates:progress', progress)
        }
      })
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`Node update failed: ${message}`)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('updates:check-app', (): AppUpdateStatus => {
    return {
      updateAvailable: appUpdateAvailable,
      currentVersion: app.getVersion(),
      latestVersion: appLatestVersion,
    }
  })
}
