"""Director Mode orchestration over shared generation state and WanGP bridge."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, cast

from _routes._errors import HTTPError
from api_types import GenerateDirectorRequest, GenerateDirectorResponse
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from model_profiles import get_video_profile, resolve_resolution
from model_profiles.profiles import AspectRatio, ResolutionTier
from server_utils.media_validation import (
    validate_audio_file,
    validate_image_file,
    validate_video_file,
)
from services.director_compiler import (
    DirectorValidationError,
    DirectorWanGPPlan,
    compile_director_request,
)
from services.video_clip import extract_audio_clip, extract_video_clip, probe_video_metadata
from services.wangp_bridge import WanGPBridge
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)


class DirectorGenerationHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        generation_handler: GenerationHandler,
        outputs_dir: Path,
        config: RuntimeConfig,
        wangp_bridge: WanGPBridge,
    ) -> None:
        super().__init__(state, lock)
        self._generation = generation_handler
        self._outputs_dir = outputs_dir
        self._config = config
        self._wangp_bridge = wangp_bridge

    def generate(self, request: GenerateDirectorRequest) -> GenerateDirectorResponse:
        if not self._config.wangp_enabled:
            raise HTTPError(503, "WANGP_REQUIRED: Director generation requires WanGP.")
        if self._generation.is_generation_running():
            raise HTTPError(409, "Generation already in progress")

        self._generation.start_generation_job(uuid.uuid4().hex[:8])
        temporary_paths: list[Path] = []
        try:
            profile = get_video_profile(request.modelProfileId)
            if profile is None or not profile.visible or not profile.director.enabled:
                raise HTTPError(400, "DIRECTOR_PROFILE_NOT_SUPPORTED")
            if not self._wangp_bridge.get_status().available:
                raise HTTPError(503, "DIRECTOR_MODEL_UNAVAILABLE")

            prepared = request.model_copy(deep=True)
            for segment in prepared.promptSegments:
                if segment.keyframe:
                    segment.keyframe.path = str(self._validate_image(segment.keyframe.path))
            if prepared.continueVideo:
                source = self._validate_video(prepared.continueVideo.path)
                self._validate_video_trim(
                    source,
                    prepared.continueVideo.trimStartTime,
                    prepared.continueVideo.trimDuration,
                )
                trimmed = extract_video_clip(
                    source,
                    start_time=prepared.continueVideo.trimStartTime,
                    duration=prepared.continueVideo.trimDuration,
                    output_dir=self._outputs_dir,
                )
                temporary_paths.append(trimmed)
                prepared.continueVideo.path = str(trimmed)
            guide_audio_is_active = bool(
                prepared.guideAudio
                and not (
                    prepared.continueVideo
                    and prepared.continueVideo.useSourceAudio
                )
                and not (
                    prepared.guidance
                    and prepared.guidance.mode != "ingredients"
                    and prepared.guidance.useSourceAudio
                )
            )
            if prepared.guideAudio and guide_audio_is_active:
                source = self._validate_audio(prepared.guideAudio.path)
                trimmed = extract_audio_clip(
                    source,
                    start_time=prepared.guideAudio.trimStartTime,
                    duration=prepared.guideAudio.trimDuration,
                    output_dir=self._outputs_dir,
                )
                temporary_paths.append(trimmed)
                prepared.guideAudio.path = str(trimmed)
            if prepared.guidance:
                guidance = prepared.guidance
                if guidance.mode == "ingredients":
                    guidance.path = str(self._validate_image(guidance.path))
                else:
                    source = self._validate_video(guidance.path)
                    if guidance.trimDuration is None:
                        if probe_video_metadata(source) is None:
                            raise HTTPError(
                                400,
                                f"DIRECTOR_MEDIA_TYPE_MISMATCH: unreadable video: {source}",
                            )
                        guidance.path = str(source)
                    else:
                        self._validate_video_trim(
                            source,
                            guidance.trimStartTime or 0.0,
                            guidance.trimDuration,
                        )
                        trimmed = extract_video_clip(
                            source,
                            start_time=guidance.trimStartTime or 0.0,
                            duration=guidance.trimDuration,
                            output_dir=self._outputs_dir,
                        )
                        temporary_paths.append(trimmed)
                        guidance.path = str(trimmed)

            plan = compile_director_request(prepared, profile.director)
            try:
                resolution = resolve_resolution(
                    profile,
                    cast(ResolutionTier, prepared.resolutionTier),
                    cast(AspectRatio, prepared.aspectRatio),
                )
            except KeyError as exc:
                raise HTTPError(
                    400,
                    "DIRECTOR_WANGP_MAPPING_UNAVAILABLE: resolution/aspect",
                ) from exc
            seed = self._resolve_seed()
            profile_settings = self._wangp_bridge.resolve_profiles(
                profile.wangp_model_type,
                accelerator_profile_id=profile.wangp_accelerator_profile_for(
                    profile.wangp_model_type
                ),
                preset_profile_id=profile.wangp_preset_profile_id,
            )
            profile_settings.update(profile.wangp_default_settings)
            settings = self._build_settings(
                plan,
                profile.wangp_model_type,
                f"{resolution[0]}x{resolution[1]}",
                prepared.fps,
                seed,
                profile_settings,
                prepared.promptRelayEpsilon,
            )
            output_path = self._wangp_bridge.generate_director_video(
                settings=settings,
                on_progress=self._generation.update_progress,
                is_cancelled=self._generation.is_generation_cancelled,
            )
            self._generation.complete_generation(output_path)
            return GenerateDirectorResponse(
                status="complete",
                video_path=output_path,
                seed=seed,
                resolvedFrameCount=plan.output_frame_count,
                compiledPrompt=plan.compiled_prompt,
                warnings=list(plan.warnings),
            )
        except DirectorValidationError as exc:
            self._generation.fail_generation(str(exc))
            raise HTTPError(400, str(exc)) from exc
        except HTTPError as exc:
            self._generation.fail_generation(exc.detail)
            raise
        except Exception as exc:
            self._generation.fail_generation(str(exc))
            if "cancelled" in str(exc).lower():
                return GenerateDirectorResponse(status="cancelled")
            raise HTTPError(500, str(exc)) from exc
        finally:
            for path in temporary_paths:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove temporary Director media: %s", path)

    def _resolve_seed(self) -> int | None:
        settings = self.state.app_settings
        if settings.seed_locked:
            return settings.locked_seed
        return None

    @staticmethod
    def _validate_image(path: str) -> Path:
        return DirectorGenerationHandler._validate_media(validate_image_file, path)

    @staticmethod
    def _validate_video(path: str) -> Path:
        return DirectorGenerationHandler._validate_media(validate_video_file, path)

    @staticmethod
    def _validate_audio(path: str) -> Path:
        return DirectorGenerationHandler._validate_media(validate_audio_file, path)

    @staticmethod
    def _validate_media(validator: Callable[[str], Path], path: str) -> Path:
        try:
            return validator(path)
        except HTTPError as exc:
            code = (
                "DIRECTOR_MISSING_ASSET"
                if "not found" in exc.detail.lower()
                else "DIRECTOR_MEDIA_TYPE_MISMATCH"
            )
            raise HTTPError(400, f"{code}: {exc.detail}") from exc

    @staticmethod
    def _validate_video_trim(path: Path, start_time: float, duration: float) -> None:
        metadata = probe_video_metadata(path)
        if metadata is None:
            raise HTTPError(
                400,
                f"DIRECTOR_MEDIA_TYPE_MISMATCH: unreadable video: {path}",
            )
        if start_time + duration > metadata.duration_seconds + 0.05:
            raise HTTPError(
                400,
                "DIRECTOR_INVALID_FRAME_RANGE: video trim exceeds source duration",
            )

    def _build_settings(
        self,
        plan: DirectorWanGPPlan,
        model_type: str,
        resolution: str,
        fps: int,
        seed: int | None,
        profile_defaults: dict[str, object],
        prompt_relay_epsilon: float,
    ) -> dict[str, object]:
        app_settings = self.state.app_settings
        settings = dict(profile_defaults)
        settings.update(
            {
                "model_type": model_type,
                "prompt": plan.compiled_prompt,
                "multi_prompts_gen_type": "FG",
                "resolution": resolution,
                "video_length": plan.generation_frame_count,
                "duration_seconds": plan.generation_duration_seconds,
                "force_fps": fps,
                "sliding_window_size": 481,
                "video_output_codec": app_settings.output_settings.video_codec,
                "video_container": app_settings.output_settings.video_container,
                "audio_output_codec": app_settings.output_settings.audio_codec,
                "metadata_type": app_settings.output_settings.metadata_mode,
            }
        )
        if seed is not None:
            settings["seed"] = seed
        if plan.uses_prompt_relay:
            custom_settings = settings.get("custom_settings")
            settings["custom_settings"] = {
                **(custom_settings if isinstance(custom_settings, dict) else {}),
                "prompt_relay_epsilon": prompt_relay_epsilon,
            }
        if plan.continue_video_path:
            settings["video_source"] = plan.continue_video_path
        if plan.start_image_path:
            settings["image_start"] = plan.start_image_path
        if plan.end_image_path:
            settings["image_end"] = plan.end_image_path
        if plan.image_prompt_type:
            settings["image_prompt_type"] = plan.image_prompt_type
        if plan.injected_frames:
            settings["image_refs"] = [frame.path for frame in plan.injected_frames]
            settings["frames_positions"] = " ".join(
                str(frame.frame + 1) for frame in plan.injected_frames
            )
            settings["input_video_strength"] = plan.injected_frames[0].strength
        if plan.ingredients_image_path:
            settings["image_refs"] = [plan.ingredients_image_path]
        if plan.control_video_path:
            settings["video_guide"] = plan.control_video_path
        if plan.video_prompt_type:
            settings["video_prompt_type"] = plan.video_prompt_type
        if plan.guide_audio_path:
            settings["audio_guide"] = plan.guide_audio_path
        if plan.audio_prompt_type:
            settings["audio_prompt_type"] = plan.audio_prompt_type
        return settings
