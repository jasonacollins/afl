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
# Optimization imports moved to optimise.py module
import argparse
from datetime import datetime
from afl_elo_train_standard import train_elo_model
from elo_core import AFLEloModel
from data_io import fetch_afl_data, get_database_connection, load_parameters, save_elo_parameters, save_margin_parameters, save_convergence_plot
from optimise import (
    run_optimization, get_elo_parameter_space, get_margin_parameter_spaces,
    BayesianOptimizer, WalkForwardEvaluator, create_optimization_objective
)


def predict_margin_simple(rating_diff, scale_factor):
    """Simple linear scaling method"""
    return rating_diff * scale_factor


def predict_margin_diminishing_returns(win_prob, beta):
    """Diminishing returns method (Arc's approach)"""
    return (win_prob - 0.5) / beta


def predict_margin_linear(rating_diff, slope, intercept):
    """Linear regression method"""
    return rating_diff * slope + intercept


# Evaluation functions have been moved to optimise.py module


# Margin optimization functionality moved to afl_elo_margin_methods.py


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
    
    # Get parameter space
    parameter_space = get_elo_parameter_space()
    
    # Run optimization using the consolidated framework
    result = run_optimization(
        model_class=AFLEloModel,
        parameter_space=parameter_space,
        data=matches_df,
        db_path=db_path,
        method='bayesian',
        evaluation='walkforward',
        n_calls=n_calls,
        metric='brier_score',
        verbose=True,
        n_starts=n_starts
    )
    
    # Add base_rating to parameters
    result.best_params['base_rating'] = 1500
    
    # Save convergence plot
    from optimise import save_optimization_convergence_plot
    if save_optimization_convergence_plot(result):
        print("\nConvergence plot saved to: elo_optimization_convergence.png")
    else:
        print("\nInstall matplotlib to see convergence plots")
    
    return result.best_params, result


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
    parser.add_argument('--output-path', type=str, default='data/optimal_elo_params_standard.json',
                        help='Path to save optimal parameters')
    parser.add_argument('--n-starts', type=int, default=1,
                        help='Number of optimization runs with different random seeds (default: 1)')
    
    args = parser.parse_args()
    
    # Standard ELO optimization
    best_params, result = optimize_elo_bayesian(
        args.db_path, 
        args.start_year,
        args.end_year,
        args.n_calls,
        args.cv_folds,
        args.n_starts
    )
    
    # Save results
    save_elo_parameters(best_params, args.output_path, result)
    
    print(f"\nOptimal parameters saved to: {args.output_path}")
    print("\nNext steps:")
    print(f"1. Train model: python3 afl_elo_train_standard.py --params-file {args.output_path}")
    print(f"2. Optimize margin methods: python3 afl_elo_margin_methods.py --elo-params {args.output_path}")


if __name__ == '__main__':
    main()