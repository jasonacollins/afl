# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon (auto-restart on changes)
- `npm test` - Run Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

### Data Management
- `npm run import` - Initialize database with team data (`scripts/import-data.js`)
- `npm run sync-games` - Sync match data from Squiggle API (`scripts/sync-games.js`)
- `npm run daily-sync` - Run daily synchronization tasks (`scripts/daily-sync.js`)

### ELO Model Scripts
- `python3 scripts/afl_elo_training.py` - Train ELO model with optimal parameters
- `python3 scripts/afl_elo_predictions.py` - Generate ELO predictions for future matches
- `python3 scripts/afl_elo_history_generator.py` - Generate comprehensive historical ELO data for charting

### Docker Commands
- `docker-compose up -d` - Start containerized application
- `docker-compose down` - Stop containers
- `docker-compose logs` - View container logs
- `docker-compose build` - Rebuild containers after code changes

## Architecture Overview

This is an AFL predictions web application built with Node.js/Express and SQLite, following a layered service architecture.

### Key Architectural Patterns

**Service Layer Pattern**: Business logic is separated into service modules (`/services`) that handle specific domains (predictions, matches, scoring, etc.). Route handlers (`/routes`) are thin and delegate to services.

**Promise-Based Database Layer**: Custom database abstraction (`models/db.js`) provides `runQuery()`, `getQuery()`, and `getOne()` helpers that wrap SQLite operations in Promises with structured logging.

**Dual-Environment Code**: The scoring service (`services/scoring-service.js`) is uniquely designed to work in both Node.js and browser environments - it's served as a client-side script via `/js/scoring-service.js`.

### Data Flow Architecture

**User Predictions**: Routes → Services → Database abstraction → SQLite
**API Synchronization**: Cron jobs → Scripts → Squiggle API → Database → Score recalculation
**Authentication**: Session-based with SQLite session store (`data/sessions.db`)

### Core Services

- **scoring-service.js**: Brier score, Bits score, and tip point calculations (client/server compatible)
- **prediction-service.js**: User prediction management and validation
- **match-service.js**: AFL match data handling and scheduling (now orders matches chronologically)
- **round-service.js**: AFL season and round logic
- **predictor-service.js**: User account management
- **elo-service.js**: ELO rating data processing, supports both single-year and year-range filtering
- **featured-predictions.js**: Homepage content management
- **password-service.js**: Password validation with security rules

### Database Architecture

SQLite with custom Promise-based ORM. Two databases:
- `data/afl_predictions.db` - Main application data
- `data/sessions.db` - Express session storage

Database queries use structured logging through Winston, with all operations logged for debugging.

### External Integrations

**Squiggle API**: Primary data source for AFL fixtures and results. Scripts handle automated synchronization with caching in `data/cache/`.

**ELO Model**: Python-based prediction model (`scripts/afl_elo_*.py`) that can be trained on historical data and generate predictions for future matches. Includes comprehensive history generation for charting purposes.

**ELO Chart**: Interactive visualization on homepage with dual modes:
- Single Year: Round-by-round ELO progression for individual seasons
- Year Range: Multi-year ELO trends using historical data (1990-present)
- Features team selection, highlighting, and responsive design

## Testing Framework

Uses Jest with the following structure:
- Test files: `**/__tests__/**/*.test.js` or `**/*.{spec,test}.js`
- Coverage includes: `services/`, `routes/`, `models/`
- Environment: Node.js
- Coverage reports: `coverage/` directory

## Important Implementation Notes

### Security Considerations
- Session secret configured via `SESSION_SECRET` environment variable
- Passwords hashed with bcrypt
- Rate limiting on authentication endpoints
- SQLite session store for production persistence

### Logging
Winston-based logging with daily rotation in `logs/` directory. All database operations are logged with query details and performance metrics.

### Client-Side Code Sharing
The scoring service is served to browsers via Express route - any changes must maintain browser compatibility and avoid server-side dependencies.

### Environment Configuration
- Database path: `DB_PATH` environment variable (defaults to `data/afl_predictions.db`)
- Session configuration via environment variables
- See `example-env-production-file.txt` for production setup

### Recent Key Updates

**ELO Predictions Enhancement (June 2025)**:
- Enhanced `scripts/elo-predictions.js` with better logging and verification of rating history file preservation
- Updated `scripts/api-refresh.js` to handle fixture updates (dates, times, venues) for existing matches
- Modified `services/match-service.js` to order matches chronologically instead of by match ID
- Created `scripts/afl_elo_history_generator.py` for comprehensive historical ELO data generation

**ELO Chart Enhancement (June 2025)**:
- Added year range filtering capability to ELO chart (1990-present)
- Updated `services/elo-service.js` with `getEloRatingsForYearRange()` method
- Added new API endpoint: `GET /api/elo/ratings/range?startYear=YYYY&endYear=YYYY`
- Enhanced frontend with dual-mode toggle (Year vs Year Range)
- Improved chart container sizing and legend positioning

## AI/LLM Specific Instructions

When working on this codebase, follow the comprehensive guidelines in `ai-instructions.md`, which includes:
- Never start coding without explaining your plan and getting approval
- Implement changes step-by-step with confirmation
- Write actual, runnable tests (never stub)
- Preserve existing functionality and never delete code without permission
- Follow systematic debugging approach
- Add meaningful comments that explain "why" not just "what"
- Include security considerations for any changes involving user input or external data