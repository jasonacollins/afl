"""
AFL Prediction Scoring Functions

This module provides scoring functions for evaluating AFL predictions,
including BITS, Brier, and accuracy calculations.

Based on the JavaScript scoring service but implemented in Python.
"""

import math
import numpy as np


def calculate_bits_score(predicted_probability, actual_outcome):
    """
    Calculate BITS score: higher is better
    
    Parameters:
    -----------
    predicted_probability : float
        Predicted probability (0-100 percentage or 0-1 probability)
    actual_outcome : float
        Actual outcome (1 for home win, 0 for away win, 0.5 for draw)
    
    Returns:
    --------
    float: BITS score (higher is better)
    """
    # Convert percentage to probability if needed
    if predicted_probability > 1:
        probability = predicted_probability / 100
    else:
        probability = predicted_probability
    
    # Avoid log(0) by setting minimum probability bounds
    safe_prob = max(0.001, min(0.999, probability))
    
    if actual_outcome == 1:
        # Home team won
        return 1 + math.log2(safe_prob)
    elif actual_outcome == 0:
        # Away team won
        return 1 + math.log2(1 - safe_prob)
    else:
        # Draw (actual_outcome = 0.5)
        # Use proximity to 0.5 as the measure
        return 1 + math.log2(1 - abs(0.5 - safe_prob))


def calculate_brier_score(predicted_probability, actual_outcome):
    """
    Calculate Brier score: lower is better (0-1 range)
    
    Parameters:
    -----------
    predicted_probability : float
        Predicted probability (0-100 percentage or 0-1 probability)
    actual_outcome : float
        Actual outcome (1 for home win, 0 for away win, 0.5 for draw)
    
    Returns:
    --------
    float: Brier score (lower is better)
    """
    # Convert percentage to probability if needed
    if predicted_probability > 1:
        probability = predicted_probability / 100
    else:
        probability = predicted_probability
    
    # Brier score is (forecast - outcome)^2
    return (probability - actual_outcome) ** 2


def calculate_accuracy(predicted_probability, actual_outcome, threshold=0.5):
    """
    Calculate prediction accuracy (binary correctness)
    
    Parameters:
    -----------
    predicted_probability : float
        Predicted probability (0-100 percentage or 0-1 probability)
    actual_outcome : float
        Actual outcome (1 for home win, 0 for away win, 0.5 for draw)
    threshold : float
        Probability threshold for classification (default: 0.5)
    
    Returns:
    --------
    bool: True if prediction was correct, False otherwise
    """
    # Convert percentage to probability if needed
    if predicted_probability > 1:
        probability = predicted_probability / 100
    else:
        probability = predicted_probability
    
    # Handle draws
    if actual_outcome == 0.5:
        # For draws, we consider predictions close to 50% as correct
        return abs(probability - 0.5) <= 0.1  # Within 10% of 50%
    
    # Standard binary classification
    predicted_home_win = probability > threshold
    actual_home_win = actual_outcome == 1
    
    return predicted_home_win == actual_home_win


def calculate_tip_points(predicted_probability, home_score, away_score, tipped_team='home'):
    """
    Calculate binary tip correctness using the same semantics as the JS scoring service.

    Parameters:
    -----------
    predicted_probability : float
        Predicted home-win probability as a percentage (0-100) or fraction (0-1)
    home_score : float
        Actual home team score
    away_score : float
        Actual away team score
    tipped_team : str
        Explicit tipped side used when the prediction is exactly 50%

    Returns:
    --------
    int: 1 when the tip is correct, otherwise 0
    """
    if predicted_probability <= 1:
        predicted_probability = predicted_probability * 100

    home_won = home_score > away_score
    away_won = home_score < away_score
    tie = home_score == away_score

    if predicted_probability == 50:
        if tie:
            return 0
        return 1 if ((home_won and tipped_team == 'home') or (away_won and tipped_team == 'away')) else 0

    if tie:
        return 0

    return 1 if ((home_won and predicted_probability > 50) or (away_won and predicted_probability < 50)) else 0


def evaluate_predictions(predictions, probability_key='home_win_probability', 
                        actual_result_key='actual_result', per_game=False):
    """
    Evaluate a list of predictions using multiple scoring metrics
    
    Parameters:
    -----------
    predictions : list
        List of prediction dictionaries
    probability_key : str
        Key name for predicted probability in each prediction dict
    actual_result_key : str
        Key name for actual result in each prediction dict
    per_game : bool
        If True, return per-game scores instead of aggregated
    
    Returns:
    --------
    dict: Evaluation metrics including BITS, Brier, and accuracy
    """
    if not predictions:
        return {
            'total_predictions': 0,
            'bits_score_total': 0.0,
            'bits_score_per_game': 0.0,
            'brier_score_total': 0.0,
            'brier_score_per_game': 0.0,
            'accuracy': 0.0,
            'correct_predictions': 0
        }
    
    bits_scores = []
    brier_scores = []
    accuracies = []
    
    for pred in predictions:
        if probability_key not in pred or actual_result_key not in pred:
            continue
            
        predicted_prob = pred[probability_key]
        
        # Convert actual result string to numeric
        actual_result = pred[actual_result_key]
        if isinstance(actual_result, str):
            if actual_result == 'home_win':
                actual_outcome = 1.0
            elif actual_result == 'away_win':
                actual_outcome = 0.0
            elif actual_result == 'draw':
                actual_outcome = 0.5
            else:
                continue  # Skip invalid results
        else:
            actual_outcome = actual_result
        
        # Calculate scores
        bits_score = calculate_bits_score(predicted_prob, actual_outcome)
        brier_score = calculate_brier_score(predicted_prob, actual_outcome)
        accuracy = calculate_accuracy(predicted_prob, actual_outcome)
        
        bits_scores.append(bits_score)
        brier_scores.append(brier_score)
        accuracies.append(1.0 if accuracy else 0.0)
    
    if not bits_scores:
        return {
            'total_predictions': 0,
            'bits_score_total': 0.0,
            'bits_score_per_game': 0.0,
            'brier_score_total': 0.0,
            'brier_score_per_game': 0.0,
            'accuracy': 0.0,
            'correct_predictions': 0
        }
    
    if per_game:
        return {
            'total_predictions': len(bits_scores),
            'bits_scores': bits_scores,
            'brier_scores': brier_scores,
            'accuracies': accuracies
        }
    
    # Aggregated metrics
    total_predictions = len(bits_scores)
    bits_total = sum(bits_scores)
    brier_total = sum(brier_scores)
    correct_count = sum(accuracies)
    
    return {
        'total_predictions': total_predictions,
        'bits_score_total': bits_total,
        'bits_score_per_game': bits_total / total_predictions,
        'brier_score_total': brier_total,
        'brier_score_per_game': brier_total / total_predictions,
        'accuracy': correct_count / total_predictions,
        'correct_predictions': int(correct_count)
    }


def format_scoring_summary(evaluation_results):
    """
    Format evaluation results into a readable summary string
    
    Parameters:
    -----------
    evaluation_results : dict
        Results from evaluate_predictions()
    
    Returns:
    --------
    str: Formatted summary string
    """
    if evaluation_results['total_predictions'] == 0:
        return "No predictions to evaluate"
    
    summary = []
    summary.append(f"Prediction Performance on {evaluation_results['total_predictions']} matches:")
    summary.append(f"  Accuracy: {evaluation_results['accuracy']:.4f} ({evaluation_results['correct_predictions']}/{evaluation_results['total_predictions']})")
    summary.append(f"  Brier Score: {evaluation_results['brier_score_per_game']:.4f} (lower is better)")
    summary.append(f"  BITS Score: {evaluation_results['bits_score_per_game']:.4f} per game (higher is better)")
    summary.append(f"  BITS Score: {evaluation_results['bits_score_total']:.2f} total")
    
    return "\n".join(summary)
