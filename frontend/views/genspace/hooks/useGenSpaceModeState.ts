import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AudioSubMode,
  GenSpaceMediaInput,
  GenSpaceMode,
  ImageProcessMode,
  VideoProcessMode,
} from "../types";
import {
  transitionGenSpaceMode,
  transitionVideoProcessMode,
} from "../logic/mode-transitions";

type PromptScope = "image" | "video" | "music" | "sfx" | "speech";

function promptScope(mode: GenSpaceMode, audioSubmode: AudioSubMode): PromptScope {
  if (mode !== "music") return mode;
  return audioSubmode === "mixer" ? "music" : audioSubmode;
}

export function useGenSpaceModeState({
  imageInputs,
  setImageInputs,
  setInputImage,
  setInputAudio,
  audioSubmode,
}: {
  imageInputs: GenSpaceMediaInput[];
  setImageInputs: Dispatch<SetStateAction<GenSpaceMediaInput[]>>;
  setInputImage: Dispatch<SetStateAction<string | null>>;
  setInputAudio: Dispatch<SetStateAction<string | null>>;
  audioSubmode: AudioSubMode;
}) {
  const [mode, setMode] = useState<GenSpaceMode>("image");
  const [imageMode, setImageMode] =
    useState<ImageProcessMode>("create");
  const [videoMode, setVideoMode] =
    useState<VideoProcessMode>("generate");
  const [prompts, setPrompts] = useState<Record<PromptScope, string>>({
    image: "",
    video: "",
    music: "",
    sfx: "",
    speech: "",
  });
  const prompt = prompts[promptScope(mode, audioSubmode)];
  const setPrompt = useCallback(
    (value: SetStateAction<string>) => {
      const scope = promptScope(mode, audioSubmode);
      setPrompts((current) => ({
        ...current,
        [scope]: typeof value === "function" ? value(current[scope]) : value,
      }));
    },
    [audioSubmode, mode],
  );
  const setPromptForMode = useCallback(
    (
      targetMode: GenSpaceMode,
      value: SetStateAction<string>,
      targetAudioSubmode: AudioSubMode = audioSubmode,
    ) => {
      const scope = promptScope(targetMode, targetAudioSubmode);
      setPrompts((current) => ({
        ...current,
        [scope]: typeof value === "function" ? value(current[scope]) : value,
      }));
    },
    [audioSubmode],
  );

  const handleModeChange = useCallback(
    (nextMode: GenSpaceMode) => {
      const transition = transitionGenSpaceMode(
        nextMode,
        videoMode,
        imageInputs,
      );
      setMode(transition.mode);
      setVideoMode(transition.videoMode);
      setImageInputs(transition.imageInputs);
      if (transition.clearInputImage) setInputImage(null);
      if (transition.clearInputAudio) setInputAudio(null);
    },
    [
      imageInputs,
      setImageInputs,
      setInputAudio,
      setInputImage,
      videoMode,
    ],
  );

  const handleVideoModeChange = useCallback(
    (nextMode: VideoProcessMode) => {
      const transition = transitionVideoProcessMode(nextMode);
      if (!transition) return;
      setVideoMode(transition.mode);
    },
    [],
  );

  return {
    mode,
    setMode,
    imageMode,
    setImageMode,
    videoMode,
    setVideoMode,
    prompt,
    setPrompt,
    setPromptForMode,
    handleModeChange,
    handleVideoModeChange,
  };
}
