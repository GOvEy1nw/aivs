"""Disposable source fixtures check coverage, without importing WanGP or loading GPU models."""

import json
from pathlib import Path

import pytest

from tools.check_wangp_contracts import (
    _ENHANCER_ARGUMENTS,
    _QWEN_IMAGE_21_PRUNA_RECIPE,
    _SESSION_METHODS,
    _profile_files,
    _profile_model_types,
    check,
)

PROJECT_ROOT = Path(__file__).parents[2]


@pytest.fixture
def runtime(tmp_path: Path) -> Path:
    (tmp_path / "shared").mkdir()
    methods = "\n".join(f"    def {name}(self): pass" for name in sorted(_SESSION_METHODS))
    (tmp_path / "shared/api.py").write_text(
        f"class WanGPSession:\n{methods}\n"
        "class SessionJob:\n    def cancel(self): pass\n"
        "class GenerationResult:\n    success: bool\n    generated_files: list\n    errors: list\n",
        encoding="utf-8",
    )
    arguments = ", ".join((*_ENHANCER_ARGUMENTS, "enhancer_kwargs"))
    (tmp_path / "wgp.py").write_text(f"def exec_prompt_enhancer_engine({arguments}): pass\n", encoding="utf-8")
    for model in _profile_model_types(PROJECT_ROOT):
        path = tmp_path / "defaults" / f"{model}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text("{}", encoding="utf-8")
    for relative in _profile_files(PROJECT_ROOT):
        path = tmp_path / "profiles" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        recipe = _QWEN_IMAGE_21_PRUNA_RECIPE if relative == "qwen21/Pruna v0.1 8 Steps.json" else {}
        path.write_text(json.dumps(recipe), encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize("model_type", ["ltx2_25_22B_distilled", "minimax_h3_ref2va_pruned"])
def test_generation_routes_require_native_defaults(runtime: Path, model_type: str) -> None:
    # In particular, LTX's SFX capability must not turn it into a processor-only route.
    assert check(PROJECT_ROOT, runtime)
    (runtime / "defaults" / f"{model_type}.json").unlink()
    with pytest.raises(ValueError, match=f"missing curated model default files: {model_type}"):
        check(PROJECT_ROOT, runtime)


def test_processor_pack_does_not_require_a_generation_default(runtime: Path) -> None:
    assert not (runtime / "defaults/mmaudio.json").exists()
    assert check(PROJECT_ROOT, runtime)


def test_missing_session_operation_is_actionable(runtime: Path) -> None:
    path = runtime / "shared/api.py"
    path.write_text(path.read_text(encoding="utf-8").replace("    def submit_manifest(self): pass\n", ""), encoding="utf-8")
    with pytest.raises(ValueError, match="WanGPSession is missing required operations: submit_manifest"):
        check(PROJECT_ROOT, runtime)
