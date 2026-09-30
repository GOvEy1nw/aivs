import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FolderOpen,
  Heart,
  Maximize,
  Pause,
  Play,
  Repeat2,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { ClipWaveform } from "../../components/AudioWaveform";
import type { ImageUseTarget } from "../../components/UseImageDropdown";
import type { VideoUseTarget } from "../../components/UseVideoDropdown";
import type { Asset } from "../../types/project";
import type { GenSpaceGalleryProps } from "./GenSpaceGallery";
import { GenerationPreviewMedia } from "./components/GenerationPreviewMedia";
import { GalleryHandoffMenu } from "./components/GalleryHandoffMenu";
import type { GalleryHandoffDestination } from "./logic/gallery-handoff-policy";

export interface GenSpaceSelectedGenerationProps {
  style?: React.CSSProperties;
  isActive?: boolean;
  asset: Asset | null;
  modelName?: string;
  generation: GenSpaceGalleryProps["generation"];
  selectedIndex: number;
  visibleAssetCount: number;
  copiedPrompt: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onCopyPrompt: (prompt: string) => void;
  onToggleFavorite: (asset: Asset) => void;
  onUseImage: (asset: Asset, target: ImageUseTarget) => void;
  onUseVideo: (asset: Asset, target: VideoUseTarget) => void;
  getHandoffDestinations: (asset: Asset) => readonly GalleryHandoffDestination[];
  onHandoff: (asset: Asset, destination: GalleryHandoffDestination) => void;
  onUpscale: (asset: Asset) => void;
  onCopySettings: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
  onSelectTake: (assetId: string, takeIndex: number) => void;
}

function ActionButton({
  label,
  icon,
  onClick,
  active = false,
  danger = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
        danger
          ? "border-red-500/20 text-red-400 hover:bg-red-500/10"
          : active
            ? "border-red-500/20 bg-red-500/10 text-red-400"
            : "border-border text-muted-foreground hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
      }`}
      aria-label={label}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function formatGenerationProgressDetails(badges: string[]) {
  const step = badges.find((badge) => badge.startsWith("Step "));
  const phase = badges.find((badge) => badge.startsWith("Phase "));
  const section = badges.find((badge) => badge.startsWith("Section "));
  return [step, phase ? `(${phase})` : null, section].filter(Boolean).join(" ");
}

function getGenerationStatusMessage(
  generation: GenSpaceGalleryProps["generation"],
) {
  const statusMessage = generation.statusMessage.trim();
  if (
    generation.modelLifecycleActive ||
    /^loading model\b/i.test(statusMessage)
  ) {
    return "Loading Model";
  }
  if (generation.modelDownload || /^downloading model\b/i.test(statusMessage)) {
    return "Downloading Model";
  }
  return statusMessage || "Generating...";
}

function GenerationProgressHeader({
  generation,
}: {
  generation: GenSpaceGalleryProps["generation"];
}) {
  const progress = Math.max(0, Math.min(100, generation.progress));
  const details = formatGenerationProgressDetails(generation.badges);

  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-foreground">
        {getGenerationStatusMessage(generation)}
      </p>
      <div className="mt-2 flex min-w-0 items-center gap-3 text-xs">
        <p className="min-w-0 flex-1 truncate text-muted-foreground">
          <span className="text-foreground">{generation.modelName}</span>
          {details ? <span>: {details}</span> : null}
        </p>
        <span className="shrink-0 font-mono text-muted-foreground">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          data-testid="generation-progress-bar"
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-raised"
        >
          <div
            className="h-full bg-violet-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <button
          type="button"
          onClick={generation.cancel}
          disabled={generation.isCancelling}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          aria-label="Cancel generation"
          title="Cancel generation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function formatPlaybackTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function MediaPlayerControls({
  currentTime,
  duration,
  isPlaying,
  muted,
  loop,
  audio,
  onPlayPause,
  onSeek,
  onToggleMuted,
  onToggleLoop,
  onFullscreen,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  muted: boolean;
  loop: boolean;
  audio: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onToggleMuted: () => void;
  onToggleLoop: () => void;
  onFullscreen?: () => void;
}) {
  return (
    <div
      data-testid="media-player-controls"
      className="w-full shrink-0 border-t border-border bg-surface-raised/95 px-5 py-3 backdrop-blur"
    >
      <div
        className={`flex w-full items-center gap-3 ${audio ? "justify-center" : ""}`}
      >
        <button
          type="button"
          onClick={onPlayPause}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
            audio
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
              : "border-violet-400/20 bg-violet-400/10 text-violet-300 hover:bg-violet-400/20"
          }`}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>
        {!audio ? (
          <>
            <span className="w-20 shrink-0 text-center font-mono text-[11px] text-muted-foreground">
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step="0.01"
              value={Math.min(currentTime, duration || 0)}
              disabled={duration <= 0}
              onChange={(event) => onSeek(Number(event.currentTarget.value))}
              aria-label="Playback position"
              className="min-w-0 flex-1 cursor-pointer accent-violet-400 disabled:cursor-wait"
            />
            <button
              type="button"
              onClick={onToggleMuted}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onToggleLoop}
              aria-label={loop ? "Disable loop" : "Enable loop"}
              aria-pressed={loop}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                loop
                  ? "bg-violet-400/10 text-violet-300 hover:bg-violet-400/20"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              <Repeat2 className="h-4 w-4" />
            </button>
            {onFullscreen ? (
              <button
                type="button"
                onClick={onFullscreen}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                aria-label="Full screen"
              >
                <Maximize className="h-4 w-4" />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function PlayableAssetPreview({
  asset,
  isActive,
  onResolutionChange,
}: {
  asset: Asset;
  isActive: boolean;
  onResolutionChange: (resolution: string) => void;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(asset.duration ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const audio = asset.type === "audio";
  const progress = duration > 0 ? currentTime / duration : 0;

  const syncDuration = (media: HTMLMediaElement) => {
    if (Number.isFinite(media.duration) && media.duration > 0) {
      setDuration(media.duration);
    }
  };

  const syncMetadata = (media: HTMLMediaElement) => {
    syncDuration(media);
    if (
      media instanceof HTMLVideoElement &&
      media.videoWidth > 0 &&
      media.videoHeight > 0
    ) {
      onResolutionChange(`${media.videoWidth} × ${media.videoHeight}`);
    }
  };

  const handlePlayPause = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused || media.ended) {
      void media.play().catch(() => setIsPlaying(false));
    } else {
      media.pause();
    }
  }, []);

  useEffect(() => {
    if (!isActive) mediaRef.current?.pause();
  }, [isActive]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return;
      const isSpace =
        event.code === "Space" ||
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Space";
      if (!isSpace || event.repeat || event.defaultPrevented) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input, textarea, select, button, [contenteditable='true']",
        )
      ) {
        return;
      }
      const media = mediaRef.current;
      if (!media || media.closest("[hidden]")) return;
      event.preventDefault();
      handlePlayPause();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlayPause, isActive]);

  const handleSeek = (time: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = time;
    setCurrentTime(time);
  };

  const handleWaveformClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || duration <= 0) return;
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    handleSeek(fraction * duration);
  };

  const handleWaveformKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    handleSeek(
      Math.max(
        0,
        Math.min(duration, currentTime + (event.key === "ArrowRight" ? 5 : -5)),
      ),
    );
  };

  const handleToggleMuted = () => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !media.muted;
    setMuted(media.muted);
  };

  const handleFullscreen = () => {
    void mediaRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const mediaEvents = {
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      syncMetadata(event.currentTarget),
    onDurationChange: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      syncDuration(event.currentTarget),
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      setCurrentTime(event.currentTarget.currentTime),
    onPlay: () => setIsPlaying(true),
    onPause: () => setIsPlaying(false),
    onEnded: () => setIsPlaying(false),
    onVolumeChange: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      setMuted(event.currentTarget.muted),
  };

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {audio ? (
        <div
          data-testid="audio-waveform"
          role="slider"
          tabIndex={duration > 0 ? 0 : -1}
          aria-label="Audio playback position"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatPlaybackTime(currentTime)} of ${formatPlaybackTime(duration)}`}
          onClick={handleWaveformClick}
          onKeyDown={handleWaveformKeyDown}
          className="relative min-h-0 w-full flex-1 cursor-pointer overflow-hidden bg-linear-to-b from-emerald-950/20 to-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70"
        >
          <audio
            ref={(node) => {
              mediaRef.current = node;
            }}
            src={asset.url}
            preload="metadata"
            {...mediaEvents}
          />
          <ClipWaveform
            url={asset.url}
            progress={progress}
            color="rgba(52, 211, 153, 0.62)"
            playedColor="rgba(74, 222, 168, 0.74)"
          />
        </div>
      ) : (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-black">
          <video
            ref={(node) => {
              mediaRef.current = node;
            }}
            src={asset.url}
            preload="metadata"
            loop={loop}
            onClick={handlePlayPause}
            className="h-full w-full cursor-pointer object-contain"
            aria-label={isPlaying ? "Pause video" : "Play video"}
            {...mediaEvents}
          />
        </div>
      )}
      <MediaPlayerControls
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        muted={muted}
        loop={loop}
        audio={audio}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        onToggleMuted={handleToggleMuted}
        onToggleLoop={() => setLoop((current) => !current)}
        onFullscreen={audio ? undefined : handleFullscreen}
      />
    </div>
  );
}

type ImageTransform = { scale: number; offset: { x: number; y: number } };

function ImageViewport({
  transform,
  onTransformChange,
  children,
  transformContent = true,
}: {
  transform: ImageTransform;
  onTransformChange: (transform: ImageTransform) => void;
  children: ReactNode;
  transformContent?: boolean;
}) {
  const dragStartRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const zoomed =
    transform.scale > 1 || transform.offset.x !== 0 || transform.offset.y !== 0;
  return (
    <div
      className="relative flex h-full w-full touch-none items-center justify-center overflow-hidden p-5"
      onWheel={(event) => {
        event.preventDefault();
        const scale = Math.min(
          4,
          Math.max(1, transform.scale + (event.deltaY < 0 ? 0.25 : -0.25)),
        );
        onTransformChange({
          scale,
          offset: scale === 1 ? { x: 0, y: 0 } : transform.offset,
        });
      }}
      onPointerDown={(event) => {
        if (
          transform.scale <= 1 ||
          (event.target as HTMLElement).closest(
            "button, input, select, textarea, a, [role='slider']",
          )
        ) {
          return;
        }
        dragStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          offsetX: transform.offset.x,
          offsetY: transform.offset.y,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const dragStart = dragStartRef.current;
        if (!dragStart) return;
        onTransformChange({
          ...transform,
          offset: {
            x: dragStart.offsetX + event.clientX - dragStart.x,
            y: dragStart.offsetY + event.clientY - dragStart.y,
          },
        });
      }}
      onPointerUp={(event) => {
        dragStartRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        dragStartRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
      }}
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        style={
          transformContent
            ? {
                transform: `translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`,
              }
            : undefined
        }
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => onTransformChange({ scale: 1, offset: { x: 0, y: 0 } })}
        disabled={!zoomed}
        className="absolute bottom-4 right-4 rounded-md border border-border bg-popover/90 px-3 py-1.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Reset zoom"
      >
        Reset Zoom
      </button>
    </div>
  );
}

function AssetPreview({
  asset,
  isActive,
  transform,
  onTransformChange,
  onResolutionChange,
}: {
  asset: Asset;
  isActive: boolean;
  transform: ImageTransform;
  onTransformChange: (transform: ImageTransform) => void;
  onResolutionChange: (resolution: string) => void;
}) {
  if (asset.type === "video" || asset.type === "audio") {
    return (
      <PlayableAssetPreview
        key={asset.url}
        asset={asset}
        isActive={isActive}
        onResolutionChange={onResolutionChange}
      />
    );
  }
  return (
    <ImageViewport transform={transform} onTransformChange={onTransformChange}>
      <img
        key={asset.url}
        src={asset.url}
        alt={asset.prompt}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            onResolutionChange(
              `${image.naturalWidth} × ${image.naturalHeight}`,
            );
          }
        }}
        className="max-h-full max-w-full select-none object-contain"
        draggable={false}
      />
    </ImageViewport>
  );
}

function ImageComparePreview({
  first,
  second,
  transform,
  onTransformChange,
  onResolutionChange,
}: {
  first: string;
  second: string;
  transform: ImageTransform;
  onTransformChange: (transform: ImageTransform) => void;
  onResolutionChange: (resolution: string) => void;
}) {
  const [reveal, setReveal] = useState(50);
  const dividerDraggingRef = useRef(false);
  const updateReveal = (clientX: number, viewer: HTMLElement | null) => {
    const bounds = viewer?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    setReveal(
      Math.round(
        Math.max(
          0,
          Math.min(100, ((clientX - bounds.left) / bounds.width) * 100),
        ),
      ),
    );
  };
  return (
    <ImageViewport
      transform={transform}
      onTransformChange={onTransformChange}
      transformContent={false}
    >
      <div
        data-testid="compare-image-b"
        className="absolute inset-0"
        style={{
          transform: `translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`,
        }}
      >
        <img
          src={second}
          alt="Version B"
          className="h-full w-full select-none object-contain"
          draggable={false}
        />
      </div>
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}
      >
        <div
          data-testid="compare-image-a"
          className="absolute inset-0"
          style={{
            transform: `translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`,
          }}
        >
          <img
            src={first}
            alt="Version A"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                onResolutionChange(
                  `${image.naturalWidth} × ${image.naturalHeight}`,
                );
              }
            }}
            className="h-full w-full select-none object-contain"
            draggable={false}
          />
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
        A
      </span>
      <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
        B
      </span>
      <button
        type="button"
        role="slider"
        tabIndex={0}
        aria-label="A/B reveal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reveal}
        aria-valuetext={`${reveal}% Version B`}
        onKeyDown={(event) => {
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 100
                : event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? Math.max(0, reveal - 1)
                  : event.key === "ArrowRight" || event.key === "ArrowUp"
                    ? Math.min(100, reveal + 1)
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          setReveal(next);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          dividerDraggingRef.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateReveal(event.clientX, event.currentTarget.parentElement);
        }}
        onPointerMove={(event) => {
          if (dividerDraggingRef.current) {
            updateReveal(event.clientX, event.currentTarget.parentElement);
          }
        }}
        onPointerUp={(event) => {
          dividerDraggingRef.current = false;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={(event) => {
          dividerDraggingRef.current = false;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        style={{ left: `${reveal}%` }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
        <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-violet-500 shadow" />
      </button>
    </ImageViewport>
  );
}

export function GenSpaceSelectedGeneration({
  asset,
  isActive = true,
  style,
  modelName,
  generation,
  selectedIndex,
  visibleAssetCount,
  canGoPrev,
  canGoNext,
  onClose,
  onPrevious,
  onNext,
  onToggleFavorite,
  getHandoffDestinations,
  onHandoff,
  onUpscale,
  onCopySettings,
  onDelete,
  onSelectTake,
}: GenSpaceSelectedGenerationProps) {
  const showingGeneration = generation.isRunning && generation.isSelected;
  const takeTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [comparisonTakeIndex, setComparisonTakeIndex] = useState<number | null>(
    null,
  );
  const [imageTransform, setImageTransform] = useState<ImageTransform>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });
  const [decodedResolution, setDecodedResolution] = useState<string | null>(
    null,
  );
  const activeTakeIndex = asset?.activeTakeIndex ?? 0;
  useEffect(() => {
    setComparisonTakeIndex(null);
  }, [asset?.id, activeTakeIndex]);
  useEffect(() => {
    setImageTransform({ scale: 1, offset: { x: 0, y: 0 } });
  }, [asset?.id]);
  useEffect(() => {
    setDecodedResolution(null);
  }, [asset?.url]);
  const handleTakeTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    takeIndex: number,
  ) => {
    if (!asset?.takes) return;
    const lastIndex = asset.takes.length - 1;
    const nextIndex =
      event.key === "ArrowLeft"
        ? (takeIndex + lastIndex) % asset.takes.length
        : event.key === "ArrowRight"
          ? (takeIndex + 1) % asset.takes.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? lastIndex
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    setComparisonTakeIndex(null);
    onSelectTake(asset.id, nextIndex);
    takeTabRefs.current[nextIndex]?.focus();
  };
  const activeTake = asset?.takes?.[activeTakeIndex];
  const upscale = asset?.generationParams?.upscale;
  const title =
    asset?.prompt ||
    (upscale ? `Upscale ${upscale.scale}x` : "Selected generation");
  const comparedTakes =
    asset?.type === "image" && comparisonTakeIndex !== null
      ? [activeTake, asset.takes?.[comparisonTakeIndex]].filter(
          (take): take is NonNullable<typeof take> => Boolean(take),
        )
      : [];
  const metadata = asset
    ? [
        ["Model", modelName ?? "Unknown"],
        [
          "Resolution",
          asset.type === "image" || asset.type === "video"
            ? (decodedResolution ?? "Loading…")
            : asset.resolution || "Original",
        ],
        ...(asset.duration !== undefined
          ? [["Duration", `${asset.duration}s`]]
          : []),
        [
          "Generation time",
          asset.generationTimeSeconds !== undefined
            ? formatPlaybackTime(asset.generationTimeSeconds)
            : "Not recorded",
        ],
        ["Seed", activeTake?.seed ?? "Not recorded"],
        [
          "Created",
          new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(activeTake?.createdAt ?? asset.createdAt),
        ],
      ]
    : [];

  return (
    <section
      data-testid="selected-generation-panel"
      className="absolute inset-y-0 m-2 flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card border border-border"
      style={style}
    >
      <header className="flex h-30 shrink-0 items-center justify-between gap-4 bg-card px-5">
        <div className={`min-w-0 flex-1 ${showingGeneration ? "hidden" : ""}`}>
          <div className="flex min-w-0 mb-4 items-center gap-2">
            <h2
              className="min-w-0 truncate text-sm font-semibold text-foreground"
              title={title}
            >
              {title}
            </h2>
            {asset?.generationParams ? (
              <button
                type="button"
                onClick={() => onCopySettings(asset)}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
                aria-label="Copy settings"
                title="Copy settings"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span>Copy settings</span>
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {metadata.map(([label, value]) => (
              <div key={label}>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  {label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{value}</p>
              </div>
            ))}
          </div>
        </div>
        {asset ? (
          <p className="mt-0.5 text-[10px] text-subtle-foreground">
            {selectedIndex + 1} of {visibleAssetCount}
          </p>
        ) : null}
        {asset ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrevious}
              disabled={!canGoPrev}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:text-subtle-foreground"
              aria-label="Previous asset"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoNext}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:text-subtle-foreground"
              aria-label="Next asset"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              aria-label="Clear selected asset"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {showingGeneration ? (
          <GenerationProgressHeader generation={generation} />
        ) : null}
      </header>

      {showingGeneration ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/40">
          {generation.previewUrl ? (
            <GenerationPreviewMedia
              url={generation.previewUrl}
              className="h-full w-full object-contain"
            />
          ) : null}
        </div>
      ) : asset ? (
        <>
          {(asset.type === "image" || asset.type === "video") &&
          asset.takes &&
          asset.takes.length > 1 ? (
            <div
              role="tablist"
              aria-label="Asset versions"
              className="flex shrink-0 justify-center gap-2 border-b border-border bg-surface px-5 py-3"
            >
              {asset.takes.map((take, index) => {
                const active = activeTakeIndex === index;
                const label =
                  index === 0
                    ? "Original"
                    : take.generationParams?.mode === "upscale"
                      ? `Upscaled version ${index}`
                      : `Version ${index + 1}`;
                const comparisonLabel =
                  comparisonTakeIndex === null
                    ? null
                    : active
                      ? "A"
                      : comparisonTakeIndex === index
                        ? "B"
                        : null;
                return (
                  <button
                    key={`${take.createdAt}-${index}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={
                      comparisonLabel
                        ? `${label}, comparison ${comparisonLabel}`
                        : label
                    }
                    tabIndex={active ? 0 : -1}
                    onClick={(event) => {
                      if (
                        asset.type === "image" &&
                        (event.ctrlKey || event.metaKey)
                      ) {
                        if (index === activeTakeIndex) {
                          setComparisonTakeIndex(null);
                        } else {
                          setComparisonTakeIndex((current) =>
                            current === index ? null : index,
                          );
                        }
                        return;
                      }
                      setComparisonTakeIndex(null);
                      onSelectTake(asset.id, index);
                    }}
                    onKeyDown={(event) => handleTakeTabKeyDown(event, index)}
                    ref={(node) => {
                      takeTabRefs.current[index] = node;
                    }}
                    className={`relative h-14 w-14 overflow-hidden rounded-lg border-2 bg-surface-raised outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
                      active
                        ? "border-blue-500 ring-2 ring-blue-500/30"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    {asset.type === "video" ? (
                      <video
                        src={take.url}
                        muted
                        preload="metadata"
                        tabIndex={-1}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={take.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                    {comparisonLabel ? (
                      <span className="absolute right-0 top-0 rounded-bl bg-violet-500 px-1 text-[10px] font-semibold text-white">
                        {comparisonLabel}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 overflow-hidden bg-black/40">
            {comparedTakes.length === 2 ? (
              <ImageComparePreview
                key={`${comparedTakes[0].url}-${comparedTakes[1].url}`}
                first={comparedTakes[0].url}
                second={comparedTakes[1].url}
                transform={imageTransform}
                onTransformChange={setImageTransform}
                onResolutionChange={setDecodedResolution}
              />
            ) : (
              <AssetPreview
                asset={asset}
                isActive={isActive}
                transform={imageTransform}
                onTransformChange={setImageTransform}
                onResolutionChange={setDecodedResolution}
              />
            )}
          </div>
          <div className="shrink-0 bg-surface-raised px-5 py-4">
            <div className="flex flex-wrap gap-2">
              <ActionButton
                label={asset.favorite ? "Favorited" : "Favorite"}
                active={asset.favorite}
                icon={
                  <Heart
                    className={`h-4 w-4 ${
                      asset.favorite ? "fill-current" : ""
                    }`}
                  />
                }
                onClick={() => onToggleFavorite(asset)}
              />
              <ActionButton
                label="Open"
                icon={<FolderOpen className="h-4 w-4" />}
                onClick={() =>
                  void window.electronAPI?.showItemInFolder(asset.path)
                }
              />
              <GalleryHandoffMenu
                asset={asset}
                destinations={getHandoffDestinations(asset)}
                onSelect={(destination) => onHandoff(asset, destination)}
                variant="detail"
              />
              {asset.type === "image" || asset.type === "video" ? (
                <ActionButton
                  label="Upscale"
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={() => onUpscale(asset)}
                />
              ) : null}
              <ActionButton
                label="Remove"
                danger
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => onDelete(asset)}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-border">
            <Sparkles className="h-8 w-8 text-subtle-foreground" />
          </div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Select a generation
          </h3>
          <p className="mt-2 max-w-sm text-xs leading-5 text-subtle-foreground">
            Choose an asset or the active generation card to inspect its
            preview, metadata, prompt, and actions.
          </p>
        </div>
      )}
    </section>
  );
}
