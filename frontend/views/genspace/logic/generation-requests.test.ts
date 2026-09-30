import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../../../types/model-profiles";
import { DEFAULT_MUSIC_SETTINGS } from "../../../types/music";
import { DEFAULT_VIDEO_SETTINGS } from "../constants";
import {
  buildImageGenerationCommand,
  buildMusicGenerationCommand,
  buildReframeGenerationCommand,
  buildRetakeGenerationCommand,
  buildVideoGenerationCommand,
  buildVideoToolGenerationCommand,
} from "./generation-requests";

const musicProfile = {
  id: "ace",
  music: {
    autoDurationFallbackSeconds: 60,
    supportsCover: true,
    supportsReferenceTimbre: true,
    supportsCustomLyrics: true,
  },
  wangpMetadata: { settingValues: {} },
} as ModelProfile;

describe("GenSpace generation request builders", () => {
  it("builds image input roles without changing settings", () => {
    const command = buildImageGenerationCommand(
      "prompt",
      DEFAULT_VIDEO_SETTINGS,
      [
        {
          id: "reference",
          url: "file:///C:/reference.png",
          role: "reference_image",
          type: "image",
          crop: {
            aspectRatio: "1:1",
            x: 0.25,
            y: 0,
            width: 0.5,
            height: 1,
          },
        },
      ],
      true,
    );

    expect(command.settings.imageProfileId).toBe("z_image_turbo");
    expect(command.settings.enhancePrompt).toBe(true);
    expect(command.inputMedia[0]?.role).toBe("reference_image");
    expect(command.inputMedia[0]?.crop).toMatchObject({
      aspectRatio: "1:1",
      x: 0.25,
      width: 0.5,
    });
  });

  it("keeps Edit Image separate from reference inputs", () => {
    const command = buildImageGenerationCommand(
      "replace the window",
      DEFAULT_VIDEO_SETTINGS,
      [
        {
          id: "reference",
          url: "file:///C:/reference.png",
          role: "reference_people_objects",
          type: "image",
        },
      ],
      true,
      {
        image: {
          id: "master",
          url: "file:///C:/master.png",
          role: "edit_image",
          type: "image",
        },
        mask: {
          schemaVersion: 1,
          operations: [
            {
              kind: "ellipse",
              x: 0.25,
              y: 0.25,
              width: 0.5,
              height: 0.5,
            },
          ],
        },
        outpaint: {
          aspectMode: "16:9",
          padding: { top: 0, bottom: 0, left: 40, right: 40 },
        },
      },
    );

    expect(command.edit).toMatchObject({
      image: { path: "C:/master.png" },
      mask: { operations: [{ kind: "ellipse" }] },
      outpaint: { aspectMode: "16:9" },
    });
    expect(command.inputMedia).toEqual([
      {
        path: "C:/reference.png",
        role: "reference_people_objects",
        type: "image",
      },
    ]);
    expect(command.settings.imageAspectRatio).toBe("16:9");
  });

  it("keeps a valid resolution-budget aspect for custom Image Reframe", () => {
    const command = buildImageGenerationCommand(
      "extend the scene",
      DEFAULT_VIDEO_SETTINGS,
      [],
      false,
      {
        image: {
          id: "master",
          url: "file:///C:/master.png",
          role: "edit_image",
          type: "image",
        },
        mask: null,
        outpaint: {
          aspectMode: "custom",
          padding: { top: 10, bottom: 10, left: 30, right: 30 },
        },
      },
    );

    expect(command.settings.imageAspectRatio).toBe("1:1");
    expect(command.edit?.outpaint?.aspectMode).toBe("custom");
  });

  it("uses trimmed guide duration and Pro mode for guide audio", () => {
    const command = buildVideoGenerationCommand({
      prompt: "prompt",
      settings: DEFAULT_VIDEO_SETTINGS,
      imageInputs: [
        {
          id: "guide",
          url: "file:///C:/guide.wav",
          role: "audio_guide",
          type: "audio",
          trimStartTime: 1,
          trimDuration: 6.2,
        },
      ],
      inputImage: null,
      inputAudio: null,
      useAudioTrack: true,
      enhancePrompt: true,
    });

    expect(command.normalizedSettings.duration).toBe(7);
    expect(command.settings.model).toBe("pro");
    expect(command.settings.enhancePrompt).toBe(true);
    expect(command.inputMedia[0]?.trimStartTime).toBe(1);
  });

  it("uses the existing blank-prompt fallback for Reframe", () => {
    const command = buildReframeGenerationCommand(
      " ",
      DEFAULT_VIDEO_SETTINGS,
      {
        videoUrl: "file:///C:/clip.mp4",
        videoPath: "C:\\clip.mp4",
        startTime: 1,
        duration: 2.2,
        videoDuration: 5,
        videoWidth: 1920,
        videoHeight: 1080,
        aspectMode: "16:9",
        padding: { top: 0, bottom: 0, left: 10, right: 10 },
        ready: true,
      },
      true,
    );

    expect(command?.prompt).toBe("outpaint");
    expect(command?.settings.duration).toBe(3);
    expect(command?.settings.enhancePrompt).toBe(true);
    expect(command?.reframe.controlVideoStartTime).toBe(1);
  });

  it("keeps a stable H3 media alias in the submitted input", () => {
    const command = buildVideoGenerationCommand({
      prompt: "Use @image4",
      settings: { ...DEFAULT_VIDEO_SETTINGS, videoProfileId: "minimax_h3_quality" },
      imageInputs: [{
        id: "ref", url: "file:///C:/ref.png", role: "reference_image", type: "image", alias: "@image4",
      }],
      inputImage: null,
      inputAudio: null,
      useAudioTrack: true,
      enhancePrompt: false,
    });

    expect(command.inputMedia).toEqual([{
      path: "C:/ref.png", role: "reference_image", type: "image", alias: "@image4",
    }]);
  });

  it("omits the retained disabled H3 video from the submitted request", () => {
    const command = buildVideoGenerationCommand({
      prompt: "Use @video1",
      settings: { ...DEFAULT_VIDEO_SETTINGS, videoProfileId: "minimax_h3_quality" },
      imageInputs: [
        { id: "video", url: "file:///C:/video.mp4", role: "reference_video", type: "video", alias: "@video1" },
        { id: "depth", url: "file:///C:/depth.mp4", role: "depth", type: "video", alias: "@video2" },
      ],
      inputImage: null,
      inputAudio: null,
      useAudioTrack: false,
      enhancePrompt: false,
    });

    expect(command.inputMedia).toEqual([
      expect.objectContaining({ path: "C:/depth.mp4", role: "depth", alias: "@video2" }),
    ]);
  });

  it.each([
    ["extend", "continue_video", 12, false],
    ["relight", "control_video", 5, true],
  ] as const)(
    "builds %s with one video input and the correct duration contract",
    (tool, role, expectedDuration, persistNormalizedSettings) => {
      const command = buildVideoToolGenerationCommand({
        tool,
        prompt: "Improve this clip",
        settings: { ...DEFAULT_VIDEO_SETTINGS, duration: 12 },
        input: {
          id: "source",
          url: "app-media://clip.mp4",
          path: "C:/clip.mp4",
          role,
          type: "video",
          trimStartTime: 1,
          trimDuration: 4.2,
        },
        enhancePrompt: true,
      });

      expect(command?.videoTool).toBe(tool);
      expect(command?.inputMedia).toEqual([
        expect.objectContaining({
          path: "C:/clip.mp4",
          role,
          type: "video",
          trimDuration: 4.2,
        }),
      ]);
      expect(command?.settings.duration).toBe(expectedDuration);
      expect(command?.normalizedSettings.duration).toBe(expectedDuration);
      expect(command?.persistNormalizedSettings).toBe(
        persistNormalizedSettings,
      );
      expect(command?.settings.enhancePrompt).toBe(true);
    },
  );

  it("keeps Retake blocked while its availability gate is disabled", () => {
    expect(
      buildRetakeGenerationCommand("replace this", {
        videoPath: "C:/input.mp4",
        startTime: 1,
        duration: 3,
      }),
    ).toBeNull();
  });

  it.each([
    {
      name: "instrumental",
      settings: { ...DEFAULT_MUSIC_SETTINGS, instrumental: true },
      vocalMode: "instrumental",
      lyrics: undefined,
    },
    {
      name: "auto lyrics",
      settings: { ...DEFAULT_MUSIC_SETTINGS, instrumental: false },
      vocalMode: "auto-lyrics",
      lyrics: undefined,
    },
    {
      name: "custom lyrics",
      settings: {
        ...DEFAULT_MUSIC_SETTINGS,
        instrumental: false,
        advancedLyricsMode: "custom" as const,
        customLyrics: "Sing this",
      },
      vocalMode: "custom-lyrics",
      lyrics: "Sing this",
    },
  ])("builds $name music commands", ({ settings, vocalMode, lyrics }) => {
    const command = buildMusicGenerationCommand(
      "  cinematic song  ",
      settings,
      musicProfile,
    );

    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.prompt).toBe("cinematic song");
    expect(command.request.vocalMode).toBe(vocalMode);
    expect(command.request.lyrics).toBe(lyrics);
  });

  it("requires Compose Lyrics to populate custom lyrics before generation", () => {
    const command = buildMusicGenerationCommand(
      "song",
      {
        ...DEFAULT_MUSIC_SETTINGS,
        advancedLyricsMode: "custom",
        customLyrics: " ",
        lyricsPrompt: "a midnight reunion",
        composeWithThinking: true,
        lyricsSeedLocked: true,
        lyricsSeed: 123,
      },
      musicProfile,
    );

    expect(command).toEqual({
      ok: false,
      message: "Write or compose lyrics before generating.",
    });
  });

  it("maps Cover Song and Transfer Timbre independently", () => {
    const command = buildMusicGenerationCommand(
      "song",
      {
        ...DEFAULT_MUSIC_SETTINGS,
        advancedLyricsMode: "custom",
        customLyrics: "Original lyrics",
        coverAudioInput: {
          url: "file:///C:/cover.wav",
          role: "cover",
        },
        referenceTimbreAudioInput: {
          url: "file:///C:/voice.wav",
          role: "reference-timbre",
        },
        coverStrength: 70,
      },
      musicProfile,
    );

    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.request.audioInputs).toMatchObject([
      { path: "C:/cover.wav", role: "cover", strength: 0.7 },
      { path: "C:/voice.wav", role: "reference-timbre" },
    ]);
  });

  it("requires original custom lyrics for a vocal cover", () => {
    const command = buildMusicGenerationCommand(
      "song",
      {
        ...DEFAULT_MUSIC_SETTINGS,
        coverAudioInput: {
          url: "file:///C:/cover.wav",
          role: "cover",
        },
      },
      musicProfile,
    );

    expect(command).toEqual({
      ok: false,
      message: "Cover Song needs the original custom lyrics.",
    });
  });
});
