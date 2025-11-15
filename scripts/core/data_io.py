#!/usr/bin/env python3
"""
Data I/O Module for AFL ELO System

Handles all database operations and file I/O for the AFL ELO prediction system.
Provides unified interface for data access across all ELO models.
"""

import pandas as pd
import sqlite3
import json
import os
from typing import Dict, List, Optional, Union
from datetime import datetime, timezone


def fetch_afl_data(db_path: str, start_year: Optional[int] = None, 
                   end_year: Optional[int] = None) -> pd.DataFrame:
    """
    Fetch historical AFL match data from SQLite database
    
    Parameters:
    -----------
    db_path : str
        Path to SQLite database
    start_year : int, optional
        Starting year for data (inclusive)
    end_year : int, optional  
        Ending year for data (inclusive)
        
    Returns:
    --------
    pd.DataFrame
        Match data with required columns for ELO training
    """
    conn = sqlite3.connect(db_path)
    
    year_clause = ""
    if start_year:
        year_clause += f"AND m.year >= {start_year} "
    if end_year:
        year_clause += f"AND m.year <= {end_year}"
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year, m.hscore, m.ascore,
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.hscore IS NOT NULL AND m.ascore IS NOT NULL
        {year_clause}
    ORDER BY 
        m.year, m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


def fetch_matches_for_prediction(db_path: str, start_year: int) -> pd.DataFrame:
    """
    Fetch AFL matches from database for prediction (including future matches)
    
    Parameters:
    -----------
    db_path : str
        Path to SQLite database
    start_year : int
        Starting year for matches
        
    Returns:
    --------
    pd.DataFrame
        All matches from start_year onwards (completed and future)
    """
    conn = sqlite3.connect(db_path)
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year, m.hscore, m.ascore, m.complete,
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.year >= {start_year}
    ORDER BY 
        m.year, m.match_date
    """
    
    matches = pd.read_sql_query(query, conn)
    conn.close()
    
    # Convert match_date to datetime for sorting
    matches['match_date'] = pd.to_datetime(matches['match_date'], errors='coerce')
    
    # Sort by date to ensure chronological order
    matches = matches.sort_values(['year', 'match_date'])
    
    return matches


def get_all_teams(db_path: str) -> List[str]:
    """
    Get all team names from the database
    
    Parameters:
    -----------
    db_path : str
        Path to SQLite database
        
    Returns:
    --------
    List[str]
        List of all team names
    """
    conn = sqlite3.connect(db_path)
    
    query = "SELECT name FROM teams ORDER BY name"
    teams_df = pd.read_sql_query(query, conn)
    conn.close()
    
    return teams_df['name'].tolist()


def save_model(model_data: Dict, filepath: str) -> None:
    """
    Save model data to JSON file
    
    Parameters:
    -----------
    model_data : dict
        Model data to save
    filepath : str
        Path to save the model file
    """
    # Ensure directory exists
    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    
    with open(filepath, 'w') as f:
        json.dump(model_data, f, indent=4)
    
    print(f"Model saved to: {filepath}")


def load_model(filepath: str) -> Dict:
    """
    Load model data from JSON file
    
    Parameters:
    -----------
    filepath : str
        Path to the model file
        
    Returns:
    --------
    dict
        Loaded model data
    """
    try:
        with open(filepath, 'r') as f:
            model_data = json.load(f)
        return model_data
    except Exception as e:
        raise ValueError(f"Failed to load model from {filepath}: {e}")


def save_predictions_to_csv(predictions: List[Dict], filename: str) -> None:
    """
    Save predictions to CSV file
    
    Parameters:
    -----------
    predictions : List[Dict]
        List of prediction dictionaries
    filename : str
        Output filename
    """
    if not predictions:
        print("No predictions to save")
        return
    
    df = pd.DataFrame(predictions)
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
    
    df.to_csv(filename, index=False)
    print(f"Saved {len(df)} predictions to {filename}")


def save_predictions_to_database(predictions: List[Dict], db_path: str, 
                                predictor_id: int = 6, verbose: bool = False, 
                                override_completed: bool = False) -> None:
    """
    Save predictions directly to the database
    
    Parameters:
    -----------
    predictions : List[Dict]
        List of prediction dictionaries
    db_path : str
        Path to SQLite database
    predictor_id : int
        Predictor ID for database storage (default: 6 for ELO)
    verbose : bool
        Whether to print detailed skipping messages (default: False)
    override_completed : bool
        Whether to override predictions for completed/started matches (default: False)
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Get current time in UTC for comparison
        current_time = datetime.now(timezone.utc)
        
        # Filter out completed games and games that have started (unless override is enabled)
        future_predictions = []
        for p in predictions:
            # If override is enabled, include all predictions
            if override_completed:
                future_predictions.append(p)
                continue
            
            # Skip if game is completed (has actual_result)
            if 'actual_result' in p:
                continue
            
            # Skip if game has started (match_date is in the past)
            if p.get('match_date'):
                try:
                    # Parse match date - handle both ISO format and simple date format
                    match_date_str = p['match_date']
                    if 'T' in match_date_str:
                        # ISO format with time - handle various timezone formats
                        if match_date_str.endswith('Z'):
                            match_date = datetime.fromisoformat(match_date_str.replace('Z', '+00:00'))
                        elif '+' in match_date_str or match_date_str.count('-') > 2:
                            match_date = datetime.fromisoformat(match_date_str)
                        else:
                            # No timezone info, assume UTC
                            match_date = datetime.fromisoformat(match_date_str + '+00:00')
                    else:
                        # Simple date format - assume UTC and add a default time
                        match_date = datetime.fromisoformat(match_date_str + 'T00:00:00+00:00')
                    
                    # Only include games that haven't started yet
                    if match_date > current_time:
                        future_predictions.append(p)
                    else:
                        if verbose:
                            print(f"Skipping match {p.get('match_id', 'unknown')} - game has started ({match_date_str})")
                except (ValueError, TypeError) as e:
                    if verbose:
                        print(f"Warning: Could not parse match date '{match_date_str}' for match {p.get('match_id', 'unknown')}, including prediction")
                    future_predictions.append(p)
            else:
                # No match date available - include the prediction with warning
                if verbose:
                    print(f"Warning: No match date for match {p.get('match_id', 'unknown')}, including prediction")
                future_predictions.append(p)
        
        if not future_predictions:
            if override_completed:
                print("No predictions to save")
            else:
                print("No future match predictions to save (all games completed or started)")
            return
        
        # Show summary of skipped matches if not verbose
        skipped_count = len(predictions) - len(future_predictions)
        if not verbose and skipped_count > 0 and not override_completed:
            print(f"Skipped {skipped_count} completed/started matches")
        
        if override_completed:
            print(f"Saving {len(future_predictions)} predictions to database for predictor {predictor_id} (override mode - including completed matches)")
        else:
            print(f"Saving {len(future_predictions)} predictions to database for predictor {predictor_id}")
        
        # Begin transaction
        cursor.execute("BEGIN TRANSACTION")
        
        # Delete existing ELO predictions for these matches
        match_ids = [p['match_id'] for p in future_predictions]
        placeholders = ','.join(['?' for _ in match_ids])
        cursor.execute(
            f"DELETE FROM predictions WHERE predictor_id = ? AND match_id IN ({placeholders})",
            [predictor_id] + match_ids
        )
        deleted_count = cursor.rowcount
        print(f"Deleted {deleted_count} existing ELO predictions")
        
        # Insert new predictions
        insert_count = 0
        for pred in future_predictions:
            # Convert probability to percentage (0-100)
            home_prob_pct = int(round(pred['home_win_probability'] * 100))
            
            # Determine tipped team
            if home_prob_pct >= 50:
                tipped_team = 'home'
            else:
                tipped_team = 'away'
            
            # Handle exact 50% predictions - default to home
            if home_prob_pct == 50:
                tipped_team = 'home'
            
            margin_value = round(pred.get('predicted_margin', 0), 1)
            
            cursor.execute(
                """INSERT INTO predictions 
                   (match_id, predictor_id, home_win_probability, predicted_margin, tipped_team) 
                   VALUES (?, ?, ?, ?, ?)""",
                (pred['match_id'], 
                 predictor_id, 
                 home_prob_pct,
                 margin_value,
                 tipped_team)
            )
            insert_count += 1
        
        # Commit transaction
        cursor.execute("COMMIT")
        print(f"Successfully saved {insert_count} predictions to database")
        
    except Exception as e:
        cursor.execute("ROLLBACK")
        print(f"Error saving predictions to database: {e}")
        raise
    finally:
        conn.close()


def save_optimization_results(results: Dict, filepath: str) -> None:
    """
    Save optimization results to JSON file
    
    Parameters:
    -----------
    results : dict
        Optimization results
    filepath : str
        Path to save results
    """
    # Convert numpy arrays to lists for JSON serialization
    json_safe_results = {}
    
    for key, value in results.items():
        if key == 'all_results' and isinstance(value, list):
            json_safe_results[key] = [
                {
                    'params': result['params'],
                    'log_loss': float(result['log_loss']) if 'log_loss' in result else float(result.get('score', 0)),
                    'cv_scores': [float(score) for score in result.get('cv_scores', [])]
                }
                for result in value
            ]
        elif hasattr(value, 'item'):  # NumPy scalar
            json_safe_results[key] = value.item()
        elif isinstance(value, (int, float)):
            json_safe_results[key] = float(value)
        else:
            json_safe_results[key] = value
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    
    with open(filepath, 'w') as f:
        json.dump(json_safe_results, f, indent=4)
    
    print(f"Optimization results saved to: {filepath}")


def load_parameters(filepath: str) -> Dict:
    """
    Load model parameters from JSON file
    
    Parameters:
    -----------
    filepath : str
        Path to parameters file
        
    Returns:
    --------
    dict
        Model parameters
    """
    try:
        with open(filepath, 'r') as f:
            params_data = json.load(f)
        
        # Handle both old format and new format
        if 'parameters' in params_data:
            return params_data['parameters']
        else:
            return params_data
            
    except Exception as e:
        raise ValueError(f"Failed to load parameters from {filepath}: {e}")


def create_summary_file(model, performance: Dict, filepath: str, 
                       training_params: Dict) -> None:
    """
    Create a training summary file
    
    Parameters:
    -----------
    model : ELO model object
        Trained ELO model
    performance : dict
        Performance metrics
    filepath : str
        Path to save summary
    training_params : dict
        Training parameters used
    """
    # Ensure directory exists
    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    
    with open(filepath, 'w') as f:
        f.write(f"AFL ELO Model Training Summary\n")
        f.write(f"============================\n\n")
        f.write(f"Training Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Database: {training_params.get('db_path', 'Unknown')}\n")
        f.write(f"Training Period: {training_params.get('start_year', 'Unknown')}-{training_params.get('end_year', 'Unknown')}\n\n")
        
        f.write(f"Performance Metrics:\n")
        f.write(f"  Matches: {performance.get('total_matches', 0)}\n")
        f.write(f"  Accuracy: {performance.get('accuracy', 0):.3f}\n")
        f.write(f"  Brier Score: {performance.get('brier_score', 0):.4f}\n")
        if 'margin_mae' in performance:
            f.write(f"  Margin MAE: {performance['margin_mae']:.1f} points\n")
        f.write(f"\n")
        
        f.write(f"Model Parameters:\n")
        if hasattr(model, 'k_factor'):
            f.write(f"  K-Factor: {model.k_factor}\n")
            f.write(f"  Home Advantage: {model.home_advantage}\n")
            f.write(f"  Season Carryover: {model.season_carryover}\n")
            if hasattr(model, 'margin_factor'):
                f.write(f"  Margin Factor: {model.margin_factor}\n")
            if hasattr(model, 'margin_scale'):
                f.write(f"  Margin Scale: {model.margin_scale}\n")
        f.write(f"\n")
        
        f.write(f"Current Ratings:\n")
        if hasattr(model, 'get_current_ratings'):
            ratings = model.get_current_ratings()
        elif hasattr(model, 'team_ratings'):
            ratings = dict(sorted(model.team_ratings.items(), key=lambda x: x[1], reverse=True))
        else:
            ratings = {}
            
        for team, rating in ratings.items():
            f.write(f"  {team}: {rating:.0f}\n")
    
    print(f"Training summary saved to: {filepath}")
