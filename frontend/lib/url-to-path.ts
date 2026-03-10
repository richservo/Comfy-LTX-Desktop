/**
 * Extract a filesystem path from a `file://` URL.
 * Returns `null` when the URL is not a file URL.
 */
export function fileUrlToPath(url: string): string | null {
  if (url.startsWith('file://')) {
    let p = decodeURIComponent(url.slice(7)) // file:///Users/x -> /Users/x
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    return p
  }
  return null
}

/**
 * Convert an Electron File (which has a .path property) to a file:// URL.
 * Falls back to URL.createObjectURL if .path is unavailable (non-Electron).
 */
export function fileToFileUrl(file: File): string {
  const filePath = (file as unknown as { path?: string }).path
  if (filePath) {
    const normalized = filePath.replace(/\\/g, '/')
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
  }
  return URL.createObjectURL(file)
}

/**
 * Resolve an image URL from a drop event.
 * Handles both internal asset drags (custom 'asset' dataTransfer) and
 * external file drops (dataTransfer.files).
 * Returns the file:// URL string, or null if the drop contained no usable image.
 */
export function resolveImageDrop(e: React.DragEvent): string | null {
  // 1. Check for internal asset drag (gallery card)
  const assetData = e.dataTransfer.getData('asset')
  if (assetData) {
    try {
      const asset = JSON.parse(assetData) as { type?: string; url?: string }
      if (asset.type === 'image' && asset.url) return asset.url
    } catch { /* fall through */ }
  }

  // 2. Check for external file drop
  const file = e.dataTransfer.files?.[0]
  if (file && file.type.startsWith('image/')) {
    return fileToFileUrl(file)
  }

  return null
}

/**
 * Resolve an audio URL from a drop event.
 * Handles external file drops (dataTransfer.files).
 * Returns the file:// URL string, or null if the drop contained no usable audio.
 */
export function resolveAudioDrop(e: React.DragEvent): string | null {
  const file = e.dataTransfer.files?.[0]
  if (file && file.type.startsWith('audio/')) {
    return fileToFileUrl(file)
  }
  return null
}
