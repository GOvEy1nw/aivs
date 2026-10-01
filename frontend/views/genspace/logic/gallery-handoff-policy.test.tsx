import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../../../types/model-profiles";
import {
  getGalleryHandoffDestinations,
  includesGalleryHandoffDestination,
  isGalleryHandoffDestinationCurrent,
} from "./gallery-handoff-policy";

const profile = {
  availability: "available",
  capabilities: { startImage: true, endImage: true, audioToVideo: true },
  inputMedia: {
    supportsImageInputs: true,
    maxImages: 4,
    maxReferenceVideos: 1,
    maxReferenceAudios: 1,
    roles: [
      { role: "audio_to_video" },
      { role: "reference_video" },
      { role: "reference_audio" },
    ],
  },
  videoAudio: { audioConditioning: true },
  videoEdits: { operations: [{ id: "reframe", status: "stable", handler: "video_generation" }] },
} as ModelProfile;

describe("gallery handoff policy", () => {
  it("uses the selected profile and current capacity to expose only supported audio targets", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "audio" },
      imageProfile: undefined,
      videoProfile: profile,
      speechProfile: undefined,
      inputs: [{ id: "used", url: "file:///used.wav", role: "reference_audio", type: "audio" }],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets.map(({ target }) => target)).toEqual([
      "audio-guide",
      "audio-guide",
    ]);
    expect(targets.map(({ label }) => label)).toEqual([
      "Audio guide",
      "Audio guide excerpt…",
    ]);
  });

  it("keeps a supported video reference and its excerpt path together", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "video" },
      imageProfile: undefined,
      videoProfile: profile,
      speechProfile: undefined,
      inputs: [],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets.map(({ target, useExcerpt }) => [target, useExcerpt])).toEqual([
      ["video-reference", false],
      ["video-reference", true],
      ["video-tool:reframe", false],
    ]);
  });

  it("does not offer an audio guide when any guide slot is occupied", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "audio" },
      imageProfile: undefined,
      videoProfile: {
        ...profile,
        inputMedia: {
          ...profile.inputMedia,
          roles: [{ role: "audio_guide", label: "Audio guide", description: "", kind: "control" }],
        },
      },
      speechProfile: undefined,
      inputs: [{ id: "motion", url: "file:///motion.mp4", role: "human_motion", type: "video" }],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets.some(({ target }) => target === "audio-guide")).toBe(false);
  });

  it("does not offer an H3 audio guide alongside manual reference media", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "audio" },
      imageProfile: undefined,
      videoProfile: {
        ...profile,
        id: "minimax_h3_quality",
        inputMedia: {
          ...profile.inputMedia,
          roles: [{ role: "audio_guide", label: "Audio guide", description: "", kind: "control" }],
        },
      },
      speechProfile: undefined,
      inputs: [{ id: "image", url: "file:///reference.png", role: "reference_image", type: "image" }],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets.some(({ target }) => target === "audio-guide")).toBe(false);
  });

  it("offers the existing LTX motion-guide role as a full video only", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "video" },
      imageProfile: undefined,
      videoProfile: {
        ...profile,
        inputMedia: {
          ...profile.inputMedia,
          roles: [{ role: "human_motion", label: "Motion guide", description: "", kind: "control" }],
        },
      },
      speechProfile: undefined,
      inputs: [],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets).toContainEqual(
      expect.objectContaining({ target: "video-guide", useExcerpt: false }),
    );
  });

  it("does not offer a motion guide while another guide occupies the slot", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "video" },
      imageProfile: undefined,
      videoProfile: {
        ...profile,
        inputMedia: {
          ...profile.inputMedia,
          roles: [{ role: "human_motion", label: "Motion guide", description: "", kind: "control" }],
        },
      },
      speechProfile: undefined,
      inputs: [{ id: "guide", url: "file:///guide.wav", role: "audio_to_video", type: "audio" }],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets.some(({ target }) => target === "video-guide")).toBe(false);
  });

  it("offers H3 audio references as full clips only", () => {
    const targets = getGalleryHandoffDestinations({
      asset: { type: "audio" },
      imageProfile: undefined,
      videoProfile: { ...profile, id: "minimax_h3_fast" },
      speechProfile: undefined,
      inputs: [],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });

    expect(targets.filter(({ target }) => target === "audio-reference")).toEqual([
      expect.objectContaining({ useExcerpt: false }),
    ]);
  });

  it("rejects a captured reference target when its capacity fills before confirmation", () => {
    const captured = getGalleryHandoffDestinations({
      asset: { type: "video" },
      imageProfile: undefined,
      videoProfile: profile,
      speechProfile: undefined,
      inputs: [],
      speechReferenceCount: 0,
      hasEditProfile: false,
    }).find(({ target, useExcerpt }) => target === "video-reference" && useExcerpt);

    expect(captured).toBeDefined();
    const currentDestinations = getGalleryHandoffDestinations({
      asset: { type: "video" },
      imageProfile: undefined,
      videoProfile: profile,
      speechProfile: undefined,
      inputs: [{ id: "used", url: "file:///used.mp4", role: "reference_video", type: "video" }],
      speechReferenceCount: 0,
      hasEditProfile: false,
    });
    expect(includesGalleryHandoffDestination(currentDestinations, captured!)).toBe(false);
  });

  it("rejects an excerpt result when its target project or selected profile changed", () => {
    const captured = {
      projectId: "project-a",
      mode: "video",
      imageProfileId: "image-a",
      videoProfileId: "video-a",
      speechProfileId: "speech-a",
    };

    expect(isGalleryHandoffDestinationCurrent(captured, captured)).toBe(true);
    expect(isGalleryHandoffDestinationCurrent(captured, {
      ...captured,
      videoProfileId: "video-b",
    })).toBe(false);
  });
});
