import { useState, useCallback } from 'react'
import type { Asset, TimelineClip } from '../../types/project'
import type { GenerationSettings } from '../../types/generation'
import { backendFetch } from '../../lib/backend'
import { fileUrlToPath } from '../../lib/url-to-path'
import { logger } from '../../lib/logger'
import type { UseGenerationReturn } from '../../hooks/use-generation'
import type { QueuePersistenceIntent } from '../../contexts/GenerationQueueContext'

export interface UseRegenerationParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  assets: Asset[]
  currentProjectId: string | null
  timelineId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  deleteTakeFromAsset: (projectId: string, assetId: string, takeIndex: number) => void
  resolveClipSrc: (clip: TimelineClip | null) => string
  // Generation hook values
  regenGenerate: UseGenerationReturn['generate']
  regenGenerateImage: UseGenerationReturn['generateImage']
  isRegenerating: boolean
  regenProgress: number
  regenStatusMessage: string
  regenCancel: () => void
  regenReset: () => void
}

export function useRegeneration(params: UseRegenerationParams) {
  const {
    clips, setClips, assets, currentProjectId, timelineId,
    updateAsset, deleteTakeFromAsset,
    resolveClipSrc,
    regenGenerate, regenGenerateImage,
    isRegenerating, regenProgress, regenStatusMessage,
    regenCancel, regenReset,
  } = params

  // Track which asset/clip is being regenerated
  const [regeneratingAssetId, setRegeneratingAssetId] = useState<string | null>(null)
  const [regeneratingClipId, setRegeneratingClipId] = useState<string | null>(null)

  // Error state for imported assets that can't auto-generate a prompt
  const [regenerationPreError, setRegenerationPreError] = useState<string | null>(null)
  const dismissRegenerationPreError = useCallback(() => setRegenerationPreError(null), [])

  // Image-to-Video generation from an image clip on the timeline
  const [i2vClipId, setI2vClipId] = useState<string | null>(null)
  const [i2vPrompt, setI2vPrompt] = useState('')
  const [i2vSettings, setI2vSettings] = useState<GenerationSettings>({
    model: 'fast',
    duration: 5,
    videoResolution: '540p',
    fps: 24,
    audio: true,
    cameraMotion: 'none',
    imageResolution: '1080p',
    imageAspectRatio: '16:9',
    imageSteps: 30,
  })

  const handleI2vGenerate = useCallback(async () => {
    if (!i2vClipId || !i2vPrompt.trim() || !currentProjectId || !timelineId) return

    const clip = clips.find(c => c.id === i2vClipId)
    if (!clip) return

    // Get the image URL for this clip and extract the filesystem path
    const imageUrl = resolveClipSrc(clip)
    if (!imageUrl) return

    const imagePath = fileUrlToPath(imageUrl)
    if (!imagePath) {
      logger.error(`I2V: cannot extract path from ${imageUrl}`)
      return
    }

    const settings: GenerationSettings = {
      ...i2vSettings,
      duration: Math.min(Math.max(1, Math.round(clip.duration)), i2vSettings.model === 'pro' ? 10 : 20),
    }

    try {
      const intent: QueuePersistenceIntent = { kind: 'editor-i2v-output', timelineId, clipId: clip.id, prompt: i2vPrompt, settings, duration: clip.duration }
      await regenGenerate(i2vPrompt, imagePath, settings, undefined, undefined, undefined, undefined, undefined, undefined, intent)
      setI2vClipId(null)
      setI2vPrompt('')
    } catch (err) {
      logger.error(`I2V generation failed: ${err}`)
    }
  }, [i2vClipId, i2vPrompt, i2vSettings, currentProjectId, timelineId, clips, resolveClipSrc, regenGenerate])

  const handleRegenerate = useCallback(async (assetId: string, clipId?: string) => {
    if (!currentProjectId || !timelineId || isRegenerating) return
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return

    setRegeneratingAssetId(assetId)
    setRegeneratingClipId(clipId || null)

    // Mark the clip as regenerating for visual feedback
    if (clipId) {
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, isRegenerating: true } : c))
    }

    // If the asset has no generationParams (imported asset), auto-generate a prompt from the first frame via Gemini
    let params = asset.generationParams
    if (!params) {
      try {
        const clipSrc = resolveClipSrc(clips.find(c => c.id === clipId) || { asset, assetId: asset.id } as any)
        let framePath = ''
        if (asset.type === 'video' && clipSrc) {
          const result = await window.electronAPI.extractVideoFrame(clipSrc, 0.1, 512, 3)
          framePath = result.path
        } else if (asset.type === 'image' && clipSrc) {
          framePath = fileUrlToPath(clipSrc) || ''
        }

        if (framePath) {
          // Ask Gemini to describe the frame
          const resp = await backendFetch('/api/suggest-gap-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gapDuration: asset.duration || 5,
              mode: asset.type === 'image' ? 'text-to-image' : 'text-to-video',
              beforePrompt: '',
              afterPrompt: '',
              beforeFrame: framePath,
              afterFrame: '',
            }),
          })
          if (resp.ok) {
            const data = await resp.json()
            if (data.suggested_prompt) {
              params = {
                mode: asset.type === 'image' ? 'text-to-image' : 'text-to-video',
                prompt: data.suggested_prompt,
                model: 'fast',
                duration: asset.duration || 5,
                resolution: asset.resolution || '768x512',
                fps: 24,
                audio: false,
                cameraMotion: 'none',
              }
              // Save the generated params back to the asset so future regenerations are instant
              // (update the asset in project context)
              if (asset.id && currentProjectId) {
                updateAsset(currentProjectId, asset.id, { generationParams: params })
              }
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to auto-generate prompt for imported asset: ${err}`)
      }

      if (!params) {
        // Still no params — can't regenerate
        setRegeneratingAssetId(null)
        setRegeneratingClipId(null)
        if (clipId) {
          setClips(prev => prev.map(c => c.id === clipId ? { ...c, isRegenerating: false } : c))
        }
        setRegenerationPreError('Could not auto-generate a prompt for this clip. Try using "Send to GenSpace" instead.')
        return
      }
    }

    if (params.mode === 'retake') {
      setRegeneratingAssetId(null)
      setRegeneratingClipId(null)
      if (clipId) {
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, isRegenerating: false } : c))
      }
      setRegenerationPreError('Retake is not supported by the current local runtime.')
      return
    }

    const intent: QueuePersistenceIntent = { kind: 'editor-regenerate-output', timelineId, parentAssetId: asset.id, ...(clipId ? { clipId } : {}) }
    try {
      if (params.mode === 'text-to-image') {
        await regenGenerateImage(params.prompt, {
          model: params.model as 'fast' | 'pro',
          duration: params.duration,
          videoResolution: '540p',
          fps: params.fps,
          audio: params.audio,
          cameraMotion: params.cameraMotion,
          imageResolution: params.resolution,
          imageAspectRatio: params.imageAspectRatio || '16:9',
          imageSteps: params.imageSteps || 8,
          variations: 1,
        }, undefined, undefined, intent)
      } else {
        const imagePath = params.mode === 'image-to-video' && params.inputImageUrl
          ? fileUrlToPath(params.inputImageUrl)
          : null
        const videoSettings: GenerationSettings = {
          model: params.model as 'fast' | 'pro', duration: params.duration,
          videoResolution: params.resolution, fps: params.fps, audio: params.audio,
          cameraMotion: params.cameraMotion, imageResolution: '1080p',
          imageAspectRatio: params.imageAspectRatio || '16:9', imageSteps: params.imageSteps || 8,
        }
        await regenGenerate(params.prompt, imagePath, videoSettings, undefined, undefined, undefined, undefined, undefined, undefined, intent)
      }
    } catch (error) {
      logger.error(`Regeneration queue admission failed: ${error}`)
    } finally {
      if (clipId) setClips((current) => current.map((clip) => clip.id === clipId ? { ...clip, isRegenerating: false } : clip))
      setRegeneratingAssetId(null)
      setRegeneratingClipId(null)
    }
  }, [currentProjectId, timelineId, isRegenerating, assets, clips, regenGenerate, regenGenerateImage, resolveClipSrc, setClips, updateAsset])

  const handleCancelRegeneration = useCallback(() => {
    regenCancel()
    // Clear the regenerating visual on the clip
    if (regeneratingClipId) {
      setClips(prev => prev.map(c => c.id === regeneratingClipId ? { ...c, isRegenerating: false } : c))
    }
    setRegeneratingAssetId(null)
    setRegeneratingClipId(null)
    regenReset()
  }, [regenCancel, regenReset, regeneratingClipId])

  // Handle take navigation on a clip (also updates linked audio/video clips)
  const handleClipTakeChange = useCallback((clipId: string, direction: 'prev' | 'next') => {
    setClips(prev => {
      const clip = prev.find(c => c.id === clipId)
      if (!clip?.asset) return prev
      const asset = assets.find(a => a.id === clip.assetId)
      if (!asset?.takes || asset.takes.length <= 1) return prev

      const currentIdx = clip.takeIndex ?? (asset.activeTakeIndex ?? asset.takes.length - 1)
      let newIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1
      newIdx = Math.max(0, Math.min(newIdx, asset.takes.length - 1))

      // Collect all clip IDs that should switch: this clip + all linked clips with the same asset
      const linkedIds = new Set(clip.linkedClipIds || [])
      linkedIds.add(clipId)

      return prev.map(c => {
        if (!linkedIds.has(c.id)) return c
        // Only update clips that share the same asset (linked audio/video pairs)
        if (c.assetId !== clip.assetId) return c
        return { ...c, takeIndex: newIdx }
      })
    })
  }, [assets])

  // Delete the currently displayed take from a clip's asset
  const handleDeleteTake = useCallback((clipId: string) => {
    if (!currentProjectId) return
    const clip = clips.find(c => c.id === clipId)
    if (!clip?.assetId) return
    const asset = assets.find(a => a.id === clip.assetId)
    if (!asset?.takes || asset.takes.length <= 1) return // Can't delete the only take

    const takeIdx = clip.takeIndex ?? (asset.activeTakeIndex ?? asset.takes.length - 1)

    // Delete the take from the asset in context
    deleteTakeFromAsset(currentProjectId, asset.id, takeIdx)

    // Update ALL clips that reference this asset: adjust their takeIndex
    setClips(prev => prev.map(c => {
      if (c.assetId !== asset.id) return c
      const cIdx = c.takeIndex ?? (asset.activeTakeIndex ?? asset.takes!.length - 1)
      if (cIdx === takeIdx) {
        // This clip was showing the deleted take → move to the previous one (or 0)
        return { ...c, takeIndex: Math.max(0, takeIdx - 1) }
      } else if (cIdx > takeIdx) {
        // This clip was showing a take after the deleted one → shift down by 1
        return { ...c, takeIndex: cIdx - 1 }
      }
      return c
    }))
  }, [clips, assets, currentProjectId, deleteTakeFromAsset])

  return {
    // State
    regeneratingAssetId, setRegeneratingAssetId,
    regeneratingClipId, setRegeneratingClipId,
    i2vClipId, setI2vClipId,
    i2vPrompt, setI2vPrompt,
    i2vSettings, setI2vSettings,
    // Pre-generation error (e.g. imported asset can't auto-generate prompt)
    regenerationPreError, dismissRegenerationPreError,
    // Passthrough from generation hook
    isRegenerating, regenProgress, regenStatusMessage,
    // Actions
    handleI2vGenerate,
    handleRegenerate,
    handleCancelRegeneration,
    handleClipTakeChange,
    handleDeleteTake,
  }
}
