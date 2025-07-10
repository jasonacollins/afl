#!/usr/bin/env python3
"""
AFL ELO Optimization Module

Consolidated optimization logic with support for different strategies,
evaluation methods, and parameter spaces.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, List, Tuple, Optional, Callable, Union
from dataclasses import dataclass
from datetime import datetime
from sklearn.model_selection import TimeSeriesSplit
from skopt import gp_minimize
from skopt.space import Real, Integer, Dimension
from skopt.utils import use_named_args
from abc import ABC, abstractmethod
import time


@dataclass
class OptimizationResult:
    """Standardized optimization result container"""
    best_score: float
    best_params: Dict[str, Any]
    optimization_history: List[float]
    total_iterations: int
    total_time: float
    method: str
    metric: str
    additional_info: Dict[str, Any] = None


class ParameterSpace:
    """Parameter space definition and validation"""
    
    def __init__(self, dimensions: List[Dimension], name: str = ""):
        self.dimensions = dimensions
        self.name = name
        self.param_names = [dim.name for dim in dimensions]
    
    def validate_params(self, params: Dict[str, Any]) -> bool:
        """Validate that parameters are within bounds"""
        for dim in self.dimensions:
            if dim.name not in params:
                return False
            value = params[dim.name]
            if hasattr(dim, 'bounds'):
                low, high = dim.bounds
                if not (low <= value <= high):
                    return False
        return True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert parameter space to dictionary representation"""
        return {
            'name': self.name,
            'dimensions': [
                {
                    'name': dim.name,
                    'type': type(dim).__name__,
                    'bounds': getattr(dim, 'bounds', None)
                }
                for dim in self.dimensions
            ]
        }


class EvaluationStrategy(ABC):
    """Base class for evaluation strategies"""
    
    @abstractmethod
    def evaluate(self, model_class, params: Dict[str, Any], data: pd.DataFrame, 
                db_path: str = None, **kwargs) -> float:
        """Evaluate parameters and return score"""
        pass


class WalkForwardEvaluator(EvaluationStrategy):
    """Walk-forward validation evaluator"""
    
    def __init__(self, metric: str = 'brier_score', stability_checks: bool = True):
        self.metric = metric
        self.stability_checks = stability_checks
    
    def evaluate(self, model_class, params: Dict[str, Any], data: pd.DataFrame, 
                db_path: str = None, **kwargs) -> float:
        """
        Evaluate parameters using walk-forward validation
        
        Parameters:
        -----------
        model_class : class
            Model class to instantiate
        params : Dict[str, Any]
            Parameters to evaluate
        data : pd.DataFrame
            Training data
        db_path : str, optional
            Database path for venue lookups
        
        Returns:
        --------
        float
            Evaluation score (lower is better for most metrics)
        """
        # Ensure chronological order
        data = data.sort_values(['year', 'match_date'])
        
        seasons = sorted(data['year'].unique())
        if len(seasons) < 2:
            return np.inf  # Not enough data for walk-forward
        
        # Get all unique teams
        all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
        
        # Get database connection for venue lookups
        db_connection = None
        if db_path:
            try:
                from data_io import get_database_connection
                db_connection = get_database_connection(db_path)
            except Exception:
                pass  # Continue without venue lookups if database connection fails
        
        all_scores = []
        
        try:
            for i in range(len(seasons) - 1):
                train_seasons = seasons[:i + 1]
                test_season = seasons[i + 1]
                
                train_data = data[data['year'].isin(train_seasons)]
                test_data = data[data['year'] == test_season]
                
                # Create fresh model for this split
                model = model_class(**params)
                model.initialize_ratings(all_teams, db_path)
                
                # Train model on historical data
                prev_year = None
                for _, match in train_data.iterrows():
                    # Apply season carryover at the start of a new season
                    if prev_year is not None and match['year'] != prev_year:
                        model.apply_season_carryover(match['year'])
                    
                    # Update ratings with venue information and database connection
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
                        db_connection=db_connection
                    )
                    prev_year = match['year']
            
            # Apply season carryover before predicting test season
            if prev_year is not None and test_season != prev_year:
                model.apply_season_carryover(test_season)
            
            # Stability check
            if self.stability_checks:
                max_rating = max(model.team_ratings.values())
                min_rating = min(model.team_ratings.values())
                if max_rating > 2500 or min_rating < 500:
                    return np.inf  # Unstable parameters
            
                # Evaluate on test season
                if self.metric == 'brier_score':
                    score = self._evaluate_brier_score(model, test_data, db_connection)
                elif self.metric == 'mae':
                    score = self._evaluate_mae(model, test_data, db_connection, **kwargs)
                elif self.metric == 'log_loss':
                    score = self._evaluate_log_loss(model, test_data, db_connection)
                else:
                    raise ValueError(f"Unknown metric: {self.metric}")
                
                all_scores.append(score)
        
        finally:
            # Clean up database connection
            if db_connection:
                try:
                    db_connection.close()
                except Exception:
                    pass
        
        return np.mean(all_scores) if all_scores else np.inf
    
    def _evaluate_brier_score(self, model, test_data: pd.DataFrame, db_connection=None) -> float:
        """Calculate Brier score for win probability predictions"""
        predictions = []
        actuals = []
        
        for _, match in test_data.iterrows():
            prob = model.calculate_win_probability(
                match['home_team'], match['away_team'], 
                venue=match.get('venue'), db_connection=db_connection
            )
            predictions.append(max(min(prob, 0.999), 0.001))  # Clip probabilities
            
            if match['hscore'] > match['ascore']:
                actuals.append(1.0)
            elif match['hscore'] < match['ascore']:
                actuals.append(0.0)
            else:
                actuals.append(0.5)  # Draw
        
        return np.mean((np.array(predictions) - np.array(actuals)) ** 2)
    
    def _evaluate_mae(self, model, test_data: pd.DataFrame, db_connection=None, **kwargs) -> float:
        """Calculate Mean Absolute Error for margin predictions"""
        margin_method = kwargs.get('margin_method', 'simple')
        margin_params = kwargs.get('margin_params', [])
        
        predictions = []
        actuals = []
        
        for _, match in test_data.iterrows():
            # Get ELO-based prediction
            if margin_method == 'simple':
                home_rating = model.team_ratings.get(match['home_team'], model.base_rating)
                away_rating = model.team_ratings.get(match['away_team'], model.base_rating)
                home_advantage = model.get_contextual_home_advantage(
                    match['home_team'], match['away_team'], 
                    venue=match.get('venue'), db_connection=db_connection
                )
                rating_diff = (home_rating + home_advantage) - away_rating
                predicted_margin = rating_diff * margin_params[0]
            else:
                # Other margin methods would be implemented here
                raise NotImplementedError(f"Margin method {margin_method} not implemented")
            
            actual_margin = match['hscore'] - match['ascore']
            
            predictions.append(predicted_margin)
            actuals.append(actual_margin)
        
        return np.mean(np.abs(np.array(predictions) - np.array(actuals)))
    
    def _evaluate_log_loss(self, model, test_data: pd.DataFrame, db_connection=None) -> float:
        """Calculate log loss for win probability predictions"""
        predictions = []
        actuals = []
        
        for _, match in test_data.iterrows():
            prob = model.calculate_win_probability(
                match['home_team'], match['away_team'], 
                venue=match.get('venue'), db_connection=db_connection
            )
            predictions.append(max(min(prob, 0.999), 0.001))  # Clip probabilities
            
            if match['hscore'] > match['ascore']:
                actuals.append(1.0)
            elif match['hscore'] < match['ascore']:
                actuals.append(0.0)
            else:
                actuals.append(0.5)  # Draw
        
        # Calculate log loss
        log_loss = 0
        for pred, actual in zip(predictions, actuals):
            if actual == 1.0:
                log_loss += -np.log(pred)
            elif actual == 0.0:
                log_loss += -np.log(1 - pred)
            else:  # Draw (0.5)
                log_loss += -np.log(1 - abs(0.5 - pred))
        
        return log_loss / len(predictions)


class CrossValidationEvaluator(EvaluationStrategy):
    """Time-series cross-validation evaluator"""
    
    def __init__(self, cv_folds: int = 3, metric: str = 'brier_score'):
        self.cv_folds = cv_folds
        self.metric = metric
    
    def evaluate(self, model_class, params: Dict[str, Any], data: pd.DataFrame, 
                db_path: str = None, **kwargs) -> float:
        """
        Evaluate parameters using time-series cross-validation
        """
        # Create time-based splits
        tscv = TimeSeriesSplit(n_splits=self.cv_folds)
        cv_scores = []
        
        # Ensure data is sorted
        data = data.sort_values(['year', 'match_date'])
        
        # Get all unique teams
        all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
        
        # Get database connection for venue lookups
        db_connection = None
        if db_path:
            try:
                from data_io import get_database_connection
                db_connection = get_database_connection(db_path)
            except Exception:
                pass  # Continue without venue lookups if database connection fails
        
        try:
            for fold_idx, (train_idx, test_idx) in enumerate(tscv.split(data)):
                # Create new model for each fold
                fold_model = model_class(**params)
                fold_model.initialize_ratings(all_teams, db_path)
                
                train_data = data.iloc[train_idx]
                test_data = data.iloc[test_idx]
                
                # Train on training data with proper season carryover
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
                        venue=match.get('venue'),
                        db_connection=db_connection
                    )
                    prev_year = match['year']
            
                # Apply season carryover before testing if needed
                test_years = test_data['year'].unique()
                if len(test_years) > 0 and prev_year is not None:
                    test_year = test_years[0]
                    if test_year != prev_year:
                        fold_model.apply_season_carryover(test_year)
                
                # Evaluate on test data
                if self.metric == 'brier_score':
                    score = self._evaluate_brier_score(fold_model, test_data, db_connection)
                else:
                    raise ValueError(f"Metric {self.metric} not implemented for CV")
                
                cv_scores.append(score)
        
        finally:
            # Clean up database connection
            if db_connection:
                try:
                    db_connection.close()
                except Exception:
                    pass
        
        return np.mean(cv_scores)
    
    def _evaluate_brier_score(self, model, test_data: pd.DataFrame, db_connection=None) -> float:
        """Calculate Brier score for win probability predictions"""
        predictions = []
        actuals = []
        
        for _, match in test_data.iterrows():
            prob = model.calculate_win_probability(
                match['home_team'], match['away_team'], 
                venue=match.get('venue'), db_connection=db_connection
            )
            predictions.append(max(min(prob, 0.999), 0.001))  # Clip probabilities
            
            if match['hscore'] > match['ascore']:
                actuals.append(1.0)
            elif match['hscore'] < match['ascore']:
                actuals.append(0.0)
            else:
                actuals.append(0.5)  # Draw
        
        return np.mean((np.array(predictions) - np.array(actuals)) ** 2)


class OptimizationStrategy(ABC):
    """Base class for optimization strategies"""
    
    @abstractmethod
    def optimize(self, objective_function: Callable, parameter_space: ParameterSpace,
                n_calls: int = 100, **kwargs) -> OptimizationResult:
        """Run optimization and return results"""
        pass


class BayesianOptimizer(OptimizationStrategy):
    """Bayesian optimization using scikit-optimize"""
    
    def __init__(self, n_starts: int = 1, acq_func: str = 'EI', 
                 xi: float = 0.3, noise: float = 1e-5):
        self.n_starts = n_starts
        self.acq_func = acq_func
        self.xi = xi
        self.noise = noise
    
    def optimize(self, objective_function: Callable, parameter_space: ParameterSpace,
                n_calls: int = 100, **kwargs) -> OptimizationResult:
        """
        Run Bayesian optimization
        
        Parameters:
        -----------
        objective_function : Callable
            Function to minimize
        parameter_space : ParameterSpace
            Parameter space to search
        n_calls : int
            Number of optimization iterations
        
        Returns:
        --------
        OptimizationResult
            Optimization results
        """
        verbose = kwargs.get('verbose', True)
        
        # Multi-start optimization
        all_results = []
        overall_best_score = float('inf')
        overall_best_params = None
        overall_start_time = datetime.now()
        
        if verbose:
            print(f"Running Bayesian optimization with {self.n_starts} starts...")
            print(f"Each start will run {n_calls} iterations.\n")
        
        for start_idx in range(self.n_starts):
            if verbose and self.n_starts > 1:
                print(f"{'='*60}")
                print(f"START {start_idx + 1}/{self.n_starts} - Random seed: {42 + start_idx}")
                print(f"{'='*60}")
            
            # Progress tracking
            iteration = [0]
            start_time = datetime.now()
            
            # Create objective function wrapper for progress tracking
            @use_named_args(parameter_space.dimensions)
            def objective_wrapper(**params):
                iteration[0] += 1
                
                # Convert to parameter dictionary
                param_dict = {name: params[name] for name in parameter_space.param_names}
                
                # Evaluate
                score = objective_function(param_dict)
                
                # Track best score for this start
                if not hasattr(objective_wrapper, 'best_score') or score < objective_wrapper.best_score:
                    objective_wrapper.best_score = score
                    objective_wrapper.best_params = param_dict
                
                # Progress update
                if verbose:
                    elapsed = (datetime.now() - start_time).total_seconds() / 60
                    if self.n_starts > 1:
                        print(f"Start {start_idx + 1} - Iter {iteration[0]}/{n_calls} - "
                              f"Elapsed: {elapsed:.1f}min - Current: {score:.4f} - "
                              f"Best this start: {objective_wrapper.best_score:.4f}")
                    else:
                        print(f"Iter {iteration[0]}/{n_calls} - "
                              f"Elapsed: {elapsed:.1f}min - Current: {score:.4f} - "
                              f"Best: {objective_wrapper.best_score:.4f}")
                
                return score
            
            # Run optimization for this start
            result = gp_minimize(
                func=objective_wrapper,
                dimensions=parameter_space.dimensions,
                n_calls=n_calls,
                n_initial_points=min(25, max(10, n_calls // 4)),
                acq_func=self.acq_func,
                xi=self.xi,
                noise=self.noise,
                random_state=42 + start_idx
            )
            
            all_results.append(result)
            
            # Update overall best if this start found something better
            if result.fun < overall_best_score:
                overall_best_score = result.fun
                overall_best_params = {
                    parameter_space.param_names[i]: result.x[i] 
                    for i in range(len(parameter_space.param_names))
                }
            
            if verbose:
                elapsed = datetime.now() - start_time
                if self.n_starts > 1:
                    print(f"\nStart {start_idx + 1} complete!")
                    print(f"  Best score: {result.fun:.4f}")
                    print(f"  Time elapsed: {elapsed}")
                    print(f"  Overall best so far: {overall_best_score:.4f}")
        
        # Use the result object with the best score
        best_result = min(all_results, key=lambda x: x.fun)
        
        total_time = (datetime.now() - overall_start_time).total_seconds()
        total_evaluations = sum(len(res.func_vals) for res in all_results)
        
        if verbose:
            print(f"\n{'='*60}")
            print("BAYESIAN OPTIMIZATION COMPLETE")
            print(f"{'='*60}")
            if self.n_starts > 1:
                print(f"Results from {self.n_starts} optimization runs:")
                for i, res in enumerate(all_results):
                    print(f"  Start {i+1}: {res.fun:.4f}")
                print(f"Best across all starts: {best_result.fun:.4f}")
            
            print(f"\nBest parameters found:")
            for key, value in overall_best_params.items():
                if isinstance(value, float):
                    print(f"  {key}: {value:.4f}")
                else:
                    print(f"  {key}: {value}")
            print(f"\nBest score: {best_result.fun:.4f}")
            print(f"Total evaluations: {total_evaluations}")
            print(f"Total time: {total_time/60:.1f} minutes")
        
        return OptimizationResult(
            best_score=best_result.fun,
            best_params=overall_best_params,
            optimization_history=best_result.func_vals,
            total_iterations=total_evaluations,
            total_time=total_time,
            method='bayesian',
            metric=kwargs.get('metric', 'unknown'),
            additional_info={
                'n_starts': self.n_starts,
                'acq_func': self.acq_func,
                'all_results': all_results
            }
        )


class GridSearchOptimizer(OptimizationStrategy):
    """Grid search optimizer"""
    
    def __init__(self, max_combinations: int = None):
        self.max_combinations = max_combinations
    
    def optimize(self, objective_function: Callable, parameter_space: ParameterSpace,
                n_calls: int = 100, **kwargs) -> OptimizationResult:
        """
        Run grid search optimization
        
        Note: This is a simplified implementation. Full grid search would 
        require discrete parameter grids.
        """
        raise NotImplementedError("Grid search optimization not fully implemented")


# Parameter space definitions
def get_elo_parameter_space() -> ParameterSpace:
    """Get standard ELO parameter space"""
    dimensions = [
        Integer(10, 50, name='k_factor'),
        Integer(0, 80, name='default_home_advantage'),
        Integer(20, 120, name='interstate_home_advantage'),
        Real(0.1, 0.7, name='margin_factor'),
        Real(0.3, 0.95, name='season_carryover'),
        Integer(60, 180, name='max_margin'),
        Real(0.02, 0.08, name='beta')
    ]
    return ParameterSpace(dimensions, "ELO_Standard")


def get_margin_parameter_spaces() -> Dict[str, ParameterSpace]:
    """Get margin prediction parameter spaces"""
    spaces = {
        'simple': ParameterSpace(
            [Real(0.01, 0.2, name='scale_factor')],
            "Margin_Simple"
        ),
        'diminishing_returns': ParameterSpace(
            [Real(0.005, 0.2, name='beta')],
            "Margin_DiminishingReturns"
        ),
        'linear': ParameterSpace(
            [Real(0.01, 0.2, name='slope'), Real(-10, 10, name='intercept')],
            "Margin_Linear"
        )
    }
    return spaces


def get_margin_only_parameter_space() -> ParameterSpace:
    """Get margin-only ELO parameter space"""
    dimensions = [
        Integer(20, 60, name='k_factor'),
        Integer(0, 80, name='home_advantage'),
        Real(0.6, 0.95, name='season_carryover'),
        Real(0.02, 0.3, name='margin_scale'),
        Real(20, 80, name='scaling_factor'),
        Integer(40, 150, name='max_margin')
    ]
    return ParameterSpace(dimensions, "ELO_MarginOnly")


# Utility functions
def create_optimization_objective(model_class, evaluator: EvaluationStrategy, 
                                 data: pd.DataFrame, db_path: str = None, 
                                 **kwargs) -> Callable:
    """
    Create an objective function for optimization
    
    Parameters:
    -----------
    model_class : class
        Model class to optimize
    evaluator : EvaluationStrategy
        Evaluation strategy to use
    data : pd.DataFrame
        Training data
    db_path : str, optional
        Database path
    
    Returns:
    --------
    Callable
        Objective function that takes parameters and returns score
    """
    def objective(params: Dict[str, Any]) -> float:
        return evaluator.evaluate(model_class, params, data, db_path, **kwargs)
    
    return objective


def save_optimization_convergence_plot(result: OptimizationResult, 
                                     output_path: str = 'optimization_convergence.png') -> bool:
    """
    Save optimization convergence plot
    
    Parameters:
    -----------
    result : OptimizationResult
        Optimization result containing history
    output_path : str
        Path to save the plot
    
    Returns:
    --------
    bool
        True if plot was saved successfully
    """
    try:
        import matplotlib.pyplot as plt
        
        plt.figure(figsize=(10, 6))
        plt.plot(result.optimization_history)
        plt.title(f'{result.method.title()} Optimization Convergence')
        plt.xlabel('Iteration')
        plt.ylabel(f'{result.metric.title()} Score')
        plt.grid(True)
        plt.tight_layout()
        plt.savefig(output_path)
        plt.close()
        return True
    except ImportError:
        return False


def run_optimization(model_class, parameter_space: ParameterSpace, 
                    data: pd.DataFrame, db_path: str = None,
                    method: str = 'bayesian', evaluation: str = 'walkforward',
                    n_calls: int = 100, metric: str = 'brier_score',
                    verbose: bool = True, **kwargs) -> OptimizationResult:
    """
    High-level optimization function
    
    Parameters:
    -----------
    model_class : class
        Model class to optimize
    parameter_space : ParameterSpace
        Parameter space to search
    data : pd.DataFrame
        Training data
    db_path : str, optional
        Database path
    method : str
        Optimization method ('bayesian', 'grid')
    evaluation : str
        Evaluation method ('walkforward', 'cv')
    n_calls : int
        Number of optimization iterations
    metric : str
        Metric to optimize
    verbose : bool
        Whether to print progress
    
    Returns:
    --------
    OptimizationResult
        Optimization results
    """
    # Create evaluator
    if evaluation == 'walkforward':
        evaluator = WalkForwardEvaluator(metric=metric)
    elif evaluation == 'cv':
        evaluator = CrossValidationEvaluator(metric=metric)
    else:
        raise ValueError(f"Unknown evaluation method: {evaluation}")
    
    # Create optimizer
    if method == 'bayesian':
        optimizer = BayesianOptimizer(**kwargs)
    elif method == 'grid':
        optimizer = GridSearchOptimizer(**kwargs)
    else:
        raise ValueError(f"Unknown optimization method: {method}")
    
    # Create objective function
    objective = create_optimization_objective(
        model_class, evaluator, data, db_path, **kwargs
    )
    
    # Run optimization
    result = optimizer.optimize(
        objective, parameter_space, n_calls, 
        verbose=verbose, metric=metric, **kwargs
    )
    
    return result