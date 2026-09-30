import { FramingControl } from "../components/FramingControl";
import { AspectRatioDropdown } from "../components/AspectRatioDropdown";
import { GenerateButton } from "../components/GenerateButton";
import { GenPanelSection } from "../components/GenPanelSection";
import { PromptActions } from "../components/PromptActions";
import { PromptEditor } from "../components/PromptEditor";
import type { ImageGenPanelController } from "../types";
import { ImageMediaInputs } from "./ImageMediaInputs";
import { ImageEditMediaInputs } from "./ImageEditMediaInputs";
import { ImageModeTabs } from "./ImageModeTabs";
import { ImageModelControls } from "./ImageModelControls";
import { RegionPromptEditor } from "./RegionPromptEditor";
import { getImageProfilesForMode } from "./image-profile-options";
import { isImageAspectRatioLocked } from "../logic/media-inputs";
import { UpscalePanel } from "../components/UpscalePanel";

export function ImageGenPanel({
  controller,
}: {
  controller: ImageGenPanelController;
}) {
  const { prompt, generation, settings, media, profiles, imageTools, framing } =
    controller;
  const workflow = controller.workflow ?? {
    favouriteIds: [],
    toggleFavourite: () => undefined,
    select: undefined,
  };
  if (imageTools.mode === "upscale") {
    return (
      <>
        <GenPanelSection
          title=""
          className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
          collapsible={false}
        >
          <ImageModeTabs
            mode={imageTools.mode}
            onChange={imageTools.setMode}
            editToolMode={imageTools.editToolMode}
            onEditToolModeChange={imageTools.setEditToolMode}
            onSelectWorkflow={workflow.select}
            favouriteIds={workflow.favouriteIds}
            onToggleFavourite={workflow.toggleFavourite}
          />
        </GenPanelSection>
        <UpscalePanel
          mediaKind="image"
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
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground">
          <GenerateButton
            onClick={generation.submit}
            disabled={!generation.canSubmit}
            loading={generation.isRunning}
            label="Upscale"
            icon={generation.icon}
          />
        </div>
      </>
    );
  }
  const modeProfiles = getImageProfilesForMode(
    profiles.options,
    imageTools.mode,
  );
  const selectedProfile =
    modeProfiles.find((profile) => profile.id === settings.value.profileId) ??
    modeProfiles[0];
  const aspectRatioDisabled = isImageAspectRatioLocked(
    imageTools.mode,
    imageTools.editToolMode,
    media.inputs,
    imageTools.editImage !== null,
  );
  const promptActions = (
    <PromptActions
      seedLocked={prompt.seedLocked}
      lockedSeed={prompt.lockedSeed}
      onSeedChange={prompt.setSeed}
      disabled={generation.isRunning}
      prompt={prompt.value}
      onEnhance={prompt.enhance}
      onEnhanceDraft={prompt.enhanceDraft}
      showEnhance={imageTools.mode !== "region"}
      enhanceEnabled={prompt.enhanceEnabled}
      isEnhancing={prompt.isEnhancing}
    />
  );
  const standardOutputControls = (
    <ImageModelControls
      settings={settings.value}
      onSettingsChange={settings.patch}
      imageProfiles={modeProfiles}
      section="output"
      aspectRatioDisabled={aspectRatioDisabled}
    />
  );
  const reframeAspectRatio =
    imageTools.editOutpaint?.aspectMode === "custom"
      ? "16:9"
      : (imageTools.editOutpaint?.aspectMode ?? "16:9");
  const reframeOutputControls =
    imageTools.mode === "edit" && imageTools.editToolMode === "reframe" ? (
      <div className="flex shrink-0 items-center gap-1">
        <ImageModelControls
          settings={settings.value}
          onSettingsChange={settings.patch}
          imageProfiles={modeProfiles}
          section="output"
          showAspectRatio={false}
          menuPlacement="bottom"
        />
        <AspectRatioDropdown
          value={reframeAspectRatio}
          allowedAspectRatios={selectedProfile?.ui.allowedAspectRatios}
          placement="bottom"
          onChange={(aspectMode) =>
            imageTools.setEditOutpaint({
              aspectMode,
              padding: imageTools.editOutpaint?.padding ?? {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            })
          }
        />
      </div>
    ) : null;
  const promptFooterControls =
    imageTools.mode === "edit" &&
    imageTools.editToolMode === "reframe" ? null : (
      <>{standardOutputControls}</>
    );

  return (
    <>
      <GenPanelSection
        title=""
        className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
        collapsible={false}
      >
        <ImageModeTabs
          mode={imageTools.mode}
          onChange={imageTools.setMode}
          editToolMode={imageTools.editToolMode}
          onEditToolModeChange={imageTools.setEditToolMode}
          onSelectWorkflow={workflow.select}
          favouriteIds={workflow.favouriteIds}
          onToggleFavourite={workflow.toggleFavourite}
        />
      </GenPanelSection>
      <GenPanelSection
        title=""
        className="text-xs text-muted-foreground flex gap-2 justify-between items-center"
        collapsible={false}
      >
        <ImageModelControls
          settings={settings.value}
          onSettingsChange={settings.patch}
          imageProfiles={modeProfiles}
          section="model"
          menuPlacement="bottom"
          modelDownload={profiles.modelDownload}
        />
      </GenPanelSection>
      {imageTools.mode === "create" ? (
        <ImageMediaInputs
          inputs={media.inputs}
          onChange={media.setInputs}
          policy={selectedProfile?.inputMedia}
          resolveInputFileUrl={media.resolveInputFileUrl}
          syncInputFileToGallery={media.syncInputFileToGallery}
        />
      ) : imageTools.mode === "edit" ? (
        <ImageEditMediaInputs
          image={imageTools.editImage}
          onImageChange={imageTools.setEditImage}
          references={media.inputs}
          onReferencesChange={media.setInputs}
          profile={selectedProfile}
          toolMode={imageTools.editToolMode}
          onToolModeChange={imageTools.setEditToolMode}
          mask={imageTools.editMask}
          onMaskChange={imageTools.setEditMask}
          outpaint={imageTools.editOutpaint}
          onOutpaintChange={imageTools.setEditOutpaint}
          disabled={generation.isRunning}
          resolveInputFileUrl={media.resolveInputFileUrl}
          syncInputFileToGallery={media.syncInputFileToGallery}
          reframeControls={reframeOutputControls}
        />
      ) : null}
      {imageTools.mode === "region" ? (
        <RegionPromptEditor
          value={imageTools.regionPrompt}
          onChange={imageTools.setRegionPrompt}
          aspectRatio={settings.value.aspectRatio}
          disabled={generation.isRunning}
          actions={promptActions}
          outputControls={standardOutputControls}
        />
      ) : (
        <PromptEditor
          enhancementReview={prompt.enhancementReview}
          value={prompt.value}
          onChange={prompt.setValue}
          onSubmit={generation.submit}
          canSubmit={generation.canSubmit}
          disabled={generation.isRunning}
          placeholder="A close-up of a woman talking on the phone..."
          bottomRight={
            <div className="flex flex-wrap items-center justify-end gap-1">
              {imageTools.mode === "create" ? (
                <FramingControl
                  value={framing.value}
                  onChange={framing.setValue}
                  disabled={generation.isRunning}
                />
              ) : null}
            </div>
          }
          actions={promptActions}
        />
      )}
      {imageTools.mode !== "region" && promptFooterControls ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
          {promptFooterControls}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground">
        <GenerateButton
          onClick={generation.submit}
          disabled={!generation.canSubmit}
          loading={generation.isRunning}
          label={generation.label}
          icon={generation.icon}
        />
      </div>
    </>
  );
}
