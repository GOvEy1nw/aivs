import { describe, expect, it } from "vitest";
import type { ReferenceEntity } from "../../../../shared/reference-library";
import { compileVideoPrompt, createVideoSequenceDraft, getReferenceEntityMediaAvailability } from "./video-prompt-composer";

const beth: ReferenceEntity = { id: "beth", kind: "cast", name: "Beth", token: "@beth", visualDescription: "a blonde woman", voiceDescription: "warm voice", fidelity: "exact", createdAt: 1, updatedAt: 1, visualReference: { type: "image", relativePath: "media/beth.png", path: "C:/library/beth.png", url: "file:///C:/library/beth.png", fileName: "beth.png" }, voiceReference: { type: "audio", relativePath: "media/beth.mp3", path: "C:/library/beth.mp3", url: "file:///C:/library/beth.mp3", fileName: "beth.mp3" } };
const studio: ReferenceEntity = { id: "studio", kind: "location", name: "Studio", token: "@studio", visualDescription: "a warm brick studio", fidelity: "exact", createdAt: 1, updatedAt: 1, visualReference: { type: "image", relativePath: "media/studio.png", path: "C:/library/studio.png", url: "file:///C:/library/studio.png", fileName: "studio.png" } };

describe("compileVideoPrompt", () => {
  it("compiles deterministic prose, H3 media, retention, dialogue, and Auto duration", () => {
    const sequence = createVideoSequenceDraft();
    sequence.scenes[0].shots[0].description = "@beth enters the room.";
    const h3 = compileVideoPrompt({ brief: "A meeting with @beth", composer: { schemaVersion: 1, mode: "sequence", sequence }, entities: [beth], policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true } });
    expect(h3).toMatchObject({ ok: true, durationSeconds: 5, approximate: true });
    expect(h3.prompt).toContain("subject_definitions:");
    expect(h3.prompt).toContain("fully_preserved");
    expect(h3.entityInputs.map((item) => item.alias)).toEqual(["@image1"]);
  });

  it("keeps plain text media-free, rejects invalid totals and quotes, and expands names", () => {
    const simple = { schemaVersion: 1 as const, mode: "simple" as const, sequence: createVideoSequenceDraft() };
    const text = compileVideoPrompt({ brief: "@beth_dialogue \"Hello\"", composer: simple, entities: [beth], policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false } });
    expect(text.ok).toBe(true);
    expect(text.prompt).toContain('Beth, a blonde woman says "Hello"');
    expect(text.entityInputs).toEqual([]);
    const invalid = compileVideoPrompt({ brief: '@beth_dialogue "Hello', composer: simple, entities: [beth], policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false } });
    expect(invalid.error).toContain("closing quote");
    const long = createVideoSequenceDraft(); long.scenes[0].shots[0].durationSeconds = 20; long.scenes[0].shots.push({ ...long.scenes[0].shots[0], id: "second", durationSeconds: 2 });
    expect(compileVideoPrompt({ brief: "", composer: { ...simple, mode: "sequence", sequence: long }, entities: [], policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false } }).error).toContain("between 2 and 20");
  });

  it("allocates entity aliases after retained inputs and restores deleted entities from snapshots", () => {
    const simple = { schemaVersion: 1 as const, mode: "simple" as const, sequence: createVideoSequenceDraft() };
    const compiled = compileVideoPrompt({ brief: "@beth", composer: simple, entities: [beth], reservedAliases: ["@image1", "@audio1"], policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true } });
    expect(compiled.entityInputs.map((item) => item.alias)).toEqual(["@image2"]);
    const snapshot = compiled.snapshots[0];
    const restored = compileVideoPrompt({ brief: "@beth", composer: simple, entities: [], fallbackSnapshots: [snapshot], policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false } });
    expect(restored.prompt).toContain("Beth, a blonde woman");
  });

  it("recompiles the authored brief from staged snapshot media without nesting H3 output", () => {
    const simple = { schemaVersion: 1 as const, mode: "simple" as const, sequence: createVideoSequenceDraft() };
    const compiled = compileVideoPrompt({ brief: "@beth", composer: simple, entities: [beth], policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true } });
    const staged = { ...compiled.snapshots[0], visualReference: { ...compiled.snapshots[0].visualReference!, path: "C:/project/generated/beth.png", url: "file:///C:/project/generated/beth.png" } };
    const restored = compileVideoPrompt({ brief: "@beth", composer: simple, entities: [], fallbackSnapshots: [staged], policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true } });
    expect(restored.entityInputs[0]).toMatchObject({ path: "C:/project/generated/beth.png", alias: "@image1" });
    expect(restored.prompt).toContain("subject_definitions:");
    expect(restored.prompt).not.toContain("[reference generation] subject_definitions:");
  });

  it("keeps H3 entity media off the FL/task route while retaining natural entity prose", () => {
    const simple = { schemaVersion: 1 as const, mode: "simple" as const, sequence: createVideoSequenceDraft() };
    const compiled = compileVideoPrompt({ brief: "@beth", composer: simple, entities: [beth], retainedRoles: ["control_video"], policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true } });
    expect(compiled.entityInputs).toEqual([]);
    expect(compiled.prompt).toContain("integrated_multimodal_description");
    expect(compiled.prompt).toContain("Beth, a blonde woman");
  });

  it("derives quick-create media availability from backend-owned policy", () => {
    expect(getReferenceEntityMediaAvailability({ promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false })).toEqual({ allowVisualMedia: false, allowVoiceMedia: false });
    expect(getReferenceEntityMediaAvailability({ promptFormat: "plain", entityMediaMode: "general-reference", voiceReference: false })).toEqual({ allowVisualMedia: true, allowVoiceMedia: false });
    expect(getReferenceEntityMediaAvailability({ promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true })).toEqual({ allowVisualMedia: true, allowVoiceMedia: true });
  });

  it("validates the main brief before sequence staging and accepts only retained aliases", () => {
    const sequence = createVideoSequenceDraft();
    sequence.scenes[0].shots[0].description = "A valid shot";
    const composer = { schemaVersion: 1 as const, mode: "sequence" as const, sequence };
    const policy = { promptFormat: "plain" as const, entityMediaMode: "text-only" as const, voiceReference: false };
    expect(compileVideoPrompt({ brief: "@unknown", composer, entities: [], policy }).error).toContain("Unknown reference token");
    expect(compileVideoPrompt({ brief: '@beth_dialogue "unfinished', composer, entities: [beth], policy }).error).toContain("closing quote");
    expect(compileVideoPrompt({ brief: "Use @image1", composer, entities: [], reservedAliases: ["@image1"], policy }).ok).toBe(true);
    expect(compileVideoPrompt({ brief: "Use @image1", composer, entities: [], policy }).error).toContain("Unknown reference token");
  });

  it("keeps retained native aliases ahead of a colliding library token", () => {
    const colliding = { ...beth, token: "@image1" };
    const simple = { schemaVersion: 1 as const, mode: "simple" as const, sequence: createVideoSequenceDraft() };
    const compiled = compileVideoPrompt({
      brief: "Use @image1",
      composer: simple,
      entities: [colliding],
      reservedAliases: ["@image1"],
      policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false },
    });
    expect(compiled).toMatchObject({ ok: true, prompt: "Use @image1" });
    expect(compiled.snapshots).toEqual([]);
  });

  it("compiles cumulative approximate timing and rejects malformed stored durations", () => {
    const sequence = createVideoSequenceDraft();
    const first = sequence.scenes[0].shots[0];
    first.durationSeconds = 2;
    first.description = "First beat";
    sequence.scenes[0].shots.push({ ...first, id: "second", durationSeconds: 8, description: "Second beat" });
    const composer = { schemaVersion: 1 as const, mode: "sequence" as const, sequence };
    const policy = { promptFormat: "plain" as const, entityMediaMode: "text-only" as const, voiceReference: false };
    const firstTiming = compileVideoPrompt({ brief: "", composer, entities: [], policy });
    expect(firstTiming.prompt).toContain("approximately 0–2 seconds");
    expect(firstTiming.prompt).toContain("approximately 2–10 seconds");
    sequence.scenes[0].shots[0].durationSeconds = 8;
    sequence.scenes[0].shots[1].durationSeconds = 2;
    const secondTiming = compileVideoPrompt({ brief: "", composer, entities: [], policy });
    expect(secondTiming.prompt).toContain("approximately 0–8 seconds");
    expect(secondTiming.prompt).toContain("approximately 8–10 seconds");
    sequence.scenes[0].shots[0].durationSeconds = Number.NaN;
    expect(compileVideoPrompt({ brief: "", composer, entities: [], policy }).error).toContain("whole number");
  });

  it("keeps one-second shots legal and resolves sequence-field references", () => {
    const sequence = createVideoSequenceDraft();
    sequence.scenes[0].timeOfDay = "@beth's arrival";
    sequence.scenes[0].shots[0] = { ...sequence.scenes[0].shots[0], durationSeconds: 1, framing: "@beth close-up", description: "@beth enters" };
    sequence.scenes[0].shots.push({ ...sequence.scenes[0].shots[0], id: "second", durationSeconds: 1, description: "The door closes" });
    const compiled = compileVideoPrompt({
      brief: "",
      composer: { schemaVersion: 1, mode: "sequence", sequence },
      entities: [beth],
      policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false },
    });
    expect(compiled).toMatchObject({ ok: true, durationSeconds: 2 });
    expect(compiled.prompt).toContain("Beth, a blonde woman's arrival");
    expect(compiled.prompt).toContain("Beth, a blonde woman close-up framing");
  });

  it("keeps historical snapshots until a saved location is explicitly reselected", () => {
    const sequence = createVideoSequenceDraft();
    sequence.scenes[0].location = "Studio";
    sequence.scenes[0].locationEntityId = studio.id;
    const historical = { ...studio, name: "Old Studio", visualDescription: "the original brick studio" };
    const compiled = compileVideoPrompt({
      brief: "",
      composer: { schemaVersion: 1, mode: "sequence", sequence },
      entities: [studio],
      fallbackSnapshots: [{ id: historical.id, token: historical.token, kind: historical.kind, name: historical.name, visualDescription: historical.visualDescription, fidelity: historical.fidelity, visualReference: { type: "image", path: historical.visualReference!.path, url: historical.visualReference!.url, fileName: historical.visualReference!.fileName } }],
      policy: { promptFormat: "plain", entityMediaMode: "text-only", voiceReference: false },
    });
    expect(compiled.prompt).toContain("Old Studio, the original brick studio");
    expect(compiled.snapshots).toMatchObject([{ id: studio.id, name: "Old Studio" }]);
  });

  it("keeps ambience and explicit no-score directives with dialogue-only voice descriptions", () => {
    const sequence = createVideoSequenceDraft();
    sequence.scenes[0].soundscape = "Rain";
    sequence.scenes[0].score = "None";
    sequence.scenes[0].shots[0].description = '@beth_dialogue "Hello"';
    const descriptionOnlyBeth = { ...beth, voiceReference: undefined };
    const compiled = compileVideoPrompt({
      brief: "",
      composer: { schemaVersion: 1, mode: "sequence", sequence },
      entities: [descriptionOnlyBeth],
      policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true },
    });
    expect(compiled.entityInputs).toEqual([]);
    expect(compiled.prompt).toContain("overall_soundscape:\nRain");
    expect(compiled.prompt).toContain("non_diegetic_music:\nNone");
  });

  it("rejects unverified speaker-to-audio media binding", () => {
    const sequence = createVideoSequenceDraft();
    sequence.scenes[0].shots[0].description = '@beth_dialogue "Hello"';
    const compiled = compileVideoPrompt({
      brief: "",
      composer: { schemaVersion: 1, mode: "sequence", sequence },
      entities: [beth],
      policy: { promptFormat: "h3", entityMediaMode: "inline-reference", voiceReference: true },
    });
    expect(compiled.error).toContain("no verified speaker-to-audio binding");
  });
});
