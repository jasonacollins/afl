#!/usr/bin/env python3
"""
Extract unique venues from the matches table and create a CSV with venue details
for setting up the venues table.
"""

import sqlite3
import pandas as pd
import argparse

def extract_venues(db_path, output_path):
    """Extract unique venues from matches table and create CSV template"""
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    
    # Query unique venues with match counts
    query = """
    SELECT 
        venue,
        COUNT(*) as match_count,
        MIN(year) as first_year,
        MAX(year) as last_year
    FROM matches 
    WHERE venue IS NOT NULL AND venue != ''
    GROUP BY venue
    ORDER BY match_count DESC
    """
    
    venues_df = pd.read_sql_query(query, conn)
    conn.close()
    
    print(f"Found {len(venues_df)} unique venues")
    
    # Create venue mapping with known AFL venues
    venue_mapping = {
        # Major AFL venues (full names)
        'Melbourne Cricket Ground': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 100024},
        'Marvel Stadium': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 53359},
        'Adelaide Oval': {'city': 'Adelaide', 'state': 'SA', 'capacity': 53583},
        'Optus Stadium': {'city': 'Perth', 'state': 'WA', 'capacity': 60000},
        'The Gabba': {'city': 'Brisbane', 'state': 'QLD', 'capacity': 42000},
        'Sydney Cricket Ground': {'city': 'Sydney', 'state': 'NSW', 'capacity': 48000},
        'Accor Stadium': {'city': 'Sydney', 'state': 'NSW', 'capacity': 83500},
        'GMHBA Stadium': {'city': 'Geelong', 'state': 'VIC', 'capacity': 36000},
        'Metricon Stadium': {'city': 'Gold Coast', 'state': 'QLD', 'capacity': 25000},
        'Manuka Oval': {'city': 'Canberra', 'state': 'ACT', 'capacity': 13550},
        'Blundstone Arena': {'city': 'Hobart', 'state': 'TAS', 'capacity': 20000},
        'TIO Stadium': {'city': 'Darwin', 'state': 'NT', 'capacity': 12500},
        'Cazaly\'s Stadium': {'city': 'Cairns', 'state': 'QLD', 'capacity': 15000},
        'Riverway Stadium': {'city': 'Townsville', 'state': 'QLD', 'capacity': 26000},
        'Mars Stadium': {'city': 'Ballarat', 'state': 'VIC', 'capacity': 8000},
        'Jiangwan Stadium': {'city': 'Shanghai', 'state': 'INTL', 'capacity': 10000},
        'Traeger Park': {'city': 'Alice Springs', 'state': 'NT', 'capacity': 8500},
        'Norwood Oval': {'city': 'Adelaide', 'state': 'SA', 'capacity': 10000},
        'Blacktown International Sportspark': {'city': 'Sydney', 'state': 'NSW', 'capacity': 5000},
        
        # Common abbreviations and alternate names
        'M.C.G.': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 100024},
        'MCG': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 100024},
        'Docklands': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 53359},
        'S.C.G.': {'city': 'Sydney', 'state': 'NSW', 'capacity': 48000},
        'SCG': {'city': 'Sydney', 'state': 'NSW', 'capacity': 48000},
        'Gabba': {'city': 'Brisbane', 'state': 'QLD', 'capacity': 42000},
        'Subiaco': {'city': 'Perth', 'state': 'WA', 'capacity': 43500},
        'Perth Stadium': {'city': 'Perth', 'state': 'WA', 'capacity': 60000},
        'Carrara': {'city': 'Gold Coast', 'state': 'QLD', 'capacity': 25000},
        'York Park': {'city': 'Launceston', 'state': 'TAS', 'capacity': 20000},
        'University of Tasmania Stadium': {'city': 'Launceston', 'state': 'TAS', 'capacity': 20000},
        'Marrara Oval': {'city': 'Darwin', 'state': 'NT', 'capacity': 12500},
        'UNSW Canberra Oval': {'city': 'Canberra', 'state': 'ACT', 'capacity': 13550},
        'W.A.C.A.': {'city': 'Perth', 'state': 'WA', 'capacity': 20000},
        'WACA': {'city': 'Perth', 'state': 'WA', 'capacity': 20000},
        'Sydney Showground': {'city': 'Sydney', 'state': 'NSW', 'capacity': 24000},
        'Eureka Stadium': {'city': 'Ballarat', 'state': 'VIC', 'capacity': 8000},
        'Blacktown': {'city': 'Sydney', 'state': 'NSW', 'capacity': 5000},
        'Adelaide Arena at Jiangwan Stadium': {'city': 'Shanghai', 'state': 'INTL', 'capacity': 10000},
        'Wellington': {'city': 'Wellington', 'state': 'NZ', 'capacity': 34500},
        'Bruce Stadium': {'city': 'Canberra', 'state': 'ACT', 'capacity': 25000},
        'Adelaide Hills': {'city': 'Adelaide', 'state': 'SA', 'capacity': 5000},
        'Barossa Park': {'city': 'Adelaide', 'state': 'SA', 'capacity': 2000},
        'Hands Oval': {'city': 'Bunbury', 'state': 'WA', 'capacity': 4000},
        'Albury': {'city': 'Albury', 'state': 'NSW', 'capacity': 15000},
        'North Hobart': {'city': 'Hobart', 'state': 'TAS', 'capacity': 10000},
        
        # Historical venues
        'Subiaco Oval': {'city': 'Perth', 'state': 'WA', 'capacity': 43500},
        'Docklands Stadium': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 53359},  # Old name for Marvel
        'Colonial Stadium': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 53359},  # Old name for Marvel
        'Telstra Stadium': {'city': 'Sydney', 'state': 'NSW', 'capacity': 83500},  # Old name for Accor
        'Stadium Australia': {'city': 'Sydney', 'state': 'NSW', 'capacity': 83500},  # Old name for Accor
        'Skilled Stadium': {'city': 'Geelong', 'state': 'VIC', 'capacity': 36000},  # Old name for GMHBA
        'Simonds Stadium': {'city': 'Geelong', 'state': 'VIC', 'capacity': 36000},  # Old name for GMHBA
        'Kardinia Park': {'city': 'Geelong', 'state': 'VIC', 'capacity': 36000},  # Old name for GMHBA
        'Carrara Stadium': {'city': 'Gold Coast', 'state': 'QLD', 'capacity': 25000},  # Old name for Metricon
        'Bellerive Oval': {'city': 'Hobart', 'state': 'TAS', 'capacity': 20000},  # Old name for Blundstone
        'Football Park': {'city': 'Adelaide', 'state': 'SA', 'capacity': 51240},  # Historical venue
        'Waverley Park': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 78000},  # Historical venue
        'Princes Park': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 24500},  # Historical venue
        'Western Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 20000},  # Historical venue
        'Moorabbin': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 15000},  # Historical venue
        'Moorabbin Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 15000},  # Historical venue
        'Arden Street Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 3000},  # Historical venue
        'Arden St': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 3000},  # Historical venue
        'Windy Hill': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 20000},  # Historical venue
        'Glenferrie Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 8000},  # Historical venue
        'Junction Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 8000},  # Historical venue
        'Lake Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 15000},  # Historical venue
        'Corio Oval': {'city': 'Geelong', 'state': 'VIC', 'capacity': 20000},  # Historical venue
        'Victoria Park': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 25000},  # Historical venue
        'Brunswick St': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 25000},  # Historical venue
        'Punt Rd': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 20000},  # Historical venue
        'East Melbourne': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 20000},  # Historical venue
        'Toorak Park': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 8000},  # Historical venue
        'Coburg Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 10000},  # Historical venue
        'Yarraville Oval': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 8000},  # Historical venue
        'Olympic Park': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 18500},  # Historical venue
        'Yallourn': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 5000},  # Historical venue
        'Euroa': {'city': 'Melbourne', 'state': 'VIC', 'capacity': 5000},  # Historical venue
        'Brisbane Exhibition': {'city': 'Brisbane', 'state': 'QLD', 'capacity': 10000},  # Historical venue
    }
    
    # Add venue details
    venues_df['city'] = ''
    venues_df['state'] = ''
    venues_df['capacity'] = 0
    venues_df['surface'] = 'Grass'  # Default assumption
    
    # Apply known mappings
    for idx, row in venues_df.iterrows():
        venue_name = row['venue']
        if venue_name in venue_mapping:
            venues_df.at[idx, 'city'] = venue_mapping[venue_name]['city']
            venues_df.at[idx, 'state'] = venue_mapping[venue_name]['state']
            venues_df.at[idx, 'capacity'] = venue_mapping[venue_name]['capacity']
    
    # Show venues that need manual mapping
    unmapped = venues_df[venues_df['state'] == '']
    if len(unmapped) > 0:
        print(f"\nVenues needing manual mapping ({len(unmapped)}):")
        for venue in unmapped['venue'].values:
            print(f"  - {venue}")
    
    # Show top venues by match count
    print(f"\nTop 10 venues by match count:")
    for idx, row in venues_df.head(10).iterrows():
        print(f"  {row['venue']}: {row['match_count']} matches ({row['first_year']}-{row['last_year']})")
    
    # Save to CSV
    venues_df.to_csv(output_path, index=False)
    print(f"\nVenues CSV saved to: {output_path}")
    print(f"Total venues: {len(venues_df)}")
    print(f"Mapped venues: {len(venues_df[venues_df['state'] != ''])}")
    print(f"Unmapped venues: {len(venues_df[venues_df['state'] == ''])}")
    
    return venues_df

def main():
    parser = argparse.ArgumentParser(description='Extract venues from matches table')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to SQLite database')
    parser.add_argument('--output-path', type=str, default='data/venues.csv',
                        help='Path to save venues CSV')
    
    args = parser.parse_args()
    
    venues_df = extract_venues(args.db_path, args.output_path)

if __name__ == '__main__':
    main()