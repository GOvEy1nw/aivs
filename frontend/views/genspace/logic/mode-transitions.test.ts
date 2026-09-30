import { describe, expect, it } from "vitest";
import {
  transitionGenSpaceMode,
  transitionVideoProcessMode,
} from "./mode-transitions";

describe("GenSpace mode transitions", () => {
  it("keeps only image inputs when leaving Video for Image", () => {
    const transition = transitionGenSpaceMode("image", "reframe", [
      { id: "image", url: "image", role: "start_image", type: "image" },
      { id: "video", url: "video", role: "control_video", type: "video" },
    ]);

    expect(transition.videoMode).toBe("generate");
    expect(transition.imageInputs.map((item) => item.id)).toEqual(["image"]);
    expect(transition.clearInputAudio).toBe(true);
  });

  it("clears all media for Music", () => {
    const transition = transitionGenSpaceMode("music", "generate", [
      { id: "image", url: "image", role: "start_image" },
    ]);

    expect(transition.imageInputs).toEqual([]);
    expect(transition.clearInputImage).toBe(true);
  });

  it("rejects Retake and leaves prompt ownership to the mode state", () => {
    expect(transitionVideoProcessMode("retake")).toBeNull();
    expect(transitionVideoProcessMode("reframe")).toEqual({ mode: "reframe" });
  });
});
