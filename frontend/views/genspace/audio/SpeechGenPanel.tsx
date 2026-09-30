import { AudioLines, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { fileUrlToPath } from "../../../lib/url-to-path";
import type { ModelProfile } from "../../../types/model-profiles";
import type { SpeechReferenceAudio, SpeechSegment } from "../../../types/speech";
import { GenPanelSection } from "../components/GenPanelSection";
import { GenerateButton } from "../components/GenerateButton";
import { MediaInputSlot } from "../components/MediaInputSlot";
import { MediaRoleMenu } from "../components/MediaRoleMenu";
import { PromptActions } from "../components/PromptActions";
import { PromptEditor } from "../components/PromptEditor";
import { GuideMediaTrimEditor } from "../video/GuideMediaTrimEditor";
import type { GenSpaceMediaInput, SpeechGenPanelController } from "../types";

const MAX_SPEECH_TEXT_LENGTH = 4096;

export function SpeechGenPanel({
  controller,
  selectedProfile,
}: {
  controller: SpeechGenPanelController;
  selectedProfile: ModelProfile | undefined;
}) {
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const [dragActive, setDragActive] = useState<number | null>(null);
  const [activeReference, setActiveReference] = useState<number | null>(null);
  const [editingReference, setEditingReference] = useState<number | null>(null);
  const referenceRequired = selectedProfile?.speech.referenceRequired ?? false;
  const maxReferences = Math.min(selectedProfile?.speech.maxReferenceInputs ?? 0, 3);
  const references = controller.settings.references;
  const dialogue = references.length >= 2;
  const dialogueText = controller.settings.segments
    .filter(({ text }) => text.trim())
    .map(({ speaker, text }) => `Speaker ${speaker}: ${text.trim()}`)
    .join("\n");
  const hasAllSpeakers = Array.from({ length: references.length }, (_, index) => index + 1).every((speaker) =>
    controller.settings.segments.some(
      (segment) => segment.speaker === speaker && segment.text.trim(),
    ),
  );
  const canSubmit =
    Boolean(selectedProfile) &&
    (dialogue
      ? hasAllSpeakers && dialogueText.length <= MAX_SPEECH_TEXT_LENGTH
      : Boolean(controller.prompt.value.trim()) &&
        (!referenceRequired || references.length > 0));

  const setReferences = (next: SpeechReferenceAudio[]) =>
    controller.setSettings({ ...controller.settings, references: next });

  const addReference = (reference: SpeechReferenceAudio) => {
    const next = [...references, reference];
    controller.setSettings({
      ...controller.settings,
      references: next,
      segments:
        next.length === 2 && !controller.settings.segments.length
          ? [
              { speaker: 1, text: controller.prompt.value },
              { speaker: 2, text: "" },
            ]
          : next.length === 3 && !controller.settings.segments.some(({ speaker }) => speaker === 3)
            ? [...controller.settings.segments, { speaker: 3, text: "" }]
            : controller.settings.segments,
    });
  };

  const replaceOrAddReference = (
    index: number,
    reference: SpeechReferenceAudio,
  ) => {
    if (index < references.length) {
      setReferences(
        references.map((current, currentIndex) =>
          currentIndex === index ? reference : current,
        ),
      );
    } else {
      addReference(reference);
    }
  };

  const importFile = async (file: File | undefined, index: number) => {
    if (
      !file ||
      (!file.type.startsWith("audio/") &&
        !file.name.match(/\.(wav|mp3|flac|ogg|m4a|aac)$/i))
    ) {
      return;
    }
    const asset = await controller.media.syncInputFileToGalleryAsset(file);
    if (!asset) return;
    replaceOrAddReference(index, {
      assetId: asset.id,
      path: asset.path,
      url: asset.url,
    });
  };

  const drop = (index: number, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(null);
    const raw = event.dataTransfer.getData("asset");
    if (raw) {
      try {
        const asset = JSON.parse(raw) as {
          id?: string;
          type?: string;
          url?: string;
          path?: string;
        };
        const path =
          asset.path ?? (asset.url ? fileUrlToPath(asset.url) : null);
        if (asset.type === "audio" && asset.url && path) {
          replaceOrAddReference(index, {
            assetId: asset.id,
            path,
            url: asset.url,
          });
          return;
        }
      } catch {
        // Fall through to an OS file drop.
      }
    }
    void importFile(event.dataTransfer.files?.[0], index);
  };

  const removeReference = (index: number) => {
    setActiveReference(null);
    setEditingReference(null);
    const next = references.filter((_, currentIndex) => currentIndex !== index);
    controller.setSettings({
      ...controller.settings,
      references: next,
      segments:
        next.length < 2
          ? []
          : controller.settings.segments
              .filter(({ speaker }) => speaker !== index + 1)
              .map((segment) =>
                segment.speaker > index + 1
                  ? { ...segment, speaker: (segment.speaker - 1) as SpeechSegment["speaker"] }
                  : segment,
              ),
    });
  };

  const updateReference = (
    index: number,
    patch: Partial<SpeechReferenceAudio>,
  ) => {
    const reference = references[index];
    if (
      !reference ||
      Object.entries(patch).every(
        ([key, value]) =>
          reference[key as keyof SpeechReferenceAudio] === value,
      )
    ) {
      return;
    }
    setReferences(
      references.map((reference, currentIndex) =>
        currentIndex === index ? { ...reference, ...patch } : reference,
      ),
    );
  };

  const updateSegment = (
    index: number,
    patch: Partial<SpeechSegment>,
  ) =>
    controller.setSettings({
      ...controller.settings,
      segments: controller.settings.segments.map((segment, currentIndex) =>
        currentIndex === index ? { ...segment, ...patch } : segment,
      ),
    });

  const promptActions = (
    <PromptActions
      seedLocked={controller.settings.seed !== null}
      lockedSeed={controller.settings.seed ?? controller.prompt.lockedSeed}
      onSeedChange={(seed) => {
        controller.prompt.setSeed(seed);
        controller.setSettings({
          ...controller.settings,
          seed: seed.seedLocked ? seed.lockedSeed : null,
        });
      }}
      disabled={controller.isRunning}
      prompt={dialogue ? dialogueText : controller.prompt.value}
      onEnhance={controller.prompt.enhance}
      isEnhancing={controller.prompt.isEnhancing}
      enhanceEnabled={controller.prompt.enhanceEnabled}
    />
  );

  const editingItem =
    editingReference === null ? undefined : references[editingReference];

  return (
    <>
      <GenPanelSection title={`References (${references.length}/${maxReferences})`} collapsible={false}>
        {editingItem ? (
          <GuideMediaTrimEditor
            item={{
              id: editingItem.assetId ?? editingItem.path,
              url: editingItem.url,
              path: editingItem.path,
              role: "reference_voice",
              type: "audio",
              trimStartTime: editingItem.trimStartTime,
              trimDuration: editingItem.trimDuration,
              mediaDuration: editingItem.mediaDuration,
            }}
            onChange={(patch) => updateReference(editingReference!, patch)}
            onConfirm={() => setEditingReference(null)}
          />
        ) : null}
        <div className="flex items-center gap-2">
          {references.map((reference, index) => {
            const item: GenSpaceMediaInput = {
              id: reference.assetId ?? reference.path,
              url: reference.url,
              path: reference.path,
              role: "reference_voice",
              type: "audio",
              trimStartTime: reference.trimStartTime,
              trimDuration: reference.trimDuration,
              mediaDuration: reference.mediaDuration,
            };
            return (
              <div
                key={reference.assetId ?? reference.path}
                className="relative"
                onDragEnter={() => setDragActive(index)}
                onDragLeave={() => setDragActive(null)}
              >
                <MediaInputSlot
                  item={item}
                  kind="audio"
                  label={`Speaker ${index + 1}`}
                  badge={`Voice ${index + 1}`}
                  title="Replace voice reference"
                  ariaLabel={`Edit voice reference ${index + 1}`}
                  active={activeReference === index}
                  dragActive={dragActive === index}
                  inputRef={inputRefs[index]}
                  onToggle={() =>
                    setActiveReference((current) =>
                      current === index ? null : index,
                    )
                  }
                  menu={
                    <MediaRoleMenu
                      title={`Speaker ${index + 1} voice`}
                      options={[]}
                      selectedRole="reference_voice"
                      onSelect={() => undefined}
                      onTrim={() => {
                        setEditingReference(index);
                        setActiveReference(null);
                      }}
                    />
                  }
                  onRemove={() => removeReference(index)}
                  removeLabel={`voice reference ${index + 1}`}
                  onDrop={(event) => drop(index, event)}
                />
              </div>
            );
          })}
          {references.length < maxReferences ? (
            <div
              className="relative"
              onDragEnter={() => setDragActive(references.length)}
              onDragLeave={() => setDragActive(null)}
            >
              <MediaInputSlot
                kind="audio"
                label={
                  references.length
                    ? `Speaker ${references.length + 1}`
                    : referenceRequired
                      ? "Required"
                      : "Optional"
                }
                title={
                  references.length
                    ? `Add voice reference ${references.length + 1}`
                    : "Add voice reference"
                }
                ariaLabel={
                  references.length
                    ? `Add voice reference ${references.length + 1}`
                    : "Add voice reference"
                }
                dragActive={dragActive === references.length}
                inputRef={inputRefs[references.length]}
                onDrop={(event) => drop(references.length, event)}
              />
            </div>
          ) : null}
        </div>
        {inputRefs.map((ref, index) => (
          <input
            key={index}
            ref={ref}
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac"
            className="hidden"
            onChange={(event) => {
              void importFile(event.target.files?.[0], index);
              event.target.value = "";
            }}
          />
        ))}
      </GenPanelSection>

      {dialogue ? (
        <GenPanelSection title="Dialogue" collapsible>
          <div className="space-y-2 px-4 pb-3">
            {controller.settings.segments.map((segment, index) => (
              <div key={index} className="flex items-start gap-2">
                <select
                  aria-label={`Segment ${index + 1} speaker`}
                  value={segment.speaker}
                  disabled={controller.isRunning}
                  onChange={(event) =>
                    updateSegment(index, {
                      speaker: Number(event.target.value) as SpeechSegment["speaker"],
                    })
                  }
                  className="h-9 rounded-full border border-border bg-input px-3 text-xs text-foreground"
                >
                  <option value={1}>Speaker 1</option>
                  <option value={2}>Speaker 2</option>
                  {references.length === 3 ? <option value={3}>Speaker 3</option> : null}
                </select>
                <textarea
                  aria-label={`Segment ${index + 1} text`}
                  value={segment.text}
                  disabled={controller.isRunning}
                  maxLength={MAX_SPEECH_TEXT_LENGTH}
                  onChange={(event) =>
                    updateSegment(index, { text: event.target.value })
                  }
                  className="min-h-14 flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm leading-5 text-foreground placeholder:text-subtle-foreground focus:outline-hidden"
                  placeholder="What this speaker says"
                />
                {controller.settings.segments.length > 2 ? (
                  <button
                    type="button"
                    aria-label={`Remove segment ${index + 1}`}
                    disabled={controller.isRunning}
                    onClick={() =>
                      controller.setSettings({
                        ...controller.settings,
                        segments: controller.settings.segments.filter(
                          (_, currentIndex) => currentIndex !== index,
                        ),
                      })
                    }
                    className="mt-2 text-subtle-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2">
              <button
                type="button"
                disabled={controller.isRunning}
                className="inline-flex items-center gap-1 rounded-full bg-surface-selected px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover disabled:opacity-40"
                onClick={() => {
                  const last =
                    controller.settings.segments[
                      controller.settings.segments.length - 1
                      ]?.speaker ?? Math.min(references.length, 2) as SpeechSegment["speaker"];
                  controller.setSettings({
                    ...controller.settings,
                    segments: [
                      ...controller.settings.segments,
                      { speaker: (last % references.length + 1) as SpeechSegment["speaker"], text: "" },
                    ],
                  });
                }}
              >
                <Plus className="h-3 w-3" /> Add Speaker Segment
              </button>
              {promptActions}
            </div>
          </div>
        </GenPanelSection>
      ) : (
        <PromptEditor
          title="Speech text"
          height="h-28"
          value={controller.prompt.value}
          onChange={(value) => {
            controller.prompt.setValue(value.slice(0, MAX_SPEECH_TEXT_LENGTH));
            if (controller.settings.segments.length) {
              controller.setSettings({
                ...controller.settings,
                segments: [],
              });
            }
          }}
          onSubmit={controller.submit}
          canSubmit={canSubmit}
          disabled={controller.isRunning}
          placeholder="Write the words to speak"
          maxLength={MAX_SPEECH_TEXT_LENGTH}
          actions={promptActions}
        />
      )}

      <div className="flex items-center gap-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <GenerateButton
          onClick={controller.submit}
          disabled={!canSubmit}
          loading={controller.isRunning}
          label="Generate"
          icon={<AudioLines className="h-4 w-4" />}
        />
      </div>
    </>
  );
}
