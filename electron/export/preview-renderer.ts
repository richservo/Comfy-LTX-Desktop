import { ipcMain, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { logger } from '../logger'
import { findFfmpegPath } from './ffmpeg-utils'
import { flattenTimeline } from './timeline'
import type { ExportClip } from './timeline'
import type { ExportSubtitle } from './video-filter'
import { buildVideoFilterGraph } from './video-filter'
import { mixAudioToPcm } from './audio-mix'
import { ChildProcess, spawn } from 'child_process'

let activePreviewProcess: ChildProcess | null = null
let currentPreviewFile: string | null = null

function sendProgress(phase: string, percent: number) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('preview:progress', { phase, percent })
  }
}

/** Run ffmpeg for preview rendering (separate process tracking from export) */
function runPreviewFfmpeg(ffmpegPath: string, args: string[]): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info(`[preview-ffmpeg] spawn: ${args.join(' ').slice(0, 400)}`)
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    activePreviewProcess = proc
    let stderrLog = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrLog += text
      // Parse progress from ffmpeg output
      const frameMatch = text.match(/frame=\s*(\d+)/)
      if (frameMatch) {
        const lines = text.trim().split('\n')
        for (const line of lines) {
          if (line.includes('frame=') || line.includes('Error') || line.includes('error')) {
            logger.info(`[preview-ffmpeg] ${line.trim().slice(0, 200)}`)
          }
        }
      }
    })
    proc.on('close', (code) => {
      activePreviewProcess = null
      if (code === 0) {
        resolve({ success: true })
      } else {
        const errLines = stderrLog.split('\n').filter(l => l.trim()).slice(-5).join('\n')
        logger.error(`[preview-ffmpeg] exited ${code}:\n${errLines}`)
        resolve({ success: false, error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}` })
      }
    })
    proc.on('error', (err) => {
      activePreviewProcess = null
      resolve({ success: false, error: `Failed to start ffmpeg: ${err.message}` })
    })
  })
}

export function registerPreviewHandlers(): void {
  ipcMain.handle('preview:render', async (_event, data: {
    clips: ExportClip[];
    width: number; height: number; fps: number;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: ExportSubtitle[];
  }) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return { error: 'FFmpeg not found' }

    const { clips, width, height, fps, letterbox, subtitles } = data

    const segments = flattenTimeline(clips)
    if (segments.length === 0) return { error: 'No clips to render' }

    // Verify source files exist
    for (const seg of segments) {
      if (seg.filePath && !fs.existsSync(seg.filePath)) {
        return { error: `Source file not found: ${path.basename(seg.filePath)}` }
      }
    }

    const tmpDir = os.tmpdir()
    const ts = Date.now()
    const outputFile = path.join(tmpDir, `ltx-preview-${ts}.mp4`)
    const tmpVideo = path.join(tmpDir, `ltx-preview-video-${ts}.mkv`)
    const tmpAudio = path.join(tmpDir, `ltx-preview-audio-${ts}.wav`)
    const cleanupTemp = () => {
      try { fs.unlinkSync(tmpVideo) } catch {}
      try { fs.unlinkSync(tmpAudio) } catch {}
    }

    // Delete previous preview file
    if (currentPreviewFile) {
      try { fs.unlinkSync(currentPreviewFile) } catch {}
      currentPreviewFile = null
    }

    try {
      // STEP 1: Video-only render (preview quality)
      sendProgress('video', 0)
      logger.info(`[Preview] Step 1: Video render (${segments.length} segments)`)
      {
        const { inputs, filterScript } = buildVideoFilterGraph(segments, { width, height, fps, letterbox, subtitles })

        const filterFile = path.join(tmpDir, `ltx-preview-filter-${ts}.txt`)
        fs.writeFileSync(filterFile, filterScript, 'utf8')

        const r = await runPreviewFfmpeg(ffmpegPath, [
          '-y', ...inputs, '-filter_complex_script', filterFile,
          '-map', '[outv]', '-an',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
          '-g', '4', // keyframe every 4 frames for fast scrub/reverse seeking
          '-pix_fmt', 'yuv420p', tmpVideo,
        ])
        try { fs.unlinkSync(filterFile) } catch {}
        if (!r.success) { cleanupTemp(); return { error: r.error } }
      }

      sendProgress('audio', 50)

      // STEP 2: Audio mixdown
      logger.info('[Preview] Step 2: Audio mixdown')
      let totalDuration = segments.reduce((max, s) => Math.max(max, s.startTime + s.duration), 0)
      for (const c of clips) {
        totalDuration = Math.max(totalDuration, c.startTime + c.duration)
      }

      const { pcmBuffer, sampleRate, channels } = await mixAudioToPcm(clips, totalDuration, ffmpegPath)

      const tmpRawPcm = path.join(tmpDir, `ltx-preview-pcm-${ts}.raw`)
      fs.writeFileSync(tmpRawPcm, pcmBuffer)

      {
        const r = await runPreviewFfmpeg(ffmpegPath, [
          '-y', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels),
          '-i', tmpRawPcm, '-c:a', 'pcm_s16le', tmpAudio,
        ])
        try { fs.unlinkSync(tmpRawPcm) } catch {}
        if (!r.success) { cleanupTemp(); return { error: r.error } }
      }

      sendProgress('mux', 80)

      // STEP 3: Mux video + audio → final MP4
      logger.info('[Preview] Step 3: Muxing preview')
      {
        const r = await runPreviewFfmpeg(ffmpegPath, [
          '-y', '-i', tmpVideo, '-i', tmpAudio,
          '-map', '0:v', '-map', '1:a',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          outputFile,
        ])
        cleanupTemp()
        if (!r.success) return { error: r.error }
      }

      currentPreviewFile = outputFile
      sendProgress('done', 100)
      logger.info(`[Preview] Done: ${outputFile}`)

      // Return file:// URL for the renderer to use
      const fileUrl = `file://${outputFile.replace(/\\/g, '/')}`
      return { success: true, filePath: outputFile, fileUrl }
    } catch (err) {
      cleanupTemp()
      return { error: String(err) }
    }
  })

  ipcMain.handle('preview:cancel', async () => {
    if (activePreviewProcess) {
      logger.info('Cancelling active preview render...')
      activePreviewProcess.kill()
      activePreviewProcess = null
    }
    return { ok: true }
  })

  ipcMain.handle('preview:cleanup', async (_event, filePath?: string) => {
    const target = filePath || currentPreviewFile
    if (target) {
      try { fs.unlinkSync(target) } catch {}
      if (target === currentPreviewFile) currentPreviewFile = null
    }
    return { ok: true }
  })
}

/** Clean up all preview temps — call on app quit */
export function cleanupPreviewFiles(): void {
  if (activePreviewProcess) {
    activePreviewProcess.kill()
    activePreviewProcess = null
  }
  if (currentPreviewFile) {
    try { fs.unlinkSync(currentPreviewFile) } catch {}
    currentPreviewFile = null
  }
}
