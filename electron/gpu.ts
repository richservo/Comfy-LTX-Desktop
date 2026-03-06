// GPU check — disabled in ComfyUI integration (ComfyUI manages GPU access)
export async function checkGPU(): Promise<{ available: boolean; name?: string; vram?: number }> {
  return { available: true }
}
