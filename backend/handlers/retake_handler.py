"""Compatibility boundary for saved Retake requests."""

from __future__ import annotations

from _routes._errors import HTTPError
from api_types import RetakeRequest, RetakeResponse

RETAKE_UNAVAILABLE = "RETAKE_UNAVAILABLE: Retake is not supported by the current local runtime."


class RetakeHandler:
    def run(self, req: RetakeRequest) -> RetakeResponse:
        raise HTTPError(501, RETAKE_UNAVAILABLE)
