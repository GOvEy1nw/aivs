"""Translate WanGP's native download context into AiVS progress."""

import math
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from numbers import Real
from typing import Any, cast

from progress_types import ModelDownloadProgress


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    number = float(value)
    return number if math.isfinite(number) and number >= 0 else None


def download_progress(update: object, model_type: str | None = None) -> ModelDownloadProgress | None:
    if not isinstance(update, Mapping):
        return None
    update = cast(Mapping[str, object], update)
    current = _number(update.get("completed"))
    if current is None:
        return None
    total = _number(update.get("total")) or None
    speed = _number(update.get("speed"))
    filename = update.get("filename")
    file_index = _number(update.get("file_index"))
    file_count = _number(update.get("file_count"))
    return ModelDownloadProgress(
        phase="downloading_model",
        model_type=model_type,
        model_name=None,
        source=None,
        repo_id=None,
        filename=filename.strip() if isinstance(filename, str) and filename.strip() else None,
        unit="bytes",
        current=int(current),
        total=int(total) if total is not None else None,
        percent=min(100.0, current / total * 100) if total is not None else None,
        speed_bps=speed,
        eta_seconds=max(0.0, total - current) / speed if total is not None and speed else None,
        file_index=int(file_index) if file_index is not None else None,
        file_count=int(file_count) if file_count is not None else None,
    )


def download_context(
    on_progress: Callable[[object], None],
    is_cancelled: Callable[[], bool],
) -> dict[str, object]:
    return {"download_progress_callback": on_progress, "abort_callback": is_cancelled}


@contextmanager
def session_downloads(
    session: Any,
    on_progress: Callable[[object], None],
    is_cancelled: Callable[[], bool],
) -> Iterator[None]:
    # WanGP has no public download listener; only this adapter touches native gen state.
    state = getattr(session, "_state", None)
    gen_value = cast(dict[str, object], state).get("gen") if isinstance(state, dict) else None
    if not isinstance(gen_value, dict):
        raise RuntimeError("WanGP session does not expose the supported native download context")
    gen = cast(dict[str, object], gen_value)
    keys = ("download_progress_callback", "abort_callback")
    previous = {key: gen[key] for key in keys if key in gen}
    previous_progress = previous.get(keys[0])
    previous_abort = previous.get(keys[1])

    def progress(update: object) -> None:
        try:
            if callable(previous_progress):
                previous_progress(update)
        finally:
            on_progress(update)

    def cancelled() -> bool:
        return is_cancelled() or (callable(previous_abort) and bool(previous_abort()))

    gen.update(download_context(progress, cancelled))
    try:
        yield
    finally:
        for key in keys:
            if key in previous:
                gen[key] = previous[key]
            else:
                gen.pop(key, None)
