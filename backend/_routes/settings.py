"""Route handlers for GET/POST /api/settings."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from state.app_settings import SettingsResponse, UpdateSettingsRequest, to_settings_response
from api_types import StatusResponse
from state import get_state_service
from app_handler import AppHandler

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings", response_model=SettingsResponse)
def route_get_settings(handler: AppHandler = Depends(get_state_service)) -> SettingsResponse:
    return to_settings_response(handler.settings.get_settings_snapshot())


@router.post("/settings", response_model=StatusResponse)
def route_post_settings(
    req: UpdateSettingsRequest,
    handler: AppHandler = Depends(get_state_service),
) -> StatusResponse:
    _, _after, changed_paths = handler.settings.update_settings(req)
    changed_roots = {path.split(".", 1)[0] for path in changed_paths}
    if "use_torch_compile" in changed_paths:
        handler.wangp_bridge.set_compile_enabled(_after.use_torch_compile)
    if changed_paths & {"attention_mode", "performance_profile", "reduce_vram"}:
        handler.wangp_bridge.set_runtime_preferences(
            attention_mode=_after.attention_mode,
            performance_profile=_after.performance_profile,
            reduce_vram=_after.reduce_vram,
        )
    if "preview_settings" in changed_roots:
        handler.wangp_bridge.set_preview_options(
            mode=_after.preview_settings.mode,
        )

    logger.info(
        "Applied settings patch (changed=%s)",
        ", ".join(sorted(changed_roots)) if changed_roots else "none",
    )

    return StatusResponse(status="ok")
