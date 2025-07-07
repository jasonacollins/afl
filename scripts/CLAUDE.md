# AFL Predictions Scripts Documentation

This file provides detailed documentation for the AFL ELO prediction scripts and workflows.

## Overview

The AFL prediction system uses a dual-model approach combining two specialized ELO models:
- **Standard ELO Model**: Optimized for win probability accuracy
- **Margin-Only ELO Model**: Optimized specifically for margin prediction accuracy (MAE ~30.1 vs ~32.1)

## Complete ELO Model Training and Prediction Workflow

Complete workflow to generate optimal predictions with all margin models for comparison:

```bash
# Step 1: Optimize parameters for primary win prediction model
python3 scripts/afl_elo_optimize_bayesian.py --n-calls 100 --n-starts 3 --end-year 2024 --output-path data/optimal_elo_params_bayesian.json

# Step 2: Optimize parameters for margin-only model (better margin accuracy)
python3 scripts/afl_elo_optimize_margin_only.py --n-calls 100 --n-starts 3 --end-year 2024

# Step 3: Train margin-only model with optimized parameters
python3 scripts/afl_elo_training.py --params-file data/optimal_margin_only_elo_params.json --end-year 2024 --output-dir data

# Step 4: Optimize and train dual-model approach (creates linear regression margins for comparison)
python3 scripts/afl_elo_optimize_bayesian.py --margin-mode --elo-params data/optimal_elo_params_bayesian.json --n-calls 50 --n-starts 3 --output-margin-params data/optimal_elo_margin_params.json
python3 scripts/afl_elo_training.py --params-file data/optimal_elo_params_bayesian.json --margin-params data/optimal_elo_margin_params.json --end-year 2024 --output-dir data

# Step 5: Generate predictions using dual-model approach (win predictions from standard model, margins from margin-only model)
python3 scripts/afl_elo_predictions.py --start-year 2025 --model-path data/afl_elo_trained_to_2024.json --margin-model data/afl_elo_margin_only_trained_to_2024.json --output-dir data
```

**What You Get:**
- **Database**: 
  - **Win Predictions**: Standard ELO model (optimized for win probability accuracy)
  - **Margin Predictions**: Margin-only ELO model (MAE ~30.1, best margin accuracy)
- **CSV**: All margin prediction methods for comparison:
  - `predicted_margin_margin_only_elo`: Best method (used in database)
  - `predicted_margin_linear_regression`: Dual-model method  
  - `predicted_margin_builtin_elo`: Traditional ELO method
  - `predicted_margin_simple_scaling`: Simple scaling method
  - `predicted_margin_diminishing_returns`: Diminishing returns method
  - `margin_method_used_in_db`: Shows which method was used for database

## Script Documentation

### ELO Model Scripts

#### `afl_elo_optimize_bayesian.py`
Find optimal ELO parameters using Bayesian optimization with multi-start support.

**Parameters:**
- `--n-calls`: Number of optimization calls (default: 100)
- `--n-starts`: Number of random starts for multi-start optimization (default: 3)
- `--end-year`: End year for training data (default: 2024)
- `--output-path`: Path to save optimal parameters JSON file
- `--margin-mode`: Enable margin model optimization mode
- `--elo-params`: Path to ELO parameters file (for margin mode)
- `--output-margin-params`: Path to save margin parameters (for margin mode)

#### `afl_elo_optimize_margin_only.py`
Optimize parameters specifically for margin-only ELO model.

**Parameters:**
- `--n-calls`: Number of optimization calls (default: 100)
- `--n-starts`: Number of random starts (default: 3)
- `--end-year`: End year for training data (default: 2024)

**Output:** Creates `data/optimal_margin_only_elo_params.json`

#### `afl_elo_training.py`
Train ELO model with optimal parameters.

**Parameters:**
- `--params-file`: Path to ELO parameters JSON file
- `--margin-params`: Path to margin model parameters (optional)
- `--end-year`: End year for training (default: 2024)
- `--output-dir`: Directory to save trained model (default: data)

#### `afl_elo_predictions.py`
Generate ELO predictions for future matches.

**Parameters:**
- `--start-year`: Start year for predictions (usually 2025)
- `--model-path`: Path to trained ELO model file
- `--margin-model`: Path to separate margin model (optional, for dual-model approach)
- `--output-dir`: Directory to save output files (usually `data`)
- `--db-path`: Path to database (default: `data/afl_predictions.db`)
- `--save-to-db`: Save predictions directly to database (default: True)
- `--predictor-id`: Predictor ID for database storage (default: 6)

**Key Features:**
- Automatically detects model type and uses appropriate prediction method
- Only updates database for games that haven't started
- Generates comprehensive CSV output with all margin prediction methods
- Uses dual-model approach when margin model is provided

#### `afl_elo_history_generator.py`
Generate comprehensive historical ELO data for charting and analysis purposes.

**Usage:**
```bash
python3 scripts/afl_elo_history_generator.py --model-path data/afl_elo_trained_to_2024.json --output-dir data
```

**Parameters:**
- `--model-path`: Path to the trained ELO model JSON file containing optimal parameters
- `--start-year`: Start year for history generation (optional, defaults to all available data)
- `--end-year`: End year for history generation (optional, defaults to all available data)
- `--db-path`: Path to the SQLite database (default: `data/afl_predictions.db`)
- `--output-dir`: Directory to save output files (default: current directory)
- `--output-prefix`: Prefix for output files (default: `afl_elo_complete_history`)

**Output:**
- CSV format for easy data analysis and charting
- Complete match-by-match rating changes for every team
- Season carryover events between years
- Team performance summaries

**Examples:**
```bash
# Generate full history from 1990-2025
python3 scripts/afl_elo_history_generator.py --model-path data/afl_elo_trained_to_2024.json --output-dir data

# Generate specific year range
python3 scripts/afl_elo_history_generator.py --model-path data/afl_elo_trained_to_2024.json --start-year 2020 --end-year 2024
```

### Data Management Scripts

#### `import-data.js`
Initialize database with team data.
```bash
npm run import
```

#### `sync-games.js`
Sync match data from Squiggle API.
```bash
npm run sync-games
```

#### `daily-sync.js`
Run comprehensive daily synchronization: API refresh, ELO predictions, and historical data regeneration.
```bash
npm run daily-sync
```

**Process:**
1. Refreshes API data from Squiggle
2. Generates ELO predictions using dual-model approach
3. Regenerates historical ELO data if matches were updated

## Margin Prediction Methods Explained

The system provides 5 different approaches to margin prediction for comprehensive analysis:

### 1. **Margin-Only ELO Model** (Standalone)
- **Formula**: `margin = rating_diff * margin_scale`
- **MAE**: ~30.1 points (best accuracy)
- **Usage**: Database storage for production predictions
- **Description**: Completely independent ELO model optimized purely for margin prediction

### 2. **Linear Regression Model** (From Win Prediction Model)
- **Formula**: `margin = rating_diff * slope + intercept`
- **MAE**: ~32.1 points
- **Usage**: CSV comparison and fallback method
- **Description**: Uses rating differences from win prediction model with linear regression

### 3. **Built-in ELO Margin** (From Win Prediction Model)
- **Formula**: `margin = (win_probability - 0.5) / beta`
- **Usage**: CSV comparison
- **Description**: Traditional ELO margin calculation using win probability and beta parameter

### 4. **Simple Scaling** (From Win Prediction Model)
- **Formula**: `margin = rating_diff * scale_factor`
- **Usage**: CSV comparison
- **Description**: Basic proportional scaling of rating difference

### 5. **Diminishing Returns** (From Win Prediction Model)
- **Formula**: `margin = (win_probability - 0.5) / beta`
- **Usage**: CSV comparison
- **Description**: Similar to built-in but with optimized beta parameter from margin model

**Key Insight**: Methods 2-5 all derive margins from the win prediction model using different mathematical approaches, while Method 1 uses a completely separate model optimized specifically for margin accuracy.

## Docker Commands

### Core Docker Operations
- `docker-compose up -d` - Start containerized application
- `docker-compose down` - Stop containers
- `docker-compose logs` - View container logs
- `docker-compose build` - Rebuild containers after code changes

## ELO Data Architecture

**Dual-Environment Code**: The scoring service (`services/scoring-service.js`) is uniquely designed to work in both Node.js and browser environments - it's served as a client-side script via `/js/scoring-service.js`.

**ELO Data Architecture**: The ELO system uses a hybrid approach for optimal performance:
- **Predictions**: Written directly to database by Python scripts (transactional, real-time)
- **Historical Ratings**: Maintained in CSV format for chart performance (read-optimized)
- This separation allows for data integrity in predictions while maintaining fast chart rendering
- Hybrid storage approach: predictions in database, historical ratings in CSV
- Direct database writes for ELO predictions ensure transactional integrity
- Single consolidated CSV file (`data/afl_elo_complete_history.csv`) for historical chart data
- Automated pipeline: Daily sync writes predictions to database and regenerates historical CSV when matches update
- Clean separation between operational data (database) and analytical data (CSV)

## ELO Data Handling Rules

- ELO predictions are written directly to the database by Python scripts for data integrity
- Historical rating data is maintained separately in CSV format for chart performance
- ELO historical data (`data/afl_elo_complete_history.csv`) is automatically regenerated by daily sync when new matches are updated
- Manual regeneration only needed when ELO model parameters change or for data integrity issues
- CSV data is authoritative source - chart issues are usually in processing logic (`services/elo-service.js`), not data
- Chart rendering bugs should typically be fixed in frontend/service layer (`public/js/elo-chart.js`)
- The ELO calculation script (`scripts/afl_elo_history_generator.py`) uses optimal trained parameters for consistent results
- Daily sync process ensures ELO chart always reflects latest match results automatically
- Always distinguish between data generation issues vs data presentation issues

## Troubleshooting

### Common Issues

1. **Model File Not Found**: Ensure you're using the correct paths:
   - Standard model: `data/afl_elo_trained_to_2024.json`
   - Margin-only model: `data/afl_elo_margin_only_trained_to_2024.json`

2. **Permission Errors**: Ensure Python scripts have execute permissions and data directory is writable

3. **Database Lock Errors**: Ensure no other processes are accessing the database during script execution

4. **Memory Issues**: Large optimization runs may require substantial RAM - consider reducing `--n-calls` for initial testing

### Performance Tips

- Use `--n-starts 3` for thorough optimization
- Start with smaller `--n-calls` values (50) for testing, increase to 100+ for production
- Monitor RAM usage during Bayesian optimization
- Consider running optimization scripts during off-peak hours