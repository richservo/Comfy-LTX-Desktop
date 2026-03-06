import { Play, X, Film, Loader2 } from 'lucide-react'
import { SettingsPanel } from '../../components/SettingsPanel'
import type { GenerationSettings } from '../../components/SettingsPanel'
import type { TimelineClip } from '../../types/project'

interface I2vGenerationModalProps {
  i2vClipId: string | null
  setI2vClipId: (id: string | null) => void
  clips: TimelineClip[]
  resolveClipSrc: (clip: TimelineClip) => string
  i2vPrompt: string
  setI2vPrompt: (prompt: string) => void
  i2vSettings: GenerationSettings
  setI2vSettings: (settings: GenerationSettings) => void
  isRegenerating: boolean
  regenStatusMessage: string
  regenProgress: number
  regenReset: () => void
  handleI2vGenerate: () => void
}

export function I2vGenerationModal({
  i2vClipId,
  setI2vClipId,
  clips,
  resolveClipSrc,
  i2vPrompt,
  setI2vPrompt,
  i2vSettings,
  setI2vSettings,
  isRegenerating,
  regenStatusMessage,
  regenProgress,
  regenReset,
  handleI2vGenerate,
}: I2vGenerationModalProps) {
  if (!i2vClipId) return null

  const i2vClip = clips.find(c => c.id === i2vClipId)
  if (!i2vClip) return null
  const i2vImageUrl = resolveClipSrc(i2vClip)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[520px] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden my-auto shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-600/20">
              <Film className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Image to Video</h2>
              <p className="text-[10px] text-zinc-500">
                Generate video from image clip ({i2vClip.duration.toFixed(1)}s)
              </p>
            </div>
          </div>
          <button 
            onClick={() => { setI2vClipId(null); regenReset() }}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Source image preview */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Source Image</label>
            <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
              <img 
                src={i2vImageUrl} 
                alt="Source" 
                className="w-full max-h-40 object-contain" 
              />
            </div>
          </div>
          
          {/* Prompt */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Prompt</label>
            <textarea
              value={i2vPrompt}
              onChange={(e) => setI2vPrompt(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Describe the motion and action for the video..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 placeholder-zinc-600"
              rows={3}
            />
          </div>
          
          {/* Settings */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Settings</label>
            <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
              <SettingsPanel
                settings={i2vSettings}
                onSettingsChange={setI2vSettings}
                disabled={isRegenerating}
                mode="image-to-video"
              />
            </div>
          </div>
          
          {/* Progress */}
          {isRegenerating && i2vClipId && (
            <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
                <span className="text-xs text-zinc-300">{regenStatusMessage || 'Generating video...'}</span>
              </div>
              <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${regenProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">
            Clip duration: {i2vClip.duration.toFixed(1)}s
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setI2vClipId(null); regenReset() }}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleI2vGenerate}
              disabled={isRegenerating || !i2vPrompt.trim()}
              className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-500 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Generate Video
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
