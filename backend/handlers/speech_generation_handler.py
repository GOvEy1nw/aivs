"""Curated WanGP speech generation orchestration."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from threading import RLock

from _routes._errors import HTTPError
from api_types import GenerateSpeechRequest, GenerateSpeechResponse, SpeechReferenceInput
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from model_profiles import get_music_profile
from model_profiles.profiles import ModelProfile
from services.video_clip import extract_audio_clip
from services.wangp_bridge import WanGPBridge
from server_utils.media_validation import validate_audio_file
from state.app_state_types import AppState

logger = logging.getLogger(__name__)


class SpeechGenerationHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, generation_handler: GenerationHandler, outputs_dir: Path, wangp_bridge: WanGPBridge) -> None:
        super().__init__(state, lock)
        self._generation = generation_handler
        self._outputs_dir = outputs_dir
        self._wangp_bridge = wangp_bridge

    def generate(self, req: GenerateSpeechRequest) -> GenerateSpeechResponse:
        if not self._wangp_bridge.get_status().available:
            raise HTTPError(503, "WANGP_UNAVAILABLE: WanGP is not available.")
        profile = self._validate_profile(req)
        references = self._validate_references(req, profile)
        if len(references) >= 2:
            self._validate_dialogue(req.text, len(references))
        try:
            self._generation.start_generation_job(f"speech-{uuid.uuid4().hex[:8]}")
        except RuntimeError as exc:
            raise HTTPError(409, "Generation already in progress") from exc
        temporary_paths: list[Path] = []
        try:
            wangp_default_settings = self._wangp_bridge.resolve_profiles(
                profile.wangp_model_type,
                accelerator_profile_id=profile.wangp_accelerator_profile_for(
                    profile.wangp_model_type
                ),
                preset_profile_id=profile.wangp_preset_profile_id,
            )
            wangp_default_settings.update(profile.wangp_default_settings)
            effective_references = [
                self._materialize_reference(reference, temporary_paths)
                for reference in references
            ]
            if self._generation.is_generation_cancelled():
                return GenerateSpeechResponse(status="cancelled")
            audio_path = self._wangp_bridge.generate_speech(
                text=req.text,
                model_type=profile.wangp_model_type,
                default_settings=wangp_default_settings,
                reference_audio_paths=[str(path) for path in effective_references],
                enhance_prompt=req.enhancePrompt,
                seed=req.seed,
                on_progress=self._generation.update_progress,
                is_cancelled=self._generation.is_generation_cancelled,
            )
            if self._generation.is_generation_cancelled():
                Path(audio_path).unlink(missing_ok=True)
                return GenerateSpeechResponse(status="cancelled")
            self._generation.complete_generation(audio_path)
            return GenerateSpeechResponse(status="complete", audio_path=audio_path, resolvedSeed=req.seed)
        except HTTPError as exc:
            self._generation.fail_generation(exc.detail)
            raise
        except Exception as exc:
            if self._generation.is_generation_cancelled():
                return GenerateSpeechResponse(status="cancelled")
            self._generation.fail_generation(str(exc))
            raise HTTPError(500, f"SPEECH_GENERATION_FAILED: {exc}") from exc
        finally:
            for path in temporary_paths:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove temporary speech reference: %s", path)

    @staticmethod
    def _validate_profile(req: GenerateSpeechRequest) -> ModelProfile:
        profile = get_music_profile(req.modelProfileId)
        if profile is None or not profile.visible:
            raise HTTPError(404, "SPEECH_PROFILE_NOT_FOUND: Unknown speech model profile.")
        if profile.media_type != "audio" or not profile.speech.tts or profile.speech.handler != "speech_generation":
            raise HTTPError(400, "SPEECH_MODE_UNSUPPORTED: Profile does not support speech generation.")
        return profile

    @staticmethod
    def _validate_references(req: GenerateSpeechRequest, profile: ModelProfile) -> list[SpeechReferenceInput]:
        if len(req.references) > profile.speech.max_reference_inputs:
            raise HTTPError(400, "SPEECH_REFERENCE_LIMIT: Too many voice references.")
        if not req.references and profile.speech.reference_required:
            raise HTTPError(400, "SPEECH_REFERENCE_REQUIRED: This speech model requires a reference voice.")
        if req.references and not profile.speech.reference_voice:
            raise HTTPError(400, "SPEECH_REFERENCE_UNSUPPORTED: This speech model does not support a reference voice.")
        for reference in req.references:
            try:
                reference.path = str(validate_audio_file(reference.path))
            except Exception as exc:
                raise HTTPError(400, f"SPEECH_REFERENCE_INVALID: {exc}") from exc
        return req.references

    def _materialize_reference(self, reference: SpeechReferenceInput, temporary_paths: list[Path]) -> Path:
        source = Path(reference.path)
        if reference.trimDuration is None:
            return source
        try:
            trimmed = extract_audio_clip(source, start_time=reference.trimStartTime or 0, duration=reference.trimDuration, output_dir=self._outputs_dir)
        except Exception as exc:
            raise HTTPError(400, f"SPEECH_REFERENCE_TRIM_FAILED: {exc}") from exc
        temporary_paths.append(trimmed)
        return trimmed

    @staticmethod
    def _validate_dialogue(text: str, reference_count: int) -> None:
        speakers = {
            int(match.group(1))
            for match in re.finditer(r"^Speaker ([123]):\s*(?=\S)", text, re.MULTILINE)
        }
        expected = set(range(1, reference_count + 1))
        if speakers != expected:
            labels = " and ".join(f"Speaker {index}" for index in sorted(expected))
            raise HTTPError(400, f"SPEECH_DIALOGUE_INVALID: {reference_count} voice references require non-empty {labels} segments.")
