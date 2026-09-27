"""Image generation orchestration handler."""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, cast

from _routes._errors import HTTPError
from api_types import GenerateImageInputMedia, GenerateImageRequest, GenerateImageResponse
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from model_profiles import get_image_profile, is_combination_supported, resolve_resolution
from model_profiles.profiles import ImageInputRole, ModelProfile
from server_utils.media_validation import validate_image_file
from services.media_crop import crop_image_media
from services.image_edit import materialize_image_edit
from services.reframe_wangp_mapping import ReframePadding, map_reframe_to_wangp
from services.wangp_bridge import WanGPBridge
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)

_REFERENCE_ROLE_VALUES: dict[ImageInputRole, str] = {
    "reference_subject": "KI",
    "reference_people_objects": "I",
}

_CONTROL_ROLE_VALUES: dict[ImageInputRole, str] = {
    "control_image": "V",
    "control_pose": "PV",
    "control_depth": "DV",
    "control_canny": "EV",
}


@dataclass(frozen=True)
class ResolvedImageInputSettings:
    settings: dict[str, object]
    model_type: str | None = None
    temporary_paths: tuple[Path, ...] = ()
    enhancer_has_image: bool = False


class ImageGenerationHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        generation_handler: GenerationHandler,
        config: RuntimeConfig,
        wangp_bridge: WanGPBridge,
    ) -> None:
        super().__init__(state, lock)
        self._generation = generation_handler
        self._config = config
        self._wangp_bridge = wangp_bridge

    def generate(self, req: GenerateImageRequest) -> GenerateImageResponse:
        if self._config.wangp_enabled:
            return self._generate_via_wangp(req)

        raise HTTPError(503, "WANGP_REQUIRED: Image generation is only available via WanGP.")

    def _generate_via_wangp(self, req: GenerateImageRequest) -> GenerateImageResponse:
        if self._generation.is_generation_running():
            raise HTTPError(409, "Generation already in progress")

        profile, width, height = self._resolve_profile_and_dimensions(req)
        max_total_variations = profile.max_total_variations if profile is not None else 12
        max_parallel_images = profile.max_parallel_images if profile is not None else 1
        num_images = max(1, min(max_total_variations, req.numImages))

        generation_id = uuid.uuid4().hex[:8]
        settings = self.state.app_settings.model_copy(deep=True)
        seed = (
            settings.locked_seed
            if settings.seed_locked
            else secrets.randbelow(2_147_483_648 - num_images + 1)
        )

        # Profile-driven WanGP settings: model_type + model defaults,
        # merged with the request's explicit num_steps and the resolved
        # exact WxH. The frontend never sends a vague value like '1080p'
        # — the backend resolves it to e.g. '1920x1088'.
        wangp_model_type = profile.wangp_model_type if profile is not None else self._config.wangp_image_model_type
        temporary_crop_paths: list[Path] = []
        generation_started = False
        try:
            effective_req, temporary_crop_paths = self._apply_input_crops(req)
            input_settings = self._resolve_input_media_settings(
                effective_req,
                profile,
                width,
                height,
            )
            temporary_crop_paths.extend(input_settings.temporary_paths)
            if input_settings.model_type is not None:
                wangp_model_type = input_settings.model_type
            if profile is not None:
                wangp_default_settings = self._wangp_bridge.resolve_profiles(
                    wangp_model_type,
                    accelerator_profile_id=profile.wangp_accelerator_profile_for(wangp_model_type),
                    preset_profile_id=profile.wangp_preset_profile_id,
                )
                wangp_default_settings.update(profile.wangp_default_settings)
            else:
                wangp_default_settings = {}
            output_settings = settings.output_settings
            wangp_default_settings.update(
                {
                    "image_output_codec": f"{output_settings.image_codec}_{output_settings.image_quality}"
                    if output_settings.image_codec in {"jpeg", "webp"}
                    else output_settings.image_codec,
                    "metadata_type": output_settings.metadata_mode,
                }
            )
            wangp_default_settings.update(input_settings.settings)
            wangp_default_settings["prompt_enhancer"] = (
                "TI" if input_settings.enhancer_has_image else "T"
            ) if req.enhancePrompt else ""
            num_steps = self._resolve_num_steps(req, wangp_default_settings, wangp_model_type)

            self._generation.start_generation_job(generation_id)
            generation_started = True
            output_paths: list[str] = []
            for offset in range(0, num_images, max_parallel_images):
                if self._generation.is_generation_cancelled():
                    raise RuntimeError("Generation was cancelled")
                chunk_size = min(max_parallel_images, num_images - offset)
                self._generation.update_progress("inference", int(offset * 100 / num_images), offset, num_images)
                output_paths.extend(
                    self._wangp_bridge.generate_images(
                        prompt=req.prompt.strip() or "outpaint",
                        width=width,
                        height=height,
                        num_steps=num_steps,
                        num_images=chunk_size,
                        seed=seed + offset,
                        on_progress=self._generation.update_progress,
                        is_cancelled=self._generation.is_generation_cancelled,
                        model_type=wangp_model_type,
                        default_settings=wangp_default_settings,
                    )
                )
            self._generation.complete_generation(output_paths)
            return GenerateImageResponse(
                status="complete",
                image_paths=output_paths,
                resolvedSeed=seed,
            )
        except HTTPError as e:
            # Propagate intentional client-error responses unchanged.
            if generation_started:
                self._generation.fail_generation(e.detail)
            raise
        except Exception as e:
            if generation_started:
                self._generation.fail_generation(str(e))
            if "cancelled" in str(e).lower():
                logger.info("WanGP image generation cancelled by user")
                return GenerateImageResponse(status="cancelled")
            raise HTTPError(500, str(e)) from e
        finally:
            for media_path in temporary_crop_paths:
                try:
                    media_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove temporary image crop: %s", media_path)

    def _apply_input_crops(
        self,
        req: GenerateImageRequest,
    ) -> tuple[GenerateImageRequest, list[Path]]:
        temporary_paths: list[Path] = []
        try:
            input_media: list[GenerateImageInputMedia] = []
            for media in req.inputMedia:
                if media.crop is None:
                    input_media.append(media)
                    continue
                source_path = self._validate_input_image(media.path)
                cropped_path = crop_image_media(source_path, media.crop)
                temporary_paths.append(cropped_path)
                input_media.append(media.model_copy(update={"path": str(cropped_path)}))
            return req.model_copy(update={"inputMedia": input_media}), temporary_paths
        except HTTPError:
            for path in temporary_paths:
                path.unlink(missing_ok=True)
            raise
        except Exception as exc:
            for path in temporary_paths:
                path.unlink(missing_ok=True)
            raise HTTPError(400, f"MEDIA_CROP_FAILED: {exc}") from exc

    def _resolve_profile_and_dimensions(
        self, req: GenerateImageRequest
    ) -> tuple[ModelProfile | None, int, int]:
        """Resolve a GenerateImageRequest into (profile, width, height).

        When ``modelProfileId`` is set, the curated profile is the source
        of truth: the request's tier/aspect are validated against the
        profile's allowed lists and the exact WxH is resolved from the
        curated table. Raw ``width``/``height`` are still accepted when no
        profile is supplied, for backwards compatibility — but arbitrary
        frontend-provided WanGP model types cannot bypass the curated
        profile layer because the model_type is always derived from a
        profile id (or the server's configured default).
        """
        if req.modelProfileId is None:
            width = (req.width // 16) * 16
            height = (req.height // 16) * 16
            return None, width, height

        profile = get_image_profile(req.modelProfileId)
        if profile is None:
            raise HTTPError(400, f"UNKNOWN_MODEL_PROFILE: {req.modelProfileId}")
        if not profile.visible:
            raise HTTPError(400, f"MODEL_PROFILE_HIDDEN: {req.modelProfileId}")

        tier = req.resolutionTier or profile.default_resolution_tier
        aspect = req.aspectRatio or profile.default_aspect_ratio

        if tier not in profile.allowed_resolution_tiers:
            raise HTTPError(
                400,
                f"UNSUPPORTED_RESOLUTION_TIER: {tier} for {profile.display_name}",
            )
        if aspect not in profile.allowed_aspect_ratios:
            raise HTTPError(
                400,
                f"UNSUPPORTED_ASPECT_RATIO: {aspect} for {profile.display_name}",
            )
        if not is_combination_supported(profile, tier, aspect):
            # No curated exact WxH for this combination — do not invent one.
            raise HTTPError(
                400,
                f"NO_CURATED_RESOLUTION: {profile.display_name} {tier} {aspect}",
            )

        width, height = resolve_resolution(profile, tier, aspect)
        return profile, width, height

    def _resolve_input_media_settings(
        self,
        req: GenerateImageRequest,
        profile: ModelProfile | None,
        width: int,
        height: int,
    ) -> ResolvedImageInputSettings:
        if req.edit is not None:
            return self._resolve_edit_settings(req, profile, width, height)
        if not req.inputMedia:
            return ResolvedImageInputSettings(settings={})
        if profile is None:
            raise HTTPError(400, "IMAGE_INPUT_NOT_SUPPORTED: image inputs require a curated model profile")
        policy = profile.input_media
        if not policy.supports_image_inputs:
            raise HTTPError(400, f"IMAGE_INPUT_NOT_SUPPORTED: {profile.display_name} does not support image inputs")
        if len(req.inputMedia) > policy.max_images:
            raise HTTPError(400, f"TOO_MANY_IMAGE_INPUTS: {profile.display_name} supports {policy.max_images} input image(s)")

        supported_roles = {role.role for role in policy.roles}
        reference_paths: list[Path] = []
        reference_roles: list[ImageInputRole] = []
        control_path: Path | None = None
        control_role: ImageInputRole | None = None

        for input_media in req.inputMedia:
            if input_media.role not in supported_roles:
                raise HTTPError(400, f"UNSUPPORTED_IMAGE_INPUT_ROLE: {input_media.role} for {profile.display_name}")
            image_path = self._validate_input_image(input_media.path)
            role = input_media.role
            if role in _REFERENCE_ROLE_VALUES:
                reference_paths.append(image_path)
                reference_roles.append(role)
                continue
            if role in _CONTROL_ROLE_VALUES:
                if control_path is not None:
                    raise HTTPError(400, "MULTIPLE_CONTROL_IMAGES_NOT_SUPPORTED")
                control_path = image_path
                control_role = role
                continue
            raise HTTPError(400, f"UNSUPPORTED_IMAGE_INPUT_ROLE: {role} for {profile.display_name}")

        if reference_paths and control_path is not None:
            raise HTTPError(400, "MIXED_IMAGE_INPUT_ROLES_NOT_SUPPORTED")

        settings = dict(policy.wangp_default_settings)
        model_type = policy.wangp_model_type

        if reference_paths:
            if not profile.reference_images:
                raise HTTPError(400, f"REFERENCE_IMAGE_NOT_SUPPORTED: {profile.display_name}")
            value = "KI" if "reference_subject" in reference_roles else "I"
            self._require_wangp_choice(profile, "image_ref_choices", value)
            settings.update({
                "video_prompt_type": value,
                "image_refs": [str(path.resolve()) for path in reference_paths],
            })
            return ResolvedImageInputSettings(
                settings=settings,
                model_type=model_type,
                enhancer_has_image=True,
            )

        if control_path is not None and control_role is not None:
            if not profile.control_image:
                raise HTTPError(400, f"CONTROL_IMAGE_NOT_SUPPORTED: {profile.display_name}")
            value = _CONTROL_ROLE_VALUES[control_role]
            self._require_wangp_choice(profile, "guide_preprocessing", value)
            settings.update({
                "video_prompt_type": "V",
                "image_guide": str(control_path.resolve()),
                "guide_preprocessing": value,
            })
            return ResolvedImageInputSettings(settings=settings, model_type=model_type)

        return ResolvedImageInputSettings(settings=settings, model_type=model_type)

    def _resolve_edit_settings(
        self,
        req: GenerateImageRequest,
        profile: ModelProfile | None,
        width: int,
        height: int,
    ) -> ResolvedImageInputSettings:
        edit = req.edit
        if edit is None:
            return ResolvedImageInputSettings(settings={})
        if profile is None:
            raise HTTPError(
                400,
                "IMAGE_EDIT_NOT_SUPPORTED: image Edit requires a curated model profile",
            )

        policy = profile.input_media
        if not profile.reference_images:
            raise HTTPError(
                400,
                f"IMAGE_EDIT_NOT_SUPPORTED: {profile.display_name}",
            )
        if len(req.inputMedia) + 1 > policy.max_images:
            raise HTTPError(
                400,
                f"TOO_MANY_IMAGE_INPUTS: {profile.display_name} supports "
                f"{policy.max_images} total Edit image(s)",
            )

        master_path = self._validate_input_image(edit.image.path)
        supported_roles = {role.role for role in policy.roles}
        reference_paths: list[Path] = []
        for input_media in req.inputMedia:
            if (
                input_media.role not in supported_roles
                or input_media.role not in _REFERENCE_ROLE_VALUES
            ):
                raise HTTPError(
                    400,
                    f"UNSUPPORTED_IMAGE_EDIT_REFERENCE_ROLE: "
                    f"{input_media.role} for {profile.display_name}",
                )
            reference_paths.append(self._validate_input_image(input_media.path))

        settings = dict(policy.wangp_default_settings)
        model_type = policy.wangp_model_type
        masked_edit = edit.mask is not None or edit.outpaint is not None
        if not masked_edit:
            self._require_wangp_choice(profile, "image_ref_choices", "KI")
            settings.update(
                {
                    "image_mode": 1,
                    "video_prompt_type": "KI",
                    "image_refs": [
                        str(path.resolve())
                        for path in [master_path, *reference_paths]
                    ],
                }
            )
            return ResolvedImageInputSettings(
                settings=settings,
                model_type=model_type,
                enhancer_has_image=True,
            )

        if edit.mask is not None and not profile.inpainting:
            raise HTTPError(
                400,
                f"INPAINTING_NOT_SUPPORTED: {profile.display_name}",
            )
        outpaint_settings: dict[str, str] = {}
        if edit.outpaint is not None:
            if not profile.outpainting:
                raise HTTPError(
                    400,
                    f"OUTPAINTING_NOT_SUPPORTED: {profile.display_name}",
                )
            if (
                edit.outpaint.aspectMode != "custom"
                and req.aspectRatio != edit.outpaint.aspectMode
            ):
                raise HTTPError(
                    400,
                    "OUTPAINT_ASPECT_MISMATCH: request aspect ratio must match "
                    "the outpaint recipe",
                )
            padding = edit.outpaint.padding
            outpaint = map_reframe_to_wangp(
                edit.outpaint.aspectMode,
                ReframePadding(
                    top=max(1, round(padding.top)) if padding.top > 0 else 0,
                    bottom=max(1, round(padding.bottom)) if padding.bottom > 0 else 0,
                    left=max(1, round(padding.left)) if padding.left > 0 else 0,
                    right=max(1, round(padding.right)) if padding.right > 0 else 0,
                ),
                video_width=width,
                video_height=height,
            )
            outpaint_settings = {
                "video_guide_outpainting": outpaint.video_guide_outpainting,
                "video_guide_outpainting_ratio": outpaint.video_guide_outpainting_ratio,
            }
        if reference_paths and not profile.masked_edit_references:
            raise HTTPError(
                400,
                f"MASKED_EDIT_REFERENCES_NOT_SUPPORTED: {profile.display_name}",
            )

        self._require_wangp_choice(profile, "mask_preprocessing", "A")
        if reference_paths:
            self._require_wangp_choice(profile, "image_ref_choices", "I")
        guide_path, mask_path = materialize_image_edit(
            master_path,
            width=width,
            height=height,
            mask_recipe=edit.mask,
            outpaint=edit.outpaint,
            background=(255, 0, 0)
            if profile.wangp_model_type in {"flux2_klein_4b", "flux2_klein_9b"}
            else (127, 127, 127),
        )
        prompt_type = "VAGI" if reference_paths else "VAG"
        settings.update(
            {
                "image_mode": 2,
                "model_mode": 0,
                "video_prompt_type": prompt_type,
                "image_guide": str(guide_path.resolve()),
                "image_mask": str(mask_path.resolve()),
                "denoising_strength": 1.0,
                "masking_strength": 1.0,
                **outpaint_settings,
            }
        )
        if reference_paths:
            settings["image_refs"] = [
                str(path.resolve()) for path in reference_paths
            ]
        return ResolvedImageInputSettings(
            settings=settings,
            model_type=model_type,
            temporary_paths=(guide_path, mask_path),
            enhancer_has_image=bool(reference_paths),
        )

    @staticmethod
    def _validate_input_image(raw_path: str) -> Path:
        try:
            return validate_image_file(raw_path)
        except HTTPError as exc:
            detail = exc.detail
            if detail.startswith("Image file not found"):
                raise HTTPError(400, f"IMAGE_INPUT_FILE_NOT_FOUND: {raw_path}") from exc
            if detail.startswith("Invalid image file"):
                raise HTTPError(400, f"INVALID_IMAGE_INPUT_FILE: {raw_path}") from exc
            raise

    @staticmethod
    def _require_wangp_choice(profile: ModelProfile, setting_name: str, value: str) -> None:
        setting_values = profile.input_media.setting_values or profile.wangp_metadata.setting_values
        video_settings = setting_values.get("video_prompt_type")
        if not isinstance(video_settings, dict):
            raise HTTPError(400, f"UNSUPPORTED_IMAGE_INPUT_ROLE: {setting_name} unavailable for {profile.display_name}")
        typed_video_settings = cast(dict[str, object], video_settings)
        setting = typed_video_settings.get(setting_name)
        if not isinstance(setting, dict):
            raise HTTPError(400, f"UNSUPPORTED_IMAGE_INPUT_ROLE: {setting_name} unavailable for {profile.display_name}")
        typed_setting = cast(dict[str, object], setting)

        values: set[str] = set()
        choices = typed_setting.get("choices")
        if isinstance(choices, list):
            typed_choices = cast(list[object], choices)
            for choice in typed_choices:
                if isinstance(choice, dict):
                    typed_choice = cast(dict[str, object], choice)
                    choice_value = typed_choice.get("value")
                    if isinstance(choice_value, str):
                        values.add(choice_value)
        selection = typed_setting.get("selection")
        if isinstance(selection, list):
            typed_selection = cast(list[object], selection)
            values.update(item for item in typed_selection if isinstance(item, str))

        if value not in values:
            raise HTTPError(400, f"UNSUPPORTED_IMAGE_INPUT_ROLE: {value} unavailable for {profile.display_name}")

    @staticmethod
    def _resolve_num_steps(
        req: GenerateImageRequest,
        wangp_default_settings: dict[str, object],
        wangp_model_type: str,
    ) -> int:
        """Pick the inference step count for the WanGP call.

        Profile default settings take precedence (e.g. Krea 2 Turbo pins
        num_inference_steps=8), then the request's explicit numSteps,
        then the z_image 8-step floor inherited from the Phase 3 bridge.
        """
        default_steps = wangp_default_settings.get("num_inference_steps")
        if isinstance(default_steps, int):
            return max(1, default_steps)
        steps = max(1, req.numSteps)
        if wangp_model_type.startswith("z_image"):
            return max(8, steps)
        return steps
