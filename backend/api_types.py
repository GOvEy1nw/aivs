"""Pydantic request/response models and TypedDicts for ltx2_server."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, NamedTuple, TypeAlias, TypedDict
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, model_validator

NonEmptyPrompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ImageConditioningInput(NamedTuple):
    """Image conditioning triplet used by all video pipelines."""

    path: str
    frame_idx: int
    strength: float


# ============================================================
# TypedDicts for module-level state globals
# ============================================================


class GenerationState(TypedDict):
    id: str | None
    cancelled: bool
    result: str | list[str] | None
    error: str | None
    status: str  # "idle" | "running" | "complete" | "cancelled" | "error"
    phase: str
    progress: int
    current_step: int
    total_steps: int


class ModelDownloadState(TypedDict):
    status: str  # "idle" | "downloading" | "complete" | "error"
    current_file: str
    current_file_progress: int
    total_progress: int
    downloaded_bytes: int
    total_bytes: int
    files_completed: int
    total_files: int
    error: str | None
    speed_mbps: int


JsonObject: TypeAlias = dict[str, object]
MusicVocalMode = Literal["instrumental", "auto-lyrics", "custom-lyrics"]
MusicTimeSignature = Literal["2/4", "3/4", "4/4", "6/8"]
VideoCameraMotion = Literal[
    "none",
    "dolly_in",
    "dolly_out",
    "dolly_left",
    "dolly_right",
    "jib_up",
    "jib_down",
    "static",
    "focus_shift",
]
VideoInputMediaRole: TypeAlias = Literal[
    "start_image",
    "end_image",
    "control_video",
    "audio_guide",
    "human_motion",
    "human_motion_pose",
    "depth",
    "canny_edges",
    "sdr_to_hdr",
    "continue_video",
    "audio_to_video",
    "reference_voice",
    "reference_image",
    "reference_video",
    "reference_audio",
]


# ============================================================
# Response Models
# ============================================================


class ModelStatusItem(BaseModel):
    id: str
    name: str
    loaded: bool
    downloaded: bool


class GpuTelemetry(BaseModel):
    name: str
    vram: int
    vramUsed: int


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    active_model: str | None
    gpu_info: GpuTelemetry
    sage_attention: bool
    models_status: list[ModelStatusItem]


class GpuInfoResponse(BaseModel):
    cuda_available: bool
    mps_available: bool = False
    gpu_available: bool = False
    gpu_name: str | None
    vram_gb: int | None
    gpu_info: GpuTelemetry


class ModelDownloadProgressResponse(BaseModel):
    phase: str | None = None
    modelType: str | None = None
    modelName: str | None = None
    source: str | None = None
    repoId: str | None = None
    filename: str | None = None
    unit: Literal["bytes", "files"]
    current: int = Field(ge=0)
    total: int | None = Field(default=None, ge=0)
    percent: float | None = Field(default=None, ge=0, le=100)
    speedBps: float | None = Field(default=None, ge=0)
    etaSeconds: float | None = Field(default=None, ge=0)
    fileIndex: int | None = Field(default=None, ge=0)
    fileCount: int | None = Field(default=None, ge=0)


class GenerationProgressResponse(BaseModel):
    status: str
    phase: str
    progress: int
    currentStep: int | None
    totalSteps: int | None
    phaseIndex: int | None = None
    phaseCount: int | None = None
    sectionIndex: int | None = None
    sectionCount: int | None = None
    statusDetail: str | None = None
    previewUrl: str | None = None
    downloadCurrentFile: str | None = None
    downloadCurrentFileProgress: int | None = None
    downloadTotalProgress: int | None = None
    progressUnit: Literal["bytes", "files"] | None = None
    modelDownload: ModelDownloadProgressResponse | None = None


class IcLoraModel(BaseModel):
    name: str
    path: str
    conditioning_type: str
    reference_downscale_factor: int


class IcLoraListResponse(BaseModel):
    models: list[IcLoraModel]
    directory: str


class SuggestGapPromptResponse(BaseModel):
    status: str = "success"
    suggested_prompt: str


class GenerateVideoResponse(BaseModel):
    status: str
    video_path: str | None = None
    resolvedSeed: int | None = None


class GenerateImageResponse(BaseModel):
    status: str
    image_paths: list[str] | None = None
    resolvedSeed: int | None = None


class MusicOutputResponse(BaseModel):
    path: str
    durationSeconds: float | None = None
    sampleRate: int | None = None
    channels: int | None = None
    format: str | None = None
    variationIndex: int
    seed: int | None = None


class MusicEffectiveSettings(BaseModel):
    modelMode: int
    durationMode: str
    fallbackDurationSeconds: int
    effectiveDurationSeconds: int
    temperature: float
    topP: float
    topK: int
    lmGuidanceScale: float
    vocalLanguage: str
    vocalGender: str
    audioTask: Literal["", "A", "B", "AB"]
    coverStrength: float | None = None
    descriptionModifiers: list[str] = Field(default_factory=list)
    requestedPerformanceProfile: float | None = None
    effectiveAudioProfile: float | None = None


class GenerateMusicResponse(BaseModel):
    status: str
    outputs: list[MusicOutputResponse]
    resolvedLyrics: str | None = None
    effectiveSettings: MusicEffectiveSettings | None = None
    warnings: list[str] = Field(default_factory=list)


class ComposeMusicLyricsResponse(BaseModel):
    status: Literal["success"] = "success"
    lyrics: str
    usedThinking: bool
    warnings: list[str] = Field(default_factory=list)


def _default_video_input_roles() -> list[VideoInputMediaRole]:
    return []


class EnhancePromptRequest(BaseModel):
    prompt: NonEmptyPrompt
    mode: Literal["image", "video"]
    modelProfileId: str | None = None
    inputImagePath: str | None = None
    endImagePath: str | None = None
    controlImagePath: str | None = None
    referenceImagePaths: list[str] = Field(default_factory=list, max_length=10)
    inputRoles: list[VideoInputMediaRole] = Field(default_factory=_default_video_input_roles, max_length=14)
    durationSeconds: float | None = Field(default=None, gt=0, le=1200, allow_inf_nan=False)


class EnhancePromptResponse(BaseModel):
    prompt: str


class CancelResponse(BaseModel):
    status: str
    id: str | None = None


class RetakeResponse(BaseModel):
    status: str
    video_path: str | None = None
    result: JsonObject | None = None


class IcLoraExtractResponse(BaseModel):
    conditioning: str
    original: str
    conditioning_type: str
    frame_time: float


class IcLoraDownloadResponse(BaseModel):
    status: str
    path: str | None = None
    already_existed: bool | None = None
    already_exists: bool | None = None


class IcLoraGenerateResponse(BaseModel):
    status: str
    video_path: str | None = None


class StatusResponse(BaseModel):
    status: str


class ErrorResponse(BaseModel):
    error: str
    message: str | None = None


class ModelProfileCapabilities(BaseModel):
    textToImage: bool
    textToVideo: bool
    imageToVideo: bool
    videoToVideo: bool
    audioToVideo: bool
    audioOutput: bool
    textToAudio: bool
    audioToAudio: bool
    startImage: bool
    endImage: bool
    controlVideo: bool
    videoContinuation: bool
    slidingWindow: bool
    referenceImages: bool
    controlImage: bool
    inpainting: bool
    outpainting: bool
    maskedEditReferences: bool
    lora: str


class ModelProfileInputMediaRole(BaseModel):
    role: str
    label: str
    description: str
    kind: str


class ModelProfileInputMedia(BaseModel):
    supportsImageInputs: bool
    tooltipLabel: str
    maxImages: int
    maxReferenceImages: int = 0
    maxReferenceVideos: int = 0
    maxReferenceAudios: int = 0
    maxCombinedReferences: int = 0
    defaultRole: str | None
    roles: list[ModelProfileInputMediaRole]


class ModelProfilePromptComposerPolicy(BaseModel):
    promptFormat: Literal["plain", "h3"]
    entityMediaMode: Literal["text-only", "general-reference", "inline-reference"]
    voiceReference: bool


class ModelProfileUi(BaseModel):
    defaultAspectRatio: str
    defaultResolutionTier: str
    allowedAspectRatios: list[str]
    allowedResolutionTiers: list[str]


class ModelProfileDirectorPolicy(BaseModel):
    enabled: bool
    promptRelay: bool
    injectedFrames: bool
    continueVideo: bool
    guideAudioStartOnly: bool
    maxImageKeyframes: int | None
    maxGuidanceSegments: int
    guidanceModes: list[Literal["human_motion", "depth", "ingredients"]]
    maxDurationSeconds: int
    allowKeyframesWithVideoGuidance: bool
    allowKeyframesWithIngredients: bool
    allowGuideAudioWithGuidance: bool
    renderStrategies: list["ModelProfileDirectorRenderStrategyPolicy"]


ModelProfileHandlerOwner = Literal[
    "video_generation",
    "director_generation",
    "retake",
    "sfx_generation",
    "speech_generation",
]


class ModelProfileDirectorRenderStrategyPolicy(BaseModel):
    id: str
    status: Literal["stable", "experimental", "hidden"]
    handler: ModelProfileHandlerOwner | None
    requiredPackIds: list[str]
    maxDurationSeconds: int | None


class ModelProfileSystemDependency(BaseModel):
    id: str
    kind: Literal["lora", "checkpoint"]
    requiredBy: list[str]
    userSelectable: Literal[False]


class ModelProfileVideoAudioPolicy(BaseModel):
    status: Literal["stable", "experimental", "hidden"]
    handler: ModelProfileHandlerOwner | None
    requiredPackIds: list[str]
    soundtrack: bool
    audioConditioning: bool
    controlVideoAudio: bool
    outputAudio: bool
    maxAudioInputs: int


class ModelProfileSpeechPolicy(BaseModel):
    status: Literal["stable", "experimental", "hidden"]
    handler: ModelProfileHandlerOwner | None
    requiredPackIds: list[str]
    referenceVoice: bool
    tts: bool
    maxReferenceInputs: int
    referenceRequired: bool = False


class ModelProfileSfxPolicy(BaseModel):
    status: Literal["stable", "experimental", "hidden"]
    handler: ModelProfileHandlerOwner | None
    requiredPackIds: list[str]
    text: bool
    controlVideoAudio: bool
    maxDurationSeconds: int | None


class ModelProfileVideoEditOperationPolicy(BaseModel):
    id: str
    status: Literal["stable", "experimental", "hidden"]
    handler: ModelProfileHandlerOwner | None
    requiredPackIds: list[str]
    systemDependencyIds: list[str]
    sourceBehavior: Literal["control_video", "continue_video", "source_video"]
    durationBehavior: Literal["source_duration", "extend_by"]
    disabledReason: str | None


class ModelProfileVideoEditPolicy(BaseModel):
    operations: list[ModelProfileVideoEditOperationPolicy]


class ModelProfileMusicPolicy(BaseModel):
    enabled: bool
    supportsInstrumental: bool
    supportsAutoLyrics: bool
    supportsCustomLyrics: bool
    autoLyricsRequiresPromptEnhancer: bool
    autoFillMetadata: bool
    durationMinSeconds: int
    durationMaxSeconds: int
    durationStepSeconds: int
    defaultDurationSeconds: int
    supportsBpm: bool
    bpmMin: int
    bpmMax: int
    supportsKeyScale: bool
    supportsTimeSignature: bool
    timeSignatures: list[str]
    defaultVocalMode: str
    maxVariations: int
    supportsAutoDuration: bool
    autoDurationFallbackSeconds: int
    supportsDescriptionEnhancement: bool
    supportsVocalLanguage: bool
    supportedLanguages: list[str]
    defaultVocalLanguage: str
    supportsVocalGenderConditioning: bool
    supportsCover: bool
    supportsReferenceTimbre: bool
    supportsComposeLyrics: bool
    supportsComposeThinking: bool
    defaultCoverStrength: int
    defaultWeirdness: int
    defaultPromptInfluence: int


class ModelProfileLicenseInfo(BaseModel):
    projectLicense: str
    weightsLicense: str
    commercialUse: Literal["permitted", "restricted", "unknown"]
    attributionRequired: bool
    sourceProject: str
    sourceRevision: str | None = None
    licenseUrl: str | None = None
    notes: str = ""


class ModelProfileWanGPMetadata(BaseModel):
    modelType: str
    family: str
    familyLabel: str
    baseModelType: str
    finetune: bool
    mainOutput: list[str]
    outputs: list[str]
    inputs: list[str]
    mediaInputs: dict[str, dict[str, bool]]
    capabilities: dict[str, bool]
    settingValues: JsonObject


class ModelProfileStyle(BaseModel):
    id: str
    displayName: str
    thumbnailUrl: str
    sourceUrl: str


class ModelProfileResponse(BaseModel):
    id: str
    displayName: str
    mediaType: str
    visible: bool
    status: str
    wangpModelType: str
    wangpMetadata: ModelProfileWanGPMetadata
    styles: list[ModelProfileStyle] = Field(
        default_factory=lambda: list[ModelProfileStyle]()
    )
    capabilities: ModelProfileCapabilities
    ui: ModelProfileUi
    inputMedia: ModelProfileInputMedia
    promptComposer: ModelProfilePromptComposerPolicy
    requiredPackIds: list[str]
    systemDependencies: list[ModelProfileSystemDependency]
    videoAudio: ModelProfileVideoAudioPolicy
    speech: ModelProfileSpeechPolicy
    sfx: ModelProfileSfxPolicy
    videoEdits: ModelProfileVideoEditPolicy
    director: ModelProfileDirectorPolicy
    music: ModelProfileMusicPolicy
    license: ModelProfileLicenseInfo | None
    availability: str = "available"


class ModelProfileListResponse(BaseModel):
    profiles: list[ModelProfileResponse]


# ============================================================
# Request Models
# ============================================================


class MusicDurationMode(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"


class MusicVocalGender(str, Enum):
    AUTO = "auto"
    FEMALE = "female"
    MALE = "male"
    MIXED = "mixed"


class MusicAudioRole(str, Enum):
    COVER = "cover"
    REFERENCE_TIMBRE = "reference-timbre"


class MusicAudioInputRequest(BaseModel):
    path: str
    role: MusicAudioRole
    strength: float | None = Field(default=None, ge=0.0, le=1.0)
    durationSeconds: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_strength(self) -> "MusicAudioInputRequest":
        if self.role is MusicAudioRole.COVER and self.strength is None:
            self.strength = 0.5
        elif self.role is MusicAudioRole.REFERENCE_TIMBRE and self.strength is not None:
            raise ValueError("Cover strength is only accepted for Cover audio")
        return self


class GenerateMusicRequest(BaseModel):
    schemaVersion: Literal[1, 2] = 1
    modelProfileId: str
    description: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
    ]
    vocalMode: MusicVocalMode
    lyricsPrompt: str | None = Field(default=None, max_length=2048)
    lyrics: str | None = None
    lyricsThink: bool = False
    lyricsSeed: int | None = Field(default=None, ge=0, le=999_999_999)
    durationSeconds: int = Field(ge=1, le=3600)
    durationMode: MusicDurationMode = MusicDurationMode.MANUAL
    vocalLanguage: str = "en"
    vocalGender: MusicVocalGender = MusicVocalGender.AUTO
    enhanceDescription: bool = False
    bpm: int | None = None
    timeSignature: MusicTimeSignature | None = None
    keyScale: str | None = None
    audioInputs: list[MusicAudioInputRequest] = Field(
        default_factory=lambda: list[MusicAudioInputRequest](), max_length=2
    )
    audioInput: MusicAudioInputRequest | None = None
    weirdness: int = Field(default=50, ge=0, le=100)
    promptInfluence: int = Field(default=75, ge=0, le=100)
    autoFillMetadata: bool | None = None
    variations: int = Field(default=1, ge=1, le=4)

    @model_validator(mode="after")
    def validate_vocal_mode(self) -> "GenerateMusicRequest":
        lyrics = self.lyrics.strip() if self.lyrics is not None else ""
        lyrics_prompt = self.lyricsPrompt.strip() if self.lyricsPrompt is not None else ""
        key_scale = self.keyScale.strip() if self.keyScale is not None else ""
        self.lyrics = lyrics or None
        self.lyricsPrompt = lyrics_prompt or None
        self.keyScale = key_scale or None
        if self.audioInput is not None:
            if self.audioInputs:
                raise ValueError("Use audioInputs or legacy audioInput, not both")
            self.audioInputs = [self.audioInput]
            self.audioInput = None
        if len({item.role for item in self.audioInputs}) != len(self.audioInputs):
            raise ValueError("Only one audio input per role is accepted")
        if self.vocalMode == "custom-lyrics":
            if self.lyrics is not None and len(self.lyrics) > 4096:
                raise ValueError("Custom lyrics must be 4096 characters or fewer")
        elif self.lyrics is not None:
            raise ValueError("Lyrics are only accepted in Custom Lyrics mode")
        if self.vocalMode == "instrumental" and self.lyricsPrompt is not None:
            raise ValueError("Lyrics Idea is not accepted in Instrumental mode")
        if self.vocalMode == "auto-lyrics" and self.lyricsPrompt is not None:
            raise ValueError("Auto Lyrics uses the song description")
        has_cover = any(
            item.role is MusicAudioRole.COVER for item in self.audioInputs
        )
        if has_cover:
            if self.vocalMode == "auto-lyrics":
                raise ValueError("Cover vocals require Custom Lyrics")
            if self.vocalMode == "custom-lyrics" and self.lyrics is None:
                raise ValueError("Cover vocals require original Custom Lyrics")
            if self.vocalMode not in {"custom-lyrics", "instrumental"}:
                raise ValueError("Cover requires Custom Lyrics or Instrumental mode")
        return self


class ComposeMusicLyricsRequest(BaseModel):
    modelProfileId: str
    description: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
    ]
    lyricsPrompt: str | None = Field(default=None, max_length=2048)
    vocalLanguage: str = "en"
    durationMode: MusicDurationMode = MusicDurationMode.AUTO
    durationSeconds: int = Field(default=60, ge=5, le=360)
    think: bool = False
    seed: int | None = Field(default=None, ge=0, le=999_999_999)


class SfxVideoInputRequest(BaseModel):
    path: str
    trimStartTime: float | None = Field(default=None, ge=0)
    trimDuration: float | None = Field(default=None, gt=0)


class GenerateSfxRequest(BaseModel):
    modelProfileId: str
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]
    negativePrompt: str = Field(default="", max_length=512)
    durationSeconds: int = Field(ge=1, le=20)
    seed: int | None = Field(default=None, ge=0, le=999_999_999)
    video: SfxVideoInputRequest | None = None


class GenerateSfxResponse(BaseModel):
    status: str
    audio_path: str | None = None
    resolvedSeed: int | None = None


class MediaUpscaleMethod(BaseModel):
    id: Literal["lanczos", "flashvsr", "flashvsr2pass", "seedvr2", "ltx25"]
    label: str
    mediaKinds: list[Literal["image", "video"]]
    scales: list[float]


class MediaUpscaleCatalogResponse(BaseModel):
    methods: list[MediaUpscaleMethod]


class MediaUpscaleRequest(BaseModel):
    sourcePath: str
    mediaKind: Literal["image", "video"]
    method: Literal["lanczos", "flashvsr", "flashvsr2pass", "seedvr2", "ltx25"]
    scale: float = Field(gt=0)


class MediaUpscaleResponse(BaseModel):
    status: Literal["complete", "cancelled"]
    media_path: str | None = None


class SpeechReferenceInput(BaseModel):
    path: str
    trimStartTime: float | None = Field(default=None, ge=0)
    trimDuration: float | None = Field(default=None, gt=0)
    mediaDuration: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_trim_bounds(self) -> "SpeechReferenceInput":
        if self.trimDuration is not None:
            if self.mediaDuration is None:
                raise ValueError("trimmed references require their media duration")
            if (self.trimStartTime or 0) + self.trimDuration > self.mediaDuration + 1e-6:
                raise ValueError("trim must stay within the reference audio duration")
        return self


class GenerateSpeechRequest(BaseModel):
    schemaVersion: Literal[1, 2] = 1
    modelProfileId: str
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)]
    referenceAudioPath: str | None = None
    references: list[SpeechReferenceInput] = Field(
        default_factory=lambda: list[SpeechReferenceInput](), max_length=3
    )
    enhancePrompt: bool = False
    seed: int | None = Field(default=None, ge=0, le=999_999_999)

    @model_validator(mode="after")
    def normalize_legacy_reference(self) -> "GenerateSpeechRequest":
        if self.referenceAudioPath is not None and self.references:
            raise ValueError("Use references or legacy referenceAudioPath, not both")
        if self.referenceAudioPath is not None:
            self.references = [SpeechReferenceInput(path=self.referenceAudioPath)]
            self.referenceAudioPath = None
        return self


class GenerateSpeechResponse(BaseModel):
    status: str
    audio_path: str | None = None
    resolvedSeed: int | None = None


class MediaCrop(BaseModel):
    aspectRatio: Literal["freeform", "1:1", "4:3", "3:4", "16:9", "9:16"]
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self) -> "MediaCrop":
        epsilon = 1e-6
        if self.x + self.width > 1 + epsilon or self.y + self.height > 1 + epsilon:
            raise ValueError("crop must stay within normalized media bounds")
        return self


class GenerateVideoInputMedia(BaseModel):
    id: str | None = None
    alias: str | None = None
    type: Literal["image", "video", "audio"] = "image"
    path: str
    trimStartTime: float | None = Field(default=None, ge=0)
    trimDuration: float | None = Field(default=None, gt=0)
    crop: MediaCrop | None = None
    useAudioTrack: bool = False
    role: VideoInputMediaRole

    @model_validator(mode="after")
    def validate_crop_media_type(self) -> "GenerateVideoInputMedia":
        if self.type == "audio" and self.crop is not None:
            raise ValueError("crop is only supported for image and video media")
        return self


def _default_video_input_media() -> list[GenerateVideoInputMedia]:
    return []


class GenerateVideoShotPrompt(BaseModel):
    seconds: int = Field(ge=1, le=20)
    prompt: NonEmptyPrompt


def _default_video_shot_prompts() -> list[GenerateVideoShotPrompt]:
    return []


VisualAspectRatio = Literal[
    "1:1", "16:9", "9:16", "21:9", "9:21", "4:3", "3:4", "3:2", "2:3"
]
ReframeAspectMode = VisualAspectRatio | Literal["custom"]


class ReframePadding(BaseModel):
    top: int = Field(ge=0)
    bottom: int = Field(ge=0)
    left: int = Field(ge=0)
    right: int = Field(ge=0)


class ReframeOptions(BaseModel):
    aspectMode: ReframeAspectMode
    padding: ReframePadding
    controlVideoStartTime: float = Field(ge=0)
    controlVideoDuration: float = Field(gt=0)


VideoToolId = Literal[
    "extend",
    "relight",
    "colorize",
    "clean_plate",
    "lip_dub",
    "decompression",
    "sdr_to_hdr",
    "remove_glare",
    "deblur",
]


class GenerateVideoRequest(BaseModel):
    prompt: str = ""
    enhancePrompt: bool = False
    resolution: str = "540p"
    model: str = "fast"
    modelProfileId: str | None = None
    styleId: str | None = Field(default=None, max_length=128)
    cameraMotion: VideoCameraMotion = "none"
    negativePrompt: str = ""
    duration: str = "2"
    fps: str = "24"
    audio: str = "false"
    imagePath: str | None = None
    audioPath: str | None = None
    aspectRatio: VisualAspectRatio = "16:9"
    inputMedia: list[GenerateVideoInputMedia] = Field(default_factory=_default_video_input_media)
    videoPromptType: str | None = None
    useAudioTrack: bool = True
    shotPrompts: list[GenerateVideoShotPrompt] = Field(default_factory=_default_video_shot_prompts)
    reframe: ReframeOptions | None = None
    videoTool: VideoToolId | None = None

    @model_validator(mode="after")
    def validate_prompt_or_shots(self) -> "GenerateVideoRequest":
        if not self.prompt.strip() and not self.shotPrompts and self.reframe is None:
            raise ValueError("prompt is required unless shotPrompts or reframe are provided")
        return self


class DirectorKeyframePoint(str, Enum):
    START = "start"
    CENTRE = "centre"
    END = "end"


class DirectorImageKeyframeInput(BaseModel):
    assetId: str | None = None
    path: str
    point: DirectorKeyframePoint
    strength: float = Field(default=1.0, ge=0.0, le=1.0)


class DirectorPromptSegmentInput(BaseModel):
    id: str
    startFrame: int = Field(ge=0)
    endFrameExclusive: int = Field(gt=0)
    prompt: str = ""
    keyframe: DirectorImageKeyframeInput | None = None


class DirectorContinueVideoInput(BaseModel):
    assetId: str | None = None
    path: str
    timelineDurationFrames: int = Field(gt=0)
    trimStartTime: float = Field(default=0.0, ge=0)
    trimDuration: float = Field(gt=0)
    useSourceAudio: bool = False


class DirectorGuideAudioInput(BaseModel):
    assetId: str | None = None
    path: str
    trimStartTime: float = Field(default=0.0, ge=0)
    trimDuration: float = Field(gt=0)
    strength: float = Field(default=1.0, ge=0.0, le=1.0)


class DirectorGuidanceInput(BaseModel):
    mode: Literal["human_motion", "depth", "ingredients"]
    assetId: str | None = None
    path: str
    trimStartTime: float | None = Field(default=None, ge=0)
    trimDuration: float | None = Field(default=None, gt=0)
    timelineDurationFrames: int | None = Field(default=None, gt=0)
    strength: float = Field(default=1.0, ge=0.0, le=1.0)
    useSourceAudio: bool = False
    referenceDescription: str = ""


class GenerateDirectorRequest(BaseModel):
    schemaVersion: Literal[1]
    modelProfileId: str
    resolutionTier: str
    aspectRatio: str
    fps: int = Field(gt=0)
    requestedDurationSeconds: float = Field(gt=0)
    durationFrames: int = Field(gt=0)
    generateAudio: bool = True
    promptRelayEpsilon: float = Field(default=1e-3, ge=1e-4, le=0.99)
    globalPrompt: str = ""
    promptSegments: list[DirectorPromptSegmentInput]
    continueVideo: DirectorContinueVideoInput | None = None
    guideAudio: DirectorGuideAudioInput | None = None
    guidance: DirectorGuidanceInput | None = None


class GenerateDirectorResponse(BaseModel):
    status: str
    video_path: str | None = None
    seed: int | None = None
    resolvedFrameCount: int | None = None
    compiledPrompt: str | None = None
    warnings: list[str] = Field(default_factory=list)


class GenerateImageInputMedia(BaseModel):
    id: str | None = None
    type: Literal["image"] = "image"
    path: str
    crop: MediaCrop | None = None
    role: Literal[
        "reference_subject",
        "reference_people_objects",
        "control_image",
        "control_pose",
        "control_depth",
        "control_canny",
    ]


class ImageEditImage(BaseModel):
    path: str


class ImageEditPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class ImageEditBrushOperation(BaseModel):
    kind: Literal["brush"]
    size: float = Field(gt=0, le=0.5)
    points: list[ImageEditPoint] = Field(min_length=1)


class ImageEditRectangleOperation(BaseModel):
    kind: Literal["rectangle"]
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class ImageEditEllipseOperation(BaseModel):
    kind: Literal["ellipse"]
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


ImageEditMaskOperation = Annotated[
    ImageEditBrushOperation
    | ImageEditRectangleOperation
    | ImageEditEllipseOperation,
    Field(discriminator="kind"),
]


class ImageEditMaskRecipe(BaseModel):
    schemaVersion: Literal[1]
    operations: list[ImageEditMaskOperation] = Field(min_length=1)


class ImageEditOutpaintPadding(BaseModel):
    top: float = Field(ge=0)
    bottom: float = Field(ge=0)
    left: float = Field(ge=0)
    right: float = Field(ge=0)


class ImageEditOutpaintRecipe(BaseModel):
    aspectMode: ReframeAspectMode
    padding: ImageEditOutpaintPadding

    @model_validator(mode="after")
    def validate_padding(self) -> ImageEditOutpaintRecipe:
        if (
            self.padding.top
            + self.padding.bottom
            + self.padding.left
            + self.padding.right
            <= 0
        ):
            raise ValueError("Outpainting requires padding on at least one edge")
        return self


class GenerateImageEdit(BaseModel):
    image: ImageEditImage
    mask: ImageEditMaskRecipe | None = None
    outpaint: ImageEditOutpaintRecipe | None = None


def _default_image_input_media() -> list[GenerateImageInputMedia]:
    return []


class GenerateImageRequest(BaseModel):
    prompt: Annotated[str, StringConstraints(strip_whitespace=True)] = ""
    enhancePrompt: bool = False
    width: int = 1024
    height: int = 1024
    numSteps: int = 4
    numImages: int = 1
    # Phase 4 curated profile path. When set, the backend resolves the
    # profile, validates the tier/aspect, and overrides width/height with
    # the curated exact WxH. Raw width/height still accepted for
    # backwards compatibility but arbitrary frontend model_type values
    # cannot bypass the curated profile layer.
    modelProfileId: str | None = None
    aspectRatio: VisualAspectRatio | None = None
    resolutionTier: Literal["540p", "720p", "1080p", "1440p", "2160p"] | None = None
    inputMedia: list[GenerateImageInputMedia] = Field(default_factory=_default_image_input_media)
    edit: GenerateImageEdit | None = None

    @model_validator(mode="after")
    def validate_prompt(self) -> "GenerateImageRequest":
        if not self.prompt and (self.edit is None or self.edit.outpaint is None):
            raise ValueError("prompt is required unless an outpaint edit is provided")
        return self


class SuggestGapPromptRequest(BaseModel):
    beforePrompt: str = ""
    afterPrompt: str = ""
    beforeFrame: str | None = None
    afterFrame: str | None = None
    gapDuration: float = 5
    mode: str = "t2v"
    inputImage: str | None = None


class RetakeRequest(BaseModel):
    video_path: str
    start_time: float
    duration: float
    prompt: str = ""
    mode: str = "replace_audio_and_video"


class IcLoraDownloadRequest(BaseModel):
    model: str


class IcLoraExtractRequest(BaseModel):
    video_path: str
    conditioning_type: str = "canny"
    frame_time: float = 0


class IcLoraImageInput(BaseModel):
    path: str
    frame: int = 0
    strength: float = 1.0


def _default_ic_lora_images() -> list[IcLoraImageInput]:
    return []


class IcLoraGenerateRequest(BaseModel):
    video_path: str
    lora_path: str
    conditioning_type: str = "canny"
    prompt: NonEmptyPrompt
    conditioning_strength: float = 1.0
    seed: int = 42
    height: int = 512
    width: int = 768
    num_frames: int = 121
    frame_rate: float = 24
    num_inference_steps: int = 30
    cfg_guidance_scale: float = 1.0
    negative_prompt: str = ""
    images: list[IcLoraImageInput] = Field(default_factory=_default_ic_lora_images)


# ============================================================
# Persistent generation queue API
# ============================================================


class QueuedImageGeneration(BaseModel):
    kind: Literal["image.generate"]
    payload: GenerateImageRequest


class QueuedVideoGeneration(BaseModel):
    kind: Literal["video.generate"]
    payload: GenerateVideoRequest


class QueuedMusicGeneration(BaseModel):
    kind: Literal["audio.music"]
    payload: GenerateMusicRequest


class QueuedSfxGeneration(BaseModel):
    kind: Literal["audio.sfx"]
    payload: GenerateSfxRequest


class QueuedSpeechGeneration(BaseModel):
    kind: Literal["audio.speech"]
    payload: GenerateSpeechRequest


class QueuedUpscaleGeneration(BaseModel):
    kind: Literal["media.upscale"]
    payload: MediaUpscaleRequest


class QueuedRetakeGeneration(BaseModel):
    kind: Literal["video.retake"]
    payload: RetakeRequest


class QueuedDirectorGeneration(BaseModel):
    kind: Literal["director.generate"]
    payload: GenerateDirectorRequest


QueuedGenerationPayload: TypeAlias = Annotated[
    QueuedImageGeneration | QueuedVideoGeneration | QueuedMusicGeneration | QueuedSfxGeneration
    | QueuedSpeechGeneration | QueuedUpscaleGeneration | QueuedRetakeGeneration | QueuedDirectorGeneration,
    Field(discriminator="kind"),
]


class GenerationJobSummary(BaseModel):
    label: str = Field(max_length=256)
    mediaKind: Literal["image", "video", "audio"]
    operation: str = Field(max_length=128)
    promptPreview: str | None = Field(default=None, max_length=512)
    modelLabel: str | None = Field(default=None, max_length=256)
    badges: list[Annotated[str, Field(max_length=96)]] | None = Field(
        default=None, max_length=8
    )
    referenceThumbnailUrl: str | None = Field(default=None, max_length=2048)
    projectName: str | None = Field(default=None, max_length=256)
    variationCount: int | None = Field(default=None, ge=1, le=100)


class GenerationQueueSubmitRequest(BaseModel):
    schemaVersion: Literal[1]
    clientRequestId: str = Field(min_length=1, max_length=256)
    job: QueuedGenerationPayload
    summary: GenerationJobSummary
    clientContext: dict[str, Any]


class GenerationQueueAdmission(BaseModel):
    jobId: str
    status: str
    queuePosition: int
    revision: int
    duplicate: bool


class GenerationQueueOrderRequest(BaseModel):
    expectedRevision: int = Field(ge=0)
    jobIds: list[str]


class GenerationQueueCancelResponse(BaseModel):
    id: str
    status: str


class GenerationQueuePersistenceRef(BaseModel):
    kind: Literal["asset", "take", "director_document", "clip_update", "reference_draft"]
    id: str = Field(min_length=1, max_length=256)
    parentId: str | None = Field(default=None, min_length=1, max_length=256)


class GenerationQueueAcknowledgedOutput(BaseModel):
    outputIndex: int = Field(ge=0)
    refs: list[GenerationQueuePersistenceRef] = Field(min_length=1)


class GenerationQueueAcknowledgementRequest(BaseModel):
    consumer: Literal["electron-project-persistence", "electron-reference-library-persistence"]
    projectId: str = Field(min_length=1, max_length=256)
    persistedAt: str
    outputs: list[GenerationQueueAcknowledgedOutput]


class GenerationQueueJobDetail(BaseModel):
    id: str
    kind: str
    status: str
    summary: dict[str, Any]
    clientContext: dict[str, Any]
    result: dict[str, Any] | None = None
    error: str | None = None
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    acknowledgedAt: str | None = None
