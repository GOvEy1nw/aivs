"""Curated MMAudio SFX endpoint integration tests."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from services.video_clip import create_black_video_clip, extract_video_clip


def _request(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "modelProfileId": "mmaudio_sfx",
        "prompt": "A heavy wooden door slams in a stone hall",
        "negativePrompt": "music, speech",
        "durationSeconds": 1,
        "seed": 42,
    }
    payload.update(overrides)
    return payload


def test_mmaudio_is_exposed_as_the_dedicated_sfx_profile(client) -> None:
    response = client.get("/api/model-profiles")

    assert response.status_code == 200
    profile = next(
        item for item in response.json()["profiles"] if item["id"] == "mmaudio_sfx"
    )
    assert profile["music"]["enabled"] is False
    assert profile["sfx"] == {
        "status": "experimental",
        "handler": "sfx_generation",
        "requiredPackIds": ["mmaudio"],
        "text": True,
        "controlVideoAudio": True,
        "maxDurationSeconds": 20,
    }
    assert profile["license"]["projectLicense"] == "MIT"
    assert profile["license"]["weightsLicense"] == (
        "Not declared by the DeepBeepMeep/Wan2.1 repository"
    )
    assert profile["license"]["commercialUse"] == "unknown"


def test_text_only_sfx_uses_temporary_conditioning_video(
    client, enable_wangp
) -> None:
    response = client.post("/api/generate-sfx", json=_request())

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "complete"
    assert payload["resolvedSeed"] == 42
    assert Path(payload["audio_path"]).is_file()
    call = enable_wangp.sfx_calls[0]
    assert call.prompt == "A heavy wooden door slams in a stone hall"
    assert call.negative_prompt == "music, speech"
    assert call.duration_seconds == 1
    assert not Path(call.video_path).exists()


def test_video_conditioned_sfx_trims_without_deleting_source(
    client, enable_wangp, tmp_path: Path
) -> None:
    source = create_black_video_clip(duration=2, output_dir=tmp_path)

    response = client.post(
        "/api/generate-sfx",
        json=_request(
            video={
                "path": str(source),
                "trimStartTime": 0.5,
                "trimDuration": 1,
            }
        ),
    )

    assert response.status_code == 200
    call = enable_wangp.sfx_calls[0]
    assert source.is_file()
    assert Path(call.video_path) != source.resolve()
    assert not Path(call.video_path).exists()


def test_video_conditioned_sfx_honours_start_without_explicit_trim_duration(
    client, enable_wangp, tmp_path: Path
) -> None:
    source = create_black_video_clip(duration=3, output_dir=tmp_path)

    response = client.post(
        "/api/generate-sfx",
        json=_request(video={"path": str(source), "trimStartTime": 1}),
    )

    assert response.status_code == 200
    call = enable_wangp.sfx_calls[0]
    assert source.is_file()
    assert Path(call.video_path) != source.resolve()
    assert not Path(call.video_path).exists()


def test_cancellation_during_conditioning_skips_inference_and_cleans_derivative(
    client, enable_wangp, test_state, monkeypatch
) -> None:
    created: list[Path] = []

    def create_then_cancel(*, duration: float, output_dir: Path) -> Path:
        path = create_black_video_clip(duration=duration, output_dir=output_dir)
        created.append(path)
        test_state.generation.cancel_generation()
        return path

    monkeypatch.setattr(
        "handlers.sfx_generation_handler.create_black_video_clip",
        create_then_cancel,
    )

    response = client.post("/api/generate-sfx", json=_request())

    assert response.status_code == 409
    assert "GENERATION_CANCELLED" in response.json()["error"]
    assert enable_wangp.sfx_calls == []
    assert created and not created[0].exists()


def test_cancellation_removes_generated_audio_and_conditioning_video(
    client, enable_wangp, test_state, monkeypatch
) -> None:
    original_generate_sfx = enable_wangp.generate_sfx

    def generate_then_cancel(**kwargs: Any) -> str:
        output_path = original_generate_sfx(**kwargs)
        test_state.generation.cancel_generation()
        return output_path

    monkeypatch.setattr(enable_wangp, "generate_sfx", generate_then_cancel)

    response = client.post("/api/generate-sfx", json=_request())

    assert response.status_code == 409
    assert "GENERATION_CANCELLED" in response.json()["error"]
    assert list(test_state.config.outputs_dir.glob("mmaudio_sfx_*.wav")) == []
    assert not Path(enable_wangp.sfx_calls[0].video_path).exists()


def test_music_profile_is_rejected_for_sfx(client, enable_wangp) -> None:
    response = client.post(
        "/api/generate-sfx",
        json=_request(modelProfileId="ace_step_15_turbo"),
    )

    assert response.status_code == 400
    assert response.json()["error"].startswith("SFX_MODE_UNSUPPORTED")
    assert enable_wangp.sfx_calls == []


def test_failed_video_trim_removes_partial_derivative(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    def fail_after_partial_write(cmd: list[str], **_kwargs: object) -> SimpleNamespace:
        Path(cmd[-1]).write_bytes(b"partial")
        return SimpleNamespace(returncode=1, stderr="failed")

    monkeypatch.setattr("services.video_clip.imageio_ffmpeg.get_ffmpeg_exe", lambda: "ffmpeg")
    monkeypatch.setattr("services.video_clip.subprocess.run", fail_after_partial_write)

    with pytest.raises(RuntimeError, match="ffmpeg clip extract failed"):
        extract_video_clip(
            source,
            start_time=0,
            duration=1,
            output_dir=tmp_path,
        )

    assert list(tmp_path.glob("reframe_clip_*.mp4")) == []


def test_failed_black_conditioning_removes_partial_derivative(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_after_partial_write(cmd: list[str], **_kwargs: object) -> SimpleNamespace:
        Path(cmd[-1]).write_bytes(b"partial")
        return SimpleNamespace(returncode=1, stderr="failed")

    monkeypatch.setattr("services.video_clip.imageio_ffmpeg.get_ffmpeg_exe", lambda: "ffmpeg")
    monkeypatch.setattr("services.video_clip.subprocess.run", fail_after_partial_write)

    with pytest.raises(RuntimeError, match="ffmpeg black video failed"):
        create_black_video_clip(duration=1, output_dir=tmp_path)

    assert list(tmp_path.glob("mmaudio_black_*.mp4")) == []
