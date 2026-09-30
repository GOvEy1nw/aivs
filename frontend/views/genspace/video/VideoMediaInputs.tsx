import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Palette } from "lucide-react";
import { detectMediaType } from "../../../lib/media-import";
import type { ModelProfile } from "../../../types/model-profiles";
import {
  AUDIO_GUIDE_ROLE_OPTIONS,
  VIDEO_GUIDE_ROLE_OPTIONS,
} from "../constants";
import {
  findGuideInput,
  getH3ReferenceState,
  getH3ReferenceAvailability,
  normalizeVideoInputsForProfile,
  nextH3MediaAlias,
  removeMediaInput,
  replaceGuideInput,
  replaceInputForRole,
} from "../logic/media-inputs";
import type { GenSpaceMediaInput, GenSpaceMediaKind } from "../types";
import { CroppableMediaInputSlot } from "../components/CroppableMediaInputSlot";
import { GenPanelSection } from "../components/GenPanelSection";
import { MediaInputSlot } from "../components/MediaInputSlot";
import { ReferenceAddButton } from "../components/ReferenceAddButton";
import { GuideMediaTrimEditor } from "./GuideMediaTrimEditor";
import { MediaRoleMenu } from "../components/MediaRoleMenu";

function readGalleryAsset(
  event: React.DragEvent,
): { type: GenSpaceMediaKind; url: string } | null {
  const raw = event.dataTransfer.getData("asset");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { type: GenSpaceMediaKind; url: string };
  } catch {
    return null;
  }
}

export function VideoMediaInputs({
  inputs,
  onChange,
  profile,
  useAudioTrack,
  onUseAudioTrackChange,
  resolveInputFileUrl,
  syncInputFileToGallery,
  reservedAliases = [],
  onReferenceRequestReady,
  styles = [],
  selectedStyle,
  onOpenStyles,
  stylesDisabled = false,
  libraryMedia = [],
  freeReferencesDisabled = false,
}: {
  inputs: GenSpaceMediaInput[];
  onChange: Dispatch<SetStateAction<GenSpaceMediaInput[]>>;
  profile: ModelProfile | undefined;
  useAudioTrack: boolean;
  onUseAudioTrackChange: (value: boolean) => void;
  resolveInputFileUrl: (
    file: File,
    sync?: (file: File) => Promise<string | null>,
  ) => Promise<string | null>;
  syncInputFileToGallery?: (file: File) => Promise<string | null>;
  reservedAliases?: readonly string[];
  onReferenceRequestReady?: (
    request: (type: GenSpaceMediaKind) => void,
  ) => void;
  styles?: readonly { id: string; displayName: string }[];
  selectedStyle?: { id: string; displayName: string };
  onOpenStyles?: () => void;
  stylesDisabled?: boolean;
  libraryMedia?: readonly {
    id: string;
    name: string;
    type: "image" | "video" | "audio";
    url: string;
  }[];
  freeReferencesDisabled?: boolean;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const guideInputRef = useRef<HTMLInputElement>(null);
  const pendingFrameRoleRef = useRef<"start_image" | "end_image">(
    "start_image",
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [guideDragActive, setGuideDragActive] = useState(false);
  const supportsInputs = !!profile?.inputMedia.supportsImageInputs;
  const isH3 =
    profile?.id === "minimax_h3_fast" || profile?.id === "minimax_h3_quality";
  const guide = findGuideInput(inputs);

  useEffect(() => {
    if (isH3) return;
    const normalized = normalizeVideoInputsForProfile(inputs, supportsInputs);
    const changed =
      normalized.length !== inputs.length ||
      normalized.some((input, index) => input.id !== inputs[index]?.id);
    if (changed) onChange(normalized);
    if (
      activeId &&
      activeId !== "guide_slot" &&
      !normalized.some(({ role }) => role === activeId)
    ) {
      setActiveId(null);
    }
  }, [activeId, inputs, isH3, onChange, supportsInputs]);

  useEffect(() => {
    if (!activeId) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-media-menu]")
      ) {
        return;
      }
      setActiveId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [activeId]);

  const setSlot = useCallback(
    (url: string, role: string, kind: GenSpaceMediaKind, editGuide = true) => {
      const next = { id: crypto.randomUUID(), url, role, type: kind };
      onChange((current) =>
        role === "start_image" || role === "end_image"
          ? replaceInputForRole(current, next)
          : replaceGuideInput(current, next),
      );
      if (kind !== "image" && editGuide) setEditingGuideId(next.id);
    },
    [onChange],
  );

  const addFile = async (file: File, role?: "start_image" | "end_image") => {
    const kind = detectMediaType(file.name, file.type);
    if (!kind) return;
    if (role && kind !== "image") return;
    const url = await resolveInputFileUrl(file, syncInputFileToGallery);
    if (!url) return;
    setSlot(
      url,
      role ?? (kind === "audio" ? "audio_to_video" : "human_motion"),
      kind,
    );
  };

  const dropFor =
    (
      role: "start_image" | "end_image" | "guide",
      expected?: GenSpaceMediaKind,
    ) =>
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setGuideDragActive(false);
      const asset = readGalleryAsset(event);
      if (asset && (!expected || asset.type === expected)) {
        setSlot(
          asset.url,
          role === "guide"
            ? asset.type === "audio"
              ? "audio_to_video"
              : "human_motion"
            : role,
          asset.type,
        );
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (file) await addFile(file, role === "guide" ? undefined : role);
    };

  if (!supportsInputs) return null;
  if (isH3) {
    return (
      <H3MediaInputs
        inputs={inputs}
        onChange={onChange}
        reservedAliases={reservedAliases}
        useAudioTrack={useAudioTrack}
        onUseAudioTrackChange={onUseAudioTrackChange}
        resolveInputFileUrl={resolveInputFileUrl}
        syncInputFileToGallery={syncInputFileToGallery}
        onReferenceRequestReady={onReferenceRequestReady}
        freeReferencesDisabled={freeReferencesDisabled}
      />
    );
  }

  const frameSlot = (role: "start_image" | "end_image", label: string) => {
    const item = inputs.find((input) => input.role === role);
    const options =
      profile?.inputMedia.roles.filter(
        ({ role }) => role === "start_image" || role === "end_image",
      ) ?? [];
    return (
      <CroppableMediaInputSlot
        key={role}
        item={item}
        kind="image"
        label={role === "start_image" ? "Start" : "End"}
        badge={
          item
            ? role === "start_image"
              ? "Start Frame"
              : "End Frame"
            : undefined
        }
        title={`${label}${item ? " - Click for actions" : ""}`}
        sizeClassName="aspect-square w-full"
        active={activeId === role}
        removeLabel={label}
        onRemove={() => {
          if (!item) return;
          onChange(removeMediaInput(inputs, item.id));
          setActiveId(null);
        }}
        inputRef={imageInputRef}
        onAdd={() => {
          pendingFrameRoleRef.current = role;
        }}
        onToggle={() =>
          setActiveId((current) => (current === role ? null : role))
        }
        onDrop={dropFor(role, "image")}
        onCropChange={(crop) => {
          if (!item) return;
          onChange((current) =>
            current.map((input) =>
              input.id === item.id
                ? { ...input, crop: crop ?? undefined }
                : input,
            ),
          );
        }}
        menu={
          item ? (
            <MediaRoleMenu
              title={label}
              selectedRole={item.role}
              options={options}
              onSelect={(nextRole) => {
                onChange(
                  inputs.map((input) =>
                    input.id === item.id ? { ...input, role: nextRole } : input,
                  ),
                );
                setActiveId(null);
              }}
            />
          ) : null
        }
      />
    );
  };

  const guideKind = guide?.type === "audio" ? "audio" : "video";
  const guideOptions =
    guideKind === "audio"
      ? [...AUDIO_GUIDE_ROLE_OPTIONS]
      : [...VIDEO_GUIDE_ROLE_OPTIONS];
  const guideLabel = guideOptions.find(
    ({ role }) => role === guide?.role,
  )?.label;
  const guideExtra: ReactNode =
    guide?.type === "video" && guide.role !== "continue_video" ? (
      <>
        <div className="my-1 h-px bg-border" />
        <label className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-surface-hover">
          <span className="text-xs text-muted-foreground">Use Audio Track</span>
          <input
            type="checkbox"
            checked={useAudioTrack}
            onChange={(event) => onUseAudioTrackChange(event.target.checked)}
            className="h-3.5 w-3.5 rounded-sm border-border bg-input text-violet-500 focus:ring-violet-500"
          />
        </label>
        <div className="px-2 text-[9px] leading-tight text-subtle-foreground">
          {useAudioTrack
            ? "Generates video with soundtrack from the guide video."
            : "Generates soundtrack matching the video."}
        </div>
      </>
    ) : null;

  return (
    <GenPanelSection
      title={`References (${inputs.length}/3)`}
      collapsible={false}
    >
      {guide && editingGuideId === guide.id ? (
        <GuideMediaTrimEditor
          item={guide}
          onChange={(patch) =>
            onChange((current) =>
              current.map((input) =>
                input.id === guide.id ? { ...input, ...patch } : input,
              ),
            )
          }
          onConfirm={() => setEditingGuideId(null)}
        />
      ) : null}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {frameSlot("start_image", "Image 1 (Start)")}
          {frameSlot("end_image", "Image 2 (End)")}
        </div>
        <div className="flex gap-2">
          {styles.length && onOpenStyles ? (
            <button
              data-genspace-dropzone
              type="button"
              onClick={onOpenStyles}
              disabled={stylesDisabled}
              aria-haspopup="dialog"
              className={`flex aspect-square w-24 flex-col items-center justify-center rounded-lg border border-dashed text-2xs transition-colors disabled:opacity-40 ${
                selectedStyle
                  ? "border-violet-400/50 bg-violet-400/10 text-violet-200"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              <Palette className="mb-0.5 h-4 w-4" />
              <span className="max-w-10 truncate">
                {selectedStyle?.displayName ?? "Style"}
              </span>
            </button>
          ) : null}
          <ReferenceAddButton
            disabled={freeReferencesDisabled}
            dragActive={guideDragActive}
            onClick={() => guideInputRef.current?.click()}
            onDragEnter={() => setGuideDragActive(true)}
            onDragLeave={() => setGuideDragActive(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void dropFor("guide")(event)}
          />
        </div>
        {libraryMedia.length ? (
          <label className="block text-xs text-muted-foreground">
            From Reference Library{" "}
            {freeReferencesDisabled ? "(use @ mentions in Sequence mode)" : ""}
            <select
              aria-label="Add reference library media"
              disabled={freeReferencesDisabled}
              defaultValue=""
              onChange={(event) => {
                const entry = libraryMedia.find(
                  ({ id }) => id === event.currentTarget.value,
                );
                if (entry) {
                  setSlot(
                    entry.url,
                    entry.type === "audio" ? "audio_to_video" : "human_motion",
                    entry.type,
                  );
                }
                event.currentTarget.value = "";
              }}
              className="mt-1 w-full rounded bg-input px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">Choose saved media…</option>
              {libraryMedia.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.type})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {guide ? (
          <div className="relative flex flex-wrap gap-2 overflow-visible">
            <CroppableMediaInputSlot
              item={guide}
              kind={guideKind}
              label="Ref"
              badge={guideLabel ?? guide.role}
              title="Click or drop video/audio from gallery"
              active={activeId === "guide_slot"}
              removeLabel={
                guideKind === "audio" ? "audio input" : "video input"
              }
              sizeClassName="h-14 w-16"
              onRemove={() => {
                onChange(removeMediaInput(inputs, guide.id));
                setActiveId(null);
                setEditingGuideId(null);
              }}
              inputRef={guideInputRef}
              onToggle={() =>
                setActiveId((current) =>
                  current === "guide_slot" ? null : "guide_slot",
                )
              }
              onDrop={dropFor("guide")}
              onCropChange={(crop) => {
                onChange((current) =>
                  current.map((input) =>
                    input.id === guide.id
                      ? { ...input, crop: crop ?? undefined }
                      : input,
                  ),
                );
              }}
              menu={
                <MediaRoleMenu
                  title={
                    guideKind === "video"
                      ? "Video Guide Role"
                      : "Audio Track Role"
                  }
                  selectedRole={guide.role}
                  options={guideOptions}
                  onSelect={(role) => {
                    onChange(
                      inputs.map((input) =>
                        input.id === guide.id ? { ...input, role } : input,
                      ),
                    );
                    setActiveId(null);
                  }}
                  onTrim={() => {
                    setEditingGuideId(guide.id);
                    setActiveId(null);
                  }}
                  extra={guideExtra}
                />
              }
            />
          </div>
        ) : null}
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addFile(file, pendingFrameRoleRef.current);
          event.target.value = "";
        }}
      />
      <input
        ref={guideInputRef}
        type="file"
        accept="video/*,audio/*,.mp3,.wav,.ogg,.aac,.flac,.m4a"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addFile(file);
          event.target.value = "";
        }}
      />
    </GenPanelSection>
  );
}

const H3_REFERENCE_TYPES: Array<{
  type: GenSpaceMediaKind;
  role: string;
  limit: number;
  label: string;
}> = [
  { type: "image", role: "reference_image", limit: 9, label: "Image Ref" },
  { type: "video", role: "reference_video", limit: 3, label: "Video Ref" },
  { type: "audio", role: "reference_audio", limit: 3, label: "Audio Ref" },
];
const H3_REFERENCE_ROLE_FOR_TYPE: Record<GenSpaceMediaKind, string> = {
  image: "reference_image",
  video: "reference_video",
  audio: "reference_audio",
};

function H3MediaInputs({
  inputs,
  onChange,
  reservedAliases,
  useAudioTrack,
  onUseAudioTrackChange,
  resolveInputFileUrl,
  syncInputFileToGallery,
  onReferenceRequestReady,
  freeReferencesDisabled = false,
}: {
  inputs: GenSpaceMediaInput[];
  onChange: Dispatch<SetStateAction<GenSpaceMediaInput[]>>;
  reservedAliases: readonly string[];
  useAudioTrack: boolean;
  onUseAudioTrackChange: (value: boolean) => void;
  resolveInputFileUrl: (
    file: File,
    sync?: (file: File) => Promise<string | null>,
  ) => Promise<string | null>;
  syncInputFileToGallery?: (file: File) => Promise<string | null>;
  onReferenceRequestReady?: (
    request: (type: GenSpaceMediaKind) => void,
  ) => void;
  freeReferencesDisabled?: boolean;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const controlVideoInputRef = useRef<HTMLInputElement>(null);
  const [pendingRole, setPendingRole] = useState<string>("start_image");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = inputs.find((input) => input.id === editingId);
  const hasReferences = inputs.some(
    (input) =>
      H3_REFERENCE_TYPES.some((entry) => entry.role === input.role) ||
      input.role === "depth",
  );
  const referenceState = getH3ReferenceState(inputs);
  const controlVideo = inputs.find((input) => input.role === "control_video");
  const referenceAvailability = referenceState.availability;
  const renderedRoles = new Set([
    "start_image",
    "end_image",
    ...H3_REFERENCE_TYPES.map(({ role }) => role),
    "depth",
    "control_video",
  ]);
  const restoredInputs = inputs.filter(({ role }) => !renderedRoles.has(role));

  const add = useCallback(
    (url: string, type: GenSpaceMediaKind, role: string) => {
      const reference = H3_REFERENCE_TYPES.find((entry) => entry.role === role);
      const id = crypto.randomUUID();
      onChange((current) => {
        const currentHasReferences = current.some(
          (input) =>
            H3_REFERENCE_TYPES.some((entry) => entry.role === input.role) ||
            input.role === "depth",
        );
        if (
          (reference && !getH3ReferenceAvailability(current)[type]) ||
          (role === "control_video" && current.some((input) => input.role === "control_video")) ||
          (!reference && currentHasReferences)
        ) {
          return current;
        }
        const next: GenSpaceMediaInput = {
          id,
          url,
          type,
          role,
          ...(reference
            ? { alias: nextH3MediaAlias(current, reservedAliases, type) }
            : {}),
        };
        return role === "start_image" || role === "end_image"
          ? replaceInputForRole(current, next)
          : [...current, next];
      });
      if (reference && type === "video") setEditingId(id);
    },
    [onChange, reservedAliases],
  );

  const addFile = async (file: File, role: string) => {
    const type = detectMediaType(file.name, file.type);
    const reference = H3_REFERENCE_TYPES.find((entry) => entry.role === role);
    const expected = reference?.type ?? (role === "control_video" ? "video" : "image");
    if (!type || type !== expected) return;
    const url = await resolveInputFileUrl(file, syncInputFileToGallery);
    if (url) add(url, type, role);
  };

  const dropFor =
    (role: string, type: GenSpaceMediaKind) =>
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const asset = readGalleryAsset(event);
      if (asset?.type === type) {
        add(asset.url, type, role);
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (file) await addFile(file, role);
    };

  const update = (id: string, patch: Partial<GenSpaceMediaInput>) =>
    onChange((current) =>
      current.map((input) =>
        input.id === id ? { ...input, ...patch } : input,
      ),
    );

  const setVideoRole = (id: string, role: "reference_video" | "depth") =>
    onChange((current) =>
      current.map((input) => (input.id === id ? { ...input, role } : input)),
    );

  const setSoundtrack = (enabled: boolean) =>
    onChange((current) => {
      const state = getH3ReferenceState(current);
      if (enabled && state.audioCount - state.soundtrackCount > 0)
        return current;
      return current.map((input) =>
        input.type === "video" &&
        (input.role === "reference_video" || input.role === "depth")
          ? { ...input, useAudioTrack: enabled }
          : input,
      );
    });

  const openReferencePicker = useCallback(
    (type: GenSpaceMediaKind) => {
      if (freeReferencesDisabled || !referenceAvailability[type]) return;
      setPendingRole(H3_REFERENCE_ROLE_FOR_TYPE[type]);
      ({ image: imageInputRef, video: videoInputRef, audio: audioInputRef })[
        type
      ].current?.click();
    },
    [freeReferencesDisabled, referenceAvailability],
  );

  const addReferenceFile = async (file: File) => {
    const type = detectMediaType(file.name, file.type);
    if (!type || !referenceAvailability[type]) return;
    await addFile(file, H3_REFERENCE_ROLE_FOR_TYPE[type]);
  };

  useEffect(() => {
    onReferenceRequestReady?.(openReferencePicker);
    return () => onReferenceRequestReady?.(() => undefined);
  }, [onReferenceRequestReady, openReferencePicker]);

  const dropReference = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (
      freeReferencesDisabled ||
      (!referenceAvailability.image &&
        !referenceAvailability.video &&
        !referenceAvailability.audio)
    )
      return;
    const asset = readGalleryAsset(event);
    if (asset) {
      add(asset.url, asset.type, H3_REFERENCE_ROLE_FOR_TYPE[asset.type]);
      return;
    }
    const file = event.dataTransfer.files?.[0];
    const type = file && detectMediaType(file.name, file.type);
    if (file && type) await addFile(file, H3_REFERENCE_ROLE_FOR_TYPE[type]);
  };

  return (
    <GenPanelSection collapsible={false}>
      <div className="mb-2 flex items-center justify-between text-2xs font-medium uppercase tracking-wider text-subtle-foreground">
        <span>References</span>
        <span className="normal-case tracking-normal">
          <span title="Images">▧ {referenceState.imageCount}/9</span>{" "}
          <span title="Videos">▣ {referenceState.videoCount}/3</span>{" "}
          <span title="Audio">♫ {referenceState.audioCount}/3</span>{" "}
          <span title="Total files">◈ {referenceState.totalCount}/12</span>
        </span>
      </div>
      {editing ? (
        <GuideMediaTrimEditor
          item={editing}
          onChange={(patch) => update(editing.id, patch)}
          onConfirm={() => setEditingId(null)}
        />
      ) : null}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {(["start_image", "end_image"] as const).map((role) => {
            const item = inputs.find((input) => input.role === role);
            return (
              <CroppableMediaInputSlot
                key={role}
                item={item}
                kind="image"
                label={role === "start_image" ? "Start image" : "End image"}
                badge={
                  item
                    ? role === "start_image"
                      ? "Start Frame"
                      : "End Frame"
                    : undefined
                }
                title={
                  hasReferences && !item
                    ? "Remove references before adding a frame"
                    : "Click or drop an image"
                }
                disabled={!item && hasReferences}
                sizeClassName="aspect-square w-full"
                active={activeId === role}
                inputRef={imageInputRef}
                onAdd={() => setPendingRole(role)}
                onToggle={() =>
                  setActiveId((current) => (current === role ? null : role))
                }
                onRemove={() =>
                  item &&
                  onChange((current) => removeMediaInput(current, item.id))
                }
                removeLabel={
                  role === "start_image" ? "start image" : "end image"
                }
                onDrop={dropFor(role, "image")}
                onCropChange={(crop) =>
                  item && update(item.id, { crop: crop ?? undefined })
                }
                menu={
                  item ? (
                    <MediaRoleMenu
                      title="H3 Frame"
                      selectedRole={item.role}
                      options={[]}
                      onSelect={() => undefined}
                    />
                  ) : null
                }
              />
            );
          })}
        </div>
        <div className="flex gap-2">
          <CroppableMediaInputSlot
            item={controlVideo}
            kind="video"
            label="Control video"
            badge={controlVideo ? "Control Video" : undefined}
            title={
              hasReferences && !controlVideo
                ? "Remove reference media before adding a control video"
                : "Use a whole video to control generation"
            }
            disabled={!controlVideo && hasReferences}
            sizeClassName="h-14 w-16"
            active={activeId === "control_video"}
            inputRef={controlVideoInputRef}
            onAdd={() => setPendingRole("control_video")}
            onToggle={() =>
              setActiveId((current) =>
                current === "control_video" ? null : "control_video",
              )
            }
            onRemove={() =>
              controlVideo &&
              onChange((current) => removeMediaInput(current, controlVideo.id))
            }
            removeLabel="control video"
            onDrop={dropFor("control_video", "video")}
            onCropChange={(crop) =>
              controlVideo && update(controlVideo.id, { crop: crop ?? undefined })
            }
            menu={
              controlVideo ? (
                <MediaRoleMenu
                  title="Control Video"
                  selectedRole={controlVideo.role}
                  options={[]}
                  onSelect={() => undefined}
                  extra={
                    <div className="mt-1 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
                      <label className="flex items-center gap-2">
                        <span>Keep Source Audio</span>
                        <input
                          type="checkbox"
                          checked={useAudioTrack}
                          onChange={(event) =>
                            onUseAudioTrackChange(event.target.checked)
                          }
                        />
                      </label>
                      <p className="mt-1 text-2xs">Keeps this video's original audio in the generated output.</p>
                    </div>
                  }
                />
              ) : null
            }
          />
          <button
            data-genspace-dropzone
            type="button"
            disabled
            title="Styles are not available for MiniMax H3 yet"
            aria-label="Styles unavailable for MiniMax H3"
            className="flex aspect-square w-full flex-col items-center justify-center rounded-lg border border-dashed border-border text-2xs text-muted-foreground opacity-40"
          >
            <Palette className="mb-0.5 h-4 w-4" />
            <span className="max-w-10 truncate">Styles</span>
          </button>
          <ReferenceAddButton
            disabled={
              freeReferencesDisabled ||
              (!referenceAvailability.image &&
                !referenceAvailability.video &&
                !referenceAvailability.audio)
            }
            onClick={() => referenceInputRef.current?.click()}
            onDragOver={(event) => {
              if (
                referenceAvailability.image ||
                referenceAvailability.video ||
                referenceAvailability.audio
              ) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => void dropReference(event)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {H3_REFERENCE_TYPES.flatMap((entry) =>
            inputs
              .filter((input) => input.role === entry.role)
              .map((item) => ({ entry, item })),
          )
            .concat(
              inputs
                .filter((input) => input.role === "depth")
                .map((item) => ({ entry: H3_REFERENCE_TYPES[1], item })),
            )
            .map(({ entry, item }) => (
              <CroppableMediaInputSlot
                key={item.id}
                item={item}
                kind={entry.type}
                badge={item.alias}
                title={
                  referenceState.disabledVideoIds.has(item.id)
                    ? "Disabled while a depth reference is active"
                    : "Click for actions"
                }
                sizeClassName="h-14 w-16"
                disabled={referenceState.disabledVideoIds.has(item.id)}
                active={activeId === item.id}
                onToggle={() =>
                  setActiveId((current) =>
                    current === item.id ? null : item.id,
                  )
                }
                onRemove={() =>
                  onChange((current) => removeMediaInput(current, item.id))
                }
                removeLabel={item.alias ?? entry.label}
                onDrop={dropFor(entry.role, entry.type)}
                onCropChange={(crop) =>
                  update(item.id, { crop: crop ?? undefined })
                }
                menu={
                  <MediaRoleMenu
                    title={
                      entry.type === "video" ? "Video reference" : entry.label
                    }
                    selectedRole={item.role}
                    options={
                      entry.type === "video"
                        ? [
                            { role: "reference_video", label: "Reference" },
                            { role: "depth", label: "Depth" },
                          ]
                        : []
                    }
                    onSelect={(role) => {
                      if (role === "reference_video" || role === "depth")
                        setVideoRole(item.id, role);
                      setActiveId(null);
                    }}
                    onTrim={
                      item.role === "reference_video" && referenceState.videoCount === 1
                        ? () => {
                            setEditingId(item.id);
                            setActiveId(null);
                          }
                        : undefined
                    }
                    extra={
                      entry.type === "video" &&
                      !referenceState.disabledVideoIds.has(item.id) ? (
                        <div className="mt-1 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
                          {referenceState.videoCount > 1 ? <p>Excerpts require one H3 reference video.</p> : null}
                          <label className="flex items-center gap-2">
                            <span>Use Audio as Reference</span>
                            <input
                              type="checkbox"
                              checked={referenceState.soundtrackCount > 0}
                              onChange={(event) =>
                                setSoundtrack(event.target.checked)
                              }
                            />
                          </label>
                        </div>
                      ) : null
                    }
                  />
                }
              />
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {restoredInputs.map((item) => {
            const label = item.role.split("_").join(" ");
            return (
              <MediaInputSlot
                key={item.id}
                item={item}
                kind={item.type ?? "audio"}
                badge={label}
                title="Restored media input"
                ariaLabel={`Restored ${label}`}
                onRemove={() =>
                  onChange((current) => removeMediaInput(current, item.id))
                }
                removeLabel={label}
                onDrop={(event) => event.preventDefault()}
              />
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-2xs text-subtle-foreground">
        Control Video is whole-source only and can keep source audio. Reference
        video excerpts require one reference video and must be 2–15 seconds.
        Their matching audio guides generated audio; audio references use full clips.
      </p>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addFile(file, pendingRole);
          event.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addFile(file, pendingRole);
          event.target.value = "";
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.aac,.flac,.m4a"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addFile(file, pendingRole);
          event.target.value = "";
        }}
      />
      <input
        ref={controlVideoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addFile(file, "control_video");
          event.target.value = "";
        }}
      />
      <input
        ref={referenceInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.mp3,.wav,.ogg,.aac,.flac,.m4a"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addReferenceFile(file);
          event.target.value = "";
        }}
      />
    </GenPanelSection>
  );
}
