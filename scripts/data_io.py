#!/usr/bin/env python3
"""
Data I/O module for AFL ELO optimization and training.

Handles all database operations, file I/O, and data processing functions
extracted from the monolithic optimizer files.
"""

import pandas as pd
import sqlite3
import json
import numpy as np
from typing import Optional, Dict, Any, Tuple, List
from datetime import datetime


def fetch_afl_data(db_path: str, start_year: Optional[int] = None, end_year: Optional[int] = None) -> pd.DataFrame:
    """
    Fetch historical AFL match data from SQLite database
    
    Parameters:
    -----------
    db_path : str
        Path to SQLite database
    start_year : int, optional
        Optional starting year for data. If provided, only games from this year onward are fetched.
    end_year : int, optional
        Optional ending year for data. If provided, only games up to this year are fetched.
        
    Returns:
    --------
    pd.DataFrame
        DataFrame with match data columns:
        ['match_id', 'match_number', 'round_number', 'match_date', 'venue', 'year', 
         'hscore', 'ascore', 'home_team', 'away_team']
    """
    conn = sqlite3.connect(db_path)
    try:
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
        return df
    finally:
        conn.close()


def get_team_states(db_path: str) -> Dict[str, str]:
    """
    Fetch team state mappings from the database.
    
    Parameters:
    -----------
    db_path : str
        Path to the SQLite database
    
    Returns:
    --------
    Dict[str, str]
        Dictionary mapping team names to state abbreviations
    """
    conn = sqlite3.connect(db_path)
    try:
        query = "SELECT name, state FROM teams"
        df = pd.read_sql_query(query, conn)
        return dict(zip(df['name'], df['state']))
    finally:
        conn.close()


def get_database_connection(db_path: str) -> sqlite3.Connection:
    """
    Get a database connection for venue state lookups.
    
    Parameters:
    -----------
    db_path : str
        Path to the SQLite database
    
    Returns:
    --------
    sqlite3.Connection
        Database connection object
    """
    return sqlite3.connect(db_path)


def load_parameters(params_file: str) -> Dict[str, Any]:
    """
    Load ELO parameters from JSON file.
    
    Parameters:
    -----------
    params_file : str
        Path to JSON file containing parameters
    
    Returns:
    --------
    Dict[str, Any]
        Dictionary containing parameters
    """
    with open(params_file, 'r') as f:
        data = json.load(f)
    
    # Handle both nested and flat parameter structures
    if 'parameters' in data:
        return data['parameters']
    else:
        return data


def save_elo_parameters(params: Dict[str, Any], output_path: str, 
                       optimization_result: Any = None) -> None:
    """
    Save ELO parameters to JSON file.
    
    Parameters:
    -----------
    params : Dict[str, Any]
        Dictionary of parameters to save
    output_path : str
        Path to save the JSON file
    optimization_result : Any, optional
        Optimization result object containing metrics
    """
    # Convert NumPy types to native Python types for JSON serialization
    json_safe_params = {}
    for key, value in params.items():
        if hasattr(value, 'item'):  # NumPy scalar
            json_safe_params[key] = value.item()
        else:
            json_safe_params[key] = float(value) if isinstance(value, (int, float)) else value
    
    output_data = {
        'parameters': json_safe_params,
        'optimization_method': 'bayesian'
    }
    
    if optimization_result is not None:
        output_data.update({
            'log_loss': float(optimization_result.best_score),
            'n_iterations': optimization_result.total_iterations,
        })
    
    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=4)


def save_margin_parameters(best_method: str, best_params: Dict[str, Any], 
                          best_score: float, all_results: Dict[str, Any],
                          output_path: str) -> None:
    """
    Save margin prediction parameters to JSON file.
    
    Parameters:
    -----------
    best_method : str
        Name of the best margin prediction method
    best_params : Dict[str, Any]
        Best parameters for the method
    best_score : float
        Best MAE score achieved
    all_results : Dict[str, Any]
        Results from all tested methods
    output_path : str
        Path to save the JSON file
    """
    margin_data = {
        'best_method': best_method,
        'parameters': best_params,
        'margin_mae': best_score,
        'optimization_method': 'bayesian_margin',
        'all_methods': {
            method: {
                'mae': result['score'],
                'parameters': result['params']
            }
            for method, result in all_results.items()
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(margin_data, f, indent=4)


def save_convergence_plot(optimization_result: Any, output_path: str = 'elo_optimization_convergence.png') -> bool:
    """
    Save optimization convergence plot.
    
    Parameters:
    -----------
    optimization_result : Any
        Optimization result object from scikit-optimize
    output_path : str
        Path to save the plot image
    
    Returns:
    --------
    bool
        True if plot was saved successfully, False otherwise
    """
    try:
        from skopt.plots import plot_convergence
        import matplotlib.pyplot as plt
        
        plot_convergence(optimization_result)
        plt.title('Bayesian Optimization Convergence')
        plt.tight_layout()
        plt.savefig(output_path)
        plt.close()  # Close the plot to free memory
        return True
    except ImportError:
        return False


def prepare_walkforward_splits(matches_df: pd.DataFrame) -> List[Tuple[List[int], int]]:
    """
    Prepare walk-forward validation splits.
    
    Parameters:
    -----------
    matches_df : pd.DataFrame
        DataFrame containing match data
    
    Returns:
    --------
    List[Tuple[List[int], int]]
        List of (train_seasons, test_season) tuples
    """
    # Ensure chronological order
    matches_df = matches_df.sort_values(['year', 'match_date'])
    
    seasons = sorted(matches_df['year'].unique())
    if len(seasons) < 2:
        return []  # Not enough data for walk-forward
    
    splits = []
    for i in range(len(seasons) - 1):
        train_seasons = seasons[:i + 1]
        test_season = seasons[i + 1]
        splits.append((train_seasons, test_season))
    
    return splits


def get_unique_teams(matches_df: pd.DataFrame) -> np.ndarray:
    """
    Get all unique teams from match data.
    
    Parameters:
    -----------
    matches_df : pd.DataFrame
        DataFrame containing match data
    
    Returns:
    --------
    np.ndarray
        Array of unique team names
    """
    return pd.concat([matches_df['home_team'], matches_df['away_team']]).unique()


def filter_matches_by_seasons(matches_df: pd.DataFrame, seasons: List[int]) -> pd.DataFrame:
    """
    Filter matches by list of seasons.
    
    Parameters:
    -----------
    matches_df : pd.DataFrame
        DataFrame containing match data
    seasons : List[int]
        List of seasons to include
    
    Returns:
    --------
    pd.DataFrame
        Filtered DataFrame
    """
    return matches_df[matches_df['year'].isin(seasons)]


def filter_matches_by_season(matches_df: pd.DataFrame, season: int) -> pd.DataFrame:
    """
    Filter matches by single season.
    
    Parameters:
    -----------
    matches_df : pd.DataFrame
        DataFrame containing match data
    season : int
        Season to filter by
    
    Returns:
    --------
    pd.DataFrame
        Filtered DataFrame
    """
    return matches_df[matches_df['year'] == season]


def ensure_chronological_order(matches_df: pd.DataFrame) -> pd.DataFrame:
    """
    Ensure matches are in chronological order.
    
    Parameters:
    -----------
    matches_df : pd.DataFrame
        DataFrame containing match data
    
    Returns:
    --------
    pd.DataFrame
        DataFrame sorted by year and match_date
    """
    return matches_df.sort_values(['year', 'match_date'])


def validate_database_path(db_path: str) -> bool:
    """
    Validate that database path exists and is accessible.
    
    Parameters:
    -----------
    db_path : str
        Path to the SQLite database
    
    Returns:
    --------
    bool
        True if database is accessible, False otherwise
    """
    try:
        conn = sqlite3.connect(db_path)
        conn.close()
        return True
    except sqlite3.Error:
        return False


def validate_parameters_file(params_file: str) -> bool:
    """
    Validate that parameters file exists and contains valid JSON.
    
    Parameters:
    -----------
    params_file : str
        Path to the parameters JSON file
    
    Returns:
    --------
    bool
        True if file is valid, False otherwise
    """
    try:
        with open(params_file, 'r') as f:
            json.load(f)
        return True
    except (json.JSONDecodeError, FileNotFoundError):
        return False