#!/usr/bin/env python3
"""
Analyze venue duplicates and suggest consolidation approach
"""

import pandas as pd
import sqlite3
import argparse

def analyze_duplicates(csv_path, db_path):
    """Analyze venue duplicates and suggest consolidation"""
    
    venues_df = pd.read_csv(csv_path)
    
    # Group venues by location (city + state) to identify duplicates
    location_groups = venues_df.groupby(['city', 'state']).agg({
        'venue': list,
        'match_count': list,
        'first_year': 'min',
        'last_year': 'max',
        'capacity': 'max'  # Use max capacity (modern capacity)
    }).reset_index()
    
    # Find locations with multiple venue names
    duplicates = location_groups[location_groups['venue'].apply(len) > 1]
    
    print(f"Found {len(duplicates)} locations with multiple venue names:")
    print("=" * 80)
    
    consolidation_rules = []
    
    for _, row in duplicates.iterrows():
        city, state = row['city'], row['state']
        venue_names = row['venue']
        match_counts = row['match_count']
        
        # Create venue info list
        venue_info = []
        for i, name in enumerate(venue_names):
            venue_info.append({
                'name': name,
                'count': match_counts[i],
                'years': f"{venues_df[venues_df['venue'] == name]['first_year'].iloc[0]}-{venues_df[venues_df['venue'] == name]['last_year'].iloc[0]}"
            })
        
        # Sort by match count (descending) to identify primary venue
        venue_info.sort(key=lambda x: x['count'], reverse=True)
        
        print(f"\n{city}, {state}:")
        primary_venue = venue_info[0]['name']
        total_matches = sum(v['count'] for v in venue_info)
        
        for i, venue in enumerate(venue_info):
            marker = "🏟️  PRIMARY" if i == 0 else "   alias"
            print(f"  {marker}: {venue['name']} ({venue['count']} matches, {venue['years']})")
        
        print(f"  Total matches: {total_matches}")
        
        # Create consolidation rule
        aliases = [v['name'] for v in venue_info[1:]]
        consolidation_rules.append({
            'primary_venue': primary_venue,
            'aliases': aliases,
            'location': f"{city}, {state}",
            'total_matches': total_matches
        })
    
    # Suggest consolidation approach
    print("\n" + "=" * 80)
    print("CONSOLIDATION RECOMMENDATIONS:")
    print("=" * 80)
    
    print("\nOption 1: DATABASE NORMALIZATION (Recommended)")
    print("- Create 'venues' table with unique venue_id")
    print("- Create 'venue_aliases' table to map old names to venue_id")
    print("- Update matches table to use venue_id instead of venue names")
    print("- Preserve historical data while enabling consistent queries")
    
    print("\nOption 2: DATA PREPROCESSING")
    print("- Update matches table to standardize venue names")
    print("- Replace all aliases with primary venue name")
    print("- Simpler but loses historical naming context")
    
    print("\nSuggested Schema:")
    print("""
    CREATE TABLE venues (
        venue_id INTEGER PRIMARY KEY,
        primary_name TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        capacity INTEGER,
        surface TEXT,
        opened_year INTEGER,
        closed_year INTEGER
    );
    
    CREATE TABLE venue_aliases (
        alias_id INTEGER PRIMARY KEY,
        venue_id INTEGER REFERENCES venues(venue_id),
        alias_name TEXT NOT NULL,
        used_from_year INTEGER,
        used_to_year INTEGER
    );
    """)
    
    # Generate consolidation script
    print("\nConsolidation mapping:")
    for rule in consolidation_rules:
        print(f"\n-- {rule['location']} ({rule['total_matches']} total matches)")
        print(f"Primary: {rule['primary_venue']}")
        for alias in rule['aliases']:
            print(f"  -> {alias}")
    
    return consolidation_rules

def main():
    parser = argparse.ArgumentParser(description='Analyze venue duplicates')
    parser.add_argument('--csv-path', type=str, default='data/venues.csv',
                        help='Path to venues CSV')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to SQLite database')
    
    args = parser.parse_args()
    
    consolidation_rules = analyze_duplicates(args.csv_path, args.db_path)
    
    print(f"\nSummary: {len(consolidation_rules)} venue consolidations needed")

if __name__ == '__main__':
    main()