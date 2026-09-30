import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendFetch, resetBackendCredentials } from "../lib/backend";
import { useImageProfiles, useMusicProfiles, useVideoProfiles } from "../hooks/use-image-profiles";
import type { ModelProfile } from "../types/model-profiles";
import { AppSettingsProvider, useAppSettings } from "./AppSettingsContext";
import { BackendLifecycleProvider, useBackendLifecycle } from "./BackendLifecycleContext";
import { ModelProfilesProvider, useModelProfiles } from "./ModelProfilesContext";

vi.mock("../lib/backend", () => ({
  backendFetch: vi.fn(),
  resetBackendCredentials: vi.fn(),
}));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const fetchMock = vi.mocked(backendFetch);
const resetCredentialsMock = vi.mocked(resetBackendCredentials);
const profile = (mediaType: "image" | "video" | "audio"): ModelProfile => ({
  id: mediaType,
  displayName: mediaType,
  mediaType,
  visible: true,
  status: "stable",
  wangpModelType: mediaType,
  wangpMetadata: {
    modelType: mediaType,
    family: mediaType,
    familyLabel: mediaType,
    baseModelType: mediaType,
    finetune: false,
    mainOutput: [],
    outputs: [],
    inputs: [],
    mediaInputs: {},
    capabilities: {},
    settingValues: {},
  },
  capabilities: {
    textToImage: false,
    textToVideo: false,
    imageToVideo: false,
    videoToVideo: false,
    audioToVideo: false,
    audioOutput: false,
    textToAudio: false,
    audioToAudio: false,
    startImage: false,
    endImage: false,
    controlVideo: false,
    videoContinuation: false,
    slidingWindow: false,
    referenceImages: false,
    controlImage: false,
    inpainting: false,
    outpainting: false,
    maskedEditReferences: false,
    lora: "unsupported",
  },
  ui: {
    defaultAspectRatio: "16:9",
    defaultResolutionTier: "720p",
    allowedAspectRatios: [],
    allowedResolutionTiers: [],
  },
  inputMedia: { supportsImageInputs: false, tooltipLabel: "", maxImages: 0, defaultRole: null, roles: [] },
  director: {
    enabled: false,
    promptRelay: false,
    injectedFrames: false,
    continueVideo: false,
    guideAudioStartOnly: false,
    maxImageKeyframes: null,
    maxGuidanceSegments: 0,
    guidanceModes: [],
    maxDurationSeconds: 0,
    allowKeyframesWithVideoGuidance: false,
    allowKeyframesWithIngredients: false,
    allowGuideAudioWithGuidance: false,
    renderStrategies: [],
  },
  music: {
    enabled: mediaType === "audio",
    supportsInstrumental: false,
    supportsAutoLyrics: false,
    supportsCustomLyrics: false,
    autoLyricsRequiresPromptEnhancer: false,
    autoFillMetadata: false,
    durationMinSeconds: 0,
    durationMaxSeconds: 0,
    durationStepSeconds: 0,
    defaultDurationSeconds: 0,
    supportsBpm: false,
    bpmMin: 0,
    bpmMax: 0,
    supportsKeyScale: false,
    supportsTimeSignature: false,
    timeSignatures: [],
    defaultVocalMode: "",
    maxVariations: 0,
    supportsAutoDuration: false,
    autoDurationFallbackSeconds: 0,
    supportsDescriptionEnhancement: false,
    supportsVocalLanguage: false,
    supportedLanguages: [],
    defaultVocalLanguage: "",
    supportsVocalGenderConditioning: false,
    supportsCover: false,
    supportsReferenceTimbre: false,
    supportsComposeLyrics: false,
    supportsComposeThinking: false,
    defaultCoverStrength: 0,
    defaultWeirdness: 0,
    defaultPromptInfluence: 0,
  },
  requiredPackIds: [],
  systemDependencies: [],
  videoAudio: {
    status: "hidden",
    handler: null,
    requiredPackIds: [],
    soundtrack: false,
    audioConditioning: false,
    controlVideoAudio: false,
    outputAudio: false,
    maxAudioInputs: 0,
  },
  speech: {
    status: "hidden",
    handler: null,
    requiredPackIds: [],
    referenceVoice: false,
    tts: false,
    maxReferenceInputs: 0,
  },
  sfx: {
    status: "hidden",
    handler: null,
    requiredPackIds: [],
    text: false,
    controlVideoAudio: false,
    maxDurationSeconds: null,
  },
  videoEdits: { operations: [] },
  license: null,
  availability: "available",
});

const profiles = [profile("image"), profile("video"), profile("audio")];
let onHealthStatus: ((status: { status: "alive" | "restarting" | "dead" }) => void) | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BackendLifecycleProvider>
      <AppSettingsProvider>
        <ModelProfilesProvider>{children}</ModelProfilesProvider>
      </AppSettingsProvider>
    </BackendLifecycleProvider>
  );
}

function installElectronApi() {
  onHealthStatus = undefined;
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getBackendHealthStatus: vi.fn().mockResolvedValue({ status: "alive" }),
      onBackendHealthStatus: vi.fn((callback) => {
        onHealthStatus = callback;
        return vi.fn();
      }),
      getModelPacks: vi.fn().mockResolvedValue([]),
      restartPythonBackend: vi.fn(),
    } as unknown as Window["electronAPI"],
  });
}

function installSuccessfulFetch() {
  fetchMock.mockImplementation(async (path) => {
    if (path === "/health") {
      return new Response(JSON.stringify({ models_loaded: true, gpu_info: null }));
    }
    if (path === "/api/settings") {
      return new Response(JSON.stringify({ lockedSeed: 1 }));
    }
    return new Response(JSON.stringify({ profiles }));
  });
}

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  resetCredentialsMock.mockReset();
});

describe("ModelProfilesProvider", () => {
  it("normalizes older profile responses to disabled policy defaults", async () => {
    installElectronApi();
    const current = profile("video");
    const {
      requiredPackIds: _requiredPackIds,
      systemDependencies: _systemDependencies,
      videoAudio: _videoAudio,
      speech: _speech,
      sfx: _sfx,
      videoEdits: _videoEdits,
      ...olderProfile
    } = current;
    const { renderStrategies: _renderStrategies, ...olderDirector } = olderProfile.director;
    fetchMock.mockImplementation(async (path) => {
      if (path === "/health") return new Response(JSON.stringify({ models_loaded: true }));
      if (path === "/api/settings") return new Response(JSON.stringify({ lockedSeed: 1 }));
      return new Response(JSON.stringify({
        profiles: [{ ...olderProfile, director: olderDirector }],
      }));
    });

    const { result } = renderHook(() => useModelProfiles(), { wrapper });
    await waitFor(() => expect(result.current.all).toHaveLength(1));
    expect(result.current.all[0]).toMatchObject({
      requiredPackIds: [],
      systemDependencies: [],
      videoEdits: { operations: [] },
      director: { renderStrategies: [] },
      videoAudio: { status: "hidden", handler: null },
    });
  });

  it("loads profiles after Strict Mode replays effect cleanup and setup", async () => {
    installElectronApi();
    installSuccessfulFetch();

    const { result } = renderHook(() => useModelProfiles(), {
      wrapper,
      reactStrictMode: true,
    });

    await waitFor(() => expect(result.current.all).toHaveLength(3));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("shares one lifecycle snapshot and profile/model-pack load across media hooks", async () => {
    installElectronApi();
    installSuccessfulFetch();

    const { result } = renderHook(
      () => ({ image: useImageProfiles(), video: useVideoProfiles(), music: useMusicProfiles() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.music.profiles).toHaveLength(1));

    expect(window.electronAPI.onBackendHealthStatus).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.getBackendHealthStatus).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/model-profiles")).toHaveLength(1);
    expect(window.electronAPI.getModelPacks).toHaveBeenCalledTimes(1);
    expect(result.current.image.profiles).toHaveLength(1);
    expect(result.current.video.profiles).toHaveLength(1);
  });

  it("coalesces ordinary refreshes and queues one post-model-pack refresh", async () => {
    installElectronApi();
    installSuccessfulFetch();
    const { result } = renderHook(() => useModelProfiles(), { wrapper });
    await waitFor(() => expect(result.current.all).toHaveLength(3));

    let resolveProfiles: (response: Response) => void;
    const pendingProfiles = new Promise<Response>((resolve) => {
      resolveProfiles = resolve;
    });
    let resolvePacks: (packs: unknown[]) => void;
    const pendingPacks = new Promise<unknown[]>((resolve) => {
      resolvePacks = resolve;
    });
    let profileRequestCount = 0;
    fetchMock.mockImplementation((path) => {
      if (path === "/health") {
        return Promise.resolve(new Response(JSON.stringify({ models_loaded: true, gpu_info: null })));
      }
      profileRequestCount += 1;
      return profileRequestCount === 1
        ? pendingProfiles
        : Promise.resolve(new Response(JSON.stringify({ profiles })));
    });
    vi.mocked(window.electronAPI.getModelPacks).mockImplementationOnce(() => pendingPacks);

    const first = result.current.refresh();
    const second = result.current.refresh();
    const afterMutation = result.current.refreshAfterModelPackMutation();
    const duplicateMutation = result.current.refreshAfterModelPackMutation();
    expect(second).toBe(first);
    expect(duplicateMutation).toBe(afterMutation);
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/model-profiles")).toHaveLength(2);

    resolveProfiles!(new Response(JSON.stringify({ profiles })));
    resolvePacks!([]);
    await expect(afterMutation).resolves.toBe(true);
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/model-profiles")).toHaveLength(3);
    expect(window.electronAPI.getModelPacks).toHaveBeenCalledTimes(3);
  });

  it("rejects stale health, retains profiles, and cancels retries during restart", async () => {
    installElectronApi();
    installSuccessfulFetch();
    const { result } = renderHook(
      () => ({
        models: useModelProfiles(),
        backend: useBackendLifecycle(),
        settings: useAppSettings(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.models.all).toHaveLength(3));
    await waitFor(() => expect(result.current.settings.isLoaded).toBe(true));
    act(() => result.current.settings.updateSettings({ lockedSeed: 99 }));

    let resolveStaleHealth: (response: Response) => void;
    const staleHealth = new Promise<Response>((resolve) => {
      resolveStaleHealth = resolve;
    });
    let healthRequestCount = 0;
    fetchMock.mockImplementation((path) => {
      if (path === "/health") {
        healthRequestCount += 1;
        return healthRequestCount === 1
          ? staleHealth
          : Promise.resolve(new Response(JSON.stringify({ models_loaded: false, gpu_info: null })));
      }
      if (path === "/api/settings") {
        return Promise.resolve(new Response(JSON.stringify({ lockedSeed: 1 })));
      }
      return Promise.resolve(new Response(JSON.stringify({ profiles })));
    });
    act(() => onHealthStatus?.({ status: "restarting" }));
    act(() => onHealthStatus?.({ status: "alive" }));
    await waitFor(() => expect(healthRequestCount).toBe(1));
    act(() => onHealthStatus?.({ status: "restarting" }));
    act(() => onHealthStatus?.({ status: "alive" }));
    await waitFor(() => expect(healthRequestCount).toBe(2));
    await waitFor(() => expect(result.current.backend.status.modelsLoaded).toBe(false));
    await act(async () => {
      resolveStaleHealth!(new Response(JSON.stringify({ models_loaded: true, gpu_info: null })));
      await Promise.resolve();
    });
    expect(result.current.backend.status.modelsLoaded).toBe(false);
    expect(result.current.settings.settings.lockedSeed).toBe(99);

    let resolveOldProfiles: (response: Response) => void;
    const oldProfiles = new Promise<Response>((resolve) => {
      resolveOldProfiles = resolve;
    });
    const replacementProfiles = [profile("image")];
    let replacementRequestCount = 0;
    fetchMock.mockImplementation((path) => {
      if (path === "/health") {
        return Promise.resolve(new Response(JSON.stringify({ models_loaded: true, gpu_info: null })));
      }
      if (path === "/api/settings") {
        return Promise.resolve(new Response(JSON.stringify({ lockedSeed: 1 })));
      }
      replacementRequestCount += 1;
      return replacementRequestCount === 1
        ? oldProfiles
        : Promise.resolve(new Response(JSON.stringify({ profiles: replacementProfiles })));
    });
    const oldRefresh = result.current.models.refresh();
    await waitFor(() => expect(replacementRequestCount).toBe(1));
    act(() => onHealthStatus?.({ status: "restarting" }));
    act(() => onHealthStatus?.({ status: "alive" }));
    await waitFor(() => expect(replacementRequestCount).toBe(2));
    await waitFor(() => expect(result.current.models.all).toEqual(replacementProfiles));
    await act(async () => {
      resolveOldProfiles!(new Response(JSON.stringify({ profiles })));
      await Promise.resolve();
    });
    await expect(oldRefresh).resolves.toBe(false);
    expect(result.current.models.all).toEqual(replacementProfiles);

    fetchMock.mockImplementation(async (path) =>
      path === "/health"
        ? new Response(JSON.stringify({ models_loaded: true, gpu_info: null }))
        : new Response(null, { status: 503 }),
    );
    const profileRequestCount = fetchMock.mock.calls.filter(([path]) => path === "/api/model-profiles").length;
    act(() => onHealthStatus?.({ status: "restarting" }));
    act(() => onHealthStatus?.({ status: "alive" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path === "/api/model-profiles")).toHaveLength(profileRequestCount + 1));
    await waitFor(() => expect(result.current.models.error).toContain("503"));

    act(() => onHealthStatus?.({ status: "restarting" }));
    await new Promise((resolve) => window.setTimeout(resolve, 1600));

    expect(result.current.models.all).toEqual(replacementProfiles);
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/model-profiles")).toHaveLength(profileRequestCount + 1);
  });
});
