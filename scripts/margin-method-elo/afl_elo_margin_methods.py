"""
AFL ELO Margin Methods

This module provides various margin calculation methods that build on the standard ELO approach.
These methods take standard ELO ratings and convert them to margin predictions using different techniques.
"""

import numpy as np
import pandas as pd
import sqlite3
import json
import argparse


class ELOMarginMethods:
    """
    Collection of margin calculation methods that build on standard ELO ratings
    """
    
    def __init__(self, home_advantage=35):
        """
        Initialize margin methods
        
        Parameters:
        -----------
        home_advantage: float
            Rating boost for home teams
        """
        self.home_advantage = home_advantage
    
    def builtin_elo_margin(self, home_rating, away_rating, beta=0.04):
        """
        Built-in ELO margin calculation using win probability
        
        Parameters:
        -----------
        home_rating: float
            Home team ELO rating
        away_rating: float
            Away team ELO rating
        beta: float
            Beta parameter for margin conversion
            
        Returns:
        --------
        float: Predicted margin
        """
        # Calculate win probability
        rating_diff = (home_rating + self.home_advantage) - away_rating
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        # Convert to margin
        margin = (win_probability - 0.5) / beta
        return margin
    
    def simple_scaling_margin(self, home_rating, away_rating, scale_factor=0.125):
        """
        Simple scaling: margin = rating_diff * scale_factor
        
        Parameters:
        -----------
        home_rating: float
            Home team ELO rating
        away_rating: float
            Away team ELO rating
        scale_factor: float
            Scale factor to convert rating difference to margin
            
        Returns:
        --------
        float: Predicted margin
        """
        rating_diff = (home_rating + self.home_advantage) - away_rating
        margin = rating_diff * scale_factor
        return margin
    
    def linear_regression_margin(self, home_rating, away_rating, slope=0.1, intercept=0.0):
        """
        Linear regression: margin = rating_diff * slope + intercept
        
        Parameters:
        -----------
        home_rating: float
            Home team ELO rating
        away_rating: float
            Away team ELO rating
        slope: float
            Slope parameter from linear regression
        intercept: float
            Intercept parameter from linear regression
            
        Returns:
        --------
        float: Predicted margin
        """
        rating_diff = (home_rating + self.home_advantage) - away_rating
        margin = rating_diff * slope + intercept
        return margin
    
    def diminishing_returns_margin(self, home_rating, away_rating, beta=0.04):
        """
        Diminishing returns: margin = (win_prob - 0.5) / beta
        Similar to built-in but with potentially different beta parameter
        
        Parameters:
        -----------
        home_rating: float
            Home team ELO rating
        away_rating: float
            Away team ELO rating
        beta: float
            Beta parameter for diminishing returns
            
        Returns:
        --------
        float: Predicted margin
        """
        # Calculate win probability
        rating_diff = (home_rating + self.home_advantage) - away_rating
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        # Convert to margin with diminishing returns
        margin = (win_probability - 0.5) / beta
        return margin
    
    def power_scaling_margin(self, home_rating, away_rating, scale_factor=0.125, power=1.0):
        """
        Power scaling: margin = sign(rating_diff) * |rating_diff|^power * scale_factor
        
        Parameters:
        -----------
        home_rating: float
            Home team ELO rating
        away_rating: float
            Away team ELO rating
        scale_factor: float
            Scale factor to convert rating difference to margin
        power: float
            Power to apply to rating difference (1.0 = linear, <1.0 = diminishing, >1.0 = increasing)
            
        Returns:
        --------
        float: Predicted margin
        """
        rating_diff = (home_rating + self.home_advantage) - away_rating
        margin = np.sign(rating_diff) * (abs(rating_diff) ** power) * scale_factor
        return margin
    
    def predict_all_margins(self, home_rating, away_rating, params=None):
        """
        Calculate margin predictions using all available methods
        
        Parameters:
        -----------
        home_rating: float
            Home team ELO rating
        away_rating: float
            Away team ELO rating
        params: dict, optional
            Parameters for each method. If None, uses defaults.
            
        Returns:
        --------
        dict: All margin predictions with method names as keys
        """
        if params is None:
            params = {
                'builtin_elo': {'beta': 0.04},
                'simple_scaling': {'scale_factor': 0.125},
                'linear_regression': {'slope': 0.1, 'intercept': 0.0},
                'diminishing_returns': {'beta': 0.04},
                'power_scaling': {'scale_factor': 0.125, 'power': 1.0}
            }
        
        margin_predictions = {}
        
        # Built-in ELO margin
        margin_predictions['builtin_elo'] = self.builtin_elo_margin(
            home_rating, away_rating, **params.get('builtin_elo', {})
        )
        
        # Simple scaling
        margin_predictions['simple_scaling'] = self.simple_scaling_margin(
            home_rating, away_rating, **params.get('simple_scaling', {})
        )
        
        # Linear regression
        margin_predictions['linear_regression'] = self.linear_regression_margin(
            home_rating, away_rating, **params.get('linear_regression', {})
        )
        
        # Diminishing returns
        margin_predictions['diminishing_returns'] = self.diminishing_returns_margin(
            home_rating, away_rating, **params.get('diminishing_returns', {})
        )
        
        # Power scaling
        margin_predictions['power_scaling'] = self.power_scaling_margin(
            home_rating, away_rating, **params.get('power_scaling', {})
        )
        
        return margin_predictions


def predict_margin_simple(rating_diff, scale_factor):
    """Simple linear scaling method"""
    return rating_diff * scale_factor


def predict_margin_diminishing_returns(win_prob, beta):
    """Diminishing returns method"""
    return (win_prob - 0.5) / beta


def predict_margin_linear(rating_diff, slope, intercept):
    """Linear regression method"""
    return rating_diff * slope + intercept


def evaluate_margin_method_walkforward(params, method, elo_params, matches_df, verbose=False):
    """
    Evaluate margin prediction parameters using walk-forward validation
    Returns Mean Absolute Error (lower is better)
    """
    from afl_elo_train_standard import AFLEloModel
    
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
                match_id=match.get('id'),
                round_number=match.get('round'),
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
        if len(predicted_margins) > 0:
            split_mae = np.mean([abs(p - a) for p, a in zip(predicted_margins, actual_margins)])
            all_errors.extend([abs(p - a) for p, a in zip(predicted_margins, actual_margins)])
            if verbose:
                print(f"  Season {test_season}: MAE = {split_mae:.2f} ({len(predicted_margins)} matches)")
    
    if len(all_errors) == 0:
        return np.inf
    
    mae = np.mean(all_errors)
    return mae


def optimize_margin_method_parameters(elo_params, matches_df, n_calls=50, verbose=True):
    """
    Optimize margin prediction parameters for all methods
    Returns the best method and its parameters
    """
    from optimise import get_margin_parameter_spaces, BayesianOptimizer, WalkForwardEvaluator
    from elo_core import AFLEloModel
    
    # Get margin parameter spaces
    margin_spaces = get_margin_parameter_spaces()
    
    best_method = None
    best_params = None
    best_score = float('inf')
    all_results = {}
    
    print("Testing margin prediction methods...")
    
    for method_name, parameter_space in margin_spaces.items():
        print(f"\n{'='*50}")
        print(f"OPTIMIZING: {method_name.upper().replace('_', ' ')} METHOD")
        print(f"{'='*50}")
        
        # Create a specialized evaluator for margin methods
        evaluator = WalkForwardEvaluator(metric='mae')
        
        # Create objective function that includes the margin method and ELO params
        def create_margin_objective(method, elo_parameters):
            def objective(margin_params):
                return evaluator.evaluate(
                    AFLEloModel, elo_parameters, matches_df, None,
                    margin_method=method, margin_params=list(margin_params.values())
                )
            return objective
        
        objective = create_margin_objective(method_name, elo_params)
        
        # Run optimization for this method
        optimizer = BayesianOptimizer(n_starts=1)
        result = optimizer.optimize(objective, parameter_space, n_calls, verbose=verbose)
        
        all_results[method_name] = {
            'score': float(result.best_score),
            'params': {k: float(v) if isinstance(v, (int, float)) else v for k, v in result.best_params.items()},
            'iterations': int(result.total_iterations),
            'method': result.method
        }
        
        print(f"\n{method_name.upper().replace('_', ' ')} RESULTS:")
        print(f"  Best MAE: {result.best_score:.2f}")
        print("  Best parameters:")
        for key, value in result.best_params.items():
            print(f"    {key}: {value:.4f}")
        
        if result.best_score < best_score:
            best_score = result.best_score
            best_method = method_name
            best_params = all_results[method_name]['params']
    
    print(f"\n{'='*60}")
    print("MARGIN OPTIMIZATION COMPLETE")
    print(f"{'='*60}")
    print(f"Best method: {best_method.upper().replace('_', ' ')}")
    print(f"Best MAE: {best_score:.2f}")
    print("Best parameters:")
    for key, value in best_params.items():
        print(f"  {key}: {value:.4f}")
    
    return best_method, best_params, best_score, all_results


def evaluate_margin_methods(matches_df, elo_ratings, methods_params=None):
    """
    Evaluate all margin methods on historical data
    
    Parameters:
    -----------
    matches_df: DataFrame
        Historical match data with actual margins
    elo_ratings: dict
        ELO ratings for teams at each point in time
    methods_params: dict, optional
        Parameters for each method
        
    Returns:
    --------
    dict: Evaluation metrics (MAE, RMSE) for each method
    """
    margin_methods = ELOMarginMethods()
    
    if methods_params is None:
        methods_params = {
            'builtin_elo': {'beta': 0.04},
            'simple_scaling': {'scale_factor': 0.125},
            'linear_regression': {'slope': 0.1, 'intercept': 0.0},
            'diminishing_returns': {'beta': 0.04},
            'power_scaling': {'scale_factor': 0.125, 'power': 1.0}
        }
    
    results = {}
    
    for method_name in methods_params.keys():
        errors = []
        
        for idx, match in matches_df.iterrows():
            # Get ratings for this match (this would need actual implementation)
            home_rating = elo_ratings.get(match['home_team'], 1500)
            away_rating = elo_ratings.get(match['away_team'], 1500)
            
            # Get prediction using specific method
            if method_name == 'builtin_elo':
                predicted_margin = margin_methods.builtin_elo_margin(
                    home_rating, away_rating, **methods_params[method_name]
                )
            elif method_name == 'simple_scaling':
                predicted_margin = margin_methods.simple_scaling_margin(
                    home_rating, away_rating, **methods_params[method_name]
                )
            elif method_name == 'linear_regression':
                predicted_margin = margin_methods.linear_regression_margin(
                    home_rating, away_rating, **methods_params[method_name]
                )
            elif method_name == 'diminishing_returns':
                predicted_margin = margin_methods.diminishing_returns_margin(
                    home_rating, away_rating, **methods_params[method_name]
                )
            elif method_name == 'power_scaling':
                predicted_margin = margin_methods.power_scaling_margin(
                    home_rating, away_rating, **methods_params[method_name]
                )
            else:
                continue
            
            # Calculate error
            actual_margin = match['margin']
            error = abs(predicted_margin - actual_margin)
            errors.append(error)
        
        # Calculate metrics
        mae = np.mean(errors)
        rmse = np.sqrt(np.mean([e**2 for e in errors]))
        
        results[method_name] = {
            'mae': mae,
            'rmse': rmse,
            'total_matches': len(errors)
        }
    
    return results


# Data loading moved to data_io module


def main():
    """Main function for margin method optimization"""
    from data_io import fetch_afl_data, load_parameters
    
    parser = argparse.ArgumentParser(description='Optimize AFL ELO margin prediction methods')
    parser.add_argument('--elo-params', type=str, required=True,
                        help='Path to standard ELO parameters JSON file')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to database (default: data/afl_predictions.db)')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for training data (default: 1990)')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for training data (default: 2024)')
    parser.add_argument('--n-calls', type=int, default=50,
                        help='Number of optimization calls per method (default: 50)')
    parser.add_argument('--output-path', type=str, default='data/optimal_margin_methods.json',
                        help='Output path for optimized parameters')
    
    args = parser.parse_args()
    
    # Load ELO parameters
    elo_params = load_parameters(args.elo_params)
    
    print("Loaded ELO parameters:")
    for key, value in elo_params.items():
        print(f"  {key}: {value}")
    
    # Load match data
    print(f"\nLoading match data from {args.start_year} to {args.end_year}...")
    matches_df = fetch_afl_data(args.db_path, args.start_year, args.end_year)
    print(f"Loaded {len(matches_df)} matches")
    
    # Optimize margin methods
    best_method, best_params, best_score, all_results = optimize_margin_method_parameters(
        elo_params, matches_df, args.n_calls
    )
    
    # Save results
    output_data = {
        'best_method': best_method,
        'best_params': {k: float(v) if isinstance(v, (int, float)) else v for k, v in best_params.items()},
        'best_score': float(best_score),
        'all_methods': all_results,
        'elo_params_used': elo_params
    }
    
    with open(args.output_path, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\nResults saved to {args.output_path}")


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        # Command line mode
        main()
    else:
        # Example usage
        margin_methods = ELOMarginMethods()
        
        # Example ratings
        home_rating = 1600
        away_rating = 1500
        
        # Get all margin predictions
        all_margins = margin_methods.predict_all_margins(home_rating, away_rating)
        
        print("Margin predictions for Home(1600) vs Away(1500):")
        for method, margin in all_margins.items():
            print(f"  {method}: {margin:.2f}")