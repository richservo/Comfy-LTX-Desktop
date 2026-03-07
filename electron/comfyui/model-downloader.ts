import fs from 'fs'
import path from 'path'
import { logger } from '../logger'

export interface ModelEntry {
  filename: string
  hfRepo: string
  hfPath: string
  destSubdir: string
  sizeBytes: number
}

export const MODEL_MANIFEST: ModelEntry[] = [
  {
    filename: 'ltx-2.3-22b-dev-fp8.safetensors',
    hfRepo: 'Lightricks/LTX-2.3-fp8',
    hfPath: 'ltx-2.3-22b-dev-fp8.safetensors',
    destSubdir: 'models/checkpoints',
    sizeBytes: 29_100_000_000,
  },
  {
    filename: 'gemma_3_12B_it_fp4_mixed.safetensors',
    hfRepo: 'Comfy-Org/ltx-2',
    hfPath: 'split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors',
    destSubdir: 'models/text_encoders',
    sizeBytes: 9_400_000_000,
  },
  {
    filename: 'ltx-2.3-spatial-upscaler-x2-1.0.safetensors',
    hfRepo: 'Lightricks/LTX-2.3',
    hfPath: 'ltx-2.3-spatial-upscaler-x2-1.0.safetensors',
    destSubdir: 'models/upscale_models',
    sizeBytes: 995_000_000,
  },
  {
    filename: 'ltx-2.3-temporal-upscaler-x2-1.0.safetensors',
    hfRepo: 'Lightricks/LTX-2.3',
    hfPath: 'ltx-2.3-temporal-upscaler-x2-1.0.safetensors',
    destSubdir: 'models/upscale_models',
    sizeBytes: 262_000_000,
  },
  {
    filename: 'ltx-2.3-22b-distilled-lora-384.safetensors',
    hfRepo: 'Lightricks/LTX-2.3',
    hfPath: 'ltx-2.3-22b-distilled-lora-384.safetensors',
    destSubdir: 'models/loras',
    sizeBytes: 7_600_000_000,
  },
]

export interface DownloadProgress {
  currentFile: string
  fileIndex: number
  totalFiles: number
  bytesDownloaded: number
  totalBytes: number
  speedMbps: number
  phase: 'downloading' | 'complete' | 'error'
  error?: string
}

export interface ModelCheckResult {
  allPresent: boolean
  missing: ModelEntry[]
  present: ModelEntry[]
  missingBytes: number
  totalBytes: number
}

/** Check which models already exist in the ComfyUI folder */
export function checkExistingModels(comfyPath: string): ModelCheckResult {
  const missing: ModelEntry[] = []
  const present: ModelEntry[] = []

  for (const entry of MODEL_MANIFEST) {
    const destFile = path.join(comfyPath, entry.destSubdir, entry.filename)
    if (fs.existsSync(destFile)) {
      present.push(entry)
    } else {
      missing.push(entry)
    }
  }

  const missingBytes = missing.reduce((sum, e) => sum + e.sizeBytes, 0)
  const totalBytes = MODEL_MANIFEST.reduce((sum, e) => sum + e.sizeBytes, 0)

  return {
    allPresent: missing.length === 0,
    missing,
    present,
    missingBytes,
    totalBytes,
  }
}

/** Download all missing models into the ComfyUI folder */
export async function downloadModels(
  comfyPath: string,
  onProgress: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  const { missing } = checkExistingModels(comfyPath)

  if (missing.length === 0) {
    onProgress({
      currentFile: '',
      fileIndex: 0,
      totalFiles: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      speedMbps: 0,
      phase: 'complete',
    })
    return
  }

  const totalBytes = missing.reduce((sum, e) => sum + e.sizeBytes, 0)
  let globalDownloaded = 0

  for (let i = 0; i < missing.length; i++) {
    const entry = missing[i]
    const destDir = path.join(comfyPath, entry.destSubdir)
    const destFile = path.join(destDir, entry.filename)
    const partFile = destFile + '.part'

    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true })

    const url = `https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.hfPath}`
    logger.info(`Downloading ${entry.filename} from ${url}`)

    // Check for existing partial download to support resume
    let resumeOffset = 0
    if (fs.existsSync(partFile)) {
      resumeOffset = fs.statSync(partFile).size
      globalDownloaded += resumeOffset
    }

    const headers: Record<string, string> = {}
    if (resumeOffset > 0) {
      headers['Range'] = `bytes=${resumeOffset}-`
    }

    const response = await fetch(url, {
      headers,
      signal: abortSignal,
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status} downloading ${entry.filename}`)
    }

    if (!response.body) {
      throw new Error(`No response body for ${entry.filename}`)
    }

    const fd = fs.openSync(partFile, resumeOffset > 0 ? 'a' : 'w')
    const reader = response.body.getReader()
    let fileDownloaded = resumeOffset
    let lastTime = Date.now()
    let lastBytes = globalDownloaded
    let speedMbps = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        fs.writeSync(fd, Buffer.from(value))
        fileDownloaded += value.byteLength
        globalDownloaded += value.byteLength

        // Calculate speed every 500ms
        const now = Date.now()
        const elapsed = (now - lastTime) / 1000
        if (elapsed >= 0.5) {
          const bytesDelta = globalDownloaded - lastBytes
          speedMbps = bytesDelta / elapsed / (1024 * 1024)
          lastTime = now
          lastBytes = globalDownloaded
        }

        onProgress({
          currentFile: entry.filename,
          fileIndex: i,
          totalFiles: missing.length,
          bytesDownloaded: globalDownloaded,
          totalBytes,
          speedMbps,
          phase: 'downloading',
        })
      }
    } finally {
      fs.closeSync(fd)
    }

    // Rename .part to final
    fs.renameSync(partFile, destFile)
    logger.info(`Downloaded ${entry.filename}`)
  }

  onProgress({
    currentFile: '',
    fileIndex: missing.length,
    totalFiles: missing.length,
    bytesDownloaded: globalDownloaded,
    totalBytes,
    speedMbps: 0,
    phase: 'complete',
  })
}
