# AFL Predictions

AFL Predictions is a Node.js and Express application for AFL forecasting, leaderboard tracking, ELO analysis, and season simulation.

## What The App Does

- Lets users submit probability-based predictions for AFL matches
- Scores predictors with tip points, Brier score, and bits score
- Publishes a public predictions homepage, ELO page, simulation page, and stats page
- Syncs fixtures and results from Squiggle
- Provides an admin area for predictor management, user-prediction management, operational scripts, and database operations

## Main Pages

- `/` - featured model predictions homepage
- `/elo` - historical ELO chart and filters
- `/simulation` - season simulation outputs and round snapshots
- `/predictions` - predictor picks by season and round
- `/matches/stats` - leaderboard, round results, and cumulative standings
- `/admin` - predictor management
- `/admin/user-predictions` - user-prediction editing
- `/admin/scripts` - admin scripts runner
- `/admin/operations` - exports, uploads, and operational actions

User-facing navigation is centered around `Model predictions`, `ELO`, and `Simulation`. The app also normalizes finals labels for display: pre-2026 seasons show `Finals Week 1`, while 2026 onward uses `Finals Week 2` and includes `Wildcard Finals`.

## Architecture

### Stack

- Node.js with Express
- EJS templates
- SQLite
- Jest for JavaScript tests
- pytest for Python tests
- Docker for containerized deployment

### Structure

```text
afl-predictions/
├── routes/       HTTP routes
├── services/     business logic
├── models/       database access
├── middleware/   auth, CSRF, and request middleware
├── scripts/      automation, training, and simulation scripts
├── views/        EJS templates
├── public/       static assets
├── data/         SQLite data, models, and generated outputs
├── logs/         application and job logs
└── docker/       container config
```

### Data And Model Flow

- Match fixtures and results come from Squiggle.
- Predictions are stored in SQLite.
- ELO predictions are written directly to the database by the Python model scripts.
- Historical ELO chart data is served from `data/historical/afl_elo_complete_history.csv`.
- Season simulations are written to `data/simulations/season_simulation_YYYY.json`.

The app uses Squiggle's API plus the games event stream for live result reconciliation, with `npm run daily-sync` as the scheduled fallback workflow.

## Core Commands

### App

- `npm start` - start the production server
- `npm run dev` - start the development server with auto-restart

### Data And Operations

- `npm run import` - initialize the database with team data
- `npm run sync-games` - sync fixtures and match results from Squiggle
- `npm run daily-sync` - run the daily sync pipeline
- `npm run db-maintenance -- --mode=cleanup` - clean old run metadata and logs, then run incremental vacuum
- `npm run db-maintenance -- --mode=vacuum` - run a full SQLite `VACUUM`

### Tests

- `npm test` - run coverage-gated JavaScript and Python tests
- `npm run test:watch` - run the JavaScript suite in watch mode
- `npm run test:coverage` - run JavaScript coverage plus the Python suite

For detailed model-training and prediction workflows, see [scripts/README.md](scripts/README.md).

## Admin Scripts Runner

Admins can trigger allowlisted operational and model scripts from `/admin/scripts` without shell access.

Supported workflows include:

- fixture and result sync
- prediction generation
- win and margin model training
- win-margin method optimization
- ELO history regeneration
- season simulation generation

Operationally:

- jobs run asynchronously
- only one admin script job can be active at a time
- run metadata is stored in SQLite
- run logs are written to `logs/admin-scripts/`

## Development Setup

### Docker

Prerequisites:

- Docker
- Docker Compose

Run:

```bash
docker-compose up -d
```

The app is then available at `http://localhost:3001`.

Useful commands:

- `docker-compose logs`
- `docker-compose down`
- `docker-compose build`
- `docker-compose restart`

### Local Development

Prerequisites:

- Node.js 16+
- Python 3
- Git

Setup:

```bash
npm install
cp .env.example .env
npm run import
npm run dev
```

## Testing

The project uses Jest for JavaScript coverage and pytest for Python model and automation coverage.

- JavaScript tests cover the app, routes, services, middleware, automation helpers, and browser entrypoints under `public/js/`
- Python tests live under `scripts/tests`
- `npm test` is the main gated path and enforces coverage in both languages
- `app.js` exposes `createApp()` and `startServer()` so integration tests can exercise the real app bootstrap path

## Security And Operations

- The app uses strict CSP, CSRF protection, session-based auth, login rate limiting, and password hashing.
- Request logging redacts secrets such as passwords, CSRF tokens, cookies, and auth headers.
- Database export/upload flows are handled through a dedicated service layer rather than ad hoc file copying.

## Production Deployment

Production runs on a VM origin behind Cloudflare, not Cloud Run.

- Domain: `https://afl.jcx.au`
- GCP project: `afl-predictions-jc`
- VM: `afl-predictions-vm`
- Zone: `australia-southeast1-a`
- App path: `/var/www/afl-predictions`

Deploy from the VM with:

```bash
gcloud compute ssh afl-predictions-vm --project afl-predictions-jc --zone australia-southeast1-a
cd /var/www/afl-predictions
git pull origin main
docker compose down
docker compose build
docker compose up -d
```

Before deploying:

- confirm local `HEAD` matches `origin/main`
- confirm only intended model artifacts or predictor outputs are being promoted

After deploying, verify the running revision and confirm the served asset build updated as expected.

## Notes For Maintainers

- `sync-games` is the fixture bootstrap step for new seasons.
- `api-refresh` updates existing fixtures and results but does not insert missing matches.
- `daily-sync` handles scheduled reconciliation, prediction refresh, simulation refresh, and ELO history updates.
- `data/simulations/*.json` are generated runtime artifacts and should not be committed.
