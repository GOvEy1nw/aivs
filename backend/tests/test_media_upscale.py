from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from services.wangp_bridge import WanGPBridge, WanGPBridgeStatus


@dataclass
class _Bridge:
    output: Path
    call: dict[str, object] | None = None

    def get_status(self) -> WanGPBridgeStatus:
        return WanGPBridgeStatus(available=True, root=None, python_executable=None)

    def upscale_media(self, **kwargs: object) -> str:
        self.call = kwargs
        self.output.write_bytes(b"output")
        return str(self.output)


def _write_png(path: Path) -> Path:
    from PIL import Image

    Image.new("RGB", (1, 1)).save(path)
    return path


def test_catalog_and_upscale_route_validate_and_invoke_bridge(client, test_state, enable_wangp, tmp_path: Path) -> None:
    catalog = client.get("/api/media-upscale/catalog")
    assert catalog.status_code == 200
    methods = {item["id"]: item for item in catalog.json()["methods"]}
    assert set(methods) == {"lanczos", "flashvsr", "flashvsr2pass", "seedvr2", "ltx25"}
    assert methods["ltx25"]["mediaKinds"] == ["video"]
    assert methods["ltx25"]["scales"] == [2.0]
    assert methods["lanczos"]["scales"] == [2.0, 2.5, 3.0, 3.5, 4.0]

    source = _write_png(tmp_path / "source.png")
    bridge = _Bridge(tmp_path / "upscaled.png")
    test_state.media_upscale._wangp_bridge = bridge
    response = client.post("/api/media-upscale", json={
        "sourcePath": str(source), "mediaKind": "image", "method": "flashvsr", "scale": 2,
    })
    assert response.status_code == 200
    assert response.json()["status"] == "complete"
    assert bridge.call is not None
    assert bridge.call["spatial_upsampler"] == "flashvsr2"

    below_minimum = client.post("/api/media-upscale", json={
        "sourcePath": str(source), "mediaKind": "image", "method": "flashvsr", "scale": 1.5,
    })
    assert below_minimum.status_code == 400

    rejected = client.post("/api/media-upscale", json={
        "sourcePath": str(source), "mediaKind": "image", "method": "ltx25", "scale": 2,
    })
    assert rejected.status_code == 400


def test_bridge_seeds_only_missing_flashvsr_and_submits_media_flow(tmp_path: Path) -> None:
    class _Events:
        def get(self, timeout: float):
            return None

    class _Job:
        done = True
        events = _Events()

        def cancel(self) -> None:
            pass

        def result(self):
            return type("Result", (), {"success": True, "errors": [], "generated_files": [str(tmp_path / "output.png")]})()

    class _Session:
        def __init__(self) -> None:
            self._state = {"gen": {}}
            self.call: tuple[object, dict[str, object]] | None = None

        def submit_media_postprocessing(self, source: str, **kwargs: object):
            self.call = (source, kwargs)
            return _Job()

    config_dir = tmp_path / "config"
    bridge = WanGPBridge(
        enabled=False, root=None, python_executable=None, config_dir=config_dir,
        output_dir=tmp_path, video_model_type="video", image_model_type="image", camera_motion_prompts={},
    )
    bridge._ensure_flashvsr_config()  # type: ignore[attr-defined]
    config_path = config_dir / "wgp_config.json"
    assert json.loads(config_path.read_text())["spatial_upsamplers"]["flashvsr"] == {"mode": 1, "backend": "auto", "topk_ratio": 0.0}
    config_path.write_text(json.dumps({"spatial_upsamplers": {"flashvsr": {"mode": 0}}}))
    bridge._ensure_flashvsr_config()  # type: ignore[attr-defined]
    assert json.loads(config_path.read_text())["spatial_upsamplers"]["flashvsr"] == {"mode": 0}

    session = _Session()
    bridge._session = session  # type: ignore[attr-defined]
    bridge.get_status = lambda: WanGPBridgeStatus(available=True, root=tmp_path, python_executable=None)  # type: ignore[method-assign]
    output = bridge.upscale_media(
        source_path=str(tmp_path / "source.png"), spatial_upsampler="flashvsr2pass2",
        media_kind="image", on_progress=lambda *args: None, is_cancelled=lambda: False,
    )
    assert output == str((tmp_path / "output.png").resolve())
    assert session.call == (str((tmp_path / "source.png").resolve()), {"spatial_upsampling": "flashvsr2pass2", "return_media": False})
