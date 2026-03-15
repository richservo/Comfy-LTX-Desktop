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
  promptEnhance?: boolean
  filmGrain?: boolean
  filmGrainIntensity?: number
  filmGrainSize?: number
  firstStrength?: number
  lastStrength?: number
  imageMode?: boolean
  imageSteps?: number
  rtxSuperRes?: boolean
  projectName?: string
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

      // 5. Build workflow — fall back to 'none' if z-image models aren't available
      const imageGenerator = settings.imageGenerator ?? 'none'
      const useZImage = imageGenerator === 'z-image'
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
        promptEnhance: params.promptEnhance !== false,
        promptEnhanceSystemPrompt: settings.promptEnhanceSystemPrompt,
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
        imageGenerator,
        imageMode: params.imageMode,
        imageSteps: params.imageSteps,
        imageAspectRatio: params.aspectRatio,
        rtxSuperRes: params.imageMode ? false : (params.rtxSuperRes ?? false),
        projectName: params.projectName,
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
      const usePromptEnhance = params.promptEnhance !== false
      const promptEnhancerId = ollamaEnabled ? '84' : '83'
      const negativeFormatterId = ollamaEnabled ? '18' : '37'
      const ltxvFormatterIds = usePromptEnhance
        ? [promptEnhancerId, negativeFormatterId]
        : []
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

      // Resolve output directory early (needed for render tracking and file resolution)
      const outputDir = settings.comfyuiOutputDir || path.join(app.getPath('documents'), 'ComfyUI', 'output')

      // 7. Submit to ComfyUI
      logger.info('Submitting workflow to ComfyUI...')
      const result = await comfyClient.submitWorkflow(workflow, clientId)
      activePromptId = result.prompt_id
      logger.info(`Workflow submitted, promptId: ${result.prompt_id}`)

      // Write pending render entry immediately so it survives crashes
      if (params.projectName) {
        try {
          const safePN = params.projectName.replace(/[<>:"/\\|?*]/g, '_')
          const videoDir = path.join(outputDir, safePN, 'video')
          const rendersPath = path.join(videoDir, '.renders.json')
          const renders: unknown[] = fs.existsSync(rendersPath)
            ? JSON.parse(fs.readFileSync(rendersPath, 'utf-8'))
            : []
          renders.push({
            promptId: result.prompt_id,
            filename: null,
            status: 'pending',
            type: params.imageMode ? 'image' : 'video',
            prompt: params.prompt,
            enhancedPrompt: null,
            seed,
            resolution: params.resolution,
            aspectRatio: params.aspectRatio,
            duration: params.duration,
            fps: params.fps,
            cameraMotion: params.cameraMotion,
            spatialUpscale: params.spatialUpscale,
            temporalUpscale: params.temporalUpscale,
            filmGrain: params.filmGrain,
            promptEnhance: params.promptEnhance,
            timestamp: new Date().toISOString(),
          })
          fs.mkdirSync(videoDir, { recursive: true })
          fs.writeFileSync(rendersPath, JSON.stringify(renders, null, 2))
        } catch (err) {
          logger.warn(`Failed to write pending render entry: ${err}`)
        }
      }

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
      const subfolder = fileInfo.subfolder || ''
      const outputPath = path.join(outputDir, subfolder, fileInfo.filename)

      if (!fs.existsSync(outputPath)) {
        throw new Error(`ComfyUI output file not found: ${outputPath}`)
      }
      // Approve the output directory so the frontend can read generated files
      approvePath(path.join(outputDir, subfolder))
      logger.info(`ComfyUI output at: ${outputPath}`)

      // Read enhanced prompt from formatter cache file if prompt enhance was used
      let enhancedPrompt: string | undefined
      if (params.promptEnhance !== false) {
        try {
          const cachePath = path.join(outputDir, 'formatted_prompt_pos.json')
          if (fs.existsSync(cachePath)) {
            const cacheContent = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
            if (typeof cacheContent === 'string') {
              enhancedPrompt = cacheContent
            } else if (cacheContent?.output) {
              enhancedPrompt = cacheContent.output
            }
          }
        } catch {
          // Ignore cache read errors
        }
      }

      // 11. Image mode: extract first frame as PNG (or return directly for Z-Image)
      let finalOutputPath = outputPath
      if (params.imageMode) {
        const ext = path.extname(outputPath).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          logger.info(`Z-Image output at: ${outputPath}`)
        } else {
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
          finalOutputPath = imagePath
        }
      }

      // Update pending render entry with filename and enhanced prompt
      if (params.projectName) {
        try {
          const safeProjectName = params.projectName.replace(/[<>:"/\\|?*]/g, '_')
          const videoDir = path.join(outputDir, safeProjectName, 'video')
          const rendersPath = path.join(videoDir, '.renders.json')
          if (fs.existsSync(rendersPath)) {
            const renders = JSON.parse(fs.readFileSync(rendersPath, 'utf-8')) as Record<string, unknown>[]
            const entry = renders.find(r => r.promptId === result.prompt_id)
            if (entry) {
              entry.filename = path.basename(finalOutputPath)
              entry.enhancedPrompt = enhancedPrompt ?? null
              entry.status = 'complete'
            }
            fs.writeFileSync(rendersPath, JSON.stringify(renders, null, 2))
          }
        } catch (err) {
          logger.warn(`Failed to update render entry: ${err}`)
        }
      }

      return {
        status: 'complete',
        ...(params.imageMode
          ? { image_path: finalOutputPath }
          : { video_path: finalOutputPath }),
        enhanced_prompt: enhancedPrompt,
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
      // Remove pending render entries that never completed (no filename)
      if (params.projectName) {
        try {
          const safePN = params.projectName.replace(/[<>:"/\\|?*]/g, '_')
          const videoDir = path.join(outputDir, safePN, 'video')
          const rendersPath = path.join(videoDir, '.renders.json')
          if (fs.existsSync(rendersPath)) {
            const renders = JSON.parse(fs.readFileSync(rendersPath, 'utf-8')) as Record<string, unknown>[]
            const cleaned = renders.filter(r => r.status !== 'pending')
            fs.writeFileSync(rendersPath, JSON.stringify(cleaned, null, 2))
          }
        } catch {
          // Ignore cleanup errors
        }
      }
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
        hasZImage: 'RSZImageGenerate' in info,
      }
      logger.info(`comfyui:model-lists counts: checkpoints=${result.checkpoints.length}, textEncoders=${result.textEncoders.length}, upscaleModels=${result.upscaleModels.length}, loras=${result.loras.length}, samplers=${result.samplers.length}, rtxSuperRes=${result.hasRtxSuperRes}, zImage=${result.hasZImage}`)
      return result
    } catch (error) {
      logger.error(`Failed to fetch model lists: ${error}`)
      return { checkpoints: [], textEncoders: [], upscaleModels: [], loras: [] }
    }
  })

  ipcMain.handle('comfyui:get-project-renders', (_event, projectName: string) => {
    try {
      const settings = getComfyUISettings()
      const outputDir = settings.comfyuiOutputDir || path.join(app.getPath('documents'), 'ComfyUI', 'output')
      const safeProjectName = projectName.replace(/[<>:"/\\|?*]/g, '_')
      const projectDir = path.join(outputDir, safeProjectName)
      const videoDir = path.join(projectDir, 'video')
      const rendersPath = path.join(videoDir, '.renders.json')

      // Load existing .renders.json (may not exist yet)
      let renders: Record<string, unknown>[] = []
      if (fs.existsSync(rendersPath)) {
        const parsed = JSON.parse(fs.readFileSync(rendersPath, 'utf-8'))
        if (Array.isArray(parsed)) renders = parsed
      }

      // Scan video/ and image/ subdirectories for actual files on disk
      const VIDEO_EXTS = new Set(['.mp4', '.webm', '.avi', '.mov'])
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
      const diskFiles = new Map<string, { filePath: string; type: string }>()

      for (const [subDir, exts, type] of [
        ['video', VIDEO_EXTS, 'video'],
        ['image', IMAGE_EXTS, 'image'],
      ] as const) {
        const dir = path.join(projectDir, subDir)
        if (!fs.existsSync(dir)) continue
        for (const file of fs.readdirSync(dir)) {
          const ext = path.extname(file).toLowerCase()
          if (exts.has(ext)) {
            diskFiles.set(file, { filePath: path.join(dir, file), type })
          }
        }
      }

      // Remove JSON entries whose files no longer exist
      const trackedFilenames = new Set<string>()
      renders = renders.filter(r => {
        const filename = r.filename as string
        if (diskFiles.has(filename)) {
          trackedFilenames.add(filename)
          return true
        }
        return false
      })

      // Add entries for files on disk that aren't in the JSON
      for (const [filename, info] of diskFiles) {
        if (trackedFilenames.has(filename)) continue
        const stat = fs.statSync(info.filePath)
        renders.push({
          filename,
          type: info.type,
          prompt: '',
          enhancedPrompt: null,
          seed: 0,
          resolution: '',
          aspectRatio: '',
          duration: 0,
          fps: 0,
          timestamp: stat.mtime.toISOString(),
        })
      }

      // Write reconciled JSON back
      fs.mkdirSync(videoDir, { recursive: true })
      fs.writeFileSync(rendersPath, JSON.stringify(renders, null, 2))

      // Return with full file paths
      return renders.map(r => {
        const subDir = r.type === 'image' ? 'image' : 'video'
        const filePath = path.join(projectDir, subDir, r.filename as string)
        return { ...r, filePath }
      })
    } catch (err) {
      logger.warn(`Failed to read project renders: ${err}`)
      return []
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
