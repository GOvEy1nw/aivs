"""Curated image model profiles."""

from __future__ import annotations

from model_profiles.types import (
    CONTROL_CANNY_ROLE,
    CONTROL_DEPTH_ROLE,
    CONTROL_IMAGE_ROLE,
    CONTROL_POSE_ROLE,
    CURATED_ASPECT_RATIOS,
    InputMediaPolicy,
    ModelProfile,
    REFERENCE_PEOPLE_OBJECTS_ROLE,
    REFERENCE_SUBJECT_ROLE,
    WanGPModelMetadata,
    _image_setting_values,  # pyright: ignore[reportPrivateUsage]
)

def _image_wangp_metadata(
    *,
    family: str,
    family_label: str,
    base_model_type: str,
    inputs: tuple[str, ...],
    setting_values: dict[str, object],
    finetune: bool = False,
    image_to_image: bool = False,
    reference_images: bool = False,
    multiple_references: bool = False,
    background_image: bool = False,
    control_image: bool = False,
    mask: bool = False,
    inpainting: bool = False,
    outpainting: bool = False,
) -> WanGPModelMetadata:
    return WanGPModelMetadata(
        family=family,
        family_label=family_label,
        base_model_type=base_model_type,
        finetune=finetune,
        main_output=("image",),
        outputs=("image",),
        inputs=inputs,
        media_inputs={
            "image": {
                "start": False,
                "end": False,
                "reference": reference_images,
                "single_reference": False,
                "multiple_references": multiple_references,
                "background": background_image,
                "injected_frames": False,
                "control": control_image,
                "mask": mask,
            },
            "video": {
                "continue": False,
                "last": False,
                "control": False,
                "mask": False,
            },
            "audio": {"prompt": False, "output": False},
        },
        capabilities={
            "text_to_video": False,
            "image_to_video": False,
            "video_to_video": False,
            "text_to_image": True,
            "image_to_image": image_to_image,
            "text_to_audio": False,
            "audio_to_audio": False,
            "audio_to_video": False,
            "audio_output": False,
            "inpainting": inpainting,
            "outpainting": outpainting,
            "reference_images": reference_images,
            "background_image": background_image,
            "injected_frames": False,
            "control_image": control_image,
            "control_video": False,
            "video_continuation": False,
            "sliding_window": False,
            "lora": True,
        },
        setting_values=setting_values,
    )


# Curated image model profiles. Add new image models here — the frontend
# reads this list via GET /api/model-profiles and renders the dropdowns
# from it. Do not auto-expose every WanGP-supported model.
IMAGE_PROFILES: tuple[ModelProfile, ...] = (
    ModelProfile(
        id="z_image_turbo",
        display_name="Z-Image Turbo",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="z_image",
        wangp_metadata=WanGPModelMetadata(
            family="z_image",
            family_label="Z-Image",
            base_model_type="z_image",
            finetune=False,
            main_output=("image",),
            outputs=("image",),
            inputs=("text",),
            media_inputs={
                "image": {
                    "start": False,
                    "end": False,
                    "reference": False,
                    "single_reference": False,
                    "multiple_references": False,
                    "background": False,
                    "injected_frames": False,
                    "control": False,
                    "mask": False,
                },
                "video": {
                    "continue": False,
                    "last": False,
                    "control": False,
                    "mask": False,
                },
                "audio": {"prompt": False, "output": False},
            },
            capabilities={
                "text_to_video": False,
                "image_to_video": False,
                "video_to_video": False,
                "text_to_image": True,
                "image_to_image": False,
                "text_to_audio": False,
                "audio_to_audio": False,
                "audio_to_video": False,
                "audio_output": False,
                "inpainting": False,
                "outpainting": False,
                "reference_images": False,
                "background_image": False,
                "injected_frames": False,
                "control_image": False,
                "control_video": False,
                "video_continuation": False,
                "sliding_window": False,
                "lora": True,
            },
            setting_values={
                "image_prompt_type": {
                    "allowed": "",
                    "choices": [{"label": "Text/new generation", "value": ""}],
                },
                "video_prompt_type": {
                    "guide_preprocessing": None,
                    "mask_preprocessing": None,
                    "guide_custom_choices": None,
                    "image_ref_choices": None,
                    "custom_video_selection": None,
                    "forced": "",
                },
                "audio_prompt_type": {"sources": None, "custom_option": None},
                "model_mode": None,
                "sample_solver": None,
                "prompt_enhancer": None,
            },
        ),
        text_to_image=True,
        reference_images=False,
        control_image=True,
        inpainting=False,
        lora="future",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Control",
            max_images=1,
            default_role="control_image",
            roles=(
                CONTROL_IMAGE_ROLE,
                CONTROL_POSE_ROLE,
                CONTROL_DEPTH_ROLE,
                CONTROL_CANNY_ROLE,
            ),
            wangp_model_type="z_image_control2_1",
            wangp_default_settings={
                "num_inference_steps": 9,
                "guidance_scale": 0,
                "control_net_weight_alt": 0.65,
            },
            setting_values={
                "video_prompt_type": {
                    "guide_preprocessing": {
                        "choices": [
                            {"label": "Use Z-Image Raw Format", "value": ""},
                            {"label": "PV", "value": "PV"},
                            {"label": "DV", "value": "DV"},
                            {"label": "EV", "value": "EV"},
                            {"label": "Use Z-Image Raw Format", "value": "V"},
                        ],
                    }
                }
            },
        ),
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p"),
    ),
    ModelProfile(
        id="krea2_turbo",
        display_name="Krea 2 Turbo",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="krea2_turbo",
        wangp_metadata=WanGPModelMetadata(
            family="krea2",
            family_label="Krea 2",
            base_model_type="krea2_turbo",
            finetune=False,
            main_output=("image",),
            outputs=("image",),
            inputs=("text", "image"),
            media_inputs={
                "image": {
                    "start": False,
                    "end": False,
                    "reference": False,
                    "single_reference": False,
                    "multiple_references": False,
                    "background": False,
                    "injected_frames": False,
                    "control": False,
                    "mask": True,
                },
                "video": {
                    "continue": False,
                    "last": False,
                    "control": False,
                    "mask": False,
                },
                "audio": {"prompt": False, "output": False},
            },
            capabilities={
                "text_to_video": False,
                "image_to_video": False,
                "video_to_video": False,
                "text_to_image": True,
                "image_to_image": False,
                "text_to_audio": False,
                "audio_to_audio": False,
                "audio_to_video": False,
                "audio_output": False,
                "inpainting": True,
                "outpainting": False,
                "reference_images": False,
                "background_image": False,
                "injected_frames": False,
                "control_image": False,
                "control_video": False,
                "video_continuation": False,
                "sliding_window": False,
                "lora": True,
            },
            setting_values={
                "image_prompt_type": {
                    "allowed": "",
                    "choices": [{"label": "Text/new generation", "value": ""}],
                },
                "video_prompt_type": {
                    "guide_preprocessing": None,
                    "mask_preprocessing": None,
                    "guide_custom_choices": None,
                    "image_ref_choices": None,
                    "custom_video_selection": None,
                    "forced": "",
                },
                "audio_prompt_type": {"sources": None, "custom_option": None},
                "model_mode": {
                    "default": 2,
                    "label": "Inpainting Method",
                    "choices": [
                        {
                            "label": "LanPaint (2 steps): ~2x slower, easy task",
                            "value": "2",
                        },
                        {
                            "label": "LanPaint (5 steps): ~5x slower, medium task",
                            "value": "3",
                        },
                        {
                            "label": "LanPaint (10 steps): ~10x slower, hard task",
                            "value": "4",
                        },
                        {
                            "label": "LanPaint (15 steps): ~15x slower, very hard task",
                            "value": "5",
                        },
                    ],
                },
                "sample_solver": None,
                "prompt_enhancer": None,
            },
        ),
        wangp_default_settings={
            "image_mode": 1,
            "num_inference_steps": 8,
            "guidance_scale": 0,
        },
        text_to_image=True,
        reference_images=False,
        control_image=False,
        inpainting=False,
        lora="future",
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
        wangp_resolution_categories=("<=2k",),
    ),
    ModelProfile(
        id="flux2_klein_4b",
        display_name="Flux 2 Klein 4B",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="flux2_klein_4b",
        wangp_metadata=WanGPModelMetadata(
            family="flux2",
            family_label="Flux 2",
            base_model_type="flux2_klein_4b",
            finetune=False,
            main_output=("image",),
            outputs=("image",),
            inputs=("text", "image"),
            media_inputs={
                "image": {
                    "start": False,
                    "end": False,
                    "reference": True,
                    "single_reference": False,
                    "multiple_references": True,
                    "background": True,
                    "injected_frames": False,
                    "control": True,
                    "mask": True,
                },
                "video": {
                    "continue": False,
                    "last": False,
                    "control": False,
                    "mask": False,
                },
                "audio": {"prompt": False, "output": False},
            },
            capabilities={
                "text_to_video": False,
                "image_to_video": False,
                "video_to_video": False,
                "text_to_image": True,
                "image_to_image": True,
                "text_to_audio": False,
                "audio_to_audio": False,
                "audio_to_video": False,
                "audio_output": False,
                "inpainting": True,
                "outpainting": True,
                "reference_images": True,
                "background_image": True,
                "injected_frames": False,
                "control_image": True,
                "control_video": False,
                "video_continuation": False,
                "sliding_window": False,
                "lora": True,
            },
            setting_values={
                "image_prompt_type": {
                    "allowed": "",
                    "choices": [{"label": "Text/new generation", "value": ""}],
                },
                "video_prompt_type": {
                    "guide_preprocessing": {
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "PV", "value": "PV"},
                            {"label": "MV", "value": "MV"},
                        ],
                    },
                    "mask_preprocessing": {
                        "visible": True,
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "A", "value": "A"},
                            {"label": "NA", "value": "NA"},
                        ],
                    },
                    "guide_custom_choices": None,
                    "image_ref_choices": {
                        "letters_filter": "KI",
                        "choices": [
                            {"label": "None", "value": ""},
                            {
                                "label": (
                                    "Conditional Image is first Main Subject / "
                                    "Landscape and may be followed by People / "
                                    "Objects"
                                ),
                                "value": "KI",
                            },
                            {
                                "label": "Conditional Images are People / Objects",
                                "value": "I",
                            },
                        ],
                    },
                    "custom_video_selection": None,
                    "forced": "",
                },
                "audio_prompt_type": {"sources": None, "custom_option": None},
                "model_mode": {
                    "default": 0,
                    "label": "Inpainting Method",
                    "choices": [
                        {
                            "label": (
                                "Masked Denoising : Inpainted area may reuse "
                                "some content that has been masked"
                            ),
                            "value": "",
                        },
                        {
                            "label": "LanPaint (2 steps): ~2x slower, easy task",
                            "value": "2",
                        },
                        {
                            "label": "LanPaint (5 steps): ~5x slower, medium task",
                            "value": "3",
                        },
                        {
                            "label": "LanPaint (10 steps): ~10x slower, hard task",
                            "value": "4",
                        },
                        {
                            "label": "LanPaint (15 steps): ~15x slower, very hard task",
                            "value": "5",
                        },
                    ],
                },
                "sample_solver": None,
                "prompt_enhancer": None,
            },
        ),
        text_to_image=True,
        reference_images=True,
        control_image=True,
        inpainting=True,
        outpainting=True,
        lora="future",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Ref/Control",
            max_images=5,
            default_role="reference_subject",
            roles=(
                REFERENCE_SUBJECT_ROLE,
                REFERENCE_PEOPLE_OBJECTS_ROLE,
                CONTROL_POSE_ROLE,
            ),
        ),
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
    ),
    ModelProfile(
        id="flux2_klein_9b",
        display_name="Flux 2 Klein 9B",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="flux2_klein_9b",
        wangp_metadata=_image_wangp_metadata(
            family="flux2",
            family_label="Flux 2",
            base_model_type="flux2_klein_9b",
            inputs=("text", "image"),
            image_to_image=True,
            reference_images=True,
            multiple_references=True,
            background_image=True,
            control_image=True,
            mask=True,
            inpainting=True,
            outpainting=True,
            setting_values=_image_setting_values(
                video_prompt_type={
                    "guide_preprocessing": {
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "PV", "value": "PV"},
                            {"label": "MV", "value": "MV"},
                        ],
                    },
                    "mask_preprocessing": {
                        "visible": True,
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "A", "value": "A"},
                            {"label": "NA", "value": "NA"},
                        ],
                    },
                    "guide_custom_choices": None,
                    "image_ref_choices": {
                        "letters_filter": "KI",
                        "choices": [
                            {"label": "None", "value": ""},
                            {
                                "label": (
                                    "Conditional Image is first Main Subject / "
                                    "Landscape and may be followed by People / "
                                    "Objects"
                                ),
                                "value": "KI",
                            },
                            {
                                "label": "Conditional Images are People / Objects",
                                "value": "I",
                            },
                        ],
                    },
                    "custom_video_selection": None,
                    "forced": "",
                },
                model_mode={
                    "default": 0,
                    "label": "Inpainting Method",
                    "choices": [
                        {
                            "label": (
                                "Masked Denoising : Inpainted area may reuse "
                                "some content that has been masked"
                            ),
                            "value": "",
                        },
                        {
                            "label": "LanPaint (2 steps): ~2x slower, easy task",
                            "value": "2",
                        },
                        {
                            "label": "LanPaint (5 steps): ~5x slower, medium task",
                            "value": "3",
                        },
                        {
                            "label": "LanPaint (10 steps): ~10x slower, hard task",
                            "value": "4",
                        },
                        {
                            "label": "LanPaint (15 steps): ~15x slower, very hard task",
                            "value": "5",
                        },
                    ],
                },
            ),
        ),
        wangp_default_settings={"num_inference_steps": 4},
        text_to_image=True,
        reference_images=True,
        control_image=True,
        inpainting=True,
        outpainting=True,
        lora="future",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Ref/Control",
            max_images=5,
            default_role="reference_subject",
            roles=(
                REFERENCE_SUBJECT_ROLE,
                REFERENCE_PEOPLE_OBJECTS_ROLE,
                CONTROL_POSE_ROLE,
            ),
        ),
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
    ),
    ModelProfile(
        id="qwen_image_2512_20B",
        display_name="Qwen Image",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="qwen_image_2512_20B",
        wangp_metadata=_image_wangp_metadata(
            family="qwen",
            family_label="Qwen",
            base_model_type="qwen_image_20B",
            inputs=("text", "image"),
            mask=True,
            inpainting=True,
            outpainting=True,
            setting_values=_image_setting_values(
                model_mode={
                    "default": 2,
                    "label": "Inpainting Method",
                    "choices": [
                        {
                            "label": "LanPaint (2 steps): ~2x slower, easy task",
                            "value": "2",
                        },
                        {
                            "label": "LanPaint (5 steps): ~5x slower, medium task",
                            "value": "3",
                        },
                        {
                            "label": "LanPaint (10 steps): ~10x slower, hard task",
                            "value": "4",
                        },
                        {
                            "label": "LanPaint (15 steps): ~15x slower, very hard task",
                            "value": "5",
                        },
                    ],
                },
                sample_solver={
                    "choices": [
                        {"label": "Default", "value": "default"},
                        {"label": "Lightning", "value": "lightning"},
                    ],
                },
            ),
        ),
        text_to_image=True,
        inpainting=True,
        lora="future",
        wangp_accelerator_profile_id="lightningqwen25124steps",
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
        wangp_resolution_categories=("<=2k",),
    ),
    ModelProfile(
        id="hidream_o1_dev",
        display_name="HiDream O1",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="hidream_o1_dev",
        wangp_metadata=WanGPModelMetadata(
            family="hidream",
            family_label="HiDream",
            base_model_type="hidream_o1_dev",
            finetune=False,
            main_output=("image",),
            outputs=("image",),
            inputs=("text", "image"),
            media_inputs={
                "image": {
                    "start": False,
                    "end": False,
                    "reference": True,
                    "single_reference": False,
                    "multiple_references": True,
                    "background": True,
                    "injected_frames": False,
                    "control": True,
                    "mask": False,
                },
                "video": {
                    "continue": False,
                    "last": False,
                    "control": False,
                    "mask": False,
                },
                "audio": {"prompt": False, "output": False},
            },
            capabilities={
                "text_to_video": False,
                "image_to_video": False,
                "video_to_video": False,
                "text_to_image": True,
                "image_to_image": True,
                "text_to_audio": False,
                "audio_to_audio": False,
                "audio_to_video": False,
                "audio_output": False,
                "inpainting": False,
                "outpainting": False,
                "reference_images": True,
                "background_image": True,
                "injected_frames": False,
                "control_image": True,
                "control_video": False,
                "video_continuation": False,
                "sliding_window": False,
                "lora": True,
            },
            setting_values={
                "image_prompt_type": {
                    "allowed": "",
                    "choices": [{"label": "Text/new generation", "value": ""}],
                },
                "video_prompt_type": {
                    "guide_preprocessing": {
                        "choices": [
                            {"label": "Use Control Image Unchanged", "value": ""},
                            {"label": "Use Control Image Unchanged", "value": "V"},
                            {"label": "PV", "value": "PV"},
                            {"label": "DV", "value": "DV"},
                            {"label": "EV", "value": "EV"},
                        ],
                    },
                    "mask_preprocessing": None,
                    "guide_custom_choices": None,
                    "image_ref_choices": {
                        "default": "",
                        "letters_filter": "KI",
                        "choices": [
                            {"label": "None", "value": ""},
                            {
                                "label": (
                                    "Conditional Image is first Main Subject / "
                                    "Landscape and may be followed by People / "
                                    "Objects"
                                ),
                                "value": "KI",
                            },
                            {
                                "label": "Conditional Images are References",
                                "value": "I",
                            },
                        ],
                    },
                    "custom_video_selection": None,
                    "forced": "",
                },
                "audio_prompt_type": {"sources": None, "custom_option": None},
                "model_mode": None,
                "sample_solver": {
                    "choices": [{"label": "Flash", "value": "flash"}],
                },
                "prompt_enhancer": None,
            },
        ),
        text_to_image=True,
        reference_images=True,
        control_image=True,
        inpainting=False,
        lora="future",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Ref/Control",
            max_images=5,
            default_role="reference_subject",
            roles=(
                REFERENCE_SUBJECT_ROLE,
                REFERENCE_PEOPLE_OBJECTS_ROLE,
                CONTROL_IMAGE_ROLE,
                CONTROL_POSE_ROLE,
                CONTROL_DEPTH_ROLE,
                CONTROL_CANNY_ROLE,
            ),
        ),
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
    ),
    ModelProfile(
        id="krea2_turbo_edit",
        display_name="Krea 2 Edit",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="krea2_turbo_edit",
        wangp_metadata=_image_wangp_metadata(
            family="krea2",
            family_label="Krea 2",
            base_model_type="krea2_turbo_edit",
            inputs=("text", "image"),
            image_to_image=True,
            reference_images=True,
            multiple_references=True,
            background_image=True,
            mask=True,
            inpainting=True,
            outpainting=True,
            setting_values=_image_setting_values(
                video_prompt_type={
                    "guide_preprocessing": None,
                    "mask_preprocessing": {
                        "visible": True,
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "Native mask", "value": "A"},
                        ],
                    },
                    "guide_custom_choices": None,
                    "image_ref_choices": {
                        "default": "KI",
                        "letters_filter": "KI",
                        "choices": [
                            {"label": "None", "value": ""},
                            {
                                "label": (
                                    "Conditional Image is first Main Subject / "
                                    "Landscape and may be followed by People / "
                                    "Objects"
                                ),
                                "value": "KI",
                            },
                            {
                                "label": "Conditional Images are People / Objects",
                                "value": "I",
                            },
                        ],
                    },
                    "custom_video_selection": None,
                    "forced": "",
                },
                model_mode={
                    "default": 0,
                    "label": "Inpainting Method",
                    "choices": [
                        {
                            "label": (
                                "Masked Denoising: inpainted area may reuse "
                                "masked content"
                            ),
                            "value": "",
                        },
                        {
                            "label": "LanPaint (2 steps): ~2x slower, easy task",
                            "value": "2",
                        },
                        {
                            "label": "LanPaint (5 steps): ~5x slower, medium task",
                            "value": "3",
                        },
                        {
                            "label": "LanPaint (10 steps): ~10x slower, hard task",
                            "value": "4",
                        },
                        {
                            "label": "LanPaint (15 steps): ~15x slower, very hard task",
                            "value": "5",
                        },
                    ],
                },
            ),
        ),
        wangp_default_settings={
            "image_mode": 1,
            "model_mode": 0,
            "num_inference_steps": 8,
            "guidance_scale": 0,
            "video_prompt_type": "KI",
        },
        text_to_image=True,
        reference_images=True,
        inpainting=True,
        outpainting=True,
        lora="future",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Reference Images",
            max_images=2,
            default_role="reference_subject",
            roles=(
                REFERENCE_SUBJECT_ROLE,
                REFERENCE_PEOPLE_OBJECTS_ROLE,
            ),
        ),
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
        wangp_resolution_categories=("<=2k",),
    ),
    ModelProfile(
        id="qwen_image_edit_plus2_20B",
        display_name="Qwen Image Edit",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="qwen_image_edit_plus2_20B",
        wangp_metadata=_image_wangp_metadata(
            family="qwen",
            family_label="Qwen",
            base_model_type="qwen_image_edit_plus2_20B",
            inputs=("text", "image"),
            image_to_image=True,
            reference_images=True,
            multiple_references=True,
            background_image=True,
            control_image=True,
            mask=True,
            inpainting=True,
            outpainting=True,
            setting_values=_image_setting_values(
                video_prompt_type={
                    "guide_preprocessing": {
                        "choices": [
                            {"label": "Qwen Raw Format", "value": ""},
                            {"label": "PV", "value": "PV"},
                            {"label": "DV", "value": "DV"},
                            {"label": "SV", "value": "SV"},
                            {"label": "CV", "value": "CV"},
                            {"label": "Qwen Raw Format", "value": "V"},
                        ],
                    },
                    "mask_preprocessing": {
                        "visible": True,
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "A", "value": "A"},
                        ],
                    },
                    "guide_custom_choices": None,
                    "image_ref_choices": {
                        "letters_filter": "KI",
                        "choices": [
                            {"label": "None", "value": ""},
                            {
                                "label": (
                                    "Conditional Image is first Main Subject / "
                                    "Landscape and may be followed by People / "
                                    "Objects"
                                ),
                                "value": "KI",
                            },
                            {
                                "label": "Conditional Images are People / Objects",
                                "value": "I",
                            },
                        ],
                    },
                    "custom_video_selection": None,
                    "forced": "",
                },
                model_mode={
                    "default": 1,
                    "label": "Inpainting Method",
                    "choices": [
                        {
                            "label": (
                                "Lora Inpainting: Inpainted area completely "
                                "unrelated to masked content"
                            ),
                            "value": "1",
                        },
                        {
                            "label": (
                                "Masked Denoising : Inpainted area may reuse "
                                "some content that has been masked"
                            ),
                            "value": "",
                        },
                        {
                            "label": "LanPaint (2 steps): ~2x slower, easy task",
                            "value": "2",
                        },
                        {
                            "label": "LanPaint (5 steps): ~5x slower, medium task",
                            "value": "3",
                        },
                        {
                            "label": "LanPaint (10 steps): ~10x slower, hard task",
                            "value": "4",
                        },
                        {
                            "label": "LanPaint (15 steps): ~15x slower, very hard task",
                            "value": "5",
                        },
                    ],
                },
                sample_solver={
                    "choices": [
                        {"label": "Default", "value": "default"},
                        {"label": "Lightning", "value": "lightning"},
                    ],
                },
            ),
        ),
        text_to_image=True,
        reference_images=True,
        control_image=True,
        inpainting=True,
        outpainting=True,
        masked_edit_references=True,
        lora="future",
        wangp_accelerator_profile_id="lightningqwen25124steps",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Ref/Control",
            max_images=5,
            default_role="reference_subject",
            roles=(
                REFERENCE_SUBJECT_ROLE,
                REFERENCE_PEOPLE_OBJECTS_ROLE,
                CONTROL_IMAGE_ROLE,
                CONTROL_POSE_ROLE,
                CONTROL_DEPTH_ROLE,
            ),
        ),
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
        wangp_resolution_categories=("<=2k",),
    ),
    ModelProfile(
        id="ideogram4_int8",
        display_name="Ideogram 4",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="ideogram4",
        wangp_metadata=_image_wangp_metadata(
            family="ideogram4",
            family_label="Ideogram",
            base_model_type="ideogram4",
            inputs=("text",),
            finetune=False,
            setting_values=_image_setting_values(
                sample_solver={
                    "choices": [
                        {"label": "Euler", "value": "euler"},
                        {"label": "RES 2M", "value": "res_2m"},
                        {"label": "RES 2S", "value": "res_2s"},
                    ],
                },
                prompt_enhancer={
                    "default": "",
                    "choices": [
                        {
                            "label": "Ideogram JSON caption from Text Prompt",
                            "value": "T",
                        },
                    ],
                },
            ),
        ),
        wangp_default_settings={
            "image_mode": 1,
            "num_inference_steps": 20,
            "guidance_scale": 7,
            "prompt_enhancer": "T",
            "custom_settings": {"ideogram_mu": 0.0, "ideogram_std": 1.75},
        },
        text_to_image=True,
        lora="future",
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
    ),
    ModelProfile(
        id="ideogram4_turbotime_int8",
        display_name="Ideogram 4 TurboTime",
        media_type="image",
        visible=True,
        status="stable",
        wangp_model_type="ideogram4_turbotime",
        wangp_metadata=_image_wangp_metadata(
            family="ideogram4",
            family_label="Ideogram",
            base_model_type="ideogram4_turbotime",
            inputs=("text",),
            finetune=False,
            setting_values=_image_setting_values(
                sample_solver={
                    "choices": [
                        {"label": "Euler", "value": "euler"},
                        {"label": "RES 2M", "value": "res_2m"},
                        {"label": "RES 2S", "value": "res_2s"},
                    ],
                },
                prompt_enhancer={
                    "default": "",
                    "choices": [
                        {
                            "label": "Ideogram JSON caption from Text Prompt",
                            "value": "T",
                        },
                    ],
                },
            ),
        ),
        wangp_default_settings={
            "image_mode": 1,
            "num_inference_steps": 8,
            "guidance_scale": 0,
            "prompt_enhancer": "T",
            "custom_settings": {"ideogram_mu": 0.5, "ideogram_std": 1.75},
        },
        text_to_image=True,
        lora="future",
        default_aspect_ratio="1:1",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p", "1440p"),
        min_resolution_tier="540p",
        max_resolution_tier="1440p",
    ),
)
