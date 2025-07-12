# AFL Predictions Scripts Documentation

This directory contains all the scripts for the AFL predictions system, including ELO model training, optimization, prediction generation, and data management.

## Overview

The AFL prediction system uses a dual-model approach combining two specialized ELO models:
- **Standard ELO Model**: Optimized for win probability accuracy
- **Margin-Only ELO Model**: Optimized specifically for margin prediction accuracy

## Script Structure

```
Standard ELO (Win Predictions):
├── afl_elo_optimize_standard.py      # Optimize for win probability
├── afl_elo_train_standard.py         # Train standard ELO model
├── afl_elo_predict_standard.py       # Generate win predictions
└── afl_elo_margin_methods.py         # Margin methods from standard ELO

Margin-Only ELO (Margin Predictions):
├── afl_elo_optimize_margin.py        # Optimize for margin accuracy
├── afl_elo_train_margin.py           # Train margin-only model
└── afl_elo_predict_margin.py         # Generate margin predictions

Combined Operations:
├── afl_elo_predict_combined.py       # Use both models for best results
├── afl_elo_predict_margin_methods.py # All margin methods comparison
└── afl_elo_history_generator.py      # Generate historical data

Analysis & Comparison:
├── compare_margin_models.py          # Compare margin model performance
└── afl_elo_predictions.py            # Legacy combined prediction script

Node.js Scripts:
├── daily-sync.js                     # Daily synchronization workflow
├── elo-predictions.js                # ELO prediction management
├── api-refresh.js                    # API data refresh
├── import-data.js                    # Database initialization
└── sync-games.js                     # Match data synchronization
```

## Complete ELO Model Training and Prediction Workflow

### Standard ELO (Win Predictions)

#### Optimize for win probability
```bash
python3 scripts/afl_elo_optimize_standard.py --n-calls 100 --n-starts 3 --end-year 2024 --output-path data/optimal_elo_params_standard.json
```

#### Train standard ELO model
```bash
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data
```

#### Generate win predictions
```bash
python3 scripts/afl_elo_predict_standard.py --start-year 2025 --model-path data/afl_elo_trained_to_2024.json --output-dir data
```

#### Optimize margin methods built on ELO model
```bash
python3 scripts/afl_elo_margin_methods.py --elo-params data/afl_elo_trained_to_2024.json --n-calls 50 --output-path data/margin_methods.json
```

#### Generate predictions using all margin methods
```bash
python3 scripts/afl_elo_predict_margin_methods.py --start-year 2025 --elo-model data/afl_elo_trained_to_2024.json --margin-methods data/margin_methods.json --output-dir data --no-save-to-db
```

### Margin-Only ELO (Margin Predictions)

#### Optimize for margin accuracy
```bash
python3 scripts/afl_elo_optimize_margin.py --n-calls 100 --n-starts 5 --start-year 2000 --end-year 2024
```

#### Train margin-only model
```bash
python3 scripts/afl_elo_train_margin.py --params-file data/optimal_margin_only_elo_params.json --end-year 2024 --output-dir data
```

#### Generate margin predictions
```bash
python3 scripts/afl_elo_predict_margin.py --start-year 2025 --model-path data/afl_elo_margin_only_trained_to_2024.json --output-dir data --no-save-to-db
```

### Unified Operations

#### Use both models for best results (saves to existing predictor Dad's AI)
```bash
python3 scripts/afl_elo_predict_combined.py --start-year 2025 --standard-model data/afl_elo_trained_to_2024.json --margin-model data/afl_elo_margin_only_trained_to_2024.json --output-dir data --predictor-id 6
```

#### Generate historical data
```bash
python3 scripts/afl_elo_history_generator.py --model-path data/afl_elo_trained_to_2024.json --output-dir data
```

## Complete Workflows

### Option 1: Combined Approach (Recommended)
Use both models for optimal predictions - standard ELO for win probabilities, margin-only ELO for margins:

```bash
# Standard ELO pipeline
python3 scripts/afl_elo_optimize_standard.py --n-calls 100 --n-starts 3 --end-year 2024 --output-path data/optimal_elo_params_standard.json
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data

# Margin-Only ELO pipeline
python3 scripts/afl_elo_optimize_margin.py --n-calls 100 --n-starts 3 --end-year 2024
python3 scripts/afl_elo_train_margin.py --params-file data/optimal_margin_only_elo_params.json --end-year 2024 --output-dir data

# Combined predictions
python3 scripts/afl_elo_predict_combined.py --start-year 2025 --standard-model data/afl_elo_trained_to_2024.json --margin-model data/afl_elo_margin_only_trained_to_2024.json --output-dir data --predictor-id 6
```

### Option 2: Standard ELO Only
For win probabilities with multiple margin calculation methods:

```bash
python3 scripts/afl_elo_optimize_standard.py --n-calls 100 --n-starts 3 --end-year 2024 --output-path data/optimal_elo_params_standard.json
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data
python3 scripts/afl_elo_predict_standard.py --start-year 2025 --model-path data/afl_elo_trained_to_2024.json --output-dir data
```

### Option 3: Margin-Only ELO
For margin predictions with derived win probabilities:

```bash
python3 scripts/afl_elo_optimize_margin.py --n-calls 100 --n-starts 3 --end-year 2024
python3 scripts/afl_elo_train_margin.py --params-file data/optimal_margin_only_elo_params.json --end-year 2024 --output-dir data
python3 scripts/afl_elo_predict_margin.py --start-year 2025 --model-path data/afl_elo_margin_only_trained_to_2024.json --output-dir data --predictor-id 7
```

## Script Documentation

### Standard ELO Model Scripts (Win Prediction Focused)

#### `afl_elo_optimize_standard.py`
Find optimal standard ELO parameters using Bayesian optimization with multi-start support.

**Parameters:**
- `--n-calls`: Number of optimization calls (default: 100)
- `--n-starts`: Number of random starts for multi-start optimization (default: 3)
- `--end-year`: End year for training data (default: 2024)
- `--output-path`: Path to save optimal parameters JSON file
- `--margin-mode`: Enable margin model optimization mode
- `--elo-params`: Path to ELO parameters file (for margin mode)
- `--output-margin-params`: Path to save margin parameters (for margin mode)

#### `afl_elo_train_standard.py`
Train standard ELO model with optimal parameters.

**Parameters:**
- `--params-file`: Path to ELO parameters JSON file
- `--margin-params`: Path to margin model parameters (optional)
- `--end-year`: End year for training (default: 2024)
- `--output-dir`: Directory to save trained model (default: data)

#### `afl_elo_predict_standard.py`
Generate standard ELO predictions for future matches (win probabilities with built-in margin calculation).

**Parameters:**
- `--start-year`: Start year for predictions (usually 2025)
- `--model-path`: Path to trained standard ELO model file
- `--output-dir`: Directory to save output files (usually `data`)
- `--db-path`: Path to database (default: `data/afl_predictions.db`)
- `--save-to-db`: Save predictions directly to database (default: True)
- `--predictor-id`: Predictor ID for database storage (default: 6)

**Output:** `standard_elo_predictions_YYYY_YYYY.csv` and database entries

### Margin-Only ELO Model Scripts (Margin Prediction Focused)

#### `afl_elo_optimize_margin.py`
Optimize parameters specifically for margin-only ELO model.

**Parameters:**
- `--n-calls`: Number of optimization calls (default: 100)
- `--n-starts`: Number of random starts (default: 3)
- `--end-year`: End year for training data (default: 2024)

**Output:** Creates `data/optimal_margin_only_elo_params.json`

#### `afl_elo_train_margin.py`
Train margin-only ELO model with optimal parameters.

**Parameters:**
- `--params-file`: Path to margin-only ELO parameters JSON file
- `--start-year`: Start year for training (default: 1990)
- `--end-year`: End year for training (default: 2024)
- `--db-path`: Path to database (default: `data/afl_predictions.db`)
- `--output-dir`: Directory to save trained model (default: data)

**Output:** `afl_elo_margin_only_trained_to_YYYY.json`

#### `afl_elo_predict_margin.py`
Generate margin-only ELO predictions for future matches (margins with derived win probabilities).

**Parameters:**
- `--start-year`: Start year for predictions (usually 2025)
- `--model-path`: Path to trained margin-only ELO model file
- `--output-dir`: Directory to save output files (usually `data`)
- `--db-path`: Path to database (default: `data/afl_predictions.db`)
- `--save-to-db`: Save predictions directly to database (default: True)
- `--predictor-id`: Predictor ID for database storage (default: 7)

**Output:** `margin_elo_predictions_YYYY_YYYY.csv` and database entries

### Combined ELO Model Scripts (Best of Both)

#### `afl_elo_predict_combined.py`
Generate optimal predictions using both standard and margin-only models.

**Parameters:**
- `--start-year`: Start year for predictions (usually 2025)
- `--standard-model`: Path to trained standard ELO model file
- `--margin-model`: Path to trained margin-only ELO model file
- `--output-dir`: Directory to save output files (usually `data`)
- `--db-path`: Path to database (default: `data/afl_predictions.db`)
- `--save-to-db`: Save predictions directly to database (default: True)
- `--predictor-id`: Predictor ID for database storage (default: 6)

**Output:** `combined_elo_predictions_YYYY_YYYY.csv` and database entries

**Key Features:**
- Win probabilities from standard ELO model (optimized for accuracy)
- Margin predictions from margin-only model (optimized for MAE)
- Maintains separate rating systems for each model
- Comprehensive CSV output with both prediction methods

#### `afl_elo_predict_margin_methods.py`
Generate predictions using all margin methods for comparison.

**Parameters:**
- `--start-year`: Start year for predictions (usually 2025)
- `--elo-model`: Path to trained ELO model file
- `--margin-methods`: Path to margin methods parameters JSON file
- `--output-dir`: Directory to save output files (usually `data`)
- `--db-path`: Path to database (default: `data/afl_predictions.db`)
- `--no-save-to-db`: Skip database save (CSV only)
- `--predictor-id`: Predictor ID for database storage (required if saving to DB)

**Output:** `margin_methods_predictions_YYYY_YYYY.csv` and optional database entries

#### `afl_elo_history_generator.py`
Generate comprehensive historical ELO data for charting and analysis purposes.

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

### Node.js Management Scripts

#### `daily-sync.js`
Run comprehensive daily synchronization: API refresh, ELO predictions, and historical data regeneration.

**Usage:**
```bash
npm run daily-sync
```

**Process:**
1. Refreshes API data from Squiggle
2. Generates ELO predictions using dual-model approach
3. Regenerates historical ELO data if matches were updated

#### `elo-predictions.js`
Manage ELO prediction generation and database integration.

**Usage:**
```bash
node scripts/elo-predictions.js
```

#### `api-refresh.js`
Refresh match data from Squiggle API.

**Usage:**
```bash
node scripts/api-refresh.js
```

#### `import-data.js`
Initialize database with team data.

**Usage:**
```bash
npm run import
```

#### `sync-games.js`
Sync match data from Squiggle API.

**Usage:**
```bash
npm run sync-games
```

## Margin Prediction Methods Explained

The system provides 5 different approaches to margin prediction for comprehensive analysis:

### 1. **Margin-Only ELO Model** (Standalone)
- **Formula**: `margin = rating_diff * margin_scale`
- **Usage**: Database storage for production predictions
- **Description**: Completely independent ELO model optimized purely for margin prediction

### 2. **Linear Regression Model** (From Win Prediction Model)
- **Formula**: `margin = rating_diff * slope + intercept`
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

## Daily Sync Integration

The daily sync system (`npm run daily-sync`) automatically:
1. Refreshes match data from API
2. Runs `afl_elo_predict_combined.py` to generate new predictions
3. Regenerates historical data if matches were updated
4. Updates predictor ID 6 with combined model predictions

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

### Testing Scripts

Test the daily sync process:
```bash
npm run daily-sync
```

Test individual ELO predictions:
```bash
node scripts/elo-predictions.js
```

Test API refresh:
```bash
npm run sync-games
```

## File Dependencies

**Required Data Files:**
- `data/afl_predictions.db` - SQLite database
- `data/optimal_elo_params_standard.json` - Standard ELO parameters
- `data/optimal_margin_only_elo_params.json` - Margin-only ELO parameters
- `data/afl_elo_trained_to_2024.json` - Trained standard model
- `data/afl_elo_margin_only_trained_to_2024.json` - Trained margin-only model

**Generated Files:**
- `data/afl_elo_complete_history.csv` - Complete historical ratings
- `data/*_predictions_YYYY_YYYY.csv` - Prediction output files
- `data/*_rating_history_from_YYYY.csv` - Rating history files