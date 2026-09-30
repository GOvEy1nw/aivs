import type {
  GenSpaceMediaInput,
  GenSpaceMode,
  VideoProcessMode,
} from "../types";

export interface GenSpaceModeTransition {
  mode: GenSpaceMode;
  videoMode: VideoProcessMode;
  imageInputs: GenSpaceMediaInput[];
  clearInputImage: boolean;
  clearInputAudio: boolean;
}

export function transitionGenSpaceMode(
  nextMode: GenSpaceMode,
  currentVideoMode: VideoProcessMode,
  imageInputs: GenSpaceMediaInput[],
): GenSpaceModeTransition {
  if (nextMode === "video") {
    return {
      mode: nextMode,
      videoMode: currentVideoMode,
      imageInputs,
      clearInputImage: false,
      clearInputAudio: false,
    };
  }

  return {
    mode: nextMode,
    videoMode: "generate",
    imageInputs:
      nextMode === "music"
        ? []
        : imageInputs.filter(
            (item) => item.type === undefined || item.type === "image",
          ),
    clearInputImage: nextMode === "music",
    clearInputAudio: true,
  };
}

export function transitionVideoProcessMode(
  nextMode: VideoProcessMode,
): { mode: VideoProcessMode } | null {
  if (nextMode === "retake") return null;
  return { mode: nextMode };
}
