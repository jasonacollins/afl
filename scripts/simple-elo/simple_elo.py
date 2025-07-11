#!/usr/bin/env python3
"""
Simple AFL ELO Model

A clean, functional ELO implementation with sensible defaults.
No over-optimization, no complex parameter tuning - just works.
"""

import pandas as pd
import numpy as np
import sqlite3
import json
from typing import Dict, List, Optional, Tuple
from datetime import datetime


class SimpleELO:
    """
    Simple AFL ELO rating system with proven parameters.
    
    Predicts both win probabilities and margins using a single model.
    """
    
    def __init__(self, k_factor: int = 32, home_advantage: int = 30,
                 season_carryover: float = 0.75, margin_scale: float = 0.2):
        """
        Initialize with proven default parameters.
        
        Parameters:
        -----------
        k_factor : int
            Rating change factor (default: 32, proven in chess/sports)
        home_advantage : int
            Points added to home team rating (default: 30)
        season_carryover : float
            Proportion of rating carried over between seasons (default: 0.75)
        margin_scale : float
            Scale factor for margin predictions (default: 0.2)
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
        
        Simple linear relationship: margin = rating_diff * scale
        """
        home_rating = self.get_rating(home_team) + self.home_advantage
        away_rating = self.get_rating(away_team)
        rating_diff = home_rating - away_rating
        
        return rating_diff * self.margin_scale
    
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
    
    def save_model(self, filepath: str) -> None:
        """Save model state to JSON file."""
        model_data = {
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
        
        with open(filepath, 'w') as f:
            json.dump(model_data, f, indent=2)
    
    def load_model(self, filepath: str) -> None:
        """Load model state from JSON file."""
        with open(filepath, 'r') as f:
            model_data = json.load(f)
        
        # Load parameters
        params = model_data.get('parameters', {})
        self.k_factor = params.get('k_factor', 32)
        self.home_advantage = params.get('home_advantage', 30)
        self.season_carryover = params.get('season_carryover', 0.75)
        self.margin_scale = params.get('margin_scale', 0.2)
        self.base_rating = params.get('base_rating', 1500)
        
        # Load ratings
        self.ratings = model_data.get('ratings', {})


def load_afl_data(db_path: str, start_year: int = None, end_year: int = None) -> pd.DataFrame:
    """
    Load AFL match data from database.
    
    Parameters:
    -----------
    db_path : str
        Path to SQLite database
    start_year : int, optional
        Start year for data (inclusive)
    end_year : int, optional
        End year for data (inclusive)
    
    Returns:
    --------
    pd.DataFrame
        Match data with required columns
    """
    conn = sqlite3.connect(db_path)
    
    year_filter = ""
    if start_year:
        year_filter += f" AND m.year >= {start_year}"
    if end_year:
        year_filter += f" AND m.year <= {end_year}"
    
    query = f"""
    SELECT 
        m.match_id, m.year, m.match_date, m.round_number,
        m.venue, m.hscore, m.ascore,
        ht.name as home_team, at.name as away_team
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL
    {year_filter}
    ORDER BY m.year, m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


def get_all_matches_for_year(db_path: str, year: int = 2025) -> pd.DataFrame:
    """
    Get all matches for a specific year (both completed and upcoming).
    
    Parameters:
    -----------
    db_path : str
        Path to SQLite database
    year : int
        Year to get matches for
    
    Returns:
    --------
    pd.DataFrame
        All matches for the year
    """
    conn = sqlite3.connect(db_path)
    
    query = f"""
    SELECT 
        m.match_id, m.year, m.match_date, m.round_number,
        m.venue, m.hscore, m.ascore,
        ht.name as home_team, at.name as away_team
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE m.year = {year}
    ORDER BY m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


if __name__ == "__main__":
    # Example usage
    print("Simple AFL ELO Model")
    print("===================")
    
    # Load some test data
    db_path = "data/afl_predictions.db"
    
    try:
        # Load historical data
        print("Loading historical data...")
        historical_data = load_afl_data(db_path, start_year=2020, end_year=2024)
        print(f"Loaded {len(historical_data)} matches")
        
        # Create and train model
        print("Training ELO model...")
        elo = SimpleELO()
        elo.train_on_data(historical_data)
        
        # Evaluate performance
        print("Evaluating performance...")
        performance = elo.evaluate_performance()
        print(f"Accuracy: {performance['accuracy']:.3f}")
        print(f"Brier Score: {performance['brier_score']:.3f}")
        print(f"Margin MAE: {performance['margin_mae']:.1f}")
        
        # Show current ratings
        print("\nCurrent Ratings:")
        ratings = elo.get_current_ratings()
        for team, rating in list(ratings.items())[:5]:
            print(f"{team}: {rating:.0f}")
        
        # Example prediction
        print("\nExample prediction:")
        prob = elo.calculate_win_probability("Richmond", "Collingwood")
        margin = elo.predict_margin("Richmond", "Collingwood")
        print(f"Richmond vs Collingwood: {prob:.3f} win probability, {margin:.1f} margin")
        
    except Exception as e:
        print(f"Error: {e}")
        print("Make sure the database path is correct and contains match data.")