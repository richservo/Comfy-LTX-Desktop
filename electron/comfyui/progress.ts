import WebSocket from 'ws'
import { logger } from '../logger'

export interface GenerationProgress {
  status: 'idle' | 'running' | 'complete' | 'error'
  phase: string
  progress: number
  currentStep: number | null
  totalSteps: number | null
  errorMessage: string | null
}

export interface GenerationContext {
  hasFirstImage: boolean
  hasUpscale: boolean
  imageMode: boolean
  /** Node IDs that are prompt formatters (show "Enhancing prompt" phase) */
  formatterNodeIds?: string[]
  /** Z-Image is generating the first frame before LTXV */
  hasZImage?: boolean
}

const INITIAL_PROGRESS: GenerationProgress = {
  status: 'idle',
  phase: '',
  progress: 0,
  currentStep: null,
  totalSteps: null,
  errorMessage: null,
}

export class ComfyUIProgressTracker {
  private ws: WebSocket | null = null
  private progress: GenerationProgress = { ...INITIAL_PROGRESS }
  private baseUrl: string
  private activePromptId: string | null = null
  private completionResolve: ((value: GenerationProgress) => void) | null = null
  private completionReject: ((reason: Error) => void) | null = null

  private stageIndex = 0
  private lastValue: number | null = null
  private stageLabels: string[] = ['Generating...']
  private formatterNodeIds = new Set<string>()

  constructor(baseUrl = 'ws://localhost:8188') {
    this.baseUrl = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/^http/, 'ws').replace(/\/$/, '')
  }

  setGenerationContext(ctx: GenerationContext): void {
    if (ctx.imageMode) {
      this.stageLabels = ['Generating image']
    } else if (ctx.hasZImage) {
      // Z-Image generates first frame, then LTXV generates video
      this.stageLabels = ctx.hasUpscale
        ? ['Generating image', 'Generating video', 'Rediffusing']
        : ['Generating image', 'Generating video']
    } else if (ctx.hasFirstImage) {
      // I2V: no first frame generation needed
      this.stageLabels = ctx.hasUpscale
        ? ['Generating video', 'Rediffusing']
        : ['Generating video']
    } else {
      // T2V: first frame generated, then video, then optional rediffuse
      this.stageLabels = ctx.hasUpscale
        ? ['Generating first frame', 'Generating video', 'Rediffusing']
        : ['Generating first frame', 'Generating video']
    }
    this.stageIndex = 0
    this.lastValue = null
    this.formatterNodeIds = new Set(ctx.formatterNodeIds ?? [])
  }

  connect(clientId: string): void {
    this.disconnect()
    this.progress = { ...INITIAL_PROGRESS }
    this.stageIndex = 0
    this.lastValue = null

    const wsUrl = `${this.baseUrl}/ws?clientId=${clientId}`
    logger.info(`ComfyUI WebSocket connecting to ${wsUrl}`)

    this.ws = new WebSocket(wsUrl)

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString())
        this.handleMessage(message)
      } catch {
        // Binary data (preview images) — ignore
      }
    })

    this.ws.on('error', (err) => {
      logger.error(`ComfyUI WebSocket error: ${err.message}`)
    })

    this.ws.on('close', () => {
      logger.info('ComfyUI WebSocket closed')
    })
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Already closed
      }
      this.ws = null
    }
  }

  private getStageLabel(): string {
    return this.stageLabels[Math.min(this.stageIndex, this.stageLabels.length - 1)]
  }

  private handleMessage(message: { type: string; data?: Record<string, unknown> }): void {
    const { type, data } = message

    switch (type) {
      case 'status':
        // Queue status update
        break

      case 'execution_start':
        this.progress = {
          status: 'running',
          phase: this.getStageLabel(),
          progress: 0,
          currentStep: 0,
          totalSteps: null,
          errorMessage: null,
        }
        break

      case 'execution_cached':
        // Some nodes were cached, not a problem
        break

      case 'executing': {
        const node = data?.['node'] as string | null
        if (node === null) {
          // Execution finished for this prompt
          this.progress = {
            status: 'complete',
            phase: 'complete',
            progress: 100,
            currentStep: null,
            totalSteps: null,
            errorMessage: null,
          }
          this.resolveCompletion()
        } else if (this.formatterNodeIds.has(node)) {
          this.progress = {
            ...this.progress,
            status: 'running',
            phase: 'Enhancing prompt',
          }
        }
        break
      }

      case 'progress': {
        const value = data?.['value'] as number | undefined
        const max = data?.['max'] as number | undefined
        if (value !== undefined && max !== undefined && max > 0) {
          // Detect stage transition: value reset (new diffusion pass)
          if (this.lastValue !== null && value < this.lastValue) {
            this.stageIndex++
            logger.info(`Progress stage transition → ${this.stageIndex}: ${this.getStageLabel()}`)
          }
          this.lastValue = value

          this.progress = {
            status: 'running',
            phase: this.getStageLabel(),
            progress: Math.round((value / max) * 100),
            currentStep: value,
            totalSteps: max,
            errorMessage: null,
          }
        }
        break
      }

      case 'execution_error': {
        const errorMsg =
          (data?.['exception_message'] as string) ??
          (data?.['traceback'] as string) ??
          'Unknown ComfyUI execution error'
        this.progress = {
          status: 'error',
          phase: 'error',
          progress: 0,
          currentStep: null,
          totalSteps: null,
          errorMessage: errorMsg,
        }
        this.rejectCompletion(new Error(errorMsg))
        break
      }

      case 'execution_interrupted': {
        this.progress = {
          status: 'error',
          phase: 'cancelled',
          progress: 0,
          currentStep: null,
          totalSteps: null,
          errorMessage: 'Generation cancelled',
        }
        this.rejectCompletion(new Error('Generation cancelled'))
        break
      }
    }
  }

  getProgress(): GenerationProgress {
    return { ...this.progress }
  }

  waitForCompletion(promptId: string): Promise<GenerationProgress> {
    this.activePromptId = promptId

    return new Promise<GenerationProgress>((resolve, reject) => {
      // If already complete (unlikely but possible), resolve immediately
      if (this.progress.status === 'complete') {
        resolve(this.progress)
        return
      }
      if (this.progress.status === 'error') {
        reject(new Error(this.progress.errorMessage ?? 'Execution error'))
        return
      }

      this.completionResolve = resolve
      this.completionReject = reject
    })
  }

  private resolveCompletion(): void {
    if (this.completionResolve) {
      this.completionResolve({ ...this.progress })
      this.completionResolve = null
      this.completionReject = null
    }
  }

  private rejectCompletion(error: Error): void {
    if (this.completionReject) {
      this.completionReject(error)
      this.completionResolve = null
      this.completionReject = null
    }
  }

  reset(): void {
    this.progress = { ...INITIAL_PROGRESS }
    this.activePromptId = null
    this.completionResolve = null
    this.completionReject = null
    this.stageIndex = 0
    this.lastValue = null
  }

  getActivePromptId(): string | null {
    return this.activePromptId
  }
}

// Singleton
export const progressTracker = new ComfyUIProgressTracker()
