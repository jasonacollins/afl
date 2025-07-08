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
import sqlite3
from skopt import gp_minimize
from skopt.space import Real, Integer
from skopt.utils import use_named_args
import json
import argparse
from datetime import datetime


def fetch_afl_data(db_path, start_year=1990, end_year=None):
    """Fetch AFL match data from database"""
    conn = sqlite3.connect(db_path)
    
    query = """
    SELECT 
        m.year,
        m.round_number as round,
        ht.name as home_team,
        at.name as away_team,
        m.hscore,
        m.ascore,
        m.match_date
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE m.year >= ?
    """
    
    params = [start_year]
    if end_year:
        query += " AND m.year <= ?"
        params.append(end_year)
    
    query += " ORDER BY m.year, m.round_number, m.match_date"
    
    df = pd.read_sql_query(query, conn, params=params)
    conn.close()
    
    # Filter out incomplete matches
    df = df.dropna(subset=['hscore', 'ascore'])
    
    # Convert match_date to datetime
    df['match_date'] = pd.to_datetime(df['match_date'], errors='coerce')
    
    return df


class MarginEloModel:
    """ELO model optimized for margin prediction"""
    
    def __init__(self, k_factor=35, home_advantage=40, season_carryover=0.75, 
                 margin_scale=0.15, scaling_factor=50, max_margin=100, base_rating=1500):
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.season_carryover = season_carryover
        self.margin_scale = margin_scale
        self.scaling_factor = scaling_factor
        self.max_margin = max_margin
        self.base_rating = base_rating
        self.team_ratings = {}
        
    def initialize_ratings(self, teams):
        """Initialize all teams with base rating"""
        for team in teams:
            self.team_ratings[team] = self.base_rating
    
    def predict_margin(self, home_team, away_team):
        """Predict margin directly from ratings"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage to rating difference
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Convert to margin - simpler than win probability model
        predicted_margin = rating_diff * self.margin_scale
        
        return predicted_margin
    
    def update_ratings(self, home_team, away_team, actual_margin):
        """Update ratings based on actual margin"""
        # Get current ratings
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Predict margin
        predicted_margin = self.predict_margin(home_team, away_team)
        
        # Cap actual margin to reduce impact of blowouts
        capped_margin = np.sign(actual_margin) * min(abs(actual_margin), self.max_margin)
        
        # Calculate margin prediction error
        margin_error = capped_margin - predicted_margin
        
        # Calculate the raw rating change
        raw_rating_change = self.k_factor * margin_error / self.scaling_factor
        
        # Clip the rating change to prevent explosion and ensure stability
        max_change = min(40, self.k_factor * 0.8)  # Dynamic clipping based on k_factor
        rating_change = np.clip(raw_rating_change, -max_change, max_change)
        
        self.team_ratings[home_team] = home_rating + rating_change
        self.team_ratings[away_team] = away_rating - rating_change
    
    def apply_season_carryover(self):
        """Apply season carryover - regress ratings toward base rating (1500)"""
        for team in self.team_ratings:
            current_rating = self.team_ratings[team]
            self.team_ratings[team] = (
                self.base_rating + self.season_carryover * (current_rating - self.base_rating)
            )


# Define parameter search space for margin model - more conservative ranges
margin_space = [
    Integer(20, 60, name='k_factor'),          # Learning rate for rating updates
    Integer(0, 80, name='home_advantage'),     # Home advantage in rating points
    Real(0.6, 0.95, name='season_carryover'),  # Rating carryover between seasons
    Real(0.02, 0.3, name='margin_scale'),      # How rating diff converts to margin
    Real(20, 80, name='scaling_factor'),       # Converts margin error to rating change
    Integer(40, 150, name='max_margin')        # Cap for blowouts
]


def evaluate_margin_params_walkforward(params, matches_df, verbose=False):
    """
    Evaluate margin parameters using walk-forward validation
    Returns Mean Absolute Error (lower is better)
    """
    k_factor, home_advantage, season_carryover, margin_scale, scaling_factor, max_margin = params
    
    # Mathematical stability constraints
    max_rating_change = k_factor * max_margin / scaling_factor
    if max_rating_change > 75:  # No more than 75 points change per match
        return 1e10
    
    # Prevent numerical instability from extreme parameter combinations
    if margin_scale < 0.03 and scaling_factor < 30:  # Very small values together
        return 1e10
    if k_factor > 50 and scaling_factor < 40:  # High k with low scaling
        return 1e10
        
    # Basic parameter validation
    if scaling_factor <= 0 or k_factor <= 0 or margin_scale <= 0:
        return 1e10
    
    # Ensure chronological order
    matches_df = matches_df.sort_values(['year', 'match_date'])
    
    seasons = sorted(matches_df['year'].unique())
    if len(seasons) < 2:
        return 1e10
    
    all_errors = []
    
    # Walk-forward validation by season
    for test_season in seasons[1:]:
        # Initialize model
        model = MarginEloModel(
            k_factor=k_factor,
            home_advantage=home_advantage,
            season_carryover=season_carryover,
            margin_scale=margin_scale,
            scaling_factor=scaling_factor,
            max_margin=max_margin
        )
        
        # Get all teams
        all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()
        model.initialize_ratings(all_teams)
        
        # Train on all seasons before test season
        train_matches = matches_df[matches_df['year'] < test_season]
        
        # Process each training season
        for season in sorted(train_matches['year'].unique()):
            season_matches = train_matches[train_matches['year'] == season]
            
            # Update ratings for each match
            for _, match in season_matches.iterrows():
                actual_margin = match['hscore'] - match['ascore']
                model.update_ratings(match['home_team'], match['away_team'], actual_margin)
                
                # Check for rating explosion during training
                max_rating = max(model.team_ratings.values())
                min_rating = min(model.team_ratings.values())
                if max_rating > 2500 or min_rating < 500 or not np.isfinite(max_rating) or not np.isfinite(min_rating):
                    return 1e10
            
            # Apply season carryover (except after last training season)
            if season < test_season - 1:
                model.apply_season_carryover()
        
        # Test on test season
        test_matches = matches_df[matches_df['year'] == test_season]
        predicted_margins = []
        actual_margins = []
        
        for _, match in test_matches.iterrows():
            # Predict
            pred_margin = model.predict_margin(match['home_team'], match['away_team'])
            actual_margin = match['hscore'] - match['ascore']
            
            predicted_margins.append(pred_margin)
            actual_margins.append(actual_margin)
            
            # Update model with this match
            model.update_ratings(match['home_team'], match['away_team'], actual_margin)
        
        # Calculate MAE for this season
        season_mae = np.mean(np.abs(np.array(predicted_margins) - np.array(actual_margins)))
        
        # Return infinity if we get NaN or infinite values
        if not np.isfinite(season_mae):
            return 1e10
            
        all_errors.append(season_mae)
        
        # Early termination if any season shows instability
        if season_mae > 1000:  # Clearly unstable
            return 1e10
        
        if verbose:
            print(f"Train ≤ {test_season - 1}, test {test_season}: MAE {season_mae:.2f}")
    
    return np.mean(all_errors) if all_errors else 1e10


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
            mae = evaluate_margin_params_walkforward(param_values, matches_df, verbose=False)
            
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
    
    with open(args.output_path, 'w') as f:
        json.dump(output_data, f, indent=4)
    
    print(f"\nOptimal margin parameters saved to: {args.output_path}")
    print("\nNext steps:")
    print("1. Train the margin model with these parameters")
    print("2. Compare MAE with your current two-stage approach")
    print("3. Run predictions using both models independently")


if __name__ == '__main__':
    main()