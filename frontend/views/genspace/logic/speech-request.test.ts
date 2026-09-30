import { describe, expect, it } from "vitest";
import type { SpeechSettings } from "../../../types/speech";
import { buildSpeechGenerationCommand } from "./speech-request";

describe("buildSpeechGenerationCommand", () => {
  it("compiles ordered two-speaker segments and trimmed references", () => {
    const settings: SpeechSettings = {
      profileId: "index_tts2",
      references: [
        {
          assetId: "voice-1",
          path: "D:\\voices\\one.wav",
          url: "file:///D:/voices/one.wav",
          trimStartTime: 1,
          trimDuration: 3,
          mediaDuration: 8,
        },
        {
          assetId: "voice-2",
          path: "D:\\voices\\two.wav",
          url: "file:///D:/voices/two.wav",
        },
      ],
      segments: [
        { speaker: 1, text: " First line " },
        { speaker: 2, text: "Second line" },
        { speaker: 1, text: "   " },
      ],
      seed: 7,
    };

    const command = buildSpeechGenerationCommand("ignored", settings, true);

    expect(command?.request).toEqual({
      modelProfileId: "index_tts2",
      text: "Speaker 1: First line\nSpeaker 2: Second line",
      references: [
        {
          path: "D:\\voices\\one.wav",
          trimStartTime: 1,
          trimDuration: 3,
          mediaDuration: 8,
        },
        { path: "D:\\voices\\two.wav" },
      ],
      enhancePrompt: true,
      seed: 7,
    });
    expect(command?.recipe).toMatchObject({
      schemaVersion: 2,
      references: settings.references,
      segments: settings.segments,
      enhancePrompt: true,
    });
    expect(
      buildSpeechGenerationCommand(
        "ignored",
        { ...settings, segments: [{ speaker: 1, text: "Only one" }] },
        false,
      ),
    ).toBeNull();
    expect(
      buildSpeechGenerationCommand(
        "ignored",
        {
          ...settings,
          segments: [
            { speaker: 1, text: "x".repeat(4096) },
            { speaker: 2, text: "Too long" },
          ],
        },
        false,
      ),
    ).toBeNull();
  });

  it("keeps a third speaker paired with its third reference", () => {
    const settings: SpeechSettings = {
      profileId: "omnivoice",
      references: [
        { path: "D:\\voices\\one.wav", url: "file:///D:/voices/one.wav" },
        { path: "D:\\voices\\two.wav", url: "file:///D:/voices/two.wav" },
        { path: "D:\\voices\\three.wav", url: "file:///D:/voices/three.wav" },
      ],
      segments: [
        { speaker: 1, text: "One" },
        { speaker: 2, text: "Two" },
        { speaker: 3, text: "Three" },
      ],
      seed: null,
    };

    expect(buildSpeechGenerationCommand("ignored", settings, false)?.request.text).toBe(
      "Speaker 1: One\nSpeaker 2: Two\nSpeaker 3: Three",
    );
  });
});
