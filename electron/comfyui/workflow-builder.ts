import workflowTemplate from './workflow-template.json'
import type { ComfyUIUploadResult } from './client'

export interface WorkflowParams {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  numFrames: number
  frameRate: number
  seed: number
  steps: number
  cfg: number
  /** Uploaded first frame image (I2V) */
  firstImage?: ComfyUIUploadResult | null
  /** Uploaded audio file */
  audio?: ComfyUIUploadResult | null
  /** Uploaded middle frame image */
  middleImage?: ComfyUIUploadResult | null
  /** Uploaded last frame image */
  lastImage?: ComfyUIUploadResult | null
  /** Enable spatial upscale (2x resolution) */
  spatialUpscale?: boolean
  /** Upscale denoise strength (0–1, default 0.5) */
  upscaleDenoise?: number
  /** Enable temporal upscale (2x frame count) */
  temporalUpscale?: boolean
  /** Enable prompt enhancer (expand prompt with detail) */
  promptEnhance?: boolean
  /** Enable Ollama prompt formatter */
  ollamaEnabled?: boolean
  /** Ollama server URL */
  ollamaUrl?: string
  /** Ollama model name */
  ollamaModel?: string
  /** Enable film grain post-processing */
  filmGrain?: boolean
  /** Film grain intensity (0.01–0.5, default 0.05) */
  filmGrainIntensity?: number
  /** Film grain size (0.5–3.0, default 1.2) */
  filmGrainSize?: number
  /** First frame strength (0–1, default 1) */
  firstStrength?: number
  /** Middle frame strength (0–1, default 1) */
  middleStrength?: number
  /** Last frame strength (0–1, default 1) */
  lastStrength?: number
  /** Checkpoint model filename */
  checkpoint?: string
  /** Text encoder model filename */
  textEncoder?: string
  /** Spatial upscale model filename */
  spatialUpscaleModel?: string
  /** Temporal upscale model filename */
  temporalUpscaleModel?: string
  /** Audio VAE checkpoint filename (usually same as checkpoint) */
  vaeCheckpoint?: string
  /** Upscale LoRA filename */
  upscaleLora?: string
  /** Sampler name (e.g. euler_ancestral) */
  sampler?: string
  /** Text encoder for the local prompt formatter */
  promptFormatterTextEncoder?: string
  /** Image generator to use ('none' or 'z-image') */
  imageGenerator?: string
  /** Whether this is image-only generation (not video) */
  imageMode?: boolean
  /** Image generation steps (for Z-Image standalone) */
  imageSteps?: number
  /** Image aspect ratio (for Z-Image standalone) */
  imageAspectRatio?: string
  /** Enable RTX Video Super Resolution (4K output) */
  rtxSuperRes?: boolean
}

type WorkflowNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }
type Workflow = Record<string, WorkflowNode>

// Resolution presets: resolution label + aspect ratio → pixel dimensions
const RESOLUTION_MAP: Record<string, Record<string, { width: number; height: number }>> = {
  '540p': {
    '16:9': { width: 960, height: 544 },
    '9:16': { width: 544, height: 960 },
    '1:1': { width: 544, height: 544 },
    '4:3': { width: 736, height: 544 },
    '3:4': { width: 544, height: 736 },
  },
  '720p': {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 720, height: 720 },
    '4:3': { width: 960, height: 720 },
    '3:4': { width: 720, height: 960 },
  },
  '1080p': {
    '16:9': { width: 1920, height: 1088 },
    '9:16': { width: 1088, height: 1920 },
    '1:1': { width: 1088, height: 1088 },
    '4:3': { width: 1440, height: 1088 },
    '3:4': { width: 1088, height: 1440 },
  },
}

export function getResolutionDimensions(
  resolution: string,
  aspectRatio: string,
): { width: number; height: number } {
  const resMap = RESOLUTION_MAP[resolution]
  if (resMap) {
    const dims = resMap[aspectRatio]
    if (dims) return dims
  }
  // Default fallback
  return { width: 960, height: 544 }
}

export function calculateNumFrames(duration: number, fps: number): number {
  return Math.round(duration * fps) + 1
}

/**
 * Compute the actual output dimensions after LTX latent quantization.
 * LTX requires spatial dimensions to be multiples of 32.
 * When spatial upscale is enabled, the gen node halves first, quantizes, then doubles.
 */
function quantizeResolution(width: number, height: number, spatialUpscale: boolean): { width: number; height: number } {
  if (spatialUpscale) {
    return {
      width: Math.floor(width / 64) * 64,
      height: Math.floor(height / 64) * 64,
    }
  }
  return {
    width: Math.floor(width / 32) * 32,
    height: Math.floor(height / 32) * 32,
  }
}

/**
 * Nodes that are only included when needed.
 * The core pipeline (1,4,5,6,7,8,23,24,25) is always included.
 */
const OPTIONAL_NODE_IDS = {
  spatialUpscaler: '2',
  temporalUpscaler: '3',
  mossTtsLoader: '9',
  mossTtsRefAudio: '10',
  mossTtsSave: '11',
  uploadAudio: '12',
  promptParser: '14',
  ollamaPositiveFormatter: '17',
  ollamaNegativeFormatter: '18',
  firstFrame: '20',
  middleFrame: '21',
  lastFrame: '22',
  filmGrain: '26',
  upscaleNode: '28',
  loadVideo: '29',
  videoFirstFrame: '30',
  localPositiveFormatter: '36',
  localNegativeFormatter: '37',
  zImageGenerate: '48',
  zImageClip: '49',
  zImageVae: '50',
  zImageUnet: '51',
  zImagePromptFormatter: '54',
  zImageSaveImage: '55',
  zImageNegativeFormatter: '56',
  cropFirstFrame: '57',
  cropMiddleFrame: '58',
  cropLastFrame: '59',
  rtxSuperRes: '60',
  localImagePromptCreator: '83',
  ollamaImagePromptCreator: '84',
}

const OLLAMA_FORMATTER_NODES = [
  OPTIONAL_NODE_IDS.ollamaPositiveFormatter,
  OPTIONAL_NODE_IDS.ollamaNegativeFormatter,
  OPTIONAL_NODE_IDS.ollamaImagePromptCreator,
]

const LOCAL_FORMATTER_NODES = [
  OPTIONAL_NODE_IDS.localPositiveFormatter,
  OPTIONAL_NODE_IDS.localNegativeFormatter,
  OPTIONAL_NODE_IDS.localImagePromptCreator,
]

const ALL_FORMATTER_NODES = [
  OPTIONAL_NODE_IDS.promptParser,
  ...OLLAMA_FORMATTER_NODES,
  ...LOCAL_FORMATTER_NODES,
]

const Z_IMAGE_NODES = [
  OPTIONAL_NODE_IDS.zImageGenerate,
  OPTIONAL_NODE_IDS.zImageClip,
  OPTIONAL_NODE_IDS.zImageVae,
  OPTIONAL_NODE_IDS.zImageUnet,
  OPTIONAL_NODE_IDS.zImagePromptFormatter,
  OPTIONAL_NODE_IDS.zImageSaveImage,
  OPTIONAL_NODE_IDS.zImageNegativeFormatter,
]

// Resolution presets for Z-Image standalone generation
const Z_IMAGE_RESOLUTION_MAP: Record<string, Record<string, { width: number; height: number }>> = {
  '1080p': {
    '16:9': { width: 1920, height: 1088 },
    '9:16': { width: 1088, height: 1920 },
    '1:1': { width: 1088, height: 1088 },
    '4:3': { width: 1440, height: 1088 },
    '3:4': { width: 1088, height: 1440 },
    '21:9': { width: 2560, height: 1088 },
  },
}

/**
 * Build a standalone Z-Image workflow (image-only, no LTXV pipeline).
 * Keeps only Z-Image nodes: 48, 49, 50, 51, 54, 55, 56.
 */
function buildZImageWorkflow(workflow: Workflow, params: WorkflowParams): Record<string, unknown> {
  const zImageNodeSet = new Set(Z_IMAGE_NODES)

  // Remove all non-Z-Image nodes
  for (const id of Object.keys(workflow)) {
    if (!zImageNodeSet.has(id)) {
      delete workflow[id]
    }
  }

  // Resolve image dimensions from aspect ratio
  const aspectRatio = params.imageAspectRatio || '16:9'
  const dims = Z_IMAGE_RESOLUTION_MAP['1080p']?.[aspectRatio] ?? { width: 1920, height: 1088 }

  // Configure Z-Image generate node
  const zGenNode = workflow[OPTIONAL_NODE_IDS.zImageGenerate]
  zGenNode.inputs['width'] = dims.width
  zGenNode.inputs['height'] = dims.height
  zGenNode.inputs['steps'] = params.imageSteps ?? 10
  zGenNode.inputs['seed'] = params.seed
  zGenNode.inputs['seed_mode'] = 'fixed'

  // Set prompt on the Z-Image prompt formatter
  workflow[OPTIONAL_NODE_IDS.zImagePromptFormatter].inputs['prompt'] = params.prompt
  if (params.promptFormatterTextEncoder) {
    workflow[OPTIONAL_NODE_IDS.zImagePromptFormatter].inputs['text_encoder'] = params.promptFormatterTextEncoder
    workflow[OPTIONAL_NODE_IDS.zImageNegativeFormatter].inputs['text_encoder'] = params.promptFormatterTextEncoder
  }

  return workflow as unknown as Record<string, unknown>
}

const DEFAULT_NEGATIVE_PROMPT = 'worst quality, low quality, blurry, jittery, distorted, cropped, watermark, watermarked, extra fingers, missing fingers, fused fingers, mutated hands, deformed hands, extra limbs, missing limbs, deformed limbs, extra arms, extra legs, malformed limbs, disfigured, bad anatomy, bad proportions, ugly, duplicate, morbid, mutilated, poorly drawn face, poorly drawn hands, inconsistent motion'

export function buildWorkflow(params: WorkflowParams): Record<string, unknown> {
  // Deep clone the template
  const workflow: Workflow = JSON.parse(JSON.stringify(workflowTemplate))

  const useZImage = params.imageGenerator === 'z-image'

  // --- Z-Image standalone image generation (no LTXV pipeline) ---
  if (useZImage && params.imageMode) {
    return buildZImageWorkflow(workflow, params)
  }

  // --- Strip optional nodes not needed for this generation ---
  const nodesToRemove = new Set<string>()

  // Z-Image nodes — only include for T2V when z-image is selected AND no user guidance frames
  const hasUserGuidanceFrame = !!(params.firstImage || params.middleImage || params.lastImage)
  if (!useZImage || hasUserGuidanceFrame) {
    for (const id of Z_IMAGE_NODES) nodesToRemove.add(id)
  } else {
    // Z-Image + T2V: remove SaveImage (intermediate image not saved)
    nodesToRemove.add(OPTIONAL_NODE_IDS.zImageSaveImage)
  }

  // MossTTS nodes — always remove for now (not yet wired to UI)
  // Note: uploadAudio (node 12) is separate — handled by the audio conditional below
  nodesToRemove.add(OPTIONAL_NODE_IDS.mossTtsLoader)
  nodesToRemove.add(OPTIONAL_NODE_IDS.mossTtsRefAudio)
  nodesToRemove.add(OPTIONAL_NODE_IDS.mossTtsSave)

  // Standalone upscale nodes — always remove for now (not yet wired to UI)
  nodesToRemove.add(OPTIONAL_NODE_IDS.upscaleNode)
  nodesToRemove.add(OPTIONAL_NODE_IDS.loadVideo)
  nodesToRemove.add(OPTIONAL_NODE_IDS.videoFirstFrame)

  // Upscaler nodes — only include if enabled
  if (!params.spatialUpscale) nodesToRemove.add(OPTIONAL_NODE_IDS.spatialUpscaler)
  if (!params.temporalUpscale) nodesToRemove.add(OPTIONAL_NODE_IDS.temporalUpscaler)

  // Audio node — only include if audio is provided
  if (!params.audio) nodesToRemove.add(OPTIONAL_NODE_IDS.uploadAudio)

  // Image nodes + crop nodes — only include if image is provided
  // (Z-Image wires directly to node 6, doesn't use the LoadImage node)
  if (!params.firstImage) {
    nodesToRemove.add(OPTIONAL_NODE_IDS.firstFrame)
    nodesToRemove.add(OPTIONAL_NODE_IDS.cropFirstFrame)
  }
  if (!params.middleImage) {
    nodesToRemove.add(OPTIONAL_NODE_IDS.middleFrame)
    nodesToRemove.add(OPTIONAL_NODE_IDS.cropMiddleFrame)
  }
  if (!params.lastImage) {
    nodesToRemove.add(OPTIONAL_NODE_IDS.lastFrame)
    nodesToRemove.add(OPTIONAL_NODE_IDS.cropLastFrame)
  }

  // Film grain — only include if enabled
  if (!params.filmGrain) nodesToRemove.add(OPTIONAL_NODE_IDS.filmGrain)

  // RTX Super Resolution — only include if enabled
  if (!params.rtxSuperRes) nodesToRemove.add(OPTIONAL_NODE_IDS.rtxSuperRes)

  for (const id of nodesToRemove) {
    delete workflow[id]
  }

  // --- Patch model selections ---
  if (params.checkpoint) {
    workflow['1'].inputs['ckpt_name'] = params.checkpoint
    workflow['4'].inputs['ckpt_name'] = params.checkpoint
  }
  if (params.vaeCheckpoint) {
    workflow['5'].inputs['ckpt_name'] = params.vaeCheckpoint
  } else if (params.checkpoint) {
    workflow['5'].inputs['ckpt_name'] = params.checkpoint
  }
  if (params.textEncoder) {
    workflow['4'].inputs['text_encoder'] = params.textEncoder
  }
  if (params.spatialUpscaleModel && workflow['2']) {
    workflow['2'].inputs['model_name'] = params.spatialUpscaleModel
  }
  if (params.temporalUpscaleModel && workflow['3']) {
    workflow['3'].inputs['model_name'] = params.temporalUpscaleModel
  }

  // --- Patch RSLTXVGenerate (node 6) ---
  const genNode = workflow['6']
  if (!genNode || genNode.class_type !== 'RSLTXVGenerate') {
    throw new Error('Workflow template missing RSLTXVGenerate at node "6"')
  }

  if (params.upscaleLora) {
    genNode.inputs['upscale_lora'] = params.upscaleLora
  }
  if (params.upscaleDenoise !== undefined) {
    genNode.inputs['upscale_denoise'] = params.upscaleDenoise
  }

  // Connect sampler node
  if (params.sampler) {
    workflow['27'].inputs['sampler_name'] = params.sampler
    genNode.inputs['sampler'] = ['27', 0]
  }

  genNode.inputs['width'] = params.width
  genNode.inputs['height'] = params.height
  genNode.inputs['num_frames'] = params.numFrames
  genNode.inputs['steps'] = params.steps
  genNode.inputs['cfg'] = params.cfg
  genNode.inputs['noise_seed'] = params.seed
  genNode.inputs['seed_mode'] = 'fixed'

  // Connect upscalers if enabled
  genNode.inputs['upscale'] = !!params.spatialUpscale
  if (params.spatialUpscale) {
    genNode.inputs['upscale_model'] = [OPTIONAL_NODE_IDS.spatialUpscaler, 0]
  }
  if (params.temporalUpscale) {
    genNode.inputs['temporal_upscale_model'] = [OPTIONAL_NODE_IDS.temporalUpscaler, 0]
  }

  // Connect audio if provided
  if (params.audio) {
    workflow[OPTIONAL_NODE_IDS.uploadAudio].inputs['audio'] = params.audio.name
    genNode.inputs['audio'] = [OPTIONAL_NODE_IDS.uploadAudio, 0]
  }

  // Quantize dimensions to match actual gen node output (LTX latent alignment)
  const actualDims = quantizeResolution(params.width, params.height, !!params.spatialUpscale)

  // Connect frame images if provided (LoadImage → ImageScale → RSLTXVGenerate)
  // Crop dimensions match the quantized output so guidance frames align exactly
  if (params.firstImage) {
    workflow[OPTIONAL_NODE_IDS.firstFrame].inputs['image'] = params.firstImage.name
    const cropFirst = workflow[OPTIONAL_NODE_IDS.cropFirstFrame]
    cropFirst.inputs['width'] = actualDims.width
    cropFirst.inputs['height'] = actualDims.height
    genNode.inputs['first_image'] = [OPTIONAL_NODE_IDS.cropFirstFrame, 0]
    genNode.inputs['first_strength'] = params.firstStrength ?? 1
  }
  if (params.middleImage) {
    workflow[OPTIONAL_NODE_IDS.middleFrame].inputs['image'] = params.middleImage.name
    const cropMiddle = workflow[OPTIONAL_NODE_IDS.cropMiddleFrame]
    cropMiddle.inputs['width'] = actualDims.width
    cropMiddle.inputs['height'] = actualDims.height
    genNode.inputs['middle_image'] = [OPTIONAL_NODE_IDS.cropMiddleFrame, 0]
    genNode.inputs['middle_strength'] = params.middleStrength ?? 1
  }
  if (params.lastImage) {
    workflow[OPTIONAL_NODE_IDS.lastFrame].inputs['image'] = params.lastImage.name
    const cropLast = workflow[OPTIONAL_NODE_IDS.cropLastFrame]
    cropLast.inputs['width'] = actualDims.width
    cropLast.inputs['height'] = actualDims.height
    genNode.inputs['last_image'] = [OPTIONAL_NODE_IDS.cropLastFrame, 0]
    genNode.inputs['last_strength'] = params.lastStrength ?? 1
  }

  // --- Patch prompt / prompt formatter chain ---
  // When promptEnhance is on:  user prompt [+ images] → Prompt Enhancer (83/84) → CLIP Positive (7)
  // When promptEnhance is off: user prompt → CLIP Positive (7) directly
  // SAD Formatter (36/17) and Parser (14) are kept in the template for future voice gen but bypassed for now.

  const hasAnyGuidanceFrame = !!(params.firstImage || params.middleImage || params.lastImage)
  const usePromptEnhance = params.promptEnhance !== false

  // Delete SAD formatter + parser nodes (not needed until voice gen)
  delete workflow[OPTIONAL_NODE_IDS.promptParser]

  // Delete all formatter/enhancer nodes for the unused path
  if (params.ollamaEnabled) {
    for (const id of LOCAL_FORMATTER_NODES) delete workflow[id]
    delete workflow[OPTIONAL_NODE_IDS.ollamaPositiveFormatter]
  } else {
    for (const id of OLLAMA_FORMATTER_NODES) delete workflow[id]
    delete workflow[OPTIONAL_NODE_IDS.localPositiveFormatter]
  }

  if (!usePromptEnhance) {
    // No enhancer — delete all enhancer and negative formatter nodes, use raw prompt + generic negative
    delete workflow[OPTIONAL_NODE_IDS.localImagePromptCreator]
    delete workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator]
    delete workflow[OPTIONAL_NODE_IDS.ollamaNegativeFormatter]
    delete workflow[OPTIONAL_NODE_IDS.localNegativeFormatter]

    workflow['7'].inputs['text'] = params.prompt
    workflow['8'].inputs['text'] = DEFAULT_NEGATIVE_PROMPT
  } else if (params.ollamaEnabled) {
    // Ollama enhancer path
    // Negative prompt formatter
    if (params.ollamaUrl) workflow['18'].inputs['ollama_url'] = params.ollamaUrl
    if (params.ollamaModel) workflow['18'].inputs['model'] = params.ollamaModel
    workflow['18'].inputs['prompt'] = [OPTIONAL_NODE_IDS.ollamaImagePromptCreator, 0]
    if (params.firstImage) workflow['18'].inputs['first_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]

    // Prompt Enhancer
    workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator].inputs['prompt'] = params.prompt
    if (params.ollamaUrl) workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator].inputs['ollama_url'] = params.ollamaUrl
    if (params.ollamaModel) workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator].inputs['model'] = params.ollamaModel
    if (params.firstImage) workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator].inputs['first_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
    if (params.middleImage) workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator].inputs['middle_image'] = [OPTIONAL_NODE_IDS.middleFrame, 0]
    if (params.lastImage) workflow[OPTIONAL_NODE_IDS.ollamaImagePromptCreator].inputs['last_image'] = [OPTIONAL_NODE_IDS.lastFrame, 0]

    // Wire enhancer output → CLIP Positive
    workflow['7'].inputs['text'] = [OPTIONAL_NODE_IDS.ollamaImagePromptCreator, 0]
  } else {
    // Local enhancer path
    // Negative prompt formatter
    if (params.promptFormatterTextEncoder) {
      workflow['37'].inputs['text_encoder'] = params.promptFormatterTextEncoder
    }
    workflow['8'].inputs['text'] = ['37', 0]
    workflow['37'].inputs['prompt'] = [OPTIONAL_NODE_IDS.localImagePromptCreator, 0]
    if (params.firstImage) workflow['37'].inputs['first_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]

    // Prompt Enhancer
    workflow[OPTIONAL_NODE_IDS.localImagePromptCreator].inputs['prompt'] = params.prompt
    if (params.promptFormatterTextEncoder) {
      workflow[OPTIONAL_NODE_IDS.localImagePromptCreator].inputs['text_encoder'] = params.promptFormatterTextEncoder
    }
    if (params.firstImage) workflow[OPTIONAL_NODE_IDS.localImagePromptCreator].inputs['first_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
    if (params.middleImage) workflow[OPTIONAL_NODE_IDS.localImagePromptCreator].inputs['middle_image'] = [OPTIONAL_NODE_IDS.middleFrame, 0]
    if (params.lastImage) workflow[OPTIONAL_NODE_IDS.localImagePromptCreator].inputs['last_image'] = [OPTIONAL_NODE_IDS.lastFrame, 0]

    // Wire enhancer output → CLIP Positive
    workflow['7'].inputs['text'] = [OPTIONAL_NODE_IDS.localImagePromptCreator, 0]
  }

  // --- Z-Image + T2V: wire Z-Image output as first frame for LTXV ---
  // Only use Z-Image for first frame when user hasn't provided their own guidance frames
  if (useZImage && !hasAnyGuidanceFrame) {
    workflow[OPTIONAL_NODE_IDS.zImagePromptFormatter].inputs['prompt'] = params.prompt
    if (params.promptFormatterTextEncoder) {
      workflow[OPTIONAL_NODE_IDS.zImagePromptFormatter].inputs['text_encoder'] = params.promptFormatterTextEncoder
      workflow[OPTIONAL_NODE_IDS.zImageNegativeFormatter].inputs['text_encoder'] = params.promptFormatterTextEncoder
    }
    workflow[OPTIONAL_NODE_IDS.zImageGenerate].inputs['width'] = actualDims.width
    workflow[OPTIONAL_NODE_IDS.zImageGenerate].inputs['height'] = actualDims.height
    workflow[OPTIONAL_NODE_IDS.zImageGenerate].inputs['seed'] = params.seed
    workflow[OPTIONAL_NODE_IDS.zImageGenerate].inputs['seed_mode'] = 'fixed'
    genNode.inputs['first_image'] = [OPTIONAL_NODE_IDS.zImageGenerate, 0]
    genNode.inputs['first_strength'] = params.firstStrength ?? 1
  }

  // --- Post-processing chain: RSLTXVGenerate → [RTX Super Res] → [Film Grain] → CreateVideo ---
  // Build the chain: each stage feeds images to the next
  let lastImageSource: [string, number] = ['6', 2] // RSLTXVGenerate images output

  // RTX Video Super Resolution (4K upscale)
  if (params.rtxSuperRes && workflow[OPTIONAL_NODE_IDS.rtxSuperRes]) {
    const rtxNode = workflow[OPTIONAL_NODE_IDS.rtxSuperRes]
    rtxNode.inputs['images'] = lastImageSource
    lastImageSource = [OPTIONAL_NODE_IDS.rtxSuperRes, 0]
  }

  // Film grain
  if (params.filmGrain) {
    const grainNode = workflow[OPTIONAL_NODE_IDS.filmGrain]
    grainNode.inputs['images'] = lastImageSource
    grainNode.inputs['intensity'] = params.filmGrainIntensity ?? 0.05
    grainNode.inputs['grain_size'] = Math.max(1.0, params.filmGrainSize ?? 1.2)
    grainNode.inputs['seed'] = params.seed
    lastImageSource = [OPTIONAL_NODE_IDS.filmGrain, 0]
  }

  // Wire final images to CreateVideo
  workflow['23'].inputs['images'] = lastImageSource

  // --- Patch FPS (PrimitiveFloat node 24) ---
  workflow['24'].inputs['value'] = params.frameRate

  return workflow as unknown as Record<string, unknown>
}
