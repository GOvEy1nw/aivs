import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Sparkles,
  Scissors,
  Expand,
  Wrench,
} from "lucide-react";
import {
  useGenSpaceHandoffs,
  useProjectAssets,
  useProjectMeta,
  useProjectNavigation,
} from "../../../contexts/ProjectContext";
import { useGeneration } from "../../../hooks/use-generation";
import { useVideoComposerState } from "./useVideoComposerState";
import { compileVideoPrompt } from "../logic/video-prompt-composer";
import { useReferenceLibrary } from "../../../contexts/ReferenceLibraryContext";
import { useRetake } from "../../../hooks/use-retake";
import {
  getQueueProgressBadges,
  useGenerationQueue,
} from "../../../contexts/GenerationQueueContext";
import { GenerationQueuePanel } from "../../../components/GenerationQueuePanel";
import {
  useImageProfiles,
  useMusicProfiles,
  useSfxProfiles,
  useSpeechProfiles,
  useVideoProfiles,
} from "../../../hooks/use-image-profiles";
import type { Asset } from "../../../types/project";
import type {
  ImageEditMaskRecipe,
  ImageEditOutpaintRecipe,
  ImageEditToolMode,
} from "../../../types/image-edit";
import type { ImageUseTarget } from "../../../components/UseImageDropdown";
import type { VideoUseTarget } from "../../../components/UseVideoDropdown";
import { getAssetModelId } from "../logic/generation-assets";
import {
  getDefaultImageInputRole,
  replaceGuideInput,
  replaceInputForRole,
} from "../logic/media-inputs";
import {
  compileMusicRequest,
} from "../music/compile-music-request";
import { useAppSettings } from "../../../contexts/AppSettingsContext";
import {
  clampGenSpaceSeed,
  DEFAULT_GENSPACE_LOCKED_SEED,
} from "../../../types/project";
import type { GenSpaceGalleryProps } from "../GenSpaceGallery";
import type { GenSpaceOverlaysProps } from "../GenSpaceOverlays";
import type { GenSpaceSelectedGenerationProps } from "../GenSpaceSelectedGeneration";
import { useGenSpaceModeState } from "./useGenSpaceModeState";
import { useGenSpaceAudioState } from "./useGenSpaceAudioState";
import { useGenSpaceSettingsState } from "./useGenSpaceSettingsState";
import { useGenSpaceGenerationActions } from "./useGenSpaceGenerationActions";
import { useGenSpaceGallery } from "./useGenSpaceGallery";
import { useGenSpaceMediaInputs } from "./useGenSpaceMediaInputs";
import type {
  FramingSettings,
  GenSpaceMediaInput,
  GenSpaceSidebarController,
} from "../types";
import { useGenSpaceVideoTools } from "./useGenSpaceVideoTools";
import { useGenSpaceUpscaleState } from "./useGenSpaceUpscaleState";
import { useGenSpaceSettingsRestore } from "./useGenSpaceSettingsRestore";
import { useGenSpaceExternalHandoffs } from "./useGenSpaceExternalHandoffs";
import {
  createEmptyRegionPrompt,
  isRegionPromptReady,
} from "../image/region-prompt";
import { getImageProfilesForMode } from "../image/image-profile-options";
import type { VideoToolId } from "../../../types/video-tools";
import { getVideoToolLabel } from "../video/video-tools";
import {
  getCompatibleVideoProfiles,
  getQuickGenWorkflow,
  isSelectedInstalledVideoProfile,
  normalizeQuickGenFavouriteWorkflows,
  reorderQuickGenFavouriteWorkflows,
  selectPreferredInstalledProfile,
  type QuickGenWorkflowId,
} from "../workflows";

export function usePromptEnhancementPreference(
  isToolsMode: boolean,
  selectedTool: VideoToolId,
) {
  const [standardEnabled, setStandardEnabled] = useState(true);
  const [toolEnabled, setToolEnabled] = useState(false);

  useEffect(() => {
    if (isToolsMode) setToolEnabled(false);
  }, [isToolsMode, selectedTool]);

  return isToolsMode
    ? ([toolEnabled, setToolEnabled] as const)
    : ([standardEnabled, setStandardEnabled] as const);
}

export function useGenSpaceController(isActive: boolean) {
  const { entities: referenceEntities } = useReferenceLibrary();
  const { currentProjectMeta, updateProjectGenSpaceSeed, updateProjectVideoComposer } = useProjectMeta();
  const { currentProjectId } = useProjectNavigation();
  const composer = useVideoComposerState(
    currentProjectId,
    currentProjectMeta?.genSpaceVideoComposer,
  );
  const {
    assets: projectAssets,
    assetBins,
    assetBinColors,
    addAsset,
    deleteTakeFromAsset,
    setAssetActiveTake,
    deleteAsset,
    updateAsset,
    toggleFavorite,
    createAssetBin,
    renameAssetBin,
    deleteAssetBin,
    setAssetBinColor,
  } = useProjectAssets();
  const {
    genSpaceEditImageUrl,
    setGenSpaceEditImageUrl,
    setGenSpaceEditMode,
    genSpaceAudioUrl,
    setGenSpaceAudioUrl,
    genSpaceRetakeSource,
    setGenSpaceRetakeSource,
  } = useGenSpaceHandoffs();
  const {
    settings: appSettings,
    updateSettings,
    saveSettings,
    isLoaded: appSettingsLoaded,
  } = useAppSettings();
  const {
    prompt,
    setPrompt,
    inputImage,
    setInputImage,
    imageInputs,
    setImageInputs,
    inputAudio,
    setInputAudio,
    useAudioTrack,
    setUseAudioTrack,
    resolveInputFileUrl,
  } = useGenSpaceMediaInputs();
  const {
    mode,
    setMode,
    imageMode,
    setImageMode,
    videoMode,
    setVideoMode,
    handleModeChange,
    handleVideoModeChange,
  } = useGenSpaceModeState({
    imageInputs,
    setImageInputs,
    setInputImage,
    setInputAudio,
    setPrompt,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const { active: activeQueueJob, cancel: cancelQueueJob } = useGenerationQueue();
  const [selectedQueueJobId, setSelectedQueueJobId] = useState<string | null>(null);
  const [framingSettings, setFramingSettings] =
    useState<FramingSettings | null>(null);
  const [regionPrompt, setRegionPrompt] = useState(createEmptyRegionPrompt);
  const [editImage, setEditImage] = useState<GenSpaceMediaInput | null>(null);
  const [editToolMode, setEditToolMode] =
    useState<ImageEditToolMode>("edit");
  const [editMask, setEditMask] = useState<ImageEditMaskRecipe | null>(null);
  const [editOutpaint, setEditOutpaint] =
    useState<ImageEditOutpaintRecipe | null>(null);
  const prevProjectIdRef = useRef<string | null>(null);
  const { profiles: imageProfiles } = useImageProfiles();
  const { profiles: videoProfiles } = useVideoProfiles();
  const { profiles: musicProfiles } = useMusicProfiles();
  const { profiles: sfxProfiles } = useSfxProfiles();
  const { profiles: speechProfiles } = useSpeechProfiles();
  const {
    settings,
    setSettings,
    imageSettings,
    patchImageSettings,
    videoSettings,
    patchVideoSettings,
    musicSettings,
    setMusicSettings,
  } = useGenSpaceSettingsState(musicProfiles);
  const { submode: audioSubmode, setSubmode: setAudioSubmode, sfxSettings, setSfxSettings, speechSettings, setSpeechSettings } =
    useGenSpaceAudioState();
  useEffect(() => {
    if (imageMode !== "edit" || editToolMode === "edit") return;
    const editProfiles = getImageProfilesForMode(imageProfiles, "edit");
    const selectedProfile =
      editProfiles.find(({ id }) => id === imageSettings.profileId) ??
      editProfiles[0];
    if (
      (editToolMode === "retouch" &&
        !selectedProfile?.capabilities.inpainting) ||
      (editToolMode === "reframe" &&
        !selectedProfile?.capabilities.outpainting)
    ) {
      setEditToolMode("edit");
    }
  }, [
    editToolMode,
    imageMode,
    imageProfiles,
    imageSettings.profileId,
  ]);
  const profileNames = useMemo(
    () =>
      new Map(
        [...imageProfiles, ...videoProfiles, ...musicProfiles, ...sfxProfiles, ...speechProfiles].map(
          (profile) => [profile.id, profile.displayName],
        ),
      ),
    [imageProfiles, musicProfiles, sfxProfiles, speechProfiles, videoProfiles],
  );
  const {
    generate,
    generateImage,
    generateUpscale,
    generateMusic,
    generateSfx,
    generateSpeech,
    composeMusicLyrics,
    isComposingLyrics,
    isGenerating,
    modelDownload,
    error,
    reset,
  } = useGeneration();
  const upscale = useGenSpaceUpscaleState();
  const activeUpscaleSelection = upscale.selectionForKind(
    mode === "image" ? "image" : "video",
  );
  const getAssetModelName = useCallback(
    (asset: Asset) => {
      const modelId = getAssetModelId(asset);
      const method = asset.generationParams?.mode === "upscale"
        ? asset.generationParams.upscale?.method
        : undefined;
      return modelId
        ? (method
          ? upscale.selectionForKind(asset.type === "video" ? "video" : "image").methods.find(({ id }) => id === method)?.label
          : profileNames.get(modelId)) ?? modelId.split("_").join(" ")
        : undefined;
    },
    [profileNames, upscale],
  );

  const {
    submitRetake,
    resetRetake,
    isRetaking,
    retakeStatus,
    retakeError,
  } = useRetake();

  const {
    retakeInput,
    reframeInput,
    isRetakeMode,
    isToolsMode,
    isReframeMode,
    panel: videoToolPanel,
    setReframeSource,
    setReframeAspectMode,
    reframePanelKey,
    handleReframePanelChange,
    selectedTool,
    setSelectedTool,
    toolInput,
    setToolInput,
  } = useGenSpaceVideoTools({
    mode,
    videoMode,
    isRetaking,
    retakeStatus,
  });
  const favouriteWorkflowIds = useMemo(
    () => normalizeQuickGenFavouriteWorkflows(appSettings.quickGenFavouriteWorkflows),
    [appSettings.quickGenFavouriteWorkflows],
  );
  const favouriteWorkflowIdsRef = useRef(favouriteWorkflowIds);
  favouriteWorkflowIdsRef.current = favouriteWorkflowIds;
  useEffect(() => {
    if (!appSettingsLoaded) return;
    if (
      favouriteWorkflowIds.length === appSettings.quickGenFavouriteWorkflows.length &&
      favouriteWorkflowIds.every((id, index) => id === appSettings.quickGenFavouriteWorkflows[index])
    ) return;
    updateSettings({ quickGenFavouriteWorkflows: favouriteWorkflowIds });
  }, [appSettings.quickGenFavouriteWorkflows, appSettingsLoaded, favouriteWorkflowIds, updateSettings]);
  const toggleFavouriteWorkflow = useCallback(
    (workflowId: QuickGenWorkflowId) => {
      updateSettings((current) => {
        const favourites = normalizeQuickGenFavouriteWorkflows(current.quickGenFavouriteWorkflows);
        return {
          ...current,
          quickGenFavouriteWorkflows: favourites.includes(workflowId)
            ? favourites.filter((id) => id !== workflowId)
            : normalizeQuickGenFavouriteWorkflows([...favourites, workflowId]),
        };
      });
    },
    [updateSettings],
  );
  const reorderFavouriteWorkflow = useCallback(
    (workflowId: QuickGenWorkflowId, targetWorkflowId: QuickGenWorkflowId) => {
      updateSettings((current) => {
        const favourites = normalizeQuickGenFavouriteWorkflows(
          current.quickGenFavouriteWorkflows,
        );
        const reordered = reorderQuickGenFavouriteWorkflows(
          favourites,
          workflowId,
          targetWorkflowId,
        );
        if (reordered.every((id, index) => id === favourites[index])) return current;
        return { ...current, quickGenFavouriteWorkflows: reordered };
      });
    },
    [updateSettings],
  );
  const confirmFavouriteOrder = useCallback(
    () =>
      saveSettings({
        quickGenFavouriteWorkflows: favouriteWorkflowIdsRef.current,
      }),
    [saveSettings],
  );
  const activeWorkflowId: QuickGenWorkflowId =
    mode === "image"
      ? imageMode === "edit"
        ? `image:${editToolMode}`
        : `image:${imageMode}`
      : mode === "video"
        ? videoMode === "reframe"
          ? `video:tool:${selectedTool}`
          : `video:${videoMode}`
        : `audio:${audioSubmode}`;
  const selectWorkflow = useCallback(
    (workflowId: QuickGenWorkflowId) => {
      const workflow = getQuickGenWorkflow(workflowId);
      if (!workflow) return;
      if (workflow.media === "image") {
        const imageWorkflow = workflowId.slice(6);
        const editWorkflow =
          imageWorkflow === "retouch" || imageWorkflow === "reframe"
            ? imageWorkflow
            : "edit";
        const nextImageMode =
          imageWorkflow === "retouch" || imageWorkflow === "reframe"
            ? "edit"
            : imageWorkflow as typeof imageMode;
        if (nextImageMode === "upscale") {
          handleModeChange("image");
          setImageMode(nextImageMode);
          return;
        }
        const compatibleProfiles = getImageProfilesForMode(
          imageProfiles,
          nextImageMode,
        )
          .filter(
            (profile) =>
              editWorkflow !== "retouch" || profile.capabilities.inpainting,
          )
          .filter(
            (profile) =>
              editWorkflow !== "reframe" || profile.capabilities.outpainting,
          );
        const candidate = selectPreferredInstalledProfile(
          compatibleProfiles,
          imageSettings.profileId,
        );
        if (nextImageMode === "edit" && !candidate) return;
        handleModeChange("image");
        setImageMode(nextImageMode);
        if (candidate && candidate.id !== imageSettings.profileId) patchImageSettings({ profileId: candidate.id });
        if (nextImageMode === "edit") setEditToolMode(editWorkflow);
        return;
      }
      if (workflow.media === "video") {
        const isUpscale = workflowId === "video:tool:upscale";
        const compatible = getCompatibleVideoProfiles(
          videoProfiles,
          workflowId as Extract<QuickGenWorkflowId, `video:${string}`>,
        );
        const candidate = isUpscale
          ? undefined
          : selectPreferredInstalledProfile(
              compatible,
              videoSettings.profileId,
            );
        if (!isUpscale && !candidate) return;
        handleModeChange("video");
        if (workflowId === "video:generate") {
          handleVideoModeChange("generate");
        } else if (workflowId === "video:retake") {
          handleVideoModeChange("retake");
        } else {
          handleVideoModeChange("reframe");
          setSelectedTool(workflowId.slice(11) as VideoToolId);
        }
        if (isUpscale) return;
        if (candidate && candidate.id !== videoSettings.profileId) {
          patchVideoSettings({ profileId: candidate.id, styleId: undefined });
        }
        return;
      }
      handleModeChange("music");
      const audioWorkflow = workflowId.slice(6) as typeof audioSubmode;
      setAudioSubmode(audioWorkflow);
      if (audioWorkflow === "music") {
        const candidate = selectPreferredInstalledProfile(musicProfiles, musicSettings.profileId);
        if (candidate && candidate.id !== musicSettings.profileId) setMusicSettings({ ...musicSettings, profileId: candidate.id });
      } else if (audioWorkflow === "sfx") {
        const candidate = selectPreferredInstalledProfile(sfxProfiles, sfxSettings.profileId);
        if (candidate && candidate.id !== sfxSettings.profileId) setSfxSettings({ ...sfxSettings, profileId: candidate.id });
      } else if (audioWorkflow === "speech") {
        const candidate = selectPreferredInstalledProfile(speechProfiles, speechSettings.profileId);
        if (candidate && candidate.id !== speechSettings.profileId) setSpeechSettings({ ...speechSettings, profileId: candidate.id });
      }
    },
    [audioSubmode, handleModeChange, handleVideoModeChange, imageMode, imageProfiles, imageSettings.profileId, musicProfiles, musicSettings, patchImageSettings, patchVideoSettings, setAudioSubmode, setImageMode, setMusicSettings, setSelectedTool, setSfxSettings, setSpeechSettings, sfxProfiles, sfxSettings, speechProfiles, speechSettings, videoProfiles, videoSettings.profileId],
  );
  const [promptEnhancementEnabled, setPromptEnhancementEnabled] =
    usePromptEnhancementPreference(isToolsMode, selectedTool);
  useGenSpaceExternalHandoffs({
    editImageUrl: genSpaceEditImageUrl,
    clearEditImage: () => setGenSpaceEditImageUrl(null),
    clearEditMode: () => setGenSpaceEditMode(null),
    audioUrl: genSpaceAudioUrl,
    clearAudio: () => setGenSpaceAudioUrl(null),
    retakeSource: genSpaceRetakeSource,
    clearRetakeSource: () => setGenSpaceRetakeSource(null),
    retakeError,
    setMode,
    setVideoMode,
    setInputImage,
    setInputAudio,
    setPrompt,
    setError: setLocalError,
  });

  const seedLocked = currentProjectMeta?.genSpaceSeedLocked ?? false;
  const lockedSeed = clampGenSpaceSeed(
    currentProjectMeta?.genSpaceLockedSeed ?? DEFAULT_GENSPACE_LOCKED_SEED,
  );

  const handleSeedChange = useCallback(
    (seed: { seedLocked: boolean; lockedSeed: number }) => {
      const nextSeed = {
        seedLocked: seed.seedLocked,
        lockedSeed: clampGenSpaceSeed(seed.lockedSeed),
      };
      if (currentProjectId) {
        updateProjectGenSpaceSeed(currentProjectId, nextSeed);
      }
      updateSettings(nextSeed);
    },
    [currentProjectId, updateProjectGenSpaceSeed, updateSettings],
  );

  useEffect(() => {
    if (!currentProjectId || composer.projectId !== currentProjectId) return;
    updateProjectVideoComposer(currentProjectId, composer.value);
  }, [composer.projectId, composer.value, currentProjectId, updateProjectVideoComposer]);

  useEffect(() => {
    if (!appSettingsLoaded) return;
    if (!currentProjectId) {
      prevProjectIdRef.current = null;
      setFramingSettings(null);
      setEditImage(null);
      setEditToolMode("edit");
      setEditMask(null);
      setEditOutpaint(null);
      return;
    }
    if (prevProjectIdRef.current === currentProjectId) return;

    prevProjectIdRef.current = currentProjectId;
    setFramingSettings(null);
    setEditImage(null);
    setEditToolMode("edit");
    setEditMask(null);
    setEditOutpaint(null);
    const projectSeed = {
      seedLocked: currentProjectMeta?.genSpaceSeedLocked ?? false,
      lockedSeed: clampGenSpaceSeed(
        currentProjectMeta?.genSpaceLockedSeed ?? DEFAULT_GENSPACE_LOCKED_SEED,
      ),
    };
    updateSettings(projectSeed);
  }, [
    appSettingsLoaded,
    currentProjectId,
    currentProjectMeta?.genSpaceSeedLocked,
    currentProjectMeta?.genSpaceLockedSeed,
    updateSettings,
  ]);

  const { submit: handleGenerate } = useGenSpaceGenerationActions({
    mode,
    imageMode,
    regionPrompt,
    videoMode,
    selectedVideoTool: selectedTool,
    videoToolInput: toolInput,
    prompt,
    framingSettings,
    promptEnhancementEnabled,
    composer: composer.value,
    referenceEntities,
    videoProfiles,
    currentProjectId,
    projectAssets,
    settings,
    setSettings,
    musicSettings,
    audioSubmode,
    sfxSettings,
    speechSettings,
    musicProfiles,
    imageInputs,
    editImage,
    editToolMode,
    editMask,
    editOutpaint,
    inputImage,
    inputAudio,
    useAudioTrack,
    reframeInput,
    retakeInput,
    setLocalError,
    generate,
    generateImage,
    generateUpscale,
    upscaleMethod: activeUpscaleSelection.method,
    upscaleScale: activeUpscaleSelection.scale,
    generateMusic,
    generateSfx,
    generateSpeech,
    submitRetake,
  });
  const handleUseImage = useCallback(
    (imageAsset: Asset, target: ImageUseTarget) => {
      const input = {
        id: crypto.randomUUID(),
        url: imageAsset.url,
        type: "image" as const,
      };
      setInputImage(null);

      if (target === "edit-image") {
        const editProfiles = getImageProfilesForMode(imageProfiles, "edit");
        const currentProfile = editProfiles.find(
          ({ id }) => id === imageSettings.profileId,
        );
        const profile = currentProfile ?? editProfiles[0];
        if (profile && profile.id !== imageSettings.profileId) {
          patchImageSettings({ profileId: profile.id });
        }
        setMode("image");
        setImageMode("edit");
        setVideoMode("generate");
        setInputAudio(null);
        setImageInputs([]);
        setEditImage({ ...input, role: "edit_image" });
        setEditToolMode("edit");
        setEditMask(null);
        setEditOutpaint(null);
        setPrompt("");
        return;
      }

      if (target === "image-guide") {
        const currentProfile = imageProfiles.find(
          ({ id }) => id === imageSettings.profileId,
        );
        const profile = currentProfile?.inputMedia.supportsImageInputs
          ? currentProfile
          : imageProfiles.find(
              ({ inputMedia }) => inputMedia.supportsImageInputs,
            );
        if (profile && profile.id !== imageSettings.profileId) {
          patchImageSettings({ profileId: profile.id });
        }
        setMode("image");
        setVideoMode("generate");
        setInputAudio(null);
        setImageInputs([
          {
            ...input,
            role: getDefaultImageInputRole(profile?.inputMedia),
          },
        ]);
        return;
      }

      const role =
        target === "first-frame" ? "start_image" : "end_image";
      setMode("video");
      setVideoMode("generate");
      setImageInputs((current) =>
        replaceInputForRole(current, { ...input, role }),
      );
      if (target === "first-frame") {
        setPrompt(imageAsset.prompt || "The scene comes to life...");
      }
    },
    [
      imageProfiles,
      imageSettings.profileId,
      patchImageSettings,
      setImageInputs,
      setEditImage,
      setEditToolMode,
      setEditMask,
      setEditOutpaint,
      setImageMode,
      setInputAudio,
      setInputImage,
      setMode,
      setPrompt,
      setVideoMode,
    ],
  );

  const handleReframe = useCallback((videoAsset: Asset) => {
    setMode("video");
    setVideoMode("reframe");
    setSelectedTool("reframe");
    setPrompt("");
    setReframeSource({
      videoUrl: videoAsset.url,
      videoPath: videoAsset.path,
      duration: videoAsset.duration,
    });
  }, [setMode, setVideoMode, setPrompt, setReframeSource, setSelectedTool]);
  const handleUseVideo = useCallback(
    (videoAsset: Asset, target: VideoUseTarget) => {
      if (target === "reframe") {
        handleReframe(videoAsset);
        return;
      }

      setMode("video");
      if (target === "reference") {
        setVideoMode("generate");
        setImageInputs((current) =>
          replaceGuideInput(current, {
            id: crypto.randomUUID(),
            url: videoAsset.url,
            path: videoAsset.path,
            role: "control_video",
            type: "video",
          }),
        );
        return;
      }

      setVideoMode("reframe");
      setSelectedTool(target);
      setPrompt("");
      setReframeSource({
        videoUrl: videoAsset.url,
        videoPath: videoAsset.path,
        duration: videoAsset.duration,
      });
    },
    [
      handleReframe,
      setImageInputs,
      setMode,
      setPrompt,
      setReframeSource,
      setSelectedTool,
      setVideoMode,
    ],
  );
  const handleUpscale = useCallback(
    (asset: Asset) => {
      setPrompt("");
      if (asset.type === "image") {
        setMode("image");
        setImageMode("upscale");
        setVideoMode("generate");
        setInputImage(null);
        setInputAudio(null);
        setImageInputs([]);
        setEditImage({
          id: crypto.randomUUID(),
          assetId: asset.id,
          url: asset.url,
          path: asset.path,
          mediaDuration: asset.duration,
          role: "upscale_source",
          type: "image",
        });
        return;
      }
      if (asset.type === "video") {
        setMode("video");
        setVideoMode("reframe");
        setSelectedTool("upscale");
        setToolInput({
          id: crypto.randomUUID(),
          assetId: asset.id,
          url: asset.url,
          path: asset.path,
          mediaDuration: asset.duration,
          role: "upscale_source",
          type: "video",
        });
      }
    },
    [
      setEditImage,
      setImageInputs,
      setImageMode,
      setInputAudio,
      setInputImage,
      setMode,
      setPrompt,
      setSelectedTool,
      setToolInput,
      setVideoMode,
    ],
  );
  const clearLocalError = useCallback(() => setLocalError(null), []);

  const handleCopySettings = useGenSpaceSettingsRestore({
    assets: projectAssets,
    settings,
    musicSettings,
    imageProfiles,
    videoProfiles,
    setMode,
    setImageMode,
    setVideoMode,
    setPrompt,
    setRegionPrompt,
    setSettings,
    setMusicSettings,
    setAudioSubmode,
    setSfxSettings,
    setSpeechSettings,
    setPromptEnhancementEnabled,
    setInputs: setImageInputs,
    setEditImage,
    setEditToolMode,
    setEditMask,
    setEditOutpaint,
    setInputImage,
    setInputAudio,
    setReframeSource,
    setVideoTool: setSelectedTool,
    setVideoToolInput: setToolInput,
    setUpscale: ({ method, scale }) => {
      upscale.setMethod(method);
      upscale.setScale(scale);
    },
    setVideoComposer: (value) => {
      if (!currentProjectId) return;
      composer.restore(value);
      updateProjectVideoComposer(currentProjectId, value);
    },
    clearError: clearLocalError,
  });
  const gallery = useGenSpaceGallery({
    assets: projectAssets,
    assetBins,
    assetBinColors,
    currentProjectId,
    isActive,
    isGenerating,
    addAsset,
    deleteAsset,
    updateAsset,
    toggleFavorite,
    createAssetBin,
    renameAssetBin,
    deleteAssetBin,
    setAssetBinColor,
    setAssetActiveTake,
    onCopySettings: handleCopySettings,
  });
  const {
    assets,
    library: galleryLibrary,
    fileInputRef: galleryFileInputRef,
    importFiles: importFilesToGallery,
    toast: galleryToast,
    isDragOver: isGalleryDragOver,
    isImporting: isGalleryImporting,
    filterActive: galleryFilterActive,
    syncInputFileToGallery,
    syncInputFileToGalleryAsset,
    rootDragHandlers,
    overlays: galleryOverlays,
  } = gallery;
  const isPanelMode = isRetakeMode || isToolsMode;
  const selectedMusicProfile =
    musicProfiles.find(
      (candidate) => candidate.id === musicSettings.profileId,
    ) ?? musicProfiles[0];
  const musicCanSubmit =
    compileMusicRequest(prompt, musicSettings, selectedMusicProfile).ok &&
    !isComposingLyrics;
  const editProfiles = getImageProfilesForMode(imageProfiles, "edit");
  const selectedEditProfile =
    editProfiles.find(({ id }) => id === imageSettings.profileId) ??
    editProfiles[0];
  const editWorkflowReady =
    editToolMode === "retouch"
      ? !!selectedEditProfile?.capabilities.inpainting &&
        !!editMask?.operations.length
      : editToolMode === "reframe"
        ? !!selectedEditProfile?.capabilities.outpainting &&
          !!editOutpaint &&
          editOutpaint.padding.top +
            editOutpaint.padding.bottom +
            editOutpaint.padding.left +
            editOutpaint.padding.right >
            0
        : true;
  const activeVideoWorkflowId: Extract<QuickGenWorkflowId, `video:${string}`> =
    isToolsMode
      ? `video:tool:${selectedTool}`
      : isRetakeMode
        ? "video:retake"
        : "video:generate";
  const selectedVideoProfileReady =
    activeVideoWorkflowId === "video:tool:upscale" ||
    isSelectedInstalledVideoProfile(
      videoProfiles,
      activeVideoWorkflowId,
      videoSettings.profileId,
    );
  const composerValidation = useMemo(() =>
    mode === "video" && videoMode === "generate"
      ? compileVideoPrompt({
          brief: prompt,
          composer: composer.value,
          entities: referenceEntities,
          fallbackSnapshots: composer.value.referencedEntities,
          reservedAliases: imageInputs.flatMap((input) => input.alias ? [input.alias] : []),
          retainedRoles: imageInputs.map((input) => input.role),
          policy: videoProfiles.find((profile) => profile.id === videoSettings.profileId)?.promptComposer ?? { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false },
        })
      : null,
    [mode, videoMode, prompt, composer.value, referenceEntities, imageInputs, videoProfiles, videoSettings.profileId],
  );
  const canSubmit = isToolsMode
    ? selectedTool === "upscale"
      ? !!toolInput && !!activeUpscaleSelection.method && activeUpscaleSelection.scale !== null && !isGenerating
      : isReframeMode
      ? selectedVideoProfileReady && reframeInput.ready && !!reframeInput.videoPath && !isGenerating
      : selectedVideoProfileReady && !!toolInput && !!prompt.trim() && !isGenerating
    : isRetakeMode
      ? selectedVideoProfileReady && retakeInput.ready && !!retakeInput.videoPath && !isRetaking
      : mode === "video"
        ? selectedVideoProfileReady && !!composerValidation?.ok && !!(composerValidation.prompt?.trim()) && !isGenerating
      : mode === "music"
      ? audioSubmode === "music"
        ? musicCanSubmit
        : audioSubmode === "sfx"
          ? !!prompt.trim() && !isGenerating
          : audioSubmode === "speech"
            ? !!speechProfiles.find((profile) => profile.id === speechSettings.profileId) && (speechSettings.references.length === 2 ? [1, 2].every((speaker) => speechSettings.segments.some((segment) => segment.speaker === speaker && segment.text.trim())) : !!prompt.trim() && (!speechProfiles.find((profile) => profile.id === speechSettings.profileId)?.speech.referenceRequired || speechSettings.references.length > 0)) && !isGenerating
            : false
      : mode === "image" && imageMode === "upscale"
        ? !!editImage && !!activeUpscaleSelection.method && activeUpscaleSelection.scale !== null && !isGenerating
        : mode === "image" && imageMode === "region"
        ? isRegionPromptReady(regionPrompt)
      : mode === "image" && imageMode === "edit"
          ? !!editImage && (editToolMode === "reframe" || !!prompt.trim()) && editWorkflowReady
          : !!prompt.trim();
  const promptButtonLabel = isToolsMode
    ? selectedTool === "upscale" ? "Upscale" : getVideoToolLabel(selectedTool)
    : isRetakeMode
      ? "Retake"
      : "Generate";
  const promptButtonIcon = isToolsMode ? (
    isReframeMode ? (
      <Expand className="h-3.5 w-3.5" />
    ) : (
      <Wrench className="h-3.5 w-3.5" />
    )
  ) : isRetakeMode ? (
    <Scissors className="h-3.5 w-3.5" />
  ) : (
    <Sparkles
      className={`h-3.5 w-3.5 ${isGenerating ? "animate-pulse" : ""}`}
    />
  );
  const promptGenerating = isRetakeMode
    ? isRetaking
    : isGenerating || isComposingLyrics;
  const promptController = {
    value: prompt,
    setValue: setPrompt,
    enhance: () => setPromptEnhancementEnabled((current) => !current),
    enhanceEnabled: promptEnhancementEnabled,
    isEnhancing: false,
    seedLocked,
    lockedSeed,
    setSeed: handleSeedChange,
  };
  const generationController = {
    submit: handleGenerate,
    canSubmit,
    isRunning: promptGenerating,
    label: promptButtonLabel,
    icon: promptButtonIcon,
  };
  const sidebarController: GenSpaceSidebarController = {
    mode,
    setMode: handleModeChange,
    workflow: {
      activeId: activeWorkflowId,
      select: selectWorkflow,
      favouriteIds: favouriteWorkflowIds,
      toggleFavourite: toggleFavouriteWorkflow,
      reorderFavourite: reorderFavouriteWorkflow,
      confirmFavouriteOrder,
    },
    image: {
      prompt: promptController,
      generation: generationController,
      settings: {
        value: imageSettings,
        patch: patchImageSettings,
      },
      media: {
        inputs: imageInputs,
        setInputs: setImageInputs,
        resolveInputFileUrl,
        syncInputFileToGallery,
      },
      profiles: {
        options: imageProfiles,
        modelDownload,
      },
      imageTools: {
        mode: imageMode,
        setMode: (nextMode) => selectWorkflow(`image:${nextMode}`),
        editImage,
        setEditImage,
        editToolMode,
        setEditToolMode,
        editMask,
        setEditMask,
        editOutpaint,
        setEditOutpaint,
        regionPrompt,
        setRegionPrompt,
      },
      upscale: {
        mediaKind: "image",
        input: editImage,
        setInput: setEditImage,
        methods: upscale.selectionForKind("image").methods,
        method: upscale.selectionForKind("image").method,
        setMethod: upscale.setMethod,
        scale: upscale.selectionForKind("image").scale,
        setScale: upscale.setScale,
        catalogError: upscale.catalogError,
        isCatalogLoading: upscale.isCatalogLoading,
        retryCatalog: upscale.retryCatalog,
      },
      framing: {
        value: framingSettings,
        setValue: setFramingSettings,
      },
      workflow: {
        favouriteIds: favouriteWorkflowIds,
        toggleFavourite: toggleFavouriteWorkflow,
        select: selectWorkflow,
      },
    },
    video: {
      prompt: promptController,
      generation: generationController,
      settings: {
        value: videoSettings,
        patch: patchVideoSettings,
      },
      media: {
        inputImage,
        setInputImage,
        inputAudio,
        setInputAudio,
        inputs: imageInputs,
        setInputs: setImageInputs,
        useAudioTrack,
        setUseAudioTrack,
        resolveInputFileUrl,
        syncInputFileToGallery,
      },
      profiles: {
        options: videoProfiles,
        modelDownload,
      },
      videoTools: {
        mode: videoMode,
        setMode: (nextMode) =>
          selectWorkflow(
            nextMode === "reframe"
              ? `video:tool:${selectedTool}`
              : `video:${nextMode}`,
          ),
        panel: videoToolPanel,
        reframeDurationSeconds: reframeInput.duration,
        reframeAspectMode: reframeInput.aspectMode,
        reframePadding: reframeInput.padding,
        reframePanelKey,
        onReframePanelChange: handleReframePanelChange,
        setReframeAspectMode,
        selectedTool,
        setSelectedTool: (tool) => selectWorkflow(`video:tool:${tool}`),
        toolInput,
        setToolInput,
      },
      upscale: {
        mediaKind: "video",
        input: toolInput,
        setInput: setToolInput,
        methods: upscale.selectionForKind("video").methods,
        method: upscale.selectionForKind("video").method,
        setMethod: upscale.setMethod,
        scale: upscale.selectionForKind("video").scale,
        setScale: upscale.setScale,
        catalogError: upscale.catalogError,
        isCatalogLoading: upscale.isCatalogLoading,
        retryCatalog: upscale.retryCatalog,
      },
      framing: {
        value: framingSettings,
        setValue: setFramingSettings,
      },
      composer,
      workflow: {
        favouriteIds: favouriteWorkflowIds,
        toggleFavourite: toggleFavouriteWorkflow,
      },
    },
    audio: {
      submode: audioSubmode,
      setSubmode: (submode) => selectWorkflow(`audio:${submode}`),
      workflow: {
        favouriteIds: favouriteWorkflowIds,
        toggleFavourite: toggleFavouriteWorkflow,
      },
      music: {
        prompt: promptController,
        generation: generationController,
        media: {
          resolveInputFileUrl,
          syncInputFileToGallery,
        },
        profiles: {
          options: musicProfiles,
          modelDownload,
        },
        music: {
          settings: musicSettings,
          setSettings: setMusicSettings,
          composeLyrics: composeMusicLyrics,
          isComposingLyrics,
        },
      },
      sfx:
        sfxProfiles.length > 0
          ? {
              prompt: promptController,
              settings: sfxSettings,
              setSettings: setSfxSettings,
              profiles: { options: sfxProfiles, modelDownload },
              media: {
                resolveInputFileUrl,
                syncInputFileToGallery,
              },
              isRunning: isGenerating,
              submit: handleGenerate,
            }
          : undefined,
      speech:
        speechProfiles.length > 0
          ? { prompt: promptController, settings: speechSettings, setSettings: setSpeechSettings, profiles: { options: speechProfiles, modelDownload }, media: { resolveInputFileUrl, syncInputFileToGalleryAsset }, isRunning: isGenerating, submit: handleGenerate }
          : undefined,
    },
  };

  useEffect(() => {
    if (selectedQueueJobId && selectedQueueJobId !== activeQueueJob?.id) {
      setSelectedQueueJobId(null);
    }
  }, [activeQueueJob?.id, selectedQueueJobId]);
  useEffect(() => {
    if (galleryOverlays.selectedAsset) setSelectedQueueJobId(null);
  }, [galleryOverlays.selectedAsset]);
  const queueGeneration = useMemo<GenSpaceGalleryProps["generation"]>(() => {
    const progress = activeQueueJob?.progress;
    const statusDetails = getQueueProgressBadges(progress);
    const modelLifecycleActive =
      progress?.phase === "checking_model_files" ||
      progress?.phase === "loading_model";
    return {
      mode: activeQueueJob?.summary.mediaKind === "audio"
        ? "music"
        : activeQueueJob?.summary.mediaKind ?? mode,
      isRunning: Boolean(activeQueueJob),
      isSelected: selectedQueueJobId === activeQueueJob?.id,
      isCancelling: activeQueueJob?.status === "cancel_requested",
      previewUrl: progress?.previewUrl ?? null,
      modelDownload: progress?.modelDownload ?? null,
      modelLifecycleActive,
      statusMessage: progress?.statusDetail ?? progress?.phase ?? activeQueueJob?.status ?? "",
      progress: progress?.percent ?? 0,
      badges: [...(activeQueueJob?.summary.badges ?? []), ...statusDetails],
      modelName: activeQueueJob?.summary.modelLabel ?? activeQueueJob?.summary.label ?? "",
      onSelect: () => activeQueueJob && setSelectedQueueJobId(activeQueueJob.id),
      cancel: () => { if (activeQueueJob) void cancelQueueJob(activeQueueJob.id); },
    };
  }, [activeQueueJob, cancelQueueJob, mode, selectedQueueJobId]);

  const handleImportFiles = useCallback(
    (files: File[]) => void importFilesToGallery(files),
    [importFilesToGallery],
  );
  const handleCopyPrompt = useCallback(
    (value: string) => {
      void navigator.clipboard.writeText(value);
      galleryOverlays.setCopiedPrompt(true);
      window.setTimeout(() => galleryOverlays.setCopiedPrompt(false), 2000);
    },
    [galleryOverlays.setCopiedPrompt],
  );

  return {
    rootProps: {
      className: "relative h-full bg-app-bg",
    },
    gallery: {
      dropZoneProps: {
        onDragEnter: !isPanelMode ? rootDragHandlers.onDragEnter : undefined,
        onDragOver: !isPanelMode ? rootDragHandlers.onDragOver : undefined,
        onDragLeave: !isPanelMode ? rootDragHandlers.onDragLeave : undefined,
        onDrop: !isPanelMode ? rootDragHandlers.onDrop : undefined,
      },
      library: galleryLibrary,
      fileInputRef: galleryFileInputRef,
      onImportFiles: handleImportFiles,
      toast: galleryToast,
      isDragOver: isGalleryDragOver,
      isImporting: isGalleryImporting,
      filterActive: galleryFilterActive,
      isPanelMode,
      generation: queueGeneration,
      queue: <GenerationQueuePanel selectedJobId={selectedQueueJobId} onSelectActive={(jobId) => {
        galleryOverlays.setSelectedAsset(null);
        setSelectedQueueJobId(jobId);
      }} />,
    } satisfies GenSpaceGalleryProps,
    selectedGeneration: {
      asset: galleryOverlays.selectedAsset,
      modelName: galleryOverlays.selectedAsset
        ? getAssetModelName(galleryOverlays.selectedAsset)
        : undefined,
      generation: queueGeneration,
      selectedIndex: galleryOverlays.selectedIndex,
      visibleAssetCount: galleryLibrary.visibleAssets.length,
      copiedPrompt: galleryOverlays.copiedPrompt,
      canGoPrev: galleryOverlays.canGoPrev,
      canGoNext: galleryOverlays.canGoNext,
      onClose: () => {
        if (selectedQueueJobId) setSelectedQueueJobId(null);
        else galleryOverlays.setSelectedAsset(null);
      },
      onPrevious: galleryOverlays.goToPrev,
      onNext: galleryOverlays.goToNext,
      onCopyPrompt: handleCopyPrompt,
      onToggleFavorite: (asset: Asset) => {
        if (currentProjectId) toggleFavorite(currentProjectId, asset.id);
      },
      onUseImage: handleUseImage,
      onUseVideo: handleUseVideo,
      onUpscale: handleUpscale,
      onCopySettings: handleCopySettings,
      onDelete: (asset: Asset) =>
        galleryOverlays.requestDeleteAssets([asset.id]),
      onSelectTake: (assetId: string, takeIndex: number) => {
        if (currentProjectId) setAssetActiveTake(currentProjectId, assetId, takeIndex);
      },
    } satisfies GenSpaceSelectedGenerationProps,
    sidebar: sidebarController,
    overlays: {
      duplicateFilenameChoice: galleryOverlays.duplicateFilenameChoice,
      onDuplicateFilenameChoice: galleryOverlays.chooseDuplicate,
      takesAsset: galleryOverlays.takesAsset,
      onCloseTakes: () => galleryOverlays.setTakesViewAssetId(null),
      onSelectTake: (assetId: string, takeIndex: number) => {
        if (currentProjectId) {
          setAssetActiveTake(currentProjectId, assetId, takeIndex);
        }
      },
      contextMenu: galleryOverlays.contextMenu,
      contextAsset: galleryOverlays.contextAsset,
      contextSelectedAssetIds: galleryOverlays.contextSelectedAssetIds,
      contextMenuRef: galleryOverlays.contextMenuRef,
      assets,
      bins: galleryOverlays.bins,
      binColors: assetBinColors,
      currentProjectId,
      onToggleFavorite: (asset: Asset) => {
        if (currentProjectId) toggleFavorite(currentProjectId, asset.id);
      },
      onUseImage: handleUseImage,
      onUseVideo: handleUseVideo,
      onCopySettings: handleCopySettings,
      setAssetActiveTake,
      setTakesViewAssetId: galleryOverlays.setTakesViewAssetId,
      setContextSelectedAssetIds: galleryOverlays.setContextSelectedAssetIds,
      setAssetContextMenu: galleryOverlays.setAssetContextMenu,
      updateAsset,
      addAsset,
      deleteAsset,
      requestDeleteAssets: galleryOverlays.requestDeleteAssets,
      deleteTakeFromAsset,
      pendingDeleteCount: galleryOverlays.pendingAssetIds.length,
      cancelDelete: galleryOverlays.cancelDeleteAssets,
      confirmDelete: () => void galleryOverlays.confirmDeleteAssets(),
      error: error || localError,
      dismissError: () => {
        if (error) reset();
        if (localError) {
          setLocalError(null);
          resetRetake();
        }
      },
    } satisfies GenSpaceOverlaysProps,
  };
}
