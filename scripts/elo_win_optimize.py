#!/usr/bin/env python3
"""
AFL ELO Bayesian Parameter Optimization

Uses Bayesian optimization to efficiently find optimal ELO parameters.
Much more efficient than grid search for high-dimensional parameter spaces.

Extended to support margin prediction optimization.

Usage:
    # Standard ELO parameter optimization
    python3 afl_elo_optimize_bayesian.py --db-path data/database/afl_predictions.db --n-calls 100
    
    # Margin parameter optimization (after ELO optimization)
    python3 afl_elo_optimize_bayesian.py --margin-mode --elo-params optimal_elo_params_bayesian.json --n-calls 50
"""

import pandas as pd
import numpy as np
import json
import argparse
from datetime import datetime
import sys
import os

# Add current directory to path to allow imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import core modules
from core.data_io import (
    fetch_afl_data,
    save_optimization_results
)
from core.elo_core import AFLEloModel, train_elo_model
from core.optimise import parameter_tuning_grid_search, evaluate_parameters_walkforward, evaluate_parameters_cv


# Define the ELO parameter grid for random search
elo_param_grid = {
    'base_rating': [1500],  # Usually kept fixed
    'k_factor': [20, 25, 30, 35, 40, 45, 50, 55, 60],
    'home_advantage': [20, 30, 40, 50, 60, 70, 80, 90, 100],
    'margin_factor': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    'season_carryover': [0.4, 0.5, 0.6, 0.7, 0.8],
    'max_margin': [60, 80, 100]
}










def optimize_elo_grid_search(db_path, start_year=1990, end_year=2024, max_combinations=500):
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
    
    # Get detailed evaluation of best parameters including BITS scores
    print(f"\nEvaluating best parameters with detailed metrics...")
    detailed_results = evaluate_parameters_walkforward(
        [best_params['k_factor'], best_params['home_advantage'], 
         best_params['margin_factor'], best_params['season_carryover'], 
         best_params['max_margin']],
        matches_df,
        verbose=False,
        return_detailed=True
    )
    
    print(f"\nDetailed Performance Metrics:")
    print(f"  Brier Score: {detailed_results['brier_score']:.4f} (lower is better)")
    print(f"  Log Loss: {detailed_results['log_loss']:.4f} (lower is better)")
    print(f"  BITS Score: {detailed_results['bits_score_per_game']:.4f} per game (higher is better)")
    print(f"  BITS Score: {detailed_results['bits_score_total']:.2f} total")
    print(f"  Accuracy: {detailed_results['accuracy']:.4f} ({int(detailed_results['accuracy'] * detailed_results['total_predictions'])}/{detailed_results['total_predictions']})")
    
    # Add detailed results to tuning_results
    tuning_results['detailed_evaluation'] = detailed_results
    
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
    from core.optimise import parameter_tuning_grid_search
    
    # Generate just a few combinations to inspect
    matches_df = fetch_afl_data('data/database/afl_predictions.db', start_year=1990, end_year=1992)  # Small dataset for speed
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
    matches_df = fetch_afl_data('data/database/afl_predictions.db', start_year=1990, end_year=2024)
    print(f"Loaded {len(matches_df)} matches")
    
    from core.optimise import evaluate_parameters_walkforward
    
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
    matches_df = fetch_afl_data('data/database/afl_predictions.db', start_year=1990, end_year=2024)
    print(f"Loaded {len(matches_df)} matches")
    
    # Test with walk-forward validation
    from core.optimise import evaluate_parameters_walkforward
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
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for optimization data')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for optimization data (inclusive)')
    parser.add_argument('--n-calls', type=int, default=200,
                        help='Number of optimization iterations (more = better but slower)')
    parser.add_argument('--output-path', type=str, default='data/optimal_elo_params_bayesian.json',
                        help='Path to save optimal parameters')
    
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
    
    # Standard ELO optimization mode
    best_params, result = optimize_elo_grid_search(
        args.db_path, 
        args.start_year,
        args.end_year,
        args.n_calls  # Use n_calls as max_combinations
    )
    
    # Save results using the core save function
    output_data = {
        'parameters': best_params,
        'best_score': result['best_score'],
        'best_log_loss': result['best_score'],  # Same as best_score for binary classification
        'optimization_method': 'grid_search',
        'all_results': result['all_results']
    }
    
    # Add detailed evaluation if available
    if 'detailed_evaluation' in result:
        output_data['detailed_evaluation'] = {
            'brier_score': result['detailed_evaluation']['brier_score'],
            'log_loss': result['detailed_evaluation']['log_loss'],
            'bits_score_per_game': result['detailed_evaluation']['bits_score_per_game'],
            'bits_score_total': result['detailed_evaluation']['bits_score_total'],
            'accuracy': result['detailed_evaluation']['accuracy'],
            'total_predictions': result['detailed_evaluation']['total_predictions']
        }
    
    save_optimization_results(output_data, args.output_path)
    print("\nTo train a model with these parameters, run:")
    print(f"python3 scripts/elo_win_train.py --params-file {args.output_path}")
    print("\nTo optimize margin parameters, run:")
    print(f"python3 scripts/elo_margin_optimize.py --max-combinations 500 --end-year 2024")


if __name__ == '__main__':
    main()