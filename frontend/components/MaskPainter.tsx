import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Brush, Eraser, Trash2, Check, Undo2 } from 'lucide-react'

interface MaskPainterProps {
  imagePath: string
  existingMask?: string
  onApply: (maskDataUrl: string) => void
  onCancel: () => void
}

type Tool = 'brush' | 'eraser'

export function MaskPainter({ imagePath, existingMask, onApply, onCancel }: MaskPainterProps) {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  const [imgNaturalWidth, setImgNaturalWidth] = useState(0)
  const [imgNaturalHeight, setImgNaturalHeight] = useState(0)
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(30)
  const [feather, setFeather] = useState(0.5)
  const [isLoaded, setIsLoaded] = useState(false)

  const isPainting = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const sourceImgRef = useRef<HTMLImageElement>(null)
  // Undo stack — snapshots of mask ImageData taken before each stroke
  const undoStack = useRef<ImageData[]>([])
  const [undoCount, setUndoCount] = useState(0)
  // Cache ctx and rect to avoid per-event lookups
  const maskCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const canvasRectRef = useRef<DOMRect | null>(null)
  // Refs for values used in native event handlers (avoid stale closures)
  const toolRef = useRef<Tool>('brush')
  const brushSizeRef = useRef(30)
  const featherRef = useRef(0.5)
  const scaleRef = useRef(1)

  // Keep refs in sync
  toolRef.current = tool
  brushSizeRef.current = brushSize
  featherRef.current = feather
  scaleRef.current = scale

  // Pre-bake a radial alpha stamp onto an offscreen canvas.
  // Recomputed only when brushSize or feather changes.
  const stampRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const size = brushSize
    const r = size / 2
    const diam = size
    const c = document.createElement('canvas')
    c.width = diam
    c.height = diam
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r)
    const hardEdge = 1 - feather
    grad.addColorStop(0, 'rgba(255,255,255,0.95)')
    grad.addColorStop(hardEdge, 'rgba(255,255,255,0.95)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, diam, diam)
    stampRef.current = c
  }, [brushSize, feather])

  const initCanvas = useCallback(() => {
    const img = sourceImgRef.current
    if (!img || !img.naturalWidth) return

    const natW = img.naturalWidth
    const natH = img.naturalHeight
    setImgNaturalWidth(natW)
    setImgNaturalHeight(natH)

    const maxW = window.innerWidth * 0.9
    const maxH = window.innerHeight * 0.8
    const s = Math.min(1, maxW / natW, maxH / natH)
    setScale(s)

    const imageCanvas = imageCanvasRef.current
    if (!imageCanvas) return
    imageCanvas.width = natW
    imageCanvas.height = natH
    const ctx = imageCanvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)

    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return
    maskCanvas.width = natW
    maskCanvas.height = natH
    maskCtxRef.current = maskCanvas.getContext('2d')

    if (existingMask) {
      const maskImg = document.createElement('img')
      maskImg.onload = () => {
        const maskCtx = maskCtxRef.current
        if (!maskCtx) return
        maskCtx.drawImage(maskImg, 0, 0)
        const imageData = maskCtx.getImageData(0, 0, natW, natH)
        const d = imageData.data
        for (let i = 0; i < d.length; i += 4) {
          const brightness = d[i]
          d[i] = 255
          d[i + 1] = 255
          d[i + 2] = 255
          d[i + 3] = brightness
        }
        maskCtx.putImageData(imageData, 0, 0)
        setIsLoaded(true)
      }
      maskImg.src = existingMask
    } else {
      setIsLoaded(true)
    }
  }, [existingMask])

  // Paint using the pre-baked stamp — no gradient creation per point
  const paintAt = useCallback((x: number, y: number) => {
    const ctx = maskCtxRef.current
    const stamp = stampRef.current
    if (!ctx || !stamp) return
    const bs = brushSizeRef.current
    const r = bs / 2

    if (toolRef.current === 'brush') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(stamp, x - r, y - r)
    } else {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(stamp, x - r, y - r)
      ctx.globalCompositeOperation = 'source-over'
    }
  }, [])

  const paintStroke = useCallback((x: number, y: number, prevX: number | null, prevY: number | null) => {
    if (prevX != null && prevY != null) {
      const dist = Math.hypot(x - prevX, y - prevY)
      const spacing = Math.max(2, brushSizeRef.current * 0.15)
      const steps = Math.max(1, Math.ceil(dist / spacing))
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        paintAt(prevX + (x - prevX) * t, prevY + (y - prevY) * t)
      }
    } else {
      paintAt(x, y)
    }
  }, [paintAt])

  // Use native pointer events on the mask canvas for lower latency
  useEffect(() => {
    const canvas = maskCanvasRef.current
    if (!canvas || !isLoaded) return

    const getPos = (e: PointerEvent) => {
      if (!canvasRectRef.current) canvasRectRef.current = canvas.getBoundingClientRect()
      const rect = canvasRectRef.current
      const s = scaleRef.current
      return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s }
    }

    const moveCursor = (e: PointerEvent) => {
      const cursor = cursorRef.current
      if (!cursor) return
      if (!canvasRectRef.current) canvasRectRef.current = canvas.getBoundingClientRect()
      const rect = canvasRectRef.current
      cursor.style.left = `${e.clientX - rect.left}px`
      cursor.style.top = `${e.clientY - rect.top}px`
      cursor.style.display = 'block'
    }

    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      canvas.setPointerCapture(e.pointerId)
      canvasRectRef.current = canvas.getBoundingClientRect()
      if (e.button === 2 || e.altKey) toolRef.current = 'eraser'
      // Snapshot before stroke for undo
      const ctx = maskCtxRef.current
      if (ctx) {
        undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
        if (undoStack.current.length > 50) undoStack.current.shift()
        setUndoCount(undoStack.current.length)
      }
      isPainting.current = true
      const pos = getPos(e)
      lastPos.current = pos
      paintAt(pos.x, pos.y)
      moveCursor(e)
    }

    const onMove = (e: PointerEvent) => {
      moveCursor(e)
      if (!isPainting.current) return
      const pos = getPos(e)
      const prev = lastPos.current
      paintStroke(pos.x, pos.y, prev?.x ?? null, prev?.y ?? null)
      lastPos.current = pos
    }

    const onUp = (e: PointerEvent) => {
      isPainting.current = false
      lastPos.current = null
      canvas.releasePointerCapture(e.pointerId)
      if (e.button === 2 || e.altKey) toolRef.current = 'brush'
    }

    const onLeave = () => {
      lastPos.current = null
      const cursor = cursorRef.current
      if (cursor) cursor.style.display = 'none'
    }

    const onContext = (e: Event) => e.preventDefault()

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = -Math.sign(e.deltaY) * 5
      const next = Math.max(5, Math.min(200, brushSizeRef.current + delta))
      brushSizeRef.current = next
      setBrushSize(next)
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('contextmenu', onContext)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('contextmenu', onContext)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [isLoaded, paintAt, paintStroke])

  // Invalidate cached rect on resize
  useEffect(() => {
    const onResize = () => { canvasRectRef.current = null }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const undo = useCallback(() => {
    const ctx = maskCtxRef.current
    const snapshot = undoStack.current.pop()
    if (!ctx || !snapshot) return
    ctx.putImageData(snapshot, 0, 0)
    setUndoCount(undoStack.current.length)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      else if (e.key === 'b' || e.key === 'B') { setTool('brush'); toolRef.current = 'brush' }
      else if (e.key === 'e' || e.key === 'E') { setTool('eraser'); toolRef.current = 'eraser' }
      else if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, undo])

  const handleClear = useCallback(() => {
    const ctx = maskCtxRef.current
    if (!ctx) return
    ctx.clearRect(0, 0, imgNaturalWidth, imgNaturalHeight)
  }, [imgNaturalWidth, imgNaturalHeight])

  const handleApply = useCallback(() => {
    const ctx = maskCtxRef.current
    if (!ctx) return

    const maskData = ctx.getImageData(0, 0, imgNaturalWidth, imgNaturalHeight)

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = imgNaturalWidth
    exportCanvas.height = imgNaturalHeight
    const exportCtx = exportCanvas.getContext('2d')
    if (!exportCtx) return

    const outData = exportCtx.createImageData(imgNaturalWidth, imgNaturalHeight)
    const src = maskData.data
    const dst = outData.data
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3]
      dst[i] = a
      dst[i + 1] = a
      dst[i + 2] = a
      dst[i + 3] = 255
    }
    exportCtx.putImageData(outData, 0, 0)

    onApply(exportCanvas.toDataURL('image/png'))
  }, [imgNaturalWidth, imgNaturalHeight, onApply])

  const displayW = Math.round(imgNaturalWidth * scale)
  const displayH = Math.round(imgNaturalHeight * scale)
  const cursorSize = brushSize * scale

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="flex flex-col bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl overflow-hidden"
        style={{ maxWidth: '95vw', maxHeight: '95vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <h2 className="text-sm font-bold text-white mr-2">Paint Mask</h2>

          <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setTool('brush')}
              title="Brush (B)"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tool === 'brush'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
              }`}
            >
              <Brush className="h-3.5 w-3.5" />
              Brush
            </button>
            <button
              onClick={() => setTool('eraser')}
              title="Eraser (E) / Right-click or Alt+drag"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tool === 'eraser'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
              }`}
            >
              <Eraser className="h-3.5 w-3.5" />
              Eraser
            </button>
          </div>

          <div className="flex items-center gap-2 ml-2">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold whitespace-nowrap">Size</span>
            <input
              type="range"
              min={5}
              max={200}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              className="w-24 h-1.5 accent-violet-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-400 w-8 text-right">{brushSize}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold whitespace-nowrap">Feather</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={feather}
              onChange={(e) => setFeather(parseFloat(e.target.value))}
              className="w-24 h-1.5 accent-violet-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-400 w-8 text-right">{Math.round(feather * 100)}%</span>
          </div>

          <div className="flex-1" />

          <button
            onClick={undo}
            disabled={undoCount === 0}
            title="Undo (Ctrl+Z)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>

          <button
            onClick={handleClear}
            title="Clear mask"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>

          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hidden image loader */}
        <img
          ref={sourceImgRef}
          src={imagePath}
          onLoad={initCanvas}
          style={{ display: 'none' }}
        />

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden flex items-center justify-center bg-zinc-950 p-4"
        >
          {!isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">Loading image...</div>
          )}

            <div
              className="relative"
              style={{ width: displayW, height: displayH, visibility: isLoaded ? 'visible' : 'hidden' }}
            >
              <canvas
                ref={imageCanvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: displayW,
                  height: displayH,
                  display: 'block',
                }}
              />

              <canvas
                ref={maskCanvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: displayW,
                  height: displayH,
                  display: 'block',
                  opacity: 0.55,
                  cursor: 'none',
                  mixBlendMode: 'screen',
                  touchAction: 'none',
                }}
              />

              {/* Brush cursor */}
              <div
                ref={cursorRef}
                style={{
                  display: 'none',
                  position: 'absolute',
                  width: cursorSize,
                  height: cursorSize,
                  borderRadius: '50%',
                  border: `1.5px solid ${tool === 'brush' ? 'rgba(167,139,250,0.8)' : 'rgba(239,68,68,0.8)'}`,
                  pointerEvents: 'none',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 flex-shrink-0">
          <p className="text-xs text-zinc-500">
            {imgNaturalWidth > 0 && `${imgNaturalWidth} × ${imgNaturalHeight}px`}
            <span className="ml-2 text-zinc-600">B/E = tools, Scroll = size, Right-click = erase</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!isLoaded}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Check className="h-4 w-4" />
              Apply Mask
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
