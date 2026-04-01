import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle, Settings, FileText } from 'lucide-react'
import { ProjectProvider, useProjects } from './contexts/ProjectContext'
import { KeyboardShortcutsProvider } from './contexts/KeyboardShortcutsContext'
import { AppSettingsProvider } from './contexts/AppSettingsContext'
import { GenerationProvider } from './contexts/GenerationContext'
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal'
import { useBackend } from './hooks/use-backend'
import { logger } from './lib/logger'
import { Home } from './views/Home'
import { Project } from './views/Project'
import { Playground } from './views/Playground'
import { LaunchGate } from './components/FirstRunSetup'
import { SettingsModal, type SettingsTabId } from './components/SettingsModal'
import { LogViewer } from './components/LogViewer'
import { Button } from './components/ui/button'

type SetupState = 'loading' | { needsSetup: boolean; needsLicense: boolean }

function AppContent() {
  const { currentView } = useProjects()
  const { status, isLoading: backendLoading, error: backendError } = useBackend()

  const [setupState, setSetupState] = useState<SetupState>('loading')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId | undefined>(undefined)
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false)
  const [hasNodeUpdates, setHasNodeUpdates] = useState(false)
  const setupCompletionInFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.tab) setSettingsInitialTab(detail.tab)
      setIsSettingsOpen(true)
    }
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  // Check for node updates 10s after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      window.electronAPI.checkNodeUpdates()
        .then((result) => {
          if (result.hasAnyUpdates) setHasNodeUpdates(true)
        })
        .catch(() => {})
    }, 10_000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const next = await window.electronAPI.checkFirstRun()
        setSetupState(next)
      } catch (e) {
        logger.error(`Failed to check first run: ${e}`)
        setSetupState({ needsSetup: false, needsLicense: false })
      }
    }
    void checkFirstRun()
  }, [])

  const handleFirstRunComplete = useCallback(async () => {
    if (setupCompletionInFlightRef.current) {
      return setupCompletionInFlightRef.current
    }

    const inFlightPromise = (async () => {
      const ok = await window.electronAPI.completeSetup()
      if (!ok) {
        throw new Error('Failed to complete setup.')
      }
      setSetupState({ needsSetup: false, needsLicense: false })
    })()

    setupCompletionInFlightRef.current = inFlightPromise

    try {
      await inFlightPromise
    } finally {
      setupCompletionInFlightRef.current = null
    }
  }, [])

  const handleAcceptLicense = useCallback(async () => {
    const ok = await window.electronAPI.acceptLicense()
    if (!ok) {
      throw new Error('Failed to save license acceptance.')
    }
    setSetupState((prev) => {
      if (prev === 'loading') return prev
      return { ...prev, needsLicense: false }
    })
  }, [])

  if (backendLoading || setupState === 'loading') {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Starting LTX Desktop...</h2>
          <p className="text-muted-foreground">Connecting to ComfyUI</p>
        </div>
      </div>
    )
  }

  if (backendError && !status.connected) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Cannot Connect to ComfyUI</h2>
          <p className="text-muted-foreground mb-4">{backendError}</p>
          <p className="text-muted-foreground text-sm mb-4">Make sure the configured ComfyUI server is running and reachable.</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    )
  }

  if (setupState.needsLicense) {
    return (
      <LaunchGate
        showLicenseStep
        licenseOnly
        onAcceptLicense={handleAcceptLicense}
        onComplete={async () => {
          setSetupState((prev) => {
            if (prev === 'loading') return prev
            return { ...prev, needsLicense: false }
          })
        }}
      />
    )
  }

  if (setupState.needsSetup) {
    return <LaunchGate showLicenseStep={false} onComplete={handleFirstRunComplete} />
  }

  const showGlobalControls = currentView !== 'home' && status.connected

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return <Home />
      case 'project':
        return <Project />
      case 'playground':
        return <Playground />
      default:
        return <Home />
    }
  }

  return (
    <div className="relative h-screen w-screen">
      {renderView()}

      {showGlobalControls && (
        <div className="fixed top-[18px] right-3 z-50 flex items-center gap-1">
          <button
            onClick={() => setIsLogViewerOpen(true)}
            className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            title="View Logs"
          >
            <FileText className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (hasNodeUpdates) {
                setSettingsInitialTab('about')
                setHasNodeUpdates(false)
              }
              setIsSettingsOpen(true)
            }}
            className="relative h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
            {hasNodeUpdates && (
              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
      )}

      <LogViewer isOpen={isLogViewerOpen} onClose={() => setIsLogViewerOpen(false)} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          setSettingsInitialTab(undefined)
        }}
        initialTab={settingsInitialTab}
      />
    </div>
  )
}

export default function App() {
  return (
    <ProjectProvider>
      <KeyboardShortcutsProvider>
        <AppSettingsProvider>
          <GenerationProvider>
            <AppContent />
            <KeyboardShortcutsModal />
          </GenerationProvider>
        </AppSettingsProvider>
      </KeyboardShortcutsProvider>
    </ProjectProvider>
  )
}
