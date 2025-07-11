# AFL Predictions Scripts Documentation

This directory contains all the scripts for the AFL predictions system, including ELO model training, optimization, prediction generation, and data management.

## Architecture

The codebase is organized into modular components:

```
Core Modules:
├── data_io.py                        # Database operations and file I/O
├── elo_core.py                       # ELO model implementation  
└── optimise.py                       # Optimization strategies and evaluation

Application Scripts:
├── afl_elo_optimize_standard.py      # ELO parameter optimization
├── afl_elo_train_standard.py         # Model training
├── afl_elo_predict_standard.py       # Generate win predictions
├── afl_elo_predict_combined.py       # Use both models for best results
├── afl_elo_history_generator.py      # Generate historical data
└── afl_elo_margin_methods.py         # Margin methods optimization

Specialized Scripts:
├── afl_elo_optimize_margin.py        # Margin-only ELO optimization
├── afl_elo_train_margin.py           # Margin-only ELO training
├── afl_elo_predict_margin.py         # Margin-only predictions
└── afl_elo_predictions.py            # Legacy combined prediction script

Tests & Development:
└── tests/                           # Test and debug scripts
    ├── test_optimization.py         # Optimization functionality tests
    ├── test_home_advantage.py       # Home advantage logic tests
    ├── test_venue_interstate_logic.py # Venue logic tests
    ├── debug_optimization.py        # Optimization debugging
    └── requirements-test.txt        # Test dependencies

Node.js Scripts:
├── daily-sync.js                     # Daily synchronization workflow
├── elo-predictions.js                # ELO prediction management
├── api-refresh.js                    # API data refresh
├── import-data.js                    # Database initialization
└── sync-games.js                     # Match data synchronization
```

## Overview

The AFL prediction system uses a three-tier approach:

1. **Standard ELO Model**: Optimized for win probability accuracy
2. **Margin Predictions from Standard ELO**: Uses the standard model's ratings with optimized margin calculation methods
3. **Dedicated Margin-Only ELO Model**: Separate model optimized purely for margin prediction accuracy

## Complete ELO Model Training and Prediction Workflow

### 1. Standard ELO Model (Win Predictions)

#### Optimize for win probability
```bash
python3 scripts/afl_elo_optimize_standard.py --start-year 2000 --end-year 2024 --output-path data/optimal_elo_params_standard.json
```

#### Train standard ELO model
```bash
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data
```

#### Generate win predictions
```bash
python3 scripts/afl_elo_predict_standard.py --start-year 2025 --model-path data/afl_elo_trained_to_2024.json --output-dir data --no-save-to-db
```

### 2. Margin Predictions Built on Standard ELO Model

#### Optimize margin methods using standard ELO ratings
```bash
python3 scripts/afl_elo_margin_methods.py --elo-params data/optimal_elo_params_standard.json --n-calls 50 --output-path data/optimal_margin_methods.json
```

#### Generate predictions using optimized margin methods
```bash
python3 scripts/afl_elo_predict_margin_methods.py --start-year 2025 --elo-model data/afl_elo_trained_to_2024.json --margin-methods data/optimal_margin_methods.json --output-dir data --no-save-to-db
```

### 3. Dedicated Margin-Only ELO Model

#### Optimize for margin accuracy
```bash
python3 scripts/afl_elo_optimize_margin.py --start-year 2000 --end-year 2024 --test-year 2024
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

### Complete Workflow (All Three Tiers)

```bash
# 1. Standard ELO Model
python3 scripts/afl_elo_optimize_standard.py --end-year 2024 --test-year 2024 --output-path data/optimal_elo_params_standard.json
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data

# 2. Margin methods built on standard ELO
python3 scripts/afl_elo_margin_methods.py --elo-params data/optimal_elo_params_standard.json --n-calls 50 --output-path data/optimal_margin_methods.json

# 3. Dedicated margin-only ELO model
python3 scripts/afl_elo_optimize_margin.py --end-year 2024 --test-year 2024
python3 scripts/afl_elo_train_margin.py --params-file data/optimal_margin_only_elo_params.json --end-year 2024 --output-dir data

# Combined predictions using best of all approaches
python3 scripts/afl_elo_predict_combined.py --start-year 2025 --standard-model data/afl_elo_trained_to_2024.json --margin-model data/afl_elo_margin_only_trained_to_2024.json --output-dir data --predictor-id 6
```

### Individual Workflows

#### Standard ELO Only
For win probabilities:

```bash
python3 scripts/afl_elo_optimize_standard.py --end-year 2024 --test-year 2024 --output-path data/optimal_elo_params_standard.json
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data
python3 scripts/afl_elo_predict_standard.py --start-year 2025 --model-path data/afl_elo_trained_to_2024.json --output-dir data
```

#### Margin Methods from Standard ELO
For margins derived from standard ELO ratings:

```bash
# Requires trained standard ELO model first
python3 scripts/afl_elo_predict_margin_methods.py --start-year 2025 --elo-model data/afl_elo_trained_to_2024.json --margin-methods data/optimal_margin_methods.json --output-dir data --no-save-to-db
```

#### Dedicated Margin-Only ELO
For pure margin predictions:

```bash
python3 scripts/afl_elo_optimize_margin.py --end-year 2024 --test-year 2024
python3 scripts/afl_elo_train_margin.py --params-file data/optimal_margin_only_elo_params.json --end-year 2024 --output-dir data
python3 scripts/afl_elo_predict_margin.py --start-year 2025 --model-path data/afl_elo_margin_only_trained_to_2024.json --output-dir data --predictor-id 7
```

## Script Documentation

### Core Modules

#### `data_io.py`
Handles all database operations and file I/O:
- Database connections and SQL queries
- Parameter loading/saving (JSON files)
- Team state lookups
- Data validation and preprocessing

#### `elo_core.py`
Contains the consolidated ELO model implementation:
- `AFLEloModel` class with all ELO logic
- Win probability calculations
- Rating updates with margin factors
- Season carryover functionality
- Interstate home advantage logic

#### `optimise.py`
Provides optimization strategies and evaluation methods:
- Bayesian optimization with multi-start support
- Walk-forward and cross-validation evaluation
- Parameter space definitions
- Progress tracking and convergence plotting

### Application Scripts

#### `afl_elo_optimize_standard.py`
Find optimal ELO parameters using Bayesian optimization.

**Parameters:**
- `--n-calls`: Number of optimization calls (default: 100)
- `--n-starts`: Number of random starts for multi-start optimization (default: 1)
- `--start-year`: Start year for training data (default: 1990)
- `--end-year`: End year for training data (default: 2024)
- `--output-path`: Path to save optimal parameters JSON file (default: data/optimal_elo_params_standard.json)

#### `afl_elo_margin_methods.py`
Optimize margin prediction methods that build on standard ELO ratings.

**Parameters:**
- `--elo-params`: Path to standard ELO parameters JSON file (required)
- `--n-calls`: Number of optimization calls per method (default: 50)
- `--start-year`: Start year for training data (default: 1990)
- `--end-year`: End year for training data (default: 2024)
- `--output-path`: Path to save optimal margin methods (default: data/optimal_margin_methods.json)

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

#### Python Script Tests
Run the test suite for the ELO optimization and model functionality:

```bash
# Run all tests
pytest scripts/tests/ -v

# Run specific test files
pytest scripts/tests/test_optimization.py -v
pytest scripts/tests/test_home_advantage.py -v
pytest scripts/tests/test_venue_interstate_logic.py -v

# Run tests with coverage
pytest scripts/tests/ --cov=scripts --cov-report=html
```

#### Node.js Workflow Tests
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