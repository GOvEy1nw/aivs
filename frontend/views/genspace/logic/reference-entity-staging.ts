import type { ReferenceEntitySnapshot } from "../../../../shared/reference-library";
import type { CompiledEntityInput } from "./video-prompt-composer";

export type StagedEntityInput = CompiledEntityInput & {
  path: string;
  url: string;
  created: boolean;
};

export async function stageEntityInputs(
  inputs: readonly CompiledEntityInput[],
  stage: (path: string) => Promise<{ success: boolean; path?: string; url?: string; alreadyExisted?: boolean; reusedExisting?: boolean; error?: string }>,
  cleanup: (paths: string[]) => Promise<void>,
): Promise<StagedEntityInput[]> {
  const staged: StagedEntityInput[] = [];
  try {
    for (const input of inputs) {
      const result = await stage(input.path);
      if (!result.success || !result.path || !result.url) throw new Error(result.error ?? `Could not stage ${input.id}.`);
      staged.push({
        ...input,
        path: result.path,
        url: result.url,
        created: !result.alreadyExisted && !result.reusedExisting,
      });
    }
    return staged;
  } catch (error) {
    await cleanup(staged.filter((input) => input.created).map((input) => input.path));
    throw error;
  }
}

export function stageReferenceSnapshots(
  snapshots: readonly ReferenceEntitySnapshot[],
  inputs: readonly StagedEntityInput[],
): ReferenceEntitySnapshot[] {
  const staged = new Map(inputs.map((input) => [input.id, input]));
  const media = (input: StagedEntityInput | undefined, current: ReferenceEntitySnapshot["visualReference"]) => input && current ? { ...current, path: input.path, url: input.url } : current;
  return snapshots.map((snapshot) => ({
    ...snapshot,
    visualReference: media(staged.get(`reference-${snapshot.id}`), snapshot.visualReference),
    ...(snapshot.kind === "cast" ? { voiceReference: media(staged.get(`reference-voice-${snapshot.id}`), snapshot.voiceReference) } : {}),
  }));
}
