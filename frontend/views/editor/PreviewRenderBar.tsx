import type { PreviewStatus } from './useRenderedPreview'

interface PreviewRenderBarProps {
  status: PreviewStatus
  progress: number
  onForceRender: () => void
}

export function PreviewRenderBar({ status, progress, onForceRender }: PreviewRenderBarProps) {
  const barColor =
    status === 'ready' ? 'bg-green-500' :
    status === 'rendering' ? 'bg-blue-500' :
    'bg-orange-500'

  const title =
    status === 'ready' ? 'Preview ready — click to re-render' :
    status === 'rendering' ? `Rendering preview... ${Math.round(progress)}%` :
    'Preview stale — click to render'

  return (
    <div
      className="flex-shrink-0 h-[3px] cursor-pointer group"
      onClick={onForceRender}
      title={title}
    >
      {status === 'rendering' ? (
        <div className="h-full bg-zinc-700/50 w-full">
          <div
            className={`h-full ${barColor} transition-all duration-300`}
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : (
        <div className={`h-full ${barColor} w-full opacity-60 group-hover:opacity-100 transition-opacity`} />
      )}
    </div>
  )
}
