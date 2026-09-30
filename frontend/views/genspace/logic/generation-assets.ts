import type { GenerateMusicResult } from "../../../hooks/use-generation";
import type { GenerateSfxResult } from "../../../hooks/use-generation";
import type { GenerateSpeechResult } from "../../../hooks/use-generation";
import type { Asset, AssetTake } from "../../../types/project";
import type {
  ImageSubmissionSnapshot,
  MusicSubmissionSnapshot,
  SfxSubmissionSnapshot,
  SpeechSubmissionSnapshot,
  ReframeSubmissionSnapshot,
  VideoSubmissionSnapshot,
} from "../types";
import { AUDIO_MEDIA_ROLE_SET } from "../constants";

type NewAsset = Omit<Asset, "id" | "createdAt">;

function generationTimeSeconds(
  submittedAt: number | undefined,
  completedAt: number,
): number | undefined {
  return submittedAt === undefined
    ? undefined
    : Math.max(1, Math.round((completedAt - submittedAt) / 1000));
}

export function getAssetModelId(asset: Asset): string | undefined {
  if (asset.generationParams?.mode === "upscale") {
    return asset.generationParams.upscale?.method ?? asset.generationParams.model;
  }
  return (
    asset.generationParams?.imageProfileId ??
    asset.generationParams?.videoProfileId ??
    asset.generationParams?.music?.profileId ??
    asset.generationParams?.model
  );
}

function resolvePath(
  url: string | undefined,
  assetPaths: Array<{ url: string; path: string }>,
): string | undefined {
  return url
    ? assetPaths.find((asset) => asset.url === url)?.path
    : undefined;
}

function storedInput(
  input: ImageSubmissionSnapshot["inputs"][number],
  assetPaths: ImageSubmissionSnapshot["assetPaths"],
) {
  return {
    url: input.url,
    role: input.role,
    path: resolvePath(input.url, assetPaths),
    type: input.type,
    useAudioTrack: input.useAudioTrack,
    trimStartTime: input.trimStartTime,
    trimDuration: input.trimDuration,
    mediaDuration: input.mediaDuration,
    crop: input.crop ? { ...input.crop } : undefined,
  };
}

export function buildGeneratedImageAsset({
  snapshot,
  finalPath,
  finalUrl,
  createdAt,
  seed,
}: {
  snapshot: ImageSubmissionSnapshot;
  finalPath: string;
  finalUrl: string;
  createdAt: number;
  seed?: number;
}): NewAsset {
  const firstInput = snapshot.inputs[0];
  const upscale = snapshot.upscale;
  return {
    type: "image",
    path: finalPath,
    url: finalUrl,
    prompt: snapshot.prompt,
    resolution: snapshot.settings.imageResolution,
    generationTimeSeconds: generationTimeSeconds(
      snapshot.submittedAt,
      createdAt,
    ),
    source: "generated",
    generationParams: {
      mode: upscale ? "upscale" : "text-to-image",
      prompt: snapshot.prompt,
      promptEnhancement: snapshot.promptEnhancement,
      model: upscale?.method ?? (snapshot.settings.imageProfileId || "z_image_turbo"),
      duration: 5,
      resolution: snapshot.settings.imageResolution,
      fps: 24,
      audio: false,
      cameraMotion: "none",
      imageAspectRatio:
        snapshot.settings.imageAspectRatio || snapshot.settings.aspectRatio,
      imageSteps: snapshot.settings.imageSteps,
      imageProfileId: snapshot.settings.imageProfileId,
      imageProcessMode: snapshot.imageMode ?? "create",
      upscale: upscale ? {
        schemaVersion: 1,
        mediaKind: upscale.mediaKind,
        method: upscale.method,
        scale: upscale.scale,
        source: { url: upscale.source.url, path: upscale.source.path ?? resolvePath(upscale.source.url, snapshot.assetPaths), type: upscale.mediaKind },
      } : undefined,
      imageEditMask: snapshot.editMask
        ? {
            schemaVersion: 1,
            operations: snapshot.editMask.operations.map((operation) =>
              operation.kind === "brush"
                ? {
                    ...operation,
                    points: operation.points.map((point) => ({ ...point })),
                  }
                : { ...operation },
            ),
          }
        : undefined,
      imageEditOutpaint: snapshot.editOutpaint
        ? {
            ...snapshot.editOutpaint,
            padding: { ...snapshot.editOutpaint.padding },
          }
        : undefined,
      inputImageUrl: firstInput?.url,
      inputImagePath: resolvePath(firstInput?.url, snapshot.assetPaths),
      imageInputRole: firstInput?.role,
      imageInputMedia: snapshot.inputs.map((input) =>
        storedInput(input, snapshot.assetPaths),
      ),
    },
    takes: [{ url: finalUrl, path: finalPath, createdAt, seed }],
    activeTakeIndex: 0,
  };
}

export function buildGeneratedVideoAsset({
  snapshot,
  finalPath,
  finalUrl,
  createdAt,
  seed,
}: {
  snapshot: VideoSubmissionSnapshot;
  finalPath: string;
  finalUrl: string;
  createdAt: number;
  seed?: number;
}): NewAsset {
  const startImage = snapshot.inputs.find(({ role }) => role === "start_image");
  const audio = snapshot.inputs.find(({ role }) =>
    AUDIO_MEDIA_ROLE_SET.has(role),
  );
  const inputImageUrl = startImage?.url || snapshot.inputImage || undefined;
  const inputAudioUrl = audio?.url || snapshot.inputAudio || undefined;
  const upscale = snapshot.upscale;
  const duration = upscale
    ? upscale.source.mediaDuration ?? snapshot.settings.duration
    : snapshot.settings.duration;
  const mode = upscale ? "upscale" : inputAudioUrl
    ? "audio-to-video"
    : inputImageUrl
      ? "image-to-video"
      : "text-to-video";
  return {
    type: "video",
    path: finalPath,
    url: finalUrl,
    prompt: snapshot.prompt,
    resolution: snapshot.settings.videoResolution,
    duration,
    generationTimeSeconds: generationTimeSeconds(
      snapshot.submittedAt,
      createdAt,
    ),
    source: "generated",
    generationParams: {
      mode,
      prompt: snapshot.prompt,
      promptEnhancement: snapshot.promptEnhancement,
      model: upscale?.method ?? snapshot.settings.model,
      videoProfileId: snapshot.settings.videoProfileId,
      styleId: snapshot.videoTool ? undefined : snapshot.settings.styleId,
      videoTool: snapshot.videoTool,
      upscale: upscale ? {
        schemaVersion: 1,
        mediaKind: upscale.mediaKind,
        method: upscale.method,
        scale: upscale.scale,
        source: { url: upscale.source.url, path: upscale.source.path ?? resolvePath(upscale.source.url, snapshot.assetPaths), type: upscale.mediaKind },
      } : undefined,
      duration,
      resolution: snapshot.settings.videoResolution,
      fps: snapshot.settings.fps,
      audio: snapshot.settings.audio || false,
      cameraMotion: "none",
      imageAspectRatio: snapshot.settings.aspectRatio,
      imageSteps: snapshot.settings.imageSteps,
      useAudioTrack: snapshot.useAudioTrack,
      inputImageUrl,
      inputAudioUrl,
      inputImagePath: resolvePath(inputImageUrl, snapshot.assetPaths),
      inputAudioPath: resolvePath(inputAudioUrl, snapshot.assetPaths),
      imageInputMedia: snapshot.inputs.map((input) =>
        storedInput(input, snapshot.assetPaths),
      ),
      videoComposer: snapshot.composer,
    },
    takes: [{ url: finalUrl, path: finalPath, createdAt, seed }],
    activeTakeIndex: 0,
  };
}

export function buildReframeAsset({
  snapshot,
  finalPath,
  finalUrl,
  createdAt,
}: {
  snapshot: ReframeSubmissionSnapshot;
  finalPath: string;
  finalUrl: string;
  createdAt: number;
}): NewAsset {
  const input = snapshot.input;
  return {
    type: "video",
    path: finalPath,
    url: finalUrl,
    prompt: snapshot.prompt,
    resolution: snapshot.settings.videoResolution,
    duration: input.duration,
    generationTimeSeconds: generationTimeSeconds(
      snapshot.submittedAt,
      createdAt,
    ),
    source: "generated",
    generationParams: {
      mode: "reframe",
      prompt: snapshot.prompt,
      model: snapshot.settings.model,
      videoProfileId: snapshot.settings.videoProfileId,
      duration: input.duration,
      resolution: snapshot.settings.videoResolution,
      fps: snapshot.settings.fps,
      audio: false,
      cameraMotion: "none",
      reframeAspectMode: input.aspectMode,
      reframePadding: input.padding,
      reframeStartTime: input.startTime,
      reframeDuration: input.duration,
      reframeVideoPath: input.videoPath ?? undefined,
      imageInputMedia: input.videoPath
        ? [
            {
              url: input.videoUrl ?? "",
              role: "control_video",
              path: input.videoPath,
            },
          ]
        : undefined,
    },
    takes: [{ url: finalUrl, path: finalPath, createdAt }],
    activeTakeIndex: 0,
  };
}

export function buildGeneratedMusicAsset({
  snapshot,
  result,
  takes,
}: {
  snapshot: MusicSubmissionSnapshot;
  result: GenerateMusicResult;
  takes: AssetTake[];
}): NewAsset | null {
  const first = takes[0];
  if (!first) return null;
  const recipe = snapshot.recipe;
  return {
    type: "audio",
    path: first.path,
    url: first.url,
    prompt: snapshot.prompt,
    resolution: "",
    duration:
      first.duration ??
      recipe.requestedDurationSeconds ??
      recipe.fallbackDurationSeconds,
    generationTimeSeconds: generationTimeSeconds(
      snapshot.submittedAt,
      first.createdAt,
    ),
    source: "generated",
    generationParams: {
      mode: "text-to-music",
      prompt: snapshot.prompt,
      model: recipe.profileId,
      duration:
        recipe.requestedDurationSeconds ?? recipe.fallbackDurationSeconds,
      resolution: "",
      fps: 0,
      audio: true,
      cameraMotion: "none",
      music: {
        schemaVersion: 2,
        profileId: recipe.profileId,
        experienceMode: recipe.experienceMode,
        description: snapshot.prompt,
        instrumental: recipe.instrumental,
        lyricsMode: recipe.lyricsMode,
        lyricsPrompt: recipe.lyricsPrompt,
        requestedLyrics: recipe.requestedLyrics,
        lyricsSeed: recipe.lyricsSeed,
        resolvedLyrics: result.resolvedLyrics,
        enhanceDescription: recipe.enhanceDescription,
        durationMode: recipe.durationMode,
        requestedDurationSeconds: recipe.requestedDurationSeconds,
        fallbackDurationSeconds: recipe.fallbackDurationSeconds,
        actualDurationSeconds: first.duration,
        vocalLanguage: recipe.vocalLanguage,
        vocalGender: recipe.vocalGender,
        bpm: recipe.bpm,
        timeSignature: recipe.timeSignature,
        keyScale: recipe.keyScale,
        audioInputs: recipe.audioInputs,
        weirdness: recipe.weirdness,
        promptInfluence: recipe.promptInfluence,
        variationCount: recipe.variationCount,
        effective: {
          modelMode: result.effectiveSettings?.modelMode ?? 0,
          temperature: result.effectiveSettings?.temperature ?? 0.85,
          topP: result.effectiveSettings?.topP ?? 0.9,
          topK: result.effectiveSettings?.topK ?? 0,
          lmGuidanceScale:
            result.effectiveSettings?.lmGuidanceScale ?? 2.5,
          audioTask: result.effectiveSettings?.audioTask ?? "",
          descriptionModifiers:
            result.effectiveSettings?.descriptionModifiers ?? [],
          requestedPerformanceProfile:
            result.effectiveSettings?.requestedPerformanceProfile,
          effectiveAudioProfile:
            result.effectiveSettings?.effectiveAudioProfile,
        },
      },
    },
    takes,
    activeTakeIndex: 0,
  };
}

export function buildGeneratedSfxAsset({ snapshot, result, finalPath, finalUrl, createdAt }: {
  snapshot: SfxSubmissionSnapshot; result: GenerateSfxResult; finalPath: string; finalUrl: string; createdAt: number;
}): NewAsset {
  return {
    type: "audio", path: finalPath, url: finalUrl, prompt: snapshot.prompt, resolution: "",
    duration: snapshot.recipe.durationSeconds, generationTimeSeconds: generationTimeSeconds(snapshot.submittedAt, createdAt), source: "generated",
    generationParams: { mode: "text-to-sfx", prompt: snapshot.prompt, model: snapshot.recipe.modelProfileId, duration: snapshot.recipe.durationSeconds, resolution: "", fps: 0, audio: true, cameraMotion: "none", sfx: snapshot.recipe },
    takes: [{ path: finalPath, url: finalUrl, createdAt, seed: result.resolvedSeed }], activeTakeIndex: 0,
  };
}

export function buildGeneratedSpeechAsset({ snapshot, result, finalPath, finalUrl, createdAt }: {
  snapshot: SpeechSubmissionSnapshot; result: GenerateSpeechResult; finalPath: string; finalUrl: string; createdAt: number;
}): NewAsset {
  return {
    type: "audio", path: finalPath, url: finalUrl, prompt: snapshot.prompt, resolution: "", source: "generated",
    generationTimeSeconds: generationTimeSeconds(snapshot.submittedAt, createdAt),
    generationParams: { mode: "text-to-speech", prompt: snapshot.prompt, model: snapshot.recipe.modelProfileId, duration: 0, resolution: "", fps: 0, audio: true, cameraMotion: "none", speech: snapshot.recipe },
    takes: [{ path: finalPath, url: finalUrl, createdAt, seed: result.resolvedSeed }], activeTakeIndex: 0,
  };
}

export function buildRetakeAsset({
  prompt,
  duration,
  startTime,
  finalPath,
  finalUrl,
  createdAt,
}: {
  prompt: string;
  duration: number;
  startTime: number;
  finalPath: string;
  finalUrl: string;
  createdAt: number;
}): NewAsset {
  return {
    type: "video",
    path: finalPath,
    url: finalUrl,
    prompt,
    resolution: "",
    duration,
    source: "generated",
    generationParams: {
      mode: "retake",
      prompt,
      model: "pro",
      duration,
      resolution: "",
      fps: 24,
      audio: true,
      cameraMotion: "none",
      retakeVideoPath: finalPath,
      retakeStartTime: startTime,
      retakeDuration: duration,
      retakeMode: "replace_audio_and_video",
    },
    takes: [{ url: finalUrl, path: finalPath, createdAt }],
    activeTakeIndex: 0,
  };
}
