import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AudioSubMode, GenSpaceMediaInput } from "../types";
import { useGenSpaceModeState } from "./useGenSpaceModeState";

describe("useGenSpaceModeState", () => {
  it("keeps drafts scoped to image, video, and speech across workflow changes", () => {
    const { result, rerender } = renderHook(
      ({ audioSubmode }: { audioSubmode: AudioSubMode }) => {
        const [imageInputs, setImageInputs] = useState<GenSpaceMediaInput[]>([]);
        const [, setInputImage] = useState<string | null>(null);
        const [, setInputAudio] = useState<string | null>(null);
        return useGenSpaceModeState({
          imageInputs,
          setImageInputs,
          setInputImage,
          setInputAudio,
          audioSubmode,
        });
      },
      { initialProps: { audioSubmode: "music" } as { audioSubmode: AudioSubMode } },
    );

    act(() => result.current.setPrompt("image draft"));
    act(() => result.current.setPromptForMode("video", "video draft"));
    act(() => result.current.handleModeChange("video"));
    expect(result.current.prompt).toBe("video draft");
    act(() => result.current.handleVideoModeChange("reframe"));
    expect(result.current.prompt).toBe("video draft");

    act(() => result.current.handleModeChange("music"));
    rerender({ audioSubmode: "speech" });
    act(() => result.current.setPromptForMode("music", "speech draft", "speech"));
    act(() => result.current.handleModeChange("image"));
    expect(result.current.prompt).toBe("image draft");

    act(() => result.current.handleModeChange("video"));
    expect(result.current.prompt).toBe("video draft");
    act(() => result.current.handleModeChange("music"));
    expect(result.current.prompt).toBe("speech draft");
  });
});
