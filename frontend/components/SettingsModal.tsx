import { Info, Package, Settings, Sliders, X, RefreshCw, CheckCircle, AlertTriangle, Download } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { useAppSettings, type AppSettings } from '../contexts/AppSettingsContext'
import { logger } from '../lib/logger'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: TabId
}

type TabId = 'general' | 'inference' | 'models' | 'about'

export function SettingsModal({ isOpen, onClose, initialTab }: SettingsModalProps) {
  const { settings, updateSettings } = useAppSettings()
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [appVersion, setAppVersion] = useState('')
  const [noticesText, setNoticesText] = useState<string | null>(null)
  const [noticesLoading, setNoticesLoading] = useState(false)
  const [showNotices, setShowNotices] = useState(false)
  const [modelLicenseText, setModelLicenseText] = useState<string | null>(null)
  const [modelLicenseLoading, setModelLicenseLoading] = useState(false)
  const [showModelLicense, setShowModelLicense] = useState(false)
  const [modelLists, setModelLists] = useState<{ checkpoints: string[]; textEncoders: string[]; upscaleModels: string[]; loras: string[]; samplers: string[]; hasZImage?: boolean } | null>(null)
  const [modelListsLoading, setModelListsLoading] = useState(false)
  const [modelListsError, setModelListsError] = useState<string | null>(null)
  const [comfyUrlInput, setComfyUrlInput] = useState(settings.comfyuiUrl)
  const [comfyOutputDirInput, setComfyOutputDirInput] = useState(settings.comfyuiOutputDir)
  const [ollamaUrlInput, setOllamaUrlInput] = useState(settings.ollamaUrl)
  const [ollamaModelInput, setOllamaModelInput] = useState(settings.ollamaModel)

  // Update checker state
  const [nodeUpdateStatus, setNodeUpdateStatus] = useState<{ results: { name: string; hasUpdate: boolean; error?: string }[]; hasAnyUpdates: boolean } | null>(null)
  const [nodeCheckLoading, setNodeCheckLoading] = useState(false)
  const [nodeUpdateInProgress, setNodeUpdateInProgress] = useState(false)
  const [nodeUpdateResult, setNodeUpdateResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [appUpdateStatus, setAppUpdateStatus] = useState<{ updateAvailable: boolean; currentVersion: string; latestVersion?: string } | null>(null)

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab as TabId)
    }
  }, [isOpen, initialTab])

  useEffect(() => {
    if (isOpen) {
      setComfyUrlInput(settings.comfyuiUrl)
      setComfyOutputDirInput(settings.comfyuiOutputDir)
      setOllamaUrlInput(settings.ollamaUrl)
      setOllamaModelInput(settings.ollamaModel)
    }
  }, [isOpen, settings.comfyuiUrl, settings.comfyuiOutputDir, settings.ollamaUrl, settings.ollamaModel])

  useEffect(() => {
    if (activeTab !== 'models' && activeTab !== 'inference') return
    if (modelLists) return // already fetched
    setModelListsLoading(true)
    setModelListsError(null)
    window.electronAPI.getModelLists()
      .then((lists) => {
        setModelLists(lists)
        setModelListsLoading(false)
      })
      .catch(() => {
        setModelListsError('Could not connect to ComfyUI. Make sure it is running.')
        setModelListsLoading(false)
      })
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'about' || appVersion) return
    window.electronAPI.getAppInfo().then(info => setAppVersion(info.version)).catch(() => {})
  }, [activeTab, appVersion])

  if (!isOpen) return null

  const handleToggleSeedLock = () => {
    updateSettings({ seedLocked: !settings.seedLocked })
  }

  const handleLockedSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value) || 0
    updateSettings({ lockedSeed: Math.max(0, Math.min(2147483647, value)) })
  }

  const handleRandomizeSeed = () => {
    updateSettings({ lockedSeed: Math.floor(Math.random() * 2147483647) })
  }

  const handleStepsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const steps = Math.max(1, Math.min(100, parseInt(e.target.value) || 8))
    updateSettings({ steps })
  }

  const handleCfgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cfg = Math.max(0, Math.min(30, parseFloat(e.target.value) || 1.0))
    updateSettings({ cfg })
  }

  const handleSaveComfyUrl = () => {
    const trimmed = comfyUrlInput.trim()
    if (trimmed) {
      updateSettings({ comfyuiUrl: trimmed })
    }
  }

  const handleSaveComfyOutputDir = () => {
    updateSettings({ comfyuiOutputDir: comfyOutputDirInput.trim() })
  }

  const handleLoadModelLicense = async () => {
    setModelLicenseLoading(true)
    try {
      const text = await window.electronAPI.fetchLicenseText()
      setModelLicenseText(text)
      setShowModelLicense(true)
    } catch (e) {
      logger.error(`Failed to load model license: ${e}`)
    } finally {
      setModelLicenseLoading(false)
    }
  }

  const handleLoadNotices = async () => {
    setNoticesLoading(true)
    try {
      const text = await window.electronAPI.getNoticesText()
      setNoticesText(text)
      setShowNotices(true)
    } catch (e) {
      logger.error(`Failed to load notices: ${e}`)
    } finally {
      setNoticesLoading(false)
    }
  }

  const handleCheckForUpdates = async () => {
    setNodeCheckLoading(true)
    setNodeUpdateResult(null)
    try {
      const [nodeResult, appResult] = await Promise.all([
        window.electronAPI.checkNodeUpdates(),
        window.electronAPI.checkAppUpdate(),
      ])
      setNodeUpdateStatus(nodeResult)
      setAppUpdateStatus(appResult)
    } catch (e) {
      logger.error(`Failed to check for updates: ${e}`)
    } finally {
      setNodeCheckLoading(false)
    }
  }

  const handleUpdateNodes = async () => {
    setNodeUpdateInProgress(true)
    setNodeUpdateResult(null)
    try {
      const result = await window.electronAPI.updateNodes()
      setNodeUpdateResult(result)
      if (result.success) {
        // Re-check status after successful update
        const updated = await window.electronAPI.checkNodeUpdates()
        setNodeUpdateStatus(updated)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setNodeUpdateResult({ success: false, error: message })
    } finally {
      setNodeUpdateInProgress(false)
    }
  }

  const tabs = [
    { id: 'general' as TabId, label: 'General', icon: Settings },
    { id: 'inference' as TabId, label: 'Inference', icon: Sliders },
    { id: 'models' as TabId, label: 'Models', icon: Package },
    { id: 'about' as TabId, label: 'About', icon: Info },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-white">Settings</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? 'text-white border-b-2 border-blue-500 -mb-px' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6 h-[60vh] overflow-y-auto">
          {activeTab === 'general' && (
            <>
              {/* ComfyUI URL */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">ComfyUI Connection</h3>
                <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">ComfyUI URL</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={comfyUrlInput}
                        onChange={(e) => setComfyUrlInput(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="http://localhost:8188"
                      />
                      <button
                        onClick={handleSaveComfyUrl}
                        className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">ComfyUI Output Directory</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={comfyOutputDirInput}
                        onChange={(e) => setComfyOutputDirInput(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., C:\ComfyUI\output"
                      />
                      <button
                        onClick={handleSaveComfyOutputDir}
                        className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
                      >
                        Save
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">Path where ComfyUI saves output files.</p>
                  </div>
                </div>
              </div>

              {/* Seed Lock */}
              <div className="space-y-3 pt-4 border-t border-zinc-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-white">Lock Seed</label>
                    <p className="text-xs text-zinc-500">Use the same seed for reproducible generations.</p>
                  </div>
                  <button
                    onClick={handleToggleSeedLock}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      settings.seedLocked ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      settings.seedLocked ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {settings.seedLocked && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="2147483647"
                      value={settings.lockedSeed}
                      onChange={handleLockedSeedChange}
                      className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Enter seed..."
                    />
                    <Button variant="ghost" size="sm" onClick={handleRandomizeSeed} className="h-9 px-3 text-xs text-zinc-400 hover:text-white">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                      </svg>
                    </Button>
                  </div>
                )}
              </div>

            </>
          )}

          {activeTab === 'inference' && (
            <>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white">ComfyUI Inference Settings</h3>
                <div className="bg-zinc-800/50 rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-white">Inference Steps</label>
                      <p className="text-xs text-zinc-500">More steps = better quality, slower</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={settings.steps}
                      onChange={handleStepsChange}
                      className="w-20 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-white">CFG Scale</label>
                      <p className="text-xs text-zinc-500">Classifier-free guidance strength</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      step="0.1"
                      value={settings.cfg}
                      onChange={handleCfgChange}
                      className="w-20 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm text-white">Sampler</label>
                      <p className="text-xs text-zinc-500">Noise sampling algorithm</p>
                    </div>
                    <select
                      value={settings.sampler || 'euler_ancestral'}
                      onChange={(e) => updateSettings({ sampler: e.target.value })}
                      className="px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {modelLists?.samplers?.length ? (
                        modelLists.samplers.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))
                      ) : (
                        <option value={settings.sampler || 'euler_ancestral'}>{settings.sampler || 'euler_ancestral'}</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="bg-zinc-800/30 rounded-lg p-3">
                  <p className="text-xs text-zinc-400">
                    <span className="text-blue-400 font-medium">Tip:</span> These values are sent to the RSLTXVGenerate node in ComfyUI.
                    Default: 20 steps, 3.0 CFG.
                  </p>
                </div>
              </div>

              {/* Image Generator */}
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <div>
                  <h3 className="text-sm font-semibold text-white">Image Generator</h3>
                  <p className="text-xs text-zinc-500 mt-1">Used for text-to-image and as first frame generator for text-to-video.</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <select
                    value={settings.imageGenerator || 'none'}
                    onChange={(e) => updateSettings({ imageGenerator: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="none">None (LTXV pipeline)</option>
                    {modelLists?.hasZImage && <option value="z-image">Z-Image (RS Z-Image Generate)</option>}
                  </select>
                  <p className="text-xs text-zinc-500 mt-2">
                    When Z-Image is selected, image generation uses RS Z-Image Generate. For text-to-video, Z-Image auto-generates the first frame from your prompt.
                  </p>
                </div>
              </div>

              {/* Ollama Prompt Formatter */}
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-white">Ollama Prompt Formatter</h3>
                    <p className="text-xs text-zinc-500">Use an Ollama server instead of the built-in local prompt formatter.</p>
                  </div>
                  <button
                    onClick={() => updateSettings({ ollamaEnabled: !settings.ollamaEnabled })}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      settings.ollamaEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      settings.ollamaEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {settings.ollamaEnabled && (
                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Ollama URL</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={ollamaUrlInput}
                          onChange={(e) => setOllamaUrlInput(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="http://localhost:11434"
                        />
                        <button
                          onClick={() => {
                            const trimmed = ollamaUrlInput.trim()
                            if (trimmed) updateSettings({ ollamaUrl: trimmed })
                          }}
                          className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Model</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={ollamaModelInput}
                          onChange={(e) => setOllamaModelInput(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="gemma3:12b"
                        />
                        <button
                          onClick={() => {
                            const trimmed = ollamaModelInput.trim()
                            if (trimmed) updateSettings({ ollamaModel: trimmed })
                          }}
                          className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
                        >
                          Save
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">Ollama model to use for prompt formatting (e.g., gemma3:12b).</p>
                    </div>
                  </div>
                )}

                {!settings.ollamaEnabled && (
                  <div className="bg-zinc-800/30 rounded-lg p-3">
                    <p className="text-xs text-zinc-400">
                      <span className="text-blue-400 font-medium">Tip:</span> The built-in local prompt formatter uses your text encoder weights directly — no Ollama server needed.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'models' && (
            <>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white">Model Selection</h3>
                {modelListsLoading && (
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    Loading available models from ComfyUI...
                  </div>
                )}
                {modelListsError && (
                  <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3">
                    <p className="text-xs text-red-400">{modelListsError}</p>
                  </div>
                )}
                {modelLists && !modelListsLoading && (
                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-4">
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Checkpoint</label>
                      <p className="text-xs text-zinc-500 mb-1">Used by model loader and text encoder</p>
                      <select
                        value={settings.checkpoint}
                        onChange={(e) => updateSettings({ checkpoint: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.checkpoints.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Audio VAE Checkpoint</label>
                      <p className="text-xs text-zinc-500 mb-1">Usually same as checkpoint, but can differ</p>
                      <select
                        value={settings.vaeCheckpoint}
                        onChange={(e) => updateSettings({ vaeCheckpoint: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.checkpoints.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Text Encoder</label>
                      <select
                        value={settings.textEncoder}
                        onChange={(e) => updateSettings({ textEncoder: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.textEncoders.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Spatial Upscaler</label>
                      <select
                        value={settings.spatialUpscaleModel}
                        onChange={(e) => updateSettings({ spatialUpscaleModel: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.upscaleModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Temporal Upscaler</label>
                      <select
                        value={settings.temporalUpscaleModel}
                        onChange={(e) => updateSettings({ temporalUpscaleModel: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.upscaleModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Prompt Formatter Text Encoder</label>
                      <p className="text-xs text-zinc-500 mb-1">Used by the local prompt formatter (not CLIP)</p>
                      <select
                        value={settings.promptFormatterTextEncoder}
                        onChange={(e) => updateSettings({ promptFormatterTextEncoder: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.textEncoders.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Upscale LoRA</label>
                      <select
                        value={settings.upscaleLora}
                        onChange={(e) => updateSettings({ upscaleLora: e.target.value })}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {modelLists.loras.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div className="bg-zinc-800/30 rounded-lg p-3">
                  <p className="text-xs text-zinc-400">
                    <span className="text-blue-400 font-medium">Tip:</span> These dropdowns show models available in your ComfyUI installation. Add new models to ComfyUI's model directories to see them here.
                  </p>
                </div>
              </div>
            </>
          )}

          {activeTab === 'about' && (
            <>
              {showModelLicense ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">LTX-2 Model License</h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowModelLicense(false)} className="h-7 px-2 text-xs text-zinc-400">
                      Back
                    </Button>
                  </div>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-800/50 rounded-lg p-4 max-h-[50vh] overflow-y-auto border border-zinc-700/50">
                    {modelLicenseText}
                  </pre>
                </div>
              ) : showNotices ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Third-Party Notices</h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowNotices(false)} className="h-7 px-2 text-xs text-zinc-400">
                      Back
                    </Button>
                  </div>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-800/50 rounded-lg p-4 max-h-[50vh] overflow-y-auto border border-zinc-700/50">
                    {noticesText}
                  </pre>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-bold text-white">LTX Desktop</h3>
                    <p className="text-sm text-zinc-400">Version {appVersion || '...'}</p>
                    <p className="text-xs text-zinc-500">AI Video Generation via ComfyUI</p>
                  </div>

                  {/* Updates */}
                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">Updates</span>
                      <Button
                        size="sm"
                        onClick={handleCheckForUpdates}
                        disabled={nodeCheckLoading}
                        className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs gap-1.5"
                      >
                        <RefreshCw className={`h-3 w-3 ${nodeCheckLoading ? 'animate-spin' : ''}`} />
                        {nodeCheckLoading ? 'Checking...' : 'Check for Updates'}
                      </Button>
                    </div>

                    {nodeUpdateStatus && (
                      <div className="space-y-2 pt-2 border-t border-zinc-700/50">
                        {nodeUpdateStatus.results.map((repo) => (
                          <div key={repo.name} className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300">{repo.name}</span>
                            {repo.error && !repo.hasUpdate ? (
                              <span className="text-amber-400 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {repo.error}
                              </span>
                            ) : repo.hasUpdate ? (
                              <span className="text-amber-400 flex items-center gap-1">
                                <Download className="h-3 w-3" />
                                Update available
                              </span>
                            ) : (
                              <span className="text-emerald-400 flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" />
                                Up to date
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {appUpdateStatus && (
                      <div className="pt-2 border-t border-zinc-700/50">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-300">LTX Desktop</span>
                          {appUpdateStatus.updateAvailable ? (
                            <span className="text-amber-400 flex items-center gap-1">
                              <Download className="h-3 w-3" />
                              v{appUpdateStatus.latestVersion} available
                            </span>
                          ) : (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Up to date
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {nodeUpdateStatus?.hasAnyUpdates && (
                      <Button
                        size="sm"
                        onClick={handleUpdateNodes}
                        disabled={nodeUpdateInProgress}
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white text-xs gap-1.5"
                      >
                        <Download className="h-3 w-3" />
                        {nodeUpdateInProgress ? 'Updating...' : 'Update Nodes'}
                      </Button>
                    )}

                    {nodeUpdateResult && (
                      <div className={`text-xs rounded-md px-3 py-2 ${nodeUpdateResult.success ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                        {nodeUpdateResult.success
                          ? 'Nodes updated successfully. Restart ComfyUI to apply changes.'
                          : `Update failed: ${nodeUpdateResult.error}`}
                      </div>
                    )}
                  </div>

                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                    <span className="text-sm font-medium text-white">LTX-2 Model License</span>
                    <Button size="sm" onClick={handleLoadModelLicense} disabled={modelLicenseLoading} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white text-xs">
                      {modelLicenseLoading ? 'Loading...' : 'View Model License'}
                    </Button>
                  </div>

                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                    <span className="text-sm font-medium text-white">Third-Party Notices</span>
                    <Button size="sm" onClick={handleLoadNotices} disabled={noticesLoading} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white text-xs">
                      {noticesLoading ? 'Loading...' : 'View Third-Party Notices'}
                    </Button>
                  </div>

                  <p className="text-center text-xs text-zinc-600">Copyright 2026 Lightricks</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end">
          <Button onClick={onClose} className="bg-zinc-700 hover:bg-zinc-600 text-white">Done</Button>
        </div>
      </div>
    </div>
  )
}

export type { AppSettings, TabId as SettingsTabId }
