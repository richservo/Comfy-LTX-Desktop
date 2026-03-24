import { useState, useRef, useEffect } from 'react'
import { Sparkles, Trash2, Square, ImageIcon, ArrowLeft, Scissors, Upload } from 'lucide-react'
import { logger } from '../lib/logger'
import { ImageUploader } from '../components/ImageUploader'
import { AudioUploader } from '../components/AudioUploader'
import { VideoPlayer } from '../components/VideoPlayer'
import { ImageResult } from '../components/ImageResult'
import { SettingsPanel, type GenerationSettings } from '../components/SettingsPanel'
import { ModeTabs, type GenerationMode } from '../components/ModeTabs'
import { LtxLogo } from '../components/LtxLogo'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { useGeneration } from '../contexts/GenerationContext'
import { useRetake } from '../hooks/use-retake'
import { useBackend } from '../hooks/use-backend'
import { useProjects } from '../contexts/ProjectContext'
import { useAppSettings } from '../contexts/AppSettingsContext'
import { fileUrlToPath } from '../lib/url-to-path'
import { RetakePanel } from '../components/RetakePanel'

const DEFAULT_SETTINGS: GenerationSettings = {
  model: 'fast',
  duration: 5,
  videoResolution: '540p',
  fps: 24,
  audio: true,
  cameraMotion: 'none',
  aspectRatio: '16:9',
  // Image settings
  imageResolution: '1080p',
  imageAspectRatio: '16:9',
  imageSteps: 20,
}

export function Playground() {
  const { goHome } = useProjects()
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings()
  const [mode, setMode] = useState<GenerationMode>('text-to-video')
  const [prompt, setPrompt] = useState('')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedMiddleImage, setSelectedMiddleImage] = useState<string | null>(null)
  const [selectedLastImage, setSelectedLastImage] = useState<string | null>(null)
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null)
  const [firstStrength, setFirstStrength] = useState(0.7)
  const [middleStrength, setMiddleStrength] = useState(0.7)
  const [lastStrength, setLastStrength] = useState(0.7)
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(false)
  const [referenceImages, setReferenceImages] = useState<(string | null)[]>([null])
  const [settings, setSettings] = useState<GenerationSettings>(() => ({
    ...DEFAULT_SETTINGS,
    filmGrain: appSettings.filmGrain,
    filmGrainIntensity: appSettings.filmGrainIntensity,
    filmGrainSize: appSettings.filmGrainSize,
    imageGenerator: appSettings.imageGenerator,
  }))

  const { status } = useBackend()

  const handleSettingsChange = (next: GenerationSettings) => {
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
  }

  // Force pro model when audio is attached (A2V only supports pro)
  useEffect(() => {
    if (selectedAudio && mode !== 'text-to-image') {
      setSettings(prev => prev.model !== 'pro' ? { ...prev, model: 'pro' } : prev)
    }
  }, [mode, selectedAudio])

  // Handle mode change
  const handleModeChange = (newMode: GenerationMode) => {
    setMode(newMode)
  }
  const { 
    isGenerating, 
    progress, 
    statusMessage, 
    videoUrl,
    videoPath,
    imageUrl, 
    error: generationError,
    generate,
    generateImage,
    cancel,
    reset,
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
  
  // Ref to store generated image URL for "Create video" flow
  const generatedImageRef = useRef<string | null>(null)

  const handleGenerate = () => {
    if (mode === 'retake') {
      if (!retakeInput.videoPath || retakeInput.duration < 2) return
      submitRetake({
        videoPath: retakeInput.videoPath,
        startTime: retakeInput.startTime,
        duration: retakeInput.duration,
        prompt,
        mode: 'replace_audio_and_video',
      })
      return
    }

    if (mode === 'text-to-image') {
      if (!prompt.trim()) return
      const refPaths = referenceImages
        .filter((img): img is string => img != null)
        .map(img => fileUrlToPath(img))
        .filter((p): p is string => p != null)
      generateImage(prompt, settings, null, undefined, undefined, refPaths.length > 0 ? refPaths : undefined)
    } else {
      // Auto-detect: if image is loaded → I2V, otherwise → T2V
      if (!prompt.trim()) return
      const imagePath = selectedImage ? fileUrlToPath(selectedImage) : null
      const middleImagePath = selectedMiddleImage ? fileUrlToPath(selectedMiddleImage) : null
      const lastImagePath = selectedLastImage ? fileUrlToPath(selectedLastImage) : null
      const audioPath = selectedAudio ? fileUrlToPath(selectedAudio) : null
      const effectiveSettings = { ...settings }
      if (audioPath) effectiveSettings.model = 'pro'
      generate(prompt, imagePath, effectiveSettings, audioPath, middleImagePath, lastImagePath, {
        first: firstStrength,
        middle: middleStrength,
        last: lastStrength,
      }, undefined, preserveAspectRatio)
    }
  }
  
  // Handle "Create video" from generated image
  const handleCreateVideoFromImage = () => {
    if (!imageUrl) {
      logger.error('No image URL available')
      return
    }

    // imageUrl is already a file:// URL — just pass it as the selected image path
    setSelectedImage(imageUrl)
    setMode('image-to-video')
    generatedImageRef.current = imageUrl
  }

  const handleClearAll = () => {
    setPrompt('')
    setSelectedImage(null)
    setSelectedMiddleImage(null)
    setSelectedLastImage(null)
    setSelectedAudio(null)
    setFirstStrength(0.7)
    setMiddleStrength(0.7)
    setLastStrength(0.7)
    setSettings({ ...DEFAULT_SETTINGS })
    setReferenceImages([null])
    if (mode !== 'text-to-image') setMode('text-to-video')
    setRetakeInput({
      videoUrl: null,
      videoPath: null,
      startTime: 0,
      duration: 0,
      videoDuration: 0,
      ready: false,
    })
    setRetakePanelKey((prev) => prev + 1)
    resetRetake()
    reset()
  }

  const [loadError, setLoadError] = useState<string | null>(null)

  const handleLoadSettings = async () => {
    setLoadError(null)
    const files = await window.electronAPI.showOpenFileDialog({
      title: 'Load settings from video',
      filters: [{ name: 'Video Files', extensions: ['mp4', 'webm', 'mov'] }],
    })
    if (!files || files.length === 0) return
    const metadata = await window.electronAPI.readVideoMetadata(files[0])
    if (!metadata) {
      setLoadError('No generation settings found in this video.')
      return
    }
    if (typeof metadata.prompt === 'string') setPrompt(metadata.prompt)
    setSettings(prev => ({
      ...prev,
      ...(typeof metadata.duration === 'number' && { duration: metadata.duration }),
      ...(typeof metadata.fps === 'number' && { fps: metadata.fps }),
      ...(typeof metadata.resolution === 'string' && { videoResolution: metadata.resolution }),
      ...(typeof metadata.aspectRatio === 'string' && { aspectRatio: metadata.aspectRatio }),
      ...(typeof metadata.cameraMotion === 'string' && { cameraMotion: metadata.cameraMotion }),
      ...(typeof metadata.spatialUpscale === 'boolean' && { spatialUpscale: metadata.spatialUpscale }),
      ...(typeof metadata.temporalUpscale === 'boolean' && { temporalUpscale: metadata.temporalUpscale }),
      ...(typeof metadata.filmGrain === 'boolean' && { filmGrain: metadata.filmGrain }),
      ...(typeof metadata.filmGrainIntensity === 'number' && { filmGrainIntensity: metadata.filmGrainIntensity }),
      ...(typeof metadata.filmGrainSize === 'number' && { filmGrainSize: metadata.filmGrainSize }),
    }))
    if (typeof metadata.firstStrength === 'number') setFirstStrength(metadata.firstStrength)
    if (typeof metadata.lastStrength === 'number') setLastStrength(metadata.lastStrength)
    setMode('text-to-video')
    setSelectedImage(null)
    setSelectedLastImage(null)
    setSelectedAudio(null)
    reset()
  }

  const isRetakeMode = mode === 'retake'
  const isVideoMode = mode === 'text-to-video' || mode === 'image-to-video'
  const isBusy = isRetakeMode ? isRetaking : isGenerating
  const canGenerate = status.connected && !isBusy && (
    isRetakeMode
      ? retakeInput.ready && !!retakeInput.videoPath
      : !!prompt.trim()
  )

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button 
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          <div className="flex items-center gap-2.5">
            <LtxLogo className="h-6 w-auto text-white" />
            <span className="text-zinc-400 text-base font-medium tracking-wide leading-none pt-1 pl-1.5">Playground</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 pr-20">
          {/* Connection status */}
          <div className="text-sm text-zinc-500">
            {status.connected ? 'ComfyUI Connected' : 'ComfyUI Disconnected'}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-[500px] min-h-0 border-r border-zinc-800 p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* Mode Tabs */}
            <ModeTabs
              mode={mode}
              onModeChange={handleModeChange}
              disabled={isBusy}
            />

            {/* Image Upload - Always shown in video mode (optional: makes it I2V) */}
            {isVideoMode && !isRetakeMode && (
              <>
                <ImageUploader
                  label="First Frame"
                  selectedImage={selectedImage}
                  onImageSelect={setSelectedImage}
                  strength={firstStrength}
                  onStrengthChange={setFirstStrength}
                />

                <ImageUploader
                  label="Middle Frame"
                  selectedImage={selectedMiddleImage}
                  onImageSelect={setSelectedMiddleImage}
                  strength={middleStrength}
                  onStrengthChange={setMiddleStrength}
                />

                <ImageUploader
                  label="Last Frame"
                  selectedImage={selectedLastImage}
                  onImageSelect={setSelectedLastImage}
                  strength={lastStrength}
                  onStrengthChange={setLastStrength}
                />
                <AudioUploader
                  selectedAudio={selectedAudio}
                  onAudioSelect={setSelectedAudio}
                />

                {(selectedImage || selectedMiddleImage || selectedLastImage) && (
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
            {mode === 'text-to-image' && (settings.imageGenerator ?? appSettings.imageGenerator) === 'gemini' && (
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
                    onImageSelect={(path) => {
                      setReferenceImages(prev => {
                        const next = [...prev]
                        next[idx] = path
                        // If an image was added and this was the last slot, add a new empty slot (max 6)
                        if (path && idx === prev.length - 1 && prev.length < 6) {
                          next.push(null)
                        }
                        // If an image was removed, remove trailing empty slots (keep at least 1)
                        if (!path) {
                          while (next.length > 1 && next[next.length - 1] === null && idx !== next.length - 1) {
                            next.pop()
                          }
                          // If all slots after this are null, trim to this + 1
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

            {isRetakeMode && (
              <RetakePanel
                resetKey={retakePanelKey}
                isProcessing={isRetaking}
                processingStatus={retakeStatus}
                onChange={(data) => setRetakeInput(data)}
              />
            )}

            {/* Prompt Input */}
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

            {/* Settings */}
            {!isRetakeMode && (
              <SettingsPanel
                settings={settings}
                onSettingsChange={handleSettingsChange}
                disabled={isBusy}
                mode={mode}
                hasAudio={!!selectedAudio}
              />
            )}

            {/* Error Display */}
            {loadError && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
                <span className="text-yellow-400">{loadError}</span>
              </div>
            )}
            {(generationError || retakeError) && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm">
                {(generationError || retakeError)!.includes('TEXT_ENCODING_NOT_CONFIGURED') ? (
                  <div className="space-y-2">
                    <p className="text-red-400 font-medium">Text encoding not configured</p>
                    <p className="text-red-400/80">
                      To generate videos, you need to set up text encoding in Settings.
                    </p>
                  </div>
                ) : (generationError || retakeError)!.includes('TEXT_ENCODER_NOT_DOWNLOADED') ? (
                  <div className="space-y-2">
                    <p className="text-red-400 font-medium">Text encoder not downloaded</p>
                    <p className="text-red-400/80">
                      The local text encoder needs to be downloaded (~25 GB).
                    </p>
                  </div>
                ) : (
                  <span className="text-red-400">{generationError || retakeError}</span>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleLoadSettings}
                disabled={isBusy}
                className="flex items-center gap-2 border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
                title="Load settings from a previously generated video"
              >
                <Upload className="h-4 w-4" />
                Load
              </Button>
              <Button
                variant="outline"
                onClick={handleClearAll}
                disabled={isBusy}
                className="flex items-center gap-2 border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>
              
              {isGenerating ? (
                <Button
                  onClick={cancel}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white"
                >
                  <Square className="h-4 w-4" />
                  Stop generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  {isRetakeMode ? (
                    <>
                      <Scissors className="h-4 w-4" />
                      {isRetaking ? 'Retaking...' : 'Retake'}
                    </>
                  ) : mode === 'text-to-image' ? (
                    <>
                      <ImageIcon className="h-4 w-4" />
                      Generate image
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate video
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Result Preview */}
        <div className="flex-1 p-6">
          {mode === 'text-to-image' ? (
            <ImageResult
              imageUrl={imageUrl}
              isGenerating={isGenerating}
              progress={progress}
              statusMessage={statusMessage}
              onCreateVideo={handleCreateVideoFromImage}
            />
          ) : mode === 'retake' ? (
            <VideoPlayer
              videoUrl={retakeResult?.videoUrl || null}
              videoPath={retakeResult?.videoPath || null}
              videoResolution={settings.videoResolution}
              isGenerating={isRetaking}
              progress={0}
              statusMessage={retakeStatus}
            />
          ) : (
            <VideoPlayer
              videoUrl={videoUrl}
              videoPath={videoPath}
              videoResolution={settings.videoResolution}
              isGenerating={isGenerating}
              progress={progress}
              statusMessage={statusMessage}
            />
          )}
        </div>
      </main>
    </div>
  )
}
