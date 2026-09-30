import {
  Music,
  X,
} from "lucide-react";
import type {
  Dispatch,
  RefObject,
  ReactNode,
  SetStateAction,
} from "react";
import { DeleteAssetDialog } from "../../components/DeleteAssetDialog";
import { DuplicateFilenameDialog } from "../../components/DuplicateFilenameDialog";
import { GenerationErrorDialog } from "../../components/GenerationErrorDialog";
import type { ProjectAssetsContextType } from "../../contexts/ProjectContext";
import type { DuplicateFilenameChoice } from "../../lib/media-import";
import type { Asset } from "../../types/project";
import type { ImageUseTarget } from "../../components/UseImageDropdown";
import type { VideoUseTarget } from "../../components/UseVideoDropdown";
import type { GalleryHandoffDestination } from "./logic/gallery-handoff-policy";
import { AssetContextMenu } from "../editor/AssetContextMenu";

type Projects = ProjectAssetsContextType;

export interface GenSpaceOverlaysProps {
  duplicateFilenameChoice: {
    fileName: string;
    resolve: (choice: DuplicateFilenameChoice) => void;
  } | null;
  onDuplicateFilenameChoice: (choice: DuplicateFilenameChoice) => void;
  takesAsset: Asset | undefined;
  onCloseTakes: () => void;
  onSelectTake: (assetId: string, takeIndex: number) => void;
  contextMenu: { assetId: string; x: number; y: number } | null;
  contextAsset: Asset | undefined;
  contextSelectedAssetIds: Set<string>;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  assets: Asset[];
  bins: string[];
  binColors: Record<string, string> | undefined;
  currentProjectId: string | null;
  onToggleFavorite: (asset: Asset) => void;
  onUseImage: (asset: Asset, target: ImageUseTarget) => void;
  onUseVideo: (asset: Asset, target: VideoUseTarget) => void;
  getHandoffDestinations: (asset: Asset) => readonly GalleryHandoffDestination[];
  onHandoff: (asset: Asset, destination: GalleryHandoffDestination) => void;
  onCopySettings: (asset: Asset) => void;
  setAssetActiveTake: Projects["setAssetActiveTake"];
  setTakesViewAssetId: (assetId: string | null) => void;
  setContextSelectedAssetIds: Dispatch<SetStateAction<Set<string>>>;
  setAssetContextMenu: Dispatch<
    SetStateAction<{ assetId: string; x: number; y: number } | null>
  >;
  updateAsset: Projects["updateAsset"];
  addAsset: Projects["addAsset"];
  deleteAsset: Projects["deleteAsset"];
  requestDeleteAssets: (assetIds: string[]) => void;
  deleteTakeFromAsset: Projects["deleteTakeFromAsset"];
  pendingDeleteCount: number;
  cancelDelete: () => void;
  confirmDelete: () => void;
  error: string | null;
  dismissError: () => void;
  excerptHandoff: ReactNode;
}

export function GenSpaceOverlays({
  duplicateFilenameChoice,
  onDuplicateFilenameChoice,
  takesAsset,
  onCloseTakes,
  onSelectTake,
  contextMenu,
  contextAsset,
  contextSelectedAssetIds,
  contextMenuRef,
  assets,
  bins,
  binColors,
  currentProjectId,
  onToggleFavorite,
  onUseImage,
  onUseVideo,
  getHandoffDestinations,
  onHandoff,
  onCopySettings,
  setAssetActiveTake,
  setTakesViewAssetId,
  setContextSelectedAssetIds,
  setAssetContextMenu,
  updateAsset,
  addAsset,
  deleteAsset,
  requestDeleteAssets,
  deleteTakeFromAsset,
  pendingDeleteCount,
  cancelDelete,
  confirmDelete,
  error,
  dismissError,
  excerptHandoff,
}: GenSpaceOverlaysProps) {
  return (
    <>
      {duplicateFilenameChoice ? (
        <DuplicateFilenameDialog
          fileName={duplicateFilenameChoice.fileName}
          onChoose={onDuplicateFilenameChoice}
        />
      ) : null}

      {takesAsset?.takes && takesAsset.takes.length > 1 ? (
        <div
          className="fixed inset-0 z-55 flex items-center justify-center bg-black/75 p-8 backdrop-blur-xs"
          onClick={onCloseTakes}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">All Takes</h2>
                <p className="text-xs text-subtle-foreground">
                  {takesAsset.takes.length} takes
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseTakes}
                className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                aria-label="Close takes"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto p-4 md:grid-cols-3">
              {takesAsset.takes.map((take, index) => {
                const active = (takesAsset.activeTakeIndex ?? 0) === index;
                return (
                  <button
                    key={`${take.createdAt}-${index}`}
                    type="button"
                    onClick={() => onSelectTake(takesAsset.id, index)}
                    className={`relative overflow-hidden rounded-lg border-2 bg-surface transition-colors ${
                      active
                        ? "border-blue-500 ring-2 ring-blue-500/30"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    {takesAsset.type === "video" ? (
                      <video
                        src={take.url}
                        preload="metadata"
                        muted
                        className="aspect-video w-full object-contain"
                      />
                    ) : takesAsset.type === "audio" ? (
                      <div className="flex aspect-video items-center justify-center bg-emerald-950/40">
                        <Music className="h-8 w-8 text-emerald-300" />
                      </div>
                    ) : (
                      <img
                        src={take.url}
                        alt=""
                        className="aspect-video w-full object-contain"
                      />
                    )}
                    <span className="absolute bottom-1 left-1 rounded-sm bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                      Take {index + 1}
                      {active ? " · Active" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu && contextAsset ? (
        <AssetContextMenu
          asset={contextAsset}
          targetIds={
            contextSelectedAssetIds.has(contextAsset.id)
              ? [...contextSelectedAssetIds]
              : [contextAsset.id]
          }
          assetContextMenu={contextMenu}
          assetContextMenuRef={contextMenuRef}
          assets={assets}
          bins={bins}
          binColors={binColors}
          isRegenerating={false}
          regeneratingAssetId={null}
          currentProjectId={currentProjectId}
          onToggleFavorite={onToggleFavorite}
          onUseImage={onUseImage}
          onUseVideo={onUseVideo}
          getHandoffDestinations={getHandoffDestinations}
          onHandoff={onHandoff}
          onCopySettings={onCopySettings}
          setAssetActiveTake={setAssetActiveTake}
          setTakesViewAssetId={setTakesViewAssetId}
          setSelectedAssetIds={setContextSelectedAssetIds}
          setAssetContextMenu={setAssetContextMenu}
          updateAsset={updateAsset}
          addAsset={addAsset}
          deleteAsset={deleteAsset}
          requestDeleteAssets={requestDeleteAssets}
          deleteTakeFromAsset={deleteTakeFromAsset}
        />
      ) : null}

      {pendingDeleteCount > 0 ? (
        <DeleteAssetDialog
          assetCount={pendingDeleteCount}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      ) : null}
      {error ? (
        <GenerationErrorDialog error={error} onDismiss={dismissError} />
      ) : null}
      {excerptHandoff}
    </>
  );
}
