import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ModelProfile } from "../../../types/model-profiles";
import type { MusicSettings } from "../../../types/music";
import type { Asset } from "../../../types/project";
import type {
  ImageEditMaskRecipe,
  ImageEditOutpaintRecipe,
  ImageEditToolMode,
} from "../../../types/image-edit";
import type { GenSpaceSettings } from "../constants";
import type { ReframeAspectMode } from "../video/reframe-outpaint";
import { buildGenSpaceRestorePlan } from "../logic/settings-restore";
import type {
  GenSpaceMediaInput,
  GenSpaceMode,
  ImageProcessMode,
  VideoProcessMode,
} from "../types";
import type { VideoToolId } from "../../../types/video-tools";
import type { AudioSubMode } from "../types";
import type { SfxSettings } from "../../../types/sfx";
import type { SpeechSettings } from "../../../types/speech";
import type { VideoComposerStateV1 } from "../../../types/video-composer";
import type { AppliedPromptEnhancement } from "./usePromptEnhancement";
import {
  parseRegionPrompt,
  type RegionPromptState,
} from "../image/region-prompt";

export function useGenSpaceSettingsRestore({
  assets,
  settings,
  musicSettings,
  imageProfiles,
  videoProfiles,
  setMode,
  setImageMode,
  setVideoMode,
  setPromptForMode,
  setRegionPrompt,
  setSettings,
  setMusicSettings,
  setAudioSubmode,
  setSfxSettings,
  setSpeechSettings,
  setPromptEnhancementEnabled,
  restorePromptEnhancement,
  setInputs,
  setEditImage,
  setEditToolMode,
  setEditMask,
  setEditOutpaint,
  setInputImage,
  setInputAudio,
  setUseAudioTrack,
  setReframeSource,
  setVideoTool,
  setVideoToolInput,
  setUpscale,
  setVideoComposer,
  clearError,
}: {
  assets: Asset[];
  settings: GenSpaceSettings;
  musicSettings: MusicSettings;
  imageProfiles: ModelProfile[];
  videoProfiles: ModelProfile[];
  setMode: (mode: GenSpaceMode) => void;
  setImageMode: (mode: ImageProcessMode) => void;
  setVideoMode: (mode: VideoProcessMode) => void;
  setPromptForMode: (
    mode: GenSpaceMode,
    prompt: string,
    audioSubmode?: AudioSubMode,
  ) => void;
  setRegionPrompt: (value: RegionPromptState) => void;
  setSettings: Dispatch<SetStateAction<GenSpaceSettings>>;
  setMusicSettings: Dispatch<SetStateAction<MusicSettings>>;
  setAudioSubmode: (mode: AudioSubMode) => void;
  setSfxSettings: Dispatch<SetStateAction<SfxSettings>>;
  setSpeechSettings: Dispatch<SetStateAction<SpeechSettings>>;
  setPromptEnhancementEnabled: (enabled: boolean) => void;
  restorePromptEnhancement?: (value: AppliedPromptEnhancement | null) => void;
  setInputs: Dispatch<SetStateAction<GenSpaceMediaInput[]>>;
  setEditImage: (image: GenSpaceMediaInput | null) => void;
  setEditToolMode: (mode: ImageEditToolMode) => void;
  setEditMask: (mask: ImageEditMaskRecipe | null) => void;
  setEditOutpaint: (outpaint: ImageEditOutpaintRecipe | null) => void;
  setInputImage: (url: string | null) => void;
  setInputAudio: (url: string | null) => void;
  setUseAudioTrack: (value: boolean) => void;
  setReframeSource: (source: {
    videoUrl: string;
    videoPath: string;
    duration?: number;
    aspectMode?: ReframeAspectMode;
    padding?: { top: number; bottom: number; left: number; right: number };
  }) => void;
  setVideoTool: (tool: VideoToolId) => void;
  setVideoToolInput: (input: GenSpaceMediaInput | null) => void;
  setUpscale: (value: { method: import("../../../types/upscale").UpscaleMethodId; scale: number }) => void;
  setVideoComposer: (value: VideoComposerStateV1) => void;
  clearError: () => void;
}) {
  const pendingMedia = useRef<{
    imageInputs: GenSpaceMediaInput[];
    editImage: GenSpaceMediaInput | null;
    inputImage: string | null;
    inputAudio: string | null;
    upscaleSource?: GenSpaceMediaInput | null;
    mode: GenSpaceMode;
    enhancement?: AppliedPromptEnhancement;
  } | null>(null);
  const [version, setVersion] = useState(0);

  const restore = useCallback(
    (asset: Asset) => {
      const plan = buildGenSpaceRestorePlan(
        asset,
        assets,
        settings,
        musicSettings,
      );
      if (!plan) return;
      clearError();
      pendingMedia.current = { ...plan.media, mode: plan.mode, enhancement: asset.generationParams?.promptEnhancement };
      setInputs([]);
      setVideoToolInput(null);
      setEditImage(null);
      setInputImage(null);
      setInputAudio(null);
      setUseAudioTrack(asset.generationParams?.useAudioTrack === true);
      setMode(plan.mode);
      if (plan.mode === "image") {
        setImageMode(plan.imageMode);
        if (plan.imageMode === "region") {
          setRegionPrompt(parseRegionPrompt(plan.prompt));
        } else {
          setPromptForMode(
            "image",
            asset.generationParams?.promptEnhancement?.originalPrompt ?? plan.prompt,
          );
        }
      } else {
        setPromptForMode(
          plan.mode,
          asset.generationParams?.videoComposer?.authoredBrief ?? asset.generationParams?.promptEnhancement?.originalPrompt ?? plan.prompt,
          plan.speechSettings ? "speech" : plan.sfxSettings ? "sfx" : "music",
        );
      }
      setVideoMode(plan.videoMode);
      setVideoTool(plan.videoTool);
      const savedComposer = asset.generationParams?.videoComposer;
      if (savedComposer?.schemaVersion === 1) {
        setVideoComposer({
          schemaVersion: 1,
          mode: savedComposer.mode,
          sequence: savedComposer.sequence,
          referencedEntities: savedComposer.referencedEntities,
        });
      }
      setVideoToolInput(plan.media.videoToolInput);
      if (plan.media.upscaleSource && asset.generationParams?.upscale) {
        setUpscale({ method: asset.generationParams.upscale.method, scale: asset.generationParams.upscale.scale });
        if (asset.generationParams.upscale.mediaKind === "image") setEditImage(plan.media.upscaleSource);
        else setVideoToolInput(plan.media.upscaleSource);
      }
      setEditToolMode(plan.editToolMode);
      setEditMask(plan.editMask);
      setEditOutpaint(plan.editOutpaint);
      setSettings(plan.settings);
      if (asset.generationParams?.promptEnhancement) setPromptEnhancementEnabled(false);
      if (plan.musicSettings) setMusicSettings(plan.musicSettings);
      if (plan.sfxSettings) {
        setAudioSubmode("sfx");
        setSfxSettings(plan.sfxSettings);
      } else if (plan.speechSettings) {
        setAudioSubmode("speech");
        setSpeechSettings(plan.speechSettings);
        if (plan.speechPromptEnhancement !== null) {
          setPromptEnhancementEnabled(plan.speechPromptEnhancement);
        }
      } else if (plan.mode === "music") {
        setAudioSubmode("music");
      }
      if (plan.reframe) setReframeSource(plan.reframe);
      setVersion((current) => current + 1);
    },
    [
      assets,
      clearError,
      musicSettings,
      setInputAudio,
      setUseAudioTrack,
      setInputImage,
      setInputs,
      setEditImage,
      setEditToolMode,
      setEditMask,
      setEditOutpaint,
      setImageMode,
      setMode,
      setMusicSettings,
      setAudioSubmode,
      setSfxSettings,
      setSpeechSettings,
      setPromptEnhancementEnabled,
      setPromptForMode,
      setRegionPrompt,
      setReframeSource,
      setSettings,
      setVideoMode,
      setVideoTool,
      setVideoComposer,
      setVideoToolInput,
      setUpscale,
      settings,
    ],
  );

  useEffect(() => {
    const pending = pendingMedia.current;
    if (!pending) return;
    const hasMedia =
      pending.imageInputs.length > 0 ||
      pending.editImage ||
      pending.inputImage ||
      pending.inputAudio;
    if (!hasMedia) {
      pendingMedia.current = null;
      restorePromptEnhancement?.(pending.enhancement ?? null);
      return;
    }
    if (pending.mode === "image" && imageProfiles.length === 0) return;
    if (pending.mode === "video" && videoProfiles.length === 0) return;
    pendingMedia.current = null;
    setInputs(pending.imageInputs);
    setEditImage(
      pending.mode === "image" && pending.upscaleSource
        ? pending.upscaleSource
        : pending.editImage,
    );
    setInputImage(pending.inputImage);
    setInputAudio(pending.inputAudio);
    restorePromptEnhancement?.(pending.enhancement ?? null);
  }, [
    imageProfiles.length,
    setInputAudio,
    setInputImage,
    setInputs,
    setEditImage,
    version,
    videoProfiles.length,
    restorePromptEnhancement,
  ]);

  return restore;
}
