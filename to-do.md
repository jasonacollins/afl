# AFL ELO Interstate Home Advantage Implementation

## Goal
Implement contextual home advantage in ELO so interstate travel is modeled separately from same-state games.

## Verified Current State (March 6, 2026)

### Completed
- `venues` and `venue_aliases` tables exist and are populated.
- `venue_aliases` has temporal columns (`start_date`, `end_date`).
- `matches.venue_id` column exists with foreign key to `venues(venue_id)`.
- `teams.state` column exists and is populated for AFL clubs (20 of 21 rows; null row is `To Be Announced`).
- Indexes present: `idx_venue_aliases_dates`, `idx_venue_aliases_name`, `idx_venues_state`.
- Venue mapping coverage is complete by name/alias:
  - 59 distinct non-empty `matches.venue` values.
  - 59/59 resolvable to a venue via `venues.name` or `venue_aliases.alias_name`.

### Partially Complete / Drifted
- `matches.venue_id` is not fully populated:
  - `218` rows currently null (`2025`: 2, `2026`: 216).
  - All nulls are resolvable with current `venues` + `venue_aliases`.
- Ongoing fixture scripts currently update/insert `matches.venue` but do not set `matches.venue_id`:
  - `scripts/automation/sync-games.js`
  - `scripts/automation/api-refresh.js`
- No trigger exists to keep `venue_id` in sync when `venue` text changes.
- No explicit `matches(venue_id)` index exists.

### Already Implemented in ELO Code
- Strict interstate HA selector is implemented and shared in `scripts/core/home_advantage.py`.
- Rule now enforced everywhere:
  - apply `interstate_home_advantage` only when `home_team_state == venue_state` and `away_team_state != venue_state`
  - otherwise apply `default_home_advantage`
  - if any state is missing or `venue_state == 'INTL'`, apply `default_home_advantage`
- State context (`home_team_state`, `away_team_state`, `venue_state`) is now fetched via DB joins in `scripts/core/data_io.py`.
- Active win/margin model code and optimization/training paths under `scripts/core/` now use the shared selector.
- Runtime prediction scripts now use the same rule:
  - `scripts/elo_win_predict.py`
  - `scripts/elo_margin_predict.py`
  - `scripts/elo_predict_combined.py`
- History replay now uses the same shared selector and no longer uses a hardcoded team-state map:
  - `scripts/elo_history_generator.py`

## Corrections to Previous Notes
- Column name is `teams.state`, not `teams.team_state`.
- Active script names are `scripts/elo_*.py` (not `scripts/afl_elo_*.py`).
- `data/venues_consolidated_*` and `data/venues_consolidated_mapping.json` are not present in this repo.
- Venue/state source of truth is the database tables (`venues`, `venue_aliases`), not a JSON mapping file.

## Remaining Work

### 1) Data Integrity and Schema Follow-Through (High Priority)
- Backfill `matches.venue_id` for current null rows using `venues` + `venue_aliases`.
- Update `sync-games` inserts/updates to set `venue_id` whenever `venue` is set.
- Update `api-refresh` fixture updates to also maintain `venue_id`.
- Add `CREATE INDEX IF NOT EXISTS idx_matches_venue_id ON matches(venue_id)`.
- Optional hardening: add a uniqueness guard for canonical venue names (for example, unique index on `venues(name)`).
- Optional hardening: add trigger(s) or a shared resolver helper so `venue` and `venue_id` cannot drift again.

### 2) ELO Model Rollout (Completed)
- Dual HA parameters are now active across core, training, optimization, prediction, and history code paths.
- Parameter names are implemented:
  - `default_home_advantage`
  - `interstate_home_advantage`
- Backward compatibility is implemented: model files with only `home_advantage` are treated as using that value for both defaults.
- Remaining operational work is model retraining/publishing, not code rollout.

### 3) Edge Cases
- Neutral venue handling:
  - Schema currently has no `matches.is_neutral` flag.
  - Decide whether to add explicit neutral handling (recommended for Grand Finals and special events).
- Interstate "home" games:
  - Strict rule is now implemented: interstate boost is only allowed when the home team is in its own state at that venue.
- International games:
  - `INTL` now explicitly falls back to `default_home_advantage`.

### 4) Optional Historical Accuracy Enhancements
- Add `team_states_history` table for relocations/rebrands if historical treatment is required.
- Populate alias date ranges in `venue_aliases` where needed for strict temporal correctness.

## Validation Checklist
- DB checks:
  - `SELECT COUNT(*) FROM matches WHERE venue_id IS NULL;` returns `0`.
  - Name/alias mapping audit returns no unmapped venues.
- Modeling checks:
  - Interstate advantage branch only triggers when `home_team_state == venue_state` and `away_team_state != venue_state`.
  - Interstate advantage parameter converges above same-state/default in optimization output.
  - Historical log-loss/Brier improves or remains neutral after rollout.
- Edge-case checks:
  - Known neutral/interstate-home fixtures produce expected home advantage branch.

## Key Files
- DB schema/init: `models/db.js`
- Fixture sync/update: `scripts/automation/sync-games.js`, `scripts/automation/api-refresh.js`
- Historical generator: `scripts/elo_history_generator.py`
- Core ELO logic: `scripts/core/`
- Shared HA selector: `scripts/core/home_advantage.py`

---
Last updated: March 6, 2026 (strict interstate HA rollout recorded)
