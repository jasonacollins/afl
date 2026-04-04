# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

For comprehensive project information including architecture, features, and setup instructions, **read the README.md file first**. This file contains AI-specific development guidelines and rules.

## Development Commands

### Core Commands
- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon (auto-restart on changes)
- `npm test` - Run the coverage-gated JavaScript suite and the Python suite
- `npm run test:watch` - Run the JavaScript suite in watch mode
- `npm run test:coverage` - Run JavaScript coverage plus the Python suite

### Data Management
- `npm run import` - Initialize database with team data (`scripts/automation/import-data.js`)
- `npm run sync-games` - Sync match data from Squiggle API (`scripts/automation/sync-games.js`). With no args, syncs the current year by default.
- `npm run daily-sync` - Run comprehensive daily synchronization: fixture sync, API refresh, ELO predictions, conditional current-season simulation regeneration, and historical data regeneration (`scripts/automation/daily-sync.js`)
- `npm run db-maintenance -- --mode=cleanup` - Delete old admin script run metadata/log files and run incremental vacuum
- `npm run db-maintenance -- --mode=vacuum` - Run full SQLite `VACUUM` in low-traffic windows

### ELO Model Scripts
For detailed documentation on ELO model training, optimization, and prediction workflows, see **[scripts/README.md](scripts/README.md)**. This includes complete workflow instructions, script parameters, and troubleshooting guides.

**Quick ELO Commands:**
- `npm run daily-sync` - Run comprehensive daily synchronization (recommended)
- `npm run import` - Initialize database with team data  
- `npm run sync-games` - Sync match data from Squiggle API

### Docker Commands
- `docker-compose up -d` - Start containerized application
- `docker-compose down` - Stop containers
- `docker-compose logs` - View container logs
- `docker-compose build` - Rebuild containers after code changes

### Production Deployment Guardrails (Critical)
- Production domain `afl.jcx.au` is served from VM origin `afl-predictions-vm` (`34.40.253.178`) in project `afl-predictions-jc`.
- Production VM zone is `australia-southeast1-a`.
- Production app path is `/var/www/afl-predictions`.
- Do not deploy production with Cloud Run (`gcloud run deploy`).
- For production updates, deploy on the VM with:
  - `gcloud compute ssh afl-predictions-vm --project afl-predictions-jc --zone australia-southeast1-a`
  - `cd /var/www/afl-predictions && git pull origin main && docker compose down && docker compose build && docker compose up -d`
- Before production deploy, confirm local `HEAD` matches `origin/main`; if not, push first.
- If `git pull` is blocked by VM-local tracked-file edits, inspect them first, then stash them on the VM before retrying the deploy.
- After deployment, verify `https://afl.jcx.au/js/main.js` reflects the new build (hash/marker check).
- Model isolation rules:
  - Testing must be isolated by default.
  - New models must be created as new artifacts/predictors.
  - Do not overwrite existing models, predictors, automation paths, or DB rows unless explicitly requested.
  - Treat any model/predictor not explicitly named in the request as protected.
  - For experiments (for example HA tests), use isolated predictor IDs/artifacts (for example `7`/`8`) and avoid changing production automation defaults.
  - Do not replace the full production DB for experiment rollout; write scoped rows for target predictors. If DB replacement is explicitly requested, backup first and verify protected predictors are unchanged after replacement.

## AI-Specific Architecture Notes

**Dual-Environment Code**: The scoring service (`services/scoring-service.js`) is uniquely designed to work in both Node.js and browser environments - it's served as a client-side script via `/js/scoring-service.js`. Keep its scoring behavior aligned with the Python helpers in `scripts/core/scoring.py`.

**Security Architecture**: The application implements strict Content Security Policy (CSP) for security:
- All JavaScript must be in external files (`public/js/`) - no inline scripts allowed
- Event handlers use data attributes with event delegation, not inline `onclick` handlers
- CSRF tokens passed via `window.csrfToken` (set in header partial) for all fetch requests
- CSP configuration in `app.js` blocks `'unsafe-inline'` for scripts
- Shared mobile header navigation behavior is in `public/js/mobile-nav.js` and is loaded globally from `views/partials/footer.ejs`
- Admin dashboard uses `public/js/admin.js` for user/admin management interactions
- Admin scripts runner page (`/admin/scripts`) uses `public/js/admin-scripts.js`
- Homepage uses `public/js/home.js` for featured predictor functionality
- ELO page (`/elo`) uses `public/js/elo-chart.js` for chart rendering and interactions
- Shared functionality in `public/js/main.js`

**Primary Navigation Architecture**:
- `/` is the predictions homepage (featured predictor performance and round predictions)
- `/elo` is the dedicated ELO chart page
- `/simulation` is the dedicated season simulation page
- Primary nav labels are `Model predictions` (`/`), `ELO` (`/elo`), and `Simulation` (`/simulation`)
- Logged-in users see `Predictor page` (`/predictions`) in nav; admins additionally see `Admin panel` (`/admin`)
- On narrow viewports the primary nav collapses behind a toggle button and expands as a vertical menu
- `/admin/scripts` is the admin-only scripts runner for operational and training jobs
- Homepage uses one featured predictor selected in admin (no model selector on `/`).
- Homepage season and round selectors are stacked vertically (do not present them side-by-side)
- Round selectors merge `Elimination Final` + `Qualifying Final` into one grouped label across `/elo`, `/`, `/predictions`, and `/matches/stats`:
  - pre-2026 seasons: `Finals Week 1`
  - 2026 onward: `Finals Week 2`
- From 2026 onward, round selectors also include `Wildcard Finals` (displayed even before wildcard fixtures are assigned).
- Grouped round labels are display-only; data queries must expand grouped finals selections (`Finals Week 1` / `Finals Week 2`) back to both source rounds.

**Startup Behavior**:
- Server startup runs `initializeDatabase()` before listening to ensure required schema and migrations exist.
- Startup also calls admin script-run recovery to mark stale queued/running jobs as `interrupted`.
- Startup schema migration archives legacy admin script DB logs to `logs/admin-scripts/archive/`, then drops the legacy DB log table.
- Startup ensures SQLite incremental auto-vacuum mode (`PRAGMA auto_vacuum = INCREMENTAL`) is enabled.

**Scheduled Maintenance (Sydney Time)**:
- Cron runs in the container's configured Sydney local time.
- `03:05` daily: `npm run db-maintenance -- --mode=cleanup`
- `03:25` first Sunday monthly: `npm run db-maintenance -- --mode=vacuum`
- `03:40` daily: `npm run daily-sync`

**Admin Scripts Runner Architecture**:
- Service definitions are centralized in `services/admin-script-definitions.js` (allowlist + field metadata).
- Job orchestration is handled in `services/admin-script-runner.js` (validation, spawn, status transitions, file-backed log persistence).
- Routes are exposed under `routes/admin.js`:
  - `GET /admin/scripts`
  - `GET /admin/api/script-metadata`
  - `POST /admin/api/script-runs`
  - `GET /admin/api/script-runs`
  - `GET /admin/api/script-runs/:runId`
  - `GET /admin/api/script-runs/:runId/logs`
- Persistence table:
  - `admin_script_runs`
- Admin script logs are stored as per-run files under `logs/admin-scripts/YYYY/MM/run-<run_id>.log`.
- `admin_script_runs.log_path` stores the relative log file path used by the logs API.
- Legacy `admin_script_run_logs` rows are archived to `logs/admin-scripts/archive/` during migration and the table is removed.
- Concurrency rule: only one active script run (`queued` or `running`) at a time.
- `sync-games` is the fixture bootstrap step for new seasons (inserts missing `matches` rows).
- `sync-games` must treat missing/invalid Squiggle `complete` values as `0` because `matches.complete` is `NOT NULL`.
- `sync-games` must treat future incomplete Squiggle `0-0` score placeholders (and `0` goals/behinds) as `NULL` so fixtures are still considered unplayed.
- `api-refresh` is update-only for existing fixtures/results and does not insert new fixtures.
- `api-refresh` should warn when API games exist for a year but no corresponding DB matches are found, instructing admins to run `sync-games` first.
- UI notes:
  - The predictions runner is labelled `Predictions` (internal script key remains `combined-predictions`).
  - The predictions card includes a model-type mode switch:
    - `Win + Optimised Margin` maps to `win-margin-methods-predictions` (`scripts/elo_margin_methods_predict.py`)
    - `Margin-only (Derive Win %)` maps to `margin-predictions` (`scripts/elo_margin_predict.py`)
  - `Win + Optimised Margin` mode supports:
    - `Predict future games only` (`--future-only`)
    - `Override completed/started matches` (`--override-completed`)
    - optional method override (`--method-override`)
    - optional compatibility bypass (`--allow-model-mismatch`, unsafe)
  - Win-model training UI (`Optimise For: Win Probability`) includes a second-step optimizer form:
    - `Optimise Win Margin Methods` maps to `win-margin-methods-optimize` (`scripts/elo_margin_methods_optimize.py`)
  - Training is presented as one `Train Model` card with an `Optimise For` selector (`Win Probability` or `Margin`) that routes to `win-train` or `margin-train`.
  - Admin script logs include periodic progress snapshots with elapsed time and stdout/stderr line counts for long-running jobs.

**ELO Data Architecture**: The ELO system uses a hybrid approach for optimal performance:
- **Predictions**: Written directly to database by Python scripts (transactional, real-time)
- **Historical Ratings**: Maintained in CSV format for chart performance (read-optimized)
- **Daily Dad's AI Updates**: `npm run daily-sync` writes predictor `6` using margin-only predictions (`scripts/elo_margin_predict.py`)
- **Daily Dad's AI Simulation Context**: `npm run daily-sync` regenerates season simulations in margin-only mode (`scripts/season_simulator.py` with `--model-path` only)
- Experimental work must not alter non-target model behavior unless a promotion is explicitly requested.
- This separation allows for data integrity in predictions while maintaining fast chart rendering
- Hybrid storage approach: predictions in database, historical ratings in CSV
- Direct database writes for ELO predictions ensure transactional integrity
- Single consolidated CSV file (`data/historical/afl_elo_complete_history.csv`) for historical chart data
- Automated pipeline: Daily sync performs fixture sync, writes predictions to database, and regenerates historical CSV when newly completed results are detected from either `sync-games` (completed inserts/state transitions) or `api-refresh` score updates
- Clean separation between operational data (database) and analytical data (CSV)

**Season Simulation**: `scripts/season_simulator.py` runs 50,000 Monte Carlo iterations and saves outputs to `data/simulations/season_simulation_YYYY.json` for the `/simulation` page. `npm run daily-sync` regenerates the current season simulation when fixture/result data changed or when the current round snapshot is missing (to ensure round tabs remain available). The simulation page supports round snapshot tabs (before each round/finals stage + post-season), plus a dedicated `Current` tab when a round is in progress so round-start snapshots remain preserved. When updating the simulator:
- Keep season-specific finals structure and seeding logic intact (pre-2026 top-8; 2026+ top-10 with `Wildcard Finals` feeding `Finals Week 2`).
- Preserve combined simulation mode behavior (`--win-model` + `--model-path` margin).
- Treat completed finals matches as hard constraints for later-round simulations (eliminated teams must stay eliminated).
- Backfill mode (`--backfill-round-snapshots`) is destructive by design for the target file: it resets the JSON first, then rebuilds snapshots round-by-round.
- Maintain the percentile helper (`interpolate_percentile`) so 10th/90th win bounds are interpolated between adjacent win totals instead of rounding to whole numbers. The helper finds the bucket containing the percentile and linearly blends toward the neighbouring win count (or back toward the previous value at the upper edge) to keep results within the feasible win range.

## Testing Framework

Testing conventions are documented in `README.md`. Additional AI-specific expectations:
- Keep client-side scripts under `public/js/` directly testable in the Node-based Jest harness; avoid browser-only assumptions that require a real browser runtime
- Treat standalone page entrypoints under `public/js/` as part of the covered test surface: they are collected by the `jest.config.js` glob, and their DOM interactions should remain testable in the lightweight harness
- Keep Python tests in `scripts/tests` runnable under `pytest` so they remain part of the default `npm test` workflow
- Treat the default `npm test` JavaScript path as coverage-gated as well: Jest runs with coverage enabled there, so global and per-file thresholds in `jest.config.js` must stay intentionally maintained
- Treat the default Python test workflow as a per-file coverage gate defined in `scripts/tests/run_pytest_with_coverage.py` for the covered core/model/history/prediction/simulation scripts; it requires the standard `coverage.py` package so selected branch-heavy files are checked for branch minimums as well. Use `AFL_ALLOW_TRACE_COVERAGE=1` only when you intentionally want weaker local validation. Do not rely on Python coverage as report-only output
- For covered Python training/prediction entrypoints, prefer direct behavior tests in addition to CLI smoke coverage so predictor isolation, future-only filtering, override handling, compatibility guards, and carryover behavior are verified at the imported function level
- For shared core helpers, especially DB/file I/O and scoring code, add direct behavior tests for cleanup and failure branches close to the source and promote them to explicit branch gates when they become part of the critical contract
- Treat critical JavaScript files in `jest.config.js` as potential per-file coverage gates as well; when you raise or relax meaningful test scope, update those thresholds intentionally
- Treat security-sensitive metadata/config modules and state-heavy frontend entrypoints as candidates for explicit per-file gates, not just global coverage
- Shared contract modules such as CSRF enforcement, Squiggle request configuration, and cross-runtime scoring logic should be treated as strong candidates for explicit per-file JavaScript gates when they become part of the critical contract
- For app/security changes, prefer at least one real `createApp()` integration test over fully mocked router wiring so CSP, session, CSRF, and middleware ordering are exercised together
- When startup behavior changes meaningfully, keep at least one `startServer()` test that exercises the real initialization path so database bootstrap, recovery ordering, and listener startup are covered together
- For DB-sensitive Python or automation changes, prefer isolated temporary fixtures for behavior tests and keep at least one smoke test that boots a fresh database through `initializeDatabase()` to catch schema drift against the real app bootstrap path
- For data-mutating automation scripts, keep a small amount of temporary SQLite integration coverage in addition to collaborator-mocked unit tests so update/insert contracts are verified directly
- For `scripts/season_simulator.py`, keep direct coverage on probability/rating helpers and completed-finals constraint logic in addition to CLI and snapshot-path tests
- When changing test scope meaningfully, update `jest.config.js` coverage thresholds intentionally rather than leaving them stale
- Prefer `require.main === module` guards and exported entrypoints for automation scripts so tests can import them without triggering CLI side effects
- Keep Python coverage artifacts ephemeral; `scripts/tests/run_pytest_with_coverage.py` should not depend on a committed or persistent repo-root `.coverage` file

## Important Implementation Notes

### Logging
Winston-based logging with daily rotation in `logs/` directory. All database operations are logged with query details and performance metrics.

### Client-Side Code Sharing
The scoring service is served to browsers via Express route - any changes must maintain browser compatibility and avoid server-side dependencies.

### Security Requirements
All client-side JavaScript must comply with strict CSP:
- No inline `<script>` blocks - all code must be in external files in `public/js/`
- No inline event handlers (`onclick`, `onchange`, etc.) - use event delegation with data attributes
- CSRF tokens for all POST/PUT/DELETE requests via `window.csrfToken`
- When adding new JavaScript, place in an appropriate file: `admin.js` (admin only), `home.js` (homepage), `main.js` (shared prediction pages), or `mobile-nav.js` (global header navigation behavior)

## AI/LLM Specific Instructions

When working on this codebase, follow these comprehensive guidelines:

### Development Workflow
- **Always read README.md first** for complete project context, architecture, and setup instructions
- Never start coding without explaining your plan and getting approval
- Implement changes step-by-step with confirmation
- Write actual, runnable tests (never stub)
- Preserve existing functionality and never delete code without permission
- Follow systematic debugging approach
- Add meaningful comments that explain "why" not just "what"
- Include security considerations for any changes involving user input or external data
- Run relevant tests and verification commands directly when they are needed to validate requested work, and report what was executed along with any failures or gaps.

### Code Quality Standards
- Follow existing code conventions and patterns
- Use existing libraries and utilities (check package.json first)
- Maintain browser compatibility for client-side code (especially scoring-service.js)
- Never expose or log secrets and keys
- Never commit secrets or keys to the repository

### ELO Data Handling Rules
- ELO predictions are written directly to the database by Python scripts for data integrity
- Historical rating data is maintained separately in CSV format for chart performance
- ELO historical data (`data/historical/afl_elo_complete_history.csv`) is automatically regenerated by daily sync when newly completed results are detected (including completions surfaced through `sync-games` and `api-refresh`)
- Manual regeneration only needed when ELO model parameters change or for data integrity issues
- CSV data is authoritative source - chart issues are usually in processing logic (`services/elo-service.js`), not data
- Chart rendering bugs should typically be fixed in frontend/service layer (`public/js/elo-chart.js`)
- The ELO calculation script (`scripts/elo_history_generator.py`) uses optimal trained parameters for consistent results
- Daily sync process ensures ELO chart always reflects latest match results automatically
- Always distinguish between data generation issues vs data presentation issues

### File Modification Guidelines
- Run relevant tests and verification commands directly when they are needed to validate requested work, and report what was executed along with any failures or gaps.
- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User
