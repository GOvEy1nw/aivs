"""Curated ACE-Step text-to-music generation orchestration."""

from __future__ import annotations

import uuid
from pathlib import Path
from threading import RLock

from _routes._errors import HTTPError
from api_types import (
    ComposeMusicLyricsRequest,
    ComposeMusicLyricsResponse,
    GenerateMusicRequest,
    GenerateMusicResponse,
    MusicAudioInputRequest,
    MusicEffectiveSettings,
    MusicOutputResponse,
)
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from model_profiles import get_image_profile, get_music_profile, get_video_profile
from model_profiles.profiles import ModelProfile
from progress_types import ModelDownloadProgress
from services.audio_metadata import probe_audio_metadata
from services.music_request_resolver import (
    ResolvedAudioTask,
    normalize_music_key_scale,
    resolve_ace_model_mode,
    resolve_audio_task,
    resolve_prompt_influence,
    resolve_vocal_description,
    resolve_vocal_language,
    resolve_weirdness,
)
from services.wangp_bridge import WanGPBridge, resolve_audio_performance_profile
from state.app_state_types import AppState

_AUDIO_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}


def _resolve_prompt_enhancer(profile: ModelProfile, req: GenerateMusicRequest) -> str:
    if profile.id != "minimax_music3":
        return "T" if req.vocalMode == "auto-lyrics" else ""
    if req.vocalMode == "auto-lyrics":
        return "T1,B2O" if req.enhanceDescription else "T1"
    return "B2O" if req.enhanceDescription else ""


class MusicGenerationHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        generation_handler: GenerationHandler,
        outputs_dir: Path,
        wangp_bridge: WanGPBridge,
    ) -> None:
        super().__init__(state, lock)
        self._generation = generation_handler
        self._outputs_dir = outputs_dir.resolve()
        self._wangp_bridge = wangp_bridge

    def generate(self, req: GenerateMusicRequest) -> GenerateMusicResponse:
        if self._generation.is_generation_running():
            raise HTTPError(409, "Generation already in progress")
        if not self._wangp_bridge.get_status().available:
            raise HTTPError(503, "WANGP_UNAVAILABLE: WanGP is not available.")

        profile = self._validate_profile_and_request(req)
        generation_id = uuid.uuid4().hex[:8]
        self._generation.start_generation_job(generation_id)
        outputs: list[MusicOutputResponse] = []
        created_paths: list[Path] = []

        try:
            wangp_default_settings = self._wangp_bridge.resolve_profiles(
                profile.wangp_model_type,
                accelerator_profile_id=profile.wangp_accelerator_profile_for(
                    profile.wangp_model_type
                ),
                preset_profile_id=profile.wangp_preset_profile_id,
            )
            wangp_default_settings.update(profile.wangp_default_settings)
            audio_task, effective_duration, warnings = self._resolve_input_audio(req, profile)
            resolved_lyrics, response_lyrics = self._resolve_lyrics(req)
            self._generation.update_progress("preparing_music", 0)
            try:
                key_scale = normalize_music_key_scale(req.keyScale)
                language = resolve_vocal_language(
                    req.vocalLanguage,
                    instrumental=req.vocalMode == "instrumental",
                    supported_languages=profile.music.supported_languages,
                )
            except ValueError as exc:
                raise HTTPError(400, str(exc)) from exc
            description, description_modifiers = resolve_vocal_description(
                req.description,
                req.vocalGender,
                instrumental=req.vocalMode == "instrumental",
            )
            model_mode = resolve_ace_model_mode(
                req.durationMode, req.enhanceDescription
            )
            temperature = resolve_weirdness(req.weirdness)
            lm_guidance_scale = resolve_prompt_influence(req.promptInfluence)
            settings = self.state.app_settings.model_copy(deep=True)
            base_seed = settings.locked_seed if settings.seed_locked else None

            for variation_index in range(req.variations):
                if self._generation.is_generation_cancelled():
                    raise HTTPError(409, "GENERATION_CANCELLED: Music generation was cancelled.")
                seed = base_seed + variation_index if base_seed is not None else None

                def on_progress(
                    phase: str,
                    progress: int,
                    *detail: object,
                    _variation_index: int = variation_index,
                ) -> None:
                    aggregate = round(
                        ((_variation_index + progress / 100.0) / req.variations) * 100
                    )
                    download = detail[12] if len(detail) > 12 else None
                    download = download if isinstance(download, ModelDownloadProgress) else None
                    status = detail[6] if len(detail) > 6 else None
                    self._generation.update_progress(
                        phase,
                        aggregate,
                        section_index=_variation_index + 1,
                        section_count=req.variations,
                        status_detail=status if isinstance(status, str) else None,
                        model_download=download,
                        progress_unit=download.unit if download is not None else None,
                    )

                default_settings = dict(wangp_default_settings)
                default_settings["prompt_enhancer"] = _resolve_prompt_enhancer(profile, req)
                path = self._wangp_bridge.generate_music(
                    description=description,
                    lyrics=resolved_lyrics,
                    duration_seconds=effective_duration,
                    bpm=req.bpm,
                    key_scale=key_scale,
                    time_signature=req.timeSignature,
                    language=language,
                    model_mode=model_mode,
                    temperature=temperature,
                    top_p=0.9,
                    top_k=0,
                    lm_guidance_scale=lm_guidance_scale,
                    source_audio_path=audio_task.source_path,
                    reference_timbre_path=audio_task.reference_path,
                    audio_prompt_type=audio_task.prompt_type,
                    cover_strength=audio_task.cover_strength,
                    seed=seed,
                    model_type=profile.wangp_model_type,
                    default_settings=default_settings,
                    on_progress=on_progress,
                    is_cancelled=self._generation.is_generation_cancelled,
                )
                output_path = Path(path).resolve()
                created_paths.append(output_path)
                self._generation.update_progress(
                    "saving_output",
                    round(((variation_index + 1) / req.variations) * 100),
                    section_index=variation_index + 1,
                    section_count=req.variations,
                )
                metadata = probe_audio_metadata(output_path)
                outputs.append(
                    MusicOutputResponse(
                        path=str(output_path),
                        durationSeconds=metadata.duration_seconds,
                        sampleRate=metadata.sample_rate,
                        channels=metadata.channels,
                        format=metadata.format,
                        variationIndex=variation_index,
                        seed=seed,
                    )
                )

            self._generation.complete_generation([output.path for output in outputs])
            return GenerateMusicResponse(
                status="success",
                outputs=outputs,
                resolvedLyrics=response_lyrics,
                effectiveSettings=MusicEffectiveSettings(
                    modelMode=model_mode,
                    durationMode=req.durationMode.value,
                    fallbackDurationSeconds=req.durationSeconds,
                    effectiveDurationSeconds=effective_duration,
                    temperature=temperature,
                    topP=0.9,
                    topK=0,
                    lmGuidanceScale=lm_guidance_scale,
                    vocalLanguage=language or "auto",
                    vocalGender=req.vocalGender.value,
                    audioTask=audio_task.prompt_type,
                    coverStrength=audio_task.cover_strength,
                    descriptionModifiers=list(description_modifiers),
                    requestedPerformanceProfile=settings.performance_profile,
                    effectiveAudioProfile=resolve_audio_performance_profile(
                        settings.performance_profile
                    ),
                ),
                warnings=warnings,
            )
        except HTTPError as exc:
            self._cleanup_outputs(created_paths)
            if not self._generation.is_generation_cancelled():
                self._generation.fail_generation(exc.detail)
            raise
        except Exception as exc:
            self._cleanup_outputs(created_paths)
            if self._generation.is_generation_cancelled():
                raise HTTPError(409, "GENERATION_CANCELLED: Music generation was cancelled.") from exc
            self._generation.fail_generation(str(exc))
            raise HTTPError(500, f"MUSIC_GENERATION_FAILED: {exc}") from exc

    def _validate_profile_and_request(self, req: GenerateMusicRequest) -> ModelProfile:
        profile = (
            get_music_profile(req.modelProfileId)
            or get_image_profile(req.modelProfileId)
            or get_video_profile(req.modelProfileId)
        )
        if profile is None:
            raise HTTPError(404, "UNKNOWN_MODEL_PROFILE: Unknown music model profile.")
        if not profile.visible:
            raise HTTPError(404, "MODEL_PROFILE_HIDDEN: Music model profile is hidden.")
        if profile.media_type != "audio":
            raise HTTPError(400, "MODEL_PROFILE_NOT_MUSIC: Profile is not an audio model.")
        policy = profile.music
        if not policy.enabled or not profile.text_to_audio:
            raise HTTPError(400, "MUSIC_MODE_UNSUPPORTED: Profile does not support music.")
        supported_modes = {
            "instrumental": policy.supports_instrumental,
            "auto-lyrics": policy.supports_auto_lyrics,
            "custom-lyrics": policy.supports_custom_lyrics,
        }
        if not supported_modes[req.vocalMode]:
            raise HTTPError(400, "MUSIC_MODE_UNSUPPORTED: Vocal mode is unsupported.")
        if req.vocalMode == "custom-lyrics" and req.lyrics is None:
            raise HTTPError(400, "MUSIC_CUSTOM_LYRICS_REQUIRED: Write or compose lyrics before generating.")
        if not policy.duration_min_seconds <= req.durationSeconds <= policy.duration_max_seconds:
            raise HTTPError(400, "MUSIC_DURATION_OUT_OF_RANGE: Duration is outside profile bounds.")
        if req.variations > policy.max_variations:
            raise HTTPError(400, "MUSIC_VARIATIONS_OUT_OF_RANGE: Too many variations.")
        if req.bpm is not None and (
            not policy.supports_bpm or not policy.bpm_min <= req.bpm <= policy.bpm_max
        ):
            raise HTTPError(400, "MUSIC_BPM_OUT_OF_RANGE: BPM is outside profile bounds.")
        if req.timeSignature is not None and (
            not policy.supports_time_signature
            or req.timeSignature not in policy.time_signatures
        ):
            raise HTTPError(400, "MUSIC_TIME_SIGNATURE_UNSUPPORTED: Unsupported time signature.")
        if req.keyScale is not None and not policy.supports_key_scale:
            raise HTTPError(400, "MUSIC_KEY_SCALE_INVALID: Key/scale is unsupported.")
        try:
            normalize_music_key_scale(req.keyScale)
        except ValueError as exc:
            raise HTTPError(400, str(exc)) from exc
        if req.vocalLanguage != "auto" and (
            not policy.supports_vocal_language
            or req.vocalLanguage.casefold() not in policy.supported_languages
        ):
            raise HTTPError(400, "MUSIC_LANGUAGE_UNSUPPORTED: Unsupported language.")
        for audio_input in req.audioInputs:
            if audio_input.role == "cover" and not policy.supports_cover:
                raise HTTPError(400, "MUSIC_COVER_UNSUPPORTED: Cover is unsupported.")
            if (
                audio_input.role == "reference-timbre"
                and not policy.supports_reference_timbre
            ):
                raise HTTPError(
                    400, "MUSIC_REFERENCE_AUDIO_UNSUPPORTED: Reference Timbre is unsupported."
                )
        return profile

    def _resolve_lyrics(
        self,
        req: GenerateMusicRequest,
    ) -> tuple[str, str | None]:
        if req.vocalMode == "instrumental":
            return "[Instrumental]", None
        if req.vocalMode == "custom-lyrics" and req.lyrics is not None:
            return req.lyrics, req.lyrics
        return req.description, None

    def compose_lyrics(
        self, req: ComposeMusicLyricsRequest
    ) -> ComposeMusicLyricsResponse:
        if self._generation.is_generation_running():
            raise HTTPError(409, "Generation already in progress")
        if not self._wangp_bridge.get_status().available:
            raise HTTPError(503, "WANGP_UNAVAILABLE: WanGP is not available.")
        profile = get_music_profile(req.modelProfileId)
        if profile is None or not profile.visible:
            raise HTTPError(404, "MUSIC_PROFILE_NOT_FOUND: Unknown music model profile.")
        if not profile.music.supports_compose_lyrics:
            raise HTTPError(400, "MUSIC_COMPOSE_UNAVAILABLE: Compose Lyrics is unsupported.")
        if req.think and not profile.music.supports_compose_thinking:
            raise HTTPError(400, "MUSIC_COMPOSE_UNAVAILABLE: Think is unsupported.")
        if req.vocalLanguage != "auto" and (
            req.vocalLanguage.casefold() not in profile.music.supported_languages
        ):
            raise HTTPError(400, "MUSIC_LANGUAGE_UNSUPPORTED: Unsupported language.")

        self._generation.start_generation_job(f"lyrics-{uuid.uuid4().hex[:8]}")
        try:
            with self._generation.helper_lane():
                lyrics = self._compose_text(
                    profile=profile,
                    description=req.description,
                    lyrics_prompt=req.lyricsPrompt,
                    language=req.vocalLanguage,
                    duration_seconds=req.durationSeconds,
                    think=req.think,
                    seed=req.seed,
                    error_prefix="MUSIC_COMPOSE_UNAVAILABLE",
                )
            self._generation.complete_generation([])
            return ComposeMusicLyricsResponse(lyrics=lyrics, usedThinking=req.think)
        except HTTPError as exc:
            if not self._generation.is_generation_cancelled():
                self._generation.fail_generation(exc.detail)
            raise

    def _compose_text(
        self,
        *,
        profile: ModelProfile,
        description: str,
        lyrics_prompt: str | None,
        language: str,
        duration_seconds: int,
        think: bool,
        seed: int | None,
        error_prefix: str,
    ) -> str:
        self._generation.update_progress("composing_lyrics", 0)
        if self._generation.is_generation_cancelled():
            raise HTTPError(409, "GENERATION_CANCELLED: Music generation was cancelled.")
        try:
            lyrics = self._wangp_bridge.compose_music_lyrics(
                description=description,
                lyrics_prompt=lyrics_prompt,
                language=language,
                duration_seconds=duration_seconds,
                model_type=profile.wangp_model_type,
                think=think,
                seed=seed,
            )
        except Exception as exc:
            raise HTTPError(
                503,
                f"{error_prefix}: Compose Lyrics needs the local Prompt Enhancer model pack.",
            ) from exc
        if self._generation.is_generation_cancelled():
            raise HTTPError(409, "GENERATION_CANCELLED: Music generation was cancelled.")
        self._generation.update_progress("composing_lyrics", 100)
        return lyrics

    def _resolve_input_audio(
        self,
        req: GenerateMusicRequest,
        profile: ModelProfile,
    ) -> tuple[ResolvedAudioTask, int, list[str]]:
        audio_task = resolve_audio_task(req.audioInputs)
        effective_duration = req.durationSeconds
        warnings: list[str] = []
        if not req.audioInputs:
            return audio_task, effective_duration, warnings

        normalized_inputs: list[MusicAudioInputRequest] = []
        for audio_input in req.audioInputs:
            audio_path = Path(audio_input.path).expanduser().resolve()
            if not audio_path.is_file():
                raise HTTPError(
                    400, "MUSIC_AUDIO_FILE_NOT_FOUND: Audio input was not found."
                )
            if audio_path.suffix.casefold() not in _AUDIO_SUFFIXES:
                raise HTTPError(
                    400, "MUSIC_AUDIO_FILE_UNSUPPORTED: Unsupported audio format."
                )
            if audio_input.role == "cover":
                metadata = probe_audio_metadata(audio_path)
                if metadata.duration_seconds is None:
                    raise HTTPError(
                        400,
                        "MUSIC_COVER_DURATION_OUT_OF_RANGE: Could not read source duration.",
                    )
                if not (
                    profile.music.duration_min_seconds
                    <= metadata.duration_seconds
                    <= profile.music.duration_max_seconds
                ):
                    raise HTTPError(
                        400,
                        "MUSIC_COVER_DURATION_OUT_OF_RANGE: Cover audio is outside profile bounds.",
                    )
                effective_duration = round(metadata.duration_seconds)
                if effective_duration != req.durationSeconds:
                    warnings.append(
                        "Cover source duration replaced the requested duration."
                    )
            normalized_inputs.append(
                audio_input.model_copy(update={"path": str(audio_path)})
            )
        audio_task = resolve_audio_task(normalized_inputs)
        return audio_task, effective_duration, warnings

    def _cleanup_outputs(self, paths: list[Path]) -> None:
        for path in paths:
            try:
                if path.is_relative_to(self._outputs_dir):
                    path.unlink(missing_ok=True)
            except OSError:
                continue
