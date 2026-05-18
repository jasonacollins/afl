# AFL Predictions - Maintenance Improvement Roadmap

This document tracks durable engineering improvements for the AFL Predictions codebase. Keep it focused on maintainability, reliability, and production safety rather than temporary status.

## Current Baseline

- The main validation path is `npm test`, which runs coverage-enabled Jest tests and the Python pytest coverage runner.
- JavaScript and Python tests cover routes, services, browser entrypoints, automation scripts, model helpers, and database-sensitive behavior.
- GitHub Actions runs the same `npm test` path on pushes to `main` and pull requests.
- Generated runtime artifacts are intentionally excluded from source control, including SQLite databases, backups, logs, caches, coverage output, prediction exports, historical outputs, and simulation JSON.
- Database startup still creates and backfills the legacy schema, with a `schema_migrations` runner available for new versioned migrations.

## Highest-Value Next Improvements

1. Continue moving route-specific business logic into services.
   - Keep `app.js` limited to middleware, route mounting, startup, and process-level concerns.
   - Keep scoring, round selection, homepage view assembly, and export formatting in service modules with focused tests.

2. Use versioned migrations for new schema changes.
   - Add future migrations to `models/schema-migrations.js`.
   - Keep migrations idempotent, narrowly scoped, and covered by temp SQLite tests.
   - Avoid expanding `initializeDatabase()` except for compatibility with existing legacy initialization behavior.

3. Keep browser rendering safe by default.
   - Prefer `textContent` and DOM construction for user/API-provided text.
   - When template strings are still the pragmatic choice, escape all dynamic text and attribute values before assigning `innerHTML`.
   - Add regression tests for malicious strings when touching browser rendering code.

4. Maintain source-control hygiene.
   - Do not commit generated DB files, WAL/SHM files, temp uploads, logs, coverage output, Squiggle caches, prediction outputs, historical outputs, or simulation outputs.
   - Treat model artifacts and predictor outputs as protected unless a task explicitly asks to promote or replace them.

5. Keep test gates meaningful.
   - Raise coverage thresholds only after the suite is stable above the new target.
   - Add behavior tests for route/service refactors before deleting duplicated logic.
   - Keep Python branch coverage enabled through `scripts/tests/requirements-test.txt`.

## Good Follow-Up Candidates

- Split more admin route concerns into smaller routers once behavior is fully service-backed.
- Standardize JSON API response envelopes for AJAX endpoints without changing rendered page behavior.
- Add a lightweight configuration module for environment parsing and validation.
- Reduce large browser entrypoints by extracting pure formatting/render helpers that are easier to test.
