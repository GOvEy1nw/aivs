from __future__ import annotations

from api_types import GenerateDirectorRequest
from model_profiles import get_video_profile
from services.director_compiler import compile_director_request


def _payload() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "modelProfileId": "ltx2_25_fast",
        "resolutionTier": "540p",
        "aspectRatio": "16:9",
        "fps": 24,
        "requestedDurationSeconds": 5,
        "durationFrames": 121,
        "generateAudio": True,
        "globalPrompt": "cinematic scene",
        "promptSegments": [
            {"id": "one", "startFrame": 0, "endFrameExclusive": 120, "prompt": "walk"}
        ],
    }


def test_director_generation_uses_shared_state_and_bridge(client, enable_wangp) -> None:
    response = client.post("/api/director/generate", json=_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["resolvedFrameCount"] == 121
    assert body["compiledPrompt"] == "cinematic scene\n[1:120] walk"
    settings = enable_wangp.director_calls[0].settings
    assert settings["model_type"] == "ltx2_25_22B_distilled"
    assert settings["multi_prompts_gen_type"] == "FG"
    assert settings["video_length"] == 121
    assert settings["custom_settings"] == {"prompt_relay_epsilon": 0.001}
    assert "sample_solver" not in settings
    assert "activated_loras" not in settings
    assert enable_wangp.resolved_profile_calls == [
        ("ltx2_25_22B_distilled", None, None)
    ]


def test_director_settings_exclude_continue_video_prefix(test_state) -> None:
    payload = _payload()
    payload.update(
        requestedDurationSeconds=12,
        durationFrames=289,
        promptSegments=[
            {"id": "one", "startFrame": 48, "endFrameExclusive": 168, "prompt": "first"},
            {"id": "two", "startFrame": 168, "endFrameExclusive": 288, "prompt": "second"},
        ],
        continueVideo={
            "path": "source.mp4",
            "timelineDurationFrames": 49,
            "trimDuration": 2,
        },
    )
    profile = get_video_profile("ltx2_25_fast")
    assert profile is not None
    plan = compile_director_request(
        GenerateDirectorRequest.model_validate(payload), profile.director
    )

    settings = test_state.director_generation._build_settings(
        plan,
        profile.wangp_model_type,
        "1280x720",
        24,
        1,
        profile.wangp_default_settings,
        0.99,
    )

    assert plan.output_frame_count == 289
    assert settings["video_length"] == 241
    assert settings["duration_seconds"] == 10
    assert settings["prompt"].endswith("[1:120] first\n[121:240] second")


def test_director_passes_custom_prompt_relay_epsilon(client, enable_wangp) -> None:
    payload = _payload()
    payload["promptRelayEpsilon"] = 0.25
    response = client.post("/api/director/generate", json=payload)
    assert response.status_code == 200
    assert enable_wangp.director_calls[0].settings["custom_settings"] == {
        "prompt_relay_epsilon": 0.25
    }


def test_director_omits_relay_epsilon_without_prompt_relay(client, enable_wangp) -> None:
    payload = _payload()
    payload["promptSegments"] = [
        {"id": "one", "startFrame": 0, "endFrameExclusive": 120, "prompt": ""}
    ]
    response = client.post("/api/director/generate", json=payload)
    assert response.status_code == 200
    settings = enable_wangp.director_calls[0].settings
    assert settings["prompt"] == "cinematic scene"
    assert "custom_settings" not in settings


def test_director_rejects_invalid_prompt_relay_epsilon(client, enable_wangp) -> None:
    payload = _payload()
    payload["promptRelayEpsilon"] = 1.0
    response = client.post("/api/director/generate", json=payload)
    assert response.status_code == 422
    assert enable_wangp.director_calls == []


def test_director_uses_locked_seed(client, enable_wangp, test_state) -> None:
    test_state.state.app_settings.seed_locked = True
    test_state.state.app_settings.locked_seed = 123
    response = client.post("/api/director/generate", json=_payload())
    assert response.status_code == 200
    assert response.json()["seed"] == 123
    assert enable_wangp.director_calls[0].settings["seed"] == 123


def test_director_delegates_unlocked_seed_to_wangp(client, enable_wangp) -> None:
    response = client.post("/api/director/generate", json=_payload())
    assert response.status_code == 200
    assert response.json()["seed"] is None
    assert "seed" not in enable_wangp.director_calls[0].settings


def test_director_rejects_unknown_profile(client, enable_wangp) -> None:
    payload = _payload()
    payload["modelProfileId"] = "missing"
    response = client.post("/api/director/generate", json=payload)
    assert response.status_code == 400
    assert response.json()["error"] == "DIRECTOR_PROFILE_NOT_SUPPORTED"


def test_director_rejects_unavailable_model(client, enable_wangp) -> None:
    enable_wangp.available = False
    response = client.post("/api/director/generate", json=_payload())
    assert response.status_code == 503
    assert response.json()["error"] == "DIRECTOR_MODEL_UNAVAILABLE"


def test_director_rejects_uncurated_resolution(client, enable_wangp) -> None:
    payload = _payload()
    payload["resolutionTier"] = "2160p"
    response = client.post("/api/director/generate", json=payload)
    assert response.status_code == 400
    assert response.json()["error"].startswith("DIRECTOR_WANGP_MAPPING_UNAVAILABLE:")


def test_director_reports_missing_keyframe_asset(client, enable_wangp, tmp_path) -> None:
    payload = _payload()
    segments = payload["promptSegments"]
    assert isinstance(segments, list)
    segments[0]["keyframe"] = {
        "path": str(tmp_path / "missing.png"),
        "point": "start",
    }

    response = client.post("/api/director/generate", json=payload)

    assert response.status_code == 400
    assert response.json()["error"].startswith("DIRECTOR_MISSING_ASSET:")


def test_director_reports_invalid_keyframe_media(client, enable_wangp, tmp_path) -> None:
    invalid = tmp_path / "invalid.png"
    invalid.write_bytes(b"not-an-image")
    payload = _payload()
    segments = payload["promptSegments"]
    assert isinstance(segments, list)
    segments[0]["keyframe"] = {"path": str(invalid), "point": "start"}

    response = client.post("/api/director/generate", json=payload)

    assert response.status_code == 400
    assert response.json()["error"].startswith("DIRECTOR_MEDIA_TYPE_MISMATCH:")


def test_director_reports_missing_continue_video(client, enable_wangp, tmp_path) -> None:
    payload = _payload()
    payload["continueVideo"] = {
        "path": str(tmp_path / "missing.mp4"),
        "timelineDurationFrames": 33,
        "trimDuration": 1,
    }
    payload["promptSegments"] = [
        {"id": "one", "startFrame": 32, "endFrameExclusive": 120, "prompt": "walk"}
    ]

    response = client.post("/api/director/generate", json=payload)

    assert response.status_code == 400
    assert response.json()["error"].startswith("DIRECTOR_MISSING_ASSET:")


def test_director_reports_missing_guide_audio(client, enable_wangp, tmp_path) -> None:
    payload = _payload()
    payload["guideAudio"] = {
        "path": str(tmp_path / "missing.wav"),
        "trimDuration": 5,
    }

    response = client.post("/api/director/generate", json=payload)

    assert response.status_code == 400
    assert response.json()["error"].startswith("DIRECTOR_MISSING_ASSET:")


def test_director_bridge_error_propagates(client, enable_wangp) -> None:
    enable_wangp.raise_on_director = RuntimeError("director bridge failed")
    response = client.post("/api/director/generate", json=_payload())
    assert response.status_code == 500
    assert "director bridge failed" in response.json()["error"]
