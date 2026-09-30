import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerationQueueProvider, useGenerationQueue } from './GenerationQueueContext'
import { resetBackendCredentials } from '../lib/backend'
import { copyQueuedOutputToAssetFolder } from '../lib/asset-copy'
import type { Project } from '../types/project'

const projects = { projects: [] as Project[], addAsset: vi.fn(), addTakeToAsset: vi.fn(), updateAsset: vi.fn(), updateTimeline: vi.fn(), updateDirectorTimeline: vi.fn(), awaitProjectPersistence: vi.fn() }
const referenceLibrary = { publishGeneratedImage: vi.fn() }
vi.mock('./ProjectContext', () => ({ useProjects: () => projects }))
vi.mock('./ReferenceLibraryContext', () => ({ useReferenceLibrary: () => referenceLibrary }))
vi.mock('../lib/asset-copy', () => ({ copyQueuedOutputToAssetFolder: vi.fn() }))

const fetchMock = vi.fn()
const queue = { revision: 4, runtimeReady: true, acceptingJobs: true, active: null, queued: [], attention: [] }

beforeEach(() => {
  resetBackendCredentials()
  projects.projects = []
  for (const mock of [projects.addAsset, projects.addTakeToAsset, projects.updateAsset, projects.updateTimeline, projects.updateDirectorTimeline, projects.awaitProjectPersistence]) mock.mockReset()
  projects.awaitProjectPersistence.mockResolvedValue(undefined)
  referenceLibrary.publishGeneratedImage.mockReset()
  vi.mocked(copyQueuedOutputToAssetFolder).mockReset()
  Object.assign(window, { electronAPI: { getBackend: vi.fn().mockResolvedValue({ url: 'http://queue.test', token: '' }) } })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals() })

describe('GenerationQueueProvider', () => {
  it('deduplicates concurrent admissions with the same client request id', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify(queue), { status: 200 })
      if (url.endsWith('/api/generation/jobs')) return new Response(JSON.stringify({ jobId: 'job-1', duplicate: false }), { status: 202 })
      throw new Error(`Unexpected request ${url}`)
    })
    const { result, unmount } = renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })
    await waitFor(() => expect(result.current.runtimeReady).toBe(true))
    const draft = { clientRequestId: 'same', kind: 'image.generate' as const, payload: { prompt: 'image' }, summary: { label: 'Image', mediaKind: 'image' as const, operation: 'image.generate' }, clientContext: { schemaVersion: 1 as const, projectId: 'project' } }

    await act(async () => {
      await Promise.all([result.current.submit(draft), result.current.submit(draft)])
    })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/generation/jobs'))).toHaveLength(1)
    unmount()
  })

  it('keeps an admitted job when its immediate queue refresh fails', async () => {
    let queueLoads = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) {
        queueLoads += 1
        if (queueLoads > 1) throw new Error('refresh unavailable')
        return new Response(JSON.stringify(queue), { status: 200 })
      }
      if (url.endsWith('/api/generation/jobs')) return new Response(JSON.stringify({ jobId: 'job-accepted', duplicate: false }), { status: 202 })
      throw new Error(`Unexpected request ${url}`)
    })
    const { result, unmount } = renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })
    await waitFor(() => expect(result.current.runtimeReady).toBe(true))

    const admission = await result.current.submit({ clientRequestId: 'accepted', kind: 'image.generate', payload: { prompt: 'image' }, summary: { label: 'Image', mediaKind: 'image', operation: 'image.generate' }, clientContext: { schemaVersion: 1, projectId: 'project' } })

    expect(admission).toEqual({ jobId: 'job-accepted', duplicate: false })
    unmount()
  })

  it('persists a queued retake as a provenance-tagged take before acknowledgement', async () => {
    projects.projects = [{ id: 'project', name: 'Project', createdAt: 1, updatedAt: 1, timelines: [], assets: [{ id: 'asset-1', type: 'video', path: 'C:\\source.mp4', url: 'file:///C:/source.mp4', prompt: '', resolution: '', createdAt: 1 }] }]
    const addTake = vi.mocked(projects.addTakeToAsset)
    addTake.mockImplementation((_projectId, assetId, take) => {
      const asset = projects.projects[0].assets.find((candidate) => candidate.id === assetId)!
      asset.takes = [...(asset.takes ?? [{ url: asset.url, path: asset.path, createdAt: asset.createdAt }]), take]
    })
    vi.mocked(copyQueuedOutputToAssetFolder).mockResolvedValue({ path: 'C:\\project\\retake.mp4', url: 'file:///C:/project/retake.mp4' })
    let acknowledged = false
    let resolvePersistence!: () => void
    projects.awaitProjectPersistence.mockReturnValueOnce(new Promise<void>((resolve) => { resolvePersistence = resolve }))
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify({
        ...queue,
        attention: acknowledged ? [] : [{
          id: 'job-1', kind: 'video.retake', status: 'completed',
          summary: { label: 'Retake', mediaKind: 'video', operation: 'video.retake' },
        }],
      }), { status: 200 })
      if (url.endsWith('/api/generation/jobs/job-1')) return new Response(JSON.stringify({ id: 'job-1', kind: 'video.retake', status: 'completed', summary: { label: 'Retake', mediaKind: 'video', operation: 'video.retake' }, clientContext: { schemaVersion: 1, projectId: 'project', intent: { kind: 'add-take', parentAssetId: 'asset-1' } }, result: { kind: 'video.retake', response: { video_path: 'C:\\staging\\retake.mp4' } } }), { status: 200 })
      if (url.endsWith('/acknowledge')) { acknowledged = true; return new Response(JSON.stringify({ id: 'job-1' }), { status: 200 }) }
      throw new Error(`Unexpected request ${url}`)
    })
    renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })
    await waitFor(() => expect(addTake).toHaveBeenCalledWith('project', 'asset-1', expect.objectContaining({ generationJobId: 'job-1', generationOutputIndex: 0 })))
    expect(acknowledged).toBe(false)
    resolvePersistence()
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/acknowledge'))).toBe(true))
  })

  it('updates the originating Director document after persisting its output asset', async () => {
    projects.projects = [{ id: 'project', name: 'Project', createdAt: 1, updatedAt: 1, timelines: [], assets: [], directorTimelines: [{ id: 'director-1', name: 'Director', createdAt: 1, updatedAt: 1, sequence: { schemaVersion: 1, globalPrompt: 'old', output: { modelProfileId: 'ltx', resolutionTier: '540p', aspectRatio: '16:9', fps: 24, requestedDurationSeconds: 5, durationFrames: 121, generateAudio: true }, promptSegments: [], updatedAt: 1 } }] }]
    projects.addAsset.mockImplementation((_projectId, asset) => ({ id: 'director-asset', createdAt: 2, ...asset }))
    vi.mocked(copyQueuedOutputToAssetFolder).mockResolvedValue({ path: 'C:\\project\\director.mp4', url: 'file:///C:/project/director.mp4' })
    let acknowledged = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify({ ...queue, attention: acknowledged ? [] : [{ id: 'director-job', kind: 'director.generate', status: 'completed', summary: { label: 'Director', mediaKind: 'video', operation: 'director.generate' } }] }), { status: 200 })
      if (url.endsWith('/api/generation/jobs/director-job')) return new Response(JSON.stringify({ id: 'director-job', kind: 'director.generate', status: 'completed', summary: { label: 'Director', mediaKind: 'video', operation: 'director.generate' }, clientContext: { schemaVersion: 1, projectId: 'project', intent: { kind: 'director-output', timelineId: 'director-1', globalPrompt: 'scene', resolutionTier: '540p', durationFrames: 121, fps: 24, modelProfileId: 'ltx' } }, result: { kind: 'director.generate', response: { video_path: 'C:\\staging\\director.mp4' } } }), { status: 200 })
      if (url.endsWith('/acknowledge')) { acknowledged = true; return new Response('{}', { status: 200 }) }
      throw new Error(`Unexpected request ${url}`)
    })
    renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })
    await waitFor(() => expect(projects.updateDirectorTimeline).toHaveBeenCalledWith('project', 'director-1', expect.objectContaining({ latestGenerationAssetId: 'director-asset', latestGenerationVisible: true })))
    await waitFor(() => expect(acknowledged).toBe(true))
  })

  it('replays a Director document update from provenance before acknowledging a retry', async () => {
    projects.projects = [{
      id: 'project', name: 'Project', createdAt: 1, updatedAt: 1, timelines: [],
      assets: [{ id: 'director-asset', type: 'video', path: 'C:\\project\\director.mp4', url: 'file:///C:/project/director.mp4', prompt: 'scene', resolution: '540p', createdAt: 2, generationJobId: 'director-job', generationOutputIndex: 0 }],
      directorTimelines: [{ id: 'director-1', name: 'Director', createdAt: 1, updatedAt: 1, sequence: { schemaVersion: 1, globalPrompt: 'old', output: { modelProfileId: 'ltx', resolutionTier: '540p', aspectRatio: '16:9', fps: 24, requestedDurationSeconds: 5, durationFrames: 121, generateAudio: true }, promptSegments: [], updatedAt: 1 } }],
    }]
    let acknowledged = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify({ ...queue, attention: acknowledged ? [] : [{ id: 'director-job', kind: 'director.generate', status: 'completed', summary: { label: 'Director', mediaKind: 'video', operation: 'director.generate' } }] }), { status: 200 })
      if (url.endsWith('/api/generation/jobs/director-job')) return new Response(JSON.stringify({ id: 'director-job', kind: 'director.generate', status: 'completed', summary: { label: 'Director', mediaKind: 'video', operation: 'director.generate' }, clientContext: { schemaVersion: 1, projectId: 'project', intent: { kind: 'director-output', timelineId: 'director-1', globalPrompt: 'scene', resolutionTier: '540p', durationFrames: 121, fps: 24, modelProfileId: 'ltx' } }, result: { kind: 'director.generate', response: { video_path: 'C:\\staging\\director.mp4' } } }), { status: 200 })
      if (url.endsWith('/acknowledge')) { acknowledged = true; return new Response('{}', { status: 200 }) }
      throw new Error(`Unexpected request ${url}`)
    })
    renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })
    await waitFor(() => expect(projects.updateDirectorTimeline).toHaveBeenCalledWith('project', 'director-1', expect.objectContaining({ latestGenerationAssetId: 'director-asset', latestGenerationVisible: true })))
    expect(copyQueuedOutputToAssetFolder).not.toHaveBeenCalled()
    await waitFor(() => expect(acknowledged).toBe(true))
  })

  it('leaves a deleted project job recoverable without immediately refetching it', async () => {
    let detailCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify({ ...queue, attention: [{ id: 'orphan-job', kind: 'image.generate', status: 'completed', summary: { label: 'Image', mediaKind: 'image', operation: 'image.generate' } }] }), { status: 200 })
      if (url.endsWith('/api/generation/jobs/orphan-job')) {
        detailCalls += 1
        return new Response(JSON.stringify({ id: 'orphan-job', kind: 'image.generate', status: 'completed', summary: { label: 'Image', mediaKind: 'image', operation: 'image.generate' }, clientContext: { schemaVersion: 1, projectId: 'deleted-project' }, result: { kind: 'image.generate', response: { image_path: 'C:\\staging\\image.png' } } }), { status: 200 })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })
    await waitFor(() => expect(detailCalls).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(detailCalls).toBe(1)
  })

  it('stages a completed global reference image without creating a project asset', async () => {
    let acknowledged = false
    Object.assign(window, { electronAPI: {
      getBackend: vi.fn().mockResolvedValue({ url: 'http://queue.test', token: '' }),
      stageGeneratedReferenceImage: vi.fn().mockResolvedValue({ path: 'C:\\references\\staging\\draft.png', url: 'file:///C:/references/staging/draft.png', fileName: 'draft.png' }),
    } })
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify({ ...queue, attention: acknowledged ? [] : [{ id: 'reference-job', kind: 'image.generate', status: 'completed', summary: { label: 'Reference image', mediaKind: 'image', operation: 'reference-library-image' } }] }), { status: 200 })
      if (url.endsWith('/api/generation/jobs/reference-job')) return new Response(JSON.stringify({ id: 'reference-job', kind: 'image.generate', status: 'completed', summary: { label: 'Reference image', mediaKind: 'image', operation: 'reference-library-image' }, clientContext: { schemaVersion: 1, projectId: 'reference-library', intent: { kind: 'reference-library-image', draftId: 'draft-1', stagingId: 'generation-1' } }, result: { kind: 'image.generate', response: { image_path: 'C:\\outputs\\reference.png' } } }), { status: 200 })
      if (url.endsWith('/acknowledge')) { acknowledged = true; return new Response('{}', { status: 200 }) }
      throw new Error(`Unexpected request ${url}`)
    })

    renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })

    await waitFor(() => expect(referenceLibrary.publishGeneratedImage).toHaveBeenCalledWith('draft-1', expect.objectContaining({ path: 'C:\\references\\staging\\draft.png' })))
    expect(window.electronAPI.stageGeneratedReferenceImage).toHaveBeenCalledWith('C:\\outputs\\reference.png', 'generation-1')
    expect(projects.addAsset).not.toHaveBeenCalled()
    await waitFor(() => expect(acknowledged).toBe(true))
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/acknowledge'))?.[1]).toEqual(expect.objectContaining({ body: expect.stringContaining('electron-reference-library-persistence') }))
  })

  it('persists an editor gap into the submitted project and timeline', async () => {
    const submitted: Project = { id: 'submitted', name: 'Submitted', createdAt: 1, updatedAt: 1, assets: [], timelines: [{ id: 'timeline-1', name: 'Timeline', createdAt: 1, tracks: [{ id: 'track-1', name: 'V1', muted: false, locked: false, kind: 'video' }], clips: [], subtitles: [] }] }
    projects.projects = [submitted, { id: 'selected-later', name: 'Other', createdAt: 1, updatedAt: 1, assets: [], timelines: [] }]
    projects.addAsset.mockImplementation((projectId, asset) => {
      expect(projectId).toBe('submitted')
      return { ...asset, id: 'gap-asset', createdAt: 2 }
    })
    projects.updateTimeline.mockImplementation((projectId, timelineId, updates) => {
      const project = projects.projects.find((candidate) => candidate.id === projectId)!
      const index = project.timelines.findIndex((timeline) => timeline.id === timelineId)
      project.timelines[index] = { ...project.timelines[index], ...updates }
    })
    vi.mocked(copyQueuedOutputToAssetFolder).mockResolvedValue({ path: 'C:\\submitted\\gap.mp4', url: 'file:///C:/submitted/gap.mp4' })
    let acknowledged = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/generation/queue')) return new Response(JSON.stringify({ ...queue, attention: acknowledged ? [] : [{ id: 'gap-job', kind: 'video.generate', status: 'completed', summary: { label: 'Gap', mediaKind: 'video', operation: 'video.generate' } }] }), { status: 200 })
      if (url.endsWith('/api/generation/jobs/gap-job')) return new Response(JSON.stringify({ id: 'gap-job', kind: 'video.generate', status: 'completed', summary: { label: 'Gap', mediaKind: 'video', operation: 'video.generate' }, clientContext: { schemaVersion: 1, projectId: 'submitted', intent: { kind: 'editor-gap-output', timelineId: 'timeline-1', trackId: 'track-1', clipId: 'clip-1', audioClipId: 'audio-1', startTime: 2, endTime: 5, mode: 'text-to-video', prompt: 'bridge', settings: { model: 'fast', duration: 3, videoResolution: '540p', fps: 24, audio: false, cameraMotion: 'none', imageResolution: '1080p', imageAspectRatio: '16:9', imageSteps: 8 }, applyAudio: false } }, result: { kind: 'video.generate', response: { video_path: 'C:\\staging\\gap.mp4' } } }), { status: 200 })
      if (url.endsWith('/acknowledge')) { acknowledged = true; return new Response('{}', { status: 200 }) }
      throw new Error(`Unexpected request ${url}`)
    })

    renderHook(() => useGenerationQueue(), { wrapper: GenerationQueueProvider })

    await waitFor(() => expect(acknowledged).toBe(true))
    expect(copyQueuedOutputToAssetFolder).toHaveBeenCalledWith('C:\\staging\\gap.mp4', 'submitted')
    expect(projects.addAsset).toHaveBeenCalledWith('submitted', expect.objectContaining({ generationJobId: 'gap-job' }))
    expect(projects.updateTimeline).toHaveBeenCalledWith('submitted', 'timeline-1', expect.objectContaining({ clips: [expect.objectContaining({ id: 'clip-1', assetId: 'gap-asset' })] }))
  })
})
