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
- **Interactive ELO Chart**: Visualize team strength over time with smart team highlighting and optimized data rendering
- **Admin Dashboard**: Tools for managing users and overseeing the prediction platform

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

#### **Presentation Layer (`/routes`)**
- **Authentication Routes** (`auth.js`): User login/logout, session management
- **Prediction Routes** (`predictions.js`): User prediction interface and submission
- **Match Routes** (`matches.js`): Match viewing and management
- **ELO Routes** (`elo.js`): ELO rating data API endpoints for chart visualization
- **Admin Routes** (`admin.js`): Administrative functions, user management, database operations

#### **Business Logic Layer (`/services`)**
- **Predictor Service**: User account management and validation
- **Prediction Service**: Prediction processing and retrieval
- **Match Service**: Match data management and scheduling
- **Round Service**: AFL round logic and ordering
- **Scoring Service**: Prediction accuracy calculations (Brier, Bits, Tip Points)
- **ELO Service**: ELO rating data processing and chart generation (consolidated single-file architecture)
- **Featured Predictions Service**: Homepage content management
- **Password Service**: Password validation and security

#### **Data Access Layer (`/models`)**
- **Database Module** (`db.js`): SQLite connection management, query helpers, schema initialisation
- **Custom Query Interface**: Promise-based wrappers for database operations (`runQuery`, `getQuery`, `getOne`)

#### **Utility Layer (`/utils`)**
- **Error Handler**: Centralised error management with operational error classification
- **Logger**: Winston-based logging with file rotation and structured logging

#### **External Integration (`/scripts`)**
- **API Refresh**: Automated synchronisation with Squiggle API for match data
- **Data Import**: Database initialisation and team data setup
- **ELO Model**: Machine learning prediction model training and execution

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

#### **User Prediction Flow:**
1. User authenticates via `/login` route
2. Session established with SQLite-backed store
3. User navigates to `/predictions` for current AFL round
4. Prediction submitted via POST request
5. Service layer validates and stores prediction
6. Real-time scoring calculated when match results available

#### **Data Synchronisation Flow:**
1. Cron job triggers API refresh script
2. Fetch latest match data from Squiggle API
3. Compare with local database state
4. Update match fixtures and scores
5. Recalculate user prediction scores
6. Log synchronisation results

#### **Admin Management Flow:**
1. Admin authentication with role verification
2. Access to user management, database operations
3. Database backup/restore functionality
4. Featured predictor configuration
5. System monitoring and logs access

### Directory Structure

```
afl-predictions/
├── routes/           # HTTP route handlers (presentation layer)
├── services/         # Business logic and processing
├── models/           # Database abstraction and queries
├── utils/            # Shared utilities (logging, error handling)
├── scripts/          # Background tasks and data management
├── views/            # EJS template files
├── public/           # Static assets (CSS, JS, images)
├── data/             # SQLite database files and backups
├── logs/             # Application log files
└── docker/           # Docker configuration files
```

### Key Architectural Decisions

**SQLite Choice**: Selected for simplicity, minimal administration, and sufficient performance for the prediction use case with embedded deployment.

**Service Layer Pattern**: Business logic separated from route handlers to improve testability and maintainability.

**Custom Database Layer**: Promise-based abstraction over SQLite to provide consistent error handling and logging.

**Session-Based Authentication**: Simple session management suitable for the user base size and security requirements.

**External API Integration**: Scheduled synchronisation rather than real-time to reduce API load and improve reliability.

**Monolithic Deployment**: Single container deployment for operational simplicity while maintaining clear internal boundaries.

## Environment Details

- **Production Environment**: `/var/www/afl-predictions`
- **Database**: SQLite (sessions stored in `data/sessions.db`)

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

The application includes an ELO-based prediction model that can be trained on historical match data and used to make predictions for future matches.

### Training the Model

To train the ELO model using historical data up to a specific year:

```bash
python scripts/afl_elo_training.py --start-year 1990 --end-year 2024 --output-dir scripts
```

Parameters:
- `--start-year`: The start year for training data (default: 1990)
- `--end-year`: The end year for training data (inclusive)
- `--output-dir`: Directory to save output files
- `--no-tune-parameters`: Skip parameter tuning (faster but may give worse results)
- `--cv-folds`: Number of cross-validation folds for parameter tuning (default: 3)
- `--max-combinations`: Maximum number of parameter combinations to test (default: 500)

The training process will:
1. Find optimal parameters using cross-validation (unless `--no-tune-parameters` is specified)
2. Train the model on all data from the start year to the end year
3. Output a model file (e.g., `afl_elo_trained_to_2024.json`) and predictions file

Example with all parameters:
```bash
python3 scripts/afl_elo_training.py --start-year 1990 --end-year 2024 --output-dir scripts --cv-folds 5 --max-combinations 1000
```

### Making Predictions

Once a model is trained, you can use it to make predictions for future matches:

```bash
python3 scripts/afl_elo_predictions.py --start-year 2025 --model-path scripts/afl_elo_trained_to_2024.json --output-dir scripts
```

Parameters:
- `--start-year`: Start year for predictions (inclusive)
- `--model-path`: Path to the trained ELO model JSON file
- `--db-path`: Path to the SQLite database (default: `../data/afl_predictions.db`)
- `--output-dir`: Directory to save output files

The prediction process will:
1. Load the trained model
2. Make predictions for all matches from the start year onwards
3. Generate two output files:
   - Predictions file (e.g., `afl_elo_predictions_from_2025.csv`)
   - Rating history file (e.g., `afl_elo_rating_history_from_2025.csv`)

### Generating Historical ELO Data

To generate complete ELO rating history for charting and analysis purposes:

```bash
python3 scripts/afl_elo_history_generator.py --model-path scripts/afl_elo_trained_to_2024.json --output-dir scripts
```

Parameters:
- `--model-path`: Path to the trained ELO model JSON file containing optimal parameters
- `--start-year`: Start year for history generation (optional, defaults to all available data)
- `--end-year`: End year for history generation (optional, defaults to all available data)
- `--db-path`: Path to the SQLite database (default: `data/afl_predictions.db`)
- `--output-dir`: Directory to save output files (default: current directory)
- `--output-prefix`: Prefix for output files (default: `afl_elo_complete_history`)

This generates comprehensive ELO history files:
- CSV format for easy data analysis and charting
- Complete match-by-match rating changes for every team
- Season carryover events between years
- Team performance summaries

Examples:
```bash
# Generate full history from 1990-2025
python3 scripts/afl_elo_history_generator.py --model-path scripts/afl_elo_trained_to_2024.json

# Generate specific year range
python3 scripts/afl_elo_history_generator.py --model-path scripts/afl_elo_trained_to_2024.json --start-year 2020 --end-year 2024
```

## ELO Chart Visualization

The application includes an interactive ELO chart that displays team strength ratings over time. The chart is located on the home page below the featured predictor section.

### Features

- **Dual View Modes**: Toggle between single year view and multi-year range view
- **Year Selection**: Dropdown to view ELO charts for individual AFL seasons
- **Year Range Selection**: Select start and end years to view long-term ELO trends (1990-present)
- **Team Selection**: Click any team in the legend to highlight that team's progression
- **Multiple Team Selection**: Ctrl/Cmd+click to select multiple teams for comparison
- **Visual Design**: Bold, vibrant colors with selected teams highlighted against faded gray background
- **Responsive Layout**: Adapts to different screen sizes with optimized mobile view

### Chart Modes

#### Single Year Mode
- Shows ELO ratings at the start of each round (OR, 1-23, plus finals)
- Round-based timeline with proper AFL round ordering
- Displays current ratings as the "next round" progression

#### Year Range Mode
- Displays ELO trends across multiple years (e.g., 2020-2025)
- Uses historical ELO data generated with optimal model parameters
- Period-based timeline showing year-round combinations (e.g., "2020 R1", "2020 R2")
- Ideal for analyzing long-term team performance and comparing different eras

### Usage

1. **Select Chart Mode**: Choose between "Year" (single season) or "Year Range" (multi-year) modes
2. **Single Year View**: 
   - Use the year dropdown to select a specific AFL season
   - View round-by-round ELO progression
3. **Year Range View**:
   - Select start and end years from the dropdown menus
   - Click "Apply" to generate the multi-year chart
   - Default shows last 5 years for quick access
4. **Team Interaction**:
   - Click any team name in the legend to highlight only that team
   - Hold Ctrl/Cmd and click team names to select multiple teams
   - Click the same team again to deselect

### Data Sources

The ELO chart uses a single consolidated data source:

- **File**: `data/afl_elo_complete_history.csv` (contains all ELO data from 1897-present)
- **Structure**: Clean match-only data with no redundant season carryover entries
- **Coverage**: Complete historical ELO ratings for both single-year and year-range visualizations
- **Data Integrity**: Uses actual CSV rating values ensuring accurate chart rendering
- **Performance**: Optimized data structure with reduced file size while maintaining identical ELO calculations

### API Endpoints

- `GET /api/elo/years` - Returns available years for ELO data
- `GET /api/elo/ratings/:year` - Returns processed ELO rating data for single year visualization
- `GET /api/elo/ratings/range?startYear=YYYY&endYear=YYYY` - Returns ELO data for year range visualization