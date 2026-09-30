"""Bridge AiVS requests to WanGP's in-process session API."""

from __future__ import annotations

import importlib
import inspect
import json
import logging
import math
import os
import re
import sys
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import chdir
from dataclasses import dataclass
from numbers import Real
from pathlib import Path
from queue import Empty, SimpleQueue
from typing import Any, cast

from services.wangp_downloads import download_context, download_progress, session_downloads
from services.wangp_profiles import resolve_profiles

logger = logging.getLogger(__name__)
AUDIO_PROFILE_THREE_PLUS = 3.5
CUSTOM_FINETUNE_CHECKPOINT_KEY = "_aivs_custom_checkpoint"
_LOCAL_LLM_ENGINES = {"deepy": "qwen35_4b"}
_PROMPT_ENHANCER_ARGUMENTS = (
    "state", "model_type", "model_def", "prompt_enhancer_modes", "original_prompts",
    "image_start", "original_image_refs", "is_image", "audio_only", "seed", "progress",
    "override_profile",
)


def resolve_audio_performance_profile(global_profile: float) -> float:
    return AUDIO_PROFILE_THREE_PLUS if global_profile == 4.0 else global_profile

ProgressCallback = Callable[..., None]
CancelledCallback = Callable[[], bool]

_VIDEO_RESOLUTION_MAP: dict[str, dict[str, str]] = {
    "512p": {"16:9": "832x480", "9:16": "480x832"},
    "540p": {"16:9": "960x544", "9:16": "544x960"},
    "720p": {"16:9": "1280x704", "9:16": "704x1280"},
    "1080p": {"16:9": "1920x1088", "9:16": "1088x1920"},
    "1440p": {"16:9": "2560x1440", "9:16": "1440x2560"},
    "2160p": {"16:9": "3840x2176", "9:16": "2176x3840"},
}

_QWEN_IMAGE_RESOLUTIONS: tuple[tuple[int, int], ...] = (
    (1328, 1328),
    (1664, 928),
    (928, 1664),
    (1472, 1140),
    (1140, 1472),
    (1536, 1024),
    (1024, 1536),
    (1920, 832),
    (832, 1920),
)
_TQDM_PROGRESS_RE = re.compile(r"(?:(?P<label>.*?):\s+)?(?P<percent>\d{1,3})%\|[^|]*\|\s*(?P<current>\d+)/(?P<total>\d+)")
_SECTION_RE = re.compile(r"(?:sliding\s+window|window|section)\D+(?P<current>\d+)\D+(?:of|/)\D*(?P<total>\d+)", re.IGNORECASE)
_PREVIEW_WRITE_INTERVAL_SECONDS = 0.5


@dataclass(frozen=True)
class WanGPBridgeStatus:
    available: bool
    root: Path | None
    python_executable: str | None
    reason: str | None = None
    session_ready: bool = False


class WanGPBridge:
    def __init__(
        self,
        *,
        enabled: bool,
        root: Path | None,
        python_executable: str | None,
        config_dir: Path,
        output_dir: Path,
        video_model_type: str,
        image_model_type: str,
        camera_motion_prompts: dict[str, str],
        extra_args: Iterable[str] = (),
        checkpoints_dir: Path | None = None,
        loras_dir: Path | None = None,
    ) -> None:
        self._enabled = enabled
        self._root = root
        self._python = python_executable
        self._config_dir = config_dir
        self._output_dir = output_dir
        self._video_model_type = video_model_type
        self._image_model_type = image_model_type
        self._camera_motion_prompts = camera_motion_prompts
        self._extra_args = tuple(extra_args)
        self._session = None
        self._submitted_manifest_once = False
        self._session_lock = threading.Lock()
        self._last_preview_write_at = 0.0
        self._preview_mode = "tiny_vae_video"
        runtime_overrides: dict[str, object] = {}
        if checkpoints_dir is not None:
            runtime_overrides["checkpoints_paths"] = [str(checkpoints_dir.resolve()), "."]
        if loras_dir is not None:
            runtime_overrides["loras_root"] = str(loras_dir.resolve())
        if runtime_overrides:
            self._write_runtime_config(runtime_overrides)

    def set_compile_enabled(self, enabled: bool) -> None:
        with self._session_lock:
            args = [arg for arg in self._extra_args if arg != "--compile"]
            if enabled:
                args.append("--compile")
            self._extra_args = tuple(args)

    def set_preview_options(
        self,
        *,
        mode: str,
    ) -> None:
        if mode not in {"rgb", "tiny_vae_frames", "tiny_vae_video"}:
            raise ValueError(f"Unsupported native preview mode: {mode}")
        with self._session_lock:
            self._preview_mode = mode

    def set_runtime_preferences(
        self,
        *,
        attention_mode: str,
        performance_profile: float,
        reduce_vram: str,
    ) -> None:
        vae_config = 0 if reduce_vram == "disabled" else int(reduce_vram)
        boost = 1 if reduce_vram == "disabled" else 2
        audio_profile = resolve_audio_performance_profile(performance_profile)
        if audio_profile != performance_profile:
            logger.info(
                "WanGP performance profile override for audio: requested=%s effective=%s",
                performance_profile,
                audio_profile,
            )
        with self._session_lock:
            self._write_runtime_config(
                {
                    "attention_mode": attention_mode,
                    "profile": performance_profile,
                    "video_profile": performance_profile,
                    "image_profile": performance_profile,
                    "audio_profile": audio_profile,
                    "vae_config": vae_config,
                    "boost": boost,
                }
            )

    def _write_runtime_config(self, overrides: dict[str, object]) -> None:
        config_path = self._resolve_session_config_path()
        try:
            payload: dict[str, object] = {}
            if config_path.exists():
                loaded = json.loads(config_path.read_text(encoding="utf-8"))
                if not isinstance(loaded, dict):
                    raise ValueError("WanGP config must contain a JSON object")
                payload = cast(dict[str, object], loaded)
            else:
                template = Path(os.environ.get("AIVS_WANGP_CONFIG_TEMPLATE", ""))
                if template.is_file():
                    loaded = json.loads(template.read_text(encoding="utf-8"))
                    if not isinstance(loaded, dict):
                        raise ValueError("WanGP config template must contain a JSON object")
                    payload = cast(dict[str, object], loaded)
            self._merge_config(payload, overrides)
            config_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = config_path.with_name(f".{config_path.name}.tmp")
            temporary_path.write_text(json.dumps(payload, indent=4) + "\n", encoding="utf-8")
            temporary_path.replace(config_path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("Could not update WanGP runtime settings: %s", exc)

    @staticmethod
    def _merge_config(target: dict[str, object], overrides: dict[str, object]) -> None:
        for key, value in overrides.items():
            existing = target.get(key)
            if isinstance(existing, dict) and isinstance(value, dict):
                WanGPBridge._merge_config(cast(dict[str, object], existing), cast(dict[str, object], value))
            else:
                target[key] = value

    def _ensure_local_enhancer_config(self, session: object | None = None) -> None:
        """Keep AiVS prompt enhancement on WanGP's local Qwen engine."""
        self._write_runtime_config({"llm_engines": dict(_LOCAL_LLM_ENGINES)})
        if session is None:
            return
        runtime_accessor = getattr(session, "_ensure_runtime", None)
        if not callable(runtime_accessor):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancement requires session runtime access.")
        runtime = runtime_accessor()
        module = getattr(runtime, "module", None)
        server_config = getattr(module, "server_config", None)
        if not isinstance(server_config, dict):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancement requires a mutable native config.")
        self._merge_config(cast(dict[str, object], server_config), {"llm_engines": dict(_LOCAL_LLM_ENGINES)})

    def _ensure_flashvsr_config(self) -> None:
        """Seed only the missing Media Flow default in AiVS-owned config."""
        config_path = self._resolve_session_config_path()
        try:
            payload: dict[str, object] = {}
            if config_path.exists():
                loaded = json.loads(config_path.read_text(encoding="utf-8"))
                if not isinstance(loaded, dict):
                    raise ValueError("WanGP config must contain a JSON object")
                payload = cast(dict[str, object], loaded)
            else:
                template = Path(os.environ.get("AIVS_WANGP_CONFIG_TEMPLATE", ""))
                if template.is_file():
                    loaded = json.loads(template.read_text(encoding="utf-8"))
                    if not isinstance(loaded, dict):
                        raise ValueError("WanGP config template must contain a JSON object")
                    payload = cast(dict[str, object], loaded)
            spatial = payload.get("spatial_upsamplers")
            if not isinstance(spatial, dict):
                spatial = {}
                payload["spatial_upsamplers"] = spatial
            if "flashvsr" in spatial:
                return
            spatial["flashvsr"] = {"mode": 1, "backend": "auto", "topk_ratio": 0.0}
            config_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = config_path.with_name(f".{config_path.name}.tmp")
            temporary_path.write_text(json.dumps(payload, indent=4) + "\n", encoding="utf-8")
            temporary_path.replace(config_path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("Could not seed FlashVSR runtime settings: %s", exc)

    @property
    def has_session(self) -> bool:
        return self._session is not None

    def _resolve_session_config_path(self) -> Path:
        return self._config_dir / "wgp_config.json"

    def get_status(self) -> WanGPBridgeStatus:
        if not self._enabled:
            return WanGPBridgeStatus(
                available=False,
                root=self._root,
                python_executable=self._python,
                reason="WanGP bridge is disabled",
            )

        if self._root is None:
            return WanGPBridgeStatus(
                available=False,
                root=None,
                python_executable=self._python,
                reason="WanGP root was not resolved",
            )

        wgp_path = self._root / "wgp.py"
        if not wgp_path.exists():
            return WanGPBridgeStatus(
                available=False,
                root=self._root,
                python_executable=self._python,
                reason=f"Missing {wgp_path}",
            )

        api_path = self._root / "shared" / "api.py"
        if not api_path.exists():
            return WanGPBridgeStatus(
                available=False,
                root=self._root,
                python_executable=self._python,
                reason=f"Missing {api_path}",
            )

        try:
            self._load_api_module()
        except Exception as exc:
            return WanGPBridgeStatus(
                available=False,
                root=self._root,
                python_executable=self._python,
                reason=f"Unable to import WanGP API: {exc}",
            )

        return WanGPBridgeStatus(
            available=True,
            root=self._root,
            python_executable=self._python,
            session_ready=self._session is not None,
        )

    def preload_session(self) -> None:
        if not self._enabled:
            return
        logger.info("Preloading WanGP session...")
        session = self._get_session()
        session.ensure_ready()
        logger.info("WanGP runtime preloaded successfully")

    def resolve_profiles(
        self,
        model_type: str,
        *,
        accelerator_profile_id: str | None = None,
        preset_profile_id: str | None = None,
    ) -> dict[str, object]:
        return resolve_profiles(
            self._get_session(),
            model_type,
            accelerator_profile_id=accelerator_profile_id,
            preset_profile_id=preset_profile_id,
        )

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
        is_cancelled: CancelledCallback,
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
        active_model_type = model_type if model_type is not None else self._video_model_type
        resolution = self._map_video_resolution(resolution_label, aspect_ratio)
        merged_prompt = prompt + self._camera_motion_prompts.get(camera_motion, "")
        target_frame_count = video_length_frames if video_length_frames is not None else duration_seconds * fps
        if active_model_type.startswith("minimax_h3_"):
            video_length = self.normalize_h3_frame_count(target_frame_count)
        elif video_length_frames is not None:
            video_length = self.normalize_video_frame_count(video_length_frames)
        else:
            video_length = self.compute_num_frames(duration_seconds, fps)

        settings: dict[str, object] = {
            "model_type": active_model_type,
            "prompt": merged_prompt,
            "multi_prompts_gen_type": "FG",
            "resolution": resolution,
            "num_inference_steps": max(1, steps),
            "video_length": video_length,
            "duration_seconds": duration_seconds,
            "force_fps": fps,
        }
        if default_settings:
            for key, value in default_settings.items():
                settings.setdefault(key, value)
            force_fps = default_settings.get("force_fps")
            if isinstance(force_fps, str) and force_fps in {"auto", "control"}:
                settings["force_fps"] = force_fps
        if active_model_type.startswith("ltx2_"):
            settings["sliding_window_size"] = 481
        if negative_prompt.strip():
            settings["negative_prompt"] = negative_prompt.strip()
        if seed is not None:
            settings["seed"] = seed

        active_start_image_path = start_image_path or image_path
        if active_start_image_path:
            if image_prompt_type and "V" in image_prompt_type:
                settings["video_source"] = str(Path(active_start_image_path).resolve())
            else:
                settings["image_start"] = str(Path(active_start_image_path).resolve())

        if end_image_path:
            settings["image_end"] = str(Path(end_image_path).resolve())

        if reference_image_paths:
            settings["image_refs"] = [str(Path(path).resolve()) for path in reference_image_paths]

        if image_prompt_type:
            settings["image_prompt_type"] = image_prompt_type
        else:
            prompt_type = ""
            if active_start_image_path:
                prompt_type += "S"
            if end_image_path:
                prompt_type += "E"
            if prompt_type:
                settings["image_prompt_type"] = prompt_type

        if control_video_path:
            settings["video_guide"] = str(Path(control_video_path).resolve())
            settings["video_prompt_type"] = video_prompt_type or "VG"
        elif reference_video_paths:
            settings["video_guide"] = str(Path(reference_video_paths[0]).resolve())
            if len(reference_video_paths) > 1:
                settings["video_guide2"] = str(Path(reference_video_paths[1]).resolve())
            if len(reference_video_paths) > 2:
                settings["video_guide3"] = str(Path(reference_video_paths[2]).resolve())
            settings["video_prompt_type"] = video_prompt_type or ("V+-" if len(reference_video_paths) > 1 else "V-")

        if video_guide_outpainting is not None:
            settings["video_guide_outpainting"] = video_guide_outpainting
        if video_guide_outpainting_ratio is not None:
            settings["video_guide_outpainting_ratio"] = video_guide_outpainting_ratio

        if audio_path:
            settings["audio_guide"] = str(Path(audio_path).resolve())
            settings["audio_prompt_type"] = audio_prompt_type or ("K" if control_video_path else "A")
        elif audio_prompt_type:
            settings["audio_prompt_type"] = audio_prompt_type

        if reference_audio_paths:
            settings["audio_guide"] = str(Path(reference_audio_paths[0]).resolve())
            if len(reference_audio_paths) > 1:
                settings["audio_guide2"] = str(Path(reference_audio_paths[1]).resolve())
            if len(reference_audio_paths) > 2:
                settings["audio_guide3"] = str(Path(reference_audio_paths[2]).resolve())
            settings["audio_prompt_type"] = audio_prompt_type or ("ABD" if len(reference_audio_paths) > 2 else "AB" if len(reference_audio_paths) > 1 else "A")

        if h3_video_excerpt_positions or h3_audio_excerpt_positions:
            custom_settings = settings.get("custom_settings")
            settings["custom_settings"] = cast(dict[str, object], custom_settings) if isinstance(custom_settings, dict) else {}
            if h3_video_excerpt_positions:
                settings["custom_settings"]["h3_video_excerpt_positions"] = " ".join(h3_video_excerpt_positions)
            if h3_audio_excerpt_positions:
                settings["custom_settings"]["h3_audio_excerpt_positions"] = " ".join(h3_audio_excerpt_positions)

        return self._submit_video_settings(
            settings=settings,
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )

    def ensure_style_lora(
        self,
        *,
        source_url: str,
        model_type: str,
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
    ) -> None:
        if is_cancelled():
            raise RuntimeError("Generation was cancelled")
        on_progress(
            "downloading_model",
            3,
            None,
            None,
            None,
            None,
            None,
            None,
            "Downloading selected style",
        )
        session = self._get_session()
        runtime = session._ensure_runtime()

        def download(gen: dict[str, Any]) -> None:
            runtime.module.download_models(
                "", model_type, file_type=1, model_def={"loras": [source_url]}, gen=gen,
            )

        if self._root is None:
            raise RuntimeError("WanGP runtime is unavailable")
        self._run_native_download(
            runtime_root=self._root,
            download=download,
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )

    def _run_native_download(
        self,
        *,
        runtime_root: Path,
        download: Callable[[dict[str, Any]], None],
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
    ) -> None:
        updates: SimpleQueue[object] = SimpleQueue()
        cancelled = threading.Event()

        def run() -> None:
            with chdir(runtime_root):
                download(download_context(updates.put, cancelled.is_set))

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(run)
            while True:
                if is_cancelled():
                    cancelled.set()
                done, _ = wait((future,), timeout=0.2)
                self._emit_download_updates(updates, on_progress)
                if done:
                    future.result()
                    break
        if is_cancelled():
            raise RuntimeError("Generation was cancelled")

    def generate_director_video(
        self,
        *,
        settings: dict[str, object],
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
    ) -> str:
        return self._submit_video_settings(
            settings=settings,
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )

    def _submit_video_settings(
        self,
        *,
        settings: dict[str, object],
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
    ) -> str:
        effective_settings = dict(settings)
        model_type = effective_settings.get("model_type")
        if isinstance(model_type, str) and model_type.startswith("ltx"):
            effective_settings["config"] = ""
        outputs = self._run_manifest(
            manifest=[{"id": 1, "params": effective_settings, "plugin_data": {}}],
            media_suffixes={".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a"},
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )
        if not outputs:
            raise RuntimeError("WanGP completed without producing a video")
        return self._select_final_output(outputs)

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
        is_cancelled: CancelledCallback,
        model_type: str | None = None,
        default_settings: dict[str, object] | None = None,
    ) -> list[str]:
        active_model_type = model_type if model_type is not None else self._image_model_type
        mapped_width, mapped_height = self._map_image_resolution(width, height, active_model_type)
        normalized_steps = self._normalize_image_steps(num_steps, active_model_type)
        settings: dict[str, object] = {
            "model_type": active_model_type,
            "prompt": prompt,
            "multi_prompts_gen_type": "FG",
            "resolution": f"{mapped_width}x{mapped_height}",
            "num_inference_steps": normalized_steps,
            "batch_size": max(1, num_images),
        }
        # Merge model-default settings first (e.g. Krea's image_mode=1,
        # guidance_scale=0), then apply AiVS's own image_mode default only
        # when the profile hasn't already supplied one — so a curated
        # profile's defaults can never be silently overwritten.
        if default_settings:
            for key, value in default_settings.items():
                settings.setdefault(key, value)
        settings.setdefault("image_mode", 1)
        if seed is not None:
            settings["seed"] = seed

        outputs = self._run_manifest(
            manifest=[{"id": 1, "params": settings, "plugin_data": {}}],
            media_suffixes={".png", ".jpg", ".jpeg", ".webp"},
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )
        if not outputs:
            raise RuntimeError("WanGP completed without producing any images")
        return outputs

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
        is_cancelled: CancelledCallback,
    ) -> str:
        settings: dict[str, object] = dict(default_settings or {})
        settings.update({
            "model_type": model_type,
            "prompt": lyrics,
            "alt_prompt": description,
            "duration_seconds": duration_seconds,
            "audio_prompt_type": audio_prompt_type,
            "repeat_generation": 1,
            "multi_prompts_gen_type": "FG",
            "model_mode": model_mode,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "alt_guidance_scale": lm_guidance_scale,
        })

        custom_settings: dict[str, object] = {}
        if bpm is not None:
            custom_settings["bpm"] = bpm
        if key_scale is not None:
            custom_settings["keyscale"] = key_scale
        if time_signature is not None:
            custom_settings["timesignature"] = int(time_signature.split("/", 1)[0])
        if language is not None:
            custom_settings["language"] = language
        settings["custom_settings"] = custom_settings or None
        if source_audio_path is not None:
            settings["audio_guide"] = source_audio_path
        if reference_timbre_path is not None:
            settings["audio_guide2"] = reference_timbre_path
        if cover_strength is not None:
            settings["audio_scale"] = cover_strength
        if seed is not None:
            settings["seed"] = seed

        outputs = self._run_manifest(
            manifest=[{"id": 1, "params": settings, "plugin_data": {}}],
            media_suffixes={".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"},
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )
        if not outputs:
            raise RuntimeError("WanGP completed without producing music")
        return self._select_final_output(outputs)

    def generate_sfx(
        self,
        *,
        video_path: str,
        prompt: str,
        negative_prompt: str,
        seed: int | None,
        duration_seconds: int,
        output_path: Path,
        on_progress: ProgressCallback,
    ) -> str:
        """Run WanGP's registered MMAudio processor with an explicit output path."""
        session = self._get_session()
        runtime = session._ensure_runtime()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        on_progress("generating_sfx", 0)
        with self._load_api_module()._pushd(runtime.root):
            processors = importlib.import_module("postprocessing.audio_processors")
            processors.generate_soundtrack(
                "mmaudio",
                video_path=str(Path(video_path).resolve()),
                prompt=prompt,
                negative_prompt=negative_prompt,
                seed=seed if seed is not None else -1,
                duration=duration_seconds,
                output_path=str(output_path.resolve()),
            )
        if not output_path.is_file():
            raise RuntimeError("MMAudio completed without producing sound effects")
        on_progress("generating_sfx", 100)
        return str(output_path.resolve())

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
        is_cancelled: CancelledCallback,
    ) -> str:
        session = self._get_session()
        settings = dict(session.get_default_settings(model_type))
        settings.update(default_settings)
        settings.update({
            "model_type": model_type,
            "prompt": text,
            "prompt_enhancer": "T" if enhance_prompt else "",
            "duration_seconds": 0,
        })
        if len(reference_audio_paths) == 1:
            settings["audio_guide"] = str(Path(reference_audio_paths[0]).resolve())
            settings["audio_prompt_type"] = "A"
        elif len(reference_audio_paths) == 2:
            settings["audio_guide"] = str(Path(reference_audio_paths[0]).resolve())
            settings["audio_guide2"] = str(Path(reference_audio_paths[1]).resolve())
            settings["audio_prompt_type"] = "AB2" if model_type == "index_tts25" else "AB"
        elif len(reference_audio_paths) == 3:
            settings["audio_guide"] = str(Path(reference_audio_paths[0]).resolve())
            settings["audio_guide2"] = str(Path(reference_audio_paths[1]).resolve())
            settings["audio_guide3"] = str(Path(reference_audio_paths[2]).resolve())
            settings["audio_prompt_type"] = "ABD2" if model_type == "index_tts25" else "ABD"
        if seed is not None:
            settings["seed"] = seed
        outputs = self._run_manifest(
            manifest=[{"id": 1, "params": settings, "plugin_data": {}}],
            media_suffixes={".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"},
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )
        if not outputs:
            raise RuntimeError("WanGP completed without producing speech audio")
        return self._select_final_output(outputs)

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
        idea = lyrics_prompt.strip() if lyrics_prompt else description
        prompt = (
            f"Lyrics idea:\n{idea}\n\n"
            f"Song description:\n{description}\n\n"
            f"Language:\n{language}\n\n"
            f"Target duration:\n{duration_seconds} seconds\n\n"
            "Write complete, singable lyrics with suitable section headers. "
            "Return lyrics only."
        )
        lyrics = self._run_prompt_enhancer(
            prompt=prompt,
            model_type=model_type,
            mode="audio",
            image_path=None,
            think=think,
            seed=seed,
        ).strip()
        if not lyrics or lyrics.casefold() == "[instrumental]":
            raise RuntimeError("WanGP did not produce usable lyrics")
        lowered = lyrics.casefold()
        if lowered.startswith(("here are", "here's", "sure,")):
            raise RuntimeError("WanGP returned explanatory text instead of lyrics")
        if len(lyrics) > 4096:
            raise RuntimeError("WanGP lyrics exceed the supported 4096 character limit")
        return lyrics

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
        return self._run_prompt_enhancer(
            prompt=prompt,
            mode=mode,
            model_type=model_type,
            image_path=image_path,
            end_image_path=end_image_path,
            control_image_path=control_image_path,
            reference_image_paths=reference_image_paths,
            duration_seconds=duration_seconds,
        )

    def _run_prompt_enhancer(
        self,
        *,
        prompt: str,
        mode: str,
        model_type: str,
        image_path: str | None,
        end_image_path: str | None = None,
        control_image_path: str | None = None,
        reference_image_paths: list[str] | None = None,
        duration_seconds: float | None = None,
        think: bool = False,
        seed: int | None = None,
    ) -> str:
        session = self._get_session()
        self._ensure_local_enhancer_config(session)
        runtime_accessor = getattr(session, "_ensure_runtime", None)
        if not callable(runtime_accessor):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancement requires session runtime access.")
        runtime = runtime_accessor()
        runtime_root = getattr(runtime, "root", None)
        module = getattr(runtime, "module", None)
        state = getattr(session, "_state", None)
        enhancer = getattr(module, "exec_prompt_enhancer_engine", None)
        normalize = getattr(module, "normalize_generated_prompt_lines", None)
        get_model_def = getattr(module, "get_model_def", None)
        if not isinstance(state, dict) or not callable(enhancer) or not callable(normalize) or not callable(get_model_def):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancement API is unavailable.")
        try:
            parameters = tuple(inspect.signature(enhancer).parameters)
        except (TypeError, ValueError) as exc:
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancer signature cannot be verified.") from exc
        if parameters[:len(_PROMPT_ENHANCER_ARGUMENTS)] != _PROMPT_ENHANCER_ARGUMENTS or "enhancer_kwargs" not in parameters:
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancer signature is incompatible.")
        has_images = bool(image_path or end_image_path or control_image_path or reference_image_paths)
        prompt_enhancer = ("TI" if has_images else "T") + ("K" if think else "")
        image_start = [str(Path(image_path).resolve())] if image_path else [None]
        is_image = mode == "image"

        class _PromptEnhanceProgress:
            def __call__(self, *args: object, **kwargs: object) -> None:
                return None

        if not isinstance(runtime_root, Path):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancement runtime has no source root.")
        with chdir(runtime_root):
            model_def_value = get_model_def(model_type)
            if not isinstance(model_def_value, dict):
                raise RuntimeError(f"Unknown WanGP model_type: {model_type}")
            model_def = cast(dict[str, object], model_def_value)
            enhancer_context: dict[str, object] = {
                "image_prompt_type": ("S" if image_path else "") + ("E" if end_image_path else ""),
                "video_prompt_type": ("I" if reference_image_paths else "") + ("V" if control_image_path else ""),
                "audio_prompt_type": "",
            }
            context_duration = duration_seconds if mode == "video" else None
            if context_duration is not None and model_def.get("prompt_enhancer_video_duration", False):
                enhancer_context["video_duration_seconds"] = context_duration
            image_refs = None
            if has_images:
                from PIL import Image

                native_images = importlib.import_module("shared.prompt_enhancer.images")
                paths_and_labels = (
                    ([(image_path, "start image")] if image_path else [])
                    + ([(end_image_path, "end image")] if end_image_path else [])
                    + [(path, f"Image reference no {index + 1}") for index, path in enumerate(reference_image_paths or [])]
                    + ([(control_image_path, "Control Image")] if control_image_path else [])
                )
                images: list[Image.Image] = []
                for path, _ in paths_and_labels:
                    with Image.open(path) as source:
                        images.append(source.copy())
                labels = [label for _, label in paths_and_labels]
                enhancer_context["image_contexts"] = [native_images.ImageContext(images, labels, context_duration)]
                image_start = [images[0]] if image_path else [None]
                image_refs = [image for image, label in zip(images, labels) if label.startswith("Image reference no")]
                if control_image_path:
                    enhancer_context["control_image"] = images[-1]
            enhanced_prompts = enhancer(
                state,
                model_type,
                model_def,
                prompt_enhancer,
                [prompt],
                image_start,
                image_refs,
                is_image,
                bool(model_def.get("audio_only", False)),
                seed if seed is not None else -1,
                _PromptEnhanceProgress(),
                -1,
                enhancer_kwargs=enhancer_context,
            )
            if (
                not isinstance(enhanced_prompts, list)
                or not enhanced_prompts
            ):
                raise RuntimeError("WanGP completed without producing an enhanced prompt")
            prompt_rows = cast(list[object], enhanced_prompts)
            first_row = prompt_rows[0]
            if not isinstance(first_row, (list, tuple)) or not first_row or not isinstance(first_row[0], str):
                raise RuntimeError("WanGP completed without producing an enhanced prompt")
            normalized = normalize(first_row[0], "FG")
            if not isinstance(normalized, str) or not normalized.strip():
                raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: prompt enhancer returned an invalid prompt.")
            return normalized.strip()

    @staticmethod
    def compute_num_frames(duration_seconds: int, fps: int) -> int:
        return max(((duration_seconds * fps) // 8) * 8 + 1, 9)

    @staticmethod
    def normalize_video_frame_count(frame_count: int) -> int:
        return max((max(1, frame_count) // 8) * 8 + 1, 9)

    @staticmethod
    def normalize_h3_frame_count(frame_count: int) -> int:
        """Map to MiniMax H3's 5 + 17n frame grid, with its 107-frame minimum."""
        return max(107, 5 + 17 * round((max(1, frame_count) - 5) / 17))

    def _map_video_resolution(self, resolution_label: str, aspect_ratio: str) -> str:
        if re.fullmatch(r"\d+x\d+", resolution_label):
            return resolution_label
        per_aspect = _VIDEO_RESOLUTION_MAP.get(resolution_label)
        if per_aspect is None:
            raise RuntimeError(f"Unsupported WanGP video resolution: {resolution_label}")
        mapped = per_aspect.get(aspect_ratio)
        if mapped is None:
            raise RuntimeError(f"Unsupported WanGP aspect ratio: {aspect_ratio}")
        return mapped

    def _map_image_resolution(self, width: int, height: int, model_type: str | None = None) -> tuple[int, int]:
        active_model_type = model_type if model_type is not None else self._image_model_type
        if "qwen_image" not in active_model_type:
            return width, height

        requested_ratio = width / max(height, 1)

        def score(candidate: tuple[int, int]) -> tuple[float, float]:
            candidate_ratio = candidate[0] / candidate[1]
            ratio_delta = abs(candidate_ratio - requested_ratio)
            area_delta = abs((candidate[0] * candidate[1]) - (width * height))
            return (ratio_delta, area_delta)

        mapped = min(_QWEN_IMAGE_RESOLUTIONS, key=score)
        if mapped != (width, height):
            logger.info(
                "Adjusted Qwen image resolution from %sx%s to native preset %sx%s",
                width,
                height,
                mapped[0],
                mapped[1],
            )
        return mapped

    def _normalize_image_steps(self, num_steps: int, model_type: str | None = None) -> int:
        active_model_type = model_type if model_type is not None else self._image_model_type
        normalized_steps = max(1, num_steps)
        if not active_model_type.startswith("z_image"):
            return normalized_steps

        adjusted_steps = max(8, normalized_steps)
        if adjusted_steps != normalized_steps:
            logger.info(
                "Adjusted %s inference steps from %s to %s",
                active_model_type,
                normalized_steps,
                adjusted_steps,
            )
        return adjusted_steps

    def _load_api_module(self):
        if self._root is None:
            raise RuntimeError("WanGP root is not configured")
        root_str = str(self._root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)
        module = importlib.import_module("shared.api")
        module_file = module.__file__
        if module_file is None:
            raise RuntimeError("shared.api module has no __file__ path")
        module_path = Path(module_file).resolve()
        expected_path = (self._root / "shared" / "api.py").resolve()
        if module_path != expected_path:
            raise RuntimeError(f"shared.api resolved to {module_path}, expected {expected_path}")
        return module

    def _get_session(self):
        status = self.get_status()
        if not status.available or status.root is None:
            raise RuntimeError(status.reason or "WanGP bridge is unavailable")

        with self._session_lock:
            if self._session is None:
                self._ensure_flashvsr_config()
                self._ensure_local_enhancer_config()
                self._write_runtime_config(
                    {
                        "fit_canvas": 0,
                        "enhancer_mode": 0,
                    }
                )
                api_module = self._load_api_module()
                self._session = api_module.WanGPSession(
                    root=status.root,
                    config_path=self._resolve_session_config_path(),
                    output_dir=self._output_dir,
                    cli_args=self._extra_args,
                )
            return self._session

    def upscale_media(
        self,
        *,
        source_path: str,
        spatial_upsampler: str,
        media_kind: str,
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
    ) -> str:
        session = self._get_session()
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._config_dir.mkdir(parents=True, exist_ok=True)
        on_progress("starting_wangp", 2, None, None)
        suffixes = {".png", ".jpg", ".jpeg", ".webp"} if media_kind == "image" else {".mp4", ".mov", ".mkv", ".avi", ".webm"}
        updates: SimpleQueue[object] = SimpleQueue()
        with session_downloads(session, updates.put, lambda: False):
            job = session.submit_media_postprocessing(
                str(Path(source_path).resolve()),
                spatial_upsampling=spatial_upsampler,
                return_media=False,
            )
            outputs = self._wait_for_job(
                job=job,
                media_suffixes=suffixes,
                on_progress=on_progress,
                is_cancelled=is_cancelled,
                download_updates=updates,
            )
        if not outputs:
            raise RuntimeError("WanGP completed without producing upscaled media")
        return self._select_final_output(outputs)

    @staticmethod
    def _download_callback(on_progress: ProgressCallback, model_type: str | None = None) -> Callable[[object], None]:
        def callback(update: object) -> None:
            progress = download_progress(update, model_type)
            if progress is not None:
                on_progress(
                    "downloading_model", 3, None, None, None, None, None, None,
                    "Downloading model", None, progress.filename,
                    round(progress.percent) if progress.percent is not None else None,
                    None, progress.unit, progress,
                )
        return callback

    def _emit_download_updates(self, updates: SimpleQueue[object], on_progress: ProgressCallback) -> None:
        while True:
            try:
                update = updates.get_nowait()
            except Empty:
                return
            self._download_callback(on_progress)(update)

    def _run_manifest(
        self,
        *,
        manifest: list[dict[str, object]],
        media_suffixes: set[str],
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
    ) -> list[str]:
        self._reject_custom_finetune_request(manifest)
        self._manifest_model_type(manifest)
        session = self._get_session()
        self._ensure_local_enhancer_config(session)
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._config_dir.mkdir(parents=True, exist_ok=True)

        startup_phase = "starting_wangp" if not self._submitted_manifest_once else "validating_request"
        self._submitted_manifest_once = True
        on_progress(startup_phase, 2, None, None)
        import json
        self._apply_output_settings(session, manifest)
        self._apply_native_preview_setting(session)
        logger.info("Submitting WanGP manifest: %s", json.dumps(manifest, indent=2))
        updates: SimpleQueue[object] = SimpleQueue()
        with session_downloads(session, updates.put, lambda: False):
            job = session.submit_manifest(manifest)
            outputs = self._wait_for_job(
                job=job,
                media_suffixes=media_suffixes,
                on_progress=on_progress,
                is_cancelled=is_cancelled,
                download_updates=updates,
            )
        return outputs

    @staticmethod
    def _manifest_model_type(manifest: list[dict[str, object]]) -> str:
        if len(manifest) != 1:
            raise RuntimeError(
                "CUSTOM_FINETUNE_MANIFEST_UNSUPPORTED: expected one generation request."
            )
        params_value = manifest[0].get("params")
        params = cast(dict[str, object], params_value) if isinstance(params_value, dict) else None
        model_type = params.get("model_type") if params is not None else None
        if not isinstance(model_type, str):
            raise RuntimeError(
                "WANGP_MODEL_UNAVAILABLE: generation model is unavailable."
            )
        if model_type.startswith("aivs_"):
            raise RuntimeError(
                f"UNSUPPORTED_WANGP_MODEL_TYPE: '{model_type}' is not available in the native WanGP runtime."
            )
        return model_type

    @staticmethod
    def _reject_custom_finetune_request(manifest: list[dict[str, object]]) -> None:
        for item in manifest:
            params_value = item.get("params")
            if isinstance(params_value, dict) and CUSTOM_FINETUNE_CHECKPOINT_KEY in params_value:
                raise RuntimeError("CUSTOM_FINETUNE_UNSUPPORTED: custom finetunes are no longer supported.")

    def _wait_for_job(
        self,
        *,
        job: Any,
        media_suffixes: set[str],
        on_progress: ProgressCallback,
        is_cancelled: CancelledCallback,
        download_updates: SimpleQueue[object] | None = None,
    ) -> list[str]:
        self._last_preview_write_at = 0.0
        error_lines: deque[str] = deque(maxlen=40)
        cancel_requested = False
        console_progress: dict[str, object] = {"phase": "", "progress": -1, "logged_at": 0.0}
        cancel = getattr(job, "cancel", None)
        events = getattr(job, "events", None)
        get_event = getattr(events, "get", None)
        if not callable(cancel) or not callable(get_event) or not isinstance(getattr(job, "done", None), bool):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: generation job API is unavailable.")

        while True:
            if is_cancelled() and not cancel_requested:
                cancel_requested = True
                cancel()

            event = get_event(timeout=0.2)
            if event is not None:
                self._handle_event(event, on_progress, error_lines, console_progress)

            if download_updates is not None:
                self._emit_download_updates(download_updates, on_progress)

            if job.done and event is None:
                break

        result_getter = getattr(job, "result", None)
        if not callable(result_getter):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: generation job has no result API.")
        result = result_getter()

        if cancel_requested or is_cancelled():
            raise RuntimeError("Generation was cancelled")
        success = getattr(result, "success", None)
        errors = getattr(result, "errors", None)
        if not isinstance(success, bool) or not isinstance(errors, list):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: generation result has an invalid shape.")
        if not success:
            structured_errors = self._format_generation_errors(cast(list[object], errors))
            details = " | ".join(error_lines or structured_errors) if (error_lines or structured_errors) else "WanGP generation failed"
            raise RuntimeError(details)
        outputs = getattr(result, "generated_files", None)
        if not isinstance(outputs, list):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: generation result contains invalid output paths.")
        output_paths: list[str] = []
        for output_path in cast(list[object], outputs):
            if not isinstance(output_path, str):
                raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: generation result contains invalid output paths.")
            output_paths.append(output_path)

        filtered_outputs = [
            str(Path(path).resolve())
            for path in output_paths
            if Path(path).suffix.lower() in media_suffixes
        ]
        if not filtered_outputs:
            return []

        on_progress("complete", 100, None, None)
        return self._dedupe_preserve_order(filtered_outputs)

    @staticmethod
    def _format_generation_errors(errors: list[object]) -> list[str]:
        details: list[str] = []
        for error in errors:
            message = getattr(error, "message", None)
            stage = getattr(error, "stage", None)
            if not isinstance(message, str) or not message.strip():
                continue
            prefix = f"{stage}: " if isinstance(stage, str) and stage.strip() else ""
            details.append(f"{prefix}{message.strip()}")
        return details

    def _handle_event(
        self,
        event: Any,
        on_progress: ProgressCallback,
        error_lines: deque[str],
        console_progress: dict[str, object],
    ) -> None:
        kind = getattr(event, "kind", "")
        data = getattr(event, "data", None)

        if kind == "stream":
            stream_name = getattr(data, "stream", "stdout")
            line = str(getattr(data, "text", "")).strip()
            if not line:
                return
            stream_phase = self._classify_stream_phase(line)
            parsed_progress = self._parse_tqdm_progress(line)
            if parsed_progress is None and stream_phase is not None:
                self._emit_console_progress(
                    console_progress,
                    stream_phase,
                    self._estimate_progress(stream_phase, None, None),
                    None,
                    None,
                    line,
                )
            if stream_phase is not None:
                detail = self._parse_progress_detail(line, stream_phase)
                on_progress(
                    stream_phase,
                    self._estimate_progress(stream_phase, None, None),
                    None,
                    None,
                    detail["phase_index"],
                    detail["phase_count"],
                    detail["section_index"],
                    detail["section_count"],
                    line,
                )
            if self._should_capture_error_line(stream_name, line):
                error_lines.append(line)
            return

        if kind == "progress":
            phase = str(getattr(data, "phase", "inference"))
            raw_progress = self._optional_non_negative_int(getattr(data, "progress", 0)) or 0
            current_step = self._optional_non_negative_int(getattr(data, "current_step", None))
            total_steps = self._optional_non_negative_int(getattr(data, "total_steps", None))
            status_text = str(getattr(data, "status", "")).strip()
            progress = self._scale_phase_progress(phase, raw_progress, current_step, total_steps)
            detail = self._parse_progress_detail(status_text, phase)
            self._emit_console_progress(
                console_progress,
                phase,
                progress,
                current_step,
                total_steps,
                status_text,
            )
            on_progress(
                phase,
                progress,
                current_step,
                total_steps,
                detail["phase_index"],
                detail["phase_count"],
                detail["section_index"],
                detail["section_count"],
                status_text or None,
            )
            return

        if kind == "status":
            text = str(data or "").strip()
            if not text:
                return
            logger.info("[WanGP status] %s", text)
            phase = self._classify_phase(text)
            progress = self._estimate_progress(phase, None, None)
            detail = self._parse_progress_detail(text, phase)
            self._emit_console_progress(console_progress, phase, progress, None, None, text, force=True)
            on_progress(
                phase,
                progress,
                None,
                None,
                detail["phase_index"],
                detail["phase_count"],
                detail["section_index"],
                detail["section_count"],
                text,
            )
            return

        if kind == "preview":
            phase = str(getattr(data, "phase", "inference"))
            status_text = str(getattr(data, "status", "")).strip()
            progress = int(getattr(data, "progress", 0))
            current_step = getattr(data, "current_step", None)
            total_steps = getattr(data, "total_steps", None)
            video = getattr(data, "video", None)
            if isinstance(video, bytes) and video:
                video_bytes = video
                video_was_throttled = (
                    time.monotonic() - self._last_preview_write_at < _PREVIEW_WRITE_INTERVAL_SECONDS
                )
                preview_url = self._write_preview_file(
                    ".mp4", lambda preview_path: preview_path.write_bytes(video_bytes)
                )
                if preview_url is None and not video_was_throttled:
                    preview_url = self._write_preview_image(getattr(data, "image", None))
            else:
                preview_url = self._write_preview_image(getattr(data, "image", None))
            detail = self._parse_progress_detail(status_text, phase)
            on_progress(
                phase,
                self._scale_phase_progress(
                    phase,
                    progress,
                    current_step if isinstance(current_step, int) else None,
                    total_steps if isinstance(total_steps, int) else None,
                ),
                current_step if isinstance(current_step, int) else None,
                total_steps if isinstance(total_steps, int) else None,
                detail["phase_index"],
                detail["phase_count"],
                detail["section_index"],
                detail["section_count"],
                status_text or None,
                preview_url,
            )
            return

        if kind == "info":
            text = str(data or "").strip()
            if text:
                logger.info("[WanGP info] %s", text)
            return

        if kind == "error":
            message = str(data)
            if message:
                error_lines.append(message)
                logger.error("[WanGP error] %s", message)
            return

        if kind == "completed":
            if bool(getattr(data, "success", False)):
                self._emit_console_progress(console_progress, "complete", 100, None, None, "Completed", force=True)
                on_progress("complete", 100, None, None)

    @staticmethod
    def _classify_phase(status_text: str) -> str:
        lowered = status_text.lower()
        if "denoising first pass" in lowered or "denoising 1st pass" in lowered:
            return "inference_stage_1"
        if "denoising second pass" in lowered or "denoising 2nd pass" in lowered:
            return "inference_stage_2"
        if "denoising third pass" in lowered or "denoising 3rd pass" in lowered:
            return "inference_stage_3"
        if "checking model files" in lowered:
            return "checking_model_files"
        if "downloading model" in lowered:
            return "downloading_model"
        if "loading model" in lowered or "model loaded" in lowered or lowered.startswith("loading"):
            return "loading_model"
        if "enhancing prompt" in lowered or "encoding" in lowered:
            return "encoding_text"
        if "decoding" in lowered:
            return "decoding"
        if "saved" in lowered or "completed" in lowered or "output" in lowered:
            return "downloading_output"
        if "cancel" in lowered or "abort" in lowered:
            return "cancelled"
        return "inference"

    @staticmethod
    def _optional_non_negative_int(value: object) -> int | None:
        if isinstance(value, bool) or not isinstance(value, Real):
            return None
        number = float(value)
        return int(number) if math.isfinite(number) and number >= 0 else None

    @staticmethod
    def _estimate_progress(phase: str, current_step: int | None, total_steps: int | None) -> int:
        if total_steps is None or total_steps <= 0 or current_step is None:
            if phase == "preparing_model":
                return 4
            if phase == "checking_model_files":
                return 3
            if phase == "downloading_model":
                return 5
            if phase == "loading_model":
                return 10
            if phase == "encoding_text":
                return 18
            if phase == "inference_stage_1":
                return 25
            if phase == "inference_stage_2":
                return 70
            if phase == "inference_stage_3":
                return 80
            if phase == "decoding":
                return 90
            if phase == "downloading_output":
                return 95
            if phase == "cancelled":
                return 0
            return 15
        ratio = max(0.0, min(1.0, current_step / total_steps))
        if phase == "preparing_model":
            return min(6, 2 + int(ratio * 4))
        if phase == "checking_model_files":
            return min(4, 2 + int(ratio * 2))
        if phase == "downloading_model":
            return min(9, 3 + int(ratio * 6))
        if phase == "loading_model":
            return min(15, 5 + int(ratio * 10))
        if phase == "encoding_text":
            return min(22, 12 + int(ratio * 10))
        if phase == "inference_stage_1":
            return min(68, 20 + int(ratio * 48))
        if phase == "inference_stage_2":
            return min(88, 68 + int(ratio * 20))
        if phase == "inference_stage_3":
            return min(89, 80 + int(ratio * 9))
        if phase == "decoding":
            return min(95, 85 + int(ratio * 10))
        if phase == "downloading_output":
            return min(98, 92 + int(ratio * 6))
        if phase == "cancelled":
            return 0
        return min(90, 20 + int(ratio * 65))

    @staticmethod
    def _scale_phase_progress(phase: str, raw_progress: int, current_step: int | None, total_steps: int | None) -> int:
        if total_steps is not None and total_steps > 0 and current_step is not None:
            return WanGPBridge._estimate_progress(phase, current_step, total_steps)

        ratio = max(0.0, min(1.0, raw_progress / 100))
        ranges = {
            "preparing_model": (2, 6),
            "checking_model_files": (2, 4),
            "downloading_model": (3, 9),
            "loading_model": (5, 15),
            "encoding_text": (12, 22),
            "inference": (20, 90),
            "inference_stage_1": (20, 68),
            "inference_stage_2": (68, 88),
            "inference_stage_3": (80, 89),
            "decoding": (85, 95),
            "downloading_output": (92, 98),
        }
        start, end = ranges.get(phase, (15, 90))
        return min(end, start + int((end - start) * ratio))

    @staticmethod
    def _parse_progress_detail(status_text: str, phase: str) -> dict[str, int | None]:
        lowered = status_text.lower()
        phase_index: int | None = None
        phase_count: int | None = None
        if phase == "inference_stage_1" or "first pass" in lowered or "1st pass" in lowered:
            phase_index, phase_count = 1, 2
        elif phase == "inference_stage_2" or "second pass" in lowered or "2nd pass" in lowered:
            phase_index, phase_count = 2, 2
        elif phase == "inference_stage_3" or "third pass" in lowered or "3rd pass" in lowered:
            phase_index, phase_count = 3, 3

        section_index: int | None = None
        section_count: int | None = None
        match = _SECTION_RE.search(status_text)
        if match is not None:
            section_index = int(match.group("current"))
            section_count = int(match.group("total"))

        return {
            "phase_index": phase_index,
            "phase_count": phase_count,
            "section_index": section_index,
            "section_count": section_count,
        }

    @staticmethod
    def _classify_stream_phase(line: str) -> str | None:
        lowered = line.lower()
        if "hf_xet" in lowered or "falling back to regular http download" in lowered:
            return "preparing_model"
        if lowered.startswith("downloading ") or "downloading model" in lowered or "snapshot_download" in lowered:
            return "downloading_model"
        return None

    @staticmethod
    def _parse_tqdm_progress(line: str) -> tuple[int, int | None, int | None, str | None] | None:
        match = _TQDM_PROGRESS_RE.search(line)
        if match is None:
            return None
        label = (match.group("label") or "").strip(" :")
        current_step = int(match.group("current"))
        total_steps = int(match.group("total"))
        return int(match.group("percent")), current_step, total_steps, label or None

    @staticmethod
    def _phase_label(phase: str) -> str:
        labels = {
            "starting_wangp": "Starting WanGP",
            "preparing_model": "Preparing model",
            "checking_model_files": "Checking model files",
            "downloading_model": "Downloading model",
            "loading_model": "Loading model",
            "encoding_text": "Encoding text",
            "inference": "Generating",
            "inference_stage_1": "Generating pass 1",
            "inference_stage_2": "Generating pass 2",
            "inference_stage_3": "Generating pass 3",
            "decoding": "Decoding",
            "downloading_output": "Saving output",
            "complete": "Completed",
            "cancelled": "Cancelled",
        }
        return labels.get(phase, phase.replace("_", " ").title())

    def _emit_console_progress(
        self,
        tracker: dict[str, object],
        phase: str,
        progress: int,
        current_step: int | None,
        total_steps: int | None,
        status_text: str,
        *,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        progress = max(0, min(100, int(progress)))
        last_phase = str(tracker.get("phase", ""))
        raw_progress = tracker.get("progress", -1)
        last_progress = int(raw_progress) if isinstance(raw_progress, (int, float)) else -1
        raw_logged_at = tracker.get("logged_at", 0.0)
        last_logged_at = float(raw_logged_at) if isinstance(raw_logged_at, (int, float)) else 0.0
        if not force and phase == last_phase and progress == last_progress and now - last_logged_at < 1.0:
            return

        tracker["phase"] = phase
        tracker["progress"] = progress
        tracker["logged_at"] = now

        bar_width = 24
        filled = min(bar_width, max(0, round(progress * bar_width / 100)))
        bar = "#" * filled + "-" * (bar_width - filled)
        detail = f" {current_step}/{total_steps}" if current_step is not None and total_steps is not None else ""
        suffix = f" - {status_text}" if status_text else ""
        logger.info("[WanGP progress] [%s] %3d%% %s%s%s", bar, progress, self._phase_label(phase), detail, suffix)

    @staticmethod
    def _should_capture_error_line(stream_name: str, line: str) -> bool:
        lowered = line.lower()
        if line.startswith("Traceback") or line.startswith("File \"") or line.startswith("  File "):
            return True
        if stream_name != "stderr":
            return "[error]" in lowered or "exception" in lowered or "failed" in lowered
        if "%|" in line and "steps/" in lowered:
            return False
        if "| 0/" in line or "| 1/" in line or "| 2/" in line or "| 3/" in line or "| 4/" in line:
            return False
        return "[error]" in lowered or "traceback" in lowered or "exception" in lowered or "failed" in lowered

    @staticmethod
    def _dedupe_preserve_order(values: list[str]) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered

    def _write_preview_image(self, image: object) -> str | None:
        save = getattr(image, "save", None)
        if not callable(save):
            return None
        return self._write_preview_file(
            ".jpg",
            lambda preview_path: save(preview_path, format="JPEG", quality=85),
        )

    def _write_preview_file(
        self,
        suffix: str,
        write: Callable[[Path], object],
    ) -> str | None:
        now = time.monotonic()
        if now - self._last_preview_write_at < _PREVIEW_WRITE_INTERVAL_SECONDS:
            return None
        try:
            preview_path = self._output_dir / f"_wangp_preview_latest{suffix}"
            self._output_dir.mkdir(parents=True, exist_ok=True)
            write(preview_path)
            normalized = str(preview_path.resolve()).replace("\\", "/")
            file_url = (
                f"file:///{normalized}"
                if not normalized.startswith("/")
                else f"file://{normalized}"
            )
            # WanGP reuses one preview filename; query version prevents Electron/browser cache reuse.
            self._last_preview_write_at = now
            return f"{file_url}?v={time.time_ns()}"
        except Exception:
            logger.debug("Could not write WanGP preview media", exc_info=True)
            return None

    @staticmethod
    def _apply_output_settings(session: object, manifest: list[dict[str, object]]) -> None:
        if not manifest:
            return
        params = manifest[0].get("params")
        if not isinstance(params, dict):
            return
        manifest_params = cast(dict[str, object], params)
        output_keys = {
            "video_output_codec",
            "video_container",
            "image_output_codec",
            "audio_output_codec",
            "metadata_type",
            "keep_intermediate_sliding_windows",
        }
        patch: dict[str, object] = {}
        for key in output_keys:
            if key in manifest_params:
                patch[key] = manifest_params.pop(key)
        if not patch:
            return
        try:
            ensure_runtime = getattr(session, "_ensure_runtime")
            runtime = ensure_runtime()
            server_config = getattr(runtime.module, "server_config", None)
            if isinstance(server_config, dict):
                cast(dict[str, object], server_config).update(patch)
        except Exception:
            logger.debug("Could not apply WanGP output settings", exc_info=True)

    def _apply_native_preview_setting(self, session: object) -> None:
        with self._session_lock:
            generation_preview = self._preview_mode
        native_session = cast(Any, session)
        runtime_accessor = getattr(native_session, "_ensure_runtime", None)
        if not callable(runtime_accessor):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: preview configuration requires session runtime access.")
        runtime = runtime_accessor()
        server_config = getattr(getattr(runtime, "module", None), "server_config", None)
        close = getattr(native_session, "close", None)
        if not isinstance(server_config, dict) or not callable(close):
            raise RuntimeError("UNSUPPORTED_WANGP_RUNTIME: preview configuration API is unavailable.")
        typed_server_config = cast(dict[str, object], server_config)
        if typed_server_config.get("generation_preview") == generation_preview:
            return
        close()
        typed_server_config["generation_preview"] = generation_preview

    @staticmethod
    def _select_final_output(outputs: list[str]) -> str:
        if len(outputs) == 1:
            return outputs[0]

        def sort_key(path_text: str) -> tuple[float, int]:
            try:
                return (Path(path_text).stat().st_mtime, len(Path(path_text).name))
            except OSError:
                return (0.0, len(path_text))

        return max(outputs, key=sort_key)
