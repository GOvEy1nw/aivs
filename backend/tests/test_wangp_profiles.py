"""Focused compatibility contracts for AiVS's native WanGP profile adapter."""

from __future__ import annotations

from copy import deepcopy

import pytest

import services.wangp_profiles as wangp_profiles
from services.wangp_profiles import ProfileBinding, resolve_profiles


def test_resolve_profiles_preserves_layer_order_and_native_lora_merging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        wangp_profiles,
        "PROFILE_BINDINGS",
        {
            "accelerator": ProfileBinding(
                "accelerator", selector_by_model_type={"model": "accelerator_profile:accelerator"}
            ),
            "preset": ProfileBinding(
                "preset", selector_by_model_type={"model": "preset:preset"}
            ),
        },
    )
    merge_calls: list[tuple[list[str], str, list[str], str, str]] = []
    fixes: list[dict[str, object]] = []

    class Module:
        def are_model_types_compatible(self, source: str, target: str) -> bool:
            return source == target

        def merge_loras_settings(
            self, old: list[str], old_mult: str, new: list[str], new_mult: str, mode: str
        ) -> tuple[list[str], str]:
            merge_calls.append((old, old_mult, new, new_mult, mode))
            return [*old, *new], f"{old_mult}|{new_mult}"

        def fix_settings(self, _model_type: str, settings: dict[str, object], min_settings_version: float = 0) -> None:
            assert min_settings_version == 2.38
            fixes.append(deepcopy(settings))

    class Session:
        def get_default_settings(self, model_type: str) -> dict[str, object]:
            assert model_type == "model"
            return {"activated_loras": ["base"], "loras_multipliers": "0.1|0.2"}

        def get_model_settings(self, _model_type: str, setting_id: str | None = None) -> dict[str, object]:
            return {
                "content": (
                    {"activated_loras": ["accelerator"], "profile_id": "discard"}
                    if setting_id == "accelerator_profile:accelerator"
                    else {"activated_loras": ["preset"], "loras_multipliers": "0.7", "help": "discard"}
                )
            }

        def _ensure_runtime(self) -> object:
            return type("Runtime", (), {"module": Module()})()

    resolved = resolve_profiles(Session(), "model", accelerator_profile_id="accelerator", preset_profile_id="preset")

    assert [call[-1] for call in merge_calls] == ["merge before", "merge after"]
    assert merge_calls[0][3] == ""
    assert resolved["activated_loras"] == ["base", "accelerator", "preset"]
    assert resolved["loras_multipliers"] == "0.1|0.2||0.7"
    assert all("profile_id" not in settings and "help" not in settings for settings in fixes)


@pytest.mark.parametrize(
    ("model_type", "profile_id", "message"),
    [
        ("other", "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1", "not supported"),
        ("model", "../arbitrary.json", "Unknown accelerator_profile_id"),
    ],
)
def test_resolve_profiles_rejects_invalid_or_wrong_model_bindings(
    model_type: str, profile_id: str, message: str
) -> None:
    class Session:
        def get_default_settings(self, _model_type: str) -> dict[str, object]:
            return {}

        def _ensure_runtime(self) -> object:
            module = type(
                "Module",
                (),
                {
                    "are_model_types_compatible": lambda *_args: True,
                    "merge_loras_settings": lambda *_args: ([], ""),
                    "fix_settings": lambda *_args, **_kwargs: None,
                },
            )()
            return type("Runtime", (), {"module": module})()

    with pytest.raises(ValueError, match=message):
        resolve_profiles(Session(), model_type, accelerator_profile_id=profile_id)


def test_resolve_profiles_returns_isolated_defaults_without_runtime_profile_methods() -> None:
    source = {"nested": {"value": 1}}

    class Session:
        def get_default_settings(self, model_type: str) -> dict[str, object]:
            assert model_type == "plain"
            return source

        def _ensure_runtime(self) -> object:
            raise AssertionError("plain defaults do not need profile composition")

    resolved = resolve_profiles(Session(), "plain")
    nested = resolved["nested"]
    assert isinstance(nested, dict)
    nested["value"] = 2
    assert source == {"nested": {"value": 1}}
