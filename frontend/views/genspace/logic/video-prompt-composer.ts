import type {
  ReferenceEntity,
  ReferenceEntitySnapshot,
} from "../../../../shared/reference-library";
import type {
  VideoComposerStateV1,
  VideoSequenceDraftV1,
  VideoSequenceShot,
} from "../../../types/video-composer";

export type { VideoComposerStateV1 } from "../../../types/video-composer";

export interface PromptComposerPolicy {
  promptFormat: "plain" | "h3";
  entityMediaMode: "text-only" | "general-reference" | "inline-reference";
  voiceReference: boolean;
}

export interface CompiledEntityInput {
  id: string;
  url: string;
  path: string;
  role: string;
  type: "image" | "video" | "audio";
  alias?: string;
}

export interface CompileVideoPromptResult {
  ok: boolean;
  prompt?: string;
  durationSeconds?: number;
  approximate?: boolean;
  entityInputs: CompiledEntityInput[];
  snapshots: ReferenceEntitySnapshot[];
  warnings: string[];
  error?: string;
}

export const AUTO_SHOT_SECONDS = 5;
// ponytail: Auto resolves to 5s because the current request requires a number;
// move this into profile policy only when a verified model needs another value.

export function getReferenceEntityMediaAvailability(policy: PromptComposerPolicy) {
  return {
    allowVisualMedia: policy.entityMediaMode !== "text-only",
    allowVoiceMedia:
      policy.entityMediaMode === "inline-reference" && policy.voiceReference,
  };
}

export function createVideoSequenceDraft(): VideoSequenceDraftV1 {
  return {
    schemaVersion: 1,
    scenes: [{
      id: crypto.randomUUID(), location: "", timeOfDay: "", lighting: "", soundscape: "", score: "",
      shots: [{ id: crypto.randomUUID(), durationSeconds: null, framing: "", cameraMotion: "", transition: "", description: "" }],
    }],
  };
}

export function snapshotReferenceEntity(entity: ReferenceEntity): ReferenceEntitySnapshot {
  const media = (value: ReferenceEntity["visualReference"]) => value ? {
    type: value.type, path: value.path, url: value.url, fileName: value.fileName,
  } : undefined;
  return {
    id: entity.id, token: entity.token, kind: entity.kind, name: entity.name,
    visualDescription: entity.visualDescription,
    ...(entity.kind === "cast" ? { voiceDescription: entity.voiceDescription } : {}),
    fidelity: entity.fidelity,
    ...(media(entity.visualReference) ? { visualReference: media(entity.visualReference) } : {}),
    ...(entity.kind === "cast" && media(entity.voiceReference) ? { voiceReference: media(entity.voiceReference) } : {}),
  };
}

interface TokenReplacement {
  text: string;
  used: ReferenceEntity[];
  dialogue: ReferenceEntity[];
  visual: ReferenceEntity[];
  error?: string;
}

function replaceTokens(text: string, entities: readonly ReferenceEntity[], detailed: boolean, allowedAliases: ReadonlySet<string>): TokenReplacement {
  const byToken = new Map(entities.map((entity) => [entity.token.toLowerCase(), entity]));
  const unfinished = /@([a-z0-9_]+)_dialogue\s+["“][^"”]*$/i.exec(text);
  if (unfinished) {
    const entity = byToken.get(`@${unfinished[1]}`.toLowerCase());
    if (entity) return { text, used: [], dialogue: [], visual: [], error: `Dialogue for ${entity.name} needs a closing quote.` };
  }
  const used: ReferenceEntity[] = [];
  const dialogue: ReferenceEntity[] = [];
  const visual: ReferenceEntity[] = [];
  let error: string | undefined;
  const expanded = text.replace(/@([a-z0-9_]+?)(?:_dialogue\s+(["“])([^"”]*)(["”]))?(?=\s|$|[^a-z0-9_])/gi, (match, bare: string, opening?: string, words?: string, closing?: string) => {
    const dialogueToken = /_dialogue\s/i.test(match);
    const token = `@${bare}`.toLowerCase();
    if (!dialogueToken && allowedAliases.has(token)) return match;
    const entity = byToken.get(token);
    if (!entity) {
      error ??= `Unknown reference token: @${bare}`;
      return match;
    }
    if (dialogueToken && (!opening || !closing || (opening === '"' && closing !== '"') || (opening === "“" && closing !== "”"))) {
      error ??= `Dialogue for ${entity.name} needs a closing quote.`;
      return match;
    }
    if (!used.includes(entity)) used.push(entity);
    if (dialogueToken) {
      if (!dialogue.includes(entity)) dialogue.push(entity);
    } else if (!visual.includes(entity)) visual.push(entity);
    const description = detailed && !used.slice(0, -1).includes(entity) && entity.visualDescription ? `, ${entity.visualDescription}` : "";
    return dialogueToken ? `${entity.name}${description} says "${words}"` : `${entity.name}${description}`;
  });
  return { text: expanded, used, dialogue, visual, error };
}

function addUnique<T>(values: T[], additions: readonly T[]) {
  for (const value of additions) if (!values.includes(value)) values.push(value);
}

function validateShotDuration(shot: VideoSequenceShot): number | null {
  if (shot.durationSeconds === null) return AUTO_SHOT_SECONDS;
  return Number.isInteger(shot.durationSeconds) && shot.durationSeconds >= 1 && shot.durationSeconds <= 20
    ? shot.durationSeconds
    : null;
}

function sequenceProse(sequence: VideoSequenceDraftV1, entities: readonly ReferenceEntity[], allowedAliases: ReadonlySet<string>): TokenReplacement {
  const used: ReferenceEntity[] = [];
  const dialogue: ReferenceEntity[] = [];
  const visual: ReferenceEntity[] = [];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const lines = ["Target timing is approximate."];
  let error: string | undefined;
  let elapsed = 0;
  let shotNumber = 0;
  const resolve = (text: string) => {
    const result = replaceTokens(text, entities, true, allowedAliases);
    addUnique(used, result.used);
    addUnique(dialogue, result.dialogue);
    addUnique(visual, result.visual);
    error ??= result.error;
    return result.text;
  };
  sequence.scenes.forEach((scene, sceneIndex) => {
    const location = scene.locationEntityId ? byId.get(scene.locationEntityId) : undefined;
    if (scene.locationEntityId && location?.kind !== "location") error ??= "The saved location is unavailable. Reselect it or use free text.";
    if (location?.kind === "location") {
      addUnique(used, [location]);
      if (location.visualReference) addUnique(visual, [location]);
    }
    const context = [
      location?.kind === "location" ? location.name : resolve(scene.location),
      location?.kind === "location" && location.visualDescription,
      resolve(scene.timeOfDay),
      resolve(scene.lighting) && `${resolve(scene.lighting)} lighting`,
    ].filter(Boolean).join(", ");
    if (context) lines.push(`Scene ${sceneIndex + 1}: ${context}.`);
    scene.shots.forEach((shot) => {
      const duration = validateShotDuration(shot);
      if (duration === null) {
        error ??= "Shot duration must be a whole number between 1 and 20 seconds, or Auto.";
        return;
      }
      const details = [
        resolve(shot.framing) && `${resolve(shot.framing)} framing`,
        resolve(shot.cameraMotion) && `${resolve(shot.cameraMotion)} camera`,
        resolve(shot.description).trim(),
        resolve(shot.transition) && `${resolve(shot.transition)} transition`,
      ].filter(Boolean).join(", ");
      shotNumber += 1;
      const end = elapsed + duration;
      lines.push(`Shot ${shotNumber} — approximately ${elapsed}–${end} seconds${details ? `: ${details}.` : "."}`);
      elapsed = end;
    });
    const soundscape = resolve(scene.soundscape);
    const score = resolve(scene.score);
    if (soundscape) lines.push(`Ambience: ${soundscape}.`);
    if (score && score.toLowerCase() !== "none") lines.push(`Score: ${score}.`);
  });
  return { text: lines.join("\n"), used, dialogue, visual, error };
}

function snapshotEntity(value: ReferenceEntitySnapshot): ReferenceEntity {
  const media = (source: ReferenceEntitySnapshot["visualReference"]) => source && ({ ...source, relativePath: source.fileName });
  const base = { id: value.id, token: value.token, name: value.name, visualDescription: value.visualDescription, fidelity: value.fidelity, visualReference: media(value.visualReference), createdAt: 0, updatedAt: 0 };
  if (value.kind === "cast") return { ...base, kind: "cast", voiceDescription: value.voiceDescription ?? "", voiceReference: media(value.voiceReference) };
  if (value.kind === "other") return { ...base, kind: "other", otherType: "other" };
  return { ...base, kind: value.kind } as ReferenceEntity;
}

function audioDirectives(sequence: VideoSequenceDraftV1 | undefined) {
  const soundscapes = sequence?.scenes.map((scene) => scene.soundscape.trim()).filter(Boolean) ?? [];
  const scores = sequence?.scenes.map((scene) => scene.score.trim()).filter(Boolean) ?? [];
  const music = scores.filter((score) => score.toLowerCase() !== "none");
  return {
    soundscape: soundscapes.length ? [...new Set(soundscapes)].join("; ") : "N/A",
    music: music.length ? [...new Set(music)].join("; ") : scores.some((score) => score.toLowerCase() === "none") ? "None" : "N/A",
  };
}

export function compileVideoPrompt({ brief, composer, entities, policy, reservedAliases = [], fallbackSnapshots = [], retainedRoles = [] }: { brief: string; composer: VideoComposerStateV1; entities: readonly ReferenceEntity[]; policy: PromptComposerPolicy; reservedAliases?: readonly string[]; fallbackSnapshots?: readonly ReferenceEntitySnapshot[]; retainedRoles?: readonly string[]; }): CompileVideoPromptResult {
  const fallbackEntities = fallbackSnapshots.map(snapshotEntity);
  const resolvedEntities = [
    ...fallbackEntities,
    ...entities.filter((entity) => !fallbackEntities.some((fallback) => fallback.id === entity.id || fallback.token.toLowerCase() === entity.token.toLowerCase())),
  ];
  const allowedAliases = new Set(reservedAliases.map((alias) => alias.toLowerCase()));
  const global = replaceTokens(brief, resolvedEntities, true, allowedAliases);
  const sequence = composer.mode === "sequence" ? composer.sequence : undefined;
  const sequenceResult = sequence ? sequenceProse(sequence, resolvedEntities, allowedAliases) : undefined;
  const error = global.error ?? sequenceResult?.error;
  if (error) return { ok: false, entityInputs: [], snapshots: [], warnings: [], error };

  const shots = sequence?.scenes.flatMap((scene) => scene.shots) ?? [];
  const total = sequence ? shots.reduce((sum, shot) => sum + (validateShotDuration(shot) ?? 0), 0) : undefined;
  const approximate = !!sequence?.scenes.some((scene) => scene.shots.some((shot) => shot.durationSeconds === null));
  if (total !== undefined && (total < 2 || total > 20)) return { ok: false, entityInputs: [], snapshots: [], warnings: [], error: "Sequence duration must be between 2 and 20 seconds." };

  const prose = [global.text.trim(), sequenceResult?.text ?? ""].filter(Boolean).join("\n\n");
  const used = [...global.used];
  const visual = [...global.visual];
  const dialogue = [...global.dialogue];
  if (sequenceResult) {
    addUnique(used, sequenceResult.used);
    addUnique(visual, sequenceResult.visual);
    addUnique(dialogue, sequenceResult.dialogue);
  }
  const mediaBacked = visual.filter((entity) => entity.visualReference);
  const h3TaskInput = retainedRoles.some((role) => ["start_image", "end_image", "control_video", "audio_guide", "control_audio"].includes(role));
  const canSubmitEntityMedia = policy.promptFormat !== "h3" || !h3TaskInput;
  const visuals = mediaBacked.filter(() => policy.entityMediaMode !== "text-only" && canSubmitEntityMedia);
  const voices = dialogue.filter((entity): entity is Extract<ReferenceEntity, { kind: "cast" }> => entity.kind === "cast" && !!entity.voiceReference && policy.voiceReference && policy.entityMediaMode === "inline-reference" && canSubmitEntityMedia);
  if (voices.length) return { ok: false, entityInputs: [], snapshots: [], warnings: [], error: "Voice reference media is unavailable because this video profile has no verified speaker-to-audio binding." };
  if (policy.entityMediaMode === "general-reference" && visuals.length > 3) return { ok: false, entityInputs: [], snapshots: [], warnings: [], error: "The selected model supports up to three entity reference media items." };

  const warnings: string[] = [];
  if (h3TaskInput && mediaBacked.length) warnings.push("Entity media was omitted because the retained H3 task input uses the incompatible FL route.");
  const entityInputs: CompiledEntityInput[] = [];
  const aliases = new Map<string, string>();
  const occupied = new Set(allowedAliases);
  const nextAlias = (type: "image" | "video" | "audio") => {
    let index = 1;
    while (occupied.has(`@${type}${index}`)) index += 1;
    const alias = `@${type}${index}`;
    occupied.add(alias);
    return alias;
  };
  for (const entity of visuals) {
    const media = entity.visualReference!;
    const alias = nextAlias(media.type);
    aliases.set(entity.id, alias);
    entityInputs.push({ id: `reference-${entity.id}`, url: media.url, path: media.path, role: media.type === "image" ? "reference_image" : "reference_video", type: media.type, alias });
  }
  for (const entity of voices) {
    const media = entity.voiceReference!;
    entityInputs.push({ id: `reference-voice-${entity.id}`, url: media.url, path: media.path, role: "reference_audio", type: "audio", alias: nextAlias("audio") });
  }
  const referenceSnapshots = used.map(snapshotReferenceEntity);
  if (policy.entityMediaMode === "text-only" && mediaBacked.length) warnings.push("This model uses entity names and descriptions only; entity media was not submitted.");
  const audio = audioDirectives(sequence);
  if (policy.promptFormat !== "h3" || visuals.length === 0) return { ok: true, prompt: policy.promptFormat === "h3" ? `integrated_multimodal_description:\n${prose}\n\noverall_soundscape:\n${audio.soundscape}\n\nnon_diegetic_music:\n${audio.music}` : prose, durationSeconds: total, approximate, entityInputs, snapshots: referenceSnapshots, warnings };
  const subjectLines = visuals.filter((entity) => aliases.has(entity.id)).map((entity, index) => `<Subject ${index + 1}> is ${entity.name}${entity.visualDescription ? `, ${entity.visualDescription}` : ""}, from ${aliases.get(entity.id)}.`);
  return { ok: true, prompt: `subject_definitions:\n${subjectLines.join("\n")}\n\nsummary:\n[reference generation] ${prose}\n\nretention_analysis:\n${visuals.map((entity, index) => `<Subject ${index + 1}>: ${entity.fidelity === "exact" ? "fully_preserved" : "adapted_reference"} - ${entity.name}`).join("\n")}\n\nDetailed_description:\n${prose}\n\noverall_soundscape:\n${audio.soundscape}\n\nnon_diegetic_music:\n${audio.music}` , durationSeconds: total, approximate, entityInputs, snapshots: referenceSnapshots, warnings };
}
