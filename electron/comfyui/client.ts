import fs from 'fs'
import path from 'path'
import { logger } from '../logger'

export interface ComfyUIUploadResult {
  name: string
  subfolder: string
  type: string
}

export interface ComfyUIPromptResult {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface ComfyUIHistoryOutput {
  images?: { filename: string; subfolder: string; type: string }[]
  gifs?: { filename: string; subfolder: string; type: string }[]
  videos?: { filename: string; subfolder: string; type: string }[]
}

export interface ComfyUIHistoryEntry {
  outputs: Record<string, ComfyUIHistoryOutput>
  status: { status_str: string; completed: boolean }
}

export class ComfyUIClient {
  private baseUrl: string

  constructor(baseUrl = 'http://localhost:8188') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '')
  }

  async submitWorkflow(
    workflow: Record<string, unknown>,
    clientId: string,
  ): Promise<ComfyUIPromptResult> {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`ComfyUI /prompt failed (${response.status}): ${text}`)
    }

    return (await response.json()) as ComfyUIPromptResult
  }

  async uploadImage(filePath: string): Promise<ComfyUIUploadResult> {
    const fileBuffer = fs.readFileSync(filePath)
    const filename = path.basename(filePath)

    // Build multipart form data manually for Node
    const boundary = `----ComfyUpload${Date.now()}`
    const ext = path.extname(filePath).toLowerCase()
    const mimeType =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg'

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"`,
      `Content-Type: ${mimeType}`,
      '',
      '',
    ].join('\r\n')

    const footer = `\r\n--${boundary}--\r\n`

    const headerBuffer = Buffer.from(header, 'utf-8')
    const footerBuffer = Buffer.from(footer, 'utf-8')
    const body = Buffer.concat([headerBuffer, fileBuffer, footerBuffer])

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `ComfyUI /upload/image failed (${response.status}): ${text}`,
      )
    }

    return (await response.json()) as ComfyUIUploadResult
  }

  async uploadAudio(filePath: string): Promise<ComfyUIUploadResult> {
    const fileBuffer = fs.readFileSync(filePath)
    const filename = path.basename(filePath)

    const boundary = `----ComfyUpload${Date.now()}`
    const ext = path.extname(filePath).toLowerCase()
    const mimeType =
      ext === '.wav'
        ? 'audio/wav'
        : ext === '.mp3'
          ? 'audio/mpeg'
          : ext === '.flac'
            ? 'audio/flac'
            : 'audio/wav'

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"`,
      `Content-Type: ${mimeType}`,
      '',
      '',
    ].join('\r\n')

    const footer = `\r\n--${boundary}--\r\n`

    const headerBuffer = Buffer.from(header, 'utf-8')
    const footerBuffer = Buffer.from(footer, 'utf-8')
    const body = Buffer.concat([headerBuffer, fileBuffer, footerBuffer])

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `ComfyUI audio upload failed (${response.status}): ${text}`,
      )
    }

    return (await response.json()) as ComfyUIUploadResult
  }

  async getHistory(
    promptId: string,
  ): Promise<Record<string, ComfyUIHistoryEntry>> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`)
    if (!response.ok) {
      throw new Error(`ComfyUI /history failed (${response.status})`)
    }
    return (await response.json()) as Record<string, ComfyUIHistoryEntry>
  }

  async cancel(promptId: string): Promise<void> {
    // Cancel running prompt
    await fetch(`${this.baseUrl}/interrupt`, { method: 'POST' })

    // Remove from queue
    await fetch(`${this.baseUrl}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    })
  }

  async checkHealth(): Promise<boolean> {
    // Scan all common ComfyUI ports and use the highest one that responds
    // (ComfyUI increments port when previous instance is still bound)
    const baseHost = new URL(this.baseUrl).hostname
    let bestUrl: string | null = null

    for (let port = 8188; port <= 8199; port++) {
      const candidateUrl = `http://${baseHost}:${port}`
      if (await this.probeUrl(candidateUrl)) {
        bestUrl = candidateUrl // keep going — highest port wins
      }
    }

    if (bestUrl) {
      if (bestUrl !== this.baseUrl) {
        logger.info(`ComfyUI auto-discovered on ${bestUrl} (was: ${this.baseUrl})`)
        this.baseUrl = bestUrl
      }
      return true
    }
    return false
  }

  private async probeUrl(url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)
      const response = await fetch(`${url}/system_stats`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  getOutputVideoPath(
    history: Record<string, ComfyUIHistoryEntry>,
    promptId: string,
  ): string | null {
    const entry = history[promptId]
    if (!entry) return null

    for (const output of Object.values(entry.outputs)) {
      // Check gifs first (ComfyUI video output often comes as "gifs")
      const files = output.gifs ?? output.images ?? []
      for (const file of files) {
        const ext = path.extname(file.filename).toLowerCase()
        if (['.mp4', '.webm', '.avi', '.mov', '.gif'].includes(ext)) {
          return this.resolveOutputPath(file.filename, file.subfolder, file.type)
        }
      }
    }

    // Fallback: return first file from any output
    for (const output of Object.values(entry.outputs)) {
      const files = output.gifs ?? output.images ?? []
      if (files.length > 0) {
        const file = files[0]
        return this.resolveOutputPath(file.filename, file.subfolder, file.type)
      }
    }

    return null
  }

  private resolveOutputPath(
    filename: string,
    subfolder: string,
    _type: string,
  ): string {
    // ComfyUI default output path; the caller may need to adjust this
    // based on ComfyUI's actual output directory
    if (subfolder) {
      return path.join(subfolder, filename)
    }
    return filename
  }

  async getObjectInfo(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/object_info`)
    if (!response.ok) {
      throw new Error(`ComfyUI /object_info failed (${response.status})`)
    }
    return (await response.json()) as Record<string, unknown>
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * Download an output file from ComfyUI's /view endpoint and save it locally.
   */
  async downloadOutput(
    filename: string,
    subfolder: string,
    type: string,
    destPath: string,
  ): Promise<void> {
    const params = new URLSearchParams({ filename, subfolder, type })
    const response = await fetch(`${this.baseUrl}/view?${params}`)

    if (!response.ok) {
      throw new Error(`ComfyUI /view failed (${response.status})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(destPath, buffer)
  }

  /**
   * Get the output file info (filename, subfolder, type) from history.
   * Returns null if no video output found.
   */
  getOutputFileInfo(
    history: Record<string, ComfyUIHistoryEntry>,
    promptId: string,
  ): { filename: string; subfolder: string; type: string } | null {
    const entry = history[promptId]
    if (!entry) return null

    for (const output of Object.values(entry.outputs)) {
      // Check videos, gifs, images (different node types use different keys)
      const allFiles = [
        ...(output.videos ?? []),
        ...(output.gifs ?? []),
        ...(output.images ?? []),
      ]
      for (const file of allFiles) {
        const ext = path.extname(file.filename).toLowerCase()
        if (['.mp4', '.webm', '.avi', '.mov', '.gif', '.webp'].includes(ext)) {
          return file
        }
      }
    }

    // Fallback: first file from any output
    for (const output of Object.values(entry.outputs)) {
      const allFiles = [
        ...(output.videos ?? []),
        ...(output.gifs ?? []),
        ...(output.images ?? []),
      ]
      if (allFiles.length > 0) {
        return allFiles[0]
      }
    }

    return null
  }
}

// Singleton instance
export const comfyClient = new ComfyUIClient()
