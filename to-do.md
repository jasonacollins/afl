# AFL ELO Interstate Home Advantage Implementation

## Project Goal
Implement granular home field advantage in the ELO prediction model that distinguishes between same-state and interstate matches, as interstate home advantage is significantly larger than intrastate advantage.

## What We've Completed ✅

### 1. Analysis & Research
- **Analyzed current ELO implementation** - Single `home_advantage` parameter applied uniformly
- **Researched team location data** - No state information currently stored for teams
- **Designed framework** - Two-tier system: `same_state_advantage` vs `interstate_advantage`

### 2. Venue Data Infrastructure 
- **Extracted all venues** from matches table (59 unique venues from 1897-2025)
- **Created venue mapping** with city/state information for all venues
- **Smart consolidation** - Distinguished real duplicates vs different physical venues
  - Real duplicates (e.g., "Docklands" = "Marvel Stadium") → consolidated with aliases
  - Different venues (e.g., MCG ≠ Marvel Stadium) → kept separate
- **Generated clean files:** for database setup

### 3. Database Setup

Ran a SQL script that:
- Created venues and venue_aliases tables (with temporal tracking support)
- Insert all venue data with your preferred primary names
- Add venue_id to matches table and populate it
- Add team_state to teams table and populate it
- Set up all necessary indexes

## What Still Needs To Be Done 🔲

### 4. ELO Model Enhancement

#### A. Update AFLEloModel Class (`scripts/afl_elo_training.py`)
- **Replace single `home_advantage`** with dual parameters:
  - `same_state_advantage` (expected: ~30-50 points)
  - `interstate_advantage` (expected: ~60-100 points)

- **Add team-state mapping** at top of file:
  ```python
  TEAM_STATES = {
      'Adelaide': 'SA',
      'Brisbane Lions': 'QLD',
      'Carlton': 'VIC',
      'Collingwood': 'VIC',
      'Essendon': 'VIC',
      'Fremantle': 'WA',
      'Geelong': 'VIC',
      'Gold Coast': 'QLD',
      'Greater Western Sydney': 'NSW',
      'Hawthorn': 'VIC',
      'Melbourne': 'VIC',
      'North Melbourne': 'VIC',
      'Port Adelaide': 'SA',
      'Richmond': 'VIC',
      'St Kilda': 'VIC',
      'Sydney': 'NSW',
      'West Coast': 'WA',
      'Western Bulldogs': 'VIC'
  }
  ```

- **Modify `calculate_win_probability` method** to use contextual home advantage:
  ```python
  def calculate_win_probability(self, home_team, away_team, state=None):
      home_rating = self.team_ratings.get(home_team, self.base_rating)
      away_rating = self.team_ratings.get(away_team, self.base_rating)
      
      home_advantage = self.get_contextual_home_advantage(home_team, away_team, state)
      rating_diff = (home_rating + home_advantage) - away_rating
      win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
      return win_probability

  def get_contextual_home_advantage(self, home_team, away_team, state):
      home_team_state = TEAM_STATES.get(home_team)
      away_team_state = TEAM_STATES.get(away_team)
      
      # Use venue state if available, otherwise fall back to home team state
      game_state = state or home_team_state
      
      if away_team_state != game_state:
          return self.interstate_advantage  # Away team traveling interstate
      else:
          return self.same_state_advantage  # Same state game
  ```

#### B. Update Bayesian Optimization (`scripts/afl_elo_optimize_bayesian.py`)
- **Expand parameter space** to include both home advantage parameters:
  ```python
  space = [
      Integer(10, 50, name='k_factor'),
      Integer(0, 80, name='same_state_advantage'),      # Intrastate home advantage
      Integer(20, 120, name='interstate_advantage'),    # Interstate home advantage  
      Real(0.1, 0.7, name='margin_factor'),
      Real(0.3, 0.95, name='season_carryover'),
      Integer(60, 180, name='max_margin'),
      Real(0.02, 0.08, name='beta')
  ]
  ```

- **Update objective function** to pass both parameters to AFLEloModel
- **Load venue mapping** from JSON to get venue states during evaluation

#### C. Update Other ELO Scripts
- **`afl_elo_predictions.py`** - Use venue state information for predictions
- **`afl_elo_history_generator.py`** - Apply contextual home advantage in historical calculations

### 5. Handle Edge Cases

#### A. Neutral Venues
- Grand Finals at MCG where neither team is "home"
- Consider adding `is_neutral` flag to matches table

#### B. Teams Playing "Home" Games Interstate
- North Melbourne games in Tasmania
- Hawthorn games in Tasmania
- Melbourne games in Northern Territory

#### C. International Games
- Already marked as 'INTL' in venue data
- Consider special handling in home advantage calculation

### 6. Data Integration
- **Modify scripts** to use venue mapping JSON for state lookups
- **Update match processing** to include venue state information
- **Test with historical data** to validate improved accuracy

### 7. Testing & Validation
- **Compare old vs new model** performance on historical data
- **Validate parameter ranges** make sense (interstate > same-state advantage)
- **Test edge cases** (neutral venues, international games, etc.)
- **Run validation query** to ensure all venues mapped correctly

## Optional Enhancements 🔧

### Temporal Data for Venues
The venue_aliases table now includes start_date and end_date columns. You can populate these to track when venue names were in use:
```sql
-- Example: Marvel Stadium name changes over time
UPDATE venue_aliases SET start_date = '2000-01-01', end_date = '2008-12-31' 
WHERE venue_id = 1 AND alias_name = 'Telstra Dome';

UPDATE venue_aliases SET start_date = '2009-01-01', end_date = '2018-08-31' 
WHERE venue_id = 1 AND alias_name = 'Etihad Stadium';

UPDATE venue_aliases SET start_date = '2018-09-01', end_date = NULL 
WHERE venue_id = 1 AND alias_name = 'Marvel Stadium';
```

### Team Relocation History
Handle historical team relocations:
```sql
CREATE TABLE team_states_history (
    team_id INTEGER,
    team_state TEXT,
    start_year INTEGER,
    end_year INTEGER,
    FOREIGN KEY (team_id) REFERENCES teams(team_id)
);

-- Examples:
-- South Melbourne (VIC) → Sydney (NSW) in 1982
-- Fitzroy (VIC) → Brisbane Bears/Lions (QLD) merger in 1996
```

## Expected Outcomes
- **More accurate predictions** especially for interstate matches
- **Better parameter optimization** with distinct home advantage types
- **Cleaner data structure** with proper venue normalization
- **Historical consistency** maintained while improving accuracy

## Key Files & Locations
- **ELO Scripts**: `scripts/afl_elo_*.py`
- **Venue Data**: `data/venues_consolidated_*`
- **Database**: `data/afl_predictions.db`
- **Venue Mapping**: Use `data/venues_consolidated_mapping.json` in ELO scripts

## Implementation Priority
1. **Database setup** - Single command execution of comprehensive SQL script ✅
2. **ELO model enhancement** - Dual home advantage implementation
3. **Edge case handling** - Neutral venues and interstate "home" games
4. **Bayesian optimization update** - Expand parameter space
5. **Testing and validation** - Compare old vs new model performance

---
*Last updated after database structure review session*