import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  Plus,
  ToggleLeft,
  Trash2,
} from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { SettingsDropdown } from "../../../components/SettingsDropdown";
import { useReferenceLibrary } from "../../../contexts/ReferenceLibraryContext";
import type {
  VideoComposerStateV1,
  VideoSequenceScene,
  VideoSequenceShot,
} from "../../../types/video-composer";
import type { ReferenceEntity } from "../../../../shared/reference-library";
import {
  PresetPromptPicker,
  type PresetPromptGroup,
} from "../components/PresetPromptPicker";
import { ReferenceMentionTextarea } from "../components/ReferenceMentionTextarea";

const sceneFields: Array<
  keyof Pick<
    VideoSequenceScene,
    "location" | "timeOfDay" | "lighting" | "soundscape" | "score"
  >
> = ["location", "timeOfDay", "lighting", "soundscape", "score"];
const shotFields: Array<
  keyof Pick<VideoSequenceShot, "framing" | "cameraMotion" | "transition">
> = ["framing", "cameraMotion", "transition"];
const scenePresetGroups: Record<
  Exclude<(typeof sceneFields)[number], "location">,
  readonly PresetPromptGroup[]
> = {
  timeOfDay: [
    {
      label: "Time",
      options: [
        "Sunrise",
        "Dawn",
        "Morning",
        "Noon",
        "Afternoon",
        "Golden Hour",
        "Dusk",
        "Evening",
        "Night",
      ],
    },
  ],
  lighting: [
    {
      label: "Lighting",
      options: [
        "Soft",
        "Hard",
        "High Key",
        "Low Key",
        "Natural",
        "Overcast",
        "Neon",
        "Backlit",
      ],
    },
  ],
  soundscape: [
    {
      label: "Soundscape",
      options: [
        "Room Tone",
        "City Ambience",
        "Rain",
        "Wind",
        "Crowd",
        "Traffic",
        "Nature",
        "Silence",
      ],
    },
  ],
  score: [
    {
      label: "Score",
      options: [
        "None",
        "Ambient",
        "Tense",
        "Emotional",
        "Playful",
        "Cinematic",
      ],
    },
  ],
};
const shotPresetGroups: Record<
  (typeof shotFields)[number],
  readonly PresetPromptGroup[]
> = {
  framing: [
    {
      label: "Framing",
      options: [
        "Extreme Wide",
        "Wide",
        "Full",
        "Medium",
        "Medium Close-Up",
        "Close-Up",
        "Extreme Close-Up",
        "POV",
        "Over-the-Shoulder",
      ],
    },
  ],
  cameraMotion: [
    {
      label: "Camera Motion",
      options: [
        "Static",
        "Pan",
        "Tilt",
        "Track",
        "Dolly In",
        "Dolly Out",
        "Push In",
        "Pull Out",
        "Orbit",
        "Handheld",
        "Crane",
      ],
    },
  ],
  transition: [
    {
      label: "Transition",
      options: [
        "Cut",
        "Match Cut",
        "Dissolve",
        "Fade In",
        "Fade Out",
        "Whip Pan",
      ],
    },
  ],
};
const locationPresets = ["Interior", "Exterior", "City Street", "Forest"];
type Composer = {
  value: VideoComposerStateV1;
  updateScene: (id: string, patch: Partial<VideoSequenceScene>) => void;
  updateShot: (
    sceneId: string,
    shotId: string,
    patch: Partial<VideoSequenceShot>,
  ) => void;
  selectLocation: (
    sceneId: string,
    location: Extract<ReferenceEntity, { kind: "location" }>,
  ) => void;
  addScene: () => void;
  addShot: (sceneId: string) => void;
  removeScene: (id: string) => void;
  removeShot: (sceneId: string, shotId: string) => void;
  moveScene: (id: string, offset: number) => void;
  moveShot: (sceneId: string, shotId: string, offset: number) => void;
};
type Dragged = { sceneId: string; shotId?: string };

function fieldLabel(field: string) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function resolvedDuration(shots: readonly VideoSequenceShot[]) {
  return shots.reduce((sum, shot) => sum + (shot.durationSeconds ?? 5), 0);
}

function hasAutoDuration(shots: readonly VideoSequenceShot[]) {
  return shots.some((shot) => shot.durationSeconds === null);
}

function ShotDurationPicker({
  shot,
  onChange,
}: {
  shot: VideoSequenceShot;
  onChange: (durationSeconds: number | null) => void;
}) {
  const value =
    shot.durationSeconds === null ? "auto" : String(shot.durationSeconds);
  const sliderValue =
    shot.durationSeconds === null ? 0 : shot.durationSeconds - 1;
  return (
    <SettingsDropdown
      title="Shot duration"
      placement="bottom"
      triggerLabel="Shot duration"
      trigger={
        <>
          <Clock className="h-3.5 w-3.5" />
          {shot.durationSeconds === null
            ? "Auto (~5s)"
            : `${shot.durationSeconds}s`}
        </>
      }
      options={[]}
      value={value}
      onChange={() => undefined}
      content={
        <div className="w-52 space-y-2 px-1 py-1 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Auto</span>
            <span>
              {shot.durationSeconds === null
                ? "~5s"
                : `${shot.durationSeconds}s`}
            </span>
            <span>20s</span>
          </div>
          <input
            aria-label="Shot duration range"
            type="range"
            min="0"
            max="19"
            step="1"
            value={sliderValue}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange(next === 0 ? null : next + 1);
            }}
            className="w-full"
          />
          <p className="text-2xs text-muted-foreground">
            Auto resolves to approximately 5 seconds.
          </p>
        </div>
      }
    />
  );
}

export function SequenceComposer({
  composer,
  allowVisualMedia = true,
  allowVoiceMedia = true,
}: {
  composer: Composer;
  allowVisualMedia?: boolean;
  allowVoiceMedia?: boolean;
}) {
  const { entities } = useReferenceLibrary();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [reorderMode, setReorderMode] = useState(false);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const savedLocations = entities.filter(
    (entity): entity is Extract<ReferenceEntity, { kind: "location" }> =>
      entity.kind === "location",
  );
  const locationGroups: readonly PresetPromptGroup[] = [
    { label: "Locations", options: locationPresets },
  ];
  const shots = composer.value.sequence.scenes.flatMap((scene) => scene.shots);
  const total = resolvedDuration(shots);
  const approximate = hasAutoDuration(shots);
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const beginDrag = (event: DragEvent, item: Dragged) => {
    if (!reorderMode) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      item.shotId ? `shot:${item.shotId}` : `scene:${item.sceneId}`,
    );
    setDragged(item);
  };
  const finishScene = (sceneId: string) => {
    if (!dragged || dragged.shotId || dragged.sceneId === sceneId) {
      setDragged(null);
      return;
    }
    const from = composer.value.sequence.scenes.findIndex(
      (scene) => scene.id === dragged.sceneId,
    );
    const to = composer.value.sequence.scenes.findIndex(
      (scene) => scene.id === sceneId,
    );
    composer.moveScene(dragged.sceneId, to - from);
    setDragged(null);
  };
  const finishShot = (sceneId: string, shotId: string) => {
    if (
      !dragged?.shotId ||
      dragged.sceneId !== sceneId ||
      dragged.shotId === shotId
    ) {
      setDragged(null);
      return;
    }
    const scene = composer.value.sequence.scenes.find(
      (item) => item.id === sceneId,
    );
    const from =
      scene?.shots.findIndex((shot) => shot.id === dragged.shotId) ?? -1;
    const to = scene?.shots.findIndex((shot) => shot.id === shotId) ?? -1;
    if (from >= 0 && to >= 0)
      composer.moveShot(sceneId, dragged.shotId, to - from);
    setDragged(null);
  };
  const moveOnArrow = (
    event: KeyboardEvent<HTMLButtonElement>,
    move: (offset: number) => void,
    canMoveUp: boolean,
    canMoveDown: boolean,
  ) => {
    if (!reorderMode) return;
    if (event.key === "ArrowUp" && canMoveUp) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowDown" && canMoveDown) {
      event.preventDefault();
      move(1);
    }
  };
  return (
    <section className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Sequence{" "}
          <span className="text-muted-foreground">
            {approximate ? "~" : ""}
            {total}s total
          </span>
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            aria-pressed={reorderMode}
            aria-label={
              reorderMode ? "Finish reordering sequence" : "Reorder sequence"
            }
            title={reorderMode ? "Done reordering" : "Reorder"}
            onClick={() => setReorderMode((value) => !value)}
            className={`text-xs ${reorderMode ? "text-primary" : "text-muted-foreground"}`}
          >
            {reorderMode ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <ToggleLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </span>
      </div>
      {reorderMode ? (
        <p className="text-2xs text-muted-foreground">
          Drag handles to reorder. Focus a handle and press Arrow Up or Arrow
          Down to reorder by keyboard.
        </p>
      ) : null}
      {composer.value.sequence.scenes.map((scene, sceneIndex) => (
        <div
          key={scene.id}
          onDragOver={(event) => {
            if (reorderMode) event.preventDefault();
          }}
          onDrop={() => finishScene(scene.id)}
          className="space-y-2 rounded border border-border p-3"
        >
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-1">
              <button
                type="button"
                draggable={reorderMode}
                aria-label={`Reorder scene ${sceneIndex + 1}`}
                onDragStart={(event) => beginDrag(event, { sceneId: scene.id })}
                onKeyDown={(event) =>
                  moveOnArrow(
                    event,
                    (offset) => composer.moveScene(scene.id, offset),
                    sceneIndex > 0,
                    sceneIndex < composer.value.sequence.scenes.length - 1,
                  )
                }
                className={`touch-none ${reorderMode ? "cursor-grab" : "cursor-default opacity-40"}`}
              >
                <GripVertical className="h-3.5 w-3.5 text-subtle-foreground" />
              </button>
              <button
                type="button"
                onClick={() => toggle(scene.id)}
                className="flex items-center gap-1"
              >
                {collapsed.has(scene.id) ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Scene {sceneIndex + 1}{" "}
                <span className="text-muted-foreground">
                  {hasAutoDuration(scene.shots) ? "~" : ""}
                  {resolvedDuration(scene.shots)}s
                </span>
              </button>
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                aria-label="Delete scene"
                onClick={() => composer.removeScene(scene.id)}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs bg-surface-raised text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          {!collapsed.has(scene.id) ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {sceneFields.map((field) => (
                  <div
                    key={field}
                    className="flex min-w-0 gap-1 items-center min-w-0 rounded bg-input text-xs px-2"
                  >
                    <input
                      aria-label={fieldLabel(field)}
                      placeholder={fieldLabel(field)}
                      value={scene[field]}
                      onChange={(event) =>
                        composer.updateScene(scene.id, field === "location"
                          ? { location: event.target.value, locationEntityId: undefined }
                          : { [field]: event.target.value })
                      }
                      className="min-w-0 flex-1 rounded bg-input px-2 py-1.5 text-xs focus:outline-hidden"
                    />
                      <PresetPromptPicker
                      label={fieldLabel(field)}
                      groups={
                        field === "location"
                          ? locationGroups
                          : scenePresetGroups[field]
                      }
                      value={scene[field]}
                      onChange={(value) =>
                        composer.updateScene(scene.id, field === "location"
                          ? { location: value, locationEntityId: undefined }
                          : { [field]: value })
                      }
                    />
                    {field === "location" && savedLocations.length > 0 ? (
                      <SettingsDropdown
                        title="Saved locations"
                        placement="bottom"
                        triggerLabel="Saved location"
                        trigger="Saved"
                        options={savedLocations.map((location) => ({
                          value: location.id,
                          label: location.name,
                        }))}
                        value={scene.locationEntityId ?? ""}
                        onChange={(locationId) => {
                          const location = savedLocations.find(
                            (item) => item.id === locationId,
                          );
                          if (location) composer.selectLocation(scene.id, location);
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              {scene.shots.map((shot, shotIndex) => (
                <div
                  key={shot.id}
                  onDragOver={(event) => {
                    if (reorderMode) event.preventDefault();
                  }}
                  onDrop={() => finishShot(scene.id, shot.id)}
                  className="space-y-2 rounded bg-surface p-2"
                >
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center">
                      <button
                        type="button"
                        draggable={reorderMode}
                        aria-label={`Reorder shot ${shotIndex + 1}`}
                        onDragStart={(event) =>
                          beginDrag(event, {
                            sceneId: scene.id,
                            shotId: shot.id,
                          })
                        }
                        onKeyDown={(event) =>
                          moveOnArrow(
                            event,
                            (offset) =>
                              composer.moveShot(scene.id, shot.id, offset),
                            shotIndex > 0,
                            shotIndex < scene.shots.length - 1,
                          )
                        }
                        className={`touch-none ${reorderMode ? "cursor-grab" : "cursor-default opacity-40"}`}
                      >
                        <GripVertical className="mr-1 h-3.5 w-3.5 text-subtle-foreground" />
                      </button>
                      Shot {shotIndex + 1}
                    </span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Delete shot"
                        onClick={() => composer.removeShot(scene.id, shot.id)}
                        className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs bg-surface-raised text-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {shotFields.map((field) => (
                      <div key={field} className="flex min-w-0 gap-1">
                        <input
                          aria-label={fieldLabel(field)}
                          placeholder={fieldLabel(field)}
                          value={shot[field]}
                          onChange={(event) =>
                            composer.updateShot(scene.id, shot.id, {
                              [field]: event.target.value,
                            })
                          }
                          className="min-w-0 flex-1 rounded bg-input px-2 py-1.5 text-xs"
                        />
                        <PresetPromptPicker
                          label={fieldLabel(field)}
                          groups={shotPresetGroups[field]}
                          value={shot[field]}
                          onChange={(value) =>
                            composer.updateShot(scene.id, shot.id, {
                              [field]: value,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <ShotDurationPicker
                    shot={shot}
                    onChange={(durationSeconds) =>
                      composer.updateShot(scene.id, shot.id, {
                        durationSeconds,
                      })
                    }
                  />
                  <ReferenceMentionTextarea
                    context="shot"
                    value={shot.description}
                    onChange={(description) =>
                      composer.updateShot(scene.id, shot.id, { description })
                    }
                    placeholder='Description, @cast, @cast_dialogue "line", or sound beat'
                    allowVisualMedia={allowVisualMedia}
                    allowVoiceMedia={allowVoiceMedia}
                    className="min-h-16 w-full rounded bg-input px-2 py-1.5 text-xs"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => composer.addShot(scene.id)}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium bg-[var(--genspace-mode-accent)] text-foreground hover:bg-[var(--genspace-mode-accent-hover)] hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Shot
              </button>
            </>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={composer.addScene}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium bg-[var(--genspace-mode-accent)] text-foreground hover:bg-[var(--genspace-mode-accent-hover)] hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Scene
      </button>
    </section>
  );
}
