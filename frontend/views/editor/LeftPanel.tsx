import React, { useState, useMemo } from 'react'
import {
  FolderPlus, Folder, Upload, ChevronLeft, ChevronDown, ChevronRight, ChevronUp,
  X, RefreshCw, Loader2, Trash2, Music, Layers, Video, Image,
  Plus, FileUp, Film, LayoutGrid, List, ArrowUpDown,
} from 'lucide-react'
import type { Asset, TimelineClip, Timeline } from '../../types/project'
import { VideoThumbnailCard } from './VideoThumbnailCard'
import { AssetThumbnail } from '../../components/AssetThumbnail'
import { getColorLabel, COLOR_LABELS } from './video-editor-utils'
import { Tooltip } from '../../components/ui/tooltip'

export interface LeftPanelProps {
  leftPanelWidth: number
  assetsHeight: number
  takesViewAssetId: string | null
  setTakesViewAssetId: (id: string | null) => void
  creatingBin: boolean
  setCreatingBin: (v: boolean) => void
  newBinName: string
  setNewBinName: (v: string) => void
  newBinInputRef: React.RefObject<HTMLInputElement | null>
  selectedBin: string | null
  setSelectedBin: (v: string | null) => void
  bins: string[]
  filteredAssets: Asset[]
  assetFilter: 'all' | 'video' | 'image' | 'audio'
  setAssetFilter: (v: 'all' | 'video' | 'image' | 'audio') => void
  selectedAssetIds: Set<string>
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>
  assetLasso: { startX: number; startY: number; currentX: number; currentY: number } | null
  setAssetLasso: React.Dispatch<React.SetStateAction<{ startX: number; startY: number; currentX: number; currentY: number } | null>>
  assetGridRef: React.RefObject<HTMLDivElement | null>
  setAssetContextMenu: React.Dispatch<React.SetStateAction<{ assetId: string; x: number; y: number } | null>>
  setBinContextMenu: React.Dispatch<React.SetStateAction<{ bin: string; x: number; y: number } | null>>
  setTakeContextMenu: React.Dispatch<React.SetStateAction<{ assetId: string; takeIndex: number; x: number; y: number } | null>>
  assets: Asset[]
  thumbnailMap: Record<string, string>
  currentProjectId: string | null
  pushAssetUndoRef: React.MutableRefObject<() => void>
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  loadSourceAsset: (asset: Asset) => void
  handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDropFiles: (e: React.DragEvent) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  setAssetActiveTake: (projectId: string, assetId: string, takeIndex: number) => void
  addClipToTimeline: (asset: Asset, trackIndex?: number, startTime?: number) => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  deleteTakeFromAsset: (projectId: string, assetId: string, takeIndex: number) => void
  deleteAsset: (projectId: string, assetId: string) => void
  handleRegenerate: (assetId: string, clipId?: string) => void
  handleCancelRegeneration: () => void
  isRegenerating: boolean
  regeneratingAssetId: string | null
  regenProgress: number
  regenStatusMessage: string
  handleResizeDragStart: (type: 'left' | 'right' | 'timeline' | 'assets', e: React.MouseEvent) => void
  timelineAddMenuOpen: boolean
  setTimelineAddMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleAddTimeline: () => void
  setShowImportTimelineModal: (v: boolean) => void
  timelines: Timeline[]
  activeTimeline: Timeline | null
  handleSwitchTimeline: (id: string) => void
  handleDeleteTimeline: (id: string) => void
  handleTimelineTabContextMenu: (e: React.MouseEvent, timelineId: string) => void
  openTimelineIds: Set<string>
  renamingTimelineId: string | null
  renameValue: string
  renameSource: 'tab' | 'panel'
  setRenameValue: (v: string) => void
  handleStartRename: (timelineId: string, currentName: string, source?: 'tab' | 'panel') => void
  handleFinishRename: () => void
  setRenamingTimelineId: (v: string | null) => void
  onAssetDragStart?: (assets: Asset[]) => void
  onAssetDragEnd?: () => void
}

export function LeftPanel(props: LeftPanelProps) {
  const {
    leftPanelWidth,
    assetsHeight,
    takesViewAssetId,
    setTakesViewAssetId,
    creatingBin,
    setCreatingBin,
    newBinName,
    setNewBinName,
    newBinInputRef,
    selectedBin,
    setSelectedBin,
    bins,
    filteredAssets,
    assetFilter,
    setAssetFilter,
    selectedAssetIds,
    setSelectedAssetIds,
    assetLasso,
    setAssetLasso,
    assetGridRef,
    setAssetContextMenu,
    setBinContextMenu,
    setTakeContextMenu,
    assets,
    thumbnailMap,
    currentProjectId,
    pushAssetUndoRef,
    updateAsset,
    loadSourceAsset,
    handleImportFile,
    handleDropFiles,
    fileInputRef,
    setAssetActiveTake,
    setClips,
    deleteTakeFromAsset,
    deleteAsset,
    handleRegenerate,
    handleCancelRegeneration,
    isRegenerating,
    regeneratingAssetId,
    regenProgress,
    regenStatusMessage,
    handleResizeDragStart,
    timelineAddMenuOpen,
    setTimelineAddMenuOpen,
    handleAddTimeline,
    setShowImportTimelineModal,
    timelines,
    activeTimeline,
    handleSwitchTimeline,
    handleDeleteTimeline,
    handleTimelineTabContextMenu,
    openTimelineIds,
    renamingTimelineId,
    renameValue,
    renameSource,
    setRenameValue,
    handleStartRename,
    handleFinishRename,
    setRenamingTimelineId,
    onAssetDragStart,
    onAssetDragEnd,
  } = props

  const [assetViewMode, setAssetViewMode] = useState<'grid' | 'list'>('grid')
  const [listSortCol, setListSortCol] = useState<'name' | 'type' | 'duration' | 'resolution' | 'date' | 'color'>('name')
  const [listSortDir, setListSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleSort = (col: typeof listSortCol) => {
    if (listSortCol === col) {
      setListSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setListSortCol(col)
      setListSortDir('asc')
    }
  }

  const sortedAssets = useMemo(() => {
    if (assetViewMode !== 'list') return filteredAssets
    const sorted = [...filteredAssets]
    const dir = listSortDir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
      switch (listSortCol) {
        case 'name': {
          const nameA = (a.path?.split(/[/\\]/).pop() || a.type || '').toLowerCase()
          const nameB = (b.path?.split(/[/\\]/).pop() || b.type || '').toLowerCase()
          return dir * nameA.localeCompare(nameB)
        }
        case 'type':
          return dir * a.type.localeCompare(b.type)
        case 'duration':
          return dir * ((a.duration ?? 0) - (b.duration ?? 0))
        case 'resolution': {
          const parseHeight = (r?: string) => { const m = r?.match(/(\d+)/); return m ? parseInt(m[1]) : 0 }
          return dir * (parseHeight(a.resolution) - parseHeight(b.resolution))
        }
        case 'date':
          return dir * (a.createdAt - b.createdAt)
        case 'color': {
          const colorOrder = COLOR_LABELS.map(c => c.id)
          const idxA = a.colorLabel ? colorOrder.indexOf(a.colorLabel) : colorOrder.length
          const idxB = b.colorLabel ? colorOrder.indexOf(b.colorLabel) : colorOrder.length
          return dir * (idxA - idxB)
        }
        default:
          return 0
      }
    })
    return sorted
  }, [filteredAssets, listSortCol, listSortDir, assetViewMode])

  return (
    <div className="flex-shrink-0 border-r border-zinc-800 flex flex-col" style={{ width: leftPanelWidth }}>
      {/* Assets Section */}
      <div className="flex flex-col min-h-0" style={assetsHeight > 0 ? { height: assetsHeight } : { flex: '1 1 60%' }}>
        <div className="p-4 pb-2 space-y-2 flex-shrink-0">
          {!takesViewAssetId ? (<>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Assets</h3>
            <div className="flex items-center gap-1">
              <Tooltip content="Create bin" side="right">
                <button
                  onClick={() => setCreatingBin(true)}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
              </Tooltip>
              <Tooltip content="Import media" side="right">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                >
                  <Upload className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          </div>
          
          {/* Type filter + view toggle */}
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1 bg-zinc-900 rounded-lg p-0.5 flex-1">
              {(['all', 'video', 'image', 'audio'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setAssetFilter(filter)}
                  className={`flex-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    assetFilter === filter 
                      ? 'bg-zinc-800 text-white' 
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex bg-zinc-900 rounded-lg p-0.5">
              <Tooltip content="Grid view" side="right">
                <button
                  onClick={() => setAssetViewMode('grid')}
                  className={`p-1 rounded transition-colors ${assetViewMode === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <LayoutGrid className="h-3 w-3" />
                </button>
              </Tooltip>
              <Tooltip content="List view" side="right">
                <button
                  onClick={() => setAssetViewMode('list')}
                  className={`p-1 rounded transition-colors ${assetViewMode === 'list' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <List className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
          </div>
          
          {/* Bins row */}
          {(bins.length > 0 || creatingBin) && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedBin(null)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                  selectedBin === null
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                    : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                All
              </button>
              {bins.map(bin => (
                <button
                  key={bin}
                  onClick={() => setSelectedBin(selectedBin === bin ? null : bin)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setBinContextMenu({ bin, x: e.clientX, y: e.clientY })
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.currentTarget.classList.add('ring-2', 'ring-blue-400')
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('ring-2', 'ring-blue-400')
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.currentTarget.classList.remove('ring-2', 'ring-blue-400')
                    if (!currentProjectId) return
                    pushAssetUndoRef.current()
                    // Handle multi-asset drag
                    const assetIdsJson = e.dataTransfer.getData('assetIds')
                    if (assetIdsJson) {
                      try {
                        const ids: string[] = JSON.parse(assetIdsJson)
                        ids.forEach(id => updateAsset(currentProjectId, id, { bin }))
                        setSelectedAssetIds(new Set())
                      } catch { /* ignore parse errors */ }
                    } else {
                      const assetId = e.dataTransfer.getData('assetId')
                      if (assetId) updateAsset(currentProjectId, assetId, { bin })
                    }
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 group/bin ${
                    selectedBin === bin
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent'
                  }`}
                >
                  <Folder className="h-3 w-3" />
                  {bin}
                  <span className="text-zinc-600 text-[9px]">
                    {assets.filter(a => a.bin === bin).length}
                  </span>
                </button>
              ))}
              {creatingBin && (
                <div className="flex items-center gap-1">
                  <input
                    ref={newBinInputRef as React.RefObject<HTMLInputElement>}
                    type="text"
                    value={newBinName}
                    onChange={(e) => setNewBinName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newBinName.trim()) {
                        if (selectedAssetIds.size > 0 && currentProjectId) {
                          pushAssetUndoRef.current()
                          const binName = newBinName.trim()
                          selectedAssetIds.forEach(id => updateAsset(currentProjectId, id, { bin: binName }))
                          setSelectedAssetIds(new Set())
                        }
                        setCreatingBin(false)
                        setNewBinName('')
                      }
                      if (e.key === 'Escape') {
                        setCreatingBin(false)
                        setNewBinName('')
                      }
                    }}
                    onBlur={() => {
                      if (newBinName.trim() && selectedAssetIds.size > 0 && currentProjectId) {
                        pushAssetUndoRef.current()
                        const binName = newBinName.trim()
                        selectedAssetIds.forEach(id => updateAsset(currentProjectId, id, { bin: binName }))
                        setSelectedAssetIds(new Set())
                      }
                      setCreatingBin(false)
                      setNewBinName('')
                    }}
                    placeholder="Bin name..."
                    className="w-20 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-600 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>
          )}
          
          <input
            ref={fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            onChange={handleImportFile}
            className="hidden"
          />
          </>) : (
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Takes</h3>
            </div>
          )}
        </div>
        
        {/* Takes drill-in view */}
        {takesViewAssetId && (() => {
          const takesAsset = assets.find(a => a.id === takesViewAssetId)
          if (!takesAsset || !takesAsset.takes || takesAsset.takes.length <= 1) {
            // Asset no longer has takes, exit view
            setTakesViewAssetId(null)
            return null
          }
          return (
            <div className="flex-1 overflow-auto p-3 pt-0">
              {/* Header with back button */}
              <div className="flex items-center gap-2 mb-3">
                <Tooltip content="Back to assets" side="right">
                  <button
                    onClick={() => setTakesViewAssetId(null)}
                    className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </Tooltip>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">
                    {takesAsset.prompt?.slice(0, 40) || 'Asset'}{(takesAsset.prompt?.length ?? 0) > 40 ? '...' : ''}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {takesAsset.takes.length} takes
                  </p>
                </div>
                {/* Regenerate to create another take / Cancel */}
                {takesAsset.generationParams && (
                  isRegenerating && regeneratingAssetId === takesAsset.id ? (
                    <button
                      onClick={() => handleCancelRegeneration()}
                      className="px-2 py-1 rounded-lg bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors text-[10px] font-medium flex items-center gap-1 border border-red-500/30"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRegenerate(takesAsset.id)}
                      disabled={isRegenerating}
                      className="px-2 py-1 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 transition-colors text-[10px] font-medium flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      New Take
                    </button>
                  )
                )}
              </div>
              
              {/* Takes grid */}
              <div className="grid grid-cols-2 gap-2">
                {takesAsset.takes.map((take, idx) => {
                  const isActive = (takesAsset.activeTakeIndex ?? 0) === idx
                  return (
                    <div
                      key={idx}
                      className={`relative group rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                        isActive
                          ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/20'
                          : 'border-zinc-800 hover:border-zinc-600'
                      }`}
                      onClick={() => {
                        if (currentProjectId) {
                          pushAssetUndoRef.current()
                          setAssetActiveTake(currentProjectId, takesAsset.id, idx)
                        }
                      }}
                      onDoubleClick={() => {
                        if (currentProjectId) {
                          pushAssetUndoRef.current()
                          setAssetActiveTake(currentProjectId, takesAsset.id, idx)
                        }
                        loadSourceAsset({ ...takesAsset, url: take.url, path: take.path, thumbnail: take.thumbnail || takesAsset.thumbnail })
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setTakeContextMenu({ assetId: takesAsset.id, takeIndex: idx, x: e.clientX, y: e.clientY })
                      }}
                    >
                      {takesAsset.type === 'video' ? (
                        <VideoThumbnailCard
                          url={take.url}
                          thumbnailUrl={thumbnailMap[take.url]}
                        />
                      ) : (
                        <AssetThumbnail src={take.url} type="image" className="w-full aspect-video object-cover" />
                      )}
                      
                      {/* Active overlay */}
                      {isActive && (
                        <div className="absolute inset-0 bg-blue-600/15 pointer-events-none" />
                      )}
                      
                      {/* Take label */}
                      <div className="absolute bottom-1 left-1 flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isActive
                            ? 'bg-blue-500 text-white'
                            : 'bg-black/70 text-zinc-300'
                        }`}>
                          Take {idx + 1}
                        </span>
                      </div>
                      
                      {/* Active badge */}
                      {isActive && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-blue-500 text-white text-[9px] font-semibold">
                          Active
                        </div>
                      )}
                      
                      {/* Timestamp */}
                      <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/70 text-[9px] text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date(take.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      
                      {/* Delete take button (visible on hover, only if more than 1 take) */}
                      {takesAsset.takes!.length > 1 && (
                        <Tooltip content="Delete take" side="right">
                          <button
                            className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-zinc-400 hover:text-red-400 hover:bg-red-900/60 opacity-0 group-hover:opacity-100 transition-all z-10"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`Delete take ${idx + 1}?`)) {
                                if (currentProjectId) {
                                  pushAssetUndoRef.current()
                                  // Update any clips referencing this asset
                                  setClips(prev => prev.map(c => {
                                    if (c.assetId !== takesAsset.id) return c
                                    const cIdx = c.takeIndex ?? (takesAsset.activeTakeIndex ?? takesAsset.takes!.length - 1)
                                    if (cIdx === idx) {
                                      return { ...c, takeIndex: Math.max(0, idx - 1) }
                                    } else if (cIdx > idx) {
                                      return { ...c, takeIndex: cIdx - 1 }
                                    }
                                    return c
                                  }))
                                  deleteTakeFromAsset(currentProjectId, takesAsset.id, idx)
                                }
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      )}
                      
                      {/* Regenerating overlay */}
                      {isRegenerating && regeneratingAssetId === takesAsset.id && idx === takesAsset.takes!.length - 1 && (
                        <div className="absolute inset-0 bg-blue-900/40 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                          <Loader2 className="h-5 w-5 text-blue-300 animate-spin mb-1" />
                          <span className="text-[9px] text-blue-200 font-medium">{regenProgress}%</span>
                          <span className="text-[8px] text-blue-300/70 mb-1.5">{regenStatusMessage}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancelRegeneration() }}
                            className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-600/60 text-[9px] text-zinc-300 hover:text-red-400 hover:border-red-500/50 hover:bg-red-900/30 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
        
        {/* Normal asset grid (hidden when in takes view) */}
        {!takesViewAssetId && <div
          className="flex-1 overflow-auto p-3 pt-0 relative select-none"
          ref={assetGridRef as React.RefObject<HTMLDivElement>}
          onDragOver={(e) => {
            // Allow external file drops and internal asset reordering
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={handleDropFiles}
          onMouseDown={(e) => {
            // Only start lasso if clicking on the background (not on an asset card)
            if ((e.target as HTMLElement).closest('[data-asset-card]')) return
            if (e.button !== 0) return
            const rect = assetGridRef.current?.getBoundingClientRect()
            if (!rect) return
            const scrollTop = assetGridRef.current?.scrollTop || 0
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top + scrollTop
            setAssetLasso({ startX: x, startY: y, currentX: x, currentY: y })
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
              setSelectedAssetIds(new Set())
            }
          }}
          onMouseMove={(e) => {
            if (!assetLasso || !assetGridRef.current) return
            const rect = assetGridRef.current.getBoundingClientRect()
            const scrollTop = assetGridRef.current.scrollTop || 0
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top + scrollTop
            setAssetLasso(prev => prev ? { ...prev, currentX: x, currentY: y } : null)
            
            // Determine which asset cards intersect with the lasso rect
            const lassoLeft = Math.min(assetLasso.startX, x)
            const lassoRight = Math.max(assetLasso.startX, x)
            const lassoTop = Math.min(assetLasso.startY, y)
            const lassoBottom = Math.max(assetLasso.startY, y)
            
            const newSelected = new Set<string>(e.ctrlKey || e.metaKey || e.shiftKey ? selectedAssetIds : [])
            const cards = assetGridRef.current.querySelectorAll('[data-asset-card]')
            cards.forEach(card => {
              const cardRect = card.getBoundingClientRect()
              const cardLeft = cardRect.left - rect.left
              const cardRight = cardRect.right - rect.left
              const cardTop = cardRect.top - rect.top + scrollTop
              const cardBottom = cardRect.bottom - rect.top + scrollTop
              
              // Check intersection
              if (cardLeft < lassoRight && cardRight > lassoLeft && cardTop < lassoBottom && cardBottom > lassoTop) {
                const id = (card as HTMLElement).dataset.assetId
                if (id) newSelected.add(id)
              }
            })
            setSelectedAssetIds(newSelected)
          }}
          onMouseUp={() => {
            setAssetLasso(null)
          }}
          onMouseLeave={() => {
            setAssetLasso(null)
          }}
        >
          {/* Lasso rectangle overlay */}
          {assetLasso && (() => {
            const left = Math.min(assetLasso.startX, assetLasso.currentX)
            const top = Math.min(assetLasso.startY, assetLasso.currentY)
            const width = Math.abs(assetLasso.currentX - assetLasso.startX)
            const height = Math.abs(assetLasso.currentY - assetLasso.startY)
            if (width < 3 && height < 3) return null
            return (
              <div
                className="absolute border border-blue-400 bg-blue-500/15 rounded-sm pointer-events-none z-30"
                style={{ left, top, width, height }}
              />
            )
          })()}
          
          {/* Selection count indicator (minimal) */}
          {filteredAssets.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-zinc-500">No assets yet</p>
              <p className="text-xs text-zinc-600 mt-1">Generate in Gen Space or import</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors"
              >
                Import Media
              </button>
            </div>
          ) : assetViewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-2">
              {filteredAssets.map(asset => {
                const cl = getColorLabel(asset.colorLabel)
                return (
                <div
                  key={asset.id}
                  data-asset-card
                  data-asset-id={asset.id}
                  className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                    selectedAssetIds.has(asset.id)
                      ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/20'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                  draggable
                  onDragStart={(e) => {
                    let draggedAssets: Asset[]
                    if (selectedAssetIds.size > 0 && selectedAssetIds.has(asset.id)) {
                      e.dataTransfer.setData('assetIds', JSON.stringify([...selectedAssetIds]))
                      draggedAssets = [...selectedAssetIds].map(id => assets.find(a => a.id === id)).filter(Boolean) as Asset[]
                    } else {
                      e.dataTransfer.setData('assetId', asset.id)
                      draggedAssets = [asset]
                    }
                    e.dataTransfer.setData('asset', JSON.stringify(asset))
                    e.dataTransfer.effectAllowed = 'copy'
                    // Hide default browser drag ghost
                    const blank = document.createElement('canvas')
                    blank.width = 1; blank.height = 1
                    e.dataTransfer.setDragImage(blank, 0, 0)
                    onAssetDragStart?.(draggedAssets)
                  }}
                  onDragEnd={() => onAssetDragEnd?.()}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (e.ctrlKey || e.metaKey) {
                      setSelectedAssetIds(prev => {
                        const next = new Set(prev)
                        if (next.has(asset.id)) next.delete(asset.id)
                        else next.add(asset.id)
                        return next
                      })
                    } else if (e.shiftKey && selectedAssetIds.size > 0) {
                      const lastId = [...selectedAssetIds].pop()
                      const lastIdx = filteredAssets.findIndex(a => a.id === lastId)
                      const thisIdx = filteredAssets.findIndex(a => a.id === asset.id)
                      if (lastIdx >= 0 && thisIdx >= 0) {
                        const start = Math.min(lastIdx, thisIdx)
                        const end = Math.max(lastIdx, thisIdx)
                        const next = new Set(selectedAssetIds)
                        for (let i = start; i <= end; i++) next.add(filteredAssets[i].id)
                        setSelectedAssetIds(next)
                      }
                    } else {
                      if (selectedAssetIds.has(asset.id) && selectedAssetIds.size === 1) {
                        setSelectedAssetIds(new Set())
                      } else {
                        setSelectedAssetIds(new Set([asset.id]))
                      }
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    loadSourceAsset(asset)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!selectedAssetIds.has(asset.id)) {
                      setSelectedAssetIds(new Set([asset.id]))
                    }
                    setAssetContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  {/* Color label strip */}
                  {cl && (
                    <>
                      <div className="absolute top-0 left-0 right-0 h-[3px] z-10" style={{ backgroundColor: cl.color }} />
                      <div className="absolute top-0 left-0 bottom-0 w-[3px] z-10" style={{ backgroundColor: cl.color }} />
                    </>
                  )}
                  {asset.type === 'video' ? (
                    <VideoThumbnailCard
                      url={asset.url}
                      thumbnailUrl={thumbnailMap[asset.url]}
                    />
                  ) : asset.type === 'audio' ? (
                    <div className="w-full aspect-video bg-gradient-to-br from-emerald-900/60 to-zinc-900 flex flex-col items-center justify-center gap-1.5">
                      <Music className="h-6 w-6 text-emerald-400" />
                      <div className="flex items-center gap-0.5">
                        {[3, 5, 8, 6, 9, 4, 7, 5, 3, 6, 8, 4].map((h, i) => (
                          <div
                            key={i}
                            className="w-0.5 rounded-full bg-emerald-500/60"
                            style={{ height: `${h * 1.5}px` }}
                          />
                        ))}
                      </div>
                      <p className="text-[9px] text-emerald-300/70 truncate max-w-[90%] px-1">
                        {asset.path || 'Audio'}
                      </p>
                    </div>
                  ) : asset.type === 'adjustment' ? (
                    <div className="w-full aspect-video bg-gradient-to-br from-blue-900/40 to-zinc-900 flex flex-col items-center justify-center gap-1.5 border border-dashed border-blue-500/30">
                      <Layers className="h-6 w-6 text-blue-400" />
                      <p className="text-[9px] text-blue-300/70 font-medium">Adjustment Layer</p>
                    </div>
                  ) : (
                    <AssetThumbnail src={asset.url} type="image" className="w-full aspect-video object-cover" />
                  )}
                  {selectedAssetIds.has(asset.id) && (
                    <div className="absolute inset-0 bg-blue-600/25 pointer-events-none z-[1]" />
                  )}
                  {!selectedAssetIds.has(asset.id) && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none" />
                  )}
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all z-10">
                    {asset.generationParams && (
                      <Tooltip content="Regenerate" side="right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRegenerate(asset.id)
                          }}
                          disabled={isRegenerating}
                          className={`p-1 rounded bg-black/70 transition-colors ${
                            isRegenerating && regeneratingAssetId === asset.id
                              ? 'text-blue-400 animate-spin'
                              : 'text-zinc-400 hover:text-blue-400 hover:bg-blue-900/50'
                          }`}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content="Delete asset" side="right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (currentProjectId) { pushAssetUndoRef.current(); deleteAsset(currentProjectId, asset.id) }
                        }}
                        className="p-1 rounded bg-black/70 text-zinc-500 hover:text-red-400 hover:bg-red-900/50 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Tooltip>
                  </div>
                  {isRegenerating && regeneratingAssetId === asset.id && (
                    <div className="absolute inset-0 bg-blue-900/40 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                      <Loader2 className="h-5 w-5 text-blue-300 animate-spin mb-1" />
                      <span className="text-[9px] text-blue-200 font-medium">{regenProgress}%</span>
                      <span className="text-[8px] text-blue-300/70 mb-1.5">{regenStatusMessage}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCancelRegeneration() }}
                        className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-600/60 text-[9px] text-zinc-300 hover:text-red-400 hover:border-red-500/50 hover:bg-red-900/30 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {asset.takes && asset.takes.length > 1 && (
                    <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/80 z-10">
                      <Tooltip content="Previous take" side="right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (currentProjectId) {
                              pushAssetUndoRef.current()
                              const idx = Math.max(0, (asset.activeTakeIndex ?? 0) - 1)
                              setAssetActiveTake(currentProjectId, asset.id, idx)
                            }
                          }}
                          disabled={(asset.activeTakeIndex ?? 0) === 0}
                          className="p-0.5 text-blue-300 hover:text-white disabled:text-zinc-600 transition-colors"
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                      </Tooltip>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setTakesViewAssetId(asset.id)
                          setSelectedAssetIds(new Set())
                        }}
                        className="px-0.5 cursor-pointer hover:text-white transition-colors flex items-center gap-1"
                        title="View all takes"
                      >
                        <Layers className="h-2.5 w-2.5 text-blue-400" />
                        <span className="text-[9px] text-blue-300 font-medium">
                          {(asset.activeTakeIndex ?? 0) + 1}/{asset.takes.length}
                        </span>
                      </button>
                      <Tooltip content="Next take" side="right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (currentProjectId && asset.takes) {
                              pushAssetUndoRef.current()
                              const idx = Math.min(asset.takes.length - 1, (asset.activeTakeIndex ?? 0) + 1)
                              setAssetActiveTake(currentProjectId, asset.id, idx)
                            }
                          }}
                          disabled={asset.takes && (asset.activeTakeIndex ?? 0) >= asset.takes.length - 1}
                          className="p-0.5 text-blue-300 hover:text-white disabled:text-zinc-600 transition-colors"
                        >
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                  {asset.bin && (
                    <div className="absolute top-1.5 left-8 flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/70 text-[9px] text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <Folder className="h-2.5 w-2.5" />
                      {asset.bin}
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white">
                    {asset.type === 'video' ? <Video className="h-3 w-3" /> : asset.type === 'audio' ? <Music className="h-3 w-3" /> : asset.type === 'adjustment' ? <Layers className="h-3 w-3" /> : <Image className="h-3 w-3" />}
                    {asset.type === 'adjustment' ? 'Adj' : asset.duration ? `${asset.duration.toFixed(1)}s` : ''}
                  </div>
                </div>
              )})}
            </div>
          ) : (
            /* ── List View with sortable columns ── */
            <div className="flex flex-col">
              {/* Column headers */}
              <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/80 sticky top-0 z-10">
                <div className="w-2 flex-shrink-0" />
                <div className="w-8 flex-shrink-0" />
                {([
                  { col: 'name' as const, label: 'Name', flex: 'flex-1 min-w-0' },
                  { col: 'type' as const, label: 'Type', flex: 'w-14 flex-shrink-0 text-center' },
                  { col: 'duration' as const, label: 'Duration', flex: 'w-16 flex-shrink-0 text-right' },
                  { col: 'resolution' as const, label: 'Res', flex: 'w-14 flex-shrink-0 text-right' },
                  { col: 'date' as const, label: 'Date', flex: 'w-16 flex-shrink-0 text-right' },
                  { col: 'color' as const, label: 'Color', flex: 'w-10 flex-shrink-0 text-center' },
                ]).map(({ col, label, flex }) => (
                  <button
                    key={col}
                    onClick={() => toggleSort(col)}
                    className={`${flex} flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors cursor-pointer select-none ${
                      listSortCol === col ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    {listSortCol === col ? (
                      listSortDir === 'asc' ? <ChevronUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 flex-shrink-0" />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover:opacity-50" />
                    )}
                  </button>
                ))}
                <div className="w-6 flex-shrink-0" />
              </div>
              {/* Asset rows */}
              {sortedAssets.map(asset => {
                const cl = getColorLabel(asset.colorLabel)
                const name = asset.path ? asset.path.split(/[/\\]/).pop() || asset.path : asset.type === 'adjustment' ? 'Adjustment Layer' : asset.type.charAt(0).toUpperCase() + asset.type.slice(1)
                const dateStr = new Date(asset.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                return (
                  <div
                    key={asset.id}
                    data-asset-card
                    data-asset-id={asset.id}
                    className={`group flex items-center gap-1 px-2 py-1 cursor-pointer transition-all ${
                      selectedAssetIds.has(asset.id)
                        ? 'bg-blue-600/20 ring-1 ring-blue-500/50'
                        : 'hover:bg-zinc-800/60'
                    }`}
                    draggable
                    onDragStart={(e) => {
                      let draggedAssets: Asset[]
                      if (selectedAssetIds.size > 0 && selectedAssetIds.has(asset.id)) {
                        e.dataTransfer.setData('assetIds', JSON.stringify([...selectedAssetIds]))
                        draggedAssets = [...selectedAssetIds].map(id => assets.find(a => a.id === id)).filter(Boolean) as Asset[]
                      } else {
                        e.dataTransfer.setData('assetId', asset.id)
                        draggedAssets = [asset]
                      }
                      e.dataTransfer.setData('asset', JSON.stringify(asset))
                      e.dataTransfer.effectAllowed = 'copy'
                      const blank = document.createElement('canvas')
                      blank.width = 1; blank.height = 1
                      e.dataTransfer.setDragImage(blank, 0, 0)
                      onAssetDragStart?.(draggedAssets)
                    }}
                    onDragEnd={() => onAssetDragEnd?.()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (e.ctrlKey || e.metaKey) {
                        setSelectedAssetIds(prev => {
                          const next = new Set(prev)
                          if (next.has(asset.id)) next.delete(asset.id)
                          else next.add(asset.id)
                          return next
                        })
                      } else if (e.shiftKey && selectedAssetIds.size > 0) {
                        const lastId = [...selectedAssetIds].pop()
                        const lastIdx = filteredAssets.findIndex(a => a.id === lastId)
                        const thisIdx = filteredAssets.findIndex(a => a.id === asset.id)
                        if (lastIdx >= 0 && thisIdx >= 0) {
                          const start = Math.min(lastIdx, thisIdx)
                          const end = Math.max(lastIdx, thisIdx)
                          const next = new Set(selectedAssetIds)
                          for (let i = start; i <= end; i++) next.add(filteredAssets[i].id)
                          setSelectedAssetIds(next)
                        }
                      } else {
                        if (selectedAssetIds.has(asset.id) && selectedAssetIds.size === 1) {
                          setSelectedAssetIds(new Set())
                        } else {
                          setSelectedAssetIds(new Set([asset.id]))
                        }
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      loadSourceAsset(asset)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!selectedAssetIds.has(asset.id)) {
                        setSelectedAssetIds(new Set([asset.id]))
                      }
                      setAssetContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
                    }}
                  >
                    {/* Color label dot */}
                    {cl ? (
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cl.color }} />
                    ) : (
                      <div className="w-2 flex-shrink-0" />
                    )}
                    {/* Thumbnail */}
                    <div className="w-8 h-6 flex-shrink-0 rounded overflow-hidden bg-zinc-800">
                      {asset.type === 'video' ? (
                        thumbnailMap[asset.url] ? (
                          <img src={thumbnailMap[asset.url]} alt="" className="w-full h-full object-cover" draggable={false} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><Film className="h-2.5 w-2.5 text-zinc-500" /></div>
                        )
                      ) : asset.type === 'audio' ? (
                        <div className="w-full h-full flex items-center justify-center bg-emerald-900/40"><Music className="h-2.5 w-2.5 text-emerald-400" /></div>
                      ) : asset.type === 'adjustment' ? (
                        <div className="w-full h-full flex items-center justify-center bg-blue-900/30"><Layers className="h-2.5 w-2.5 text-blue-400" /></div>
                      ) : (
                        <AssetThumbnail src={asset.url} type="image" className="w-full h-full object-cover" />
                      )}
                    </div>
                    {/* Name column */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-zinc-200 truncate leading-tight">{name}</p>
                      {asset.takes && asset.takes.length > 1 && (
                        <span className="text-[8px] text-blue-400">{asset.takes.length} takes</span>
                      )}
                    </div>
                    {/* Type column */}
                    <span className="w-14 flex-shrink-0 text-center text-[9px] text-zinc-500 uppercase font-medium">{asset.type}</span>
                    {/* Duration column */}
                    <span className="w-16 flex-shrink-0 text-right text-[9px] text-zinc-500 tabular-nums">
                      {asset.duration != null ? `${asset.duration.toFixed(1)}s` : '—'}
                    </span>
                    {/* Resolution column */}
                    <span className="w-14 flex-shrink-0 text-right text-[9px] text-zinc-500">
                      {asset.resolution || '—'}
                    </span>
                    {/* Date column */}
                    <span className="w-16 flex-shrink-0 text-right text-[9px] text-zinc-500">{dateStr}</span>
                    {/* Color column */}
                    <div className="w-10 flex-shrink-0 flex items-center justify-center">
                      {cl ? (
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cl.color }} title={cl.label} />
                      ) : (
                        <span className="text-[9px] text-zinc-600">—</span>
                      )}
                    </div>
                    {/* Delete button on hover */}
                    <Tooltip content="Delete asset" side="right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (currentProjectId) { pushAssetUndoRef.current(); deleteAsset(currentProjectId, asset.id) }
                        }}
                        className="w-6 flex-shrink-0 flex items-center justify-center p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Tooltip>
                  </div>
                )
              })}
            </div>
          )}
        </div>}
      </div>
      
      {/* Resize handle between Assets and Timelines */}
      <div
        className="h-1 flex-shrink-0 cursor-row-resize bg-transparent hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors relative group z-10"
        onMouseDown={(e) => handleResizeDragStart('assets', e)}
      >
        <div className="absolute inset-x-0 -top-1 -bottom-1" />
      </div>
      
      {/* Timelines Section */}
      <div className="flex flex-col min-h-0" style={assetsHeight > 0 ? { flex: '1 1 0%' } : { flex: '0 1 40%', minHeight: 100 }}>
        <div className="p-3 pb-2 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-semibold text-white">Timelines</h3>
          <div className="relative">
            <Tooltip content="Add timeline" side="right">
              <button
                onClick={() => setTimelineAddMenuOpen(prev => !prev)}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </Tooltip>
            {timelineAddMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                <button
                  onClick={() => { handleAddTimeline(); setTimelineAddMenuOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Timeline
                </button>
                <button
                  onClick={() => { setShowImportTimelineModal(true); setTimelineAddMenuOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  Import from XML
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto px-3 pb-3 space-y-1">
          {timelines.map(tl => {
            const isActive = tl.id === activeTimeline?.id
            const clipCount = tl.clips?.length || 0
            const tlDuration = tl.clips?.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0) || 0
            const formatDur = (s: number) => {
              const m = Math.floor(s / 60)
              const sec = Math.floor(s % 60)
              return m > 0 ? `${m}m ${sec}s` : `${sec}s`
            }
            
            return (
              <div
                key={tl.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isActive 
                    ? 'bg-blue-600/20 border border-blue-500/40' 
                    : 'hover:bg-zinc-800 border border-transparent'
                }`}
                draggable={!isActive}
                onDragStart={(e) => {
                  if (isActive) { e.preventDefault(); return }
                  e.dataTransfer.setData('timeline', JSON.stringify({ id: tl.id, name: tl.name }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => handleSwitchTimeline(tl.id)}
                onDoubleClick={() => handleStartRename(tl.id, tl.name, 'panel')}
                onContextMenu={(e) => handleTimelineTabContextMenu(e, tl.id)}
              >
                <Film className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-blue-400' : 'text-zinc-500'}`} />
                <div className="flex-1 min-w-0">
                  {renamingTimelineId === tl.id && renameSource === 'panel' ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename()
                        if (e.key === 'Escape') { setRenamingTimelineId(null); setRenameValue('') }
                      }}
                      className="bg-zinc-900 border border-blue-500 rounded px-1 py-0.5 outline-none text-white text-xs w-full"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                      {tl.name}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <span>{clipCount} clip{clipCount !== 1 ? 's' : ''}</span>
                    {clipCount > 0 && (
                      <>
                        <span>·</span>
                        <span>{formatDur(tlDuration)}</span>
                      </>
                    )}
                  </div>
                </div>
                {isActive ? (
                  <span className="text-[9px] text-blue-400 font-medium uppercase tracking-wider flex-shrink-0">Active</span>
                ) : openTimelineIds.has(tl.id) ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" title="Open in tabs" />
                ) : null}
                {/* Delete button (visible on hover, not for last timeline) */}
                {timelines.length > 1 && (
                  <Tooltip content="Delete timeline" side="right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteTimeline(tl.id)
                      }}
                      className="p-1 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Tooltip>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
