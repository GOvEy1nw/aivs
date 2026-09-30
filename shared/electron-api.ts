import type { ModelPackProgress } from '../frontend/types/progress'
import type { ReferenceEntity, SaveReferenceEntityInput, StagedReferenceImage } from './reference-library'

export interface LogsResponse { logPath: string; lines: string[]; error?: string }
export interface BackendHealthStatus { status: 'alive' | 'restarting' | 'dead'; exitCode?: number | null }

export interface ElectronAPI {
  listReferenceEntities: () => Promise<ReferenceEntity[]>
  saveReferenceEntity: (input: SaveReferenceEntityInput) => Promise<ReferenceEntity>
  deleteReferenceEntity: (id: string) => Promise<void>
  stageGeneratedReferenceImage: (sourcePath: string, draftId: string) => Promise<StagedReferenceImage>
  discardStagedReferenceImage: (sourcePath: string) => Promise<void>
  getBackend: () => Promise<{ url: string; token: string }>
  getModelsPath: () => Promise<string>
  readLocalFileBytes: (filePath: string) => Promise<{ bytes: Uint8Array; mimeType: string }>
  approveFile: (file: File) => Promise<boolean>
  recoverPersistedProjectFiles: (candidates: string[]) => Promise<{ status: 'approved' | 'cancelled' | 'no-pending'; approved: string[] }>
  approvePersistedProjectFiles: (candidates: string[]) => Promise<{ approved: string[]; rejected: string[] }>
  getPathForFile: (file: File) => string
  checkGpu: () => Promise<{ available: boolean; name?: string; vram?: number }>
  getAppInfo: () => Promise<{ version: string; isPackaged: boolean; modelsPath: string; userDataPath: string }>
  checkFirstRun: () => Promise<{ needsSetup: boolean; needsLicense: boolean }>
  acceptLicense: () => Promise<boolean>; completeSetup: () => Promise<boolean>; fetchLicenseText: () => Promise<string>; getNoticesText: () => Promise<string>
  openParentFolderOfFile: (filePath: string) => Promise<void>; showItemInFolder: (filePath: string) => Promise<void>
  getLogs: () => Promise<LogsResponse>; getLogPath: () => Promise<{ logPath: string; logDir: string }>; openLogFolder: () => Promise<boolean>
  getResourcePath: () => Promise<string | null>; getDownloadsPath: () => Promise<string>
  copyToProjectAssets: (srcPath: string, projectId: string, preserveSource?: boolean) => Promise<{ success: boolean; path?: string; url?: string; alreadyExisted?: boolean; reusedExisting?: boolean; error?: string }>
  copyGeneratedOutputToProjectAssets: (srcPath: string, projectId: string) => Promise<{ success: boolean; path?: string; url?: string; error?: string }>
  importToProjectAssets: (options: { srcPath: string; projectId: string; onDuplicate?: 'reuse' | 'suffix' | 'overwrite' | 'prompt' }) => Promise<{ success: boolean; path?: string; url?: string; fileName?: string; alreadyExisted?: boolean; reusedExisting?: boolean; needsDuplicateChoice?: boolean; error?: string }>
  getProjectAssetsPath: () => Promise<string>
  chooseProjectAssetsPath: () => Promise<{ success: boolean; cancelled?: boolean; path?: string; error?: string }>
  getProjectAssetsPathStatus: () => Promise<{ path: string; needsReselection: boolean; legacyPath?: string }>
  deleteProjectAssetFiles: (options: { projectId: string; filePaths: string[] }) => Promise<{ success: boolean; deleted: string[]; skipped: string[]; failed: { path: string; error: string }[] }>
  loadProjects: () => Promise<unknown[]>; saveProject: (project: unknown, position?: number) => Promise<void>; deleteProject: (id: string) => Promise<void>; migrateProjectsFromLocalStorage: (projects: unknown[]) => Promise<unknown[]>
  showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
  saveFile: (filePath: string, data: string, encoding?: string) => Promise<{ success: boolean; path?: string; error?: string }>
  saveBinaryFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; path?: string; error?: string }>
  saveTemporaryFile: (data: string, extension: string, encoding?: 'base64' | 'utf8') => Promise<string>
  showOpenDirectoryDialog: (options: { title?: string; defaultPath?: string }) => Promise<string | null>
  searchDirectoryForFiles: (dir: string, filenames: string[]) => Promise<Record<string, string>>; checkFilesExist: (filePaths: string[]) => Promise<Record<string, boolean>>
  showOpenFileDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => Promise<string[] | null>
  exportNative: (data: { clips: { url: string; type: string; startTime: number; duration: number; trimStart: number; speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number; muted: boolean; volume: number }[]; outputPath: string; codec: string; width: number; height: number; fps: number; quality: number; letterbox?: { ratio: number; color: string; opacity: number }; subtitles?: { text: string; startTime: number; endTime: number; style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean } }[] }) => Promise<{ success?: boolean; error?: string }>
  exportCancel: (sessionId: string) => Promise<{ ok?: boolean }>
  checkPythonReady: () => Promise<{ ready: boolean }>; startPythonSetup: () => Promise<void>
  getModelPacks: () => Promise<unknown[]>; refreshModelPacks: () => Promise<unknown[]>; getModelPackProgress: () => Promise<ModelPackProgress | null>
  getCheckpointsLocation: () => Promise<{ path: string; custom: boolean; defaultPath: string }>; setCheckpointsLocation: (value: string | null) => Promise<{ path: string; custom: boolean; defaultPath: string }>
  getLorasLocation: () => Promise<{ path: string; custom: boolean; defaultPath: string }>; setLorasLocation: (value: string | null) => Promise<{ path: string; custom: boolean; defaultPath: string }>
  openWanGP: () => Promise<void>; downloadModelPacks: (ids: string[]) => Promise<boolean>; cancelModelPackDownload: () => Promise<void>; deleteModelPack: (id: string) => Promise<void>
  startPythonBackend: () => Promise<void>; restartPythonBackend: () => Promise<void>; getBackendHealthStatus: () => Promise<BackendHealthStatus | null>
  setTitleBarOverlay: (theme: 'dark' | 'light') => Promise<void>
  onPythonSetupProgress: (cb: (data: unknown) => void) => void; removePythonSetupProgress: () => void
  onModelPackProgress: (cb: (data: ModelPackProgress) => void) => void; removeModelPackProgress: () => void
  onBackendHealthStatus: (cb: (data: BackendHealthStatus) => void) => (() => void)
  extractVideoFrame: (videoUrl: string, seekTime: number, width?: number, quality?: number) => Promise<{ path: string; url: string }>
  writeLog: (level: string, message: string) => Promise<void>
  platform: string
}
