"""Prompt enhancement endpoint tests."""

from __future__ import annotations

from pathlib import Path


def test_enhance_prompt_uses_text_only_mode(client, wangp_bridge):
    response = client.post(
        "/api/enhance-prompt",
        json={
            "prompt": "a quiet city street",
            "mode": "video",
            "modelProfileId": "ltx2_25_fast",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"prompt": "enhanced: a quiet city street"}
    call = wangp_bridge.enhance_prompt_calls[-1]
    assert call.prompt == "a quiet city street"
    assert call.mode == "video"
    assert call.model_type == "ltx2_25_22B_distilled"
    assert call.image_path is None


def test_enhance_prompt_passes_input_image(client, wangp_bridge, tmp_path: Path):
    image_path = tmp_path / "start.png"
    end_image_path = tmp_path / "end.png"
    control_image_path = tmp_path / "control.png"
    reference_image_paths = [tmp_path / "reference-1.png", tmp_path / "reference-2.png"]
    image_path.write_bytes(b"fake-image")
    end_image_path.write_bytes(b"fake-image")
    control_image_path.write_bytes(b"fake-image")
    for reference_path in reference_image_paths:
        reference_path.write_bytes(b"fake-image")

    response = client.post(
        "/api/enhance-prompt",
        json={
            "prompt": "a portrait with soft light",
            "mode": "image",
            "modelProfileId": "z_image_turbo",
            "inputImagePath": str(image_path),
            "endImagePath": str(end_image_path),
            "controlImagePath": str(control_image_path),
            "referenceImagePaths": [str(path) for path in reference_image_paths],
            "durationSeconds": 4.5,
        },
    )

    assert response.status_code == 200
    call = wangp_bridge.enhance_prompt_calls[-1]
    assert call.prompt == "a portrait with soft light"
    assert call.mode == "image"
    assert call.model_type == "z_image"
    assert call.image_path == str(image_path)
    assert call.end_image_path == str(end_image_path)
    assert call.control_image_path == str(control_image_path)
    assert call.reference_image_paths == [str(path) for path in reference_image_paths]
    assert call.duration_seconds == 4.5


def test_enhance_h3_uses_the_effective_reference_route(client, wangp_bridge, tmp_path: Path):
    from PIL import Image

    reference_image = tmp_path / "reference.png"
    Image.new("RGB", (16, 16), color="blue").save(reference_image)

    for payload in (
        {"referenceImagePaths": [str(reference_image)]},
        {"inputRoles": ["reference_video"]},
        {"inputRoles": ["reference_audio"]},
        {"inputRoles": ["depth"]},
    ):
        response = client.post(
            "/api/enhance-prompt",
            json={
                "prompt": "a cinematic scene",
                "mode": "video",
                "modelProfileId": "minimax_h3_quality",
                **payload,
            },
        )

        assert response.status_code == 200
        assert wangp_bridge.enhance_prompt_calls[-1].model_type == "minimax_h3_ref2va_pruned"

    rejected = client.post(
        "/api/enhance-prompt",
        json={
            "prompt": "a cinematic scene",
            "mode": "video",
            "modelProfileId": "minimax_h3_quality",
            "inputRoles": ["reference_voice"],
        },
    )

    assert rejected.status_code == 400
    assert rejected.json()["error"] == "Role reference_voice is not supported by this model profile"

    mixed = client.post(
        "/api/enhance-prompt",
        json={
            "prompt": "a cinematic scene",
            "mode": "video",
            "modelProfileId": "minimax_h3_quality",
            "inputRoles": ["reference_image", "control_video"],
        },
    )

    assert mixed.status_code == 400
    assert mixed.json()["error"] == "H3_REF2VA_FL2VA_MEDIA_MIX"

    unsupported_start_and_video = client.post(
        "/api/enhance-prompt",
        json={
            "prompt": "a cinematic scene",
            "mode": "video",
            "modelProfileId": "minimax_h3_quality",
            "inputImagePath": str(reference_image),
            "inputRoles": ["reference_video"],
        },
    )

    assert unsupported_start_and_video.status_code == 400
    assert unsupported_start_and_video.json()["error"].startswith(
        "H3_START_IMAGE_REFERENCE_VIDEO_UNSUPPORTED"
    )
