# AFL Predictions - Maintenance Improvement Roadmap

This document tracks **incomplete** engineering work for the AFL Predictions codebase.
Items under "Open Work" are completable and carry a "Done when" criterion so progress
is verifiable; items under "Opportunistic / Ongoing" have no completion goal.

Rules that are already enforced — versioned-migration policy, CSP/escaping requirements,
model and artifact safety, simulation invariants — live in `AGENTS.md` as invariants and
are intentionally **not** repeated here. This file is only for work that is not yet done.

Order is rough priority: earlier items are higher value-to-effort.

## Open Work

### 1. Standardize the JSON API response envelope

AJAX endpoints currently shape their own JSON, so clients can't rely on a consistent
contract.

- **Done when:** a shared helper produces one success shape and one error shape, all
  AJAX/JSON endpoints use it, and rendered (HTML) page behavior is unchanged.
- **Status:** not started. 34 `res.json()` call sites across route files use at least
  four different shapes — bare data (`res.json(matches)`), `{ success, data }`,
  `{ success, <named-key> }`, and `{ success: false, message }`. The same endpoint
  family can differ between GET and POST (e.g. `/admin/api/excluded-predictors`).

### 2. Split `routes/admin.js` into focused sub-routers

- **Done when:** admin routes are mounted from smaller routers by concern, each route
  delegates to services, and behavior is covered by tests before any duplicated logic
  is removed.
- **Status:** not started. `routes/admin.js` is 951 lines and still holds inline view-model
  assembly and metric calculation (`getPredictorManagementViewModel`,
  `buildAdminMetrics`, statistics-page metrics) plus database export/import/replacement
  logic. Candidate split: predictors (CRUD, featured, active status), database ops
  (export/import/replacement), script management, statistics.

### 3. Move remaining route-level business logic into services

`app.js` is already limited to middleware, mounting, and startup — the remaining work
is in the route files.

- **Done when:** route handlers do request/response handling and delegate scoring,
  round resolution, and view-model assembly to services, with focused service tests
  added before duplicated logic is deleted.
- **Status:** partially done. 34 service modules already exist and most routes delegate.
  Remaining inline logic: `routes/predictions.js` (`buildPredictionViewModel`, round
  resolution and predictions-map building in `GET /`), `routes/matches.js` (round
  selection/filter helpers and `/stats` page assembly), and the view-model code noted
  in item 3.

### 4. Reduce the size of large browser entrypoints

- **Done when:** pure formatting/render helpers are extracted from the largest
  entrypoints into separately testable modules, covered by Node-based Jest tests,
  with no change to CSP posture.
- **Status:** not started. Largest files in `public/js/`: `admin-scripts.js` (1,461
  lines), `elo-chart.js` (1,202), `main.js` (983), `simulation.js` (850), `admin.js`
  (802). `escapeHtml()` is already used at dynamic-interpolation sites; extraction
  should preserve that.

## Opportunistic / Ongoing

These have no completion goal. They are not projects to finish — pursue them only
while adjacent code is being changed for another reason.

### Migrate legacy schema steps when you touch them

- **Approach:** any schema change goes through `models/schema-migrations.js` and the
  `schema_migrations` ledger, never `initializeDatabase()`. Legacy inline steps are
  migrated out only when adjacent code is being changed for another reason, with
  temp-SQLite test coverage. There is no goal to migrate working legacy schema
  purely for consistency — `initializeDatabase()` is idempotent and proven, so a
  wholesale rewrite would be risky churn for no functional gain.
- **Status:** scaffolding in place. `models/schema-migrations.js` exports an empty
  array (0 migrations); `models/db.js` `initializeDatabase()` is 562 lines doing all
  table creation, column backfill, journal/auto-vacuum config, and venue backfill
  inline. Per `AGENTS.md`, legacy startup initialization must keep working.
