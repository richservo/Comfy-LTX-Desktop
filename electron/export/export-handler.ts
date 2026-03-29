import { ipcMain, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { getAllowedRoots } from '../config'
import { logger } from '../logger'
import { validatePath } from '../path-validation'
import { findFfmpegPath, runFfmpeg, urlToFilePath, stopExportProcess } from './ffmpeg-utils'
import { flattenTimeline } from './timeline'
import type { ExportClip } from './timeline'
import type { ExportSubtitle } from './video-filter'
import { buildVideoFilterGraph } from './video-filter'
import { mixAudioToPcm } from './audio-mix'

function sendExportProgress(phase: string, percent: number, detail?: string) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('export:progress', { phase, percent, detail })
  }
}

export function registerExportHandlers(): void {
  ipcMain.handle('export-native', async (_event, data: {
    clips: ExportClip[]; outputPath: string; codec: string; width: number; height: number; fps: number; quality: number;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: ExportSubtitle[];
  }) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return { error: 'FFmpeg not found' }

    const { clips, outputPath, codec, width, height, fps, quality, letterbox, subtitles } = data

    // Validate output path and all clip source paths
    try {
      validatePath(outputPath, getAllowedRoots())
      for (const clip of clips) {
        const fp = urlToFilePath(clip.url)
        if (fp) validatePath(fp, getAllowedRoots())
      }
    } catch (err) {
      return { error: String(err) }
    }

    const segments = flattenTimeline(clips)
    if (segments.length === 0) return { error: 'No clips to export' }

    // Verify source files exist
    for (const seg of segments) {
      if (seg.filePath && !fs.existsSync(seg.filePath)) {
        return { error: `Source file not found: ${path.basename(seg.filePath)}` }
      }
    }

    const tmpDir = os.tmpdir()
    const ts = Date.now()
    const tmpVideo = path.join(tmpDir, `ltx-export-video-${ts}.mkv`)
    const tmpAudio = path.join(tmpDir, `ltx-export-audio-${ts}.wav`)
    const cleanup = () => {
      try { fs.unlinkSync(tmpVideo) } catch {}
      try { fs.unlinkSync(tmpAudio) } catch {}
    }

    try {
      // Compute total timeline duration for progress estimation
      let totalDuration = segments.reduce((max, s) => Math.max(max, s.startTime + s.duration), 0)
      for (const c of clips) {
        totalDuration = Math.max(totalDuration, c.startTime + c.duration)
      }

      // STEP 1: Export video-only (simple concat, no audio complexity)
      // Weight: 0-60% of total progress
      logger.info( `[Export] Step 1: Video-only export (${segments.length} segments)`)
      sendExportProgress('video', 0, 'Rendering video...')
      {
        const { inputs, filterScript } = buildVideoFilterGraph(segments, { width, height, fps, letterbox, subtitles })

        const filterFile = path.join(tmpDir, `ltx-filter-v-${ts}.txt`)
        fs.writeFileSync(filterFile, filterScript, 'utf8')

        const r = await runFfmpeg(ffmpegPath, [
          '-y', ...inputs, '-filter_complex_script', filterFile,
          '-map', '[outv]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', tmpVideo
        ], (info) => {
          const pct = totalDuration > 0 ? Math.min(60, Math.round((info.time / totalDuration) * 60)) : 0
          const detail = info.fps > 0 ? `frame ${info.frame} (${info.fps.toFixed(0)} fps)` : `frame ${info.frame}`
          sendExportProgress('video', pct, detail)
        })
        try { fs.unlinkSync(filterFile) } catch {}
        if (!r.success) { cleanup(); return { error: r.error } }
      }

      // STEP 2: Audio mixdown (PCM buffer approach)
      // Weight: 60-80% of total progress
      logger.info( '[Export] Step 2: Audio mixdown (PCM buffer approach)')
      sendExportProgress('audio', 65, 'Mixing audio...')

      const { pcmBuffer, sampleRate, channels } = await mixAudioToPcm(clips, totalDuration, ffmpegPath)

      const tmpRawPcm = path.join(tmpDir, `ltx-pcm-${ts}.raw`)
      fs.writeFileSync(tmpRawPcm, pcmBuffer)
      logger.info( `[Export] Wrote raw PCM: ${pcmBuffer.length} bytes (${totalDuration.toFixed(2)}s)`)

      {
        const r = await runFfmpeg(ffmpegPath, [
          '-y', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels),
          '-i', tmpRawPcm, '-c:a', 'pcm_s16le', tmpAudio,
        ])
        try { fs.unlinkSync(tmpRawPcm) } catch {}
        if (!r.success) { cleanup(); return { error: r.error } }
      }
      sendExportProgress('audio', 80, 'Audio mixed')

      // STEP 3: Combine video + audio (no re-encode of video)
      // Weight: 80-100% of total progress
      logger.info( '[Export] Step 3: Combining video + audio')
      sendExportProgress('mux', 82, 'Combining video + audio...')
      let videoCodecArgs: string[]
      let audioCodecArgs: string[]
      if (codec === 'h264') {
        videoCodecArgs = ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(quality || 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
        audioCodecArgs = ['-c:a', 'aac', '-b:a', '192k']
      } else if (codec === 'prores') {
        videoCodecArgs = ['-c:v', 'prores_ks', '-profile:v', String(quality || 3), '-pix_fmt', 'yuva444p10le']
        audioCodecArgs = ['-c:a', 'pcm_s16le']
      } else if (codec === 'vp9') {
        videoCodecArgs = ['-c:v', 'libvpx-vp9', '-b:v', `${quality || 8}M`, '-pix_fmt', 'yuv420p']
        audioCodecArgs = ['-c:a', 'libopus', '-b:a', '128k']
      } else {
        cleanup()
        return { error: `Unknown codec: ${codec}` }
      }

      // If final codec matches temp video (h264), just copy video stream
      const canCopyVideo = codec === 'h264'
      const r = await runFfmpeg(ffmpegPath, [
        '-y', '-i', tmpVideo, '-i', tmpAudio,
        '-map', '0:v', '-map', '1:a',
        ...(canCopyVideo ? ['-c:v', 'copy'] : videoCodecArgs),
        ...audioCodecArgs, '-shortest', outputPath
      ], (info) => {
        const pct = totalDuration > 0 ? Math.min(99, 82 + Math.round((info.time / totalDuration) * 18)) : 85
        sendExportProgress('mux', pct, 'Finalizing...')
      })

      cleanup()
      if (!r.success) return { error: r.error }
      sendExportProgress('done', 100, 'Export complete')
      logger.info( `[Export] Done: ${outputPath}`)
      return { success: true }
    } catch (err) {
      cleanup()
      return { error: String(err) }
    }
  })

  ipcMain.handle('export-cancel', async () => {
    stopExportProcess()
    return { ok: true }
  })
}
