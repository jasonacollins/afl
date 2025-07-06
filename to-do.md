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
- **Generated clean files:**
  - `data/venues_consolidated_venues.csv` - 52 venues (venue_id, primary_name, city, state)
  - `data/venues_consolidated_aliases.csv` - 15 venue aliases
  - `data/venues_consolidated_schema.sql` - Database setup script
  - `data/venues_consolidated_mapping.json` - JSON mapping for ELO scripts

## What Still Needs To Be Done 🔲

### 3. Database Setup
- **Run SQL script** to create venues tables:
  ```bash
  sqlite3 data/afl_predictions.db < data/venues_consolidated_schema.sql
  ```
- **Add team state information** to teams table:
  ```sql
  ALTER TABLE teams ADD COLUMN state TEXT;
  UPDATE teams SET state = 'VIC' WHERE name = 'Carlton'; -- etc for all teams
  ```
- **Add venue_id to matches table** and populate:
  ```sql
  ALTER TABLE matches ADD COLUMN venue_id INTEGER REFERENCES venues(venue_id);
  UPDATE matches SET venue_id = (SELECT venue_id FROM venues WHERE primary_name = matches.venue OR venue_id IN (SELECT venue_id FROM venue_aliases WHERE alias_name = matches.venue));
  ```

### 4. Team State Mapping
Add state information for all AFL teams:
```
Adelaide → SA
Brisbane Lions → QLD  
Carlton → VIC
Collingwood → VIC
Essendon → VIC
Fremantle → WA
Geelong → VIC
Gold Coast → QLD
Greater Western Sydney → NSW
Hawthorn → VIC
Melbourne → VIC
North Melbourne → VIC
Port Adelaide → SA
Richmond → VIC
St Kilda → VIC
Sydney → NSW
West Coast → WA
Western Bulldogs → VIC
```

### 5. ELO Model Enhancement

#### A. Update AFLEloModel Class (`scripts/afl_elo_training.py`)
- **Replace single `home_advantage`** with dual parameters:
  - `same_state_advantage` (expected: ~30-50 points)
  - `interstate_advantage` (expected: ~60-100 points)

- **Add team-state mapping** at top of file:
  ```python
  TEAM_STATES = {
      'Adelaide': 'SA',
      'Brisbane Lions': 'QLD',
      # ... (complete mapping)
  }
  ```

- **Modify `calculate_win_probability` method** to use contextual home advantage:
  ```python
  def calculate_win_probability(self, home_team, away_team, venue_state=None):
      home_rating = self.team_ratings.get(home_team, self.base_rating)
      away_rating = self.team_ratings.get(away_team, self.base_rating)
      
      home_advantage = self.get_contextual_home_advantage(home_team, away_team, venue_state)
      rating_diff = (home_rating + home_advantage) - away_rating
      win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
      return win_probability

  def get_contextual_home_advantage(self, home_team, away_team, venue_state):
      home_team_state = TEAM_STATES.get(home_team)
      away_team_state = TEAM_STATES.get(away_team)
      
      # Use venue state if available, otherwise fall back to home team state
      game_state = venue_state or home_team_state
      
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

### 6. Data Integration
- **Modify scripts** to use venue mapping JSON for state lookups
- **Update match processing** to include venue state information
- **Test with historical data** to validate improved accuracy

### 7. Testing & Validation
- **Compare old vs new model** performance on historical data
- **Validate parameter ranges** make sense (interstate > same-state advantage)
- **Test edge cases** (neutral venues, international games, etc.)

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
1. Database setup (venues tables + team states)
2. ELO model enhancement (dual home advantage)
3. Bayesian optimization update
4. Testing and validation

---
*Created during development session for implementing interstate home advantage in AFL ELO predictions*