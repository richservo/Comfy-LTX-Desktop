import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { comfyClient } from '../comfyui/client'
import { progressTracker } from '../comfyui/progress'
import {
  buildWorkflow,
  getResolutionDimensions,
  calculateNumFrames,
} from '../comfyui/workflow-builder'
import { getComfyUISettings } from './settings-handlers'
import { logger } from '../logger'

interface GenerateParams {
  prompt: string
  imagePath?: string | null
  middleImagePath?: string | null
  lastImagePath?: string | null
  audioPath?: string | null
  resolution: string
  aspectRatio: string
  duration: number
  fps: number
  cameraMotion?: string
  spatialUpscale?: boolean
  temporalUpscale?: boolean
  filmGrain?: boolean
  filmGrainIntensity?: number
  filmGrainSize?: number
}

let activePromptId: string | null = null

function getOutputDir(): string {
  const outputDir = path.join(app.getPath('userData'), 'comfyui-output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  return outputDir
}

export function registerComfyUIHandlers(): void {
  ipcMain.handle('comfyui:generate', async (_event, params: GenerateParams) => {
    const settings = getComfyUISettings()
    const clientId = randomUUID()

    try {
      // 1. Resolve dimensions
      const { width, height } = getResolutionDimensions(
        params.resolution,
        params.aspectRatio || '16:9',
      )
      const numFrames = calculateNumFrames(params.duration, params.fps)

      // 2. Upload image if I2V
      let uploadedImage = null
      if (params.imagePath && fs.existsSync(params.imagePath)) {
        logger.info(`Uploading image to ComfyUI: ${params.imagePath}`)
        uploadedImage = await comfyClient.uploadImage(params.imagePath)
        logger.info(
          `Image uploaded: ${uploadedImage.name} (${uploadedImage.subfolder})`,
        )
      }

      // 2b. Upload middle frame if provided
      let uploadedMiddleImage = null
      if (params.middleImagePath && fs.existsSync(params.middleImagePath)) {
        logger.info(`Uploading middle frame to ComfyUI: ${params.middleImagePath}`)
        uploadedMiddleImage = await comfyClient.uploadImage(params.middleImagePath)
        logger.info(`Middle frame uploaded: ${uploadedMiddleImage.name}`)
      }

      // 2c. Upload last frame if provided
      let uploadedLastImage = null
      if (params.lastImagePath && fs.existsSync(params.lastImagePath)) {
        logger.info(`Uploading last frame to ComfyUI: ${params.lastImagePath}`)
        uploadedLastImage = await comfyClient.uploadImage(params.lastImagePath)
        logger.info(`Last frame uploaded: ${uploadedLastImage.name}`)
      }

      // 2d. Upload audio if provided
      let uploadedAudio = null
      if (params.audioPath && fs.existsSync(params.audioPath)) {
        logger.info(`Uploading audio to ComfyUI: ${params.audioPath}`)
        uploadedAudio = await comfyClient.uploadAudio(params.audioPath)
        logger.info(
          `Audio uploaded: ${uploadedAudio.name} (${uploadedAudio.subfolder})`,
        )
      }

      // 3. Build prompt text (append camera motion if specified)
      let promptText = params.prompt
      if (
        params.cameraMotion &&
        params.cameraMotion !== 'none' &&
        params.cameraMotion !== ''
      ) {
        promptText = `${promptText}. Camera: ${params.cameraMotion}`
      }

      // 4. Determine seed
      const seed = settings.seedLocked
        ? settings.lockedSeed
        : Math.floor(Math.random() * 2147483647)

      // 5. Build workflow
      const workflow = buildWorkflow({
        prompt: promptText,
        width,
        height,
        numFrames,
        frameRate: params.fps,
        seed,
        steps: settings.steps,
        cfg: settings.cfg,
        firstImage: uploadedImage,
        middleImage: uploadedMiddleImage,
        lastImage: uploadedLastImage,
        audio: uploadedAudio,
        spatialUpscale: params.spatialUpscale ?? false,
        temporalUpscale: params.temporalUpscale ?? false,
        ollamaEnabled: settings.ollamaEnabled ?? true,
        ollamaUrl: settings.ollamaUrl,
        ollamaModel: settings.ollamaModel,
        filmGrain: params.filmGrain ?? false,
        filmGrainIntensity: params.filmGrainIntensity,
        filmGrainSize: params.filmGrainSize,
      })

      // Debug: log key workflow params
      const genNode = workflow['6'] as { inputs: Record<string, unknown> } | undefined
      if (genNode) {
        logger.info(`Workflow node 6: width=${genNode.inputs['width']} height=${genNode.inputs['height']} upscale=${genNode.inputs['upscale']} upscale_model=${JSON.stringify(genNode.inputs['upscale_model'])} temporal_upscale_model=${JSON.stringify(genNode.inputs['temporal_upscale_model'])}`)
      }
      logger.info(`Workflow node IDs: ${Object.keys(workflow).join(', ')}`)

      // 6. Connect WebSocket for progress
      progressTracker.setBaseUrl(settings.comfyuiUrl)
      progressTracker.connect(clientId)

      // 7. Submit to ComfyUI
      logger.info('Submitting workflow to ComfyUI...')
      const result = await comfyClient.submitWorkflow(workflow, clientId)
      activePromptId = result.prompt_id
      logger.info(`Workflow submitted, promptId: ${result.prompt_id}`)

      // 8. Wait for completion
      await progressTracker.waitForCompletion(result.prompt_id)

      // 9. Get output from history
      const history = await comfyClient.getHistory(result.prompt_id)
      const fileInfo = comfyClient.getOutputFileInfo(
        history,
        result.prompt_id,
      )

      if (!fileInfo) {
        throw new Error('No video output found in ComfyUI history')
      }

      // 10. Download video from ComfyUI
      const outputDir = getOutputDir()
      const ext = path.extname(fileInfo.filename) || '.mp4'
      const outputFilename = `gen_${Date.now()}${ext}`
      const outputPath = path.join(outputDir, outputFilename)

      logger.info(`Downloading video from ComfyUI: ${fileInfo.filename}`)
      await comfyClient.downloadOutput(
        fileInfo.filename,
        fileInfo.subfolder,
        fileInfo.type,
        outputPath,
      )
      logger.info(`Video saved to: ${outputPath}`)

      return {
        status: 'complete',
        video_path: outputPath,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown generation error'
      if (message === 'Generation cancelled') {
        return { status: 'cancelled' }
      }
      logger.error(`ComfyUI generation failed: ${message}`)
      return { status: 'error', error: message }
    } finally {
      activePromptId = null
      progressTracker.disconnect()
      progressTracker.reset()
    }
  })

  ipcMain.handle('comfyui:progress', () => {
    const p = progressTracker.getProgress()
    return {
      status: p.status,
      phase: p.phase,
      progress: p.progress,
      currentStep: p.currentStep,
      totalSteps: p.totalSteps,
    }
  })

  ipcMain.handle('comfyui:cancel', async () => {
    if (activePromptId) {
      logger.info(`Cancelling ComfyUI generation: ${activePromptId}`)
      await comfyClient.cancel(activePromptId)
    }
  })

  ipcMain.handle('comfyui:health', async () => {
    const connected = await comfyClient.checkHealth()
    return { connected }
  })
}
