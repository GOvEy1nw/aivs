import { Clock, Image, Monitor, Music, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StylesLibraryModal } from "../../../components/StylesLibraryModal";
import { ModelPicker } from "../../../components/ModelPicker";
import { SettingsDropdown } from "../../../components/SettingsDropdown";
import { isModelProfileInstalled } from "../../../lib/model-profile-availability";
import { detectMediaType } from "../../../lib/media-import";
import { AUDIO_MEDIA_ROLE_SET, GUIDE_MEDIA_ROLE_SET } from "../constants";
import { AspectRatioDropdown } from "../components/AspectRatioDropdown";
import { FramingControl } from "../components/FramingControl";
import { GenerateButton } from "../components/GenerateButton";
import { GenPanelSection } from "../components/GenPanelSection";
import { PromptActions } from "../components/PromptActions";
import { PromptEditor } from "../components/PromptEditor";
import { ReferenceMentionTextarea } from "../components/ReferenceMentionTextarea";
import type { GenSpaceMediaKind, VideoGenPanelController } from "../types";
import {
  getH3PromptAliases,
  getH3ReferenceState,
  isSequenceFreeReferenceRole,
  isVideoAspectRatioLocked,
  removeSequenceFreeReferences,
} from "../logic/media-inputs";
import { getReferenceEntityMediaAvailability } from "../logic/video-prompt-composer";
import { VideoMediaInputs } from "./VideoMediaInputs";
import { SequenceComposer } from "./SequenceComposer";
import { useReferenceLibrary } from "../../../contexts/ReferenceLibraryContext";
import { VideoModeTabs } from "./VideoModeTabs";
import { VideoToolInput } from "./VideoToolInput";
import { getVideoToolLabel } from "./video-tools";
import { UpscalePanel } from "../components/UpscalePanel";
import {
  getCompatibleVideoProfiles,
  type QuickGenWorkflowId,
} from "../workflows";

function LightricksIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.0073 8.18934C16.3266 5.6556 14.9346 2.06903 12.3065 2.06903C9.27204 2.06903 6.86627 7.24621 5.45487 11.7948C4.79654 13.9203 4.35877 15.9049 4.17755 17.1736C4.10214 17.5829 4.06274 18.0044 4.06274 18.4347C4.06274 22.2903 7.22553 25.4338 11.1133 25.4338C15.5206 25.4338 23.9376 22.7073 23.9376 18.4347C23.9376 17.1179 23.1376 15.948 21.9018 14.9595C22.4493 13.7707 22.847 12.648 23.001 11.705C23.1934 10.5053 23.0074 9.5494 22.4429 8.88217C21.7692 8.07382 20.7107 7.85572 19.6586 7.84288C18.8826 7.84288 17.9777 7.96904 17.0073 8.18934ZM11.1133 12.9816C8.07878 12.9816 5.60884 15.4258 5.60884 18.4347C5.60884 21.4435 8.07878 23.8878 11.1133 23.8878C14.1478 23.8878 16.6178 21.4435 16.6178 18.4347C16.6178 15.4258 14.1478 12.9816 11.1133 12.9816Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LegacyPromptMedia({
  controller,
}: {
  controller: VideoGenPanelController;
}) {
  const { media } = controller;
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const [imageDrag, setImageDrag] = useState(false);
  const [audioDrag, setAudioDrag] = useState(false);

  const applyFile = async (file: File) => {
    const kind = detectMediaType(file.name, file.type);
    if (kind !== "image" && kind !== "audio") return;
    const url = await media.resolveInputFileUrl(
      file,
      media.syncInputFileToGallery,
    );
    if (kind === "image") media.setInputImage(url);
    else media.setInputAudio(url);
  };

  const drop =
    (kind: "image" | "audio") =>
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setImageDrag(false);
      setAudioDrag(false);
      const raw = event.dataTransfer.getData("asset");
      if (raw) {
        try {
          const asset = JSON.parse(raw) as { type: string; url: string };
          if (asset.type === kind) {
            if (kind === "image") media.setInputImage(asset.url);
            else media.setInputAudio(asset.url);
          }
        } catch {
          return;
        }
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (file) await applyFile(file);
    };

  return (
    <>
      <div
        data-genspace-dropzone
        data-drag-active={imageDrag || undefined}
        className={`relative mx-2 mt-2 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed text-2xs transition-colors ${
          imageDrag ? "" : "border-border hover:border-border-strong"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setImageDrag(true);
        }}
        onDragLeave={() => setImageDrag(false)}
        onDrop={drop("image")}
        onClick={() => imageRef.current?.click()}
      >
        {media.inputImage ? (
          <>
            <img
              src={media.inputImage}
              alt=""
              className="h-full w-full rounded-md object-cover"
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                media.setInputImage(null);
              }}
              className="absolute -right-1 -top-1 z-10 rounded-full bg-popover p-0.5 text-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <Image className="h-4 w-4 text-subtle-foreground" />
        )}
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void applyFile(file);
            event.target.value = "";
          }}
        />
      </div>
      <div
        data-genspace-dropzone
        data-drag-active={audioDrag || undefined}
        className={`relative mt-2 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed text-2xs transition-colors ${
          audioDrag
            ? ""
            : media.inputAudio
              ? "border-emerald-600"
              : "border-border hover:border-border-strong"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setAudioDrag(true);
        }}
        onDragLeave={() => setAudioDrag(false)}
        onDrop={drop("audio")}
        onClick={() => audioRef.current?.click()}
      >
        <Music
          className={`h-4 w-4 ${
            media.inputAudio ? "text-emerald-400" : "text-subtle-foreground"
          }`}
        />
        {media.inputAudio ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              media.setInputAudio(null);
            }}
            className="absolute -right-1 -top-1 z-10 rounded-full bg-popover p-0.5 text-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
        <input
          ref={audioRef}
          type="file"
          accept=".mp3,.wav,.ogg,.aac,.flac,.m4a,audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void applyFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </>
  );
}

export function VideoGenPanel({
  controller,
}: {
  controller: VideoGenPanelController;
}) {
  const {
    prompt,
    generation,
    settings,
    media,
    profiles,
    videoTools,
    framing,
    composer,
  } = controller;
  const { entities: referenceEntities } = useReferenceLibrary();
  const libraryMedia = referenceEntities.flatMap((entity) => {
    const visual = entity.visualReference;
    const voice = entity.kind === "cast" ? entity.voiceReference : undefined;
    return [
      ...(visual
        ? [
            {
              id: `${entity.id}:visual`,
              name: entity.name,
              type: visual.type,
              url: visual.url,
            },
          ]
        : []),
      ...(voice
        ? [
            {
              id: `${entity.id}:voice`,
              name: `${entity.name} voice`,
              type: "audio" as const,
              url: voice.url,
            },
          ]
        : []),
    ];
  });
  const workflow = controller.workflow ?? {
    favouriteIds: [],
    toggleFavourite: () => undefined,
  };
  const videoSettings = settings.value;
  const [stylesOpen, setStylesOpen] = useState(false);
  const [confirmSequenceMode, setConfirmSequenceMode] = useState(false);
  const h3ReferenceRequestRef = useRef<(type: GenSpaceMediaKind) => void>(
    () => undefined,
  );
  const setH3ReferenceRequest = useCallback(
    (request: (type: GenSpaceMediaKind) => void) => {
      h3ReferenceRequestRef.current = request;
    },
    [],
  );
  const patchVideoSettings = settings.patch;
  const isRetake = videoTools.mode === "retake";
  const isTools = videoTools.mode === "reframe";
  const isReframe = isTools && videoTools.selectedTool === "reframe";
  const isUpscale = isTools && videoTools.selectedTool === "upscale";
  const isPanelMode = isRetake || isTools;
  const workflowId: Extract<QuickGenWorkflowId, `video:${string}`> = isTools
    ? `video:tool:${videoTools.selectedTool}`
    : isRetake
      ? "video:retake"
      : "video:generate";
  const compatibleProfiles = isUpscale
    ? profiles.options
    : getCompatibleVideoProfiles(profiles.options, workflowId);
  const installedProfiles = compatibleProfiles.filter((profile) =>
    isModelProfileInstalled(profile.availability),
  );
  const selectedCompatibleProfile =
    installedProfiles.find(
      (profile) => profile.id === videoSettings.profileId,
    ) ?? installedProfiles[0];
  const selectedProfile =
    profiles.options.find(
      (profile) => profile.id === videoSettings.profileId,
    ) ??
    selectedCompatibleProfile ??
    profiles.options[0];
  const profileStyles = selectedProfile?.styles ?? [];
  const styles = !isPanelMode ? profileStyles : [];
  const selectedStyle = styles.find(
    (style) => style.id === videoSettings.styleId,
  );
  const guide = media.inputs.find(({ role }) => GUIDE_MEDIA_ROLE_SET.has(role));
  const isContinueVideo = isTools
    ? videoTools.selectedTool === "extend"
    : guide?.role === "continue_video";
  const durationFollowsGuide = isTools
    ? !isReframe && !isContinueVideo
    : !!guide && !isContinueVideo;
  const hasAudioInput =
    !!media.inputAudio ||
    media.inputs.some(({ role }) => AUDIO_MEDIA_ROLE_SET.has(role));
  const isH3Generation =
    !isPanelMode &&
    (selectedProfile?.id === "minimax_h3_fast" ||
      selectedProfile?.id === "minimax_h3_quality");
  const composerPolicy = selectedProfile?.promptComposer ?? {
    promptFormat: "plain" as const,
    entityMediaMode: "text-only" as const,
    voiceReference: false,
  };
  const referenceMediaAvailability =
    getReferenceEntityMediaAvailability(composerPolicy);
  const h3ReferenceState = getH3ReferenceState(media.inputs);
  const h3ReferenceAvailability = h3ReferenceState.availability;
  const aspectRatioDisabled = isVideoAspectRatioLocked(
    videoTools.mode,
    media.inputs,
    media.inputImage !== null,
  );
  const resolutionOptions = selectedProfile?.ui.allowedResolutionTiers ?? [
    "540p",
    "720p",
    "1080p",
  ];
  useEffect(() => {
    if (!selectedCompatibleProfile) return;
    const profile = selectedCompatibleProfile;
    const aspect = profile.ui.allowedAspectRatios.includes(
      videoSettings.aspectRatio,
    )
      ? videoSettings.aspectRatio
      : profile.ui.defaultAspectRatio;
    const resolution = profile.ui.allowedResolutionTiers.includes(
      videoSettings.resolution,
    )
      ? videoSettings.resolution
      : profile.ui.defaultResolutionTier;
    if (
      videoSettings.profileId !== profile.id ||
      videoSettings.aspectRatio !== aspect ||
      videoSettings.resolution !== resolution
    ) {
      patchVideoSettings({
        profileId: profile.id,
        aspectRatio: aspect,
        resolution,
      });
    }
  }, [patchVideoSettings, selectedCompatibleProfile, videoSettings]);
  useEffect(() => {
    if (
      videoSettings.styleId &&
      !profileStyles.some((style) => style.id === videoSettings.styleId)
    ) {
      patchVideoSettings({ styleId: undefined });
    }
  }, [patchVideoSettings, profileStyles, videoSettings.styleId]);

  const aspectRatioValue = isReframe
    ? videoTools.reframeAspectMode === "custom"
      ? "16:9"
      : videoTools.reframeAspectMode
    : videoSettings.aspectRatio;
  const allowedAspectRatios = hasAudioInput
    ? ["16:9"]
    : (selectedProfile?.ui.allowedAspectRatios ?? ["16:9", "9:16"]);
  const durationControl = isReframe ? (
    <button
      type="button"
      disabled
      className="flex cursor-not-allowed items-center gap-1.5 rounded-md bg-input px-2 py-1 text-xs text-subtle-foreground"
    >
      <Clock className="h-3.5 w-3.5" />
      <span className="text-xs">auto</span>
    </button>
  ) : durationFollowsGuide ? (
    <button
      type="button"
      disabled
      className="flex cursor-not-allowed items-center gap-1.5 rounded-md bg-input px-2 py-1 text-xs text-subtle-foreground"
    >
      <Clock className="h-3.5 w-3.5" />
      <span className="text-xs">auto</span>
    </button>
  ) : (
    <SettingsDropdown
      title=""
      value={String(videoSettings.duration)}
      onChange={() => undefined}
      options={[]}
      align="right"
      triggerLabel="Video duration"
      content={
        <label className="block w-48 text-xs text-muted-foreground">
          <span className="mb-2 flex items-center justify-between gap-4">
            <span>{isContinueVideo ? "Extend by" : "Duration"}</span>
            <span className="font-mono text-foreground">
              {isContinueVideo ? "+" : ""}
              {videoSettings.duration}s
            </span>
          </span>
          <input
            type="range"
            aria-label="Video duration seconds"
            min={2}
            max={20}
            step={1}
            value={videoSettings.duration}
            onChange={(event) =>
              patchVideoSettings({
                duration: Number(event.currentTarget.value),
              })
            }
            className="w-full cursor-pointer accent-violet-500"
          />
        </label>
      }
      trigger={
        <>
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs">
            {isContinueVideo ? "+" : ""}
            {videoSettings.duration}s
          </span>
        </>
      }
    />
  );
  const resolutionControl = (
    <SettingsDropdown
      title="RESOLUTION"
      value={videoSettings.resolution}
      onChange={(resolution) => patchVideoSettings({ resolution })}
      options={resolutionOptions.map((value) => ({ value, label: value }))}
      placement={isTools ? "bottom" : "top"}
      trigger={
        <>
          <Monitor className="h-3.5 w-3.5" />
          <span>{videoSettings.resolution.replace("p", "")}</span>
        </>
      }
    />
  );
  const aspectRatioControl = (
    <AspectRatioDropdown
      value={aspectRatioValue}
      allowedAspectRatios={allowedAspectRatios}
      disabled={!isReframe && (isTools || aspectRatioDisabled)}
      placement={isReframe ? "bottom" : "top"}
      onChange={(aspectRatio) =>
        isReframe
          ? videoTools.setReframeAspectMode(aspectRatio)
          : patchVideoSettings({ aspectRatio })
      }
    />
  );

  return (
    <>
      <GenPanelSection
        title=""
        className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
        collapsible={false}
      >
        <VideoModeTabs
          mode={videoTools.mode}
          onChange={videoTools.setMode}
          selectedTool={videoTools.selectedTool}
          onToolChange={videoTools.setSelectedTool}
          profiles={profiles.options}
          favouriteIds={workflow.favouriteIds}
          onToggleFavourite={workflow.toggleFavourite}
        />
      </GenPanelSection>
      {!isUpscale && selectedCompatibleProfile ? (
        <GenPanelSection
          title=""
          className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
          collapsible={false}
        >
          <ModelPicker
            profiles={installedProfiles}
            value={selectedCompatibleProfile.id}
            onChange={(profileId) => {
              const profile = profiles.options.find(
                (option) => option.id === profileId,
              );
              patchVideoSettings({
                profileId,
                styleId: profile?.styles?.some(
                  (style) => style.id === videoSettings.styleId,
                )
                  ? videoSettings.styleId
                  : undefined,
              });
            }}
            placement="bottom"
            modelDownload={profiles.modelDownload}
            icon={<LightricksIcon className="h-5 w-5" />}
          />
        </GenPanelSection>
      ) : !isUpscale && profiles.options.length ? (
        <GenPanelSection
          title=""
          className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
          collapsible={false}
        >
          <div
            className="rounded-md bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-200"
            aria-live="polite"
          >
            No compatible installed model.
          </div>
        </GenPanelSection>
      ) : !isUpscale ? (
        <GenPanelSection
          title=""
          className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
          collapsible={false}
        >
          <div className="flex items-center gap-1.5 rounded-md bg-input px-2 py-1.5 text-subtle-foreground">
            <span>Loading models…</span>
          </div>
        </GenPanelSection>
      ) : null}
      {!isPanelMode ? (
        <VideoMediaInputs
          inputs={media.inputs}
          onChange={media.setInputs}
          profile={selectedProfile}
          useAudioTrack={media.useAudioTrack}
          onUseAudioTrackChange={media.setUseAudioTrack}
          resolveInputFileUrl={media.resolveInputFileUrl}
          syncInputFileToGallery={media.syncInputFileToGallery}
          reservedAliases={getH3PromptAliases(prompt.value)}
          onReferenceRequestReady={setH3ReferenceRequest}
          styles={styles}
          selectedStyle={selectedStyle}
          onOpenStyles={() => setStylesOpen(true)}
          stylesDisabled={generation.isRunning}
          libraryMedia={libraryMedia}
          freeReferencesDisabled={composer.value.mode === "sequence"}
        />
      ) : null}
      {isUpscale ? (
        <UpscalePanel
          mediaKind="video"
          input={controller.upscale.input}
          onInputChange={controller.upscale.setInput}
          methods={controller.upscale.methods}
          method={controller.upscale.method}
          onMethodChange={controller.upscale.setMethod}
          scale={controller.upscale.scale}
          onScaleChange={controller.upscale.setScale}
          catalogError={controller.upscale.catalogError}
          isCatalogLoading={controller.upscale.isCatalogLoading}
          onRetryCatalog={controller.upscale.retryCatalog}
          disabled={generation.isRunning}
          resolveInputFileUrl={media.resolveInputFileUrl}
          syncInputFileToGallery={media.syncInputFileToGallery}
        />
      ) : isTools ? (
        <div className="border-b border-border bg-background">
          <div className={isReframe ? "max-h-[52vh] overflow-y-auto" : ""}>
            <VideoToolInput
              item={videoTools.toolInput}
              role={isContinueVideo ? "continue_video" : "control_video"}
              label={getVideoToolLabel(videoTools.selectedTool)}
              controls={
                isReframe ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {resolutionControl}
                    {aspectRatioControl}
                  </div>
                ) : (
                  resolutionControl
                )
              }
              sourceOnly={!isReframe}
              aspectMode={videoTools.reframeAspectMode}
              initialPadding={videoTools.reframePadding}
              resetKey={videoTools.reframePanelKey}
              onReframePanelChange={videoTools.onReframePanelChange}
              onChange={videoTools.setToolInput}
              resolveInputFileUrl={media.resolveInputFileUrl}
              syncInputFileToGallery={media.syncInputFileToGallery}
            />
          </div>
        </div>
      ) : null}
      {isRetake ? (
        <div className="border-b border-border bg-background">
          {videoTools.panel()}
        </div>
      ) : null}
      {!isUpscale ? (
        !isPanelMode ? (
          <div className="flex gap-1 px-4 pt-2">
            <button
              type="button"
              onClick={() => composer.setMode("simple")}
              className={`rounded px-2 py-1 text-xs ${composer.value.mode === "simple" ? "bg-surface-selected text-foreground" : "text-muted-foreground"}`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => {
                const hasReferences = media.inputs.some((input) =>
                  isSequenceFreeReferenceRole(input.role),
                );
                if (hasReferences) setConfirmSequenceMode(true);
                else composer.setMode("sequence");
              }}
              className={`rounded px-2 py-1 text-xs ${composer.value.mode === "sequence" ? "bg-surface-selected text-foreground" : "text-muted-foreground"}`}
            >
              Sequence
            </button>
          </div>
        ) : null
      ) : null}
      {!isUpscale ? (
        <PromptEditor
          enhancementReview={prompt.enhancementReview}
          value={prompt.value}
          onChange={prompt.setValue}
          mediaMentions={
            isH3Generation || referenceEntities.length
              ? [
                  ...(isH3Generation
                    ? h3ReferenceState.activeInputs.flatMap((input) =>
                        input.alias && input.type
                          ? [
                              {
                                alias: input.alias,
                                type: input.type,
                                url: input.url,
                              },
                            ]
                          : [],
                      )
                    : []),
                  ...referenceEntities.map((entity) => ({
                    alias: entity.token,
                    type:
                      entity.visualReference?.type === "video"
                        ? ("video" as const)
                        : ("image" as const),
                    url: entity.visualReference?.url ?? "",
                  })),
                ]
              : undefined
          }
          onAddMedia={
            isH3Generation
              ? (type) => h3ReferenceRequestRef.current(type)
              : undefined
          }
          mediaAddDisabled={{
            image: !isH3Generation || !h3ReferenceAvailability.image,
            video: !isH3Generation || !h3ReferenceAvailability.video,
            audio: !isH3Generation || !h3ReferenceAvailability.audio,
          }}
          onSubmit={generation.submit}
          canSubmit={generation.canSubmit}
          disabled={generation.isRunning}
          placeholder={
            isReframe
              ? "optional text prompt to drive outpainting..."
              : isRetake
                ? "Describe what should happen in the selected section..."
                : isTools
                  ? `Describe the ${getVideoToolLabel(videoTools.selectedTool).toLowerCase()} result...`
                  : "The woman sips from a cup of coffee..."
          }
          leading={
            !isPanelMode && !selectedProfile?.inputMedia.supportsImageInputs ? (
              <LegacyPromptMedia controller={controller} />
            ) : undefined
          }
          bottomRight={
            !isRetake ? (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {!isPanelMode ? (
                  <FramingControl
                    value={framing.value}
                    onChange={framing.setValue}
                    disabled={generation.isRunning}
                  />
                ) : null}
              </div>
            ) : undefined
          }
          actions={
            !isRetake && !isReframe ? (
              <div className="flex items-center gap-1">
                <PromptActions
                  seedLocked={prompt.seedLocked}
                  lockedSeed={prompt.lockedSeed}
                  onSeedChange={prompt.setSeed}
                  disabled={generation.isRunning}
                  prompt={prompt.value}
                  onEnhance={prompt.enhance}
                  onEnhanceDraft={prompt.enhanceDraft}
                  enhanceEnabled={prompt.enhanceEnabled}
                  isEnhancing={prompt.isEnhancing}
                />
              </div>
            ) : undefined
          }
          children={
            !isPanelMode ? (
              <ReferenceMentionTextarea
                context="main"
                value={prompt.value}
                onChange={prompt.setValue}
                onSubmit={generation.submit}
                canSubmit={generation.canSubmit}
                disabled={generation.isRunning}
                placeholder="The woman sips from a cup of coffee..."
                allowVisualMedia={referenceMediaAvailability.allowVisualMedia}
                allowVoiceMedia={referenceMediaAvailability.allowVoiceMedia}
                mediaAddOptions={
                  isH3Generation
                    ? (["image", "video", "audio"] as const).map((type) => ({
                        type,
                        disabled: !h3ReferenceAvailability[type],
                        add: () => h3ReferenceRequestRef.current(type),
                      }))
                    : []
                }
                className="h-36 w-full resize-none overflow-y-auto bg-transparent px-3 pb-3 pt-3 text-sm leading-5 text-foreground placeholder:text-subtle-foreground focus:outline-hidden"
              />
            ) : undefined
          }
        />
      ) : null}
      {!isPanelMode && composer.value.mode === "sequence" ? (
        <SequenceComposer
          composer={composer}
          allowVisualMedia={referenceMediaAvailability.allowVisualMedia}
          allowVoiceMedia={referenceMediaAvailability.allowVoiceMedia}
        />
      ) : null}
      {!isUpscale && !isPanelMode ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
          {composer.value.mode === "simple" ? durationControl : null}
          {resolutionControl}
          {aspectRatioControl}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground">
        {isRetake ? (
          <div className="pr-2 text-2xs text-subtle-foreground">
            Trim in the panel above, then retake
          </div>
        ) : null}
        <GenerateButton
          onClick={generation.submit}
          disabled={!generation.canSubmit}
          loading={generation.isRunning}
          label={generation.label}
          icon={generation.icon}
        />
      </div>
      <StylesLibraryModal
        open={stylesOpen}
        styles={styles}
        selectedStyleId={videoSettings.styleId}
        onSelect={(styleId) => patchVideoSettings({ styleId })}
        onClear={() => patchVideoSettings({ styleId: undefined })}
        onClose={() => setStylesOpen(false)}
      />
      {confirmSequenceMode ? (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sequence-mode-confirm-title"
            className="w-full max-w-md rounded-xl border border-border bg-popover p-5 shadow-2xl"
          >
            <h2
              id="sequence-mode-confirm-title"
              className="text-base font-semibold text-foreground"
            >
              Remove free references?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sequence mode uses Reference Library entities. Start/end frames
              and control inputs will be kept.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSequenceMode(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  media.setInputs(removeSequenceFreeReferences);
                  composer.setMode("sequence");
                  setConfirmSequenceMode(false);
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Remove References and Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
