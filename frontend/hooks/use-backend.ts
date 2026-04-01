import { useState, useEffect, useCallback } from 'react'
import { logger } from '../lib/logger'

interface BackendStatus {
  connected: boolean
}

interface UseBackendReturn {
  status: BackendStatus
  isLoading: boolean
  error: string | null
  checkHealth: () => Promise<boolean>
}

export function useBackend(): UseBackendReturn {
  const [status, setStatus] = useState<BackendStatus>({
    connected: false,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      logger.info('Checking ComfyUI health...')
      const result = await window.electronAPI.checkComfyUIHealth()
      logger.info(`ComfyUI health: connected=${result.connected}`)

      setStatus({ connected: result.connected })
      if (result.connected) {
        setError(null)
      }
      return result.connected
    } catch (err) {
      logger.error(`ComfyUI health check error: ${err}`)
      setStatus({ connected: false })
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const connected = await checkHealth()
      if (cancelled) return

      if (!connected) {
        // Retry a few times
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 2000))
          if (cancelled) return
          const ok = await checkHealth()
          if (ok || cancelled) break
        }
      }

      if (!cancelled) {
        setIsLoading(false)
        const currentStatus = await window.electronAPI.checkComfyUIHealth()
        if (!currentStatus.connected && !cancelled) {
          setError('Could not connect to ComfyUI. Check the ComfyUI URL in Settings and make sure the server is reachable.')
        }
      }
    }

    void init()

    // Periodic health check
    const interval = setInterval(async () => {
      if (!cancelled) {
        await checkHealth()
      }
    }, 30000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [checkHealth])

  return {
    status,
    isLoading,
    error,
    checkHealth,
  }
}
