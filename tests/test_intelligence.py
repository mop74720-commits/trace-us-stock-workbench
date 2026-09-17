import tempfile
import unittest
from pathlib import Path

from trace.intelligence.service import IntelligenceHub
from trace.intelligence.sources import Source


class MigrationSmokeTests(unittest.TestCase):
    def test_hub_is_independent_of_trader_engine(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Source(id="news", name="News", kind="rss", url="https://example.org/rss")
            hub = IntelligenceHub(Path(tmp) / "intel.sqlite3", [source])
            try:
                self.assertEqual(hub.status()["retention"], "append_only")
            finally:
                hub.close()


if __name__ == "__main__":
    unittest.main()
