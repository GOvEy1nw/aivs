import { useEffect, useRef, useState } from "react";
import type { Asset } from "../../../types/project";
import { GuideMediaTrimEditor } from "../video/GuideMediaTrimEditor";
import type { GenSpaceMediaInput } from "../types";
import type { GalleryHandoffDestination } from "../logic/gallery-handoff-policy";

export function GalleryExcerptDialog({
  asset,
  destination,
  onUseFull,
  onUseExcerpt,
  onCancel,
}: {
  asset: Asset;
  destination: GalleryHandoffDestination;
  onUseFull: () => void;
  onUseExcerpt: (input: Pick<GenSpaceMediaInput, "trimStartTime" | "trimDuration" | "mediaDuration">) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const [selection, setSelection] = useState<GenSpaceMediaInput>({
    id: asset.id,
    assetId: asset.id,
    url: asset.url,
    path: asset.path,
    role: destination.target,
    type: asset.type === "audio" ? "audio" : "video",
    mediaDuration: asset.duration,
  });

  return (
    <dialog ref={dialogRef} onCancel={(event) => { event.preventDefault(); onCancel(); }} className="m-auto max-h-[90vh] w-full max-w-2xl border-0 bg-transparent p-0 backdrop:bg-black/75" aria-label={`${destination.label} excerpt`}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-popover p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-foreground">{destination.label}</h2>
          <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
        <GuideMediaTrimEditor
          item={selection}
          onChange={(patch) => setSelection((current) => ({ ...current, ...patch }))}
          onConfirm={() => onUseExcerpt(selection)}
        />
        <button type="button" onClick={onUseFull} className="mt-2 w-full rounded-sm border border-border px-2 py-1.5 text-xs text-foreground hover:bg-surface-hover">
          Use full clip
        </button>
      </div>
    </dialog>
  );
}
