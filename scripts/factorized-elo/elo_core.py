#!/usr/bin/env python3
"""
AFL ELO Core Module

Consolidated ELO rating system implementation with all core logic.
Eliminates code duplication across multiple files.
"""

import pandas as pd
import numpy as np
import sqlite3
import json
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from data_io import get_team_states


class AFLEloModel:
    """
    AFL ELO rating system with interstate home advantage and margin-based updates.
    
    This is the canonical implementation consolidating all ELO logic from multiple files.
    """
    
    def __init__(self, base_rating: int = 1500, k_factor: int = 20, 
                 default_home_advantage: int = 30, interstate_home_advantage: int = 60,
                 margin_factor: float = 0.3, season_carryover: float = 0.6,
                 max_margin: int = 120, beta: float = 0.05):
        """
        Initialize the AFL ELO model with configurable parameters.
        
        Parameters:
        -----------
        base_rating : int
            Starting ELO rating for all teams (default: 1500)
        k_factor : int
            Determines how quickly ratings change (default: 20)
        default_home_advantage : int
            Points added to home team's rating when playing same-state team (default: 30)
        interstate_home_advantage : int
            Points added to home team's rating when playing interstate team (default: 60)
        margin_factor : float
            Factor for incorporating margin of victory (default: 0.3)
        season_carryover : float
            Proportion of rating that carries over between seasons (default: 0.6)
        max_margin : int
            Maximum margin considered for rating updates (default: 120)
        beta : float
            Additional scaling factor for rating calculations (default: 0.05)
        """
        self.base_rating = base_rating
        self.k_factor = k_factor
        self.default_home_advantage = default_home_advantage
        self.interstate_home_advantage = interstate_home_advantage
        self.margin_factor = margin_factor
        self.season_carryover = season_carryover
        self.max_margin = max_margin
        self.beta = beta
        
        # Track team ratings and history
        self.team_ratings = {}
        self.team_states = {}
        self.predictions = []
        self.rating_history = []
        
    def initialize_ratings(self, teams: List[str], db_path: Optional[str] = None) -> None:
        """
        Initialize all teams with base rating and load team states.
        
        Parameters:
        -----------
        teams : List[str]
            List of team names
        db_path : str, optional
            Path to database for loading team states
        """
        for team in teams:
            self.team_ratings[team] = self.base_rating
            
        # Load team states from database if available
        if db_path:
            try:
                self.team_states = get_team_states(db_path)
            except Exception as e:
                print(f"Warning: Could not load team states from database: {e}")
                self.team_states = {}
        else:
            self.team_states = {}
    
    def get_venue_state(self, venue: str, db_connection: Optional[sqlite3.Connection] = None) -> Optional[str]:
        """
        Get the state/territory for a given venue.
        
        Parameters:
        -----------
        venue : str
            Name of the venue
        db_connection : sqlite3.Connection, optional
            Database connection for venue lookup
            
        Returns:
        --------
        str or None
            State abbreviation for the venue, or None if not found
        """
        if not db_connection or not venue:
            return None
            
        try:
            cursor = db_connection.cursor()
            
            # First try exact match on venue name
            cursor.execute("SELECT state FROM venues WHERE name = ?", (venue,))
            result = cursor.fetchone()
            if result:
                return result[0]
            
            # Try case-insensitive match on venue name
            cursor.execute("SELECT state FROM venues WHERE LOWER(name) = LOWER(?)", (venue,))
            result = cursor.fetchone()
            if result:
                return result[0]
                
            # Try venue aliases
            cursor.execute("""
                SELECT v.state 
                FROM venue_aliases va 
                JOIN venues v ON va.venue_id = v.venue_id 
                WHERE va.alias_name = ?
            """, (venue,))
            result = cursor.fetchone()
            if result:
                return result[0]
                
            # Try case-insensitive match on venue aliases
            cursor.execute("""
                SELECT v.state 
                FROM venue_aliases va 
                JOIN venues v ON va.venue_id = v.venue_id 
                WHERE LOWER(va.alias_name) = LOWER(?)
            """, (venue,))
            result = cursor.fetchone()
            if result:
                return result[0]
                
            return None
            
        except Exception:
            return None
    
    def get_contextual_home_advantage(self, home_team: str, away_team: str, 
                                    venue: str = None, db_connection: Optional[sqlite3.Connection] = None) -> int:
        """
        Calculate contextual home advantage based on interstate logic.
        
        Parameters:
        -----------
        home_team : str
            Name of home team
        away_team : str
            Name of away team
        venue : str, optional
            Name of venue
        db_connection : sqlite3.Connection, optional
            Database connection for venue lookup
            
        Returns:
        --------
        int
            Home advantage points to add to home team rating
        """
        # If we don't have team states, use default home advantage
        if not self.team_states:
            return self.default_home_advantage
            
        away_team_state = self.team_states.get(away_team)
        home_team_state = self.team_states.get(home_team)
        
        # Try to get venue state from database
        venue_state = self.get_venue_state(venue, db_connection) if venue else None
        
        # If venue state not found, fall back to home team state with warning
        if venue and not venue_state:
            print(f"Warning: Venue '{venue}' not found in database, falling back to home team state ({home_team_state})")
            venue_state = home_team_state
        elif not venue_state:
            venue_state = home_team_state
        
        # If away team is from different state than venue, use interstate advantage
        if away_team_state and venue_state and away_team_state != venue_state:
            return self.interstate_home_advantage
        else:
            return self.default_home_advantage
    
    def calculate_win_probability(self, home_team: str, away_team: str, 
                                venue: str = None, db_connection: Optional[sqlite3.Connection] = None) -> float:
        """
        Calculate the probability of home team winning.
        
        Parameters:
        -----------
        home_team : str
            Name of home team
        away_team : str
            Name of away team
        venue : str, optional
            Name of venue
        db_connection : sqlite3.Connection, optional
            Database connection for venue lookup
            
        Returns:
        --------
        float
            Probability of home team winning (0.0 to 1.0)
        """
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply contextual home advantage
        home_advantage = self.get_contextual_home_advantage(home_team, away_team, venue, db_connection)
        
        # Calculate rating difference
        rating_diff = (home_rating + home_advantage) - away_rating
        
        # Convert to probability using ELO formula
        return 1.0 / (1.0 + 10 ** (-rating_diff / 400))
    
    def _cap_margin(self, margin: int) -> int:
        """
        Cap margin at maximum value while preserving sign.
        
        Parameters:
        -----------
        margin : int
            Actual margin of victory
            
        Returns:
        --------
        int
            Capped margin
        """
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def update_ratings(self, home_team: str, away_team: str, home_score: int, away_score: int,
                      year: int, match_id: Optional[int] = None, round_number: Optional[int] = None,
                      match_date: Optional[str] = None, venue: Optional[str] = None,
                      db_connection: Optional[sqlite3.Connection] = None) -> None:
        """
        Update team ratings based on match result.
        
        Parameters:
        -----------
        home_team : str
            Name of home team
        away_team : str
            Name of away team
        home_score : int
            Home team score
        away_score : int
            Away team score
        year : int
            Year of the match
        match_id : int, optional
            Match ID for tracking
        round_number : int, optional
            Round number
        match_date : str, optional
            Match date
        venue : str, optional
            Venue name
        db_connection : sqlite3.Connection, optional
            Database connection for venue lookup
        """
        # Get current ratings
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Calculate predicted win probability
        predicted_prob = self.calculate_win_probability(home_team, away_team, venue, db_connection)
        
        # Determine actual result
        margin = home_score - away_score
        capped_margin = self._cap_margin(margin)
        
        if margin > 0:
            actual_result = 1.0  # Home win
        elif margin < 0:
            actual_result = 0.0  # Away win
        else:
            actual_result = 0.5  # Draw
        
        # Calculate rating change with margin factor
        base_change = self.k_factor * (actual_result - predicted_prob)
        margin_adjustment = self.margin_factor * capped_margin / 100
        
        home_change = base_change + margin_adjustment
        away_change = -base_change - margin_adjustment
        
        # Update ratings
        self.team_ratings[home_team] = home_rating + home_change
        self.team_ratings[away_team] = away_rating + away_change
        
        # Store prediction for evaluation
        self.predictions.append({
            'match_id': match_id,
            'year': year,
            'round': round_number,
            'match_date': match_date,
            'venue': venue,
            'home_team': home_team,
            'away_team': away_team,
            'home_score': home_score,
            'away_score': away_score,
            'predicted_prob': predicted_prob,
            'actual_result': actual_result,
            'margin': margin,
            'home_rating_before': home_rating,
            'away_rating_before': away_rating,
            'home_rating_after': self.team_ratings[home_team],
            'away_rating_after': self.team_ratings[away_team]
        })
        
        # Store rating history
        self.rating_history.append({
            'match_id': match_id,
            'year': year,
            'round': round_number,
            'match_date': match_date,
            'home_team': home_team,
            'away_team': away_team,
            'home_rating': self.team_ratings[home_team],
            'away_rating': self.team_ratings[away_team]
        })
    
    def apply_season_carryover(self, new_year: int) -> None:
        """
        Apply season carryover to all team ratings.
        
        Parameters:
        -----------
        new_year : int
            The new season year
        """
        for team in self.team_ratings:
            old_rating = self.team_ratings[team]
            new_rating = self.base_rating + self.season_carryover * (old_rating - self.base_rating)
            self.team_ratings[team] = new_rating
    
    def evaluate_model(self) -> Dict[str, float]:
        """
        Evaluate model performance on stored predictions.
        
        Returns:
        --------
        Dict[str, float]
            Dictionary containing accuracy, Brier score, and log loss
        """
        if not self.predictions:
            return {'accuracy': 0.0, 'brier_score': 1.0, 'log_loss': np.inf}
        
        predictions_df = pd.DataFrame(self.predictions)
        
        # Calculate accuracy (correct tips)
        correct_tips = 0
        for _, pred in predictions_df.iterrows():
            predicted_winner = pred['home_team'] if pred['predicted_prob'] > 0.5 else pred['away_team']
            actual_winner = pred['home_team'] if pred['actual_result'] == 1.0 else pred['away_team']
            if predicted_winner == actual_winner:
                correct_tips += 1
        
        accuracy = correct_tips / len(predictions_df)
        
        # Calculate Brier score
        brier_score = np.mean((predictions_df['predicted_prob'] - predictions_df['actual_result']) ** 2)
        
        # Calculate log loss
        probs = predictions_df['predicted_prob'].values
        probs = np.clip(probs, 1e-15, 1 - 1e-15)  # Avoid log(0)
        results = predictions_df['actual_result'].values
        
        log_loss = -np.mean(results * np.log(probs) + (1 - results) * np.log(1 - probs))
        
        return {
            'accuracy': accuracy,
            'brier_score': brier_score,
            'log_loss': log_loss
        }
    
    def get_current_ratings(self) -> Dict[str, float]:
        """
        Get current team ratings.
        
        Returns:
        --------
        Dict[str, float]
            Dictionary of team names to current ratings
        """
        return self.team_ratings.copy()
    
    def get_predictions_dataframe(self) -> pd.DataFrame:
        """
        Get predictions as a pandas DataFrame.
        
        Returns:
        --------
        pd.DataFrame
            DataFrame containing all predictions and metadata
        """
        return pd.DataFrame(self.predictions)
    
    def get_rating_history_dataframe(self) -> pd.DataFrame:
        """
        Get rating history as a pandas DataFrame.
        
        Returns:
        --------
        pd.DataFrame
            DataFrame containing rating history
        """
        return pd.DataFrame(self.rating_history)
    
    def save_model(self, filepath: str) -> None:
        """
        Save model parameters and current ratings to JSON file.
        
        Parameters:
        -----------
        filepath : str
            Path to save the model
        """
        model_data = {
            'parameters': {
                'base_rating': self.base_rating,
                'k_factor': self.k_factor,
                'default_home_advantage': self.default_home_advantage,
                'interstate_home_advantage': self.interstate_home_advantage,
                'margin_factor': self.margin_factor,
                'season_carryover': self.season_carryover,
                'max_margin': self.max_margin,
                'beta': self.beta
            },
            'team_ratings': self.team_ratings,
            'team_states': self.team_states,
            'model_type': 'AFL_ELO_Standard'
        }
        
        with open(filepath, 'w') as f:
            json.dump(model_data, f, indent=4)
    
    def load_model(self, filepath: str) -> None:
        """
        Load model parameters and ratings from JSON file.
        
        Parameters:
        -----------
        filepath : str
            Path to load the model from
        """
        with open(filepath, 'r') as f:
            model_data = json.load(f)
        
        # Load parameters
        params = model_data.get('parameters', {})
        self.base_rating = params.get('base_rating', 1500)
        self.k_factor = params.get('k_factor', 20)
        self.default_home_advantage = params.get('default_home_advantage', 30)
        self.interstate_home_advantage = params.get('interstate_home_advantage', 60)
        self.margin_factor = params.get('margin_factor', 0.3)
        self.season_carryover = params.get('season_carryover', 0.6)
        self.max_margin = params.get('max_margin', 120)
        self.beta = params.get('beta', 0.05)
        
        # Load ratings and states
        self.team_ratings = model_data.get('team_ratings', {})
        self.team_states = model_data.get('team_states', {})
    
    def save_predictions_to_csv(self, filepath: str) -> None:
        """
        Save predictions to CSV file.
        
        Parameters:
        -----------
        filepath : str
            Path to save predictions CSV
        """
        if self.predictions:
            predictions_df = pd.DataFrame(self.predictions)
            predictions_df.to_csv(filepath, index=False)
    
    def save_rating_history_to_csv(self, filepath: str) -> None:
        """
        Save rating history to CSV file.
        
        Parameters:
        -----------
        filepath : str
            Path to save rating history CSV
        """
        if self.rating_history:
            history_df = pd.DataFrame(self.rating_history)
            history_df.to_csv(filepath, index=False)


# Utility functions for common ELO operations
def calculate_elo_win_probability(rating1: float, rating2: float, home_advantage: float = 0) -> float:
    """
    Calculate win probability using ELO formula.
    
    Parameters:
    -----------
    rating1 : float
        Rating of first team/player
    rating2 : float
        Rating of second team/player
    home_advantage : float, optional
        Home advantage points to add to rating1
        
    Returns:
    --------
    float
        Probability of first team/player winning
    """
    rating_diff = (rating1 + home_advantage) - rating2
    return 1.0 / (1.0 + 10 ** (-rating_diff / 400))


def update_elo_ratings(rating1: float, rating2: float, result: float, k_factor: float = 20) -> Tuple[float, float]:
    """
    Update ELO ratings based on match result.
    
    Parameters:
    -----------
    rating1 : float
        Current rating of first team/player
    rating2 : float
        Current rating of second team/player
    result : float
        Match result (1.0 = first team wins, 0.0 = second team wins, 0.5 = draw)
    k_factor : float, optional
        K-factor for rating updates (default: 20)
        
    Returns:
    --------
    Tuple[float, float]
        Updated ratings (rating1_new, rating2_new)
    """
    expected_score = calculate_elo_win_probability(rating1, rating2)
    
    rating1_new = rating1 + k_factor * (result - expected_score)
    rating2_new = rating2 + k_factor * ((1 - result) - (1 - expected_score))
    
    return rating1_new, rating2_new


def apply_seasonal_regression(ratings: Dict[str, float], base_rating: float = 1500, 
                            carryover: float = 0.6) -> Dict[str, float]:
    """
    Apply seasonal regression to a dictionary of ratings.
    
    Parameters:
    -----------
    ratings : Dict[str, float]
        Dictionary of team/player names to ratings
    base_rating : float, optional
        Base rating to regress towards (default: 1500)
    carryover : float, optional
        Proportion of rating that carries over (default: 0.6)
        
    Returns:
    --------
    Dict[str, float]
        Dictionary of regressed ratings
    """
    regressed_ratings = {}
    for team, rating in ratings.items():
        regressed_ratings[team] = base_rating + carryover * (rating - base_rating)
    return regressed_ratings