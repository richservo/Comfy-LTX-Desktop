import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Video } from 'lucide-react'
import { useThumbnail } from '../../hooks/use-thumbnail'

export function VideoThumbnailCard({ url, thumbnailUrl: thumbnailUrlProp }: { url: string; thumbnailUrl?: string }) {
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [scrubProgress, setScrubProgress] = useState(0)
  const [scrubTime, setScrubTime] = useState('')
  const rafRef = useRef<number>(0)

  // Lazy thumbnail: only generate when visible, use prop if available
  const generatedThumb = useThumbnail(isVisible && !thumbnailUrlProp ? url : undefined, 'video')
  const thumbnailUrl = thumbnailUrlProp || generatedThumb

  // IntersectionObserver for lazy loading
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true) },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const drawFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width
      canvas.height = rect.height
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const video = videoRef.current
    const container = containerRef.current
    if (!video || !container || !video.duration || isNaN(video.duration)) return
    const rect = container.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const pct = x / rect.width
    const targetTime = pct * video.duration
    video.currentTime = targetTime
    setScrubProgress(pct)
    const mins = Math.floor(targetTime / 60)
    const secs = Math.floor(targetTime % 60)
    const frames = Math.floor((targetTime % 1) * 24)
    setScrubTime(`${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(drawFrame)
  }, [drawFrame])

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
    setVideoReady(false)
    setScrubProgress(0)
    setScrubTime('')
    const video = videoRef.current
    if (video) {
      video.currentTime = 0
      video.removeAttribute('src')
      video.load()
    }
  }, [])

  useEffect(() => {
    if (!isHovering) return
    const video = videoRef.current
    if (!video) return
    video.src = url
    video.preload = 'auto'
    video.load()

    const onLoaded = () => {
      setVideoReady(true)
      requestAnimationFrame(drawFrame)
    }
    video.addEventListener('loadeddata', onLoaded, { once: true })
    return () => video.removeEventListener('loadeddata', onLoaded)
  }, [isHovering, url, drawFrame])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !isHovering) return
    const onSeeked = () => requestAnimationFrame(drawFrame)
    video.addEventListener('seeked', onSeeked)
    return () => video.removeEventListener('seeked', onSeeked)
  }, [isHovering, drawFrame])

  return (
    <div
      ref={containerRef}
      className="w-full aspect-video relative overflow-hidden bg-zinc-900"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={isHovering ? handleMouseMove : undefined}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className={`w-full h-full object-cover absolute inset-0 ${isHovering && videoReady ? 'opacity-0' : 'opacity-100'} transition-opacity duration-100`}
        />
      ) : (
        <div className={`w-full h-full bg-zinc-800 absolute inset-0 flex items-center justify-center ${isHovering && videoReady ? 'opacity-0' : 'opacity-100'} transition-opacity duration-100`}>
          <Video className="h-5 w-5 text-zinc-600" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`w-full h-full object-cover absolute inset-0 ${isHovering && videoReady ? 'opacity-100' : 'opacity-0'} transition-opacity duration-100`}
      />

      <video
        ref={videoRef}
        className="hidden"
        muted
        playsInline
        preload="none"
      />

      {isHovering && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/40">
          <div
            className="h-full bg-blue-500 transition-none"
            style={{ width: `${scrubProgress * 100}%` }}
          />
        </div>
      )}

      {isHovering && videoReady && scrubTime && (
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm">
          <span className="text-[9px] text-white font-mono tabular-nums">{scrubTime}</span>
        </div>
      )}
    </div>
  )
}
