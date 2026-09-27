"""Video generation orchestration handler."""

from __future__ import annotations

import logging
import math
import re
import secrets
import uuid
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, cast

from api_types import GenerateVideoInputMedia, GenerateVideoRequest, GenerateVideoResponse
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from model_profiles import get_video_profile, is_combination_supported, resolve_resolution
from model_profiles.profiles import AspectRatio, ModelProfile, ResolutionTier, StyleDefinition
from services.media_crop import crop_image_media, crop_video_media
from services.wangp_bridge import WanGPBridge
from services.reframe_wangp_mapping import ReframePadding, map_reframe_to_wangp
from services.video_clip import extract_audio_clip, extract_video_clip, probe_video_metadata
from server_utils.media_validation import (
    normalize_optional_path,
    validate_audio_file,
    validate_image_file,
    validate_video_file,
)
from state.app_state_types import AppState
if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)

MULTI_SHOT_LORA_FILENAME = "LTX-2.3_Cinematic_hardcut.safetensors"
MULTI_SHOT_LORA_STRENGTH = "1.0"
VIDEO_TOOL_LORA_URLS = {
    "relight": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/black-magic-ic-lora-450.safetensors",
    "colorize": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/ltx-2.3-22b-ic-lora-colorization-0.9.safetensors",
    "clean_plate": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/ltx-2.3-22b-ic-lora-clean-plate-1.0.safetensors",
    "lip_dub": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/ltx-2.3-22b-ic-lora-lipdub-0.9.safetensors",
    "decompression": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/ltx-2.3-22b-ic-lora-decompression-0.9.safetensors",
    "sdr_to_hdr": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/ltx-2.3-22b-ic-lora-hdr-0.9.safetensors",
    "remove_glare": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/lens-remover-ltx23-ic-lora.safetensors",
    "deblur": "https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/ltx-2.3-22b-ic-lora-deblur-0.9.safetensors",
}


_H3_PROFILE_IDS = {"minimax_h3_fast", "minimax_h3_quality"}
_H3_REFERENCE_ROLES = {"reference_image", "reference_video", "reference_audio", "depth"}
_H3_FL_ONLY_ROLES = {"control_video", "audio_guide"}
_H3_ALIAS_PATTERN = re.compile(r"@(image|video|audio)([1-9]\d*)")


def _h3_reference_media(req: GenerateVideoRequest) -> list[GenerateVideoInputMedia]:
    return [media for media in req.inputMedia if media.role in _H3_REFERENCE_ROLES]


def _validate_and_compile_h3_prompt(
    req: GenerateVideoRequest, prompt: str
) -> tuple[str, bool]:
    singleton_roles = {"start_image", "end_image", "control_video", "audio_guide"}
    role_types = {
        "start_image": "image",
        "end_image": "image",
        "reference_image": "image",
        "control_video": "video",
        "reference_video": "video",
        "depth": "video",
        "audio_guide": "audio",
        "reference_audio": "audio",
    }
    for role in singleton_roles:
        if sum(media.role == role for media in req.inputMedia) > 1:
            raise HTTPError(400, "H3_DUPLICATE_SINGLETON_MEDIA")
    for media in req.inputMedia:
        expected_type = role_types.get(media.role)
        if expected_type is not None and media.type != expected_type:
            raise HTTPError(400, "H3_MEDIA_TYPE_MISMATCH")

    references = _h3_reference_media(req)
    uses_ref2va = bool(references)
    if uses_ref2va and any(media.role in _H3_FL_ONLY_ROLES for media in req.inputMedia):
        raise HTTPError(400, "H3_REF2VA_FL2VA_MEDIA_MIX")

    by_role = {
        role: [media for media in references if media.role == role]
        for role in _H3_REFERENCE_ROLES
    }
    limits = {"reference_image": 9, "reference_video": 2, "reference_audio": 2, "depth": 1}
    for role, limit in limits.items():
        if len(by_role[role]) > limit:
            raise HTTPError(400, f"H3_{role.upper()}_LIMIT")
    if by_role["depth"] and by_role["reference_video"]:
        raise HTTPError(400, "H3_DEPTH_REFERENCE_VIDEO_MIX")
    if len(references) > 12:
        raise HTTPError(400, "H3_COMBINED_REFERENCE_LIMIT")
    active_videos = [*by_role["reference_video"], *by_role["depth"]]
    soundtrack_count = len(active_videos) if any(media.useAudioTrack for media in active_videos) else 0
    if any(media.useAudioTrack for media in active_videos) and not all(media.useAudioTrack for media in active_videos):
        raise HTTPError(400, "H3_SOUNDTRACKS_MUST_BE_SYNCHRONIZED")
    if soundtrack_count and by_role["reference_audio"]:
        raise HTTPError(400, "H3_SOUNDTRACK_AUDIO_REFERENCE_MIX")
    if len(by_role["reference_audio"]) + soundtrack_count > 2:
        raise HTTPError(400, "H3_AUDIO_REFERENCE_LIMIT")
    visual_count = len(by_role["reference_image"]) + len(active_videos)
    if len(by_role["reference_audio"]) + soundtrack_count > visual_count:
        raise HTTPError(400, "H3_AUDIO_REFERENCE_REQUIRES_VISUAL_REFERENCE")
    trimmed_total = 0.0
    for media in [*active_videos, *by_role["reference_audio"]]:
        if media.trimDuration is None:
            continue
        if not 2 <= media.trimDuration <= 15:
            raise HTTPError(400, "H3_REFERENCE_DURATION_LIMIT")
        trimmed_total += media.trimDuration
    if trimmed_total > 15:
        raise HTTPError(400, "H3_REFERENCE_TOTAL_DURATION_LIMIT")

    aliases: dict[str, str] = {}
    expected_alias_kind = {
        "reference_image": "image",
        "reference_video": "video",
        "depth": "video",
        "reference_audio": "audio",
    }
    for media in references:
        if media.alias and re.fullmatch(
            rf"@{expected_alias_kind[media.role]}[1-9]\d*", media.alias
        ) is None:
            raise HTTPError(400, "H3_INVALID_MEDIA_ALIAS")
    start_end_count = sum(media.role in {"start_image", "end_image"} for media in req.inputMedia)
    for index, media in enumerate(by_role["reference_image"], start=1):
        if media.alias:
            aliases[media.alias] = f"<Picture {start_end_count + index}>"
    for role, label in (("reference_video", "Video"), ("depth", "Video"), ("reference_audio", "Audio")):
        for index, media in enumerate(by_role[role], start=1):
            if media.alias:
                aliases[media.alias] = f"<{label} {index}>"

    submitted_aliases = [media.alias for media in references if media.alias]
    if len(set(submitted_aliases)) != len(submitted_aliases):
        raise HTTPError(400, "H3_DUPLICATE_MEDIA_ALIAS")
    aliases_in_prompt = {match.group(0) for match in _H3_ALIAS_PATTERN.finditer(prompt)}
    if not aliases_in_prompt.issubset(aliases):
        raise HTTPError(400, "H3_DANGLING_MEDIA_ALIAS")
    return _H3_ALIAS_PATTERN.sub(lambda match: aliases[match.group(0)], prompt), uses_ref2va


class VideoGenerationHandler(StateHandlerBase):
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

    def generate(self, req: GenerateVideoRequest) -> GenerateVideoResponse:
        if self._config.wangp_enabled:
            return self._generate_via_wangp(req)

        raise HTTPError(503, "WANGP_REQUIRED: Video generation is only available via WanGP.")

    @staticmethod
    def _make_generation_id() -> str:
        return uuid.uuid4().hex[:8]

    def _resolve_seed(self) -> int | None:
        settings = self.state.app_settings
        if settings.seed_locked:
            logger.info("Using locked seed: %s", settings.locked_seed)
            return settings.locked_seed
        return secrets.randbelow(2_147_483_648)

    def _generate_via_wangp(self, req: GenerateVideoRequest) -> GenerateVideoResponse:
        is_h3 = req.modelProfileId in _H3_PROFILE_IDS
        if is_h3 and req.shotPrompts:
            raise HTTPError(400, "H3_MULTI_SHOT_UNSUPPORTED")
        if is_h3 and req.videoTool is not None:
            raise HTTPError(400, "VIDEO_TOOL_NOT_SUPPORTED")
        if self._generation.is_generation_running():
            raise HTTPError(409, "Generation already in progress")

        generation_id = self._make_generation_id()
        self._generation.start_generation_job(generation_id)

        duration = self._parse_forced_numeric_field(req.duration, "INVALID_DURATION")
        fps = self._parse_forced_numeric_field(req.fps, "INVALID_FPS")
        is_reframe = req.reframe is not None
        is_lora_tool = req.videoTool is not None and req.videoTool != "extend"
        looks_like_reframe = (
            req.prompt.strip().lower() == "outpaint" and any(
                media.role == "control_video" for media in req.inputMedia
            )
        )
        if looks_like_reframe and not is_reframe:
            raise HTTPError(400, "REFRAME_OPTIONS_REQUIRED")
        if not req.prompt.strip() and not req.shotPrompts and not is_reframe:
            raise HTTPError(400, "PROMPT_REQUIRED")
        if is_reframe:
            reframe = req.reframe
            assert reframe is not None
            duration = max(2, int(math.ceil(reframe.controlVideoDuration)))
            wangp_prompt = req.prompt.strip() or "outpaint"
        else:
            wangp_prompt, duration = self._resolve_prompt_and_duration(req, duration)

        h3_uses_ref2va = False

        start_image_path = None
        end_image_path = None
        control_video_path = None
        audio_path = normalize_optional_path(req.audioPath)

        video_prompt_type = "VG" if is_reframe or is_lora_tool else req.videoPromptType
        image_prompt_type = None
        audio_prompt_type = "K" if is_reframe or is_lora_tool else None

        legacy_image = normalize_optional_path(req.imagePath)
        if legacy_image:
            start_image_path = legacy_image

        for media in req.inputMedia:
            media_path = normalize_optional_path(media.path)
            if not media_path:
                continue
            if media.role == "start_image":
                start_image_path = media_path
            elif media.role == "end_image":
                end_image_path = media_path
            elif media.role == "control_video":
                control_video_path = media_path
            elif media.role == "audio_guide":
                audio_path = media_path
            elif media.role == "human_motion":
                control_video_path = media_path
                video_prompt_type = "PVG"
                if req.useAudioTrack:
                    audio_path = media_path
                    audio_prompt_type = "K"
                else:
                    audio_prompt_type = "2"
            elif media.role == "human_motion_pose":
                control_video_path = media_path
                video_prompt_type = "OVG"
                if req.useAudioTrack:
                    audio_path = media_path
                    audio_prompt_type = "K"
                else:
                    audio_prompt_type = "2"
            elif media.role == "depth":
                control_video_path = media_path
                video_prompt_type = "DVG"
                if req.useAudioTrack:
                    audio_path = media_path
                    audio_prompt_type = "K"
                else:
                    audio_prompt_type = "2"
            elif media.role == "canny_edges":
                control_video_path = media_path
                video_prompt_type = "EVG"
                if req.useAudioTrack:
                    audio_path = media_path
                    audio_prompt_type = "K"
                else:
                    audio_prompt_type = "2"
            elif media.role == "sdr_to_hdr":
                control_video_path = media_path
                video_prompt_type = "V&G"
                if req.useAudioTrack:
                    audio_path = media_path
                    audio_prompt_type = "K"
                else:
                    audio_prompt_type = "2"
            elif media.role == "continue_video":
                start_image_path = media_path
                image_prompt_type = "V"
            elif media.role == "audio_to_video":
                audio_path = media_path
                audio_prompt_type = "A"
            elif media.role == "reference_voice":
                audio_path = media_path
                audio_prompt_type = "A1OF"

        if req.videoTool == "extend" and not start_image_path:
            raise HTTPError(400, "VIDEO_TOOL_SOURCE_REQUIRED")
        if is_lora_tool and not control_video_path:
            raise HTTPError(400, "VIDEO_TOOL_SOURCE_REQUIRED")

        if is_reframe:
            reframe = req.reframe
            assert reframe is not None
            if not control_video_path:
                for media in req.inputMedia:
                    if media.role == "control_video":
                        control_video_path = normalize_optional_path(media.path)
                        break
            if not control_video_path:
                raise HTTPError(400, "REFRAME_CONTROL_VIDEO_REQUIRED")

        temp_clip_path: Path | None = None
        temp_media_paths: list[Path] = []
        video_guide_outpainting: str | None = None
        video_guide_outpainting_ratio: str | None = None
        output_aspect_ratio = req.aspectRatio
        source_video_frame_count: int | None = None
        input_media_duration: float | None = None

        try:
            profile = self._resolve_video_profile(req)
            style = self._resolve_style(profile, req.styleId, is_reframe=is_reframe, video_tool=req.videoTool)
            if style is not None and style.style_prompt is not None:
                wangp_prompt = f"{wangp_prompt.rstrip()}\n{style.style_prompt}"
            if is_h3:
                wangp_prompt, h3_uses_ref2va = _validate_and_compile_h3_prompt(req, wangp_prompt)
                if h3_uses_ref2va:
                    reference_videos = [media for media in req.inputMedia if media.role in {"reference_video", "depth"}]
                    audio_count = sum(media.role == "reference_audio" for media in req.inputMedia)
                    video_prompt_type = "DV" if any(media.role == "depth" for media in reference_videos) else "V+-" if len(reference_videos) > 1 else "V-" if reference_videos else None
                    soundtrack_enabled = bool(reference_videos and reference_videos[0].useAudioTrack)
                    audio_prompt_type = "K" if soundtrack_enabled else "AB" if audio_count > 1 else "A" if audio_count else None
                elif control_video_path:
                    video_prompt_type = "GV"
                    if audio_path:
                        audio_prompt_type = "A"
                    elif req.useAudioTrack:
                        audio_path = control_video_path
                        audio_prompt_type = "K"
                    else:
                        audio_prompt_type = "2"
            if is_reframe:
                reframe = req.reframe
                assert reframe is not None
                if not profile.control_video:
                    raise HTTPError(400, "REFRAME_NOT_SUPPORTED")
                if not profile.wangp_metadata.capabilities.get("outpainting", False):
                    raise HTTPError(400, "REFRAME_NOT_SUPPORTED")

            self._validate_video_profile_request(
                profile,
                req,
                start_image_path=start_image_path,
                end_image_path=end_image_path,
                control_video_path=control_video_path,
                audio_path=audio_path,
            )
            resolution_tier = cast(ResolutionTier, req.resolution)
            request_aspect_ratio: AspectRatio = req.aspectRatio
            if is_reframe:
                reframe = req.reframe
                assert reframe is not None
                request_aspect_ratio = reframe.aspectMode if reframe.aspectMode != "custom" else req.aspectRatio
            resolved_width, resolved_height = resolve_resolution(
                profile,
                resolution_tier,
                request_aspect_ratio,
            )
            resolved_resolution_label = f"{resolved_width}x{resolved_height}"

            transformed_media_paths: dict[tuple[str, str], str] = {}
            for media in req.inputMedia:
                media_path = normalize_optional_path(media.path)
                if not media_path:
                    continue
                effective_path = media_path
                if media.crop is not None:
                    try:
                        cropped_path = (
                            crop_video_media(effective_path, media.crop)
                            if media.type == "video"
                            else crop_image_media(effective_path, media.crop)
                        )
                    except Exception as exc:
                        raise HTTPError(400, f"MEDIA_CROP_FAILED: {exc}") from exc
                    temp_media_paths.append(cropped_path)
                    effective_path = str(cropped_path)

                if media.trimDuration is None:
                    transformed_media_paths[(media.role, media_path)] = effective_path
                    continue
                if media.type == "audio":
                    trimmed_path = extract_audio_clip(
                        effective_path,
                        start_time=media.trimStartTime or 0.0,
                        duration=media.trimDuration,
                        output_dir=self._outputs_dir,
                    )
                else:
                    trimmed_path = extract_video_clip(
                        effective_path,
                        start_time=media.trimStartTime or 0.0,
                        duration=media.trimDuration,
                        output_dir=self._outputs_dir,
                    )
                temp_media_paths.append(trimmed_path)
                transformed_media_paths[(media.role, media_path)] = str(trimmed_path)
                if media.role != "continue_video":
                    input_media_duration = media.trimDuration

            for media in req.inputMedia:
                media_path = normalize_optional_path(media.path)
                if not media_path:
                    continue
                effective_path = transformed_media_paths.get(
                    (media.role, media_path),
                    media_path,
                )
                if media.role in {"start_image", "continue_video"}:
                    start_image_path = effective_path
                elif media.role == "end_image":
                    end_image_path = effective_path
                elif media.role in {
                    "control_video",
                    "human_motion",
                    "human_motion_pose",
                    "depth",
                    "canny_edges",
                    "sdr_to_hdr",
                }:
                    control_video_path = effective_path
                    if media.role != "control_video" and req.useAudioTrack:
                        audio_path = effective_path
                elif media.role in {
                    "audio_guide",
                    "audio_to_video",
                    "reference_voice",
                }:
                    audio_path = effective_path

            if input_media_duration is not None and not is_reframe and not req.shotPrompts:
                duration = max(2, int(math.ceil(input_media_duration)))

            # continue_video holds a video in start_image_path, so validate as video
            is_start_video = False
            if start_image_path:
                for media in req.inputMedia:
                    original_media_path = normalize_optional_path(media.path)
                    effective_media_path = transformed_media_paths.get(
                        (media.role, original_media_path or ""),
                        original_media_path,
                    )
                    if media.role == "continue_video" and effective_media_path == start_image_path:
                        is_start_video = True
                        break

            if start_image_path:
                validated_start_image_path = str(validate_video_file(start_image_path)) if is_start_video else str(validate_image_file(start_image_path))
            else:
                validated_start_image_path = None

            validated_end_image_path = str(validate_image_file(end_image_path)) if end_image_path else None
            validated_control_video_path = str(validate_video_file(control_video_path)) if control_video_path else None

            if is_reframe:
                reframe = req.reframe
                assert reframe is not None
                if validated_control_video_path is None:
                    raise HTTPError(400, "REFRAME_SOURCE_REQUIRED")
                source_path = Path(validated_control_video_path)
                temp_clip_path = extract_video_clip(
                    source_path,
                    start_time=reframe.controlVideoStartTime,
                    duration=reframe.controlVideoDuration,
                    output_dir=self._outputs_dir,
                )
                validated_control_video_path = str(temp_clip_path)

                padding = ReframePadding(
                    top=reframe.padding.top,
                    bottom=reframe.padding.bottom,
                    left=reframe.padding.left,
                    right=reframe.padding.right,
                )
                outpaint = map_reframe_to_wangp(
                    reframe.aspectMode,
                    padding,
                )
                video_guide_outpainting = outpaint.video_guide_outpainting
                video_guide_outpainting_ratio = outpaint.video_guide_outpainting_ratio
                output_aspect_ratio = outpaint.output_aspect_ratio
                logger.info(
                    "Reframe outpaint mapping: padding=%s outpainting=%r ratio=%r",
                    padding,
                    video_guide_outpainting,
                    video_guide_outpainting_ratio,
                )

            if validated_control_video_path is not None:
                source_metadata = probe_video_metadata(validated_control_video_path)
                if source_metadata is not None:
                    source_video_frame_count = source_metadata.frame_count
                    logger.info(
                        "Using source video frame count for WanGP video_length: frames=%s duration=%.3fs",
                        source_metadata.frame_count,
                        source_metadata.duration_seconds,
                    )
            if source_video_frame_count is None and is_start_video and validated_start_image_path is not None:
                source_metadata = probe_video_metadata(validated_start_image_path)
                if source_metadata is not None:
                    source_video_frame_count = source_metadata.frame_count + duration * fps
                    logger.info(
                        "Extending continue-video for %ss: source_frames=%s output_frames=%s source_duration=%.3fs",
                        duration,
                        source_metadata.frame_count,
                        source_video_frame_count,
                        source_metadata.duration_seconds,
                    )

            is_audio_video = False
            if audio_path:
                if any(
                    media.role
                    in {"human_motion", "human_motion_pose", "depth", "canny_edges", "sdr_to_hdr", "control_video"}
                    for media in req.inputMedia
                    if transformed_media_paths.get(
                        (media.role, normalize_optional_path(media.path) or ""),
                        normalize_optional_path(media.path),
                    )
                    == audio_path
                ):
                    is_audio_video = True

            if audio_path:
                if is_audio_video or audio_path.lower().endswith(('.mp4', '.mov', '.mkv', '.avi', '.webm')):
                    validated_audio_path = str(validate_video_file(audio_path))
                else:
                    validated_audio_path = str(validate_audio_file(audio_path))
            else:
                validated_audio_path = None

            validated_reference_images: list[str] = []
            validated_reference_videos: list[str] = []
            validated_reference_audios: list[str] = []
            if is_h3 and h3_uses_ref2va:
                for media in req.inputMedia:
                    media_path = normalize_optional_path(media.path)
                    if not media_path:
                        continue
                    effective_path = transformed_media_paths.get((media.role, media_path), media_path)
                    if media.role == "reference_image":
                        validated_reference_images.append(str(validate_image_file(effective_path)))
                    elif media.role in {"reference_video", "depth"}:
                        validated_reference_videos.append(str(validate_video_file(effective_path)))
                    elif media.role == "reference_audio":
                        validated_reference_audios.append(str(validate_audio_file(effective_path)))
                if audio_prompt_type == "K":
                    validated_reference_audios = [
                        *validated_reference_videos,
                        *validated_reference_audios,
                    ]

            settings = self.state.app_settings.model_copy(deep=True)
            active_model_type = (
                "minimax_h3_ref2va_pruned"
                if is_h3 and h3_uses_ref2va
                else profile.wangp_model_type
            )
            resolved_profile_settings = self._resolve_wangp_profile_settings(
                profile, active_model_type
            )
            default_settings = dict(resolved_profile_settings)
            default_settings.update(profile.wangp_default_settings)
            default_steps = default_settings.get("num_inference_steps")
            if isinstance(default_steps, int):
                steps = max(1, default_steps)
            else:
                steps = 8 if req.model.strip().lower() == "fast" else max(1, settings.pro_model.steps)
            seed = self._resolve_seed()
            output_settings = settings.output_settings
            default_settings.update(
                {
                    "video_output_codec": output_settings.video_codec,
                    "video_container": output_settings.video_container,
                    "audio_output_codec": output_settings.audio_codec,
                    "image_output_codec": f"{output_settings.image_codec}_{output_settings.image_quality}"
                    if output_settings.image_codec in {"jpeg", "webp"}
                    else output_settings.image_codec,
                    "metadata_type": output_settings.metadata_mode,
                    "keep_intermediate_sliding_windows": 1
                    if output_settings.keep_intermediate_sliding_windows
                    else 0,
                }
            )
            enhancer_has_image = image_prompt_type != "V" and bool(
                validated_start_image_path or validated_end_image_path
            )
            if req.enhancePrompt:
                default_settings["prompt_enhancer"] = (
                    "TI" if enhancer_has_image else "T"
                ) + ("1" if req.shotPrompts else "")
            else:
                default_settings["prompt_enhancer"] = ""
            if req.shotPrompts:
                self._append_lora(
                    default_settings,
                    MULTI_SHOT_LORA_FILENAME,
                    float(MULTI_SHOT_LORA_STRENGTH),
                )
            if is_lora_tool:
                assert req.videoTool is not None
                default_settings.update(
                    {
                        "activated_loras": [VIDEO_TOOL_LORA_URLS[req.videoTool]],
                        "loras_multipliers": "",
                        "force_fps": "control",
                        "sliding_window_size": 481,
                        "guidance_phases": 2,
                        "denoising_strength": 1,
                    }
                )
            if is_reframe:
                default_settings["force_fps"] = "auto"
                default_settings["sliding_window_overlap"] = 33
            if style is not None and style.lora_url is not None:
                self._wangp_bridge.ensure_style_lora(
                    source_url=style.lora_url,
                    model_type=profile.wangp_model_type,
                    on_progress=self._generation.update_progress,
                    is_cancelled=self._generation.is_generation_cancelled,
                )
                self._append_lora(default_settings, style.lora_url, style.lora_strength)

            output_path = self._wangp_bridge.generate_video(
                prompt=wangp_prompt,
                resolution_label=resolved_resolution_label,
                aspect_ratio=output_aspect_ratio,
                duration_seconds=duration,
                fps=fps,
                steps=steps,
                seed=seed,
                camera_motion=req.cameraMotion,
                negative_prompt=req.negativePrompt,
                image_path=validated_start_image_path,
                audio_path=validated_audio_path,
                on_progress=self._generation.update_progress,
                is_cancelled=self._generation.is_generation_cancelled,
                model_type=active_model_type,
                default_settings=default_settings,
                start_image_path=validated_start_image_path,
                end_image_path=validated_end_image_path,
                control_video_path=validated_control_video_path,
                video_prompt_type=video_prompt_type,
                image_prompt_type=image_prompt_type,
                audio_prompt_type=audio_prompt_type,
                video_guide_outpainting=video_guide_outpainting,
                video_guide_outpainting_ratio=video_guide_outpainting_ratio,
                video_length_frames=source_video_frame_count,
                reference_image_paths=validated_reference_images,
                reference_video_paths=validated_reference_videos,
                reference_audio_paths=validated_reference_audios,
            )

            self._generation.complete_generation(output_path)
            return GenerateVideoResponse(
                status="complete",
                video_path=output_path,
                resolvedSeed=seed,
            )
        except HTTPError as e:
            # Validation errors (400) and conflict errors (409) are intentional
            # client responses — propagate them unchanged instead of masking
            # them as 500 internal errors.
            self._generation.fail_generation(e.detail)
            raise
        except Exception as e:
            self._generation.fail_generation(str(e))
            if "cancelled" in str(e).lower():
                logger.info("WanGP generation cancelled by user")
                return GenerateVideoResponse(status="cancelled")
            raise HTTPError(500, str(e)) from e
        finally:
            if temp_clip_path is not None and temp_clip_path.exists():
                try:
                    temp_clip_path.unlink()
                except OSError:
                    logger.warning("Could not remove temporary reframe clip: %s", temp_clip_path)
            for media_path in temp_media_paths:
                if not media_path.exists():
                    continue
                try:
                    media_path.unlink()
                except OSError:
                    logger.warning("Could not remove temporary input derivative: %s", media_path)

    def _resolve_wangp_profile_settings(
        self, profile: ModelProfile, model_type: str
    ) -> dict[str, object]:
        return self._wangp_bridge.resolve_profiles(
            model_type,
            accelerator_profile_id=profile.wangp_accelerator_profile_for(model_type),
            preset_profile_id=profile.wangp_preset_profile_id,
        )

    @staticmethod
    def _resolve_video_profile(req: GenerateVideoRequest) -> ModelProfile:
        profile_id = req.modelProfileId
        if not profile_id:
            raise HTTPError(400, "UNKNOWN_VIDEO_MODEL_PROFILE")
        profile = get_video_profile(profile_id)
        if profile is None or not profile.visible:
            raise HTTPError(400, "UNKNOWN_VIDEO_MODEL_PROFILE")
        return profile

    @staticmethod
    def _resolve_style(
        profile: ModelProfile,
        style_id: str | None,
        *,
        is_reframe: bool,
        video_tool: str | None,
    ) -> StyleDefinition | None:
        if style_id is None:
            return None
        if is_reframe or video_tool is not None:
            raise HTTPError(400, "STYLE_NOT_SUPPORTED_FOR_VIDEO_OPERATION")
        style = next((candidate for candidate in profile.styles if candidate.id == style_id), None)
        if style is None:
            raise HTTPError(400, "UNKNOWN_OR_INCOMPATIBLE_STYLE")
        return style

    @staticmethod
    def _append_lora(
        settings: dict[str, object],
        lora_url: str,
        strength: float | None,
    ) -> None:
        active_loras = settings.get("activated_loras")
        loras = list(cast(list[str], active_loras)) if isinstance(active_loras, list) else []
        loras.append(lora_url)
        settings["activated_loras"] = loras
        multiplier = str(settings.get("loras_multipliers") or "").strip()
        settings["loras_multipliers"] = " ".join(
            value for value in (multiplier, str(strength or 1.0)) if value
        )

    @staticmethod
    def _resolve_prompt_and_duration(req: GenerateVideoRequest, duration: int) -> tuple[str, int]:
        if not req.shotPrompts:
            return req.prompt, duration

        cursor = 0
        relayed_prompts: list[str] = []
        for shot in req.shotPrompts:
            start = cursor
            cursor += shot.seconds
            relayed_prompts.append(f"[{start}s:{cursor}s] {shot.prompt}")

        if cursor > 20:
            raise HTTPError(400, "MULTI_SHOT_DURATION_TOO_LONG")
        lines = [req.prompt.strip(), *relayed_prompts] if req.prompt.strip() else relayed_prompts
        return "\n".join(lines), cursor

    @staticmethod
    def _validate_video_profile_request(
        profile: ModelProfile,
        req: GenerateVideoRequest,
        *,
        start_image_path: str | None = None,
        end_image_path: str | None = None,
        control_video_path: str | None = None,
        audio_path: str | None = None,
    ) -> None:
        if req.resolution not in profile.allowed_resolution_tiers:
            raise HTTPError(400, "UNSUPPORTED_VIDEO_RESOLUTION_TIER")
        if req.aspectRatio not in profile.allowed_aspect_ratios:
            raise HTTPError(400, "UNSUPPORTED_VIDEO_ASPECT_RATIO")
        if not is_combination_supported(profile, req.resolution, req.aspectRatio):
            raise HTTPError(400, "NO_CURATED_VIDEO_RESOLUTION")

        if req.inputMedia and profile.input_media and profile.input_media.supports_image_inputs:
            allowed_roles = {role_def.role for role_def in profile.input_media.roles}
            if profile.start_image:
                allowed_roles.add("start_image")
            if profile.end_image:
                allowed_roles.add("end_image")
            if profile.control_video:
                allowed_roles.add("control_video")
            if profile.audio_to_video:
                allowed_roles.add("audio_guide")
            for media in req.inputMedia:
                if media.role not in allowed_roles:
                    raise HTTPError(400, f"Role {media.role} is not supported by this model profile")

        if start_image_path and not (profile.start_image or profile.image_to_video or profile.video_continuation):
            raise HTTPError(400, "VIDEO_IMAGE_INPUT_NOT_SUPPORTED")
        if end_image_path and not profile.end_image:
            raise HTTPError(400, "VIDEO_IMAGE_INPUT_NOT_SUPPORTED")
        if control_video_path and not profile.control_video:
            raise HTTPError(400, "VIDEO_IMAGE_INPUT_NOT_SUPPORTED")
        if audio_path and not profile.audio_to_video:
            raise HTTPError(400, "VIDEO_AUDIO_INPUT_NOT_SUPPORTED")

    @staticmethod
    def _parse_forced_numeric_field(raw_value: str, error_detail: str) -> int:
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            raise HTTPError(400, error_detail) from None
