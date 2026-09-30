"""Focused speech profile and request contracts."""

import wave
from dataclasses import replace
from pathlib import Path

import pytest

from api_types import GenerateSpeechRequest
from handlers import speech_generation_handler
from model_profiles import get_music_profile


def request(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"modelProfileId": "omnivoice", "text": "Hello from AiVS", "seed": 42}
    payload.update(overrides)
    return payload


def test_speech_profiles_are_curated_and_expose_reference_requirements(client) -> None:
    profiles = {item["id"]: item for item in client.get("/api/model-profiles").json()["profiles"]}
    assert set(profiles).issuperset({"omnivoice", "index_tts2"})
    assert profiles["omnivoice"]["speech"]["requiredPackIds"] == ["omnivoice"]
    assert profiles["omnivoice"]["speech"]["referenceRequired"] is False
    assert profiles["omnivoice"]["speech"]["maxReferenceInputs"] == 3
    assert profiles["index_tts2"]["speech"]["referenceRequired"] is True
    assert profiles["index_tts2"]["speech"]["maxReferenceInputs"] == 3
    assert profiles["index_tts2"]["license"]["commercialUse"] == "restricted"
    assert profiles["index_tts2"]["displayName"] == "Index TTS 2.5"


def test_omnivoice_text_only_and_index_reference_validation(client, enable_wangp, tmp_path: Path) -> None:
    response = client.post("/api/generate-speech", json=request())
    assert response.status_code == 200
    assert response.json()["status"] == "complete"
    call = enable_wangp.speech_calls[-1]
    assert call.model_type == "omnivoice"
    assert call.reference_audio_paths == []

    missing_reference = client.post("/api/generate-speech", json=request(modelProfileId="index_tts2"))
    assert missing_reference.status_code == 400
    assert missing_reference.json()["error"].startswith("SPEECH_REFERENCE_REQUIRED")

    reference = tmp_path / "voice.wav"
    with wave.open(str(reference), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\x00\x00" * 800)
    response = client.post("/api/generate-speech", json=request(modelProfileId="index_tts2", referenceAudioPath=str(reference)))
    assert response.status_code == 200
    call = enable_wangp.speech_calls[-1]
    assert call.model_type == "index_tts25"
    assert call.reference_audio_paths == [str(reference.resolve())]
    assert call.default_settings == {
        "audio_prompt_type": "A",
        "model_mode": "EN",
        "custom_settings": {"speech_speed": 1.0, "text_normalization": "Yes"},
    }


def test_curated_preset_profile_reaches_speech_generation(
    test_state, enable_wangp, monkeypatch
) -> None:
    profile = get_music_profile("omnivoice")
    assert profile is not None
    patched_profile = replace(profile, wangp_preset_profile_id="test_speech_preset")
    monkeypatch.setattr(
        speech_generation_handler,
        "get_music_profile",
        lambda profile_id: patched_profile if profile_id == patched_profile.id else None,
    )

    response = test_state.speech_generation.generate(
        GenerateSpeechRequest.model_validate(request())
    )

    assert response.status == "complete"
    assert enable_wangp.resolved_profile_calls == [
        (patched_profile.wangp_model_type, None, "test_speech_preset")
    ]
    assert (
        enable_wangp.speech_calls[0].default_settings["resolved_preset_profile_id"]
        == "test_speech_preset"
    )


def test_speech_dialogue_requires_all_speakers_and_preserves_references(client, enable_wangp, tmp_path: Path) -> None:
    references = []
    for name in ("one.wav", "two.wav"):
        reference = tmp_path / name
        with wave.open(str(reference), "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8_000); output.writeframes(b"\x00\x00" * 800)
        references.append({"path": str(reference)})
    invalid = client.post("/api/generate-speech", json=request(references=references, text="Speaker 1: Hello"))
    assert invalid.status_code == 400
    response = client.post("/api/generate-speech", json=request(references=references, text="Speaker 1: Hello\nSpeaker 2: Hi", enhancePrompt=True))
    assert response.status_code == 200
    call = enable_wangp.speech_calls[-1]
    assert call.reference_audio_paths == [str(tmp_path / "one.wav"), str(tmp_path / "two.wav")]
    assert call.enhance_prompt is True

    third = tmp_path / "three.wav"
    with wave.open(str(third), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(8_000); output.writeframes(b"\x00\x00" * 800)
    three_reference_response = client.post(
        "/api/generate-speech",
        json=request(
            references=[*references, {"path": str(third)}],
            text="Speaker 1: Hello\nSpeaker 2: Hi\nSpeaker 3: Welcome",
        ),
    )
    assert three_reference_response.status_code == 200
    assert enable_wangp.speech_calls[-1].reference_audio_paths == [
        str(tmp_path / "one.wav"), str(tmp_path / "two.wav"), str(third),
    ]


def test_speech_reference_trim_is_materialized_and_cleaned_up(
    client,
    enable_wangp,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reference = tmp_path / "voice.wav"
    with wave.open(str(reference), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\x00\x00" * 800)

    trimmed = tmp_path / "trimmed.wav"

    def fake_extract_audio_clip(
        source: Path,
        *,
        start_time: float,
        duration: float,
        output_dir: Path,
    ) -> Path:
        assert source == reference.resolve()
        assert start_time == 0.02
        assert duration == 0.05
        assert output_dir.exists()
        trimmed.write_bytes(b"trimmed")
        return trimmed

    monkeypatch.setattr(
        "handlers.speech_generation_handler.extract_audio_clip",
        fake_extract_audio_clip,
    )

    response = client.post(
        "/api/generate-speech",
        json=request(
            references=[
                {
                    "path": str(reference),
                    "trimStartTime": 0.02,
                    "trimDuration": 0.05,
                    "mediaDuration": 0.1,
                }
            ],
        ),
    )

    assert response.status_code == 200
    assert enable_wangp.speech_calls[-1].reference_audio_paths == [str(trimmed)]
    assert not trimmed.exists()
