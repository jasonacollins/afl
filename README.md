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
- **Admin Dashboard**: Tools for managing users and overseeing the prediction platform
- **Admin Scripts Runner**: Dedicated `/admin/scripts` page to run sync, prediction, simulation, and model training jobs with persisted logs/history
- **Featured Predictors System**: Homepage dropdown allowing users to view different predictor models and performance metrics

## Page Structure

- `/` - Predictions homepage (featured model performance + round prediction table)
- `/elo` - ELO team ratings chart and historical filters
- `/simulation` - Season simulation outputs and ladder probability matrices
- `/admin/scripts` - Admin-only scripts runner for operational and training workflows

## Admin Scripts Runner

Admins can run operational and training scripts from `/admin/scripts` without shell access.

### Supported Jobs
- `sync-games` (`scripts/automation/sync-games.js`)
- `api-refresh` (`scripts/automation/api-refresh.js`)
- `predictions` (`combined-predictions` key, `scripts/elo_predict_combined.py`)
- `win-train` (`scripts/elo_win_train.py`)
- `margin-train` (`scripts/elo_margin_train.py`)
- `elo-history` (`scripts/elo_history_generator.py`)
- `season-simulation` (`scripts/season_simulator.py`)

### Operational Behavior
- Jobs run asynchronously in the background.
- Only one job can be active at a time.
- Run metadata and stdout/stderr logs are persisted in SQLite:
  - `admin_script_runs`
  - `admin_script_run_logs`
- Restart recovery marks in-flight jobs as `interrupted`.
- The `Predictions` card supports a `Predict future games only` option:
  - enabled: only upcoming fixtures are output/saved
  - disabled: full-year prediction output is generated from the chosen `startYear`
- The training UI is a single `Train Model` card with an `Optimise For` selector (`Win Probability` or `Margin`), which routes to `win-train` or `margin-train`.

### Safety and Validation
- Only an allowlisted script catalog can be executed.
- Path parameters are restricted to approved repo subdirectories under `data/`.
- Prediction-writing jobs require an active predictor selection from the UI.

## Season Simulation

The season simulator runs 50,000 Monte Carlo iterations of the remaining fixture to project ladder outcomes, finals progression, and premiership chances. Results are written to `data/simulations/season_simulation_YYYY.json` and surfaced on `/simulation`.

- Current standings and ELO ratings seed every simulation before match outcomes are sampled.
- Finals series are simulated using the AFL finals format with double chances for the top four.
- Percentile win ranges (10th–90th) now interpolate within the cumulative distribution instead of snapping to the nearest integer win count:
  - We locate the discrete win bucket whose probability mass contains the desired percentile.
  - Using the depth of the percentile inside that bucket, we linearly blend toward the neighbouring win total (or back toward the previous value for the upper tail).
  - This preserves realistic fractional bounds while keeping the result inside the attainable win range.
- Run from the project root with:
  ```bash
  python3 scripts/season_simulator.py \
    --year 2025 \
    --model-path data/models/margin/afl_elo_margin_only_trained_to_2024.json \
    --db-path data/database/afl_predictions.db \
    --output data/simulations/season_simulation_2025.json
  ```
  Add `--from-scratch` to ignore actual results and simulate an entire season from the opening round (useful for demos).

Note: `npm run daily-sync` runs fixture sync for the current season, API refresh, ELO prediction updates, and ELO history regeneration. Season simulation generation is a separate step run via `scripts/season_simulator.py`.

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
**Data Sync**: Daily cron job → Squiggle API → Database updates → ELO predictions → Score recalculation
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
- **Scheduled Sync**: Daily API synchronization rather than real-time
- **Monolithic Deployment**: Single container for operational simplicity


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

1. Pull latest changes:
   ```bash
   cd /var/www/afl-predictions
   git pull
   ```

2. Rebuild and restart the Docker containers:
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

3. Verify deployment:
   ```bash
   docker-compose ps
   docker-compose logs
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
- **Bayesian Parameter Optimization**: Automated optimization of ELO parameters using walk-forward validation
- **Consolidated Core Logic**: Centralized implementation ensuring consistency across training, optimization, and prediction

### Quick ELO Commands
- `npm run daily-sync` - Complete daily synchronization (fixture sync + API refresh + ELO predictions + historical data)
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


### Usage

1. **Mode Selection**: Choose Year (single season) or Year Range (multi-year)
2. **Year Selection**: Use dropdowns to select years - chart updates automatically
3. **Team Highlighting**: Click team names to highlight, Ctrl/Cmd+click for multiple
4. **Navigation**: Use the top menu to switch between Predictions, ELO, and Simulation pages

### Data Sources

- **File**: `data/historical/afl_elo_complete_history.csv` (1897-present)
- **Updates**: Automated daily regeneration when new match results available
- **Performance**: Optimized CSV structure for fast chart rendering

### API Endpoints

- `GET /api/elo/years` - Returns available years for ELO data
- `GET /api/elo/ratings/:year` - Returns processed ELO rating data for single year visualization
- `GET /api/elo/ratings/range?startYear=YYYY&endYear=YYYY` - Returns ELO data for year range visualization
