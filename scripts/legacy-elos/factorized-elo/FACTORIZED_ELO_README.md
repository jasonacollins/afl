# AFL Predictions Scripts Documentation

This folder contains the factorised version of an AFL predictions system, including ELO model training, optimization, prediction generation, and data management.

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

```

## ELO Model Training and Prediction Workflow

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

### Individual Workflows

#### Standard ELO Only
For win probabilities:

```bash
python3 scripts/afl_elo_optimize_standard.py --end-year 2024 --test-year 2024 --output-path data/optimal_elo_params_standard.json
python3 scripts/afl_elo_train_standard.py --params-file data/optimal_elo_params_standard.json --end-year 2024 --output-dir data
python3 scripts/afl_elo_predict_standard.py --start-year 2025 --model-path data/afl_elo_trained_to_2024.json --output-dir data
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
