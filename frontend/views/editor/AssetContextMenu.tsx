import React from "react";
import {
  Plus,
  X,
  RefreshCw,
  Layers,
  GitMerge,
  FolderPlus,
  Folder,
  Trash2,
  FolderOpen,
  Heart,
  ClipboardPaste,
} from "lucide-react";
import type { Asset } from "../../types/project";
import {
  UseImageDropdown,
  type ImageUseTarget,
} from "../../components/UseImageDropdown";
import {
  UseVideoDropdown,
  type VideoUseTarget,
} from "../../components/UseVideoDropdown";
import { FloatingMenu } from "../../components/FloatingMenu";
import { getColorLabel } from "./video-editor-utils";
import { GalleryHandoffMenu } from "../genspace/components/GalleryHandoffMenu";
import type { GalleryHandoffDestination } from "../genspace/logic/gallery-handoff-policy";

export interface AssetContextMenuProps {
  asset: Asset;
  targetIds: string[];
  assetContextMenu: { assetId: string; x: number; y: number };
  assetContextMenuRef: React.RefObject<HTMLDivElement | null>;
  assets: Asset[];
  bins: string[];
  binColors?: Record<string, string>;
  isRegenerating: boolean;
  regeneratingAssetId: string | null;
  currentProjectId: string | null;
  pushAssetUndoRef?: React.RefObject<() => void>;
  addClipToTimeline?: (
    asset: Asset,
    trackIndex?: number,
    startTime?: number,
  ) => void;
  onToggleFavorite?: (asset: Asset) => void;
  onUseImage?: (asset: Asset, target: ImageUseTarget) => void;
  onUseVideo?: (asset: Asset, target: VideoUseTarget) => void;
  getHandoffDestinations?: (asset: Asset) => readonly GalleryHandoffDestination[];
  onHandoff?: (asset: Asset, destination: GalleryHandoffDestination) => void;
  onCopySettings?: (asset: Asset) => void;
  handleRegenerate?: (assetId: string) => void;
  handleCancelRegeneration?: () => void;
  setAssetActiveTake: (
    projectId: string,
    assetId: string,
    takeIndex: number,
  ) => void;
  setTakesViewAssetId: (assetId: string | null) => void;
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setAssetContextMenu: React.Dispatch<
    React.SetStateAction<{ assetId: string; x: number; y: number } | null>
  >;
  updateAsset: (
    projectId: string,
    assetId: string,
    updates: Partial<Asset>,
  ) => void;
  addAsset: (projectId: string, asset: Omit<Asset, "id" | "createdAt">) => void;
  deleteAsset: (projectId: string, assetId: string) => void;
  requestDeleteAssets: (assetIds: string[]) => void;
  deleteTakeFromAsset: (
    projectId: string,
    assetId: string,
    takeIndex: number,
  ) => void;
  setClips?: React.Dispatch<
    React.SetStateAction<import("../../types/project").TimelineClip[]>
  >;
}

export function AssetContextMenu({
  asset,
  targetIds,
  assetContextMenu,
  assetContextMenuRef,
  assets,
  bins,
  binColors = {},
  isRegenerating,
  regeneratingAssetId,
  currentProjectId,
  pushAssetUndoRef,
  addClipToTimeline,
  onToggleFavorite,
  onUseImage,
  onUseVideo,
  getHandoffDestinations,
  onHandoff,
  onCopySettings,
  handleRegenerate,
  handleCancelRegeneration,
  setTakesViewAssetId,
  setSelectedAssetIds,
  setAssetContextMenu,
  updateAsset,
  addAsset,
  deleteAsset,
  requestDeleteAssets,
  deleteTakeFromAsset,
  setClips,
}: AssetContextMenuProps) {
  const isMulti = targetIds.length > 1;
  const selectedAssets = targetIds
    .map((id) => assets.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Asset => Boolean(candidate));
  const canStackSelected =
    selectedAssets.length > 1 &&
    selectedAssets.every((candidate) => candidate.type === asset.type);

  return (
    <FloatingMenu
      ref={assetContextMenuRef}
      anchorPoint={assetContextMenu}
      gap={0}
      role="menu"
      className="min-w-[180px] overflow-y-auto rounded-xl border border-border bg-surface-raised py-1.5 text-xs shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {isMulti && (
        <div className="px-3 py-1 text-[10px] text-blue-400 font-medium">
          {targetIds.length} assets selected
        </div>
      )}

      {!isMulti && addClipToTimeline && (
        <button
          onClick={() => {
            addClipToTimeline(asset, 0);
            setAssetContextMenu(null);
          }}
          className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
        >
          <Plus className="h-3.5 w-3.5 text-subtle-foreground" />
          <span>Add to Timeline</span>
        </button>
      )}

      {!isMulti && asset.path && (
        <button
          onClick={() => {
            window.electronAPI?.showItemInFolder(asset.path!);
            setAssetContextMenu(null);
          }}
          className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
        >
          <FolderOpen className="h-3.5 w-3.5 text-subtle-foreground" />
          <span>Show in Explorer</span>
        </button>
      )}

      {!isMulti && onToggleFavorite && (
        <button
          onClick={() => {
            onToggleFavorite(asset);
            setAssetContextMenu(null);
          }}
          className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
        >
          <Heart
            className={`h-3.5 w-3.5 ${asset.favorite ? "fill-current text-red-400" : "text-subtle-foreground"}`}
          />
          <span>{asset.favorite ? "Remove favorite" : "Add to favorites"}</span>
        </button>
      )}

      {!isMulti && getHandoffDestinations && onHandoff ? (
        <GalleryHandoffMenu
          asset={asset}
          destinations={getHandoffDestinations(asset)}
          onSelect={(destination) => {
            onHandoff(asset, destination);
            setAssetContextMenu(null);
          }}
          variant="context"
        />
      ) : !isMulti && asset.type === "image" && onUseImage ? (
        <UseImageDropdown
          onSelect={(target) => {
            onUseImage(asset, target);
            setAssetContextMenu(null);
          }}
          variant="context"
        />
      ) : null}

      {!isMulti && (!getHandoffDestinations || !onHandoff) && asset.type === "video" && onUseVideo ? (
        <UseVideoDropdown
          onSelect={(target) => {
            onUseVideo(asset, target);
            setAssetContextMenu(null);
          }}
          variant="context"
        />
      ) : null}

      {!isMulti && asset.generationParams && onCopySettings && (
        <button
          onClick={() => {
            onCopySettings(asset);
            setAssetContextMenu(null);
          }}
          className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
        >
          <ClipboardPaste className="h-3.5 w-3.5 text-subtle-foreground" />
          <span>Copy settings</span>
        </button>
      )}

      {/* AI regeneration - only for assets with generationParams */}
      {!isMulti && asset.generationParams && handleRegenerate && (
        <>
          {isRegenerating && regeneratingAssetId === asset.id ? (
            <button
              onClick={() => {
                handleCancelRegeneration?.();
                setAssetContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-surface-hover flex items-center gap-3"
            >
              <X className="h-3.5 w-3.5" />
              <span>Cancel Regeneration</span>
            </button>
          ) : (
            <button
              onClick={() => {
                handleRegenerate(asset.id);
                setAssetContextMenu(null);
              }}
              disabled={isRegenerating}
              className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5 text-subtle-foreground" />
              <span>Regenerate</span>
            </button>
          )}
        </>
      )}
      {/* Takes management - for ANY asset with multiple takes */}
      {!isMulti && asset.takes && asset.takes.length > 1 && (
        <>
          <div className="h-px bg-border my-1" />
          <button
            onClick={() => {
              setTakesViewAssetId(asset.id);
              setSelectedAssetIds(new Set());
              setAssetContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
          >
            <Layers className="h-3.5 w-3.5 text-subtle-foreground" />
            <span>View All Takes</span>
          </button>
          <button
            onClick={() => {
              if (!currentProjectId || !asset.takes) return;
              pushAssetUndoRef?.current?.();
              asset.takes.slice(1).forEach((take) => {
                addAsset(currentProjectId, {
                  type: asset.type,
                  path: take.path,
                  url: take.url,
                  prompt: asset.prompt,
                  resolution: asset.resolution,
                  duration: asset.duration,
                  thumbnail: take.thumbnail,
                  generationParams: asset.generationParams,
                  takes: [
                    {
                      url: take.url,
                      path: take.path,
                      thumbnail: take.thumbnail,
                      createdAt: take.createdAt,
                    },
                  ],
                  activeTakeIndex: 0,
                });
              });
              const firstTake = asset.takes[0];
              updateAsset(currentProjectId, asset.id, {
                takes: [firstTake],
                activeTakeIndex: 0,
                url: firstTake.url,
                path: firstTake.path,
                thumbnail: firstTake.thumbnail || asset.thumbnail,
              });
              setAssetContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
          >
            <GitMerge className="h-3.5 w-3.5 text-subtle-foreground rotate-180" />
            <span>Ungroup Takes</span>
          </button>
          <button
            onClick={() => {
              const activeIdx = asset.activeTakeIndex ?? 0;
              if (confirm(`Delete take ${activeIdx + 1}?`)) {
                if (currentProjectId && asset.takes) {
                  pushAssetUndoRef?.current?.();
                  setClips?.((prev) =>
                    prev.map((c) => {
                      if (c.assetId !== asset.id) return c;
                      const cIdx =
                        c.takeIndex ??
                        asset.activeTakeIndex ??
                        asset.takes!.length - 1;
                      if (cIdx === activeIdx) {
                        return { ...c, takeIndex: Math.max(0, activeIdx - 1) };
                      } else if (cIdx > activeIdx) {
                        return { ...c, takeIndex: cIdx - 1 };
                      }
                      return c;
                    }),
                  );
                  deleteTakeFromAsset(currentProjectId, asset.id, activeIdx);
                }
              }
              setAssetContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-900/30 flex items-center gap-3"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Active Take</span>
          </button>
        </>
      )}

      <div className="h-px bg-border my-1" />

      <div className="px-3 py-1 text-2xs text-subtle-foreground font-semibold uppercase tracking-wider">
        Move to Bin
      </div>

      <button
        onClick={() => {
          if (currentProjectId) {
            pushAssetUndoRef?.current?.();
            targetIds.forEach((id) =>
              updateAsset(currentProjectId, id, { bin: undefined }),
            );
          }
          setAssetContextMenu(null);
          setSelectedAssetIds(new Set());
        }}
        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
      >
        <X className="h-3.5 w-3.5 text-subtle-foreground" />
        <span>Remove from Bin</span>
      </button>

      {bins.map((bin) => (
        <button
          key={bin}
          onClick={() => {
            if (currentProjectId) {
              pushAssetUndoRef?.current?.();
              targetIds.forEach((id) =>
                updateAsset(currentProjectId, id, { bin }),
              );
            }
            setAssetContextMenu(null);
            setSelectedAssetIds(new Set());
          }}
          className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
        >
          <Folder
            className="h-3.5 w-3.5 text-subtle-foreground"
            style={{ color: getColorLabel(binColors[bin])?.color }}
          />
          <span>{bin}</span>
        </button>
      ))}

      <button
        onClick={() => {
          const name = prompt("New bin name:");
          if (name?.trim() && currentProjectId) {
            pushAssetUndoRef?.current?.();
            targetIds.forEach((id) =>
              updateAsset(currentProjectId, id, { bin: name.trim() }),
            );
          }
          setAssetContextMenu(null);
          setSelectedAssetIds(new Set());
        }}
        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
      >
        <FolderPlus className="h-3.5 w-3.5 text-subtle-foreground" />
        <span>New Bin...</span>
      </button>

      {isMulti && (
        <>
          <div className="h-px bg-border my-1" />
          <button
            onClick={() => {
              if (!currentProjectId || !canStackSelected) return;
              pushAssetUndoRef?.current?.();
              const flattenedAssets = [
                asset,
                ...selectedAssets.filter((candidate) => candidate.id !== asset.id),
              ];
              const newTakes = flattenedAssets.flatMap((candidate) => {
                if (!candidate.takes?.length) {
                  return [{
                      url: candidate.url,
                      path: candidate.path,
                      thumbnail: candidate.thumbnail,
                      createdAt: candidate.createdAt,
                      duration: candidate.duration,
                      prompt: candidate.prompt,
                      resolution: candidate.resolution,
                      generationTimeSeconds:
                        candidate.generationTimeSeconds ?? null,
                      generationParams: candidate.generationParams ?? null,
                    }];
                }
                const activeTakeIndex = Math.max(
                  0,
                  Math.min(
                    candidate.activeTakeIndex ?? 0,
                    candidate.takes.length - 1,
                  ),
                );
                return candidate.takes.map((take, index) => {
                  const active = index === activeTakeIndex;
                  return {
                    ...take,
                    ...(active
                      ? { url: candidate.url, path: candidate.path }
                      : {}),
                    thumbnail: active
                      ? candidate.thumbnail ?? take.thumbnail
                      : take.thumbnail ?? candidate.thumbnail,
                    duration: active
                      ? candidate.duration ?? take.duration
                      : take.duration ?? candidate.duration,
                    prompt: active
                      ? candidate.prompt ?? take.prompt
                      : take.prompt ?? candidate.prompt,
                    resolution: active
                      ? candidate.resolution ?? take.resolution
                      : take.resolution ?? candidate.resolution,
                    generationTimeSeconds: active
                      ? candidate.generationTimeSeconds ??
                        take.generationTimeSeconds ??
                        null
                      : take.generationTimeSeconds === undefined
                        ? candidate.generationTimeSeconds ?? null
                        : take.generationTimeSeconds,
                    generationParams: active
                      ? candidate.generationParams ?? take.generationParams ?? null
                      : take.generationParams === undefined
                        ? candidate.generationParams ?? null
                        : take.generationParams,
                  };
                });
              });
              updateAsset(currentProjectId, asset.id, {
                takes: newTakes,
                activeTakeIndex: Math.min(
                  asset.activeTakeIndex ?? 0,
                  Math.max(0, (asset.takes?.length ?? 1) - 1),
                ),
              });
              flattenedAssets
                .slice(1)
                .forEach((candidate) => deleteAsset(currentProjectId, candidate.id));
              setSelectedAssetIds(new Set());
              setAssetContextMenu(null);
            }}
            disabled={!canStackSelected}
            title={
              canStackSelected
                ? "Stack selected assets"
                : "Only assets of the same type can be stacked"
            }
            className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-blue-300 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GitMerge className="h-3.5 w-3.5" />
            <span>Stack Selected</span>
          </button>
          <button
            onClick={() => {
              setSelectedAssetIds(new Set());
              setAssetContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-hover flex items-center gap-3"
          >
            <X className="h-3.5 w-3.5 text-subtle-foreground" />
            <span>Clear Selection</span>
          </button>
        </>
      )}

      <div className="h-px bg-border my-1" />

      <button
        onClick={() => {
          requestDeleteAssets(targetIds);
          setAssetContextMenu(null);
          setSelectedAssetIds(new Set());
        }}
        className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-surface-hover flex items-center gap-3"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>
          {isMulti ? `Delete ${targetIds.length} Assets` : "Delete Asset"}
        </span>
      </button>
    </FloatingMenu>
  );
}
