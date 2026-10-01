"""Tests for the curated model profile registry and resolution resolver."""

from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
from typing import Literal, cast

import pytest
from PIL import Image

from _routes._errors import HTTPError
from handlers.video_generation_handler import VIDEO_TOOL_LORA_URLS
from model_profiles import (
    get_image_profile,
    get_video_profile,
    get_visible_image_profiles,
    get_visible_music_profiles,
    get_visible_video_profiles,
    is_combination_supported,
    resolve_resolution,
)
from model_profiles.policies import HandlerOwner, validate_model_profile_policies
from model_profiles.profiles import (
    CURATED_ASPECT_RATIOS,
    IMAGE_PROFILES,
    VIDEO_PROFILES,
)
from wangp_model_packs import PACKS


def _write_test_image(path: Path) -> Path:
    image = Image.new("RGB", (16, 16), color=(255, 0, 0))
    image.save(path)
    return path


class TestCuratedProfiles:
    def test_requested_visible_image_profiles(self) -> None:
        visible = get_visible_image_profiles()
        assert {p.id for p in visible} == {
            "z_image_turbo",
            "krea2_turbo",
            "flux2_klein_4b",
            "flux2_klein_9b",
            "qwen_image_2512_20B",
            "qwen_image_21_7b_pruna",
            "qwen_image_edit_plus2_20B",
            "krea2_turbo_edit",
            "hidream_o1_dev",
            "ideogram4_int8",
            "ideogram4_turbotime_int8",
        }

    def test_z_image_turbo_is_stable(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert profile.status == "stable"
        assert profile.wangp_model_type == "z_image"
        assert profile.text_to_image is True
        assert profile.reference_images is False
        assert profile.control_image is True
        assert profile.input_media.supports_image_inputs is True
        assert profile.input_media.max_images == 1
        assert profile.input_media.wangp_model_type == "z_image_control2_1"
        assert profile.lora == "future"

    def test_krea2_turbo_is_stable(self) -> None:
        profile = get_image_profile("krea2_turbo")
        assert profile is not None
        assert profile.status == "stable"
        assert profile.wangp_model_type == "krea2_turbo"
        assert profile.wangp_default_settings == {
            "image_mode": 1,
            "num_inference_steps": 8,
            "guidance_scale": 0,
        }
        assert "1440p" in profile.allowed_resolution_tiers

    def test_flux2_klein_4b_is_stable(self) -> None:
        profile = get_image_profile("flux2_klein_4b")
        assert profile is not None
        assert profile.status == "stable"
        assert profile.wangp_model_type == "flux2_klein_4b"
        assert profile.text_to_image is True
        assert profile.reference_images is True
        assert profile.control_image is True
        assert profile.input_media.supports_image_inputs is True
        assert [role.role for role in profile.input_media.roles] == [
            "reference_subject",
            "reference_people_objects",
            "control_pose",
        ]
        assert profile.input_media.max_images == 5
        assert profile.wangp_metadata.capabilities["reference_images"] is True
        assert profile.wangp_metadata.media_inputs["image"]["multiple_references"] is True
        assert "1440p" in profile.allowed_resolution_tiers

    def test_hidream_o1_dev_is_stable(self) -> None:
        profile = get_image_profile("hidream_o1_dev")
        assert profile is not None
        assert profile.status == "stable"
        assert profile.wangp_model_type == "hidream_o1_dev"
        assert profile.display_name == "HiDream O1"
        assert profile.reference_images is True
        assert profile.control_image is True
        assert [role.role for role in profile.input_media.roles] == [
            "reference_subject",
            "reference_people_objects",
            "control_image",
            "control_pose",
            "control_depth",
            "control_canny",
        ]
        assert profile.input_media.max_images == 5
        assert "1440p" in profile.allowed_resolution_tiers

    def test_requested_image_profiles_use_exact_wangp_ids(self) -> None:
        expected_model_types = {
            "flux2_klein_9b": "flux2_klein_9b",
            "qwen_image_2512_20B": "qwen_image_2512_20B",
            "qwen_image_edit_plus2_20B": "qwen_image_edit_plus2_20B",
            "krea2_turbo_edit": "krea2_turbo_edit",
            "ideogram4_int8": "ideogram4",
            "ideogram4_turbotime_int8": "ideogram4_turbotime",
        }

        for profile_id, model_type in expected_model_types.items():
            profile = get_image_profile(profile_id)
            assert profile is not None
            assert profile.wangp_model_type == model_type
            assert profile.status == "stable"

    def test_qwen_image_21_pruna_uses_the_curated_native_recipe(self) -> None:
        profile = get_image_profile("qwen_image_21_7b_pruna")
        assert profile is not None
        assert profile.status == "experimental"
        assert profile.wangp_model_type == "qwen_image_21_7B"
        assert profile.wangp_accelerator_profile_id == "qwen_image_21_pruna_v0_1_8_steps"
        assert profile.required_pack_ids == ("qwen_image_21_7b_pruna",)
        assert profile.reference_images is True
        assert profile.control_image is profile.inpainting is profile.outpainting is False
        assert profile.input_media.max_images == 10
        assert [role.role for role in profile.input_media.roles] == [
            "reference_subject",
            "reference_people_objects",
        ]
        assert profile.license is not None
        assert profile.license.weights_license == "Qwen Research License Agreement"
        assert profile.license.commercial_use == "restricted"

    def test_requested_edit_profiles_expose_supported_image_inputs(self) -> None:
        flux = get_image_profile("flux2_klein_9b")
        qwen = get_image_profile("qwen_image_edit_plus2_20B")
        krea = get_image_profile("krea2_turbo_edit")
        assert flux is not None
        assert qwen is not None
        assert krea is not None
        assert flux.input_media.max_images == 5
        assert qwen.input_media.max_images == 5
        assert krea.input_media.max_images == 2
        assert qwen.reference_images is True
        assert qwen.control_image is True
        assert krea.reference_images is True
        assert krea.control_image is False

    def test_unknown_profile_returns_none(self) -> None:
        assert get_image_profile("does_not_exist") is None

    def test_visible_video_profiles(self) -> None:
        visible = get_visible_video_profiles()
        assert [p.id for p in visible] == [
            "ltx2_25_fast",
            "ltx2_25_quality",
            "minimax_h3_fast",
            "minimax_h3_quality",
        ]

    def test_minimax_h3_profile_exposes_curated_limits_and_pack(self) -> None:
        profile = get_video_profile("minimax_h3_quality")
        fast = get_video_profile("minimax_h3_fast")
        assert profile is not None
        assert fast is not None
        assert profile.wangp_model_type == "minimax_h3_fl2va_pruned"
        assert profile.wangp_default_settings == {}
        assert fast.wangp_default_settings == {}
        assert fast.wangp_accelerator_profile_for("minimax_h3_fl2va_pruned") == (
            "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1"
        )
        assert fast.wangp_accelerator_profile_for("minimax_h3_ref2va_pruned") == (
            "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1"
        )
        assert profile.wangp_accelerator_profile_for("minimax_h3_fl2va_pruned") is None
        assert profile.required_pack_ids == ("minimax-h3-quality",)
        assert profile.input_media.max_reference_images == 9
        assert profile.input_media.max_reference_videos == 3
        assert profile.input_media.max_reference_audios == 3
        assert profile.input_media.max_combined_references == 12
        assert profile.prompt_composer.voice_reference is False
        assert profile.video_audio.output_audio is True
        assert profile.license is not None
        assert profile.license.license_url == "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE"

    def test_ltx_fast_and_quality_video_profiles(self) -> None:
        fast = get_video_profile("ltx2_25_fast")
        quality = get_video_profile("ltx2_25_quality")
        assert fast is not None
        assert quality is not None
        assert fast.status == quality.status == "stable"
        assert fast.media_type == quality.media_type == "video"
        assert fast.display_name == "LTX 2.5 Fast"
        assert quality.display_name == "LTX 2.5 Quality"
        assert fast.wangp_model_type == "ltx2_25_22B_distilled"
        assert quality.wangp_model_type == "ltx2_25_22B"
        assert fast.wangp_default_settings == quality.wangp_default_settings == {}
        assert fast.wangp_accelerator_profile_id is None
        assert (
            quality.wangp_accelerator_profile_id
            == "ltx2_25_two_stage_hq_res2s_15_3"
        )
        assert fast.wangp_accelerator_profile_for("ltx2_25_22B_distilled") is None
        assert fast.wangp_preset_profile_id is quality.wangp_preset_profile_id is None
        assert fast.required_pack_ids == ("ltx2_fast",)
        assert quality.required_pack_ids == ("ltx2_quality",)
        assert fast.text_to_video is True
        assert fast.image_to_video is True
        assert fast.audio_to_video is True
        assert fast.start_image is True
        assert fast.end_image is True
        assert fast.control_video is True
        assert fast.sliding_window is True
        assert fast.default_resolution_tier == "540p"
        assert fast.allowed_aspect_ratios == CURATED_ASPECT_RATIOS
        assert [style.id for style in fast.styles] == [
            "ltx25_soft_enhance",
            "ltx25_fantasy_painterly",
            "ltx25_pixar_toon",
            "ltx25_90s_animation",
            "ltx25_claymation",
            "ltx25_cozy_felt",
            "ltx25_fantasy_anime",
            "ltx25_fantasy_realism",
            "ltx25_fantasy_puppet",
            "ltx25_crisp_enhance",
            "ltx25_post_apocalyptic",
            "ltx25_paper_cut_out",
            "ltx25_wild_west",
            "ltx25_cinematic_sci_fi_cyberpunk",
        ]
        no_prompt_styles = {"ltx25_soft_enhance", "ltx25_crisp_enhance"}
        assert {style.id for style in fast.styles if style.style_prompt is None} == no_prompt_styles
        assert all(
            style.style_prompt
            for style in fast.styles
            if style.id not in no_prompt_styles
        )
        assert quality.styles == fast.styles

    def test_style_validation_accepts_prompt_actions_and_rejects_no_action(self) -> None:
        profile = get_video_profile("ltx2_25_fast")
        assert profile is not None
        style = profile.styles[0]
        validate_model_profile_policies(
            [
                replace(
                    profile,
                    styles=(
                        replace(style, style_prompt="suffix"),
                        replace(
                            style,
                            id="prompt-only",
                            lora_url=None,
                            lora_strength=None,
                            style_prompt="suffix",
                        ),
                    ),
                )
            ],
            pack_ids=PACKS,
        )
        with pytest.raises(ValueError, match="must define a LoRA or style prompt"):
            validate_model_profile_policies(
                [
                    replace(
                        profile,
                        styles=(
                            replace(style, lora_url=None, lora_strength=None),
                        ),
                    )
                ],
                pack_ids=PACKS,
            )

    def test_visible_profile_policies_reference_known_packs_and_handlers(self) -> None:
        validate_model_profile_policies(
            [
                *get_visible_image_profiles(),
                *get_visible_video_profiles(),
                *get_visible_music_profiles(),
            ],
            pack_ids=PACKS,
        )

    def test_ltx_system_dependencies_match_backend_video_tools(self) -> None:
        profile = get_video_profile("ltx2_25_fast")
        assert profile is not None
        dependency_ids = {
            dependency.id.removeprefix("video_tool_lora_")
            for dependency in profile.system_dependencies
        }
        assert dependency_ids == set(VIDEO_TOOL_LORA_URLS)
        assert all(dependency.user_selectable is False for dependency in profile.system_dependencies)

    @pytest.mark.parametrize(
        "replacement",
        [
            lambda profile: replace(profile, required_pack_ids=("missing_pack",)),
            lambda profile: replace(
                profile,
                video_audio=replace(
                    profile.video_audio,
                    handler=cast(HandlerOwner, "missing_handler"),
                ),
            ),
            lambda profile: replace(
                profile,
                video_audio=replace(profile.video_audio, handler=None),
            ),
            lambda profile: replace(
                profile,
                video_audio=replace(profile.video_audio, max_audio_inputs=-1),
            ),
            lambda profile: replace(
                profile,
                system_dependencies=(
                    replace(
                        profile.system_dependencies[0],
                        user_selectable=cast(Literal[False], True),
                    ),
                    *profile.system_dependencies[1:],
                ),
            ),
        ],
    )
    def test_policy_validation_rejects_invalid_runtime_references(self, replacement) -> None:
        profile = get_video_profile("ltx2_25_fast")
        assert profile is not None
        with pytest.raises(ValueError):
            validate_model_profile_policies([replacement(profile)], pack_ids=PACKS)

    def test_no_krea2_raw_exposed(self) -> None:
        # Phase 4 brief: do not expose Krea 2 Raw in this phase.
        ids = {p.id for p in IMAGE_PROFILES}
        assert "krea2_raw" not in ids
        assert "krea2_turbo" in ids

    def test_curated_aspect_ratios_are_shared(self) -> None:
        for profile in IMAGE_PROFILES:
            assert profile.allowed_aspect_ratios == CURATED_ASPECT_RATIOS

    def test_no_4k_tier_by_default(self) -> None:
        # Phase 4 brief: no 4K/2160p by default.
        for profile in IMAGE_PROFILES:
            assert "2160p" not in profile.allowed_resolution_tiers

    def test_minimum_540p_floor(self) -> None:
        for profile in [*IMAGE_PROFILES, *VIDEO_PROFILES]:
            assert "540p" in profile.allowed_resolution_tiers or (
                profile.min_resolution_tier is not None
                and profile.min_resolution_tier >= "540p"  # noqa: E501
            )

    def test_all_visible_profile_ui_combinations_have_curated_resolutions(self) -> None:
        for profile in [*IMAGE_PROFILES, *VIDEO_PROFILES]:
            if not profile.visible:
                continue
            for tier in profile.allowed_resolution_tiers:
                for aspect in profile.allowed_aspect_ratios:
                    assert is_combination_supported(profile, tier, aspect)


class TestResolutionResolver:
    def test_1080p_landscape_maps_to_1920x1088(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "1080p", "16:9") == (1920, 1088)

    def test_1080p_portrait_maps_to_1088x1920(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "1080p", "9:16") == (1088, 1920)

    def test_additional_landscape_and_portrait_pairs_are_curated(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "1080p", "4:3") == (1664, 1248)
        assert resolve_resolution(profile, "1080p", "3:4") == (1248, 1664)
        assert resolve_resolution(profile, "1080p", "21:9") == (1920, 832)
        assert resolve_resolution(profile, "1080p", "9:21") == (832, 1920)

    def test_1080p_square_picks_lower_pixel_count(self) -> None:
        # Phase 4 brief: 1080p 1:1 -> 1088x1088, not 1440x1440.
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "1080p", "1:1") == (1088, 1088)

    def test_720p_landscape_maps_to_1280x720(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "720p", "16:9") == (1280, 720)

    def test_720p_portrait_maps_to_720x1280(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "720p", "9:16") == (720, 1280)

    def test_krea2_1440p_supported(self) -> None:
        profile = get_image_profile("krea2_turbo")
        assert profile is not None
        assert resolve_resolution(profile, "1440p", "16:9") == (2560, 1440)

    def test_z_image_1440p_not_curated(self) -> None:
        # Z-Image Turbo profile caps at 1080p.
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        assert is_combination_supported(profile, "1440p", "16:9") is False

    def test_flux2_klein_1440p_supported(self) -> None:
        profile = get_image_profile("flux2_klein_4b")
        assert profile is not None
        assert resolve_resolution(profile, "1440p", "16:9") == (2560, 1440)

    def test_hidream_o1_1080p_square(self) -> None:
        profile = get_image_profile("hidream_o1_dev")
        assert profile is not None
        assert resolve_resolution(profile, "1080p", "1:1") == (1088, 1088)

    def test_unknown_combination_raises(self) -> None:
        profile = get_image_profile("z_image_turbo")
        assert profile is not None
        with pytest.raises(KeyError):
            resolve_resolution(profile, "2160p", "16:9")


class TestModelProfilesEndpoint:
    def test_list_profiles_returns_visible_profiles(self, client) -> None:
        r = client.get("/api/model-profiles")
        assert r.status_code == 200
        data = r.json()
        ids = [p["id"] for p in data["profiles"] if p["mediaType"] == "image"]
        assert ids == [
            "z_image_turbo",
            "krea2_turbo",
            "flux2_klein_4b",
            "flux2_klein_9b",
            "qwen_image_2512_20B",
            "qwen_image_21_7b_pruna",
            "hidream_o1_dev",
            "krea2_turbo_edit",
            "qwen_image_edit_plus2_20B",
            "ideogram4_int8",
            "ideogram4_turbotime_int8",
        ]
        video_ids = [p["id"] for p in data["profiles"] if p["mediaType"] == "video"]
        assert video_ids == [
            "ltx2_25_fast",
            "ltx2_25_quality",
            "minimax_h3_fast",
            "minimax_h3_quality",
        ]

    def test_profile_shape(self, client) -> None:
        r = client.get("/api/model-profiles")
        data = r.json()
        krea = next(p for p in data["profiles"] if p["id"] == "krea2_turbo")
        assert krea["displayName"] == "Krea 2 Turbo"
        assert krea["mediaType"] == "image"
        assert krea["status"] == "stable"
        assert krea["wangpModelType"] == "krea2_turbo"
        assert krea["wangpMetadata"]["family"] == "krea2"
        assert krea["wangpMetadata"]["inputs"] == ["text", "image"]
        assert krea["wangpMetadata"]["mediaInputs"]["image"]["mask"] is True
        assert krea["wangpMetadata"]["capabilities"]["inpainting"] is True
        assert krea["capabilities"]["textToImage"] is True
        assert krea["capabilities"]["referenceImages"] is False
        assert krea["capabilities"]["lora"] == "future"
        assert krea["inputMedia"]["supportsImageInputs"] is False
        assert krea["inputMedia"]["roles"] == []
        assert krea["ui"]["defaultAspectRatio"] == "1:1"
        assert krea["ui"]["defaultResolutionTier"] == "720p"
        assert krea["ui"]["allowedAspectRatios"] == list(CURATED_ASPECT_RATIOS)
        assert "1440p" in krea["ui"]["allowedResolutionTiers"]
        z_image = next(p for p in data["profiles"] if p["id"] == "z_image_turbo")
        assert z_image["capabilities"]["referenceImages"] is False
        assert z_image["capabilities"]["controlImage"] is True
        assert z_image["inputMedia"]["supportsImageInputs"] is True
        assert z_image["inputMedia"]["tooltipLabel"] == "Control"
        assert z_image["inputMedia"]["maxImages"] == 1

        ltx = next(p for p in data["profiles"] if p["id"] == "ltx2_25_fast")
        assert ltx["displayName"] == "LTX 2.5 Fast"
        assert ltx["mediaType"] == "video"
        assert ltx["wangpModelType"] == "ltx2_25_22B_distilled"
        assert ltx["capabilities"]["textToVideo"] is True
        assert ltx["capabilities"]["imageToVideo"] is True
        assert ltx["capabilities"]["audioToVideo"] is True
        assert ltx["capabilities"]["startImage"] is True
        assert ltx["capabilities"]["endImage"] is True
        assert ltx["capabilities"]["controlVideo"] is True
        assert ltx["capabilities"]["slidingWindow"] is True
        assert ltx["wangpMetadata"]["mediaInputs"]["video"]["control"] is True
        assert ltx["ui"]["allowedAspectRatios"] == list(CURATED_ASPECT_RATIOS)
        assert ltx["requiredPackIds"] == ["ltx2_fast"]
        assert len(ltx["styles"]) == 14
        assert ltx["styles"][0] == {
            "id": "ltx25_soft_enhance",
            "displayName": "Soft Enhance",
            "thumbnailUrl": "/styles/ltx25/soft-enhance.webp",
            "sourceUrl": "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Soft_Enhance_Style_LoRa/resolve/main/LTX2.3_Soft_Enhance.safetensors",
        }
        h3 = next(p for p in data["profiles"] if p["id"] == "minimax_h3_fast")
        assert h3["styles"] == []
        assert ltx["videoAudio"] == {
            "status": "stable",
            "handler": "video_generation",
            "requiredPackIds": ["ltx2_fast"],
            "soundtrack": True,
            "audioConditioning": True,
            "controlVideoAudio": True,
            "outputAudio": True,
            "maxAudioInputs": 1,
        }
        assert ltx["speech"]["referenceVoice"] is True
        assert ltx["speech"]["tts"] is False
        assert ltx["sfx"]["maxDurationSeconds"] == 20
        assert {operation["id"] for operation in ltx["videoEdits"]["operations"]} >= {
            "reframe",
            "extend",
            *VIDEO_TOOL_LORA_URLS,
        }
        assert ltx["director"]["renderStrategies"] == [{
            "id": "single_pass",
            "status": "stable",
            "handler": "director_generation",
            "requiredPackIds": ["ltx2_fast"],
            "maxDurationSeconds": 20,
        }]
        assert all(not dependency["userSelectable"] for dependency in ltx["systemDependencies"])
        assert "https://" not in json.dumps({
            key: ltx[key]
            for key in ("systemDependencies", "videoAudio", "speech", "sfx", "videoEdits", "director")
        })

    def test_ltx2_video_square_resolution_supported(self) -> None:
        profile = get_video_profile("ltx2_25_fast")
        assert profile is not None
        assert resolve_resolution(profile, "1080p", "1:1") == (1088, 1088)

    def test_profile_shape_includes_wangp_setting_choices(self, client) -> None:
        r = client.get("/api/model-profiles")
        data = r.json()
        flux = next(p for p in data["profiles"] if p["id"] == "flux2_klein_4b")
        video_prompt_type = flux["wangpMetadata"]["settingValues"]["video_prompt_type"]
        image_ref_choices = video_prompt_type["image_ref_choices"]["choices"]
        assert flux["wangpMetadata"]["familyLabel"] == "Flux 2"
        assert flux["wangpMetadata"]["mediaInputs"]["image"]["reference"] is True
        assert flux["wangpMetadata"]["mediaInputs"]["image"]["multiple_references"] is True
        assert flux["wangpMetadata"]["capabilities"]["outpainting"] is True
        assert {choice["value"] for choice in image_ref_choices} == {"", "KI", "I"}
        assert flux["capabilities"]["referenceImages"] is True
        assert flux["capabilities"]["controlImage"] is True
        assert flux["inputMedia"]["supportsImageInputs"] is True
        assert flux["inputMedia"]["tooltipLabel"] == "Ref/Control"
        assert flux["inputMedia"]["maxImages"] == 5
        assert [role["role"] for role in flux["inputMedia"]["roles"]] == [
            "reference_subject",
            "reference_people_objects",
            "control_pose",
        ]

    def test_availability_reflects_wangp_bridge(
        self, client, test_state, wangp_bridge
    ) -> None:
        # Bridge unavailable -> profiles report missing model files.
        wangp_bridge.enabled = False
        r = client.get("/api/model-profiles")
        data = r.json()
        for profile in data["profiles"]:
            assert profile["availability"] == "missing_model_files"

        # Bridge available -> availability flips.
        wangp_bridge.enabled = True
        wangp_bridge.available = True
        r = client.get("/api/model-profiles")
        data = r.json()
        for profile in data["profiles"]:
            if profile["status"] == "experimental":
                assert profile["availability"] == "experimental"
            else:
                assert profile["availability"] == "available"


class TestImageGenerationProfileRouting:
    def test_profile_request_routes_to_krea2(
        self, client, enable_wangp
    ) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "krea2_turbo",
                "aspectRatio": "16:9",
                "resolutionTier": "1080p",
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "krea2_turbo"
        assert call.width == 1920
        assert call.height == 1088
        assert call.num_steps == 8
        assert call.default_settings["image_mode"] == 1
        assert call.default_settings["num_inference_steps"] == 8
        assert call.default_settings["guidance_scale"] == 0
        assert call.default_settings["image_output_codec"] == "jpeg_95"
        assert call.default_settings["metadata_type"] == "metadata"

    def test_profile_request_routes_to_z_image(
        self, client, enable_wangp
    ) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "z_image_turbo",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "z_image"
        assert call.width == 1024
        assert call.height == 1024

    def test_profile_request_routes_to_flux2_klein(
        self, client, enable_wangp
    ) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "16:9",
                "resolutionTier": "1080p",
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "flux2_klein_4b"
        assert call.width == 1920
        assert call.height == 1088

    def test_profile_request_routes_to_hidream(
        self, client, enable_wangp
    ) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "hidream_o1_dev",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "hidream_o1_dev"
        assert call.width == 1024
        assert call.height == 1024

    @pytest.mark.parametrize(
        ("profile_id", "model_type"),
        [
            ("flux2_klein_9b", "flux2_klein_9b"),
            ("qwen_image_2512_20B", "qwen_image_2512_20B"),
            ("qwen_image_21_7b_pruna", "qwen_image_21_7B"),
            ("qwen_image_edit_plus2_20B", "qwen_image_edit_plus2_20B"),
            ("krea2_turbo_edit", "krea2_turbo_edit"),
            ("ideogram4_int8", "ideogram4"),
            ("ideogram4_turbotime_int8", "ideogram4_turbotime"),
        ],
    )
    def test_requested_profile_routes_to_exact_wangp_model(
        self,
        client,
        enable_wangp,
        profile_id: str,
        model_type: str,
    ) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": profile_id,
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
            },
        )
        assert r.status_code == 200
        assert enable_wangp.image_calls[0].model_type == model_type

    @pytest.mark.parametrize(
        "profile_id",
        ["qwen_image_edit_plus2_20B", "krea2_turbo_edit"],
    )
    def test_requested_edit_profile_routes_reference_image(
        self,
        client,
        enable_wangp,
        tmp_path: Path,
        profile_id: str,
    ) -> None:
        image_path = _write_test_image(tmp_path / f"{profile_id}.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "Add a hat",
                "modelProfileId": profile_id,
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "reference_subject",
                    },
                ],
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == profile_id
        assert call.default_settings["video_prompt_type"] == "KI"
        assert call.default_settings["image_refs"] == [str(image_path.resolve())]

    def test_qwen_image_21_edit_uses_existing_reference_image_path(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        master_path = _write_test_image(tmp_path / "master.png")
        reference_path = _write_test_image(tmp_path / "reference.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "Put the subject in a winter coat",
                "modelProfileId": "qwen_image_21_7b_pruna",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "edit": {"image": {"path": str(master_path)}},
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(reference_path),
                        "role": "reference_people_objects",
                    }
                ],
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "qwen_image_21_7B"
        assert call.default_settings["video_prompt_type"] == "KI"
        assert call.default_settings["image_refs"] == [
            str(master_path.resolve()),
            str(reference_path.resolve()),
        ]

    def test_image_input_to_krea2_rejected(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        image_path = _write_test_image(tmp_path / "input.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "krea2_turbo",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "reference_subject",
                    }
                ],
            },
        )
        assert r.status_code == 400
        assert "IMAGE_INPUT_NOT_SUPPORTED" in r.json()["error"]
        assert enable_wangp.image_calls == []

    def test_flux_reference_image_maps_to_wangp_settings(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        image_path = _write_test_image(tmp_path / "reference.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "16:9",
                "resolutionTier": "1080p",
                "inputMedia": [
                    {
                        "id": "local-1",
                        "type": "image",
                        "path": str(image_path),
                        "role": "reference_subject",
                    }
                ],
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "flux2_klein_4b"
        assert call.default_settings["video_prompt_type"] == "KI"
        assert call.default_settings["image_refs"] == [str(image_path.resolve())]

    def test_flux_multiple_reference_images_map_to_wangp_settings(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        subject_path = _write_test_image(tmp_path / "subject.png")
        people_path = _write_test_image(tmp_path / "people.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "16:9",
                "resolutionTier": "1080p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(subject_path),
                        "role": "reference_subject",
                    },
                    {
                        "type": "image",
                        "path": str(people_path),
                        "role": "reference_people_objects",
                    },
                ],
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "flux2_klein_4b"
        assert call.default_settings["video_prompt_type"] == "KI"
        assert call.default_settings["image_refs"] == [
            str(subject_path.resolve()),
            str(people_path.resolve()),
        ]

    def test_flux_too_many_image_inputs_rejected(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        paths = [_write_test_image(tmp_path / f"reference_{index}.png") for index in range(6)]
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "16:9",
                "resolutionTier": "1080p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(path),
                        "role": "reference_people_objects",
                    }
                    for path in paths
                ],
            },
        )
        assert r.status_code == 400
        assert "TOO_MANY_IMAGE_INPUTS" in r.json()["error"]
        assert enable_wangp.image_calls == []

    def test_qwen_image_21_rejects_an_eleventh_reference(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        paths = [_write_test_image(tmp_path / f"reference_{index}.png") for index in range(11)]
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "qwen_image_21_7b_pruna",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(path),
                        "role": "reference_people_objects",
                    }
                    for path in paths
                ],
            },
        )
        assert r.status_code == 400
        assert "TOO_MANY_IMAGE_INPUTS" in r.json()["error"]
        assert enable_wangp.image_calls == []

    def test_z_image_control_input_routes_to_hidden_variant(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        image_path = _write_test_image(tmp_path / "control.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "z_image_turbo",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "control_pose",
                    }
                ],
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "z_image_control2_1"
        assert call.num_steps == 9
        assert call.default_settings["video_prompt_type"] == "V"
        assert call.default_settings["image_guide"] == str(image_path.resolve())
        assert call.default_settings["guide_preprocessing"] == "PV"
        assert call.default_settings["control_net_weight_alt"] == 0.65

    def test_hidream_control_image_maps_to_wangp_settings(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        image_path = _write_test_image(tmp_path / "control.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "hidream_o1_dev",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "control_canny",
                    }
                ],
            },
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "hidream_o1_dev"
        assert call.default_settings["video_prompt_type"] == "V"
        assert call.default_settings["image_guide"] == str(image_path.resolve())
        assert call.default_settings["guide_preprocessing"] == "EV"

    def test_unsupported_image_input_role_rejected(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        image_path = _write_test_image(tmp_path / "control.png")
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "control_depth",
                    }
                ],
            },
        )
        assert r.status_code == 400
        assert "UNSUPPORTED_IMAGE_INPUT_ROLE" in r.json()["error"]
        assert enable_wangp.image_calls == []

    def test_missing_image_input_file_rejected(
        self, client, enable_wangp, tmp_path: Path
    ) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "A cat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(tmp_path / "missing.png"),
                        "role": "reference_subject",
                    }
                ],
            },
        )
        assert r.status_code == 400
        assert "IMAGE_INPUT_FILE_NOT_FOUND" in r.json()["error"]
        assert enable_wangp.image_calls == []

    def test_unknown_profile_rejected(self, client, enable_wangp) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "test",
                "modelProfileId": "definitely_not_a_real_profile",
                "aspectRatio": "16:9",
                "resolutionTier": "1080p",
            },
        )
        assert r.status_code == 400
        assert "UNKNOWN_MODEL_PROFILE" in r.json()["error"]

    def test_unsupported_tier_rejected(self, client, enable_wangp) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "test",
                "modelProfileId": "z_image_turbo",
                "aspectRatio": "16:9",
                "resolutionTier": "1440p",
            },
        )
        assert r.status_code == 400
        assert "UNSUPPORTED_RESOLUTION_TIER" in r.json()["error"]

    def test_unsupported_aspect_rejected(self, client, enable_wangp) -> None:
        r = client.post(
            "/api/generate-image",
            json={
                "prompt": "test",
                "modelProfileId": "z_image_turbo",
                "aspectRatio": "5:4",
                "resolutionTier": "1080p",
            },
        )
        # Arbitrary ratios outside the curated set are rejected by Pydantic.
        assert r.status_code == 422

    def test_backwards_compatible_raw_dimensions_still_work(
        self, client, enable_wangp
    ) -> None:
        # No modelProfileId — falls back to configured default (z_image)
        # and raw width/height are 16-aligned.
        r = client.post(
            "/api/generate-image",
            json={"prompt": "test", "width": 1023, "height": 1023},
        )
        assert r.status_code == 200
        call = enable_wangp.image_calls[0]
        assert call.model_type == "z_image"
        assert call.width == 1008
        assert call.height == 1008
