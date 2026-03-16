/**
 * Load audio data from a URL into an ArrayBuffer suitable for decodeAudioData().
 *
 * Strategy (tried in order):
 * 1. fetch() — works for http://, and for file:// when webSecurity is off (dev mode).
 * 2. readLocalFileBuffer IPC — binary transfer, efficient for large files.
 * 3. readLocalFile IPC — base64 fallback for older builds.
 *
 * For file:// URLs, the <audio> element approach used by getMediaDuration()
 * proves Electron can load them, but Web Audio's decodeAudioData needs raw bytes.
 */
export async function fetchAudioBuffer(url: string): Promise<ArrayBuffer> {
  // For file:// URLs, use IPC (fetch is blocked by CSP in Electron).
  // Paths must be approved via window.electronAPI.approvePath() at import time.
  if (url.startsWith('file://')) {
    if (window.electronAPI?.readLocalFileBuffer) {
      const raw = await window.electronAPI.readLocalFileBuffer(url)
      const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBufferLike)
      return u8.slice().buffer
    }

    if (window.electronAPI?.readLocalFile) {
      const { data } = await window.electronAPI.readLocalFile(url)
      const bin = atob(data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return bytes.buffer
    }
  }

  // http/blob URLs
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`fetch failed: ${resp.status} ${resp.statusText}`)
  return resp.arrayBuffer()
}
