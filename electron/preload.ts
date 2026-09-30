// Using require for Electron preload compatibility
import type { ElectronAPI } from '../shared/electron-api'

const { contextBridge, ipcRenderer, webUtils } = require('electron')
type ModelPackProgress = import('./python-setup').ModelPackProgress

// Expose protected methods to the renderer process
const electronAPI: ElectronAPI = {
  listReferenceEntities: (): Promise<import('../shared/reference-library').ReferenceEntity[]> =>
    ipcRenderer.invoke('list-reference-entities'),
  saveReferenceEntity: (input: import('../shared/reference-library').SaveReferenceEntityInput) =>
    ipcRenderer.invoke('save-reference-entity', input),
  deleteReferenceEntity: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-reference-entity', id),
  stageGeneratedReferenceImage: (sourcePath: string, draftId: string): Promise<import('../shared/reference-library').StagedReferenceImage> =>
    ipcRenderer.invoke('stage-generated-reference-image', sourcePath, draftId),
  discardStagedReferenceImage: (sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('discard-staged-reference-image', sourcePath),
  // Get the backend URL and auth token
  getBackend: (): Promise<{ url: string; token: string }> => ipcRenderer.invoke('get-backend'),
  
  // Get the path where models are stored
  getModelsPath: (): Promise<string> => ipcRenderer.invoke('get-models-path'),
  
  readLocalFileBytes: (filePath: string): Promise<{ bytes: Uint8Array; mimeType: string }> =>
    ipcRenderer.invoke('read-local-file-bytes', filePath),
  approveFile: (file: File): Promise<boolean> => {
    const filePath = webUtils.getPathForFile(file)
    return filePath ? ipcRenderer.invoke('approve-file-from-renderer', filePath) : Promise.resolve(false)
  },
  recoverPersistedProjectFiles: (candidates: string[]): Promise<{ status: 'approved' | 'cancelled' | 'no-pending'; approved: string[] }> =>
    ipcRenderer.invoke('recover-persisted-project-files', candidates),
  approvePersistedProjectFiles: (candidates: string[]): Promise<{ approved: string[]; rejected: string[] }> =>
    ipcRenderer.invoke('approve-persisted-project-files', candidates),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  
  // Check GPU availability
  checkGpu: (): Promise<{ available: boolean; name?: string; vram?: number }> =>
    ipcRenderer.invoke('check-gpu'),
  
  // Get app info
  getAppInfo: (): Promise<{ version: string; isPackaged: boolean; modelsPath: string; userDataPath: string }> =>
    ipcRenderer.invoke('get-app-info'),
  
  // First-run setup
  checkFirstRun: (): Promise<{ needsSetup: boolean; needsLicense: boolean }> => ipcRenderer.invoke('check-first-run'),
  acceptLicense: (): Promise<boolean> => ipcRenderer.invoke('accept-license'),
  completeSetup: (): Promise<boolean> => ipcRenderer.invoke('complete-setup'),
  fetchLicenseText: (): Promise<string> => ipcRenderer.invoke('fetch-license-text'),
  getNoticesText: (): Promise<string> => ipcRenderer.invoke('get-notices-text'),
  
  // Open specific app pages / folders
  openParentFolderOfFile: (filePath: string): Promise<void> => ipcRenderer.invoke('open-parent-folder-of-file', filePath),
  
  // Reveal a specific file in the OS file manager (Explorer/Finder)
  showItemInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('show-item-in-folder', filePath),
  
  // Log viewer
  getLogs: (): Promise<LogsResponse> => ipcRenderer.invoke('get-logs'),
  getLogPath: (): Promise<{ logPath: string; logDir: string }> => ipcRenderer.invoke('get-log-path'),
  openLogFolder: (): Promise<boolean> => ipcRenderer.invoke('open-log-folder'),
  
  // Get resources path (for video assets in production)
  getResourcePath: (): Promise<string | null> => ipcRenderer.invoke('get-resource-path'),
  
  // Paths
  getDownloadsPath: (): Promise<string> => ipcRenderer.invoke('get-downloads-path'),
  // Project assets
  copyToProjectAssets: (srcPath: string, projectId: string, preserveSource?: boolean): Promise<{ success: boolean; path?: string; url?: string; alreadyExisted?: boolean; reusedExisting?: boolean; error?: string }> =>
    ipcRenderer.invoke('copy-to-project-assets', srcPath, projectId, preserveSource),
  copyGeneratedOutputToProjectAssets: (srcPath: string, projectId: string): Promise<{ success: boolean; path?: string; url?: string; error?: string }> =>
    ipcRenderer.invoke('copy-generated-output-to-project-assets', srcPath, projectId),
  importToProjectAssets: (options: {
    srcPath: string
    projectId: string
    onDuplicate?: 'reuse' | 'suffix' | 'overwrite' | 'prompt'
  }): Promise<{
    success: boolean
    path?: string
    url?: string
    fileName?: string
    alreadyExisted?: boolean
    reusedExisting?: boolean
    needsDuplicateChoice?: boolean
    error?: string
  }> => ipcRenderer.invoke('import-to-project-assets', options),
  getProjectAssetsPath: (): Promise<string> =>
    ipcRenderer.invoke('get-project-assets-path'),
  chooseProjectAssetsPath: (): Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('choose-project-assets-path'),
  getProjectAssetsPathStatus: (): Promise<{ path: string; needsReselection: boolean; legacyPath?: string }> =>
    ipcRenderer.invoke('get-project-assets-path-status'),
  deleteProjectAssetFiles: (options: {
    projectId: string
    filePaths: string[]
  }): Promise<{
    success: boolean
    deleted: string[]
    skipped: string[]
    failed: { path: string; error: string }[]
  }> => ipcRenderer.invoke('delete-project-asset-files', options),
  loadProjects: (): Promise<unknown[]> => ipcRenderer.invoke('projects-load'),
  saveProject: (project: unknown, position?: number): Promise<void> =>
    ipcRenderer.invoke('projects-save', project, position),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('projects-delete', id),
  migrateProjectsFromLocalStorage: (projects: unknown[]): Promise<unknown[]> =>
    ipcRenderer.invoke('projects-migrate-local-storage', projects),

  // File save/export
  showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', options),
  saveFile: (filePath: string, data: string, encoding?: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('save-file', filePath, data, encoding),
  saveBinaryFile: (filePath: string, data: ArrayBuffer): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('save-binary-file', filePath, data),
  saveTemporaryFile: (data: string, extension: string, encoding?: 'base64' | 'utf8'): Promise<string> =>
    ipcRenderer.invoke('save-temporary-file', data, extension, encoding),
  showOpenDirectoryDialog: (options: { title?: string; defaultPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke('show-open-directory-dialog', options),
  searchDirectoryForFiles: (dir: string, filenames: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke('search-directory-for-files', dir, filenames),
  // Check multiple files at once
  checkFilesExist: (filePaths: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('check-files-exist', filePaths),
  
  // Show open file dialog
  showOpenFileDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }): Promise<string[] | null> =>
    ipcRenderer.invoke('show-open-file-dialog', options),
  
  // Video export via ffmpeg (native compositing — no canvas, no frame-by-frame)
  exportNative: (data: {
    clips: { url: string; type: string; startTime: number; duration: number; trimStart: number; speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number; muted: boolean; volume: number }[];
    outputPath: string; codec: string; width: number; height: number; fps: number; quality: number;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean } }[];
  }): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('export-native', data),
  exportCancel: (sessionId: string): Promise<{ ok?: boolean }> =>
    ipcRenderer.invoke('export-cancel', sessionId),

  // Python setup (Windows first-launch download)
  checkPythonReady: (): Promise<{ ready: boolean }> => ipcRenderer.invoke('check-python-ready'),
  startPythonSetup: (): Promise<void> => ipcRenderer.invoke('start-python-setup'),
  getModelPacks: (): Promise<unknown[]> => ipcRenderer.invoke('get-model-packs'),
  refreshModelPacks: (): Promise<unknown[]> => ipcRenderer.invoke('refresh-model-packs'),
  getModelPackProgress: (): Promise<ModelPackProgress | null> => ipcRenderer.invoke('get-model-pack-progress'),
  getCheckpointsLocation: (): Promise<{ path: string; custom: boolean; defaultPath: string }> => ipcRenderer.invoke('get-checkpoints-location'),
  setCheckpointsLocation: (value: string | null): Promise<{ path: string; custom: boolean; defaultPath: string }> => ipcRenderer.invoke('set-checkpoints-location', value),
  getLorasLocation: (): Promise<{ path: string; custom: boolean; defaultPath: string }> => ipcRenderer.invoke('get-loras-location'),
  setLorasLocation: (value: string | null): Promise<{ path: string; custom: boolean; defaultPath: string }> => ipcRenderer.invoke('set-loras-location', value),
  openWanGP: (): Promise<void> => ipcRenderer.invoke('open-wangp'),
  downloadModelPacks: (ids: string[]): Promise<boolean> => ipcRenderer.invoke('download-model-packs', ids),
  cancelModelPackDownload: (): Promise<void> => ipcRenderer.invoke('cancel-model-pack-download'),
  deleteModelPack: (id: string): Promise<void> => ipcRenderer.invoke('delete-model-pack', id),
  startPythonBackend: (): Promise<void> => ipcRenderer.invoke('start-python-backend'),
  restartPythonBackend: (): Promise<void> => ipcRenderer.invoke('restart-python-backend'),
  getBackendHealthStatus: (): Promise<BackendHealthStatus | null> => ipcRenderer.invoke('get-backend-health-status'),
  setTitleBarOverlay: (theme: 'dark' | 'light'): Promise<void> => ipcRenderer.invoke('set-title-bar-overlay', theme),
  onPythonSetupProgress: (cb: (data: unknown) => void) => {
    ipcRenderer.on('python-setup-progress', (_: unknown, data: unknown) => cb(data))
  },
  removePythonSetupProgress: () => {
    ipcRenderer.removeAllListeners('python-setup-progress')
  },
  onModelPackProgress: (cb: (data: ModelPackProgress) => void) => {
    ipcRenderer.on('model-pack-progress', (_: unknown, data: ModelPackProgress) => cb(data))
  },
  removeModelPackProgress: () => {
    ipcRenderer.removeAllListeners('model-pack-progress')
  },
  onBackendHealthStatus: (cb: (data: BackendHealthStatus) => void) => {
    const listener = (_: unknown, data: BackendHealthStatus) => cb(data)
    ipcRenderer.on('backend-health-status', listener)
    return () => {
      ipcRenderer.removeListener('backend-health-status', listener)
    }
  },

  // Extract a single video frame via ffmpeg (returns file path + file:// URL)
  extractVideoFrame: (videoUrl: string, seekTime: number, width?: number, quality?: number): Promise<{ path: string; url: string }> =>
    ipcRenderer.invoke('extract-video-frame', videoUrl, seekTime, width, quality),

  // Write a log line to the session log file
  writeLog: (level: string, message: string): Promise<void> =>
    ipcRenderer.invoke('write-log', level, message),

  // Platform info
  platform: process.platform,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
