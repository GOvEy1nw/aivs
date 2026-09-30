import type { Asset, GenerationParams } from '../types/project'
import type { MediaCropRecipe } from '../types/media-crop'
import type { MusicSettings, MusicTimeSignature, MusicVocalMode } from '../types/music'
import {
  AUDIO_MEDIA_ROLE_SET,
  GUIDE_MEDIA_ROLE_SET,
} from '../views/genspace/constants'
import type { GenSpaceMediaInput } from '../views/genspace/types'
import { fileUrlToPath } from './url-to-path'

export type GenSpaceSettingsPatch = {
  model: 'fast' | 'pro'
  videoProfileId: string
  styleId: string | undefined
  duration: number
  videoResolution: string
  fps: number
  aspectRatio: string
  imageResolution: string
  imageAspectRatio: string
  imageProfileId: string
  imageSteps: number
  variations: number
  audio: boolean
  imageInputRole: string | undefined
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function isUsableMediaUrl(url: string | null | undefined): url is string {
  return !!url && !url.startsWith('blob:')
}

function inferInputType(role: string): 'image' | 'video' | 'audio' {
  if (AUDIO_MEDIA_ROLE_SET.has(role)) return 'audio'
  if (GUIDE_MEDIA_ROLE_SET.has(role)) return 'video'
  return 'image'
}

/** Resolve a stored input URL against project assets (handles stale blob: URLs via path). */
export function resolveGenerationInputUrl(
  storedUrl: string | undefined,
  storedPath: string | undefined,
  assets: Asset[],
): string | null {
  if (storedUrl) {
    const byUrl = assets.find((asset) => asset.url === storedUrl)
    if (byUrl) return byUrl.url
  }

  const pathToMatch =
    storedPath ||
    (storedUrl?.startsWith('file://') ? fileUrlToPath(storedUrl) : null)
  if (!pathToMatch) return isUsableMediaUrl(storedUrl) ? storedUrl : null

  const normalizedTarget = normalizePath(pathToMatch)
  const byPath = assets.find(
    (asset) => normalizePath(asset.path) === normalizedTarget,
  )
  if (byPath) return byPath.url

  const baseName = normalizedTarget.split('/').pop()
  if (baseName) {
    const byBaseName = assets.find((asset) => {
      const assetPath = normalizePath(asset.path)
      return assetPath.endsWith(`/${baseName}`) || assetPath === baseName
    })
    if (byBaseName) return byBaseName.url
  }

  return isUsableMediaUrl(storedUrl) ? storedUrl : null
}

export function resolveInputMediaPath(
  url: string | undefined,
  projectAssets: Asset[],
): string | undefined {
  if (!url) return undefined
  const fromUrl = fileUrlToPath(url)
  if (fromUrl) return fromUrl
  return projectAssets.find((asset) => asset.url === url)?.path
}

export function toStoredInputMediaEntry(
  item: {
    url: string
    role: string
    alias?: string
    type?: 'image' | 'video' | 'audio'
    useAudioTrack?: boolean
    trimStartTime?: number
    trimDuration?: number
    mediaDuration?: number
    crop?: MediaCropRecipe
  },
  projectAssets: Asset[],
): NonNullable<GenerationParams['imageInputMedia']>[number] {
  const path = resolveInputMediaPath(item.url, projectAssets)
  const entry: NonNullable<GenerationParams['imageInputMedia']>[number] = {
    url: item.url,
    role: item.role,
  }
  if (path) entry.path = path
  if (item.type) entry.type = item.type
  if (item.useAudioTrack !== undefined) entry.useAudioTrack = item.useAudioTrack
  if (item.alias) entry.alias = item.alias
  if (item.trimStartTime !== undefined) entry.trimStartTime = item.trimStartTime
  if (item.trimDuration !== undefined) entry.trimDuration = item.trimDuration
  if (item.mediaDuration !== undefined) entry.mediaDuration = item.mediaDuration
  if (item.crop) entry.crop = { ...item.crop }
  return entry
}

/** Repair generationParams input URLs when loading projects from localStorage. */
export function recoverGenerationParamsMedia(
  params: GenerationParams,
  assets: Asset[],
): GenerationParams {
  let changed = false
  const next: GenerationParams = { ...params }

  if (params.imageInputMedia?.length) {
    const repairedMedia = params.imageInputMedia.map((item) => {
      const resolvedUrl = resolveGenerationInputUrl(
        item.url,
        item.path,
        assets,
      )
      if (!resolvedUrl || resolvedUrl === item.url) {
        return item
      }
      changed = true
      return { ...item, url: resolvedUrl }
    })
    next.imageInputMedia = repairedMedia
  }

  if (params.inputImageUrl || params.inputImagePath) {
    const resolved = resolveGenerationInputUrl(
      params.inputImageUrl,
      params.inputImagePath,
      assets,
    )
    if (resolved && resolved !== params.inputImageUrl) {
      changed = true
      next.inputImageUrl = resolved
    } else if (
      params.inputImageUrl?.startsWith('blob:') &&
      resolved &&
      isUsableMediaUrl(resolved)
    ) {
      changed = true
      next.inputImageUrl = resolved
    }
  }

  if (params.inputAudioUrl || params.inputAudioPath) {
    const resolved = resolveGenerationInputUrl(
      params.inputAudioUrl,
      params.inputAudioPath,
      assets,
    )
    if (resolved && resolved !== params.inputAudioUrl) {
      changed = true
      next.inputAudioUrl = resolved
    } else if (
      params.inputAudioUrl?.startsWith('blob:') &&
      resolved &&
      isUsableMediaUrl(resolved)
    ) {
      changed = true
      next.inputAudioUrl = resolved
    }
  }

  if (params.upscale) {
    const resolved = resolveGenerationInputUrl(params.upscale.source.url, params.upscale.source.path, assets)
    if (resolved && resolved !== params.upscale.source.url) {
      changed = true
      next.upscale = { ...params.upscale, source: { ...params.upscale.source, url: resolved } }
    }
  }

  return changed ? next : params
}

export function buildImageInputsFromParams(
  params: GenerationParams,
  assets: Asset[] = [],
): GenSpaceMediaInput[] {
  const items: GenSpaceMediaInput[] = []

  if (params.imageInputMedia?.length) {
    for (const item of params.imageInputMedia) {
      const url = resolveGenerationInputUrl(item.url, item.path, assets)
      if (!isUsableMediaUrl(url)) continue
      items.push({
        id: crypto.randomUUID(),
        ...(item.alias ? { alias: item.alias } : {}),
        url,
        role: item.role,
        type: item.type ?? inferInputType(item.role),
        useAudioTrack: item.useAudioTrack,
        trimStartTime: item.trimStartTime,
        trimDuration: item.trimDuration,
        mediaDuration: item.mediaDuration,
        crop: item.crop ? { ...item.crop } : undefined,
      })
    }
  }

  if (items.length === 0) {
    const imageUrl = resolveGenerationInputUrl(
      params.inputImageUrl,
      params.inputImagePath,
      assets,
    )
    if (isUsableMediaUrl(imageUrl)) {
      const role =
        params.imageInputRole ||
        (params.mode === 'text-to-image' ? 'reference_subject' : 'start_image')
      items.push({
        id: crypto.randomUUID(),
        url: imageUrl,
        role,
        type: 'image',
      })
    }
  }

  const audioUrl = resolveGenerationInputUrl(
    params.inputAudioUrl,
    params.inputAudioPath,
    assets,
  )
  if (isUsableMediaUrl(audioUrl) && !items.some((item) => item.url === audioUrl)) {
    items.push({
      id: crypto.randomUUID(),
      url: audioUrl,
      role:
        params.mode === 'audio-to-video' ? 'audio_to_video' : 'audio_guide',
      type: 'audio',
    })
  }

  return items
}

export function settingsPatchFromGenerationParams(
  params: GenerationParams,
  current: GenSpaceSettingsPatch,
): GenSpaceSettingsPatch {
  if (genSpaceModeFromParams(params) === 'music') return current

  if (params.mode === 'text-to-image') {
    const imageProfileId =
      params.imageProfileId ||
      (params.model !== 'fast' && params.model !== 'pro'
        ? params.model
        : undefined) ||
      current.imageProfileId
    return {
      ...current,
      imageProfileId,
      imageResolution: params.resolution || current.imageResolution,
      imageAspectRatio: params.imageAspectRatio || current.imageAspectRatio,
      imageSteps: params.imageSteps ?? current.imageSteps,
      imageInputRole: params.imageInputRole ?? current.imageInputRole,
    }
  }

  const model =
    params.model === 'fast' || params.model === 'pro'
      ? params.model
      : current.model

  return {
    ...current,
    model,
    videoProfileId: params.videoProfileId || current.videoProfileId,
    styleId: params.styleId,
    duration:
      typeof params.duration === 'number' &&
      Number.isFinite(params.duration) &&
      params.duration > 0
        ? params.duration
        : current.duration,
    videoResolution: params.resolution || current.videoResolution,
    fps:
      typeof params.fps === 'number' && Number.isFinite(params.fps) && params.fps > 0
        ? params.fps
        : current.fps,
    audio: params.audio ?? current.audio,
    aspectRatio: params.imageAspectRatio || current.aspectRatio,
    imageAspectRatio: params.imageAspectRatio || current.imageAspectRatio,
    imageSteps: params.imageSteps ?? current.imageSteps,
  }
}

export function resolveLegacyInputMedia(
  params: GenerationParams,
  imageInputs: GenSpaceMediaInput[],
  assets: Asset[] = [],
): { inputImage: string | null; inputAudio: string | null } {
  const startImage = imageInputs.find((item) => item.role === 'start_image')
  const audioItem = imageInputs.find((item) =>
    AUDIO_MEDIA_ROLE_SET.has(item.role),
  )

  const inputImage =
    startImage?.url ??
    resolveGenerationInputUrl(
      params.inputImageUrl,
      params.inputImagePath,
      assets,
    )
  const inputAudio =
    audioItem?.url ??
    resolveGenerationInputUrl(
      params.inputAudioUrl,
      params.inputAudioPath,
      assets,
    )

  return {
    inputImage: isUsableMediaUrl(inputImage) ? inputImage : null,
    inputAudio: isUsableMediaUrl(inputAudio) ? inputAudio : null,
  }
}

export function genSpaceModeFromParams(
  params: GenerationParams,
): 'image' | 'video' | 'music' | 'retake' | 'reframe' {
  if (params.mode === 'text-to-image' || (params.mode === 'upscale' && params.upscale?.mediaKind === 'image')) return 'image'
  if (
    params.mode === 'text-to-music' ||
    params.mode === 'text-to-sfx' ||
    params.mode === 'text-to-speech'
  ) return 'music'
  if (params.mode === 'retake') return 'retake'
  if (params.mode === 'reframe') return 'reframe'
  return 'video'
}

const MUSIC_VOCAL_MODES = new Set<MusicVocalMode>([
  'instrumental',
  'auto-lyrics',
  'custom-lyrics',
])
const MUSIC_TIME_SIGNATURES = new Set<MusicTimeSignature>([
  '2/4',
  '3/4',
  '4/4',
  '6/8',
])

export function musicSettingsFromGenerationParams(
  params: GenerationParams,
  current: MusicSettings,
): MusicSettings {
  const music = params.music
  const profileId = music?.profileId ?? params.model
  if (music?.schemaVersion === 2) {
    const audioInputs =
      music.audioInputs ?? (music.audioInput ? [music.audioInput] : [])
    const coverInput = audioInputs.find(({ role }) => role === 'cover')
    const referenceTimbreInput = audioInputs.find(
      ({ role }) => role === 'reference-timbre',
    )
    return {
      ...current,
      schemaVersion: 2,
      profileId,
      experienceMode: 'advanced',
      instrumental: music.instrumental,
      advancedLyricsMode: music.lyricsMode,
      lyricsPrompt: music.lyricsPrompt ?? '',
      customLyrics: music.requestedLyrics ?? music.resolvedLyrics ?? '',
      enhanceDescription: music.enhanceDescription,
      durationMode: music.durationMode,
      manualDurationSeconds: Math.min(
        360,
        Math.max(5, Math.round(music.requestedDurationSeconds ?? music.fallbackDurationSeconds)),
      ),
      vocalLanguage: music.vocalLanguage,
      vocalGender: music.vocalGender,
      bpm: music.bpm ?? null,
      timeSignature: music.timeSignature ?? null,
      keyScale: music.keyScale?.trim() || null,
      coverAudioInput: coverInput
        ? {
            url: coverInput.url,
            path: coverInput.path,
            role: coverInput.role,
            mediaDuration: coverInput.mediaDuration,
          }
        : null,
      referenceTimbreAudioInput: referenceTimbreInput
        ? {
            url: referenceTimbreInput.url,
            path: referenceTimbreInput.path,
            role: referenceTimbreInput.role,
            mediaDuration: referenceTimbreInput.mediaDuration,
          }
        : null,
      coverStrength: coverInput?.coverStrength ?? 50,
      variations: Math.min(4, Math.max(1, music.variationCount)),
      weirdness: music.weirdness,
      promptInfluence: music.promptInfluence,
      composeWithThinking: false,
      lyricsSeedLocked: music.lyricsSeed !== undefined,
      lyricsSeed: music.lyricsSeed ?? current.lyricsSeed,
    }
  }
  const vocalMode = music?.vocalMode ?? 'instrumental'
  const duration = music?.requestedDurationSeconds ?? params.duration
  return {
    ...current,
    schemaVersion: 2,
    profileId,
    experienceMode: 'advanced',
    instrumental: vocalMode === 'instrumental',
    advancedLyricsMode:
      MUSIC_VOCAL_MODES.has(vocalMode) && vocalMode === 'custom-lyrics'
        ? 'custom'
        : 'auto',
    customLyrics: music?.requestedLyrics ?? '',
    lyricsPrompt: '',
    enhanceDescription: false,
    durationMode: 'manual',
    manualDurationSeconds: Number.isFinite(duration)
      ? Math.min(360, Math.max(5, Math.round(duration)))
      : current.manualDurationSeconds,
    vocalLanguage: 'en',
    vocalGender: 'auto',
    bpm:
      music?.bpm !== undefined && Number.isInteger(music.bpm)
        ? Math.min(300, Math.max(30, music.bpm))
        : null,
    timeSignature:
      music?.timeSignature && MUSIC_TIME_SIGNATURES.has(music.timeSignature)
        ? music.timeSignature
        : null,
    keyScale: music?.keyScale?.trim() || null,
    coverAudioInput: null,
    referenceTimbreAudioInput: null,
    coverStrength: 50,
    variations: Math.min(4, Math.max(1, music?.variationCount ?? 1)),
    weirdness: 50,
    promptInfluence: 75,
    composeWithThinking: false,
    lyricsSeedLocked: false,
    lyricsSeed: current.lyricsSeed,
  }
}
