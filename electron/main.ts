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
import { registerVideoProcessingHandlers } from './ipc/video-processing-handlers'
import { initSessionLog } from './logging-management'
import { initAutoUpdater } from './updater'
import { createWindow, getMainWindow } from './window'
import { sendAnalyticsEvent } from './analytics'

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

    // Fire analytics event (no-op if user hasn't opted in)
    void sendAnalyticsEvent('ltxdesktop_app_launched')
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
