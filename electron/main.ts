import './app-paths'
import { app } from 'electron'
import { setupCSP } from './csp'
import { registerExportHandlers } from './export/export-handler'
import { stopExportProcess } from './export/ffmpeg-utils'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerComfyUIHandlers } from './ipc/comfyui-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerLogHandlers } from './ipc/log-handlers'
import { registerSetupHandlers } from './ipc/setup-handlers'
import { registerUpdateHandlers } from './ipc/update-handlers'
import { registerVideoProcessingHandlers } from './ipc/video-processing-handlers'
import { initSessionLog } from './logging-management'
import { initAutoUpdater } from './updater'
import { createWindow, getMainWindow } from './window'
import { checkAndRepairNodes, installRsNodes } from './comfyui/rs-nodes-installer'
import { comfyClient } from './comfyui/client'
import { getComfyUISettings } from './ipc/settings-handlers'
import { detectGpu } from './gpu'
import { logger } from './logger'
import fs from 'fs'
import path from 'path'


const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  initSessionLog()

  registerAppHandlers()
  registerComfyUIHandlers()
  registerSettingsHandlers()
  registerFileHandlers()
  registerLogHandlers()
  registerExportHandlers()
  registerSetupHandlers()
  registerUpdateHandlers()
  registerVideoProcessingHandlers()

  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      return
    }
    if (app.isReady()) {
      createWindow()
    }
  })

  app.whenReady().then(async () => {
    setupCSP()
    createWindow()
    initAutoUpdater()

    // Detect GPU capabilities (cached for workflow builder)
    detectGpu().catch(err => logger.warn(`GPU detection failed: ${err}`))

    // Auto-discover ComfyUI port at startup
    comfyClient.checkHealth().then(connected => {
      if (connected) {
        logger.info(`ComfyUI connected at ${comfyClient.getBaseUrl()}`)
      }
    }).catch(() => {})

    // Check for missing/broken custom nodes in the background
    // After an app update, re-run full node install (git pull + pip) to ensure compatibility
    const settings = getComfyUISettings()
    const comfyPath = settings.comfyuiPath
    if (comfyPath) {
      const appStateFile = path.join(app.getPath('userData'), 'app_state.json')
      let needsFullUpdate = false
      try {
        if (fs.existsSync(appStateFile)) {
          const appState = JSON.parse(fs.readFileSync(appStateFile, 'utf-8'))
          if (appState.lastAppVersion !== app.getVersion()) {
            needsFullUpdate = true
            appState.lastAppVersion = app.getVersion()
            fs.writeFileSync(appStateFile, JSON.stringify(appState, null, 2))
          }
        }
      } catch {
        // Ignore parse errors
      }

      if (needsFullUpdate) {
        logger.info(`App updated to ${app.getVersion()} — re-installing custom nodes`)
        installRsNodes(comfyPath, (p) => logger.info(`[post-update] ${p.message}`)).catch((err) => {
          logger.warn(`Post-update node install failed: ${err}`)
        })
      } else {
        checkAndRepairNodes(comfyPath).catch((err) => {
          logger.warn(`Startup node check failed: ${err}`)
        })
      }
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (getMainWindow() === null) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    stopExportProcess()
  })
}
