import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { comfyClient, type ComfyUIUploadResult } from '../comfyui/client'
import { progressTracker } from '../comfyui/progress'
import {
  buildWorkflow,
  getResolutionDimensions,
  calculateNumFrames,
} from '../comfyui/workflow-builder'
import { getComfyUISettings } from './settings-handlers'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { getGpuInfo } from '../gpu'
import { logger } from '../logger'
import { approvePath } from '../path-validation'

/**
 * Extract render metadata from a video/image file's embedded ComfyUI workflow.
 * Returns partial render fields extracted from the prompt JSON, or null if unavailable.
 */
function extractRenderFromMetadata(filePath: string): Record<string, unknown> | null {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) return null

  try {
    const result = spawnSync(ffmpegPath, ['-i', filePath, '-f', 'ffmetadata', '-'], {
      encoding: 'utf8',
      timeout: 10000,
    })

    const output = (result.stdout || '') + (result.stderr || '')
    // ffmetadata format: prompt={json...}
    const match = output.match(/^prompt=(.+)/m)
    if (!match) return null

    // Fix invalid JSON escapes (e.g. \p, \s from system prompts) before parsing
    const fixed = match[1].replace(/\\(?!["\\\/bfnrtu])/g, '\\\\')
    const workflow = JSON.parse(fixed) as Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>

    // Find the gen node (RSLTXVGenerate)
    let genInputs: Record<string, unknown> = {}
    for (const node of Object.values(workflow)) {
      if (node.class_type === 'RSLTXVGenerate') {
        genInputs = node.inputs
        break
      }
    }

    // Find the user prompt — look for RSPromptFormatter or RSRSOllamaImagePromptCreator
    // that feeds the positive CLIP (skip "Negative" titled ones)
    let prompt = ''
    for (const node of Object.values(workflow)) {
      const ct = node.class_type
      const title = node._meta?.title ?? ''
      if ((ct === 'RSPromptFormatter' || ct === 'RSRSOllamaImagePromptCreator') && !title.toLowerCase().includes('negative')) {
        const p = node.inputs.prompt
        if (typeof p === 'string' && p.length > 0) {
          prompt = p
          break
        }
      }
    }
    // Fallback: check CLIPTextEncode with "Positive" title for inline text
    if (!prompt) {
      for (const node of Object.values(workflow)) {
        if (node.class_type === 'CLIPTextEncode' && (node._meta?.title ?? '').includes('Positive')) {
          if (typeof node.inputs.text === 'string') {
            prompt = node.inputs.text
            break
          }
        }
      }
    }

    // Map resolution from width/height
    const width = genInputs.width as number || 0
    const height = genInputs.height as number || 0
    const maxDim = Math.max(width, height)
    const resolution = maxDim >= 2160 ? '4K' : maxDim >= 1080 ? '1080p' : maxDim >= 720 ? '720p' : '540p'

    // Compute aspect ratio from dimensions
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
    let aspectRatio = ''
    if (width && height) {
      const d = gcd(width, height)
      aspectRatio = `${width / d}:${height / d}`
    }

    // Frame rate: resolve from node reference or direct value
    let fps = 24
    const fr = genInputs.frame_rate
    if (typeof fr === 'number') fps = fr
    // If it's a node reference like ["24", 0], try to resolve from PrimitiveFloat
    if (Array.isArray(fr) && typeof fr[0] === 'string') {
      const fpsNode = workflow[fr[0]]
      if (fpsNode?.inputs?.value != null) fps = fpsNode.inputs.value as number
    }

    const numFrames = genInputs.num_frames as number || 0
    const duration = numFrames > 0 ? Math.round(numFrames / fps) : 0

    // Check for spatial upscale model reference
    const hasUpscale = !!genInputs.upscale

    return {
      prompt,
      seed: genInputs.noise_seed as number ?? 0,
      resolution,
      aspectRatio,
      duration,
      fps,
      spatialUpscale: hasUpscale,
      filmGrain: Object.values(workflow).some(n => n.class_type === 'RSFilmGrain'),
      firstStrength: genInputs.first_strength as number ?? 1,
      middleStrength: genInputs.middle_strength as number ?? 1,
      lastStrength: genInputs.last_strength as number ?? 1,
      cameraMotion: 'none',
      metadataRecovered: true,
    }
  } catch (err) {
    logger.warn(`extractRenderFromMetadata failed for ${filePath}: ${err}`)
    return null
  }
}

// Helpers for reading/writing .renders.json (supports both old flat array and new wrapped format)
function readRendersJson(rendersPath: string): Record<string, unknown>[] {
  if (!fs.existsSync(rendersPath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(rendersPath, 'utf-8'))
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.renders)) return parsed.renders
    return []
  } catch { return [] }
}

function writeRendersJson(rendersPath: string, renders: Record<string, unknown>[], diskTotalBytes?: number): void {
  const dir = path.dirname(rendersPath)
  fs.mkdirSync(dir, { recursive: true })
  if (diskTotalBytes !== undefined) {
    fs.writeFileSync(rendersPath, JSON.stringify({ _diskTotalBytes: diskTotalBytes, renders }, null, 2))
  } else {
    // Invalidate checksum so next full load triggers reconciliation
    fs.writeFileSync(rendersPath, JSON.stringify({ _diskTotalBytes: -1, renders }, null, 2))
  }
}

/** Read image dimensions from file header (PNG/JPEG/WebP) without loading full image */
function getImageDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(32)
    fs.readSync(fd, header, 0, 32, 0)
    fs.closeSync(fd)

    // PNG: bytes 16-23 contain width (4 bytes) and height (4 bytes) in IHDR
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
      return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
    }

    // JPEG: need to scan for SOF marker
    const buf = fs.readFileSync(filePath)
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xFF) break
        const marker = buf[offset + 1]
        // SOF0-SOF3 markers contain dimensions
        if (marker >= 0xC0 && marker <= 0xC3) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
        }
        offset += 2 + buf.readUInt16BE(offset + 2)
      }
    }

    // WebP: RIFF header, 'WEBP' at offset 8, VP8 at offset 12
    if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = header.toString('ascii', 12, 16)
      if (chunk === 'VP8 ') {
        // Lossy: dimensions at offset 26-29
        const extra = Buffer.alloc(4)
        const fd2 = fs.openSync(filePath, 'r')
        fs.readSync(fd2, extra, 0, 4, 26)
        fs.closeSync(fd2)
        return { width: extra.readUInt16LE(0) & 0x3FFF, height: extra.readUInt16LE(2) & 0x3FFF }
      }
    }

    return null
  } catch {
    return null
  }
}

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
  middleStrength?: number
  lastStrength?: number
  imageMode?: boolean
  imageSteps?: number
  imageGenerator?: string
  rtxSuperRes?: boolean
  preserveAspectRatio?: boolean
  projectName?: string
  referenceImagePaths?: string[]
  guideVideoPath?: string
  guideIndexList?: string
  guideStrength?: number
  stgScale?: number
  crf?: number
  negativePrompt?: string
  maskMode?: 'off' | 'subject' | 'face' | 'sam' | 'paint'
  maskPrompt?: string
  maskDilation?: number
  rediffusionMaskStrength?: number
  paintedMaskDataUrl?: string
  stackId?: string
  seed?: number  // Optional explicit seed — overrides app settings when provided
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

      // 2e. Upload reference images for Gemini
      const uploadedReferenceImages: ComfyUIUploadResult[] = []
      if (params.referenceImagePaths) {
        for (const refPath of params.referenceImagePaths) {
          if (refPath && fs.existsSync(refPath)) {
            logger.info(`Uploading reference image to ComfyUI: ${refPath}`)
            const uploaded = await comfyClient.uploadImage(refPath)
            uploadedReferenceImages.push(uploaded)
            logger.info(`Reference image uploaded: ${uploaded.name}`)
          }
        }
      }

      // 2f. Upload guide video if provided
      let uploadedGuideVideo = null
      if (params.guideVideoPath && fs.existsSync(params.guideVideoPath)) {
        logger.info(`Uploading guide video to ComfyUI: ${params.guideVideoPath}`)
        uploadedGuideVideo = await comfyClient.uploadImage(params.guideVideoPath)
        logger.info(`Guide video uploaded: ${uploadedGuideVideo.name}`)
      }

      // 2g. Upload painted mask if provided (data URL → temp file → upload)
      let uploadedPaintedMask = null
      if (params.paintedMaskDataUrl && params.maskMode === 'paint') {
        const base64Data = params.paintedMaskDataUrl.replace(/^data:image\/png;base64,/, '')
        const tmpPath = path.join(app.getPath('temp'), `painted-mask-${Date.now()}.png`)
        fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'))
        logger.info(`Uploading painted mask to ComfyUI: ${tmpPath}`)
        uploadedPaintedMask = await comfyClient.uploadImage(tmpPath)
        logger.info(`Painted mask uploaded: ${uploadedPaintedMask.name}`)
        fs.unlinkSync(tmpPath)
      }

      // 2h. Read source image dimensions for aspect-ratio-aware scaling
      const firstImagePath = params.imagePath || params.middleImagePath || params.lastImagePath
      const sourceImageDims = firstImagePath ? getImageDimensions(firstImagePath) : null
      if (sourceImageDims) {
        logger.info(`Source image dimensions: ${sourceImageDims.width}x${sourceImageDims.height}`)
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

      // 4. Determine seed — explicit param overrides app settings
      const seed = params.seed != null
        ? params.seed
        : settings.seedLocked
          ? settings.lockedSeed
          : Math.floor(Math.random() * 2147483647)

      // 5. Build workflow — fall back to 'none' if z-image models aren't available
      const imageGenerator = params.imageGenerator ?? settings.imageGenerator ?? 'none'
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
        stgScale: params.stgScale,
        crf: params.crf,
        negativePrompt: params.negativePrompt,
        maskMode: params.maskMode,
        maskPrompt: params.maskPrompt,
        maskDilation: params.maskDilation,
        rediffusionMaskStrength: params.rediffusionMaskStrength,
        paintedMask: uploadedPaintedMask,
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
        geminiProjectId: settings.geminiProjectId,
        geminiRegion: settings.geminiRegion,
        geminiImageSize: settings.geminiImageSize,
        referenceImages: uploadedReferenceImages.length > 0 ? uploadedReferenceImages : undefined,
        imageMode: params.imageMode,
        imageSteps: params.imageSteps,
        imageAspectRatio: params.aspectRatio,
        rtxSuperRes: params.imageMode ? false : (params.rtxSuperRes ?? false),
        tileT: settings.tileT,
        gpuSupportsRtx: getGpuInfo().supportsRtx,
        preserveAspectRatio: params.preserveAspectRatio ?? false,
        sourceImageDims: sourceImageDims ?? undefined,
        projectName: params.projectName,
        guideVideo: uploadedGuideVideo,
        guideIndexList: params.guideIndexList,
        guideStrength: params.guideStrength,
        loras: [...(settings.loras ?? []), ...(params.loras ?? [])].length > 0
          ? [...(settings.loras ?? []), ...(params.loras ?? [])]
          : undefined,
      })

      // Debug: dump full workflow to temp file for comparison
      const tmpWorkflowPath = path.join(app.getPath('temp'), 'ltx-debug-workflow.json')
      fs.writeFileSync(tmpWorkflowPath, JSON.stringify(workflow, null, 2))
      logger.info(`DEBUG: Full workflow dumped to ${tmpWorkflowPath}`)
      // Debug: log key workflow params
      const genNode = workflow['6'] as { inputs: Record<string, unknown> } | undefined
      if (genNode) {
        logger.info(`Workflow node 6 FULL: ${JSON.stringify(genNode.inputs)}`)
      }
      logger.info(`Workflow node IDs: ${Object.keys(workflow).join(', ')}`)

      // 6. Connect WebSocket for progress
      // Use the client's actual URL (may have been auto-discovered on a different port)
      progressTracker.setBaseUrl(comfyClient.getBaseUrl())
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
          const subDir = params.imageMode ? 'image' : 'video'
          const videoDir = path.join(outputDir, safePN, subDir)
          const rendersPath = path.join(videoDir, '.renders.json')
          const renders = readRendersJson(rendersPath)
          renders.push({
            promptId: result.prompt_id,
            filename: null,
            status: 'pending',
            stackId: params.stackId || null,
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
            rtxSuperRes: params.rtxSuperRes,
            imagePath: params.imagePath || null,
            middleImagePath: params.middleImagePath || null,
            lastImagePath: params.lastImagePath || null,
            audioPath: params.audioPath || null,
            firstStrength: params.firstStrength,
            middleStrength: params.middleStrength,
            lastStrength: params.lastStrength,
            preserveAspectRatio: params.preserveAspectRatio || false,
            // Image-specific fields
            ...(params.imageMode ? {
              imageGenerator: settings.imageGenerator || 'none',
              imageAspectRatio: params.aspectRatio,
              imageSteps: params.imageSteps,
              geminiImageSize: settings.geminiImageSize,
              referenceImagePaths: params.referenceImagePaths || [],
            } : {}),
            timestamp: new Date().toISOString(),
          })
          writeRendersJson(rendersPath, renders)
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
      const imgGen = params.imageGenerator ?? settings.imageGenerator ?? 'none'
      const didPromptEnhance = params.promptEnhance !== false && !(params.imageMode && imgGen === 'gemini')
      if (didPromptEnhance) {
        try {
          // Read from the project's .prompts folder (where the workflow writes them)
          const promptsCacheDir = params.projectName
            ? path.join(outputDir, params.projectName.replace(/[<>:"/\\|?*]/g, '_'), '.prompts')
            : outputDir
          const cachePath = path.join(promptsCacheDir, 'formatted_prompt_pos.json')
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
          const subDir = params.imageMode ? 'image' : 'video'
          const videoDir = path.join(outputDir, safeProjectName, subDir)
          const rendersPath = path.join(videoDir, '.renders.json')
          const renders = readRendersJson(rendersPath)
          const entry = renders.find(r => r.promptId === result.prompt_id)
          if (entry) {
            entry.filename = path.basename(finalOutputPath)
            entry.enhancedPrompt = enhancedPrompt ?? null
            entry.status = 'complete'
          }
          writeRendersJson(rendersPath, renders)
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
        seed,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown generation error'
      if (message === 'Generation cancelled') {
        return { status: 'cancelled' }
      }
      // If it looks like a connection error, try re-discovering the port
      if (message.includes('ECONNREFUSED') || message.includes('Invalid argument') || message.includes('fetch failed')) {
        logger.info('Generation failed with connection error — re-discovering ComfyUI port...')
        const reconnected = await comfyClient.checkHealth()
        if (reconnected) {
          logger.info(`ComfyUI re-discovered at ${comfyClient.getBaseUrl()} — please retry`)
          return { status: 'error', error: `ComfyUI port changed to ${comfyClient.getBaseUrl()} — please try again` }
        }
      }
      logger.error(`ComfyUI generation failed: ${message}`)
      return { status: 'error', error: message }
    } finally {
      // Mark pending render entries as error (don't delete — they may be recoverable)
      if (params.projectName) {
        try {
          const safePN = params.projectName.replace(/[<>:"/\\|?*]/g, '_')
          const videoDir = path.join(outputDir, safePN, 'video')
          const rendersPath = path.join(videoDir, '.renders.json')
          if (fs.existsSync(rendersPath)) {
            const renders = readRendersJson(rendersPath)
            let changed = false
            for (const r of renders) {
              if (r.status === 'pending') {
                r.status = 'error'
                changed = true
              }
            }
            if (changed) writeRendersJson(rendersPath, renders)
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

  // Scan renders directory for completed outputs matching a stackId
  ipcMain.handle('comfyui:find-stack-output', async (_event, params: { projectName: string; stackId: string }) => {
    try {
      const safePN = params.projectName.replace(/[<>:"/\\|?*]/g, '_')
      const videoDir = path.join(outputDir, safePN, 'video')
      const rendersPath = path.join(videoDir, '.renders.json')
      if (!fs.existsSync(rendersPath)) return null

      const renders = readRendersJson(rendersPath)
      // Find the most recent completed entry for this stack
      const match = renders
        .filter(r => r.stackId === params.stackId && r.status === 'complete' && r.filename)
        .pop()

      if (!match || typeof match.filename !== 'string') return null

      const filePath = path.join(videoDir, match.filename)
      if (!fs.existsSync(filePath)) return null

      return {
        video_path: filePath,
        enhanced_prompt: match.enhancedPrompt || null,
      }
    } catch (err) {
      logger.warn(`Failed to find stack output: ${err}`)
      return null
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
        loras: extractOptions('LoraLoaderModelOnly', 'lora_name').length > 0
          ? extractOptions('LoraLoaderModelOnly', 'lora_name')
          : extractOptions('RSLTXVGenerate', 'upscale_lora'),
        samplers: extractOptions('KSamplerSelect', 'sampler_name'),
        hasRtxSuperRes: ('RSRTXSuperResolution' in info) && getGpuInfo().supportsRtx,
        hasZImage: 'RSZImageGenerate' in info,
        hasGemini: 'Gemini3ProImage' in info,
        // Gemini node options (pulled from node definition)
        geminiModels: extractOptions('Gemini3ProImage', 'model'),
        geminiAspectRatios: extractOptions('Gemini3ProImage', 'aspect_ratio'),
        geminiImageSizes: extractOptions('Gemini3ProImage', 'image_size'),
      }
      logger.info(`comfyui:model-lists counts: checkpoints=${result.checkpoints.length}, textEncoders=${result.textEncoders.length}, upscaleModels=${result.upscaleModels.length}, loras=${result.loras.length}, samplers=${result.samplers.length}, rtxSuperRes=${result.hasRtxSuperRes}, zImage=${result.hasZImage}, gemini=${result.hasGemini}`)
      return result
    } catch (error) {
      logger.error(`Failed to fetch model lists: ${error}`)
      return { checkpoints: [], textEncoders: [], upscaleModels: [], loras: [] }
    }
  })

  ipcMain.handle('comfyui:get-project-renders', async (_event, projectName: string) => {
    try {
      const settings = getComfyUISettings()
      const outputDir = settings.comfyuiOutputDir || path.join(app.getPath('documents'), 'ComfyUI', 'output')
      const safeProjectName = projectName.replace(/[<>:"/\\|?*]/g, '_')
      const projectDir = path.join(outputDir, safeProjectName)
      const videoDir = path.join(projectDir, 'video')

      const VIDEO_EXTS = new Set(['.mp4', '.webm', '.avi', '.mov'])
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

      // Single scan: collect all media files and compute total bytes (async)
      let diskTotalBytes = 0
      const diskFiles = new Map<string, { filePath: string; type: string; size: number }>()
      for (const [subDir, exts, type] of [
        ['video', VIDEO_EXTS, 'video'],
        ['image', IMAGE_EXTS, 'image'],
      ] as const) {
        const dir = path.join(projectDir, subDir)
        try { await fs.promises.access(dir) } catch { continue }
        const files = await fs.promises.readdir(dir)
        for (const file of files) {
          if (exts.has(path.extname(file).toLowerCase())) {
            const filePath = path.join(dir, file)
            const stat = await fs.promises.stat(filePath)
            diskTotalBytes += stat.size
            diskFiles.set(file, { filePath, type, size: stat.size })
          }
        }
      }

      // Load existing .renders.json from both video and image dirs
      const videoRendersPath = path.join(videoDir, '.renders.json')
      const imageRendersPath = path.join(projectDir, 'image', '.renders.json')
      let renders = [
        ...readRendersJson(videoRendersPath),
        ...readRendersJson(imageRendersPath),
      ]
      let storedChecksum = -1
      if (fs.existsSync(videoRendersPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(videoRendersPath, 'utf-8'))
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            storedChecksum = parsed._diskTotalBytes ?? -1
          }
        } catch { /* ignore */ }
      }

      // Deduplicate by filename (can happen after restore writes entry back while it already existed)
      const seen = new Set<string>()
      renders = renders.filter(r => {
        const fn = r.filename as string
        if (seen.has(fn)) return false
        seen.add(fn)
        return true
      })

      // Fast path: if total bytes match, disk hasn't changed — skip reconciliation
      if (storedChecksum === diskTotalBytes && renders.length > 0) {
        return renders.map(r => {
          const subDir = r.type === 'image' ? 'image' : 'video'
          const filePath = path.join(projectDir, subDir, r.filename as string)
          return { ...r, filePath }
        })
      }

      // Full reconciliation: remove entries with no files, add files not in JSON
      const trackedFilenames = new Set<string>()
      renders = renders.filter(r => {
        const filename = r.filename as string
        if (!diskFiles.has(filename)) return false
        if (trackedFilenames.has(filename)) return false
        trackedFilenames.add(filename)
        return true
      })

      for (const [filename, info] of diskFiles) {
        if (trackedFilenames.has(filename)) continue
        const stat = await fs.promises.stat(info.filePath)
        // Try to recover metadata from the file's embedded workflow
        const recovered = extractRenderFromMetadata(info.filePath)
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
          timestamp: stat.birthtime.toISOString(),
          ...(recovered ?? { noMetadata: true }),
        })
      }

      // Backfill existing entries that are missing data (seed=0, no prompt)
      // but skip entries already marked as noMetadata (no embedded workflow)
      for (const render of renders) {
        if (render.noMetadata || render.metadataRecovered) continue
        const isMissing = !render.prompt && (render.seed === 0 || render.seed === undefined)
        if (!isMissing) continue
        const filename = render.filename as string
        const info = diskFiles.get(filename)
        if (!info) continue
        const recovered = extractRenderFromMetadata(info.filePath)
        if (recovered) {
          Object.assign(render, recovered)
        } else {
          render.noMetadata = true
        }
      }

      // Final dedup pass before writing
      const finalSeen = new Set<string>()
      renders = renders.filter(r => {
        const fn = r.filename as string
        if (finalSeen.has(fn)) return false
        finalSeen.add(fn)
        return true
      })

      // Write reconciled JSON back to separate files by type
      const videoRenders = renders.filter(r => r.type !== 'image')
      const imageRenders = renders.filter(r => r.type === 'image')
      writeRendersJson(videoRendersPath, videoRenders, diskTotalBytes)
      writeRendersJson(imageRendersPath, imageRenders, diskTotalBytes)

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

  ipcMain.handle('comfyui:extract-audio-segment', async (_event, params: { sourcePath: string; startTime: number; duration: number }) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error('ffmpeg not found — cannot extract audio segment')
    }

    const { sourcePath, startTime, duration } = params
    const tempDir = path.join(app.getPath('temp'), 'ltx-audio-segments')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const outPath = path.join(tempDir, `audio-segment-${randomUUID()}.wav`)

    const result = spawnSync(ffmpegPath, [
      '-y',
      '-ss', String(startTime),
      '-t', String(duration),
      '-i', sourcePath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      outPath,
    ], { encoding: 'utf8', timeout: 30000 })

    if (result.status !== 0) {
      throw new Error(`ffmpeg audio extraction failed: ${result.stderr}`)
    }

    logger.info(`Extracted audio segment: ${outPath} (start=${startTime}s, dur=${duration}s)`)
    return outPath
  })

  ipcMain.handle('comfyui:render-guide-video', async (_event, params: {
    images: { path: string; startFrame: number; endFrame: number }[]
    fps: number
    totalFrames: number
    resolution: string
    aspectRatio: string
  }) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error('ffmpeg not found — cannot render guide video')
    }

    // Use source image native resolution — ComfyUI handles final resize (matching frame image pipeline)
    const firstDims = params.images.length > 0 ? getImageDimensions(params.images[0].path) : null
    const width = firstDims?.width ?? 1920
    const height = firstDims?.height ?? 1080

    const tempDir = path.join(app.getPath('temp'), 'ltx-guide-videos')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    // Write concat demuxer file
    const concatListPath = path.join(tempDir, `concat-${randomUUID()}.txt`)
    let concatContent = ''
    for (const img of params.images) {
      const dur = (img.endFrame - img.startFrame) / params.fps
      const escapedPath = img.path.replace(/'/g, "'\\''")
      concatContent += `file '${escapedPath}'\nduration ${dur}\n`
    }
    // ffmpeg concat demuxer needs the last file repeated without duration
    if (params.images.length > 0) {
      const lastPath = params.images[params.images.length - 1].path.replace(/'/g, "'\\''")
      concatContent += `file '${lastPath}'\n`
    }
    fs.writeFileSync(concatListPath, concatContent)

    const outPath = path.join(tempDir, `guide-video-${randomUUID()}.mp4`)

    // Scale to first image's native dimensions with center crop (matches frame image processing)
    const result = spawnSync(ffmpegPath, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-c:v', 'libx264',
      '-qp', '0',
      '-pix_fmt', 'yuv420p',
      '-r', String(params.fps),
      outPath,
    ], { encoding: 'utf8', timeout: 60000 })

    // Clean up concat list
    try { fs.unlinkSync(concatListPath) } catch { /* ignore */ }

    if (result.status !== 0) {
      throw new Error(`ffmpeg guide video render failed: ${result.stderr}`)
    }

    logger.info(`Rendered guide video: ${outPath} (${params.images.length} images, ${width}x${height}, ${params.totalFrames} frames)`)
    return outPath
  })

  ipcMain.handle('comfyui:pad-audio-to-length', async (_event, params: { sourcePath: string; targetDuration: number }) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error('ffmpeg not found — cannot pad audio')
    }

    const { sourcePath, targetDuration } = params
    const tempDir = path.join(app.getPath('temp'), 'ltx-audio-segments')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const outPath = path.join(tempDir, `audio-padded-${randomUUID()}.wav`)

    // Use apad filter to extend audio with silence to target duration
    const result = spawnSync(ffmpegPath, [
      '-y',
      '-i', sourcePath,
      '-af', `apad=whole_dur=${targetDuration}`,
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      '-t', String(targetDuration),
      outPath,
    ], { encoding: 'utf8', timeout: 30000 })

    if (result.status !== 0) {
      throw new Error(`ffmpeg audio padding failed: ${result.stderr}`)
    }

    logger.info(`Padded audio to ${targetDuration}s: ${outPath}`)
    return outPath
  })

  ipcMain.handle('comfyui:mix-audio-files', async (_event, params: {
    files: Array<{ path: string; offsetSeconds: number; duration: number }>;
    totalDuration: number;
  }) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error('ffmpeg not found — cannot mix audio files')
    }

    const { files, totalDuration } = params
    if (files.length === 0) throw new Error('No audio files to mix')

    const tempDir = path.join(app.getPath('temp'), 'ltx-audio-segments')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const outPath = path.join(tempDir, `audio-mixed-${randomUUID()}.wav`)

    // Build ffmpeg filter_complex: delay each input, then amix them all
    const inputs: string[] = []
    const filterParts: string[] = []
    const mixInputs: string[] = []

    for (let i = 0; i < files.length; i++) {
      inputs.push('-i', files[i].path)
      const delayMs = Math.round(files[i].offsetSeconds * 1000)
      // adelay delays both channels; pad=1 pads shorter inputs with silence
      filterParts.push(`[${i}]adelay=${delayMs}|${delayMs},apad[a${i}]`)
      mixInputs.push(`[a${i}]`)
    }

    const filterComplex = filterParts.join(';') +
      `;${mixInputs.join('')}amix=inputs=${files.length}:duration=longest:normalize=0`

    const args = [
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-t', String(totalDuration),
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      outPath,
    ]

    const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', timeout: 30000 })

    if (result.status !== 0) {
      throw new Error(`ffmpeg audio mix failed: ${result.stderr}`)
    }

    logger.info(`Mixed ${files.length} audio files to ${totalDuration}s: ${outPath}`)
    return outPath
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

  // ── Transcribe audio using WhisperX via ComfyUI ──
  ipcMain.handle('transcribe-audio', async (_event, audioPath: string, startTime?: number, duration?: number) => {
    logger.info(`Transcribing audio via ComfyUI: ${audioPath} (start=${startTime || 0}, dur=${duration || 0})`)

    // 1. Upload audio to ComfyUI
    const uploadResult = await comfyClient.uploadAudio(audioPath)
    logger.info(`Uploaded audio: ${uploadResult.name}`)

    // 2. Build WhisperX workflow
    const workflow: Record<string, unknown> = {
      '2': {
        inputs: {
          audio: uploadResult.name,
          start_time: startTime || 0,
          duration: duration || 0,
        },
        class_type: 'VHS_LoadAudioUpload',
        _meta: { title: 'Load Audio' },
      },
      '3': {
        inputs: {
          model: 'tiny',
          if_translate: false,
          translator: 'alibaba',
          to_language: 'en',
          audio: ['2', 0],
        },
        class_type: 'Apply WhisperX',
        _meta: { title: 'Apply WhisperX' },
      },
      '5': {
        inputs: {
          preview_markdown: '',
          preview_text: '',
          previewMode: false,
          source: ['3', 0],
        },
        class_type: 'PreviewAny',
        _meta: { title: 'Preview as Text' },
      },
    }

    // 3. Submit workflow
    const clientId = randomUUID()
    const promptResult = await comfyClient.submitWorkflow(workflow, clientId)
    const promptId = promptResult.prompt_id
    logger.info(`WhisperX workflow submitted: ${promptId}`)

    // 4. Poll for completion (timeout 5 min)
    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
      const history = await comfyClient.getHistory(promptId)
      const entry = history[promptId]
      if (!entry) continue
      if (!entry.status.completed) continue

      // 5. Extract text from PreviewText node (4) or WhisperX node (3)
      const outputs = entry.outputs as Record<string, Record<string, unknown>>
      for (const nodeId of ['5', '3']) {
        const nodeOutput = outputs[nodeId]
        if (!nodeOutput) continue
        // Check all keys for string arrays (different nodes use different key names)
        for (const [key, val] of Object.entries(nodeOutput)) {
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
            const text = val.join(' ').trim()
            if (text) {
              logger.info(`Transcription from node ${nodeId}.${key}: ${text.substring(0, 100)}...`)
              return { text, error: null }
            }
          }
        }
        logger.warn(`Node ${nodeId} output keys: ${Object.keys(nodeOutput).join(', ')}`)
      }

      logger.warn(`Full outputs: ${JSON.stringify(outputs).substring(0, 1000)}`)
      return { text: null, error: 'Could not extract text from WhisperX output' }
    }

    return { text: null, error: 'Transcription timed out' }
  })
}
