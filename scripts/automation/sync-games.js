const fetch = require('node-fetch');
const { getQuery, getOne, runQuery, initializeDatabase } = require('../../models/db');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

// Base API URL
const BASE_API_URL = 'https://api.squiggle.com.au/';

// Custom user agent
const USER_AGENT = "jason@jasoncollins.me";

// Cache directory
const CACHE_DIR = path.join(__dirname, '../data/cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Helper function for API requests with proper etiquette
async function fetchAPI(endpoint, params = {}) {
  // Build query string
  const queryParams = Object.entries(params)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(';');
    
  const url = `${BASE_API_URL}?q=${endpoint}${queryParams ? ';' + queryParams : ''}`;
  
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
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    
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
      return { insertCount: 0, updateCount: 0, skipCount: 0 };
    }
    
    logger.info(`Processing ${data.games.length} games from API`);
    
    // Process each game
    let insertCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    
    for (const game of data.games) {
      try {
        // Get team IDs from the API
        let homeTeamId = game.hteamid || null;
        let awayTeamId = game.ateamid || null;

        // For finals without assigned teams, use placeholder IDs if the team name is "To be announced"
        if (!homeTeamId && game.hteam && game.hteam.toLowerCase().includes("to be announced")) {
          // Use a special ID for TBA home team
          homeTeamId = 99; // Special ID for "To be announced"
        }

        if (!awayTeamId && game.ateam && game.ateam.toLowerCase().includes("to be announced")) {
          // Use a special ID for TBA away team
          awayTeamId = 99; // Special ID for "To be announced"
        }
        
        // Skip games with missing game ID
        if (!game.id) {
          logger.info(`Skipping game with missing ID`);
          skipCount++;
          continue;
        }
        
        // Map round name
        let roundNumber = game.round.toString();
        if (game.roundname && game.roundname === 'Opening Round') {
          roundNumber = 'OR';
        } else if (game.is_final > 0) {
          // Handle finals rounds based on is_final
          switch(game.is_final) {
            case 2: roundNumber = 'Elimination Final'; break;
            case 3: roundNumber = 'Qualifying Final'; break;
            case 4: roundNumber = 'Semi Final'; break;
            case 5: roundNumber = 'Preliminary Final'; break;
            case 6: roundNumber = 'Grand Final'; break;
            default: roundNumber = 'Finals';
          }
        }
        
        // Convert Unix timestamp to ISO date if available
        let matchDate = null;
        if (game.unixtime) {
          matchDate = new Date(game.unixtime * 1000).toISOString();
        } else if (game.date) {
          matchDate = new Date(game.date).toISOString();
        }
        
        // Get home and away scores if game has started
        const homeScore = game.hscore !== undefined ? game.hscore : null;
        const awayScore = game.ascore !== undefined ? game.ascore : null;
        
        // matches.complete is NOT NULL in schema; default unknown/invalid values to 0.
        const parsedCompletion = Number.parseInt(game.complete, 10);
        const completion = Number.isInteger(parsedCompletion) && parsedCompletion >= 0 && parsedCompletion <= 100
          ? parsedCompletion
          : 0;
        
        // Check if match already exists in database with the Squiggle ID
        const existingMatch = await getOne(
          'SELECT match_id FROM matches WHERE match_number = ?',
          [game.id]
        );
        
        if (existingMatch) {
          // Update existing match
          await runQuery(
            `UPDATE matches 
             SET round_number = ?, match_date = ?, venue = ?, 
                 home_team_id = ?, away_team_id = ?, hscore = ?, ascore = ?, 
                 hgoals = ?, hbehinds = ?, agoals = ?, abehinds = ?,
                 year = ?, complete = ?
             WHERE match_id = ?`,
            [
              roundNumber, 
              matchDate, 
              game.venue,
              homeTeamId, 
              awayTeamId, 
              homeScore, 
              awayScore,
              game.hgoals || null,
              game.hbehinds || null,
              game.agoals || null,
              game.abehinds || null,
              game.year || (matchDate ? new Date(matchDate).getFullYear() : new Date().getFullYear()),
              completion,
              existingMatch.match_id
            ]
          );
          updateCount++;
        } else {
          // Insert new match
          await runQuery(
            `INSERT INTO matches 
            (match_number, round_number, match_date, venue, 
              home_team_id, away_team_id, hscore, ascore, hgoals, hbehinds, agoals, abehinds, year, complete)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              game.id, 
              roundNumber, 
              matchDate, 
              game.venue,
              homeTeamId, 
              awayTeamId, 
              homeScore, 
              awayScore,
              game.hgoals || null,
              game.hbehinds || null,
              game.agoals || null,
              game.abehinds || null,
              game.year || (matchDate ? new Date(matchDate).getFullYear() : new Date().getFullYear()),
              completion // Add completion percentage
            ]
          );
          insertCount++;
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
    
    return {
      insertCount,
      updateCount,
      skipCount
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

module.exports = {
  syncGamesFromAPI,
  syncTeams
};
