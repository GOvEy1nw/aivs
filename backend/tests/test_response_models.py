"""Response key casing contract tests."""

from __future__ import annotations

class TestGenerationProgressCamelCaseKeys:
    def test_camelcase_keys(self, client, test_state):
        test_state.generation.start_generation("gen-1")
        test_state.generation.update_progress("inference", 50, 5, 20)

        r = client.get("/api/generation/progress")
        assert r.status_code == 200
        data = r.json()
        assert "currentStep" in data
        assert "totalSteps" in data
        assert "current_step" not in data
        assert "total_steps" not in data
        assert data["currentStep"] == 5
        assert data["totalSteps"] == 20

class TestSettingsCamelCaseKeys:
    def test_camelcase_keys(self, client):
        r = client.get("/api/settings")
        assert r.status_code == 200
        data = r.json()

        assert "useTorchCompile" in data
        assert "use_torch_compile" not in data
        assert "proModel" in data
        assert "pro_model" not in data
        assert "seedLocked" in data
        assert "seed_locked" not in data


class TestGenerateSnakeCaseKeys:
    def test_snake_case_keys(self, client, enable_wangp):
        r = client.post("/api/generate", json={"prompt": "test", "modelProfileId": "ltx2_25_fast"})
        assert r.status_code == 200
        data = r.json()
        assert "video_path" in data
        assert "videoPath" not in data


class TestGenerateImageSnakeCaseKeys:
    def test_snake_case_keys(self, client, enable_wangp):
        r = client.post("/api/generate-image", json={"prompt": "test"})
        assert r.status_code == 200
        data = r.json()
        assert "image_paths" in data
        assert "imagePaths" not in data
