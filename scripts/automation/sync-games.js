// node-fetch v3 is ESM-only; use dynamic import for CommonJS scripts.
let fetchImpl = (...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args));
const { getQuery, getOne, runQuery, initializeDatabase } = require('../../models/db');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { buildSquiggleQueryUrl, getSquiggleRequestOptions } = require('../../utils/squiggle-request');

// Cache directory
const CACHE_DIR = path.join(__dirname, '../data/cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Helper function for API requests with proper etiquette
async function fetchAPI(endpoint, params = {}) {
  const url = buildSquiggleQueryUrl(endpoint, params);

  // Create cache key from URL
  const cacheKey = url.replace(/[^a-zA-Z0-9]/g, '_');
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
  
  // Check if we have a valid cache
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    const cacheAge = Date.now() - stats.mtimeMs;
    
    // Cache is valid for 15 minutes for most requests, 1 minute for live games
    const maxCacheAge = params.live ? 60 * 1000 : 15 * 60 * 1000;
    
    if (cacheAge < maxCacheAge) {
      logger.debug(`Using cached data for ${url}`);
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return cacheData;
    }
  }
  
  logger.info(`Fetching data from: ${url}`);
  
  try {
    const response = await fetchImpl(url, getSquiggleRequestOptions());
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Cache the response
    fs.writeFileSync(cachePath, JSON.stringify(data));
    
    return data;
  } catch (error) {
    logger.error(`Error fetching from API: ${error.message}`);
    
    // If we have a cache, use it even if expired
    if (fs.existsSync(cachePath)) {
      logger.warn(`Falling back to expired cache for ${url}`);
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
    
    throw error;
  }
}

async function resolveVenueId(venueName) {
  if (typeof venueName !== 'string' || venueName.trim() === '') {
    return null;
  }

  const row = await getOne(
    `SELECT venue_id
     FROM (
       SELECT v.venue_id AS venue_id, 0 AS priority
       FROM venues v
       WHERE TRIM(v.name) = TRIM(?) COLLATE NOCASE
       UNION ALL
       SELECT va.venue_id AS venue_id, 1 AS priority
       FROM venue_aliases va
       WHERE TRIM(va.alias_name) = TRIM(?) COLLATE NOCASE
       ORDER BY priority, venue_id
       LIMIT 1
     )`,
    [venueName, venueName]
  );

  return row ? row.venue_id : null;
}

function resolveSquiggleTeamIds(game) {
  let homeTeamId = game.hteamid || null;
  let awayTeamId = game.ateamid || null;

  if (!homeTeamId && game.hteam && game.hteam.toLowerCase().includes('to be announced')) {
    homeTeamId = 99;
  }

  if (!awayTeamId && game.ateam && game.ateam.toLowerCase().includes('to be announced')) {
    awayTeamId = 99;
  }

  return {
    homeTeamId,
    awayTeamId
  };
}

function resolveRoundNumber(game) {
  let roundNumber = game.round.toString();
  const normalizedRoundName = String(game.roundname || '').trim().toLowerCase();

  if (normalizedRoundName === 'opening round') {
    return 'OR';
  }

  if (
    game.is_final > 0 ||
    normalizedRoundName.includes('wild') ||
    normalizedRoundName.includes('final')
  ) {
    if (normalizedRoundName.includes('wild')) {
      return 'Wildcard Finals';
    }
    if (normalizedRoundName.includes('elimination')) {
      return 'Elimination Final';
    }
    if (normalizedRoundName.includes('qualifying')) {
      return 'Qualifying Final';
    }
    if (normalizedRoundName.includes('semi')) {
      return 'Semi Final';
    }
    if (normalizedRoundName.includes('preliminary')) {
      return 'Preliminary Final';
    }
    if (normalizedRoundName.includes('grand')) {
      return 'Grand Final';
    }

    switch (game.is_final) {
      case 1: return 'Wildcard Finals';
      case 2: return 'Elimination Final';
      case 3: return 'Qualifying Final';
      case 4: return 'Semi Final';
      case 5: return 'Preliminary Final';
      case 6: return 'Grand Final';
      default: return 'Finals';
    }
  }

  return roundNumber;
}

function resolveMatchDate(game) {
  if (game.unixtime) {
    return new Date(game.unixtime * 1000).toISOString();
  }
  if (game.date) {
    return new Date(game.date).toISOString();
  }
  return null;
}

function normalizeCompletion(complete) {
  const parsedCompletion = Number.parseInt(complete, 10);
  return Number.isInteger(parsedCompletion) && parsedCompletion >= 0 && parsedCompletion <= 100
    ? parsedCompletion
    : 0;
}

function normalizeScorePayload(game, matchDate, completion, now = new Date()) {
  const parsedMatchDate = matchDate ? new Date(matchDate) : null;
  const hasValidMatchDate = parsedMatchDate && !Number.isNaN(parsedMatchDate.getTime());
  const isFutureMatch = hasValidMatchDate && parsedMatchDate > now;

  const hasZeroPlaceholderScores =
    Number(game.hscore) === 0 &&
    Number(game.ascore) === 0 &&
    Number(game.hgoals) === 0 &&
    Number(game.hbehinds) === 0 &&
    Number(game.agoals) === 0 &&
    Number(game.abehinds) === 0;

  const shouldNullFixtureScores = completion < 100 && isFutureMatch && hasZeroPlaceholderScores;

  return {
    homeScore: shouldNullFixtureScores ? null : (game.hscore !== undefined ? game.hscore : null),
    awayScore: shouldNullFixtureScores ? null : (game.ascore !== undefined ? game.ascore : null),
    homeGoals: shouldNullFixtureScores ? null : (game.hgoals || null),
    homeBehinds: shouldNullFixtureScores ? null : (game.hbehinds || null),
    awayGoals: shouldNullFixtureScores ? null : (game.agoals || null),
    awayBehinds: shouldNullFixtureScores ? null : (game.abehinds || null)
  };
}

// Sync team data first to ensure the IDs are correct
async function syncTeams() {
  logger.info('Synchronizing team data with Squiggle API...');
  
  const data = await fetchAPI('teams');
  
  if (!data || !data.teams || !Array.isArray(data.teams)) {
    logger.error('Invalid team data received from API');
    return false;
  }
  
  logger.info(`Found ${data.teams.length} teams in API`);
  
  // Process each team
  for (const team of data.teams) {
    // Check if team exists in our database
    const existingTeam = await getOne(
      'SELECT team_id, name FROM teams WHERE team_id = ?',
      [team.id]
    );
    
    if (!existingTeam) {
      // Insert new team with Squiggle ID
      await runQuery(
        'INSERT INTO teams (team_id, name) VALUES (?, ?)',
        [team.id, team.name]
      );
      logger.info(`Added new team: ${team.name} with ID ${team.id}`);
    } else if (existingTeam.name !== team.name) {
      // Update team name if it changed
      await runQuery(
        'UPDATE teams SET name = ? WHERE team_id = ?',
        [team.name, team.id]
      );
      logger.info(`Updated team name from ${existingTeam.name} to ${team.name}`);
    }
  }
  
  return true;
}

async function syncGamesFromAPI(options = {}) {
  try {
    logger.info('Starting Squiggle API sync process...');
    
    // Ensure database is initialized
    await initializeDatabase();
    
    // Make sure teams are synchronized first
    await syncTeams();
    
    // Fetch game data
    const data = await fetchAPI('games', {
      year: options.year,
      round: options.round,
      game: options.gameId,
      team: options.teamId,
      complete: options.complete,
      live: options.live
    });
    
    if (!data || !data.games || !Array.isArray(data.games)) {
      logger.error('Invalid data received from API');
      return {
        insertCount: 0,
        updateCount: 0,
        skipCount: 0,
        completedInsertCount: 0,
        completedUpdateCount: 0
      };
    }
    
    logger.info(`Processing ${data.games.length} games from API`);
    
    // Process each game
    let insertCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    let completedInsertCount = 0;
    let completedUpdateCount = 0;
    
    for (const game of data.games) {
      try {
        const { homeTeamId, awayTeamId } = resolveSquiggleTeamIds(game);
        
        // Skip games with missing game ID
        if (!game.id) {
          logger.info(`Skipping game with missing ID`);
          skipCount++;
          continue;
        }
        
        const roundNumber = resolveRoundNumber(game);
        
        // Convert Unix timestamp to ISO date if available
        const matchDate = resolveMatchDate(game);
        
        // matches.complete is NOT NULL in schema; default unknown/invalid values to 0.
        const completion = normalizeCompletion(game.complete);
        const {
          homeScore,
          awayScore,
          homeGoals,
          homeBehinds,
          awayGoals,
          awayBehinds
        } = normalizeScorePayload(game, matchDate, completion);
        const venueId = await resolveVenueId(game.venue);
        
        // Check if match already exists in database with the Squiggle ID
        const existingMatch = await getOne(
          'SELECT match_id, complete, hscore, ascore FROM matches WHERE match_number = ?',
          [game.id]
        );

        const hasCompletedScores = completion === 100 &&
          homeScore !== null &&
          awayScore !== null;
        
        if (existingMatch) {
          const wasCompleted = Number(existingMatch.complete) === 100 &&
            existingMatch.hscore !== null &&
            existingMatch.ascore !== null;

          // Update existing match
          await runQuery(
            `UPDATE matches 
             SET round_number = ?, match_date = ?, venue = ?, 
                 venue_id = ?, home_team_id = ?, away_team_id = ?, hscore = ?, ascore = ?, 
                 hgoals = ?, hbehinds = ?, agoals = ?, abehinds = ?,
                 year = ?, complete = ?
             WHERE match_id = ?`,
            [
              roundNumber, 
              matchDate, 
              game.venue,
              venueId,
              homeTeamId, 
              awayTeamId, 
              homeScore, 
              awayScore,
              homeGoals,
              homeBehinds,
              awayGoals,
              awayBehinds,
              game.year || (matchDate ? new Date(matchDate).getFullYear() : new Date().getFullYear()),
              completion,
              existingMatch.match_id
            ]
          );
          updateCount++;

          if (!wasCompleted && hasCompletedScores) {
            completedUpdateCount++;
          }
        } else {
          // Insert new match
          await runQuery(
            `INSERT INTO matches 
            (match_number, round_number, match_date, venue, 
              venue_id, home_team_id, away_team_id, hscore, ascore, hgoals, hbehinds, agoals, abehinds, year, complete)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              game.id, 
              roundNumber, 
              matchDate, 
              game.venue,
              venueId,
              homeTeamId, 
              awayTeamId, 
              homeScore, 
              awayScore,
              homeGoals,
              homeBehinds,
              awayGoals,
              awayBehinds,
              game.year || (matchDate ? new Date(matchDate).getFullYear() : new Date().getFullYear()),
              completion // Add completion percentage
            ]
          );
          insertCount++;

          if (hasCompletedScores) {
            completedInsertCount++;
          }
        }
      } catch (gameError) {
        logger.error(`Error processing game ${game.id}:`, gameError);
        skipCount++;
      }
    }
    
    logger.info(`Sync complete.`);
    logger.info(`Inserted ${insertCount} new games.`);
    logger.info(`Updated ${updateCount} existing games.`);
    logger.info(`Skipped ${skipCount} games.`);
    logger.info(`Completed game inserts: ${completedInsertCount}.`);
    logger.info(`Matches newly marked complete via sync: ${completedUpdateCount}.`);
    
    return {
      insertCount,
      updateCount,
      skipCount,
      completedInsertCount,
      completedUpdateCount
    };
    
  } catch (error) {
    logger.error('Error synchronizing games:', error);
    throw error;
  }
}

// Function to reset database to use Squiggle IDs
async function resetDatabase() {
  logger.info('WARNING: This will reset all matches and teams to use Squiggle IDs');
  logger.info('Existing predictions will be orphaned and need to be re-entered');
  logger.info('Press Ctrl+C within 5 seconds to cancel...');
  
  // Wait 5 seconds for user to cancel
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  logger.info('Resetting database...');
  
  try {
    // Drop existing match and prediction data
    await runQuery('DELETE FROM predictions');
    await runQuery('DELETE FROM matches');
    await runQuery('DELETE FROM teams');
    
    logger.info('Database reset complete. Ready for fresh import.');
    
    // Sync teams and games
    await syncTeams();
    
    return true;
  } catch (error) {
    logger.error('Error resetting database:', error);
    return false;
  }
}

// Function to monitor live games - with proper back-off
async function monitorLiveGames(teamId) {
  logger.info('Starting live game monitoring...');
  
  // Initial options: games in progress or starting soon
  const options = {
    live: 1
  };
  
  if (teamId) {
    options.teamId = teamId;
    logger.info(`Monitoring games for team ID: ${teamId}`);
  }
  
  let consecutiveErrors = 0;
  let interval = 60; // Start with 60 seconds
  
  const runUpdate = async () => {
    try {
      const result = await syncGamesFromAPI(options);
      logger.info(`Live update: ${result.updateCount} games updated`);
      
      // Reset error counter and interval on success
      consecutiveErrors = 0;
      interval = 60;
    } catch (error) {
      logger.error('Error in live monitoring:', error);
      
      // Exponential back-off
      consecutiveErrors++;
      interval = Math.min(300, interval * (1 + (consecutiveErrors / 5)));
      logger.info(`Backing off, next attempt in ${interval} seconds`);
    }
    
    // Schedule next update with dynamic interval
    setTimeout(runUpdate, interval * 1000);
  };
  
  // Start the update cycle
  runUpdate();
  
  // Handle process termination
  process.on('SIGINT', () => {
    logger.info('Live monitoring stopped');
    process.exit(0);
  });
}

// Parse command line arguments
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    const currentYear = new Date().getFullYear();
    logger.info(`No options provided. Syncing current year by default: ${currentYear}`);
    await syncGamesFromAPI({ year: currentYear });
    process.exit(0);
  }
  
  const options = {};
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const value = args[i+1];
    
    // Commands without values
    if (key === 'reset') {
      await resetDatabase();
      return;
    } else if (key === 'clear-cache') {
      logger.info('Clearing cache...');
      if (fs.existsSync(CACHE_DIR)) {
        const files = fs.readdirSync(CACHE_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
        logger.info(`Cleared ${files.length} cache files`);
      }
      return;
    } else if (key === 'monitor') {
      // Special case for monitoring
      const teamId = args[i+1] && !args[i+1].startsWith('-') ? args[i+1] : null;
      await monitorLiveGames(teamId);
      return; // Don't exit, monitoring continues
    }
    
    // Commands with values
    if (key && value && !value.startsWith('-')) {
      switch (key) {
        case 'year': options.year = value; i++; break;
        case 'round': options.round = value; i++; break;
        case 'game': options.gameId = value; i++; break;
        case 'team': options.teamId = value; i++; break;
        case 'complete': options.complete = value; i++; break;
        case 'live': options.live = value; i++; break;
      }
    }
  }
  
  // Default action: sync with provided options
  await syncGamesFromAPI(options);
  
  // Exit unless monitoring
  if (!args.includes('monitor')) {
    process.exit(0);
  }
}

// Execute the script only if run directly (not when imported)
if (require.main === module) {
  main().catch(error => {
    logger.error('Script failed:', error);
    process.exit(1);
  });
}

function setFetchImplementationForTests(mockFetch) {
  fetchImpl = mockFetch;
}

function resetFetchImplementationForTests() {
  fetchImpl = (...args) => require('node-fetch').default(...args);
}

module.exports = {
  syncGamesFromAPI,
  syncTeams,
  __testables: {
    fetchAPI,
    resolveVenueId,
    resolveSquiggleTeamIds,
    resolveRoundNumber,
    resolveMatchDate,
    normalizeCompletion,
    normalizeScorePayload,
    resetDatabase,
    monitorLiveGames,
    main,
    setFetchImplementationForTests,
    resetFetchImplementationForTests
  }
};
