import { useState, useEffect } from 'react'
import { generateThumbnail, getCachedThumbnail, THUMB_SIZE_SMALL } from '../lib/thumbnails'

/**
 * Returns a lightweight JPEG blob URL for a video/image source.
 * For videos: extracts a single frame at 0.1s via off-screen canvas.
 * For images: downscales via off-screen canvas.
 * Width defaults to 320px (THUMB_SIZE_SMALL).
 * Returns undefined while generating (renders nothing until ready).
 */
export function useThumbnail(
  src: string | undefined,
  type?: 'video' | 'image',
  width = THUMB_SIZE_SMALL,
): string | undefined {
  const [thumbUrl, setThumbUrl] = useState<string | undefined>(() => {
    if (!src) return undefined
    if (type === 'image') return getCachedImageThumbnail(src, width)
    return getCachedThumbnail(src, width)
  })

  useEffect(() => {
    if (!src) { setThumbUrl(undefined); return }

    const cached = type === 'image' ? getCachedImageThumbnail(src, width) : getCachedThumbnail(src, width)
    if (cached) { setThumbUrl(cached); return }

    let cancelled = false

    const gen = type === 'image' ? generateImageThumbnail(src, width) : generateThumbnail(src, 0.1, width)
    gen.then((url) => {
      if (!cancelled) setThumbUrl(url)
    }).catch(() => {
      if (!cancelled) setThumbUrl(src)
    })

    return () => { cancelled = true }
  }, [src, type, width])

  return thumbUrl
}

// ── Image thumbnail generation (mirrors video thumbnail pattern) ──

const THUMB_QUALITY = 0.7

function imageCacheKey(url: string, width: number): string {
  return `${url}::${width}`
}

const imageThumbCache = new Map<string, string>()
const imageInflightMap = new Map<string, Promise<string>>()

export function getCachedImageThumbnail(url: string, width = THUMB_SIZE_SMALL): string | undefined {
  return imageThumbCache.get(imageCacheKey(url, width))
}

function generateImageThumbnail(imageUrl: string, width = THUMB_SIZE_SMALL): Promise<string> {
  const key = imageCacheKey(imageUrl, width)
  const cached = imageThumbCache.get(key)
  if (cached) return Promise.resolve(cached)

  const inflight = imageInflightMap.get(key)
  if (inflight) return inflight

  const promise = new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const aspect = img.naturalWidth / img.naturalHeight
        canvas.width = width
        canvas.height = Math.round(width / aspect) || width
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas 2d unavailable')); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('toBlob null')); return }
            const blobUrl = URL.createObjectURL(blob)
            imageThumbCache.set(key, blobUrl)
            resolve(blobUrl)
          },
          'image/jpeg',
          THUMB_QUALITY,
        )
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`))
    img.src = imageUrl
  })

  imageInflightMap.set(key, promise)
  promise.finally(() => imageInflightMap.delete(key))
  return promise
}
