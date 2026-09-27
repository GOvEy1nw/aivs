"""Canonical app settings schema and patch models."""

from __future__ import annotations

from typing import Any, Literal, TypeGuard, TypeVar, cast, get_args

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator, model_validator


def _to_camel_case(field_name: str) -> str:
    special_aliases = {
        "prompt_enhancer_enabled_t2v": "promptEnhancerEnabledT2V",
        "prompt_enhancer_enabled_i2v": "promptEnhancerEnabledI2V",
    }
    if field_name in special_aliases:
        return special_aliases[field_name]

    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    if value is None:
        return default

    parsed = int(value)
    return max(minimum, min(maximum, parsed))


class SettingsBaseModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )


class SettingsPatchModel(SettingsBaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        validate_assignment=True,
        extra="forbid",
    )


class FastModelSettings(SettingsBaseModel):
    use_upscaler: bool = True


class ProModelSettings(SettingsBaseModel):
    steps: int = 20
    use_upscaler: bool = True

    @field_validator("steps", mode="before")
    @classmethod
    def _clamp_steps(cls, value: Any) -> int:
        return _clamp_int(value, minimum=1, maximum=100, default=20)


class OutputSettings(SettingsBaseModel):
    video_container: Literal["mp4", "mov", "mkv"] = "mp4"
    video_codec: Literal[
        "libx264_8",
        "libx264_10",
        "libx264_lossless",
        "libx265_28",
        "libx265_8",
        "prores_422",
    ] = "libx264_8"
    image_codec: Literal["jpeg", "webp", "png", "webp_lossless"] = "jpeg"
    image_quality: int = 95
    audio_codec: Literal["aac_128", "aac_192", "aac_256", "aac_320"] = "aac_192"
    metadata_mode: Literal["metadata", "json"] = "metadata"
    keep_intermediate_sliding_windows: bool = False

    @field_validator("image_quality", mode="before")
    @classmethod
    def _clamp_image_quality(cls, value: Any) -> int:
        return _clamp_int(value, minimum=95, maximum=100, default=95)

    @model_validator(mode="after")
    def _validate_container_codec(self) -> "OutputSettings":
        if self.video_codec == "prores_422" and self.video_container not in {"mov", "mkv"}:
            raise ValueError("ProRes output requires MOV or MKV container")
        return self


class PreviewSettings(SettingsBaseModel):
    mode: Literal["off", "rgb", "tae", "tiny_vae_frames"] = "tae"
    update_rate: Literal["adaptive", "every_step", "every_2", "every_4"] = "adaptive"
    device: Literal["auto", "cuda", "cpu"] = "auto"
    max_edge: int = 512
    preview_fps: Literal[2, 4, 8, 16] = 16
    webp_quality: int = 72

    @field_validator("max_edge", mode="before")
    @classmethod
    def _clamp_max_edge(cls, value: Any) -> int:
        return _clamp_int(value, minimum=128, maximum=1024, default=512)

    @field_validator("webp_quality", mode="before")
    @classmethod
    def _clamp_webp_quality(cls, value: Any) -> int:
        return _clamp_int(value, minimum=1, maximum=100, default=72)


class AppSettings(SettingsBaseModel):
    ui_theme: Literal["dark", "light"] = "dark"
    use_torch_compile: bool = False
    attention_mode: Literal["auto", "sdpa", "flash", "xformers", "sage", "sage2", "sage3"] = "auto"
    performance_profile: float = 4.0
    reduce_vram: Literal["disabled", "1", "2", "3"] = "disabled"
    load_on_startup: bool = False
    use_local_text_encoder: bool = False
    fast_model: FastModelSettings = Field(default_factory=FastModelSettings)
    pro_model: ProModelSettings = Field(default_factory=ProModelSettings)
    prompt_cache_size: int = 100
    prompt_enhancer_enabled_t2v: bool = True
    prompt_enhancer_enabled_i2v: bool = False
    seed_locked: bool = False
    locked_seed: int = 42
    output_settings: OutputSettings = Field(default_factory=OutputSettings)
    preview_settings: PreviewSettings = Field(default_factory=PreviewSettings)
    quick_gen_favourite_workflows: list[str] = Field(default_factory=list)
    custom_finetunes: dict[str, str] = Field(default_factory=dict)

    @field_validator("prompt_cache_size", mode="before")
    @classmethod
    def _clamp_prompt_cache_size(cls, value: Any) -> int:
        return _clamp_int(value, minimum=0, maximum=1000, default=100)

    @field_validator("performance_profile", mode="before")
    @classmethod
    def _validate_performance_profile(cls, value: Any) -> float:
        parsed = float(value)
        if parsed not in {1.0, 2.0, 3.0, 4.0, 4.5, 5.0}:
            raise ValueError("Performance profile must be 1, 2, 3, 4, 4.5, or 5")
        return parsed

    @field_validator("locked_seed", mode="before")
    @classmethod
    def _clamp_locked_seed(cls, value: Any) -> int:
        return _clamp_int(value, minimum=0, maximum=2_147_483_647, default=42)

    @field_validator("quick_gen_favourite_workflows", mode="before")
    @classmethod
    def _limit_favourite_workflows(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in cast(list[object], value) if isinstance(item, str) and item.strip()][:32]


SettingsModelT = TypeVar("SettingsModelT", bound=SettingsBaseModel)
_PARTIAL_MODEL_CACHE: dict[type[SettingsBaseModel], type[SettingsPatchModel]] = {}


def _wrap_optional(annotation: Any) -> Any:
    if type(None) in get_args(annotation):
        return annotation
    return annotation | None


def _to_partial_annotation(annotation: Any) -> Any:
    if _is_settings_model_annotation(annotation):
        return make_partial_model(annotation)
    return annotation


def make_partial_model(model: type[SettingsModelT]) -> type[SettingsPatchModel]:
    cached = _PARTIAL_MODEL_CACHE.get(model)
    if cached is not None:
        return cached

    fields: dict[str, tuple[Any, Any]] = {}
    for field_name, field_info in model.model_fields.items():
        partial_annotation = _wrap_optional(_to_partial_annotation(field_info.annotation))
        fields[field_name] = (partial_annotation, Field(default=None))

    partial_model = create_model(
        f"{model.__name__}Patch",
        __base__=SettingsPatchModel,
        **cast(Any, fields),
    )

    _PARTIAL_MODEL_CACHE[model] = partial_model
    return partial_model


def _is_settings_model_annotation(annotation: object) -> TypeGuard[type[SettingsBaseModel]]:
    return isinstance(annotation, type) and issubclass(annotation, SettingsBaseModel)


AppSettingsPatch = make_partial_model(AppSettings)
UpdateSettingsRequest = AppSettingsPatch


class SettingsResponse(SettingsBaseModel):
    ui_theme: Literal["dark", "light"] = "dark"
    use_torch_compile: bool = False
    attention_mode: Literal["auto", "sdpa", "flash", "xformers", "sage", "sage2", "sage3"] = "auto"
    performance_profile: float = 4.0
    reduce_vram: Literal["disabled", "1", "2", "3"] = "disabled"
    load_on_startup: bool = False
    use_local_text_encoder: bool = False
    fast_model: FastModelSettings = Field(default_factory=FastModelSettings)
    pro_model: ProModelSettings = Field(default_factory=ProModelSettings)
    prompt_cache_size: int = 100
    prompt_enhancer_enabled_t2v: bool = True
    prompt_enhancer_enabled_i2v: bool = False
    seed_locked: bool = False
    locked_seed: int = 42
    output_settings: OutputSettings = Field(default_factory=OutputSettings)
    preview_settings: PreviewSettings = Field(default_factory=PreviewSettings)
    quick_gen_favourite_workflows: list[str] = Field(default_factory=list)
    custom_finetunes: dict[str, str] = Field(default_factory=dict)


def to_settings_response(settings: AppSettings) -> SettingsResponse:
    return SettingsResponse.model_validate(settings.model_dump(by_alias=False))

