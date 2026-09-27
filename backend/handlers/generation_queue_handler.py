"""Canonical durable, single-worker generation queue lifecycle."""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime
from threading import Condition, Event, Lock, RLock, Thread
from typing import Any, Iterator, TypeVar, cast
from uuid import uuid4

from _routes._errors import HTTPError
from pydantic import BaseModel
from services.generation_queue_executor import GenerationJobExecutor
from services.generation_queue_store import GenerationQueueStore
from state.generation_queue_types import GenerationQueueJob, GenerationQueueState, TERMINAL_STATUSES

T = TypeVar("T", bound=BaseModel)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class GenerationExecutionContext:
    def __init__(self, job_id: str, queue: "GenerationQueueHandler") -> None:
        self.job_id = job_id
        self._queue = queue

    def update_progress(self, phase: str, progress: int, **detail: Any) -> None:
        self._queue.update_progress(self.job_id, phase, progress, detail)

    def is_cancelled(self) -> bool:
        return self._queue.is_cancel_requested(self.job_id)

    def raise_if_cancelled(self) -> None:
        if self.is_cancelled():
            raise HTTPError(409, "GENERATION_CANCELLED: Generation was cancelled.")


class GenerationQueueHandler:
    def __init__(self, *, store: GenerationQueueStore, executor: GenerationJobExecutor, max_pending: int) -> None:
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._persist_lock = Lock()
        self._store = store
        self._executor = executor
        self._max_pending = max_pending
        self._state: GenerationQueueState = store.load() or GenerationQueueState()
        self._runtime_ready = False
        self._accepting = True
        self._unhealthy_error: str | None = None
        self._helper_active = False
        self._stopping = Event()
        self._worker = Thread(target=self._run, name="aivs-generation-queue", daemon=True)
        self._recover()
        self._worker.start()

    def _recover(self) -> None:
        changed = False
        with self._lock:
            for job in self._state.jobs.values():
                if job.status in {"running", "cancel_requested"}:
                    job.status = "interrupted"
                    job.finished_at = _now()
                    job.error = "INTERRUPTED: Backend restarted while this job was active."
                    changed = True
            self._state.active_job_id = None
            self._state.pending_job_ids = [job_id for job_id in self._state.pending_job_ids if self._state.jobs.get(job_id) and self._state.jobs[job_id].status == "queued"]
            if changed:
                self._state.revision += 1
                snapshot = deepcopy(self._state)
            else:
                snapshot = None
        if snapshot is not None:
            self._persist(snapshot)

    @property
    def state(self) -> GenerationQueueState:
        return self._state

    def _persist(self, snapshot: GenerationQueueState) -> None:
        try:
            with self._persist_lock:
                self._store.save(snapshot)
        except OSError as exc:
            with self._lock:
                self._unhealthy_error = f"QUEUE_PERSISTENCE_FAILED: {exc}"
                self._accepting = False
                self._condition.notify_all()
            raise HTTPError(503, self._unhealthy_error) from exc

    def _commit(self, mutate: Any) -> Any:
        with self._persist_lock:
            with self._lock:
                if self._unhealthy_error is not None:
                    raise HTTPError(503, self._unhealthy_error)
                previous = self._state
                candidate: GenerationQueueState = deepcopy(previous)
                self._state = candidate
                try:
                    result = mutate()
                    self._prune_unlocked()
                    candidate.revision += 1
                    snapshot = deepcopy(candidate)
                finally:
                    self._state = previous
            try:
                self._store.save(snapshot)
            except OSError as exc:
                with self._lock:
                    self._unhealthy_error = f"QUEUE_PERSISTENCE_FAILED: {exc}"
                    self._accepting = False
                    self._condition.notify_all()
                raise HTTPError(503, self._unhealthy_error) from exc
            with self._lock:
                live_id = self._state.active_job_id
                if live_id == candidate.active_job_id and live_id is not None:
                    live_job = self._state.jobs.get(live_id)
                    candidate_job = candidate.jobs.get(live_id)
                    if live_job is not None and candidate_job is not None and live_job.status in {"running", "cancel_requested"} and candidate_job.status in {"running", "cancel_requested"}:
                        candidate_job.progress = deepcopy(live_job.progress)
                self._state.schema_version = candidate.schema_version
                self._state.revision = candidate.revision
                self._state.active_job_id = candidate.active_job_id
                self._state.pending_job_ids = candidate.pending_job_ids
                self._state.jobs = candidate.jobs
                self._condition.notify_all()
            return result

    def set_runtime_ready(self, ready: bool) -> None:
        with self._lock:
            self._runtime_ready = ready
            self._condition.notify_all()

    def submit(self, *, kind: str, payload: dict[str, Any], client_request_id: str, summary: dict[str, Any], client_context: dict[str, Any], requires_acknowledgement: bool = True) -> dict[str, Any]:
        canonical = {"kind": kind, "payload": payload, "summary": summary, "clientContext": client_context}
        def mutate() -> dict[str, Any]:
            if not self._accepting:
                raise HTTPError(503, "QUEUE_NOT_READY: Generation queue is not accepting jobs.")
            for job in self._state.jobs.values():
                if job.client_request_id == client_request_id:
                    existing = {"kind": job.kind, "payload": job.payload, "summary": job.summary, "clientContext": job.client_context}
                    if existing != canonical:
                        raise HTTPError(409, "CLIENT_REQUEST_ID_CONFLICT: clientRequestId was reused with different work.")
                    position = self._state.pending_job_ids.index(job.id) + 1 if job.id in self._state.pending_job_ids else 0
                    return {"jobId": job.id, "status": job.status, "queuePosition": position, "duplicate": True}
            if len(self._state.pending_job_ids) >= self._max_pending:
                raise HTTPError(429, "QUEUE_FULL: Generation queue is full.")
            job = GenerationQueueJob(id=f"job_{uuid4().hex}", client_request_id=client_request_id, kind=kind, payload=deepcopy(payload), summary=deepcopy(summary), client_context=deepcopy(client_context), created_at=_now(), requires_acknowledgement=requires_acknowledgement)
            self._state.jobs[job.id] = job
            self._state.pending_job_ids.append(job.id)
            return {"jobId": job.id, "status": "queued", "queuePosition": len(self._state.pending_job_ids), "duplicate": False}
        result = self._commit(mutate)
        result["revision"] = self._state.revision
        return result

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            active_job = self._state.jobs.get(self._state.active_job_id) if self._state.active_job_id is not None else None
            return {"schemaVersion": 1, "revision": self._state.revision, "runtimeReady": self._runtime_ready, "acceptingJobs": self._accepting and self._unhealthy_error is None, "capacity": {"pending": len(self._state.pending_job_ids), "maxPending": self._max_pending}, "active": self._list_item(active_job), "queued": [self._list_item(self._state.jobs[job_id]) for job_id in self._state.pending_job_ids], "attention": [self._list_item(job) for job in self._state.jobs.values() if job.status in {"failed", "interrupted"} or (job.status == "completed" and job.acknowledged_at is None)], "serverTime": _now()}

    def _list_item(self, job: GenerationQueueJob | None) -> dict[str, Any] | None:
        if job is None:
            return None
        return {"id": job.id, "kind": job.kind, "status": job.status, "summary": deepcopy(job.summary), "progress": deepcopy(job.progress), "createdAt": job.created_at, "startedAt": job.started_at, "finishedAt": job.finished_at, "error": job.error, "acknowledgedAt": job.acknowledged_at}

    def get_job(self, job_id: str) -> GenerationQueueJob:
        with self._lock:
            job = self._state.jobs.get(job_id)
            if job is None:
                raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
            return deepcopy(job)

    def reorder(self, expected_revision: int, job_ids: list[str]) -> dict[str, Any]:
        def mutate() -> dict[str, Any]:
            if expected_revision != self._state.revision:
                raise HTTPError(409, "QUEUE_REVISION_CONFLICT: Queue order changed; refresh and retry.")
            if len(job_ids) != len(set(job_ids)) or set(job_ids) != set(self._state.pending_job_ids):
                raise HTTPError(400, "JOB_NOT_QUEUED: jobIds must exactly match queued jobs.")
            self._state.pending_job_ids = list(job_ids)
            return {}
        self._commit(mutate)
        return {"revision": self._state.revision, "queued": self.snapshot()["queued"]}

    def remove(self, job_id: str) -> None:
        def mutate() -> None:
            job = self._state.jobs.get(job_id)
            if job is None:
                raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
            if job.status in {"running", "cancel_requested"}:
                raise HTTPError(409, "JOB_IS_ACTIVE: Use cancel for the active job.")
            if job.status != "queued":
                raise HTTPError(409, "JOB_ALREADY_TERMINAL: Generation job is already terminal.")
            self._state.pending_job_ids.remove(job_id)
            job.status, job.finished_at = "cancelled", _now()
        self._commit(mutate)

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        def mutate() -> dict[str, Any]:
            job = self._state.jobs.get(job_id)
            if job is None:
                raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
            if job.status == "queued":
                self._state.pending_job_ids.remove(job_id); job.status = "cancelled"; job.finished_at = _now()
            elif job_id == self._state.active_job_id and job.status in {"running", "cancel_requested"}:
                job.status = "cancel_requested"; job.cancel_requested_at = job.cancel_requested_at or _now()
            elif job.status not in TERMINAL_STATUSES:
                raise HTTPError(409, "JOB_IS_ACTIVE: Job is not the active generation.")
            return {"id": job.id, "status": job.status}
        return self._commit(mutate)

    def update_progress(self, job_id: str, phase: str, progress: int, detail: dict[str, Any]) -> None:
        with self._lock:
            job = self._state.jobs.get(job_id)
            if job is None or job_id != self._state.active_job_id or job.status != "running":
                return
            preview_url = detail.get("previewUrl")
            previous_preview_url = (
                job.progress.get("previewUrl") if isinstance(job.progress, dict) else None
            )
            if (
                not isinstance(preview_url, str)
                or not preview_url.strip()
            ) and isinstance(previous_preview_url, str) and previous_preview_url.strip():
                detail = {**detail, "previewUrl": previous_preview_url}
            job.progress = {"phase": phase, "percent": max(0, min(100, progress)), "updatedAt": _now(), **detail}
            self._condition.notify_all()

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            job = self._state.jobs.get(job_id)
            return job is not None and job.status == "cancel_requested"

    def acknowledge(self, job_id: str, receipt: dict[str, Any]) -> dict[str, Any]:
        def mutate() -> dict[str, Any]:
            job = self._state.jobs.get(job_id)
            if job is None:
                raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
            if job.status != "completed":
                raise HTTPError(409, "JOB_ALREADY_TERMINAL: Only completed jobs can be acknowledged.")
            project_id = job.client_context.get("projectId")
            if receipt.get("projectId") != project_id:
                raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement project does not match job.")
            expected = self._expected_output_count(job)
            outputs_value: object = receipt.get("outputs")
            if not isinstance(outputs_value, list):
                raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement output coverage is incomplete.")
            outputs = cast(list[object], outputs_value)
            indices: list[int] = []
            for output in outputs:
                output_data = cast(dict[str, Any], output) if isinstance(output, dict) else None
                if output_data is None or not isinstance(output_data.get("outputIndex"), int):
                    raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement output coverage is incomplete.")
                refs = output_data.get("refs")
                if not isinstance(refs, list) or not refs:
                    raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement outputs require persistence refs.")
                for ref in cast(list[object], refs):
                    ref_data = cast(dict[str, Any], ref) if isinstance(ref, dict) else None
                    if ref_data is None or ref_data.get("kind") not in {"asset", "take", "director_document", "clip_update", "reference_draft"} or not isinstance(ref_data.get("id"), str):
                        raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement persistence ref is invalid.")
                    if "parentId" in ref_data and ref_data["parentId"] is not None and not isinstance(ref_data["parentId"], str):
                        raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement persistence ref parent is invalid.")
                indices.append(cast(int, output_data["outputIndex"]))
            if sorted(indices) != list(range(expected)):
                raise HTTPError(400, "INVALID_CLIENT_CONTEXT: acknowledgement output coverage is incomplete.")
            job.acknowledged_at = job.acknowledged_at or _now()
            return {"id": job.id, "acknowledgedAt": job.acknowledged_at}
        return self._commit(mutate)

    def _expected_output_count(self, job: GenerationQueueJob) -> int:
        result = job.result or {}
        response: object = result.get("response", {})
        response_data = cast(dict[str, Any], response) if isinstance(response, dict) else None
        if response_data is None:
            return 0
        if job.kind == "image.generate":
            image_paths = response_data.get("image_paths")
            if isinstance(image_paths, list):
                return len(cast(list[object], image_paths))
            return 1 if isinstance(response_data.get("image_path"), str) else 0
        if job.kind == "audio.music":
            music_outputs = response_data.get("outputs")
            return len(cast(list[object], music_outputs)) if isinstance(music_outputs, list) else 0
        return 1

    def _prune_unlocked(self) -> None:
        removable = [
            job for job in self._state.jobs.values()
            if job.status in {"failed", "cancelled", "interrupted"}
            or (job.status == "completed" and job.acknowledged_at is not None)
        ]
        removable.sort(key=lambda job: job.finished_at or job.created_at, reverse=True)
        for job in removable[50:]:
            self._state.jobs.pop(job.id, None)

    def compatibility_job(self) -> GenerationQueueJob | None:
        with self._lock:
            if self._state.active_job_id is not None:
                active = self._state.jobs.get(self._state.active_job_id)
                if active is not None:
                    return deepcopy(active)
            terminal = [job for job in self._state.jobs.values() if job.status in TERMINAL_STATUSES]
            if not terminal:
                return None
            return deepcopy(max(terminal, key=lambda job: job.finished_at or job.created_at))

    def dismiss(self, job_id: str) -> None:
        def mutate() -> None:
            job = self._state.jobs.get(job_id)
            if job is None:
                raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
            if job.status == "completed" and job.acknowledged_at is None:
                raise HTTPError(409, "JOB_ALREADY_TERMINAL: Unacknowledged completion cannot be dismissed.")
            if job.status not in TERMINAL_STATUSES:
                raise HTTPError(409, "JOB_NOT_QUEUED: Only terminal jobs can be dismissed.")
            del self._state.jobs[job_id]
        self._commit(mutate)

    def discard(self, job_id: str) -> None:
        def mutate() -> None:
            job = self._state.jobs.get(job_id)
            if job is None:
                raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
            if job.status != "completed" or job.acknowledged_at is not None:
                raise HTTPError(409, "JOB_ALREADY_TERMINAL: Only an unacknowledged completion can be discarded.")
            del self._state.jobs[job_id]
        self._commit(mutate)

    def run_legacy(self, kind: str, payload: Any, response_type: type[T]) -> T:
        admission = self.submit(kind=kind, payload=payload.model_dump(mode="json"), client_request_id=f"legacy-{uuid4().hex}", summary={"label": kind, "mediaKind": "audio" if kind.startswith("audio.") else "video", "operation": kind}, client_context={"schemaVersion": 1, "projectId": "legacy"}, requires_acknowledgement=False)
        job = self.wait_for_terminal(admission["jobId"])
        if job.status == "completed" and job.result is not None:
            return response_type.model_validate(job.result["response"])
        if job.status == "cancelled":
            raise HTTPError(409, "GENERATION_CANCELLED: Generation was cancelled.")
        raise HTTPError(500, job.error or "GENERATION_FAILED: Generation did not complete.")

    def wait_for_terminal(self, job_id: str, timeout_seconds: float = 3600) -> GenerationQueueJob:
        deadline = __import__("time").monotonic() + timeout_seconds
        with self._condition:
            while True:
                job = self._state.jobs.get(job_id)
                if job is None:
                    raise HTTPError(404, "JOB_NOT_FOUND: Generation job was not found.")
                if job.status in TERMINAL_STATUSES:
                    return deepcopy(job)
                remaining = deadline - __import__("time").monotonic()
                if remaining <= 0:
                    raise HTTPError(504, "QUEUE_WAIT_TIMEOUT: Generation did not complete in time.")
                self._condition.wait(remaining)

    @contextmanager
    def helper_lane(self) -> Iterator[None]:
        with self._lock:
            if self._helper_active or self._state.active_job_id is not None or self._state.pending_job_ids:
                raise HTTPError(409, "INFERENCE_ENGINE_BUSY: Generation queue has work pending.")
            self._helper_active = True
        try:
            yield
        finally:
            with self._lock:
                self._helper_active = False
                self._condition.notify_all()

    def shutdown(self, timeout_seconds: float = 4.0) -> None:
        with self._lock:
            self._accepting = False
            self._stopping.set()
            self._condition.notify_all()
        self._worker.join(timeout_seconds)

    def _run(self) -> None:
        while not self._stopping.is_set():
            job: GenerationQueueJob | None = None
            with self._condition:
                self._condition.wait_for(lambda: self._stopping.is_set() or (self._runtime_ready and not self._helper_active and self._state.active_job_id is None and bool(self._state.pending_job_ids) and self._unhealthy_error is None))
                if self._stopping.is_set():
                    return
            try:
                job = self._claim_next()
                result = self._executor.execute(job)
                self._finish(job.id, result=result)
            except HTTPError as exc:
                try:
                    self._finish(job.id if job is not None else "", error=exc.detail)
                except HTTPError:
                    return
            except Exception as exc:
                try:
                    self._finish(job.id if job is not None else "", error=f"GENERATION_FAILED: {exc}")
                except HTTPError:
                    return

    def _claim_next(self) -> GenerationQueueJob:
        def mutate() -> GenerationQueueJob:
            job_id = self._state.pending_job_ids.pop(0)
            job = self._state.jobs[job_id]
            job.status, job.started_at = "running", _now()
            self._state.active_job_id = job_id
            return deepcopy(job)
        return self._commit(mutate)

    def _finish(self, job_id: str, *, result: dict[str, Any] | None = None, error: str | None = None) -> None:
        if not job_id:
            return
        def mutate() -> None:
            job = self._state.jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            if job.status == "cancel_requested":
                job.status = "cancelled"
            elif error is not None:
                job.status, job.error = "failed", error
            else:
                job.status, job.result = "completed", result
            job.finished_at = _now()
            if job.status == "completed" and not job.requires_acknowledgement:
                job.acknowledged_at = job.finished_at
            if self._state.active_job_id == job_id:
                self._state.active_job_id = None
        self._commit(mutate)
