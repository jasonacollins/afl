**Summary of Potential Issues:**

**Across Multiple Scripts:**

*   **Redundant `iterrows`:** All scripts that process match data use `iterrows`, which is inefficient and can lead to reproducibility issues.
*   **Inconsistent Season Carryover:** The season carryover is not applied consistently after the last match of a season.
*   **Hardcoded `base_rating`:** The `apply_season_carryover` method in all relevant scripts uses a hardcoded `base_rating` of 1500.
*   **Output Directory Creation:** The output directory is created in the functions that write files, rather than in the `main` function.
*   **Inefficient DataFrame Construction:** The `save_rating_history_to_csv` functions in `afl_elo_predict_margin.py` and `afl_elo_predict_combined.py` are inefficient.

**Specific to `afl_elo_optimize_margin.py`:**

*   **Redundant File Name in Docstring.**
*   **Lack of Parallelism in Optimization.**
*   **Potentially Unstable `gp_minimize` without `n_restarts_optimizer`.**
*   **Hardcoded `random_state`.**
*   **Verbose Output During Optimization.**
*   **Inconsistent Data Types in `best_params`.**
*   **Error in `main` function.**

**Specific to `afl_elo_train_margin.py`:**

*   **Incorrect `update_ratings` Logic.**
*   **Unused `rating_history`.**

**Specific to `afl_elo_predict_margin.py`:**

*   **Incorrect `update_ratings` Logic.**
*   **Unused `rating_history`.**
*   **Date Handling in `save_predictions_to_database`.**

**Specific to `afl_elo_predict_combined.py`:**

*   **Incorrect `update_ratings` Logic for Margin Model.**
*   **Unused `rating_history`.**
*   **`load_standard_model` has a validation bug.**
*   **`load_margin_model` has a validation bug.**

**Specific to `afl_elo_history_generator.py`:**

*   **SQL Injection Vulnerability.**
*   **`get_team_history_summary` is inefficient.**
*   **Unused `rating_history`.**
*   **Docstring is out of date.**
