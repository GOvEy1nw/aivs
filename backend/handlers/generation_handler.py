"""Generation state transitions shared by WanGP-backed routes."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from threading import RLock, local
from typing import Any, Iterator

from api_types import CancelResponse, GenerationProgressResponse, ModelDownloadProgressResponse
from handlers.base import StateHandlerBase, with_state_lock
from progress_types import DownloadUnit, ModelDownloadProgress
from state.app_state_types import (
    AppState,
    GenerationCancelled,
    GenerationComplete,
    GenerationError,
    GenerationProgress,
    GenerationRunning,
)

logger = logging.getLogger(__name__)


def _download_response(progress: ModelDownloadProgress | None) -> ModelDownloadProgressResponse | None:
    if progress is None:
        return None
    return ModelDownloadProgressResponse(
        phase=progress.phase, modelType=progress.model_type, modelName=progress.model_name,
        source=progress.source, repoId=progress.repo_id, filename=progress.filename,
        unit=progress.unit, current=progress.current, total=progress.total,
        percent=progress.percent, speedBps=progress.speed_bps, etaSeconds=progress.eta_seconds,
        fileIndex=progress.file_index, fileCount=progress.file_count,
    )


class GenerationHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock) -> None:
        super().__init__(state, lock)
        self._queue_local = local()
        self._queue: Any | None = None

    def set_generation_queue(self, queue: Any) -> None:
        self._queue = queue

    @contextmanager
    def bind_queue_job(self, job_id: str, queue: Any) -> Iterator[None]:
        self._queue_local.context = (job_id, queue)
        try:
            yield
        finally:
            self._queue_local.context = None

    def _bound_context(self) -> tuple[str, Any] | None:
        return getattr(self._queue_local, "context", None)

    @contextmanager
    def helper_lane(self) -> Iterator[None]:
        if self._queue is None:
            yield
            return
        with self._queue.helper_lane():
            yield

    @with_state_lock
    def start_generation(self, generation_id: str) -> None:
        if self._bound_context() is not None:
            return
        if self.is_generation_running():
            raise RuntimeError("Generation already in progress")
        self.state.generation = GenerationRunning(
            id=generation_id,
            progress=GenerationProgress(phase="", progress=0, current_step=None, total_steps=None),
        )

    start_generation_job = start_generation

    @with_state_lock
    def is_generation_cancelled(self) -> bool:
        if (context := self._bound_context()) is not None:
            return context[1].is_cancel_requested(context[0])
        return isinstance(self.state.generation, GenerationCancelled)

    @with_state_lock
    def update_progress(
        self,
        phase: str,
        progress: int,
        current_step: int | None = None,
        total_steps: int | None = None,
        phase_index: int | None = None,
        phase_count: int | None = None,
        section_index: int | None = None,
        section_count: int | None = None,
        status_detail: str | None = None,
        preview_url: str | None = None,
        download_current_file: str | None = None,
        download_current_file_progress: int | None = None,
        download_total_progress: int | None = None,
        progress_unit: DownloadUnit | None = None,
        model_download: ModelDownloadProgress | None = None,
    ) -> None:
        if (context := self._bound_context()) is not None:
            job_id, queue = context
            download = _download_response(model_download)
            queue.update_progress(job_id, phase, progress, {
                "currentStep": current_step, "totalSteps": total_steps,
                "phaseIndex": phase_index, "phaseCount": phase_count,
                "sectionIndex": section_index, "sectionCount": section_count,
                "statusDetail": status_detail, "previewUrl": preview_url,
                "progressUnit": progress_unit,
                "modelDownload": download.model_dump() if download is not None else None,
                "downloadCurrentFile": model_download.filename if model_download is not None else download_current_file,
                "downloadCurrentFileProgress": round(model_download.percent) if model_download is not None and model_download.percent is not None else download_current_file_progress,
                "downloadTotalProgress": download_total_progress,
            })
            return
        if not isinstance(self.state.generation, GenerationRunning):
            return
        running = self.state.generation
        running.progress.phase = phase
        running.progress.progress = progress
        running.progress.current_step = current_step
        running.progress.total_steps = total_steps
        running.progress.phase_index = phase_index
        running.progress.phase_count = phase_count
        running.progress.section_index = section_index
        running.progress.section_count = section_count
        running.progress.status_detail = status_detail
        running.progress.preview_url = preview_url or running.progress.preview_url
        running.progress.download_current_file = (
            model_download.filename if model_download is not None else download_current_file
        )
        running.progress.download_current_file_progress = (
            round(model_download.percent)
            if model_download is not None and model_download.percent is not None
            else download_current_file_progress
        )
        running.progress.download_total_progress = download_total_progress
        running.progress.progress_unit = progress_unit
        running.progress.model_download = model_download

    @with_state_lock
    def cancel_generation(self) -> CancelResponse:
        if self._queue is not None:
            active = self._queue.snapshot().get("active")
            if active is not None:
                result = self._queue.request_cancel(active["id"])
                return CancelResponse(status="cancelling", id=result["id"])
        match self.state.generation:
            case GenerationRunning(id=generation_id):
                self.state.generation = GenerationCancelled(id=generation_id)
                return CancelResponse(status="cancelling", id=generation_id)
            case GenerationCancelled(id=generation_id):
                return CancelResponse(status="cancelling", id=generation_id)
            case _:
                return CancelResponse(status="no_active_generation")

    @with_state_lock
    def complete_generation(self, result: str | list[str]) -> None:
        if self._bound_context() is not None:
            return
        if isinstance(self.state.generation, GenerationRunning):
            self.state.generation = GenerationComplete(id=self.state.generation.id, result=result)

    @with_state_lock
    def fail_generation(self, error: str) -> None:
        if self._bound_context() is not None:
            return
        match self.state.generation:
            case GenerationRunning(id=generation_id):
                logger.error("Generation %s failed: %s", generation_id, error)
                self.state.generation = GenerationError(id=generation_id, error=error)
            case GenerationCancelled():
                return
            case _:
                logger.error("Generation failed without active running job: %s", error)

    @with_state_lock
    def get_generation_progress(self) -> GenerationProgressResponse:
        if self._queue is not None:
            queue_job = self._queue.compatibility_job()
            if queue_job is not None:
                queue_progress: dict[str, Any] = dict(queue_job.progress) if queue_job.progress is not None else {}
                status = {
                    "completed": "complete", "failed": "error", "cancel_requested": "cancelling",
                }.get(queue_job.status, queue_job.status)
                return GenerationProgressResponse.model_validate({
                    "status": status, "phase": queue_progress.get("phase", status),
                    "progress": queue_progress.get("percent", 0), "currentStep": queue_progress.get("currentStep"),
                    "totalSteps": queue_progress.get("totalSteps"), "phaseIndex": queue_progress.get("phaseIndex"),
                    "phaseCount": queue_progress.get("phaseCount"), "sectionIndex": queue_progress.get("sectionIndex"),
                    "sectionCount": queue_progress.get("sectionCount"), "statusDetail": queue_progress.get("statusDetail"),
                    "previewUrl": queue_progress.get("previewUrl"),
                    "progressUnit": queue_progress.get("progressUnit"),
                    "modelDownload": queue_progress.get("modelDownload"),
                    "downloadCurrentFile": queue_progress.get("downloadCurrentFile"),
                    "downloadCurrentFileProgress": queue_progress.get("downloadCurrentFileProgress"),
                    "downloadTotalProgress": queue_progress.get("downloadTotalProgress"),
                })
        match self.state.generation:
            case GenerationRunning(progress=progress):
                return GenerationProgressResponse(
                    status="running",
                    phase=progress.phase,
                    progress=int(progress.progress),
                    currentStep=progress.current_step,
                    totalSteps=progress.total_steps,
                    phaseIndex=progress.phase_index,
                    phaseCount=progress.phase_count,
                    sectionIndex=progress.section_index,
                    sectionCount=progress.section_count,
                    statusDetail=progress.status_detail,
                    previewUrl=progress.preview_url,
                    downloadCurrentFile=progress.download_current_file,
                    downloadCurrentFileProgress=progress.download_current_file_progress,
                    downloadTotalProgress=progress.download_total_progress,
                    progressUnit=(
                        progress.progress_unit
                        if progress.progress_unit in {"bytes", "files"}
                        else None
                    ),
                    modelDownload=_download_response(progress.model_download),
                )
            case GenerationComplete():
                return GenerationProgressResponse(status="complete", phase="complete", progress=100, currentStep=0, totalSteps=0)
            case GenerationCancelled():
                return GenerationProgressResponse(status="cancelled", phase="cancelled", progress=0, currentStep=0, totalSteps=0)
            case GenerationError():
                return GenerationProgressResponse(status="error", phase="error", progress=0, currentStep=0, totalSteps=0)
            case _:
                return GenerationProgressResponse(status="idle", phase="", progress=0, currentStep=0, totalSteps=0)

    @with_state_lock
    def is_generation_running(self) -> bool:
        if self._bound_context() is not None:
            return False
        if self._queue is not None and self._queue.snapshot().get("active") is not None:
            return True
        return isinstance(self.state.generation, GenerationRunning)
