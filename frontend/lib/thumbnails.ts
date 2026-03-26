/**
 * Thumbnail generation and video frame extraction utilities.
 *
 * Uses an off-screen <video> + <canvas> to capture a single frame
 * and return it as a small JPEG blob URL, suitable for fast grid thumbnails.
 */

export const THUMB_SIZE_SMALL = 320
export const THUMB_SIZE_MEDIUM = 480
export const THUMB_SIZE_LARGE = 640

const THUMB_QUALITY = 0.7

/** Cache key includes width so different sizes don't collide */
function cacheKey(url: string, width: number): string {
  return `${url}::${width}`
}

/** Cache: "url::width" → thumbnailBlobUrl */
const thumbnailCache = new Map<string, string>()

/** In-flight dedup: "url::width" → pending promise */
const inflightMap = new Map<string, Promise<string>>()

/**
 * Extract a single frame from a video URL at the given time (default 0.1s)
 * and return a lightweight blob: URL pointing to a JPEG snapshot.
 *
 * The result is cached so subsequent calls with the same URL+width are instant.
 */
export function generateThumbnail(
  videoUrl: string,
  seekTime = 0.1,
  width = THUMB_SIZE_SMALL,
): Promise<string> {
  const key = cacheKey(videoUrl, width)
  const cached = thumbnailCache.get(key)
  if (cached) return Promise.resolve(cached)

  const inflight = inflightMap.get(key)
  if (inflight) return inflight

  const promise = new Promise<string>((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    const onSeeked = () => {
      try {
        const canvas = document.createElement('canvas')
        const aspect = video.videoWidth / video.videoHeight
        canvas.width = width
        canvas.height = Math.round(width / aspect) || width
        const ctx = canvas.getContext('2d')
        if (!ctx) { cleanup(); reject(new Error('canvas 2d context unavailable')); return }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            cleanup()
            if (!blob) { reject(new Error('toBlob returned null')); return }
            const blobUrl = URL.createObjectURL(blob)
            thumbnailCache.set(key, blobUrl)
            resolve(blobUrl)
          },
          'image/jpeg',
          THUMB_QUALITY,
        )
      } catch (err) {
        cleanup()
        reject(err)
      }
    }

    const onError = () => {
      cleanup()
      reject(new Error(`Failed to load video for thumbnail: ${videoUrl}`))
    }

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })

    video.addEventListener(
      'loadeddata',
      () => {
        video.currentTime = Math.min(seekTime, video.duration || 0)
      },
      { once: true },
    )

    video.src = videoUrl
  })

  inflightMap.set(key, promise)
  promise.finally(() => inflightMap.delete(key))
  return promise
}

/**
 * Batch-generate thumbnails for multiple video URLs.
 * Returns a map of videoUrl → blobUrl for all that succeeded.
 * Failures are silently skipped (the caller can fall back to the original URL).
 */
export async function generateThumbnailsBatch(
  videoUrls: string[],
  concurrency = 3,
  width = THUMB_SIZE_SMALL,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const queue = [...videoUrls]

  const worker = async () => {
    while (queue.length > 0) {
      const url = queue.shift()!
      try {
        const thumb = await generateThumbnail(url, 0.1, width)
        results.set(url, thumb)
      } catch {
        // skip – caller will fall back to original url
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
  return results
}

/**
 * Look up a cached thumbnail. Returns undefined if not yet generated.
 */
export function getCachedThumbnail(videoUrl: string, width = THUMB_SIZE_SMALL): string | undefined {
  return thumbnailCache.get(cacheKey(videoUrl, width))
}

/**
 * Warm the cache for a single URL (fire-and-forget).
 */
export function warmThumbnail(videoUrl: string, width = THUMB_SIZE_SMALL): void {
  if (thumbnailCache.has(cacheKey(videoUrl, width))) return
  generateThumbnail(videoUrl, 0.1, width).catch(() => {})
}
