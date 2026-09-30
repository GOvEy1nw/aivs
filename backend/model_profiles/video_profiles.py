"""Curated video model profiles."""

from __future__ import annotations

from dataclasses import replace

from model_profiles.policies import (
    DirectorRenderStrategyPolicy,
    SfxPolicy,
    SpeechPolicy,
    SystemDependency,
    VideoAudioPolicy,
    VideoEditOperationPolicy,
    VideoEditPolicy,
)
from model_profiles.types import (
    AUDIO_GUIDE_ROLE,
    AUDIO_TO_VIDEO_ROLE,
    CANNY_EDGES_ROLE,
    CONTINUE_VIDEO_ROLE,
    CONTROL_VIDEO_ROLE,
    CURATED_ASPECT_RATIOS,
    DEPTH_ROLE,
    DirectorPolicy,
    END_IMAGE_ROLE,
    H3_REFERENCE_AUDIO_ROLE,
    H3_REFERENCE_IMAGE_ROLE,
    H3_REFERENCE_VIDEO_ROLE,
    HUMAN_MOTION_POSE_ROLE,
    HUMAN_MOTION_ROLE,
    InputMediaPolicy,
    ModelLicenseInfo,
    ModelProfile,
    PromptComposerPolicy,
    REFERENCE_VOICE_ROLE,
    SDR_TO_HDR_ROLE,
    START_IMAGE_ROLE,
    StyleDefinition,
    WanGPModelMetadata,
    _image_setting_values,  # pyright: ignore[reportPrivateUsage]
)
def _ltx25_style(
    style_id: str,
    display_name: str,
    thumbnail_name: str,
    source_url: str,
    style_prompt: str | None = None,
) -> StyleDefinition:
    return StyleDefinition(
        id=style_id,
        display_name=display_name,
        thumbnail_url=f"/styles/ltx25/{thumbnail_name}.webp",
        source_url=source_url,
        lora_url=source_url,
        lora_strength=1.0,
        style_prompt=style_prompt,
    )


LTX25_STYLES: tuple[StyleDefinition, ...] = (
    _ltx25_style("ltx25_soft_enhance", "Soft Enhance", "soft-enhance", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Soft_Enhance_Style_LoRa/resolve/main/LTX2.3_Soft_Enhance.safetensors"),
    _ltx25_style("ltx25_fantasy_painterly", "Fantasy Painterly", "fantasy-painterly", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Painterly_Style_LoRa/resolve/main/Fantasy_Painterly.safetensors", "D4rkP41nt3r, fantasy painterly style"),
    _ltx25_style("ltx25_pixar_toon", "Pixar Toon", "pixar-toon", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Pixar_Toon_Style_LoRa/resolve/main/Pixar_Toon.safetensors", "P1x4r, pixar style character"),
    _ltx25_style("ltx25_90s_animation", "90s Animation", "90s-animation", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_90s_Animation_Style_LoRa/resolve/main/90sAnimationStyle.safetensors", "9o4n1m, hand-painted grotesque animation"),
    _ltx25_style("ltx25_claymation", "Claymation", "claymation", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Clay_Mation_Style_LoRa/resolve/main/Claymation.safetensors", "claymation style, handcrafted clay character"),
    _ltx25_style("ltx25_cozy_felt", "Cozy Felt", "cozy-felt", "https://huggingface.co/vrgamedevgirl84/LTX2.3_Cozy_Felt_Style_LoRa/resolve/main/CozyFelt.safetensors", "F3ltCut0u7, felt cutout style"),
    _ltx25_style("ltx25_fantasy_anime", "Fantasy Anime", "fantasy-anime", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Anime_Style_LoRa/resolve/main/Fantasy_Anime.safetensors", "f4nt4sy4n1m6, cinematic fantasy anime cel-shaded illustration"),
    _ltx25_style("ltx25_fantasy_realism", "Fantasy Realism", "fantasy-realism", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Realism_Style_LoRa/resolve/main/Fantasy_Realism.safetensors", "f4nt4sy, cinematic fantasy realism"),
    _ltx25_style("ltx25_fantasy_puppet", "Fantasy Puppet", "fantasy-puppet", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Puppet_Style_LoRa/resolve/main/FantasyPuppetStyle.safetensors", "6u8p3t, fantasy puppet style"),
    _ltx25_style("ltx25_crisp_enhance", "Crisp Enhance", "crisp-enhance", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Crisp_Enhance_Style_LoRa/resolve/main/LTX2.3_Crisp_Enhance.safetensors"),
    _ltx25_style("ltx25_post_apocalyptic", "Post-Apocalyptic", "post-apocalyptic", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Post_Apocalyptic_Style_LoRa/resolve/main/Post_Apocalyptic.safetensors", "P0st4p0c0, cinematic post-apocalyptic photorealistic video"),
    _ltx25_style("ltx25_paper_cut_out", "Paper Cut Out", "paper-cut-out", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Paper_Cut_Out_Style_LoRa/resolve/main/PaperCutOutStyle.safetensors", "Pap3rCut0u7, paper cutout style"),
    _ltx25_style("ltx25_wild_west", "Wild West", "wild-west", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Wild_West_Style_LoRa/resolve/main/Wild_West.safetensors", "W1ldW4st, cinematic realistic Wild West video"),
    _ltx25_style("ltx25_cinematic_sci_fi_cyberpunk", "Cinematic Sci-fi Cyberpunk", "cinematic-sci-fi-cyberpunk", "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Cinematic_Sci-fi-Cyberpunk_Style_LoRa/resolve/main/Cinematic_sci-fi-cyberpunk.safetensors", "C6b4rP8nk, cinematic cyberpunk neo-noir aesthetic"),
)


_ltx_fast_profile = ModelProfile(
        id="ltx2_25_fast",
        display_name="LTX 2.5 Fast",
        media_type="video",
        visible=True,
        status="stable",
        wangp_model_type="ltx2_25_22B_distilled",
        wangp_metadata=WanGPModelMetadata(
            family="ltx2",
            family_label="LTX-2",
            base_model_type="ltx2_25_22B",
            finetune=False,
            main_output=("image", "video"),
            outputs=("image", "video", "audio"),
            inputs=("text", "audio", "image", "video"),
            media_inputs={
                "image": {
                    "start": True,
                    "end": True,
                    "reference": True,
                    "single_reference": True,
                    "multiple_references": False,
                    "background": True,
                    "injected_frames": True,
                    "control": False,
                    "mask": False,
                },
                "video": {
                    "continue": True,
                    "last": True,
                    "control": True,
                    "mask": True,
                },
                "audio": {"prompt": True, "output": True},
            },
            capabilities={
                "text_to_video": True,
                "image_to_video": True,
                "video_to_video": True,
                "text_to_image": True,
                "image_to_image": True,
                "text_to_audio": False,
                "audio_to_audio": False,
                "audio_to_video": True,
                "audio_output": True,
                "inpainting": True,
                "outpainting": True,
                "reference_images": True,
                "background_image": True,
                "injected_frames": True,
                "control_image": False,
                "control_video": True,
                "video_continuation": True,
                "sliding_window": True,
                "lora": True,
            },
            setting_values={
                "image_prompt_type": {
                    "allowed": "TSEVL",
                    "choices": [
                        {"label": "Text/new generation", "value": ""},
                        {"label": "Start image", "value": "S"},
                        {"label": "End image", "value": "E"},
                        {"label": "Continue from source video", "value": "V"},
                        {"label": "Continue from last generated video", "value": "L"},
                    ],
                },
                "video_prompt_type": {
                    "guide_preprocessing": None,
                    "mask_preprocessing": {
                        "choices": [
                            {"label": "None", "value": ""},
                            {"label": "A", "value": "A"},
                            {"label": "NA", "value": "NA"},
                            {"label": "XA", "value": "XA"},
                            {"label": "XNA", "value": "XNA"},
                        ],
                    },
                    "guide_custom_choices": {
                        "default": "",
                        "label": "Control Video / Frames Injection",
                        "letters_filter": "OPDEMVG&KFI",
                        "visible": True,
                        "choices": [
                            {"label": "No Video Process", "value": ""},
                            {"label": "Transfer Human Motion", "value": "PVG"},
                            {"label": "Transfer Human Motion With Pose Alignment", "value": "OVG"},
                            {"label": "Transfer Depth", "value": "DVG"},
                            {"label": "Transfer Canny Edges", "value": "EVG"},
                            {"label": "LTX2 Raw Format / Control Video for Ic Lora", "value": "VG"},
                            {"label": "Inpaint Masked Area", "value": "MVG"},
                            {"label": "Ingredients Reference Sheet", "value": "I"},
                            {"label": "Convert SDR to HDR (IC-LoRA)", "value": "V&G"},
                            {"label": "Inject Frames", "value": "KFI"},
                        ],
                    },
                    "image_ref_choices": None,
                    "custom_video_selection": None,
                    "forced": "",
                },
                "audio_prompt_type": {
                    "sources": {
                        "default": "",
                        "letters_filter": "A1OFK2",
                        "show_label": False,
                        "choices": [
                            {"label": "Generate Video & Soundtrack based on Text Prompt", "value": ""},
                            {"label": "Generate Video based on Soundtrack and Text Prompt", "value": "A"},
                            {"label": "Generate Video based on Control Video + its Audio Track and Text Prompt", "value": "K"},
                            {"label": "Generate Audio based on Control Video and Text Prompt", "value": "2"},
                            {"label": "Generate Video based on Reference Voice (ID-LoRA) and Text Prompt", "value": "A1OF"},
                        ],
                    },
                    "custom_option": None,
                },
                "model_mode": None,
                "sample_solver": None,
                "prompt_enhancer": {
                    "default": "",
                    "choices": [
                        {"label": "An Enhanced Prompt using existing Text Prompt", "value": "T"},
                        {"label": "An Enhanced Prompt using existing Text Prompt and Start Image", "value": "TI"},
                        {"label": "An Enhanced Relayed Prompt using existing Text Prompt", "value": "T1"},
                        {"label": "An Enhanced Relayed Prompt using existing Text Prompt and Start Image", "value": "TI1"},
                    ],
                },
            },
        ),
        styles=LTX25_STYLES,
        text_to_image=True,
        text_to_video=True,
        image_to_video=True,
        video_to_video=True,
        audio_to_video=True,
        audio_output=True,
        start_image=True,
        end_image=True,
        control_video=True,
        video_continuation=True,
        sliding_window=True,
        reference_images=True,
        inpainting=True,
        lora="future",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Add Start/End Image, Control Video, or Audio Track",
            max_images=4,
            default_role="start_image",
            roles=(
                START_IMAGE_ROLE,
                END_IMAGE_ROLE,
                HUMAN_MOTION_ROLE,
                HUMAN_MOTION_POSE_ROLE,
                DEPTH_ROLE,
                CANNY_EDGES_ROLE,
                SDR_TO_HDR_ROLE,
                CONTINUE_VIDEO_ROLE,
                AUDIO_TO_VIDEO_ROLE,
                REFERENCE_VOICE_ROLE,
            ),
        ),
        default_aspect_ratio="16:9",
        default_resolution_tier="540p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p"),
        required_pack_ids=("ltx2_fast",),
        system_dependencies=(
            SystemDependency("video_tool_lora_relight", "lora", ("relight",)),
            SystemDependency("video_tool_lora_colorize", "lora", ("colorize",)),
            SystemDependency("video_tool_lora_clean_plate", "lora", ("clean_plate",)),
            SystemDependency("video_tool_lora_lip_dub", "lora", ("lip_dub",)),
            SystemDependency("video_tool_lora_decompression", "lora", ("decompression",)),
            SystemDependency("video_tool_lora_sdr_to_hdr", "lora", ("sdr_to_hdr",)),
            SystemDependency("video_tool_lora_remove_glare", "lora", ("remove_glare",)),
            SystemDependency("video_tool_lora_deblur", "lora", ("deblur",)),
        ),
        video_audio=VideoAudioPolicy(
            status="stable",
            handler="video_generation",
            required_pack_ids=("ltx2_fast",),
            soundtrack=True,
            audio_conditioning=True,
            control_video_audio=True,
            output_audio=True,
            max_audio_inputs=1,
        ),
        speech=SpeechPolicy(
            status="experimental",
            handler="video_generation",
            required_pack_ids=("ltx2_fast",),
            reference_voice=True,
            max_reference_inputs=1,
        ),
        sfx=SfxPolicy(
            status="experimental",
            handler="video_generation",
            required_pack_ids=("ltx2_fast",),
            text=True,
            control_video_audio=True,
            max_duration_seconds=20,
        ),
        video_edits=VideoEditPolicy(
            operations=(
                VideoEditOperationPolicy("reframe", "stable", "video_generation", ("ltx2_fast",)),
                VideoEditOperationPolicy(
                    "extend",
                    "stable",
                    "video_generation",
                    ("ltx2_fast",),
                    source_behavior="continue_video",
                    duration_behavior="extend_by",
                ),
                *(
                    VideoEditOperationPolicy(
                        operation_id,
                        "experimental",
                        "video_generation",
                        ("ltx2_fast",),
                        (f"video_tool_lora_{operation_id}",),
                    )
                    for operation_id in (
                        "relight",
                        "colorize",
                        "clean_plate",
                        "lip_dub",
                        "decompression",
                        "sdr_to_hdr",
                        "remove_glare",
                        "deblur",
                    )
                ),
                VideoEditOperationPolicy(
                    "retake",
                    "hidden",
                    "retake",
                    ("ltx2_fast",),
                    source_behavior="source_video",
                    disabled_reason="Retake is unavailable while the WanGP path is not reliable.",
                ),
            )
        ),
        director=DirectorPolicy(
            enabled=True,
            prompt_relay=True,
            injected_frames=True,
            continue_video=True,
            guide_audio_start_only=True,
            max_image_keyframes=16,
            max_guidance_segments=1,
            guidance_modes=("human_motion", "depth", "ingredients"),
            max_duration_seconds=20,
            allow_keyframes_with_video_guidance=False,
            allow_keyframes_with_ingredients=False,
            allow_guide_audio_with_guidance=False,
            render_strategies=(
                DirectorRenderStrategyPolicy(
                    "single_pass",
                    "stable",
                    "director_generation",
                    ("ltx2_fast",),
                    max_duration_seconds=20,
                ),
            ),
        ),
    )


_h3_quality_profile = ModelProfile(
        id="minimax_h3_quality",
        display_name="MiniMax H3 Quality",
        media_type="video",
        visible=True,
        status="experimental",
        wangp_model_type="minimax_h3_fl2va_pruned",
        wangp_metadata=WanGPModelMetadata(
            family="minimax_h3",
            family_label="MiniMax H3",
            base_model_type="minimax_h3",
            finetune=False,
            main_output=("video", "audio"),
            outputs=("video", "audio"),
            inputs=("text", "image", "video", "audio"),
            media_inputs={
                "image": {"start": True, "end": True, "reference": True, "single_reference": False, "multiple_references": True, "background": False, "injected_frames": False, "control": False, "mask": False},
                "video": {"continue": False, "last": False, "control": True, "mask": False},
                "audio": {"prompt": True, "output": True},
            },
            capabilities={
                "text_to_video": True, "image_to_video": True, "video_to_video": True,
                "text_to_image": False, "image_to_image": False, "text_to_audio": False,
                "audio_to_audio": False, "audio_to_video": True, "audio_output": True,
                "inpainting": False, "outpainting": False, "reference_images": True,
                "background_image": False, "injected_frames": False, "control_image": False,
                "control_video": True, "video_continuation": False, "sliding_window": True,
                "lora": False,
            },
            setting_values=_image_setting_values(
                video_prompt_type={"guide_preprocessing": None, "mask_preprocessing": None, "guide_custom_choices": None, "image_ref_choices": None, "custom_video_selection": None, "forced": ""},
                prompt_enhancer={"default": "", "choices": [{"label": "Enhance prompt", "value": "T"}]},
            ),
        ),
        text_to_video=True,
        image_to_video=True,
        video_to_video=True,
        audio_to_video=True,
        audio_output=True,
        start_image=True,
        end_image=True,
        control_video=True,
        sliding_window=True,
        reference_images=True,
        lora="unsupported",
        input_media=InputMediaPolicy(
            supports_image_inputs=True,
            tooltip_label="Add H3 frames, controls, or references",
            max_images=12,
            max_reference_images=9,
            max_reference_videos=3,
            max_reference_audios=3,
            max_combined_references=12,
            default_role="start_image",
            roles=(START_IMAGE_ROLE, END_IMAGE_ROLE, CONTROL_VIDEO_ROLE, AUDIO_GUIDE_ROLE, H3_REFERENCE_IMAGE_ROLE, H3_REFERENCE_VIDEO_ROLE, H3_REFERENCE_AUDIO_ROLE),
        ),
        prompt_composer=PromptComposerPolicy(prompt_format="h3", entity_media_mode="inline-reference", voice_reference=True),
        default_aspect_ratio="16:9",
        default_resolution_tier="720p",
        allowed_aspect_ratios=CURATED_ASPECT_RATIOS,
        allowed_resolution_tiers=("540p", "720p", "1080p"),
        required_pack_ids=("minimax-h3-quality",),
        video_audio=VideoAudioPolicy(
            status="experimental", handler="video_generation", required_pack_ids=("minimax-h3-quality",),
            soundtrack=True, audio_conditioning=True, control_video_audio=True,
            output_audio=True, max_audio_inputs=3,
        ),
        license=ModelLicenseInfo(
            project_license="MiniMax H3 Community License",
            weights_license="MiniMax H3 Community License",
            commercial_use="restricted",
            attribution_required=True,
            source_project="MiniMax H3",
            license_url="https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
            notes="License scope is subject to the official territorial and use restrictions.",
        ),
    )


def _with_required_pack(profile: ModelProfile, pack_id: str) -> ModelProfile:
    return replace(
        profile,
        required_pack_ids=(pack_id,),
        video_audio=replace(profile.video_audio, required_pack_ids=(pack_id,)),
        speech=replace(profile.speech, required_pack_ids=(pack_id,)),
        sfx=replace(profile.sfx, required_pack_ids=(pack_id,)),
        video_edits=replace(
            profile.video_edits,
            operations=tuple(
                replace(operation, required_pack_ids=(pack_id,))
                for operation in profile.video_edits.operations
            ),
        ),
        director=replace(
            profile.director,
            render_strategies=tuple(
                replace(strategy, required_pack_ids=(pack_id,))
                for strategy in profile.director.render_strategies
            ),
        ),
    )


_ltx_quality_profile = _with_required_pack(
    replace(
        _ltx_fast_profile,
        id="ltx2_25_quality",
        display_name="LTX 2.5 Quality",
        wangp_model_type="ltx2_25_22B",
        wangp_accelerator_profile_id="ltx2_25_two_stage_hq_res2s_15_3",
    ),
    "ltx2_quality",
)
_h3_fast_profile = _with_required_pack(
    replace(
        _h3_quality_profile,
        id="minimax_h3_fast",
        display_name="MiniMax H3 Fast",
        wangp_accelerator_profile_ids={
            "minimax_h3_fl2va_pruned": "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1",
            "minimax_h3_ref2va_pruned": "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1",
        },
    ),
    "minimax-h3-fast",
)
VIDEO_PROFILES: tuple[ModelProfile, ...] = (
    _ltx_fast_profile,
    _ltx_quality_profile,
    _h3_fast_profile,
    _h3_quality_profile,
)
