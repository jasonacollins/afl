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

from .elo_core import AFLEloModel
from .scoring import calculate_bits_score, calculate_brier_score, evaluate_predictions


def evaluate_parameters_cv(params: List[float], matches_df: pd.DataFrame, 
                          cv_folds: int = 3, verbose: bool = False) -> float:
    """
    Evaluate ELO parameters using cross-validation
    Returns Brier score (lower is better)
    
    Parameters:
    -----------
    params : List[float]
        ELO parameters [k_factor, home_advantage, margin_factor, season_carryover, max_margin]
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
    k_factor, home_advantage, margin_factor, season_carryover, max_margin = params
    
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
            beta=0.05  # Default beta for margin predictions
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
                                   verbose: bool = False, return_detailed: bool = False):
    """
    Evaluate ELO parameters using walk-forward validation.
    Trains on seasons up to year N and tests on season N+1.
    Returns the average Brier score across all splits, with optional BITS scoring.
    
    Parameters:
    -----------
    params : List[float]
        ELO parameters [k_factor, home_advantage, margin_factor, season_carryover, max_margin]
    matches_df : pd.DataFrame
        Historical match data
    verbose : bool
        Print detailed output
    return_detailed : bool
        If True, return dict with detailed metrics including BITS scores
        
    Returns:
    --------
    float or dict
        Average Brier score across splits (if return_detailed=False)
        or dict with detailed metrics (if return_detailed=True)
    """
    k_factor, home_advantage, margin_factor, season_carryover, max_margin = params

    # Ensure chronological order
    matches_df = matches_df.sort_values(['year', 'match_date'])

    seasons = sorted(matches_df['year'].unique())
    if len(seasons) < 2:
        return np.inf  # Not enough data for walk‑forward

    # All unique teams
    all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()

    split_losses = []
    split_bits_scores = []
    all_predictions = []

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
            beta=0.05  # Default beta for margin predictions
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
        split_predictions = []
        
        for _, match in test_data.iterrows():
            prob = model.calculate_win_probability(match['home_team'], match['away_team'])
            clipped_prob = max(min(prob, 0.999), 0.001)  # clip for numerical stability
            test_probs.append(clipped_prob)

            if match['hscore'] > match['ascore']:
                actual_result = 1.0
                result_str = 'home_win'
            elif match['hscore'] < match['ascore']:
                actual_result = 0.0
                result_str = 'away_win'
            else:
                actual_result = 0.5
                result_str = 'draw'
            
            test_results.append(actual_result)
            
            # Store prediction for detailed analysis
            prediction = {
                'home_win_probability': prob,
                'actual_result': result_str,
                'season': test_season,
                'home_team': match['home_team'],
                'away_team': match['away_team']
            }
            split_predictions.append(prediction)
            all_predictions.append(prediction)

        # Calculate Brier score for this split
        test_probs_arr = np.array(test_probs)
        test_results_arr = np.array(test_results)
        brier_score = np.mean((test_probs_arr - test_results_arr) ** 2)
        split_losses.append(brier_score)
        
        # Calculate BITS score for this split
        bits_scores = [calculate_bits_score(prob, result) for prob, result in zip(test_probs, test_results)]
        avg_bits_score = np.mean(bits_scores)
        split_bits_scores.append(avg_bits_score)

        if verbose:
            print(
                f"Train ≤ {test_season - 1}, test {test_season}: "
                f"Brier {brier_score:.4f}, BITS {avg_bits_score:.4f}"
            )

    if not split_losses:
        return np.inf
    
    if return_detailed:
        # Return detailed metrics
        overall_evaluation = evaluate_predictions(all_predictions)
        
        # Calculate log loss separately (similar to ELO model's evaluate_model method)
        log_loss_total = 0
        for pred in all_predictions:
            true_val = 1.0 if pred['actual_result'] == 'home_win' else (0.5 if pred['actual_result'] == 'draw' else 0.0)
            predicted_prob = max(min(pred['home_win_probability'], 0.999), 0.001)  # Clip to avoid log(0)
            
            if true_val == 1.0:
                log_loss_total += -np.log(predicted_prob)
            elif true_val == 0.0:
                log_loss_total += -np.log(1 - predicted_prob)
            else:  # draw (true_val == 0.5)
                log_loss_total += -0.5 * np.log(predicted_prob) - 0.5 * np.log(1 - predicted_prob)
        
        log_loss_avg = log_loss_total / len(all_predictions)
        
        return {
            'brier_score': np.mean(split_losses),
            'log_loss': log_loss_avg,
            'bits_score_per_game': np.mean(split_bits_scores),
            'bits_score_total': np.sum(split_bits_scores) * len(all_predictions) / len(split_bits_scores),
            'accuracy': overall_evaluation['accuracy'],
            'total_predictions': len(all_predictions),
            'predictions': all_predictions,
            'split_brier_scores': split_losses,
            'split_bits_scores': split_bits_scores
        }
    else:
        return np.mean(split_losses)


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
                        params = {
                            'base_rating': param_grid['base_rating'][0],  # Use first value
                            'k_factor': k_factor,
                            'home_advantage': home_advantage,
                            'margin_factor': margin_factor,
                            'season_carryover': season_carryover,
                            'max_margin': max_margin,
                            'beta': 0.05  # Default beta for margin predictions
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
        
        # Use walk-forward validation instead of cross-validation for consistency
        avg_score = evaluate_parameters_walkforward(
            [params['k_factor'], params['home_advantage'], params['margin_factor'], 
             params['season_carryover'], params['max_margin']],
            data,
            verbose=False
        )
        
        result = {
            'params': params,
            'brier_score': avg_score,
            'cv_scores': [avg_score]  # Single score for consistency
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
            
            # Evaluate parameters
            score = evaluate_parameters_walkforward(
                [k_factor, home_advantage, margin_factor, season_carryover, max_margin],
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


def evaluate_model_walkforward(params: List[float], matches_df: pd.DataFrame, 
                              model_type: str = 'standard', verbose: bool = False) -> float:
    """
    Unified walk-forward evaluation for both standard and margin ELO models
    
    Parameters:
    -----------
    params : List[float]
        Model parameters (length depends on model_type)
    matches_df : pd.DataFrame
        Historical match data
    model_type : str
        'standard' for AFLEloModel (returns Brier score) or 'margin' for MarginEloModel (returns MAE)
    verbose : bool
        Print detailed output
        
    Returns:
    --------
    float
        Average score across validation splits (Brier score or MAE depending on model_type)
    """
    from .elo_core import AFLEloModel, MarginEloModel
    
    if model_type == 'standard':
        if len(params) != 5:
            raise ValueError("Standard ELO model requires 5 parameters: [k_factor, home_advantage, margin_factor, season_carryover, max_margin]")
        k_factor, home_advantage, margin_factor, season_carryover, max_margin = params
        model_class = AFLEloModel
        model_kwargs = {
            'k_factor': k_factor,
            'home_advantage': home_advantage,
            'margin_factor': margin_factor,
            'season_carryover': season_carryover,
            'max_margin': max_margin,
            'beta': 0.05  # Default beta
        }
    elif model_type == 'margin':
        if len(params) != 6:
            raise ValueError("Margin ELO model requires 6 parameters: [k_factor, home_advantage, season_carryover, margin_scale, scaling_factor, max_margin]")
        k_factor, home_advantage, season_carryover, margin_scale, scaling_factor, max_margin = params
        
        # Mathematical stability constraints for margin model
        max_rating_change = k_factor * max_margin / scaling_factor
        if max_rating_change > 75:
            return 1e10
        if margin_scale < 0.03 and scaling_factor < 30:
            return 1e10
        if k_factor > 50 and scaling_factor < 40:
            return 1e10
        if scaling_factor <= 0 or k_factor <= 0 or margin_scale <= 0:
            return 1e10
            
        model_class = MarginEloModel
        model_kwargs = {
            'k_factor': k_factor,
            'home_advantage': home_advantage,
            'season_carryover': season_carryover,
            'margin_scale': margin_scale,
            'scaling_factor': scaling_factor,
            'max_margin': max_margin
        }
    else:
        raise ValueError(f"Unknown model_type: {model_type}. Use 'standard' or 'margin'")

    # Ensure chronological order
    matches_df = matches_df.sort_values(['year', 'match_date'])

    seasons = sorted(matches_df['year'].unique())
    if len(seasons) < 2:
        return 1e10

    # All unique teams
    all_teams = pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()

    split_scores = []

    for i in range(len(seasons) - 1):
        train_seasons = seasons[:i + 1]
        test_season = seasons[i + 1]

        train_data = matches_df[matches_df['year'].isin(train_seasons)]
        test_data = matches_df[matches_df['year'] == test_season]

        # Fresh model per split
        model = model_class(**model_kwargs)
        model.initialize_ratings(all_teams)

        # Train on historical data with proper season carryover
        prev_year = None
        for _, match in train_data.iterrows():
            if prev_year is not None and match['year'] != prev_year:
                if model_type == 'standard':
                    model.apply_season_carryover(match['year'])
                else:  # margin
                    model.apply_season_carryover()
            
            if model_type == 'standard':
                model.update_ratings(
                    match['home_team'], match['away_team'],
                    match['hscore'], match['ascore'],
                    match['year'],
                    match_id=match.get('match_id'),
                    round_number=match.get('round_number'),
                    match_date=match.get('match_date'),
                    venue=match.get('venue')
                )
            else:  # margin
                actual_margin = match['hscore'] - match['ascore']
                model.update_ratings(match['home_team'], match['away_team'], actual_margin)
                
                # Check for rating explosion during training
                max_rating = max(model.team_ratings.values())
                min_rating = min(model.team_ratings.values())
                if max_rating > 2500 or min_rating < 500 or not np.isfinite(max_rating) or not np.isfinite(min_rating):
                    return 1e10
            prev_year = match['year']

        # Apply season carryover before predicting test season
        if prev_year is not None and test_season != prev_year:
            if model_type == 'standard':
                model.apply_season_carryover(test_season)
            else:  # margin
                model.apply_season_carryover()
        
        # Predict on test season
        if model_type == 'standard':
            # Calculate Brier score
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

            test_probs_arr = np.array(test_probs)
            test_results_arr = np.array(test_results)
            split_score = np.mean((test_probs_arr - test_results_arr) ** 2)
        else:  # margin
            # Calculate MAE
            predicted_margins = []
            actual_margins = []
            
            for _, match in test_data.iterrows():
                pred_margin = model.predict_margin(match['home_team'], match['away_team'])
                actual_margin = match['hscore'] - match['ascore']
                
                predicted_margins.append(pred_margin)
                actual_margins.append(actual_margin)
                
                # Update model with this match
                model.update_ratings(match['home_team'], match['away_team'], actual_margin)
            
            split_score = np.mean(np.abs(np.array(predicted_margins) - np.array(actual_margins)))
            
            # Return infinity if we get NaN or infinite values
            if not np.isfinite(split_score):
                return 1e10
            if split_score > 1000:  # Clearly unstable
                return 1e10

        split_scores.append(split_score)

        if verbose:
            metric_name = "Brier" if model_type == 'standard' else "MAE"
            print(f"Train ≤ {test_season - 1}, test {test_season}: {metric_name} {split_score:.4f}")

    return np.mean(split_scores) if split_scores else 1e10


def parameter_tuning_grid_search_unified(data: pd.DataFrame, param_grid: Dict, 
                                        model_type: str = 'standard',
                                        max_combinations: Optional[int] = None) -> Dict:
    """
    Unified grid search for both standard and margin ELO parameters
    
    Parameters:
    -----------
    data : pd.DataFrame
        Historical match data
    param_grid : dict
        Dictionary of parameter ranges to test
    model_type : str
        'standard' for standard ELO or 'margin' for margin-only ELO
    max_combinations : int, optional
        Maximum number of parameter combinations to test (None for all)
        
    Returns:
    --------
    dict
        Best parameters and results
    """
    metric_name = "Brier score" if model_type == 'standard' else "MAE"
    best_score = float('inf')
    best_params = None
    all_results = []
    
    # Sort data by date to ensure chronological order
    data = data.sort_values(['year', 'match_date'])
    
    # Create parameter combinations based on model type
    param_combinations = []
    
    if model_type == 'standard':
        # Standard ELO parameters
        for k_factor in param_grid['k_factor']:
            for home_advantage in param_grid['home_advantage']:
                for margin_factor in param_grid['margin_factor']:
                    for season_carryover in param_grid['season_carryover']:
                        for max_margin in param_grid['max_margin']:
                            params = {
                                'base_rating': param_grid['base_rating'][0],
                                'k_factor': k_factor,
                                'home_advantage': home_advantage,
                                'margin_factor': margin_factor,
                                'season_carryover': season_carryover,
                                'max_margin': max_margin,
                                'beta': 0.05
                            }
                            param_combinations.append(params)
    
    elif model_type == 'margin':
        # Margin ELO parameters
        for k_factor in param_grid['k_factor']:
            for home_advantage in param_grid['home_advantage']:
                for season_carryover in param_grid['season_carryover']:
                    for max_margin in param_grid['max_margin']:
                        for margin_scale in param_grid['margin_scale']:
                            for scaling_factor in param_grid['scaling_factor']:
                                params = {
                                    'base_rating': param_grid['base_rating'][0],
                                    'k_factor': k_factor,
                                    'home_advantage': home_advantage,
                                    'season_carryover': season_carryover,
                                    'max_margin': max_margin,
                                    'margin_scale': margin_scale,
                                    'scaling_factor': scaling_factor
                                }
                                param_combinations.append(params)
    else:
        raise ValueError(f"Unknown model_type: {model_type}")
    
    # Limit the number of combinations if specified
    if max_combinations and len(param_combinations) > max_combinations:
        print(f"Limiting to {max_combinations} random parameter combinations out of {len(param_combinations)} total")
        import random
        random.shuffle(param_combinations)
        param_combinations = param_combinations[:max_combinations]
    
    total_combinations = len(param_combinations)
    print(f"Testing {total_combinations} parameter combinations...")
    
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
        
        # Prepare parameters for evaluation function
        if model_type == 'standard':
            param_list = [params['k_factor'], params['home_advantage'], params['margin_factor'], 
                         params['season_carryover'], params['max_margin']]
        else:  # margin
            param_list = [params['k_factor'], params['home_advantage'], params['season_carryover'], 
                         params['margin_scale'], params['scaling_factor'], params['max_margin']]
        
        # Use unified evaluation function
        avg_score = evaluate_model_walkforward(param_list, data, model_type=model_type, verbose=False)
        
        result = {
            'params': params,
            'score': avg_score,
            'scores': [avg_score]  # Single score for consistency
        }
        
        # Add metric-specific key for backward compatibility
        if model_type == 'standard':
            result['brier_score'] = avg_score
        else:
            result['mae'] = avg_score
            
        all_results.append(result)
        
        # Update best parameters if this is better
        if avg_score < best_score:
            best_score = avg_score
            best_params = params
            print(f"\nNew best parameters found ({metric_name}: {best_score:.4f}):")
            for k, v in best_params.items():
                print(f"  {k}: {v}")
    
    # Sort results by score
    all_results.sort(key=lambda x: x['score'])
    
    # Print the top 3 parameter combinations
    print(f"\nTop 3 parameter combinations:")
    for i, result in enumerate(all_results[:3]):
        print(f"  {i+1}. {metric_name}: {result['score']:.4f}, Parameters: {result['params']}")
    
    total_time = datetime.now() - start_time
    print(f"\nParameter tuning completed in {total_time.total_seconds()/60:.1f} minutes")
    
    return {
        'best_params': best_params,
        'best_score': best_score,
        'all_results': all_results
    }


# Backward compatibility functions - these now use the unified versions
def parameter_tuning_grid_search(data: pd.DataFrame, param_grid: Dict, 
                                cv: int = 5, max_combinations: Optional[int] = None) -> Dict:
    """
    Legacy wrapper for standard ELO grid search - now uses unified function
    """
    return parameter_tuning_grid_search_unified(data, param_grid, 'standard', max_combinations)


def parameter_tuning_margin_grid_search(data: pd.DataFrame, param_grid: Dict, 
                                       max_combinations: Optional[int] = None) -> Dict:
    """
    Legacy wrapper for margin ELO grid search - now uses unified function  
    """
    return parameter_tuning_grid_search_unified(data, param_grid, 'margin', max_combinations)




def evaluate_margin_elo_walkforward(params: List[float], matches_df: pd.DataFrame, 
                                  verbose: bool = False) -> float:
    """
    Legacy wrapper for margin ELO walk-forward evaluation - now uses unified function
    """
    return evaluate_model_walkforward(params, matches_df, 'margin', verbose)

