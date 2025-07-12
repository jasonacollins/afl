import pandas as pd
import numpy as np
import sqlite3
from sklearn.model_selection import TimeSeriesSplit
import matplotlib.pyplot as plt
import json
import os
import argparse
from datetime import datetime
from elo_core import AFLEloModel
from data_io import fetch_afl_data, get_database_connection





def train_elo_model(data, params=None):
    """
    Train the ELO model on the provided data with optional parameters
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    params: dict
        Optional model parameters
        
    Returns:
    --------
    trained ELO model
    """
    if params is None:
        model = AFLEloModel()
    else:
        model = AFLEloModel(
            base_rating=params.get('base_rating', 1500),
            k_factor=params.get('k_factor', 20),
            default_home_advantage=params.get('default_home_advantage', params.get('home_advantage', 30)),
            interstate_home_advantage=params.get('interstate_home_advantage', params.get('home_advantage', 60)),
            margin_factor=params.get('margin_factor', 0.3),
            season_carryover=params.get('season_carryover', 0.6),
            max_margin=params.get('max_margin', 120),
            beta=params.get('beta', 0.05)
        )
    
    # Get unique teams
    all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
    
    # Initialize ratings
    model.initialize_ratings(all_teams)
    
    # Process matches chronologically
    prev_year = None
    
    for _, match in data.iterrows():
        # Apply season carryover at the start of a new season
        if prev_year is not None and match['year'] != prev_year:
            # Apply carryover for the new year
            model.apply_season_carryover(match['year'])
        
        # Update ratings based on match result
        model.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            home_score=match['hscore'],
            away_score=match['ascore'],
            year=match['year'],
            match_id=match['match_id'],
            round_number=match['round_number'],
            match_date=match['match_date'],
            venue=match['venue']
        )
        
        prev_year = match['year']
    
    # Training complete - model contains final ratings
    
    return model


def parameter_tuning(data, param_grid, cv=5, max_combinations=None):
    """
    Find optimal ELO parameters using grid search
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    param_grid: dict
        Dictionary of parameter ranges to test
    cv: int
        Number of cross-validation splits
    max_combinations: int
        Maximum number of parameter combinations to test (None for all)
        
    Returns:
    --------
    dict with best parameters and results
    """
    # Create time-based splits to avoid training on future data
    tscv = TimeSeriesSplit(n_splits=cv)
    
    best_score = float('inf')  # Using log loss, lower is better
    best_params = None
    all_results = []
    
    # Sort data by date to ensure chronological order
    data = data.sort_values(['year', 'match_date'])
    
    # Create parameter combinations
    param_combinations = []
    
    # Simple grid search using loops
    for k_factor in param_grid['k_factor']:
        for default_home_advantage in param_grid['default_home_advantage']:
            for interstate_home_advantage in param_grid['interstate_home_advantage']:
                for margin_factor in param_grid['margin_factor']:
                    for season_carryover in param_grid['season_carryover']:
                        for max_margin in param_grid['max_margin']:
                            for beta in param_grid.get('beta', [0.05]):  # Default if not in grid
                                params = {
                                    'base_rating': param_grid['base_rating'][0],  # Use first value
                                    'k_factor': k_factor,
                                    'default_home_advantage': default_home_advantage,
                                    'interstate_home_advantage': interstate_home_advantage,
                                    'margin_factor': margin_factor,
                                    'season_carryover': season_carryover,
                                    'max_margin': max_margin,
                                    'beta': beta
                                }
                                param_combinations.append(params)
    
    # Limit the number of combinations if specified
    if max_combinations and len(param_combinations) > max_combinations:
        print(f"Limiting to {max_combinations} random parameter combinations out of {len(param_combinations)} total")
        import random
        random.shuffle(param_combinations)
        param_combinations = param_combinations[:max_combinations]
    
    total_combinations = len(param_combinations)
    print(f"Testing {total_combinations} parameter combinations with {cv}-fold cross-validation...")
    
    # Print a few examples of parameter combinations
    print("\nSample of parameter combinations to test:")
    for i, params in enumerate(param_combinations[:3]):
        print(f"  Combination {i+1}: {params}")
    if len(param_combinations) > 3:
        print(f"  ... plus {len(param_combinations) - 3} more combinations")
    
    # Track progress
    start_time = datetime.now()
    
    for i, params in enumerate(param_combinations):
        if i % 10 == 0:  # Print progress every 10 combinations
            elapsed = datetime.now() - start_time
            if i > 0:
                avg_time_per_combo = elapsed.total_seconds() / i
                est_remaining = (total_combinations - i) * avg_time_per_combo
                print(f"Testing combination {i+1}/{total_combinations} - "
                      f"Elapsed: {elapsed.total_seconds()/60:.1f} min, "
                      f"Est. remaining: {est_remaining/60:.1f} min")
            else:
                print(f"Testing combination {i+1}/{total_combinations}")
        
        # Cross-validation scores for this parameter set
        cv_scores = []
        
        for train_idx, test_idx in tscv.split(data):
            train_data = data.iloc[train_idx]
            test_data = data.iloc[test_idx]
            
            # Train model on training data
            model = train_elo_model(train_data, params)
            
            # Predict on test data
            test_probs = []
            test_results = []
            
            # Get the year of the earliest test game
            test_year = test_data['year'].min()
            
            # Apply season carryover if needed
            if test_year > train_data['year'].max():
                model.apply_season_carryover(test_year)
            
            for _, match in test_data.iterrows():
                prob = model.calculate_win_probability(match['home_team'], match['away_team'])
                test_probs.append(prob)
                # Actual result (1 for home win, 0 for away win, 0.5 for draw)
                if match['hscore'] > match['ascore']:
                    result = 1.0
                elif match['hscore'] < match['ascore']:
                    result = 0.0
                else:
                    result = 0.5
                test_results.append(result)
            
            # Clip probabilities to avoid log(0) issues
            test_probs = [max(min(p, 0.999), 0.001) for p in test_probs]
            
            # Calculate log loss for this fold
            log_losses = []
            for true_val, pred_val in zip(test_results, test_probs):
                # Calculate loss based on actual outcome
                if true_val == 1.0:
                    loss = -np.log(pred_val)
                elif true_val == 0.0:
                    loss = -np.log(1 - pred_val)
                else:  # Draw (0.5)
                    # For a draw, use proximity to 0.5 for the loss calculation
                    loss = -np.log(1 - abs(0.5 - pred_val))
                
                log_losses.append(loss)

            fold_loss = np.mean(log_losses)
            cv_scores.append(fold_loss)
        
        # Average score across CV folds
        avg_score = np.mean(cv_scores)
        
        result = {
            'params': params,
            'log_loss': avg_score,
            'cv_scores': cv_scores
        }
        all_results.append(result)
        
        # Update best parameters if this is better
        if avg_score < best_score:
            best_score = avg_score
            best_params = params
            print(f"\nNew best parameters found (log loss: {best_score:.4f}):")
            for k, v in best_params.items():
                print(f"  {k}: {v}")
    
    # Sort results by score
    all_results.sort(key=lambda x: x['log_loss'])
    
    # Print the top 3 parameter combinations
    print("\nTop 3 parameter combinations:")
    for i, result in enumerate(all_results[:3]):
        print(f"  {i+1}. Log loss: {result['log_loss']:.4f}, Parameters: {result['params']}")
    
    total_time = datetime.now() - start_time
    print(f"\nParameter tuning completed in {total_time.total_seconds()/60:.1f} minutes")
    
    return {
        'best_params': best_params,
        'best_score': best_score,
        'all_results': all_results
    }

def train_margin_model(data, elo_model, margin_params):
    """
    Train margin prediction model using ELO model and margin parameters
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    elo_model: AFLEloModel
        Trained ELO model for getting rating differences and probabilities
    margin_params: dict
        Margin prediction parameters from optimization
        
    Returns:
    --------
    dict: Trained margin model configuration
    """
    method = margin_params['best_method']
    params = margin_params['parameters']
    
    print(f"\nTraining margin model using {method.upper().replace('_', ' ')} method...")
    print("Margin parameters:")
    for key, value in params.items():
        print(f"  {key}: {value:.4f}")
    
    # Create margin model configuration
    margin_model = {
        'method': method,
        'parameters': params,
        'optimization_results': margin_params,
        'elo_model_reference': True  # Indicates this margin model requires ELO model
    }
    
    return margin_model

def main():
    """Main function to train the ELO model"""
    parser = argparse.ArgumentParser(description='Train AFL ELO model')
    parser.add_argument('--start-year', type=int, help='Start year for training data (inclusive)', 
                    default=1990)
    parser.add_argument('--end-year', type=int, help='End year for training data (inclusive)', 
                        default=datetime.now().year)
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
    parser.add_argument('--no-tune-parameters', action='store_true',
                        help='Skip parameter tuning (faster but may give worse results)')
    parser.add_argument('--cv-folds', type=int, default=3,
                        help='Number of cross-validation folds for parameter tuning')
    parser.add_argument('--max-combinations', type=int, default=500,
                        help='Maximum number of parameter combinations to test (None for all)')
    parser.add_argument('--params-file', type=str, default=None,
                        help='Load parameters from JSON file (from optimization)')
    parser.add_argument('--margin-params', type=str, default=None,
                        help='Load margin parameters from JSON file (from margin optimization)')

    args = parser.parse_args()
    
    print("AFL ELO Model Training")
    print("=====================")
    print(f"Training with data from year {args.start_year} up to and including year {args.end_year}")
    
    # Check if database exists
    if not os.path.exists(args.db_path):
        print(f"Error: Database not found at {args.db_path}")
        print("Please update the db_path argument")
        return
    
    # Make sure output directory exists
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Fetch data from database
    print("Fetching AFL match data from database...")
    data = fetch_afl_data(args.db_path, start_year=args.start_year, end_year=args.end_year)
    print(f"Fetched {len(data)} matches from {data['year'].min()} to {data['year'].max()}")
    
    if args.params_file:
        print(f"\nLoading parameters from {args.params_file}...")
        with open(args.params_file, 'r') as f:
            params_data = json.load(f)
        
        # Handle both old format and new format
        if 'parameters' in params_data:
            best_params = params_data['parameters']
        else:
            best_params = params_data
        
        print("Loaded parameters:")
        for key, value in best_params.items():
            print(f"  {key}: {value}")
        
        # Train model with loaded parameters
        model = train_elo_model(data, best_params)

    elif not args.no_tune_parameters:
        print("\nPerforming parameter tuning...")
        
        # Define parameter grid - extensive version
        param_grid = {
            'base_rating': [1500],  # Usually kept fixed
            'k_factor': [10, 15, 20, 25, 30, 40],  # How quickly ratings change
            'home_advantage': [20, 30, 40, 50, 60, 70],  # Home ground advantage in rating points
            'margin_factor': [0.1, 0.2, 0.3, 0.4, 0.5, 0.7],  # How much margin affects rating changes
            'season_carryover': [0.5, 0.6, 0.7, 0.75, 0.8, 0.9],  # How much rating carries over between seasons
            'max_margin': [60, 80, 100, 120, 140, 160],  # Maximum margin to consider
            'beta': [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08]  # Margin prediction scaling factor
        }
        
        # Report the total number of combinations
        total_combos = (len(param_grid['k_factor']) * 
                        len(param_grid['default_home_advantage']) * 
                        len(param_grid['interstate_home_advantage']) * 
                        len(param_grid['margin_factor']) * 
                        len(param_grid['season_carryover']) * 
                        len(param_grid['max_margin']) *
                        len(param_grid.get('beta', [0.05])))
        
        print(f"Parameter grid has {total_combos} possible combinations")
        
        # Perform parameter tuning
        tuning_results = parameter_tuning(data, param_grid, cv=args.cv_folds, max_combinations=args.max_combinations)
        
        # Display best parameters
        best_params = tuning_results['best_params']
        print(f"\nBest parameters found:")
        for key, value in best_params.items():
            print(f"  {key}: {value}")
        print(f"Best log loss: {tuning_results['best_score']:.4f}")
        
        # Save tuning results
        tuning_file = os.path.join(args.output_dir, f"afl_elo_tuning_results_{args.end_year}.json")
        with open(tuning_file, 'w') as f:
            # Convert numpy arrays to lists for JSON serialization
            tuning_results_json = {
                'best_params': best_params,
                'best_score': float(tuning_results['best_score']),
                'all_results': [
                    {
                        'params': result['params'],
                        'log_loss': float(result['log_loss']),
                        'cv_scores': [float(score) for score in result['cv_scores']]
                    }
                    for result in tuning_results['all_results']
                ]
            }
            json.dump(tuning_results_json, f, indent=4)
        
        print(f"Tuning results saved to {tuning_file}")
        
        # Train model with best parameters
        print("\nTraining model with best parameters...")
        model = train_elo_model(data, best_params)
    else:
        # Use default parameters
        params = {
            'base_rating': 1500,
            'k_factor': 20,
            'home_advantage': 50,
            'margin_factor': 0.3,
            'season_carryover': 0.6,
            'max_margin': 120,
            'beta': 0.05
        }
        print("\nSkipping parameter tuning and using default parameters...")
        print("Use --tune-parameters flag to find optimal parameters")
        for key, value in params.items():
            print(f"  {key}: {value}")
        
        # Train model with default parameters
        model = train_elo_model(data, params)
    
    # Evaluate model
    metrics = model.evaluate_model()
    print("\nModel Evaluation:")
    print(f"  Accuracy: {metrics['accuracy']:.4f}")
    print(f"  Brier Score: {metrics['brier_score']:.4f}")
    print(f"  Log Loss: {metrics['log_loss']:.4f}")
    
    # Save model and predictions
    output_prefix = f"afl_elo_trained_to_{args.end_year}"
    model_file = os.path.join(args.output_dir, f"{output_prefix}.json")
    predictions_file = os.path.join(args.output_dir, f"{output_prefix}_predictions.csv")
    
    model.save_model(model_file)

    # Train margin model if margin parameters provided
    margin_model = None
    if args.margin_params:
        print(f"\nLoading margin parameters from {args.margin_params}...")
        with open(args.margin_params, 'r') as f:
            margin_data = json.load(f)
        
        print("Margin optimization results:")
        print(f"  Best method: {margin_data['best_method'].upper().replace('_', ' ')}")
        print(f"  Best MAE: {margin_data['margin_mae']:.2f}")
        
        # Train margin model
        margin_model = train_margin_model(data, model, margin_data)
        
        # Save margin model
        margin_model_file = os.path.join(args.output_dir, f"afl_elo_margin_model_{args.end_year}.json")
        with open(margin_model_file, 'w') as f:
            json.dump(margin_model, f, indent=4)
        
        print(f"Margin model saved to {margin_model_file}")

    print(f"\nModel saved to {model_file}")
    
    model.save_predictions_to_csv(predictions_file)
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(model.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


if __name__ == "__main__":
    main()