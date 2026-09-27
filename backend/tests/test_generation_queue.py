from __future__ import annotations

import json
import time
from threading import Event, RLock, Thread, local
from typing import Any, cast

import pytest

from _routes._errors import HTTPError
from _routes.generation_queue import submit_job
from api_types import GenerationQueueSubmitRequest
from handlers.generation_handler import GenerationHandler
from handlers.generation_queue_handler import GenerationQueueHandler
from services.generation_queue_store import GenerationQueueStore
from state.generation_queue_types import GenerationQueueState
from services.wangp_downloads import download_progress


class _Executor:
    def execute(self, job: object) -> dict[str, object]:
        return {"kind": "image.generate", "response": {"outputs": []}}


class _FailingStore(GenerationQueueStore):
    def save(self, state) -> None:
        raise OSError("disk unavailable")


class _NthFailStore(GenerationQueueStore):
    def __init__(self, path, fail_on: int) -> None:
        super().__init__(path)
        self._save_count = 0
        self._fail_on = fail_on

    def save(self, state) -> None:
        self._save_count += 1
        if self._save_count == self._fail_on:
            raise OSError("planned disk failure")
        super().save(state)


class _BlockingStore(GenerationQueueStore):
    def __init__(self, path) -> None:
        super().__init__(path)
        self.entered = Event()
        self.release = Event()

    def save(self, state) -> None:
        self.entered.set()
        assert self.release.wait(2)
        super().save(state)


class _MixedExecutor:
    def __init__(self) -> None:
        self.executed: list[str] = []
        self.active = 0
        self.maximum_active = 0

    def execute(self, job) -> dict[str, object]:
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        self.executed.append(job.client_request_id)
        self.active -= 1
        if job.client_request_id == "two":
            raise RuntimeError("expected failure")
        return {"kind": "image.generate", "response": {"outputs": []}}


def _queue(tmp_path):
    return GenerationQueueHandler(
        store=GenerationQueueStore(tmp_path / "generation-queue.json"),
        executor=_Executor(),
        max_pending=2,
    )


def _submit(queue: GenerationQueueHandler, request_id: str) -> str:
    return queue.submit(
        kind="image.generate",
        payload={"prompt": "test"},
        client_request_id=request_id,
        summary={"label": "test", "mediaKind": "image", "operation": "generate"},
        client_context={"schemaVersion": 1, "projectId": "project"},
    )["jobId"]


def test_bound_generation_download_progress_reaches_queue_and_clears(tmp_path):
    from state.app_state_types import AppState, StartupReady
    from state.app_settings import AppSettings

    queue = _queue(tmp_path)
    handler = GenerationHandler(AppState(generation=None, startup=StartupReady(), app_settings=AppSettings()), RLock())
    handler.set_generation_queue(queue)
    job_id = _submit(queue, "download")
    queue._claim_next()
    transfer = download_progress({"filename": "model.safetensors", "completed": 50, "total": 100, "speed": 10})
    with handler.bind_queue_job(job_id, queue):
        handler.update_progress("downloading_model", 3, progress_unit="bytes", model_download=transfer)
        response = handler.get_generation_progress()
        assert response.modelDownload is not None
        assert (response.modelDownload.current, response.modelDownload.total, response.modelDownload.speedBps) == (50, 100, 10)
        assert queue.snapshot()["active"]["progress"]["modelDownload"]["filename"] == "model.safetensors"
        handler.update_progress("loading_model", 10)
        assert handler.get_generation_progress().modelDownload is None
    queue.shutdown()


def test_late_progress_from_finished_job_cannot_mutate_next_active_job(tmp_path):
    queue = _queue(tmp_path)
    try:
        first_id, second_id = _submit(queue, "one"), _submit(queue, "two")
        queue._claim_next()
        revision = queue.state.revision
        queue.update_progress(first_id, "first", 10, {})
        assert queue.state.revision == revision
        queue._finish(first_id, result={"kind": "image.generate", "response": {"outputs": []}})
        queue._claim_next()

        queue.update_progress(first_id, "late", 99, {})
        queue._finish(first_id, result={"kind": "image.generate", "response": {"outputs": []}})
        queue.update_progress(second_id, "second", 20, {})

        assert queue.get_job(first_id).progress == {"phase": "first", "percent": 10, "updatedAt": queue.get_job(first_id).progress["updatedAt"]}
        assert queue.get_job(second_id).progress["phase"] == "second"
        assert queue.get_job(second_id).status == "running"
    finally:
        queue.shutdown()


def test_active_job_keeps_its_latest_preview_across_non_preview_progress(tmp_path):
    queue = _queue(tmp_path)
    try:
        first_id, second_id = _submit(queue, "one"), _submit(queue, "two")
        queue._claim_next()
        queue.update_progress(
            first_id,
            "preview",
            10,
            {"previewUrl": "http://preview.test/latest.png", "modelDownload": {"current": 5}},
        )
        queue.update_progress(first_id, "generating", 20, {"statusDetail": "Denoising", "currentStep": 2})

        progress = queue.get_job(first_id).progress
        assert progress["previewUrl"] == "http://preview.test/latest.png"
        assert progress["statusDetail"] == "Denoising"
        assert progress["currentStep"] == 2
        assert "modelDownload" not in progress

        queue.update_progress(first_id, "preview", 25, {"previewUrl": None})
        assert queue.get_job(first_id).progress["previewUrl"] == "http://preview.test/latest.png"
        queue.update_progress(first_id, "preview", 30, {"previewUrl": "http://preview.test/newest.png"})
        queue.update_progress(first_id, "generating", 35, {})
        assert queue.get_job(first_id).progress["previewUrl"] == "http://preview.test/newest.png"

        queue._finish(first_id, result={"kind": "image.generate", "response": {"outputs": []}})
        queue._claim_next()
        queue.update_progress(second_id, "generating", 30, {})
        assert "previewUrl" not in queue.get_job(second_id).progress
    finally:
        queue.shutdown()


def test_cancel_requested_wins_over_late_completion(tmp_path):
    queue = _queue(tmp_path)
    try:
        job_id = _submit(queue, "one")
        queue._claim_next()
        queue.request_cancel(job_id)
        queue._finish(job_id, result={"kind": "image.generate", "response": {"outputs": []}})
        assert queue.get_job(job_id).status == "cancelled"
        assert queue.snapshot()["attention"] == []
    finally:
        queue.shutdown()


def test_completion_acknowledgement_requires_complete_output_receipt(tmp_path):
    queue = _queue(tmp_path)
    try:
        job_id = _submit(queue, "one")
        queue._claim_next()
        queue._finish(job_id, result={"kind": "image.generate", "response": {"image_paths": ["one.png"]}})
        receipt = {
            "projectId": "project",
            "outputs": [{"outputIndex": 0, "refs": [{"kind": "asset", "id": "asset-1"}]}],
        }
        first = queue.acknowledge(job_id, receipt)
        assert queue.acknowledge(job_id, receipt)["acknowledgedAt"] == first["acknowledgedAt"]
    finally:
        queue.shutdown()


def test_completion_acknowledgement_accepts_reference_draft_receipt(tmp_path):
    queue = _queue(tmp_path)
    try:
        job_id = _submit(queue, "reference")
        queue._claim_next()
        queue._finish(job_id, result={"kind": "image.generate", "response": {"image_paths": ["reference.png"]}})
        assert queue.acknowledge(job_id, {
            "projectId": "project",
            "outputs": [{"outputIndex": 0, "refs": [{"kind": "reference_draft", "id": "draft-1"}]}],
        })["id"] == job_id
    finally:
        queue.shutdown()


def test_image_acknowledgement_requires_all_generated_outputs(tmp_path):
    queue = _queue(tmp_path)
    try:
        job_id = _submit(queue, "images")
        queue._claim_next()
        queue._finish(job_id, result={"kind": "image.generate", "response": {"image_paths": ["one.png", "two.png"]}})
        with pytest.raises(HTTPError, match="output coverage"):
            queue.acknowledge(job_id, {"projectId": "project", "outputs": [{"outputIndex": 0, "refs": [{"kind": "asset", "id": "asset-1"}]}]})
        assert queue.acknowledge(job_id, {"projectId": "project", "outputs": [
            {"outputIndex": 0, "refs": [{"kind": "asset", "id": "asset-1"}]},
            {"outputIndex": 1, "refs": [{"kind": "asset", "id": "asset-2"}]},
        ]})["id"] == job_id
    finally:
        queue.shutdown()


def test_worker_runs_mixed_jobs_fifo_and_continues_after_failure(tmp_path):
    executor = _MixedExecutor()
    queue = GenerationQueueHandler(
        store=GenerationQueueStore(tmp_path / "generation-queue.json"),
        executor=executor,
        max_pending=3,
    )
    try:
        first_id, second_id, third_id = _submit(queue, "one"), _submit(queue, "two"), _submit(queue, "three")
        queue.set_runtime_ready(True)
        assert queue.wait_for_terminal(third_id).status == "completed"
        assert queue.get_job(first_id).status == "completed"
        assert queue.get_job(second_id).status == "failed"
        assert executor.executed == ["one", "two", "three"]
        assert executor.maximum_active == 1
    finally:
        queue.shutdown()


def test_legacy_progress_and_cancel_delegate_to_active_queue_job(tmp_path):
    queue = _queue(tmp_path)
    handler = object.__new__(GenerationHandler)
    handler._lock = RLock()
    handler._queue_local = local()
    handler._queue = queue
    try:
        job_id = _submit(queue, "compat")
        queue._claim_next()
        queue.update_progress(job_id, "generating", 25, {})
        assert handler.get_generation_progress().status == "running"
        assert handler.cancel_generation().id == job_id
        assert queue.get_job(job_id).status == "cancel_requested"
    finally:
        queue.shutdown()


def test_failed_admission_save_rolls_back_and_stops_queue(tmp_path):
    queue = GenerationQueueHandler(
        store=_FailingStore(tmp_path / "generation-queue.json"),
        executor=_Executor(),
        max_pending=2,
    )
    attached_state = queue.state
    try:
        with pytest.raises(HTTPError, match="QUEUE_PERSISTENCE_FAILED"):
            _submit(queue, "not-durable")
        assert queue.state is attached_state
        snapshot = queue.snapshot()
        assert snapshot["queued"] == []
        assert snapshot["active"] is None
        assert snapshot["acceptingJobs"] is False
    finally:
        queue.shutdown()


def test_store_save_does_not_hold_queue_condition_lock(tmp_path) -> None:
    store = _BlockingStore(tmp_path / "generation-queue.json")
    queue = GenerationQueueHandler(store=store, executor=_Executor(), max_pending=2)
    submitted = Event()
    submitter = Thread(target=lambda: (_submit(queue, "one"), submitted.set()))
    submitter.start()
    try:
        assert store.entered.wait(1)
        snapshot_read = Event()
        reader = Thread(target=lambda: (queue.snapshot(), snapshot_read.set()))
        reader.start()
        assert snapshot_read.wait(1)
        assert queue.snapshot()["queued"] == []
        store.release.set()
        assert submitted.wait(1)
        assert len(queue.snapshot()["queued"]) == 1
        reader.join(1)
        submitter.join(1)
    finally:
        store.release.set()
        queue.shutdown()


def test_admission_rejects_oversized_client_context() -> None:
    request = GenerationQueueSubmitRequest.model_construct(
        clientContext={"schemaVersion": 1, "projectId": "project", "snapshot": "x" * (256 * 1024)},
    )

    with pytest.raises(HTTPError, match="CLIENT_CONTEXT_TOO_LARGE"):
        submit_job(request, cast(Any, object()))


def test_future_queue_schema_is_left_untouched(tmp_path) -> None:
    path = tmp_path / "generation-queue.json"
    original = {"schemaVersion": 2, "revision": 99, "future": {"data": True}}
    path.write_text(json.dumps(original), encoding="utf-8")
    store = GenerationQueueStore(path)

    assert store.load() is None
    with pytest.raises(OSError, match="newer unsupported schema"):
        store.save(GenerationQueueState())
    assert json.loads(path.read_text(encoding="utf-8")) == original


def test_legacy_completion_does_not_require_renderer_attention(tmp_path) -> None:
    queue = _queue(tmp_path)
    try:
        job_id = queue.submit(
            kind="image.generate", payload={"prompt": "legacy"}, client_request_id="legacy",
            summary={"label": "legacy", "mediaKind": "image", "operation": "generate"},
            client_context={"schemaVersion": 1, "projectId": "legacy"}, requires_acknowledgement=False,
        )["jobId"]
        queue._claim_next()
        queue._finish(job_id, result={"kind": "image.generate", "response": {"image_paths": ["one.png"]}})

        assert queue.get_job(job_id).acknowledged_at is not None
        assert queue.snapshot()["attention"] == []
    finally:
        queue.shutdown()


def test_unacknowledged_completion_requires_explicit_discard(tmp_path) -> None:
    queue = _queue(tmp_path)
    try:
        job_id = _submit(queue, "discard")
        queue._claim_next()
        queue._finish(job_id, result={"kind": "image.generate", "response": {"image_paths": ["one.png"]}})
        with pytest.raises(HTTPError, match="cannot be dismissed"):
            queue.dismiss(job_id)
        queue.discard(job_id)
        with pytest.raises(HTTPError, match="JOB_NOT_FOUND"):
            queue.get_job(job_id)
    finally:
        queue.shutdown()


def test_structurally_invalid_queue_is_quarantined(tmp_path) -> None:
    path = tmp_path / "generation-queue.json"
    path.write_text(json.dumps({
        "schemaVersion": 1, "revision": 1, "activeJobId": None,
        "pendingJobIds": ["missing"], "jobs": {},
    }), encoding="utf-8")

    assert GenerationQueueStore(path).load() is None
    assert not path.exists()
    assert path.with_name("generation-queue.json.corrupt").exists()


def test_worker_does_not_execute_until_claim_is_durable(tmp_path) -> None:
    executor = _MixedExecutor()
    queue = GenerationQueueHandler(
        store=_NthFailStore(tmp_path / "generation-queue.json", fail_on=2),
        executor=executor, max_pending=2,
    )
    try:
        _submit(queue, "one")
        queue.set_runtime_ready(True)
        for _ in range(100):
            if not queue.snapshot()["acceptingJobs"]:
                break
            time.sleep(0.01)
        assert executor.executed == []
        assert queue.snapshot()["active"] is None
        assert len(queue.snapshot()["queued"]) == 1
    finally:
        queue.shutdown()


def test_terminal_save_failure_stops_dispatch_before_next_job(tmp_path) -> None:
    executor = _MixedExecutor()
    queue = GenerationQueueHandler(
        store=_NthFailStore(tmp_path / "generation-queue.json", fail_on=4),
        executor=executor, max_pending=2,
    )
    try:
        _submit(queue, "one")
        _submit(queue, "three")
        queue.set_runtime_ready(True)
        for _ in range(100):
            if not queue.snapshot()["acceptingJobs"]:
                break
            time.sleep(0.01)
        assert executor.executed == ["one"]
        assert queue.get_job(queue.state.pending_job_ids[0]).client_request_id == "three"
    finally:
        queue.shutdown()
