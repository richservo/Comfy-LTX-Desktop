import { spawn, spawnSync, ChildProcess, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from '../config'
import { logger } from '../logger'

let activeExportProcess: ChildProcess | null = null

export function findFfmpegPath(): string | null {
  let binDir: string | null = null

  if (process.platform === 'win32') {
    const imageioRelPath = path.join('Lib', 'site-packages', 'imageio_ffmpeg', 'binaries')
    binDir = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv', imageioRelPath)
      : path.join(process.resourcesPath, 'python', imageioRelPath)
  } else {
    // macOS/Linux: find lib/python3.X/site-packages dynamically
    const venvBase = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv')
      : path.join(process.resourcesPath, 'python')
    const libDir = path.join(venvBase, 'lib')
    if (fs.existsSync(libDir)) {
      const pythonDir = fs.readdirSync(libDir).find(e => e.startsWith('python3'))
      if (pythonDir) {
        binDir = path.join(libDir, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries')
      }
    }
  }

  if (binDir && fs.existsSync(binDir)) {
    const bin = fs.readdirSync(binDir).find(f => f.startsWith('ffmpeg') && (f.endsWith('.exe') || !f.includes('.')))
    if (bin) return path.join(binDir, bin)
  }

  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg' } catch { return null }
}

/** Check if a video file contains an audio stream using ffprobe/ffmpeg */
export function fileHasAudio(ffmpegPath: string, filePath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ['-i', filePath, '-hide_banner'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const output = (result.stdout || '') + (result.stderr || '')
    return output.includes('Audio:')
  } catch {
    return false
  }
}

export function urlToFilePath(url: string): string {
  // Convert http://127.0.0.1:PORT/outputs/file.mp4 -> backend/outputs/file.mp4
  if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
    const urlObj = new URL(url)
    const relPath = decodeURIComponent(urlObj.pathname).replace(/^\//, '')
    return path.join(getCurrentDir(), 'backend', relPath)
  }
  // file:///Users/path (macOS) -> /Users/path
  // file:///C:/path (Windows) -> C:/path
  if (url.startsWith('file://')) {
    let filePath = decodeURIComponent(url.slice(7)) // strip 'file://'
    // On Windows, strip leading / from /C:/path
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return filePath
  }
  // Already a file path
  return url
}

/** Run an ffmpeg command and return a promise. Logs stderr and sets activeExportProcess. */
export function runFfmpeg(ffmpegPath: string, args: string[], onProgress?: (info: { frame: number; fps: number; time: number }) => void): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info( `[ffmpeg] spawn: ${args.join(' ').slice(0, 400)}`)
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    activeExportProcess = proc
    let stderrLog = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrLog += text
      const lines = text.trim().split('\n')
      for (const line of lines) {
        if (line.includes('frame=') || line.includes('Error') || line.includes('error')) {
          logger.info( `[ffmpeg] ${line.trim().slice(0, 200)}`)
        }
        if (onProgress && line.includes('frame=')) {
          const frameMatch = line.match(/frame=\s*(\d+)/)
          const fpsMatch = line.match(/fps=\s*([\d.]+)/)
          const timeMatch = line.match(/time=\s*(\d+):(\d+):([\d.]+)/)
          if (frameMatch) {
            const frame = parseInt(frameMatch[1])
            const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0
            const time = timeMatch ? parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]) : 0
            onProgress({ frame, fps, time })
          }
        }
      }
    })
    proc.on('close', (code) => {
      activeExportProcess = null
      if (code === 0) {
        resolve({ success: true })
      } else {
        const errLines = stderrLog.split('\n').filter(l => l.trim()).slice(-5).join('\n')
        logger.error( `[ffmpeg] exited ${code}:\n${errLines}`)
        resolve({ success: false, error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}` })
      }
    })
    proc.on('error', (err) => {
      activeExportProcess = null
      resolve({ success: false, error: `Failed to start ffmpeg: ${err.message}` })
    })
  })
}

export function stopExportProcess(): void {
  if (activeExportProcess) {
    logger.info( 'Stopping active export process...')
    activeExportProcess.kill()
    activeExportProcess = null
  }
}
