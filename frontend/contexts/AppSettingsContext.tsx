import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { backendFetch } from '../lib/backend'
import {
  applyUiTheme,
  DEFAULT_UI_THEME,
  isUiTheme,
  readCachedUiTheme,
  type UiTheme,
  writeCachedUiTheme,
} from '../lib/theme'
import { useBackendLifecycle } from './BackendLifecycleContext'

export interface InferenceSettings {
  steps: number
}

export interface OutputSettings {
  videoContainer: 'mp4' | 'mov' | 'mkv'
  videoCodec: 'libx264_8' | 'libx264_10' | 'libx264_lossless' | 'libx265_28' | 'libx265_8' | 'prores_422'
  imageCodec: 'jpeg' | 'webp' | 'png' | 'webp_lossless'
  imageQuality: number
  audioCodec: 'aac_128' | 'aac_192' | 'aac_256' | 'aac_320'
  metadataMode: 'metadata' | 'json'
  keepIntermediateSlidingWindows: boolean
}

export interface PreviewSettings {
  mode: 'rgb' | 'tiny_vae_frames' | 'tiny_vae_video'
}

export interface AppSettings {
  uiTheme: UiTheme
  useTorchCompile: boolean
  attentionMode: 'auto' | 'sdpa' | 'flash' | 'xformers' | 'sage' | 'sage2' | 'sage3'
  performanceProfile: 1 | 2 | 3 | 4 | 4.5 | 5
  reduceVram: 'disabled' | '1' | '2' | '3'
  loadOnStartup: boolean
  proModel: InferenceSettings
  seedLocked: boolean
  lockedSeed: number
  outputSettings: OutputSettings
  previewSettings: PreviewSettings
  previewMigrationNotice: string
  quickGenFavouriteWorkflows: string[]
}

const DEFAULT_OUTPUT_SETTINGS: OutputSettings = {
  videoContainer: 'mp4',
  videoCodec: 'libx264_8',
  imageCodec: 'jpeg',
  imageQuality: 95,
  audioCodec: 'aac_192',
  metadataMode: 'metadata',
  keepIntermediateSlidingWindows: false,
}

const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  mode: 'tiny_vae_video',
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  uiTheme: DEFAULT_UI_THEME,
  useTorchCompile: false,
  attentionMode: 'auto',
  performanceProfile: 4,
  reduceVram: 'disabled',
  loadOnStartup: true,
  proModel: { steps: 20 },
  seedLocked: false,
  lockedSeed: 42,
  outputSettings: DEFAULT_OUTPUT_SETTINGS,
  previewSettings: DEFAULT_PREVIEW_SETTINGS,
  previewMigrationNotice: '',
  quickGenFavouriteWorkflows: [],
}

interface AppSettingsContextValue {
  settings: AppSettings
  isLoaded: boolean
  updateSettings: (patch: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => void
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshSettings: () => Promise<void>
  setUiTheme: (theme: UiTheme) => void
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

function normalizeAppSettings(data: Partial<AppSettings>): AppSettings {
  return {
    uiTheme: isUiTheme(data.uiTheme) ? data.uiTheme : DEFAULT_UI_THEME,
    useTorchCompile: data.useTorchCompile ?? DEFAULT_APP_SETTINGS.useTorchCompile,
    attentionMode: data.attentionMode ?? DEFAULT_APP_SETTINGS.attentionMode,
    performanceProfile: data.performanceProfile ?? DEFAULT_APP_SETTINGS.performanceProfile,
    reduceVram: data.reduceVram ?? DEFAULT_APP_SETTINGS.reduceVram,
    loadOnStartup: data.loadOnStartup ?? DEFAULT_APP_SETTINGS.loadOnStartup,
    proModel: data.proModel ?? DEFAULT_APP_SETTINGS.proModel,
    seedLocked: data.seedLocked ?? DEFAULT_APP_SETTINGS.seedLocked,
    lockedSeed: data.lockedSeed ?? DEFAULT_APP_SETTINGS.lockedSeed,
    outputSettings: {
      ...DEFAULT_OUTPUT_SETTINGS,
      ...(data.outputSettings ?? {}),
    },
    previewSettings: {
      ...DEFAULT_PREVIEW_SETTINGS,
      ...(data.previewSettings ?? {}),
    },
    previewMigrationNotice: data.previewMigrationNotice ?? '',
    quickGenFavouriteWorkflows: data.quickGenFavouriteWorkflows ?? DEFAULT_APP_SETTINGS.quickGenFavouriteWorkflows,
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_APP_SETTINGS,
    uiTheme: readCachedUiTheme(),
  }))
  const [isLoaded, setIsLoaded] = useState(false)
  const { processStatus } = useBackendLifecycle()
  const settingsLifecycleVersionRef = useRef(0)

  const loadSettings = useCallback(async (): Promise<AppSettings> => {
    const response = await backendFetch('/api/settings')
    if (!response.ok) {
      throw new Error(`Settings fetch failed with status ${response.status}`)
    }
    return normalizeAppSettings(await response.json())
  }, [])

  const refreshSettings = useCallback(async () => {
    setSettings(await loadSettings())
    setIsLoaded(true)
  }, [loadSettings])

  useEffect(() => {
    const lifecycleVersion = settingsLifecycleVersionRef.current + 1
    settingsLifecycleVersionRef.current = lifecycleVersion
    if (isLoaded || processStatus !== 'alive') return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const fetchSettings = async () => {
      try {
        const nextSettings = await loadSettings()
        if (cancelled || lifecycleVersion !== settingsLifecycleVersionRef.current) return
        setSettings(nextSettings)
        setIsLoaded(true)
      } catch {
        if (!cancelled) {
          retryTimer = setTimeout(fetchSettings, 1000)
        }
      }
    }

    fetchSettings()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [isLoaded, loadSettings, processStatus])

  useEffect(() => {
    applyUiTheme(settings.uiTheme)
    writeCachedUiTheme(settings.uiTheme)
  }, [settings.uiTheme])

  useEffect(() => {
    if (!isLoaded || processStatus !== 'alive') return
    const syncTimer = setTimeout(async () => {
      try {
        await backendFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        })
      } catch {
        // Best-effort settings sync.
      }
    }, 150)
    return () => clearTimeout(syncTimer)
  }, [processStatus, isLoaded, settings])

  const updateSettings = useCallback((patch: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => {
    if (typeof patch === 'function') {
      setSettings((prev) => patch(prev))
      return
    }
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const response = await backendFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!response.ok) {
      throw new Error(`Settings save failed with status ${response.status}`)
    }
    setSettings(await loadSettings())
  }, [loadSettings])

  const setUiTheme = useCallback((theme: UiTheme) => {
    applyUiTheme(theme)
    writeCachedUiTheme(theme)
    setSettings((previous) => ({ ...previous, uiTheme: theme }))
  }, [])

  const contextValue = useMemo<AppSettingsContextValue>(
    () => ({
      settings,
      isLoaded,
      updateSettings,
      saveSettings,
      refreshSettings,
      setUiTheme,
    }),
    [isLoaded, refreshSettings, saveSettings, setUiTheme, settings, updateSettings],
  )

  return <AppSettingsContext.Provider value={contextValue}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return context
}
