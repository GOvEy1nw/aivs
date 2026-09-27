from types import SimpleNamespace

import pytest

from services.wangp_downloads import download_progress, session_downloads


@pytest.mark.parametrize("total,speed,percent,eta", [(None, 0, None, None), (200, 25, 50, 4), (50, 0, 100, None)])
def test_native_download_progress_keeps_unknown_totals(total, speed, percent, eta):
    progress = download_progress({"completed": 100, "total": total, "speed": speed, "filename": "model.safetensors"})
    assert progress is not None
    assert (progress.current, progress.percent, progress.eta_seconds) == (100, percent, eta)
    assert download_progress(None) is None
    assert download_progress({"completed": float("nan")}) is None


@pytest.mark.parametrize("fail", [False, True])
def test_session_download_callbacks_chain_and_restore_on_every_exit(fail):
    previous_updates = []
    updates = []
    previous_abort = lambda: True
    original = {"download_progress_callback": previous_updates.append, "abort_callback": previous_abort, "abort": False}
    gen = original.copy()
    session = SimpleNamespace(_state={"gen": gen})
    try:
        with session_downloads(session, updates.append, lambda: False):
            assert gen["abort_callback"]()
            gen["download_progress_callback"]({"completed": 1})
            gen["download_progress_callback"](None)
            if fail:
                raise RuntimeError("transfer failed")
    except RuntimeError:
        assert fail
    assert updates == previous_updates == [{"completed": 1}, None]
    assert gen == original


def test_session_download_cancellation_removes_scoped_callbacks():
    gen = {}
    session = SimpleNamespace(_state={"gen": gen})
    with session_downloads(session, lambda update: None, lambda: True):
        assert gen["abort_callback"]()
    assert gen == {}
    with pytest.raises(RuntimeError, match="supported native download context"):
        with session_downloads(SimpleNamespace(), lambda update: None, lambda: False):
            pass
