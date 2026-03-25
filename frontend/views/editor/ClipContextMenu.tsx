import React from 'react'
import {
  Clipboard, Copy, Scissors, Trash2, Layers, Type, X, RefreshCw,
  ZoomIn, Film, Eye, FolderOpen, RotateCcw, Volume2, VolumeX,
  FlipHorizontal2, FlipVertical2, Link2, Unlink2, ArrowLeftRight,
  ChevronLeft, ChevronRight, // IC-LORA HIDDEN: removed Sparkles
  Video, Camera, Box,
} from 'lucide-react'
import type { Asset, TimelineClip, Track, TextOverlayStyle, InferenceStack } from '../../types/project'
import { TEXT_PRESETS } from '../../types/project'
import { COLOR_LABELS, isValidStackSelection } from './video-editor-utils'

export interface ClipContextMenuProps {
  clipContextMenu: { clipId: string; x: number; y: number }
  contextClip: TimelineClip | null
  clipContextMenuRef: React.RefObject<HTMLDivElement>
  clips: TimelineClip[]
  tracks: Track[]
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  currentTime: number
  hasClipboard: boolean
  isRegenerating: boolean
  i2vClipId: string | null
  assets: Asset[]
  assetGridRef: React.RefObject<HTMLDivElement | null>
  currentProjectId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void
  setClipContextMenu: React.Dispatch<React.SetStateAction<{ clipId: string; x: number; y: number } | null>>
  addTextClip: (style?: Partial<TextOverlayStyle>, startTime?: number) => void
  pushUndo: () => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  handleRegenerate: (assetId: string, clipId: string) => void
  handleCancelRegeneration: () => void
  handleClipTakeChange: (clipId: string, direction: 'prev' | 'next') => void
  handleDeleteTake: (clipId: string) => void
  duplicateClip: (clipId: string) => void
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  removeClip: (clipId: string) => void
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void
  getLiveAsset: (clip: TimelineClip) => Asset | null | undefined
  getMaxClipDuration: (clip: TimelineClip) => number
  setAssetFilter: (v: 'all' | 'video' | 'image' | 'audio') => void
  setSelectedBin: (v: string | null) => void
  setTakesViewAssetId: (v: string | null) => void
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setI2vClipId: (v: string | null) => void
  setI2vPrompt: (v: string) => void
  onRetakeClip: (clip: TimelineClip) => void
  setIcLoraSourceClipId: (v: string | null) => void
  setShowICLoraPanel: (v: boolean) => void
  onCaptureFrameForVideo: (clip: TimelineClip) => void
  onCreateVideoFromAudio: (clip: TimelineClip) => void
  onCreateStack: (clipIds: string[]) => void
  onRemoveFromStack: (clipId: string) => void
  onEditStack: (stackId: string) => void
  onRevertStack: (stackId: string) => void
  onRelinkStackOutput: (stackId: string, videoPath: string) => Promise<boolean>
  inferenceStacks: InferenceStack[]
  projectName?: string
}

// Reusable menu item component
function MenuItem({ icon: Icon, iconClass, label, shortcut, badge, badgeClass, disabled, danger, title, onClick }: {
  icon: any; iconClass?: string; label: string; shortcut?: string; badge?: string; badgeClass?: string
  disabled?: boolean; danger?: boolean; title?: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-3 transition-colors ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-700'
      } ${danger ? 'text-red-400' : 'text-zinc-300'}`}
    >
      <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${iconClass || (danger ? '' : 'text-zinc-500')}`} />
      <span className="flex-1 truncate">{label}</span>
      {badge && <span className={`text-[10px] font-medium flex-shrink-0 ${badgeClass || 'text-zinc-500'}`}>{badge}</span>}
      {shortcut && <span className="text-zinc-600 text-[10px] flex-shrink-0">{shortcut}</span>}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-0.5 text-[9px] text-zinc-500 font-semibold uppercase tracking-widest select-none">
      {children}
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-zinc-700 my-1" />
}

export function ClipContextMenu({
  clipContextMenu,
  contextClip,
  clipContextMenuRef,
  clips,
  selectedClipIds,
  setSelectedClipIds,
  currentTime,
  hasClipboard,
  isRegenerating,
  i2vClipId,
  assets,
  assetGridRef,
  currentProjectId,
  updateAsset,
  handleCopy,
  handleCut,
  handlePaste,
  setClipContextMenu,
  addTextClip,
  pushUndo,
  setClips,
  handleRegenerate,
  handleCancelRegeneration,
  handleClipTakeChange,
  handleDeleteTake,
  duplicateClip,
  splitClipAtPlayhead,
  removeClip,
  updateClip,
  getLiveAsset,
  getMaxClipDuration,
  setAssetFilter,
  setSelectedBin,
  setTakesViewAssetId,
  setSelectedAssetIds,
  setI2vClipId,
  setI2vPrompt,
  onRetakeClip,
  setIcLoraSourceClipId, // IC-LORA HIDDEN: still passed to SingleClipMenu
  setShowICLoraPanel, // IC-LORA HIDDEN: still passed to SingleClipMenu
  onCaptureFrameForVideo,
  onCreateVideoFromAudio,
  onCreateStack,
  onRemoveFromStack,
  onEditStack,
  onRevertStack,
  onRelinkStackOutput,
  inferenceStacks,
  projectName,
}: ClipContextMenuProps) {
  const close = () => setClipContextMenu(null)
  const isBackground = !contextClip

  // Check if all selected clips are in the same linked group — if so, treat as single selection
  const multiSelected = (() => {
    if (selectedClipIds.size <= 1) return false
    if (!contextClip) return selectedClipIds.size > 1
    // Expand the linked group of the context clip
    const linkedGroup = new Set([contextClip.id])
    const queue = [contextClip.id]
    while (queue.length > 0) {
      const id = queue.pop()!
      const c = clips.find(cl => cl.id === id)
      if (c?.linkedClipIds) {
        for (const lid of c.linkedClipIds) {
          if (!linkedGroup.has(lid)) { linkedGroup.add(lid); queue.push(lid) }
        }
      }
    }
    // If every selected clip is in this linked group, it's a single logical selection
    for (const sid of selectedClipIds) {
      if (!linkedGroup.has(sid)) return true
    }
    return false
  })()

  return (
    <div
      ref={clipContextMenuRef}
      className="fixed bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl py-1.5 z-[60] min-w-[220px] max-w-[280px] text-xs"
      style={{ left: clipContextMenu.x, top: clipContextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ════════════════════════════════════════════════
          BACKGROUND CONTEXT MENU (empty area right-click)
          ════════════════════════════════════════════════ */}
      {isBackground ? (
        <>
          <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" disabled={!hasClipboard}
            onClick={() => { handlePaste(); close() }} />
          <Divider />
          <MenuItem icon={Type} iconClass="text-cyan-400" label="Add Text"
            onClick={() => { addTextClip(undefined, currentTime); close() }} />
          {TEXT_PRESETS.slice(0, 4).map(preset => (
            <button
              key={preset.id}
              onClick={() => { addTextClip(preset.style, currentTime); close() }}
              className="w-full text-left px-3 py-1.5 text-zinc-400 hover:bg-zinc-700 flex items-center gap-3 pl-9"
            >
              <span className="text-[10px] text-cyan-500/70 flex-shrink-0">T</span>
              <span className="flex-1 truncate">{preset.name}</span>
            </button>
          ))}
          <Divider />
          <MenuItem icon={Layers} label="Select All" shortcut="Ctrl+A"
            onClick={() => { setSelectedClipIds(new Set(clips.map(c => c.id))); close() }} />
        </>
      ) : multiSelected ? (
        /* ════════════════════════════════════════════════
           MULTI-CLIP CONTEXT MENU
           ════════════════════════════════════════════════ */
        <MultiClipMenu
          clips={clips}
          selectedClipIds={selectedClipIds} setSelectedClipIds={setSelectedClipIds}
          hasClipboard={hasClipboard}
          currentProjectId={currentProjectId}
          updateAsset={updateAsset}
          handleCopy={handleCopy} handleCut={handleCut} handlePaste={handlePaste}
          pushUndo={pushUndo} setClips={setClips}
          getMaxClipDuration={getMaxClipDuration}
          onCreateStack={onCreateStack}
          close={close}
        />
      ) : contextClip ? (
        /* ════════════════════════════════════════════════
           SINGLE CLIP CONTEXT MENU
           (For linked groups treated as single, prefer the video/image clip)
           ════════════════════════════════════════════════ */
        <SingleClipMenu
          contextClip={(() => {
            if (contextClip.type !== 'audio') return contextClip
            if (contextClip.linkedClipIds?.length) {
              const primary = clips.find(c => contextClip.linkedClipIds!.includes(c.id) && (c.type === 'video' || c.type === 'image'))
              if (primary) return primary
            }
            return contextClip
          })()}
          clips={clips}
          hasClipboard={hasClipboard}
          isRegenerating={isRegenerating} i2vClipId={i2vClipId}
          assets={assets}
          assetGridRef={assetGridRef}
          currentProjectId={currentProjectId}
          updateAsset={updateAsset}
          handleCopy={handleCopy} handleCut={handleCut} handlePaste={handlePaste}
          pushUndo={pushUndo} setClips={setClips}
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
          onRetakeClip={onRetakeClip}
          setIcLoraSourceClipId={setIcLoraSourceClipId}
          setShowICLoraPanel={setShowICLoraPanel}
          onCaptureFrameForVideo={onCaptureFrameForVideo}
          onCreateVideoFromAudio={onCreateVideoFromAudio}
          onCreateStack={onCreateStack}
          onRemoveFromStack={onRemoveFromStack}
          onEditStack={onEditStack}
          onRevertStack={onRevertStack}
          onRelinkStackOutput={onRelinkStackOutput}
          inferenceStacks={inferenceStacks}
          projectName={projectName}
          close={close}
        />
      ) : null}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Single Clip Menu
   Layout:
   1. Clipboard        (Cut / Copy / Paste)
   2. Edit             (Duplicate / Split)
   3. Properties       (Speed / Reverse / Mute)
   4. Transform        (Flip H / Flip V)
   5. Structure        (Link / Move Track)
   6. AI Tools         (Regenerate / Upscale / I2V / Retake / IC-LoRA)
   7. Navigation       (Reveal in Assets / Explorer)
   8. Delete           (always last, red)
   ────────────────────────────────────────────── */
function SingleClipMenu({
  contextClip, clips, hasClipboard,
  isRegenerating, i2vClipId, assets, assetGridRef,
  currentProjectId, updateAsset,
  handleCopy, handleCut, handlePaste, pushUndo, setClips,
  handleRegenerate, handleCancelRegeneration,
  handleClipTakeChange, handleDeleteTake,
  duplicateClip, splitClipAtPlayhead, removeClip, updateClip,
  getLiveAsset, getMaxClipDuration,
  setAssetFilter, setSelectedBin, setTakesViewAssetId, setSelectedAssetIds,
  setI2vClipId, setI2vPrompt, onRetakeClip, setIcLoraSourceClipId: _setIcLoraSourceClipId, setShowICLoraPanel: _setShowICLoraPanel, // IC-LORA HIDDEN
  onCaptureFrameForVideo,
  onCreateVideoFromAudio,
  onCreateStack,
  onRemoveFromStack,
  onEditStack,
  onRevertStack,
  onRelinkStackOutput: _onRelinkStackOutput,
  inferenceStacks: _inferenceStacks,
  projectName: _projectName,
  close,
}: {
  contextClip: TimelineClip
  clips: TimelineClip[]
  hasClipboard: boolean
  isRegenerating: boolean; i2vClipId: string | null
  assets: Asset[]
  assetGridRef: React.RefObject<HTMLDivElement | null>
  currentProjectId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  handleCopy: () => void; handleCut: () => void; handlePaste: () => void
  pushUndo: () => void; setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  handleRegenerate: (assetId: string, clipId: string) => void
  handleCancelRegeneration: () => void
  handleClipTakeChange: (clipId: string, direction: 'prev' | 'next') => void
  handleDeleteTake: (clipId: string) => void
  duplicateClip: (clipId: string) => void
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  removeClip: (clipId: string) => void
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void
  getLiveAsset: (clip: TimelineClip) => Asset | null | undefined
  getMaxClipDuration: (clip: TimelineClip) => number
  setAssetFilter: (v: 'all' | 'video' | 'image' | 'audio') => void
  setSelectedBin: (v: string | null) => void
  setTakesViewAssetId: (v: string | null) => void
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setI2vClipId: (v: string | null) => void
  setI2vPrompt: (v: string) => void
  onRetakeClip: (clip: TimelineClip) => void
  setIcLoraSourceClipId: (v: string | null) => void
  setShowICLoraPanel: (v: boolean) => void
  onCaptureFrameForVideo: (clip: TimelineClip) => void
  onCreateVideoFromAudio: (clip: TimelineClip) => void
  onCreateStack: (clipIds: string[]) => void
  onRemoveFromStack: (clipId: string) => void
  onEditStack: (stackId: string) => void
  onRevertStack: (stackId: string) => void
  onRelinkStackOutput: (stackId: string, videoPath: string) => Promise<boolean>
  inferenceStacks: InferenceStack[]
  projectName?: string
  close: () => void
}) {
  const liveAsset = getLiveAsset(contextClip)
  const isAdjustment = contextClip.type === 'adjustment'
  const isVideo = contextClip.type === 'video'
  const isImage = contextClip.type === 'image'
  const hasAI = liveAsset && !isAdjustment

  return (
    <>
      {/* ── 1. Clipboard ── */}
      <MenuItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => { handleCut(); close() }} />
      <MenuItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => { handleCopy(); close() }} />
      <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" disabled={!hasClipboard} onClick={() => { handlePaste(); close() }} />

      <Divider />

      {/* ── 2. Edit ── */}
      <MenuItem icon={Copy} label="Duplicate" onClick={() => { duplicateClip(contextClip.id); close() }} />
      <MenuItem icon={Scissors} label="Split at Playhead" shortcut="Alt+B" onClick={() => { splitClipAtPlayhead(contextClip.id); close() }} />

      <Divider />

      {/* ── 3. Properties ── */}
      <SectionLabel>Speed</SectionLabel>
      <div className="flex items-center gap-1 px-3 py-1">
        {[0.25, 0.5, 1, 1.5, 2, 4].map(speed => (
          <button
            key={speed}
            onClick={() => {
              const oldSpeed = contextClip.speed
              let newDuration = contextClip.duration * (oldSpeed / speed)
              const maxDur = getMaxClipDuration({ ...contextClip, speed })
              newDuration = Math.min(newDuration, maxDur)
              newDuration = Math.max(0.5, newDuration)
              updateClip(contextClip.id, { speed, duration: newDuration })
              close()
            }}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              contextClip.speed === speed
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white'
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>
      <MenuItem icon={RotateCcw} label="Reverse"
        badge={contextClip.reversed ? 'ON' : undefined} badgeClass="text-blue-400"
        onClick={() => { updateClip(contextClip.id, { reversed: !contextClip.reversed }); close() }} />
      <MenuItem
        icon={contextClip.muted ? VolumeX : Volume2}
        label={contextClip.muted ? 'Unmute' : 'Mute'}
        badge={contextClip.muted ? 'MUTED' : undefined} badgeClass="text-red-400"
        onClick={() => { updateClip(contextClip.id, { muted: !contextClip.muted }); close() }} />

      <Divider />

      {/* ── 4. Transform ── */}
      <MenuItem icon={FlipHorizontal2} label="Flip Horizontal"
        badge={contextClip.flipH ? 'ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => { updateClip(contextClip.id, { flipH: !contextClip.flipH }); close() }} />
      <MenuItem icon={FlipVertical2} label="Flip Vertical"
        badge={contextClip.flipV ? 'ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => { updateClip(contextClip.id, { flipV: !contextClip.flipV }); close() }} />

      <Divider />

      {/* ── 5. Structure (Link / Track) ── */}
      {contextClip.linkedClipIds?.length ? (
        <>
          <MenuItem icon={Unlink2} label="Unlink Audio" onClick={() => {
            pushUndo()
            const allLinked = new Set(contextClip.linkedClipIds!)
            const stackId = contextClip.inferenceStackId
            setClips(prev => {
              // Build set of stack-sibling IDs to preserve those links
              const stackSiblingIds = stackId
                ? new Set(prev.filter(c => c.inferenceStackId === stackId && c.id !== contextClip.id).map(c => c.id))
                : new Set<string>()
              return prev.map(c => {
                if (c.id === contextClip.id) {
                  // Keep links to stack siblings, remove audio/video links
                  const remaining = (c.linkedClipIds || []).filter(lid => stackSiblingIds.has(lid))
                  return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
                }
                if (allLinked.has(c.id)) {
                  const remaining = (c.linkedClipIds || []).filter(lid => lid !== contextClip.id)
                  return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
                }
                return c
              })
            })
            close()
          }} />
          {(() => {
            const partner = clips.find(c => contextClip.linkedClipIds!.includes(c.id))
            if (!partner) return null
            if (Math.abs(contextClip.startTime - partner.startTime) < 0.01) return null
            return (
              <MenuItem icon={ArrowLeftRight} label="Resync Audio/Video" onClick={() => {
                pushUndo()
                // Move all linked partners to match this clip's start time
                const linkedIds = new Set(contextClip.linkedClipIds!)
                setClips(prev => prev.map(c => {
                  if (linkedIds.has(c.id)) return { ...c, startTime: contextClip.startTime }
                  return c
                }))
                close()
              }} />
            )
          })()}
        </>
      ) : null}
      {!contextClip.linkedClipIds?.length && (contextClip.type === 'video' || contextClip.type === 'audio') && (() => {
        const oppositeType = contextClip.type === 'video' ? 'audio' : 'video'
        const candidates = clips.filter(c =>
          c.type === oppositeType && !c.linkedClipIds?.length &&
          c.assetId === contextClip.assetId && Math.abs(c.startTime - contextClip.startTime) < 0.05
        )
        if (!candidates.length) return null
        return (
          <MenuItem icon={Link2} label="Link Audio" onClick={() => {
            pushUndo()
            const candidateIds = candidates.map(c => c.id)
            setClips(prev => prev.map(c => {
              if (c.id === contextClip.id) return { ...c, linkedClipIds: candidateIds }
              if (candidateIds.includes(c.id)) return { ...c, linkedClipIds: [contextClip.id] }
              return c
            }))
            close()
          }} />
        )
      })()}

      {/* ── 6. Color Label ── */}
      <Divider />
      <SectionLabel>Label</SectionLabel>
      <div className="px-3 py-1.5 flex items-center gap-1 flex-wrap">
        <button
          onClick={() => {
            if (contextClip.assetId) {
              // Update ALL clips that share this asset
              pushUndo()
              setClips(prev => prev.map(c => c.assetId === contextClip.assetId ? { ...c, colorLabel: undefined } : c))
              if (currentProjectId) updateAsset(currentProjectId, contextClip.assetId, { colorLabel: undefined })
            } else {
              updateClip(contextClip.id, { colorLabel: undefined })
            }
            close()
          }}
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
            !contextClip.colorLabel ? 'border-white scale-110' : 'border-zinc-600 hover:border-zinc-400'
          }`}
          title="No label"
        >
          <X className="h-2 w-2 text-zinc-400" />
        </button>
        {COLOR_LABELS.map(cl => (
          <button
            key={cl.id}
            onClick={() => {
              if (contextClip.assetId) {
                // Update ALL clips that share this asset
                pushUndo()
                setClips(prev => prev.map(c => c.assetId === contextClip.assetId ? { ...c, colorLabel: cl.id } : c))
                if (currentProjectId) updateAsset(currentProjectId, contextClip.assetId, { colorLabel: cl.id })
              } else {
                updateClip(contextClip.id, { colorLabel: cl.id })
              }
              close()
            }}
            className={`w-4 h-4 rounded-full transition-all ${
              contextClip.colorLabel === cl.id ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-800 scale-110' : 'hover:scale-125'
            }`}
            style={{ backgroundColor: cl.color }}
            title={cl.label}
          />
        ))}
      </div>

      {/* ── Inference Stack ── */}
      {(isImage || contextClip.type === 'audio') && !contextClip.inferenceStackId && (
        <>
          <Divider />
          <MenuItem icon={Box} iconClass="text-violet-400" label="Create Inference Stack"
            onClick={() => { onCreateStack([contextClip.id]); close() }} />
        </>
      )}
      {contextClip.inferenceStackId && (
        <>
          <Divider />
          <MenuItem icon={Layers} iconClass="text-violet-400" label="Edit Stack"
            onClick={() => { onEditStack(contextClip.inferenceStackId!); close() }} />
          <MenuItem icon={Link2} iconClass="text-amber-400" label="Link Output"
            onClick={() => { onEditStack(contextClip.inferenceStackId!); close() }}
            title="Open stack panel to link a rendered video output" />
          <MenuItem icon={RotateCcw} iconClass="text-amber-400" label="Reset Stack"
            onClick={() => { onRevertStack(contextClip.inferenceStackId!); close() }} />
          <MenuItem icon={X} iconClass="text-violet-400" label="Remove from Stack"
            onClick={() => { onRemoveFromStack(contextClip.id); close() }} />
        </>
      )}

      {/* ── 7. AI Tools ── */}
      {hasAI && (
        <>
          <Divider />
          <SectionLabel>AI Tools</SectionLabel>

          {contextClip.isRegenerating ? (
            <MenuItem icon={X} iconClass="text-red-400" label="Cancel Regeneration" onClick={() => { handleCancelRegeneration(); close() }} />
          ) : (
            <MenuItem icon={RefreshCw} iconClass="text-blue-400" label="Regenerate Shot"
              disabled={isRegenerating} onClick={() => { handleRegenerate(contextClip.assetId!, contextClip.id); close() }} />
          )}

          {/* Take navigation */}
          {liveAsset!.takes && liveAsset!.takes.length > 1 && (
            <div className="px-3 py-1 flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 flex-shrink-0">Take:</span>
              <button onClick={(e) => { e.stopPropagation(); handleClipTakeChange(contextClip.id, 'prev') }}
                className="p-0.5 rounded hover:bg-zinc-600 text-zinc-400 hover:text-white">
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-zinc-300 min-w-[28px] text-center tabular-nums">
                {(contextClip.takeIndex ?? (liveAsset!.activeTakeIndex ?? liveAsset!.takes!.length - 1)) + 1}/{liveAsset!.takes!.length}
              </span>
              <button onClick={(e) => { e.stopPropagation(); handleClipTakeChange(contextClip.id, 'next') }}
                className="p-0.5 rounded hover:bg-zinc-600 text-zinc-400 hover:text-white">
                <ChevronRight className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete take ${(contextClip.takeIndex ?? (liveAsset!.activeTakeIndex ?? liveAsset!.takes!.length - 1)) + 1}?`)) {
                    handleDeleteTake(contextClip.id)
                  }
                }}
                className="p-0.5 rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 ml-auto"
                title="Delete this take"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}

          {isVideo && contextClip.assetId && (
            <MenuItem icon={ZoomIn} iconClass="text-zinc-500" label="Upscale (2x)"
              disabled={true} title="Coming Soon!" onClick={() => {}} />
          )}
          {isImage && (
            <MenuItem icon={Film} iconClass="text-blue-400" label="Image to Video (I2V)"
              disabled={isRegenerating && i2vClipId === contextClip.id}
              onClick={() => { setI2vClipId(contextClip.id); setI2vPrompt(contextClip.asset?.prompt || ''); close() }} />
          )}
          {isVideo && contextClip.assetId && (
            <>
              <MenuItem icon={Film} iconClass="text-blue-400" label="Retake Section"
                onClick={() => { onRetakeClip(contextClip); close() }} />
              {/* IC-LORA HIDDEN - IC-LoRA context menu item hidden because IC-LoRA is broken on server
              <MenuItem icon={Sparkles} iconClass="text-amber-400" label="IC-LoRA / Style Transfer"
                onClick={() => { setIcLoraSourceClipId(contextClip.id); setShowICLoraPanel(true); close() }} />
              */}
            </>
          )}
          {contextClip.type === 'audio' && !contextClip.linkedClipIds?.length && (
            <MenuItem
              icon={Film}
              iconClass="text-emerald-400"
              label="Create Video (A2V)"
              onClick={() => { onCreateVideoFromAudio(contextClip); close() }}
            />
          )}
          {(isVideo || isImage) && (
            <div className="relative group/capture">
              <button
                className="w-full text-left px-3 py-1.5 flex items-center gap-3 transition-colors hover:bg-zinc-700 text-zinc-300"
              >
                <Camera className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                <span className="flex-1 truncate">Use Frame As...</span>
                <ChevronRight className="h-3 w-3 text-zinc-500" />
              </button>
              <div className="absolute left-full top-0 ml-0.5 min-w-[200px] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-[70] hidden group-hover/capture:block">
                <MenuItem icon={Video} iconClass="text-blue-400" label="Generate Video in Gen Space"
                  onClick={() => { onCaptureFrameForVideo(contextClip); close() }} />
                {isImage && (
                  <MenuItem icon={Film} iconClass="text-blue-400" label="Image to Video (I2V)"
                    disabled={isRegenerating && i2vClipId === contextClip.id}
                    onClick={() => { setI2vClipId(contextClip.id); setI2vPrompt(contextClip.asset?.prompt || ''); close() }} />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 7. Navigation ── */}
      {(contextClip.assetId || getLiveAsset(contextClip)?.path) && (
        <>
          <Divider />
          {contextClip.assetId && (
            <MenuItem icon={Eye} label="Reveal in Assets" onClick={() => {
              const asset = assets.find(a => a.id === contextClip.assetId)
              if (asset) {
                setAssetFilter('all'); setSelectedBin(asset.bin ?? null)
                setTakesViewAssetId(null); setSelectedAssetIds(new Set([asset.id]))
                setTimeout(() => {
                  const card = assetGridRef.current?.querySelector(`[data-asset-id="${asset.id}"]`)
                  card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 100)
              }
              close()
            }} />
          )}
          {(() => {
            if (!liveAsset) return null
            let filePath = liveAsset.path
            if (liveAsset.takes && liveAsset.takes.length > 0) {
              const takeIdx = contextClip.takeIndex ?? (liveAsset.activeTakeIndex ?? liveAsset.takes.length - 1)
              filePath = liveAsset.takes[Math.max(0, Math.min(takeIdx, liveAsset.takes.length - 1))].path
            }
            if (!filePath) return null
            const label = window.electronAPI?.platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer'
            return <MenuItem icon={FolderOpen} label={label} onClick={() => { window.electronAPI?.showItemInFolder(filePath); close() }} />
          })()}
        </>
      )}

      {/* ── 8. Delete (always last, always red) ── */}
      <Divider />
      <MenuItem icon={Trash2} label="Delete" shortcut="Del" danger onClick={() => { removeClip(contextClip.id); close() }} />
    </>
  )
}

/* ──────────────────────────────────────────────
   Multi-Clip Menu
   Layout:
   1. Header           (N clips selected)
   2. Clipboard        (Cut / Copy / Paste)
   3. Properties       (Speed / Mute / Reverse)
   4. Transform        (Flip H / Flip V)
   5. Structure        (Link / Unlink / Move Track)
   6. Delete           (always last, red)
   ────────────────────────────────────────────── */
function MultiClipMenu({
  clips, selectedClipIds, setSelectedClipIds, hasClipboard,
  currentProjectId, updateAsset,
  handleCopy, handleCut, handlePaste, pushUndo, setClips, getMaxClipDuration,
  onCreateStack, close,
}: {
  clips: TimelineClip[]
  selectedClipIds: Set<string>; setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  hasClipboard: boolean
  currentProjectId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  handleCopy: () => void; handleCut: () => void; handlePaste: () => void
  pushUndo: () => void; setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  getMaxClipDuration: (clip: TimelineClip) => number
  onCreateStack: (clipIds: string[]) => void
  close: () => void
}) {
  const n = selectedClipIds.size
  const selectedClips = clips.filter(c => selectedClipIds.has(c.id))
  const allMuted = selectedClips.every(c => c.muted)
  const allReversed = selectedClips.every(c => c.reversed)
  const allFlipH = selectedClips.every(c => c.flipH)
  const allFlipV = selectedClips.every(c => c.flipV)
  const batchUpdate = (updates: Partial<TimelineClip>) => {
    pushUndo()
    setClips(prev => prev.map(c => selectedClipIds.has(c.id) ? { ...c, ...updates } : c))
    close()
  }

  const anyLinked = selectedClips.some(c => c.linkedClipIds?.length)
  const hasVideoAndAudio = selectedClips.some(c => c.type === 'video') && selectedClips.some(c => c.type === 'audio')
  const allFullyLinked = selectedClips.every(c => {
    const others = [...selectedClipIds].filter(id => id !== c.id)
    return others.every(oid => c.linkedClipIds?.includes(oid))
  })

  return (
    <>
      {/* ── Header ── */}
      <SectionLabel>{n} Clips Selected</SectionLabel>

      {/* ── 1. Clipboard ── */}
      <MenuItem icon={Scissors} label={`Cut ${n} Clips`} shortcut="Ctrl+X" onClick={() => { handleCut(); close() }} />
      <MenuItem icon={Copy} label={`Copy ${n} Clips`} shortcut="Ctrl+C" onClick={() => { handleCopy(); close() }} />
      <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" disabled={!hasClipboard} onClick={() => { handlePaste(); close() }} />

      <Divider />

      {/* ── 2. Properties ── */}
      <SectionLabel>Speed</SectionLabel>
      <div className="flex items-center gap-1 px-3 py-1">
        {[0.25, 0.5, 1, 1.5, 2, 4].map(speed => (
          <button
            key={speed}
            onClick={() => {
              pushUndo()
              setClips(prev => prev.map(c => {
                if (!selectedClipIds.has(c.id)) return c
                const oldSpeed = c.speed
                let newDuration = c.duration * (oldSpeed / speed)
                const maxDur = getMaxClipDuration({ ...c, speed })
                newDuration = Math.min(newDuration, maxDur)
                newDuration = Math.max(0.5, newDuration)
                return { ...c, speed, duration: newDuration }
              }))
              close()
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
          >
            {speed}x
          </button>
        ))}
      </div>
      <MenuItem icon={allMuted ? VolumeX : Volume2} label={allMuted ? 'Unmute All' : 'Mute All'}
        badge={allMuted ? 'ALL MUTED' : undefined} badgeClass="text-red-400"
        onClick={() => batchUpdate({ muted: !allMuted })} />
      <MenuItem icon={RotateCcw} label={allReversed ? 'Un-reverse All' : 'Reverse All'}
        badge={allReversed ? 'ALL ON' : undefined} badgeClass="text-blue-400"
        onClick={() => batchUpdate({ reversed: !allReversed })} />

      <Divider />

      {/* ── 3. Transform ── */}
      <MenuItem icon={FlipHorizontal2} label={allFlipH ? 'Un-flip All Horizontal' : 'Flip All Horizontal'}
        badge={allFlipH ? 'ALL ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => batchUpdate({ flipH: !allFlipH })} />
      <MenuItem icon={FlipVertical2} label={allFlipV ? 'Un-flip All Vertical' : 'Flip All Vertical'}
        badge={allFlipV ? 'ALL ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => batchUpdate({ flipV: !allFlipV })} />

      <Divider />

      {/* ── 4. Structure ── */}
      {anyLinked && (
        <MenuItem icon={Unlink2} label="Unlink" onClick={() => {
          pushUndo()
          const selIds = new Set(selectedClipIds)
          setClips(prev => {
            // Build stack sibling sets so we preserve stack-internal links
            const stackSiblings = new Map<string, Set<string>>()
            for (const id of selIds) {
              const clip = prev.find(c => c.id === id)
              if (clip?.inferenceStackId) {
                const siblings = new Set(prev.filter(c => c.inferenceStackId === clip.inferenceStackId && c.id !== id).map(c => c.id))
                stackSiblings.set(id, siblings)
              }
            }
            return prev.map(c => {
              if (!selIds.has(c.id)) return c
              const keepIds = stackSiblings.get(c.id) || new Set<string>()
              const remaining = (c.linkedClipIds || []).filter(lid => !selIds.has(lid) || keepIds.has(lid))
              return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
            })
          })
          close()
        }} />
      )}
      {hasVideoAndAudio && !allFullyLinked && (
        <MenuItem icon={Link2} label="Link" onClick={() => {
          pushUndo()
          const selIds = [...selectedClipIds]
          setClips(prev => prev.map(c => {
            if (!selectedClipIds.has(c.id)) return c
            const otherIds = selIds.filter(id => id !== c.id)
            const existingLinks = new Set(c.linkedClipIds || [])
            otherIds.forEach(id => existingLinks.add(id))
            return { ...c, linkedClipIds: [...existingLinks] }
          }))
          close()
        }} />
      )}

      {/* ── 5. Inference Stack ── */}
      {isValidStackSelection(selectedClips) && (
        <>
          <Divider />
          <MenuItem icon={Box} iconClass="text-violet-400" label="Create Inference Stack"
            onClick={() => { onCreateStack([...selectedClipIds]); close() }} />
        </>
      )}

      {/* ── 6. Color Label ── */}
      <Divider />
      <SectionLabel>Label</SectionLabel>
      <div className="px-3 py-1.5 flex items-center gap-1 flex-wrap">
        <button
          onClick={() => {
            pushUndo()
            const affectedAssetIds = new Set(selectedClips.map(c => c.assetId).filter(Boolean) as string[])
            // Update selected clips AND all other clips sharing the same assets
            setClips(prev => prev.map(c => {
              if (selectedClipIds.has(c.id) || (c.assetId && affectedAssetIds.has(c.assetId))) {
                return { ...c, colorLabel: undefined }
              }
              return c
            }))
            if (currentProjectId) {
              affectedAssetIds.forEach(id => updateAsset(currentProjectId!, id, { colorLabel: undefined }))
            }
            close()
          }}
          className="w-4 h-4 rounded-full border-2 border-zinc-600 hover:border-zinc-400 flex items-center justify-center transition-all"
          title="No label"
        >
          <X className="h-2 w-2 text-zinc-400" />
        </button>
        {COLOR_LABELS.map(cl => (
          <button
            key={cl.id}
            onClick={() => {
              pushUndo()
              const affectedAssetIds = new Set(selectedClips.map(c => c.assetId).filter(Boolean) as string[])
              // Update selected clips AND all other clips sharing the same assets
              setClips(prev => prev.map(c => {
                if (selectedClipIds.has(c.id) || (c.assetId && affectedAssetIds.has(c.assetId))) {
                  return { ...c, colorLabel: cl.id }
                }
                return c
              }))
              if (currentProjectId) {
                affectedAssetIds.forEach(id => updateAsset(currentProjectId!, id, { colorLabel: cl.id }))
              }
              close()
            }}
            className="w-4 h-4 rounded-full hover:scale-125 transition-all"
            style={{ backgroundColor: cl.color }}
            title={cl.label}
          />
        ))}
      </div>

      {/* ── 6. Delete ── */}
      <Divider />
      <MenuItem icon={Trash2} label={`Delete ${n} Clips`} shortcut="Del" danger onClick={() => {
        pushUndo()
        setClips(prev => prev.filter(c => !selectedClipIds.has(c.id)).map(c => {
          if (!c.linkedClipIds) return c
          const remaining = c.linkedClipIds.filter(lid => !selectedClipIds.has(lid))
          return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
        }))
        setSelectedClipIds(new Set())
        close()
      }} />
    </>
  )
}
