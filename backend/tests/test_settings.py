"""Tests for GET /api/settings and POST /api/settings."""

from __future__ import annotations

import json

import pytest

from pydantic import ValidationError

from state.app_settings import AppSettings, OutputSettings, UpdateSettingsRequest
from state import build_initial_state
from app_handler import ServiceBundle
from tests.fakes.services import FakeServices


class TestGetSettings:
    def test_default_settings(self, client, default_app_settings):
        r = client.get("/api/settings")
        assert r.status_code == 200
        data = r.json()
        assert data["uiTheme"] == "dark"
        assert data["useTorchCompile"] is False
        assert data["attentionMode"] == "auto"
        assert data["performanceProfile"] == 4
        assert data["reduceVram"] == "disabled"
        assert data["loadOnStartup"] is False
        assert data["useLocalTextEncoder"] is False
        assert data["fastModel"] == {"useUpscaler": True}
        assert data["proModel"] == {"steps": 20, "useUpscaler": True}
        assert data["promptCacheSize"] == 100
        assert data["promptEnhancerEnabledT2V"] is True
        assert data["promptEnhancerEnabledI2V"] is False
        assert data["seedLocked"] is False
        assert data["lockedSeed"] == 42
        assert data["outputSettings"]["videoContainer"] == "mp4"
        assert data["outputSettings"]["videoCodec"] == "libx264_8"
        assert data["outputSettings"]["imageCodec"] == "jpeg"
        assert data["outputSettings"]["imageQuality"] == 95
        assert data["outputSettings"]["audioCodec"] == "aac_192"
        assert data["outputSettings"]["metadataMode"] == "metadata"
        assert data["previewSettings"] == {
            "mode": "tae",
            "updateRate": "adaptive",
            "device": "auto",
            "maxEdge": 512,
            "previewFps": 16,
            "webpQuality": 72,
        }
        assert data["quickGenFavouriteWorkflows"] == []
        assert data["customFinetunes"] == {}
        assert "ltxApiKey" not in data
        assert "falApiKey" not in data
        assert "geminiApiKey" not in data

    def test_reflects_changed_settings(self, client, test_state):
        test_state.state.app_settings.use_torch_compile = True
        r = client.get("/api/settings")
        assert r.json()["useTorchCompile"] is True

class TestPostSettings:
    def test_update_ui_theme(self, client, test_state):
        response = client.post("/api/settings", json={"uiTheme": "light"})

        assert response.status_code == 200
        assert test_state.state.app_settings.ui_theme == "light"
        saved = json.loads(test_state.config.settings_file.read_text(encoding="utf-8"))
        assert saved["ui_theme"] == "light"

    def test_invalid_ui_theme_is_rejected_without_mutation(self, client, test_state):
        response = client.post("/api/settings", json={"uiTheme": "system"})

        assert response.status_code == 422
        assert test_state.state.app_settings.ui_theme == "dark"

    def test_update_single_field(self, client, test_state):
        r = client.post("/api/settings", json={"useTorchCompile": True})
        assert r.status_code == 200
        assert test_state.state.app_settings.use_torch_compile is True

    def test_custom_finetunes_are_rejected_but_legacy_settings_remain_inert(self, client, test_state):
        legacy = {"z_image_turbo": r"E:\Models\z-image.safetensors"}
        test_state.state.app_settings.custom_finetunes = legacy
        response = client.post(
            "/api/settings",
            json={
                "customFinetunes": {
                    "ltx2_25_quality": r"E:\Models\ltx-quality.safetensors",
                    "z_image_turbo": r"E:\Models\z-image.safetensors",
                }
            },
        )
        assert response.status_code == 422
        assert test_state.state.app_settings.custom_finetunes == legacy

    def test_update_multiple_fields(self, client, test_state):
        r = client.post("/api/settings", json={"useTorchCompile": True, "loadOnStartup": True})
        assert r.status_code == 200
        assert test_state.state.app_settings.use_torch_compile is True
        assert test_state.state.app_settings.load_on_startup is True

    def test_update_runtime_preferences(self, client, test_state, wangp_bridge):
        r = client.post(
            "/api/settings",
            json={
                "attentionMode": "sage2",
                "performanceProfile": 4.5,
                "reduceVram": "2",
            },
        )

        assert r.status_code == 200
        assert test_state.state.app_settings.attention_mode == "sage2"
        assert test_state.state.app_settings.performance_profile == 4.5
        assert test_state.state.app_settings.reduce_vram == "2"
        assert wangp_bridge.runtime_preferences == {
            "attention_mode": "sage2",
            "performance_profile": 4.5,
            "reduce_vram": "2",
        }

    @pytest.mark.parametrize("mode", ["rgb", "tae", "tiny_vae_frames"])
    def test_update_preview_settings(self, client, test_state, wangp_bridge, mode):
        r = client.post(
            "/api/settings",
            json={
                "previewSettings": {
                    "mode": mode,
                    "updateRate": "every_2",
                    "device": "cpu",
                    "maxEdge": 768,
                    "previewFps": 8,
                    "webpQuality": 85,
                },
            },
        )

        assert r.status_code == 200
        assert wangp_bridge.preview_options == {
            "mode": mode,
            "update_rate": "every_2",
            "device": "cpu",
            "max_edge": 768,
            "preview_fps": 8,
            "webp_quality": 85,
        }

    def test_invalid_runtime_preference_rejected(self, client):
        r = client.post("/api/settings", json={"reduceVram": "4"})

        assert r.status_code == 422

    def test_update_fast_model(self, client, test_state):
        r = client.post("/api/settings", json={"fastModel": {"useUpscaler": False}})
        assert r.status_code == 200
        assert test_state.state.app_settings.fast_model.use_upscaler is False

    def test_update_pro_model(self, client, test_state):
        r = client.post("/api/settings", json={"proModel": {"steps": 30, "useUpscaler": False}})
        assert r.status_code == 200
        assert test_state.state.app_settings.pro_model.steps == 30
        assert test_state.state.app_settings.pro_model.use_upscaler is False

    def test_deep_partial_patch_preserves_nested_fields(self, client, test_state):
        assert test_state.state.app_settings.pro_model.use_upscaler is True
        r = client.post("/api/settings", json={"proModel": {"steps": 30}})
        assert r.status_code == 200
        assert test_state.state.app_settings.pro_model.steps == 30
        assert test_state.state.app_settings.pro_model.use_upscaler is True

    def test_prompt_cache_size_clamped_max(self, client, test_state):
        r = client.post("/api/settings", json={"promptCacheSize": 5000})
        assert r.status_code == 200
        assert test_state.state.app_settings.prompt_cache_size <= 1000

    def test_prompt_cache_size_clamped_min(self, client, test_state):
        r = client.post("/api/settings", json={"promptCacheSize": -10})
        assert r.status_code == 200
        assert test_state.state.app_settings.prompt_cache_size >= 0

    def test_locked_seed_clamped_range(self, client, test_state):
        r = client.post("/api/settings", json={"lockedSeed": 9_999_999_999})
        assert r.status_code == 200
        assert test_state.state.app_settings.locked_seed == 2_147_483_647

    def test_favourite_workflows_are_bounded_and_persisted(self, client, test_state):
        favourites = [f"video:tool:{index}" for index in range(40)]
        response = client.post(
            "/api/settings",
            json={"quickGenFavouriteWorkflows": favourites},
        )

        assert response.status_code == 200
        assert test_state.state.app_settings.quick_gen_favourite_workflows == favourites[:32]

    def test_unknown_field_rejected(self, client):
        r = client.post("/api/settings", json={"unknownSetting": True})
        assert r.status_code == 422

    def test_update_output_settings(self, client, test_state):
        r = client.post(
            "/api/settings",
            json={
                "outputSettings": {
                    "videoContainer": "mov",
                    "videoCodec": "prores_422",
                    "imageCodec": "webp_lossless",
                    "audioCodec": "aac_320",
                    "metadataMode": "json",
                    "keepIntermediateSlidingWindows": True,
                },
            },
        )
        assert r.status_code == 200
        output = test_state.state.app_settings.output_settings
        assert output.video_container == "mov"
        assert output.video_codec == "prores_422"
        assert output.image_codec == "webp_lossless"
        assert output.audio_codec == "aac_320"
        assert output.metadata_mode == "json"
        assert output.keep_intermediate_sliding_windows is True

    def test_output_settings_reject_prores_mp4(self):
        try:
            OutputSettings(videoContainer="mp4", videoCodec="prores_422")
        except ValidationError:
            return
        raise AssertionError("ProRes MP4 should be rejected")

    def test_invalid_output_settings_patch_returns_422_without_mutation(self, client, test_state):
        before = test_state.state.app_settings.output_settings.model_copy(deep=True)

        response = client.post(
            "/api/settings",
            json={"outputSettings": {"videoCodec": "prores_422"}},
        )

        assert response.status_code == 422
        assert test_state.state.app_settings.output_settings == before


class TestSettingsPersistence:
    def _new_state(self, test_state, default_app_settings):
        fake_services = FakeServices()
        bundle = ServiceBundle(
            gpu_info=fake_services.gpu_info,
        )
        return build_initial_state(test_state.config, default_app_settings.model_copy(deep=True), service_bundle=bundle)

    def test_load_settings_clamps_from_disk(self, test_state, default_app_settings):
        test_state.config.settings_file.write_text(
            json.dumps(
                {
                    "prompt_cache_size": 5000,
                    "locked_seed": -55,
                    "pro_model": {"steps": 999},
                }
            ),
            encoding="utf-8",
        )

        loaded = self._new_state(test_state, default_app_settings)
        assert loaded.state.app_settings.prompt_cache_size == 1000
        assert loaded.state.app_settings.locked_seed == 0
        assert loaded.state.app_settings.pro_model.steps == 100

    def test_existing_settings_without_preview_options_use_tae_defaults(
        self, test_state, default_app_settings
    ):
        test_state.config.settings_file.write_text(
            json.dumps({"use_torch_compile": True}), encoding="utf-8"
        )

        loaded = self._new_state(test_state, default_app_settings)

        assert loaded.state.app_settings.preview_settings.model_dump() == {
            "mode": "tae",
            "update_rate": "adaptive",
            "device": "auto",
            "max_edge": 512,
            "preview_fps": 16,
            "webp_quality": 72,
        }

    def test_existing_settings_without_ui_theme_use_dark_default(self, test_state, default_app_settings):
        test_state.config.settings_file.write_text(
            json.dumps({"use_torch_compile": True}), encoding="utf-8"
        )

        loaded = self._new_state(test_state, default_app_settings)

        assert loaded.state.app_settings.ui_theme == "dark"

    def test_persisted_light_theme_reloads(self, test_state, default_app_settings):
        test_state.config.settings_file.write_text(
            json.dumps({"ui_theme": "light"}), encoding="utf-8"
        )

        loaded = self._new_state(test_state, default_app_settings)

        assert loaded.state.app_settings.ui_theme == "light"

    def test_legacy_prompt_enhancer_key_migrates(self, test_state, default_app_settings):
        test_state.config.settings_file.write_text(
            json.dumps({"prompt_enhancer_enabled": False}),
            encoding="utf-8",
        )

        loaded = self._new_state(test_state, default_app_settings)
        assert loaded.state.app_settings.prompt_enhancer_enabled_t2v is False
        assert loaded.state.app_settings.prompt_enhancer_enabled_i2v is False

    def test_legacy_api_secrets_are_removed_on_save(self, test_state, default_app_settings):
        test_state.config.settings_file.write_text(
            json.dumps(
                {
                    "ltxApiKey": "secret",
                    "fal_api_key": "secret",
                    "geminiApiKey": "secret",
                    "userPrefersLtxApiVideoGenerations": True,
                    "seed_locked": True,
                }
            ),
            encoding="utf-8",
        )

        loaded = self._new_state(test_state, default_app_settings)
        loaded.settings.save_settings()
        saved = json.loads(test_state.config.settings_file.read_text(encoding="utf-8"))
        assert "ltx_api_key" not in saved
        assert "fal_api_key" not in saved
        assert "gemini_api_key" not in saved
        assert "user_prefers_ltx_api_video_generations" not in saved
        assert saved["seed_locked"] is True


class TestSettingsSchemaDrift:
    def test_update_request_tracks_app_settings_fields(self):
        assert set(AppSettings.model_fields) == set(UpdateSettingsRequest.model_fields)
