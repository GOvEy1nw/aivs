import type { ReferenceEntitySnapshot } from "../../shared/reference-library";

export interface VideoSequenceShot {
  id: string;
  durationSeconds: number | null;
  framing: string;
  cameraMotion: string;
  transition: string;
  description: string;
}

export interface VideoSequenceScene {
  id: string;
  location: string;
  /** Stable saved-location identity. Omitted for free text and older drafts. */
  locationEntityId?: string;
  timeOfDay: string;
  lighting: string;
  soundscape: string;
  score: string;
  shots: VideoSequenceShot[];
}

export interface VideoSequenceDraftV1 {
  schemaVersion: 1;
  scenes: VideoSequenceScene[];
}

/** Project-owned authoring draft. Older projects simply omit this field. */
export interface VideoComposerStateV1 {
  schemaVersion: 1;
  mode: "simple" | "sequence";
  sequence: VideoSequenceDraftV1;
  /** Immutable fallback retained when restoring a historical generation. */
  referencedEntities?: ReferenceEntitySnapshot[];
}

/** Immutable generation evidence used by Copy Settings and result persistence. */
export interface VideoComposerSubmissionV1 extends VideoComposerStateV1 {
  referencedEntities: ReferenceEntitySnapshot[];
  authoredBrief: string;
  compiledPrompt: string;
  resolvedDurationSeconds: number;
}
