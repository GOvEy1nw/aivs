// @vitest-environment node
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'

const context = vi.hoisted(() => ({ isDev: false, userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => context.userData }, shell: {} }))
vi.mock('./config', () => ({ get isDev() { return context.isDev } }))
vi.mock('./app-state', () => ({}))
vi.mock('./logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))

import { downloadPythonEmbed, getModelPacks, getWanGPRoot, isPythonReady, migrateLegacyModelDirectories } from './python-setup'

const temporaryDirectories: string[] = []

let directory: string
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aivs-wangp-test-'))
  context.userData = path.join(directory, 'user')
  context.isDev = false
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })
  // Exercise the shared source-copy path without installing Windows Python dependencies.
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  Object.defineProperty(process, 'platform', platform)
  if (resources) Object.defineProperty(process, 'resourcesPath', resources)
  else Reflect.deleteProperty(process, 'resourcesPath')
  fs.rmSync(directory, { recursive: true, force: true })
  for (const temporary of temporaryDirectories.splice(0)) fs.rmSync(temporary, { recursive: true, force: true })
})

function bundle(version: string): void {
  const source = path.join(directory, 'Wan2GP')
  fs.mkdirSync(path.join(source, 'shared'), { recursive: true })
  const files = ['wgp.py', 'shared/api.py', 'shared/model_dropdowns.py', 'requirements.txt'].sort()
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    const content = `# native source ${version}`
    fs.writeFileSync(path.join(source, file), content)
    hash.update(`${file}\n`).update(content)
  }
  fs.writeFileSync(path.join(source, '.aivs-wangp-source.json'), JSON.stringify({ schemaVersion: 1, contentHash: hash.digest('hex') }))
}

test('development uses an independent source folder without Git or deployment', () => {
  context.isDev = true
  bundle('a'.repeat(64))
  vi.stubEnv('WANGP_ROOT', path.join(directory, 'Wan2GP'))
  expect(getWanGPRoot()).toBe(path.join(directory, 'Wan2GP'))
  expect(isPythonReady().ready).toBe(true)
  expect(fs.existsSync(context.userData)).toBe(false)
  vi.stubEnv('WANGP_ROOT', '')
  vi.stubEnv('WANGP_WGP_PATH', path.join(directory, 'Wan2GP', 'wgp.py'))
  expect(getWanGPRoot()).toBe(path.join(directory, 'Wan2GP'))
})

test('installed source is copied locally and a new bundle preserves the previous runtime', async () => {
  bundle('a'.repeat(64))
  expect(isPythonReady().ready).toBe(false)
  await downloadPythonEmbed(() => {})
  const previous = getWanGPRoot()
  expect(isPythonReady().ready).toBe(true)
  fs.writeFileSync(path.join(previous, 'user-file.txt'), 'keep')
  await downloadPythonEmbed(() => {})
  expect(fs.readFileSync(path.join(previous, 'user-file.txt'), 'utf8')).toBe('keep')
  bundle('b'.repeat(64))
  await downloadPythonEmbed(() => {})
  expect(getWanGPRoot()).not.toBe(previous)
  expect(fs.readFileSync(path.join(previous, 'user-file.txt'), 'utf8')).toBe('keep')
  expect(fs.readFileSync(path.join(getWanGPRoot(), 'wgp.py'), 'utf8')).toBe(`# native source ${'b'.repeat(64)}`)
  expect(fs.readdirSync(path.dirname(previous)).some((name) => name.startsWith('.wangp-copy-'))).toBe(false)
})

test('an incomplete bundle never becomes the installed runtime', async () => {
  bundle('a'.repeat(64))
  fs.unlinkSync(path.join(directory, 'Wan2GP', 'shared', 'model_dropdowns.py'))
  await expect(downloadPythonEmbed(() => {})).rejects.toThrow('integrity')
  expect(fs.existsSync(getWanGPRoot())).toBe(false)
})

describe('Model Manager catalog', () => {
  it('exposes LTX 2.5 Fast and Quality packs on their curated checkpoints', () => {
    expect(getModelPacks()).toContainEqual({
      id: 'ltx2_fast',
      name: 'LTX 2.5 Fast',
      estimatedSize: '',
      installed: false,
      modelType: 'ltx2_25_22B_distilled',
      groupId: 'ltx2_25',
      groupName: 'LTX 2.5',
      variantName: 'Fast',
      mediaTypes: ['video'],
      features: ['generate', 'reframe'],
    })
    expect(getModelPacks()).toContainEqual({
      id: 'ltx2_quality',
      name: 'LTX 2.5 Quality',
      estimatedSize: '',
      installed: false,
      modelType: 'ltx2_25_22B',
      groupId: 'ltx2_25',
      groupName: 'LTX 2.5',
      variantName: 'Quality',
      mediaTypes: ['video'],
      features: ['generate', 'reframe'],
    })
  })

  it('exposes the backend-owned MMAudio pack', () => {
    expect(getModelPacks()).toContainEqual({
      id: 'mmaudio',
      name: 'MMAudio Sound Effects',
      estimatedSize: '~10.7 GB',
      installed: false,
      modelType: 'mmaudio',
      mediaTypes: ['audio'],
      features: ['generate'],
    })
  })
})

describe('legacy model migration', () => {
  it('moves legacy packaged defaults without overwriting collisions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivs-model-migration-'))
    temporaryDirectories.push(root)
    const legacy = path.join(root, 'legacy')
    const models = path.join(root, 'models')
    fs.mkdirSync(path.join(legacy, 'ckpts', 'nested'), { recursive: true })
    fs.mkdirSync(path.join(legacy, 'loras'), { recursive: true })
    fs.mkdirSync(path.join(models, 'checkpoints'), { recursive: true })
    fs.writeFileSync(path.join(legacy, 'ckpts', 'nested', 'moved.safetensors'), 'legacy')
    fs.writeFileSync(path.join(legacy, 'ckpts', 'collision.safetensors'), 'legacy')
    fs.writeFileSync(path.join(models, 'checkpoints', 'collision.safetensors'), 'new')
    fs.writeFileSync(path.join(legacy, 'loras', 'voice.safetensors'), 'lora')

    migrateLegacyModelDirectories(legacy, models)
    migrateLegacyModelDirectories(legacy, models)

    expect(fs.readFileSync(path.join(models, 'checkpoints', 'nested', 'moved.safetensors'), 'utf8')).toBe('legacy')
    expect(fs.readFileSync(path.join(models, 'checkpoints', 'collision.safetensors'), 'utf8')).toBe('new')
    expect(fs.existsSync(path.join(legacy, 'ckpts', 'collision.safetensors'))).toBe(true)
    expect(fs.readFileSync(path.join(models, 'loras', 'voice.safetensors'), 'utf8')).toBe('lora')
  })

  it('exposes the experimental MiniMax Music 3 pack', () => {
    expect(getModelPacks()).toContainEqual({
      id: 'minimax_music3',
      name: 'MiniMax Music 3',
      estimatedSize: '~15.0 GB',
      installed: false,
      modelType: 'minimax_music3',
      mediaTypes: ['audio'],
      features: ['generate'],
      licenseUrl: 'https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE',
    })
  })
})
