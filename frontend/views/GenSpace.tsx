import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Trash2, Download, Image, Video, X,
  Heart, Film, Volume2, VolumeX, Sparkles,
  Clock, Monitor, ChevronUp, Scissors, RefreshCw,
  ChevronLeft, ChevronRight, Copy, Check,
  Menu, Square, ArrowUpDown, Pencil, RotateCcw
} from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import type { GenSpaceRetakeSource } from '../contexts/ProjectContext'
import { useGeneration } from '../contexts/GenerationContext'
import { useRetake } from '../hooks/use-retake'
import { useAppSettings } from '../contexts/AppSettingsContext'
import type { Asset } from '../types/project'
import { GenerationErrorDialog } from '../components/GenerationErrorDialog'
import { SettingsPanel, type GenerationSettings } from '../components/SettingsPanel'
import { ModeTabs, type GenerationMode } from '../components/ModeTabs'
import { ImageUploader } from '../components/ImageUploader'
import { AudioUploader } from '../components/AudioUploader'
import { Textarea } from '../components/ui/textarea'
import { copyToAssetFolder } from '../lib/asset-copy'
import { fileUrlToPath, fileToFileUrl, resolveImageDrop } from '../lib/url-to-path'
import { logger } from '../lib/logger'
import { RetakePanel } from '../components/RetakePanel'

// Asset card with hover overlays
function AssetCard({
  asset,
  onDelete,
  onPlay,
  onDragStart,
  onCreateVideo,
  onRerender,
  onEdit,
  onToggleFavorite
}: {
  asset: Asset
  onDelete: () => void
  onPlay: () => void
  onDragStart: (e: React.DragEvent, asset: Asset) => void
  onCreateVideo?: (asset: Asset) => void
  onRerender?: (asset: Asset) => void
  onEdit?: (asset: Asset) => void
  onToggleFavorite?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isMuted, setIsMuted] = useState(true)
  const isFavorite = asset.favorite || false

  useEffect(() => {
    if (asset.type === 'video' && videoRef.current) {
      if (isHovered) {
        videoRef.current.play().catch(() => {})
      } else {
        videoRef.current.pause()
        videoRef.current.currentTime = 0
        setCurrentTime(0)
      }
    }
  }, [isHovered, asset.type])

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = asset.url
    a.download = asset.path.split('/').pop() || `${asset.type}-${asset.id}`
    a.click()
  }

  return (
    <div
      className="relative group cursor-pointer rounded-xl overflow-hidden bg-zinc-900"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onPlay}
      draggable={asset.type === 'image'}
      onDragStart={(e) => asset.type === 'image' && onDragStart(e, asset)}
    >
      {asset.type === 'video' ? (
        <video
          ref={videoRef}
          src={asset.url}
          className="w-full aspect-video object-contain"
          muted={isMuted}
          loop
          onTimeUpdate={handleTimeUpdate}
        />
      ) : (
        <img src={asset.url} alt="" className="w-full aspect-video object-contain" />
      )}

      {/* Favorite heart - always visible when favorited */}
      {isFavorite && !isHovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.() }}
          className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white transition-colors z-10"
        >
          <Heart className="h-3.5 w-3.5 fill-current" />
        </button>
      )}

      {/* Hover overlay */}
      <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 transition-opacity duration-200 ${
        isHovered ? 'opacity-100' : 'opacity-0'
      }`}>
        {/* Top buttons */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite?.() }}
              className={`p-1.5 rounded-lg backdrop-blur-md transition-colors ${
                isFavorite ? 'bg-white/20 text-white' : 'bg-black/40 text-white hover:bg-black/60'
              }`}
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
            </button>

            {asset.type === 'image' && (
              <button
                onClick={(e) => { e.stopPropagation(); onCreateVideo?.(asset) }}
                className="px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors flex items-center gap-1.5 text-xs font-medium whitespace-nowrap"
              >
                <Film className="h-3 w-3" />
                Create video
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onRerender?.(asset) }}
              className="px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors flex items-center gap-1.5 text-xs font-medium whitespace-nowrap"
            >
              <RefreshCw className="h-3 w-3" />
              Re-render
            </button>
            {asset.type === 'image' && onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(asset) }}
                className="px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors flex items-center gap-1.5 text-xs font-medium whitespace-nowrap"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Bottom controls for video */}
        {asset.type === 'video' && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="px-2 py-1 rounded-lg bg-black/50 backdrop-blur-md text-white text-xs font-mono">
                {formatTime(currentTime)}
              </div>
              <button
                onClick={handleDownload}
                className="p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                className="p-1.5 rounded-lg bg-red-600/70 backdrop-blur-md text-white hover:bg-red-500 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted) }}
                className="p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
              >
                {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Bottom controls for images */}
        {asset.type === 'image' && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <button
              onClick={handleDownload}
              className="p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-1.5 rounded-lg bg-red-600/70 backdrop-blur-md text-white hover:bg-red-500 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

    </div>
  )
}

// Dropdown component for settings
function SettingsDropdown({
  trigger,
  options,
  value,
  onChange,
  title
}: {
  trigger: React.ReactNode
  options: { value: string; label: string; disabled?: boolean; tooltip?: string; icon?: React.ReactNode }[]
  value: string
  onChange: (value: string) => void
  title: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-1.5 rounded-md transition-colors ${isOpen ? 'bg-zinc-700 hover:bg-zinc-700' : 'hover:bg-zinc-800'}`}
      >
        {trigger}
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 bg-zinc-800 border border-zinc-700 rounded-md p-2 min-w-[160px] shadow-xl z-[9999]">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">{title}</div>
          <div className="space-y-1">
            {options.map(option => (
              <div key={option.value} className="relative group/option">
                <button
                  onClick={() => { if (!option.disabled) { onChange(option.value); setIsOpen(false) } }}
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-md transition-colors text-left ${
                    option.disabled
                      ? 'cursor-not-allowed'
                      : value === option.value ? 'bg-white/20 hover:bg-white/25' : 'hover:bg-zinc-700'
                  }`}
                >
                  <span className={`flex items-center gap-2.5 text-sm ${
                    option.disabled
                      ? 'text-zinc-600'
                      : value === option.value ? 'text-white' : 'text-zinc-400'
                  }`}>
                    {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                    {option.label}
                  </span>
                  {value === option.value && !option.disabled && (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                {option.disabled && option.tooltip && (
                  <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-700 rounded text-xs text-zinc-300 whitespace-nowrap opacity-0 group-hover/option:opacity-100 pointer-events-none z-[10000] transition-opacity">
                    {option.tooltip}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Lightricks brand icon
function LightricksIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M17.0073 8.18934C16.3266 5.6556 14.9346 2.06903 12.3065 2.06903C9.27204 2.06903 6.86627 7.24621 5.45487 11.7948C4.79654 13.9203 4.35877 15.9049 4.17755 17.1736C4.10214 17.5829 4.06274 18.0044 4.06274 18.4347C4.06274 22.2903 7.22553 25.4338 11.1133 25.4338C15.5206 25.4338 23.9376 22.7073 23.9376 18.4347C23.9376 17.1179 23.1376 15.948 21.9018 14.9595L21.9039 14.9575C22.4493 13.7707 22.847 12.648 23.001 11.705C23.1934 10.5053 23.0074 9.5494 22.4429 8.88217C21.7692 8.07382 20.7107 7.85572 19.6586 7.84288C18.8826 7.84288 17.9777 7.96904 17.0073 8.18934ZM8.00176 9.17083C7.6945 9.93266 7.02317 11.7419 6.70157 12.9799C7.93005 11.9987 9.2965 11.1653 10.7091 10.4796C12.2325 9.73758 13.9171 9.06448 15.518 8.58411C15.08 6.98293 13.9585 3.62158 12.3129 3.62158C11.0298 3.62158 9.41958 5.69374 8.00176 9.17083ZM20.6201 14.083L20.6209 14.0786C21.0507 13.1163 21.3522 12.2118 21.4741 11.4547C21.5511 10.9607 21.5832 10.2872 21.2752 9.89577C20.9416 9.46599 20.1975 9.39543 19.6521 9.38901C18.9932 9.38901 18.2117 9.49943 17.3641 9.69208L17.3683 9.69702C17.586 10.7217 17.7526 11.772 17.8808 12.7968C18.8527 13.16 19.7877 13.5908 20.6201 14.083ZM15.8828 10.0897C14.6739 10.4588 13.4041 10.9464 12.209 11.4846C13.4346 11.588 14.8471 11.8527 16.2581 12.2608C16.1554 11.5367 16.0273 10.8061 15.8799 10.0948L15.8828 10.0897ZM11.1133 12.9816C8.07878 12.9816 5.60884 15.4258 5.60884 18.4347C5.60884 21.4435 8.07878 23.8878 11.1133 23.8878C13.8701 23.8878 16.3653 21.6639 16.6048 18.9158C16.7011 17.7546 16.669 15.9263 16.4637 13.9311C14.6294 13.3385 12.6763 12.9816 11.1133 12.9816ZM18.3883 22.2069C17.7984 22.4697 17.1711 22.7085 16.5284 22.9184C18.0872 21.3274 19.8832 18.8193 21.1982 16.3689L21.1997 16.3654C21.9756 17.0509 22.3915 17.7593 22.3915 18.4347C22.3915 19.6985 20.9288 21.0778 18.3883 22.2069ZM19.9493 15.4655L19.9473 15.4707C19.4291 16.4567 18.8221 17.4625 18.1833 18.4092C18.2214 17.4089 18.1892 16.0386 18.0611 14.5212C18.71 14.7948 19.3456 15.1021 19.9493 15.4655Z" fill="currentColor" />
    </svg>
  )
}

// Square icon for aspect ratio
function AspectIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  )
}

// Prompt bar component — video mode only (T2V / I2V)
function PromptBar({
  mode,
  onModeChange,
  prompt,
  onPromptChange,
  onGenerate,
  onCancel,
  isGenerating,
  inputImage,
  onInputImageChange,
  settings,
  onSettingsChange,
  canGenerate,
  buttonLabel,
  buttonIcon,
  hasRtxSuperRes,
}: {
  mode: 'video' | 'retake'
  onModeChange: (mode: 'video' | 'retake') => void
  prompt: string
  onPromptChange: (prompt: string) => void
  onGenerate: () => void
  onCancel: () => void
  isGenerating: boolean
  canGenerate: boolean
  buttonLabel: string
  buttonIcon: React.ReactNode
  inputImage: string | null
  onInputImageChange: (url: string | null) => void
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
  hasRtxSuperRes?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const isRetake = mode === 'retake'

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const url = resolveImageDrop(e)
    if (url) {
      onInputImageChange(url)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      onInputImageChange(fileToFileUrl(file))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isGenerating && canGenerate) {
      e.preventDefault()
      onGenerate()
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-visible">
      {/* Top row: Image ref | Prompt | Generate */}
      <div className="flex items-start">
        {/* Input image drop zone — video mode only (I2V) */}
        {mode === 'video' && !isRetake && (
          <div
            className={`relative w-10 h-10 mx-2 mt-2 rounded-lg border-2 border-dashed transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer ${
              isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-500'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            {inputImage ? (
              <>
                <img src={inputImage} alt="" className="w-full h-full object-cover rounded-md" />
                <button
                  onClick={(e) => { e.stopPropagation(); onInputImageChange(null) }}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-white z-10"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <Image className="h-4 w-4 text-zinc-500" />
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Prompt input */}
        <div className="flex-1 min-w-0 py-1">
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'retake'
              ? "Describe what should happen in the selected section..."
              : "The woman sips from a cup of coffee..."
            }
            className="w-full bg-transparent text-white text-sm placeholder:text-zinc-500 focus:outline-none px-2 py-2 resize-none overflow-y-auto h-[70px] leading-5"
          />
        </div>

      </div>

      {/* Bottom row: Mode selector + Settings */}
      <div className="flex items-center gap-0.5 px-1.5 py-1.5 border-t border-zinc-800/60 text-xs text-zinc-400">
        {/* Mode dropdown */}
        <SettingsDropdown
          title="MODE"
          value={mode}
          onChange={(v) => onModeChange(v as 'video' | 'retake')}
          options={[
            { value: 'video', label: 'Generate Videos', icon: <Video className="h-4 w-4" /> },
            { value: 'retake', label: 'Retake', icon: <Scissors className="h-4 w-4" /> },
          ]}
          trigger={
            <>
              {mode === 'retake' ? <Scissors className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
              <span className="text-zinc-300 font-medium">{mode === 'retake' ? 'Retake' : 'Video'}</span>
              <ChevronUp className="h-3 w-3 text-zinc-500" />
            </>
          }
        />

        <div className="flex-1" />

        {isRetake ? (
          <div className="text-[10px] text-zinc-500 pr-2">Trim in the panel above, then retake</div>
        ) : (
          <>
            {/* Model indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/50">
              <LightricksIcon className="h-3.5 w-3.5" />
              <span className="text-zinc-300 font-medium">LTX via ComfyUI</span>
            </div>

            <div className="w-px h-4 bg-zinc-700 mx-0.5" />

            {/* Duration dropdown */}
            <SettingsDropdown
              title="DURATION"
              value={String(settings.duration)}
              onChange={(v) => onSettingsChange({ ...settings, duration: parseFloat(v) })}
              options={[5, 6, 8, 10, 20].map((value) => ({ value: String(value), label: `${value} Sec` }))}
              trigger={
                <>
                  <Clock className="h-3.5 w-3.5" />
                  <span>{settings.duration}s</span>
                </>
              }
            />

            {/* Resolution dropdown */}
            <SettingsDropdown
              title="RESOLUTION"
              value={settings.videoResolution}
              onChange={(v) => onSettingsChange({ ...settings, videoResolution: v })}
              options={[...(hasRtxSuperRes ? ['4K'] : []), '1080p', '720p', '540p'].map((value) => ({ value, label: value }))}
              trigger={
                <>
                  <Monitor className="h-3.5 w-3.5" />
                  <span>{settings.videoResolution.replace('p', '')}</span>
                </>
              }
            />

            <SettingsDropdown
              title="FPS"
              value={String(settings.fps)}
              onChange={(v) => onSettingsChange({ ...settings, fps: parseInt(v) })}
              options={[24, 25, 30].map((value) => ({ value: String(value), label: `${value}` }))}
              trigger={
                <>
                  <Film className="h-3.5 w-3.5" />
                  <span>{settings.fps} FPS</span>
                </>
              }
            />

            {/* Aspect Ratio dropdown */}
            <SettingsDropdown
              title="ASPECT RATIO"
              value={settings.aspectRatio || '16:9'}
              onChange={(v) => onSettingsChange({ ...settings, aspectRatio: v })}
              options={[
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
              ]}
              trigger={
                <>
                  <AspectIcon className="h-3.5 w-3.5" />
                  <span>{settings.aspectRatio || '16:9'}</span>
                </>
              }
            />

            <div className="w-px h-4 bg-zinc-700 mx-0.5" />

            {/* Spatial Upscale toggle */}
            <button
              onClick={() => onSettingsChange({ ...settings, spatialUpscale: !settings.spatialUpscale })}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                settings.spatialUpscale ? 'bg-violet-600/30 text-violet-300' : 'hover:bg-zinc-800'
              }`}
            >
              <ChevronUp className="h-3.5 w-3.5" />
              <span>2x</span>
            </button>

            {/* Temporal Upscale toggle */}
            <button
              onClick={() => onSettingsChange({ ...settings, temporalUpscale: !settings.temporalUpscale })}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                settings.temporalUpscale ? 'bg-violet-600/30 text-violet-300' : 'hover:bg-zinc-800'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              <span>2xT</span>
            </button>

          </>
        )}

        {/* Generate / Stop button */}
        {isGenerating ? (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 ml-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex-shrink-0 bg-red-600 text-white hover:bg-red-500"
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className={`flex items-center gap-1.5 ml-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex-shrink-0 ${
              !canGenerate
                ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-white text-black hover:bg-zinc-200'
            }`}
          >
            {buttonIcon}
            {buttonLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// Gallery size icon components
function GridSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="2" y="2" width="4" height="4" rx="0.5" />
      <rect x="8" y="2" width="4" height="4" rx="0.5" />
      <rect x="14" y="2" width="4" height="4" rx="0.5" />
      <rect x="20" y="2" width="2" height="4" rx="0.5" />
      <rect x="2" y="8" width="4" height="4" rx="0.5" />
      <rect x="8" y="8" width="4" height="4" rx="0.5" />
      <rect x="14" y="8" width="4" height="4" rx="0.5" />
      <rect x="20" y="8" width="2" height="4" rx="0.5" />
      <rect x="2" y="14" width="4" height="4" rx="0.5" />
      <rect x="8" y="14" width="4" height="4" rx="0.5" />
      <rect x="14" y="14" width="4" height="4" rx="0.5" />
      <rect x="20" y="14" width="2" height="4" rx="0.5" />
    </svg>
  )
}

function GridMediumIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="18" y="2" width="4" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="10" y="10" width="6" height="6" rx="1" />
      <rect x="18" y="10" width="4" height="6" rx="1" />
      <rect x="2" y="18" width="6" height="4" rx="1" />
      <rect x="10" y="18" width="6" height="4" rx="1" />
      <rect x="18" y="18" width="4" height="4" rx="1" />
    </svg>
  )
}

function GridLargeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="2" y="2" width="9" height="9" rx="1.5" />
      <rect x="13" y="2" width="9" height="9" rx="1.5" />
      <rect x="2" y="13" width="9" height="9" rx="1.5" />
      <rect x="13" y="13" width="9" height="9" rx="1.5" />
    </svg>
  )
}

type GallerySize = 'small' | 'medium' | 'large'

const gallerySizeClasses: Record<GallerySize, string> = {
  small: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7',
  medium: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  large: 'grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3',
}

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  model: 'fast',
  duration: 5,
  videoResolution: '540p',
  fps: 24,
  audio: true,
  cameraMotion: 'none',
  aspectRatio: '16:9',
  imageResolution: '1080p',
  imageAspectRatio: '16:9',
  imageSteps: 20,
}

export function GenSpace() {
  const { currentProject, currentProjectId, addAsset, addTakeToAsset, deleteAsset, toggleFavorite, syncGeneratedAssets, genSpaceEditImageUrl, setGenSpaceEditImageUrl, setGenSpaceEditMode, genSpaceRetakeSource, setGenSpaceRetakeSource, setPendingRetakeUpdate, updateProjectGenerationSettings } = useProjects()
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings()
  const [mode, setMode] = useState<'video' | 'retake'>('video')
  const [genMode, setGenMode] = useState<GenerationMode>('text-to-video')
  const [prompt, setPrompt] = useState('')
  const [inputImage, setInputImage] = useState<string | null>(null)
  const [selectedMiddleImage, setSelectedMiddleImage] = useState<string | null>(null)
  const [selectedLastImage, setSelectedLastImage] = useState<string | null>(null)
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null)
  const [firstStrength, setFirstStrength] = useState(0.7)
  const [middleStrength, setMiddleStrength] = useState(0.7)
  const [lastStrength, setLastStrength] = useState(0.7)
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(false)
  const [referenceImages, setReferenceImages] = useState<(string | null)[]>([null])
  const [localError, setLocalError] = useState<string | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashedAssets, setTrashedAssets] = useState<{ path: string; filename: string; type: string; url: string; prompt?: string; timestamp?: string }[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null) // path of asset pending permanent delete
  const [selectedTrashItem, setSelectedTrashItem] = useState<{ path: string; filename: string; type: string; url: string; prompt?: string } | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  type SortOrder = 'newest' | 'oldest' | 'favorites'
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [gallerySize, setGallerySize] = useState<GallerySize>('medium')
  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [hasRtxSuperRes, setHasRtxSuperRes] = useState(false)
  useEffect(() => {
    window.electronAPI?.getModelLists?.()
      .then((lists: { hasRtxSuperRes?: boolean }) => { if (lists.hasRtxSuperRes) setHasRtxSuperRes(true) })
      .catch(() => {})
  }, [])
  const sizeMenuRef = useRef<HTMLDivElement>(null)
  const persistedVideoKeyRef = useRef<string | null>(null)
  const retakeSubmissionRef = useRef<{
    prompt: string
    input: {
      videoPath: string | null
      startTime: number
      duration: number
      videoDuration: number
    }
  } | null>(null)
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const projectSettings = currentProject?.generationSettings
    if (projectSettings) return { ...projectSettings }
    return {
      ...DEFAULT_GENERATION_SETTINGS,
      filmGrain: appSettings.filmGrain,
      filmGrainIntensity: appSettings.filmGrainIntensity,
      filmGrainSize: appSettings.filmGrainSize,
    }
  })

  const {
    generate,
    generateImage,
    isGenerating,
    progress,
    statusMessage,
    videoUrl,
    videoPath,
    enhancedPrompt,
    imageUrl,
    error,
    cancel,
    reset,
    initiator,
  } = useGeneration()

  const {
    submitRetake,
    resetRetake,
    isRetaking,
    retakeStatus,
    retakeError,
    retakeResult,
  } = useRetake()

  const [retakeInput, setRetakeInput] = useState({
    videoUrl: null as string | null,
    videoPath: null as string | null,
    startTime: 0,
    duration: 0,
    videoDuration: 0,
    ready: false,
  })
  const [retakePanelKey, setRetakePanelKey] = useState(0)
  const [retakeInitial, setRetakeInitial] = useState<{
    videoUrl: string | null
    videoPath: string | null
    duration?: number
  }>({ videoUrl: null, videoPath: null, duration: undefined })
  const [activeRetakeSource, setActiveRetakeSource] = useState<GenSpaceRetakeSource | null>(null)

  // Handle settings change with film grain sync and project persistence
  const handleSettingsChange = useCallback((next: GenerationSettings) => {
    setSettings(next)
    if (
      next.filmGrain !== settings.filmGrain ||
      next.filmGrainIntensity !== settings.filmGrainIntensity ||
      next.filmGrainSize !== settings.filmGrainSize
    ) {
      updateAppSettings({
        filmGrain: next.filmGrain ?? false,
        filmGrainIntensity: next.filmGrainIntensity ?? 0.05,
        filmGrainSize: next.filmGrainSize ?? 1.2,
      })
    }
    if (currentProjectId) {
      updateProjectGenerationSettings(currentProjectId, next)
    }
  }, [settings, currentProjectId, updateProjectGenerationSettings, updateAppSettings])

  // Handle mode change from the panel ModeTabs
  const handleGenModeChange = (newMode: GenerationMode) => {
    setGenMode(newMode)
    if (newMode === 'retake') {
      setMode('retake')
    } else {
      setMode('video')
    }
  }

  // Force pro model when audio is attached
  useEffect(() => {
    if (selectedAudio && genMode !== 'text-to-image') {
      setSettings(prev => prev.model !== 'pro' ? { ...prev, model: 'pro' } : prev)
    }
  }, [genMode, selectedAudio])

  // Handle incoming frame from the Video Editor for editing
  useEffect(() => {
    if (genSpaceEditImageUrl) {
      setMode('video')
      setInputImage(genSpaceEditImageUrl)
      setPrompt('')
      setGenSpaceEditImageUrl(null)
      setGenSpaceEditMode(null)
    }
  }, [genSpaceEditImageUrl, setGenSpaceEditImageUrl, setGenSpaceEditMode])

  useEffect(() => {
    if (!genSpaceRetakeSource) return
    setMode('retake')
    setPrompt('')
    setActiveRetakeSource(genSpaceRetakeSource)
    setRetakeInitial({
      videoUrl: genSpaceRetakeSource.videoUrl,
      videoPath: genSpaceRetakeSource.videoPath,
      duration: genSpaceRetakeSource.duration,
    })
    setRetakePanelKey((prev) => prev + 1)
    setGenSpaceRetakeSource(null)
  }, [genSpaceRetakeSource, setGenSpaceRetakeSource])

  useEffect(() => {
    if (retakeError) {
      setLocalError(retakeError)
    }
  }, [retakeError])

  // Only show assets that were generated (have generationParams), not imported files
  const assets = (currentProject?.assets || []).filter(a => a.generationParams)
  const [lastPrompt, setLastPrompt] = useState('')

  // Sync project assets against renders.json (source of truth, reconciled against disk by backend)
  // Runs every time the project is opened — removes stale assets, adds new ones, fixes paths
  const [syncCounter, setSyncCounter] = useState(0)
  const syncedProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentProject || !currentProjectId) return
    const syncKey = `${currentProjectId}:${syncCounter}`
    if (syncedProjectRef.current === syncKey) return
    syncedProjectRef.current = syncKey

    window.electronAPI.getProjectRenders(currentProject.name).then(renders => {
      const validAssets = (renders || []).map(r => {
        const normalized = r.filePath.replace(/\\/g, '/')
        const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
        return {
          type: (r.type === 'image' ? 'image' : 'video') as 'video' | 'image',
          path: normalized,
          url: fileUrl,
          prompt: r.enhancedPrompt ?? r.prompt,
          resolution: r.resolution || '',
          duration: r.duration || 0,
          generationParams: {
            mode: (r.type === 'image' ? 'text-to-image' : 'text-to-video') as 'text-to-video' | 'text-to-image',
            prompt: r.enhancedPrompt ?? r.prompt,
            model: 'unknown' as const,
            duration: r.duration || 0,
            resolution: r.resolution || '',
            fps: r.fps || 0,
            audio: false,
            cameraMotion: r.cameraMotion || 'none',
          },
          takes: [{ url: fileUrl, path: normalized, createdAt: new Date(r.timestamp).getTime() }],
          activeTakeIndex: 0,
        }
      })
      syncGeneratedAssets(currentProjectId, validAssets)
    }).catch(err => {
      logger.error(`Failed to sync project renders: ${err}`)
    })
  }, [currentProjectId, currentProject?.name, syncGeneratedAssets, syncCounter])

  const assetSavePath = currentProject?.assetSavePath

  // When video generation completes (or an iteration completes), add to project assets
  // Only when GenSpace initiated the generation (not editor inference stacks)
  useEffect(() => {
    if (!videoUrl || !videoPath || !currentProjectId || initiator !== 'genspace') return

    const generationKey = `${videoUrl}|${videoPath}`
    if (persistedVideoKeyRef.current === generationKey) return
    persistedVideoKeyRef.current = generationKey

    const genMode = inputImage ? 'image-to-video' : 'text-to-video'

    ;(async () => {
      try {
        const { path: finalPath, url: finalUrl } = await copyToAssetFolder(videoPath, videoUrl, assetSavePath)
        addAsset(currentProjectId, {
          type: 'video',
          path: finalPath,
          url: finalUrl,
          prompt: enhancedPrompt ?? lastPrompt,
          resolution: settings.videoResolution,
          duration: settings.duration,
          generationParams: {
            mode: genMode as 'text-to-video' | 'image-to-video',
            prompt: enhancedPrompt ?? lastPrompt,
            model: settings.model,
            duration: settings.duration,
            resolution: settings.videoResolution,
            fps: settings.fps,
            audio: settings.audio,
            cameraMotion: settings.cameraMotion,
            inputImageUrl: inputImage || undefined,
            inputAudioUrl: selectedAudio || undefined,
          },
          takes: [{
            url: finalUrl,
            path: finalPath,
            createdAt: Date.now(),
          }],
          activeTakeIndex: 0,
        })
        // Only reset generation state after the final iteration
        if (!isGenerating) {
          reset()
        }
      } catch (err) {
        persistedVideoKeyRef.current = null
        logger.error(`Failed to persist generated video asset: ${err}`)
      }
    })()
  }, [videoUrl, videoPath, currentProjectId, isGenerating, settings, inputImage, selectedAudio, assetSavePath, lastPrompt, enhancedPrompt, addAsset, reset, initiator])

  // When image generation completes, add to project assets
  // Only when GenSpace initiated the generation (not editor)
  const persistedImageKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!imageUrl || !currentProjectId || isGenerating || initiator !== 'genspace') return

    if (persistedImageKeyRef.current === imageUrl) return
    persistedImageKeyRef.current = imageUrl

    const imagePath = fileUrlToPath(imageUrl) || imageUrl
    addAsset(currentProjectId, {
      type: 'image',
      path: imagePath,
      url: imageUrl,
      prompt: enhancedPrompt ?? lastPrompt,
      resolution: settings.imageResolution || '1080p',
      generationParams: {
        mode: 'text-to-image',
        prompt: enhancedPrompt ?? lastPrompt,
        model: settings.model,
        duration: 0,
        resolution: settings.imageResolution || '1080p',
        fps: 0,
        audio: false,
        cameraMotion: 'none',
        imageAspectRatio: settings.imageAspectRatio,
        imageSteps: settings.imageSteps,
      },
    })
    reset()
  }, [imageUrl, currentProjectId, isGenerating, settings, lastPrompt, enhancedPrompt, addAsset, reset, initiator])

  // When retake completes, add as take or new asset
  useEffect(() => {
    if (!retakeResult || !currentProjectId || isRetaking) return
    const submission = retakeSubmissionRef.current
    if (!submission) return
    retakeSubmissionRef.current = null

    ;(async () => {
      const usedPrompt = submission.prompt
      const usedInput = submission.input
      const { path: finalPath, url: finalUrl } = await copyToAssetFolder(retakeResult.videoPath, retakeResult.videoUrl, assetSavePath)

      if (activeRetakeSource?.assetId) {
        const sourceAsset = currentProject?.assets?.find(a => a.id === activeRetakeSource.assetId)
        if (sourceAsset) {
          const newTakeIndex = sourceAsset.takes ? sourceAsset.takes.length : 1
          addTakeToAsset(currentProjectId, sourceAsset.id, {
            url: finalUrl,
            path: finalPath,
            createdAt: Date.now(),
          })
          if (activeRetakeSource.linkedClipIds?.length) {
            setPendingRetakeUpdate({
              assetId: sourceAsset.id,
              clipIds: activeRetakeSource.linkedClipIds,
              newTakeIndex,
            })
          }
        }
      } else {
        addAsset(currentProjectId, {
          type: 'video',
          path: finalPath,
          url: finalUrl,
          prompt: usedPrompt,
          resolution: '',
          duration: usedInput.duration,
          generationParams: {
            mode: 'retake',
            prompt: usedPrompt,
            model: 'fast',
            duration: usedInput.duration,
            resolution: '',
            fps: 24,
            audio: false,
            cameraMotion: 'none',
            retakeVideoPath: finalPath,
            retakeStartTime: usedInput.startTime,
            retakeDuration: usedInput.duration,
            retakeMode: 'replace_audio_and_video',
          },
          takes: [{ url: finalUrl, path: finalPath, createdAt: Date.now() }],
          activeTakeIndex: 0,
        })
        setMode('video')
      }

      setActiveRetakeSource(null)
      resetRetake()
    })()
  }, [retakeResult, isRetaking, currentProjectId, currentProject?.assets, activeRetakeSource, addAsset, addTakeToAsset, assetSavePath, setPendingRetakeUpdate, resetRetake])

  const handleGenerate = async () => {
    if (mode === 'retake') {
      if (!retakeInput.videoPath || retakeInput.duration < 2) return
      retakeSubmissionRef.current = {
        prompt,
        input: {
          videoPath: retakeInput.videoPath,
          startTime: retakeInput.startTime,
          duration: retakeInput.duration,
          videoDuration: retakeInput.videoDuration,
        },
      }
      await submitRetake({
        videoPath: retakeInput.videoPath,
        startTime: retakeInput.startTime,
        duration: retakeInput.duration,
        prompt,
        mode: 'replace_audio_and_video',
      })
      return
    }

    if (!prompt.trim()) return

    // Save the prompt before generation starts
    setLastPrompt(prompt)

    if (genMode === 'text-to-image') {
      const refPaths = referenceImages
        .filter((img): img is string => img != null)
        .map(img => fileUrlToPath(img))
        .filter((p): p is string => p != null)
      generateImage(prompt, settings, null, undefined, currentProject?.name, refPaths.length > 0 ? refPaths : undefined, 'genspace')
      return
    }

    // Generate video (t2v if no image, i2v if image)
    const imagePath = inputImage ? fileUrlToPath(inputImage) : null
    const middleImagePath = selectedMiddleImage ? fileUrlToPath(selectedMiddleImage) : null
    const lastImagePath = selectedLastImage ? fileUrlToPath(selectedLastImage) : null
    const audioPath = selectedAudio ? fileUrlToPath(selectedAudio) : null
    const effectiveSettings = { ...settings }
    if (audioPath) effectiveSettings.model = 'pro'

    generate(
      prompt,
      imagePath,
      effectiveSettings,
      audioPath,
      middleImagePath,
      lastImagePath,
      {
        first: firstStrength,
        middle: middleStrength,
        last: lastStrength,
      },
      currentProject?.name,
      preserveAspectRatio,
      'genspace',
    )
  }

  const handleDelete = async (asset: Asset) => {
    if (!currentProjectId) return
    // Move file to _old folder — await to ensure renders.json is updated before any sync
    if (asset.path) {
      await window.electronAPI.archiveAsset(asset.path)
    }
    deleteAsset(currentProjectId, asset.id)
  }

  const loadTrash = useCallback(async () => {
    if (!currentProject?.name || !appSettings.comfyuiOutputDir) return
    const safePN = currentProject.name.replace(/[<>:"/\\|?*]/g, '_')
    const projectDir = `${appSettings.comfyuiOutputDir.replace(/\\/g, '/')}/${safePN}`
    const items = await window.electronAPI.listTrashedAssets(projectDir)
    setTrashedAssets(items)
  }, [currentProject?.name, appSettings.comfyuiOutputDir])

  const handleToggleTrash = useCallback(() => {
    if (!showTrash) loadTrash()
    setShowTrash(prev => !prev)
    setShowFavorites(false)
  }, [showTrash, loadTrash])

  const handleRestore = useCallback(async (filePath: string) => {
    await window.electronAPI.restoreAsset(filePath)
    setTrashedAssets(prev => prev.filter(a => a.path !== filePath))
    setSelectedTrashItem(null)
    // Force re-sync so restored file appears in the gallery
    setSyncCounter(c => c + 1)
  }, [])

  const handlePermanentDelete = useCallback(async (filePath: string) => {
    await window.electronAPI.deleteAssetPermanently(filePath)
    setTrashedAssets(prev => prev.filter(a => a.path !== filePath))
    setConfirmDelete(null)
    setSelectedTrashItem(null)
  }, [])

  const handleDragStart = (e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData('asset', JSON.stringify(asset))
    e.dataTransfer.setData('assetId', asset.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleEdit = (imageAsset: Asset) => {
    setGenMode('text-to-image')
    setMode('video')
    // Load the image as the first reference image
    setReferenceImages([imageAsset.url, null])
    if (imageAsset.prompt) setPrompt(imageAsset.prompt)
    setIsPanelOpen(true)
  }

  const handleCreateVideo = (imageAsset: Asset) => {
    setMode('video')
    setInputImage(imageAsset.url)
    setPrompt(`${imageAsset.prompt || 'The scene comes to life...'}`)
  }

  const handleRerender = async (asset: Asset) => {
    if (!currentProject || isGenerating) return
    // Look up render entry from .renders.json by filename
    const filename = asset.path.replace(/\\/g, '/').split('/').pop() || ''
    const renders = await window.electronAPI.getProjectRenders(currentProject.name)
    const entry = renders.find(r => r.filename === filename)

    // Use render entry settings if available, fall back to asset's generationParams
    const p = entry || asset.generationParams
    if (!p) return

    // Use the original (un-enhanced) prompt so promptEnhance can re-run with the same settings
    const rerenderPrompt = entry?.prompt || asset.prompt

    // Build effective settings from the render entry
    const effectiveResolution = entry?.rtxSuperRes ? '4K' : (entry?.resolution || settings.videoResolution)
    const rerenderSettings = { ...settings, ...(entry ? {
      videoResolution: effectiveResolution,
      duration: entry.duration || settings.duration,
      fps: entry.fps || settings.fps,
      cameraMotion: entry.cameraMotion || settings.cameraMotion,
      aspectRatio: entry.aspectRatio || settings.aspectRatio,
      spatialUpscale: entry.spatialUpscale ?? settings.spatialUpscale,
      temporalUpscale: entry.temporalUpscale ?? settings.temporalUpscale,
      filmGrain: entry.filmGrain ?? settings.filmGrain,
      promptEnhance: entry.promptEnhance ?? settings.promptEnhance,
    } : asset.generationParams ? {
      videoResolution: asset.generationParams.resolution || settings.videoResolution,
      duration: asset.generationParams.duration || settings.duration,
      fps: asset.generationParams.fps || settings.fps,
      cameraMotion: asset.generationParams.cameraMotion || settings.cameraMotion,
    } : {}) }

    // Update UI to reflect what's being re-rendered
    setPrompt(rerenderPrompt)
    handleSettingsChange(rerenderSettings)

    // Fill in the seed from the original render (user can lock it to reproduce)
    if (entry?.seed != null) {
      updateAppSettings({ lockedSeed: entry.seed })
    }

    // Restore injected images and audio in UI
    const toFileUrl = (p: string | null | undefined) => {
      if (!p) return null
      const normalized = p.replace(/\\/g, '/')
      return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
    }
    const firstImg = entry?.imagePath || null
    const middleImg = entry?.middleImagePath || null
    const lastImg = entry?.lastImagePath || null
    const audioFile = entry?.audioPath || null
    const fStrength = entry?.firstStrength ?? 1
    const mStrength = entry?.middleStrength ?? 1
    const lStrength = entry?.lastStrength ?? 1
    const preserveAR = entry?.preserveAspectRatio ?? false

    setInputImage(toFileUrl(firstImg))
    setSelectedMiddleImage(toFileUrl(middleImg))
    setSelectedLastImage(toFileUrl(lastImg))
    setSelectedAudio(toFileUrl(audioFile))
    setFirstStrength(fStrength)
    setMiddleStrength(mStrength)
    setLastStrength(lStrength)
    setPreserveAspectRatio(preserveAR)

    // Close the preview modal
    setSelectedAsset(null)

    // Image assets: re-render as image generation
    // Use the stored prompt (already enhanced if it was) and disable promptEnhance to avoid double-enhancement
    if (asset.type === 'image') {
      const imagePrompt = asset.prompt || rerenderPrompt
      const imageSettings = { ...rerenderSettings, promptEnhance: false }
      setGenMode('text-to-image')
      setMode('video')
      setPrompt(imagePrompt)
      handleSettingsChange(imageSettings)
      generateImage(imagePrompt, imageSettings, null, undefined, currentProject.name, undefined, 'genspace')
      return
    }

    // Force model to pro if audio is present
    const finalSettings = audioFile ? { ...rerenderSettings, model: 'pro' as const } : rerenderSettings

    // Actually trigger generation with stored values (don't rely on React state)
    generate(
      rerenderPrompt,
      firstImg,
      finalSettings,
      audioFile,
      middleImg,
      lastImg,
      { first: fStrength, middle: mStrength, last: lStrength },
      currentProject.name,
      preserveAR,
      'genspace',
    )
  }

  const isRetakeMode = mode === 'retake'
  const isVideoMode = genMode === 'text-to-video' || genMode === 'image-to-video'
  const isBusy = isRetakeMode ? isRetaking : isGenerating
  const canSubmit = isRetakeMode
    ? retakeInput.ready && !!retakeInput.videoPath && !isRetaking
    : !!prompt.trim()
  const promptButtonLabel = isRetakeMode ? 'Retake' : 'Generate'
  const promptButtonIcon = isRetakeMode
    ? <Scissors className="h-3.5 w-3.5" />
    : <Sparkles className={`h-3.5 w-3.5 ${isGenerating ? 'animate-pulse' : ''}`} />
  const promptGenerating = isRetakeMode ? isRetaking : isGenerating

  // Close size menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sizeMenuRef.current && !sizeMenuRef.current.contains(e.target as Node)) {
        setShowSizeMenu(false)
      }
    }
    if (showSizeMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSizeMenu])

  const sortedAssets = [...assets].sort((a, b) => {
    if (sortOrder === 'favorites') {
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
    }
    // Use take timestamp (from render) if available, fall back to asset createdAt
    const timeA = a.takes?.[0]?.createdAt || a.createdAt || 0
    const timeB = b.takes?.[0]?.createdAt || b.createdAt || 0
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
  })
  const filteredAssets = showFavorites ? sortedAssets.filter(a => a.favorite) : sortedAssets
  const favoriteCount = assets.filter(a => a.favorite).length

  // Navigation for the asset preview modal
  const selectedIndex = selectedAsset ? filteredAssets.findIndex(a => a.id === selectedAsset.id) : -1
  const canGoPrev = selectedIndex > 0
  const canGoNext = selectedIndex >= 0 && selectedIndex < filteredAssets.length - 1

  const goToPrev = useCallback(() => {
    if (canGoPrev) setSelectedAsset(filteredAssets[selectedIndex - 1])
  }, [canGoPrev, filteredAssets, selectedIndex])

  const goToNext = useCallback(() => {
    if (canGoNext) setSelectedAsset(filteredAssets[selectedIndex + 1])
  }, [canGoNext, filteredAssets, selectedIndex])

  // Keyboard navigation for the preview modal
  useEffect(() => {
    if (!selectedAsset) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToNext() }
      else if (e.key === 'Escape') setSelectedAsset(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedAsset, goToPrev, goToNext])

  return (
    <div className="h-full relative bg-zinc-950">

      {/* Hamburger button — left edge */}
      <button
        onClick={() => setIsPanelOpen(true)}
        className="absolute top-4 left-4 z-30 p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors backdrop-blur-sm"
        title="Advanced Settings"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Slide-out panel backdrop */}
      {isPanelOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsPanelOpen(false)}
        />
      )}

      {/* Slide-out settings panel */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-50 w-[500px] bg-zinc-900 border-r border-zinc-700 shadow-2xl transform transition-transform duration-300 ease-in-out ${
          isPanelOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-white">Advanced Settings</h2>
            <button
              onClick={() => setIsPanelOpen(false)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Mode Tabs */}
            <ModeTabs
              mode={genMode}
              onModeChange={handleGenModeChange}
              disabled={isBusy}
            />

            {/* Image uploaders - shown in video modes */}
            {isVideoMode && (
              <>
                <ImageUploader
                  label="First Frame"
                  selectedImage={inputImage}
                  onImageSelect={setInputImage}
                  strength={firstStrength}
                  onStrengthChange={setFirstStrength}
                  projectImages={assets.filter(a => a.type === 'image').map(a => ({ url: a.url, path: a.path }))}
                />

                <ImageUploader
                  label="Middle Frame"
                  selectedImage={selectedMiddleImage}
                  onImageSelect={setSelectedMiddleImage}
                  strength={middleStrength}
                  onStrengthChange={setMiddleStrength}
                  projectImages={assets.filter(a => a.type === 'image').map(a => ({ url: a.url, path: a.path }))}
                />

                <ImageUploader
                  label="Last Frame"
                  selectedImage={selectedLastImage}
                  onImageSelect={setSelectedLastImage}
                  strength={lastStrength}
                  onStrengthChange={setLastStrength}
                  projectImages={assets.filter(a => a.type === 'image').map(a => ({ url: a.url, path: a.path }))}
                />

                <AudioUploader
                  selectedAudio={selectedAudio}
                  onAudioSelect={setSelectedAudio}
                />

                {(inputImage || selectedMiddleImage || selectedLastImage) && (
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={preserveAspectRatio}
                      onChange={(e) => setPreserveAspectRatio(e.target.checked)}
                      className="rounded border-zinc-600 bg-zinc-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    Preserve aspect ratio
                  </label>
                )}
              </>
            )}

            {/* Reference Images - shown in text-to-image mode when Gemini is the image generator */}
            {genMode === 'text-to-image' && (settings.imageGenerator ?? appSettings.imageGenerator) === 'gemini' && (
              <div className="space-y-2">
                <label className="block text-[12px] font-semibold text-zinc-500 uppercase leading-4">
                  Reference Images
                </label>
                <p className="text-xs text-zinc-500">Add up to 6 reference images to guide Gemini generation</p>
                {referenceImages.map((img, idx) => (
                  <ImageUploader
                    key={idx}
                    label={`Reference ${idx + 1}`}
                    selectedImage={img}
                    projectImages={assets.filter(a => a.type === 'image').map(a => ({ url: a.url, path: a.path }))}
                    onImageSelect={(path) => {
                      setReferenceImages(prev => {
                        const next = [...prev]
                        next[idx] = path
                        if (path && idx === prev.length - 1 && prev.length < 6) {
                          next.push(null)
                        }
                        if (!path) {
                          while (next.length > 1 && next[next.length - 1] === null && idx !== next.length - 1) {
                            next.pop()
                          }
                          if (next.every((v, i) => i <= idx || v === null)) {
                            let lastFilled = -1
                            for (let j = next.length - 1; j >= 0; j--) { if (next[j] !== null) { lastFilled = j; break } }
                            next.length = Math.min(6, Math.max(1, lastFilled + 2))
                          }
                        }
                        return next.length === 0 ? [null] : next
                      })
                    }}
                  />
                ))}
              </div>
            )}

            {/* Prompt */}
            <Textarea
              label="Prompt"
              placeholder="Write a prompt..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              helperText="Longer, detailed prompts lead to better, more accurate results."
              charCount={prompt.length}
              maxChars={5000}
              disabled={isBusy}
            />

            {/* Settings Panel */}
            {genMode !== 'retake' && (
              <SettingsPanel
                settings={settings}
                onSettingsChange={handleSettingsChange}
                disabled={isBusy}
                mode={genMode}
                hasAudio={!!selectedAudio}
              />
            )}

            {/* Generate / Cancel buttons */}
            {isGenerating ? (
              <button
                onClick={() => { cancel(); setIsPanelOpen(false) }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-red-600 hover:bg-red-500 text-white"
              >
                <Square className="h-4 w-4" />
                Stop Generation
              </button>
            ) : (
              <button
                onClick={() => { handleGenerate(); setIsPanelOpen(false) }}
                disabled={!canSubmit}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  !canSubmit
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                {genMode === 'text-to-image' ? 'Generate Image' : 'Generate Video'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {mode !== 'retake' && assets.length === 0 && !isGenerating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-zinc-700 flex items-center justify-center mb-4">
            <Sparkles className="h-10 w-10 text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Start Creating</h3>
          <p className="text-zinc-500 max-w-md">
            Use the prompt bar below to generate videos.
            Drag images into the input box to use them as references for I2V.
          </p>
        </div>
      )}

      {/* No favorites empty state */}
      {mode !== 'retake' && showFavorites && filteredAssets.length === 0 && assets.length > 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <Heart className="h-12 w-12 text-zinc-700 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No favorites yet</h3>
          <p className="text-zinc-500 text-sm">
            Click the heart icon on any asset to add it to your favorites.
          </p>
        </div>
      )}

      {/* Assets area */}
      {mode !== 'retake' && (assets.length > 0 || isGenerating) && (
        <div className="absolute inset-x-0 top-0 bottom-[160px] flex flex-col px-4 pt-4">
          {/* Top bar */}
          <div className="flex items-center justify-end pb-2 gap-2">
            <button
              onClick={handleToggleTrash}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                showTrash
                  ? 'bg-zinc-600/30 text-zinc-300 border border-zinc-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <Trash2 className="h-4 w-4" />
              Trash
            </button>
            <button
              onClick={() => { setShowFavorites(!showFavorites); if (showTrash) setShowTrash(false) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                showFavorites
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <Heart className={`h-4 w-4 ${showFavorites ? 'fill-current' : ''}`} />
              Favorites
              {favoriteCount > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  showFavorites ? 'bg-red-500/30 text-red-300' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {favoriteCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : prev === 'oldest' ? 'favorites' : 'newest')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-zinc-400 hover:text-white hover:bg-zinc-800"
              title={`Sort: ${sortOrder === 'newest' ? 'Newest first' : sortOrder === 'oldest' ? 'Oldest first' : 'Favorites first'}`}
            >
              <ArrowUpDown className="h-4 w-4" />
              {sortOrder === 'newest' ? 'Newest' : sortOrder === 'oldest' ? 'Oldest' : 'Favorites'}
            </button>

            <div ref={sizeMenuRef} className="relative">
              <button
                onClick={() => setShowSizeMenu(!showSizeMenu)}
                className={`p-2 rounded-md transition-colors ${
                  showSizeMenu ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {gallerySize === 'small' ? <GridSmallIcon className="h-4 w-4" /> :
                 gallerySize === 'medium' ? <GridMediumIcon className="h-4 w-4" /> :
                 <GridLargeIcon className="h-4 w-4" />}
              </button>

              {showSizeMenu && (
                <div className="absolute top-full mt-2 right-0 bg-zinc-800 border border-zinc-700 rounded-md p-2 min-w-[160px] shadow-xl z-50">
                  {([
                    { value: 'small' as GallerySize, label: 'Small', icon: GridSmallIcon },
                    { value: 'medium' as GallerySize, label: 'Medium', icon: GridMediumIcon },
                    { value: 'large' as GallerySize, label: 'Large', icon: GridLargeIcon },
                  ]).map(option => (
                    <button
                      key={option.value}
                      onClick={() => { setGallerySize(option.value); setShowSizeMenu(false) }}
                      className={`w-full flex items-center justify-between px-2 py-2.5 rounded-md transition-colors text-left ${gallerySize === option.value ? 'bg-white/20 hover:bg-white/25' : 'hover:bg-zinc-700'}`}
                    >
                      <div className="flex items-center gap-3">
                        <option.icon className={`h-4 w-4 ${gallerySize === option.value ? 'text-white' : 'text-zinc-500'}`} />
                        <span className={`text-sm ${gallerySize === option.value ? 'text-white font-medium' : 'text-zinc-400'}`}>
                          {option.label}
                        </span>
                      </div>
                      {gallerySize === option.value && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Assets grid / Trash view */}
          <div className="overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] flex-1">
            {showTrash ? (
              trashedAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Trash2 className="h-12 w-12 text-zinc-700 mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">Trash is empty</h3>
                  <p className="text-zinc-500 text-sm">Deleted assets will appear here.</p>
                </div>
              ) : (
                <div className={`grid ${gallerySizeClasses[gallerySize]} gap-4`}>
                  {trashedAssets.map((item) => (
                    <div
                      key={item.path}
                      className="relative group rounded-xl overflow-hidden bg-zinc-900 cursor-pointer"
                      onClick={() => setSelectedTrashItem(item)}
                    >
                      {item.type === 'video' ? (
                        <video src={item.url} className="w-full aspect-video object-contain" muted />
                      ) : (
                        <img src={item.url} alt="" className="w-full aspect-video object-contain" />
                      )}
                      {/* Dimmed overlay to indicate trashed state */}
                      <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 transition-colors" />
                      {/* Filename + prompt */}
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-xs text-zinc-300 truncate">{item.filename}</p>
                        {item.prompt && <p className="text-xs text-zinc-500 truncate">{item.prompt}</p>}
                      </div>
                      {/* Hover action buttons */}
                      <div className="absolute top-2 left-2 right-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRestore(item.path) }}
                          className="px-2.5 py-1.5 rounded-lg bg-green-600/70 backdrop-blur-md text-white hover:bg-green-500 transition-colors flex items-center gap-1.5 text-xs font-medium"
                          title="Restore"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Restore
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(item.path) }}
                          className="p-1.5 rounded-lg bg-red-600/70 backdrop-blur-md text-white hover:bg-red-500 transition-colors"
                          title="Delete permanently"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className={`grid ${gallerySizeClasses[gallerySize]} gap-4`}>
                {isGenerating && (
                  <div className="relative rounded-xl overflow-hidden bg-zinc-800 aspect-video">
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="relative w-16 h-16 mb-3">
                        <div className="absolute inset-0 rounded-full border-2 border-violet-500/30" />
                        <div className="absolute inset-0 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
                        <div className="absolute inset-2 rounded-full bg-zinc-800 flex items-center justify-center">
                          <Sparkles className="h-6 w-6 text-violet-400" />
                        </div>
                      </div>
                      <p className="text-sm text-zinc-400">{statusMessage || 'Generating...'}</p>
                      {progress > 0 && (
                        <div className="w-32 h-1 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                          <div className="h-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {filteredAssets.map(asset => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onDelete={() => handleDelete(asset)}
                    onPlay={() => setSelectedAsset(asset)}
                    onDragStart={handleDragStart}
                    onCreateVideo={handleCreateVideo}
                    onRerender={handleRerender}
                    onEdit={handleEdit}
                    onToggleFavorite={() => currentProjectId && toggleFavorite(currentProjectId, asset.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Permanent delete confirmation dialog */}
          {confirmDelete && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(null)}>
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-white mb-2">Delete permanently?</h3>
                <p className="text-sm text-zinc-400 mb-4">
                  This file will be permanently deleted and cannot be recovered.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handlePermanentDelete(confirmDelete)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 transition-colors"
                  >
                    Delete forever
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'retake' && (
        <div className="absolute inset-x-0 top-0 bottom-[160px] px-4 pt-4 pb-4 flex flex-col overflow-hidden">
          <RetakePanel
            initialVideoUrl={retakeInitial.videoUrl}
            initialVideoPath={retakeInitial.videoPath}
            initialDuration={retakeInitial.duration}
            resetKey={retakePanelKey}
            fillHeight
            isProcessing={isRetaking}
            processingStatus={retakeStatus}
            onChange={(data) => setRetakeInput(data)}
          />
        </div>
      )}

      {/* Floating prompt panel */}
      <div className="absolute bottom-5 left-1/2 w-[min(700px,calc(100%-2rem))] -translate-x-1/2">
        <PromptBar
          mode={mode}
          onModeChange={(m) => {
            setMode(m)
            setGenMode(m === 'retake' ? 'retake' : 'text-to-video')
          }}
          prompt={prompt}
          onPromptChange={setPrompt}
          onGenerate={handleGenerate}
          onCancel={cancel}
          isGenerating={promptGenerating}
          canGenerate={canSubmit}
          buttonLabel={promptButtonLabel}
          buttonIcon={promptButtonIcon}
          inputImage={inputImage}
          onInputImageChange={setInputImage}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          hasRtxSuperRes={hasRtxSuperRes}
        />
      </div>

      {/* Asset preview modal */}
      {selectedAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setSelectedAsset(null)}
        >
          {/* Previous button */}
          <button
            onClick={(e) => { e.stopPropagation(); goToPrev() }}
            disabled={!canGoPrev}
            className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full backdrop-blur-md transition-all ${
              canGoPrev
                ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                : 'bg-white/5 text-zinc-600 cursor-default'
            }`}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Next button */}
          <button
            onClick={(e) => { e.stopPropagation(); goToNext() }}
            disabled={!canGoNext}
            className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full backdrop-blur-md transition-all ${
              canGoNext
                ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                : 'bg-white/5 text-zinc-600 cursor-default'
            }`}
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* Content area */}
          <div className="relative max-w-5xl w-full max-h-full px-20 py-8" onClick={e => e.stopPropagation()}>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-zinc-500 font-medium">
                {selectedIndex + 1} / {filteredAssets.length}
              </span>
              <button
                onClick={() => setSelectedAsset(null)}
                className="p-2 rounded-md text-zinc-400 hover:text-white transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {selectedAsset.type === 'video' ? (
              <video
                key={selectedAsset.id}
                src={selectedAsset.url}
                controls
                autoPlay
                className="w-full rounded-xl object-contain max-h-[75vh]"
              />
            ) : (
              <img
                key={selectedAsset.id}
                src={selectedAsset.url}
                alt=""
                className="w-full rounded-xl object-contain max-h-[75vh]"
              />
            )}
            <div className="mt-4 text-center">
              <div className="inline-flex items-start gap-2 max-w-full">
                <p className="text-zinc-300">{selectedAsset.prompt}</p>
                {selectedAsset.prompt && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedAsset.prompt)
                      setCopiedPrompt(true)
                      setTimeout(() => setCopiedPrompt(false), 2000)
                    }}
                    className="shrink-0 p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    title="Copy prompt"
                  >
                    {copiedPrompt ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                )}
              </div>
              <p className="text-zinc-500 text-sm mt-1">
                {selectedAsset.resolution} {selectedAsset.duration ? `${selectedAsset.duration}s` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Trash item preview modal */}
      {selectedTrashItem && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setSelectedTrashItem(null)}
        >
          {/* Navigation through trash items */}
          {(() => {
            const trashIdx = trashedAssets.findIndex(t => t.path === selectedTrashItem.path)
            const canPrevTrash = trashIdx > 0
            const canNextTrash = trashIdx < trashedAssets.length - 1
            return (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); if (canPrevTrash) setSelectedTrashItem(trashedAssets[trashIdx - 1]) }}
                  disabled={!canPrevTrash}
                  className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full backdrop-blur-md transition-all ${
                    canPrevTrash ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer' : 'bg-white/5 text-zinc-600 cursor-default'
                  }`}
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); if (canNextTrash) setSelectedTrashItem(trashedAssets[trashIdx + 1]) }}
                  disabled={!canNextTrash}
                  className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full backdrop-blur-md transition-all ${
                    canNextTrash ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer' : 'bg-white/5 text-zinc-600 cursor-default'
                  }`}
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )
          })()}

          <div className="relative max-w-5xl w-full max-h-full px-20 py-8" onClick={e => e.stopPropagation()}>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleRestore(selectedTrashItem.path)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600/80 text-white hover:bg-green-500 transition-colors text-sm font-medium"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </button>
                <button
                  onClick={() => setConfirmDelete(selectedTrashItem.path)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/80 text-white hover:bg-red-500 transition-colors text-sm font-medium"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete forever
                </button>
              </div>
              <button
                onClick={() => setSelectedTrashItem(null)}
                className="p-2 rounded-md text-zinc-400 hover:text-white transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {selectedTrashItem.type === 'video' ? (
              <video
                key={selectedTrashItem.path}
                src={selectedTrashItem.url}
                controls
                autoPlay
                className="w-full rounded-xl object-contain max-h-[75vh]"
              />
            ) : (
              <img
                key={selectedTrashItem.path}
                src={selectedTrashItem.url}
                alt=""
                className="w-full rounded-xl object-contain max-h-[75vh]"
              />
            )}
            <div className="mt-4 text-center">
              {selectedTrashItem.prompt && (
                <div className="inline-flex items-start gap-2 max-w-full">
                  <p className="text-zinc-300">{selectedTrashItem.prompt}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedTrashItem.prompt!)
                      setCopiedPrompt(true)
                      setTimeout(() => setCopiedPrompt(false), 2000)
                    }}
                    className="shrink-0 p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    title="Copy prompt"
                  >
                    {copiedPrompt ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              )}
              <p className="text-zinc-500 text-sm mt-1">{selectedTrashItem.filename}</p>
            </div>
          </div>
        </div>
      )}

      {(error || localError) && (
        <GenerationErrorDialog
          error={(error || localError)!}
          onDismiss={() => { if (error) reset(); if (localError) { setLocalError(null); resetRetake() } }}
        />
      )}
    </div>
  )
}
