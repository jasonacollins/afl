const { runQuery, getOne } = require('../../models/db');
const fetch = require('node-fetch');
const { logger } = require('../../utils/logger');
const { AppError } = require('../../utils/error-handler');

/**
 * Fetches the latest game data from the Squiggle API for a given year,
 * updates the local database fixture (including completion percentage),
 * and updates scores for completed games.
 * Assumes a 'complete' column (INTEGER) exists in the 'matches' table.
 * @param {number} year The year to refresh data for.
 * @param {object} options Options for the refresh (e.g. forceScoreUpdate).
 * @returns {Promise<object>} An object indicating success or failure, along with counts.
 */
async function refreshAPIData(year, options = {}) {
  let insertCount = 0;
  let updateCount = 0;
  let scoresUpdated = 0;
  let existingMatchCount = 0;
  const skippedFixtureUpdates = [];
  const skippedScoreUpdates = [];

  const forceScoreUpdate = options.forceScoreUpdate || false;

  logger.info(`Starting API refresh process for year ${year}`, { forceScoreUpdate });

  try {
    // Fetching Games from Squiggle API
    const apiUrl = `https://api.squiggle.com.au/?q=games;year=${year}`;
    const userAgent = 'AFL-Predictions-App/1.0 (your-email@example.com)';
    
    logger.debug('Fetching games from Squiggle API', { apiUrl });
    
    const response = await fetch(apiUrl, { headers: { 'User-Agent': userAgent } });

    if (!response.ok) {
      throw new AppError(
        `Squiggle API request failed: ${response.status} ${response.statusText}`,
        response.status,
        'API_ERROR'
      );
    }
    
    const data = await response.json();
    if (!data || !data.games) {
      throw new AppError('Invalid data structure received from Squiggle API', 400, 'API_ERROR');
    }
    
    const gamesFromAPI = data.games;
    logger.info(`Received ${gamesFromAPI.length} games from API for ${year}`);

    // Update fixture information (dates, times, venues) for existing matches
    logger.info('Processing fixture updates for date/time/venue changes...');
    
    for (const game of gamesFromAPI) {
      const squiggleGameId = game.id;
      const apiDate = game.date || game.localtime;
      const apiVenue = game.venue;

      if (!squiggleGameId || !apiDate) {
        continue; // Skip games without proper ID or date
      }

      try {
        // First, get the current values for this match
        const currentMatch = await getOne(
          'SELECT match_date, venue, home_team_id, away_team_id FROM matches WHERE match_number = ?',
          [squiggleGameId]
        );

        if (!currentMatch) {
          continue; // Skip if match doesn't exist in database
        }

        existingMatchCount++;

        // Check if there are actual differences
        const dateChanged = currentMatch.match_date !== apiDate;
        const venueChanged = currentMatch.venue !== apiVenue;
        
        // Also check for team assignment updates (important for finals)
        const homeTeamId = game.hteamid || null;
        const awayTeamId = game.ateamid || null;
        const teamsChanged = currentMatch.home_team_id !== homeTeamId || currentMatch.away_team_id !== awayTeamId;

        if (dateChanged || venueChanged || teamsChanged) {
          // Only update if there are actual differences
          const result = await runQuery(
            'UPDATE matches SET match_date = ?, venue = ?, home_team_id = ?, away_team_id = ? WHERE match_number = ?',
            [apiDate, apiVenue, homeTeamId, awayTeamId, squiggleGameId]
          );

          if (result.changes > 0) {
            updateCount++;
            logger.debug(`Updated fixture info for match_number: ${squiggleGameId}`, {
              oldDate: currentMatch.match_date,
              newDate: apiDate,
              dateChanged,
              oldVenue: currentMatch.venue,
              newVenue: apiVenue,
              venueChanged,
              oldHomeTeam: currentMatch.home_team_id,
              newHomeTeam: homeTeamId,
              oldAwayTeam: currentMatch.away_team_id,
              newAwayTeam: awayTeamId,
              teamsChanged
            });
          }
        }
      } catch (err) {
        const errorMsg = `Error updating fixture info for match_number ${squiggleGameId}`;
        logger.error(errorMsg, { error: err.message });
        skippedFixtureUpdates.push(errorMsg);
      }
    }

    logger.info(`Fixture updates complete. Updated ${updateCount} matches`);
    if (existingMatchCount === 0 && gamesFromAPI.length > 0) {
      logger.warn(
        `No existing matches found in database for API year ${year}. Run sync-games for ${year} first to insert fixtures before API refresh.`
      );
    }

    // Update Final Scores & Set Completion to 100 for Completed Games
    const completedGamesWithScores = gamesFromAPI.filter(game =>
      game.complete === 100 &&
      game.hscore !== null && game.hscore !== undefined &&
      game.ascore !== null && game.ascore !== undefined &&
      game.id !== null && game.id !== undefined
    );
    
    logger.info(`Found ${completedGamesWithScores.length} fully completed games to potentially update`);

    // Define the SQL query to update final scores AND set completion to 100
    const scoreUpdateQuery = `
      UPDATE matches
      SET
        hscore = ?,
        ascore = ?,
        hgoals = ?,
        hbehinds = ?,
        agoals = ?,
        abehinds = ?,
        complete = 100
      WHERE
        match_number = ?
        ${forceScoreUpdate ? '' : 'AND (complete IS NULL OR complete != 100)'}
    `;

    for (const game of completedGamesWithScores) {
      const homeScore = parseInt(game.hscore, 10);
      const awayScore = parseInt(game.ascore, 10);
      const squiggleGameId = game.id;

      if (isNaN(homeScore) || isNaN(awayScore)) {
        const skipMsg = `Skipping score update for Game ID ${squiggleGameId}: Invalid scores received from API`;
        logger.warn(skipMsg, { homeScore: game.hscore, awayScore: game.ascore });
        skippedScoreUpdates.push(skipMsg);
        continue;
      }

      const params = [
        homeScore, 
        awayScore,
        game.hgoals || null,
        game.hbehinds || null,
        game.agoals || null,
        game.abehinds || null,
        squiggleGameId
      ];      

      try {
        const result = await runQuery(scoreUpdateQuery, params);

        if (result.changes > 0) {
          scoresUpdated++;
          logger.debug(`Updated final scores & completion for match_number: ${squiggleGameId}`);
        } else {
          const existing = await getOne(
            'SELECT complete, hscore, ascore FROM matches WHERE match_number = ?',
            [squiggleGameId]
          );

          if (!existing) {
            const skipMsg = `Skipping score update for Game ID ${squiggleGameId}: Match not found in database`;
            logger.warn(skipMsg);
            skippedScoreUpdates.push(skipMsg);
          } else if (existing.complete !== 100) {
            const skipMsg = `Skipped score update for Game ID ${squiggleGameId}: DB update failed unexpectedly`;
            logger.warn(skipMsg, { currentCompletion: existing.complete });
            skippedScoreUpdates.push(skipMsg);
          }
        }
      } catch (err) {
        const errorMsg = `Error updating final scores/completion for match_number ${squiggleGameId}`;
        logger.error(errorMsg, { error: err.message });
        skippedScoreUpdates.push(errorMsg);
      }
    }

    const finalMessage = `API refresh complete for ${year}. ` +
                         `Inserted Fixtures: ${insertCount}, Updated Fixtures: ${updateCount}, ` +
                         `Updated Final Scores/Completion: ${scoresUpdated}, ` +
                         `Skipped Fixture Updates: ${skippedFixtureUpdates.length}, `+
                         `Skipped Score Updates: ${skippedScoreUpdates.length}.` +
                         `${forceScoreUpdate ? ' (Force update mode was enabled)' : ''}`;
    
    logger.info(finalMessage);

    return {
      success: true,
      message: finalMessage,
      insertCount,
      updateCount,
      scoresUpdated,
      forceUpdate: forceScoreUpdate,
      skippedFixtureUpdateCount: skippedFixtureUpdates.length,
      skippedScoreUpdateCount: skippedScoreUpdates.length
    };

  } catch (error) {
    logger.error(`API refresh failed for year ${year}`, { error: error.message });
    
    if (error.isOperational) {
      throw error; // Re-throw operational errors
    }
    
    throw new AppError(
      `Error refreshing API data for year ${year}: ${error.message}`,
      500,
      'API_REFRESH_ERROR'
    );
  }
}

module.exports = { refreshAPIData };

if (require.main === module) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      const currentYear = new Date().getFullYear();
      let year = currentYear;
      let forceScoreUpdate = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--year' && args[i + 1]) {
          year = Number.parseInt(args[i + 1], 10);
          i += 1;
          continue;
        }
        if (arg === '--force-score-update') {
          forceScoreUpdate = true;
        }
      }

      if (!Number.isInteger(year)) {
        throw new Error('Invalid --year value');
      }

      const result = await refreshAPIData(year, { forceScoreUpdate });
      logger.info('API refresh script completed', { year, forceScoreUpdate });
      console.log(result.message);
      process.exit(0);
    } catch (error) {
      logger.error('API refresh script failed', { error: error.message });
      console.error(`API refresh failed: ${error.message}`);
      process.exit(1);
    }
  })();
}
