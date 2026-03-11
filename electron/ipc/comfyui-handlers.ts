import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { comfyClient } from '../comfyui/client'
import { progressTracker } from '../comfyui/progress'
import {
  buildWorkflow,
  getResolutionDimensions,
  calculateNumFrames,
} from '../comfyui/workflow-builder'
import { getComfyUISettings } from './settings-handlers'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { logger } from '../logger'
import { approvePath } from '../path-validation'

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
  upscaleDenoise?: number
  temporalUpscale?: boolean
  filmGrain?: boolean
  filmGrainIntensity?: number
  filmGrainSize?: number
  firstStrength?: number
  lastStrength?: number
  imageMode?: boolean
  imageSteps?: number
  rtxSuperRes?: boolean
}

let activePromptId: string | null = null

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
      const numFrames = params.imageMode ? 9 : calculateNumFrames(params.duration, params.fps)

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
      const useZImage = (settings.imageGenerator === 'z-image')
      const workflow = buildWorkflow({
        prompt: promptText,
        width,
        height,
        numFrames,
        frameRate: params.fps,
        seed,
        steps: (params.imageMode && params.imageSteps) ? params.imageSteps : settings.steps,
        cfg: settings.cfg,
        firstImage: uploadedImage,
        middleImage: uploadedMiddleImage,
        lastImage: uploadedLastImage,
        audio: uploadedAudio,
        spatialUpscale: params.imageMode ? false : (params.spatialUpscale ?? false),
        upscaleDenoise: params.imageMode ? undefined : params.upscaleDenoise,
        temporalUpscale: params.imageMode ? false : (params.temporalUpscale ?? false),
        ollamaEnabled: settings.ollamaEnabled ?? false,
        ollamaUrl: settings.ollamaUrl,
        ollamaModel: settings.ollamaModel,
        filmGrain: params.filmGrain ?? false,
        filmGrainIntensity: params.filmGrainIntensity,
        filmGrainSize: params.filmGrainSize,
        firstStrength: params.firstStrength,
        lastStrength: params.lastStrength,
        checkpoint: settings.checkpoint,
        textEncoder: settings.textEncoder,
        vaeCheckpoint: settings.vaeCheckpoint,
        spatialUpscaleModel: settings.spatialUpscaleModel,
        temporalUpscaleModel: settings.temporalUpscaleModel,
        upscaleLora: settings.upscaleLora,
        sampler: params.imageMode ? 'res_2s' : settings.sampler,
        promptFormatterTextEncoder: settings.promptFormatterTextEncoder,
        imageGenerator: settings.imageGenerator ?? 'none',
        imageMode: params.imageMode,
        imageSteps: params.imageSteps,
        imageAspectRatio: params.aspectRatio,
        rtxSuperRes: params.imageMode ? false : (params.rtxSuperRes ?? false),
      })

      // Debug: log key workflow params
      const genNode = workflow['6'] as { inputs: Record<string, unknown> } | undefined
      if (genNode) {
        logger.info(`Workflow node 6: width=${genNode.inputs['width']} height=${genNode.inputs['height']} upscale=${genNode.inputs['upscale']} upscale_model=${JSON.stringify(genNode.inputs['upscale_model'])} temporal_upscale_model=${JSON.stringify(genNode.inputs['temporal_upscale_model'])}`)
      }
      logger.info(`Workflow node IDs: ${Object.keys(workflow).join(', ')}`)

      // 6. Connect WebSocket for progress
      progressTracker.setBaseUrl(settings.comfyuiUrl)
      const ollamaEnabled = settings.ollamaEnabled ?? false
      const hasAnyGuidanceFrame = !!(uploadedImage || uploadedMiddleImage || uploadedLastImage)
      const imagePromptCreatorIds = hasAnyGuidanceFrame ? (ollamaEnabled ? ['84'] : ['83']) : []
      const ltxvFormatterIds = ollamaEnabled ? ['17', '18', ...imagePromptCreatorIds] : ['36', '37', ...imagePromptCreatorIds]
      const zImageFormatterIds = ['54', '56']
      const formatterNodeIds = useZImage && params.imageMode
        ? zImageFormatterIds
        : useZImage
          ? [...ltxvFormatterIds, ...zImageFormatterIds]
          : ltxvFormatterIds
      progressTracker.setGenerationContext({
        hasFirstImage: !!uploadedImage || (useZImage && !params.imageMode),
        hasUpscale: !!(params.spatialUpscale),
        imageMode: !!params.imageMode,
        formatterNodeIds,
        hasZImage: useZImage && !params.imageMode && !uploadedImage,
      })
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

      // 10. Resolve output file path on disk
      const outputDir = settings.comfyuiOutputDir || path.join(app.getPath('documents'), 'ComfyUI', 'output')
      const subfolder = fileInfo.subfolder || ''
      const outputPath = path.join(outputDir, subfolder, fileInfo.filename)

      if (!fs.existsSync(outputPath)) {
        throw new Error(`ComfyUI output file not found: ${outputPath}`)
      }
      // Approve the output directory so the frontend can read generated files
      approvePath(path.join(outputDir, subfolder))
      logger.info(`ComfyUI output at: ${outputPath}`)

      // 11. Embed generation settings as metadata (remux in-place, video only)
      const outputExt = path.extname(outputPath).toLowerCase()
      const isImageOutput = ['.png', '.jpg', '.jpeg', '.webp'].includes(outputExt)
      const ffmpegPath = findFfmpegPath()
      if (ffmpegPath && !isImageOutput) {
        const metadata = JSON.stringify({
          prompt: params.prompt,
          resolution: params.resolution,
          aspectRatio: params.aspectRatio,
          duration: params.duration,
          fps: params.fps,
          cameraMotion: params.cameraMotion,
          spatialUpscale: params.spatialUpscale,
          temporalUpscale: params.temporalUpscale,
          filmGrain: params.filmGrain,
          filmGrainIntensity: params.filmGrainIntensity,
          filmGrainSize: params.filmGrainSize,
          firstStrength: params.firstStrength,
          lastStrength: params.lastStrength,
        })
        const ext = path.extname(fileInfo.filename) || '.mp4'
        const tempPath = outputPath + '.tmp' + ext
        const muxResult = spawnSync(ffmpegPath, [
          '-y', '-i', outputPath, '-c', 'copy',
          '-metadata', `comment=${metadata}`,
          tempPath,
        ], { timeout: 30000 })
        if (muxResult.status === 0) {
          fs.unlinkSync(outputPath)
          fs.renameSync(tempPath, outputPath)
          logger.info('Generation metadata embedded in video')
        } else {
          // Clean up temp file, keep original
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
          logger.warn('Failed to embed metadata, keeping original video')
        }
      }

      // 12. Image mode: extract first frame as PNG (or return directly for Z-Image)
      if (params.imageMode) {
        const ext = path.extname(outputPath).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          // Z-Image output: already an image, return directly
          logger.info(`Z-Image output at: ${outputPath}`)
          return {
            status: 'complete',
            image_path: outputPath,
          }
        }
        const ffmpeg = findFfmpegPath()
        if (!ffmpeg) {
          throw new Error('ffmpeg not found — cannot extract frame')
        }
        const imagePath = outputPath.replace(/\.[^.]+$/, '.png')
        const extractResult = spawnSync(ffmpeg, [
          '-y', '-i', outputPath, '-frames:v', '1', '-q:v', '2', imagePath,
        ], { timeout: 30000 })
        if (extractResult.status !== 0) {
          throw new Error('Failed to extract frame from generated video')
        }
        logger.info(`Image extracted to: ${imagePath}`)
        return {
          status: 'complete',
          image_path: imagePath,
        }
      }

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

  ipcMain.handle('comfyui:model-lists', async () => {
    try {
      const info = await comfyClient.getObjectInfo()

      // Extract COMBO options from a field definition.
      // ComfyUI has two formats:
      //   Old (built-in nodes): [["option1", "option2"], ...]
      //   New (custom nodes):   ["COMBO", {"options": ["option1", "option2"]}]
      const parseComboField = (field: unknown[]): string[] => {
        if (Array.isArray(field[0])) {
          return field[0] as string[]
        }
        if (field[0] === 'COMBO' && field[1] && typeof field[1] === 'object') {
          const opts = (field[1] as Record<string, unknown>)['options']
          if (Array.isArray(opts)) return opts as string[]
        }
        return []
      }

      const extractOptions = (nodeType: string, inputName: string): string[] => {
        const node = info[nodeType] as Record<string, unknown> | undefined
        if (!node) return []
        const input = node['input'] as Record<string, unknown> | undefined
        if (!input) return []
        const required = input['required'] as Record<string, unknown[]> | undefined
        const optional = input['optional'] as Record<string, unknown[]> | undefined
        const field = required?.[inputName] ?? optional?.[inputName]
        if (Array.isArray(field)) {
          return parseComboField(field)
        }
        return []
      }

      const result = {
        checkpoints: extractOptions('CheckpointLoaderSimple', 'ckpt_name'),
        textEncoders: extractOptions('LTXAVTextEncoderLoader', 'text_encoder'),
        upscaleModels: extractOptions('LatentUpscaleModelLoader', 'model_name'),
        loras: extractOptions('RSLTXVGenerate', 'upscale_lora'),
        samplers: extractOptions('KSamplerSelect', 'sampler_name'),
        hasRtxSuperRes: 'RTXVideoSuperResolution' in info,
      }
      logger.info(`comfyui:model-lists counts: checkpoints=${result.checkpoints.length}, textEncoders=${result.textEncoders.length}, upscaleModels=${result.upscaleModels.length}, loras=${result.loras.length}, samplers=${result.samplers.length}, rtxSuperRes=${result.hasRtxSuperRes}`)
      return result
    } catch (error) {
      logger.error(`Failed to fetch model lists: ${error}`)
      return { checkpoints: [], textEncoders: [], upscaleModels: [], loras: [] }
    }
  })

  ipcMain.handle('comfyui:read-video-metadata', (_event, filePath: string) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      logger.warn('readVideoMetadata: ffmpeg not found')
      return null
    }

    try {
      // ffmpeg -i prints file info (including metadata) to stderr
      const result = spawnSync(ffmpegPath, ['-i', filePath, '-hide_banner'], {
        encoding: 'utf8',
        timeout: 10000,
      })

      const output = (result.stderr || '') + (result.stdout || '')
      logger.info(`readVideoMetadata output:\n${output}`)

      // ffmpeg formats metadata as "    comment         : {json...}"
      const match = output.match(/comment\s*:\s*(.+)/)
      if (!match) {
        logger.warn('readVideoMetadata: no comment field found')
        return null
      }

      logger.info(`readVideoMetadata comment raw: ${match[1]}`)
      return JSON.parse(match[1].trim()) as Record<string, unknown>
    } catch (err) {
      logger.error(`readVideoMetadata parse error: ${err}`)
      return null
    }
  })
}
