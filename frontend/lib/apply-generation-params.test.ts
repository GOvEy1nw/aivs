import { describe, expect, it } from "vitest";
import type { GenerationParams } from "../types/project";
import {
  buildImageInputsFromParams,
  settingsPatchFromGenerationParams,
} from "./apply-generation-params";
import { DEFAULT_VIDEO_SETTINGS } from "../views/genspace/constants";

describe("generation parameter media restore", () => {
  it("restores crop recipes without changing stored source media", () => {
    const params: GenerationParams = {
      mode: "image-to-video",
      prompt: "animate",
      model: "fast",
      duration: 5,
      resolution: "540p",
      fps: 24,
      audio: false,
      cameraMotion: "none",
      imageInputMedia: [
        {
          url: "file:///C:/source.png",
          role: "start_image",
          type: "image",
          crop: {
            aspectRatio: "3:4",
            x: 0.25,
            y: 0,
            width: 0.5,
            height: 1,
          },
        },
      ],
    };

    expect(buildImageInputsFromParams(params)).toMatchObject([
      {
        url: "file:///C:/source.png",
        role: "start_image",
        crop: {
          aspectRatio: "3:4",
          x: 0.25,
          y: 0,
          width: 0.5,
          height: 1,
        },
      },
    ]);
  });
});

describe("generation parameter settings restore", () => {
  it("keeps visual timing after speech metadata and ignores malformed legacy video timing", () => {
    const current = { ...DEFAULT_VIDEO_SETTINGS, fps: 24, duration: 5 };
    const speech: GenerationParams = {
      mode: "text-to-speech",
      prompt: "hello",
      model: "indextts2",
      duration: 0,
      resolution: "",
      fps: 0,
      audio: true,
      cameraMotion: "none",
    };
    const malformedVideo: GenerationParams = {
      ...speech,
      mode: "text-to-video",
      model: "fast",
      duration: 0,
      fps: 0,
    };

    expect(settingsPatchFromGenerationParams(speech, current)).toEqual(current);
    expect(settingsPatchFromGenerationParams(malformedVideo, current)).toMatchObject({
      duration: 5,
      fps: 24,
    });
  });
});
