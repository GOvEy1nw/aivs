export interface SpeechReferenceAudio {
  assetId?: string
  path: string
  url: string
  trimStartTime?: number
  trimDuration?: number
  mediaDuration?: number
}

export interface SpeechSegment {
  speaker: 1 | 2 | 3
  text: string
}

export interface SpeechSettings {
  profileId: string
  references: SpeechReferenceAudio[]
  segments: SpeechSegment[]
  seed: number | null
}

export interface GenerateSpeechReference {
  path: string
  trimStartTime?: number
  trimDuration?: number
  mediaDuration?: number
}

export interface GenerateSpeechRequest {
  modelProfileId: string
  text: string
  references: GenerateSpeechReference[]
  enhancePrompt: boolean
  seed: number | null
}

export interface SpeechGenerationRecipeV1 {
  schemaVersion: 1
  modelProfileId: string
  text: string
  referenceAudio: SpeechReferenceAudio | null
  seed: number | null
}

export interface SpeechGenerationRecipeV2 {
  schemaVersion: 2
  modelProfileId: string
  text: string
  references: SpeechReferenceAudio[]
  segments: SpeechSegment[]
  enhancePrompt: boolean
  seed: number | null
}

export type SpeechGenerationRecipe = SpeechGenerationRecipeV1 | SpeechGenerationRecipeV2
