import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { getAllowedRoots } from '../config'
import { logger } from '../logger'
import { getMainWindow } from '../window'
import { validatePath, approvePath } from '../path-validation'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
}

function readLocalFileAsBase64(filePath: string): { data: string; mimeType: string } {
  const data = fs.readFileSync(filePath)
  const base64 = data.toString('base64')
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  return { data: base64, mimeType }
}

function searchDirectoryForFiles(dir: string, filenames: string[]): Record<string, string> {
  const results: Record<string, string> = {}
  const remaining = new Set(filenames.map(f => f.toLowerCase()))

  const walk = (currentDir: string, depth: number) => {
    if (remaining.size === 0 || depth > 10) return // max depth to avoid infinite loops
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (remaining.size === 0) break
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase()
          if (remaining.has(lower)) {
            results[lower] = fullPath
            remaining.delete(lower)
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(fullPath, depth + 1)
        }
      }
    } catch {
      // Skip directories we can't read (permissions, etc.)
    }
  }

  walk(dir, 0)
  return results
}


export function registerFileHandlers(): void {
  ipcMain.handle('open-ltx-api-key-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://console.ltx.video/api-keys/')
    return true
  })

  ipcMain.handle('open-fal-api-key-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://fal.ai/dashboard/keys')
    return true
  })

  ipcMain.handle('open-parent-folder-of-file', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    const parentDir = path.dirname(normalizedPath)
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      throw new Error(`Parent directory not found: ${parentDir}`)
    }
    shell.openPath(parentDir)
  })

  ipcMain.handle('show-item-in-folder', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('read-local-file', async (_event, filePath: string) => {
    try {
      const normalizedPath = validatePath(filePath, getAllowedRoots())

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`File not found: ${normalizedPath}`)
      }

      return readLocalFileAsBase64(normalizedPath)
    } catch (error) {
      logger.error( `Error reading local file: ${error}`)
      throw error
    }
  })

  // Approve a file path so it passes validatePath in future IPC calls.
  // Used when files are imported via <input> or drag-drop (no native dialog).
  ipcMain.handle('approve-path', async (_event, filePath: string) => {
    const cleaned = filePath.startsWith('file://') ? filePath.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '') : filePath
    const resolved = path.resolve(decodeURIComponent(cleaned).replace(/\//g, path.sep))
    approvePath(resolved)
  })

  // Read a local file as a raw Buffer (transferred as ArrayBuffer over IPC).
  // Much more efficient than base64 for large binary files like WAV audio.
  ipcMain.handle('read-local-file-buffer', async (_event, filePath: string) => {
    try {
      const normalizedPath = validatePath(filePath, getAllowedRoots())
      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`File not found: ${normalizedPath}`)
      }
      return fs.readFileSync(normalizedPath)
    } catch (error) {
      logger.error(`Error reading local file as buffer: ${error}`)
      throw error
    }
  })

  ipcMain.handle('show-save-dialog', async (_event, options: {
    title?: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options.title || 'Save File',
      defaultPath: options.defaultPath,
      filters: options.filters || [],
    })
    if (result.canceled || !result.filePath) return null
    approvePath(result.filePath)
    return result.filePath
  })

  ipcMain.handle('save-file', async (_event, filePath: string, data: string, encoding?: string) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
      } else {
        fs.writeFileSync(filePath, data, 'utf-8')
      }
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('save-binary-file', async (_event, filePath: string, data: ArrayBuffer) => {
    try {
      validatePath(filePath, getAllowedRoots())
      fs.writeFileSync(filePath, Buffer.from(data))
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving binary file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('show-open-directory-dialog', async (_event, options: { title?: string }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approvePath(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('search-directory-for-files', async (_event, dir: string, filenames: string[]) => {
    return searchDirectoryForFiles(dir, filenames)
  })

  ipcMain.handle('copy-file', async (_event, src: string, dest: string) => {
    try {
      validatePath(src, getAllowedRoots())
      validatePath(dest, getAllowedRoots())
      const dir = path.dirname(dest)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(src, dest)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('check-files-exist', async (_event, filePaths: string[]) => {
    const results: Record<string, boolean> = {}
    for (const p of filePaths) {
      try {
        results[p] = fs.existsSync(p)
      } catch {
        results[p] = false
      }
    }
    return results
  })

  ipcMain.handle('show-open-file-dialog', async (_event, options: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: string[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const props: any[] = ['openFile']
    if (options.properties?.includes('multiSelections')) props.push('multiSelections')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select File',
      filters: options.filters || [],
      properties: props,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    for (const fp of result.filePaths) {
      approvePath(fp)
    }
    return result.filePaths
  })

  ipcMain.handle('ensure-directory', async (_event, dirPath: string) => {
    try {
      validatePath(dirPath, getAllowedRoots())
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // List trashed files from _old folders in a project directory
  ipcMain.handle('list-trashed-assets', async (_event, projectDir: string) => {
    try {
      validatePath(projectDir, getAllowedRoots())
      const results: { path: string; filename: string; type: string; url: string; prompt?: string; timestamp?: string }[] = []
      const VIDEO_EXTS = new Set(['.mp4', '.webm', '.avi', '.mov'])
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

      for (const subDir of ['video', 'image']) {
        const oldDir = path.join(projectDir, subDir, '_old')
        if (!fs.existsSync(oldDir)) continue

        // Load .renders.json from _old if it exists
        let renders: Record<string, unknown>[] = []
        const rendersPath = path.join(oldDir, '.renders.json')
        if (fs.existsSync(rendersPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(rendersPath, 'utf-8'))
            renders = Array.isArray(parsed) ? parsed : (parsed?.renders ?? [])
          } catch { /* ignore */ }
        }

        for (const file of fs.readdirSync(oldDir)) {
          const ext = path.extname(file).toLowerCase()
          const isVideo = VIDEO_EXTS.has(ext)
          const isImage = IMAGE_EXTS.has(ext)
          if (!isVideo && !isImage) continue

          const filePath = path.join(oldDir, file)
          const normalized = filePath.replace(/\\/g, '/')
          const url = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
          const renderEntry = renders.find((r: Record<string, unknown>) => r.filename === file)
          results.push({
            path: filePath,
            filename: file,
            type: isVideo ? 'video' : 'image',
            url,
            prompt: (renderEntry?.prompt as string) || (renderEntry?.enhancedPrompt as string) || undefined,
            timestamp: (renderEntry?.timestamp as string) || undefined,
          })
        }
      }
      return results
    } catch (error) {
      return []
    }
  })

  // Restore a file from _old back to its parent directory
  ipcMain.handle('restore-asset', async (_event, filePath: string) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
      const oldDir = path.dirname(filePath)
      const parentDir = path.dirname(oldDir) // _old's parent
      const basename = path.basename(filePath)
      const dest = path.join(parentDir, basename)
      fs.renameSync(filePath, dest)

      // Move render entry back from _old/.renders.json to parent .renders.json
      const oldRendersPath = path.join(oldDir, '.renders.json')
      logger.info(`Restore: looking for renders at ${oldRendersPath}, exists=${fs.existsSync(oldRendersPath)}`)
      if (fs.existsSync(oldRendersPath)) {
        try {
          const oldParsed = JSON.parse(fs.readFileSync(oldRendersPath, 'utf-8'))
          const oldRenders: Record<string, unknown>[] = Array.isArray(oldParsed) ? oldParsed : (oldParsed?.renders ?? [])
          logger.info(`Restore: found ${oldRenders.length} entries in _old renders, looking for ${basename}`)
          const entryIdx = oldRenders.findIndex((r: Record<string, unknown>) => r.filename === basename)
          if (entryIdx >= 0) {
            const entry = oldRenders.splice(entryIdx, 1)[0]
            logger.info(`Restore: found entry for ${basename}, moving to parent`)
            // Write back trimmed _old renders
            fs.writeFileSync(oldRendersPath, JSON.stringify({ renders: oldRenders }, null, 2))
            // Write to parent .renders.json — remove any existing entries for this filename first
            const parentRendersPath = path.join(parentDir, '.renders.json')
            let parentRenders: Record<string, unknown>[] = []
            if (fs.existsSync(parentRendersPath)) {
              try {
                const pp = JSON.parse(fs.readFileSync(parentRendersPath, 'utf-8'))
                parentRenders = Array.isArray(pp) ? pp : (pp?.renders ?? [])
              } catch { /* start fresh */ }
            }
            // Remove ALL existing entries for this filename, then add the one from _old
            parentRenders = parentRenders.filter((r: Record<string, unknown>) => r.filename !== basename)
            parentRenders.push(entry)
            // Invalidate checksum so reconciliation re-runs
            fs.writeFileSync(parentRendersPath, JSON.stringify({ _diskTotalBytes: -1, renders: parentRenders }, null, 2))
            logger.info(`Restore: wrote ${parentRenders.length} entries to ${parentRendersPath}`)
          } else {
            logger.warn(`Restore: no render entry found for ${basename} in _old/.renders.json`)
          }
        } catch (err) {
          logger.warn(`Restore: failed to migrate render entry: ${err}`)
        }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Permanently delete a file
  ipcMain.handle('delete-asset-permanently', async (_event, filePath: string) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Move an asset file to a _old folder in its parent directory instead of deleting.
  // Also migrates its render entry from .renders.json into _old/.renders.json.
  ipcMain.handle('archive-asset', async (_event, filePath: string) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (!fs.existsSync(filePath)) return { success: true } // already gone
      const dir = path.dirname(filePath)
      const oldDir = path.join(dir, '_old')
      if (!fs.existsSync(oldDir)) fs.mkdirSync(oldDir, { recursive: true })
      const basename = path.basename(filePath)
      const dest = path.join(oldDir, basename)
      fs.renameSync(filePath, dest)

      // Move render entry from source .renders.json to _old/.renders.json
      const srcRendersPath = path.join(dir, '.renders.json')
      if (fs.existsSync(srcRendersPath)) {
        try {
          const srcParsed = JSON.parse(fs.readFileSync(srcRendersPath, 'utf-8'))
          const srcRenders: Record<string, unknown>[] = Array.isArray(srcParsed)
            ? srcParsed
            : (srcParsed?.renders ?? [])
          const entryIdx = srcRenders.findIndex((r: Record<string, unknown>) => r.filename === basename)
          if (entryIdx >= 0) {
            const entry = srcRenders.splice(entryIdx, 1)[0]
            // Write back source with entry removed + invalidate checksum
            fs.writeFileSync(srcRendersPath, JSON.stringify({ _diskTotalBytes: -1, renders: srcRenders }, null, 2))
            // Append to _old/.renders.json
            const oldRendersPath = path.join(oldDir, '.renders.json')
            let oldRenders: Record<string, unknown>[] = []
            if (fs.existsSync(oldRendersPath)) {
              try {
                const oldParsed = JSON.parse(fs.readFileSync(oldRendersPath, 'utf-8'))
                oldRenders = Array.isArray(oldParsed) ? oldParsed : (oldParsed?.renders ?? [])
              } catch { /* start fresh */ }
            }
            // Avoid duplicates in _old
            if (!oldRenders.some((r: Record<string, unknown>) => r.filename === basename)) {
              oldRenders.push(entry)
            }
            fs.writeFileSync(oldRendersPath, JSON.stringify({ renders: oldRenders }, null, 2))
          }
        } catch { /* non-critical, skip */ }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
