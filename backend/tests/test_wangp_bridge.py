from __future__ import annotations

import json
import sys
import os
import threading
import time
from collections import deque
from collections.abc import Callable
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from PIL import Image

from services.wangp_bridge import (
    CUSTOM_FINETUNE_CHECKPOINT_KEY,
    WanGPBridge,
    resolve_audio_performance_profile,
)


@pytest.mark.parametrize("profile", [1.0, 2.0, 3.0, 4.5, 5.0])
def test_audio_performance_profile_passes_through_other_values(profile: float) -> None:
    assert resolve_audio_performance_profile(profile) == profile


def test_audio_performance_profile_maps_four_to_three_plus() -> None:
    assert resolve_audio_performance_profile(4.0) == 3.5


def _capture_progress_event(data: object) -> tuple[object, ...]:
    captured: list[tuple[object, ...]] = []
    _make_bridge()._handle_event(
        SimpleNamespace(kind="progress", data=data),
        lambda *args: captured.append(args),
        deque(),
        {"phase": "", "progress": -1, "logged_at": 0.0},
    )
    return captured[-1]


def test_native_model_download_preserves_exact_transfer_progress() -> None:
    captured = []
    callback = _make_bridge()._download_callback(lambda *args: captured.append(args), "ltx2_25_22B")
    callback({
        "completed": 6_895_321_088, "total": 12_992_123_904,
        "filename": "model-00003-of-00006.safetensors",
        "speed": 88_080_384.0, "file_index": 3, "file_count": 6,
    })
    transfer = captured[-1][14]
    assert captured[-1][13] == "bytes"
    assert transfer.current == 6_895_321_088
    assert transfer.filename == "model-00003-of-00006.safetensors"
    assert transfer.speed_bps == 88_080_384.0
    assert round(transfer.percent, 1) == 53.1
    callback(None)
    assert len(captured) == 1


def test_model_lifecycle_phase_classification_is_specific() -> None:
    assert WanGPBridge._classify_phase("Checking model files for X...") == "checking_model_files"
    assert WanGPBridge._classify_phase("Downloading model X...") == "downloading_model"
    assert WanGPBridge._classify_phase("Loading model X into memory...") == "loading_model"
    assert WanGPBridge._classify_phase("Model loaded") == "loading_model"


def _make_bridge(*, image_model_type: str = "z_image") -> WanGPBridge:
    return WanGPBridge(
        enabled=True,
        root=Path(r"E:\ML\w20"),
        python_executable=None,
        config_dir=Path(r"E:\tmp\wangp_bridge"),
        output_dir=Path(r"E:\tmp\wangp_outputs"),
        video_model_type="ltx2_25_22B_distilled",
        image_model_type=image_model_type,
        camera_motion_prompts={},
        extra_args=(),
    )


@pytest.mark.parametrize(
    ("mode", "expected_context_duration"),
    [("video", 4.5), ("image", None)],
)
def test_prompt_enhancer_uses_native_image_context(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mode: str, expected_context_duration: float | None,
) -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    class FakeImageContext:
        def __init__(self, images: list[Image.Image], labels: list[str], duration_seconds: float | None) -> None:
            self.images = images
            self.labels = labels
            self.duration_seconds = duration_seconds

    def fake_enhancer(
        state, model_type, model_def, prompt_enhancer_modes, original_prompts,
        image_start, original_image_refs, is_image, audio_only, seed, progress, override_profile,
        *, enhancer_kwargs,
    ):
        captured.update(
            prompt_enhancer_modes=prompt_enhancer_modes,
            image_start=image_start,
            image_refs=original_image_refs,
            is_image=is_image,
            enhancer_kwargs=enhancer_kwargs,
        )
        return [[" enhanced prompt "]]

    module = SimpleNamespace(
        exec_prompt_enhancer_engine=fake_enhancer,
        normalize_generated_prompt_lines=lambda prompt, _mode: prompt,
        get_model_def=lambda _model_type: {"prompt_enhancer_video_duration": True},
    )
    session = SimpleNamespace(
        _state={},
        _ensure_runtime=lambda: SimpleNamespace(root=tmp_path, module=module),
    )
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    bridge._ensure_local_enhancer_config = lambda _session=None: None  # type: ignore[method-assign]
    monkeypatch.setattr(
        "services.wangp_bridge.importlib.import_module",
        lambda name: SimpleNamespace(ImageContext=FakeImageContext) if name == "shared.prompt_enhancer.images" else None,
    )

    image_paths = [tmp_path / name for name in ("start.png", "end.png", "ref-1.png", "ref-2.png", "control.png")]
    for index, path in enumerate(image_paths):
        Image.new("RGB", (2, 2), color=(index, 0, 0)).save(path)

    result = bridge.enhance_prompt(
        prompt="a cinematic test",
        mode=mode,
        model_type="ltx2_25_22B_distilled",
        image_path=str(image_paths[0]),
        end_image_path=str(image_paths[1]),
        reference_image_paths=[str(image_paths[2]), str(image_paths[3])],
        control_image_path=str(image_paths[4]),
        duration_seconds=4.5,
    )

    assert result == "enhanced prompt"
    assert captured["prompt_enhancer_modes"] == "TI"
    assert captured["is_image"] is (mode == "image")
    context = cast(FakeImageContext, cast(dict[str, object], captured["enhancer_kwargs"])["image_contexts"][0])
    assert context.labels == ["start image", "end image", "Image reference no 1", "Image reference no 2", "Control Image"]
    assert context.duration_seconds == expected_context_duration
    kwargs = cast(dict[str, object], captured["enhancer_kwargs"])
    assert kwargs["image_prompt_type"] == "SE"
    assert kwargs["video_prompt_type"] == "IV"
    assert kwargs["control_image"] is context.images[-1]
    assert kwargs.get("duration_seconds") is None
    assert kwargs.get("video_duration_seconds") == (4.5 if mode == "video" else None)
    assert captured["image_start"] == [context.images[0]]
    assert captured["image_refs"] == context.images[2:4]


def test_prompt_enhancer_passes_native_duration_for_text_only_video(tmp_path: Path) -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_enhancer(
        state, model_type, model_def, prompt_enhancer_modes, original_prompts,
        image_start, original_image_refs, is_image, audio_only, seed, progress, override_profile,
        *, enhancer_kwargs,
    ):
        captured["prompt_enhancer_modes"] = prompt_enhancer_modes
        captured["enhancer_kwargs"] = enhancer_kwargs
        return [["enhanced prompt"]]

    module = SimpleNamespace(
        exec_prompt_enhancer_engine=fake_enhancer,
        normalize_generated_prompt_lines=lambda prompt, _mode: prompt,
        get_model_def=lambda _model_type: {"prompt_enhancer_video_duration": True},
    )
    session = SimpleNamespace(
        _state={},
        _ensure_runtime=lambda: SimpleNamespace(root=tmp_path, module=module),
    )
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    bridge._ensure_local_enhancer_config = lambda _session=None: None  # type: ignore[method-assign]

    assert bridge.enhance_prompt(
        prompt="a cinematic test", mode="video", model_type="ltx2_25_22B_distilled", duration_seconds=4.5,
    ) == "enhanced prompt"
    assert captured["prompt_enhancer_modes"] == "T"
    kwargs = cast(dict[str, object], captured["enhancer_kwargs"])
    assert "image_contexts" not in kwargs
    assert kwargs["video_duration_seconds"] == 4.5


def test_compose_music_lyrics_keeps_audio_prompt_enhancer_inputs() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_prompt_enhancer(**kwargs: object) -> str:
        captured.update(kwargs)
        return "[Verse]\\nLocal lyrics"

    bridge._run_prompt_enhancer = fake_run_prompt_enhancer  # type: ignore[method-assign]

    assert bridge.compose_music_lyrics(
        description="A warm ambient song", lyrics_prompt=None, language="en", duration_seconds=120,
        model_type="ace_step_v1_5", think=True, seed=17,
    ) == "[Verse]\\nLocal lyrics"
    assert captured["mode"] == "audio"
    assert captured["image_path"] is None
    assert captured["think"] is True
    assert captured["seed"] == 17


def test_configured_checkpoints_directory_updates_wangp_config(tmp_path: Path) -> None:
    checkpoints_dir = tmp_path / "existing-wangp" / "ckpts"
    WanGPBridge(
        enabled=True,
        root=tmp_path,
        python_executable=None,
        config_dir=tmp_path / "config",
        output_dir=tmp_path / "outputs",
        video_model_type="ltx2_25_22B_distilled",
        image_model_type="z_image",
        camera_motion_prompts={},
        checkpoints_dir=checkpoints_dir,
    )

    saved = json.loads((tmp_path / "config" / "wgp_config.json").read_text(encoding="utf-8"))
    assert saved["checkpoints_paths"] == [str(checkpoints_dir.resolve()), "."]


def test_qwen_image_resolution_uses_native_16_9_preset() -> None:
    bridge = _make_bridge(image_model_type="qwen_image_20B")

    assert bridge._map_image_resolution(1920, 1072) == (1664, 928)


def test_qwen_image_resolution_supports_ultrawide_aspect() -> None:
    bridge = _make_bridge(image_model_type="qwen_image_20B")

    assert bridge._map_image_resolution(2520, 1080) == (1920, 832)


def test_qwen_image_resolution_supports_three_two_aspect() -> None:
    bridge = _make_bridge(image_model_type="qwen_image_20B")

    assert bridge._map_image_resolution(1536, 1024) == (1536, 1024)


def test_non_qwen_image_resolution_is_left_unchanged() -> None:
    bridge = _make_bridge(image_model_type="z_image")

    assert bridge._map_image_resolution(1920, 1072) == (1920, 1072)


def test_generate_music_maps_verified_wangp_settings() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        del on_progress, is_cancelled
        captured["manifest"] = manifest
        captured["media_suffixes"] = media_suffixes
        return [r"E:\tmp\song.wav"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]

    output = bridge.generate_music(
        description="Warm cinematic ambient music",
        lyrics="[Verse]\nHello",
        duration_seconds=45,
        bpm=96,
        key_scale="A minor",
        time_signature="6/8",
        language="en",
        model_mode=3,
        temperature=1.15,
        top_p=0.9,
        top_k=0,
        lm_guidance_scale=2.5,
        source_audio_path=r"E:\tmp\cover.wav",
        reference_timbre_path=None,
        audio_prompt_type="A",
        cover_strength=0.5,
        seed=42,
        model_type="ace_step_v1_5_turbo_lm_1_7b",
        default_settings={"num_inference_steps": 8, "duration_seconds": 99},
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
    )

    assert output == r"E:\tmp\song.wav"
    assert captured["manifest"] == [
        {
            "id": 1,
            "params": {
                "model_type": "ace_step_v1_5_turbo_lm_1_7b",
                "prompt": "[Verse]\nHello",
                "alt_prompt": "Warm cinematic ambient music",
                "duration_seconds": 45,
                "audio_prompt_type": "A",
                "repeat_generation": 1,
                "multi_prompts_gen_type": "FG",
                "num_inference_steps": 8,
                "model_mode": 3,
                "temperature": 1.15,
                "top_p": 0.9,
                "top_k": 0,
                "alt_guidance_scale": 2.5,
                "custom_settings": {
                    "bpm": 96,
                    "keyscale": "A minor",
                    "timesignature": 6,
                    "language": "en",
                },
                "audio_guide": r"E:\tmp\cover.wav",
                "audio_scale": 0.5,
                "seed": 42,
            },
            "plugin_data": {},
        }
    ]
    assert captured["media_suffixes"] == {
        ".wav",
        ".mp3",
        ".flac",
        ".ogg",
        ".m4a",
        ".aac",
    }


def test_generate_speech_uses_wangp_defaults_and_curated_inputs(tmp_path: Path) -> None:
    bridge = _make_bridge()
    manifests: list[list[dict[str, object]]] = []

    class FakeSession:
        @staticmethod
        def get_default_settings(model_type: str) -> dict[str, object]:
            if model_type == "omnivoice":
                return {"audio_prompt_type": "", "model_mode": "auto"}
            return {"audio_prompt_type": "A", "duration_seconds": 25}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        del on_progress, is_cancelled
        manifests.append(manifest)
        assert ".wav" in media_suffixes
        return [str(tmp_path / f"speech-{len(manifests)}.wav")]

    bridge._get_session = lambda: FakeSession()  # type: ignore[method-assign]
    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]

    bridge.generate_speech(
        text="Hello",
        model_type="omnivoice",
        default_settings={"audio_prompt_type": "", "model_mode": "auto"},
        reference_audio_paths=[],
        enhance_prompt=False,
        seed=7,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
    )
    reference = tmp_path / "voice.wav"
    bridge.generate_speech(
        text="Speaker 1: Welcome\nSpeaker 2: Hello",
        model_type="index_tts25",
        default_settings={
            "audio_prompt_type": "A",
            "model_mode": "EN",
            "custom_settings": {"speech_speed": 1.0, "text_normalization": "Yes"},
        },
        reference_audio_paths=[str(reference), str(tmp_path / "second.wav")],
        enhance_prompt=True,
        seed=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
    )
    bridge.generate_speech(
        text="Speaker 1: One\nSpeaker 2: Two\nSpeaker 3: Three",
        model_type="index_tts25",
        default_settings={"audio_prompt_type": "A", "model_mode": "EN"},
        reference_audio_paths=[str(reference), str(tmp_path / "second.wav"), str(tmp_path / "third.wav")],
        enhance_prompt=False,
        seed=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
    )

    assert manifests[0][0]["params"] == {
        "audio_prompt_type": "",
        "model_mode": "auto",
        "model_type": "omnivoice",
        "prompt": "Hello",
        "prompt_enhancer": "",
        "duration_seconds": 0,
        "seed": 7,
    }
    assert manifests[1][0]["params"] == {
        "audio_prompt_type": "AB2",
        "duration_seconds": 0,
        "model_type": "index_tts25",
        "model_mode": "EN",
        "custom_settings": {"speech_speed": 1.0, "text_normalization": "Yes"},
        "prompt": "Speaker 1: Welcome\nSpeaker 2: Hello",
        "audio_guide": str(reference.resolve()),
        "audio_guide2": str((tmp_path / "second.wav").resolve()),
        "prompt_enhancer": "T",
    }
    assert manifests[2][0]["params"] == {
        "audio_prompt_type": "ABD2",
        "duration_seconds": 0,
        "model_type": "index_tts25",
        "model_mode": "EN",
        "prompt": "Speaker 1: One\nSpeaker 2: Two\nSpeaker 3: Three",
        "audio_guide": str(reference.resolve()),
        "audio_guide2": str((tmp_path / "second.wav").resolve()),
        "audio_guide3": str((tmp_path / "third.wav").resolve()),
        "prompt_enhancer": "",
    }


def test_generate_sfx_maps_mmaudio_processor_arguments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}
    progress: list[tuple[str, int]] = []
    output_path = tmp_path / "effect.wav"

    class FakeSession:
        def _ensure_runtime(self) -> SimpleNamespace:
            return SimpleNamespace(root=tmp_path)

    def generate_soundtrack(method: str, **kwargs: object) -> str:
        captured["method"] = method
        captured.update(kwargs)
        Path(str(kwargs["output_path"])).write_bytes(b"wave")
        return str(kwargs["output_path"])

    bridge._get_session = lambda: FakeSession()  # type: ignore[method-assign]
    bridge._load_api_module = lambda: SimpleNamespace(  # type: ignore[method-assign]
        _pushd=lambda _root: nullcontext()
    )
    monkeypatch.setattr(
        "services.wangp_bridge.importlib.import_module",
        lambda name: SimpleNamespace(generate_soundtrack=generate_soundtrack),
    )

    result = bridge.generate_sfx(
        video_path=str(tmp_path / "source.mp4"),
        prompt="Door slam",
        negative_prompt="music",
        seed=7,
        duration_seconds=3,
        output_path=output_path,
        on_progress=lambda phase, amount, *_detail: progress.append((phase, amount)),
    )

    assert result == str(output_path.resolve())
    assert captured == {
        "method": "mmaudio",
        "video_path": str((tmp_path / "source.mp4").resolve()),
        "prompt": "Door slam",
        "negative_prompt": "music",
        "seed": 7,
        "duration": 3,
        "output_path": str(output_path.resolve()),
    }
    assert progress == [("generating_sfx", 0), ("generating_sfx", 100)]


def test_runtime_preferences_update_app_owned_wangp_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root_config = tmp_path / "wgp_config.json"
    root_config.write_text(json.dumps({"existing": "root"}), encoding="utf-8")
    config_path = tmp_path / "config" / "wgp_config.json"
    monkeypatch.setenv("AIVS_WANGP_CONFIG_TEMPLATE", str(root_config))
    bridge = WanGPBridge(
        enabled=True,
        root=tmp_path,
        python_executable=None,
        config_dir=tmp_path / "config",
        output_dir=tmp_path / "outputs",
        video_model_type="ltx2_25_22B_distilled",
        image_model_type="z_image",
        camera_motion_prompts={},
        extra_args=(),
    )

    bridge.set_runtime_preferences(
        attention_mode="sage2",
        performance_profile=4.5,
        reduce_vram="2",
    )

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert root_config.read_text(encoding="utf-8") == json.dumps({"existing": "root"})
    assert saved["existing"] == "root"
    assert saved["attention_mode"] == "sage2"
    assert saved["profile"] == 4.5
    assert saved["video_profile"] == 4.5
    assert saved["image_profile"] == 4.5
    assert saved["audio_profile"] == 4.5
    assert saved["vae_config"] == 2
    assert saved["boost"] == 2

    bridge.set_runtime_preferences(
        attention_mode="auto",
        performance_profile=4,
        reduce_vram="disabled",
    )

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["profile"] == 4
    assert saved["video_profile"] == 4
    assert saved["image_profile"] == 4
    assert saved["audio_profile"] == 3.5
    assert saved["vae_config"] == 0
    assert saved["boost"] == 1


def test_local_enhancer_config_preserves_existing_engine_profiles(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._config_dir = tmp_path / "config"
    config_path = bridge._resolve_session_config_path()
    config_path.parent.mkdir()
    config_path.write_text(
        json.dumps({"llm_engines": {"deepy": "remote", "profiles": {"custom": {"key": "kept"}}}}),
        encoding="utf-8",
    )

    bridge._ensure_local_enhancer_config()

    engines = json.loads(config_path.read_text(encoding="utf-8"))["llm_engines"]
    assert engines["deepy"] == "qwen35_4b"
    assert engines["profiles"] == {"custom": {"key": "kept"}}


def test_wait_for_job_uses_structured_errors_when_stream_has_none() -> None:
    bridge = _make_bridge()
    error = SimpleNamespace(stage="inference", message="native failure")
    job = SimpleNamespace(
        cancel=lambda: None,
        events=SimpleNamespace(get=lambda **_kwargs: None),
        done=True,
        result=lambda: SimpleNamespace(success=False, errors=[error], generated_files=[]),
    )

    with pytest.raises(RuntimeError, match="inference: native failure"):
        bridge._wait_for_job(
            job=job, media_suffixes={".png"}, on_progress=lambda *_args: None, is_cancelled=lambda: False,
        )


def test_custom_loras_directory_updates_wangp_config(tmp_path: Path) -> None:
    loras_dir = tmp_path / "existing-wangp" / "loras"
    WanGPBridge(
        enabled=True,
        root=tmp_path,
        python_executable=None,
        config_dir=tmp_path / "config",
        output_dir=tmp_path / "outputs",
        video_model_type="ltx2_25_22B_distilled",
        image_model_type="z_image",
        camera_motion_prompts={},
        loras_dir=loras_dir,
    )

    saved = json.loads((tmp_path / "config" / "wgp_config.json").read_text(encoding="utf-8"))
    assert saved["loras_root"] == str(loras_dir.resolve())


def test_z_image_uses_eight_step_floor() -> None:
    bridge = _make_bridge(image_model_type="z_image")

    assert bridge._normalize_image_steps(4) == 8
    assert bridge._normalize_image_steps(8) == 8
    assert bridge._normalize_image_steps(12) == 12


def test_custom_finetune_request_is_rejected_without_session_mutation(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._output_dir = tmp_path / "outputs"
    bridge._config_dir = tmp_path / "config"
    with pytest.raises(RuntimeError, match="CUSTOM_FINETUNE_UNSUPPORTED"):
        bridge._run_manifest(
            manifest=[
                {
                    "id": 1,
                    "params": {
                        "model_type": "z_image",
                        CUSTOM_FINETUNE_CHECKPOINT_KEY: str(tmp_path / "checkpoint.safetensors"),
                    },
                }
            ],
            media_suffixes={".png"},
            on_progress=lambda *_args: None,
            is_cancelled=lambda: False,
        )


def test_removed_aivs_model_type_is_rejected_before_session_start() -> None:
    bridge = _make_bridge()

    with pytest.raises(RuntimeError, match="UNSUPPORTED_WANGP_MODEL_TYPE"):
        bridge._run_manifest(
            manifest=[{"id": 1, "params": {"model_type": "aivs_ltx2_25_22B"}}],
            media_suffixes={".png"},
            on_progress=lambda *_args: None,
            is_cancelled=lambda: False,
        )


def test_ltx2_video_uses_full_video_length_as_sliding_window_size() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]

    output = bridge.generate_video(
        prompt="A person walking in the rain",
        resolution_label="1080p",
        aspect_ratio="16:9",
        duration_seconds=6,
        fps=24,
        steps=8,
        seed=123,
        camera_motion="none",
        negative_prompt="",
        image_path=None,
        audio_path=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
    )

    assert output == "E:/tmp/out.mp4"
    assert captured["settings"]["video_length"] == 145
    assert captured["settings"]["sliding_window_size"] == 481


@pytest.mark.parametrize("model_type", ["ltx2_25_22B_distilled", "minimax_h3_ref2va_pruned", "wan2_2_t2v"])
def test_video_manifest_does_not_send_fork_preview_options(model_type: str) -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["manifest"] = manifest
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    bridge.generate_video(
        prompt="test", resolution_label="720p", aspect_ratio="16:9", duration_seconds=5,
        fps=24, steps=20, seed=None, camera_motion="none", negative_prompt="",
        image_path=None, audio_path=None, model_type=model_type,
        on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert captured["manifest"][0]["plugin_data"] == {}


def test_video_manifest_keeps_preview_options_out_of_the_manifest() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}
    bridge.set_preview_options(mode="rgb")

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["manifest"] = manifest
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    bridge.generate_video(
        prompt="test", resolution_label="720p", aspect_ratio="16:9", duration_seconds=5,
        fps=24, steps=20, seed=None, camera_motion="none", negative_prompt="",
        image_path=None, audio_path=None, model_type="ltx2_25_22B_distilled",
        on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert captured["manifest"][0]["plugin_data"] == {}


@pytest.mark.parametrize("mode", ["rgb", "tiny_vae_video"])
def test_image_manifest_keeps_preview_options_out_of_the_manifest(mode: str) -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}
    bridge.set_preview_options(mode=mode)

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["manifest"] = manifest
        return ["E:/tmp/out.png"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    bridge.generate_images(
        prompt="test", width=512, height=512, num_steps=4, num_images=1, seed=None,
        on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert captured["manifest"][0]["plugin_data"] == {}


@pytest.mark.parametrize(
    ("mode", "expected"),
    [("tiny_vae_frames", "tiny_vae_frames"), ("tiny_vae_video", "tiny_vae_video"), ("rgb", "rgb")],
)
def test_run_manifest_applies_changed_preview_mode_on_first_load(
    tmp_path: Path, mode: str, expected: str,
) -> None:
    bridge = _make_bridge()
    bridge._output_dir = tmp_path / "outputs"
    bridge._config_dir = tmp_path / "config"
    bridge.set_preview_options(mode=mode)
    server_config: dict[str, object] = {}
    closes: list[None] = []
    session = SimpleNamespace(
        _state={"gen": {}},
        _ensure_runtime=lambda: SimpleNamespace(module=SimpleNamespace(server_config=server_config)),
        submit_manifest=lambda _manifest: object(),
        close=lambda: closes.append(None),
    )
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    bridge._wait_for_job = lambda **_kwargs: ["E:/tmp/out.png"]  # type: ignore[method-assign]

    bridge._run_manifest(
        manifest=[{"id": 1, "params": {"model_type": "z_image"}, "plugin_data": {}}],
        media_suffixes={".png"}, on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert server_config["generation_preview"] == expected
    assert closes == [None]


def test_run_manifest_moves_output_preferences_to_runtime_config(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._output_dir = tmp_path / "outputs"
    bridge._config_dir = tmp_path / "config"
    server_config: dict[str, object] = {}
    submitted: list[list[dict[str, object]]] = []
    session = SimpleNamespace(
        _state={"gen": {}},
        _ensure_runtime=lambda: SimpleNamespace(module=SimpleNamespace(server_config=server_config)),
        submit_manifest=lambda manifest: submitted.append(manifest) or object(),
        close=lambda: None,
    )
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    bridge._wait_for_job = lambda **_kwargs: ["E:/tmp/out.png"]  # type: ignore[method-assign]

    bridge._run_manifest(
        manifest=[{"id": 1, "params": {"model_type": "flux2_klein_4b", "image_output_codec": "png", "metadata_type": "metadata"}, "plugin_data": {}}],
        media_suffixes={".png"}, on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert server_config["image_output_codec"] == "png"
    assert server_config["metadata_type"] == "metadata"
    assert server_config["generation_preview"] == "tiny_vae_video"
    assert submitted[0][0]["params"] == {"model_type": "flux2_klein_4b"}


def test_run_manifest_closes_cached_session_before_preview_mode_change(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._output_dir = tmp_path / "outputs"
    bridge._config_dir = tmp_path / "config"
    bridge._submitted_manifest_once = True
    bridge.set_preview_options(mode="tiny_vae_frames")
    server_config: dict[str, object] = {"generation_preview": "rgb"}
    closes: list[None] = []
    session = SimpleNamespace(
        _state={"gen": {}},
        _ensure_runtime=lambda: SimpleNamespace(module=SimpleNamespace(server_config=server_config)),
        submit_manifest=lambda _manifest: object(),
        close=lambda: closes.append(None),
    )
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    bridge._wait_for_job = lambda **_kwargs: ["E:/tmp/out.png"]  # type: ignore[method-assign]

    bridge._run_manifest(
        manifest=[{"id": 1, "params": {"model_type": "z_image"}, "plugin_data": {}}],
        media_suffixes={".png"}, on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert closes == [None]
    assert server_config["generation_preview"] == "tiny_vae_frames"


def test_run_manifest_keeps_cached_session_for_the_same_preview_mode(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._output_dir = tmp_path / "outputs"
    bridge._config_dir = tmp_path / "config"
    bridge._submitted_manifest_once = True
    server_config: dict[str, object] = {"generation_preview": "tiny_vae_video"}
    closes: list[None] = []
    session = SimpleNamespace(
        _state={"gen": {}},
        _ensure_runtime=lambda: SimpleNamespace(module=SimpleNamespace(server_config=server_config)),
        submit_manifest=lambda _manifest: object(),
        close=lambda: closes.append(None),
    )
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    bridge._wait_for_job = lambda **_kwargs: ["E:/tmp/out.png"]  # type: ignore[method-assign]

    bridge._run_manifest(
        manifest=[{"id": 1, "params": {"model_type": "z_image"}, "plugin_data": {}}],
        media_suffixes={".png"}, on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    assert closes == []


def test_preview_event_writes_native_mp4_video(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._output_dir = tmp_path
    captured: list[tuple[object, ...]] = []

    bridge._handle_event(
        SimpleNamespace(
            kind="preview",
            data=SimpleNamespace(
                phase="inference", status="Preview", progress=50,
                current_step=10, total_steps=20, image=None,
                video=b"preview-mp4",
            ),
        ),
        lambda *args: captured.append(args),
        deque(),
        {"phase": "", "progress": -1, "logged_at": 0.0},
    )

    assert (tmp_path / "_wangp_preview_latest.mp4").read_bytes() == b"preview-mp4"
    assert ".mp4?v=" in captured[-1][9]


def test_preview_event_does_not_replace_a_throttled_native_video(tmp_path: Path) -> None:
    class LegacyPreview:
        def save(self, path: Path, **_kwargs: object) -> None:
            path.write_bytes(b"jpeg-preview")

    bridge = _make_bridge()
    bridge._output_dir = tmp_path
    bridge._last_preview_write_at = time.monotonic()
    captured: list[tuple[object, ...]] = []

    bridge._handle_event(
        SimpleNamespace(
            kind="preview",
            data=SimpleNamespace(
                phase="inference", status="Preview", progress=50,
                current_step=10, total_steps=20, image=LegacyPreview(), video=b"preview-mp4",
            ),
        ),
        lambda *args: captured.append(args),
        deque(),
        {"phase": "", "progress": -1, "logged_at": 0.0},
    )

    assert not (tmp_path / "_wangp_preview_latest.jpg").exists()
    assert captured[-1][9] is None


def test_preview_event_falls_back_to_pil_image_without_native_video(tmp_path: Path) -> None:
    class LegacyPreview:
        def save(self, path: Path, **_kwargs: object) -> None:
            path.write_bytes(b"jpeg-preview")

    bridge = _make_bridge()
    bridge._output_dir = tmp_path
    captured: list[tuple[object, ...]] = []

    bridge._handle_event(
        SimpleNamespace(
            kind="preview",
            data=SimpleNamespace(
                phase="inference", status="Preview", progress=50,
                current_step=10, total_steps=20, image=LegacyPreview(),
                video=None,
            ),
        ),
        lambda *args: captured.append(args),
        deque(),
        {"phase": "", "progress": -1, "logged_at": 0.0},
    )

    assert (tmp_path / "_wangp_preview_latest.jpg").read_bytes() == b"jpeg-preview"
    assert captured[-1][9].startswith("file://")


def test_h3_video_maps_list_valued_references_to_wangp_manifest() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    bridge.generate_video(
        prompt="Use <Picture 1>, <Video 1>, and <Audio 1>",
        resolution_label="720p", aspect_ratio="16:9", duration_seconds=5,
        fps=24, steps=20, seed=None, camera_motion="none", negative_prompt="",
        image_path=None, audio_path=None, model_type="minimax_h3_ref2va_pruned",
        video_prompt_type="V+*-U", audio_prompt_type="ABD",
        reference_image_paths=["E:/tmp/ref.png"],
        reference_video_paths=["E:/tmp/ref.mp4", "E:/tmp/ref2.mp4", "E:/tmp/ref3.mp4"],
        reference_audio_paths=["E:/tmp/ref.wav", "E:/tmp/ref2.wav", "E:/tmp/ref3.wav"],
        h3_video_excerpt_positions=["3s/2s"],
        h3_audio_excerpt_positions=["4s/3s"],
        on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    settings = captured["settings"]
    assert settings["video_length"] == 124
    assert settings["image_refs"] == [str(Path("E:/tmp/ref.png").resolve())]
    assert settings["video_guide"] == str(Path("E:/tmp/ref.mp4").resolve())
    assert settings["video_guide3"] == str(Path("E:/tmp/ref3.mp4").resolve())
    assert settings["audio_guide"] == str(Path("E:/tmp/ref.wav").resolve())
    assert settings["audio_guide3"] == str(Path("E:/tmp/ref3.wav").resolve())
    assert settings["custom_settings"] == {
        "h3_video_excerpt_positions": "3s/2s",
        "h3_audio_excerpt_positions": "4s/3s",
    }


def test_h3_depth_video_reuses_its_path_for_soundtrack() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    bridge.generate_video(
        prompt="depth scene",
        resolution_label="720p", aspect_ratio="16:9", duration_seconds=5,
        fps=24, steps=20, seed=None, camera_motion="none", negative_prompt="",
        image_path=None, audio_path=None, model_type="minimax_h3_ref2va_pruned",
        video_prompt_type="DV", audio_prompt_type="K",
        reference_video_paths=["E:/tmp/depth.mp4"],
        reference_audio_paths=["E:/tmp/depth.mp4"],
        on_progress=lambda *_args: None, is_cancelled=lambda: False,
    )

    settings = captured["settings"]
    assert settings["video_prompt_type"] == "DV"
    assert settings["audio_prompt_type"] == "K"
    assert settings["audio_guide"] == str(Path("E:/tmp/depth.mp4").resolve())


def test_generate_video_forwards_default_lora_settings() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]

    bridge.generate_video(
        prompt="Shot one\n[0s:4s] Cut to shot two",
        resolution_label="720p",
        aspect_ratio="16:9",
        duration_seconds=8,
        fps=24,
        steps=8,
        seed=123,
        camera_motion="none",
        negative_prompt="",
        image_path=None,
        audio_path=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
        default_settings={
            "activated_loras": ["LTX-2.3_Cinematic_hardcut.safetensors"],
            "loras_multipliers": "1.0",
        },
    )

    assert captured["settings"]["activated_loras"] == ["LTX-2.3_Cinematic_hardcut.safetensors"]
    assert captured["settings"]["loras_multipliers"] == "1.0"


def test_ensure_style_lora_downloads_through_runtime_module(tmp_path: Path) -> None:
    bridge = _make_bridge()
    bridge._root = tmp_path
    calls: list[tuple[str, str, int, dict[str, list[str]]]] = []
    progress_events: list[tuple[tuple[object, ...], int]] = []
    cancellation_requested = threading.Event()
    native_abort_observed = threading.Event()
    worker_thread_id: int | None = None
    caller_thread_id = threading.get_ident()

    class RuntimeModule:
        def download_models(self, filename, model_type, *, file_type, model_def, gen):  # type: ignore[no-untyped-def]
            nonlocal worker_thread_id
            worker_thread_id = threading.get_ident()
            calls.append((filename, model_type, file_type, model_def))
            progress = gen["download_progress_callback"]
            abort = gen["abort_callback"]
            assert callable(progress)
            assert callable(abort)
            progress({"filename": "style.safetensors", "completed": 5, "total": 10})
            deadline = time.monotonic() + 2
            while not abort():
                assert time.monotonic() < deadline
                time.sleep(0.01)
            native_abort_observed.set()

    class Session:
        def _ensure_runtime(self):  # type: ignore[no-untyped-def]
            return type("Runtime", (), {"module": RuntimeModule()})()

    bridge._get_session = lambda: Session()  # type: ignore[method-assign]
    def on_progress(*args: object) -> None:
        progress_events.append((args, threading.get_ident()))
        if args[0] == "downloading_model" and args[8] == "Downloading model":
            cancellation_requested.set()

    with pytest.raises(RuntimeError, match="Generation was cancelled"):
        bridge.ensure_style_lora(
            source_url="https://example.test/style.safetensors",
            model_type="ltx2_25_22B",
            on_progress=on_progress,
            is_cancelled=cancellation_requested.is_set,
        )

    assert progress_events[0][0] == (
            "downloading_model",
            3,
            None,
            None,
            None,
            None,
            None,
            None,
            "Downloading selected style",
        )
    assert progress_events[1][0][0] == "downloading_model"
    assert progress_events[1][0][8] == "Downloading model"
    assert [thread_id for _, thread_id in progress_events] == [caller_thread_id, caller_thread_id]
    assert worker_thread_id is not None and worker_thread_id != caller_thread_id
    assert native_abort_observed.is_set()
    assert calls == [
        ("", "ltx2_25_22B", 1, {"loras": ["https://example.test/style.safetensors"]})
    ]


def test_resolve_profiles_forwards_to_the_shared_resolver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = _make_bridge()
    session = object()
    source = {"num_inference_steps": 8}

    def resolve(session_arg: object, model_type: str, **kwargs: object) -> dict[str, object]:
        assert session_arg is session
        assert model_type == "ltx2_25_22B"
        assert kwargs == {
            "accelerator_profile_id": "ltx2_25_two_stage_distilled_8_3",
            "preset_profile_id": None,
        }
        return source

    monkeypatch.setattr("services.wangp_bridge.resolve_profiles", resolve)
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    settings = bridge.resolve_profiles(
        "ltx2_25_22B",
        accelerator_profile_id="ltx2_25_two_stage_distilled_8_3",
    )

    assert settings is source


def test_resolve_profiles_forwards_default_request_to_the_shared_resolver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = _make_bridge()
    session = object()
    source = {"num_inference_steps": 20}

    def resolve(session_arg: object, model_type: str, **kwargs: object) -> dict[str, object]:
        assert session_arg is session
        assert model_type == "minimax_h3_fl2va_pruned"
        assert kwargs == {"accelerator_profile_id": None, "preset_profile_id": None}
        return source

    monkeypatch.setattr("services.wangp_bridge.resolve_profiles", resolve)
    bridge._get_session = lambda: session  # type: ignore[method-assign]
    settings = bridge.resolve_profiles("minimax_h3_fl2va_pruned")

    assert settings is source


def test_resolve_profiles_propagates_the_shared_resolver_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = _make_bridge()
    session = object()

    def resolve(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("WanGP runtime does not expose native profile composition APIs.")

    monkeypatch.setattr("services.wangp_bridge.resolve_profiles", resolve)
    bridge._get_session = lambda: session  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="does not expose native profile composition APIs"):
        bridge.resolve_profiles(
            "ltx2_25_22B",
            accelerator_profile_id="ltx2_25_two_stage_distilled_8_3",
        )


def test_generate_video_maps_ic_lora_guide_only() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    source_path = "E:/tmp/source_trimmed.mp4"

    bridge.generate_video(
        prompt="Relight this clip",
        resolution_label="540p",
        aspect_ratio="16:9",
        duration_seconds=4,
        fps=24,
        steps=8,
        seed=123,
        camera_motion="none",
        negative_prompt="",
        image_path=None,
        audio_path=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
        start_image_path=None,
        control_video_path=source_path,
        image_prompt_type=None,
        video_prompt_type="VG",
    )

    settings = captured["settings"]
    resolved_source = str(Path(source_path).resolve())
    assert "video_source" not in settings
    assert settings["video_guide"] == resolved_source
    assert "image_prompt_type" not in settings
    assert settings["video_prompt_type"] == "VG"
    assert settings["config"] == ""


def test_generate_video_forwards_outpainting_settings() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]

    bridge.generate_video(
        prompt="outpaint",
        resolution_label="540p",
        aspect_ratio="16:9",
        duration_seconds=5,
        fps=24,
        steps=8,
        seed=123,
        camera_motion="none",
        negative_prompt="",
        image_path=None,
        audio_path=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
        control_video_path="E:/tmp/guide.mp4",
        video_prompt_type="VG",
        video_guide_outpainting="35 70 40 30",
        video_guide_outpainting_ratio="",
        default_settings={
            "force_fps": "auto",
            "sliding_window_overlap": 33,
        },
    )

    settings = captured["settings"]
    assert settings["multi_prompts_gen_type"] == "FG"
    assert settings["force_fps"] == "auto"
    assert settings["sliding_window_overlap"] == 33
    assert settings["video_guide_outpainting"] == "35 70 40 30"
    assert settings["video_guide_outpainting_ratio"] == ""
    assert settings["video_prompt_type"] == "VG"


def test_generate_video_uses_source_frame_count_for_video_length() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["settings"] = manifest[0]["params"]
        return ["E:/tmp/out.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]

    bridge.generate_video(
        prompt="outpaint",
        resolution_label="540p",
        aspect_ratio="16:9",
        duration_seconds=5,
        fps=24,
        steps=8,
        seed=123,
        camera_motion="none",
        negative_prompt="",
        image_path=None,
        audio_path=None,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
        control_video_path="E:/tmp/guide.mp4",
        video_length_frames=150,
        default_settings={
            "force_fps": 60,
            "resolution": "64x64",
            "video_length": 1,
            "duration_seconds": 99,
        },
    )

    assert captured["settings"]["force_fps"] == 24
    assert captured["settings"]["resolution"] == "960x544"
    assert captured["settings"]["video_length"] == 145
    assert captured["settings"]["duration_seconds"] == 5


def test_generate_director_video_submits_exact_backend_settings() -> None:
    bridge = _make_bridge()
    captured: dict[str, object] = {}

    def fake_run_manifest(*, manifest, media_suffixes, on_progress, is_cancelled):  # type: ignore[no-untyped-def]
        captured["manifest"] = manifest
        return ["E:/tmp/director.mp4"]

    bridge._run_manifest = fake_run_manifest  # type: ignore[method-assign]
    settings: dict[str, object] = {
        "model_type": "ltx2_25_22B_distilled",
        "prompt": "[1:61] walk",
        "multi_prompts_gen_type": "FG",
        "video_prompt_type": "KFI",
        "image_refs": ["E:/tmp/one.png", "E:/tmp/two.png"],
        "frames_positions": "1 61",
        "video_length": 121,
    }

    output = bridge.generate_director_video(
        settings=settings,
        on_progress=lambda *_args: None,
        is_cancelled=lambda: False,
    )

    assert output == "E:/tmp/director.mp4"
    assert captured["manifest"] == [
        {
            "id": 1,
            "params": {**settings, "config": ""},
            "plugin_data": {},
        }
    ]


def test_select_final_output_prefers_newest_combined_file(tmp_path: Path) -> None:
    first = tmp_path / "2026-07-09-15h41m19s_seed1783608007_outpaint.mp4"
    combined = tmp_path / "2026-07-09-15h42m23s_seed1783608007_outpaint.mp4"
    final = tmp_path / "2026-07-09-15h43m31s_seed1783608007_outpaint.mp4"
    for index, path in enumerate([first, combined, final], start=1):
        path.write_bytes(f"segment-{index}".encode("utf-8"))
        os.utime(path, (1_700_000_000 + index, 1_700_000_000 + index))

    assert WanGPBridge._select_final_output([str(first), str(combined), str(final)]) == str(final)


def test_bridge_never_writes_root_wgp_config(tmp_path: Path) -> None:
    root = tmp_path / "wangp-root"
    root.mkdir()
    root_config = root / "wgp_config.json"
    root_config.write_text("{}", encoding="utf-8")

    bridge = WanGPBridge(
        enabled=True,
        root=root,
        python_executable=None,
        config_dir=tmp_path / "wangp_bridge",
        output_dir=tmp_path / "wangp_outputs",
        video_model_type="ltx2_25_22B_distilled",
        image_model_type="z_image",
        camera_motion_prompts={},
        extra_args=(),
    )

    bridge.set_runtime_preferences(attention_mode="sage2", performance_profile=4.5, reduce_vram="disabled")

    assert root_config.read_text(encoding="utf-8") == "{}"
    assert json.loads((tmp_path / "wangp_bridge" / "wgp_config.json").read_text(encoding="utf-8"))["attention_mode"] == "sage2"


def test_bridge_falls_back_to_bridge_config_when_root_config_missing(tmp_path: Path) -> None:
    root = tmp_path / "wangp-root"
    root.mkdir()
    config_dir = tmp_path / "wangp_bridge"

    bridge = WanGPBridge(
        enabled=True,
        root=root,
        python_executable=None,
        config_dir=config_dir,
        output_dir=tmp_path / "wangp_outputs",
        video_model_type="ltx2_25_22B_distilled",
        image_model_type="z_image",
        camera_motion_prompts={},
        extra_args=(),
    )

    assert bridge._resolve_session_config_path() == config_dir / "wgp_config.json"


def test_preload_session_ensures_runtime_without_direct_model_load(tmp_path: Path) -> None:
    root = tmp_path / "wangp-root"
    shared = root / "shared"
    output_dir = tmp_path / "outputs"
    shared.mkdir(parents=True)
    (shared / "__init__.py").write_text("", encoding="utf-8")
    root_config = root / "wgp_config.json"
    root_config.write_text(
        json.dumps({"fit_canvas": 2, "enhancer_mode": 1, "existing": "kept"}),
        encoding="utf-8",
    )
    (root / "wgp.py").write_text(
        """
from pathlib import Path

def load_models(*args, **kwargs):
    Path(__file__).with_name("load_models_called").write_text("called", encoding="utf-8")
""",
        encoding="utf-8",
    )
    (shared / "api.py").write_text(
        """
import importlib
from pathlib import Path

class WanGPSession:
    def __init__(self, *, root, config_path, output_dir, cli_args):
        self.output_dir = Path(output_dir)
        importlib.import_module("wgp")

    def ensure_ready(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)
        (self.output_dir / "ensure_ready_called").write_text("called", encoding="utf-8")
""",
        encoding="utf-8",
    )

    saved_path = list(sys.path)
    saved_modules = {name: sys.modules.get(name) for name in ("shared", "shared.api", "wgp")}
    for name in saved_modules:
        sys.modules.pop(name, None)

    try:
        bridge = WanGPBridge(
            enabled=True,
            root=root,
            python_executable=None,
            config_dir=tmp_path / "wangp_bridge",
            output_dir=output_dir,
            video_model_type="ltx2_25_22B_distilled",
            image_model_type="z_image",
            camera_motion_prompts={},
                extra_args=(),
        )

        bridge.preload_session()

        assert (output_dir / "ensure_ready_called").exists()
        assert not (root / "load_models_called").exists()
        assert json.loads(root_config.read_text(encoding="utf-8"))["fit_canvas"] == 2
        saved_config = json.loads((tmp_path / "wangp_bridge" / "wgp_config.json").read_text(encoding="utf-8"))
        assert saved_config["fit_canvas"] == 0
        assert saved_config["enhancer_mode"] == 0
    finally:
        sys.path[:] = saved_path
        for name, module in saved_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
