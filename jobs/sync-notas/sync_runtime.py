"""Shared runtime helpers for Databricks sync jobs."""

from contextlib import contextmanager
from datetime import date, timedelta
from time import perf_counter
from typing import Callable, Iterator


def resolve_watermark_start(
    sync_start_date: str,
    watermark_date: str | None,
    lookback_days: int,
) -> str:
    """Apply a bounded lookback to a valid ISO watermark date."""
    if not watermark_date:
        return sync_start_date

    watermark = date.fromisoformat(watermark_date)
    lookback_start = watermark - timedelta(days=max(int(lookback_days), 0))
    return max(lookback_start.isoformat(), sync_start_date)


class JobTimings:
    """Collect elapsed milliseconds by named job step."""

    def __init__(
        self,
        clock: Callable[[], float] = perf_counter,
        on_record: Callable[[str, float], None] | None = None,
    ) -> None:
        self._clock = clock
        self._on_record = on_record
        self._started_at = clock()
        self._durations_ms: dict[str, float] = {}

    @contextmanager
    def measure(self, step: str) -> Iterator[None]:
        started_at = self._clock()
        try:
            yield
        finally:
            duration_ms = round((self._clock() - started_at) * 1000, 1)
            self._durations_ms[step] = duration_ms
            if self._on_record:
                self._on_record(step, duration_ms)

    def snapshot(self) -> dict[str, float]:
        return dict(self._durations_ms)

    def total_ms(self) -> float:
        return round((self._clock() - self._started_at) * 1000, 1)
