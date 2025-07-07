import pandas as pd
import numpy as np

def compare_margin_predictions(combined_csv_path):
    """Compare margin predictions from built-in vs separate model"""
    
    # Load predictions
    df = pd.read_csv(combined_csv_path)
    
    # You'd need to also run predictions WITHOUT the margin model to compare
    # This is just a template for analysis
    
    print("Margin Model Comparison:")
    print(f"Average predicted margin: {df['predicted_margin'].mean():.1f}")
    print(f"Std dev of margins: {df['predicted_margin'].std():.1f}")
    print(f"Range: {df['predicted_margin'].min():.1f} to {df['predicted_margin'].max():.1f}")
    
if __name__ == "__main__":
    # Run after generating predictions
    compare_margin_predictions('data/elo_predictions_combined_2025_2025.csv')