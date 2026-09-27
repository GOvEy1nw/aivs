from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import uuid

import pytest

PROJECT_ROOT = Path(__file__).parents[2]
VALIDATE_SCRIPT = PROJECT_ROOT / "scripts" / "ensure-wan2gp.ps1"
STAGE_SCRIPT = PROJECT_ROOT / "scripts" / "stage-wan2gp.ps1"
BUILDER_FILE = PROJECT_ROOT / "electron-builder.yml"


def test_wangp_validation_uses_overrides_then_the_local_default() -> None:
    source = VALIDATE_SCRIPT.read_text(encoding="utf-8")

    assert "WANGP_ROOT" in source and "WANGP_WGP_PATH" in source
    assert "C:\\Wan2GP" in source
    assert "Mode" not in source
    assert "git " not in source
    assert "finetune" not in source.lower()


def test_packaging_uses_the_staged_wangp_snapshot() -> None:
    builder = BUILDER_FILE.read_text(encoding="utf-8")

    assert "from: resources/Wan2GP" in builder
    assert "to: Wan2GP" in builder
    assert "wangp_assets/**/*.json" not in builder
    assert "wangp-source.json" not in builder


@pytest.mark.skipif(shutil.which("powershell") is None, reason="requires PowerShell")
def test_stage_wangp_preserves_native_assets_without_finetunes_or_downloaded_weights(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "shared").mkdir(parents=True)
    (source / "models").mkdir()
    (source / "finetunes").mkdir()
    (source / "wgp.py").write_text("", encoding="utf-8")
    (source / "shared" / "api.py").write_text("", encoding="utf-8")
    (source / "requirements.txt").write_text("", encoding="utf-8")
    (source / "models" / "native.bin").write_bytes(b"native asset")
    (source / "models" / "downloaded.safetensors").write_bytes(b"weight")
    (source / "finetunes" / "custom.json").write_text("{}", encoding="utf-8")

    destination = PROJECT_ROOT / "resources" / f"Wan2GP-test-{uuid.uuid4().hex}"
    try:
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(STAGE_SCRIPT),
                "-SourceRoot", str(source), "-DestinationRoot", str(destination),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr or result.stdout
        marker = json.loads((destination / ".aivs-wangp-source.json").read_text(encoding="utf-8"))
        assert marker["schemaVersion"] == 1
        assert len(marker["contentHash"]) == 64
        assert (destination / "models" / "native.bin").read_bytes() == b"native asset"
        assert not (destination / "models" / "downloaded.safetensors").exists()
        assert list((destination / "finetunes").iterdir()) == []
    finally:
        shutil.rmtree(destination, ignore_errors=True)


@pytest.mark.skipif(shutil.which("powershell") is None, reason="requires PowerShell")
def test_stage_wangp_rejects_an_overlapping_source(tmp_path: Path) -> None:
    source = PROJECT_ROOT / "resources" / f"Wan2GP-test-source-{uuid.uuid4().hex}"
    (source / "shared").mkdir(parents=True)
    (source / "wgp.py").write_text("", encoding="utf-8")
    (source / "shared" / "api.py").write_text("", encoding="utf-8")
    (source / "requirements.txt").write_text("", encoding="utf-8")
    try:
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(STAGE_SCRIPT),
                "-SourceRoot", str(source), "-DestinationRoot", str(source),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert (source / "wgp.py").is_file()
    finally:
        shutil.rmtree(source, ignore_errors=True)
