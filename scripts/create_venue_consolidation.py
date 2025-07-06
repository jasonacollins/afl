#!/usr/bin/env python3
"""
Create smart venue consolidation that distinguishes between real duplicates
(same physical venue with different names) vs different physical venues
"""

import pandas as pd
import sqlite3
import argparse
import json

def create_venue_consolidation(csv_path, output_path):
    """Create smart venue consolidation with proper venue mapping"""
    
    venues_df = pd.read_csv(csv_path)
    
    # Define smart consolidation rules
    # Real duplicates: Same physical venue with different names over time
    real_duplicates = {
        # Modern stadium naming rights changes
        'Marvel Stadium': {
            'primary_name': 'Marvel Stadium',
            'aliases': ['Docklands', 'Docklands Stadium', 'Colonial Stadium', 'Telstra Dome'],
            'city': 'Melbourne', 'state': 'VIC',
            'rationale': 'Same venue, naming rights changes'
        },
        'GMHBA Stadium': {
            'primary_name': 'GMHBA Stadium', 
            'aliases': ['Kardinia Park', 'Skilled Stadium', 'Simonds Stadium'],
            'city': 'Geelong', 'state': 'VIC',
            'rationale': 'Same venue, naming rights changes'
        },
        'Optus Stadium': {
            'primary_name': 'Optus Stadium',
            'aliases': ['Perth Stadium'],
            'city': 'Perth', 'state': 'WA',
            'rationale': 'Same venue, naming rights'
        },
        'Accor Stadium': {
            'primary_name': 'Accor Stadium',
            'aliases': ['Stadium Australia', 'Telstra Stadium', 'ANZ Stadium'],
            'city': 'Sydney', 'state': 'NSW',
            'rationale': 'Same venue, naming rights changes'
        },
        'Blundstone Arena': {
            'primary_name': 'Blundstone Arena',
            'aliases': ['Bellerive Oval'],
            'city': 'Hobart', 'state': 'TAS',
            'rationale': 'Same venue, naming rights'
        },
        'University of Tasmania Stadium': {
            'primary_name': 'University of Tasmania Stadium',
            'aliases': ['York Park'],
            'city': 'Launceston', 'state': 'TAS',
            'rationale': 'Same venue, naming rights'
        },
        'Metricon Stadium': {
            'primary_name': 'Metricon Stadium',
            'aliases': ['Carrara', 'Carrara Stadium'],
            'city': 'Gold Coast', 'state': 'QLD',
            'rationale': 'Same venue, naming rights'
        },
        'The Gabba': {
            'primary_name': 'The Gabba',
            'aliases': ['Gabba', 'Brisbane Cricket Ground'],
            'city': 'Brisbane', 'state': 'QLD',
            'rationale': 'Same venue, common name variations'
        },
        'Sydney Cricket Ground': {
            'primary_name': 'Sydney Cricket Ground',
            'aliases': ['S.C.G.', 'SCG'],
            'city': 'Sydney', 'state': 'NSW',
            'rationale': 'Same venue, abbreviation variations'
        },
        'Melbourne Cricket Ground': {
            'primary_name': 'Melbourne Cricket Ground',
            'aliases': ['M.C.G.', 'MCG'],
            'city': 'Melbourne', 'state': 'VIC',
            'rationale': 'Same venue, abbreviation variations'
        },
        'W.A.C.A. Ground': {
            'primary_name': 'W.A.C.A. Ground',
            'aliases': ['W.A.C.A.', 'WACA'],
            'city': 'Perth', 'state': 'WA',
            'rationale': 'Same venue, abbreviation variations'
        },
        'Jiangwan Stadium': {
            'primary_name': 'Jiangwan Stadium',
            'aliases': ['Adelaide Arena at Jiangwan Stadium'],
            'city': 'Shanghai', 'state': 'INTL',
            'rationale': 'Same venue, promotional naming'
        },
        'Mars Stadium': {
            'primary_name': 'Mars Stadium',
            'aliases': ['Eureka Stadium'],
            'city': 'Ballarat', 'state': 'VIC',
            'rationale': 'Same venue, naming rights change'
        },
        'Manuka Oval': {
            'primary_name': 'Manuka Oval',
            'aliases': ['UNSW Canberra Oval'],
            'city': 'Canberra', 'state': 'ACT',
            'rationale': 'Same venue, sponsorship naming'
        },
        'TIO Stadium': {
            'primary_name': 'TIO Stadium',
            'aliases': ['Marrara Oval'],
            'city': 'Darwin', 'state': 'NT',
            'rationale': 'Same venue, naming rights'
        }
    }
    
    # Different physical venues (keep separate) - these are genuinely different stadiums
    separate_venues = {
        # Melbourne has many different venues - DO NOT consolidate
        'Melbourne_separate': [
            'Melbourne Cricket Ground', 'Marvel Stadium', 'Princes Park', 'Victoria Park',
            'Junction Oval', 'Waverley Park', 'Lake Oval', 'Western Oval', 'Windy Hill',
            'Brunswick St', 'Punt Rd', 'Arden St', 'Glenferrie Oval', 'Moorabbin Oval',
            'East Melbourne', 'Toorak Park', 'Coburg Oval', 'Yarraville Oval',
            'Olympic Park', 'Yallourn', 'Euroa'
        ],
        # Adelaide has different venues - DO NOT consolidate  
        'Adelaide_separate': [
            'Adelaide Oval', 'Football Park', 'Norwood Oval', 'Adelaide Hills', 'Barossa Park'
        ],
        # Sydney has different venues - DO NOT consolidate
        'Sydney_separate': [
            'Sydney Cricket Ground', 'Accor Stadium', 'Sydney Showground', 'Blacktown'
        ],
        # Perth venues - Subiaco vs Optus are different locations
        'Perth_separate': [
            'Subiaco Oval', 'Optus Stadium', 'W.A.C.A. Ground'
        ],
        # Canberra venues - different locations
        'Canberra_separate': [
            'Manuka Oval', 'Bruce Stadium'
        ],
        # Tasmania venues - different cities
        'Tasmania_separate': [
            'University of Tasmania Stadium',  # Launceston
            'Blundstone Arena',  # Hobart
            'North Hobart'  # Different Hobart venue
        ]
    }
    
    # Create consolidated venue list
    consolidated_venues = []
    venue_aliases = []
    venue_id = 1
    processed_venues = set()
    
    print("Creating consolidated venue structure...")
    print("=" * 60)
    
    # Process real duplicates first
    print("\n🔄 CONSOLIDATING REAL DUPLICATES:")
    for primary_name, config in real_duplicates.items():
        # Find all venue names that match this consolidation
        matching_venues = []
        all_names = [primary_name] + config['aliases']
        
        for name in all_names:
            venue_rows = venues_df[venues_df['venue'] == name]
            if len(venue_rows) > 0:
                matching_venues.extend(venue_rows.to_dict('records'))
                processed_venues.add(name)
        
        if matching_venues:
            # Add to consolidated venues
            consolidated_venues.append({
                'venue_id': venue_id,
                'primary_name': config['primary_name'],
                'city': config['city'],
                'state': config['state']
            })
            
            # Add aliases
            for venue in matching_venues:
                if venue['venue'] != config['primary_name']:
                    venue_aliases.append({
                        'venue_id': venue_id,
                        'alias_name': venue['venue']
                    })
            
            print(f"  ✅ {config['primary_name']} ({config['city']}, {config['state']})")
            for venue in matching_venues:
                if venue['venue'] != config['primary_name']:
                    print(f"     -> {venue['venue']}")
            
            venue_id += 1
    
    # Process remaining venues as separate entities
    print(f"\n🏟️  KEEPING AS SEPARATE VENUES:")
    remaining_venues = venues_df[~venues_df['venue'].isin(processed_venues)]
    
    for _, venue in remaining_venues.iterrows():
        consolidated_venues.append({
            'venue_id': venue_id,
            'primary_name': venue['venue'],
            'city': venue['city'],
            'state': venue['state']
        })
        
        print(f"  🏟️  {venue['venue']} ({venue['city']}, {venue['state']})")
        processed_venues.add(venue['venue'])
        venue_id += 1
    
    # Create DataFrames
    venues_final_df = pd.DataFrame(consolidated_venues)
    aliases_df = pd.DataFrame(venue_aliases)
    
    # Summary statistics
    print(f"\n📊 CONSOLIDATION SUMMARY:")
    print(f"  Original venues: {len(venues_df)}")
    print(f"  Consolidated venues: {len(venues_final_df)}")
    print(f"  Venue aliases created: {len(aliases_df)}")
    print(f"  Consolidation reduction: {len(venues_df) - len(venues_final_df)} venues")
    
    # Save to CSV files
    venues_output = output_path.replace('.csv', '_venues.csv')
    aliases_output = output_path.replace('.csv', '_aliases.csv')
    
    venues_final_df.to_csv(venues_output, index=False)
    aliases_df.to_csv(aliases_output, index=False)
    
    print(f"\n💾 FILES CREATED:")
    print(f"  Venues: {venues_output}")
    print(f"  Aliases: {aliases_output}")
    
    # Create SQL script for database creation
    sql_output = output_path.replace('.csv', '_schema.sql')
    create_sql_script(venues_final_df, aliases_df, sql_output)
    
    # Create venue name mapping for ELO scripts
    mapping_output = output_path.replace('.csv', '_mapping.json')
    create_venue_mapping(venues_final_df, aliases_df, mapping_output)
    
    return venues_final_df, aliases_df

def create_sql_script(venues_df, aliases_df, output_path):
    """Create SQL script to set up the database"""
    
    sql_script = """-- Venue consolidation SQL script
-- This script creates the venues and venue_aliases tables with proper normalization

-- Create venues table
CREATE TABLE IF NOT EXISTS venues (
    venue_id INTEGER PRIMARY KEY,
    primary_name TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL
);

-- Create venue aliases table
CREATE TABLE IF NOT EXISTS venue_aliases (
    alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id INTEGER NOT NULL,
    alias_name TEXT NOT NULL,
    FOREIGN KEY (venue_id) REFERENCES venues(venue_id),
    UNIQUE(venue_id, alias_name)
);

-- Insert venues data
"""
    
    # Add venue inserts
    for _, venue in venues_df.iterrows():
        sql_script += f"""INSERT INTO venues (venue_id, primary_name, city, state) 
VALUES ({venue['venue_id']}, '{venue['primary_name'].replace("'", "''")}', '{venue['city']}', '{venue['state']}');
"""
    
    # Add alias inserts
    if len(aliases_df) > 0:
        sql_script += "\n-- Insert venue aliases\n"
        for _, alias in aliases_df.iterrows():
            sql_script += f"""INSERT INTO venue_aliases (venue_id, alias_name) 
VALUES ({alias['venue_id']}, '{alias['alias_name'].replace("'", "''")}'');
"""
    
    sql_script += """
-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_venues_state ON venues(state);
CREATE INDEX IF NOT EXISTS idx_venue_aliases_name ON venue_aliases(alias_name);

-- Add venue_id column to matches table (run this after creating venues)
-- ALTER TABLE matches ADD COLUMN venue_id INTEGER REFERENCES venues(venue_id);

-- Update matches with venue_id (you'll need to run this after the above)
-- UPDATE matches SET venue_id = (
--     SELECT COALESCE(
--         (SELECT venue_id FROM venues WHERE primary_name = matches.venue),
--         (SELECT venue_id FROM venue_aliases WHERE alias_name = matches.venue)
--     )
-- );
"""
    
    with open(output_path, 'w') as f:
        f.write(sql_script)
    
    print(f"  SQL Script: {output_path}")

def create_venue_mapping(venues_df, aliases_df, output_path):
    """Create JSON mapping for ELO scripts to convert venue names to venue info"""
    
    venue_mapping = {}
    
    # Add primary venues
    for _, venue in venues_df.iterrows():
        venue_mapping[venue['primary_name']] = {
            'venue_id': int(venue['venue_id']),
            'primary_name': venue['primary_name'],
            'city': venue['city'],
            'state': venue['state']
        }
    
    # Add aliases pointing to primary venues
    for _, alias in aliases_df.iterrows():
        primary_venue = venues_df[venues_df['venue_id'] == alias['venue_id']].iloc[0]
        venue_mapping[alias['alias_name']] = {
            'venue_id': int(alias['venue_id']),
            'primary_name': primary_venue['primary_name'],
            'city': primary_venue['city'],
            'state': primary_venue['state']
        }
    
    with open(output_path, 'w') as f:
        json.dump(venue_mapping, f, indent=2)
    
    print(f"  Venue Mapping: {output_path}")

def main():
    parser = argparse.ArgumentParser(description='Create smart venue consolidation')
    parser.add_argument('--csv-path', type=str, default='data/venues.csv',
                        help='Path to venues CSV')
    parser.add_argument('--output-path', type=str, default='data/venues_consolidated.csv',
                        help='Path to save consolidated venues')
    
    args = parser.parse_args()
    
    venues_df, aliases_df = create_venue_consolidation(args.csv_path, args.output_path)
    
    print(f"\n🎉 Venue consolidation complete!")
    print(f"Ready to update your database with the new venue structure.")

if __name__ == '__main__':
    main()