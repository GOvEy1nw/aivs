"""Static WanGP contract check; it never imports or initializes the runtime."""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
import sys
from typing import cast


_SESSION_METHODS = {
    "list_model_defs", "get_model_def", "get_default_settings", "get_model_schema",
    "get_model_availability", "submit_manifest",
}
_ENHANCER_ARGUMENTS = (
    "state", "model_type", "model_def", "prompt_enhancer_modes", "original_prompts",
    "image_start", "original_image_refs", "is_image", "audio_only", "seed", "progress",
    "override_profile",
)
_QWEN_IMAGE_21_PRUNA_RECIPE = {
    "activated_loras": [
        "https://huggingface.co/DeepBeepMeep/Qwen_image_2/resolve/main/loras/p_qwen_image_2.1_8step_v0.1.safetensors"
    ],
    "loras_multipliers": "1",
    "num_inference_steps": 8,
    "sample_solver": "pruna",
    "guidance_scale": 1,
    "negative_prompt": "",
    "custom_settings": {"qwen21_kv_cache": "Disabled", "rgba": "Disabled"},
    "profile_priority": 50,
}


def _class(tree: ast.Module, name: str) -> ast.ClassDef:
    value = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == name), None)
    if value is None:
        raise ValueError(f"missing class {name}")
    return value


def _methods(node: ast.ClassDef) -> dict[str, ast.FunctionDef]:
    return {item.name: item for item in node.body if isinstance(item, ast.FunctionDef)}


def _profile_model_types(project_root: Path) -> set[str]:
    # Packs include input-dependent routes (for example H3 Ref2VA) and explicitly
    # distinguish processors from generation models. An SFX policy alone does not.
    pack_tree = ast.parse((project_root / "backend" / "wangp_model_packs.py").read_text(encoding="utf-8"))
    pack_node = next(
        node for node in pack_tree.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "PACKS"
    )
    if pack_node.value is None:
        raise ValueError("curated PACKS metadata has no value")
    packs = cast(dict[str, dict[str, object]], ast.literal_eval(pack_node.value))
    processors = {pack["processor"] for pack in packs.values() if pack.get("kind") == "audio_processor"}
    model_types = {
        model_type
        for pack in packs.values() if pack.get("kind") == "model"
        for model_type in cast(list[object], pack.get("model_types", [pack.get("model_type")]))
        if isinstance(model_type, str)
    }
    for name in ("image_profiles.py", "video_profiles.py", "audio_profiles.py"):
        tree = ast.parse((project_root / "backend" / "model_profiles" / name).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.keyword) and node.arg == "wangp_model_type" and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) and node.value.value not in processors:
                model_types.add(node.value.value)
    return model_types


def _profile_files(project_root: Path) -> set[str]:
    tree = ast.parse((project_root / "backend" / "services" / "wangp_profiles.py").read_text(encoding="utf-8"))
    return {
        node.value.split(":", 1)[1] if node.value.startswith(("accelerator_profile:", "preset:")) else node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
        and node.value.endswith(".json")
    }


def _load_json_object(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return cast(dict[str, object], value)


def check(project_root: Path, runtime_root: Path) -> list[str]:
    api_tree = ast.parse((runtime_root / "shared" / "api.py").read_text(encoding="utf-8"))
    session_methods = _methods(_class(api_tree, "WanGPSession"))
    missing = _SESSION_METHODS - session_methods.keys()
    if missing:
        raise ValueError(f"WanGPSession is missing required operations: {', '.join(sorted(missing))}")
    if "cancel" not in _methods(_class(api_tree, "SessionJob")):
        raise ValueError("SessionJob is missing cancel")
    fields = {item.target.id for item in _class(api_tree, "GenerationResult").body if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)}
    required_result_fields = {"success", "generated_files", "errors"}
    if required_result_fields - fields:
        raise ValueError("GenerationResult is missing required structured fields")

    wgp_tree = ast.parse((runtime_root / "wgp.py").read_text(encoding="utf-8"))
    enhancer = next((node for node in wgp_tree.body if isinstance(node, ast.FunctionDef) and node.name == "exec_prompt_enhancer_engine"), None)
    if enhancer is None:
        raise ValueError("missing exec_prompt_enhancer_engine")
    arguments = tuple(argument.arg for argument in enhancer.args.args)
    if arguments[:len(_ENHANCER_ARGUMENTS)] != _ENHANCER_ARGUMENTS or "enhancer_kwargs" not in arguments:
        raise ValueError("exec_prompt_enhancer_engine has an incompatible positional contract")

    model_types = _profile_model_types(project_root)
    missing_defaults: list[str] = []
    for model_type in sorted(model_types):
        default_path = runtime_root / "defaults" / f"{model_type}.json"
        if not default_path.is_file():
            missing_defaults.append(model_type)
            continue
        _load_json_object(default_path)
    if missing_defaults:
        raise ValueError(f"missing curated model default files: {', '.join(missing_defaults)}")

    missing_profiles: list[str] = []
    for relative_path in sorted(_profile_files(project_root)):
        profile_path = runtime_root / "profiles" / relative_path
        if not profile_path.is_file():
            missing_profiles.append(relative_path)
            continue
        _load_json_object(profile_path)
    if missing_profiles:
        raise ValueError(f"missing native profile files: {', '.join(missing_profiles)}")
    pruna_recipe = _load_json_object(runtime_root / "profiles" / "qwen21" / "Pruna v0.1 8 Steps.json")
    if pruna_recipe != _QWEN_IMAGE_21_PRUNA_RECIPE:
        raise ValueError("Qwen Image 2.1 Pruna v0.1 8 Steps recipe is incompatible")
    return [f"static contracts: {len(model_types)} curated model defaults, {len(_profile_files(project_root))} profile bindings"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        for line in check(args.project_root.resolve(), args.runtime_root.resolve()):
            print(line)
    except (OSError, SyntaxError, ValueError, json.JSONDecodeError) as exc:
        print(f"WanGP static contract check failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
