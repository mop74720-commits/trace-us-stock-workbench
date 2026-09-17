import unittest

from trace.contracts.intelligence import build_intelligence_brief, parse_intelligence_query


class FakeHub:
    def feed(self, as_of=None, context=None, **kwargs):
        return {
            "as_of": 1788960000.0 if as_of is None else as_of,
            "events": [{"id": "event-1"}],
            "feed": {"counts": {"selected": 1, "timeline": 2, "quotes": 0}},
            "context": context or {"holdings": [], "watchlist": []},
        }

    def status(self):
        return {"health": "healthy"}


class IntelligenceContractTests(unittest.TestCase):
    def test_holdings_is_rejected_in_phase_one(self):
        with self.assertRaises(ValueError):
            parse_intelligence_query({"holdings": ["NVDA"]})

    def test_assets_are_bounded_and_normalized(self):
        query = parse_intelligence_query({"assets": ["nvda, msft"], "market": ["us"]})
        self.assertEqual(query["context"], {"watchlist": ["MSFT", "NVDA"]})
        self.assertEqual(query["market"], "us")
        with self.assertRaises(ValueError):
            parse_intelligence_query({"assets": ["X" * 101]})

    def test_invalid_time_enum_and_pagination_are_rejected(self):
        invalid = [
            {"as_of": ["not-a-time"]},
            {"market": ["invalid"]},
            {"person": ["other"]},
            {"origin": ["verified"]},
            {"mode": ["bad"]},
            {"window": ["30d"]},
            {"offset": ["-1"]},
            {"limit": ["101"]},
            {"market": ["us", "all"]},
        ]
        for query in invalid:
            with self.subTest(query=query), self.assertRaises(ValueError):
                parse_intelligence_query(query)

    def test_historical_query_does_not_inject_current_default_watchlist(self):
        query=parse_intelligence_query({"market":["us"],"as_of":["2026-09-09T12:00:00Z"]})
        self.assertEqual(query["context"],{})

    def test_brief_is_market_independent_and_source_attributed(self):
        parsed=parse_intelligence_query({"assets":["NVDA"],"market":["us"]})
        brief=build_intelligence_brief(FakeHub(),parsed)
        self.assertEqual(set(brief),{"as_of","summary","events","scope","context","evidence_policy"})
        self.assertEqual(brief["evidence_policy"],"source_attributed_unverified")
        self.assertNotIn("market",brief)
        self.assertEqual(brief["summary"]["selected_reports"],1)
        self.assertEqual(brief["summary"]["source_health"],"healthy")


if __name__ == "__main__":
    unittest.main()
