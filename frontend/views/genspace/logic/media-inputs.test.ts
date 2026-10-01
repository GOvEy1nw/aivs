import { describe, expect, it } from "vitest";
import type { ModelProfileInputMedia } from "../../../types/model-profiles";
import type { GenSpaceMediaInput } from "../types";
import { VIDEO_GUIDE_ROLE_OPTIONS } from "../constants";
import {
  findGuideInput,
  getAudioGuideRole,
  getH3ReferenceAvailability,
  getH3ReferenceState,
  getH3PromptAliases,
  isImageAspectRatioLocked,
  isVideoAspectRatioLocked,
  inferMediaKindForRole,
  isSequenceFreeReferenceRole,
  normalizeImageInputsForProfile,
  normalizeVideoInputsForProfile,
  removeSequenceFreeReferences,
  replaceGuideInput,
  nextH3MediaAlias,
} from "./media-inputs";

const policy: ModelProfileInputMedia = {
  supportsImageInputs: true,
  tooltipLabel: "Images",
  maxImages: 2,
  defaultRole: "subject",
  roles: [
    { role: "subject", label: "Subject", description: "", kind: "reference" },
    { role: "style", label: "Style", description: "", kind: "reference" },
  ],
};

const input = (
  id: string,
  role: string,
  type?: GenSpaceMediaInput["type"],
): GenSpaceMediaInput => ({ id, role, type, url: `file:///${id}` });

describe("GenSpace media input logic", () => {

  it("removes only free Sequence references and keeps frame/task inputs", () => {
    const inputs = [
      input("reference", "reference_image", "image"), input("depth", "depth", "video"), input("motion", "human_motion", "video"), input("audio", "audio_to_video", "audio"),
      input("start", "start_image", "image"), input("end", "end_image", "image"), input("control", "control_video", "video"), input("continue", "continue_video", "video"), input("audio-control", "control_audio", "audio"),
    ];
    expect(inputs.filter((item) => isSequenceFreeReferenceRole(item.role)).map((item) => item.id)).toEqual(["reference", "depth", "motion", "audio"]);
    expect(removeSequenceFreeReferences(inputs).map((item) => item.id)).toEqual(["start", "end", "control", "continue", "audio-control"]);
  });
  it("clamps image inputs and falls back to the profile default role", () => {
    expect(
      normalizeImageInputsForProfile(
        [
          input("a", "unknown"),
          input("b", "style"),
          input("c", "subject"),
          input("d", "subject", "audio"),
        ],
        policy,
      ),
    ).toEqual([input("a", "subject"), input("b", "style")]);
  });

  it("keeps one start, one end, and one guide with trim metadata", () => {
    const guide = {
      ...input("guide", "human_motion", "video"),
      trimStartTime: 2,
      trimDuration: 4,
    };
    expect(
      normalizeVideoInputsForProfile(
        [
          input("start-a", "start_image"),
          input("start-b", "start_image"),
          input("end", "end_image"),
          guide,
          input("guide-b", "depth", "video"),
        ],
        true,
      ),
    ).toEqual([input("start-a", "start_image"), input("end", "end_image"), guide]);
  });

  it("reserves removed H3 aliases still referenced by the prompt", () => {
    expect(getH3PromptAliases("Keep @image2 with @audio1.")).toEqual([
      "@image2",
      "@audio1",
    ]);
    expect(nextH3MediaAlias([], ["@image2"], "image")).toBe("@image3");
  });

  it("keeps H3 reference capacity and audio balance available only when valid", () => {
    expect(getH3ReferenceAvailability([])).toEqual({ image: true, video: true, audio: false });
    expect(getH3ReferenceAvailability([input("image", "reference_image", "image")])).toMatchObject({ audio: true });
    expect(getH3ReferenceAvailability([input("start", "start_image", "image")])).toEqual({ image: true, video: false, audio: false });
    expect(getH3ReferenceAvailability([input("end", "end_image", "image")])).toEqual({ image: true, video: true, audio: false });
    expect(getH3ReferenceState([input("video", "reference_video", "video")]).hasReferenceVideo).toBe(true);
    expect(getH3ReferenceAvailability([input("control", "control_video", "video")])).toEqual({ image: false, video: false, audio: false });
  });

  it("uses the selected profile's supported audio guide role", () => {
    expect(getAudioGuideRole({ roles: [{ role: "audio_guide" }] } as ModelProfileInputMedia)).toBe("audio_guide");
    expect(getAudioGuideRole({ roles: [{ role: "audio_to_video" }] } as ModelProfileInputMedia)).toBe("audio_to_video");
    expect(getAudioGuideRole({ supportsImageInputs: false, tooltipLabel: "", maxImages: 0, defaultRole: "", roles: [] })).toBeUndefined();
  });

  it("allows three H3 video and audio references within their separate caps", () => {
    const videos = ["one", "two", "three"].map((id) => input(id, "reference_video", "video"));
    const state = getH3ReferenceState([
      input("image", "reference_image", "image"),
      ...videos,
      input("audio-one", "reference_audio", "audio"),
      input("audio-two", "reference_audio", "audio"),
      input("audio-three", "reference_audio", "audio"),
    ]);

    expect(state).toMatchObject({ videoCount: 3, audioCount: 3, totalCount: 7 });
    expect(state.availability).toMatchObject({ video: false, audio: false });
  });

  it("retains a second video as disabled when depth is active and counts soundtracks as audio", () => {
    const first = { ...input("first", "reference_video", "video"), useAudioTrack: true };
    const depth = { ...input("depth", "depth", "video"), useAudioTrack: true };
    const state = getH3ReferenceState([first, depth]);

    expect([...state.disabledVideoIds]).toEqual(["first"]);
    expect(state.activeInputs).toEqual([depth]);
    expect(state.videoCount).toBe(1);
    expect(state.audioCount).toBe(1);
    expect(state.totalCount).toBe(1);
    expect(state.availability.video).toBe(false);
    expect(state.availability.audio).toBe(false);
  });

  it("replaces only the guide slot", () => {
    const next = input("next", "audio_to_video", "audio");
    const result = replaceGuideInput(
      [input("start", "start_image"), input("old", "depth", "video")],
      next,
    );
    expect(result).toEqual([input("start", "start_image"), next]);
    expect(findGuideInput(result)).toEqual(next);
  });

  it("infers audio, video, and image role kinds", () => {
    expect(inferMediaKindForRole("audio_to_video")).toBe("audio");
    expect(inferMediaKindForRole("continue_video")).toBe("video");
    expect(inferMediaKindForRole("start_image")).toBe("image");
  });

  it("locks image aspect only to Edit source images except Reframe", () => {
    const reference = input("reference", "reference_subject", "image");

    expect(isImageAspectRatioLocked("create", "edit", [], false)).toBe(false);
    expect(
      isImageAspectRatioLocked("create", "edit", [reference], false),
    ).toBe(false);
    expect(isImageAspectRatioLocked("edit", "edit", [], true)).toBe(true);
    expect(isImageAspectRatioLocked("edit", "retouch", [], true)).toBe(true);
    expect(
      isImageAspectRatioLocked("edit", "edit", [reference], false),
    ).toBe(false);
    expect(
      isImageAspectRatioLocked("edit", "reframe", [reference], true),
    ).toBe(false);
    expect(
      isImageAspectRatioLocked("region", "edit", [reference], true),
    ).toBe(false);
  });

  it("locks video aspect only to start/end frames, not other references", () => {
    const audio = input("audio", "audio_to_video", "audio");
    const video = input("video", "continue_video", "video");
    const reference = input("reference", "reference_image", "image");

    expect(isVideoAspectRatioLocked("generate", [], false)).toBe(false);
    expect(isVideoAspectRatioLocked("generate", [audio], false)).toBe(false);
    expect(isVideoAspectRatioLocked("generate", [video], false)).toBe(false);
    expect(isVideoAspectRatioLocked("generate", [reference], false)).toBe(false);
    expect(
      isVideoAspectRatioLocked(
        "generate",
        [input("legacy-image", "start_image")],
        false,
      ),
    ).toBe(true);
    expect(
      isVideoAspectRatioLocked(
        "generate",
        [input("end-frame", "end_image")],
        false,
      ),
    ).toBe(true);
    expect(isVideoAspectRatioLocked("generate", [], true)).toBe(true);
    expect(isVideoAspectRatioLocked("reframe", [video], true)).toBe(false);
  });

  it("keeps Video Tools-only roles out of standard media input choices", () => {
    const labels = VIDEO_GUIDE_ROLE_OPTIONS.map(({ label }) => label);

    expect(labels).not.toContain("Convert SDR to HDR");
    expect(labels).not.toContain("Continue Video");
  });
});
