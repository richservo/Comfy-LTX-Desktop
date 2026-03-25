import { useState, useEffect } from 'react'
import { Play, X, Layers, Loader2, Trash2, Mic, RotateCcw, Unlink, Link } from 'lucide-react'
import { SettingsPanel } from '../../components/SettingsPanel'
import type { TimelineClip, InferenceStack } from '../../types/project'
import { getStackFrameMapping, getStackDuration, getStackClips } from './video-editor-utils'
import { fileUrlToPath } from '../../lib/url-to-path'

function pathToFileUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

interface RenderEntry {
  filename: string; filePath: string; type: string; prompt: string;
  enhancedPrompt: string | null; timestamp: string;
}

function ErrorRecoveryPanel({ stack, projectName, onRelinkOutput }: {
  stack: InferenceStack
  projectName?: string
  onRelinkOutput: (stackId: string, videoPath: string) => Promise<boolean>
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [renders, setRenders] = useState<RenderEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (!showPicker || !projectName) return
    setLoading(true)
    window.electronAPI.getProjectRenders(projectName).then(results => {
      // Only show videos, sorted newest first
      const videos = (results || [])
        .filter(r => r.type === 'video')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      setRenders(videos)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [showPicker, projectName])

  const handlePick = async (render: RenderEntry) => {
    setLinking(true)
    await onRelinkOutput(stack.id, render.filePath)
    setLinking(false)
    setShowPicker(false)
  }

  return (
    <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3 space-y-2">
      <p className="text-xs text-red-400">{stack.errorMessage}</p>
      {!showPicker ? (
        <button
          onClick={() => setShowPicker(true)}
          className="px-3 py-1.5 rounded bg-amber-700/50 text-amber-300 text-xs hover:bg-amber-700/70 transition-colors flex items-center gap-1.5"
        >
          <Link className="h-3 w-3" />
          Link Output
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400">Select the rendered output:</span>
            <button onClick={() => setShowPicker(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3 w-3" />
            </button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 text-zinc-500 animate-spin" />
            </div>
          ) : renders.length === 0 ? (
            <p className="text-[10px] text-zinc-500 py-2">No renders found in project</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 scrollbar-thin">
              {renders.map((r, i) => (
                <button
                  key={i}
                  disabled={linking}
                  onClick={() => handlePick(r)}
                  className="w-full flex items-center gap-2 p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors text-left disabled:opacity-50"
                >
                  <video
                    src={pathToFileUrl(r.filePath)}
                    className="h-10 aspect-video object-cover rounded flex-shrink-0"
                    muted
                    preload="metadata"
                    onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.1 }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-300 truncate">{r.prompt || r.filename}</p>
                    <p className="text-[9px] text-zinc-500">{new Date(r.timestamp).toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface InferenceStackPanelProps {
  stack: InferenceStack
  clips: TimelineClip[]
  resolveClipSrc: (clip: TimelineClip) => string
  isRendering: boolean
  renderStatusMessage: string
  renderProgress: number
  onUpdateStack: (stackId: string, updates: Partial<InferenceStack>) => void
  onRenderStack: (stackId: string) => void
  onDeleteStack: (stackId: string) => void
  onBreakStack: (stackId: string) => void
  onRevertStack: (stackId: string) => void
  onRelinkOutput: (stackId: string, videoPath: string) => Promise<boolean>
  projectName?: string
  onCancelRender: () => void
  onClose: () => void
}

export function InferenceStackPanel({
  stack,
  clips,
  resolveClipSrc,
  isRendering,
  renderStatusMessage,
  renderProgress,
  onUpdateStack,
  onRenderStack,
  onDeleteStack,
  onBreakStack,
  onRevertStack,
  onRelinkOutput,
  projectName,
  onCancelRender,
  onClose,
}: InferenceStackPanelProps) {
  const frameMapping = getStackFrameMapping(stack, clips)
  const duration = getStackDuration(stack, clips)
  const isReRender = stack.renderedAssetId != null
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)

  // Find audio clip in this stack
  const stackClips = getStackClips(stack, clips)
  const audioClip = stackClips.find(c => c.type === 'audio')

  // Collect all image clips for this stack
  const allImageClips = stackClips.filter(c => c.type === 'image').sort((a, b) => a.startTime - b.startTime)
  const imageCount = allImageClips.length
  const useGuideVideo = imageCount >= 3

  // Build frame URLs: prefer live clips, fall back to stored sourcePaths only when clips are gone
  let firstImageUrl: string | undefined
  let middleImageUrl: string | undefined
  let lastImageUrl: string | undefined
  let hasMiddleFrame = false

  if (frameMapping) {
    // Live clips available — use them directly (respects single-image vs multi-image)
    firstImageUrl = resolveClipSrc(frameMapping.first)
    if (frameMapping.middle) {
      middleImageUrl = resolveClipSrc(frameMapping.middle)
      hasMiddleFrame = true
    }
    if (frameMapping.last) {
      lastImageUrl = resolveClipSrc(frameMapping.last)
    }
  } else if (stack.sourcePaths) {
    // No live clips — fall back to stored paths
    if (stack.sourcePaths.firstImage) firstImageUrl = pathToFileUrl(stack.sourcePaths.firstImage)
    if (stack.sourcePaths.middleImage) { middleImageUrl = pathToFileUrl(stack.sourcePaths.middleImage); hasMiddleFrame = true }
    if (stack.sourcePaths.lastImage) lastImageUrl = pathToFileUrl(stack.sourcePaths.lastImage)
    // Single image stored as lastImage only → show as single with toggle
    if (!firstImageUrl && lastImageUrl && !middleImageUrl) {
      firstImageUrl = lastImageUrl
      lastImageUrl = undefined
    }
  }
  const hasFirstImage = !!(firstImageUrl || lastImageUrl)

  const handleTranscribe = async () => {
    if (!audioClip) return
    const audioUrl = resolveClipSrc(audioClip)
    const audioPath = fileUrlToPath(audioUrl)
    if (!audioPath) {
      setTranscribeError('Could not resolve audio file path')
      return
    }
    setIsTranscribing(true)
    setTranscribeError(null)
    try {
      const result = await window.electronAPI.transcribeAudio(audioPath, audioClip.trimStart, audioClip.duration)
      if (result.error) {
        setTranscribeError(result.error)
      } else if (result.text) {
        onUpdateStack(stack.id, { prompt: result.text })
      }
    } catch (err) {
      setTranscribeError(String(err))
    } finally {
      setIsTranscribing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[560px] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden my-auto shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-violet-600/20">
              <Layers className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Inference Stack</h2>
              <p className="text-[10px] text-zinc-500">
                {stack.clipIds.length} clip{stack.clipIds.length !== 1 ? 's' : ''} &middot; {duration.toFixed(1)}s
                {stack.renderState === 'complete' && ' \u2022 Rendered'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onBreakStack(stack.id); onClose() }}
              className="p-1.5 rounded-lg hover:bg-amber-900/30 text-zinc-500 hover:text-amber-400"
              title="Break stack — restore all clips as independent"
            >
              <Unlink className="h-4 w-4" />
            </button>
            <button
              onClick={() => { onDeleteStack(stack.id); onClose() }}
              className="p-1.5 rounded-lg hover:bg-red-900/30 text-zinc-500 hover:text-red-400"
              title="Delete stack"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Frame previews (only when images present) */}
          {hasFirstImage && (
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">
                Frame Guidance
              </label>

              {/* Guide video mode: 3+ images (always) or 2 images with guide mode selected */}
              {useGuideVideo ? (
                <div>
                  {/* Scrollable image thumbnails */}
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {allImageClips.map((clip, i) => {
                      const src = resolveClipSrc(clip)
                      const stackStart = allImageClips[0].startTime
                      const frameIdx = Math.round((clip.startTime - stackStart) * stack.settings.fps)
                      return (
                        <div key={clip.id} className="flex-shrink-0 w-24">
                          <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 mb-1">
                            <img src={src} alt={`Frame ${i + 1}`} className="w-full aspect-video object-cover" />
                          </div>
                          <span className="text-[9px] text-zinc-500 font-semibold">
                            Frame {frameIdx}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {/* Last frame mode toggle */}
                  <div className="flex items-center mt-2 bg-zinc-800 rounded-lg border border-zinc-700 p-0.5">
                    <button
                      onClick={() => onUpdateStack(stack.id, { guideEndMode: 'cut' })}
                      className={`flex-1 text-[9px] font-medium py-1 rounded-md transition-colors ${
                        stack.guideEndMode !== 'end'
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-300'
                      }`}
                    >
                      Last at Cut
                    </button>
                    <button
                      onClick={() => onUpdateStack(stack.id, { guideEndMode: 'end' })}
                      className={`flex-1 text-[9px] font-medium py-1 rounded-md transition-colors ${
                        stack.guideEndMode === 'end'
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-300'
                      }`}
                    >
                      Last at End
                    </button>
                  </div>
                  {/* Guide strength slider */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[9px] text-zinc-500 font-semibold uppercase">Guide Strength</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={stack.guideStrength ?? 0.7}
                      onChange={(e) => onUpdateStack(stack.id, { guideStrength: parseFloat(e.target.value) })}
                      className="flex-1 h-1 accent-violet-500"
                    />
                    <span className="text-[9px] text-zinc-400 w-8 text-right">
                      {((stack.guideStrength ?? 0.7) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {/* Single image: show with first/last toggle */}
                  {!lastImageUrl && !middleImageUrl ? (
                    <div className="flex-1 min-w-0">
                      <FramePreviewUrl
                        label={stack.singleFramePosition === 'last' ? 'Last' : 'First'}
                        src={firstImageUrl || ''}
                        strength={stack.strengths.first}
                        onStrengthChange={(v) => onUpdateStack(stack.id, {
                          strengths: { ...stack.strengths, first: v }
                        })}
                      />
                      <div className="flex items-center mt-1.5 bg-zinc-800 rounded-lg border border-zinc-700 p-0.5">
                        <button
                          onClick={() => onUpdateStack(stack.id, { singleFramePosition: 'first' })}
                          className={`flex-1 text-[9px] font-medium py-1 rounded-md transition-colors ${
                            stack.singleFramePosition !== 'last'
                              ? 'bg-violet-600 text-white'
                              : 'text-zinc-400 hover:text-zinc-300'
                          }`}
                        >
                          First Frame
                        </button>
                        <button
                          onClick={() => onUpdateStack(stack.id, { singleFramePosition: 'last' })}
                          className={`flex-1 text-[9px] font-medium py-1 rounded-md transition-colors ${
                            stack.singleFramePosition === 'last'
                              ? 'bg-violet-600 text-white'
                              : 'text-zinc-400 hover:text-zinc-300'
                          }`}
                        >
                          Last Frame
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <FramePreviewUrl
                        label="First"
                        src={firstImageUrl || ''}
                        strength={stack.strengths.first}
                        onStrengthChange={(v) => onUpdateStack(stack.id, {
                          strengths: { ...stack.strengths, first: v }
                        })}
                      />
                      {middleImageUrl && (
                        <FramePreviewUrl
                          label="Middle"
                          src={middleImageUrl}
                          strength={stack.strengths.middle}
                          onStrengthChange={(v) => onUpdateStack(stack.id, {
                            strengths: { ...stack.strengths, middle: v }
                          })}
                        />
                      )}
                      {lastImageUrl && (
                        <FramePreviewUrl
                          label="Last"
                          src={lastImageUrl}
                          strength={stack.strengths.last}
                          onStrengthChange={(v) => onUpdateStack(stack.id, {
                            strengths: { ...stack.strengths, last: v }
                          })}
                        />
                      )}
                    </>
                  )}
                </div>
              )}

            </div>
          )}

          {/* Preserve aspect ratio (only relevant when images present) */}
          {hasFirstImage && (
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={stack.preserveAspectRatio ?? false}
                onChange={(e) => onUpdateStack(stack.id, { preserveAspectRatio: e.target.checked })}
                className="rounded border-zinc-600 bg-zinc-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              />
              Preserve aspect ratio
            </label>
          )}

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Prompt</label>
              {audioClip && (
                <button
                  onClick={handleTranscribe}
                  disabled={isTranscribing || isRendering}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Transcribe audio clip using Whisper"
                >
                  {isTranscribing ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /> Transcribing...</>
                  ) : (
                    <><Mic className="h-3 w-3" /> Transcribe</>
                  )}
                </button>
              )}
            </div>
            <textarea
              value={stack.prompt}
              onChange={(e) => onUpdateStack(stack.id, { prompt: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Describe the motion and action for this shot..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 placeholder-zinc-600"
              rows={3}
            />
            {transcribeError && (
              <p className="text-[10px] text-red-400 mt-1">{transcribeError}</p>
            )}
          </div>

          {/* Settings */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Settings</label>
            {hasMiddleFrame && !useGuideVideo && (
              <p className="text-[10px] text-amber-400/80 mb-1.5">
                Temporal upscale is disabled when using a middle frame.
              </p>
            )}
            <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
              <SettingsPanel
                settings={hasMiddleFrame && !useGuideVideo ? { ...stack.settings, temporalUpscale: false } : stack.settings}
                onSettingsChange={(settings) => onUpdateStack(stack.id, {
                  settings: hasMiddleFrame && !useGuideVideo ? { ...settings, temporalUpscale: false } : settings
                })}
                disabled={isRendering}
                mode={hasFirstImage ? 'image-to-video' : 'text-to-video'}
                hideDuration
                hideIterations
              />
            </div>
          </div>

          {/* Handles */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">
              Handles (extra frames)
            </label>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[9px] text-zinc-500 mb-0.5 block">Head</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={stack.headHandles ?? 0}
                  onChange={(e) => onUpdateStack(stack.id, { headHandles: Math.max(0, parseInt(e.target.value) || 0) })}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500/50"
                />
              </div>
              <div className="flex-1">
                <label className="text-[9px] text-zinc-500 mb-0.5 block">Tail</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={stack.tailHandles ?? 0}
                  onChange={(e) => onUpdateStack(stack.id, { tailHandles: Math.max(0, parseInt(e.target.value) || 0) })}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500/50"
                />
              </div>
            </div>
            {((stack.headHandles ?? 0) > 0 || (stack.tailHandles ?? 0) > 0) && (
              <p className="text-[9px] text-zinc-500 mt-1">
                +{((stack.headHandles ?? 0) / stack.settings.fps).toFixed(2)}s head, +{((stack.tailHandles ?? 0) / stack.settings.fps).toFixed(2)}s tail
              </p>
            )}
          </div>

          {/* Duration info */}
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <span className="uppercase tracking-wider font-semibold">Duration:</span>
            <span className="text-zinc-300">{duration.toFixed(1)}s</span>
            {((stack.headHandles ?? 0) > 0 || (stack.tailHandles ?? 0) > 0) && (
              <span className="text-zinc-400">
                ({(duration + (stack.headHandles ?? 0) / stack.settings.fps + (stack.tailHandles ?? 0) / stack.settings.fps).toFixed(1)}s with handles)
              </span>
            )}
            <span className="text-zinc-600">
              {clips.find(c => stack.clipIds.includes(c.id) && c.type === 'audio')
                ? '(from audio)'
                : '(from image span)'}
            </span>
          </div>

          {/* Progress */}
          {isRendering && (
            <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />
                <span className="text-xs text-zinc-300">{renderStatusMessage || 'Rendering...'}</span>
              </div>
              <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error with render picker */}
          {stack.renderState === 'error' && stack.errorMessage && (
            <ErrorRecoveryPanel
              stack={stack}
              projectName={projectName}
              onRelinkOutput={onRelinkOutput}
            />
          )}

          {/* Complete but missing clip — offer relink */}
          {stack.renderState === 'complete' && stack.renderedClipId && !clips.some(c => c.id === stack.renderedClipId) && (
            <ErrorRecoveryPanel
              stack={{ ...stack, errorMessage: 'Rendered clip missing from timeline' }}
              projectName={projectName}
              onRelinkOutput={onRelinkOutput}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">
            {stack.renderState === 'complete' ? 'Re-render adds a new take' : 'Render replaces source clips'}
          </span>
          <div className="flex items-center gap-2">
            {isReRender && !isRendering && (
              <button
                onClick={() => onRevertStack(stack.id)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-amber-400 text-xs hover:bg-zinc-700 transition-colors flex items-center gap-1"
                title="Remove rendered clip and restore source clips for editing"
              >
                <RotateCcw className="h-3 w-3" />
                Revert
              </button>
            )}
            {isRendering ? (
              <button
                onClick={onCancelRender}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors"
              >
                Close
              </button>
            )}
            <button
              onClick={() => { onRenderStack(stack.id); onClose() }}
              disabled={isRendering || !stack.prompt.trim()}
              className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs hover:bg-violet-500 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isRendering ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Rendering...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  {isReRender ? 'Re-render' : 'Render'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FramePreviewUrl({
  label,
  src,
  strength,
  onStrengthChange,
}: {
  label: string
  src: string
  strength?: number
  onStrengthChange: (value: number) => void
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 mb-1">
        <img src={src} alt={label} className="w-full aspect-video object-cover" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-zinc-500 font-semibold uppercase">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={strength ?? 1}
            onChange={(e) => onStrengthChange(parseFloat(e.target.value))}
            className="w-12 h-1 accent-violet-500"
          />
          <span className="text-[9px] text-zinc-400 w-6 text-right">{((strength ?? 1) * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  )
}
