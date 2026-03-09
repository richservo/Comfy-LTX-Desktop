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
}

const OLLAMA_FORMATTER_NODES = [
  OPTIONAL_NODE_IDS.ollamaPositiveFormatter,
  OPTIONAL_NODE_IDS.ollamaNegativeFormatter,
]

const LOCAL_FORMATTER_NODES = [
  OPTIONAL_NODE_IDS.localPositiveFormatter,
  OPTIONAL_NODE_IDS.localNegativeFormatter,
]

const ALL_FORMATTER_NODES = [
  OPTIONAL_NODE_IDS.promptParser,
  ...OLLAMA_FORMATTER_NODES,
  ...LOCAL_FORMATTER_NODES,
]

const DEFAULT_NEGATIVE_PROMPT = 'worst quality, low quality, blurry, jittery, distorted, cropped, watermark, watermarked, extra fingers, missing fingers, fused fingers, mutated hands, deformed hands, extra limbs, missing limbs, deformed limbs, extra arms, extra legs, malformed limbs, disfigured, bad anatomy, bad proportions, ugly, duplicate, morbid, mutilated, poorly drawn face, poorly drawn hands, inconsistent motion'

export function buildWorkflow(params: WorkflowParams): Record<string, unknown> {
  // Deep clone the template
  const workflow: Workflow = JSON.parse(JSON.stringify(workflowTemplate))

  // --- Strip optional nodes not needed for this generation ---
  const nodesToRemove = new Set<string>()

  // MossTTS nodes — always remove for now (not yet wired to UI)
  nodesToRemove.add(OPTIONAL_NODE_IDS.mossTtsLoader)
  nodesToRemove.add(OPTIONAL_NODE_IDS.mossTtsRefAudio)
  nodesToRemove.add(OPTIONAL_NODE_IDS.mossTtsSave)
  nodesToRemove.add(OPTIONAL_NODE_IDS.uploadAudio)

  // Standalone upscale nodes — always remove for now (not yet wired to UI)
  nodesToRemove.add(OPTIONAL_NODE_IDS.upscaleNode)
  nodesToRemove.add(OPTIONAL_NODE_IDS.loadVideo)
  nodesToRemove.add(OPTIONAL_NODE_IDS.videoFirstFrame)

  // Upscaler nodes — only include if enabled
  if (!params.spatialUpscale) nodesToRemove.add(OPTIONAL_NODE_IDS.spatialUpscaler)
  if (!params.temporalUpscale) nodesToRemove.add(OPTIONAL_NODE_IDS.temporalUpscaler)

  // Audio node — only include if audio is provided
  if (!params.audio) nodesToRemove.add(OPTIONAL_NODE_IDS.uploadAudio)

  // Image nodes — only include if image is provided
  if (!params.firstImage) nodesToRemove.add(OPTIONAL_NODE_IDS.firstFrame)
  if (!params.middleImage) nodesToRemove.add(OPTIONAL_NODE_IDS.middleFrame)
  if (!params.lastImage) nodesToRemove.add(OPTIONAL_NODE_IDS.lastFrame)

  // Film grain — only include if enabled
  if (!params.filmGrain) nodesToRemove.add(OPTIONAL_NODE_IDS.filmGrain)

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

  // Connect frame images if provided
  if (params.firstImage) {
    workflow[OPTIONAL_NODE_IDS.firstFrame].inputs['image'] = params.firstImage.name
    genNode.inputs['first_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
    genNode.inputs['first_strength'] = params.firstStrength ?? 1
  }
  if (params.middleImage) {
    workflow[OPTIONAL_NODE_IDS.middleFrame].inputs['image'] = params.middleImage.name
    genNode.inputs['middle_image'] = [OPTIONAL_NODE_IDS.middleFrame, 0]
    genNode.inputs['middle_strength'] = params.middleStrength ?? 1
  }
  if (params.lastImage) {
    workflow[OPTIONAL_NODE_IDS.lastFrame].inputs['image'] = params.lastImage.name
    genNode.inputs['last_image'] = [OPTIONAL_NODE_IDS.lastFrame, 0]
    genNode.inputs['last_strength'] = params.lastStrength ?? 1
  }

  // --- Patch prompt / prompt formatter chain ---
  if (params.ollamaEnabled) {
    // Ollama enabled: route through Ollama formatter chain
    // Node 17 (RSPromptFormatter) → Node 14 (RSPromptParser) → Node 7 (CLIP positive)
    // Node 14 → Node 18 (negative formatter) → Node 8 (CLIP negative)
    for (const id of LOCAL_FORMATTER_NODES) delete workflow[id]

    workflow['17'].inputs['prompt'] = params.prompt
    if (params.ollamaUrl) workflow['17'].inputs['ollama_url'] = params.ollamaUrl
    if (params.ollamaModel) workflow['17'].inputs['model'] = params.ollamaModel
    if (params.ollamaUrl) workflow['18'].inputs['ollama_url'] = params.ollamaUrl
    if (params.ollamaModel) workflow['18'].inputs['model'] = params.ollamaModel

    // If first image is provided, connect it to the prompt formatters as reference
    if (params.firstImage) {
      workflow['17'].inputs['reference_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
      workflow['18'].inputs['reference_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
    }
  } else {
    // Ollama disabled (default): use local prompt formatter via text encoder weights
    // Node 36 (RSPromptFormatterLocal) → Node 14 (RSPromptParser) → Node 7 (CLIP positive)
    // Node 14 → Node 37 (local negative formatter) → Node 8 (CLIP negative)
    for (const id of OLLAMA_FORMATTER_NODES) delete workflow[id]

    workflow['36'].inputs['prompt'] = params.prompt
    if (params.promptFormatterTextEncoder) {
      workflow['36'].inputs['text_encoder'] = params.promptFormatterTextEncoder
      workflow['37'].inputs['text_encoder'] = params.promptFormatterTextEncoder
    }

    // Wire parser to local formatter instead of Ollama formatter
    workflow['14'].inputs['script'] = ['36', 0]
    // Wire CLIP negative to local negative formatter
    workflow['8'].inputs['text'] = ['37', 0]

    // If first image is provided, connect it to the prompt formatters as reference
    if (params.firstImage) {
      workflow['36'].inputs['reference_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
      workflow['37'].inputs['reference_image'] = [OPTIONAL_NODE_IDS.firstFrame, 0]
    }
  }

  // --- Film grain: wire between node 6 images and node 23 ---
  if (params.filmGrain) {
    const grainNode = workflow[OPTIONAL_NODE_IDS.filmGrain]
    grainNode.inputs['images'] = ['6', 2]
    grainNode.inputs['intensity'] = params.filmGrainIntensity ?? 0.05
    grainNode.inputs['grain_size'] = Math.max(1.0, params.filmGrainSize ?? 1.2)
    workflow['23'].inputs['images'] = [OPTIONAL_NODE_IDS.filmGrain, 0]
  }

  // --- Patch FPS (PrimitiveFloat node 24) ---
  workflow['24'].inputs['value'] = params.frameRate

  return workflow as unknown as Record<string, unknown>
}
