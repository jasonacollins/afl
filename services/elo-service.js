const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { logger } = require('../utils/logger');
const { getQuery } = require('../models/db');

/**
 * Service for processing and serving ELO rating data
 */
class EloService {
  /**
   * Get team colors from database
   * @param {Array} teams - Array of team names
   * @returns {Promise<Object>} Object mapping team names to hex colors
   */
  async getTeamColors(teams) {
    try {
      if (!teams || teams.length === 0) {
        return {};
      }
      
      const placeholders = teams.map(() => '?').join(',');
      const colors = await getQuery(
        `SELECT name, colour_hex FROM teams WHERE name IN (${placeholders})`,
        teams
      );
      
      const colorMap = {};
      colors.forEach(row => {
        if (row.colour_hex) {
          colorMap[row.name] = `#${row.colour_hex}`;
        }
      });
      
      logger.info(`Loaded team colors for ${Object.keys(colorMap).length} teams`);
      return colorMap;
    } catch (error) {
      logger.error('Error loading team colors from database', { error: error.message });
      return {};
    }
  }

  /**
   * Get ELO ratings data for a specific year
   * @param {number} year - The year to get ratings for
   * @returns {Promise<Object>} Processed ELO data with teams and ratings over time
   */
  async getEloRatingsForYear(year) {
    try {
      const csvPath = this.getEloDataPath();
      
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
      
      // Add team colors to the response
      const teamColors = await this.getTeamColors(processedData.teams);
      processedData.teamColors = teamColors;
      
      logger.info(`Successfully processed ELO data for year ${year}`, { 
        teamsCount: processedData.teams.length,
        dataPoints: processedData.data.length,
        teamColorsCount: Object.keys(teamColors).length
      });
      
      return processedData;
    } catch (error) {
      logger.error(`Error getting ELO ratings for year ${year}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Get ELO ratings data for a year range using the complete historical CSV file
   * @param {number} startYear - Start year
   * @param {number} endYear - End year  
   * @returns {Promise<Object>} Processed ELO data with teams and ratings over time
   */
  async getEloRatingsForYearRange(startYear, endYear) {
    try {
      logger.info(`Getting ELO data for year range ${startYear} to ${endYear}`, { 
        startYear, 
        endYear 
      });

      // Use the single complete historical CSV file
      const csvPath = this.getEloDataPath();
      
      if (!fs.existsSync(csvPath)) {
        return { 
          teams: [], 
          data: [], 
          startYear, 
          endYear,
          error: `No ELO data available for year range ${startYear} to ${endYear}` 
        };
      }

      const rawData = await this.readEloCSV(csvPath);
      logger.info(`Loaded complete CSV data for year range`, {
        csvPath,
        totalRecords: rawData.length
      });
      
      const processedData = this.processEloDataForYearRange(rawData, startYear, endYear);
      
      // Add team colors to the response
      const teamColors = await this.getTeamColors(processedData.teams);
      processedData.teamColors = teamColors;
      
      logger.info(`Successfully processed ELO data for year range`, {
        startYear,
        endYear,
        teamsCount: processedData.teams.length,
        dataPoints: processedData.data.length,
        teamColorsCount: Object.keys(teamColors).length
      });
      
      return processedData;
    } catch (error) {
      logger.error(`Error getting ELO ratings for year range ${startYear} to ${endYear}`, { error: error.message });
      throw error;
    }
  }


  /**
   * Get the path to the complete ELO data CSV file
   * @returns {string} Path to the complete CSV file
   */
  getEloDataPath() {
    // Use single complete historical CSV file
    return path.join(__dirname, '../data/afl_elo_complete_history.csv');
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
   * Process raw ELO data for year range into step-pattern chart format
   * @param {Array} rawData - Raw CSV data
   * @param {number} startYear - Start year
   * @param {number} endYear - End year
   * @returns {Object} Processed data with teams and step-pattern rating progression
   */
  processEloDataForYearRange(rawData, startYear, endYear) {
    // Filter for the year range (no event column anymore)
    const filteredData = rawData.filter(row => {
      if (!row.year) return false;
      
      const year = parseInt(row.year);
      return year >= startYear && year <= endYear;
    });

    if (filteredData.length === 0) {
      return { 
        teams: [], 
        data: [], 
        startYear, 
        endYear, 
        error: `No match data found for year range ${startYear} to ${endYear}` 
      };
    }

    // Sort by date to ensure chronological order
    filteredData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get unique teams
    const teams = [...new Set(filteredData.map(row => row.team))].sort();
    
    logger.info(`Processing step-pattern ELO data for year range ${startYear}-${endYear}: ${teams.length} teams, ${filteredData.length} match records`);
    
    // Group matches by year and round for vertical alignment
    const matchesByYearRound = new Map();
    filteredData.forEach(row => {
      const groupKey = `${row.year}-${row.round}`;
      if (!matchesByYearRound.has(groupKey)) {
        matchesByYearRound.set(groupKey, []);
      }
      matchesByYearRound.get(groupKey).push(row);
    });

    // Sort groups chronologically with season gaps
    const sortedYearRounds = Array.from(matchesByYearRound.keys()).sort((a, b) => {
      const [yearA, roundA] = a.split('-', 2);
      const [yearB, roundB] = b.split('-', 2);
      
      // First sort by year
      const yearCompare = parseInt(yearA) - parseInt(yearB);
      if (yearCompare !== 0) return yearCompare;
      
      // Then by round within the same year
      return this.compareRounds(roundA, roundB);
    });
    
    // Track each team's rating throughout the period
    const teamRatings = {};
    const chartData = [];
    
    // Initialize with first known ratings for each team
    teams.forEach(team => {
      const firstMatch = filteredData.find(row => row.team === team);
      if (firstMatch) {
        teamRatings[team] = parseFloat(firstMatch.rating_before);
      } else {
        teamRatings[team] = 1500; // Default rating
      }
    });

    let previousYear = null;
    let stepIndex = 0;
    
    // Count total rounds per year for proper spacing
    const roundsPerYear = new Map();
    sortedYearRounds.forEach(yearRoundKey => {
      const [year] = yearRoundKey.split('-', 2);
      const currentYear = parseInt(year);
      roundsPerYear.set(currentYear, (roundsPerYear.get(currentYear) || 0) + 1);
    });
    
    const yearPositions = new Map(); // Track position within each year
    
    sortedYearRounds.forEach(yearRoundKey => {
      const [year, round] = yearRoundKey.split('-', 2);
      const currentYear = parseInt(year);
      const roundMatches = matchesByYearRound.get(yearRoundKey);
      
      // Initialize year position tracking
      if (!yearPositions.has(currentYear)) {
        yearPositions.set(currentYear, 0);
      }
      
      // Check for season change
      if (previousYear !== null && currentYear !== previousYear) {
        // Add gap between years
        stepIndex += 2;
        
        // Update team ratings to reflect season carryover for ALL teams in the new year
        teams.forEach(team => {
          // Find the first match for this team in the current year (any round)
          const firstMatchInYear = filteredData.find(match => 
            match.team === team && parseInt(match.year) === currentYear
          );
          if (firstMatchInYear) {
            teamRatings[team] = parseFloat(firstMatchInYear.rating_before);
          }
        });
      }
      
      // Get teams that actually play in this round
      const teamsInThisRound = new Set(roundMatches.map(match => match.team));
      
      // Use sequential step index for x-coordinate
      const roundXCoordinate = stepIndex++;
      yearPositions.set(currentYear, yearPositions.get(currentYear) + 1);
      
      // Create "before" data point - only for teams that play in this round  
      const beforePoint = {
        x: roundXCoordinate,
        year: currentYear,
        round: round,
        type: 'before',
        label: `${year} ${round} (Start)`
      };
      
      // Only add ratings for teams that actually play in this round
      // Use the actual rating_before from the CSV data, not the tracking variable
      teamsInThisRound.forEach(team => {
        const teamMatch = roundMatches.find(match => match.team === team);
        if (teamMatch) {
          beforePoint[team] = parseFloat(teamMatch.rating_before);
        }
      });
      chartData.push(beforePoint);

      // Sort matches within round by date, then by team for consistent ordering
      roundMatches.sort((a, b) => {
        const dateCompare = new Date(a.date) - new Date(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.team.localeCompare(b.team);
      });

      // Group matches by individual games within this round
      const gameGroups = new Map();
      roundMatches.forEach(match => {
        const gameKey = `${match.date}-${match.match_id}`;
        if (!gameGroups.has(gameKey)) {
          gameGroups.set(gameKey, []);
        }
        gameGroups.get(gameKey).push(match);
      });

      // Sort games by date within the round
      const sortedGames = Array.from(gameGroups.entries()).sort((a, b) => {
        const [dateA] = a[0].split('-', 1);
        const [dateB] = b[0].split('-', 1);
        return new Date(dateA) - new Date(dateB);
      });

      // Process each individual game within this round - all use same x-coordinate
      sortedGames.forEach(([gameKey, gameMatches], gameIndex) => {
        // Use the same x-coordinate that was set for the "before" point
        
        // Process all teams in this game and update their ratings
        gameMatches.forEach(match => {
          const team = match.team;
          const ratingAfter = parseFloat(match.rating_after);
          if (!isNaN(ratingAfter)) {
            teamRatings[team] = ratingAfter;
          }
        });

        // Create data point after this game - same x-coordinate for perfect alignment
        const afterGamePoint = {
          x: roundXCoordinate, // Same x-coordinate for all games in this round
          year: currentYear,
          round: round,
          type: 'after_game',
          label: `${year} ${round} (Game ${gameIndex + 1})`,
          gameIndex: gameIndex
        };
        
        // Only add ratings for teams that actually play in this round
        // Use the actual rating_after from the CSV data, not the tracking variable
        teamsInThisRound.forEach(team => {
          const teamMatch = gameMatches.find(match => match.team === team);
          if (teamMatch) {
            afterGamePoint[team] = parseFloat(teamMatch.rating_after);
          }
        });
        chartData.push(afterGamePoint);
      });
      
      previousYear = currentYear;
    });

    // Create year label mapping for x-axis based on actual x-coordinates
    const yearLabels = new Map();
    const yearRanges = new Map();
    
    // Track the x-coordinate ranges for each year
    chartData.forEach(point => {
      const year = point.year;
      const x = point.x;
      
      if (!yearRanges.has(year)) {
        yearRanges.set(year, { min: x, max: x });
      } else {
        const range = yearRanges.get(year);
        range.min = Math.min(range.min, x);
        range.max = Math.max(range.max, x);
      }
    });
    
    // Calculate center positions for year labels
    yearRanges.forEach((range, year) => {
      const center = (range.min + range.max) / 2;
      yearLabels.set(center, year);
    });

    logger.info(`Generated step-pattern ELO data for year range: ${chartData.length} data points`);
    logger.info(`Year labels created:`, Array.from(yearLabels.entries()));

    return {
      teams,
      data: chartData,
      startYear,
      endYear,
      yearRange: `${startYear} to ${endYear}`,
      yearLabels: Array.from(yearLabels.entries()), // [[position, year], ...]
      isStepPattern: true,
      totalMatches: filteredData.length / 2, // Divide by 2 since each match has 2 entries
      totalSteps: chartData.length
    };
  }

  /**
   * Compare two round strings for sorting
   * @param {string} roundA - First round
   * @param {string} roundB - Second round
   * @returns {number} Comparison result
   */
  compareRounds(roundA, roundB) {
    // Handle opening round first
    if (roundA === 'OR' && roundB !== 'OR') return -1;
    if (roundB === 'OR' && roundA !== 'OR') return 1;
    if (roundA === 'OR' && roundB === 'OR') return 0;

    const finalsOrder = {
      'Elimination Final': 100,
      'Qualifying Final': 101, 
      'Semi Final': 102,
      'Preliminary Final': 103,
      'Grand Final': 104
    };

    // Handle finals
    if (finalsOrder[roundA] !== undefined && finalsOrder[roundB] !== undefined) {
      return finalsOrder[roundA] - finalsOrder[roundB];
    }
    if (finalsOrder[roundA] !== undefined) return 1;
    if (finalsOrder[roundB] !== undefined) return -1;
    
    // Handle regular season rounds (numbers)
    const numA = parseInt(roundA);
    const numB = parseInt(roundB);
    
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    
    // Fallback to string comparison
    return roundA.localeCompare(roundB);
  }

  /**
   * Process raw ELO data into step-pattern chart format
   * @param {Array} rawData - Raw CSV data
   * @param {number} year - The year being processed
   * @returns {Object} Processed data with teams and step-pattern rating progression
   */
  processEloData(rawData, year) {
    // Filter for the specific year (no event column anymore)
    const yearData = rawData.filter(row => 
      row.year == year
    );

    if (yearData.length === 0) {
      return { teams: [], data: [], year, error: `No match data found for ${year}` };
    }

    // Sort by date to ensure chronological order within rounds
    yearData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get unique teams
    const teams = [...new Set(yearData.map(row => row.team))].sort();
    
    logger.info(`Processing step-pattern ELO data for ${year}: ${teams.length} teams, ${yearData.length} match records`);
    
    // Create step-pattern data structure - before and after points for each match
    const chartData = [];
    
    // Track each team's current rating
    const teamRatings = {};
    
    // Initialize with first known ratings for each team
    teams.forEach(team => {
      const firstMatch = yearData.find(row => row.team === team);
      if (firstMatch) {
        teamRatings[team] = parseFloat(firstMatch.rating_before);
      } else {
        teamRatings[team] = 1500; // Default ELO rating
      }
    });

    // Group matches by round only (ignore date for vertical alignment)
    const matchesByRound = new Map();
    yearData.forEach(match => {
      const round = match.round;
      if (!matchesByRound.has(round)) {
        matchesByRound.set(round, []);
      }
      matchesByRound.get(round).push(match);
    });

    // Sort rounds properly
    const sortedRounds = Array.from(matchesByRound.keys()).sort((a, b) => {
      return this.compareRounds(a, b);
    });

    let stepIndex = 0;

    sortedRounds.forEach((round, roundIndex) => {
      const roundMatches = matchesByRound.get(round);
      
      // Sort matches within round by date, then by team to ensure consistent ordering
      roundMatches.sort((a, b) => {
        const dateCompare = new Date(a.date) - new Date(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.team.localeCompare(b.team);
      });

      // Group matches by individual games (same date, paired teams)
      const gameGroups = new Map();
      roundMatches.forEach(match => {
        const gameKey = `${match.date}-${match.match_id}`;
        if (!gameGroups.has(gameKey)) {
          gameGroups.set(gameKey, []);
        }
        gameGroups.get(gameKey).push(match);
      });

      // Sort games by date within the round
      const sortedGames = Array.from(gameGroups.entries()).sort((a, b) => {
        const [dateA] = a[0].split('-', 1);
        const [dateB] = b[0].split('-', 1);
        return new Date(dateA) - new Date(dateB);
      });

      // Get teams that actually play in this round
      const teamsInThisRound = new Set(roundMatches.map(match => match.team));
      
      // Create "before" data point - only for teams that play in this round
      const beforePoint = {
        x: roundIndex,
        round: round,
        type: 'before',
        label: `${round} (Start)`
      };
      
      // Only add ratings for teams that actually play in this round
      // Use the actual rating_before from the CSV data, not the tracking variable
      teamsInThisRound.forEach(team => {
        const teamMatch = roundMatches.find(match => match.team === team);
        if (teamMatch) {
          beforePoint[team] = parseFloat(teamMatch.rating_before);
        }
      });
      chartData.push(beforePoint);

      // Process each individual game within this round - all use EXACT same x-coordinate
      sortedGames.forEach(([gameKey, gameMatches], gameIndex) => {
        // Process all teams in this game and update their ratings
        gameMatches.forEach(match => {
          const team = match.team;
          const ratingAfter = parseFloat(match.rating_after);
          if (!isNaN(ratingAfter)) {
            teamRatings[team] = ratingAfter;
          }
        });

        // Create data point after this game - EXACT same x-coordinate for perfect alignment
        const afterGamePoint = {
          x: roundIndex, // Exact same x-coordinate as round for perfect vertical alignment
          round: round,
          type: 'after_game',
          label: `${round} (Game ${gameIndex + 1})`,
          gameIndex: gameIndex
        };
        
        // Only add ratings for teams that actually play in this round
        // Use the actual rating_after from the CSV data, not the tracking variable
        teamsInThisRound.forEach(team => {
          const teamMatch = gameMatches.find(match => match.team === team);
          if (teamMatch) {
            afterGamePoint[team] = parseFloat(teamMatch.rating_after);
          }
        });
        chartData.push(afterGamePoint);
      });
    });

    logger.info(`Generated step-pattern ELO data: ${chartData.length} data points for ${year}`);

    return {
      teams,
      data: chartData,
      year,
      isStepPattern: true,
      totalMatches: yearData.length / 2, // Divide by 2 since each match has 2 entries
      totalSteps: chartData.length
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
   * Get available years for ELO data by reading the complete CSV file
   * @returns {Array<number>} Array of available years
   */
  async getAvailableYears() {
    try {
      const csvPath = this.getEloDataPath();
      
      if (!fs.existsSync(csvPath)) {
        return [];
      }
      
      const rawData = await this.readEloCSV(csvPath);
      const years = new Set();
      
      rawData.forEach(row => {
        if (row.year) {
          years.add(parseInt(row.year));
        }
      });
      
      return Array.from(years).sort((a, b) => b - a); // Sort descending (newest first)
    } catch (error) {
      logger.error('Error getting available years', { error: error.message });
      return [];
    }
  }
}

module.exports = new EloService();