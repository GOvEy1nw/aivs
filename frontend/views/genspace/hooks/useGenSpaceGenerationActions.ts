import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ReframePanelState } from "../video/ReframePanel";
import type { UseGenerationReturn } from "../../../hooks/use-generation";
import { QueueAdmissionRejectedError } from "../../../contexts/GenerationQueueContext";
import type { RetakeSubmitParams } from "../../../hooks/use-retake";
import type { ModelProfile } from "../../../types/model-profiles";
import type { MusicSettings } from "../../../types/music";
import type { SfxSettings } from "../../../types/sfx";
import type { Asset } from "../../../types/project";
import type {
  ImageEditMaskRecipe,
  ImageEditOutpaintRecipe,
  ImageEditToolMode,
} from "../../../types/image-edit";
import type { GenSpaceSettings } from "../constants";
import type {
  FramingSettings,
  GenSpaceMediaInput,
  GenSpaceMode,
  ImageProcessMode,
  ImageSubmissionSnapshot,
  MusicSubmissionSnapshot,
  SfxSubmissionSnapshot,
  SpeechSubmissionSnapshot,
  ReframeSubmissionSnapshot,
  RetakeSubmissionSnapshot,
  VideoSubmissionSnapshot,
  VideoProcessMode,
} from "../types";
import type { VideoToolId } from "../../../types/video-tools";
import { applyFramingPrefix } from "../logic/framing";
import {
  serializeRegionPrompt,
  type RegionPromptState,
} from "../image/region-prompt";
import {
  buildImageGenerationCommand,
  buildMusicGenerationCommand,
  buildReframeGenerationCommand,
  buildRetakeGenerationCommand,
  buildVideoToolGenerationCommand,
  buildVideoGenerationCommand,
} from "../logic/generation-requests";
import { buildSfxGenerationCommand } from "../logic/sfx-request";
import { buildSpeechGenerationCommand } from "../logic/speech-request";
import type { SpeechSettings } from "../../../types/speech";
import { fileUrlToPath } from "../../../lib/url-to-path";
import type { UpscaleMethodId } from "../../../types/upscale";
import type { ReferenceEntity } from "../../../../shared/reference-library";
import { compileVideoPrompt, type VideoComposerStateV1 } from "../logic/video-prompt-composer";
import { stageEntityInputs, stageReferenceSnapshots } from "../logic/reference-entity-staging";
import { usePromptEnhancement, type PromptEnhancementRequest } from "./usePromptEnhancement";

interface RetakeInput {
  videoPath: string | null;
  startTime: number;
  duration: number;
  videoDuration: number;
}

export function useGenSpaceGenerationActions({
  mode,
  imageMode,
  regionPrompt,
  videoMode,
  selectedVideoTool = "reframe",
  videoToolInput = null,
  prompt,
  framingSettings,
  promptEnhancementEnabled,
  composer = { schemaVersion: 1, mode: "simple", sequence: { schemaVersion: 1, scenes: [] } },
  referenceEntities = [],
  videoProfiles = [],
  currentProjectId,
  projectAssets,
  settings,
  setSettings,
  musicSettings,
  audioSubmode = "music",
  sfxSettings,
  speechSettings,
  musicProfiles,
  imageInputs,
  editImage = null,
  editToolMode = "edit",
  editMask = null,
  editOutpaint = null,
  inputImage,
  inputAudio,
  useAudioTrack,
  reframeInput,
  retakeInput,
  setLocalError,
  generate,
  generateImage,
  generateMusic,
  generateSfx,
  generateSpeech,
  generateUpscale,
  upscaleMethod = null,
  upscaleScale = null,
  submitRetake,
}: {
  mode: GenSpaceMode;
  imageMode: ImageProcessMode;
  regionPrompt: RegionPromptState;
  videoMode: VideoProcessMode;
  selectedVideoTool?: VideoToolId;
  videoToolInput?: GenSpaceMediaInput | null;
  prompt: string;
  framingSettings: FramingSettings | null;
  promptEnhancementEnabled: boolean;
  composer?: VideoComposerStateV1;
  referenceEntities?: readonly ReferenceEntity[];
  videoProfiles?: ModelProfile[];
  currentProjectId: string | null;
  projectAssets: Asset[];
  settings: GenSpaceSettings;
  setSettings: Dispatch<SetStateAction<GenSpaceSettings>>;
  musicSettings: MusicSettings;
  audioSubmode?: "music" | "speech" | "sfx" | "mixer";
  sfxSettings?: SfxSettings;
  speechSettings?: SpeechSettings;
  musicProfiles: ModelProfile[];
  imageInputs: GenSpaceMediaInput[];
  editImage?: GenSpaceMediaInput | null;
  editToolMode?: ImageEditToolMode;
  editMask?: ImageEditMaskRecipe | null;
  editOutpaint?: ImageEditOutpaintRecipe | null;
  inputImage: string | null;
  inputAudio: string | null;
  useAudioTrack: boolean;
  reframeInput: ReframePanelState;
  retakeInput: RetakeInput;
  setLocalError: Dispatch<SetStateAction<string | null>>;
  generate: UseGenerationReturn["generate"];
  generateImage: UseGenerationReturn["generateImage"];
  generateMusic: UseGenerationReturn["generateMusic"];
  generateSfx?: UseGenerationReturn["generateSfx"];
  generateSpeech?: UseGenerationReturn["generateSpeech"];
  generateUpscale?: UseGenerationReturn["generateUpscale"];
  upscaleMethod?: UpscaleMethodId | null;
  upscaleScale?: number | null;
  submitRetake: (params: RetakeSubmitParams, snapshot?: RetakeSubmissionSnapshot | null) => Promise<void>;
}) {
  const submissionInFlight = useRef(false);
  const compileDraft = (brief: string) => mode === "video" && videoMode === "generate"
    ? compileVideoPrompt({
        brief, composer, entities: referenceEntities, fallbackSnapshots: composer.referencedEntities,
        reservedAliases: imageInputs.flatMap((input) => input.alias ? [input.alias] : []),
        retainedRoles: imageInputs.map((input) => input.role),
        policy: videoProfiles.find((profile) => profile.id === settings.videoProfileId)?.promptComposer
          ?? { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false },
      }) : null;
  const enhancement = usePromptEnhancement(JSON.stringify({
    currentProjectId, mode, imageMode, videoMode, audioSubmode, prompt, settings, framingSettings,
    composer, referenceEntities, imageInputs, editImage, editToolMode, editMask, editOutpaint,
    inputImage, inputAudio, useAudioTrack,
  }), (): PromptEnhancementRequest => {
    if (!currentProjectId || (mode !== "image" && mode !== "video") ||
        (mode === "image" && !["create", "edit"].includes(imageMode)) ||
        (mode === "video" && videoMode !== "generate")) throw new Error("Enhancement is unavailable for this workflow.");
    const compiled = compileDraft(prompt);
    if (compiled && !compiled.ok) throw new Error(compiled.error ?? "Unable to compile the prompt.");
    const effective = applyFramingPrefix(compiled?.prompt ?? prompt, mode === "video" || imageMode === "create" ? framingSettings : null);
    const command = mode === "video"
      ? buildVideoGenerationCommand({ prompt: effective, settings: compiled?.durationSeconds ? { ...settings, duration: compiled.durationSeconds } : settings,
          imageInputs: [...imageInputs, ...(compiled?.entityInputs ?? [])], inputImage, inputAudio, useAudioTrack, enhancePrompt: false })
      : buildImageGenerationCommand(effective, settings, imageMode === "edit" && editToolMode !== "edit" ? [] : imageInputs, false,
          imageMode === "edit" && editImage ? { image: editImage, mask: editMask, outpaint: editOutpaint } : undefined);
    const images = command.inputMedia.filter((item) => item.type === "image" || (!item.type && mode === "image"));
    return {
      prompt: effective, mode, modelProfileId: mode === "video" ? settings.videoProfileId : settings.imageProfileId,
      inputImagePath: "imagePath" in command ? command.imagePath : command.edit?.image.path,
      endImagePath: images.find((item) => item.role === "end_image")?.path,
      controlImagePath: images.find((item) => item.role.startsWith("control_"))?.path,
      referenceImagePaths: images.filter((item) => item.role.startsWith("reference")).map((item) => item.path),
      inputRoles: mode === "video" ? command.inputMedia.map((item) => item.role) : undefined,
      durationSeconds: "normalizedSettings" in command ? command.normalizedSettings.duration : undefined,
    };
  });
  const submit = useCallback(async () => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    try {
    const upscaleMediaKind = mode === "image" && imageMode === "upscale"
      ? "image" as const
      : mode === "video" && videoMode === "reframe" && selectedVideoTool === "upscale"
        ? "video" as const
        : null;
    if (upscaleMediaKind) {
      if (!generateUpscale || !upscaleMethod || upscaleScale === null) return;
      const source = upscaleMediaKind === "image" ? editImage : videoToolInput;
      const sourcePath = source?.path ?? (source ? fileUrlToPath(source.url) : null);
      if (!currentProjectId || !source || !sourcePath) return;
      const upscale = { mediaKind: upscaleMediaKind, method: upscaleMethod, scale: upscaleScale, source: { ...source, path: sourcePath } };
      const snapshot = { projectId: currentProjectId, submittedAt: Date.now(), prompt: "", settings: { ...settings }, inputs: [upscale.source], assetPaths: projectAssets.map(({ url, path }) => ({ url, path })), upscale };
      const submission = upscaleMediaKind === "image"
        ? { ...snapshot, imageMode: "upscale" as const }
        : { ...snapshot, inputImage: null, inputAudio: null, videoTool: "upscale" as const };
      await generateUpscale({ sourcePath, mediaKind: upscaleMediaKind, method: upscaleMethod, scale: upscaleScale }, submission);
      return;
    }
    if (
      mode === "video" &&
      videoMode === "reframe" &&
      selectedVideoTool === "reframe"
    ) {
      if (!currentProjectId) return;
      const command = buildReframeGenerationCommand(
        prompt,
        settings,
        reframeInput,
        promptEnhancementEnabled,
      );
      if (!command) return;
      setSettings(command.normalizedSettings);
      const snapshot: ReframeSubmissionSnapshot = {
        projectId: currentProjectId,
        submittedAt: Date.now(),
        prompt: command.prompt,
        input: { ...reframeInput, padding: { ...reframeInput.padding } },
        settings: { ...command.normalizedSettings },
      };
      await generate(
        command.prompt,
        command.imagePath,
        command.settings,
        command.audioPath,
        command.inputMedia,
        command.useAudioTrack,
        undefined,
        command.reframe,
        undefined,
        { kind: "reframe-output", snapshot },
      );
      return;
    }

    if (mode === "video" && videoMode === "retake") {
      if (!currentProjectId) return;
      const command = buildRetakeGenerationCommand(prompt, retakeInput);
      if (!command) return;
      const snapshot: RetakeSubmissionSnapshot = {
        projectId: currentProjectId,
        submittedAt: Date.now(),
        prompt: command.snapshot.prompt,
        input: { ...retakeInput, ...command.snapshot.input },
      };
      await submitRetake(command.request, snapshot);
      return;
    }

    const isRegionImage = mode === "image" && imageMode === "region";
    const authoredPrompt = isRegionImage
      ? serializeRegionPrompt(regionPrompt)
      : prompt;
    const hasSequencePrompt = composer.mode === "sequence" && composer.sequence.scenes.some((scene) => scene.shots.some((shot) => shot.description.trim()));
    if (!authoredPrompt.trim() && !hasSequencePrompt && !(mode === "music" && audioSubmode === "speech" && (speechSettings?.references.length ?? 0) >= 2)) return;

    if (mode === "music" && audioSubmode === "sfx") {
      if (!currentProjectId) return;
      if (!sfxSettings || !generateSfx) return;
      const command = buildSfxGenerationCommand(prompt, sfxSettings);
      if (!command) return;
      const snapshot: SfxSubmissionSnapshot = { projectId: currentProjectId, submittedAt: Date.now(), prompt: command.request.prompt, recipe: command.recipe };
      await generateSfx(command.request, { kind: "sfx-output", snapshot });
      return;
    }

    if (mode === "music" && audioSubmode === "speech") {
      if (!currentProjectId || !speechSettings || !generateSpeech) return;
      const command = buildSpeechGenerationCommand(
        prompt,
        speechSettings,
        promptEnhancementEnabled,
      );
      if (!command) return;
      const snapshot: SpeechSubmissionSnapshot = { projectId: currentProjectId, submittedAt: Date.now(), prompt: command.request.text, recipe: command.recipe };
      await generateSpeech(command.request, { kind: "speech-output", snapshot });
      return;
    }

    if (mode === "music") {
      if (!currentProjectId) return;
      const profile =
        musicProfiles.find(
          (candidate) => candidate.id === musicSettings.profileId,
        ) ?? musicProfiles[0];
      const command = buildMusicGenerationCommand(
        prompt,
        musicSettings,
        profile,
      );
      if (!command.ok) {
        setLocalError(command.message);
        return;
      }
      const snapshot: MusicSubmissionSnapshot = {
        projectId: currentProjectId,
        submittedAt: Date.now(),
        prompt: command.prompt,
        recipe: command.snapshot,
      };
      await generateMusic(command.request, { kind: "music-output", snapshot });
      return;
    }

    if (
      mode === "video" &&
      videoMode === "reframe" &&
      selectedVideoTool !== "reframe"
    ) {
      if (selectedVideoTool === "upscale") return;
      if (!currentProjectId || !prompt.trim()) return;
      const command = buildVideoToolGenerationCommand({
        tool: selectedVideoTool,
        prompt,
        settings,
        input: videoToolInput,
        enhancePrompt: promptEnhancementEnabled,
      });
      if (!command) return;
      if (command.persistNormalizedSettings) {
        setSettings(command.normalizedSettings);
      }
      const submittedInput = videoToolInput
        ? [{
            ...videoToolInput,
            role:
              selectedVideoTool === "extend"
                ? "continue_video"
                : "control_video",
            type: "video" as const,
          }]
        : [];
      const snapshot: VideoSubmissionSnapshot = {
        projectId: currentProjectId,
        submittedAt: Date.now(),
        prompt,
        settings: { ...command.normalizedSettings },
        inputs: submittedInput,
        inputImage: null,
        inputAudio: null,
        useAudioTrack: command.useAudioTrack,
        videoTool: selectedVideoTool,
        assetPaths: projectAssets.map(({ url, path }) => ({ url, path })),
      };
      await generate(
        command.prompt,
        command.imagePath,
        command.settings,
        command.audioPath,
        command.inputMedia,
        command.useAudioTrack,
        undefined,
        undefined,
        command.videoTool,
        { kind: "video-output", snapshot },
      );
      return;
    }

    const compiledVideo = compileDraft(authoredPrompt);
    if (compiledVideo && !compiledVideo.ok) {
      setLocalError(compiledVideo.error ?? "Unable to compile video prompt.");
      return;
    }
    const effectivePrompt = enhancement.accepted?.effectivePrompt ?? applyFramingPrefix(
      compiledVideo?.prompt ?? authoredPrompt,
      mode === "video" || imageMode === "create"
        ? framingSettings
        : null,
    );

    if (mode === "image") {
      const activeEditMask =
        imageMode === "edit" && editToolMode === "retouch" ? editMask : null;
      const activeEditOutpaint =
        imageMode === "edit" && editToolMode === "reframe"
          ? editOutpaint
          : null;
      const submittedImageInputs =
        imageMode === "region" ||
        (imageMode === "edit" && editToolMode !== "edit")
          ? []
          : imageInputs;
      const command = buildImageGenerationCommand(
        effectivePrompt,
        settings,
        submittedImageInputs,
        promptEnhancementEnabled && !isRegionImage && !enhancement.accepted,
        imageMode === "edit" && editImage
          ? {
              image: editImage,
              mask: activeEditMask,
              outpaint: activeEditOutpaint,
            }
          : undefined,
      );
      if (imageMode === "edit" && !command.edit) return;
      if (!currentProjectId) return;
      const snapshotInputs =
        imageMode === "edit" && editImage
          ? [editImage, ...submittedImageInputs]
          : submittedImageInputs;
      const snapshot: ImageSubmissionSnapshot = {
        projectId: currentProjectId,
        submittedAt: Date.now(),
        prompt: effectivePrompt,
        promptEnhancement: enhancement.accepted ? { originalPrompt: authoredPrompt, effectivePrompt } : undefined,
        imageMode,
        editMask: activeEditMask
          ? {
              schemaVersion: 1,
              operations: activeEditMask.operations.map((operation) =>
                operation.kind === "brush"
                  ? {
                      ...operation,
                      points: operation.points.map((point) => ({ ...point })),
                    }
                  : { ...operation },
              ),
            }
          : undefined,
        editOutpaint: activeEditOutpaint
          ? {
              ...activeEditOutpaint,
              padding: { ...activeEditOutpaint.padding },
            }
          : undefined,
        settings: { ...settings },
        inputs: snapshotInputs.map((input) => ({ ...input })),
        assetPaths: projectAssets.map(({ url, path }) => ({ url, path })),
      };
      if (command.edit) {
        await generateImage(
          command.prompt,
          command.settings,
          command.inputMedia,
          command.edit,
          { kind: "image-output", snapshot },
        );
      } else {
        await generateImage(
          command.prompt,
          command.settings,
          command.inputMedia,
          undefined,
          { kind: "image-output", snapshot },
        );
      }
      return;
    }

    const compiledSettings = compiledVideo?.durationSeconds
      ? { ...settings, duration: compiledVideo.durationSeconds }
      : settings;
    if (!currentProjectId) return;
    let stagedEntityInputs = [];
    try {
      stagedEntityInputs = compiledVideo
        ? await stageEntityInputs(
            compiledVideo.entityInputs,
            (path) => window.electronAPI.copyToProjectAssets(path, currentProjectId, true),
            async (paths) => { await window.electronAPI.deleteProjectAssetFiles({ projectId: currentProjectId, filePaths: paths }); },
          )
        : [];
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      return;
    }
    const submittedVideoInputs = compiledVideo
      ? [
          ...imageInputs,
          ...stagedEntityInputs.map(({ created: _created, ...input }) => input),
        ]
      : imageInputs;
    const command = buildVideoGenerationCommand({
      prompt: effectivePrompt,
      settings: compiledSettings,
      imageInputs: submittedVideoInputs,
      inputImage,
      inputAudio,
      useAudioTrack,
      enhancePrompt: promptEnhancementEnabled && !enhancement.accepted,
    });
    if (command.persistNormalizedSettings) {
      setSettings(command.normalizedSettings);
    }
    const snapshot: VideoSubmissionSnapshot = {
      projectId: currentProjectId,
      submittedAt: Date.now(),
      prompt: effectivePrompt,
      promptEnhancement: enhancement.accepted ? { originalPrompt: authoredPrompt, effectivePrompt } : undefined,
      settings: { ...command.normalizedSettings },
      inputs: submittedVideoInputs.map((input) => ({ ...input })),
      inputImage,
      inputAudio,
      useAudioTrack: command.useAudioTrack,
      assetPaths: [...projectAssets.map(({ url, path }) => ({ url, path })), ...stagedEntityInputs.map(({ url, path }) => ({ url, path }))],
      composer: compiledVideo ? {
        schemaVersion: 1,
        mode: composer.mode,
        sequence: composer.sequence,
        referencedEntities: stageReferenceSnapshots(compiledVideo.snapshots, stagedEntityInputs),
        authoredBrief: authoredPrompt,
        compiledPrompt: effectivePrompt,
        resolvedDurationSeconds: compiledVideo.durationSeconds ?? command.normalizedSettings.duration,
      } : undefined,
    };
    try {
      await generate(
        command.prompt,
        command.imagePath,
        command.settings,
        command.audioPath,
        command.inputMedia,
        command.useAudioTrack,
        undefined,
        undefined,
        undefined,
        { kind: "video-output", snapshot },
      );
    } catch (error) {
      if (!(error instanceof QueueAdmissionRejectedError)) throw error;
      const createdPaths = stagedEntityInputs
        .filter((input) => input.created)
        .map((input) => input.path);
      if (createdPaths.length > 0) {
        try {
          await window.electronAPI.deleteProjectAssetFiles({
            projectId: currentProjectId,
            filePaths: createdPaths,
          });
        } catch (cleanupError) {
          console.warn("Could not clean staged reference files after video submission failed.", cleanupError);
        }
      }
      throw error;
    }
    } finally {
      submissionInFlight.current = false;
    }
  }, [
    compileDraft,
    enhancement.accepted,
    currentProjectId,
    composer,
    generate,
    generateImage,
    generateMusic,
    generateSfx,
    generateSpeech,
    generateUpscale,
    audioSubmode,
    imageInputs,
    imageMode,
    editImage,
    editToolMode,
    editMask,
    editOutpaint,
    regionPrompt,
    inputAudio,
    inputImage,
    mode,
    framingSettings,
    musicProfiles,
    musicSettings,
    sfxSettings,
    speechSettings,
    prompt,
    promptEnhancementEnabled,
    projectAssets,
    reframeInput,
    referenceEntities,
    retakeInput,
    setLocalError,
    setSettings,
    selectedVideoTool,
    settings,
    submitRetake,
    useAudioTrack,
    videoProfiles,
    videoMode,
    videoToolInput,
    upscaleMethod,
    upscaleScale,
  ]);
  return { submit, enhancement };
}
