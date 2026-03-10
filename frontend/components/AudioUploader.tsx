import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Music, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fileToFileUrl, resolveAudioDrop } from '@/lib/url-to-path'

interface AudioUploaderProps {
  onAudioSelect: (path: string | null) => void
  selectedAudio: string | null
}

export function AudioUploader({ onAudioSelect, selectedAudio }: AudioUploaderProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (file) {
      onAudioSelect(fileToFileUrl(file))
    }
  }, [onAudioSelect])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/ogg': ['.ogg'],
      'audio/aac': ['.aac'],
      'audio/flac': ['.flac'],
      'audio/mp4': ['.m4a'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    multiple: false,
    noClick: !!selectedAudio,
  })

  // Intercept external audio file drops that react-dropzone may reject (MIME mismatch)
  const rootProps = getRootProps()
  const originalOnDrop = rootProps.onDrop
  const handleDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    const url = resolveAudioDrop(e)
    if (url) {
      e.preventDefault()
      e.stopPropagation()
      onAudioSelect(url)
      return
    }
    if (originalOnDrop) {
      (originalOnDrop as (e: React.DragEvent<HTMLElement>) => void)(e)
    }
  }, [onAudioSelect, originalOnDrop])

  const clearAudio = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAudioSelect(null)
  }

  const replaceAudio = (e: React.MouseEvent) => {
    e.stopPropagation()
    open()
  }

  const getDisplayName = (path: string | null): string => {
    if (!path) return ''
    const name = path.split(/[/\\]/).pop()?.replace(/^file:/, '') || path
    const decoded = decodeURIComponent(name)
    const maxLength = 28
    if (decoded.length <= maxLength) return decoded
    const ext = decoded.split('.').pop() || ''
    const baseName = decoded.slice(0, decoded.length - ext.length - 1)
    const truncatedBase = baseName.slice(0, maxLength - ext.length - 4)
    return `${truncatedBase}...${ext ? '.' + ext : ''}`
  }

  return (
    <div className="w-full">
      <label className="block text-[12px] font-semibold text-zinc-500 mb-2 uppercase leading-4">
        Audio
      </label>
      <div
        {...rootProps}
        onDrop={handleDrop}
        className={cn(
          'relative border border-dashed border-zinc-600 rounded-lg cursor-pointer transition-colors',
          'hover:border-zinc-500',
          isDragActive && 'border-emerald-500 bg-emerald-500/5',
          selectedAudio ? 'p-3' : 'p-6'
        )}
      >
        <input {...getInputProps()} />

        {selectedAudio ? (
          <div className="flex items-center gap-3">
            {/* Audio icon (no thumbnail for audio) */}
            <div className="w-14 h-14 flex-shrink-0 rounded-md overflow-hidden bg-zinc-800 flex items-center justify-center">
              <Music className="h-6 w-6 text-emerald-400" />
            </div>

            {/* Filename */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate" title={getDisplayName(selectedAudio)}>
                {getDisplayName(selectedAudio)}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={clearAudio}
                className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
                title="Remove audio"
              >
                <Trash2 className="h-5 w-5 text-zinc-400 hover:text-white" />
              </button>
              <button
                onClick={replaceAudio}
                className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
                title="Replace audio"
              >
                <RefreshCw className="h-5 w-5 text-zinc-400 hover:text-white" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="p-3 bg-zinc-700 rounded-lg">
              {isDragActive ? (
                <Upload className="h-6 w-6 text-emerald-400" />
              ) : (
                <Music className="h-6 w-6 text-zinc-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Drag audio file here
              </p>
              <p className="text-sm text-zinc-500">
                Or <span className="text-emerald-400 underline">upload a file</span>
              </p>
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500 mt-2">
        mp3, wav, ogg, aac, flac, m4a. Max size is 50MB
      </p>
    </div>
  )
}
