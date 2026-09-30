"""Prompt enhancement handler."""

from __future__ import annotations

from pathlib import Path
from threading import RLock

from _routes._errors import HTTPError
from api_types import EnhancePromptRequest, EnhancePromptResponse
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from model_profiles.profiles import get_image_profile, get_video_profile
from runtime_config.runtime_config import RuntimeConfig
from services.wangp_bridge import WanGPBridge
from state.app_state_types import AppState


class PromptEnhancementHandler(StateHandlerBase):
    def __init__(
        self,
        *,
        state: AppState,
        lock: RLock,
        generation_handler: GenerationHandler,
        config: RuntimeConfig,
        wangp_bridge: WanGPBridge,
    ) -> None:
        super().__init__(state=state, lock=lock)
        self._generation = generation_handler
        self._config = config
        self._wangp_bridge = wangp_bridge

    def enhance(self, req: EnhancePromptRequest) -> EnhancePromptResponse:
        with self._generation.helper_lane():
            return self._enhance(req)

    def _enhance(self, req: EnhancePromptRequest) -> EnhancePromptResponse:
        for image_path in [req.inputImagePath, req.endImagePath, req.controlImagePath, *req.referenceImagePaths]:
            if image_path and not Path(image_path).is_file():
                raise HTTPError(400, f"INPUT_IMAGE_NOT_FOUND: {image_path}")
        model_type = self._resolve_model_type(req)
        try:
            enhanced = self._wangp_bridge.enhance_prompt(
                prompt=req.prompt,
                mode=req.mode,
                model_type=model_type,
                image_path=req.inputImagePath,
                end_image_path=req.endImagePath,
                control_image_path=req.controlImagePath,
                reference_image_paths=req.referenceImagePaths,
                duration_seconds=req.durationSeconds,
            )
        except Exception as exc:
            raise HTTPError(500, str(exc)) from exc

        if not enhanced.strip():
            raise HTTPError(500, "PROMPT_ENHANCEMENT_EMPTY: The local enhancer returned no prompt.")
        return EnhancePromptResponse(prompt=enhanced)

    def _resolve_model_type(self, req: EnhancePromptRequest) -> str:
        if req.mode == "image":
            if req.modelProfileId is None:
                return self._config.wangp_image_model_type
            profile = get_image_profile(req.modelProfileId)
            if profile is None:
                raise HTTPError(400, f"UNKNOWN_MODEL_PROFILE: {req.modelProfileId}")
            if not profile.visible:
                raise HTTPError(400, f"MODEL_PROFILE_HIDDEN: {req.modelProfileId}")
            return profile.wangp_model_type

        if req.modelProfileId is None:
            return self._config.wangp_video_model_type
        profile = get_video_profile(req.modelProfileId)
        if profile is None:
            raise HTTPError(400, f"UNKNOWN_MODEL_PROFILE: {req.modelProfileId}")
        if not profile.visible:
            raise HTTPError(400, f"MODEL_PROFILE_HIDDEN: {req.modelProfileId}")
        return profile.wangp_model_type
