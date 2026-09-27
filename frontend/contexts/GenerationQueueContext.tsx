import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { backendFetch } from '../lib/backend'
import { copyQueuedOutputToAssetFolder } from '../lib/asset-copy'
import { useProjects } from './ProjectContext'
import { useReferenceLibrary } from './ReferenceLibraryContext'
import { DEFAULT_COLOR_CORRECTION, type Asset, type TimelineClip } from '../types/project'
import type { GenerationSettings } from '../types/generation'
import type { DownloadUnit, ModelDownloadProgress } from '../types/progress'
import type {
  ImageSubmissionSnapshot,
  MusicSubmissionSnapshot,
  ReframeSubmissionSnapshot,
  RetakeSubmissionSnapshot,
  SfxSubmissionSnapshot,
  SpeechSubmissionSnapshot,
  VideoSubmissionSnapshot,
} from '../views/genspace/types'
import {
  buildGeneratedImageAsset,
  buildGeneratedMusicAsset,
  buildGeneratedSfxAsset,
  buildGeneratedSpeechAsset,
  buildGeneratedVideoAsset,
  buildReframeAsset,
  buildRetakeAsset,
} from '../views/genspace/logic/generation-assets'
import type { GenerateMusicResult, GenerateSfxResult, GenerateSpeechResult } from '../hooks/generation/types'

export type GenerationQueueStatus = 'queued' | 'running' | 'cancel_requested' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type GenerationQueueKind = 'image.generate' | 'video.generate' | 'audio.music' | 'audio.sfx' | 'audio.speech' | 'media.upscale' | 'video.retake' | 'director.generate'

export interface GenerationQueueJob {
  id: string
  kind: GenerationQueueKind
  status: GenerationQueueStatus
  summary: {
    label: string
    mediaKind: 'image' | 'video' | 'audio'
    operation: string
    promptPreview?: string
    modelLabel?: string
    badges?: string[]
    referenceThumbnailUrl?: string
    variationCount?: number
  }
  progress?: {
    percent?: number | null
    phase?: string | null
    previewUrl?: string | null
    statusDetail?: string | null
    currentStep?: number | null
    totalSteps?: number | null
    phaseIndex?: number | null
    phaseCount?: number | null
    sectionIndex?: number | null
    sectionCount?: number | null
    progressUnit?: DownloadUnit | null
    modelDownload?: ModelDownloadProgress | null
  }
  error?: string | null
  clientContext?: QueueClientContext
  result?: { kind: GenerationQueueKind; response: Record<string, unknown> } | null
}

export function getQueueProgressBadges(progress: GenerationQueueJob['progress']): string[] {
  return [
    typeof progress?.phaseIndex === 'number' && typeof progress.phaseCount === 'number' ? `Phase ${progress.phaseIndex}/${progress.phaseCount}` : null,
    typeof progress?.currentStep === 'number' && typeof progress.totalSteps === 'number' ? `Step ${progress.currentStep}/${progress.totalSteps}` : null,
    typeof progress?.sectionIndex === 'number' && typeof progress.sectionCount === 'number' ? `Section ${progress.sectionIndex}/${progress.sectionCount}` : null,
  ].filter((badge): badge is string => badge !== null)
}

export type QueuePersistenceIntent =
  | { kind: 'reference-library-image'; draftId: string; stagingId: string }
  | { kind: 'image-output'; snapshot: ImageSubmissionSnapshot }
  | { kind: 'video-output'; snapshot: VideoSubmissionSnapshot }
  | { kind: 'reframe-output'; snapshot: ReframeSubmissionSnapshot }
  | { kind: 'music-output'; snapshot: MusicSubmissionSnapshot }
  | { kind: 'sfx-output'; snapshot: SfxSubmissionSnapshot }
  | { kind: 'speech-output'; snapshot: SpeechSubmissionSnapshot }
  | { kind: 'add-take'; parentAssetId: string; mediaKind: 'image'; snapshot: ImageSubmissionSnapshot }
  | { kind: 'add-take'; parentAssetId: string; mediaKind: 'video'; snapshot: VideoSubmissionSnapshot }
  | { kind: 'add-take'; parentAssetId: string; mediaKind?: undefined; snapshot?: undefined }
  | { kind: 'retake-output'; parentAssetId?: string; snapshot: RetakeSubmissionSnapshot; clipIds?: string[]; timelineId?: string }
  | { kind: 'director-output'; timelineId: string; globalPrompt: string; resolutionTier: string; durationFrames: number; fps: number; modelProfileId: string; latestGenerationAssetId?: string }
  | { kind: 'editor-gap-output'; timelineId: string; trackId: string; clipId: string; audioClipId: string; audioTrackId?: string; createAudioTrack?: { id: string; name: string }; startTime: number; endTime: number; mode: 'text-to-video' | 'image-to-video' | 'text-to-image'; prompt: string; settings: GenerationSettings; applyAudio: boolean }
  | { kind: 'editor-regenerate-output'; timelineId: string; parentAssetId: string; clipId?: string }
  | { kind: 'editor-i2v-output'; timelineId: string; clipId: string; prompt: string; settings: GenerationSettings; duration: number }

export type QueueClientContext = {
  schemaVersion: 1
  projectId: string
  intent?: QueuePersistenceIntent
  asset?: {
    type?: 'image' | 'video' | 'audio'
    prompt?: string
    resolution?: string
    duration?: number
    generationParams?: Asset['generationParams']
  }
}

export type GenerationQueueDraft = {
  clientRequestId?: string
  kind: GenerationQueueKind
  payload: Record<string, unknown>
  summary: GenerationQueueJob['summary']
  clientContext: QueueClientContext
}

type QueueSnapshot = {
  revision: number
  runtimeReady: boolean
  acceptingJobs: boolean
  active: GenerationQueueJob | null
  queued: GenerationQueueJob[]
  attention: GenerationQueueJob[]
}

type GenerationQueueContextValue = QueueSnapshot & {
  submit: (draft: GenerationQueueDraft) => Promise<{ jobId: string; duplicate: boolean }>
  reorder: (jobIds: string[]) => Promise<void>
  remove: (jobId: string) => Promise<void>
  cancel: (jobId: string) => Promise<void>
  dismiss: (jobId: string) => Promise<void>
  discard: (jobId: string) => Promise<void>
  refresh: () => Promise<QueueSnapshot>
}

const GenerationQueueContext = createContext<GenerationQueueContextValue | null>(null)
const EMPTY_SNAPSHOT: QueueSnapshot = { revision: 0, runtimeReady: false, acceptingJobs: false, active: null, queued: [], attention: [] }

async function queueError(response: Response, fallback: string): Promise<Error> {
  const body = await response.text()
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown; detail?: unknown }
    for (const value of [parsed.message, parsed.error, parsed.detail]) {
      if (typeof value === 'string' && value) return new Error(value)
    }
  } catch {
    // The backend may return a plain-text error during startup or proxy failure.
  }
  return new Error(body || fallback)
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `generation-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function resultPaths(job: GenerationQueueJob): string[] {
  const response = job.result?.response
  if (!response) return []
  if (job.kind === 'image.generate') {
    const paths = response.image_paths
    if (Array.isArray(paths)) return paths.filter((path): path is string => typeof path === 'string')
    return typeof response.image_path === 'string' ? [response.image_path] : []
  }
  if (job.kind === 'audio.music') {
    const outputs = response.outputs
    return Array.isArray(outputs)
      ? outputs.flatMap((output) => typeof output === 'object' && output && typeof (output as { path?: unknown }).path === 'string' ? [(output as { path: string }).path] : [])
      : []
  }
  for (const key of ['media_path', 'video_path', 'audio_path']) {
    if (typeof response[key] === 'string') return [response[key] as string]
  }
  return []
}

function mediaType(job: GenerationQueueJob): 'image' | 'video' | 'audio' {
  return job.clientContext?.asset?.type ?? (job.kind === 'image.generate' ? 'image' : job.kind.startsWith('audio.') ? 'audio' : 'video')
}

function findProvenance(assets: Asset[], jobId: string, outputIndex: number) {
  for (const asset of assets) {
    if (asset.generationJobId === jobId && asset.generationOutputIndex === outputIndex) return { kind: 'asset' as const, id: asset.id }
    const takeIndex = asset.takes?.findIndex((take) => take.generationJobId === jobId && take.generationOutputIndex === outputIndex) ?? -1
    if (takeIndex >= 0) return { kind: 'take' as const, id: String(takeIndex), parentId: asset.id }
  }
  return undefined
}

type NewAsset = Omit<Asset, 'id' | 'createdAt'>
type PersistenceRef = { kind: 'asset' | 'take' | 'director_document' | 'clip_update' | 'reference_draft'; id: string; parentId?: string }

function withProvenance(asset: NewAsset, jobId: string, outputIndex: number): NewAsset {
  return {
    ...asset,
    generationJobId: jobId,
    generationOutputIndex: outputIndex,
    takes: asset.takes?.map((take) => ({ ...take, generationJobId: jobId, generationOutputIndex: outputIndex })),
  }
}

function buildQueuedAsset(job: GenerationQueueJob, finalPath: string, finalUrl: string, outputIndex: number): NewAsset | null {
  const intent = job.clientContext?.intent
  const response = job.result?.response ?? {}
  const createdAt = Date.now()
  const seed = typeof response.resolvedSeed === 'number' ? response.resolvedSeed + outputIndex : undefined
  if (intent?.kind === 'image-output') return withProvenance(buildGeneratedImageAsset({ snapshot: intent.snapshot, finalPath, finalUrl, createdAt, seed }), job.id, outputIndex)
  if (intent?.kind === 'video-output') return withProvenance(buildGeneratedVideoAsset({ snapshot: intent.snapshot, finalPath, finalUrl, createdAt, seed }), job.id, outputIndex)
  if (intent?.kind === 'reframe-output') return withProvenance(buildReframeAsset({ snapshot: intent.snapshot, finalPath, finalUrl, createdAt }), job.id, outputIndex)
  if (intent?.kind === 'sfx-output') {
    const result: GenerateSfxResult = { audioPath: finalPath, resolvedSeed: typeof response.resolvedSeed === 'number' ? response.resolvedSeed : undefined }
    return withProvenance(buildGeneratedSfxAsset({ snapshot: intent.snapshot, result, finalPath, finalUrl, createdAt }), job.id, outputIndex)
  }
  if (intent?.kind === 'speech-output') {
    const result: GenerateSpeechResult = { audioPath: finalPath, resolvedSeed: typeof response.resolvedSeed === 'number' ? response.resolvedSeed : undefined }
    return withProvenance(buildGeneratedSpeechAsset({ snapshot: intent.snapshot, result, finalPath, finalUrl, createdAt }), job.id, outputIndex)
  }
  if (intent?.kind === 'editor-gap-output') {
    const isImage = intent.mode === 'text-to-image'
    const duration = intent.endTime - intent.startTime
    return withProvenance({
      type: isImage ? 'image' : 'video', path: finalPath, url: finalUrl, prompt: intent.prompt,
      resolution: isImage ? intent.settings.imageResolution : intent.settings.videoResolution,
      duration: isImage ? undefined : duration, source: 'generated',
      generationParams: {
        mode: intent.mode, prompt: intent.prompt, model: intent.settings.model,
        duration: Math.min(Math.max(1, Math.round(duration)), intent.settings.model === 'pro' ? 10 : 20),
        resolution: isImage ? intent.settings.imageResolution : intent.settings.videoResolution,
        fps: intent.settings.fps, audio: intent.settings.audio, cameraMotion: intent.settings.cameraMotion,
        imageAspectRatio: intent.settings.imageAspectRatio, imageSteps: intent.settings.imageSteps,
      },
      takes: [{ url: finalUrl, path: finalPath, createdAt }], activeTakeIndex: 0,
    }, job.id, outputIndex)
  }
  if (intent?.kind === 'editor-i2v-output') {
    return withProvenance({
      type: 'video', path: finalPath, url: finalUrl, prompt: intent.prompt,
      resolution: intent.settings.videoResolution, duration: intent.duration, source: 'generated',
      generationParams: {
        mode: 'image-to-video', prompt: intent.prompt, model: intent.settings.model,
        duration: intent.settings.duration, resolution: intent.settings.videoResolution,
        fps: intent.settings.fps, audio: intent.settings.audio, cameraMotion: intent.settings.cameraMotion,
      },
      takes: [{ url: finalUrl, path: finalPath, createdAt }], activeTakeIndex: 0,
    }, job.id, outputIndex)
  }
  if (intent?.kind === 'retake-output') return withProvenance(buildRetakeAsset({ prompt: intent.snapshot.prompt, duration: intent.snapshot.input.duration, startTime: intent.snapshot.input.startTime, finalPath, finalUrl, createdAt }), job.id, outputIndex)
  if (intent?.kind === 'add-take' && intent.snapshot) {
    if (intent.mediaKind === 'image') return withProvenance(buildGeneratedImageAsset({ snapshot: intent.snapshot, finalPath, finalUrl, createdAt, seed }), job.id, outputIndex)
    return withProvenance(buildGeneratedVideoAsset({ snapshot: intent.snapshot, finalPath, finalUrl, createdAt, seed }), job.id, outputIndex)
  }
  return null
}

export function GenerationQueueProvider({ children }: { children: React.ReactNode }) {
  const { projects, addAsset, addTakeToAsset, updateAsset, updateTimeline, updateDirectorTimeline, awaitProjectPersistence } = useProjects()
  const { publishGeneratedImage } = useReferenceLibrary()
  const projectsRef = useRef(projects)
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT)
  const submitInFlight = useRef(new Map<string, Promise<{ jobId: string; duplicate: boolean }>>())
  const consumeInFlight = useRef(new Map<string, Promise<boolean>>())

  useEffect(() => { projectsRef.current = projects }, [projects])

  const detail = useCallback(async (jobId: string) => {
    const response = await backendFetch(`/api/generation/jobs/${jobId}`)
    if (!response.ok) throw await queueError(response, 'Unable to load generation job')
    return await response.json() as GenerationQueueJob
  }, [])

  const linkPersistedOutput = useCallback((job: GenerationQueueJob, persisted: PersistenceRef, newlyPersistedAsset?: Asset): PersistenceRef[] => {
    const intent = job.clientContext?.intent
    const projectId = job.clientContext?.projectId
    if (!intent || !projectId) return []
    const project = projectsRef.current.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error('The originating project is no longer available')
    const assetId = persisted.kind === 'asset' ? persisted.id : persisted.parentId
    const asset = newlyPersistedAsset ?? (assetId ? project.assets.find((candidate) => candidate.id === assetId) : undefined)
    const takeIndex = persisted.kind === 'take' ? Number(persisted.id) : 0

    if (intent.kind === 'director-output') {
      const document = project.directorTimelines?.find((candidate) => candidate.id === intent.timelineId)
      if (!document || !asset) throw new Error('The originating Director document or output asset is no longer available')
      updateAsset(projectId, asset.id, {
        prompt: intent.globalPrompt,
        resolution: intent.resolutionTier,
        duration: (intent.durationFrames - 1) / intent.fps,
        directorGeneration: {
          schemaVersion: 1,
          timelineId: intent.timelineId,
          compiledPrompt: typeof job.result?.response.compiledPrompt === 'string' ? job.result.response.compiledPrompt : intent.globalPrompt,
          resolvedFrameCount: typeof job.result?.response.resolvedFrameCount === 'number' ? job.result.response.resolvedFrameCount : intent.durationFrames,
          modelProfileId: intent.modelProfileId,
          generatedAt: Date.now(),
        },
      })
      updateDirectorTimeline(projectId, intent.timelineId, { ...document.sequence, latestGenerationAssetId: asset.id, latestGenerationVisible: true, latestGenerationTakeIndex: takeIndex, updatedAt: Date.now() })
      return [{ kind: 'director_document', id: intent.timelineId }]
    }

    if (intent.kind === 'editor-gap-output') {
      if (!asset) throw new Error('The queued gap output asset is no longer available')
      const timeline = project.timelines.find((candidate) => candidate.id === intent.timelineId)
      if (!timeline) throw new Error('The originating editor timeline is no longer available')
      const tracks = [...timeline.tracks]
      const targetTrackIndex = tracks.findIndex((track) => track.id === intent.trackId)
      if (targetTrackIndex < 0) throw new Error('The target editor track is no longer available')
      let audioTrackIndex = intent.audioTrackId ? tracks.findIndex((track) => track.id === intent.audioTrackId) : -1
      if (intent.createAudioTrack && audioTrackIndex < 0) {
        tracks.push({ id: intent.createAudioTrack.id, name: intent.createAudioTrack.name, muted: false, locked: false, kind: 'audio' })
        audioTrackIndex = tracks.length - 1
      }
      const duration = intent.endTime - intent.startTime
      const shouldCreateAudio = intent.mode !== 'text-to-image' && intent.applyAudio && intent.settings.audio && audioTrackIndex >= 0
      const clip: TimelineClip = {
        id: intent.clipId, assetId: asset.id, type: intent.mode === 'text-to-image' ? 'image' : 'video',
        startTime: intent.startTime, duration, trimStart: 0, trimEnd: 0, speed: 1, reversed: false,
        muted: false, volume: 1, trackIndex: targetTrackIndex, asset, flipH: false, flipV: false,
        transitionIn: { type: 'none', duration: 0 }, transitionOut: { type: 'none', duration: 0 },
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION }, opacity: 100,
        ...(shouldCreateAudio ? { linkedClipIds: [intent.audioClipId] } : {}),
      }
      const audioClip: TimelineClip | null = shouldCreateAudio ? {
        ...clip, id: intent.audioClipId, type: 'audio', trackIndex: audioTrackIndex, linkedClipIds: [intent.clipId],
      } : null
      const added = [clip, ...(audioClip ? [audioClip] : [])]
      const clips = [...timeline.clips.filter((candidate) => !added.some((item) => item.id === candidate.id)), ...added]
      updateTimeline(projectId, intent.timelineId, { tracks, clips })
      return added.map((item) => ({ kind: 'clip_update' as const, id: item.id, parentId: intent.timelineId }))
    }

    if (intent.kind === 'editor-regenerate-output') {
      if (persisted.kind !== 'take') throw new Error('Editor regeneration did not persist as a take')
      if (!intent.clipId) return []
      const timeline = project.timelines.find((candidate) => candidate.id === intent.timelineId)
      if (!timeline) throw new Error('The originating editor timeline is no longer available')
      updateTimeline(projectId, intent.timelineId, { clips: timeline.clips.map((clip) => clip.id === intent.clipId ? { ...clip, isRegenerating: false, takeIndex } : clip) })
      return [{ kind: 'clip_update', id: intent.clipId, parentId: intent.timelineId }]
    }

    if (intent.kind === 'editor-i2v-output') {
      if (!asset) throw new Error('The queued image-to-video output asset is no longer available')
      const timeline = project.timelines.find((candidate) => candidate.id === intent.timelineId)
      if (!timeline) throw new Error('The originating editor timeline is no longer available')
      updateTimeline(projectId, intent.timelineId, { clips: timeline.clips.map((clip) => clip.id === intent.clipId ? { ...clip, assetId: asset.id, type: 'video', asset } : clip) })
      return [{ kind: 'clip_update', id: intent.clipId, parentId: intent.timelineId }]
    }

    if (intent.kind === 'retake-output' && intent.clipIds?.length && persisted.kind === 'take') {
      const clipIds = new Set(intent.clipIds)
      for (const timeline of project.timelines) {
        if (!timeline.clips.some((clip) => clipIds.has(clip.id))) continue
        updateTimeline(projectId, timeline.id, { clips: timeline.clips.map((clip) => clipIds.has(clip.id) && clip.assetId === assetId ? { ...clip, takeIndex } : clip) })
      }
      return intent.clipIds.map((id) => ({ kind: 'clip_update' as const, id }))
    }
    return []
  }, [updateAsset, updateDirectorTimeline, updateTimeline])

  const consume = useCallback((jobId: string) => {
    const existing = consumeInFlight.current.get(jobId)
    if (existing) return existing
    const work = (async () => {
      const job = await detail(jobId)
      if (job.status !== 'completed' || !job.result || !job.clientContext) return false
      const projectId = job.clientContext.projectId
      const intent = job.clientContext.intent
      if (intent?.kind === 'reference-library-image') {
        const paths = resultPaths(job)
        if (paths.length !== 1) throw new Error('Reference image generation did not return exactly one image')
        const staged = await window.electronAPI.stageGeneratedReferenceImage(paths[0], intent.stagingId)
        await publishGeneratedImage(intent.draftId, staged)
        const acknowledgement = await backendFetch(`/api/generation/jobs/${job.id}/acknowledge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consumer: 'electron-reference-library-persistence', projectId, persistedAt: new Date().toISOString(), outputs: [{ outputIndex: 0, refs: [{ kind: 'reference_draft', id: intent.draftId }] }] }),
        })
        if (!acknowledgement.ok) throw await queueError(acknowledgement, 'Unable to acknowledge staged reference image')
        return true
      }
      const project = projectsRef.current.find((candidate) => candidate.id === projectId)
      if (!project) return false
      const paths = resultPaths(job)
      const refs: { outputIndex: number; refs: PersistenceRef[] }[] = []
      if (job.clientContext.intent?.kind === 'music-output') {
        const persistedRefs = paths.map((_, outputIndex) => findProvenance(project.assets, job.id, outputIndex))
        if (persistedRefs.every((ref) => ref !== undefined)) {
          persistedRefs.forEach((ref, outputIndex) => refs.push({ outputIndex, refs: [ref!] }))
        } else {
          if (persistedRefs.some((ref) => ref !== undefined)) throw new Error('Completed music result was only partially persisted')
          const response = job.result.response as unknown as GenerateMusicResult
          const takes = []
          for (const [outputIndex, sourcePath] of paths.entries()) {
            const copied = await copyQueuedOutputToAssetFolder(sourcePath, projectId)
            if (!copied) throw new Error('Could not copy completed music output into its submitted project')
            const output = response.outputs[outputIndex]
            takes.push({
              path: copied.path,
              url: copied.url,
              createdAt: Date.now(),
              duration: output?.durationSeconds,
              seed: output?.seed,
              variationIndex: output?.variationIndex,
              generationJobId: job.id,
              generationOutputIndex: outputIndex,
            })
          }
          const built = buildGeneratedMusicAsset({ snapshot: job.clientContext.intent.snapshot, result: response, takes })
          if (!built) throw new Error('Music generation did not return any outputs')
          const asset = addAsset(projectId, { ...built, generationJobId: job.id, generationOutputIndex: 0 })
          paths.forEach((_, outputIndex) => refs.push({ outputIndex, refs: [{ kind: 'take', id: String(outputIndex), parentId: asset.id }] }))
        }
      }
      for (const [outputIndex, sourcePath] of job.clientContext.intent?.kind === 'music-output' ? [] : paths.entries()) {
        const currentProject = projectsRef.current.find((candidate) => candidate.id === projectId)
        const persisted = findProvenance(currentProject?.assets ?? [], job.id, outputIndex)
        if (persisted) {
          refs.push({ outputIndex, refs: [persisted, ...linkPersistedOutput(job, persisted)] })
          continue
        }
        const copied = await copyQueuedOutputToAssetFolder(sourcePath, projectId)
        if (!copied) throw new Error('Could not copy completed output into its submitted project')
        const latestProject = projectsRef.current.find((candidate) => candidate.id === projectId)
        if (!latestProject) return false
        const metadata = job.clientContext.asset
        if (job.clientContext.intent?.kind === 'director-output') {
          const intent = job.clientContext.intent
          const directorDocument = latestProject.directorTimelines?.find((document) => document.id === intent.timelineId)
          if (!directorDocument) throw new Error('The originating Director document is no longer available')
          const directorMetadata = {
            schemaVersion: 1 as const,
            timelineId: intent.timelineId,
            compiledPrompt: typeof job.result.response.compiledPrompt === 'string' ? job.result.response.compiledPrompt : intent.globalPrompt,
            resolvedFrameCount: typeof job.result.response.resolvedFrameCount === 'number' ? job.result.response.resolvedFrameCount : intent.durationFrames,
            modelProfileId: intent.modelProfileId,
            generatedAt: Date.now(),
          }
          const existing = intent.latestGenerationAssetId
            ? latestProject.assets.find((asset) => asset.id === intent.latestGenerationAssetId && asset.type === 'video')
            : undefined
          if (existing) {
            const takeIndex = existing.takes?.length ?? 1
            addTakeToAsset(projectId, existing.id, { url: copied.url, path: copied.path, createdAt: Date.now(), generationJobId: job.id, generationOutputIndex: outputIndex })
            updateAsset(projectId, existing.id, { prompt: intent.globalPrompt, resolution: intent.resolutionTier, duration: (intent.durationFrames - 1) / intent.fps, directorGeneration: directorMetadata })
            updateDirectorTimeline(projectId, intent.timelineId, { ...directorDocument.sequence, latestGenerationVisible: true, latestGenerationTakeIndex: takeIndex, updatedAt: Date.now() })
            refs.push({ outputIndex, refs: [{ kind: 'take', id: String(takeIndex), parentId: existing.id }, { kind: 'director_document', id: intent.timelineId }] })
          } else {
            const asset = addAsset(projectId, { type: 'video', path: copied.path, url: copied.url, prompt: intent.globalPrompt, resolution: intent.resolutionTier, duration: (intent.durationFrames - 1) / intent.fps, source: 'generated', directorGeneration: directorMetadata, generationJobId: job.id, generationOutputIndex: outputIndex, takes: [{ url: copied.url, path: copied.path, createdAt: Date.now(), generationJobId: job.id, generationOutputIndex: outputIndex }], activeTakeIndex: 0 })
            updateDirectorTimeline(projectId, intent.timelineId, { ...directorDocument.sequence, latestGenerationAssetId: asset.id, latestGenerationVisible: true, latestGenerationTakeIndex: 0, updatedAt: Date.now() })
            refs.push({ outputIndex, refs: [{ kind: 'asset', id: asset.id }, { kind: 'director_document', id: intent.timelineId }] })
          }
          continue
        }
        const takeParentId = job.clientContext.intent?.kind === 'add-take'
          ? job.clientContext.intent.parentAssetId
          : job.clientContext.intent?.kind === 'retake-output'
            ? job.clientContext.intent.parentAssetId
            : job.clientContext.intent?.kind === 'editor-regenerate-output'
              ? job.clientContext.intent.parentAssetId
            : undefined
        if (takeParentId) {
          const parent = latestProject.assets.find((asset) => asset.id === takeParentId)
          if (!parent) throw new Error('The originating asset is no longer available for this completed generation')
          const takeIndex = parent.takes?.length ?? 1
          const output = buildQueuedAsset(job, copied.path, copied.url, outputIndex)
          addTakeToAsset(projectId, parent.id, {
            ...(output?.takes?.[0] ?? { url: copied.url, path: copied.path, createdAt: Date.now() }),
            prompt: output?.prompt ?? metadata?.prompt,
            resolution: output?.resolution ?? metadata?.resolution,
            duration: output?.duration ?? metadata?.duration,
            generationParams: output?.generationParams ?? metadata?.generationParams,
            generationJobId: job.id,
            generationOutputIndex: outputIndex,
          })
          const persistedTake = { kind: 'take' as const, id: String(takeIndex), parentId: parent.id }
          refs.push({ outputIndex, refs: [persistedTake, ...linkPersistedOutput(job, persistedTake)] })
          continue
        }
        const built = buildQueuedAsset(job, copied.path, copied.url, outputIndex)
        const asset = addAsset(projectId, built ?? {
          type: mediaType(job), path: copied.path, url: copied.url,
          prompt: metadata?.prompt ?? '', resolution: metadata?.resolution ?? '', duration: metadata?.duration,
          source: 'generated', generationParams: metadata?.generationParams,
          generationJobId: job.id, generationOutputIndex: outputIndex,
          takes: [{ url: copied.url, path: copied.path, createdAt: Date.now(), generationJobId: job.id, generationOutputIndex: outputIndex }], activeTakeIndex: 0,
        })
        const persistedAsset = { kind: 'asset' as const, id: asset.id }
        refs.push({ outputIndex, refs: [persistedAsset, ...linkPersistedOutput(job, persistedAsset, asset)] })
      }
      if (refs.length !== paths.length) return false
      await awaitProjectPersistence(projectId)
      const acknowledgement = await backendFetch(`/api/generation/jobs/${job.id}/acknowledge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumer: 'electron-project-persistence', projectId, persistedAt: new Date().toISOString(), outputs: refs }),
      })
      if (!acknowledgement.ok) throw await queueError(acknowledgement, 'Unable to acknowledge persisted generation')
      return true
    })().finally(() => consumeInFlight.current.delete(jobId))
    consumeInFlight.current.set(jobId, work)
    return work
  }, [addAsset, addTakeToAsset, awaitProjectPersistence, detail, linkPersistedOutput, publishGeneratedImage, updateAsset, updateDirectorTimeline])

  const refresh = useCallback(async () => {
    const response = await backendFetch('/api/generation/queue')
    if (!response.ok) throw await queueError(response, 'Unable to load generation queue')
    const next = await response.json() as QueueSnapshot
    setSnapshot(next)
    next.attention.filter((job) => job.status === 'completed').forEach((job) => { void consume(job.id).then((acknowledged) => { if (acknowledged) void refresh() }, () => undefined) })
    return next
  }, [consume])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      let delay = 5000
      try {
        const next = await refresh()
        delay = next.active || next.queued.length ? 500 : next.attention.length ? 2000 : 5000
      } catch {
        // Reconnect polling remains deliberately quiet while the backend is unavailable.
      }
      if (!cancelled) timer = window.setTimeout(() => { void poll() }, delay)
    }
    void poll()
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer) }
  }, [refresh])

  const submit = useCallback((draft: GenerationQueueDraft) => {
    const safeDraft = jsonClone(draft)
    const clientRequestId = safeDraft.clientRequestId ?? requestId()
    const pending = submitInFlight.current.get(clientRequestId)
    if (pending) return pending
    const work = (async () => {
      const response = await backendFetch('/api/generation/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, clientRequestId, job: { kind: safeDraft.kind, payload: safeDraft.payload }, summary: safeDraft.summary, clientContext: safeDraft.clientContext }),
      })
      if (!response.ok) throw await queueError(response, 'Unable to queue generation')
      const admission = await response.json() as { jobId: string; duplicate: boolean }
      await refresh()
      return admission
    })().finally(() => submitInFlight.current.delete(clientRequestId))
    submitInFlight.current.set(clientRequestId, work)
    return work
  }, [refresh])

  const action = useCallback(async (path: string, init: RequestInit) => {
    const response = await backendFetch(path, init)
    if (!response.ok) throw await queueError(response, 'Unable to update generation queue')
    await refresh()
  }, [refresh])
  const reorder = useCallback(async (jobIds: string[]) => action('/api/generation/queue/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: snapshot.revision, jobIds }) }), [action, snapshot.revision])
  const remove = useCallback(async (jobId: string) => action(`/api/generation/jobs/${jobId}`, { method: 'DELETE' }), [action])
  const cancel = useCallback(async (jobId: string) => action(`/api/generation/jobs/${jobId}/cancel`, { method: 'POST' }), [action])
  const dismiss = useCallback(async (jobId: string) => action(`/api/generation/jobs/${jobId}/dismiss`, { method: 'POST' }), [action])
  const discard = useCallback(async (jobId: string) => action(`/api/generation/jobs/${jobId}/discard`, { method: 'POST' }), [action])

  const value = useMemo(() => ({ ...snapshot, submit, reorder, remove, cancel, dismiss, discard, refresh }), [cancel, discard, dismiss, refresh, remove, reorder, snapshot, submit])
  return <GenerationQueueContext.Provider value={value}>{children}</GenerationQueueContext.Provider>
}

export function useGenerationQueue() {
  const context = useContext(GenerationQueueContext)
  if (!context) throw new Error('useGenerationQueue must be used within GenerationQueueProvider')
  return context
}

export function useOptionalGenerationQueue() {
  return useContext(GenerationQueueContext)
}
