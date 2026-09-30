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
        assert data["proModel"] == {"steps": 20}
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
            "mode": "tiny_vae_video",
        }
        assert data["quickGenFavouriteWorkflows"] == []
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

    def test_removed_finetune_setting_is_rejected(self, client):
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

    @pytest.mark.parametrize("mode", ["rgb", "tiny_vae_video", "tiny_vae_frames"])
    def test_update_preview_settings(self, client, test_state, wangp_bridge, mode):
        test_state.state.app_settings.preview_settings.mode = "rgb" if mode == "tiny_vae_video" else "tiny_vae_video"
        r = client.post(
            "/api/settings",
            json={
                "previewSettings": {
                    "mode": mode,
                },
            },
        )

        assert r.status_code == 200
        assert wangp_bridge.preview_options == {
            "mode": mode,
        }

    def test_invalid_runtime_preference_rejected(self, client):
        r = client.post("/api/settings", json={"reduceVram": "4"})

        assert r.status_code == 422

    def test_update_pro_model(self, client, test_state):
        r = client.post("/api/settings", json={"proModel": {"steps": 30}})
        assert r.status_code == 200
        assert test_state.state.app_settings.pro_model.steps == 30

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
    @pytest.mark.parametrize("old_mode, expected, warns", [
        ("tae", "tiny_vae_video", False),
        ("off", "rgb", True),
        ("unknown", "rgb", True),
        ("rgb", "rgb", False),
        ("tiny_vae_frames", "tiny_vae_frames", False),
        ("tiny_vae_video", "tiny_vae_video", False),
    ])
    def test_preview_migration_is_persisted_and_notice_does_not_recur(
        self, test_state, default_app_settings, old_mode, expected, warns
    ):
        path = test_state.config.settings_file
        path.write_text(json.dumps({
            "locked_seed": 123,
            "preview_settings": {"mode": old_mode, "device": "cpu", "update_rate": "every_2", "max_edge": 768, "preview_fps": 8, "webp_quality": 85},
        }), encoding="utf-8")
        loaded = test_state.settings.load_settings(default_app_settings)
        assert loaded.preview_settings.mode == expected
        assert bool(loaded.preview_migration_notice) is warns
        assert loaded.locked_seed == 123
        assert json.loads(path.read_text(encoding="utf-8"))["preview_settings"] == {"mode": expected}
        test_state.settings.update_settings(UpdateSettingsRequest.model_validate({"previewMigrationNotice": ""}))
        reloaded = test_state.settings.load_settings(default_app_settings)
        assert reloaded.preview_settings.mode == expected
        assert reloaded.preview_migration_notice == ""
        assert reloaded.locked_seed == 123

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
                    "custom_finetunes": {"legacy": "E:/Models/legacy.safetensors"},
                    "fast_model": {"use_upscaler": False},
                    "use_local_text_encoder": True,
                    "locked_seed": -55,
                    "pro_model": {"steps": 999},
                }
            ),
            encoding="utf-8",
        )

        loaded = self._new_state(test_state, default_app_settings)
        assert loaded.state.app_settings.locked_seed == 0
        assert loaded.state.app_settings.pro_model.steps == 100

    def test_existing_settings_without_preview_options_use_native_defaults(
        self, test_state, default_app_settings
    ):
        test_state.config.settings_file.write_text(
            json.dumps({"use_torch_compile": True}), encoding="utf-8"
        )

        loaded = self._new_state(test_state, default_app_settings)

        assert loaded.state.app_settings.preview_settings.model_dump() == {
            "mode": "tiny_vae_video",
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
