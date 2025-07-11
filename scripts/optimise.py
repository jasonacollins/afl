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
import json
from collections import defaultdict

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


class OptimizationDiagnostics:
    """Track and log optimization diagnostics"""
    
    def __init__(self, parameter_space: ParameterSpace, log_file: str = 'optimization_diagnostics.json'):
        self.parameter_space = parameter_space
        self.log_file = log_file
        self.iteration_history = []
        self.constraint_violations = []
        self.convergence_metrics = {
            'improvement_rates': [],
            'plateau_iterations': 0,
            'best_score_history': [],
            'parameter_variance': defaultdict(list)
        }
        self.start_time = datetime.now()
    
    def log_iteration(self, iteration: int, params: Dict[str, Any], score: float, is_best: bool = False):
        """Log details of each iteration"""
        entry = {
            'iteration': iteration,
            'timestamp': datetime.now().isoformat(),
            'elapsed_seconds': (datetime.now() - self.start_time).total_seconds(),
            'parameters': params.copy(),
            'score': score,
            'is_best': is_best
        }
        self.iteration_history.append(entry)
        
        # Track parameter variance
        for param_name, value in params.items():
            self.convergence_metrics['parameter_variance'][param_name].append(value)
        
        # Track best score history
        if is_best:
            self.convergence_metrics['best_score_history'].append({
                'iteration': iteration,
                'score': score,
                'improvement': self._calculate_improvement_rate()
            })
    
    def check_constraints(self, params: Dict[str, Any]) -> List[str]:
        """Check for logical constraint violations"""
        violations = []
        
        # Check interstate vs default home advantage
        if 'default_home_advantage' in params and 'interstate_home_advantage' in params:
            if params['interstate_home_advantage'] < params['default_home_advantage']:
                violations.append(f"Interstate advantage ({params['interstate_home_advantage']:.2f}) < "
                                f"Default advantage ({params['default_home_advantage']:.2f})")
        
        # Check parameter bounds
        for dim in self.parameter_space.dimensions:
            if dim.name in params:
                value = params[dim.name]
                if hasattr(dim, 'bounds'):
                    low, high = dim.bounds
                    if value < low or value > high:
                        violations.append(f"{dim.name} = {value} outside bounds [{low}, {high}]")
        
        # Log violations
        if violations:
            self.constraint_violations.append({
                'iteration': len(self.iteration_history),
                'violations': violations,
                'parameters': params.copy()
            })
        
        return violations
    
    def _calculate_improvement_rate(self) -> float:
        """Calculate improvement rate over last N iterations"""
        if len(self.convergence_metrics['best_score_history']) < 2:
            return 0.0
        
        recent = self.convergence_metrics['best_score_history'][-10:]  # Last 10 improvements
        if len(recent) < 2:
            return 0.0
        
        # Calculate average improvement per iteration
        total_improvement = recent[0]['score'] - recent[-1]['score']
        iterations_span = recent[-1]['iteration'] - recent[0]['iteration']
        
        return total_improvement / max(iterations_span, 1)
    
    def detect_plateau(self, tolerance: float = 1e-6, min_iterations: int = 20) -> bool:
        """Detect if optimization has plateaued"""
        if len(self.convergence_metrics['best_score_history']) < min_iterations:
            return False
        
        recent_improvements = [h['improvement'] for h in self.convergence_metrics['best_score_history'][-10:]]
        
        # Check if all recent improvements are below tolerance
        is_plateau = all(abs(imp) < tolerance for imp in recent_improvements)
        
        if is_plateau:
            self.convergence_metrics['plateau_iterations'] += 1
        else:
            self.convergence_metrics['plateau_iterations'] = 0
        
        return is_plateau
    
    def save_diagnostics(self):
        """Save all diagnostics to file"""
        diagnostics = {
            'summary': {
                'total_iterations': len(self.iteration_history),
                'total_time_seconds': (datetime.now() - self.start_time).total_seconds(),
                'best_score': min((h['score'] for h in self.iteration_history), default=None),
                'total_constraint_violations': len(self.constraint_violations),
                'plateau_detected': self.convergence_metrics['plateau_iterations'] > 10
            },
            'iteration_history': self.iteration_history,
            'constraint_violations': self.constraint_violations,
            'convergence_metrics': {
                'best_score_history': self.convergence_metrics['best_score_history'],
                'plateau_iterations': self.convergence_metrics['plateau_iterations'],
                'parameter_evolution': self._calculate_parameter_evolution()
            }
        }
        
        with open(self.log_file, 'w') as f:
            json.dump(diagnostics, f, indent=2)
    
    def _calculate_parameter_evolution(self) -> Dict[str, Any]:
        """Calculate how parameters evolved during optimization"""
        evolution = {}
        
        for param_name, values in self.convergence_metrics['parameter_variance'].items():
            if values:
                evolution[param_name] = {
                    'initial': values[0],
                    'final': values[-1],
                    'min': min(values),
                    'max': max(values),
                    'mean': np.mean(values),
                    'std': np.std(values),
                    'trend': 'increasing' if values[-1] > values[0] else 'decreasing'
                }
        
        return evolution
    
    def print_summary(self):
        """Print optimization summary"""
        print("\n" + "="*60)
        print("OPTIMIZATION DIAGNOSTICS SUMMARY")
        print("="*60)
        
        print(f"\nTotal iterations: {len(self.iteration_history)}")
        print(f"Total time: {(datetime.now() - self.start_time).total_seconds()/60:.1f} minutes")
        
        if self.iteration_history:
            best_iter = min(self.iteration_history, key=lambda x: x['score'])
            print(f"\nBest score: {best_iter['score']:.6f} (iteration {best_iter['iteration']})")
            print(f"Best parameters:")
            for param, value in best_iter['parameters'].items():
                if isinstance(value, float):
                    print(f"  {param}: {value:.4f}")
                else:
                    print(f"  {param}: {value}")
        
        print(f"\nConstraint violations: {len(self.constraint_violations)}")
        if self.constraint_violations:
            print("  Recent violations:")
            for violation in self.constraint_violations[-3:]:
                print(f"    Iteration {violation['iteration']}: {violation['violations'][0]}")
        
        if self.convergence_metrics['plateau_iterations'] > 10:
            print(f"\n⚠️  Optimization appears to have plateaued after {self.convergence_metrics['plateau_iterations']} iterations")
        
        print("\nParameter evolution:")
        evolution = self._calculate_parameter_evolution()
        for param, stats in evolution.items():
            print(f"  {param}: {stats['initial']:.4f} → {stats['final']:.4f} "
                  f"({stats['trend']}, std={stats['std']:.4f})")
            

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
                for row in train_data.itertuples(index=False):
                    # Apply season carryover at the start of a new season
                    if prev_year is not None and row.year != prev_year:
                        model.apply_season_carryover(row.year)
                    
                    # Update ratings with venue information and database connection
                    model.update_ratings(
                        row.home_team,
                        row.away_team,
                        row.hscore,
                        row.ascore,
                        row.year,
                        match_id=getattr(row, 'match_id', None),
                        round_number=getattr(row, 'round_number', None),
                        match_date=getattr(row, 'match_date', None),
                        venue=getattr(row, 'venue', None),
                        db_connection=db_connection
                    )
                    prev_year = row.year
            
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
        
        for row in test_data.itertuples(index=False):
            prob = model.calculate_win_probability(
                row.home_team, row.away_team, 
                venue=getattr(row, 'venue', None), db_connection=db_connection
            )
            predictions.append(max(min(prob, 0.999), 0.001))  # Clip probabilities
            
            if row.hscore > row.ascore:
                actuals.append(1.0)
            elif row.hscore < row.ascore:
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
        
        for row in test_data.itertuples(index=False):
            # Get ELO-based prediction
            if margin_method == 'simple':
                home_rating = model.team_ratings.get(row.home_team, model.base_rating)
                away_rating = model.team_ratings.get(row.away_team, model.base_rating)
                home_advantage = model.get_contextual_home_advantage(
                    row.home_team, row.away_team, 
                    venue=getattr(row, 'venue', None), db_connection=db_connection
                )
                rating_diff = (home_rating + home_advantage) - away_rating
                predicted_margin = rating_diff * margin_params[0]
            else:
                # Other margin methods would be implemented here
                raise NotImplementedError(f"Margin method {margin_method} not implemented")
            
            actual_margin = row.hscore - row.ascore
            
            predictions.append(predicted_margin)
            actuals.append(actual_margin)
        
        return np.mean(np.abs(np.array(predictions) - np.array(actuals)))
    
    def _evaluate_log_loss(self, model, test_data: pd.DataFrame, db_connection=None) -> float:
        """Calculate log loss for win probability predictions"""
        predictions = []
        actuals = []
        
        for row in test_data.itertuples(index=False):
            prob = model.calculate_win_probability(
                row.home_team, row.away_team, 
                venue=getattr(row, 'venue', None), db_connection=db_connection
            )
            predictions.append(max(min(prob, 0.999), 0.001))  # Clip probabilities
            
            if row.hscore > row.ascore:
                actuals.append(1.0)
            elif row.hscore < row.ascore:
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
                for row in train_data.itertuples(index=False):
                    # Apply season carryover at the start of a new season
                    if prev_year is not None and row.year != prev_year:
                        fold_model.apply_season_carryover(row.year)
                    
                    fold_model.update_ratings(
                        row.home_team, row.away_team,
                        row.hscore, row.ascore,
                        row.year, match_id=getattr(row, 'match_id', None),
                        round_number=getattr(row, 'round_number', None),
                        match_date=getattr(row, 'match_date', None),
                        venue=getattr(row, 'venue', None),
                        db_connection=db_connection
                    )
                    prev_year = row.year
            
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
        Run Bayesian optimization with enhanced diagnostics
        
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
        enable_diagnostics = kwargs.get('enable_diagnostics', True)
        
        # Multi-start optimization
        all_results = []
        overall_best_score = float('inf')
        overall_best_params = None
        overall_start_time = datetime.now()
        
        # Create diagnostics tracker
        if enable_diagnostics:
            diagnostics = OptimizationDiagnostics(
                parameter_space, 
                log_file=kwargs.get('diagnostics_file', 'optimization_diagnostics.json')
            )
        
        if verbose:
            print(f"Running Bayesian optimization with {self.n_starts} starts...")
            print(f"Each start will run {n_calls} iterations.")
            if enable_diagnostics:
                print(f"Diagnostics will be saved to: {diagnostics.log_file}\n")
        
        for start_idx in range(self.n_starts):
            if verbose and self.n_starts > 1:
                print(f"{'='*60}")
                print(f"START {start_idx + 1}/{self.n_starts} - Random seed: {42 + start_idx}")
                print(f"{'='*60}")
            
            # Progress tracking
            iteration = [0]
            start_time = datetime.now()
            best_this_start = [float('inf')]
            
            # Create objective function wrapper for progress tracking
            @use_named_args(parameter_space.dimensions)
            def objective_wrapper(**params):
                iteration[0] += 1
                
                # Convert to parameter dictionary
                param_dict = {name: params[name] for name in parameter_space.param_names}
                
                # Check constraints if diagnostics enabled
                if enable_diagnostics:
                    violations = diagnostics.check_constraints(param_dict)
                    if violations and verbose:
                        print(f"  ⚠️  Constraint violations: {', '.join(violations)}")
                
                # Evaluate
                score = objective_function(param_dict)
                
                # Track if this is best score
                is_best = False
                if score < best_this_start[0]:
                    best_this_start[0] = score
                    is_best = True
                
                # Log to diagnostics
                if enable_diagnostics:
                    diagnostics.log_iteration(iteration[0], param_dict, score, is_best)
                    
                    # Check for plateau every 20 iterations
                    if iteration[0] % 20 == 0 and diagnostics.detect_plateau():
                        if verbose:
                            print(f"  ⚠️  Optimization may have plateaued")
                
                # Progress update
                if verbose:
                    elapsed = (datetime.now() - start_time).total_seconds() / 60
                    if self.n_starts > 1:
                        print(f"Start {start_idx + 1} - Iter {iteration[0]}/{n_calls} - "
                            f"Elapsed: {elapsed:.1f}min - Current: {score:.4f} - "
                            f"Best this start: {best_this_start[0]:.4f}")
                    else:
                        print(f"Iter {iteration[0]}/{n_calls} - "
                            f"Elapsed: {elapsed:.1f}min - Current: {score:.4f} - "
                            f"Best: {best_this_start[0]:.4f}")
                    
                    # Print parameter values every 10 iterations if verbose
                    if iteration[0] % 10 == 0:
                        param_str = ", ".join([f"{k}={v:.2f}" if isinstance(v, float) else f"{k}={v}" 
                                            for k, v in param_dict.items()])
                        print(f"    Params: {param_str}")
                
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
        
        # Save and print diagnostics
        if enable_diagnostics:
            diagnostics.save_diagnostics()
            diagnostics.print_summary()
        
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
                'all_results': all_results,
                'diagnostics_file': diagnostics.log_file if enable_diagnostics else None
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

    # Run optimization with diagnostic options
    result = optimizer.optimize(
        objective, parameter_space, n_calls, 
        verbose=verbose, metric=metric, 
        enable_diagnostics=kwargs.get('enable_diagnostics', True),
        diagnostics_file=kwargs.get('diagnostics_file', f'{method}_optimization_diagnostics.json'),
        **kwargs
    )
    
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