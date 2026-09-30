import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  GripVertical,
  Layers,
  Link2,
  Loader2,
  Music,
  RefreshCw,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { ClipWaveform } from "../../components/AudioWaveform";
import { Tooltip } from "../../components/ui/tooltip";
import type {
  Asset,
  SubtitleClip,
  TimelineClip,
  Track,
} from "../../types/project";
import type { getCachedVideoThumbnail } from "../../lib/video-thumbnail-service";
import type { useClipOperations } from "./useClipOperations";
import type { useGapGeneration } from "./useGapGeneration";
import type { useRegeneration } from "./useRegeneration";
import type { useSubtitleOperations } from "./useSubtitleOperations";
import type { useTimelineDrag } from "./useTimelineDrag";
import type { getColorLabel, ToolType } from "./video-editor-utils";
import {
  TimelinePlayhead,
  TimelineSegmentFrame,
} from "./timeline/TimelinePrimitives";

type TimelineDragState = ReturnType<typeof useTimelineDrag>;
type GapGenerationState = ReturnType<typeof useGapGeneration>;
type RegenerationState = ReturnType<typeof useRegeneration>;
type SubtitleOperations = ReturnType<typeof useSubtitleOperations>;
type ClipOperations = ReturnType<typeof useClipOperations>;

type OrderedTimelineTrack = {
  track: Track;
  realIndex: number;
  displayRow: number;
};

type BladeHoverInfo = {
  clipId: string;
  offsetX: number;
  time: number;
};

type SelectedGapAnchor = {
  x: number;
  gapTop: number;
  gapBottom: number;
};

type CutPoint = {
  leftClip: TimelineClip;
  rightClip: TimelineClip;
  time: number;
  trackIndex: number;
  hasDissolve: boolean;
};

type HoveredCutPoint = {
  leftClipId: string;
  rightClipId: string;
  time: number;
  trackIndex: number;
};

type ClipResolution = {
  label: string;
  color: string;
  height: number;
};

interface TimelineCanvasGeometryProps {
  currentTime: number;
  pixelsPerSecond: number;
  trackContainerRef: React.RefObject<HTMLDivElement | null>;
  playheadOverlayRef: React.RefObject<HTMLDivElement | null>;
  totalDuration: number;
  orderedTracks: OrderedTimelineTrack[];
  audioDividerDisplayRow: number;
  DIVIDER_H: number;
  subtitleTrackHeight: number;
  audioTrackHeight: number;
  videoTrackHeight: number;
  setVideoTrackHeight: React.Dispatch<React.SetStateAction<number>>;
  setAudioTrackHeight: React.Dispatch<React.SetStateAction<number>>;
  trackTopPx: (trackIndex: number, padding?: number) => number;
  getTrackHeight: (trackIndex: number) => number;
  handleTimelineScroll: React.UIEventHandler<HTMLDivElement>;
}

interface TimelineCanvasToolProps {
  activeTool: ToolType;
  bladeShiftHeld: boolean;
  SCISSORS_CURSOR: string;
  TRACK_FWD_ONE_CURSOR: string;
  TRACK_FWD_ALL_CURSOR: string;
  bladeHoverInfo: BladeHoverInfo | null;
  setBladeHoverInfo: React.Dispatch<
    React.SetStateAction<BladeHoverInfo | null>
  >;
}

interface TimelineCanvasSelectionProps {
  selectedClipIds: Set<string>;
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowPropertiesPanel: React.Dispatch<React.SetStateAction<boolean>>;
  lassoOriginRef: TimelineDragState["lassoOriginRef"];
  lassoRect: TimelineDragState["lassoRect"];
  setLassoRect: TimelineDragState["setLassoRect"];
  draggingClip: TimelineDragState["draggingClip"];
  slipSlideClip: TimelineDragState["slipSlideClip"];
  resizingClip: TimelineDragState["resizingClip"];
  expandWithLinkedClips: TimelineDragState["expandWithLinkedClips"];
}

interface TimelineCanvasClipProps {
  clips: TimelineClip[];
  assets: Asset[];
  getColorLabel: typeof getColorLabel;
  getClipUrl: (clip: TimelineClip) => string | null;
  getCachedVideoThumbnail: typeof getCachedVideoThumbnail;
  getClipResolution: (clip: TimelineClip) => ClipResolution | null;
  getLiveAsset: (clip: TimelineClip) => Asset | null | undefined;
  handleClipContextMenu: (event: React.MouseEvent, clip: TimelineClip) => void;
  handleClipMouseDown: TimelineDragState["handleClipMouseDown"];
  handleResizeStart: TimelineDragState["handleResizeStart"];
  handleTrackDrop: TimelineDragState["handleTrackDrop"];
  handleRetakeClip: (clip: TimelineClip) => void;
  handleClipTakeChange: RegenerationState["handleClipTakeChange"];
  handleDeleteTake: RegenerationState["handleDeleteTake"];
  handleRegenerate: RegenerationState["handleRegenerate"];
  handleCancelRegeneration: RegenerationState["handleCancelRegeneration"];
  isRegenerating: boolean;
  regenProgress: number;
}

interface TimelineCanvasGapProps {
  timelineGaps: GapGenerationState["timelineGaps"];
  selectedGap: GapGenerationState["selectedGap"];
  setSelectedGap: GapGenerationState["setSelectedGap"];
  setSelectedGapAnchor: React.Dispatch<
    React.SetStateAction<SelectedGapAnchor | null>
  >;
  setGapGenerateMode: GapGenerationState["setGapGenerateMode"];
  generatingGap: GapGenerationState["generatingGap"];
  gapRegenProgress: number;
  cancelGapGeneration: GapGenerationState["cancelGapGeneration"];
}

interface TimelineCanvasSubtitleProps {
  subtitles: SubtitleClip[];
  tracks: Track[];
  selectedSubtitleId: string | null;
  setSelectedSubtitleId: React.Dispatch<React.SetStateAction<string | null>>;
  editingSubtitleId: string | null;
  setEditingSubtitleId: React.Dispatch<React.SetStateAction<string | null>>;
  addSubtitleClip: SubtitleOperations["addSubtitleClip"];
  updateSubtitle: SubtitleOperations["updateSubtitle"];
}

interface TimelineCanvasDissolveProps {
  cutPoints: CutPoint[];
  hoveredCutPoint: HoveredCutPoint | null;
  setHoveredCutPoint: React.Dispatch<
    React.SetStateAction<HoveredCutPoint | null>
  >;
  DEFAULT_DISSOLVE_DURATION: number;
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>;
  pushUndo: () => void;
  removeCrossDissolve: ClipOperations["removeCrossDissolve"];
  addCrossDissolve: ClipOperations["addCrossDissolve"];
  handleTimelineBgContextMenu: (event: React.MouseEvent) => void;
}

export interface TimelineTrackCanvasProps
  extends
    TimelineCanvasGeometryProps,
    TimelineCanvasToolProps,
    TimelineCanvasSelectionProps,
    TimelineCanvasClipProps,
    TimelineCanvasGapProps,
    TimelineCanvasSubtitleProps,
    TimelineCanvasDissolveProps {
  inPoint: number | null;
  outPoint: number | null;
}

export function TimelineTrackCanvas(props: TimelineTrackCanvasProps) {
  const {
    setSelectedGapAnchor,
    handleClipContextMenu,
    currentTime,
    pixelsPerSecond,
    trackContainerRef,
    playheadOverlayRef,
    activeTool,
    bladeShiftHeld,
    SCISSORS_CURSOR,
    TRACK_FWD_ONE_CURSOR,
    TRACK_FWD_ALL_CURSOR,
    handleTimelineScroll,
    totalDuration,
    orderedTracks,
    audioDividerDisplayRow,
    DIVIDER_H,
    subtitleTrackHeight,
    audioTrackHeight,
    videoTrackHeight,
    setVideoTrackHeight,
    setAudioTrackHeight,
    handleTrackDrop,
    handleTimelineBgContextMenu,
    setSelectedSubtitleId,
    setEditingSubtitleId,
    setSelectedGap,
    setGapGenerateMode,
    clips,
    setSelectedClipIds,
    lassoOriginRef,
    setLassoRect,
    inPoint,
    outPoint,
    lassoRect,
    assets,
    getColorLabel,
    selectedClipIds,
    draggingClip,
    slipSlideClip,
    trackTopPx,
    getTrackHeight,
    handleClipMouseDown,
    expandWithLinkedClips,
    setShowPropertiesPanel,
    bladeHoverInfo,
    setBladeHoverInfo,
    getClipUrl,
    getCachedVideoThumbnail,
    getClipResolution,
    getLiveAsset,
    handleClipTakeChange,
    handleDeleteTake,
    handleRegenerate,
    isRegenerating,
    handleRetakeClip,
    regenProgress,
    handleCancelRegeneration,
    resizingClip,
    handleResizeStart,
    timelineGaps,
    selectedGap,
    generatingGap,
    gapRegenProgress,
    cancelGapGeneration,
    subtitles,
    tracks,
    selectedSubtitleId,
    editingSubtitleId,
    addSubtitleClip,
    updateSubtitle,
    cutPoints,
    hoveredCutPoint,
    setHoveredCutPoint,
    DEFAULT_DISSOLVE_DURATION,
    setClips,
    pushUndo,
    removeCrossDissolve,
    addCrossDissolve,
  } = props;
  return (
    <>
      <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        {/* Full-height playhead line — spans spacer + tracks, positioned on the wrapper */}
        <TimelinePlayhead
          ref={playheadOverlayRef}
          position={
            currentTime * pixelsPerSecond -
            (trackContainerRef.current?.scrollLeft || 0)
          }
        />
        {/* Spacer matching the add-track button bar height */}
      <div className="shrink-0 h-7 border-b border-border/50" />
        <div
          ref={trackContainerRef}
          className="flex-1 overflow-auto select-none"
          onScroll={handleTimelineScroll}
        >
          <div
            style={{
              minWidth: `${totalDuration * pixelsPerSecond}px`,
              ...(activeTool === "blade"
                ? { cursor: SCISSORS_CURSOR }
                : activeTool === "trackForward"
                  ? {
                      cursor: bladeShiftHeld
                        ? TRACK_FWD_ONE_CURSOR
                        : TRACK_FWD_ALL_CURSOR,
                    }
                  : {}),
            }}
            className="relative"
            onDragOver={(e) => {
              // Allow asset/timeline drops anywhere on the timeline area
              if (
                e.dataTransfer.types.includes("assetid") ||
                e.dataTransfer.types.includes("assetids") ||
                e.dataTransfer.types.includes("asset") ||
                e.dataTransfer.types.includes("timeline")
              ) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              // Determine which track the drop landed on from the Y position
              const container = trackContainerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              const yInContainer = e.clientY - rect.top + container.scrollTop;
              let droppedTrackIndex = 0;
              let accY = 0;
              for (const entry of orderedTracks) {
                if (entry.displayRow === audioDividerDisplayRow)
                  accY += DIVIDER_H;
                const th =
                  entry.track.type === "subtitle"
                    ? subtitleTrackHeight
                    : entry.track.kind === "audio"
                      ? audioTrackHeight
                      : videoTrackHeight;
                if (yInContainer >= accY && yInContainer < accY + th) {
                  droppedTrackIndex = entry.realIndex;
                  break;
                }
                accY += th;
                droppedTrackIndex = entry.realIndex;
              }
              handleTrackDrop(e, droppedTrackIndex);
            }}
            onContextMenu={(e) => {
              // Right-click on background (not on a clip) opens paste menu
              if (
                e.target === e.currentTarget ||
                (e.target as HTMLElement).closest("[data-track-bg]")
              ) {
                handleTimelineBgContextMenu(e);
              }
            }}
            onMouseDown={(e) => {
              // Only start lasso on direct click on the tracks area (not on clips)
              if (
                e.target === e.currentTarget ||
                (e.target as HTMLElement).closest("[data-track-bg]")
              ) {
                setSelectedSubtitleId(null);
                setEditingSubtitleId(null);
                setSelectedGap(null);
                setGapGenerateMode(null);
                if (activeTool === "trackForward") {
                  // Track Select Forward: click empty area → select all clips from click time forward
                  const container = trackContainerRef.current;
                  if (container) {
                    const rect = container.getBoundingClientRect();
                    const scrollLeft = container.scrollLeft;
                    const scrollTop = container.scrollTop;
                    const clickX = e.clientX - rect.left + scrollLeft;
                    const clickY = e.clientY - rect.top + scrollTop;
                    const clickTime = clickX / pixelsPerSecond;

                    // Determine which track was clicked using display ordering
                    let clickedRealTrackIndex = -1;
                    let accY = 0;
                    for (const entry of orderedTracks) {
                      if (entry.displayRow === audioDividerDisplayRow)
                        accY += DIVIDER_H;
                      const th =
                        entry.track.type === "subtitle"
                          ? subtitleTrackHeight
                          : entry.track.kind === "audio"
                            ? audioTrackHeight
                            : videoTrackHeight;
                      if (clickY >= accY && clickY < accY + th) {
                        clickedRealTrackIndex = entry.realIndex;
                        break;
                      }
                      accY += th;
                    }

                    const forwardClips = clips.filter((c) => {
                      if (e.shiftKey) {
                        return (
                          c.trackIndex === clickedRealTrackIndex &&
                          c.startTime >= clickTime - 0.01
                        );
                      } else {
                        return c.startTime >= clickTime - 0.01;
                      }
                    });
                    setSelectedClipIds(new Set(forwardClips.map((c) => c.id)));
                  }
                } else if (activeTool === "select") {
                  // If not shift-clicking, clear selection first
                  if (!e.shiftKey) {
                    setSelectedClipIds(new Set());
                  }
                  // Start lasso
                  const container = trackContainerRef.current;
                  if (container) {
                    const rect = container.getBoundingClientRect();
                    lassoOriginRef.current = {
                      scrollLeft: container.scrollLeft,
                      containerLeft: rect.left,
                      containerTop: rect.top, // ruler is now outside trackContainerRef
                    };
                    setLassoRect({
                      startX: e.clientX,
                      startY: e.clientY,
                      currentX: e.clientX,
                      currentY: e.clientY,
                    });
                  }
                }
              }
            }}
          >
            {/* Dimmed region BEFORE In point on tracks */}
            {inPoint !== null && (
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/25 pointer-events-none z-5"
                style={{ width: `${inPoint * pixelsPerSecond}px` }}
              />
            )}
            {/* Dimmed region AFTER Out point on tracks */}
            {outPoint !== null && (
              <div
                className="absolute top-0 bottom-0 bg-black/25 pointer-events-none z-5"
                style={{
                  left: `${outPoint * pixelsPerSecond}px`,
                  right: 0,
                }}
              />
            )}
            {/* In/Out range highlight on tracks */}
            {(inPoint !== null || outPoint !== null) && (
              <div
                className="absolute top-0 bottom-0 border-l-2 border-r-2 border-blue-400/40 pointer-events-none z-5"
                style={{
                  left: `${(inPoint ?? 0) * pixelsPerSecond}px`,
                  width: `${((outPoint ?? totalDuration) - (inPoint ?? 0)) * pixelsPerSecond}px`,
                }}
              />
            )}
            {/* In point line on tracks */}
            {inPoint !== null && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-blue-400/60 z-15 pointer-events-none"
                style={{ left: `${inPoint * pixelsPerSecond}px` }}
              />
            )}
            {/* Out point line on tracks */}
            {outPoint !== null && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-blue-400/60 z-15 pointer-events-none"
                style={{ left: `${outPoint * pixelsPerSecond}px` }}
              />
            )}
            {/* Playhead is now rendered as overlay on the column wrapper (playheadOverlayRef) */}

            {orderedTracks.map(({ track, realIndex, displayRow }) => (
              <React.Fragment key={track.id}>
                {/* Divider between video and audio sections */}
                {displayRow === audioDividerDisplayRow && (
                  <div
        className="bg-surface-hover/60 cursor-row-resize hover:bg-blue-500/30 transition-colors"
                    style={{ height: DIVIDER_H }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const startY = e.clientY;
                      const startVH = videoTrackHeight;
                      const startAH = audioTrackHeight;
                      const onMove = (ev: MouseEvent) => {
                        const delta = ev.clientY - startY;
                        const newVH = Math.max(
                          32,
                          Math.min(200, startVH + delta),
                        );
                        const newAH = Math.max(
                          32,
                          Math.min(200, startAH - delta),
                        );
                        setVideoTrackHeight(newVH);
                        setAudioTrackHeight(newAH);
                      };
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                  />
                )}
                <div
                  data-track-bg="true"
        className={`border-b border-border ${
                    track.type === "subtitle"
                      ? "bg-amber-950/15"
                      : track.kind === "audio"
                        ? displayRow % 2 === 0
                          ? "bg-emerald-950/20"
                          : "bg-emerald-950/10"
                        : displayRow % 2 === 0
            ? "bg-surface/50"
            : "bg-surface"
                  } ${track.locked ? "opacity-50" : ""}`}
                  style={{
                    height:
                      track.type === "subtitle"
                        ? subtitleTrackHeight
                        : track.kind === "audio"
                          ? audioTrackHeight
                          : videoTrackHeight,
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    if (track.type === "subtitle") {
                      e.preventDefault();
                      return;
                    }
                    handleTrackDrop(e, realIndex);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDoubleClick={() => {
                    if (track.type === "subtitle" && !track.locked) {
                      addSubtitleClip(realIndex);
                    }
                  }}
                />
              </React.Fragment>
            ))}

            {/* Lasso selection rectangle */}
            {lassoRect &&
              lassoOriginRef.current &&
              (() => {
                const origin = lassoOriginRef.current!;
                const container = trackContainerRef.current;
                if (!container) return null;
                const scrollLeft = container.scrollLeft;
                const scrollTop = container.scrollTop;
                const x1 =
                  Math.min(lassoRect.startX, lassoRect.currentX) -
                  origin.containerLeft +
                  scrollLeft;
                const x2 =
                  Math.max(lassoRect.startX, lassoRect.currentX) -
                  origin.containerLeft +
                  scrollLeft;
                const y1 =
                  Math.min(lassoRect.startY, lassoRect.currentY) -
                  origin.containerTop +
                  scrollTop;
                const y2 =
                  Math.max(lassoRect.startY, lassoRect.currentY) -
                  origin.containerTop +
                  scrollTop;
                return (
                  <div
                    className="absolute border border-blue-400 bg-blue-500/10 z-30 pointer-events-none rounded-sm"
                    style={{
                      left: x1,
                      top: y1,
                      width: x2 - x1,
                      height: y2 - y1,
                    }}
                  />
                );
              })()}

            {clips.map((clip) => {
              const liveAsset = clip.assetId
                ? assets.find((a) => a.id === clip.assetId)
                : null;
              const clipColor = getColorLabel(
                clip.colorLabel ||
                  liveAsset?.colorLabel ||
                  clip.asset?.colorLabel,
              );
              return (
                <TimelineSegmentFrame
                  key={clip.id}
                  className={`absolute border-2 transition-all ${
                    selectedClipIds.has(clip.id)
                      ? "border-blue-500 shadow-lg shadow-blue-500/20"
                      : clipColor
                        ? `hover:brightness-125`
                        : "border-zinc-600 hover:border-zinc-500"
                  } ${!clipColor ? (clip.type === "audio" ? "bg-green-900/50" : clip.type === "adjustment" ? "bg-blue-900/40 border-dashed" : clip.type === "text" ? "bg-cyan-900/50 border-cyan-600/40" : "bg-zinc-800") : ""} ${
                    activeTool === "select" ||
                    activeTool === "ripple" ||
                    activeTool === "roll"
                      ? "cursor-grab"
                      : ""
                  } ${
                    activeTool === "slip" ? "cursor-ew-resize" : ""
                  } ${activeTool === "slide" ? "cursor-col-resize" : ""} ${
                    draggingClip?.clipId === clip.id ||
                    (draggingClip && selectedClipIds.has(clip.id))
                      ? "opacity-80 cursor-grabbing z-30"
                      : ""
                  } ${
                    slipSlideClip?.clipId === clip.id
                      ? "opacity-90 ring-2 ring-yellow-500/50 z-30"
                      : ""
                  }`}
                  style={{
                    left: `${clip.startTime * pixelsPerSecond}px`,
                    width: `${clip.duration * pixelsPerSecond}px`,
                    top: `${trackTopPx(clip.trackIndex, 4)}px`,
                    height: `${getTrackHeight(clip.trackIndex) - 8}px`,
                    ...(activeTool === "blade"
                      ? { cursor: SCISSORS_CURSOR }
                      : activeTool === "trackForward"
                        ? {
                            cursor: bladeShiftHeld
                              ? TRACK_FWD_ONE_CURSOR
                              : TRACK_FWD_ALL_CURSOR,
                          }
                        : {}),
                    ...(clipColor
                      ? {
                          backgroundColor: `${clipColor.color}80`,
                          borderColor: selectedClipIds.has(clip.id)
                            ? undefined
                            : clipColor.color,
                        }
                      : {}),
                  }}
                  onMouseDown={(e) => handleClipMouseDown(e, clip)}
                  onDoubleClick={() => {
                    setSelectedClipIds(
                      expandWithLinkedClips(new Set([clip.id])),
                    );
                    setShowPropertiesPanel(true);
                  }}
                  onMouseMove={(e) => {
                    if (activeTool === "blade") {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ox = e.clientX - rect.left;
                      const hoverTime =
                        clip.startTime + (ox / rect.width) * clip.duration;
                      setBladeHoverInfo({
                        clipId: clip.id,
                        offsetX: ox,
                        time: hoverTime,
                      });
                    }
                  }}
                  onMouseLeave={() => {
                    if (
                      activeTool === "blade" &&
                      bladeHoverInfo?.clipId === clip.id
                    ) {
                      setBladeHoverInfo(null);
                    }
                  }}
                  onContextMenu={(e) => handleClipContextMenu(e, clip)}
                  /* EFFECTS HIDDEN - drag-drop for effects hidden because effects are not applied during export */
                >
                  {/* Blade cut indicator line */}
                  {activeTool === "blade" &&
                    bladeHoverInfo &&
                    (() => {
                      // Show indicator on the hovered clip, or on all clips at that time when Shift is held
                      const isHoveredClip = bladeHoverInfo.clipId === clip.id;
                      const isShiftTarget =
                        bladeShiftHeld &&
                        !isHoveredClip &&
                        bladeHoverInfo.time > clip.startTime + 0.05 &&
                        bladeHoverInfo.time <
                          clip.startTime + clip.duration - 0.05;
                      if (!isHoveredClip && !isShiftTarget) return null;
                      const indicatorPx = isHoveredClip
                        ? bladeHoverInfo.offsetX
                        : (bladeHoverInfo.time - clip.startTime) *
                          pixelsPerSecond;
                      return (
                        <div
                          className={`absolute top-0 bottom-0 w-px z-20 pointer-events-none ${isHoveredClip ? "bg-red-500" : "bg-red-500/60"}`}
                          style={{ left: `${indicatorPx}px` }}
                        >
                          <div
                            className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? "bg-red-500" : "bg-red-500/60"}`}
                          />
                          <div
                            className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? "bg-red-500" : "bg-red-500/60"}`}
                          />
                        </div>
                      );
                    })()}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center text-zinc-500 hover:text-white ${activeTool === "trackForward" || activeTool === "blade" ? "" : "cursor-grab"}`}
                    style={
                      activeTool === "blade"
                        ? { cursor: SCISSORS_CURSOR }
                        : activeTool === "trackForward"
                          ? {
                              cursor: bladeShiftHeld
                                ? TRACK_FWD_ONE_CURSOR
                                : TRACK_FWD_ALL_CURSOR,
                            }
                          : {}
                    }
                  >
                    <GripVertical className="h-3 w-3" />
                  </div>

                  <div className="h-full flex items-center pl-5 pr-2 gap-2">
                    {clip.type === "adjustment" ? (
                      <div className="h-8 w-8 shrink-0 rounded-sm bg-blue-800/30 border border-blue-600/30 flex items-center justify-center">
                        <Layers className="h-4 w-4 text-blue-400" />
                      </div>
                    ) : clip.type === "text" ? (
                      <div className="h-8 w-8 shrink-0 rounded-sm bg-cyan-800/30 border border-cyan-600/30 flex items-center justify-center">
                        <Type className="h-4 w-4 text-cyan-400" />
                      </div>
                    ) : clip.type === "audio" ? (
                      <>
                        <ClipWaveform
                          url={
                            getClipUrl(clip) ||
                            clip.asset?.url ||
                            clip.importedUrl ||
                            ""
                          }
                        />
                        <div className="h-8 w-8 shrink-0 rounded-sm bg-emerald-800/50 flex items-center justify-center relative z-10">
                          <Music className="h-4 w-4 text-emerald-400" />
                        </div>
                      </>
                    ) : (
                      clip.asset &&
                      (clip.asset.type === "video" ? (
                        (() => {
                          const source = getClipUrl(clip) || clip.asset!.url;
                          const thumbnail =
                            clip.asset!.thumbnail ||
                            getCachedVideoThumbnail(source);
                          return thumbnail ? (
                            <img
                              key={`thumb-${clip.id}-${clip.takeIndex ?? "default"}`}
                              src={thumbnail}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-8 aspect-video object-cover rounded-sm"
                            />
                          ) : (
                            <div className="h-8 aspect-video rounded-sm bg-zinc-800" />
                          );
                        })()
                      ) : (
                        <img
                          key={`thumb-${clip.id}-${clip.takeIndex ?? "default"}`}
                          src={getClipUrl(clip) || clip.asset.url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-8 aspect-video object-cover rounded-sm"
                        />
                      ))
                    )}
                    <div
                      className={`flex-1 min-w-0 ${clip.type === "audio" ? "relative z-10" : ""}`}
                    >
                      <p
                        className={`text-[10px] truncate ${clip.type === "adjustment" ? "text-blue-300" : clip.type === "text" ? "text-cyan-300" : clip.type === "audio" ? "text-emerald-300" : "text-zinc-300"}`}
                      >
                        {clip.type === "adjustment"
                          ? "Adjustment Layer"
                          : clip.type === "text"
                            ? clip.textStyle?.text?.slice(0, 30) || "Text"
                            : clip.asset?.prompt?.slice(0, 30) ||
                              clip.importedName ||
                              "Clip"}
                      </p>
                      <div className="flex items-center gap-2 text-[9px] text-zinc-500">
                        <span>{clip.duration.toFixed(1)}s</span>
                        {(() => {
                          const resInfo = getClipResolution(clip);
                          if (!resInfo) return null;
                          return (
                            <span
                              style={{ color: resInfo.color }}
                              className="font-semibold"
                            >
                              {resInfo.height >= 2160
                                ? "4K"
                                : `${resInfo.height}p`}
                            </span>
                          );
                        })()}
                        {clip.speed !== 1 && (
                          <span className="text-yellow-400">{clip.speed}x</span>
                        )}
                        {clip.reversed && (
                          <span className="text-blue-400">REV</span>
                        )}
                        {clip.muted && <span className="text-red-400">M</span>}
                        {(clip.flipH || clip.flipV) && (
                          <span className="text-cyan-400">FLIP</span>
                        )}
                        {clip.colorCorrection &&
                          Object.values(clip.colorCorrection).some(
                            (v) => v !== 0,
                          ) && <span className="text-orange-400">CC</span>}
                        {clip.letterbox?.enabled && (
                          <span className="text-blue-400">LB</span>
                        )}
                        {clip.linkedClipIds?.length && (
                          <Link2 className="h-2.5 w-2.5 text-zinc-500 inline" />
                        )}
                      </div>
                    </div>

                    {/* Take navigation + Regenerate (only for clips with gen params) */}
                    {(() => {
                      const liveAsset = getLiveAsset(clip);
                      if (
                        !liveAsset ||
                        clip.duration * pixelsPerSecond <= 60 ||
                        clip.type === "adjustment" ||
                        clip.type === "audio"
                      )
                        return null;
                      return (
                        <div
                          className="shrink-0 flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {/* Take navigation: prev/next */}
                          {liveAsset.takes && liveAsset.takes.length > 1 && (
                            <>
                              <Tooltip content="Previous take" side="top">
                                <button
                                  onClick={() =>
                                    handleClipTakeChange(clip.id, "prev")
                                  }
                                  className="p-0.5 rounded-sm hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                >
                                  <ChevronLeft className="h-3 w-3" />
                                </button>
                              </Tooltip>
                              <span className="text-[8px] text-zinc-400 min-w-[24px] text-center">
                                {(clip.takeIndex ??
                                  liveAsset.activeTakeIndex ??
                                  liveAsset.takes.length - 1) + 1}
                                /{liveAsset.takes.length}
                              </span>
                              <Tooltip content="Next take" side="top">
                                <button
                                  onClick={() =>
                                    handleClipTakeChange(clip.id, "next")
                                  }
                                  className="p-0.5 rounded-sm hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                >
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              </Tooltip>
                              <Tooltip content="Delete this take" side="top">
                                <button
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Delete take ${(clip.takeIndex ?? liveAsset.activeTakeIndex ?? liveAsset.takes!.length - 1) + 1}?`,
                                      )
                                    ) {
                                      handleDeleteTake(clip.id);
                                    }
                                  }}
                                  className="p-0.5 rounded-sm hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </Tooltip>
                            </>
                          )}
                          <Tooltip content="Regenerate shot" side="top">
                            <button
                              onClick={() =>
                                handleRegenerate(clip.assetId!, clip.id)
                              }
                              disabled={isRegenerating}
                              className={`p-0.5 rounded transition-colors ${
                                clip.isRegenerating
                                  ? "text-blue-400"
                                  : "hover:bg-white/10 text-zinc-500 hover:text-blue-400"
                              }`}
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${clip.isRegenerating ? "animate-spin" : ""}`}
                              />
                            </button>
                          </Tooltip>
                          {clip.type === "video" && (
                            <Tooltip content="Retake is not supported by the current local runtime." side="top">
                              <button
                                disabled
                                aria-label="Retake unavailable"
                                onClick={() => handleRetakeClip(clip)}
                                className="p-0.5 rounded-sm transition-colors hover:bg-white/10 text-zinc-500 hover:text-blue-400"
                              >
                                <Film className="h-3 w-3" />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Regenerating overlay on the clip */}
                  {clip.isRegenerating && (
                    <div className="absolute inset-0 bg-blue-900/30 backdrop-blur-[2px] flex items-center justify-center rounded-lg z-10">
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-900/80 border border-blue-500/40">
                        <Loader2 className="h-3 w-3 text-blue-300 animate-spin" />
                        <span className="text-[9px] text-blue-200 font-medium">
                          {regenProgress > 0
                            ? `${regenProgress}%`
                            : "Regenerating..."}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelRegeneration();
                          }}
                          className="ml-1 px-1.5 py-0.5 rounded-sm bg-zinc-800/80 border border-zinc-600/60 text-[9px] text-zinc-300 hover:text-red-400 hover:border-red-500/50 hover:bg-red-900/30 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Transition in indicator */}
                  {clip.transitionIn?.type !== "none" &&
                    clip.transitionIn?.duration > 0 && (
                      <div
                        className="absolute top-0 bottom-0 left-0 pointer-events-none"
                        style={{
                          width: `${Math.min((clip.transitionIn.duration / clip.duration) * 100, 50)}%`,
                          background:
                            "linear-gradient(to right, rgba(139,92,246,0.4), transparent)",
                        }}
                      />
                    )}
                  {/* Transition out indicator */}
                  {clip.transitionOut?.type !== "none" &&
                    clip.transitionOut?.duration > 0 && (
                      <div
                        className="absolute top-0 bottom-0 right-0 pointer-events-none"
                        style={{
                          width: `${Math.min((clip.transitionOut.duration / clip.duration) * 100, 50)}%`,
                          background:
                            "linear-gradient(to left, rgba(139,92,246,0.4), transparent)",
                        }}
                      />
                    )}

                  {/* Resolution color-code bar at the bottom of the clip */}
                  {(() => {
                    const resInfo = getClipResolution(clip);
                    if (!resInfo) return null;
                    return (
                      <div
                        className="absolute bottom-0 left-0 right-0 h-[3px] pointer-events-none"
                        style={{ backgroundColor: resInfo.color }}
                        title={resInfo.label}
                      />
                    );
                  })()}

                  <div
                    className={`absolute left-0 top-0 bottom-0 w-3 ${activeTool === "trackForward" || activeTool === "blade" ? "" : "cursor-ew-resize"} transition-colors flex items-center justify-center ${
                      resizingClip?.clipId === clip.id &&
                      resizingClip?.edge === "left"
                        ? activeTool === "roll"
                          ? "bg-yellow-500"
                          : activeTool === "ripple"
                            ? "bg-green-500"
                            : "bg-blue-500"
                        : activeTool === "roll"
                          ? "hover:bg-yellow-500/50"
                          : activeTool === "ripple"
                            ? "hover:bg-green-500/50"
                            : "hover:bg-blue-500/50"
                    }`}
                    style={
                      activeTool === "blade"
                        ? { cursor: SCISSORS_CURSOR }
                        : activeTool === "trackForward"
                          ? {
                              cursor: bladeShiftHeld
                                ? TRACK_FWD_ONE_CURSOR
                                : TRACK_FWD_ALL_CURSOR,
                            }
                          : {}
                    }
                    onMouseDown={(e) => handleResizeStart(e, clip, "left")}
                  >
                    <div
                      className={`w-0.5 h-6 rounded-full ${
                        activeTool === "roll"
                          ? "bg-yellow-300"
                          : activeTool === "ripple"
                            ? "bg-green-300"
                            : "bg-zinc-500"
                      }`}
                    />
                  </div>
                  <div
                    className={`absolute right-0 top-0 bottom-0 w-3 ${activeTool === "trackForward" || activeTool === "blade" ? "" : "cursor-ew-resize"} transition-colors flex items-center justify-center ${
                      resizingClip?.clipId === clip.id &&
                      resizingClip?.edge === "right"
                        ? activeTool === "roll"
                          ? "bg-yellow-500"
                          : activeTool === "ripple"
                            ? "bg-green-500"
                            : "bg-blue-500"
                        : activeTool === "roll"
                          ? "hover:bg-yellow-500/50"
                          : activeTool === "ripple"
                            ? "hover:bg-green-500/50"
                            : "hover:bg-blue-500/50"
                    }`}
                    style={
                      activeTool === "blade"
                        ? { cursor: SCISSORS_CURSOR }
                        : activeTool === "trackForward"
                          ? {
                              cursor: bladeShiftHeld
                                ? TRACK_FWD_ONE_CURSOR
                                : TRACK_FWD_ALL_CURSOR,
                            }
                          : {}
                    }
                    onMouseDown={(e) => handleResizeStart(e, clip, "right")}
                  >
                    <div
                      className={`w-0.5 h-6 rounded-full ${
                        activeTool === "roll"
                          ? "bg-yellow-300"
                          : activeTool === "ripple"
                            ? "bg-green-300"
                            : "bg-zinc-500"
                      }`}
                    />
                  </div>
                </TimelineSegmentFrame>
              );
            })}

            {/* Gap indicators between clips */}
            {timelineGaps.map((gap, i) => {
              const leftPx = gap.startTime * pixelsPerSecond;
              const widthPx = (gap.endTime - gap.startTime) * pixelsPerSecond;
              const topPx = trackTopPx(gap.trackIndex, 4);
              const isSelected =
                selectedGap &&
                selectedGap.trackIndex === gap.trackIndex &&
                Math.abs(selectedGap.startTime - gap.startTime) < 0.01 &&
                Math.abs(selectedGap.endTime - gap.endTime) < 0.01;
              const isGeneratingHere =
                generatingGap &&
                generatingGap.trackIndex === gap.trackIndex &&
                Math.abs(generatingGap.startTime - gap.startTime) < 0.01 &&
                Math.abs(generatingGap.endTime - gap.endTime) < 0.01;

              if (widthPx < 4) return null;

              return (
                <div
                  key={`gap-${i}`}
                  className={`absolute rounded cursor-pointer transition-all group ${
                    isGeneratingHere
                      ? "bg-blue-500/15 border border-dashed text-2xs border-blue-400/60 shadow-inner"
                      : isSelected
                        ? "bg-blue-500/20 border border-dashed text-2xs border-blue-400/60 shadow-inner"
                        : "border border-dashed text-2xs border-transparent hover:bg-blue-500/10 hover:border-blue-400/30"
                  }`}
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    width: `${widthPx}px`,
                    height: `${getTrackHeight(gap.trackIndex) - 8}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isGeneratingHere) return;
                    setSelectedGap(gap);
                    setSelectedClipIds(new Set());
                    setSelectedSubtitleId(null);
                    setGapGenerateMode(null);
                    const r = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    setSelectedGapAnchor({
                      x: r.left + r.width / 2,
                      gapTop: r.top,
                      gapBottom: r.bottom,
                    });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isGeneratingHere) return;
                    setSelectedGap(gap);
                    setSelectedClipIds(new Set());
                    setSelectedSubtitleId(null);
                    const r = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    setSelectedGapAnchor({
                      x: r.left + r.width / 2,
                      gapTop: r.top,
                      gapBottom: r.bottom,
                    });
                  }}
                >
                  {isGeneratingHere ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                      <Loader2 className="h-3 w-3 text-blue-400 animate-spin pointer-events-none" />
                      {widthPx > 50 && (
                        <span className="text-[9px] text-blue-300 font-medium pointer-events-none">
                          {gapRegenProgress > 0
                            ? `${gapRegenProgress}%`
                            : "Generating..."}
                        </span>
                      )}
                      {widthPx > 30 && (
                        <div className="w-3/4 h-0.5 bg-blue-900/40 rounded-full overflow-hidden pointer-events-none">
                          <div
                            className="h-full bg-blue-400 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(gapRegenProgress, 2)}%`,
                            }}
                          />
                        </div>
                      )}
                      {/* Cancel button */}
                      <Tooltip content="Cancel generation" side="top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelGapGeneration();
                          }}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded-sm hover:bg-zinc-700/80 text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Tooltip>
                    </div>
                  ) : (
                    <div
                      className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity ${
                        isSelected
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <span className="text-[9px] font-medium text-blue-400">
                        {(gap.endTime - gap.startTime).toFixed(1)}s
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Subtitle clips on subtitle tracks */}
            {subtitles.map((sub) => {
              const track = tracks[sub.trackIndex];
              if (!track || track.type !== "subtitle") return null;
              const leftPx = sub.startTime * pixelsPerSecond;
              const widthPx = Math.max(
                20,
                (sub.endTime - sub.startTime) * pixelsPerSecond,
              );
              const topPx = trackTopPx(sub.trackIndex, 4);
              const isSelected = selectedSubtitleId === sub.id;
              const isEditing = editingSubtitleId === sub.id;

              return (
                <div
                  key={sub.id}
                  className={`absolute rounded border-2 overflow-hidden cursor-pointer select-none flex items-center ${
                    isSelected
                      ? "border-amber-400 shadow-lg shadow-amber-500/20 bg-amber-900/60"
                      : "border-amber-700/50 hover:border-amber-600/70 bg-amber-900/40"
                  } ${track.locked ? "pointer-events-none opacity-50" : ""}`}
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    width: `${widthPx}px`,
                    height: `${getTrackHeight(sub.trackIndex) - 8}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubtitleId(sub.id);
                    setSelectedClipIds(new Set());
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingSubtitleId(sub.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedSubtitleId(sub.id);
                    setSelectedClipIds(new Set());
                  }}
                  onMouseDown={(e) => {
                    if (track.locked || e.button !== 0) return;
                    e.stopPropagation();
                    const startX = e.clientX;
                    const origStart = sub.startTime;
                    const origEnd = sub.endTime;
                    const dur = origEnd - origStart;

                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX;
                      const dt = dx / pixelsPerSecond;
                      const newStart = Math.max(0, origStart + dt);
                      updateSubtitle(sub.id, {
                        startTime: newStart,
                        endTime: newStart + dur,
                      });
                    };
                    const onUp = () => {
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                >
                  {/* Subtitle text */}
                  <div className="flex-1 min-w-0 px-2 py-1">
                    {isEditing ? (
                      <input
                        autoFocus
                        defaultValue={sub.text}
                        className="w-full bg-transparent text-amber-100 text-[10px] leading-tight outline-hidden border-b border-amber-500/50"
                        onBlur={(e) => {
                          updateSubtitle(sub.id, {
                            text: e.target.value,
                          });
                          setEditingSubtitleId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateSubtitle(sub.id, {
                              text: (e.target as HTMLInputElement).value,
                            });
                            setEditingSubtitleId(null);
                          }
                          if (e.key === "Escape") setEditingSubtitleId(null);
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-[10px] text-amber-200 leading-tight line-clamp-2 break-all">
                        {sub.text}
                      </span>
                    )}
                  </div>

                  {/* Left resize handle */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/30"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const startX = e.clientX;
                      const origStart = sub.startTime;
                      const onMove = (ev: MouseEvent) => {
                        const dx = ev.clientX - startX;
                        const dt = dx / pixelsPerSecond;
                        const newStart = Math.max(
                          0,
                          Math.min(sub.endTime - 0.2, origStart + dt),
                        );
                        updateSubtitle(sub.id, {
                          startTime: newStart,
                        });
                      };
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                  />
                  {/* Right resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/30"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const startX = e.clientX;
                      const origEnd = sub.endTime;
                      const onMove = (ev: MouseEvent) => {
                        const dx = ev.clientX - startX;
                        const dt = dx / pixelsPerSecond;
                        const newEnd = Math.max(
                          sub.startTime + 0.2,
                          origEnd + dt,
                        );
                        updateSubtitle(sub.id, { endTime: newEnd });
                      };
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                  />
                </div>
              );
            })}

            {/* Cut point indicators for cross-dissolve */}
            {cutPoints.map((cp) => {
              const leftPx = cp.time * pixelsPerSecond;
              const topPx = trackTopPx(cp.trackIndex, 4);
              const isHovered =
                hoveredCutPoint?.leftClipId === cp.leftClip.id &&
                hoveredCutPoint?.rightClipId === cp.rightClip.id;
              const dissolveDur = cp.hasDissolve
                ? cp.leftClip.transitionOut?.duration ||
                  DEFAULT_DISSOLVE_DURATION
                : 0;
              const dissolveWidthPx = dissolveDur * pixelsPerSecond;

              return (
                <div
                  key={`cut-${cp.leftClip.id}-${cp.rightClip.id}`}
                  className="absolute z-20"
                  style={{
                    left: `${cp.hasDissolve ? leftPx - dissolveWidthPx : leftPx - 10}px`,
                    top: `${topPx - 24}px`,
                    width: `${cp.hasDissolve ? dissolveWidthPx * 2 : 20}px`,
                    height: `${48 + 24}px` /* extend upward to include popup zone */,
                  }}
                  onMouseEnter={() =>
                    setHoveredCutPoint({
                      leftClipId: cp.leftClip.id,
                      rightClipId: cp.rightClip.id,
                      time: cp.time,
                      trackIndex: cp.trackIndex,
                    })
                  }
                  onMouseLeave={() => setHoveredCutPoint(null)}
                >
                  {/* Visible indicator line */}
                  <div
                    className={`absolute top-6 bottom-0 w-0.5 transition-colors ${
                      isHovered
                        ? "bg-blue-400"
                        : cp.hasDissolve
                          ? "bg-blue-500/60"
                          : "bg-transparent"
                    }`}
                    style={{
                      left: `${cp.hasDissolve ? dissolveWidthPx : 10}px`,
                      transform: "translateX(-50%)",
                    }}
                  />

                  {cp.hasDissolve ? (
                    <>
                      {/* Dissolve region visual (gradient bar on the clip area) */}
                      <div
                        className="absolute rounded-sm pointer-events-none"
                        style={{
                          left: 0,
                          top: "24px",
                          width: `${dissolveWidthPx * 2}px`,
                          height: "48px",
                          background:
                            "linear-gradient(to right, rgba(139,92,246,0.15), rgba(139,92,246,0.3), rgba(139,92,246,0.15))",
                          borderTop: "2px solid rgba(139,92,246,0.5)",
                          borderBottom: "2px solid rgba(139,92,246,0.5)",
                        }}
                      />

                      {/* Dissolve duration label */}
                      <div
                        className="absolute flex items-center justify-center pointer-events-none"
                        style={{
                          left: 0,
                          top: "24px",
                          width: `${dissolveWidthPx * 2}px`,
                          height: "48px",
                        }}
                      >
                        <span className="text-[9px] text-blue-300 font-medium bg-blue-900/60 px-1.5 py-0.5 rounded-sm">
                          {dissolveDur.toFixed(1)}s
                        </span>
                      </div>

                      {/* Left drag handle */}
                      <div
                        className="absolute top-6 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/40 transition-colors z-30"
                        style={{ left: 0 }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const startX = e.clientX;
                          const startDur = dissolveDur;

                          const handleMove = (ev: MouseEvent) => {
                            const delta =
                              (startX - ev.clientX) / pixelsPerSecond;
                            const newDur = Math.max(
                              0.1,
                              Math.min(
                                cp.leftClip.duration * 0.9,
                                startDur + delta,
                              ),
                            );
                            setClips((prev) =>
                              prev.map((c) => {
                                if (c.id === cp.leftClip.id)
                                  return {
                                    ...c,
                                    transitionOut: {
                                      ...c.transitionOut,
                                      duration: +newDur.toFixed(2),
                                    },
                                  };
                                if (c.id === cp.rightClip.id)
                                  return {
                                    ...c,
                                    transitionIn: {
                                      ...c.transitionIn,
                                      duration: +newDur.toFixed(2),
                                    },
                                  };
                                return c;
                              }),
                            );
                          };
                          const handleUp = () => {
                            document.removeEventListener(
                              "mousemove",
                              handleMove,
                            );
                            document.removeEventListener("mouseup", handleUp);
                            document.body.style.cursor = "";
                            document.body.style.userSelect = "";
                          };
                          pushUndo();
                          document.addEventListener("mousemove", handleMove);
                          document.addEventListener("mouseup", handleUp);
                          document.body.style.cursor = "ew-resize";
                          document.body.style.userSelect = "none";
                        }}
                      >
                        <div className="absolute inset-y-0 left-0 w-0.5 bg-blue-400 rounded-full" />
                      </div>

                      {/* Right drag handle */}
                      <div
                        className="absolute top-6 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/40 transition-colors z-30"
                        style={{ right: 0 }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const startX = e.clientX;
                          const startDur = dissolveDur;

                          const handleMove = (ev: MouseEvent) => {
                            const delta =
                              (ev.clientX - startX) / pixelsPerSecond;
                            const newDur = Math.max(
                              0.1,
                              Math.min(
                                cp.rightClip.duration * 0.9,
                                startDur + delta,
                              ),
                            );
                            setClips((prev) =>
                              prev.map((c) => {
                                if (c.id === cp.leftClip.id)
                                  return {
                                    ...c,
                                    transitionOut: {
                                      ...c.transitionOut,
                                      duration: +newDur.toFixed(2),
                                    },
                                  };
                                if (c.id === cp.rightClip.id)
                                  return {
                                    ...c,
                                    transitionIn: {
                                      ...c.transitionIn,
                                      duration: +newDur.toFixed(2),
                                    },
                                  };
                                return c;
                              }),
                            );
                          };
                          const handleUp = () => {
                            document.removeEventListener(
                              "mousemove",
                              handleMove,
                            );
                            document.removeEventListener("mouseup", handleUp);
                            document.body.style.cursor = "";
                            document.body.style.userSelect = "";
                          };
                          pushUndo();
                          document.addEventListener("mousemove", handleMove);
                          document.addEventListener("mouseup", handleUp);
                          document.body.style.cursor = "ew-resize";
                          document.body.style.userSelect = "none";
                        }}
                      >
                        <div className="absolute inset-y-0 right-0 w-0.5 bg-blue-400 rounded-full" />
                      </div>

                      {/* Remove button (shown on hover, positioned inside the zone) */}
                      {isHovered && (
                        <div
                          className="absolute left-1/2 -translate-x-1/2 top-0 whitespace-nowrap z-40"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="px-2 py-0.5 rounded-sm bg-red-900/80 border border-red-700 text-[9px] text-red-300 hover:bg-red-800 transition-colors shadow-lg"
                            onClick={() =>
                              removeCrossDissolve(
                                cp.leftClip.id,
                                cp.rightClip.id,
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* No dissolve: show add button on hover (positioned inside the zone) */}
                      {isHovered && (
                        <div
                          className="absolute left-1/2 -translate-x-1/2 top-0 whitespace-nowrap z-40"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="px-2 py-1 rounded-lg bg-blue-600/90 border border-blue-500 text-[10px] text-white hover:bg-blue-500 transition-colors shadow-lg flex items-center gap-1"
                            onClick={() =>
                              addCrossDissolve(cp.leftClip.id, cp.rightClip.id)
                            }
                          >
                            <Film className="h-3 w-3" />
                            Dissolve
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* close relative inner */}
        </div>
        {/* close trackContainerRef */}
      </div>
    </>
  );
}
