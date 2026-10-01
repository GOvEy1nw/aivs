import type {
  ModelProfileInputMedia,
  ModelProfileInputMediaRole,
} from "../../../types/model-profiles";
import {
  AUDIO_MEDIA_ROLE_SET,
  GUIDE_MEDIA_ROLE_SET,
} from "../constants";
import type {
  GenSpaceMediaInput,
  GenSpaceMediaKind,
  ImageProcessMode,
  VideoProcessMode,
} from "../types";
import type { ImageEditToolMode } from "../../../types/image-edit";

export function getDefaultImageInputRole(
  policy: ModelProfileInputMedia | undefined,
): string {
  return policy?.defaultRole ?? policy?.roles[0]?.role ?? "reference_subject";
}

export function normalizeImageInputsForProfile(
  inputs: GenSpaceMediaInput[],
  policy: ModelProfileInputMedia | undefined,
): GenSpaceMediaInput[] {
  if (!policy?.supportsImageInputs) return [];
  const roles = new Set(policy.roles.map(({ role }) => role));
  const fallback = getDefaultImageInputRole(policy);
  return inputs
    .filter(({ type }) => type === undefined || type === "image")
    .slice(0, policy.maxImages)
    .map((input) => (roles.has(input.role) ? input : { ...input, role: fallback }));
}

export function normalizeVideoInputsForProfile(
  inputs: GenSpaceMediaInput[],
  supportsInputs: boolean,
): GenSpaceMediaInput[] {
  if (!supportsInputs) return [];
  const normalized: GenSpaceMediaInput[] = [];
  const seen = new Set<string>();
  let hasGuide = false;
  for (const input of inputs) {
    if (input.role === "start_image" || input.role === "end_image") {
      if (!seen.has(input.role)) {
        seen.add(input.role);
        normalized.push(input);
      }
    } else if (GUIDE_MEDIA_ROLE_SET.has(input.role) && !hasGuide) {
      hasGuide = true;
      normalized.push(input);
    }
  }
  return normalized;
}

export function replaceInputForRole(
  inputs: GenSpaceMediaInput[],
  next: GenSpaceMediaInput,
): GenSpaceMediaInput[] {
  return [...inputs.filter(({ role }) => role !== next.role), next];
}

export function replaceGuideInput(
  inputs: GenSpaceMediaInput[],
  next: GenSpaceMediaInput,
): GenSpaceMediaInput[] {
  return [...inputs.filter(({ role }) => !GUIDE_MEDIA_ROLE_SET.has(role)), next];
}

export function removeMediaInput(
  inputs: GenSpaceMediaInput[],
  id: string,
): GenSpaceMediaInput[] {
  return inputs.filter((input) => input.id !== id);
}

export function findGuideInput(
  inputs: readonly GenSpaceMediaInput[],
): GenSpaceMediaInput | undefined {
  return inputs.find(({ role }) => GUIDE_MEDIA_ROLE_SET.has(role));
}

export function getAudioGuideRole(
  policy: ModelProfileInputMedia | undefined,
): "audio_guide" | "audio_to_video" | undefined {
  if (!policy) return undefined;
  return policy?.roles.some(({ role }) => role === "audio_guide")
    ? "audio_guide"
    : policy.roles.some(({ role }) => role === "audio_to_video")
      ? "audio_to_video"
      : undefined;
}

const H3_REFERENCE_CONFLICT_ROLES = new Set([
  "control_video",
  "audio_guide",
  // Legacy saved inputs may still contain this old control role.
  "control_audio",
]);

export function hasH3ReferenceConflict(roles: readonly string[]): boolean {
  return roles.some((role) => H3_REFERENCE_CONFLICT_ROLES.has(role));
}

const H3_REFERENCE_MEDIA_ROLES = new Set([
  "reference_image",
  "reference_video",
  "reference_audio",
  "depth",
]);

export function hasH3ReferenceMedia(roles: readonly string[]): boolean {
  return roles.some((role) => H3_REFERENCE_MEDIA_ROLES.has(role));
}

export function hasH3StartImageReferenceVideoConflict(
  roles: readonly string[],
): boolean {
  return (
    roles.includes("start_image") &&
    roles.some((role) => role === "reference_video" || role === "depth")
  );
}

const SEQUENCE_RETAINED_MEDIA_ROLES = new Set([
  "start_image", "end_image", "control_video", "control_audio", "continue_video", "edit_image", "reframe_source",
]);
const SEQUENCE_FREE_REFERENCE_ROLES = new Set([
  "depth", "human_motion", "human_motion_pose", "canny_edges", "audio_to_video", "audio_guide",
]);

export function isSequenceFreeReferenceRole(role: string): boolean {
  return !SEQUENCE_RETAINED_MEDIA_ROLES.has(role) &&
    (role.startsWith("reference_") || SEQUENCE_FREE_REFERENCE_ROLES.has(role));
}

export function removeSequenceFreeReferences(inputs: GenSpaceMediaInput[]): GenSpaceMediaInput[] {
  return inputs.filter((input) => !isSequenceFreeReferenceRole(input.role));
}

const H3_ALIAS_PATTERN = /@(image|video|audio)[1-9]\d*/g;

export function getH3PromptAliases(prompt: string): string[] {
  return [...new Set(prompt.match(H3_ALIAS_PATTERN) ?? [])];
}

export function nextH3MediaAlias(
  inputs: GenSpaceMediaInput[],
  reservedAliases: readonly string[],
  type: GenSpaceMediaKind,
): string {
  const pattern = new RegExp(`^@${type}(\\d+)$`);
  const highest = [...inputs.map((input) => input.alias), ...reservedAliases]
    .reduce((value, alias) => {
      const match = pattern.exec(alias ?? "");
      return Math.max(value, match ? Number(match[1]) : 0);
    }, 0);
  return `@${type}${highest + 1}`;
}

export type H3ReferenceAvailability = Record<GenSpaceMediaKind, boolean>;

export interface H3ReferenceState {
  activeInputs: GenSpaceMediaInput[];
  disabledVideoIds: ReadonlySet<string>;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  totalCount: number;
  soundtrackCount: number;
  hasReferenceMedia: boolean;
  hasReferenceVideo: boolean;
  availability: H3ReferenceAvailability;
}

export function getH3ReferenceState(
  inputs: readonly GenSpaceMediaInput[],
): H3ReferenceState {
  const hasFlInput = hasH3ReferenceConflict(inputs.map(({ role }) => role));
  const roles = inputs.map(({ role }) => role);
  const hasStartImage = roles.includes("start_image");
  const hasReferenceVideo = roles.some(
    (role) => role === "reference_video" || role === "depth",
  );
  const imageCount = inputs.filter(({ role }) => role === "reference_image").length;
  const videos = inputs.filter(
    ({ role, type }) =>
      type === "video" && (role === "reference_video" || role === "depth"),
  );
  const depth = videos.find(({ role }) => role === "depth");
  const activeVideos = depth ? [depth] : videos;
  const disabledVideoIds = new Set(
    depth ? videos.filter(({ id }) => id !== depth.id).map(({ id }) => id) : [],
  );
  const standaloneAudioCount = inputs.filter(
    ({ role }) => role === "reference_audio",
  ).length;
  const soundtrackCount = activeVideos.some(({ useAudioTrack }) => useAudioTrack)
    ? activeVideos.length
    : 0;
  const videoCount = activeVideos.length;
  const audioCount = standaloneAudioCount + soundtrackCount;
  const totalCount = imageCount + videoCount + standaloneAudioCount;
  const canAdd = !hasFlInput && totalCount < 12;
  const availability = {
    image: canAdd && imageCount < 9,
    video: canAdd && !hasStartImage && !depth && videoCount < 3,
    audio:
      canAdd &&
      soundtrackCount === 0 &&
      audioCount < 3 &&
      audioCount + 1 <= imageCount + videoCount,
  };
  return {
    activeInputs: inputs.filter(({ id }) => !disabledVideoIds.has(id)),
    disabledVideoIds,
    imageCount,
    videoCount,
    audioCount,
    totalCount,
    soundtrackCount,
    hasReferenceMedia: hasH3ReferenceMedia(roles),
    hasReferenceVideo,
    availability,
  };
}

export function getH3ReferenceAvailability(
  inputs: GenSpaceMediaInput[],
): H3ReferenceAvailability {
  return getH3ReferenceState(inputs).availability;
}

export function inferMediaKindForRole(role: string): GenSpaceMediaKind {
  if (AUDIO_MEDIA_ROLE_SET.has(role)) return "audio";
  if (GUIDE_MEDIA_ROLE_SET.has(role)) return "video";
  return "image";
}

export function isImageAspectRatioLocked(
  processMode: ImageProcessMode,
  editToolMode: ImageEditToolMode,
  _inputs: GenSpaceMediaInput[],
  hasEditImage: boolean,
): boolean {
  return (
    processMode === "edit" &&
    editToolMode !== "reframe" &&
    hasEditImage
  );
}

export function isVideoAspectRatioLocked(
  processMode: VideoProcessMode,
  inputs: GenSpaceMediaInput[],
  hasLegacyImage: boolean,
): boolean {
  return (
    processMode === "generate" &&
    (hasLegacyImage ||
      inputs.some(({ role }) => role === "start_image" || role === "end_image"))
  );
}

export function imageRoleOptions(
  policy: ModelProfileInputMedia | undefined,
): ModelProfileInputMediaRole[] {
  return policy?.roles ?? [];
}
