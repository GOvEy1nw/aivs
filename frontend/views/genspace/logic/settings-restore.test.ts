import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUSIC_SETTINGS,
  type MusicSettings,
} from "../../../types/music";
import type { Asset, GenerationParams } from "../../../types/project";
import { DEFAULT_VIDEO_SETTINGS } from "../constants";
import { buildSfxGenerationCommand } from "./sfx-request";
import { buildSpeechGenerationCommand } from "./speech-request";
import { buildGenSpaceRestorePlan } from "./settings-restore";
import { compileVideoPrompt, createVideoSequenceDraft } from "./video-prompt-composer";

function asset(generationParams: GenerationParams): Asset {
  return {
    id: "generated",
    type:
      generationParams.mode === "text-to-music" ||
      generationParams.mode === "text-to-sfx" ||
      generationParams.mode === "text-to-speech"
        ? "audio"
        : "video",
    path: "C:\\generated.mp4",
    url: "file:///C:/generated.mp4",
    prompt: generationParams.prompt,
    resolution: generationParams.resolution,
    duration: generationParams.duration,
    createdAt: 1,
    generationParams,
  };
}

const musicSettings: MusicSettings = { ...DEFAULT_MUSIC_SETTINGS };

describe("GenSpace settings restoration", () => {
  it("restores Upscale into its owning Image or Video tool", () => {
    const source: Asset = { id: "source", type: "image", path: "D:\\project\\source.png", url: "file:///D:/project/source.png", prompt: "", resolution: "", createdAt: 1 };
    const imagePlan = buildGenSpaceRestorePlan(asset({
      mode: "upscale", prompt: "", model: "seedvr2", duration: 0, resolution: "", fps: 0, audio: false, cameraMotion: "none",
      upscale: { schemaVersion: 1, mediaKind: "image", method: "seedvr2", scale: 2, source: { url: "file:///C:/stale/source.png", path: source.path, type: "image" } },
    }), [source], DEFAULT_VIDEO_SETTINGS, musicSettings);
    expect(imagePlan).toMatchObject({ mode: "image", imageMode: "upscale", media: { upscaleSource: { url: source.url } } });

    const videoPlan = buildGenSpaceRestorePlan(asset({
      mode: "upscale", prompt: "", model: "ltx25", duration: 0, resolution: "", fps: 0, audio: false, cameraMotion: "none",
      upscale: { schemaVersion: 1, mediaKind: "video", method: "ltx25", scale: 2, source: { url: "file:///C:/source.mp4", path: "C:\\source.mp4", type: "video" } },
    }), [], DEFAULT_VIDEO_SETTINGS, musicSettings);
    expect(videoPlan).toMatchObject({ mode: "video", videoMode: "reframe", videoTool: "upscale" });
  });

  it("round-trips Speech settings and refreshes reference-voice lineage", () => {
    const voice: Asset = {
      id: "voice",
      type: "audio",
      path: "D:\\project\\voice.wav",
      url: "file:///D:/project/voice.wav",
      prompt: "",
      resolution: "",
      createdAt: 1,
    };
    const command = buildSpeechGenerationCommand("  Hello  ", {
      profileId: "index_tts2",
      seed: 7,
      references: [{
        assetId: voice.id,
        path: "C:\\stale\\voice.wav",
        url: "file:///C:/stale/voice.wav",
      }],
      segments: [],
    }, true);
    expect(command?.request).toEqual({
      modelProfileId: "index_tts2",
      text: "Hello",
      seed: 7,
      references: [{ path: "C:\\stale\\voice.wav" }],
      enhancePrompt: true,
    });
    expect(command?.recipe.schemaVersion).toBe(2);

    const plan = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-speech",
        prompt: command!.request.text,
        model: command!.request.modelProfileId,
        duration: 0,
        resolution: "",
        fps: 0,
        audio: true,
        cameraMotion: "none",
        speech: command!.recipe,
      }),
      [voice],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(plan).toMatchObject({
      mode: "music",
      prompt: "Hello",
      speechSettings: {
        profileId: "index_tts2",
        seed: 7,
        references: [{
          assetId: voice.id,
          path: voice.path,
          url: voice.url,
        }],
      },
    });
    expect(plan?.speechPromptEnhancement).toBe(true);
  });

  it("round-trips an SFX request recipe and refreshes source-video lineage", () => {
    const source: Asset = {
      id: "source-video",
      type: "video",
      path: "D:\\project\\source.mp4",
      url: "file:///D:/project/source.mp4",
      prompt: "",
      resolution: "1080p",
      createdAt: 1,
    };
    const command = buildSfxGenerationCommand("  thunder crack  ", {
      profileId: "mmaudio_sfx",
      negativePrompt: "voices",
      durationSeconds: 6,
      seed: 17,
      video: {
        assetId: source.id,
        path: "C:\\stale\\source.mp4",
        url: "file:///C:/stale/source.mp4",
        trimStartTime: 2,
        trimDuration: 6,
      },
    });

    expect(command?.request.video).toEqual({
      path: "C:\\stale\\source.mp4",
      trimStartTime: 2,
      trimDuration: 6,
    });
    const plan = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-sfx",
        prompt: command!.request.prompt,
        model: command!.request.modelProfileId,
        duration: command!.request.durationSeconds,
        resolution: "",
        fps: 0,
        audio: true,
        cameraMotion: "none",
        sfx: command!.recipe,
      }),
      [source],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(plan).toMatchObject({
      mode: "music",
      prompt: "thunder crack",
      sfxSettings: {
        profileId: "mmaudio_sfx",
        negativePrompt: "voices",
        durationSeconds: 6,
        seed: 17,
        video: {
          assetId: source.id,
          path: source.path,
          url: source.url,
          trimStartTime: 2,
          trimDuration: 6,
        },
      },
    });
  });

  it("recovers legacy media by project path and keeps guide trim fields", () => {
    const source: Asset = {
      id: "source",
      type: "video",
      path: "C:\\source.mp4",
      url: "file:///C:/source.mp4",
      prompt: "",
      resolution: "540p",
      createdAt: 1,
    };
    const plan = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-video",
        prompt: "animate",
        model: "fast",
        duration: 5,
        resolution: "540p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        imageInputMedia: [
          {
            url: "blob:stale",
            path: source.path,
            role: "control_video",
            type: "video",
            trimStartTime: 1,
            trimDuration: 3,
          },
        ],
      }),
      [source],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(plan?.mode).toBe("video");
    expect(plan?.media.imageInputs[0]).toMatchObject({
      url: source.url,
      role: "control_video",
      trimStartTime: 1,
      trimDuration: 3,
    });
  });

  it("restores Reframe and Music V2 domain settings", () => {
    const reframe = buildGenSpaceRestorePlan(
      asset({
        mode: "reframe",
        prompt: "extend",
        model: "fast",
        duration: 3,
        resolution: "720p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        reframeAspectMode: "9:16",
        reframePadding: { top: 1, bottom: 2, left: 3, right: 4 },
        reframeDuration: 3,
      }),
      [],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );
    const music = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-music",
        prompt: "song",
        model: "ace",
        duration: 20,
        resolution: "",
        fps: 0,
        audio: true,
        cameraMotion: "none",
        music: {
          schemaVersion: 2,
          profileId: "ace",
          experienceMode: "advanced",
          description: "song",
          instrumental: false,
          lyricsMode: "custom",
          lyricsPrompt: "midnight reunion",
          requestedLyrics: "lyrics",
          lyricsSeed: 123,
          enhanceDescription: false,
          durationMode: "manual",
          requestedDurationSeconds: 20,
          fallbackDurationSeconds: 60,
          vocalLanguage: "en",
          vocalGender: "female",
          weirdness: 50,
          promptInfluence: 75,
          variationCount: 2,
          audioInputs: [
            {
              role: "cover",
              url: "file:///C:/cover.wav",
              path: "C:\\cover.wav",
              coverStrength: 65,
            },
            {
              role: "reference-timbre",
              url: "file:///C:/voice.wav",
              path: "C:\\voice.wav",
            },
          ],
          effective: {
            modelMode: 0,
            temperature: 0.85,
            topP: 0.9,
            topK: 0,
            lmGuidanceScale: 2.5,
            audioTask: "",
            descriptionModifiers: [],
          },
        },
      }),
      [],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(reframe).toMatchObject({
      videoMode: "reframe",
      reframe: {
        aspectMode: "9:16",
        padding: { top: 1, bottom: 2, left: 3, right: 4 },
      },
    });
    expect(music?.musicSettings).toMatchObject({
      profileId: "ace",
      advancedLyricsMode: "custom",
      customLyrics: "lyrics",
      lyricsPrompt: "midnight reunion",
      lyricsSeedLocked: true,
      lyricsSeed: 123,
      manualDurationSeconds: 20,
      variations: 2,
      coverAudioInput: {
        role: "cover",
        path: "C:\\cover.wav",
      },
      referenceTimbreAudioInput: {
        role: "reference-timbre",
        path: "C:\\voice.wav",
      },
      coverStrength: 65,
    });
  });

  it("restores a curated Video Tool and its single source", () => {
    const source: Asset = {
      id: "source",
      type: "video",
      path: "C:\\source.mp4",
      url: "file:///C:/source.mp4",
      prompt: "",
      resolution: "540p",
      createdAt: 1,
    };
    const plan = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-video",
        prompt: "relight at sunset",
        model: "fast",
        videoTool: "relight",
        duration: 5,
        resolution: "540p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        imageInputMedia: [
          {
            url: source.url,
            path: source.path,
            role: "control_video",
            type: "video",
          },
        ],
      }),
      [source],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(plan).toMatchObject({
      mode: "video",
      videoMode: "reframe",
      videoTool: "relight",
      prompt: "relight at sunset",
      media: {
        imageInputs: [],
        videoToolInput: { url: source.url, role: "control_video" },
      },
    });
  });

  it("normalizes legacy custom Image and Video Reframe recipes", () => {
    const legacyVideo = buildGenSpaceRestorePlan(
      asset({
        mode: "reframe",
        prompt: "extend",
        model: "fast",
        duration: 3,
        resolution: "720p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        reframeAspectMode: "custom",
        reframePadding: { top: 12, bottom: 12, left: 30, right: 30 },
      }),
      [],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );
    const legacyImage = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-image",
        prompt: "extend",
        model: "fast",
        duration: 5,
        resolution: "720p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        imageEditOutpaint: {
          aspectMode: "custom",
          padding: { top: 12, bottom: 12, left: 30, right: 30 },
        },
      }),
      [],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(legacyVideo?.reframe).toMatchObject({
      aspectMode: "16:9",
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    expect(legacyImage?.editOutpaint).toEqual({
      aspectMode: "16:9",
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  });

  it("restores Ideogram assets into Region mode with their JSON prompt", () => {
    const prompt =
      '{"high_level_description":"Poster","compositional_deconstruction":{"background":"","elements":[{"type":"obj","bbox":[100,200,800,700],"desc":"Robot"}]}}';
    const plan = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-image",
        prompt,
        model: "fast",
        duration: 5,
        resolution: "1080p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        imageProfileId: "ideogram4_int8",
        imageAspectRatio: "16:9",
      }),
      [],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(plan).toMatchObject({
      mode: "image",
      imageMode: "region",
      prompt,
      settings: {
        imageProfileId: "ideogram4_int8",
        imageAspectRatio: "16:9",
      },
    });
  });

  it("restores Image Edit master, references, mask, and outpaint", () => {
    const master: Asset = {
      id: "master",
      type: "image",
      path: "C:\\master.png",
      url: "file:///C:/master.png",
      prompt: "",
      resolution: "720p",
      createdAt: 1,
    };
    const plan = buildGenSpaceRestorePlan(
      asset({
        mode: "text-to-image",
        prompt: "replace the sky",
        model: "flux2_klein_4b",
        duration: 5,
        resolution: "720p",
        fps: 24,
        audio: false,
        cameraMotion: "none",
        imageProfileId: "flux2_klein_4b",
        imageProcessMode: "edit",
        imageInputMedia: [
          {
            url: "blob:stale",
            path: master.path,
            role: "edit_image",
            type: "image",
          },
          {
            url: "file:///C:/reference.png",
            role: "reference_people_objects",
            type: "image",
          },
        ],
        imageEditMask: {
          schemaVersion: 1,
          operations: [
            {
              kind: "ellipse",
              x: 0.2,
              y: 0.2,
              width: 0.4,
              height: 0.4,
            },
          ],
        },
        imageEditOutpaint: {
          aspectMode: "16:9",
          padding: { top: 0, bottom: 0, left: 25, right: 25 },
        },
      }),
      [master],
      DEFAULT_VIDEO_SETTINGS,
      musicSettings,
    );

    expect(plan).toMatchObject({
      mode: "image",
      imageMode: "edit",
      editToolMode: "retouch",
      media: {
        editImage: {
          url: master.url,
          role: "edit_image",
        },
        imageInputs: [{ role: "reference_people_objects" }],
      },
      editMask: { operations: [{ kind: "ellipse" }] },
      editOutpaint: {
        aspectMode: "16:9",
        padding: { left: 25, right: 25 },
      },
    });
  });

  it("keeps composer-staged reference media out of restored inputs before recompiling", () => {
    const bethVoice = { type: "audio" as const, path: "C:\\project\\generated\\beth.wav", url: "file:///C:/project/generated/beth.wav", fileName: "beth.wav" };
    const samVoice = { type: "audio" as const, path: "C:\\project\\generated\\sam.wav", url: "file:///C:/project/generated/sam.wav", fileName: "sam.wav" };
    const snapshots = [
      { id: "beth", token: "@beth", kind: "cast" as const, name: "Beth", visualDescription: "", voiceDescription: "", fidelity: "exact" as const, voiceReference: bethVoice },
      { id: "sam", token: "@sam", kind: "cast" as const, name: "Sam", visualDescription: "", voiceDescription: "", fidelity: "exact" as const, voiceReference: samVoice },
    ];
    const composer = {
      schemaVersion: 1 as const, mode: "simple" as const, sequence: createVideoSequenceDraft(),
      authoredBrief: '@beth_dialogue "Hi" @sam_dialogue "Hello"', compiledPrompt: "compiled", resolvedDurationSeconds: 5,
      referencedEntities: snapshots,
    };
    const plan = buildGenSpaceRestorePlan(asset({
      mode: "text-to-video", prompt: "compiled", model: "pro", duration: 5, resolution: "540p", fps: 24, audio: true, cameraMotion: "none",
      imageInputMedia: [
        { url: "file:///C:/project/control.mp4", path: "C:\\project\\control.mp4", role: "control_video", type: "video" },
        { url: bethVoice.url, path: bethVoice.path, role: "reference_audio", type: "audio", alias: "@audio1" },
        { url: samVoice.url, path: samVoice.path, role: "reference_audio", type: "audio", alias: "@audio2" },
      ],
      videoComposer: composer,
    }), [], DEFAULT_VIDEO_SETTINGS, musicSettings)!;

    expect(plan.media.imageInputs.map((input) => input.role)).toEqual(["control_video"]);
    const compiled = compileVideoPrompt({
      brief: '@beth_dialogue "Hi" @sam_dialogue "Hello"',
      composer: { schemaVersion: 1, mode: "simple", sequence: createVideoSequenceDraft(), referencedEntities: snapshots },
      entities: [],
      fallbackSnapshots: snapshots,
      policy: { promptFormat: "plain", entityMediaMode: "inline-reference", voiceReference: true },
      retainedRoles: plan.media.imageInputs.map((input) => input.role),
    });
    expect(compiled.ok).toBe(false);
    expect(compiled.error).toMatch(/no verified speaker-to-audio binding/);
    expect(composer.referencedEntities.map((entity) => entity.voiceReference.path)).toEqual([bethVoice.path, samVoice.path]);
  });
});
