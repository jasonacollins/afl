#!/usr/bin/env python3
"""
AFL ELO Grid Search Parameter Optimization

Uses simple grid search to find optimal ELO parameters.
Tests all combinations of reasonable parameter values.

Usage:
    python3 afl_elo_optimize_standard.py --db-path data/afl_predictions.db
"""

import pandas as pd
import numpy as np
import argparse
import time
from itertools import product
from datetime import datetime
from elo_core import AFLEloModel
from data_io import fetch_afl_data, get_database_connection, save_elo_parameters


def evaluate_parameters(params, train_data, test_data, db_path):
    """
    Evaluate a parameter set using the existing AFLEloModel.
    
    Parameters:
    -----------
    params : dict
        Parameter dictionary
    train_data : pd.DataFrame
        Training data
    test_data : pd.DataFrame
        Testing data
    db_path : str
        Database path for venue lookups
    
    Returns:
    --------
    dict
        Evaluation metrics
    """
    # Create model with these parameters
    model = AFLEloModel(
        k_factor=params['k_factor'],
        default_home_advantage=params['default_home_advantage'],
        interstate_home_advantage=params['interstate_home_advantage'],
        margin_factor=params['margin_factor'],
        season_carryover=params['season_carryover'],
        max_margin=params['max_margin'],
        beta=params['beta']
    )
    
    # Initialize all teams
    all_teams = pd.concat([train_data['home_team'], train_data['away_team']]).unique()
    model.initialize_ratings(all_teams.tolist(), db_path)
    
    # Get database connection
    db_connection = get_database_connection(db_path) if db_path else None
    
    try:
        # Train on training data
        current_year = None
        for _, match in train_data.iterrows():
            # Apply season carryover at start of new season
            if current_year is not None and match['year'] != current_year:
                model.apply_season_carryover(match['year'])
            
            model.update_ratings(
                match['home_team'], match['away_team'],
                match['hscore'], match['ascore'],
                match['year'],
                match_id=match.get('match_id'),
                round_number=match.get('round_number'),
                match_date=match.get('match_date'),
                venue=match.get('venue'),
                db_connection=db_connection
            )
            current_year = match['year']
        
        # Apply season carryover for test year if needed
        if len(test_data) > 0 and test_data['year'].iloc[0] != current_year:
            model.apply_season_carryover(test_data['year'].iloc[0])
        
        # Evaluate on test data by updating ratings (this stores predictions)
        for _, match in test_data.iterrows():
            model.update_ratings(
                match['home_team'], match['away_team'],
                match['hscore'], match['ascore'],
                match['year'],
                match_id=match.get('match_id'),
                round_number=match.get('round_number'),
                match_date=match.get('match_date'),
                venue=match.get('venue'),
                db_connection=db_connection
            )
        
        # Use the model's built-in evaluation method
        evaluation = model.evaluate_model()
        
        return {
            'accuracy': evaluation['accuracy'],
            'brier_score': evaluation['brier_score'],
            'log_loss': evaluation.get('log_loss', 0),
            'test_matches': len(test_data)
        }
        
    finally:
        if db_connection:
            db_connection.close()


def optimize_elo_grid_search(db_path, start_year=1990, end_year=2024, cv_folds=3):
    """
    Find optimal ELO parameters using grid search with walk-forward validation
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Start year for data
    end_year: int
        End year for data
    cv_folds: int
        Number of cross-validation folds (years)
    """
    print(f"Loading AFL data from {start_year} to {end_year}...")
    
    # Use recent years for speed
    data_start = max(start_year, 2018)
    all_data = fetch_afl_data(db_path, start_year=data_start, end_year=end_year)
    
    # Create walk-forward validation folds
    available_years = sorted(all_data['year'].unique())
    print(f"Available years: {available_years}")
    
    # Use last cv_folds years for testing
    test_years = available_years[-cv_folds:]
    train_years = available_years[:-cv_folds]
    
    print(f"Training years: {train_years}")
    print(f"Test years: {test_years}")
    print(f"Total matches: {len(all_data)}")
    
    # Create folds for walk-forward validation
    folds = []
    for i, test_year in enumerate(test_years):
        train_data = all_data[all_data['year'].isin(train_years + test_years[:i])]
        test_data = all_data[all_data['year'] == test_year]
        folds.append((train_data, test_data))
        print(f"Fold {i+1}: Train on {len(train_data)} matches, test on {len(test_data)} matches ({test_year})")
    
    print()
    
    # Define parameter grid for win probability optimization
    param_grid = {
        'k_factor': [20, 30, 40, 50],
        'default_home_advantage': [10, 20, 30, 40],
        'interstate_home_advantage': [50, 60, 70],
        'margin_factor': [0.3, 0.4, 0.5, 0.6],
        'season_carryover': [0.7, 0.75, 0.8]
    }
    
    # Fixed parameters (not optimized in this stage)
    fixed_params = {
        'max_margin': 80,
        'beta': 0.05  # Will be optimized separately for margins
    }
    
    # Generate all combinations
    param_names = list(param_grid.keys())
    param_values = list(param_grid.values())
    combinations = list(product(*param_values))
    
    print(f"Testing {len(combinations)} parameter combinations...")
    print()
    
    # Track best results
    best_brier_score = float('inf')
    best_params = None
    best_results = None
    all_results = []
    
    start_time = time.time()
    
    # Test each combination using cross-validation
    for i, combo in enumerate(combinations):
        params = dict(zip(param_names, combo))
        params.update(fixed_params)  # Add fixed parameters
        
        try:
            # Run cross-validation across all folds
            fold_results = []
            for fold_idx, (train_data, test_data) in enumerate(folds):
                fold_result = evaluate_parameters(params, train_data, test_data, db_path)
                fold_results.append(fold_result)
            
            # Average results across folds
            avg_accuracy = sum(r['accuracy'] for r in fold_results) / len(fold_results)
            avg_brier_score = sum(r['brier_score'] for r in fold_results) / len(fold_results)
            avg_log_loss = sum(r['log_loss'] for r in fold_results) / len(fold_results)
            total_test_matches = sum(r['test_matches'] for r in fold_results)
            
            results = {
                'accuracy': avg_accuracy,
                'brier_score': avg_brier_score,
                'log_loss': avg_log_loss,
                'test_matches': total_test_matches,
                'fold_results': fold_results
            }
            
            # Track best (using average brier score)
            if avg_brier_score < best_brier_score:
                best_brier_score = avg_brier_score
                best_params = params.copy()
                best_results = results.copy()
            
            all_results.append({
                'params': params,
                'results': results,
                'brier_score': avg_brier_score
            })
            
            # Progress update
            if (i + 1) % 50 == 0 or i == len(combinations) - 1:
                elapsed = time.time() - start_time
                print(f"Tested {i+1}/{len(combinations)} combinations ({elapsed:.1f}s)")
                print(f"  Best Avg Brier Score: {best_brier_score:.4f}")
                print(f"  Best Avg Accuracy: {best_results['accuracy']:.3f}")
                print(f"  Best Avg Log Loss: {best_results['log_loss']:.4f}")
                print()
                
        except Exception as e:
            print(f"Error with params {params}: {e}")
            continue
    
    # Add base_rating to best parameters
    best_params['base_rating'] = 1500
    
    total_time = time.time() - start_time
    print(f"Grid search complete! Total time: {total_time:.1f} seconds")
    print(f"Tested {len(all_results)} combinations successfully")
    
    return best_params, best_results, all_results


def main():
    parser = argparse.ArgumentParser(description='Optimize AFL ELO parameters using grid search')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for training data')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for training data (inclusive)')
    parser.add_argument('--cv-folds', type=int, default=3,
                        help='Number of cross-validation folds (years)')
    parser.add_argument('--output-path', type=str, default='data/optimal_elo_params_standard.json',
                        help='Path to save optimal parameters')
    
    args = parser.parse_args()
    
    print("AFL ELO Grid Search Optimization")
    print("=" * 50)
    print(f"Database: {args.db_path}")
    print(f"Data period: {args.start_year}-{args.end_year}")
    print(f"CV folds: {args.cv_folds}")
    print(f"Output: {args.output_path}")
    print()
    
    # Run grid search optimization
    best_params, best_results, all_results = optimize_elo_grid_search(
        args.db_path, 
        args.start_year,
        args.end_year,
        args.cv_folds
    )
    
    # Display results
    print("Best Parameters Found:")
    print("-" * 30)
    for param, value in best_params.items():
        print(f"  {param}: {value}")
    
    print("\nBest Results:")
    print("-" * 30)
    print(f"  Accuracy: {best_results['accuracy']:.3f} ({best_results['accuracy']*100:.1f}%)")
    print(f"  Brier Score: {best_results['brier_score']:.4f}")
    print(f"  Log Loss: {best_results['log_loss']:.4f}")
    print(f"  Test matches: {best_results['test_matches']}")
    
    # Show top 5 parameter combinations
    print("\nTop 5 Parameter Combinations:")
    print("-" * 60)
    sorted_results = sorted(all_results, key=lambda x: x['brier_score'])
    
    for i, result in enumerate(sorted_results[:5]):
        print(f"{i+1}. Brier Score: {result['brier_score']:.4f}, Accuracy: {result['results']['accuracy']:.3f}")
        params = result['params']
        print(f"   K: {params['k_factor']}, Home: {params['default_home_advantage']}, "
              f"Interstate: {params['interstate_home_advantage']}, Margin: {params['margin_factor']}")
        print(f"   Carryover: {params['season_carryover']}, Max Margin: {params['max_margin']}, "
              f"Beta: {params['beta']}")
        print()
    
    # Save results
    save_elo_parameters(best_params, args.output_path, None)
    
    print(f"Optimal parameters saved to: {args.output_path}")
    print("\nNext steps:")
    print(f"1. Train model: python3 afl_elo_train_standard.py --params-file {args.output_path}")
    print(f"2. Optimize margin methods: python3 afl_elo_margin_methods.py --elo-params {args.output_path}")


if __name__ == '__main__':
    main()