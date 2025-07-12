#!/usr/bin/env python3
"""
Optimization Module for AFL ELO System

Contains optimization strategies and evaluation methods for ELO parameters.
Supports both grid search and Bayesian optimization approaches.
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import TimeSeriesSplit
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
import json

try:
    from skopt import gp_minimize
    from skopt.space import Real, Integer
    from skopt.utils import use_named_args
    SKOPT_AVAILABLE = True
except ImportError:
    SKOPT_AVAILABLE = False

from elo_core import AFLEloModel


def evaluate_parameters_cv(params: List[float], matches_df: pd.DataFrame, 
                          cv_folds: int = 3, verbose: bool = False) -> float:
    """
    Evaluate ELO parameters using cross-validation
    Returns Brier score (lower is better)
    
    Parameters:
    -----------
    params : List[float]
        ELO parameters [k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta]
    matches_df : pd.DataFrame
        Historical match data
    cv_folds : int
        Number of cross-validation folds
    verbose : bool
        Print detailed output
        
    Returns:
    --------
    float
        Average Brier score across folds
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
                match['year'], match_id=match.get('match_id'),
                round_number=match.get('round_number'), 
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
        
        # Calculate Brier score for this fold
        test_probs_arr = np.array(test_probs)
        test_results_arr = np.array(test_results)
        cv_scores.append(np.mean((test_probs_arr - test_results_arr) ** 2))
        
        if verbose:
            print(f"Fold {fold_idx + 1}: Brier score {cv_scores[-1]:.4f}")
    
    return np.mean(cv_scores)


def evaluate_parameters_walkforward(params: List[float], matches_df: pd.DataFrame, 
                                   verbose: bool = False) -> float:
    """
    Evaluate ELO parameters using walk-forward validation.
    Trains on seasons up to year N and tests on season N+1.
    Returns the average Brier score across all splits.
    
    Parameters:
    -----------
    params : List[float]
        ELO parameters [k_factor, home_advantage, margin_factor, season_carryover, max_margin, beta]
    matches_df : pd.DataFrame
        Historical match data
    verbose : bool
        Print detailed output
        
    Returns:
    --------
    float
        Average Brier score across splits
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
                match_id=match.get('match_id'),
                round_number=match.get('round_number'),
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

        # Calculate Brier score for this split
        test_probs_arr = np.array(test_probs)
        test_results_arr = np.array(test_results)
        split_losses.append(np.mean((test_probs_arr - test_results_arr) ** 2))

        if verbose:
            print(
                f"Train ≤ {test_season - 1}, test {test_season}: "
                f"Brier {split_losses[-1]:.4f}"
            )

    return np.mean(split_losses) if split_losses else np.inf


def parameter_tuning_grid_search(data: pd.DataFrame, param_grid: Dict, 
                                cv: int = 5, max_combinations: Optional[int] = None) -> Dict:
    """
    Find optimal ELO parameters using grid search
    
    Parameters:
    -----------
    data : pd.DataFrame
        Historical match data
    param_grid : dict
        Dictionary of parameter ranges to test
    cv : int
        Number of cross-validation splits
    max_combinations : int, optional
        Maximum number of parameter combinations to test (None for all)
        
    Returns:
    --------
    dict
        Best parameters and results
    """
    # Create time-based splits to avoid training on future data
    tscv = TimeSeriesSplit(n_splits=cv)
    
    best_score = float('inf')  # Using Brier score, lower is better
    best_params = None
    all_results = []
    
    # Sort data by date to ensure chronological order
    data = data.sort_values(['year', 'match_date'])
    
    # Create parameter combinations
    param_combinations = []
    
    # Simple grid search using loops
    for k_factor in param_grid['k_factor']:
        for home_advantage in param_grid['home_advantage']:
            for margin_factor in param_grid['margin_factor']:
                for season_carryover in param_grid['season_carryover']:
                    for max_margin in param_grid['max_margin']:
                        for beta in param_grid.get('beta', [0.05]):  # Default if not in grid
                            params = {
                                'base_rating': param_grid['base_rating'][0],  # Use first value
                                'k_factor': k_factor,
                                'home_advantage': home_advantage,
                                'margin_factor': margin_factor,
                                'season_carryover': season_carryover,
                                'max_margin': max_margin,
                                'beta': beta
                            }
                            param_combinations.append(params)
    
    # Limit the number of combinations if specified
    if max_combinations and len(param_combinations) > max_combinations:
        print(f"Limiting to {max_combinations} random parameter combinations out of {len(param_combinations)} total")
        import random
        random.shuffle(param_combinations)
        param_combinations = param_combinations[:max_combinations]
    
    total_combinations = len(param_combinations)
    print(f"Testing {total_combinations} parameter combinations with {cv}-fold cross-validation...")
    
    # Track progress
    start_time = datetime.now()
    
    for i, params in enumerate(param_combinations):
        if i % 10 == 0:  # Print progress every 10 combinations
            elapsed = datetime.now() - start_time
            if i > 0:
                avg_time_per_combo = elapsed.total_seconds() / i
                est_remaining = (total_combinations - i) * avg_time_per_combo
                print(f"Testing combination {i+1}/{total_combinations} - "
                      f"Elapsed: {elapsed.total_seconds()/60:.1f} min, "
                      f"Est. remaining: {est_remaining/60:.1f} min")
            else:
                print(f"Testing combination {i+1}/{total_combinations}")
        
        # Cross-validation scores for this parameter set
        cv_scores = []
        
        for train_idx, test_idx in tscv.split(data):
            train_data = data.iloc[train_idx]
            test_data = data.iloc[test_idx]
            
            # Train model on training data
            from elo_core import train_elo_model
            model = train_elo_model(train_data, params)
            
            # Predict on test data
            test_probs = []
            test_results = []
            
            # Get the year of the earliest test game
            test_year = test_data['year'].min()
            
            # Apply season carryover if needed
            if test_year > train_data['year'].max():
                model.apply_season_carryover(test_year)
            
            for _, match in test_data.iterrows():
                prob = model.calculate_win_probability(match['home_team'], match['away_team'])
                test_probs.append(prob)
                # Actual result (1 for home win, 0 for away win, 0.5 for draw)
                if match['hscore'] > match['ascore']:
                    result = 1.0
                elif match['hscore'] < match['ascore']:
                    result = 0.0
                else:
                    result = 0.5
                test_results.append(result)
            
            # Clip probabilities to avoid log(0) issues
            test_probs = [max(min(p, 0.999), 0.001) for p in test_probs]
            
            # Calculate Brier score for this fold
            test_probs_arr = np.array(test_probs)
            test_results_arr = np.array(test_results)
            fold_score = np.mean((test_probs_arr - test_results_arr) ** 2)
            cv_scores.append(fold_score)
        
        # Average score across CV folds
        avg_score = np.mean(cv_scores)
        
        result = {
            'params': params,
            'brier_score': avg_score,
            'cv_scores': cv_scores
        }
        all_results.append(result)
        
        # Update best parameters if this is better
        if avg_score < best_score:
            best_score = avg_score
            best_params = params
            print(f"\nNew best parameters found (Brier score: {best_score:.4f}):")
            for k, v in best_params.items():
                print(f"  {k}: {v}")
    
    # Sort results by score
    all_results.sort(key=lambda x: x['brier_score'])
    
    # Print the top 3 parameter combinations
    print("\nTop 3 parameter combinations:")
    for i, result in enumerate(all_results[:3]):
        print(f"  {i+1}. Brier score: {result['brier_score']:.4f}, Parameters: {result['params']}")
    
    total_time = datetime.now() - start_time
    print(f"\nParameter tuning completed in {total_time.total_seconds()/60:.1f} minutes")
    
    return {
        'best_params': best_params,
        'best_score': best_score,
        'all_results': all_results
    }


def optimize_elo_bayesian(matches_df: pd.DataFrame, n_calls: int = 100, 
                         cv_folds: int = 3, n_starts: int = 1, 
                         random_state: int = 42) -> Tuple[Dict, Any]:
    """
    Find optimal ELO parameters using Bayesian optimization
    
    Parameters:
    -----------
    matches_df : pd.DataFrame
        Historical match data
    n_calls : int
        Number of parameter combinations to try
    cv_folds : int
        Number of cross-validation folds  
    n_starts : int
        Number of optimization runs with different random seeds
    random_state : int
        Random seed for reproducibility
        
    Returns:
    --------
    Tuple[Dict, Any]
        Best parameters and optimization result object
    """
    if not SKOPT_AVAILABLE:
        raise ImportError("scikit-optimize is required for Bayesian optimization. Install with: pip install scikit-optimize")
    
    # Define the ELO parameter search space
    elo_space = [
        Integer(10, 50, name='k_factor'),
        Integer(0, 100, name='home_advantage'),
        Real(0.1, 0.7, name='margin_factor'),
        Real(0.3, 0.95, name='season_carryover'),
        Integer(60, 180, name='max_margin'),
        Real(0.02, 0.08, name='beta')
    ]
    
    print(f"Loading {len(matches_df)} matches for optimization")
    
    # Multi-start optimization
    all_results = []
    overall_best_score = float('inf')
    overall_best_params = None
    overall_start_time = datetime.now()
    
    print(f"\nRunning multi-start Bayesian optimization with {n_starts} starts...")
    print(f"Each start will run {n_calls} iterations.\n")
    
    for start_idx in range(n_starts):
        print(f"{'='*60}")
        print(f"START {start_idx + 1}/{n_starts} - Random seed: {random_state + start_idx}")
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
            func=objective,
            dimensions=elo_space,
            n_calls=n_calls,
            n_initial_points=max(25, n_calls // 4),  # More initial exploration
            acq_func='EI',  # Expected Improvement for better exploration
            xi=0.05,  # Exploration-exploitation trade-off parameter
            noise='gaussian',  # Handles noisy objectives
            random_state=random_state + start_idx  # Different seed for each start
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
    
    return best_params, result


# Margin prediction optimization functions
def predict_margin_simple(rating_diff: float, scale_factor: float) -> float:
    """Simple linear scaling method"""
    return rating_diff * scale_factor


def predict_margin_diminishing_returns(win_prob: float, beta: float) -> float:
    """Diminishing returns method"""
    return (win_prob - 0.5) / beta


def predict_margin_linear(rating_diff: float, slope: float, intercept: float) -> float:
    """Linear regression method"""
    return rating_diff * slope + intercept


def evaluate_margin_method_walkforward(params: List[float], method: str, 
                                     elo_params: Dict, matches_df: pd.DataFrame, 
                                     verbose: bool = False) -> float:
    """
    Evaluate margin prediction parameters using walk-forward validation
    Returns Mean Absolute Error (lower is better)
    
    Parameters:
    -----------
    params : List[float]
        Method-specific parameters
    method : str
        Margin prediction method ('simple', 'diminishing_returns', 'linear')
    elo_params : Dict
        ELO model parameters
    matches_df : pd.DataFrame
        Historical match data
    verbose : bool
        Print detailed output
        
    Returns:
    --------
    float
        Mean Absolute Error across validation splits
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
                match_id=match.get('match_id'),
                round_number=match.get('round_number'),
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