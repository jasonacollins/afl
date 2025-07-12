#!/usr/bin/env python3
"""
ELO Core Module for AFL Prediction System

Contains the core ELO model implementations used across the AFL prediction system.
Provides both simple and advanced ELO models with different feature sets.
"""

import pandas as pd
import numpy as np
import json
from typing import Dict, List, Optional, Tuple
from datetime import datetime


class AFLEloModel:
    """
    Standard AFL ELO Model with margin consideration and advanced features
    
    This is the main ELO implementation used for optimization and training.
    Includes margin factors, season carryover, and comprehensive tracking.
    """
    
    def __init__(self, base_rating: int = 1500, k_factor: float = 20, 
                 home_advantage: float = 50, margin_factor: float = 0.3, 
                 season_carryover: float = 0.6, max_margin: int = 120, 
                 beta: float = 0.05):
        """
        Initialize the AFL ELO model with configurable parameters
        
        Parameters:
        -----------
        base_rating : int
            Starting ELO rating for all teams
        k_factor : float
            Determines how quickly ratings change
        home_advantage : float
            Points added to home team's rating when calculating win probability
        margin_factor : float
            How much the margin of victory affects rating changes
        season_carryover : float
            Percentage of rating retained between seasons (0.75 = 75%)
        max_margin : int
            Maximum margin to consider (to limit effect of blowouts)
        beta : float
            Scaling factor for converting win probability to predicted margin
        """
        self.base_rating = base_rating
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.margin_factor = margin_factor
        self.season_carryover = season_carryover
        self.max_margin = max_margin
        self.beta = beta
        self.team_ratings = {}
        self.yearly_ratings = {}
        self.rating_history = []
        self.predictions = []
    
    def initialize_ratings(self, teams: List[str]) -> None:
        """Initialize all team ratings to the base rating"""
        self.team_ratings = {team: self.base_rating for team in teams}
    
    def _cap_margin(self, margin: float) -> float:
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def calculate_win_probability(self, home_team: str, away_team: str) -> float:
        """Calculate probability of home team winning based on ELO difference"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def predict_margin(self, home_team: str, away_team: str) -> float:
        """
        Predict margin using the beta scaling method
        """
        win_prob = self.calculate_win_probability(home_team, away_team)
        predicted_margin = (win_prob - 0.5) / self.beta
        return predicted_margin

    def update_ratings(self, home_team: str, away_team: str, hscore: int, 
                      ascore: int, year: int, match_id: Optional[int] = None, 
                      round_number: Optional[str] = None, 
                      match_date: Optional[str] = None, 
                      venue: Optional[str] = None) -> Dict:
        """
        Update team ratings based on match result
        
        Parameters:
        -----------
        home_team : str
            Name of home team
        away_team : str
            Name of away team
        hscore : int
            Score of home team
        ascore : int
            Score of away team
        year : int
            Season year (used for tracking)
        match_id : int, optional
            Optional match ID for tracking
        round_number : str, optional
            Optional round number for tracking
        match_date : str, optional
            Optional match date for tracking
        venue : str, optional
            Optional venue for tracking
        
        Returns:
        --------
        dict
            Updated ratings and prediction information
        """
        # Ensure teams exist in ratings
        if home_team not in self.team_ratings:
            self.team_ratings[home_team] = self.base_rating
        if away_team not in self.team_ratings:
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Determine actual result (1 for home win, 0 for away win)
        actual_result = 1.0 if hscore > ascore else 0.0
        
        # Handle draws (0.5 points each)
        if hscore == ascore:
            actual_result = 0.5
        
        # Calculate rating change based on result
        margin = hscore - ascore
        capped_margin = self._cap_margin(margin)
        
        # Adjust K-factor by margin
        margin_multiplier = 1.0
        if self.margin_factor > 0:
            margin_multiplier = np.log1p(abs(capped_margin) * self.margin_factor) / np.log1p(self.max_margin * self.margin_factor)
        
        # Calculate ELO update
        rating_change = self.k_factor * margin_multiplier * (actual_result - home_win_prob)
        
        # Update ratings
        self.team_ratings[home_team] += rating_change
        self.team_ratings[away_team] -= rating_change
        
        # Store the prediction and outcome
        prediction_info = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'hscore': hscore,
            'ascore': ascore,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'rating_difference': home_rating - away_rating,
            'adjusted_rating_difference': (home_rating + self.home_advantage) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'actual_result': 'home_win' if hscore > ascore else ('away_win' if hscore < ascore else 'draw'),
            'correct': (home_win_prob > 0.5 and hscore > ascore) or (home_win_prob < 0.5 and hscore < ascore) or (home_win_prob == 0.5 and hscore == ascore),
            'margin': margin,
            'rating_change': rating_change
        }
        
        self.predictions.append(prediction_info)
        
        # Store rating history
        self.rating_history.append({
            'year': year,
            'match_id': match_id,
            'match_date': match_date,
            'home_team': home_team,
            'away_team': away_team,
            'home_rating': self.team_ratings[home_team],
            'away_rating': self.team_ratings[away_team]
        })
        
        return prediction_info
    
    def apply_season_carryover(self, new_year: int) -> None:
        """Apply regression to mean between seasons"""
        for team in self.team_ratings:
            # Regress ratings toward base rating
            self.team_ratings[team] = self.base_rating + self.season_carryover * (self.team_ratings[team] - self.base_rating)
        
        # Store ratings before the season starts
        self.yearly_ratings[f"{new_year}_start"] = self.team_ratings.copy()
    
    def save_yearly_ratings(self, year: int) -> None:
        """Save the current ratings as end-of-year ratings"""
        self.yearly_ratings[str(year)] = self.team_ratings.copy()
    
    def evaluate_model(self) -> Dict[str, float]:
        """Calculate accuracy and other metrics for model evaluation"""
        if not self.predictions:
            return {
                'accuracy': 0,
                'brier_score': 1.0,  # Worst possible Brier score
                'log_loss': float('inf')
            }
        
        y_true = [1 if p['actual_result'] == 'home_win' else (0.5 if p['actual_result'] == 'draw' else 0) for p in self.predictions]
        y_pred = [p['home_win_probability'] for p in self.predictions]
        
        # Calculate binary prediction accuracy (did we predict the winner correctly?)
        binary_predictions = [1 if prob >= 0.5 else 0 for prob in y_pred]
        accuracy = sum(1 for true, pred in zip(y_true, binary_predictions) if 
                      (true == 1 and pred == 1) or (true == 0 and pred == 0) or (true == 0.5)) / len(y_true)
        
        # Calculate Brier score (lower is better)
        brier = sum((pred - true)**2 for true, pred in zip(y_true, y_pred)) / len(y_true)

        # Calculate log loss (lower is better)
        logloss = 0
        for true, pred in zip(y_true, y_pred):
            # Clip probability to avoid log(0) issues
            p = max(min(pred, 0.999), 0.001)
            
            # Calculate loss based on actual outcome
            if true == 1.0:
                loss = -np.log(p)
            elif true == 0.0:
                loss = -np.log(1 - p)
            else:  # Draw (0.5)
                # For a draw, use proximity to 0.5 for the loss calculation
                loss = -np.log(1 - abs(0.5 - p))
            
            logloss += loss
        logloss /= len(y_true)
        
        return {
            'accuracy': accuracy,
            'brier_score': brier,
            'log_loss': logloss
        }
    
    def get_model_data(self) -> Dict:
        """Get model data for saving"""
        return {
            'parameters': {
                'base_rating': self.base_rating,
                'k_factor': self.k_factor,
                'home_advantage': self.home_advantage,
                'margin_factor': self.margin_factor,
                'season_carryover': self.season_carryover,
                'max_margin': self.max_margin,
                'beta': self.beta
            },
            'team_ratings': self.team_ratings,
            'yearly_ratings': self.yearly_ratings,
            'model_type': 'standard_elo',
            'last_updated': datetime.now().isoformat()
        }


class SimpleELO:
    """
    Simple AFL ELO rating system with proven parameters.
    
    A clean, functional ELO implementation with sensible defaults.
    No over-optimization, no complex parameter tuning - just works.
    Predicts both win probabilities and margins using a single model.
    """
    
    def __init__(self, k_factor: int = 47, home_advantage: int = 52,
                 season_carryover: float = 0.61, margin_scale: float = 0.47):
        """
        Initialize with proven default parameters.
        
        Parameters:
        -----------
        k_factor : int
            Rating change factor (default: 47, proven in AFL context)
        home_advantage : int
            Points added to home team rating (default: 52)
        season_carryover : float
            Proportion of rating carried over between seasons (default: 0.61)
        margin_scale : float
            Scale factor for margin predictions (default: 0.47)
        """
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.season_carryover = season_carryover
        self.margin_scale = margin_scale
        self.base_rating = 1500
        
        # Team ratings - initialize to base rating
        self.ratings = {}
        
        # Store match results for evaluation
        self.match_results = []
        
    def get_rating(self, team: str) -> float:
        """Get team's current rating, defaulting to base rating for new teams."""
        return self.ratings.get(team, self.base_rating)
    
    def calculate_win_probability(self, home_team: str, away_team: str) -> float:
        """
        Calculate probability of home team winning.
        
        Uses standard ELO formula: 1 / (1 + 10^(-rating_diff/400))
        """
        home_rating = self.get_rating(home_team) + self.home_advantage
        away_rating = self.get_rating(away_team)
        rating_diff = home_rating - away_rating
        
        return 1.0 / (1.0 + 10 ** (-rating_diff / 400))
    
    def predict_margin(self, home_team: str, away_team: str) -> float:
        """
        Predict winning margin for home team.
        
        Logarithmic scaling: margin = sign(rating_diff) * log1p(abs(rating_diff)) * scale
        Provides diminishing returns for larger margins rather than linear scaling.
        """
        home_rating = self.get_rating(home_team) + self.home_advantage
        away_rating = self.get_rating(away_team)
        rating_diff = home_rating - away_rating
        
        # Apply logarithmic scaling with diminishing returns
        sign = 1 if rating_diff >= 0 else -1
        log_scaled_diff = sign * np.log1p(abs(rating_diff))
        
        return log_scaled_diff * self.margin_scale
    
    def update_ratings(self, home_team: str, away_team: str, 
                      home_score: int, away_score: int) -> None:
        """
        Update team ratings based on match result.
        
        Uses standard ELO update: new_rating = old_rating + K * (result - expected)
        """
        # Get current ratings
        home_rating = self.get_rating(home_team)
        away_rating = self.get_rating(away_team)
        
        # Calculate expected win probability
        expected_prob = self.calculate_win_probability(home_team, away_team)
        
        # Determine actual result
        if home_score > away_score:
            actual_result = 1.0  # Home win
        elif home_score < away_score:
            actual_result = 0.0  # Away win
        else:
            actual_result = 0.5  # Draw
        
        # Update ratings
        rating_change = self.k_factor * (actual_result - expected_prob)
        
        self.ratings[home_team] = home_rating + rating_change
        self.ratings[away_team] = away_rating - rating_change
        
        # Store result for evaluation
        self.match_results.append({
            'home_team': home_team,
            'away_team': away_team,
            'home_score': home_score,
            'away_score': away_score,
            'predicted_prob': expected_prob,
            'actual_result': actual_result,
            'home_rating_before': home_rating,
            'away_rating_before': away_rating,
            'home_rating_after': self.ratings[home_team],
            'away_rating_after': self.ratings[away_team]
        })
    
    def apply_season_carryover(self) -> None:
        """
        Apply season carryover - regress ratings toward mean.
        
        Formula: new_rating = base_rating + carryover * (old_rating - base_rating)
        """
        for team in self.ratings:
            old_rating = self.ratings[team]
            self.ratings[team] = (
                self.base_rating + 
                self.season_carryover * (old_rating - self.base_rating)
            )
    
    def train_on_data(self, matches_df: pd.DataFrame) -> None:
        """
        Train the ELO model on historical match data.
        
        Parameters:
        -----------
        matches_df : pd.DataFrame
            DataFrame with columns: year, home_team, away_team, hscore, ascore
        """
        # Ensure data is chronologically sorted
        matches_df = matches_df.sort_values(['year', 'match_date'])
        
        # Initialize all teams
        all_teams = pd.concat([
            matches_df['home_team'], 
            matches_df['away_team']
        ]).unique()
        
        for team in all_teams:
            if team not in self.ratings:
                self.ratings[team] = self.base_rating
        
        # Process matches chronologically
        current_year = None
        for _, match in matches_df.iterrows():
            # Apply season carryover at start of new season
            if current_year is not None and match['year'] != current_year:
                self.apply_season_carryover()
            
            # Update ratings based on match result
            self.update_ratings(
                match['home_team'],
                match['away_team'], 
                match['hscore'],
                match['ascore']
            )
            
            current_year = match['year']
    
    def evaluate_performance(self) -> Dict[str, float]:
        """
        Evaluate model performance on training data.
        
        Returns:
        --------
        Dict containing accuracy, brier_score, and margin_mae
        """
        if not self.match_results:
            return {'accuracy': 0.0, 'brier_score': 1.0, 'margin_mae': 0.0}
        
        results_df = pd.DataFrame(self.match_results)
        
        # Calculate accuracy (correct tips)
        correct_tips = 0
        margin_errors = []
        
        for _, result in results_df.iterrows():
            # Accuracy check
            predicted_winner = (
                result['home_team'] if result['predicted_prob'] > 0.5 
                else result['away_team']
            )
            actual_winner = (
                result['home_team'] if result['actual_result'] == 1.0 
                else result['away_team']
            )
            
            if predicted_winner == actual_winner:
                correct_tips += 1
            
            # Margin error
            predicted_margin = self.predict_margin(
                result['home_team'], result['away_team']
            )
            actual_margin = result['home_score'] - result['away_score']
            margin_errors.append(abs(predicted_margin - actual_margin))
        
        accuracy = correct_tips / len(results_df)
        
        # Calculate Brier score
        brier_score = np.mean(
            (results_df['predicted_prob'] - results_df['actual_result']) ** 2
        )
        
        # Calculate margin MAE
        margin_mae = np.mean(margin_errors)
        
        return {
            'accuracy': accuracy,
            'brier_score': brier_score,
            'margin_mae': margin_mae,
            'total_matches': len(results_df)
        }
    
    def get_current_ratings(self) -> Dict[str, float]:
        """Get current team ratings sorted by rating."""
        return dict(sorted(self.ratings.items(), key=lambda x: x[1], reverse=True))
    
    def get_model_data(self) -> Dict:
        """Get model data for saving"""
        return {
            'parameters': {
                'k_factor': self.k_factor,
                'home_advantage': self.home_advantage,
                'season_carryover': self.season_carryover,
                'margin_scale': self.margin_scale,
                'base_rating': self.base_rating
            },
            'ratings': self.ratings,
            'model_type': 'SimpleELO',
            'last_updated': datetime.now().isoformat()
        }


def train_elo_model(data: pd.DataFrame, params: Optional[Dict] = None) -> AFLEloModel:
    """
    Train the standard ELO model on the provided data with optional parameters
    
    Parameters:
    -----------
    data : pd.DataFrame
        Historical match data
    params : dict, optional
        Optional model parameters
        
    Returns:
    --------
    AFLEloModel
        Trained ELO model
    """
    if params is None:
        model = AFLEloModel()
    else:
        model = AFLEloModel(
            base_rating=params.get('base_rating', 1500),
            k_factor=params.get('k_factor', 20),
            home_advantage=params.get('home_advantage', 50),
            margin_factor=params.get('margin_factor', 0.3),
            season_carryover=params.get('season_carryover', 0.6),
            max_margin=params.get('max_margin', 120),
            beta=params.get('beta', 0.05)
        )
    
    # Get unique teams
    all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
    
    # Initialize ratings
    model.initialize_ratings(all_teams)
    
    # Process matches chronologically
    prev_year = None
    
    for _, match in data.iterrows():
        # Apply season carryover at the start of a new season
        if prev_year is not None and match['year'] != prev_year:
            # Save ratings at the end of the previous year
            model.save_yearly_ratings(prev_year)
            # Apply carryover for the new year
            model.apply_season_carryover(match['year'])
        
        # Update ratings based on match result
        model.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            hscore=match['hscore'],
            ascore=match['ascore'],
            year=match['year'],
            match_id=match.get('match_id'),
            round_number=match.get('round_number'),
            match_date=match.get('match_date'),
            venue=match.get('venue')
        )
        
        prev_year = match['year']
    
    # Save ratings for the final year
    if prev_year:
        model.save_yearly_ratings(prev_year)
    
    return model


def create_simple_elo_model(params: Optional[Dict] = None) -> SimpleELO:
    """
    Create a SimpleELO model with optional parameters
    
    Parameters:
    -----------
    params : dict, optional
        Optional model parameters
        
    Returns:
    --------
    SimpleELO
        Simple ELO model instance
    """
    if params is None:
        return SimpleELO()
    else:
        return SimpleELO(
            k_factor=params.get('k_factor', 47),
            home_advantage=params.get('home_advantage', 52),
            season_carryover=params.get('season_carryover', 0.61),
            margin_scale=params.get('margin_scale', 0.47)
        )


class MarginEloModel:
    """
    ELO model optimized specifically for margin prediction
    
    Unlike the standard AFLEloModel which predicts win probabilities and then converts
    to margins, this model directly predicts margins from rating differences and updates
    ratings based on margin prediction accuracy.
    """
    
    def __init__(self, k_factor=35, home_advantage=40, season_carryover=0.75, 
                 margin_scale=0.15, scaling_factor=50, max_margin=100, base_rating=1500):
        """
        Initialize the margin-focused ELO model
        
        Parameters:
        -----------
        k_factor : float
            Learning rate for rating updates
        home_advantage : float
            Home advantage in rating points
        season_carryover : float
            Rating carryover between seasons (closer to 1.0 retains more)
        margin_scale : float
            How rating difference converts to predicted margin
        scaling_factor : float
            Converts margin prediction error to rating change
        max_margin : int
            Cap for blowouts to prevent extreme rating changes
        base_rating : int
            Starting rating for all teams
        """
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
        """Apply season carryover - regress ratings toward base rating"""
        for team in self.team_ratings:
            current_rating = self.team_ratings[team]
            self.team_ratings[team] = (
                self.base_rating + self.season_carryover * (current_rating - self.base_rating)
            )
    
    def get_model_data(self):
        """Get model data for saving"""
        return {
            'model_type': 'margin_elo',
            'parameters': {
                'k_factor': self.k_factor,
                'home_advantage': self.home_advantage,
                'season_carryover': self.season_carryover,
                'margin_scale': self.margin_scale,
                'scaling_factor': self.scaling_factor,
                'max_margin': self.max_margin,
                'base_rating': self.base_rating
            },
            'team_ratings': self.team_ratings.copy()
        }