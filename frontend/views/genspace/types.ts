import type {
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import type { ModelProfile } from "../../types/model-profiles";
import type {
  ComposeMusicLyricsRequest,
  MusicSettings,
  SubmittedMusicRecipe,
} from "../../types/music";
import type { ModelDownloadProgress } from "../../types/progress";
import type { MediaCropRecipe } from "../../types/media-crop";
import type {
  ImageEditMaskRecipe,
  ImageEditOutpaintRecipe,
  ImageEditToolMode,
} from "../../types/image-edit";
import type { RegionPromptState } from "./image/region-prompt";
import type { ReframePanelState } from "./video/ReframePanel";
import type { ReframeAspectMode } from "./video/reframe-outpaint";
import type { VideoToolId } from "../../types/video-tools";
import type { GenSpaceSettings } from "./constants";
import type { SfxGenerationRecipeV1, SfxSettings } from "../../types/sfx";
import type { SpeechGenerationRecipe, SpeechSettings } from "../../types/speech";
import type { Asset } from "../../types/project";
import type { UpscaleMediaKind, UpscaleMethod, UpscaleMethodId } from "../../types/upscale";
import type { QuickGenWorkflowId } from "./workflows";
import type { VideoComposerStateV1, VideoComposerSubmissionV1, VideoSequenceScene, VideoSequenceShot } from "../../types/video-composer";
import type { ReferenceEntity } from "../../../shared/reference-library";

export type GenSpaceMode = "image" | "video" | "music";
export type AudioSubMode = "music" | "speech" | "sfx" | "mixer";
export type ImageProcessMode = "create" | "edit" | "region" | "upscale";
export type VideoProcessMode = "generate" | "reframe" | "retake";
export type GenSpaceMediaKind = "image" | "video" | "audio";

export interface FramingSettings {
  camera: string;
  lens: string;
  focalLength: string;
  aperture: string;
  shutter: string;
  iso: string;
}

export interface GenSpaceMediaInput {
  id: string;
  assetId?: string;
  alias?: string;
  url: string;
  path?: string;
  role: string;
  type?: GenSpaceMediaKind;
  useAudioTrack?: boolean;
  trimStartTime?: number;
  trimDuration?: number;
  mediaDuration?: number;
  crop?: MediaCropRecipe;
}

export interface ImageGenSettings {
  profileId: string;
  resolution: string;
  aspectRatio: string;
  steps: number;
  variations: number;
  inputRole?: string;
}

export interface VideoGenSettings {
  model: "fast" | "pro";
  profileId: string;
  duration: number;
  resolution: string;
  fps: number;
  aspectRatio: string;
  audio: boolean;
  styleId?: string;
}

export interface GenSpacePromptController {
  enhanceDraft?: () => void;
  enhancementReview?: import("./hooks/usePromptEnhancement").PromptEnhancementReview;
  value: string;
  setValue: (value: string) => void;
  enhance: () => void;
  enhanceEnabled: boolean;
  isEnhancing: boolean;
  seedLocked: boolean;
  lockedSeed: number;
  setSeed: (seed: { seedLocked: boolean; lockedSeed: number }) => void;
}

export interface GenSpaceGenerationController {
  submit: () => void;
  canSubmit: boolean;
  isRunning: boolean;
  label: string;
  icon: ReactNode;
}

export interface ImageGenSettingsController {
  value: ImageGenSettings;
  patch: (patch: Partial<ImageGenSettings>) => void;
}

export interface VideoGenSettingsController {
  value: VideoGenSettings;
  patch: (patch: Partial<VideoGenSettings>) => void;
}

export interface GenSpaceMediaController {
  inputImage: string | null;
  setInputImage: (url: string | null) => void;
  inputAudio: string | null;
  setInputAudio: (url: string | null) => void;
  inputs: GenSpaceMediaInput[];
  setInputs: Dispatch<SetStateAction<GenSpaceMediaInput[]>>;
  useAudioTrack: boolean;
  setUseAudioTrack: (value: boolean) => void;
  resolveInputFileUrl: (
    file: File,
    sync?: (file: File) => Promise<string | null>,
  ) => Promise<string | null>;
  syncInputFileToGallery?: (file: File) => Promise<string | null>;
}

export interface GenSpacePanelProfiles {
  options: ModelProfile[];
  modelDownload: ModelDownloadProgress | null;
}

export interface GenSpaceMusicController {
  settings: MusicSettings;
  setSettings: (settings: MusicSettings) => void;
  composeLyrics: (
    request: ComposeMusicLyricsRequest,
  ) => Promise<string | null>;
  isComposingLyrics: boolean;
}

export interface GenSpaceVideoToolsController {
  mode: VideoProcessMode;
  setMode: (mode: VideoProcessMode) => void;
  panel: () => ReactNode;
  reframeDurationSeconds: number;
  reframeAspectMode: ReframeAspectMode;
  reframePadding: ReframePanelState["padding"];
  reframePanelKey: number;
  onReframePanelChange: (input: ReframePanelState) => void;
  setReframeAspectMode: (aspectMode: ReframeAspectMode) => void;
  selectedTool: VideoToolId;
  setSelectedTool: (tool: VideoToolId) => void;
  toolInput: GenSpaceMediaInput | null;
  setToolInput: (input: GenSpaceMediaInput | null) => void;
}

export interface GenSpaceImageToolsController {
  mode: ImageProcessMode;
  setMode: (mode: ImageProcessMode) => void;
  editImage: GenSpaceMediaInput | null;
  setEditImage: (image: GenSpaceMediaInput | null) => void;
  editToolMode: ImageEditToolMode;
  setEditToolMode: (mode: ImageEditToolMode) => void;
  editMask: ImageEditMaskRecipe | null;
  setEditMask: (mask: ImageEditMaskRecipe | null) => void;
  editOutpaint: ImageEditOutpaintRecipe | null;
  setEditOutpaint: (outpaint: ImageEditOutpaintRecipe | null) => void;
  regionPrompt: RegionPromptState;
  setRegionPrompt: (value: RegionPromptState) => void;
}

export interface GenSpaceFramingController {
  value: FramingSettings | null;
  setValue: (value: FramingSettings | null) => void;
}

export interface ImageGenPanelController {
  prompt: GenSpacePromptController;
  generation: GenSpaceGenerationController;
  settings: ImageGenSettingsController;
  media: Pick<
    GenSpaceMediaController,
    | "inputs"
    | "setInputs"
    | "resolveInputFileUrl"
    | "syncInputFileToGallery"
  >;
  profiles: GenSpacePanelProfiles;
  imageTools: GenSpaceImageToolsController;
  upscale: GenSpaceUpscaleController;
  framing: GenSpaceFramingController;
  workflow?: Pick<
    GenSpaceSidebarController["workflow"],
    "favouriteIds" | "toggleFavourite" | "select"
  >;
}

export interface VideoGenPanelController {
  prompt: GenSpacePromptController;
  generation: GenSpaceGenerationController;
  settings: VideoGenSettingsController;
  media: GenSpaceMediaController;
  profiles: GenSpacePanelProfiles;
  videoTools: GenSpaceVideoToolsController;
  upscale: GenSpaceUpscaleController;
  framing: GenSpaceFramingController;
  composer: {
    value: VideoComposerStateV1;
    setMode: (mode: VideoComposerStateV1["mode"]) => void;
    updateScene: (id: string, patch: Partial<VideoSequenceScene>) => void;
    updateShot: (sceneId: string, shotId: string, patch: Partial<VideoSequenceShot>) => void;
    selectLocation: (sceneId: string, location: Extract<ReferenceEntity, { kind: "location" }>) => void;
    addScene: () => void;
    addShot: (sceneId: string) => void;
    removeScene: (id: string) => void;
    removeShot: (sceneId: string, shotId: string) => void;
    moveScene: (id: string, offset: number) => void;
    moveShot: (sceneId: string, shotId: string, offset: number) => void;
  };
  workflow?: Pick<GenSpaceSidebarController["workflow"], "favouriteIds" | "toggleFavourite">;
}

export interface MusicGenPanelController {
  prompt: GenSpacePromptController;
  generation: GenSpaceGenerationController;
  media: Pick<
    GenSpaceMediaController,
    "resolveInputFileUrl" | "syncInputFileToGallery"
  >;
  profiles: GenSpacePanelProfiles;
  music: GenSpaceMusicController;
}

export interface AudioGenPanelController {
  submode: AudioSubMode;
  setSubmode: (submode: AudioSubMode) => void;
  music: MusicGenPanelController;
  sfx?: SfxGenPanelController;
  speech?: SpeechGenPanelController;
  workflow?: Pick<GenSpaceSidebarController["workflow"], "favouriteIds" | "toggleFavourite">;
}

export interface SfxGenPanelController {
  prompt: GenSpacePromptController;
  settings: SfxSettings;
  setSettings: (settings: SfxSettings) => void;
  profiles: GenSpacePanelProfiles;
  media: Pick<
    GenSpaceMediaController,
    "resolveInputFileUrl" | "syncInputFileToGallery"
  >;
  isRunning: boolean;
  submit: () => void;
}

export interface GenSpaceUpscaleController {
  mediaKind: UpscaleMediaKind;
  input: GenSpaceMediaInput | null;
  setInput: (input: GenSpaceMediaInput | null) => void;
  methods: UpscaleMethod[];
  method: UpscaleMethodId | null;
  setMethod: (method: UpscaleMethodId) => void;
  scale: number | null;
  setScale: (scale: number) => void;
  catalogError: string | null;
  isCatalogLoading: boolean;
  retryCatalog: () => void;
}

export interface SpeechGenPanelController {
  prompt: GenSpacePromptController;
  settings: SpeechSettings;
  setSettings: (settings: SpeechSettings) => void;
  profiles: GenSpacePanelProfiles;
  media: Pick<GenSpaceMediaController, "resolveInputFileUrl"> & {
    syncInputFileToGalleryAsset: (file: File) => Promise<Asset | null>;
  };
  isRunning: boolean;
  submit: () => void;
}

export interface GenSpaceSidebarController {
  mode: GenSpaceMode;
  setMode: (mode: GenSpaceMode) => void;
  workflow: {
    activeId: QuickGenWorkflowId;
    select: (workflowId: QuickGenWorkflowId) => void;
    favouriteIds: readonly QuickGenWorkflowId[];
    toggleFavourite: (workflowId: QuickGenWorkflowId) => void;
    reorderFavourite: (
      workflowId: QuickGenWorkflowId,
      targetWorkflowId: QuickGenWorkflowId,
    ) => void;
    confirmFavouriteOrder: () => Promise<void>;
  };
  image: ImageGenPanelController;
  video: VideoGenPanelController;
  audio: AudioGenPanelController;
}

export interface ImageSubmissionSnapshot {
  promptEnhancement?: import("./hooks/usePromptEnhancement").AppliedPromptEnhancement;
  projectId: string;
  submittedAt?: number;
  prompt: string;
  imageMode?: ImageProcessMode;
  editMask?: ImageEditMaskRecipe;
  editOutpaint?: ImageEditOutpaintRecipe;
  settings: GenSpaceSettings;
  inputs: GenSpaceMediaInput[];
  assetPaths: Array<{ url: string; path: string }>;
  upscale?: { mediaKind: UpscaleMediaKind; method: UpscaleMethodId; scale: number; source: GenSpaceMediaInput };
}

export interface VideoSubmissionSnapshot extends ImageSubmissionSnapshot {
  inputImage: string | null;
  inputAudio: string | null;
  useAudioTrack: boolean;
  videoTool?: VideoToolId;
  composer?: VideoComposerSubmissionV1;
}

export interface MusicSubmissionSnapshot {
  projectId: string;
  submittedAt?: number;
  prompt: string;
  recipe: SubmittedMusicRecipe;
}

export interface SfxSubmissionSnapshot {
  projectId: string;
  submittedAt?: number;
  prompt: string;
  recipe: SfxGenerationRecipeV1;
}

export interface SpeechSubmissionSnapshot {
  projectId: string;
  submittedAt?: number;
  prompt: string;
  recipe: SpeechGenerationRecipe;
}

export interface ReframeSubmissionSnapshot {
  projectId: string;
  submittedAt?: number;
  prompt: string;
  input: ReframePanelState;
  settings: GenSpaceSettings;
}

export interface RetakeSubmissionSnapshot {
  projectId: string;
  submittedAt?: number;
  prompt: string;
  input: {
    videoPath: string | null;
    startTime: number;
    duration: number;
    videoDuration: number;
  };
}
