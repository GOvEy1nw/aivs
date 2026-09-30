import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createVideoSequenceDraft } from "../logic/video-prompt-composer";
import type { VideoComposerStateV1, VideoSequenceScene, VideoSequenceShot } from "../../../types/video-composer";
import type { ReferenceEntity } from "../../../../shared/reference-library";
import { snapshotReferenceEntity } from "../logic/video-prompt-composer";

function createDefaultComposer(): VideoComposerStateV1 {
  return { schemaVersion: 1, mode: "simple", sequence: createVideoSequenceDraft() };
}

function normalizeComposer(value: VideoComposerStateV1 | undefined): VideoComposerStateV1 {
  if (value?.schemaVersion === 1 && Array.isArray(value.sequence?.scenes) && value.sequence.scenes.length > 0) return value;
  return createDefaultComposer();
}

export function useVideoComposerState(projectId: string | null, persisted: VideoComposerStateV1 | undefined) {
  const [value, setValue] = useState<VideoComposerStateV1>(() => normalizeComposer(persisted));
  const activeProjectIdRef = useRef(projectId);
  const currentValue = activeProjectIdRef.current === projectId ? value : normalizeComposer(persisted);

  useEffect(() => {
    if (activeProjectIdRef.current === projectId) return;
    activeProjectIdRef.current = projectId;
    setValue(normalizeComposer(persisted));
  }, [projectId, persisted]);

  const update = useCallback((transform: (current: VideoComposerStateV1) => VideoComposerStateV1) => {
    setValue(transform);
  }, []);
  const restore = useCallback((next: VideoComposerStateV1) => {
    setValue(normalizeComposer(next));
  }, []);
  const setMode = useCallback((mode: VideoComposerStateV1["mode"]) => update((current) => ({ ...current, mode })), [update]);
  const updateScene = useCallback((sceneId: string, patch: Partial<VideoSequenceScene>) => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: current.sequence.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene) } })), [update]);
  const updateShot = useCallback((sceneId: string, shotId: string, patch: Partial<VideoSequenceShot>) => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: current.sequence.scenes.map((scene) => scene.id !== sceneId ? scene : { ...scene, shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot) }) } })), [update]);
  const selectLocation = useCallback((sceneId: string, location: Extract<ReferenceEntity, { kind: "location" }>) => update((current) => ({
    ...current,
    sequence: {
      ...current.sequence,
      scenes: current.sequence.scenes.map((scene) => scene.id === sceneId
        ? { ...scene, location: location.name, locationEntityId: location.id }
        : scene),
    },
    referencedEntities: [
      ...(current.referencedEntities ?? []).filter((entity) => entity.id !== location.id),
      snapshotReferenceEntity(location),
    ],
  })), [update]);
  const addScene = useCallback(() => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: [...current.sequence.scenes, createVideoSequenceDraft().scenes[0]] } })), [update]);
  const addShot = useCallback((sceneId: string) => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: current.sequence.scenes.map((scene) => scene.id !== sceneId ? scene : { ...scene, shots: [...scene.shots, createVideoSequenceDraft().scenes[0].shots[0]] }) } })), [update]);
  const removeScene = useCallback((sceneId: string) => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: current.sequence.scenes.length === 1 ? createVideoSequenceDraft().scenes : current.sequence.scenes.filter((scene) => scene.id !== sceneId) } })), [update]);
  const removeShot = useCallback((sceneId: string, shotId: string) => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: current.sequence.scenes.map((scene) => scene.id !== sceneId ? scene : { ...scene, shots: scene.shots.length === 1 ? createVideoSequenceDraft().scenes[0].shots : scene.shots.filter((shot) => shot.id !== shotId) }) } })), [update]);
  const moveScene = useCallback((sceneId: string, offset: number) => update((current) => {
    const from = current.sequence.scenes.findIndex((scene) => scene.id === sceneId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= current.sequence.scenes.length) return current;
    const scenes = [...current.sequence.scenes];
    const [scene] = scenes.splice(from, 1);
    scenes.splice(to, 0, scene);
    return { ...current, sequence: { ...current.sequence, scenes } };
  }), [update]);
  const moveShot = useCallback((sceneId: string, shotId: string, offset: number) => update((current) => ({ ...current, sequence: { ...current.sequence, scenes: current.sequence.scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    const from = scene.shots.findIndex((shot) => shot.id === shotId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= scene.shots.length) return scene;
    const shots = [...scene.shots];
    const [shot] = shots.splice(from, 1);
    shots.splice(to, 0, shot);
    return { ...scene, shots };
  }) } })), [update]);
  return useMemo(() => ({ projectId, value: currentValue, restore, setMode, updateScene, updateShot, selectLocation, addScene, addShot, removeScene, removeShot, moveScene, moveShot }), [projectId, currentValue, restore, setMode, updateScene, updateShot, selectLocation, addScene, addShot, removeScene, removeShot, moveScene, moveShot]);
}
