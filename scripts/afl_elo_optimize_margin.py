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
from skopt import gp_minimize
from skopt.space import Real, Integer
from skopt.utils import use_named_args
import json
import argparse
from datetime import datetime

# Import core modules
from data_io import fetch_afl_data, save_optimization_results
from elo_core import MarginEloModel
from optimise import evaluate_margin_elo_walkforward


# fetch_afl_data function replaced by data_io.fetch_afl_data


# MarginEloModel class moved to elo_core.py


# Define parameter search space for margin model - more conservative ranges
margin_space = [
    Integer(20, 60, name='k_factor'),          # Learning rate for rating updates
    Integer(0, 80, name='home_advantage'),     # Home advantage in rating points
    Real(0.6, 0.95, name='season_carryover'),  # Rating carryover between seasons
    Real(0.02, 0.3, name='margin_scale'),      # How rating diff converts to margin
    Real(20, 80, name='scaling_factor'),       # Converts margin error to rating change
    Integer(40, 150, name='max_margin')        # Cap for blowouts
]


# evaluate_margin_params_walkforward function moved to optimise.py


def optimize_margin_elo(db_path, start_year=1990, end_year=2024, n_calls=200, n_starts=1):
    """
    Find optimal margin ELO parameters using Bayesian optimization
    """
    overall_start_time = datetime.now()
    
    print(f"Loading AFL data from {start_year} to {end_year}...")
    matches_df = fetch_afl_data(db_path, start_year=start_year, end_year=end_year)
    print(f"Loaded {len(matches_df)} matches")
    
    # Multi-start optimization
    all_results = []
    overall_best_score = float('inf')
    overall_best_params = None
    
    print(f"\nRunning margin-focused Bayesian optimization with {n_starts} starts...")
    print(f"Each start will run {n_calls} iterations.\n")
    
    for start_idx in range(n_starts):
        print(f"{'='*60}")
        print(f"START {start_idx + 1}/{n_starts} - Random seed: {42 + start_idx}")
        print(f"{'='*60}")
        
        iteration = [0]
        start_time = datetime.now()
        best_so_far = [float('inf')]
        
        @use_named_args(margin_space)
        def objective(**params):
            iteration[0] += 1
            
            # Extract parameters
            param_values = [
                params['k_factor'],
                params['home_advantage'],
                params['season_carryover'],
                params['margin_scale'],
                params['scaling_factor'],
                params['max_margin']
            ]
            
            # Calculate MAE using walk-forward validation
            mae = evaluate_margin_elo_walkforward(param_values, matches_df, verbose=False)
            
            # Update best if needed
            if mae < best_so_far[0]:
                best_so_far[0] = mae
            
            # Progress update - print every iteration
            elapsed = (datetime.now() - start_time).total_seconds()
            print(f"  Iteration {iteration[0]:3d}/{n_calls} - MAE: {mae:.4f} - "
                  f"Best: {best_so_far[0]:.4f} - Time: {elapsed:.1f}s")
            
            return mae
        
        # Run optimization
        result = gp_minimize(
            objective, 
            margin_space, 
            n_calls=n_calls,
            random_state=42 + start_idx,
            acq_func='EI'  # Expected Improvement
        )
        
        all_results.append(result)
        
        elapsed = (datetime.now() - start_time).total_seconds() / 60
        print(f"\nStart {start_idx + 1} completed in {elapsed:.1f} minutes")
        print(f"  Best MAE: {result.fun:.4f}")
        print(f"  Iterations: {len(result.func_vals)}")
        
        # Show best parameters for this start
        start_best_params = {
            'k_factor': int(result.x[0]),
            'home_advantage': int(result.x[1]),
            'season_carryover': float(result.x[2]),
            'margin_scale': float(result.x[3]),
            'scaling_factor': float(result.x[4]),
            'max_margin': int(result.x[5])
        }
        print(f"  Best parameters for this start:")
        for key, value in start_best_params.items():
            if isinstance(value, float):
                print(f"    {key}: {value:.4f}")
            else:
                print(f"    {key}: {value}")
        
        if result.fun < overall_best_score:
            overall_best_score = result.fun
            overall_best_params = result.x
    
    # Use best result
    best_idx = np.argmin([res.fun for res in all_results])
    result = all_results[best_idx]
    
    # Extract best parameters
    best_params = {
        'k_factor': int(result.x[0]),
        'home_advantage': int(result.x[1]),
        'season_carryover': float(result.x[2]),
        'margin_scale': float(result.x[3]),
        'scaling_factor': float(result.x[4]),
        'max_margin': int(result.x[5]),
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
    print(f"\nBest MAE: {result.fun:.4f}")
    
    # Show convergence information
    total_evaluations = sum(len(res.func_vals) for res in all_results)
    print(f"\nTotal evaluations across all starts: {total_evaluations}")
    print(f"Best start converged after {len(result.func_vals)} evaluations")
    print(f"Best start improved from {result.func_vals[0]:.4f} to {result.fun:.4f}")
    
    return best_params, result, overall_start_time


def main():
    parser = argparse.ArgumentParser(
        description='Optimize AFL ELO parameters specifically for margin prediction'
    )
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for optimization data')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for optimization data (inclusive)')
    parser.add_argument('--n-calls', type=int, default=200,
                        help='Number of optimization iterations per start')
    parser.add_argument('--n-starts', type=int, default=1,
                        help='Number of independent optimization runs')
    parser.add_argument('--output-path', type=str, 
                        default='data/optimal_margin_only_elo_params.json',
                        help='Path to save optimal parameters')
    
    args = parser.parse_args()
    
    # Run optimization
    best_params, result, start_time = optimize_margin_elo(
        args.db_path,
        args.start_year,
        args.end_year,
        args.n_calls,
        args.n_starts
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
    
    # Plot convergence if matplotlib available
    try:
        from skopt.plots import plot_convergence
        import matplotlib.pyplot as plt
        
        plot_convergence(result)
        plt.title('Bayesian Optimization Convergence (Margin-Only)')
        plt.tight_layout()
        plt.savefig('margin_only_elo_optimization_convergence.png')
        print("\nConvergence plot saved to: margin_only_elo_optimization_convergence.png")
    except ImportError:
        print("\nInstall matplotlib to see convergence plots")
    
    # Save results with correct structure
    output_data = {
        'model_type': 'margin_only_elo',
        'parameters': best_params,
        'mae': float(result.fun),
        'optimization_details': {
            'method': 'bayesian',
            'n_calls': args.n_calls,
            'n_starts': args.n_starts,
            'start_year': args.start_year,
            'end_year': args.end_year
        }
    }
    
    save_optimization_results(output_data, args.output_path)
    
    print(f"\nOptimal margin parameters saved to: {args.output_path}")

if __name__ == '__main__':
    main()