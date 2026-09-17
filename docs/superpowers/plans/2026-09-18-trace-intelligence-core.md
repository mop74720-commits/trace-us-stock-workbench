# TRACE Intelligence Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Trader's read-only intelligence subsystem into TRACE so one local TRACE process serves real Yahoo market data plus replayable, source-attributed intelligence without importing Trader's synthetic market, trading engine, or UI.

**Architecture:** TRACE remains the product shell and HTTP server. A new `trace.intelligence` package contains the migrated source adapters, deterministic processing/curation, and SQLite-backed `IntelligenceHub`; `demo/server.py` adapts that hub to same-origin HTTP endpoints. The browser gets a small standalone `TraceIntelligence` client and an Intelligence page, while market data remains owned by `TraceMarket`.

**Tech Stack:** Python 3.9+ standard library, SQLite, `http.server`, vanilla JavaScript, Node.js 18+ test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-trace-intelligence-core-design.md`

## Global Constraints

- Keep existing invocation `python demo/server.py --port 8765` valid.
- Keep Python 3.9+ compatibility; migrated code must not require Python 3.10/3.11 syntax.
- Keep TRACE bound to `127.0.0.1`.
- Preserve existing `/api/health`, `/api/market`, and `/api/news` behavior.
- Intelligence must not depend on Trader `Engine`, synthetic `market.py`, cognition runtime, trading database, or Trader web assets.
- No LLM, broker, X token, or paid service is required for default startup.
- X remains disabled unless both source configuration and `--enable-x-api` explicitly enable it.
- Intelligence evidence remains source-attributed and unverified; no buy/sell signal is produced in Phase 1.
- `GET /api/intelligence/brief` must not contain a synthetic or real `market` object; market composition is deferred to `DecisionContext`.
- Runtime SQLite files under `data/` are ignored by git.

---

## File Structure Locked for This Plan

**Create**
- `trace/__init__.py` — TRACE backend package marker.
- `trace/contracts/__init__.py` — public contract package marker.
- `trace/contracts/intelligence.py` — product-facing brief constructor and query parsing helpers.
- `trace/intelligence/__init__.py` — intelligence package marker.
- `trace/intelligence/sources.py` — bounded read-only source adapters.
- `trace/intelligence/focus.py` — US-market/person/origin classification.
- `trace/intelligence/curation.py` — transparent ranking/selection policy.
- `trace/intelligence/processing.py` — evidence normalization, clustering, replay digest.
- `trace/intelligence/service.py` — SQLite evidence store, source health, collector worker.
- `config/intelligence.sources.json` — source configuration migrated from Trader.
- `config/intelligence.curation.json` — curation policy required by `curation.py`.
- `tests/test_intelligence.py` — core migration regressions with Trader Engine-specific cases removed.
- `tests/test_intelligence_curation.py` — curation/feed regressions.
- `tests/test_intelligence_quality.py` — adversarial quality regressions.
- `tests/test_intelligence_us.py` — US/person/origin regressions.
- `demo/intelligence.js` — browser-side intelligence state/client.
- `demo/intelligence.test.cjs` — browser client regression tests.

**Modify**
- `.gitignore` — ignore `/data/` and SQLite sidecars.
- `demo/server.py` — application lifecycle, CLI flags, same-origin intelligence routes.
- `demo/test_server.py` — server/API integration coverage.
- `demo/index.html` — load `intelligence.js` before `app.js`.
- `demo/app.js` — add Intelligence navigation/page and evidence detail interaction.
- `demo/styles.css` — minimal page styles using existing TRACE tokens.
- `README.md` — startup/data-boundary/test documentation.
- `demo/README.md` — detailed API/UI/data semantics.

No file from Trader's `engine.py`, `market.py`, `cognition.py`, `research.py`, `server.py`, or `web/` is copied.

---

### Task 1: Migrate Intelligence Core as an Isolated Python Package

**Files:**
- Create: `trace/__init__.py`
- Create: `trace/intelligence/__init__.py`
- Create: `trace/intelligence/sources.py`
- Create: `trace/intelligence/focus.py`
- Create: `trace/intelligence/curation.py`
- Create: `trace/intelligence/processing.py`
- Create: `trace/intelligence/service.py`
- Create: `config/intelligence.sources.json`
- Create: `config/intelligence.curation.json`
- Modify: `.gitignore`
- Test: `tests/test_intelligence.py`

**Interfaces:**
- Produces: `trace.intelligence.sources.Source`, `Batch`, `FetchError`, `load_sources()`, `timestamp()`, `collect()`.
- Produces: `trace.intelligence.service.IntelligenceHub.from_config(path, config, allow_x=False)`.
- Produces: `IntelligenceHub.digest()`, `feed()`, `status()`, `evidence()`, `recent_evidence()`, `notifications()`, `request_collection()`, `start()`, `close()`.
- Constraint: `IntelligenceHub` constructor must use Python-3.9-compatible typing, e.g. `config_dir: Optional[Path] = None`, not `Path | None`.

- [ ] **Step 1: Add a failing import/config smoke test**

```python
# tests/test_intelligence.py
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
```

- [ ] **Step 2: Run the smoke test and confirm the package does not exist yet**

Run: `python -m unittest tests.test_intelligence.MigrationSmokeTests -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'trace'`.

- [ ] **Step 3: Copy only the five intelligence modules and two JSON configs from Trader**

Copy responsibilities exactly from:

```text
trader/trader/intelligence/sources.py    -> trace/intelligence/sources.py
trader/trader/intelligence/focus.py      -> trace/intelligence/focus.py
trader/trader/intelligence/curation.py   -> trace/intelligence/curation.py
trader/trader/intelligence/processing.py -> trace/intelligence/processing.py
trader/trader/intelligence/service.py    -> trace/intelligence/service.py
trader/config/intelligence.sources.json  -> config/intelligence.sources.json
trader/config/intelligence.curation.json -> config/intelligence.curation.json
```

Create package markers containing only package docstrings. Do not copy `__main__.py` in Phase 1.

- [ ] **Step 4: Make path resolution and typing TRACE-compatible**

Use repository-root config paths:

```python
# trace/intelligence/service.py
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = REPO_ROOT / "config" / "intelligence.sources.json"

class IntelligenceHub:
    def __init__(self, path: Path, sources: list, config_dir: Optional[Path] = None,
                 allow_x=False, fetcher=collect):
        ...
```

and:

```python
# trace/intelligence/curation.py
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = REPO_ROOT / "config" / "intelligence.curation.json"
```

Do not introduce third-party dependencies.

- [ ] **Step 5: Ignore runtime intelligence databases**

Append to `.gitignore`:

```gitignore
# Local TRACE runtime databases
/data/
*.sqlite3-wal
*.sqlite3-shm
```

- [ ] **Step 6: Run the smoke test**

Run: `python -m unittest tests.test_intelligence.MigrationSmokeTests -v`

Expected: PASS.

- [ ] **Step 7: Commit the isolated migration**

```bash
git add trace config tests/test_intelligence.py .gitignore
git commit -m "feat: migrate TRACE intelligence core"
```

---

### Task 2: Port Intelligence Regression Tests and Remove Trader-Engine Coupling

**Files:**
- Modify: `tests/test_intelligence.py`
- Create: `tests/test_intelligence_curation.py`
- Create: `tests/test_intelligence_quality.py`
- Create: `tests/test_intelligence_us.py`
- Modify: `trace/intelligence/service.py` only if tests expose migration-only defects.

**Interfaces:**
- Consumes all public `trace.intelligence.*` interfaces from Task 1.
- Produces a regression suite proving evidence semantics independently of any trading engine.

- [ ] **Step 1: Port the Trader intelligence tests with import rewrites**

Replace imports such as:

```python
from trader.intelligence.processing import normalize, build_digest
from trader.intelligence.service import IntelligenceHub
from trader.intelligence.sources import Source
```

with:

```python
from trace.intelligence.processing import normalize, build_digest
from trace.intelligence.service import IntelligenceHub
from trace.intelligence.sources import Source
```

- [ ] **Step 2: Delete only tests whose subject is Trader Engine behavior**

Remove these engine-coupled cases rather than recreating Trader trading state inside TRACE:

```text
test_source_failure_does_not_block_other_source_or_engine
test_engine_never_consumes_news_observed_after_market_cutoff
test_digest_failure_does_not_stop_market_or_cognition
```

Preserve parser, source, versioning, replay, deduplication, attribution, curation, quality, notification, pagination, and X opt-in tests.

- [ ] **Step 3: Add a Python 3.9 compatibility compile check**

Run:

```bash
python -m compileall -q trace
```

Expected: exit code 0 on the supported interpreter.

- [ ] **Step 4: Run the complete migrated suite**

Run:

```bash
python -m unittest discover -s tests -p 'test_intelligence*.py' -v
```

Expected: all migrated intelligence tests PASS.

- [ ] **Step 5: Fix only namespace/path/runtime migration failures**

Examples of acceptable fixes are import paths, repo-root config paths, Python 3.9 annotation syntax, or `Path.is_relative_to` compatibility. For Python 3.9 replace `Path.is_relative_to` with:

```python
def is_within(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
```

and use `is_within(path, config_dir.resolve())` for JSONL import confinement.

Do not alter scoring thresholds or evidence semantics merely to make a test pass.

- [ ] **Step 6: Re-run the intelligence suite**

Run: `python -m unittest discover -s tests -p 'test_intelligence*.py' -v`

Expected: PASS.

- [ ] **Step 7: Commit the regression migration**

```bash
git add trace/intelligence tests/test_intelligence*.py
git commit -m "test: port intelligence regressions to TRACE"
```

---

### Task 3: Add Product-Facing Intelligence Contracts

**Files:**
- Create: `trace/contracts/__init__.py`
- Create: `trace/contracts/intelligence.py`
- Test: `tests/test_intelligence_contracts.py`

**Interfaces:**
- Produces: `parse_intelligence_query(query: Mapping[str, list[str]]) -> dict`.
- Produces: `build_intelligence_brief(hub, query: dict) -> dict`.
- Produces: `reading_context(assets: str, market: str, historical: bool=False) -> dict`.
- Guarantees: brief has exactly the product-facing market-independent fields specified by the design.

- [ ] **Step 1: Write contract tests first**

```python
from trace.contracts.intelligence import parse_intelligence_query

class IntelligenceContractTests(unittest.TestCase):
    def test_holdings_is_rejected_in_phase_one(self):
        with self.assertRaises(ValueError):
            parse_intelligence_query({"holdings": ["NVDA"]})

    def test_assets_are_bounded_and_normalized(self):
        query = parse_intelligence_query({"assets": ["nvda, msft"], "market": ["us"]})
        self.assertEqual(query["context"], {"watchlist": ["NVDA", "MSFT"]})
        self.assertEqual(query["market"], "us")
```

Add a fake-hub test asserting `build_intelligence_brief()` returns:

```python
{
    "as_of": ..., "summary": ..., "events": ..., "scope": ...,
    "context": ..., "evidence_policy": "source_attributed_unverified"
}
```

and assert `"market" not in brief`.

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m unittest tests.test_intelligence_contracts -v`

Expected: FAIL because `trace.contracts.intelligence` does not exist.

- [ ] **Step 3: Implement strict query parsing**

Centralize validation instead of duplicating it in `demo/server.py`:

```python
ALLOWED_MARKETS = {"all", "us"}
ALLOWED_PEOPLE = {"", "trump", "musk", "powell"}
ALLOWED_ORIGINS = {"all", "report", "account_post", "imported_post"}


def one(query, key, default=""):
    values = query.get(key, [default])
    if len(values) != 1:
        raise ValueError("Duplicate query parameter")
    return values[0]
```

Reject `holdings`, asset strings longer than 100 characters, invalid `as_of`, invalid enum values, negative offsets, and limits outside `1..100`.

- [ ] **Step 4: Implement the compact brief adapter**

Use `hub.feed(..., mode="selected", window="24h", limit=3, ...)` and `hub.status()`; return no market snapshot:

```python
return {
    "as_of": digest["as_of"],
    "summary": {
        "selected_reports": digest["feed"]["counts"]["selected"],
        "related_reports": digest["feed"]["counts"]["timeline"],
        "quotes": digest["feed"]["counts"]["quotes"],
        "source_health": hub.status()["health"],
    },
    "events": digest["events"],
    "scope": digest["feed"],
    "context": digest["context"],
    "evidence_policy": "source_attributed_unverified",
}
```

- [ ] **Step 5: Run contract tests**

Run: `python -m unittest tests.test_intelligence_contracts -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add trace/contracts tests/test_intelligence_contracts.py
git commit -m "feat: define TRACE intelligence contracts"
```

---

### Task 4: Integrate Intelligence Lifecycle and HTTP Routes into TRACE Server

**Files:**
- Modify: `demo/server.py`
- Modify: `demo/test_server.py`

**Interfaces:**
- Consumes: `IntelligenceHub` and Task-3 contract helpers.
- Produces: `make_handler(intelligence=None)` or equivalent testable handler factory.
- Produces same-origin routes:
  - `GET /api/intelligence`
  - `GET /api/intelligence/brief`
  - `GET /api/intelligence/feed`
  - `GET /api/intelligence/digest`
  - `GET /api/intelligence/evidence/{id}`
  - `POST /api/intelligence/collect`

- [ ] **Step 1: Extend server tests before changing the server**

Refactor `demo/test_server.py` setup to launch a real ephemeral `ThreadingHTTPServer` with a temporary `IntelligenceHub`. Add assertions:

```python
with self.request('/api/intelligence/brief?market=us') as response:
    brief = json.load(response)
self.assertNotIn('market', brief)
self.assertEqual(brief['evidence_policy'], 'source_attributed_unverified')
```

Also test:

```text
/api/intelligence/evidence/missing -> 404
/api/intelligence/feed?holdings=NVDA -> 400
/api/intelligence/feed?market=invalid -> 400
/api/intelligence/digest?as_of=bad -> 400
POST /api/intelligence/collect with foreign Origin -> 403
```

- [ ] **Step 2: Run current server tests and verify new cases fail**

Run: `python -m unittest discover -s demo -p test_server.py -v`

Expected: existing tests pass and new intelligence cases fail/404.

- [ ] **Step 3: Make the HTTP handler instance receive the hub explicitly**

Do not use a mutable module-global hub in tests. Introduce a factory shape such as:

```python
def handler_for(intelligence=None):
    class Handler(SimpleHTTPRequestHandler):
        intelligence_hub = intelligence
        ...
    return Handler
```

Keep current market caches module-level.

- [ ] **Step 4: Add GET route dispatch using Task-3 parsing**

For disabled intelligence:

```python
if path.startswith('/api/intelligence') and self.intelligence_hub is None:
    return self.send_json({'error': 'Intelligence subsystem is disabled'}, 503)
```

For evidence lookup, return 404 when `hub.evidence(id)` is `None`. For all invalid query parsing/service filters catch `ValueError` and return HTTP 400 with a generic structured error, not internal exception text.

- [ ] **Step 5: Add same-origin POST handling only for collection**

Require `Content-Type: application/json`, body length `0..4096`, object JSON, and origin equal to `http://Host`. On success call only:

```python
self.intelligence_hub.request_collection()
```

Then return `{"ok": true}` immediately.

- [ ] **Step 6: Add CLI/lifecycle flags**

```python
parser.add_argument('--no-intelligence', action='store_true')
parser.add_argument('--intel-config', type=Path, default=REPO_ROOT / 'config' / 'intelligence.sources.json')
parser.add_argument('--intel-db', type=Path, default=REPO_ROOT / 'data' / 'intelligence.sqlite3')
parser.add_argument('--enable-x-api', action='store_true')
```

Startup logic:

```python
hub = None if args.no_intelligence else IntelligenceHub.from_config(
    args.intel_db.resolve(), args.intel_config.resolve(), args.enable_x_api
)
if hub:
    hub.start()
```

Shutdown must close hub in `finally` before process exit. If initialization fails and `--no-intelligence` was not set, do not silently continue.

- [ ] **Step 7: Run all Python server and intelligence tests**

Run:

```bash
python -m unittest discover -s demo -p test_server.py -v
python -m unittest discover -s tests -p 'test_*.py' -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add demo/server.py demo/test_server.py
git commit -m "feat: serve intelligence from TRACE"
```

---

### Task 5: Add Browser Intelligence Client with Failure Isolation

**Files:**
- Create: `demo/intelligence.js`
- Create: `demo/intelligence.test.cjs`
- Modify: `demo/index.html`
- Modify: `demo/server.py` static allow-list.

**Interfaces:**
- Produces global `window.TraceIntelligence` with:
  - `refresh(options={}) -> Promise<void>`
  - `collect() -> Promise<void>`
  - getters `brief`, `status`, `loading`, `error`, `filters`
  - `setFilters(filters)`
- Emits `trace-intelligence` CustomEvent after state changes.
- Never mutates `TraceMarket` state.

- [ ] **Step 1: Write Node tests first**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

// VM-load intelligence.js with mocked fetch.
test('failed intelligence refresh preserves market-independent client state', async () => {
  const api = client(async () => { throw new Error('offline'); });
  await api.refresh();
  assert.equal(api.loading, false);
  assert.match(api.error, /情报/);
});

test('brief payload with market field is rejected', async () => {
  const api = client(async () => ({ok:true, json:async()=>({as_of:1,summary:{},events:[],scope:{},context:{},evidence_policy:'source_attributed_unverified',market:{}})}));
  await api.refresh();
  assert.notEqual(api.error, '');
});
```

- [ ] **Step 2: Run and confirm missing client failure**

Run: `node --test demo/intelligence.test.cjs`

Expected: FAIL because `intelligence.js` does not exist.

- [ ] **Step 3: Implement the client**

Use a 30-second abort timeout and `cache: 'no-store'`. Validate that the brief contains `events` array, `summary`, `scope`, `context`, and the exact evidence policy, and reject payloads containing `market`.

`collect()` sends:

```javascript
fetch('/api/intelligence/collect', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: '{}',
  cache: 'no-store'
})
```

then calls `refresh()`.

- [ ] **Step 4: Load the client before app.js and serve it**

In `demo/index.html`:

```html
<script src="intelligence.js" defer></script>
<script src="app.js" defer></script>
```

Add `/intelligence.js` to `demo/server.py`'s static allow-list.

- [ ] **Step 5: Run JS regressions**

Run:

```bash
node --test demo/logic.test.cjs demo/market.test.cjs demo/live-market.test.cjs demo/intelligence.test.cjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo/intelligence.js demo/intelligence.test.cjs demo/index.html demo/server.py
git commit -m "feat: add TRACE intelligence client"
```

---

### Task 6: Add TRACE Intelligence/Evidence Page

**Files:**
- Modify: `demo/app.js`
- Modify: `demo/styles.css`
- Modify: `demo/intelligence.test.cjs`

**Interfaces:**
- Consumes: `TraceIntelligence.brief/status/loading/error`.
- Adds navigation hash `#intelligence` while retaining existing hashes.
- Evidence links open source URLs in a new tab; evidence-detail requests use `/api/intelligence/evidence/{id}` only when needed.

- [ ] **Step 1: Extend the browser tests with rendering helpers**

Extract pure presentation helpers from `intelligence.js` if needed, or expose a small formatter object for tests. Cover escaping and state labels:

```javascript
test('source evidence remains labeled unverified', () => {
  assert.equal(formatVerification('unverified'), '未核实');
});
```

and verify `safe` rendering does not insert raw `<script>` from an event title.

- [ ] **Step 2: Add the navigation entry**

In `app.js`:

```javascript
icons.intelligence = '<path d="M4 5h16v14H4zM7 9h10M7 13h7M7 17h4"/>';
const pageNames = {
  overview:'总览', evidence:'自选股', intelligence:'情报',
  plans:'交易计划', portfolio:'持仓', experiments:'回测'
};
```

Do not repurpose the existing `#evidence` watchlist page.

- [ ] **Step 3: Implement the intelligence page with existing TRACE primitives**

The page must show:

```text
source health
selected / timeline / quote counts
filters: assets, person, origin
manual collection button
compact event list
source, publication time, first-observed time
verification = 未核实 / 市场报价
possible conflict marker
empty / loading / error states
```

All external text passes through the existing `esc()` helper and URLs through `safeUrl()`.

- [ ] **Step 4: Wire filters and collection actions**

On entering `#intelligence`, trigger `TraceIntelligence.refresh()` if no brief exists. Buttons/selects call `setFilters()` then `refresh()`. Manual collection calls `collect()`; it must not call market refresh.

Listen for:

```javascript
window.addEventListener('trace-intelligence', () => {
  if (page === 'intelligence') render();
});
```

- [ ] **Step 5: Add minimal styles**

Reuse `.panel`, `.badge`, `.toolbar`, `.notice`, `.empty`, `.table-wrap`. Add only intelligence-specific grid/list classes; do not introduce a second visual system.

- [ ] **Step 6: Run JS tests and existing market tests**

Run:

```bash
node --test demo/logic.test.cjs demo/market.test.cjs demo/live-market.test.cjs demo/intelligence.test.cjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo/app.js demo/styles.css demo/intelligence.test.cjs
git commit -m "feat: add intelligence workspace to TRACE"
```

---

### Task 7: End-to-End Regression, Documentation, and Acceptance Check

**Files:**
- Modify: `README.md`
- Modify: `demo/README.md`
- Modify: `demo/test_server.py` if acceptance gaps are found.

**Interfaces:**
- Produces documented Phase-1 startup, API, source, and data-boundary behavior.

- [ ] **Step 1: Run the complete offline regression suite**

```bash
node --test demo/logic.test.cjs demo/market.test.cjs demo/live-market.test.cjs demo/intelligence.test.cjs
python -m unittest discover -s demo -p test_server.py -v
python -m unittest discover -s tests -p 'test_*.py' -v
python -m compileall -q trace demo/server.py
```

Expected: all commands exit 0.

- [ ] **Step 2: Run explicit no-intelligence startup smoke test**

Start:

```bash
python demo/server.py --port 8766 --no-intelligence
```

Verify:

```text
GET /api/health -> 200
GET /api/market -> 200 or structured upstream-dependent market payload
GET /api/intelligence -> 503
```

The application itself must still load.

- [ ] **Step 3: Run default startup smoke test without credentials**

With no `TRADER_X_BEARER_TOKEN` in the environment:

```bash
python demo/server.py --port 8767 --intel-db data/test-intelligence.sqlite3
```

Verify the process starts; `/api/intelligence` responds; X sources remain disabled; no LLM/broker configuration is requested.

- [ ] **Step 4: Verify the brief boundary**

Request:

```text
GET /api/intelligence/brief?market=us&assets=NVDA,MSFT
```

Confirm:

```text
contains: as_of, summary, events, scope, context, evidence_policy
omits: market, positions, orders, synthetic prices, trade signal
```

- [ ] **Step 5: Update README.md**

Document:

```text
TRACE = real US-market workbench + read-only public intelligence
Python 3.9+
new CLI flags
intelligence SQLite location
X explicitly opt-in
default public sources
no AI inference / no broker / no order execution
complete test commands
```

- [ ] **Step 6: Update demo/README.md**

Add endpoint semantics, historical replay semantics, source-health limitations, evidence verification policy, and explain that Yahoo RSS and Intelligence Core are separate datasets with separate purposes.

- [ ] **Step 7: Re-run the full regression after documentation/code cleanup**

Run the exact command block from Step 1 again.

Expected: PASS.

- [ ] **Step 8: Commit documentation and final acceptance fixes**

```bash
git add README.md demo/README.md demo/test_server.py
git commit -m "docs: document TRACE intelligence integration"
```

---

## Final Verification Gate

Before claiming Phase 1 complete, verify every acceptance item against observable evidence:

```text
[ ] single TRACE process serves market + intelligence
[ ] existing market/news endpoints unchanged
[ ] Yahoo remains the only real-market price source
[ ] intelligence brief contains no synthetic market payload
[ ] no Trader Engine/market/cognition/research/web imports exist
[ ] default startup needs no LLM/broker/X token
[ ] X requires explicit --enable-x-api and enabled config
[ ] evidence replay respects observed-at cutoffs
[ ] source attribution and unverified policy are visible
[ ] intelligence failure does not fabricate market data
[ ] --no-intelligence preserves TRACE market UI
[ ] all Python/Node tests pass
[ ] no live order execution exists
```

Search check:

```bash
grep -R "trader\.engine\|trader\.market\|trader\.cognition\|synthetic" trace demo/server.py tests || true
```

Any occurrence must be either a negative assertion/test string or removed before completion.