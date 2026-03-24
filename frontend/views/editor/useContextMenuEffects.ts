import { useEffect, useCallback } from 'react'

interface ContextMenuState {
  x: number
  y: number
  [key: string]: any
}

interface UseContextMenuEffectsParams {
  timelineContextMenu: ContextMenuState | null
  setTimelineContextMenu: (v: any) => void
  timelineContextMenuRef: React.RefObject<HTMLDivElement>
  clipContextMenu: { clipId: string; x: number; y: number } | null
  setClipContextMenu: (v: any) => void
  clipContextMenuRef: React.RefObject<HTMLDivElement>
  assetContextMenu: ContextMenuState | null
  setAssetContextMenu: (v: any) => void
  assetContextMenuRef: React.RefObject<HTMLDivElement>
  takeContextMenu: ContextMenuState | null
  setTakeContextMenu: (v: any) => void
  takeContextMenuRef: React.RefObject<HTMLDivElement>
  binContextMenu: ContextMenuState | null
  setBinContextMenu: (v: any) => void
  binContextMenuRef: React.RefObject<HTMLDivElement>
  previewZoomOpen: boolean
  setPreviewZoomOpen: (v: boolean) => void
  playbackResOpen: boolean
  setPlaybackResOpen: (v: boolean) => void
  previewZoom: number | 'fit'
  setPreviewZoom: React.Dispatch<React.SetStateAction<number | 'fit'>>
  setPreviewPan: (v: { x: number; y: number }) => void
  previewContainerRef: React.RefObject<HTMLDivElement>
  setIsFullscreen: (v: boolean) => void
  setVideoFrameSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>
  timelineAddMenuOpen: boolean
  setTimelineAddMenuOpen: (v: boolean) => void
  creatingBin: boolean
  newBinInputRef: React.RefObject<HTMLInputElement>
  timelineResolution?: { width: number; height: number }
}

export function useContextMenuEffects(params: UseContextMenuEffectsParams) {
  const {
    timelineContextMenu, setTimelineContextMenu, timelineContextMenuRef,
    clipContextMenu, setClipContextMenu, clipContextMenuRef,
    assetContextMenu, setAssetContextMenu, assetContextMenuRef,
    takeContextMenu, setTakeContextMenu, takeContextMenuRef,
    binContextMenu, setBinContextMenu, binContextMenuRef,
    previewZoomOpen, setPreviewZoomOpen,
    playbackResOpen, setPlaybackResOpen,
    previewZoom, setPreviewZoom, setPreviewPan,
    previewContainerRef, setIsFullscreen, setVideoFrameSize,
    timelineAddMenuOpen, setTimelineAddMenuOpen,
    creatingBin, newBinInputRef, timelineResolution,
  } = params

  // Close timeline context menu on click elsewhere
  useEffect(() => {
    if (!timelineContextMenu) return
    const handler = () => setTimelineContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [timelineContextMenu])
  
  // Adjust timeline context menu position to stay within viewport
  useEffect(() => {
    if (!timelineContextMenu || !timelineContextMenuRef.current) return
    const el = timelineContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = timelineContextMenu
    let adjusted = false
    
    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }
    
    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [timelineContextMenu])
  
  
  // Close clip context menu on click elsewhere
  useEffect(() => {
    if (!clipContextMenu) return
    const handler = () => setClipContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [clipContextMenu])
  
  // Adjust context menu position to stay within viewport
  useEffect(() => {
    if (!clipContextMenu || !clipContextMenuRef.current) return
    const el = clipContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = clipContextMenu
    let adjusted = false
    
    if (rect.right > vw - 8) {
      x = vw - rect.width - 8
      adjusted = true
    }
    if (rect.bottom > vh - 8) {
      y = vh - rect.height - 8
      adjusted = true
    }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }
    
    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [clipContextMenu])
  
  // Close zoom dropdown on click outside
  // Defer listener attachment by one frame to avoid catching the same click that opened it
  useEffect(() => {
    if (!previewZoomOpen) return
    const handler = () => setPreviewZoomOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('click', handler) }
  }, [previewZoomOpen])
  
  // Close playback resolution dropdown on click outside
  useEffect(() => {
    if (!playbackResOpen) return
    const handler = () => setPlaybackResOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('click', handler) }
  }, [playbackResOpen])
  
  // Reset pan when switching to fit
  useEffect(() => {
    if (previewZoom === 'fit') setPreviewPan({ x: 0, y: 0 })
  }, [previewZoom])
  
  // Fullscreen toggle for preview
  const toggleFullscreen = useCallback(() => {
    const el = previewContainerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen().catch(() => {})
    }
  }, [])

  // Track fullscreen state changes (user can exit via Esc too)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Populate fullscreen ref for keyboard handler

  // Mouse wheel zoom on preview
  useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setPreviewZoom(prev => {
        const current = prev === 'fit' ? 100 : prev
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const next = Math.round(Math.min(1600, Math.max(10, current * delta)))
        return next
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])
  
  // Observe preview container size → compute video frame dimensions ("contain" fit to project resolution)
  useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return
    const PROJECT_RATIO = timelineResolution
      ? timelineResolution.width / timelineResolution.height
      : 16 / 9
    const compute = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      let fw: number, fh: number
      if (width / height > PROJECT_RATIO) {
        // Container is wider → height is the constraint
        fh = height
        fw = height * PROJECT_RATIO
      } else {
        // Container is taller → width is the constraint
        fw = width
        fh = width / PROJECT_RATIO
      }
      setVideoFrameSize(prev => (prev.width === fw && prev.height === fh) ? prev : { width: fw, height: fh })
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
  }, [timelineResolution])

  // Close asset context menu on click elsewhere
  useEffect(() => {
    if (!assetContextMenu) return
    const handler = () => setAssetContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [assetContextMenu])
  
  // Close timeline add menu on click elsewhere
  useEffect(() => {
    if (!timelineAddMenuOpen) return
    const handler = () => setTimelineAddMenuOpen(false)
    // Delay so the toggle click itself doesn't immediately close
    const timer = setTimeout(() => window.addEventListener('click', handler), 0)
    return () => { clearTimeout(timer); window.removeEventListener('click', handler) }
  }, [timelineAddMenuOpen])
  
  // Adjust asset context menu position to stay within viewport
  useEffect(() => {
    if (!assetContextMenu || !assetContextMenuRef.current) return
    const el = assetContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = assetContextMenu
    let adjusted = false
    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }
    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [assetContextMenu])
  
  // Close take context menu on click elsewhere
  useEffect(() => {
    if (!takeContextMenu) return
    const handler = () => setTakeContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [takeContextMenu])
  
  // Adjust take context menu position
  useEffect(() => {
    if (!takeContextMenu || !takeContextMenuRef.current) return
    const el = takeContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = takeContextMenu
    let adjusted = false
    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }
    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [takeContextMenu])
  
  // Close bin context menu on click elsewhere
  useEffect(() => {
    if (!binContextMenu) return
    const handler = () => setBinContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [binContextMenu])
  
  // Adjust bin context menu position to stay within viewport
  useEffect(() => {
    if (!binContextMenu || !binContextMenuRef.current) return
    const el = binContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = binContextMenu
    let adjusted = false
    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }
    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [binContextMenu])
  
  // Focus new bin input when creating
  useEffect(() => {
    if (creatingBin) {
      setTimeout(() => newBinInputRef.current?.focus(), 0)
    }
  }, [creatingBin])

  return { toggleFullscreen }
}
