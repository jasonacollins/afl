# Simple AFL ELO Model

A clean, functional AFL ELO rating system.

## Files

- `simple_elo.py` - The main ELO model class
- `elo_train.py` - Train the model on historical data
- `elo_predict.py` - Generate predictions for upcoming matches

## Parameters

- **K-Factor**: 32
- **Home Advantage**: 30 points
- **Season Carryover**: 75% (0.75)
- **Margin Scale**: 0.1

## Usage

### Train the Model

```bash
python3 elo_train.py --db-path ../../data/afl_predictions.db --end-year 2024
```

Creates `simple_elo_model.json` with trained ratings.

### Generate Predictions

Add `--save-to-db` flag to save predictions to database.

```bash
python3 elo_predict.py --model-path outputs/simple_elo_model.json
```

Generates predictions for 2025+ matches and saves to database.

## Model Features

### Win Probability
```
P(home wins) = 1 / (1 + 10^(-(home_rating + 30 - away_rating)/400))
```

### Margin Prediction
```
predicted_margin = (home_rating + 30 - away_rating) * 0.1
```

### Rating Updates
```
new_rating = old_rating + K * (actual_result - expected_result)
```

### Season Carryover
```
new_season_rating = 1500 + 0.75 * (old_rating - 1500)
```

## Integration

Saves to predictor_id 8 in the database.