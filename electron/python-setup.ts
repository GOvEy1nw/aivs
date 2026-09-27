import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { getCustomCheckpointsPath, getCustomLorasPath, setCustomCheckpointsPath, setCustomLorasPath } from './app-state'
import { isDev } from './config'
import { logger } from './logger'

export interface PythonSetupProgress {
  status: 'downloading' | 'extracting' | 'installing' | 'complete' | 'error'
  percent: number
  downloadedBytes: number
  totalBytes: number
  speed: number
  message?: string
  detail?: string
}

export interface ModelPack {
  id: string
  name: string
  estimatedSize: string
  installed: boolean
  modelType?: string
  groupId?: string
  groupName?: string
  variantName?: string
  mediaTypes?: Array<'image' | 'video' | 'audio'>
  features?: string[]
  licenseUrl?: string
}

export interface ModelPackProgress {
  status: 'preparing' | 'downloading' | 'complete' | 'cancelled' | 'error'
  packId: string | null
  packName: string | null
  packIndex: number | null
  packCount: number | null
  message: string | null
  transfer: {
    phase: string | null
    source: string | null
    repoId: string | null
    filename: string | null
    unit: 'bytes' | 'files'
    current: number
    total: number | null
    percent: number | null
    speedBps: number | null
    etaSeconds: number | null
    fileIndex: number | null
    fileCount: number | null
  } | null
}

const MODEL_PACKS: Omit<ModelPack, 'installed'>[] = [
  { id: 'utility', name: 'Utility Models', estimatedSize: '~3.3 GB' },
  { id: 'z_image_turbo', name: 'Z-Image Turbo', estimatedSize: '~11.5 GB', modelType: 'z_image', mediaTypes: ['image'], features: ['generate'] },
  {
    id: 'flux2_klein_4b',
    name: 'Flux 2 Klein 4B',
    estimatedSize: '~8.8 GB',
    modelType: 'flux2_klein_4b',
    groupId: 'flux2_klein',
    groupName: 'Flux 2 Klein',
    variantName: '4B',
    mediaTypes: ['image'],
    features: ['generate', 'edit'],
  },
  {
    id: 'flux2_klein_9b',
    name: 'Flux 2 Klein 9B',
    estimatedSize: '~19.2 GB',
    modelType: 'flux2_klein_9b',
    groupId: 'flux2_klein',
    groupName: 'Flux 2 Klein',
    variantName: '9B',
    mediaTypes: ['image'],
    features: ['generate', 'edit'],
  },
  {
    id: 'krea2_turbo',
    name: 'Krea 2 Turbo',
    estimatedSize: '~18.2 GB',
    modelType: 'krea2_turbo',
    groupId: 'krea2',
    groupName: 'Krea 2',
    variantName: 'Create',
    mediaTypes: ['image'],
    features: ['generate'],
  },
  {
    id: 'krea2_turbo_edit',
    name: 'Krea 2 Edit',
    estimatedSize: '~20.8 GB',
    modelType: 'krea2_turbo_edit',
    groupId: 'krea2',
    groupName: 'Krea 2',
    variantName: 'Edit',
    mediaTypes: ['image'],
    features: ['edit'],
  },
  {
    id: 'qwen_image_2512_20B',
    name: 'Qwen Image',
    estimatedSize: '~30.7 GB',
    modelType: 'qwen_image_2512_20B',
    groupId: 'qwen_image',
    groupName: 'Qwen Image',
    variantName: 'Create',
    mediaTypes: ['image'],
    features: ['generate'],
  },
  {
    id: 'qwen_image_edit_plus2_20B',
    name: 'Qwen Image Edit',
    estimatedSize: '~31.3 GB',
    modelType: 'qwen_image_edit_plus2_20B',
    groupId: 'qwen_image',
    groupName: 'Qwen Image',
    variantName: 'Edit',
    mediaTypes: ['image'],
    features: ['edit'],
  },
  {
    id: 'hidream_o1',
    name: 'HiDream O1',
    estimatedSize: '~12.7 GB',
    modelType: 'hidream_o1_dev',
    mediaTypes: ['image'],
    features: ['generate', 'edit'],
  },
  {
    id: 'ideogram4_int8',
    name: 'Ideogram 4 Standard',
    estimatedSize: '',
    modelType: 'ideogram4',
    groupId: 'ideogram4',
    groupName: 'Ideogram 4',
    variantName: 'Standard',
    mediaTypes: ['image'],
    features: ['region'],
  },
  {
    id: 'ideogram4_turbotime_int8',
    name: 'Ideogram 4 TurboTime',
    estimatedSize: '',
    modelType: 'ideogram4_turbotime',
    groupId: 'ideogram4',
    groupName: 'Ideogram 4',
    variantName: 'TurboTime',
    mediaTypes: ['image'],
    features: ['region'],
  },
  {
    id: 'ltx2_fast',
    name: 'LTX 2.5 Fast',
    estimatedSize: '',
    modelType: 'ltx2_25_22B_distilled',
    groupId: 'ltx2_25',
    groupName: 'LTX 2.5',
    variantName: 'Fast',
    mediaTypes: ['video'],
    features: ['generate', 'reframe'],
  },
  {
    id: 'ltx2_quality',
    name: 'LTX 2.5 Quality',
    estimatedSize: '',
    modelType: 'ltx2_25_22B',
    groupId: 'ltx2_25',
    groupName: 'LTX 2.5',
    variantName: 'Quality',
    mediaTypes: ['video'],
    features: ['generate', 'reframe'],
  },
  {
    id: 'minimax-h3-fast',
    name: 'MiniMax H3 Fast',
    estimatedSize: '',
    modelType: 'minimax_h3_fl2va_pruned',
    groupId: 'minimax-h3',
    groupName: 'MiniMax H3',
    variantName: 'Fast',
    mediaTypes: ['video'],
    features: ['generate'],
    licenseUrl: 'https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE',
  },
  {
    id: 'minimax-h3-quality',
    name: 'MiniMax H3 Quality',
    estimatedSize: '',
    modelType: 'minimax_h3_fl2va_pruned',
    groupId: 'minimax-h3',
    groupName: 'MiniMax H3',
    variantName: 'Quality',
    mediaTypes: ['video'],
    features: ['generate'],
    licenseUrl: 'https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE',
  },
  {
    id: 'ace_step_15_turbo',
    name: 'ACE-Step 1.5 Fast',
    estimatedSize: '~6.3 GB',
    modelType: 'ace_step_v1_5_turbo_lm_1_7b',
    groupId: 'ace_step_15',
    groupName: 'ACE-Step 1.5',
    variantName: 'Fast',
    mediaTypes: ['audio'],
    features: ['generate'],
  },
  {
    id: 'ace_step_15_xl_turbo',
    name: 'ACE-Step 1.5 XL',
    estimatedSize: '~9.4 GB',
    modelType: 'ace_step_v1_5_xl_turbo_lm_1_7b',
    groupId: 'ace_step_15',
    groupName: 'ACE-Step 1.5',
    variantName: 'XL',
    mediaTypes: ['audio'],
    features: ['generate'],
  },
  {
    id: 'minimax_music3',
    name: 'MiniMax Music 3',
    estimatedSize: '~15.0 GB',
    modelType: 'minimax_music3',
    mediaTypes: ['audio'],
    features: ['generate'],
    licenseUrl: 'https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE',
  },
  {
    id: 'mmaudio',
    name: 'MMAudio Sound Effects',
    estimatedSize: '~10.7 GB',
    modelType: 'mmaudio',
    mediaTypes: ['audio'],
    features: ['generate'],
  },
  {
    id: 'omnivoice',
    name: 'OmniVoice',
    estimatedSize: '~3.2 GB',
    modelType: 'omnivoice',
    mediaTypes: ['audio'],
    features: ['generate'],
  },
  {
    id: 'index_tts2',
    name: 'Index TTS 2.5',
    estimatedSize: '~5.2 GB',
    modelType: 'index_tts25',
    mediaTypes: ['audio'],
    features: ['generate'],
  },
  { id: 'prompt_enhancer', name: 'Prompt Enhancer', estimatedSize: '~38.7 GB' },
]

let activeModelPackProcess: ChildProcess | null = null
let activeModelPackDeleteProcess: ChildProcess | null = null
let activeModelPackRefreshProcess: ChildProcess | null = null
let activeModelPackRefreshPromise: Promise<ModelPack[]> | null = null
let activeModelPackProgress: ModelPackProgress | null = null
let activeWanGPProcess: ChildProcess | null = null

export interface FolderLocation {
  path: string
  custom: boolean
  defaultPath: string
}

function isWanGPRoot(root: string): boolean {
  return ['wgp.py', path.join('shared', 'api.py'), 'requirements.txt']
    .every((relative) => fs.existsSync(path.join(root, relative)))
}

function getBundledWanGPHash(): string | null {
  try {
    const source = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'Wan2GP', '.aivs-wangp-source.json'), 'utf-8')) as {
      schemaVersion?: unknown
      contentHash?: unknown
    }
    return source.schemaVersion === 1 && typeof source.contentHash === 'string' && /^[0-9a-f]{64}$/.test(source.contentHash)
      ? source.contentHash
      : null
  } catch {
    return null
  }
}

function getWanGPSourceHash(root: string): string {
  const files: string[] = []
  const visit = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`WanGP source contains a link: ${file}`)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile() && file !== '.aivs-wangp-source.json') files.push(file)
    }
  }
  visit('')
  const hash = crypto.createHash('sha256')
  for (const file of files.sort()) {
    hash.update(`${file}\n`)
    hash.update(fs.readFileSync(path.join(root, file)))
  }
  return hash.digest('hex')
}

function isWanGPRuntimeReady(): boolean {
  try {
    const root = getWanGPRoot()
    if (!isWanGPRoot(root)) return false
    if (isDev) return true
    const source = JSON.parse(fs.readFileSync(path.join(root, '.aivs-wangp-source.json'), 'utf-8')) as { contentHash?: unknown }
    return source.contentHash === getBundledWanGPHash()
  } catch {
    return false
  }
}

export function getWanGPRoot(): string {
  if (isDev) {
    const source = process.env.WANGP_ROOT?.trim() || process.env.WANGP_WGP_PATH?.trim()
      || (process.platform === 'win32' ? 'C:\\Wan2GP' : path.resolve(process.cwd(), '..', 'Wan2GP'))
    const root = path.resolve(source)
    return path.basename(root).toLowerCase() === 'wgp.py' ? path.dirname(root) : root
  }
  const hash = getBundledWanGPHash()
  if (!hash) throw new Error('Bundled WanGP source identity is missing or invalid.')
  return path.join(app.getPath('userData'), 'runtime', `Wan2GP-${hash}`)
}

function getRuntimeModelsDir(): string {
  return path.join(app.getPath('userData'), 'models')
}

export function migrateLegacyModelDirectories(legacyRoot: string, modelsRoot: string): void {
  for (const [legacyName, targetName] of [['ckpts', 'checkpoints'], ['loras', 'loras']] as const) {
    const source = path.join(legacyRoot, legacyName)
    const target = path.join(modelsRoot, targetName)
    if (!fs.existsSync(source)) continue
    moveLegacyModelContents(source, target)
  }
}

function moveLegacyModelContents(source: string, target: string): void {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) moveLegacyModelContents(from, to)
    else if (entry.isFile() && !fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      try {
        fs.renameSync(from, to)
      } catch {
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
        fs.unlinkSync(from)
      }
    }
  }
}

export function getCheckpointsLocation(): FolderLocation {
  const customPath = getCustomCheckpointsPath()
  const defaultPath = path.join(getRuntimeModelsDir(), 'checkpoints')
  return {
    path: customPath ?? defaultPath,
    custom: customPath !== null,
    defaultPath,
  }
}

export function setCheckpointsLocation(value: string | null): FolderLocation {
  if (value !== null) {
    const resolved = path.resolve(value)
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Checkpoint path must be a folder.')
    setCustomCheckpointsPath(resolved)
  } else {
    setCustomCheckpointsPath(null)
  }
  return getCheckpointsLocation()
}

export function getLorasLocation(): FolderLocation {
  const customPath = getCustomLorasPath()
  const defaultPath = path.join(getRuntimeModelsDir(), 'loras')
  return {
    path: customPath ?? defaultPath,
    custom: customPath !== null,
    defaultPath,
  }
}

export function setLorasLocation(value: string | null): FolderLocation {
  if (value !== null) {
    const resolved = path.resolve(value)
    if (!fs.statSync(resolved).isDirectory()) throw new Error('LoRA path must be a folder.')
    setCustomLorasPath(resolved)
  } else {
    setCustomLorasPath(null)
  }
  return getLorasLocation()
}

function getWanGPPythonExecutable(): string {
  const developmentPython = process.platform === 'win32'
    ? path.join(process.cwd(), 'backend', '.venv', 'Scripts', 'python.exe')
    : path.join(process.cwd(), 'backend', '.venv', 'bin', 'python')
  if (isDev && fs.existsSync(developmentPython)) return developmentPython

  const bundledPython = process.platform === 'win32'
    ? path.join(getPythonDir(), 'python.exe')
    : path.join(getPythonDir(), 'bin', 'python3')
  if (fs.existsSync(bundledPython)) return bundledPython
  return process.platform === 'win32' ? 'python' : 'python3'
}

export async function openWanGP(): Promise<void> {
  const port = process.env.SERVER_PORT || '7860'
  if (activeWanGPProcess) {
    await shell.openExternal(`http://127.0.0.1:${port}`)
    return
  }

  const wangpRoot = getWanGPRoot()
  const script = path.join(wangpRoot, 'wgp.py')
  if (!fs.existsSync(script)) throw new Error('WanGP GUI entrypoint is missing.')

  const guiArgs = [
    '--open-browser',
    '--config', path.join(app.getPath('userData'), 'wangp_bridge'),
    '--loras', getLorasLocation().path,
  ]
  const pythonArgs = !isDev && process.platform === 'win32'
    ? [
        '-u',
        '-c',
        `import sys; sys.path.insert(0, r"${wangpRoot}"); import runpy; runpy.run_path(r"${script}", run_name="__main__")`,
        ...guiArgs,
      ]
    : ['-u', script, ...guiArgs]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(getWanGPPythonExecutable(), pythonArgs, {
      cwd: wangpRoot,
      env: getRuntimeEnvironment(),
      windowsHide: true,
      stdio: 'ignore',
    })
    activeWanGPProcess = child
    child.once('spawn', resolve)
    child.once('error', (error) => {
      if (activeWanGPProcess === child) activeWanGPProcess = null
      reject(new Error(`WanGP GUI failed to start: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      if (activeWanGPProcess === child) activeWanGPProcess = null
      logger.info(`[WanGP GUI] exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`)
    })
  })
}

export function stopWanGP(): void {
  activeWanGPProcess?.kill('SIGTERM')
  activeWanGPProcess = null
}

function getRuntimeFiles(): string[] {
  const root = isDev ? process.cwd() : process.resourcesPath
  return [
    path.join(root, 'backend', 'uv.lock'),
    path.join(root, 'scripts', 'install-python-dependencies.ps1'),
    path.join(root, 'scripts', 'install-wangp-stack.ps1'),
    path.join(root, 'Wan2GP', '.aivs-wangp-source.json'),
    path.join(root, 'wgp_config.json'),
    path.join(root, 'scripts', 'wangp-stacks.json'),
    path.join(root, 'backend', 'wangp_model_packs.py'),
  ]
}

function getRuntimeHash(): string | null {
  try {
    const hash = crypto.createHash('sha256')
    for (const file of getRuntimeFiles()) {
      hash.update(fs.readFileSync(file))
    }
    return hash.digest('hex')
  } catch (error) {
    logger.error(`[python-setup] Cannot calculate runtime hash: ${error}`)
    return null
  }
}

function getInstalledHashPath(): string {
  return path.join(app.getPath('userData'), 'python', 'deps-hash.txt')
}

function readHash(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim() || null
  } catch {
    return null
  }
}

/** Directory where the first-run Python environment lives. */
export function getPythonDir(): string {
  if (process.platform === 'win32') {
    return isDev ? path.join(process.cwd(), 'python-embed') : path.join(app.getPath('userData'), 'python')
  }
  return path.join(process.resourcesPath, 'python')
}

function findBundledGitExecutable(): string | null {
  if (process.platform !== 'win32') return null
  const root = isDev ? path.join(process.cwd(), 'git-bootstrap') : path.join(process.resourcesPath, 'git')
  const gitExe = path.join(root, 'cmd', 'git.exe')
  return fs.existsSync(gitExe) ? gitExe : null
}

export function getRuntimeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  env.WANGP_ROOT = getWanGPRoot()
  env.AIVS_WANGP_CONFIG_TEMPLATE = path.join(isDev ? process.cwd() : process.resourcesPath, 'wgp_config.json')
  env.WANGP_CHECKPOINTS_DIR = getCheckpointsLocation().path
  env.WANGP_LORAS_DIR = getLorasLocation().path
  const gitExe = findBundledGitExecutable()
  if (!gitExe) {
    if (!isDev && process.platform === 'win32') throw new Error('Bundled Git runtime is missing.')
    return env
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = `${path.dirname(gitExe)}${path.delimiter}${env[pathKey] ?? ''}`
  env.GIT_PYTHON_GIT_EXECUTABLE = gitExe
  return env
}

export function isPythonReady(): { ready: boolean } {
  if (process.platform !== 'win32') return { ready: isWanGPRuntimeReady() }
  if (isDev) return { ready: isWanGPRuntimeReady() }
  const expectedHash = getRuntimeHash()
  const wangpReady = isWanGPRuntimeReady()
  return {
    ready: Boolean(expectedHash) &&
      expectedHash === readHash(getInstalledHashPath()) &&
      fs.existsSync(path.join(getPythonDir(), 'python.exe')) &&
      fs.existsSync(path.join(getPythonDir(), 'Include', 'Python.h')) &&
      fs.existsSync(path.join(getPythonDir(), 'libs', 'python311.lib')) &&
      Boolean(findBundledGitExecutable()) &&
      wangpReady,
  }
}

function copyBootstrap(destDir: string): void {
  const sourceDir = path.join(process.resourcesPath, 'python-bootstrap')
  if (!fs.existsSync(sourceDir)) {
    throw new Error('Bundled Python bootstrap is missing.')
  }
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.cpSync(sourceDir, destDir, { recursive: true })
}

function installDependencies(
  pythonExe: string,
  onProgress: (progress: PythonSetupProgress) => void,
): Promise<void> {
  const script = path.join(process.resourcesPath, 'scripts', 'install-python-dependencies.ps1')
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )

  const stages: Record<number, { percent: number; message: string }> = {
    1: { percent: 12, message: 'Resolving pinned dependencies' },
    2: { percent: 18, message: 'Installing GPU runtime' },
    3: { percent: 58, message: 'Installing application dependencies' },
    4: { percent: 76, message: 'Installing Python headers' },
    5: { percent: 84, message: 'Verifying Python runtime' },
  }

  return new Promise((resolve, reject) => {
    let currentStage = stages[1]
    let currentDetail = 'Starting setup'
    let lastOutputAt = Date.now()
    let stdoutRemainder = ''
    let stderrRemainder = ''
    const errorLines: string[] = []
    const recordErrorLine = (line: string): void => {
      if (!line) return
      errorLines.push(line)
      if (errorLines.length > 80) errorLines.shift()
    }

    const emitProgress = () => onProgress({
      status: 'installing',
      percent: currentStage.percent,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      message: currentStage.message,
      detail: currentDetail,
    })

    const acceptDetail = (value: string): void => {
      const detail = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim()
      if (!detail || /^(?:warning:|futurewarning:|userwarning:)/i.test(detail)) return
      const useful = /^(?:Resolved|Installed|Using Python|Downloading Python|Building)/i.test(detail) ? detail : ''
      if (!useful) return
      currentDetail = useful.slice(0, 180)
      lastOutputAt = Date.now()
      emitProgress()
      logger.info(`[python-setup] ${currentDetail}`)
    }

    const consume = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      const source = stream === 'stdout' ? stdoutRemainder : stderrRemainder
      const parts = (source + chunk.toString()).split(/[\r\n]/)
      const remainder = parts.pop() ?? ''
      if (stream === 'stdout') stdoutRemainder = remainder
      else stderrRemainder = remainder

      for (const rawLine of parts) {
        const line = rawLine.trim()
        const match = /^AIVS_STEP:(\d+):(.+)$/.exec(line)
        if (match) {
          currentStage = stages[Number(match[1])] ?? currentStage
          currentDetail = match[2]
          lastOutputAt = Date.now()
          emitProgress()
          logger.info(`[python-setup] ${match[2]}`)
          continue
        }
        if (stream === 'stderr') recordErrorLine(line)
        acceptDetail(line)
      }
    }

    const child = spawn(
      powershell,
      [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-PythonExe', pythonExe,
        '-ProjectDir', process.resourcesPath,
        '-WanGPRoot', getWanGPRoot(),
      ],
      { windowsHide: true, env: getRuntimeEnvironment() },
    )
    const heartbeat = setInterval(() => {
      if (Date.now() - lastOutputAt < 4_000) return
      currentDetail = `${currentStage.message} — still working; large downloads can take several minutes`
      emitProgress()
    }, 4_000)

    child.stdout.on('data', (chunk: Buffer) => consume(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, 'stderr'))
    child.once('error', (error) => {
      clearInterval(heartbeat)
      reject(new Error(`Python dependency setup failed: ${error.message}`))
    })
    child.once('close', (code) => {
      clearInterval(heartbeat)
      acceptDetail(stdoutRemainder)
      acceptDetail(stderrRemainder)
      if (code === 0) resolve()
      else {
        recordErrorLine(stderrRemainder.trim())
        logger.error(`[python-setup] Installer stderr:\n${errorLines.join('\n')}`)
        const details = errorLines
          .filter((line) => !/^(?:At |\+|~|CategoryInfo|FullyQualifiedErrorId)/.test(line))
          .slice(-12)
          .join(' ')
        reject(new Error(`Python dependency setup failed (exit code ${code ?? 'unknown'}): ${details || errorLines.slice(-12).join(' ')}`))
      }
    })
    emitProgress()
  })
}

function getModelPackStatePath(): string {
  return path.join(app.getPath('userData'), 'model-pack-state.json')
}

function getInstalledModelPackIds(): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(getModelPackStatePath(), 'utf-8')) as { files?: unknown }
    if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) return new Set()
    const wangpRoot = getWanGPRoot()
    const installed = Object.entries(parsed.files).flatMap(([id, files]) => {
      if (!Array.isArray(files) || files.length === 0) return []
      const complete = files.every((file) => {
        if (typeof file !== 'string') return false
        const resolved = path.isAbsolute(file) ? file : path.resolve(wangpRoot, file)
        try {
          return fs.statSync(resolved).isFile()
        } catch {
          return false
        }
      })
      return complete ? [id] : []
    })
    return new Set(installed)
  } catch {
    return new Set()
  }
}

export function getModelPacks(): ModelPack[] {
  const installed = getInstalledModelPackIds()
  return MODEL_PACKS.map((pack) => ({ ...pack, installed: installed.has(pack.id) }))
}

/** Rebuild model-pack state from files already present in the active checkpoint folder. */
export function refreshModelPacks(): Promise<ModelPack[]> {
  if (activeModelPackRefreshPromise) return activeModelPackRefreshPromise
  if (activeModelPackProcess || activeModelPackDeleteProcess) {
    throw new Error('Another model-pack operation is already running.')
  }
  const pythonExe = getWanGPPythonExecutable()
  const runner = path.join(isDev ? process.cwd() : process.resourcesPath, 'backend', 'wangp_model_packs.py')
  const wangpRoot = getWanGPRoot()
  const checkpointsDir = getCheckpointsLocation().path

  activeModelPackRefreshPromise = new Promise((resolve, reject) => {
    let spawnFailed = false
    const diagnosticLines: string[] = []
    const recordDiagnostics = (chunk: Buffer): void => {
      diagnosticLines.push(...chunk.toString().split(/[\r\n]/).filter(Boolean))
      if (diagnosticLines.length > 80) diagnosticLines.splice(0, diagnosticLines.length - 80)
    }
    const child = spawn(
      pythonExe,
      [runner, '--wangp-root', wangpRoot, '--app-data-dir', app.getPath('userData'), '--checkpoints-dir', checkpointsDir, '--list'],
      { windowsHide: true, cwd: wangpRoot, env: getRuntimeEnvironment() },
    )
    activeModelPackRefreshProcess = child
    child.stdout.on('data', recordDiagnostics)
    child.stderr.on('data', recordDiagnostics)
    child.once('error', (error) => {
      spawnFailed = true
      activeModelPackRefreshProcess = null
      activeModelPackRefreshPromise = null
      reject(new Error(`Model-pack refresh failed to start: ${error.message}`))
    })
    child.once('close', (code) => {
      if (spawnFailed) return
      activeModelPackRefreshProcess = null
      activeModelPackRefreshPromise = null
      if (code === 0) {
        resolve(getModelPacks())
        return
      }
      logger.error(`[model-pack] Refresh output:\n${diagnosticLines.join('\n')}`)
      const details = diagnosticLines.slice(-12).join(' ')
      reject(new Error(`Model-pack refresh failed (exit code ${code ?? 'unknown'}): ${details || 'No diagnostic output.'}`))
    })
  })
  return activeModelPackRefreshPromise
}

export function getModelPackProgress(): ModelPackProgress | null {
  return activeModelPackProcess ? activeModelPackProgress : null
}

function parseByteSize(value: string): number {
  const match = /([\d.]+)\s*(B|KB|MB|GB|TB|K|M|G|T)/i.exec(value)
  if (!match) return 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = match[2].toUpperCase()
  const normalized = unit.length === 1 && unit !== 'B' ? `${unit}B` : unit
  return Number(match[1]) * 1024 ** units.indexOf(normalized)
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeTransfer(value: unknown): NonNullable<ModelPackProgress['transfer']> | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.unit !== 'bytes' && data.unit !== 'files') return null
  const current = nonNegativeNumber(data.current)
  if (current === null) return null
  const rawTotal = nonNegativeNumber(data.total)
  const total = rawTotal && rawTotal > 0 ? rawTotal : null
  return {
    phase: optionalText(data.phase),
    source: optionalText(data.source),
    repoId: optionalText(data.repoId),
    filename: optionalText(data.filename),
    unit: data.unit,
    current,
    total,
    percent: total ? Math.max(0, Math.min(100, current / total * 100)) : null,
    speedBps: nonNegativeNumber(data.speedBps),
    etaSeconds: nonNegativeNumber(data.etaSeconds),
    fileIndex: nonNegativeNumber(data.fileIndex),
    fileCount: nonNegativeNumber(data.fileCount),
  }
}

function packProgress(
  status: ModelPackProgress['status'],
  values: Partial<Omit<ModelPackProgress, 'status'>> = {},
): ModelPackProgress {
  return {
    status,
    packId: null,
    packName: null,
    packIndex: null,
    packCount: null,
    message: null,
    transfer: null,
    ...values,
  }
}

function parseTransferProgress(line: string): ModelPackProgress['transfer'] {
  const match = /^(.+?):\s*\[[^\]]*\]\s*([\d.]+)%\s*\(([\d.]+\s*[KMGT]?B)\/([\d.]+\s*[KMGT]?B)\)(?:\s*@\s*([\d.]+\s*[KMGT]?B)\/s)?/i.exec(line.trim())
    ?? /^(.+?):\s*([\d.]+)%\|[^|]*\|\s*([\d.]+\s*[KMGT]?B?)\/([\d.]+\s*[KMGT]?B?)(?:\s*\[[^,\]]*,\s*([\d.]+\s*[KMGT]?B?)\/s)?/i.exec(line.trim())
  if (!match) return null
  return {
    phase: 'downloading',
    source: null,
    repoId: null,
    filename: path.basename(match[1]),
    unit: 'bytes',
    current: parseByteSize(match[3]),
    total: parseByteSize(match[4]),
    percent: Math.max(0, Math.min(100, Number(match[2]))),
    speedBps: match[5] ? parseByteSize(match[5]) : null,
    etaSeconds: null,
    fileIndex: null,
    fileCount: null,
  }
}

/** Run WanGP's downloader in its own process so cancelling never affects the backend. */
export function downloadModelPacks(
  ids: string[],
  onProgress: (progress: ModelPackProgress) => void,
): Promise<boolean> {
  if (!ids.length) return Promise.resolve(true)
  if (activeModelPackProcess || activeModelPackDeleteProcess || activeModelPackRefreshProcess) throw new Error('Another model-pack operation is already running.')
  const pythonExe = getWanGPPythonExecutable()
  const runner = path.join(isDev ? process.cwd() : process.resourcesPath, 'backend', 'wangp_model_packs.py')
  const wangpRoot = getWanGPRoot()
  const checkpointsDir = getCheckpointsLocation().path

  return new Promise((resolve, reject) => {
    let activePack: Pick<ModelPackProgress, 'packId' | 'packName' | 'packIndex' | 'packCount'> = {
      packId: null,
      packName: null,
      packIndex: null,
      packCount: null,
    }
    let cancelled = false
    let spawnFailed = false
    let structuredProgressSeen = false
    let cancelFallback: NodeJS.Timeout | null = null
    const remainders = { stdout: '', stderr: '' }
    const diagnosticLines: string[] = []
    const emitProgress = (progress: ModelPackProgress): void => {
      activeModelPackProgress = progress
      onProgress(progress)
    }
    const recordDiagnostic = (line: string): void => {
      if (!line) return
      diagnosticLines.push(line)
      if (diagnosticLines.length > 80) diagnosticLines.shift()
    }
    const child = spawn(
      pythonExe,
      [runner, '--wangp-root', wangpRoot, '--app-data-dir', app.getPath('userData'), '--checkpoints-dir', checkpointsDir, '--download', ...ids],
      { windowsHide: true, cwd: wangpRoot, env: getRuntimeEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] },
    )
    activeModelPackProcess = child
    child.stdin?.on('error', () => { /* Cancellation owns the terminal state; the fallback handles a closed pipe. */ })
    ;(child as ChildProcess & { aivsCancel?: () => void }).aivsCancel = () => {
      if (cancelled) return
      cancelled = true
      const stdin = child.stdin
      if (stdin?.writable && !stdin.destroyed && !stdin.writableEnded) {
        stdin.end('cancel\n')
      }
      cancelFallback = setTimeout(() => {
        if (activeModelPackProcess === child && !child.killed) child.kill('SIGTERM')
      }, 5_000)
      cancelFallback.unref()
    }
    emitProgress(packProgress('preparing'))
    const consumeLine = (raw: string): void => {
      const line = raw.trim()
      if (!line) return
      const event = /^AIVS_PACK:(.+)$/.exec(line)
      if (event) {
        try {
          const data = JSON.parse(event[1]) as Record<string, unknown>
          const eventName = optionalText(data.event)
          const context = {
            packId: optionalText(data.id) ?? activePack.packId,
            packName: optionalText(data.name) ?? activePack.packName,
            packIndex: nonNegativeNumber(data.packIndex) ?? activePack.packIndex,
            packCount: nonNegativeNumber(data.packCount) ?? activePack.packCount,
          }
          if (eventName === 'pack-start') {
            activePack = context
            emitProgress(packProgress('downloading', activePack))
          } else if (eventName === 'pack-complete') {
            activePack = context
            emitProgress(packProgress('downloading', {
              ...activePack,
              message: `${activePack.packName ?? 'Model pack'} complete`,
            }))
          } else if (eventName === 'transfer') {
            const transfer = normalizeTransfer(data.transfer)
            if (transfer) {
              structuredProgressSeen = true
              activePack = context
              emitProgress(packProgress('downloading', { ...activePack, transfer }))
            }
          } else if (eventName === 'complete') {
            emitProgress(packProgress('complete', { ...activePack, message: 'Download complete' }))
          }
        } catch { /* Ignore malformed third-party output. */ }
        return
      }
      const transfer = structuredProgressSeen ? null : parseTransferProgress(line)
      if (transfer !== null) {
        emitProgress(packProgress('downloading', { ...activePack, transfer }))
        return
      }
      recordDiagnostic(line)
    }
    const consume = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      const lines = (remainders[stream] + chunk.toString()).split(/[\r\n]/)
      remainders[stream] = lines.pop() ?? ''
      for (const line of lines) consumeLine(line)
    }
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, 'stderr'))
    child.once('error', (error) => {
      spawnFailed = true
      if (cancelFallback) clearTimeout(cancelFallback)
      activeModelPackProcess = null
      emitProgress(packProgress('error', { ...activePack, message: error.message }))
      reject(new Error(`Model-pack download failed to start: ${error.message}`))
      activeModelPackProgress = null
    })
    child.once('close', (code) => {
      if (spawnFailed) return
      if (cancelFallback) clearTimeout(cancelFallback)
      activeModelPackProcess = null
      consumeLine(remainders.stdout)
      consumeLine(remainders.stderr)
      if (cancelled) {
        emitProgress(packProgress('cancelled', activePack))
        resolve(false)
        activeModelPackProgress = null
      } else if (code === 0) {
        if (activeModelPackProgress?.status !== 'complete') {
          emitProgress(packProgress('complete', { ...activePack, message: 'Download complete' }))
        }
        resolve(true)
        activeModelPackProgress = null
      } else {
        logger.error(`[model-pack] Downloader output:\n${diagnosticLines.join('\n')}`)
        const details = diagnosticLines.slice(-12).join(' ')
        const message = `Model-pack download failed (exit code ${code ?? 'unknown'}): ${details || 'No diagnostic output.'}`
        emitProgress(packProgress('error', { ...activePack, message }))
        reject(new Error(message))
        activeModelPackProgress = null
      }
    })
  })
}

export function cancelModelPackDownload(): void {
  ;(activeModelPackProcess as (ChildProcess & { aivsCancel?: () => void }) | null)?.aivsCancel?.()
}

export function deleteModelPack(id: string): Promise<void> {
  if (!MODEL_PACKS.some((pack) => pack.id === id)) throw new Error(`Unknown model pack: ${id}`)
  if (activeModelPackProcess || activeModelPackDeleteProcess || activeModelPackRefreshProcess) throw new Error('Another model-pack operation is already running.')
  const pythonExe = getWanGPPythonExecutable()
  const runner = path.join(isDev ? process.cwd() : process.resourcesPath, 'backend', 'wangp_model_packs.py')
  const wangpRoot = getWanGPRoot()
  const checkpointsDir = getCheckpointsLocation().path

  return new Promise((resolve, reject) => {
    let spawnFailed = false
    const diagnosticLines: string[] = []
    const recordDiagnostics = (chunk: Buffer): void => {
      diagnosticLines.push(...chunk.toString().split(/[\r\n]/).filter(Boolean))
      if (diagnosticLines.length > 80) diagnosticLines.splice(0, diagnosticLines.length - 80)
    }
    const child = spawn(
      pythonExe,
      [runner, '--wangp-root', wangpRoot, '--app-data-dir', app.getPath('userData'), '--checkpoints-dir', checkpointsDir, '--delete', id],
      { windowsHide: true, cwd: wangpRoot, env: getRuntimeEnvironment() },
    )
    activeModelPackDeleteProcess = child
    child.stdout.on('data', recordDiagnostics)
    child.stderr.on('data', recordDiagnostics)
    child.once('error', (error) => {
      spawnFailed = true
      activeModelPackDeleteProcess = null
      reject(new Error(`Model-pack deletion failed to start: ${error.message}`))
    })
    child.once('close', (code) => {
      if (spawnFailed) return
      activeModelPackDeleteProcess = null
      if (code === 0) {
        resolve()
        return
      }
      logger.error(`[model-pack] Deleter output:\n${diagnosticLines.join('\n')}`)
      const details = diagnosticLines.slice(-12).join(' ')
      reject(new Error(`Model-pack deletion failed (exit code ${code ?? 'unknown'}): ${details || 'No diagnostic output.'}`))
    })
  })
}

/** Copy bundled Python + uv, then install the pinned WanGP runtime on first run. */
export async function downloadPythonEmbed(
  onProgress: (progress: PythonSetupProgress) => void,
): Promise<void> {
  if (isDev) {
    if (!isWanGPRuntimeReady()) throw new Error(`WanGP source is missing at ${getWanGPRoot()}. Set WANGP_ROOT to your Wan2GP folder.`)
    onProgress({ status: 'complete', percent: 100, downloadedBytes: 0, totalBytes: 0, speed: 0, message: 'WanGP is ready' })
    return
  }
  if (process.platform !== 'win32') {
    prepareBundledWanGP()
    onProgress({ status: 'complete', percent: 100, downloadedBytes: 0, totalBytes: 0, speed: 0, message: 'WanGP is ready' })
    return
  }
  const expectedHash = getRuntimeHash()
  if (!expectedHash) throw new Error('Bundled runtime definition is unavailable.')

  const destDir = getPythonDir()
  try {
    migrateLegacyModelDirectories(path.join(process.resourcesPath, 'Wan2GP'), getRuntimeModelsDir())
    onProgress({ status: 'extracting', percent: 5, downloadedBytes: 0, totalBytes: 0, speed: 0, message: 'Preparing embedded Python' })
    copyBootstrap(destDir)
    onProgress({ status: 'installing', percent: 10, downloadedBytes: 0, totalBytes: 0, speed: 0, message: 'Starting first-time setup' })
    prepareBundledWanGP()
    await installDependencies(path.join(destDir, 'python.exe'), onProgress)
    fs.writeFileSync(getInstalledHashPath(), expectedHash, 'utf-8')
    onProgress({ status: 'complete', percent: 100, downloadedBytes: 0, totalBytes: 0, speed: 0, message: 'WanGP is ready' })
  } catch (error) {
    fs.rmSync(destDir, { recursive: true, force: true })
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`[python-setup] ${message}`)
    onProgress({ status: 'error', percent: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, message: 'Setup failed' })
    throw error
  }
}

function prepareBundledWanGP(): void {
  if (isWanGPRuntimeReady()) return
  const source = path.join(process.resourcesPath, 'Wan2GP')
  if (!isWanGPRoot(source)) throw new Error('Bundled WanGP source is incomplete.')
  const expectedHash = getBundledWanGPHash()
  if (getWanGPSourceHash(source) !== expectedHash) throw new Error('Bundled WanGP source failed its integrity check.')
  const destination = getWanGPRoot()
  if (fs.existsSync(destination)) throw new Error(`WanGP runtime is incomplete at ${destination}. Move that folder aside and retry setup.`)
  const parent = path.dirname(destination)
  fs.mkdirSync(parent, { recursive: true })
  const temporary = fs.mkdtempSync(path.join(parent, '.wangp-copy-'))
  try {
    fs.cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false })
    if (getWanGPSourceHash(temporary) !== expectedHash) throw new Error('WanGP source copy failed its integrity check.')
    fs.renameSync(temporary, destination)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}
