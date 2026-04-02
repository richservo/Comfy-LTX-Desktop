import { useState, useEffect, useCallback } from 'react'
import { Select } from './ui/select'
import { MaskPainter } from './MaskPainter'
import type { GenerationMode } from './ModeTabs'
import { useAppSettings } from '../contexts/AppSettingsContext'

const DEFAULT_NEGATIVE_PROMPT = 'worst quality, low quality, blurry, jittery, distorted, cropped, watermark, watermarked, extra fingers, missing fingers, fused fingers, mutated hands, deformed hands, extra limbs, missing limbs, deformed limbs, extra arms, extra legs, malformed limbs, disfigured, bad anatomy, bad proportions, ugly, duplicate, morbid, mutilated, poorly drawn face, poorly drawn hands, inconsistent motion'

export interface GenerationSettings {
  model: 'fast' | 'pro'
  duration: number
  videoResolution: string
  fps: number
  audio: boolean
  cameraMotion: string
  aspectRatio?: string
  spatialUpscale?: boolean
  upscaleDenoise?: number
  temporalUpscale?: boolean
  filmGrain?: boolean
  filmGrainIntensity?: number
  filmGrainSize?: number
  rtxSuperRes?: boolean
  promptEnhance?: boolean
  stgScale?: number
  crf?: number
  negativePrompt?: string
  maskMode?: 'off' | 'subject' | 'face' | 'sam' | 'paint'
  maskPrompt?: string
  maskDilation?: number
  rediffusionMaskStrength?: number
  paintedMaskDataUrl?: string
  iterations?: number
  // Image-specific settings
  imageResolution: string
  imageAspectRatio: string
  imageSteps: number
  imageGenerator?: string
  variations?: number  // Number of image variations to generate
  loras?: { name: string; strength: number }[]
}

interface SettingsPanelProps {
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
  disabled?: boolean
  mode?: GenerationMode
  hasAudio?: boolean
  hideDuration?: boolean
  hideIterations?: boolean
  /** First frame image URL for the mask painter */
  imagePath?: string | null
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  disabled,
  mode = 'text-to-video',
  hasAudio = false,
  hideDuration = false,
  hideIterations = false,
  imagePath,
}: SettingsPanelProps) {
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings()
  const [hasRtxSuperRes, setHasRtxSuperRes] = useState(false)
  const [hasZImage, setHasZImage] = useState(false)
  const [hasGemini, setHasGemini] = useState(false)
  const [geminiImageSizes, setGeminiImageSizes] = useState<string[]>([])
  const [loraOptions, setLoraOptions] = useState<string[]>([])
  const [showMaskPainter, setShowMaskPainter] = useState(false)

  const handleMaskPainted = useCallback((maskDataUrl: string) => {
    onSettingsChange({ ...settings, paintedMaskDataUrl: maskDataUrl })
    setShowMaskPainter(false)
  }, [settings, onSettingsChange])

  useEffect(() => {
    window.electronAPI?.getModelLists?.()
      .then((lists: { hasRtxSuperRes?: boolean; hasZImage?: boolean; hasGemini?: boolean; geminiImageSizes?: string[]; loras?: string[] }) => {
        if (lists.hasRtxSuperRes) setHasRtxSuperRes(true)
        if (lists.hasZImage) setHasZImage(true)
        if (lists.hasGemini) setHasGemini(true)
        if (lists.geminiImageSizes) setGeminiImageSizes(lists.geminiImageSizes)
        if (lists.loras) setLoraOptions(lists.loras)
      })
      .catch(() => {})
  }, [])

  const isImageMode = mode === 'text-to-image'
  const handleChange = (key: keyof GenerationSettings, value: string | number | boolean) => {
    const nextSettings = { ...settings, [key]: value } as GenerationSettings
    onSettingsChange(nextSettings)
  }

  const maxDuration = settings.temporalUpscale ? 40 : 20
  const durationOptions = [5, 6, 8, 10, 12, 15, 18, 20, 30, 40].filter(d => d <= maxDuration)
  const resolutionOptions = hasRtxSuperRes ? ['4K', '1080p', '720p', '540p'] : ['1080p', '720p', '540p']
  const fpsOptions = [24, 25, 30, 50, 60]

  const effectiveImageGenerator = settings.imageGenerator ?? appSettings.imageGenerator ?? 'none'

  // Image mode settings
  if (isImageMode) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Image Model"
            value={effectiveImageGenerator}
            onChange={(e) => handleChange('imageGenerator', e.target.value)}
            disabled={disabled}
          >
            <option value="none">LTX (Default)</option>
            {hasZImage && <option value="z-image">Z-Image</option>}
            {hasGemini && <option value="gemini">Gemini</option>}
          </Select>

          <Select
            label="Aspect Ratio"
            value={settings.imageAspectRatio || '16:9'}
            onChange={(e) => handleChange('imageAspectRatio', e.target.value)}
            disabled={disabled}
          >
            <option value="1:1">1:1 (Square)</option>
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
            <option value="4:3">4:3 (Standard)</option>
            <option value="3:4">3:4 (Portrait Standard)</option>
            <option value="21:9">21:9 (Cinematic)</option>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {effectiveImageGenerator === 'gemini' ? (
            <Select
              label="Image Size"
              value={appSettings.geminiImageSize || '2K'}
              onChange={(e) => updateAppSettings({ geminiImageSize: e.target.value })}
              disabled={disabled}
            >
              {geminiImageSizes.length > 0
                ? geminiImageSizes.map(s => <option key={s} value={s}>{s}</option>)
                : <>
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </>
              }
            </Select>
          ) : (
            <Select
              label="Quality"
              value={settings.imageSteps || 4}
              onChange={(e) => handleChange('imageSteps', parseInt(e.target.value))}
              disabled={disabled}
            >
              <option value={10}>Fast (10 steps)</option>
              <option value={20}>Balanced (20 steps)</option>
              <option value={40}>High (40 steps)</option>
            </Select>
          )}
        </div>

        {/* Prompt Enhance */}
        <label className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          settings.promptEnhance !== false ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-700 hover:border-zinc-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <input
            type="checkbox"
            checked={settings.promptEnhance !== false}
            onChange={(e) => handleChange('promptEnhance', e.target.checked)}
            disabled={disabled}
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
          />
          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
            settings.promptEnhance !== false ? 'bg-violet-500 border-violet-500' : 'border-zinc-600'
          }`}>
            {settings.promptEnhance !== false && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div>
            <div className="text-sm text-zinc-200 font-medium">Prompt Enhance</div>
            <div className="text-[10px] text-zinc-500">Expand prompt with detail</div>
          </div>
        </label>
      </div>
    )
  }

  // Video mode settings
  return (
    <><div className="space-y-4">
      {/* Model Selection */}
      <Select
        label="Model"
        value={settings.model}
        onChange={(e) => handleChange('model', e.target.value)}
        disabled={disabled}
      >
        <option value="fast">LTX via ComfyUI</option>
      </Select>

      {/* Duration, Resolution, FPS, Iterations Row */}
      <div className={`grid gap-3 ${hideDuration && hideIterations ? 'grid-cols-2' : hideDuration || hideIterations ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {!hideDuration && (
          <Select
            label={hasAudio ? 'Duration (auto)' : 'Duration'}
            value={settings.duration}
            onChange={(e) => handleChange('duration', parseInt(e.target.value))}
            disabled={disabled || hasAudio}
          >
            {durationOptions.map((duration) => (
              <option key={duration} value={duration}>
                {duration} sec
              </option>
            ))}
          </Select>
        )}

        <Select
          label="Resolution"
          value={settings.videoResolution}
          onChange={(e) => handleChange('videoResolution', e.target.value)}
          disabled={disabled}
        >
          {resolutionOptions.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution}
            </option>
          ))}
        </Select>

        <Select
          label="FPS"
          value={settings.fps}
          onChange={(e) => handleChange('fps', parseInt(e.target.value))}
          disabled={disabled}
        >
          {fpsOptions.map((fps) => (
            <option key={fps} value={fps}>
              {fps}
            </option>
          ))}
        </Select>

        {!hideIterations && (
          <Select
            label="Iterations"
            value={settings.iterations || 1}
            onChange={(e) => handleChange('iterations', parseInt(e.target.value))}
            disabled={disabled}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}x
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* Aspect Ratio */}
      <Select
        label="Aspect Ratio"
        value={settings.aspectRatio || '16:9'}
        onChange={(e) => handleChange('aspectRatio', e.target.value)}
        disabled={disabled}
      >
        {hasAudio ? (
          <option value="16:9">16:9 Landscape</option>
        ) : (
          <>
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Portrait</option>
          </>
        )}
      </Select>

      {/* Audio and Camera Motion Row */}
      <div className="flex gap-3">
        <div className="w-[140px] flex-shrink-0">
          <Select
            label="Audio"
            badge="PREVIEW"
            value={settings.audio ? 'on' : 'off'}
            onChange={(e) => handleChange('audio', e.target.value === 'on')}
            disabled={disabled}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </div>

        <div className="flex-1">
          <Select
            label="Camera Motion"
            value={settings.cameraMotion}
            onChange={(e) => handleChange('cameraMotion', e.target.value)}
            disabled={disabled}
          >
            <option value="none">None</option>
            <option value="static">Static</option>
            <option value="focus_shift">Focus Shift</option>
            <option value="dolly_in">Dolly In</option>
            <option value="dolly_out">Dolly Out</option>
            <option value="dolly_left">Dolly Left</option>
            <option value="dolly_right">Dolly Right</option>
            <option value="jib_up">Jib Up</option>
            <option value="jib_down">Jib Down</option>
          </Select>
        </div>
      </div>

      {/* Prompt Enhance */}
      <label className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
        settings.promptEnhance !== false ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-700 hover:border-zinc-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input
          type="checkbox"
          checked={settings.promptEnhance !== false}
          onChange={(e) => handleChange('promptEnhance', e.target.checked)}
          disabled={disabled}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
        />
        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
          settings.promptEnhance !== false ? 'bg-violet-500 border-violet-500' : 'border-zinc-600'
        }`}>
          {settings.promptEnhance !== false && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-200 font-medium">Prompt Enhance</div>
          <div className="text-[10px] text-zinc-500">Expand prompt with detail</div>
        </div>
      </label>

      {/* Negative Prompt — shown when prompt enhance is off */}
      {settings.promptEnhance === false && (
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-zinc-400">Negative Prompt</span>
          </div>
          <textarea
            value={settings.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT}
            onChange={(e) => handleChange('negativePrompt', e.target.value)}
            disabled={disabled}
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-violet-500 resize-y"
            placeholder="Negative prompt..."
          />
        </div>
      )}

      {/* Upscale Options */}
      <div className="flex gap-3">
        <label className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          settings.spatialUpscale ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-700 hover:border-zinc-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <input
            type="checkbox"
            checked={settings.spatialUpscale || false}
            onChange={(e) => handleChange('spatialUpscale', e.target.checked)}
            disabled={disabled}
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
          />
          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
            settings.spatialUpscale ? 'bg-violet-500 border-violet-500' : 'border-zinc-600'
          }`}>
            {settings.spatialUpscale && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div>
            <div className="text-sm text-zinc-200 font-medium">Spatial Upscale</div>
            <div className="text-[10px] text-zinc-500">2x resolution</div>
          </div>
        </label>

        <label className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          settings.temporalUpscale ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-700 hover:border-zinc-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <input
            type="checkbox"
            checked={settings.temporalUpscale || false}
            onChange={(e) => handleChange('temporalUpscale', e.target.checked)}
            disabled={disabled}
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
          />
          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
            settings.temporalUpscale ? 'bg-violet-500 border-violet-500' : 'border-zinc-600'
          }`}>
            {settings.temporalUpscale && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div>
            <div className="text-sm text-zinc-200 font-medium">Temporal Upscale</div>
            <div className="text-[10px] text-zinc-500">2x frame count</div>
          </div>
        </label>
      </div>

      {/* Upscale Denoise - shown when spatial upscale is enabled */}
      {settings.spatialUpscale && (
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-zinc-400">Upscale Denoise</span>
            <span className="text-zinc-500">{(settings.upscaleDenoise ?? 0.5).toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.upscaleDenoise ?? 0.5}
            onChange={(e) => handleChange('upscaleDenoise', parseFloat(e.target.value))}
            disabled={disabled}
            className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
          />
        </div>
      )}

      {/* Rediffusion Mask - shown when spatial upscale is enabled */}
      {settings.spatialUpscale && (
        <div className={`rounded-lg border transition-colors ${
          settings.maskMode && settings.maskMode !== 'off' ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-700'
        }`}>
          <div className="px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Rediffusion Mask</span>
              <select
                value={settings.maskMode ?? 'off'}
                onChange={(e) => handleChange('maskMode', e.target.value)}
                disabled={disabled}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-300 focus:outline-none focus:border-violet-500 cursor-pointer"
              >
                <option value="off">Off</option>
                <option value="subject">Subject</option>
                <option value="face">Face</option>
                <option value="sam">SAM3</option>
                <option value="paint">Paint</option>
              </select>
            </div>
            {settings.maskMode === 'sam' && (
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-zinc-400">Mask Target</span>
                </div>
                <input
                  type="text"
                  value={settings.maskPrompt ?? 'face'}
                  onChange={(e) => handleChange('maskPrompt', e.target.value)}
                  disabled={disabled}
                  placeholder="e.g. face, person, car..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-violet-500"
                />
              </div>
            )}
            {settings.maskMode === 'paint' && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowMaskPainter(true)}
                  disabled={disabled || !imagePath}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {settings.paintedMaskDataUrl ? 'Edit Mask' : 'Paint Mask'}
                </button>
                {!imagePath && (
                  <p className="text-[10px] text-zinc-500">Add a first frame image to paint a mask</p>
                )}
                {settings.paintedMaskDataUrl && (
                  <div className="flex items-center gap-2">
                    <img
                      src={settings.paintedMaskDataUrl}
                      alt="Painted mask"
                      className="h-8 rounded border border-zinc-700 bg-black"
                    />
                    <span className="text-[10px] text-green-400">Mask ready</span>
                    <button
                      onClick={() => onSettingsChange({ ...settings, paintedMaskDataUrl: undefined })}
                      className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
            {settings.maskMode && settings.maskMode !== 'off' && (
              <div className="space-y-2 pt-1">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-zinc-400">Mask Strength</span>
                    <span className="text-zinc-500">{(settings.rediffusionMaskStrength ?? 0.5).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.rediffusionMaskStrength ?? 0.5}
                    onChange={(e) => handleChange('rediffusionMaskStrength', parseFloat(e.target.value))}
                    disabled={disabled}
                    className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
                  />
                </div>
                {settings.maskMode !== 'paint' && (
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-zinc-400">Dilation</span>
                      <span className="text-zinc-500">{settings.maskDilation ?? 100}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={300}
                      step={5}
                      value={settings.maskDilation ?? 100}
                      onChange={(e) => handleChange('maskDilation', parseInt(e.target.value))}
                      disabled={disabled}
                      className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STG Scale (Spatiotemporal Guidance) */}
      <div>
        <div className="flex justify-between text-[11px] mb-1">
          <span className="text-zinc-400">STG Scale</span>
          <span className="text-zinc-500">{settings.stgScale ?? 1}</span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={settings.stgScale ?? 1}
          onChange={(e) => handleChange('stgScale', parseFloat(e.target.value))}
          disabled={disabled}
          className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
        <div className="text-[10px] text-zinc-600 mt-0.5">Multimodal guidance strength (0 = off)</div>
      </div>

      {/* CRF (output quality) */}
      <div>
        <div className="flex justify-between text-[11px] mb-1">
          <span className="text-zinc-400">CRF</span>
          <span className="text-zinc-500">{settings.crf ?? 35}</span>
        </div>
        <input
          type="range"
          min={0}
          max={51}
          step={1}
          value={settings.crf ?? 35}
          onChange={(e) => handleChange('crf', parseInt(e.target.value))}
          disabled={disabled}
          className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
        <div className="text-[10px] text-zinc-600 mt-0.5">Image preprocess quality (0 = lossless, default 35)</div>
      </div>

      {/* Film Grain */}
      <div className={`rounded-lg border transition-colors ${
        settings.filmGrain ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-700'
      }`}>
        <label className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <input
            type="checkbox"
            checked={settings.filmGrain || false}
            onChange={(e) => handleChange('filmGrain', e.target.checked)}
            disabled={disabled}
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
          />
          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
            settings.filmGrain ? 'bg-violet-500 border-violet-500' : 'border-zinc-600'
          }`}>
            {settings.filmGrain && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div>
            <div className="text-sm text-zinc-200 font-medium">Film Grain</div>
            <div className="text-[10px] text-zinc-500">Subtle grain texture</div>
          </div>
        </label>

        {settings.filmGrain && (
          <div className="px-3 pb-3 space-y-2">
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-zinc-400">Intensity</span>
                <span className="text-zinc-500">{(settings.filmGrainIntensity ?? 0.05).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.01}
                max={0.5}
                step={0.01}
                value={settings.filmGrainIntensity ?? 0.05}
                onChange={(e) => handleChange('filmGrainIntensity', parseFloat(e.target.value))}
                disabled={disabled}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-zinc-400">Grain Size</span>
                <span className="text-zinc-500">{(settings.filmGrainSize ?? 1.2).toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1.0}
                max={3.0}
                step={0.1}
                value={settings.filmGrainSize ?? 1.2}
                onChange={(e) => handleChange('filmGrainSize', parseFloat(e.target.value))}
                disabled={disabled}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* LoRA Models */}
      {loraOptions.length > 0 && (
        <div className="rounded-lg border border-zinc-700 transition-colors">
          <div className="px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">LoRA Models</span>
            </div>
            {(settings.loras ?? []).map((lora, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2">
                  <select
                    value={lora.name}
                    onChange={(e) => {
                      const next = [...(settings.loras ?? [])]
                      next[idx] = { ...next[idx], name: e.target.value }
                      onSettingsChange({ ...settings, loras: next })
                    }}
                    disabled={disabled}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-violet-500 cursor-pointer"
                  >
                    {loraOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button
                    onClick={() => {
                      const next = (settings.loras ?? []).filter((_, i) => i !== idx)
                      onSettingsChange({ ...settings, loras: next.length > 0 ? next : undefined })
                    }}
                    disabled={disabled}
                    className="text-zinc-500 hover:text-red-400 transition-colors text-[11px] px-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-14">Strength</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={lora.strength}
                    onChange={(e) => {
                      const next = [...(settings.loras ?? [])]
                      next[idx] = { ...next[idx], strength: parseFloat(e.target.value) }
                      onSettingsChange({ ...settings, loras: next })
                    }}
                    disabled={disabled}
                    className="flex-1 h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-violet-500"
                  />
                  <span className="text-[10px] text-zinc-500 w-7 text-right">{lora.strength.toFixed(2)}</span>
                </div>
              </div>
            ))}
            <button
              onClick={() => {
                const next = [...(settings.loras ?? []), { name: loraOptions[0], strength: 1.0 }]
                onSettingsChange({ ...settings, loras: next })
              }}
              disabled={disabled}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-zinc-400 hover:text-zinc-200 border border-dashed border-zinc-700 hover:border-zinc-500 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add LoRA
            </button>
          </div>
        </div>
      )}

    </div>

    {showMaskPainter && imagePath && (
      <MaskPainter
        imagePath={imagePath}
        existingMask={settings.paintedMaskDataUrl}
        onApply={handleMaskPainted}
        onCancel={() => setShowMaskPainter(false)}
      />
    )}
    </>
  )
}
