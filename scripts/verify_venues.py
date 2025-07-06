#!/usr/bin/env python3
"""
Verify that all venues in the CSV actually exist in the matches table
"""

import sqlite3
import pandas as pd
import argparse

def verify_venues(db_path, csv_path):
    """Verify venues in CSV exist in matches table"""
    
    # Load CSV venues
    venues_df = pd.read_csv(csv_path)
    csv_venues = set(venues_df['venue'].values)
    
    # Connect to database and get actual venues
    conn = sqlite3.connect(db_path)
    
    # Query actual venues from matches table
    query = """
    SELECT DISTINCT venue, COUNT(*) as actual_count
    FROM matches 
    WHERE venue IS NOT NULL AND venue != ''
    GROUP BY venue
    ORDER BY actual_count DESC
    """
    
    actual_venues_df = pd.read_sql_query(query, conn)
    actual_venues = set(actual_venues_df['venue'].values)
    
    # Find discrepancies
    csv_only = csv_venues - actual_venues
    actual_only = actual_venues - csv_venues
    
    print(f"CSV venues: {len(csv_venues)}")
    print(f"Actual venues in database: {len(actual_venues)}")
    print(f"Matching venues: {len(csv_venues & actual_venues)}")
    
    if csv_only:
        print(f"\nVenues in CSV but NOT in database ({len(csv_only)}):")
        for venue in sorted(csv_only):
            print(f"  - {venue}")
    
    if actual_only:
        print(f"\nVenues in database but NOT in CSV ({len(actual_only)}):")
        for venue in sorted(actual_only):
            print(f"  - {venue}")
    
    # Verify counts match
    print(f"\nVerifying match counts:")
    mismatches = []
    for _, row in venues_df.iterrows():
        venue = row['venue']
        csv_count = row['match_count']
        
        actual_row = actual_venues_df[actual_venues_df['venue'] == venue]
        if len(actual_row) > 0:
            actual_count = actual_row.iloc[0]['actual_count']
            if csv_count != actual_count:
                mismatches.append({
                    'venue': venue,
                    'csv_count': csv_count,
                    'actual_count': actual_count
                })
    
    if mismatches:
        print(f"\nCount mismatches ({len(mismatches)}):")
        for mismatch in mismatches:
            print(f"  {mismatch['venue']}: CSV={mismatch['csv_count']}, DB={mismatch['actual_count']}")
    else:
        print("\n✅ All venue counts match!")
    
    conn.close()
    
    return len(csv_only) == 0 and len(actual_only) == 0 and len(mismatches) == 0

def main():
    parser = argparse.ArgumentParser(description='Verify venues CSV matches database')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to SQLite database')
    parser.add_argument('--csv-path', type=str, default='data/venues.csv',
                        help='Path to venues CSV')
    
    args = parser.parse_args()
    
    is_perfect = verify_venues(args.db_path, args.csv_path)
    
    if is_perfect:
        print("\n🎉 Perfect match! CSV is accurate.")
    else:
        print("\n⚠️  Discrepancies found.")

if __name__ == '__main__':
    main()