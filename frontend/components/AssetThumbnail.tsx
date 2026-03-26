import { useRef, useEffect, useState } from 'react'
import { useThumbnail } from '../hooks/use-thumbnail'
import { THUMB_SIZE_SMALL } from '../lib/thumbnails'

/**
 * Lazy-loaded, low-res thumbnail for video/image assets.
 * Only generates the thumbnail when the element enters the viewport.
 * Width defaults to 320px; pass a larger value for bigger grid cards.
 */
export function AssetThumbnail({
  src,
  type,
  className,
  alt = '',
  width = THUMB_SIZE_SMALL,
}: {
  src: string
  type: 'video' | 'image'
  className?: string
  alt?: string
  width?: number
}) {
  const ref = useRef<HTMLImageElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true) },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const thumbUrl = useThumbnail(isVisible ? src : undefined, type, width)

  return (
    <img
      ref={ref}
      src={thumbUrl}
      alt={alt}
      className={className}
      loading="lazy"
      draggable={false}
    />
  )
}
