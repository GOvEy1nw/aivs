import { Image, Music, Video } from "lucide-react";
import { UseMediaDropdown } from "../../../components/UseMediaDropdown";
import type { Asset } from "../../../types/project";
import type { GalleryHandoffDestination } from "../logic/gallery-handoff-policy";

export function GalleryHandoffMenu({
  asset,
  destinations,
  onSelect,
  variant,
}: {
  asset: Asset;
  destinations: readonly GalleryHandoffDestination[];
  onSelect: (destination: GalleryHandoffDestination) => void;
  variant: "context" | "detail";
}) {
  const icon = asset.type === "image"
    ? <Image className="h-4 w-4 shrink-0" />
    : asset.type === "video"
      ? <Video className="h-4 w-4 shrink-0" />
      : <Music className="h-4 w-4 shrink-0" />;
  return (
    <UseMediaDropdown
      label={`Use ${asset.type}`}
      icon={icon}
      variant={variant}
      options={destinations.map(({ target, label, icon }) => ({
        target: `${target}:${label}`,
        label,
        icon,
      }))}
      onSelect={(selected) => {
        const destination = destinations.find(
          ({ target, label }) => `${target}:${label}` === selected,
        );
        if (destination) onSelect(destination);
      }}
    />
  );
}
