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

  constructor(baseUrl = 'ws://localhost:8188') {
    this.baseUrl = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/^http/, 'ws').replace(/\/$/, '')
  }

  connect(clientId: string): void {
    this.disconnect()
    this.progress = { ...INITIAL_PROGRESS }

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

  private handleMessage(message: { type: string; data?: Record<string, unknown> }): void {
    const { type, data } = message

    switch (type) {
      case 'status':
        // Queue status update
        break

      case 'execution_start':
        this.progress = {
          status: 'running',
          phase: 'inference',
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
        }
        break
      }

      case 'progress': {
        const value = data?.['value'] as number | undefined
        const max = data?.['max'] as number | undefined
        if (value !== undefined && max !== undefined && max > 0) {
          this.progress = {
            status: 'running',
            phase: 'inference',
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
  }

  getActivePromptId(): string | null {
    return this.activePromptId
  }
}

// Singleton
export const progressTracker = new ComfyUIProgressTracker()
