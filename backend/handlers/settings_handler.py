"""Settings state mutations and persistence."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from threading import RLock

from pydantic import ValidationError

from _routes._errors import HTTPError
from state.app_settings import AppSettings, UpdateSettingsRequest
from handlers._settings_utils import (
    collect_changed_paths,
    deep_merge_dicts,
    ensure_json_object,
    migrate_legacy_settings,
    strip_none_values,
)
from handlers.base import StateHandlerBase, with_state_lock
from state.app_state_types import AppState

logger = logging.getLogger(__name__)


class SettingsHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, settings_file: Path) -> None:
        super().__init__(state, lock)
        self._settings_file = settings_file

    @with_state_lock
    def load_settings(self, default_settings: AppSettings) -> AppSettings:
        if self._settings_file.exists():
            try:
                with open(self._settings_file, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                migrated = migrate_legacy_settings(ensure_json_object(payload))
                merged = deep_merge_dicts(
                    ensure_json_object(default_settings.model_dump(by_alias=False)),
                    migrated,
                )
                loaded = AppSettings.model_validate(merged)
                logger.info("Settings loaded from %s", self._settings_file)
                self.state.app_settings = loaded
                return loaded
            except Exception as exc:
                logger.warning("Could not load settings: %s", exc, exc_info=True)

        self.state.app_settings = default_settings.model_copy(deep=True)
        return self.state.app_settings

    def save_settings(self) -> None:
        try:
            payload = self.get_settings_snapshot().model_dump(by_alias=False)
            with open(self._settings_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
        except Exception as exc:
            logger.warning("Could not save settings: %s", exc, exc_info=True)

    @with_state_lock
    def get_settings_snapshot(self) -> AppSettings:
        return self.state.app_settings.model_copy(deep=True)

    @with_state_lock
    def update_settings(self, patch: UpdateSettingsRequest) -> tuple[AppSettings, AppSettings, set[str]]:
        patch_payload = strip_none_values(ensure_json_object(patch.model_dump(by_alias=False, exclude_unset=True)))

        before = self.state.app_settings.model_copy(deep=True)
        before_payload = ensure_json_object(before.model_dump(by_alias=False))

        if patch_payload:
            if patch_payload.get("custom_finetunes"):
                raise HTTPError(422, "Custom finetunes are no longer supported.")
            merged_payload = deep_merge_dicts(before_payload, patch_payload)
            if "custom_finetunes" in patch_payload:
                merged_payload["custom_finetunes"] = patch_payload["custom_finetunes"]
            try:
                updated_settings = AppSettings.model_validate(merged_payload)
            except ValidationError as exc:
                detail = str(exc.errors(include_url=False)[0]["msg"])
                raise HTTPError(422, detail) from exc
            self.state.app_settings = updated_settings

        after = self.state.app_settings.model_copy(deep=True)
        after_payload = ensure_json_object(after.model_dump(by_alias=False))

        changed_paths = collect_changed_paths(before_payload, after_payload)
        self.save_settings()
        return before, after, changed_paths

