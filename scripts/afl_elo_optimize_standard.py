#!/usr/bin/env python3
"""
AFL ELO Bayesian Parameter Optimization

Uses Bayesian optimization to efficiently find optimal ELO parameters.
Much more efficient than grid search for high-dimensional parameter spaces.

Extended to support margin prediction optimization.

Usage:
    # Standard ELO parameter optimization
    python3 afl_elo_optimize_bayesian.py --db-path data/afl_predictions.db --n-calls 100
    
    # Margin parameter optimization (after ELO optimization)
    python3 afl_elo_optimize_bayesian.py --margin-mode --elo-params optimal_elo_params_bayesian.json --n-calls 50
"""

import pandas as pd
import numpy as np
import json
import argparse
from datetime import datetime

# Import core modules
from data_io import (
    fetch_afl_data,
    save_optimization_results
)
from elo_core import AFLEloModel, train_elo_model
from optimise import parameter_tuning_grid_search


# Define the ELO parameter grid for random search
elo_param_grid = {
    'base_rating': [1500],  # Usually kept fixed
    'k_factor': [20, 25, 30, 35, 40, 45, 50, 55, 60],
    'home_advantage': [20, 30, 40, 50, 60, 70, 80, 90, 100],
    'margin_factor': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    'season_carryover': [0.4, 0.5, 0.6, 0.7, 0.8],
    'max_margin': [60, 80, 100]
}


def predict_margin_simple(rating_diff, scale_factor):
    """Simple linear scaling method"""
    return rating_diff * scale_factor


def predict_margin_diminishing_returns(win_prob, beta):
    """Diminishing returns method (Arc's approach)"""
    return (win_prob - 0.5) / beta


def predict_margin_linear(rating_diff, slope, intercept):
    """Linear regression method"""
    return rating_diff * slope + intercept


def evaluate_margin_method_walkforward(params, method, elo_params, matches_df, verbose=False):
    """
    Evaluate margin prediction parameters using walk-forward validation
    Returns Mean Absolute Error (lower is better)
    """
    # Ensure chronological order
    matches_df = matches_df.sort_values(['year', 'match_date'])
    
    seasons = sorted(matches_df['year'].unique())
    if len(seasons) < 2:
        return np.inf  # Not enough data for walk-forward
    
    # All unique teams
    all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()
    
    all_errors = []
    
    for i in range(len(seasons) - 1):
        train_seasons = seasons[:i + 1]
        test_season = seasons[i + 1]
        
        train_data = matches_df[matches_df['year'].isin(train_seasons)]
        test_data = matches_df[matches_df['year'] == test_season]
        
        # Create fresh ELO model for this split
        model = AFLEloModel(**elo_params)
        model.initialize_ratings(all_teams)
        
        # Train ELO model on historical data
        prev_year = None
        for _, match in train_data.iterrows():
            # Apply season carryover at the start of a new season
            if prev_year is not None and match['year'] != prev_year:
                model.apply_season_carryover(match['year'])
            
            model.update_ratings(
                match['home_team'],
                match['away_team'],
                match['hscore'],
                match['ascore'],
                match['year'],
                match_id=match.get('id'),
                round_number=match.get('round'),
                match_date=match.get('match_date'),
                venue=match.get('venue')
            )
            prev_year = match['year']
        
        # Apply season carryover before predicting test season
        if prev_year is not None and test_season != prev_year:
            model.apply_season_carryover(test_season)
        
        # Predict margins on test season (no ELO rating updates)
        predicted_margins = []
        actual_margins = []
        
        for _, match in test_data.iterrows():
            # Get ELO-based predictions
            win_prob = model.calculate_win_probability(match['home_team'], match['away_team'])
            
            home_rating = model.team_ratings.get(match['home_team'], model.base_rating)
            away_rating = model.team_ratings.get(match['away_team'], model.base_rating)
            rating_diff = (home_rating + model.home_advantage) - away_rating
            
            # Apply margin prediction method
            if method == 'simple':
                predicted_margin = predict_margin_simple(rating_diff, params[0])
            elif method == 'diminishing_returns':
                predicted_margin = predict_margin_diminishing_returns(win_prob, params[0])
            elif method == 'linear':
                predicted_margin = predict_margin_linear(rating_diff, params[0], params[1])
            else:
                raise ValueError(f"Unknown method: {method}")
            
            actual_margin = match['hscore'] - match['ascore']
            
            predicted_margins.append(predicted_margin)
            actual_margins.append(actual_margin)
        
        # Calculate MAE for this split
        split_mae = np.mean(np.abs(np.array(predicted_margins) - np.array(actual_margins)))
        all_errors.append(split_mae)
        
        if verbose:
            print(f"Train ≤ {test_season - 1}, test {test_season}: MAE {split_mae:.2f}")
    
    return np.mean(all_errors) if all_errors else np.inf


def evaluate_parameters_cv(params, matches_df, cv_folds=3, verbose=False):
    """
    Evaluate ELO parameters using cross-validation
    Returns log loss (lower is better)
    """
    k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta = params
    
    # Create time-based splits
    tscv = TimeSeriesSplit(n_splits=cv_folds)
    cv_scores = []
    
    # Ensure data is sorted
    matches_df = matches_df.sort_values(['year', 'match_date'])
    
    # Initialize with all unique teams
    all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()
    
    for fold_idx, (train_idx, test_idx) in enumerate(tscv.split(matches_df)):
        # Create new model for each fold
        fold_model = AFLEloModel(
            k_factor=k_factor,
            home_advantage=home_advantage,
            margin_factor=margin_factor,
            season_carryover=season_carryover,
            max_margin=max_margin,
            beta=beta
        )
        fold_model.initialize_ratings(all_teams)
        
        train_data = matches_df.iloc[train_idx]
        test_data = matches_df.iloc[test_idx]
        
        # Train on training data (updates model ratings) with proper season carryover
        prev_year = None
        for _, match in train_data.iterrows():
            # Apply season carryover at the start of a new season
            if prev_year is not None and match['year'] != prev_year:
                fold_model.apply_season_carryover(match['year'])
            
            fold_model.update_ratings(
                match['home_team'], match['away_team'],
                match['hscore'], match['ascore'],
                match['year'], match_id=match.get('id'),
                round_number=match.get('round'), 
                match_date=match.get('match_date'),
                venue=match.get('venue')
            )
            prev_year = match['year']
        
        # Apply season carryover before testing if test data is from a different year
        test_years = test_data['year'].unique()
        if len(test_years) > 0 and prev_year is not None:
            test_year = test_years[0]  # Assume test data is from single year
            if test_year != prev_year:
                fold_model.apply_season_carryover(test_year)
        
        # Predict on test data (no rating updates)
        test_probs = []
        test_results = []
        for _, match in test_data.iterrows():
            prob = fold_model.calculate_win_probability(match['home_team'], match['away_team'])
            test_probs.append(max(min(prob, 0.999), 0.001))  # clip
            
            if match['hscore'] > match['ascore']:
                test_results.append(1.0)
            elif match['hscore'] < match['ascore']:
                test_results.append(0.0)
            else:
                test_results.append(0.5)  # draw
        
        # --- Brier score for this fold ---
        test_probs_arr = np.array(test_probs)
        test_results_arr = np.array(test_results)
        cv_scores.append(np.mean((test_probs_arr - test_results_arr) ** 2))
        
        if verbose:
            print(f"Fold {fold_idx + 1}: Brier score {cv_scores[-1]:.4f}")
    
    return np.mean(cv_scores)


def evaluate_parameters_walkforward(params, matches_df, verbose=False):
    """
    Evaluate ELO parameters using walk-forward validation.
    Trains on seasons up to year N and tests on season N+1.
    Returns the average Brier score across all splits.
    """
    k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta = params

    # Ensure chronological order
    matches_df = matches_df.sort_values(['year', 'match_date'])

    seasons = sorted(matches_df['year'].unique())
    if len(seasons) < 2:
        return np.inf  # Not enough data for walk‑forward

    # All unique teams
    all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()

    split_losses = []

    for i in range(len(seasons) - 1):
        train_seasons = seasons[: i + 1]
        test_season = seasons[i + 1]

        train_data = matches_df[matches_df['year'].isin(train_seasons)]
        test_data = matches_df[matches_df['year'] == test_season]

        # Fresh model per split
        model = AFLEloModel(
            k_factor=k_factor,
            home_advantage=home_advantage,
            margin_factor=margin_factor,
            season_carryover=season_carryover,
            max_margin=max_margin,
            beta=beta
        )
        model.initialize_ratings(all_teams)

        # Train on historical data with proper season carryover
        prev_year = None
        for _, match in train_data.iterrows():
            # Apply season carryover at the start of a new season
            if prev_year is not None and match['year'] != prev_year:
                model.apply_season_carryover(match['year'])
            
            model.update_ratings(
                match['home_team'],
                match['away_team'],
                match['hscore'],
                match['ascore'],
                match['year'],
                match_id=match.get('id'),
                round_number=match.get('round'),
                match_date=match.get('match_date'),
                venue=match.get('venue'),
            )
            prev_year = match['year']

        # Apply season carryover before predicting test season
        if prev_year is not None and test_season != prev_year:
            model.apply_season_carryover(test_season)
        
        # Predict on test season (no rating updates)
        test_probs = []
        test_results = []
        for _, match in test_data.iterrows():
            prob = model.calculate_win_probability(match['home_team'], match['away_team'])
            test_probs.append(max(min(prob, 0.999), 0.001))  # clip

            if match['hscore'] > match['ascore']:
                test_results.append(1.0)
            elif match['hscore'] < match['ascore']:
                test_results.append(0.0)
            else:
                test_results.append(0.5)  # draw

        # --- Brier score for this split ---
        test_probs_arr = np.array(test_probs)
        test_results_arr = np.array(test_results)
        split_losses.append(np.mean((test_probs_arr - test_results_arr) ** 2))

        if verbose:
            print(
                f"Train ≤ {test_season - 1}, test {test_season}: "
                f"Brier {split_losses[-1]:.4f}"
            )

    return np.mean(split_losses) if split_losses else np.inf


def optimize_margin_parameters(elo_params, matches_df, n_calls=50, verbose=True):
    """
    Optimize margin prediction parameters for all three methods
    Returns the best method and its parameters
    """
    best_method = None
    best_params = None
    best_score = float('inf')
    all_results = {}
    
    print("Testing margin prediction methods...")
    
    for method_name, space in margin_spaces.items():
        print(f"\n{'='*50}")
        print(f"OPTIMIZING: {method_name.upper().replace('_', ' ')} METHOD")
        print(f"{'='*50}")
        
        iteration = [0]
        
        @use_named_args(space)
        def objective(**params):
            iteration[0] += 1
            param_values = [params[name] for name in [dim.name for dim in space]]
            
            score = evaluate_margin_method_walkforward(
                param_values, method_name, elo_params, matches_df, verbose=False
            )
            
            if iteration[0] % 10 == 0 or iteration[0] == 1:
                print(f"  Iteration {iteration[0]:3d}: MAE = {score:.2f}")
            
            return score
        
        # Run optimization for this method
        result = gp_minimize(objective, space, n_calls=n_calls, random_state=42)
        
        all_results[method_name] = {
            'score': result.fun,
            'params': {space[i].name: result.x[i] for i in range(len(space))},
            'result': result
        }
        
        print(f"\n{method_name.upper().replace('_', ' ')} RESULTS:")
        print(f"  Best MAE: {result.fun:.2f}")
        print("  Best parameters:")
        for i, dim in enumerate(space):
            print(f"    {dim.name}: {result.x[i]:.4f}")
        
        if result.fun < best_score:
            best_score = result.fun
            best_method = method_name
            best_params = all_results[method_name]['params']
    
    print(f"\n{'='*60}")
    print("MARGIN OPTIMIZATION COMPLETE")
    print(f"{'='*60}")
    print(f"Best method: {best_method.upper().replace('_', ' ')}")
    print(f"Best MAE: {best_score:.2f}")
    print("Best parameters:")
    for key, value in best_params.items():
        print(f"  {key}: {value:.4f}")
    
    return best_method, best_params, best_score, all_results


def optimize_elo_grid_search(db_path, start_year=1990, end_year=2024, max_combinations=500, cv_folds=3):
    """
    Find optimal ELO parameters using random grid search
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Start year for training data
    end_year: int
        End year for training data
    max_combinations: int
        Maximum number of parameter combinations to try
    cv_folds: int
        Number of cross-validation folds
    """
    print(f"Loading AFL data from {start_year} to {end_year}...")
    matches_df = fetch_afl_data(db_path, start_year=start_year, end_year=end_year)
    print(f"Loaded {len(matches_df)} matches")
    
    # Use the grid search from core optimise module
    print(f"\nRunning random grid search optimization...")
    print(f"Max combinations to test: {max_combinations}")
    
    tuning_results = parameter_tuning_grid_search(
        matches_df, 
        elo_param_grid, 
        cv=cv_folds, 
        max_combinations=max_combinations
    )
    
    best_params = tuning_results['best_params']
    best_score = tuning_results['best_score']
    
    print("\n" + "="*50)
    print("GRID SEARCH OPTIMIZATION COMPLETE")
    print("="*50)
    
    print(f"\nBest parameters found:")
    for key, value in best_params.items():
        if isinstance(value, float):
            print(f"  {key}: {value:.4f}")
        else:
            print(f"  {key}: {value}")
    print(f"\nBest Brier score: {best_score:.4f}")
    
    return best_params, tuning_results


def check_parameter_sampling():
    """Check if our parameter sampling is working correctly"""
    print("Checking parameter sampling...")
    
    # Check if simple good params are in our grid
    simple_good = {
        'k_factor': 45,
        'home_advantage': 50, 
        'margin_factor': 0.5,
        'season_carryover': 0.6,
        'max_margin': 80
    }
    
    print("Simple good parameters:")
    for key, value in simple_good.items():
        if value in elo_param_grid[key]:
            print(f"  ✓ {key}: {value} (IN GRID)")
        else:
            print(f"  ✗ {key}: {value} (NOT IN GRID) - Available: {elo_param_grid[key]}")
    
    # Test sampling by generating some combinations
    print(f"\nTesting parameter combination generation...")
    from optimise import parameter_tuning_grid_search
    
    # Generate just a few combinations to inspect
    matches_df = fetch_afl_data('data/afl_predictions.db', start_year=1990, end_year=1992)  # Small dataset for speed
    print(f"Using {len(matches_df)} matches for sampling test")
    
    # Run with max 10 combinations to see what gets generated
    print("\nTesting with 10 random combinations...")
    result = parameter_tuning_grid_search(matches_df, elo_param_grid, cv=2, max_combinations=10)
    
    print(f"\nGenerated combinations and scores:")
    for i, res in enumerate(result['all_results'][:10]):
        params = res['params']
        score = res.get('brier_score', res.get('log_loss', 'unknown'))
        print(f"  {i+1}. k={params['k_factor']}, home={params['home_advantage']}, "
              f"margin={params['margin_factor']}, carry={params['season_carryover']}, "
              f"max_margin={params['max_margin']} → Score: {score:.4f}")
    
    # Test if the exact simple good combination gets generated
    print(f"\nChecking if simple good combination appears in random sampling...")
    all_combinations = []
    for k_factor in elo_param_grid['k_factor']:
        for home_advantage in elo_param_grid['home_advantage']:
            for margin_factor in elo_param_grid['margin_factor']:
                for season_carryover in elo_param_grid['season_carryover']:
                    for max_margin in elo_param_grid['max_margin']:
                        combo = (k_factor, home_advantage, margin_factor, season_carryover, max_margin)
                        all_combinations.append(combo)
    
    simple_good_tuple = (45, 50, 0.5, 0.6, 80)
    if simple_good_tuple in all_combinations:
        print(f"  ✓ Simple good combination IS in the full grid")
    else:
        print(f"  ✗ Simple good combination is NOT in the full grid")
    
    print(f"\nTotal possible combinations: {len(all_combinations)}")
    return result


def test_known_good_params():
    """Test parameter sets to verify evaluation is working"""
    
    # Test 1: Your exact optimal parameters  
    print("Testing exact optimal parameter set...")
    optimal_params = {
        'k_factor': 47.0,
        'home_advantage': 52.0,
        'margin_factor': 0.47,
        'season_carryover': 0.61,
        'max_margin': 71.0,
        'beta': 0.064589,
        'base_rating': 1500.0
    }
    
    # Test 2: Simple "good enough" parameters from our search space
    print("\nTesting simple 'good enough' parameter set...")
    simple_params = {
        'k_factor': 45.0,
        'home_advantage': 50.0,
        'margin_factor': 0.5,
        'season_carryover': 0.6,
        'max_margin': 80.0,
        'beta': 0.05,
        'base_rating': 1500.0
    }
    
    # Load data
    matches_df = fetch_afl_data('data/afl_predictions.db', start_year=1990, end_year=2024)
    print(f"Loaded {len(matches_df)} matches")
    
    from optimise import evaluate_parameters_walkforward
    
    # Test optimal params
    print("\n=== OPTIMAL PARAMETERS ===")
    for key, value in optimal_params.items():
        print(f"  {key}: {value}")
    
    optimal_score = evaluate_parameters_walkforward(
        [optimal_params['k_factor'], optimal_params['home_advantage'], 
         optimal_params['margin_factor'], optimal_params['season_carryover'], 
         optimal_params['max_margin']],
        matches_df,
        verbose=False
    )
    
    # Test simple params
    print("\n=== SIMPLE 'GOOD ENOUGH' PARAMETERS ===")
    for key, value in simple_params.items():
        print(f"  {key}: {value}")
    
    simple_score = evaluate_parameters_walkforward(
        [simple_params['k_factor'], simple_params['home_advantage'], 
         simple_params['margin_factor'], simple_params['season_carryover'], 
         simple_params['max_margin']],
        matches_df,
        verbose=False
    )
    
    print(f"\nRESULTS:")
    print(f"  Optimal params Brier score: {optimal_score:.4f}")
    print(f"  Simple params Brier score:  {simple_score:.4f}")
    print(f"  Difference: {simple_score - optimal_score:.4f}")
    
    if simple_score - optimal_score < 0.005:
        print("  → Simple params are nearly as good! Search space should find similar results.")
    else:
        print("  → Simple params are noticeably worse. Need to expand search space.")
    
    return optimal_score, simple_score
    
    print("Test parameters:")
    for key, value in test_params.items():
        print(f"  {key}: {value}")
    
    # Load data
    matches_df = fetch_afl_data('data/afl_predictions.db', start_year=1990, end_year=2024)
    print(f"Loaded {len(matches_df)} matches")
    
    # Test with walk-forward validation
    from optimise import evaluate_parameters_walkforward
    score = evaluate_parameters_walkforward(
        [test_params['k_factor'], test_params['home_advantage'], 
         test_params['margin_factor'], test_params['season_carryover'], 
         test_params['max_margin']],
        matches_df,
        verbose=True
    )
    
    print(f"\nBrier score with known good params: {score:.4f}")
    print("(Should be around 0.22 if evaluation is working correctly)")
    return score


def main():
    parser = argparse.ArgumentParser(description='Optimize AFL ELO parameters using grid search')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for optimization data')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for optimization data (inclusive)')
    parser.add_argument('--n-calls', type=int, default=200,
                        help='Number of optimization iterations (more = better but slower)')
    parser.add_argument('--cv-folds', type=int, default=3,
                        help='Number of cross-validation folds')
    parser.add_argument('--output-path', type=str, default='data/optimal_elo_params_bayesian.json',
                        help='Path to save optimal parameters')
    parser.add_argument('--n-starts', type=int, default=1,
                        help='Number of optimization runs with different random seeds (default: 1)')
    
    # Margin optimization arguments
    parser.add_argument('--margin-mode', action='store_true',
                        help='Run margin parameter optimization instead of ELO optimization')
    parser.add_argument('--elo-params', type=str,
                        help='Path to existing ELO parameters JSON file (required for margin mode)')
    parser.add_argument('--output-margin-params', type=str, default='data/optimal_elo_margin_params.json',
                        help='Path to save optimal margin parameters (margin mode only)')
    parser.add_argument('--test-known-params', action='store_true',
                        help='Test known good parameter set instead of optimizing')
    parser.add_argument('--check-sampling', action='store_true',
                        help='Check if parameter sampling is working correctly')
    
    args = parser.parse_args()
    
    # Test modes
    if args.test_known_params:
        test_known_good_params()
        return
    
    if args.check_sampling:
        check_parameter_sampling()
        return
    
    if args.margin_mode:
        # Margin optimization mode
        if not args.elo_params:
            print("ERROR: --elo-params is required when using --margin-mode")
            return
        
        # Load existing ELO parameters
        print(f"Loading ELO parameters from: {args.elo_params}")
        with open(args.elo_params, 'r') as f:
            elo_data = json.load(f)
            
        if 'parameters' in elo_data:
            elo_params = elo_data['parameters']
        else:
            elo_params = elo_data
            
        print("ELO parameters:")
        for key, value in elo_params.items():
            print(f"  {key}: {value}")
        
        # Load match data
        print(f"\nLoading match data from {args.start_year} to {args.end_year}...")
        matches_df = fetch_afl_data(args.db_path, start_year=args.start_year, end_year=args.end_year)
        print(f"Loaded {len(matches_df)} matches")
        
        # Run margin optimization
        best_method, best_params, best_score, all_results = optimize_margin_parameters(
            elo_params, matches_df, n_calls=args.n_calls
        )
        
        # Save margin parameters
        margin_data = {
            'best_method': best_method,
            'parameters': best_params,
            'margin_mae': best_score,
            'optimization_method': 'bayesian_margin',
            'all_methods': {
                method: {
                    'mae': result['score'],
                    'parameters': result['params']
                }
                for method, result in all_results.items()
            }
        }
        
        with open(args.output_margin_params, 'w') as f:
            json.dump(margin_data, f, indent=4)
        
        print(f"\nMargin parameters saved to: {args.output_margin_params}")
        print("\nTo train models with these parameters, run:")
        print(f"python3 afl_elo_training.py --params-file {args.elo_params} --margin-params {args.output_margin_params}")
        
    else:
        # Standard ELO optimization mode
        best_params, result = optimize_elo_grid_search(
            args.db_path, 
            args.start_year,
            args.end_year,
            args.n_calls,  # Use n_calls as max_combinations
            args.cv_folds
        )
        
        # Save results using the core save function
        output_data = {
            'parameters': best_params,
            'best_score': result['best_score'],
            'optimization_method': 'grid_search',
            'all_results': result['all_results']
        }
        
        save_optimization_results(output_data, args.output_path)
        
        print(f"\nOptimal parameters saved to: {args.output_path}")
        print("\nTo train a model with these parameters, run:")
        print(f"python3 afl_elo_training.py --params-file {args.output_path}")
        print("\nTo optimize margin parameters, run:")
        print(f"python3 afl_elo_optimize_bayesian.py --margin-mode --elo-params {args.output_path}")


if __name__ == '__main__':
    main()