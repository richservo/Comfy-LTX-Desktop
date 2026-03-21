/// <reference types="vite/client" />

interface LogsResponse {
  logPath: string
  lines: string[]
  error?: string
}

interface Window {
  electronAPI: {
    getModelsPath: () => Promise<string>
    readLocalFile: (filePath: string) => Promise<{ data: string; mimeType: string }>
    readLocalFileBuffer: (filePath: string) => Promise<ArrayBuffer>
    approvePath: (filePath: string) => Promise<void>
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
    openFalApiKeyPage: () => Promise<boolean>
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
    copyFile: (src: string, dest: string) => Promise<{ success: boolean; error?: string }>
    checkFilesExist: (filePaths: string[]) => Promise<Record<string, boolean>>
    showOpenFileDialog: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => Promise<string[] | null>
    searchDirectoryForFiles: (directory: string, filenames: string[]) => Promise<Record<string, string | null>>
    exportNative: (data: {
      clips: { url: string; type: string; startTime: number; duration: number; trimStart: number; speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number; muted: boolean; volume: number }[]
      outputPath: string; codec: string; width: number; height: number; fps: number; quality: number
      letterbox?: { ratio: number; color: string; opacity: number }
      subtitles?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean } }[]
    }) => Promise<{ success?: boolean; error?: string }>
    exportCancel: (sessionId: string) => Promise<{ ok?: boolean }>
    generateVideo: (params: {
      prompt: string
      imagePath?: string | null
      middleImagePath?: string | null
      lastImagePath?: string | null
      audioPath?: string | null
      resolution: string
      aspectRatio: string
      duration: number
      fps: number
      cameraMotion?: string
      spatialUpscale?: boolean
      upscaleDenoise?: number
      temporalUpscale?: boolean
      filmGrain?: boolean
      filmGrainIntensity?: number
      filmGrainSize?: number
      firstStrength?: number
      middleStrength?: number
      lastStrength?: number
      imageMode?: boolean
      imageSteps?: number
      rtxSuperRes?: boolean
      projectName?: string
    }) => Promise<{ status: string; video_path?: string; image_path?: string; enhanced_prompt?: string; error?: string }>
    getGenerationProgress: () => Promise<{
      status: string
      phase: string
      progress: number
      currentStep: number | null
      totalSteps: number | null
    }>
    cancelGeneration: () => Promise<void>
    checkComfyUIHealth: () => Promise<{ connected: boolean }>
    getModelLists: () => Promise<{ checkpoints: string[]; textEncoders: string[]; upscaleModels: string[]; loras: string[]; samplers: string[]; hasRtxSuperRes?: boolean; hasZImage?: boolean }>
    readVideoMetadata: (filePath: string) => Promise<Record<string, unknown> | null>
    extractAudioSegment: (params: { sourcePath: string; startTime: number; duration: number }) => Promise<string>
    getProjectRenders: (projectName: string) => Promise<Array<{
      filename: string; filePath: string; type: string; prompt: string;
      enhancedPrompt: string | null; seed: number; resolution: string;
      aspectRatio: string; duration: number; fps: number;
      cameraMotion?: string; spatialUpscale?: boolean; temporalUpscale?: boolean;
      filmGrain?: boolean; promptEnhance?: boolean; rtxSuperRes?: boolean;
      imagePath?: string | null; middleImagePath?: string | null; lastImagePath?: string | null;
      firstStrength?: number; middleStrength?: number; lastStrength?: number;
      preserveAspectRatio?: boolean;
      timestamp: string;
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
    transcribeAudio: (audioPath: string, startTime?: number, duration?: number) => Promise<{ text: string | null; error: string | null }>
    extractVideoFrame: (videoUrl: string, seekTime: number, width?: number, quality?: number) => Promise<{ path: string; url: string }>
    writeLog: (level: string, message: string) => Promise<void>
    checkNodeUpdates: () => Promise<{ results: { name: string; hasUpdate: boolean; error?: string }[]; hasAnyUpdates: boolean }>
    updateNodes: () => Promise<{ success: boolean; error?: string }>
    checkAppUpdate: () => Promise<{ updateAvailable: boolean; currentVersion: string; latestVersion?: string }>
    onUpdateProgress: (callback: (_event: unknown, data: { phase: string; message: string; error?: string }) => void) => () => void
    platform: string
  }
}
