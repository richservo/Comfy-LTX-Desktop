// Python setup — disabled in ComfyUI integration (ComfyUI manages its own environment)
export function getPythonDir(): string { return '' }
export async function downloadPythonEmbed(): Promise<void> { /* no-op */ }
export async function preDownloadPythonForUpdate(
  _newVersion: string,
  _onProgress?: (progress: number) => void
): Promise<boolean> { return false }
