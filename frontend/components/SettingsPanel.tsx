import { Select } from './ui/select'
import type { GenerationMode } from './ModeTabs'

export interface GenerationSettings {
  model: 'fast' | 'pro'
  duration: number
  videoResolution: string
  fps: number
  audio: boolean
  cameraMotion: string
  aspectRatio?: string
  spatialUpscale?: boolean
  temporalUpscale?: boolean
  filmGrain?: boolean
  filmGrainIntensity?: number
  filmGrainSize?: number
  // Image-specific settings
  imageResolution: string
  imageAspectRatio: string
  imageSteps: number
  variations?: number  // Number of image variations to generate
}

interface SettingsPanelProps {
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
  disabled?: boolean
  mode?: GenerationMode
  hasAudio?: boolean
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  disabled,
  mode = 'text-to-video',
  hasAudio = false,
}: SettingsPanelProps) {
  const isImageMode = mode === 'text-to-image'
  const handleChange = (key: keyof GenerationSettings, value: string | number | boolean) => {
    const nextSettings = { ...settings, [key]: value } as GenerationSettings
    onSettingsChange(nextSettings)
  }

  const maxDuration = settings.temporalUpscale ? 40 : 20
  const durationOptions = [5, 6, 8, 10, 20, 30, 40].filter(d => d <= maxDuration)
  const resolutionOptions = ['1080p', '720p', '540p']
  const fpsOptions = [24, 25, 30, 50, 60]

  // Image mode settings
  if (isImageMode) {
    return (
      <div className="space-y-4">
        {/* Aspect Ratio and Quality side by side */}
        <div className="grid grid-cols-2 gap-3">
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

          <Select
            label="Quality"
            value={settings.imageSteps || 4}
            onChange={(e) => handleChange('imageSteps', parseInt(e.target.value))}
            disabled={disabled}
          >
            <option value={4}>Fast</option>
            <option value={8}>Balanced</option>
            <option value={12}>High</option>
          </Select>
        </div>
      </div>
    )
  }

  // Video mode settings
  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <Select
        label="Model"
        value={settings.model}
        onChange={(e) => handleChange('model', e.target.value)}
        disabled={disabled}
      >
        <option value="fast">LTX via ComfyUI</option>
      </Select>

      {/* Duration, Resolution, FPS Row */}
      <div className="grid grid-cols-3 gap-3">
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
    </div>
  )
}
