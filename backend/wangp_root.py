from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path


_REQUIRED_FILES = ("wgp.py", "shared/api.py", "requirements.txt")
DEFAULT_WANGP_ROOT = Path(r"C:\Wan2GP")


def resolve_wangp_root(
    environment: Mapping[str, str],
    default_root: Path | None = DEFAULT_WANGP_ROOT,
) -> Path | None:
    for key in ("WANGP_ROOT", "WANGP_WGP_PATH"):
        value = environment.get(key, "").strip()
        if not value:
            continue
        candidate = Path(value)
        if candidate.is_file():
            candidate = candidate.parent
        try:
            root = candidate.resolve()
        except OSError:
            continue
        if all((root / relative).is_file() for relative in _REQUIRED_FILES):
            return root
        return None

    if default_root is None:
        return None
    root = default_root.resolve()
    return root if all((root / relative).is_file() for relative in _REQUIRED_FILES) else None
