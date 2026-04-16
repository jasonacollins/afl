# AFL Predictions

A web application that allows users to predict Australian Football League match outcomes and compete on prediction accuracy.

## Application Overview

The AFL Predictions app enables users to:

- Create accounts and make probability-based predictions for upcoming AFL matches
- Express their prediction confidence as a percentage (how likely they think the home team is to win)
- Track prediction accuracy using various scoring metrics:
  - **Tip Points**: Binary scoring for correct match outcome predictions
  - **Brier Score**: Measures prediction calibration (lower is better)
  - **Bits Score**: Information theory-based scoring (higher is better)
- Compare performance on a leaderboard with other predictors
- View historical prediction accuracy across multiple AFL seasons

The app synchronises with the Squiggle API to automatically retrieve match fixtures and results, ensuring up-to-date information throughout the AFL season.

## Key Features

- **Probability-Based Predictions**: Instead of simple win/loss tips, users express confidence as percentages
- **Advanced Scoring System**: Multiple accuracy metrics providing deeper insights into prediction quality
- **Live Match Updates**: Automatic synchronisation with AFL match results
- **User Leaderboards**: Competitive element to compare prediction performance
- **Multi-Season Support**: Historical tracking of predictions across multiple years
- **Interactive ELO Chart**: Visualize team strength over time with multi-team highlighting
- **Dedicated ELO Model Page**: ELO chart and filters are available on `/elo`
- **Dedicated Simulation Page**: Monte Carlo season outcomes are available on `/simulation`
- **Admin Area**: Separate pages for predictor management, user prediction management, scripts, and operational exports/actions
- **Featured Predictor System**: Homepage shows one admin-selected model with performance metrics and round predictions
- **Unified Finals Week Display**: `Elimination Final` and `Qualifying Final` are grouped into one selector slot:
  - pre-2026 seasons: `Finals Week 1`
  - 2026 onward: `Finals Week 2`
  This grouped display is used on `/elo`, `/`, `/predictions`, and `/matches/stats`.
- **Wildcard Finals Support (2026+)**: round selectors include `Wildcard Finals` even when no wildcard fixtures are currently assigned

## Page Structure

- `/` - Predictions homepage (featured model performance + round prediction table)
- `/elo` - ELO team ratings chart and historical filters
- `/simulation` - Season simulation outputs and ladder probability matrices
- `/admin` - Predictor management (featured predictor, add predictor, current predictors)
- `/admin/user-predictions` - Admin editing for user predictions
- `/admin/scripts` - Admin-only scripts runner for operational and training workflows
- `/admin/operations` - Prediction export, database export/upload, and API refresh actions
- Primary nav labels are `Model predictions` (`/`), `ELO` (`/elo`), and `Simulation` (`/simulation`)
- When logged in, nav also includes `Predictor page` (`/predictions`); admins also see `Admin panel` (`/admin`)
- On mobile/laptop breakpoints, homepage season and round selectors are intentionally stacked vertically for readability
- Primary navigation uses a mobile collapsible menu (`public/js/mobile-nav.js`) with keyboard support (`Escape` to close)

Homepage model selection is controlled from the admin dashboard as a single featured predictor (no homepage model selector).

## Admin Scripts Runner

Admins can run operational and training scripts from `/admin/scripts` without shell access.

### Supported Jobs
- `sync-games` (`scripts/automation/sync-games.js`)
- `api-refresh` (`scripts/automation/api-refresh.js`)
- `predictions` (`combined-predictions` key; launched through the `Predictions` card mode switch)
- `win-margin-methods-predictions` (`scripts/elo_margin_methods_predict.py`, launched via `Win + Optimised Margin` mode in the `Predictions` card)
- `margin-predictions` (`scripts/elo_margin_predict.py`, launched via `Margin-only (Derive Win %)` mode in the `Predictions` card)
- `win-train` (`scripts/elo_win_train.py`)
- `win-margin-methods-optimize` (`scripts/elo_margin_methods_optimize.py`, launched from `Train Model` → `Optimise For: Win Probability` step 2)
- `margin-train` (`scripts/elo_margin_train.py`)
- `elo-history` (`scripts/elo_history_generator.py`)
- `season-simulation` (`scripts/season_simulator.py`)

### Operational Behavior
- Jobs run asynchronously in the background.
- Only one job can be active at a time.
- Run metadata is persisted in SQLite (`admin_script_runs`), including `log_path` for each run.
- Stdout/stderr/system logs are persisted to per-run files under `logs/admin-scripts/YYYY/MM/run-<run_id>.log`.
- Long-running runs emit periodic `Progress snapshot` system logs (elapsed, stdout/stderr counts, idle time, and latest parsed progress token when present).
- Legacy DB log rows are archived to `logs/admin-scripts/archive/` and migrated away at startup.
- Restart recovery marks in-flight jobs as `interrupted`.
- `sync-games` is the fixture bootstrap step for a new season (inserts new `matches` rows when they do not exist yet).
- `sync-games` normalizes missing/invalid Squiggle `complete` values to `0` so inserts satisfy `matches.complete` (`NOT NULL`).
- `sync-games` normalizes future incomplete Squiggle `0-0` score placeholders (including goals/behinds) to `NULL` so upcoming fixtures remain unplayed in app logic.
- `api-refresh` is update-only for existing fixtures/results; it does not insert missing matches.
- If `api-refresh` finds API games for a year but zero existing DB matches, it logs a warning telling admins to run `sync-games` first.
- The `Predictions` card includes a model-type mode switch:
  - `Win + Optimised Margin` runs `scripts/elo_margin_methods_predict.py` (win model + optimized margin methods artifact)
  - `Margin-only (Derive Win %)` runs `scripts/elo_margin_predict.py` and writes derived win probabilities + margins
  - The `Win + Optimised Margin` mode supports `Predict future games only` and advanced testing flags (`override completed`, optional `method override`, optional `allow model mismatch`).
- The training UI is a single `Train Model` card with an `Optimise For` selector (`Win Probability` or `Margin`), which routes to `win-train` or `margin-train`.
  - In `Win Probability` mode, a second form is available to run `Optimise Win Margin Methods` (`scripts/elo_margin_methods_optimize.py`).

### Safety and Validation
- Only an allowlisted script catalog can be executed.
- Path parameters are restricted to approved repo subdirectories under `data/`.
- Prediction-writing jobs require an active predictor selection from the UI.

### Model Isolation Policy (Critical)
- Any model, predictor, artifact, automation path, or DB rows not explicitly named in the request are protected by default and must not be changed.
- Testing must be isolated by default: new models are new models, and existing models must not be overwritten unless explicitly requested.
- Experimental model work (for example HA testing) must be isolated to explicitly approved predictors/artifacts (for example predictor `7` / `8` and separate model files).
- Do not repoint `daily-sync` / automation model paths as part of experiments unless explicitly requested.
- Do not replace production DB files to publish experiment outputs; write only scoped predictor rows for the target IDs.
- If a production DB file replacement is explicitly required, take a backup first and verify protected predictors are unchanged before/after replacement.

### Storage Hygiene
- Database and log cleanup is automated by `npm run db-maintenance`.
- Default retention is 30 days for completed `admin_script_runs` rows and run log files.
- Cleanup mode also runs `PRAGMA incremental_vacuum`.
- A scheduled full `VACUUM` runs monthly in the low-traffic maintenance window.

## Season Simulation

The season simulator runs 50,000 Monte Carlo iterations of the remaining fixture to project ladder outcomes, finals progression, and premiership chances. Results are written to `data/simulations/season_simulation_YYYY.json` and surfaced on `/simulation`.

- The `/simulation` page is public, but raw simulation JSON downloads are admin-only.
- Simulation JSON files under `data/simulations/` are generated runtime artifacts rather than source-controlled content. Production should generate and serve its own files.
- The `/simulation` page supports round snapshot tabs (`Before Round X`, finals stages, and `Post`) so users can review historical “before round” states for the same season.
- When a round is in progress (some matches completed, others upcoming), a separate `Current` tab is generated (for example `round-or-current`) while preserving the round-start tab (`OR`, `R1`, etc.).
- Current standings and ELO ratings seed every simulation before match outcomes are sampled.
- Finals series are simulated using season-specific AFL finals formats:
  - pre-2026: standard top-8
  - 2026 onward: top-10 with `Wildcard Finals`, then `Finals Week 2`
- Combined mode uses:
  - win probabilities and win-rating updates from win ELO model
  - margin updates from margin ELO model
- Daily sync writes Dad's AI predictions using the margin-only model (`scripts/elo_margin_predict.py`) for predictor `6`.
- Daily sync regenerates Dad's AI season simulations in margin-only mode (no `--win-model`), using the promoted margin model.
- Any model experiments must not change non-target model artifacts or non-target predictor outputs.
- Completed finals results are treated as hard constraints for later rounds in finals snapshots.
- Percentile win ranges (10th–90th) now interpolate within the cumulative distribution instead of snapping to the nearest integer win count:
  - We locate the discrete win bucket whose probability mass contains the desired percentile.
  - Using the depth of the percentile inside that bucket, we linearly blend toward the neighbouring win total (or back toward the previous value for the upper tail).
  - This preserves realistic fractional bounds while keeping the result inside the attainable win range.
- Run from the project root with:
  ```bash
  python3 scripts/season_simulator.py \
    --year 2026 \
    --model-path data/models/margin/afl_elo_margin_only_trained_to_2025.json \
    --db-path data/database/afl_predictions.db \
    --output data/simulations/season_simulation_2026.json
  ```
  Add `--win-model <path>` to run in combined mode when needed.
  Add `--from-scratch` to ignore actual results and simulate an entire season from the opening round (useful for demos).
  Add `--backfill-round-snapshots` to rebuild snapshots round-by-round for historical tabs. Important: backfill mode resets the target output JSON first, then repopulates snapshots in sequence.

Note: live result updates are driven by the Squiggle games event stream on `https://sse.squiggle.com.au/games`, while the standard REST API remains on `https://api.squiggle.com.au/`. When a game ends, the app performs a targeted API reconciliation for the affected game, then queues the heavier prediction/simulation/ELO recompute work in the background. `npm run daily-sync` remains the scheduled fallback reconciliation: it runs fixture sync for the current season, API refresh, margin-only Dad's AI prediction updates, season simulation regeneration when fixture/result data changed or the current round snapshot is missing, and incremental ELO history updates when newly completed results are detected from either `sync-games` (completed inserts/state transitions) or `api-refresh` score updates.

All Squiggle requests should identify the app with the shared contactable `User-Agent` `AFL Predictions - jason@jasoncollins.me`. SSE is the production live-update path; the older REST polling helper remains secondary and should not be used as the primary live-update mechanism.

Maintenance cron (Sydney local time) is configured as:
- `03:05` daily: `npm run db-maintenance -- --mode=cleanup`
- `03:25` first Sunday monthly: `npm run db-maintenance -- --mode=vacuum`
- `03:40` daily: `npm run daily-sync`

## Architecture

The AFL Predictions application follows a layered architecture pattern built on Node.js and Express.js, designed for maintainability, scalability, and clear separation of concerns.

### Overall Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│  Express Server  │◄──►│ Squiggle API    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ SQLite Database  │
                       └──────────────────┘
```

### Core Components

- **Routes**: Authentication, predictions, matches, ELO data, admin functions
- **Services**: Business logic for predictions, scoring, ELO calculations, user management
- **Models**: Database abstraction with Promise-based ORM and structured logging
- **Scripts**: Background tasks for data sync, ELO model training, and API integration

### Technology Stack

**Backend Framework:**
- **Node.js** - Runtime environment
- **Express.js** - Web application framework
- **EJS** - Server-side templating engine

**Database:**
- **SQLite** - Embedded database for data persistence
- **Custom ORM** - Promise-based database abstraction layer

**Authentication & Security:**
- **express-session** - Session management with SQLite store
- **bcrypt** - Password hashing
- **express-rate-limit** - Login attempt protection
- **helmet** - Security headers including Content Security Policy (CSP)
- **CSRF protection** - Custom middleware for token-based CSRF validation
- **Strict CSP** - All JavaScript in external files, no inline scripts or event handlers

**External Integration:**
- **Squiggle API** - AFL match data source
- **node-fetch** - HTTP client for API requests

**Logging & Monitoring:**
- **Winston** - Structured logging with daily rotation
- **Custom error handling** - Operational vs programmer error classification

**Development & Deployment:**
- **Docker** - Containerisation with multi-stage builds
- **Cron** - Scheduled data synchronisation tasks

### Data Flow

**User Predictions**: Authentication → Prediction submission → Validation → Storage → Real-time scoring
**Data Sync**: Squiggle games event stream or scheduled fallback reconciliation → targeted API refresh → database updates → queued ELO/simulation/history recompute  
**Maintenance**: Daily DB/log retention cleanup + incremental vacuum, plus monthly full SQLite vacuum
**Admin Functions**: Role-based access to user management, database operations, and system monitoring

### Directory Structure

```
afl-predictions/
├── routes/           # HTTP route handlers (presentation layer)
├── services/         # Business logic and processing
├── models/           # Database abstraction and queries
├── middleware/       # Custom middleware (CSRF protection, etc.)
├── utils/            # Shared utilities (logging, error handling)
├── scripts/          # Background tasks and data management
├── views/            # EJS template files
├── public/           # Static assets (CSS, JS, images)
│   └── js/          # Client-side JavaScript (CSP-compliant)
├── data/             # SQLite database files and backups
├── logs/             # Application log files
└── docker/           # Docker configuration files
```

### Key Design Decisions

- **SQLite**: Embedded database for simplicity and sufficient performance
- **Service Layer Pattern**: Business logic separated from routes for maintainability
- **Custom Database Layer**: Promise-based SQLite abstraction with logging
- **Session Authentication**: Simple session management with SQLite store
- **Startup Schema Guard**: Server startup runs database initialization/migrations before binding the HTTP listener
- **Strict CSP**: All client-side JavaScript in external files with no inline scripts for enhanced security
- **Responsive UI Strategy**: Most prediction/stat tables use stacked card rows on small screens; dense simulation tables remain horizontally scrollable with a swipe hint
- **Hybrid Sync**: Event-driven completed-game reconciliation with an early-morning daily fallback
- **Monolithic Deployment**: Single container for operational simplicity

## Testing

The project uses Jest for JavaScript unit and integration coverage, and pytest for Python model and automation tests.

- Test files live under `**/__tests__/**/*.test.js` and `**/*.{spec,test}.js`
- Python tests live under `scripts/tests` and are part of the default test workflow
- The default `npm test` workflow runs Jest with coverage enabled, so the JavaScript global and per-file thresholds in `jest.config.js` are enforced on the main test path
- The default Python test workflow enforces per-file coverage minimums through `scripts/tests/run_pytest_with_coverage.py` across the covered core/model/history/prediction/simulation scripts; treat Python coverage as a gate, not report-only output
- The default Python coverage gate requires the standard `coverage.py` package so selected branch-heavy scripts are checked for branch minimums in addition to per-file line minimums; only use the trace-only fallback intentionally via `AFL_ALLOW_TRACE_COVERAGE=1` when you explicitly want weaker local validation
- Covered Python entrypoints should have direct behavior tests where practical, not only CLI smoke coverage; prefer asserting filtering, save-path, predictor-isolation, compatibility, and carryover behavior close to the imported functions
- For shared core helpers, especially database/file I/O and scoring logic, prefer direct behavior tests that exercise cleanup and error-handling branches close to the source; promote them to explicit branch gates when they become part of the critical test contract
- Coverage is collected from `app.js`, `services/`, `routes/`, `models/`, `middleware/`, `scripts/automation/`, `utils/`, and the browser entrypoints under `public/js/`
- Coverage thresholds are enforced in `jest.config.js`; keep them aligned with intentional test coverage rather than treating coverage as report-only
- In addition to the global JavaScript thresholds, critical app, frontend, service, and automation files may have per-file minimums in `jest.config.js`
- Security-sensitive metadata/config modules, infrastructure utilities (error handling, logging, password hashing), and state-heavy frontend entrypoints should be treated as eligible for explicit per-file gates in `jest.config.js`, not only broad global coverage
- Shared contract modules such as CSRF enforcement, Squiggle request configuration, and cross-runtime scoring logic are good candidates for explicit per-file JavaScript gates when they are part of the critical app contract
- Route and app integration tests use `supertest`
- Security-sensitive app behavior should be covered with real `createApp()` integration tests where practical so CSP, session, CSRF, and middleware ordering regressions are caught by the suite
- When startup behavior changes meaningfully, keep at least one test around `startServer()` with the real initialization path so database bootstrap, recovery ordering, and listener startup are exercised together
- Browser-oriented tests run in the standard Node Jest environment using a lightweight DOM harness, so client-side scripts should remain testable without depending on a real browser runtime
- The shared scoring formulas used by `services/scoring-service.js` and `scripts/core/scoring.py` are covered by cross-runtime contract tests and should remain behaviorally aligned
- Browser entrypoints under `public/js/` are collected for coverage via the `jest.config.js` glob, so new standalone scripts should stay testable in the lightweight DOM harness and should receive explicit per-file thresholds when they become critical
- `app.js` exports `createApp()` and `startServer()` so tests can import the Express app without starting the production listener
- Automation CLI scripts should use a `require.main === module` entrypoint guard and export their main callable functions where practical, so tests can import them without triggering `process.exit()` side effects
- When a script owns CLI exit-code behavior, prefer a thin exported CLI wrapper around the core callable so tests can cover success/failure exits separately from the underlying work
- For database-sensitive work, keep behavioral tests isolated with temporary fixtures, but retain at least one smoke test that boots a fresh database through `initializeDatabase()` so schema drift against the real app bootstrap path is caught
- Database migration tests should cover rollback paths so schema integrity is verified on failure, not just on the happy path
- `models/__tests__/db.test.js` uses a `loadDbModule` helper that creates an isolated SQLite instance via `jest.isolateModules`; the helper exposes `__testLogger` for asserting on logger calls from within the isolated module scope
- For automation scripts that mutate data, prefer a mix of collaborator-mocked unit tests and temporary SQLite integration tests so persistence contracts are exercised directly
- For `scripts/season_simulator.py`, keep direct tests around core probability/rating helpers and finals constraints in addition to snapshot/CLI coverage so simulation math regressions are caught close to the source
- `scripts/tests/run_pytest_with_coverage.py` should not rely on leaving a repo-root `.coverage` artifact behind; treat any such file as disposable local state, not a project output

Core commands:

- `npm test` - run the coverage-gated JavaScript suite and the Python suite
- `npm run test:watch` - run the JavaScript suite in watch mode
- `npm run test:coverage` - generate the JavaScript coverage report in `coverage/` and run the Python suite

## Docker Setup

### Prerequisites

- Docker
- Docker Compose

### Installation and Deployment

1. Clone the repository:
   ```bash
   git clone https://github.com/jasonacollins/afl-predictions.git
   cd afl-predictions
   ```

2. Build and start the Docker container:
   ```bash
   docker-compose up -d
   ```

3. The application will be available at http://localhost:3001

### Managing the Docker Deployment

- **View logs**:
  ```bash
  docker-compose logs
  ```

- **Stop the containers**:
  ```bash
  docker-compose down
  ```

- **After making code changes**, rebuild and restart:
  ```bash
  ./drebuild.sh
  ```
  Or manually:
  ```bash
  docker-compose down
  docker-compose build
  docker-compose up -d
  ```

- **For quick restarts** without rebuilding:
  ```bash
  docker-compose restart
  ```

## Traditional Setup (without Docker)

### Prerequisites

- Node.js
- Git

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with appropriate values
   ```

3. Run database initialization:
   ```bash
   npm run import
   ```

### Development

```bash
npm run dev
```

### Production Deployment with Docker

Production is served from a single VM origin behind Cloudflare:

- Domain: `https://afl.jcx.au`
- GCP project: `afl-predictions-jc`
- VM instance: `afl-predictions-vm` (`34.40.253.178`)
- VM zone: `australia-southeast1-a`
- App path on VM: `/var/www/afl-predictions`

Important guardrail:
- Do not use `gcloud run deploy` for production releases of this site.
- Production changes must be deployed to the VM origin above.

Pre-deploy check from local repo:
```bash
git rev-parse --short HEAD
git rev-parse --short origin/main
```
If these differ, push first so production can pull the same commit.

Pre-deploy safety check for model work:
- Confirm only explicitly requested model artifacts/predictors are modified.
- Confirm automation model paths used by `daily-sync` are unchanged unless explicitly intended.

1. SSH to the VM:
   ```bash
   gcloud compute ssh afl-predictions-vm --project afl-predictions-jc --zone australia-southeast1-a
   ```

2. Pull latest changes and restart the Docker containers:
   ```bash
   cd /var/www/afl-predictions
   git pull origin main
   docker compose down
   docker compose build
   docker compose up -d
   ```

3. If `git pull` is blocked by VM-local tracked-file changes, inspect and stash them before retrying:
   ```bash
   cd /var/www/afl-predictions
   git status --short
   git stash push -u -m "pre-deploy-YYYY-MM-DD"
   ```

4. Verify deployment:
   ```bash
   gcloud compute ssh afl-predictions-vm --project afl-predictions-jc --zone australia-southeast1-a --command "cd /var/www/afl-predictions && git rev-parse --short HEAD && docker compose ps"
   curl -sS "https://afl.jcx.au/js/main.js?v=$(date +%s)" | shasum -a 256
   ```

## Data Sources

The application uses the Squiggle API (https://api.squiggle.com.au) to source match fixtures and results.

## ELO Predictions Model

The application includes an advanced ELO-based prediction system using a dual-model approach:
- **Standard ELO Model**: Optimized for win probability accuracy with venue-based interstate advantage
- **Margin-Only ELO Model**: Optimized specifically for margin prediction accuracy

### Key ELO Features

- **Venue-Based Interstate Advantage**: Automatically detects when teams travel interstate based on actual venue location rather than team designation
- **Dual Home Advantage System**: Different advantage levels for same-state matchups vs interstate travel
- **Comprehensive Venue Database**: Supports venue aliases and location mapping for accurate interstate detection
- **Automated Parameter Optimization**: ELO parameter search driven by walk-forward validation
- **Consolidated Core Logic**: Centralized implementation ensuring consistency across training, optimization, and prediction

### Quick ELO Commands
- `npm run daily-sync` - Complete daily synchronization (fixture sync + API refresh + ELO predictions + conditional simulation snapshot regeneration + incremental ELO history update)
- `npm run db-maintenance -- --mode=cleanup` - Delete old admin script run metadata/logs and run incremental vacuum
- `npm run db-maintenance -- --mode=vacuum` - Run full SQLite vacuum (best in low-traffic window)
- `npm run import` - Initialize database with team data
- `npm run sync-games` - Sync match data from Squiggle API (defaults to current year when no options are provided)

### ELO Scripts Documentation
For comprehensive ELO model training, optimization, and prediction workflows, see **[scripts/README.md](scripts/README.md)**. This includes:
- Complete step-by-step training workflow
- Detailed script parameters and usage examples
- Advanced usage examples and workflows
- Margin prediction methods explanation
- Troubleshooting guides and performance tips

## ELO Chart Visualization

The application includes an interactive ELO chart that displays team strength ratings over time. The chart is available on the dedicated `/elo` page.

### Features

- **Dual View Modes**: Single year (round-by-round) or year range (multi-year trends)
- **Multi-Team Selection**: Toggle multiple teams via legend or chart lines
- **Enhanced Hover Tooltips**: Display team ratings plus game results (opponent, score, outcome)
- **Interactive Controls**: Automatic updates and responsive design
- **Finals Week Consolidation**: `Elimination Final` and `Qualifying Final` share one x-axis/round slot:
  - pre-2026 seasons: `Finals Week 1`
  - 2026 onward: `Finals Week 2`


### Usage

1. **Mode Selection**: Choose Year (single season) or Year Range (multi-year)
2. **Year Selection**: Use dropdowns to select years - chart updates automatically
3. **Team Highlighting**: Click team names or chart lines to toggle highlighting; click again to remove a team from the selection
4. **Navigation**: Use the top menu to switch between Predictions, ELO, and Simulation pages

### Data Sources

- **File**: `data/historical/afl_elo_complete_history.csv` (chart years 2000-present)
- **Seeding**: Replayed from 1990 so the 2000 baseline is properly seeded
- **Updates**: Daily sync appends only newly completed matches (no historical rewrites). Completion detection includes both `sync-games` completed inserts/transitions and `api-refresh` completed score updates.
- **Performance**: Optimized CSV structure for fast chart rendering

### API Endpoints

- `GET /api/elo/years` - Returns available chart years (2000 onward)
- `GET /api/elo/ratings/:year` - Returns processed ELO rating data for a single year (>= 2000)
- `GET /api/elo/ratings/range?startYear=YYYY&endYear=YYYY` - Returns ELO data for year range visualization (>= 2000)
