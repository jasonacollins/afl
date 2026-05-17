# AFL Predictions Scripts

This directory contains the AFL predictions system - a modular ELO-based approach using specialized models for optimal accuracy.

## Architecture

The system exposes two prediction-oriented model families. Both publish `home_win_probability` and `predicted_margin`:

- **Win-first model**: Trained win ELO ratings plus a fitted margin adapter.
- **Margin-first model**: Margin ELO ratings that derive win probability from the predicted margin.
- **Core Modules**: Shared components for data handling, model operations, and optimization

## Structure

```
scripts/
├── core/                          # Shared utilities
│   ├── data_io.py                # Data handling & I/O operations
│   ├── elo_core.py               # ELO model implementations  
│   └── optimise.py               # Optimization functions
├── elo_win_*.py                  # Win ELO workflows
├── elo_margin_*.py               # Margin ELO workflows
├── elo_margin_methods_*.py       # Win ELO + margin methods
├── elo_predict_combined.py       # Combined predictions
├── experiments/                   # Development & testing new ideas
├── automation/                    # Node.js automation scripts
└── tests/                        # Test suite
```

## Core Modules

### `core/elo_core.py`
Contains ELO model implementations:
- `AFLEloModel`: Win ELO with margin-adjusted K-factor
- `MarginEloModel`: Margin-focused ELO for direct margin prediction
- `train_elo_model()`: Unified training function

### `core/data_io.py` 
Handles all data operations:
- `fetch_afl_data()`: Load match data from database
- `load_model()` / `save_model()`: Model persistence
- `fetch_matches_for_prediction()`: Get prediction targets
- `save_predictions_to_csv()`: Export predictions

### `core/optimise.py`
Optimization infrastructure:
- `evaluate_model_walkforward()`: Unified evaluation for both model types
- `parameter_tuning_grid_search_unified()`: Unified grid search
- Backward compatibility wrappers for existing scripts

## Scripts

### Win-First Model
```bash
elo_win_optimize.py         # Optimize parameters for win accuracy
elo_win_train.py            # Train win-first ratings and matching margin adapter
elo_win_predict.py          # Generate win-first predictions
```

### Margin-First Model
```bash
elo_margin_optimize.py      # Optimize parameters for margin accuracy
elo_margin_train.py         # Train margin-first model
elo_margin_predict.py       # Generate margin-first predictions
```

### Combined Operations
```bash
elo_predict_combined.py     # Use both models for optimal results
elo_history_generator.py    # Generate historical rating data
```

### Win-First Margin Adapter
```bash
elo_margin_methods_optimize.py    # Backfill or repair margin adapter methods for win-first ratings
elo_margin_methods_predict.py     # Generate win-first predictions using the fitted adapter
```

### Automation
```bash
node scripts/automation/daily-sync.js           # Automated daily workflow
node scripts/automation/elo-predictions.js      # ELO prediction management  
node scripts/automation/api-refresh.js          # Update match data
node scripts/automation/import-data.js          # Import historical data
node scripts/automation/sync-games.js           # Sync game data
```

## Workflows

### Win-First Flow
**Run from project root directory:**
```bash
# Optimize and train the win-first model. Training writes both:
# - data/models/win/afl_elo_win_trained_to_2024.json
# - data/models/win/optimal_margin_methods_trained_to_2024.json
python3 scripts/elo_win_optimize.py \
  --n-calls 100 \
  --end-year 2024 \
  --output-path data/models/win/optimal_elo_params_win.json
python3 scripts/elo_win_train.py --end-year 2024 --params-file data/models/win/optimal_elo_params_win.json

# Publish win probability + predicted margin using the matching adapter
python3 scripts/elo_margin_methods_predict.py --start-year 2025 --elo-model data/models/win/afl_elo_win_trained_to_2024.json --margin-methods data/models/win/optimal_margin_methods_trained_to_2024.json --predictor-id 7

# Optional repair/backfill only: refit an adapter for an existing win-first ratings artifact
python3 scripts/elo_margin_methods_optimize.py --elo-params data/models/win/afl_elo_win_trained_to_2024.json --n-calls 50
```

### Margin-First Flow
**Run from project root directory:**
```bash
python3 scripts/elo_margin_optimize.py --max-combinations 500 --end-year 2025
python3 scripts/elo_margin_train.py --end-year 2025 --params-file data/models/margin/optimal_margin_only_elo_params_trained_to_2025.json  
python3 scripts/elo_margin_predict.py --start-year 2026 --model-path data/models/margin/afl_elo_margin_only_trained_to_2025.json --predictor-id 8
```

## Quick Development

### Running Scripts
All scripts run from the project root directory:
```bash
python3 scripts/elo_win_optimize.py --help
python3 scripts/elo_margin_train.py --help
```

### Testing/Experimental
Use `--override-completed` to update predictions for completed matches (testing purposes):
```bash
python3 scripts/elo_win_predict.py --start-year 2024 --model-path data/models/win/afl_elo_win_trained_to_2024.json --override-completed
```

### Experimenting with New Models
1. Copy any existing script to `experiments/`:
   ```bash
   cp scripts/elo_win_optimize.py scripts/experiments/elo_v2_with_weather.py
   ```
2. Modify and test your ideas
3. Import core utilities: `from core.elo_core import AFLEloModel`
4. The `experiments/` folder is available for testing new ideas without cluttering main scripts

### Development Tips
- **Quick access**: All main scripts at top level
- **Clear naming**: Know exactly what each script does
- **Simple imports**: `from core.data_io import fetch_afl_data`
- **Modular design**: Core utilities in `core/` directory for shared functionality

## Model Parameters

### Win-First Model
- `base_rating`: Initial rating (1500)
- `k_factor`: Learning rate (20-60)
- `home_advantage`: Home ground points (20-100)
- `margin_factor`: Margin influence on rating changes (0.1-0.7)
- `season_carryover`: Rating retention between seasons (0.4-0.8)
- `max_margin`: Margin cap for calculations (60-100)
- `beta`: Win probability to margin conversion (0.02-0.08)

### Margin-First Model
- `base_rating`: Initial rating (1500)
- `k_factor`: Learning rate (20-60)
- `home_advantage`: Home ground points (20-100)
- `season_carryover`: Rating retention between seasons (0.4-0.8)
- `max_margin`: Margin cap for calculations (60-100)
- `margin_scale`: Rating difference to margin conversion (0.02-0.3)
- `scaling_factor`: Margin error to rating change conversion (20-80)

## Output Files

### Trained Models (data/models/)
- Training artifacts commonly append `_trained_to_YYYY` to indicate the train-to cutoff.
- `win/afl_elo_win_trained_to_YYYY.json`: Win-first ratings
- `win/optimal_elo_params_win.json`: Optimized win ELO parameters
- `win/optimal_margin_methods_trained_to_YYYY.json`: Matching fitted margin adapter for win-first ratings
  - New adapter artifacts include required win model year, parameter signature, source path, source file hash, and the outputs they produce.
- `win/afl_elo_win_margin_model_trained_to_YYYY.json`: Optional win-derived margin model artifact
- `margin/afl_elo_margin_only_trained_to_YYYY.json`: Margin-first model with ratings
- `margin/optimal_margin_only_elo_params_trained_to_YYYY.json`: Optimized margin ELO parameters

### Predictions (data/predictions/)
- `win/win_elo_predictions_YYYY_YYYY.csv`: Win-first probabilities + built-in margins
- `win/afl_elo_win_trained_to_YYYY_predictions.csv`: Training predictions from win-first ratings
- `win/margin_methods_predictions_YYYY.csv`: Win-first predictions with fitted margins
- `margin/margin_elo_predictions_YYYY_YYYY.csv`: Margin-first predictions with derived win probabilities
- `combined/combined_elo_predictions_YYYY_YYYY.csv`: Best of both models combined

### Historical Data (data/historical/)
- `afl_elo_complete_history.csv`: Match-by-match rating changes for chart years (2000 onward)
- History replay is seeded from 1990 so 2000 ratings reflect prior seasons.
- `scripts/elo_history_generator.py` supports:
  - `--mode full` for one-off rebuilds
  - `--mode incremental` to append only newly completed matches

### Rating History Files (data/predictions/)
- `combined/*_rating_history_from_YYYY.csv`: Combined model rating evolution
- `margin/*_rating_history_from_YYYY.csv`: Margin-first model rating evolution

## Database Integration

Predictions are stored in the `predictions` table with predictor IDs:
- Predictor 6: Dad's AI (daily sync writes margin-first model outputs)
- Predictor 7: Margin-first model
- Predictor 5: Win-first model

## Daily Automation

The `daily-sync.js` script automatically:
1. Refreshes match data from Squiggle API
2. Generates Dad's AI predictions using the margin-first model
3. Updates database with new predictions
4. Regenerates current-season simulation snapshots when fixture/result data changed or the current round snapshot is missing
5. Incrementally appends ELO history rows only when new completed results arrive (no historical rewrites)

## Margin Prediction Methods

The system provides multiple approaches to margin prediction:

### 1. Margin-First Model
- **Purpose**: Standalone model optimized purely for margin accuracy
- **Formula**: `margin = rating_diff * margin_scale`
- **Usage**: Primary method for database storage

### 2. Win-First Margin Adapter
Built on win-first probabilities with optimized parameters:

- **Linear Regression**: `margin = rating_diff * slope + intercept`
- **Built-in ELO**: `margin = (win_probability - 0.5) / beta`
- **Simple Scaling**: `margin = rating_diff * scale_factor`
- **Diminishing Returns**: `margin = (win_probability - 0.5) / beta_optimized`

### Method Selection
- **Margin-first model**: Use when margin accuracy is the primary goal
- **Win-first model**: Use when you need win-optimized ratings plus margins from the matching fitted adapter
- **Combined approach**: Use the margin-first model for margins and win-first ratings for probabilities when comparing legacy combined outputs.

## Parameter Relationships

**Win-first model `margin_factor`**: Controls how victory margins affect rating changes
**Margin-first model `margin_scale`**: Converts rating differences to predicted margins  
**Margin-first model `scaling_factor`**: Converts margin errors to rating adjustments

These serve different purposes and are not equivalent between models.

## Data Architecture

- **Predictions**: Database storage for real-time access
- **Historical Ratings**: CSV format for chart performance
- **Model Files**: JSON format for persistence and portability
- **Parameters**: JSON format for optimization results
