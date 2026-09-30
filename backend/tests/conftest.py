"""Test infrastructure for backend integration-style endpoint tests."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest

from state.app_settings import AppSettings
from app_factory import create_app
from state import RuntimeConfig, build_initial_state, set_state_service_for_tests
from app_handler import AppHandler, ServiceBundle
from tests.fakes.fake_wangp_bridge import build_fake_wangp_bridge
from tests.fakes.services import FakeServices

CAMERA_MOTION_PROMPTS = {
    "none": "",
    "static": ", static camera, locked off shot, no camera movement",
    "focus_shift": ", focus shift, rack focus, changing focal point",
    "dolly_in": ", dolly in, camera pushing forward, smooth forward movement",
    "dolly_out": ", dolly out, camera pulling back, smooth backward movement",
    "dolly_left": ", dolly left, camera tracking left, lateral movement",
    "dolly_right": ", dolly right, camera tracking right, lateral movement",
    "jib_up": ", jib up, camera rising up, upward crane movement",
    "jib_down": ", jib down, camera lowering down, downward crane movement",
}

DEFAULT_NEGATIVE_PROMPT = (
    "blurry, out of focus, overexposed, underexposed, low contrast, washed out colors, "
    "excessive noise, grainy texture"
)

DEFAULT_APP_SETTINGS = AppSettings()


@pytest.fixture
def fake_services() -> FakeServices:
    return FakeServices()


@pytest.fixture(autouse=True)
def test_state(tmp_path: Path, fake_services: FakeServices):
    """Provide a fresh AppHandler per test and register it in DI."""
    app_data = tmp_path / "app_data"
    outputs_dir = tmp_path / "outputs"

    for directory in (outputs_dir, app_data):
        directory.mkdir(parents=True, exist_ok=True)

    config = RuntimeConfig(
        device="cpu",
        outputs_dir=outputs_dir,
        settings_file=app_data / "settings.json",
        use_sage_attention=False,
        camera_motion_prompts=CAMERA_MOTION_PROMPTS,
        default_negative_prompt=DEFAULT_NEGATIVE_PROMPT,
        wangp_enabled=False,
        wangp_root=None,
        wangp_python=None,
        wangp_config_dir=app_data / "wangp_bridge",
        wangp_video_model_type="ltx2_25_22B_distilled",
        wangp_image_model_type="z_image",
        wangp_extra_args=(),
    )

    bundle = ServiceBundle(
        gpu_info=fake_services.gpu_info,
    )

    handler = build_initial_state(
        config,
        DEFAULT_APP_SETTINGS.model_copy(deep=True),
        service_bundle=bundle,
    )
    fake_wangp_bridge = build_fake_wangp_bridge(output_dir=outputs_dir)
    handler.wangp_bridge = fake_wangp_bridge
    handler.video_generation._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.director_generation._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.image_generation._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.music_generation._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.sfx_generation._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.speech_generation._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.prompt_enhancement._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.health._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    handler.model_profiles._wangp_bridge = fake_wangp_bridge  # type: ignore[attr-defined]
    set_state_service_for_tests(handler)
    yield handler
    handler.generation_queue.shutdown()


@pytest.fixture
def client(test_state):
    from starlette.testclient import TestClient

    app = create_app(handler=test_state)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def wangp_bridge(test_state) -> "FakeWanGPBridge":
    """Expose the fake WanGP bridge wired into the test handler."""
    from tests.fakes.fake_wangp_bridge import FakeWanGPBridge

    bridge = test_state.wangp_bridge
    assert isinstance(bridge, FakeWanGPBridge)
    return bridge


@pytest.fixture
def enable_wangp(test_state, wangp_bridge):
    """Flip the runtime config to WanGP-enabled for the duration of one test.

    Tests that exercise the live generation path (video/image) need this so
    the handlers route through ``wangp_bridge`` instead of raising 503.
    Other tests (health/models/startup) keep the default WanGP-disabled
    config they were written against.
    """
    test_state.config.wangp_enabled = True
    wangp_bridge.enabled = True
    wangp_bridge.available = True
    wangp_bridge.video_calls.clear()
    wangp_bridge.image_calls.clear()
    wangp_bridge.director_calls.clear()
    wangp_bridge.music_calls.clear()
    wangp_bridge.sfx_calls.clear()
    wangp_bridge.speech_calls.clear()
    wangp_bridge.compose_music_lyrics_calls.clear()
    wangp_bridge.raise_on_video = None
    wangp_bridge.raise_on_images = None
    wangp_bridge.raise_on_director = None
    wangp_bridge.raise_on_music = None
    wangp_bridge.raise_on_compose_music_lyrics = None
    test_state.health.default_warmup()
    test_state.generation_queue.set_runtime_ready(wangp_bridge.get_status().session_ready)
    yield wangp_bridge
    test_state.config.wangp_enabled = False


@pytest.fixture
def default_app_settings() -> AppSettings:
    return DEFAULT_APP_SETTINGS.model_copy(deep=True)


@pytest.fixture
def make_test_image():
    def _make(w: int = 64, h: int = 64, color: str = "red"):
        from PIL import Image

        img = Image.new("RGB", (w, h), color)
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf

    return _make
