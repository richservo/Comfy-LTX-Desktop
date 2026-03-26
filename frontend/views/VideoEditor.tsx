import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Trash2,
  ZoomIn, ZoomOut, Maximize2,
  Volume2, VolumeX, Copy,
  Layers,
  Gauge, Upload,
  Magnet, Lock, Unlock, GripVertical, Pencil, Film,
  Palette,
  Eye, EyeOff, ChevronRight, ChevronLeft,
  Music,
  X, RefreshCw, Loader2,
  MessageSquare, FileUp, FileDown,
  Link2, Type, // EFFECTS HIDDEN: removed Search // IC-LORA HIDDEN: removed Sparkles
  CircleDot, Circle, RotateCcw, Save, LayoutGrid, PanelRight, Folder
} from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { useKeyboardShortcuts } from '../contexts/KeyboardShortcutsContext'
import { useGeneration } from '../contexts/GenerationContext'
import { Button } from '../components/ui/button'
import { logger } from '../lib/logger'
import { Tooltip } from '../components/ui/tooltip'
import { ExportModal } from '../components/ExportModal'
import { MenuBar, type MenuDefinition } from '../components/MenuBar'
import { ImportTimelineModal } from '../components/ImportTimelineModal'
import { ClipWaveform } from '../components/AudioWaveform'
import { VolumeAutomationOverlay } from '../components/VolumeAutomationOverlay'
// IC-LORA HIDDEN - import { ICLoraPanel } from '../components/ICLoraPanel'
import type { TimelineClip, Track, SubtitleClip, Asset, InferenceStack, TimelineMarker } from '../types/project' // EFFECTS HIDDEN: removed EffectType
import { DEFAULT_TRACKS, MARKER_COLORS } from '../types/project' // EFFECTS HIDDEN: removed EFFECT_DEFINITIONS
import {
  type ToolType, PRIMARY_TOOLS, TRIM_TOOLS,
  AUTOSAVE_DELAY, CUT_POINT_TOLERANCE, DEFAULT_DISSOLVE_DURATION, SNAP_THRESHOLD,
  type EditorLayout, DEFAULT_LAYOUT, LAYOUT_LIMITS,
  getShortcutLabel, tooltipLabel, loadLayout, saveLayout, clampVal,
  migrateClip, migrateTracks, // EFFECTS HIDDEN: removed getClipEffectStyles
  formatTime, parseTime, getColorLabel,
  type LayoutPreset, loadLayoutPresets, saveLayoutPresets,
  clampRollDelta, applyRollEdit, getSnapTargets, snapToTargets,
} from './editor/video-editor-utils'
import { LeftPanel } from './editor/LeftPanel'
import { ClipContextMenu } from './editor/ClipContextMenu'
import { AssetContextMenu } from './editor/AssetContextMenu'
import { TakeContextMenu } from './editor/TakeContextMenu'
import { ClipPropertiesPanel } from './editor/ClipPropertiesPanel'
import { SubtitlePropertiesPanel } from './editor/SubtitlePropertiesPanel'
import { SourceMonitor } from './editor/SourceMonitor'
import { ProgramMonitor } from './editor/ProgramMonitor'
import { useUndoRedo } from './editor/useUndoRedo'
import { useEditorKeyboard } from './editor/useEditorKeyboard'
import { useGapGeneration } from './editor/useGapGeneration'
import { useRegeneration } from './editor/useRegeneration'
import { useInferenceStacks } from './editor/useInferenceStacks'
import { useSubtitleOperations } from './editor/useSubtitleOperations'
import { useSourceMonitor } from './editor/useSourceMonitor'
import { useClipOperations } from './editor/useClipOperations'
import { useTimelineDrag } from './editor/useTimelineDrag'
import { useContextMenuEffects } from './editor/useContextMenuEffects'
import { buildMenuDefinitions } from './editor/buildMenuDefinitions'
import { usePlaybackEngine } from './editor/usePlaybackEngine'
import { useRenderedPreview } from './editor/useRenderedPreview'
import { PreviewRenderBar } from './editor/PreviewRenderBar'
import { GapGenerationModal } from './editor/GapGenerationModal'
import { GenerationErrorDialog } from '../components/GenerationErrorDialog'
import { I2vGenerationModal } from './editor/I2vGenerationModal'
import { InferenceStackPanel } from './editor/InferenceStackPanel'
import { SubtitleTrackStyleEditor } from './editor/SubtitleTrackStyleEditor'
import { AssetThumbnail } from '../components/AssetThumbnail'

// Custom scissors cursor SVG for the blade tool (white with dark outline for contrast)
const SCISSORS_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='6' cy='6' r='3'/><path d='M8.12 8.12 12 12'/><path d='M20 4 8.12 15.88'/><circle cx='6' cy='18' r='3'/><path d='M14.8 14.8 20 20'/></svg>`
const SCISSORS_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SCISSORS_CURSOR_SVG)}") 12 12, crosshair`

// Track Select Forward cursors — stacked chevrons for all tracks, single for one track
const TRACK_FWD_ALL_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='28' viewBox='0 0 24 28' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M8 1l5 5-5 5'/><path d='M8 16l5 5-5 5'/></svg>`
const TRACK_FWD_ALL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TRACK_FWD_ALL_SVG)}") 12 12, e-resize`
const TRACK_FWD_ONE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M8 6l6 6-6 6'/></svg>`
const TRACK_FWD_ONE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TRACK_FWD_ONE_SVG)}") 12 12, e-resize`

export function VideoEditor() {
  const { 
    currentProject, currentProjectId, addAsset, deleteAsset, updateAsset, updateProject,
    addTakeToAsset, deleteTakeFromAsset, setAssetActiveTake,
    addTimeline, deleteTimeline, renameTimeline, duplicateTimeline,
    setActiveTimeline, updateTimeline, getActiveTimeline,
    setCurrentTab, setGenSpaceEditImageUrl, setGenSpaceEditMode, setGenSpaceAudioUrl,
    setGenSpaceRetakeSource, pendingRetakeUpdate, setPendingRetakeUpdate,
  } = useProjects()

  const { activeLayout: kbLayout, isEditorOpen: isKbEditorOpen, setEditorOpen: setKbEditorOpen } = useKeyboardShortcuts()
  const kbLayoutRef = useRef(kbLayout)
  kbLayoutRef.current = kbLayout
  const isKbEditorOpenRef = useRef(isKbEditorOpen)
  isKbEditorOpenRef.current = isKbEditorOpen
  
  // Generation hook for regenerating shots
  const {
    generate: regenGenerate,
    generateImage: regenGenerateImage,
    isGenerating: isRegenerating,
    progress: regenProgress,
    statusMessage: regenStatusMessage,
    videoUrl: regenVideoUrl,
    videoPath: regenVideoPath,
    imageUrl: regenImageUrl,
    error: regenError,
    cancel: regenCancel,
    reset: regenReset,
  } = useGeneration()
  
  // Get the active timeline from context
  const activeTimeline = currentProjectId ? getActiveTimeline(currentProjectId) : null
  
  // Local working copies of clips and tracks (for responsive editing without saving on every frame)
  const [clips, setClips] = useState<TimelineClip[]>((activeTimeline?.clips || []).map(migrateClip))
  const [tracks, setTracks] = useState<Track[]>(migrateTracks(activeTimeline?.tracks || DEFAULT_TRACKS.map(t => ({ ...t }))))
  const [subtitles, setSubtitles] = useState<SubtitleClip[]>(activeTimeline?.subtitles || [])
  const [inferenceStacks, setInferenceStacks] = useState<InferenceStack[]>(activeTimeline?.inferenceStacks || [])
  const [markers, setMarkers] = useState<TimelineMarker[]>(activeTimeline?.markers || [])

  // Transient UI state (not persisted)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [assetFilter, setAssetFilter] = useState<'all' | 'video' | 'image' | 'audio'>('all')
  const [selectedBin, setSelectedBin] = useState<string | null>(null) // null = all assets
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  // Lasso selection for assets
  const [assetLasso, setAssetLasso] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const assetGridRef = useRef<HTMLDivElement>(null)
  const [assetContextMenu, setAssetContextMenu] = useState<{ assetId: string; x: number; y: number } | null>(null)
  const assetContextMenuRef = useRef<HTMLDivElement>(null)
  const [takesViewAssetId, setTakesViewAssetId] = useState<string | null>(null) // drill-in to see all takes
  const [takeContextMenu, setTakeContextMenu] = useState<{ assetId: string; takeIndex: number; x: number; y: number } | null>(null)
  const takeContextMenuRef = useRef<HTMLDivElement>(null)
  const [creatingBin, setCreatingBin] = useState(false)
  const [newBinName, setNewBinName] = useState('')
  const newBinInputRef = useRef<HTMLInputElement>(null)
  const [binContextMenu, setBinContextMenu] = useState<{ bin: string; x: number; y: number } | null>(null)
  const binContextMenuRef = useRef<HTMLDivElement>(null)
  const [activeTool, setActiveTool] = useState<ToolType>('select')
  const [bladeHoverInfo, setBladeHoverInfo] = useState<{ clipId: string; offsetX: number; time: number } | null>(null)
  const bladeShiftHeldRef = useRef(false)
  const [bladeShiftHeld, setBladeShiftHeld] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const held = e.shiftKey
      bladeShiftHeldRef.current = held
      setBladeShiftHeld(held)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey) }
  }, [])
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [showEffectsBrowser, setShowEffectsBrowser] = useState(false)
  const [showTrimFlyout, setShowTrimFlyout] = useState(false)
  const [lastTrimTool, setLastTrimTool] = useState<ToolType>('ripple')
  const trimLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trimFlyoutOpenedRef = useRef(false)
  // EFFECTS HIDDEN: const [effectsSearchQuery, setEffectsSearchQuery] = useState('')
  
  // Layout dropdown state
  const [showLayoutMenu, setShowLayoutMenu] = useState(false)
  const [layoutPresets, setLayoutPresets] = useState<LayoutPreset[]>(loadLayoutPresets)
  const [savingPresetName, setSavingPresetName] = useState<string | null>(null)
  const presetNameInputRef = useRef<HTMLInputElement>(null)
  const layoutMenuRef = useRef<HTMLDivElement>(null)

  // Marker edit popover state
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null)
  const [markerEditName, setMarkerEditName] = useState('')
  const [markerEditColor, setMarkerEditColor] = useState('#F59E0B')
  const [markerPopoverPos, setMarkerPopoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const markerPopoverRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef(markers)
  markersRef.current = markers
  const subtitlesRef = useRef(subtitles)
  subtitlesRef.current = subtitles
  const inferenceStacksRef = useRef(inferenceStacks)
  inferenceStacksRef.current = inferenceStacks

  // Editable timecode state
  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

  // In/Out points
  // In/Out points stored per-timeline so they don't bleed across timelines
  const [timelineInOutMap, setTimelineInOutMap] = useState<Record<string, { inPoint: number | null; outPoint: number | null }>>({})
  const [playingInOut, setPlayingInOut] = useState(false) // Looping between In and Out
  
  // Derive current In/Out from map using active timeline ID
  const activeTimelineId = activeTimeline?.id || ''
  const activeTimelineIdRef = useRef(activeTimelineId)
  activeTimelineIdRef.current = activeTimelineId
  const inPoint = timelineInOutMap[activeTimelineId]?.inPoint ?? null
  const outPoint = timelineInOutMap[activeTimelineId]?.outPoint ?? null
  
  // Stable setters that always read the current activeTimelineId from a ref
  const setInPoint = useCallback((updater: (prev: number | null) => number | null) => {
    setTimelineInOutMap(prev => {
      const tlId = activeTimelineIdRef.current
      if (!tlId) return prev
      const current = prev[tlId] || { inPoint: null, outPoint: null }
      let newIn = updater(current.inPoint)
      if (newIn !== null && current.outPoint !== null && newIn >= current.outPoint) {
        newIn = current.outPoint - 0.01
      }
      return { ...prev, [tlId]: { ...current, inPoint: newIn } }
    })
  }, [])
  
  const setOutPoint = useCallback((updater: (prev: number | null) => number | null) => {
    setTimelineInOutMap(prev => {
      const tlId = activeTimelineIdRef.current
      if (!tlId) return prev
      const current = prev[tlId] || { inPoint: null, outPoint: null }
      let newOut = updater(current.outPoint)
      if (newOut !== null && current.inPoint !== null && newOut <= current.inPoint) {
        newOut = current.inPoint + 0.01
      }
      return { ...prev, [tlId]: { ...current, outPoint: newOut } }
    })
  }, [])
  
  const clearInOut = useCallback(() => {
    setTimelineInOutMap(prev => {
      const tlId = activeTimelineIdRef.current
      if (!tlId) return prev
      return { ...prev, [tlId]: { inPoint: null, outPoint: null } }
    })
    setPlayingInOut(false)
  }, [])
  
  // Dragging IN/OUT markers with mouse
  const [draggingMarker, setDraggingMarker] = useState<'timelineIn' | 'timelineOut' | 'sourceIn' | 'sourceOut' | null>(null)
  const draggingMarkerRef = useRef(draggingMarker)
  draggingMarkerRef.current = draggingMarker
  const markerDragOriginRef = useRef<'timeline' | 'scrubbar' | null>(null)
  const inPointRef = useRef(inPoint)
  inPointRef.current = inPoint
  const outPointRef = useRef(outPoint)
  outPointRef.current = outPoint

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false)
  
  // Project settings modal
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  
  // Import timeline modal
  const [showImportTimelineModal, setShowImportTimelineModal] = useState(false)
  
  // Right properties panel: user-controlled open/close (not tied to selection)
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(false)

  // Clip properties panel collapsible sections
  const [showTransitions, setShowTransitions] = useState(false)
  const [showFlip, setShowFlip] = useState(false)
  const [showColorCorrection, setShowColorCorrection] = useState(false)
  const [showAppliedEffects, setShowAppliedEffects] = useState(false)
  
  // Clip properties panel tabs: 'properties' = controls, 'metadata' = info
  const [propertiesTab, setPropertiesTab] = useState<'properties' | 'metadata'>('properties')
  
  // Resolution metadata cache: key = video/image URL, value = { width, height }
  const [resolutionCache, setResolutionCache] = useState<Record<string, { width: number; height: number }>>({})
  
  // Resizable layout
  const [layout, setLayout] = useState<EditorLayout>(loadLayout)
  const resizeDragRef = useRef<{
    type: 'left' | 'right' | 'timeline' | 'assets'
    startPos: number
    startSize: number
  } | null>(null)
  
  // JKL shuttle speed: -8, -4, -2, -1, 0, 1, 2, 4, 8
  const [shuttleSpeed, setShuttleSpeed] = useState(0)
  
  // Timeline tab UI state
  const [renamingTimelineId, setRenamingTimelineId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSource, setRenameSource] = useState<'tab' | 'panel'>('tab')
  const [timelineContextMenu, setTimelineContextMenu] = useState<{ timelineId: string; x: number; y: number } | null>(null)
  const timelineContextMenuRef = useRef<HTMLDivElement>(null)
  // Open timeline tabs — only these appear in the tab bar above the timeline.
  // All timelines are always visible in the library panel on the left.
  const [openTimelineIds, setOpenTimelineIds] = useState<Set<string>>(new Set())
  const [timelineAddMenuOpen, setTimelineAddMenuOpen] = useState(false)
  
  // Bin-to-timeline drag preview
  const binDragAssetsRef = useRef<Asset[]>([])
  const [binDragPreview, setBinDragPreview] = useState<{ startTime: number; trackIndex: number; overwrite: boolean } | null>(null)

  // Dragging state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const trackContainerRef = useRef<HTMLDivElement>(null)
  const trackHeadersRef = useRef<HTMLDivElement>(null)
  const rulerScrollRef = useRef<HTMLDivElement>(null)
  const centerOnPlayheadRef = useRef(false) // Flag: center view on playhead after next zoom change
  // previewVideoRef always points to the ACTIVE (visible) pool video element
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const previewImageRef = useRef<HTMLImageElement>(null)
  const dissolveOutVideoRef = useRef<HTMLVideoElement>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  
  const [previewZoom, setPreviewZoom] = useState<number | 'fit'>('fit') // 'fit' or percentage (e.g. 100 = 100%)
  const [previewZoomOpen, setPreviewZoomOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [playbackResolution, setPlaybackResolution] = useState<1 | 0.5 | 0.25>(0.5) // Playback quality: 1=Full, 0.5=Half, 0.25=Quarter
  const [playbackResOpen, setPlaybackResOpen] = useState(false)
  // Computed video frame dimensions (object-fit:contain equivalent for a div)
  const [videoFrameSize, setVideoFrameSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  
  // Video pool for gapless playback: Map<sourceUrl, HTMLVideoElement>
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const activePoolSrcRef = useRef<string>('') // Currently visible pool video src
  const rafActiveClipIdRef = useRef<string | null>(null) // The clip ID the rAF loop is currently showing (used for audio dedup)

  // --- Performance refs: allow the rAF playback loop to sync video directly ---
  // These mirror React state so the hot loop doesn't depend on re-renders.
  const playbackTimeRef = useRef(0)            // authoritative time during playback
  const clipsRef = useRef(clips)               // mirror of clips state
  const tracksRef = useRef(tracks)             // mirror of tracks state
  const assetsRef = useRef<any[]>([])            // mirror of assets state
  const isPlayingRef = useRef(false)           // mirror of isPlaying state
  const shuttleSpeedRef = useRef(0)            // mirror of shuttleSpeed
  const lastStateUpdateRef = useRef(0)         // timestamp of last React state sync
  const preSeekDoneRef = useRef<string | null>(null) // clipId we already pre-seeked
  const [playbackActiveClipId, setPlaybackActiveClipId] = useState<string | null>(null) // rAF-driven active clip id pushed to React for monitor visibility
  const playheadRulerRef = useRef<HTMLDivElement>(null) // direct DOM ref for ruler playhead
  const playheadOverlayRef = useRef<HTMLDivElement>(null) // direct DOM ref for the full-height overlay playhead
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const previewPanRef = useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })
  const renameInputRef = useRef<HTMLInputElement>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Keep performance refs in sync with state (cheap assignments, no re-renders)
  useEffect(() => { clipsRef.current = clips }, [clips])
  useEffect(() => { tracksRef.current = tracks }, [tracks])
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { shuttleSpeedRef.current = shuttleSpeed }, [shuttleSpeed])
  // Only sync ref ← state when NOT playing (during playback, ref is authoritative)
  useEffect(() => { if (!isPlaying) playbackTimeRef.current = currentTime }, [currentTime, isPlaying])
  
  // Hovered cut point for cross-dissolve UI
  const [hoveredCutPoint, setHoveredCutPoint] = useState<{
    leftClipId: string; rightClipId: string; time: number; trackIndex: number
  } | null>(null)

  // Selected cut point for rolling edit via keyboard nudge
  const [selectedCutPoint, setSelectedCutPoint] = useState<{
    leftClipId: string; rightClipId: string; time: number; trackIndex: number
  } | null>(null)
  
  // Clip right-click context menu
  const [clipContextMenu, setClipContextMenu] = useState<{
    clipId: string; x: number; y: number
  } | null>(null)
  const clipContextMenuRef = useRef<HTMLDivElement>(null)
  
  // Track which timeline is loaded locally so we can detect switches
  const loadedTimelineIdRef = useRef<string | null>(null)
  
  // --- Resizable panel drag handlers ---
  const handleResizeDragStart = useCallback((type: 'left' | 'right' | 'timeline' | 'assets', e: React.MouseEvent) => {
    e.preventDefault()
    const isVertical = type === 'timeline' || type === 'assets'
    const startPos = isVertical ? e.clientY : e.clientX
    const startSize = type === 'left' ? layout.leftPanelWidth
      : type === 'right' ? layout.rightPanelWidth
      : type === 'assets' ? layout.assetsHeight
      : layout.timelineHeight
    resizeDragRef.current = { type, startPos, startSize }
    
    const handleMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return
      const { type: t, startPos: sp, startSize: ss } = resizeDragRef.current
      const isV = t === 'timeline' || t === 'assets'
      const pos = isV ? ev.clientY : ev.clientX
      const delta = pos - sp
      
      if (t === 'left') {
        const newWidth = clampVal(ss + delta, LAYOUT_LIMITS.leftPanelWidth)
        setLayout(prev => ({ ...prev, leftPanelWidth: newWidth }))
      } else if (t === 'right') {
        const newWidth = clampVal(ss - delta, LAYOUT_LIMITS.rightPanelWidth)
        setLayout(prev => ({ ...prev, rightPanelWidth: newWidth }))
      } else if (t === 'assets') {
        // Assets: dragging down increases height
        const newHeight = clampVal(ss + delta, LAYOUT_LIMITS.assetsHeight)
        setLayout(prev => ({ ...prev, assetsHeight: newHeight }))
      } else {
        const newHeight = clampVal(ss - delta, LAYOUT_LIMITS.timelineHeight)
        setLayout(prev => ({ ...prev, timelineHeight: newHeight }))
      }
    }
    
    const handleUp = () => {
      resizeDragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setLayout(prev => { saveLayout(prev); return prev })
    }
    
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
  }, [layout])
  
  const handleResetLayout = useCallback(() => {
    setLayout({ ...DEFAULT_LAYOUT })
    saveLayout({ ...DEFAULT_LAYOUT })
  }, [])

  const handleSaveLayoutPreset = useCallback((name: string) => {
    const preset: LayoutPreset = {
      id: `preset-${Date.now()}`,
      name: name.trim() || 'Untitled',
      layout: { ...layout },
    }
    const updated = [...layoutPresets, preset]
    setLayoutPresets(updated)
    saveLayoutPresets(updated)
  }, [layout, layoutPresets])

  const handleDeleteLayoutPreset = useCallback((id: string) => {
    const updated = layoutPresets.filter(p => p.id !== id)
    setLayoutPresets(updated)
    saveLayoutPresets(updated)
  }, [layoutPresets])

  const handleApplyLayoutPreset = useCallback((preset: LayoutPreset) => {
    setLayout({ ...preset.layout })
    saveLayout({ ...preset.layout })
  }, [])

  // Close layout menu on outside click
  useEffect(() => {
    if (!showLayoutMenu) {
      setSavingPresetName(null)
      return
    }
    const handleClick = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setShowLayoutMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showLayoutMenu])
  
  const assets = currentProject?.assets || []
  const timelines = currentProject?.timelines || []

  // Undo/redo/clipboard (extracted hook)
  const {
    undoStackRef, redoStackRef, clipboardRef,
    pushUndo, pushAssetUndo, pushTrackUndo, handleUndo, handleRedo,
    handleCopy, handlePaste, handleCut,
  } = useUndoRedo({
    clips, setClips, tracks, setTracks, subtitles, setSubtitles,
    assets, currentProjectId,
    deleteAsset, addAsset, updateAsset,
    selectedClipIds, setSelectedClipIds, currentTime,
  })

  // Subtitle operations (extracted hook)
  const {
    selectedSubtitleId, setSelectedSubtitleId,
    editingSubtitleId, setEditingSubtitleId,
    subtitleTrackStyleIdx, setSubtitleTrackStyleIdx,
    subtitleFileInputRef,
    addSubtitleTrack, addSubtitleClip, updateSubtitle, deleteSubtitle,
    handleImportSrt, handleExportSrt,
  } = useSubtitleOperations({
    subtitles, setSubtitles, tracks, setTracks, setClips,
    currentTime, setSelectedClipIds,
    activeTimelineName: activeTimeline?.name,
  })
  const deleteSubtitleRef = useRef<(id: string) => void>(() => {})
  const deleteGapRef = useRef<(gap: { trackIndex: number; startTime: number; endTime: number }) => void>(() => {})
  deleteSubtitleRef.current = deleteSubtitle

  // Source monitor hook (state + logic extracted)
  const {
    sourceAsset, setSourceAsset,
    sourceTime, setSourceTime,
    sourceIsPlaying, setSourceIsPlaying,
    sourceIn, setSourceIn,
    sourceOut, setSourceOut,
    showSourceMonitor, setShowSourceMonitor,
    activePanel, setActivePanel,
    sourceSplitPercent, setSourceSplitPercent,
    sourceSpeed, setSourceSpeed,
    sourceVideoRef, sourceTimeRef, sourceIsPlayingRef, sourceSpeedRef,
    loadSourceAsset,
    shuttleForward: sourceShuttleForward,
    shuttleReverse: sourceShuttleReverse,
    shuttleStop: sourceShuttleStop,
    handleInsertEdit,
    handleOverwriteEdit,
  } = useSourceMonitor({ currentTime, tracks, pushUndo, setClips })

  const sourceInRef = useRef(sourceIn)
  sourceInRef.current = sourceIn
  const sourceOutRef = useRef(sourceOut)
  sourceOutRef.current = sourceOut

  // Mutual exclusion: only one monitor can play at a time
  useEffect(() => {
    if (isPlaying && sourceIsPlaying) {
      sourceVideoRef.current?.pause()
      setSourceIsPlaying(false)
    }
  }, [isPlaying])
  useEffect(() => {
    if (sourceIsPlaying && isPlaying) {
      setIsPlaying(false)
      setShuttleSpeed(0)
    }
  }, [sourceIsPlaying])

  // Clip/track operations (extracted hook)
  const {
    addClipToTimeline, handleImportFile, handleDropFiles,
    updateClip, addEffectToClip: _addEffectToClip, removeEffectFromClip, updateEffectOnClip, // EFFECTS HIDDEN: addEffectToClip prefixed
    duplicateClip, splitClipAtPlayhead, removeClip,
    addCrossDissolve, removeCrossDissolve,
    addTrack, deleteTrack, createAdjustmentLayerAsset, addTextClip,
    handleImportTimeline, handleExportTimelineXml,
  } = useClipOperations({
    clips, setClips, tracks, setTracks, subtitles, setSubtitles,
    assets, currentTime, setCurrentTime, currentProjectId,
    selectedClipIds, setSelectedClipIds, setSelectedSubtitleId,
    pushUndo, pushTrackUndo, addAsset, addTimeline, updateTimeline,
    setActiveTimeline, setOpenTimelineIds, activeTimeline,
    fileInputRef, setHoveredCutPoint,
  })
  
  // Ensure the active timeline is always in the open tab set.
  // On first load (empty set), open only the active timeline.
  useEffect(() => {
    const activeId = activeTimeline?.id
    if (!activeId) return
    setOpenTimelineIds(prev => {
      // If the set is empty (first load / project switch), seed it with just the active timeline
      if (prev.size === 0) return new Set([activeId])
      // Otherwise just make sure the active one is open
      if (prev.has(activeId)) return prev
      const next = new Set(prev)
      next.add(activeId)
      return next
    })
  }, [activeTimeline?.id])
  
  // Clean up open IDs when timelines are deleted
  useEffect(() => {
    const validIds = new Set(timelines.map(t => t.id))
    setOpenTimelineIds(prev => {
      const next = new Set<string>()
      for (const id of prev) { if (validIds.has(id)) next.add(id) }
      if (next.size !== prev.size) return next
      return prev
    })
  }, [timelines])
  
  // Keep assetsRef in sync (declared after assets to avoid forward-reference)
  useEffect(() => { assetsRef.current = assets }, [assets])

  // Approve all asset file paths so IPC reads (audio decode, etc.) pass validation.
  // Needed for assets from saved projects (approvePath set is in-memory only).
  useEffect(() => {
    if (!window.electronAPI?.approvePath) return
    for (const asset of assets) {
      if (asset.path) window.electronAPI.approvePath(asset.path)
    }
  }, [assets])
  
  // Compute bins from assets
  const bins = useMemo(() => {
    const binSet = new Set<string>()
    for (const asset of assets) {
      if (asset.bin) binSet.add(asset.bin)
    }
    return Array.from(binSet).sort()
  }, [assets])
  
  // Filter assets by type + bin
  const filteredAssets = useMemo(() => {
    let result = assets
    if (assetFilter !== 'all') {
      result = result.filter(a => a.type === assetFilter)
    }
    if (selectedBin !== null) {
      result = result.filter(a => a.bin === selectedBin)
    }
    return result
  }, [assets, assetFilter, selectedBin])
  
  // Thumbnails are now generated lazily by each component via useThumbnail hook
  const thumbnailMap: Record<string, string> = {}

  // For the properties panel: show properties when a single clip (or a single linked group) is selected.
  // When all selected clips belong to the same linked group, show the primary clip (prefer video/image over audio).
  const selectedClip = (() => {
    if (selectedClipIds.size === 0) return null
    if (selectedClipIds.size === 1) return clips.find(c => c.id === [...selectedClipIds][0]) ?? null

    // Multiple clips selected — check if they're all in one linked group
    const selArr = [...selectedClipIds]
    const first = clips.find(c => c.id === selArr[0])
    if (!first) return null

    // Inline transitive expansion from `first` to find its full linked group
    const linkedGroup = new Set([first.id])
    const queue = [first.id]
    while (queue.length > 0) {
      const id = queue.pop()!
      const c = clips.find(cl => cl.id === id)
      if (c?.linkedClipIds) {
        for (const lid of c.linkedClipIds) {
          if (!linkedGroup.has(lid) && clips.some(cl => cl.id === lid)) {
            linkedGroup.add(lid)
            queue.push(lid)
          }
        }
      }
    }

    // Check if every selected clip is in this linked group and vice versa
    const allInGroup = selArr.every(id => linkedGroup.has(id)) && linkedGroup.size === selectedClipIds.size
    if (!allInGroup) return null

    // All selected clips are one linked group — pick the primary (video/image) clip for properties
    const primary = selArr
      .map(id => clips.find(c => c.id === id))
      .find(c => c && (c.type === 'video' || c.type === 'image'))
    return primary ?? first
  })()
  
  const totalDuration = Math.max(
    clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0),
    30
  )
  
  const pixelsPerSecond = 100 * zoom

  // Global mousemove/mouseup for dragging IN/OUT markers
  useEffect(() => {
    if (!draggingMarker) return

    const handleMouseMove = (e: MouseEvent) => {
      const marker = draggingMarkerRef.current
      if (!marker) return

      if (marker === 'timelineIn' || marker === 'timelineOut') {
        let time = 0
        const origin = markerDragOriginRef.current
        const rulerEl = timelineRef.current
        const progScrub = document.getElementById('program-scrub-bar')
        if (origin === 'scrubbar' && progScrub) {
          const rect = progScrub.getBoundingClientRect()
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          time = pct * totalDuration
        } else if (rulerEl) {
          const rect = rulerEl.getBoundingClientRect()
          const scrollLeft = rulerScrollRef.current?.scrollLeft ?? 0
          const px = e.clientX - rect.left + scrollLeft
          time = Math.max(0, px / pixelsPerSecond)
        } else if (progScrub) {
          const rect = progScrub.getBoundingClientRect()
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          time = pct * totalDuration
        }
        if (marker === 'timelineIn' && outPointRef.current !== null) {
          time = Math.min(time, outPointRef.current - 0.01)
        }
        if (marker === 'timelineOut' && inPointRef.current !== null) {
          time = Math.max(time, inPointRef.current + 0.01)
        }
        time = Math.max(0, Math.min(time, totalDuration))
        if (marker === 'timelineIn') {
          setInPoint(() => time)
        } else {
          setOutPoint(() => time)
        }
      } else if (marker === 'sourceIn' || marker === 'sourceOut') {
        const scrubEl = document.getElementById('source-scrub-bar')
        if (!scrubEl) return
        const rect = scrubEl.getBoundingClientRect()
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const dur = sourceAsset?.duration || 5
        let time = pct * dur
        if (marker === 'sourceIn' && sourceOutRef.current !== null) {
          time = Math.min(time, sourceOutRef.current - 0.01)
        }
        if (marker === 'sourceOut' && sourceInRef.current !== null) {
          time = Math.max(time, sourceInRef.current + 0.01)
        }
        time = Math.max(0, Math.min(time, dur))
        if (marker === 'sourceIn') {
          setSourceIn(time)
        } else {
          setSourceOut(time)
        }
      }
    }

    const handleMouseUp = () => {
      markerDragOriginRef.current = null
      setDraggingMarker(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingMarker, pixelsPerSecond, totalDuration, setInPoint, setOutPoint])

  // Dynamic minimum zoom: at min zoom the whole timeline fits in view
  // Falls back to 0.05 if container isn't mounted yet
  const getMinZoom = useCallback(() => {
    const container = trackContainerRef.current
    if (!container || totalDuration <= 0) return 0.05
    const containerWidth = container.clientWidth - 20
    return Math.min(0.5, Math.max(0.01, containerWidth / (totalDuration * 100)))
  }, [totalDuration])
  const getMinZoomRef = useRef(getMinZoom)
  getMinZoomRef.current = getMinZoom
  
  // Detect cut points: adjacent clips on the same track where one ends and another begins
  const cutPoints = useMemo(() => {
    const points: { leftClip: TimelineClip; rightClip: TimelineClip; time: number; trackIndex: number; hasDissolve: boolean }[] = []
    // Group clips by track
    const byTrack: Map<number, TimelineClip[]> = new Map()
    for (const clip of clips) {
      if (!byTrack.has(clip.trackIndex)) byTrack.set(clip.trackIndex, [])
      byTrack.get(clip.trackIndex)!.push(clip)
    }
    for (const [trackIdx, trackClips] of byTrack) {
      const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime)
      for (let i = 0; i < sorted.length - 1; i++) {
        const left = sorted[i]
        const right = sorted[i + 1]
        const leftEnd = left.startTime + left.duration
        if (Math.abs(leftEnd - right.startTime) < CUT_POINT_TOLERANCE) {
          const hasDissolve = (left.transitionOut?.type === 'dissolve') || (right.transitionIn?.type === 'dissolve')
          points.push({ leftClip: left, rightClip: right, time: leftEnd, trackIndex: trackIdx, hasDissolve })
        }
      }
    }
    return points
  }, [clips])
  
  // --- Sync local state with active timeline from context ---
  
  // When the active timeline changes (switch or first load), load its data locally
  useEffect(() => {
    if (!activeTimeline) return
    if (loadedTimelineIdRef.current === activeTimeline.id) return // Already loaded
    
    // Save current timeline before switching (if we had one loaded)
    if (loadedTimelineIdRef.current && currentProjectId) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      updateTimeline(currentProjectId, loadedTimelineIdRef.current, { clips, tracks, subtitles, inferenceStacks, markers })
    }

    // Load new timeline (migrate old clips without new effect fields)
    setClips((activeTimeline.clips || []).map(migrateClip))
    setTracks(migrateTracks(activeTimeline.tracks?.length > 0 ? activeTimeline.tracks : DEFAULT_TRACKS.map(t => ({ ...t }))))
    setSubtitles(activeTimeline.subtitles || [])
    setInferenceStacks(activeTimeline.inferenceStacks || [])
    setMarkers(activeTimeline.markers || [])
    setCurrentTime(0)
    setIsPlaying(false)
    setPlayingInOut(false)
    setSelectedClipIds(new Set())
    setSelectedSubtitleId(null)
    setEditingMarkerId(null)
    undoStackRef.current = []
    redoStackRef.current = []
    loadedTimelineIdRef.current = activeTimeline.id
  }, [activeTimeline?.id])
  
  // Debounced auto-save: when clips, tracks, or subtitles change, schedule a save
  useEffect(() => {
    if (!currentProjectId || !loadedTimelineIdRef.current) return
    
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      updateTimeline(currentProjectId, loadedTimelineIdRef.current!, { clips, tracks, subtitles, inferenceStacks, markers })
    }, AUTOSAVE_DELAY)

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [clips, tracks, subtitles, inferenceStacks, markers, currentProjectId])
  
  // Save on unmount — use refs to capture latest state since cleanup can't read useState
  const currentProjectIdRef = useRef(currentProjectId)
  currentProjectIdRef.current = currentProjectId
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      const pid = currentProjectIdRef.current
      const tid = loadedTimelineIdRef.current
      if (pid && tid) {
        updateTimeline(pid, tid, {
          clips: clipsRef.current,
          tracks: tracksRef.current,
          subtitles: subtitlesRef.current,
          inferenceStacks: inferenceStacksRef.current,
          markers: markersRef.current,
        })
      }
    }
  }, [])
  
  // --- Core timeline logic ---
  
  // ─── NLE Track display ordering ───────────────────────────────────
  // Video tracks are displayed bottom-to-top (V1 nearest center, VN at top).
  // Audio tracks are displayed top-to-bottom (A1 nearest center, AN at bottom).
  // Subtitle tracks go after audio.
  // The underlying data model (trackIndex) is unchanged — only display is reordered.
  const orderedTracks: { track: Track; realIndex: number; displayRow: number }[] = useMemo(() => {
    const videoTracks: { track: Track; realIndex: number }[] = []
    const audioTracks: { track: Track; realIndex: number }[] = []
    const subtitleTracks: { track: Track; realIndex: number }[] = []
    
    tracks.forEach((track, i) => {
      if (track.type === 'subtitle') {
        subtitleTracks.push({ track, realIndex: i })
      } else if (track.kind === 'audio') {
        audioTracks.push({ track, realIndex: i })
      } else {
        // Default to video kind
        videoTracks.push({ track, realIndex: i })
      }
    })
    
    // Video tracks reversed: highest-numbered at top, V1 at bottom (nearest divider)
    videoTracks.reverse()
    
    // Subtitle tracks at the very top (frozen), then video, then audio
    const ordered = [...subtitleTracks, ...videoTracks, ...audioTracks]
    return ordered.map((entry, displayRow) => ({ ...entry, displayRow }))
  }, [tracks])
  
  // Map: real trackIndex → display row (for positioning clips/gaps/subtitles)
  const trackDisplayRow = useMemo(() => {
    const map = new Map<number, number>()
    orderedTracks.forEach(entry => {
      map.set(entry.realIndex, entry.displayRow)
    })
    return map
  }, [orderedTracks])
  
  // Index of the first audio track in display order (for the divider line)
  const audioDividerDisplayRow = useMemo(() => {
    const firstAudio = orderedTracks.find(e => e.track.kind === 'audio')
    return firstAudio?.displayRow ?? -1
  }, [orderedTracks])
  
  // Track heights — independently resizable for video, audio, and subtitle
  const [videoTrackHeight, setVideoTrackHeight] = useState(56)
  const [audioTrackHeight, setAudioTrackHeight] = useState(56)
  const [subtitleTrackHeight, setSubtitleTrackHeight] = useState(40)
  const DIVIDER_H = 8 // divider between V and A sections (draggable)

  // Helper to get the pixel height for a given track
  const getTrackHeight = useCallback((trackIndex: number): number => {
    const track = tracks[trackIndex]
    if (!track) return videoTrackHeight
    if (track.type === 'subtitle') return subtitleTrackHeight
    return track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
  }, [tracks, videoTrackHeight, audioTrackHeight, subtitleTrackHeight])

  // Helper: compute the top pixel offset for a given real trackIndex,
  // accounting for display reordering, variable heights, and the V/A divider.
  const trackTopPx = useCallback((realTrackIndex: number, padding = 0): number => {
    const displayRow = trackDisplayRow.get(realTrackIndex) ?? realTrackIndex
    // Sum heights of all rows before this one
    let top = 0
    for (let r = 0; r < displayRow; r++) {
      const entry = orderedTracks[r]
      if (entry) {
        top += entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
      }
    }
    // Add divider if this row is at or past the audio section
    if (audioDividerDisplayRow >= 0 && displayRow >= audioDividerDisplayRow) top += DIVIDER_H
    return top + padding
  }, [trackDisplayRow, audioDividerDisplayRow, orderedTracks, videoTrackHeight, audioTrackHeight, subtitleTrackHeight])

  // Resolve track index from a Y pixel position inside the track container
  const trackIndexFromY = useCallback((yInContainer: number): number => {
    let accY = 0
    let result = 0
    for (const entry of orderedTracks) {
      if (entry.displayRow === audioDividerDisplayRow) accY += DIVIDER_H
      const th = entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
      if (yInContainer >= accY && yInContainer < accY + th) return entry.realIndex
      accY += th
      result = entry.realIndex
    }
    return result
  }, [orderedTracks, audioDividerDisplayRow, subtitleTrackHeight, audioTrackHeight, videoTrackHeight])

  // Bin drag callbacks passed to LeftPanel
  const binDragPreviewRef = useRef(binDragPreview)
  binDragPreviewRef.current = binDragPreview

  const handleBinDragStart = useCallback((draggedAssets: Asset[]) => {
    binDragAssetsRef.current = draggedAssets
  }, [])
  const binDropHandledRef = useRef(false)

  const handleBinDragEnd = useCallback(() => {
    // If the drop wasn't handled by an onDrop handler, commit at the last preview position
    if (!binDropHandledRef.current) {
      const preview = binDragPreviewRef.current
      const draggedAssets = binDragAssetsRef.current
      if (preview && draggedAssets.length > 0) {
        let nextStart = preview.startTime
        for (const a of draggedAssets) {
          addClipToTimeline(a, preview.trackIndex, nextStart, preview.overwrite)
          nextStart += a.duration || 5
        }
      }
    }
    binDropHandledRef.current = false
    binDragAssetsRef.current = []
    binDragPreviewRef.current = null
    setBinDragPreview(null)
  }, [addClipToTimeline])

  // Find the clip at current playhead position
  // Priority: 1) upper tracks (lower trackIndex) win over lower tracks
  //           2) on the same track, the clip placed later (higher array index) wins
  const getClipAtTime = useCallback((time: number): TimelineClip | null => {
    // Only consider video/image clips for the visual preview — audio is heard, not seen
    // Skip adjustment layers (they apply effects but don't have video content)
    // Also skip clips on tracks with output disabled (enabled === false)
    const clipsAtTime = clips
      .map((clip, arrayIndex) => ({ clip, arrayIndex }))
      .filter(({ clip }) =>
        clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text' &&
        (tracks[clip.trackIndex]?.enabled !== false) &&
        time >= clip.startTime && time < clip.startTime + clip.duration
      )
    if (clipsAtTime.length === 0) return null
    // Sort: higher trackIndex first (NLE rule: V3 is above V2, higher tracks take priority)
    // Then higher arrayIndex first (later clip wins on same track)
    clipsAtTime.sort((a, b) => {
      if (a.clip.trackIndex !== b.clip.trackIndex) return b.clip.trackIndex - a.clip.trackIndex
      return b.arrayIndex - a.arrayIndex
    })
    return clipsAtTime[0].clip
  }, [clips, tracks])
  
  const activeClip = getClipAtTime(currentTime)
  const clipPlaybackOffset = activeClip ? currentTime - activeClip.startTime : 0
  
  // During playback, the rAF drives the actual video pool. Use its active clip for monitor visibility
  // so the preview doesn't flash black due to throttled currentTime being stale.
  const monitorClip = useMemo(() => {
    if (isPlaying && playbackActiveClipId) {
      return clips.find(c => c.id === playbackActiveClipId) ?? activeClip
    }
    return activeClip
  }, [isPlaying, playbackActiveClipId, activeClip, clips])
  
  // Compositing stack: all video/image clips at the playhead, sorted bottom-to-top (lowest track first)
  // Used to render clips underneath the active clip when it has opacity < 100%
  const compositingStack = useMemo(() => {
    if (!activeClip || (activeClip.opacity ?? 100) >= 100) return []
    const time = currentTime
    return clips
      .filter(c =>
        c.id !== activeClip.id &&
        c.type !== 'audio' && c.type !== 'adjustment' && c.type !== 'text' &&
        (tracks[c.trackIndex]?.enabled !== false) &&
        c.trackIndex < activeClip.trackIndex &&
        time >= c.startTime && time < c.startTime + c.duration
      )
      .sort((a, b) => a.trackIndex - b.trackIndex)
  }, [clips, tracks, currentTime, activeClip])

  // Cross-dissolve detection: scan ALL clip pairs for dissolve overlap at current time
  // Independent of activeClip to avoid flickering when getClipAtTime switches between clips
  const crossDissolveState = useMemo(() => {
    for (const clipA of clips) {
      // Check if clipA has a dissolve transition-out
      if (clipA.transitionOut?.type !== 'dissolve' || clipA.transitionOut.duration <= 0) continue
      
      const clipAEnd = clipA.startTime + clipA.duration
      const dissolveStart = clipAEnd - clipA.transitionOut.duration
      
      // Is the playhead within the dissolve-out region of clipA?
      if (currentTime < dissolveStart || currentTime >= clipAEnd) continue
      
      // Find the matching incoming clip (starts at clipA's end, has dissolve-in)
      const clipB = clips.find(c =>
        c.id !== clipA.id &&
        c.trackIndex === clipA.trackIndex &&
        c.transitionIn?.type === 'dissolve' &&
        Math.abs(c.startTime - clipAEnd) < 0.05
      )
      if (!clipB) continue
      
      // Compute progress: 0 = fully outgoing (clipA), 1 = fully incoming (clipB)
      const dissolveDuration = clipA.transitionOut.duration
      const timeIntoDisssolve = currentTime - dissolveStart
      const progress = Math.max(0, Math.min(1, timeIntoDisssolve / dissolveDuration))
      
      return { outgoing: clipA, incoming: clipB, progress }
    }
    return null
  }, [clips, currentTime])
  
  // Compute the maximum timeline duration for a video clip based on its actual media length
  const getMaxClipDuration = useCallback((clip: TimelineClip): number => {
    // Still images have no media duration — allow unlimited trim
    if (!clip.asset?.duration || clip.type === 'image') return Infinity
    const mediaDuration = clip.asset.duration
    const usableMedia = mediaDuration - clip.trimStart - clip.trimEnd
    return Math.max(0.5, usableMedia / clip.speed)
  }, [])


  const resolveClipSrc = useCallback((clip: TimelineClip | null): string => {
    if (!clip) return ''
    let src = clip.asset?.url || ''
    if (clip.assetId) {
      const liveAsset = assets.find(a => a.id === clip.assetId)
      if (liveAsset) {
        if (liveAsset.takes && liveAsset.takes.length > 0 && clip.takeIndex !== undefined) {
          const idx = Math.max(0, Math.min(clip.takeIndex, liveAsset.takes.length - 1))
          src = liveAsset.takes[idx].url
        } else {
          src = liveAsset.url
        }
      }
    }
    return src || clip.importedUrl || ''
  }, [assets])

  // Gap generation hook (state + logic extracted)
  const {
    selectedGap, setSelectedGap, gapGenerateMode, setGapGenerateMode, gapGenerateModeRef,
    gapPrompt, setGapPrompt, gapSettings, setGapSettings,
    gapImageFile, setGapImageFile, gapImageInputRef,
    gapSuggesting, gapSuggestion, gapSuggestionError, gapSuggestionNoApiKey, gapBeforeFrame, gapAfterFrame,
    gapApplyAudioToTrack, setGapApplyAudioToTrack,
    regenerateSuggestion,
    generatingGap, regenProgress: gapRegenProgress,
    cancelGapGeneration,
    timelineGaps, deleteGap, handleGapGenerate,
  } = useGapGeneration({
    clips, tracks, setClips, setTracks, setSubtitles, currentProjectId,
    addAsset, resolveClipSrc,
    regenGenerate, regenGenerateImage,
    regenVideoUrl, regenVideoPath, regenImageUrl,
    isRegenerating, regenProgress, regenCancel, regenReset, regenError,
    assetSavePath: currentProject?.assetSavePath,
  })
  deleteGapRef.current = deleteGap

  // Anchor position for gap action popover (screen coords of the clicked gap element)
  const [selectedGapAnchor, setSelectedGapAnchor] = useState<{ x: number; gapTop: number; gapBottom: number } | null>(null)

  // Timeline drag/resize/drop handlers (extracted hook)
  const {
    draggingClip,
    resizingClip,
    slipSlideClip,
    selectedTrimEdge, setSelectedTrimEdge,
    lassoRect, setLassoRect,
    handleRulerMouseDown,
    expandWithLinkedClips,
    handleClipMouseDown,
    handleResizeStart,
    handleTrackDrop,
    lassoOriginRef,

  } = useTimelineDrag({
    activeTool, setActiveTool, lastTrimTool, setLastTrimTool,
    pixelsPerSecond, totalDuration,
    clips, setClips, tracks,
    selectedClipIds, setSelectedClipIds,
    currentTime, setCurrentTime, setIsPlaying, isPlayingRef,
    snapEnabled, pushUndo, resolveClipSrc, getMaxClipDuration, addClipToTimeline,
    assets, timelines, activeTimeline, currentProjectId,
    timelineRef, trackContainerRef,
    orderedTracks, trackDisplayRow, getTrackHeight, trackTopPx, cutPoints,
    splitClipAtPlayhead, setSelectedSubtitleId, setSelectedGap,
    audioTrackHeight, videoTrackHeight, subtitleTrackHeight,
    markers,
  })
  
  // Compute set of clip IDs with highlighted trim edges (uses selectedClipIds which respects Ctrl for independent selection)
  const trimEdgeHighlightIds = useMemo(() => {
    if (!selectedTrimEdge) return new Set<string>()
    return new Set<string>([selectedTrimEdge.clipId, ...selectedClipIds])
  }, [selectedTrimEdge, selectedClipIds])

  // Keyboard shortcuts - uses refs to avoid ordering issues with useCallback
  const activePanelRef = useRef(activePanel)
  activePanelRef.current = activePanel
  const keyboardStateRef = useRef({
    clips: clips,
    selectedClipIds: selectedClipIds,
    totalDuration: totalDuration,
    selectedTrimEdge: selectedTrimEdge as { clipId: string; edge: 'left' | 'right'; independent?: boolean } | null,
    selectedCutPoint: selectedCutPoint as { leftClipId: string; rightClipId: string; time: number; trackIndex: number } | null,
    selectedAssetIds: selectedAssetIds,
    currentTime: currentTime,
    inPoint: inPoint as number | null,
    outPoint: outPoint as number | null,
  })
  keyboardStateRef.current = { clips, selectedClipIds, totalDuration, selectedAssetIds, currentTime, inPoint, outPoint, selectedTrimEdge, selectedCutPoint }
  
  // These handler refs are populated after the useCallbacks below
  const undoRef = useRef<() => void>(() => {})
  const redoRef = useRef<() => void>(() => {})
  const copyRef = useRef<() => void>(() => {})
  const pasteRef = useRef<() => void>(() => {})
  const cutRef = useRef<() => void>(() => {})
  const pushUndoRef = useRef<() => void>(() => {})
  const pushAssetUndoRef = useRef<() => void>(() => {})
  const fitToViewRef = useRef<() => void>(() => {})
  const toggleFullscreenRef = useRef<() => void>(() => {})
  const insertEditRef = useRef<() => void>(() => {})
  const overwriteEditRef = useRef<() => void>(() => {})
  const matchFrameRef = useRef<() => void>(() => {})
  const splitAtPlayheadRef = useRef<() => void>(() => {})
  const addOrEditMarkerRef = useRef<() => void>(() => {})
  const createStackRef = useRef<(clipIds: string[]) => any>(() => null)

  // Ref for renderStack — assigned after useInferenceStacks, used by useRegeneration
  const renderStackRef = useRef<(stackId: string) => void>(() => {})

  // Regeneration / I2V hook (state + logic extracted)
  const {
    regeneratingAssetId,
    showICLoraPanel: _showICLoraPanel, setShowICLoraPanel: _setShowICLoraPanel, // IC-LORA HIDDEN
    icLoraSourceClipId: _icLoraSourceClipId, setIcLoraSourceClipId: _setIcLoraSourceClipId, // IC-LORA HIDDEN
    i2vClipId, setI2vClipId,
    i2vPrompt, setI2vPrompt,
    i2vSettings, setI2vSettings,
    handleI2vGenerate,
    handleRegenerate, handleCancelRegeneration,
    handleICLoraResult: _handleICLoraResult, // IC-LORA HIDDEN
    handleClipTakeChange, handleDeleteTake,
    regenerationPreError, dismissRegenerationPreError,
  } = useRegeneration({
    clips, setClips, assets, currentProjectId,
    addAsset, updateAsset, addTakeToAsset, deleteTakeFromAsset,
    resolveClipSrc,
    regenGenerate, regenGenerateImage,
    regenVideoUrl, regenVideoPath, regenImageUrl,
    isRegenerating, regenProgress, regenStatusMessage,
    regenCancel, regenReset, regenError,
    assetSavePath: currentProject?.assetSavePath,
    renderStack: (...args: Parameters<typeof renderStackRef.current>) => renderStackRef.current(...args),
  })

  // Inference stacks hook
  const {
    activeStackId, setActiveStackId,
    renderingStackId, isRendering: isStackRendering,
    renderProgress: stackRenderProgress, renderStatusMessage: stackRenderStatusMessage,
    createStack, updateStack, deleteStack, breakStack, removeClipFromStack, revertStack,
    renderStack, renderAllStacks, cancelRender: cancelStackRender, relinkStackOutput,
  } = useInferenceStacks({
    clips, setClips, inferenceStacks, setInferenceStacks,
    tracks, setTracks,
    assets, currentProjectId,
    addAsset, updateAsset, addTakeToAsset, resolveClipSrc,
    regenGenerate, regenVideoUrl, regenVideoPath,
    isRegenerating, regenProgress, regenStatusMessage,
    regenCancel, regenReset, regenError,
    assetSavePath: currentProject?.assetSavePath,
    projectName: currentProject?.name,
    projectGenerationSettings: currentProject?.generationSettings,
  })
  renderStackRef.current = renderStack
  createStackRef.current = createStack

  useEditorKeyboard({
    refs: {
      kbLayoutRef,
      isKbEditorOpenRef,
      activePanelRef,
      keyboardStateRef,
      clipsRef,
      tracksRef,
      playbackTimeRef,
      sourceVideoRef,
      sourceIsPlayingRef,
      sourceTimeRef,
      sourceSpeedRef,
      centerOnPlayheadRef,
      getMinZoomRef,
      gapGenerateModeRef,
      undoRef,
      redoRef,
      copyRef,
      pasteRef,
      cutRef,
      pushUndoRef,
      pushAssetUndoRef,
      fitToViewRef,
      toggleFullscreenRef,
      insertEditRef,
      overwriteEditRef,
      matchFrameRef,
      splitAtPlayheadRef,
      markersRef,
      addOrEditMarkerRef,
    },
    setters: {
      setActiveTool,
      setLastTrimTool,
      setShuttleSpeed,
      setIsPlaying,
      setCurrentTime,
      setSourceIsPlaying,
      setSourceTime,
      setSourceIn,
      setSourceOut,
      sourceShuttleForward,
      sourceShuttleReverse,
      sourceShuttleStop,
      setInPoint,
      setOutPoint,
      setSelectedClipIds,
      setClips,
      setGapGenerateMode,
      setSelectedGap,
      setSelectedAssetIds,
      setZoom,
      setSnapEnabled,
      setSelectedTrimEdge,
      setSelectedCutPoint,
      clearInOut,
    },
    context: {
      selectedGap,
      selectedSubtitleId,
      editingSubtitleId,
      currentProjectId: currentProjectId ?? null,
      deleteSubtitleRef,
      deleteAsset,
      deleteGapRef,
      createStackRef,
    },
  })
  
  // Ctrl+scroll-wheel zoom on the timeline
  useEffect(() => {
    const container = trackContainerRef.current
    if (!container) return
    
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        centerOnPlayheadRef.current = true
        const delta = e.deltaY > 0 ? -0.15 : 0.15
        setZoom(prev => Math.min(4, Math.max(getMinZoomRef.current(), +(prev + delta).toFixed(2))))
      }
    }
    
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])
  
  // Fit-to-view helper
  const handleFitToView = useCallback(() => {
    const container = trackContainerRef.current
    if (!container || totalDuration <= 0) return
    const containerWidth = container.clientWidth - 20 // small padding
    const idealZoom = containerWidth / (totalDuration * 100)
    setZoom(Math.min(4, Math.max(getMinZoom(), +idealZoom.toFixed(2))))
  }, [totalDuration, getMinZoom])
  

  // Rendered preview system — pre-render timeline to single mp4
  const previewLetterbox = useMemo(() => {
    const ratioMap: Record<string, number> = { '2.35:1': 2.35, '2.39:1': 2.39, '2.76:1': 2.76, '1.85:1': 1.85, '4:3': 4 / 3 }
    const adjClips = clips.filter(c => c.type === 'adjustment' && c.letterbox?.enabled && tracks[c.trackIndex]?.enabled !== false)
    if (adjClips.length === 0) return null
    const best = adjClips.reduce((a, b) => (b.duration > a.duration ? b : a))
    const lb = best.letterbox!
    const ratio = lb.aspectRatio === 'custom' ? (lb.customRatio || 2.35) : (ratioMap[lb.aspectRatio] || 2.35)
    return { ratio, color: lb.color || '#000000', opacity: (lb.opacity ?? 100) / 100 }
  }, [clips, tracks])

  const { previewStatus, renderedVideoUrl, renderProgress, forceRender, cancelRender } = useRenderedPreview({
    clips,
    tracks,
    subtitles,
    inPoint,
    outPoint,
    fps: activeTimeline?.fps ?? 24,
    width: Math.round((activeTimeline?.resolution?.width ?? 1920) * playbackResolution),
    height: Math.round((activeTimeline?.resolution?.height ?? 1080) * playbackResolution),
    letterbox: previewLetterbox,
    resolveClipSrc,
  })

  // Playback engine (extracted hook)
  usePlaybackEngine({
    isPlaying, setIsPlaying, shuttleSpeed, setShuttleSpeed,
    currentTime, setCurrentTime, duration: totalDuration, pixelsPerSecond,
    clips, tracks, assets, activeClip, crossDissolveState,
    playbackResolution, playingInOut, setPlayingInOut,
    resolveClipSrc,
    videoPoolRef, playbackTimeRef, isPlayingRef, activePoolSrcRef,
    previewVideoRef, dissolveOutVideoRef, trackContainerRef, rulerScrollRef,
    centerOnPlayheadRef, clipsRef, tracksRef, assetsRef,
    playheadOverlayRef, playheadRulerRef, lastStateUpdateRef,
    preSeekDoneRef, rafActiveClipIdRef, setPlaybackActiveClipId,
    inPoint, outPoint, totalDuration, zoom,
    previewStatus, renderedVideoUrl,
  })


  // Keep keyboard refs in sync
  undoRef.current = handleUndo
  redoRef.current = handleRedo
  copyRef.current = handleCopy
  pasteRef.current = handlePaste
  cutRef.current = handleCut
  pushUndoRef.current = pushUndo
  pushAssetUndoRef.current = pushAssetUndo
  fitToViewRef.current = handleFitToView
  
  // --- Source Monitor: load asset ---
  insertEditRef.current = handleInsertEdit
  overwriteEditRef.current = handleOverwriteEdit

  // --- Match Frame: load clip under playhead into source monitor at corresponding frame ---
  const handleMatchFrame = useCallback(() => {
    const ct = currentTime
    // Find clips under the playhead
    const clipsUnderPlayhead = clips.filter(c =>
      ct >= c.startTime && ct < c.startTime + c.duration &&
      (c.type === 'video' || c.type === 'audio' || c.type === 'image')
    )
    if (clipsUnderPlayhead.length === 0) return

    // Prefer the selected clip if it's under the playhead, otherwise pick the topmost (lowest trackIndex = highest video track)
    let targetClip = clipsUnderPlayhead.find(c => selectedClipIds.has(c.id))
    if (!targetClip) {
      targetClip = clipsUnderPlayhead.sort((a, b) => a.trackIndex - b.trackIndex)[0]
    }

    // Find the source asset
    const asset = assets.find(a => a.id === targetClip!.assetId) ?? targetClip.asset
    if (!asset) return

    // Compute source time accounting for trim and speed
    const clipOffset = ct - targetClip.startTime
    const speed = targetClip.speed || 1
    let srcTime: number
    if (targetClip.reversed) {
      const assetDuration = asset.duration || targetClip.duration
      srcTime = assetDuration - (targetClip.trimEnd || 0) - clipOffset * speed
    } else {
      srcTime = (targetClip.trimStart || 0) + clipOffset * speed
    }
    srcTime = Math.max(0, Math.min(srcTime, asset.duration || Infinity))

    // Load into source monitor at the computed frame
    setSourceAsset(asset)
    setSourceTime(srcTime)
    setSourceIn(null)
    setSourceOut(null)
    setSourceIsPlaying(false)
    setShowSourceMonitor(true)
    setActivePanel('source')

    // Seek the source video element after React re-renders
    requestAnimationFrame(() => {
      if (sourceVideoRef.current) {
        sourceVideoRef.current.currentTime = srcTime
      }
    })
  }, [currentTime, clips, selectedClipIds, assets])
  matchFrameRef.current = handleMatchFrame

  // --- Split at Playhead: cut all clips under the playhead ---
  splitAtPlayheadRef.current = () => {
    const ct = currentTime
    const clipsToSplit = clips.filter(c =>
      !c.hiddenByStack &&
      ct > c.startTime + 0.1 &&
      ct < c.startTime + c.duration - 0.1 &&
      !tracks[c.trackIndex]?.locked
    )
    if (clipsToSplit.length > 0) {
      pushUndo()
      splitClipAtPlayhead(clipsToSplit[0].id, ct, clipsToSplit.map(c => c.id))
    }
  }

  // --- Close marker popover on click outside ---
  useEffect(() => {
    if (!editingMarkerId) return
    const handleClick = (e: MouseEvent) => {
      if (markerPopoverRef.current && !markerPopoverRef.current.contains(e.target as Node)) {
        // Save changes before closing
        setMarkers(prev => prev.map(m => m.id === editingMarkerId ? { ...m, name: markerEditName, color: markerEditColor } : m))
        setEditingMarkerId(null)
      }
    }
    // Delay to avoid the same click that opened it closing it immediately
    const timer = setTimeout(() => window.addEventListener('mousedown', handleClick), 0)
    return () => { clearTimeout(timer); window.removeEventListener('mousedown', handleClick) }
  }, [editingMarkerId, markerEditName, markerEditColor])

  // --- Add or Edit Marker at playhead ---
  addOrEditMarkerRef.current = () => {
    const ct = currentTime
    // Check if there's already a marker near the playhead
    const existing = markers.find(m => Math.abs(m.time - ct) < 0.05)
    if (existing) {
      // Compute screen position from the ruler
      if (timelineRef.current) {
        const rulerRect = timelineRef.current.getBoundingClientRect()
        const scrollLeft = rulerScrollRef.current?.scrollLeft ?? 0
        const markerScreenX = rulerRect.left + existing.time * pixelsPerSecond - scrollLeft
        setMarkerPopoverPos({ x: markerScreenX, y: rulerRect.bottom + 4 })
      }
      // Open edit popover for this marker
      setEditingMarkerId(existing.id)
      setMarkerEditName(existing.name)
      setMarkerEditColor(existing.color)
    } else {
      // Add new marker at current time
      const newMarker: TimelineMarker = {
        id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        time: ct,
        color: '#F59E0B',
        name: '',
      }
      setMarkers(prev => [...prev, newMarker])
    }
  }

  // Get active subtitle at current playhead time
  const activeSubtitles = useMemo(() => {
    return subtitles.filter(s => {
      const track = tracks[s.trackIndex]
      return track && !track.muted && currentTime >= s.startTime && currentTime < s.endTime
    })
  }, [subtitles, currentTime, tracks])
  
  // Get active text overlay clips at playhead
  const activeTextClips = useMemo(() => {
    return clips.filter(c =>
      c.type === 'text' && c.textStyle &&
      tracks[c.trackIndex]?.enabled !== false &&
      currentTime >= c.startTime && currentTime < c.startTime + c.duration
    ).sort((a, b) => a.trackIndex - b.trackIndex) // lower track index = renders on top
  }, [clips, currentTime, tracks])
  
  // Get active letterbox from adjustment layers at playhead
  const activeLetterbox = useMemo(() => {
    // Find the topmost (lowest trackIndex) adjustment layer clip at the current time with letterbox enabled
    // Skip clips on tracks with output disabled
    const adjClips = clips
      .filter(c => c.type === 'adjustment' && (tracks[c.trackIndex]?.enabled !== false) && currentTime >= c.startTime && currentTime < c.startTime + c.duration)
      .sort((a, b) => a.trackIndex - b.trackIndex) // lower trackIndex = higher in visual stack
    
    for (const clip of adjClips) {
      if (clip.letterbox?.enabled) {
        const ratioMap: Record<string, number> = {
          '2.35:1': 2.35,
          '2.39:1': 2.39,
          '2.76:1': 2.76,
          '1.85:1': 1.85,
          '4:3': 4 / 3,
        }
        const ratio = clip.letterbox.aspectRatio === 'custom'
          ? (clip.letterbox.customRatio || 2.35)
          : (ratioMap[clip.letterbox.aspectRatio] || 2.35)
        return { ratio, color: clip.letterbox.color || '#000000', opacity: (clip.letterbox.opacity ?? 100) / 100 }
      }
    }
    return null
  }, [clips, currentTime, tracks])

  // Get active adjustment layer effects at playhead
  // Returns an array of style objects (one per adjustment layer) to wrap around the preview content
  // EFFECTS HIDDEN - adjustment layer effects neutered because effects are not applied during export
  const activeAdjustmentEffects = useMemo(() => {
    return [] as { clip: TimelineClip; filterStyle: React.CSSProperties; hasVignette: boolean; vignetteAmount: number; hasGrain: boolean; grainAmount: number }[]
  }, [clips, currentTime, tracks])
  
  // Compute adaptive ruler interval based on zoom level
  const rulerInterval = useMemo(() => {
    // Target: major tick labels should be at least ~80px apart
    const minLabelSpacing = 80
    // Candidate intervals in seconds
    const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    for (const interval of intervals) {
      if (interval * pixelsPerSecond >= minLabelSpacing) return interval
    }
    return 600
  }, [pixelsPerSecond])
  
  // Compute sub-tick interval (minor ticks between major ones)
  const rulerSubInterval = useMemo(() => {
    if (rulerInterval <= 1) return 0.5
    if (rulerInterval <= 5) return 1
    if (rulerInterval <= 15) return 5
    if (rulerInterval <= 60) return 10
    if (rulerInterval <= 300) return 60
    return 60
  }, [rulerInterval])
  
  // --- Scroll sync: keep track headers and ruler in sync with timeline scroll ---
  const handleTimelineScroll = useCallback(() => {
    const container = trackContainerRef.current
    if (!container) return
    // Sync track headers vertical scroll
    if (trackHeadersRef.current) {
      trackHeadersRef.current.scrollTop = container.scrollTop
    }
    // Sync ruler horizontal scroll
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
    // Sync overlay playhead horizontal position
    if (playheadOverlayRef.current) {
      playheadOverlayRef.current.style.left = `${currentTime * pixelsPerSecond - container.scrollLeft}px`
    }
  }, [currentTime, pixelsPerSecond])
  
  // --- Timeline tab handlers ---
  
  const handleAddTimeline = () => {
    if (!currentProjectId) return
    const newTl = addTimeline(currentProjectId)
    // Auto-open the new timeline tab
    if (newTl?.id) {
      setOpenTimelineIds(prev => { const next = new Set(prev); next.add(newTl.id); return next })
    }
  }
  
  const handleDeleteTimeline = (timelineId: string) => {
    if (!currentProjectId) return
    if (timelines.length <= 1) return // Can't delete the last one
    deleteTimeline(currentProjectId, timelineId)
    setTimelineContextMenu(null)
  }
  
  const handleDuplicateTimeline = (timelineId: string) => {
    if (!currentProjectId) return
    const dup = duplicateTimeline(currentProjectId, timelineId)
    // Auto-open the duplicated timeline tab
    if (dup?.id) {
      setOpenTimelineIds(prev => { const next = new Set(prev); next.add(dup.id); return next })
    }
    setTimelineContextMenu(null)
  }
  
  const handleSwitchTimeline = (timelineId: string) => {
    if (!currentProjectId || timelineId === activeTimeline?.id) return
    // Force-save current timeline before switching
    if (loadedTimelineIdRef.current) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      updateTimeline(currentProjectId, loadedTimelineIdRef.current, { clips, tracks, subtitles, inferenceStacks, markers })
    }
    loadedTimelineIdRef.current = null // Reset so the useEffect picks up the new one
    setActiveTimeline(currentProjectId, timelineId)
    // Auto-open the tab when switching to a timeline
    setOpenTimelineIds(prev => {
      if (prev.has(timelineId)) return prev
      const next = new Set(prev)
      next.add(timelineId)
      return next
    })
  }
  
  const handleCloseTimelineTab = (timelineId: string) => {
    // Remove from open tabs
    setOpenTimelineIds(prev => {
      const next = new Set(prev)
      next.delete(timelineId)
      // Must keep at least the active timeline open
      if (next.size === 0 && activeTimeline?.id) {
        next.add(activeTimeline.id)
      }
      return next
    })
    // If closing the active timeline tab, switch to another open one
    if (timelineId === activeTimeline?.id && currentProjectId) {
      const remaining = Array.from(openTimelineIds).filter(id => id !== timelineId)
      if (remaining.length > 0) {
        handleSwitchTimeline(remaining[remaining.length - 1])
      } else {
        // All tabs closed — pick the first timeline from the library
        const fallback = timelines.find(t => t.id !== timelineId)
        if (fallback) {
          handleSwitchTimeline(fallback.id)
        }
      }
    }
  }
  
  const handleStartRename = (timelineId: string, currentName: string, source: 'tab' | 'panel' = 'tab') => {
    setRenamingTimelineId(timelineId)
    setRenameValue(currentName)
    setRenameSource(source)
    setTimelineContextMenu(null)
    if (source === 'tab') {
      setTimeout(() => renameInputRef.current?.select(), 0)
    }
  }
  
  const handleFinishRename = () => {
    if (renamingTimelineId && currentProjectId && renameValue.trim()) {
      renameTimeline(currentProjectId, renamingTimelineId, renameValue.trim())
    }
    setRenamingTimelineId(null)
    setRenameValue('')
  }
  
  const handleTimelineTabContextMenu = (e: React.MouseEvent, timelineId: string) => {
    e.preventDefault()
    setTimelineContextMenu({ timelineId, x: e.clientX, y: e.clientY })
  }
  
  // Context menu close/position effects (extracted hook)
  const { toggleFullscreen } = useContextMenuEffects({
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
    creatingBin, newBinInputRef,
    timelineResolution: activeTimeline?.resolution,
  })

  // Clip context menu handler
  const handleClipContextMenu = (e: React.MouseEvent, clip: TimelineClip) => {
    e.preventDefault()
    e.stopPropagation()
    // Select the clip (+ its linked pair) if not already selected
    if (!selectedClipIds.has(clip.id)) {
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
    }
    setClipContextMenu({ clipId: clip.id, x: e.clientX, y: e.clientY })
  }

  // Extract a frame from a clip at the current playhead position
  // Returns a file:// URL (videos: extracted via ffmpeg, images: already on disk)
  const extractCurrentFrame = useCallback(async (clip: TimelineClip): Promise<string | null> => {
    try {
      const clipSrc = resolveClipSrc(clip)
      if (!clipSrc) return null

      if (clip.type === 'video') {
        const seekTime = Math.max(0, currentTime - clip.startTime) * clip.speed + clip.trimStart
        const { url } = await window.electronAPI.extractVideoFrame(clipSrc, seekTime, 1024, 2)
        return url // file:// URL
      }
      return clipSrc // image — already a file:// URL
    } catch (err) {
      logger.error(`Failed to extract frame: ${err}`)
      return null
    }
  }, [currentTime, resolveClipSrc])

  // Capture a frame and send to Gen Space for video generation (I2V)
  const handleCaptureFrameForVideo = useCallback(async (clip: TimelineClip) => {
    const dataUrl = await extractCurrentFrame(clip)
    if (!dataUrl) return
    setGenSpaceEditMode('video')
    setGenSpaceEditImageUrl(dataUrl)
    setCurrentTab('gen-space')
  }, [extractCurrentFrame, setGenSpaceEditImageUrl, setGenSpaceEditMode, setCurrentTab])

  // Navigate to Gen Space with audio pre-populated for A2V
  const handleCreateVideoFromAudio = useCallback((clip: TimelineClip) => {
    const asset = clip.assetId ? assets.find(a => a.id === clip.assetId) : null
    if (!asset?.url) return
    setGenSpaceAudioUrl(asset.url)
    setCurrentTab('gen-space')
  }, [assets, setGenSpaceAudioUrl, setCurrentTab])

  // Get the live asset for a clip (from project context, not stale clip.asset)
  const getLiveAsset = useCallback((clip: TimelineClip) => {
    if (!clip.assetId) return clip.asset
    return assets.find(a => a.id === clip.assetId) || clip.asset
  }, [assets])

  const handleRetakeClip = useCallback((clip: TimelineClip) => {
    const liveAsset = getLiveAsset(clip)
    if (!liveAsset) return

    const takeIndex = clip.takeIndex ?? liveAsset.activeTakeIndex
    let takePath = liveAsset.path
    let takeUrl = liveAsset.url
    if (liveAsset.takes && liveAsset.takes.length > 0 && takeIndex !== undefined) {
      const idx = Math.max(0, Math.min(takeIndex, liveAsset.takes.length - 1))
      takePath = liveAsset.takes[idx].path
      takeUrl = liveAsset.takes[idx].url
    }

    const linkedIds = new Set(clip.linkedClipIds || [])
    linkedIds.add(clip.id)

    setGenSpaceRetakeSource({
      videoUrl: takeUrl,
      videoPath: takePath,
      clipId: clip.id,
      assetId: liveAsset.id,
      linkedClipIds: [...linkedIds],
      duration: clip.duration || liveAsset.duration,
    })
    setCurrentTab('gen-space')
  }, [getLiveAsset, setGenSpaceRetakeSource, setCurrentTab])

  useEffect(() => {
    if (!pendingRetakeUpdate) return
    setClips(prev => prev.map(c => {
      if (c.assetId !== pendingRetakeUpdate.assetId) return c
      if (!pendingRetakeUpdate.clipIds.includes(c.id)) return c
      return { ...c, takeIndex: pendingRetakeUpdate.newTakeIndex }
    }))
    setPendingRetakeUpdate(null)
  }, [pendingRetakeUpdate, setPendingRetakeUpdate, setClips])

  // Populate fullscreen ref for keyboard handler
  toggleFullscreenRef.current = toggleFullscreen

  
  // Timeline background right-click (paste)
  const handleTimelineBgContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    // Set playhead to clicked position, then open menu with Paste option
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollLeft = (e.currentTarget as HTMLElement).scrollLeft || 0
    const clickX = e.clientX - rect.left + scrollLeft
    const clickTime = Math.max(0, clickX / pixelsPerSecond)
    setCurrentTime(clickTime)
    // Use a special "no clip" context menu: clipId = '' signals background click
    setClipContextMenu({ clipId: '', x: e.clientX, y: e.clientY })
  }
  
  // Get the effective URL for a clip (considering its take index)
  const getClipUrl = useCallback((clip: TimelineClip): string | null => {
    if (!clip.assetId) return clip.importedUrl || null
    const asset = assets.find(a => a.id === clip.assetId)
    if (!asset) return null
    
    if (asset.takes && asset.takes.length > 0 && clip.takeIndex !== undefined) {
      const idx = Math.max(0, Math.min(clip.takeIndex, asset.takes.length - 1))
      return asset.takes[idx].url
    }
    return asset.url
  }, [assets])

  // --- Resolution probing: detect actual video/image dimensions from the linked file ---
  // Track which URLs are currently being probed (to avoid duplicate concurrent probes)
  const probingUrlsRef = useRef<Set<string>>(new Set())
  // Build a map of clip URLs on every render so the effect can detect changes
  const clipUrlMap = useMemo(() => {
    const map: Record<string, string> = {}
    clips.forEach(clip => {
      if (clip.type === 'audio') return
      const url = getClipUrl(clip) || clip.asset?.url
      if (url) map[clip.id] = url
    })
    return map
  }, [clips, getClipUrl])
  
  useEffect(() => {
    // Collect all unique URLs that clips currently point to
    const urlsToProbe = new Set<string>()
    Object.values(clipUrlMap).forEach(url => {
      // Skip if already cached with valid dims, or currently probing
      const cached = resolutionCache[url]
      if (cached && cached.width > 0 && cached.height > 0) return
      if (probingUrlsRef.current.has(url)) return
      urlsToProbe.add(url)
    })
    
    urlsToProbe.forEach(url => {
      probingUrlsRef.current.add(url)
      
      // Determine if this is a video or image based on the clip(s) using it
      const isVideo = clips.some(c => 
        (clipUrlMap[c.id] === url) && (c.type === 'video' || c.asset?.type === 'video')
      )
      
      if (isVideo) {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.onloadedmetadata = () => {
          setResolutionCache(prev => ({ ...prev, [url]: { width: video.videoWidth, height: video.videoHeight } }))
          probingUrlsRef.current.delete(url)
          video.src = ''
        }
        video.onerror = () => { probingUrlsRef.current.delete(url); video.src = '' }
        video.src = url
      } else {
        const img = new window.Image()
        img.onload = () => {
          setResolutionCache(prev => ({ ...prev, [url]: { width: img.naturalWidth, height: img.naturalHeight } }))
          probingUrlsRef.current.delete(url)
        }
        img.onerror = () => { probingUrlsRef.current.delete(url) }
        img.src = url
      }
    })
  }, [clipUrlMap, resolutionCache, clips])
  
  // Helper: classify height into resolution category + color
  const classifyResolution = useCallback((h: number, w?: number): { label: string; color: string; height: number } => {
    const dims = w ? ` (${w}×${h})` : ''
    if (h >= 2160) return { label: `4K${dims}`, color: '#22c55e', height: h }       // green-500
    if (h >= 1080) return { label: `1080p${dims}`, color: '#3b82f6', height: h }    // blue-500
    if (h >= 720)  return { label: `720p${dims}`, color: '#f59e0b', height: h }     // amber-500
    return { label: `${h}p${dims}`, color: '#ef4444', height: h }                    // red-500
  }, [])
  
  // Helper: get resolution category and color for a clip based on its CURRENTLY DISPLAYED take
  const getClipResolution = useCallback((clip: TimelineClip): { label: string; color: string; height: number } | null => {
    if (clip.type === 'audio') return null
    const url = getClipUrl(clip) || clip.asset?.url
    if (!url) return null
    const dims = resolutionCache[url]
    // If we have actual probed dimensions, use them (skip 0,0 which means "probing in progress")
    if (dims && (dims.width > 0 || dims.height > 0)) {
      return classifyResolution(dims.height, dims.width)
    }
    // Fallback: use the generation resolution from the LIVE asset in context
    // (not the stale clip.asset snapshot which never updates)
    const liveAsset = clip.assetId ? assets.find(a => a.id === clip.assetId) : clip.asset
    const res = liveAsset?.resolution
    if (!res || res === 'imported') return null
    const h = parseInt(res)
    if (isNaN(h)) return null
    return classifyResolution(h)
  }, [getClipUrl, resolutionCache, assets, classifyResolution])


  // Menu bar definitions (extracted)
  const menuDefinitions: MenuDefinition[] = useMemo(() => buildMenuDefinitions({
    selectedClip, selectedClipIds, clips, tracks, subtitles, snapEnabled,
    showEffectsBrowser, showSourceMonitor, showPropertiesPanel, showICLoraPanel: _showICLoraPanel, // IC-LORA HIDDEN
    sourceAsset, activeTool, activeTimeline, timelines, kbLayout,
    fileInputRef, subtitleFileInputRef,
    setShowImportTimelineModal, setShowExportModal, handleExportTimelineXml, handleExportSrt,
    undoRef, redoRef, cutRef, copyRef, pasteRef,
    setSelectedClipIds, handleInsertEdit, handleOverwriteEdit, matchFrameRef, setKbEditorOpen,
    splitClipAtPlayhead, duplicateClip, pushUndo, setClips, updateClip, setTracks,
    addTextClip, addSubtitleTrack, createAdjustmentLayerAsset, setSnapEnabled, fitToViewRef, setZoom,
    setShowSourceMonitor, setShowEffectsBrowser, setShowPropertiesPanel,
    setShowICLoraPanel: _setShowICLoraPanel, setIcLoraSourceClipId: _setIcLoraSourceClipId, // IC-LORA HIDDEN
    setActiveTool, setLastTrimTool, setShowProjectSettings,
    handleAddTimeline, handleDuplicateTimeline, handleResetLayout,
  }), [selectedClip, selectedClipIds, clips, tracks, subtitles, snapEnabled, showEffectsBrowser, showSourceMonitor, showPropertiesPanel, _showICLoraPanel, sourceAsset, activeTool, activeTimeline, timelines, handleInsertEdit, handleOverwriteEdit, kbLayout])


  // --- Render ---
  
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Menu Bar */}
      <MenuBar menus={menuDefinitions} rightContent={
        <div ref={layoutMenuRef} className="relative">
          <button
            onClick={() => setShowLayoutMenu(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${
              showLayoutMenu ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Layout
          </button>
          {showLayoutMenu && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/50 py-1 z-[60]">
              {savingPresetName !== null ? (
                <div className="px-2 py-1.5">
                  <div className="text-[11px] text-zinc-400 mb-1.5 px-1">Name this layout:</div>
                  <input
                    ref={presetNameInputRef}
                    autoFocus
                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-[13px] text-white outline-none focus:border-blue-500"
                    value={savingPresetName}
                    onChange={e => setSavingPresetName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && savingPresetName.trim()) {
                        handleSaveLayoutPreset(savingPresetName)
                        setSavingPresetName(null)
                      } else if (e.key === 'Escape') {
                        setSavingPresetName(null)
                      }
                      e.stopPropagation()
                    }}
                    placeholder="e.g. Wide Timeline"
                  />
                  <div className="flex gap-1.5 mt-1.5">
                    <button
                      onClick={() => {
                        if (savingPresetName.trim()) {
                          handleSaveLayoutPreset(savingPresetName)
                          setSavingPresetName(null)
                        }
                      }}
                      disabled={!savingPresetName.trim()}
                      className="flex-1 px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setSavingPresetName(null)}
                      className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setSavingPresetName('')
                      requestAnimationFrame(() => presetNameInputRef.current?.focus())
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-zinc-200 hover:bg-blue-600 hover:text-white transition-colors"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Current Layout...
                  </button>
                  <button
                    onClick={() => { handleResetLayout(); setShowLayoutMenu(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-zinc-200 hover:bg-blue-600 hover:text-white transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to Default
                  </button>
                  {layoutPresets.length > 0 && (
                    <>
                      <div className="h-px bg-zinc-700 my-1 mx-2" />
                      <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider">Saved Layouts</div>
                      {layoutPresets.map(preset => (
                        <div
                          key={preset.id}
                          className="flex items-center group hover:bg-blue-600 transition-colors"
                        >
                          <button
                            onClick={() => { handleApplyLayoutPreset(preset); setShowLayoutMenu(false) }}
                            className="flex-1 flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-zinc-200 group-hover:text-white transition-colors text-left"
                          >
                            <LayoutGrid className="h-3.5 w-3.5 text-zinc-500 group-hover:text-white" />
                            {preset.name}
                          </button>
                          <Tooltip content="Delete preset" side="top">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteLayoutPreset(preset.id) }}
                              className="px-2 py-1.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Tooltip>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      } />
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
      <LeftPanel
        leftPanelWidth={layout.leftPanelWidth}
        assetsHeight={layout.assetsHeight}
        takesViewAssetId={takesViewAssetId}
        setTakesViewAssetId={setTakesViewAssetId}
        creatingBin={creatingBin}
        setCreatingBin={setCreatingBin}
        newBinName={newBinName}
        setNewBinName={setNewBinName}
        newBinInputRef={newBinInputRef}
        selectedBin={selectedBin}
        setSelectedBin={setSelectedBin}
        bins={bins}
        filteredAssets={filteredAssets}
        assetFilter={assetFilter}
        setAssetFilter={setAssetFilter}
        selectedAssetIds={selectedAssetIds}
        setSelectedAssetIds={setSelectedAssetIds}
        assetLasso={assetLasso}
        setAssetLasso={setAssetLasso}
        assetGridRef={assetGridRef}
        setAssetContextMenu={setAssetContextMenu}
        setBinContextMenu={setBinContextMenu}
        setTakeContextMenu={setTakeContextMenu}
        assets={assets}
        thumbnailMap={thumbnailMap}
        currentProjectId={currentProjectId}
        pushAssetUndoRef={pushAssetUndoRef}
        updateAsset={updateAsset}
        loadSourceAsset={loadSourceAsset}
        handleImportFile={handleImportFile}
        handleDropFiles={handleDropFiles}
        fileInputRef={fileInputRef}
        setAssetActiveTake={setAssetActiveTake}
        addClipToTimeline={addClipToTimeline}
        setClips={setClips}
        deleteTakeFromAsset={deleteTakeFromAsset}
        deleteAsset={deleteAsset}
        handleRegenerate={handleRegenerate}
        handleCancelRegeneration={handleCancelRegeneration}
        isRegenerating={isRegenerating}
        regeneratingAssetId={regeneratingAssetId}
        regenProgress={regenProgress}
        regenStatusMessage={regenStatusMessage}
        handleResizeDragStart={handleResizeDragStart}
        timelineAddMenuOpen={timelineAddMenuOpen}
        setTimelineAddMenuOpen={setTimelineAddMenuOpen}
        handleAddTimeline={handleAddTimeline}
        setShowImportTimelineModal={setShowImportTimelineModal}
        timelines={timelines}
        activeTimeline={activeTimeline}
        handleSwitchTimeline={handleSwitchTimeline}
        handleDeleteTimeline={handleDeleteTimeline}
        handleTimelineTabContextMenu={handleTimelineTabContextMenu}
        openTimelineIds={openTimelineIds}
        renamingTimelineId={renamingTimelineId}
        renameValue={renameValue}
        renameSource={renameSource}
        setRenameValue={setRenameValue}
        handleStartRename={handleStartRename}
        handleFinishRename={handleFinishRename}
        setRenamingTimelineId={setRenamingTimelineId}
        onAssetDragStart={handleBinDragStart}
        onAssetDragEnd={handleBinDragEnd}
      />
      {/* Left resize handle */}
      <div
        className="w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors relative group z-10"
        onMouseDown={(e) => handleResizeDragStart('left', e)}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>
      
      {/* Main Editor Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Preview Area (optionally split into Clip Viewer + Timeline Viewer) */}
        <div className="flex-1 flex min-h-0 min-w-0">
          
          {/* === Clip Viewer (Source Monitor) === */}
          {showSourceMonitor && (
            <SourceMonitor
              sourceAsset={sourceAsset}
              sourceTime={sourceTime}
              setSourceTime={setSourceTime}
              sourceIsPlaying={sourceIsPlaying}
              setSourceIsPlaying={setSourceIsPlaying}
              sourceSpeed={sourceSpeed}
              setSourceSpeed={setSourceSpeed}
              sourceIn={sourceIn}
              sourceOut={sourceOut}
              setSourceIn={setSourceIn}
              setSourceOut={setSourceOut}
              setShowSourceMonitor={setShowSourceMonitor}
              activePanel={activePanel}
              setActivePanel={setActivePanel}
              sourceSplitPercent={sourceSplitPercent}
              draggingMarker={draggingMarker}
              setDraggingMarker={setDraggingMarker}
              sourceVideoRef={sourceVideoRef}
              onInsertEdit={handleInsertEdit}
              onOverwriteEdit={handleOverwriteEdit}
            />
          )}
          
          {/* Resize handle between panels */}
          {showSourceMonitor && (
            <div
              className="w-1.5 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors relative group z-10"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // Capture container ref once — re-read its rect on every move for accuracy
                const container = e.currentTarget.parentElement
                if (!container) return
                const onMove = (ev: MouseEvent) => {
                  const rect = container.getBoundingClientRect()
                  if (rect.width === 0) return
                  const pct = ((ev.clientX - rect.left) / rect.width) * 100
                  setSourceSplitPercent(Math.max(20, Math.min(80, pct)))
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            >
              <div className="absolute inset-y-0 -left-2 -right-2" />
            </div>
          )}

          <div
            className="flex-1 min-w-0 min-h-0 flex flex-col"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={handleDropFiles}
          >
          <ProgramMonitor
            showSourceMonitor={showSourceMonitor}
            activePanel={activePanel}
            sourceSplitPercent={sourceSplitPercent}
            setActivePanel={setActivePanel}
            previewContainerRef={previewContainerRef}
            previewVideoRef={previewVideoRef}
            previewImageRef={previewImageRef}
            dissolveOutVideoRef={dissolveOutVideoRef}
            previewPanRef={previewPanRef}
            currentTime={currentTime}
            totalDuration={totalDuration}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            setCurrentTime={setCurrentTime}
            clips={clips}
            tracks={tracks}
            activeClip={activeClip ?? undefined}
            monitorClip={monitorClip ?? undefined}
            clipPlaybackOffset={clipPlaybackOffset}
            crossDissolveState={crossDissolveState}
            activeSubtitles={activeSubtitles}
            activeTextClips={activeTextClips}
            activeLetterbox={activeLetterbox}
            activeAdjustmentEffects={activeAdjustmentEffects}
            compositingStack={compositingStack}
            getClipUrl={getClipUrl}
            selectedClipIds={selectedClipIds}
            setSelectedClipIds={setSelectedClipIds}
            setClips={setClips}
            showPropertiesPanel={showPropertiesPanel}
            setShowPropertiesPanel={setShowPropertiesPanel}
            inPoint={inPoint}
            outPoint={outPoint}
            setInPoint={setInPoint}
            setOutPoint={setOutPoint}
            setDraggingMarker={(v) => { markerDragOriginRef.current = 'scrubbar'; setDraggingMarker(v) }}
            playingInOut={playingInOut}
            setPlayingInOut={setPlayingInOut}
            shuttleSpeed={shuttleSpeed}
            setShuttleSpeed={setShuttleSpeed}
            previewZoom={previewZoom}
            setPreviewZoom={setPreviewZoom}
            previewPan={previewPan}
            setPreviewPan={setPreviewPan}
            previewZoomOpen={previewZoomOpen}
            setPreviewZoomOpen={setPreviewZoomOpen}
            videoFrameSize={videoFrameSize}
            playbackResolution={playbackResolution}
            setPlaybackResolution={setPlaybackResolution}
            playbackResOpen={playbackResOpen}
            setPlaybackResOpen={setPlaybackResOpen}
            isFullscreen={isFullscreen}
            toggleFullscreen={toggleFullscreen}
            kbLayout={kbLayout}
            previewStatus={previewStatus}
            renderedVideoUrl={renderedVideoUrl}
          />
          </div> {/* end program monitor drop zone */}
        </div> {/* end split preview area */}
        
        {/* Timeline Info Bar (shuttle indicator only — timecode moved to ruler area) */}
        {shuttleSpeed !== 0 && (
          <div className="h-6 bg-zinc-900 border-t border-zinc-800 flex items-center px-4">
            <div className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
              shuttleSpeed < 0 ? 'bg-orange-600/20 text-orange-400' : 'bg-blue-600/20 text-blue-400'
            }`}>
              {shuttleSpeed < 0 ? '◀' : '▶'}{' '}{Math.abs(shuttleSpeed)}x
            </div>
          </div>
        )}
        
        {/* Timeline resize handle — above the timeline tabs */}
        <div
          className="h-1 flex-shrink-0 cursor-row-resize bg-transparent hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors relative group z-10"
          onMouseDown={(e) => handleResizeDragStart('timeline', e)}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>
        
        {/* Timeline Tabs */}
        <div className="h-8 bg-zinc-900 flex items-center px-1 gap-0.5 overflow-x-auto flex-shrink-0">
          {timelines.filter(tl => openTimelineIds.has(tl.id)).map(tl => (
            <div
              key={tl.id}
              className={`group flex items-center gap-1 pl-3 pr-1 h-6 rounded-t text-xs font-medium cursor-pointer transition-colors flex-shrink-0 ${
                tl.id === activeTimeline?.id
                  ? 'bg-zinc-950 text-white border-t border-l border-r border-zinc-700'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
              onClick={() => handleSwitchTimeline(tl.id)}
              onDoubleClick={() => handleStartRename(tl.id, tl.name)}
              onContextMenu={(e) => handleTimelineTabContextMenu(e, tl.id)}
            >
              {renamingTimelineId === tl.id && renameSource === 'tab' ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename()
                    if (e.key === 'Escape') { setRenamingTimelineId(null); setRenameValue('') }
                  }}
                  className="bg-transparent border-b border-blue-500 outline-none text-white text-xs w-20"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[120px]">{tl.name}</span>
              )}
              {/* Close tab button */}
              <Tooltip content="Close tab" side="bottom">
                <button
                  className={`ml-0.5 p-0.5 rounded transition-colors flex-shrink-0 ${
                    tl.id === activeTimeline?.id
                      ? 'text-zinc-500 hover:text-white hover:bg-zinc-700'
                      : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 hover:bg-zinc-700'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTimelineTab(tl.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
          ))}
          
          {/* Add timeline button */}
          <Tooltip content="New timeline" side="bottom">
            <button
              onClick={handleAddTimeline}
              className="flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors flex-shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          
          
          {/* Context menu */}
          {timelineContextMenu && (
            <div 
              ref={timelineContextMenuRef}
              className="fixed bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
              style={{ left: timelineContextMenu.x, top: timelineContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  const tl = timelines.find(t => t.id === timelineContextMenu.timelineId)
                  if (tl) handleStartRename(tl.id, tl.name, 'panel')
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Pencil className="h-3 w-3" />
                Rename
              </button>
              <button
                onClick={() => handleDuplicateTimeline(timelineContextMenu.timelineId)}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Copy className="h-3 w-3" />
                Duplicate
              </button>
              <div className="h-px bg-zinc-700 my-0.5" />
              <button
                disabled={true}
                title="Coming Soon!"
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-500 flex items-center gap-2 opacity-50 cursor-not-allowed"
              >
                <ZoomIn className="h-3 w-3" />
                Upscale Timeline
              </button>
              <div className="h-px bg-zinc-700 my-0.5" />
              <button
                onClick={() => {
                  setShowImportTimelineModal(true)
                  setTimelineContextMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <FileUp className="h-3 w-3" />
                Import XML Timeline
              </button>
              <div className="relative group/export">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                >
                  <Upload className="h-3 w-3" />
                  Export
                  <ChevronRight className="h-3 w-3 ml-auto text-zinc-500" />
                </button>
                <div className="absolute left-full top-0 ml-0.5 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-50 hidden group-hover/export:block">
                  <button
                    onClick={() => {
                      setShowExportModal(true)
                      setTimelineContextMenu(null)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                  >
                    <Upload className="h-3 w-3" />
                    Export Timeline...
                  </button>
                  <button
                    onClick={() => {
                      handleExportTimelineXml()
                      setTimelineContextMenu(null)
                    }}
                    disabled={clips.length === 0}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2 disabled:opacity-40"
                  >
                    <FileDown className="h-3 w-3" />
                    Export as FCP 7 XML
                  </button>
                </div>
              </div>
              <div className="h-px bg-zinc-700 my-0.5" />
              <button
                onClick={() => {
                  handleCloseTimelineTab(timelineContextMenu.timelineId)
                  setTimelineContextMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <X className="h-3 w-3" />
                Close Tab
              </button>
              {timelines.length > 1 && (
                <>
                  <button
                    onClick={() => handleDeleteTimeline(timelineContextMenu.timelineId)}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 flex items-center gap-2"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        
        {/* Timeline with Tools */}
        <div className="bg-zinc-950 border-t border-zinc-800 flex overflow-hidden flex-shrink-0" style={{ height: layout.timelineHeight }}>
          {/* Tools Panel */}
          <div className="w-10 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-1 gap-0.5 overflow-hidden">
            {PRIMARY_TOOLS.map(tool => (
              <Tooltip key={tool.id} content={tooltipLabel(tool.label, getShortcutLabel(kbLayout, tool.actionId))} side="right">
                <button
                  onClick={() => setActiveTool(tool.id)}
                  className={`p-1.5 rounded-lg transition-colors relative group flex-shrink-0 ${
                    activeTool === tool.id
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  <tool.icon className="h-4 w-4" />
                  <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                    {(() => { const s = getShortcutLabel(kbLayout, tool.actionId); return <>{tool.label}{s && <span className="text-zinc-400"> ({s})</span>}</>; })()}
                  </div>
                </button>
              </Tooltip>
            ))}
            
            {/* Trim tools group button */}
            {(() => {
              const trimToolIds = new Set(TRIM_TOOLS.map(t => t.id))
              const isTrimActive = trimToolIds.has(activeTool)
              const currentTrimTool = TRIM_TOOLS.find(t => t.id === (isTrimActive ? activeTool : lastTrimTool)) || TRIM_TOOLS[0]
              return (
                <div className="relative flex-shrink-0">
                  <Tooltip content={(() => { const s = getShortcutLabel(kbLayout, currentTrimTool.actionId); return s ? `${currentTrimTool.label} (${s}) — right-click or hold for more` : `${currentTrimTool.label} — right-click or hold for more` })()} side="right">
                    <button
                      onClick={() => {
                        if (trimFlyoutOpenedRef.current) { trimFlyoutOpenedRef.current = false; return }
                        setActiveTool(currentTrimTool.id)
                        setLastTrimTool(currentTrimTool.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (trimLongPressRef.current) { clearTimeout(trimLongPressRef.current); trimLongPressRef.current = null }
                        trimFlyoutOpenedRef.current = true
                        setShowTrimFlyout(true)
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return
                        trimFlyoutOpenedRef.current = false
                        trimLongPressRef.current = setTimeout(() => {
                          trimLongPressRef.current = null
                          trimFlyoutOpenedRef.current = true
                          setShowTrimFlyout(true)
                        }, 400)
                      }}
                      onMouseUp={() => {
                        if (trimLongPressRef.current) { clearTimeout(trimLongPressRef.current); trimLongPressRef.current = null }
                      }}
                      onMouseLeave={() => {
                        if (trimLongPressRef.current) { clearTimeout(trimLongPressRef.current); trimLongPressRef.current = null }
                      }}
                      data-trim-group-btn=""
                      className={`p-1.5 rounded-lg transition-colors relative group ${
                        isTrimActive
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <currentTrimTool.icon className="h-4 w-4" />
                      <div className="absolute bottom-0 right-0 w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] border-b-current opacity-60" />
                      <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                        {(() => { const s = getShortcutLabel(kbLayout, currentTrimTool.actionId); return <>{currentTrimTool.label}{s && <span className="text-zinc-400"> ({s})</span>}</>; })()}
                      </div>
                    </button>
                  </Tooltip>
                  {showTrimFlyout && (() => {
                    const btnEl = document.querySelector('[data-trim-group-btn]')
                    const rect = btnEl?.getBoundingClientRect()
                    return (
                      <>
                        <div className="fixed inset-0 z-[9998]" onMouseDown={() => setShowTrimFlyout(false)} onContextMenu={(e) => { e.preventDefault(); setShowTrimFlyout(false) }} />
                        <div
                          className="fixed bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-[9999] min-w-[160px]"
                          style={{ top: rect?.top ?? 0, left: (rect?.right ?? 44) + 4 }}
                        >
                          {TRIM_TOOLS.map(t => (
                            <button
                              key={t.id}
                              onClick={() => {
                                setActiveTool(t.id)
                                setLastTrimTool(t.id)
                                setShowTrimFlyout(false)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                                activeTool === t.id ? 'bg-blue-600/30 text-white' : 'text-zinc-300 hover:bg-zinc-700'
                              }`}
                            >
                              <t.icon className="h-3.5 w-3.5" />
                              <span className="flex-1">{t.label}</span>
                              <span className="text-zinc-500 text-[10px]">{getShortcutLabel(kbLayout, t.actionId)}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )
                  })()}
                </div>
              )
            })()}
            
            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />
            
            <Tooltip content={snapEnabled ? 'Snapping On' : 'Snapping Off'} side="right">
              <button
                onClick={() => setSnapEnabled(!snapEnabled)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  snapEnabled
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <Magnet className="h-4 w-4" />
              </button>
            </Tooltip>
            
            {/* EFFECTS HIDDEN - FX button hidden because effects are not applied during export
            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />

            <button
              onClick={() => setShowEffectsBrowser(!showEffectsBrowser)}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 text-[10px] font-bold ${
                showEffectsBrowser
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
              title="Effects Browser"
            >
              FX
            </button>
            EFFECTS HIDDEN */}

            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />
            
            <Tooltip content="Add Text Overlay" side="right">
              <button
                onClick={() => addTextClip()}
                className="p-1.5 rounded-lg transition-colors flex-shrink-0 text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-300 group relative"
              >
                <Type className="h-4 w-4" />
                <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                  Add Text Overlay
                </div>
              </button>
            </Tooltip>

            {/* IC-LORA HIDDEN - IC-LoRA toolbar button hidden because IC-LoRA is broken on server
            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />

            <Tooltip content="IC-LoRA Style Transfer" side="right">
              <button
                onClick={() => {
                  setIcLoraSourceClipId(selectedClip?.type === 'video' ? selectedClip.id : null)
                  setShowICLoraPanel(true)
                }}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 group relative ${
                  showICLoraPanel ? 'bg-amber-600/20 text-amber-400' : 'text-amber-500/70 hover:bg-amber-900/30 hover:text-amber-400'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                  IC-LoRA Style Transfer
                </div>
              </button>
            </Tooltip>
            */}

            <div className="flex-1" />

            <Tooltip content={showPropertiesPanel ? 'Hide Properties Panel' : 'Show Properties Panel'} side="right">
              <button
                onClick={() => setShowPropertiesPanel(p => !p)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 group relative ${
                  showPropertiesPanel ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <PanelRight className="h-4 w-4" />
                <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                  {showPropertiesPanel ? 'Hide Properties' : 'Show Properties'}
                </div>
              </button>
            </Tooltip>
          </div>
          
          {/* EFFECTS HIDDEN - Effects Browser panel hidden because effects are not applied during export */}

          {/* Timeline content */}
          <div className="flex-1 min-w-0 flex flex-col" onMouseDown={() => {
            if (activePanel !== 'timeline') {
              setActivePanel('timeline')
              if (sourceIsPlaying) {
                sourceVideoRef.current?.pause()
                setSourceIsPlaying(false)
              }
            }
          }}>
            {/* Ruler row - fixed at top */}
            <div className="flex flex-shrink-0">
              <div
                className="w-32 h-6 flex-shrink-0 border-b border-r border-zinc-800 bg-zinc-900 flex items-center justify-center cursor-text"
                onClick={() => {
                  if (!editingTimecode) {
                    setTimecodeInput(formatTime(currentTime))
                    setEditingTimecode(true)
                    requestAnimationFrame(() => timecodeInputRef.current?.select())
                  }
                }}
              >
                {editingTimecode ? (
                  <input
                    ref={timecodeInputRef}
                    autoFocus
                    className="w-full h-full bg-zinc-950 text-amber-400 text-[11px] font-mono font-medium text-center outline-none border-none tabular-nums tracking-tight px-1"
                    value={timecodeInput}
                    onChange={e => setTimecodeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const t = parseTime(timecodeInput)
                        if (t !== null) {
                          const clamped = Math.max(0, Math.min(totalDuration, t))
                          setCurrentTime(clamped)
                          playbackTimeRef.current = clamped
                        }
                        setEditingTimecode(false)
                      } else if (e.key === 'Escape') {
                        setEditingTimecode(false)
                      }
                      e.stopPropagation()
                    }}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => setEditingTimecode(false)}
                  />
                ) : (
                  <span className="text-[11px] font-mono font-medium text-amber-400 tabular-nums tracking-tight select-none">
                    {formatTime(currentTime)}
                  </span>
                )}
              </div>
              <div ref={rulerScrollRef} className="flex-1 overflow-hidden">
                <div 
                  ref={timelineRef}
                  style={{ minWidth: `${totalDuration * pixelsPerSecond}px` }}
                  className={`h-6 bg-zinc-900 border-b border-zinc-800 relative select-none ${
                    'cursor-pointer'
                  }`}
                  onMouseDown={handleRulerMouseDown}
                >
                  {(() => {
                    const ticks: React.ReactNode[] = []
                    // Render major + minor ticks up to totalDuration
                    const end = totalDuration + rulerInterval
                    for (let t = 0; t < end; t = +(t + rulerSubInterval).toFixed(4)) {
                      const isMajor = Math.abs(t % rulerInterval) < 0.001 || Math.abs(t % rulerInterval - rulerInterval) < 0.001
                      const leftPx = t * pixelsPerSecond
                      ticks.push(
                        <div
                          key={t}
                          className="absolute top-0 bottom-0"
                          style={{ left: `${leftPx}px` }}
                        >
                          <div className={`h-full border-l ${isMajor ? 'border-zinc-700' : 'border-zinc-800'}`} />
                          {isMajor && (
                            <span className="absolute left-1 bottom-0.5 text-[10px] text-zinc-500 whitespace-nowrap leading-none">
                              {formatTime(t)}
                            </span>
                          )}
                        </div>
                      )
                    }
                    return ticks
                  })()}
                  {/* Dimmed region BEFORE In point on ruler */}
                  {inPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-black/40 pointer-events-none z-10"
                      style={{ width: `${inPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Dimmed region AFTER Out point on ruler */}
                  {outPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 right-0 bg-black/40 pointer-events-none z-10"
                      style={{ left: `${outPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* In/Out range highlight on ruler */}
                  {(inPoint !== null || outPoint !== null) && (
                    <div
                      className="absolute top-0 bottom-0 border-t-2 border-b-2 border-blue-400/60 pointer-events-none z-10"
                      style={{
                        left: `${(inPoint ?? 0) * pixelsPerSecond}px`,
                        width: `${((outPoint ?? totalDuration) - (inPoint ?? 0)) * pixelsPerSecond}px`,
                      }}
                    />
                  )}
                  {/* In point bracket marker — draggable */}
                  {inPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 z-[15] cursor-ew-resize"
                      style={{ left: `${inPoint * pixelsPerSecond - 6}px`, width: 12 }}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); markerDragOriginRef.current = 'timeline'; setDraggingMarker('timelineIn') }}
                    >
                      {/* Bracket shape */}
                      <div className="absolute top-0 bottom-0 left-[5px] w-1.5 bg-blue-400 rounded-l-sm flex flex-col justify-between pointer-events-none">
                        <div className="w-3 h-0.5 bg-blue-400 rounded-r" />
                        <div className="w-3 h-0.5 bg-blue-400 rounded-r" />
                      </div>
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-blue-400 whitespace-nowrap pointer-events-none">IN</div>
                    </div>
                  )}
                  {/* Out point bracket marker — draggable */}
                  {outPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 z-[15] cursor-ew-resize"
                      style={{ left: `${outPoint * pixelsPerSecond - 6}px`, width: 12 }}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); markerDragOriginRef.current = 'timeline'; setDraggingMarker('timelineOut') }}
                    >
                      {/* Bracket shape */}
                      <div className="absolute top-0 bottom-0 left-[5px] w-1.5 bg-blue-400 rounded-r-sm flex flex-col justify-between pointer-events-none">
                        <div className="w-3 h-0.5 bg-blue-400 rounded-l -ml-1.5" />
                        <div className="w-3 h-0.5 bg-blue-400 rounded-l -ml-1.5" />
                      </div>
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-blue-400 whitespace-nowrap pointer-events-none">OUT</div>
                    </div>
                  )}
                  {/* Timeline markers — chevrons at top of ruler with labels */}
                  {markers.map(m => (
                    <div
                      key={m.id}
                      className="absolute top-0 z-[16] cursor-pointer"
                      style={{ left: `${m.time * pixelsPerSecond}px` }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        // Compute screen position for the popover
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setMarkerPopoverPos({ x: rect.left, y: rect.bottom + 4 })
                        setEditingMarkerId(m.id)
                        setMarkerEditName(m.name)
                        setMarkerEditColor(m.color)
                      }}
                    >
                      {/* Chevron / down-pointing triangle */}
                      <div
                        className="absolute -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent"
                        style={{ borderTopColor: m.color }}
                      />
                      {/* Vertical line */}
                      <div
                        className="absolute top-[7px] h-[17px] w-px -translate-x-1/2"
                        style={{ backgroundColor: m.color, opacity: 0.6 }}
                      />
                      {/* Label — always visible when marker has a name */}
                      {m.name && (
                        <div
                          className="absolute top-[-1px] left-[6px] text-[9px] font-medium leading-none whitespace-nowrap pointer-events-none select-none"
                          style={{ color: m.color }}
                        >
                          {m.name}
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Marker edit menu is rendered outside overflow-hidden via portal below */}
                  {/* Playhead (ruler) — position updated by rAF engine during playback */}
                  <div
                    ref={playheadRulerRef}
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                    style={{ left: `${currentTime * pixelsPerSecond}px` }}
                  >
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Marker edit menu — rendered outside overflow-hidden ruler */}
            {editingMarkerId && (() => {
              const editMarker = markers.find(m => m.id === editingMarkerId)
              if (!editMarker) return null
              return (
                <div
                  ref={markerPopoverRef}
                  className="fixed z-[100] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 w-48"
                  style={{ left: `${markerPopoverPos.x - 90}px`, top: `${markerPopoverPos.y}px` }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Description input */}
                  <div className="px-2 py-1.5">
                    <input
                      type="text"
                      className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                      placeholder="Description..."
                      value={markerEditName}
                      onChange={e => setMarkerEditName(e.target.value)}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          setMarkers(prev => prev.map(m => m.id === editingMarkerId ? { ...m, name: markerEditName, color: markerEditColor } : m))
                          setEditingMarkerId(null)
                        } else if (e.key === 'Escape') {
                          setEditingMarkerId(null)
                        }
                        e.stopPropagation()
                      }}
                    />
                  </div>
                  {/* Divider */}
                  <div className="border-t border-zinc-700 my-1" />
                  {/* Color swatches */}
                  <div className="px-1">
                    <div className="text-[10px] text-zinc-500 px-2 pb-1">Color</div>
                    <div className="flex gap-1 px-2 pb-1">
                      {MARKER_COLORS.map(c => (
                        <button
                          key={c.id}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${markerEditColor === c.color ? 'border-white scale-110' : 'border-transparent hover:border-zinc-500'}`}
                          style={{ backgroundColor: c.color }}
                          onClick={() => {
                            setMarkerEditColor(c.color)
                            setMarkers(prev => prev.map(m => m.id === editingMarkerId ? { ...m, color: c.color } : m))
                          }}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>
                  {/* Divider */}
                  <div className="border-t border-zinc-700 my-1" />
                  {/* Delete */}
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700/60 transition-colors"
                    onClick={() => {
                      setMarkers(prev => prev.filter(m => m.id !== editingMarkerId))
                      setEditingMarkerId(null)
                    }}
                  >
                    Delete Marker
                  </button>
                </div>
              )
            })()}

            {/* Tracks body - vertically scrollable */}
            <div className="flex flex-1 min-h-0 flex-col">
              {/* Scrollable tracks area */}
              <div className="flex flex-1 min-h-0">
              {/* Track headers column */}
              <div className="w-32 flex-shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden">
                {/* Add track buttons - pinned above scrollable area */}
                <div className="flex-shrink-0 h-7 flex items-center px-2 gap-1.5 border-b border-zinc-700/50">
                  <button 
                    onClick={() => addTrack('video')}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-0.5"
                    title="Add video track"
                  >
                    <Plus className="h-3 w-3" />
                    V
                  </button>
                  <button 
                    onClick={() => addTrack('audio')}
                    className="text-[10px] text-emerald-500/70 hover:text-emerald-400 flex items-center gap-0.5"
                    title="Add audio track"
                  >
                    <Plus className="h-3 w-3" />
                    A
                  </button>
                  <div className="w-px h-3 bg-zinc-700" />
                  <button 
                    onClick={() => addSubtitleTrack()}
                    className="text-[10px] text-amber-500/70 hover:text-amber-400 flex items-center gap-0.5"
                    title="Add subtitle track"
                  >
                    <MessageSquare className="h-3 w-3" />
                    Subs
                  </button>
                  <div className="w-px h-3 bg-zinc-700" />
                  <button 
                    onClick={() => createAdjustmentLayerAsset()}
                    className="text-[10px] text-blue-400/70 hover:text-blue-300 flex items-center gap-0.5"
                    title="Create adjustment layer asset"
                  >
                    <Layers className="h-3 w-3" />
                    Adj
                  </button>
                </div>
                {/* Scrollable track headers - synced with vertical scroll */}
                <div ref={trackHeadersRef} className="flex-1 overflow-hidden flex flex-col select-none">
                {orderedTracks.map(({ track, realIndex, displayRow }) => (
                  <React.Fragment key={track.id}>
                    {/* Draggable divider between video and audio sections */}
                    {displayRow === audioDividerDisplayRow && (
                      <div 
                        className="flex-shrink-0 bg-zinc-700/60 relative cursor-row-resize hover:bg-blue-500/30 transition-colors group/divider"
                        style={{ height: DIVIDER_H }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startY = e.clientY
                          const startVH = videoTrackHeight
                          const startAH = audioTrackHeight
                          const onMove = (ev: MouseEvent) => {
                            const delta = ev.clientY - startY
                            const newVH = Math.max(32, Math.min(200, startVH + delta))
                            const newAH = Math.max(32, Math.min(200, startAH - delta))
                            setVideoTrackHeight(newVH)
                            setAudioTrackHeight(newAH)
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center">
                          <div className="flex flex-col items-center gap-[1px]">
                            <div className="w-8 h-[1px] bg-zinc-500 group-hover/divider:bg-blue-400 transition-colors rounded-full" />
                            <div className="w-8 h-[1px] bg-zinc-500 group-hover/divider:bg-blue-400 transition-colors rounded-full" />
                          </div>
                        </div>
                        <span className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 text-[7px] font-bold text-zinc-400 bg-zinc-800 px-1.5 rounded-sm leading-none pointer-events-none">V | A</span>
                      </div>
                    )}
                    <div 
                      className={`group flex-shrink-0 border-b border-zinc-800 text-xs relative ${
                        track.type === 'subtitle'
                          ? 'bg-amber-950/20 px-1.5 flex flex-col justify-center gap-0'
                          : track.kind === 'audio'
                          ? 'bg-emerald-950/10 px-2 flex items-center justify-between'
                          : 'px-2 flex items-center justify-between'
                      }`}
                      style={{ height: track.type === 'subtitle' ? subtitleTrackHeight : track.kind === 'audio' ? audioTrackHeight : videoTrackHeight }}
                    >
                      {track.type === 'subtitle' ? (
                        <>
                          {/* Row 1: track name */}
                          <div className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3 text-amber-500/60 flex-shrink-0" />
                            <span className={`text-[10px] font-semibold truncate ${track.muted ? 'text-zinc-600' : 'text-amber-400/80'}`}>
                              {track.name}
                            </span>
                          </div>
                          {/* Row 2: tools */}
                          <div className="flex items-center gap-0">
                            <Tooltip content="Track style settings" side="right">
                              <button
                                onClick={() => setSubtitleTrackStyleIdx(subtitleTrackStyleIdx === realIndex ? null : realIndex)}
                                className={`p-0.5 rounded ${subtitleTrackStyleIdx === realIndex ? 'text-amber-400 bg-amber-900/30' : 'text-amber-500/60 hover:text-amber-400'}`}
                              >
                                <Palette className="h-3 w-3" />
                              </button>
                            </Tooltip>
                            <Tooltip content="Add subtitle" side="right">
                              <button
                                onClick={() => addSubtitleClip(realIndex)}
                                className="p-0.5 rounded text-amber-500/60 hover:text-amber-400"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </Tooltip>
                            <Tooltip content={track.locked ? 'Unlock' : 'Lock'} side="right">
                              <button
                                onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, locked: !t.locked} : t))}
                                className={`p-0.5 rounded ${track.locked ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                {track.locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip content={track.muted ? 'Show subtitles' : 'Hide subtitles'} side="right">
                              <button
                                onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, muted: !t.muted} : t))}
                                className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                {track.muted ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip content="Delete track" side="right">
                              <button
                                onClick={() => {
                                  if (confirm(`Delete subtitle track "${track.name}"?`)) {
                                    pushTrackUndo()
                                    setTracks(tracks.filter((_, i) => i !== realIndex))
                                    setSubtitles(prev => prev.filter(s => s.trackIndex !== realIndex))
                                  }
                                }}
                                className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </Tooltip>
                          </div>
                        </>
                      ) : (
                      <>
                      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                        <Tooltip content={track.sourcePatched !== false ? 'Source patched (click to unpatch)' : 'Source unpatched (click to patch)'} side="right">
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, sourcePatched: !(t.sourcePatched !== false)} : t))}
                            className={`p-0.5 rounded flex-shrink-0 transition-colors ${
                              track.sourcePatched !== false
                                ? track.kind === 'audio'
                                  ? 'text-emerald-400 hover:text-emerald-300'
                                  : 'text-blue-400 hover:text-blue-300'
                                : 'text-zinc-600 hover:text-zinc-400'
                            }`}
                          >
                            {track.sourcePatched !== false
                              ? <CircleDot className="h-2.5 w-2.5" />
                              : <Circle className="h-2.5 w-2.5" />
                            }
                          </button>
                        </Tooltip>
                        <span className={`text-[10px] font-semibold truncate ${
                          track.muted ? 'text-zinc-600' 
                          : track.kind === 'audio' ? 'text-emerald-400/80'
                          : 'text-zinc-300'
                        }`}>
                          {track.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-0 flex-shrink-0">
                        <Tooltip content={track.locked ? 'Unlock' : 'Lock'} side="right">
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, locked: !t.locked} : t))}
                            className={`p-0.5 rounded ${track.locked ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                            {track.locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                          </button>
                        </Tooltip>
                        {track.kind !== 'audio' && (
                          <Tooltip content={track.enabled === false ? 'Enable track output' : 'Disable track output'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, enabled: !(t.enabled !== false)}: t))}
                              className={`p-0.5 rounded ${track.enabled === false ? 'text-zinc-600' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.enabled === false ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                        )}
                        {track.kind !== 'audio' && (
                          <Tooltip content={track.muted ? 'Unmute' : 'Mute'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, muted: !t.muted} : t))}
                              className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.muted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                        )}
                        {track.kind === 'audio' && (
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, muted: !t.muted} : t))}
                            className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${
                              track.muted ? 'bg-red-500/80 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                            }`}
                            title={track.muted ? 'Unmute track' : 'Mute track'}
                          >
                            M
                          </button>
                        )}
                        {track.kind === 'audio' && (
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, solo: !t.solo} : t))}
                            className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${
                              track.solo ? 'bg-yellow-500/80 text-black' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                            }`}
                            title={track.solo ? 'Unsolo track' : 'Solo track'}
                          >
                            S
                          </button>
                        )}
                        {tracks.length > 1 && (
                          <Tooltip content="Delete track" side="right">
                            <button
                              onClick={() => deleteTrack(realIndex)}
                              className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                      </>
                      )}
                      {/* Track height resize handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-10 group/resize hover:bg-blue-500/40 transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const isSubtitle = track.type === 'subtitle'
                          const isAudio = track.kind === 'audio'
                          const startY = e.clientY
                          const startH = isSubtitle ? subtitleTrackHeight : isAudio ? audioTrackHeight : videoTrackHeight
                          const onMove = (ev: MouseEvent) => {
                            const delta = ev.clientY - startY
                            const newH = Math.max(24, Math.min(200, startH + delta))
                            if (isSubtitle) setSubtitleTrackHeight(newH)
                            else if (isAudio) setAudioTrackHeight(newH)
                            else setVideoTrackHeight(newH)
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        <div className="mx-auto w-6 h-0.5 bg-zinc-600 rounded-full mt-0.5 group-hover/resize:bg-blue-400 transition-colors" />
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                {/* Spacer at bottom of track list */}
                <div className="h-4 flex-shrink-0" />
              </div>{/* end trackHeadersRef */}
              </div>{/* end track headers column */}
              
              {/* Scrollable track content area */}
              <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
                {/* Full-height playhead line — spans spacer + tracks, positioned on the wrapper */}
                <div
                  ref={playheadOverlayRef}
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
                  style={{ left: `${currentTime * pixelsPerSecond - (trackContainerRef.current?.scrollLeft || 0)}px` }}
                />
                {/* Rendered preview status bar — FCP-style above clips */}
                <PreviewRenderBar
                  status={previewStatus}
                  progress={renderProgress}
                  onForceRender={forceRender}
                />
                {/* Spacer matching the add-track button bar height */}
                <div className="flex-shrink-0 h-7 border-b border-zinc-700/50" />
                <div 
                  ref={trackContainerRef}
                  className="flex-1 overflow-auto select-none"
                  onScroll={handleTimelineScroll}
                >
                <div
                  draggable={false}
                  style={{ minWidth: `${totalDuration * pixelsPerSecond}px`, minHeight: '100%',
                    ...(activeTool === 'blade' ? { cursor: SCISSORS_CURSOR }
                      : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR }
                      : {}),
                  }}
                  className="relative"
                  onDragOver={(e) => {
                    // Allow asset/timeline/file drops anywhere on the timeline area
                    if (e.dataTransfer.types.includes('assetid') || e.dataTransfer.types.includes('assetids') || e.dataTransfer.types.includes('asset') || e.dataTransfer.types.includes('timeline') || e.dataTransfer.types.includes('Files')) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                    }
                    // Update bin drag preview position with snap
                    if (binDragAssetsRef.current.length > 0 && trackContainerRef.current) {
                      const rect = trackContainerRef.current.getBoundingClientRect()
                      const scrollLeft = trackContainerRef.current.scrollLeft
                      const scrollTop = trackContainerRef.current.scrollTop
                      const x = e.clientX - rect.left + scrollLeft
                      const y = e.clientY - rect.top + scrollTop
                      let startTime = Math.max(0, x / pixelsPerSecond)
                      const tidx = trackIndexFromY(y)

                      // Snap to clip edges and playhead (same behavior as timeline clip dragging)
                      if (snapEnabled && !(e.ctrlKey || e.metaKey)) {
                        const snapThreshold = SNAP_THRESHOLD
                        const totalDragDuration = binDragAssetsRef.current.reduce((sum, a) => sum + (a.duration || 5), 0)
                        let snapped = false
                        for (const c of clips) {
                          // Snap start to clip start
                          if (!snapped && Math.abs(startTime - c.startTime) < snapThreshold) {
                            startTime = c.startTime; snapped = true
                          }
                          // Snap start to clip end
                          const cEnd = c.startTime + c.duration
                          if (!snapped && Math.abs(startTime - cEnd) < snapThreshold) {
                            startTime = cEnd; snapped = true
                          }
                          // Snap end to clip start
                          if (!snapped && Math.abs(startTime + totalDragDuration - c.startTime) < snapThreshold) {
                            startTime = c.startTime - totalDragDuration; snapped = true
                          }
                          // Snap end to clip end
                          if (!snapped && Math.abs(startTime + totalDragDuration - cEnd) < snapThreshold) {
                            startTime = cEnd - totalDragDuration; snapped = true
                          }
                        }
                        // Snap to playhead
                        if (!snapped && Math.abs(startTime - currentTime) < snapThreshold) {
                          startTime = currentTime
                        }
                        if (!snapped && Math.abs(startTime + totalDragDuration - currentTime) < snapThreshold) {
                          startTime = currentTime - totalDragDuration
                        }
                        startTime = Math.max(0, startTime)
                      }

                      const preview = { startTime, trackIndex: tidx, overwrite: e.ctrlKey || e.metaKey }
                      binDragPreviewRef.current = preview
                      setBinDragPreview(preview)
                    }
                  }}
                  onDragLeave={() => {
                    // Keep the ghost visible — it stays at the last valid position
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const preview = binDragPreviewRef.current
                    const draggedAssets = binDragAssetsRef.current
                    binDropHandledRef.current = true
                    setBinDragPreview(null)
                    binDragAssetsRef.current = []
                    binDragPreviewRef.current = null
                    // External file drop → import to bin first
                    if (e.dataTransfer.files?.length > 0 && !e.dataTransfer.getData('assetId') && !e.dataTransfer.getData('asset')) {
                      handleDropFiles(e)
                      return
                    }
                    // Use the snapped preview position if available (from bin drag)
                    if (preview && draggedAssets.length > 0) {
                      let nextStart = preview.startTime
                      for (const a of draggedAssets) {
                        addClipToTimeline(a, preview.trackIndex, nextStart, preview.overwrite)
                        nextStart += a.duration || 5
                      }
                      return
                    }
                    // Fallback: calculate from mouse position (for timeline/other drops)
                    const container = trackContainerRef.current
                    if (!container) return
                    const rect = container.getBoundingClientRect()
                    const yInContainer = e.clientY - rect.top + container.scrollTop
                    let droppedTrackIndex = 0
                    let accY = 0
                    for (const entry of orderedTracks) {
                      if (entry.displayRow === audioDividerDisplayRow) accY += DIVIDER_H
                      const th = entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
                      if (yInContainer >= accY && yInContainer < accY + th) {
                        droppedTrackIndex = entry.realIndex
                        break
                      }
                      accY += th
                      droppedTrackIndex = entry.realIndex
                    }
                    handleTrackDrop(e, droppedTrackIndex)
                  }}
                  onContextMenu={(e) => {
                    // Right-click on background (not on a clip) opens paste menu
                    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-track-bg]')) {
                      handleTimelineBgContextMenu(e)
                    }
                  }}
                  onMouseDown={(e) => {
                    // Start lasso on any click that's NOT on a clip (tracks, gaps, empty areas above/below tracks)
                    if (!(e.target as HTMLElement).closest('[data-clip-id]')) {
                      e.preventDefault() // Prevent native drag from fighting the lasso
                      setSelectedSubtitleId(null)
                      setEditingSubtitleId(null)
                      setSelectedGap(null)
                      setGapGenerateMode(null)
                      setSelectedTrimEdge(null)
                      setSelectedCutPoint(null)
                      if (activeTool === 'trackForward') {
                        // Track Select Forward: click empty area → select all clips from click time forward
                        const container = trackContainerRef.current
                        if (container) {
                          const rect = container.getBoundingClientRect()
                          const scrollLeft = container.scrollLeft
                          const scrollTop = container.scrollTop
                          const clickX = e.clientX - rect.left + scrollLeft
                          const clickY = e.clientY - rect.top + scrollTop
                          const clickTime = clickX / pixelsPerSecond
                          
                          // Determine which track was clicked using display ordering
                          let clickedRealTrackIndex = -1
                          let accY = 0
                          for (const entry of orderedTracks) {
                            if (entry.displayRow === audioDividerDisplayRow) accY += DIVIDER_H
                            const th = entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
                            if (clickY >= accY && clickY < accY + th) {
                              clickedRealTrackIndex = entry.realIndex
                              break
                            }
                            accY += th
                          }
                          
                          const forwardClips = clips.filter(c => {
                            if (e.shiftKey) {
                              return c.trackIndex === clickedRealTrackIndex && c.startTime >= clickTime - 0.01
                            } else {
                              return c.startTime >= clickTime - 0.01
                            }
                          })
                          setSelectedClipIds(new Set(forwardClips.map(c => c.id)))
                        }
                      } else if (activeTool === 'select') {
                        // If not shift-clicking, clear selection first
                        if (!e.shiftKey) {
                          setSelectedClipIds(new Set())
                        }
                        // Start lasso
                        const container = trackContainerRef.current
                        if (container) {
                          const rect = container.getBoundingClientRect()
                          lassoOriginRef.current = {
                            scrollLeft: container.scrollLeft,
                            containerLeft: rect.left,
                            containerTop: rect.top, // ruler is now outside trackContainerRef
                          }
                          setLassoRect({
                            startX: e.clientX,
                            startY: e.clientY,
                            currentX: e.clientX,
                            currentY: e.clientY,
                          })
                        }
                      }
                    }
                  }}
                >
                  {/* Dimmed region BEFORE In point on tracks */}
                  {inPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-black/25 pointer-events-none z-[5]"
                      style={{ width: `${inPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Dimmed region AFTER Out point on tracks */}
                  {outPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 bg-black/25 pointer-events-none z-[5]"
                      style={{ left: `${outPoint * pixelsPerSecond}px`, right: 0 }}
                    />
                  )}
                  {/* In/Out range highlight on tracks */}
                  {(inPoint !== null || outPoint !== null) && (
                    <div
                      className="absolute top-0 bottom-0 border-l-2 border-r-2 border-blue-400/40 pointer-events-none z-[5]"
                      style={{
                        left: `${(inPoint ?? 0) * pixelsPerSecond}px`,
                        width: `${((outPoint ?? totalDuration) - (inPoint ?? 0)) * pixelsPerSecond}px`,
                      }}
                    />
                  )}
                  {/* In point line on tracks */}
                  {inPoint !== null && (
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-400/60 z-[15] pointer-events-none"
                      style={{ left: `${inPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Out point line on tracks */}
                  {outPoint !== null && (
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-400/60 z-[15] pointer-events-none"
                      style={{ left: `${outPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Playhead is now rendered as overlay on the column wrapper (playheadOverlayRef) */}
                  
                  {orderedTracks.map(({ track, realIndex, displayRow }) => (
                    <React.Fragment key={track.id}>
                      {/* Divider between video and audio sections */}
                      {displayRow === audioDividerDisplayRow && (
                        <div
                          className="bg-zinc-700/60 cursor-row-resize hover:bg-blue-500/30 transition-colors"
                          style={{ height: DIVIDER_H }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const startY = e.clientY
                            const startVH = videoTrackHeight
                            const startAH = audioTrackHeight
                            const onMove = (ev: MouseEvent) => {
                              const delta = ev.clientY - startY
                              const newVH = Math.max(32, Math.min(200, startVH + delta))
                              const newAH = Math.max(32, Math.min(200, startAH - delta))
                              setVideoTrackHeight(newVH)
                              setAudioTrackHeight(newAH)
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        />
                      )}
                      <div
                        draggable={false}
                        data-track-bg="true"
                        className={`border-b border-zinc-800 ${
                          track.type === 'subtitle'
                            ? 'bg-amber-950/15'
                            : track.kind === 'audio'
                              ? (displayRow % 2 === 0 ? 'bg-emerald-950/20' : 'bg-emerald-950/10')
                              : displayRow % 2 === 0 ? 'bg-zinc-900/50' : 'bg-zinc-950'
                        } ${track.locked ? 'opacity-50' : ''}`}
                        style={{ height: track.type === 'subtitle' ? subtitleTrackHeight : track.kind === 'audio' ? audioTrackHeight : videoTrackHeight }}
                        onDrop={(e) => {
                          e.stopPropagation()
                          const preview = binDragPreviewRef.current
                          const draggedAssets = binDragAssetsRef.current
                          binDropHandledRef.current = true
                          setBinDragPreview(null)
                          binDragAssetsRef.current = []
                          binDragPreviewRef.current = null
                          if (track.type === 'subtitle') {
                            e.preventDefault()
                            return
                          }
                          // Use snapped preview position if available
                          if (preview && draggedAssets.length > 0) {
                            let nextStart = preview.startTime
                            for (const a of draggedAssets) {
                              addClipToTimeline(a, preview.trackIndex, nextStart, preview.overwrite)
                              nextStart += a.duration || 5
                            }
                            return
                          }
                          handleTrackDrop(e, realIndex)
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDoubleClick={() => {
                          if (track.type === 'subtitle' && !track.locked) {
                            addSubtitleClip(realIndex)
                          }
                        }}
                      />
                    </React.Fragment>
                  ))}
                  
                  {/* Lasso selection rectangle */}
                  {lassoRect && lassoOriginRef.current && (() => {
                    const origin = lassoOriginRef.current!
                    const container = trackContainerRef.current
                    if (!container) return null
                    const scrollLeft = container.scrollLeft
                    const scrollTop = container.scrollTop
                    const x1 = Math.min(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
                    const x2 = Math.max(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
                    const y1 = Math.min(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
                    const y2 = Math.max(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
                    return (
                      <div
                        className="absolute border border-blue-400 bg-blue-500/10 z-30 pointer-events-none rounded-sm"
                        style={{
                          left: x1,
                          top: y1,
                          width: x2 - x1,
                          height: y2 - y1,
                        }}
                      />
                    )
                  })()}
                  
                  {clips.filter(c => !c.hiddenByStack).map(clip => {
                    const liveAsset = clip.assetId ? assets.find(a => a.id === clip.assetId) : null
                    const clipColor = getColorLabel(clip.colorLabel || liveAsset?.colorLabel || clip.asset?.colorLabel)
                    const isInStack = !!clip.inferenceStackId
                    const clipStack = isInStack ? inferenceStacks.find(s => s.id === clip.inferenceStackId) : undefined
                    const isInBrokenStack = !!clipStack && (
                      clipStack.renderState === 'error' ||
                      (clipStack.renderState === 'complete' && clipStack.renderedClipId && !clips.some(c => c.id === clipStack.renderedClipId))
                    )
                    const isRenderingClip = !!renderingStackId && clip.inferenceStackId === renderingStackId
                    // Compute positional drift between linked clips (start time only, not trim/duration)
                    let driftSeconds = 0
                    if (clip.linkedClipIds?.length) {
                      for (const lid of clip.linkedClipIds) {
                        const partner = clips.find(c => c.id === lid)
                        if (partner) {
                          const drift = clip.startTime - partner.startTime
                          if (Math.abs(drift) > 0.01) { driftSeconds = drift; break }
                        }
                      }
                    }
                    const isOutOfSync = Math.abs(driftSeconds) > 0.01
                    return (
                    <div
                      key={clip.id}
                      className={`absolute rounded border-2 transition-all overflow-hidden select-none ${
                        isOutOfSync
                          ? 'border-red-500 shadow-lg shadow-red-500/20'
                          : selectedClipIds.has(clip.id)
                          ? 'border-blue-500 shadow-lg shadow-blue-500/20'
                          : isInBrokenStack
                          ? 'border-red-500/70 shadow-md shadow-red-500/10'
                          : isInStack
                          ? 'border-violet-500/70 shadow-md shadow-violet-500/10'
                          : clipColor
                            ? `hover:brightness-125`
                            : 'border-zinc-600 hover:border-zinc-500'
                      } ${!clipColor ? (clip.type === 'audio' ? 'bg-green-900/50' : clip.type === 'adjustment' ? 'bg-blue-900/40 border-dashed' : clip.type === 'text' ? 'bg-cyan-900/50 border-cyan-600/40' : 'bg-zinc-800') : ''} ${
                        activeTool === 'select' || activeTool === 'ripple' || activeTool === 'roll' ? 'cursor-grab' : ''
                      } ${
                        activeTool === 'slip' ? 'cursor-ew-resize' : ''
                      } ${activeTool === 'slide' ? 'cursor-col-resize' : ''} ${
                        draggingClip?.clipId === clip.id || (draggingClip && selectedClipIds.has(clip.id)) ? 'opacity-80 cursor-grabbing z-30' : ''
                      } ${slipSlideClip?.clipId === clip.id ? 'opacity-90 ring-2 ring-yellow-500/50 z-30' : ''
                      }`}
                      style={{
                        left: `${clip.startTime * pixelsPerSecond}px`,
                        width: `${clip.duration * pixelsPerSecond}px`,
                        top: `${trackTopPx(clip.trackIndex, 4)}px`,
                        height: `${getTrackHeight(clip.trackIndex) - 8}px`,
                        ...(activeTool === 'blade' ? { cursor: SCISSORS_CURSOR }
                          : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR }
                          : {}),
                        ...(clipColor ? {
                          backgroundColor: `${clipColor.color}80`,
                          borderColor: selectedClipIds.has(clip.id) ? undefined : clipColor.color,
                        } : {}),
                      }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
                      onDoubleClick={() => {
                        setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
                        setShowPropertiesPanel(true)
                      }}
                      onMouseMove={(e) => {
                        if (activeTool === 'blade') {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const ox = e.clientX - rect.left
                          let hoverTime = clip.startTime + (ox / rect.width) * clip.duration
                          // Snap blade to clip edges on all tracks and playhead
                          if (snapEnabled) {
                            const targets = [...getSnapTargets(clips, new Set([clip.id]), markers), currentTime]
                            hoverTime = snapToTargets(hoverTime, targets)
                          }
                          const snappedOx = (hoverTime - clip.startTime) * pixelsPerSecond
                          setBladeHoverInfo({ clipId: clip.id, offsetX: snappedOx, time: hoverTime })
                        }
                      }}
                      onMouseLeave={() => {
                        if (activeTool === 'blade' && bladeHoverInfo?.clipId === clip.id) {
                          setBladeHoverInfo(null)
                        }
                      }}
                      onContextMenu={(e) => handleClipContextMenu(e, clip)}
                      /* EFFECTS HIDDEN - drag-drop for effects hidden because effects are not applied during export */
                    >
                      {/* Blade cut indicator line */}
                      {activeTool === 'blade' && bladeHoverInfo && (() => {
                        // Show indicator on the hovered clip, or on all clips at that time when Shift is held
                        const isHoveredClip = bladeHoverInfo.clipId === clip.id
                        const isShiftTarget = bladeShiftHeld && !isHoveredClip &&
                          bladeHoverInfo.time > clip.startTime + 0.05 &&
                          bladeHoverInfo.time < clip.startTime + clip.duration - 0.05
                        if (!isHoveredClip && !isShiftTarget) return null
                        const indicatorPx = isHoveredClip
                          ? bladeHoverInfo.offsetX
                          : (bladeHoverInfo.time - clip.startTime) * pixelsPerSecond
                        return (
                          <div
                            className={`absolute top-0 bottom-0 w-px z-20 pointer-events-none ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`}
                            style={{ left: `${indicatorPx}px` }}
                          >
                            <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`} />
                            <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`} />
                          </div>
                        )
                      })()}
                      <div className={`absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center text-zinc-500 hover:text-white ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-grab'}`}
                        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}>
                        <GripVertical className="h-3 w-3" />
                      </div>
                      
                      <div className="h-full flex items-center pl-5 pr-2 gap-2">
                        {clip.type === 'adjustment' ? (
                          <div className="h-8 w-8 flex-shrink-0 rounded bg-blue-800/30 border border-blue-600/30 flex items-center justify-center">
                            <Layers className="h-4 w-4 text-blue-400" />
                          </div>
                        ) : clip.type === 'text' ? (
                          <div className="h-8 w-8 flex-shrink-0 rounded bg-cyan-800/30 border border-cyan-600/30 flex items-center justify-center">
                            <Type className="h-4 w-4 text-cyan-400" />
                          </div>
                        ) : clip.type === 'audio' ? (
                          <>
                            <ClipWaveform url={getClipUrl(clip) || clip.asset?.url || clip.importedUrl || ''} trimStart={clip.trimStart} trimEnd={clip.trimEnd} mediaDuration={clip.asset?.duration} />
                            <div className="h-8 w-8 flex-shrink-0 rounded bg-emerald-800/50 flex items-center justify-center relative z-10">
                              <Music className="h-4 w-4 text-emerald-400" />
                            </div>
                          </>
                        ) : clip.asset && (
                          <AssetThumbnail
                            key={`thumb-${clip.id}-${clip.takeIndex ?? 'default'}`}
                            src={getClipUrl(clip) || clip.asset.url}
                            type={clip.asset.type === 'image' ? 'image' : 'video'}
                            className="h-8 aspect-video object-cover rounded"
                          />
                        )}
                        <div className={`flex-1 min-w-0 ${clip.type === 'audio' ? 'relative z-10' : ''}`}>
                          <p className={`text-[10px] truncate ${clip.type === 'adjustment' ? 'text-blue-300' : clip.type === 'text' ? 'text-cyan-300' : clip.type === 'audio' ? 'text-emerald-300' : 'text-zinc-300'}`}>
                            {clip.type === 'adjustment' ? 'Adjustment Layer' : clip.type === 'text' ? (clip.textStyle?.text?.slice(0, 30) || 'Text') : clip.asset?.prompt?.slice(0, 30) || clip.importedName || 'Clip'}
                          </p>
                          <div className="flex items-center gap-2 text-[9px] text-zinc-500">
                            <span>{clip.duration.toFixed(1)}s</span>
                            {(() => {
                              const resInfo = getClipResolution(clip)
                              if (!resInfo) return null
                              return <span style={{ color: resInfo.color }} className="font-semibold">{resInfo.height >= 2160 ? '4K' : `${resInfo.height}p`}</span>
                            })()}
                            {clip.speed !== 1 && <span className="text-yellow-400">{clip.speed}x</span>}
                            {clip.reversed && <span className="text-blue-400">REV</span>}
                            {clip.muted && <span className="text-red-400">M</span>}
                            {(clip.flipH || clip.flipV) && <span className="text-cyan-400">FLIP</span>}
                            {clip.colorCorrection && Object.values(clip.colorCorrection).some(v => v !== 0) && <span className="text-orange-400">CC</span>}
                            {clip.letterbox?.enabled && <span className="text-blue-400">LB</span>}
                            {clip.linkedClipIds?.length && <Link2 className="h-2.5 w-2.5 text-zinc-500 inline" />}
                            {isInStack && <Layers className="h-2.5 w-2.5 text-violet-400 inline cursor-pointer hover:text-violet-300" onClick={(e) => { e.stopPropagation(); setActiveStackId(clip.inferenceStackId!) }} />}
                          </div>
                        </div>
                        
                        {/* Take navigation + Regenerate (only for clips with gen params) */}
                        {(() => {
                          const liveAsset = getLiveAsset(clip)
                          if (!liveAsset || clip.duration * pixelsPerSecond <= 60 || clip.type === 'adjustment' || clip.type === 'audio') return null
                          return (
                            <div className="flex-shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                              {/* Take navigation: prev/next */}
                              {liveAsset.takes && liveAsset.takes.length > 1 && (
                                <>
                                  <Tooltip content="Previous take" side="top">
                                    <button
                                      onClick={() => handleClipTakeChange(clip.id, 'prev')}
                                      className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                    >
                                      <ChevronLeft className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <span className="text-[8px] text-zinc-400 min-w-[24px] text-center">
                                    {(clip.takeIndex ?? (liveAsset.activeTakeIndex ?? liveAsset.takes.length - 1)) + 1}/{liveAsset.takes.length}
                                  </span>
                                  <Tooltip content="Next take" side="top">
                                    <button
                                      onClick={() => handleClipTakeChange(clip.id, 'next')}
                                      className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                    >
                                      <ChevronRight className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="Delete this take" side="top">
                                    <button
                                      onClick={() => {
                                        if (confirm(`Delete take ${(clip.takeIndex ?? (liveAsset.activeTakeIndex ?? liveAsset.takes!.length - 1)) + 1}?`)) {
                                          handleDeleteTake(clip.id)
                                        }
                                      }}
                                      className="p-0.5 rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors"
                                    >
                                      <Trash2 className="h-2.5 w-2.5" />
                                    </button>
                                  </Tooltip>
                                </>
                              )}
                              <Tooltip content="Regenerate shot" side="top">
                                <button
                                  onClick={() => handleRegenerate(clip.assetId!, clip.id)}
                                  disabled={isRegenerating}
                                  className={`p-0.5 rounded transition-colors ${
                                    clip.isRegenerating
                                      ? 'text-blue-400'
                                      : 'hover:bg-white/10 text-zinc-500 hover:text-blue-400'
                                  }`}
                                >
                                  <RefreshCw className={`h-3 w-3 ${clip.isRegenerating ? 'animate-spin' : ''}`} />
                                </button>
                              </Tooltip>
                              {clip.type === 'video' && (
                                <Tooltip content="Retake section" side="top">
                                  <button
                                    onClick={() => handleRetakeClip(clip)}
                                    className="p-0.5 rounded transition-colors hover:bg-white/10 text-zinc-500 hover:text-blue-400"
                                  >
                                    <Film className="h-3 w-3" />
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      
                      {/* Regenerating overlay on the clip */}
                      {clip.isRegenerating && (
                        <div className="absolute inset-0 bg-blue-900/30 backdrop-blur-[2px] flex items-center justify-center rounded-lg z-10">
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-900/80 border border-blue-500/40">
                            <Loader2 className="h-3 w-3 text-blue-300 animate-spin" />
                            <span className="text-[9px] text-blue-200 font-medium">
                              {regenProgress > 0 ? `${regenProgress}%` : 'Regenerating...'}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelRegeneration() }}
                              className="ml-1 px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-600/60 text-[9px] text-zinc-300 hover:text-red-400 hover:border-red-500/50 hover:bg-red-900/30 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Stack rendering overlay */}
                      {isRenderingClip && (
                        <div className="absolute inset-0 bg-violet-900/40 z-10 flex flex-col justify-end">
                          <div className="px-1.5 py-0.5 flex items-center gap-1">
                            <Loader2 className="h-2.5 w-2.5 text-violet-300 animate-spin" />
                            <span className="text-[8px] text-violet-200 font-medium truncate flex-1">
                              {stackRenderStatusMessage || 'Rendering...'}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancelStackRender() }}
                              className="px-1 py-0.5 rounded bg-zinc-800/80 border border-zinc-600/60 text-[8px] text-zinc-300 hover:text-red-400 hover:border-red-500/50 hover:bg-red-900/30 transition-colors"
                            >
                              Stop
                            </button>
                          </div>
                          <div className="h-1 bg-violet-950/60">
                            <div className="h-full bg-violet-400 transition-all duration-300" style={{ width: `${stackRenderProgress}%` }} />
                          </div>
                        </div>
                      )}

                      {/* Out-of-sync drift indicator for linked clips */}
                      {isOutOfSync && (
                        <div className="absolute top-0 left-0 z-20 px-1.5 py-0.5 bg-red-600/90 rounded-br text-[9px] font-bold text-white pointer-events-none">
                          {driftSeconds > 0 ? '+' : ''}{driftSeconds.toFixed(1)}s
                        </div>
                      )}

                      {/* Volume automation overlay for audio/video clips */}
                      {clip.type === 'audio' && (
                        <VolumeAutomationOverlay
                          clipDuration={clip.duration}
                          trimStart={clip.trimStart}
                          volume={clip.volume}
                          keyframes={clip.volumeAutomation}
                          widthPx={clip.duration * pixelsPerSecond}
                          heightPx={getTrackHeight(clip.trackIndex) - 8}
                          muted={clip.muted}
                          onBeforeEdit={() => pushUndo()}
                          onUpdate={(kf) => updateClip(clip.id, { volumeAutomation: kf })}
                          onVolumeChange={(v) => updateClip(clip.id, { volume: v })}
                        />
                      )}

                      {/* Transition in indicator */}
                      {clip.transitionIn?.type !== 'none' && clip.transitionIn?.duration > 0 && (
                        <div
                          className="absolute top-0 bottom-0 left-0 pointer-events-none"
                          style={{
                            width: `${Math.min(clip.transitionIn.duration / clip.duration * 100, 50)}%`,
                            background: 'linear-gradient(to right, rgba(139,92,246,0.4), transparent)',
                          }}
                        />
                      )}
                      {/* Transition out indicator */}
                      {clip.transitionOut?.type !== 'none' && clip.transitionOut?.duration > 0 && (
                        <div
                          className="absolute top-0 bottom-0 right-0 pointer-events-none"
                          style={{
                            width: `${Math.min(clip.transitionOut.duration / clip.duration * 100, 50)}%`,
                            background: 'linear-gradient(to left, rgba(139,92,246,0.4), transparent)',
                          }}
                        />
                      )}
                      
                      {/* Resolution color-code bar at the bottom of the clip */}
                      {(() => {
                        const resInfo = getClipResolution(clip)
                        if (!resInfo) return null
                        return (
                          <div
                            className="absolute bottom-0 left-0 right-0 h-[3px] pointer-events-none"
                            style={{ backgroundColor: resInfo.color }}
                            title={resInfo.label}
                          />
                        )
                      })()}

                      <div
                        className={`absolute left-0 top-0 bottom-0 w-3 ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-ew-resize'} transition-colors flex items-center justify-center ${
                          resizingClip?.clipId === clip.id && resizingClip?.edge === 'left'
                            ? activeTool === 'roll' ? 'bg-yellow-500' : activeTool === 'ripple' ? 'bg-green-500' : 'bg-blue-500'
                            : trimEdgeHighlightIds.has(clip.id) && selectedTrimEdge?.edge === 'left'
                            ? 'bg-blue-500/70'
                            : activeTool === 'roll' ? 'hover:bg-yellow-500/50' : activeTool === 'ripple' ? 'hover:bg-green-500/50' : 'hover:bg-blue-500/50'
                        }`}
                        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
                        onMouseDown={(e) => handleResizeStart(e, clip, 'left')}
                      >
                        <div className={`w-0.5 h-6 rounded-full ${
                          activeTool === 'roll' ? 'bg-yellow-300' : activeTool === 'ripple' ? 'bg-green-300' : 'bg-zinc-500'
                        }`} />
                      </div>
                      <div
                        className={`absolute right-0 top-0 bottom-0 w-3 ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-ew-resize'} transition-colors flex items-center justify-center ${
                          resizingClip?.clipId === clip.id && resizingClip?.edge === 'right'
                            ? activeTool === 'roll' ? 'bg-yellow-500' : activeTool === 'ripple' ? 'bg-green-500' : 'bg-blue-500'
                            : trimEdgeHighlightIds.has(clip.id) && selectedTrimEdge?.edge === 'right'
                            ? 'bg-blue-500/70'
                            : activeTool === 'roll' ? 'hover:bg-yellow-500/50' : activeTool === 'ripple' ? 'hover:bg-green-500/50' : 'hover:bg-blue-500/50'
                        }`}
                        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
                        onMouseDown={(e) => handleResizeStart(e, clip, 'right')}
                      >
                        <div className={`w-0.5 h-6 rounded-full ${
                          activeTool === 'roll' ? 'bg-yellow-300' : activeTool === 'ripple' ? 'bg-green-300' : 'bg-zinc-500'
                        }`} />
                      </div>
                    </div>
                  )})}

                  {/* Bin-to-timeline drag preview ghost clips */}
                  {binDragPreview && binDragAssetsRef.current.length > 0 && (() => {
                    const dragAssets = binDragAssetsRef.current
                    const isOverwrite = binDragPreview.overwrite
                    const preferredAudio = tracks.findIndex(t => t.kind === 'audio' && !t.locked && t.sourcePatched !== false)
                    // Helper: check if a time range is free on a track
                    const isFreeAt = (tIdx: number, start: number, dur: number) =>
                      !clips.some(c => c.trackIndex === tIdx && c.startTime < start + dur && c.startTime + c.duration > start)
                    // Helper: find first free track of a kind
                    const findFree = (kind: 'video' | 'audio', preferred: number, start: number, dur: number): number => {
                      if (isOverwrite) return preferred >= 0 ? preferred : 0
                      // Try preferred first if it's the right kind
                      const pt = tracks[preferred]
                      if (preferred >= 0 && pt?.kind === kind && !pt.locked && isFreeAt(preferred, start, dur)) return preferred
                      // Search all tracks of this kind from the first
                      for (let i = 0; i < tracks.length; i++) {
                        const t = tracks[i]
                        if (t.kind !== kind || t.locked) continue
                        if (isFreeAt(i, start, dur)) return i
                      }
                      return preferred >= 0 ? preferred : 0
                    }
                    const borderCls = isOverwrite ? 'border-red-500' : 'border-blue-500'
                    const shadowCls = isOverwrite ? 'shadow-red-500/30' : 'shadow-blue-500/30'
                    // Resolve preferred video track: use cursor track if it's video, otherwise first video track
                    const cursorTrack = tracks[binDragPreview.trackIndex]
                    const prefVideo = (cursorTrack?.kind === 'video' && !cursorTrack.locked)
                      ? binDragPreview.trackIndex
                      : tracks.findIndex(t => t.kind === 'video' && !t.locked)
                    let nextStart = binDragPreview.startTime
                    const ghosts: React.ReactNode[] = []
                    for (let i = 0; i < dragAssets.length; i++) {
                      const asset = dragAssets[i]
                      const duration = asset.duration || 5
                      const clipStart = nextStart
                      nextStart += duration
                      const isVideo = asset.type === 'video'
                      // Resolve actual video track
                      const videoTIdx = findFree('video', prefVideo >= 0 ? prefVideo : 0, clipStart, duration)
                      const trackHeight = getTrackHeight(videoTIdx)
                      // Video/image/adjustment ghost
                      ghosts.push(
                        <div
                          key={`ghost-${i}`}
                          className={`absolute rounded border-2 ${borderCls} overflow-hidden select-none pointer-events-none z-40 shadow-lg ${shadowCls} ${
                            asset.type === 'audio' ? 'bg-green-900/60' : 'bg-zinc-800/80'
                          }`}
                          style={{
                            left: `${clipStart * pixelsPerSecond}px`,
                            width: `${duration * pixelsPerSecond}px`,
                            top: `${trackTopPx(videoTIdx, 4)}px`,
                            height: `${trackHeight - 8}px`,
                            opacity: 0.85,
                          }}
                        >
                          <div className="absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center text-zinc-500">
                            <GripVertical className="h-3 w-3" />
                          </div>
                          <div className="h-full flex items-center pl-5 pr-2 gap-2">
                            {asset.type === 'audio' ? (
                              <div className="h-8 w-8 flex-shrink-0 rounded bg-emerald-800/50 flex items-center justify-center">
                                <Music className="h-4 w-4 text-emerald-400" />
                              </div>
                            ) : asset.type === 'video' || asset.type === 'image' ? (
                              <AssetThumbnail src={asset.url} type={asset.type} className="h-8 aspect-video object-cover rounded" />
                            ) : (
                              <div className="h-8 w-8 flex-shrink-0 rounded bg-blue-800/30 border border-blue-600/30 flex items-center justify-center">
                                <Layers className="h-4 w-4 text-blue-400" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-[10px] truncate ${asset.type === 'audio' ? 'text-emerald-300' : 'text-zinc-300'}`}>
                                {asset.prompt?.slice(0, 30) || asset.path?.split(/[/\\]/).pop() || 'Clip'}
                              </p>
                              <div className="flex items-center gap-2 text-[9px] text-zinc-500">
                                <span>{duration.toFixed(1)}s</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                      // Linked audio ghost for video assets
                      if (isVideo && preferredAudio >= 0) {
                        const audioTIdx = findFree('audio', preferredAudio, clipStart, duration)
                        const audioHeight = getTrackHeight(audioTIdx)
                        ghosts.push(
                          <div
                            key={`ghost-audio-${i}`}
                            className={`absolute rounded border-2 ${borderCls} bg-green-900/60 overflow-hidden select-none pointer-events-none z-40 shadow-lg ${shadowCls}`}
                            style={{
                              left: `${clipStart * pixelsPerSecond}px`,
                              width: `${duration * pixelsPerSecond}px`,
                              top: `${trackTopPx(audioTIdx, 4)}px`,
                              height: `${audioHeight - 8}px`,
                              opacity: 0.85,
                            }}
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center text-zinc-500">
                              <GripVertical className="h-3 w-3" />
                            </div>
                            <div className="h-full flex items-center pl-5 pr-2 gap-2">
                              <div className="h-8 w-8 flex-shrink-0 rounded bg-emerald-800/50 flex items-center justify-center">
                                <Music className="h-4 w-4 text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] truncate text-emerald-300">
                                  {asset.prompt?.slice(0, 30) || asset.path?.split(/[/\\]/).pop() || 'Audio'}
                                </p>
                                <div className="flex items-center gap-2 text-[9px] text-zinc-500">
                                  <span>{duration.toFixed(1)}s</span>
                                  <Link2 className="h-2.5 w-2.5 text-zinc-500 inline" />
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      }
                    }
                    return ghosts
                  })()}

                  {/* Gap indicators between clips */}
                  {timelineGaps.map((gap, i) => {
                    const leftPx = gap.startTime * pixelsPerSecond
                    const widthPx = (gap.endTime - gap.startTime) * pixelsPerSecond
                    const topPx = trackTopPx(gap.trackIndex, 4)
                    const isSelected = selectedGap &&
                      selectedGap.trackIndex === gap.trackIndex &&
                      Math.abs(selectedGap.startTime - gap.startTime) < 0.01 &&
                      Math.abs(selectedGap.endTime - gap.endTime) < 0.01
                    const isGeneratingHere = generatingGap &&
                      generatingGap.trackIndex === gap.trackIndex &&
                      Math.abs(generatingGap.startTime - gap.startTime) < 0.01 &&
                      Math.abs(generatingGap.endTime - gap.endTime) < 0.01

                    if (widthPx < 4) return null

                    return (
                      <div
                        key={`gap-${i}`}
                        data-gap="true"
                        className={`absolute rounded cursor-pointer transition-all group ${
                          isGeneratingHere
                            ? 'bg-blue-500/15 border-2 border-dashed border-blue-400/60 shadow-inner'
                            : isSelected
                            ? 'bg-blue-500/20 border-2 border-dashed border-blue-400/60 shadow-inner'
                            : 'border-2 border-dashed border-transparent hover:bg-blue-500/10 hover:border-blue-400/30'
                        }`}
                        style={{
                          left: `${leftPx}px`,
                          top: `${topPx}px`,
                          width: `${widthPx}px`,
                          height: `${getTrackHeight(gap.trackIndex) - 8}px`,
                        }}
                        onMouseDown={(e) => {
                          // Record start position to distinguish click from drag
                          const startX = e.clientX
                          const startY = e.clientY
                          const target = e.currentTarget as HTMLElement
                          const onUp = (upE: MouseEvent) => {
                            window.removeEventListener('mouseup', onUp)
                            const dx = upE.clientX - startX
                            const dy = upE.clientY - startY
                            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) return // was a drag, not a click
                            if (isGeneratingHere) return
                            setSelectedGap(gap)
                            setSelectedClipIds(new Set())
                            setSelectedSubtitleId(null)
                            setGapGenerateMode(null)
                            const r = target.getBoundingClientRect()
                            setSelectedGapAnchor({ x: r.left + r.width / 2, gapTop: r.top, gapBottom: r.bottom })
                          }
                          window.addEventListener('mouseup', onUp)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (isGeneratingHere) return
                          setSelectedGap(gap)
                          setSelectedClipIds(new Set())
                          setSelectedSubtitleId(null)
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setSelectedGapAnchor({ x: r.left + r.width / 2, gapTop: r.top, gapBottom: r.bottom })
                        }}
                      >
                        {isGeneratingHere ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                            <Loader2 className="h-3 w-3 text-blue-400 animate-spin pointer-events-none" />
                            {widthPx > 50 && (
                              <span className="text-[9px] text-blue-300 font-medium pointer-events-none">
                                {gapRegenProgress > 0 ? `${gapRegenProgress}%` : 'Generating...'}
                              </span>
                            )}
                            {widthPx > 30 && (
                              <div className="w-3/4 h-0.5 bg-blue-900/40 rounded-full overflow-hidden pointer-events-none">
                                <div
                                  className="h-full bg-blue-400 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.max(gapRegenProgress, 2)}%` }}
                                />
                              </div>
                            )}
                            {/* Cancel button */}
                            <Tooltip content="Cancel generation" side="top">
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelGapGeneration() }}
                                className="absolute top-0.5 right-0.5 p-0.5 rounded hover:bg-zinc-700/80 text-zinc-500 hover:text-red-400 transition-colors"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </Tooltip>
                          </div>
                        ) : (
                          <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}>
                            <span className="text-[9px] font-medium text-blue-400">
                              {(gap.endTime - gap.startTime).toFixed(1)}s
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  
                  {/* Subtitle clips on subtitle tracks */}
                  {subtitles.map(sub => {
                    const track = tracks[sub.trackIndex]
                    if (!track || track.type !== 'subtitle') return null
                    const leftPx = sub.startTime * pixelsPerSecond
                    const widthPx = Math.max(20, (sub.endTime - sub.startTime) * pixelsPerSecond)
                    const topPx = trackTopPx(sub.trackIndex, 4)
                    const isSelected = selectedSubtitleId === sub.id
                    const isEditing = editingSubtitleId === sub.id
                    
                    return (
                      <div
                        key={sub.id}
                        className={`absolute rounded border-2 overflow-hidden cursor-pointer select-none flex items-center ${
                          isSelected
                            ? 'border-amber-400 shadow-lg shadow-amber-500/20 bg-amber-900/60'
                            : 'border-amber-700/50 hover:border-amber-600/70 bg-amber-900/40'
                        } ${track.locked ? 'pointer-events-none opacity-50' : ''}`}
                        style={{
                          left: `${leftPx}px`,
                          top: `${topPx}px`,
                          width: `${widthPx}px`,
                          height: `${getTrackHeight(sub.trackIndex) - 8}px`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedSubtitleId(sub.id)
                          setSelectedClipIds(new Set())
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditingSubtitleId(sub.id)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setSelectedSubtitleId(sub.id)
                          setSelectedClipIds(new Set())
                        }}
                        onMouseDown={(e) => {
                          if (track.locked || e.button !== 0) return
                          e.stopPropagation()
                          const startX = e.clientX
                          const origStart = sub.startTime
                          const origEnd = sub.endTime
                          const dur = origEnd - origStart
                          
                          const onMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const dt = dx / pixelsPerSecond
                            const newStart = Math.max(0, origStart + dt)
                            updateSubtitle(sub.id, { startTime: newStart, endTime: newStart + dur })
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        {/* Subtitle text */}
                        <div className="flex-1 min-w-0 px-2 py-1">
                          {isEditing ? (
                            <input
                              autoFocus
                              defaultValue={sub.text}
                              className="w-full bg-transparent text-amber-100 text-[10px] leading-tight outline-none border-b border-amber-500/50"
                              onBlur={(e) => {
                                updateSubtitle(sub.id, { text: e.target.value })
                                setEditingSubtitleId(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  updateSubtitle(sub.id, { text: (e.target as HTMLInputElement).value })
                                  setEditingSubtitleId(null)
                                }
                                if (e.key === 'Escape') setEditingSubtitleId(null)
                                e.stopPropagation()
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-[10px] text-amber-200 leading-tight line-clamp-2 break-all">
                              {sub.text}
                            </span>
                          )}
                        </div>
                        
                        {/* Left resize handle */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/30"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            const startX = e.clientX
                            const origStart = sub.startTime
                            const onMove = (ev: MouseEvent) => {
                              const dx = ev.clientX - startX
                              const dt = dx / pixelsPerSecond
                              const newStart = Math.max(0, Math.min(sub.endTime - 0.2, origStart + dt))
                              updateSubtitle(sub.id, { startTime: newStart })
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        />
                        {/* Right resize handle */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/30"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            const startX = e.clientX
                            const origEnd = sub.endTime
                            const onMove = (ev: MouseEvent) => {
                              const dx = ev.clientX - startX
                              const dt = dx / pixelsPerSecond
                              const newEnd = Math.max(sub.startTime + 0.2, origEnd + dt)
                              updateSubtitle(sub.id, { endTime: newEnd })
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        />
                      </div>
                    )
                  })}
                  
                  {/* Cut point indicators for cross-dissolve */}
                  {cutPoints.map((cp) => {
                    const leftPx = cp.time * pixelsPerSecond
                    const topPx = trackTopPx(cp.trackIndex, 4)
                    const isHovered = hoveredCutPoint?.leftClipId === cp.leftClip.id && hoveredCutPoint?.rightClipId === cp.rightClip.id
                    const isSelected = selectedCutPoint?.leftClipId === cp.leftClip.id && selectedCutPoint?.rightClipId === cp.rightClip.id
                    const dissolveDur = cp.hasDissolve ? (cp.leftClip.transitionOut?.duration || DEFAULT_DISSOLVE_DURATION) : 0
                    const dissolveWidthPx = dissolveDur * pixelsPerSecond
                    
                    return (
                      <div
                        key={`cut-${cp.leftClip.id}-${cp.rightClip.id}`}
                        className="absolute"
                        style={{
                          left: `${cp.hasDissolve ? leftPx - dissolveWidthPx : leftPx - 10}px`,
                          top: `${topPx - 24}px`,
                          width: `${cp.hasDissolve ? dissolveWidthPx * 2 : 20}px`,
                          height: `${48 + 24}px`, /* extend upward to include popup zone */
                          pointerEvents: 'none', /* visuals only — interactive parts opt in below */
                          zIndex: 20,
                        }}
                      >
                        {/* Hover zone — full height for detecting mouse enter/leave */}
                        <div
                          className="absolute top-0 bottom-0"
                          style={{ left: `${cp.hasDissolve ? dissolveWidthPx - 10 : 0}px`, width: '20px', pointerEvents: 'auto' }}
                          onMouseEnter={() => setHoveredCutPoint({
                            leftClipId: cp.leftClip.id,
                            rightClipId: cp.rightClip.id,
                            time: cp.time,
                            trackIndex: cp.trackIndex,
                          })}
                          onMouseLeave={() => setHoveredCutPoint(null)}
                        />
                        {/* Visible indicator line — click to select, drag to roll edit */}
                        <div
                          className="absolute top-6 bottom-0 cursor-ew-resize z-25 flex items-stretch justify-center"
                          style={{ left: `${cp.hasDissolve ? dissolveWidthPx : 10}px`, transform: 'translateX(-50%)', width: '12px', pointerEvents: 'auto' }}
                          onMouseDown={(e) => {
                            if (cp.hasDissolve) return // Don't roll edit over dissolves
                            e.stopPropagation()
                            e.preventDefault()
                            const cpState = {
                              leftClipId: cp.leftClip.id,
                              rightClipId: cp.rightClip.id,
                              time: cp.time,
                              trackIndex: cp.trackIndex,
                            }
                            setSelectedCutPoint(cpState)
                            setSelectedTrimEdge(null)
                            setSelectedClipIds(new Set())
                            // Start drag for rolling edit
                            const independent = e.ctrlKey || e.metaKey
                            const startX = e.clientX
                            const origLeftDur = cp.leftClip.duration
                            const origRightStart = cp.rightClip.startTime
                            const origRightDur = cp.rightClip.duration
                            const origRightTrimStart = cp.rightClip.trimStart
                            const origLeft = { duration: origLeftDur, trimEnd: cp.leftClip.trimEnd, speed: cp.leftClip.speed, type: cp.leftClip.type }
                            const origRight = { startTime: origRightStart, duration: origRightDur, trimStart: origRightTrimStart, speed: cp.rightClip.speed, type: cp.rightClip.type }
                            // Capture linked clips for synchronized rolling edit
                            const leftLinkedIds = independent ? [] : (cp.leftClip.linkedClipIds || [])
                            const rightLinkedIds = independent ? [] : (cp.rightClip.linkedClipIds || [])
                            const linkedOriginals = new Map<string, { duration: number; startTime: number; trimStart: number; trimEnd: number; speed: number; type: string }>()
                            for (const lid of leftLinkedIds) {
                              const lc = clips.find(c => c.id === lid)
                              if (lc) linkedOriginals.set(lid, { duration: lc.duration, startTime: lc.startTime, trimStart: lc.trimStart, trimEnd: lc.trimEnd, speed: lc.speed, type: lc.type })
                            }
                            for (const lid of rightLinkedIds) {
                              const lc = clips.find(c => c.id === lid)
                              if (lc) linkedOriginals.set(lid, { duration: lc.duration, startTime: lc.startTime, trimStart: lc.trimStart, trimEnd: lc.trimEnd, speed: lc.speed, type: lc.type })
                            }
                            const leftLinkedSet = new Set(leftLinkedIds)
                            const rightLinkedSet = new Set(rightLinkedIds)
                            // Snap targets: all clip edges except the two being edited
                            const editIds = new Set([cp.leftClip.id, cp.rightClip.id, ...leftLinkedIds, ...rightLinkedIds])
                            const snapTargets = snapEnabled ? getSnapTargets(clips, editIds, markers) : []
                            let hasMoved = false
                            const onMove = (ev: MouseEvent) => {
                              if (!hasMoved) { hasMoved = true; pushUndo() }
                              const dx = ev.clientX - startX
                              let dt = dx / pixelsPerSecond
                              dt = clampRollDelta(dt, origLeft, origRight)
                              // Snap the edit point position
                              if (snapTargets.length > 0) {
                                const snapped = snapToTargets(cp.time + dt, snapTargets)
                                if (snapped !== cp.time + dt) dt = snapped - cp.time
                                dt = clampRollDelta(dt, origLeft, origRight)
                              }
                              setClips(prev => prev.map(cl => {
                                // Primary clips
                                const rolled = applyRollEdit(cl, cp.leftClip.id, cp.rightClip.id, dt, origLeft, origRight)
                                if (rolled !== cl) return rolled
                                // Linked clips
                                if (leftLinkedSet.has(cl.id)) {
                                  const orig = linkedOriginals.get(cl.id)!
                                  return applyRollEdit(cl, cl.id, '', dt, orig, origRight)
                                }
                                if (rightLinkedSet.has(cl.id)) {
                                  const orig = linkedOriginals.get(cl.id)!
                                  return applyRollEdit(cl, '', cl.id, dt, origLeft, orig)
                                }
                                return cl
                              }))
                              setSelectedCutPoint(prev => prev && { ...prev, time: cp.time + dt })
                            }
                            const onUp = () => {
                              document.removeEventListener('mousemove', onMove)
                              document.removeEventListener('mouseup', onUp)
                              document.body.style.cursor = ''
                              document.body.style.userSelect = ''
                            }
                            document.addEventListener('mousemove', onMove)
                            document.addEventListener('mouseup', onUp)
                            document.body.style.cursor = 'ew-resize'
                            document.body.style.userSelect = 'none'
                          }}
                        >
                          <div className={`w-0.5 h-full transition-colors ${
                            isSelected ? 'bg-amber-400 !w-1' : isHovered ? 'bg-blue-400' : cp.hasDissolve ? 'bg-blue-500/60' : 'bg-transparent'
                          }`} style={isSelected ? { width: '3px', borderRadius: '1px' } : undefined} />
                        </div>

                        {cp.hasDissolve ? (
                          <>
                            {/* Dissolve region visual (gradient bar on the clip area) */}
                            <div
                              className="absolute rounded-sm pointer-events-none"
                              style={{
                                left: 0,
                                top: '24px',
                                width: `${dissolveWidthPx * 2}px`,
                                height: '48px',
                                background: 'linear-gradient(to right, rgba(139,92,246,0.15), rgba(139,92,246,0.3), rgba(139,92,246,0.15))',
                                borderTop: '2px solid rgba(139,92,246,0.5)',
                                borderBottom: '2px solid rgba(139,92,246,0.5)',
                              }}
                            />
                            
                            {/* Dissolve duration label */}
                            <div
                              className="absolute flex items-center justify-center pointer-events-none"
                              style={{
                                left: 0,
                                top: '24px',
                                width: `${dissolveWidthPx * 2}px`,
                                height: '48px',
                              }}
                            >
                              <span className="text-[9px] text-blue-300 font-medium bg-blue-900/60 px-1.5 py-0.5 rounded">
                                {dissolveDur.toFixed(1)}s
                              </span>
                            </div>
                            
                            {/* Left drag handle */}
                            <div
                              className="absolute top-6 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/40 transition-colors z-30"
                              style={{ left: 0, pointerEvents: 'auto' }}
                              onMouseDown={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                const startX = e.clientX
                                const startDur = dissolveDur
                                
                                const handleMove = (ev: MouseEvent) => {
                                  const delta = (startX - ev.clientX) / pixelsPerSecond
                                  const newDur = Math.max(0.1, Math.min(cp.leftClip.duration * 0.9, startDur + delta))
                                  setClips(prev => prev.map(c => {
                                    if (c.id === cp.leftClip.id) return { ...c, transitionOut: { ...c.transitionOut, duration: +newDur.toFixed(2) } }
                                    if (c.id === cp.rightClip.id) return { ...c, transitionIn: { ...c.transitionIn, duration: +newDur.toFixed(2) } }
                                    return c
                                  }))
                                }
                                const handleUp = () => {
                                  document.removeEventListener('mousemove', handleMove)
                                  document.removeEventListener('mouseup', handleUp)
                                  document.body.style.cursor = ''
                                  document.body.style.userSelect = ''
                                }
                                pushUndo()
                                document.addEventListener('mousemove', handleMove)
                                document.addEventListener('mouseup', handleUp)
                                document.body.style.cursor = 'ew-resize'
                                document.body.style.userSelect = 'none'
                              }}
                            >
                              <div className="absolute inset-y-0 left-0 w-0.5 bg-blue-400 rounded-full" />
                            </div>
                            
                            {/* Right drag handle */}
                            <div
                              className="absolute top-6 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/40 transition-colors z-30"
                              style={{ right: 0, pointerEvents: 'auto' }}
                              onMouseDown={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                const startX = e.clientX
                                const startDur = dissolveDur
                                
                                const handleMove = (ev: MouseEvent) => {
                                  const delta = (ev.clientX - startX) / pixelsPerSecond
                                  const newDur = Math.max(0.1, Math.min(cp.rightClip.duration * 0.9, startDur + delta))
                                  setClips(prev => prev.map(c => {
                                    if (c.id === cp.leftClip.id) return { ...c, transitionOut: { ...c.transitionOut, duration: +newDur.toFixed(2) } }
                                    if (c.id === cp.rightClip.id) return { ...c, transitionIn: { ...c.transitionIn, duration: +newDur.toFixed(2) } }
                                    return c
                                  }))
                                }
                                const handleUp = () => {
                                  document.removeEventListener('mousemove', handleMove)
                                  document.removeEventListener('mouseup', handleUp)
                                  document.body.style.cursor = ''
                                  document.body.style.userSelect = ''
                                }
                                pushUndo()
                                document.addEventListener('mousemove', handleMove)
                                document.addEventListener('mouseup', handleUp)
                                document.body.style.cursor = 'ew-resize'
                                document.body.style.userSelect = 'none'
                              }}
                            >
                              <div className="absolute inset-y-0 right-0 w-0.5 bg-blue-400 rounded-full" />
                            </div>
                            
                            {/* Remove button — always visible for dissolves */}
                            <div
                              className="absolute left-1/2 -translate-x-1/2 top-0 whitespace-nowrap z-40"
                              style={{ pointerEvents: 'auto' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="px-1.5 py-0.5 rounded bg-red-900/80 border border-red-700 text-[8px] text-red-300 hover:bg-red-800 transition-colors shadow-lg opacity-60 hover:opacity-100"
                                onClick={() => removeCrossDissolve(cp.leftClip.id, cp.rightClip.id)}
                              >
                                ✕
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* No dissolve: show add button on hover (positioned inside the zone) */}
                            {isHovered && (
                              <div
                                className="absolute left-1/2 -translate-x-1/2 top-0 whitespace-nowrap z-40"
                                style={{ pointerEvents: 'auto' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className="px-2 py-1 rounded-lg bg-blue-600/90 border border-blue-500 text-[10px] text-white hover:bg-blue-500 transition-colors shadow-lg flex items-center gap-1"
                                  onClick={() => addCrossDissolve(cp.leftClip.id, cp.rightClip.id)}
                                >
                                  <Film className="h-3 w-3" />
                                  Dissolve
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>{/* close relative inner */}
              </div>{/* close trackContainerRef */}
              </div>{/* close content column */}
            </div>{/* close scrollable area row */}
            </div>{/* close tracks body flex-col */}
          </div>
        </div>
        
        {/* Bottom toolbar with zoom bar */}
        <div className="h-9 bg-zinc-900 border-t border-zinc-800 flex items-center px-3 gap-2 flex-shrink-0">
          {selectedClip && (
            <>
              <div className="w-px h-4 bg-zinc-700" />
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <Gauge className="h-3 w-3" />
                <select
                  value={selectedClip.speed}
                  onChange={(e) => {
                    const newSpeed = parseFloat(e.target.value)
                    const oldSpeed = selectedClip.speed
                    let newDuration = selectedClip.duration * (oldSpeed / newSpeed)
                    const maxDur = getMaxClipDuration({ ...selectedClip, speed: newSpeed })
                    newDuration = Math.min(newDuration, maxDur)
                    newDuration = Math.max(0.5, newDuration)
                    updateClip(selectedClip.id, { speed: newSpeed, duration: newDuration })
                  }}
                  className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-white"
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            </>
          )}
          
          <div className="w-px h-4 bg-zinc-700" />
          
          <Button
            variant="outline"
            size="sm"
            className="h-6 border-zinc-700 text-zinc-400 text-[10px] px-2"
            onClick={() => setShowExportModal(true)}
          >
            <Upload className="h-3 w-3 mr-1" />
            Export
          </Button>

          <Button
            variant="outline"
            size="sm"
            className={`h-6 text-[10px] px-2 ${
              previewStatus === 'rendering'
                ? 'border-blue-700 text-blue-400'
                : previewStatus === 'ready'
                ? 'border-green-700 text-green-400'
                : 'border-zinc-700 text-zinc-400'
            }`}
            onClick={previewStatus === 'rendering' ? cancelRender : forceRender}
          >
            {previewStatus === 'rendering' ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Rendering...</>
            ) : previewStatus === 'ready' ? (
              <><Film className="h-3 w-3 mr-1" />Preview Ready</>
            ) : (
              <><Film className="h-3 w-3 mr-1" />Render Preview</>
            )}
          </Button>

          {inferenceStacks.length > 0 && (
            <>
              <div className="w-px h-4 bg-zinc-700" />
              {isStackRendering ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 border-red-700 text-red-400 text-[10px] px-2 hover:bg-red-900/30"
                  onClick={cancelStackRender}
                >
                  <X className="h-3 w-3 mr-1" />
                  Stop Render
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 border-violet-700 text-violet-400 text-[10px] px-2 hover:bg-violet-900/30"
                  onClick={renderAllStacks}
                >
                  <Layers className="h-3 w-3 mr-1" />
                  Render All Stacks ({inferenceStacks.length})
                </Button>
              )}
            </>
          )}

          {/* Subtitle import/export */}
          {tracks.some(t => t.type === 'subtitle') && (
            <>
              <div className="w-px h-4 bg-zinc-700" />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => subtitleFileInputRef.current?.click()}
                  className="h-6 px-2 rounded bg-amber-900/30 border border-amber-700/30 text-amber-400 hover:bg-amber-900/50 text-[10px] flex items-center gap-1 transition-colors"
                  title="Import SRT subtitles"
                >
                  <FileUp className="h-3 w-3" />
                  Import SRT
                </button>
                <button
                  onClick={handleExportSrt}
                  disabled={subtitles.length === 0}
                  className="h-6 px-2 rounded bg-amber-900/30 border border-amber-700/30 text-amber-400 hover:bg-amber-900/50 text-[10px] flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Export SRT subtitles"
                >
                  <FileDown className="h-3 w-3" />
                  Export SRT
                </button>
              </div>
              <input
                ref={subtitleFileInputRef}
                type="file"
                accept=".srt"
                onChange={handleImportSrt}
                className="hidden"
              />
            </>
          )}
          
          {/* Spacer */}
          <div className="flex-1" />
          
          {/* Zoom slider bar */}
          <div className="flex items-center gap-2">
            <Tooltip content="Zoom out (-)" side="top">
              <button
                onClick={() => { centerOnPlayheadRef.current = true; setZoom(Math.max(getMinZoom(), +(zoom - 0.25).toFixed(2))) }}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <input
              type="range"
              min={Math.max(1, Math.round(getMinZoom() * 100))}
              max={400}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(e) => { centerOnPlayheadRef.current = true; setZoom(Math.max(getMinZoom(), +(parseInt(e.target.value) / 100).toFixed(2))) }}
              onMouseUp={(e) => (e.target as HTMLInputElement).blur()}
              className="w-28 h-1 accent-blue-500 cursor-pointer"
              title={`Zoom: ${Math.round(zoom * 100)}%`}
            />
            <Tooltip content="Zoom in (+)" side="top">
              <button
                onClick={() => { centerOnPlayheadRef.current = true; setZoom(Math.min(4, +(zoom + 0.25).toFixed(2))) }}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <span className="text-[10px] text-zinc-500 tabular-nums w-8 text-right">{Math.round(zoom * 100)}%</span>
            <Tooltip content="Fit to view (Ctrl+0)" side="top">
              <button
                onClick={handleFitToView}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors ml-0.5"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      
      {/* Right Panel - Properties (user-controlled toggle) */}
      {showPropertiesPanel && (
        <>
        {/* Right resize handle with collapse button */}
        <div
          className="w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors relative group z-10"
          onMouseDown={(e) => handleResizeDragStart('right', e)}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
          <Tooltip content="Collapse Properties Panel" side="left">
            <button
              className="absolute top-1/2 -translate-y-1/2 -left-3 w-6 h-8 bg-zinc-800 border border-zinc-700 rounded-l-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors opacity-0 group-hover:opacity-100 z-20 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setShowPropertiesPanel(false) }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
        {/* Subtitle properties */}
        {selectedSubtitleId && selectedClipIds.size === 0 && (() => {
          const selectedSub = subtitles.find(s => s.id === selectedSubtitleId)
          if (!selectedSub) return null
          const trackStyle = tracks[selectedSub.trackIndex]?.subtitleStyle || {}
          return (
            <SubtitlePropertiesPanel
              selectedSub={selectedSub}
              trackStyle={trackStyle}
              rightPanelWidth={layout.rightPanelWidth}
              onResizeDragStart={(e) => handleResizeDragStart('right', e)}
              updateSubtitle={updateSubtitle}
              deleteSubtitle={deleteSubtitle}
            />
          )
        })()}
        {/* Clip properties */}
        {selectedClip ? (
          <ClipPropertiesPanel
            selectedClip={selectedClip}
            clips={clips}
            tracks={tracks}
            propertiesTab={propertiesTab}
            setPropertiesTab={setPropertiesTab}
            showFlip={showFlip}
            setShowFlip={setShowFlip}
            showTransitions={showTransitions}
            setShowTransitions={setShowTransitions}
            showAppliedEffects={showAppliedEffects}
            setShowAppliedEffects={setShowAppliedEffects}
            showColorCorrection={showColorCorrection}
            setShowColorCorrection={setShowColorCorrection}
            resolutionCache={resolutionCache}
            rightPanelWidth={layout.rightPanelWidth}
            updateClip={updateClip}
            removeEffectFromClip={removeEffectFromClip}
            updateEffectOnClip={updateEffectOnClip}
            handleDeleteTake={handleDeleteTake}
            setShowEffectsBrowser={setShowEffectsBrowser}
            setI2vClipId={setI2vClipId}
            setI2vPrompt={setI2vPrompt}
            i2vClipId={i2vClipId}
            isRegenerating={isRegenerating}
            getLiveAsset={getLiveAsset}
            getClipUrl={getClipUrl}
            getClipResolution={getClipResolution}
            getMaxClipDuration={getMaxClipDuration}
            handleRegenerate={(clipId) => { const c = clips.find(x => x.id === clipId); if (c?.assetId) handleRegenerate(c.assetId, clipId) }}
            handleCancelRegeneration={handleCancelRegeneration}
            setClips={setClips}
            pushUndo={pushUndo}
            handleClipTakeChange={handleClipTakeChange}
            setSubtitleTrackStyleIdx={setSubtitleTrackStyleIdx}
            subtitleTrackStyleIdx={subtitleTrackStyleIdx}
          />
        ) : !selectedSubtitleId ? (
          <div
            className="bg-zinc-950 border-l border-zinc-800 flex flex-col items-center justify-center text-zinc-600 text-[12px]"
            style={{ width: layout.rightPanelWidth }}
          >
            <span>No clip selected</span>
          </div>
        ) : null}
        </>
      )}
      
      {/* Export Modal */}
      {/* Asset right-click context menu */}
      {assetContextMenu && (() => {
        const asset = assets.find(a => a.id === assetContextMenu.assetId)
        if (!asset) return null
        const targetIds = selectedAssetIds.size > 0 && selectedAssetIds.has(asset.id) ? [...selectedAssetIds] : [asset.id]
        return (
          <AssetContextMenu
            asset={asset}
            targetIds={targetIds}
            assetContextMenu={assetContextMenu}
            assetContextMenuRef={assetContextMenuRef}
            assets={assets}
            bins={bins}
            isRegenerating={isRegenerating}
            regeneratingAssetId={regeneratingAssetId}
            currentProjectId={currentProjectId}
            pushAssetUndoRef={pushAssetUndoRef}
            addClipToTimeline={addClipToTimeline}
            handleRegenerate={(id) => handleRegenerate(id)}
            handleCancelRegeneration={handleCancelRegeneration}
            setAssetActiveTake={setAssetActiveTake}
            setTakesViewAssetId={setTakesViewAssetId}
            setSelectedAssetIds={setSelectedAssetIds}
            setAssetContextMenu={setAssetContextMenu}
            updateAsset={updateAsset}
            addAsset={addAsset}
            deleteAsset={deleteAsset}
            deleteTakeFromAsset={deleteTakeFromAsset}
            setClips={setClips}
          />
        )
      })()}
      
      {/* Take right-click context menu */}
      {takeContextMenu && (() => {
        const tcAsset = assets.find(a => a.id === takeContextMenu.assetId)
        if (!tcAsset?.takes) return null
        const take = tcAsset.takes[takeContextMenu.takeIndex]
        if (!take) return null
        return (
          <TakeContextMenu
            tcAsset={tcAsset}
            take={take}
            takeIndex={takeContextMenu.takeIndex}
            takeContextMenu={takeContextMenu}
            takeContextMenuRef={takeContextMenuRef}
            currentProjectId={currentProjectId}
            pushAssetUndoRef={pushAssetUndoRef}
            addClipToTimeline={addClipToTimeline}
            setAssetActiveTake={setAssetActiveTake}
            addAsset={addAsset}
            deleteTakeFromAsset={deleteTakeFromAsset}
            setClips={setClips}
            setTakeContextMenu={setTakeContextMenu}
          />
        )
      })()}
      
      {/* Bin right-click context menu */}
      {binContextMenu && (
        <div
          ref={binContextMenuRef}
          className="fixed bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl py-1.5 z-[60] min-w-[160px] text-xs"
          style={{ left: binContextMenu.x, top: binContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const newName = prompt('Rename bin:', binContextMenu.bin)
              if (newName?.trim() && currentProjectId && newName.trim() !== binContextMenu.bin) {
                pushAssetUndoRef.current()
                for (const asset of assets.filter(a => a.bin === binContextMenu.bin)) {
                  updateAsset(currentProjectId, asset.id, { bin: newName.trim() })
                }
                if (selectedBin === binContextMenu.bin) setSelectedBin(newName.trim())
              }
              setBinContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 flex items-center gap-3"
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-500" />
            <span>Rename Bin</span>
          </button>
          <button
            onClick={() => {
              if (currentProjectId) {
                pushAssetUndoRef.current()
                for (const asset of assets.filter(a => a.bin === binContextMenu.bin)) {
                  updateAsset(currentProjectId, asset.id, { bin: undefined })
                }
                if (selectedBin === binContextMenu.bin) setSelectedBin(null)
              }
              setBinContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-zinc-700 flex items-center gap-3"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Bin</span>
          </button>
        </div>
      )}
      
      {/* Clip right-click context menu */}
      {clipContextMenu && (() => {
        const contextClip = clips.find(c => c.id === clipContextMenu.clipId)
        return (
          <ClipContextMenu
            clipContextMenu={clipContextMenu}
            contextClip={contextClip || null}
            clipContextMenuRef={clipContextMenuRef}
            clips={clips}
            tracks={tracks}
            selectedClipIds={selectedClipIds}
            setSelectedClipIds={setSelectedClipIds}
            currentTime={currentTime}
            hasClipboard={clipboardRef.current.length > 0}
            isRegenerating={isRegenerating}
            i2vClipId={i2vClipId}
            assets={assets}
            assetGridRef={assetGridRef}
            currentProjectId={currentProjectId}
            updateAsset={updateAsset}
            handleCopy={handleCopy}
            handleCut={handleCut}
            handlePaste={handlePaste}
            setClipContextMenu={setClipContextMenu}
            addTextClip={addTextClip}
            pushUndo={pushUndo}
            setClips={setClips}
            handleRegenerate={handleRegenerate}
            handleCancelRegeneration={handleCancelRegeneration}
            handleClipTakeChange={handleClipTakeChange}
            handleDeleteTake={handleDeleteTake}
            duplicateClip={duplicateClip}
            splitClipAtPlayhead={splitClipAtPlayhead}
            removeClip={removeClip}
            updateClip={updateClip}
            getLiveAsset={getLiveAsset}
            getMaxClipDuration={getMaxClipDuration}
            setAssetFilter={setAssetFilter}
            setSelectedBin={setSelectedBin}
            setTakesViewAssetId={setTakesViewAssetId}
            setSelectedAssetIds={setSelectedAssetIds}
            setI2vClipId={setI2vClipId}
            setI2vPrompt={setI2vPrompt}
            onRetakeClip={handleRetakeClip}
            setIcLoraSourceClipId={_setIcLoraSourceClipId}
            setShowICLoraPanel={_setShowICLoraPanel}
            onCaptureFrameForVideo={handleCaptureFrameForVideo}
            onCreateVideoFromAudio={handleCreateVideoFromAudio}
            onCreateStack={createStack}
            onRemoveFromStack={removeClipFromStack}
            onEditStack={setActiveStackId}
            onRevertStack={revertStack}
            onRelinkStackOutput={relinkStackOutput}
            inferenceStacks={inferenceStacks}
            projectName={currentProject?.name}
          />
        )
      })()}
      
      
      
      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        clips={clips}
        tracks={tracks}
        timeline={activeTimeline}
        projectName={currentProject?.name || 'Untitled'}
        inPoint={inPoint}
        outPoint={outPoint}
        resolveClipSrc={resolveClipSrc}
      />
      
      <ImportTimelineModal
        isOpen={showImportTimelineModal}
        onClose={() => setShowImportTimelineModal(false)}
        onImport={handleImportTimeline}
      />
      
      {/* Project Settings Modal */}
      {showProjectSettings && currentProject && (() => {
        const projectAssetPath = currentProject.assetSavePath || ''
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowProjectSettings(false)}>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
                <h2 className="text-lg font-bold text-white">Project Settings</h2>
                <button onClick={() => setShowProjectSettings(false)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Project Name</label>
                  <p className="text-sm text-white">{currentProject.name}</p>
                </div>
                {/* Timeline Resolution & FPS */}
                {activeTimeline && (() => {
                  const res = activeTimeline.resolution ?? { width: 1920, height: 1080 }
                  const fps = activeTimeline.fps ?? 24
                  const PRESETS = [
                    { label: '4K (3840x2160)', w: 3840, h: 2160 },
                    { label: '1080p (1920x1080)', w: 1920, h: 1080 },
                    { label: '720p (1280x720)', w: 1280, h: 720 },
                    { label: '540p (960x540)', w: 960, h: 540 },
                    { label: '9:16 1080p (1080x1920)', w: 1080, h: 1920 },
                    { label: '1:1 (1080x1080)', w: 1080, h: 1080 },
                    { label: '4:3 (1440x1080)', w: 1440, h: 1080 },
                  ]
                  const matchedPreset = PRESETS.find(p => p.w === res.width && p.h === res.height)
                  return (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Timeline Resolution</label>
                        <select
                          value={matchedPreset ? `${matchedPreset.w}x${matchedPreset.h}` : 'custom'}
                          onChange={e => {
                            if (e.target.value === 'custom') return
                            const [w, h] = e.target.value.split('x').map(Number)
                            if (currentProjectId && activeTimeline) {
                              updateTimeline(currentProjectId, activeTimeline.id, { resolution: { width: w, height: h } })
                            }
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm focus:outline-none focus:border-blue-500"
                        >
                          {PRESETS.map(p => (
                            <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>{p.label}</option>
                          ))}
                          {!matchedPreset && <option value="custom">Custom ({res.width}x{res.height})</option>}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Frame Rate</label>
                        <select
                          value={fps}
                          onChange={e => {
                            if (currentProjectId && activeTimeline) {
                              updateTimeline(currentProjectId, activeTimeline.id, { fps: Number(e.target.value) })
                            }
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm focus:outline-none focus:border-blue-500"
                        >
                          {[24, 25, 30, 50, 60].map(f => (
                            <option key={f} value={f}>{f} fps</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })()}
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">Asset Save Folder</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      defaultValue={projectAssetPath}
                      placeholder="Not set — uses default backend location"
                      className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 truncate"
                      onBlur={e => {
                        if (currentProjectId && e.target.value !== projectAssetPath) {
                          updateProject(currentProjectId, { assetSavePath: e.target.value.trim() || undefined })
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim()
                          if (currentProjectId) updateProject(currentProjectId, { assetSavePath: val || undefined })
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      className="border-zinc-700 flex-shrink-0"
                      onClick={async () => {
                        const dir = await window.electronAPI?.showOpenDirectoryDialog({ title: 'Select Asset Folder' })
                        if (dir && currentProjectId) {
                          updateProject(currentProjectId, { assetSavePath: dir })
                        }
                      }}
                    >
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1">Where generated video and image assets will be saved for this project</p>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      
      {/* IC-LORA HIDDEN - IC-LoRA panel hidden because IC-LoRA is broken on server
      {(() => {
        const sourceClip = icLoraSourceClipId ? clips.find(c => c.id === icLoraSourceClipId) : null
        const sourceAsset = sourceClip?.assetId ? assets.find(a => a.id === sourceClip.assetId) : null
        const activeUrl = sourceAsset?.takes?.[sourceAsset.activeTakeIndex ?? sourceAsset.takes.length - 1]?.url || sourceAsset?.url
        const activePath = sourceAsset?.takes?.[sourceAsset.activeTakeIndex ?? sourceAsset.takes.length - 1]?.path || sourceAsset?.path
        return (
          <ICLoraPanel
            isOpen={showICLoraPanel}
            onClose={() => { setShowICLoraPanel(false); setIcLoraSourceClipId(null) }}
            initialVideoUrl={activeUrl}
            initialVideoPath={activePath}
            initialClipName={sourceAsset?.prompt || sourceClip?.importedName || undefined}
            sourceClipId={icLoraSourceClipId}
            onResult={handleICLoraResult}
          />
        )
      })()}
      */}
      
      {selectedGap && tracks[selectedGap.trackIndex]?.kind !== 'audio' && (
        <GapGenerationModal
          selectedGap={selectedGap}
          anchorPosition={selectedGapAnchor}
          gapGenerateMode={gapGenerateMode}
          setGapGenerateMode={setGapGenerateMode}
          gapPrompt={gapPrompt}
          setGapPrompt={setGapPrompt}
          gapSuggesting={gapSuggesting}
          gapSuggestion={gapSuggestion}
          gapBeforeFrame={gapBeforeFrame}
          gapAfterFrame={gapAfterFrame}
          gapSettings={gapSettings}
          setGapSettings={setGapSettings}
          gapImageFile={gapImageFile}
          setGapImageFile={setGapImageFile}
          gapImageInputRef={gapImageInputRef}
          isRegenerating={isRegenerating}
          regenStatusMessage={regenStatusMessage}
          regenProgress={regenProgress}
          regenReset={regenReset}
          handleGapGenerate={handleGapGenerate}
          deleteGap={deleteGap}
          setSelectedGap={setSelectedGap}
          gapApplyAudioToTrack={gapApplyAudioToTrack}
          setGapApplyAudioToTrack={setGapApplyAudioToTrack}
          regenerateSuggestion={regenerateSuggestion}
          gapSuggestionError={gapSuggestionError}
          gapSuggestionNoApiKey={gapSuggestionNoApiKey}
        />
      )}

      <I2vGenerationModal
        i2vClipId={i2vClipId}
        setI2vClipId={setI2vClipId}
        clips={clips}
        resolveClipSrc={resolveClipSrc}
        i2vPrompt={i2vPrompt}
        setI2vPrompt={setI2vPrompt}
        i2vSettings={i2vSettings}
        setI2vSettings={setI2vSettings}
        isRegenerating={isRegenerating}
        regenStatusMessage={regenStatusMessage}
        regenProgress={regenProgress}
        regenReset={regenReset}
        handleI2vGenerate={handleI2vGenerate}
      />

      {activeStackId && (() => {
        const stack = inferenceStacks.find(s => s.id === activeStackId)
        if (!stack) return null
        return (
          <InferenceStackPanel
            stack={stack}
            clips={clips}
            resolveClipSrc={resolveClipSrc}
            isRendering={isStackRendering && renderingStackId === activeStackId}
            renderStatusMessage={stackRenderStatusMessage}
            renderProgress={stackRenderProgress}
            onUpdateStack={updateStack}
            onRenderStack={renderStack}
            onDeleteStack={deleteStack}
            onBreakStack={breakStack}
            onRevertStack={revertStack}
            onRelinkOutput={relinkStackOutput}
            projectName={currentProject?.name}
            onCancelRender={cancelStackRender}
            onClose={() => setActiveStackId(null)}
          />
        )
      })()}

      {subtitleTrackStyleIdx !== null && (
        <SubtitleTrackStyleEditor
          subtitleTrackStyleIdx={subtitleTrackStyleIdx}
          setSubtitleTrackStyleIdx={setSubtitleTrackStyleIdx}
          tracks={tracks}
          setTracks={setTracks}
          setSubtitles={setSubtitles}
        />
      )}

      {(regenError || regenerationPreError) && (
        <GenerationErrorDialog
          error={(regenError || regenerationPreError)!}
          onDismiss={() => {
            if (regenError) regenReset()
            if (regenerationPreError) dismissRegenerationPreError()
          }}
        />
      )}
    </div>
    </div>
  )
}
