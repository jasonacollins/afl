#!/usr/bin/env python3
"""
AFL ELO Bayesian Parameter Optimization

Uses Bayesian optimization to efficiently find optimal ELO parameters.
Much more efficient than grid search for high-dimensional parameter spaces.

Usage:
    python3 afl_elo_optimize_bayesian.py --db-path data/afl_predictions.db --n-calls 100
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
from afl_elo_training import AFLEloModel, fetch_afl_data, train_elo_model
from sklearn.model_selection import TimeSeriesSplit


# Define the parameter search space
space = [
    Integer(10, 50, name='k_factor'),
    Integer(0, 100, name='home_advantage'),
    Real(0.1, 0.7, name='margin_factor'),
    Real(0.3, 0.95, name='season_carryover'),
    Integer(60, 180, name='max_margin'),
    Real(0.02, 0.08, name='beta'),
    Real(0.02, 0.08, name='margin_scale')
]


def evaluate_parameters_cv(params, matches_df, cv_folds=3, verbose=False):
    """
    Evaluate ELO parameters using cross-validation
    Returns log loss (lower is better)
    """
    k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta, margin_scale = params
    
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
            beta=beta,
            margin_scale=margin_scale
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
        
        # Test on validation data (NO UPDATES - pure prediction only)
        test_probs = []
        test_results = []
        
        for _, match in test_data.iterrows():
            # Make prediction WITHOUT updating ratings
            prob = fold_model.calculate_win_probability(match['home_team'], match['away_team'])
            test_probs.append(prob)
            
            # Actual result (1 for home win, 0 for away win)
            if match['hscore'] > match['ascore']:
                result = 1.0
            elif match['hscore'] < match['ascore']:
                result = 0.0
            else:
                result = 0.5  # Draw
            test_results.append(result)
            
            # DO NOT UPDATE RATINGS during test phase - this prevents data leakage
        
        # --- Brier score ---
        test_probs = np.array(test_probs)
        test_results = np.array(test_results)
        fold_loss = np.mean((test_probs - test_results) ** 2)  # lower is better
    
        cv_scores.append(fold_loss)
    
    # Return average CV score
    avg_score = np.mean(cv_scores) if cv_scores else np.inf
    
    if verbose:
        print(f"k={k_factor}, h={home_advantage}, m={margin_factor:.3f}, "
              f"c={season_carryover:.3f}, max={max_margin}, b={beta:.4f} "
              f"-> Brier: {avg_score:.4f}")
    
    return avg_score


def evaluate_parameters_walkforward(params, matches_df, verbose=False):
    """
    Rolling‑origin (walk‑forward) evaluation.

    Trains on seasons up to year N and tests on season N+1.
    Returns the average log loss across all splits.
    """
    k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta, margin_scale = params

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
            beta=beta,
            margin_scale=margin_scale
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


def calculate_log_loss(y_true, y_pred):
    """Calculate log loss for predictions"""
    epsilon = 1e-15  # Small value to avoid log(0)
    losses = []
    for true_val, pred_val in zip(y_true, y_pred):
        # Clip predictions to avoid log(0)
        pred_val = np.clip(pred_val, epsilon, 1 - epsilon)
        
        if true_val == 1.0:  # Home win
            loss = -np.log(pred_val)
        elif true_val == 0.0:  # Away win
            loss = -np.log(1 - pred_val)
        else:  # Draw - need different handling
            # For binary predictions, you might want to exclude draws
            # or use a different loss formulation
            continue  # Skip draws for now
        losses.append(loss)
    return np.mean(losses) if losses else np.inf


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
        @use_named_args(space)
        def objective(**params):
            iteration[0] += 1
            
            # Extract parameters
            k_factor = params['k_factor']
            home_advantage = params['home_advantage']
            margin_factor = params['margin_factor']
            season_carryover = params['season_carryover']
            max_margin = params['max_margin']
            beta = params['beta']
            margin_scale = params['margin_scale']
            
            # Evaluate parameters
            score = evaluate_parameters_walkforward(
                [k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta, margin_scale],
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
            func=objective,
            dimensions=space,
            n_calls=n_calls,
            n_initial_points=max(25, n_calls // 4),  # More initial exploration - at least 25 or 25% of calls
            acq_func='EI',  # Expected Improvement for better exploration
            xi=0.05,  # Exploration parameter - balance between exploitation and exploration
            noise='gaussian',  # Handle noisy objectives
            random_state=42 + start_idx  # Different seed for each start
        )
        
        # Store result for this start
        all_results.append(result)
        
        # Update overall best
        if result.fun < overall_best_score:
            overall_best_score = result.fun
            overall_best_params = result.x
        
        print(f"\nStart {start_idx + 1} completed:")
        print(f"  Best score: {result.fun:.4f}")
        print(f"  Best params: k={result.x[0]}, h={result.x[1]}, m={result.x[2]:.3f}, "
            f"c={result.x[3]:.3f}, max={result.x[4]}, β={result.x[5]:.4f}, ms={result.x[6]:.4f}")
        print(f"  Overall best so far: {overall_best_score:.4f}")
    
    # Find the best result across all starts
    best_result = min(all_results, key=lambda x: x.fun)
    result = best_result  # Use best result for final output
    
    # Extract best parameters
    best_params = {
        'k_factor': result.x[0],
        'home_advantage': result.x[1],
        'margin_factor': result.x[2],
        'season_carryover': result.x[3],
        'max_margin': result.x[4],
        'beta': result.x[5],
        'margin_scale': result.x[6],
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
    
    args = parser.parse_args()
    
    # Run optimization
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
        'optimization_method': 'bayesian',
        'convergence_history': [float(x) for x in result.func_vals]
    }
    
    with open(args.output_path, 'w') as f:
        json.dump(output_data, f, indent=4)
    
    print(f"\nOptimal parameters saved to: {args.output_path}")
    print("\nTo train a model with these parameters, run:")
    print(f"python3 afl_elo_training.py --params-file {args.output_path}")


if __name__ == '__main__':
    main()