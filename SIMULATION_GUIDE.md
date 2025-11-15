# AFL Season Simulation Guide

## Overview

The season simulation feature uses Monte Carlo methods to project AFL season outcomes based on the ELO margin model. It runs 50,000 simulations of the remaining season fixtures to calculate probabilities for:

- Finals qualification (Top 8)
- Top 4 finish
- Preliminary finals appearance
- Grand Final appearance
- Premiership wins

## Running a Simulation

### Prerequisites

The simulation requires:
- Python 3.7+
- Pandas, NumPy (Python dependencies)
- A trained margin ELO model
- Match data in the database

### Command

```bash
cd scripts
python3 season_simulator.py \
  --year 2025 \
  --model-path ../data/models/margin/afl_elo_margin_only_trained_to_2024.json \
  --db-path ../data/database/afl_predictions.db \
  --num-simulations 50000
```

### Parameters

- `--year`: The season year to simulate (required)
- `--model-path`: Path to the trained margin ELO model JSON file (required)
- `--db-path`: Path to the SQLite database (default: `data/database/afl_predictions.db`)
- `--num-simulations`: Number of Monte Carlo simulations to run (default: 50000)
- `--output`: Output path for results JSON file (default: `data/simulations/season_simulation_YYYY.json`)

## Output

The simulation generates a JSON file in `data/simulations/` with:

- Number of simulations run
- Completed and remaining match counts
- Timestamp
- Results for each team including:
  - Current ELO rating
  - Current win-loss record
  - Projected wins (mean and 10th-90th percentile range)
  - Finals qualification probability
  - Top 4 finish probability
  - Preliminary finals probability
  - Grand Final probability
  - Premiership probability

## Viewing Results

Once the simulation is complete, view the results at:
```
http://localhost:3001/simulation
```

The web interface displays:
- Interactive sortable table of all teams
- Probability visualizations with color-coded bars
- Summary statistics
- Year selector for viewing historical simulations

## How It Works

### Monte Carlo Simulation

The simulator:
1. Loads the current ELO ratings from the trained model
2. Gets current standings from completed matches
3. For each of 50,000 iterations:
   - Simulates all remaining regular season matches
   - Determines final ladder positions
   - Simulates the complete finals series
   - Tracks outcomes for each team

### Match Prediction

Each match outcome is determined by:
- Rating difference between teams
- Home ground advantage (regular season only)
- Small random variation to simulate uncertainty
- Draws occur with ~1% probability

### Finals Series Structure

The simulation models the AFL finals format:
- **Week 1**: Qualifying Finals (1v4, 2v3) and Elimination Finals (5v8, 6v7)
- **Week 2**: Semi Finals (QF losers vs EF winners)
- **Week 3**: Preliminary Finals (QF winners vs SF winners)
- **Week 4**: Grand Final

Top 4 teams get double chances (can lose Week 1 and continue).

## API Endpoints

### Get Available Years
```
GET /api/simulation/years
```

Returns list of years with simulation data available.

### Get Simulation Data
```
GET /api/simulation/:year
```

Returns complete simulation results for the specified year.

### Get Summary
```
GET /api/simulation/:year/summary
```

Returns summarized simulation statistics for the specified year.

## Updating Simulations

Simulations should be regenerated after each round to reflect:
- Updated ELO ratings from completed matches
- Current ladder positions
- Reduced number of remaining fixtures

This ensures probabilities remain accurate as the season progresses.

## Technical Details

### Files

- **Backend**:
  - `scripts/season_simulator.py` - Monte Carlo simulation engine
  - `routes/simulation.js` - API endpoints
  - `app.js` - Route registration

- **Frontend**:
  - `views/simulation.ejs` - Page template
  - `public/js/simulation.js` - Interactive JavaScript
  - `public/css/styles.css` - Styling (simulation section)

### Data Storage

Results are stored as JSON files in `data/simulations/` with format:
```
season_simulation_YYYY.json
```

This approach:
- Avoids database schema changes
- Enables easy caching
- Allows historical comparisons
- Simplifies deployment

## Limitations

The simulation:
- Uses ELO ratings only (no other predictive factors)
- Assumes home ground advantage is consistent
- Does not account for injuries, weather, or form changes
- Treats finals as neutral venues (simplified)
- Cannot predict unlikely events (upsets become more likely in aggregate)

Accuracy typically improves as the season progresses and more matches are completed.
