"""Download AiVS model packs through WanGP without loading any model on GPU."""

from __future__ import annotations

import argparse
from dataclasses import replace
from importlib import import_module
import json
import os
import sys
import threading
import warnings
from pathlib import Path
from typing import Any, Callable, TypeAlias, cast

from services.wangp_downloads import download_context, download_progress
from services.wangp_profiles import resolve_profiles


CURATED_VIDEO_PACK_IDS = frozenset(
    {
        "ltx2_fast",
        "ltx2_quality",
        "minimax-h3-fast",
        "minimax-h3-quality",
    }
)
PackValue: TypeAlias = str | list[str] | dict[str, str]


PACKS: dict[str, dict[str, PackValue]] = {
    "utility": {"name": "Utility Models", "kind": "utility"},
    "z_image_turbo": {"name": "Z-Image Turbo", "kind": "model", "model_type": "z_image"},
    "flux2_klein_4b": {"name": "Flux 2 Klein 4B", "kind": "model", "model_type": "flux2_klein_4b"},
    "flux2_klein_9b": {"name": "Flux 2 Klein 9B", "kind": "model", "model_type": "flux2_klein_9b"},
    "krea2_turbo": {"name": "Krea 2 Turbo", "kind": "model", "model_type": "krea2_turbo"},
    "krea2_turbo_edit": {
        "name": "Krea 2 Edit",
        "kind": "model",
        "model_type": "krea2_turbo_edit",
    },
    "qwen_image_2512_20B": {
        "name": "Qwen Image",
        "kind": "model",
        "model_type": "qwen_image_2512_20B",
    },
    "qwen_image_edit_plus2_20B": {
        "name": "Qwen Image Edit",
        "kind": "model",
        "model_type": "qwen_image_edit_plus2_20B",
    },
    "hidream_o1": {"name": "HiDream O1", "kind": "model", "model_type": "hidream_o1_dev"},
    "ideogram4_int8": {
        "name": "Ideogram 4",
        "kind": "model",
        "model_type": "ideogram4",
    },
    "ideogram4_turbotime_int8": {
        "name": "Ideogram 4 TurboTime",
        "kind": "model",
        "model_type": "ideogram4_turbotime",
    },
    "ltx2_fast": {
        "name": "LTX 2.5 Fast",
        "kind": "model",
        "model_type": "ltx2_25_22B_distilled",
    },
    "ltx2_quality": {
        "name": "LTX 2.5 Quality",
        "kind": "model",
        "model_type": "ltx2_25_22B",
        "accelerator_profile_id": "ltx2_25_two_stage_hq_res2s_15_3",
    },
    "ace_step_15_turbo": {"name": "ACE-Step 1.5 Fast", "kind": "model", "model_type": "ace_step_v1_5_turbo_lm_1_7b"},
    "ace_step_15_xl_turbo": {"name": "ACE-Step 1.5 XL", "kind": "model", "model_type": "ace_step_v1_5_xl_turbo_lm_1_7b"},
    "minimax_music3": {"name": "MiniMax Music 3", "kind": "model", "model_type": "minimax_music3"},
    "mmaudio": {"name": "MMAudio Sound Effects", "kind": "audio_processor", "processor": "mmaudio"},
    "omnivoice": {"name": "OmniVoice", "kind": "model", "model_type": "omnivoice"},
    "index_tts2": {"name": "Index TTS 2.5", "kind": "model", "model_type": "index_tts25"},
    "minimax-h3-fast": {
        "name": "MiniMax H3 Fast",
        "kind": "model",
        "model_types": ["minimax_h3_fl2va_pruned", "minimax_h3_ref2va_pruned"],
        "accelerator_profile_ids": {
            "minimax_h3_fl2va_pruned": "aivs_h3_turbo_lightx2v_fl2v_4_steps_v0.1",
            "minimax_h3_ref2va_pruned": "aivs_h3_turbo_lightx2v_ref2v_4_steps_v0.1",
        },
    },
    "minimax-h3-quality": {
        "name": "MiniMax H3 Quality",
        "kind": "model",
        "model_types": ["minimax_h3_fl2va_pruned", "minimax_h3_ref2va_pruned"],
    },
    "prompt_enhancer": {"name": "Prompt Enhancer", "kind": "prompt"},
}


def _event(event: str, **values: object) -> None:
    print(f"AIVS_PACK:{json.dumps({'event': event, **values})}", flush=True)


def _state_path(app_data_dir: Path) -> Path:
    return app_data_dir / "model-pack-state.json"


def _load_state(app_data_dir: Path) -> dict[str, list[str]]:
    try:
        raw_object: object = json.loads(_state_path(app_data_dir).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw_object, dict):
        return {}
    raw = cast(dict[str, object], raw_object)
    files = raw.get("files", {})
    if not isinstance(files, dict):
        return {}
    manifests: dict[str, list[str]] = {}
    for pack_id, paths in cast(dict[object, object], files).items():
        if not isinstance(pack_id, str) or not isinstance(paths, list):
            continue
        manifests[pack_id] = [path for path in cast(list[object], paths) if isinstance(path, str)]
    return manifests


def _save_state(app_data_dir: Path, manifests: dict[str, list[str]]) -> None:
    path = _state_path(app_data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"completed": sorted(manifests), "files": manifests}, indent=2),
        encoding="utf-8",
    )


def _manifest_path(root: Path, path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError:
        return str(resolved)


def _manifest_file_path(root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def _delete_pack_files(
    root: Path,
    manifests: dict[str, list[str]],
    pack_id: str,
    checkpoints_dir: Path | None = None,
) -> None:
    manifest = manifests.get(pack_id)
    if manifest is None:
        return

    file_paths = [_manifest_file_path(root, value) for value in manifest]
    allowed_roots = [root.resolve()]
    if checkpoints_dir is not None:
        allowed_roots.append(checkpoints_dir.resolve())
    outside_root: list[str] = []
    for file_path in file_paths:
        if not any(file_path.resolve().is_relative_to(allowed_root) for allowed_root in allowed_roots):
            outside_root.append(str(file_path))
    if outside_root:
        raise RuntimeError(
            "Refusing to delete model-pack files outside configured model directories: "
            + ", ".join(outside_root)
        )

    shared_paths = {
        os.path.normcase(os.path.abspath(_manifest_file_path(root, value)))
        for other_id, paths in manifests.items()
        if other_id != pack_id
        for value in paths
    }
    errors: list[str] = []
    for file_path in file_paths:
        if os.path.normcase(os.path.abspath(file_path)) in shared_paths:
            continue
        try:
            file_path.unlink(missing_ok=True)
        except OSError as exc:
            errors.append(f"{file_path}: {exc}")
    if errors:
        raise RuntimeError("Could not delete model-pack files: " + "; ".join(errors))
    del manifests[pack_id]


def _transfer_event(update: object) -> dict[str, object] | None:
    progress = download_progress(update)
    if progress is None:
        return None
    return {
        "phase": progress.phase,
        "source": progress.source,
        "repoId": progress.repo_id,
        "filename": progress.filename,
        "unit": progress.unit,
        "current": progress.current,
        "total": progress.total,
        "speedBps": progress.speed_bps,
        "etaSeconds": progress.eta_seconds,
        "fileIndex": progress.file_index,
        "fileCount": progress.file_count,
    }


def _pack_progress_callback(
    pack_id: str,
    pack_name: str,
    pack_index: int,
    pack_count: int,
) -> Callable[[object], None]:
    def callback(update: object) -> None:
        transfer = _transfer_event(update)
        if transfer is not None:
            _event(
                "transfer",
                id=pack_id,
                name=pack_name,
                packIndex=pack_index,
                packCount=pack_count,
                transfer=transfer,
            )

    return callback


def _create_model_manager(wgp: Any) -> Any:
    try:
        plugin_module = import_module("plugins.models_manager.plugin")
    except ModuleNotFoundError as exc:
        raise RuntimeError("Bundled WanGP Model Manager plugin is missing") from exc
    manager = plugin_module.modelsManagerPlugin()
    manager.setup_ui()
    missing_globals: list[str] = []
    for name in cast(list[str], manager.global_requests):
        if not hasattr(wgp, name):
            missing_globals.append(name)
            continue
        setattr(manager, name, getattr(wgp, name))
    if missing_globals:
        raise RuntimeError(
            "Bundled WanGP Model Manager is incompatible; missing globals: "
            + ", ".join(sorted(missing_globals))
        )
    return manager


def _download_model_dependencies(
    wgp: Any,
    model_type: str,
    gen: dict[str, object] | None = None,
    model_def: dict[str, Any] | None = None,
) -> None:
    """Mirror WanGP load_models download preflight without loading model weights."""
    model_def = model_def or cast(dict[str, Any], wgp.get_model_def(model_type))
    quantization = wgp.transformer_quantization
    dtype_policy = wgp.transformer_dtype_policy
    main_filename = wgp.get_model_filename(
        model_type, quantization, dtype_policy, model_def=model_def
    )
    downloaded_main = False
    if main_filename:
        wgp.download_models(
            main_filename,
            model_type,
            file_type=0,
            submodel_no=1,
            gen=gen,
            model_def=model_def,
        )
        downloaded_main = True

    if "URLs2" in model_def:
        second_filename = wgp.get_model_filename(
            model_type,
            quantization,
            dtype_policy,
            submodel_no=2,
            model_def=model_def,
        )
        if second_filename:
            wgp.download_models(
                second_filename,
                model_type,
                file_type=0,
                submodel_no=2,
                gen=gen,
                model_def=model_def,
            )
            downloaded_main = True

    raw_modules = cast(
        list[object],
        wgp.get_model_recursive_prop(
            model_type, "modules", return_list=True, model_def=model_def
        ) or [],
    )
    modules: list[object] = [
        wgp.get_model_recursive_prop(
            module,
            "modules",
            sub_prop_name="_list",
            return_list=True,
        )
        if isinstance(module, str)
        else module
        for module in raw_modules
    ]
    for module in modules:
        if isinstance(module, dict):
            module_def = cast(dict[str, object], module)
            urls1 = module_def.get("URLs")
            urls2 = module_def.get("URLs2")
            if urls1 is None or urls2 is None:
                raise RuntimeError(f"WanGP module definition is missing URLs/URLs2: {module}")
            for urls, submodel_no in ((urls1, 1), (urls2, 2)):
                filename = wgp.get_model_filename(
                    model_type,
                    quantization,
                    dtype_policy,
                    URLs=urls,
                    model_def=model_def,
                )
                if filename:
                    wgp.download_models(
                        filename,
                        model_type,
                        file_type=1,
                        submodel_no=submodel_no,
                        gen=gen,
                        model_def=model_def,
                    )
        else:
            filename = wgp.get_model_filename(
                model_type,
                quantization,
                dtype_policy,
                module_type=module,
                model_def=model_def,
            )
            if filename:
                wgp.download_models(
                    filename,
                    model_type,
                    file_type=1,
                    submodel_no=0,
                    gen=gen,
                    model_def=model_def,
                )

    if not downloaded_main:
        wgp.download_models(
            "",
            model_type,
            file_type=0,
            submodel_no=-1,
            gen=gen,
            model_def=model_def,
        )

    text_encoder_urls = wgp.get_model_recursive_prop(
        model_type,
        "text_encoder_URLs",
        return_list=True,
        model_def=model_def,
    )
    if text_encoder_urls:
        text_encoder_filename = wgp.get_model_filename(
            model_type,
            wgp.text_encoder_quantization,
            dtype_policy,
            URLs=text_encoder_urls,
            model_def=model_def,
        )
        if text_encoder_filename:
            wgp.download_models(
                text_encoder_filename,
                model_type,
                file_type=2,
                submodel_no=-1,
                force_path=model_def.get("text_encoder_folder"),
                gen=gen,
                model_def=model_def,
            )


def _download_def_paths(manager: Any, definitions: Any) -> set[Path]:
    return {Path(path) for path in manager._collect_download_def_file_paths(definitions)}


def _model_paths(
    manager: Any, model_type: str, model_def: dict[str, Any] | None = None
) -> set[Path]:
    model_dropdowns = import_module("shared.model_dropdowns")
    deps = manager._build_dropdown_deps([model_type])
    if deps is None:
        raise RuntimeError(f"WanGP Model Manager could not resolve model '{model_type}'")
    if model_def is not None:
        original_get_model_def = deps.get_model_def
        original_get_model_filename = deps.get_model_filename
        original_get_recursive_prop = deps.get_model_recursive_prop

        def get_model_def(value: str) -> Any:
            return model_def if value == model_type else original_get_model_def(value)

        def get_model_filename(*args: Any, **kwargs: Any) -> Any:
            value = kwargs.get("model_type", args[0] if args else None)
            if value == model_type:
                kwargs["model_def"] = model_def
            return original_get_model_filename(*args, **kwargs)

        def get_recursive_prop(value: str, *args: Any, **kwargs: Any) -> Any:
            if value == model_type:
                kwargs["model_def"] = model_def
            return original_get_recursive_prop(value, *args, **kwargs)

        deps = replace(
            deps,
            get_model_def=get_model_def,
            get_model_filename=get_model_filename,
            get_model_recursive_prop=get_recursive_prop,
        )
    entries = [
        *model_dropdowns.get_expected_core_file_entries_for_status(deps, model_type),
        *model_dropdowns.get_expected_secondary_file_entries_for_status(deps, model_type),
    ]
    paths = {
        Path(path)
        for entry in entries
        if (path := manager._resolve_expected_entry_path(entry, model_type=model_type))
    }
    effective_model_def = model_def or manager.get_model_def(model_type)
    paths.update(
        Path(path)
        for path in manager._collect_handler_file_paths(model_type, effective_model_def)
    )
    return paths


def _pack_model_def(
    wgp: Any,
    pack: dict[str, PackValue],
    model_type: str,
    profile_settings: dict[str, object] | None = None,
) -> dict[str, Any]:
    model_def = cast(dict[str, Any], wgp.get_model_def(model_type)).copy()
    config_id = pack.get("config") or (profile_settings or {}).get("config")
    if isinstance(config_id, str):
        config_groups = wgp.get_model_config_groups(model_type, model_def)
        selected_configs = import_module("shared.config_groups").selected_model_configs
        for _, _, config_def in selected_configs(config_groups, config_id):
            model_def.update(config_def)
    resolved_loras = (profile_settings or {}).get("activated_loras")
    explicit_loras = pack.get("loras")
    profile_loras = (
        [lora for lora in cast(list[object], resolved_loras) if isinstance(lora, str)]
        if isinstance(resolved_loras, list)
        else []
    )
    pack_loras = (
        list(explicit_loras)
        if isinstance(explicit_loras, list)
        else []
    )
    if profile_loras or pack_loras:
        model_def["loras"] = [
            *cast(list[str], wgp.get_model_recursive_prop(
                model_type, "loras", return_list=True, model_def=model_def
            ) or []),
            *profile_loras,
            *pack_loras,
        ]
    return model_def


def _resolve_pack_profile_settings(
    session: Any,
    pack_id: str,
    pack: dict[str, PackValue],
    model_type: str,
) -> dict[str, object]:
    if pack_id not in CURATED_VIDEO_PACK_IDS:
        return {}
    accelerator_profile_ids = pack.get("accelerator_profile_ids")
    accelerator_profile_id = (
        accelerator_profile_ids.get(model_type)
        if isinstance(accelerator_profile_ids, dict)
        else pack.get("accelerator_profile_id")
    )
    preset_profile_id = pack.get("preset_profile_id")
    return resolve_profiles(
        session,
        model_type,
        accelerator_profile_id=cast(str | None, accelerator_profile_id),
        preset_profile_id=cast(str | None, preset_profile_id),
    )


def _effective_pack_model_def(
    wgp: Any,
    session: Any,
    pack_id: str,
    pack: dict[str, PackValue],
    model_type: str,
) -> dict[str, Any]:
    return _pack_model_def(
        wgp,
        pack,
        model_type,
        _resolve_pack_profile_settings(session, pack_id, pack, model_type),
    )


def _pack_model_types(pack: dict[str, PackValue]) -> list[str]:
    value = pack.get("model_types")
    if isinstance(value, list):
        return value
    model_type = pack.get("model_type")
    if isinstance(model_type, str):
        return [model_type]
    raise RuntimeError("Model pack is missing a model type")


def _validate_paths(pack_id: str, paths: set[Path]) -> set[Path]:
    missing = sorted(str(path) for path in paths if not path.is_file())
    if missing:
        preview = ", ".join(missing[:5])
        suffix = f" (and {len(missing) - 5} more)" if len(missing) > 5 else ""
        raise RuntimeError(f"Model pack '{pack_id}' is incomplete; missing: {preview}{suffix}")
    if not paths:
        raise RuntimeError(f"Model pack '{pack_id}' resolved no required files")
    return paths


def _process_download_definitions(
    wgp: Any,
    definitions: dict[str, Any] | list[dict[str, Any]],
    gen: dict[str, object],
) -> None:
    for definition in definitions if isinstance(definitions, list) else [definitions]:
        wgp.process_files_def(**definition, gen=gen)


def _download_pack(
    wgp: Any,
    manager: Any,
    session: Any,
    pack_id: str,
    progress_callback: Callable[[object], None] | None = None,
    is_cancelled: Callable[[], bool] = lambda: False,
) -> set[Path]:
    gen = download_context(progress_callback or (lambda update: None), is_cancelled)
    pack = PACKS[pack_id]
    kind = pack["kind"]
    if kind == "utility":
        definition = wgp.query_core_shared_model_files()
        _process_download_definitions(wgp, definition, gen)
    elif kind == "prompt":
        assets = import_module("shared.prompt_enhancer.assets")
        definitions = cast(list[dict[str, Any]], assets.query_prompt_enhancer_download_defs())
        _process_download_definitions(wgp, definitions, gen)
    elif kind == "audio_processor":
        processors = import_module("postprocessing.audio_processors")
        handler = processors.find_processor(pack["processor"])
        if handler is None:
            raise RuntimeError(f"WanGP audio processor is not registered: {pack['processor']}")
        _process_download_definitions(wgp, handler.query_download_defs(), gen)
    else:
        for model_type in _pack_model_types(pack):
            _download_model_dependencies(
                wgp,
                model_type,
                gen,
                _effective_pack_model_def(wgp, session, pack_id, pack, model_type),
            )
    return _validate_paths(pack_id, _resolve_pack_paths(wgp, manager, session, pack_id))


def _resolve_pack_paths(wgp: Any, manager: Any, session: Any, pack_id: str) -> set[Path]:
    """Resolve expected local files without downloading anything."""
    pack = PACKS[pack_id]
    kind = pack["kind"]
    if kind == "utility":
        return _download_def_paths(manager, wgp.query_core_shared_model_files())
    if kind == "prompt":
        assets = import_module("shared.prompt_enhancer.assets")
        definitions = cast(list[dict[str, Any]], assets.query_prompt_enhancer_download_defs())
        return _download_def_paths(manager, definitions)
    if kind == "audio_processor":
        processors = import_module("postprocessing.audio_processors")
        handler = processors.find_processor(pack["processor"])
        if handler is None:
            raise RuntimeError(f"WanGP audio processor is not registered: {pack['processor']}")
        return _download_def_paths(manager, handler.query_download_defs())

    paths: set[Path] = set()
    for model_type in _pack_model_types(pack):
        paths.update(
            _model_paths(
                manager,
                model_type,
                _effective_pack_model_def(wgp, session, pack_id, pack, model_type),
            )
        )
    return paths


def main() -> int:
    warnings.filterwarnings("ignore", message="The pynvml package is deprecated.*", category=FutureWarning)
    parser = argparse.ArgumentParser()
    parser.add_argument("--wangp-root", required=True)
    parser.add_argument("--app-data-dir", required=True)
    parser.add_argument("--checkpoints-dir")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--download", nargs="*")
    parser.add_argument("--delete", nargs="*")
    args = parser.parse_args()

    root = Path(args.wangp_root).resolve()
    app_data_dir = Path(args.app_data_dir).resolve()
    checkpoints_dir = (
        Path(args.checkpoints_dir).resolve()
        if args.checkpoints_dir
        else root / "ckpts"
    )
    if not (root / "wgp.py").is_file():
        raise RuntimeError("Bundled WanGP checkout is missing wgp.py")

    manifests = _load_state(app_data_dir)
    requested = cast(list[str], args.download or [])
    delete_requested = cast(list[str], args.delete or [])
    unknown = (set(requested) | set(delete_requested)) - set(PACKS)
    if unknown:
        raise RuntimeError(f"Unknown model packs: {', '.join(sorted(unknown))}")

    for pack_id in delete_requested:
        _delete_pack_files(root, manifests, pack_id, checkpoints_dir)
        _save_state(app_data_dir, manifests)
    if args.delete is not None:
        return 0

    os.chdir(root)
    sys.path[:0] = [str(Path(__file__).resolve().parent), str(root)]
    api = import_module("shared.api")
    profile_session = api.WanGPSession(
        root=root,
        config_path=app_data_dir / "wangp_bridge" / "wgp_config.json",
    )
    # Let the native session load wgp with the same root/config as generation.
    wgp = profile_session._ensure_runtime().module
    files_locator = import_module("shared.utils.files_locator")
    checkpoint_paths = [str(checkpoints_dir), "."]
    files_locator.set_checkpoints_paths(checkpoint_paths)
    wgp.server_config["checkpoints_paths"] = checkpoint_paths
    manager = _create_model_manager(wgp)

    if args.list:
        installed_packs: list[dict[str, object]] = []
        for pack_id in PACKS:
            paths = _resolve_pack_paths(wgp, manager, profile_session, pack_id)
            installed = bool(paths) and all(path.is_file() for path in paths)
            if installed:
                manifests[pack_id] = sorted(_manifest_path(root, path) for path in paths)
            else:
                manifests.pop(pack_id, None)
            installed_packs.append({"id": pack_id, "installed": installed})
        _save_state(app_data_dir, manifests)
        _event("packs", packs=installed_packs)
        return 0

    cancelled = threading.Event()

    def read_cancellation() -> None:
        for line in sys.stdin:
            if line.strip() == "cancel":
                cancelled.set()
                return

    threading.Thread(target=read_cancellation, daemon=True).start()
    pack_count = len(requested)
    for pack_index, pack_id in enumerate(requested, start=1):
        if cancelled.is_set():
            raise RuntimeError("Model-pack download was cancelled")
        pack_name = PACKS[pack_id]["name"]
        if not isinstance(pack_name, str):
            raise RuntimeError(f"Model pack '{pack_id}' has an invalid name")
        context = {
            "id": pack_id,
            "name": pack_name,
            "packIndex": pack_index,
            "packCount": pack_count,
        }
        _event("pack-start", **context)
        paths = _download_pack(
            wgp,
            manager,
            profile_session,
            pack_id,
            _pack_progress_callback(pack_id, pack_name, pack_index, pack_count),
            cancelled.is_set,
        )
        if cancelled.is_set():
            raise RuntimeError("Model-pack download was cancelled")
        manifests[pack_id] = sorted(_manifest_path(root, path) for path in paths)
        _save_state(app_data_dir, manifests)
        _event("pack-complete", **context)
    _event("complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
