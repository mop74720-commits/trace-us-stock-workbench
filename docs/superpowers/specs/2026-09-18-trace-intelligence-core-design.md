# TRACE Intelligence Core Integration Design

Date: 2026-09-18
Status: Proposed for implementation
Target branch: `feat/unify-trace-intelligence-core`
Primary repository: `mop74720-commits/trace-us-stock-workbench`
Source repository: `mop74720-commits/trader`

## 1. Goal

Unify the current TRACE US-stock workbench and the Trader intelligence subsystem into one product without merging their duplicated market, UI, runtime, or simulated-trading stacks.

TRACE remains the product shell and the owner of real US-market context. Trader contributes the reusable intelligence subsystem: source ingestion, normalization, curation, focus filtering, evidence storage, replay semantics, source health, and compact briefs.

Phase 1 must produce one locally runnable TRACE process that exposes both real Yahoo market data and the migrated intelligence APIs while preserving the existing TRACE demo behavior.

## 2. Non-goals for Phase 1

Phase 1 does not:

- migrate Trader's synthetic BTC/ETH/SOL market generator;
- migrate Trader's existing web UI;
- migrate automatic trading runtime, fills, account state, or simulated exchange behavior;
- enable broker connectivity or live order placement;
- require an LLM;
- turn news or social posts directly into buy/sell instructions;
- infer causal price impact from public statements;
- treat social posts or multi-source agreement as verified truth.

## 3. Architectural decision

Use TRACE as the single product repository and progressively absorb reusable Trader Core modules.

Rejected alternatives:

1. Copy the whole Trader repository into TRACE. This would immediately create duplicate HTTP servers, market models, UIs, portfolio state, and runtime semantics.
2. Keep TRACE and Trader as permanent local microservices. This introduces deployment/versioning/API synchronization overhead before there is a need for independent scaling.

The selected architecture is a modular monolith with explicit internal contracts.

```text
Yahoo Finance ───────────────┐
                             ▼
                      TRACE Market
                             │
                             ├──────────────┐
                             │              │
CNBC / MarketWatch ───┐      │              ▼
Fed / White House ────┤      │       Decision Context
X / JSONL (optional) ─┤      │              ▲
                      ▼      │              │
                 Intelligence Core ──────────┘
                      │
                      ▼
               Evidence / Brief
                      │
                      ▼
                   TRACE UI
```

## 4. Ownership boundaries

### TRACE owns

- application entry point and local HTTP server;
- real US-equity market context;
- Yahoo Finance market and RSS adapters already used by TRACE;
- product navigation and pages;
- watchlist and human trade-plan workflows;
- future decision-context assembly;
- future human approval flow.

### Intelligence Core owns

- public-source ingestion;
- source configuration and source health;
- normalization and versioned evidence records;
- first-observed/published-time semantics;
- relevance filtering;
- de-duplication and event clustering;
- conflict hints;
- deterministic compact digest/brief generation;
- historical as-of replay of evidence;
- evidence lookup and source attribution.

### Phase-1 boundary rule

Intelligence Core must not depend on Trader's `Engine`, synthetic `market.py`, portfolio positions, paper exchange, cognition runtime, or Trader web assets.

Any migrated intelligence method that accepts caller context must receive an explicit context object. TRACE Phase 1 supplies only watchlist/asset context; it never derives context from Trader trading state.

## 5. Target package layout for Phase 1

Keep the current `demo/` app intact while introducing a proper package for migrated backend code.

```text
trace-us-stock-workbench/
├─ demo/
│  ├─ server.py
│  ├─ app.js
│  ├─ intelligence.js          # new
│  ├─ index.html
│  └─ ...
├─ trace/
│  ├─ __init__.py              # new
│  ├─ contracts/
│  │  ├─ __init__.py           # new
│  │  └─ intelligence.py       # new public payload helpers/contracts
│  └─ intelligence/
│     ├─ __init__.py
│     ├─ curation.py
│     ├─ focus.py
│     ├─ processing.py
│     ├─ service.py
│     └─ sources.py
├─ config/
│  └─ intelligence.sources.json
├─ tests/
│  ├─ test_intelligence.py
│  ├─ test_intelligence_curation.py
│  ├─ test_intelligence_quality.py
│  └─ test_intelligence_us.py
└─ requirements.txt
```

The exact file paths may change only when Python import mechanics require it. Module responsibilities and public HTTP contracts defined here must not change during Phase 1 without a spec revision.

## 6. HTTP API contract

TRACE keeps its existing endpoints unchanged:

- `GET /api/health`
- `GET /api/market`
- `GET /api/news`

Phase 1 adds intelligence endpoints under the same TRACE server and origin:

- `GET /api/intelligence`
- `GET /api/intelligence/brief`
- `GET /api/intelligence/feed`
- `GET /api/intelligence/digest`
- `GET /api/intelligence/evidence/{id}`
- `POST /api/intelligence/collect`

Supported query parameters in Phase 1 are:

- `assets`: comma-separated asset/watchlist symbols, maximum 100 characters;
- `market`: `all` or `us`;
- `person`: empty, `trump`, `musk`, or `powell`;
- `origin`: `all`, `report`, `account_post`, or `imported_post`;
- `mode`: migrated intelligence feed modes supported by the source service, including `selected` and `timeline`;
- `category`: source-service category filter;
- `source`: source ID filter;
- `q`: text query;
- `window`: source-service supported window such as `24h`;
- `offset`: non-negative integer;
- `limit`: positive bounded integer accepted by the migrated service;
- `as_of`: ISO-8601 timestamp with timezone.

Phase 1 does not expose Trader's `holdings` query parameter because TRACE has no authoritative persisted portfolio state in the backend yet. Portfolio context is deferred to the future `DecisionContext` layer.

Invalid time formats, unsupported enumerated filters, oversized asset input, invalid pagination, and malformed integers return 400-series responses rather than being silently coerced.

## 7. Intelligence brief contract

`GET /api/intelligence/brief` becomes a product-facing compact intelligence payload. It must not include Trader synthetic-market values.

Required top-level fields:

```json
{
  "as_of": "ISO-8601 timestamp",
  "summary": {
    "selected_reports": 0,
    "related_reports": 0,
    "quotes": 0,
    "source_health": {}
  },
  "events": [],
  "scope": {},
  "context": {},
  "evidence_policy": "source_attributed_unverified"
}
```

Phase 1 intentionally omits a `market` object from the intelligence brief. Real market data stays available through `/api/market`. A future `DecisionContext` assembler will combine these two domains explicitly.

This avoids reintroducing the current Trader coupling where the brief includes a synthetic market snapshot.

## 8. DecisionContext contract direction

Phase 1 creates only the contract boundary needed for future agents; it does not yet run those agents.

Future shape:

```json
{
  "symbol": "NVDA",
  "as_of": "ISO-8601 timestamp",
  "market": {},
  "portfolio": {},
  "intelligence": {
    "events": [],
    "evidence": [],
    "source_health": {}
  },
  "constraints": {}
}
```

Rules:

- market facts and intelligence facts remain separate sections;
- evidence IDs survive through downstream agent outputs;
- all timestamps are explicit;
- unavailable data remains unavailable rather than being replaced by synthetic values;
- future agents consume this contract instead of reaching directly into databases or data-source clients.

## 9. Data and time semantics

Preserve the strongest semantics already present in Trader Intelligence:

- `published_at` is source-declared publication time;
- `observed_at` / `first_observed_at` represent when TRACE first had access to that evidence;
- historical replay must not expose future observations or later revisions;
- unchanged content does not create a new content revision;
- revised content is append-only rather than overwrite-in-place;
- source failure may retain labeled prior data but does not extend content validity;
- source health means recent collection/parsing state, not completeness or truth;
- evidence verification remains `unverified` or an explicitly defined non-news type such as market quote;
- current filter logic may be applied to historical evidence, but old evidence content must never be rewritten.

## 10. Source policy

Default enabled public sources remain the existing public US-market set:

- CNBC RSS;
- MarketWatch RSS;
- Federal Reserve RSS;
- White House RSS.

Optional adapters remain present but disabled by default:

- X recent search;
- local JSONL imports;
- Telegram public preview;
- Polymarket;
- CoinDesk.

X is explicitly opt-in and never required for default TRACE startup.

No credential is committed to the repository. No source adapter may publish posts, send messages, log in to social accounts, or place trades.

## 11. Server lifecycle and CLI

TRACE remains a loopback-only local application.

Existing invocation remains valid:

```text
python demo/server.py --port 8765
```

Phase 1 adds these optional arguments:

- `--no-intelligence`: disable Intelligence Core entirely;
- `--intel-config PATH`: intelligence source config; default `config/intelligence.sources.json` relative to repository root;
- `--intel-db PATH`: intelligence SQLite file; default `data/intelligence.sqlite3` relative to repository root;
- `--enable-x-api`: explicitly permit enabled X source adapters to use their configured bearer-token environment variable.

Default startup must succeed without an X token, LLM key, broker credential, or paid service.

On startup:

1. initialize existing market caches;
2. initialize Intelligence Core unless `--no-intelligence` is set;
3. start the intelligence collection worker;
4. start the single TRACE HTTP server.

On shutdown:

1. stop intelligence workers;
2. close intelligence storage cleanly;
3. stop the HTTP server.

Network collection must not block the request thread for routine page rendering. `POST /api/intelligence/collect` requests/schedules a collection cycle and returns promptly; it does not perform an unbounded network collection inline.

## 12. Persistence

Use the dedicated SQLite database `data/intelligence.sqlite3` by default, separate from browser-local TRACE trade-plan storage.

Phase 1 does not migrate the Trader trading database.

The intelligence database schema and migration behavior initially remain compatible with the source Trader implementation to reduce migration risk.

Generated runtime databases remain gitignored.

## 13. Frontend behavior

Add an Intelligence/Evidence view to TRACE rather than embedding Trader's current web UI.

Minimum Phase-1 UI:

- current compact intelligence brief;
- event list;
- evidence/source attribution;
- publication and observed timestamps;
- source-health status;
- filters for relevant assets/watchlist and supported people/origin fields;
- visible stale/error/unavailable states;
- manual refresh/collection control.

The UI must not display an intelligence item as verified solely because multiple sources mention it.

Existing market, portfolio-demo, trade-plan, and export behavior must continue working.

## 14. Error handling and security

Preserve TRACE's fail-closed data behavior:

- cold market failure does not fabricate prices;
- stale cache is visibly labeled;
- invalid links are rejected;
- APIs return structured errors;
- application remains bound to `127.0.0.1`;
- state-changing intelligence POST requests require same-origin local requests;
- no API credentials are returned to the browser;
- unsupported `/api/*` routes return 404;
- upstream source failures do not crash the whole application.

Intelligence-specific failures degrade only the intelligence panel/API. If Intelligence Core cannot initialize safely, startup fails unless the user explicitly starts with `--no-intelligence`; TRACE must not silently claim that intelligence is enabled.

## 15. Testing strategy

Implementation must preserve all existing TRACE tests and migrate the relevant Trader intelligence tests.

Required test groups:

1. Existing TRACE market tests
   - previous-trading-day change calculation;
   - invalid/missing market fields;
   - cache TTL and stale behavior;
   - cold failure does not fabricate prices;
   - safe RSS parsing.

2. Intelligence unit tests
   - normalization/versioning;
   - source filtering;
   - curation/deduplication;
   - quality/source scoring;
   - US-market/person/origin filtering;
   - historical replay time boundaries;
   - disabled-source behavior.

3. TRACE integration tests
   - `/api/market` still works with intelligence enabled;
   - `/api/intelligence/brief` contains no synthetic market payload;
   - `/api/intelligence/evidence/{id}` returns correct 404 behavior;
   - unsupported `holdings` context is not accepted as a Phase-1 API contract;
   - invalid query inputs return 4xx;
   - intelligence failure does not alter market API responses;
   - server starts without X token or LLM configuration;
   - `--no-intelligence` preserves market/news functionality.

4. Frontend regression tests
   - existing market-mode tests remain green;
   - intelligence rendering handles success/stale/error/empty payloads without breaking existing navigation.

## 16. Migration sequence

Implementation is split into small reviewable commits:

1. add package/config scaffolding and migrate Intelligence Core with imports adjusted only;
2. migrate intelligence tests and make them green inside TRACE;
3. remove dependencies on Trader Engine/synthetic-market state;
4. expose intelligence routes and lifecycle flags from TRACE `demo/server.py`;
5. add TRACE intelligence frontend module and navigation;
6. add integration/regression tests;
7. update README and architecture notes.

Do not migrate Agent, Risk, Researcher, or Paper Exchange code in this phase.

## 17. Acceptance criteria

Phase 1 is complete only when all of the following are true:

- one TRACE process serves the existing app and intelligence APIs;
- Yahoo market data remains the only market data used by TRACE's real-market mode;
- intelligence does not expose or depend on Trader synthetic prices;
- default startup requires no LLM, broker, X token, or paid service;
- public-source evidence can be collected, replayed, filtered, and inspected;
- evidence has source attribution and observable time semantics;
- failures are labeled rather than silently replaced by fabricated data;
- existing TRACE behavior remains functional;
- migrated and new tests pass;
- no live order execution exists.

## 18. Deferred Phase 2+

After Phase 1 stabilizes:

- introduce `DecisionContext` assembly from real market + intelligence + portfolio state;
- migrate/refactor Trader cognition into explicit Researcher/Analyst/Bull/Bear/Critic contracts;
- introduce auditable `TradeProposal` records containing evidence IDs, thesis, bull case, bear case, catalysts, invalidations, confidence, entry, position, and risk;
- add human approve/reject/modify workflow;
- add paper execution behind approved proposals;
- migrate risk/audit/research modules only after their contracts no longer depend on synthetic-market assumptions.

Live broker execution is outside the current roadmap until the paper workflow, audit trail, stale-data checks, and human approval boundary are independently validated.
