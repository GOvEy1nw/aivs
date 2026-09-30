import {
  AudioLines,
  Mic,
  Music,
  Pencil,
  Scan,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import type { VideoToolId } from "../../types/video-tools";
import type { ModelProfile } from "../../types/model-profiles";
import { selectVideoEditOperations } from "../../lib/model-profile-policy";
import { isModelProfileInstalled } from "../../lib/model-profile-availability";
import { VIDEO_TOOL_OPTIONS } from "./video/video-tools";

export type QuickGenWorkflowId =
  | `image:${"create" | "edit" | "retouch" | "reframe" | "region" | "upscale"}`
  | "video:generate"
  | "video:retake"
  | `video:tool:${VideoToolId}`
  | `audio:${"music" | "speech" | "sfx" | "mixer"}`;

export interface QuickGenWorkflow {
  id: QuickGenWorkflowId;
  media: "image" | "video" | "music";
  label: string;
  description: string;
  icon: LucideIcon;
}

const imageWorkflows: readonly QuickGenWorkflow[] = [
  { id: "image:create", media: "image", label: "Generate", description: "Create an image from text.", icon: Sparkles },
  { id: "image:edit", media: "image", label: "Edit", description: "Edit an existing image.", icon: Pencil },
  { id: "image:retouch", media: "image", label: "Retouch", description: "Retouch an existing image.", icon: Pencil },
  { id: "image:reframe", media: "image", label: "Reframe", description: "Reframe an existing image.", icon: Scan },
  { id: "image:region", media: "image", label: "Region", description: "Generate selected image regions.", icon: Scan },
  { id: "image:upscale", media: "image", label: "Upscale", description: "Enhance image resolution and detail.", icon: ZoomIn },
];

const videoWorkflows: readonly QuickGenWorkflow[] = [
  { id: "video:generate", media: "video", label: "Generate", description: "Create a video from a prompt.", icon: Sparkles },
  ...VIDEO_TOOL_OPTIONS.map(({ value, label }) => ({
    id: `video:tool:${value}` as QuickGenWorkflowId,
    media: "video" as const,
    label,
    description: value === "upscale" ? "Enhance video resolution and detail." : `${label} an existing video.`,
    icon: Wrench,
  })),
  { id: "video:retake", media: "video", label: "Retake", description: "Regenerate a selected video section.", icon: Scissors },
];

const audioWorkflows: readonly QuickGenWorkflow[] = [
  { id: "audio:music", media: "music", label: "Music", description: "Create music from a prompt.", icon: Music },
  { id: "audio:speech", media: "music", label: "Speech", description: "Create spoken audio from text.", icon: Mic },
  { id: "audio:sfx", media: "music", label: "SFX", description: "Create sound effects from text.", icon: AudioLines },
  { id: "audio:mixer", media: "music", label: "Mixer", description: "Mix project audio.", icon: SlidersHorizontal },
];

export const QUICK_GEN_WORKFLOWS = [
  ...imageWorkflows,
  ...videoWorkflows,
  ...audioWorkflows,
] as const satisfies readonly QuickGenWorkflow[];

const workflowsById = new Map(QUICK_GEN_WORKFLOWS.map((workflow) => [workflow.id, workflow]));

export function getQuickGenWorkflow(id: string): QuickGenWorkflow | undefined {
  return workflowsById.get(id as QuickGenWorkflowId);
}

export function getQuickGenWorkflowsForMedia(media: QuickGenWorkflow["media"]): readonly QuickGenWorkflow[] {
  return QUICK_GEN_WORKFLOWS.filter((workflow) => workflow.media === media);
}

export function normalizeQuickGenFavouriteWorkflows(value: readonly string[] | undefined): QuickGenWorkflowId[] {
  const unique = new Set<QuickGenWorkflowId>();
  for (const id of value ?? []) {
    if (unique.size === 32) break;
    if (getQuickGenWorkflow(id)) unique.add(id as QuickGenWorkflowId);
  }
  return [...unique];
}

export function reorderQuickGenFavouriteWorkflows(
  favourites: readonly QuickGenWorkflowId[],
  workflowId: QuickGenWorkflowId,
  targetWorkflowId: QuickGenWorkflowId,
): QuickGenWorkflowId[] {
  const fromIndex = favourites.indexOf(workflowId);
  const targetIndex = favourites.indexOf(targetWorkflowId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
    return [...favourites];
  }
  const reordered = [...favourites];
  reordered.splice(fromIndex, 1);
  reordered.splice(targetIndex, 0, workflowId);
  return reordered;
}

export function getCompatibleVideoProfiles(
  profiles: readonly ModelProfile[],
  workflowId: Extract<QuickGenWorkflowId, `video:${string}`>,
): ModelProfile[] {
  if (workflowId === "video:generate") return [...profiles];
  if (workflowId === "video:retake") return [];
  const operationId = workflowId.slice(11);
  if (operationId === "upscale") return [...profiles];
  return profiles.filter((profile) =>
    selectVideoEditOperations(profile).some(({ id }) => id === operationId),
  );
}

export function isSelectedInstalledVideoProfile(
  profiles: readonly ModelProfile[],
  workflowId: Extract<QuickGenWorkflowId, `video:${string}`>,
  profileId: string,
): boolean {
  return getCompatibleVideoProfiles(profiles, workflowId).some(
    (profile) =>
      profile.id === profileId &&
      isModelProfileInstalled(profile.availability),
  );
}

export function selectPreferredInstalledProfile<T extends { id: string; availability: ModelProfile["availability"] }>(
  profiles: readonly T[],
  currentId: string,
): T | undefined {
  return profiles.find((profile) => profile.id === currentId && isModelProfileInstalled(profile.availability))
    ?? profiles.find((profile) => isModelProfileInstalled(profile.availability));
}
