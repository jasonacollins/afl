# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

For comprehensive project information including architecture, features, and setup instructions, **read the README.md file first**. Additionally, **read ai-instructions.md** for detailed AI/LLM workflow guidelines and communication requirements. This file contains AI-specific development guidelines and rules.

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
- `npm run daily-sync` - Run comprehensive daily synchronization: API refresh, ELO predictions, and historical data regeneration (`scripts/daily-sync.js`)

### ELO Model Scripts
- `python3 scripts/afl_elo_training.py` - Train ELO model with optimal parameters
- `python3 scripts/afl_elo_predictions.py` - Generate ELO predictions for future matches
- `python3 scripts/afl_elo_history_generator.py` - Generate comprehensive historical ELO data for charting

### Docker Commands
- `docker-compose up -d` - Start containerized application
- `docker-compose down` - Stop containers
- `docker-compose logs` - View container logs
- `docker-compose build` - Rebuild containers after code changes

## Architecture Quick Reference

This is an AFL predictions web application built with Node.js/Express and SQLite, following a layered service architecture.

### Key Architectural Patterns

**Service Layer Pattern**: Business logic is separated into service modules (`/services`) that handle specific domains (predictions, matches, scoring, etc.). Route handlers (`/routes`) are thin and delegate to services.

**Promise-Based Database Layer**: Custom database abstraction (`models/db.js`) provides `runQuery()`, `getQuery()`, and `getOne()` helpers that wrap SQLite operations in Promises with structured logging.

**Dual-Environment Code**: The scoring service (`services/scoring-service.js`) is uniquely designed to work in both Node.js and browser environments - it's served as a client-side script via `/js/scoring-service.js`.

### Data Flow Architecture

**User Predictions**: Routes → Services → Database abstraction → SQLite
**ELO Predictions**: Python scripts → Direct database writes (transactional integrity)
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

**ELO Model**: Python-based prediction model (`scripts/afl_elo_*.py`) that trains on historical data and writes predictions directly to the database. Historical rating data is maintained in CSV format (`data/afl_elo_complete_history.csv`) for optimal chart performance, combining transactional integrity with read efficiency.

**ELO Chart**: Interactive visualization on homepage with dual modes:
- Single Year: Round-by-round ELO progression for individual seasons
- Year Range: Multi-year ELO trends using historical data (1990-present)
- Intelligent UI: Context-sensitive controls with automatic updates (no apply button required)
- Advanced team highlighting: Click teams or chart lines to toggle, persistent across view changes with z-order management
- Accurate tooltips: Displays correct year/round information for hovered data points
- Responsive design with clickable header navigation

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

### ELO Data Architecture
The ELO system uses a hybrid approach for optimal performance:
- **Predictions**: Written directly to database by Python scripts (transactional, real-time)
- **Historical Ratings**: Maintained in CSV format for chart performance (read-optimized)
- This separation allows for data integrity in predictions while maintaining fast chart rendering

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

**ELO System Architecture**:
- Hybrid storage approach: predictions in database, historical ratings in CSV
- Direct database writes for ELO predictions ensure transactional integrity
- Single consolidated CSV file (`data/afl_elo_complete_history.csv`) for historical chart data
- Automated pipeline: Daily sync writes predictions to database and regenerates historical CSV when matches update
- Clean separation between operational data (database) and analytical data (CSV)
- Interactive chart with intelligent dual-mode visualization:
  - Conditional UI controls: Only relevant controls shown for selected mode
  - Automatic updates: Immediate chart refresh when changing modes or years
  - Persistent team highlighting: Click teams or chart lines to toggle, selection state maintained across view changes
  - Accurate tooltips: Correct year/round display for all data points
- Smart team rendering: teams only appear in rounds where they actually play
- Enhanced visual design: Vibrant team colors with proper restoration and z-order management
- API endpoints: `/api/elo/ratings/:year` and `/api/elo/ratings/range?startYear=YYYY&endYear=YYYY`

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
- ELO historical data (`data/afl_elo_complete_history.csv`) is automatically regenerated by daily sync when new matches are updated
- Manual regeneration only needed when ELO model parameters change or for data integrity issues
- CSV data is authoritative source - chart issues are usually in processing logic (`services/elo-service.js`), not data
- Chart rendering bugs should typically be fixed in frontend/service layer (`public/js/elo-chart.js`)
- The ELO calculation script (`scripts/afl_elo_history_generator.py`) uses optimal trained parameters for consistent results
- Daily sync process ensures ELO chart always reflects latest match results automatically
- Always distinguish between data generation issues vs data presentation issues

### File Modification Guidelines
- **ALWAYS ASK BEFORE testing or running any development commands** - user will handle testing
- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User