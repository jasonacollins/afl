# AGENTS.md

This file is the agent-only supplement to `README.md`.

## Scope

- Read `README.md` first for the human-facing product, setup, testing, and deployment context.
- Keep this file focused on instructions that help an agent edit the codebase safely and accurately.
- Do not duplicate README content unless a short reminder is required for agent safety.

## Agent Workflow

- Explain the intended change before making substantial edits.
- Prefer editing existing files over creating new ones.
- Do exactly what was requested; do not broaden the task on your own.
- Run relevant verification commands when they are needed to validate the requested change, then report what ran and any gaps.
- Keep documentation edits timeless. Avoid date-sensitive phrasing, temporary status notes, and duplicate guidance across docs.

## Codebase Invariants

### Cross-Runtime Scoring

- `services/scoring-service.js` runs in both Node.js and the browser through `/js/scoring-service.js`.
- Keep its behavior aligned with `scripts/core/scoring.py`.
- Do not introduce server-only dependencies into that file.

### Frontend Security

- The app enforces strict CSP. Keep all JavaScript in external files under `public/js/`.
- Do not add inline scripts or inline event handlers.
- Client-side POST, PUT, and DELETE requests must use the shared CSRF token from the `<meta name="csrf-token">` tag or a hidden `_csrf` field.
- Put page-specific browser code in the established entrypoints:
  - `public/js/admin.js`
  - `public/js/admin-scripts.js`
  - `public/js/home.js`
  - `public/js/elo-chart.js`
  - `public/js/main.js`
  - `public/js/mobile-nav.js`

### Round And Navigation Behavior

- Finals labels are display-only abstractions:
  - pre-2026 seasons: `Finals Week 1`
  - 2026 onward: `Finals Week 2`
- From 2026 onward, round selectors also include `Wildcard Finals`.
- Queries must expand grouped finals selections back to their underlying rounds instead of treating the display label as the stored source value.

### Startup And Persistence

- Server startup must run `initializeDatabase()` before listening.
- Startup must recover stale queued or running admin script jobs by marking them `interrupted`.
- Keep SQLite incremental auto-vacuum initialization intact.

### Admin Script Runner

- Script definitions live in `services/admin-script-definitions.js`.
- Job orchestration lives in `services/admin-script-runner.js`.
- Admin routes are exposed from `routes/admin.js`.
- Only one admin script run may be active at a time.
- Run metadata is stored in `admin_script_runs`.
- Log files are stored under `logs/admin-scripts/`.
- Preserve the fixture-sync contract: `sync-games` bootstraps missing fixtures, while `api-refresh` only updates existing ones.
- Keep the admin warning path intact when API data exists for a season with no matching DB fixtures.

### Model And Data Safety

- Treat any model, predictor, artifact, automation path, or DB rows not explicitly named in the request as protected.
- New experiments must use isolated predictors and artifacts unless the user explicitly asks for promotion or replacement.
- Do not repoint automation defaults or overwrite existing model outputs unless explicitly requested.
- Do not replace a production database to publish experiment output unless explicitly requested; back up first if that case arises.

### Simulation And Generated Artifacts

- `scripts/season_simulator.py` writes generated outputs to `data/simulations/season_simulation_YYYY.json`.
- Treat files under `data/simulations/` as generated runtime artifacts, not source files.
- Preserve season-specific finals structures:
  - pre-2026 top 8
  - 2026 onward top 10 with `Wildcard Finals`
- Completed finals matches must remain hard constraints for later-round simulations.
- `--backfill-round-snapshots` is destructive for the target output file and should continue resetting then rebuilding it.
- Preserve percentile interpolation behavior for the 10th and 90th win bounds.

## Testing Expectations

- Treat the standard README test entrypoint as coverage-gated in both JavaScript and Python.
- Keep `public/js/` entrypoints testable in the Node-based Jest harness; avoid requiring a real browser runtime.
- For app-security or startup changes, prefer at least one real integration path around `createApp()` or `startServer()`.
- For automation or DB-sensitive changes, favor behavior tests with temporary fixtures in addition to collaborator-mocked unit coverage.
- For automation scripts, prefer exported entrypoints plus `require.main === module` guards so tests can import them without CLI side effects.

## Documentation Boundary

- `README.md` should answer what the app is, how to run it, how it is deployed, and what a human maintainer needs to know.
- `AGENTS.md` should answer how an agent should work in this repository and which implementation constraints must not be broken during edits.
