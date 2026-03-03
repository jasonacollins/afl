# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

For comprehensive project information including architecture, features, and setup instructions, **read the README.md file first**. This file contains AI-specific development guidelines and rules.

## Development Commands

### Core Commands
- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon (auto-restart on changes)
- `npm test` - Run Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

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
- Production app path is `/var/www/afl-predictions`.
- Do not deploy production with Cloud Run (`gcloud run deploy`).
- For production updates, deploy on the VM with:
  - `cd /var/www/afl-predictions && git pull origin main`
  - `docker compose down && docker compose build && docker compose up -d`
- Before production deploy, confirm local `HEAD` matches `origin/main`; if not, push first.
- After deployment, verify `https://afl.jcx.au/js/main.js` reflects the new build (hash/marker check).

## AI-Specific Architecture Notes

**Dual-Environment Code**: The scoring service (`services/scoring-service.js`) is uniquely designed to work in both Node.js and browser environments - it's served as a client-side script via `/js/scoring-service.js`.

**Security Architecture**: The application implements strict Content Security Policy (CSP) for security:
- All JavaScript must be in external files (`public/js/`) - no inline scripts allowed
- Event handlers use data attributes with event delegation, not inline `onclick` handlers
- CSRF tokens passed via `window.csrfToken` (set in header partial) for all fetch requests
- CSP configuration in `app.js` blocks `'unsafe-inline'` for scripts
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
- `/admin/scripts` is the admin-only scripts runner for operational and training jobs
- Homepage uses one featured predictor selected in admin (no model selector on `/`).
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
- Cron runs with `CRON_TZ=Australia/Sydney`.
- `03:05` daily: `npm run db-maintenance -- --mode=cleanup`
- `03:25` first Sunday monthly: `npm run db-maintenance -- --mode=vacuum`
- `05:00` daily: `npm run daily-sync`

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
  - The predictions card includes a `Predict future games only` option that maps to `--future-only` for `scripts/elo_predict_combined.py`.
  - The predictions card includes a model-type mode switch:
    - `Combined (Win + Margin)` maps to `combined-predictions` (`scripts/elo_predict_combined.py`)
    - `Margin-only (Derive Win %)` maps to `margin-predictions` (`scripts/elo_margin_predict.py`)
  - Training is presented as one `Train Model` card with an `Optimise For` selector (`Win Probability` or `Margin`) that routes to `win-train` or `margin-train`.

**ELO Data Architecture**: The ELO system uses a hybrid approach for optimal performance:
- **Predictions**: Written directly to database by Python scripts (transactional, real-time)
- **Historical Ratings**: Maintained in CSV format for chart performance (read-optimized)
- **Daily Dad's AI Updates**: `npm run daily-sync` writes predictor `6` using margin-only predictions (`scripts/elo_margin_predict.py`)
- **Daily Dad's AI Simulation Context**: `npm run daily-sync` regenerates season simulations in margin-only mode (`scripts/season_simulator.py` with `--model-path` only)
- This separation allows for data integrity in predictions while maintaining fast chart rendering
- Hybrid storage approach: predictions in database, historical ratings in CSV
- Direct database writes for ELO predictions ensure transactional integrity
- Single consolidated CSV file (`data/historical/afl_elo_complete_history.csv`) for historical chart data
- Automated pipeline: Daily sync performs fixture sync, writes predictions to database, and regenerates historical CSV when matches update
- Clean separation between operational data (database) and analytical data (CSV)

**Season Simulation**: `scripts/season_simulator.py` runs 50,000 Monte Carlo iterations and saves outputs to `data/simulations/season_simulation_YYYY.json` for the `/simulation` page. `npm run daily-sync` regenerates the current season simulation when fixture/result data changed or when the current round snapshot is missing (to ensure round tabs remain available). The simulation page supports round snapshot tabs (before each round/finals stage + post-season). When updating the simulator:
- Keep season-specific finals structure and seeding logic intact (pre-2026 top-8; 2026+ top-10 with `Wildcard Finals` feeding `Finals Week 2`).
- Preserve combined simulation mode behavior (`--win-model` + `--model-path` margin).
- Treat completed finals matches as hard constraints for later-round simulations (eliminated teams must stay eliminated).
- Backfill mode (`--backfill-round-snapshots`) is destructive by design for the target file: it resets the JSON first, then rebuilds snapshots round-by-round.
- Maintain the percentile helper (`interpolate_percentile`) so 10th/90th win bounds are interpolated between adjacent win totals instead of rounding to whole numbers. The helper finds the bucket containing the percentile and linearly blends toward the neighbouring win count (or back toward the previous value at the upper edge) to keep results within the feasible win range.

## Testing Framework

Uses Jest with the following structure:
- Test files: `**/__tests__/**/*.test.js` or `**/*.{spec,test}.js`
- Coverage includes: `services/`, `routes/`, `models/`
- Environment: Node.js
- Coverage reports: `coverage/` directory

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
- When adding new JavaScript, place in appropriate file: `admin.js` (admin only), `home.js` (homepage), or `main.js` (shared)

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
- **ALWAYS ASK BEFORE testing or running any development commands** - user will handle testing

### Code Quality Standards
- Follow existing code conventions and patterns
- Use existing libraries and utilities (check package.json first)
- Maintain browser compatibility for client-side code (especially scoring-service.js)
- Never expose or log secrets and keys
- Never commit secrets or keys to the repository

### ELO Data Handling Rules
- ELO predictions are written directly to the database by Python scripts for data integrity
- Historical rating data is maintained separately in CSV format for chart performance
- ELO historical data (`data/historical/afl_elo_complete_history.csv`) is automatically regenerated by daily sync when new matches are updated
- Manual regeneration only needed when ELO model parameters change or for data integrity issues
- CSV data is authoritative source - chart issues are usually in processing logic (`services/elo-service.js`), not data
- Chart rendering bugs should typically be fixed in frontend/service layer (`public/js/elo-chart.js`)
- The ELO calculation script (`scripts/elo_history_generator.py`) uses optimal trained parameters for consistent results
- Daily sync process ensures ELO chart always reflects latest match results automatically
- Always distinguish between data generation issues vs data presentation issues

### File Modification Guidelines
- **ALWAYS ASK BEFORE testing or running any development commands** - user will handle testing
- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User
