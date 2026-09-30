import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "../../../types/model-profiles";
import type { AudioGenPanelController, SfxGenPanelController } from "../types";
import type { SpeechSettings } from "../../../types/speech";
import type { Asset } from "../../../types/project";
import { AudioGenPanel } from "./AudioGenPanel";

afterEach(cleanup);

const profile = {
  id: "mmaudio_sfx",
  displayName: "MMAudio",
  availability: "available",
  sfx: { handler: "sfx_generation", text: true },
} as ModelProfile;

function sfxController(options = [profile]): SfxGenPanelController {
  return {
    prompt: {
      value: "rain",
      setValue: vi.fn(),
      enhance: vi.fn(),
      enhanceEnabled: false,
      isEnhancing: false,
      seedLocked: false,
      lockedSeed: 0,
      setSeed: vi.fn(),
    },
    settings: {
      profileId: "mmaudio_sfx",
      negativePrompt: "",
      durationSeconds: 8,
      seed: null,
      video: null,
    },
    setSettings: vi.fn(),
    profiles: { options, modelDownload: null },
    media: { resolveInputFileUrl: vi.fn(async () => null) },
    isRunning: false,
    submit: vi.fn(),
  };
}

function controller(sfx: SfxGenPanelController): AudioGenPanelController {
  return {
    submode: "sfx",
    setSubmode: vi.fn(),
    music: {} as AudioGenPanelController["music"],
    sfx,
  };
}

describe("AudioGenPanel SFX header", () => {
  it("keeps the normal model download action in the Audio header", () => {
    render(
      <AudioGenPanel
        controller={controller(
          sfxController([{ ...profile, availability: "missing_model_files" }]),
        )}
      />,
    );

    expect(screen.getByRole("button", { name: "Download models" })).toBeTruthy();
  });
});

describe("AudioGenPanel Speech", () => {
  it("requires Index TTS 2's picker-imported project voice", async () => {
    const importedVoice: Asset = {
      id: "voice",
      type: "audio",
      path: "D:\\project\\uploads\\voice.wav",
      url: "file:///D:/project/uploads/voice.wav",
      prompt: "",
      resolution: "",
      createdAt: 1,
      source: "uploaded",
    };
    const speechProfile = {
      id: "index_tts2",
      displayName: "Index TTS 2",
      availability: "available",
      speech: {
        handler: "speech_generation",
        tts: true,
        referenceRequired: true,
        maxReferenceInputs: 2,
      },
    } as ModelProfile;
    const secondVoice: Asset = {
      ...importedVoice,
      id: "voice-2",
      path: "D:\\project\\uploads\\voice-2.wav",
      url: "file:///D:/project/uploads/voice-2.wav",
    };
    const enhance = vi.fn();
    let latestSettings: SpeechSettings | null = null;

    function Harness() {
      const [settings, setSettings] = useState<SpeechSettings>({
        profileId: "index_tts2",
        references: [],
        segments: [],
        seed: null,
      });
      return (
        <AudioGenPanel
          controller={{
            submode: "speech",
            setSubmode: vi.fn(),
            music: {} as AudioGenPanelController["music"],
            speech: {
              prompt: {
                value: "Hello",
                setValue: vi.fn(),
                enhance,
                enhanceEnabled: false,
                isEnhancing: false,
                seedLocked: false,
                lockedSeed: 0,
                setSeed: vi.fn(),
              },
              settings,
              setSettings: (next) => {
                latestSettings = next;
                setSettings(next);
              },
              profiles: { options: [speechProfile], modelDownload: null },
              media: {
                resolveInputFileUrl: vi.fn(async () => importedVoice.url),
                syncInputFileToGalleryAsset: vi.fn(async (file: File) =>
                  file.name === "voice-2.wav" ? secondVoice : importedVoice,
                ),
              },
              isRunning: false,
              submit: vi.fn(),
            },
          }}
        />
      );
    }

    const { container } = render(<Harness />);
    expect(
      (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(["voice"], "voice.wav", { type: "audio/wav" })],
      },
    });

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect((latestSettings as SpeechSettings | null)?.references[0]).toMatchObject({
      assetId: importedVoice.id,
      path: importedVoice.path,
      url: importedVoice.url,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit voice reference 1" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Trim" }));
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { value: 10, configurable: true });
    fireEvent.loadedMetadata(audio);
    await waitFor(() =>
      expect(
        (latestSettings as SpeechSettings | null)?.references[0]?.mediaDuration,
      ).toBe(10),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();

    fireEvent.change(container.querySelectorAll('input[type="file"]')[1]!, {
      target: {
        files: [new File(["voice"], "voice-2.wav", { type: "audio/wav" })],
      },
    });

    await waitFor(() => expect(screen.getByText("Dialogue")).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Segment 2 text" }), {
      target: { value: "Hi from speaker two" },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect((latestSettings as SpeechSettings | null)?.references[1]).toMatchObject({
      assetId: secondVoice.id,
      path: secondVoice.path,
      url: secondVoice.url,
    });
    fireEvent.click(screen.getByRole("button", { name: /automatically enhance/i }));
    expect(enhance).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove voice reference 2" }),
    );
    await waitFor(() => expect(screen.queryByText("Dialogue")).toBeNull());
    expect((latestSettings as SpeechSettings | null)?.segments).toEqual([]);

    fireEvent.change(container.querySelectorAll('input[type="file"]')[1]!, {
      target: {
        files: [new File(["voice"], "voice-2.wav", { type: "audio/wav" })],
      },
    });
    await waitFor(() => expect(screen.getByText("Dialogue")).toBeTruthy());
    expect(
      (screen.getByRole("textbox", { name: "Segment 2 text" }) as HTMLTextAreaElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
