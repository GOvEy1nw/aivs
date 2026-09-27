import {
  GripHorizontal,
  Image,
  ListOrdered,
  Music2,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useState } from "react";
import { DownloadProgressView } from "./DownloadProgressView";
import {
  useGenerationQueue,
  type GenerationQueueJob,
} from "../contexts/GenerationQueueContext";

const modeLabels: Record<GenerationQueueJob["kind"], string> = {
  "image.generate": "Generate",
  "video.generate": "Generate",
  "audio.music": "Music",
  "audio.sfx": "SFX",
  "audio.speech": "Speech",
  "media.upscale": "Upscale",
  "video.retake": "Retake",
  "director.generate": "Director",
};

function modeLabel(job: GenerationQueueJob): string {
  return job.summary.operation === "video.reframe"
    ? "Reframe"
    : modeLabels[job.kind];
}

function MediaIcon({
  mediaKind,
}: {
  mediaKind: GenerationQueueJob["summary"]["mediaKind"];
}) {
  const Icon =
    mediaKind === "image" ? Image : mediaKind === "video" ? Video : Music2;
  const className =
    mediaKind === "image"
      ? "bg-blue-500/15 text-blue-400"
      : mediaKind === "video"
        ? "bg-violet-500/15 text-violet-400"
        : "bg-emerald-500/15 text-emerald-400";
  return (
    <span
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md ${className}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function stopRowSelection(event: React.MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

function JobRow({
  job,
  selected,
  onSelect,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  job: GenerationQueueJob;
  selected: boolean;
  onSelect?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: React.DragEventHandler<HTMLLIElement>;
  onDrop?: React.DragEventHandler<HTMLLIElement>;
}) {
  const { cancel, discard, dismiss, remove } = useGenerationQueue();
  const active = job.status === "running" || job.status === "cancel_requested";
  const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(
    job.status,
  );
  const prompt = job.summary.promptPreview?.trim();
  const mediaLabel =
    job.summary.mediaKind === "audio"
      ? "Audio"
      : job.summary.mediaKind === "video"
        ? "Video"
        : "Image";
  const media = job.summary.referenceThumbnailUrl ? (
    <img
      src={job.summary.referenceThumbnailUrl}
      alt="First image reference"
      className="h-8 w-8 shrink-0 rounded-md object-cover"
    />
  ) : (
    <MediaIcon mediaKind={job.summary.mediaKind} />
  );
  const details = (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="truncate text-xs font-medium text-foreground">
          {mediaLabel} · {modeLabel(job)}
        </span>
        {job.summary.modelLabel ? (
          <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {job.summary.modelLabel}
          </span>
        ) : null}
        {job.summary.badges?.map((badge) => (
          <span
            key={badge}
            className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {badge}
          </span>
        ))}
      </div>
      {prompt ? (
        <p
          className="mt-0.5 truncate text-[11px] text-muted-foreground"
          title={prompt}
        >
          {prompt}
        </p>
      ) : null}
      {job.error ? (
        <p className="mt-0.5 text-[11px] text-destructive">{job.error}</p>
      ) : null}
      {active && job.progress?.modelDownload ? (
        <DownloadProgressView
          title="Downloading model"
          transfer={job.progress.modelDownload}
          compact
          className="mt-1.5"
        />
      ) : active && typeof job.progress?.percent === "number" ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-surface-raised">
          <div
            className="h-full bg-primary"
            style={{
              width: `${Math.max(0, Math.min(100, job.progress.percent))}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
  return (
    <li
      className="border-b border-border last:border-b-0"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className={`flex items-start gap-2 px-3 py-1.5 ${selected ? "bg-surface-selected" : ""}`}
      >
        {onSelect ? (
          <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            className="flex min-w-0 flex-1 gap-2 rounded text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            {media}
            {details}
          </button>
        ) : onMove ? (
          <>
            <div className="flex shrink-0 flex-col items-center">
              {media}
              <button
                type="button"
                draggable
                aria-label="Drag to reorder queued generation"
                aria-keyshortcuts="ArrowUp ArrowDown"
                title="Drag to reorder; use arrow keys when focused"
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                  event.preventDefault();
                  onMove(event.key === "ArrowUp" ? -1 : 1);
                }}
                className="mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
            {details}
          </>
        ) : (
          <div className="flex min-w-0 flex-1 gap-2">
            {media}
            {details}
          </div>
        )}
        <div className="flex shrink-0 items-start gap-0.5">
          {active ? (
            <button
              type="button"
              aria-label="Cancel generation job"
              onClick={(event) => {
                stopRowSelection(event);
                void cancel(job.id);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {job.status === "queued" ? (
            <button
              type="button"
              aria-label="Remove queued job"
              onClick={(event) => {
                stopRowSelection(event);
                void remove(job.id);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {job.status === "completed" ? (
            <button
              type="button"
              aria-label="Discard completed generation result"
              onClick={(event) => {
                stopRowSelection(event);
                void discard(job.id);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {terminal && job.status !== "completed" ? (
            <button
              type="button"
              aria-label="Dismiss generation job"
              onClick={(event) => {
                stopRowSelection(event);
                void dismiss(job.id);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function GenerationQueuePanel({
  selectedJobId,
  onSelectActive,
}: {
  selectedJobId: string | null;
  onSelectActive: (jobId: string) => void;
}) {
  const { active, queued, attention, reorder } = useGenerationQueue();
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const moveQueuedJob = (jobId: string, direction: -1 | 1) => {
    const source = queued.findIndex((job) => job.id === jobId);
    const target = source + direction;
    if (source < 0 || target < 0 || target >= queued.length) return;
    const ids = queued.map((job) => job.id);
    [ids[source], ids[target]] = [ids[target], ids[source]];
    void reorder(ids);
  };
  const dropQueuedJob = (targetJobId: string) => {
    if (!draggedJobId || draggedJobId === targetJobId) return;
    const ids = queued.map((job) => job.id);
    const source = ids.indexOf(draggedJobId);
    const target = ids.indexOf(targetJobId);
    if (source < 0 || target < 0) return;
    ids.splice(target, 0, ids.splice(source, 1)[0]);
    void reorder(ids);
  };
  return (
    <section
      className="shrink-0 min-h-[30vh] bg-card rounded-2xl p-4 border border-border"
      aria-label="Generation queue"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground">
        Generation queue
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {active ? (
          <JobRow
            job={active}
            selected={selectedJobId === active.id}
            onSelect={() => onSelectActive(active.id)}
          />
        ) : null}
        {queued.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            selected={false}
            onMove={(direction) => moveQueuedJob(job.id, direction)}
            onDragStart={() => setDraggedJobId(job.id)}
            onDragEnd={() => setDraggedJobId(null)}
            onDragOver={(event) => {
              if (draggedJobId) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropQueuedJob(job.id);
              setDraggedJobId(null);
            }}
          />
        ))}
        {attention.map((job) => (
          <JobRow key={job.id} job={job} selected={false} />
        ))}
        {!active && queued.length === 0 && attention.length === 0 ? (
          <li className="px-3 py-4 text-xs text-muted-foreground">
            No queued generation work.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
