"""Integration-style tests for generation and image endpoints.

Phase 4 rework: every live generation path routes through the WanGP
bridge. The cloud/API and local LTX/ZIT pipeline paths were disabled in
Phase 2 and their tests removed; the remaining tests exercise the WanGP
bridge via the ``enable_wangp`` fixture (which swaps in
``FakeWanGPBridge`` and flips the runtime config flag on for one test).
"""

from __future__ import annotations

import pytest

from pathlib import Path

from api_types import GenerateImageRequest
from services.audio_metadata import AudioMetadata
from services.video_clip import VideoMetadata
from tests.fakes.fake_wangp_bridge import FakeWanGPBridge

LTX25_DISTILLED_LORA_URL = "https://huggingface.co/DeepBeepMeep/LTX-2/resolve/main/ltx-2.5-22b-distilled-lora-450_bf16.safetensors"

_T2V_JSON = {
    "prompt": "test",
    "resolution": "540p",
    "model": "fast",
    "modelProfileId": "ltx2_25_fast",
    "duration": "2",
    "fps": "24",
}


def _fake_running_generation_state(test_state) -> None:
    test_state.generation.start_generation("running")


class TestGenerate:
    """WanGP-backed video generation through ``POST /api/generate``."""

    @pytest.mark.parametrize("field", ["fps", "duration"])
    @pytest.mark.parametrize("value", ["0", "-1", "0.5", "nan", "inf"])
    def test_invalid_timing_rejected_before_generation(
        self, client, enable_wangp: FakeWanGPBridge, field: str, value: str
    ):
        response = client.post("/api/generate", json={**_T2V_JSON, field: value})

        assert response.status_code == 400
        assert response.json()["error"] == f"INVALID_{field.upper()}"
        assert enable_wangp.video_calls == []

        recovery = client.post("/api/generate", json=_T2V_JSON)
        assert recovery.status_code == 200
        assert recovery.json()["status"] == "complete"

    def test_t2v_happy_path(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post(
            "/api/generate",
            json={
                "prompt": "A beautiful sunset",
                "resolution": "1080p",
                "model": "fast",
                "modelProfileId": "ltx2_25_fast",
                "duration": "2",
                "fps": "24",
                "cameraMotion": "none",
            },
        )

        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "complete"
        assert data["video_path"] is not None
        assert Path(data["video_path"]).exists()

        assert len(enable_wangp.video_calls) == 1
        call = enable_wangp.video_calls[0]
        assert call.prompt == "A beautiful sunset"
        assert call.resolution_label == "1920x1088"
        assert call.aspect_ratio == "16:9"
        assert call.duration_seconds == 2
        assert call.fps == 24
        assert call.model_type == "ltx2_25_22B_distilled"
        assert call.default_settings["num_inference_steps"] == 8
        assert "sample_solver" not in call.default_settings
        assert "activated_loras" not in call.default_settings
        assert call.default_settings["video_output_codec"] == "libx264_8"
        assert call.default_settings["video_container"] == "mp4"
        assert call.default_settings["prompt_enhancer"] == ""

    def test_video_profile_request_routes_to_ltx2(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={
                "prompt": "A beautiful sunset",
                "resolution": "720p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "aspectRatio": "9:16",
                "enhancePrompt": True,
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.model_type == "ltx2_25_22B_distilled"
        assert call.resolution_label == "720x1280"
        assert call.aspect_ratio == "9:16"
        assert call.steps == 8
        assert call.default_settings["prompt_enhancer"] == "T"
        assert enable_wangp.resolved_profile_calls == [
            ("ltx2_25_22B_distilled", None, None)
        ]

    def test_ltx_style_downloads_and_appends_to_multi_shot_loras(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "styleId": "ltx25_fantasy_painterly",
                "shotPrompts": [{"seconds": 2, "prompt": "Cut closer."}],
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        style_url = "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Painterly_Style_LoRa/resolve/main/Fantasy_Painterly.safetensors"
        assert enable_wangp.style_lora_downloads == [
            (style_url, "ltx2_25_22B_distilled")
        ]
        assert call.default_settings["activated_loras"] == [
            "LTX-2.3_Cinematic_hardcut.safetensors",
            style_url,
        ]
        assert call.default_settings["loras_multipliers"] == "1.0 1.0"
        assert call.prompt.startswith("test\n[0s:2s] Cut closer.\nD4rkP41nt3r")

        unstyled_response = client.post("/api/generate", json=_T2V_JSON)
        assert unstyled_response.status_code == 200
        assert enable_wangp.video_calls[-1].prompt == "test"

        neutral_response = client.post(
            "/api/generate", json={**_T2V_JSON, "styleId": "ltx25_soft_enhance"}
        )
        assert neutral_response.status_code == 200
        assert enable_wangp.video_calls[-1].prompt == "test"

    def test_ltx_prompt_only_style_appends_without_downloading_lora(
        self, client, enable_wangp: FakeWanGPBridge, monkeypatch
    ):
        from dataclasses import replace

        from handlers import video_generation_handler
        from model_profiles import get_video_profile

        profile = get_video_profile("ltx2_25_fast")
        assert profile is not None
        style_prompt = "prompt-only-style-suffix"
        prompt_only_style = replace(
            profile.styles[0],
            id="ltx25_prompt_only",
            lora_url=None,
            lora_strength=None,
            style_prompt=style_prompt,
        )
        monkeypatch.setattr(
            video_generation_handler,
            "get_video_profile",
            lambda profile_id: replace(profile, styles=(prompt_only_style,))
            if profile_id == profile.id
            else get_video_profile(profile_id),
        )

        response = client.post(
            "/api/generate", json={**_T2V_JSON, "styleId": prompt_only_style.id}
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.prompt == f"test\n{style_prompt}"
        assert call.prompt.count(style_prompt) == 1
        assert enable_wangp.style_lora_downloads == []

    def test_rejects_unknown_and_incompatible_styles(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        unknown = client.post("/api/generate", json={**_T2V_JSON, "styleId": "missing"})
        incompatible = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "minimax_h3_fast", "styleId": "ltx25_soft_enhance"},
        )
        assert unknown.status_code == incompatible.status_code == 400
        assert unknown.json()["error"] == incompatible.json()["error"] == "UNKNOWN_OR_INCOMPATIBLE_STYLE"
        assert enable_wangp.video_calls == []

    def test_h3_routes_references_and_compiles_stable_aliases(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        start = tmp_path / "start.png"
        reference = tmp_path / "reference.png"
        Image.new("RGB", (16, 16), color="red").save(start)
        Image.new("RGB", (16, 16), color="blue").save(reference)
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "start_image", "path": str(start), "type": "image"},
                    {"role": "reference_image", "path": str(reference), "type": "image", "alias": "@image4"},
                ],
                "prompt": "Use @image4 as the subject.",
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.model_type == "minimax_h3_ref2va_pruned"
        assert call.prompt == "Use <Picture 2> as the subject."
        assert call.reference_image_paths == [str(reference)]
        assert call.steps == 20
        assert call.default_settings["flow_shift"] == 12.0
        assert call.default_settings["sample_solver"] == "euler"
        assert call.default_settings["config"] == "gguf_q4_k_m,fp8mix"
        assert enable_wangp.resolved_profile_calls == [
            ("minimax_h3_ref2va_pruned", None, None)
        ]

    def test_h3_fast_routes_ref2va_with_fast_defaults(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        reference = tmp_path / "reference.png"
        Image.new("RGB", (16, 16), color="blue").save(reference)
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_fast",
                "inputMedia": [
                    {"role": "reference_image", "path": str(reference), "type": "image", "alias": "@image1"}
                ],
                "prompt": "Use @image1.",
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.model_type == "minimax_h3_ref2va_pruned"
        assert call.steps == 6
        assert call.default_settings["flow_shift"] == 12.0
        assert call.default_settings["config"] == "gguf_q4_k_m,fp8mix"
        assert call.default_settings["loras_multipliers"] == "0.5"
        assert call.default_settings["activated_loras"] == [
            "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_ref2v_lightx2v_turbo_4step_v0.1_resized_avg_rank_20_bf16.safetensors"
        ]
        assert enable_wangp.resolved_profile_calls == [
            (
                "minimax_h3_ref2va_pruned",
                "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1",
                None,
            )
        ]

    def test_h3_fast_routes_fl2va_with_fast_lora(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "minimax_h3_fast"},
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.model_type == "minimax_h3_fl2va_pruned"
        assert call.default_settings["loras_multipliers"] == "0.5"
        assert call.default_settings["activated_loras"] == [
            "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors"
        ]
        assert enable_wangp.resolved_profile_calls == [
            (
                "minimax_h3_fl2va_pruned",
                "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1",
                None,
            )
        ]

    def test_h3_rejects_ltx_only_multi_shot_lora(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_fast",
                "shotPrompts": [{"seconds": 2, "prompt": "Move."}],
            },
        )

        assert response.status_code == 400
        assert response.json()["error"] == "H3_MULTI_SHOT_UNSUPPORTED"
        assert enable_wangp.video_calls == []

        tool_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_fast",
                "videoTool": "extend",
            },
        )
        assert tool_response.status_code == 400
        assert tool_response.json()["error"] == "VIDEO_TOOL_NOT_SUPPORTED"

        recovery = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "minimax_h3_fast"},
        )
        assert recovery.status_code == 200

    def test_ltx_quality_uses_requested_settings(self, client, enable_wangp: FakeWanGPBridge):
        response = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "ltx2_25_quality"},
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.model_type == "ltx2_25_22B"
        assert call.steps == 15
        assert call.default_settings["sample_solver"] == "res2s"
        assert call.default_settings["guidance_scale"] == 3.0
        assert call.default_settings["audio_guidance_scale"] == 7.0
        assert call.default_settings["activated_loras"] == [LTX25_DISTILLED_LORA_URL]
        assert call.default_settings["loras_multipliers"] == "0.5|"
        assert enable_wangp.resolved_profile_calls == [
            ("ltx2_25_22B", "ltx2_25_two_stage_hq_res2s_15_3", None)
        ]

    def test_h3_rejects_mixed_media_and_invalid_alias_kind(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        reference = tmp_path / "reference.png"
        Image.new("RGB", (16, 16), color="red").save(reference)
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "reference_image", "path": str(reference), "type": "image", "alias": "@image1"},
                    {"role": "control_video", "path": "control.mp4", "type": "video"},
                ],
                "prompt": "Use @image2.",
            },
        )

        assert response.status_code == 400
        assert response.json()["error"] == "H3_REF2VA_FL2VA_MEDIA_MIX"
        assert enable_wangp.video_calls == []

        invalid_alias = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "reference_image", "path": str(reference), "type": "image", "alias": "@video1"},
                ],
                "prompt": "Use @video1.",
            },
        )

        assert invalid_alias.status_code == 400
        assert invalid_alias.json()["error"] == "H3_INVALID_MEDIA_ALIAS"

        duplicate_frame = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "start_image", "path": str(reference), "type": "image"},
                    {"role": "start_image", "path": str(reference), "type": "image"},
                ],
            },
        )
        assert duplicate_frame.status_code == 400
        assert duplicate_frame.json()["error"] == "H3_DUPLICATE_SINGLETON_MEDIA"

        mismatched_type = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "reference_video", "path": str(reference), "type": "image"},
                ],
            },
        )
        assert mismatched_type.status_code == 400
        assert mismatched_type.json()["error"] == "H3_MEDIA_TYPE_MISMATCH"

        recovery = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "minimax_h3_quality"},
        )
        assert recovery.status_code == 200

    def test_h3_rejects_depth_mixed_with_reference_video(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "depth", "path": "depth.mp4", "type": "video"},
                    {"role": "reference_video", "path": "reference.mp4", "type": "video"},
                ],
            },
        )

        assert response.status_code == 400
        assert response.json()["error"] == "H3_DEPTH_REFERENCE_VIDEO_MIX"
        assert enable_wangp.video_calls == []

    def test_h3_rejects_start_image_with_reference_video(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        start = tmp_path / "start.png"
        reference = tmp_path / "reference.mp4"
        Image.new("RGB", (16, 16), color="red").save(start)
        reference.write_bytes(b"fake-video")

        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "imagePath": str(start),
                "inputMedia": [
                    {"role": "reference_video", "path": str(reference), "type": "video"},
                ],
            },
        )

        assert response.status_code == 400
        assert response.json()["error"].startswith("H3_START_IMAGE_REFERENCE_VIDEO_UNSUPPORTED")
        assert enable_wangp.video_calls == []

    def test_h3_rejects_video_soundtrack_mixed_with_audio_reference(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {
                        "role": "reference_video",
                        "path": "reference.mp4",
                        "type": "video",
                        "useAudioTrack": True,
                    },
                    {"role": "reference_audio", "path": "reference.wav", "type": "audio"},
                ],
            },
        )

        assert response.status_code == 400
        assert response.json()["error"] == "H3_SOUNDTRACK_AUDIO_REFERENCE_MIX"
        assert enable_wangp.video_calls == []

    def test_h3_control_video_keeps_its_audio_track(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        control = tmp_path / "control.mp4"
        control.write_bytes(b"fake-video")

        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "useAudioTrack": True,
                "inputMedia": [
                    {"role": "control_video", "path": str(control), "type": "video"},
                ],
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.model_type == "minimax_h3_fl2va_pruned"
        assert call.video_prompt_type == "GV"
        assert call.audio_prompt_type == "K"
        assert call.control_video_path == str(control)
        assert call.audio_path is None

        audio_guide = tmp_path / "guide.wav"
        audio_guide.write_bytes(b"RIFF\x0c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00")
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "useAudioTrack": False,
                "inputMedia": [
                    {"role": "control_video", "path": str(control), "type": "video"},
                    {"role": "audio_guide", "path": str(audio_guide), "type": "audio"},
                ],
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.audio_prompt_type == "A"
        assert call.audio_path == str(audio_guide)

    def test_h3_rejects_trimmed_control_video_soundtrack(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        control = tmp_path / "control.mp4"
        control.write_bytes(b"fake-video")

        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "useAudioTrack": True,
                "inputMedia": [
                    {
                        "role": "control_video",
                        "path": str(control),
                        "type": "video",
                        "trimDuration": 2,
                    },
                ],
            },
        )

        assert response.status_code == 400
        assert response.json()["error"] == "H3_CONTROL_VIDEO_SOUNDTRACK_EXCERPTS_UNSUPPORTED"
        assert enable_wangp.video_calls == []

        audio_guide = tmp_path / "guide.wav"
        audio_guide.write_bytes(b"RIFF\x0c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00")
        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "useAudioTrack": True,
                "inputMedia": [
                    {"role": "control_video", "path": str(control), "type": "video"},
                    {"role": "audio_guide", "path": str(audio_guide), "type": "audio"},
                ],
            },
        )

        assert response.status_code == 400
        assert response.json()["error"] == "H3_CONTROL_VIDEO_SOUNDTRACK_AUDIO_GUIDE_MIX"
        assert enable_wangp.video_calls == []

    def test_h3_soundtrack_excerpt_uses_video_without_duplicate_audio_reference(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        reference = tmp_path / "reference.mp4"
        reference.write_bytes(b"fake-video")
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_video_metadata",
            lambda _path: VideoMetadata(frame_count=120, duration_seconds=5.0),
        )

        response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {
                        "role": "reference_video",
                        "path": str(reference),
                        "type": "video",
                        "useAudioTrack": True,
                        "trimStartTime": 0.04,
                        "trimDuration": 2.0,
                    }
                ],
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[-1]
        assert call.video_prompt_type == "V1-U"
        assert call.audio_prompt_type == "K1"
        assert call.reference_video_paths == [str(reference)]
        assert call.reference_audio_paths == []

    def test_h3_rejects_unreadable_or_over_budget_full_references(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        from PIL import Image

        short_video = tmp_path / "short.mp4"
        first_video = tmp_path / "first.mp4"
        second_video = tmp_path / "second.mp4"
        missing_video = tmp_path / "missing.mp4"
        nonfinite_video = tmp_path / "nonfinite.mp4"
        for video in (short_video, first_video, second_video, missing_video, nonfinite_video):
            video.write_bytes(b"fake-video")
        first_audio = tmp_path / "first.wav"
        second_audio = tmp_path / "second.wav"
        for audio in (first_audio, second_audio):
            audio.write_bytes(b"RIFF\x0c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00")
        first_image = tmp_path / "first.png"
        second_image = tmp_path / "second.png"
        Image.new("RGB", (16, 16), color="red").save(first_image)
        Image.new("RGB", (16, 16), color="blue").save(second_image)

        video_durations = {
            str(short_video): 1.5,
            str(first_video): 8.0,
            str(second_video): 8.0,
            str(missing_video): None,
            str(nonfinite_video): float("nan"),
        }
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_video_metadata",
            lambda path: (
                VideoMetadata(frame_count=120, duration_seconds=duration)
                if (duration := video_durations[str(path)]) is not None
                else None
            ),
        )
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_audio_metadata",
            lambda path: AudioMetadata(
                duration_seconds=1.5 if Path(path).name == "first.wav" else 8.0
            ),
        )

        short_video_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [{"role": "reference_video", "path": str(short_video), "type": "video"}],
            },
        )
        assert short_video_response.status_code == 400
        assert short_video_response.json()["error"] == "H3_REFERENCE_DURATION_LIMIT"

        missing_video_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [{"role": "reference_video", "path": str(missing_video), "type": "video"}],
            },
        )
        assert missing_video_response.status_code == 400
        assert missing_video_response.json()["error"] == "H3_REFERENCE_DURATION_UNAVAILABLE"

        nonfinite_video_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [{"role": "reference_video", "path": str(nonfinite_video), "type": "video"}],
            },
        )
        assert nonfinite_video_response.status_code == 400
        assert nonfinite_video_response.json()["error"] == "H3_REFERENCE_DURATION_UNAVAILABLE"

        video_budget_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "reference_video", "path": str(first_video), "type": "video"},
                    {"role": "reference_video", "path": str(second_video), "type": "video"},
                ],
            },
        )
        assert video_budget_response.status_code == 400
        assert video_budget_response.json()["error"] == "H3_REFERENCE_TOTAL_DURATION_LIMIT"

        audio_duration_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "reference_image", "path": str(first_image), "type": "image"},
                    {"role": "reference_audio", "path": str(first_audio), "type": "audio"},
                ],
            },
        )
        assert audio_duration_response.status_code == 400
        assert audio_duration_response.json()["error"] == "H3_REFERENCE_DURATION_LIMIT"

        audio_budget_response = client.post(
            "/api/generate",
            json={
                **_T2V_JSON,
                "modelProfileId": "minimax_h3_quality",
                "inputMedia": [
                    {"role": "reference_image", "path": str(first_image), "type": "image"},
                    {"role": "reference_image", "path": str(second_image), "type": "image"},
                    {"role": "reference_audio", "path": str(second_audio), "type": "audio"},
                    {"role": "reference_audio", "path": str(second_audio), "type": "audio"},
                ],
            },
        )
        assert audio_budget_response.status_code == 400
        assert audio_budget_response.json()["error"] == "H3_REFERENCE_TOTAL_DURATION_LIMIT"

    def test_video_profile_square_aspect_routes_to_ltx2(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={
                "prompt": "A beautiful sunset",
                "resolution": "1080p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "aspectRatio": "1:1",
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.resolution_label == "1088x1088"
        assert call.aspect_ratio == "1:1"

    def test_multi_shot_prompt_formats_relay_ranges(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={
                "prompt": "Global cinematic style",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "enhancePrompt": True,
                "shotPrompts": [
                    {"seconds": 4, "prompt": "The knight raises a shield."},
                    {"seconds": 5, "prompt": "The dragon breathes fire."},
                ],
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.duration_seconds == 9
        assert call.prompt == (
            "Global cinematic style\n"
            "[0s:4s] The knight raises a shield.\n"
            "[4s:9s] The dragon breathes fire."
        )
        assert call.default_settings["activated_loras"] == [
            "LTX-2.3_Cinematic_hardcut.safetensors",
        ]
        assert call.default_settings["loras_multipliers"] == "1.0"
        assert call.default_settings["prompt_enhancer"] == "T1"

    def test_multi_shot_with_start_image_uses_text_image_relay_enhancer(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        start_image = tmp_path / "relay-start.png"
        Image.new("RGB", (16, 16), color="red").save(start_image)
        response = client.post(
            "/api/generate",
            json={
                "prompt": "Global style",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "2",
                "fps": "24",
                "enhancePrompt": True,
                "inputMedia": [
                    {"role": "start_image", "path": str(start_image), "type": "image"}
                ],
                "shotPrompts": [{"seconds": 2, "prompt": "Walk forward."}],
            },
        )

        assert response.status_code == 200
        assert enable_wangp.video_calls[0].default_settings["prompt_enhancer"] == "TI1"

    def test_multi_shot_allows_empty_global_prompt(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={
                "prompt": "",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "shotPrompts": [
                    {"seconds": 2, "prompt": "Shot-only prompt."},
                ],
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.duration_seconds == 2
        assert call.prompt == "[0s:2s] Shot-only prompt."
        assert call.default_settings["activated_loras"] == [
            "LTX-2.3_Cinematic_hardcut.safetensors",
        ]
        assert call.default_settings["loras_multipliers"] == "1.0"

    def test_regular_video_generation_does_not_activate_multi_shot_lora(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={
                "prompt": "A single continuous shot.",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert "activated_loras" not in call.default_settings
        assert "loras_multipliers" not in call.default_settings

    def test_unknown_video_profile_rejected(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "not_real"},
        )

        assert r.status_code == 400
        assert "UNKNOWN_VIDEO_MODEL_PROFILE" in r.json()["error"]
        assert enable_wangp.video_calls == []

    def test_unsupported_video_resolution_rejected(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        r = client.post(
            "/api/generate",
            json={**_T2V_JSON, "modelProfileId": "ltx2_25_fast", "resolution": "1440p"},
        )

        assert r.status_code == 400
        assert "UNSUPPORTED_VIDEO_RESOLUTION_TIER" in r.json()["error"]
        assert enable_wangp.video_calls == []

    def test_i2v_nonexistent_image(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post(
            "/api/generate",
            json={**_T2V_JSON, "imagePath": "/no/such/file.png"},
        )
        assert r.status_code == 400

    def test_i2v_rejects_invalid_image_content_400(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        bad_image = tmp_path / "bad.png"
        bad_image.write_bytes(b"not-a-real-png")

        r = client.post(
            "/api/generate",
            json={**_T2V_JSON, "imagePath": str(bad_image)},
        )
        assert r.status_code == 400
        assert "Invalid image file" in r.json()["error"]

    def test_video_multi_input_happy_path(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        # Create valid test files
        img = Image.new("RGB", (1, 1), color="red")
        start_img = tmp_path / "start.png"
        img.save(start_img)

        end_img = tmp_path / "end.png"
        img.save(end_img)

        audio = tmp_path / "audio.wav"
        audio.write_bytes(b"RIFF\x0c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00")

        video = tmp_path / "video.mp4"
        video.write_bytes(b"fake-video")

        r = client.post(
            "/api/generate",
            json={
                "prompt": "A beautiful sunset",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "2",
                "fps": "24",
                "cameraMotion": "none",
                "videoPromptType": "VG",
                "enhancePrompt": True,
                "inputMedia": [
                    {"role": "start_image", "path": str(start_img), "type": "image"},
                    {"role": "end_image", "path": str(end_img), "type": "image"},
                    {"role": "control_video", "path": str(video), "type": "video"},
                    {"role": "audio_guide", "path": str(audio), "type": "audio"},
                ]
            },
        )

        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "complete"

        assert len(enable_wangp.video_calls) == 1
        call = enable_wangp.video_calls[0]
        assert call.start_image_path == str(start_img)
        assert call.end_image_path == str(end_img)
        assert call.control_video_path == str(video)
        assert call.audio_path == str(audio)
        assert call.video_prompt_type == "VG"
        assert call.default_settings["prompt_enhancer"] == "TI"

    def test_video_input_trim_passes_clipped_path_and_frame_count(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        video = tmp_path / "video.mp4"
        video.write_bytes(b"fake-video")
        clipped = tmp_path / "video_trimmed.mp4"
        clipped.write_bytes(b"fake-video")

        def fake_extract(
            source_path: str | Path,
            *,
            start_time: float,
            duration: float,
            output_dir: Path,
        ) -> Path:
            del output_dir
            assert str(source_path) == str(video)
            assert start_time == 1.5
            assert duration == 4.0
            return clipped

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_video_clip",
            fake_extract,
        )
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_video_metadata",
            lambda path: VideoMetadata(frame_count=97, duration_seconds=4.0),
        )

        r = client.post(
            "/api/generate",
            json={
                "prompt": "A dancer",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "10",
                "fps": "24",
                "cameraMotion": "none",
                "videoPromptType": "VG",
                "inputMedia": [
                    {
                        "role": "control_video",
                        "path": str(video),
                        "type": "video",
                        "trimStartTime": 1.5,
                        "trimDuration": 4.0,
                    },
                ],
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.duration_seconds == 4
        assert call.control_video_path == str(clipped)
        assert call.video_length_frames == 97

    def test_continue_video_duration_extends_trimmed_source(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        video = tmp_path / "source.mp4"
        video.write_bytes(b"fake-video")
        clipped = tmp_path / "source_trimmed.mp4"
        clipped.write_bytes(b"fake-video")

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_video_clip",
            lambda *_args, **_kwargs: clipped,
        )
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_video_metadata",
            lambda _path: VideoMetadata(frame_count=97, duration_seconds=4.0),
        )

        response = client.post(
            "/api/generate",
            json={
                "prompt": "Keep walking",
                "videoTool": "extend",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "cameraMotion": "none",
                "enhancePrompt": True,
                "inputMedia": [
                    {
                        "role": "continue_video",
                        "path": str(video),
                        "type": "video",
                        "trimStartTime": 0,
                        "trimDuration": 4.0,
                    },
                ],
            },
        )

        assert response.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.duration_seconds == 5
        assert call.start_image_path == str(clipped)
        assert call.image_prompt_type == "V"
        assert call.video_length_frames == 217
        assert "activated_loras" not in call.default_settings
        assert call.default_settings["prompt_enhancer"] == "T"

    def test_curated_video_tools_activate_exact_lora(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        video = tmp_path / "source.mp4"
        video.write_bytes(b"fake-video")
        clipped = tmp_path / "source_trimmed.mp4"

        def fake_extract(
            source_path: str | Path,
            *,
            start_time: float,
            duration: float,
            output_dir: Path,
        ) -> Path:
            del output_dir
            assert str(source_path) == str(video)
            assert start_time == 1.0
            assert duration == 4.0
            clipped.write_bytes(b"fake-video")
            return clipped

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_video_clip",
            fake_extract,
        )
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_video_metadata",
            lambda _path: VideoMetadata(frame_count=97, duration_seconds=4.0),
        )
        tool_loras = {
            "relight": "black-magic-ic-lora-450.safetensors",
            "colorize": "ltx-2.3-22b-ic-lora-colorization-0.9.safetensors",
            "clean_plate": "ltx-2.3-22b-ic-lora-clean-plate-1.0.safetensors",
            "lip_dub": "ltx-2.3-22b-ic-lora-lipdub-0.9.safetensors",
            "decompression": "ltx-2.3-22b-ic-lora-decompression-0.9.safetensors",
            "sdr_to_hdr": "ltx-2.3-22b-ic-lora-hdr-0.9.safetensors",
            "remove_glare": "lens-remover-ltx23-ic-lora.safetensors",
            "deblur": "ltx-2.3-22b-ic-lora-deblur-0.9.safetensors",
        }

        for tool, filename in tool_loras.items():
            response = client.post(
                "/api/generate",
                json={
                    **_T2V_JSON,
                    "modelProfileId": "ltx2_25_fast",
                    "videoTool": tool,
                    "enhancePrompt": True,
                    "inputMedia": [
                        {
                            "role": "control_video",
                            "path": str(video),
                            "type": "video",
                            "trimStartTime": 1.0,
                            "trimDuration": 4.0,
                        }
                    ],
                },
            )

            assert response.status_code == 200
            call = enable_wangp.video_calls[-1]
            assert call.model_type == "ltx2_25_22B_distilled"
            assert call.default_settings["activated_loras"] == [
                f"https://huggingface.co/buckets/retIbedi/LTX-Loras/resolve/{filename}"
            ]
            assert call.default_settings["loras_multipliers"] == ""
            assert call.default_settings["force_fps"] == "control"
            assert call.default_settings["guidance_phases"] == 2
            assert call.video_prompt_type == "VG"
            assert call.image_prompt_type is None
            assert call.audio_prompt_type == "K"
            assert call.start_image_path is None
            assert call.control_video_path == str(clipped)
            assert call.video_length_frames == 97
            assert call.default_settings["prompt_enhancer"] == "T"
            assert not clipped.exists()

    def test_video_tool_rejects_unknown_id_and_missing_source(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        unknown = client.post(
            "/api/generate", json={**_T2V_JSON, "videoTool": "unknown"}
        )
        missing = client.post(
            "/api/generate", json={**_T2V_JSON, "videoTool": "relight"}
        )

        assert unknown.status_code == 422
        assert missing.status_code == 400
        assert "VIDEO_TOOL_SOURCE_REQUIRED" in missing.json()["error"]
        assert enable_wangp.video_calls == []

    @pytest.mark.parametrize("mode", ["replace_audio_and_video", "replace_video", "replace_audio"])
    def test_retake_is_unavailable_without_generation(
        self, client, enable_wangp: FakeWanGPBridge, mode
    ):
        response = client.post(
            "/api/retake",
            json={
                "video_path": "saved-source.mp4",
                "start_time": 1.5,
                "duration": 4,
                "prompt": "Make the movement dramatic",
                "mode": mode,
            },
        )

        assert response.status_code == 501
        assert "RETAKE_UNAVAILABLE" in response.json()["error"]
        assert enable_wangp.video_calls == []

    def test_audio_input_trim_passes_clipped_path_and_duration(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        audio = tmp_path / "audio.wav"
        audio.write_bytes(b"RIFF\x0c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00")
        clipped = tmp_path / "audio_trimmed.wav"
        clipped.write_bytes(b"RIFF\x0c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00")

        def fake_extract(
            source_path: str | Path,
            *,
            start_time: float,
            duration: float,
            output_dir: Path,
        ) -> Path:
            del output_dir
            assert str(source_path) == str(audio)
            assert start_time == 2.0
            assert duration == 3.0
            return clipped

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_audio_clip",
            fake_extract,
        )

        r = client.post(
            "/api/generate",
            json={
                "prompt": "A music video",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "10",
                "fps": "24",
                "cameraMotion": "none",
                "inputMedia": [
                    {
                        "role": "audio_to_video",
                        "path": str(audio),
                        "type": "audio",
                        "trimStartTime": 2.0,
                        "trimDuration": 3.0,
                    },
                ],
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.duration_seconds == 3
        assert call.audio_path == str(clipped)

    def test_reframe_happy_path(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        video = tmp_path / "video.mp4"
        video.write_bytes(b"fake-video")
        clipped = tmp_path / "clipped.mp4"
        clipped.write_bytes(b"fake-video")

        def fake_extract(
            source_path: Path,
            *,
            start_time: float,
            duration: float,
            output_dir: Path,
        ) -> Path:
            del source_path, start_time, duration, output_dir
            return clipped

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_video_clip",
            fake_extract,
        )
        monkeypatch.setattr(
            "handlers.video_generation_handler.probe_video_metadata",
            lambda path: VideoMetadata(frame_count=150, duration_seconds=5.0),
        )

        r = client.post(
            "/api/generate",
            json={
                "prompt": "",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "cameraMotion": "none",
                "enhancePrompt": True,
                "inputMedia": [
                    {"role": "control_video", "path": str(video), "type": "video"},
                ],
                "reframe": {
                    "aspectMode": "1:1",
                    "padding": {"top": 0, "bottom": 0, "left": 0, "right": 0},
                    "controlVideoStartTime": 0,
                    "controlVideoDuration": 5,
                },
            },
        )

        assert r.status_code == 200
        assert r.json()["status"] == "complete"
        assert len(enable_wangp.video_calls) == 1
        call = enable_wangp.video_calls[0]
        assert call.prompt == "outpaint"
        assert call.control_video_path == str(clipped)
        assert call.video_prompt_type == "VG"
        assert call.audio_prompt_type == "K"
        assert call.default_settings["prompt_enhancer"] == "T"
        assert call.video_guide_outpainting == ""
        assert call.video_guide_outpainting_ratio == ""
        assert call.video_length_frames == 150
        assert call.default_settings["force_fps"] == "auto"
        assert call.default_settings["sliding_window_overlap"] == 33

    def test_reframe_custom_padding(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        video = tmp_path / "video.mp4"
        video.write_bytes(b"fake-video")
        clipped = tmp_path / "clipped.mp4"
        clipped.write_bytes(b"fake-video")

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_video_clip",
            lambda source_path, *, start_time, duration, output_dir: clipped,
        )

        r = client.post(
            "/api/generate",
            json={
                "prompt": "extend the office background",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "cameraMotion": "none",
                "inputMedia": [
                    {"role": "control_video", "path": str(video), "type": "video"},
                ],
                "reframe": {
                    "aspectMode": "custom",
                    "padding": {"top": 35, "bottom": 70, "left": 40, "right": 30},
                    "controlVideoStartTime": 1.5,
                    "controlVideoDuration": 4,
                },
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.prompt == "extend the office background"
        assert call.video_guide_outpainting == "35 70 40 30"
        assert call.video_guide_outpainting_ratio == ""

    def test_reframe_accepts_unbounded_placement_padding(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path, monkeypatch
    ):
        video = tmp_path / "video.mp4"
        video.write_bytes(b"fake-video")
        clipped = tmp_path / "clipped.mp4"
        clipped.write_bytes(b"fake-video")

        monkeypatch.setattr(
            "handlers.video_generation_handler.extract_video_clip",
            lambda source_path, *, start_time, duration, output_dir: clipped,
        )

        r = client.post(
            "/api/generate",
            json={
                "prompt": "",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "cameraMotion": "none",
                "inputMedia": [
                    {"role": "control_video", "path": str(video), "type": "video"},
                ],
                "reframe": {
                    "aspectMode": "9:21",
                    "padding": {"top": 0, "bottom": 0, "left": 0, "right": 875},
                    "controlVideoStartTime": 0,
                    "controlVideoDuration": 5,
                },
            },
        )

        assert r.status_code == 200
        call = enable_wangp.video_calls[0]
        assert call.video_guide_outpainting == "0 0 0 875"
        assert call.video_guide_outpainting_ratio == ""

    def test_reframe_requires_options_payload(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        video = tmp_path / "video.mp4"
        video.write_bytes(b"fake-video")

        r = client.post(
            "/api/generate",
            json={
                "prompt": "outpaint",
                "resolution": "540p",
                "modelProfileId": "ltx2_25_fast",
                "duration": "5",
                "fps": "24",
                "cameraMotion": "none",
                "videoPromptType": "VG",
                "inputMedia": [
                    {"role": "control_video", "path": str(video), "type": "video"},
                ],
            },
        )

        assert r.status_code == 400
        assert "REFRAME_OPTIONS_REQUIRED" in r.text
        assert len(enable_wangp.video_calls) == 0

    def test_resolution_mapping_540p(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 200

        call = enable_wangp.video_calls[0]
        assert call.resolution_label == "960x544"
        assert call.aspect_ratio == "16:9"

    def test_resolution_mapping_720p(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post("/api/generate", json={**_T2V_JSON, "resolution": "720p"})
        assert r.status_code == 200

        call = enable_wangp.video_calls[0]
        assert call.resolution_label == "1280x720"

    def test_locked_seed(self, client, enable_wangp: FakeWanGPBridge, test_state):
        test_state.state.app_settings.seed_locked = True
        test_state.state.app_settings.locked_seed = 123

        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 200

        assert enable_wangp.video_calls[0].seed == 123

    def test_unlocked_seed_is_resolved_and_returned(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 200

        seed = r.json()["resolvedSeed"]
        assert 0 <= seed <= 2_147_483_647
        assert enable_wangp.video_calls[0].seed == seed

    def test_error_sets_generation_error(self, client, enable_wangp: FakeWanGPBridge, test_state):
        enable_wangp.raise_on_video = RuntimeError("GPU OOM")

        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 500

        progress = test_state.generation.get_generation_progress()
        assert progress.status == "error"

    def test_cancelled_response(self, client, enable_wangp: FakeWanGPBridge):
        enable_wangp.raise_on_video = RuntimeError("cancelled")

        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 200
        assert r.json()["status"] == "cancelled"


class TestGenerateCancel:
    def test_cancel_active(self, client, test_state):
        _fake_running_generation_state(test_state)

        r = client.post("/api/generate/cancel")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "cancelling"

    def test_cancel_no_active(self, client):
        r = client.post("/api/generate/cancel")
        assert r.status_code == 200
        assert r.json()["status"] == "no_active_generation"


class TestGenerationProgress:
    def test_idle(self, client):
        r = client.get("/api/generation/progress")
        assert r.status_code == 200
        assert r.json()["status"] == "idle"

    def test_running(self, client, test_state):
        _fake_running_generation_state(test_state)
        test_state.generation.update_progress("inference", 50, 4, 8)

        r = client.get("/api/generation/progress")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "running"
        assert data["phase"] == "inference"
        assert data["progress"] == 50
        assert data["currentStep"] == 4
        assert data["totalSteps"] == 8

    def test_running_from_api_generation_state(self, client, test_state):
        test_state.generation.start_generation_job("api-running")
        test_state.generation.update_progress("inference", 35)

        r = client.get("/api/generation/progress")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "running"
        assert data["phase"] == "inference"
        assert data["progress"] == 35
        assert data["currentStep"] is None
        assert data["totalSteps"] is None


class TestGenerateImage:
    """WanGP-backed image generation through ``POST /api/generate-image``."""

    def test_happy_path(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post(
            "/api/generate-image",
            json={"prompt": "A cat", "width": 1024, "height": 1024, "numSteps": 8},
        )

        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "complete"
        assert len(data["image_paths"]) == 1
        assert Path(data["image_paths"][0]).exists()

        assert len(enable_wangp.image_calls) == 1
        call = enable_wangp.image_calls[0]
        assert call.prompt == "A cat"
        assert call.width == 1024
        assert call.height == 1024
        assert call.num_steps == 8
        assert isinstance(call.seed, int)
        assert call.seed == data["resolvedSeed"]
        assert call.default_settings["prompt_enhancer"] == ""

    def test_curated_native_profile_reaches_image_generation(
        self, test_state, enable_wangp: FakeWanGPBridge
    ):
        response = test_state.image_generation.generate(
            GenerateImageRequest.model_validate(
                {
                "prompt": "A cat",
                "modelProfileId": "krea2_turbo",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                }
            )
        )

        assert response.status == "complete"
        assert enable_wangp.resolved_profile_calls == [
            ("krea2_turbo", None, None)
        ]
        assert enable_wangp.image_calls[0].model_type == "krea2_turbo"

    def test_prompt_enhancer_uses_text_without_input_image(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate-image",
            json={"prompt": "A cat", "enhancePrompt": True},
        )

        assert response.status_code == 200
        assert enable_wangp.image_calls[0].default_settings["prompt_enhancer"] == "T"

    def test_disabled_prompt_enhancer_overrides_profile_default(
        self, client, enable_wangp: FakeWanGPBridge
    ):
        response = client.post(
            "/api/generate-image",
            json={
                "prompt": "Poster layout",
                "modelProfileId": "ideogram4_int8",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "enhancePrompt": False,
            },
        )

        assert response.status_code == 200
        assert enable_wangp.image_calls[0].default_settings["prompt_enhancer"] == ""

    def test_prompt_enhancer_uses_reference_image_but_not_control_guide(
        self, client, enable_wangp: FakeWanGPBridge, tmp_path: Path
    ):
        from PIL import Image

        image_path = tmp_path / "input.png"
        Image.new("RGB", (16, 16), color="red").save(image_path)
        reference_response = client.post(
            "/api/generate-image",
            json={
                "prompt": "Add a hat",
                "modelProfileId": "flux2_klein_4b",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "enhancePrompt": True,
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "reference_subject",
                    }
                ],
            },
        )
        control_response = client.post(
            "/api/generate-image",
            json={
                "prompt": "Follow the pose",
                "modelProfileId": "z_image_turbo",
                "aspectRatio": "1:1",
                "resolutionTier": "720p",
                "enhancePrompt": True,
                "inputMedia": [
                    {
                        "type": "image",
                        "path": str(image_path),
                        "role": "control_pose",
                    }
                ],
            },
        )

        assert reference_response.status_code == 200
        assert control_response.status_code == 200
        assert [
            call.default_settings["prompt_enhancer"]
            for call in enable_wangp.image_calls
        ] == ["TI", "T"]

    def test_dimension_clamping(self, client, enable_wangp: FakeWanGPBridge):
        # WanGP bridge receives the request dimensions directly; the bridge
        # is responsible for any alignment. The handler still passes the
        # raw WxH through, so we assert the call captures 1023x1023.
        r = client.post(
            "/api/generate-image",
            json={"prompt": "test", "width": 1023, "height": 1023},
        )
        assert r.status_code == 200

        call = enable_wangp.image_calls[0]
        assert call.width == 1008
        assert call.height == 1008

    def test_num_images_clamped(self, client, enable_wangp: FakeWanGPBridge):
        r = client.post(
            "/api/generate-image",
            json={"prompt": "test", "numImages": 20},
        )
        assert r.status_code == 200

        # Low-VRAM profiles generate variation chunks sequentially.
        assert len(enable_wangp.image_calls) == 12
        assert all(call.num_images == 1 for call in enable_wangp.image_calls)
        seed = r.json()["resolvedSeed"]
        assert 0 <= seed <= 2_147_483_647
        assert [call.seed for call in enable_wangp.image_calls] == list(range(seed, seed + 12))
        assert len(r.json()["image_paths"]) == 12

    def test_locked_seed_offsets_sequential_image_chunks(
        self, client, enable_wangp: FakeWanGPBridge, test_state
    ):
        test_state.state.app_settings.seed_locked = True
        test_state.state.app_settings.locked_seed = 123

        r = client.post("/api/generate-image", json={"prompt": "test", "numImages": 3})

        assert r.status_code == 200
        assert r.json()["resolvedSeed"] == 123
        assert [call.seed for call in enable_wangp.image_calls] == [123, 124, 125]

    def test_error(self, client, enable_wangp: FakeWanGPBridge):
        enable_wangp.raise_on_images = RuntimeError("GPU OOM")

        r = client.post("/api/generate-image", json={"prompt": "test"})
        assert r.status_code == 500

    def test_cancelled(self, client, enable_wangp: FakeWanGPBridge):
        enable_wangp.raise_on_images = RuntimeError("cancelled")

        r = client.post("/api/generate-image", json={"prompt": "test"})
        assert r.status_code == 200
        assert r.json()["status"] == "cancelled"


class TestEmptyPromptRejected:
    def test_empty_prompt_rejected(self, client):
        r = client.post("/api/generate", json={"prompt": ""})
        assert r.status_code == 422

    def test_whitespace_prompt_rejected(self, client):
        r = client.post("/api/generate", json={"prompt": "   "})
        assert r.status_code == 422

    def test_missing_prompt_rejected(self, client):
        r = client.post("/api/generate", json={})
        assert r.status_code == 422

    def test_empty_image_prompt_rejected(self, client):
        r = client.post("/api/generate-image", json={"prompt": ""})
        assert r.status_code == 422

    def test_whitespace_image_prompt_rejected(self, client):
        r = client.post("/api/generate-image", json={"prompt": "   "})
        assert r.status_code == 422

    def test_missing_image_prompt_rejected(self, client):
        r = client.post("/api/generate-image", json={})
        assert r.status_code == 422
