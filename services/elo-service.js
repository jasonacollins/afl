const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { logger } = require('../utils/logger');

/**
 * Service for processing and serving ELO rating data
 */
class EloService {
  /**
   * Get ELO ratings data for a specific year
   * @param {number} year - The year to get ratings for
   * @returns {Promise<Object>} Processed ELO data with teams and ratings over time
   */
  async getEloRatingsForYear(year) {
    try {
      const csvPath = this.getEloDataPath(year);
      
      logger.info(`ELO data path resolved for year ${year}`, { 
        csvPath,
        exists: fs.existsSync(csvPath)
      });
      
      if (!fs.existsSync(csvPath)) {
        logger.warn(`ELO data file not found for year ${year}`, { path: csvPath });
        return { teams: [], data: [], year, error: `No ELO data available for ${year}` };
      }

      const rawData = await this.readEloCSV(csvPath);
      logger.info(`Raw CSV data loaded for year ${year}`, {
        csvPath,
        rawDataLength: rawData.length
      });
      
      const processedData = this.processEloData(rawData, year);
      
      logger.info(`Successfully processed ELO data for year ${year}`, { 
        teamsCount: processedData.teams.length,
        dataPoints: processedData.data.length 
      });
      
      return processedData;
    } catch (error) {
      logger.error(`Error getting ELO ratings for year ${year}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Get the path to the ELO data CSV file for a given year
   * @param {number} year - The year
   * @returns {string} Path to the CSV file
   */
  getEloDataPath(year) {
    // Try multiple possible locations for ELO data
    const possiblePaths = [
      path.join(__dirname, `../scripts/afl_elo_rating_history_from_${year}.csv`),
      path.join(__dirname, `../data/temp/afl_elo_rating_history_from_${year}.csv`),
      path.join(__dirname, `../scripts/afl_elo_rating_history_${year}.csv`)
    ];

    for (const csvPath of possiblePaths) {
      if (fs.existsSync(csvPath)) {
        return csvPath;
      }
    }

    // Return the most likely path even if it doesn't exist
    return possiblePaths[0];
  }

  /**
   * Read and parse ELO CSV data
   * @param {string} csvPath - Path to the CSV file
   * @returns {Promise<Array>} Parsed CSV data
   */
  async readEloCSV(csvPath) {
    return new Promise((resolve, reject) => {
      const results = [];
      
      fs.createReadStream(csvPath)
        .pipe(parse({ 
          header: true,
          skip_empty_lines: true,
          columns: true
        }))
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  /**
   * Process raw ELO data into chart-friendly format
   * @param {Array} rawData - Raw CSV data
   * @param {number} year - The year being processed
   * @returns {Object} Processed data with teams and rating progression by round
   */
  processEloData(rawData, year) {
    // Filter for the specific year and only match events
    const yearData = rawData.filter(row => 
      row.year == year && row.event === 'match'
    );

    if (yearData.length === 0) {
      return { teams: [], data: [], year, error: `No match data found for ${year}` };
    }

    // Get unique teams
    const teams = [...new Set(yearData.map(row => row.team))].sort();
    
    // Get unique rounds and sort them properly (handle finals)
    const rounds = [...new Set(yearData.map(row => row.round))];
    const sortedRounds = this.sortRounds(rounds);
    
    logger.info(`Processing ${sortedRounds.length} rounds for ${year}:`, sortedRounds.join(', '));
    
    // Create data structure for chart - one point per team per round
    const chartData = [];
    
    // Track each team's rating throughout the season
    const teamRatings = {};
    
    // Initialize with first known ratings for each team
    teams.forEach(team => {
      const firstMatch = yearData.find(row => row.team === team);
      if (firstMatch) {
        teamRatings[team] = parseFloat(firstMatch.rating_before);
      }
    });

    // For each round, get the rating at the START of that round
    sortedRounds.forEach(round => {
      const dataPoint = { round };
      
      teams.forEach(team => {
        // Find this team's match in this round
        const teamMatchInRound = yearData.find(row => 
          row.team === team && row.round === round
        );
        
        if (teamMatchInRound) {
          // Update rating from this match
          const ratingBefore = parseFloat(teamMatchInRound.rating_before);
          const ratingAfter = parseFloat(teamMatchInRound.rating_after);
          
          if (!isNaN(ratingBefore)) {
            teamRatings[team] = ratingBefore;
            dataPoint[team] = ratingBefore;
            
            // Update for next round
            if (!isNaN(ratingAfter)) {
              teamRatings[team] = ratingAfter;
            }
          }
        } else {
          // Team didn't play this round, use their current rating
          if (teamRatings[team] !== undefined) {
            dataPoint[team] = teamRatings[team];
          }
        }
      });
      
      chartData.push(dataPoint);
    });

    // Add final round with post-season ratings (rating_after from last match)
    // Show as the next upcoming round instead of "Final"
    if (sortedRounds.length > 0) {
      const lastRound = sortedRounds[sortedRounds.length - 1];
      const nextRound = this.getNextRound(lastRound);
      const finalDataPoint = { round: nextRound };
      
      teams.forEach(team => {
        // Find this team's last match to get their final rating
        const teamMatches = yearData
          .filter(row => row.team === team)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        if (teamMatches.length > 0) {
          const lastMatch = teamMatches[teamMatches.length - 1];
          const finalRating = parseFloat(lastMatch.rating_after);
          if (!isNaN(finalRating)) {
            finalDataPoint[team] = finalRating;
          }
        }
      });
      
      chartData.push(finalDataPoint);
    }

    logger.info(`Final ELO data: ${teams.length} teams, ${chartData.length} data points, rounds: ${chartData.map(d => d.round).join(', ')}`);

    return {
      teams,
      data: chartData,
      year,
      rounds: sortedRounds,
      totalMatches: yearData.length / 2, // Divide by 2 since each match has 2 entries
    };
  }

  /**
   * Get the next round after a given round
   * @param {string} currentRound - Current round
   * @returns {string} Next round
   */
  getNextRound(currentRound) {
    // Handle numeric rounds
    const roundNum = parseInt(currentRound);
    if (!isNaN(roundNum)) {
      return (roundNum + 1).toString();
    }
    
    // Handle special cases
    switch (currentRound) {
      case 'OR':
        return '1';
      case 'Elimination Final':
        return 'Qualifying Final';
      case 'Qualifying Final':
        return 'Semi Final';
      case 'Semi Final':
        return 'Preliminary Final';
      case 'Preliminary Final':
        return 'Grand Final';
      case 'Grand Final':
        return 'Season Complete';
      default:
        return 'Next Round';
    }
  }

  /**
   * Sort AFL rounds in proper order
   * @param {Array} rounds - Array of round names/numbers
   * @returns {Array} Sorted rounds
   */
  sortRounds(rounds) {
    // Define the order for finals
    const finalsOrder = {
      'OR': 0,
      'Elimination Final': 100,
      'Qualifying Final': 101,
      'Semi Final': 102,
      'Preliminary Final': 103,
      'Grand Final': 104
    };

    return rounds.sort((a, b) => {
      // Handle pre-season/opening round
      if (a === 'OR') return -1;
      if (b === 'OR') return 1;
      
      // Handle finals
      if (finalsOrder[a] !== undefined && finalsOrder[b] !== undefined) {
        return finalsOrder[a] - finalsOrder[b];
      }
      if (finalsOrder[a] !== undefined) return 1;
      if (finalsOrder[b] !== undefined) return -1;
      
      // Handle regular season rounds (numbers)
      const numA = parseInt(a);
      const numB = parseInt(b);
      
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      
      // Fallback to string comparison
      return a.localeCompare(b);
    });
  }

  /**
   * Get available years for ELO data
   * @returns {Array<number>} Array of available years
   */
  getAvailableYears() {
    const scriptsDir = path.join(__dirname, '../scripts');
    const dataDir = path.join(__dirname, '../data/temp');
    
    const years = new Set();
    
    // Check both directories for ELO files
    [scriptsDir, dataDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const match = file.match(/afl_elo_rating_history.*?(\d{4})\.csv$/);
          if (match) {
            years.add(parseInt(match[1]));
          }
        });
      }
    });
    
    return Array.from(years).sort((a, b) => b - a); // Sort descending (newest first)
  }
}

module.exports = new EloService();