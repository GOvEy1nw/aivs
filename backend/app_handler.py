"""Application state composition root and dependency wiring."""

from __future__ import annotations

import threading
from dataclasses import dataclass

from state.app_settings import AppSettings
from handlers import (
    DirectorGenerationHandler,
    GenerationHandler,
    HealthHandler,
    ImageGenerationHandler,
    ModelProfilesHandler,
    MusicGenerationHandler,
    MediaUpscaleHandler,
    PromptEnhancementHandler,
    RetakeHandler,
    SettingsHandler,
    SfxGenerationHandler,
    SpeechGenerationHandler,
    VideoGenerationHandler,
)
from handlers.generation_queue_handler import GenerationQueueHandler
from runtime_config.runtime_config import RuntimeConfig
from services.wangp_bridge import WanGPBridge
from services.generation_queue_executor import GenerationJobExecutor
from services.generation_queue_store import GenerationQueueStore
from services.interfaces import (
    GpuInfo,
)
from state.app_state_types import AppState, StartupPending


class AppHandler:
    """Composition-only state service exposing typed domain handlers."""

    def __init__(
        self,
        config: RuntimeConfig,
        default_settings: AppSettings,
        gpu_info: GpuInfo,
    ) -> None:
        self.config = config

        # Exposed for tests and diagnostics.
        self.gpu_info = gpu_info
        self.wangp_bridge = WanGPBridge(
            enabled=config.wangp_enabled,
            root=config.wangp_root,
            python_executable=config.wangp_python,
            config_dir=config.wangp_config_dir,
            output_dir=config.outputs_dir,
            video_model_type=config.wangp_video_model_type,
            image_model_type=config.wangp_image_model_type,
            camera_motion_prompts=config.camera_motion_prompts,
            extra_args=config.wangp_extra_args,
            checkpoints_dir=config.wangp_checkpoints_dir,
            loras_dir=config.wangp_loras_dir,
        )

        self._lock = threading.RLock()

        self.state = AppState(
            generation=None,
            startup=StartupPending(message="Not started"),
            app_settings=default_settings.model_copy(deep=True),
        )

        # ============================================================
        # Handlers (wired in dependency order)
        # ============================================================

        self.settings = SettingsHandler(
            state=self.state,
            lock=self._lock,
            settings_file=config.settings_file,
        )
        self.settings.load_settings(default_settings)
        self.wangp_bridge.set_compile_enabled(self.state.app_settings.use_torch_compile)
        self.wangp_bridge.set_runtime_preferences(
            attention_mode=self.state.app_settings.attention_mode,
            performance_profile=self.state.app_settings.performance_profile,
            reduce_vram=self.state.app_settings.reduce_vram,
        )
        preview_settings = self.state.app_settings.preview_settings
        self.wangp_bridge.set_preview_options(
            mode=preview_settings.mode,
        )

        self.generation = GenerationHandler(state=self.state, lock=self._lock)

        self.video_generation = VideoGenerationHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            outputs_dir=config.outputs_dir,
            config=config,
            wangp_bridge=self.wangp_bridge,
        )

        self.director_generation = DirectorGenerationHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            outputs_dir=config.outputs_dir,
            config=config,
            wangp_bridge=self.wangp_bridge,
        )

        self.prompt_enhancement = PromptEnhancementHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            config=config,
            wangp_bridge=self.wangp_bridge,
        )

        self.image_generation = ImageGenerationHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            config=config,
            wangp_bridge=self.wangp_bridge,
        )

        self.music_generation = MusicGenerationHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            outputs_dir=config.outputs_dir,
            wangp_bridge=self.wangp_bridge,
        )

        self.sfx_generation = SfxGenerationHandler(
            state=self.state, lock=self._lock, generation_handler=self.generation,
            outputs_dir=config.outputs_dir, wangp_bridge=self.wangp_bridge,
        )
        self.speech_generation = SpeechGenerationHandler(
            state=self.state, lock=self._lock, generation_handler=self.generation,
            outputs_dir=config.outputs_dir, wangp_bridge=self.wangp_bridge,
        )
        self.media_upscale = MediaUpscaleHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            wangp_bridge=self.wangp_bridge,
        )

        queue_file = config.generation_queue_file or config.settings_file.with_name("generation-queue.json")
        self.generation_queue = GenerationQueueHandler(
            store=GenerationQueueStore(queue_file),
            executor=GenerationJobExecutor(self),
            max_pending=config.generation_queue_max_pending,
        )
        self.state.generation_queue = self.generation_queue.state
        self.generation.set_generation_queue(self.generation_queue)

        self.health = HealthHandler(
            state=self.state,
            lock=self._lock,
            gpu_info=gpu_info,
            config=config,
            use_sage_attention=config.use_sage_attention,
            wangp_bridge=self.wangp_bridge,
        )

        self.retake = RetakeHandler()

        self.model_profiles = ModelProfilesHandler(
            state=self.state,
            lock=self._lock,
            config=config,
            wangp_bridge=self.wangp_bridge,
        )

@dataclass
class ServiceBundle:
    gpu_info: GpuInfo


def build_default_service_bundle(config: RuntimeConfig) -> ServiceBundle:
    """Build real runtime services with lazy heavy imports isolated from tests."""
    from services.gpu_info.gpu_info_impl import GpuInfoImpl
    return ServiceBundle(
        gpu_info=GpuInfoImpl(),
    )


def build_initial_state(
    config: RuntimeConfig,
    default_settings: AppSettings,
    service_bundle: ServiceBundle | None = None,
) -> AppHandler:
    bundle = service_bundle or build_default_service_bundle(config)

    return AppHandler(
        config=config,
        default_settings=default_settings,
        gpu_info=bundle.gpu_info,
    )
