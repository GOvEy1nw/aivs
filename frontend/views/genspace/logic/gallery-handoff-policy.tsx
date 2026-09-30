import { Image, Mic, Music2, Play, StepForward, Video } from "lucide-react";
import type { ReactNode } from "react";
import { selectVideoEditOperations } from "../../../lib/model-profile-policy";
import type { ModelProfile } from "../../../types/model-profiles";
import type { Asset } from "../../../types/project";
import type { VideoToolId } from "../../../types/video-tools";
import { VIDEO_TOOL_OPTIONS } from "../video/video-tools";
import { GUIDE_MEDIA_ROLE_SET } from "../constants";
import type { GenSpaceMediaInput } from "../types";

export type GalleryHandoffTarget =
  | "edit-image"
  | "image-guide"
  | "first-frame"
  | "last-frame"
  | "video-guide"
  | "control-video"
  | "video-reference"
  | "audio-guide"
  | "audio-reference"
  | "voice-reference"
  | `video-tool:${VideoToolId}`;

export interface GalleryHandoffDestination {
  target: GalleryHandoffTarget;
  label: string;
  icon: ReactNode;
  useExcerpt: boolean;
}

export interface GalleryHandoffCapture {
  projectId: string | null;
  mode: string;
  imageProfileId: string;
  videoProfileId: string;
  speechProfileId: string;
}

export function isGalleryHandoffDestinationCurrent(
  captured: GalleryHandoffCapture,
  current: GalleryHandoffCapture,
) {
  return captured.projectId === current.projectId &&
    captured.mode === current.mode &&
    captured.imageProfileId === current.imageProfileId &&
    captured.videoProfileId === current.videoProfileId &&
    captured.speechProfileId === current.speechProfileId;
}

export function includesGalleryHandoffDestination(
  destinations: readonly GalleryHandoffDestination[],
  destination: GalleryHandoffDestination,
) {
  return destinations.some((candidate) => candidate.target === destination.target);
}

function withExcerpt(
  target: GalleryHandoffTarget,
  label: string,
  icon: ReactNode,
  allowExcerpt: boolean,
): GalleryHandoffDestination[] {
  return [
    { target, label, icon, useExcerpt: false },
    ...(allowExcerpt
      ? [{ target, label: `${label} excerpt…`, icon, useExcerpt: true }]
      : []),
  ];
}

function hasReferenceCapacity(
  inputs: readonly GenSpaceMediaInput[],
  profile: ModelProfile | undefined,
  type: "image" | "video" | "audio",
) {
  if (!profile || !isAvailable(profile)) return false;
  const role = `reference_${type}`;
  if (!profile.inputMedia.roles.some((candidate) => candidate.role === role)) {
    return false;
  }
  const maximum = type === "image"
    ? profile.inputMedia.maxReferenceImages
    : type === "video"
      ? profile.inputMedia.maxReferenceVideos
      : profile.inputMedia.maxReferenceAudios;
  return maximum !== undefined && inputs.filter((input) => input.role === role).length < maximum;
}

function isAvailable(profile: ModelProfile) {
  return profile.availability === "available" || profile.availability === "experimental";
}

function supportsStandaloneAudioExcerpt(profile: ModelProfile | undefined) {
  return profile?.id !== "minimax_h3_fast" && profile?.id !== "minimax_h3_quality";
}

function isH3Profile(profile: ModelProfile | undefined) {
  return profile?.id === "minimax_h3_fast" || profile?.id === "minimax_h3_quality";
}

function hasH3References(inputs: readonly GenSpaceMediaInput[]) {
  return inputs.some(({ role }) =>
    role === "reference_image" || role === "reference_video" ||
    role === "reference_audio" || role === "depth",
  );
}

export function getGalleryHandoffDestinations({
  asset,
  imageProfile,
  videoProfile,
  speechProfile,
  inputs,
  speechReferenceCount,
  hasEditProfile,
}: {
  asset: Pick<Asset, "type">;
  imageProfile: ModelProfile | undefined;
  videoProfile: ModelProfile | undefined;
  speechProfile: ModelProfile | undefined;
  inputs: readonly GenSpaceMediaInput[];
  speechReferenceCount: number;
  hasEditProfile: boolean;
}): GalleryHandoffDestination[] {
  if (asset.type === "image") {
    return [
      ...(hasEditProfile
        ? withExcerpt("edit-image", "Edit image", <Image className="h-3.5 w-3.5" />, false)
        : []),
      ...(imageProfile && isAvailable(imageProfile) && imageProfile.inputMedia.supportsImageInputs &&
        inputs.length < imageProfile.inputMedia.maxImages
        ? withExcerpt("image-guide", "Image guide", <Image className="h-3.5 w-3.5" />, false)
        : []),
      ...(videoProfile && isAvailable(videoProfile) && videoProfile.capabilities.startImage
        ? withExcerpt("first-frame", "First frame", <Play className="h-3.5 w-3.5" />, false)
        : []),
      ...(videoProfile && isAvailable(videoProfile) && videoProfile.capabilities.endImage
        ? withExcerpt("last-frame", "Last frame", <StepForward className="h-3.5 w-3.5" />, false)
        : []),
    ];
  }

  if (asset.type === "video") {
    const hasGuide = inputs.some((input) => GUIDE_MEDIA_ROLE_SET.has(input.role));
    const h3References = hasH3References(inputs);
    const tools = videoProfile
      ? selectVideoEditOperations(videoProfile)
        .filter(({ id }) => id !== "retake")
        .flatMap(({ id }) => {
          const option = VIDEO_TOOL_OPTIONS.find(({ value }) => value === id);
          return option
            ? withExcerpt(`video-tool:${option.value}`, option.label, <Video className="h-3.5 w-3.5" />, false)
            : [];
        })
      : [];
    return [
      ...(videoProfile && isH3Profile(videoProfile) && isAvailable(videoProfile) &&
        videoProfile.capabilities.controlVideo && videoProfile.videoAudio.controlVideoAudio &&
        !h3References && !inputs.some((input) => input.role === "control_video")
        ? withExcerpt("control-video", "Control video", <Video className="h-3.5 w-3.5" />, false)
        : []),
      ...(videoProfile && isAvailable(videoProfile) &&
        videoProfile.inputMedia.roles.some((candidate) => candidate.role === "human_motion") && !hasGuide
        ? withExcerpt("video-guide", "Motion guide", <Video className="h-3.5 w-3.5" />, false)
        : []),
      ...(hasReferenceCapacity(inputs, videoProfile, "video")
        ? withExcerpt("video-reference", "Video reference", <Video className="h-3.5 w-3.5" />, true)
        : []),
      ...tools,
    ];
  }

  const voiceReferenceAvailable = Boolean(
    speechProfile && isAvailable(speechProfile) &&
      speechProfile.speech.status !== "hidden" &&
      speechProfile.speech.handler === "speech_generation" &&
      speechProfile.speech.referenceVoice &&
      speechProfile.speech.tts &&
      speechReferenceCount < speechProfile.speech.maxReferenceInputs,
  );
  const hasGuide = inputs.some((input) => input.role === "audio_to_video");
  return [
    ...(videoProfile && isAvailable(videoProfile) && videoProfile.capabilities.audioToVideo &&
      videoProfile.videoAudio.audioConditioning &&
      !hasGuide
      ? withExcerpt("audio-guide", "Audio guide", <Music2 className="h-3.5 w-3.5" />, true)
      : []),
    ...(hasReferenceCapacity(inputs, videoProfile, "audio")
      ? withExcerpt(
        "audio-reference",
        "Audio reference",
        <Music2 className="h-3.5 w-3.5" />,
        supportsStandaloneAudioExcerpt(videoProfile),
      )
      : []),
    ...(voiceReferenceAvailable
      ? withExcerpt("voice-reference", "Voice reference", <Mic className="h-3.5 w-3.5" />, true)
      : []),
  ];
}
