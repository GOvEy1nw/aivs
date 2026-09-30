import type { GenerateSpeechRequest, SpeechGenerationRecipeV2, SpeechSettings } from "../../../types/speech";

const MAX_SPEECH_TEXT_LENGTH = 4096;

export function buildSpeechGenerationCommand(text: string, settings: SpeechSettings, enhancePrompt: boolean): { request: GenerateSpeechRequest; recipe: SpeechGenerationRecipeV2 } | null {
  const dialogue = settings.references.length >= 2;
  const segments = settings.segments.filter(({ text: segmentText }) => segmentText.trim());
  if (!settings.profileId || settings.references.length > 3 || (dialogue && !Array.from({ length: settings.references.length }, (_, index) => index + 1).every((speaker) => segments.some((segment) => segment.speaker === speaker)))) return null;
  const compiledText = dialogue
    ? segments.map(({ speaker, text: segmentText }) => `Speaker ${speaker}: ${segmentText.trim()}`).join("\n")
    : text.trim();
  if (!compiledText || compiledText.length > MAX_SPEECH_TEXT_LENGTH) return null;
  const request: GenerateSpeechRequest = {
    modelProfileId: settings.profileId,
    text: compiledText,
    references: settings.references.map(({ path, trimStartTime, trimDuration, mediaDuration }) => ({
      path,
      ...(trimStartTime !== undefined ? { trimStartTime } : {}),
      ...(trimDuration !== undefined ? { trimDuration } : {}),
      ...(mediaDuration !== undefined ? { mediaDuration } : {}),
    })),
    enhancePrompt,
    seed: settings.seed,
  };
  return {
    request,
    recipe: {
      schemaVersion: 2,
      modelProfileId: request.modelProfileId,
      text: request.text,
      seed: request.seed,
      references: settings.references.map((reference) => ({ ...reference })),
      segments: settings.segments.map((segment) => ({ ...segment })),
      enhancePrompt,
    },
  };
}
