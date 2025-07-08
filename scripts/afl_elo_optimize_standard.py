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
import sqlite3
from skopt import gp_minimize
from skopt.space import Real, Integer
from skopt.utils import use_named_args
import json
import argparse
from datetime import datetime
from afl_elo_train_standard import AFLEloModel, fetch_afl_data, train_elo_model
from sklearn.model_selection import TimeSeriesSplit


# Define the ELO parameter search space
elo_space = [
    Integer(10, 50, name='k_factor'),
    Integer(0, 100, name='home_advantage'),
    Real(0.1, 0.7, name='margin_factor'),
    Real(0.3, 0.95, name='season_carryover'),
    Integer(60, 180, name='max_margin'),
    Real(0.02, 0.08, name='beta')
]

# Define margin parameter search spaces
margin_spaces = {
    'simple': [Real(0.01, 0.2, name='scale_factor')],
    'diminishing_returns': [Real(0.005, 0.2, name='beta')],  
    'linear': [
        Real(0.01, 0.2, name='slope'),
        Real(-10, 10, name='intercept')
    ]
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


def optimize_elo_bayesian(db_path, start_year=1990, end_year=2024, n_calls=100, cv_folds=3, n_starts=1):
    """
    Find optimal ELO parameters using Bayesian optimization
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Start year for training data
    n_calls: int
        Number of parameter combinations to try (default: 100)
    cv_folds: int
        Number of cross-validation folds
    n_starts: int
        Number of optimization runs with different random seeds (default: 1)
    """
    print(f"Loading AFL data from {start_year} to {end_year}...")
    matches_df = fetch_afl_data(db_path, start_year=start_year, end_year=end_year)
    print(f"Loaded {len(matches_df)} matches")
    
    # Multi-start optimization
    all_results = []
    overall_best_score = float('inf')
    overall_best_params = None
    overall_start_time = datetime.now()
    
    print(f"\nRunning multi-start Bayesian optimization with {n_starts} starts...")
    print(f"Each start will run {n_calls} iterations.\n")
    
    for start_idx in range(n_starts):
        print(f"{'='*60}")
        print(f"START {start_idx + 1}/{n_starts} - Random seed: {42 + start_idx}")
        print(f"{'='*60}")
        
        # Counter for progress tracking (reset for each start)
        iteration = [0]
        start_time = datetime.now()
        
        # Define objective function with decorators for named arguments
        @use_named_args(elo_space)
        def objective(**params):
            iteration[0] += 1
            
            # Extract parameters
            k_factor = params['k_factor']
            home_advantage = params['home_advantage']
            margin_factor = params['margin_factor']
            season_carryover = params['season_carryover']
            max_margin = params['max_margin']
            beta = params['beta']
            
            # Evaluate parameters
            score = evaluate_parameters_walkforward(
                [k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta],
                matches_df,
                verbose=False
            )
            
            # Track best score for this start
            if not hasattr(objective, 'best_score') or score < objective.best_score:
                objective.best_score = score
                objective.best_params = params
            
            # Progress update
            elapsed = (datetime.now() - start_time).total_seconds() / 60
            print(f"Start {start_idx + 1} - Iter {iteration[0]}/{n_calls} - "
                  f"Elapsed: {elapsed:.1f}min - Current: {score:.4f} - "
                  f"Best this start: {objective.best_score:.4f}")
            
            return score
        
        # Run Bayesian optimization for this start
        result = gp_minimize(
            func = objective,
            dimensions = elo_space, # Note: Ensure this uses your 'elo_space' variable
            n_calls = n_calls,
            n_initial_points = max(25, n_calls // 4),  # More initial exploration
            acq_func = 'EI',  # Expected Improvement for better exploration
            xi = 0.05,  # Exploration-exploitation trade-off parameter
            noise = 'gaussian',  # Handles noisy objectives
            random_state = 42 + start_idx  # Different seed for each start
        )
        
        # Store this result
        all_results.append(result)
        
        # Update overall best if this start found something better
        if result.fun < overall_best_score:
            overall_best_score = result.fun
            overall_best_params = result.x
        
        elapsed = datetime.now() - start_time
        print(f"\nStart {start_idx + 1} complete!")
        print(f"  Best score: {result.fun:.4f}")
        print(f"  Best parameters this start:")
        for i, dim in enumerate(elo_space):
            print(f"    {dim.name}: {result.x[i]:.4f}")
        print(f"  Time elapsed: {elapsed}")
        print(f"  Overall best so far: {overall_best_score:.4f}")
    
    # Use the result object with the best score
    result = min(all_results, key=lambda x: x.fun)
    
    # Convert to parameter dictionary
    best_params = {
        'k_factor': result.x[0],
        'home_advantage': result.x[1],
        'margin_factor': result.x[2],
        'season_carryover': result.x[3],
        'max_margin': result.x[4],
        'beta': result.x[5],
        'base_rating': 1500
    }
    
    print("\n" + "="*50)
    print("MULTI-START OPTIMIZATION COMPLETE")
    print("="*50)
    
    # Show results from all starts
    if n_starts > 1:
        print(f"\nResults from {n_starts} optimization runs:")
        for i, res in enumerate(all_results):
            print(f"  Start {i+1}: {res.fun:.4f}")
        print(f"\nBest across all starts: {result.fun:.4f}")
    
    print(f"\nBest parameters found:")
    for key, value in best_params.items():
        if isinstance(value, float):
            print(f"  {key}: {value:.4f}")
        else:
            print(f"  {key}: {value}")
    print(f"\nBest Brier score: {result.fun:.4f}")
    
    # Show convergence information
    total_evaluations = sum(len(res.func_vals) for res in all_results)
    print(f"\nTotal evaluations across all starts: {total_evaluations}")
    print(f"Best start converged after {len(result.func_vals)} evaluations")
    print(f"Best start improved from {result.func_vals[0]:.4f} to {result.fun:.4f}")
    
    # Plot convergence if matplotlib available
    try:
        from skopt.plots import plot_convergence
        import matplotlib.pyplot as plt
        
        plot_convergence(result)
        plt.title('Bayesian Optimization Convergence')
        plt.tight_layout()
        plt.savefig('elo_optimization_convergence.png')
        print("\nConvergence plot saved to: elo_optimization_convergence.png")
    except ImportError:
        print("\nInstall matplotlib to see convergence plots")
    
    return best_params, result


def main():
    parser = argparse.ArgumentParser(description='Optimize AFL ELO parameters using Bayesian optimization')
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
    
    args = parser.parse_args()
    
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
        best_params, result = optimize_elo_bayesian(
            args.db_path, 
            args.start_year,
            args.end_year,
            args.n_calls,
            args.cv_folds,
            args.n_starts
        )
        
        # Save results - convert all values to native Python types for JSON serialization
        json_safe_params = {}
        for key, value in best_params.items():
            if hasattr(value, 'item'):  # NumPy scalar
                json_safe_params[key] = value.item()
            else:
                json_safe_params[key] = float(value) if isinstance(value, (int, float)) else value
        
        output_data = {
            'parameters': json_safe_params,
            'log_loss': float(result.fun),
            'n_iterations': len(result.func_vals),
            'optimization_method': 'bayesian'
        }
        
        with open(args.output_path, 'w') as f:
            json.dump(output_data, f, indent=4)
        
        print(f"\nOptimal parameters saved to: {args.output_path}")
        print("\nTo train a model with these parameters, run:")
        print(f"python3 afl_elo_training.py --params-file {args.output_path}")
        print("\nTo optimize margin parameters, run:")
        print(f"python3 afl_elo_optimize_bayesian.py --margin-mode --elo-params {args.output_path}")


if __name__ == '__main__':
    main()