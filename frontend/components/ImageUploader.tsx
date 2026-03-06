import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageUploaderProps {
  onImageSelect: (path: string | null) => void
  selectedImage: string | null
  label?: string
}

export function ImageUploader({ onImageSelect, selectedImage, label = 'Image' }: ImageUploaderProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (file) {
      // In Electron, File objects have a .path property with the full filesystem path
      const filePath = (file as any).path as string | undefined
      if (filePath) {
        const normalized = filePath.replace(/\\/g, '/')
        const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
        onImageSelect(fileUrl)
      } else {
        const url = URL.createObjectURL(file)
        onImageSelect(url)
      }
    }
  }, [onImageSelect])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    multiple: false,
    noClick: !!selectedImage, // Disable click when image is loaded
  })

  const clearImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    onImageSelect(null)
  }

  const replaceImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    open()
  }

  // Extract and truncate filename from path for display
  const getDisplayName = (path: string | null): string => {
    if (!path) return ''
    // Extract filename from path or URL
    const name = path.split(/[/\\]/).pop()?.replace(/^file:/, '') || path
    const decoded = decodeURIComponent(name)
    const maxLength = 28
    if (decoded.length <= maxLength) return decoded
    const ext = decoded.split('.').pop() || ''
    const baseName = decoded.slice(0, decoded.length - ext.length - 1)
    const truncatedBase = baseName.slice(0, maxLength - ext.length - 4) // 4 for '...' and '.'
    return `${truncatedBase}...${ext ? '.' + ext : ''}`
  }

  return (
    <div className="w-full">
      <label className="block text-[12px] font-semibold text-zinc-500 mb-2 uppercase leading-4">
        {label}
      </label>
      <div
        {...getRootProps()}
        className={cn(
          'relative border border-dashed border-zinc-600 rounded-lg cursor-pointer transition-colors',
          'hover:border-zinc-500',
          isDragActive && 'border-blue-500 bg-blue-500/5',
          selectedImage ? 'p-3' : 'p-6'
        )}
      >
        <input {...getInputProps()} />

        {selectedImage ? (
          <div className="flex items-center gap-3">
            {/* Thumbnail */}
            <div className="w-14 h-14 flex-shrink-0 rounded-md overflow-hidden bg-zinc-800">
              <img
                src={selectedImage}
                alt="Selected"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Filename */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate" title={getDisplayName(selectedImage)}>
                {getDisplayName(selectedImage)}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={clearImage}
                className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
                title="Remove image"
              >
                <Trash2 className="h-5 w-5 text-zinc-400 hover:text-white" />
              </button>
              <button
                onClick={replaceImage}
                className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
                title="Replace image"
              >
                <RefreshCw className="h-5 w-5 text-zinc-400 hover:text-white" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="p-3 bg-zinc-700 rounded-lg">
              {isDragActive ? (
                <Upload className="h-6 w-6 text-blue-400" />
              ) : (
                <ImageIcon className="h-6 w-6 text-zinc-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Drag image file here
              </p>
              <p className="text-sm text-zinc-500">
                Or <span className="text-blue-400 underline">upload a file</span>
              </p>
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500 mt-2">
        png, jpeg, webp. Max size is 10MB
      </p>
    </div>
  )
}
