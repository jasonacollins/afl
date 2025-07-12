#!/usr/bin/env python3
"""
AFL ELO Margin-Only Parameter Optimization

Optimizes ELO parameters specifically for margin prediction accuracy (MAE)
rather than win probability. This creates a completely independent model
from the win probability model.

Usage:
    python3 afl_elo_optimize_margin_only.py --n-calls 200 --n-starts 3
"""

import pandas as pd
import numpy as np
import json
import argparse
from datetime import datetime

# Import core modules
from data_io import fetch_afl_data, save_optimization_results
from elo_core import MarginEloModel
from optimise import parameter_tuning_margin_grid_search


# fetch_afl_data function replaced by data_io.fetch_afl_data


# MarginEloModel class moved to elo_core.py


# Define parameter grid for margin model using similar ranges to standard model
margin_param_grid = {
    'base_rating': [1500],  # Fixed like standard model
    'k_factor': [20, 25, 30, 35, 40, 45, 50, 55, 60],  # Same as standard
    'home_advantage': [20, 30, 40, 50, 60, 70, 80, 90, 100],  # Same as standard
    'season_carryover': [0.4, 0.5, 0.6, 0.7, 0.8],  # Same as standard
    'max_margin': [60, 80, 100],  # Same as standard
    # Margin-specific parameters
    'margin_scale': [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3],  # How rating diff converts to margin
    'scaling_factor': [20, 30, 40, 50, 60, 70, 80]  # Converts margin error to rating change
}


# evaluate_margin_params_walkforward function moved to optimise.py


def optimize_margin_elo_grid_search(db_path, start_year=1990, end_year=2024, max_combinations=500):
    """
    Find optimal margin ELO parameters using random grid search
    """
    print(f"Loading AFL data from {start_year} to {end_year}...")
    matches_df = fetch_afl_data(db_path, start_year=start_year, end_year=end_year)
    print(f"Loaded {len(matches_df)} matches")
    
    # Calculate total possible combinations
    total_combos = (len(margin_param_grid['k_factor']) * 
                    len(margin_param_grid['home_advantage']) * 
                    len(margin_param_grid['season_carryover']) *
                    len(margin_param_grid['max_margin']) *
                    len(margin_param_grid['margin_scale']) *
                    len(margin_param_grid['scaling_factor']))
    
    print(f"Margin parameter grid has {total_combos} possible combinations")
    
    # Use the grid search from core optimise module
    print(f"\nRunning random grid search optimization...")
    print(f"Max combinations to test: {max_combinations}")
    
    tuning_results = parameter_tuning_margin_grid_search(
        matches_df, 
        margin_param_grid, 
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
    print(f"\nBest MAE: {best_score:.4f}")
    
    return best_params, tuning_results


def main():
    parser = argparse.ArgumentParser(
        description='Optimize AFL margin-only ELO parameters using random grid search'
    )
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for optimization data')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for optimization data (inclusive)')
    parser.add_argument('--max-combinations', type=int, default=500,
                        help='Maximum number of parameter combinations to test')
    parser.add_argument('--output-path', type=str, 
                        default='data/optimal_margin_only_elo_params.json',
                        help='Path to save optimal parameters')
    
    args = parser.parse_args()
    
    # Run optimization
    start_time = datetime.now()
    best_params, result = optimize_margin_elo_grid_search(
        args.db_path,
        args.start_year,
        args.end_year,
        args.max_combinations
    )
    
    # Convert best_params values to native Python types for JSON serialization
    for key, value in best_params.items():
        if hasattr(value, 'item'):  # NumPy scalar
            best_params[key] = value.item()
        else:
            best_params[key] = float(value) if isinstance(value, (int, float)) else value
    
    # Total optimization time
    total_time = (datetime.now() - start_time).total_seconds() / 60
    print(f"\nTotal optimization time: {total_time:.1f} minutes")
    
    # Save results with correct structure
    output_data = {
        'model_type': 'margin_only_elo',
        'parameters': best_params,
        'mae': float(result['best_score']),
        'optimization_details': {
            'method': 'grid_search',
            'max_combinations': args.max_combinations,
            'start_year': args.start_year,
            'end_year': args.end_year
        },
        'all_results': result['all_results']
    }
    
    save_optimization_results(output_data, args.output_path)
    
    print(f"\nOptimal margin parameters saved to: {args.output_path}")
    print("\nNext steps:")
    print("1. Train the margin model with these parameters:")
    print(f"   python3 afl_elo_train_margin.py --params-file {args.output_path}")
    print("2. Make predictions with the trained model:")
    print("   python3 afl_elo_predict_margin.py --start-year 2025 --model-path <trained_model.json>")

if __name__ == '__main__':
    main()