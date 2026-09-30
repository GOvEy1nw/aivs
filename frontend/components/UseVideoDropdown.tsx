import {
  Expand,
  Sparkles,
  StepForward,
  Video,
} from "lucide-react";
import { type ReactNode } from "react";
import { useVideoProfiles } from "../hooks/use-image-profiles";
import { selectVideoEditOperations } from "../lib/model-profile-policy";
import type { VideoToolId } from "../types/video-tools";
import { VIDEO_TOOL_OPTIONS } from "../views/genspace/video/video-tools";
import { UseMediaDropdown } from "./UseMediaDropdown";

export type VideoUseTarget = "reference" | VideoToolId;

function getVideoToolIcon(target: VideoToolId) {
  if (target === "reframe") return <Expand className="h-3.5 w-3.5" />;
  if (target === "extend") return <StepForward className="h-3.5 w-3.5" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

export const VIDEO_USE_OPTIONS: Array<{
  target: VideoUseTarget;
  label: string;
  icon: ReactNode;
}> = [
  {
    target: "reference",
    label: "Reference",
    icon: <Video className="h-3.5 w-3.5" />,
  },
  ...VIDEO_TOOL_OPTIONS.map(({ value, label }) => ({
    target: value,
    label,
    icon: getVideoToolIcon(value),
  })),
];

export function UseVideoDropdown({
  onSelect,
  variant = "detail",
}: {
  onSelect: (target: VideoUseTarget) => void;
  variant?: "context" | "detail";
}) {
  const { profiles } = useVideoProfiles();
  const supportedToolIds = new Set(
    profiles.flatMap((profile) =>
      selectVideoEditOperations(profile).map(({ id }) => id),
    ),
  );
  const options = VIDEO_USE_OPTIONS.filter(
    ({ target }) => target === "reference" || supportedToolIds.has(target),
  );
  return (
    <UseMediaDropdown
      label="Use video"
      icon={<Video className="h-4 w-4 shrink-0" />}
      options={options}
      onSelect={onSelect}
      variant={variant}
    />
  );
}
