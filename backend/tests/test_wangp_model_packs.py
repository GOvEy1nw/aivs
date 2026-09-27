"""Focused checks for WanGP model-pack dependency downloads."""

from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
from typing import Any, cast

import pytest

from wangp_model_packs import (
    PACKS,
    _delete_pack_files,
    _download_model_dependencies,
    _download_pack,
    _load_state,
    _pack_model_def,
    _pack_progress_callback,
    _process_download_definitions,
    _resolve_pack_profile_settings,
)


def test_music_packs_use_verified_wangp_model_types() -> None:
    assert PACKS["ace_step_15_turbo"]["model_type"] == "ace_step_v1_5_turbo_lm_1_7b"
    assert (
        PACKS["ace_step_15_xl_turbo"]["model_type"]
        == "ace_step_v1_5_xl_turbo_lm_1_7b"
    )
    assert PACKS["minimax_music3"] == {
        "name": "MiniMax Music 3",
        "kind": "model",
        "model_type": "minimax_music3",
    }


def test_minimax_h3_fast_and_quality_packs_share_model_types() -> None:
    assert PACKS["minimax-h3-fast"]["model_types"] == [
        "minimax_h3_fl2va_pruned",
        "minimax_h3_ref2va_pruned",
    ]
    assert PACKS["minimax-h3-quality"]["model_types"] == PACKS["minimax-h3-fast"]["model_types"]
    assert PACKS["minimax-h3-fast"]["accelerator_profile_ids"] == {
        "minimax_h3_fl2va_pruned": "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1",
        "minimax_h3_ref2va_pruned": "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1",
    }


def test_ltx_packs_use_curated_checkpoints_and_quality_profile() -> None:
    assert PACKS["ltx2_fast"] == {
        "name": "LTX 2.5 Fast",
        "kind": "model",
        "model_type": "ltx2_25_22B_distilled",
    }
    assert PACKS["ltx2_quality"] == {
        "name": "LTX 2.5 Quality",
        "kind": "model",
        "model_type": "ltx2_25_22B",
        "accelerator_profile_id": "ltx2_25_two_stage_hq_res2s_15_3",
    }


def test_curated_video_packs_resolve_profiles_or_model_defaults() -> None:
    source = {"config": "upstream", "nested": {"value": 1}}
    calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []

    class Module:
        def are_model_types_compatible(self, _source: str, _target: str) -> bool:
            return True

        def merge_loras_settings(
            self,
            _old_loras: list[str],
            _old_multipliers: str,
            loras: list[str],
            multipliers: str,
            _mode: str,
        ) -> tuple[list[str], str]:
            return loras, multipliers

        def fix_settings(self, _model_type: str, _settings: dict[str, object], **_kwargs: object) -> None:
            return None

    class Session:
        def get_default_settings(self, model_type: str) -> dict[str, object]:
            calls.append(("defaults", (model_type,), {}))
            return source

        def get_model_settings(self, model_type: str, setting_id: str | None = None) -> dict[str, object]:
            calls.append(("profile", (model_type, setting_id), {}))
            return {"content": {"profile": setting_id}}

        def _ensure_runtime(self) -> object:
            return SimpleNamespace(module=Module())

    session = Session()
    h3_settings = _resolve_pack_profile_settings(
        session,
        "minimax-h3-quality",
        PACKS["minimax-h3-quality"],
        "minimax_h3_fl2va_pruned",
    )
    cast(dict[str, int], h3_settings["nested"])["value"] = 2
    ltx_settings = _resolve_pack_profile_settings(
        session,
        "ltx2_fast",
        PACKS["ltx2_fast"],
        "ltx2_25_22B_distilled",
    )
    h3_fast_settings = _resolve_pack_profile_settings(
        session,
        "minimax-h3-fast",
        PACKS["minimax-h3-fast"],
        "minimax_h3_ref2va_pruned",
    )

    assert h3_settings["config"] == "upstream"
    assert source == {"config": "upstream", "nested": {"value": 1}}
    assert ltx_settings == {"config": "upstream", "nested": {"value": 1}}
    assert h3_fast_settings["profile"] == (
        "accelerator_profile:minimax_h3_ref2va/Turbo Lightx2v Ref2V 4 Steps v0.1.json"
    )
    assert h3_fast_settings["model_type"] == "minimax_h3_ref2va_pruned"
    assert h3_fast_settings["activated_loras"] == []
    assert h3_fast_settings["loras_multipliers"] == ""
    assert calls == [
        ("defaults", ("minimax_h3_fl2va_pruned",), {}),
        ("defaults", ("ltx2_25_22B_distilled",), {}),
        ("defaults", ("minimax_h3_ref2va_pruned",), {}),
        ("profile", ("minimax_h3_ref2va_pruned", "accelerator_profile:minimax_h3_ref2va/Turbo Lightx2v Ref2V 4 Steps v0.1.json"), {}),
    ]
    assert _resolve_pack_profile_settings(
        session,
        "z_image_turbo",
        PACKS["z_image_turbo"],
        "z_image",
    ) == {}


def test_mmaudio_pack_uses_registered_audio_processor() -> None:
    assert PACKS["mmaudio"] == {
        "name": "MMAudio Sound Effects",
        "kind": "audio_processor",
        "processor": "mmaudio",
    }


def test_ideogram4_packs_use_requested_wangp_model_profiles() -> None:
    assert PACKS["ideogram4_int8"]["model_type"] == "ideogram4"
    assert (
        PACKS["ideogram4_turbotime_int8"]["model_type"]
        == "ideogram4_turbotime"
    )


def test_requested_image_packs_use_exact_wangp_model_profiles() -> None:
    expected_model_types = {
        "flux2_klein_9b": "flux2_klein_9b",
        "qwen_image_2512_20B": "qwen_image_2512_20B",
        "qwen_image_edit_plus2_20B": "qwen_image_edit_plus2_20B",
        "krea2_turbo_edit": "krea2_turbo_edit",
    }

    for pack_id, model_type in expected_model_types.items():
        assert PACKS[pack_id]["model_type"] == model_type


class FakeWanGP:
    transformer_quantization = "int8"
    transformer_dtype_policy = "auto"
    text_encoder_quantization = "int8"

    def __init__(self) -> None:
        self.downloads: list[tuple[str, str, int, int, str | None]] = []
        self.callbacks: list[object] = []

    def get_model_def(self, model_type: str) -> dict[str, Any]:
        assert model_type == "example"
        return {
            "URLs2": ["second"],
            "text_encoder_folder": "text_encoder",
        }

    def get_model_filename(
        self,
        model_type: str,
        quantization: str,
        dtype_policy: str,
        *,
        submodel_no: int = 1,
        URLs: Any = None,
        module_type: Any = None,
        model_def: Any = None,
    ) -> str:
        assert model_type == "example"
        del model_def
        if URLs is not None:
            return f"urls:{URLs}"
        if module_type is not None:
            return f"module:{module_type}"
        return "main:2" if submodel_no == 2 else "main:1"

    def get_model_recursive_prop(
        self,
        model_or_module: str,
        prop: str,
        *,
        sub_prop_name: str | None = None,
        return_list: bool = False,
        model_def: Any = None,
    ) -> Any:
        del sub_prop_name, return_list, model_def
        if prop == "modules" and model_or_module == "example":
            return ["named_module", {"URLs": ["left"], "URLs2": ["right"]}]
        if prop == "modules":
            return model_or_module
        if prop == "text_encoder_URLs":
            return ["text_encoder"]
        raise AssertionError(prop)

    def download_models(
        self,
        filename: str,
        model_type: str,
        file_type: int,
        submodel_no: int = 1,
        force_path: str | None = None,
        gen: dict[str, object] | None = None,
        model_def: Any = None,
    ) -> None:
        del model_def
        self.downloads.append((filename, model_type, file_type, submodel_no, force_path))
        self.callbacks.append(gen)


def test_download_model_dependencies_matches_wangp_generation_preflight() -> None:
    wgp = FakeWanGP()
    context = {"download_progress_callback": lambda _update: None, "abort_callback": lambda: True}

    _download_model_dependencies(wgp, "example", context)

    assert wgp.downloads == [
        ("main:1", "example", 0, 1, None),
        ("main:2", "example", 0, 2, None),
        ("module:named_module", "example", 1, 0, None),
        ("urls:['left']", "example", 1, 1, None),
        ("urls:['right']", "example", 1, 2, None),
        ("urls:['text_encoder']", "example", 2, -1, "text_encoder"),
    ]
    assert wgp.callbacks == [context] * len(wgp.downloads)


def test_pack_model_def_applies_profile_settings_before_explicit_pack_overrides(monkeypatch) -> None:
    monkeypatch.setitem(
        sys.modules,
        "shared.config_groups",
        SimpleNamespace(
            selected_model_configs=lambda groups, selection: (
                (index, config_id, groups[index - 1][config_id])
                for index, config_id in enumerate(selection.split(","), 1)
            )
        ),
    )
    class FakeConfiguredWanGP:
        def get_model_def(self, model_type: str) -> dict[str, Any]:
            assert model_type == "example"
            return {"loras": ["base.safetensors"]}

        def get_model_config_groups(
            self, model_type: str, model_def: dict[str, Any]
        ) -> list[dict[str, object]]:
            assert model_type == "example"
            assert model_def["loras"] == ["base.safetensors"]
            return [
                {"gguf_q4_k_m": {"text_encoder": "q4"}},
                {"fp8mix": {"video_vae": "fp8"}},
            ]

        def get_model_recursive_prop(
            self, model_type: str, prop: str, **values: object
        ) -> list[str]:
            assert model_type == "example"
            assert prop == "loras"
            return cast(dict[str, Any], values["model_def"])["loras"]

    model_def = _pack_model_def(
        FakeConfiguredWanGP(),
        {
            "name": "Example Turbo",
            "kind": "model",
            "model_type": "example",
            "loras": ["turbo.safetensors"],
        },
        "example",
        {
            "config": "gguf_q4_k_m,fp8mix",
            "activated_loras": ["distilled.safetensors"],
        },
    )

    assert model_def == {
        "loras": ["base.safetensors", "distilled.safetensors", "turbo.safetensors"],
        "text_encoder": "q4",
        "video_vae": "fp8",
    }


def test_process_download_definitions_forwards_native_context() -> None:
    calls: list[dict[str, object]] = []

    class FakeDefinitionsWanGP:
        def process_files_def(self, **values: object) -> None:
            calls.append(values)

    context = {"download_progress_callback": lambda _update: None, "abort_callback": lambda: False}
    _process_download_definitions(
        FakeDefinitionsWanGP(),
        [{"repoId": "one"}, {"repoId": "two"}],
        context,
    )

    assert calls == [
        {"repoId": "one", "gen": context},
        {"repoId": "two", "gen": context},
    ]


def test_pack_progress_callback_emits_safe_structured_event(capsys) -> None:
    callback = _pack_progress_callback("ltx2_fast", "LTX 2.5 Fast", 2, 3)
    callback({"filename": "model.safetensors", "completed": 50, "total": 100, "speed": 25.0, "file_index": 1, "file_count": 2})

    line = capsys.readouterr().out.strip()
    assert line.startswith("AIVS_PACK:")
    assert '"packIndex": 2' in line
    assert '"packCount": 3' in line
    assert '"filename": "model.safetensors"' in line
    assert '"speedBps": 25.0' in line


def test_download_pack_requires_validated_paths_before_completion(monkeypatch, tmp_path: Path) -> None:
    import wangp_model_packs

    monkeypatch.setitem(
        PACKS,
        "test-pack",
        {"name": "Test", "kind": "model", "model_type": "example"},
    )
    monkeypatch.setattr(wangp_model_packs, "_download_model_dependencies", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(wangp_model_packs, "_effective_pack_model_def", lambda *_args: {})
    monkeypatch.setattr(wangp_model_packs, "_resolve_pack_paths", lambda *_args: {tmp_path / "missing.safetensors"})

    with pytest.raises(RuntimeError, match="incomplete; missing"):
        _download_pack(object(), object(), object(), "test-pack")


def test_legacy_completion_marker_is_not_treated_as_verified(tmp_path: Path) -> None:
    (tmp_path / "model-pack-state.json").write_text(
        '{"completed": ["z_image_turbo"]}',
        encoding="utf-8",
    )

    assert _load_state(tmp_path) == {}


def test_delete_pack_keeps_files_referenced_by_another_pack(tmp_path: Path) -> None:
    shared = tmp_path / "ckpts" / "shared.safetensors"
    first_only = tmp_path / "ckpts" / "first.safetensors"
    second_only = tmp_path / "ckpts" / "second.safetensors"
    shared.parent.mkdir()
    for file_path in (shared, first_only, second_only):
        file_path.write_bytes(b"model")
    manifests = {
        "first": ["ckpts/shared.safetensors", "ckpts/first.safetensors"],
        "second": ["ckpts/shared.safetensors", "ckpts/second.safetensors"],
    }

    _delete_pack_files(tmp_path, manifests, "first")

    assert manifests == {"second": ["ckpts/shared.safetensors", "ckpts/second.safetensors"]}
    assert shared.is_file()
    assert not first_only.exists()
    assert second_only.is_file()

    _delete_pack_files(tmp_path, manifests, "second")

    assert manifests == {}
    assert not shared.exists()
    assert not second_only.exists()


def test_delete_pack_rejects_manifest_path_outside_wangp_root(tmp_path: Path) -> None:
    wangp_root = tmp_path / "wangp"
    wangp_root.mkdir()
    external_file = tmp_path / "keep.txt"
    external_file.write_text("keep", encoding="utf-8")
    manifests = {"pack": [str(external_file)]}

    try:
        _delete_pack_files(wangp_root, manifests, "pack")
    except RuntimeError as exc:
        assert "outside configured model directories" in str(exc)
    else:
        raise AssertionError("Expected deletion outside WanGP root to be rejected")

    assert external_file.read_text(encoding="utf-8") == "keep"
    assert manifests == {"pack": [str(external_file)]}


def test_delete_pack_allows_configured_checkpoints_directory(tmp_path: Path) -> None:
    wangp_root = tmp_path / "wangp"
    checkpoints_dir = tmp_path / "existing-wangp" / "ckpts"
    wangp_root.mkdir()
    checkpoints_dir.mkdir(parents=True)
    model_file = checkpoints_dir / "model.safetensors"
    model_file.write_bytes(b"model")
    manifests = {"pack": [str(model_file)]}

    _delete_pack_files(wangp_root, manifests, "pack", checkpoints_dir)

    assert manifests == {}
    assert not model_file.exists()
