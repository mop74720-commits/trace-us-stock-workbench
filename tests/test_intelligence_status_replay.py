import tempfile
import unittest
from pathlib import Path

from trace.intelligence.service import IntelligenceHub
from trace.intelligence.sources import Source

NOW=1788960000.0


class HistoricalStatusTests(unittest.TestCase):
    def test_status_at_cutoff_does_not_leak_future_poll_failure_or_counts(self):
        source=Source(id='news',name='News',kind='rss',url='https://example.org/feed',reliability=.8,interval_seconds=300)
        with tempfile.TemporaryDirectory() as tmp:
            hub=IntelligenceHub(Path(tmp)/'intel.sqlite3',[source])
            try:
                hub.ingest(source,[{
                    'external_id':'1','title':'Nvidia earnings announced','text':'Nvidia earnings announced',
                    'url':'https://example.org/1','published_at':NOW-60,
                }],NOW)
                hub.ingest(source,[{
                    'external_id':'1','title':'Nvidia earnings revised','text':'Nvidia earnings revised',
                    'url':'https://example.org/1','published_at':NOW-60,
                }],NOW+10)
                hub.record_failure(source,'TimeoutError',NOW+10)
                historical=hub.status(NOW+5)
                current=hub.status(NOW+11)
                self.assertIsNone(historical['sources'][0].get('error'))
                self.assertEqual(historical['sources'][0].get('last_success'),NOW)
                self.assertEqual(historical['health'],'healthy')
                self.assertEqual(historical['versions'],1)
                self.assertEqual(historical['report_versions'],1)
                self.assertEqual(historical['observations'],1)
                self.assertFalse(historical['collecting'])
                self.assertIsNone(historical['last_error'])
                self.assertEqual(current['sources'][0].get('error'),'TimeoutError')
                self.assertEqual(current['health'],'degraded')
                self.assertEqual(current['versions'],2)
                self.assertEqual(current['report_versions'],2)
                self.assertEqual(current['observations'],2)
            finally:
                hub.close()


if __name__=='__main__':
    unittest.main()
