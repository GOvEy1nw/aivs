import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UseGenerationReturn } from "../../../hooks/use-generation";
import { QueueAdmissionRejectedError } from "../../../contexts/GenerationQueueContext";
import type { ImageEditToolMode } from "../../../types/image-edit";
import type { ModelProfile } from "../../../types/model-profiles";
import type { ReferenceEntity } from "../../../../shared/reference-library";
import { DEFAULT_MUSIC_SETTINGS } from "../../../types/music";
import { DEFAULT_VIDEO_SETTINGS } from "../constants";
import {
  createEmptyRegionPrompt,
  serializeRegionPrompt,
} from "../image/region-prompt";
import { useGenSpaceGenerationActions } from "./useGenSpaceGenerationActions";
import { backendFetch } from "../../../lib/backend";
import { stageEntityInputs } from "../logic/reference-entity-staging";

vi.mock("../../../lib/backend", () => ({ backendFetch: vi.fn() }));
vi.mock("../logic/reference-entity-staging", async () => ({
  ...(await vi.importActual<typeof import("../logic/reference-entity-staging")>("../logic/reference-entity-staging")),
  stageEntityInputs: vi.fn(),
}));

const framingSettings = {
  camera: "ARRI Alexa 35",
  lens: "Premium Spherical Prime",
  focalLength: "35mm",
  aperture: "f/2.8",
  shutter: "1/50s",
  iso: "ISO 800",
};

describe("useGenSpaceGenerationActions", () => {
  it("sends authored image prompts with native enhancement enabled", async () => {
    const generateImage: UseGenerationReturn["generateImage"] = vi.fn(
      async () => undefined,
    );

    const { result } = renderHook(() =>
      useGenSpaceGenerationActions({
        mode: "image",
        imageMode: "create",
        regionPrompt: createEmptyRegionPrompt(),
        videoMode: "generate",
        prompt: "user prompt",
        framingSettings,
        promptEnhancementEnabled: true,
        currentProjectId: "project-a",
        projectAssets: [],
        settings: { ...DEFAULT_VIDEO_SETTINGS },
        setSettings: vi.fn(),
        musicSettings: DEFAULT_MUSIC_SETTINGS,
        musicProfiles: [],
        imageInputs: [],
        inputImage: null,
        inputAudio: null,
        useAudioTrack: false,
        reframeInput: {
          videoUrl: null,
          videoPath: null,
          startTime: 0,
          duration: 0,
          videoDuration: 0,
          videoWidth: 0,
          videoHeight: 0,
          aspectMode: "16:9",
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          ready: false,
        },
        retakeInput: {
          videoPath: null,
          startTime: 0,
          duration: 0,
          videoDuration: 0,
        },
        setLocalError: vi.fn(),
        generate: vi.fn(async () => undefined),
        generateImage,
        generateMusic: vi.fn(async () => null),
        submitRetake: vi.fn(async () => undefined),
      }),
    );

    await act(() => result.current.submit());

    const effectivePrompt =
      "Shot on ARRI Alexa 35, Premium Spherical Prime, 35mm, f/2.8, 1/50s, ISO 800. user prompt";
    expect(generateImage).toHaveBeenCalledWith(
      effectivePrompt,
      expect.objectContaining({ enhancePrompt: true }),
      [],
      undefined,
      { kind: "image-output", snapshot: expect.objectContaining({ prompt: effectivePrompt }) },
    );
    vi.mocked(backendFetch).mockResolvedValue(new Response(JSON.stringify({ prompt: "Reviewed effective prompt" })));
    await act(() => result.current.enhancement.enhance());
    act(() => result.current.enhancement.review.apply());
    await act(() => result.current.submit());
    expect(generateImage).toHaveBeenLastCalledWith(
      "Reviewed effective prompt", expect.objectContaining({ enhancePrompt: false }), [], undefined,
      { kind: "image-output", snapshot: expect.objectContaining({
        promptEnhancement: { originalPrompt: "user prompt", effectivePrompt: "Reviewed effective prompt" },
      }) },
    );
  });

  it("serializes Region layout without generic prompt enhancement or framing", async () => {
    const generateImage: UseGenerationReturn["generateImage"] = vi.fn(
      async () => undefined,
    );
    const regionPrompt = {
      ...createEmptyRegionPrompt(),
      highLevelDescription: "A poster with one central subject.",
      elements: [
        {
          id: "subject",
          type: "obj" as const,
          bbox: [100, 200, 800, 700] as [number, number, number, number],
          description: "A silver robot.",
          text: "",
          font: "",
          colorPalette: [],
        },
      ],
    };

    const { result } = renderHook(() =>
      useGenSpaceGenerationActions({
        mode: "image",
        imageMode: "region",
        regionPrompt,
        videoMode: "generate",
        prompt: "unrelated Create prompt",
        framingSettings,
        promptEnhancementEnabled: true,
        currentProjectId: "project-a",
        projectAssets: [],
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          imageProfileId: "ideogram4_int8",
        },
        setSettings: vi.fn(),
        musicSettings: DEFAULT_MUSIC_SETTINGS,
        musicProfiles: [],
        imageInputs: [
          {
            id: "stale-input",
            url: "file:///C:/stale.png",
            role: "reference_subject",
            type: "image",
          },
        ],
        inputImage: null,
        inputAudio: null,
        useAudioTrack: false,
        reframeInput: {
          videoUrl: null,
          videoPath: null,
          startTime: 0,
          duration: 0,
          videoDuration: 0,
          videoWidth: 0,
          videoHeight: 0,
          aspectMode: "16:9",
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          ready: false,
        },
        retakeInput: {
          videoPath: null,
          startTime: 0,
          duration: 0,
          videoDuration: 0,
        },
        setLocalError: vi.fn(),
        generate: vi.fn(async () => undefined),
        generateImage,
        generateMusic: vi.fn(async () => null),
        submitRetake: vi.fn(async () => undefined),
      }),
    );

    await act(() => result.current.submit());

    const serialized = serializeRegionPrompt(regionPrompt);
    expect(generateImage).toHaveBeenCalledWith(
      serialized,
      expect.objectContaining({ enhancePrompt: false }),
      [],
      undefined,
      { kind: "image-output", snapshot: expect.objectContaining({ prompt: serialized, inputs: [] }) },
    );
  });

  it("submits only the active Edit workflow inputs and recipe", async () => {
    const generateImage: UseGenerationReturn["generateImage"] = vi.fn(
      async () => undefined,
    );
    const editImage = {
      id: "master",
      url: "file:///C:/master.png",
      role: "edit_image",
      type: "image" as const,
    };
    const reference = {
      id: "reference",
      url: "file:///C:/reference.png",
      role: "reference_subject",
      type: "image" as const,
    };
    const editMask = {
      schemaVersion: 1 as const,
      operations: [
        {
          kind: "rectangle" as const,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        },
      ],
    };
    const editOutpaint = {
      aspectMode: "16:9" as const,
      padding: { top: 0, bottom: 0, left: 25, right: 25 },
    };

    const { result, rerender } = renderHook(
      ({ toolMode }: { toolMode: ImageEditToolMode }) =>
        useGenSpaceGenerationActions({
          mode: "image",
          imageMode: "edit",
          regionPrompt: createEmptyRegionPrompt(),
          videoMode: "generate",
          prompt: "change the source",
          framingSettings: null,
          promptEnhancementEnabled: false,
          currentProjectId: "project-a",
          projectAssets: [],
          settings: { ...DEFAULT_VIDEO_SETTINGS },
          setSettings: vi.fn(),
          musicSettings: DEFAULT_MUSIC_SETTINGS,
          musicProfiles: [],
          imageInputs: [reference],
          editImage,
          editToolMode: toolMode,
          editMask,
          editOutpaint,
          inputImage: null,
          inputAudio: null,
          useAudioTrack: false,
          reframeInput: {
            videoUrl: null,
            videoPath: null,
            startTime: 0,
            duration: 0,
            videoDuration: 0,
            videoWidth: 0,
            videoHeight: 0,
            aspectMode: "16:9",
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            ready: false,
          },
          retakeInput: {
            videoPath: null,
            startTime: 0,
            duration: 0,
            videoDuration: 0,
          },
          setLocalError: vi.fn(),
          generate: vi.fn(async () => undefined),
          generateImage,
          generateMusic: vi.fn(async () => null),
          submitRetake: vi.fn(async () => undefined),
        }),
      { initialProps: { toolMode: "edit" as ImageEditToolMode } },
    );

    await act(() => result.current.submit());
    let call = vi.mocked(generateImage).mock.calls[0];
    expect(call?.[2]).toEqual([
      {
        path: "C:/reference.png",
        role: "reference_subject",
        type: "image",
      },
    ]);
    expect(call?.[3]).toEqual({ image: { path: "C:/master.png" } });
    expect(call?.[4]).toEqual({ kind: "image-output", snapshot: expect.objectContaining({ inputs: [editImage, reference] }) });

    vi.mocked(generateImage).mockClear();
    rerender({ toolMode: "retouch" });
    await act(() => result.current.submit());
    call = vi.mocked(generateImage).mock.calls[0];
    expect(call?.[2]).toEqual([]);
    expect(call?.[3]).toEqual({
      image: { path: "C:/master.png" },
      mask: editMask,
    });
    expect(call?.[4]).toEqual({ kind: "image-output", snapshot: expect.objectContaining({ editMask, editOutpaint: undefined }) });

    vi.mocked(generateImage).mockClear();
    rerender({ toolMode: "reframe" });
    await act(() => result.current.submit());
    call = vi.mocked(generateImage).mock.calls[0];
    expect(call?.[2]).toEqual([]);
    expect(call?.[3]).toEqual({
      image: { path: "C:/master.png" },
      outpaint: editOutpaint,
    });
    expect(call?.[4]).toEqual({ kind: "image-output", snapshot: expect.objectContaining({ editMask: undefined, editOutpaint }) });
  });

  it("passes a selected video tool through generation and snapshots its source", async () => {
    const generate: UseGenerationReturn["generate"] = vi.fn(
      async () => undefined,
    );
    const toolInput = {
      id: "tool-source",
      url: "file:///C:/source.mp4",
      role: "control_video",
      type: "video" as const,
      trimStartTime: 1,
      trimDuration: 3,
    };

    const { result } = renderHook(() =>
      useGenSpaceGenerationActions({
        mode: "video",
        imageMode: "create",
        regionPrompt: createEmptyRegionPrompt(),
        videoMode: "reframe",
        selectedVideoTool: "relight",
        videoToolInput: toolInput,
        prompt: "relight this shot",
        framingSettings: null,
        promptEnhancementEnabled: true,
        currentProjectId: "project-a",
        projectAssets: [],
        settings: { ...DEFAULT_VIDEO_SETTINGS },
        setSettings: vi.fn(),
        musicSettings: DEFAULT_MUSIC_SETTINGS,
        musicProfiles: [],
        imageInputs: [],
        inputImage: null,
        inputAudio: null,
        useAudioTrack: false,
        reframeInput: {
          videoUrl: null,
          videoPath: null,
          startTime: 0,
          duration: 0,
          videoDuration: 0,
          videoWidth: 0,
          videoHeight: 0,
          aspectMode: "16:9",
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          ready: false,
        },
        retakeInput: {
          videoPath: null,
          startTime: 0,
          duration: 0,
          videoDuration: 0,
        },
        setLocalError: vi.fn(),
        generate,
        generateImage: vi.fn(async () => undefined),
        generateMusic: vi.fn(async () => null),
        submitRetake: vi.fn(async () => undefined),
      }),
    );

    await act(() => result.current.submit());

    expect(generate).toHaveBeenCalledWith(
      "relight this shot",
      null,
      expect.objectContaining({ enhancePrompt: true }),
      null,
      [
        {
          path: "C:/source.mp4",
          role: "control_video",
          type: "video",
          trimStartTime: 1,
          trimDuration: 3,
        },
      ],
      false,
      undefined,
      undefined,
      "relight",
      { kind: "video-output", snapshot: expect.objectContaining({ prompt: "relight this shot", videoTool: "relight", inputs: [toolInput] }) },
    );
  });

  it("retains staged files for ambiguous failures and removes only new files for rejected admission", async () => {
    const generate: UseGenerationReturn["generate"] = vi.fn()
      .mockRejectedValueOnce(new Error("queue refresh failed"))
      .mockRejectedValueOnce(new QueueAdmissionRejectedError("queue rejected"));
    const deleteProjectAssetFiles = vi.fn(async () => ({ success: true, deleted: [], skipped: [], failed: [] }));
    vi.stubGlobal("electronAPI", { deleteProjectAssetFiles });
    vi.mocked(stageEntityInputs).mockImplementation(async (inputs) => inputs.map((input, index) => ({
      ...input,
      path: index === 0 ? "C:/project/uploads/new.png" : "C:/project/uploads/reused.png",
      url: index === 0 ? "file:///C:/project/uploads/new.png" : "file:///C:/project/uploads/reused.png",
      created: index === 0,
    })));

    const referenceEntities: ReferenceEntity[] = [
      { id: "cast", kind: "cast", name: "Cast", token: "@cast", visualDescription: "a performer", voiceDescription: "", fidelity: "exact", createdAt: 1, updatedAt: 1, visualReference: { type: "image", relativePath: "cast.png", path: "C:/library/cast.png", url: "file:///C:/library/cast.png", fileName: "cast.png" } },
      { id: "location", kind: "location", name: "Location", token: "@location", visualDescription: "a studio", fidelity: "exact", createdAt: 1, updatedAt: 1, visualReference: { type: "image", relativePath: "location.png", path: "C:/library/location.png", url: "file:///C:/library/location.png", fileName: "location.png" } },
    ];
    const videoProfiles = [{
      id: DEFAULT_VIDEO_SETTINGS.videoProfileId,
      promptComposer: { promptFormat: "plain", entityMediaMode: "general-reference", voiceReference: false },
    }] as ModelProfile[];

    const { result } = renderHook(() =>
      useGenSpaceGenerationActions({
        mode: "video", imageMode: "create", regionPrompt: createEmptyRegionPrompt(), videoMode: "generate",
        prompt: "@cast at @location", framingSettings: null, promptEnhancementEnabled: false,
        referenceEntities, videoProfiles, currentProjectId: "project-a", projectAssets: [], settings: { ...DEFAULT_VIDEO_SETTINGS },
        setSettings: vi.fn(), musicSettings: DEFAULT_MUSIC_SETTINGS, musicProfiles: [], imageInputs: [],
        inputImage: null, inputAudio: null, useAudioTrack: false,
        reframeInput: { videoUrl: null, videoPath: null, startTime: 0, duration: 0, videoDuration: 0, videoWidth: 0, videoHeight: 0, aspectMode: "16:9", padding: { top: 0, bottom: 0, left: 0, right: 0 }, ready: false },
        retakeInput: { videoPath: null, startTime: 0, duration: 0, videoDuration: 0 }, setLocalError: vi.fn(),
        generate, generateImage: vi.fn(async () => undefined), generateMusic: vi.fn(async () => null), submitRetake: vi.fn(async () => undefined),
      }),
    );

    const ambiguousSubmission = result.current.submit();
    const duplicateSubmission = result.current.submit();
    await expect(ambiguousSubmission).rejects.toThrow("queue refresh failed");
    await expect(duplicateSubmission).resolves.toBeUndefined();
    expect(stageEntityInputs).toHaveBeenCalledTimes(1);
    expect(deleteProjectAssetFiles).not.toHaveBeenCalled();
    await expect(act(() => result.current.submit())).rejects.toThrow("queue rejected");
    expect(deleteProjectAssetFiles).toHaveBeenCalledWith({ projectId: "project-a", filePaths: ["C:/project/uploads/new.png"] });
  });
});
