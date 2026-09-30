"""AiVS-owned composition of stable profile IDs over WanGP's native API."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Callable, Literal, Mapping, Protocol, cast


ProfileKind = Literal["accelerator", "preset"]


class _WanGPModule(Protocol):
    def are_model_types_compatible(self, source: str, target: str) -> bool: ...

    def merge_loras_settings(
        self,
        loras_old: list[str],
        mult_old: str,
        loras_new: list[str],
        mult_new: str,
        mode: Literal["merge before", "merge after"],
    ) -> tuple[list[str], str]: ...

    def fix_settings(
        self,
        model_type: str,
        settings: dict[str, object],
        min_settings_version: float = 0,
    ) -> None: ...


class _WanGPSession(Protocol):
    def get_default_settings(self, model_type: str) -> object: ...

    def get_model_settings(
        self, model_type: str, setting_id: str | None = None
    ) -> object: ...


@dataclass(frozen=True)
class ProfileBinding:
    """One persisted AiVS ID and its exact native WanGP counterpart."""

    kind: ProfileKind
    selector_by_model_type: Mapping[str, str] = field(default_factory=dict[str, str])

    def supports(self, model_type: str) -> bool:
        return model_type in self.selector_by_model_type


_LTX_MODEL_TYPES = ("ltx2_25_22B",)
_LTX_DISTILLED_MODEL_TYPES = ("ltx2_25_22B_distilled",)


def _accelerator_binding(path: str, model_types: tuple[str, ...]) -> ProfileBinding:
    return ProfileBinding(
        "accelerator",
        selector_by_model_type={model_type: f"accelerator_profile:{path}" for model_type in model_types},
    )


def _preset_binding(path: str, distilled_path: str) -> ProfileBinding:
    return ProfileBinding(
        "preset",
        selector_by_model_type={
            **{model_type: f"preset:{path}" for model_type in _LTX_MODEL_TYPES},
            **{model_type: f"preset:{distilled_path}" for model_type in _LTX_DISTILLED_MODEL_TYPES},
        },
    )


# Persisted IDs stay AiVS-owned. Native selectors deliberately omit the leading
# ``profiles/`` because WanGP's _get_builtin_lset_groups returns these handles.
PROFILE_BINDINGS: Mapping[str, ProfileBinding] = {
    "ltx2_25_single_stage_distilled_8": _accelerator_binding(
        "ltx2_25_dev_accelerators/Single-Stage Dev DistilledLoRA (8 Steps).json", _LTX_MODEL_TYPES
    ),
    "ltx2_25_single_stage_multimodal_res2s_15": _accelerator_binding(
        "ltx2_25_dev_accelerators/Single-Stage Dev Multimodal Res2S (15 Steps).json", _LTX_MODEL_TYPES
    ),
    "ltx2_25_two_stage_distilled_8_3": _accelerator_binding(
        "ltx2_25_dev_accelerators/Two-Stage Dev DistilledLoRA (8+3 Steps).json", _LTX_MODEL_TYPES
    ),
    "ltx2_25_two_stage_hq_res2s_15_3": _accelerator_binding(
        "ltx2_25_dev_accelerators/Two-Stage Dev HQ Res2S (15+3 Steps).json", _LTX_MODEL_TYPES
    ),
    "ltx2_25_two_stage_modality_guidance_30_3": _accelerator_binding(
        "ltx2_25_dev_accelerators/Two-Stage Modality Guidance (30+3 Steps).json", _LTX_MODEL_TYPES
    ),
    "ltx2_omninft_rl_lora_19b_better_audio_video_sync": _preset_binding(
        "ltx2_presets/OmniNFT RL-LoRA (LTX-2 19B) - Better Audio Video Sync .json",
        "ltx2_distilled_presets/OmniNFT RL-LoRA (LTX-2 19B) Better Audio Video Sync .json",
    ),
    "ltx2_omninft_rl_lora_22b_better_audio_video_sync": _preset_binding(
        "ltx2_presets/OmniNFT RL-LoRA (LTX-2.3 22B) - Better Audio Video Sync.json",
        "ltx2_distilled_presets/OmniNFT RL-LoRA (LTX-2.3 22B) Better Audio Video Sync.json",
    ),
    "ltx2_vbvr_video_reasoning": _preset_binding(
        "ltx2_presets/VBVR LoRA - Video Reasoning.json",
        "ltx2_distilled_presets/VBVR LoRA - Video Reasoning.json",
    ),
    "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1": ProfileBinding(
        "accelerator",
        selector_by_model_type={
            "minimax_h3_fl2va_pruned": "accelerator_profile:minimax_h3_fl2va/Turbo Lightx2v FL2V 4 Steps v0.1.json",
        },
    ),
    "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1": ProfileBinding(
        "accelerator",
        selector_by_model_type={
            "minimax_h3_ref2va_pruned": "accelerator_profile:minimax_h3_ref2va/Turbo Lightx2v Ref2V 4 Steps v0.1.json",
        },
    ),
    "lightningqwen25124steps": ProfileBinding(
        "accelerator",
        selector_by_model_type={
            "qwen_image_2512_20B": "accelerator_profile:qwen/Lightning Qwen 2512 - 4 Steps.json",
        },
    ),
    "lightningqwenedit25114steps": ProfileBinding(
        "accelerator",
        selector_by_model_type={
            "qwen_image_edit_plus2_20B": "accelerator_profile:qwen/Lightning Qwen Edit 2511 - 4 Steps.json",
        },
    ),
    "qwen_image_21_pruna_v0_1_8_steps": ProfileBinding(
        "accelerator",
        selector_by_model_type={
            "qwen_image_21_7B": "accelerator_profile:qwen21/Pruna v0.1 8 Steps.json",
        },
    ),
    "textfusionrefusalreductionkrea2": ProfileBinding(
        "preset",
        selector_by_model_type={
            "krea2_turbo": "preset:krea2_presets/TextFusion Refusal-Reduction Krea2.json",
            "krea2_turbo_edit": "preset:krea2_presets/TextFusion Refusal-Reduction Krea2.json",
        },
    ),
    "unlockkrea2": ProfileBinding(
        "preset",
        selector_by_model_type={
            "krea2_turbo": "preset:krea2_presets/Unlock Krea2.json",
            "krea2_turbo_edit": "preset:krea2_presets/Unlock Krea2.json",
        },
    ),
}


def _runtime_module(session: _WanGPSession) -> _WanGPModule:
    runtime_accessor = getattr(session, "_ensure_runtime", None)
    if not callable(runtime_accessor):
        raise RuntimeError("WanGP runtime does not expose native profile composition APIs.")
    runtime = cast(Callable[[], object], runtime_accessor)()
    module = getattr(runtime, "module", None)
    if (
        not callable(getattr(module, "are_model_types_compatible", None))
        or not callable(getattr(module, "merge_loras_settings", None))
        or not callable(getattr(module, "fix_settings", None))
    ):
        raise RuntimeError("WanGP runtime does not expose native profile composition APIs.")
    return cast(_WanGPModule, module)


def _session_operation(session: _WanGPSession, name: Literal["get_default_settings", "get_model_settings"]) -> Callable[..., object]:
    operation = getattr(session, name, None)
    if not callable(operation):
        raise RuntimeError(f"UNSUPPORTED_WANGP_RUNTIME: missing WanGP session operation '{name}'.")
    return operation


def _profile_content(
    session: _WanGPSession,
    binding: ProfileBinding,
    profile_id: str,
    model_type: str,
) -> dict[str, object]:
    if not binding.supports(model_type):
        raise ValueError(
            f"Profile '{profile_id}' is not supported for model_type '{model_type}'."
        )
    selector = binding.selector_by_model_type[model_type]
    response = _session_operation(session, "get_model_settings")(model_type, selector)
    if not isinstance(response, dict):
        raise RuntimeError(
            f"WanGP get_model_settings returned invalid profile content for '{profile_id}'."
        )
    content = cast(Mapping[str, object], response).get("content")
    if not isinstance(content, dict):
        raise RuntimeError(
            f"WanGP get_model_settings returned invalid profile content for '{profile_id}'."
        )
    return deepcopy(cast(dict[str, object], content))


def _profile_binding(profile_id: str, kind: ProfileKind, model_type: str) -> ProfileBinding:
    binding = PROFILE_BINDINGS.get(profile_id)
    if binding is None or binding.kind != kind:
        label = "accelerator" if kind == "accelerator" else "preset"
        raise ValueError(f"Unknown {label}_profile_id for model_type '{model_type}': {profile_id}")
    return binding


def _loras(value: object, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError(f"WanGP profile {label} must be a list of strings.")
    items = cast(list[object], value)
    if not all(isinstance(item, str) for item in items):
        raise RuntimeError(f"WanGP profile {label} must be a list of strings.")
    return deepcopy(cast(list[str], items))


def _multipliers(value: object) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise RuntimeError("WanGP profile loras_multipliers must be a string.")
    return value


def resolve_profiles(
    session: _WanGPSession,
    model_type: str,
    *,
    accelerator_profile_id: str | None = None,
    preset_profile_id: str | None = None,
) -> dict[str, object]:
    """Resolve AiVS profile IDs using native defaults and settings content."""

    if not model_type.strip():
        raise ValueError("model_type must be a non-empty string")
    if accelerator_profile_id is None and preset_profile_id is None:
        defaults = _session_operation(session, "get_default_settings")(model_type)
        if not isinstance(defaults, dict):
            raise RuntimeError(f"WanGP get_default_settings returned invalid settings for '{model_type}'.")
        return deepcopy(cast(dict[str, object], defaults))

    defaults = _session_operation(session, "get_default_settings")(model_type)
    if not isinstance(defaults, dict):
        raise RuntimeError(f"WanGP get_default_settings returned invalid settings for '{model_type}'.")
    effective = deepcopy(cast(dict[str, object], defaults))
    module = _runtime_module(session)

    for profile_id, kind, merge_mode in (
        (accelerator_profile_id, "accelerator", "merge before"),
        (preset_profile_id, "preset", "merge after"),
    ):
        if profile_id is None:
            continue
        if not profile_id.strip():
            raise ValueError(f"{kind}_profile_id must be a non-empty string")
        profile_id = profile_id.strip()
        binding = _profile_binding(profile_id, cast(ProfileKind, kind), model_type)
        profile = _profile_content(session, binding, profile_id, model_type)
        declared_model_type = profile.get("model_type")
        if declared_model_type is not None:
            if not isinstance(declared_model_type, str) or not declared_model_type:
                raise ValueError(f"Invalid model_type in profile '{profile_id}': {declared_model_type!r}")
            if declared_model_type != model_type and not module.are_model_types_compatible(
                declared_model_type, model_type
            ):
                raise ValueError(
                    f"Profile '{profile_id}' declares incompatible model_type "
                    f"'{declared_model_type}' for requested model_type '{model_type}'"
                )

        old_loras = _loras(effective.get("activated_loras"), "activated_loras")
        old_multipliers = _multipliers(effective.get("loras_multipliers"))
        profile.pop("profile_id", None)
        profile.pop("help", None)
        profile.pop("model_type", None)
        reset_multipliers = "activated_loras" in profile and "loras_multipliers" not in profile
        effective.update(profile)
        if reset_multipliers:
            effective["loras_multipliers"] = ""

        loras = _loras(effective.get("activated_loras"), "activated_loras")
        multipliers = _multipliers(effective.get("loras_multipliers"))
        if old_loras or "|" in multipliers:
            loras, multipliers = module.merge_loras_settings(
                old_loras, old_multipliers, loras, multipliers, cast(Literal["merge before", "merge after"], merge_mode)
            )
        effective["activated_loras"] = loras
        effective["loras_multipliers"] = multipliers
        module.fix_settings(model_type, effective, min_settings_version=2.38)

    effective["model_type"] = model_type
    effective.pop("profile_id", None)
    effective.pop("help", None)
    return deepcopy(effective)
