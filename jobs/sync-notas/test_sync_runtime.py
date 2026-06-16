import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from sync_runtime import JobTimings, resolve_watermark_start


class ResolveWatermarkStartTests(unittest.TestCase):
    def test_uses_sync_start_without_watermark(self):
        self.assertEqual(
            resolve_watermark_start("2026-01-01", None, 2),
            "2026-01-01",
        )

    def test_applies_lookback(self):
        self.assertEqual(
            resolve_watermark_start("2026-01-01", "2026-06-15", 2),
            "2026-06-13",
        )

    def test_does_not_cross_configured_sync_start(self):
        self.assertEqual(
            resolve_watermark_start("2026-06-14", "2026-06-15", 7),
            "2026-06-14",
        )

    def test_negative_lookback_is_treated_as_zero(self):
        self.assertEqual(
            resolve_watermark_start("2026-01-01", "2026-06-15", -1),
            "2026-06-15",
        )


class JobTimingsTests(unittest.TestCase):
    def test_records_step_and_total_duration(self):
        ticks = iter([10.0, 10.1, 10.35, 10.5])
        timings = JobTimings(clock=lambda: next(ticks))

        with timings.measure("read"):
            pass

        self.assertEqual(timings.snapshot(), {"read": 250.0})
        self.assertEqual(timings.total_ms(), 500.0)

    def test_records_failed_step(self):
        ticks = iter([1.0, 1.1, 1.3])
        timings = JobTimings(clock=lambda: next(ticks))

        with self.assertRaisesRegex(RuntimeError, "failure"):
            with timings.measure("distribution"):
                raise RuntimeError("failure")

        self.assertEqual(timings.snapshot(), {"distribution": 200.0})


if __name__ == "__main__":
    unittest.main()
