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
    Real(0.02, 0.08, name='beta')
]


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
    
    # Create single model for all folds to maintain temporal continuity
    model = AFLEloModel(
        k_factor=k_factor,
        home_advantage=home_advantage,
        margin_factor=margin_factor,
        season_carryover=season_carryover,
        max_margin=max_margin,
        beta=beta
    )
    
    # Initialize with all unique teams
    all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()
    model.initialize_ratings(all_teams)
    
    for fold_idx, (train_idx, test_idx) in enumerate(tscv.split(matches_df)):
        train_data = matches_df.iloc[train_idx]
        test_data = matches_df.iloc[test_idx]
        
        # Train on training data (updates model ratings)
        for _, match in train_data.iterrows():
            model.update_ratings(
                match['home_team'], match['away_team'],
                match['hscore'], match['ascore'],
                match['year'], match_id=match.get('id'),
                round_number=match.get('round'), 
                match_date=match.get('match_date'),
                venue=match.get('venue')
            )
        
        # Test on validation data (NO UPDATES - pure prediction only)
        test_probs = []
        test_results = []
        
        for _, match in test_data.iterrows():
            # Make prediction WITHOUT updating ratings
            prob = model.calculate_win_probability(match['home_team'], match['away_team'])
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
    
    # Return average CV score
    avg_score = np.mean(cv_scores) if cv_scores else np.inf
    
    if verbose:
        print(f"k={k_factor}, h={home_advantage}, m={margin_factor:.3f}, "
              f"c={season_carryover:.3f}, max={max_margin}, b={beta:.4f} "
              f"-> Log loss: {avg_score:.4f}")
    
    return avg_score


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


def optimize_elo_bayesian(db_path, start_year=1990, end_year=2024, n_calls=100, cv_folds=3):
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
    """
    print(f"Loading AFL data from {start_year} to {end_year}...")
    matches_df = fetch_afl_data(db_path, start_year=start_year, end_year=end_year)
    print(f"Loaded {len(matches_df)} matches")
    
    # Counter for progress tracking
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
        
        # Evaluate parameters
        score = evaluate_parameters_cv(
            [k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta],
            matches_df,
            cv_folds=cv_folds,
            verbose=True
        )
        
        # Track best score
        if not hasattr(objective, 'best_score') or score < objective.best_score:
            objective.best_score = score
            objective.best_params = params
        
        # Progress update
        elapsed = (datetime.now() - start_time).total_seconds() / 60
        print(f"Iteration {iteration[0]}/{n_calls} - Elapsed: {elapsed:.1f} min - "
              f"Best so far: {objective.best_score:.4f}")
        
        return score
    
    print(f"\nStarting Bayesian optimization with {n_calls} iterations...")
    print("This will adaptively explore the parameter space.\n")
    
    # Run Bayesian optimization
    result = gp_minimize(
        func=objective,
        dimensions=space,
        n_calls=n_calls,
        n_initial_points=25,  # Random exploration at start
        acq_func='gp_hedge',  # Portfolio of acquisition functions
        noise='gaussian',  # Handle noisy objectives
        random_state=42
    )
    
    # Extract best parameters
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
    print("OPTIMIZATION COMPLETE")
    print("="*50)
    print(f"\nBest parameters found:")
    for key, value in best_params.items():
        if isinstance(value, float):
            print(f"  {key}: {value:.4f}")
        else:
            print(f"  {key}: {value}")
    print(f"\nBest log loss: {result.fun:.4f}")
    
    # Show convergence information
    print(f"\nOptimization converged after {len(result.func_vals)} evaluations")
    print(f"Log loss improved from {result.func_vals[0]:.4f} to {result.fun:.4f}")
    
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
    parser.add_argument('--n-calls', type=int, default=100,
                        help='Number of optimization iterations (more = better but slower)')
    parser.add_argument('--cv-folds', type=int, default=3,
                        help='Number of cross-validation folds')
    parser.add_argument('--output-path', type=str, default='optimal_elo_params_bayesian.json',
                        help='Path to save optimal parameters')
    
    args = parser.parse_args()
    
    # Run optimization
    best_params, result = optimize_elo_bayesian(
        args.db_path, 
        args.start_year,
        args.end_year,
        args.n_calls,
        args.cv_folds
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