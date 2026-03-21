// Using require for Electron preload compatibility
const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get the path where models are stored
  getModelsPath: (): Promise<string> => ipcRenderer.invoke('get-models-path'),

  // Read a local file and return as base64
  readLocalFile: (filePath: string): Promise<{ data: string; mimeType: string }> =>
    ipcRenderer.invoke('read-local-file', filePath),
  readLocalFileBuffer: (filePath: string): Promise<Buffer> =>
    ipcRenderer.invoke('read-local-file-buffer', filePath),
  approvePath: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('approve-path', filePath),

  // Check GPU availability
  checkGpu: (): Promise<{ available: boolean; name?: string; vram?: number }> =>
    ipcRenderer.invoke('check-gpu'),

  // Get app info
  getAppInfo: (): Promise<{ version: string; isPackaged: boolean; modelsPath: string; userDataPath: string }> =>
    ipcRenderer.invoke('get-app-info'),

  // First-run setup
  checkFirstRun: (): Promise<{ needsSetup: boolean; needsLicense: boolean }> => ipcRenderer.invoke('check-first-run'),
  acceptLicense: (): Promise<boolean> => ipcRenderer.invoke('accept-license'),
  completeSetup: (): Promise<boolean> => ipcRenderer.invoke('complete-setup'),
  fetchLicenseText: (): Promise<string> => ipcRenderer.invoke('fetch-license-text'),
  getNoticesText: (): Promise<string> => ipcRenderer.invoke('get-notices-text'),

  // First-run setup: ComfyUI path + model downloads
  getDefaultComfyPath: (): Promise<string> => ipcRenderer.invoke('setup:get-default-comfy-path'),
  validateComfyPath: (comfyPath: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:validate-comfy-path', comfyPath),
  checkModels: (comfyPath: string): Promise<{
    allPresent: boolean
    missing: { filename: string; sizeBytes: number }[]
    present: { filename: string; sizeBytes: number }[]
    missingBytes: number
    totalBytes: number
  }> => ipcRenderer.invoke('setup:check-models', comfyPath),
  startInstall: (comfyPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:start-install', comfyPath),
  cancelInstall: (): Promise<void> => ipcRenderer.invoke('setup:cancel-install'),
  getDiskSpace: (dirPath: string): Promise<{ freeBytes: number }> =>
    ipcRenderer.invoke('setup:get-disk-space', dirPath),
  onSetupProgress: (callback: (_event: unknown, data: Record<string, unknown>) => void) => {
    ipcRenderer.on('setup:progress', callback)
    return () => { ipcRenderer.removeListener('setup:progress', callback) }
  },

  // Open specific app pages / folders
  openLtxApiKeyPage: (): Promise<boolean> => ipcRenderer.invoke('open-ltx-api-key-page'),
  openFalApiKeyPage: (): Promise<boolean> => ipcRenderer.invoke('open-fal-api-key-page'),
  openParentFolderOfFile: (filePath: string): Promise<void> => ipcRenderer.invoke('open-parent-folder-of-file', filePath),

  // Reveal a specific file in the OS file manager (Explorer/Finder)
  showItemInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('show-item-in-folder', filePath),

  // Log viewer
  getLogs: (): Promise<LogsResponse> => ipcRenderer.invoke('get-logs'),
  getLogPath: (): Promise<{ logPath: string; logDir: string }> => ipcRenderer.invoke('get-log-path'),
  openLogFolder: (): Promise<boolean> => ipcRenderer.invoke('open-log-folder'),

  // Get resources path (for video assets in production)
  getResourcePath: (): Promise<string | null> => ipcRenderer.invoke('get-resource-path'),

  // Paths
  getDownloadsPath: (): Promise<string> => ipcRenderer.invoke('get-downloads-path'),
  ensureDirectory: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ensure-directory', dirPath),

  // File save/export
  showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', options),
  saveFile: (filePath: string, data: string, encoding?: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('save-file', filePath, data, encoding),
  saveBinaryFile: (filePath: string, data: ArrayBuffer): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('save-binary-file', filePath, data),
  showOpenDirectoryDialog: (options: { title?: string }): Promise<string | null> =>
    ipcRenderer.invoke('show-open-directory-dialog', options),
  searchDirectoryForFiles: (dir: string, filenames: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke('search-directory-for-files', dir, filenames),
  copyFile: (src: string, dest: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('copy-file', src, dest),

  // Check multiple files at once
  checkFilesExist: (filePaths: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('check-files-exist', filePaths),

  // Show open file dialog
  showOpenFileDialog: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }): Promise<string[] | null> =>
    ipcRenderer.invoke('show-open-file-dialog', options),

  // Video export via ffmpeg (native compositing — no canvas, no frame-by-frame)
  exportNative: (data: {
    clips: { url: string; type: string; startTime: number; duration: number; trimStart: number; speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number; muted: boolean; volume: number }[];
    outputPath: string; codec: string; width: number; height: number; fps: number; quality: number;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean } }[];
  }): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('export-native', data),
  exportCancel: (sessionId: string): Promise<{ ok?: boolean }> =>
    ipcRenderer.invoke('export-cancel', sessionId),

  // ComfyUI generation
  generateVideo: (params: {
    prompt: string
    imagePath?: string | null
    resolution: string
    aspectRatio: string
    duration: number
    fps: number
    cameraMotion?: string
    preserveAspectRatio?: boolean
    projectName?: string
  }): Promise<{ status: string; video_path?: string; enhanced_prompt?: string; error?: string }> =>
    ipcRenderer.invoke('comfyui:generate', params),
  getGenerationProgress: (): Promise<{
    status: string
    phase: string
    progress: number
    currentStep: number | null
    totalSteps: number | null
  }> => ipcRenderer.invoke('comfyui:progress'),
  cancelGeneration: (): Promise<void> => ipcRenderer.invoke('comfyui:cancel'),
  checkComfyUIHealth: (): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke('comfyui:health'),
  getModelLists: (): Promise<{ checkpoints: string[]; textEncoders: string[]; upscaleModels: string[]; loras: string[]; samplers: string[] }> =>
    ipcRenderer.invoke('comfyui:model-lists'),
  readVideoMetadata: (filePath: string): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke('comfyui:read-video-metadata', filePath),
  extractAudioSegment: (params: { sourcePath: string; startTime: number; duration: number }): Promise<string> =>
    ipcRenderer.invoke('comfyui:extract-audio-segment', params),
  getProjectRenders: (projectName: string): Promise<Array<{
    filename: string; filePath: string; type: string; prompt: string;
    enhancedPrompt: string | null; seed: number; resolution: string;
    aspectRatio: string; duration: number; fps: number;
    cameraMotion?: string; timestamp: string;
    imagePath?: string | null; middleImagePath?: string | null; lastImagePath?: string | null;
    firstStrength?: number; middleStrength?: number; lastStrength?: number;
    preserveAspectRatio?: boolean;
  }>> => ipcRenderer.invoke('comfyui:get-project-renders', projectName),

  // Settings (stored locally by Electron)
  getSettings: (): Promise<{
    comfyuiUrl: string
    comfyuiOutputDir: string
    seedLocked: boolean
    lockedSeed: number
    steps: number
    cfg: number
  }> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:update', patch),

  // Transcribe audio using WhisperX via ComfyUI
  transcribeAudio: (audioPath: string, startTime?: number, duration?: number): Promise<{ text: string | null; error: string | null }> =>
    ipcRenderer.invoke('transcribe-audio', audioPath, startTime, duration),

  // Extract a single video frame via ffmpeg (returns file path + file:// URL)
  extractVideoFrame: (videoUrl: string, seekTime: number, width?: number, quality?: number): Promise<{ path: string; url: string }> =>
    ipcRenderer.invoke('extract-video-frame', videoUrl, seekTime, width, quality),

  // Write a log line to the session log file
  writeLog: (level: string, message: string): Promise<void> =>
    ipcRenderer.invoke('write-log', level, message),

  // Update checking
  checkNodeUpdates: (): Promise<{ results: { name: string; hasUpdate: boolean; error?: string }[]; hasAnyUpdates: boolean }> =>
    ipcRenderer.invoke('updates:check-nodes'),
  updateNodes: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('updates:update-nodes'),
  checkAppUpdate: (): Promise<{ updateAvailable: boolean; currentVersion: string; latestVersion?: string }> =>
    ipcRenderer.invoke('updates:check-app'),
  onUpdateProgress: (callback: (_event: unknown, data: { phase: string; message: string; error?: string }) => void) => {
    ipcRenderer.on('updates:progress', callback)
    return () => { ipcRenderer.removeListener('updates:progress', callback) }
  },

  // Platform info
  platform: process.platform,
})

interface LogsResponse {
  logPath: string
  lines: string[]
  error?: string
}

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getModelsPath: () => Promise<string>
      readLocalFile: (filePath: string) => Promise<{ data: string; mimeType: string }>
      checkGpu: () => Promise<{ available: boolean; name?: string; vram?: number }>
      getAppInfo: () => Promise<{ version: string; isPackaged: boolean; modelsPath: string; userDataPath: string }>
      checkFirstRun: () => Promise<{ needsSetup: boolean; needsLicense: boolean }>
      acceptLicense: () => Promise<boolean>
      completeSetup: () => Promise<boolean>
      fetchLicenseText: () => Promise<string>
      getNoticesText: () => Promise<string>
      getDefaultComfyPath: () => Promise<string>
      validateComfyPath: (comfyPath: string) => Promise<{ valid: boolean; error?: string }>
      checkModels: (comfyPath: string) => Promise<{
        allPresent: boolean
        missing: { filename: string; sizeBytes: number }[]
        present: { filename: string; sizeBytes: number }[]
        missingBytes: number
        totalBytes: number
      }>
      startInstall: (comfyPath: string) => Promise<{ success: boolean; error?: string }>
      cancelInstall: () => Promise<void>
      getDiskSpace: (dirPath: string) => Promise<{ freeBytes: number }>
      onSetupProgress: (callback: (_event: unknown, data: Record<string, unknown>) => void) => () => void
      openLtxApiKeyPage: () => Promise<boolean>
      openParentFolderOfFile: (filePath: string) => Promise<void>
      showItemInFolder: (filePath: string) => Promise<void>
      getLogs: () => Promise<LogsResponse>
      getLogPath: () => Promise<{ logPath: string; logDir: string }>
      openLogFolder: () => Promise<boolean>
      getResourcePath: () => Promise<string | null>
      getDownloadsPath: () => Promise<string>
      ensureDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
      saveFile: (filePath: string, data: string, encoding?: string) => Promise<{ success: boolean; path?: string; error?: string }>
      saveBinaryFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; path?: string; error?: string }>
      showOpenDirectoryDialog: (options: { title?: string }) => Promise<string | null>
      searchDirectoryForFiles: (dir: string, filenames: string[]) => Promise<Record<string, string>>
      copyFile: (src: string, dest: string) => Promise<{ success: boolean; error?: string }>
      checkFilesExist: (filePaths: string[]) => Promise<Record<string, boolean>>
      showOpenFileDialog: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => Promise<string[] | null>
      exportNative: (data: {
        clips: { url: string; type: string; startTime: number; duration: number; trimStart: number; speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number; muted: boolean; volume: number }[];
        outputPath: string; codec: string; width: number; height: number; fps: number; quality: number;
        letterbox?: { ratio: number; color: string; opacity: number };
        subtitles?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean } }[];
      }) => Promise<{ success?: boolean; error?: string }>
      exportCancel: (sessionId: string) => Promise<{ ok?: boolean }>
      generateVideo: (params: {
        prompt: string
        imagePath?: string | null
        resolution: string
        aspectRatio: string
        duration: number
        fps: number
        cameraMotion?: string
        preserveAspectRatio?: boolean
        projectName?: string
      }) => Promise<{ status: string; video_path?: string; enhanced_prompt?: string; error?: string }>
      getGenerationProgress: () => Promise<{
        status: string
        phase: string
        progress: number
        currentStep: number | null
        totalSteps: number | null
      }>
      cancelGeneration: () => Promise<void>
      checkComfyUIHealth: () => Promise<{ connected: boolean }>
      getModelLists: () => Promise<{ checkpoints: string[]; textEncoders: string[]; upscaleModels: string[]; loras: string[]; samplers: string[] }>
      readVideoMetadata: (filePath: string) => Promise<Record<string, unknown> | null>
      getProjectRenders: (projectName: string) => Promise<Array<{
        filename: string; filePath: string; type: string; prompt: string;
        enhancedPrompt: string | null; seed: number; resolution: string;
        aspectRatio: string; duration: number; fps: number;
        cameraMotion?: string; timestamp: string;
        imagePath?: string | null; middleImagePath?: string | null; lastImagePath?: string | null;
        firstStrength?: number; middleStrength?: number; lastStrength?: number;
        preserveAspectRatio?: boolean;
      }>>
      getSettings: () => Promise<{
        comfyuiUrl: string
        comfyuiOutputDir: string
        seedLocked: boolean
        lockedSeed: number
        steps: number
        cfg: number
      }>
      updateSettings: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      extractVideoFrame: (videoUrl: string, seekTime: number, width?: number, quality?: number) => Promise<{ path: string; url: string }>
      writeLog: (level: string, message: string) => Promise<void>
      checkNodeUpdates: () => Promise<{ results: { name: string; hasUpdate: boolean; error?: string }[]; hasAnyUpdates: boolean }>
      updateNodes: () => Promise<{ success: boolean; error?: string }>
      checkAppUpdate: () => Promise<{ updateAvailable: boolean; currentVersion: string; latestVersion?: string }>
      onUpdateProgress: (callback: (_event: unknown, data: { phase: string; message: string; error?: string }) => void) => () => void
      platform: string
    }
  }
}

export {}
