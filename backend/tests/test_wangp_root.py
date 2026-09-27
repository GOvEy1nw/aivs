from pathlib import Path

from wangp_root import resolve_wangp_root


def test_resolve_wangp_root_prefers_explicit_complete_checkout(tmp_path: Path) -> None:
    root = tmp_path / "external"
    (root / "shared").mkdir(parents=True)
    for relative in ("wgp.py", "shared/api.py", "requirements.txt"):
        (root / relative).write_text("", encoding="utf-8")

    assert resolve_wangp_root({}, default_root=tmp_path / "missing") is None
    assert resolve_wangp_root({"WANGP_ROOT": str(tmp_path / "missing")}, default_root=tmp_path / "missing") is None
    assert resolve_wangp_root({"WANGP_ROOT": str(root / "wgp.py")}, default_root=tmp_path / "missing") == root.resolve()


def test_resolve_wangp_root_uses_default_checkout(tmp_path: Path) -> None:
    root = tmp_path / "Wan2GP"
    (root / "shared").mkdir(parents=True)
    (root / "wgp.py").write_text("", encoding="utf-8")
    (root / "shared" / "api.py").write_text("", encoding="utf-8")
    (root / "requirements.txt").write_text("", encoding="utf-8")

    assert resolve_wangp_root({}, default_root=root) == root.resolve()
    assert resolve_wangp_root({"WANGP_ROOT": str(tmp_path / "missing")}, default_root=root) is None
