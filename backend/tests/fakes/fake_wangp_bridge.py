"""Fake WanGP bridge for tests.

Mirrors the public surface of ``services.wangp_bridge.WanGPBridge`` that the
generation handlers actually call — ``generate_video``, ``generate_images``
and ``get_status`` — without touching the real WanGP runtime. Each call
writes a placeholder output file into the configured output directory so
the response payloads point at real on-disk paths, matching the live
bridge's contract.
"""

from __future__ import annotations

import uuid
import wave
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from services.wangp_bridge import ProgressCallback, WanGPBridgeStatus


@dataclass
class FakeWangpVideoCall:
    prompt: str
    resolution_label: str
    aspect_ratio: str
    duration_seconds: int
    fps: int
    steps: int
    seed: int | None
    camera_motion: str
    negative_prompt: str
    image_path: str | None
    audio_path: str | None
    model_type: str
    default_settings: dict[str, object]
    start_image_path: str | None = None
    end_image_path: str | None = None
    control_video_path: str | None = None
    video_prompt_type: str | None = None
    image_prompt_type: str | None = None
    audio_prompt_type: str | None = None
    video_guide_outpainting: str | None = None
    video_guide_outpainting_ratio: str | None = None
    video_length_frames: int | None = None
    reference_image_paths: list[str] = field(default_factory=list)
    reference_video_paths: list[str] = field(default_factory=list)
    reference_audio_paths: list[str] = field(default_factory=list)


@dataclass
class FakeWangpImageCall:
    prompt: str
    width: int
    height: int
    num_steps: int
    num_images: int
    seed: int | None
    model_type: str
    default_settings: dict[str, object]


@dataclass
class FakeWangpEnhancePromptCall:
    prompt: str
    mode: str
    model_type: str
    image_path: str | None
    end_image_path: str | None = None
    control_image_path: str | None = None
    reference_image_paths: list[str] | None = None
    duration_seconds: float | None = None


@dataclass
class FakeWangpDirectorCall:
    settings: dict[str, object]


@dataclass
class FakeWangpMusicCall:
    description: str
    lyrics: str
    duration_seconds: int
    bpm: int | None
    key_scale: str | None
    time_signature: str | None
    language: str | None
    model_mode: int
    temperature: float
    top_p: float
    top_k: int
    lm_guidance_scale: float
    source_audio_path: str | None
    reference_timbre_path: str | None
    audio_prompt_type: str
    cover_strength: float | None
    seed: int | None
    model_type: str
    default_settings: dict[str, object]


@dataclass
class FakeWangpComposeMusicLyricsCall:
    description: str
    lyrics_prompt: str | None
    language: str
    duration_seconds: int
    model_type: str
    think: bool
    seed: int | None


@dataclass
class FakeWangpSfxCall:
    video_path: str
    prompt: str
    negative_prompt: str
    seed: int | None
    duration_seconds: int


@dataclass
class FakeWangpSpeechCall:
    text: str
    model_type: str
    default_settings: dict[str, object]
    reference_audio_paths: list[str]
    enhance_prompt: bool
    seed: int | None


@dataclass
class FakeWanGPBridge:
    """Test stand-in for ``WanGPBridge``.

    Defaults to an available bridge; tests can flip ``available`` or set
    ``raise_on_generate``/``raise_on_video`` to exercise error and
    cancellation paths. The ``image_model_type``/``video_model_type``
    fields mirror the real constructor signature so the bridge can be
    wired through ``AppHandler`` unchanged.
    """

    enabled: bool = True
    root: Path | None = field(default_factory=lambda: Path(__file__).resolve().parent)
    python_executable: str | None = None
    config_dir: Path = field(default_factory=lambda: Path("."))
    output_dir: Path = field(default_factory=lambda: Path("."))
    video_model_type: str = "ltx2_25_22B_distilled"
    image_model_type: str = "z_image"
    camera_motion_prompts: dict[str, str] = field(default_factory=dict)
    extra_args: Iterable[str] = ()
    available: bool = True
    unavailable_reason: str | None = "WanGP bridge disabled in test"
    session_ready: bool = False
    preload_calls: int = 0
    compile_enabled: bool = False
    runtime_preferences: dict[str, object] = field(default_factory=dict)
    preview_options: dict[str, object] = field(default_factory=dict)
    style_lora_downloads: list[tuple[str, str]] = field(default_factory=list)
    resolved_profile_calls: list[tuple[str, str | None, str | None]] = field(
        default_factory=list
    )

    video_calls: list[FakeWangpVideoCall] = field(default_factory=list)
    image_calls: list[FakeWangpImageCall] = field(default_factory=list)
    enhance_prompt_calls: list[FakeWangpEnhancePromptCall] = field(default_factory=list)
    director_calls: list[FakeWangpDirectorCall] = field(default_factory=list)
    music_calls: list[FakeWangpMusicCall] = field(default_factory=list)
    compose_music_lyrics_calls: list[FakeWangpComposeMusicLyricsCall] = field(
        default_factory=list
    )
    sfx_calls: list[FakeWangpSfxCall] = field(default_factory=list)
    speech_calls: list[FakeWangpSpeechCall] = field(default_factory=list)
    raise_on_video: Exception | None = None
    raise_on_images: Exception | None = None
    raise_on_enhance_prompt: Exception | None = None
    raise_on_director: Exception | None = None
    raise_on_music: Exception | None = None
    raise_on_compose_music_lyrics: Exception | None = None
    raise_on_resolve_profiles: Exception | None = None

    def get_status(self) -> WanGPBridgeStatus:
        return WanGPBridgeStatus(
            available=self.enabled and self.available,
            root=self.root,
            python_executable=self.python_executable,
            reason=None if (self.enabled and self.available) else (self.unavailable_reason or "WanGP bridge is unavailable"),
            session_ready=self.session_ready,
        )

    def preload_session(self) -> None:
        self.preload_calls += 1
        if not self.enabled:
            return
        if not self.available:
            raise RuntimeError(self.unavailable_reason or "WanGP bridge is unavailable")
        self.session_ready = True

    def resolve_profiles(
        self,
        model_type: str,
        *,
        accelerator_profile_id: str | None = None,
        preset_profile_id: str | None = None,
    ) -> dict[str, object]:
        self.resolved_profile_calls.append(
            (model_type, accelerator_profile_id, preset_profile_id)
        )
        if self.raise_on_resolve_profiles is not None:
            raise self.raise_on_resolve_profiles
        if preset_profile_id is not None:
            return {"resolved_preset_profile_id": preset_profile_id}
        if accelerator_profile_id == "ltx2_25_two_stage_hq_res2s_15_3":
            return {
                "sample_solver": "res2s",
                "num_inference_steps": 15,
                "guidance_phases": 2,
                "guidance_scale": 3.0,
                "audio_guidance_scale": 7.0,
                "alt_guidance_scale": 3.0,
                "alt_scale": 0.45,
                "activated_loras": [
                    "https://huggingface.co/DeepBeepMeep/LTX-2/resolve/main/ltx-2.5-22b-distilled-lora-450_bf16.safetensors"
                ],
                "loras_multipliers": "0.5|",
            }
        if model_type == "ltx2_25_22B_distilled":
            return {"num_inference_steps": 8}
        if accelerator_profile_id == "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1":
            return {
                "config": "gguf_q4_k_m,fp8mix",
                "sample_solver": "euler",
                "num_inference_steps": 6,
                "guidance_scale": 1.0,
                "flow_shift": 12.0,
                "activated_loras": [
                    "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors"
                ],
                "loras_multipliers": "0.5",
            }
        if accelerator_profile_id == "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1":
            return {
                "config": "gguf_q4_k_m,fp8mix",
                "sample_solver": "euler",
                "num_inference_steps": 6,
                "guidance_scale": 1.0,
                "flow_shift": 12.0,
                "activated_loras": [
                    "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_ref2v_lightx2v_turbo_4step_v0.1_resized_avg_rank_20_bf16.safetensors"
                ],
                "loras_multipliers": "0.5",
            }
        if model_type in {"minimax_h3_fl2va_pruned", "minimax_h3_ref2va_pruned"}:
            return {
                "config": "gguf_q4_k_m,fp8mix",
                "num_inference_steps": 20,
                "guidance_scale": 1.0,
                "flow_shift": 12.0,
                "sample_solver": "euler",
            }
        return {}

    def set_compile_enabled(self, enabled: bool) -> None:
        self.compile_enabled = enabled

    def set_runtime_preferences(
        self,
        *,
        attention_mode: str,
        performance_profile: float,
        reduce_vram: str,
    ) -> None:
        self.runtime_preferences = {
            "attention_mode": attention_mode,
            "performance_profile": performance_profile,
            "reduce_vram": reduce_vram,
        }

    def set_preview_options(
        self,
        *,
        mode: str,
    ) -> None:
        self.preview_options = {
            "mode": mode,
        }

    def generate_video(
        self,
        *,
        prompt: str,
        resolution_label: str,
        aspect_ratio: str,
        duration_seconds: int,
        fps: int,
        steps: int,
        seed: int | None,
        camera_motion: str,
        negative_prompt: str,
        image_path: str | None,
        audio_path: str | None,
        on_progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
        model_type: str | None = None,
        default_settings: dict[str, object] | None = None,
        start_image_path: str | None = None,
        end_image_path: str | None = None,
        control_video_path: str | None = None,
        video_prompt_type: str | None = None,
        image_prompt_type: str | None = None,
        audio_prompt_type: str | None = None,
        video_guide_outpainting: str | None = None,
        video_guide_outpainting_ratio: str | None = None,
        video_length_frames: int | None = None,
        reference_image_paths: list[str] | None = None,
        reference_video_paths: list[str] | None = None,
        reference_audio_paths: list[str] | None = None,
        h3_video_excerpt_positions: list[str] | None = None,
        h3_audio_excerpt_positions: list[str] | None = None,
    ) -> str:
        del h3_video_excerpt_positions, h3_audio_excerpt_positions
        self.video_calls.append(
            FakeWangpVideoCall(
                prompt=prompt,
                resolution_label=resolution_label,
                aspect_ratio=aspect_ratio,
                duration_seconds=duration_seconds,
                fps=fps,
                steps=steps,
                seed=seed,
                camera_motion=camera_motion,
                negative_prompt=negative_prompt,
                image_path=image_path,
                audio_path=audio_path,
                model_type=model_type if model_type is not None else self.video_model_type,
                default_settings=dict(default_settings) if default_settings else {},
                start_image_path=start_image_path,
                end_image_path=end_image_path,
                control_video_path=control_video_path,
                video_prompt_type=video_prompt_type,
                image_prompt_type=image_prompt_type,
                audio_prompt_type=audio_prompt_type,
                video_guide_outpainting=video_guide_outpainting,
                video_guide_outpainting_ratio=video_guide_outpainting_ratio,
                video_length_frames=video_length_frames,
                reference_image_paths=list(reference_image_paths or []),
                reference_video_paths=list(reference_video_paths or []),
                reference_audio_paths=list(reference_audio_paths or []),
            )
        )
        if self.raise_on_video is not None:
            raise self.raise_on_video
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / f"fake_wangp_video_{uuid.uuid4().hex[:8]}.mp4"
        output_path.write_bytes(b"fake-wangp-video")
        return str(output_path)

    def generate_images(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        num_steps: int,
        num_images: int,
        seed: int | None,
        on_progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
        model_type: str | None = None,
        default_settings: dict[str, object] | None = None,
    ) -> list[str]:
        self.image_calls.append(
            FakeWangpImageCall(
                prompt=prompt,
                width=width,
                height=height,
                num_steps=num_steps,
                num_images=num_images,
                seed=seed,
                model_type=model_type if model_type is not None else self.image_model_type,
                default_settings=dict(default_settings) if default_settings else {},
            )
        )
        if self.raise_on_images is not None:
            raise self.raise_on_images
        self.output_dir.mkdir(parents=True, exist_ok=True)
        outputs: list[str] = []
        for _ in range(max(1, num_images)):
            image_path = self.output_dir / f"fake_wangp_image_{uuid.uuid4().hex[:8]}.png"
            image_path.write_bytes(b"fake-wangp-image")
            outputs.append(str(image_path))
        return outputs

    def generate_director_video(
        self,
        *,
        settings: dict[str, object],
        on_progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> str:
        self.director_calls.append(FakeWangpDirectorCall(settings=dict(settings)))
        if self.raise_on_director is not None:
            raise self.raise_on_director
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / f"fake_wangp_director_{uuid.uuid4().hex[:8]}.mp4"
        output_path.write_bytes(b"fake-wangp-director")
        return str(output_path)

    def generate_music(
        self,
        *,
        description: str,
        lyrics: str,
        duration_seconds: int,
        bpm: int | None,
        key_scale: str | None,
        time_signature: str | None,
        language: str | None,
        model_mode: int,
        temperature: float,
        top_p: float,
        top_k: int,
        lm_guidance_scale: float,
        source_audio_path: str | None,
        reference_timbre_path: str | None,
        audio_prompt_type: str,
        cover_strength: float | None,
        seed: int | None,
        model_type: str,
        default_settings: dict[str, object] | None,
        on_progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> str:
        self.music_calls.append(
            FakeWangpMusicCall(
                description=description,
                lyrics=lyrics,
                duration_seconds=duration_seconds,
                bpm=bpm,
                key_scale=key_scale,
                time_signature=time_signature,
                language=language,
                model_mode=model_mode,
                temperature=temperature,
                top_p=top_p,
                top_k=top_k,
                lm_guidance_scale=lm_guidance_scale,
                source_audio_path=source_audio_path,
                reference_timbre_path=reference_timbre_path,
                audio_prompt_type=audio_prompt_type,
                cover_strength=cover_strength,
                seed=seed,
                model_type=model_type,
                default_settings=dict(default_settings) if default_settings else {},
            )
        )
        if self.raise_on_music is not None:
            raise self.raise_on_music
        if is_cancelled():
            raise RuntimeError("Generation was cancelled")
        on_progress("generating_music", 50)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / f"fake_wangp_music_{uuid.uuid4().hex[:8]}.wav"
        with wave.open(str(output_path), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(8_000)
            output.writeframes(b"\x00\x00" * 2 * 800)
        return str(output_path)

    def compose_music_lyrics(
        self,
        *,
        description: str,
        lyrics_prompt: str | None,
        language: str,
        duration_seconds: int,
        model_type: str,
        think: bool,
        seed: int | None,
    ) -> str:
        self.compose_music_lyrics_calls.append(
            FakeWangpComposeMusicLyricsCall(
                description=description,
                lyrics_prompt=lyrics_prompt,
                language=language,
                duration_seconds=duration_seconds,
                model_type=model_type,
                think=think,
                seed=seed,
            )
        )
        if self.raise_on_compose_music_lyrics is not None:
            raise self.raise_on_compose_music_lyrics
        return "[Verse]\nLocally composed lyrics"

    def generate_sfx(
        self, *, video_path: str, prompt: str, negative_prompt: str, seed: int | None,
        duration_seconds: int, output_path: Path, on_progress: ProgressCallback,
    ) -> str:
        self.sfx_calls.append(FakeWangpSfxCall(video_path, prompt, negative_prompt, seed, duration_seconds))
        if self.raise_on_music is not None:
            raise self.raise_on_music
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(output_path), "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8_000); output.writeframes(b"\x00\x00" * 800)
        on_progress("generating_sfx", 100)
        return str(output_path)

    def ensure_style_lora(
        self,
        *,
        source_url: str,
        model_type: str,
        on_progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> None:
        if is_cancelled():
            raise RuntimeError("Generation was cancelled")
        self.style_lora_downloads.append((source_url, model_type))

    def generate_speech(
        self,
        *,
        text: str,
        model_type: str,
        default_settings: dict[str, object],
        reference_audio_paths: list[str],
        enhance_prompt: bool,
        seed: int | None,
        on_progress: ProgressCallback,
        is_cancelled: Callable[[], bool],
    ) -> str:
        self.speech_calls.append(FakeWangpSpeechCall(text, model_type, default_settings, reference_audio_paths, enhance_prompt, seed))
        if self.raise_on_music is not None:
            raise self.raise_on_music
        if is_cancelled():
            raise RuntimeError("Generation was cancelled")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / f"fake_wangp_speech_{uuid.uuid4().hex[:8]}.wav"
        with wave.open(str(output_path), "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8_000); output.writeframes(b"\x00\x00" * 800)
        on_progress("generating_speech", 100)
        return str(output_path)

    def enhance_prompt(
        self,
        *,
        prompt: str,
        mode: str,
        model_type: str,
        image_path: str | None = None,
        end_image_path: str | None = None,
        control_image_path: str | None = None,
        reference_image_paths: list[str] | None = None,
        duration_seconds: float | None = None,
    ) -> str:
        self.enhance_prompt_calls.append(
            FakeWangpEnhancePromptCall(
                prompt=prompt,
                mode=mode,
                model_type=model_type,
                image_path=image_path,
                end_image_path=end_image_path,
                control_image_path=control_image_path,
                reference_image_paths=reference_image_paths,
                duration_seconds=duration_seconds,
            )
        )
        if self.raise_on_enhance_prompt is not None:
            raise self.raise_on_enhance_prompt
        return f"enhanced: {prompt}"

    @staticmethod
    def compute_num_frames(duration_seconds: int, fps: int) -> int:
        return max(((duration_seconds * fps) // 8) * 8 + 1, 9)


def build_fake_wangp_bridge(
    *,
    output_dir: Path,
    image_model_type: str = "z_image",
    video_model_type: str = "ltx2_25_22B_distilled",
) -> FakeWanGPBridge:
    """Construct a default-available fake bridge bound to ``output_dir``."""
    return FakeWanGPBridge(
        enabled=True,
        available=True,
        root=None,
        python_executable=None,
        config_dir=output_dir,
        output_dir=output_dir,
        video_model_type=video_model_type,
        image_model_type=image_model_type,
        camera_motion_prompts={},
        extra_args=(),
    )
