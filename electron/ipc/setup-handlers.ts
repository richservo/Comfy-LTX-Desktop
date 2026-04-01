import { ipcMain } from 'electron'
import fs from 'fs'
import { checkExistingModels, downloadModels } from '../comfyui/model-downloader'
import { installRsNodes } from '../comfyui/rs-nodes-installer'
import { getDefaultComfyUiPath } from '../comfyui/defaults'
import { logger } from '../logger'
import { getMainWindow } from '../window'

let installAbortController: AbortController | null = null

export function registerSetupHandlers(): void {
  ipcMain.handle('setup:get-default-comfy-path', () => {
    return getDefaultComfyUiPath()
  })

  ipcMain.handle(
    'setup:validate-comfy-path',
    (_event, comfyPath: string): { valid: boolean; error?: string } => {
      if (!fs.existsSync(comfyPath)) {
        return { valid: false, error: 'Directory does not exist' }
      }

      const modelsDir = path.join(comfyPath, 'models')
      const customNodesDir = path.join(comfyPath, 'custom_nodes')

      if (!fs.existsSync(modelsDir)) {
        return { valid: false, error: 'Missing "models" directory — not a ComfyUI installation' }
      }
      if (!fs.existsSync(customNodesDir)) {
        return {
          valid: false,
          error: 'Missing "custom_nodes" directory — not a ComfyUI installation',
        }
      }

      return { valid: true }
    },
  )

  ipcMain.handle(
    'setup:check-models',
    (_event, comfyPath: string) => {
      return checkExistingModels(comfyPath)
    },
  )

  ipcMain.handle(
    'setup:start-install',
    async (_event, comfyPath: string) => {
      const win = getMainWindow()
      if (!win) return { success: false, error: 'No main window' }

      installAbortController = new AbortController()

      const sendProgress = (data: Record<string, unknown>) => {
        if (!win.isDestroyed()) {
          win.webContents.send('setup:progress', data)
        }
      }

      try {
        // Phase 1: Download models
        await downloadModels(
          comfyPath,
          (progress) => {
            sendProgress({
              type: 'download',
              ...progress,
            })
          },
          installAbortController.signal,
        )

        // Phase 2: Install rs-nodes
        sendProgress({ type: 'rs-nodes', phase: 'cloning', message: 'Installing rs-nodes...' })
        await installRsNodes(comfyPath, (progress) => {
          sendProgress({
            type: 'rs-nodes',
            ...progress,
          })
        })

        sendProgress({ type: 'complete' })
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`Setup install failed: ${message}`)
        sendProgress({ type: 'error', error: message })
        return { success: false, error: message }
      } finally {
        installAbortController = null
      }
    },
  )

  ipcMain.handle('setup:cancel-install', () => {
    if (installAbortController) {
      installAbortController.abort()
      installAbortController = null
    }
  })

  ipcMain.handle('setup:get-disk-space', async (_event, dirPath: string) => {
    try {
      // Walk up to find an existing ancestor directory
      let checkPath = dirPath
      while (!fs.existsSync(checkPath)) {
        const parent = path.dirname(checkPath)
        if (parent === checkPath) break
        checkPath = parent
      }
      const stats = await fs.promises.statfs(checkPath)
      const freeBytes = stats.bfree * stats.bsize
      return { freeBytes }
    } catch {
      return { freeBytes: 0 }
    }
  })
}
