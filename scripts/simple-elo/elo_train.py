#!/usr/bin/env python3
"""
Simple ELO Model Training Script

Trains the AFL ELO model on historical data and saves the trained model.
"""

import argparse
import os
from datetime import datetime
from simple_elo import SimpleELO, load_afl_data


def main():
    parser = argparse.ArgumentParser(description='Train Simple AFL ELO Model')
    parser.add_argument('--db-path', default='../data/afl_predictions.db',
                       help='Path to SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                       help='Start year for training data')
    parser.add_argument('--end-year', type=int, default=2024,
                       help='End year for training data')
    parser.add_argument('--output-dir', default='data',
                       help='Directory to save trained model')
    parser.add_argument('--model-name', default='simple_elo_model.json',
                       help='Name of the saved model file')
    
    args = parser.parse_args()
    
    print("Simple AFL ELO Model Training")
    print("============================")
    print(f"Database: {args.db_path}")
    print(f"Training years: {args.start_year}-{args.end_year}")
    print(f"Output directory: {args.output_dir}")
    print()
    
    # Load historical data
    print("Loading historical data...")
    try:
        historical_data = load_afl_data(args.db_path, args.start_year, args.end_year)
        print(f"Loaded {len(historical_data)} matches from {args.start_year}-{args.end_year}")
    except Exception as e:
        print(f"Error loading data: {e}")
        return 1
    
    # Create and train model
    print("Training ELO model...")
    elo = SimpleELO()
    elo.train_on_data(historical_data)
    
    # Evaluate performance
    print("Evaluating model performance...")
    performance = elo.evaluate_performance()
    
    print(f"Training complete!")
    print(f"  Matches processed: {performance['total_matches']}")
    print(f"  Accuracy: {performance['accuracy']:.3f}")
    print(f"  Brier Score: {performance['brier_score']:.4f}")
    print(f"  Margin MAE: {performance['margin_mae']:.1f} points")
    
    # Display current ratings
    print("\nTop 10 Current Ratings:")
    print("-" * 30)
    ratings = elo.get_current_ratings()
    for i, (team, rating) in enumerate(list(ratings.items())[:10], 1):
        print(f"{i:2d}. {team:<20} {rating:.0f}")
    
    # Save model
    os.makedirs(args.output_dir, exist_ok=True)
    model_path = os.path.join(args.output_dir, args.model_name)
    
    print(f"\nSaving model to: {model_path}")
    elo.save_model(model_path)
    
    # Create a summary file
    summary_path = os.path.join(args.output_dir, 'training_summary.txt')
    with open(summary_path, 'w') as f:
        f.write(f"Simple AFL ELO Model Training Summary\n")
        f.write(f"====================================\n\n")
        f.write(f"Training Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Database: {args.db_path}\n")
        f.write(f"Training Period: {args.start_year}-{args.end_year}\n")
        f.write(f"Model File: {args.model_name}\n\n")
        f.write(f"Performance Metrics:\n")
        f.write(f"  Matches: {performance['total_matches']}\n")
        f.write(f"  Accuracy: {performance['accuracy']:.3f}\n")
        f.write(f"  Brier Score: {performance['brier_score']:.4f}\n")
        f.write(f"  Margin MAE: {performance['margin_mae']:.1f} points\n\n")
        f.write(f"Model Parameters:\n")
        f.write(f"  K-Factor: {elo.k_factor}\n")
        f.write(f"  Home Advantage: {elo.home_advantage}\n")
        f.write(f"  Season Carryover: {elo.season_carryover}\n")
        f.write(f"  Margin Scale: {elo.margin_scale}\n\n")
        f.write(f"Current Ratings:\n")
        for team, rating in ratings.items():
            f.write(f"  {team}: {rating:.0f}\n")
    
    print(f"Training summary saved to: {summary_path}")
    print("\nTraining completed successfully!")
    
    return 0


if __name__ == "__main__":
    exit(main())