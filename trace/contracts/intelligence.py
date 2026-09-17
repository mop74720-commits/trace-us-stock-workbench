"""Validation and product-facing payloads for TRACE intelligence APIs."""
from typing import Mapping, Sequence

from trace.intelligence.curation import CATEGORIES
from trace.intelligence.focus import PEOPLE, US_WATCHLIST
from trace.intelligence.sources import timestamp

ALLOWED_MARKETS={"all","us"}
ALLOWED_ORIGINS={"all","report","account_post","imported_post"}
ALLOWED_MODES={"selected","timeline","quotes"}
ALLOWED_WINDOWS={"24h","7d"}
ALLOWED_KEYS={"assets","market","person","origin","mode","category","source","q","window","offset","limit","as_of"}


def _one(query: Mapping[str, Sequence[str]], key: str, default=""):
    values=query.get(key,[default])
    if len(values)!=1:
        raise ValueError("Duplicate query parameter")
    return values[0]


def _bounded_int(value, low, high):
    try:
        result=int(value)
    except (TypeError,ValueError):
        raise ValueError("Invalid integer parameter") from None
    if not low<=result<=high:
        raise ValueError("Integer parameter out of range")
    return result


def parse_intelligence_query(query: Mapping[str, Sequence[str]]) -> dict:
    if "holdings" in query:
        raise ValueError("holdings is not supported in Phase 1")
    unknown=set(query)-ALLOWED_KEYS
    if unknown:
        raise ValueError("Unsupported query parameter")
    assets=_one(query,"assets","")
    if len(assets)>100:
        raise ValueError("assets exceeds 100 characters")
    market=_one(query,"market","all")
    person=_one(query,"person","")
    origin=_one(query,"origin","all")
    mode=_one(query,"mode","selected")
    category=_one(query,"category","")
    source_id=_one(query,"source","")
    text_query=_one(query,"q","")
    window=_one(query,"window","24h")
    raw_as_of=_one(query,"as_of","")
    if market not in ALLOWED_MARKETS or person not in {"",*PEOPLE} or origin not in ALLOWED_ORIGINS:
        raise ValueError("Invalid reading scope")
    if mode not in ALLOWED_MODES or window not in ALLOWED_WINDOWS or category not in {"",*CATEGORIES}:
        raise ValueError("Invalid feed filters")
    if len(source_id)>60 or len(text_query)>200:
        raise ValueError("Filter too long")
    as_of=timestamp(raw_as_of) if raw_as_of else None
    if raw_as_of and as_of is None:
        raise ValueError("as_of requires an ISO-8601 timestamp with timezone")
    symbols=sorted({symbol.strip().upper() for symbol in assets.split(",") if symbol.strip()})
    context={"watchlist":symbols} if symbols else {} if as_of is not None else {"watchlist":list(US_WATCHLIST)} if market=="us" else {}
    return {
        "as_of":as_of,"context":context,"market":market,"person":person,"origin":origin,
        "mode":mode,"category":category,"source_id":source_id,"query":text_query,"window":window,
        "offset":_bounded_int(_one(query,"offset","0"),0,2000),
        "limit":_bounded_int(_one(query,"limit","30"),1,100),
    }


def build_intelligence_brief(hub, parsed: dict) -> dict:
    digest=hub.feed(parsed["as_of"],parsed["context"],mode="selected",window="24h",limit=3,
                    market=parsed["market"],person=parsed["person"],origin=parsed["origin"])
    return {
        "as_of":digest["as_of"],
        "summary":{
            "selected_reports":digest["feed"]["counts"]["selected"],
            "related_reports":digest["feed"]["counts"]["timeline"],
            "quotes":digest["feed"]["counts"]["quotes"],
            "source_health":digest.get("health",hub.status()["health"]),
        },
        "events":digest["events"],
        "scope":digest["feed"],
        "context":digest["context"],
        "evidence_policy":"source_attributed_unverified",
    }
